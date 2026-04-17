import type { Express } from "express";
import type { IStorage } from "../storage";
import { insertTaskSchema } from "@shared/schema";
import { notificationService } from "../services/notificationService";
import { tryResolveStoreIdForUser } from "../lib/storeResolver";
import { runAutoAssign } from "./ai";

export function registerTaskRoutes(app: Express, storage: IStorage, isAuthenticated: any, broadcastToAll: (data: any) => void) {
  app.post('/api/tasks', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const data = insertTaskSchema.parse({ ...req.body, createdBy: userId });
      
      const task = await storage.createTask(data);
      
      if (data.assignedTo) {
        const dueTime = data.dueDate ? new Date(data.dueDate).toLocaleString() : 'No due date';
        await notificationService.sendTaskAssignment(data.assignedTo, task.title, dueTime);
      } else {
        // Auto-assign in background if setting is on and no assignee was provided
        storage.getCompanySettings().then(settings => {
          if (settings?.taskAutoAssign) {
            runAutoAssign(storage).catch(err => {
              console.error('[auto-assign] Background assignment failed:', err);
            });
          }
        }).catch(() => {});
      }

      broadcastToAll({
        type: 'task_created',
        data: { task },
      });

      res.json(task);
    } catch (error) {
      console.error("Error creating task:", error);
      res.status(400).json({ message: (error as Error).message });
    }
  });

  app.get('/api/tasks', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.id;

      let tasks;
      const userPermissions = await storage.getUserPermissions(userId);
      const canViewAll = userPermissions.some(p => p.name === 'tasks.view_all');
      
      if (canViewAll) {
        const locationId = await tryResolveStoreIdForUser(userId);
        tasks = await storage.getAllTasks(locationId || undefined);
      } else {
        tasks = await storage.getUserTasks(userId);
      }

      res.json(tasks);
    } catch (error) {
      console.error("Error fetching tasks:", error);
      res.status(500).json({ message: "Failed to fetch tasks" });
    }
  });

  app.patch('/api/tasks/:id', isAuthenticated, async (req: any, res) => {
    try {
      const { id } = req.params;
      const userId = req.user.id;

      const existing = await storage.getTask(id);
      if (!existing) {
        return res.status(404).json({ message: "Task not found" });
      }

      const userPermissions = await storage.getUserPermissions(userId);
      const isManager = userPermissions.some(p => p.name === 'admin.manage_all' || p.name === 'hr.manage_employees');
      const isAssignee = existing.assignedTo === userId;

      if (!isAssignee && !isManager) {
        return res.status(403).json({ message: "You can only update tasks assigned to you" });
      }

      const allowedFields = isManager
        ? ['title', 'description', 'status', 'priority', 'assignedTo', 'dueDate', 'completedAt', 'completionImageUrl', 'zone']
        : ['status', 'completedAt', 'completionImageUrl', 'notes'];

      const safeUpdates: Record<string, any> = {};
      for (const key of allowedFields) {
        if (Object.hasOwn(req.body, key) && req.body[key] !== undefined) {
          safeUpdates[key] = req.body[key];
        }
      }
      
      if (safeUpdates.status === 'completed' && !safeUpdates.completedAt) {
        safeUpdates.completedAt = new Date();
      }

      const task = await storage.updateTask(id, safeUpdates);
      
      broadcastToAll({
        type: 'task_updated',
        data: { task },
      });

      res.json(task);
    } catch (error) {
      console.error("Error updating task:", error);
      res.status(400).json({ message: (error as Error).message });
    }
  });

  app.post('/api/tasks/:id/image', isAuthenticated, async (req: any, res) => {
    try {
      const { id } = req.params;
      const userId = req.user.id;
      const { imageUrl } = req.body;
      
      if (!imageUrl) {
        return res.status(400).json({ message: "Image URL is required" });
      }

      if (typeof imageUrl !== 'string' || imageUrl.length > 2 * 1024 * 1024) {
        return res.status(400).json({ message: "Image too large (max 2MB)" });
      }

      const existing = await storage.getTask(id);
      if (!existing) {
        return res.status(404).json({ message: "Task not found" });
      }

      const isAssignee = existing.assignedTo === userId;
      const userPermissions = await storage.getUserPermissions(userId);
      const isManager = userPermissions.some(p => p.name === 'admin.manage_all');
      if (!isAssignee && !isManager) {
        return res.status(403).json({ message: "You can only upload images to your own tasks" });
      }

      const task = await storage.updateTask(id, { completionImageUrl: imageUrl });
      
      broadcastToAll({
        type: 'task_updated',
        data: { task },
      });

      res.json(task);
    } catch (error) {
      console.error("Error uploading task image:", error);
      res.status(400).json({ message: (error as Error).message });
    }
  });

  app.delete('/api/tasks/:id', isAuthenticated, async (req: any, res) => {
    try {
      const { id } = req.params;
      const userId = req.user.id;

      const userPermissions = await storage.getUserPermissions(userId);
      const isManager = userPermissions.some(p => p.name === 'admin.manage_all' || p.name === 'hr.manage_employees');
      if (!isManager) {
        return res.status(403).json({ message: "Only managers can delete tasks" });
      }

      await storage.deleteTask(id);
      broadcastToAll({
        type: 'task_deleted',
        data: { taskId: id },
      });
      res.json({ success: true });
    } catch (error) {
      console.error("Error deleting task:", error);
      res.status(400).json({ message: (error as Error).message });
    }
  });
}
