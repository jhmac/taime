/**
 * Integration tests for GET /api/team-status/upcoming-shifts
 *
 * Verifies the start-of-day window fix introduced in Task #621:
 *  - Shifts that started before now but today are still returned (employee absent/late)
 *  - minutesLate is positive when the shift start is in the past
 *  - minutesUntilShift is negative when the shift start is in the past
 *  - Employees who are currently clocked in are excluded even if their shift started
 *  - Only today's shifts are returned (companyId-scoped)
 *  - Returns an empty list when the requesting user has no companyId
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

vi.mock("../server/db", () => ({ db: dbMock }));
vi.mock("../server/services/cache", () => ({
  cache: { get: vi.fn().mockReturnValue(undefined), set: vi.fn() },
}));
vi.mock("../server/services/locationPermissionStore", () => ({
  setLocationPermission: vi.fn(),
  getLocationPermissionPreference: vi.fn().mockResolvedValue(null),
}));
vi.mock("../server/lib/config", () => ({
  config: {
    server: { nodeEnv: "test", port: 5000 },
    // emailService.ts reads config.nylas.* at module initialisation; the mock
    // must include the nylas subtree even when tests don't exercise email paths.
    nylas: { apiKey: "", grantId: "" },
  },
}));
vi.mock("../server/lib/logger", () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock("../server/services/gamificationService", () => ({
  gamificationService: { computeUserScore: vi.fn() },
}));
// claudeService instantiates Anthropic at module load using config.anthropic.apiKey;
// mock it so the config mock doesn't need to carry real AI credentials.
vi.mock("../server/services/claudeService", () => ({
  claudeService: {
    chat: vi.fn().mockResolvedValue(""),
    generateSchedule: vi.fn().mockResolvedValue({ shifts: [] }),
    assignChores: vi.fn().mockResolvedValue([]),
    detectAnomalies: vi.fn().mockResolvedValue([]),
    analyzePayroll: vi.fn().mockResolvedValue({}),
  },
}));

// ── Imports (after mocks) ─────────────────────────────────────────────────────

import { registerDashboardRoutes } from "../server/routes/dashboard";

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeSelectChain(rows: any[]) {
  const chain: any = {};
  chain.from = vi.fn().mockReturnValue(chain);
  chain.innerJoin = vi.fn().mockReturnValue(chain);
  chain.where = vi.fn().mockReturnValue(chain);
  chain.limit = vi.fn().mockReturnValue(Promise.resolve(rows));
  chain.then = (resolve: any, reject: any) => Promise.resolve(rows).then(resolve, reject);
  chain.catch = (handler: any) => Promise.resolve(rows).catch(handler);
  return chain;
}

function makeStartTime(minutesAgo: number): Date {
  return new Date(Date.now() - minutesAgo * 60 * 1000);
}

function makeEndTime(hoursFromNow = 2): Date {
  return new Date(Date.now() + hoursFromNow * 60 * 60 * 1000);
}

function scheduleRow(userId: string, minutesAgo: number) {
  return {
    scheduleId: `sched-${userId}`,
    scheduleUserId: userId,
    startTime: makeStartTime(minutesAgo),
    endTime: makeEndTime(),
    firstName: "Test",
    lastName: userId,
    profileImageUrl: null,
  };
}

/**
 * Wire the db mock for the upcoming-shifts route.
 * Call order (sequential select calls):
 *   idx 0: user lookup (locationName + companyId)
 *   idx 1: today's schedules (Promise.all[0])
 *   idx 2: active time entries (Promise.all[1])
 */
function wireUpcomingMock({
  companyId = "company-test",
  locationName = null as string | null,
  scheduleRows = [] as any[],
  activeEntryRows = [] as any[],
} = {}) {
  let idx = 0;
  dbMock.select.mockImplementation(() => {
    const i = idx++;
    if (i === 0) return makeSelectChain([{ locationName, companyId }]);
    if (i === 1) return makeSelectChain(scheduleRows);
    if (i === 2) return makeSelectChain(activeEntryRows);
    return makeSelectChain([]);
  });
  dbMock.delete.mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) });
}

async function buildTestServer(userId = "user-alice") {
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
      resolve({ port, close: () => new Promise(r => server.close(r)) });
    });
  });
}

async function getUpcomingShifts(port: number) {
  const res = await fetch(`http://localhost:${port}/api/team-status/upcoming-shifts`);
  return res.json() as Promise<{
    upcomingShifts: {
      scheduleId: string;
      userId: string;
      firstName: string | null;
      lastName: string | null;
      startTime: string;
      endTime: string;
      minutesUntilShift: number;
      minutesLate: number;
    }[];
  }>;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("GET /api/team-status/upcoming-shifts — start-of-day window fix (Task #621)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("includes a shift that started in the past when the employee has not clocked in", async () => {
    wireUpcomingMock({
      scheduleRows: [scheduleRow("user-alice", 30)],
      activeEntryRows: [],
    });

    const { port, close } = await buildTestServer();
    try {
      const data = await getUpcomingShifts(port);
      expect(data.upcomingShifts).toHaveLength(1);
      expect(data.upcomingShifts[0].userId).toBe("user-alice");
    } finally {
      await close();
    }
  });

  it("sets minutesLate > 0 for a shift that started in the past", async () => {
    wireUpcomingMock({
      scheduleRows: [scheduleRow("user-alice", 45)],
      activeEntryRows: [],
    });

    const { port, close } = await buildTestServer();
    try {
      const data = await getUpcomingShifts(port);
      const shift = data.upcomingShifts[0];
      expect(shift.minutesLate).toBeGreaterThan(0);
    } finally {
      await close();
    }
  });

  it("sets minutesUntilShift negative for a shift that started in the past", async () => {
    wireUpcomingMock({
      scheduleRows: [scheduleRow("user-alice", 45)],
      activeEntryRows: [],
    });

    const { port, close } = await buildTestServer();
    try {
      const data = await getUpcomingShifts(port);
      const shift = data.upcomingShifts[0];
      expect(shift.minutesUntilShift).toBeLessThan(0);
    } finally {
      await close();
    }
  });

  it("sets minutesLate=0 for a shift that has not started yet", async () => {
    wireUpcomingMock({
      scheduleRows: [{
        scheduleId: "sched-bob",
        scheduleUserId: "user-bob",
        startTime: new Date(Date.now() + 30 * 60 * 1000),
        endTime: makeEndTime(3),
        firstName: "Bob",
        lastName: "Jones",
        profileImageUrl: null,
      }],
      activeEntryRows: [],
    });

    const { port, close } = await buildTestServer();
    try {
      const data = await getUpcomingShifts(port);
      const shift = data.upcomingShifts[0];
      expect(shift.minutesLate).toBe(0);
      expect(shift.minutesUntilShift).toBeGreaterThan(0);
    } finally {
      await close();
    }
  });

  it("excludes an employee who is currently clocked in even if their shift started in the past", async () => {
    wireUpcomingMock({
      scheduleRows: [scheduleRow("user-alice", 60)],
      activeEntryRows: [{ entryUserId: "user-alice" }],
    });

    const { port, close } = await buildTestServer();
    try {
      const data = await getUpcomingShifts(port);
      expect(data.upcomingShifts).toHaveLength(0);
    } finally {
      await close();
    }
  });

  it("includes a not-clocked-in employee while excluding one who is clocked in", async () => {
    wireUpcomingMock({
      scheduleRows: [
        scheduleRow("user-alice", 15),
        scheduleRow("user-bob", 20),
      ],
      activeEntryRows: [{ entryUserId: "user-alice" }],
    });

    const { port, close } = await buildTestServer();
    try {
      const data = await getUpcomingShifts(port);
      expect(data.upcomingShifts).toHaveLength(1);
      expect(data.upcomingShifts[0].userId).toBe("user-bob");
    } finally {
      await close();
    }
  });

  it("deduplicates by userId keeping the earliest shift when a user has two schedule rows today", async () => {
    const earlier = scheduleRow("user-alice", 90);
    const later = { ...scheduleRow("user-alice", 30), scheduleId: "sched-alice-2" };

    wireUpcomingMock({
      scheduleRows: [later, earlier],
      activeEntryRows: [],
    });

    const { port, close } = await buildTestServer();
    try {
      const data = await getUpcomingShifts(port);
      expect(data.upcomingShifts).toHaveLength(1);
      expect(data.upcomingShifts[0].scheduleId).toBe(earlier.scheduleId);
    } finally {
      await close();
    }
  });

  it("returns an empty list when the requesting user has no companyId", async () => {
    wireUpcomingMock({ companyId: null as any });

    const { port, close } = await buildTestServer();
    try {
      const data = await getUpcomingShifts(port);
      expect(data.upcomingShifts).toHaveLength(0);
    } finally {
      await close();
    }
  });

  it("returns an empty list when there are no schedules today", async () => {
    wireUpcomingMock({ scheduleRows: [], activeEntryRows: [] });

    const { port, close } = await buildTestServer();
    try {
      const data = await getUpcomingShifts(port);
      expect(data.upcomingShifts).toHaveLength(0);
    } finally {
      await close();
    }
  });
});
