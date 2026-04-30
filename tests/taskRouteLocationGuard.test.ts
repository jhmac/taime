/**
 * taskRouteLocationGuard.test.ts
 *
 * Route-level tests asserting that non-admin managers whose location cannot be
 * resolved (tryResolveStoreIdForUser → null) receive HTTP 403 on every location-
 * scoped task endpoint.  This prevents the fail-open regression where a null
 * locationId caused the guard condition to silently pass and grant cross-location
 * access.
 *
 * Endpoints covered:
 *  - GET  /api/tasks/clocked-in-count
 *  - GET  /api/tasks/verification-queue
 *  - POST /api/tasks/:id/broadcast
 *  - GET  /api/tasks/broadcast-summary
 *  - GET  /api/tasks/:id/broadcast-progress
 *  - GET  /api/tasks/:id/assignees
 *  - PATCH /api/tasks/:id/assignees/:aId/approve
 *  - PATCH /api/tasks/:id/assignees/:aId/reject
 */

import { vi, describe, it, expect, beforeAll, afterAll } from "vitest";
import type { AddressInfo } from "net";
import http from "http";

// ─── Hoisted mock factories ───────────────────────────────────────────────────

const storeResolverMock = vi.hoisted(() => ({
  tryResolveStoreIdForUser: vi.fn().mockResolvedValue(null), // misconfigured manager — no location
}));

const notificationMock = vi.hoisted(() => ({
  notificationService: {
    sendToUser: vi.fn().mockResolvedValue(undefined),
    sendTaskAssignment: vi.fn().mockResolvedValue(undefined),
  },
}));

const aiMock = vi.hoisted(() => ({
  runAutoAssign: vi.fn().mockResolvedValue(undefined),
}));

// ─── Module mocks ─────────────────────────────────────────────────────────────

vi.mock("../server/services/storeResolver", () => storeResolverMock);
vi.mock("../server/services/notificationService", () => notificationMock);
vi.mock("../server/routes/ai", () => aiMock);

// ─── Constants ────────────────────────────────────────────────────────────────

const TASK_ID = "task-abc";
const ASSIGNEE_ID = "assignee-xyz";
const MANAGER_ID = "mgr-no-loc";

const managerPermissions = [{ name: "hr.manage_employees" }];

// ─── Minimal storage stub ─────────────────────────────────────────────────────

function makeStorage() {
  return {
    getUserPermissions: vi.fn().mockResolvedValue(managerPermissions),
    getTask: vi.fn().mockResolvedValue({ id: TASK_ID, locationId: "loc-1", title: "T" }),
    getTaskAssignees: vi.fn().mockResolvedValue([
      { id: ASSIGNEE_ID, taskId: TASK_ID, userId: "emp-1", status: "completed" },
    ]),
    getClockedInEmployeeCount: vi.fn().mockResolvedValue(0),
    getPendingVerifications: vi.fn().mockResolvedValue([]),
    broadcastTask: vi.fn().mockResolvedValue({ assignees: [], count: 0 }),
    getAllTaskBroadcastSummary: vi.fn().mockResolvedValue({}),
    getTaskBroadcastProgress: vi.fn().mockResolvedValue({ total: 0, approved: 0, completed: 0, in_progress: 0, pending: 0, rejected: 0 }),
    updateTaskAssignee: vi.fn(),
    getCompletionStreak: vi.fn().mockResolvedValue(1),
    getAllTasks: vi.fn().mockResolvedValue([]),
    createTask: vi.fn(),
    updateTask: vi.fn(),
    deleteTask: vi.fn(),
    getMyBroadcastAssignments: vi.fn().mockResolvedValue([]),
    getTaskAssignee: vi.fn(),
    createRedoAssignment: vi.fn(),
  } as any;
}

// ─── Server setup ─────────────────────────────────────────────────────────────

let server: http.Server;
let baseUrl: string;

beforeAll(async () => {
  const express = (await import("express")).default;
  const { registerTaskRoutes } = await import("../server/routes/tasks");

  const app = express();
  app.use(express.json());

  // Fake isAuthenticated — injects a manager with no location
  const isAuthenticated = (req: any, _res: any, next: any) => {
    req.user = { id: MANAGER_ID };
    next();
  };

  const storage = makeStorage();
  const broadcastToAll = vi.fn();
  const sendToUsers = vi.fn();

  registerTaskRoutes(app, storage, isAuthenticated, broadcastToAll, sendToUsers);

  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", resolve);
  });
  const { port } = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${port}`;
});

afterAll(() => {
  server?.close();
});

// ─── Helper ───────────────────────────────────────────────────────────────────

async function req(method: string, path: string, body?: object): Promise<{ status: number; json: any }> {
  return new Promise((resolve, reject) => {
    const url = new URL(path, baseUrl);
    const bodyStr = body ? JSON.stringify(body) : undefined;
    const options: http.RequestOptions = {
      hostname: url.hostname,
      port: Number(url.port),
      path: url.pathname,
      method,
      headers: {
        "Content-Type": "application/json",
        ...(bodyStr ? { "Content-Length": Buffer.byteLength(bodyStr) } : {}),
      },
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
    if (bodyStr) r.write(bodyStr);
    r.end();
  });
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("fail-closed location guard — misconfigured non-admin manager (storeResolver returns null)", () => {
  it("GET /api/tasks/clocked-in-count returns 403 when location unresolvable", async () => {
    const { status } = await req("GET", "/api/tasks/clocked-in-count");
    expect(status).toBe(403);
  });

  it("GET /api/tasks/verification-queue returns 403 when location unresolvable", async () => {
    const { status } = await req("GET", "/api/tasks/verification-queue");
    expect(status).toBe(403);
  });

  it("POST /api/tasks/:id/broadcast returns 403 when location unresolvable", async () => {
    const { status } = await req("POST", `/api/tasks/${TASK_ID}/broadcast`);
    expect(status).toBe(403);
  });

  it("GET /api/tasks/broadcast-summary returns 403 when location unresolvable", async () => {
    const { status } = await req("GET", "/api/tasks/broadcast-summary");
    expect(status).toBe(403);
  });

  it("GET /api/tasks/:id/broadcast-progress returns 403 when location unresolvable", async () => {
    const { status } = await req("GET", `/api/tasks/${TASK_ID}/broadcast-progress`);
    expect(status).toBe(403);
  });

  it("GET /api/tasks/:id/assignees returns 403 when location unresolvable", async () => {
    const { status } = await req("GET", `/api/tasks/${TASK_ID}/assignees`);
    expect(status).toBe(403);
  });

  it("PATCH /api/tasks/:id/assignees/:aId/approve returns 403 when location unresolvable", async () => {
    const { status } = await req("PATCH", `/api/tasks/${TASK_ID}/assignees/${ASSIGNEE_ID}/approve`);
    expect(status).toBe(403);
  });

  it("PATCH /api/tasks/:id/assignees/:aId/reject returns 403 when location unresolvable", async () => {
    const { status } = await req(
      "PATCH",
      `/api/tasks/${TASK_ID}/assignees/${ASSIGNEE_ID}/reject`,
      { rejectionNote: "needs work" },
    );
    expect(status).toBe(403);
  });
});
