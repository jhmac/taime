import Anthropic from '@anthropic-ai/sdk';
import { db } from '../db';
import { eq, and, gte, lte, desc, sql } from 'drizzle-orm';
import {
  morningHuddles, kudos, issues, sopExecutions, sopTemplates,
  tasks, schedules, users, shopifyDailySales, shops, workLocations
} from '@shared/schema';
import { config } from '../lib/config';
import logger from '../lib/logger';

const anthropic = new Anthropic({ apiKey: config.anthropic.apiKey });
const MODEL = 'claude-sonnet-4-20250514';

interface HuddleContent {
  win_of_the_day: string;
  lean_principle: string;
  goals: string[];
  heads_up: string[];
  kudos_summary?: string;
}

const LEAN_PRINCIPLES = [
  "Action This Day — if you see something that needs fixing, fix it NOW.",
  "Fix What Bugs You — the simplest improvement framework. What annoyed you? Fix it.",
  "2 Second Lean — find one way to save 2 seconds. Tiny improvements compound.",
  "Sweep Sort Standardize — see the workspace with fresh eyes every day.",
  "Make It Visual — if you improved something, show the before and after.",
  "One Piece Flow — finish one task completely before starting the next.",
  "Standard Work — the best known way to do something, until someone finds a better way.",
  "Grow People First — lean is always spelled P-E-O-P-L-E.",
  "Go See — don't assume, go look at the actual situation.",
  "Respect for People — every person's idea matters, every person's time matters.",
  "PDCA — Plan, Do, Check, Adjust. Try something small, see if it works, adjust.",
  "Waste Walk — walk the store looking for the 8 wastes: defects, overproduction, waiting, unused talent, transportation, inventory, motion, extra processing.",
  "5 Why — when something goes wrong, ask 'why?' five times to find the root cause.",
  "Gemba — the real answers are where the work happens, not in a spreadsheet.",
  "Kaizen — change for the better. Every single day.",
  "Visual Management — organize so anyone can see what's normal and what's not in 5 seconds.",
  "Pull Don't Push — respond to real demand, don't guess.",
  "Flow — remove the blockers that make work stop and start.",
  "Jidoka — if something is wrong, stop and fix it now, not later.",
  "Hansei — honest self-reflection. What can I personally do better tomorrow?",
];

const SYSTEM_PROMPT = `You are MAinager, a warm and energizing AI assistant for a retail boutique team. Generate the Morning Huddle agenda for today.

Your tone is: enthusiastic but genuine, like the best team lead who actually cares. Short sentences. Action-oriented. Never corporate-speak.

Return a JSON object with NO surrounding markdown:
{
  "win_of_the_day": "One specific, celebratory highlight from yesterday. Be specific — use names, numbers, details. Max 2 sentences.",
  "lean_principle": "One 2 Second Lean principle for today. Format: 'PRINCIPLE NAME — one sentence explanation and how to apply it today.'",
  "goals": ["3-5 specific, actionable goals for today based on the data provided. Each goal is one clear sentence."],
  "heads_up": ["Any alerts the team should know about. Only include if there's something genuinely worth mentioning. Can be empty."],
  "kudos_summary": "If there are kudos from the last 24 hours, summarize them warmly in 1-2 sentences. If none, omit this field."
}`;

async function gatherData(storeId: string, date: Date) {
  const yesterday = new Date(date);
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayStart = new Date(yesterday.setHours(0, 0, 0, 0));
  const yesterdayEnd = new Date(yesterday.setHours(23, 59, 59, 999));
  const todayStart = new Date(date);
  todayStart.setHours(0, 0, 0, 0);
  const todayEnd = new Date(date);
  todayEnd.setHours(23, 59, 59, 999);
  const last24h = new Date(date.getTime() - 24 * 60 * 60 * 1000);

  const [salesData, completedSops, resolvedIssues, todaySchedules, openTasks, urgentIssues, recentKudos] = await Promise.all([
    db.select().from(shopifyDailySales)
      .where(and(gte(shopifyDailySales.date, yesterdayStart), lte(shopifyDailySales.date, yesterdayEnd)))
      .limit(5).catch(() => []),

    db.select({ count: sql<number>`count(*)` }).from(sopExecutions)
      .where(and(
        eq(sopExecutions.storeId, storeId),
        eq(sopExecutions.status, 'completed'),
        gte(sopExecutions.completedAt, yesterdayStart),
        lte(sopExecutions.completedAt, yesterdayEnd)
      )).catch(() => [{ count: 0 }]),

    db.select({ count: sql<number>`count(*)` }).from(issues)
      .where(and(
        eq(issues.storeId, storeId),
        eq(issues.status, 'resolved'),
        gte(issues.resolvedAt, yesterdayStart),
        lte(issues.resolvedAt, yesterdayEnd)
      )).catch(() => [{ count: 0 }]),

    db.select({
      userId: schedules.userId,
      startTime: schedules.startTime,
      endTime: schedules.endTime,
    }).from(schedules)
      .where(and(
        gte(schedules.startTime, todayStart),
        lte(schedules.startTime, todayEnd)
      )).catch(() => []),

    db.select({ count: sql<number>`count(*)`, overdue: sql<number>`count(*) filter (where due_date < now())` })
      .from(tasks)
      .where(and(
        sql`${tasks.status} IN ('pending', 'in_progress')`,
      )).catch(() => [{ count: 0, overdue: 0 }]),

    db.select().from(issues)
      .where(and(
        eq(issues.storeId, storeId),
        sql`${issues.status} IN ('open', 'in_progress')`,
        sql`${issues.priority} IN ('urgent', 'high')`
      )).catch(() => []),

    db.select({
      id: kudos.id,
      fromEmployeeId: kudos.fromEmployeeId,
      toEmployeeId: kudos.toEmployeeId,
      message: kudos.message,
    }).from(kudos)
      .where(and(
        eq(kudos.storeId, storeId),
        gte(kudos.createdAt, last24h)
      )).catch(() => []),
  ]);

  const userIds = [
    ...todaySchedules.map(s => s.userId),
    ...recentKudos.map(k => k.fromEmployeeId),
    ...recentKudos.map(k => k.toEmployeeId),
  ].filter(Boolean);
  const uniqueUserIds = [...new Set(userIds)];

  let userMap: Record<string, string> = {};
  if (uniqueUserIds.length > 0) {
    const userRows = await db.select({ id: users.id, firstName: users.firstName, lastName: users.lastName })
      .from(users)
      .where(sql`${users.id} IN (${sql.join(uniqueUserIds.map(id => sql`${id}`), sql`, `)})`)
      .catch(() => []);
    userMap = Object.fromEntries(userRows.map(u => [u.id, `${u.firstName || ''} ${u.lastName || ''}`.trim() || 'Team member']));
  }

  const totalRevenue = salesData.reduce((sum, s) => sum + parseFloat(s.totalRevenue || '0'), 0);
  const totalOrders = salesData.reduce((sum, s) => sum + (s.orderCount || 0), 0);

  return {
    yesterday: {
      sales: totalRevenue > 0 ? `$${totalRevenue.toFixed(2)} revenue, ${totalOrders} orders` : 'No sales data available',
      completedSops: Number(completedSops[0]?.count || 0),
      resolvedIssues: Number(resolvedIssues[0]?.count || 0),
    },
    today: {
      scheduledEmployees: todaySchedules.map(s => ({
        name: userMap[s.userId] || 'Team member',
        shift: `${new Date(s.startTime!).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })} - ${new Date(s.endTime!).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`,
      })),
      openTasks: Number(openTasks[0]?.count || 0),
      overdueTasks: Number(openTasks[0]?.overdue || 0),
    },
    urgentIssues: urgentIssues.map(i => ({ title: i.title, priority: i.priority, category: i.category })),
    recentKudos: recentKudos.map(k => ({
      from: userMap[k.fromEmployeeId] || 'Someone',
      to: userMap[k.toEmployeeId] || 'a team member',
      message: k.message,
    })),
  };
}

export async function generateHuddleContent(storeId: string, date: Date): Promise<HuddleContent> {
  try {
    const data = await gatherData(storeId, date);
    const dayIndex = Math.floor(date.getTime() / 86400000) % LEAN_PRINCIPLES.length;
    const todaysLeanPrinciple = LEAN_PRINCIPLES[dayIndex];

    const userMessage = `Today is ${date.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}.

YESTERDAY'S RECAP:
- Sales: ${data.yesterday.sales}
- Completed SOPs: ${data.yesterday.completedSops}
- Resolved Issues: ${data.yesterday.resolvedIssues}

TODAY'S SCHEDULE:
${data.today.scheduledEmployees.length > 0
  ? data.today.scheduledEmployees.map(e => `- ${e.name}: ${e.shift}`).join('\n')
  : '- No scheduled shifts found'}

TODAY'S WORKLOAD:
- Open tasks: ${data.today.openTasks}${data.today.overdueTasks > 0 ? ` (${data.today.overdueTasks} overdue!)` : ''}

${data.urgentIssues.length > 0 ? `URGENT/HIGH PRIORITY ISSUES:\n${data.urgentIssues.map(i => `- [${i.priority.toUpperCase()}] ${i.title} (${i.category})`).join('\n')}` : 'No urgent issues.'}

${data.recentKudos.length > 0 ? `KUDOS FROM LAST 24 HOURS:\n${data.recentKudos.map(k => `- ${k.from} → ${k.to}: "${k.message}"`).join('\n')}` : 'No recent kudos.'}

Today's lean principle should be: "${todaysLeanPrinciple}"`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userMessage }],
    }, { signal: controller.signal });

    clearTimeout(timeout);

    const content = response.content[0];
    if (content.type !== 'text') throw new Error('Expected text response');

    const text = content.text.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
    const result: HuddleContent = JSON.parse(text);

    logger.info({ storeId, date: date.toISOString() }, 'Morning huddle content generated successfully');
    return result;

  } catch (error: any) {
    logger.error({ storeId, error: error.message }, 'Failed to generate huddle content, using fallback');

    const dayIndex = Math.floor(date.getTime() / 86400000) % LEAN_PRINCIPLES.length;
    return {
      win_of_the_day: "Good morning team! Let's make today great.",
      lean_principle: LEAN_PRINCIPLES[dayIndex],
      goals: ["Review and complete any open tasks", "Keep the store looking beautiful", "Take care of each other and our customers"],
      heads_up: [],
    };
  }
}

export async function getOrGenerateHuddle(storeId: string, date: Date) {
  const dateStr = date.toISOString().slice(0, 10);

  const [existing] = await db.select().from(morningHuddles)
    .where(and(eq(morningHuddles.storeId, storeId), eq(morningHuddles.huddleDate, dateStr)));

  if (existing) return existing;

  const content = await generateHuddleContent(storeId, date);

  const [huddle] = await db.insert(morningHuddles).values({
    storeId,
    huddleDate: dateStr,
    winOfTheDay: content.win_of_the_day,
    leanPrinciple: content.lean_principle,
    goals: content.goals,
    headsUp: content.heads_up,
    aiGeneratedContent: content as any,
    status: 'pending',
  }).returning();

  return huddle;
}
