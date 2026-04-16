/**
 * In-memory store tracking each user's last-reported location permission state.
 * This is intentionally volatile — it resets on server restart and is only used
 * for real-time manager dashboard indicators.
 */

interface LocationPermissionRecord {
  status: 'granted' | 'denied' | 'prompt' | 'unknown';
  reportedAt: Date;
}

const store = new Map<string, LocationPermissionRecord>();

const TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

export function setLocationPermission(userId: string, status: LocationPermissionRecord['status']): void {
  store.set(userId, { status, reportedAt: new Date() });
}

export function getLocationPermission(userId: string): LocationPermissionRecord | undefined {
  const record = store.get(userId);
  if (!record) return undefined;
  if (Date.now() - record.reportedAt.getTime() > TTL_MS) {
    store.delete(userId);
    return undefined;
  }
  return record;
}

export function isLocationBlocked(userId: string): boolean {
  const record = getLocationPermission(userId);
  return record?.status === 'denied';
}
