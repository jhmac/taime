import type { Express } from "express";
import type { IStorage } from "../storage";
import { resolvePermission, resolveAnyPermission } from "../services/permissionResolver";

const DEFAULT_SCORE_SETTINGS = [
  { eventType: 'shift-start', category: 'attendance', displayName: 'On-Time Clock In', pointValue: 10 },
  { eventType: 'late-clock-in', category: 'attendance', displayName: 'Late Clock In', pointValue: -5 },
  { eventType: 'excessive-late', category: 'attendance', displayName: 'Excessively Late Clock In', pointValue: -15 },
  { eventType: 'shift-end', category: 'attendance', displayName: 'Normal Clock Out', pointValue: 0 },
  { eventType: 'early-clockout', category: 'attendance', displayName: 'Early Clock Out', pointValue: -10 },
  { eventType: 'app-switch-out', category: 'attendance', displayName: 'Phone Use (App Switch)', pointValue: -10 },
  { eventType: 'auto-resume', category: 'attendance', displayName: 'Quick Return (Auto Resume)', pointValue: 0 },
  { eventType: 'prompted-resume', category: 'attendance', displayName: 'Prompted Clock Back In', pointValue: -5 },
  { eventType: 'geofence-prompt-in', category: 'attendance', displayName: 'Geofence Auto Clock In', pointValue: 5 },
  { eventType: 'geofence-exit-out', category: 'attendance', displayName: 'Left Work Area', pointValue: -10 },
  { eventType: 'geofence-denied', category: 'attendance', displayName: 'Clock In Denied (Outside Area)', pointValue: -5 },
  { eventType: 'auto-timeout-out', category: 'attendance', displayName: 'Auto Clock Out (Timeout)', pointValue: -5 },
  { eventType: 'manager-clock-in', category: 'attendance', displayName: 'Manager Clock In', pointValue: 0 },
  { eventType: 'manager-clock-out', category: 'attendance', displayName: 'Manager Clock Out', pointValue: 0 },
  { eventType: 'full-shift-bonus', category: 'attendance', displayName: 'Full Shift No Interruptions', pointValue: 20 },
  { eventType: 'break-start', category: 'breaks', displayName: 'Break Started', pointValue: 0 },
  { eventType: 'break-end-on-time', category: 'breaks', displayName: 'Break Returned On Time', pointValue: 5 },
  { eventType: 'break-overrun', category: 'breaks', displayName: 'Break Overrun', pointValue: -5 },
  { eventType: 'task-completed-on-time', category: 'tasks', displayName: 'Task Completed On Time', pointValue: 10 },
  { eventType: 'task-completed-late', category: 'tasks', displayName: 'Task Completed Late', pointValue: 5 },
  { eventType: 'task-overdue', category: 'tasks', displayName: 'Task Overdue', pointValue: -10 },
  { eventType: 'chore-completed', category: 'chores', displayName: 'Chore Completed', pointValue: 10 },
  { eventType: 'chore-missed', category: 'chores', displayName: 'Chore Missed', pointValue: -10 },
  { eventType: 'availability-submitted', category: 'availability', displayName: 'Availability Submitted Promptly', pointValue: 5 },
  { eventType: 'availability-late', category: 'availability', displayName: 'Late Availability Submission', pointValue: -5 },
];

export function registerClockEventRoutes(app: Express, storage: IStorage, isAuthenticated: any) {
  app.post('/api/clock-events', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const { eventType, timeEntryId, metadata } = req.body;

      if (!eventType) {
        return res.status(400).json({ message: "eventType is required" });
      }

      const scoreSettings = await storage.getPerformanceScoreSettings();
      let pointValue = 0;
      const setting = scoreSettings.find(s => s.eventType === eventType);
      if (setting && setting.isActive) {
        pointValue = setting.pointValue;
      } else {
        const defaultSetting = DEFAULT_SCORE_SETTINGS.find(s => s.eventType === eventType);
        if (defaultSetting) {
          pointValue = defaultSetting.pointValue;
        }
      }

      const event = await storage.createClockEvent({
        userId,
        timeEntryId: timeEntryId || null,
        eventType,
        pointValue,
        metadata: metadata || null,
      });

      res.json(event);
    } catch (error) {
      console.error("Error creating clock event:", error);
      res.status(500).json({ message: "Failed to create clock event" });
    }
  });

  app.get('/api/clock-events', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const canViewAll = await resolveAnyPermission(userId, ['admin.manage_all', 'hr.view_team'], storage);

      const startDate = req.query.startDate ? new Date(req.query.startDate as string) : undefined;
      const endDate = req.query.endDate ? new Date(req.query.endDate as string) : undefined;
      const targetUserId = req.query.userId as string;

      let events;
      if (canViewAll && targetUserId) {
        events = await storage.getClockEvents(targetUserId, startDate, endDate);
      } else if (canViewAll) {
        events = await storage.getAllClockEvents(startDate, endDate);
      } else {
        events = await storage.getClockEvents(userId, startDate, endDate);
      }

      res.json(events);
    } catch (error) {
      console.error("Error fetching clock events:", error);
      res.status(500).json({ message: "Failed to fetch clock events" });
    }
  });

  app.get('/api/performance/scores', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const canViewAll = await resolveAnyPermission(userId, ['admin.manage_all', 'hr.view_team'], storage);

      const startDate = req.query.startDate ? new Date(req.query.startDate as string) : undefined;
      const endDate = req.query.endDate ? new Date(req.query.endDate as string) : undefined;

      if (!canViewAll) {
        const events = await storage.getClockEvents(userId, startDate, endDate);
        const totalPoints = events.reduce((sum, e) => sum + (e.pointValue || 0), 0);
        return res.json([{ userId, totalPoints, eventCount: events.length }]);
      }

      const scores = await storage.getPerformanceScores(startDate, endDate);
      res.json(scores);
    } catch (error) {
      console.error("Error fetching performance scores:", error);
      res.status(500).json({ message: "Failed to fetch performance scores" });
    }
  });

  app.get('/api/performance/scores/:userId', isAuthenticated, async (req: any, res) => {
    try {
      const requestingUserId = req.user.id;
      const targetUserId = req.params.userId;
      const canViewAll = await resolveAnyPermission(requestingUserId, ['admin.manage_all', 'hr.view_team'], storage);

      if (!canViewAll && requestingUserId !== targetUserId) {
        return res.status(403).json({ message: "Access denied" });
      }

      const startDate = req.query.startDate ? new Date(req.query.startDate as string) : undefined;
      const endDate = req.query.endDate ? new Date(req.query.endDate as string) : undefined;

      const events = await storage.getClockEvents(targetUserId, startDate, endDate);

      const categoryBreakdown: Record<string, { points: number; count: number }> = {};
      let totalPoints = 0;

      for (const event of events) {
        totalPoints += event.pointValue || 0;
        const defaultSetting = DEFAULT_SCORE_SETTINGS.find(s => s.eventType === event.eventType);
        const category = defaultSetting?.category || 'other';
        if (!categoryBreakdown[category]) {
          categoryBreakdown[category] = { points: 0, count: 0 };
        }
        categoryBreakdown[category].points += event.pointValue || 0;
        categoryBreakdown[category].count += 1;
      }

      res.json({
        userId: targetUserId,
        totalPoints,
        eventCount: events.length,
        categoryBreakdown,
        recentEvents: events.slice(0, 50),
      });
    } catch (error) {
      console.error("Error fetching user performance:", error);
      res.status(500).json({ message: "Failed to fetch performance data" });
    }
  });

  app.get('/api/performance/settings', isAuthenticated, async (req: any, res) => {
    try {
      let settings = await storage.getPerformanceScoreSettings();
      const existingKeys = new Set(settings.map(s => s.eventType));
      const missingDefaults = DEFAULT_SCORE_SETTINGS.filter(s => !existingKeys.has(s.eventType));
      if (settings.length === 0 || missingDefaults.length > 0) {
        const toSeed = settings.length === 0 ? DEFAULT_SCORE_SETTINGS : missingDefaults;
        for (const setting of toSeed) {
          await storage.upsertPerformanceScoreSetting({
            ...setting,
            isActive: true,
          });
        }
        settings = await storage.getPerformanceScoreSettings();
      }
      res.json(settings);
    } catch (error) {
      console.error("Error fetching performance settings:", error);
      res.status(500).json({ message: "Failed to fetch performance settings" });
    }
  });

  app.put('/api/performance/settings', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const canManage = await resolvePermission(userId, 'admin.manage_all', storage);

      if (!canManage) {
        return res.status(403).json({ message: "Admin access required" });
      }

      const { settings } = req.body;
      if (!Array.isArray(settings)) {
        return res.status(400).json({ message: "settings must be an array" });
      }

      const updated = [];
      for (const setting of settings) {
        const result = await storage.upsertPerformanceScoreSetting({
          eventType: setting.eventType,
          category: setting.category,
          displayName: setting.displayName,
          pointValue: setting.pointValue,
          isActive: setting.isActive ?? true,
          updatedBy: userId,
        });
        updated.push(result);
      }

      res.json(updated);
    } catch (error) {
      console.error("Error updating performance settings:", error);
      res.status(500).json({ message: "Failed to update performance settings" });
    }
  });
}
