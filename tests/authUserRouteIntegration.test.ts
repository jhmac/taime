/**
 * Integration tests for GET /api/auth/user
 *
 * Spins up a real Express app with the streamlinedAuth routes mounted,
 * mocks the storage layer and Clerk SDK, then makes real HTTP requests
 * to validate the inline sync + permissions payload end-to-end.
 *
 * Scenarios covered:
 *  A. Happy path: user in DB with role → permissions returned inline.
 *  B. Stage 1 sync: user in DB without role; upsertUser matches an
 *     invited record by email (different DB ID) → role-bearing record
 *     returned in same request, Clerk Admin API NOT called.
 *  C. Stage 2 sync: user in DB without role, no DB email; Clerk Admin
 *     API resolves email and matching invited record is found.
 *  D. Clerk Admin API unavailable during Stage 2 → graceful degradation;
 *     user returned with role:null, not a 500.
 *  E. req.user null (requireAuth can't find record) → 401.
 */

import { vi, describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import type { AddressInfo } from "net";
import http from "http";
import express from "express";

// ── Hoist mocks ──────────────────────────────────────────────────────────────

const storageMock = vi.hoisted(() => ({
  getUserWithRole: vi.fn(),
  upsertUser: vi.fn(),
  getUserPermissions: vi.fn(),
  getCompanySettings: vi.fn().mockResolvedValue(null),
}));

const clerkGetUser = vi.hoisted(() => vi.fn());
const mockGetAuth   = vi.hoisted(() => vi.fn().mockReturnValue({ userId: "clerk_test_user" }));

vi.mock("../server/storage", () => ({ storage: storageMock }));

vi.mock("../server/db", () => ({
  db: {
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue([]) }),
      }),
    }),
  },
}));

vi.mock("../server/lib/config", () => ({
  config: {
    server: { nodeEnv: "test", port: 5000 },
    clerk: { publishableKey: "pk_test_mock", secretKey: "sk_test_mock" },
    database: { url: "postgres://mock" },
  },
}));

vi.mock("@clerk/express", () => ({
  clerkMiddleware: () => (_req: unknown, _res: unknown, next: () => void) => next(),
  clerkClient: { users: { getUser: clerkGetUser } },
  getAuth: mockGetAuth,
}));

vi.mock("../server/lib/logger", () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// ── Fixtures ─────────────────────────────────────────────────────────────────

const CLERK_ID    = "clerk_test_user";
const INVITED_ID  = "db_invited_user";
const USER_EMAIL  = "alice@example.com";
const PERMS       = [{ id: "p1", name: "tasks.view", description: "View tasks" }];

// ── Build the Express app ────────────────────────────────────────────────────

async function buildApp() {
  const app = express();
  app.use(express.json());
  const { setupAuth } = await import("../server/streamlinedAuth");
  await setupAuth(app);
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

async function getAuthUser(base: string) {
  const res = await fetch(`${base}/api/auth/user`);
  return { status: res.status, body: await res.json() };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("GET /api/auth/user — route integration", () => {
  let server: http.Server;
  let base: string;

  beforeAll(async () => {
    const app = await buildApp();
    ({ server, base } = await startServer(app));
  });

  afterAll(() => stopServer(server));

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAuth.mockReturnValue({ userId: CLERK_ID });
  });

  // ── A: happy path ──────────────────────────────────────────────────────────
  it("A: returns user + inline permissions when user already has a role", async () => {
    const userWithRole = {
      id: CLERK_ID, email: USER_EMAIL, role: { name: "employee" },
      firstName: "Alice", lastName: "Smith", profileImageUrl: "",
    };
    // requireAuth call + handler inline refetch don't happen (role exists)
    storageMock.getUserWithRole.mockResolvedValue(userWithRole);
    storageMock.getUserPermissions.mockResolvedValue(PERMS);

    const { status, body } = await getAuthUser(base);

    expect(status).toBe(200);
    expect(body.id).toBe(CLERK_ID);
    expect(body.role?.name).toBe("employee");
    expect(body.permissions).toEqual(PERMS);
    // Clerk Admin API must NOT be called when user already has a role
    expect(clerkGetUser).not.toHaveBeenCalled();
  });

  // ── B: Stage 1 sync — invited-record email match ───────────────────────────
  it("B: Stage 1 maps Clerk ID to invited record without Clerk Admin API", async () => {
    const userNoRole = {
      id: CLERK_ID, email: USER_EMAIL, role: null,
      firstName: "Alice", lastName: "Smith", profileImageUrl: "",
    };
    const invitedUser = {
      id: INVITED_ID, email: USER_EMAIL, role: { name: "manager" },
      firstName: "Alice", lastName: "Smith", profileImageUrl: "",
    };

    storageMock.getUserWithRole
      .mockResolvedValueOnce(userNoRole)   // requireAuth lookup by CLERK_ID
      .mockResolvedValueOnce(invitedUser); // Stage 1: lookup after upsert

    storageMock.upsertUser.mockResolvedValue({ id: INVITED_ID, email: USER_EMAIL });
    storageMock.getUserPermissions.mockResolvedValue(PERMS);

    const { status, body } = await getAuthUser(base);

    expect(status).toBe(200);
    expect(body.id).toBe(INVITED_ID);
    expect(body.role?.name).toBe("manager");
    expect(body.permissions).toEqual(PERMS);

    // upsertUser called with DB email, not from any request header/body
    expect(storageMock.upsertUser).toHaveBeenCalledWith(
      expect.objectContaining({ id: CLERK_ID, email: USER_EMAIL }),
    );

    // Clerk Admin API must NOT be reached when Stage 1 resolves the role
    expect(clerkGetUser).not.toHaveBeenCalled();
  });

  // ── C: Stage 2 sync — blank DB email, Clerk Admin API provides it ──────────
  it("C: Stage 2 uses Clerk Admin API when DB email is blank", async () => {
    const userNoEmail = {
      id: CLERK_ID, email: "", role: null,
      firstName: "", lastName: "", profileImageUrl: "",
    };
    const invitedUser = {
      id: INVITED_ID, email: USER_EMAIL, role: { name: "employee" },
      firstName: "Alice", lastName: "Smith", profileImageUrl: "",
    };

    // requireAuth finds user with no email and no role
    storageMock.getUserWithRole
      .mockResolvedValueOnce(userNoEmail)  // requireAuth lookup
      .mockResolvedValueOnce(invitedUser); // Stage 2: lookup after upsert

    storageMock.upsertUser.mockResolvedValue({ id: INVITED_ID, email: USER_EMAIL });
    storageMock.getUserPermissions.mockResolvedValue(PERMS);

    clerkGetUser.mockResolvedValue({
      emailAddresses: [{ id: "ema_1", emailAddress: USER_EMAIL }],
      primaryEmailAddressId: "ema_1",
      firstName: "Alice",
      lastName: "Smith",
      imageUrl: "",
    });

    const { status, body } = await getAuthUser(base);

    expect(status).toBe(200);
    expect(body.id).toBe(INVITED_ID);
    expect(body.role?.name).toBe("employee");
    expect(clerkGetUser).toHaveBeenCalledWith(CLERK_ID);
  });

  // ── D: Stage 2 — Clerk Admin API unavailable ──────────────────────────────
  it("D: returns user without role (not 500) when Clerk Admin API is down", async () => {
    const userNoRole = {
      id: CLERK_ID, email: "", role: null,
      firstName: "", lastName: "", profileImageUrl: "",
    };

    storageMock.getUserWithRole.mockResolvedValue(userNoRole);
    storageMock.getUserPermissions.mockResolvedValue([]);
    clerkGetUser.mockRejectedValue(new Error("Clerk API unavailable"));

    const { status, body } = await getAuthUser(base);

    expect(status).toBe(200);          // graceful — not a crash
    expect(body.role).toBeNull();
    expect(Array.isArray(body.permissions)).toBe(true);
  });

  // ── E: no valid Clerk session → 401 ──────────────────────────────────────
  it("E: returns 401 when the request carries no valid Clerk session", async () => {
    // requireAuth short-circuits on the first check when auth.userId is absent
    mockGetAuth.mockReturnValue(null);

    const { status } = await getAuthUser(base);

    expect(status).toBe(401);
  });
});
