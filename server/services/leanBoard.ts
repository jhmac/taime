import { anthropic, withAiContext } from "../lib/aiClients";
import { config } from "../lib/config";
import { db } from "../db";
import { eq, and, gte, lte, sql, count } from "drizzle-orm";
import {
  dailyDebriefs, improvementVideos, kudos, sopExecutions,
  issues, users, leanBoardSnapshots,
} from "@shared/schema";
import logger from "../lib/logger";
import { resolveStoreId } from "./storeResolver";

const MODEL = "claude-sonnet-4-20250514";

export interface LeanMetrics {
  improvements_submitted: number;
  videos_uploaded: number;
  kudos_given: number;
  sop_completion_rate: number;
  issues_resolved: number;
  issues_opened: number;
  avg_sop_completion_time_trend: "improving" | "stable" | "declining";
  active_improvement_streaks: number;
  team_participation_rate: number;
}

export interface LeanPattern {
  type: "velocity" | "participation" | "issue_ratio" | "sop_trend";
  title: string;
  description: string;
  trend: "positive" | "neutral" | "negative";
}

function dayRange(date: Date) {
  const start = new Date(date);
  start.setHours(0, 0, 0, 0);
  const end = new Date(date);
  end.setHours(23, 59, 59, 999);
  return { start, end };
}

function weekRange(date: Date) {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  const start = new Date(d);
  start.setDate(diff);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 6);
  end.setHours(23, 59, 59, 999);
  return { start, end };
}

export async function generateDailySnapshot(storeId: string, date: Date): Promise<void> {
  const { start, end } = dayRange(date);
  const { start: weekStart, end: weekEnd } = weekRange(date);
  const dateStr = date.toISOString().split("T")[0];

  const [
    buggedYouCount,
    videosCount,
    kudosCount,
    sopTotal,
    sopCompleted,
    issuesResolved,
    issuesOpened,
  ] = await Promise.all([
    db.select({ count: count() }).from(dailyDebriefs)
      .where(and(
        eq(dailyDebriefs.storeId, storeId),
        gte(dailyDebriefs.createdAt, start),
        lte(dailyDebriefs.createdAt, end),
        sql`${dailyDebriefs.whatBuggedYou} IS NOT NULL AND ${dailyDebriefs.whatBuggedYou} != ''`,
      )).then(r => r[0]?.count || 0),

    db.select({ count: count() }).from(improvementVideos)
      .where(and(
        eq(improvementVideos.storeId, storeId),
        gte(improvementVideos.createdAt, start),
        lte(improvementVideos.createdAt, end),
      )).then(r => r[0]?.count || 0),

    db.select({ count: count() }).from(kudos)
      .where(and(
        eq(kudos.storeId, storeId),
        gte(kudos.createdAt, start),
        lte(kudos.createdAt, end),
      )).then(r => r[0]?.count || 0),

    db.select({ count: count() }).from(sopExecutions)
      .where(and(
        eq(sopExecutions.storeId, storeId),
        gte(sopExecutions.createdAt, start),
        lte(sopExecutions.createdAt, end),
      )).then(r => r[0]?.count || 0),

    db.select({ count: count() }).from(sopExecutions)
      .where(and(
        eq(sopExecutions.storeId, storeId),
        eq(sopExecutions.status, "completed"),
        gte(sopExecutions.completedAt, start),
        lte(sopExecutions.completedAt, end),
      )).then(r => r[0]?.count || 0),

    db.select({ count: count() }).from(issues)
      .where(and(
        eq(issues.storeId, storeId),
        eq(issues.status, "resolved"),
        gte(issues.resolvedAt, start),
        lte(issues.resolvedAt, end),
      )).then(r => r[0]?.count || 0),

    db.select({ count: count() }).from(issues)
      .where(and(
        eq(issues.storeId, storeId),
        gte(issues.createdAt, start),
        lte(issues.createdAt, end),
      )).then(r => r[0]?.count || 0),
  ]);

  const sopCompletionRate = sopTotal > 0 ? Math.round((sopCompleted / sopTotal) * 100) : 0;

  const prevWeekStart = new Date(weekStart);
  prevWeekStart.setDate(prevWeekStart.getDate() - 7);
  const prevWeekEnd = new Date(weekStart);
  prevWeekEnd.setDate(prevWeekEnd.getDate() - 1);
  prevWeekEnd.setHours(23, 59, 59, 999);

  const [curWeekSopAvg, prevWeekSopAvg] = await Promise.all([
    db.select({
      avg: sql<number>`AVG(EXTRACT(EPOCH FROM (${sopExecutions.completedAt} - ${sopExecutions.startedAt})))`,
    }).from(sopExecutions)
      .where(and(
        eq(sopExecutions.storeId, storeId),
        eq(sopExecutions.status, "completed"),
        gte(sopExecutions.completedAt, weekStart),
        lte(sopExecutions.completedAt, weekEnd),
      )).then(r => r[0]?.avg || 0),

    db.select({
      avg: sql<number>`AVG(EXTRACT(EPOCH FROM (${sopExecutions.completedAt} - ${sopExecutions.startedAt})))`,
    }).from(sopExecutions)
      .where(and(
        eq(sopExecutions.storeId, storeId),
        eq(sopExecutions.status, "completed"),
        gte(sopExecutions.completedAt, prevWeekStart),
        lte(sopExecutions.completedAt, prevWeekEnd),
      )).then(r => r[0]?.avg || 0),
  ]);

  let avgSopTrend: "improving" | "stable" | "declining" = "stable";
  if (prevWeekSopAvg > 0 && curWeekSopAvg > 0) {
    const change = (curWeekSopAvg - prevWeekSopAvg) / prevWeekSopAvg;
    if (change < -0.1) avgSopTrend = "improving";
    else if (change > 0.1) avgSopTrend = "declining";
  }

  const activeEmployees = await db.select({ id: users.id }).from(users)
    .where(eq(users.isActive, true));

  const totalEmployees = activeEmployees.length || 1;

  const contributorsThisWeek = await db.selectDistinct({ empId: dailyDebriefs.employeeId })
    .from(dailyDebriefs)
    .where(and(
      eq(dailyDebriefs.storeId, storeId),
      gte(dailyDebriefs.createdAt, weekStart),
      lte(dailyDebriefs.createdAt, weekEnd),
      sql`${dailyDebriefs.whatBuggedYou} IS NOT NULL AND ${dailyDebriefs.whatBuggedYou} != ''`,
    ));

  const videoContributors = await db.selectDistinct({ empId: improvementVideos.employeeId })
    .from(improvementVideos)
    .where(and(
      eq(improvementVideos.storeId, storeId),
      gte(improvementVideos.createdAt, weekStart),
      lte(improvementVideos.createdAt, weekEnd),
    ));

  const allContributors = new Set([
    ...contributorsThisWeek.map(c => c.empId),
    ...videoContributors.map(c => c.empId),
  ]);

  const participationRate = Math.round((allContributors.size / totalEmployees) * 100);

  const sevenDaysAgo = new Date(date);
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 6);
  const recentContributors = await db.select({
    empId: dailyDebriefs.employeeId,
    count: count(),
  }).from(dailyDebriefs)
    .where(and(
      eq(dailyDebriefs.storeId, storeId),
      gte(dailyDebriefs.createdAt, sevenDaysAgo),
      sql`${dailyDebriefs.whatBuggedYou} IS NOT NULL AND ${dailyDebriefs.whatBuggedYou} != ''`,
    ))
    .groupBy(dailyDebriefs.employeeId);

  const activeStreaks = recentContributors.filter(c => c.count >= 3).length;

  const metrics: LeanMetrics = {
    improvements_submitted: buggedYouCount,
    videos_uploaded: videosCount,
    kudos_given: kudosCount,
    sop_completion_rate: sopCompletionRate,
    issues_resolved: issuesResolved,
    issues_opened: issuesOpened,
    avg_sop_completion_time_trend: avgSopTrend,
    active_improvement_streaks: activeStreaks,
    team_participation_rate: participationRate,
  };

  await db.insert(leanBoardSnapshots)
    .values({ storeId, snapshotDate: dateStr, metrics: metrics as any })
    .onConflictDoUpdate({
      target: [leanBoardSnapshots.storeId, leanBoardSnapshots.snapshotDate],
      set: { metrics: metrics as any },
    });

  logger.info({ storeId, date: dateStr }, "[LeanBoard] Daily snapshot generated");
}

export async function generateWeeklyLeanSummary(storeId: string): Promise<string> {
  const { start, end } = weekRange(new Date());
  const startStr = start.toISOString().split("T")[0];
  const endStr = end.toISOString().split("T")[0];

  const snapshots = await db.select().from(leanBoardSnapshots)
    .where(and(
      eq(leanBoardSnapshots.storeId, storeId),
      gte(leanBoardSnapshots.snapshotDate, startStr),
      lte(leanBoardSnapshots.snapshotDate, endStr),
    ));

  if (snapshots.length === 0) {
    return "No data collected yet this week. Snapshots are taken nightly — check back tomorrow!";
  }

  const totals = snapshots.reduce((acc, s) => {
    const m = s.metrics as LeanMetrics;
    acc.improvements += m.improvements_submitted;
    acc.videos += m.videos_uploaded;
    acc.kudos += m.kudos_given;
    acc.issuesOpened += m.issues_opened;
    acc.issuesResolved += m.issues_resolved;
    acc.sopRates.push(m.sop_completion_rate);
    acc.participation.push(m.team_participation_rate);
    return acc;
  }, {
    improvements: 0, videos: 0, kudos: 0,
    issuesOpened: 0, issuesResolved: 0,
    sopRates: [] as number[], participation: [] as number[],
  });

  const avgSop = Math.round(totals.sopRates.reduce((a, b) => a + b, 0) / totals.sopRates.length);
  const avgParticipation = Math.round(totals.participation.reduce((a, b) => a + b, 0) / totals.participation.length);

  const prompt = `Here are this week's improvement metrics for a boutique team:
- Improvements submitted (What Bugged You): ${totals.improvements}
- Improvement videos shared: ${totals.videos}
- Kudos given: ${totals.kudos}
- SOP completion rate: ${avgSop}%
- Issues opened: ${totals.issuesOpened}, resolved: ${totals.issuesResolved}
- Average team participation rate: ${avgParticipation}%
- Days tracked: ${snapshots.length}`;

  try {
    let timeoutId: ReturnType<typeof setTimeout>;
    const timeout = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => reject(new Error("AI timeout")), 15000);
    });

    const response = await Promise.race([
      anthropic.messages.create({
        model: MODEL,
        max_tokens: 300,
        system: `You are MAinager's Lean Board summarizer. Given a week of improvement metrics for a boutique team, write a brief, celebratory summary.

Focus on:
- Team momentum (are improvements trending up?)
- Participation (is the whole team engaged or just a few people?)
- Highlight the best metric of the week
- If something declined, frame it as an opportunity, not a failure

Tone: team sports announcer reviewing a great week. Energetic, specific, encouraging.

Return: 2-3 sentences. No JSON, just the narrative.`,
        messages: [{ role: "user", content: prompt }],
      }),
      timeout,
    ]).finally(() => clearTimeout(timeoutId!));

    const text = response.content[0]?.type === "text" ? response.content[0].text : "";
    if (!text) throw new Error("Empty response");

    const summaryText = text.trim();

    await db.update(leanBoardSnapshots)
      .set({ aiSummary: summaryText })
      .where(and(
        eq(leanBoardSnapshots.storeId, storeId),
        eq(leanBoardSnapshots.snapshotDate, endStr),
      ));

    return summaryText;
  } catch (err: any) {
    logger.warn({ error: err.message }, "[LeanBoard] AI summary failed, using fallback");
    const best = [
      { label: "improvements", val: totals.improvements },
      { label: "videos", val: totals.videos },
      { label: "kudos", val: totals.kudos },
    ].sort((a, b) => b.val - a.val)[0];

    return `This week your team logged ${totals.improvements} improvements, shared ${totals.videos} videos, and gave ${totals.kudos} kudos. ${best.val > 0 ? `Best metric: ${best.label} at ${best.val}!` : "Every improvement starts with one step — keep going!"}`;
  }
}

export async function detectPatterns(storeId: string): Promise<LeanPattern[]> {
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  const startStr = thirtyDaysAgo.toISOString().split("T")[0];
  const endStr = new Date().toISOString().split("T")[0];

  const snapshots = await db.select().from(leanBoardSnapshots)
    .where(and(
      eq(leanBoardSnapshots.storeId, storeId),
      gte(leanBoardSnapshots.snapshotDate, startStr),
      lte(leanBoardSnapshots.snapshotDate, endStr),
    ))
    .orderBy(leanBoardSnapshots.snapshotDate);

  if (snapshots.length < 7) return [];

  const patterns: LeanPattern[] = [];
  const metrics = snapshots.map(s => s.metrics as LeanMetrics);

  const half = Math.floor(metrics.length / 2);
  const firstHalf = metrics.slice(0, half);
  const secondHalf = metrics.slice(half);

  const avgFirst = firstHalf.reduce((s, m) => s + m.improvements_submitted, 0) / firstHalf.length;
  const avgSecond = secondHalf.reduce((s, m) => s + m.improvements_submitted, 0) / secondHalf.length;

  if (avgFirst > 0) {
    const velocityChange = ((avgSecond - avgFirst) / avgFirst) * 100;
    if (velocityChange > 20) {
      patterns.push({
        type: "velocity",
        title: "Improvement Velocity Rising",
        description: `Improvement submissions are up ${Math.round(velocityChange)}% — the team is seeing more waste and fixing it!`,
        trend: "positive",
      });
    } else if (velocityChange < -20) {
      patterns.push({
        type: "velocity",
        title: "Improvement Pace Slowing",
        description: `Improvement submissions are down ${Math.round(Math.abs(velocityChange))}%. A quick reminder about the "What Bugged You?" board could spark new ideas.`,
        trend: "negative",
      });
    }
  }

  const recentParticipation = secondHalf.map(m => m.team_participation_rate);
  const avgParticipation = recentParticipation.reduce((a, b) => a + b, 0) / recentParticipation.length;
  if (avgParticipation < 40) {
    patterns.push({
      type: "participation",
      title: "Participation Opportunity",
      description: `Only ${Math.round(avgParticipation)}% of the team contributed improvements recently. Encouraging the whole team to share one "What Bugged You" each week could unlock new insights.`,
      trend: "negative",
    });
  } else if (avgParticipation >= 70) {
    patterns.push({
      type: "participation",
      title: "Broad Team Engagement",
      description: `${Math.round(avgParticipation)}% of the team is actively contributing — that's excellent team-wide buy-in!`,
      trend: "positive",
    });
  }

  const recentIssues = secondHalf.reduce((a, m) => a + m.issues_opened, 0);
  const recentResolved = secondHalf.reduce((a, m) => a + m.issues_resolved, 0);
  if (recentIssues > 0) {
    const ratio = recentResolved / recentIssues;
    if (ratio >= 1) {
      patterns.push({
        type: "issue_ratio",
        title: "Closing More Than Opening",
        description: `The team resolved ${recentResolved} issues while only ${recentIssues} new ones came in. The backlog is shrinking!`,
        trend: "positive",
      });
    } else if (ratio < 0.5) {
      patterns.push({
        type: "issue_ratio",
        title: "Issue Backlog Growing",
        description: `${recentIssues} issues opened vs ${recentResolved} resolved. Consider a focused "fix-it" session to close the gap.`,
        trend: "negative",
      });
    }
  }

  const sopRates = secondHalf.map(m => m.sop_completion_rate);
  const avgSopRate = sopRates.reduce((a, b) => a + b, 0) / sopRates.length;
  const firstSopRate = firstHalf.reduce((a, m) => a + m.sop_completion_rate, 0) / firstHalf.length;
  if (firstSopRate > 0) {
    const sopChange = avgSopRate - firstSopRate;
    if (sopChange > 10) {
      patterns.push({
        type: "sop_trend",
        title: "SOP Compliance Improving",
        description: `SOP completion rate climbed from ${Math.round(firstSopRate)}% to ${Math.round(avgSopRate)}% — great discipline!`,
        trend: "positive",
      });
    } else if (sopChange < -10) {
      patterns.push({
        type: "sop_trend",
        title: "SOP Completion Dipping",
        description: `SOP completion dropped from ${Math.round(firstSopRate)}% to ${Math.round(avgSopRate)}%. Consider reviewing whether SOPs need updating or simplifying.`,
        trend: "negative",
      });
    }
  }

  return patterns;
}

export async function getLeanBoardData(storeId: string, period: "today" | "week" | "month" = "week") {
  const now = new Date();
  let start: Date;
  let end: Date;

  if (period === "today") {
    ({ start, end } = dayRange(now));
  } else if (period === "week") {
    ({ start, end } = weekRange(now));
  } else {
    start = new Date(now.getFullYear(), now.getMonth(), 1);
    end = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
  }

  const startStr = start.toISOString().split("T")[0];
  const endStr = end.toISOString().split("T")[0];

  const snapshots = await db.select().from(leanBoardSnapshots)
    .where(and(
      eq(leanBoardSnapshots.storeId, storeId),
      gte(leanBoardSnapshots.snapshotDate, startStr),
      lte(leanBoardSnapshots.snapshotDate, endStr),
    ))
    .orderBy(leanBoardSnapshots.snapshotDate);

  const currentMetrics: LeanMetrics | null = snapshots.length > 0
    ? (snapshots.reduce((acc, s) => {
        const m = s.metrics as LeanMetrics;
        acc.improvements_submitted += m.improvements_submitted;
        acc.videos_uploaded += m.videos_uploaded;
        acc.kudos_given += m.kudos_given;
        acc.issues_resolved += m.issues_resolved;
        acc.issues_opened += m.issues_opened;
        acc.sop_completion_rate = m.sop_completion_rate;
        acc.avg_sop_completion_time_trend = m.avg_sop_completion_time_trend;
        acc.active_improvement_streaks = m.active_improvement_streaks;
        acc.team_participation_rate = m.team_participation_rate;
        return acc;
      }, {
        improvements_submitted: 0, videos_uploaded: 0, kudos_given: 0,
        sop_completion_rate: 0, issues_resolved: 0, issues_opened: 0,
        avg_sop_completion_time_trend: "stable" as LeanMetrics["avg_sop_completion_time_trend"],
        active_improvement_streaks: 0, team_participation_rate: 0,
      }) as LeanMetrics)
    : null;

  const eightWeeksAgo = new Date(now);
  eightWeeksAgo.setDate(eightWeeksAgo.getDate() - 8 * 7);
  const { start: trendStart } = weekRange(eightWeeksAgo);
  const trendStartStr = trendStart.toISOString().split("T")[0];
  const trendEndStr = endStr;

  const allTrendSnaps = await db.select().from(leanBoardSnapshots)
    .where(and(
      eq(leanBoardSnapshots.storeId, storeId),
      gte(leanBoardSnapshots.snapshotDate, trendStartStr),
      lte(leanBoardSnapshots.snapshotDate, trendEndStr),
    ))
    .orderBy(leanBoardSnapshots.snapshotDate);

  const trendWeeks = [];
  for (let w = 7; w >= 0; w--) {
    const wDate = new Date(now);
    wDate.setDate(wDate.getDate() - w * 7);
    const { start: ws, end: we } = weekRange(wDate);
    const wsStr = ws.toISOString().split("T")[0];
    const weStr = we.toISOString().split("T")[0];

    const weekSnaps = allTrendSnaps.filter(s => {
      const d = s.snapshotDate;
      return d >= wsStr && d <= weStr;
    });

    const weekMetrics = weekSnaps.reduce((acc, s) => {
      const m = s.metrics as LeanMetrics;
      acc.improvements += m.improvements_submitted;
      acc.videos += m.videos_uploaded;
      acc.kudos += m.kudos_given;
      acc.sopRate = m.sop_completion_rate;
      return acc;
    }, { improvements: 0, videos: 0, kudos: 0, sopRate: 0 });

    trendWeeks.push({ weekStart: wsStr, ...weekMetrics });
  }

  const patterns = await detectPatterns(storeId);

  const latestSummary = snapshots.find(s => s.aiSummary)?.aiSummary || null;

  return {
    currentMetrics,
    trends: trendWeeks,
    patterns,
    weeklySummary: latestSummary,
    snapshotCount: snapshots.length,
  };
}

let leanBoardCronTimer: ReturnType<typeof setInterval> | null = null;
let lastSnapshotDate = "";
let lastSummaryWeek = "";

export function startLeanBoardCron() {
  leanBoardCronTimer = setInterval(async () => {
    try {
      const now = new Date();
      const hour = now.getHours();
      const todayStr = now.toISOString().split("T")[0];

      if (hour === 23 && lastSnapshotDate !== todayStr) {
        lastSnapshotDate = todayStr;
        logger.info("[LeanBoard] Generating daily snapshots");

        const storeId = await resolveStoreId();
        if (storeId) {
          try {
            await generateDailySnapshot(storeId, now);
          } catch (err: any) {
            logger.warn({ storeId, error: err.message }, "[LeanBoard] Snapshot failed");
          }
        }
      }

      const dayOfWeek = now.getDay();
      const { start: weekStart } = weekRange(now);
      const weekStr = weekStart.toISOString().split("T")[0];

      if (dayOfWeek === 0 && hour >= 20 && lastSummaryWeek !== weekStr) {
        lastSummaryWeek = weekStr;
        logger.info("[LeanBoard] Generating weekly summaries");

        const storeId = await resolveStoreId();
        if (storeId) {
          try {
            await generateWeeklyLeanSummary(storeId);
          } catch (err: any) {
            logger.warn({ storeId, error: err.message }, "[LeanBoard] Weekly summary failed");
          }
        }
      }
    } catch (err: any) {
      logger.error({ error: err.message }, "[LeanBoard] Cron error");
    }
  }, 15 * 60 * 1000);

  logger.info("[LeanBoard] Cron started (checks every 15 minutes)");
}

export function stopLeanBoardCron() {
  if (leanBoardCronTimer) {
    clearInterval(leanBoardCronTimer);
    leanBoardCronTimer = null;
  }
}
