import Anthropic from "@anthropic-ai/sdk";
import { config } from "../lib/config";
import { db } from "../db";
import { eq, and, gte, lte, desc, sql, ne, isNull } from "drizzle-orm";
import {
  users, tasks, issues, timeEntries, schedules, sopExecutions,
  sopTemplates, gtdNextActions, workLocations,
} from "@shared/schema";
import { getSurfacedSOPsForEmployee } from "./sopSurfacing";
import { cache } from "../lib/cache";
import logger from "../lib/logger";

const anthropic = new Anthropic({ apiKey: config.anthropic.apiKey });
const MODEL = "claude-sonnet-4-20250514";

export interface TaskSuggestion {
  priority: number;
  type: "task" | "sop" | "issue" | "gtd_action" | "improvement" | "custom";
  entity_id: string | null;
  title: string;
  reason: string;
  time_estimate_minutes: number | null;
  urgency: "overdue" | "due_now" | "upcoming" | "proactive";
}

export interface SuggestionsResponse {
  suggestions: TaskSuggestion[];
  context_note: string;
}

async function gatherEmployeeContext(employeeId: string, storeId: string) {
  const now = new Date();
  const todayStart = new Date(now);
  todayStart.setHours(0, 0, 0, 0);
  const todayEnd = new Date(now);
  todayEnd.setHours(23, 59, 59, 999);
  const threeDaysOut = new Date(now);
  threeDaysOut.setDate(threeDaysOut.getDate() + 3);

  const [
    employee,
    assignedTasks,
    activeExecutions,
    gtdActions,
    openIssues,
    todaySchedules,
    activeTimeEntry,
    surfacedSOPs,
    storeName,
  ] = await Promise.all([
    db.select({
      id: users.id,
      firstName: users.firstName,
      lastName: users.lastName,
      role: users.role,
    }).from(users).where(eq(users.id, employeeId)).then(r => r[0]),

    db.select({
      id: tasks.id,
      title: tasks.title,
      status: tasks.status,
      dueDate: tasks.dueDate,
      priority: tasks.priority,
      estimatedMinutes: tasks.estimatedMinutes,
    }).from(tasks)
      .where(and(
        eq(tasks.assignedTo, employeeId),
        ne(tasks.status, "completed"),
        ne(tasks.status, "cancelled"),
      ))
      .orderBy(tasks.dueDate)
      .limit(20),

    db.select({
      id: sopExecutions.id,
      templateId: sopExecutions.templateId,
      status: sopExecutions.status,
      startedAt: sopExecutions.startedAt,
    }).from(sopExecutions)
      .where(and(
        eq(sopExecutions.employeeId, employeeId),
        eq(sopExecutions.status, "in_progress"),
      ))
      .limit(5),

    db.select({
      id: gtdNextActions.id,
      title: gtdNextActions.title,
      priority: gtdNextActions.priority,
      dueDate: gtdNextActions.dueDate,
      context: gtdNextActions.context,
      timeEstimateMinutes: gtdNextActions.timeEstimateMinutes,
    }).from(gtdNextActions)
      .where(and(
        eq(gtdNextActions.assignedTo, employeeId),
        eq(gtdNextActions.status, "active"),
        eq(gtdNextActions.storeId, storeId),
      ))
      .orderBy(gtdNextActions.dueDate)
      .limit(10),

    db.select({
      id: issues.id,
      title: issues.title,
      priority: issues.priority,
      category: issues.category,
      createdAt: issues.createdAt,
    }).from(issues)
      .where(and(
        eq(issues.assignedTo, employeeId),
        eq(issues.status, "open"),
      ))
      .limit(10),

    db.select({
      userId: schedules.userId,
      startTime: schedules.startTime,
      endTime: schedules.endTime,
    }).from(schedules)
      .where(and(
        gte(schedules.startTime, todayStart),
        lte(schedules.startTime, todayEnd),
      )),

    db.select({
      id: timeEntries.id,
      clockInTime: timeEntries.clockInTime,
    }).from(timeEntries)
      .where(and(
        eq(timeEntries.userId, employeeId),
        isNull(timeEntries.clockOutTime),
      ))
      .limit(1)
      .then(r => r[0] || null),

    getSurfacedSOPsForEmployee(employeeId, storeId).catch(() => []),

    db.select({ name: workLocations.name }).from(workLocations)
      .where(eq(workLocations.id, storeId))
      .then(r => r[0]?.name || "Store"),
  ]);

  const sopTemplateNames: Record<string, string> = {};
  if (activeExecutions.length > 0) {
    const templateIds = activeExecutions.map(e => e.templateId);
    const templates = await db.select({ id: sopTemplates.id, title: sopTemplates.title })
      .from(sopTemplates)
      .where(sql`${sopTemplates.id} IN (${sql.join(templateIds.map(id => sql`${id}`), sql`, `)})`);
    for (const t of templates) {
      sopTemplateNames[t.id] = t.title;
    }
  }

  const overdueTasks = assignedTasks.filter(t => t.dueDate && new Date(t.dueDate) < todayStart);
  const todayTasks = assignedTasks.filter(t => t.dueDate && new Date(t.dueDate) >= todayStart && new Date(t.dueDate) <= todayEnd);
  const upcomingTasks = assignedTasks.filter(t => t.dueDate && new Date(t.dueDate) > todayEnd && new Date(t.dueDate) <= threeDaysOut);

  const mySchedule = todaySchedules.filter(s => s.userId === employeeId);
  const isOpeningShift = mySchedule.length > 0 && todaySchedules.every(s => !s.startTime || new Date(s.startTime) >= new Date(mySchedule[0].startTime!));
  const isClosingShift = mySchedule.length > 0 && todaySchedules.every(s => !s.endTime || new Date(s.endTime) <= new Date(mySchedule[0].endTime!));
  const othersOnShift = todaySchedules.filter(s => s.userId !== employeeId && s.startTime && new Date(s.startTime) <= now && s.endTime && new Date(s.endTime) >= now).length;

  return {
    employee,
    storeName,
    currentTime: now.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }),
    dayOfWeek: now.toLocaleDateString("en-US", { weekday: "long" }),
    isClockedIn: !!activeTimeEntry,
    clockedInSince: activeTimeEntry?.clockInTime ? new Date(activeTimeEntry.clockInTime).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }) : null,
    isOpeningShift,
    isClosingShift,
    othersOnShift,
    overdueTasks,
    todayTasks,
    upcomingTasks,
    activeExecutions: activeExecutions.map(e => ({
      ...e,
      templateTitle: sopTemplateNames[e.templateId] || "Unknown SOP",
    })),
    gtdActions,
    openIssues,
    surfacedSOPs: surfacedSOPs.slice(0, 5),
  };
}

function buildFallbackSuggestions(ctx: Awaited<ReturnType<typeof gatherEmployeeContext>>): SuggestionsResponse {
  const suggestions: TaskSuggestion[] = [];
  let priority = 1;

  for (const exec of ctx.activeExecutions) {
    if (priority > 5) break;
    suggestions.push({
      priority: priority++,
      type: "sop",
      entity_id: exec.id,
      title: `Continue: ${exec.templateTitle}`,
      reason: "You have an SOP in progress",
      time_estimate_minutes: null,
      urgency: "due_now",
    });
  }

  for (const t of ctx.overdueTasks) {
    if (priority > 5) break;
    suggestions.push({
      priority: priority++,
      type: "task",
      entity_id: t.id,
      title: t.title,
      reason: "This task is overdue",
      time_estimate_minutes: t.estimatedMinutes,
      urgency: "overdue",
    });
  }

  for (const t of ctx.todayTasks) {
    if (priority > 5) break;
    suggestions.push({
      priority: priority++,
      type: "task",
      entity_id: t.id,
      title: t.title,
      reason: "Due today",
      time_estimate_minutes: t.estimatedMinutes,
      urgency: "due_now",
    });
  }

  for (const issue of ctx.openIssues) {
    if (priority > 5) break;
    suggestions.push({
      priority: priority++,
      type: "issue",
      entity_id: issue.id,
      title: issue.title,
      reason: `Open ${issue.priority} priority issue`,
      time_estimate_minutes: null,
      urgency: issue.priority === "urgent" || issue.priority === "high" ? "due_now" : "upcoming",
    });
  }

  for (const sop of ctx.surfacedSOPs) {
    if (priority > 5) break;
    suggestions.push({
      priority: priority++,
      type: "sop",
      entity_id: (sop as any).templateId || null,
      title: (sop as any).title || "Suggested SOP",
      reason: (sop as any).reason || "Relevant to your current shift",
      time_estimate_minutes: null,
      urgency: "upcoming",
    });
  }

  if (suggestions.length === 0) {
    suggestions.push({
      priority: 1,
      type: "improvement",
      entity_id: null,
      title: "Record a quick improvement video",
      reason: "No urgent tasks — great time to share an idea!",
      time_estimate_minutes: 5,
      urgency: "proactive",
    });
  }

  return {
    suggestions: suggestions.slice(0, 5),
    context_note: suggestions.some(s => s.urgency === "overdue")
      ? "You have overdue items that need attention."
      : "Here's what to focus on right now.",
  };
}

export async function generateTaskSuggestions(employeeId: string, storeId: string): Promise<SuggestionsResponse> {
  const cacheKey = `smart-suggestions:${employeeId}`;
  const cached = cache.get<SuggestionsResponse>(cacheKey);
  if (cached) return cached;

  const ctx = await gatherEmployeeContext(employeeId, storeId);

  const contextSummary = `
CURRENT CONTEXT:
- Employee: ${ctx.employee?.firstName} ${ctx.employee?.lastName} (${ctx.employee?.role})
- Store: ${ctx.storeName}
- Time: ${ctx.currentTime}, ${ctx.dayOfWeek}
- Clocked in: ${ctx.isClockedIn ? `Yes (since ${ctx.clockedInSince})` : "No"}
- Shift type: ${ctx.isOpeningShift ? "Opening shift" : ctx.isClosingShift ? "Closing shift" : "Mid shift"}
- Others on shift right now: ${ctx.othersOnShift}

OVERDUE TASKS (${ctx.overdueTasks.length}):
${ctx.overdueTasks.map(t => `- [${t.priority}] ${t.title} (due: ${t.dueDate ? new Date(t.dueDate).toLocaleDateString() : "unknown"})`).join("\n") || "None"}

TODAY'S TASKS (${ctx.todayTasks.length}):
${ctx.todayTasks.map(t => `- [${t.priority}] ${t.title}${t.estimatedMinutes ? ` (~${t.estimatedMinutes}min)` : ""}`).join("\n") || "None"}

UPCOMING TASKS (${ctx.upcomingTasks.length}):
${ctx.upcomingTasks.map(t => `- ${t.title} (due: ${t.dueDate ? new Date(t.dueDate).toLocaleDateString() : "soon"})`).join("\n") || "None"}

IN-PROGRESS SOPs (${ctx.activeExecutions.length}):
${ctx.activeExecutions.map(e => `- ${e.templateTitle} (started: ${e.startedAt ? new Date(e.startedAt).toLocaleTimeString() : "unknown"})`).join("\n") || "None"}

GTD NEXT ACTIONS (${ctx.gtdActions.length}):
${ctx.gtdActions.map(a => `- [${a.priority}] ${a.title}${a.context ? ` @${a.context}` : ""}${a.timeEstimateMinutes ? ` (~${a.timeEstimateMinutes}min)` : ""}`).join("\n") || "None"}

OPEN ISSUES ASSIGNED (${ctx.openIssues.length}):
${ctx.openIssues.map(i => `- [${i.priority}] ${i.title} (${i.category})`).join("\n") || "None"}

SUGGESTED SOPs FOR THIS SHIFT (${ctx.surfacedSOPs.length}):
${ctx.surfacedSOPs.map((s: any) => `- ${s.title || "SOP"}: ${s.reason || ""}`).join("\n") || "None"}
`.trim();

  try {
    const result = await Promise.race([
      anthropic.messages.create({
        model: MODEL,
        max_tokens: 800,
        system: `You are MAinager's Smart Task Advisor. Given an employee's current context, generate a prioritized list of what they should focus on RIGHT NOW.

Rules:
- Max 5 suggestions, ordered by importance
- Be specific: "Complete the Opening Checklist" not "Do your morning tasks"
- Factor in urgency (overdue > due today > upcoming)
- Factor in store context (if it's busy, prioritize customer-facing tasks; if slow, prioritize back-of-house)
- Include a brief reason for each suggestion
- If there's nothing urgent, suggest a proactive improvement: "Slow moment — great time to record a quick improvement video!"
- For entity_id, use the exact ID from the data provided, or null for custom suggestions
- For type, use: task, sop, issue, gtd_action, improvement, or custom

Return ONLY valid JSON (no markdown):
{
  "suggestions": [
    {
      "priority": 1,
      "type": "task",
      "entity_id": "uuid or null",
      "title": "What to do",
      "reason": "Brief explanation",
      "time_estimate_minutes": null,
      "urgency": "overdue"
    }
  ],
  "context_note": "One sentence about the current vibe"
}`,
        messages: [{ role: "user", content: contextSummary }],
      }),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("timeout")), 5000)),
    ]);

    const text = result.content[0].type === "text" ? result.content[0].text : "";
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("No JSON in response");

    const parsed = JSON.parse(jsonMatch[0]) as SuggestionsResponse;
    if (!Array.isArray(parsed.suggestions)) throw new Error("Invalid suggestions format");

    const response: SuggestionsResponse = {
      suggestions: parsed.suggestions.slice(0, 5),
      context_note: parsed.context_note || "Here's what to focus on.",
    };

    cache.set(cacheKey, response, 15 * 60 * 1000);
    return response;
  } catch (error: any) {
    logger.warn({ error: error.message }, "[SmartSuggestions] AI call failed, using fallback");
    const fallback = buildFallbackSuggestions(ctx);
    cache.set(cacheKey, fallback, 15 * 60 * 1000);
    return fallback;
  }
}
