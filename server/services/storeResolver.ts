import { db } from "../db";
import { workLocations, users } from "@shared/schema";
import { eq, and } from "drizzle-orm";
import { AppError } from "../lib/routeWrapper";

export async function resolveStoreIdForUser(userId: string): Promise<string> {
  const [user] = await db
    .select({ locationId: users.locationId })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  if (user?.locationId) {
    const [loc] = await db
      .select({ id: workLocations.id })
      .from(workLocations)
      .where(and(eq(workLocations.id, user.locationId), eq(workLocations.isActive, true)))
      .limit(1);

    if (loc) return loc.id;
  }

  // Fallback for single-store installs: if the user has no explicit store
  // assignment but there is exactly one active store, use it automatically.
  // This handles users who were created before location scoping was enforced
  // and have not yet been backfilled by the startup migration.
  const activeStores = await db
    .select({ id: workLocations.id })
    .from(workLocations)
    .where(eq(workLocations.isActive, true))
    .limit(2);

  if (activeStores.length === 1) {
    return activeStores[0].id;
  }

  throw new AppError(400, "Your account has no store location assigned. Contact your administrator.", "NO_STORE");
}

export async function tryResolveStoreIdForUser(userId: string): Promise<string | null> {
  try {
    return await resolveStoreIdForUser(userId);
  } catch {
    return null;
  }
}

/**
 * Legacy compat: resolves the first active store (global fallback).
 * Used by routes that haven't been migrated to per-user store resolution yet.
 * @deprecated Prefer resolveStoreIdForUser(userId) for proper multi-tenancy.
 */
export async function resolveStoreId(): Promise<string | null> {
  const [loc] = await db
    .select({ id: workLocations.id })
    .from(workLocations)
    .where(eq(workLocations.isActive, true))
    .limit(1);
  return loc?.id ?? null;
}
