import type { Express } from "express";
import type { IStorage } from "../storage";
import { insertTaskSchema, operationalInsights } from "@shared/schema";
import { db } from "../db";
import { inArray } from "drizzle-orm";
import { notificationService } from "../services/notificationService";
import { tryResolveStoreIdForUser } from "../services/storeResolver";
import { runAutoAssign } from "./ai";
import { resolvePermission, resolveAnyPermission } from "../services/permissionResolver";

// Enrich a list of tasks with the originating AI insight id (if any) by
// reverse-looking-up `operational_insights.linked_task_id`. We piggy-back on
// the existing back-link rather than denormalising onto the tasks table so
// there's no schema migration to keep in lock-step.
async function attachInsightIds<T extends { id: string }>(items: T[]): Promise<Array<T & { insightId: string | null }>> {
  if (items.length === 0) return [];
  const ids = items.map(t => t.id);
  const insightRows = await db.select({
    id: operationalInsights.id,
    linkedTaskId: operationalInsights.linkedTaskId,
  }).from(operationalInsights).where(inArray(operationalInsights.linkedTaskId, ids));
  const byTask = new Map<string, string>();
  for (const r of insightRows) {
    if (r.linkedTaskId) byTask.set(r.linkedTaskId, r.id);
  }
  return items.map(t => ({ ...t, insightId: byTask.get(t.id) ?? null }));
}

/**
 * Resolves the store/location for a non-admin manager and responds 403 if it cannot be determined.
 * Callers MUST return immediately when this returns null (the 403 is already sent).
 * This prevents fail-open cross-location access on misconfigured accounts.
 */
async function requireManagerLocation(userId: string, res: any): Promise<string | null> {
  const locationId = await tryResolveStoreIdForUser(userId);
  if (!locationId) {
    res.status(403).json({ message: "Manager location could not be determined. Contact an administrator." });
    return null;
  }
  return locationId;
}

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

      const canCreate = await resolveAnyPermission(userId, ['tasks.create', 'admin.manage_all'], storage);
      if (!canCreate) {
        return res.status(403).json({ message: "You don't have permission to create tasks" });
      }

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
      const canViewAll = await resolvePermission(userId, 'tasks.view_all', storage);
      
      if (canViewAll) {
        const locationId = await tryResolveStoreIdForUser(userId);
        tasks = await storage.getAllTasks(locationId || undefined);
      } else {
        tasks = await storage.getUserTasks(userId);
      }

      const enriched = await attachInsightIds(tasks);
      res.json(enriched);
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

      const isManager = await resolveAnyPermission(userId, ['admin.manage_all', 'hr.manage_employees'], storage);
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
      const isManager = await resolvePermission(userId, 'admin.manage_all', storage);
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

      const isManager = await resolveAnyPermission(userId, ['admin.manage_all', 'hr.manage_employees'], storage);
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

  // GET /api/tasks/clocked-in-count — eligible (non-manager) employees clocked in for this location
  app.get('/api/tasks/clocked-in-count', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const isAdmin = await resolvePermission(userId, 'admin.manage_all', storage);
      const isManager = isAdmin || (await resolvePermission(userId, 'hr.manage_employees', storage));
      if (!isManager) return res.status(403).json({ message: "Managers only" });

      // Non-admin managers must have a resolvable location (fail-closed)
      let locationId: string | undefined;
      if (!isAdmin) {
        const resolved = await requireManagerLocation(userId, res);
        if (!resolved) return; // 403 already sent
        locationId = resolved;
      }
      const count = await storage.getClockedInEmployeeCount(locationId);
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
      const isAdmin = await resolvePermission(userId, 'admin.manage_all', storage);
      const isManager = isAdmin || (await resolvePermission(userId, 'hr.manage_employees', storage));
      if (!isManager) {
        return res.status(403).json({ message: "Managers only" });
      }
      // Admins see all locations; non-admin managers must have a resolvable location (fail-closed)
      let locationId: string | undefined;
      if (!isAdmin) {
        const resolved = await requireManagerLocation(userId, res);
        if (!resolved) return; // 403 already sent
        locationId = resolved;
      }
      const queue = await storage.getPendingVerifications(locationId);
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

      const isAdmin = await resolvePermission(userId, 'admin.manage_all', storage);
      const isManager = isAdmin || (await resolvePermission(userId, 'hr.manage_employees', storage));
      if (!isManager) {
        return res.status(403).json({ message: "Only managers can broadcast tasks" });
      }

      const task = await storage.getTask(id);
      if (!task) {
        return res.status(404).json({ message: "Task not found" });
      }

      // Non-admin managers must have a resolvable location (fail-closed); admins can broadcast globally
      let locationId: string | undefined;
      if (!isAdmin) {
        const resolved = await requireManagerLocation(userId, res);
        if (!resolved) return; // 403 already sent
        locationId = resolved;
        if (task.locationId && task.locationId !== locationId) {
          return res.status(403).json({ message: "Cannot broadcast a task from a different location" });
        }
      }

      const { assignees, count } = await storage.broadcastTask(id, userId, locationId);

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

  // GET /api/tasks/broadcast-summary — manager-only; scoped to manager's location for non-admins
  app.get('/api/tasks/broadcast-summary', isAuthenticated, async (req: any, res) => {
    try {
      const callerId = req.user.id;
      const isAdmin = await resolvePermission(callerId, 'admin.manage_all', storage);
      const isManager = isAdmin || (await resolvePermission(callerId, 'hr.manage_employees', storage));
      if (!isManager) return res.status(403).json({ message: "Managers only" });

      // Admins see all locations; non-admin managers must have a resolvable location (fail-closed)
      let locationId: string | undefined;
      if (!isAdmin) {
        const resolved = await requireManagerLocation(callerId, res);
        if (!resolved) return; // 403 already sent
        locationId = resolved;
      }
      const summary = await storage.getAllTaskBroadcastSummary(locationId);
      res.json(summary);
    } catch (error) {
      console.error("Error fetching broadcast summary:", error);
      res.status(500).json({ message: "Failed to fetch broadcast summary" });
    }
  });

  // GET /api/tasks/:id/broadcast-progress — manager-only; detailed completion stats for a broadcast task
  app.get('/api/tasks/:id/broadcast-progress', isAuthenticated, async (req: any, res) => {
    try {
      const { id } = req.params;
      const callerId = req.user.id;

      const isAdmin = await resolvePermission(callerId, 'admin.manage_all', storage);
      const isManager = isAdmin || (await resolvePermission(callerId, 'hr.manage_employees', storage));
      if (!isManager) return res.status(403).json({ message: "Managers only" });

      // Location scope: non-admins must have a resolvable location (fail-closed)
      if (!isAdmin) {
        const managerLocationId = await requireManagerLocation(callerId, res);
        if (!managerLocationId) return; // 403 already sent
        const task = await storage.getTask(id);
        if (task?.locationId && task.locationId !== managerLocationId) {
          return res.status(403).json({ message: "Cannot view progress for tasks from a different location" });
        }
      }

      const progress = await storage.getTaskBroadcastProgress(id);
      res.json(progress);
    } catch (error) {
      console.error("Error fetching broadcast progress:", error);
      res.status(500).json({ message: "Failed to fetch progress" });
    }
  });

  // GET /api/tasks/:id/assignees — manager sees all in their location; employees see only own row
  app.get('/api/tasks/:id/assignees', isAuthenticated, async (req: any, res) => {
    try {
      const { id } = req.params;
      const callerId = req.user.id;
      const { broadcastGroupId } = req.query as { broadcastGroupId?: string };

      const isAdmin = await resolvePermission(callerId, 'admin.manage_all', storage);
      const isManager = isAdmin || (await resolvePermission(callerId, 'hr.manage_employees', storage));

      const allAssignees = await storage.getTaskAssignees(id, broadcastGroupId);

      if (!isManager) {
        // Employees can only see their own assignment row
        return res.json(allAssignees.filter(a => a.userId === callerId));
      }

      // Non-admin managers: must have a resolvable location (fail-closed)
      if (!isAdmin) {
        const managerLocationId = await requireManagerLocation(callerId, res);
        if (!managerLocationId) return; // 403 already sent
        const task = await storage.getTask(id);
        if (task?.locationId && task.locationId !== managerLocationId) {
          return res.status(403).json({ message: "Cannot view assignees for tasks from a different location" });
        }
      }

      res.json(allAssignees);
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

      // State transition guard: start is only valid from pending or rejected.
      // Approved/completed/in_progress rows must not be mutated.
      type AllowedStartStatus = 'pending' | 'rejected';
      const allowedFromStart: AllowedStartStatus[] = ['pending', 'rejected'];
      if (!assigneeRow.status || !(allowedFromStart as string[]).includes(assigneeRow.status)) {
        return res.status(409).json({ message: `Cannot start an assignment in '${assigneeRow.status}' state` });
      }

      let result;
      if (assigneeRow.status === 'rejected') {
        // Redo path: create a fresh row to preserve the rejected submission as immutable history.
        // The new row captures the old photo in previousImageUrl for side-by-side comparison.
        result = await storage.createRedoAssignment(assigneeId);
      } else {
        // Pending path: simply transition in place
        result = await storage.updateTaskAssignee(assigneeId, {
          status: "in_progress",
          startedAt: new Date(),
        });
      }

      if (sendToUsers) {
        sendToUsers([result.assignedBy], {
          type: 'task_assignee_status_changed',
          data: { assigneeId: result.id, status: 'in_progress', taskId: result.taskId },
        });
      }

      res.json(result);
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

      // State transition guard: complete is only valid from in_progress.
      // Approved rows are immutable — must not be overwritten with new photos/notes.
      if (assigneeRow.status === 'approved') {
        return res.status(409).json({ message: "Approved assignments are immutable and cannot be re-completed" });
      }
      if (assigneeRow.status !== 'in_progress') {
        return res.status(409).json({ message: `Cannot complete an assignment in '${assigneeRow.status}' state — start it first` });
      }

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
      const { id: taskId, assigneeId } = req.params;
      const managerId = req.user.id;

      const isAdmin = await resolvePermission(managerId, 'admin.manage_all', storage);
      const isManager = isAdmin || (await resolvePermission(managerId, 'hr.manage_employees', storage));
      if (!isManager) {
        return res.status(403).json({ message: "Managers only" });
      }

      // Fetch the assignee row and verify it belongs to this task and is in 'completed' state
      const assignees = await storage.getTaskAssignees(taskId);
      const assigneeRow = assignees.find(a => a.id === assigneeId);
      if (!assigneeRow) return res.status(404).json({ message: "Assignment not found for this task" });
      if (assigneeRow.taskId !== taskId) return res.status(403).json({ message: "Assignment does not belong to this task" });
      if (assigneeRow.status !== 'completed') return res.status(409).json({ message: "Only completed assignments can be approved" });

      // Location scope: non-admins must have a resolvable location (fail-closed)
      if (!isAdmin) {
        const managerLocationId = await requireManagerLocation(managerId, res);
        if (!managerLocationId) return; // 403 already sent
        const task = await storage.getTask(taskId);
        if (task?.locationId && task.locationId !== managerLocationId) {
          return res.status(403).json({ message: "Cannot approve tasks from a different location" });
        }
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
      const { id: taskId, assigneeId } = req.params;
      const managerId = req.user.id;
      const { rejectionNote } = req.body;
      if (!rejectionNote || !String(rejectionNote).trim()) {
        return res.status(400).json({ message: "A rejection note is required to explain what needs to be redone" });
      }

      const isAdmin = await resolvePermission(managerId, 'admin.manage_all', storage);
      const isManager = isAdmin || (await resolvePermission(managerId, 'hr.manage_employees', storage));
      if (!isManager) {
        return res.status(403).json({ message: "Managers only" });
      }

      // Verify assignee belongs to this task and is in 'completed' state (IDOR + state guard)
      const assignees = await storage.getTaskAssignees(taskId);
      const assigneeRow = assignees.find(a => a.id === assigneeId);
      if (!assigneeRow) return res.status(404).json({ message: "Assignment not found for this task" });
      if (assigneeRow.taskId !== taskId) return res.status(403).json({ message: "Assignment does not belong to this task" });
      if (assigneeRow.status !== 'completed') return res.status(409).json({ message: "Only completed assignments can be rejected" });

      // Location scope: non-admins must have a resolvable location (fail-closed)
      if (!isAdmin) {
        const managerLocationId = await requireManagerLocation(managerId, res);
        if (!managerLocationId) return; // 403 already sent
        const task = await storage.getTask(taskId);
        if (task?.locationId && task.locationId !== managerLocationId) {
          return res.status(403).json({ message: "Cannot reject tasks from a different location" });
        }
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
