import { storage } from '../storage';
import { notificationService } from './notificationService';

export interface GeofenceEvent {
  userId: string;
  latitude: number;
  longitude: number;
  timestamp: Date;
  eventType: 'enter' | 'exit';
  locationId?: string;
}

export class GeofencingService {
  private calculateDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
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

  async checkUserLocation(userId: string, latitude: number, longitude: number): Promise<{
    isInWorkLocation: boolean;
    location?: any;
    distance?: number;
    verifiedVia?: 'gps';
  }> {
    try {
      const workLocations = await storage.getAllWorkLocations();
      
      for (const location of workLocations) {
        if (!location.latitude || !location.longitude) continue;
        
        const distance = this.calculateDistance(
          latitude,
          longitude,
          parseFloat(location.latitude),
          parseFloat(location.longitude)
        );

        if (distance <= (location.radius || 100)) {
          return {
            isInWorkLocation: true,
            location,
            distance,
            verifiedVia: 'gps',
          };
        }
      }

      return {
        isInWorkLocation: false,
      };
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

      const workLocations = await storage.getAllWorkLocations();
      const normalizedSsid = wifiSsid.trim().toLowerCase();
      
      for (const location of workLocations) {
        if (!location.wifiSsid) continue;
        const locationSsid = location.wifiSsid.trim().toLowerCase();
        if (locationSsid === normalizedSsid) {
          return {
            isInWorkLocation: true,
            location,
            verifiedVia: 'wifi',
          };
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

  /**
   * Process geofence event (enter/exit work location)
   */
  async processGeofenceEvent(event: GeofenceEvent): Promise<void> {
    try {
      const { userId, latitude, longitude, eventType, timestamp } = event;
      
      // Check current location status
      const locationCheck = await this.checkUserLocation(userId, latitude, longitude);
      
      // Get user's current time entry status
      const activeTimeEntry = await storage.getActiveTimeEntry(userId);
      
      if (eventType === 'enter' && locationCheck.isInWorkLocation) {
        // User entered work location
        if (!activeTimeEntry) {
          // User arrived but hasn't clocked in
          await notificationService.sendClockInReminder(userId, locationCheck.location!.name);
        }
      } else if (eventType === 'exit') {
        // User exited work location
        if (activeTimeEntry) {
          // User left but is still clocked in
          await notificationService.sendClockOutReminder(userId, locationCheck.location?.name || 'work location');
        }
      }

      // Log the event for analytics
      console.log(`Geofence event processed: User ${userId} ${eventType} ${locationCheck.location?.name || 'unknown location'}`);
    } catch (error) {
      console.error('Error processing geofence event:', error);
      throw error;
    }
  }

  /**
   * Validate clock-in location
   */
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

  /**
   * Get the nearest work location to user's current position
   */
  async getNearestWorkLocation(latitude: number, longitude: number): Promise<{
    location?: any;
    distance?: number;
  }> {
    try {
      const workLocations = await storage.getAllWorkLocations();
      let nearestLocation = null;
      let minDistance = Infinity;

      for (const location of workLocations) {
        if (!location.latitude || !location.longitude) continue;
        
        const distance = this.calculateDistance(
          latitude,
          longitude,
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

  /**
   * Monitor user for automatic geofence events
   * This would typically be called by a background service
   */
  async monitorUserLocation(userId: string, currentLat: number, currentLon: number, previousLat?: number, previousLon?: number): Promise<void> {
    try {
      const currentLocationCheck = await this.checkUserLocation(userId, currentLat, currentLon);
      
      if (previousLat && previousLon) {
        const previousLocationCheck = await this.checkUserLocation(userId, previousLat, previousLon);
        
        // Detect location transitions
        if (!previousLocationCheck.isInWorkLocation && currentLocationCheck.isInWorkLocation) {
          // User entered work location
          await this.processGeofenceEvent({
            userId,
            latitude: currentLat,
            longitude: currentLon,
            timestamp: new Date(),
            eventType: 'enter',
            locationId: currentLocationCheck.location?.id,
          });
        } else if (previousLocationCheck.isInWorkLocation && !currentLocationCheck.isInWorkLocation) {
          // User exited work location
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
