import { describe, it, expect, vi, beforeEach } from "vitest";

// Shared mock state — populated by tests, read by the mocked db.
const state: { inserted: any[]; selectQueue: any[]; insertQueue: any[] } = {
  inserted: [],
  selectQueue: [],
  insertQueue: [],
};

vi.mock("../server/db", () => ({
  db: {
    select() {
      const rows = state.selectQueue.shift() ?? [];
      return { from: () => ({ where: () => Promise.resolve(rows) }) };
    },
    insert(table: any) {
      return {
        values: (v: any) => {
          const next = state.insertQueue.shift();
          state.inserted.push({ table: table?.toString?.() ?? "t", values: v });
          if (next instanceof Error) return Promise.reject(next);
          return Promise.resolve(next ?? { rowCount: 1 });
        },
      };
    },
    delete() { return { where: () => Promise.resolve({ rowCount: 1 }) }; },
  },
}));
vi.mock("../server/lib/logger", () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock("../server/services/aiBudgetAlertEmail", () => ({
  sendBudgetAlertEmail: vi.fn().mockResolvedValue(undefined),
}));

import {
  recordUsageEvent,
  assertBudgets,
  invalidateBudgetCache,
  BudgetExceededError,
} from "../server/services/aiUsageTracker";
import { sendBudgetAlertEmail } from "../server/services/aiBudgetAlertEmail";

function pushSelect(rows: any[]) { state.selectQueue.push(rows); }
function pushInsertResult(r: any) { state.insertQueue.push(r); }

beforeEach(() => {
  state.inserted.length = 0;
  state.selectQueue.length = 0;
  state.insertQueue.length = 0;
  invalidateBudgetCache();
  vi.mocked(sendBudgetAlertEmail).mockClear();
});

describe("aiUsageTracker — assertBudgets", () => {
  it("does not throw when no budgets are configured", async () => {
    pushSelect([]); // global budget
    await expect(assertBudgets(null)).resolves.toBeUndefined();
  });

  it("throws BudgetExceededError when global hardBlock budget is over limit", async () => {
    pushSelect([{
      id: "g1", scope: "global", storeId: null,
      monthlyLimitUsd: "100", alertThresholdPercent: 80,
      hardBlock: true, enabled: true,
    }]);
    pushSelect([{ total: "150.00" }]); // MTD spend > limit
    await expect(assertBudgets(null)).rejects.toBeInstanceOf(BudgetExceededError);
  });

  it("does NOT throw when budget is alert-only (hardBlock=false) even if over", async () => {
    pushSelect([{
      id: "g1", scope: "global", storeId: null,
      monthlyLimitUsd: "100", alertThresholdPercent: 80,
      hardBlock: false, enabled: true,
    }]);
    await expect(assertBudgets(null)).resolves.toBeUndefined();
  });

  it("does NOT throw when budget is disabled", async () => {
    pushSelect([{
      id: "g1", scope: "global", storeId: null,
      monthlyLimitUsd: "100", alertThresholdPercent: 80,
      hardBlock: true, enabled: false,
    }]);
    await expect(assertBudgets(null)).resolves.toBeUndefined();
  });
});

describe("aiUsageTracker — recordUsageEvent", () => {
  it("inserts an event row", async () => {
    await recordUsageEvent({
      provider: "anthropic",
      model: "claude-sonnet-4-20250514",
      operation: "chat",
      feature: "test",
      storeId: null,
      userId: null,
      isBackground: false,
      inputTokens: 100,
      outputTokens: 50,
      costUsd: "0.0012",
      latencyMs: 200,
      status: "success",
      errorMessage: null,
    });
    expect(state.inserted.length).toBeGreaterThanOrEqual(1);
    expect(state.inserted[0].values.feature).toBe("test");
    expect(state.inserted[0].values.costUsd).toBe("0.0012");
  });

  it("dedups alert emails — second alert at same threshold/period is suppressed by unique constraint", async () => {
    // Setup: a global budget at $100, MTD spend $90 (90% > 80% threshold).
    const budget = {
      id: "b-dedup", scope: "global", storeId: null,
      monthlyLimitUsd: "100", alertThresholdPercent: 80,
      hardBlock: true, enabled: true,
    };

    // First call:
    //   1) insert ai_usage_events (success)
    //   2) checkAndFireAlerts → load global budget
    //   3) load MTD spend ($90)
    //   4) insert ai_budget_alerts (succeeds — first time)
    pushInsertResult({ rowCount: 1 });        // event insert
    pushSelect([budget]);                      // global budget
    pushSelect([{ total: "90.00" }]);          // spend
    pushInsertResult({ rowCount: 1 });        // alert insert (success)

    await recordUsageEvent({
      provider: "anthropic", model: "claude-sonnet-4-20250514", operation: "chat",
      feature: "f", storeId: null, userId: null, isBackground: false,
      inputTokens: 1, outputTokens: 1, costUsd: "0.10",
      latencyMs: 1, status: "success", errorMessage: null,
    });
    // Wait microtask for void checkAndFireAlerts() to complete.
    await new Promise((r) => setImmediate(r));
    expect(sendBudgetAlertEmail).toHaveBeenCalledTimes(1);

    // Second call: same period, same threshold ⇒ unique constraint fires
    pushInsertResult({ rowCount: 1 });
    pushSelect([budget]);
    pushSelect([{ total: "92.00" }]);
    // Alert insert rejects with "duplicate" — tracker swallows + does NOT send email.
    pushInsertResult(Object.assign(new Error("duplicate"), { code: "23505" }));

    await recordUsageEvent({
      provider: "anthropic", model: "claude-sonnet-4-20250514", operation: "chat",
      feature: "f", storeId: null, userId: null, isBackground: false,
      inputTokens: 1, outputTokens: 1, costUsd: "0.10",
      latencyMs: 1, status: "success", errorMessage: null,
    });
    await new Promise((r) => setImmediate(r));
    expect(sendBudgetAlertEmail).toHaveBeenCalledTimes(1); // unchanged — dedup'd
  });
});
