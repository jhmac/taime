/**
 * Security tests for PATCH /api/schedules/bulk
 *
 * Task #387 introduced bulk schedule operations. This file pins down the field
 * allowlist that protects the endpoint from cross-user / cross-store hijacks.
 *
 * Specifically verifies:
 *  1. `userId` in the patch body is silently dropped (cannot reassign shifts).
 *  2. `storeId` in the patch body is silently dropped.
 *  3. `locationId` is validated via storage.getWorkLocation; unknown IDs drop.
 *  4. Rows whose entire patch is filtered out are skipped (no spurious update).
 *  5. Allowed fields (title, description, status, shiftType, startTime,
 *     endTime, validated locationId) DO get applied.
 *
 * Mocks db with a fake transaction implementation so we can assert exactly
 * which fields land in `tx.update(...).set(patch)`.
 */

import { vi, describe, it, expect, beforeEach } from "vitest";
import type { AddressInfo } from "net";
import http from "http";
import express from "express";

// ── Hoist mocks ─────────────────────────────────────────────────────────────

const dbMock = vi.hoisted(() => ({
  transaction: vi.fn(),
  select: vi.fn(),
  update: vi.fn(),
  insert: vi.fn(),
  delete: vi.fn(),
}));

vi.mock("../server/db", () => ({ db: dbMock }));
vi.mock("../server/lib/storeResolver", () => ({
  tryResolveStoreIdForUser: vi.fn().mockResolvedValue("store-A"),
}));
vi.mock("../server/lib/permissionUtils", () => ({
  getAllStoreUserIds: vi.fn().mockResolvedValue(["user-1", "user-2"]),
}));
vi.mock("../server/lib/broadcastRecipients", () => ({
  computeScheduleStoreRecipients: vi.fn().mockResolvedValue([]),
  computeScheduleDmRecipients: vi.fn().mockResolvedValue([]),
}));
vi.mock("../server/services/notificationService", () => ({
  notificationService: {
    sendScheduleUpdate: vi.fn().mockResolvedValue(undefined),
  },
}));
vi.mock("../server/services/claudeService", () => ({
  claudeService: {},
}));
vi.mock("../server/lib/logger", () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock("@clerk/express", () => ({
  clerkClient: { users: { getUser: vi.fn() } },
  clerkMiddleware: () => (_req: unknown, _res: unknown, next: () => void) => next(),
  requireAuth: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));

import { registerScheduleRoutes } from "../server/routes/schedules";

// ── Per-test app builder ────────────────────────────────────────────────────

interface TxRecorder {
  setCalls: Array<Record<string, unknown>>;
}

function buildApp(opts: {
  existingRows: Array<{ id: string; userId: string; startTime: Date; endTime: Date }>;
  knownLocationIds?: Set<string>;
  recorder: TxRecorder;
}) {
  const app = express();
  app.use(express.json());

  const isAuthenticated = (req: any, _res: any, next: () => void) => {
    req.user = { id: "user-1", role: { name: "admin" } };
    next();
  };

  const storage: any = {
    getUserPermissions: vi.fn().mockResolvedValue([{ name: "schedule.manage" }]),
    getWorkLocation: vi.fn(async (id: string) =>
      opts.knownLocationIds?.has(id) ? { id, name: `loc-${id}`, isActive: true } : undefined,
    ),
    getUser: vi.fn(),
  };

  // Build a fake transaction object that records every patch object passed to
  // `.set(patch)` so each test can assert on what would have been written.
  dbMock.transaction.mockImplementation(async (cb: any) => {
    const tx = {
      select: () => ({
        from: () => ({
          where: async () => opts.existingRows,
        }),
      }),
      update: () => ({
        set: (patch: Record<string, unknown>) => {
          opts.recorder.setCalls.push(patch);
          return {
            where: () => ({
              returning: async () => [{ id: "row-after-update", ...patch }],
            }),
          };
        },
      }),
    };
    return cb(tx);
  });

  registerScheduleRoutes(app, storage, isAuthenticated, () => {}, () => {});
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

async function patchBulk(base: string, body: unknown) {
  const res = await fetch(`${base}/api/schedules/bulk`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: await res.json().catch(() => ({})) };
}

const baseRow = {
  id: "sched-1",
  userId: "user-1",
  startTime: new Date("2026-04-26T09:00:00Z"),
  endTime: new Date("2026-04-26T13:00:00Z"),
};

beforeEach(() => {
  dbMock.transaction.mockReset();
});

describe("PATCH /api/schedules/bulk — field allowlist", () => {
  it("strips userId from the patch (cannot reassign shifts)", async () => {
    const recorder: TxRecorder = { setCalls: [] };
    const app = buildApp({ existingRows: [baseRow], recorder });
    const { server, base } = await startServer(app);
    try {
      const r = await patchBulk(base, {
        ids: ["sched-1"],
        op: { kind: "set", patch: { userId: "user-victim", title: "Renamed" } },
      });
      expect(r.status).toBe(200);
      expect(recorder.setCalls).toHaveLength(1);
      const patch = recorder.setCalls[0];
      expect(patch.userId).toBeUndefined();   // never written
      expect(patch.title).toBe("Renamed");    // allowed field still applied
    } finally {
      await stopServer(server);
    }
  });

  it("strips storeId from the patch", async () => {
    const recorder: TxRecorder = { setCalls: [] };
    const app = buildApp({ existingRows: [baseRow], recorder });
    const { server, base } = await startServer(app);
    try {
      const r = await patchBulk(base, {
        ids: ["sched-1"],
        op: { kind: "set", patch: { storeId: "other-store", description: "desc" } },
      });
      expect(r.status).toBe(200);
      const patch = recorder.setCalls[0];
      expect(patch.storeId).toBeUndefined();
      expect(patch.description).toBe("desc");
    } finally {
      await stopServer(server);
    }
  });

  it("drops locationId when it does not point to a real WorkLocation", async () => {
    const recorder: TxRecorder = { setCalls: [] };
    const app = buildApp({
      existingRows: [baseRow],
      knownLocationIds: new Set(["loc-real"]),
      recorder,
    });
    const { server, base } = await startServer(app);
    try {
      const r = await patchBulk(base, {
        ids: ["sched-1"],
        op: { kind: "set", patch: { locationId: "loc-fake", title: "Keep" } },
      });
      expect(r.status).toBe(200);
      const patch = recorder.setCalls[0];
      expect(patch.locationId).toBeUndefined(); // dropped silently
      expect(patch.title).toBe("Keep");
    } finally {
      await stopServer(server);
    }
  });

  it("keeps a valid locationId when storage confirms it exists in scope", async () => {
    const recorder: TxRecorder = { setCalls: [] };
    const app = buildApp({
      // The route only accepts locationIds whose id matches the requester's
      // resolved store (store-A here), so we use the storeId as the location.
      existingRows: [baseRow],
      knownLocationIds: new Set(["store-A"]),
      recorder,
    });
    const { server, base } = await startServer(app);
    try {
      const r = await patchBulk(base, {
        ids: ["sched-1"],
        op: { kind: "set", patch: { locationId: "store-A" } },
      });
      expect(r.status).toBe(200);
      const patch = recorder.setCalls[0];
      expect(patch.locationId).toBe("store-A");
    } finally {
      await stopServer(server);
    }
  });

  it("drops locationId for a foreign (out-of-scope) store even when it exists", async () => {
    const recorder: TxRecorder = { setCalls: [] };
    const app = buildApp({
      // loc-foreign exists in storage but does NOT belong to the requester's
      // store, so the route MUST drop it to prevent cross-store assignment.
      existingRows: [baseRow],
      knownLocationIds: new Set(["loc-foreign"]),
      recorder,
    });
    const { server, base } = await startServer(app);
    try {
      const r = await patchBulk(base, {
        ids: ["sched-1"],
        op: { kind: "set", patch: { locationId: "loc-foreign", description: "ok" } },
      });
      expect(r.status).toBe(200);
      const patch = recorder.setCalls[0];
      expect(patch.locationId).toBeUndefined();
      expect(patch.description).toBe("ok");
    } finally {
      await stopServer(server);
    }
  });

  it("skips rows entirely when the filtered patch is empty", async () => {
    const recorder: TxRecorder = { setCalls: [] };
    const app = buildApp({ existingRows: [baseRow], recorder });
    const { server, base } = await startServer(app);
    try {
      const r = await patchBulk(base, {
        ids: ["sched-1"],
        // userId + storeId are both stripped → patch is empty → no update issued
        op: { kind: "set", patch: { userId: "x", storeId: "y", createdAt: new Date().toISOString() } },
      });
      expect(r.status).toBe(200);
      expect(recorder.setCalls).toHaveLength(0);
      expect(r.json.updated).toEqual([]);
    } finally {
      await stopServer(server);
    }
  });

  it("applies all allowed fields together", async () => {
    const recorder: TxRecorder = { setCalls: [] };
    const app = buildApp({
      // Use the requester's storeId as the locationId so the in-scope check
      // passes (route requires loc.id === storeId for cross-store safety).
      existingRows: [baseRow],
      knownLocationIds: new Set(["store-A"]),
      recorder,
    });
    const { server, base } = await startServer(app);
    try {
      const r = await patchBulk(base, {
        ids: ["sched-1"],
        op: {
          kind: "set",
          patch: {
            startTime: "2026-04-26T10:00:00Z",
            endTime: "2026-04-26T14:00:00Z",
            title: "Cover",
            description: "Cover for sick call-out",
            status: "scheduled",
            shiftType: "regular",
            locationId: "store-A",
            userId: "evil",       // dropped
            id: "sched-other",    // dropped
          },
        },
      });
      expect(r.status).toBe(200);
      const patch = recorder.setCalls[0];
      expect(Object.keys(patch).sort()).toEqual(
        ["description", "endTime", "locationId", "shiftType", "startTime", "status", "title"].sort(),
      );
      expect(patch.startTime).toBeInstanceOf(Date);
      expect(patch.endTime).toBeInstanceOf(Date);
    } finally {
      await stopServer(server);
    }
  });

  it("requires schedule.manage permission (403 otherwise)", async () => {
    const app = express();
    app.use(express.json());
    const isAuthenticated = (req: any, _res: any, next: () => void) => {
      req.user = { id: "user-3" };
      next();
    };
    const storage: any = {
      getUserPermissions: vi.fn().mockResolvedValue([]), // no manage perm
      getWorkLocation: vi.fn(),
    };
    registerScheduleRoutes(app, storage, isAuthenticated);
    const { server, base } = await startServer(app);
    try {
      const r = await patchBulk(base, { ids: ["sched-1"], op: { kind: "set", patch: { title: "x" } } });
      expect(r.status).toBe(403);
    } finally {
      await stopServer(server);
    }
  });
});
