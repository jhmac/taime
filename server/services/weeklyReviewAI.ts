import { anthropic, withAiContext } from "../lib/aiClients";
import { config } from "../lib/config";
import { db } from "../db";
import { eq, and, gte, lte, sql, count } from "drizzle-orm";
import {
  gtdInboxItems, gtdProjects, gtdNextActions, gtdWaitingFor,
  gtdSomedayMaybe, sopExecutions, dailyDebriefs, issues,
  improvementVideos,
} from "@shared/schema";
import logger from "../lib/logger";

const MODEL = "claude-sonnet-4-20250514";

export interface WeeklyReviewData {
  greeting: string;
  week_summary: string;
  inbox_status: {
    unprocessed_count: number;
    processed_this_week: number;
    message: string;
  };
  projects_review: Array<{
    project_title: string;
    project_id: string;
    progress: number;
    status_note: string;
    suggested_next_step: string;
  }>;
  overdue_actions: {
    count: number;
    items: Array<{ id: string; title: string; dueDate: string | null }>;
    message: string;
  };
  waiting_for_check: {
    overdue_count: number;
    items: Array<{ id: string; waitingOn: string; followUpDate: string | null }>;
    message: string;
  };
  someday_maybe_prompt: string;
  someday_items: Array<{ id: string; title: string; category: string | null }>;
  improvement_insights: string;
  sales_snapshot: string;
  sop_stats: { completed: number; total: number };
  closing_thought: string;
}

function getWeekStart(date: Date = new Date()): Date {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  d.setDate(diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

function getWeekEnd(weekStart: Date): Date {
  const d = new Date(weekStart);
  d.setDate(d.getDate() + 6);
  d.setHours(23, 59, 59, 999);
  return d;
}

async function gatherReviewData(storeId: string, userId: string) {
  const weekStart = getWeekStart();
  const weekEnd = getWeekEnd(weekStart);
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const [
    inboxUnprocessed,
    inboxProcessedThisWeek,
    activeProjects,
    overdueActions,
    overdueWaiting,
    somedayItems,
    sopStats,
    debriefThemes,
    videosThisWeek,
    issuesOpened,
    issuesClosed,
  ] = await Promise.all([
    db.select({ count: count() }).from(gtdInboxItems)
      .where(and(
        eq(gtdInboxItems.storeId, storeId),
        eq(gtdInboxItems.capturedBy, userId),
        sql`${gtdInboxItems.status} IN ('unprocessed', 'clarified')`
      )),

    db.select({ count: count() }).from(gtdInboxItems)
      .where(and(
        eq(gtdInboxItems.storeId, storeId),
        eq(gtdInboxItems.capturedBy, userId),
        eq(gtdInboxItems.status, 'processed'),
        gte(gtdInboxItems.processedAt, weekStart)
      )),

    db.select().from(gtdProjects)
      .where(and(
        eq(gtdProjects.storeId, storeId),
        eq(gtdProjects.ownerId, userId),
        eq(gtdProjects.status, 'active')
      )),

    db.select({
      id: gtdNextActions.id,
      title: gtdNextActions.title,
      dueDate: gtdNextActions.dueDate,
    }).from(gtdNextActions)
      .where(and(
        eq(gtdNextActions.storeId, storeId),
        eq(gtdNextActions.assignedTo, userId),
        eq(gtdNextActions.status, 'active'),
        lte(gtdNextActions.dueDate, sql`CURRENT_DATE - 1`)
      )),

    db.select({
      id: gtdWaitingFor.id,
      waitingOn: gtdWaitingFor.waitingOn,
      followUpDate: gtdWaitingFor.followUpDate,
    }).from(gtdWaitingFor)
      .where(and(
        eq(gtdWaitingFor.storeId, storeId),
        eq(gtdWaitingFor.ownerId, userId),
        eq(gtdWaitingFor.status, 'waiting'),
        lte(gtdWaitingFor.followUpDate, sql`CURRENT_DATE`)
      )),

    db.select({
      id: gtdSomedayMaybe.id,
      title: gtdSomedayMaybe.title,
      category: gtdSomedayMaybe.category,
    }).from(gtdSomedayMaybe)
      .where(and(
        eq(gtdSomedayMaybe.storeId, storeId),
        eq(gtdSomedayMaybe.ownerId, userId),
        eq(gtdSomedayMaybe.status, 'parked')
      )),

    db.select({ count: count() }).from(sopExecutions)
      .where(and(
        eq(sopExecutions.storeId, storeId),
        gte(sopExecutions.createdAt, weekStart),
        lte(sopExecutions.createdAt, weekEnd)
      )),

    db.select({ whatBuggedYou: dailyDebriefs.whatBuggedYou }).from(dailyDebriefs)
      .where(and(
        eq(dailyDebriefs.storeId, storeId),
        gte(dailyDebriefs.createdAt, weekStart),
        lte(dailyDebriefs.createdAt, weekEnd)
      )),

    db.select({ count: count() }).from(improvementVideos)
      .where(and(
        eq(improvementVideos.storeId, storeId),
        gte(improvementVideos.createdAt, weekStart)
      )),

    db.select({ count: count() }).from(issues)
      .where(and(
        eq(issues.storeId, storeId),
        gte(issues.createdAt, weekStart)
      )),

    db.select({ count: count() }).from(issues)
      .where(and(
        eq(issues.storeId, storeId),
        eq(issues.status, 'resolved'),
        gte(issues.resolvedAt, weekStart)
      )),
  ]);

  const projectIds = activeProjects.map(p => p.id);
  let actionCounts: Array<{ projectId: string | null; status: string; count: number }> = [];
  if (projectIds.length > 0) {
    actionCounts = await db.select({
      projectId: gtdNextActions.projectId,
      status: gtdNextActions.status,
      count: count(),
    }).from(gtdNextActions)
      .where(sql`${gtdNextActions.projectId} IN (${sql.join(projectIds.map(id => sql`${id}`), sql`, `)})`)
      .groupBy(gtdNextActions.projectId, gtdNextActions.status);
  }

  const projectsWithProgress = activeProjects.map(p => {
    const projectActions = actionCounts.filter(a => a.projectId === p.id);
    const total = projectActions.reduce((sum, a) => sum + a.count, 0);
    const completed = projectActions.filter(a => a.status === 'completed').reduce((sum, a) => sum + a.count, 0);
    return {
      id: p.id,
      title: p.title,
      desiredOutcome: p.desiredOutcome,
      totalActions: total,
      completedActions: completed,
      progress: total ? Math.round((completed / total) * 100) : 0,
      dueDate: p.dueDate,
    };
  });

  const sopCompleted = await db.select({ count: count() }).from(sopExecutions)
    .where(and(
      eq(sopExecutions.storeId, storeId),
      eq(sopExecutions.status, 'completed'),
      gte(sopExecutions.createdAt, weekStart),
      lte(sopExecutions.createdAt, weekEnd)
    ));

  const bugThemes = debriefThemes
    .map(d => d.whatBuggedYou)
    .filter(Boolean)
    .join("; ");

  return {
    inboxUnprocessed: inboxUnprocessed[0]?.count || 0,
    inboxProcessedThisWeek: inboxProcessedThisWeek[0]?.count || 0,
    projects: projectsWithProgress,
    overdueActions,
    overdueWaiting,
    somedayItems,
    sopTotal: sopStats[0]?.count || 0,
    sopCompleted: sopCompleted[0]?.count || 0,
    bugThemes,
    videosCount: videosThisWeek[0]?.count || 0,
    issuesOpened: issuesOpened[0]?.count || 0,
    issuesClosed: issuesClosed[0]?.count || 0,
  };
}

export async function generateWeeklyReview(storeId: string, userId: string): Promise<WeeklyReviewData> {
  const data = await gatherReviewData(storeId, userId);

  const SYSTEM_PROMPT = `You are MAinager's Weekly Review assistant. Generate a structured weekly review guide for a boutique owner/manager.

The weekly review has 3 phases (from David Allen's GTD methodology):
1. GET CLEAR — Process the inbox to zero, collect any loose ends
2. GET CURRENT — Review all active projects, next actions, waiting-for items
3. GET CREATIVE — Review someday/maybe list, brainstorm new ideas

Your review should feel like a calm, structured conversation — not an audit. The goal is to leave feeling organized and confident about next week.

Return JSON:
{
  "greeting": "Personalized Friday greeting (warm, not corporate)",
  "week_summary": "2-3 sentence summary of how the week went based on the data. Honest but constructive.",
  "inbox_status": {
    "message": "Encouraging note about inbox status"
  },
  "projects_review": [
    {
      "project_id": "the project id",
      "project_title": "...",
      "status_note": "AI observation about this project's progress (On track / Needs attention / Stale)",
      "suggested_next_step": "what should happen next?"
    }
  ],
  "overdue_actions": {
    "message": "Context about overdue items — are they stale? Should some be deleted? Reassigned?"
  },
  "waiting_for_check": {
    "message": "Who needs a follow-up nudge?"
  },
  "someday_maybe_prompt": "A thought-provoking question to review the someday/maybe list. Example: 'Any of these seeds ready to plant? Anything you can let go of?'",
  "improvement_insights": "Summary of this week's What Bugged You themes and improvement video activity",
  "sales_snapshot": "Brief note (say 'Sales data not available this week' if no data provided)",
  "closing_thought": "An encouraging note about the week ahead. End on a positive, forward-looking note."
}`;

  const userPrompt = `Here's the data for this week's review:

INBOX:
- Unprocessed items: ${data.inboxUnprocessed}
- Processed this week: ${data.inboxProcessedThisWeek}

ACTIVE PROJECTS (${data.projects.length}):
${data.projects.map(p => `- "${p.title}" — ${p.completedActions}/${p.totalActions} actions done (${p.progress}%)${p.dueDate ? `, due ${p.dueDate}` : ''}${p.desiredOutcome ? `. Outcome: ${p.desiredOutcome}` : ''}`).join('\n') || '(none)'}

OVERDUE ACTIONS (${data.overdueActions.length}):
${data.overdueActions.map(a => `- "${a.title}"${a.dueDate ? ` (due ${a.dueDate})` : ''}`).join('\n') || '(none)'}

OVERDUE WAITING-FOR (${data.overdueWaiting.length}):
${data.overdueWaiting.map(w => `- Waiting on "${w.waitingOn}"${w.followUpDate ? ` (follow-up was ${w.followUpDate})` : ''}`).join('\n') || '(none)'}

SOMEDAY/MAYBE (${data.somedayItems.length}):
${data.somedayItems.map(s => `- "${s.title}"${s.category ? ` [${s.category}]` : ''}`).join('\n') || '(none)'}

SOP EXECUTIONS: ${data.sopCompleted} completed out of ${data.sopTotal} total this week

WHAT BUGGED PEOPLE THIS WEEK:
${data.bugThemes || '(no submissions)'}

IMPROVEMENT VIDEOS: ${data.videosCount} posted this week

ISSUES: ${data.issuesOpened} opened, ${data.issuesClosed} resolved this week`;

  try {
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("AI timeout after 15s")), 15000)
    );

    const response = await Promise.race([
      anthropic.messages.create({
        model: MODEL,
        max_tokens: 1500,
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: userPrompt }],
      }),
      timeoutPromise,
    ]);

    const text = response.content[0]?.type === 'text' ? response.content[0].text : '';
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("No JSON in response");

    const aiResult = JSON.parse(jsonMatch[0]);

    return {
      greeting: aiResult.greeting || "Happy Friday! Time to review your week.",
      week_summary: aiResult.week_summary || "Here's your weekly review.",
      inbox_status: {
        unprocessed_count: data.inboxUnprocessed,
        processed_this_week: data.inboxProcessedThisWeek,
        message: aiResult.inbox_status?.message || `You have ${data.inboxUnprocessed} items to process.`,
      },
      projects_review: (aiResult.projects_review || []).map((p: any) => ({
        project_title: p.project_title,
        project_id: p.project_id || '',
        progress: data.projects.find(dp => dp.id === p.project_id)?.progress || 0,
        status_note: p.status_note || '',
        suggested_next_step: p.suggested_next_step || '',
      })),
      overdue_actions: {
        count: data.overdueActions.length,
        items: data.overdueActions.map(a => ({ id: a.id, title: a.title, dueDate: a.dueDate })),
        message: aiResult.overdue_actions?.message || `You have ${data.overdueActions.length} overdue actions.`,
      },
      waiting_for_check: {
        overdue_count: data.overdueWaiting.length,
        items: data.overdueWaiting.map(w => ({ id: w.id, waitingOn: w.waitingOn, followUpDate: w.followUpDate })),
        message: aiResult.waiting_for_check?.message || `${data.overdueWaiting.length} items need follow-up.`,
      },
      someday_maybe_prompt: aiResult.someday_maybe_prompt || "Any seeds ready to plant?",
      someday_items: data.somedayItems.map(s => ({ id: s.id, title: s.title, category: s.category })),
      improvement_insights: aiResult.improvement_insights || `${data.videosCount} videos posted, ${data.bugThemes ? 'themes: ' + data.bugThemes : 'no feedback themes'}.`,
      sales_snapshot: aiResult.sales_snapshot || "Sales data not available this week.",
      sop_stats: { completed: data.sopCompleted, total: data.sopTotal },
      closing_thought: aiResult.closing_thought || "You've got this. Have a great weekend!",
    };
  } catch (err: any) {
    logger.warn(`Weekly review AI failed: ${err.message}. Using fallback.`);
    return buildFallbackReview(data);
  }
}

function buildFallbackReview(data: Awaited<ReturnType<typeof gatherReviewData>>): WeeklyReviewData {
  return {
    greeting: "Happy Friday! Let's review your week.",
    week_summary: `This week you processed ${data.inboxProcessedThisWeek} inbox items, completed ${data.sopCompleted} SOPs, and resolved ${data.issuesClosed} issues.`,
    inbox_status: {
      unprocessed_count: data.inboxUnprocessed,
      processed_this_week: data.inboxProcessedThisWeek,
      message: data.inboxUnprocessed === 0 ? "Inbox is clear! Great job." : `${data.inboxUnprocessed} items waiting to be processed.`,
    },
    projects_review: data.projects.map(p => ({
      project_title: p.title,
      project_id: p.id,
      progress: p.progress,
      status_note: p.progress >= 75 ? "Almost there!" : p.progress > 0 ? "Making progress" : "Not started yet",
      suggested_next_step: "Review and add next actions",
    })),
    overdue_actions: {
      count: data.overdueActions.length,
      items: data.overdueActions.map(a => ({ id: a.id, title: a.title, dueDate: a.dueDate })),
      message: data.overdueActions.length === 0 ? "No overdue actions. You're on track!" : `${data.overdueActions.length} actions need attention.`,
    },
    waiting_for_check: {
      overdue_count: data.overdueWaiting.length,
      items: data.overdueWaiting.map(w => ({ id: w.id, waitingOn: w.waitingOn, followUpDate: w.followUpDate })),
      message: data.overdueWaiting.length === 0 ? "No overdue follow-ups." : `${data.overdueWaiting.length} items need a follow-up nudge.`,
    },
    someday_maybe_prompt: "Take a moment to review your someday/maybe list. Any ideas ready to become projects?",
    someday_items: data.somedayItems.map(s => ({ id: s.id, title: s.title, category: s.category })),
    improvement_insights: `${data.videosCount} improvement videos posted this week.`,
    sales_snapshot: "Sales data not available this week.",
    sop_stats: { completed: data.sopCompleted, total: data.sopTotal },
    closing_thought: "Take a breath. You've done good work this week. Enjoy the weekend!",
  };
}
