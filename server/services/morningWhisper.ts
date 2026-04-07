import Anthropic from "@anthropic-ai/sdk";
import { db } from "../db";
import { eq, and, gte, lte, desc, sql, count } from "drizzle-orm";
import {
  users, schedules, tasks, issues, timeEntries, workLocations,
  sopExecutions, dailyDebriefs, shopifyDailySales, morningWhispers,
  gtdWaitingFor, improvementVideos,
} from "@shared/schema";
import { config } from "../lib/config";
import logger from "../lib/logger";

const anthropic = new Anthropic({ apiKey: config.anthropic.apiKey });
const MODEL = "claude-sonnet-4-20250514";

export interface MorningWhisperData {
  greeting: string;
  headline: string;
  yesterday_summary: string;
  today_outlook: string;
  flagged_items: {
    flag_type: string;
    message: string;
    priority: "high" | "medium";
  }[];
  team_highlight: string;
  closing: string;
}

function getDateRange(date: Date, offsetDays: number) {
  const d = new Date(date);
  d.setDate(d.getDate() + offsetDays);
  const start = new Date(d);
  start.setHours(0, 0, 0, 0);
  const end = new Date(d);
  end.setHours(23, 59, 59, 999);
  return { start, end };
}

async function gatherWhisperData(storeId: string, userId: string) {
  const now = new Date();
  const { start: yesterdayStart, end: yesterdayEnd } = getDateRange(now, -1);
  const { start: todayStart, end: todayEnd } = getDateRange(now, 0);
  const lastWeekSameDay = new Date(now);
  lastWeekSameDay.setDate(lastWeekSameDay.getDate() - 7);
  const { start: lwStart, end: lwEnd } = getDateRange(lastWeekSameDay, 0);

  const [
    yesterdaySales,
    lastWeekSales,
    yesterdaySopCompletions,
    yesterdaySopTotal,
    yesterdayTasksCompleted,
    yesterdayTasksAssigned,
    yesterdayIssuesOpened,
    yesterdayIssuesResolved,
    openIssuesCount,
    buggedYou,
    yesterdayVideos,
    lateClockIns,
    todaySchedules,
    openTasks,
    overdueTasks,
    urgentIssues,
    overdueWaitingFor,
  ] = await Promise.all([
    db.select({
      totalRevenue: shopifyDailySales.totalRevenue,
      orderCount: shopifyDailySales.orderCount,
      averageOrderValue: shopifyDailySales.averageOrderValue,
      itemCount: shopifyDailySales.itemCount,
    }).from(shopifyDailySales)
      .where(and(gte(shopifyDailySales.date, yesterdayStart), lte(shopifyDailySales.date, yesterdayEnd)))
      .limit(1).then(r => r[0]).catch(() => null),

    db.select({
      totalRevenue: shopifyDailySales.totalRevenue,
      orderCount: shopifyDailySales.orderCount,
    }).from(shopifyDailySales)
      .where(and(gte(shopifyDailySales.date, lwStart), lte(shopifyDailySales.date, lwEnd)))
      .limit(1).then(r => r[0]).catch(() => null),

    db.select({ count: count() }).from(sopExecutions)
      .where(and(
        eq(sopExecutions.storeId, storeId),
        eq(sopExecutions.status, "completed"),
        gte(sopExecutions.completedAt, yesterdayStart),
        lte(sopExecutions.completedAt, yesterdayEnd),
      )).then(r => r[0]?.count || 0).catch(() => 0),

    db.select({ count: count() }).from(sopExecutions)
      .where(and(
        eq(sopExecutions.storeId, storeId),
        gte(sopExecutions.startedAt, yesterdayStart),
        lte(sopExecutions.startedAt, yesterdayEnd),
      )).then(r => r[0]?.count || 0).catch(() => 0),

    db.select({ count: count() }).from(tasks)
      .where(and(
        eq(tasks.locationId, storeId),
        eq(tasks.status, "completed"),
        gte(tasks.completedAt, yesterdayStart),
        lte(tasks.completedAt, yesterdayEnd),
      )).then(r => r[0]?.count || 0).catch(() => 0),

    db.select({ count: count() }).from(tasks)
      .where(and(
        eq(tasks.locationId, storeId),
        gte(tasks.createdAt, yesterdayStart),
        lte(tasks.createdAt, yesterdayEnd),
      )).then(r => r[0]?.count || 0).catch(() => 0),

    db.select({ count: count() }).from(issues)
      .where(and(
        eq(issues.storeId, storeId),
        gte(issues.createdAt, yesterdayStart),
        lte(issues.createdAt, yesterdayEnd),
      )).then(r => r[0]?.count || 0).catch(() => 0),

    db.select({ count: count() }).from(issues)
      .where(and(
        eq(issues.storeId, storeId),
        eq(issues.status, "resolved"),
        gte(issues.updatedAt, yesterdayStart),
        lte(issues.updatedAt, yesterdayEnd),
      )).then(r => r[0]?.count || 0).catch(() => 0),

    db.select({ count: count() }).from(issues)
      .where(and(
        eq(issues.storeId, storeId),
        sql`${issues.status} IN ('open', 'in_progress')`,
      )).then(r => r[0]?.count || 0).catch(() => 0),

    db.select({ whatBuggedYou: dailyDebriefs.whatBuggedYou })
      .from(dailyDebriefs)
      .where(and(
        eq(dailyDebriefs.storeId, storeId),
        gte(dailyDebriefs.createdAt, yesterdayStart),
        lte(dailyDebriefs.createdAt, yesterdayEnd),
      )).then(rows => rows.map(r => r.whatBuggedYou).filter(Boolean)).catch(() => []),

    db.select({ count: count() }).from(improvementVideos)
      .where(and(
        eq(improvementVideos.storeId, storeId),
        gte(improvementVideos.createdAt, yesterdayStart),
        lte(improvementVideos.createdAt, yesterdayEnd),
      )).then(r => r[0]?.count || 0).catch(() => 0),

    db.select({
      userId: timeEntries.userId,
      clockInTime: timeEntries.clockInTime,
    }).from(timeEntries)
      .where(and(
        gte(timeEntries.clockInTime, yesterdayStart),
        lte(timeEntries.clockInTime, yesterdayEnd),
      )).catch(() => []),

    db.select({
      userId: schedules.userId,
      startTime: schedules.startTime,
      endTime: schedules.endTime,
      title: schedules.title,
    }).from(schedules)
      .where(and(
        gte(schedules.startTime, todayStart),
        lte(schedules.startTime, todayEnd),
      )).orderBy(schedules.startTime).catch(() => []),

    db.select({ count: count() }).from(tasks)
      .where(and(
        eq(tasks.locationId, storeId),
        sql`${tasks.status} IN ('pending', 'in_progress')`,
      )).then(r => r[0]?.count || 0).catch(() => 0),

    db.select({ count: count() }).from(tasks)
      .where(and(
        eq(tasks.locationId, storeId),
        sql`${tasks.status} IN ('pending', 'in_progress')`,
        sql`${tasks.dueDate} < CURRENT_DATE`,
      )).then(r => r[0]?.count || 0).catch(() => 0),

    db.select({
      id: issues.id, title: issues.title, priority: issues.priority, category: issues.category,
    }).from(issues)
      .where(and(
        eq(issues.storeId, storeId),
        sql`${issues.status} IN ('open', 'in_progress')`,
        eq(issues.priority, "high"),
      )).limit(5).catch(() => []),

    db.select({ count: count() }).from(gtdWaitingFor)
      .where(and(
        eq(gtdWaitingFor.storeId, storeId),
        eq(gtdWaitingFor.status, "waiting"),
        sql`${gtdWaitingFor.followUpDate} < CURRENT_DATE`,
      )).then(r => r[0]?.count || 0).catch(() => 0),
  ]);

  const scheduleUserIds = Array.from(new Set(todaySchedules.map(s => s.userId)));
  let scheduleNames: Record<string, string> = {};
  if (scheduleUserIds.length > 0) {
    const nameRows = await db.select({
      id: users.id, firstName: users.firstName, lastName: users.lastName,
    }).from(users)
      .where(sql`${users.id} IN (${sql.join(scheduleUserIds.map(id => sql`${id}`), sql`, `)})`);
    scheduleNames = Object.fromEntries(
      nameRows.map(u => [u.id, `${u.firstName || ""} ${u.lastName || ""}`.trim() || "Unknown"])
    );
  }

  const todayScheduleSummary = todaySchedules.length > 0
    ? todaySchedules.map(s => {
        const name = scheduleNames[s.userId] || "Unknown";
        const start = new Date(s.startTime).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
        const end = new Date(s.endTime).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
        return `${name}: ${start}–${end}`;
      }).join("; ")
    : "No schedules set for today.";

  const yesterdayRevenue = yesterdaySales ? parseFloat(String(yesterdaySales.totalRevenue)) : 0;
  const lastWeekRevenue = lastWeekSales ? parseFloat(String(lastWeekSales.totalRevenue)) : 0;
  const revenueChange = lastWeekRevenue > 0
    ? ((yesterdayRevenue - lastWeekRevenue) / lastWeekRevenue * 100).toFixed(1)
    : "N/A";

  const storeName = await db.select({ name: workLocations.name })
    .from(workLocations).where(eq(workLocations.id, storeId))
    .then(r => r[0]?.name || "the store");

  const employeeName = await db.select({ firstName: users.firstName })
    .from(users).where(eq(users.id, userId))
    .then(r => r[0]?.firstName || "");

  const dayName = now.toLocaleDateString("en-US", { weekday: "long" });

  return {
    storeName,
    employeeName,
    dayName,
    yesterday: {
      revenue: yesterdayRevenue,
      orderCount: yesterdaySales?.orderCount || 0,
      averageOrderValue: yesterdaySales ? parseFloat(String(yesterdaySales.averageOrderValue)) : 0,
      itemCount: yesterdaySales?.itemCount || 0,
      vsLastWeek: revenueChange,
      sopCompleted: yesterdaySopCompletions,
      sopTotal: yesterdaySopTotal,
      tasksCompleted: yesterdayTasksCompleted,
      tasksAssigned: yesterdayTasksAssigned,
      issuesOpened: yesterdayIssuesOpened,
      issuesResolved: yesterdayIssuesResolved,
      buggedYouCount: buggedYou.length,
      buggedYouThemes: buggedYou.slice(0, 3),
      videosUploaded: yesterdayVideos,
      lateClockIns: lateClockIns.length,
    },
    today: {
      scheduleSummary: todayScheduleSummary,
      scheduledCount: todaySchedules.length,
      openTasks: openTasks,
      overdueTasks: overdueTasks,
      openIssuesCount: openIssuesCount,
      urgentIssues: urgentIssues.map(i => `${i.title} (${i.category || "general"})`),
      overdueWaitingFor: overdueWaitingFor,
    },
  };
}

export async function generateMorningWhisper(storeId: string, userId: string): Promise<MorningWhisperData> {
  const data = await gatherWhisperData(storeId, userId);

  const systemPrompt = `You are MAinager's Morning Whisper — a brief, insightful daily briefing for a boutique owner. Think of yourself as their COO delivering a 2-minute morning summary over coffee.

Your tone:
- Concise and direct — respect their time
- Honest — if something needs attention, say so clearly
- Warm but professional — not overly casual, not corporate
- Action-oriented — every insight should lead to a clear action or acknowledgment

Return JSON (no markdown fencing):
{
  "greeting": "Good morning greeting, personalized. Reference the day of week. Max 1 sentence.",
  "headline": "The single most important thing they need to know today. Max 1 sentence. Could be good news or a flag.",
  "yesterday_summary": "3-4 sentences covering yesterday's sales, operations, and team performance. Include specific numbers.",
  "today_outlook": "2-3 sentences about what today looks like. Schedule, priorities, any concerns.",
  "flagged_items": [
    {
      "flag_type": "urgent_issue | sop_gap | staffing | sales | overdue_task | vip_date",
      "message": "One clear sentence describing the flag and what to do about it.",
      "priority": "high or medium"
    }
  ],
  "team_highlight": "One positive thing about the team from yesterday. Celebrate someone or something specific. This ends the briefing on a high note.",
  "closing": "One sentence. Forward-looking, encouraging."
}

Important: Return ONLY valid JSON, no markdown code fences.`;

  const userMessage = `Generate today's Morning Whisper for ${data.employeeName || "the owner"} at ${data.storeName}. Today is ${data.dayName}.

YESTERDAY'S PERFORMANCE:
- Revenue: $${data.yesterday.revenue.toFixed(2)} (${data.yesterday.orderCount} transactions, AOV: $${data.yesterday.averageOrderValue.toFixed(2)})
- vs. same day last week: ${data.yesterday.vsLastWeek}%
- Items sold: ${data.yesterday.itemCount}

YESTERDAY'S OPERATIONS:
- SOPs: ${data.yesterday.sopCompleted} completed out of ${data.yesterday.sopTotal} started
- Tasks: ${data.yesterday.tasksCompleted} completed, ${data.yesterday.tasksAssigned} assigned
- Issues: ${data.yesterday.issuesOpened} opened, ${data.yesterday.issuesResolved} resolved
- "What Bugged You?" submissions: ${data.yesterday.buggedYouCount}${data.yesterday.buggedYouThemes.length > 0 ? ` — themes: ${data.yesterday.buggedYouThemes.join("; ")}` : ""}
- Improvement videos: ${data.yesterday.videosUploaded} uploaded
- Late clock-ins: ${data.yesterday.lateClockIns}

TODAY'S OUTLOOK:
- Schedule: ${data.today.scheduleSummary} (${data.today.scheduledCount} scheduled)
- Open tasks: ${data.today.openTasks} (${data.today.overdueTasks} overdue)
- Open issues: ${data.today.openIssuesCount}${data.today.urgentIssues.length > 0 ? `\n- Urgent issues: ${data.today.urgentIssues.join(", ")}` : ""}
- Overdue waiting-for items: ${data.today.overdueWaitingFor}`;

  try {
    let timeoutId: ReturnType<typeof setTimeout>;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => reject(new Error("AI timeout")), 30000);
    });

    const response = await Promise.race([
      anthropic.messages.create({
        model: MODEL,
        max_tokens: 1500,
        temperature: 0.4,
        system: systemPrompt,
        messages: [{ role: "user", content: userMessage }],
      }),
      timeoutPromise,
    ]).finally(() => clearTimeout(timeoutId!));

    const text = response.content[0]?.type === "text" ? response.content[0].text : "";
    const cleaned = text.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
    const parsed = JSON.parse(cleaned) as MorningWhisperData;

    if (!parsed.greeting || !parsed.headline) {
      throw new Error("Missing required fields in AI response");
    }

    return parsed;
  } catch (err: any) {
    logger.error({ error: err.message }, "[MorningWhisper] AI generation failed, using fallback");

    return {
      greeting: `Good morning! Happy ${data.dayName}.`,
      headline: data.today.overdueTasks > 0
        ? `You have ${data.today.overdueTasks} overdue tasks that need attention today.`
        : `${data.today.scheduledCount} team members are scheduled today.`,
      yesterday_summary: `Yesterday's revenue was $${data.yesterday.revenue.toFixed(2)} across ${data.yesterday.orderCount} transactions. ${data.yesterday.tasksCompleted} tasks were completed and ${data.yesterday.sopCompleted} SOPs finished. ${data.yesterday.issuesOpened} new issues were reported and ${data.yesterday.issuesResolved} were resolved.`,
      today_outlook: `${data.today.scheduledCount} team members are scheduled today. You have ${data.today.openTasks} open tasks (${data.today.overdueTasks} overdue) and ${data.today.openIssuesCount} open issues to monitor.`,
      flagged_items: [
        ...(data.today.overdueTasks > 0 ? [{
          flag_type: "overdue_task",
          message: `${data.today.overdueTasks} overdue tasks need immediate attention.`,
          priority: "high" as const,
        }] : []),
        ...(data.today.urgentIssues.length > 0 ? [{
          flag_type: "urgent_issue",
          message: `Urgent issues still open: ${data.today.urgentIssues.join(", ")}`,
          priority: "high" as const,
        }] : []),
        ...(data.today.overdueWaitingFor > 0 ? [{
          flag_type: "overdue_task",
          message: `${data.today.overdueWaitingFor} overdue waiting-for items need follow-up.`,
          priority: "medium" as const,
        }] : []),
      ],
      team_highlight: data.yesterday.tasksCompleted > 0
        ? `The team completed ${data.yesterday.tasksCompleted} tasks yesterday — great hustle!`
        : "The team showed up and gave it their best. Every day counts.",
      closing: "Let's make today count. You've got this!",
    };
  }
}

export async function getOrGenerateWhisper(storeId: string, userId: string): Promise<{
  whisper: MorningWhisperData;
  id: string;
  listened: boolean;
}> {
  const today = new Date().toISOString().split("T")[0];

  const existing = await db.select()
    .from(morningWhispers)
    .where(and(
      eq(morningWhispers.storeId, storeId),
      eq(morningWhispers.userId, userId),
      eq(morningWhispers.whisperDate, today),
    ))
    .limit(1)
    .then(r => r[0]);

  if (existing) {
    return {
      whisper: existing.content as MorningWhisperData,
      id: existing.id,
      listened: existing.listened ?? false,
    };
  }

  const content = await generateMorningWhisper(storeId, userId);

  const [saved] = await db.insert(morningWhispers).values({
    storeId,
    userId,
    whisperDate: today,
    content: content as any,
  }).returning();

  return {
    whisper: content,
    id: saved.id,
    listened: false,
  };
}
