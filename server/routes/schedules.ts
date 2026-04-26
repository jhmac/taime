import type { Express } from "express";
import type { IStorage } from "../storage";
import { insertScheduleSchema, users, messageThreads, threadParticipants, threadMessages, userAvailability, aiSchedulingSettings, scoreHistory, schedules as schedulesTable } from "@shared/schema";
import { eq, and, inArray, gte, lte, desc } from "drizzle-orm";
import { db } from "../db";
import { notificationService } from "../services/notificationService";
import { claudeService } from "../services/claudeService";
import { tryResolveStoreIdForUser } from "../lib/storeResolver";
import { computeScheduleDmRecipients, computeScheduleStoreRecipients } from "../lib/broadcastRecipients";
import { getAllStoreUserIds } from "../lib/permissionUtils";

/**
 * Returns the YYYY-MM-DD slice of a timestamp value (UTC), or undefined when
 * the input is missing or not parseable. Used to attach an "affected day"
 * marker to schedule WS payloads so subscribers can filter notices to the day
 * they're viewing. Centralized here so single- and bulk-delete routes stay in
 * lockstep — a drift between the two would re-introduce the asymmetry the
 * round-4 architect review flagged.
 */
function toIsoDate(value: unknown): string | undefined {
  if (value === null || value === undefined) return undefined;
  try {
    const d = value instanceof Date ? value : new Date(value as string | number);
    const ms = d.getTime();
    if (!Number.isFinite(ms)) return undefined;
    return d.toISOString().slice(0, 10);
  } catch {
    return undefined;
  }
}

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
        const newDay = new Date(schedule.startTime).toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
        const newStart = new Date(schedule.startTime).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
        const newEnd = new Date(schedule.endTime).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
        const newDescription = `${schedule.title ? schedule.title + ' – ' : ''}${newDay}, ${newStart}–${newEnd}`;
        notificationService.sendScheduleUpdate(data.userId, newDescription, '/schedules').catch((err) => {
          console.error(`Failed to notify user ${data.userId} of new schedule:`, err);
        });
      }

      const scheduleStoreId = (await tryResolveStoreIdForUser(userId)) || 'default';
      const scheduleCreatedRecipients = await computeScheduleStoreRecipients(scheduleStoreId, getAllStoreUserIds);
      sendToUsers(scheduleCreatedRecipients, {
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

  app.patch('/api/schedules/:id', isAuthenticated, async (req: any, res, next) => {
    // Defensive routing: this `:id` route was registered before
    // `/api/schedules/bulk`, so Express would match `:id = 'bulk'` here first
    // and call storage.updateSchedule('bulk', ...) → 404. Bail to next()
    // so the dedicated bulk handler further down can claim the request.
    if (req.params.id === 'bulk') return next();
    try {
      const userId = req.user.id;
      const userPermissions = await storage.getUserPermissions(userId);
      const canManage = userPermissions.some(p => p.name === 'admin.manage_all' || p.name === 'schedule.manage');
      if (!canManage) return res.status(403).json({ message: "Permission denied" });

      const body = { ...req.body };
      if (body.startTime && typeof body.startTime === 'string') body.startTime = new Date(body.startTime);
      if (body.endTime && typeof body.endTime === 'string') body.endTime = new Date(body.endTime);

      const updated = await storage.updateSchedule(req.params.id, body);
      if (!updated) return res.status(404).json({ message: "Schedule not found" });

      const scheduleUpdatedStoreId = (await tryResolveStoreIdForUser(userId)) || 'default';
      const scheduleUpdatedRecipients = await computeScheduleStoreRecipients(scheduleUpdatedStoreId, getAllStoreUserIds);
      sendToUsers(scheduleUpdatedRecipients, { type: 'schedule_updated', data: { schedule: updated } });

      if (updated.userId && updated.userId !== userId) {
        const day = new Date(updated.startTime).toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
        const start = new Date(updated.startTime).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
        const end = new Date(updated.endTime).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
        const description = `${updated.title ? updated.title + ' – ' : ''}${day}, ${start}–${end}`;
        notificationService.sendScheduleUpdate(updated.userId, description, '/schedules').catch((err) => {
          console.error(`Failed to notify user ${updated.userId} of schedule update:`, err);
        });
      }

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
          sendToUsers(computeScheduleDmRecipients(adminId, empUserId), {
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

  // ── Bulk operations (Task #387 B1, B2, B3) ────────────────────────────────
  // Single transaction + single consolidated WS broadcast per call.

  app.patch('/api/schedules/bulk', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const userPermissions = await storage.getUserPermissions(userId);
      const canManage = userPermissions.some(p => p.name === 'admin.manage_all' || p.name === 'schedule.manage');
      if (!canManage) return res.status(403).json({ message: "Permission denied" });

      const { ids, op } = req.body as {
        ids: string[];
        op: { kind: 'set'; patch: Record<string, any> } | { kind: 'shiftMinutes'; deltaMin: number };
      };
      if (!Array.isArray(ids) || ids.length === 0) return res.status(400).json({ message: "ids required" });
      if (ids.length > 200) return res.status(400).json({ message: "max 200 ids per call" });
      if (!op || (op.kind !== 'set' && op.kind !== 'shiftMinutes')) {
        return res.status(400).json({ message: "op.kind must be 'set' or 'shiftMinutes'" });
      }

      // Per-store scoping: only allow editing shifts inside the requester's store
      const storeId = (await tryResolveStoreIdForUser(userId)) || 'default';
      const allowedUserIds = new Set(await getAllStoreUserIds(storeId));

      // Field allowlist for op.kind === 'set'. Critically excludes `userId` —
      // assignee changes must go through the per-shift PATCH route which has
      // its own cross-store validation. Allowing `userId` here would let any
      // manager-with-IDs reassign shifts to users in OTHER stores via this
      // endpoint, since we only check that the *current* assignee is in-store
      // (not the target). Same risk for storeId, locationId of foreign loc.
      const ALLOWED_PATCH_FIELDS = new Set([
        'startTime', 'endTime', 'title', 'locationId', 'description', 'status', 'shiftType',
      ]);

      const updated = await db.transaction(async (tx) => {
        const existing = await tx.select().from(schedulesTable).where(inArray(schedulesTable.id, ids));
        const inScope = existing.filter(s => allowedUserIds.has(s.userId));
        if (inScope.length === 0) return [];

        const results: any[] = [];
        for (const sched of inScope) {
          let patch: Record<string, any> = {};
          if (op.kind === 'set') {
            // Allowlist filter — silently drop unknown / dangerous fields.
            for (const [k, v] of Object.entries(op.patch ?? {})) {
              if (ALLOWED_PATCH_FIELDS.has(k)) patch[k] = v;
            }
            if (typeof patch.startTime === 'string') patch.startTime = new Date(patch.startTime);
            if (typeof patch.endTime === 'string') patch.endTime = new Date(patch.endTime);
            // Validate locationId points to a real, active location that
            // matches the requester's resolved store scope. We never let a
            // manager assign a shift to a foreign or deactivated location via
            // this endpoint. Treat null/undefined isActive as "not active" so
            // legacy rows (predating the default) cannot slip through.
            if (patch.locationId) {
              const loc = await storage.getWorkLocation(patch.locationId);
              if (!loc || loc.isActive !== true || loc.id !== storeId) {
                delete patch.locationId;
              }
            }
            if (Object.keys(patch).length === 0) {
              // Nothing legal to update for this row — skip without erroring.
              continue;
            }
          } else {
            const deltaMs = op.deltaMin * 60 * 1000;
            patch.startTime = new Date(new Date(sched.startTime).getTime() + deltaMs);
            patch.endTime = new Date(new Date(sched.endTime).getTime() + deltaMs);
          }
          const [row] = await tx.update(schedulesTable).set(patch).where(eq(schedulesTable.id, sched.id)).returning();
          results.push(row);
        }
        return results;
      });

      const recipients = await computeScheduleStoreRecipients(storeId, getAllStoreUserIds);
      sendToUsers(recipients, { type: 'schedules_bulk_updated', data: { ids: updated.map(s => s.id), schedules: updated } });

      res.json({ updated });
    } catch (error) {
      console.error("Error bulk-updating schedules:", error);
      res.status(500).json({ message: "Failed to update shifts" });
    }
  });

  app.delete('/api/schedules/bulk', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const userPermissions = await storage.getUserPermissions(userId);
      const canManage = userPermissions.some(p => p.name === 'admin.manage_all' || p.name === 'schedule.manage');
      if (!canManage) return res.status(403).json({ message: "Permission denied" });

      const { ids } = req.body as { ids: string[] };
      if (!Array.isArray(ids) || ids.length === 0) return res.status(400).json({ message: "ids required" });
      if (ids.length > 200) return res.status(400).json({ message: "max 200 ids per call" });

      const storeId = (await tryResolveStoreIdForUser(userId)) || 'default';
      const allowedUserIds = new Set(await getAllStoreUserIds(storeId));

      const { ok, dates } = await db.transaction(async (tx) => {
        const existing = await tx.select().from(schedulesTable).where(inArray(schedulesTable.id, ids));
        const inScope = existing.filter(s => allowedUserIds.has(s.userId));
        if (inScope.length === 0) return { ok: [] as string[], dates: [] as string[] };
        const okIds = inScope.map(s => s.id);
        // Capture the affected day for each deleted shift so subscribers can
        // filter "schedule changed elsewhere" notices to the day they're viewing.
        const dateSet = new Set<string>();
        for (const s of inScope) {
          const iso = toIsoDate(s.startTime);
          if (iso) dateSet.add(iso);
        }
        await tx.delete(schedulesTable).where(inArray(schedulesTable.id, okIds));
        return { ok: okIds, dates: Array.from(dateSet) };
      });

      // Skip the WS broadcast entirely when nothing was actually deleted — a
      // no-op shouldn't wake every other tab in the store.
      if (ok.length > 0) {
        const recipients = await computeScheduleStoreRecipients(storeId, getAllStoreUserIds);
        sendToUsers(recipients, { type: 'schedules_bulk_deleted', data: { ids: ok, dates } });
      }

      res.json({ deleted: ok });
    } catch (error) {
      console.error("Error bulk-deleting schedules:", error);
      res.status(500).json({ message: "Failed to delete shifts" });
    }
  });

  app.post('/api/schedules/copy-day', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const userPermissions = await storage.getUserPermissions(userId);
      const canManage = userPermissions.some(p => p.name === 'admin.manage_all' || p.name === 'schedule.manage');
      if (!canManage) return res.status(403).json({ message: "Permission denied" });

      const { sourceDate, targetDates, replace } = req.body as {
        sourceDate: string;
        targetDates: string[];
        replace?: boolean;
      };
      const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
      if (!sourceDate || !DATE_RE.test(sourceDate)) return res.status(400).json({ message: "sourceDate must be YYYY-MM-DD" });
      if (!Array.isArray(targetDates) || targetDates.length === 0) return res.status(400).json({ message: "targetDates required" });
      if (targetDates.some(d => typeof d !== 'string' || !DATE_RE.test(d))) {
        return res.status(400).json({ message: "all targetDates must be YYYY-MM-DD" });
      }
      if (targetDates.length > 60) return res.status(400).json({ message: "max 60 target dates per call" });

      const storeId = (await tryResolveStoreIdForUser(userId)) || 'default';
      const allowedUserIds = new Set(await getAllStoreUserIds(storeId));

      const sourceStart = new Date(sourceDate + 'T00:00:00');
      const sourceEnd = new Date(sourceDate + 'T23:59:59.999');

      const result = await db.transaction(async (tx) => {
        // Load source shifts in scope
        const allOnSource = await tx
          .select()
          .from(schedulesTable)
          .where(and(gte(schedulesTable.startTime, sourceStart), lte(schedulesTable.startTime, sourceEnd)));
        const sourceShifts = allOnSource.filter(s => allowedUserIds.has(s.userId));

        let replacedCount = 0;
        if (replace) {
          for (const td of targetDates) {
            const ts = new Date(td + 'T00:00:00');
            const te = new Date(td + 'T23:59:59.999');
            const existing = await tx
              .select({ id: schedulesTable.id, userId: schedulesTable.userId })
              .from(schedulesTable)
              .where(and(gte(schedulesTable.startTime, ts), lte(schedulesTable.startTime, te)));
            const toDelete = existing.filter(s => allowedUserIds.has(s.userId)).map(s => s.id);
            if (toDelete.length > 0) {
              await tx.delete(schedulesTable).where(inArray(schedulesTable.id, toDelete));
              replacedCount += toDelete.length;
            }
          }
        }

        const created: any[] = [];
        for (const td of targetDates) {
          const rowsToInsert = sourceShifts.map(s => {
            const srcStart = new Date(s.startTime);
            const srcEnd = new Date(s.endTime);
            const newStart = new Date(`${td}T00:00:00`);
            newStart.setHours(srcStart.getHours(), srcStart.getMinutes(), 0, 0);
            const newEnd = new Date(`${td}T00:00:00`);
            newEnd.setHours(srcEnd.getHours(), srcEnd.getMinutes(), 0, 0);
            // Handle shifts that cross midnight
            if (newEnd <= newStart) newEnd.setDate(newEnd.getDate() + 1);
            return {
              userId: s.userId,
              startTime: newStart,
              endTime: newEnd,
              title: s.title,
              locationId: s.locationId,
              description: s.description,
              createdBy: userId,
            };
          });
          if (rowsToInsert.length > 0) {
            const inserted = await tx.insert(schedulesTable).values(rowsToInsert).returning();
            created.push(...inserted);
          }
        }
        return { created, replacedCount };
      });

      const recipients = await computeScheduleStoreRecipients(storeId, getAllStoreUserIds);
      sendToUsers(recipients, {
        type: 'schedules_bulk_created',
        data: { ids: result.created.map(s => s.id), schedules: result.created },
      });

      res.json(result);
    } catch (error) {
      console.error("Error copying day schedules:", error);
      res.status(500).json({ message: "Failed to copy day" });
    }
  });

  // Per-day preview: counts existing in-scope shifts on each target date.
  // Used by the Copy-day picker to show "will replace N existing shifts on …".
  app.get('/api/schedules/copy-day-preview', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const userPermissions = await storage.getUserPermissions(userId);
      const canManage = userPermissions.some(p => p.name === 'admin.manage_all' || p.name === 'schedule.manage');
      if (!canManage) return res.status(403).json({ message: "Permission denied" });

      const sourceDate = req.query.sourceDate as string | undefined;
      const targetDatesParam = req.query.targetDates as string | undefined;
      const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
      if (!sourceDate || !DATE_RE.test(sourceDate)) return res.status(400).json({ message: "sourceDate required" });
      const targetDates = (targetDatesParam || '').split(',').filter(Boolean);
      if (targetDates.length === 0 || targetDates.some(d => !DATE_RE.test(d))) {
        return res.status(400).json({ message: "targetDates required (comma-separated YYYY-MM-DD)" });
      }
      if (targetDates.length > 60) return res.status(400).json({ message: "max 60 target dates" });

      const storeId = (await tryResolveStoreIdForUser(userId)) || 'default';
      const allowedUserIds = new Set(await getAllStoreUserIds(storeId));

      const ss = new Date(sourceDate + 'T00:00:00');
      const se = new Date(sourceDate + 'T23:59:59.999');
      const sourceRows = await db
        .select({ id: schedulesTable.id, userId: schedulesTable.userId })
        .from(schedulesTable)
        .where(and(gte(schedulesTable.startTime, ss), lte(schedulesTable.startTime, se)));
      const sourceCount = sourceRows.filter(s => allowedUserIds.has(s.userId)).length;

      const perTarget: { date: string; existing: number }[] = [];
      for (const td of targetDates) {
        const ts = new Date(td + 'T00:00:00');
        const te = new Date(td + 'T23:59:59.999');
        const rows = await db
          .select({ id: schedulesTable.id, userId: schedulesTable.userId })
          .from(schedulesTable)
          .where(and(gte(schedulesTable.startTime, ts), lte(schedulesTable.startTime, te)));
        perTarget.push({ date: td, existing: rows.filter(s => allowedUserIds.has(s.userId)).length });
      }

      res.json({ sourceCount, perTarget });
    } catch (error) {
      console.error("Error previewing copy-day:", error);
      res.status(500).json({ message: "Failed to preview copy-day" });
    }
  });

  app.delete('/api/schedules/:id', isAuthenticated, async (req: any, res, next) => {
    // Same defensive routing as the PATCH `:id` route — fall through to the
    // dedicated `DELETE /api/schedules/bulk` handler when id === 'bulk'.
    if (req.params.id === 'bulk') return next();
    try {
      const userId = req.user.id;
      const userPermissions = await storage.getUserPermissions(userId);
      const canManage = userPermissions.some(p => p.name === 'admin.manage_all' || p.name === 'schedule.manage');
      if (!canManage) {
        return res.status(403).json({ message: "Permission denied" });
      }
      // Look up the row BEFORE deleting so the WS payload can carry the
      // affected day; the panel listener uses this to suppress notices for
      // events on other days. See bulk-delete handler — same shape.
      const [existing] = await db
        .select({ startTime: schedulesTable.startTime })
        .from(schedulesTable)
        .where(eq(schedulesTable.id, req.params.id));
      const deletedDate = toIsoDate(existing?.startTime);
      await storage.deleteSchedule(req.params.id);
      const scheduleDeletedStoreId = (await tryResolveStoreIdForUser(userId)) || 'default';
      const scheduleDeletedRecipients = await computeScheduleStoreRecipients(scheduleDeletedStoreId, getAllStoreUserIds);
      sendToUsers(scheduleDeletedRecipients, {
        type: 'schedule_deleted',
        data: { scheduleId: req.params.id, dates: deletedDate ? [deletedDate] : [] },
      });
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

  // Auto-assign top-scored available employees for a day
  app.post('/api/schedules/auto-assign-day', isAuthenticated, async (req: any, res) => {
    try {
      const requestingUserId = req.user.id;
      const requesterRole = req.user.role?.name;
      const requesterPerms = await storage.getUserPermissions(requestingUserId);
      const hasScheduleAccess =
        requesterPerms.some(p => p.name === 'schedule.create' || p.name === 'schedule.edit_all' || p.name === 'admin.manage_all') ||
        ['owner', 'admin', 'manager', 'assistant_manager'].includes(requesterRole);
      if (!hasScheduleAccess) {
        return res.status(403).json({ message: "Schedule management permission required" });
      }

      const { date, startTime, endTime } = req.body;
      if (!date) return res.status(400).json({ message: "date is required" });

      // Load AI scheduling settings (use sensible defaults if not configured)
      const aiRows = await db.select().from(aiSchedulingSettings).limit(1);
      const aiSettings = aiRows[0] as any | null;
      const minimumStaffing: number = aiSettings?.minimumStaffing ?? 2;
      const storeHoursConfig: any[] = aiSettings?.storeHours ?? [];

      // Determine shift times from store hours for this day of week
      const targetDate = new Date(date + 'T12:00:00'); // noon to avoid TZ boundary issues
      const dayOfWeek = targetDate.getDay();
      const storeHoursForDay = storeHoursConfig.find((h: any) => h.day === dayOfWeek);
      const shiftStart = startTime || storeHoursForDay?.openTime || '09:00';
      const shiftEnd = endTime || storeHoursForDay?.closeTime || '17:00';

      // Find employees available on this date
      const dateStart = new Date(date + 'T00:00:00');
      const dateEnd = new Date(date + 'T23:59:59');

      const availRecords = await db
        .select({ userId: userAvailability.userId })
        .from(userAvailability)
        .where(
          and(
            gte(userAvailability.date, dateStart),
            lte(userAvailability.date, dateEnd),
            eq(userAvailability.isAvailable, true)
          )
        );

      const availableUserIds = [...new Set(availRecords.map(r => r.userId))];

      if (availableUserIds.length === 0) {
        return res.json({
          created: 0,
          skipped: 0,
          message: "No employees have marked themselves available for this date.",
          schedules: [],
        });
      }

      // Get most-recent overall score per available user
      const recentScores = await db
        .select({ userId: scoreHistory.userId, overallScore: scoreHistory.overallScore })
        .from(scoreHistory)
        .where(inArray(scoreHistory.userId, availableUserIds))
        .orderBy(desc(scoreHistory.snapshotDate));

      const scoreMap = new Map<string, number>();
      for (const row of recentScores) {
        if (!scoreMap.has(row.userId)) scoreMap.set(row.userId, row.overallScore ?? 0);
      }

      // Sort available users by score descending, take the top N needed
      const ranked = availableUserIds
        .map(id => ({ id, score: scoreMap.get(id) ?? 0 }))
        .sort((a, b) => b.score - a.score)
        .slice(0, minimumStaffing);

      // Skip any who are already scheduled that day
      const existingOnDay = await db
        .select({ userId: schedulesTable.userId })
        .from(schedulesTable)
        .where(and(gte(schedulesTable.startTime, dateStart), lte(schedulesTable.startTime, dateEnd)));
      const alreadyScheduled = new Set(existingOnDay.map(r => r.userId));

      const toCreate = ranked.filter(u => !alreadyScheduled.has(u.id));

      const created: any[] = [];
      for (const emp of toCreate) {
        const startTimeDate = new Date(`${date}T${shiftStart}:00`);
        const endTimeDate = new Date(`${date}T${shiftEnd}:00`);
        const schedule = await storage.createSchedule({
          userId: emp.id,
          startTime: startTimeDate,
          endTime: endTimeDate,
          title: 'Auto-assigned',
          description: `Auto-assigned by AI (score: ${emp.score})`,
          createdBy: requestingUserId,
        });
        created.push(schedule);
      }

      res.json({
        created: created.length,
        skipped: ranked.length - toCreate.length,
        needed: minimumStaffing,
        availableCount: availableUserIds.length,
        message: created.length > 0
          ? `Created ${created.length} shift(s) for ${date}.`
          : `All top-scored available employees are already scheduled.`,
        schedules: created,
      });
    } catch (error) {
      console.error('Error in auto-assign-day:', error);
      res.status(500).json({ message: 'Failed to auto-assign shifts' });
    }
  });
}
