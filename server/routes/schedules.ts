import type { Express } from "express";
import type { IStorage } from "../storage";
import { insertScheduleSchema } from "@shared/schema";
import { notificationService } from "../services/notificationService";
import { claudeService } from "../services/claudeService";

export function registerScheduleRoutes(app: Express, storage: IStorage, isAuthenticated: any, broadcastToAll: (data: any) => void) {
  app.post('/api/schedules', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const companyId = req.user?.companyId;
      const body = { ...req.body, createdBy: userId, ...(companyId ? { companyId } : {}) };
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

      const companyId = req.user?.companyId;
      let schedules;
      const userPermissions = await storage.getUserPermissions(userId);
      const canViewAll = userPermissions.some(p => p.name === 'schedule.view_all');
      
      if (canViewAll) {
        schedules = await storage.getAllSchedules(startDate, endDate, companyId);
      } else {
        schedules = await storage.getUserSchedules(userId, companyId, startDate, endDate);
      }

      res.json(schedules);
    } catch (error) {
      console.error("Error fetching schedules:", error);
      res.status(500).json({ message: "Failed to fetch schedules" });
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
      const companyId = req.user?.companyId;
      const existing = await storage.getSchedule(req.params.id, companyId);
      if (!existing) {
        return res.status(404).json({ message: "Schedule not found" });
      }
      await storage.deleteSchedule(req.params.id, companyId);
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
      
      const companyId = req.user?.companyId;
      if (!companyId) return res.status(403).json({ message: "Company context required" });
      const availabilityData = await storage.getAllAvailabilityForPeriod(payrollPeriodId, companyId);
      
      const allUsers = await storage.getAllUsers(companyId);
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
        ...(companyId ? { companyId } : {}),
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
