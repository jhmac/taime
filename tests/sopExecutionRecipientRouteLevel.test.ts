/**
 * SOP execution recipient-list route-level guard
 *
 * These tests mount the real SOP route handlers (via registerSopLibraryRoutes)
 * against a mocked database and permission helper, then trigger each of the
 * five SOP execution WebSocket events over real HTTP.  They assert that
 * sendToUsers() is called with a non-empty recipient array for every event.
 *
 * This closes the gap left by the static audits and pure-function unit tests:
 * a wiring regression in the route (e.g. passing `[]` or a different variable
 * to sendToUsers) would be caught here even if the helper functions themselves
 * are correct.
 *
 * Events covered:
 *  - execution_started    (POST /api/sops/executions)
 *  - step_completed       (PUT  /api/sops/executions/:id/steps/:stepId)
 *  - execution_completed  (PUT  /api/sops/executions/:id/steps/:stepId — all steps done)
 *  - sign_off_requested   (PUT  /api/sops/executions/:id/steps/:stepId — checkpoint step)
 *  - sign_off_completed   (POST /api/sops/templates/:id/sign-off/:stepCompletionId)
 */

import { vi, describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import type { AddressInfo } from "net";
import http from "http";

// ─── Hoist mock functions so they are available inside vi.mock factories ─────

const dbMock = vi.hoisted(() => ({
  select: vi.fn(),
  insert: vi.fn(),
  update: vi.fn(),
  transaction: vi.fn(),
}));

const permMock = vi.hoisted(() => ({
  getUserIdsWithPermission: vi.fn(),
}));

// ─── Module-level mocks ──────────────────────────────────────────────────────

vi.mock("../server/db", () => ({ db: dbMock }));

vi.mock("../server/lib/permissionUtils", () => ({
  getUserIdsWithPermission: permMock.getUserIdsWithPermission,
  invalidatePermissionCache: vi.fn(),
}));

vi.mock("../server/services/storeResolver", () => ({
  tryResolveStoreIdForUser: vi.fn().mockResolvedValue("store-1"),
}));

vi.mock("../server/services/sopAI", () => ({
  generateSOPFromDescription: vi.fn(),
}));

vi.mock("../server/services/sopSurfacing", () => ({
  getSurfacedSOPsForEmployee: vi.fn().mockResolvedValue([]),
}));

vi.mock("../server/services/gtdClarificationAI", () => ({
  triggerClarification: vi.fn(),
}));

vi.mock("../server/services/sopIndexer", () => ({
  indexSOPTemplate: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../server/lib/logger", () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// ─── Test fixtures ───────────────────────────────────────────────────────────

const EMPLOYEE_ID = "emp-user-1";
const MANAGER_ID = "mgr-user-1";
const TEMPLATE_ID = "tmpl-001";
const EXECUTION_ID = "exec-001";
const STEP_ID = "step-001";
const COMPLETION_ID = "compl-001";

const mockTemplate = {
  id: TEMPLATE_ID,
  storeId: "store-1",
  title: "Test SOP",
  description: null,
  category: "opening",
  isActive: true,
  version: 1,
  parentTemplateId: null,
  estimatedDurationMinutes: null,
  roleAssignments: null,
  trainingNotes: null,
  walkthroughVideoUrl: null,
  isTrainingPriority: false,
  createdBy: "admin-1",
  createdAt: new Date(),
  updatedAt: new Date(),
};

const mockStep = {
  id: STEP_ID,
  templateId: TEMPLATE_ID,
  stepOrder: 1,
  title: "Step 1",
  description: null,
  stepType: "action" as const,
  isCheckpoint: false,
  timerDurationSeconds: null,
  decisionOptions: null,
  trainingDetail: null,
  trainingVideoUrl: null,
  trainingPhotoUrls: [],
  trainingVideoThumbnail: null,
};

const mockCheckpointStep = { ...mockStep, isCheckpoint: true };

const mockExecution = {
  id: EXECUTION_ID,
  templateId: TEMPLATE_ID,
  employeeId: EMPLOYEE_ID,
  storeId: "store-1",
  status: "in_progress",
  startedAt: new Date(),
  completedAt: null,
  branchPath: null,
  notes: null,
};

const mockCompletion = {
  id: COMPLETION_ID,
  executionId: EXECUTION_ID,
  stepId: STEP_ID,
  status: "pending",
  completedAt: null,
  timeSpentSeconds: null,
  skipReason: null,
  photoUrl: null,
  notes: null,
  managerSignOff: null,
  managerSignOffBy: null,
  managerSignOffAt: null,
};

// ─── DB chain builder ────────────────────────────────────────────────────────

/**
 * Creates a drizzle-compatible chainable query object that resolves to `rows`.
 * Supports: .from(), .where(), .orderBy(), .limit(), .offset(), .set(), .values()
 */
function makeChain(rows: unknown[]): any {
  const p = Promise.resolve(rows);
  const c: any = {};
  for (const m of ["from", "where", "orderBy", "limit", "offset", "set", "values"]) {
    c[m] = vi.fn().mockReturnValue(c);
  }
  c.returning = vi.fn().mockResolvedValue(rows);
  c.then = (onFulfilled: any, onRejected: any) => p.then(onFulfilled, onRejected);
  c.catch = (onRejected: any) => p.catch(onRejected);
  c.finally = (onFinally: any) => p.finally(onFinally);
  return c;
}

// ─── HTTP helpers ────────────────────────────────────────────────────────────

function postJson(port: number, path: string, body: unknown): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const req = http.request(
      {
        hostname: "127.0.0.1",
        port,
        path,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(payload),
        },
      },
      (res) => {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => {
          try {
            resolve({ status: res.statusCode ?? 0, body: JSON.parse(data) });
          } catch {
            resolve({ status: res.statusCode ?? 0, body: data });
          }
        });
      },
    );
    req.on("error", reject);
    req.write(payload);
    req.end();
  });
}

function putJson(port: number, path: string, body: unknown): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const req = http.request(
      {
        hostname: "127.0.0.1",
        port,
        path,
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(payload),
        },
      },
      (res) => {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => {
          try {
            resolve({ status: res.statusCode ?? 0, body: JSON.parse(data) });
          } catch {
            resolve({ status: res.statusCode ?? 0, body: data });
          }
        });
      },
    );
    req.on("error", reject);
    req.write(payload);
    req.end();
  });
}

// ─── Test suite ───────────────────────────────────────────────────────────────

describe("SOP execution route-level: sendToUsers receives non-empty recipients", () => {
  let server: http.Server;
  let port: number;
  const sendToUsers = vi.fn();
  const broadcastToAll = vi.fn();

  const mockStorage: any = {
    createActivityLog: vi.fn().mockResolvedValue(undefined),
    getUserPermissions: vi.fn().mockResolvedValue([
      { name: "admin.manage_all" },
      { name: "hr.view_team" },
    ]),
    getUserWithRole: vi.fn().mockResolvedValue(null),
  };

  const mockIsAuth = (req: any, _res: any, next: any) => {
    req.user = { id: EMPLOYEE_ID };
    next();
  };

  beforeAll(async () => {
    const express = (await import("express")).default;
    const { registerSopLibraryRoutes } = await import("../server/routes/sops");

    const app = express();
    app.use(express.json());

    // Use a global error handler so async route errors return JSON
    app.use((err: any, _req: any, res: any, _next: any) => {
      res.status(err.statusCode || 500).json({ success: false, error: err.message });
    });

    registerSopLibraryRoutes(app, mockStorage, mockIsAuth, broadcastToAll, sendToUsers);

    server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    port = (server.address() as AddressInfo).port;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  beforeEach(() => {
    vi.clearAllMocks();
    // Default: permission helper returns one manager so recipient lists are non-empty
    permMock.getUserIdsWithPermission.mockResolvedValue([MANAGER_ID]);
    mockStorage.createActivityLog.mockResolvedValue(undefined);
    mockStorage.getUserPermissions.mockResolvedValue([
      { name: "admin.manage_all" },
      { name: "hr.view_team" },
    ]);
  });

  // ─── execution_started ─────────────────────────────────────────────────────

  it("execution_started: sendToUsers is called with a non-empty recipient list including the employee", async () => {
    // db.select() call 1: fetch template by id
    // db.select() call 2: fetch steps by templateId
    let selectCall = 0;
    dbMock.select.mockImplementation(() => {
      selectCall++;
      if (selectCall === 1) return makeChain([mockTemplate]);
      return makeChain([mockStep]);
    });

    // db.transaction: create execution + step completions
    dbMock.transaction.mockImplementation(async (cb: any) => {
      const tx = {
        insert: vi.fn().mockReturnValue({
          values: vi.fn().mockReturnValue({
            returning: vi.fn()
              .mockResolvedValueOnce([mockExecution])
              .mockResolvedValueOnce([mockCompletion]),
          }),
        }),
      };
      return cb(tx);
    });

    const res = await postJson(port, "/api/sops/executions", { templateId: TEMPLATE_ID });

    expect(res.status).toBe(201);

    const executionStartedCalls = sendToUsers.mock.calls.filter(
      ([, data]: [any, any]) => data?.type === "execution_started",
    );
    expect(executionStartedCalls).toHaveLength(1);

    const [recipients] = executionStartedCalls[0];
    expect(Array.isArray(recipients)).toBe(true);
    expect(recipients.length).toBeGreaterThan(0);
    // Employee is always included
    expect(recipients).toContain(EMPLOYEE_ID);
    // Manager permission holder is included
    expect(recipients).toContain(MANAGER_ID);
  });

  it("execution_started: recipient list remains non-empty even if all permission lookups return []", async () => {
    permMock.getUserIdsWithPermission.mockResolvedValue([]);

    let selectCall = 0;
    dbMock.select.mockImplementation(() => {
      selectCall++;
      if (selectCall === 1) return makeChain([mockTemplate]);
      return makeChain([mockStep]);
    });

    dbMock.transaction.mockImplementation(async (cb: any) => {
      const tx = {
        insert: vi.fn().mockReturnValue({
          values: vi.fn().mockReturnValue({
            returning: vi.fn()
              .mockResolvedValueOnce([mockExecution])
              .mockResolvedValueOnce([mockCompletion]),
          }),
        }),
      };
      return cb(tx);
    });

    const res = await postJson(port, "/api/sops/executions", { templateId: TEMPLATE_ID });
    expect(res.status).toBe(201);

    const calls = sendToUsers.mock.calls.filter(
      ([, d]: [any, any]) => d?.type === "execution_started",
    );
    expect(calls).toHaveLength(1);
    const [recipients] = calls[0];
    // Even with no managers, the employee ID must be present
    expect(recipients.length).toBeGreaterThan(0);
    expect(recipients).toContain(EMPLOYEE_ID);
  });

  // ─── step_completed ────────────────────────────────────────────────────────

  /**
   * Set up a step_completed scenario with two steps so allDone stays false,
   * meaning only step_completed fires (not execution_completed).
   */
  function setupStepCompletedDbMocks(step = mockStep) {
    const step2 = { ...mockStep, id: "step-002", stepOrder: 2 };
    const completion2 = { ...mockCompletion, id: "compl-002", stepId: "step-002", status: "pending" };

    let selectCall = 0;
    dbMock.select.mockImplementation(() => {
      selectCall++;
      switch (selectCall) {
        case 1: return makeChain([mockExecution]);          // get execution
        case 2: return makeChain([step]);                   // get step
        case 3: return makeChain([mockCompletion]);         // get step completion
        case 4: return makeChain([mockStep, step2]);        // all steps (for reachable calc)
        case 5: return makeChain([mockCompletion, completion2]); // all completions
        case 6: return makeChain([mockExecution]);          // execution with branchPath
        default: return makeChain([{ ...mockCompletion, status: "completed" }]); // updated completion
      }
    });

    dbMock.update.mockReturnValue(makeChain([]));
  }

  it("step_completed: sendToUsers is called with a non-empty recipient list", async () => {
    setupStepCompletedDbMocks();

    const res = await putJson(
      port,
      `/api/sops/executions/${EXECUTION_ID}/steps/${STEP_ID}`,
      { status: "completed" },
    );

    expect(res.status).toBe(200);

    const stepCompletedCalls = sendToUsers.mock.calls.filter(
      ([, d]: [any, any]) => d?.type === "step_completed",
    );
    expect(stepCompletedCalls).toHaveLength(1);

    const [recipients] = stepCompletedCalls[0];
    expect(Array.isArray(recipients)).toBe(true);
    expect(recipients.length).toBeGreaterThan(0);
    expect(recipients).toContain(EMPLOYEE_ID);
    expect(recipients).toContain(MANAGER_ID);
  });

  it("step_completed: recipient list is non-empty when permission lookups return []", async () => {
    permMock.getUserIdsWithPermission.mockResolvedValue([]);
    setupStepCompletedDbMocks();

    const res = await putJson(
      port,
      `/api/sops/executions/${EXECUTION_ID}/steps/${STEP_ID}`,
      { status: "completed" },
    );

    expect(res.status).toBe(200);

    const calls = sendToUsers.mock.calls.filter(
      ([, d]: [any, any]) => d?.type === "step_completed",
    );
    const [recipients] = calls[0];
    expect(recipients.length).toBeGreaterThan(0);
    expect(recipients).toContain(EMPLOYEE_ID);
  });

  // ─── execution_completed ───────────────────────────────────────────────────

  /**
   * With a single step being completed, allDone=true and execution_completed fires.
   */
  function setupExecutionCompletedDbMocks() {
    let selectCall = 0;
    dbMock.select.mockImplementation(() => {
      selectCall++;
      switch (selectCall) {
        case 1: return makeChain([mockExecution]);   // get execution
        case 2: return makeChain([mockStep]);        // get step
        case 3: return makeChain([mockCompletion]);  // get step completion
        case 4: return makeChain([mockStep]);        // all steps (single step)
        case 5: return makeChain([mockCompletion]);  // all completions (single)
        case 6: return makeChain([mockExecution]);   // execution branchPath
        default: return makeChain([{ ...mockCompletion, status: "completed" }]);
      }
    });
    dbMock.update.mockReturnValue(makeChain([]));
  }

  it("execution_completed: sendToUsers is called with a non-empty recipient list", async () => {
    setupExecutionCompletedDbMocks();

    const res = await putJson(
      port,
      `/api/sops/executions/${EXECUTION_ID}/steps/${STEP_ID}`,
      { status: "completed" },
    );

    expect(res.status).toBe(200);

    const execCompletedCalls = sendToUsers.mock.calls.filter(
      ([, d]: [any, any]) => d?.type === "execution_completed",
    );
    expect(execCompletedCalls).toHaveLength(1);

    const [recipients] = execCompletedCalls[0];
    expect(Array.isArray(recipients)).toBe(true);
    expect(recipients.length).toBeGreaterThan(0);
    expect(recipients).toContain(EMPLOYEE_ID);
    expect(recipients).toContain(MANAGER_ID);
  });

  // ─── sign_off_requested ────────────────────────────────────────────────────

  it("sign_off_requested: sendToUsers is called with a non-empty recipient list when sign-off users exist", async () => {
    // checkpoint step triggers sign_off_requested
    let selectCall = 0;
    const step2 = { ...mockCheckpointStep, id: "step-002", stepOrder: 2 };
    const completion2 = { ...mockCompletion, id: "compl-002", stepId: "step-002", status: "pending" };

    dbMock.select.mockImplementation(() => {
      selectCall++;
      switch (selectCall) {
        case 1: return makeChain([mockExecution]);
        case 2: return makeChain([mockCheckpointStep]);
        case 3: return makeChain([mockCompletion]);
        case 4: return makeChain([mockCheckpointStep, step2]);
        case 5: return makeChain([mockCompletion, completion2]);
        case 6: return makeChain([mockExecution]);
        default: return makeChain([{ ...mockCompletion, status: "completed" }]);
      }
    });
    dbMock.update.mockReturnValue(makeChain([]));

    const res = await putJson(
      port,
      `/api/sops/executions/${EXECUTION_ID}/steps/${STEP_ID}`,
      { status: "completed" },
    );

    expect(res.status).toBe(200);

    const signOffCalls = sendToUsers.mock.calls.filter(
      ([, d]: [any, any]) => d?.type === "sign_off_requested",
    );
    expect(signOffCalls).toHaveLength(1);

    const [recipients] = signOffCalls[0];
    expect(Array.isArray(recipients)).toBe(true);
    expect(recipients.length).toBeGreaterThan(0);
    expect(recipients).toContain(MANAGER_ID);
  });

  it("sign_off_requested: NOT sent when all permission lookups return [] (empty-list guard)", async () => {
    // When no users hold sign-off-eligible permissions, the route skips sendToUsers
    permMock.getUserIdsWithPermission.mockResolvedValue([]);

    let selectCall = 0;
    const step2 = { ...mockCheckpointStep, id: "step-002", stepOrder: 2 };
    const completion2 = { ...mockCompletion, id: "compl-002", stepId: "step-002", status: "pending" };

    dbMock.select.mockImplementation(() => {
      selectCall++;
      switch (selectCall) {
        case 1: return makeChain([mockExecution]);
        case 2: return makeChain([mockCheckpointStep]);
        case 3: return makeChain([mockCompletion]);
        case 4: return makeChain([mockCheckpointStep, step2]);
        case 5: return makeChain([mockCompletion, completion2]);
        case 6: return makeChain([mockExecution]);
        default: return makeChain([{ ...mockCompletion, status: "completed" }]);
      }
    });
    dbMock.update.mockReturnValue(makeChain([]));

    const res = await putJson(
      port,
      `/api/sops/executions/${EXECUTION_ID}/steps/${STEP_ID}`,
      { status: "completed" },
    );

    expect(res.status).toBe(200);

    // The route guard must prevent sendToUsers from being called with []
    const signOffCalls = sendToUsers.mock.calls.filter(
      ([, d]: [any, any]) => d?.type === "sign_off_requested",
    );
    // Either not called at all (guard skipped it) or called with non-empty list
    if (signOffCalls.length > 0) {
      const [recipients] = signOffCalls[0];
      expect(recipients.length).toBeGreaterThan(0);
    }
    // Importantly: sendToUsers must NOT be called with an empty array for this event
    const emptyListCalls = sendToUsers.mock.calls.filter(
      ([recipients, d]: [any, any]) =>
        d?.type === "sign_off_requested" && recipients.length === 0,
    );
    expect(emptyListCalls).toHaveLength(0);
  });

  // ─── sign_off_completed ───────────────────────────────────────────────────

  /**
   * The sign-off route uses req.user.id as the manager ID.  The shared
   * beforeAll server sets req.user.id = EMPLOYEE_ID, so to properly test
   * that both the employee (execution.employeeId) and the manager (req.user.id)
   * appear in the recipient list we spin up a dedicated mini-server whose auth
   * middleware identifies the caller as MANAGER_ID.
   */
  it("sign_off_completed: sendToUsers includes both the employee and the signing manager", async () => {
    const signedOffCompletion = {
      ...mockCompletion,
      managerSignOff: true,
      managerSignOffBy: MANAGER_ID,
      managerSignOffAt: new Date(),
    };

    const express = (await import("express")).default;
    const { registerSopLibraryRoutes } = await import("../server/routes/sops");

    const managerSendToUsers = vi.fn();
    const managerStorage: any = {
      ...mockStorage,
      getUserPermissions: vi.fn().mockResolvedValue([{ name: "admin.manage_all" }]),
    };

    // Auth middleware that identifies the caller as the manager (not the employee)
    const managerIsAuth = (req: any, _res: any, next: any) => {
      req.user = { id: MANAGER_ID };
      next();
    };

    const app2 = express();
    app2.use(express.json());
    app2.use((err: any, _req: any, res: any, _next: any) => {
      res.status(err.statusCode || 500).json({ success: false, error: err.message });
    });
    registerSopLibraryRoutes(app2, managerStorage, managerIsAuth, vi.fn(), managerSendToUsers);

    const server2 = http.createServer(app2);
    await new Promise<void>((r) => server2.listen(0, "127.0.0.1", r));
    const port2 = (server2.address() as AddressInfo).port;

    try {
      let selectCall = 0;
      dbMock.select.mockImplementation(() => {
        selectCall++;
        if (selectCall === 1) return makeChain([mockCompletion]);  // get completion
        return makeChain([mockExecution]);                          // get execution
      });

      dbMock.update.mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([signedOffCompletion]),
          }),
        }),
      });

      const res = await postJson(
        port2,
        `/api/sops/templates/${TEMPLATE_ID}/sign-off/${COMPLETION_ID}`,
        {},
      );

      expect(res.status).toBe(200);

      const signOffCompletedCalls = managerSendToUsers.mock.calls.filter(
        ([, d]: [any, any]) => d?.type === "sign_off_completed",
      );
      expect(signOffCompletedCalls).toHaveLength(1);

      const [recipients] = signOffCompletedCalls[0];
      expect(Array.isArray(recipients)).toBe(true);
      expect(recipients.length).toBeGreaterThan(0);
      // Must include both: the employee who ran the SOP and the manager who signed off
      expect(recipients).toContain(EMPLOYEE_ID);
      expect(recipients).toContain(MANAGER_ID);
    } finally {
      await new Promise<void>((r) => server2.close(() => r()));
    }
  });
});
