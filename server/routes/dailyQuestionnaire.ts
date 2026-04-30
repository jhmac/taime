import type { Express } from "express";
import { db } from "../db";
import { eq, and, desc, gte, sql, count } from "drizzle-orm";
import {
  dailyQuestionnaires,
  questionnaireResponses,
  users,
  workLocations,
  sopDocuments,
  sopCategories,
} from "@shared/schema";
import { asyncHandler, AppError } from "../lib/routeWrapper";
import { resolveStoreIdForUser } from "../services/storeResolver";
import type { IStorage } from "../storage";
import Anthropic from "@anthropic-ai/sdk";
import { config } from "../lib/config";
import logger from "../lib/logger";
import { z } from "zod";

interface DQQuestion {
  id: string;
  questionText: string;
  questionType: "multiple_choice" | "true_false" | "scenario";
  contextParagraph?: string;
  answerChoices: string[];
  correctAnswerIndex: number;
  coachingText: string;
}

interface SubmitAnswerPayload {
  questionIndex: number;
  selectedIndex: number;
}

const submitBodySchema = z.object({
  questionnaireId: z.string().min(1),
  answers: z.array(
    z.object({
      questionIndex: z.number().int().nonnegative(),
      selectedIndex: z.number().int().nonnegative(),
    })
  ).min(1),
  durationSeconds: z.number().int().positive().optional().nullable(),
});

const anthropic = new Anthropic({ apiKey: config.anthropic.apiKey });
const DEFAULT_MODEL = "claude-sonnet-4-20250514";

function getLocalDateStr(timezone?: string | null): string {
  const tz = timezone || "UTC";
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

async function fetchStoreTimezone(storeId: string): Promise<string | null> {
  const [loc] = await db
    .select({ timezone: workLocations.timezone })
    .from(workLocations)
    .where(eq(workLocations.id, storeId))
    .limit(1);
  return loc?.timezone ?? null;
}

function getWeekStart(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - d.getDay());
  return d;
}

async function requireManagerAccess(req: any, storage: IStorage) {
  const userId = req.user?.id as string | undefined;
  if (!userId) throw new AppError(401, "Unauthorized", "UNAUTHORIZED");
  const perms = await storage.getUserPermissions(userId);
  const hasAccess = perms.some(
    (p) => p.name === "admin.manage_all" || p.name === "admin.role_management" || p.name === "hr.edit_team"
  );
  if (!hasAccess) throw new AppError(403, "Manager or Owner access required", "FORBIDDEN");
}

const FALLBACK_QUESTIONS = [
  {
    id: "fallback-1",
    questionText: "What is the most important factor in delivering great customer service?",
    questionType: "multiple_choice" as const,
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
    questionType: "multiple_choice" as const,
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
    questionType: "true_false" as const,
    answerChoices: ["True", "False"],
    correctAnswerIndex: 1,
    coachingText:
      "Never! Own the customer's problem. Even if it's outside your role, guide them to the right person. Always say 'Let me help you find someone who can assist.'",
  },
  {
    id: "fallback-4",
    questionText: "A customer asks for a product you don't carry. What's the best response?",
    questionType: "scenario" as const,
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
    questionType: "multiple_choice" as const,
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
    questionType: "multiple_choice" as const,
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
    questionType: "true_false" as const,
    answerChoices: ["True", "False"],
    correctAnswerIndex: 1,
    coachingText:
      "Both matter equally! Friendliness creates the emotional connection, but product knowledge is what actually helps customers make great decisions. Aim for both.",
  },
];

async function generateQuestionsFromKB(_storeId: string, knowledgeContent: string): Promise<DQQuestion[]> {
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

async function checkAndAwardBadges(
  userId: string,
  storeId: string,
  score: number,
  topic: string,
  durationSeconds: number | null,
  storage: IStorage
): Promise<string[]> {
  const newBadges: string[] = [];

  const existingBadges = await storage.getUserBadges(userId);

  const hasBadge = (type: string, t?: string) =>
    existingBadges.some((b) => b.badgeType === type && (!t || b.topic === t));

  const awardBadge = async (type: string, badgeTopic?: string) => {
    if (!hasBadge(type, badgeTopic)) {
      await storage.createUserBadge({ userId, storeId, badgeType: type, topic: badgeTopic ?? null });
      newBadges.push(type);
    }
  };

  if (score === 100) {
    await awardBadge("first_perfect_score");
    if (durationSeconds && durationSeconds < 120) {
      await awardBadge("speed_demon");
    }
    await awardBadge("subject_matter_expert", topic);
  }

  const responses = await db
    .select({ completedAt: questionnaireResponses.completedAt })
    .from(questionnaireResponses)
    .where(eq(questionnaireResponses.userId, userId))
    .orderBy(desc(questionnaireResponses.completedAt))
    .limit(30);

  if (responses.length >= 7) {
    const dates = responses.map((r) => new Date(r.completedAt!).toISOString().slice(0, 10));
    const uniqueDates = Array.from(new Set(dates)).sort().reverse();
    let streak = 1;
    for (let i = 1; i < uniqueDates.length && i < 7; i++) {
      const prev = new Date(uniqueDates[i - 1]);
      const curr = new Date(uniqueDates[i]);
      const diff = (prev.getTime() - curr.getTime()) / 86400000;
      if (diff <= 1.5) streak++;
      else break;
    }
    if (streak >= 7) await awardBadge("seven_day_streak");
  }

  const weekStart = getWeekStart();
  const weekLeaders = await db
    .select({
      userId: questionnaireResponses.userId,
      totalXp: sql<number>`SUM(${questionnaireResponses.xpEarned})`,
    })
    .from(questionnaireResponses)
    .leftJoin(dailyQuestionnaires, eq(dailyQuestionnaires.id, questionnaireResponses.questionnaireId))
    .where(
      and(
        eq(dailyQuestionnaires.storeId, storeId),
        gte(questionnaireResponses.completedAt, weekStart)
      )
    )
    .groupBy(questionnaireResponses.userId)
    .orderBy(desc(sql`SUM(${questionnaireResponses.xpEarned})`))
    .limit(1);

  if (weekLeaders.length > 0 && weekLeaders[0].userId === userId) {
    await awardBadge("top_of_week");
  }

  return newBadges;
}

const BADGE_META: Record<string, { label: string; emoji: string; description: string }> = {
  first_perfect_score: { label: "Perfect Score", emoji: "🏆", description: "Scored 100% on a Daily Training!" },
  seven_day_streak: { label: "7-Day Streak", emoji: "🔥", description: "Completed training 7 days in a row!" },
  top_of_week: { label: "Top of the Week", emoji: "👑", description: "Highest XP earner this week!" },
  subject_matter_expert: { label: "Subject Matter Expert", emoji: "⭐", description: "Perfect score on a specific topic!" },
  speed_demon: { label: "Speed Demon", emoji: "⚡", description: "Perfect score in under 2 minutes!" },
};

async function computeStreak(userId: string): Promise<number> {
  const responses = await db
    .select({ completedAt: questionnaireResponses.completedAt })
    .from(questionnaireResponses)
    .where(eq(questionnaireResponses.userId, userId))
    .orderBy(desc(questionnaireResponses.completedAt))
    .limit(60);

  if (responses.length === 0) return 0;

  const dates = Array.from(new Set(
    responses.map((r) => new Date(r.completedAt!).toISOString().slice(0, 10))
  )).sort().reverse();

  const today = getLocalDateStr();
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);

  // Streak must start from today or yesterday
  if (dates[0] !== today && dates[0] !== yesterday) return 0;

  let streak = 1;
  for (let i = 1; i < dates.length; i++) {
    const prev = new Date(dates[i - 1]);
    const curr = new Date(dates[i]);
    const diff = Math.round((prev.getTime() - curr.getTime()) / 86400000);
    if (diff === 1) {
      streak++;
    } else {
      break;
    }
  }
  return streak;
}

export function registerDailyQuestionnaireRoutes(
  app: Express,
  storage: IStorage,
  isAuthenticated: (req: any, res: any, next: any) => void
) {
  // ── GET /api/daily-questionnaire/today ─────────────────────────────────────
  app.get("/api/daily-questionnaire/today", isAuthenticated, asyncHandler(async (req: any, res) => {
    const userId = req.user.id as string;

    const storeId = await resolveStoreIdForUser(userId).catch(() => null);
    if (!storeId) {
      return res.json({ success: true, data: { questionnaire: null, completed: false, noQuestionnaire: true } });
    }

    const storeTimezone = await fetchStoreTimezone(storeId);
    const today = getLocalDateStr(storeTimezone);
    const questionnaire = await storage.getDailyQuestionnaire(storeId, today);
    if (!questionnaire) {
      return res.json({ success: true, data: { questionnaire: null, completed: false, noQuestionnaire: true } });
    }

    const [userResponse, completionCountRow, userBadgesList, storeNameRow, userStreak] = await Promise.all([
      storage.getQuestionnaireResponse(userId, questionnaire.id),
      db.select({ count: count() }).from(questionnaireResponses).where(eq(questionnaireResponses.questionnaireId, questionnaire.id)).then(r => r[0]),
      storage.getUserBadges(userId),
      db.select({ name: workLocations.name }).from(workLocations).where(eq(workLocations.id, storeId)).limit(1).then(r => r[0]),
      computeStreak(userId),
    ]);

    const [teamCountRow] = await db
      .select({ count: count() })
      .from(users)
      .where(and(eq(users.locationName, storeNameRow?.name ?? ""), eq(users.isActive, true)));

    const rawQuestions = questionnaire.questions as DQQuestion[];
    // Always strip correct answers — client uses /check-answer endpoint for per-question feedback
    const sanitizedQuestions = rawQuestions.map(({ correctAnswerIndex: _c, ...safe }) => safe);

    return res.json({
      success: true,
      data: {
        questionnaire: {
          id: questionnaire.id,
          topic: questionnaire.topic,
          quizDate: questionnaire.quizDate,
          xpReward: questionnaire.xpReward,
          questionCount: rawQuestions.length,
          questions: sanitizedQuestions,
        },
        completed: !!userResponse,
        userResponse: userResponse ?? null,
        teamCompletionCount: completionCountRow?.count ?? 0,
        teamTotalCount: teamCountRow?.count ?? 0,
        userBadges: userBadgesList,
        userStreak,
      },
    });
  }));

  // ── POST /api/daily-questionnaire/check-answer ─────────────────────────────
  // Returns correctness + coaching for one question without exposing the full answer key.
  app.post("/api/daily-questionnaire/check-answer", isAuthenticated, asyncHandler(async (req: any, res) => {
    const userId = req.user.id as string;

    const parsed = z.object({
      questionnaireId: z.string().min(1),
      questionIndex: z.number().int().nonnegative(),
      selectedIndex: z.number().int().nonnegative(),
    }).safeParse(req.body);

    if (!parsed.success) {
      throw new AppError(400, parsed.error.issues[0]?.message ?? "Invalid request", "VALIDATION_ERROR");
    }
    const { questionnaireId, questionIndex, selectedIndex } = parsed.data;

    const userStoreId = await resolveStoreIdForUser(userId).catch(() => null);
    if (!userStoreId) throw new AppError(403, "No store associated with your account", "NO_STORE");

    const questionnaire = await storage.getDailyQuestionnaireById(questionnaireId);
    if (!questionnaire) throw new AppError(404, "Questionnaire not found", "NOT_FOUND");
    if (questionnaire.storeId !== userStoreId) {
      throw new AppError(403, "You are not authorized to access this questionnaire", "FORBIDDEN");
    }
    const checkAnswerTimezone = await fetchStoreTimezone(userStoreId);
    if (questionnaire.quizDate !== getLocalDateStr(checkAnswerTimezone)) {
      throw new AppError(400, "This questionnaire is not for today", "STALE_QUESTIONNAIRE");
    }

    const questions = questionnaire.questions as DQQuestion[];
    const question = questions[questionIndex];
    if (!question) throw new AppError(400, `Invalid question index: ${questionIndex}`, "INVALID_INDEX");
    if (selectedIndex < 0 || selectedIndex >= question.answerChoices.length) {
      throw new AppError(400, `Invalid selected index: ${selectedIndex}`, "INVALID_INDEX");
    }

    const isCorrect = selectedIndex === question.correctAnswerIndex;

    return res.json({
      success: true,
      data: {
        isCorrect,
        correctAnswerIndex: question.correctAnswerIndex,
        coachingText: question.coachingText,
      },
    });
  }));

  // ── POST /api/daily-questionnaire/generate ─────────────────────────────────
  app.post("/api/daily-questionnaire/generate", isAuthenticated, asyncHandler(async (req: any, res) => {
    await requireManagerAccess(req, storage);
    const userId = req.user.id as string;

    const storeId = await resolveStoreIdForUser(userId).catch(() => null);
    if (!storeId) throw new AppError(400, "No store associated with your account", "NO_STORE");

    const generateTimezone = await fetchStoreTimezone(storeId);
    const today = getLocalDateStr(generateTimezone);

    const existing = await db
      .select({ id: dailyQuestionnaires.id })
      .from(dailyQuestionnaires)
      .where(and(eq(dailyQuestionnaires.storeId, storeId), eq(dailyQuestionnaires.quizDate, today)))
      .limit(1);

    if (existing.length > 0 && !req.body.force) {
      return res.json({ success: true, data: { message: "Questionnaire already exists for today", alreadyExists: true } });
    }

    const [kbDocs, scopedSopDocs] = await Promise.all([
      storage.getKnowledgeDocuments(storeId),
      db
        .select({ id: sopDocuments.id, title: sopDocuments.title, content: sopDocuments.content })
        .from(sopDocuments)
        .innerJoin(sopCategories, eq(sopDocuments.categoryId, sopCategories.id))
        .where(eq(sopCategories.storeId, storeId))
        .limit(3),
    ]);

    let knowledgeContent = "";
    for (const doc of kbDocs.slice(0, 5)) {
      if (doc.content) knowledgeContent += `\n\n## ${doc.title}\n${doc.content}`;
    }
    for (const doc of scopedSopDocs) {
      if (doc.content) knowledgeContent += `\n\n## ${doc.title}\n${doc.content}`;
    }

    let questions: DQQuestion[];
    let topic: string;

    if (knowledgeContent.trim().length > 200) {
      try {
        const generatedQuestions = await generateQuestionsFromKB(storeId, knowledgeContent);
        questions = generatedQuestions;
        const topicPromptRes = await anthropic.messages.create({
          model: DEFAULT_MODEL,
          max_tokens: 50,
          messages: [{ role: "user", content: `In 2-4 words, what is the main topic of these training questions? Answer with just the topic name.\n\n${knowledgeContent.slice(0, 2000)}` }],
        });
        topic = topicPromptRes.content[0].type === "text" ? topicPromptRes.content[0].text.trim() : "Customer Service";
      } catch (err: any) {
        logger.warn({ error: err.message }, "AI generation failed, using fallback questions");
        questions = FALLBACK_QUESTIONS;
        topic = "Customer Service Basics";
      }
    } else {
      questions = FALLBACK_QUESTIONS;
      topic = "Customer Service Basics";
    }

    if (existing.length > 0 && req.body.force) {
      // Block force-regeneration if any associates have already completed it
      const existingResponseCount = await db
        .select({ count: count() })
        .from(questionnaireResponses)
        .where(eq(questionnaireResponses.questionnaireId, existing[0].id))
        .then(r => r[0]?.count ?? 0);

      if (existingResponseCount > 0) {
        throw new AppError(
          409,
          `Cannot regenerate: ${existingResponseCount} team member(s) have already submitted responses for today's questionnaire.`,
          "RESPONSES_EXIST"
        );
      }

      const updated = await storage.updateDailyQuestionnaire(existing[0].id, { questions, topic, generatedBy: userId });
      return res.json({ success: true, data: updated });
    }

    const questionnaire = await storage.createDailyQuestionnaire({
      storeId,
      quizDate: today,
      topic,
      questions,
      xpReward: 50,
      generatedBy: userId,
    });

    return res.json({ success: true, data: questionnaire });
  }));

  // ── POST /api/daily-questionnaire/submit ──────────────────────────────────
  app.post("/api/daily-questionnaire/submit", isAuthenticated, asyncHandler(async (req: any, res) => {
    const userId = req.user.id as string;

    const parsed = submitBodySchema.safeParse(req.body);
    if (!parsed.success) {
      throw new AppError(400, parsed.error.issues[0]?.message ?? "Invalid request body", "VALIDATION_ERROR");
    }
    const { questionnaireId, answers, durationSeconds } = parsed.data;

    // Resolve user's store for ownership check
    const userStoreId = await resolveStoreIdForUser(userId).catch(() => null);
    if (!userStoreId) throw new AppError(403, "No store associated with your account", "NO_STORE");

    const questionnaire = await storage.getDailyQuestionnaireById(questionnaireId);
    if (!questionnaire) throw new AppError(404, "Questionnaire not found", "NOT_FOUND");

    // Authorization: questionnaire must belong to the user's store
    if (questionnaire.storeId !== userStoreId) {
      throw new AppError(403, "You are not authorized to submit this questionnaire", "FORBIDDEN");
    }

    // Enforce daily constraint: only today's questionnaire may be submitted
    const submitTimezone = await fetchStoreTimezone(userStoreId);
    if (questionnaire.quizDate !== getLocalDateStr(submitTimezone)) {
      throw new AppError(400, "This questionnaire is no longer active (not today's)", "STALE_QUESTIONNAIRE");
    }

    const existing = await storage.getQuestionnaireResponse(userId, questionnaireId);
    if (existing) {
      return res.json({ success: true, data: { alreadyCompleted: true, response: existing } });
    }

    const questions = questionnaire.questions as DQQuestion[];

    // Deduplicate answers: keep first occurrence of each questionIndex
    const seenIndexes = new Set<number>();
    const deduplicatedAnswers: SubmitAnswerPayload[] = [];
    for (const a of answers) {
      if (!seenIndexes.has(a.questionIndex)) {
        seenIndexes.add(a.questionIndex);
        deduplicatedAnswers.push(a);
      }
    }

    // Validate all answer indices are within bounds
    for (const a of deduplicatedAnswers) {
      const q = questions[a.questionIndex];
      if (!q) {
        throw new AppError(400, `Answer references invalid question index: ${a.questionIndex}`, "INVALID_ANSWER_INDEX");
      }
      if (a.selectedIndex < 0 || a.selectedIndex >= q.answerChoices.length) {
        throw new AppError(400, `Answer selectedIndex ${a.selectedIndex} is out of bounds for question ${a.questionIndex}`, "INVALID_SELECTED_INDEX");
      }
    }

    // Enforce full completion: every question must have exactly one answer
    const answeredIndexes = new Set(deduplicatedAnswers.map((a) => a.questionIndex));
    for (let i = 0; i < questions.length; i++) {
      if (!answeredIndexes.has(i)) {
        throw new AppError(400, `Missing answer for question ${i + 1} of ${questions.length}`, "INCOMPLETE_SUBMISSION");
      }
    }

    let correctCount = 0;
    const enrichedAnswers = deduplicatedAnswers.map((a) => {
      const q = questions[a.questionIndex];
      const isCorrect = a.selectedIndex === q.correctAnswerIndex;
      if (isCorrect) correctCount++;
      return { ...a, isCorrect };
    });

    // Clamp score to [0, 100] regardless of correctCount
    const score = Math.max(0, Math.min(100, Math.round((correctCount / questions.length) * 100)));
    const maxXp = questionnaire.xpReward ?? 50;
    const xpEarned = Math.max(0, Math.min(maxXp, Math.round(maxXp * (score / 100))));

    const response = await storage.createQuestionnaireResponse({
      userId,
      questionnaireId,
      answers: enrichedAnswers,
      score,
      xpEarned,
      durationSeconds: durationSeconds ?? null,
    });

    const newBadges = await checkAndAwardBadges(
      userId,
      questionnaire.storeId,
      score,
      questionnaire.topic,
      durationSeconds ?? null,
      storage
    );

    const badgeMeta = newBadges.map((b) => ({ type: b, ...BADGE_META[b] }));

    // Strip correct answers before returning questions to client
    const questionsWithAnswers = questions.map(({ correctAnswerIndex: _ca, ...safe }) => safe);

    return res.json({
      success: true,
      data: {
        response,
        score,
        xpEarned,
        correctAnswers: correctCount,
        totalQuestions: questions.length,
        newBadges: badgeMeta,
        questionsWithAnswers,
      },
    });
  }));

  // ── GET /api/daily-questionnaire/leaderboard ───────────────────────────────
  app.get("/api/daily-questionnaire/leaderboard", isAuthenticated, asyncHandler(async (req: any, res) => {
    const userId = req.user.id as string;
    const storeId = await resolveStoreIdForUser(userId).catch(() => null);
    if (!storeId) return res.json({ success: true, data: { leaders: [], weekStart: getWeekStart().toISOString() } });

    const weekStart = getWeekStart();

    const leaders = await db
      .select({
        userId: questionnaireResponses.userId,
        firstName: users.firstName,
        lastName: users.lastName,
        profileImageUrl: users.profileImageUrl,
        weeklyXp: sql<number>`SUM(${questionnaireResponses.xpEarned})`,
        completionCount: sql<number>`COUNT(${questionnaireResponses.id})`,
        avgScore: sql<number>`ROUND(AVG(${questionnaireResponses.score}), 0)`,
      })
      .from(questionnaireResponses)
      .leftJoin(users, eq(users.id, questionnaireResponses.userId))
      .leftJoin(dailyQuestionnaires, eq(dailyQuestionnaires.id, questionnaireResponses.questionnaireId))
      .where(
        and(
          eq(dailyQuestionnaires.storeId, storeId),
          gte(questionnaireResponses.completedAt, weekStart)
        )
      )
      .groupBy(
        questionnaireResponses.userId,
        users.firstName,
        users.lastName,
        users.profileImageUrl
      )
      .orderBy(desc(sql`SUM(${questionnaireResponses.xpEarned})`))
      .limit(20);

    const allBadges = await storage.getStoreBadges(storeId);
    type BadgeEntry = typeof allBadges[number] & { label?: string; emoji?: string; description?: string };
    const badgesMap: Record<string, BadgeEntry[]> = {};
    for (const b of allBadges) {
      if (!badgesMap[b.userId]) badgesMap[b.userId] = [];
      badgesMap[b.userId].push({ ...b, ...(BADGE_META[b.badgeType] ?? {}) });
    }

    const leaderStreaks = await Promise.all(leaders.map((l) => computeStreak(l.userId)));
    const enrichedLeaders = leaders.map((l, i) => ({
      ...l,
      rank: i + 1,
      badges: badgesMap[l.userId] ?? [],
      isMe: l.userId === userId,
      streak: leaderStreaks[i] ?? 0,
    }));

    const totalXpAll = await db
      .select({
        userId: questionnaireResponses.userId,
        totalXp: sql<number>`SUM(${questionnaireResponses.xpEarned})`,
      })
      .from(questionnaireResponses)
      .leftJoin(dailyQuestionnaires, eq(dailyQuestionnaires.id, questionnaireResponses.questionnaireId))
      .where(eq(dailyQuestionnaires.storeId, storeId))
      .groupBy(questionnaireResponses.userId)
      .orderBy(desc(sql`SUM(${questionnaireResponses.xpEarned})`))
      .limit(20);

    const seasonLeaders = await Promise.all(
      totalXpAll.map(async (l, i) => {
        const [u] = await db.select({ firstName: users.firstName, lastName: users.lastName, profileImageUrl: users.profileImageUrl }).from(users).where(eq(users.id, l.userId)).limit(1);
        return { ...l, rank: i + 1, ...(u ?? {}), isMe: l.userId === userId, badges: badgesMap[l.userId] ?? [] };
      })
    );

    return res.json({
      success: true,
      data: {
        weeklyLeaders: enrichedLeaders,
        seasonLeaders,
        weekStart: weekStart.toISOString(),
        currentUserId: userId,
      },
    });
  }));

  // ── GET /api/daily-questionnaire/summary ───────────────────────────────────
  app.get("/api/daily-questionnaire/summary", isAuthenticated, asyncHandler(async (req: any, res) => {
    await requireManagerAccess(req, storage);
    const userId = req.user.id as string;
    const storeId = await resolveStoreIdForUser(userId).catch(() => null);
    if (!storeId) return res.json({ success: true, data: { questionnaire: null } });
    const summaryTimezone = await fetchStoreTimezone(storeId);
    const today = getLocalDateStr(summaryTimezone);

    const [questionnaire] = await db
      .select()
      .from(dailyQuestionnaires)
      .where(and(eq(dailyQuestionnaires.storeId, storeId), eq(dailyQuestionnaires.quizDate, today)))
      .limit(1);

    if (!questionnaire) return res.json({ success: true, data: { questionnaire: null } });

    const responses = await db
      .select({
        userId: questionnaireResponses.userId,
        score: questionnaireResponses.score,
        xpEarned: questionnaireResponses.xpEarned,
        completedAt: questionnaireResponses.completedAt,
      })
      .from(questionnaireResponses)
      .where(eq(questionnaireResponses.questionnaireId, questionnaire.id));

    const [store] = await db.select({ name: workLocations.name }).from(workLocations).where(eq(workLocations.id, storeId)).limit(1);
    const teamUsers = await db
      .select({ id: users.id, firstName: users.firstName, lastName: users.lastName })
      .from(users)
      .where(and(eq(users.locationName, store?.name ?? ""), eq(users.isActive, true)));

    const completedUserIds = new Set(responses.map((r) => r.userId));
    const completedUsers = teamUsers.filter((u) => completedUserIds.has(u.id));
    const notCompletedUsers = teamUsers.filter((u) => !completedUserIds.has(u.id));

    const avgScore = responses.length > 0 ? Math.round(responses.reduce((sum, r) => sum + r.score, 0) / responses.length) : 0;

    return res.json({
      success: true,
      data: {
        questionnaire: {
          id: questionnaire.id,
          topic: questionnaire.topic,
          xpReward: questionnaire.xpReward,
          questionCount: (questionnaire.questions as DQQuestion[]).length,
        },
        completionCount: responses.length,
        totalTeamCount: teamUsers.length,
        completionRate: teamUsers.length > 0 ? Math.round((responses.length / teamUsers.length) * 100) : 0,
        avgScore,
        completedUsers,
        notCompletedUsers,
      },
    });
  }));
}
