/**
 * Unit tests for PATCH /api/users/:userId/assign-location
 *
 * Verifies:
 *  1. Returns 403 when the requesting user is not an owner or admin
 *  2. Returns 404 when the given locationId does not exist in work_locations
 *  3. Returns the updated user with both locationId and locationName synced on success
 *
 * The database and isAuthenticated middleware are mocked so no real DB or
 * auth service is required.
 */

import { vi, describe, it, expect, beforeAll, afterAll } from "vitest";
import type { AddressInfo } from "net";
import http from "http";

// ── Hoist mocks so they are available inside vi.mock factories ──────────────

const dbMock = vi.hoisted(() => ({
  select: vi.fn(),
  update: vi.fn(),
}));

vi.mock("../server/db", () => ({ db: dbMock }));
vi.mock("../server/lib/permissionUtils", () => ({
  invalidatePermissionCache: vi.fn(),
  getUserIdsWithPermission: vi.fn().mockResolvedValue([]),
}));
vi.mock("../server/services/storeResolver", () => ({
  tryResolveStoreIdForUser: vi.fn().mockResolvedValue(null),
}));
vi.mock("../server/services/emailService", () => ({
  sendTeamInviteEmail: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@clerk/express", () => ({
  clerkClient: { users: { getUser: vi.fn() } },
  clerkMiddleware: () => (_req: unknown, _res: unknown, next: () => void) => next(),
  requireAuth: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));
vi.mock("../server/lib/logger", () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// ── Test fixtures ────────────────────────────────────────────────────────────

const STORE_ID = "store-aaa";
const STORE_NAME = "Main Street Store";
const USER_ID = "user-bbb";

// ── Build a minimal Express app with the user routes mounted ─────────────────

import express from "express";
import { registerUserRoutes } from "../server/routes/users";

function buildApp(requestingRole: string) {
  const app = express();
  app.use(express.json());

  const isAuthenticated = (req: any, _res: any, next: () => void) => {
    req.user = { id: "req-user-1", role: { name: requestingRole } };
    next();
  };

  const storageMock = {
    getUser: vi.fn().mockResolvedValue(null),
    getUserByEmail: vi.fn().mockResolvedValue(null),
    getUserPermissions: vi.fn().mockResolvedValue([]),
  } as any;

  registerUserRoutes(app, storageMock, isAuthenticated);
  return app;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

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

async function patchAssignLocation(base: string, userId: string, body: object) {
  const res = await fetch(`${base}/api/users/${userId}/assign-location`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("PATCH /api/users/:userId/assign-location", () => {
  describe("authorization guard", () => {
    let server: http.Server;
    let base: string;

    beforeAll(async () => {
      const app = buildApp("manager");
      ({ server, base } = await startServer(app));
    });

    afterAll(() => stopServer(server));

    it("returns 403 when requesting user is not owner or admin", async () => {
      const { status, body } = await patchAssignLocation(base, USER_ID, { locationId: STORE_ID });
      expect(status).toBe(403);
      expect(body.message).toMatch(/admin/i);
    });
  });

  describe("owner/admin happy path", () => {
    let server: http.Server;
    let base: string;

    beforeAll(async () => {
      const app = buildApp("owner");
      ({ server, base } = await startServer(app));
    });

    afterAll(() => stopServer(server));

    it("returns 404 when the locationId does not exist in work_locations", async () => {
      // db.select().from().where().limit() → resolves to []
      const chain = { from: vi.fn(), where: vi.fn(), limit: vi.fn() };
      chain.from.mockReturnValue(chain);
      chain.where.mockReturnValue(chain);
      chain.limit.mockResolvedValue([]); // no matching location
      dbMock.select.mockReturnValue(chain);

      const { status, body } = await patchAssignLocation(base, USER_ID, { locationId: "nonexistent-id" });
      expect(status).toBe(404);
      expect(body.message).toMatch(/work location not found/i);
    });

    it("syncs locationId and locationName on success", async () => {
      // First select: look up work location by id → found
      const selectChain = { from: vi.fn(), where: vi.fn(), limit: vi.fn() };
      selectChain.from.mockReturnValue(selectChain);
      selectChain.where.mockReturnValue(selectChain);
      selectChain.limit.mockResolvedValue([{ name: STORE_NAME }]);
      dbMock.select.mockReturnValue(selectChain);

      // db.update().set().where().returning() → updated row
      const updatedUser = { id: USER_ID, locationId: STORE_ID, locationName: STORE_NAME };
      const updateChain = { set: vi.fn(), where: vi.fn(), returning: vi.fn() };
      updateChain.set.mockReturnValue(updateChain);
      updateChain.where.mockReturnValue(updateChain);
      updateChain.returning.mockResolvedValue([updatedUser]);
      dbMock.update.mockReturnValue(updateChain);

      const { status, body } = await patchAssignLocation(base, USER_ID, { locationId: STORE_ID });
      expect(status).toBe(200);
      expect(body.locationId).toBe(STORE_ID);
      expect(body.locationName).toBe(STORE_NAME);
    });
  });
});
