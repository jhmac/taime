import Anthropic from "@anthropic-ai/sdk";
import { db } from "../db";
import { eq, and, lte } from "drizzle-orm";
import { operationalInsights, workLocations, users, roles } from "@shared/schema";
import { config } from "../lib/config";
import logger from "../lib/logger";
import {
  aggregateOperations,
  summarizeForAI,
  getStoreIdsWithActivity,
  type OperationsAggregate,
} from "./operationsIntelligence";

const anthropic = new Anthropic({ apiKey: config.anthropic.apiKey });
const MODEL = "claude-sonnet-4-20250514";

export type InsightSeverity = "info" | "suggestion" | "warning" | "action_needed";

export interface GeneratedInsight {
  insightType: string;
  affectedArea: string;
  severity: InsightSeverity;
  observation: string;
  whyItMatters: string;
  recommendedAction: string;
  dataPayload?: Record<string, unknown>;
  expiresAt?: Date;
}

async function callClaudeForInsights(
  systemPrompt: string,
  userPrompt: string,
  area: string,
): Promise<any[]> {
  try {
    let timeoutId: ReturnType<typeof setTimeout>;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => reject(new Error("AI timeout")), 15000);
    });

    const response = await Promise.race([
      anthropic.messages.create({
        model: MODEL,
        max_tokens: 1500,
        temperature: 0.3,
        system: systemPrompt,
        messages: [{ role: "user", content: userPrompt }],
      }),
      timeoutPromise,
    ]).finally(() => clearTimeout(timeoutId!));

    const text = response.content[0]?.type === "text" ? response.content[0].text : "";
    const cleaned = text.replace(/```json\s*/gi, "").replace(/```\s*/g, "").trim();
    const parsed = JSON.parse(cleaned);
    return Array.isArray(parsed) ? parsed : [];
  } catch (err: any) {
    logger.warn({ error: err.message, area }, "[InsightGenerator] AI call failed");
    return [];
  }
}

const COMMON_RULES = `Respond with a JSON array (no markdown fencing). Each entry has these fields:
- "observation": one specific sentence describing what was detected with concrete numbers
- "why_it_matters": one short sentence explaining the business / customer / team impact (the SO WHAT — separate from the observation, not a restatement of the numbers)
- "recommended_action": one specific actionable next step a small boutique owner can take today
- "severity": one of "info" | "suggestion" | "warning" | "action_needed"

Severity guide: action_needed = blocks operations / affects revenue. warning = trending bad. suggestion = optimisation. info = factual heads-up.

Be specific to small retail boutiques. Do NOT invent data. Only flag patterns supported by the numbers. If the data is healthy, return [].

The "why_it_matters" field is required and MUST be distinct from "observation" — observation states WHAT, why_it_matters states the business impact / risk / opportunity. If you cannot articulate a clear business impact, drop the insight entirely.

CRITICAL: Use the TEAM FEEDBACK SIGNAL section to avoid resurfacing patterns the team has already dismissed. If a similar insight appears in recent dismissals, only resurface it if the data has materially worsened. Lean into patterns similar to recent acted-on insights.`;

export async function analyzeScheduling(agg: OperationsAggregate): Promise<GeneratedInsight[]> {
  if (agg.schedules.total === 0) return [];

  const summary = summarizeForAI(agg);
  const sysPrompt = `You are MAinager's operations AI focused specifically on RETAIL SCHEDULING for a small boutique.
Analyse the SCHEDULING and ATTENDANCE sections. Look for:
- Days/shifts with coverage gaps that could leave the floor unstaffed
- Recurring weekday patterns of understaffing or overstaffing
- Coverage ratio mismatches (scheduled hours vs hours actually worked)
- High no-show estimates suggesting attendance issues

${COMMON_RULES}`;

  const raw = await callClaudeForInsights(sysPrompt, summary, "scheduling");
  return raw.map(r => ({
    insightType: "scheduling",
    affectedArea: "scheduling",
    severity: (r.severity as InsightSeverity) || "suggestion",
    observation: String(r.observation || "").trim(),
    whyItMatters: String(r.why_it_matters || r.whyItMatters || "").trim(),
    recommendedAction: String(r.recommended_action || r.recommendedAction || "").trim(),
    dataPayload: {
      coverageGaps: agg.schedules.coverageGaps.slice(0, 5),
      coverageRatio: agg.schedules.coverageRatio,
      noShowEstimate: agg.attendance.noShowEstimate,
    },
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
  })).filter(r => r.observation && r.recommendedAction && r.whyItMatters);
}

export async function analyzeTasks(agg: OperationsAggregate): Promise<GeneratedInsight[]> {
  if (agg.tasks.total === 0) return [];

  const summary = summarizeForAI(agg);
  const sysPrompt = `You are MAinager's operations AI focused specifically on TASK COMPLETION for a small boutique.
Analyse the TASKS section. Look for:
- Tasks pending more than 3 days (specific titles)
- Bottleneck assignees with consistently low completion rates
- Recurring tasks that aren't getting done (process or assignment issue)
- Categories or priorities with high abandonment

${COMMON_RULES}`;

  const raw = await callClaudeForInsights(sysPrompt, summary, "tasks");
  return raw.map(r => ({
    insightType: "task_completion",
    affectedArea: "tasks",
    severity: (r.severity as InsightSeverity) || "suggestion",
    observation: String(r.observation || "").trim(),
    whyItMatters: String(r.why_it_matters || r.whyItMatters || "").trim(),
    recommendedAction: String(r.recommended_action || r.recommendedAction || "").trim(),
    dataPayload: {
      pendingOver3Days: agg.tasks.pendingOver3Days.slice(0, 5),
      completionRate: agg.tasks.completionRate,
      recurringTasksWithLowCompletion: agg.tasks.recurringTasksWithLowCompletion,
    },
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
  })).filter(r => r.observation && r.recommendedAction && r.whyItMatters);
}

export async function analyzeIssues(agg: OperationsAggregate): Promise<GeneratedInsight[]> {
  if (agg.issues.total === 0) return [];

  const summary = summarizeForAI(agg);
  const sysPrompt = `You are MAinager's operations AI focused specifically on ISSUE TRENDS for a small boutique.
Analyse the ISSUES section. Look for:
- Issue categories that keep recurring (3+ occurrences) — root cause likely
- Unresolved issues aging past 3 days, especially high-priority
- Resolution time trending high
- Issues that appear in the same category repeatedly suggesting an SOP gap

${COMMON_RULES}`;

  const raw = await callClaudeForInsights(sysPrompt, summary, "issues");
  return raw.map(r => ({
    insightType: "issue_trend",
    affectedArea: "issues",
    severity: (r.severity as InsightSeverity) || "suggestion",
    observation: String(r.observation || "").trim(),
    whyItMatters: String(r.why_it_matters || r.whyItMatters || "").trim(),
    recommendedAction: String(r.recommended_action || r.recommendedAction || "").trim(),
    dataPayload: {
      recurringCategories: agg.issues.recurringCategories,
      unresolvedAgingDays: agg.issues.unresolvedAgingDays.slice(0, 5),
      highPriorityOpen: agg.issues.highPriorityOpen,
    },
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
  })).filter(r => r.observation && r.recommendedAction && r.whyItMatters);
}

// ── Phase 2: Team Performance AI ─────────────────────────────────────────────
// Coaching nudges for managers, focused on per-employee patterns:
// punctuality, SOP mastery, and kudos / recognition participation.
//
// Output is stored as `team_performance` insightType with affectedArea "team".
// Manager-only visibility is enforced at the API / UI layer (the page route is
// gated by manager.view_reports, and the dashboard widget is rendered only in
// the admin grid).
export async function analyzeTeamPerformance(agg: OperationsAggregate): Promise<GeneratedInsight[]> {
  const hasAnySignal =
    agg.team.punctuality.length > 0
    || agg.team.sopMastery.length > 0
    || agg.team.kudosParticipation.length > 0
    || agg.team.quietPerformers.length > 0;
  if (!hasAnySignal) return [];

  const summary = summarizeForAI(agg);
  const sysPrompt = `You are MAinager's operations AI focused specifically on TEAM PERFORMANCE COACHING for a small boutique manager.
Analyse the TEAM PERFORMANCE section. Look for:
- Specific employees who are persistently late (≥30% late shifts over ≥3 matched shifts) — name them and give a coaching script the manager can use
- Employees with weak SOP mastery (started ≥2 SOPs, completion <60%) — flag training need
- "Quiet performers" who show up reliably and finish SOPs but receive zero kudos — manager should explicitly recognise them this week
- Imbalances in kudos participation (one person sends none, or one person receives none)

Return AT MOST 4 entries — quality over quantity. Each entry MUST be specific (use names) and supportive in tone, never punitive. The manager is looking for coaching nudges, not write-up material.

${COMMON_RULES}`;

  const raw = await callClaudeForInsights(sysPrompt, summary, "team_performance");
  return raw.slice(0, 4).map(r => ({
    insightType: "team_performance",
    affectedArea: "team",
    severity: (r.severity as InsightSeverity) || "suggestion",
    observation: String(r.observation || "").trim(),
    whyItMatters: String(r.why_it_matters || r.whyItMatters || "").trim(),
    recommendedAction: String(r.recommended_action || r.recommendedAction || "").trim(),
    dataPayload: {
      punctuality: agg.team.punctuality.slice(0, 5),
      sopMastery: agg.team.sopMastery.slice(0, 5),
      kudosParticipation: agg.team.kudosParticipation.slice(0, 5),
      quietPerformers: agg.team.quietPerformers.slice(0, 5),
    },
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
  })).filter(r => r.observation && r.recommendedAction && r.whyItMatters);
}

export async function generateOperationalInsights(storeId: string): Promise<{ generated: number; insights: GeneratedInsight[] }> {
  logger.info({ storeId }, "[InsightGenerator] Starting generation for store");

  const agg = await aggregateOperations(storeId);

  const [schedulingInsights, taskInsights, issueInsights, teamInsights] = await Promise.all([
    analyzeScheduling(agg),
    analyzeTasks(agg),
    analyzeIssues(agg),
    analyzeTeamPerformance(agg),
  ]);

  const allInsights = [...schedulingInsights, ...taskInsights, ...issueInsights, ...teamInsights];

  if (allInsights.length === 0) {
    logger.info({ storeId }, "[InsightGenerator] No insights generated (data healthy or insufficient)");
    return { generated: 0, insights: [] };
  }

  // Replace active insights of these types with the new batch (preserve dismissed/acted_on for feedback context)
  const types = ["scheduling", "task_completion", "issue_trend", "team_performance"];
  for (const type of types) {
    await db.delete(operationalInsights).where(and(
      eq(operationalInsights.storeId, storeId),
      eq(operationalInsights.insightType, type),
      eq(operationalInsights.status, "active"),
    ));
  }

  for (const insight of allInsights) {
    try {
      await db.insert(operationalInsights).values({
        storeId,
        insightType: insight.insightType,
        affectedArea: insight.affectedArea,
        severity: insight.severity,
        observation: insight.observation,
        whyItMatters: insight.whyItMatters,
        recommendedAction: insight.recommendedAction,
        dataPayload: insight.dataPayload || null,
        expiresAt: insight.expiresAt || null,
        status: "active",
      });
    } catch (err: any) {
      logger.warn({ error: err.message, storeId }, "[InsightGenerator] Insert failed");
    }
  }

  logger.info({ storeId, count: allInsights.length }, "[InsightGenerator] Generation complete");
  return { generated: allInsights.length, insights: allInsights };
}

// ── Cron ─────────────────────────────────────────────────────────────────────
let cronTimer: ReturnType<typeof setInterval> | null = null;
let lastDailyRun = "";

export function startOperationalInsightsCron() {
  cronTimer = setInterval(async () => {
    try {
      const now = new Date();
      const todayStr = now.toISOString().slice(0, 10);
      const hour = now.getHours();

      // Daily run at 6am+, prune expired regardless of time
      await db.delete(operationalInsights).where(and(
        eq(operationalInsights.status, "active"),
        lte(operationalInsights.expiresAt, now),
      )).catch(() => {});

      if (hour < 6) return;
      if (lastDailyRun === todayStr) return;
      lastDailyRun = todayStr;

      logger.info("[InsightGenerator] Running daily operational insight generation");
      const stores = await getStoreIdsWithActivity();
      for (const storeId of stores) {
        try {
          await generateOperationalInsights(storeId);
        } catch (err: any) {
          logger.error({ error: err.message, storeId }, "[InsightGenerator] Daily run failed for store");
        }
      }
    } catch (err: any) {
      logger.error({ error: err.message }, "[InsightGenerator] Cron error");
    }
  }, 15 * 60 * 1000);

  logger.info("[InsightGenerator] Cron started (checks every 15 minutes)");
}

export function stopOperationalInsightsCron() {
  if (cronTimer) {
    clearInterval(cronTimer);
    cronTimer = null;
  }
}

// ── Owner email lookup helper (reused by weekly digest) ──────────────────────
//
// Returns owner / admin / manager recipients SCOPED to a specific store. A
// user is in scope for a store iff:
//   • they have an owner / admin / manager role, AND
//   • their users.locationId equals the requested storeId
//
// Globally-scoped super-admins (no locationId) are intentionally excluded —
// per-store digest content must not leak to people without an explicit
// membership relation to that store. If an installation needs cross-store
// digest delivery, it should give those super-admins an explicit primary
// store via users.locationId.
export async function getOwnerAndManagerEmailsForStore(
  storeId: string,
): Promise<Array<{ id: string; email: string; firstName: string | null }>> {
  try {
    const ownerRoles = await db.select({ id: roles.id, name: roles.name }).from(roles);
    const allowedRoleIds = ownerRoles
      .filter(r => r.name === "owner" || r.name === "admin" || r.name === "manager")
      .map(r => r.id);
    if (allowedRoleIds.length === 0) return [];

    const rows = await db.select({
      id: users.id,
      email: users.email,
      firstName: users.firstName,
      isActive: users.isActive,
      roleId: users.roleId,
      locationId: users.locationId,
    }).from(users);

    return rows
      .filter(u =>
        u.isActive
        && u.roleId
        && allowedRoleIds.includes(u.roleId)
        && u.email
        && u.locationId === storeId,
      )
      .map(u => ({ id: u.id, email: u.email!, firstName: u.firstName }));
  } catch (err: any) {
    logger.warn({ error: err.message, storeId }, "[InsightGenerator] Per-store owner email lookup failed");
    return [];
  }
}
