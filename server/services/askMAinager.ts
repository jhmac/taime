import Anthropic from "@anthropic-ai/sdk";
import { config } from "../lib/config";
import { db } from "../db";
import { eq, and, gte, lte, desc, sql, count } from "drizzle-orm";
import {
  users, schedules, tasks, issues, timeEntries, workLocations,
  sopExecutions, dailyDebriefs, aiChatConversations, aiChatMessages,
} from "@shared/schema";
import { searchSOPs } from "./sopIndexer";
import logger from "../lib/logger";

const anthropic = new Anthropic({ apiKey: config.anthropic.apiKey });
const MODEL = "claude-sonnet-4-20250514";

export interface MAinagerResponse {
  answer: string;
  confidence: "high" | "medium" | "low";
  referencedSops: { templateId: string; title: string }[];
  suggestedActions: { type: string; id?: string; label: string }[];
  conversationId: string;
}

interface AskParams {
  question: string;
  employeeId: string;
  storeId: string;
  conversationId?: string;
}

async function gatherContext(storeId: string, employeeId: string, question: string) {
  const now = new Date();
  const todayStart = new Date(now);
  todayStart.setHours(0, 0, 0, 0);
  const todayEnd = new Date(now);
  todayEnd.setHours(23, 59, 59, 999);
  const weekAgo = new Date(now);
  weekAgo.setDate(weekAgo.getDate() - 7);

  const [
    employee,
    store,
    todaySchedules,
    employeeTasks,
    openIssues,
    activeTimeEntry,
    sopCompletionCount,
    recentBugs,
    sopResults,
  ] = await Promise.all([
    db.select({
      id: users.id, firstName: users.firstName, lastName: users.lastName,
      role: users.role, email: users.email,
    }).from(users).where(eq(users.id, employeeId)).then(r => r[0]),

    db.select({
      id: workLocations.id, name: workLocations.name,
    }).from(workLocations).where(eq(workLocations.id, storeId)).then(r => r[0]),

    db.select({
      userId: schedules.userId, startTime: schedules.startTime, endTime: schedules.endTime,
      title: schedules.title,
    }).from(schedules)
      .where(and(
        gte(schedules.startTime, todayStart),
        lte(schedules.startTime, todayEnd),
      ))
      .orderBy(schedules.startTime),

    db.select({
      id: tasks.id, title: tasks.title, status: tasks.status,
      dueDate: tasks.dueDate, priority: tasks.priority,
    }).from(tasks)
      .where(and(
        eq(tasks.assignedTo, employeeId),
        sql`${tasks.status} IN ('pending', 'in_progress')`,
      ))
      .orderBy(desc(tasks.priority)),

    db.select({
      id: issues.id, title: issues.title, status: issues.status,
      priority: issues.priority, category: issues.category,
    }).from(issues)
      .where(and(
        eq(issues.storeId, storeId),
        sql`${issues.status} IN ('open', 'in_progress')`,
      ))
      .orderBy(desc(issues.priority))
      .limit(5),

    db.select({ id: timeEntries.id, clockInTime: timeEntries.clockInTime })
      .from(timeEntries)
      .where(and(
        eq(timeEntries.userId, employeeId),
        sql`${timeEntries.clockOutTime} IS NULL`,
      ))
      .limit(1)
      .then(r => r[0]),

    db.select({ count: count() }).from(sopExecutions)
      .where(and(
        eq(sopExecutions.employeeId, employeeId),
        eq(sopExecutions.status, "completed"),
      ))
      .then(r => r[0]?.count || 0),

    db.select({ whatBuggedYou: dailyDebriefs.whatBuggedYou })
      .from(dailyDebriefs)
      .where(and(
        eq(dailyDebriefs.storeId, storeId),
        gte(dailyDebriefs.createdAt, weekAgo),
      ))
      .then(rows => rows.map(r => r.whatBuggedYou).filter(Boolean).slice(0, 5)),

    searchSOPs(storeId, question, 5).catch((err) => {
      logger.warn({ error: err.message }, "[AskMAinager] SOP search failed, continuing without RAG");
      return [] as Awaited<ReturnType<typeof searchSOPs>>;
    }),
  ]);

  const userIds = [...new Set(todaySchedules.map(s => s.userId))];
  let scheduleNames: Record<string, string> = {};
  if (userIds.length > 0) {
    const nameRows = await db.select({
      id: users.id, firstName: users.firstName, lastName: users.lastName,
    }).from(users)
      .where(sql`${users.id} IN (${sql.join(userIds.map(id => sql`${id}`), sql`, `)})`);
    scheduleNames = Object.fromEntries(nameRows.map(u => [u.id, `${u.firstName || ""} ${u.lastName || ""}`.trim() || "Unknown"]));
  }

  const employeeName = employee
    ? `${employee.firstName || ""} ${employee.lastName || ""}`.trim() || "Team member"
    : "Team member";
  const roleName = employee?.role || "employee";
  const storeName = store?.name || "the store";

  const shiftStatus = activeTimeEntry
    ? `Clocked in since ${new Date(activeTimeEntry.clockInTime).toLocaleTimeString()}`
    : "Not currently clocked in";

  const hour = now.getHours();
  let timeContext = "mid-day";
  if (hour < 10) timeContext = "morning / opening";
  else if (hour >= 10 && hour < 14) timeContext = "mid-morning";
  else if (hour >= 14 && hour < 17) timeContext = "afternoon";
  else if (hour >= 17) timeContext = "evening / closing";

  const scheduleSummary = todaySchedules.length > 0
    ? todaySchedules.map(s => {
        const name = scheduleNames[s.userId] || "Unknown";
        const start = new Date(s.startTime).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
        const end = new Date(s.endTime).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
        return `- ${name}: ${start} – ${end}`;
      }).join("\n")
    : "No schedules found for today.";

  const tasksSummary = employeeTasks.length > 0
    ? employeeTasks.slice(0, 8).map(t =>
        `- [${t.priority || "normal"}] ${t.title} (${t.status})${t.dueDate ? ` — due ${new Date(t.dueDate).toLocaleDateString()}` : ""}`
      ).join("\n")
    : "No pending tasks.";

  const issuesSummary = openIssues.length > 0
    ? openIssues.map(i => `- [${i.priority}] ${i.title} (${i.category || "general"})`).join("\n")
    : "No open issues.";

  const sopChunks = sopResults.length > 0
    ? sopResults.map((r, i) =>
        `${i + 1}. [${r.templateTitle}] (${r.sourceType}): ${r.contentText}`
      ).join("\n")
    : "No relevant procedures found for this question.";

  const bugThemes = recentBugs.length > 0
    ? "Recent team feedback: " + recentBugs.join("; ")
    : "";

  return {
    employeeName, roleName, storeName, shiftStatus, timeContext,
    scheduleSummary, tasksSummary, issuesSummary, sopChunks,
    bugThemes, sopResults, sopCompletionCount,
    currentTime: now.toLocaleTimeString(),
    currentDate: now.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" }),
  };
}

export async function askMAinager(params: AskParams): Promise<MAinagerResponse> {
  const { question, employeeId, storeId } = params;

  const ctx = await gatherContext(storeId, employeeId, question);

  let convId = params.conversationId || "";
  let conversationHistory: { role: "user" | "assistant"; content: string }[] = [];

  if (convId) {
    const msgs = await db.select({ role: aiChatMessages.role, content: aiChatMessages.content })
      .from(aiChatMessages)
      .where(eq(aiChatMessages.conversationId, convId))
      .orderBy(aiChatMessages.createdAt)
      .limit(10);
    conversationHistory = msgs.map(m => ({
      role: m.role as "user" | "assistant",
      content: m.content,
    }));
  }

  if (!convId) {
    const [conv] = await db.insert(aiChatConversations).values({
      userId: employeeId,
      title: question.slice(0, 50),
    }).returning();
    convId = conv.id;
  }

  await db.insert(aiChatMessages).values({
    conversationId: convId,
    role: "user",
    content: question,
  });

  const systemPrompt = `You are MAinager, the AI assistant for ${ctx.storeName}, a retail boutique. You help team members with their daily work by answering questions using the store's actual procedures, schedules, and data.

PERSONALITY:
- Warm, supportive, and encouraging — like the best team lead
- Specific and actionable — never vague
- Use the employee's name (${ctx.employeeName})
- If you're not sure about something, say so honestly rather than guessing

CAPABILITIES:
- Answer questions about store procedures (SOPs) — you have the store's procedure library
- Tell employees about schedules, tasks, and who's working
- Help troubleshoot issues and surface relevant SOPs
- Suggest what an employee should be doing right now based on their role, time, and open tasks
- Explain WHY procedures exist (pull from training notes)

IMPORTANT RULES:
- Only answer based on the context provided. Never make up procedures that aren't in the SOP library.
- If asked about a procedure that doesn't exist in the SOPs, say: "I don't see a procedure for that yet. Want me to flag it so a manager can create one?"
- If the question is about something outside your knowledge (personal advice, non-work topics), gently redirect: "That's outside my expertise! I'm best at helping with store operations."
- When referencing an SOP, include the SOP title so the employee can find it.
- If an employee reports a problem, suggest logging it as an issue.
- Keep responses concise but helpful. Use bullet points for lists.

INTENT DETECTION:
At the end of your response, include a JSON block (fenced with triple backticks and "json" label) with suggested actions:
\`\`\`json
{"suggested_actions": [{"type": "start_sop", "id": "template_id_here", "label": "Start: SOP Title"}]}
\`\`\`
Action types: "start_sop", "create_issue", "view_schedule", "view_tasks"
Only include this if there are clear actionable suggestions. Otherwise omit the JSON block entirely.

CURRENT CONTEXT:
Store: ${ctx.storeName}
Current time: ${ctx.currentTime} on ${ctx.currentDate}
Time of day: ${ctx.timeContext}
Employee: ${ctx.employeeName} (Role: ${ctx.roleName})
Shift status: ${ctx.shiftStatus}
SOPs completed: ${ctx.sopCompletionCount}

Today's Schedule:
${ctx.scheduleSummary}

Active Tasks for ${ctx.employeeName}:
${ctx.tasksSummary}

Open Issues:
${ctx.issuesSummary}

${ctx.bugThemes}

Relevant Procedures (from SOP library):
${ctx.sopChunks}`;

  const messages: Anthropic.MessageParam[] = [
    ...conversationHistory.map(m => ({ role: m.role, content: m.content } as Anthropic.MessageParam)),
    { role: "user", content: question },
  ];

  try {
    let timeoutId: ReturnType<typeof setTimeout>;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => reject(new Error("AI timeout")), 10000);
    });

    const response = await Promise.race([
      anthropic.messages.create({
        model: MODEL,
        max_tokens: 1000,
        temperature: 0.3,
        system: systemPrompt,
        messages,
      }),
      timeoutPromise,
    ]).finally(() => clearTimeout(timeoutId));

    let answer = response.content[0]?.type === "text" ? response.content[0].text : "";

    let suggestedActions: { type: string; id?: string; label: string }[] = [];
    const jsonMatch = answer.match(/```json\s*(\{[\s\S]*?\})\s*```/);
    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[1]);
        if (parsed.suggested_actions) {
          suggestedActions = parsed.suggested_actions;
        }
      } catch {}
      answer = answer.replace(/```json\s*\{[\s\S]*?\}\s*```/, "").trim();
    }

    const referencedSops = ctx.sopResults
      .filter(r => answer.toLowerCase().includes(r.templateTitle.toLowerCase()))
      .map(r => ({ templateId: r.templateId, title: r.templateTitle }));
    const uniqueSops = [...new Map(referencedSops.map(s => [s.templateId, s])).values()];

    const confidence: "high" | "medium" | "low" =
      ctx.sopResults.length > 0 && ctx.sopResults[0].similarityScore > 0.5
        ? "high"
        : ctx.sopResults.length > 0 && ctx.sopResults[0].similarityScore > 0.25
          ? "medium"
          : "low";

    await db.insert(aiChatMessages).values({
      conversationId: convId,
      role: "assistant",
      content: answer,
      sopReferences: uniqueSops.map(s => s.templateId),
    });

    await db.update(aiChatConversations)
      .set({ lastMessageAt: new Date() })
      .where(eq(aiChatConversations.id, convId));

    return {
      answer,
      confidence,
      referencedSops: uniqueSops,
      suggestedActions,
      conversationId: convId,
    };
  } catch (err: any) {
    logger.error({ error: err.message }, "[AskMAinager] AI call failed");

    const fallback = "I'm thinking a bit slow right now. Try again in a moment, or check the SOP Library directly for procedures.";
    await db.insert(aiChatMessages).values({
      conversationId: convId,
      role: "assistant",
      content: fallback,
    });

    return {
      answer: fallback,
      confidence: "low",
      referencedSops: [],
      suggestedActions: [],
      conversationId: convId,
    };
  }
}
