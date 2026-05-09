/**
 * Regression tests for PATCH /api/schedules/:id (Task #708)
 *
 * Locks in the field-stripping + timezone-safe coercion behavior introduced
 * in Task #700 to fix the "edit shift, save, re-save" bug. Without these
 * tests, the next refactor of the per-shift PATCH route can silently
 * regress in two ways:
 *
 *   1. The route stops stripping protected/identity fields (id, storeId,
 *      createdAt, updatedAt) from the body. Some Drizzle adapters surface
 *      "column id cannot be updated" errors, breaking the save flow.
 *   2. startTime/endTime stops being coerced from ISO string → Date, OR a
 *      round-trip through PATCH + re-fetch + re-PATCH drifts the wall-clock
 *      time by a tz offset.
 *
 * The CreateShiftSplitPanel sometimes posts the full schedule object as the
 * PATCH body (carrying every column it just read), so both behaviors above
 * have to remain invariant.
 */

import { vi, describe, it, expect, beforeEach } from "vitest";
import type { AddressInfo } from "net";
import http from "http";
import express from "express";

// ── Hoist mocks (mirror tests/scheduleBulkPatchSecurity.test.ts) ────────────

const dbMock = vi.hoisted(() => ({
  transaction: vi.fn(),
  select: vi.fn(),
  update: vi.fn(),
  insert: vi.fn(),
  delete: vi.fn(),
}));

vi.mock("../server/db", () => ({ db: dbMock }));
vi.mock("../server/services/storeResolver", () => ({
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
  notificationService: { sendScheduleUpdate: vi.fn().mockResolvedValue(undefined) },
}));
vi.mock("../server/services/claudeService", () => ({ claudeService: {} }));
vi.mock("../server/lib/logger", () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock("@clerk/express", () => ({
  clerkClient: { users: { getUser: vi.fn() } },
  clerkMiddleware: () => (_req: unknown, _res: unknown, next: () => void) => next(),
  requireAuth: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));

import { registerScheduleRoutes } from "../server/routes/schedules";

// ── Helpers ─────────────────────────────────────────────────────────────────

interface UpdateCall {
  id: string;
  body: Record<string, unknown>;
}

function buildApp(opts: {
  /** Captures every call to storage.updateSchedule(id, body). */
  updateCalls: UpdateCall[];
  /** Optional override for what storage.updateSchedule returns. */
  updateImpl?: (id: string, body: Record<string, unknown>) => Promise<any>;
  /** Whether the requesting user has schedule.manage permission. */
  isManager?: boolean;
}) {
  const app = express();
  app.use(express.json());

  const isAuthenticated = (req: any, _res: any, next: () => void) => {
    req.user = { id: "user-1", role: { name: "admin" } };
    next();
  };

  const storage: any = {
    getUserPermissions: vi.fn().mockResolvedValue(
      opts.isManager === false ? [] : [{ name: "schedule.manage" }],
    ),
    getUser: vi.fn(),
    updateSchedule: vi.fn(async (id: string, body: Record<string, unknown>) => {
      opts.updateCalls.push({ id, body: { ...body } });
      if (opts.updateImpl) return opts.updateImpl(id, body);
      // Default: echo back the patch as the "updated" row, with the id
      // re-attached and userId defaulted so the broadcast path doesn't crash.
      return {
        id,
        userId: "user-1",
        startTime: body.startTime ?? new Date(),
        endTime: body.endTime ?? new Date(),
        title: body.title ?? null,
        locationId: body.locationId ?? null,
        ...body,
      };
    }),
  };

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

async function patchSchedule(base: string, id: string, body: unknown) {
  const res = await fetch(`${base}/api/schedules/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: await res.json().catch(() => ({})) };
}

beforeEach(() => {
  dbMock.transaction.mockReset();
});

describe("PATCH /api/schedules/:id — body sanitization (Task #700, regression)", () => {
  it("strips id/storeId/createdAt/updatedAt and still applies allowed fields", async () => {
    const updateCalls: UpdateCall[] = [];
    const app = buildApp({ updateCalls });
    const { server, base } = await startServer(app);
    try {
      const fullSchedule = {
        // Identity / managed columns the panel sometimes posts back verbatim:
        id: "sched-other",
        storeId: "store-evil",
        createdAt: "2026-04-01T00:00:00.000Z",
        updatedAt: "2026-04-26T12:00:00.000Z",
        // Mutable fields the user actually edited:
        startTime: "2026-04-26T17:00:00.000Z",
        endTime: "2026-04-27T01:00:00.000Z",
        title: "Closing",
        locationId: "loc-store-A",
      };
      const r = await patchSchedule(base, "sched-1", fullSchedule);
      expect(r.status).toBe(200);
      expect(updateCalls).toHaveLength(1);
      const { id, body } = updateCalls[0];
      // The path id wins — the body's id never reaches storage.
      expect(id).toBe("sched-1");
      expect(body).not.toHaveProperty("id");
      expect(body).not.toHaveProperty("storeId");
      expect(body).not.toHaveProperty("createdAt");
      expect(body).not.toHaveProperty("updatedAt");
      // Allowed fields land intact, and time strings are coerced to Date.
      expect(body.title).toBe("Closing");
      expect(body.locationId).toBe("loc-store-A");
      expect(body.startTime).toBeInstanceOf(Date);
      expect(body.endTime).toBeInstanceOf(Date);
      expect((body.startTime as Date).toISOString()).toBe("2026-04-26T17:00:00.000Z");
      expect((body.endTime as Date).toISOString()).toBe("2026-04-27T01:00:00.000Z");
    } finally {
      await stopServer(server);
    }
  });

  it("preserves userId in the body so reassignment from the edit panel still works", async () => {
    // userId is intentionally NOT stripped — reassigning a shift to a
    // different employee from the edit panel is a supported flow.
    const updateCalls: UpdateCall[] = [];
    const app = buildApp({ updateCalls });
    const { server, base } = await startServer(app);
    try {
      const r = await patchSchedule(base, "sched-1", {
        id: "sched-1",
        userId: "user-new-assignee",
        title: "Reassigned",
      });
      expect(r.status).toBe(200);
      expect(updateCalls[0].body.userId).toBe("user-new-assignee");
      expect(updateCalls[0].body.title).toBe("Reassigned");
      expect(updateCalls[0].body).not.toHaveProperty("id");
    } finally {
      await stopServer(server);
    }
  });

  it("returns 404 when storage.updateSchedule reports no row was updated", async () => {
    const updateCalls: UpdateCall[] = [];
    const app = buildApp({
      updateCalls,
      updateImpl: async () => undefined,
    });
    const { server, base } = await startServer(app);
    try {
      const r = await patchSchedule(base, "missing", { title: "x" });
      expect(r.status).toBe(404);
    } finally {
      await stopServer(server);
    }
  });

  it("requires schedule.manage permission (403 otherwise)", async () => {
    const updateCalls: UpdateCall[] = [];
    const app = buildApp({ updateCalls, isManager: false });
    const { server, base } = await startServer(app);
    try {
      const r = await patchSchedule(base, "sched-1", { title: "nope" });
      expect(r.status).toBe(403);
      expect(updateCalls).toHaveLength(0);
    } finally {
      await stopServer(server);
    }
  });
});

describe("PATCH /api/schedules/:id — repeated saves preserve wall-clock time (Task #700, regression)", () => {
  // Bug repro: the panel sends startTime as an ISO string. The server
  // coerces it via `new Date(string)`. The client then re-fetches the row
  // (which serializes the Date back to ISO via JSON.stringify), edits an
  // unrelated field, and PATCHes again. Each round-trip must keep the
  // exact same instant — no tz drift, no "+1 hour" creep.
  it("save → re-fetch → save again keeps the same instant for startTime/endTime", async () => {
    const updateCalls: UpdateCall[] = [];
    // Simulate a real DB round-trip: storage returns rows whose Date
    // fields would re-serialize as ISO strings on the wire.
    const app = buildApp({
      updateCalls,
      updateImpl: async (_id, body) => ({
        id: "sched-1",
        userId: "user-1",
        title: body.title ?? "Original",
        locationId: body.locationId ?? "loc-store-A",
        // Echo back what was written, as a Date (drizzle returns Date for timestamp cols).
        startTime: body.startTime instanceof Date ? body.startTime : new Date(body.startTime as string),
        endTime: body.endTime instanceof Date ? body.endTime : new Date(body.endTime as string),
      }),
    });
    const { server, base } = await startServer(app);
    try {
      const startIso = "2026-04-26T17:00:00.000Z";
      const endIso = "2026-04-27T01:00:00.000Z";

      // First save — fresh from the form.
      const r1 = await patchSchedule(base, "sched-1", {
        startTime: startIso,
        endTime: endIso,
        title: "First save",
      });
      expect(r1.status).toBe(200);
      // Server JSON-serializes Date back to ISO.
      expect(r1.json.startTime).toBe(startIso);
      expect(r1.json.endTime).toBe(endIso);

      // Simulate the panel re-using the server's response as its new
      // form state, then re-saving (e.g. with a tweaked title). This is
      // the path that USED to drift by a tz offset because the body
      // included a Date already-stringified by JSON.stringify on the wire.
      const r2 = await patchSchedule(base, "sched-1", {
        ...r1.json,                      // round-tripped row → contains ISO strings
        title: "Second save",           // unrelated edit
      });
      expect(r2.status).toBe(200);

      // Both saves must have written the same Date instants to storage.
      expect(updateCalls).toHaveLength(2);
      const firstStart = updateCalls[0].body.startTime as Date;
      const secondStart = updateCalls[1].body.startTime as Date;
      const firstEnd = updateCalls[0].body.endTime as Date;
      const secondEnd = updateCalls[1].body.endTime as Date;

      expect(firstStart.toISOString()).toBe(startIso);
      expect(secondStart.toISOString()).toBe(startIso);
      expect(firstEnd.toISOString()).toBe(endIso);
      expect(secondEnd.toISOString()).toBe(endIso);
      expect(firstStart.getTime()).toBe(secondStart.getTime());
      expect(firstEnd.getTime()).toBe(secondEnd.getTime());
    } finally {
      await stopServer(server);
    }
  });

  it("still coerces strings to Date even when the body contains stripped fields", async () => {
    // Defense-in-depth: even when the body is the full schedule object
    // (id/storeId/createdAt/updatedAt all present), the time coercion
    // still has to run on whatever's left after stripping.
    const updateCalls: UpdateCall[] = [];
    const app = buildApp({ updateCalls });
    const { server, base } = await startServer(app);
    try {
      const r = await patchSchedule(base, "sched-1", {
        id: "sched-1",
        storeId: "store-A",
        createdAt: "2025-01-01T00:00:00.000Z",
        updatedAt: "2026-04-26T12:00:00.000Z",
        startTime: "2026-04-26T09:00:00.000Z",
        endTime: "2026-04-26T13:00:00.000Z",
      });
      expect(r.status).toBe(200);
      const body = updateCalls[0].body;
      expect(body.startTime).toBeInstanceOf(Date);
      expect(body.endTime).toBeInstanceOf(Date);
      expect((body.startTime as Date).toISOString()).toBe("2026-04-26T09:00:00.000Z");
      expect((body.endTime as Date).toISOString()).toBe("2026-04-26T13:00:00.000Z");
    } finally {
      await stopServer(server);
    }
  });
});
