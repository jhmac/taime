import type { Express } from "express";
import type { IStorage } from "../storage";
import { geofencingService } from "../services/geofencingService";

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
}
