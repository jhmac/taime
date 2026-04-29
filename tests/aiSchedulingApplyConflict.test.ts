/**
 * Unit tests for POST /api/ai-scheduling/apply — server-side conflict guard
 * (Task #328).
 *
 * The CreateShiftSplitPanel runs an in-memory overlap check against whatever
 * `/api/schedules` happens to be cached at the moment Save is clicked. If the
 * cache is stale (or simply hasn't loaded yet) that check can let an
 * overlapping shift slip through. The fix is a server-side guard inside the
 * apply handler that re-runs the overlap predicate against the live
 * `schedules` table and refuses to insert anything that would put the same
 * employee on two overlapping shifts at once.
 *
 * These tests verify:
 *  1. An exact-duplicate shift is silently skipped (existing behavior preserved).
 *  2. A different-time but overlapping shift is reported in `skipped[]` with
 *     a structured `{ employeeId, date, startTime, endTime, reason, ... }` shape
 *     and is NOT passed to `storage.createSchedulesBatch`.
 *  3. A non-overlapping shift on the same day for the same employee is allowed
 *     through (we do NOT block split shifts).
 *  4. The mix case — one valid + one duplicate + one conflict — produces the
 *     correct partial response.
 */

import { vi, describe, it, expect, beforeEach } from "vitest";
import type { AddressInfo } from "net";
import http from "http";
import express from "express";

// ── Hoist mocks ─────────────────────────────────────────────────────────────

const dbMock = vi.hoisted(() => ({
  select: vi.fn(),
  update: vi.fn(),
  insert: vi.fn(),
  execute: vi.fn(),
}));

vi.mock("../server/db", () => ({ db: dbMock }));
vi.mock("../server/lib/storeResolver", () => ({
  tryResolveStoreIdForUser: vi.fn().mockResolvedValue("store-xyz"),
}));
vi.mock("../server/lib/permissionUtils", () => ({
  getAllStoreUserIds: vi.fn().mockResolvedValue(["emp-A", "emp-B", "emp-C"]),
}));
vi.mock("../server/lib/broadcastRecipients", () => ({
  computeScheduleStoreRecipients: vi.fn().mockResolvedValue([]),
}));
vi.mock("../server/lib/logger", () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock("@clerk/express", () => ({
  clerkClient: { users: { getUser: vi.fn() } },
  clerkMiddleware: () => (_req: unknown, _res: unknown, next: () => void) => next(),
  requireAuth: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));

// ── Helpers ──────────────────────────────────────────────────────────────────

import { registerAiSchedulingRoutes } from "../server/routes/aiScheduling";

interface ExistingShiftRow {
  userId: string;
  startTime: Date;
  endTime: Date;
  locationId: string | null;
}

/**
 * Wires the dbMock so the apply handler's chain calls resolve in order:
 *   1. select(workLocations).from().where().limit() → [{ timezone }]
 *   2. select(schedules overlap window).from().where()             → existingShifts
 * The route uses `await db.select({...}).from(...).where(...)` — the whole
 * chain is a thenable resolved by the final `.where(...)` for the schedule
 * lookup, and resolved by `.limit(1)` for the timezone lookup.
 */
function wireDbForApply(opts: {
  storeTimezone?: string;
  existingShifts: ExistingShiftRow[];
}) {
  const { storeTimezone = "UTC", existingShifts } = opts;

  // First select: workLocations timezone lookup → resolves at .limit(1).
  const tzChain: any = {};
  tzChain.from = vi.fn().mockReturnValue(tzChain);
  tzChain.where = vi.fn().mockReturnValue(tzChain);
  tzChain.limit = vi.fn().mockResolvedValue([{ timezone: storeTimezone }]);

  // Second select: schedules overlap window → resolves at .where(...).
  const schedChain: any = {};
  schedChain.from = vi.fn().mockReturnValue(schedChain);
  schedChain.where = vi.fn().mockResolvedValue(existingShifts);

  dbMock.select.mockReset();
  dbMock.select.mockReturnValueOnce(tzChain).mockReturnValueOnce(schedChain);
}

function buildApp(opts: {
  isAdmin: boolean;
  storage: any;
  sendToUsers?: ReturnType<typeof vi.fn>;
}) {
  const app = express();
  app.use(express.json());

  const isAuthenticated = (req: any, _res: any, next: () => void) => {
    req.user = { id: "manager-1", role: { name: opts.isAdmin ? "admin" : "associate" } };
    next();
  };

  registerAiSchedulingRoutes(app, opts.storage, isAuthenticated, opts.sendToUsers ?? vi.fn());
  return app;
}

function startServer(app: express.Express): Promise<{ server: http.Server; base: string }> {
  return new Promise((resolve) => {
    const server = http.createServer(app);
    server.listen(0, "127.0.0.1", () => {
      const port = (server.address() as AddressInfo).port;
      resolve({ server, base: `http://127.0.0.1:${port}` });
    });
  });
}

function stopServer(server: http.Server): Promise<void> {
  return new Promise((resolve) => server.close(() => resolve()));
}

async function postApply(base: string, body: unknown) {
  const res = await fetch(`${base}/api/ai-scheduling/apply`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as any };
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("POST /api/ai-scheduling/apply — server-side conflict guard (Task #328)", () => {
  let storage: any;

  beforeEach(() => {
    dbMock.select.mockReset();
    dbMock.update.mockReset();
    dbMock.insert.mockReset();
    storage = {
      getUserPermissions: vi.fn().mockResolvedValue([{ name: "schedule.create" }]),
      // Echo back the rows that were "inserted" so the response includes
      // a stable `created` array for the bulk-undo toast.
      createSchedulesBatch: vi
        .fn()
        .mockImplementation((rows: any[]) =>
          Promise.resolve(rows.map((r, i) => ({ id: `new-${i}`, ...r })))
        ),
    };
  });

  it("silently skips an exact-duplicate shift (no conflict reported)", async () => {
    // Existing shift is exactly 09:00–17:00 UTC for emp-A.
    wireDbForApply({
      storeTimezone: "UTC",
      existingShifts: [
        {
          userId: "emp-A",
          startTime: new Date("2026-04-29T09:00:00Z"),
          endTime: new Date("2026-04-29T17:00:00Z"),
          locationId: "store-xyz",
        },
      ],
    });

    const app = buildApp({ isAdmin: true, storage });
    const { server, base } = await startServer(app);
    try {
      const { status, body } = await postApply(base, {
        scheduleEntries: [
          { employeeId: "emp-A", date: "2026-04-29", startTime: "09:00", endTime: "17:00" },
        ],
      });
      expect(status).toBe(200);
      expect(body.success).toBe(true);
      expect(body.schedulesCreated).toBe(0);
      expect(body.skipped).toEqual([]);
      expect(storage.createSchedulesBatch).not.toHaveBeenCalled();
    } finally {
      await stopServer(server);
    }
  });

  it("reports a different-time overlapping shift in skipped[] and does NOT insert it", async () => {
    // Existing shift covers 09:00–13:00 UTC. A new 11:00–15:00 shift overlaps.
    wireDbForApply({
      storeTimezone: "UTC",
      existingShifts: [
        {
          userId: "emp-A",
          startTime: new Date("2026-04-29T09:00:00Z"),
          endTime: new Date("2026-04-29T13:00:00Z"),
          locationId: "store-xyz",
        },
      ],
    });

    const app = buildApp({ isAdmin: true, storage });
    const { server, base } = await startServer(app);
    try {
      const { status, body } = await postApply(base, {
        scheduleEntries: [
          { employeeId: "emp-A", date: "2026-04-29", startTime: "11:00", endTime: "15:00" },
        ],
      });
      expect(status).toBe(200);
      expect(body.schedulesCreated).toBe(0);
      expect(Array.isArray(body.skipped)).toBe(true);
      expect(body.skipped).toHaveLength(1);
      const s = body.skipped[0];
      expect(s.employeeId).toBe("emp-A");
      expect(s.date).toBe("2026-04-29");
      expect(s.startTime).toBe("11:00");
      expect(s.endTime).toBe("15:00");
      expect(s.reason).toBe("overlaps_existing_schedule");
      expect(s.existingStart).toBe("2026-04-29T09:00:00.000Z");
      expect(s.existingEnd).toBe("2026-04-29T13:00:00.000Z");
      expect(storage.createSchedulesBatch).not.toHaveBeenCalled();
    } finally {
      await stopServer(server);
    }
  });

  it("allows a non-overlapping split shift on the same day for the same employee", async () => {
    // Existing 09:00–13:00. New 14:00–18:00 does NOT overlap.
    wireDbForApply({
      storeTimezone: "UTC",
      existingShifts: [
        {
          userId: "emp-A",
          startTime: new Date("2026-04-29T09:00:00Z"),
          endTime: new Date("2026-04-29T13:00:00Z"),
          locationId: "store-xyz",
        },
      ],
    });

    const app = buildApp({ isAdmin: true, storage });
    const { server, base } = await startServer(app);
    try {
      const { status, body } = await postApply(base, {
        scheduleEntries: [
          { employeeId: "emp-A", date: "2026-04-29", startTime: "14:00", endTime: "18:00" },
        ],
      });
      expect(status).toBe(200);
      expect(body.schedulesCreated).toBe(1);
      expect(body.skipped).toEqual([]);
      expect(storage.createSchedulesBatch).toHaveBeenCalledTimes(1);
      const insertedRows = storage.createSchedulesBatch.mock.calls[0][0];
      expect(insertedRows).toHaveLength(1);
      expect(insertedRows[0].userId).toBe("emp-A");
      // The inserted row should NOT carry the helper _orig* fields the
      // handler uses internally for skip reporting — they're stripped before
      // hitting storage.
      expect(insertedRows[0]).not.toHaveProperty("_origDate");
      expect(insertedRows[0]).not.toHaveProperty("_origStartTime");
      expect(insertedRows[0]).not.toHaveProperty("_origEndTime");
    } finally {
      await stopServer(server);
    }
  });

  // ── Task #432: DB-level race-conflict fallback ────────────────────────────
  //
  // The DB now carries a `schedules_no_overlap_per_user` EXCLUDE constraint
  // (Task #432). If a concurrent request slips a colliding row in between
  // our app-level overlap SELECT and our INSERT, Postgres rejects the
  // batch insert with code 23P01. The apply route catches that, falls back
  // to per-row inserts, and surfaces the rejected rows in the SAME
  // `skipped[]` shape the app-level guard already produces — so the
  // frontend doesn't need to know the difference.
  //
  // These tests lock in the fallback behavior:
  //   - 23P01 on the batch → falls back to per-row, valid rows persist,
  //     rejected rows go to skipped[] with reason 'overlaps_existing_schedule'.
  //   - 23P01 on every per-row insert → schedulesCreated=0, all in skipped[].
  //   - non-23P01 errors are NOT swallowed (they propagate to the caller).
  it("falls back to per-row inserts when the batch hits a 23P01 race conflict", async () => {
    // App-level overlap check returns no existing rows — both entries pass.
    // Then the batch insert raises 23P01, simulating a concurrent insert
    // that landed AFTER our SELECT but BEFORE our INSERT for ONLY the
    // second entry. Per-row fallback should persist row 0 and skip row 1.
    wireDbForApply({ storeTimezone: "UTC", existingShifts: [] });

    const raceErr: any = new Error("conflicting key value violates exclusion constraint");
    raceErr.code = "23P01";

    storage.createSchedulesBatch = vi
      .fn()
      // 1st call: the BATCH attempt with both rows → reject with 23P01
      .mockRejectedValueOnce(raceErr)
      // 2nd call: per-row retry of row 0 → succeed
      .mockImplementationOnce((rows: any[]) =>
        Promise.resolve(rows.map((r, i) => ({ id: `new-row0-${i}`, ...r })))
      )
      // 3rd call: per-row retry of row 1 → reject with 23P01 (the racing collision)
      .mockRejectedValueOnce(raceErr);

    const app = buildApp({ isAdmin: true, storage });
    const { server, base } = await startServer(app);
    try {
      const { status, body } = await postApply(base, {
        scheduleEntries: [
          { employeeId: "emp-A", date: "2026-04-29", startTime: "09:00", endTime: "12:00" },
          { employeeId: "emp-B", date: "2026-04-29", startTime: "13:00", endTime: "17:00" },
        ],
      });
      expect(status).toBe(200);
      // Row 0 persisted; row 1 raced and got skipped.
      expect(body.schedulesCreated).toBe(1);
      expect(body.skipped).toHaveLength(1);
      expect(body.skipped[0]).toMatchObject({
        employeeId: "emp-B",
        date: "2026-04-29",
        startTime: "13:00",
        endTime: "17:00",
        reason: "overlaps_existing_schedule",
        // Race-detected conflicts can't echo the existing window because
        // the DB constraint doesn't tell us which row collided. Empty
        // strings flag this case for the frontend.
        existingStart: "",
        existingEnd: "",
      });
      // Batch attempted once, then per-row retries for each of the 2 rows.
      expect(storage.createSchedulesBatch).toHaveBeenCalledTimes(3);
    } finally {
      await stopServer(server);
    }
  });

  it("reports ALL rows as skipped when every per-row retry hits 23P01", async () => {
    wireDbForApply({ storeTimezone: "UTC", existingShifts: [] });

    const raceErr: any = new Error("exclusion constraint");
    raceErr.code = "23P01";

    storage.createSchedulesBatch = vi
      .fn()
      // Batch fails, then EVERY per-row retry also fails.
      .mockRejectedValueOnce(raceErr)
      .mockRejectedValueOnce(raceErr)
      .mockRejectedValueOnce(raceErr);

    const app = buildApp({ isAdmin: true, storage });
    const { server, base } = await startServer(app);
    try {
      const { status, body } = await postApply(base, {
        scheduleEntries: [
          { employeeId: "emp-A", date: "2026-04-29", startTime: "09:00", endTime: "12:00" },
          { employeeId: "emp-B", date: "2026-04-29", startTime: "13:00", endTime: "17:00" },
        ],
      });
      expect(status).toBe(200);
      expect(body.schedulesCreated).toBe(0);
      expect(body.skipped).toHaveLength(2);
      expect(body.skipped[0].reason).toBe("overlaps_existing_schedule");
      expect(body.skipped[1].reason).toBe("overlaps_existing_schedule");
      // Batch (1) + per-row retries for both entries (2) = 3 total calls.
      expect(storage.createSchedulesBatch).toHaveBeenCalledTimes(3);
    } finally {
      await stopServer(server);
    }
  });

  it("does NOT swallow non-23P01 batch errors (other DB errors must propagate)", async () => {
    wireDbForApply({ storeTimezone: "UTC", existingShifts: [] });

    // A non-exclusion error — e.g. a unique-violation (23505) or an FK
    // problem — should NOT trigger the per-row fallback. The handler
    // must let it bubble up to the express error path so the request
    // fails loudly instead of silently returning success with no data.
    const otherErr: any = new Error("foreign key violation");
    otherErr.code = "23503";

    storage.createSchedulesBatch = vi.fn().mockRejectedValueOnce(otherErr);

    const app = buildApp({ isAdmin: true, storage });
    const { server, base } = await startServer(app);
    try {
      const { status } = await postApply(base, {
        scheduleEntries: [
          { employeeId: "emp-A", date: "2026-04-29", startTime: "09:00", endTime: "12:00" },
        ],
      });
      // Express's default error handler responds with 500 for unhandled
      // throws inside the route. The exact body shape isn't important —
      // the key invariant is that we did NOT call createSchedulesBatch
      // a second time (no per-row fallback was triggered).
      expect(status).toBe(500);
      expect(storage.createSchedulesBatch).toHaveBeenCalledTimes(1);
    } finally {
      await stopServer(server);
    }
  });

  it("partial-success: inserts the valid row and reports the conflicting one", async () => {
    // Existing shifts:
    //   emp-A 09:00–13:00 UTC (will collide with the 11:00–15:00 entry)
    //   emp-B 09:00–17:00 UTC (exact duplicate of one entry below)
    // We send THREE entries:
    //   1. emp-A 14:00–18:00 → valid (no overlap)
    //   2. emp-A 11:00–15:00 → conflict (overlaps existing 09–13)
    //   3. emp-B 09:00–17:00 → exact duplicate (silently skipped)
    wireDbForApply({
      storeTimezone: "UTC",
      existingShifts: [
        {
          userId: "emp-A",
          startTime: new Date("2026-04-29T09:00:00Z"),
          endTime: new Date("2026-04-29T13:00:00Z"),
          locationId: "store-xyz",
        },
        {
          userId: "emp-B",
          startTime: new Date("2026-04-29T09:00:00Z"),
          endTime: new Date("2026-04-29T17:00:00Z"),
          locationId: "store-xyz",
        },
      ],
    });

    const app = buildApp({ isAdmin: true, storage });
    const { server, base } = await startServer(app);
    try {
      const { status, body } = await postApply(base, {
        scheduleEntries: [
          { employeeId: "emp-A", date: "2026-04-29", startTime: "14:00", endTime: "18:00" },
          { employeeId: "emp-A", date: "2026-04-29", startTime: "11:00", endTime: "15:00" },
          { employeeId: "emp-B", date: "2026-04-29", startTime: "09:00", endTime: "17:00" },
        ],
      });
      expect(status).toBe(200);
      expect(body.schedulesCreated).toBe(1);
      // Only the overlap conflict (not the exact dup) shows in skipped[].
      // Exact duplicates are part of the idempotent re-save flow and are
      // handled silently to avoid scary "skipped" toasts on every save.
      expect(body.skipped).toHaveLength(1);
      expect(body.skipped[0]).toMatchObject({
        employeeId: "emp-A",
        date: "2026-04-29",
        startTime: "11:00",
        endTime: "15:00",
        reason: "overlaps_existing_schedule",
      });
      expect(storage.createSchedulesBatch).toHaveBeenCalledTimes(1);
      const insertedRows = storage.createSchedulesBatch.mock.calls[0][0];
      expect(insertedRows).toHaveLength(1);
      expect(insertedRows[0].userId).toBe("emp-A");
      expect(insertedRows[0].startTime.toISOString()).toBe("2026-04-29T14:00:00.000Z");
    } finally {
      await stopServer(server);
    }
  });
});
