import { db } from "../db";
import { users, roles } from "@shared/schema";
import { eq, isNull } from "drizzle-orm";

const SUPER_ADMIN_EMAIL = "jh@scuild.com";

export async function backfillLegacyUserRoles(): Promise<void> {
  try {
    const [ownerRole] = await db.select().from(roles).where(eq(roles.name, "owner")).limit(1);
    if (!ownerRole) {
      console.log("[Backfill] No 'owner' role found in DB, skipping role backfill");
      return;
    }

    const usersWithoutRole = await db
      .select()
      .from(users)
      .where(isNull(users.roleId));

    if (usersWithoutRole.length === 0) {
      return;
    }

    const superAdminUser = usersWithoutRole.find(
      u => u.email?.toLowerCase() === SUPER_ADMIN_EMAIL.toLowerCase()
    );

    if (superAdminUser) {
      await db
        .update(users)
        .set({ roleId: ownerRole.id })
        .where(eq(users.id, superAdminUser.id));
      console.log(`[Backfill] Assigned owner role to super-admin user id=${superAdminUser.id} email=${superAdminUser.email}`);
    }

    const remainingWithoutRole = usersWithoutRole.filter(
      u => u.email?.toLowerCase() !== SUPER_ADMIN_EMAIL.toLowerCase()
    );
    if (remainingWithoutRole.length > 0) {
      console.log(`[Backfill] ${remainingWithoutRole.length} user(s) still have no role assigned (non-admin users)`);
    }

    const [verifiedSuperAdmin] = await db
      .select({ id: users.id, email: users.email, roleId: users.roleId })
      .from(users)
      .where(eq(users.email, SUPER_ADMIN_EMAIL))
      .limit(1);
    if (verifiedSuperAdmin) {
      const hasOwnerRole = verifiedSuperAdmin.roleId === ownerRole.id;
      console.log(`[Backfill] Super-admin verification: id=${verifiedSuperAdmin.id} hasOwnerRole=${hasOwnerRole}`);
    } else {
      console.log(`[Backfill] Super-admin user (${SUPER_ADMIN_EMAIL}) not yet in DB`);
    }
  } catch (err) {
    console.warn("[Backfill] Role backfill failed (non-fatal):", err);
  }
}
