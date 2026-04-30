/**
 * Unit tests for DELETE /api/schedules/suggest/shift
 *
 * Verifies the new endpoint that the CreateShiftSplitPanel uses to remove an
 * AI-suggested shift from the cached suggestion when the user clicks the X
 * on a suggestion card.
 *
 * Covers:
 *  1. 403 when the requesting user is not a manager/admin
 *  2. 400 when required query params (date, startTime, endTime) are missing
 *  3. Returns { removed: 0 } when no cached suggestion exists for the date
 *  4. Filters the cached scheduleData.proposedShifts by employeeId+startTime+endTime
 *     and persists the trimmed array back via db.update
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
}));

vi.mock("../server/db", () => ({ db: dbMock }));
vi.mock("../server/services/storeResolver", () => ({
  tryResolveStoreIdForUser: vi.fn().mockResolvedValue("store-xyz"),
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

function buildApp(opts: { isAdmin: boolean }) {
  const app = express();
  app.use(express.json());

  const isAuthenticated = (req: any, _res: any, next: () => void) => {
    req.user = { id: "user-1", role: { name: opts.isAdmin ? "admin" : "associate" } };
    next();
  };

  const storage: any = {
    getUserPermissions: vi.fn().mockResolvedValue(
      opts.isAdmin ? [{ name: "schedule.create" }] : []
    ),
  };

  registerAiSchedulingRoutes(app, storage, isAuthenticated);
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

async function deleteSuggestShift(
  base: string,
  query: { date?: string; employeeId?: string; startTime?: string; endTime?: string }
) {
  const params = new URLSearchParams();
  Object.entries(query).forEach(([k, v]) => {
    if (v !== undefined) params.set(k, v);
  });
  const res = await fetch(`${base}/api/schedules/suggest/shift?${params.toString()}`, {
    method: "DELETE",
  });
  return { status: res.status, body: await res.json() };
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("DELETE /api/schedules/suggest/shift", () => {
  beforeEach(() => {
    dbMock.select.mockReset();
    dbMock.update.mockReset();
  });

  it("returns 403 when caller has no manager/admin permission", async () => {
    const app = buildApp({ isAdmin: false });
    const { server, base } = await startServer(app);
    try {
      const { status } = await deleteSuggestShift(base, {
        date: "2026-04-27",
        startTime: "09:00",
        endTime: "17:00",
      });
      expect(status).toBe(403);
    } finally {
      await stopServer(server);
    }
  });

  it("returns 400 when required params are missing", async () => {
    const app = buildApp({ isAdmin: true });
    const { server, base } = await startServer(app);
    try {
      const { status, body } = await deleteSuggestShift(base, { date: "2026-04-27" });
      expect(status).toBe(400);
      expect(body.message).toMatch(/required/i);
    } finally {
      await stopServer(server);
    }
  });

  it("returns removed=0 when no cached suggestion exists for that date", async () => {
    const app = buildApp({ isAdmin: true });
    const { server, base } = await startServer(app);

    // db.select().from().where().limit() → []
    const chain: any = {};
    chain.from = vi.fn().mockReturnValue(chain);
    chain.where = vi.fn().mockReturnValue(chain);
    chain.limit = vi.fn().mockResolvedValue([]);
    dbMock.select.mockReturnValue(chain);

    try {
      const { status, body } = await deleteSuggestShift(base, {
        date: "2026-04-27",
        startTime: "09:00",
        endTime: "17:00",
      });
      expect(status).toBe(200);
      expect(body.removed).toBe(0);
      expect(dbMock.update).not.toHaveBeenCalled();
    } finally {
      await stopServer(server);
    }
  });

  it("removes the matching shift by employeeId+startTime+endTime and persists the result", async () => {
    const app = buildApp({ isAdmin: true });
    const { server, base } = await startServer(app);

    const cachedRow = {
      scheduleData: {
        proposedShifts: [
          { employeeId: "emp-A", startTime: "09:00", endTime: "13:00" },
          { employeeId: "emp-B", startTime: "09:00", endTime: "17:00" }, // ← target
          { employeeId: "emp-C", startTime: "13:00", endTime: "21:00" },
        ],
      },
    };

    // First call: select cached row
    const selectChain: any = {};
    selectChain.from = vi.fn().mockReturnValue(selectChain);
    selectChain.where = vi.fn().mockReturnValue(selectChain);
    selectChain.limit = vi.fn().mockResolvedValue([cachedRow]);
    dbMock.select.mockReturnValue(selectChain);

    // db.update().set().where()
    const updateChain: any = {};
    updateChain.set = vi.fn().mockReturnValue(updateChain);
    updateChain.where = vi.fn().mockResolvedValue(undefined);
    dbMock.update.mockReturnValue(updateChain);

    try {
      const { status, body } = await deleteSuggestShift(base, {
        date: "2026-04-27",
        employeeId: "emp-B",
        startTime: "09:00",
        endTime: "17:00",
      });

      expect(status).toBe(200);
      expect(body.removed).toBe(1);
      expect(dbMock.update).toHaveBeenCalledTimes(1);

      // The set() call should receive scheduleData with the matching shift removed
      const setArg = updateChain.set.mock.calls[0][0];
      expect(setArg.scheduleData.proposedShifts).toHaveLength(2);
      expect(setArg.scheduleData.proposedShifts.find((s: any) => s.employeeId === "emp-B")).toBeUndefined();
      expect(setArg.scheduleData.proposedShifts.map((s: any) => s.employeeId)).toEqual(["emp-A", "emp-C"]);
    } finally {
      await stopServer(server);
    }
  });

  it("does not remove other shifts that share the same time but differ by employeeId", async () => {
    const app = buildApp({ isAdmin: true });
    const { server, base } = await startServer(app);

    const cachedRow = {
      scheduleData: {
        proposedShifts: [
          { employeeId: "emp-A", startTime: "09:00", endTime: "17:00" },
          { employeeId: "emp-B", startTime: "09:00", endTime: "17:00" },
        ],
      },
    };

    const selectChain: any = {};
    selectChain.from = vi.fn().mockReturnValue(selectChain);
    selectChain.where = vi.fn().mockReturnValue(selectChain);
    selectChain.limit = vi.fn().mockResolvedValue([cachedRow]);
    dbMock.select.mockReturnValue(selectChain);

    const updateChain: any = {};
    updateChain.set = vi.fn().mockReturnValue(updateChain);
    updateChain.where = vi.fn().mockResolvedValue(undefined);
    dbMock.update.mockReturnValue(updateChain);

    try {
      const { body } = await deleteSuggestShift(base, {
        date: "2026-04-27",
        employeeId: "emp-A",
        startTime: "09:00",
        endTime: "17:00",
      });

      expect(body.removed).toBe(1);
      const setArg = updateChain.set.mock.calls[0][0];
      expect(setArg.scheduleData.proposedShifts).toHaveLength(1);
      expect(setArg.scheduleData.proposedShifts[0].employeeId).toBe("emp-B");
    } finally {
      await stopServer(server);
    }
  });
});

// ── Pure logic test for the week-offset calculation in ScheduleManagement ────

describe("week-offset calculation for jumpToWeekContaining", () => {
  // Mirror of the logic in ScheduleManagement.jumpToWeekContaining so we can
  // verify it independently of React rendering. Whenever that function changes
  // this helper must be kept in sync.
  function weekOffsetFor(targetDateStr: string, today: Date): number {
    const target = new Date(targetDateStr + "T12:00:00");
    const today0 = new Date(today);
    today0.setHours(0, 0, 0, 0);
    const startOfThisWeek = new Date(today0);
    startOfThisWeek.setDate(today0.getDate() - today0.getDay());
    const startOfTargetWeek = new Date(target);
    startOfTargetWeek.setDate(target.getDate() - target.getDay());
    startOfTargetWeek.setHours(0, 0, 0, 0);
    return Math.round(
      (startOfTargetWeek.getTime() - startOfThisWeek.getTime()) /
        (7 * 24 * 60 * 60 * 1000)
    );
  }

  it("returns 0 for a date in the current week", () => {
    // Today: Sun Apr 26 2026; target: Wed Apr 29 2026 → same week
    const today = new Date(2026, 3, 26); // April is month index 3
    expect(weekOffsetFor("2026-04-29", today)).toBe(0);
  });

  it("returns +1 for a date in next week", () => {
    const today = new Date(2026, 3, 26); // Sun Apr 26 2026
    expect(weekOffsetFor("2026-05-04", today)).toBe(1); // Mon May 4 2026
  });

  it("returns -1 for a date in last week", () => {
    const today = new Date(2026, 3, 26); // Sun Apr 26 2026
    expect(weekOffsetFor("2026-04-22", today)).toBe(-1); // Wed Apr 22 2026
  });

  it("returns +2 for a date two weeks ahead crossing a month boundary", () => {
    const today = new Date(2026, 3, 26); // Sun Apr 26 2026
    expect(weekOffsetFor("2026-05-13", today)).toBe(2); // Wed May 13 2026
  });
});
