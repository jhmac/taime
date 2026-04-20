import { db } from "../db";
import { users, permissions, rolePermissions, userPermissionOverrides } from "@shared/schema";
import { eq, and } from "drizzle-orm";

/**
 * Returns the IDs of all active users who have the given permission,
 * taking into account role-based grants and individual override rows.
 */
export async function getUserIdsWithPermission(permName: string): Promise<string[]> {
  const allActiveUsers = await db
    .select({ id: users.id, roleId: users.roleId })
    .from(users)
    .where(eq(users.isActive, true));

  if (allActiveUsers.length === 0) return [];

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
  return result;
}
