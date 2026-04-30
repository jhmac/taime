import { db } from "../db";
import { users, roles, workLocations } from "@shared/schema";
import { eq, isNull, or, isNotNull, and, sql } from "drizzle-orm";

const SUPER_ADMIN_EMAIL = "jh@scuild.com";

export async function backfillLegacyUserRoles(): Promise<void> {
  try {
    const [ownerRole] = await db.select().from(roles).where(eq(roles.name, "owner")).limit(1);
    if (!ownerRole) {
      console.log("[Backfill] No 'owner' role found in DB, skipping role backfill");
      return;
    }

    // Always enforce owner role for super-admin, regardless of current role
    const [superAdmin] = await db
      .select()
      .from(users)
      .where(eq(users.email, SUPER_ADMIN_EMAIL))
      .limit(1);

    if (superAdmin) {
      if (superAdmin.roleId !== ownerRole.id) {
        await db
          .update(users)
          .set({ roleId: ownerRole.id })
          .where(eq(users.id, superAdmin.id));
        console.log(`[Backfill] Corrected owner role for super-admin id=${superAdmin.id} email=${superAdmin.email} (was roleId=${superAdmin.roleId})`);
      } else {
        console.log(`[Backfill] Super-admin already has owner role (id=${superAdmin.id})`);
      }
    } else {
      console.log(`[Backfill] Super-admin user (${SUPER_ADMIN_EMAIL}) not yet in DB`);
    }

    const usersWithoutRole = await db
      .select()
      .from(users)
      .where(isNull(users.roleId));

    const nonAdminWithoutRole = usersWithoutRole.filter(
      u => u.email?.toLowerCase() !== SUPER_ADMIN_EMAIL.toLowerCase()
    );
    if (nonAdminWithoutRole.length > 0) {
      console.log(`[Backfill] ${nonAdminWithoutRole.length} user(s) still have no role assigned (non-admin users)`);
    }
  } catch (err) {
    console.warn("[Backfill] Role backfill failed (non-fatal):", err);
  }
}

/**
 * If a store exists but no user has been assigned the owner role,
 * find the first user (by created_at) and grant them the owner role.
 * This fixes accounts that completed store setup on a fresh DB before roles were seeded.
 */
export async function backfillStoreCreatorOwnerRole(): Promise<void> {
  try {
    // Only act when there is at least one work_location
    const [store] = await db.select({ id: workLocations.id }).from(workLocations).limit(1);
    if (!store) return;

    // Check whether any user already holds the owner role
    const [ownerRole] = await db.select().from(roles).where(eq(roles.name, "owner")).limit(1);
    if (!ownerRole) {
      console.log("[Backfill] No owner role found — seedDefaultRoles should have run first");
      return;
    }

    const [existingOwner] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.roleId, ownerRole.id))
      .limit(1);

    if (existingOwner) return; // Already has an owner, nothing to do

    // Find the first non-super-admin user (oldest created_at)
    const candidates = await db
      .select()
      .from(users)
      .where(sql`email != 'jh@scuild.com'`)
      .orderBy(sql`created_at ASC NULLS LAST`)
      .limit(1);

    if (!candidates.length) return;

    const candidate = candidates[0];
    await db.update(users).set({ roleId: ownerRole.id }).where(eq(users.id, candidate.id));
    console.log(`[Backfill] Assigned owner role to store creator userId=${candidate.id} email=${candidate.email}`);
  } catch (err) {
    console.warn("[Backfill] Store creator owner role backfill failed (non-fatal):", err);
  }
}

export async function backfillInactiveAuthenticatedUsers(): Promise<void> {
  try {
    const result = await db
      .update(users)
      .set({ isActive: true })
      .where(
        and(
          isNotNull(users.inviteAcceptedAt),
          or(
            isNull(users.isActive),
            eq(users.isActive, false)
          )
        )
      )
      .returning({ id: users.id });
    if (result.length > 0) {
      console.log(`[Backfill] Set isActive=true for ${result.length} invite-accepted user(s) who had isActive=false/null`);
    }
  } catch (err) {
    console.warn("[Backfill] Inactive authenticated user backfill failed (non-fatal):", err);
  }
}
