import { storage } from '../storage';
import { notificationService } from './notificationService';
import { db } from '../db';
import { geofenceEvents, timeEntries, workLocations } from '@shared/schema';
import { eq, and, isNull, desc } from 'drizzle-orm';

export interface GeofenceEvent {
  userId: string;
  latitude: number;
  longitude: number;
  timestamp: Date;
  eventType: 'enter' | 'exit' | 'warning' | 'auto_clock_out' | 'location_lost';
  locationId?: string;
}

const activeExitTimers = new Map<string, NodeJS.Timeout>();
const lastLocationReport = new Map<string, number>();

export class GeofencingService {
  calculateDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const R = 6371000;
    const φ1 = (lat1 * Math.PI) / 180;
    const φ2 = (lat2 * Math.PI) / 180;
    const Δφ = ((lat2 - lat1) * Math.PI) / 180;
    const Δλ = ((lon2 - lon1) * Math.PI) / 180;

    const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
              Math.cos(φ1) * Math.cos(φ2) *
              Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    return R * c;
  }

  private isPointInPolygon(lat: number, lng: number, polygon: Array<{ lat: number; lng: number }>): boolean {
    if (!polygon || polygon.length < 3) return false;
    let inside = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
      const xi = polygon[i].lat, yi = polygon[i].lng;
      const xj = polygon[j].lat, yj = polygon[j].lng;
      const intersect = ((yi > lng) !== (yj > lng)) && (lat < (xj - xi) * (lng - yi) / (yj - yi) + xi);
      if (intersect) inside = !inside;
    }
    return inside;
  }

  async checkUserLocation(userId: string, latitude: number, longitude: number): Promise<{
    isInWorkLocation: boolean;
    location?: any;
    distance?: number;
    verifiedVia?: 'gps';
  }> {
    try {
      const allLocations = await storage.getAllWorkLocations();
      
      for (const location of allLocations) {
        if (!location.latitude || !location.longitude) continue;
        if (!location.isActive) continue;

        const geofenceType = (location as any).geofenceType || 'radius';
        const geofenceEnabled = (location as any).geofenceEnabled !== false;

        if (!geofenceEnabled) continue;

        const distance = this.calculateDistance(
          latitude, longitude,
          parseFloat(location.latitude),
          parseFloat(location.longitude)
        );

        if (geofenceType === 'polygon') {
          const polygon = (location as any).geofencePolygon as Array<{ lat: number; lng: number }> | null;
          if (polygon && polygon.length >= 3) {
            if (this.isPointInPolygon(latitude, longitude, polygon)) {
              return { isInWorkLocation: true, location, distance, verifiedVia: 'gps' };
            }
          }
          if (distance <= (location.radius || 100)) {
            return { isInWorkLocation: true, location, distance, verifiedVia: 'gps' };
          }
        } else {
          if (distance <= (location.radius || 100)) {
            return { isInWorkLocation: true, location, distance, verifiedVia: 'gps' };
          }
        }
      }

      return { isInWorkLocation: false };
    } catch (error) {
      console.error('Error checking user location:', error);
      throw error;
    }
  }

  async checkWifiSsid(wifiSsid: string): Promise<{
    isInWorkLocation: boolean;
    location?: any;
    verifiedVia?: 'wifi';
  }> {
    try {
      if (!wifiSsid || !wifiSsid.trim()) {
        return { isInWorkLocation: false };
      }

      const allLocations = await storage.getAllWorkLocations();
      const normalizedSsid = wifiSsid.trim().toLowerCase();
      
      for (const location of allLocations) {
        if (!location.wifiSsid) continue;
        const locationSsid = location.wifiSsid.trim().toLowerCase();
        if (locationSsid === normalizedSsid) {
          return { isInWorkLocation: true, location, verifiedVia: 'wifi' };
        }
      }

      return { isInWorkLocation: false };
    } catch (error) {
      console.error('Error checking WiFi SSID:', error);
      throw error;
    }
  }

  async checkLocationOrWifi(
    userId: string,
    latitude?: number,
    longitude?: number,
    wifiSsid?: string
  ): Promise<{
    isInWorkLocation: boolean;
    location?: any;
    distance?: number;
    verifiedVia?: 'gps' | 'wifi';
  }> {
    if (wifiSsid) {
      const wifiResult = await this.checkWifiSsid(wifiSsid);
      if (wifiResult.isInWorkLocation) {
        return wifiResult;
      }
    }

    if (latitude !== undefined && longitude !== undefined && latitude !== 0 && longitude !== 0) {
      const gpsResult = await this.checkUserLocation(userId, latitude, longitude);
      if (gpsResult.isInWorkLocation) {
        return gpsResult;
      }
    }

    return { isInWorkLocation: false };
  }

  async checkLocationDetailed(userId: string, latitude: number, longitude: number): Promise<{
    isInWorkLocation: boolean;
    location?: any;
    distance?: number;
    nearestLocation?: any;
    nearestDistance?: number;
    allLocations: Array<{
      id: string;
      name: string;
      distance: number;
      isInside: boolean;
      geofenceType: string;
      radius?: number;
    }>;
  }> {
    try {
      const allLocations = await storage.getAllWorkLocations();
      const results: Array<{
        id: string;
        name: string;
        distance: number;
        isInside: boolean;
        geofenceType: string;
        radius?: number;
      }> = [];

      let foundLocation: any = null;
      let foundDistance: number | undefined;
      let nearestLoc: any = null;
      let nearestDist = Infinity;

      for (const location of allLocations) {
        if (!location.latitude || !location.longitude || !location.isActive) continue;

        const geofenceType = (location as any).geofenceType || 'radius';
        const distance = this.calculateDistance(
          latitude, longitude,
          parseFloat(location.latitude),
          parseFloat(location.longitude)
        );

        let isInside = false;
        if (geofenceType === 'polygon') {
          const polygon = (location as any).geofencePolygon as Array<{ lat: number; lng: number }> | null;
          if (polygon && polygon.length >= 3) {
            isInside = this.isPointInPolygon(latitude, longitude, polygon);
          }
          if (!isInside) {
            isInside = distance <= (location.radius || 100);
          }
        } else {
          isInside = distance <= (location.radius || 100);
        }

        results.push({
          id: location.id,
          name: location.name,
          distance: Math.round(distance),
          isInside,
          geofenceType,
          radius: location.radius || undefined,
        });

        if (isInside && !foundLocation) {
          foundLocation = location;
          foundDistance = distance;
        }

        if (distance < nearestDist) {
          nearestDist = distance;
          nearestLoc = location;
        }
      }

      return {
        isInWorkLocation: !!foundLocation,
        location: foundLocation,
        distance: foundDistance,
        nearestLocation: nearestLoc,
        nearestDistance: nearestLoc ? Math.round(nearestDist) : undefined,
        allLocations: results,
      };
    } catch (error) {
      console.error('Error checking detailed location:', error);
      throw error;
    }
  }

  async processGeofenceEvent(event: GeofenceEvent): Promise<void> {
    try {
      const { userId, latitude, longitude, eventType, timestamp } = event;
      
      const locationCheck = await this.checkUserLocation(userId, latitude, longitude);
      let activeTimeEntry = await storage.getActiveTimeEntry(userId);

      if (!activeTimeEntry && (eventType === 'exit' || eventType === 'auto_clock_out')) {
        console.warn(`[Geofence] No active time entry found for user ${userId} during ${eventType} event, retrying...`);
        await new Promise(resolve => setTimeout(resolve, 500));
        activeTimeEntry = await storage.getActiveTimeEntry(userId);
        if (!activeTimeEntry) {
          console.warn(`[Geofence] Still no active time entry for user ${userId} during ${eventType} event`);
        }
      }

      const locationId = locationCheck.location?.id || event.locationId || '';

      await db.insert(geofenceEvents).values({
        userId,
        locationId: locationId || 'unknown',
        eventType,
        latitude: String(latitude),
        longitude: String(longitude),
        distanceFromCenter: locationCheck.distance ? String(Math.round(locationCheck.distance)) : null,
        timeEntryId: activeTimeEntry?.id || null,
      });

      if (eventType === 'enter' && locationCheck.isInWorkLocation) {
        if (activeExitTimers.has(userId)) {
          clearTimeout(activeExitTimers.get(userId)!);
          activeExitTimers.delete(userId);
          console.log(`[Geofence] User ${userId} returned to work location, cancelled auto clock-out`);
        }
        if (!activeTimeEntry) {
          await notificationService.sendClockInReminder(userId, locationCheck.location!.name);
        }
      } else if (eventType === 'exit') {
        if (activeTimeEntry) {
          const exitLocation = await this.getLocationForTimeEntry(activeTimeEntry);
          const { graceMs, autoClockOut } = await this.getEffectiveGraceMs(exitLocation);

          await notificationService.sendClockOutReminder(
            userId,
            exitLocation?.name || 'work location'
          );

          if (autoClockOut) {
            if (activeExitTimers.has(userId)) {
              clearTimeout(activeExitTimers.get(userId)!);
            }
            console.log(`[Geofence] Auto clock-out scheduled for user ${userId} in ${graceMs / 1000} seconds`);
            
            const timer = setTimeout(async () => {
              activeExitTimers.delete(userId);
              await this.executeAutoClockOut(userId, latitude, longitude);
            }, graceMs);
            
            activeExitTimers.set(userId, timer);
          }
        }
      }
    } catch (error) {
      console.error('Error processing geofence event:', error);
      throw error;
    }
  }

  private async getLocationForTimeEntry(timeEntry: any): Promise<any> {
    if (timeEntry.locationId) {
      const allLocations = await storage.getAllWorkLocations();
      return allLocations.find(l => l.id === timeEntry.locationId) || null;
    }
    return null;
  }

  private async getEffectiveGraceMs(exitLocation: any): Promise<{ graceMs: number; graceMinutes: number; autoClockOut: boolean }> {
    let autoClockOut = exitLocation ? (exitLocation as any).autoClockOut !== false : false;

    const locationGrace = exitLocation ? parseFloat(String((exitLocation as any).geofenceGraceMinutes ?? '')) : NaN;
    console.log(`[Geofence] getEffectiveGraceMs: locationGrace=${locationGrace}, autoClockOut=${autoClockOut}, exitLocation=${exitLocation ? exitLocation.name : 'null'}`);

    if (!isNaN(locationGrace) && locationGrace > 0) {
      const graceMs = Math.round(locationGrace * 60 * 1000);
      console.log(`[Geofence] Using location grace period: ${locationGrace} min (${graceMs}ms)`);
      return { graceMs, graceMinutes: locationGrace, autoClockOut };
    }

    try {
      const companySettings = await storage.getCompanySettings();
      if (companySettings) {
        const rawVal = companySettings.autoClockOutAfterMinutes;
        const companyGrace = parseFloat(String(rawVal ?? ''));
        const companyAutoClockOutEnabled = companySettings.autoClockOutEnabled === true;
        console.log(`[Geofence] Company settings fallback: rawVal='${rawVal}', parsed=${companyGrace}, companyAutoClockOutEnabled=${companyAutoClockOutEnabled}`);
        if (!isNaN(companyGrace) && companyGrace > 0) {
          const graceMs = Math.round(companyGrace * 60 * 1000);
          autoClockOut = autoClockOut || companyAutoClockOutEnabled;
          console.log(`[Geofence] Using company grace period: ${companyGrace} min (${graceMs}ms), autoClockOut=${autoClockOut}`);
          return { graceMs, graceMinutes: companyGrace, autoClockOut };
        }
      } else {
        console.log(`[Geofence] No company settings found`);
      }
    } catch (e) {
      console.error('[Geofence] Failed to read company settings for grace period:', e);
    }

    console.log(`[Geofence] Using fallback grace period: 10s`);
    return { graceMs: 10000, graceMinutes: 0, autoClockOut };
  }

  recordLocationReport(userId: string) {
    lastLocationReport.set(userId, Date.now());
  }

  getLastLocationReport(userId: string): number | undefined {
    return lastLocationReport.get(userId);
  }

  async handleLocationLost(userId: string): Promise<boolean> {
    const activeTimeEntry = await storage.getActiveTimeEntry(userId);
    if (!activeTimeEntry) return false;

    await db.insert(geofenceEvents).values({
      userId,
      locationId: activeTimeEntry.locationId || 'unknown',
      eventType: 'location_lost',
      latitude: null,
      longitude: null,
      timeEntryId: activeTimeEntry.id,
    });

    console.log(`[Geofence] Location permission lost for user ${userId}, scheduling auto clock-out`);

    const exitLocation = await this.getLocationForTimeEntry(activeTimeEntry);
    const { graceMs, autoClockOut } = await this.getEffectiveGraceMs(exitLocation);

    if (autoClockOut) {
      if (activeExitTimers.has(userId)) {
        clearTimeout(activeExitTimers.get(userId)!);
      }
      console.log(`[Geofence] Auto clock-out (location lost) scheduled for user ${userId} in ${graceMs / 1000} seconds`);

      const timer = setTimeout(async () => {
        activeExitTimers.delete(userId);
        const entry = await storage.getActiveTimeEntry(userId);
        if (entry) {
          await storage.updateTimeEntry(entry.id, {
            clockOutTime: new Date(),
            clockOutSource: 'auto-geofence',
            notes: `${entry.notes ? entry.notes + ' | ' : ''}Auto clocked out: location permission revoked`,
          });
          await db.insert(geofenceEvents).values({
            userId,
            locationId: entry.locationId || 'unknown',
            eventType: 'auto_clock_out',
            latitude: null,
            longitude: null,
            timeEntryId: entry.id,
          });
          console.log(`[Geofence] Auto clocked out user ${userId} due to location permission loss`);
        }
      }, graceMs);

      activeExitTimers.set(userId, timer);
    }

    return true;
  }

  async executeAutoClockOut(userId: string, latitude?: number, longitude?: number): Promise<boolean> {
    try {
      const activeTimeEntry = await storage.getActiveTimeEntry(userId);
      if (!activeTimeEntry) {
        console.log(`[Geofence] No active time entry for user ${userId}, skipping auto clock-out`);
        return false;
      }

      if (latitude != null && longitude != null) {
        const currentCheck = await this.checkUserLocation(userId, latitude, longitude);
        if (currentCheck.isInWorkLocation) {
          console.log(`[Geofence] User ${userId} is back in work location, skipping auto clock-out`);
          return false;
        }
      }

      const exitEvent = await db.select()
        .from(geofenceEvents)
        .where(and(
          eq(geofenceEvents.userId, userId),
          eq(geofenceEvents.eventType, 'exit'),
          eq(geofenceEvents.timeEntryId, activeTimeEntry.id)
        ))
        .orderBy(desc(geofenceEvents.createdAt))
        .limit(1);

      const reEnterEvent = await db.select()
        .from(geofenceEvents)
        .where(and(
          eq(geofenceEvents.userId, userId),
          eq(geofenceEvents.eventType, 'enter'),
        ))
        .orderBy(desc(geofenceEvents.createdAt))
        .limit(1);

      if (reEnterEvent.length > 0 && exitEvent.length > 0 &&
          reEnterEvent[0].createdAt && exitEvent[0].createdAt &&
          reEnterEvent[0].createdAt > exitEvent[0].createdAt) {
        console.log(`[Geofence] User ${userId} re-entered after last exit, skipping auto clock-out`);
        return false;
      }

      await storage.updateTimeEntry(activeTimeEntry.id, {
        clockOutTime: new Date(),
        clockOutSource: 'auto-geofence',
        notes: `${activeTimeEntry.notes ? activeTimeEntry.notes + ' | ' : ''}Auto clocked out: left geofence boundary`,
      });

      await db.insert(geofenceEvents).values({
        userId,
        locationId: activeTimeEntry.locationId || 'unknown',
        eventType: 'auto_clock_out',
        latitude: latitude != null ? String(latitude) : null,
        longitude: longitude != null ? String(longitude) : null,
        timeEntryId: activeTimeEntry.id,
      });

      console.log(`[Geofence] Auto clocked out user ${userId} (entry ${activeTimeEntry.id})`);
      return true;
    } catch (error) {
      console.error(`[Geofence] Failed to auto clock-out user ${userId}:`, error);
      return false;
    }
  }

  async checkAndHandleGeofenceExit(userId: string, latitude: number, longitude: number): Promise<{
    isOutside: boolean;
    autoClockOutTriggered: boolean;
    graceMinutes: number;
    graceRemaining: number | null;
    exitedAt: Date | null;
  }> {
    const activeTimeEntry = await storage.getActiveTimeEntry(userId);
    if (!activeTimeEntry) {
      return { isOutside: false, autoClockOutTriggered: false, graceMinutes: 0, graceRemaining: null, exitedAt: null };
    }

    const locationCheck = await this.checkUserLocation(userId, latitude, longitude);
    if (locationCheck.isInWorkLocation) {
      return { isOutside: false, autoClockOutTriggered: false, graceMinutes: 0, graceRemaining: null, exitedAt: null };
    }

    const exitLocation = await this.getLocationForTimeEntry(activeTimeEntry);
    const effective = await this.getEffectiveGraceMs(exitLocation);
    const { graceMs, autoClockOut } = effective;
    const graceMinutes = effective.graceMinutes;

    let recentExitEvents = await db.select()
      .from(geofenceEvents)
      .where(and(
        eq(geofenceEvents.userId, userId),
        eq(geofenceEvents.eventType, 'exit'),
        eq(geofenceEvents.timeEntryId, activeTimeEntry.id)
      ))
      .orderBy(desc(geofenceEvents.createdAt))
      .limit(1);

    if (recentExitEvents.length === 0) {
      const unlinkedExitEvents = await db.select()
        .from(geofenceEvents)
        .where(and(
          eq(geofenceEvents.userId, userId),
          eq(geofenceEvents.eventType, 'exit'),
          isNull(geofenceEvents.timeEntryId)
        ))
        .orderBy(desc(geofenceEvents.createdAt))
        .limit(1);

      if (unlinkedExitEvents.length > 0 && unlinkedExitEvents[0].createdAt) {
        const exitTime = unlinkedExitEvents[0].createdAt;
        const clockInTime = activeTimeEntry.clockInTime ? new Date(activeTimeEntry.clockInTime) : null;
        if (clockInTime && exitTime >= clockInTime) {
          await db.update(geofenceEvents)
            .set({ timeEntryId: activeTimeEntry.id })
            .where(eq(geofenceEvents.id, unlinkedExitEvents[0].id));
          console.log(`[Geofence] Linked orphaned exit event ${unlinkedExitEvents[0].id} to time entry ${activeTimeEntry.id}`);
          recentExitEvents = unlinkedExitEvents;
        }
      }
    }

    if (recentExitEvents.length === 0) {
      console.log(`[Geofence] No exit event found for user ${userId}, creating one now`);
      const locationId = exitLocation?.id || activeTimeEntry.locationId || 'unknown';
      const [newEvent] = await db.insert(geofenceEvents).values({
        userId,
        locationId,
        eventType: 'exit',
        latitude: String(latitude),
        longitude: String(longitude),
        timeEntryId: activeTimeEntry.id,
      }).returning();
      recentExitEvents = [newEvent];
    }

    let exitedAt: Date | null = null;
    let graceRemaining: number | null = null;

    if (recentExitEvents.length > 0 && recentExitEvents[0].createdAt) {
      exitedAt = recentExitEvents[0].createdAt;
      const elapsedMs = Date.now() - exitedAt.getTime();
      graceRemaining = Math.max(0, Math.ceil((graceMs - elapsedMs) / 1000));
      console.log(`[Geofence] checkAndHandleGeofenceExit: elapsedMs=${elapsedMs}, graceMs=${graceMs}, autoClockOut=${autoClockOut}, graceRemaining=${graceRemaining}s`);

      if (autoClockOut && elapsedMs >= graceMs) {
        console.log(`[Geofence] Grace period expired for user ${userId}, executing auto clock-out`);
        const clocked = await this.executeAutoClockOut(userId, latitude, longitude);
        return { isOutside: true, autoClockOutTriggered: clocked, graceMinutes, graceRemaining: 0, exitedAt };
      }
    }

    return { isOutside: true, autoClockOutTriggered: false, graceMinutes, graceRemaining, exitedAt };
  }

  async validateClockInLocation(userId: string, latitude: number, longitude: number): Promise<{
    isValid: boolean;
    location?: any;
    error?: string;
  }> {
    try {
      const locationCheck = await this.checkUserLocation(userId, latitude, longitude);
      
      if (!locationCheck.isInWorkLocation) {
        return {
          isValid: false,
          error: 'You must be at a work location to clock in. Please move closer to your assigned workplace.',
        };
      }

      return {
        isValid: true,
        location: locationCheck.location,
      };
    } catch (error) {
      console.error('Error validating clock-in location:', error);
      return {
        isValid: false,
        error: 'Unable to verify your location. Please try again.',
      };
    }
  }

  async getNearestWorkLocation(latitude: number, longitude: number): Promise<{
    location?: any;
    distance?: number;
  }> {
    try {
      const allLocations = await storage.getAllWorkLocations();
      let nearestLocation = null;
      let minDistance = Infinity;

      for (const location of allLocations) {
        if (!location.latitude || !location.longitude) continue;
        
        const distance = this.calculateDistance(
          latitude, longitude,
          parseFloat(location.latitude),
          parseFloat(location.longitude)
        );

        if (distance < minDistance) {
          minDistance = distance;
          nearestLocation = location;
        }
      }

      return {
        location: nearestLocation,
        distance: nearestLocation ? minDistance : undefined,
      };
    } catch (error) {
      console.error('Error finding nearest work location:', error);
      throw error;
    }
  }

  async monitorUserLocation(userId: string, currentLat: number, currentLon: number, previousLat?: number, previousLon?: number): Promise<void> {
    try {
      const currentLocationCheck = await this.checkUserLocation(userId, currentLat, currentLon);
      
      if (previousLat && previousLon) {
        const previousLocationCheck = await this.checkUserLocation(userId, previousLat, previousLon);
        
        if (!previousLocationCheck.isInWorkLocation && currentLocationCheck.isInWorkLocation) {
          await this.processGeofenceEvent({
            userId,
            latitude: currentLat,
            longitude: currentLon,
            timestamp: new Date(),
            eventType: 'enter',
            locationId: currentLocationCheck.location?.id,
          });
        } else if (previousLocationCheck.isInWorkLocation && !currentLocationCheck.isInWorkLocation) {
          await this.processGeofenceEvent({
            userId,
            latitude: currentLat,
            longitude: currentLon,
            timestamp: new Date(),
            eventType: 'exit',
            locationId: previousLocationCheck.location?.id,
          });
        }
      } else if (!currentLocationCheck.isInWorkLocation) {
        const activeTimeEntry = await storage.getActiveTimeEntry(userId);
        if (activeTimeEntry) {
          const existingExit = await db.select()
            .from(geofenceEvents)
            .where(and(
              eq(geofenceEvents.userId, userId),
              eq(geofenceEvents.eventType, 'exit'),
              eq(geofenceEvents.timeEntryId, activeTimeEntry.id)
            ))
            .limit(1);
          if (existingExit.length === 0) {
            console.log(`[Geofence] First position for user ${userId} is outside geofence, recording exit event`);
            await this.processGeofenceEvent({
              userId,
              latitude: currentLat,
              longitude: currentLon,
              timestamp: new Date(),
              eventType: 'exit',
              locationId: activeTimeEntry.locationId || undefined,
            });
          }
        }
      }
    } catch (error) {
      console.error('Error monitoring user location:', error);
    }
  }

  async startStaleLocationChecker() {
    const CHECK_INTERVAL = 60000;
    const STALE_THRESHOLD = 5 * 60 * 1000;

    setInterval(async () => {
      try {
        const activeEntries = await db.select()
          .from(timeEntries)
          .where(isNull(timeEntries.clockOutTime));

        for (const entry of activeEntries) {
          const lastReport = this.getLastLocationReport(entry.userId);
          if (lastReport && Date.now() - lastReport > STALE_THRESHOLD) {
            const alreadyHandled = activeExitTimers.has(entry.userId);
            if (!alreadyHandled) {
              console.log(`[Geofence] User ${entry.userId} hasn't reported location in ${Math.round((Date.now() - lastReport) / 1000)}s, triggering location-lost`);
              await this.handleLocationLost(entry.userId);
            }
          }
        }
      } catch (error) {
        console.error('[Geofence] Stale location check error:', error);
      }
    }, CHECK_INTERVAL);

    console.log('[Geofence] Stale location checker started (checks every 60s)');
  }
}

export const geofencingService = new GeofencingService();
geofencingService.startStaleLocationChecker();
