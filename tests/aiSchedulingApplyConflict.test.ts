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
