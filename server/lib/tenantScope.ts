import { db } from "../db";
import { users, roles } from "@shared/schema";
import { eq } from "drizzle-orm";

export class CrossTenantError extends Error {
  readonly statusCode = 403;
  constructor(message = "Access denied: cross-tenant operation not permitted") {
    super(message);
    this.name = "CrossTenantError";
  }
}

export async function resolveUserTenant(
  userId: string,
): Promise<string | null> {
  const [row] = await db
    .select({ locationId: users.locationId, companyId: users.companyId })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return row?.locationId ?? row?.companyId ?? null;
}

export async function assertSameTenant(
  requestingUserId: string,
  targetUserId: string,
): Promise<void> {
  if (requestingUserId === targetUserId) return;

  const [requesterRow, targetTenant] = await Promise.all([
    db
      .select({ locationId: users.locationId, companyId: users.companyId, roleName: roles.name })
      .from(users)
      .leftJoin(roles, eq(users.roleId, roles.id))
      .where(eq(users.id, requestingUserId))
      .limit(1)
      .then(rows => rows[0] ?? null),
    resolveUserTenant(targetUserId),
  ]);

  const requesterTenant =
    requesterRow?.locationId ?? requesterRow?.companyId ?? null;

  if (requesterTenant === null) {
    if (requesterRow?.roleName !== "owner") {
      throw new CrossTenantError();
    }
    return;
  }

  if (requesterTenant !== targetTenant) {
    throw new CrossTenantError();
  }
}
