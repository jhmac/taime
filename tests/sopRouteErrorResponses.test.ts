/**
 * SOP route error-response unit tests (Task #471)
 *
 * Tasks #459 and #462 converted every handler in `server/routes/sops.ts`
 * to use `asyncHandler` + `AppError`, but until now there were no tests
 * pinning down that the error paths actually surface the expected HTTP
 * status codes and JSON shape.  This file exercises a representative
 * slice of those paths through the real route + the production
 * `globalErrorHandler`, so a regression in either the route's
 * `throw new AppError(...)` calls or the global handler would be caught.
 *
 * What's covered:
 *   - GET  /api/sop/search                   → 400 when `q` is missing
 *   - GET  /api/knowledge-base               → 403 when no storeId resolves
 *   - GET  /api/knowledge-base/:id           → 404 when the article is missing
 *                                            → 403 when no storeId resolves
 *   - POST   /api/sop/categories             → 403 for non-admin
 *   - PUT    /api/sop/categories/:id         → 403 for non-admin
 *   - DELETE /api/sop/categories/:id         → 403 for non-admin
 *   - POST   /api/sop/documents              → 403 for non-admin
 *   - PUT    /api/sop/documents/:id          → 403 for non-admin
 *   - DELETE /api/sop/documents/:id          → 403 for non-admin
 *   - POST   /api/training/modules           → 403 for non-admin
 *   - PUT    /api/training/modules/:id       → 403 for non-admin
 *   - DELETE /api/training/modules/:id       → 403 for non-admin
 *
 * Every assertion checks both the HTTP status AND the JSON envelope
 * `{ success: false, error: { message, code } }` so a future change
 * to the response shape breaks loudly here.
 */

import { vi, describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import type { AddressInfo } from "net";
import http from "http";

// ─── Hoist shared mocks ──────────────────────────────────────────────────────

const dbMock = vi.hoisted(() => ({
  select: vi.fn(),
  insert: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
  transaction: vi.fn(),
}));

const storeResolverMock = vi.hoisted(() => ({
  tryResolveStoreIdForUser: vi.fn(),
}));

vi.mock("../server/db", () => ({ db: dbMock }));

vi.mock("../server/services/storeResolver", () => ({
  tryResolveStoreIdForUser: storeResolverMock.tryResolveStoreIdForUser,
}));

vi.mock("../server/lib/permissionUtils", () => ({
  getUserIdsWithPermission: vi.fn().mockResolvedValue([]),
  invalidatePermissionCache: vi.fn(),
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

// ─── Drizzle chain helper ────────────────────────────────────────────────────

/**
 * Returns a chainable that resolves to `rows` for any of the standard drizzle
 * builder methods used by the SOP routes under test.
 */
function makeChain(rows: unknown[]): any {
  const p = Promise.resolve(rows);
  const c: any = {};
  for (const m of [
    "from",
    "where",
    "orderBy",
    "limit",
    "offset",
    "set",
    "values",
    "innerJoin",
    "leftJoin",
    "groupBy",
  ]) {
    c[m] = vi.fn().mockReturnValue(c);
  }
  c.returning = vi.fn().mockResolvedValue(rows);
  c.then = (onFulfilled: any, onRejected: any) => p.then(onFulfilled, onRejected);
  c.catch = (onRejected: any) => p.catch(onRejected);
  c.finally = (onFinally: any) => p.finally(onFinally);
  return c;
}

// ─── HTTP helpers ────────────────────────────────────────────────────────────

type Method = "GET" | "POST" | "PUT" | "DELETE";

function request(
  port: number,
  method: Method,
  path: string,
  body?: unknown,
): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const payload = body !== undefined ? JSON.stringify(body) : undefined;
    const req = http.request(
      {
        hostname: "127.0.0.1",
        port,
        path,
        method,
        headers: payload
          ? {
              "Content-Type": "application/json",
              "Content-Length": Buffer.byteLength(payload),
            }
          : {},
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
    if (payload) req.write(payload);
    req.end();
  });
}

// ─── Test harness ────────────────────────────────────────────────────────────

const USER_ID = "user-1";

/**
 * Assertion helper for `{ success: false, error: { message, code } }` envelope.
 */
function expectErrorBody(body: any, code: string) {
  expect(body).toMatchObject({
    success: false,
    error: { code, message: expect.any(String) },
  });
}

describe("SOP routes — error responses", () => {
  let server: http.Server;
  let port: number;

  // The non-admin permission set used by every "403 for non-admin" test.
  // resolvePermission() only checks for the literal name "admin.manage_all",
  // so an empty list is sufficient to fail every requireAdmin() guard.
  const nonAdminPermissions: { name: string }[] = [];

  // Storage stub.  All write methods are vi.fn() so the test can assert
  // they were NEVER called when the request is rejected at the auth step.
  const storage = {
    getUserPermissions: vi.fn().mockResolvedValue(nonAdminPermissions),
    getUserWithRole: vi.fn().mockResolvedValue(null),

    getSopCategories: vi.fn(),
    createSopCategory: vi.fn(),
    updateSopCategory: vi.fn(),
    deleteSopCategory: vi.fn(),

    getSopDocuments: vi.fn(),
    getSopDocument: vi.fn(),
    createSopDocument: vi.fn(),
    updateSopDocument: vi.fn(),
    deleteSopDocument: vi.fn(),
    searchSopDocuments: vi.fn(),

    getTrainingModules: vi.fn(),
    createTrainingModule: vi.fn(),
    updateTrainingModule: vi.fn(),
    deleteTrainingModule: vi.fn(),

    createActivityLog: vi.fn().mockResolvedValue(undefined),
  };

  const isAuthenticated = (req: any, _res: any, next: any) => {
    req.user = { id: USER_ID };
    next();
  };

  beforeAll(async () => {
    const express = (await import("express")).default;
    const { registerSopLibraryRoutes } = await import("../server/routes/sops");
    const { globalErrorHandler } = await import("../server/lib/routeWrapper");

    const app = express();
    app.use(express.json());
    registerSopLibraryRoutes(
      app,
      storage as any,
      isAuthenticated,
      vi.fn(),
      vi.fn(),
    );
    // Use the real production error handler so we lock in its envelope shape.
    app.use(globalErrorHandler);

    server = http.createServer(app);
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    port = (server.address() as AddressInfo).port;
  });

  afterAll(async () => {
    await new Promise<void>((r) => server.close(() => r()));
  });

  beforeEach(() => {
    vi.clearAllMocks();
    storage.getUserPermissions.mockResolvedValue(nonAdminPermissions);
    storage.createActivityLog.mockResolvedValue(undefined);
    storeResolverMock.tryResolveStoreIdForUser.mockResolvedValue("store-1");
  });

  // ── GET /api/sop/search ────────────────────────────────────────────────────

  describe("GET /api/sop/search", () => {
    it("returns 400 with MISSING_PARAM when `q` is omitted entirely", async () => {
      const res = await request(port, "GET", "/api/sop/search");
      expect(res.status).toBe(400);
      expectErrorBody(res.body, "MISSING_PARAM");
      // Storage must NOT have been queried — guard fired before the call.
      expect(storage.searchSopDocuments).not.toHaveBeenCalled();
    });

    it("returns 400 with MISSING_PARAM when `q` is the empty string", async () => {
      // Empty string is falsy, so the guard treats it the same as missing.
      const res = await request(port, "GET", "/api/sop/search?q=");
      expect(res.status).toBe(400);
      expectErrorBody(res.body, "MISSING_PARAM");
      expect(storage.searchSopDocuments).not.toHaveBeenCalled();
    });

    it("succeeds (200) when `q` is provided — sanity check that the guard isn't over-triggering", async () => {
      storage.searchSopDocuments.mockResolvedValueOnce([]);
      const res = await request(port, "GET", "/api/sop/search?q=hello");
      expect(res.status).toBe(200);
      expect(storage.searchSopDocuments).toHaveBeenCalledWith("hello");
    });
  });

  // ── GET /api/knowledge-base ────────────────────────────────────────────────

  describe("GET /api/knowledge-base", () => {
    it("returns 403 with FORBIDDEN when no storeId resolves for the user", async () => {
      storeResolverMock.tryResolveStoreIdForUser.mockResolvedValueOnce(null);
      const res = await request(port, "GET", "/api/knowledge-base");
      expect(res.status).toBe(403);
      expectErrorBody(res.body, "FORBIDDEN");
      // No DB lookup should have been attempted once the guard rejected.
      expect(dbMock.select).not.toHaveBeenCalled();
    });

    it("returns 403 with FORBIDDEN when the resolver returns undefined", async () => {
      storeResolverMock.tryResolveStoreIdForUser.mockResolvedValueOnce(
        undefined as any,
      );
      const res = await request(port, "GET", "/api/knowledge-base");
      expect(res.status).toBe(403);
      expectErrorBody(res.body, "FORBIDDEN");
    });
  });

  // ── GET /api/knowledge-base/:id ────────────────────────────────────────────

  describe("GET /api/knowledge-base/:id", () => {
    it("returns 404 with NOT_FOUND when the article doesn't exist for the user's store", async () => {
      // storeId resolves so we get past the FORBIDDEN guard, then the joined
      // select returns no rows → route throws AppError(404, NOT_FOUND).
      dbMock.select.mockReturnValueOnce(makeChain([]));
      const res = await request(port, "GET", "/api/knowledge-base/missing-id");
      expect(res.status).toBe(404);
      expectErrorBody(res.body, "NOT_FOUND");
    });

    it("returns 403 with FORBIDDEN when no storeId resolves", async () => {
      storeResolverMock.tryResolveStoreIdForUser.mockResolvedValueOnce(null);
      const res = await request(port, "GET", "/api/knowledge-base/any-id");
      expect(res.status).toBe(403);
      expectErrorBody(res.body, "FORBIDDEN");
      // DB never queried because the guard fired first.
      expect(dbMock.select).not.toHaveBeenCalled();
    });
  });

  // ── Admin-gated category routes ────────────────────────────────────────────

  describe("admin-gated SOP category routes — non-admin → 403", () => {
    it("POST /api/sop/categories returns 403 with FORBIDDEN", async () => {
      const res = await request(port, "POST", "/api/sop/categories", {
        name: "Onboarding",
      });
      expect(res.status).toBe(403);
      expectErrorBody(res.body, "FORBIDDEN");
      expect(storage.createSopCategory).not.toHaveBeenCalled();
    });

    it("PUT /api/sop/categories/:id returns 403 with FORBIDDEN", async () => {
      const res = await request(port, "PUT", "/api/sop/categories/cat-1", {
        name: "Renamed",
      });
      expect(res.status).toBe(403);
      expectErrorBody(res.body, "FORBIDDEN");
      expect(storage.updateSopCategory).not.toHaveBeenCalled();
    });

    it("DELETE /api/sop/categories/:id returns 403 with FORBIDDEN", async () => {
      const res = await request(port, "DELETE", "/api/sop/categories/cat-1");
      expect(res.status).toBe(403);
      expectErrorBody(res.body, "FORBIDDEN");
      expect(storage.deleteSopCategory).not.toHaveBeenCalled();
    });
  });

  // ── Admin-gated document routes ────────────────────────────────────────────

  describe("admin-gated SOP document routes — non-admin → 403", () => {
    it("POST /api/sop/documents returns 403 with FORBIDDEN", async () => {
      const res = await request(port, "POST", "/api/sop/documents", {
        title: "Doc",
        content: "body",
      });
      expect(res.status).toBe(403);
      expectErrorBody(res.body, "FORBIDDEN");
      expect(storage.createSopDocument).not.toHaveBeenCalled();
    });

    it("PUT /api/sop/documents/:id returns 403 with FORBIDDEN", async () => {
      const res = await request(port, "PUT", "/api/sop/documents/doc-1", {
        title: "Renamed",
      });
      expect(res.status).toBe(403);
      expectErrorBody(res.body, "FORBIDDEN");
      expect(storage.updateSopDocument).not.toHaveBeenCalled();
    });

    it("DELETE /api/sop/documents/:id returns 403 with FORBIDDEN", async () => {
      const res = await request(port, "DELETE", "/api/sop/documents/doc-1");
      expect(res.status).toBe(403);
      expectErrorBody(res.body, "FORBIDDEN");
      expect(storage.deleteSopDocument).not.toHaveBeenCalled();
    });
  });

  // ── Admin-gated training module routes ─────────────────────────────────────

  describe("admin-gated training module routes — non-admin → 403", () => {
    it("POST /api/training/modules returns 403 with FORBIDDEN", async () => {
      const res = await request(port, "POST", "/api/training/modules", {
        title: "Onboarding 101",
      });
      expect(res.status).toBe(403);
      expectErrorBody(res.body, "FORBIDDEN");
      expect(storage.createTrainingModule).not.toHaveBeenCalled();
    });

    it("PUT /api/training/modules/:id returns 403 with FORBIDDEN", async () => {
      const res = await request(port, "PUT", "/api/training/modules/mod-1", {
        title: "Renamed",
      });
      expect(res.status).toBe(403);
      expectErrorBody(res.body, "FORBIDDEN");
      expect(storage.updateTrainingModule).not.toHaveBeenCalled();
    });

    it("DELETE /api/training/modules/:id returns 403 with FORBIDDEN", async () => {
      const res = await request(port, "DELETE", "/api/training/modules/mod-1");
      expect(res.status).toBe(403);
      expectErrorBody(res.body, "FORBIDDEN");
      expect(storage.deleteTrainingModule).not.toHaveBeenCalled();
    });
  });
});
