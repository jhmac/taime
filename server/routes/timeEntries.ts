import type { Express } from "express";
import type { IStorage } from "../storage";
import { insertTimeEntrySchema } from "@shared/schema";
import { geofencingService } from "../services/geofencingService";

export function registerTimeEntryRoutes(app: Express, storage: IStorage, isAuthenticated: any, broadcastToAll: (data: any) => void) {
  app.post('/api/time-entries', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const body = { ...req.body, userId };
      const data = insertTimeEntrySchema.parse(body);
      
      if (data.clockInTime && data.locationId) {
        const user = await storage.getUser(userId);
        if (user && req.body.latitude && req.body.longitude) {
          const validation = await geofencingService.validateClockInLocation(
            userId,
            req.body.latitude,
            req.body.longitude
          );
          
          if (!validation.isValid) {
            return res.status(400).json({ message: validation.error });
          }
        }
      }

      const timeEntry = await storage.createTimeEntry(data);
      
      broadcastToAll({
        type: 'time_entry_created',
        data: { timeEntry, userId },
      });

      res.json(timeEntry);
    } catch (error) {
      console.error("Error creating time entry:", error);
      res.status(400).json({ message: (error as Error).message });
    }
  });

  app.get('/api/time-entries', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const user = await storage.getUser(userId);
      
      const startDate = req.query.startDate ? new Date(req.query.startDate as string) : undefined;
      const endDate = req.query.endDate ? new Date(req.query.endDate as string) : undefined;

      let timeEntries;
      const userPermissions = await storage.getUserPermissions(userId);
      const canViewAll = userPermissions.some(p => p.name === 'time.view_all');
      
      if (canViewAll) {
        timeEntries = await storage.getAllTimeEntries(startDate, endDate);
      } else {
        timeEntries = await storage.getUserTimeEntries(userId, startDate, endDate);
      }

      res.json(timeEntries);
    } catch (error) {
      console.error("Error fetching time entries:", error);
      res.status(500).json({ message: "Failed to fetch time entries" });
    }
  });

  app.get('/api/time-entries/active', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const activeEntry = await storage.getActiveTimeEntry(userId);
      res.json(activeEntry);
    } catch (error) {
      console.error("Error fetching active time entry:", error);
      res.status(500).json({ message: "Failed to fetch active time entry" });
    }
  });

  app.patch('/api/time-entries/:id', isAuthenticated, async (req: any, res) => {
    try {
      const { id } = req.params;
      const userId = req.user.id;

      const existing = await storage.getTimeEntry(id);
      if (!existing) {
        return res.status(404).json({ message: "Time entry not found" });
      }

      const userPermissions = await storage.getUserPermissions(userId);
      const isManager = userPermissions.some(p => p.name === 'time.approve' || p.name === 'admin.manage_all');
      const isOwner = existing.userId === userId;

      if (!isOwner && !isManager) {
        return res.status(403).json({ message: "You can only edit your own time entries" });
      }

      const allowedFields = isManager
        ? ['clockOutTime', 'breakMinutes', 'notes', 'locationId', 'isApproved', 'status', 'clockInSource', 'clockOutSource']
        : ['clockOutTime', 'breakMinutes', 'notes', 'clockInSource', 'clockOutSource'];

      const safeUpdates: Record<string, any> = {};
      for (const key of allowedFields) {
        if (req.body[key] !== undefined) {
          safeUpdates[key] = req.body[key];
        }
      }
      if (typeof safeUpdates.clockOutTime === 'string') safeUpdates.clockOutTime = new Date(safeUpdates.clockOutTime);
      if (typeof safeUpdates.clockInTime === 'string') safeUpdates.clockInTime = new Date(safeUpdates.clockInTime);

      if (safeUpdates.isApproved === true) {
        safeUpdates.approvedBy = userId;
      }

      const timeEntry = await storage.updateTimeEntry(id, safeUpdates);
      
      broadcastToAll({
        type: 'time_entry_updated',
        data: { timeEntry },
      });

      res.json(timeEntry);
    } catch (error) {
      console.error("Error updating time entry:", error);
      res.status(400).json({ message: (error as Error).message });
    }
  });
}
