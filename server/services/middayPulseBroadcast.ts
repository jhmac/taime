import { WebSocket } from "ws";
import type { Permission } from "../../shared/schema";

export interface TrackedConnection {
  ws: WebSocket;
  userId: string;
  alive: boolean;
}

export interface BroadcastStorage {
  getUserRoleName(userId: string): Promise<string | null>;
  getUserPermissions(userId: string): Promise<Permission[]>;
}

export interface BroadcastLogger {
  warn(obj: Record<string, unknown>, message: string): void;
}

export async function broadcastMiddayPulse(
  data: Record<string, unknown>,
  wsConnections: Map<string, Set<TrackedConnection>>,
  storage: BroadcastStorage,
  logger: BroadcastLogger,
): Promise<void> {
  const payload = JSON.stringify(data);
  for (const [userId, conns] of Array.from(wsConnections.entries())) {
    try {
      const roleName = await storage.getUserRoleName(userId);
      const isAdminOrOwner = roleName === "admin" || roleName === "owner";
      if (!isAdminOrOwner) {
        const perms = await storage.getUserPermissions(userId);
        const hasSalesAccess = perms.some(
          (p) => p.name === "sales.view_all" || p.name === "admin.manage_all",
        );
        if (!hasSalesAccess) continue;
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      logger.warn({ userId, error: message }, "ws: could not check permissions for midday_pulse broadcast, skipping");
      continue;
    }
    for (const conn of Array.from(conns)) {
      if (conn.ws.readyState === WebSocket.OPEN) {
        conn.ws.send(payload);
      }
    }
  }
}
