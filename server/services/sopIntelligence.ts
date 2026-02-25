import Anthropic from '@anthropic-ai/sdk';
import { config } from "../lib/config";
import { db } from "../db";
import { eq, and, gte, lte, sql, desc, inArray, isNotNull } from "drizzle-orm";
import {
  sopTemplates, sopSteps, sopExecutions, sopStepCompletions, sopInsights,
} from "@shared/schema";
import logger from "../lib/logger";

const anthropic = new Anthropic({ apiKey: config.anthropic.apiKey });
const MODEL = "claude-sonnet-4-20250514";

export interface StepMetrics {
  stepId: string;
  title: string;
  stepOrder: number;
  stepType: string;
  avgTimeSeconds: number;
  medianTimeSeconds: number;
  skipRate: number;
  photoComplianceRate: number | null;
  timeStdDev: number;
  frictionFlags: string[];
}

export interface EmployeePattern {
  employeeId: string;
  avgCompletionSeconds: number;
  totalExecutions: number;
  avgStepsSkipped: number;
}

export interface SOPAnalysis {
  templateId: string;
  templateTitle: string;
  overallMetrics: {
    totalExecutions: number;
    avgCompletionSeconds: number;
    estimatedDurationSeconds: number | null;
    completionRate: number;
    avgStepsSkipped: number;
  };
  stepMetrics: StepMetrics[];
  employeePatterns: EmployeePattern[];
  trends: {
    weeklyCompletionTimes: number[];
    weeklySkipRates: number[];
    completionTimeTrend: "improving" | "worsening" | "stable";
    skipRateTrend: "improving" | "worsening" | "stable";
  };
}

function median(arr: number[]): number {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function stdDev(arr: number[]): number {
  if (arr.length < 2) return 0;
  const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
  const variance = arr.reduce((sum, v) => sum + (v - mean) ** 2, 0) / (arr.length - 1);
  return Math.sqrt(variance);
}

function determineTrend(values: number[]): "improving" | "worsening" | "stable" {
  if (values.length < 2) return "stable";
  const nonZero = values.filter(v => v > 0);
  if (nonZero.length < 2) return "stable";
  const first = nonZero.slice(0, Math.ceil(nonZero.length / 2));
  const second = nonZero.slice(Math.ceil(nonZero.length / 2));
  const avgFirst = first.reduce((a, b) => a + b, 0) / first.length;
  const avgSecond = second.reduce((a, b) => a + b, 0) / second.length;
  const change = (avgSecond - avgFirst) / (avgFirst || 1);
  if (Math.abs(change) < 0.1) return "stable";
  return change < 0 ? "improving" : "worsening";
}

export async function analyzeSOP(templateId: string, storeId: string): Promise<SOPAnalysis | null> {
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  const template = await db.select().from(sopTemplates)
    .where(and(eq(sopTemplates.id, templateId), eq(sopTemplates.storeId, storeId)))
    .then(r => r[0]);

  if (!template) return null;

  const steps = await db.select().from(sopSteps)
    .where(eq(sopSteps.templateId, templateId))
    .orderBy(sopSteps.stepOrder);

  const executions = await db.select().from(sopExecutions)
    .where(and(
      eq(sopExecutions.templateId, templateId),
      eq(sopExecutions.storeId, storeId),
      gte(sopExecutions.startedAt, thirtyDaysAgo),
    ));

  if (executions.length === 0) {
    return {
      templateId,
      templateTitle: template.title,
      overallMetrics: {
        totalExecutions: 0,
        avgCompletionSeconds: 0,
        estimatedDurationSeconds: template.estimatedDurationMinutes ? template.estimatedDurationMinutes * 60 : null,
        completionRate: 0,
        avgStepsSkipped: 0,
      },
      stepMetrics: steps.map(s => ({
        stepId: s.id,
        title: s.title,
        stepOrder: s.stepOrder,
        stepType: s.stepType,
        avgTimeSeconds: 0,
        medianTimeSeconds: 0,
        skipRate: 0,
        photoComplianceRate: s.stepType === "photo" ? 0 : null,
        timeStdDev: 0,
        frictionFlags: [],
      })),
      employeePatterns: [],
      trends: {
        weeklyCompletionTimes: [],
        weeklySkipRates: [],
        completionTimeTrend: "stable",
        skipRateTrend: "stable",
      },
    };
  }

  const executionIds = executions.map(e => e.id);
  const completions = await db.select().from(sopStepCompletions)
    .where(inArray(sopStepCompletions.executionId, executionIds));

  const completionsByExecution = new Map<string, typeof completions>();
  const completionsByStep = new Map<string, typeof completions>();
  for (const c of completions) {
    if (!completionsByExecution.has(c.executionId)) completionsByExecution.set(c.executionId, []);
    completionsByExecution.get(c.executionId)!.push(c);
    if (!completionsByStep.has(c.stepId)) completionsByStep.set(c.stepId, []);
    completionsByStep.get(c.stepId)!.push(c);
  }

  const completed = executions.filter(e => e.status === "completed");
  const abandoned = executions.filter(e => e.status === "abandoned");

  const completionTimes = completed
    .filter(e => e.completedAt && e.startedAt)
    .map(e => (new Date(e.completedAt!).getTime() - new Date(e.startedAt!).getTime()) / 1000);

  const avgCompletionSeconds = completionTimes.length > 0
    ? Math.round(completionTimes.reduce((a, b) => a + b, 0) / completionTimes.length)
    : 0;

  const completionRate = executions.length > 0
    ? Math.round((completed.length / (completed.length + abandoned.length || 1)) * 100)
    : 0;

  const skippedCounts = executionIds.map(exId => {
    const stepComps = completionsByExecution.get(exId) || [];
    return stepComps.filter(c => c.status === "skipped").length;
  });
  const avgStepsSkipped = skippedCounts.length > 0
    ? Math.round((skippedCounts.reduce((a, b) => a + b, 0) / skippedCounts.length) * 10) / 10
    : 0;

  const stepMetricsList: StepMetrics[] = steps.map(step => {
    const stepComps = completionsByStep.get(step.id) || [];
    const times = stepComps
      .filter(c => c.timeSpentSeconds && c.timeSpentSeconds > 0)
      .map(c => c.timeSpentSeconds!);
    const skipped = stepComps.filter(c => c.status === "skipped").length;
    const total = stepComps.length || 1;
    const skipRate = Math.round((skipped / total) * 100);

    let photoComplianceRate: number | null = null;
    if (step.stepType === "photo") {
      const withPhoto = stepComps.filter(c => c.photoUrl).length;
      const photoTotal = stepComps.filter(c => c.status === "completed").length;
      photoComplianceRate = photoTotal > 0 ? Math.round((withPhoto / photoTotal) * 100) : 0;
    }

    const frictionFlags: string[] = [];
    if (skipRate > 20) frictionFlags.push("frequently_skipped");

    return {
      stepId: step.id,
      title: step.title,
      stepOrder: step.stepOrder,
      stepType: step.stepType,
      avgTimeSeconds: times.length > 0 ? Math.round(times.reduce((a, b) => a + b, 0) / times.length) : 0,
      medianTimeSeconds: Math.round(median(times)),
      skipRate,
      photoComplianceRate,
      timeStdDev: Math.round(stdDev(times) * 10) / 10,
      frictionFlags,
    };
  });

  const allMedianTimes = stepMetricsList
    .map(s => s.medianTimeSeconds)
    .filter(t => t > 0);
  const overallMedian = median(allMedianTimes);

  for (const sm of stepMetricsList) {
    if (overallMedian > 0 && sm.avgTimeSeconds > overallMedian * 3) {
      sm.frictionFlags.push("friction_point");
    }
    if (sm.timeStdDev > sm.avgTimeSeconds * 0.8 && sm.avgTimeSeconds > 0) {
      sm.frictionFlags.push("inconsistent");
    }
  }

  const employeeMap = new Map<string, { times: number[]; skips: number; exCount: number }>();
  for (const ex of executions) {
    if (!ex.employeeId) continue;
    if (!employeeMap.has(ex.employeeId)) {
      employeeMap.set(ex.employeeId, { times: [], skips: 0, exCount: 0 });
    }
    const emp = employeeMap.get(ex.employeeId)!;
    emp.exCount++;
    if (ex.completedAt && ex.startedAt) {
      emp.times.push((new Date(ex.completedAt).getTime() - new Date(ex.startedAt).getTime()) / 1000);
    }
    const exComps = completionsByExecution.get(ex.id) || [];
    emp.skips += exComps.filter(c => c.status === "skipped").length;
  }

  const employeePatterns: EmployeePattern[] = Array.from(employeeMap.entries()).map(([empId, data]) => ({
    employeeId: empId,
    avgCompletionSeconds: data.times.length > 0
      ? Math.round(data.times.reduce((a, b) => a + b, 0) / data.times.length)
      : 0,
    totalExecutions: data.exCount,
    avgStepsSkipped: Math.round((data.skips / data.exCount) * 10) / 10,
  }));

  const weeklyCompletionTimes: number[] = [];
  const weeklySkipRates: number[] = [];
  for (let w = 3; w >= 0; w--) {
    const weekStart = new Date();
    weekStart.setDate(weekStart.getDate() - (w + 1) * 7);
    const weekEnd = new Date();
    weekEnd.setDate(weekEnd.getDate() - w * 7);

    const weekExecs = executions.filter(e => {
      const d = new Date(e.startedAt!);
      return d >= weekStart && d < weekEnd;
    });

    const weekTimes = weekExecs
      .filter(e => e.completedAt && e.startedAt)
      .map(e => (new Date(e.completedAt!).getTime() - new Date(e.startedAt!).getTime()) / 1000);

    weeklyCompletionTimes.push(
      weekTimes.length > 0 ? Math.round(weekTimes.reduce((a, b) => a + b, 0) / weekTimes.length) : 0
    );

    const weekCompletionIdSet = new Set(weekExecs.map(e => e.id));
    const weekComps = completions.filter(c => weekCompletionIdSet.has(c.executionId));
    const weekSkipped = weekComps.filter(c => c.status === "skipped").length;
    const weekTotal = weekComps.length || 1;
    weeklySkipRates.push(Math.round((weekSkipped / weekTotal) * 100));
  }

  return {
    templateId,
    templateTitle: template.title,
    overallMetrics: {
      totalExecutions: executions.length,
      avgCompletionSeconds,
      estimatedDurationSeconds: template.estimatedDurationMinutes ? template.estimatedDurationMinutes * 60 : null,
      completionRate,
      avgStepsSkipped,
    },
    stepMetrics: stepMetricsList,
    employeePatterns,
    trends: {
      weeklyCompletionTimes,
      weeklySkipRates,
      completionTimeTrend: determineTrend(weeklyCompletionTimes),
      skipRateTrend: determineTrend(weeklySkipRates.map(r => -r)),
    },
  };
}

const INSIGHT_SYSTEM_PROMPT = `You are MAinager's SOP Intelligence engine. Given execution analytics for a boutique store's procedures, generate actionable insights.

For each insight, provide:
- A clear, specific observation (what the data shows)
- Why it matters (business impact)
- A recommended action

Tone: direct, constructive, like a thoughtful operations consultant. Not alarmist.

Return JSON:
{
  "insights": [
    {
      "type": "friction" | "skip_pattern" | "time_trend" | "training_gap" | "optimization",
      "severity": "info" | "warning" | "action_needed",
      "sop_template_id": "uuid",
      "sop_title": "...",
      "step_id": "uuid or null",
      "step_title": "... or null",
      "headline": "One-line insight (max 15 words)",
      "detail": "2-3 sentences explaining the observation and its impact",
      "recommendation": "One specific action to take",
      "data_point": "The key number supporting this insight (e.g., '3.2x slower', '45% skip rate')"
    }
  ]
}

Examples:
- "Step 4 of Opening Checklist takes 3x longer than other steps. Consider splitting into sub-steps or adding clearer instructions."
- "The closing checklist skip rate jumped from 5% to 18% this month. This often indicates the procedure has gotten stale or unclear."
- "New hires take 2.5x longer on the Visual Merchandising SOP than veterans. Training mode content may need updating."

Only generate insights where the data clearly supports them. If everything looks healthy, return fewer insights with severity "info". Return at most 10 insights.`;

export async function generateSOPInsights(storeId: string): Promise<void> {
  const templates = await db.select().from(sopTemplates)
    .where(and(
      eq(sopTemplates.storeId, storeId),
      eq(sopTemplates.isActive, true),
    ));

  if (templates.length === 0) {
    logger.info({ storeId }, "[SOPIntelligence] No active templates for store");
    return;
  }

  const analyses: SOPAnalysis[] = [];
  for (const t of templates) {
    const analysis = await analyzeSOP(t.id, storeId);
    if (analysis && analysis.overallMetrics.totalExecutions > 0) {
      analyses.push(analysis);
    }
  }

  if (analyses.length === 0) {
    logger.info({ storeId }, "[SOPIntelligence] No execution data for any templates");
    return;
  }

  const analyticsPayload = analyses.map(a => ({
    template_id: a.templateId,
    title: a.templateTitle,
    total_executions: a.overallMetrics.totalExecutions,
    completion_rate: a.overallMetrics.completionRate + "%",
    avg_completion_seconds: a.overallMetrics.avgCompletionSeconds,
    estimated_duration_seconds: a.overallMetrics.estimatedDurationSeconds,
    avg_steps_skipped: a.overallMetrics.avgStepsSkipped,
    steps_with_friction: a.stepMetrics.filter(s => s.frictionFlags.length > 0).map(s => ({
      step_id: s.stepId,
      title: s.title,
      flags: s.frictionFlags,
      avg_time: s.avgTimeSeconds,
      skip_rate: s.skipRate + "%",
      std_dev: s.timeStdDev,
    })),
    employee_count: a.employeePatterns.length,
    fastest_avg: a.employeePatterns.length > 0
      ? Math.min(...a.employeePatterns.filter(e => e.avgCompletionSeconds > 0).map(e => e.avgCompletionSeconds))
      : null,
    slowest_avg: a.employeePatterns.length > 0
      ? Math.max(...a.employeePatterns.map(e => e.avgCompletionSeconds))
      : null,
    completion_time_trend: a.trends.completionTimeTrend,
    skip_rate_trend: a.trends.skipRateTrend,
  }));

  let insights: Array<{
    type: string;
    severity: string;
    sop_template_id: string;
    sop_title: string;
    step_id: string | null;
    step_title: string | null;
    headline: string;
    detail: string;
    recommendation: string;
    data_point: string;
  }> = [];

  try {
    let timeoutId: ReturnType<typeof setTimeout>;
    const result = await Promise.race([
      anthropic.messages.create({
        model: MODEL,
        max_tokens: 2000,
        system: INSIGHT_SYSTEM_PROMPT,
        messages: [{
          role: "user",
          content: `Analyze these SOP execution metrics for a boutique store and generate insights:\n\n${JSON.stringify(analyticsPayload, null, 2)}`,
        }],
      }),
      new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error("AI timeout")), 15000);
      }),
    ]).finally(() => clearTimeout(timeoutId!));

    const text = result.content[0].type === "text" ? result.content[0].text : "";
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      insights = parsed.insights || [];
    }
  } catch (err: any) {
    logger.error({ error: err.message, storeId }, "[SOPIntelligence] AI generation failed");
  }

  await db.delete(sopInsights)
    .where(and(
      eq(sopInsights.storeId, storeId),
      eq(sopInsights.status, "active"),
    ));

  if (insights.length > 0) {
    const rows = insights.map(i => ({
      storeId,
      insightType: i.type,
      severity: i.severity,
      sopTemplateId: i.sop_template_id || null,
      stepId: i.step_id || null,
      headline: i.headline,
      detail: i.detail,
      recommendation: i.recommendation,
      dataPoint: i.data_point || null,
      status: "active" as const,
    }));

    await db.insert(sopInsights).values(rows);
    logger.info({ storeId, count: rows.length }, "[SOPIntelligence] Insights generated");
  }
}

let insightsCronTimer: ReturnType<typeof setInterval> | null = null;
let lastInsightDate: string | null = null;

export function startSOPInsightsCron() {
  insightsCronTimer = setInterval(async () => {
    const now = new Date();
    if (now.getDay() !== 0 || now.getHours() < 6) return;

    const todayStr = now.toISOString().split("T")[0];
    if (lastInsightDate === todayStr) return;
    lastInsightDate = todayStr;

    logger.info("[SOPIntelligence] Running Sunday cron");

    try {
      const stores = await db.selectDistinct({ storeId: sopTemplates.storeId })
        .from(sopTemplates)
        .where(eq(sopTemplates.isActive, true));

      for (const { storeId } of stores) {
        try {
          await generateSOPInsights(storeId);
        } catch (err: any) {
          logger.error({ error: err.message, storeId }, "[SOPIntelligence] Cron failed for store");
        }
      }
    } catch (err: any) {
      logger.error({ error: err.message }, "[SOPIntelligence] Cron failed");
      lastInsightDate = null;
    }
  }, 15 * 60 * 1000);

  logger.info("[SOPIntelligence] Cron started (checks every 15 minutes, runs Sundays at 6am)");
}

export function stopSOPInsightsCron() {
  if (insightsCronTimer) {
    clearInterval(insightsCronTimer);
    insightsCronTimer = null;
  }
}
