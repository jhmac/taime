/**
 * breakEventsAuthz.test.ts
 *
 * Route-level tests asserting that GET /api/time-entries/:id/breaks
 * enforces same-store scoping.  A manager from a different store in
 * the same company must receive 403; a same-store manager receives
 * 200; the entry owner always gets 200; a global admin gets 200.
 *
 * No database is required — all storage calls are stubbed.
 */

import { vi, describe, it, expect, beforeAll, afterAll } from "vitest";
import http from "http";
import type { AddressInfo } from "net";

// ─── Hoisted mock factories ───────────────────────────────────────────────────

const geofencingMock = vi.hoisted(() => ({
  geofencingService: { validateClockInLocation: vi.fn().mockResolvedValue({ isValid: true }) },
}));

const sopSurfacingMock = vi.hoisted(() => ({
  getOpeningSOPsForClockIn: vi.fn().mockResolvedValue([]),
  getShiftHandoffSOPs: vi.fn().mockResolvedValue([]),
}));

const aiMock = vi.hoisted(() => ({
  runClockInRedistribute: vi.fn().mockResolvedValue(undefined),
  activateDeferredPins: vi.fn().mockResolvedValue(undefined),
}));

const permissionUtilsMock = vi.hoisted(() => ({
  getUserIdsWithPermission: vi.fn().mockResolvedValue([]),
}));

const broadcastRecipientsMock = vi.hoisted(() => ({
  computeTimeEntryRecipients: vi.fn().mockResolvedValue([]),
}));

const cacheMock = vi.hoisted(() => ({
  cache: { invalidate: vi.fn() },
}));

// ─── Module mocks ─────────────────────────────────────────────────────────────

vi.mock("../server/services/geofencingService", () => geofencingMock);
vi.mock("../server/services/sopSurfacing", () => sopSurfacingMock);
vi.mock("../server/routes/ai", () => aiMock);
vi.mock("../server/lib/permissionUtils", () => permissionUtilsMock);
vi.mock("../server/lib/broadcastRecipients", () => broadcastRecipientsMock);
vi.mock("../server/services/cache", () => cacheMock);

// ─── Constants ────────────────────────────────────────────────────────────────

const STORE_A_LOC_ID = "loc-store-a";
const STORE_B_LOC_ID = "loc-store-b";
const COMPANY_ID = "company-shared"; // both stores belong to same company

const EMPLOYEE_ID = "emp-123";
const SAME_STORE_MANAGER_ID = "mgr-store-a";
const CROSS_STORE_MANAGER_ID = "mgr-store-b";
const GLOBAL_ADMIN_ID = "admin-global";
const ENTRY_ID = "entry-abc";

const timeEntry = {
  id: ENTRY_ID,
  userId: EMPLOYEE_ID,
  locationId: STORE_A_LOC_ID,
  clockInTime: new Date(),
  clockOutTime: null,
  breakMinutes: 0,
  breakStartTime: null,
};

const breakEventsData = [
  { id: "be-1", timeEntryId: ENTRY_ID, userId: EMPLOYEE_ID, breakStart: new Date(), breakEnd: null, durationMinutes: null },
];

// User records
const userRecords: Record<string, any> = {
  [EMPLOYEE_ID]: { id: EMPLOYEE_ID, locationId: STORE_A_LOC_ID, companyId: COMPANY_ID },
  [SAME_STORE_MANAGER_ID]: { id: SAME_STORE_MANAGER_ID, locationId: STORE_A_LOC_ID, companyId: COMPANY_ID },
  [CROSS_STORE_MANAGER_ID]: { id: CROSS_STORE_MANAGER_ID, locationId: STORE_B_LOC_ID, companyId: COMPANY_ID },
  [GLOBAL_ADMIN_ID]: { id: GLOBAL_ADMIN_ID, locationId: STORE_B_LOC_ID, companyId: COMPANY_ID },
};

// Permission maps: userId → set of permissions
const permissionMaps: Record<string, string[]> = {
  [EMPLOYEE_ID]: [],
  [SAME_STORE_MANAGER_ID]: ["time.approve"],
  [CROSS_STORE_MANAGER_ID]: ["time.approve"],
  [GLOBAL_ADMIN_ID]: ["admin.manage_all"],
};

// ─── Storage stub factory ──────────────────────────────────────────────────────

function makeStorage() {
  return {
    getTimeEntry: vi.fn().mockResolvedValue(timeEntry),
    getUser: vi.fn().mockImplementation((id: string) => Promise.resolve(userRecords[id] ?? null)),
    getBreakEvents: vi.fn().mockResolvedValue(breakEventsData),
    getActiveTimeEntry: vi.fn().mockResolvedValue(null),
    getAllWorkLocations: vi.fn().mockResolvedValue([]),
    getUserPermissions: vi.fn().mockImplementation((userId: string) =>
      Promise.resolve((permissionMaps[userId] ?? []).map((name) => ({ name })))
    ),
    getRolePermissions: vi.fn().mockResolvedValue([]),
    getUserRole: vi.fn().mockResolvedValue(null),
    // Satisfy other imports that may be called
    getCompanySettings: vi.fn().mockResolvedValue(null),
    createTimeEntryEdit: vi.fn().mockResolvedValue({}),
  } as any;
}

// ─── Server setup ─────────────────────────────────────────────────────────────

let server: http.Server;
let baseUrl: string;
let requestingUserId = EMPLOYEE_ID; // mutated per test

beforeAll(async () => {
  const express = (await import("express")).default;
  const { registerTimeEntryRoutes } = await import("../server/routes/timeEntries");

  const app = express();
  app.use(express.json());

  // isAuthenticated injects whichever user the test sets
  const isAuthenticated = (req: any, _res: any, next: any) => {
    req.user = { id: requestingUserId };
    next();
  };

  const storage = makeStorage();
  const broadcastToAll = vi.fn();
  const sendToUsers = vi.fn();

  registerTimeEntryRoutes(app, storage, isAuthenticated, broadcastToAll, sendToUsers);

  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", resolve);
  });
  const { port } = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${port}`;
});

afterAll(() => {
  server?.close();
});

// ─── HTTP helper ──────────────────────────────────────────────────────────────

async function getBreaks(entryId: string): Promise<{ status: number; json: any }> {
  return new Promise((resolve, reject) => {
    const url = new URL(`/api/time-entries/${entryId}/breaks`, baseUrl);
    const options: http.RequestOptions = {
      hostname: url.hostname,
      port: Number(url.port),
      path: url.pathname,
      method: "GET",
    };
    const r = http.request(options, (res) => {
      let data = "";
      res.on("data", (c) => (data += c));
      res.on("end", () => {
        try { resolve({ status: res.statusCode!, json: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode!, json: data }); }
      });
    });
    r.on("error", reject);
    r.end();
  });
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("GET /api/time-entries/:id/breaks — store-boundary authorization", () => {
  it("owner of the entry can view their own break events (200)", async () => {
    requestingUserId = EMPLOYEE_ID;
    const { status } = await getBreaks(ENTRY_ID);
    expect(status).toBe(200);
  });

  it("manager from the SAME store can view break events (200)", async () => {
    requestingUserId = SAME_STORE_MANAGER_ID;
    const { status } = await getBreaks(ENTRY_ID);
    expect(status).toBe(200);
  });

  it("manager from a DIFFERENT store receives 403 — even if in same company", async () => {
    requestingUserId = CROSS_STORE_MANAGER_ID;
    const { status, json } = await getBreaks(ENTRY_ID);
    expect(status).toBe(403);
    expect(json.message).toMatch(/your store/i);
  });

  it("global admin (admin.manage_all) can view break events across stores (200)", async () => {
    requestingUserId = GLOBAL_ADMIN_ID;
    const { status } = await getBreaks(ENTRY_ID);
    expect(status).toBe(200);
  });
});
