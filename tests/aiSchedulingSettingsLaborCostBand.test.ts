/**
 * Unit tests for PUT /api/ai-scheduling/settings — labor cost target band
 * validation (Task #397).
 *
 * The route now accepts `laborCostOverPct` and `laborCostUnderPct`. It must:
 *  1. Reject non-numeric values or values outside [0, 100].
 *  2. Reject incoming pairs where under >= over.
 *  3. Reject partial updates whose effective value (incoming OR existing row)
 *     produces under >= over — e.g. a client that sends only `laborCostUnderPct`
 *     but raises it past the existing stored over %.
 *  4. Accept valid full and partial updates and persist them.
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

// ── Helpers ──────────────────────────────────────────────────────────────────

interface ExistingSettingsRow {
  id?: string;
  laborCostOverPct?: string | number | null;
  laborCostUnderPct?: string | number | null;
}

/**
 * Wires the dbMock so PUT /api/ai-scheduling/settings sees the given existing
 * settings row. The route runs `db.select().from(aiSchedulingSettings).limit(1)`
 * which is a thenable resolved at `.limit(1)`. After PUT mutations, the route
 * also runs a final `db.select().from(...).limit(1)` to return the updated row,
 * which we resolve with the same row for simplicity (the response is not
 * asserted against in these tests).
 */
function wireDbForPut(existing: ExistingSettingsRow[]) {
  const makeChain = (rows: any[]) => {
    const chain: any = {};
    chain.from = vi.fn().mockReturnValue(chain);
    chain.where = vi.fn().mockReturnValue(chain);
    chain.limit = vi.fn().mockResolvedValue(rows);
    return chain;
  };

  dbMock.select.mockReset();
  // Two selects per request: the validation-time read, and the final
  // "return updated row" read after the writes. Both return the same row.
  dbMock.select
    .mockReturnValue(makeChain(existing));

  // db.update(...).set(...).where(...) chain for the main row update.
  const updateChain: any = {};
  updateChain.set = vi.fn().mockReturnValue(updateChain);
  updateChain.where = vi.fn().mockResolvedValue(undefined);
  dbMock.update.mockReset();
  dbMock.update.mockReturnValue(updateChain);

  // db.insert(...).values(...) chain for the new-row branch.
  const insertChain: any = {};
  insertChain.values = vi.fn().mockResolvedValue(undefined);
  dbMock.insert.mockReset();
  dbMock.insert.mockReturnValue(insertChain);

  dbMock.execute.mockReset();
  dbMock.execute.mockResolvedValue(undefined);
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

async function putSettings(base: string, body: unknown) {
  const res = await fetch(`${base}/api/ai-scheduling/settings`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  let parsed: any = null;
  try { parsed = await res.json(); } catch { /* empty body OK */ }
  return { status: res.status, body: parsed };
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("PUT /api/ai-scheduling/settings — labor cost target band validation (Task #397)", () => {
  beforeEach(() => {
    dbMock.select.mockReset();
    dbMock.update.mockReset();
    dbMock.insert.mockReset();
    dbMock.execute.mockReset();
  });

  it("rejects laborCostOverPct that is not a number", async () => {
    wireDbForPut([{ id: "row-1", laborCostOverPct: "30", laborCostUnderPct: "10" }]);
    const app = buildApp();
    const { server, base } = await startServer(app);
    try {
      const { status, body } = await putSettings(base, { laborCostOverPct: "not-a-number" });
      expect(status).toBe(400);
      expect(String(body.message)).toMatch(/laborCostOverPct/);
      expect(dbMock.execute).not.toHaveBeenCalled();
    } finally {
      await stopServer(server);
    }
  });

  it("rejects laborCostOverPct outside the 0–100 range", async () => {
    wireDbForPut([{ id: "row-1", laborCostOverPct: "30", laborCostUnderPct: "10" }]);
    const app = buildApp();
    const { server, base } = await startServer(app);
    try {
      const { status: high } = await putSettings(base, { laborCostOverPct: 150 });
      expect(high).toBe(400);
      const { status: low } = await putSettings(base, { laborCostOverPct: -5 });
      expect(low).toBe(400);
    } finally {
      await stopServer(server);
    }
  });

  it("rejects laborCostUnderPct outside the 0–100 range", async () => {
    wireDbForPut([{ id: "row-1", laborCostOverPct: "30", laborCostUnderPct: "10" }]);
    const app = buildApp();
    const { server, base } = await startServer(app);
    try {
      const { status: high, body: highBody } = await putSettings(base, { laborCostUnderPct: 150 });
      expect(high).toBe(400);
      expect(String(highBody.message)).toMatch(/laborCostUnderPct/);
    } finally {
      await stopServer(server);
    }
  });

  it("rejects an incoming pair where under >= over", async () => {
    wireDbForPut([{ id: "row-1", laborCostOverPct: "30", laborCostUnderPct: "10" }]);
    const app = buildApp();
    const { server, base } = await startServer(app);
    try {
      const { status, body } = await putSettings(base, {
        laborCostOverPct: 20,
        laborCostUnderPct: 25,
      });
      expect(status).toBe(400);
      expect(String(body.message)).toMatch(/less than/);
    } finally {
      await stopServer(server);
    }
  });

  it("rejects a partial update of only laborCostUnderPct that exceeds the stored over %", async () => {
    // Stored: over=20, under=10. Client sends only under=25 → effective band 25/20 (invalid).
    wireDbForPut([{ id: "row-1", laborCostOverPct: "20", laborCostUnderPct: "10" }]);
    const app = buildApp();
    const { server, base } = await startServer(app);
    try {
      const { status, body } = await putSettings(base, { laborCostUnderPct: 25 });
      expect(status).toBe(400);
      expect(String(body.message)).toMatch(/less than/);
      expect(dbMock.execute).not.toHaveBeenCalled();
    } finally {
      await stopServer(server);
    }
  });

  it("rejects a partial update of only laborCostOverPct that drops below the stored under %", async () => {
    // Stored: over=30, under=15. Client sends only over=10 → effective band 15/10 (invalid).
    wireDbForPut([{ id: "row-1", laborCostOverPct: "30", laborCostUnderPct: "15" }]);
    const app = buildApp();
    const { server, base } = await startServer(app);
    try {
      const { status, body } = await putSettings(base, { laborCostOverPct: 10 });
      expect(status).toBe(400);
      expect(String(body.message)).toMatch(/less than/);
      expect(dbMock.execute).not.toHaveBeenCalled();
    } finally {
      await stopServer(server);
    }
  });

  it("accepts a valid full update and persists both columns via SQL", async () => {
    wireDbForPut([{ id: "row-1", laborCostOverPct: "30", laborCostUnderPct: "10" }]);
    const app = buildApp();
    const { server, base } = await startServer(app);
    try {
      const { status } = await putSettings(base, {
        laborCostOverPct: 28,
        laborCostUnderPct: 12,
      });
      expect(status).toBe(200);
      // The SQL UPDATE for both columns should have been issued.
      expect(dbMock.execute).toHaveBeenCalled();
    } finally {
      await stopServer(server);
    }
  });

  it("accepts a valid partial update of only laborCostUnderPct when it stays below the stored over %", async () => {
    // Stored: over=30, under=10. Client raises under to 20 (still < 30) → valid.
    wireDbForPut([{ id: "row-1", laborCostOverPct: "30", laborCostUnderPct: "10" }]);
    const app = buildApp();
    const { server, base } = await startServer(app);
    try {
      const { status } = await putSettings(base, { laborCostUnderPct: 20 });
      expect(status).toBe(200);
      expect(dbMock.execute).toHaveBeenCalled();
    } finally {
      await stopServer(server);
    }
  });

  it("uses the 30/10 defaults when no settings row exists yet (partial update validation)", async () => {
    // No existing row. Client sends only under=35 → effective band against
    // default over=30 → 35 >= 30 → must reject.
    wireDbForPut([]);
    const app = buildApp();
    const { server, base } = await startServer(app);
    try {
      const { status, body } = await putSettings(base, { laborCostUnderPct: 35 });
      expect(status).toBe(400);
      expect(String(body.message)).toMatch(/less than/);
    } finally {
      await stopServer(server);
    }
  });
});
