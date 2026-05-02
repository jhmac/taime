/**
 * Unit tests for the special-circumstances CRUD routes and the zone minimum
 * staffing fields on /api/ai-scheduling/settings (Task #492 / #493).
 *
 * Coverage matrix:
 *   1. /api/scheduling/special-circumstances (GET/POST/PATCH/DELETE)
 *      - Non-admin requesters get 403.
 *      - POST without `name` (missing or whitespace) returns 400.
 *      - POST with an explicit `storeId` belonging to another tenant returns
 *        400 (resolveSettingsStoreId returns null) and never reaches insert.
 *      - PATCH/DELETE for a circumstance that doesn't belong to the resolver's
 *        store returns 404.
 *      - GET returns the store-scoped list; POST/PATCH/DELETE round-trip the
 *        row and persist isEnabled correctly.
 *
 *   2. PUT /api/ai-scheduling/settings — zone minimum staffing
 *      - Saving minStaffingPreHours/During/PostHours persists (the .set call
 *        carries the parsed integer values).
 *      - The values are clamped to >= 1 and tolerate string input.
 *      - On the INSERT branch (no existing row), the zone minimums land on the
 *        new row instead of falling back to defaults.
 *      - GET returns the persisted zone minimums in the response body.
 *
 *   3. POST /api/ai-scheduling/generate — special-circumstances → AI prompt
 *      - When the DB returns enabled circumstances they appear by name (and
 *        category/description) inside the prompt sent to Anthropic.
 *      - When the DB returns no enabled rows (the route's
 *        `isEnabled = true` filter short-circuits all of them) the
 *        `SPECIAL CIRCUMSTANCES` block is omitted entirely from the prompt.
 */

import { vi, describe, it, expect, beforeEach } from "vitest";
import type { AddressInfo } from "net";
import http from "http";
import express from "express";

// ── Hoist mocks ─────────────────────────────────────────────────────────────

const dbMock = vi.hoisted(() => ({
  select: vi.fn(),
  insert: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
  execute: vi.fn(),
}));

const anthropicMock = vi.hoisted(() => ({
  messages: { create: vi.fn() },
}));

vi.mock("../server/db", () => ({ db: dbMock }));
vi.mock("@anthropic-ai/sdk", () => ({
  default: class FakeAnthropic {
    messages = anthropicMock.messages;
  },
}));
vi.mock("../server/services/storeResolver", () => ({
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

/**
 * A flexible Drizzle chain stand-in that resolves to `rows` no matter where
 * the route's `await` lands (`.from()`, `.where()`, `.limit()`, `.groupBy()`,
 * `.orderBy()`). Drizzle's query builders are thenables on themselves; we
 * model that by giving the chain object a `.then` that resolves with the
 * pre-supplied rows.
 */
function makeChain(rows: any[]) {
  const chain: any = {
    then(resolve: (rows: any[]) => unknown, reject?: (err: unknown) => unknown) {
      return Promise.resolve(rows).then(resolve, reject);
    },
  };
  for (const m of ["from", "innerJoin", "where", "limit", "groupBy", "orderBy"] as const) {
    chain[m] = vi.fn().mockReturnValue(chain);
  }
  return chain;
}

function buildApp(opts: { isAdmin?: boolean } = {}) {
  const app = express();
  app.use(express.json());

  const isAuthenticated = (req: any, _res: any, next: () => void) => {
    req.user = { id: "manager-1", role: { name: opts.isAdmin === false ? "associate" : "admin" } };
    next();
  };

  const storage: any = {
    getUserPermissions: vi
      .fn()
      .mockResolvedValue(opts.isAdmin === false ? [] : [{ name: "admin.manage_all" }]),
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

async function jsonRequest(
  base: string,
  path: string,
  init: { method: string; body?: unknown } = { method: "GET" },
) {
  const res = await fetch(`${base}${path}`, {
    method: init.method,
    headers: init.body !== undefined ? { "content-type": "application/json" } : undefined,
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
  let body: any = null;
  try {
    body = await res.json();
  } catch {
    /* empty body OK */
  }
  return { status: res.status, body };
}

function resetMocks() {
  dbMock.select.mockReset();
  dbMock.insert.mockReset();
  dbMock.update.mockReset();
  dbMock.delete.mockReset();
  dbMock.execute.mockReset();
  anthropicMock.messages.create.mockReset();
}

// ── 1. Special circumstances CRUD ────────────────────────────────────────────

describe("Special circumstances CRUD — store-scoped authorization (Task #492)", () => {
  beforeEach(() => {
    resetMocks();
  });

  it("GET 403s for non-admin requesters and never touches the DB", async () => {
    const app = buildApp({ isAdmin: false });
    const { server, base } = await startServer(app);
    try {
      const { status } = await jsonRequest(base, "/api/scheduling/special-circumstances");
      expect(status).toBe(403);
      expect(dbMock.select).not.toHaveBeenCalled();
    } finally {
      await stopServer(server);
    }
  });

  it("GET returns store-scoped rows for the requester's default store", async () => {
    const rows = [
      { id: "sc-1", storeId: "store-xyz", name: "Holiday Rush", isEnabled: true },
      { id: "sc-2", storeId: "store-xyz", name: "Inventory Day", isEnabled: false },
    ];
    dbMock.select.mockReturnValueOnce(makeChain(rows));

    const app = buildApp();
    const { server, base } = await startServer(app);
    try {
      const { status, body } = await jsonRequest(base, "/api/scheduling/special-circumstances");
      expect(status).toBe(200);
      expect(body).toHaveLength(2);
      expect(body[0].name).toBe("Holiday Rush");
      expect(body[1].name).toBe("Inventory Day");
    } finally {
      await stopServer(server);
    }
  });

  it("POST 400 when name is missing", async () => {
    const app = buildApp();
    const { server, base } = await startServer(app);
    try {
      const { status, body } = await jsonRequest(base, "/api/scheduling/special-circumstances", {
        method: "POST",
        body: {},
      });
      expect(status).toBe(400);
      expect(String(body.message)).toMatch(/name/i);
      expect(dbMock.insert).not.toHaveBeenCalled();
    } finally {
      await stopServer(server);
    }
  });

  it("POST 400 when name is whitespace-only", async () => {
    const app = buildApp();
    const { server, base } = await startServer(app);
    try {
      const { status } = await jsonRequest(base, "/api/scheduling/special-circumstances", {
        method: "POST",
        body: { name: "   " },
      });
      expect(status).toBe(400);
      expect(dbMock.insert).not.toHaveBeenCalled();
    } finally {
      await stopServer(server);
    }
  });

  it("POST creates the row scoped to the resolved store with isEnabled defaulting to true", async () => {
    const insertChain: any = {};
    insertChain.values = vi.fn().mockReturnValue(insertChain);
    insertChain.returning = vi.fn().mockResolvedValue([
      {
        id: "sc-new",
        storeId: "store-xyz",
        name: "Black Friday",
        description: "Big sale day",
        category: "promo",
        isEnabled: true,
      },
    ]);
    dbMock.insert.mockReturnValue(insertChain);

    const app = buildApp();
    const { server, base } = await startServer(app);
    try {
      const { status, body } = await jsonRequest(base, "/api/scheduling/special-circumstances", {
        method: "POST",
        body: { name: "Black Friday", description: "Big sale day", category: "promo" },
      });
      expect(status).toBe(201);
      expect(body.id).toBe("sc-new");
      expect(insertChain.values).toHaveBeenCalledWith(
        expect.objectContaining({
          storeId: "store-xyz",
          name: "Black Friday",
          description: "Big sale day",
          category: "promo",
          isEnabled: true,
        }),
      );
    } finally {
      await stopServer(server);
    }
  });

  it("POST honors isEnabled=false from the request body", async () => {
    const insertChain: any = {};
    insertChain.values = vi.fn().mockReturnValue(insertChain);
    insertChain.returning = vi.fn().mockResolvedValue([{ id: "sc-1", isEnabled: false }]);
    dbMock.insert.mockReturnValue(insertChain);

    const app = buildApp();
    const { server, base } = await startServer(app);
    try {
      const { status } = await jsonRequest(base, "/api/scheduling/special-circumstances", {
        method: "POST",
        body: { name: "Disabled at creation", isEnabled: false },
      });
      expect(status).toBe(201);
      expect(insertChain.values).toHaveBeenCalledWith(
        expect.objectContaining({ isEnabled: false }),
      );
    } finally {
      await stopServer(server);
    }
  });

  it("POST 400 when the explicit storeId belongs to another tenant (cross-store IDOR guard)", async () => {
    // resolveSettingsStoreId(userId, "store-other"):
    //   1. SELECT users WHERE id = userId → { locationId: "store-mine", companyId: "co-1" }
    //   2. cross-store branch → SELECT workLocations INNER JOIN users → []
    //   resolves to null → route returns 400, no insert is issued.
    dbMock.select
      .mockReturnValueOnce(makeChain([{ locationId: "store-mine", companyId: "co-1" }]))
      .mockReturnValueOnce(makeChain([]));

    const app = buildApp();
    const { server, base } = await startServer(app);
    try {
      const { status } = await jsonRequest(base, "/api/scheduling/special-circumstances", {
        method: "POST",
        body: { storeId: "store-other", name: "Foo" },
      });
      expect(status).toBe(400);
      expect(dbMock.insert).not.toHaveBeenCalled();
    } finally {
      await stopServer(server);
    }
  });

  it("PATCH 404 when the circumstance belongs to another store (existing lookup is store-scoped)", async () => {
    // The first (and only) DB select is the existing-row lookup, which the
    // route filters by both id AND storeId. A row from a sibling store
    // returns []; the route 404s before issuing UPDATE.
    dbMock.select.mockReturnValueOnce(makeChain([]));

    const app = buildApp();
    const { server, base } = await startServer(app);
    try {
      const { status } = await jsonRequest(
        base,
        "/api/scheduling/special-circumstances/sc-foreign",
        { method: "PATCH", body: { name: "Hacked" } },
      );
      expect(status).toBe(404);
      expect(dbMock.update).not.toHaveBeenCalled();
    } finally {
      await stopServer(server);
    }
  });

  it("PATCH updates name + isEnabled when the circumstance belongs to the resolved store", async () => {
    dbMock.select.mockReturnValueOnce(
      makeChain([{ id: "sc-1", storeId: "store-xyz", name: "Old Name", isEnabled: true }]),
    );

    const updateChain: any = {};
    updateChain.set = vi.fn().mockReturnValue(updateChain);
    updateChain.where = vi.fn().mockReturnValue(updateChain);
    updateChain.returning = vi.fn().mockResolvedValue([
      { id: "sc-1", storeId: "store-xyz", name: "New Name", isEnabled: false },
    ]);
    dbMock.update.mockReturnValue(updateChain);

    const app = buildApp();
    const { server, base } = await startServer(app);
    try {
      const { status, body } = await jsonRequest(
        base,
        "/api/scheduling/special-circumstances/sc-1",
        { method: "PATCH", body: { name: "New Name", isEnabled: false } },
      );
      expect(status).toBe(200);
      expect(body.name).toBe("New Name");
      expect(body.isEnabled).toBe(false);
      expect(updateChain.set).toHaveBeenCalledWith(
        expect.objectContaining({ name: "New Name", isEnabled: false }),
      );
    } finally {
      await stopServer(server);
    }
  });

  it("DELETE 404 when the circumstance belongs to another store", async () => {
    dbMock.select.mockReturnValueOnce(makeChain([]));

    const app = buildApp();
    const { server, base } = await startServer(app);
    try {
      const { status } = await jsonRequest(
        base,
        "/api/scheduling/special-circumstances/sc-foreign",
        { method: "DELETE" },
      );
      expect(status).toBe(404);
      expect(dbMock.delete).not.toHaveBeenCalled();
    } finally {
      await stopServer(server);
    }
  });

  it("DELETE removes the row when it belongs to the resolved store", async () => {
    dbMock.select.mockReturnValueOnce(makeChain([{ id: "sc-1" }]));

    const deleteChain: any = {};
    deleteChain.where = vi.fn().mockResolvedValue(undefined);
    dbMock.delete.mockReturnValue(deleteChain);

    const app = buildApp();
    const { server, base } = await startServer(app);
    try {
      const { status, body } = await jsonRequest(
        base,
        "/api/scheduling/special-circumstances/sc-1",
        { method: "DELETE" },
      );
      expect(status).toBe(200);
      expect(body.success).toBe(true);
      expect(dbMock.delete).toHaveBeenCalled();
      expect(deleteChain.where).toHaveBeenCalled();
    } finally {
      await stopServer(server);
    }
  });
});

// ── 2. Zone minimum staffing on /api/ai-scheduling/settings ──────────────────

describe("PUT /api/ai-scheduling/settings — zone minimum staffing persistence (Task #492)", () => {
  beforeEach(() => {
    resetMocks();
  });

  it("UPDATE branch: persists all three zone minimums on the .set call", async () => {
    let captured: Record<string, unknown> = {};

    // Pre-update read (existing row) and post-update read (returned response).
    dbMock.select
      .mockReturnValueOnce(
        makeChain([
          {
            id: "row-1",
            laborCostOverPct: "30",
            laborCostUnderPct: "10",
            minStaffingPreHours: 1,
            minStaffingDuringHours: 2,
            minStaffingPostHours: 1,
          },
        ]),
      )
      .mockReturnValueOnce(
        makeChain([
          {
            id: "row-1",
            storeId: "store-xyz",
            minStaffingPreHours: 3,
            minStaffingDuringHours: 5,
            minStaffingPostHours: 2,
          },
        ]),
      );

    const updateChain: any = {};
    updateChain.set = vi.fn().mockImplementation((u) => {
      captured = { ...captured, ...u };
      return updateChain;
    });
    updateChain.where = vi.fn().mockResolvedValue(undefined);
    dbMock.update.mockReturnValue(updateChain);

    const app = buildApp();
    const { server, base } = await startServer(app);
    try {
      const { status, body } = await jsonRequest(base, "/api/ai-scheduling/settings", {
        method: "PUT",
        body: { minStaffingPreHours: 3, minStaffingDuringHours: 5, minStaffingPostHours: 2 },
      });
      expect(status).toBe(200);
      expect(body.minStaffingPreHours).toBe(3);
      expect(body.minStaffingDuringHours).toBe(5);
      expect(body.minStaffingPostHours).toBe(2);
      expect(captured).toMatchObject({
        minStaffingPreHours: 3,
        minStaffingDuringHours: 5,
        minStaffingPostHours: 2,
      });
    } finally {
      await stopServer(server);
    }
  });

  it("UPDATE branch: clamps zone minimums to >= 1 and parses string inputs", async () => {
    let captured: Record<string, unknown> = {};

    dbMock.select
      .mockReturnValueOnce(
        makeChain([{ id: "row-1", laborCostOverPct: "30", laborCostUnderPct: "10" }]),
      )
      .mockReturnValueOnce(
        makeChain([{ id: "row-1", minStaffingPreHours: 1, minStaffingDuringHours: 1, minStaffingPostHours: 4 }]),
      );

    const updateChain: any = {};
    updateChain.set = vi.fn().mockImplementation((u) => {
      captured = { ...captured, ...u };
      return updateChain;
    });
    updateChain.where = vi.fn().mockResolvedValue(undefined);
    dbMock.update.mockReturnValue(updateChain);

    const app = buildApp();
    const { server, base } = await startServer(app);
    try {
      // 0 → clamped to 1, -5 → clamped to 1, "4" → parsed to 4.
      const { status } = await jsonRequest(base, "/api/ai-scheduling/settings", {
        method: "PUT",
        body: { minStaffingPreHours: 0, minStaffingDuringHours: -5, minStaffingPostHours: "4" },
      });
      expect(status).toBe(200);
      expect(captured.minStaffingPreHours).toBe(1);
      expect(captured.minStaffingDuringHours).toBe(1);
      expect(captured.minStaffingPostHours).toBe(4);
    } finally {
      await stopServer(server);
    }
  });

  it("INSERT branch: zone minimums persist on the new row when no settings exist yet", async () => {
    let inserted: Record<string, unknown> | null = null;

    dbMock.select
      .mockReturnValueOnce(makeChain([])) // no existing row
      .mockReturnValueOnce(
        makeChain([
          {
            id: "row-new",
            storeId: "store-xyz",
            minStaffingPreHours: 4,
            minStaffingDuringHours: 6,
            minStaffingPostHours: 2,
          },
        ]),
      );

    const insertChain: any = {};
    insertChain.values = vi.fn().mockImplementation((v) => {
      inserted = v;
      return Promise.resolve(undefined);
    });
    dbMock.insert.mockReturnValue(insertChain);

    const app = buildApp();
    const { server, base } = await startServer(app);
    try {
      const { status, body } = await jsonRequest(base, "/api/ai-scheduling/settings", {
        method: "PUT",
        body: { minStaffingPreHours: 4, minStaffingDuringHours: 6, minStaffingPostHours: 2 },
      });
      expect(status).toBe(200);
      expect(body.minStaffingPreHours).toBe(4);
      expect(body.minStaffingDuringHours).toBe(6);
      expect(body.minStaffingPostHours).toBe(2);
      expect(inserted).toMatchObject({
        storeId: "store-xyz",
        minStaffingPreHours: 4,
        minStaffingDuringHours: 6,
        minStaffingPostHours: 2,
      });
    } finally {
      await stopServer(server);
    }
  });

  it("INSERT branch: defaults zone minimums to 1/2/1 when the client omits them", async () => {
    let inserted: Record<string, unknown> | null = null;

    dbMock.select
      .mockReturnValueOnce(makeChain([])) // no existing
      .mockReturnValueOnce(makeChain([{ id: "row-new" }]));

    const insertChain: any = {};
    insertChain.values = vi.fn().mockImplementation((v) => {
      inserted = v;
      return Promise.resolve(undefined);
    });
    dbMock.insert.mockReturnValue(insertChain);

    const app = buildApp();
    const { server, base } = await startServer(app);
    try {
      const { status } = await jsonRequest(base, "/api/ai-scheduling/settings", {
        method: "PUT",
        body: { minimumStaffing: 3 }, // unrelated change; zone fields omitted
      });
      expect(status).toBe(200);
      expect(inserted).toMatchObject({
        minStaffingPreHours: 1,
        minStaffingDuringHours: 2,
        minStaffingPostHours: 1,
      });
    } finally {
      await stopServer(server);
    }
  });
});

describe("GET /api/ai-scheduling/settings — zone minimum staffing round-trip (Task #492)", () => {
  beforeEach(() => {
    resetMocks();
  });

  it("returns the persisted zone minimums in the settings response", async () => {
    dbMock.select.mockReturnValueOnce(
      makeChain([
        {
          id: "row-1",
          storeId: "store-xyz",
          minStaffingPreHours: 3,
          minStaffingDuringHours: 5,
          minStaffingPostHours: 2,
        },
      ]),
    );

    const app = buildApp();
    const { server, base } = await startServer(app);
    try {
      const { status, body } = await jsonRequest(base, "/api/ai-scheduling/settings");
      expect(status).toBe(200);
      expect(body.storeId).toBe("store-xyz");
      expect(body.minStaffingPreHours).toBe(3);
      expect(body.minStaffingDuringHours).toBe(5);
      expect(body.minStaffingPostHours).toBe(2);
    } finally {
      await stopServer(server);
    }
  });
});

// ── 3. Special circumstances → AI prompt ─────────────────────────────────────

describe("POST /api/ai-scheduling/generate — special circumstances in AI prompt (Task #492)", () => {
  beforeEach(() => {
    resetMocks();
  });

  /**
   * The /api/ai-scheduling/generate route fires a long sequence of selects
   * before assembling its prompt. Each select uses Drizzle's chain-thenable
   * pattern, so we satisfy the entire sequence with `makeChain([...])`.
   *
   * Order assumed below:
   *   1. settings (per-store row)
   *   2. shops (active)
   *   3. users (active)
   *   4. userAvailability (date window)
   *   5. userWorkPatterns
   *   6. clockEvents (group-by perf scores)
   *   7. aiSchedulingRules
   *   8. specialCircumstances ← key test point
   */
  function wireGenerateSelects(specialRows: any[]) {
    const settingsRow = {
      id: "row-1",
      storeId: "store-xyz",
      shiftBlocks: [{ name: "Morning", startTime: "09:00", endTime: "17:00" }],
      staffingTiers: [],
      minimumStaffing: 2,
      storeHours: [],
      minStaffingPreHours: 1,
      minStaffingDuringHours: 2,
      minStaffingPostHours: 1,
      laborCostOverPct: "30",
      laborCostUnderPct: "10",
    };
    dbMock.select
      .mockReturnValueOnce(makeChain([settingsRow]))   // 1. settings
      .mockReturnValueOnce(makeChain([]))              // 2. shops
      .mockReturnValueOnce(makeChain([]))              // 3. users
      .mockReturnValueOnce(makeChain([]))              // 4. userAvailability
      .mockReturnValueOnce(makeChain([]))              // 5. userWorkPatterns
      .mockReturnValueOnce(makeChain([]))              // 6. clockEvents (group-by)
      .mockReturnValueOnce(makeChain([]))              // 7. aiSchedulingRules
      .mockReturnValueOnce(makeChain(specialRows));    // 8. specialCircumstances
  }

  function getPromptText(): string {
    expect(anthropicMock.messages.create).toHaveBeenCalledTimes(1);
    const callArgs = anthropicMock.messages.create.mock.calls[0][0];
    return callArgs.messages[0].content as string;
  }

  it("includes enabled special circumstances by name + category + description in the prompt", async () => {
    wireGenerateSelects([
      {
        id: "sc-1",
        storeId: "store-xyz",
        name: "Black Friday Weekend",
        description: "All hands on deck for the big sale",
        category: "promo",
        isEnabled: true,
      },
      {
        id: "sc-2",
        storeId: "store-xyz",
        name: "Inventory Count Day",
        description: "Closed to public, full staff",
        category: "operations",
        isEnabled: true,
      },
    ]);

    anthropicMock.messages.create.mockResolvedValue({
      content: [{ type: "text", text: '{"schedule":[],"summary":"","warnings":[]}' }],
    });

    const app = buildApp();
    const { server, base } = await startServer(app);
    try {
      const { status } = await jsonRequest(base, "/api/ai-scheduling/generate", {
        method: "POST",
        body: { startDate: "2026-05-01", endDate: "2026-05-07" },
      });
      expect(status).toBe(200);

      const prompt = getPromptText();
      expect(prompt).toContain("SPECIAL CIRCUMSTANCES");
      expect(prompt).toContain("Black Friday Weekend");
      expect(prompt).toContain("[promo]");
      expect(prompt).toContain("All hands on deck for the big sale");
      expect(prompt).toContain("Inventory Count Day");
      expect(prompt).toContain("[operations]");
      expect(prompt).toContain("Closed to public, full staff");
    } finally {
      await stopServer(server);
    }
  });

  it("omits the SPECIAL CIRCUMSTANCES block from the prompt when the isEnabled=true filter returns no rows", async () => {
    // The route's specialCircumstances SELECT carries an
    // `eq(isEnabled, true)` predicate — so disabled rows never make it into
    // the result set the prompt is built from. Modeling this by returning []
    // verifies the prompt-builder's gating condition.
    wireGenerateSelects([]);

    anthropicMock.messages.create.mockResolvedValue({
      content: [{ type: "text", text: '{"schedule":[],"summary":"","warnings":[]}' }],
    });

    const app = buildApp();
    const { server, base } = await startServer(app);
    try {
      const { status } = await jsonRequest(base, "/api/ai-scheduling/generate", {
        method: "POST",
        body: { startDate: "2026-05-01", endDate: "2026-05-07" },
      });
      expect(status).toBe(200);

      const prompt = getPromptText();
      expect(prompt).not.toContain("SPECIAL CIRCUMSTANCES");
    } finally {
      await stopServer(server);
    }
  });
});
