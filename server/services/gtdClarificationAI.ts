import { anthropic, withAiContext } from "../lib/aiClients";
import { config } from "../lib/config";
import { db } from "../db";
import { eq } from "drizzle-orm";
import { gtdInboxItems, gtdProjects, sopTemplates, workLocations } from "@shared/schema";
import logger from "../lib/logger";

const MODEL = "claude-sonnet-4-20250514";

const SYSTEM_PROMPT = `You are MAinager's GTD Clarification Engine for a retail boutique. Your job is to process a raw inbox capture and determine what it means and what should happen with it.

For each inbox item, determine:
1. Is it actionable? (yes/no)
2. If actionable: Does it require more than one step? (project vs single action)
3. If it's a single action: Can it be done in under 2 minutes? (two-minute rule)
4. What's the right destination?

Return JSON:
{
  "is_actionable": boolean,
  "suggested_destination": "next_action" | "project" | "waiting_for" | "someday_maybe" | "reference" | "trash" | "calendar" | "issue",
  "confidence": number (0-1, how confident you are in this classification),
  "reasoning": "brief explanation of why you chose this destination",
  "suggested_title": "clean, actionable title for the item (rewritten from raw input)",
  "suggested_description": "expanded detail if the raw input needs clarification",
  "suggested_context": "@store" | "@computer" | "@phone" | "@errands" | "@home" | "@anywhere" | null,
  "suggested_energy_level": "low" | "medium" | "high" | null,
  "suggested_time_estimate_minutes": number | null,
  "suggested_priority": "low" | "normal" | "high" | "urgent",
  "is_two_minute": boolean,
  "suggested_project_title": "if this should become a project, suggest a project name" | null,
  "suggested_due_date": "YYYY-MM-DD" | null,
  "suggested_waiting_on": "if this is a waiting-for, who/what are we waiting on?" | null,
  "suggested_category": "for someday/maybe items, suggest a category" | null,
  "related_sop_hint": "if this relates to an existing SOP, mention which one" | null
}

Context about the store and employee will be provided. Use this to make smart suggestions. For example:
- "need more bows" → next_action, context: @store, priority: normal, time: 15min
- "should we start doing personal styling appointments?" → someday_maybe, category: marketing idea
- "waiting on vendor to ship the new display" → waiting_for
- "the fitting room light is flickering again" → issue (route to the issue tracker)
- "rewrite the closing checklist to include the new register" → project (multi-step)
- "text Sarah about her special order" → next_action, is_two_minute: true, context: @phone

RETURN ONLY VALID JSON. No markdown fences, no explanation outside the JSON.`;

export interface ClarificationResult {
  is_actionable: boolean;
  suggested_destination: string;
  confidence: number;
  reasoning: string;
  suggested_title: string;
  suggested_description: string | null;
  suggested_context: string | null;
  suggested_energy_level: string | null;
  suggested_time_estimate_minutes: number | null;
  suggested_priority: string;
  is_two_minute: boolean;
  suggested_project_title: string | null;
  suggested_due_date: string | null;
  suggested_waiting_on: string | null;
  suggested_category: string | null;
  related_sop_hint: string | null;
}

async function getStoreContext(storeId: string): Promise<{ storeName: string; activeProjects: string[]; sopTitles: string[] }> {
  const [store] = await db.select({ name: workLocations.name }).from(workLocations).where(eq(workLocations.id, storeId));
  const storeName = store?.name || "Unknown Store";

  const projects = await db.select({ title: gtdProjects.title })
    .from(gtdProjects)
    .where(eq(gtdProjects.storeId, storeId));
  const activeProjects = projects.map(p => p.title);

  const sops = await db.select({ title: sopTemplates.title })
    .from(sopTemplates)
    .where(eq(sopTemplates.storeId, storeId));
  const sopTitles = sops.map(s => s.title);

  return { storeName, activeProjects, sopTitles };
}

export async function clarifyInboxItem(
  rawInput: string,
  storeId: string,
  employeeName: string,
  employeeRole: string,
): Promise<ClarificationResult | null> {
  const startTime = Date.now();

  try {
    const { storeName, activeProjects, sopTitles } = await getStoreContext(storeId);

    const now = new Date();
    const dayOfWeek = now.toLocaleDateString('en-US', { weekday: 'long' });
    const timeStr = now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });

    const userMessage = `Raw inbox capture: "${rawInput}"

Store: ${storeName}
Current time: ${dayOfWeek}, ${timeStr}
Employee: ${employeeName} (${employeeRole})
Active projects: ${activeProjects.length > 0 ? activeProjects.join(', ') : 'None'}
SOP templates: ${sopTitles.length > 0 ? sopTitles.join(', ') : 'None'}`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);

    try {
      const response = await anthropic.messages.create({
        model: MODEL,
        max_tokens: 512,
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: userMessage }],
      }, { signal: controller.signal });

      clearTimeout(timeout);

      const content = response.content[0];
      if (content.type !== 'text') {
        throw new Error('Expected text response from Claude');
      }

      const text = content.text.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error('Could not extract JSON from response');
      }

      const result: ClarificationResult = JSON.parse(jsonMatch[0]);
      const latency = Date.now() - startTime;

      logger.info(
        { storeId, inputLength: rawInput.length, destination: result.suggested_destination, confidence: result.confidence, latencyMs: latency },
        'GTD inbox item clarified'
      );

      return result;
    } finally {
      clearTimeout(timeout);
    }
  } catch (error: any) {
    const latency = Date.now() - startTime;
    logger.error(
      { storeId, inputLength: rawInput.length, error: error.message, latencyMs: latency },
      'GTD clarification failed, item will remain unprocessed'
    );
    return null;
  }
}

export async function triggerClarification(
  itemId: string,
  rawInput: string,
  storeId: string,
  employeeName: string,
  employeeRole: string,
  broadcastToAll: (data: any) => void,
): Promise<void> {
  const result = await clarifyInboxItem(rawInput, storeId, employeeName, employeeRole);

  if (result) {
    await db.update(gtdInboxItems)
      .set({
        aiClarification: result,
        status: 'clarified',
        updatedAt: new Date(),
      })
      .where(eq(gtdInboxItems.id, itemId));

    broadcastToAll({
      type: 'inbox_item_clarified',
      data: { item_id: itemId, clarification: result },
    });
  }
}
