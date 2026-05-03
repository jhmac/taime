import { db } from "../db";
import { eq, and, gte, lte, desc, sql, count, inArray } from "drizzle-orm";
import {
  schedules,
  tasks,
  issues,
  sopExecutions,
  sopTemplates,
  timeEntries,
  workLocations,
  users,
  operationalInsights,
  kudos,
} from "@shared/schema";
import logger from "../lib/logger";

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export interface OperationsWindow {
  start: Date;
  end: Date;
  label: string;
}

export interface OperationsAggregate {
  storeId: string;
  storeName: string;
  window: OperationsWindow;

  schedules: {
    total: number;
    byDayOfWeek: Record<string, { day: string; count: number; coveredHours: number }>;
    coverageGaps: Array<{ date: string; day: string; scheduledCount: number; hoursCovered: number }>;
    totalHoursScheduled: number;
    actualHoursWorked: number;
    coverageRatio: number;
  };

  tasks: {
    total: number;
    completed: number;
    cancelled: number;
    pending: number;
    overdueCount: number;
    completionRate: number;
    avgDaysToComplete: number | null;
    pendingOver3Days: Array<{ id: string; title: string; ageDays: number; assignedTo: string | null }>;
    byAssignee: Array<{ userId: string | null; name: string; total: number; completed: number; rate: number }>;
    byPriority: Record<string, { total: number; completed: number }>;
    recurringTasksWithLowCompletion: Array<{ title: string; total: number; completed: number; rate: number }>;
  };

  issues: {
    total: number;
    open: number;
    resolved: number;
    avgResolutionHours: number | null;
    byCategory: Record<string, { total: number; open: number; recurring: boolean }>;
    recurringCategories: Array<{ category: string; count: number }>;
    unresolvedAgingDays: Array<{ id: string; title: string; category: string; ageDays: number; priority: string }>;
    highPriorityOpen: number;
  };

  sops: {
    totalExecutions: number;
    completed: number;
    completionRate: number;
    topIncompleteTemplates: Array<{ templateId: string; title: string; started: number; completed: number; rate: number }>;
  };

  attendance: {
    totalShifts: number;
    actualClockIns: number;
    noShowEstimate: number;
    avgShiftHours: number | null;
  };

  // ── Phase 2: Team Performance AI ─────────────────────────────────────────
  // Per-employee coaching signals. Manager-only — never surface raw rows to
  // non-managers. The aggregator only collects the data; access control is
  // enforced at the API / UI layer.
  team: {
    punctuality: Array<{
      userId: string;
      name: string;
      shiftsMatched: number;
      latePctOver5Min: number;
      avgLateMinutes: number;
    }>;
    sopMastery: Array<{
      userId: string;
      name: string;
      started: number;
      completed: number;
      completionRate: number;
    }>;
    kudosParticipation: Array<{
      userId: string;
      name: string;
      kudosReceived: number;
      kudosSent: number;
    }>;
    quietPerformers: Array<{
      userId: string;
      name: string;
      reason: string;
    }>;
  };

  feedbackContext: {
    recentDismissals: Array<{ insightType: string; observation: string; dismissReason: string | null; daysAgo: number }>;
    recentActedOn: Array<{ insightType: string; observation: string; daysAgo: number }>;
  };
}

export function getDefaultWindow(daysBack = 14): OperationsWindow {
  const end = new Date();
  const start = new Date();
  start.setDate(start.getDate() - daysBack);
  start.setHours(0, 0, 0, 0);
  return { start, end, label: `last ${daysBack} days` };
}

async function gatherFeedbackContext(storeId: string) {
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  const [dismissed, actedOn] = await Promise.all([
    db.select({
      insightType: operationalInsights.insightType,
      observation: operationalInsights.observation,
      dismissReason: operationalInsights.dismissReason,
      dismissedAt: operationalInsights.dismissedAt,
    }).from(operationalInsights)
      .where(and(
        eq(operationalInsights.storeId, storeId),
        eq(operationalInsights.status, "dismissed"),
        gte(operationalInsights.dismissedAt, thirtyDaysAgo),
      ))
      .orderBy(desc(operationalInsights.dismissedAt))
      .limit(15),

    db.select({
      insightType: operationalInsights.insightType,
      observation: operationalInsights.observation,
      actedOnAt: operationalInsights.actedOnAt,
    }).from(operationalInsights)
      .where(and(
        eq(operationalInsights.storeId, storeId),
        eq(operationalInsights.status, "acted_on"),
        gte(operationalInsights.actedOnAt, thirtyDaysAgo),
      ))
      .orderBy(desc(operationalInsights.actedOnAt))
      .limit(15),
  ]);

  const now = Date.now();
  return {
    recentDismissals: dismissed.map(d => ({
      insightType: d.insightType,
      observation: d.observation,
      dismissReason: d.dismissReason,
      daysAgo: Math.floor((now - new Date(d.dismissedAt!).getTime()) / 86400000),
    })),
    recentActedOn: actedOn.map(a => ({
      insightType: a.insightType,
      observation: a.observation,
      daysAgo: Math.floor((now - new Date(a.actedOnAt!).getTime()) / 86400000),
    })),
  };
}

export async function aggregateOperations(
  storeId: string,
  windowOverride?: OperationsWindow,
): Promise<OperationsAggregate> {
  const window = windowOverride || getDefaultWindow(14);

  const [storeRow, allSchedules, allTasks, allIssues, allSopExecs, allTimeEntries, feedbackContext] = await Promise.all([
    db.select({ name: workLocations.name }).from(workLocations).where(eq(workLocations.id, storeId)).limit(1),

    db.select({
      id: schedules.id,
      userId: schedules.userId,
      startTime: schedules.startTime,
      endTime: schedules.endTime,
    }).from(schedules)
      .where(and(
        eq(schedules.locationId, storeId),
        gte(schedules.startTime, window.start),
        lte(schedules.startTime, window.end),
      )),

    db.select().from(tasks)
      .where(and(
        eq(tasks.locationId, storeId),
        gte(tasks.createdAt, window.start),
        lte(tasks.createdAt, window.end),
      )),

    db.select().from(issues)
      .where(and(
        eq(issues.storeId, storeId),
        gte(issues.createdAt, window.start),
        lte(issues.createdAt, window.end),
      )),

    db.select({
      id: sopExecutions.id,
      templateId: sopExecutions.templateId,
      status: sopExecutions.status,
      employeeId: sopExecutions.employeeId,
      startedAt: sopExecutions.startedAt,
      completedAt: sopExecutions.completedAt,
    }).from(sopExecutions)
      .where(and(
        eq(sopExecutions.storeId, storeId),
        gte(sopExecutions.startedAt, window.start),
        lte(sopExecutions.startedAt, window.end),
      )),

    db.select({
      id: timeEntries.id,
      userId: timeEntries.userId,
      clockInTime: timeEntries.clockInTime,
      clockOutTime: timeEntries.clockOutTime,
    }).from(timeEntries)
      .where(and(
        eq(timeEntries.locationId, storeId),
        gte(timeEntries.clockInTime, window.start),
        lte(timeEntries.clockInTime, window.end),
      )),

    gatherFeedbackContext(storeId),
  ]);

  const storeName = storeRow[0]?.name || "Store";

  // ── Schedules ───────────────────────────────────────────────
  const dayBuckets: Record<string, { day: string; count: number; coveredHours: number }> = {};
  let totalHoursScheduled = 0;
  for (const s of allSchedules) {
    const start = new Date(s.startTime);
    const end = new Date(s.endTime);
    const hours = (end.getTime() - start.getTime()) / 3600000;
    totalHoursScheduled += hours;
    const dow = start.getDay();
    const key = String(dow);
    if (!dayBuckets[key]) dayBuckets[key] = { day: DAY_NAMES[dow], count: 0, coveredHours: 0 };
    dayBuckets[key].count++;
    dayBuckets[key].coveredHours += hours;
  }

  const dailyMap = new Map<string, { date: string; day: string; scheduledCount: number; hoursCovered: number }>();
  for (const s of allSchedules) {
    const start = new Date(s.startTime);
    const dateKey = start.toISOString().slice(0, 10);
    const existing = dailyMap.get(dateKey);
    const hours = (new Date(s.endTime).getTime() - start.getTime()) / 3600000;
    if (existing) {
      existing.scheduledCount++;
      existing.hoursCovered += hours;
    } else {
      dailyMap.set(dateKey, {
        date: dateKey,
        day: DAY_NAMES[start.getDay()],
        scheduledCount: 1,
        hoursCovered: hours,
      });
    }
  }
  const coverageGaps = Array.from(dailyMap.values())
    .filter(d => d.scheduledCount < 2 || d.hoursCovered < 6)
    .sort((a, b) => a.date.localeCompare(b.date));

  let actualHoursWorked = 0;
  for (const t of allTimeEntries) {
    if (!t.clockOutTime) continue;
    actualHoursWorked += (new Date(t.clockOutTime).getTime() - new Date(t.clockInTime).getTime()) / 3600000;
  }
  const coverageRatio = totalHoursScheduled > 0 ? actualHoursWorked / totalHoursScheduled : 0;

  // ── Tasks ───────────────────────────────────────────────────
  const userNamesNeeded = new Set<string>();
  for (const t of allTasks) if (t.assignedTo) userNamesNeeded.add(t.assignedTo);
  const userNameRows = userNamesNeeded.size > 0
    ? await db.select({ id: users.id, firstName: users.firstName, lastName: users.lastName })
        .from(users).where(inArray(users.id, Array.from(userNamesNeeded)))
    : [];
  const userNameMap: Record<string, string> = {};
  for (const u of userNameRows) {
    userNameMap[u.id] = `${u.firstName || ""} ${u.lastName || ""}`.trim() || "Unknown";
  }

  const tCompleted = allTasks.filter(t => t.status === "completed");
  const tCancelled = allTasks.filter(t => t.status === "cancelled");
  const tPending = allTasks.filter(t => t.status === "pending" || t.status === "in_progress");

  const now = new Date();
  const tOverdue = tPending.filter(t => t.dueDate && new Date(t.dueDate) < now);
  const tPendingOver3Days = tPending
    .map(t => ({
      id: t.id,
      title: t.title,
      ageDays: t.createdAt ? Math.floor((now.getTime() - new Date(t.createdAt).getTime()) / 86400000) : 0,
      assignedTo: t.assignedTo ? (userNameMap[t.assignedTo] || null) : null,
    }))
    .filter(t => t.ageDays >= 3)
    .sort((a, b) => b.ageDays - a.ageDays)
    .slice(0, 10);

  let totalCompletionDays = 0;
  let completionDaysCount = 0;
  for (const t of tCompleted) {
    if (t.createdAt && t.completedAt) {
      const days = (new Date(t.completedAt).getTime() - new Date(t.createdAt).getTime()) / 86400000;
      totalCompletionDays += days;
      completionDaysCount++;
    }
  }
  const avgDaysToComplete = completionDaysCount > 0 ? totalCompletionDays / completionDaysCount : null;

  const assigneeAgg: Record<string, { total: number; completed: number }> = {};
  for (const t of allTasks) {
    const key = t.assignedTo || "__unassigned__";
    if (!assigneeAgg[key]) assigneeAgg[key] = { total: 0, completed: 0 };
    assigneeAgg[key].total++;
    if (t.status === "completed") assigneeAgg[key].completed++;
  }
  const byAssignee = Object.entries(assigneeAgg)
    .map(([userId, v]) => ({
      userId: userId === "__unassigned__" ? null : userId,
      name: userId === "__unassigned__" ? "Unassigned" : (userNameMap[userId] || "Unknown"),
      total: v.total,
      completed: v.completed,
      rate: v.total > 0 ? v.completed / v.total : 0,
    }))
    .sort((a, b) => b.total - a.total);

  const byPriority: Record<string, { total: number; completed: number }> = {};
  for (const t of allTasks) {
    const p = t.priority || "medium";
    if (!byPriority[p]) byPriority[p] = { total: 0, completed: 0 };
    byPriority[p].total++;
    if (t.status === "completed") byPriority[p].completed++;
  }

  const recurringMap: Record<string, { total: number; completed: number }> = {};
  for (const t of allTasks) {
    if (!t.isRecurring) continue;
    const key = t.title;
    if (!recurringMap[key]) recurringMap[key] = { total: 0, completed: 0 };
    recurringMap[key].total++;
    if (t.status === "completed") recurringMap[key].completed++;
  }
  const recurringTasksWithLowCompletion = Object.entries(recurringMap)
    .filter(([, v]) => v.total >= 3 && v.completed / v.total < 0.7)
    .map(([title, v]) => ({ title, total: v.total, completed: v.completed, rate: v.completed / v.total }))
    .sort((a, b) => a.rate - b.rate)
    .slice(0, 5);

  // ── Issues ──────────────────────────────────────────────────
  const iOpen = allIssues.filter(i => i.status === "open" || i.status === "in_progress");
  const iResolved = allIssues.filter(i => i.status === "resolved");

  let totalResolutionHours = 0;
  let resolutionCount = 0;
  for (const i of iResolved) {
    if (i.createdAt && i.resolvedAt) {
      totalResolutionHours += (new Date(i.resolvedAt).getTime() - new Date(i.createdAt).getTime()) / 3600000;
      resolutionCount++;
    }
  }
  const avgResolutionHours = resolutionCount > 0 ? totalResolutionHours / resolutionCount : null;

  const issueCatAgg: Record<string, { total: number; open: number; recurring: boolean }> = {};
  for (const i of allIssues) {
    const cat = i.category || "uncategorized";
    if (!issueCatAgg[cat]) issueCatAgg[cat] = { total: 0, open: 0, recurring: false };
    issueCatAgg[cat].total++;
    if (i.status === "open" || i.status === "in_progress") issueCatAgg[cat].open++;
  }
  for (const cat of Object.keys(issueCatAgg)) {
    if (issueCatAgg[cat].total >= 3) issueCatAgg[cat].recurring = true;
  }
  const recurringCategories = Object.entries(issueCatAgg)
    .filter(([, v]) => v.recurring)
    .map(([category, v]) => ({ category, count: v.total }))
    .sort((a, b) => b.count - a.count);

  const unresolvedAgingDays = iOpen
    .map(i => ({
      id: i.id,
      title: i.title,
      category: i.category || "uncategorized",
      priority: i.priority || "medium",
      ageDays: i.createdAt ? Math.floor((now.getTime() - new Date(i.createdAt).getTime()) / 86400000) : 0,
    }))
    .filter(i => i.ageDays >= 3 || i.priority === "high" || i.priority === "critical")
    .sort((a, b) => b.ageDays - a.ageDays)
    .slice(0, 10);

  const highPriorityOpen = iOpen.filter(i => i.priority === "high" || i.priority === "critical").length;

  // ── SOPs ────────────────────────────────────────────────────
  const sopCompleted = allSopExecs.filter(s => s.status === "completed").length;
  const sopByTemplate: Record<string, { started: number; completed: number }> = {};
  for (const e of allSopExecs) {
    if (!sopByTemplate[e.templateId]) sopByTemplate[e.templateId] = { started: 0, completed: 0 };
    sopByTemplate[e.templateId].started++;
    if (e.status === "completed") sopByTemplate[e.templateId].completed++;
  }
  const templateIds = Object.keys(sopByTemplate);
  const templateRows = templateIds.length > 0
    ? await db.select({ id: sopTemplates.id, title: sopTemplates.title })
        .from(sopTemplates).where(inArray(sopTemplates.id, templateIds))
    : [];
  const templateTitles: Record<string, string> = {};
  for (const t of templateRows) templateTitles[t.id] = t.title;

  const topIncompleteTemplates = Object.entries(sopByTemplate)
    .filter(([, v]) => v.started >= 3 && v.completed / v.started < 0.7)
    .map(([templateId, v]) => ({
      templateId,
      title: templateTitles[templateId] || "Unknown SOP",
      started: v.started,
      completed: v.completed,
      rate: v.completed / v.started,
    }))
    .sort((a, b) => a.rate - b.rate)
    .slice(0, 5);

  // ── Attendance ──────────────────────────────────────────────
  let totalShiftHours = 0;
  let shiftCount = 0;
  for (const t of allTimeEntries) {
    if (!t.clockOutTime) continue;
    const h = (new Date(t.clockOutTime).getTime() - new Date(t.clockInTime).getTime()) / 3600000;
    if (h > 0 && h < 24) {
      totalShiftHours += h;
      shiftCount++;
    }
  }
  const avgShiftHours = shiftCount > 0 ? totalShiftHours / shiftCount : null;
  const noShowEstimate = Math.max(allSchedules.length - allTimeEntries.length, 0);

  // ── Phase 2: Team Performance ────────────────────────────────────────────
  // Pull the per-store kudos in window so we can score participation and
  // surface "quiet performers" the team rarely recognises.
  const allKudos = await db.select({
    fromEmployeeId: kudos.fromEmployeeId,
    toEmployeeId: kudos.toEmployeeId,
  }).from(kudos)
    .where(and(
      eq(kudos.storeId, storeId),
      gte(kudos.createdAt, window.start),
      lte(kudos.createdAt, window.end),
    ))
    .catch(() => [] as Array<{ fromEmployeeId: string; toEmployeeId: string }>);

  const teamUserIds = new Set<string>();
  for (const s of allSchedules) if (s.userId) teamUserIds.add(s.userId);
  for (const t of allTimeEntries) if (t.userId) teamUserIds.add(t.userId);
  for (const e of allSopExecs) if (e.employeeId) teamUserIds.add(e.employeeId);
  for (const k of allKudos) {
    if (k.fromEmployeeId) teamUserIds.add(k.fromEmployeeId);
    if (k.toEmployeeId) teamUserIds.add(k.toEmployeeId);
  }
  // Make sure name lookups cover team users that weren't already loaded by tasks
  const missingTeamIds = Array.from(teamUserIds).filter(id => !userNameMap[id]);
  if (missingTeamIds.length > 0) {
    const teamRows = await db.select({ id: users.id, firstName: users.firstName, lastName: users.lastName })
      .from(users).where(inArray(users.id, missingTeamIds));
    for (const u of teamRows) {
      userNameMap[u.id] = `${u.firstName || ""} ${u.lastName || ""}`.trim() || "Team member";
    }
  }
  const nameOf = (id: string) => userNameMap[id] || "Team member";

  // Punctuality: match each schedule to the SAME-USER clock-in within ±2h of
  // the schedule start. Lateness in minutes = clockIn - schedStart (positive).
  // Only count as "late" if > 5 minutes to avoid noise from rounding.
  const punctualityAgg: Record<string, { matched: number; lateOver5: number; totalLateMin: number; lateCount: number }> = {};
  for (const s of allSchedules) {
    if (!s.userId) continue;
    const schedStart = new Date(s.startTime).getTime();
    const candidates = allTimeEntries.filter(t =>
      t.userId === s.userId
      && Math.abs(new Date(t.clockInTime).getTime() - schedStart) <= 2 * 3600000,
    );
    if (candidates.length === 0) continue;
    candidates.sort((a, b) =>
      Math.abs(new Date(a.clockInTime).getTime() - schedStart)
      - Math.abs(new Date(b.clockInTime).getTime() - schedStart),
    );
    const clockIn = new Date(candidates[0].clockInTime).getTime();
    const lateMin = (clockIn - schedStart) / 60000;
    if (!punctualityAgg[s.userId]) punctualityAgg[s.userId] = { matched: 0, lateOver5: 0, totalLateMin: 0, lateCount: 0 };
    punctualityAgg[s.userId].matched++;
    if (lateMin > 5) {
      punctualityAgg[s.userId].lateOver5++;
      punctualityAgg[s.userId].totalLateMin += lateMin;
      punctualityAgg[s.userId].lateCount++;
    }
  }
  const punctuality = Object.entries(punctualityAgg)
    .filter(([, v]) => v.matched >= 3)
    .map(([userId, v]) => ({
      userId,
      name: nameOf(userId),
      shiftsMatched: v.matched,
      latePctOver5Min: v.matched > 0 ? v.lateOver5 / v.matched : 0,
      avgLateMinutes: v.lateCount > 0 ? v.totalLateMin / v.lateCount : 0,
    }))
    .sort((a, b) => b.latePctOver5Min - a.latePctOver5Min);

  // SOP mastery per employee: completion rate of SOP executions they started.
  const sopMasteryAgg: Record<string, { started: number; completed: number }> = {};
  for (const e of allSopExecs) {
    if (!e.employeeId) continue;
    if (!sopMasteryAgg[e.employeeId]) sopMasteryAgg[e.employeeId] = { started: 0, completed: 0 };
    sopMasteryAgg[e.employeeId].started++;
    if (e.status === "completed") sopMasteryAgg[e.employeeId].completed++;
  }
  const sopMastery = Object.entries(sopMasteryAgg)
    .filter(([, v]) => v.started >= 2)
    .map(([userId, v]) => ({
      userId,
      name: nameOf(userId),
      started: v.started,
      completed: v.completed,
      completionRate: v.started > 0 ? v.completed / v.started : 0,
    }))
    .sort((a, b) => a.completionRate - b.completionRate);

  // Kudos participation
  const kudosAgg: Record<string, { received: number; sent: number }> = {};
  for (const id of teamUserIds) kudosAgg[id] = { received: 0, sent: 0 };
  for (const k of allKudos) {
    if (k.toEmployeeId) (kudosAgg[k.toEmployeeId] ||= { received: 0, sent: 0 }).received++;
    if (k.fromEmployeeId) (kudosAgg[k.fromEmployeeId] ||= { received: 0, sent: 0 }).sent++;
  }
  const kudosParticipation = Object.entries(kudosAgg)
    .map(([userId, v]) => ({ userId, name: nameOf(userId), kudosReceived: v.received, kudosSent: v.sent }))
    .sort((a, b) => b.kudosReceived - a.kudosReceived);

  // Quiet performers: showed up reliably (>=3 matched shifts, low lateness)
  // AND finished SOPs they started, but received 0 kudos. Useful coaching
  // nudge: managers should explicitly recognise them.
  const quietPerformers: Array<{ userId: string; name: string; reason: string }> = [];
  for (const userId of teamUserIds) {
    const punct = punctualityAgg[userId];
    const sop = sopMasteryAgg[userId];
    const kud = kudosAgg[userId] || { received: 0, sent: 0 };
    const reliable = punct && punct.matched >= 3 && (punct.lateOver5 / punct.matched) <= 0.1;
    const sopStrong = sop && sop.started >= 2 && (sop.completed / sop.started) >= 0.85;
    if (reliable && sopStrong && kud.received === 0) {
      quietPerformers.push({
        userId,
        name: nameOf(userId),
        reason: `${punct.matched} shifts on time, ${sop.completed}/${sop.started} SOPs completed, 0 kudos received`,
      });
    }
  }

  return {
    storeId,
    storeName,
    window,
    schedules: {
      total: allSchedules.length,
      byDayOfWeek: dayBuckets,
      coverageGaps,
      totalHoursScheduled,
      actualHoursWorked,
      coverageRatio,
    },
    tasks: {
      total: allTasks.length,
      completed: tCompleted.length,
      cancelled: tCancelled.length,
      pending: tPending.length,
      overdueCount: tOverdue.length,
      completionRate: allTasks.length > 0 ? tCompleted.length / allTasks.length : 0,
      avgDaysToComplete,
      pendingOver3Days: tPendingOver3Days,
      byAssignee,
      byPriority,
      recurringTasksWithLowCompletion,
    },
    issues: {
      total: allIssues.length,
      open: iOpen.length,
      resolved: iResolved.length,
      avgResolutionHours,
      byCategory: issueCatAgg,
      recurringCategories,
      unresolvedAgingDays,
      highPriorityOpen,
    },
    sops: {
      totalExecutions: allSopExecs.length,
      completed: sopCompleted,
      completionRate: allSopExecs.length > 0 ? sopCompleted / allSopExecs.length : 0,
      topIncompleteTemplates,
    },
    attendance: {
      totalShifts: allSchedules.length,
      actualClockIns: allTimeEntries.length,
      noShowEstimate,
      avgShiftHours,
    },
    team: {
      punctuality,
      sopMastery,
      kudosParticipation,
      quietPerformers,
    },
    feedbackContext,
  };
}

export function summarizeForAI(agg: OperationsAggregate): string {
  const pct = (n: number) => `${Math.round(n * 100)}%`;
  const fix1 = (n: number | null) => n === null ? "n/a" : n.toFixed(1);

  const dayBuckets = Object.values(agg.schedules.byDayOfWeek)
    .sort((a, b) => DAY_NAMES.indexOf(a.day) - DAY_NAMES.indexOf(b.day))
    .map(b => `${b.day}: ${b.count} shifts / ${b.coveredHours.toFixed(1)}h`)
    .join("; ");

  const gapList = agg.schedules.coverageGaps.length === 0
    ? "(none)"
    : agg.schedules.coverageGaps.map(g => `${g.date} (${g.day}): ${g.scheduledCount} staff, ${g.hoursCovered.toFixed(1)}h`).join(", ");

  const slowAssignees = agg.tasks.byAssignee
    .filter(a => a.total >= 3 && a.rate < 0.6)
    .slice(0, 5)
    .map(a => `${a.name}: ${a.completed}/${a.total} (${pct(a.rate)})`)
    .join("; ") || "(none)";

  const overdueTasks = agg.tasks.pendingOver3Days.length === 0
    ? "(none)"
    : agg.tasks.pendingOver3Days.map(t => `"${t.title}" — ${t.ageDays}d old${t.assignedTo ? ` (${t.assignedTo})` : ""}`).join("; ");

  const recurringTasks = agg.tasks.recurringTasksWithLowCompletion.length === 0
    ? "(none)"
    : agg.tasks.recurringTasksWithLowCompletion.map(t => `"${t.title}": ${t.completed}/${t.total} (${pct(t.rate)})`).join("; ");

  const recurringIssues = agg.issues.recurringCategories.length === 0
    ? "(none)"
    : agg.issues.recurringCategories.map(c => `${c.category}: ${c.count}x`).join("; ");

  const agingIssues = agg.issues.unresolvedAgingDays.length === 0
    ? "(none)"
    : agg.issues.unresolvedAgingDays.map(i => `"${i.title}" (${i.category}, ${i.priority}, ${i.ageDays}d old)`).join("; ");

  const lowSops = agg.sops.topIncompleteTemplates.length === 0
    ? "(none)"
    : agg.sops.topIncompleteTemplates.map(s => `"${s.title}": ${s.completed}/${s.started} (${pct(s.rate)})`).join("; ");

  const dismissals = agg.feedbackContext.recentDismissals.length === 0
    ? "(no recent dismissals)"
    : agg.feedbackContext.recentDismissals.slice(0, 8).map(d =>
        `[${d.daysAgo}d ago, ${d.insightType}] "${d.observation.slice(0, 100)}"${d.dismissReason ? ` — reason: ${d.dismissReason.slice(0, 60)}` : ""}`
      ).join("\n");

  const actedOn = agg.feedbackContext.recentActedOn.length === 0
    ? "(no recent acted-on insights)"
    : agg.feedbackContext.recentActedOn.slice(0, 5).map(a =>
        `[${a.daysAgo}d ago, ${a.insightType}] "${a.observation.slice(0, 100)}"`
      ).join("\n");

  const punctualityLine = agg.team.punctuality.length === 0
    ? "(no matched shifts to score)"
    : agg.team.punctuality.slice(0, 8).map(p =>
        `${p.name}: late ${pct(p.latePctOver5Min)} of ${p.shiftsMatched} matched shifts (avg ${p.avgLateMinutes.toFixed(1)}m late)`
      ).join("; ");

  const sopMasteryLine = agg.team.sopMastery.length === 0
    ? "(no SOP executions to score)"
    : agg.team.sopMastery.slice(0, 8).map(s =>
        `${s.name}: ${s.completed}/${s.started} SOPs completed (${pct(s.completionRate)})`
      ).join("; ");

  const kudosLine = agg.team.kudosParticipation.length === 0
    ? "(no kudos activity)"
    : agg.team.kudosParticipation.slice(0, 8).map(k =>
        `${k.name}: ${k.kudosReceived} received / ${k.kudosSent} sent`
      ).join("; ");

  const quietLine = agg.team.quietPerformers.length === 0
    ? "(none)"
    : agg.team.quietPerformers.slice(0, 5).map(q => `${q.name} — ${q.reason}`).join("; ");

  return `OPERATIONS SUMMARY for ${agg.storeName} (${agg.window.label}, ${agg.window.start.toISOString().slice(0,10)} → ${agg.window.end.toISOString().slice(0,10)})

SCHEDULING:
- Total scheduled shifts: ${agg.schedules.total}
- Hours scheduled: ${agg.schedules.totalHoursScheduled.toFixed(1)} | Hours actually worked: ${agg.schedules.actualHoursWorked.toFixed(1)} | Coverage ratio: ${pct(agg.schedules.coverageRatio)}
- Day-of-week distribution: ${dayBuckets || "(no shifts)"}
- Days with coverage gaps (<2 staff or <6h): ${gapList}
- No-show estimate (scheduled but no clock-in match): ${agg.attendance.noShowEstimate}

TASKS:
- Total ${agg.tasks.total} | Completed ${agg.tasks.completed} (${pct(agg.tasks.completionRate)}) | Pending ${agg.tasks.pending} | Overdue ${agg.tasks.overdueCount} | Cancelled ${agg.tasks.cancelled}
- Avg days to complete: ${fix1(agg.tasks.avgDaysToComplete)}
- Tasks pending >3 days: ${overdueTasks}
- Assignees with low completion rate (<60%, ≥3 tasks): ${slowAssignees}
- Recurring tasks with low completion (<70%): ${recurringTasks}

ISSUES:
- Total ${agg.issues.total} | Open ${agg.issues.open} | Resolved ${agg.issues.resolved} | High-priority still open: ${agg.issues.highPriorityOpen}
- Avg resolution time: ${fix1(agg.issues.avgResolutionHours)}h
- Recurring categories (≥3 occurrences): ${recurringIssues}
- Aging unresolved issues: ${agingIssues}

SOP EXECUTIONS:
- Total ${agg.sops.totalExecutions} | Completed ${agg.sops.completed} (${pct(agg.sops.completionRate)})
- SOPs with low completion rate: ${lowSops}

ATTENDANCE:
- Total shifts ${agg.attendance.totalShifts} | Actual clock-ins ${agg.attendance.actualClockIns} | Avg shift length ${fix1(agg.attendance.avgShiftHours)}h

TEAM PERFORMANCE (per-employee, manager-only signals):
- Punctuality (late = >5 min after schedule start, ≥3 matched shifts): ${punctualityLine}
- SOP mastery (≥2 started): ${sopMasteryLine}
- Kudos participation in window: ${kudosLine}
- Quiet performers (reliable + strong SOPs but 0 kudos received — coaching nudge): ${quietLine}

TEAM FEEDBACK SIGNAL (last 30 days):
Recent dismissals (the team did NOT find these helpful — avoid resurfacing similar):
${dismissals}

Recent acted-on insights (the team found these valuable — pattern is good):
${actedOn}`;
}

// ── Acted-on outcome computation ────────────────────────────────────────────
// For an insight that's been acted on, build a short, human-readable line that
// closes the loop on AI Insights: was the linked task done, and did the
// underlying signal move in the right direction since?
//
// Inputs are kept loose (Pick<>-style) so we don't have to import the full
// table types here.
export interface ActedOnInsightLite {
  storeId: string;
  affectedArea: string;
  insightType: string;
  actedOnAt: Date | string | null;
  dataPayload?: unknown;
}

export interface LinkedTaskLite {
  id: string;
  status: string | null;
  completedAt: Date | string | null;
  createdAt: Date | string | null;
}

export interface ActedOnOutcome {
  taskStatus: "pending" | "in_progress" | "completed" | "cancelled" | "unknown";
  daysSinceActedOn: number;
  daysToComplete: number | null;
  summary: string;
}

function pickFirstCategory(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const p = payload as Record<string, unknown>;
  const recurring = p.recurringCategories;
  if (Array.isArray(recurring) && recurring.length > 0) {
    const first = recurring[0] as { category?: unknown };
    if (first && typeof first.category === "string") return first.category;
  }
  const aging = p.unresolvedAgingDays;
  if (Array.isArray(aging) && aging.length > 0) {
    const first = aging[0] as { category?: unknown };
    if (first && typeof first.category === "string") return first.category;
  }
  return null;
}

export async function computeActedOnOutcome(
  insight: ActedOnInsightLite,
  linkedTask: LinkedTaskLite | null,
): Promise<ActedOnOutcome> {
  const actedAt = insight.actedOnAt ? new Date(insight.actedOnAt) : null;
  const now = new Date();

  if (!actedAt || isNaN(actedAt.getTime())) {
    return { taskStatus: "unknown", daysSinceActedOn: 0, daysToComplete: null, summary: "Outcome not yet measurable." };
  }

  const sinceMs = Math.max(now.getTime() - actedAt.getTime(), 0);
  const daysSinceActedOn = Math.max(0, Math.floor(sinceMs / 86400000));

  // ── Status fragment ──────────────────────────────────────────────────────
  let taskStatus: ActedOnOutcome["taskStatus"] = "unknown";
  let daysToComplete: number | null = null;
  let statusFragment: string;

  if (!linkedTask) {
    statusFragment = `Acted on ${daysSinceActedOn}d ago (task no longer found)`;
  } else {
    const status = (linkedTask.status || "pending").toLowerCase();
    if (status === "completed") {
      taskStatus = "completed";
      const completedAt = linkedTask.completedAt ? new Date(linkedTask.completedAt) : null;
      if (completedAt && !isNaN(completedAt.getTime())) {
        daysToComplete = Math.max(0, Math.floor((completedAt.getTime() - actedAt.getTime()) / 86400000));
      }
      statusFragment = daysToComplete !== null
        ? `Completed in ${daysToComplete}d`
        : "Completed";
    } else if (status === "in_progress") {
      taskStatus = "in_progress";
      statusFragment = `In progress (${daysSinceActedOn}d open)`;
    } else if (status === "cancelled") {
      taskStatus = "cancelled";
      statusFragment = "Task cancelled — no change measured";
    } else {
      taskStatus = "pending";
      statusFragment = `Still pending after ${daysSinceActedOn}d`;
    }
  }

  // ── Area-specific delta ──────────────────────────────────────────────────
  // Compare an equal-length window BEFORE actedOnAt to the window AFTER it.
  // If the team only acted today, fall back to a 7-day window so we always
  // have something meaningful to compare against.
  const windowMs = Math.max(sinceMs, 7 * 86400000);
  const beforeStart = new Date(actedAt.getTime() - windowMs);
  const beforeEnd = actedAt;
  const afterStart = actedAt;

  let deltaFragment = "";

  try {
    if (insight.affectedArea === "issues") {
      const targetCategory = pickFirstCategory(insight.dataPayload);
      const issueWhereBase = (start: Date, end?: Date) => {
        const conds = [
          eq(issues.storeId, insight.storeId),
          gte(issues.createdAt, start),
        ];
        if (end) conds.push(lte(issues.createdAt, end));
        if (targetCategory) conds.push(eq(issues.category, targetCategory));
        return and(...conds);
      };
      const [beforeRows, afterRows] = await Promise.all([
        db.select({ c: count() }).from(issues).where(issueWhereBase(beforeStart, beforeEnd)),
        db.select({ c: count() }).from(issues).where(issueWhereBase(afterStart)),
      ]);
      const before = Number(beforeRows[0]?.c || 0);
      const after = Number(afterRows[0]?.c || 0);
      if (before > 0 || after > 0) {
        const arrow = after < before ? "↓" : after > before ? "↑" : "→";
        const label = targetCategory ? `${targetCategory} issues` : "issues";
        if (before > 0) {
          const pctChange = Math.round(((after - before) / before) * 100);
          const sign = pctChange > 0 ? "+" : "";
          deltaFragment = `${label} ${arrow} ${before}→${after} (${sign}${pctChange}%)`;
        } else {
          deltaFragment = `${label} ${arrow} 0→${after}`;
        }
      }
    } else if (insight.affectedArea === "tasks") {
      const taskConds = (start: Date, end: Date | null, completedOnly: boolean) => {
        const conds = [
          eq(tasks.locationId, insight.storeId),
          gte(tasks.createdAt, start),
        ];
        if (end) conds.push(lte(tasks.createdAt, end));
        if (completedOnly) conds.push(eq(tasks.status, "completed"));
        return and(...conds);
      };
      const [beforeAll, beforeDone, afterAll, afterDone] = await Promise.all([
        db.select({ c: count() }).from(tasks).where(taskConds(beforeStart, beforeEnd, false)),
        db.select({ c: count() }).from(tasks).where(taskConds(beforeStart, beforeEnd, true)),
        db.select({ c: count() }).from(tasks).where(taskConds(afterStart, null, false)),
        db.select({ c: count() }).from(tasks).where(taskConds(afterStart, null, true)),
      ]);
      const beforeTot = Number(beforeAll[0]?.c || 0);
      const afterTot = Number(afterAll[0]?.c || 0);
      const beforeRate = beforeTot > 0 ? Number(beforeDone[0]?.c || 0) / beforeTot : null;
      const afterRate = afterTot > 0 ? Number(afterDone[0]?.c || 0) / afterTot : null;
      if (beforeRate !== null && afterRate !== null) {
        const beforePct = Math.round(beforeRate * 100);
        const afterPct = Math.round(afterRate * 100);
        const diff = afterPct - beforePct;
        const arrow = diff > 0 ? "↑" : diff < 0 ? "↓" : "→";
        const sign = diff > 0 ? "+" : "";
        deltaFragment = `task completion ${arrow} ${beforePct}%→${afterPct}% (${sign}${diff}pts)`;
      } else if (afterRate !== null) {
        deltaFragment = `task completion now ${Math.round(afterRate * 100)}%`;
      }
    } else if (insight.affectedArea === "scheduling") {
      // Use no-show estimate (scheduled shifts without matching clock-in) as
      // the proxy for scheduling health since it's the cheapest comparable
      // signal across windows.
      const scheduleCount = (start: Date, end?: Date) => {
        const conds = [
          eq(schedules.locationId, insight.storeId),
          gte(schedules.startTime, start),
        ];
        if (end) conds.push(lte(schedules.startTime, end));
        return db.select({ c: count() }).from(schedules).where(and(...conds));
      };
      const clockInCount = (start: Date, end?: Date) => {
        const conds = [
          eq(timeEntries.locationId, insight.storeId),
          gte(timeEntries.clockInTime, start),
        ];
        if (end) conds.push(lte(timeEntries.clockInTime, end));
        return db.select({ c: count() }).from(timeEntries).where(and(...conds));
      };
      const [bSched, bClock, aSched, aClock] = await Promise.all([
        scheduleCount(beforeStart, beforeEnd),
        clockInCount(beforeStart, beforeEnd),
        scheduleCount(afterStart),
        clockInCount(afterStart),
      ]);
      const beforeNoShow = Math.max(Number(bSched[0]?.c || 0) - Number(bClock[0]?.c || 0), 0);
      const afterNoShow = Math.max(Number(aSched[0]?.c || 0) - Number(aClock[0]?.c || 0), 0);
      if (beforeNoShow > 0 || afterNoShow > 0) {
        const arrow = afterNoShow < beforeNoShow ? "↓" : afterNoShow > beforeNoShow ? "↑" : "→";
        deltaFragment = `no-show estimate ${arrow} ${beforeNoShow}→${afterNoShow}`;
      }
    }
    // (team) intentionally has no aggregate delta — coaching outcomes are
    // qualitative, so we let the task status fragment carry the message.
  } catch (err: any) {
    logger.warn(
      { error: err?.message, area: insight.affectedArea },
      "[OperationsIntelligence] Outcome delta computation failed",
    );
  }

  const summary = deltaFragment ? `${statusFragment} • ${deltaFragment}` : statusFragment;
  return { taskStatus, daysSinceActedOn, daysToComplete, summary };
}

export async function getStoreIdsWithActivity(): Promise<string[]> {
  try {
    const rows = await db.select({ id: workLocations.id })
      .from(workLocations)
      .where(eq(workLocations.isActive, true));
    return rows.map(r => r.id);
  } catch (err: any) {
    logger.warn({ error: err.message }, "[OperationsIntelligence] Failed to list active stores");
    return [];
  }
}
