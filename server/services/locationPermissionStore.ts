/**
 * Database-backed store tracking each user's last-reported location permission state.
 * Persisting to the DB ensures the manager dashboard shows accurate indicators after
 * a server restart.
 *
 * Two read semantics are intentionally separated:
 *  - getLocationPermissionPreference: returns the raw saved choice with no TTL
 *    deletion — used when reading back the user's own durable preference so it
 *    persists across sessions and devices indefinitely.
 *  - getLocationPermission: applies a 24 h freshness window — used by the
 *    manager dashboard to decide whether a reported status is recent enough to
 *    display as reliable telemetry.
 */

import { db } from "../db";
import { locationPermissions } from "@shared/schema";
import { eq, lt } from "drizzle-orm";

type PermissionStatus = 'granted' | 'denied' | 'prompt' | 'unknown';

const DASHBOARD_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours — freshness window for manager dashboard display

export async function setLocationPermission(userId: string, status: PermissionStatus): Promise<void> {
  await db
    .insert(locationPermissions)
    .values({ userId, status, reportedAt: new Date() })
    .onConflictDoUpdate({
      target: locationPermissions.userId,
      set: { status, reportedAt: new Date() },
    });
}

/**
 * Returns the user's saved location permission preference regardless of age.
 * Use this when reading back the user's own choice (e.g. GET /api/location-permission
 * for client-side cache hydration). The preference is durable and should not
 * expire — only a new POST from the device updates it.
 */
export async function getLocationPermissionPreference(userId: string): Promise<{ status: PermissionStatus; reportedAt: Date } | undefined> {
  const rows = await db
    .select()
    .from(locationPermissions)
    .where(eq(locationPermissions.userId, userId))
    .limit(1);

  const record = rows[0];
  if (!record) return undefined;
  return { status: record.status as PermissionStatus, reportedAt: record.reportedAt };
}

/**
 * Returns the user's location permission only if it was reported within the last
 * 24 hours (dashboard freshness window). Stale records are deleted on read.
 * Use this for manager-facing "location blocked" indicators where recency matters.
 */
export async function getLocationPermission(userId: string): Promise<{ status: PermissionStatus; reportedAt: Date } | undefined> {
  const rows = await db
    .select()
    .from(locationPermissions)
    .where(eq(locationPermissions.userId, userId))
    .limit(1);

  const record = rows[0];
  if (!record) return undefined;

  if (Date.now() - record.reportedAt.getTime() > DASHBOARD_TTL_MS) {
    await db.delete(locationPermissions).where(eq(locationPermissions.userId, userId));
    return undefined;
  }

  return { status: record.status as PermissionStatus, reportedAt: record.reportedAt };
}

export async function isLocationBlocked(userId: string): Promise<boolean> {
  const record = await getLocationPermission(userId);
  return record?.status === 'denied';
}

export async function cleanupStaleLocationPermissions(): Promise<number> {
  const cutoff = new Date(Date.now() - DASHBOARD_TTL_MS);
  const deleted = await db
    .delete(locationPermissions)
    .where(lt(locationPermissions.reportedAt, cutoff))
    .returning({ userId: locationPermissions.userId });
  return deleted.length;
}
