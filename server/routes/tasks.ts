import type { Express } from "express";
import type { IStorage } from "../storage";
import { insertTaskSchema } from "@shared/schema";
import { notificationService } from "../services/notificationService";
import { tryResolveStoreIdForUser } from "../lib/storeResolver";
import { runAutoAssign } from "./ai";

export function registerTaskRoutes(
  app: Express,
  storage: IStorage,
  isAuthenticated: any,
  broadcastToAll: (data: any) => void,
  sendToUsers?: (userIds: string[], data: any) => void,
) {
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
            runAutoAssign(storage, broadcastToAll).catch(err => {
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

  // ──────────────────────────────────────────────────────
  // Broadcast task assignment routes
  // ──────────────────────────────────────────────────────

  // GET /api/tasks/clocked-in-count — how many employees are clocked in right now
  app.get('/api/tasks/clocked-in-count', isAuthenticated, async (req: any, res) => {
    try {
      const count = await storage.getClockedInEmployeeCount();
      res.json({ count });
    } catch (error) {
      console.error("Error getting clocked-in count:", error);
      res.status(500).json({ message: "Failed to get count" });
    }
  });

  // GET /api/tasks/verification-queue — pending completions awaiting manager sign-off
  app.get('/api/tasks/verification-queue', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const userPermissions = await storage.getUserPermissions(userId);
      const isManager = userPermissions.some(p => p.name === 'admin.manage_all' || p.name === 'hr.manage_employees');
      if (!isManager) {
        return res.status(403).json({ message: "Managers only" });
      }
      const locationId = await tryResolveStoreIdForUser(userId);
      const queue = await storage.getPendingVerifications(locationId || undefined);
      res.json(queue);
    } catch (error) {
      console.error("Error fetching verification queue:", error);
      res.status(500).json({ message: "Failed to fetch verification queue" });
    }
  });

  // GET /api/tasks/my-assignments — broadcast tasks assigned to the current user
  app.get('/api/tasks/my-assignments', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const assignments = await storage.getMyBroadcastAssignments(userId);
      res.json(assignments);
    } catch (error) {
      console.error("Error fetching my assignments:", error);
      res.status(500).json({ message: "Failed to fetch assignments" });
    }
  });

  // POST /api/tasks/:id/broadcast — manager broadcasts task to all clocked-in employees
  app.post('/api/tasks/:id/broadcast', isAuthenticated, async (req: any, res) => {
    try {
      const { id } = req.params;
      const userId = req.user.id;

      const userPermissions = await storage.getUserPermissions(userId);
      const isManager = userPermissions.some(p => p.name === 'admin.manage_all' || p.name === 'hr.manage_employees');
      if (!isManager) {
        return res.status(403).json({ message: "Only managers can broadcast tasks" });
      }

      const task = await storage.getTask(id);
      if (!task) {
        return res.status(404).json({ message: "Task not found" });
      }

      const locationId = await tryResolveStoreIdForUser(userId);
      const { assignees, count } = await storage.broadcastTask(id, userId, locationId || undefined);

      if (count === 0) {
        return res.status(200).json({ assignees: [], count: 0, message: "No employees currently clocked in" });
      }

      // Notify each assigned employee via push notification
      for (const assignee of assignees) {
        notificationService.sendTaskAssignment(assignee.userId, task.title, 'Broadcast assignment').catch(() => {});
      }

      // WebSocket: send task_assignee_broadcast to each recipient
      const recipientIds = assignees.map(a => a.userId);
      if (sendToUsers && recipientIds.length > 0) {
        sendToUsers(recipientIds, {
          type: 'task_assignee_broadcast',
          data: { taskId: id, taskTitle: task.title, assigneeCount: count },
        });
      }

      broadcastToAll({
        type: 'task_broadcast',
        data: { taskId: id, count },
      });

      res.json({ assignees, count });
    } catch (error) {
      console.error("Error broadcasting task:", error);
      res.status(500).json({ message: "Failed to broadcast task" });
    }
  });

  // GET /api/tasks/:id/assignees — list all assignees for a broadcast task
  app.get('/api/tasks/:id/assignees', isAuthenticated, async (req: any, res) => {
    try {
      const { id } = req.params;
      const { broadcastGroupId } = req.query as { broadcastGroupId?: string };
      const assignees = await storage.getTaskAssignees(id, broadcastGroupId);
      res.json(assignees);
    } catch (error) {
      console.error("Error fetching task assignees:", error);
      res.status(500).json({ message: "Failed to fetch assignees" });
    }
  });

  // PATCH /api/tasks/:id/assignees/:assigneeId/start — employee starts the task
  app.patch('/api/tasks/:id/assignees/:assigneeId/start', isAuthenticated, async (req: any, res) => {
    try {
      const { id: taskId, assigneeId } = req.params;
      const callerId = req.user.id;

      // Fetch the assignee row to verify ownership (IDOR protection)
      const assignees = await storage.getTaskAssignees(taskId);
      const assigneeRow = assignees.find(a => a.id === assigneeId);
      if (!assigneeRow) return res.status(404).json({ message: "Assignment not found" });
      if (assigneeRow.userId !== callerId) return res.status(403).json({ message: "You can only start your own assignments" });

      const updated = await storage.updateTaskAssignee(assigneeId, {
        status: "in_progress",
        startedAt: new Date(),
      });

      if (sendToUsers) {
        sendToUsers([updated.assignedBy], {
          type: 'task_assignee_status_changed',
          data: { assigneeId, status: 'in_progress', taskId: updated.taskId },
        });
      }

      res.json(updated);
    } catch (error) {
      console.error("Error starting task assignee:", error);
      res.status(500).json({ message: "Failed to start task" });
    }
  });

  // PATCH /api/tasks/:id/assignees/:assigneeId/complete — employee marks done (with photo)
  app.patch('/api/tasks/:id/assignees/:assigneeId/complete', isAuthenticated, async (req: any, res) => {
    try {
      const { id: taskId, assigneeId } = req.params;
      const callerId = req.user.id;
      const { completionImageUrl, completionNote } = req.body;

      // Fetch the assignee row to verify ownership (IDOR protection)
      const assignees = await storage.getTaskAssignees(taskId);
      const assigneeRow = assignees.find(a => a.id === assigneeId);
      if (!assigneeRow) return res.status(404).json({ message: "Assignment not found" });
      if (assigneeRow.userId !== callerId) return res.status(403).json({ message: "You can only complete your own assignments" });

      const updated = await storage.updateTaskAssignee(assigneeId, {
        status: "completed",
        completedAt: new Date(),
        completionImageUrl: completionImageUrl || null,
        completionNote: completionNote || null,
      });

      // Notify the manager who broadcast this task (WS + push)
      if (sendToUsers) {
        sendToUsers([updated.assignedBy], {
          type: 'task_assignee_completed',
          data: { assigneeId, taskId: updated.taskId, userId: updated.userId },
        });
      }
      const task = await storage.getTask(taskId);
      if (task) {
        notificationService.sendToUser(updated.assignedBy, {
          title: "Task Ready to Review",
          body: `${req.user.firstName || 'An employee'} completed "${task.title}" and needs your approval.`,
          data: { url: "/tasks" },
        }).catch(() => {});
      }

      res.json(updated);
    } catch (error) {
      console.error("Error completing task assignee:", error);
      res.status(500).json({ message: "Failed to complete task" });
    }
  });

  // PATCH /api/tasks/:id/assignees/:assigneeId/approve — manager approves completion
  app.patch('/api/tasks/:id/assignees/:assigneeId/approve', isAuthenticated, async (req: any, res) => {
    try {
      const { assigneeId } = req.params;
      const managerId = req.user.id;

      const userPermissions = await storage.getUserPermissions(managerId);
      const isManager = userPermissions.some(p => p.name === 'admin.manage_all' || p.name === 'hr.manage_employees');
      if (!isManager) {
        return res.status(403).json({ message: "Managers only" });
      }

      const updated = await storage.updateTaskAssignee(assigneeId, {
        status: "approved",
        managerApprovedAt: new Date(),
        approvedBy: managerId,
      });

      // Notify the employee via WS + push
      if (sendToUsers) {
        sendToUsers([updated.userId], {
          type: 'task_assignee_status_changed',
          data: { assigneeId, status: 'approved', taskId: updated.taskId },
        });
      }
      const task = await storage.getTask(updated.taskId);
      notificationService.sendToUser(updated.userId, {
        title: "Task Approved!",
        body: `Great job! Your completion of "${task?.title || 'the task'}" was approved.`,
        data: { url: "/tasks" },
      }).catch(() => {});

      const streak = await storage.getCompletionStreak(updated.taskId, updated.userId);

      res.json({ assignee: updated, streak });
    } catch (error) {
      console.error("Error approving task assignee:", error);
      res.status(500).json({ message: "Failed to approve" });
    }
  });

  // PATCH /api/tasks/:id/assignees/:assigneeId/reject — manager rejects, employee must redo
  app.patch('/api/tasks/:id/assignees/:assigneeId/reject', isAuthenticated, async (req: any, res) => {
    try {
      const { assigneeId } = req.params;
      const managerId = req.user.id;
      const { rejectionNote } = req.body;

      const userPermissions = await storage.getUserPermissions(managerId);
      const isManager = userPermissions.some(p => p.name === 'admin.manage_all' || p.name === 'hr.manage_employees');
      if (!isManager) {
        return res.status(403).json({ message: "Managers only" });
      }

      const updated = await storage.updateTaskAssignee(assigneeId, {
        status: "rejected",
        rejectedAt: new Date(),
        rejectionNote: rejectionNote || null,
      });

      // Notify employee via WS + push
      if (sendToUsers) {
        sendToUsers([updated.userId], {
          type: 'task_assignee_status_changed',
          data: { assigneeId, status: 'rejected', taskId: updated.taskId, rejectionNote },
        });
      }
      const task = await storage.getTask(updated.taskId);
      notificationService.sendToUser(updated.userId, {
        title: "Redo Required",
        body: rejectionNote
          ? `"${task?.title || 'Task'}" was sent back: ${rejectionNote}`
          : `"${task?.title || 'Task'}" needs to be redone. Check the app for details.`,
        data: { url: "/tasks" },
      }).catch(() => {});

      res.json(updated);
    } catch (error) {
      console.error("Error rejecting task assignee:", error);
      res.status(500).json({ message: "Failed to reject" });
    }
  });
}
