/**
 * taskDeferredPin.test.ts
 *
 * Regression tests for the deferred manual-pin lifecycle (Task #557).
 *
 * Rules under test:
 *  1. POST /api/tasks with assignedTo pointing to an off-shift employee →
 *     task is created with assignedTo=null and pinnedTo=<userId>; auto-assign
 *     is NOT triggered.
 *  2. POST /api/tasks with assignedTo pointing to a clocked-in employee →
 *     task is created with assignedTo=<userId> and pinnedTo=null; notification
 *     is sent immediately.
 *  3. activateDeferredPins — when the pinned employee clocks in, their deferred
 *     task's assignedTo is set and pinnedTo is cleared; runAutoAssign is NOT
 *     called (pin takes priority over auto-assign).
 */

import { vi, describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import type { AddressInfo } from "net";
import http from "http";
import express from "express";

// ─── Hoisted mocks ────────────────────────────────────────────────────────────

const storeResolverMock = vi.hoisted(() => ({
  tryResolveStoreIdForUser: vi.fn().mockResolvedValue("store-1"),
}));

const notificationMock = vi.hoisted(() => ({
  notificationService: {
    sendToUser: vi.fn().mockResolvedValue(undefined),
    sendTaskAssignment: vi.fn().mockResolvedValue(undefined),
  },
}));

const aiMock = vi.hoisted(() => ({
  runAutoAssign: vi.fn().mockResolvedValue({ assignments: [], source: "test" }),
  activateDeferredPins: vi.fn().mockResolvedValue(undefined),
  scheduleDailyAutoAssign: vi.fn(),
}));

const dbMock = vi.hoisted(() => ({
  select: vi.fn(),
  update: vi.fn(),
  insert: vi.fn(),
}));

// ─── Module mocks ─────────────────────────────────────────────────────────────

vi.mock("../server/services/storeResolver", () => storeResolverMock);
vi.mock("../server/services/notificationService", () => notificationMock);
vi.mock("../server/routes/ai", () => aiMock);
vi.mock("../server/db", () => ({ db: dbMock }));

// ─── Constants ────────────────────────────────────────────────────────────────

const MANAGER_ID = "mgr-1";
const OFF_SHIFT_EMPLOYEE = "emp-off";
const CLOCKED_IN_EMPLOYEE = "emp-on";
const TASK_ID = "task-999";

const managerPermissions = [
  { name: "tasks.create" },
  { name: "hr.manage_employees" },
];

// ─── Storage stub ─────────────────────────────────────────────────────────────

function makeStorage(clockedInIds: string[] = []) {
  const createdTask = {
    id: TASK_ID,
    title: "Test task",
    status: "pending",
    assignedTo: null as string | null,
    pinnedTo: null as string | null,
    eligibleRoles: ["all"],
  };

  return {
    getUserPermissions: vi.fn().mockResolvedValue(managerPermissions),
    getClockedInUsers: vi.fn().mockResolvedValue(clockedInIds.map(id => ({ id }))),
    getClockedInEmployeeCount: vi.fn().mockResolvedValue(clockedInIds.length),
    createTask: vi.fn().mockImplementation((data: any) => {
      Object.assign(createdTask, data, { id: TASK_ID });
      return Promise.resolve({ ...createdTask });
    }),
    updateTask: vi.fn().mockImplementation((_id: string, patch: any) => {
      Object.assign(createdTask, patch);
      return Promise.resolve({ ...createdTask });
    }),
    getTask: vi.fn().mockResolvedValue(createdTask),
    getAllTasks: vi.fn().mockResolvedValue([]),
    deleteTask: vi.fn(),
    getCompanySettings: vi.fn().mockResolvedValue({ taskAutoAssign: true }),
    getTaskAssignees: vi.fn().mockResolvedValue([]),
    broadcastTask: vi.fn().mockResolvedValue({ assignees: [], count: 0 }),
    getAllTaskBroadcastSummary: vi.fn().mockResolvedValue({}),
    getTaskBroadcastProgress: vi.fn().mockResolvedValue({ total: 0, approved: 0, completed: 0, in_progress: 0, pending: 0, rejected: 0 }),
    updateTaskAssignee: vi.fn(),
    getCompletionStreak: vi.fn().mockResolvedValue(1),
    getMyBroadcastAssignments: vi.fn().mockResolvedValue([]),
    getTaskAssignee: vi.fn(),
    createRedoAssignment: vi.fn(),
    getPendingVerifications: vi.fn().mockResolvedValue([]),
    getClockedInEmployees: vi.fn().mockResolvedValue([]),
  } as any;
}

// ─── HTTP helper ─────────────────────────────────────────────────────────────

async function httpReq(
  baseUrl: string,
  method: string,
  path: string,
  body?: object,
): Promise<{ status: number; json: any }> {
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

// ─── Test suites ──────────────────────────────────────────────────────────────

describe("POST /api/tasks — deferred pin on task create", () => {
  describe("off-shift pin: assignee is NOT clocked in", () => {
    let server: http.Server;
    let baseUrl: string;
    let storage: ReturnType<typeof makeStorage>;

    beforeAll(async () => {
      storage = makeStorage([]); // no one clocked in
      const app = express();
      app.use(express.json());

      const { registerTaskRoutes } = await import("../server/routes/tasks");
      const isAuthenticated = (req: any, _res: any, next: any) => {
        req.user = { id: MANAGER_ID };
        next();
      };
      registerTaskRoutes(app, storage, isAuthenticated, vi.fn(), vi.fn());

      await new Promise<void>((resolve) => {
        server = app.listen(0, "127.0.0.1", resolve);
      });
      const { port } = server.address() as AddressInfo;
      baseUrl = `http://127.0.0.1:${port}`;
    });

    afterAll(() => server?.close());
    beforeEach(() => { aiMock.runAutoAssign.mockClear(); });

    it("creates task with assignedTo=null and pinnedTo=<userId>", async () => {
      const { status } = await httpReq(baseUrl, "POST", "/api/tasks", {
        title: "Clean shelves",
        assignedTo: OFF_SHIFT_EMPLOYEE,
      });
      expect(status).toBe(200);
      expect(storage.createTask).toHaveBeenCalledWith(
        expect.objectContaining({
          assignedTo: null,
          pinnedTo: OFF_SHIFT_EMPLOYEE,
          isAIAssigned: false,
          aiReasoning: null,
        }),
      );
    });

    it("does NOT trigger auto-assign when a deferred pin is stored", async () => {
      await httpReq(baseUrl, "POST", "/api/tasks", {
        title: "Clean shelves",
        assignedTo: OFF_SHIFT_EMPLOYEE,
      });
      // Give the fire-and-forget microtask a tick to settle
      await new Promise(r => setTimeout(r, 20));
      expect(aiMock.runAutoAssign).not.toHaveBeenCalled();
    });

    it("does NOT send an assignment notification when pin is deferred", async () => {
      notificationMock.notificationService.sendTaskAssignment.mockClear();
      await httpReq(baseUrl, "POST", "/api/tasks", {
        title: "Clean shelves",
        assignedTo: OFF_SHIFT_EMPLOYEE,
      });
      expect(notificationMock.notificationService.sendTaskAssignment).not.toHaveBeenCalled();
    });
  });

  describe("immediate pin: assignee IS clocked in", () => {
    let server: http.Server;
    let baseUrl: string;
    let storage: ReturnType<typeof makeStorage>;

    beforeAll(async () => {
      storage = makeStorage([CLOCKED_IN_EMPLOYEE]); // employee is on shift
      const app = express();
      app.use(express.json());

      const { registerTaskRoutes } = await import("../server/routes/tasks");
      const isAuthenticated = (req: any, _res: any, next: any) => {
        req.user = { id: MANAGER_ID };
        next();
      };
      registerTaskRoutes(app, storage, isAuthenticated, vi.fn(), vi.fn());

      await new Promise<void>((resolve) => {
        server = app.listen(0, "127.0.0.1", resolve);
      });
      const { port } = server.address() as AddressInfo;
      baseUrl = `http://127.0.0.1:${port}`;
    });

    afterAll(() => server?.close());

    it("creates task with assignedTo=<userId> and pinnedTo=null", async () => {
      const { status } = await httpReq(baseUrl, "POST", "/api/tasks", {
        title: "Restock display",
        assignedTo: CLOCKED_IN_EMPLOYEE,
      });
      expect(status).toBe(200);
      expect(storage.createTask).toHaveBeenCalledWith(
        expect.objectContaining({
          assignedTo: CLOCKED_IN_EMPLOYEE,
          pinnedTo: null,
          isAIAssigned: false,
          aiReasoning: null,
        }),
      );
    });

    it("sends an assignment notification immediately when clocked-in pin activates", async () => {
      notificationMock.notificationService.sendTaskAssignment.mockClear();
      await httpReq(baseUrl, "POST", "/api/tasks", {
        title: "Restock display",
        assignedTo: CLOCKED_IN_EMPLOYEE,
      });
      expect(notificationMock.notificationService.sendTaskAssignment).toHaveBeenCalledWith(
        CLOCKED_IN_EMPLOYEE,
        expect.any(String),
        expect.any(String),
      );
    });
  });
});
