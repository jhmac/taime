import { storage } from '../storage';
import { notificationService } from './notificationService';
import type { OffsiteSession, OffsiteAllowanceRule } from '@shared/schema';
import { resolvePermission, resolveAnyPermission } from "../services/permissionResolver";

const DEFAULT_DEVIATION_THRESHOLD_METERS = 200;
const DESTINATION_ARRIVAL_RADIUS_METERS = 200;
const DESTINATION_OVERDUE_STAY_MINUTES = 15;
const ETA_BUFFER_MINUTES = 10;
const CONSECUTIVE_OFF_ROUTE_LIMIT = 2;

const watchdogTimers = new Map<string, { notReachedTimer?: NodeJS.Timeout; overdueReturnTimer?: NodeJS.Timeout }>();

function decodePoly(encoded: string): Array<{ lat: number; lng: number }> {
  const points: Array<{ lat: number; lng: number }> = [];
  let index = 0;
  let lat = 0;
  let lng = 0;

  while (index < encoded.length) {
    let shift = 0;
    let result = 0;
    let b: number;
    do {
      b = encoded.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    const dlat = result & 1 ? ~(result >> 1) : result >> 1;
    lat += dlat;

    shift = 0;
    result = 0;
    do {
      b = encoded.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    const dlng = result & 1 ? ~(result >> 1) : result >> 1;
    lng += dlng;

    points.push({ lat: lat / 1e5, lng: lng / 1e5 });
  }
  return points;
}

function haversineMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000;
  const φ1 = (lat1 * Math.PI) / 180;
  const φ2 = (lat2 * Math.PI) / 180;
  const Δφ = ((lat2 - lat1) * Math.PI) / 180;
  const Δλ = ((lon2 - lon1) * Math.PI) / 180;
  const a = Math.sin(Δφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function distanceToPolyline(lat: number, lng: number, polyline: Array<{ lat: number; lng: number }>): number {
  if (polyline.length === 0) return Infinity;
  if (polyline.length === 1) return haversineMeters(lat, lng, polyline[0].lat, polyline[0].lng);

  let minDist = Infinity;
  for (let i = 0; i < polyline.length - 1; i++) {
    const d = pointToSegmentDistance(lat, lng, polyline[i], polyline[i + 1]);
    if (d < minDist) minDist = d;
  }
  return minDist;
}

function pointToSegmentDistance(
  pLat: number, pLng: number,
  aPoint: { lat: number; lng: number },
  bPoint: { lat: number; lng: number }
): number {
  const ax = aPoint.lng, ay = aPoint.lat;
  const bx = bPoint.lng, by = bPoint.lat;
  const px = pLng, py = pLat;

  const abx = bx - ax, aby = by - ay;
  const apx = px - ax, apy = py - ay;
  const abab = abx * abx + aby * aby;

  if (abab === 0) return haversineMeters(pLat, pLng, aPoint.lat, aPoint.lng);

  const t = Math.max(0, Math.min(1, (apx * abx + apy * aby) / abab));
  const closestLat = ay + t * aby;
  const closestLng = ax + t * abx;
  return haversineMeters(pLat, pLng, closestLat, closestLng);
}

async function getAlertRecipients(rule: OffsiteAllowanceRule): Promise<string[]> {
  const alertRecipients = rule.alertRecipients as string;
  const targetUserIds: string[] = [];

  if (alertRecipients === 'custom' && rule.customAlertUserIds) {
    targetUserIds.push(...(rule.customAlertUserIds as string[]));
  } else {
    const allUsers = await storage.getAllUsers();
    for (const u of allUsers) {
      const isOwner = await resolvePermission(u.id, 'admin.manage_all', storage);
      const isManager = await resolvePermission(u.id, 'scheduling.manage', storage);
      if (alertRecipients === 'owner' && isOwner) targetUserIds.push(u.id);
      else if (alertRecipients === 'manager' && isManager) targetUserIds.push(u.id);
      else if (alertRecipients === 'both' && (isOwner || isManager)) targetUserIds.push(u.id);
    }
  }
  return targetUserIds;
}

export async function fetchAndStoreRoute(
  session: OffsiteSession,
  rule: OffsiteAllowanceRule,
  originLat: number,
  originLng: number
): Promise<void> {
  const destLat = rule.destinationLat ? parseFloat(String(rule.destinationLat)) : null;
  const destLng = rule.destinationLng ? parseFloat(String(rule.destinationLng)) : null;

  if (!destLat || !destLng) {
    console.log(`[RouteTracking] Rule ${rule.id} has no destination, skipping route fetch`);
    return;
  }

  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) {
    console.warn('[RouteTracking] GOOGLE_MAPS_API_KEY not set, skipping route fetch');
    return;
  }

  try {
    const waypoints = session.sessionWaypoints as Array<{ lat: number; lng: number }> | null;
    let waypointParam = '';
    if (waypoints && waypoints.length > 0) {
      waypointParam = `&waypoints=${waypoints.map(w => `${w.lat},${w.lng}`).join('|')}`;
    }

    const url = `https://maps.googleapis.com/maps/api/directions/json?origin=${originLat},${originLng}&destination=${destLat},${destLng}${waypointParam}&mode=driving&key=${apiKey}`;
    const res = await fetch(url);
    const data = await res.json() as any;

    if (data.status !== 'OK' || !data.routes?.length) {
      console.warn(`[RouteTracking] Directions API returned status: ${data.status}`);
      return;
    }

    const route = data.routes[0];
    const polyline = route.overview_polyline?.points || '';
    const totalDurationSeconds = route.legs.reduce((sum: number, leg: any) => sum + (leg.duration?.value || 0), 0);
    const totalDistanceMeters = route.legs.reduce((sum: number, leg: any) => sum + (leg.distance?.value || 0), 0);

    const estimatedReturnTime = new Date(
      session.exitTime.getTime() + totalDurationSeconds * 1000
    );

    await storage.updateOffsiteSession(session.id, {
      routePolyline: polyline,
      routeDistanceMeters: totalDistanceMeters,
      routeDurationSeconds: totalDurationSeconds,
      estimatedReturnTime,
    });

    console.log(`[RouteTracking] Route stored for session ${session.id}: ${totalDistanceMeters}m, ${totalDurationSeconds}s`);

    scheduleWatchdogs(session.id, rule, estimatedReturnTime, destLat, destLng);
  } catch (error) {
    console.error('[RouteTracking] Error fetching route:', error);
  }
}

function scheduleWatchdogs(
  sessionId: string,
  rule: OffsiteAllowanceRule,
  estimatedReturnTime: Date,
  destLat: number,
  destLng: number
): void {
  clearWatchdogs(sessionId);

  const timers: { notReachedTimer?: NodeJS.Timeout; overdueReturnTimer?: NodeJS.Timeout } = {};

  const etaMs = estimatedReturnTime.getTime() - Date.now();
  const notReachedDelay = etaMs + ETA_BUFFER_MINUTES * 60 * 1000;

  if (notReachedDelay > 0) {
    timers.notReachedTimer = setTimeout(async () => {
      const session = await storage.getOffsiteSession(sessionId);
      if (!session || session.status !== 'active' || session.destinationArrivedAt || session.destinationNotReachedAlertSent) return;

      console.log(`[RouteTracking] Destination not reached alert for session ${sessionId}`);
      await storage.updateOffsiteSession(sessionId, { destinationNotReachedAlertSent: true });

      const user = session.userId ? await storage.getUser(session.userId) : null;
      const userName = user ? `${user.firstName || ''} ${user.lastName || ''}`.trim() || user.email : 'Unknown';

      const payload = {
        title: 'Destination Not Reached',
        body: `${userName} has not reached their destination yet (ETA was ${ETA_BUFFER_MINUTES} min ago)`,
        data: { type: 'destination_not_reached', sessionId, userId: session.userId },
      };

      const targetIds = await getAlertRecipients(rule);
      for (const targetId of targetIds) {
        await notificationService.sendToUser(targetId, payload);
      }
    }, notReachedDelay);
  }

  watchdogTimers.set(sessionId, timers);
}

export function scheduleOverdueReturnWatchdog(sessionId: string, rule: OffsiteAllowanceRule): void {
  const existing = watchdogTimers.get(sessionId) || {};
  if (existing.overdueReturnTimer) clearTimeout(existing.overdueReturnTimer);

  const overdueMs = DESTINATION_OVERDUE_STAY_MINUTES * 60 * 1000;

  const overdueTimer = setTimeout(async () => {
    const session = await storage.getOffsiteSession(sessionId);
    if (!session || session.status !== 'active' || session.overdueReturnAlertSent) return;

    const arrivedAt = session.destinationArrivedAt;
    if (!arrivedAt) return;

    const stayDuration = Date.now() - new Date(arrivedAt).getTime();
    if (stayDuration < overdueMs - 5000) return;

    console.log(`[RouteTracking] Overdue return alert for session ${sessionId}`);
    await storage.updateOffsiteSession(sessionId, { overdueReturnAlertSent: true });

    const user = session.userId ? await storage.getUser(session.userId) : null;
    const userName = user ? `${user.firstName || ''} ${user.lastName || ''}`.trim() || user.email : 'Unknown';

    const payload = {
      title: 'Not Heading Back',
      body: `${userName} has been at their destination for over ${DESTINATION_OVERDUE_STAY_MINUTES} min without heading back`,
      data: { type: 'overdue_return', sessionId, userId: session.userId },
    };

    const targetIds = await getAlertRecipients(rule);
    for (const targetId of targetIds) {
      await notificationService.sendToUser(targetId, payload);
    }
  }, overdueMs);

  watchdogTimers.set(sessionId, { ...existing, overdueReturnTimer: overdueTimer });
}

export function clearWatchdogs(sessionId: string): void {
  const timers = watchdogTimers.get(sessionId);
  if (timers) {
    if (timers.notReachedTimer) clearTimeout(timers.notReachedTimer);
    if (timers.overdueReturnTimer) clearTimeout(timers.overdueReturnTimer);
    watchdogTimers.delete(sessionId);
  }
}

export async function processOffsiteBreadcrumb(
  sessionId: string,
  lat: number,
  lng: number,
  accuracy: number | undefined
): Promise<{ isDeviation: boolean; distanceFromRouteMt: number; autoClockOut?: boolean }> {
  const session = await storage.getOffsiteSession(sessionId);
  if (!session) throw new Error('Session not found');

  const rule = session.ruleId ? await storage.getOffsiteRule(session.ruleId) : null;

  const deviationThreshold = (rule?.deviationToleranceMeters ?? DEFAULT_DEVIATION_THRESHOLD_METERS);

  let isDeviation = false;
  let distanceFromRouteMt = 0;

  if (session.routePolyline) {
    const polyline = decodePoly(session.routePolyline);
    distanceFromRouteMt = Math.round(distanceToPolyline(lat, lng, polyline));
    isDeviation = distanceFromRouteMt > deviationThreshold;
  }

  await storage.createOffsiteBreadcrumb({
    sessionId,
    latitude: String(lat),
    longitude: String(lng),
    accuracy: accuracy ? Math.round(accuracy) : null,
    isDeviation,
    distanceFromRouteMt,
    timestamp: new Date(),
  });

  let autoClockOut = false;

  if (isDeviation) {
    const newConsecutive = (session.consecutiveOffRouteCount ?? 0) + 1;
    await storage.updateOffsiteSession(sessionId, {
      consecutiveOffRouteCount: newConsecutive,
      deviationEventCount: (session.deviationEventCount ?? 0) + 1,
    });

    if (rule) {
      // On first consecutive deviation: notify manager/owner once. On second: auto clock-out (no extra alert needed).
      if (newConsecutive === 1) {
        console.log(`[RouteTracking] First deviation for session ${sessionId}: ${distanceFromRouteMt}m off route`);
        await storage.updateOffsiteSession(sessionId, { deviationAlertsSent: (session.deviationAlertsSent || 0) + 1 });

        const user = await storage.getUser(session.userId);
        const userName = user ? `${user.firstName || ''} ${user.lastName || ''}`.trim() || user.email : 'Unknown';

        const payload = {
          title: 'Route Deviation Alert',
          body: `${userName} is ${Math.round(distanceFromRouteMt)}m off their expected route. If they deviate again their trip will be ended automatically.`,
          data: { type: 'route_deviation', sessionId, userId: session.userId, distanceFromRouteMt },
        };

        const targetIds = await getAlertRecipients(rule);
        for (const targetId of targetIds) {
          await notificationService.sendToUser(targetId, payload);
        }
      }

      if (newConsecutive >= CONSECUTIVE_OFF_ROUTE_LIMIT) {
        console.log(`[RouteTracking] Auto clock-out triggered for session ${sessionId} after ${newConsecutive} consecutive deviations`);
        const now = new Date();
        await storage.updateOffsiteSession(sessionId, {
          status: 'auto_clocked_out',
          returnTime: now,
          clockedOutOffRoute: true,
          consecutiveOffRouteCount: newConsecutive,
        });

        // Clock out the employee's time entry
        if (session.timeEntryId) {
          try {
            await storage.updateTimeEntry(session.timeEntryId, {
              clockOutTime: now,
              clockOutSource: 'auto_offsite_deviation',
            });
            console.log(`[RouteTracking] Clocked out time entry ${session.timeEntryId} due to route deviation`);
          } catch (err) {
            console.error(`[RouteTracking] Failed to clock out time entry ${session.timeEntryId}:`, err);
          }
        }

        const user = await storage.getUser(session.userId);
        const userName = user ? `${user.firstName || ''} ${user.lastName || ''}`.trim() || user.email : 'Unknown';

        const autoclockPayload = {
          title: 'Off-Site Trip Ended',
          body: `${userName}'s off-site trip was automatically ended after repeated route deviations`,
          data: { type: 'auto_clock_out_deviation', sessionId, userId: session.userId },
        };
        const employeePayload = {
          title: 'Off-Site Trip Ended',
          body: 'Your off-site trip was automatically ended because you were off-route for too long. You have also been clocked out.',
          data: { type: 'auto_clock_out_deviation', sessionId },
        };

        const targetIds = await getAlertRecipients(rule);
        for (const targetId of targetIds) {
          await notificationService.sendToUser(targetId, autoclockPayload);
        }
        await notificationService.sendToUser(session.userId, employeePayload);

        clearWatchdogs(sessionId);
        autoClockOut = true;
      }
    }
  } else {
    if ((session.consecutiveOffRouteCount ?? 0) > 0) {
      await storage.updateOffsiteSession(sessionId, { consecutiveOffRouteCount: 0 });
    }
  }

  if (rule && rule.destinationLat && rule.destinationLng && !autoClockOut) {
    const sessionWaypoints = session.sessionWaypoints as Array<{ lat: number; lng: number; arrivedAt?: string }> | null;
    const currentLegIndex = session.currentLegIndex ?? 0;

    if (sessionWaypoints && sessionWaypoints.length > 0 && currentLegIndex < sessionWaypoints.length) {
      const nextWaypoint = sessionWaypoints[currentLegIndex];
      const distToWaypoint = haversineMeters(lat, lng, nextWaypoint.lat, nextWaypoint.lng);

      if (distToWaypoint <= DESTINATION_ARRIVAL_RADIUS_METERS && !nextWaypoint.arrivedAt) {
        console.log(`[RouteTracking] Waypoint ${currentLegIndex} arrived for session ${sessionId}`);
        const updatedWaypoints = [...sessionWaypoints];
        updatedWaypoints[currentLegIndex] = { ...nextWaypoint, arrivedAt: new Date().toISOString() };
        await storage.updateOffsiteSession(sessionId, {
          sessionWaypoints: updatedWaypoints as any,
          currentLegIndex: currentLegIndex + 1,
        });
      }
    }

    const destLat = parseFloat(String(rule.destinationLat));
    const destLng = parseFloat(String(rule.destinationLng));
    const distToDest = haversineMeters(lat, lng, destLat, destLng);

    if (distToDest <= DESTINATION_ARRIVAL_RADIUS_METERS && !session.destinationArrivedAt) {
      console.log(`[RouteTracking] Destination arrived for session ${sessionId}`);
      await storage.updateOffsiteSession(sessionId, { destinationArrivedAt: new Date() });
      if (rule) {
        scheduleOverdueReturnWatchdog(sessionId, rule);
      }
    }
  }

  return { isDeviation, distanceFromRouteMt, autoClockOut };
}
