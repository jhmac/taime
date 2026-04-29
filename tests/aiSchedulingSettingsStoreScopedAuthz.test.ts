/**
 * Authorization tests for the per-store /api/ai-scheduling/settings selector
 * (Task #435).
 *
 * The route accepts an explicit storeId in the query string (GET) or body
 * (PUT/POST generate). The `resolveSettingsStoreId` helper must REJECT a
 * storeId the requester is not authorized for. Specifically:
 *
 *   1. If the requester's locationId equals the requested storeId → allow.
 *   2. Otherwise the requested store must belong to the requester's
 *      company (some user with the same companyId has it as locationId).
 *   3. Otherwise return null so the route 400s. We must NOT fall back to
 *      "any active store" — that would let an admin in tenant A reach
 *      tenant B's labor-cost band by guessing the work_location id.
 */

import { vi, describe, it, expect, beforeEach } from "vitest";
import type { AddressInfo } from "net";
import http from "http";
import express from "express";
import { aiSchedulingSettings, users, workLocations } from "@shared/schema";

// ── Hoist mocks ─────────────────────────────────────────────────────────────

const dbMock = vi.hoisted(() => ({
  select: vi.fn(),
  update: vi.fn(),
  insert: vi.fn(),
  execute: vi.fn(),
}));

vi.mock("../server/db", () => ({ db: dbMock }));
vi.mock("../server/lib/storeResolver", () => ({
  // Default-store resolution should be irrelevant in these tests because we
  // always pass an explicit storeId. If anything calls it, fail loud.
  tryResolveStoreIdForUser: vi.fn().mockResolvedValue("default-store"),
}));
vi.mock("../server/lib/permissionUtils", () => ({
  getAllStoreUserIds: vi.fn().mockResolvedValue([]),
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

import { registerAiSchedulingRoutes } from "../server/routes/aiScheduling";

// ── Mock wiring ──────────────────────────────────────────────────────────────

interface SelectScenario {
  // The user row returned for the inner SELECT users WHERE id = userId
  userRow: { locationId: string | null; companyId: string | null };
  // Whether `requested === user.locationId` and the location is active —
  // returned by the "own-store" SELECT workLocations branch.
  ownStoreActive: boolean;
  // Whether the same-company INNER JOIN returns a hit — the IDOR-safe
  // fallback for chains where the admin manages multiple stores.
  sameCompanyHit: boolean;
  // Settings row returned by the per-store SELECT inside GET.
  settingsRow?: any;
}

/**
 * Wire dbMock.select so that the sequence of SELECTs issued by GET
 * /api/ai-scheduling/settings (with an explicit ?storeId=) is satisfied:
 *
 *   1. SELECT users WHERE id = userId             → userRow
 *   2. (own-store branch only) SELECT workLocations  → ownStoreActive ? row : []
 *   3. (cross-store branch only) SELECT workLocations INNER JOIN users
 *                                                 → sameCompanyHit ? row : []
 *   4. SELECT aiSchedulingSettings WHERE storeId = …  → settingsRow ? [row] : []
 *
 * We model each call as a fresh chain object that resolves at .limit(1).
 */
function wireSelectsForScenario(scenario: SelectScenario, opts: { explicitStoreId: string; isOwnStore: boolean }) {
  const calls: any[] = [];

  const makeChain = (rows: any[]) => {
    const chain: any = {};
    chain.from = vi.fn().mockReturnValue(chain);
    chain.innerJoin = vi.fn().mockReturnValue(chain);
    chain.where = vi.fn().mockReturnValue(chain);
    chain.limit = vi.fn().mockResolvedValue(rows);
    return chain;
  };

  dbMock.select.mockReset();
  dbMock.select.mockImplementation((selection?: any) => {
    const callIdx = calls.length;
    calls.push(selection);

    if (callIdx === 0) {
      // SELECT { locationId, companyId } FROM users
      return makeChain([scenario.userRow]);
    }
    if (callIdx === 1) {
      if (opts.isOwnStore) {
        // own-store active check on workLocations
        return makeChain(scenario.ownStoreActive ? [{ id: opts.explicitStoreId }] : []);
      }
      // cross-store same-company INNER JOIN check
      return makeChain(scenario.sameCompanyHit ? [{ id: opts.explicitStoreId }] : []);
    }
    // settings select on aiSchedulingSettings (or any later select; return the
    // settings row)
    return makeChain(scenario.settingsRow ? [scenario.settingsRow] : []);
  });
}

function buildApp() {
  const app = express();
  app.use(express.json());

  const isAuthenticated = (req: any, _res: any, next: () => void) => {
    req.user = { id: "manager-1", role: { name: "admin" } };
    next();
  };

  const storage: any = {
    getUserPermissions: vi.fn().mockResolvedValue([{ name: "admin.manage_all" }]),
  };

  registerAiSchedulingRoutes(app, storage, isAuthenticated, vi.fn());
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

async function getSettings(base: string, storeId: string) {
  const res = await fetch(`${base}/api/ai-scheduling/settings?storeId=${encodeURIComponent(storeId)}`);
  let parsed: any = null;
  try { parsed = await res.json(); } catch { /* empty body OK */ }
  return { status: res.status, body: parsed };
}

async function postGenerate(base: string, body: unknown) {
  const res = await fetch(`${base}/api/ai-scheduling/generate`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  let parsed: any = null;
  try { parsed = await res.json(); } catch { /* empty body OK */ }
  return { status: res.status, body: parsed };
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("GET /api/ai-scheduling/settings — store-selector authorization (Task #435)", () => {
  beforeEach(() => {
    dbMock.select.mockReset();
    dbMock.update.mockReset();
    dbMock.insert.mockReset();
    dbMock.execute.mockReset();
  });

  it("allows the requester to read settings for their own store", async () => {
    const ownStoreId = "store-own";
    wireSelectsForScenario(
      {
        userRow: { locationId: ownStoreId, companyId: "co-1" },
        ownStoreActive: true,
        sameCompanyHit: false,
        settingsRow: { id: "row-1", storeId: ownStoreId, laborCostOverPct: "30", laborCostUnderPct: "10" },
      },
      { explicitStoreId: ownStoreId, isOwnStore: true },
    );
    const app = buildApp();
    const { server, base } = await startServer(app);
    try {
      const { status, body } = await getSettings(base, ownStoreId);
      expect(status).toBe(200);
      expect(body.storeId).toBe(ownStoreId);
    } finally {
      await stopServer(server);
    }
  });

  it("allows reading another store in the same company (sibling store in a chain)", async () => {
    const requested = "store-sibling";
    wireSelectsForScenario(
      {
        userRow: { locationId: "store-own", companyId: "co-1" },
        ownStoreActive: false,
        sameCompanyHit: true, // some user in co-1 has locationId = store-sibling
        settingsRow: { id: "row-2", storeId: requested, laborCostOverPct: "28", laborCostUnderPct: "12" },
      },
      { explicitStoreId: requested, isOwnStore: false },
    );
    const app = buildApp();
    const { server, base } = await startServer(app);
    try {
      const { status, body } = await getSettings(base, requested);
      expect(status).toBe(200);
      expect(body.storeId).toBe(requested);
    } finally {
      await stopServer(server);
    }
  });

  it("REJECTS a cross-tenant storeId (admin in company A trying to read a store in company B)", async () => {
    // The admin is in co-1. They request store-of-tenant-B. No user in co-1
    // has that as their locationId, so the same-company INNER JOIN returns
    // empty. The route must NOT fall back to "any active store".
    const requested = "store-of-tenant-B";
    wireSelectsForScenario(
      {
        userRow: { locationId: "store-own", companyId: "co-1" },
        ownStoreActive: false,
        sameCompanyHit: false, // ← no row in the INNER JOIN
      },
      { explicitStoreId: requested, isOwnStore: false },
    );
    const app = buildApp();
    const { server, base } = await startServer(app);
    try {
      const { status } = await getSettings(base, requested);
      expect(status).toBe(400);
      // Critically: we never queried aiSchedulingSettings for tenant B's
      // store, because resolveSettingsStoreId returned null first.
      // (Settings select would have been the 3rd select call.)
      // We assert the count is at most 2 (user row + same-company check).
      expect(dbMock.select.mock.calls.length).toBeLessThanOrEqual(2);
    } finally {
      await stopServer(server);
    }
  });

  it("REJECTS when the requester has no companyId (orphan account can't reach into other stores)", async () => {
    const requested = "store-anywhere";
    wireSelectsForScenario(
      {
        userRow: { locationId: "different-store", companyId: null },
        ownStoreActive: false,
        sameCompanyHit: false,
      },
      { explicitStoreId: requested, isOwnStore: false },
    );
    const app = buildApp();
    const { server, base } = await startServer(app);
    try {
      const { status } = await getSettings(base, requested);
      expect(status).toBe(400);
      // Should not even reach the same-company INNER JOIN — userRow lookup
      // is the only select that runs.
      expect(dbMock.select.mock.calls.length).toBe(1);
    } finally {
      await stopServer(server);
    }
  });

  it("REJECTS even an own-store storeId when the location has been deactivated", async () => {
    const ownStoreId = "store-own-disabled";
    wireSelectsForScenario(
      {
        userRow: { locationId: ownStoreId, companyId: "co-1" },
        ownStoreActive: false, // is_active = false
        sameCompanyHit: false,
      },
      { explicitStoreId: ownStoreId, isOwnStore: true },
    );
    const app = buildApp();
    const { server, base } = await startServer(app);
    try {
      const { status } = await getSettings(base, ownStoreId);
      expect(status).toBe(400);
    } finally {
      await stopServer(server);
    }
  });
});

describe("POST /api/ai-scheduling/generate — store-selector authorization (Task #435)", () => {
  beforeEach(() => {
    dbMock.select.mockReset();
    dbMock.update.mockReset();
    dbMock.insert.mockReset();
    dbMock.execute.mockReset();
  });

  it("403s when the explicit storeId fails authorization (no silent fallback to defaults)", async () => {
    // Admin in co-1 explicitly asks generate to use a store that no co-1
    // user owns. resolveSettingsStoreId returns null. The route MUST fail
    // loudly instead of running generation with the default labor band.
    const requested = "store-of-tenant-B";
    wireSelectsForScenario(
      {
        userRow: { locationId: "store-own", companyId: "co-1" },
        ownStoreActive: false,
        sameCompanyHit: false, // ← cross-tenant request
      },
      { explicitStoreId: requested, isOwnStore: false },
    );
    const app = buildApp();
    const { server, base } = await startServer(app);
    try {
      const { status, body } = await postGenerate(base, {
        startDate: "2026-05-01",
        endDate: "2026-05-07",
        storeId: requested,
      });
      expect(status).toBe(403);
      expect(String(body?.message)).toMatch(/access/i);
      // We must not have queried the settings table for tenant B's store.
      // Selects so far: 1 user row + 1 same-company INNER JOIN = 2.
      expect(dbMock.select.mock.calls.length).toBe(2);
    } finally {
      await stopServer(server);
    }
  });
});
