import { db } from "../db";
import { dailyQuestionnaires, sopDocuments, sopCategories, workLocations } from "@shared/schema";
import { eq, and } from "drizzle-orm";
import Anthropic from "@anthropic-ai/sdk";
import { config } from "../lib/config";
import logger from "../lib/logger";
import type { IStorage } from "../storage";

const anthropic = new Anthropic({ apiKey: config.anthropic.apiKey });
const DEFAULT_MODEL = "claude-sonnet-4-20250514";

interface DQQuestion {
  id: string;
  questionText: string;
  questionType: "multiple_choice" | "true_false" | "scenario";
  contextParagraph?: string;
  answerChoices: string[];
  correctAnswerIndex: number;
  coachingText: string;
}

const FALLBACK_QUESTIONS: DQQuestion[] = [
  {
    id: "fallback-1",
    questionText: "What is the most important factor in delivering great customer service?",
    questionType: "multiple_choice",
    answerChoices: [
      "Speed of service",
      "Listening to the customer's needs",
      "Offering discounts",
      "Following the script exactly",
    ],
    correctAnswerIndex: 1,
    coachingText:
      "Great customer service starts with truly listening. When customers feel heard, they trust us more and are more likely to return.",
  },
  {
    id: "fallback-2",
    questionText: "A customer is clearly frustrated. What should you do first?",
    questionType: "multiple_choice",
    answerChoices: [
      "Immediately offer a refund",
      "Acknowledge their frustration and apologize for the inconvenience",
      "Call your manager immediately",
      "Explain why the problem isn't your fault",
    ],
    correctAnswerIndex: 1,
    coachingText:
      "Empathy first! Acknowledging how someone feels de-escalates tension quickly. Once they feel understood, they're much more open to solutions.",
  },
  {
    id: "fallback-3",
    questionText: "True or False: It's acceptable to tell a customer 'That's not my department' and walk away.",
    questionType: "true_false",
    answerChoices: ["True", "False"],
    correctAnswerIndex: 1,
    coachingText:
      "Never! Own the customer's problem. Even if it's outside your role, guide them to the right person. Always say 'Let me help you find someone who can assist.'",
  },
  {
    id: "fallback-4",
    questionText: "A customer asks for a product you don't carry. What's the best response?",
    questionType: "scenario",
    contextParagraph:
      "A customer approaches you looking for a specific item that your store doesn't stock. They seem disappointed.",
    answerChoices: [
      "Say 'Sorry, we don't have that' and move on",
      "Suggest similar alternatives you do carry and offer to check availability elsewhere",
      "Tell them to try online shopping",
      "Pretend to check the back room and come back saying it's out of stock",
    ],
    correctAnswerIndex: 1,
    coachingText:
      "Turn a 'no' into a helpful moment! Offering alternatives shows you care about their needs, not just the sale. Customers remember that.",
  },
  {
    id: "fallback-5",
    questionText: "What should you do if you make a mistake in front of a customer?",
    questionType: "multiple_choice",
    answerChoices: [
      "Ignore it and hope they didn't notice",
      "Blame a coworker or system issue",
      "Acknowledge it honestly, apologize, and correct it quickly",
      "Offer them a free product to forget about it",
    ],
    correctAnswerIndex: 2,
    coachingText:
      "Honesty builds trust. A quick, genuine apology followed by swift correction often leaves customers with a better impression than if the mistake hadn't happened at all.",
  },
  {
    id: "fallback-6",
    questionText: "How should you greet a customer when they enter the store?",
    questionType: "multiple_choice",
    answerChoices: [
      "Wait for them to approach you",
      "Acknowledge them with a smile and friendly greeting within 30 seconds",
      "Continue what you're doing until you finish your task",
      "Only greet them if they look like they need help",
    ],
    correctAnswerIndex: 1,
    coachingText:
      "First impressions matter enormously. A warm, prompt greeting sets the tone for the entire visit and makes customers feel welcome and valued.",
  },
  {
    id: "fallback-7",
    questionText: "True or False: Knowing your products thoroughly is less important than being friendly.",
    questionType: "true_false",
    answerChoices: ["True", "False"],
    correctAnswerIndex: 1,
    coachingText:
      "Both matter equally! Friendliness creates the emotional connection, but product knowledge is what actually helps customers make great decisions. Aim for both.",
  },
];

function getTodayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

function getMsUntilNext6AM(): number {
  const now = new Date();
  const next6AM = new Date(now);
  next6AM.setHours(6, 0, 0, 0);
  if (next6AM <= now) {
    next6AM.setDate(next6AM.getDate() + 1);
  }
  return next6AM.getTime() - now.getTime();
}

async function generateQuestionsFromKB(knowledgeContent: string): Promise<DQQuestion[]> {
  const prompt = `You are a retail training expert. Based on the following store knowledge base content, generate 6 training questions for employees. Mix question types: multiple choice, true/false, and scenario-based.

Knowledge Base:
${knowledgeContent.slice(0, 8000)}

Generate exactly 6 questions in this JSON format:
{
  "topic": "A short topic name (e.g., 'Customer Service', 'Product Knowledge', 'Store Procedures')",
  "questions": [
    {
      "id": "q1",
      "questionText": "The question text",
      "questionType": "multiple_choice|true_false|scenario",
      "contextParagraph": "Optional: only for scenario type questions - 1-2 sentence situation description",
      "answerChoices": ["Choice A", "Choice B", "Choice C", "Choice D"],
      "correctAnswerIndex": 0,
      "coachingText": "Brief explanation of why this answer is correct and why it matters (2-3 sentences)"
    }
  ]
}

Rules:
- true_false questions must have exactly 2 choices: ["True", "False"]
- multiple_choice questions should have 3-4 choices
- scenario questions should have 3-4 choices and always include contextParagraph
- Make questions practical and directly tied to the knowledge base content
- Keep questions at a level appropriate for frontline retail employees
- correctAnswerIndex is 0-based (0 = first choice)
- Return ONLY valid JSON, no other text`;

  const message = await anthropic.messages.create({
    model: DEFAULT_MODEL,
    max_tokens: 2000,
    messages: [{ role: "user", content: prompt }],
  });

  const text = message.content[0].type === "text" ? message.content[0].text : "";
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error("No JSON found in AI response");

  const parsed = JSON.parse(jsonMatch[0]) as { questions: DQQuestion[] };
  return parsed.questions.map((q, i) => ({
    ...q,
    id: `ai-q${i + 1}-${Date.now()}`,
  }));
}

async function runDailyGenerationForStore(storeId: string, storage: IStorage): Promise<void> {
  const today = getTodayStr();

  const existing = await db
    .select({ id: dailyQuestionnaires.id })
    .from(dailyQuestionnaires)
    .where(and(eq(dailyQuestionnaires.storeId, storeId), eq(dailyQuestionnaires.quizDate, today)))
    .limit(1);

  if (existing.length > 0) {
    logger.info({ storeId, today }, "Daily questionnaire scheduler: questionnaire already exists, skipping");
    return;
  }

  const publishedDocs = await db
    .select({ id: sopDocuments.id, title: sopDocuments.title, content: sopDocuments.content })
    .from(sopDocuments)
    .innerJoin(sopCategories, eq(sopDocuments.categoryId, sopCategories.id))
    .where(
      and(
        eq(sopCategories.storeId, storeId),
        eq(sopDocuments.isPublished, true)
      )
    )
    .limit(8);

  let knowledgeContent = "";
  for (const doc of publishedDocs) {
    if (doc.content) knowledgeContent += `\n\n## ${doc.title}\n${doc.content}`;
  }

  let questions: DQQuestion[];
  let topic: string;

  if (knowledgeContent.trim().length > 200) {
    try {
      questions = await generateQuestionsFromKB(knowledgeContent);
      const topicRes = await anthropic.messages.create({
        model: DEFAULT_MODEL,
        max_tokens: 50,
        messages: [{ role: "user", content: `In 2-4 words, what is the main topic of these training questions? Answer with just the topic name.\n\n${knowledgeContent.slice(0, 2000)}` }],
      });
      topic = topicRes.content[0].type === "text" ? topicRes.content[0].text.trim() : "Customer Service";
    } catch (err: unknown) {
      logger.warn({ error: err instanceof Error ? err.message : String(err), storeId }, "Daily questionnaire scheduler: AI generation failed, using fallback");
      questions = FALLBACK_QUESTIONS;
      topic = "Customer Service Basics";
    }
  } else {
    questions = FALLBACK_QUESTIONS;
    topic = "Customer Service Basics";
  }

  try {
    await storage.createDailyQuestionnaire({
      storeId,
      quizDate: today,
      topic,
      questions,
      xpReward: 50,
    });
    logger.info({ storeId, today, topic }, "Daily questionnaire scheduler: auto-generated questionnaire");
  } catch (dbErr: unknown) {
    const code = (dbErr as any)?.code;
    if (code === "23505") {
      logger.info({ storeId, today }, "Daily questionnaire scheduler: unique constraint — questionnaire already created by another process");
    } else {
      logger.error({ error: dbErr instanceof Error ? dbErr.message : String(dbErr), storeId }, "Daily questionnaire scheduler: failed to create questionnaire");
    }
  }
}

export function startDailyQuestionnaireScheduler(storage: IStorage): () => void {
  let stopped = false;
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  let intervalId: ReturnType<typeof setInterval> | null = null;

  async function runAll() {
    if (stopped) return;
    logger.info("Daily questionnaire scheduler: running generation for all active stores");
    try {
      const stores = await db
        .select({ id: workLocations.id })
        .from(workLocations)
        .where(eq(workLocations.isActive, true));

      for (const store of stores) {
        try {
          await runDailyGenerationForStore(store.id, storage);
        } catch (err: unknown) {
          logger.error({ error: err instanceof Error ? err.message : String(err), storeId: store.id }, "Daily questionnaire scheduler: error for store");
        }
      }
    } catch (err: unknown) {
      logger.error({ error: err instanceof Error ? err.message : String(err) }, "Daily questionnaire scheduler: failed to fetch stores");
    }
  }

  const msUntilFirst = getMsUntilNext6AM();
  const hoursUntil = Math.round(msUntilFirst / 3600000 * 10) / 10;
  logger.info({ hoursUntilFirst: hoursUntil }, "Daily questionnaire scheduler: started, first run at 6 AM");

  timeoutId = setTimeout(() => {
    runAll();
    intervalId = setInterval(runAll, 24 * 60 * 60 * 1000);
  }, msUntilFirst);

  return () => {
    stopped = true;
    if (timeoutId) clearTimeout(timeoutId);
    if (intervalId) clearInterval(intervalId);
    logger.info("Daily questionnaire scheduler: stopped");
  };
}
