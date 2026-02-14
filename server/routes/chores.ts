import type { Express } from "express";
import type { IStorage } from "../storage";
import { choreAssignmentSchema, choreSignOffSchema } from "@shared/schema";

export function registerChoreRoutes(app: Express, storage: IStorage, isAuthenticated: any, broadcastToAll: (data: any) => void) {
  app.get('/api/chores/day/:dayOfWeek', isAuthenticated, async (req: any, res) => {
    try {
      const { dayOfWeek } = req.params;
      const { timeOfDay } = req.query;
      
      const chores = await storage.getChoresForDay(dayOfWeek, timeOfDay as string);
      res.json(chores);
    } catch (error) {
      console.error("Error fetching chores for day:", error);
      res.status(500).json({ message: "Failed to fetch chores" });
    }
  });

  app.get('/api/chores/schedule', isAuthenticated, async (req: any, res) => {
    try {
      const schedule = await storage.getWeeklyChoreSchedule();
      res.json(schedule);
    } catch (error) {
      console.error("Error fetching weekly chore schedule:", error);
      res.status(500).json({ message: "Failed to fetch chore schedule" });
    }
  });

  app.post('/api/chores/assign', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const userPermissions = await storage.getUserPermissions(userId);
      const canAssignTasks = userPermissions.some(p => p.name === 'tasks.create' || p.name === 'tasks.edit_all');
      
      if (!canAssignTasks) {
        return res.status(403).json({ message: "Permission denied: Task assignment access required" });
      }
      
      const data = choreAssignmentSchema.parse(req.body);
      const updatedChore = await storage.assignChoreToUser(data.choreId, data.userId);
      
      broadcastToAll({
        type: 'chore_assigned',
        data: { chore: updatedChore },
      });
      
      res.json(updatedChore);
    } catch (error) {
      console.error("Error assigning chore:", error);
      res.status(400).json({ message: (error as Error).message });
    }
  });

  app.post('/api/chores/signoff', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const data = choreSignOffSchema.parse(req.body);
      
      if (data.isManager) {
        const userPermissions = await storage.getUserPermissions(userId);
        const canApprove = userPermissions.some(p => p.name === 'time.approve' || p.name === 'tasks.edit_all');
        
        if (!canApprove) {
          return res.status(403).json({ message: "Permission denied: Approval access required" });
        }
      }
      
      const updatedChore = await storage.signOffChore(data.choreId, userId, data.isManager);
      
      broadcastToAll({
        type: 'chore_signed_off',
        data: { chore: updatedChore, isManager: data.isManager },
      });
      
      res.json(updatedChore);
    } catch (error) {
      console.error("Error signing off chore:", error);
      res.status(400).json({ message: (error as Error).message });
    }
  });

  app.get('/api/chores/zone/:zone', isAuthenticated, async (req: any, res) => {
    try {
      const { zone } = req.params;
      const chores = await storage.getChoresByZone(zone);
      res.json(chores);
    } catch (error) {
      console.error("Error fetching chores by zone:", error);
      res.status(500).json({ message: "Failed to fetch chores by zone" });
    }
  });
}
