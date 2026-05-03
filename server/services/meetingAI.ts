import { anthropic, withAiContext } from "../lib/aiClients";
import { z } from "zod";
import { config } from "../lib/config";
import logger from "../lib/logger";

const MODEL = "claude-sonnet-4-20250514";

export interface MeetingSynopsis {
  keyDecisions: string[];
  discussionPoints: string[];
  openQuestions: string[];
  summary: string;
}

export interface TaskRecommendation {
  description: string;
  context: string;
  priority: "low" | "medium" | "high";
  suggestedAssigneeHint: string | null;
}

const synopsisSchema = z.object({
  keyDecisions: z.array(z.string()).max(10),
  discussionPoints: z.array(z.string()).max(10),
  openQuestions: z.array(z.string()).max(10),
  summary: z.string().min(1),
});

const recommendationSchema = z.object({
  description: z.string().min(1),
  context: z.string(),
  priority: z.enum(["low", "medium", "high"]),
  suggestedAssigneeHint: z.string().nullable(),
});

const recommendationsArraySchema = z.array(recommendationSchema).min(1).max(10);

export async function generateSynopsis(transcript: string): Promise<MeetingSynopsis> {
  const startTime = Date.now();

  const prompt = `You are a meeting intelligence AI. Analyze this meeting transcript and produce a structured synopsis.

TRANSCRIPT:
${transcript.slice(0, 20000)}

Return ONLY valid JSON (no markdown fences) in this exact shape:
{
  "keyDecisions": ["string", ...],
  "discussionPoints": ["string", ...],
  "openQuestions": ["string", ...],
  "summary": "2-3 sentence overall summary"
}

Rules:
- keyDecisions: concrete decisions or agreements reached (max 10)
- discussionPoints: main topics covered (max 10)
- openQuestions: unresolved issues or follow-ups needed (max 10)
- summary: brief executive summary of the meeting`;

  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 1024,
    messages: [{ role: "user", content: prompt }],
  });

  const content = response.content[0];
  if (content.type !== "text") {
    throw new Error("Expected text response from Claude for synopsis");
  }

  const text = content.text.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error("Could not extract JSON from synopsis response");

  const parsed = synopsisSchema.safeParse(JSON.parse(jsonMatch[0]));
  if (!parsed.success) {
    throw new Error(`Synopsis response failed schema validation: ${parsed.error.message}`);
  }

  const latency = Date.now() - startTime;
  logger.info({ latencyMs: latency }, "Meeting synopsis generated");

  return parsed.data;
}

export async function generateTaskRecommendations(
  synopsis: MeetingSynopsis,
  participants: Array<{ id: string; name: string; role?: string }>
): Promise<TaskRecommendation[]> {
  const startTime = Date.now();

  const participantList = participants.length > 0
    ? participants.map(p => `- ${p.name}${p.role ? ` (${p.role})` : ""}`).join("\n")
    : "No participant info available";

  const prompt = `You are a meeting intelligence AI. Based on a meeting synopsis, extract actionable task recommendations.

SYNOPSIS:
Summary: ${synopsis.summary}

Key Decisions:
${synopsis.keyDecisions.map(d => `- ${d}`).join("\n")}

Open Questions:
${synopsis.openQuestions.map(q => `- ${q}`).join("\n")}

Discussion Points:
${synopsis.discussionPoints.map(p => `- ${p}`).join("\n")}

MEETING PARTICIPANTS:
${participantList}

Return ONLY valid JSON (no markdown fences) — an array of task recommendations:
[
  {
    "description": "Clear, actionable task description",
    "context": "Why this task matters / what meeting discussion led to it",
    "priority": "low" | "medium" | "high",
    "suggestedAssigneeHint": "Name of participant who should own this, or null if unclear"
  }
]

Rules:
- Extract 3-8 concrete, actionable tasks from the meeting
- Only include tasks with real follow-up actions (not vague items)
- Match suggestedAssigneeHint to participant names when obvious
- Set priority based on urgency and decision-making context
- Keep descriptions concise and action-oriented (start with a verb)`;

  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 1024,
    messages: [{ role: "user", content: prompt }],
  });

  const content = response.content[0];
  if (content.type !== "text") {
    throw new Error("Expected text response from Claude for recommendations");
  }

  const text = content.text.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
  const jsonMatch = text.match(/\[[\s\S]*\]/);
  if (!jsonMatch) throw new Error("Could not extract JSON from recommendations response");

  const parsed = recommendationsArraySchema.safeParse(JSON.parse(jsonMatch[0]));
  if (!parsed.success) {
    throw new Error(`Recommendations response failed schema validation: ${parsed.error.message}`);
  }

  const latency = Date.now() - startTime;
  logger.info({ latencyMs: latency, count: parsed.data.length }, "Task recommendations generated");

  return parsed.data;
}
