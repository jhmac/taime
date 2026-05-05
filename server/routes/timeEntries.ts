import type { Express } from "express";
import type { IStorage } from "../storage";
import { insertTimeEntrySchema } from "@shared/schema";
import { geofencingService } from "../services/geofencingService";
import { getOpeningSOPsForClockIn, getShiftHandoffSOPs } from "../services/sopSurfacing";
import { runClockInRedistribute, activateDeferredPins } from "./ai";
import logger from "../lib/logger";
import { getUserIdsWithPermission } from "../lib/permissionUtils";
import { computeTimeEntryRecipients } from "../lib/broadcastRecipients";
import { resolvePermission, resolveAnyPermission } from "../services/permissionResolver";
import { cache } from "../services/cache";

async function withRetry<T>(fn: () => Promise<T>, retries = 2, delay = 500): Promise<T> {
  for (let i = 0; i <= retries; i++) {
    try {
      return await fn();
    } catch (err: any) {
      const isTransient = err?.message?.includes('EAI_AGAIN') ||
        err?.message?.includes('ECONNREFUSED') ||
        err?.message?.includes('ECONNRESET') ||
        err?.message?.includes('ETIMEDOUT') ||
        err?.code === 'ECONNREFUSED';
      if (i < retries && isTransient) {
        console.warn(`Transient DB error, retrying (${i + 1}/${retries}):`, err.message);
        await new Promise(r => setTimeout(r, delay * (i + 1)));
        continue;
      }
      throw err;
    }
  }
  throw new Error('Retry exhausted');
}

export function registerTimeEntryRoutes(
  app: Express,
  storage: IStorage,
  isAuthenticated: any,
  broadcastToAll: (data: any) => void,
  sendToUsers: (userIds: string[], data: Record<string, unknown>) => void,
) {
  app.post('/api/time-entries', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const body = { ...req.body, userId };
      if (typeof body.clockInTime === 'string') body.clockInTime = new Date(body.clockInTime);
      if (typeof body.clockOutTime === 'string') body.clockOutTime = new Date(body.clockOutTime);
      const data = insertTimeEntrySchema.parse(body);
      
      // Prevent double clock-in: reject if user already has an open entry
      if (!data.clockOutTime) {
        const existingActive = await storage.getActiveTimeEntry(userId);
        if (existingActive) {
          return res.status(409).json({ message: "You are already clocked in. Please clock out before clocking in again." });
        }
      }

      const allWorkLocations = await withRetry(() => storage.getAllWorkLocations());
      const hasActiveLocations = allWorkLocations.some(loc => loc.isActive && (loc as any).geofenceEnabled !== false);
      
      if (data.clockInTime && hasActiveLocations) {
        if (!req.body.latitude || !req.body.longitude) {
          return res.status(400).json({ message: "Location is required to clock in. Please enable location services." });
        }
        const validation = await geofencingService.validateClockInLocation(
          userId,
          req.body.latitude,
          req.body.longitude
        );
        
        if (!validation.isValid) {
          return res.status(400).json({ message: validation.error });
        }
        
        if (validation.location && !data.locationId) {
          (data as any).locationId = validation.location.id;
        }
      }

      const timeEntry = await withRetry(() => storage.createTimeEntry(data));

      cache.invalidate(`dashboard:init:${userId}`);

      const timeEntryRecipients = await computeTimeEntryRecipients(userId, getUserIdsWithPermission);
      sendToUsers(timeEntryRecipients, {
        type: 'time_entry_created',
        data: { timeEntry, userId },
      });

      // Fire-and-forget: on clock-in, activate deferred manual pins for this employee
      // and redistribute AI-assigned tasks equally across clocked-in staff.
      if (!data.clockOutTime) {
        // Activate any tasks a manager pinned to this employee while they were off-shift
        activateDeferredPins(userId, storage, broadcastToAll).catch((err: any) =>
          logger.warn({ error: err?.message }, '[TaskPin] deferred pin activation failed')
        );
        storage.getCompanySettings().then(settings => {
          if (settings?.taskAutoAssign) {
            runClockInRedistribute(storage, broadcastToAll).catch((err: any) =>
              logger.warn({ error: err?.message }, '[TaskRedistribute] clock-in redistribution failed')
            );
          }
        }).catch(() => {});
      }

      const locationId = (timeEntry as any).locationId;
      if (locationId) {
        try {
          const [openingSOPs, handoffSOPs] = await Promise.all([
            getOpeningSOPsForClockIn(userId, locationId),
            getShiftHandoffSOPs(userId, locationId),
          ]);
          const surfacedSOPs = [...openingSOPs, ...handoffSOPs];
          if (surfacedSOPs.length > 0) {
            logger.info(
              { userId, sopCount: surfacedSOPs.length, trigger: "clock_in" },
              "SOP surfacing: clock-in triggered"
            );
            sendToUsers([userId], {
              type: "sop_surfaced",
              data: { sops: surfacedSOPs, trigger: "clock_in", userId },
            });
          }
        } catch (err: any) {
          logger.error({ error: err.message }, "SOP surfacing error on clock-in");
        }
      }

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
      const canViewAll = await resolvePermission(userId, 'time.view_all', storage);
      
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

  // GET /api/time-entries/my-summary — today, week, and period hours plus approximate pay for the current user
  app.get('/api/time-entries/my-summary', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const user = await storage.getUser(userId);
      const now = new Date();

      // today's entries
      const todayStart = new Date(now);
      todayStart.setHours(0, 0, 0, 0);
      const todayEnd = new Date(now);
      todayEnd.setHours(23, 59, 59, 999);
      const todayEntries = await storage.getUserTimeEntries(userId, todayStart, todayEnd);

      // this week (Sunday start)
      const weekStart = new Date(now);
      weekStart.setDate(now.getDate() - now.getDay());
      weekStart.setHours(0, 0, 0, 0);
      const weekEntries = await storage.getUserTimeEntries(userId, weekStart);

      // current pay period — use payroll settings if available, else default biweekly
      let periodStart: Date;
      let periodEnd: Date;
      try {
        // PayPeriodSettings was reshaped — `nextPeriodStart`/`frequency` no
        // longer exist on the row, so this `try` branch is effectively a
        // no-op fallback today and the catch path drives the calculation.
        // Cast to any preserves the original lookup behaviour: when the
        // expected fields are missing, the throw below falls through to the
        // anchored biweekly default below.
        const settings = (await storage.getPayPeriodSettings()) as any;
        if (settings?.nextPeriodStart) {
          // Walk back from nextPeriodStart to find the period that contains today
          const freq = settings.frequency || 'biweekly';
          const periodDays = freq === 'weekly' ? 7 : freq === 'semimonthly' ? 15 : 14;
          const next = new Date(settings.nextPeriodStart);
          periodEnd = new Date(next);
          periodEnd.setDate(periodEnd.getDate() - 1);
          periodStart = new Date(periodEnd);
          periodStart.setDate(periodStart.getDate() - (periodDays - 1));
          // Ensure today is within this period; if not, adjust by one period back
          if (now < periodStart) {
            periodEnd = new Date(periodStart);
            periodEnd.setDate(periodEnd.getDate() - 1);
            periodStart = new Date(periodEnd);
            periodStart.setDate(periodStart.getDate() - (periodDays - 1));
          }
        } else {
          throw new Error('no settings');
        }
      } catch {
        // Fallback: biweekly starting from a fixed anchor (2025-01-05)
        const anchor = new Date('2025-01-05T00:00:00.000Z');
        const msSinceAnchor = now.getTime() - anchor.getTime();
        const periodIndex = Math.floor(msSinceAnchor / (14 * 24 * 60 * 60 * 1000));
        periodStart = new Date(anchor.getTime() + periodIndex * 14 * 24 * 60 * 60 * 1000);
        periodEnd = new Date(periodStart.getTime() + 14 * 24 * 60 * 60 * 1000 - 1);
      }

      const periodEntries = await storage.getUserTimeEntries(userId, periodStart, periodEnd);

      function sumHours(entries: any[]): number {
        let totalMs = 0;
        for (const e of entries) {
          const start = new Date(e.clockInTime);
          const end = e.clockOutTime ? new Date(e.clockOutTime) : now;
          const breakMs = (e.breakMinutes || 0) * 60 * 1000;
          totalMs += Math.max(0, end.getTime() - start.getTime() - breakMs);
        }
        return totalMs / (1000 * 60 * 60);
      }

      const todayHours = sumHours(todayEntries);
      const weekHours = sumHours(weekEntries);
      const periodHours = sumHours(periodEntries);
      const hourlyRate = user?.hourlyRate ? parseFloat(user.hourlyRate as string) : null;
      const approximatePay = hourlyRate != null ? (() => {
        const reg = Math.min(40, periodHours);
        const ot = Math.max(0, periodHours - 40);
        return reg * hourlyRate + ot * hourlyRate * 1.5;
      })() : null;

      res.json({ todayHours, weekHours, periodHours, hourlyRate, approximatePay });
    } catch (error) {
      console.error('Error fetching my hours summary:', error);
      res.status(500).json({ message: 'Failed to fetch hours summary' });
    }
  });

  app.get('/api/time-entries/active', isAuthenticated, async (req: any, res) => {
    try {
      res.setHeader('Cache-Control', 'no-store');
      const userId = req.user.id;
      const activeEntry = await storage.getActiveTimeEntry(userId);
      res.json(activeEntry || null);
    } catch (error) {
      console.error("Error fetching active time entry:", error);
      res.status(500).json({ message: "Failed to fetch active time entry" });
    }
  });

  app.get('/api/time-entries/:id/history', isAuthenticated, async (req: any, res) => {
    try {
      const { id } = req.params;
      const existing = await storage.getTimeEntry(id);
      if (!existing) {
        return res.status(404).json({ message: "Time entry not found" });
      }

      const userId = req.user.id;
      const isManager = await resolveAnyPermission(userId, ['time.approve', 'admin.manage_all'], storage);
      const isOwner = existing.userId === userId;

      if (!isOwner && !isManager) {
        return res.status(403).json({ message: "You can only view history for your own time entries" });
      }

      const edits = await storage.getTimeEntryEdits(id);
      res.json(edits);
    } catch (error) {
      console.error("Error fetching time entry history:", error);
      res.status(500).json({ message: "Failed to fetch time entry history" });
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

      const isManager = await resolveAnyPermission(userId, ['time.approve', 'admin.manage_all'], storage);
      const isOwner = existing.userId === userId;

      if (!isOwner && !isManager) {
        return res.status(403).json({ message: "You can only edit your own time entries" });
      }

      const allowedFields = isManager
        ? ['clockInTime', 'clockOutTime', 'breakMinutes', 'notes', 'locationId', 'isApproved', 'status', 'clockInSource', 'clockOutSource']
        : ['clockOutTime', 'breakMinutes', 'notes', 'clockInSource', 'clockOutSource'];

      const safeUpdates: Record<string, any> = {};
      for (const key of allowedFields) {
        if (Object.hasOwn(req.body, key) && req.body[key] !== undefined) {
          safeUpdates[key] = req.body[key];
        }
      }
      if (typeof safeUpdates.clockOutTime === 'string') safeUpdates.clockOutTime = new Date(safeUpdates.clockOutTime);
      if (typeof safeUpdates.clockInTime === 'string') safeUpdates.clockInTime = new Date(safeUpdates.clockInTime);

      if (safeUpdates.isApproved === true) {
        safeUpdates.approvedBy = userId;
      }

      const editReason = req.body.editReason || null;
      const auditPromises: Promise<any>[] = [];
      for (const key of Object.keys(safeUpdates)) {
        const oldVal = (existing as any)[key];
        const newVal = safeUpdates[key];
        const oldStr = oldVal instanceof Date ? oldVal.toISOString() : oldVal != null ? String(oldVal) : null;
        const newStr = newVal instanceof Date ? newVal.toISOString() : newVal != null ? String(newVal) : null;
        if (oldStr !== newStr) {
          auditPromises.push(
            storage.createTimeEntryEdit({
              timeEntryId: id,
              editedBy: userId,
              fieldChanged: key,
              oldValue: oldStr,
              newValue: newStr,
              reason: editReason,
            })
          );
        }
      }
      await Promise.all(auditPromises);

      const timeEntry = await storage.updateTimeEntry(id, safeUpdates);

      if (safeUpdates.clockOutTime) {
        try {
          const activeSessions = await storage.getOffsiteSessions({ userId: existing.userId, status: 'active' });
          for (const session of activeSessions) {
            await storage.updateOffsiteSession(session.id, {
              status: 'completed',
              returnTime: new Date(safeUpdates.clockOutTime),
            });
          }
        } catch (err: any) {
          logger.warn({ error: err?.message }, '[ClockOut] Failed to auto-end active offsite session (non-fatal)');
        }
      }

      cache.invalidate(`dashboard:init:${existing.userId}`);

      const timeEntryRecipients = await computeTimeEntryRecipients(existing.userId, getUserIdsWithPermission);
      sendToUsers(timeEntryRecipients, {
        type: 'time_entry_updated',
        data: { timeEntry },
      });

      res.json(timeEntry);
    } catch (error) {
      console.error("Error updating time entry:", error);
      res.status(400).json({ message: (error as Error).message });
    }
  });

  app.post('/api/time-entries/:id/break-start', isAuthenticated, async (req: any, res) => {
    try {
      const { id } = req.params;
      const userId = req.user.id;

      const existing = await storage.getTimeEntry(id);
      if (!existing) {
        return res.status(404).json({ message: "Time entry not found" });
      }
      if (existing.userId !== userId) {
        return res.status(403).json({ message: "You can only manage breaks on your own time entry" });
      }
      if (existing.clockOutTime) {
        return res.status(400).json({ message: "Cannot start a break on a completed time entry" });
      }
      if (existing.breakStartTime) {
        return res.status(409).json({ message: "A break is already in progress" });
      }

      const now = new Date();
      const timeEntry = await storage.updateTimeEntry(id, { breakStartTime: now });

      const timeEntryRecipients = await computeTimeEntryRecipients(userId, getUserIdsWithPermission);
      sendToUsers(timeEntryRecipients, {
        type: 'time_entry_updated',
        data: { timeEntry },
      });

      logBreakClockEvent(storage, userId, id, 'break-start', { breakStartTime: now.toISOString() });

      res.json(timeEntry);
    } catch (error) {
      console.error("Error starting break:", error);
      res.status(500).json({ message: (error as Error).message });
    }
  });

  app.post('/api/time-entries/:id/break-end', isAuthenticated, async (req: any, res) => {
    try {
      const { id } = req.params;
      const userId = req.user.id;

      const existing = await storage.getTimeEntry(id);
      if (!existing) {
        return res.status(404).json({ message: "Time entry not found" });
      }
      if (existing.userId !== userId) {
        return res.status(403).json({ message: "You can only manage breaks on your own time entry" });
      }
      if (existing.clockOutTime) {
        return res.status(400).json({ message: "Cannot end a break on a completed time entry" });
      }
      if (!existing.breakStartTime) {
        return res.status(400).json({ message: "No break is currently in progress" });
      }

      const now = new Date();
      const elapsedMinutes = Math.floor((now.getTime() - existing.breakStartTime.getTime()) / 60000);
      const newBreakMinutes = (existing.breakMinutes ?? 0) + elapsedMinutes;

      const companySettings = await storage.getCompanySettings();
      const rule1Minutes = companySettings?.breakRule1Minutes ?? 10;
      const rule2Minutes = companySettings?.breakRule2Minutes ?? 30;
      const maxRuleMinutes = Math.max(rule1Minutes, rule2Minutes);
      const eventType = elapsedMinutes > maxRuleMinutes ? 'break-overrun' : 'break-end-on-time';

      const timeEntry = await storage.updateTimeEntry(id, {
        breakMinutes: newBreakMinutes,
        breakStartTime: null,
      });

      const timeEntryRecipients = await computeTimeEntryRecipients(userId, getUserIdsWithPermission);
      sendToUsers(timeEntryRecipients, {
        type: 'time_entry_updated',
        data: { timeEntry },
      });

      logBreakClockEvent(storage, userId, id, eventType, { elapsedMinutes, totalBreakMinutes: newBreakMinutes });

      res.json(timeEntry);
    } catch (error) {
      console.error("Error ending break:", error);
      res.status(500).json({ message: (error as Error).message });
    }
  });
}

function logBreakClockEvent(
  storage: IStorage,
  userId: string,
  timeEntryId: string,
  eventType: string,
  metadata: Record<string, unknown>,
): void {
  const BREAK_EVENT_DEFAULTS: Record<string, number> = {
    'break-start': 0,
    'break-end-on-time': 5,
    'break-overrun': -5,
  };
  storage.getPerformanceScoreSettings().then(scoreSettings => {
    const setting = scoreSettings.find(s => s.eventType === eventType);
    const pointValue = (setting?.isActive ? setting.pointValue : null) ?? BREAK_EVENT_DEFAULTS[eventType] ?? 0;
    return storage.createClockEvent({ userId, timeEntryId, eventType, pointValue, metadata });
  }).catch(err => {
    logger.warn({ error: err?.message, eventType }, '[BreakClock] Failed to log break clock event (non-fatal)');
  });
}
