import type { Express } from "express";
import { createServer, type Server } from "http";
import { WebSocketServer, WebSocket } from "ws";
import { storage } from "./storage";
import { setupAuth, isAuthenticated } from "./replitAuth";
import { users } from "@shared/schema";
import { eq } from "drizzle-orm";
import { db } from "./db";
import { claudeService } from "./services/claudeService";
import { notificationService } from "./services/notificationService";
import { geofencingService } from "./services/geofencingService";
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
} from "@shared/schema";
import { z } from "zod";

// WebSocket connections map
const wsConnections = new Map<string, WebSocket>();

export async function registerRoutes(app: Express): Promise<Server> {
  // Auth middleware
  await setupAuth(app);

  // Auth routes
  app.get('/api/auth/user', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const user = await storage.getUser(userId);
      res.json(user);
    } catch (error) {
      console.error("Error fetching user:", error);
      res.status(500).json({ message: "Failed to fetch user" });
    }
  });

  app.get('/api/auth/permissions', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const permissions = await storage.getUserPermissions(userId);
      res.json(permissions);
    } catch (error) {
      console.error("Error fetching user permissions:", error);
      res.status(500).json({ message: "Failed to fetch user permissions" });
    }
  });

  // Time tracking routes
  app.post('/api/time-entries', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
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
      const userId = req.user.claims.sub;
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
      const userId = req.user.claims.sub;
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
      const updates = req.body;
      
      const timeEntry = await storage.updateTimeEntry(id, updates);
      
      // Broadcast update
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
      const userId = req.user.claims.sub;
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
      const userId = req.user.claims.sub;
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
      const userId = req.user.claims.sub;
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
      const userId = req.user.claims.sub;
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
      const updates = req.body;
      
      if (updates.status === 'completed' && !updates.completedAt) {
        updates.completedAt = new Date();
      }

      const task = await storage.updateTask(id, updates);
      
      // Broadcast update
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

  // AI routes
  app.post('/api/ai/assign-chores', isAuthenticated, async (req: any, res) => {
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

  app.post('/api/ai/chat', isAuthenticated, async (req: any, res) => {
    try {
      const { message } = req.body;
      const userId = req.user.claims.sub;
      
      // Get context for the AI
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

  // Availability routes
  app.post('/api/availability', isAuthenticated, async (req: any, res) => {
    try {
      const { availability } = req.body;
      const userId = req.user.claims.sub;
      
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
      const userId = req.user.claims.sub;
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
      const users = await storage.getUsers();
      
      // Transform availability data for AI processing
      const transformedData = availabilityData.map((avail: any) => {
        const user = users.find((u: any) => u.id === avail.userId);
        return {
          userId: avail.userId,
          userName: user ? `${user.firstName} ${user.lastName}` : 'Unknown User',
          role: user?.role || 'employee',
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

  // Location and geofencing routes
  app.post('/api/geofence/check', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
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
      const userId = req.user.claims.sub;
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
      const userId = req.user.claims.sub;
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

  // Push notification routes
  app.post('/api/push/subscribe', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const data = insertPushSubscriptionSchema.parse({ ...req.body, userId });
      
      const subscription = await storage.createPushSubscription(data);
      res.json(subscription);
    } catch (error) {
      console.error("Error creating push subscription:", error);
      res.status(400).json({ message: (error as Error).message });
    }
  });

  // Message/communication routes
  app.post('/api/messages', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
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
      const userId = req.user.claims.sub;
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
      const userId = req.user.claims.sub;
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
      const userId = req.user.claims.sub;
      const groups = await storage.getGroups(userId);
      res.json(groups);
    } catch (error) {
      console.error("Error fetching groups:", error);
      res.status(500).json({ message: "Failed to fetch groups" });
    }
  });

  app.get('/api/groups/:groupId/messages', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
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
      const userId = req.user.claims.sub;
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
      const userId = req.user.claims.sub;
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
      const userId = req.user.claims.sub;
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
      const userId = req.user.claims.sub;
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
      const userId = req.user.claims.sub;
      const userPermissions = await storage.getUserPermissions(userId);
      const canManageRoles = userPermissions.some(p => p.name === 'admin.role_management');
      
      if (!canManageRoles) {
        return res.status(403).json({ message: "Permission denied: Role management access required" });
      }
      
      const { id } = req.params;
      const updates = req.body;
      
      const role = await storage.updateRole(id, updates);
      res.json(role);
    } catch (error) {
      console.error("Error updating role:", error);
      res.status(400).json({ message: (error as Error).message });
    }
  });

  app.delete('/api/roles/:id', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
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
      const userId = req.user.claims.sub;
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

  app.get('/api/roles/:id/permissions', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
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
      const userId = req.user.claims.sub;
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
      const userId = req.user.claims.sub;
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
      const requestingUserId = req.user.claims.sub;
      
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
      const userId = req.user.claims.sub;
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
      const userId = req.user.claims.sub;
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
      const userId = req.user.claims.sub;
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
      const currentUserId = req.user.claims.sub;
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
      const currentUserId = req.user.claims.sub;
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
      const currentUserId = req.user.claims.sub;
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

  const httpServer = createServer(app);

  // WebSocket setup for real-time features
  const wss = new WebSocketServer({ server: httpServer, path: '/ws' });

  wss.on('connection', (ws: WebSocket, request) => {
    const url = new URL(request.url!, `http://${request.headers.host}`);
    const userId = url.searchParams.get('userId');
    
    if (userId) {
      wsConnections.set(userId, ws);
      console.log(`WebSocket connected for user: ${userId}`);
    }

    ws.on('close', () => {
      if (userId) {
        wsConnections.delete(userId);
        console.log(`WebSocket disconnected for user: ${userId}`);
      }
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
