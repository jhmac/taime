import type { Express } from "express";
import { createServer, type Server } from "http";
import { WebSocketServer, WebSocket } from "ws";
import { storage } from "./storage";
import { setupAuth, requireAuth as isAuthenticated } from "./streamlinedAuth";
import { users, shops, userShops, shopifyDailySales, companySettings } from "@shared/schema";
import { eq, and, gte, lte, desc } from "drizzle-orm";
import { db } from "./db";
import { claudeService } from "./services/claudeService";
import { notificationService } from "./services/notificationService";
import { geofencingService } from "./services/geofencingService";
import { automationService } from "./services/automationService";
import { payrollAutomationService } from "./services/payrollAutomationService";
import {
  insertTimeEntrySchema,
  insertScheduleSchema,
  insertTaskSchema,
  insertMessageSchema,
  insertWorkLocationSchema,
  insertPushSubscriptionSchema,
  insertRoleSchema,
  insertRolePermissionSchema,
  choreAssignmentSchema,
  choreSignOffSchema,
  insertCompanySettingsSchema,
} from "@shared/schema";
import { z } from "zod";
import crypto from "crypto";
import rateLimit from "express-rate-limit";
import { ShopifyService } from "./services/shopifyService";
import { encryptToken, decryptToken } from "./utils/tokenEncryption";

function sanitizeCsvField(field: string): string {
  const dangerous = /^[=+\-@\t\r]/;
  if (dangerous.test(field)) {
    return "'" + field;
  }
  return field;
}

// WebSocket connections map
const wsConnections = new Map<string, WebSocket>();

const aiRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  message: { message: "Too many AI requests, please try again later" },
  standardHeaders: true,
  legacyHeaders: false,
});

export async function registerRoutes(app: Express): Promise<Server> {
  await setupAuth(app);

  // Time tracking routes
  app.post('/api/time-entries', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const data = insertTimeEntrySchema.parse({ ...req.body, userId });
      
      // Validate location if clockInTime is provided
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
      
      // Broadcast to connected clients
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
        ? ['clockOutTime', 'breakMinutes', 'notes', 'locationId', 'isApproved', 'status']
        : ['clockOutTime', 'breakMinutes', 'notes'];

      const safeUpdates: Record<string, any> = {};
      for (const key of allowedFields) {
        if (req.body[key] !== undefined) {
          safeUpdates[key] = req.body[key];
        }
      }

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

  // Schedule routes
  app.post('/api/schedules', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const data = insertScheduleSchema.parse({ ...req.body, createdBy: userId });
      
      const schedule = await storage.createSchedule(data);
      
      // Send notification to assigned user if different from creator
      if (data.userId !== userId) {
        await notificationService.sendScheduleUpdate(
          data.userId,
          `New shift scheduled: ${schedule.title || 'Shift'} on ${new Date(schedule.startTime).toLocaleDateString()}`
        );
      }

      // Broadcast to connected clients
      broadcastToAll({
        type: 'schedule_created',
        data: { schedule },
      });

      res.json(schedule);
    } catch (error) {
      console.error("Error creating schedule:", error);
      res.status(400).json({ message: (error as Error).message });
    }
  });

  app.get('/api/schedules', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const user = await storage.getUser(userId);
      
      const startDate = req.query.startDate ? new Date(req.query.startDate as string) : undefined;
      const endDate = req.query.endDate ? new Date(req.query.endDate as string) : undefined;

      let schedules;
      const userPermissions = await storage.getUserPermissions(userId);
      const canViewAll = userPermissions.some(p => p.name === 'schedule.view_all');
      
      if (canViewAll) {
        schedules = await storage.getAllSchedules(startDate, endDate);
      } else {
        schedules = await storage.getUserSchedules(userId, startDate, endDate);
      }

      res.json(schedules);
    } catch (error) {
      console.error("Error fetching schedules:", error);
      res.status(500).json({ message: "Failed to fetch schedules" });
    }
  });

  // Task routes
  app.post('/api/tasks', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const data = insertTaskSchema.parse({ ...req.body, createdBy: userId });
      
      const task = await storage.createTask(data);
      
      // Send notification to assigned user
      if (data.assignedTo) {
        const dueTime = data.dueDate ? new Date(data.dueDate).toLocaleString() : 'No due date';
        await notificationService.sendTaskAssignment(data.assignedTo, task.title, dueTime);
      }

      // Broadcast to connected clients
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
      const user = await storage.getUser(userId);

      let tasks;
      const userPermissions = await storage.getUserPermissions(userId);
      const canViewAll = userPermissions.some(p => p.name === 'tasks.view_all');
      
      if (canViewAll) {
        tasks = await storage.getAllTasks();
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
        if (req.body[key] !== undefined) {
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

  // AI routes
  app.post('/api/ai/assign-chores', isAuthenticated, aiRateLimiter, async (req: any, res) => {
    try {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const tomorrow = new Date(today);
      tomorrow.setDate(tomorrow.getDate() + 1);

      // Get today's scheduled employees
      const schedules = await storage.getAllSchedules(today, tomorrow);
      const tasks = await storage.getTasksForDate(today);
      
      // Transform data for Claude API
      const scheduledEmployees = await Promise.all(
        schedules.map(async (schedule) => {
          const user = await storage.getUser(schedule.userId);
          return {
            id: schedule.userId,
            name: `${user?.firstName} ${user?.lastName}`,
            shiftStart: schedule.startTime.toISOString(),
            shiftEnd: schedule.endTime.toISOString(),
            skills: [], // Would come from user profile in full implementation
            workload: 50, // Would be calculated from current tasks
            pastPerformance: 85, // Would come from historical data
          };
        })
      );

      const availableChores = tasks
        .filter(task => !task.assignedTo && task.status === 'pending')
        .map(task => ({
          id: task.id,
          title: task.title,
          description: task.description || '',
          estimatedMinutes: task.estimatedMinutes || 30,
          requiredSkills: [],
          priority: 'medium' as const,
        }));

      if (availableChores.length === 0) {
        return res.json({ message: 'No unassigned chores available' });
      }

      const assignments = await claudeService.assignChores({
        scheduledEmployees,
        availableChores,
      });

      // Apply the assignments
      for (const assignment of assignments.assignments) {
        await storage.updateTask(assignment.choreId, {
          assignedTo: assignment.assignedTo,
          isAIAssigned: true,
          aiReasoning: assignment.reasoning,
        });

        // Send notification
        const task = await storage.getAllTasks().then(tasks => 
          tasks.find(t => t.id === assignment.choreId)
        );
        if (task) {
          await notificationService.sendTaskAssignment(
            assignment.assignedTo,
            task.title,
            assignment.estimatedCompletion
          );
        }
      }

      res.json(assignments);
    } catch (error) {
      console.error("Error assigning chores:", error);
      res.status(500).json({ message: "Failed to assign chores with AI" });
    }
  });

  app.post('/api/ai/chat', isAuthenticated, aiRateLimiter, async (req: any, res) => {
    try {
      const { message } = req.body;
      const userId = req.user.id;

      if (!message || typeof message !== 'string') {
        return res.status(400).json({ message: "Message is required" });
      }
      if (message.length > 2000) {
        return res.status(400).json({ message: "Message too long (max 2000 characters)" });
      }
      
      const user = await storage.getUser(userId);
      const activeTimeEntry = await storage.getActiveTimeEntry(userId);
      const recentTasks = await storage.getUserTasks(userId);
      
      const context = {
        user: {
          name: `${user?.firstName} ${user?.lastName}`,
          role: 'employee',
        },
        isCurrentlyClockedIn: !!activeTimeEntry,
        recentTasks: recentTasks.slice(0, 5),
      };

      const response = await claudeService.chat(message, context);
      res.json({ response });
    } catch (error) {
      console.error("Error processing AI chat:", error);
      res.status(500).json({ message: "Failed to process AI chat" });
    }
  });

  app.post('/api/ai/detect-anomalies', isAuthenticated, aiRateLimiter, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const userPermissions = await storage.getUserPermissions(userId);
      const canView = userPermissions.some(p => p.name === 'hr.view_team' || p.name === 'admin.manage_all');

      if (!canView) {
        return res.status(403).json({ message: "HR or admin access required" });
      }

      const endDate = new Date();
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - 30);

      const timeEntriesData = await storage.getAllTimeEntries(startDate, endDate);
      const allUsers = await db.select().from(users);
      const userMap: Record<string, string> = {};
      allUsers.forEach(u => {
        userMap[u.id] = `${u.firstName || ''} ${u.lastName || ''}`.trim() || 'Unknown';
      });

      const formattedEntries = timeEntriesData.map(entry => ({
        userId: entry.userId,
        clockInTime: entry.clockInTime.toISOString(),
        clockOutTime: entry.clockOutTime?.toISOString() || '',
        breakMinutes: entry.breakMinutes || 0,
        locationId: entry.locationId || '',
      }));

      const result = await claudeService.detectAnomalies({
        timeEntries: formattedEntries,
        historicalPatterns: {},
      });

      for (const anomaly of result.anomalies) {
        await storage.createAIInsight({
          type: 'anomaly_detected',
          userId: anomaly.userId || null,
          title: anomaly.type,
          description: `${anomaly.description} — Recommendation: ${anomaly.recommendation}`,
          severity: anomaly.severity === 'high' ? 'critical' : anomaly.severity === 'medium' ? 'warning' : 'info',
          isRead: false,
          metadata: { recommendation: anomaly.recommendation, detectedAt: new Date().toISOString() },
        });
      }

      res.json({ anomalies: result.anomalies, patterns: result.patterns });
    } catch (error) {
      console.error("Error detecting anomalies:", error);
      res.status(500).json({ message: "Failed to detect anomalies" });
    }
  });

  // Holiday pay rules routes
  app.post('/api/ai/parse-holiday-pay', isAuthenticated, aiRateLimiter, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const userPermissions = await storage.getUserPermissions(userId);
      const canManage = userPermissions.some(p => p.name === 'admin.manage_payroll' || p.name === 'admin.manage_all');

      if (!canManage) {
        return res.status(403).json({ message: "Admin or payroll management access required" });
      }

      const { instruction } = req.body;
      if (!instruction) {
        return res.status(400).json({ message: "Instruction text is required" });
      }

      const result = await claudeService.parseHolidayPayRules(instruction);

      if (!result.holidays || !Array.isArray(result.holidays)) {
        return res.status(500).json({ message: "AI returned invalid response format" });
      }

      const savedRules = [];
      const existingRules = await storage.getAllHolidayPayRules();
      for (const holiday of result.holidays) {
        if (!holiday.name || typeof holiday.month !== 'number' || typeof holiday.day !== 'number') continue;
        if (holiday.month < 1 || holiday.month > 12 || holiday.day < 1 || holiday.day > 31) continue;
        const multiplier = typeof holiday.payMultiplier === 'number' && holiday.payMultiplier > 0 ? holiday.payMultiplier : 1.5;

        const existing = existingRules.find(
          r => r.month === holiday.month && r.day === holiday.day
        );
        if (existing) {
          const updated = await storage.updateHolidayPayRule(existing.id, {
            name: holiday.name,
            payMultiplier: multiplier.toFixed(2),
          });
          savedRules.push(updated);
        } else {
          const rule = await storage.createHolidayPayRule({
            name: holiday.name,
            month: holiday.month,
            day: holiday.day,
            payMultiplier: multiplier.toFixed(2),
            isActive: true,
            createdBy: userId,
          });
          savedRules.push(rule);
        }
      }

      res.json({ rules: savedRules, summary: result.summary });
    } catch (error) {
      console.error("Error parsing holiday pay rules:", error);
      res.status(500).json({ message: "Failed to parse holiday pay instructions" });
    }
  });

  app.get('/api/holiday-pay-rules', isAuthenticated, async (req: any, res) => {
    try {
      const rules = await storage.getAllHolidayPayRules();
      res.json(rules);
    } catch (error) {
      console.error("Error fetching holiday pay rules:", error);
      res.status(500).json({ message: "Failed to fetch holiday pay rules" });
    }
  });

  app.delete('/api/holiday-pay-rules/:id', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const userPermissions = await storage.getUserPermissions(userId);
      const canManage = userPermissions.some(p => p.name === 'admin.manage_payroll' || p.name === 'admin.manage_all');

      if (!canManage) {
        return res.status(403).json({ message: "Admin or payroll management access required" });
      }

      const { id } = req.params;
      await storage.deleteHolidayPayRule(id);
      res.json({ success: true });
    } catch (error) {
      console.error("Error deleting holiday pay rule:", error);
      res.status(500).json({ message: "Failed to delete holiday pay rule" });
    }
  });

  app.patch('/api/holiday-pay-rules/:id', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const userPermissions = await storage.getUserPermissions(userId);
      const canManage = userPermissions.some(p => p.name === 'admin.manage_payroll' || p.name === 'admin.manage_all');

      if (!canManage) {
        return res.status(403).json({ message: "Admin or payroll management access required" });
      }

      const { id } = req.params;
      const { name, month, day, payMultiplier, isActive } = req.body;
      const safeUpdates: Record<string, any> = {};
      if (name !== undefined && typeof name === 'string') safeUpdates.name = name;
      if (month !== undefined && typeof month === 'number' && month >= 1 && month <= 12) safeUpdates.month = month;
      if (day !== undefined && typeof day === 'number' && day >= 1 && day <= 31) safeUpdates.day = day;
      if (payMultiplier !== undefined) {
        const mult = parseFloat(payMultiplier);
        if (!isNaN(mult) && mult > 0 && mult <= 5) safeUpdates.payMultiplier = mult.toFixed(2);
      }
      if (isActive !== undefined && typeof isActive === 'boolean') safeUpdates.isActive = isActive;

      const rule = await storage.updateHolidayPayRule(id, safeUpdates);
      res.json(rule);
    } catch (error) {
      console.error("Error updating holiday pay rule:", error);
      res.status(500).json({ message: "Failed to update holiday pay rule" });
    }
  });

  // Availability routes
  app.post('/api/availability', isAuthenticated, async (req: any, res) => {
    try {
      const { availability } = req.body;
      const userId = req.user.id;
      
      // Validate and add userId to each availability entry
      const availabilityWithUserId = availability.map((avail: any) => ({
        ...avail,
        userId,
        date: new Date(avail.date),
      }));
      
      const submitted = await storage.submitAvailability(availabilityWithUserId);
      res.json(submitted);
    } catch (error) {
      console.error("Error submitting availability:", error);
      res.status(500).json({ message: "Failed to submit availability" });
    }
  });

  app.get('/api/availability', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const { payrollPeriodId } = req.query;
      
      const availability = await storage.getUserAvailability(userId, payrollPeriodId);
      res.json(availability);
    } catch (error) {
      console.error("Error fetching availability:", error);
      res.status(500).json({ message: "Failed to fetch availability" });
    }
  });

  app.get('/api/availability/period/:periodId', isAuthenticated, async (req: any, res) => {
    try {
      const { periodId } = req.params;
      const availability = await storage.getAllAvailabilityForPeriod(periodId);
      res.json(availability);
    } catch (error) {
      console.error("Error fetching period availability:", error);
      res.status(500).json({ message: "Failed to fetch period availability" });
    }
  });

  // AI Schedule Creation routes
  app.post('/api/schedules/create-from-availability', isAuthenticated, async (req: any, res) => {
    try {
      const { payrollPeriodId, businessHours, constraints } = req.body;
      
      // Get all availability data for the period
      const availabilityData = await storage.getAllAvailabilityForPeriod(payrollPeriodId);
      
      // Get user information to include names and roles
      const allUsers = await db.select().from(users).where(eq(users.isActive, true));
      
      // Transform availability data for AI processing
      const transformedData = availabilityData.map((avail: any) => {
        const user = allUsers.find((u: any) => u.id === avail.userId);
        return {
          userId: avail.userId,
          userName: user ? `${user.firstName} ${user.lastName}` : 'Unknown User',
          role: user?.roleId || 'employee',
          hourlyRate: 15.00, // Default rate - would be from user profile in full implementation
          date: avail.date.toISOString().split('T')[0],
          timeSlot: avail.timeSlot,
          isAvailable: avail.isAvailable,
        };
      });

      // Call Claude AI to create schedule
      const result = await claudeService.createScheduleFromAvailability({
        payrollPeriodId,
        availabilityData: transformedData,
        businessHours: businessHours || {
          dailyHours: 8,
          peakHours: ['afternoon', 'evening'],
          minimumStaffing: 2,
        },
        constraints: constraints || {
          maxWeeklyHours: 40,
          overtimeThreshold: 8,
          minimumShiftLength: 4,
        },
      });

      // Save the generated schedules to database
      const schedulesToCreate = result.schedule.map((scheduleItem: any) => ({
        userId: scheduleItem.userId,
        startTime: new Date(`${scheduleItem.date}T${scheduleItem.startTime}`),
        endTime: new Date(`${scheduleItem.date}T${scheduleItem.endTime}`),
        location: 'Main Location', // Default location
        notes: scheduleItem.reasoning,
      }));

      // Create schedules in database
      for (const schedule of schedulesToCreate) {
        await storage.createSchedule(schedule);
      }

      res.json({
        success: true,
        scheduleCreated: result.schedule.length,
        insights: result.insights,
        staffingAnalysis: result.staffingAnalysis,
        generatedSchedule: result.schedule,
      });
    } catch (error) {
      console.error("Error creating schedule from availability:", error);
      res.status(500).json({ message: "Failed to create schedule from availability" });
    }
  });

  // Payroll routes
  app.post('/api/payroll/analyze', isAuthenticated, async (req: any, res) => {
    try {
      const { startDate, endDate } = req.body;
      const start = new Date(startDate);
      const end = new Date(endDate);
      
      const timeEntries = await storage.getAllTimeEntries(start, end);
      
      // Transform data for Claude analysis
      const payrollData = timeEntries.map(entry => {
        const clockIn = new Date(entry.clockInTime);
        const clockOut = entry.clockOutTime ? new Date(entry.clockOutTime) : null;
        const totalHours = clockOut 
          ? (clockOut.getTime() - clockIn.getTime()) / (1000 * 60 * 60) - (entry.breakMinutes || 0) / 60
          : 0;
        
        return {
          userId: entry.userId,
          userName: 'User', // Would get from user join in full implementation
          clockInTime: entry.clockInTime.toISOString(),
          clockOutTime: entry.clockOutTime?.toISOString() || '',
          breakMinutes: entry.breakMinutes || 0,
          totalHours,
          overtime: Math.max(0, totalHours - 8),
        };
      });

      const analysis = await claudeService.analyzePayroll({
        timeEntries: payrollData,
        payrollRules: {
          overtimeThreshold: 8,
          maxDailyHours: 12,
          requiredBreaks: 'Minimum 30 minutes for shifts over 6 hours',
        },
      });

      res.json(analysis);
    } catch (error) {
      console.error("Error analyzing payroll:", error);
      res.status(500).json({ message: "Failed to analyze payroll" });
    }
  });

  // Pay period automation routes
  app.get('/api/payroll/periods', isAuthenticated, async (req: any, res) => {
    try {
      const periods = await storage.getPayrollPeriods();
      res.json(periods);
    } catch (error) {
      console.error("Error fetching payroll periods:", error);
      res.status(500).json({ message: "Failed to fetch payroll periods" });
    }
  });

  app.post('/api/payroll/periods', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const userPermissions = await storage.getUserPermissions(userId);
      const canManagePayroll = userPermissions.some(p => p.name === 'admin.manage_payroll' || p.name === 'admin.manage_all');
      
      if (!canManagePayroll) {
        return res.status(403).json({ message: "Payroll management access required" });
      }

      const period = await storage.createNextPayPeriod();
      res.json(period);
    } catch (error) {
      console.error("Error creating payroll period:", error);
      res.status(500).json({ message: "Failed to create payroll period" });
    }
  });

  app.get('/api/payroll/settings', isAuthenticated, async (req: any, res) => {
    try {
      const settings = await storage.getPayPeriodSettings();
      res.json(settings);
    } catch (error) {
      console.error("Error fetching pay period settings:", error);
      res.status(500).json({ message: "Failed to fetch settings" });
    }
  });

  app.post('/api/payroll/settings', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const userPermissions = await storage.getUserPermissions(userId);
      const canManagePayroll = userPermissions.some(p => p.name === 'admin.manage_payroll' || p.name === 'admin.manage_all');
      
      if (!canManagePayroll) {
        return res.status(403).json({ message: "Payroll management access required" });
      }

      const settingsData = { ...req.body, createdBy: userId, updatedBy: userId };
      const settings = await storage.updatePayPeriodSettings(settingsData);
      res.json(settings);
    } catch (error) {
      console.error("Error updating pay period settings:", error);
      res.status(500).json({ message: "Failed to update settings" });
    }
  });

  app.post('/api/payroll/automation/trigger', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const userPermissions = await storage.getUserPermissions(userId);
      const canManagePayroll = userPermissions.some(p => p.name === 'admin.manage_payroll' || p.name === 'admin.manage_all');
      
      if (!canManagePayroll) {
        return res.status(403).json({ message: "Payroll management access required" });
      }

      await automationService.checkAndTriggerAutomation();
      res.json({ success: true, message: "Automation triggered successfully" });
    } catch (error) {
      console.error("Error triggering automation:", error);
      res.status(500).json({ message: "Failed to trigger automation" });
    }
  });

  app.get('/api/payroll/export', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const userPermissions = await storage.getUserPermissions(userId);
      const canManage = userPermissions.some(p => p.name === 'admin.manage_payroll' || p.name === 'admin.manage_all');

      if (!canManage) {
        return res.status(403).json({ message: "Payroll management access required" });
      }

      const { startDate, endDate } = req.query;
      if (!startDate || !endDate) {
        return res.status(400).json({ message: "startDate and endDate query parameters are required" });
      }

      const start = new Date(startDate as string);
      const end = new Date(endDate as string);

      const timeEntriesData = await storage.getAllTimeEntries(start, end);
      const allUsers = await db.select().from(users);
      const [settings] = await db.select().from(companySettings).limit(1);
      const holidayRules = await storage.getAllHolidayPayRules();

      const overtimeThreshold = settings?.overtimeThresholdHours || 40;
      const overtimeMultiplier = parseFloat(settings?.overtimeMultiplier || "1.50");

      const employeeMap: Record<string, {
        name: string;
        email: string;
        totalHours: number;
        holidayHours: number;
        holidayPayExtra: number;
        breakMinutes: number;
        hourlyRate: number;
      }> = {};

      for (const entry of timeEntriesData) {
        if (!entry.clockOutTime) continue;

        const clockIn = new Date(entry.clockInTime);
        const clockOut = new Date(entry.clockOutTime);
        const breakMins = entry.breakMinutes || 0;
        const workedHours = (clockOut.getTime() - clockIn.getTime()) / (1000 * 60 * 60) - breakMins / 60;

        if (!employeeMap[entry.userId]) {
          const user = allUsers.find(u => u.id === entry.userId);
          employeeMap[entry.userId] = {
            name: user ? `${user.firstName || ''} ${user.lastName || ''}`.trim() : 'Unknown',
            email: user?.email || '',
            totalHours: 0,
            holidayHours: 0,
            holidayPayExtra: 0,
            breakMinutes: 0,
            hourlyRate: parseFloat(user?.hourlyRate || "0"),
          };
        }

        const hours = Math.max(0, workedHours);
        employeeMap[entry.userId].totalHours += hours;
        employeeMap[entry.userId].breakMinutes += breakMins;

        const entryMonth = clockIn.getMonth() + 1;
        const entryDay = clockIn.getDate();
        const matchingHoliday = holidayRules.find(
          r => r.month === entryMonth && r.day === entryDay
        );
        if (matchingHoliday) {
          const multiplier = parseFloat(matchingHoliday.payMultiplier);
          const extraMultiplier = multiplier - 1;
          employeeMap[entry.userId].holidayHours += hours;
          employeeMap[entry.userId].holidayPayExtra += hours * employeeMap[entry.userId].hourlyRate * extraMultiplier;
        }
      }

      const csvHeaders = [
        'Employee Name', 'Email', 'Total Hours', 'Regular Hours', 'Overtime Hours',
        'Holiday Hours', 'Break Minutes', 'Hourly Rate', 'Regular Pay', 'Overtime Pay', 'Holiday Pay Bonus', 'Total Pay'
      ];

      const csvRows = Object.values(employeeMap).map(emp => {
        const regularHours = Math.min(emp.totalHours, overtimeThreshold);
        const overtimeHours = Math.max(0, emp.totalHours - overtimeThreshold);
        const regularPay = regularHours * emp.hourlyRate;
        const overtimePay = overtimeHours * emp.hourlyRate * overtimeMultiplier;
        const totalPay = regularPay + overtimePay + emp.holidayPayExtra;

        return [
          `"${sanitizeCsvField(emp.name)}"`,
          `"${sanitizeCsvField(emp.email)}"`,
          emp.totalHours.toFixed(2),
          regularHours.toFixed(2),
          overtimeHours.toFixed(2),
          emp.holidayHours.toFixed(2),
          emp.breakMinutes.toString(),
          emp.hourlyRate.toFixed(2),
          regularPay.toFixed(2),
          overtimePay.toFixed(2),
          emp.holidayPayExtra.toFixed(2),
          totalPay.toFixed(2),
        ].join(',');
      });

      const csv = [csvHeaders.join(','), ...csvRows].join('\n');

      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename=payroll_export_${startDate}_${endDate}.csv`);
      res.send(csv);
    } catch (error) {
      console.error("Error exporting payroll:", error);
      res.status(500).json({ message: "Failed to export payroll data" });
    }
  });

  app.get('/api/payroll/periods/:id/workflow-logs', isAuthenticated, async (req: any, res) => {
    try {
      const { id } = req.params;
      const logs = await storage.getWorkflowLogs(id);
      res.json(logs);
    } catch (error) {
      console.error("Error fetching workflow logs:", error);
      res.status(500).json({ message: "Failed to fetch workflow logs" });
    }
  });

  app.get('/api/payroll/periods/:id/confirmations', isAuthenticated, async (req: any, res) => {
    try {
      const { id } = req.params;
      const confirmations = await storage.getScheduleConfirmations(id);
      res.json(confirmations);
    } catch (error) {
      console.error("Error fetching schedule confirmations:", error);
      res.status(500).json({ message: "Failed to fetch confirmations" });
    }
  });

  app.post('/api/payroll/periods/:id/confirm-schedule', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const { id } = req.params;
      const { isConfirmed, feedback, conflicts } = req.body;
      
      const confirmation = await storage.createScheduleConfirmation({
        payrollPeriodId: id,
        userId,
        isConfirmed,
        feedback,
        conflicts,
        confirmedAt: isConfirmed ? new Date() : undefined
      });
      
      res.json(confirmation);
    } catch (error) {
      console.error("Error confirming schedule:", error);
      res.status(500).json({ message: "Failed to confirm schedule" });
    }
  });

  app.post('/api/payroll/automation/initialize', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const userPermissions = await storage.getUserPermissions(userId);
      const canManagePayroll = userPermissions.some(p => p.name === 'admin.manage_payroll' || p.name === 'admin.manage_all');
      
      if (!canManagePayroll) {
        return res.status(403).json({ message: "Payroll management access required" });
      }

      await automationService.initializeDefaultSettings(userId);
      res.json({ success: true, message: "Automation settings initialized" });
    } catch (error) {
      console.error("Error initializing automation:", error);
      res.status(500).json({ message: "Failed to initialize automation" });
    }
  });

  // Location and geofencing routes
  app.post('/api/geofence/check', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const { latitude, longitude } = req.body;
      
      const result = await geofencingService.checkUserLocation(userId, latitude, longitude);
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

  // Work locations routes (admin only)
  app.post('/api/work-locations', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const user = await storage.getUser(userId);
      
      const userPermissions = await storage.getUserPermissions(userId);
      const canManageLocations = userPermissions.some(p => p.name === 'admin.manage_locations');
      
      if (!canManageLocations) {
        return res.status(403).json({ message: "Location management access required" });
      }

      const data = insertWorkLocationSchema.parse(req.body);
      const location = await storage.createWorkLocation(data);
      res.json(location);
    } catch (error) {
      console.error("Error creating work location:", error);
      res.status(400).json({ message: (error as Error).message });
    }
  });

  app.get('/api/work-locations', isAuthenticated, async (req: any, res) => {
    try {
      const locations = await storage.getAllWorkLocations();
      res.json(locations);
    } catch (error) {
      console.error("Error fetching work locations:", error);
      res.status(500).json({ message: "Failed to fetch work locations" });
    }
  });

  // Work location update/delete
  app.put('/api/work-locations/:id', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const userPermissions = await storage.getUserPermissions(userId);
      const canManageLocations = userPermissions.some(p => p.name === 'admin.manage_locations' || p.name === 'admin.manage_all');
      if (!canManageLocations) {
        return res.status(403).json({ message: "Location management access required" });
      }
      const locationAllowedFields = ['name', 'address', 'latitude', 'longitude', 'radius', 'isActive'];
      const locationUpdates: Record<string, any> = {};
      for (const key of locationAllowedFields) {
        if (req.body[key] !== undefined) {
          locationUpdates[key] = req.body[key];
        }
      }
      const updated = await storage.updateWorkLocation(req.params.id, locationUpdates);
      await storage.createActivityLog({ userId, action: 'update', targetType: 'work_location', targetId: req.params.id, details: `Updated work location: ${updated.name}` });
      res.json(updated);
    } catch (error) {
      console.error("Error updating work location:", error);
      res.status(400).json({ message: (error as Error).message });
    }
  });

  app.delete('/api/work-locations/:id', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const userPermissions = await storage.getUserPermissions(userId);
      const canManageLocations = userPermissions.some(p => p.name === 'admin.manage_locations' || p.name === 'admin.manage_all');
      if (!canManageLocations) {
        return res.status(403).json({ message: "Location management access required" });
      }
      await storage.deleteWorkLocation(req.params.id);
      await storage.createActivityLog({ userId, action: 'delete', targetType: 'work_location', targetId: req.params.id, details: 'Deleted work location' });
      res.json({ message: "Location deleted" });
    } catch (error) {
      console.error("Error deleting work location:", error);
      res.status(400).json({ message: (error as Error).message });
    }
  });

  // Company settings routes
  app.get('/api/company-settings', isAuthenticated, async (req: any, res) => {
    try {
      const settings = await storage.getCompanySettings();
      res.json(settings || { companyName: 'My Company', timezone: 'America/New_York', businessStartHour: 8, businessEndHour: 17, overtimeThresholdHours: 40, overtimeMultiplier: '1.50', geofenceEnforcement: false, breakDurationMinutes: 30, autoClockOutMinutes: 480 });
    } catch (error) {
      console.error("Error fetching company settings:", error);
      res.status(500).json({ message: "Failed to fetch company settings" });
    }
  });

  app.put('/api/company-settings', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const userPermissions = await storage.getUserPermissions(userId);
      const canManage = userPermissions.some(p => p.name === 'admin.manage_all');
      if (!canManage) {
        return res.status(403).json({ message: "Admin access required" });
      }
      const settingsAllowedFields = ['companyName', 'timezone', 'businessStartHour', 'businessEndHour', 'overtimeThresholdHours', 'overtimeMultiplier', 'geofenceEnforcement', 'breakDurationMinutes', 'autoClockOutMinutes', 'defaultGeofenceRadius'];
      const settingsUpdates: Record<string, any> = { updatedBy: userId };
      for (const key of settingsAllowedFields) {
        if (req.body[key] !== undefined) {
          settingsUpdates[key] = req.body[key];
        }
      }
      const settings = await storage.updateCompanySettings(settingsUpdates);
      await storage.createActivityLog({ userId, action: 'update', targetType: 'company_settings', details: 'Updated company settings' });
      res.json(settings);
    } catch (error) {
      console.error("Error updating company settings:", error);
      res.status(400).json({ message: (error as Error).message });
    }
  });

  // Activity logs routes
  app.get('/api/activity-logs', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const userPermissions = await storage.getUserPermissions(userId);
      const canView = userPermissions.some(p => p.name === 'admin.manage_all');
      if (!canView) {
        return res.status(403).json({ message: "Admin access required" });
      }
      const limit = parseInt(req.query.limit as string) || 50;
      const logs = await storage.getActivityLogs(limit);
      res.json(logs);
    } catch (error) {
      console.error("Error fetching activity logs:", error);
      res.status(500).json({ message: "Failed to fetch activity logs" });
    }
  });

  // Push notification routes
  app.post('/api/push/subscribe', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const data = insertPushSubscriptionSchema.parse({ ...req.body, userId });
      
      const subscription = await storage.createPushSubscription(data);
      res.json(subscription);
    } catch (error) {
      console.error("Error creating push subscription:", error);
      res.status(400).json({ message: (error as Error).message });
    }
  });

  app.post('/api/push/test', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.id;
      await notificationService.sendToUser(userId, {
        title: '🔔 Test Notification',
        body: 'This is a test push notification from ClockSync AI. If you see this, notifications are working!',
        data: { type: 'test' },
      });
      res.json({ success: true, message: 'Test notification sent' });
    } catch (error) {
      console.error("Error sending test notification:", error);
      res.status(500).json({ message: "Failed to send test notification" });
    }
  });

  // Message/communication routes
  app.post('/api/messages', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const data = insertMessageSchema.parse({ ...req.body, senderId: userId });
      
      const message = await storage.createMessage(data);
      
      // Broadcast to connected clients
      broadcastToAll({
        type: 'message_created',
        data: { message },
      });

      res.json(message);
    } catch (error) {
      console.error("Error creating message:", error);
      res.status(400).json({ message: (error as Error).message });
    }
  });

  app.get('/api/messages', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const messages = await storage.getMessages(userId);
      res.json(messages);
    } catch (error) {
      console.error("Error fetching messages:", error);
      res.status(500).json({ message: "Failed to fetch messages" });
    }
  });

  // Group chat routes
  app.post('/api/groups', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const userPermissions = await storage.getUserPermissions(userId);
      const canCreateGroups = userPermissions.some(p => p.name === 'communication.create_groups');
      
      if (!canCreateGroups) {
        return res.status(403).json({ message: "Group creation access required" });
      }

      const { name, description, memberIds } = req.body;
      
      // Create group
      const group = await storage.createGroup({ 
        name, 
        description, 
        createdBy: userId 
      });
      
      // Add creator as member
      await storage.addGroupMember({ groupId: group.id, userId });
      
      // Add other members
      if (memberIds && Array.isArray(memberIds)) {
        for (const memberId of memberIds) {
          await storage.addGroupMember({ groupId: group.id, userId: memberId });
        }
      }

      res.json(group);
    } catch (error) {
      console.error("Error creating group:", error);
      res.status(400).json({ message: (error as Error).message });
    }
  });

  app.get('/api/groups', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const groups = await storage.getGroups(userId);
      res.json(groups);
    } catch (error) {
      console.error("Error fetching groups:", error);
      res.status(500).json({ message: "Failed to fetch groups" });
    }
  });

  app.get('/api/groups/:groupId/messages', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const { groupId } = req.params;
      
      // Check if user is member of group
      const members = await storage.getGroupMembers(groupId);
      const isMember = members.some(m => m.userId === userId);
      
      if (!isMember) {
        return res.status(403).json({ message: "Not a member of this group" });
      }

      const messages = await storage.getGroupMessages(groupId);
      res.json(messages);
    } catch (error) {
      console.error("Error fetching group messages:", error);
      res.status(500).json({ message: "Failed to fetch group messages" });
    }
  });

  app.get('/api/groups/:groupId/members', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const { groupId } = req.params;
      
      // Check if user is member of group
      const members = await storage.getGroupMembers(groupId);
      const isMember = members.some(m => m.userId === userId);
      
      if (!isMember) {
        return res.status(403).json({ message: "Not a member of this group" });
      }

      res.json(members);
    } catch (error) {
      console.error("Error fetching group members:", error);
      res.status(500).json({ message: "Failed to fetch group members" });
    }
  });

  app.post('/api/groups/:groupId/members', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const { groupId } = req.params;
      const { userIds } = req.body;
      
      // Check permissions to add members (group creator or admin)
      const userPermissions = await storage.getUserPermissions(userId);
      const canManageGroups = userPermissions.some(p => p.name === 'communication.manage_groups');
      
      if (!canManageGroups) {
        return res.status(403).json({ message: "Group management access required" });
      }

      const addedMembers = [];
      for (const newUserId of userIds) {
        const member = await storage.addGroupMember({ groupId, userId: newUserId });
        addedMembers.push(member);
      }

      res.json(addedMembers);
    } catch (error) {
      console.error("Error adding group members:", error);
      res.status(400).json({ message: (error as Error).message });
    }
  });

  // AI insights routes
  app.get('/api/insights', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const userPermissions = await storage.getUserPermissions(userId);
      const canViewAllInsights = userPermissions.some(p => p.name === 'hr.insights');
      
      let insights;
      if (canViewAllInsights) {
        insights = await storage.getUserInsights();
      } else {
        insights = await storage.getUserInsights(userId);
      }

      res.json(insights);
    } catch (error) {
      console.error("Error fetching insights:", error);
      res.status(500).json({ message: "Failed to fetch insights" });
    }
  });

  // Role management routes
  app.get('/api/roles', isAuthenticated, async (req: any, res) => {
    try {
      // Allow all authenticated users to view roles (needed for role assignment dropdowns)
      const roles = await storage.getAllRoles();
      res.json(roles);
    } catch (error) {
      console.error("Error fetching roles:", error);
      res.status(500).json({ message: "Failed to fetch roles" });
    }
  });

  app.post('/api/roles', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const userPermissions = await storage.getUserPermissions(userId);
      const canManageRoles = userPermissions.some(p => p.name === 'admin.role_management');
      
      if (!canManageRoles) {
        return res.status(403).json({ message: "Permission denied: Role management access required" });
      }
      
      const data = insertRoleSchema.parse(req.body);
      const role = await storage.createRole(data);
      res.json(role);
    } catch (error) {
      console.error("Error creating role:", error);
      res.status(400).json({ message: (error as Error).message });
    }
  });

  app.patch('/api/roles/:id', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const userPermissions = await storage.getUserPermissions(userId);
      const canManageRoles = userPermissions.some(p => p.name === 'admin.role_management');
      
      if (!canManageRoles) {
        return res.status(403).json({ message: "Permission denied: Role management access required" });
      }
      
      const { id } = req.params;
      const allowedFields = ['name', 'description', 'isDefault'];
      const safeUpdates: Record<string, any> = {};
      for (const key of allowedFields) {
        if (req.body[key] !== undefined) {
          safeUpdates[key] = req.body[key];
        }
      }
      
      const role = await storage.updateRole(id, safeUpdates);
      res.json(role);
    } catch (error) {
      console.error("Error updating role:", error);
      res.status(400).json({ message: (error as Error).message });
    }
  });

  app.delete('/api/roles/:id', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const userPermissions = await storage.getUserPermissions(userId);
      const canManageRoles = userPermissions.some(p => p.name === 'admin.role_management');
      
      if (!canManageRoles) {
        return res.status(403).json({ message: "Permission denied: Role management access required" });
      }
      
      const { id } = req.params;
      await storage.deleteRole(id);
      res.json({ success: true });
    } catch (error) {
      console.error("Error deleting role:", error);
      res.status(400).json({ message: (error as Error).message });
    }
  });

  // Permission management routes
  app.get('/api/permissions', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const userPermissions = await storage.getUserPermissions(userId);
      const canManageRoles = userPermissions.some(p => p.name === 'admin.role_management');
      
      if (!canManageRoles) {
        return res.status(403).json({ message: "Permission denied: Role management access required" });
      }
      
      const permissions = await storage.getPermissionsByCategory();
      res.json(permissions);
    } catch (error) {
      console.error("Error fetching permissions:", error);
      res.status(500).json({ message: "Failed to fetch permissions" });
    }
  });

  app.get('/api/roles/all-permissions', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const userPermissions = await storage.getUserPermissions(userId);
      const canManageRoles = userPermissions.some(p => p.name === 'admin.role_management' || p.name === 'admin.manage_all');
      
      if (!canManageRoles) {
        return res.status(403).json({ message: "Permission denied: Role management access required" });
      }
      
      const allRoles = await storage.getAllRoles();
      const result: Record<string, string[]> = {};
      for (const role of allRoles) {
        const perms = await storage.getRolePermissions(role.id);
        result[role.id] = perms.map(p => p.id);
      }
      res.json(result);
    } catch (error) {
      console.error("Error fetching all role permissions:", error);
      res.status(500).json({ message: "Failed to fetch all role permissions" });
    }
  });

  app.get('/api/roles/:id/permissions', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const userPermissions = await storage.getUserPermissions(userId);
      const canManageRoles = userPermissions.some(p => p.name === 'admin.role_management');
      
      if (!canManageRoles) {
        return res.status(403).json({ message: "Permission denied: Role management access required" });
      }
      
      const { id } = req.params;
      const rolePermissions = await storage.getRolePermissions(id);
      res.json(rolePermissions);
    } catch (error) {
      console.error("Error fetching role permissions:", error);
      res.status(500).json({ message: "Failed to fetch role permissions" });
    }
  });

  app.put('/api/roles/:id/permissions', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const userPermissions = await storage.getUserPermissions(userId);
      const canManageRoles = userPermissions.some(p => p.name === 'admin.role_management');
      
      if (!canManageRoles) {
        return res.status(403).json({ message: "Permission denied: Role management access required" });
      }
      
      const { id } = req.params;
      const { permissionIds } = req.body;
      
      if (!Array.isArray(permissionIds)) {
        return res.status(400).json({ message: "permissionIds must be an array" });
      }
      
      await storage.updateRolePermissions(id, permissionIds);
      const updatedPermissions = await storage.getRolePermissions(id);
      res.json(updatedPermissions);
    } catch (error) {
      console.error("Error updating role permissions:", error);
      res.status(400).json({ message: (error as Error).message });
    }
  });

  // User role assignment routes
  app.patch('/api/users/:id/role', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const userPermissions = await storage.getUserPermissions(userId);
      const canEditTeam = userPermissions.some(p => p.name === 'hr.edit_team');
      
      if (!canEditTeam) {
        return res.status(403).json({ message: "Permission denied: Team editing access required" });
      }
      
      const { id } = req.params;
      const { roleId } = req.body;
      
      await storage.assignUserRole(id, roleId);
      const updatedUser = await storage.getUserWithRole(id);
      res.json(updatedUser);
    } catch (error) {
      console.error("Error assigning user role:", error);
      res.status(400).json({ message: (error as Error).message });
    }
  });

  app.get('/api/users/:id/permissions', isAuthenticated, async (req: any, res) => {
    try {
      const { id } = req.params;
      const requestingUserId = req.user.id;
      
      // Users can view their own permissions, or managers can view team permissions
      if (id !== requestingUserId) {
        const userPermissions = await storage.getUserPermissions(requestingUserId);
        const canViewTeam = userPermissions.some(p => p.name === 'hr.view_team');
        
        if (!canViewTeam) {
          return res.status(403).json({ message: "Permission denied" });
        }
      }
      
      const permissions = await storage.getUserPermissions(id);
      res.json(permissions);
    } catch (error) {
      console.error("Error fetching user permissions:", error);
      res.status(500).json({ message: "Failed to fetch user permissions" });
    }
  });

  // Chore management routes
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
      
      // Broadcast assignment to connected clients
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
      
      // Check permissions for manager sign-off
      if (data.isManager) {
        const userPermissions = await storage.getUserPermissions(userId);
        const canApprove = userPermissions.some(p => p.name === 'time.approve' || p.name === 'tasks.edit_all');
        
        if (!canApprove) {
          return res.status(403).json({ message: "Permission denied: Approval access required" });
        }
      }
      
      const updatedChore = await storage.signOffChore(data.choreId, userId, data.isManager);
      
      // Broadcast sign-off to connected clients
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

  // Users management routes
  app.get('/api/users', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const userPermissions = await storage.getUserPermissions(userId);
      const canViewTeam = userPermissions.some(p => p.name === 'hr.view_team' || p.name === 'schedule.view_all');
      
      if (!canViewTeam) {
        // Return only the current user if no team viewing permissions
        const currentUser = await storage.getUser(userId);
        res.json(currentUser ? [currentUser] : []);
        return;
      }
      
      // Get all users for managers/admins
      const allUsers = await db.select().from(users).where(eq(users.isActive, true));
      res.json(allUsers);
    } catch (error) {
      console.error("Error fetching users:", error);
      res.status(500).json({ message: "Failed to fetch users" });
    }
  });

  // User management routes
  app.put('/api/users/:userId/pay-rate', isAuthenticated, async (req: any, res) => {
    try {
      const currentUserId = req.user.id;
      const { userId } = req.params;
      const { hourlyRate } = req.body;

      // Check permissions
      const userPermissions = await storage.getUserPermissions(currentUserId);
      const canEditPayRates = userPermissions.some(p => p.name === 'hr.edit_pay_rates');
      
      if (!canEditPayRates) {
        return res.status(403).json({ message: "Pay rate editing access required" });
      }

      const updatedUser = await storage.updateUserPayRate(userId, parseFloat(hourlyRate));
      res.json(updatedUser);
    } catch (error) {
      console.error("Error updating pay rate:", error);
      res.status(400).json({ message: (error as Error).message });
    }
  });

  app.delete('/api/users/:userId', isAuthenticated, async (req: any, res) => {
    try {
      const currentUserId = req.user.id;
      const { userId } = req.params;

      // Check permissions
      const userPermissions = await storage.getUserPermissions(currentUserId);
      const canManageEmployees = userPermissions.some(p => p.name === 'hr.manage_employees');
      
      if (!canManageEmployees) {
        return res.status(403).json({ message: "Employee management access required" });
      }

      // Prevent users from deleting themselves
      if (currentUserId === userId) {
        return res.status(400).json({ message: "Cannot delete your own account" });
      }

      await storage.deleteUser(userId);
      res.json({ message: "User deleted successfully" });
    } catch (error) {
      console.error("Error deleting user:", error);
      res.status(400).json({ message: (error as Error).message });
    }
  });

  app.put('/api/users/:userId/role', isAuthenticated, async (req: any, res) => {
    try {
      const currentUserId = req.user.id;
      const { userId } = req.params;
      const { roleId } = req.body;

      // Check permissions
      const userPermissions = await storage.getUserPermissions(currentUserId);
      const canEditRoles = userPermissions.some(p => p.name === 'admin.role_management');
      
      if (!canEditRoles) {
        return res.status(403).json({ message: "Role management access required" });
      }

      const updatedUser = await storage.updateUserRole(userId, roleId);
      res.json(updatedUser);
    } catch (error) {
      console.error("Error updating user role:", error);
      res.status(400).json({ message: (error as Error).message });
    }
  });

  // Payroll setup routes
  app.post('/api/payroll/setup', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const userPermissions = await storage.getUserPermissions(userId);
      const canManagePayroll = userPermissions.some(p => 
        p.name === 'admin.manage_payroll' || p.name === 'admin.manage_all'
      );
      
      if (!canManagePayroll) {
        return res.status(403).json({ message: "Payroll management access required" });
      }

      const { 
        intervalType, 
        firstPayPeriodStart, 
        firstPayPeriodEnd, 
        isAutomationEnabled, 
        notificationUserId,
        isSetupComplete 
      } = req.body;

      // Create or update payroll settings
      const existingSettings = await storage.getPayrollSettings();
      
      if (existingSettings) {
        await storage.updatePayrollSettings(existingSettings.id, {
          intervalType,
          firstPayPeriodStart: new Date(firstPayPeriodStart),
          firstPayPeriodEnd: new Date(firstPayPeriodEnd),
          isAutomationEnabled,
          notificationUserId,
          isSetupComplete,
          updatedBy: userId,
        });
      } else {
        await storage.createPayrollSettings({
          intervalType,
          firstPayPeriodStart: new Date(firstPayPeriodStart),
          firstPayPeriodEnd: new Date(firstPayPeriodEnd),
          isAutomationEnabled,
          notificationUserId,
          isSetupComplete,
          createdBy: userId,
        });
      }

      // Create the first payroll period
      await storage.createPayrollPeriod({
        startDate: new Date(firstPayPeriodStart),
        endDate: new Date(firstPayPeriodEnd),
        workflowState: 'created',
      });

      // If AI automation is enabled, schedule future periods
      if (isAutomationEnabled) {
        await payrollAutomationService.scheduleNextPayrollPeriods(intervalType, new Date(firstPayPeriodEnd));
      }

      res.json({ message: "Payroll setup completed successfully" });
    } catch (error) {
      console.error("Error setting up payroll:", error);
      res.status(500).json({ message: "Failed to setup payroll" });
    }
  });

  app.get('/api/payroll/settings', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const userPermissions = await storage.getUserPermissions(userId);
      const canViewPayroll = userPermissions.some(p => 
        p.name === 'admin.manage_payroll' || p.name === 'admin.manage_all'
      );
      
      if (!canViewPayroll) {
        return res.status(403).json({ message: "Payroll access required" });
      }

      const settings = await storage.getPayrollSettings();
      res.json(settings);
    } catch (error) {
      console.error("Error fetching payroll settings:", error);
      res.status(500).json({ message: "Failed to fetch payroll settings" });
    }
  });

  app.get('/api/payroll/setup-status', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const userPermissions = await storage.getUserPermissions(userId);
      const canManagePayroll = userPermissions.some(p => 
        p.name === 'admin.manage_payroll' || p.name === 'admin.manage_all'
      );
      
      const settings = await storage.getPayrollSettings();
      
      res.json({ 
        needsSetup: canManagePayroll && (!settings || !settings.isSetupComplete),
        canManagePayroll 
      });
    } catch (error) {
      console.error("Error checking setup status:", error);
      res.status(500).json({ message: "Failed to check setup status" });
    }
  });

  // =============================================
  // SHOPIFY INTEGRATION ROUTES
  // =============================================

  const processedAuthCodes = new Map<string, { timestamp: number; status: string }>();
  setInterval(() => {
    const now = Date.now();
    const entries = Array.from(processedAuthCodes.entries());
    entries.forEach(([code, data]) => {
      if (now - data.timestamp > 600000) processedAuthCodes.delete(code);
    });
  }, 300000);

  function getAppUrl(requestHostname?: string): string {
    if (requestHostname) {
      const protocol = requestHostname.includes('replit.dev')
        || requestHostname.includes('.replit.app') ? 'https' : 'http';
      return `${protocol}://${requestHostname}`;
    }
    return 'http://localhost:5000';
  }

  async function getShopifyCredentials(shopDomain: string): Promise<{ shopDomain: string; accessToken: string } | null> {
    try {
      const normalizedDomain = shopDomain.trim().toLowerCase();
      const shopResult = await db.select()
        .from(shops)
        .where(eq(shops.shopDomain, normalizedDomain))
        .limit(1);

      if (shopResult.length > 0 && shopResult[0].accessToken) {
        let token = shopResult[0].accessToken;
        try {
          token = decryptToken(token);
        } catch {
        }
        return { shopDomain: shopResult[0].shopDomain, accessToken: token };
      }
      return null;
    } catch (error) {
      console.error(`Error fetching credentials for ${shopDomain}:`, error);
      return null;
    }
  }

  // Shopify OAuth: Initiate
  app.get("/api/shopify/auth", isAuthenticated, async (req: any, res) => {
    try {
      const shop = req.query.shop as string;
      if (!shop) {
        return res.status(400).json({ error: "Shop domain is required" });
      }

      const shopDomain = shop.includes('.myshopify.com')
        ? shop.trim().toLowerCase()
        : `${shop.trim().toLowerCase()}.myshopify.com`;

      const apiKey = process.env.SHOPIFY_API_KEY;
      if (!apiKey) {
        return res.status(500).json({ error: "Shopify API key not configured" });
      }

      const state = crypto.randomBytes(16).toString('hex');
      (req.session as any).oauthState = state;
      (req.session as any).oauthUserId = req.user.id;

      await new Promise<void>((resolve, reject) => {
        req.session.save((err: any) => err ? reject(err) : resolve());
      });

      const baseUrl = getAppUrl(req.get('host'));
      const redirectUri = `${baseUrl}/api/shopify/auth/callback`;
      const scopes = 'read_orders,read_products';

      const authUrl = `https://${shopDomain}/admin/oauth/authorize?` +
        `client_id=${apiKey}` +
        `&scope=${scopes}` +
        `&redirect_uri=${encodeURIComponent(redirectUri)}` +
        `&state=${state}`;

      res.json({ authUrl });
    } catch (error) {
      console.error('[Shopify OAuth] Init error:', error);
      res.status(500).json({ error: "Failed to initiate Shopify connection" });
    }
  });

  // Shopify OAuth: Callback
  app.get("/api/shopify/auth/callback", async (req: any, res) => {
    try {
      const { code, hmac, shop, state } = req.query;

      if (code && typeof code === 'string') {
        const existingCode = processedAuthCodes.get(code);
        if (existingCode) {
          if (existingCode.status === 'success') {
            return res.redirect(`/admin?shopify=connected&shop=${encodeURIComponent(String(shop))}`);
          }
          if (existingCode.status === 'processing') {
            for (let i = 0; i < 10; i++) {
              await new Promise(resolve => setTimeout(resolve, 500));
              const updated = processedAuthCodes.get(code);
              if (updated?.status === 'success') {
                return res.redirect(`/admin?shopify=connected&shop=${encodeURIComponent(String(shop))}`);
              }
              if (updated?.status === 'failed') break;
            }
          }
        }
        processedAuthCodes.set(code, { timestamp: Date.now(), status: 'processing' });
      }

      if (state !== (req.session as any)?.oauthState) {
        console.error('[Shopify OAuth] State mismatch');
        if (code && typeof code === 'string') {
          processedAuthCodes.set(code, { timestamp: Date.now(), status: 'failed' });
        }
        return res.redirect(`/admin?shopify=error&message=${encodeURIComponent('Session expired. Please try again.')}`);
      }

      if (!shop || !code || typeof shop !== 'string' || typeof code !== 'string') {
        return res.redirect(`/admin?shopify=error&message=${encodeURIComponent('Missing OAuth parameters')}`);
      }

      const shopDomain = shop.toLowerCase().trim();
      const apiKey = process.env.SHOPIFY_API_KEY;
      const apiSecret = process.env.SHOPIFY_API_SECRET;

      if (hmac && apiSecret) {
        const queryParams = { ...req.query } as Record<string, any>;
        delete queryParams.hmac;
        delete queryParams.__clerk_handshake;

        const message = Object.keys(queryParams)
          .sort()
          .map(key => `${key}=${queryParams[key]}`)
          .join('&');

        const hash = crypto.createHmac('sha256', apiSecret)
          .update(message)
          .digest('hex');

        const hashBuffer = Buffer.from(hash, 'hex');
        const hmacBuffer = Buffer.from(String(hmac), 'hex');
        if (hashBuffer.length !== hmacBuffer.length || !crypto.timingSafeEqual(hashBuffer, hmacBuffer)) {
          console.error('[Shopify OAuth] HMAC verification failed');
          return res.redirect(`/admin?shopify=error&message=${encodeURIComponent('Security verification failed')}`);
        }
      }

      const tokenBody = new URLSearchParams({
        client_id: apiKey || '',
        client_secret: apiSecret || '',
        code: code,
      });

      const tokenResponse = await fetch(`https://${shopDomain}/admin/oauth/access_token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: tokenBody.toString(),
      });

      if (!tokenResponse.ok) {
        const errorBody = await tokenResponse.text();
        throw new Error(`Token exchange failed (${tokenResponse.status}): ${errorBody}`);
      }

      const tokenData = await tokenResponse.json() as any;
      const { access_token: accessToken } = tokenData;
      if (!accessToken) {
        throw new Error('No access token received from Shopify');
      }

      const shopifyService = new ShopifyService(shopDomain, accessToken);
      const shopInfo = await shopifyService.getShopInfo().catch(() => null);

      let encryptedToken: string;
      try {
        encryptedToken = encryptToken(accessToken);
      } catch {
        encryptedToken = accessToken;
      }

      const existing = await db.select()
        .from(shops)
        .where(eq(shops.shopDomain, shopDomain))
        .limit(1);

      if (existing.length > 0) {
        await db.update(shops)
          .set({
            accessToken: encryptedToken,
            isActive: true,
            shopName: shopInfo?.name || existing[0].shopName,
            shopEmail: shopInfo?.email || existing[0].shopEmail,
            currency: shopInfo?.currencyCode || existing[0].currency,
            timezone: shopInfo?.timezoneAbbreviation || existing[0].timezone,
            updatedAt: new Date(),
          })
          .where(eq(shops.shopDomain, shopDomain));
      } else {
        await db.insert(shops).values({
          shopDomain,
          accessToken: encryptedToken,
          isActive: true,
          shopName: shopInfo?.name || null,
          shopEmail: shopInfo?.email || null,
          currency: shopInfo?.currencyCode || 'USD',
          timezone: shopInfo?.timezoneAbbreviation || null,
        });
      }

      const userId = (req.session as any)?.oauthUserId;
      if (userId) {
        const existingLink = await db.select()
          .from(userShops)
          .where(and(eq(userShops.userId, userId), eq(userShops.shopDomain, shopDomain)))
          .limit(1);

        if (!existingLink || existingLink.length === 0) {
          await db.insert(userShops).values({ userId, shopDomain });
        }
        delete (req.session as any).oauthUserId;
      }

      delete (req.session as any).oauthState;
      await new Promise<void>((resolve, reject) => {
        req.session.save((err: any) => err ? reject(err) : resolve());
      });

      if (code) {
        processedAuthCodes.set(code, { timestamp: Date.now(), status: 'success' });
      }

      res.redirect(`/admin?shopify=connected&shop=${encodeURIComponent(shopDomain)}`);
    } catch (error) {
      const { code } = req.query;
      if (code && typeof code === 'string') {
        processedAuthCodes.set(code, { timestamp: Date.now(), status: 'failed' });
      }
      console.error('[Shopify OAuth] Callback error:', error);
      if (!res.headersSent) {
        res.redirect(`/admin?shopify=error&message=${encodeURIComponent('Connection failed. Please try again.')}`);
      }
    }
  });

  // Get connected Shopify shops
  app.get("/api/shopify/shops", isAuthenticated, async (req: any, res) => {
    try {
      const allShops = await db.select({
        id: shops.id,
        shopDomain: shops.shopDomain,
        shopName: shops.shopName,
        shopEmail: shops.shopEmail,
        currency: shops.currency,
        timezone: shops.timezone,
        isActive: shops.isActive,
        lastSyncAt: shops.lastSyncAt,
        createdAt: shops.createdAt,
      }).from(shops).where(eq(shops.isActive, true));

      res.json(allShops);
    } catch (error) {
      console.error("Error fetching shops:", error);
      res.status(500).json({ message: "Failed to fetch connected shops" });
    }
  });

  // Disconnect a Shopify shop
  app.post("/api/shopify/disconnect", isAuthenticated, async (req: any, res) => {
    try {
      const { shopDomain: domain } = req.body;
      if (!domain) {
        return res.status(400).json({ error: "Shop domain required" });
      }

      await db.update(shops)
        .set({ isActive: false, updatedAt: new Date() })
        .where(eq(shops.shopDomain, domain.toLowerCase().trim()));

      res.json({ success: true });
    } catch (error) {
      console.error("Error disconnecting shop:", error);
      res.status(500).json({ message: "Failed to disconnect shop" });
    }
  });

  // Sync sales data from Shopify
  app.post("/api/shopify/sync-sales", isAuthenticated, async (req: any, res) => {
    try {
      const { shopDomain: domain, daysBack = 365 } = req.body;
      if (!domain) {
        return res.status(400).json({ error: "Shop domain required" });
      }

      const credentials = await getShopifyCredentials(domain);
      if (!credentials) {
        return res.status(400).json({ error: "No credentials found for this shop" });
      }

      const shopifyService = new ShopifyService(credentials.shopDomain, credentials.accessToken);

      const now = new Date();
      const startDate = new Date(now.getTime() - daysBack * 24 * 60 * 60 * 1000);

      const orders = await shopifyService.getOrders({
        first: 250,
        createdAtMin: startDate.toISOString(),
        createdAtMax: now.toISOString(),
        maxPages: 20,
      });

      const dailyAggregation: Record<string, {
        date: Date;
        dayOfWeek: number;
        orderCount: number;
        totalRevenue: number;
        itemCount: number;
      }> = {};

      for (const order of orders) {
        const orderDate = new Date(order.createdAt);
        const dateKey = orderDate.toISOString().split('T')[0];

        if (!dailyAggregation[dateKey]) {
          const d = new Date(dateKey + 'T00:00:00Z');
          dailyAggregation[dateKey] = {
            date: d,
            dayOfWeek: d.getUTCDay(),
            orderCount: 0,
            totalRevenue: 0,
            itemCount: 0,
          };
        }

        dailyAggregation[dateKey].orderCount++;
        dailyAggregation[dateKey].totalRevenue += parseFloat(order.totalPriceSet?.shopMoney?.amount || '0');

        for (const lineItem of (order.lineItems?.nodes || [])) {
          dailyAggregation[dateKey].itemCount += lineItem.quantity || 1;
        }
      }

      let syncedDays = 0;
      for (const [dateKey, dayData] of Object.entries(dailyAggregation)) {
        const existing = await db.select()
          .from(shopifyDailySales)
          .where(and(
            eq(shopifyDailySales.shopDomain, credentials.shopDomain),
            eq(shopifyDailySales.date, dayData.date)
          ))
          .limit(1);

        const avgOrderValue = dayData.orderCount > 0
          ? Math.round((dayData.totalRevenue / dayData.orderCount) * 100) / 100
          : 0;

        if (existing.length > 0) {
          await db.update(shopifyDailySales)
            .set({
              orderCount: dayData.orderCount,
              totalRevenue: String(Math.round(dayData.totalRevenue * 100) / 100),
              itemCount: dayData.itemCount,
              averageOrderValue: String(avgOrderValue),
              dayOfWeek: dayData.dayOfWeek,
            })
            .where(eq(shopifyDailySales.id, existing[0].id));
        } else {
          await db.insert(shopifyDailySales).values({
            shopDomain: credentials.shopDomain,
            date: dayData.date,
            dayOfWeek: dayData.dayOfWeek,
            orderCount: dayData.orderCount,
            totalRevenue: String(Math.round(dayData.totalRevenue * 100) / 100),
            itemCount: dayData.itemCount,
            averageOrderValue: String(avgOrderValue),
          });
        }
        syncedDays++;
      }

      await db.update(shops)
        .set({ lastSyncAt: new Date(), updatedAt: new Date() })
        .where(eq(shops.shopDomain, credentials.shopDomain));

      res.json({
        success: true,
        ordersProcessed: orders.length,
        daysSynced: syncedDays,
        dateRange: {
          from: startDate.toISOString().split('T')[0],
          to: now.toISOString().split('T')[0],
        },
      });
    } catch (error) {
      console.error("Error syncing sales data:", error);
      res.status(500).json({ message: "Failed to sync sales data" });
    }
  });

  // Get aggregated sales data
  app.get("/api/shopify/sales-data", isAuthenticated, async (req: any, res) => {
    try {
      const shopDomain = req.query.shop as string;
      if (!shopDomain) {
        return res.status(400).json({ error: "Shop domain required" });
      }

      const daysBack = parseInt(req.query.daysBack as string || '365');
      const startDate = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000);

      const salesData = await db.select()
        .from(shopifyDailySales)
        .where(and(
          eq(shopifyDailySales.shopDomain, shopDomain.toLowerCase().trim()),
          gte(shopifyDailySales.date, startDate)
        ))
        .orderBy(desc(shopifyDailySales.date));

      const dayOfWeekAverages: Record<number, { totalRevenue: number; totalOrders: number; count: number }> = {};
      for (let i = 0; i < 7; i++) {
        dayOfWeekAverages[i] = { totalRevenue: 0, totalOrders: 0, count: 0 };
      }

      let totalRevenue = 0;
      let totalOrders = 0;

      for (const day of salesData) {
        const rev = parseFloat(day.totalRevenue || '0');
        const orders = day.orderCount || 0;
        totalRevenue += rev;
        totalOrders += orders;

        dayOfWeekAverages[day.dayOfWeek].totalRevenue += rev;
        dayOfWeekAverages[day.dayOfWeek].totalOrders += orders;
        dayOfWeekAverages[day.dayOfWeek].count++;
      }

      const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
      const weekdayAnalysis = Object.entries(dayOfWeekAverages).map(([dow, data]) => ({
        dayOfWeek: parseInt(dow),
        dayName: dayNames[parseInt(dow)],
        avgRevenue: data.count > 0 ? Math.round((data.totalRevenue / data.count) * 100) / 100 : 0,
        avgOrders: data.count > 0 ? Math.round((data.totalOrders / data.count) * 100) / 100 : 0,
        sampleDays: data.count,
      }));

      res.json({
        dailySales: salesData,
        weekdayAnalysis,
        summary: {
          totalDays: salesData.length,
          totalRevenue: Math.round(totalRevenue * 100) / 100,
          totalOrders,
          avgDailyRevenue: salesData.length > 0 ? Math.round((totalRevenue / salesData.length) * 100) / 100 : 0,
          avgDailyOrders: salesData.length > 0 ? Math.round((totalOrders / salesData.length) * 100) / 100 : 0,
        },
      });
    } catch (error) {
      console.error("Error fetching sales data:", error);
      res.status(500).json({ message: "Failed to fetch sales data" });
    }
  });

  // AI-powered staffing recommendations
  app.get("/api/shopify/staffing-recommendations", isAuthenticated, aiRateLimiter, async (req: any, res) => {
    try {
      const shopDomain = req.query.shop as string;
      const targetDate = req.query.date as string;

      if (!shopDomain) {
        return res.status(400).json({ error: "Shop domain required" });
      }

      const startDate = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000);
      const salesData = await db.select()
        .from(shopifyDailySales)
        .where(and(
          eq(shopifyDailySales.shopDomain, shopDomain.toLowerCase().trim()),
          gte(shopifyDailySales.date, startDate)
        ))
        .orderBy(desc(shopifyDailySales.date));

      if (salesData.length === 0) {
        return res.json({
          recommendations: [],
          message: "No sales data available. Please sync your Shopify store first.",
        });
      }

      const dayOfWeekStats: Record<number, { revenues: number[]; orders: number[] }> = {};
      for (let i = 0; i < 7; i++) {
        dayOfWeekStats[i] = { revenues: [], orders: [] };
      }

      for (const day of salesData) {
        dayOfWeekStats[day.dayOfWeek].revenues.push(parseFloat(day.totalRevenue || '0'));
        dayOfWeekStats[day.dayOfWeek].orders.push(day.orderCount || 0);
      }

      const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

      const weekAnalysis = Object.entries(dayOfWeekStats).map(([dow, stats]) => {
        const avgRev = stats.revenues.length > 0
          ? stats.revenues.reduce((a, b) => a + b, 0) / stats.revenues.length : 0;
        const avgOrders = stats.orders.length > 0
          ? stats.orders.reduce((a, b) => a + b, 0) / stats.orders.length : 0;
        const maxRev = stats.revenues.length > 0 ? Math.max(...stats.revenues) : 0;

        return {
          dayOfWeek: parseInt(dow),
          dayName: dayNames[parseInt(dow)],
          avgRevenue: Math.round(avgRev * 100) / 100,
          avgOrders: Math.round(avgOrders * 100) / 100,
          maxRevenue: Math.round(maxRev * 100) / 100,
          sampleSize: stats.revenues.length,
        };
      });

      const allAvgRevenues = weekAnalysis.map(d => d.avgRevenue);
      const overallAvg = allAvgRevenues.reduce((a, b) => a + b, 0) / allAvgRevenues.length;

      const recommendations = weekAnalysis.map(day => {
        const ratio = overallAvg > 0 ? day.avgRevenue / overallAvg : 1;
        let staffingLevel: string;
        let staffMultiplier: number;

        if (ratio >= 1.4) {
          staffingLevel = 'high';
          staffMultiplier = 1.5;
        } else if (ratio >= 1.15) {
          staffingLevel = 'above_average';
          staffMultiplier = 1.25;
        } else if (ratio >= 0.85) {
          staffingLevel = 'normal';
          staffMultiplier = 1.0;
        } else if (ratio >= 0.6) {
          staffingLevel = 'below_average';
          staffMultiplier = 0.75;
        } else {
          staffingLevel = 'low';
          staffMultiplier = 0.5;
        }

        return {
          ...day,
          staffingLevel,
          staffMultiplier,
          revenueRatio: Math.round(ratio * 100) / 100,
        };
      });

      let aiInsight = '';
      try {
        const prompt = `You are a staffing advisor for a retail business. Based on the following weekly sales pattern data from last year, provide a brief 2-3 sentence recommendation for optimal staffing.

Sales data by day of week:
${recommendations.map(r => `${r.dayName}: avg $${r.avgRevenue} revenue, ${r.avgOrders} orders (${r.staffingLevel} staffing recommended)`).join('\n')}

Overall average daily revenue: $${Math.round(overallAvg * 100) / 100}

${targetDate ? `The user is specifically asking about scheduling for ${targetDate}.` : 'Provide a general weekly staffing overview.'}

Keep your response concise, practical, and focused on actionable staffing advice.`;

        const response = await claudeService.chat(prompt);
        aiInsight = response || '';
      } catch (aiError) {
        console.error('AI insight generation failed:', aiError);
        aiInsight = 'AI analysis unavailable. Review the day-by-day breakdown below to plan your staffing.';
      }

      res.json({
        recommendations,
        aiInsight,
        overallAvgRevenue: Math.round(overallAvg * 100) / 100,
        dataPoints: salesData.length,
      });
    } catch (error) {
      console.error("Error generating staffing recommendations:", error);
      res.status(500).json({ message: "Failed to generate staffing recommendations" });
    }
  });

  // Labor cost ratio against Shopify revenue
  app.get("/api/shopify/labor-cost-ratio", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const userPermissions = await storage.getUserPermissions(userId);
      const canView = userPermissions.some(p => p.name === 'admin.manage_all');

      if (!canView) {
        return res.status(403).json({ message: "Admin access required" });
      }

      const shopDomain = req.query.shop as string;
      if (!shopDomain) {
        return res.status(400).json({ error: "Shop domain required" });
      }

      const daysBack = parseInt(req.query.daysBack as string || '30');
      const now = new Date();
      const startDate = new Date(now.getTime() - daysBack * 24 * 60 * 60 * 1000);
      startDate.setHours(0, 0, 0, 0);

      const salesData = await db.select()
        .from(shopifyDailySales)
        .where(and(
          eq(shopifyDailySales.shopDomain, shopDomain.toLowerCase().trim()),
          gte(shopifyDailySales.date, startDate)
        ))
        .orderBy(shopifyDailySales.date);

      const allTimeEntries = await storage.getAllTimeEntries(startDate, now);
      const allUsers = await db.select().from(users).where(eq(users.isActive, true));

      const userRateMap = new Map<string, number>();
      allUsers.forEach(u => {
        userRateMap.set(u.id, parseFloat(u.hourlyRate || '15'));
      });

      const revenueByDate = new Map<string, number>();
      for (const day of salesData) {
        const dateKey = new Date(day.date).toISOString().split('T')[0];
        revenueByDate.set(dateKey, (revenueByDate.get(dateKey) || 0) + parseFloat(day.totalRevenue || '0'));
      }

      const laborByDate = new Map<string, number>();
      for (const entry of allTimeEntries) {
        if (!entry.clockOutTime) continue;
        const clockIn = new Date(entry.clockInTime);
        const clockOut = new Date(entry.clockOutTime);
        const hours = Math.max(0, (clockOut.getTime() - clockIn.getTime()) / 3600000 - (entry.breakMinutes || 0) / 60);
        const rate = userRateMap.get(entry.userId) || 15;
        const dateKey = clockIn.toISOString().split('T')[0];
        laborByDate.set(dateKey, (laborByDate.get(dateKey) || 0) + hours * rate);
      }

      const allDates = new Set([...revenueByDate.keys(), ...laborByDate.keys()]);
      const dailyBreakdown = Array.from(allDates)
        .sort()
        .map(date => {
          const revenue = Math.round((revenueByDate.get(date) || 0) * 100) / 100;
          const laborCost = Math.round((laborByDate.get(date) || 0) * 100) / 100;
          const percentage = revenue > 0 ? Math.round((laborCost / revenue) * 10000) / 100 : 0;
          return { date, revenue, laborCost, percentage };
        });

      const totalRevenue = dailyBreakdown.reduce((sum, d) => sum + d.revenue, 0);
      const totalLaborCost = dailyBreakdown.reduce((sum, d) => sum + d.laborCost, 0);
      const laborCostPercentage = totalRevenue > 0
        ? Math.round((totalLaborCost / totalRevenue) * 10000) / 100
        : 0;

      res.json({
        totalRevenue: Math.round(totalRevenue * 100) / 100,
        totalLaborCost: Math.round(totalLaborCost * 100) / 100,
        laborCostPercentage,
        daysBack,
        dailyBreakdown,
      });
    } catch (error) {
      console.error("Error calculating labor cost ratio:", error);
      res.status(500).json({ message: "Failed to calculate labor cost ratio" });
    }
  });

  // Analytics dashboard endpoint
  app.get('/api/analytics/dashboard', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const userPermissions = await storage.getUserPermissions(userId);
      const canView = userPermissions.some(p => p.name === 'hr.view_team' || p.name === 'admin.manage_all');

      if (!canView) {
        return res.status(403).json({ message: "Access denied" });
      }

      const now = new Date();
      const thirtyDaysAgo = new Date(now);
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      thirtyDaysAgo.setHours(0, 0, 0, 0);

      const todayStart = new Date(now);
      todayStart.setHours(0, 0, 0, 0);
      const todayEnd = new Date(now);
      todayEnd.setHours(23, 59, 59, 999);

      const weekStart = new Date(now);
      weekStart.setDate(now.getDate() - now.getDay());
      weekStart.setHours(0, 0, 0, 0);

      const allTimeEntries = await storage.getAllTimeEntries(thirtyDaysAgo, now);
      const allUsers = await db.select().from(users).where(eq(users.isActive, true));
      const allSchedules = await storage.getAllSchedules(thirtyDaysAgo, now);
      const allTasks = await storage.getAllTasks();

      const userRateMap = new Map<string, number>();
      allUsers.forEach(u => {
        userRateMap.set(u.id, parseFloat(u.hourlyRate || '15'));
      });

      const dayMap = new Map<string, { totalHours: number; totalCost: number; employees: Set<string> }>();
      for (let d = new Date(thirtyDaysAgo); d <= now; d.setDate(d.getDate() + 1)) {
        const key = d.toISOString().split('T')[0];
        dayMap.set(key, { totalHours: 0, totalCost: 0, employees: new Set() });
      }

      allTimeEntries.forEach(entry => {
        if (!entry.clockOutTime) return;
        const clockIn = new Date(entry.clockInTime);
        const clockOut = new Date(entry.clockOutTime);
        const hours = Math.max(0, (clockOut.getTime() - clockIn.getTime()) / 3600000 - (entry.breakMinutes || 0) / 60);
        const dateKey = clockIn.toISOString().split('T')[0];
        const rate = userRateMap.get(entry.userId) || 15;
        const dayData = dayMap.get(dateKey);
        if (dayData) {
          dayData.totalHours += hours;
          dayData.totalCost += hours * rate;
          dayData.employees.add(entry.userId);
        }
      });

      const laborCostByDay = Array.from(dayMap.entries())
        .map(([date, data]) => ({
          date,
          totalHours: Math.round(data.totalHours * 100) / 100,
          totalCost: Math.round(data.totalCost * 100) / 100,
          employeeCount: data.employees.size,
        }))
        .sort((a, b) => a.date.localeCompare(b.date));

      let onTime = 0;
      let late = 0;
      const scheduleMap = new Map<string, Date[]>();
      allSchedules.forEach(s => {
        const key = `${s.userId}_${new Date(s.startTime).toISOString().split('T')[0]}`;
        if (!scheduleMap.has(key)) scheduleMap.set(key, []);
        scheduleMap.get(key)!.push(new Date(s.startTime));
      });

      allTimeEntries.forEach(entry => {
        const clockIn = new Date(entry.clockInTime);
        const key = `${entry.userId}_${clockIn.toISOString().split('T')[0]}`;
        const scheduledStarts = scheduleMap.get(key);
        if (scheduledStarts && scheduledStarts.length > 0) {
          const closest = scheduledStarts.reduce((prev, curr) =>
            Math.abs(curr.getTime() - clockIn.getTime()) < Math.abs(prev.getTime() - clockIn.getTime()) ? curr : prev
          );
          const diffMinutes = (clockIn.getTime() - closest.getTime()) / 60000;
          if (diffMinutes <= 5) {
            onTime++;
          } else {
            late++;
          }
        }
      });

      const punctualityTotal = onTime + late;
      const punctualityScore = {
        onTime,
        late,
        total: punctualityTotal,
        percentage: punctualityTotal > 0 ? Math.round((onTime / punctualityTotal) * 100) : 100,
      };

      const weekTasks = allTasks.filter(t => {
        const created = new Date(t.createdAt!);
        return created >= weekStart;
      });
      const completedTasks = weekTasks.filter(t => t.status === 'completed').length;
      const taskCompletion = {
        completed: completedTasks,
        total: weekTasks.length,
        percentage: weekTasks.length > 0 ? Math.round((completedTasks / weekTasks.length) * 100) : 0,
      };

      const activeEntries = allTimeEntries.filter(e => !e.clockOutTime);
      const todayEntries = allTimeEntries.filter(e => {
        const clockIn = new Date(e.clockInTime);
        return clockIn >= todayStart && clockIn <= todayEnd;
      });
      let totalHoursToday = 0;
      todayEntries.forEach(e => {
        const clockIn = new Date(e.clockInTime);
        const clockOut = e.clockOutTime ? new Date(e.clockOutTime) : now;
        totalHoursToday += Math.max(0, (clockOut.getTime() - clockIn.getTime()) / 3600000 - (e.breakMinutes || 0) / 60);
      });

      const todayTasks = allTasks.filter(t => {
        if (!t.completedAt) return false;
        const completed = new Date(t.completedAt);
        return completed >= todayStart && completed <= todayEnd;
      });

      const teamSummary = {
        activeNow: activeEntries.length,
        totalHoursToday: Math.round(totalHoursToday * 10) / 10,
        tasksCompletedToday: todayTasks.length,
        totalEmployees: allUsers.length,
      };

      res.json({ laborCostByDay, punctualityScore, taskCompletion, teamSummary });
    } catch (error) {
      console.error("Error fetching analytics dashboard:", error);
      res.status(500).json({ message: "Failed to fetch analytics data" });
    }
  });

  const httpServer = createServer(app);

  const wss = new WebSocketServer({ server: httpServer, path: '/ws' });

  wss.on('connection', async (ws: WebSocket, request) => {
    const url = new URL(request.url!, `http://${request.headers.host}`);
    const userId = url.searchParams.get('userId');

    if (!userId) {
      ws.close(4001, 'Missing userId');
      return;
    }

    try {
      const user = await storage.getUser(userId);
      if (!user) {
        ws.close(4003, 'User not found');
        return;
      }
    } catch {
      ws.close(4003, 'Auth verification failed');
      return;
    }

    wsConnections.set(userId, ws);
    console.log(`WebSocket connected for user: ${userId}`);

    ws.on('close', () => {
      wsConnections.delete(userId);
      console.log(`WebSocket disconnected for user: ${userId}`);
    });

    ws.on('error', (error) => {
      console.error('WebSocket error:', error);
    });
  });

  function broadcastToAll(data: any) {
    wsConnections.forEach((ws, userId) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(data));
      }
    });
  }

  return httpServer;
}
