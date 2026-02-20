import { storage } from '../storage';
import { notificationService } from './notificationService';
import { db } from '../db';
import { geofenceEvents, timeEntries, workLocations } from '@shared/schema';
import { eq, and, isNull } from 'drizzle-orm';

export interface GeofenceEvent {
  userId: string;
  latitude: number;
  longitude: number;
  timestamp: Date;
  eventType: 'enter' | 'exit' | 'warning' | 'auto_clock_out';
  locationId?: string;
}

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

        if (geofenceType === 'polygon') {
          const polygon = (location as any).geofencePolygon as Array<{ lat: number; lng: number }> | null;
          if (polygon && polygon.length >= 3) {
            if (this.isPointInPolygon(latitude, longitude, polygon)) {
              const distance = this.calculateDistance(
                latitude, longitude,
                parseFloat(location.latitude),
                parseFloat(location.longitude)
              );
              return { isInWorkLocation: true, location, distance, verifiedVia: 'gps' };
            }
          }
        } else {
          const distance = this.calculateDistance(
            latitude, longitude,
            parseFloat(location.latitude),
            parseFloat(location.longitude)
          );
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
      const activeTimeEntry = await storage.getActiveTimeEntry(userId);

      await db.insert(geofenceEvents).values({
        userId,
        locationId: locationCheck.location?.id || event.locationId || '',
        eventType,
        latitude: String(latitude),
        longitude: String(longitude),
        distanceFromCenter: locationCheck.distance ? String(Math.round(locationCheck.distance)) : null,
        timeEntryId: activeTimeEntry?.id || null,
      });

      if (eventType === 'enter' && locationCheck.isInWorkLocation) {
        if (!activeTimeEntry) {
          await notificationService.sendClockInReminder(userId, locationCheck.location!.name);
        }
      } else if (eventType === 'exit') {
        if (activeTimeEntry) {
          const location = locationCheck.location;
          const autoClockOut = location ? (location as any).autoClockOut !== false : false;
          const graceMinutes = location ? ((location as any).geofenceGraceMinutes || 5) : 5;

          await notificationService.sendClockOutReminder(
            userId,
            location?.name || 'work location'
          );

          if (autoClockOut) {
            console.log(`Auto clock-out scheduled for user ${userId} in ${graceMinutes} minutes`);
          }
        }
      }
    } catch (error) {
      console.error('Error processing geofence event:', error);
      throw error;
    }
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
      }
    } catch (error) {
      console.error('Error monitoring user location:', error);
    }
  }
}

export const geofencingService = new GeofencingService();
