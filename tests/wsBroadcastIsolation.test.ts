/**
 * WebSocket broadcast isolation integration tests
 *
 * These tests close the gap left by the static-analysis and pure-function
 * layers in sensitiveDataBroadcast.test.ts.  They spin up a real in-process
 * Express + WebSocket server that uses the *actual* route handler code from
 * server/routes/communication.ts, connect genuine WebSocket clients from
 * different stores, fire store-scoped events via HTTP, and assert that
 * messages never leak to the out-of-store client.
 *
 * The DB-touching utility modules (storeResolver, permissionUtils) are mocked
 * at the module level so no database is required; everything else — the route
 * handler logic, sendToUsers, the WS connection map, the WS protocol itself —
 * runs exactly as it does in production.
 *
 * What this catches that the existing tests do NOT:
 *   • A future wiring mistake where a route accidentally passes the wrong
 *     recipient list (e.g. all users instead of same-store users) to sendToUsers
 *     would fail here even though the static-analysis and pure-function tests
 *     would still pass.
 */

import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";

// ─── Mock DB-touching modules before any route code is imported ───────────────
// These are the only module-level DB dependencies used by communication.ts.
// Everything else (route logic, sendToUsers) is exercised for real.

vi.mock("../server/services/storeResolver", () => ({
  tryResolveStoreIdForUser: vi.fn(),
}));

vi.mock("../server/lib/permissionUtils", () => ({
  getAllStoreUserIds: vi.fn(),
  getUserIdsWithPermission: vi.fn().mockResolvedValue([]),
}));

// ─── Real imports (must come AFTER vi.mock declarations) ─────────────────────
import { createServer, type Server as HttpServer } from "http";
import express, { type Express } from "express";
import { WebSocketServer, WebSocket } from "ws";
import type { AddressInfo } from "net";
import { registerCommunicationRoutes } from "../server/routes/communication";
import { tryResolveStoreIdForUser } from "../server/services/storeResolver";
import { getAllStoreUserIds } from "../server/lib/permissionUtils";

// ─── Type-cast mocks for easy configuration in each test ─────────────────────
const mockTryResolveStoreId = tryResolveStoreIdForUser as ReturnType<typeof vi.fn>;
const mockGetAllStoreUserIds = getAllStoreUserIds as ReturnType<typeof vi.fn>;

// ─── Store / user fixtures ────────────────────────────────────────────────────

const STORE_A = "store-alpha";
const STORE_B = "store-beta";

// store-A employees
const USER_A1 = "user-a1";
const USER_A2 = "user-a2";
// store-B employee
const USER_B1 = "user-b1";

// ─── Minimal in-process test server ──────────────────────────────────────────

interface TestServer {
  httpServer: HttpServer;
  port: number;
  close(): Promise<void>;
}

/**
 * Spin up an Express + WebSocket server that:
 *   - Registers the real registerCommunicationRoutes handler
 *   - Implements the same wsConnections + sendToUsers closure as production routes.ts
 *   - Uses a trivial isAuthenticated shim that injects `req.user` from a header
 *     so tests can impersonate any user without a session cookie
 *
 * The isAuthenticated shim is the ONLY deviation from production — it avoids
 * pulling in passport/session but does not alter the code under test.
 */
function buildTestServer(): Promise<TestServer> {
  return new Promise((resolve) => {
    const app: Express = express();
    app.use(express.json());

    // Thin auth shim: reads userId from X-Test-User-Id header.
    // Real auth is not exercised because it requires DB+sessions; the WS
    // isolation behaviour we care about lives in the route body and sendToUsers.
    const isAuthenticated = (req: any, _res: any, next: any) => {
      const userId = req.headers["x-test-user-id"] as string;
      if (!userId) return _res.status(401).json({ error: "no userId header" });
      req.user = { id: userId };
      next();
    };

    // Replicate production wsConnections + sendToUsers exactly from routes.ts
    const wsConnections = new Map<string, Set<{ ws: WebSocket }>>();

    function sendToUsers(userIds: string[], data: Record<string, unknown>) {
      const payload = JSON.stringify(data);
      for (const uid of userIds) {
        const conns = wsConnections.get(uid);
        if (!conns) continue;
        for (const conn of Array.from(conns)) {
          if (conn.ws.readyState === WebSocket.OPEN) {
            conn.ws.send(payload);
          }
        }
      }
    }

    // Minimal mock storage — only the methods touched by communication.ts
    const mockStorage: any = {
      getCompanySettings: vi.fn().mockResolvedValue(null), // no settings = shoutouts allowed
      createShoutout: vi.fn().mockImplementation((data: any) =>
        Promise.resolve({ id: "shoutout-1", ...data, reactions: [], createdAt: new Date() }),
      ),
      addShoutoutReaction: vi.fn().mockImplementation((_id: string, userId: string, emoji: string) =>
        Promise.resolve({ id: _id, userId, emoji }),
      ),
    };

    // Register the REAL route handler (not a copy)
    registerCommunicationRoutes(app, mockStorage, isAuthenticated, sendToUsers);

    const httpServer = createServer(app);
    const wss = new WebSocketServer({ server: httpServer });

    wss.on("connection", (ws, request) => {
      const url = new URL(request.url!, `http://localhost`);
      const userId = url.searchParams.get("userId");
      if (!userId) { ws.close(4001, "Missing userId"); return; }

      if (!wsConnections.has(userId)) wsConnections.set(userId, new Set());
      const conn = { ws };
      wsConnections.get(userId)!.add(conn);

      ws.on("close", () => {
        const conns = wsConnections.get(userId);
        if (conns) { conns.delete(conn); if (conns.size === 0) wsConnections.delete(userId); }
      });
    });

    httpServer.listen(0, "127.0.0.1", () => {
      const port = (httpServer.address() as AddressInfo).port;
      resolve({
        httpServer,
        port,
        close(): Promise<void> {
          return new Promise((res) => {
            wsConnections.forEach((conns) => conns.forEach((c) => { try { c.ws.terminate(); } catch { /**/ } }));
            wsConnections.clear();
            wss.close(() => httpServer.close(() => res()));
          });
        },
      });
    });
  });
}

// ─── WebSocket client helpers ─────────────────────────────────────────────────

function connectClient(port: number, userId: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/?userId=${userId}`);
    ws.once("open", () => resolve(ws));
    ws.once("error", reject);
  });
}

/** Resolves with the next message, or null if the timeout elapses first. */
function nextMessage(ws: WebSocket, timeoutMs = 800): Promise<Record<string, unknown> | null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => { ws.off("message", handler); resolve(null); }, timeoutMs);
    function handler(raw: Buffer | string) {
      clearTimeout(timer); ws.off("message", handler);
      try { resolve(JSON.parse(raw.toString())); } catch { resolve(null); }
    }
    ws.on("message", handler);
  });
}

/** Returns true only if NO message arrives within the window — isolation confirmed. */
function receivesNoMessage(ws: WebSocket, windowMs = 400): Promise<boolean> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => { ws.off("message", handler); resolve(true); }, windowMs);
    function handler() { clearTimeout(timer); ws.off("message", handler); resolve(false); }
    ws.on("message", handler);
  });
}

/** POST to /api/shoutouts impersonating the given userId. */
async function postShoutout(port: number, senderId: string) {
  const response = await fetch(`http://127.0.0.1:${port}/api/shoutouts`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-test-user-id": senderId,
    },
    body: JSON.stringify({
      senderId,
      recipientId: "recipient-1",
      category: "Team Player",
      message: "Great work!",
    }),
  });
  return response;
}

// ─── Test lifecycle ───────────────────────────────────────────────────────────

let server: TestServer;
let clientA1: WebSocket;
let clientA2: WebSocket;
let clientB1: WebSocket;

beforeEach(async () => {
  vi.clearAllMocks();

  // Configure store membership: store-A has A1+A2; store-B has B1
  mockTryResolveStoreId.mockImplementation((userId: string) => {
    if (userId === USER_A1 || userId === USER_A2) return Promise.resolve(STORE_A);
    if (userId === USER_B1) return Promise.resolve(STORE_B);
    return Promise.resolve(null);
  });

  mockGetAllStoreUserIds.mockImplementation((storeId: string) => {
    if (storeId === STORE_A) return Promise.resolve([USER_A1, USER_A2]);
    if (storeId === STORE_B) return Promise.resolve([USER_B1]);
    return Promise.resolve([]);
  });

  server = await buildTestServer();

  [clientA1, clientA2, clientB1] = await Promise.all([
    connectClient(server.port, USER_A1),
    connectClient(server.port, USER_A2),
    connectClient(server.port, USER_B1),
  ]);
});

afterEach(async () => {
  [clientA1, clientA2, clientB1].forEach((c) => { try { c.terminate(); } catch { /**/ } });
  await server.close();
});

// ─── shoutout_created isolation (via real POST /api/shoutouts) ────────────────

describe("shoutout_created — store-boundary isolation via real route handler", () => {
  it("store-A client receives shoutout_created when USER_A1 posts a shoutout", async () => {
    const [response, msg] = await Promise.all([
      postShoutout(server.port, USER_A1),
      nextMessage(clientA1),
    ]);

    expect(response.ok).toBe(true);
    expect(msg).not.toBeNull();
    expect((msg as Record<string, unknown>).type).toBe("shoutout_created");
  });

  it("second store-A client also receives shoutout_created", async () => {
    const [response, msgA2] = await Promise.all([
      postShoutout(server.port, USER_A1),
      nextMessage(clientA2),
    ]);

    expect(response.ok).toBe(true);
    expect(msgA2).not.toBeNull();
    expect((msgA2 as Record<string, unknown>).type).toBe("shoutout_created");
  });

  it("store-B client does NOT receive shoutout_created posted by a store-A user", async () => {
    const [response, isolatedB1] = await Promise.all([
      postShoutout(server.port, USER_A1),
      receivesNoMessage(clientB1),
    ]);

    expect(response.ok).toBe(true);
    expect(isolatedB1).toBe(true);
  });

  it("all store-A clients receive the event and store-B client is excluded simultaneously", async () => {
    const [response, msgA1, msgA2, isolatedB1] = await Promise.all([
      postShoutout(server.port, USER_A1),
      nextMessage(clientA1),
      nextMessage(clientA2),
      receivesNoMessage(clientB1),
    ]);

    expect(response.ok).toBe(true);
    expect(msgA1).not.toBeNull();
    expect(msgA2).not.toBeNull();
    expect((msgA1 as Record<string, unknown>).type).toBe("shoutout_created");
    expect((msgA2 as Record<string, unknown>).type).toBe("shoutout_created");
    expect(isolatedB1).toBe(true);
  });

  it("posting a shoutout from store-B is not delivered to any store-A client", async () => {
    const [response, isolatedA1, isolatedA2] = await Promise.all([
      postShoutout(server.port, USER_B1),
      receivesNoMessage(clientA1),
      receivesNoMessage(clientA2),
    ]);

    expect(response.ok).toBe(true);
    expect(isolatedA1).toBe(true);
    expect(isolatedA2).toBe(true);
  });

  it("store-B client receives its own store's shoutout", async () => {
    const [response, msgB1] = await Promise.all([
      postShoutout(server.port, USER_B1),
      nextMessage(clientB1),
    ]);

    expect(response.ok).toBe(true);
    expect(msgB1).not.toBeNull();
    expect((msgB1 as Record<string, unknown>).type).toBe("shoutout_created");
  });
});

// ─── shoutout_reaction isolation ─────────────────────────────────────────────

describe("shoutout_reaction — store-boundary isolation via real route handler", () => {
  async function postReaction(port: number, userId: string, shoutoutId = "shoutout-1") {
    return fetch(`http://127.0.0.1:${port}/api/shoutouts/${shoutoutId}/react`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-test-user-id": userId },
      body: JSON.stringify({ emoji: "🎉" }),
    });
  }

  it("store-A client receives shoutout_reaction from a store-A user", async () => {
    const [response, msg] = await Promise.all([
      postReaction(server.port, USER_A1),
      nextMessage(clientA1),
    ]);

    expect(response.ok).toBe(true);
    expect(msg).not.toBeNull();
    expect((msg as Record<string, unknown>).type).toBe("shoutout_reaction");
  });

  it("store-B client does NOT receive shoutout_reaction from a store-A user", async () => {
    const [response, isolatedB1] = await Promise.all([
      postReaction(server.port, USER_A1),
      receivesNoMessage(clientB1),
    ]);

    expect(response.ok).toBe(true);
    expect(isolatedB1).toBe(true);
  });

  it("store-A clients are excluded from a store-B reaction", async () => {
    const [response, isolatedA1, isolatedA2] = await Promise.all([
      postReaction(server.port, USER_B1),
      receivesNoMessage(clientA1),
      receivesNoMessage(clientA2),
    ]);

    expect(response.ok).toBe(true);
    expect(isolatedA1).toBe(true);
    expect(isolatedA2).toBe(true);
  });
});
