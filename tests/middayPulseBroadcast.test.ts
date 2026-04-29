import { describe, it, expect, vi, beforeEach } from "vitest";
import { WebSocket } from "ws";
import { broadcastMiddayPulse, type TrackedConnection, type BroadcastStorage, type BroadcastLogger } from "../server/services/middayPulseBroadcast";
import type { Permission } from "../shared/schema";

function makePermission(name: string): Permission {
  return {
    id: `perm-${name}`,
    name,
    displayName: name,
    description: null,
    category: "sales",
    createdAt: new Date(),
  };
}

function makeMockWs(): { ws: WebSocket; send: ReturnType<typeof vi.fn> } {
  const send = vi.fn();
  const ws = {
    readyState: WebSocket.OPEN,
    send,
  } as unknown as WebSocket;
  return { ws, send };
}

function makeConnection(ws: WebSocket, userId: string): TrackedConnection {
  return { ws, userId, alive: true };
}

function makeStorage(opts: {
  roleName?: string | null;
  permissions?: Permission[];
}): BroadcastStorage {
  return {
    getUserRoleName: vi.fn().mockResolvedValue(opts.roleName ?? null),
    getUserPermissions: vi.fn().mockResolvedValue(opts.permissions ?? []),
  };
}

const silentLogger: BroadcastLogger = {
  warn: vi.fn(),
};

const pulseData = { type: "midday_pulse", revenue: 1234.56 };

describe("broadcastMiddayPulse — sales data privacy", () => {
  let wsConnections: Map<string, Set<TrackedConnection>>;

  beforeEach(() => {
    wsConnections = new Map();
  });

  it("does NOT send to a non-sales employee (regular role, no sales.view_all permission)", async () => {
    const { ws, send } = makeMockWs();
    wsConnections.set("user-no-sales", new Set([makeConnection(ws, "user-no-sales")]));

    const storage = makeStorage({
      roleName: "employee",
      permissions: [makePermission("time.view"), makePermission("schedule.view")],
    });

    await broadcastMiddayPulse(pulseData, wsConnections, storage, silentLogger);

    expect(send).not.toHaveBeenCalled();
  });

  it("DOES send to an employee who has the sales.view_all permission", async () => {
    const { ws, send } = makeMockWs();
    wsConnections.set("user-sales", new Set([makeConnection(ws, "user-sales")]));

    const storage = makeStorage({
      roleName: "employee",
      permissions: [makePermission("sales.view_all")],
    });

    await broadcastMiddayPulse(pulseData, wsConnections, storage, silentLogger);

    expect(send).toHaveBeenCalledOnce();
    expect(JSON.parse(send.mock.calls[0][0])).toMatchObject({ type: "midday_pulse" });
  });

  it("DOES send to an employee who has the admin.manage_all permission", async () => {
    const { ws, send } = makeMockWs();
    wsConnections.set("user-manage-all", new Set([makeConnection(ws, "user-manage-all")]));

    const storage = makeStorage({
      roleName: "manager",
      permissions: [makePermission("admin.manage_all")],
    });

    await broadcastMiddayPulse(pulseData, wsConnections, storage, silentLogger);

    expect(send).toHaveBeenCalledOnce();
  });

  it("DOES send to an admin role without checking permissions", async () => {
    const { ws, send } = makeMockWs();
    wsConnections.set("user-admin", new Set([makeConnection(ws, "user-admin")]));

    const getUserPermissions = vi.fn();
    const storage: BroadcastStorage = {
      getUserRoleName: vi.fn().mockResolvedValue("admin"),
      getUserPermissions,
    };

    await broadcastMiddayPulse(pulseData, wsConnections, storage, silentLogger);

    expect(send).toHaveBeenCalledOnce();
    expect(getUserPermissions).not.toHaveBeenCalled();
  });

  it("DOES send to an owner role without checking permissions", async () => {
    const { ws, send } = makeMockWs();
    wsConnections.set("user-owner", new Set([makeConnection(ws, "user-owner")]));

    const getUserPermissions = vi.fn();
    const storage: BroadcastStorage = {
      getUserRoleName: vi.fn().mockResolvedValue("owner"),
      getUserPermissions,
    };

    await broadcastMiddayPulse(pulseData, wsConnections, storage, silentLogger);

    expect(send).toHaveBeenCalledOnce();
    expect(getUserPermissions).not.toHaveBeenCalled();
  });

  it("skips a user and logs a warning when the permission check throws", async () => {
    const { ws, send } = makeMockWs();
    wsConnections.set("user-error", new Set([makeConnection(ws, "user-error")]));

    const warnSpy = vi.fn();
    const logger: BroadcastLogger = { warn: warnSpy };
    const storage: BroadcastStorage = {
      getUserRoleName: vi.fn().mockRejectedValue(new Error("DB unavailable")),
      getUserPermissions: vi.fn(),
    };

    await broadcastMiddayPulse(pulseData, wsConnections, storage, logger);

    expect(send).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledOnce();
  });

  it("correctly separates sales and non-sales users in the same connection map", async () => {
    const { ws: wsSales, send: sendSales } = makeMockWs();
    const { ws: wsNoSales, send: sendNoSales } = makeMockWs();

    wsConnections.set("user-sales", new Set([makeConnection(wsSales, "user-sales")]));
    wsConnections.set("user-no-sales", new Set([makeConnection(wsNoSales, "user-no-sales")]));

    const storage: BroadcastStorage = {
      getUserRoleName: vi.fn().mockResolvedValue("employee"),
      getUserPermissions: vi.fn().mockImplementation((userId: string) => {
        if (userId === "user-sales") {
          return Promise.resolve([makePermission("sales.view_all")]);
        }
        return Promise.resolve([makePermission("time.view")]);
      }),
    };

    await broadcastMiddayPulse(pulseData, wsConnections, storage, silentLogger);

    expect(sendSales).toHaveBeenCalledOnce();
    expect(sendNoSales).not.toHaveBeenCalled();
  });

  it("does NOT send to a connection whose WebSocket is not in OPEN state", async () => {
    const send = vi.fn();
    const ws = {
      readyState: WebSocket.CLOSED,
      send,
    } as unknown as WebSocket;
    wsConnections.set("user-closed", new Set([makeConnection(ws, "user-closed")]));

    const storage = makeStorage({
      roleName: "employee",
      permissions: [makePermission("sales.view_all")],
    });

    await broadcastMiddayPulse(pulseData, wsConnections, storage, silentLogger);

    expect(send).not.toHaveBeenCalled();
  });
});
