import Anthropic from '@anthropic-ai/sdk';
import { config } from "../lib/config";

const anthropic = new Anthropic({
  apiKey: config.anthropic.apiKey,
});

const MODEL = "claude-sonnet-4-20250514";

const SYSTEM_PROMPT = `You are MAinager's SOP generation assistant for a retail boutique. Given a plain English description of a procedure, generate a structured SOP.

Return a JSON object with this exact structure:
{
  "title": "concise SOP title",
  "description": "1-2 sentence summary",
  "category": "opening|closing|customer_service|visual_merchandising|inventory|safety|shift_handoff|custom",
  "estimated_duration_minutes": number,
  "training_notes": "Brief explanation of WHY this procedure matters — written warmly, as if explaining to a new team member",
  "steps": [
    {
      "title": "short action description",
      "description": "detailed instructions if needed",
      "step_type": "action|verification|photo|decision|timer",
      "is_checkpoint": boolean,
      "timer_duration_seconds": number or null,
      "training_detail": "expanded 'why' for this specific step"
    }
  ]
}

Guidelines:
- Break procedures into clear, atomic steps (one action per step)
- Add photo checkpoints for visual verification steps (clean displays, organized shelves, etc.)
- Add verification steps after critical actions
- Keep step titles under 10 words
- Training details should answer "why do we do this?" in a friendly tone
- Estimate realistic durations based on retail store context
- If the description mentions quality checks, make those checkpoint steps
- Return ONLY the JSON object, no markdown fences or extra text`;

interface StoreContext {
  storeName?: string;
  timezone?: string;
}

interface GeneratedStep {
  title: string;
  description: string | null;
  step_type: string;
  is_checkpoint: boolean;
  timer_duration_seconds: number | null;
  training_detail: string | null;
}

interface GeneratedSOP {
  title: string;
  description: string;
  category: string;
  estimated_duration_minutes: number;
  training_notes: string;
  steps: GeneratedStep[];
}

const rateLimitMap = new Map<string, { count: number; resetAt: number }>();

function checkRateLimit(storeId: string): boolean {
  const now = Date.now();
  const entry = rateLimitMap.get(storeId);
  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(storeId, { count: 1, resetAt: now + 3600000 });
    return true;
  }
  if (entry.count >= 10) return false;
  entry.count++;
  return true;
}

function parseAIResponse(text: string): GeneratedSOP {
  let cleaned = text.trim();
  const fenceMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) {
    cleaned = fenceMatch[1].trim();
  }
  const parsed = JSON.parse(cleaned) as GeneratedSOP;

  const validCategories = ["opening", "closing", "customer_service", "visual_merchandising", "inventory", "safety", "shift_handoff", "custom"];
  if (!validCategories.includes(parsed.category)) {
    parsed.category = "custom";
  }

  const validStepTypes = ["action", "verification", "photo", "decision", "timer"];
  parsed.steps = parsed.steps.map(step => ({
    ...step,
    step_type: validStepTypes.includes(step.step_type) ? step.step_type : "action",
    is_checkpoint: !!step.is_checkpoint,
    timer_duration_seconds: step.step_type === "timer" ? (step.timer_duration_seconds ?? 60) : null,
  }));

  return parsed;
}

export async function generateSOPFromDescription(
  description: string,
  storeId: string,
  context?: StoreContext
): Promise<GeneratedSOP> {
  if (!checkRateLimit(storeId)) {
    throw new Error("Rate limit reached: maximum 10 AI generations per store per hour. Please try again later.");
  }

  const startTime = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);

  try {
    const userMessage = context?.storeName
      ? `Store: ${context.storeName}${context.timezone ? ` (${context.timezone})` : ''}\n\nProcedure description:\n${description}`
      : `Procedure description:\n${description}`;

    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 2000,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: userMessage }],
    }, { signal: controller.signal });

    const latency = Date.now() - startTime;
    const textBlock = response.content.find(b => b.type === "text");
    if (!textBlock || textBlock.type !== "text") {
      throw new Error("No text response from AI");
    }

    const result = parseAIResponse(textBlock.text);
    console.info(`[SOP AI] Generated SOP: ${result.steps.length} steps, ${latency}ms, input ${description.length} chars`);
    return result;
  } catch (err: unknown) {
    const latency = Date.now() - startTime;
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error(`[SOP AI] Generation failed after ${latency}ms: ${message}`);
    if (message.includes("aborted") || message.includes("abort")) {
      throw new Error("AI generation timed out. Please try again or create the SOP manually.");
    }
    throw new Error("AI generation failed. Please try again or create the SOP manually.");
  } finally {
    clearTimeout(timeout);
  }
}
