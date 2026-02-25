import Anthropic from "@anthropic-ai/sdk";
import { db } from "../db";
import { eq, and, gte, desc, sql, count, avg, lte } from "drizzle-orm";
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
} from "@shared/schema";
import logger from "../lib/logger";

const anthropic = new Anthropic();

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

export async function runAllInsightGenerators(storeId: string, types?: string[]): Promise<void> {
  const runTypes = types || ["staffing", "task_anomaly", "predictive_schedule", "recurring_issue", "sales_trend"];
  const allInsights: InsightResult[] = [];

  const generators: [string, () => Promise<InsightResult[]>][] = [
    ["staffing", () => analyzeStaffingPatterns(storeId)],
    ["task_anomaly", () => analyzeTaskCompletionPatterns(storeId)],
    ["predictive_schedule", () => generateSchedulingSuggestions(storeId)],
    ["recurring_issue", () => detectRecurringIssues(storeId)],
    ["sales_trend", () => analyzeSalesTrends(storeId)],
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
