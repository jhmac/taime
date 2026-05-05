/**
 * Integration tests for GET /api/dashboard/today
 *
 * Verifies the clock-in status accuracy fixes introduced in Task #581:
 *  - Scheduled employees who have an active time entry show isClockedIn=true
 *  - Unscheduled employees with an active entry still appear in clockedIn[]
 *  - Account owner (or any user absent from the active-user cache) whose
 *    time entry is present appears with a real name, not "Unknown"
 *  - Overnight active entries (clockInTime < start of day) are included
 *  - No employee with clockOutTime set appears as active (no false positives)
 *  - clockedIn[] is deduplicated by userId even if multiple active rows exist
 *  - summary.totalClockedIn matches the deduplicated count
 */

import { vi, describe, it, expect, beforeEach } from "vitest";
import type { AddressInfo } from "net";
import http from "http";
import express from "express";

// ── Hoisted mocks ─────────────────────────────────────────────────────────────

const dbMock = vi.hoisted(() => ({
  select: vi.fn(),
  delete: vi.fn(),
}));

const cacheMock = vi.hoisted(() => ({
  cache: {
    get: vi.fn().mockReturnValue(undefined),
    set: vi.fn(),
  },
}));

vi.mock("../server/db", () => ({ db: dbMock }));
vi.mock("../server/services/cache", () => cacheMock);
vi.mock("../server/services/locationPermissionStore", () => ({
  setLocationPermission: vi.fn(),
}));
vi.mock("../server/lib/config", () => ({
  config: { server: { nodeEnv: "test", port: 5000 } },
}));
vi.mock("../server/lib/logger", () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock("../server/services/gamificationService", () => ({
  gamificationService: { computeUserScore: vi.fn() },
}));

// ── Imports (after mocks) ─────────────────────────────────────────────────────

import { registerDashboardRoutes } from "../server/routes/dashboard";
import {
  schedules,
  timeEntries,
  users,
  locationPermissions,
} from "@shared/schema";

// ── Fixtures ─────────────────────────────────────────────────────────────────

const TODAY = new Date();
TODAY.setHours(0, 0, 0, 0);

const START_OF_TODAY = new Date(TODAY);
const END_OF_TODAY = new Date(TODAY.getFullYear(), TODAY.getMonth(), TODAY.getDate(), 23, 59, 59, 999);
const YESTERDAY = new Date(TODAY.getTime() - 24 * 60 * 60 * 1000);

const USERS = {
  alice: { id: "user-alice", firstName: "Alice", lastName: "Smith", profileImageUrl: null },
  bob:   { id: "user-bob",   firstName: "Bob",   lastName: "Jones",  profileImageUrl: null },
  owner: { id: "user-owner", firstName: "Owner", lastName: "Person", profileImageUrl: null },
  carol: { id: "user-carol", firstName: "Carol", lastName: "Lee",    profileImageUrl: null },
};

function makeSchedule(userId: string, hoursFromNow = 1) {
  const start = new Date(Date.now() - 60 * 60 * 1000);
  const end   = new Date(Date.now() + hoursFromNow * 60 * 60 * 1000);
  return { id: `sched-${userId}`, userId, startTime: start, endTime: end, title: null };
}

function makeEntry(userId: string, opts: { active?: boolean; overnight?: boolean } = {}) {
  const clockInTime = opts.overnight ? YESTERDAY : new Date(Date.now() - 2 * 60 * 60 * 1000);
  return {
    id: `entry-${userId}`,
    userId,
    clockInTime,
    clockOutTime: opts.active === false ? new Date() : null,
    locationId: null,
  };
}

// ── DB mock wiring ────────────────────────────────────────────────────────────

interface TestFixtures {
  scheduleRows: any[];
  todayEntryRows: any[];
  overnightRows: any[];
  activeUserRows: any[];
  extraUserRows: any[];
  locationPermRows: any[];
}

function wireDbMock(f: TestFixtures) {
  let selectCallIdx = 0;

  const makeSelectChain = (rows: any[]) => ({
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue(Promise.resolve(rows)),
    }),
  });

  dbMock.select.mockImplementation(() => {
    const idx = selectCallIdx++;
    // Call order inside the route handler:
    // 0: todaySchedules  (schedules table)
    // 1: todayTimeEntries (timeEntries – gte startOfDay)
    // 2: overnightActiveEntries (timeEntries – isNull + lt)
    // 3: activeUser list (users where isActive=true) ← only if cache miss
    // 4: extra users (users where id in [missing]) ← only if any missing
    // 5: locationPermissions
    if (idx === 0) return makeSelectChain(f.scheduleRows);
    if (idx === 1) return makeSelectChain(f.todayEntryRows);
    if (idx === 2) return makeSelectChain(f.overnightRows);
    if (idx === 3) return makeSelectChain(f.activeUserRows);
    if (idx === 4) return makeSelectChain(f.extraUserRows);
    if (idx === 5) return makeSelectChain(f.locationPermRows);
    return makeSelectChain([]);
  });

  dbMock.delete.mockReturnValue({
    where: vi.fn().mockResolvedValue(undefined),
  });
}

// ── Test server helpers ───────────────────────────────────────────────────────

function buildTestServer(userId = "user-alice") {
  const app = express();
  app.use(express.json());

  const isAuthenticated = (req: any, _res: any, next: () => void) => {
    req.user = { id: userId };
    next();
  };

  const storageMock: any = {
    getUserWithRole: vi.fn(),
    getActiveTimeEntry: vi.fn().mockResolvedValue(null),
    getUserPermissions: vi.fn().mockResolvedValue([]),
    getCompanySettings: vi.fn().mockResolvedValue(null),
  };

  registerDashboardRoutes(app, storageMock, isAuthenticated);

  return new Promise<{ port: number; close: () => Promise<void> }>((resolve) => {
    const server = http.createServer(app).listen(0, () => {
      const port = (server.address() as AddressInfo).port;
      resolve({
        port,
        close: () => new Promise(r => server.close(r)),
      });
    });
  });
}

async function getToday(port: number) {
  const res = await fetch(`http://localhost:${port}/api/dashboard/today`);
  return res.json() as Promise<{
    schedules: { userId: string; isClockedIn: boolean; userName: string }[];
    clockedIn: { userId: string; userName: string }[];
    summary: { totalClockedIn: number; totalScheduled: number };
  }>;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("GET /api/dashboard/today — clock-in accuracy (Task #581)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    cacheMock.cache.get.mockReturnValue(undefined);
    cacheMock.cache.set.mockReturnValue(undefined);
  });

  it("marks scheduled employee as isClockedIn=true when they have an active entry", async () => {
    wireDbMock({
      scheduleRows: [makeSchedule(USERS.alice.id)],
      todayEntryRows: [makeEntry(USERS.alice.id, { active: true })],
      overnightRows: [],
      activeUserRows: [USERS.alice],
      extraUserRows: [],
      locationPermRows: [],
    });

    const { port, close } = await buildTestServer(USERS.alice.id);
    try {
      const data = await getToday(port);
      expect(data.schedules).toHaveLength(1);
      expect(data.schedules[0].isClockedIn).toBe(true);
      expect(data.clockedIn).toHaveLength(1);
      expect(data.clockedIn[0].userId).toBe(USERS.alice.id);
    } finally {
      await close();
    }
  });

  it("leaves isClockedIn=false when the employee is clocked out", async () => {
    wireDbMock({
      scheduleRows: [makeSchedule(USERS.alice.id)],
      todayEntryRows: [makeEntry(USERS.alice.id, { active: false })],
      overnightRows: [],
      activeUserRows: [USERS.alice],
      extraUserRows: [],
      locationPermRows: [],
    });

    const { port, close } = await buildTestServer(USERS.alice.id);
    try {
      const data = await getToday(port);
      expect(data.schedules[0].isClockedIn).toBe(false);
      expect(data.clockedIn).toHaveLength(0);
    } finally {
      await close();
    }
  });

  it("includes an unscheduled employee who is actively clocked in", async () => {
    wireDbMock({
      scheduleRows: [makeSchedule(USERS.alice.id)],
      todayEntryRows: [
        makeEntry(USERS.alice.id, { active: true }),
        makeEntry(USERS.bob.id,   { active: true }),
      ],
      overnightRows: [],
      activeUserRows: [USERS.alice, USERS.bob],
      extraUserRows: [],
      locationPermRows: [],
    });

    const { port, close } = await buildTestServer(USERS.alice.id);
    try {
      const data = await getToday(port);
      expect(data.schedules).toHaveLength(1);
      expect(data.summary.totalClockedIn).toBe(2);
      const clockedIds = data.clockedIn.map(e => e.userId);
      expect(clockedIds).toContain(USERS.bob.id);
    } finally {
      await close();
    }
  });

  it("includes overnight active entry in clockedIn even when clockInTime < today", async () => {
    wireDbMock({
      scheduleRows: [],
      todayEntryRows: [],
      overnightRows: [makeEntry(USERS.carol.id, { active: true, overnight: true })],
      activeUserRows: [USERS.carol],
      extraUserRows: [],
      locationPermRows: [],
    });

    const { port, close } = await buildTestServer(USERS.carol.id);
    try {
      const data = await getToday(port);
      expect(data.summary.totalClockedIn).toBe(1);
      expect(data.clockedIn[0].userId).toBe(USERS.carol.id);
    } finally {
      await close();
    }
  });

  it("resolves real name for user missing from the active-user cache (e.g. owner)", async () => {
    wireDbMock({
      scheduleRows: [],
      todayEntryRows: [makeEntry(USERS.owner.id, { active: true })],
      overnightRows: [],
      activeUserRows: [],
      extraUserRows: [USERS.owner],
      locationPermRows: [],
    });

    const { port, close } = await buildTestServer(USERS.owner.id);
    try {
      const data = await getToday(port);
      expect(data.clockedIn).toHaveLength(1);
      expect(data.clockedIn[0].userName).toBe("Owner Person");
    } finally {
      await close();
    }
  });

  it("deduplicates clockedIn when the same user has two active entries", async () => {
    const entry1 = { ...makeEntry(USERS.alice.id, { active: true }), id: "entry-a1", clockInTime: new Date(Date.now() - 3 * 3600_000) };
    const entry2 = { ...makeEntry(USERS.alice.id, { active: true }), id: "entry-a2", clockInTime: new Date(Date.now() - 1 * 3600_000) };

    wireDbMock({
      scheduleRows: [makeSchedule(USERS.alice.id)],
      todayEntryRows: [entry1, entry2],
      overnightRows: [],
      activeUserRows: [USERS.alice],
      extraUserRows: [],
      locationPermRows: [],
    });

    const { port, close } = await buildTestServer(USERS.alice.id);
    try {
      const data = await getToday(port);
      expect(data.clockedIn).toHaveLength(1);
      expect(data.summary.totalClockedIn).toBe(1);
      expect(data.clockedIn[0].userId).toBe(USERS.alice.id);
    } finally {
      await close();
    }
  });

  it("does not count a clocked-out employee in totalClockedIn or clockedIn[]", async () => {
    wireDbMock({
      scheduleRows: [makeSchedule(USERS.alice.id)],
      todayEntryRows: [makeEntry(USERS.alice.id, { active: false })],
      overnightRows: [],
      activeUserRows: [USERS.alice],
      extraUserRows: [],
      locationPermRows: [],
    });

    const { port, close } = await buildTestServer(USERS.alice.id);
    try {
      const data = await getToday(port);
      expect(data.summary.totalClockedIn).toBe(0);
      expect(data.clockedIn).toHaveLength(0);
      expect(data.schedules[0].isClockedIn).toBe(false);
    } finally {
      await close();
    }
  });
});
