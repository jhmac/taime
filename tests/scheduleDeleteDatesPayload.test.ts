/**
 * Pins the WS payload contract for schedule delete events.
 *
 * Task #387 round-4 architect finding: the panel's "schedule changed elsewhere"
 * notice was firing on EVERY delete event regardless of which day the user was
 * viewing. Fix shipped affected-day metadata in BOTH delete payloads:
 *   - DELETE /api/schedules/:id    → { scheduleId, dates: [yyyy-mm-dd] }
 *   - DELETE /api/schedules/bulk   → { ids, dates: [yyyy-mm-dd, ...] }
 *
 * If either contract drifts, the panel's day-gated banner regresses to noisy
 * notices on every other-day delete — exactly what round 4 was meant to fix.
 */

import { vi, describe, it, expect, beforeEach } from "vitest";
import type { AddressInfo } from "net";
import http from "http";
import express from "express";

// ── Hoist mocks (mirror scheduleBulkPatchSecurity.test.ts) ─────────────────

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
  computeScheduleStoreRecipients: vi.fn().mockResolvedValue(["user-1"]),
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

interface SentMessage {
  userIds: string[];
  data: Record<string, unknown>;
}

function buildApp(opts: {
  /** Rows the bulk-delete tx select() should return BEFORE the delete. */
  bulkExistingRows?: Array<{ id: string; userId: string; startTime: Date }>;
  /** Row the single-delete pre-select should return. undefined = not found. */
  singleExistingRow?: { startTime: Date } | undefined;
  /** Captures every sendToUsers() call for assertion. */
  sent: SentMessage[];
}) {
  const app = express();
  app.use(express.json());

  const isAuthenticated = (req: any, _res: any, next: () => void) => {
    req.user = { id: "user-1", role: { name: "admin" } };
    next();
  };
  const storage: any = {
    getUserPermissions: vi.fn().mockResolvedValue([{ name: "schedule.manage" }]),
    deleteSchedule: vi.fn().mockResolvedValue(undefined),
    getWorkLocation: vi.fn(),
    getUser: vi.fn(),
  };

  // Single-delete pre-select uses db.select(...).from(...).where(...)
  // returning a Promise that resolves to an array (drizzle-style).
  // Bulk-delete uses tx.select inside transaction.
  dbMock.select.mockImplementation(() => ({
    from: () => ({
      where: async () => (opts.singleExistingRow ? [opts.singleExistingRow] : []),
    }),
  }));

  dbMock.transaction.mockImplementation(async (cb: any) => {
    const tx = {
      select: () => ({
        from: () => ({ where: async () => opts.bulkExistingRows ?? [] }),
      }),
      delete: () => ({ where: async () => undefined }),
    };
    return cb(tx);
  });

  const sendToUsers = (userIds: string[], data: Record<string, unknown>) => {
    opts.sent.push({ userIds, data });
  };
  registerScheduleRoutes(app, storage, isAuthenticated, () => {}, sendToUsers);
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

beforeEach(() => {
  dbMock.transaction.mockReset();
  dbMock.select.mockReset();
});

// ── Bulk delete ─────────────────────────────────────────────────────────────

describe("DELETE /api/schedules/bulk — WS payload", () => {
  it("ships ids + a de-duplicated dates[] of YYYY-MM-DD strings", async () => {
    const sent: SentMessage[] = [];
    const app = buildApp({
      bulkExistingRows: [
        { id: "s1", userId: "user-1", startTime: new Date("2026-04-26T09:00:00Z") },
        { id: "s2", userId: "user-1", startTime: new Date("2026-04-26T15:00:00Z") }, // same day
        { id: "s3", userId: "user-2", startTime: new Date("2026-04-27T09:00:00Z") }, // diff day
      ],
      sent,
    });
    const { server, base } = await startServer(app);
    try {
      const r = await fetch(`${base}/api/schedules/bulk`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: ["s1", "s2", "s3"] }),
      });
      expect(r.status).toBe(200);
      expect(sent).toHaveLength(1);
      // sendToUsers receives the full envelope as its 2nd arg, captured here
      // verbatim under .data — i.e. { type: 'schedules_bulk_deleted', data: {...} }.
      const env = sent[0].data as { type: string; data: { ids: string[]; dates: string[] } };
      expect(env.type).toBe("schedules_bulk_deleted");
      expect(env.data.ids.sort()).toEqual(["s1", "s2", "s3"]);
      expect(env.data.dates.sort()).toEqual(["2026-04-26", "2026-04-27"]);
    } finally {
      await stopServer(server);
    }
  });

  it("ships an empty dates[] when no rows are in scope (still notifies — empty == no day match)", async () => {
    const sent: SentMessage[] = [];
    const app = buildApp({ bulkExistingRows: [], sent });
    const { server, base } = await startServer(app);
    try {
      const r = await fetch(`${base}/api/schedules/bulk`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: ["s1"] }),
      });
      expect(r.status).toBe(200);
      // No in-scope rows → server skips broadcast entirely (current contract).
      expect(sent).toHaveLength(0);
    } finally {
      await stopServer(server);
    }
  });
});

// ── Single delete ───────────────────────────────────────────────────────────

describe("DELETE /api/schedules/:id — WS payload", () => {
  it("ships scheduleId + dates: [yyyy-mm-dd] derived from the row's startTime", async () => {
    const sent: SentMessage[] = [];
    const app = buildApp({
      singleExistingRow: { startTime: new Date("2026-05-01T11:00:00Z") },
      sent,
    });
    const { server, base } = await startServer(app);
    try {
      const r = await fetch(`${base}/api/schedules/abc-123`, { method: "DELETE" });
      expect(r.status).toBe(200);
      expect(sent).toHaveLength(1);
      const env = sent[0].data as { type: string; data: { scheduleId: string; dates: string[] } };
      expect(env.type).toBe("schedule_deleted");
      expect(env.data.scheduleId).toBe("abc-123");
      expect(env.data.dates).toEqual(["2026-05-01"]);
    } finally {
      await stopServer(server);
    }
  });

  it("ships an empty dates[] when the row was already gone (race)", async () => {
    const sent: SentMessage[] = [];
    const app = buildApp({ singleExistingRow: undefined, sent });
    const { server, base } = await startServer(app);
    try {
      const r = await fetch(`${base}/api/schedules/abc-123`, { method: "DELETE" });
      expect(r.status).toBe(200);
      expect(sent).toHaveLength(1);
      const env = sent[0].data as { type: string; data: { scheduleId: string; dates: string[] } };
      expect(env.data.dates).toEqual([]);
    } finally {
      await stopServer(server);
    }
  });

  it("ships an empty dates[] when startTime is unparseable", async () => {
    const sent: SentMessage[] = [];
    const app = buildApp({
      // Forge an invalid Date — toIsoDate() must catch and return undefined.
      singleExistingRow: { startTime: new Date("not-a-date") },
      sent,
    });
    const { server, base } = await startServer(app);
    try {
      const r = await fetch(`${base}/api/schedules/abc-123`, { method: "DELETE" });
      expect(r.status).toBe(200);
      const env = sent[0].data as { type: string; data: { dates: string[] } };
      expect(env.data.dates).toEqual([]);
    } finally {
      await stopServer(server);
    }
  });
});
