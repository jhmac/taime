import Anthropic from '@anthropic-ai/sdk';
import { config } from "../lib/config";
import { db } from "../db";
import { eq, and, gte, sql, desc, inArray, isNotNull } from "drizzle-orm";
import {
  sopTemplates, sopSteps, sopInsights, sopRevisionProposals,
  dailyDebriefs,
} from "@shared/schema";
import logger from "../lib/logger";

const anthropic = new Anthropic({ apiKey: config.anthropic.apiKey });
const MODEL = "claude-sonnet-4-20250514";

const EVOLUTION_SYSTEM_PROMPT = `You are MAinager's SOP Evolution engine. Given employee feedback and analytics data about a specific procedure, propose concrete revisions.

Rules:
- Each proposal must be specific enough that the owner can approve or reject it quickly
- Reference the actual employee feedback and data points
- Be constructive — you're improving procedures, not criticizing them
- Propose the SMALLEST change that would address the issue
- Never propose removing safety or compliance steps

Return JSON:
{
  "proposals": [
    {
      "proposal_type": "add_step" | "remove_step" | "modify_step" | "reorder_steps" | "update_description" | "split_step" | "general",
      "title": "Short description (max 10 words)",
      "description": "Detailed explanation of what to change and why (2-4 sentences)",
      "ai_rationale": "Data-backed reasoning: which employee feedback + which analytics support this change",
      "proposed_changes": {}
    }
  ]
}

Only propose changes where the evidence is strong. If there's nothing to improve, return an empty proposals array.`;

interface DebriefSignal {
  debriefId: string;
  text: string;
  category: string | null;
  date: string;
}

interface InsightSignal {
  insightId: string;
  headline: string;
  detail: string;
  severity: string;
  dataPoint: string | null;
  insightType: string;
}

interface SOPSignals {
  templateId: string;
  templateTitle: string;
  debriefs: DebriefSignal[];
  insights: InsightSignal[];
}

export async function generateRevisionProposals(storeId: string): Promise<number> {
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  const templates = await db.select({
    id: sopTemplates.id,
    title: sopTemplates.title,
    description: sopTemplates.description,
  }).from(sopTemplates)
    .where(and(
      eq(sopTemplates.storeId, storeId),
      eq(sopTemplates.isActive, true),
    ));

  if (templates.length === 0) return 0;

  const processDebriefs = await db.select({
    id: dailyDebriefs.id,
    whatBuggedYou: dailyDebriefs.whatBuggedYou,
    whatBuggedYouCategory: dailyDebriefs.whatBuggedYouCategory,
    debriefDate: dailyDebriefs.debriefDate,
  }).from(dailyDebriefs)
    .where(and(
      eq(dailyDebriefs.storeId, storeId),
      gte(dailyDebriefs.createdAt, thirtyDaysAgo),
      isNotNull(dailyDebriefs.whatBuggedYou),
      eq(dailyDebriefs.whatBuggedYouCategory, "process"),
    ));

  const activeInsights = await db.select().from(sopInsights)
    .where(and(
      eq(sopInsights.storeId, storeId),
      eq(sopInsights.status, "active"),
      sql`severity IN ('warning', 'action_needed')`,
    ));

  const sopSignalsMap = new Map<string, SOPSignals>();
  for (const t of templates) {
    sopSignalsMap.set(t.id, {
      templateId: t.id,
      templateTitle: t.title,
      debriefs: [],
      insights: [],
    });
  }

  for (const insight of activeInsights) {
    if (insight.sopTemplateId && sopSignalsMap.has(insight.sopTemplateId)) {
      sopSignalsMap.get(insight.sopTemplateId)!.insights.push({
        insightId: insight.id,
        headline: insight.headline,
        detail: insight.detail,
        severity: insight.severity,
        dataPoint: insight.dataPoint,
        insightType: insight.insightType,
      });
    }
  }

  if (processDebriefs.length > 0) {
    const templateTitles = templates.map(t => ({
      id: t.id,
      title: t.title.toLowerCase(),
      description: (t.description || "").toLowerCase(),
    }));

    for (const debrief of processDebriefs) {
      const text = (debrief.whatBuggedYou || "").toLowerCase();
      if (!text || text.length < 10) continue;

      for (const t of templateTitles) {
        const titleWords = t.title.split(/\s+/).filter(w => w.length > 3);
        const matched = titleWords.some(word => text.includes(word));
        if (matched) {
          sopSignalsMap.get(t.id)!.debriefs.push({
            debriefId: debrief.id,
            text: debrief.whatBuggedYou!,
            category: debrief.whatBuggedYouCategory,
            date: debrief.debriefDate,
          });
        }
      }
    }
  }

  const sopsWithSignals = Array.from(sopSignalsMap.values()).filter(s =>
    s.debriefs.length >= 2 || s.insights.some(i => i.severity === "action_needed")
  );

  if (sopsWithSignals.length === 0) {
    logger.info({ storeId }, "[SOPEvolution] No SOPs with sufficient signals for revision proposals");
    return 0;
  }

  let totalProposals = 0;

  for (const sopSignal of sopsWithSignals) {
    try {
      const steps = await db.select({
        id: sopSteps.id,
        stepOrder: sopSteps.stepOrder,
        title: sopSteps.title,
        description: sopSteps.description,
        stepType: sopSteps.stepType,
      }).from(sopSteps)
        .where(eq(sopSteps.templateId, sopSignal.templateId))
        .orderBy(sopSteps.stepOrder);

      const userMessage = JSON.stringify({
        sop_title: sopSignal.templateTitle,
        steps: steps.map(s => ({
          order: s.stepOrder,
          title: s.title,
          type: s.stepType,
          description: s.description,
        })),
        employee_feedback: sopSignal.debriefs.map(d => ({
          quote: d.text,
          date: d.date,
        })),
        analytics_insights: sopSignal.insights.map(i => ({
          type: i.insightType,
          severity: i.severity,
          headline: i.headline,
          detail: i.detail,
          data_point: i.dataPoint,
        })),
      }, null, 2);

      let proposals: Array<{
        proposal_type: string;
        title: string;
        description: string;
        ai_rationale: string;
        proposed_changes: any;
      }> = [];

      try {
        let timeoutId: ReturnType<typeof setTimeout>;
        const result = await Promise.race([
          anthropic.messages.create({
            model: MODEL,
            max_tokens: 2000,
            system: EVOLUTION_SYSTEM_PROMPT,
            messages: [{ role: "user", content: userMessage }],
          }),
          new Promise<never>((_, reject) => {
            timeoutId = setTimeout(() => reject(new Error("AI timeout")), 15000);
          }),
        ]).finally(() => clearTimeout(timeoutId!));

        const text = result.content[0].type === "text" ? result.content[0].text : "";
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]);
          const rawProposals = parsed.proposals || [];
          const validTypes = ["add_step", "remove_step", "modify_step", "reorder_steps", "update_description", "split_step", "general"];
          proposals = rawProposals.filter((p: any) =>
            p.title && typeof p.title === "string" &&
            p.description && typeof p.description === "string" &&
            validTypes.includes(p.proposal_type)
          );
        } else {
          logger.warn({ templateId: sopSignal.templateId }, "[SOPEvolution] No valid JSON in AI response");
        }
      } catch (err: any) {
        logger.error({ error: err.message, templateId: sopSignal.templateId }, "[SOPEvolution] AI generation failed");
        continue;
      }

      if (proposals.length > 0) {
        const sourceIds = [
          ...sopSignal.debriefs.map(d => d.debriefId),
          ...sopSignal.insights.map(i => i.insightId),
        ];

        const sourceType = sopSignal.debriefs.length > 0 && sopSignal.insights.length > 0
          ? "ai_suggestion"
          : sopSignal.debriefs.length > 0
          ? "what_bugged_you"
          : "sop_insight";

        const rows = proposals.map(p => ({
          storeId,
          sopTemplateId: sopSignal.templateId,
          sourceType,
          sourceIds,
          proposalType: p.proposal_type,
          title: p.title,
          description: p.description,
          aiRationale: p.ai_rationale || null,
          proposedChanges: p.proposed_changes || null,
          status: "pending" as const,
        }));

        await db.insert(sopRevisionProposals).values(rows);
        totalProposals += rows.length;
      }
    } catch (err: any) {
      logger.error({ error: err.message, templateId: sopSignal.templateId }, "[SOPEvolution] Failed to process SOP");
    }
  }

  logger.info({ storeId, count: totalProposals }, "[SOPEvolution] Revision proposals generated");
  return totalProposals;
}

let evolutionCronTimer: ReturnType<typeof setInterval> | null = null;
let lastEvolutionDate: string | null = null;

export function startSOPEvolutionCron() {
  evolutionCronTimer = setInterval(async () => {
    const now = new Date();
    if (now.getDay() !== 0 || now.getHours() < 7) return;

    const todayStr = now.toISOString().split("T")[0];
    if (lastEvolutionDate === todayStr) return;
    lastEvolutionDate = todayStr;

    logger.info("[SOPEvolution] Running Sunday cron");

    try {
      const stores = await db.selectDistinct({ storeId: sopTemplates.storeId })
        .from(sopTemplates)
        .where(eq(sopTemplates.isActive, true));

      for (const { storeId } of stores) {
        try {
          await generateRevisionProposals(storeId);
        } catch (err: any) {
          logger.error({ error: err.message, storeId }, "[SOPEvolution] Cron failed for store");
        }
      }
    } catch (err: any) {
      logger.error({ error: err.message }, "[SOPEvolution] Cron failed");
      lastEvolutionDate = null;
    }
  }, 15 * 60 * 1000);

  logger.info("[SOPEvolution] Cron started (checks every 15 minutes, runs Sundays at 7am)");
}

export function stopSOPEvolutionCron() {
  if (evolutionCronTimer) {
    clearInterval(evolutionCronTimer);
    evolutionCronTimer = null;
  }
}
