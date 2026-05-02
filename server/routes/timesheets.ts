import type { Express } from "express";
import type { IStorage } from "../storage";
import { insertTimeEntrySchema } from "@shared/schema";
import logger from "../lib/logger";
import { OvertimePreventionService } from "../services/overtimePreventionService";
import { resolvePermission, resolveAnyPermission } from "../services/permissionResolver";
import { notificationService } from "../services/notificationService";
import { tryResolveStoreIdForUser } from "../services/storeResolver";

function toEndOfDay(date: Date): Date {
  const d = new Date(date);
  d.setUTCHours(23, 59, 59, 999);
  return d;
}

function calculateHours(clockIn: Date, clockOut: Date | null, breakMinutes: number = 0): number {
  if (!clockOut) return 0;
  const diffMs = new Date(clockOut).getTime() - new Date(clockIn).getTime();
  const totalMinutes = diffMs / 60000;
  return Math.max(0, (totalMinutes - breakMinutes) / 60);
}

function splitRegularOT(totalHours: number, otThreshold: number, accumulatedHours: number): { regular: number; ot: number } {
  const remainingBeforeOT = Math.max(0, otThreshold - accumulatedHours);
  if (totalHours <= remainingBeforeOT) {
    return { regular: totalHours, ot: 0 };
  }
  return { regular: remainingBeforeOT, ot: totalHours - remainingBeforeOT };
}

function getWeekKey(dateStr: string | Date, workWeekStart: string = "sunday"): string {
  const dayMap: Record<string, number> = {
    sunday: 0, monday: 1, tuesday: 2, wednesday: 3,
    thursday: 4, friday: 5, saturday: 6,
  };
  const targetDay = dayMap[workWeekStart.toLowerCase()] ?? 0;
  const d = new Date(dateStr);
  d.setHours(0, 0, 0, 0);
  const currentDay = d.getDay();
  const diff = (currentDay - targetDay + 7) % 7;
  d.setDate(d.getDate() - diff);
  return d.toISOString().split("T")[0];
}

function sanitizeCsvField(value: string): string {
  if (/^[=+\-@\t\r]/.test(value)) {
    return "'" + value;
  }
  return value;
}

type DiscrepancyType = "no_show" | "missing_clock_out" | "early_departure" | "short_shift" | "long_shift" | "unapproved";

interface NeedsReviewFlag {
  type: DiscrepancyType;
  message: string;
  entryId: string;
  scheduleId?: string;
  userId?: string;
  date?: string;
  scheduledStart?: string;
  scheduledEnd?: string;
  scheduledHours?: number;
}

interface DiscrepancyAlert {
  type: DiscrepancyType;
  message: string;
  entryId?: string;
  scheduleId?: string;
  userId: string;
  date: string;
  scheduledStart?: string;
  scheduledEnd?: string;
  scheduledHours?: number;
  actualHours?: number;
  actualClockIn?: string;
}

function detectNeedsReview(entry: any, schedule?: any): NeedsReviewFlag[] {
  const flags: NeedsReviewFlag[] = [];
  if (!entry.clockOutTime) {
    flags.push({ type: "missing_clock_out", message: "Missing clock-out", entryId: entry.id });
  }
  if (entry.clockOutTime && entry.clockInTime) {
    const hours = calculateHours(entry.clockInTime, entry.clockOutTime, entry.breakMinutes || 0);
    if (hours < 2) {
      flags.push({ type: "short_shift", message: `Short shift (${hours.toFixed(1)} hrs)`, entryId: entry.id });
    }
    if (hours > 12) {
      flags.push({ type: "long_shift", message: `Long shift (${hours.toFixed(1)} hrs)`, entryId: entry.id });
    }
    if (schedule && entry.clockOutTime) {
      const scheduledHours = calculateHours(schedule.startTime, schedule.endTime, 0);
      const deviationHours = scheduledHours - hours;
      if (deviationHours > 1) {
        flags.push({
          type: "early_departure",
          message: `Early departure (${deviationHours.toFixed(1)} hr${deviationHours !== 1 ? "s" : ""} short)`,
          entryId: entry.id,
          scheduleId: schedule.id,
          scheduledStart: schedule.startTime,
          scheduledEnd: schedule.endTime,
          scheduledHours,
        });
      }
    }
  }
  if (!entry.isApproved) {
    flags.push({ type: "unapproved", message: "Not yet approved", entryId: entry.id });
  }
  return flags;
}

function formatDecimalHours(hours: number): string {
  return hours.toFixed(2);
}

function formatClockHours(hours: number): string {
  const h = Math.floor(hours);
  const m = Math.round((hours - h) * 60);
  return `${h}:${m.toString().padStart(2, "0")}`;
}

export function registerTimesheetRoutes(app: Express, storage: IStorage, isAuthenticated: any) {
  app.get("/api/timesheets/review", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const canViewAll = await resolveAnyPermission(userId, ['time.view_all', 'admin.manage_all'], storage);
      if (!canViewAll) {
        return res.status(403).json({ message: "Insufficient permissions" });
      }

      const startDate = req.query.startDate ? new Date(req.query.startDate as string) : undefined;
      const endDate = req.query.endDate ? toEndOfDay(new Date(req.query.endDate as string)) : undefined;

      if (startDate && isNaN(startDate.getTime())) {
        return res.status(400).json({ message: "Invalid startDate" });
      }
      if (endDate && isNaN(endDate.getTime())) {
        return res.status(400).json({ message: "Invalid endDate" });
      }

      const settings = await storage.getCompanySettings();
      const otThreshold = settings?.overtimeThresholdHours ?? 40;
      const workWeekStart = (settings as any)?.workWeekStart || "sunday";

      const scheduleStart = startDate || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      const scheduleEnd = endDate || new Date(Date.now() + 24 * 60 * 60 * 1000);
      const startDateStr = (startDate || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)).toISOString().split("T")[0];
      const endDateStr = (endDate || new Date(Date.now() + 24 * 60 * 60 * 1000)).toISOString().split("T")[0];

      const [allEntries, allUsers, allOffsiteSessions, allSchedules, allMileageReimbs] = await Promise.all([
        storage.getAllTimeEntries(startDate, endDate),
        storage.getAllUsers(),
        storage.getOffsiteSessions({}),
        storage.getAllSchedules(scheduleStart, scheduleEnd),
        storage.getMileageReimbursements({
          startDate: startDate,
          endDate: endDate,
        }),
      ]);

      const mileageReimbByEntry = new Map<string, { milesDecimal: number; rateCents: number; totalCents: number; equivalentMinutes: number; id: string; adjustedMilesDecimal: string | null }[]>();
      for (const reimb of allMileageReimbs) {
        if (reimb.timeEntryId) {
          const list = mileageReimbByEntry.get(reimb.timeEntryId) || [];
          list.push({
            id: reimb.id,
            milesDecimal: parseFloat(String(reimb.milesDecimal)),
            rateCents: reimb.rateCents,
            totalCents: reimb.totalCents,
            equivalentMinutes: reimb.equivalentMinutes,
            adjustedMilesDecimal: reimb.adjustedMilesDecimal,
          });
          mileageReimbByEntry.set(reimb.timeEntryId, list);
        }
      }

      // Fetch all resolutions for the date range in a single batch query
      const resolvedKeys = new Set<string>();
      const activeUsers = allUsers.filter((u: any) => u.isActive !== false);
      const allResolutions = await storage.getAllDiscrepancyResolutions(startDateStr, endDateStr);
      for (const r of allResolutions) {
        resolvedKeys.add(`${r.userId}:${r.date}:${r.discrepancyType}`);
      }

      const offsiteByTimeEntry = new Map<string, any[]>();
      const offsiteByUser = new Map<string, any[]>();
      for (const session of allOffsiteSessions) {
        if (session.timeEntryId) {
          const list = offsiteByTimeEntry.get(session.timeEntryId) || [];
          list.push(session);
          offsiteByTimeEntry.set(session.timeEntryId, list);
        }
        const userList = offsiteByUser.get(session.userId) || [];
        userList.push(session);
        offsiteByUser.set(session.userId, userList);
      }

      const entriesByUser = new Map<string, any[]>();
      for (const entry of allEntries) {
        const list = entriesByUser.get(entry.userId) || [];
        list.push(entry);
        entriesByUser.set(entry.userId, list);
      }

      const activeOffsiteByUser = new Map<string, any>();
      for (const session of allOffsiteSessions) {
        if (session.status === "active") {
          activeOffsiteByUser.set(session.userId, session);
        }
      }

      // Build schedule lookup: userId -> date -> schedule[]
      const scheduleByUserDate = new Map<string, Map<string, any[]>>();
      for (const schedule of allSchedules) {
        const dateKey = new Date(schedule.startTime).toISOString().split("T")[0];
        if (!scheduleByUserDate.has(schedule.userId)) {
          scheduleByUserDate.set(schedule.userId, new Map());
        }
        const userMap = scheduleByUserDate.get(schedule.userId)!;
        const dayList = userMap.get(dateKey) || [];
        dayList.push(schedule);
        userMap.set(dateKey, dayList);
      }

      const employeeReviews = activeUsers.map((user: any) => {
          const entries = entriesByUser.get(user.id) || [];
          const userScheduleByDate = scheduleByUserDate.get(user.id) || new Map<string, any[]>();
          let totalActual = 0;
          let totalRegular = 0;
          let totalOT = 0;
          let totalOffsiteMinutes = 0;
          const needsReviewFlags: NeedsReviewFlag[] = [];
          const discrepancyAlerts: DiscrepancyAlert[] = [];

          const dailyMap = new Map<string, { date: string; actual: number; regular: number; ot: number; offsiteMinutes: number; scheduledHours: number; schedules: any[]; entries: any[] }>();

          const sortedEntries = [...entries].sort(
            (a, b) => new Date(a.clockInTime).getTime() - new Date(b.clockInTime).getTime()
          );

          const weeklyAccumulated = new Map<string, number>();

          for (const entry of sortedEntries) {
            const dateKey = new Date(entry.clockInTime).toISOString().split("T")[0];
            const daySchedules = userScheduleByDate.get(dateKey) || [];
            // Find closest matching schedule for this entry
            const matchingSchedule = daySchedules.find((s: any) => {
              const sStart = new Date(s.startTime).getTime();
              const eClockIn = new Date(entry.clockInTime).getTime();
              return Math.abs(sStart - eClockIn) < 4 * 60 * 60 * 1000; // within 4 hours
            }) || daySchedules[0];

            const flags = detectNeedsReview(entry, matchingSchedule);
            // Only push non-resolved flags to needsReviewFlags
            for (const f of flags) {
              const resolvedKey = `${user.id}:${dateKey}:${f.type}`;
              if (!resolvedKeys.has(resolvedKey)) {
                needsReviewFlags.push(f);
              }
            }

            // Convert flags to discrepancy alerts (skip resolved ones)
            for (const flag of flags) {
              if (flag.type !== "unapproved") {
                const resolvedKey = `${user.id}:${dateKey}:${flag.type}`;
                if (!resolvedKeys.has(resolvedKey)) {
                  discrepancyAlerts.push({
                    type: flag.type,
                    message: flag.message,
                    entryId: flag.entryId,
                    scheduleId: matchingSchedule?.id,
                    userId: user.id,
                    date: dateKey,
                    scheduledStart: matchingSchedule?.startTime,
                    scheduledEnd: matchingSchedule?.endTime,
                    scheduledHours: matchingSchedule ? calculateHours(matchingSchedule.startTime, matchingSchedule.endTime, 0) : undefined,
                    actualHours: calculateHours(entry.clockInTime, entry.clockOutTime, entry.breakMinutes || 0),
                    actualClockIn: entry.clockInTime,
                  });
                }
              }
            }

            const hours = calculateHours(entry.clockInTime, entry.clockOutTime, entry.breakMinutes || 0);
            const wk = getWeekKey(entry.clockInTime, workWeekStart);
            const accumulated = weeklyAccumulated.get(wk) || 0;
            const { regular, ot } = splitRegularOT(hours, otThreshold, accumulated);
            weeklyAccumulated.set(wk, accumulated + hours);

            totalActual += hours;
            totalRegular += regular;
            totalOT += ot;

            const entrySessions = offsiteByTimeEntry.get(entry.id) || [];
            const entryOffsiteMinutes = entrySessions.reduce((sum: number, s: any) => sum + (s.durationMinutes || 0), 0);
            totalOffsiteMinutes += entryOffsiteMinutes;

            const scheduledHoursForDay = daySchedules.reduce((sum: number, s: any) => sum + calculateHours(s.startTime, s.endTime, 0), 0);
            const day = dailyMap.get(dateKey) || { date: dateKey, actual: 0, regular: 0, ot: 0, offsiteMinutes: 0, scheduledHours: scheduledHoursForDay, schedules: daySchedules, entries: [] };
            day.actual += hours;
            day.regular += regular;
            day.ot += ot;
            day.offsiteMinutes += entryOffsiteMinutes;
            const entryMileageReimbs = mileageReimbByEntry.get(entry.id) || [];
            day.entries.push({
              id: entry.id,
              clockInTime: entry.clockInTime,
              clockOutTime: entry.clockOutTime,
              breakMinutes: entry.breakMinutes || 0,
              hours,
              isApproved: entry.isApproved,
              notes: entry.notes,
              scheduledStart: matchingSchedule?.startTime || null,
              scheduledEnd: matchingSchedule?.endTime || null,
              scheduledHours: matchingSchedule ? calculateHours(matchingSchedule.startTime, matchingSchedule.endTime, 0) : null,
              discrepancies: flags.filter(f => f.type !== "unapproved").map(f => f.type),
              offsiteSessions: entrySessions.map((s: any) => ({
                id: s.id,
                exitTime: s.exitTime,
                returnTime: s.returnTime,
                durationMinutes: s.durationMinutes,
                status: s.status,
                ruleId: s.ruleId,
              })),
              mileageReimbursements: entryMileageReimbs,
            });
            dailyMap.set(dateKey, day);
          }

          // Detect no-shows: scheduled days with no time entries (skip resolved)
          const today = new Date().toISOString().split("T")[0];
          for (const [dateKey, daySchedules] of Array.from(userScheduleByDate.entries())) {
            if (dateKey >= today) continue; // Skip today and future
            if (dailyMap.has(dateKey)) continue; // Already has entries
            const noShowResolved = resolvedKeys.has(`${user.id}:${dateKey}:no_show`);
            for (const schedule of daySchedules) {
              // Add synthetic daily row so no-show days appear in the breakdown
              if (!dailyMap.has(dateKey)) {
                const scheduledHrs = calculateHours(schedule.startTime, schedule.endTime, 0);
                dailyMap.set(dateKey, {
                  date: dateKey,
                  actual: 0,
                  regular: 0,
                  ot: 0,
                  offsiteMinutes: 0,
                  scheduledHours: scheduledHrs,
                  schedules: daySchedules,
                  entries: [],
                });
              }
              if (!noShowResolved) {
                discrepancyAlerts.push({
                  type: "no_show",
                  message: "No show — scheduled but no clock-in",
                  scheduleId: schedule.id,
                  userId: user.id,
                  date: dateKey,
                  scheduledStart: schedule.startTime,
                  scheduledEnd: schedule.endTime,
                  scheduledHours: calculateHours(schedule.startTime, schedule.endTime, 0),
                });
                needsReviewFlags.push({
                  type: "no_show",
                  message: "No show — scheduled but no clock-in",
                  entryId: "",
                  scheduleId: schedule.id,
                  date: dateKey,
                });
              }
            }
          }

          const allApproved = entries.length > 0 && entries.every((e: any) => e.isApproved);
          const hasNeedsReview = needsReviewFlags.length > 0;
          const hasPendingClockOut = entries.some((e: any) => !e.clockOutTime);

          let status: string;
          if (allApproved && entries.length > 0) {
            status = "approved";
          } else if (hasNeedsReview) {
            status = "needs-review";
          } else if (entries.length === 0) {
            status = "no_entries";
          } else if (hasPendingClockOut) {
            status = "pending_clock_out";
          } else {
            status = "pending";
          }

          const dailyBreakdown = Array.from(dailyMap.values()).sort(
            (a, b) => a.date.localeCompare(b.date)
          );

          const activeOffsite = activeOffsiteByUser.get(user.id);

          return {
            userId: user.id,
            firstName: user.firstName,
            lastName: user.lastName,
            profileImageUrl: user.profileImageUrl,
            email: user.email,
            actualHours: Math.round(totalActual * 100) / 100,
            regularHours: Math.round(totalRegular * 100) / 100,
            otHours: Math.round(totalOT * 100) / 100,
            offsiteMinutes: totalOffsiteMinutes,
            status,
            needsReviewFlags,
            needsReviewCount: needsReviewFlags.filter(f => f.type !== "unapproved").length,
            discrepancyAlerts,
            entryCount: entries.length,
            dailyBreakdown,
            activeOffsite: activeOffsite ? {
              id: activeOffsite.id,
              exitTime: activeOffsite.exitTime,
              durationMinutes: activeOffsite.durationMinutes,
              status: activeOffsite.status,
              ruleId: activeOffsite.ruleId,
            } : null,
          };
        });

      const totalNeedsReview = employeeReviews.reduce((sum: number, e: any) => sum + e.needsReviewCount, 0);
      const allDiscrepancyAlerts: DiscrepancyAlert[] = employeeReviews.flatMap((e: any) => e.discrepancyAlerts || []);
      const totals = {
        actualHours: Math.round(employeeReviews.reduce((sum: number, e: any) => sum + e.actualHours, 0) * 100) / 100,
        regularHours: Math.round(employeeReviews.reduce((sum: number, e: any) => sum + e.regularHours, 0) * 100) / 100,
        otHours: Math.round(employeeReviews.reduce((sum: number, e: any) => sum + e.otHours, 0) * 100) / 100,
      };

      // Attach period approval chain status
      const storeId = await tryResolveStoreIdForUser(req.user.id);
      let periodApproval = null;
      if (storeId && startDateStr && endDateStr) {
        try {
          periodApproval = await storage.getTimesheetPeriodApproval(storeId, startDateStr, endDateStr) ?? null;
        } catch {
          // non-fatal
        }
      }

      // Health summary
      const totalEmployees = employeeReviews.length;
      const approvedCount = employeeReviews.filter((e: any) => e.status === "approved").length;
      const needsReviewCount = employeeReviews.filter((e: any) => e.status === "needs-review").length;
      const noEntriesCount = employeeReviews.filter((e: any) => e.status === "no_entries").length;
      const pendingClockOutCount = employeeReviews.filter((e: any) => e.status === "pending_clock_out").length;

      res.json({
        employees: employeeReviews,
        totals,
        totalNeedsReview,
        otThreshold,
        discrepancyAlerts: allDiscrepancyAlerts,
        periodApproval,
        healthSummary: { totalEmployees, approvedCount, needsReviewCount, noEntriesCount, pendingClockOutCount },
      });
    } catch (error: any) {
      logger.error({ error: error.message }, "Error fetching timesheet review");
      res.status(500).json({ message: "Failed to fetch timesheet review" });
    }
  });

  app.get("/api/timesheets/employee/:id", isAuthenticated, async (req: any, res) => {
    try {
      const requestingUserId = req.user.id;
      const targetUserId = req.params.id;
      const canViewAll = await resolveAnyPermission(requestingUserId, ['time.view_all', 'admin.manage_all'], storage);
      const isOwner = requestingUserId === targetUserId;

      if (!canViewAll && !isOwner) {
        return res.status(403).json({ message: "Insufficient permissions" });
      }

      const startDate = req.query.startDate ? new Date(req.query.startDate as string) : undefined;
      const endDate = req.query.endDate ? toEndOfDay(new Date(req.query.endDate as string)) : undefined;

      const [entries, user] = await Promise.all([
        storage.getUserTimeEntries(targetUserId, startDate, endDate),
        storage.getUser(targetUserId),
      ]);

      if (!user) {
        return res.status(404).json({ message: "Employee not found" });
      }

      const sortedEntries = [...entries].sort(
        (a, b) => new Date(a.clockInTime).getTime() - new Date(b.clockInTime).getTime()
      );

      const dailyEntries: Record<string, any[]> = {};

      for (const entry of sortedEntries) {
        const dateKey = new Date(entry.clockInTime).toISOString().split("T")[0];
        if (!dailyEntries[dateKey]) {
          dailyEntries[dateKey] = [];
        }
        const hours = calculateHours(entry.clockInTime, entry.clockOutTime, entry.breakMinutes || 0);
        const flags = detectNeedsReview(entry);

        dailyEntries[dateKey].push({
          id: entry.id,
          clockInTime: entry.clockInTime,
          clockOutTime: entry.clockOutTime,
          breakMinutes: entry.breakMinutes || 0,
          hours,
          isApproved: entry.isApproved,
          approvedBy: entry.approvedBy,
          approvedAt: entry.approvedAt,
          notes: entry.notes,
          locationId: entry.locationId,
          clockInSource: entry.clockInSource,
          clockOutSource: entry.clockOutSource,
          needsReviewFlags: flags,
        });
      }

      res.json({
        employee: {
          id: user.id,
          firstName: user.firstName,
          lastName: user.lastName,
          email: user.email,
          phone: user.phone,
          profileImageUrl: user.profileImageUrl,
          hourlyRate: user.hourlyRate,
        },
        dailyEntries,
      });
    } catch (error: any) {
      logger.error({ error: error.message }, "Error fetching employee timesheet");
      res.status(500).json({ message: "Failed to fetch employee timesheet" });
    }
  });

  app.post("/api/timesheets/approve-entry/:id", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const entryId = req.params.id;

      const canApprove = await resolveAnyPermission(userId, ['time.approve', 'admin.manage_all'], storage);
      if (!canApprove) {
        return res.status(403).json({ message: "Insufficient permissions to approve time entries" });
      }

      const entry = await storage.getTimeEntry(entryId);
      if (!entry) {
        return res.status(404).json({ message: "Time entry not found" });
      }

      const updated = await storage.updateTimeEntry(entryId, {
        isApproved: true,
        approvedBy: userId,
        approvedAt: new Date(),
      });

      await storage.createTimeEntryEdit({
        timeEntryId: entryId,
        editedBy: userId,
        fieldChanged: "isApproved",
        oldValue: "false",
        newValue: "true",
        reason: "Approved via timesheets review",
      });

      res.json(updated);
    } catch (error: any) {
      logger.error({ error: error.message }, "Error approving time entry");
      res.status(500).json({ message: "Failed to approve time entry" });
    }
  });

  app.post("/api/timesheets/approve-all", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const canApprove = await resolveAnyPermission(userId, ['time.approve', 'admin.manage_all'], storage);
      if (!canApprove) {
        return res.status(403).json({ message: "Insufficient permissions to approve time entries" });
      }

      const { startDate, endDate } = req.body;
      if (!startDate || !endDate) {
        return res.status(400).json({ message: "startDate and endDate are required" });
      }

      const storeId = await tryResolveStoreIdForUser(userId);
      const workflowSettings = await storage.getTimesheetWorkflowSettings(storeId);
      const singleStep = workflowSettings?.singleStepApproval ?? false;
      const notifyAdmin = workflowSettings?.notifyAdminOnManagerApproval ?? false;
      const adminUserId = workflowSettings?.adminUserId ?? null;

      const entries = await storage.getAllTimeEntries(new Date(startDate), toEndOfDay(new Date(endDate)));

      if (singleStep) {
        // Single-step: immediately mark all completed entries as approved (final)
        const unapproved = entries.filter((e: any) => !e.isApproved && e.clockOutTime);
        let approvedCount = 0;
        for (const entry of unapproved) {
          await storage.updateTimeEntry(entry.id, {
            isApproved: true,
            approvedBy: userId,
            approvedAt: new Date(),
          });
          await storage.createTimeEntryEdit({
            timeEntryId: entry.id,
            editedBy: userId,
            fieldChanged: "isApproved",
            oldValue: "false",
            newValue: "true",
            reason: "Single-step approved via timesheets review",
          });
          approvedCount++;
        }
        if (storeId) {
          await storage.upsertTimesheetPeriodApproval({
            storeId,
            periodStart: startDate,
            periodEnd: endDate,
            status: "final_approved",
            managerApprovedBy: userId,
            managerApprovedAt: new Date(),
            adminApprovedBy: userId,
            adminApprovedAt: new Date(),
          });
          // Mark any open reminders for this period as acted on
          await storage.markRemindersActedOnForPeriod(startDate, endDate, storeId);
        }
        return res.json({ approvedCount, totalEntries: entries.length, singleStep: true, status: "final_approved" });
      }

      // Two-step: manager approval — record period-level state, notify admin
      if (!storeId) {
        return res.status(400).json({ message: "Unable to resolve store context for this user" });
      }
      await storage.upsertTimesheetPeriodApproval({
        storeId,
        periodStart: startDate,
        periodEnd: endDate,
        status: "manager_approved",
        managerApprovedBy: userId,
        managerApprovedAt: new Date(),
      });
      // Mark open reminders as acted on (manager responded)
      await storage.markRemindersActedOnForPeriod(startDate, endDate, storeId);

      // Notify admin when configured
      if (notifyAdmin && adminUserId && adminUserId !== userId) {
        const approvingUser = await storage.getUser(userId);
        const approverName = approvingUser
          ? [approvingUser.firstName, approvingUser.lastName].filter(Boolean).join(" ") || approvingUser.email || "A manager"
          : "A manager";
        try {
          await notificationService.sendToUser(adminUserId, {
            title: "Timesheets Ready for Final Approval",
            body: `${approverName} has reviewed timesheets for the period ${startDate} – ${endDate}. Please log in to finalize.`,
            data: { type: "timesheet_manager_approved", periodStart: startDate, periodEnd: endDate },
          });
          await storage.createTimesheetReminderLog({
            storeId,
            periodStart: startDate,
            periodEnd: endDate,
            reminderType: "manager_approval_notify",
            userId: adminUserId,
          });
        } catch (notifyErr: any) {
          logger.warn({ error: notifyErr?.message }, "[approve-all] Admin notification failed (non-fatal)");
        }
      }

      return res.json({ approvedCount: 0, totalEntries: entries.length, singleStep: false, status: "manager_approved" });
    } catch (error: any) {
      logger.error({ error: error.message }, "Error bulk approving time entries");
      res.status(500).json({ message: "Failed to bulk approve time entries" });
    }
  });

  // Admin final approval — completes the two-step chain, stamps isApproved on entries
  app.post("/api/timesheets/finalize-period", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const canFinalize = await resolveAnyPermission(userId, ['admin.manage_all'], storage);
      if (!canFinalize) {
        return res.status(403).json({ message: "Only admins can finalize a period" });
      }

      const { startDate, endDate } = req.body;
      if (!startDate || !endDate) {
        return res.status(400).json({ message: "startDate and endDate are required" });
      }

      const storeId = await tryResolveStoreIdForUser(userId);
      if (!storeId) {
        return res.status(400).json({ message: "Unable to resolve store context for this user" });
      }

      // Enforce: manager must have reviewed first when two-step is active
      const workflowSettings = await storage.getTimesheetWorkflowSettings(storeId);
      const singleStep = workflowSettings?.singleStepApproval ?? false;
      if (!singleStep) {
        const periodApproval = await storage.getTimesheetPeriodApproval(storeId, startDate, endDate);
        if (!periodApproval || (periodApproval.status !== "manager_approved" && periodApproval.status !== "final_approved")) {
          return res.status(409).json({ message: "Period must be reviewed by a manager before admin can finalize" });
        }
        if (periodApproval.status === "final_approved") {
          return res.status(409).json({ message: "Period is already finalized" });
        }
      }

      const entries = await storage.getAllTimeEntries(new Date(startDate), toEndOfDay(new Date(endDate)));
      const unapproved = entries.filter((e: any) => !e.isApproved && e.clockOutTime);

      let approvedCount = 0;
      for (const entry of unapproved) {
        await storage.updateTimeEntry(entry.id, {
          isApproved: true,
          approvedBy: userId,
          approvedAt: new Date(),
        });
        await storage.createTimeEntryEdit({
          timeEntryId: entry.id,
          editedBy: userId,
          fieldChanged: "isApproved",
          oldValue: "false",
          newValue: "true",
          reason: "Admin final approval — two-step chain complete",
        });
        approvedCount++;
      }

      await storage.upsertTimesheetPeriodApproval({
        storeId,
        periodStart: startDate,
        periodEnd: endDate,
        status: "final_approved",
        adminApprovedBy: userId,
        adminApprovedAt: new Date(),
      });
      await storage.markRemindersActedOnForPeriod(startDate, endDate, storeId);

      res.json({ approvedCount, totalEntries: entries.length, status: "final_approved" });
    } catch (error: any) {
      logger.error({ error: error.message }, "Error finalizing period");
      res.status(500).json({ message: "Failed to finalize period" });
    }
  });

  app.post("/api/timesheets/lock-period", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const canApprove = await resolveAnyPermission(userId, ['time.approve', 'admin.manage_all'], storage);
      if (!canApprove) {
        return res.status(403).json({ message: "Insufficient permissions to lock periods" });
      }

      const { startDate, endDate } = req.body;
      if (!startDate || !endDate) {
        return res.status(400).json({ message: "startDate and endDate are required" });
      }

      const entries = await storage.getAllTimeEntries(new Date(startDate), toEndOfDay(new Date(endDate)));
      let lockedCount = 0;

      for (const entry of entries) {
        if (!entry.isApproved) {
          await storage.updateTimeEntry(entry.id, {
            isApproved: true,
            approvedBy: userId,
            approvedAt: new Date(),
          });
          await storage.createTimeEntryEdit({
            timeEntryId: entry.id,
            editedBy: userId,
            fieldChanged: "isApproved",
            oldValue: "false",
            newValue: "true",
            reason: "Locked period — auto-approved",
          });
          lockedCount++;
        }
      }

      res.json({ lockedCount, totalEntries: entries.length, startDate, endDate });
    } catch (error: any) {
      logger.error({ error: error.message }, "Error locking period");
      res.status(500).json({ message: "Failed to lock period" });
    }
  });

  app.post("/api/timesheets/resolve-discrepancy", isAuthenticated, async (req: any, res) => {
    try {
      const adminId = req.user.id;
      const canManage = await resolveAnyPermission(adminId, ['time.approve', 'admin.manage_all'], storage);
      if (!canManage) {
        return res.status(403).json({ message: "Insufficient permissions to resolve discrepancies" });
      }

      const {
        action,
        employeeId,
        entryId,
        date,
        discrepancyType,
        reason,
        clockInTime,
        clockOutTime,
        breakMinutes,
      }: {
        action: string;
        employeeId: string;
        entryId?: string;
        date: string;
        discrepancyType?: string;
        reason: string;
        clockInTime?: string;
        clockOutTime?: string;
        breakMinutes?: number;
      } = req.body;

      const trimmedReason = reason?.trim() ?? "";
      if (!action || !employeeId || !date || !trimmedReason) {
        return res.status(400).json({ message: "action, employeeId, date, and reason (non-empty) are required" });
      }

      const employee = await storage.getUser(employeeId);
      if (!employee) {
        return res.status(404).json({ message: "Employee not found" });
      }

      if (action === "excuse") {
        // Record the resolution in the discrepancy_resolutions table
        await storage.createDiscrepancyResolution({
          userId: employeeId,
          date,
          discrepancyType: discrepancyType || "no_show",
          action: "excuse",
          reason: trimmedReason,
          resolvedBy: adminId,
          entryId: entryId || null,
          newEntryId: null,
        });

        // If there's an existing entry, also add an edit audit record
        if (entryId) {
          await storage.createTimeEntryEdit({
            timeEntryId: entryId,
            editedBy: adminId,
            fieldChanged: "discrepancy_resolved",
            oldValue: "unresolved",
            newValue: "excused",
            reason: trimmedReason,
          });
        }

        return res.json({ message: "Absence marked as excused" });
      }

      if (action === "add_time_card") {
        if (!clockInTime) {
          return res.status(400).json({ message: "clockInTime is required for add_time_card action" });
        }

        // Build the full datetime for the time card from the date + time strings (HH:MM format)
        const buildDateTime = (dateStr: string, timeStr: string): Date => {
          const [h, m] = timeStr.split(":").map(Number);
          const d = new Date(dateStr + "T00:00:00");
          d.setHours(h, m, 0, 0);
          return d;
        };

        const clockIn = buildDateTime(date, clockInTime);
        const clockOut = clockOutTime ? buildDateTime(date, clockOutTime) : undefined;

        const newEntry = await storage.createTimeEntry({
          userId: employeeId,
          clockInTime: clockIn,
          clockOutTime: clockOut,
          breakMinutes: breakMinutes || 0,
          notes: trimmedReason,
          clockInSource: "manual",
          clockOutSource: clockOut ? "manual" : undefined,
          isApproved: true,
        });

        await storage.createDiscrepancyResolution({
          userId: employeeId,
          date,
          discrepancyType: discrepancyType || "no_show",
          action: "add_time_card",
          reason: trimmedReason,
          resolvedBy: adminId,
          entryId: entryId || null,
          newEntryId: newEntry.id,
        });

        await storage.createTimeEntryEdit({
          timeEntryId: newEntry.id,
          editedBy: adminId,
          fieldChanged: "created",
          oldValue: null,
          newValue: "Manual time card added to resolve discrepancy",
          reason: trimmedReason,
        });

        return res.json({ message: "Time card added", entry: newEntry });
      }

      return res.status(400).json({ message: "Invalid action. Use 'excuse' or 'add_time_card'" });
    } catch (error: any) {
      logger.error({ error: error.message }, "Error resolving discrepancy");
      res.status(500).json({ message: "Failed to resolve discrepancy" });
    }
  });

  app.get("/api/timesheets/pay-period-settings", isAuthenticated, async (req: any, res) => {
    try {
      const settings = await storage.getPayPeriodSettings();
      res.json(settings || null);
    } catch (error: any) {
      logger.error({ error: error.message }, "Error fetching pay period settings");
      res.status(500).json({ message: "Failed to fetch pay period settings" });
    }
  });

  app.post("/api/timesheets/add-entry", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const canManage = await resolveAnyPermission(userId, ['time.approve', 'admin.manage_all'], storage);
      if (!canManage) {
        return res.status(403).json({ message: "Insufficient permissions to add manual time entries" });
      }

      const { employeeId, clockInTime, clockOutTime, breakMinutes, notes } = req.body;
      if (!employeeId || !clockInTime) {
        return res.status(400).json({ message: "employeeId and clockInTime are required" });
      }

      const employee = await storage.getUser(employeeId);
      if (!employee) {
        return res.status(404).json({ message: "Employee not found" });
      }

      const entry = await storage.createTimeEntry({
        userId: employeeId,
        clockInTime: new Date(clockInTime),
        clockOutTime: clockOutTime ? new Date(clockOutTime) : undefined,
        breakMinutes: breakMinutes || 0,
        notes: notes || `Manual entry added by manager`,
        clockInSource: "manual",
        clockOutSource: clockOutTime ? "manual" : undefined,
      });

      await storage.createTimeEntryEdit({
        timeEntryId: entry.id,
        editedBy: userId,
        fieldChanged: "created",
        oldValue: null,
        newValue: "Manual time card created",
        reason: notes || "Manual entry added by manager",
      });

      res.json(entry);
    } catch (error: any) {
      logger.error({ error: error.message }, "Error adding manual time entry");
      res.status(500).json({ message: "Failed to add manual time entry" });
    }
  });

  app.get("/api/timesheets/export", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const canExport = await resolveAnyPermission(userId, ['time.view_all', 'admin.manage_all', 'hr.payroll_view'], storage);
      if (!canExport) {
        return res.status(403).json({ message: "Insufficient permissions" });
      }

      const startDate = req.query.startDate ? new Date(req.query.startDate as string) : undefined;
      const endDate = req.query.endDate ? toEndOfDay(new Date(req.query.endDate as string)) : undefined;
      const fieldsParam = (req.query.fields as string) || "";
      const hourFormat = (req.query.hourFormat as string) || "decimal";

      const preset = (req.query.preset as string) || "";

      const allFields = [
        "employeeName", "employeeEmail", "date", "clockIn", "clockOut",
        "regularHours", "otHours", "holidayHours", "breakMinutes", "offsiteMinutes", "hourlyRate",
        "regularPay", "otPay", "holidayPay", "mileageMiles", "mileagePay", "totalPay", "location", "notes",
      ];

      const presetFields: Record<string, string[]> = {
        quickbooks: ["employeeName", "date", "regularHours", "otHours", "hourlyRate", "regularPay", "otPay", "mileageMiles", "mileagePay", "totalPay"],
        gusto: ["employeeName", "employeeEmail", "date", "regularHours", "otHours", "holidayHours", "breakMinutes", "mileageMiles", "mileagePay", "totalPay"],
        adp: ["employeeName", "employeeEmail", "date", "clockIn", "clockOut", "regularHours", "otHours", "breakMinutes", "hourlyRate", "regularPay", "otPay", "mileageMiles", "mileagePay", "totalPay"],
      };

      let selectedFields: string[];
      if (preset && presetFields[preset]) {
        selectedFields = presetFields[preset];
      } else if (fieldsParam) {
        selectedFields = fieldsParam.split(",").filter((f: string) => allFields.includes(f));
      } else {
        selectedFields = allFields;
      }

      const settings = await storage.getCompanySettings();
      const otThreshold = settings?.overtimeThresholdHours ?? 40;

      const [allEntries, allUsers, exportOffsiteSessions, allMileageReimbursements] = await Promise.all([
        storage.getAllTimeEntries(startDate, endDate),
        storage.getAllUsers(),
        storage.getOffsiteSessions({}),
        storage.getMileageReimbursements({}),
      ]);

      const exportOffsiteByEntry = new Map<string, number>();
      for (const session of exportOffsiteSessions) {
        if (session.timeEntryId) {
          const current = exportOffsiteByEntry.get(session.timeEntryId) || 0;
          exportOffsiteByEntry.set(session.timeEntryId, current + (session.durationMinutes || 0));
        }
      }

      const mileageByEntry = new Map<string, { miles: number; cents: number }>();
      for (const reimb of allMileageReimbursements) {
        if (reimb.timeEntryId) {
          const existing = mileageByEntry.get(reimb.timeEntryId) || { miles: 0, cents: 0 };
          const miles = parseFloat(String(reimb.adjustedMilesDecimal || reimb.milesDecimal || '0'));
          mileageByEntry.set(reimb.timeEntryId, {
            miles: existing.miles + miles,
            cents: existing.cents + reimb.totalCents,
          });
        }
      }

      const userMap = new Map<string, any>();
      for (const user of allUsers) {
        userMap.set(user.id, user);
      }

      const exportSettings = await storage.getCompanySettings();
      const exportWorkWeekStart = (exportSettings as any)?.workWeekStart || "sunday";
      const weeklyAccByUser = new Map<string, Map<string, number>>();
      const sortedEntries = [...allEntries].sort(
        (a, b) => new Date(a.clockInTime).getTime() - new Date(b.clockInTime).getTime()
      );

      const formatHours = hourFormat === "clock" ? formatClockHours : formatDecimalHours;

      const headerMap: Record<string, string> = {
        employeeName: "Employee Name",
        employeeEmail: "Employee Email",
        date: "Date",
        clockIn: "Clock In",
        clockOut: "Clock Out",
        regularHours: "Regular Hours",
        otHours: "OT Hours",
        holidayHours: "Holiday Hours",
        breakMinutes: "Break Minutes",
        offsiteMinutes: "Off-Site Minutes",
        hourlyRate: "Hourly Rate",
        regularPay: "Regular Pay",
        otPay: "OT Pay",
        holidayPay: "Holiday Pay",
        mileageMiles: "Mileage Miles",
        mileagePay: "Mileage Pay",
        totalPay: "Total Pay",
        location: "Location",
        notes: "Notes",
      };

      const headers = selectedFields.map((f: string) => headerMap[f] || f);
      const rows: string[] = [headers.join(",")];

      for (const entry of sortedEntries) {
        const user = userMap.get(entry.userId);
        if (!user) continue;

        const hours = calculateHours(entry.clockInTime, entry.clockOutTime, entry.breakMinutes || 0);
        const wk = getWeekKey(entry.clockInTime, exportWorkWeekStart);
        if (!weeklyAccByUser.has(entry.userId)) weeklyAccByUser.set(entry.userId, new Map());
        const userWeeks = weeklyAccByUser.get(entry.userId)!;
        const accumulated = userWeeks.get(wk) || 0;
        const { regular, ot } = splitRegularOT(hours, otThreshold, accumulated);
        userWeeks.set(wk, accumulated + hours);

        const rate = parseFloat(user.hourlyRate || "0");
        const otMultiplier = parseFloat(settings?.overtimeMultiplier || "1.50");
        const holidayMultiplier = parseFloat(settings?.holidayPayMultiplier || "1.50");
        const holidayHours = 0;
        const holidayPay = holidayHours * rate * holidayMultiplier;

        const employeeName = ((user.firstName || "") + " " + (user.lastName || "")).trim();
        const notesText = (entry.notes || "").replace(/"/g, '""');

        const entryMileage = mileageByEntry.get(entry.id) || { miles: 0, cents: 0 };
        const mileagePay = entryMileage.cents / 100;

        const fieldValues: Record<string, string> = {
          employeeName: `"${sanitizeCsvField(employeeName)}"`,
          employeeEmail: sanitizeCsvField(user.email || ""),
          date: new Date(entry.clockInTime).toISOString().split("T")[0],
          clockIn: new Date(entry.clockInTime).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" }),
          clockOut: entry.clockOutTime ? new Date(entry.clockOutTime).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" }) : "",
          regularHours: formatHours(regular),
          otHours: formatHours(ot),
          holidayHours: formatHours(holidayHours),
          breakMinutes: String(entry.breakMinutes || 0),
          offsiteMinutes: String(exportOffsiteByEntry.get(entry.id) || 0),
          hourlyRate: rate.toFixed(2),
          regularPay: (regular * rate).toFixed(2),
          otPay: (ot * rate * otMultiplier).toFixed(2),
          holidayPay: holidayPay.toFixed(2),
          mileageMiles: entryMileage.miles.toFixed(2),
          mileagePay: mileagePay.toFixed(2),
          // For preset exports that emit a separate mileage line, exclude mileage from base row to avoid double-counting
          totalPay: preset && ["quickbooks", "gusto", "adp"].includes(preset)
            ? (regular * rate + ot * rate * otMultiplier + holidayPay).toFixed(2)
            : (regular * rate + ot * rate * otMultiplier + holidayPay + mileagePay).toFixed(2),
          location: sanitizeCsvField(user.locationName || ""),
          notes: `"${sanitizeCsvField(notesText)}"`,
        };

        const row = selectedFields.map((f: string) => fieldValues[f] || "");
        rows.push(row.join(","));

        // Emit a separate mileage pay-code line for QuickBooks, Gusto, and ADP presets
        if (preset && ["quickbooks", "gusto", "adp"].includes(preset) && entryMileage.cents > 0) {
          const mileagePayCode = "MILEAGE";
          const mileageRowValues: Record<string, string> = {
            ...fieldValues,
            regularHours: "0.00",
            otHours: "0.00",
            holidayHours: "0.00",
            breakMinutes: "0",
            offsiteMinutes: "0",
            regularPay: "0.00",
            otPay: "0.00",
            holidayPay: "0.00",
            mileageMiles: entryMileage.miles.toFixed(2),
            mileagePay: mileagePay.toFixed(2),
            totalPay: mileagePay.toFixed(2),
            notes: `"${mileagePayCode}: ${entryMileage.miles.toFixed(2)} mi @ $${(entryMileage.cents / entryMileage.miles / 100).toFixed(2)}/mi"`,
          };
          const mileageRow = selectedFields.map((f: string) => mileageRowValues[f] || "");
          rows.push(mileageRow.join(","));
        }
      }

      const csv = rows.join("\n");

      res.setHeader("Content-Type", "text/csv");
      res.setHeader("Content-Disposition", `attachment; filename="timesheets-export.csv"`);
      res.send(csv);
    } catch (error: any) {
      logger.error({ error: error.message }, "Error exporting timesheets");
      res.status(500).json({ message: "Failed to export timesheets" });
    }
  });

  app.get("/api/timesheets/workflow-settings", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const canView = await resolveAnyPermission(userId, ['time.approve', 'admin.manage_all'], storage);
      if (!canView) return res.status(403).json({ message: "Insufficient permissions" });
      const storeId = await tryResolveStoreIdForUser(userId);
      const settings = await storage.getTimesheetWorkflowSettings(storeId);
      res.json(settings || {
        managerReminderDaysAfterPeriod: 2,
        managerEscalationDaysAfterReminder: 3,
        notifyAdminOnManagerApproval: true,
        employeeSelfReviewReminder: false,
        singleStepApproval: false,
        managerUserIds: [],
        adminUserId: null,
      });
    } catch (error: any) {
      logger.error({ error: error.message }, "Error fetching timesheet workflow settings");
      res.status(500).json({ message: "Failed to fetch settings" });
    }
  });

  app.post("/api/timesheets/workflow-settings", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const canManage = await resolveAnyPermission(userId, ['admin.manage_all'], storage);
      if (!canManage) return res.status(403).json({ message: "Insufficient permissions" });
      const {
        managerReminderDaysAfterPeriod,
        managerEscalationDaysAfterReminder,
        notifyAdminOnManagerApproval,
        employeeSelfReviewReminder,
        singleStepApproval,
        managerUserIds,
        adminUserId,
      } = req.body;
      const storeId = await tryResolveStoreIdForUser(userId);
      const settings = await storage.upsertTimesheetWorkflowSettings({
        managerReminderDaysAfterPeriod: managerReminderDaysAfterPeriod ?? 2,
        managerEscalationDaysAfterReminder: managerEscalationDaysAfterReminder ?? 3,
        notifyAdminOnManagerApproval: notifyAdminOnManagerApproval ?? true,
        employeeSelfReviewReminder: employeeSelfReviewReminder ?? false,
        singleStepApproval: singleStepApproval ?? false,
        managerUserIds: managerUserIds || [],
        adminUserId: adminUserId || null,
        updatedBy: userId,
      }, storeId);
      res.json(settings);
    } catch (error: any) {
      logger.error({ error: error.message }, "Error saving timesheet workflow settings");
      res.status(500).json({ message: "Failed to save settings" });
    }
  });

  app.get("/api/timesheets/reminder-log", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const canView = await resolveAnyPermission(userId, ['time.approve', 'admin.manage_all'], storage);
      if (!canView) return res.status(403).json({ message: "Insufficient permissions" });
      const { periodStart, periodEnd } = req.query as { periodStart?: string; periodEnd?: string };
      const storeId = await tryResolveStoreIdForUser(userId);
      const logs = await storage.getTimesheetReminderLogs(periodStart, periodEnd, storeId);
      res.json(logs);
    } catch (error: any) {
      logger.error({ error: error.message }, "Error fetching reminder log");
      res.status(500).json({ message: "Failed to fetch reminder log" });
    }
  });

  const overtimeService = new OvertimePreventionService(storage);

  app.get("/api/timesheets/overtime-alerts", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const canView = await resolveAnyPermission(userId, ['time.view_all', 'admin.manage_all'], storage);
      if (!canView) {
        return res.status(403).json({ message: "Insufficient permissions" });
      }

      const result = await overtimeService.getOvertimeAlerts();

      res.json({
        atRiskEmployees: result.atRiskEmployees,
        alerts: result.alerts,
        weekStart: result.weekStart.toISOString(),
        weekEnd: result.weekEnd.toISOString(),
        threshold: result.threshold,
        totalAtRisk: result.atRiskEmployees.length,
        totalAlerts: result.alerts.length,
      });
    } catch (error: any) {
      logger.error({ error: error.message }, "Error fetching overtime alerts");
      res.status(500).json({ message: "Failed to fetch overtime alerts" });
    }
  });

  app.post("/api/timesheets/overtime-alerts/:id/apply", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const alertId = req.params.id;

      const canApprove = await resolveAnyPermission(userId, ['time.approve', 'admin.manage_all'], storage);
      if (!canApprove) {
        return res.status(403).json({ message: "Insufficient permissions to apply overtime swaps" });
      }

      const result = await overtimeService.applySwap(alertId, userId);

      if (!result.success) {
        return res.status(400).json({ message: result.message });
      }

      res.json({ message: result.message });
    } catch (error: any) {
      logger.error({ error: error.message }, "Error applying overtime swap");
      res.status(500).json({ message: "Failed to apply overtime swap" });
    }
  });

  app.post("/api/timesheets/overtime-alerts/:id/dismiss", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const alertId = req.params.id;

      const canApprove = await resolveAnyPermission(userId, ['time.approve', 'admin.manage_all'], storage);
      if (!canApprove) {
        return res.status(403).json({ message: "Insufficient permissions to dismiss overtime alerts" });
      }

      const result = await overtimeService.dismissAlert(alertId, userId);

      if (!result.success) {
        return res.status(400).json({ message: result.message });
      }

      res.json({ message: result.message });
    } catch (error: any) {
      logger.error({ error: error.message }, "Error dismissing overtime alert");
      res.status(500).json({ message: "Failed to dismiss overtime alert" });
    }
  });
}
