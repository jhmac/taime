import { anthropic, withAiContext } from "../lib/aiClients";
import { db } from "../db";
import { eq, and, gte, desc, sql, count, avg, lte, inArray } from "drizzle-orm";
import { notificationService } from "./notificationService";
import {
  backgroundInsights,
  schedules,
  tasks,
  issues,
  sopExecutions,
  sopStepCompletions,
  workLocations,
  shops,
  shopifyOrders,
  clockEvents,
  timeEntries,
  users,
  companySettings,
  roles,
} from "@shared/schema";
import { isNull, isNotNull } from "drizzle-orm";
import logger from "../lib/logger";

interface InsightResult {
  insightType: string;
  severity: string;
  headline: string;
  detail: string;
  recommendation: string;
  dataPayload?: Record<string, unknown>;
  expiresAt?: Date;
}

async function callClaude(systemPrompt: string, userPrompt: string): Promise<string | null> {
  try {
    const result = await Promise.race([
      anthropic.messages.create({
        model: "claude-sonnet-4-20250514",
        max_tokens: 2000,
        system: systemPrompt,
        messages: [{ role: "user", content: userPrompt }],
      }),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("AI timeout")), 15000)),
    ]);
    const block = result.content[0];
    return block.type === "text" ? block.text : null;
  } catch (err: any) {
    logger.error({ error: err.message }, "[BackgroundInsights] Claude call failed");
    return null;
  }
}

async function getShopifyOrdersForStore(storeId: string, daysBack: number) {
  const cutoff = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000);
  const [location] = await db.select().from(workLocations).where(eq(workLocations.id, storeId));
  if (!location) return [];

  const allShops = await db.select().from(shops);
  if (allShops.length === 0) return [];

  const shopDomain = allShops[0].shopDomain;
  const orders = await db.select().from(shopifyOrders)
    .where(and(
      eq(shopifyOrders.shopDomain, shopDomain),
      gte(shopifyOrders.orderCreatedAt, cutoff),
    ))
    .orderBy(shopifyOrders.orderCreatedAt);
  return orders;
}

export async function analyzeStaffingPatterns(storeId: string): Promise<InsightResult[]> {
  try {
    const fourWeeksAgo = new Date(Date.now() - 28 * 24 * 60 * 60 * 1000);

    const orders = await getShopifyOrdersForStore(storeId, 28);
    const storeSchedules = await db.select().from(schedules)
      .where(and(
        eq(schedules.locationId, storeId),
        gte(schedules.startTime, fourWeeksAgo),
      ));

    if (orders.length === 0 && storeSchedules.length === 0) return [];

    const salesByDayHour: Record<string, { total: number; count: number }> = {};
    for (const order of orders) {
      if (!order.orderCreatedAt) continue;
      const d = new Date(order.orderCreatedAt);
      const key = `${d.getDay()}-${d.getHours()}`;
      if (!salesByDayHour[key]) salesByDayHour[key] = { total: 0, count: 0 };
      salesByDayHour[key].total += parseFloat(order.totalPrice?.toString() || "0");
      salesByDayHour[key].count++;
    }

    const staffByDayHour: Record<string, number> = {};
    for (const sched of storeSchedules) {
      const start = new Date(sched.startTime);
      const end = new Date(sched.endTime);
      for (let h = start.getHours(); h < end.getHours(); h++) {
        const key = `${start.getDay()}-${h}`;
        staffByDayHour[key] = (staffByDayHour[key] || 0) + 1;
      }
    }

    const dayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
    const summaryLines: string[] = [];
    for (const [key, sales] of Object.entries(salesByDayHour)) {
      const [day, hour] = key.split("-").map(Number);
      const staff = staffByDayHour[key] || 0;
      if (sales.count > 2) {
        summaryLines.push(`${dayNames[day]} ${hour}:00 — $${Math.round(sales.total / 4)}/hr avg, ${staff} staff`);
      }
    }

    if (summaryLines.length === 0) return [];

    const aiResponse = await callClaude(
      "You are a retail staffing analyst. Output JSON array of insights. Each: {headline, detail, recommendation, severity}. severity: info|suggestion|warning|action_needed. Only flag mismatches where the gap is significant (>30% difference). If no issues, return [].",
      `Hourly sales data vs staffing levels (last 4 weeks, weekly averages):\n${summaryLines.join("\n")}\n\nIdentify scheduling optimization opportunities. Be specific about times and staff counts.`,
    );

    if (!aiResponse) return [];
    try {
      const parsed = JSON.parse(aiResponse.replace(/```json?\n?/g, "").replace(/```/g, "").trim());
      return (Array.isArray(parsed) ? parsed : []).map((p: any) => ({
        insightType: "staffing",
        severity: p.severity || "suggestion",
        headline: p.headline || "Staffing pattern detected",
        detail: p.detail || "",
        recommendation: p.recommendation || "",
        dataPayload: { salesByDayHour, staffByDayHour },
      }));
    } catch { return []; }
  } catch (err: any) {
    logger.error({ error: err.message, storeId }, "[BackgroundInsights] Staffing analysis failed");
    return [];
  }
}

export async function analyzeTaskCompletionPatterns(storeId: string): Promise<InsightResult[]> {
  try {
    const twoWeeksAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);

    const storeTasks = await db.select().from(tasks)
      .where(and(
        eq(tasks.locationId, storeId),
        gte(tasks.createdAt, twoWeeksAgo),
      ));

    if (storeTasks.length < 5) return [];

    const totalTasks = storeTasks.length;
    const completed = storeTasks.filter(t => t.status === "completed").length;
    const cancelled = storeTasks.filter(t => t.status === "cancelled").length;
    const overdue = storeTasks.filter(t => t.status === "pending" && t.dueDate && new Date(t.dueDate) < new Date()).length;

    const byAssignee: Record<string, { total: number; completed: number }> = {};
    for (const t of storeTasks) {
      const key = t.assignedTo || "unassigned";
      if (!byAssignee[key]) byAssignee[key] = { total: 0, completed: 0 };
      byAssignee[key].total++;
      if (t.status === "completed") byAssignee[key].completed++;
    }

    const byDay: Record<string, { total: number; completed: number }> = {};
    for (const t of storeTasks) {
      if (!t.createdAt) continue;
      const day = new Date(t.createdAt).toISOString().slice(0, 10);
      if (!byDay[day]) byDay[day] = { total: 0, completed: 0 };
      byDay[day].total++;
      if (t.status === "completed") byDay[day].completed++;
    }

    const aiResponse = await callClaude(
      "You are a retail operations analyst. Output JSON array of insights. Each: {headline, detail, recommendation, severity}. severity: info|suggestion|warning|action_needed. If no issues, return [].",
      `Task completion data (last 2 weeks):\nTotal: ${totalTasks}, Completed: ${completed} (${Math.round(completed / totalTasks * 100)}%), Cancelled: ${cancelled}, Overdue: ${overdue}\n\nBy employee:\n${Object.entries(byAssignee).map(([k, v]) => `${k}: ${v.completed}/${v.total} completed`).join("\n")}\n\nDetect anomalies: completion rate drops, consistently incomplete tasks, or employees needing support.`,
    );

    if (!aiResponse) return [];
    try {
      const parsed = JSON.parse(aiResponse.replace(/```json?\n?/g, "").replace(/```/g, "").trim());
      return (Array.isArray(parsed) ? parsed : []).map((p: any) => ({
        insightType: "task_anomaly",
        severity: p.severity || "suggestion",
        headline: p.headline || "Task pattern detected",
        detail: p.detail || "",
        recommendation: p.recommendation || "",
        dataPayload: { totalTasks, completed, cancelled, overdue },
      }));
    } catch { return []; }
  } catch (err: any) {
    logger.error({ error: err.message, storeId }, "[BackgroundInsights] Task analysis failed");
    return [];
  }
}

export async function generateSchedulingSuggestions(storeId: string): Promise<InsightResult[]> {
  try {
    const orders = await getShopifyOrdersForStore(storeId, 28);
    if (orders.length === 0) return [];

    const now = new Date();
    const nextWeek: { date: string; dayOfWeek: number; dayName: string }[] = [];
    const dayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

    for (let i = 1; i <= 7; i++) {
      const d = new Date(now.getTime() + i * 24 * 60 * 60 * 1000);
      nextWeek.push({ date: d.toISOString().slice(0, 10), dayOfWeek: d.getDay(), dayName: dayNames[d.getDay()] });
    }

    const salesByDow: Record<number, number[]> = {};
    for (const order of orders) {
      if (!order.orderCreatedAt) continue;
      const d = new Date(order.orderCreatedAt);
      const dow = d.getDay();
      if (!salesByDow[dow]) salesByDow[dow] = [];
      salesByDow[dow].push(parseFloat(order.totalPrice?.toString() || "0"));
    }

    const avgSalesByDow: Record<number, number> = {};
    for (const [dow, sales] of Object.entries(salesByDow)) {
      avgSalesByDow[Number(dow)] = Math.round(sales.reduce((a, b) => a + b, 0) / Math.max(sales.length, 1));
    }

    const futureSchedules = await db.select().from(schedules)
      .where(and(
        eq(schedules.locationId, storeId),
        gte(schedules.startTime, now),
        lte(schedules.startTime, new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000)),
      ));

    const staffByDate: Record<string, number> = {};
    for (const s of futureSchedules) {
      const date = new Date(s.startTime).toISOString().slice(0, 10);
      staffByDate[date] = (staffByDate[date] || 0) + 1;
    }

    const forecastLines = nextWeek.map(d => {
      const avgSales = avgSalesByDow[d.dayOfWeek] || 0;
      const staff = staffByDate[d.date] || 0;
      return `${d.dayName} (${d.date}): ~$${avgSales} predicted sales, ${staff} staff scheduled`;
    });

    const aiResponse = await callClaude(
      "You are a retail scheduling advisor. Output JSON array of insights. Each: {headline, detail, recommendation, severity}. severity: info|suggestion|warning|action_needed. Only flag days needing attention. If all looks good, return [].",
      `Next week forecast based on last 4 weeks:\n${forecastLines.join("\n")}\n\nSuggest staff count adjustments for days that look over or understaffed based on predicted sales.`,
    );

    if (!aiResponse) return [];
    try {
      const parsed = JSON.parse(aiResponse.replace(/```json?\n?/g, "").replace(/```/g, "").trim());
      return (Array.isArray(parsed) ? parsed : []).map((p: any) => ({
        insightType: "predictive_schedule",
        severity: p.severity || "suggestion",
        headline: p.headline || "Scheduling suggestion",
        detail: p.detail || "",
        recommendation: p.recommendation || "",
        dataPayload: { avgSalesByDow, staffByDate },
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      }));
    } catch { return []; }
  } catch (err: any) {
    logger.error({ error: err.message, storeId }, "[BackgroundInsights] Scheduling suggestions failed");
    return [];
  }
}

export async function detectRecurringIssues(storeId: string): Promise<InsightResult[]> {
  try {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    const storeIssues = await db.select().from(issues)
      .where(and(
        eq(issues.storeId, storeId),
        gte(issues.createdAt, thirtyDaysAgo),
      ))
      .orderBy(desc(issues.createdAt));

    if (storeIssues.length < 3) return [];

    const byCategory: Record<string, { count: number; titles: string[] }> = {};
    for (const issue of storeIssues) {
      if (!byCategory[issue.category]) byCategory[issue.category] = { count: 0, titles: [] };
      byCategory[issue.category].count++;
      if (byCategory[issue.category].titles.length < 5) {
        byCategory[issue.category].titles.push(issue.title);
      }
    }

    const recurring = Object.entries(byCategory).filter(([_, v]) => v.count >= 3);
    if (recurring.length === 0) return [];

    const sopFeedback = await db.select().from(sopExecutions)
      .where(and(
        eq(sopExecutions.storeId, storeId),
        eq(sopExecutions.status, "completed"),
        gte(sopExecutions.createdAt, thirtyDaysAgo),
      ));
    const feedbackNotes = sopFeedback
      .filter(e => e.notes && e.notes.trim().length > 5)
      .map(e => e.notes)
      .slice(0, 20);

    const issueList = recurring.map(([cat, data]) =>
      `${cat}: ${data.count}x in 30 days — ${data.titles.join("; ")}`
    ).join("\n");

    const feedbackSection = feedbackNotes.length > 0
      ? `\n\n"What Bugged You?" feedback:\n${feedbackNotes.join("\n")}`
      : "";

    const aiResponse = await callClaude(
      "You are a retail operations root-cause analyst. Output JSON array of insights. Each: {headline, detail, recommendation, severity}. severity: info|suggestion|warning|action_needed. Focus on systemic fixes.",
      `Recurring issues (last 30 days):\n${issueList}${feedbackSection}\n\nIdentify root causes and suggest systemic fixes (not just treating symptoms). Example: "Fitting room cleanliness 4x/month → Add midday fitting room reset to daily checklist."`,
    );

    if (!aiResponse) return [];
    try {
      const parsed = JSON.parse(aiResponse.replace(/```json?\n?/g, "").replace(/```/g, "").trim());
      return (Array.isArray(parsed) ? parsed : []).map((p: any) => ({
        insightType: "recurring_issue",
        severity: p.severity || "warning",
        headline: p.headline || "Recurring issue pattern",
        detail: p.detail || "",
        recommendation: p.recommendation || "",
        dataPayload: { recurring: Object.fromEntries(recurring) },
      }));
    } catch { return []; }
  } catch (err: any) {
    logger.error({ error: err.message, storeId }, "[BackgroundInsights] Recurring issues analysis failed");
    return [];
  }
}

export async function analyzeSalesTrends(storeId: string): Promise<InsightResult[]> {
  try {
    const orders = await getShopifyOrdersForStore(storeId, 28);
    if (orders.length < 5) return [];

    const twoWeeksAgo = Date.now() - 14 * 24 * 60 * 60 * 1000;
    const thisWeek = orders.filter(o => o.orderCreatedAt && new Date(o.orderCreatedAt).getTime() >= twoWeeksAgo);
    const lastWeek = orders.filter(o => o.orderCreatedAt && new Date(o.orderCreatedAt).getTime() < twoWeeksAgo);

    const thisWeekRevenue = thisWeek.reduce((sum, o) => sum + parseFloat(o.totalPrice?.toString() || "0"), 0);
    const lastWeekRevenue = lastWeek.reduce((sum, o) => sum + parseFloat(o.totalPrice?.toString() || "0"), 0);
    const weekOverWeekChange = lastWeekRevenue > 0
      ? Math.round(((thisWeekRevenue - lastWeekRevenue) / lastWeekRevenue) * 100)
      : 0;

    const dayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
    const revenueByDay: Record<number, number> = {};
    for (const order of orders) {
      if (!order.orderCreatedAt) continue;
      const dow = new Date(order.orderCreatedAt).getDay();
      revenueByDay[dow] = (revenueByDay[dow] || 0) + parseFloat(order.totalPrice?.toString() || "0");
    }

    const dayPerformance = Object.entries(revenueByDay)
      .map(([dow, rev]) => ({ day: dayNames[Number(dow)], revenue: Math.round(rev) }))
      .sort((a, b) => b.revenue - a.revenue);

    const aiResponse = await callClaude(
      "You are a retail sales analyst. Output JSON array of insights (max 3). Each: {headline, detail, recommendation, severity}. severity: info|suggestion|warning|action_needed.",
      `Sales trends (last 4 weeks):\nThis 2 weeks: $${Math.round(thisWeekRevenue)}, Previous 2 weeks: $${Math.round(lastWeekRevenue)}\nChange: ${weekOverWeekChange > 0 ? "+" : ""}${weekOverWeekChange}%\nTotal orders: ${orders.length}\n\nBy day of week:\n${dayPerformance.map(d => `${d.day}: $${d.revenue}`).join("\n")}\n\nProvide brief, actionable insights about sales patterns and what to focus on.`,
    );

    if (!aiResponse) return [];
    try {
      const parsed = JSON.parse(aiResponse.replace(/```json?\n?/g, "").replace(/```/g, "").trim());
      return (Array.isArray(parsed) ? parsed : []).map((p: any) => ({
        insightType: "sales_trend",
        severity: p.severity || "info",
        headline: p.headline || "Sales trend detected",
        detail: p.detail || "",
        recommendation: p.recommendation || "",
        dataPayload: { thisWeekRevenue, lastWeekRevenue, weekOverWeekChange, dayPerformance },
      }));
    } catch { return []; }
  } catch (err: any) {
    logger.error({ error: err.message, storeId }, "[BackgroundInsights] Sales analysis failed");
    return [];
  }
}

export async function analyzeClockInAnomalies(storeId: string): Promise<InsightResult[]> {
  try {
    const twoWeeksAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);

    const storeUsers = await db.selectDistinct({ userId: timeEntries.userId })
      .from(timeEntries)
      .where(and(
        eq(timeEntries.locationId, storeId),
        gte(timeEntries.clockInTime, twoWeeksAgo),
      ));
    const storeUserIds = storeUsers.map(u => u.userId);
    if (storeUserIds.length === 0) return [];

    const events = await db.select({
      userId: clockEvents.userId,
      eventType: clockEvents.eventType,
      createdAt: clockEvents.createdAt,
    }).from(clockEvents)
      .where(and(
        gte(clockEvents.createdAt, twoWeeksAgo),
        inArray(clockEvents.userId, storeUserIds),
      ));

    if (events.length === 0) return [];

    const userNames: Record<string, string> = {};
    const storeUsersData = await db.select({ id: users.id, firstName: users.firstName, lastName: users.lastName }).from(users)
      .where(inArray(users.id, storeUserIds));
    for (const u of storeUsersData) {
      userNames[u.id] = `${u.firstName || ''} ${u.lastName || ''}`.trim() || u.id.slice(-6);
    }

    const userEvents: Record<string, Record<string, number>> = {};
    for (const e of events) {
      if (!userEvents[e.userId]) userEvents[e.userId] = {};
      userEvents[e.userId][e.eventType] = (userEvents[e.userId][e.eventType] || 0) + 1;
    }

    const insights: InsightResult[] = [];

    for (const [userId, counts] of Object.entries(userEvents)) {
      const name = userNames[userId] || userId.slice(-6);
      const lateCount = (counts['late-clock-in'] || 0) + (counts['excessive-late'] || 0);
      const geofenceCount = (counts['geofence-exit-out'] || 0) + (counts['geofence-denied'] || 0);
      const phoneCount = counts['app-switch-out'] || 0;

      if (lateCount >= 3) {
        const severity = lateCount >= 5 ? 'action_needed' : 'warning';
        insights.push({
          insightType: 'clock_in_anomaly',
          severity,
          headline: `${name} — Chronic Lateness (${lateCount} late arrivals in 2 weeks)`,
          detail: `${name} has been late ${lateCount} times in the past 14 days. This pattern may indicate scheduling conflicts or personal issues that should be addressed.`,
          recommendation: `Have a private conversation with ${name} about their attendance. Consider adjusting their schedule or identifying the root cause.`,
          dataPayload: { userId, eventCounts: counts, pattern: 'chronic_lateness', lateCount },
        });
      }

      if (geofenceCount >= 3) {
        const severity = geofenceCount >= 5 ? 'action_needed' : 'warning';
        insights.push({
          insightType: 'clock_in_anomaly',
          severity,
          headline: `${name} — Frequent Geofence Violations (${geofenceCount} in 2 weeks)`,
          detail: `${name} has left the work area or attempted to clock in from outside the geofence ${geofenceCount} times in 14 days.`,
          recommendation: `Check if ${name}'s work area includes all relevant spaces (parking lot, break area). If violations are legitimate, discuss expectations.`,
          dataPayload: { userId, eventCounts: counts, pattern: 'geofence_violations', geofenceCount },
        });
      }

      if (phoneCount >= 5) {
        const severity = phoneCount >= 8 ? 'action_needed' : 'warning';
        insights.push({
          insightType: 'clock_in_anomaly',
          severity,
          headline: `${name} — Excessive Phone Usage (${phoneCount} incidents in 2 weeks)`,
          detail: `${name} has switched away from the app ${phoneCount} times during shifts in the past 14 days, indicating potential phone distraction.`,
          recommendation: `Remind ${name} about the phone usage policy during work hours. Consider whether this correlates with productivity drops.`,
          dataPayload: { userId, eventCounts: counts, pattern: 'phone_usage', phoneCount },
        });
      }
    }

    logger.info({ storeId, anomalyCount: insights.length }, "[BackgroundInsights] Clock-in anomaly analysis complete");
    return insights;
  } catch (err: any) {
    logger.error({ error: err.message, storeId }, "[BackgroundInsights] Clock-in anomaly analysis failed");
    return [];
  }
}

export async function analyzePayrollAnomalies(storeId: string): Promise<InsightResult[]> {
  try {
    const insights: InsightResult[] = [];

    const storeUserRows = await db.selectDistinct({ userId: timeEntries.userId })
      .from(timeEntries)
      .where(eq(timeEntries.locationId, storeId));
    const storeUserIds = storeUserRows.map(u => u.userId);
    if (storeUserIds.length === 0) return [];

    const userNames: Record<string, string> = {};
    const storeUsersData = await db.select({ id: users.id, firstName: users.firstName, lastName: users.lastName }).from(users)
      .where(inArray(users.id, storeUserIds));
    for (const u of storeUsersData) {
      userNames[u.id] = `${u.firstName || ''} ${u.lastName || ''}`.trim() || u.id.slice(-6);
    }

    const twelveHoursAgo = new Date(Date.now() - 12 * 60 * 60 * 1000);
    const staleEntries = await db.select().from(timeEntries)
      .where(and(
        eq(timeEntries.locationId, storeId),
        isNull(timeEntries.clockOutTime),
        lte(timeEntries.clockInTime, twelveHoursAgo),
      ));

    for (const entry of staleEntries) {
      const name = userNames[entry.userId] || entry.userId.slice(-6);
      const clockIn = new Date(entry.clockInTime);
      const hoursOpen = Math.round((Date.now() - clockIn.getTime()) / 3600000);
      insights.push({
        insightType: 'payroll_anomaly',
        severity: 'action_needed',
        headline: `${name} — Missing Clock-Out (${hoursOpen}h open shift)`,
        detail: `${name} clocked in at ${clockIn.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })} but never clocked out. The shift has been open for ${hoursOpen} hours.`,
        recommendation: `Review and manually close this time entry. Check if ${name} forgot to clock out or if there was a system issue.`,
        dataPayload: { userId: entry.userId, timeEntryId: entry.id, clockInTime: entry.clockInTime, hoursOpen, pattern: 'missing_clock_out' },
      });
    }

    const activeEntries = await db.select({
      userId: timeEntries.userId,
      count: sql<number>`count(*)::int`,
    }).from(timeEntries)
      .where(and(
        eq(timeEntries.locationId, storeId),
        isNull(timeEntries.clockOutTime),
      ))
      .groupBy(timeEntries.userId)
      .having(sql`count(*) > 1`);

    for (const entry of activeEntries) {
      const name = userNames[entry.userId] || entry.userId.slice(-6);
      insights.push({
        insightType: 'payroll_anomaly',
        severity: 'action_needed',
        headline: `${name} — Duplicate Active Shifts (${entry.count} open entries)`,
        detail: `${name} has ${entry.count} active time entries simultaneously. This likely indicates a system glitch or forgotten clock-outs.`,
        recommendation: `Close the duplicate entries manually and investigate the cause. May need to adjust the final payroll totals.`,
        dataPayload: { userId: entry.userId, count: entry.count, pattern: 'duplicate_clock_in' },
      });
    }

    const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const weekEntries = await db.select().from(timeEntries)
      .where(and(
        eq(timeEntries.locationId, storeId),
        isNotNull(timeEntries.clockOutTime),
        gte(timeEntries.clockInTime, oneWeekAgo),
      ));

    for (const entry of weekEntries) {
      if (!entry.clockOutTime) continue;
      const clockIn = new Date(entry.clockInTime);
      const clockOut = new Date(entry.clockOutTime);
      const hours = (clockOut.getTime() - clockIn.getTime()) / 3600000;
      const name = userNames[entry.userId] || entry.userId.slice(-6);

      if (hours > 12) {
        insights.push({
          insightType: 'payroll_anomaly',
          severity: 'warning',
          headline: `${name} — Excessive Shift (${Math.round(hours)}h on ${clockIn.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })})`,
          detail: `${name} worked a ${Math.round(hours * 10) / 10}-hour shift on ${clockIn.toLocaleDateString()}. This exceeds the 12-hour threshold and may indicate a missed clock-out.`,
          recommendation: `Verify this was an actual extended shift. If it was a missed clock-out, adjust the time entry before processing payroll.`,
          dataPayload: { userId: entry.userId, timeEntryId: entry.id, hours: Math.round(hours * 10) / 10, pattern: 'excessive_hours' },
        });
      }

      if (hours < 0.25) {
        insights.push({
          insightType: 'payroll_anomaly',
          severity: 'suggestion',
          headline: `${name} — Suspicious Short Shift (${Math.round(hours * 60)}min on ${clockIn.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })})`,
          detail: `${name} had a ${Math.round(hours * 60)}-minute shift on ${clockIn.toLocaleDateString()}. This may be an accidental clock-in/out.`,
          recommendation: `Check if this was intentional. If accidental, delete the time entry to avoid payroll errors.`,
          dataPayload: { userId: entry.userId, timeEntryId: entry.id, minutes: Math.round(hours * 60), pattern: 'short_shift' },
        });
      }
    }

    const weeklyHours: Record<string, number> = {};
    for (const entry of weekEntries) {
      if (!entry.clockOutTime) continue;
      const hours = (new Date(entry.clockOutTime).getTime() - new Date(entry.clockInTime).getTime()) / 3600000;
      weeklyHours[entry.userId] = (weeklyHours[entry.userId] || 0) + hours;
    }
    for (const entry of staleEntries) {
      const hours = (Date.now() - new Date(entry.clockInTime).getTime()) / 3600000;
      weeklyHours[entry.userId] = (weeklyHours[entry.userId] || 0) + hours;
    }

    const [settings] = await db.select().from(companySettings).limit(1);
    const overtimeThreshold = settings?.overtimeThresholdHours || 40;

    for (const [userId, hours] of Object.entries(weeklyHours)) {
      if (hours > overtimeThreshold) {
        const name = userNames[userId] || userId.slice(-6);
        insights.push({
          insightType: 'payroll_anomaly',
          severity: hours > overtimeThreshold * 1.25 ? 'action_needed' : 'warning',
          headline: `${name} — Overtime Alert (${Math.round(hours)}h this week, threshold: ${overtimeThreshold}h)`,
          detail: `${name} has worked ${Math.round(hours * 10) / 10} hours this week, exceeding the ${overtimeThreshold}-hour overtime threshold by ${Math.round((hours - overtimeThreshold) * 10) / 10} hours.`,
          recommendation: `Review upcoming schedule for ${name}. Consider redistributing shifts to avoid further overtime costs.`,
          dataPayload: { userId, weeklyHours: Math.round(hours * 10) / 10, overtimeThreshold, excessHours: Math.round((hours - overtimeThreshold) * 10) / 10, pattern: 'overtime' },
        });
      }
    }

    logger.info({ storeId, anomalyCount: insights.length }, "[BackgroundInsights] Payroll anomaly analysis complete");
    return insights;
  } catch (err: any) {
    logger.error({ error: err.message, storeId }, "[BackgroundInsights] Payroll anomaly analysis failed");
    return [];
  }
}

export async function runAllInsightGenerators(storeId: string, types?: string[]): Promise<void> {
  const runTypes = types || ["staffing", "task_anomaly", "predictive_schedule", "recurring_issue", "sales_trend", "clock_in_anomaly", "payroll_anomaly"];
  const allInsights: InsightResult[] = [];

  const generators: [string, () => Promise<InsightResult[]>][] = [
    ["staffing", () => analyzeStaffingPatterns(storeId)],
    ["task_anomaly", () => analyzeTaskCompletionPatterns(storeId)],
    ["predictive_schedule", () => generateSchedulingSuggestions(storeId)],
    ["recurring_issue", () => detectRecurringIssues(storeId)],
    ["sales_trend", () => analyzeSalesTrends(storeId)],
    ["clock_in_anomaly", () => analyzeClockInAnomalies(storeId)],
    ["payroll_anomaly", () => analyzePayrollAnomalies(storeId)],
  ];

  for (const [type, fn] of generators) {
    if (!runTypes.includes(type)) continue;
    try {
      const results = await fn();
      allInsights.push(...results);
    } catch (err: any) {
      logger.error({ error: err.message, storeId, type }, "[BackgroundInsights] Generator failed");
    }
  }

  if (allInsights.length > 0) {
    for (const type of runTypes) {
      await db.delete(backgroundInsights).where(
        and(
          eq(backgroundInsights.storeId, storeId),
          eq(backgroundInsights.insightType, type),
          eq(backgroundInsights.status, "active"),
        )
      );
    }

    for (const insight of allInsights) {
      await db.insert(backgroundInsights).values({
        storeId,
        insightType: insight.insightType,
        severity: insight.severity,
        headline: insight.headline,
        detail: insight.detail,
        recommendation: insight.recommendation,
        dataPayload: insight.dataPayload || null,
        expiresAt: insight.expiresAt || null,
        status: "active",
      });
    }

    logger.info({ storeId, count: allInsights.length }, "[BackgroundInsights] Insights generated");

    const anomalyInsights = allInsights.filter(
      (i) => (i.insightType === 'clock_in_anomaly' || i.insightType === 'payroll_anomaly') && i.severity === 'action_needed'
    );

    if (anomalyInsights.length > 0) {
      try {
        const mgrRoles = await db.select({ id: roles.id }).from(roles)
          .where(inArray(roles.name, ['admin', 'owner', 'manager']));
        const roleIds = mgrRoles.map(r => r.id);

        if (roleIds.length > 0) {
          const managers = await db.select({ id: users.id }).from(users)
            .where(inArray(users.roleId, roleIds));

          for (const mgr of managers) {
            for (const anomaly of anomalyInsights.slice(0, 3)) {
              try {
                await notificationService.sendAnomalyAlert(
                  mgr.id,
                  anomaly.headline,
                  anomaly.detail,
                  anomaly.severity,
                  anomaly.insightType,
                );
              } catch (pushErr: any) {
                logger.warn({ error: pushErr.message, userId: mgr.id }, "[BackgroundInsights] Push notification failed");
              }
            }
          }
          logger.info({ storeId, managerCount: managers.length, anomalyCount: anomalyInsights.length }, "[BackgroundInsights] Anomaly alerts sent");
        }
      } catch (notifyErr: any) {
        logger.warn({ error: notifyErr.message }, "[BackgroundInsights] Failed to send anomaly notifications");
      }
    }
  }
}

let insightsCronInterval: ReturnType<typeof setInterval> | null = null;
let lastDailyInsightDate = "";
let lastWeeklyInsightDate = "";

export function startBackgroundInsightsCron() {
  insightsCronInterval = setInterval(async () => {
    try {
      const now = new Date();
      const todayStr = now.toISOString().slice(0, 10);
      const dayOfWeek = now.getDay();
      const hour = now.getHours();

      if (hour < 6) return;

      const stores = await db.select({ id: workLocations.id }).from(workLocations);

      if (hour >= 6 && lastDailyInsightDate !== todayStr) {
        lastDailyInsightDate = todayStr;
        logger.info("[BackgroundInsights] Running daily analysis");
        for (const store of stores) {
          await runAllInsightGenerators(store.id, ["task_anomaly", "predictive_schedule"]);
        }
      }

      if (dayOfWeek === 1 && hour >= 6 && lastWeeklyInsightDate !== todayStr) {
        lastWeeklyInsightDate = todayStr;
        logger.info("[BackgroundInsights] Running weekly analysis (Monday)");
        for (const store of stores) {
          await runAllInsightGenerators(store.id, ["staffing", "sales_trend"]);
        }
      }

      if (dayOfWeek === 0 && hour >= 6 && lastWeeklyInsightDate !== todayStr) {
        lastWeeklyInsightDate = todayStr;
        logger.info("[BackgroundInsights] Running weekly analysis (Sunday)");
        for (const store of stores) {
          await runAllInsightGenerators(store.id, ["recurring_issue"]);
        }
      }

      await db.delete(backgroundInsights).where(
        and(
          eq(backgroundInsights.status, "active"),
          lte(backgroundInsights.expiresAt, now),
        )
      );
    } catch (err: any) {
      logger.error({ error: err.message }, "[BackgroundInsights] Cron error");
    }
  }, 15 * 60 * 1000);

  logger.info("[BackgroundInsights] Cron started (checks every 15 minutes)");
}

export function stopBackgroundInsightsCron() {
  if (insightsCronInterval) {
    clearInterval(insightsCronInterval);
    insightsCronInterval = null;
  }
}
