/**
 * Database-backed store tracking each user's last-reported location permission state.
 * Persisting to the DB ensures the manager dashboard shows accurate indicators after
 * a server restart. Records older than 24 h are treated as stale by the read helpers.
 */

import { db } from "../db";
import { locationPermissions } from "@shared/schema";
import { eq } from "drizzle-orm";

type PermissionStatus = 'granted' | 'denied' | 'prompt' | 'unknown';

const TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

export async function setLocationPermission(userId: string, status: PermissionStatus): Promise<void> {
  await db
    .insert(locationPermissions)
    .values({ userId, status, reportedAt: new Date() })
    .onConflictDoUpdate({
      target: locationPermissions.userId,
      set: { status, reportedAt: new Date() },
    });
}

export async function getLocationPermission(userId: string): Promise<{ status: PermissionStatus; reportedAt: Date } | undefined> {
  const rows = await db
    .select()
    .from(locationPermissions)
    .where(eq(locationPermissions.userId, userId))
    .limit(1);

  const record = rows[0];
  if (!record) return undefined;

  if (Date.now() - record.reportedAt.getTime() > TTL_MS) {
    await db.delete(locationPermissions).where(eq(locationPermissions.userId, userId));
    return undefined;
  }

  return { status: record.status as PermissionStatus, reportedAt: record.reportedAt };
}

export async function isLocationBlocked(userId: string): Promise<boolean> {
  const record = await getLocationPermission(userId);
  return record?.status === 'denied';
}
