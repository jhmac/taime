/**
 * Unit tests for the operational insights aggregator + dismiss/act-on flow
 * (Task #517).
 *
 * Covers:
 *  - aggregateOperations(): day-of-week buckets, overdue-task counts,
 *    recurring-issue grouping, SOP completion-rate ranking, and the joined
 *    "feedback context" of recently dismissed insights.
 *  - summarizeForAI(): the dismiss reason text is forwarded into the prompt
 *    summary so the next Claude call learns from past dismissals.
 *  - POST /api/insights/operational/:id/dismiss
 *  - POST /api/insights/operational/:id/act-on
 *    Both endpoints: status transitions, store-scoping (cross-store 403),
 *    and that the dismiss reason is persisted (and therefore later available
 *    to the aggregator's feedback context).
 *
 * The DB layer is fully mocked. `db.select(...).from(table)` routes to a
 * per-table fixture map keyed by the imported drizzle table reference, and
 * `db.update(...).set(...).where(...).returning()` / `db.insert(...).values(...).returning()`
 * are spied so we can assert exact field values written to the DB.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { AddressInfo } from "net";
import http from "http";

// ── Hoisted mocks ─────────────────────────────────────────────────────────────

const dbMock = vi.hoisted(() => ({
  select: vi.fn(),
  insert: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
}));

const storeResolverMock = vi.hoisted(() => ({
  tryResolveStoreIdForUser: vi.fn(),
  resolveStoreIdForUser: vi.fn(),
}));

const cacheMock = vi.hoisted(() => ({
  cache: {
    get: vi.fn(),
    set: vi.fn(),
    invalidatePrefix: vi.fn(),
  },
}));

vi.mock("../server/db", () => ({ db: dbMock }));
vi.mock("../server/services/storeResolver", () => storeResolverMock);
vi.mock("../server/services/cache", () => cacheMock);
vi.mock("../server/lib/config", () => ({
  config: { anthropic: { apiKey: "" } },
}));
vi.mock("../server/lib/logger", () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
// We never actually call Claude in these tests, but insightGenerator imports
// the SDK at module load.
vi.mock("@anthropic-ai/sdk", () => ({
  default: class FakeAnthropic {
    messages = { create: vi.fn().mockResolvedValue({ content: [{ type: "text", text: "[]" }] }) };
    constructor(_opts: any) {}
  },
}));

// ── Imports (after mocks) ─────────────────────────────────────────────────────

import {
  workLocations,
  schedules,
  tasks as tasksTable,
  issues,
  sopExecutions,
  sopTemplates,
  timeEntries,
  users,
  operationalInsights,
  kudos,
} from "@shared/schema";

import { aggregateOperations, summarizeForAI } from "../server/services/operationsIntelligence";

// ── DB chainable fixture wiring ───────────────────────────────────────────────

interface Fixtures {
  workLocations: any[];
  schedules: any[];
  tasks: any[];
  issues: any[];
  sopExecutions: any[];
  sopTemplates: any[];
  timeEntries: any[];
  users: any[];
  kudos: any[];
  // operationalInsights is queried twice in feedback context (dismissed, then acted_on),
  // so we sequence the responses.
  opInsightsSequence: any[][];
}

let fixtures: Fixtures;
let opInsightsCallIdx: number;

// Capture last writes for assertion
interface WriteCapture {
  updateTable: any | null;
  updateSet: any | null;
  insertTable: any | null;
  insertValues: any | null;
  insertReturned: any[];
  updateReturned: any[];
}
let writeCapture: WriteCapture;

function resetFixtures() {
  fixtures = {
    workLocations: [],
    schedules: [],
    tasks: [],
    issues: [],
    sopExecutions: [],
    sopTemplates: [],
    timeEntries: [],
    users: [],
    kudos: [],
    opInsightsSequence: [[], []],
  };
  opInsightsCallIdx = 0;
  writeCapture = {
    updateTable: null,
    updateSet: null,
    insertTable: null,
    insertValues: null,
    insertReturned: [],
    updateReturned: [],
  };
}

function rowsForTable(table: any): any[] {
  if (table === workLocations) return fixtures.workLocations;
  if (table === schedules) return fixtures.schedules;
  if (table === tasksTable) return fixtures.tasks;
  if (table === issues) return fixtures.issues;
  if (table === sopExecutions) return fixtures.sopExecutions;
  if (table === sopTemplates) return fixtures.sopTemplates;
  if (table === timeEntries) return fixtures.timeEntries;
  if (table === users) return fixtures.users;
  if (table === kudos) return fixtures.kudos;
  if (table === operationalInsights) {
    const seq = fixtures.opInsightsSequence;
    const idx = Math.min(opInsightsCallIdx, seq.length - 1);
    const out = seq[idx] ?? [];
    opInsightsCallIdx++;
    return out;
  }
  return [];
}

function makeSelectChain(): any {
  let rows: any[] = [];
  const chain: any = {};
  chain.from = vi.fn((table: any) => {
    rows = rowsForTable(table);
    return chain;
  });
  chain.where = vi.fn(() => chain);
  chain.orderBy = vi.fn(() => chain);
  chain.innerJoin = vi.fn(() => chain);
  chain.leftJoin = vi.fn(() => chain);
  chain.groupBy = vi.fn(() => chain);
  chain.offset = vi.fn(() => chain);
  // limit terminates with a Promise (the only call sites that use limit
  // immediately await the result).
  chain.limit = vi.fn(() => Promise.resolve(rows));
  // Make the chain itself awaitable too — for queries that don't use limit().
  chain.then = (onFulfilled: any, onRejected: any) =>
    Promise.resolve(rows).then(onFulfilled, onRejected);
  chain.catch = (onRejected: any) => Promise.resolve(rows).catch(onRejected);
  chain.finally = (onFinally: any) => Promise.resolve(rows).finally(onFinally);
  return chain;
}

function makeUpdateChain(table: any): any {
  writeCapture.updateTable = table;
  const chain: any = {};
  chain.set = vi.fn((vals: any) => {
    writeCapture.updateSet = vals;
    return chain;
  });
  chain.where = vi.fn(() => chain);
  chain.returning = vi.fn(() => Promise.resolve(writeCapture.updateReturned));
  return chain;
}

function makeInsertChain(table: any): any {
  writeCapture.insertTable = table;
  const chain: any = {};
  chain.values = vi.fn((vals: any) => {
    writeCapture.insertValues = vals;
    return chain;
  });
  chain.returning = vi.fn(() => Promise.resolve(writeCapture.insertReturned));
  return chain;
}

function makeDeleteChain(): any {
  const chain: any = {};
  chain.where = vi.fn(() => Promise.resolve([]));
  return chain;
}

beforeEach(() => {
  resetFixtures();
  vi.clearAllMocks();
  dbMock.select.mockImplementation(() => makeSelectChain());
  dbMock.update.mockImplementation((table: any) => makeUpdateChain(table));
  dbMock.insert.mockImplementation((table: any) => makeInsertChain(table));
  dbMock.delete.mockImplementation(() => makeDeleteChain());
  cacheMock.cache.get.mockReturnValue(undefined);
  cacheMock.cache.set.mockImplementation(() => {});
  cacheMock.cache.invalidatePrefix.mockImplementation(() => {});
});

// ── Helpers for fixture data ─────────────────────────────────────────────────

const STORE_ID = "store-aggr-1";
const NOW = Date.now();

function date(daysAgo: number, hour = 9): Date {
  const d = new Date(NOW - daysAgo * 86400000);
  d.setHours(hour, 0, 0, 0);
  return d;
}

function endOf(d: Date, hours = 8): Date {
  return new Date(d.getTime() + hours * 3600000);
}

// ─────────────────────────────────────────────────────────────────────────────
// AGGREGATOR TESTS
// ─────────────────────────────────────────────────────────────────────────────

describe("aggregateOperations()", () => {
  it("buckets schedules by day-of-week and totals coverage hours", async () => {
    fixtures.workLocations = [{ name: "Boutique A" }];
    // 3 shifts on Monday, 1 on Wednesday, 2 on Saturday — relative to today.
    // Use absolute weekday-pinned dates to keep the test deterministic
    // regardless of when it runs.
    const monday = new Date("2025-01-06T09:00:00.000Z"); // Monday
    const wednesday = new Date("2025-01-08T09:00:00.000Z"); // Wednesday
    const saturday = new Date("2025-01-11T09:00:00.000Z"); // Saturday
    fixtures.schedules = [
      { id: "s1", userId: "u1", startTime: monday, endTime: endOf(monday, 6) },
      { id: "s2", userId: "u2", startTime: monday, endTime: endOf(monday, 4) },
      { id: "s3", userId: "u3", startTime: monday, endTime: endOf(monday, 8) },
      { id: "s4", userId: "u1", startTime: wednesday, endTime: endOf(wednesday, 5) },
      { id: "s5", userId: "u1", startTime: saturday, endTime: endOf(saturday, 8) },
      { id: "s6", userId: "u2", startTime: saturday, endTime: endOf(saturday, 4) },
    ];

    const agg = await aggregateOperations(STORE_ID, {
      start: new Date("2025-01-01T00:00:00.000Z"),
      end: new Date("2025-01-31T23:59:59.000Z"),
      label: "test window",
    });

    // getDay() returns 0=Sunday … 6=Saturday in *local* time. The dates above
    // are pinned to the same UTC day-of-week as their local day-of-week for
    // any Western timezone (date strings include explicit Z and noon-ish
    // hours). To stay robust, look up by the dow we computed ourselves.
    const monDow = String(monday.getDay());
    const wedDow = String(wednesday.getDay());
    const satDow = String(saturday.getDay());

    expect(agg.schedules.byDayOfWeek[monDow].count).toBe(3);
    expect(agg.schedules.byDayOfWeek[monDow].coveredHours).toBeCloseTo(18, 5);
    expect(agg.schedules.byDayOfWeek[wedDow].count).toBe(1);
    expect(agg.schedules.byDayOfWeek[wedDow].coveredHours).toBeCloseTo(5, 5);
    expect(agg.schedules.byDayOfWeek[satDow].count).toBe(2);
    expect(agg.schedules.byDayOfWeek[satDow].coveredHours).toBeCloseTo(12, 5);
    expect(agg.schedules.total).toBe(6);
    expect(agg.schedules.totalHoursScheduled).toBeCloseTo(35, 5);

    // Coverage gap detection: a day is flagged when it has <2 staff OR <6h
    // covered. Wednesday has 1 staff and 5h covered → must appear; Monday
    // (3 staff / 18h) and Saturday (2 staff / 12h) must NOT appear.
    const gapDates = agg.schedules.coverageGaps.map((g) => g.date);
    expect(gapDates).toContain(wednesday.toISOString().slice(0, 10));
    expect(gapDates).not.toContain(monday.toISOString().slice(0, 10));
    expect(gapDates).not.toContain(saturday.toISOString().slice(0, 10));
  });

  it("counts overdue tasks (due in the past, not completed) and surfaces aging-pending", async () => {
    fixtures.workLocations = [{ name: "Boutique B" }];
    fixtures.tasks = [
      // 2 overdue (pending, dueDate in the past)
      { id: "t1", title: "Restock denim", status: "pending", priority: "high",
        dueDate: date(2), createdAt: date(10), completedAt: null,
        assignedTo: null, isRecurring: false, locationId: STORE_ID },
      { id: "t2", title: "Refresh window", status: "in_progress", priority: "medium",
        dueDate: date(1), createdAt: date(8), completedAt: null,
        assignedTo: null, isRecurring: false, locationId: STORE_ID },
      // Pending but due in the future → not overdue
      { id: "t3", title: "Inventory count", status: "pending", priority: "low",
        dueDate: date(-5), createdAt: date(1), completedAt: null,
        assignedTo: null, isRecurring: false, locationId: STORE_ID },
      // Completed → never overdue
      { id: "t4", title: "Greeting script", status: "completed", priority: "medium",
        dueDate: date(3), createdAt: date(7), completedAt: date(2),
        assignedTo: null, isRecurring: false, locationId: STORE_ID },
      // Cancelled → never overdue
      { id: "t5", title: "Old promo", status: "cancelled", priority: "low",
        dueDate: date(4), createdAt: date(6), completedAt: null,
        assignedTo: null, isRecurring: false, locationId: STORE_ID },
    ];

    const agg = await aggregateOperations(STORE_ID);

    expect(agg.tasks.total).toBe(5);
    expect(agg.tasks.completed).toBe(1);
    expect(agg.tasks.cancelled).toBe(1);
    expect(agg.tasks.pending).toBe(3); // pending + in_progress
    expect(agg.tasks.overdueCount).toBe(2); // t1 + t2
    expect(agg.tasks.completionRate).toBeCloseTo(1 / 5, 5);

    // Pending >3 days surfaces by age (not by overdue). Of pending: t1 (10d),
    // t2 (8d), t3 (1d). Only t1 and t2 qualify.
    const pendingAgedIds = agg.tasks.pendingOver3Days.map((t) => t.id);
    expect(pendingAgedIds).toContain("t1");
    expect(pendingAgedIds).toContain("t2");
    expect(pendingAgedIds).not.toContain("t3");
    // Sorted by age desc → t1 (10d) first
    expect(agg.tasks.pendingOver3Days[0].id).toBe("t1");
  });

  it("groups recurring issues by category once a category hits the 3+ threshold", async () => {
    fixtures.workLocations = [{ name: "Boutique C" }];
    const within = date(5);
    fixtures.issues = [
      // 4 in 'pos' → recurring
      { id: "i1", title: "POS froze", category: "pos", status: "open",
        priority: "medium", createdAt: within, resolvedAt: null, storeId: STORE_ID },
      { id: "i2", title: "POS lag", category: "pos", status: "resolved",
        priority: "low", createdAt: within, resolvedAt: date(4), storeId: STORE_ID },
      { id: "i3", title: "POS reboot", category: "pos", status: "open",
        priority: "high", createdAt: within, resolvedAt: null, storeId: STORE_ID },
      { id: "i4", title: "POS print fail", category: "pos", status: "in_progress",
        priority: "medium", createdAt: within, resolvedAt: null, storeId: STORE_ID },
      // 3 in 'cleaning' → recurring
      { id: "i5", title: "Spill", category: "cleaning", status: "resolved",
        priority: "low", createdAt: within, resolvedAt: date(4), storeId: STORE_ID },
      { id: "i6", title: "Trash", category: "cleaning", status: "resolved",
        priority: "low", createdAt: within, resolvedAt: date(4), storeId: STORE_ID },
      { id: "i7", title: "Smell", category: "cleaning", status: "open",
        priority: "low", createdAt: within, resolvedAt: null, storeId: STORE_ID },
      // 2 in 'lighting' → NOT recurring (below threshold of 3)
      { id: "i8", title: "Bulb out", category: "lighting", status: "open",
        priority: "low", createdAt: within, resolvedAt: null, storeId: STORE_ID },
      { id: "i9", title: "Flicker", category: "lighting", status: "resolved",
        priority: "low", createdAt: within, resolvedAt: date(4), storeId: STORE_ID },
    ];

    const agg = await aggregateOperations(STORE_ID);

    expect(agg.issues.total).toBe(9);

    const recurringByCat = Object.fromEntries(
      agg.issues.recurringCategories.map((c) => [c.category, c.count]),
    );
    expect(recurringByCat).toEqual({ pos: 4, cleaning: 3 });
    expect(recurringByCat).not.toHaveProperty("lighting");

    // Sorted by count desc → pos (4) before cleaning (3)
    expect(agg.issues.recurringCategories[0].category).toBe("pos");
    expect(agg.issues.recurringCategories[1].category).toBe("cleaning");

    // recurring flag is set on the per-category map for >=3
    expect(agg.issues.byCategory.pos.recurring).toBe(true);
    expect(agg.issues.byCategory.cleaning.recurring).toBe(true);
    expect(agg.issues.byCategory.lighting.recurring).toBe(false);
  });

  it("computes SOP completion rates and flags templates below 70% (with >=3 starts)", async () => {
    fixtures.workLocations = [{ name: "Boutique D" }];
    const within = date(2);

    // Template A: 5 started, 2 completed → 40% (LOW)
    // Template B: 4 started, 4 completed → 100% (healthy)
    // Template C: 2 started, 0 completed → below threshold of 3 starts
    fixtures.sopExecutions = [
      ...Array.from({ length: 5 }, (_, i) => ({
        id: `a${i}`, templateId: "tplA", status: i < 2 ? "completed" : "started",
        employeeId: `emp-${i % 2}`, startedAt: within, completedAt: i < 2 ? within : null,
      })),
      ...Array.from({ length: 4 }, (_, i) => ({
        id: `b${i}`, templateId: "tplB", status: "completed",
        employeeId: `emp-${i % 2}`, startedAt: within, completedAt: within,
      })),
      ...Array.from({ length: 2 }, (_, i) => ({
        id: `c${i}`, templateId: "tplC", status: "started",
        employeeId: "emp-3", startedAt: within, completedAt: null,
      })),
    ];
    fixtures.sopTemplates = [
      { id: "tplA", title: "Open store" },
      { id: "tplB", title: "Close register" },
      { id: "tplC", title: "Restock backroom" },
    ];

    const agg = await aggregateOperations(STORE_ID);

    expect(agg.sops.totalExecutions).toBe(11);
    expect(agg.sops.completed).toBe(6); // 2 from A + 4 from B
    expect(agg.sops.completionRate).toBeCloseTo(6 / 11, 4);

    // Only tplA qualifies as a low-completion top template:
    //   tplA: 5 starts >=3 AND rate 0.4 < 0.7 ✓
    //   tplB: 4 starts >=3 BUT rate 1.0 >= 0.7 → excluded
    //   tplC: 2 starts < 3 → excluded
    expect(agg.sops.topIncompleteTemplates).toHaveLength(1);
    expect(agg.sops.topIncompleteTemplates[0]).toMatchObject({
      templateId: "tplA",
      title: "Open store",
      started: 5,
      completed: 2,
    });
    expect(agg.sops.topIncompleteTemplates[0].rate).toBeCloseTo(0.4, 5);
  });

  it("loads recently dismissed insights into feedbackContext with their dismiss reason", async () => {
    fixtures.workLocations = [{ name: "Boutique E" }];
    fixtures.opInsightsSequence = [
      // dismissed
      [
        {
          insightType: "scheduling",
          observation: "Saturdays are understaffed",
          dismissReason: "We hired a Saturday floater last week",
          dismissedAt: new Date(NOW - 2 * 86400000),
        },
        {
          insightType: "task_completion",
          observation: "Restock tasks pile up on Tuesdays",
          dismissReason: null,
          dismissedAt: new Date(NOW - 5 * 86400000),
        },
      ],
      // acted_on
      [
        {
          insightType: "issue_trend",
          observation: "POS reboots recurring",
          actedOnAt: new Date(NOW - 3 * 86400000),
        },
      ],
    ];

    const agg = await aggregateOperations(STORE_ID);

    expect(agg.feedbackContext.recentDismissals).toHaveLength(2);
    expect(agg.feedbackContext.recentDismissals[0]).toMatchObject({
      insightType: "scheduling",
      observation: "Saturdays are understaffed",
      dismissReason: "We hired a Saturday floater last week",
    });
    // daysAgo computed from dismissedAt
    expect(agg.feedbackContext.recentDismissals[0].daysAgo).toBe(2);
    expect(agg.feedbackContext.recentDismissals[1].dismissReason).toBeNull();

    expect(agg.feedbackContext.recentActedOn).toHaveLength(1);
    expect(agg.feedbackContext.recentActedOn[0]).toMatchObject({
      insightType: "issue_trend",
      observation: "POS reboots recurring",
      daysAgo: 3,
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// summarizeForAI() — dismiss reasons must be surfaced in the prompt summary
// so Claude has feedback context on its next call.
// ─────────────────────────────────────────────────────────────────────────────

describe("summarizeForAI() — dismiss-reason feedback context", () => {
  function emptyAgg(overrides: any = {}): any {
    return {
      storeId: STORE_ID,
      storeName: "Boutique F",
      window: {
        start: new Date("2025-01-01T00:00:00.000Z"),
        end: new Date("2025-01-15T00:00:00.000Z"),
        label: "test window",
      },
      schedules: { total: 0, byDayOfWeek: {}, coverageGaps: [],
        totalHoursScheduled: 0, actualHoursWorked: 0, coverageRatio: 0 },
      tasks: { total: 0, completed: 0, cancelled: 0, pending: 0, overdueCount: 0,
        completionRate: 0, avgDaysToComplete: null, pendingOver3Days: [],
        byAssignee: [], byPriority: {}, recurringTasksWithLowCompletion: [] },
      issues: { total: 0, open: 0, resolved: 0, avgResolutionHours: null,
        byCategory: {}, recurringCategories: [], unresolvedAgingDays: [], highPriorityOpen: 0 },
      sops: { totalExecutions: 0, completed: 0, completionRate: 0, topIncompleteTemplates: [] },
      attendance: { totalShifts: 0, actualClockIns: 0, noShowEstimate: 0, avgShiftHours: null },
      team: { punctuality: [], sopMastery: [], kudosParticipation: [], quietPerformers: [] },
      feedbackContext: { recentDismissals: [], recentActedOn: [] },
      ...overrides,
    };
  }

  it("includes the dismiss reason text in the summary string", () => {
    const agg = emptyAgg({
      feedbackContext: {
        recentDismissals: [
          {
            insightType: "scheduling",
            observation: "Saturdays are understaffed",
            dismissReason: "We hired a Saturday floater last week",
            daysAgo: 2,
          },
        ],
        recentActedOn: [],
      },
    });

    const text = summarizeForAI(agg);

    expect(text).toContain("TEAM FEEDBACK SIGNAL");
    expect(text).toContain("Saturdays are understaffed");
    expect(text).toContain("reason: We hired a Saturday floater last week");
    expect(text).toContain("[2d ago, scheduling]");
  });

  it("renders an empty-state line when there are no recent dismissals", () => {
    const text = summarizeForAI(emptyAgg());
    expect(text).toContain("(no recent dismissals)");
    expect(text).toContain("(no recent acted-on insights)");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ROUTE TESTS — POST /api/insights/operational/:id/dismiss + /act-on
// ─────────────────────────────────────────────────────────────────────────────

const MANAGER_ID = "mgr-1";
const MGR_STORE_ID = "store-mine";
const OTHER_STORE_ID = "store-other";

const managerPermissions = [{ name: "manager.view_reports" }];

function makeStorage() {
  return {
    getUserPermissions: vi.fn().mockResolvedValue(managerPermissions),
  } as any;
}

function buildApp() {
  // Defer imports so the mocks above are honoured.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return import("express").then(async (mod) => {
    const express = mod.default;
    const { registerOperationalInsightRoutes } = await import("../server/routes/operationalInsights");
    const { globalErrorHandler } = await import("../server/lib/routeWrapper");

    const app = express();
    app.use(express.json());

    const isAuthenticated = (req: any, _res: any, next: any) => {
      req.user = { id: MANAGER_ID };
      next();
    };

    registerOperationalInsightRoutes(app, makeStorage(), isAuthenticated);
    app.use(globalErrorHandler);
    return app;
  });
}

function request(
  port: number,
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const payload = body !== undefined ? JSON.stringify(body) : undefined;
    const req = http.request(
      {
        hostname: "127.0.0.1",
        port,
        path,
        method,
        headers: payload
          ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload) }
          : {},
      },
      (res) => {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => {
          try { resolve({ status: res.statusCode ?? 0, body: JSON.parse(data) }); }
          catch { resolve({ status: res.statusCode ?? 0, body: data }); }
        });
      },
    );
    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function withServer<T>(fn: (port: number) => Promise<T>): Promise<T> {
  const app = await buildApp();
  const server = http.createServer(app);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const { port } = server.address() as AddressInfo;
  try {
    return await fn(port);
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }
}

describe("POST /api/insights/operational/:id/dismiss", () => {
  it("transitions an insight to 'dismissed', writes dismissReason + actor + timestamp", async () => {
    storeResolverMock.tryResolveStoreIdForUser.mockResolvedValue(MGR_STORE_ID);
    // Initial fetch returns the insight in the user's own store.
    fixtures.opInsightsSequence = [[
      { id: "ins-1", storeId: MGR_STORE_ID, status: "active",
        insightType: "task_completion", observation: "Restock pending" },
    ]];
    writeCapture.updateReturned = [{
      id: "ins-1", storeId: MGR_STORE_ID, status: "dismissed",
      dismissReason: "Already handled today",
      dismissedBy: MANAGER_ID,
    }];

    const res = await withServer((port) =>
      request(port, "POST", "/api/insights/operational/ins-1/dismiss",
        { reason: "Already handled today" }),
    );

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.status).toBe("dismissed");

    // We updated the operationalInsights table with the right values.
    expect(writeCapture.updateTable).toBe(operationalInsights);
    expect(writeCapture.updateSet).toMatchObject({
      status: "dismissed",
      dismissedBy: MANAGER_ID,
      dismissReason: "Already handled today",
    });
    expect(writeCapture.updateSet.dismissedAt).toBeInstanceOf(Date);

    // Cache for the summary endpoint must be invalidated so the next read is fresh.
    expect(cacheMock.cache.invalidatePrefix).toHaveBeenCalledWith("op-insights-summary:");
  });

  it("persists null dismissReason when no reason is provided", async () => {
    storeResolverMock.tryResolveStoreIdForUser.mockResolvedValue(MGR_STORE_ID);
    fixtures.opInsightsSequence = [[
      { id: "ins-2", storeId: MGR_STORE_ID, status: "active",
        insightType: "scheduling", observation: "Saturday gap" },
    ]];
    writeCapture.updateReturned = [{ id: "ins-2", status: "dismissed" }];

    const res = await withServer((port) =>
      request(port, "POST", "/api/insights/operational/ins-2/dismiss", {}),
    );

    expect(res.status).toBe(200);
    expect(writeCapture.updateSet).toMatchObject({
      status: "dismissed",
      dismissReason: null,
    });
  });

  it("returns 403 when the insight belongs to a different store than the caller", async () => {
    storeResolverMock.tryResolveStoreIdForUser.mockResolvedValue(MGR_STORE_ID);
    fixtures.opInsightsSequence = [[
      { id: "ins-3", storeId: OTHER_STORE_ID, status: "active",
        insightType: "issue_trend", observation: "Other store issue" },
    ]];

    const res = await withServer((port) =>
      request(port, "POST", "/api/insights/operational/ins-3/dismiss",
        { reason: "spoofed" }),
    );

    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({
      success: false,
      error: { code: "FORBIDDEN" },
    });
    // CRITICAL: never wrote to the DB.
    expect(dbMock.update).not.toHaveBeenCalled();
  });

  it("returns 404 when the insight id does not exist", async () => {
    storeResolverMock.tryResolveStoreIdForUser.mockResolvedValue(MGR_STORE_ID);
    fixtures.opInsightsSequence = [[]]; // empty fetch

    const res = await withServer((port) =>
      request(port, "POST", "/api/insights/operational/missing/dismiss"),
    );

    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({
      success: false,
      error: { code: "NOT_FOUND" },
    });
    expect(dbMock.update).not.toHaveBeenCalled();
  });
});

describe("POST /api/insights/operational/:id/act-on", () => {
  it("creates a linked task, transitions insight to 'acted_on', and stores the task id", async () => {
    storeResolverMock.tryResolveStoreIdForUser.mockResolvedValue(MGR_STORE_ID);
    fixtures.opInsightsSequence = [[
      {
        id: "ins-9",
        storeId: MGR_STORE_ID,
        status: "active",
        insightType: "task_completion",
        affectedArea: "tasks",
        observation: "3 restock tasks pending >7 days",
        recommendedAction: "Reassign to morning shift",
      },
    ]];
    writeCapture.insertReturned = [{ id: "task-new-1", title: "do the thing" }];
    writeCapture.updateReturned = [{
      id: "ins-9", storeId: MGR_STORE_ID, status: "acted_on",
      linkedTaskId: "task-new-1",
    }];

    const res = await withServer((port) =>
      request(port, "POST", "/api/insights/operational/ins-9/act-on", {
        taskTitle: "Reassign restock to AM shift",
        priority: "high",
        assignedTo: "user-amshift",
      }),
    );

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    // Task creation: location must come from the insight's storeId, isAIAssigned true.
    expect(writeCapture.insertTable).toBe(tasksTable);
    expect(writeCapture.insertValues).toMatchObject({
      title: "Reassign restock to AM shift",
      locationId: MGR_STORE_ID,
      assignedTo: "user-amshift",
      createdBy: MANAGER_ID,
      isAIAssigned: true,
      status: "pending",
      priority: "high",
    });

    // Insight update: acted_on with linkedTaskId pointing to the new task.
    expect(writeCapture.updateTable).toBe(operationalInsights);
    expect(writeCapture.updateSet).toMatchObject({
      status: "acted_on",
      actedOnBy: MANAGER_ID,
      linkedTaskId: "task-new-1",
    });
    expect(writeCapture.updateSet.actedOnAt).toBeInstanceOf(Date);

    expect(res.body.data.task.id).toBe("task-new-1");
    expect(res.body.data.insight.status).toBe("acted_on");

    expect(cacheMock.cache.invalidatePrefix).toHaveBeenCalledWith("op-insights-summary:");
  });

  it("falls back to a derived title and description when none are supplied", async () => {
    storeResolverMock.tryResolveStoreIdForUser.mockResolvedValue(MGR_STORE_ID);
    const observation = "Cleaning issues recurring 4 times in 2 weeks";
    fixtures.opInsightsSequence = [[
      {
        id: "ins-10",
        storeId: MGR_STORE_ID,
        status: "active",
        insightType: "issue_trend",
        affectedArea: "issues",
        observation,
        recommendedAction: "Add a mid-day cleaning checklist",
      },
    ]];
    writeCapture.insertReturned = [{ id: "task-derived-1" }];
    writeCapture.updateReturned = [{ id: "ins-10", status: "acted_on" }];

    const res = await withServer((port) =>
      request(port, "POST", "/api/insights/operational/ins-10/act-on", {}),
    );

    expect(res.status).toBe(200);
    expect(writeCapture.insertValues.title).toBe(`[AI Insight] ${observation.slice(0, 80)}`);
    expect(writeCapture.insertValues.description).toContain("Add a mid-day cleaning checklist");
    expect(writeCapture.insertValues.description).toContain(observation);
    expect(writeCapture.insertValues.priority).toBe("medium"); // default
  });

  it("returns 403 (and does NOT create a task) when the insight is in another store", async () => {
    storeResolverMock.tryResolveStoreIdForUser.mockResolvedValue(MGR_STORE_ID);
    fixtures.opInsightsSequence = [[
      {
        id: "ins-cross",
        storeId: OTHER_STORE_ID,
        status: "active",
        insightType: "scheduling",
        observation: "Cross-store insight",
        recommendedAction: "should never run",
      },
    ]];

    const res = await withServer((port) =>
      request(port, "POST", "/api/insights/operational/ins-cross/act-on",
        { taskTitle: "spoofed" }),
    );

    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({
      success: false,
      error: { code: "FORBIDDEN" },
    });
    // No task created and no insight update.
    expect(dbMock.insert).not.toHaveBeenCalled();
    expect(dbMock.update).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// End-to-end verification: a dismissed reason persisted via the route ends up
// in the next aggregator's summary. This ties the two halves of the task
// together — if the dismiss endpoint stops writing dismissReason, OR if the
// aggregator stops loading it, this test breaks.
// ─────────────────────────────────────────────────────────────────────────────

describe("dismissed reasons are surfaced in the next aggregator summary", () => {
  it("a dismissReason persisted by the dismiss endpoint flows into summarizeForAI", async () => {
    storeResolverMock.tryResolveStoreIdForUser.mockResolvedValue(MGR_STORE_ID);

    // 1) Run the dismiss endpoint with a real reason.
    fixtures.opInsightsSequence = [[
      { id: "ins-flow", storeId: MGR_STORE_ID, status: "active",
        insightType: "scheduling", observation: "Sundays understaffed" },
    ]];
    const writtenAt = new Date(NOW - 1 * 86400000);
    writeCapture.updateReturned = [{
      id: "ins-flow", storeId: MGR_STORE_ID, status: "dismissed",
      dismissReason: "Sundays now closed for inventory",
      dismissedAt: writtenAt,
    }];
    const dismissRes = await withServer((port) =>
      request(port, "POST", "/api/insights/operational/ins-flow/dismiss",
        { reason: "Sundays now closed for inventory" }),
    );
    expect(dismissRes.status).toBe(200);
    const persistedReason = writeCapture.updateSet.dismissReason as string;
    expect(persistedReason).toBe("Sundays now closed for inventory");

    // 2) Now reset write captures and seed the next aggregator pass with the
    //    dismissed row exactly as the route just wrote it.
    fixtures.workLocations = [{ name: "Boutique G" }];
    fixtures.opInsightsSequence = [
      [
        {
          insightType: "scheduling",
          observation: "Sundays understaffed",
          dismissReason: persistedReason,
          dismissedAt: writtenAt,
        },
      ],
      [], // no acted_on
    ];
    opInsightsCallIdx = 0; // reset sequence pointer for the new aggregator run

    const agg = await aggregateOperations(MGR_STORE_ID);
    const summary = summarizeForAI(agg);

    expect(summary).toContain("Sundays understaffed");
    expect(summary).toContain("reason: Sundays now closed for inventory");
  });
});
