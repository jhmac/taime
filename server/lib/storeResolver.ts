import { db } from "../db";
import { workLocations, users } from "@shared/schema";
import { eq, and } from "drizzle-orm";
import { AppError } from "./routeWrapper";

export async function resolveStoreIdForUser(userId: string): Promise<string> {
  const [user] = await db
    .select({ locationId: users.locationId })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  if (!user?.locationId) {
    throw new AppError(400, "Your account has no store location assigned. Contact your administrator.", "NO_STORE");
  }

  const [loc] = await db
    .select({ id: workLocations.id })
    .from(workLocations)
    .where(and(eq(workLocations.id, user.locationId), eq(workLocations.isActive, true)))
    .limit(1);

  if (!loc) {
    throw new AppError(400, "No active store found matching your location. Contact your administrator.", "NO_STORE");
  }

  return loc.id;
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
