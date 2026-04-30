import type { Express } from "express";
import type { IStorage } from "../storage";
import { geofencingService } from "../services/geofencingService";
import { db } from "../db";
import { workLocations, geofenceEvents, users } from "@shared/schema";
import { eq, desc } from "drizzle-orm";
import { resolvePermission, resolveAnyPermission } from "../services/permissionResolver";

export function registerGeofenceRoutes(app: Express, storage: IStorage, isAuthenticated: any) {
  app.post('/api/geofence/check', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const { latitude, longitude, wifiSsid } = req.body;
      
      const result = await geofencingService.checkLocationOrWifi(userId, latitude, longitude, wifiSsid);
      res.json(result);
    } catch (error) {
      console.error("Error checking geofence:", error);
      res.status(500).json({ message: "Failed to check location" });
    }
  });

  app.post('/api/geofence/check-detailed', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const { latitude, longitude } = req.body;
      
      if (latitude == null || longitude == null) {
        return res.status(400).json({ message: "Latitude and longitude are required" });
      }

      const result = await geofencingService.checkLocationDetailed(userId, latitude, longitude);
      res.json(result);
    } catch (error) {
      console.error("Error checking detailed geofence:", error);
      res.status(500).json({ message: "Failed to check location" });
    }
  });

  app.post('/api/geofence/event', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const { latitude, longitude, eventType } = req.body;
      
      await geofencingService.processGeofenceEvent({
        userId,
        latitude,
        longitude,
        eventType,
        timestamp: new Date(),
      });
      
      res.json({ success: true });
    } catch (error) {
      console.error("Error processing geofence event:", error);
      res.status(500).json({ message: "Failed to process geofence event" });
    }
  });

  app.post('/api/geofence/monitor', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const { latitude, longitude, previousLatitude, previousLongitude } = req.body;

      if (latitude == null || longitude == null) {
        return res.status(400).json({ message: "Current location is required" });
      }

      geofencingService.recordLocationReport(userId);

      await geofencingService.monitorUserLocation(
        userId, latitude, longitude,
        previousLatitude, previousLongitude
      );

      const currentStatus = await geofencingService.checkLocationDetailed(userId, latitude, longitude);

      let boundaryProximity: number | null = null;
      if (currentStatus.isInWorkLocation && currentStatus.location) {
        const loc = currentStatus.location;
        const locLat = parseFloat(loc.latitude || '0');
        const locLng = parseFloat(loc.longitude || '0');
        const distToCenter = geofencingService.calculateDistance(latitude, longitude, locLat, locLng);
        const geoType = (loc as any).geofenceType || 'radius';
        if (geoType === 'radius') {
          const radius = loc.radius || 100;
          boundaryProximity = distToCenter / radius;
        }
      }

      let geofenceExitInfo = null;
      if (!currentStatus.isInWorkLocation) {
        const exitCheck = await geofencingService.checkAndHandleGeofenceExit(userId, latitude, longitude);
        geofenceExitInfo = {
          autoClockOutTriggered: exitCheck.autoClockOutTriggered,
          graceMinutes: exitCheck.graceMinutes,
          graceRemaining: exitCheck.graceRemaining,
          exitedAt: exitCheck.exitedAt,
        };
      }

      res.json({
        isInWorkLocation: currentStatus.isInWorkLocation,
        location: currentStatus.location ? {
          id: currentStatus.location.id,
          name: currentStatus.location.name,
          radius: currentStatus.location.radius,
          geofenceType: (currentStatus.location as any).geofenceType || 'radius',
        } : null,
        distance: currentStatus.distance,
        boundaryProximity,
        nearestLocation: currentStatus.nearestLocation ? {
          id: currentStatus.nearestLocation.id,
          name: currentStatus.nearestLocation.name,
          distance: currentStatus.nearestDistance,
        } : null,
        geofenceExitInfo,
      });
    } catch (error) {
      console.error("Error monitoring location:", error);
      res.status(500).json({ message: "Failed to monitor location" });
    }
  });

  app.post('/api/geofence/location-lost', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.id;
      // Location permission errors are NOT confirmed geofence exits.
      // We log the event for auditing but do NOT schedule any auto clock-out.
      // Auto clock-outs are only triggered by confirmed geofence boundary exits.
      console.warn(`[Geofence] Location permission lost reported for user ${userId} — logging only, no auto clock-out scheduled.`);
      const activeEntry = await storage.getActiveTimeEntry(userId);
      if (activeEntry && activeEntry.locationId) {
        await db.insert(geofenceEvents).values({
          userId,
          locationId: activeEntry.locationId,
          eventType: 'location_lost',
          latitude: null,
          longitude: null,
          timeEntryId: activeEntry.id,
        });
      }
      res.json({ handled: false, message: 'Location loss logged; no auto clock-out scheduled' });
    } catch (error) {
      console.error("Error handling location lost:", error);
      res.status(500).json({ message: "Failed to handle location loss" });
    }
  });

  app.get('/api/geofence/events', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const isAdmin = await resolveAnyPermission(userId, ['admin.manage_all', 'admin.manage_locations'], storage);
      if (!isAdmin) {
        return res.status(403).json({ message: "Admin access required" });
      }

      const events = await db.select()
        .from(geofenceEvents)
        .orderBy(desc(geofenceEvents.createdAt))
        .limit(200);

      const allUsers = await storage.getAllUsers();
      const userMap = new Map(allUsers.map(u => [u.id, u]));
      const allLocations = await storage.getAllWorkLocations();
      const locationMap = new Map(allLocations.map(l => [l.id, l]));

      const enrichedEvents = events.map(event => ({
        ...event,
        userName: userMap.get(event.userId)?.firstName 
          ? `${userMap.get(event.userId)?.firstName} ${userMap.get(event.userId)?.lastName || ''}`.trim()
          : userMap.get(event.userId)?.email || 'Unknown',
        locationName: locationMap.get(event.locationId)?.name || 'Unknown Location',
      }));

      res.json(enrichedEvents);
    } catch (error) {
      console.error("Error fetching geofence events:", error);
      res.status(500).json({ message: "Failed to fetch events" });
    }
  });

  app.get('/api/work-locations', isAuthenticated, async (req: any, res) => {
    try {
      const locations = await db.select().from(workLocations).where(eq(workLocations.isActive, true));
      res.json(locations);
    } catch (error) {
      console.error("Error fetching work locations:", error);
      res.status(500).json({ message: "Failed to fetch locations" });
    }
  });

  app.post('/api/work-locations', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const canManage = await resolveAnyPermission(userId, ['admin.manage_all', 'admin.manage_locations'], storage);
      if (!canManage) {
        return res.status(403).json({ message: "Admin access required" });
      }

      const { name, address, phone, email, timezone, hoursOfOperation, latitude, longitude, radius, geofenceType, geofencePolygon, geofenceGraceMinutes, geofenceEnabled, autoClockOut } = req.body;

      if (!name) {
        return res.status(400).json({ message: "Location name is required" });
      }

      const [location] = await db.insert(workLocations).values({
        name,
        address: address || null,
        phone: phone || null,
        email: email || null,
        timezone: timezone || null,
        hoursOfOperation: hoursOfOperation || null,
        latitude: latitude ? String(latitude) : null,
        longitude: longitude ? String(longitude) : null,
        radius: radius || 100,
        geofenceType: geofenceType || 'radius',
        geofencePolygon: geofencePolygon || null,
        geofenceGraceMinutes: geofenceGraceMinutes ?? 5,
        geofenceEnabled: geofenceEnabled !== false,
        autoClockOut: autoClockOut !== false,
      }).returning();

      res.json(location);
    } catch (error) {
      console.error("Error creating work location:", error);
      res.status(500).json({ message: "Failed to create location" });
    }
  });

  app.put('/api/work-locations/:id', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const canManage = await resolveAnyPermission(userId, ['admin.manage_all', 'admin.manage_locations'], storage);
      if (!canManage) {
        return res.status(403).json({ message: "Admin access required" });
      }

    const { id } = req.params;
    const validated = req.body;

    const updateData: any = {};
    if (validated.name !== undefined) updateData.name = validated.name;
    if (validated.address !== undefined) updateData.address = validated.address;
    if (validated.phone !== undefined) updateData.phone = validated.phone;
    if (validated.email !== undefined) updateData.email = validated.email;
    if (validated.timezone !== undefined) updateData.timezone = validated.timezone;
    if (validated.hoursOfOperation !== undefined) updateData.hoursOfOperation = validated.hoursOfOperation;
    if (validated.latitude !== undefined) updateData.latitude = validated.latitude ? String(validated.latitude) : null;
    if (validated.longitude !== undefined) updateData.longitude = validated.longitude ? String(validated.longitude) : null;
    if (validated.radius !== undefined) updateData.radius = validated.radius;
    if (validated.geofenceType !== undefined) updateData.geofenceType = validated.geofenceType;
    if (validated.geofencePolygon !== undefined) updateData.geofencePolygon = validated.geofencePolygon;
    if (validated.geofenceGraceMinutes !== undefined) {
      updateData.geofenceGraceMinutes = validated.geofenceGraceMinutes !== null ? String(validated.geofenceGraceMinutes) : "5.00";
    }
    if (validated.geofenceEnabled !== undefined) updateData.geofenceEnabled = validated.geofenceEnabled;
    if (validated.autoClockOut !== undefined) updateData.autoClockOut = validated.autoClockOut;

    const result = await db.transaction(async (tx) => {
      const [updated] = await tx.update(workLocations)
        .set(updateData)
        .where(eq(workLocations.id, id))
        .returning();

      if (!updated) return null;

      if (updateData.name !== undefined) {
        await tx.update(users)
          .set({ locationName: updated.name })
          .where(eq(users.locationId, id));
      }

      return updated;
    });

      if (!result) {
        return res.status(404).json({ message: "Location not found" });
      }

      res.json(result);
    } catch (error) {
      console.error("Error updating work location:", error);
      res.status(500).json({ message: "Failed to update location" });
    }
  });

  app.delete('/api/work-locations/:id', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const canManage = await resolveAnyPermission(userId, ['admin.manage_all', 'admin.manage_locations'], storage);
      if (!canManage) {
        return res.status(403).json({ message: "Admin access required" });
      }

      const { id } = req.params;

      await db.update(workLocations)
        .set({ isActive: false })
        .where(eq(workLocations.id, id));

      res.json({ success: true });
    } catch (error) {
      console.error("Error deleting work location:", error);
      res.status(500).json({ message: "Failed to delete location" });
    }
  });
}
