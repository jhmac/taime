import type { Express } from "express";
import type { IStorage } from "../storage";
import { insertScheduleSchema, users, messageThreads, threadParticipants, threadMessages } from "@shared/schema";
import { eq, and, inArray } from "drizzle-orm";
import { db } from "../db";
import { notificationService } from "../services/notificationService";
import { claudeService } from "../services/claudeService";
import { tryResolveStoreIdForUser } from "../lib/storeResolver";

export function registerScheduleRoutes(
  app: Express,
  storage: IStorage,
  isAuthenticated: any,
  broadcastToAll: (data: any) => void,
  sendToUsers: (userIds: string[], data: Record<string, unknown>) => void,
) {
  app.post('/api/schedules', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const body = { ...req.body, createdBy: userId };
      if (body.startTime && typeof body.startTime === 'string') {
        body.startTime = new Date(body.startTime);
      }
      if (body.endTime && typeof body.endTime === 'string') {
        body.endTime = new Date(body.endTime);
      }
      const data = insertScheduleSchema.parse(body);
      
      const schedule = await storage.createSchedule(data);
      
      if (data.userId !== userId) {
        await notificationService.sendScheduleUpdate(
          data.userId,
          `New shift scheduled: ${schedule.title || 'Shift'} on ${new Date(schedule.startTime).toLocaleDateString()}`
        );
      }

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
        const locationId = await tryResolveStoreIdForUser(userId);
        schedules = await storage.getAllSchedules(startDate, endDate, locationId || undefined);
      } else {
        schedules = await storage.getUserSchedules(userId, startDate, endDate);
      }

      res.json(schedules);
    } catch (error) {
      console.error("Error fetching schedules:", error);
      res.status(500).json({ message: "Failed to fetch schedules" });
    }
  });

  app.patch('/api/schedules/:id', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const userPermissions = await storage.getUserPermissions(userId);
      const canManage = userPermissions.some(p => p.name === 'admin.manage_all' || p.name === 'schedule.manage');
      if (!canManage) return res.status(403).json({ message: "Permission denied" });

      const body = { ...req.body };
      if (body.startTime && typeof body.startTime === 'string') body.startTime = new Date(body.startTime);
      if (body.endTime && typeof body.endTime === 'string') body.endTime = new Date(body.endTime);

      const updated = await storage.updateSchedule(req.params.id, body);
      broadcastToAll({ type: 'schedule_updated', data: { schedule: updated } });
      res.json(updated);
    } catch (error) {
      console.error("Error updating schedule:", error);
      res.status(400).json({ message: (error as Error).message });
    }
  });

  app.post('/api/schedules/notify-week', isAuthenticated, async (req: any, res) => {
    try {
      const adminId = req.user.id;
      const userPermissions = await storage.getUserPermissions(adminId);
      const canManage = userPermissions.some(p => p.name === 'admin.manage_all' || p.name === 'schedule.manage');
      if (!canManage) return res.status(403).json({ message: "Permission denied" });

      const { startDate, endDate } = req.body;
      if (!startDate || !endDate) return res.status(400).json({ message: "startDate and endDate required" });

      const locationId = await tryResolveStoreIdForUser(adminId);
      const storeId = locationId || 'default';

      const weekSchedules = await storage.getAllSchedules(
        new Date(startDate),
        new Date(endDate),
        locationId || undefined
      );

      if (weekSchedules.length === 0) return res.json({ sent: 0, message: "No shifts found for that week" });

      // Group shifts by employee (include everyone, including the admin)
      const byUser: Record<string, typeof weekSchedules> = {};
      for (const s of weekSchedules) {
        if (!byUser[s.userId]) byUser[s.userId] = [];
        byUser[s.userId].push(s);
      }

      const formatShift = (s: any) => {
        const day = new Date(s.startTime).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
        const start = new Date(s.startTime).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
        const end = new Date(s.endTime).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
        return `${day}: ${start}–${end}`;
      };

      // Helper: find or create a DM thread between admin and employee
      const findOrCreateDmThread = async (empUserId: string): Promise<string> => {
        // Find existing DM thread between these two users
        const existingThreads = await db
          .select({ threadId: threadParticipants.threadId })
          .from(threadParticipants)
          .where(eq(threadParticipants.userId, adminId));

        const adminThreadIds = existingThreads.map(t => t.threadId);

        if (adminThreadIds.length > 0) {
          const empThreads = await db
            .select({ threadId: threadParticipants.threadId })
            .from(threadParticipants)
            .where(
              and(
                eq(threadParticipants.userId, empUserId),
                inArray(threadParticipants.threadId, adminThreadIds)
              )
            );

          // Find a direct (non-group) thread shared by both
          const sharedIds = empThreads.map(t => t.threadId);
          if (sharedIds.length > 0) {
            const directThread = await db
              .select()
              .from(messageThreads)
              .where(
                and(
                  inArray(messageThreads.id, sharedIds),
                  eq(messageThreads.threadType, 'direct')
                )
              )
              .limit(1);

            if (directThread.length > 0) return directThread[0].id;
          }
        }

        // Create new DM thread
        const [thread] = await db.insert(messageThreads).values({
          storeId,
          threadType: 'direct',
          createdBy: adminId,
        }).returning();

        await db.insert(threadParticipants).values([
          { threadId: thread.id, userId: adminId },
          { threadId: thread.id, userId: empUserId },
        ]);

        return thread.id;
      };

      let sent = 0;
      await Promise.all(Object.entries(byUser).map(async ([empUserId, empShifts]) => {
        const shiftLines = empShifts
          .sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime())
          .map(formatShift);

        const messageBody = `📅 Your schedule for the week:\n${shiftLines.map(l => `• ${l}`).join('\n')}`;

        try {
          // 1. Send in-app DM (guaranteed delivery)
          const threadId = await findOrCreateDmThread(empUserId);
          const [msg] = await db.insert(threadMessages).values({
            threadId,
            senderId: adminId,
            content: messageBody,
            messageType: 'text',
          }).returning();

          // Update thread updatedAt
          await db
            .update(messageThreads)
            .set({ updatedAt: new Date() })
            .where(eq(messageThreads.id, threadId));

          // Send only to the two DM participants so message content stays private
          sendToUsers([adminId, empUserId], {
            type: 'new_message',
            data: {
              threadId,
              message: msg,
              targetUserId: empUserId,
            },
          });

          // 2. Also attempt push notification (bonus — silent if no subscription)
          notificationService.sendScheduleUpdate(empUserId, shiftLines.join(', ')).catch(() => {});

          sent++;
        } catch (err) {
          console.error(`Failed to notify user ${empUserId}:`, err);
        }
      }));

      res.json({ sent, message: `Notified ${sent} team member${sent !== 1 ? 's' : ''}.` });
    } catch (error) {
      console.error("Error notifying team:", error);
      res.status(500).json({ message: "Failed to notify team" });
    }
  });

  app.delete('/api/schedules/:id', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const userPermissions = await storage.getUserPermissions(userId);
      const canManage = userPermissions.some(p => p.name === 'admin.manage_all' || p.name === 'schedule.manage');
      if (!canManage) {
        return res.status(403).json({ message: "Permission denied" });
      }
      await storage.deleteSchedule(req.params.id);
      broadcastToAll({ type: 'schedule_deleted', data: { scheduleId: req.params.id } });
      res.json({ success: true });
    } catch (error) {
      console.error("Error deleting schedule:", error);
      res.status(500).json({ message: "Failed to delete schedule" });
    }
  });

  app.post('/api/schedules/create-from-availability', isAuthenticated, async (req: any, res) => {
    try {
      const { payrollPeriodId, businessHours, constraints } = req.body;
      
      const availabilityData = await storage.getAllAvailabilityForPeriod(payrollPeriodId);
      
      const allUsers = await db.select().from(users).where(eq(users.isActive, true));
      const userMap = new Map(allUsers.map((u: any) => [u.id, u]));
      
      const transformedData = availabilityData.map((avail: any) => {
        const user = userMap.get(avail.userId);
        return {
          userId: avail.userId,
          userName: user ? `${user.firstName} ${user.lastName}` : 'Unknown User',
          role: user?.roleId || 'employee',
          hourlyRate: 15.00,
          date: avail.date.toISOString().split('T')[0],
          timeSlot: avail.timeSlot,
          isAvailable: avail.isAvailable,
        };
      });

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

      const schedulesToCreate = result.schedule.map((scheduleItem: any) => ({
        userId: scheduleItem.userId,
        startTime: new Date(`${scheduleItem.date}T${scheduleItem.startTime}`),
        endTime: new Date(`${scheduleItem.date}T${scheduleItem.endTime}`),
        location: 'Main Location',
        notes: scheduleItem.reasoning,
      }));

      const created = await storage.createSchedulesBatch(schedulesToCreate);

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
}
