import { db } from "../db";
import { users, permissions, rolePermissions, userPermissionOverrides } from "@shared/schema";
import { eq, and } from "drizzle-orm";

const CACHE_TTL_MS = 60_000;

interface CacheEntry {
  result: string[];
  expiresAt: number;
}

const permissionCache = new Map<string, CacheEntry>();
const storeUserCache = new Map<string, CacheEntry>();

export function invalidatePermissionCache(permName?: string): void {
  if (permName) {
    permissionCache.delete(permName);
  } else {
    permissionCache.clear();
  }
}

/**
 * Returns the IDs of all active users in the given store.
 *
 * In the current single-store schema the `users` table has no `storeId`
 * column, so "in the store" means "is an active user".  The `storeId`
 * parameter is accepted to make call-sites store-aware and to future-proof
 * this function for multi-store deployments.  Results are cached for ~60 s
 * (same TTL as `getUserIdsWithPermission`).
 */
export async function getAllStoreUserIds(_storeId: string): Promise<string[]> {
  const cacheKey = "all_store_users";
  const now = Date.now();
  const cached = storeUserCache.get(cacheKey);
  if (cached && now < cached.expiresAt) {
    return cached.result;
  }

  const rows = await db.select({ id: users.id }).from(users).where(eq(users.isActive, true));
  const result = rows.map((r) => r.id);
  storeUserCache.set(cacheKey, { result, expiresAt: now + CACHE_TTL_MS });
  return result;
}

/**
 * Returns the IDs of all active users who have the given permission,
 * taking into account role-based grants and individual override rows.
 * Results are cached for ~60 seconds to reduce DB load during high-frequency
 * broadcasts (clock-ins, debrief submits, etc.).
 */
export async function getUserIdsWithPermission(permName: string): Promise<string[]> {
  const now = Date.now();
  const cached = permissionCache.get(permName);
  if (cached && now < cached.expiresAt) {
    return cached.result;
  }

  const allActiveUsers = await db
    .select({ id: users.id, roleId: users.roleId })
    .from(users)
    .where(eq(users.isActive, true));

  if (allActiveUsers.length === 0) {
    permissionCache.set(permName, { result: [], expiresAt: now + CACHE_TTL_MS });
    return [];
  }

  const [permRow] = await db
    .select({ id: permissions.id })
    .from(permissions)
    .where(eq(permissions.name, permName));

  const roleIds = Array.from(new Set(allActiveUsers.map((u) => u.roleId).filter(Boolean))) as string[];

  const rolesWithPerm = new Set<string>();
  if (permRow && roleIds.length > 0) {
    const rpRows = await db
      .select({ roleId: rolePermissions.roleId })
      .from(rolePermissions)
      .where(eq(rolePermissions.permissionId, permRow.id));
    for (const rp of rpRows) rolesWithPerm.add(rp.roleId);
  }

  const overrides = await db
    .select({ userId: userPermissionOverrides.userId, grant: userPermissionOverrides.grant })
    .from(userPermissionOverrides)
    .where(eq(userPermissionOverrides.permissionName, permName));

  const overrideMap = new Map(overrides.map((o) => [o.userId, o.grant]));

  const result: string[] = [];
  for (const u of allActiveUsers) {
    const override = overrideMap.get(u.id);
    if (override === false) continue;
    if (override === true || (u.roleId && rolesWithPerm.has(u.roleId))) {
      result.push(u.id);
    }
  }

  permissionCache.set(permName, { result, expiresAt: now + CACHE_TTL_MS });
  return result;
}
