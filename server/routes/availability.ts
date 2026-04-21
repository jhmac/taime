import type { Express } from "express";
import type { IStorage } from "../storage";
import { notificationService } from "../services/notificationService";
import { sendAvailabilityUpdateEmail, resolveAppUrl } from "../services/emailService";
import { getUserIdsWithPermission, getAllStoreUserIds } from "../lib/permissionUtils";
import { tryResolveStoreIdForUser } from "../lib/storeResolver";

export function registerAvailabilityRoutes(app: Express, storage: IStorage, isAuthenticated: any) {
  app.post('/api/availability', isAuthenticated, async (req: any, res) => {
    try {
      const { availability } = req.body;
      const userId = req.user.id;
      
      const availabilityWithUserId = availability.map((avail: any) => ({
        ...avail,
        userId,
        date: new Date(avail.date),
        payrollPeriodId: avail.payrollPeriodId || null,
      }));
      
      const submitted = await storage.submitAvailability(availabilityWithUserId);
      res.json(submitted);

      const user = req.user;
      const employeeName = [user.firstName, user.lastName].filter(Boolean).join(" ") || user.email || "An employee";
      const requestHost = req.headers["host"] as string | undefined;

      Promise.resolve().then(async () => {
        const storeId = await tryResolveStoreIdForUser(userId);
        if (!storeId) return;

        const [storeUserIds, schedulerIds] = await Promise.all([
          getAllStoreUserIds(storeId),
          getUserIdsWithPermission('schedule.create'),
        ]);

        const storeUserSet = new Set(storeUserIds);
        const managerIds = schedulerIds.filter((id) => id !== userId && storeUserSet.has(id));
        if (managerIds.length === 0) return;

        await notificationService.sendAvailabilityUpdate(managerIds, employeeName);

        const appUrl = resolveAppUrl(requestHost);
        const managerRecords = await Promise.all(managerIds.map((id) => storage.getUser(id)));
        const emailPromises = managerRecords
          .filter((m): m is NonNullable<typeof m> => !!m && !!m.email)
          .map((m) => {
            const managerName = [m.firstName, m.lastName].filter(Boolean).join(" ") || m.email || "";
            return sendAvailabilityUpdateEmail(m.email!, managerName, employeeName, appUrl);
          });
        await Promise.allSettled(emailPromises);
      }).catch((err) => {
        console.error("[Availability] Failed to notify managers:", err);
      });
    } catch (error) {
      console.error("Error submitting availability:", error);
      res.status(500).json({ message: "Failed to submit availability" });
    }
  });

  app.get('/api/availability', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const { payrollPeriodId, startDate, endDate } = req.query;
      
      if (startDate && endDate) {
        const availability = await storage.getUserAvailabilityByDateRange(
          userId,
          new Date(startDate as string),
          new Date(endDate as string)
        );
        return res.json(availability);
      }
      
      const availability = await storage.getUserAvailability(userId, payrollPeriodId as string);
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

  app.get('/api/availability/all', isAuthenticated, async (req: any, res) => {
    try {
      const { startDate, endDate } = req.query;
      if (!startDate || !endDate) {
        return res.status(400).json({ message: "startDate and endDate are required" });
      }
      const availability = await storage.getAllAvailabilityByDateRange(
        new Date(startDate as string),
        new Date(endDate as string)
      );
      res.json(availability);
    } catch (error) {
      console.error("Error fetching all availability:", error);
      res.status(500).json({ message: "Failed to fetch all availability" });
    }
  });

  // ── New calendar API ─────────────────────────────────────────────────────────

  // GET /api/availability/calendar — merged view for the current user (or a specific employee for managers): template + overrides + time-off blocks
  app.get('/api/availability/calendar', isAuthenticated, async (req: any, res) => {
    try {
      const requestingUserId: string = req.user.id;
      const requestingRole = req.user?.role?.name;
      const isManagerOrAbove = ['owner', 'admin', 'manager', 'assistant_manager'].includes(requestingRole);

      let userId = requestingUserId;

      // Managers can view any store employee's calendar
      if (isManagerOrAbove && req.query.userId && req.query.userId !== requestingUserId) {
        const targetId = req.query.userId as string;
        const [requesterStoreId, targetStoreId] = await Promise.all([
          tryResolveStoreIdForUser(requestingUserId),
          tryResolveStoreIdForUser(targetId),
        ]);
        if (!requesterStoreId || !targetStoreId || requesterStoreId !== targetStoreId) {
          return res.status(403).json({ message: "Not authorized to view that employee's availability" });
        }
        userId = targetId;
      }

      const { start, end } = req.query;
      if (!start || !end) {
        return res.status(400).json({ message: "start and end query params are required (YYYY-MM-DD)" });
      }
      const startStr = start as string;
      const endStr = end as string;

      // Build an array of all dates in the range
      const dates: string[] = [];
      const cur = new Date(startStr + 'T12:00:00Z');
      const endDate = new Date(endStr + 'T12:00:00Z');
      while (cur <= endDate) {
        dates.push(cur.toISOString().slice(0, 10));
        cur.setUTCDate(cur.getUTCDate() + 1);
      }

      // Fetch template, overrides, and time-off in parallel
      const [template, overrides, allTimeOff] = await Promise.all([
        storage.getAvailabilityTemplate(userId),
        storage.getAvailabilityOverrides(userId, startStr, endStr),
        storage.getTimeOffRequests(userId),
      ]);

      const overridesByDate: Record<string, typeof overrides[0]> = {};
      for (const o of overrides) {
        overridesByDate[o.date] = o;
      }

      const rawSlots = (template?.slots ?? {}) as Record<string, { available?: boolean; startTime?: string; endTime?: string; morning?: boolean; afternoon?: boolean; evening?: boolean }>;

      const result = dates.map(dateStr => {
        // Check time-off (active = not cancelled)
        const dateObj = new Date(dateStr + 'T12:00:00Z');
        const activeTimeOff = allTimeOff.find(r => {
          if (r.status === 'cancelled') return false;
          const s = new Date(r.startDate);
          const e = new Date(r.endDate);
          return dateObj >= s && dateObj <= e;
        });
        if (activeTimeOff) {
          return { date: dateStr, source: 'time_off', available: false, unavailable: true, startTime: null, endTime: null, timeOff: { type: activeTimeOff.type, status: activeTimeOff.status } };
        }

        // Override takes precedence over template
        const override = overridesByDate[dateStr];
        if (override) {
          return { date: dateStr, source: 'override', available: !override.unavailable && !!override.startTime, unavailable: override.unavailable ?? false, startTime: override.startTime ?? null, endTime: override.endTime ?? null, timeOff: null };
        }

        // Fall back to template for this day-of-week
        const dow = dateObj.getUTCDay().toString();
        const slot = rawSlots[dow];
        if (!slot) {
          return { date: dateStr, source: 'none', available: false, unavailable: false, startTime: null, endTime: null, timeOff: null };
        }
        if ('available' in slot) {
          return { date: dateStr, source: 'template', available: slot.available ?? false, unavailable: false, startTime: slot.startTime ?? null, endTime: slot.endTime ?? null, timeOff: null };
        }
        // Legacy slot
        const legacyAvail = (slot.morning || slot.afternoon || slot.evening) ?? false;
        return { date: dateStr, source: 'template', available: legacyAvail, unavailable: false, startTime: null, endTime: null, timeOff: null };
      });

      res.json(result);
    } catch (error) {
      console.error("Error fetching availability calendar:", error);
      res.status(500).json({ message: "Failed to fetch availability calendar" });
    }
  });

  // PATCH /api/availability/day — upsert a specific-date override
  app.patch('/api/availability/day', isAuthenticated, async (req: any, res) => {
    try {
      const requestingUserId: string = req.user.id;
      const requestingRole = req.user?.role?.name;
      const isManagerOrAbove = ['owner', 'admin', 'manager', 'assistant_manager'].includes(requestingRole);

      let userId = requestingUserId;

      // Managers can pass a targetUserId to override on behalf of an employee
      if (isManagerOrAbove && req.body.userId && req.body.userId !== requestingUserId) {
        const targetId = req.body.userId as string;
        const [requesterStoreId, targetStoreId] = await Promise.all([
          tryResolveStoreIdForUser(requestingUserId),
          tryResolveStoreIdForUser(targetId),
        ]);
        if (!requesterStoreId || !targetStoreId || requesterStoreId !== targetStoreId) {
          return res.status(403).json({ message: "Not authorized to edit that employee's availability" });
        }
        userId = targetId;
      }

      const { date, startTime, endTime, unavailable } = req.body;

      if (!date || typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        return res.status(400).json({ message: "date must be a YYYY-MM-DD string" });
      }
      const isUnavailable = !!unavailable;
      const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
      if (!isUnavailable) {
        if (!startTime || !TIME_RE.test(startTime)) return res.status(400).json({ message: "startTime must be HH:mm" });
        if (!endTime || !TIME_RE.test(endTime)) return res.status(400).json({ message: "endTime must be HH:mm" });
        if (endTime !== '00:00' && startTime >= endTime) return res.status(400).json({ message: "endTime must be after startTime" });
      }

      const result = await storage.upsertAvailabilityOverride(userId, date, {
        startTime: isUnavailable ? null : startTime,
        endTime: isUnavailable ? null : endTime,
        unavailable: isUnavailable,
      });
      res.json(result);
    } catch (error) {
      console.error("Error saving availability day override:", error);
      res.status(500).json({ message: "Failed to save availability" });
    }
  });

  // DELETE /api/availability/day — remove a specific-date override (reverts to template)
  app.delete('/api/availability/day', isAuthenticated, async (req: any, res) => {
    try {
      const requestingUserId: string = req.user.id;
      const requestingRole = req.user?.role?.name;
      const isManagerOrAbove = ['owner', 'admin', 'manager', 'assistant_manager'].includes(requestingRole);

      let userId = requestingUserId;

      // Managers can pass a targetUserId to clear an override on behalf of an employee
      if (isManagerOrAbove && req.query.userId && req.query.userId !== requestingUserId) {
        const targetId = req.query.userId as string;
        const [requesterStoreId, targetStoreId] = await Promise.all([
          tryResolveStoreIdForUser(requestingUserId),
          tryResolveStoreIdForUser(targetId),
        ]);
        if (!requesterStoreId || !targetStoreId || requesterStoreId !== targetStoreId) {
          return res.status(403).json({ message: "Not authorized to edit that employee's availability" });
        }
        userId = targetId;
      }

      const { date } = req.query;
      if (!date || typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        return res.status(400).json({ message: "date query param must be YYYY-MM-DD" });
      }
      await storage.deleteAvailabilityOverride(userId, date);
      res.json({ message: "Override cleared" });
    } catch (error) {
      console.error("Error deleting availability override:", error);
      res.status(500).json({ message: "Failed to clear availability" });
    }
  });

  // GET /api/availability/calendar/team — manager view: merged availability for all store members
  app.get('/api/availability/calendar/team', isAuthenticated, async (req: any, res) => {
    try {
      const requestingUserId: string = req.user.id;
      const requestingRole = req.user?.role?.name;
      const isManagerOrAbove = ['owner', 'admin', 'manager', 'assistant_manager'].includes(requestingRole);
      if (!isManagerOrAbove) return res.status(403).json({ message: "Managers only" });

      const { start, end } = req.query;
      if (!start || !end) return res.status(400).json({ message: "start and end required" });
      const startStr = start as string;
      const endStr = end as string;

      const { tryResolveStoreIdForUser } = await import('../lib/storeResolver');
      const { getAllStoreUserIds } = await import('../lib/permissionUtils');

      const storeId = await tryResolveStoreIdForUser(requestingUserId);
      if (!storeId) return res.json([]);

      const storeUserIds = await getAllStoreUserIds(storeId);
      if (storeUserIds.length === 0) return res.json([]);

      const [templates, overrides, allTimeOff] = await Promise.all([
        storage.getAvailabilityTemplatesForUsers(storeUserIds),
        storage.getAvailabilityOverridesForUsers(storeUserIds, startStr, endStr),
        storage.getTimeOffRequests(),
      ]);

      // Build lookup maps
      const templateByUser: Record<string, typeof templates[0]> = {};
      for (const t of templates) templateByUser[t.userId] = t;

      type OverrideRow = typeof overrides[0];
      const overridesByUserDate: Record<string, OverrideRow> = {};
      for (const o of overrides) overridesByUserDate[`${o.userId}:${o.date}`] = o;

      // Build date list
      const dates: string[] = [];
      const cur = new Date(startStr + 'T12:00:00Z');
      const endDateObj = new Date(endStr + 'T12:00:00Z');
      while (cur <= endDateObj) {
        dates.push(cur.toISOString().slice(0, 10));
        cur.setUTCDate(cur.getUTCDate() + 1);
      }

      // Per date: collect available users with their time ranges
      const byDate: Record<string, { userId: string; startTime: string | null; endTime: string | null }[]> = {};
      for (const dateStr of dates) {
        const dateObj = new Date(dateStr + 'T12:00:00Z');
        const available: typeof byDate[string] = [];

        for (const uid of storeUserIds) {
          // Check time-off
          const hasTimeOff = allTimeOff.some(r => {
            if (r.status === 'cancelled' || r.userId !== uid) return false;
            const s = new Date(r.startDate); const e = new Date(r.endDate);
            return dateObj >= s && dateObj <= e;
          });
          if (hasTimeOff) continue;

          const override = overridesByUserDate[`${uid}:${dateStr}`];
          if (override) {
            if (!override.unavailable && override.startTime) {
              available.push({ userId: uid, startTime: override.startTime, endTime: override.endTime });
            }
            continue;
          }

          // Template fallback
          const tmpl = templateByUser[uid];
          const rawSlots = (tmpl?.slots ?? {}) as Record<string, { available?: boolean; startTime?: string; endTime?: string; morning?: boolean; afternoon?: boolean; evening?: boolean }>;
          const dow = dateObj.getUTCDay().toString();
          const slot = rawSlots[dow];
          if (!slot) continue;

          if ('available' in slot && slot.available) {
            available.push({ userId: uid, startTime: slot.startTime ?? null, endTime: slot.endTime ?? null });
          } else if (!('available' in slot) && (slot.morning || slot.afternoon || slot.evening)) {
            available.push({ userId: uid, startTime: null, endTime: null });
          }
        }
        byDate[dateStr] = available;
      }

      res.json(byDate);
    } catch (error) {
      console.error("Error fetching team availability calendar:", error);
      res.status(500).json({ message: "Failed to fetch team availability" });
    }
  });

  // Availability template routes

  // GET /api/availability/templates/summary — manager-only: returns which store employees have a saved template
  app.get('/api/availability/templates/summary', isAuthenticated, async (req: any, res) => {
    try {
      const requestingUserId: string = req.user.id;
      const requestingRole = req.user?.role?.name;
      const isManagerOrAbove = ['owner', 'admin', 'manager', 'assistant_manager'].includes(requestingRole);
      if (!isManagerOrAbove) {
        return res.status(403).json({ message: "Only managers can view template summary" });
      }

      const storeId = await tryResolveStoreIdForUser(requestingUserId);
      if (!storeId) {
        return res.json([]);
      }

      const storeUserIds = await getAllStoreUserIds(storeId);
      const templates = await storage.getAvailabilityTemplatesForUsers(storeUserIds);
      const summary = templates.map((t) => ({
        userId: t.userId,
        updatedAt: t.updatedAt,
        slots: t.slots,
      }));
      res.json(summary);
    } catch (error) {
      console.error("Error fetching availability templates summary:", error);
      res.status(500).json({ message: "Failed to fetch templates summary" });
    }
  });

  app.get('/api/availability/template', isAuthenticated, async (req: any, res) => {
    try {
      const requestingUserId: string = req.user.id;
      const requestingRole = req.user?.role?.name;
      const isManagerOrAbove = ['owner', 'admin', 'manager', 'assistant_manager'].includes(requestingRole);

      let targetUserId = requestingUserId;

      if (isManagerOrAbove && req.query.userId && req.query.userId !== requestingUserId) {
        const requested = req.query.userId as string;
        // Scope check: both the requester and the target must belong to the same store
        const [requesterStoreId, targetStoreId] = await Promise.all([
          tryResolveStoreIdForUser(requestingUserId),
          tryResolveStoreIdForUser(requested),
        ]);
        if (!requesterStoreId || !targetStoreId || requesterStoreId !== targetStoreId) {
          return res.status(403).json({ message: "Not authorized to view that employee's template" });
        }
        targetUserId = requested;
      }

      const template = await storage.getAvailabilityTemplate(targetUserId);
      res.json(template || null);
    } catch (error) {
      console.error("Error fetching availability template:", error);
      res.status(500).json({ message: "Failed to fetch availability template" });
    }
  });

  const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

  // PATCH /api/availability/template/auto-apply — update only the autoApplyTemplate flag without touching slots
  app.patch('/api/availability/template/auto-apply', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const { autoApplyTemplate } = req.body;
      if (typeof autoApplyTemplate !== 'boolean') {
        return res.status(400).json({ message: "autoApplyTemplate must be a boolean" });
      }
      const existing = await storage.getAvailabilityTemplate(userId);
      const slots = (existing?.slots ?? {}) as Record<string, import('@shared/schema').TemplateSlot>;
      const template = await storage.upsertAvailabilityTemplate(userId, slots, autoApplyTemplate);
      res.json(template);
    } catch (error) {
      console.error("Error updating auto-apply setting:", error);
      res.status(500).json({ message: "Failed to update auto-apply setting" });
    }
  });

  app.post('/api/availability/template', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const { slots } = req.body;
      if (!slots || typeof slots !== 'object' || Array.isArray(slots)) {
        return res.status(400).json({ message: "slots must be an object" });
      }
      const validDays = new Set(['0','1','2','3','4','5','6']);
      for (const [key, val] of Object.entries(slots)) {
        if (!validDays.has(key)) {
          return res.status(400).json({ message: `Invalid day key: ${key}. Must be 0–6.` });
        }
        if (!val || typeof val !== 'object') {
          return res.status(400).json({ message: `slots.${key} must be an object` });
        }
        const v = val as Record<string, unknown>;
        if ('available' in v) {
          // New format: { available: boolean, startTime?: string, endTime?: string }
          if (typeof v.available !== 'boolean') {
            return res.status(400).json({ message: `slots.${key}.available must be a boolean` });
          }
          if (v.startTime !== undefined && (typeof v.startTime !== 'string' || !TIME_RE.test(v.startTime as string))) {
            return res.status(400).json({ message: `slots.${key}.startTime must be HH:mm format` });
          }
          if (v.endTime !== undefined && (typeof v.endTime !== 'string' || !TIME_RE.test(v.endTime as string))) {
            return res.status(400).json({ message: `slots.${key}.endTime must be HH:mm format` });
          }
          // Reject invalid time ranges (end must be after start, unless end is midnight 00:00)
          if (v.available && v.startTime && v.endTime && v.endTime !== '00:00' && (v.startTime as string) >= (v.endTime as string)) {
            return res.status(400).json({ message: `slots.${key}: endTime must be after startTime` });
          }
        } else {
          // Legacy format: { morning: boolean, afternoon: boolean, evening: boolean }
          if (typeof v.morning !== 'boolean' || typeof v.afternoon !== 'boolean' || typeof v.evening !== 'boolean') {
            return res.status(400).json({ message: `slots.${key} must have boolean morning, afternoon, and evening fields` });
          }
        }
      }
      const autoApplyTemplate = typeof req.body.autoApplyTemplate === 'boolean' ? req.body.autoApplyTemplate : undefined;
      const template = await storage.upsertAvailabilityTemplate(userId, slots, autoApplyTemplate);
      res.json(template);
    } catch (error) {
      console.error("Error saving availability template:", error);
      res.status(500).json({ message: "Failed to save availability template" });
    }
  });

  // Time-off request routes
  app.post('/api/time-off-requests', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const { type, startDate, endDate, allDay, startTime, endTime, reason } = req.body;
      
      if (!type || !startDate || !endDate) {
        return res.status(400).json({ message: "type, startDate, and endDate are required" });
      }

      const request = await storage.createTimeOffRequest({
        userId,
        type,
        status: 'pending',
        startDate: new Date(startDate),
        endDate: new Date(endDate),
        allDay: allDay ?? true,
        startTime: startTime || null,
        endTime: endTime || null,
        reason: reason || null,
        adminNotes: null,
        reviewedBy: null,
      });
      
      res.json(request);
    } catch (error) {
      console.error("Error creating time-off request:", error);
      res.status(500).json({ message: "Failed to create time-off request" });
    }
  });

  app.get('/api/time-off-requests', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const roleName = req.user?.role?.name;
      const canReview = roleName === 'admin' || roleName === 'owner' || roleName === 'manager';
      const { all } = req.query;

      if (all === 'true' && canReview) {
        const requests = await storage.getTimeOffRequests();
        return res.json(requests);
      }
      
      const requests = await storage.getTimeOffRequests(userId);
      res.json(requests);
    } catch (error) {
      console.error("Error fetching time-off requests:", error);
      res.status(500).json({ message: "Failed to fetch time-off requests" });
    }
  });

  app.patch('/api/time-off-requests/:id', isAuthenticated, async (req: any, res) => {
    try {
      const { id } = req.params;
      const userId = req.user.id;
      const roleName = req.user?.role?.name;
      const isAdmin = roleName === 'admin' || roleName === 'owner' || roleName === 'manager';
      const { status, adminNotes } = req.body;

      const existing = await storage.getTimeOffRequest(id);
      if (!existing) {
        return res.status(404).json({ message: "Time-off request not found" });
      }

      if (status === 'cancelled' && existing.userId !== userId && !isAdmin) {
        return res.status(403).json({ message: "Not authorized" });
      }

      if ((status === 'approved' || status === 'denied') && !isAdmin) {
        return res.status(403).json({ message: "Only admins can approve or deny requests" });
      }

      const updates: any = { status };
      if (adminNotes !== undefined) updates.adminNotes = adminNotes;
      if (status === 'approved' || status === 'denied') {
        updates.reviewedBy = userId;
        updates.reviewedAt = new Date();
      }

      const updated = await storage.updateTimeOffRequest(id, updates);
      res.json(updated);
    } catch (error) {
      console.error("Error updating time-off request:", error);
      res.status(500).json({ message: "Failed to update time-off request" });
    }
  });

  app.delete('/api/time-off-requests/:id', isAuthenticated, async (req: any, res) => {
    try {
      const { id } = req.params;
      const userId = req.user.id;
      const roleName = req.user?.role?.name;
      const isAdmin = roleName === 'admin' || roleName === 'owner' || roleName === 'manager';

      const existing = await storage.getTimeOffRequest(id);
      if (!existing) {
        return res.status(404).json({ message: "Time-off request not found" });
      }

      if (existing.userId !== userId && !isAdmin) {
        return res.status(403).json({ message: "Not authorized" });
      }

      await storage.deleteTimeOffRequest(id);
      res.json({ message: "Request deleted" });
    } catch (error) {
      console.error("Error deleting time-off request:", error);
      res.status(500).json({ message: "Failed to delete time-off request" });
    }
  });
}
