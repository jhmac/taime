/**
 * Unit tests for the entitlement read module (server/services/entitlements.ts).
 *
 * Verifies the three operational states described in ADR-0011:
 *  1. Rows present in DB → only those feature keys are returned.
 *  2. No rows for the store → trial state, all feature keys are returned.
 *  3. DB query throws → error propagates (billing-bypass prevention).
 *
 * Also exercises the in-memory TTL cache:
 *  4. A second call within the TTL skips the DB.
 *  5. invalidateEntitlementCache clears the cache so the next call re-queries.
 *
 * The `db` and `@shared/schema` modules are mocked via vi.mock/vi.hoisted so no
 * real database connection is required.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── hoist mocks so they are available inside vi.mock factories ────────────

const { mockSelect } = vi.hoisted(() => {
  return { mockSelect: vi.fn() };
});

vi.mock("../server/db", () => ({
  db: {
    select: mockSelect,
  },
}));

// The real schema module imports drizzle-orm/pg-core and pulls in the full
// schema graph. We only need a stand-in object for storeEntitlements so the
// service's `eq(storeEntitlements.storeId, …)` call doesn't blow up.
vi.mock("@shared/schema", () => ({
  storeEntitlements: {
    storeId: { name: "store_id" },
    featureKey: { name: "feature_key" },
  },
}));

// Stub drizzle's `eq` so it returns a sentinel without reaching into the real
// column metadata.
vi.mock("drizzle-orm", () => ({
  eq: (col: unknown, val: unknown) => ({ __op: "eq", col, val }),
}));

// ── import the unit under test after the mocks are in place ───────────────

import {
  getEntitlements,
  hasEntitlement,
  invalidateEntitlementCache,
} from "../server/services/entitlements";

// The full feature-key list is duplicated here intentionally — it mirrors
// ALL_FEATURE_KEYS in entitlements.ts. If that list changes, this test should
// also be updated so the trial-state expectation stays explicit.
const ALL_FEATURE_KEYS: readonly string[] = [
  "core.time_clock",
  "core.scheduling",
  "core.task_management",
  "core.communication",
  "payroll.export",
  "payroll.automation",
  "analytics.dashboard",
  "analytics.advanced",
  "sales.view_all",
  "reports.scheduled",
  "ai.scheduling",
  "ai.payroll_analysis",
  "ai.learning",
  "ai.sop_intelligence",
];

// ── helpers ────────────────────────────────────────────────────────────────

/**
 * Build a chainable query builder mock that resolves to `rows` when awaited.
 * Covers the call chain: db.select(…).from(…).where(…)
 */
function makeQueryChain(rows: { featureKey: string }[]) {
  const chain: Record<string, unknown> = {};
  const terminal = Promise.resolve(rows);
  chain.from = vi.fn(() => chain);
  chain.where = vi.fn(() => terminal);
  return chain;
}

/**
 * Build a chainable query builder whose terminal `.where(…)` rejects.
 * Mirrors what happens when the underlying pg pool throws.
 */
function makeRejectingChain(error: Error) {
  const chain: Record<string, unknown> = {};
  chain.from = vi.fn(() => chain);
  chain.where = vi.fn(() => Promise.reject(error));
  return chain;
}

beforeEach(() => {
  vi.clearAllMocks();
  // Each test uses a unique storeId so the module-level cache (which we cannot
  // easily reach without the public invalidate API) does not bleed between
  // cases. Where cache behavior is being asserted, the test calls
  // invalidateEntitlementCache explicitly.
});

// ── rows-present case ─────────────────────────────────────────────────────

describe("getEntitlements — rows present", () => {
  it("returns the feature keys returned by the DB query", async () => {
    const rows = [
      { featureKey: "core.scheduling" },
      { featureKey: "analytics.dashboard" },
    ];
    mockSelect.mockReturnValue(makeQueryChain(rows));

    const result = await getEntitlements("store-rows-1");

    expect(result).toStrictEqual(["core.scheduling", "analytics.dashboard"]);
    expect(mockSelect).toHaveBeenCalledTimes(1);
  });
});

describe("hasEntitlement — against rows in the DB", () => {
  it("returns true when the requested key is in the row set", async () => {
    const rows = [
      { featureKey: "core.scheduling" },
      { featureKey: "payroll.export" },
    ];
    mockSelect.mockReturnValue(makeQueryChain(rows));

    const result = await hasEntitlement("store-has-true-1", "payroll.export");

    expect(result).toBe(true);
  });

  it("returns false when the requested key is not in the row set", async () => {
    const rows = [
      { featureKey: "core.scheduling" },
      { featureKey: "payroll.export" },
    ];
    mockSelect.mockReturnValue(makeQueryChain(rows));

    const result = await hasEntitlement(
      "store-has-false-1",
      "ai.sop_intelligence",
    );

    expect(result).toBe(false);
  });
});

// ── trial / no-rows case ──────────────────────────────────────────────────

describe("getEntitlements — no rows (trial / pre-subscription state)", () => {
  it("returns ALL feature keys when the store has no entitlement rows", async () => {
    mockSelect.mockReturnValue(makeQueryChain([]));

    const result = await getEntitlements("store-trial-1");

    // Order must match ALL_FEATURE_KEYS in the service module.
    expect(result).toStrictEqual([...ALL_FEATURE_KEYS]);
  });

  it("hasEntitlement returns true for every known feature in trial state", async () => {
    mockSelect.mockReturnValue(makeQueryChain([]));

    const result = await hasEntitlement("store-trial-2", "ai.sop_intelligence");

    expect(result).toBe(true);
  });

  it("hasEntitlement still returns false for an unknown feature key in trial state", async () => {
    mockSelect.mockReturnValue(makeQueryChain([]));

    const result = await hasEntitlement(
      "store-trial-3",
      "feature.does_not_exist",
    );

    expect(result).toBe(false);
  });
});

// ── DB-failure case ───────────────────────────────────────────────────────
//
// NOTE — Deviation from task spec:
// The task description says DB failures should "fail-open" by returning all
// FEATURE_KEYS. The implementation does the opposite by design — see the
// inline comment in entitlements.ts:
//
//   "Intentionally not wrapped in try/catch: a DB error must surface as 500,
//    not silently grant full access (which would be a billing-bypass
//    vulnerability)."
//
// We test the actual (and safer) behavior: the error propagates to the caller.

describe("getEntitlements — DB query throws", () => {
  it("propagates the underlying DB error to the caller", async () => {
    const dbError = new Error("connection refused");
    mockSelect.mockReturnValue(makeRejectingChain(dbError));

    await expect(getEntitlements("store-db-error-1")).rejects.toThrow(
      "connection refused",
    );
  });

  it("hasEntitlement also propagates the DB error", async () => {
    const dbError = new Error("pool exhausted");
    mockSelect.mockReturnValue(makeRejectingChain(dbError));

    await expect(
      hasEntitlement("store-db-error-2", "core.scheduling"),
    ).rejects.toThrow("pool exhausted");
  });

  it("does not cache a failed DB result — a retry hits the DB again", async () => {
    const storeId = "store-db-error-retry-1";

    mockSelect
      .mockReturnValueOnce(makeRejectingChain(new Error("transient")))
      .mockReturnValueOnce(
        makeQueryChain([{ featureKey: "core.scheduling" }]),
      );

    await expect(getEntitlements(storeId)).rejects.toThrow("transient");

    // Retry succeeds — proves the failure was not cached.
    const result = await getEntitlements(storeId);
    expect(result).toStrictEqual(["core.scheduling"]);
    expect(mockSelect).toHaveBeenCalledTimes(2);
  });
});

// ── cache behavior ────────────────────────────────────────────────────────

describe("getEntitlements — in-memory TTL cache", () => {
  it("a second call within the TTL skips the DB", async () => {
    const rows = [{ featureKey: "core.time_clock" }];
    mockSelect.mockReturnValue(makeQueryChain(rows));

    const storeId = "store-cache-hit-1";
    invalidateEntitlementCache(storeId); // ensure clean state

    const first = await getEntitlements(storeId);
    const second = await getEntitlements(storeId);

    expect(first).toStrictEqual(["core.time_clock"]);
    expect(second).toStrictEqual(["core.time_clock"]);
    expect(mockSelect).toHaveBeenCalledTimes(1); // one DB round-trip total
  });

  it("caches the trial-state response too (no rows → all keys, served from cache)", async () => {
    mockSelect.mockReturnValue(makeQueryChain([]));

    const storeId = "store-cache-trial-1";
    invalidateEntitlementCache(storeId);

    const first = await getEntitlements(storeId);
    const second = await getEntitlements(storeId);

    expect(first).toStrictEqual([...ALL_FEATURE_KEYS]);
    expect(second).toStrictEqual([...ALL_FEATURE_KEYS]);
    expect(mockSelect).toHaveBeenCalledTimes(1);
  });

  it("caches per-store: store A and store B each trigger their own DB query", async () => {
    const storeA = "store-cache-iso-a-1";
    const storeB = "store-cache-iso-b-1";
    invalidateEntitlementCache(storeA);
    invalidateEntitlementCache(storeB);

    mockSelect
      .mockReturnValueOnce(
        makeQueryChain([{ featureKey: "core.scheduling" }]),
      )
      .mockReturnValueOnce(makeQueryChain([{ featureKey: "payroll.export" }]));

    const resultA = await getEntitlements(storeA);
    const resultB = await getEntitlements(storeB);

    expect(resultA).toStrictEqual(["core.scheduling"]);
    expect(resultB).toStrictEqual(["payroll.export"]);
    expect(mockSelect).toHaveBeenCalledTimes(2);

    // Both should now be served from cache.
    await getEntitlements(storeA);
    await getEntitlements(storeB);
    expect(mockSelect).toHaveBeenCalledTimes(2);
  });
});

describe("invalidateEntitlementCache", () => {
  it("clears the cache so the next call re-queries the DB", async () => {
    const storeId = "store-invalidate-1";
    invalidateEntitlementCache(storeId);

    mockSelect
      .mockReturnValueOnce(
        makeQueryChain([{ featureKey: "core.scheduling" }]),
      )
      .mockReturnValueOnce(
        makeQueryChain([
          { featureKey: "core.scheduling" },
          { featureKey: "payroll.export" },
        ]),
      );

    // Prime the cache.
    const first = await getEntitlements(storeId);
    expect(first).toStrictEqual(["core.scheduling"]);
    expect(mockSelect).toHaveBeenCalledTimes(1);

    // Cache hit — no new DB call.
    const cached = await getEntitlements(storeId);
    expect(cached).toStrictEqual(["core.scheduling"]);
    expect(mockSelect).toHaveBeenCalledTimes(1);

    // Invalidate, then the next call must hit the DB and see the new rows.
    invalidateEntitlementCache(storeId);
    const refreshed = await getEntitlements(storeId);
    expect(refreshed).toStrictEqual(["core.scheduling", "payroll.export"]);
    expect(mockSelect).toHaveBeenCalledTimes(2);
  });

  it("is a no-op when the cache has no entry for the given store", () => {
    // Should not throw, return value should be void.
    expect(() =>
      invalidateEntitlementCache("store-never-cached-1"),
    ).not.toThrow();
  });
});
