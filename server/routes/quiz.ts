import type { Express } from "express";
import { db } from "../db";
import { eq, and, desc, asc, sql, inArray } from "drizzle-orm";
import {
  quizQuestions,
  quizSessions,
  quizAnswers,
  userQuizProgress,
  users,
  type Permission,
} from "@shared/schema";
import { asyncHandler, AppError } from "../lib/routeWrapper";
import { resolveStoreIdForUser } from "../lib/storeResolver";
import type { IStorage } from "../storage";

const QUESTIONS_PER_SESSION = 5;
const BOSS_BATTLE_QUESTIONS = 10;

function getCurrentSeason(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

function getTodayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Strip sensitive answer data before sending quiz questions to learners */
function sanitizeQuestionForLearner(q: Record<string, unknown>) {
  const { correctAnswerIndex: _cai, ...safe } = q as { correctAnswerIndex: unknown; [key: string]: unknown };
  return safe;
}

function computeStreakMultiplier(streak: number): number {
  if (streak >= 30) return 3;
  if (streak >= 7) return 2;
  return 1;
}

async function requireManagerAccess(req: any, storage: IStorage) {
  const userId = req.user?.id as string | undefined;
  if (!userId) throw new AppError(401, "Unauthorized", "UNAUTHORIZED");
  const perms: Permission[] = await storage.getUserPermissions(userId);
  const hasAccess = perms.some(
    (p) =>
      p.name === "admin.manage_all" ||
      p.name === "admin.role_management" ||
      p.name === "hr.edit_team"
  );
  if (!hasAccess) throw new AppError(403, "Manager or Owner access required", "FORBIDDEN");
}

async function resolveStoreRequired(userId: string): Promise<string> {
  const storeId = await resolveStoreIdForUser(userId).catch(() => null);
  if (!storeId) throw new AppError(400, "No store associated with this account", "NO_STORE");
  return storeId;
}

export function registerQuizRoutes(
  app: Express,
  storage: IStorage,
  isAuthenticated: (req: any, res: any, next: any) => void
) {

  // ── GET /api/quiz/daily ─────────────────────────────────────────────────────
  // Returns today's quiz session (create if not yet started), or marks completed.
  // Boss Battle fires AFTER a full topic rotation completes (pendingBossBattle flag).
  app.get("/api/quiz/daily", isAuthenticated, asyncHandler(async (req: any, res) => {
    const userId = req.user.id as string;
    const today = getTodayStr();

    // Users without a store assignment cannot take store quizzes
    const storeId = await resolveStoreIdForUser(userId).catch(() => null);
    if (!storeId) {
      return res.json({ success: true, data: { session: null, noQuestions: true, completed: false } });
    }

    // Load progress first — needed to determine session type (daily vs boss_battle)
    let [progress] = await db
      .select()
      .from(userQuizProgress)
      .where(eq(userQuizProgress.userId, userId))
      .limit(1);

    // Get all distinct topics in question bank for this store
    const topicRows = await db
      .selectDistinct({ topic: quizQuestions.topicTag })
      .from(quizQuestions)
      .where(and(eq(quizQuestions.storeId, storeId), eq(quizQuestions.isActive, true)));
    const allTopics = topicRows.map((r) => r.topic);

    if (allTopics.length === 0) {
      return res.json({ success: true, data: { session: null, noQuestions: true, completed: false } });
    }

    // Boss Battle triggers after a full topic rotation is complete
    const isBossBattle = !!(progress?.pendingBossBattle) && allTopics.length > 1;

    // Pick next topic using round-robin (only for daily sessions)
    let coveredTopics: string[] = (progress?.coveredTopicsThisRotation as string[]) || [];
    let pendingTopics = allTopics.filter((t) => !coveredTopics.includes(t));
    if (pendingTopics.length === 0) pendingTopics = allTopics;
    const topicTag = isBossBattle ? "boss_battle" : pendingTopics[0];

    const sessionType = isBossBattle ? "boss_battle" : "daily";
    const limit = isBossBattle ? BOSS_BATTLE_QUESTIONS : QUESTIONS_PER_SESSION;

    // Find today's session of the correct type (daily or boss_battle)
    const [existing] = await db
      .select()
      .from(quizSessions)
      .where(
        and(
          eq(quizSessions.userId, userId),
          eq(quizSessions.sessionDate, today),
          eq(quizSessions.sessionType, sessionType)
        )
      )
      .limit(1);

    if (existing?.status === "completed") {
      return res.json({ success: true, data: { session: existing, completed: true } });
    }

    // If session exists in progress (resumable)
    if (existing?.status === "in_progress") {
      const sessionQuestionIds = (existing.questionIds as string[]) || [];

      if (sessionQuestionIds.length === 0) {
        return res.json({ success: true, data: { session: null, noQuestions: true, completed: false } });
      }

      // Return full ordered question list so frontend qIndex = answeredCount works correctly
      const questionRows = await db
        .select()
        .from(quizQuestions)
        .where(inArray(quizQuestions.id, sessionQuestionIds));

      // Re-order to match original session order
      const questionMap = new Map(questionRows.map((q) => [q.id, q]));
      const orderedQuestions = sessionQuestionIds.map((id) => questionMap.get(id)).filter(Boolean) as typeof questionRows;

      const answeredRows = await db
        .select()
        .from(quizAnswers)
        .where(eq(quizAnswers.sessionId, existing.id));

      return res.json({
        success: true,
        data: {
          session: existing,
          topic: existing.topicTag,
          questions: orderedQuestions.map(sanitizeQuestionForLearner),
          answeredCount: answeredRows.length,
          totalCount: sessionQuestionIds.length,
          completed: false,
          isBossBattle: existing.sessionType === "boss_battle",
          streakMultiplier: computeStreakMultiplier(progress?.currentStreakDays || 0),
        },
      });
    }

    // Pick questions for the session (storeId is guaranteed non-null here)
    // Boss Battle: select from ALL topics for a mastery challenge
    // Daily: select from the specific topicTag for focused learning
    const questions = await db
      .select()
      .from(quizQuestions)
      .where(
        and(
          eq(quizQuestions.storeId, storeId),
          isBossBattle ? undefined : eq(quizQuestions.topicTag, topicTag),
          eq(quizQuestions.isActive, true)
        )
      )
      .orderBy(sql`RANDOM()`)
      .limit(limit);

    if (questions.length === 0) {
      return res.json({ success: true, data: { session: null, noQuestions: true, completed: false } });
    }

    const streak = progress?.currentStreakDays || 0;
    const multiplier = computeStreakMultiplier(streak);

    // Create session
    const [session] = await db
      .insert(quizSessions)
      .values({
        userId,
        storeId,
        sessionDate: today,
        topicTag,
        sessionType,
        questionIds: questions.map((q) => q.id),
        status: "in_progress",
        totalQuestions: questions.length,
        streakMultiplier: multiplier,
        basePoints: questions.length * 10,
      })
      .returning();

    return res.json({
      success: true,
      data: {
        session,
        topic: topicTag,
        questions: questions.map(sanitizeQuestionForLearner),
        answeredCount: 0,
        totalCount: questions.length,
        completed: false,
        isBossBattle: sessionType === "boss_battle",
        streakMultiplier: multiplier,
      },
    });
  }));

  // ── POST /api/quiz/answer ───────────────────────────────────────────────────
  app.post("/api/quiz/answer", isAuthenticated, asyncHandler(async (req: any, res) => {
    const userId = req.user.id;
    const { sessionId, questionId, selectedIndex } = req.body;

    if (!sessionId || questionId == null || selectedIndex == null) {
      throw new AppError(400, "sessionId, questionId and selectedIndex required", "MISSING_FIELDS");
    }

    const [session] = await db
      .select()
      .from(quizSessions)
      .where(and(eq(quizSessions.id, sessionId), eq(quizSessions.userId, userId)))
      .limit(1);

    if (!session) throw new AppError(404, "Session not found", "NOT_FOUND");
    if (session.status === "completed") {
      return res.json({ success: true, data: { alreadyCompleted: true } });
    }

    // Validate questionId belongs to this session (prevent cross-question manipulation)
    const sessionQuestionIds = (session.questionIds as string[]) || [];
    if (!sessionQuestionIds.includes(questionId)) {
      throw new AppError(400, "Question does not belong to this session", "INVALID_QUESTION");
    }

    const [question] = await db
      .select()
      .from(quizQuestions)
      .where(eq(quizQuestions.id, questionId))
      .limit(1);

    if (!question) throw new AppError(404, "Question not found", "NOT_FOUND");

    // Check if this question was already answered (prevent analytics inflation)
    const [existingAnswer] = await db
      .select()
      .from(quizAnswers)
      .where(and(eq(quizAnswers.sessionId, sessionId), eq(quizAnswers.questionId, questionId)))
      .limit(1);

    const isCorrect = selectedIndex === question.correctAnswerIndex;

    if (existingAnswer) {
      // Already answered — return the original result without mutating any stats
      return res.json({
        success: true,
        data: {
          isCorrect: existingAnswer.isCorrect,
          coachingText: question.coachingText,
          correctAnswerIndex: question.correctAnswerIndex,
          sessionCompleted: false,
          alreadyAnswered: true,
        },
      });
    }

    // Record answer (unique constraint prevents duplicates)
    await db.insert(quizAnswers).values({
      sessionId,
      questionId,
      selectedIndex,
      isCorrect,
    });

    // Update question stats (only on first answer — we checked existingAnswer above)
    await db.update(quizQuestions).set({
      totalAnswerCount: sql`${quizQuestions.totalAnswerCount} + 1`,
      wrongAnswerCount: isCorrect ? quizQuestions.wrongAnswerCount : sql`${quizQuestions.wrongAnswerCount} + 1`,
    }).where(eq(quizQuestions.id, questionId));

    // Check if all questions answered
    const allAnswers = await db
      .select()
      .from(quizAnswers)
      .where(eq(quizAnswers.sessionId, sessionId));

    const questionIds = (session.questionIds as string[]) || [];
    const allAnswered = questionIds.every((qid) => allAnswers.some((a) => a.questionId === qid));

    let sessionResult: typeof session | null = null;
    if (allAnswered) {
      const correct = allAnswers.filter((a) => a.isCorrect).length;
      const score = Math.round((correct / questionIds.length) * 100);
      const multiplier = session.streakMultiplier || 1;
      const basePoints = correct * 10;
      const totalPoints = basePoints * multiplier;

      const [updated] = await db
        .update(quizSessions)
        .set({
          status: "completed",
          correctAnswers: correct,
          score,
          totalPoints,
          completedAt: new Date(),
        })
        .where(eq(quizSessions.id, sessionId))
        .returning();

      sessionResult = updated;

      // Update user progress
      await updateUserProgress(userId, session, correct, questionIds.length, totalPoints);
    }

    return res.json({
      success: true,
      data: {
        isCorrect,
        coachingText: question.coachingText,
        correctAnswerIndex: question.correctAnswerIndex,
        sessionCompleted: allAnswered,
        session: sessionResult,
      },
    });
  }));

  // ── GET /api/quiz/stats ─────────────────────────────────────────────────────
  app.get("/api/quiz/stats", isAuthenticated, asyncHandler(async (req: any, res) => {
    const userId = req.user.id;

    const [progress] = await db
      .select()
      .from(userQuizProgress)
      .where(eq(userQuizProgress.userId, userId))
      .limit(1);

    const recentSessions = await db
      .select()
      .from(quizSessions)
      .where(eq(quizSessions.userId, userId))
      .orderBy(desc(quizSessions.createdAt))
      .limit(14);

    const today = getTodayStr();
    const todaySession = recentSessions.find((s) => s.sessionDate === today);

    return res.json({
      success: true,
      data: {
        progress,
        recentSessions,
        todayCompleted: todaySession?.status === "completed",
        currentStreak: progress?.currentStreakDays || 0,
        streakMultiplier: computeStreakMultiplier(progress?.currentStreakDays || 0),
        seasonPoints: progress?.seasonPoints || 0,
      },
    });
  }));

  // ── GET /api/quiz/leaderboard/season ────────────────────────────────────────
  app.get("/api/quiz/leaderboard/season", isAuthenticated, asyncHandler(async (req: any, res) => {
    const storeId = await resolveStoreIdForUser(req.user.id as string).catch(() => null);
    const season = getCurrentSeason();

    const leaders = await db
      .select({
        userId: userQuizProgress.userId,
        seasonPoints: userQuizProgress.seasonPoints,
        currentStreakDays: userQuizProgress.currentStreakDays,
        firstName: users.firstName,
        lastName: users.lastName,
        profileImageUrl: users.profileImageUrl,
      })
      .from(userQuizProgress)
      .leftJoin(users, eq(users.id, userQuizProgress.userId))
      .where(
        and(
          storeId ? eq(userQuizProgress.storeId, storeId) : undefined,
          eq(userQuizProgress.currentSeason, season)
        )
      )
      .orderBy(desc(userQuizProgress.seasonPoints))
      .limit(20);

    return res.json({ success: true, data: { season, leaders } });
  }));

  // ── GET /api/quiz/question-bank ─────────────────────────────────────────────
  app.get("/api/quiz/question-bank", isAuthenticated, asyncHandler(async (req: any, res) => {
    await requireManagerAccess(req, storage);
    const storeId = await resolveStoreRequired(req.user.id as string);
    const { topic, difficulty, page = "1" } = req.query as Record<string, string>;
    const pageNum = Math.max(1, parseInt(page));
    const limit = 50;
    const offset = (pageNum - 1) * limit;

    const whereClause = and(
      eq(quizQuestions.isActive, true),
      eq(quizQuestions.storeId, storeId),
      topic ? eq(quizQuestions.topicTag, topic) : undefined,
      difficulty ? eq(quizQuestions.difficulty, difficulty) : undefined,
    );

    const [questions, topicsRaw] = await Promise.all([
      db.select().from(quizQuestions).where(whereClause).orderBy(asc(quizQuestions.topicTag)).limit(limit).offset(offset),
      db.selectDistinct({ topic: quizQuestions.topicTag }).from(quizQuestions).where(eq(quizQuestions.storeId, storeId)),
    ]);

    return res.json({
      success: true,
      data: {
        questions,
        topics: topicsRaw.map((r) => r.topic),
        page: pageNum,
      },
    });
  }));

  // ── GET /api/quiz/analytics ──────────────────────────────────────────────────
  app.get("/api/quiz/analytics", isAuthenticated, asyncHandler(async (req: any, res) => {
    await requireManagerAccess(req, storage);
    const storeId = await resolveStoreRequired(req.user.id as string);

    // Team participation
    const participation = await db.execute(sql`
      SELECT 
        u.id, u.first_name, u.last_name,
        COALESCE(uqp.total_quizzes_completed, 0) AS quizzes_done,
        COALESCE(uqp.current_streak_days, 0) AS streak,
        COALESCE(uqp.season_points, 0) AS season_points,
        COALESCE(
          ROUND(CAST(uqp.total_correct_answers AS NUMERIC) / NULLIF(uqp.total_questions_answered, 0) * 100, 1),
          0
        ) AS accuracy
      FROM users u
      LEFT JOIN user_quiz_progress uqp ON uqp.user_id = u.id
      WHERE u.work_location_id = ${storeId}
        AND u.is_active = true
      ORDER BY season_points DESC
    `);

    // Topic difficulty (wrong answer rate)
    const topicStats = await db.execute(sql`
      SELECT 
        topic_tag,
        COUNT(*) AS total_questions,
        SUM(total_answer_count) AS total_answers,
        SUM(wrong_answer_count) AS total_wrong,
        CASE WHEN SUM(total_answer_count) > 0 
          THEN ROUND(CAST(SUM(wrong_answer_count) AS NUMERIC) / SUM(total_answer_count) * 100, 1)
          ELSE 0 
        END AS wrong_rate
      FROM quiz_questions
      WHERE store_id = ${storeId} AND is_active = true
      GROUP BY topic_tag
      ORDER BY wrong_rate DESC
    `);

    // Coverage gaps (topics with no answers in last 30 days)
    const coverageGaps = await db.execute(sql`
      SELECT DISTINCT q.topic_tag
      FROM quiz_questions q
      WHERE q.store_id = ${storeId}
        AND q.is_active = true
        AND q.topic_tag NOT IN (
          SELECT DISTINCT qs.topic_tag
          FROM quiz_sessions qs
          WHERE qs.store_id = ${storeId}
            AND qs.status = 'completed'
            AND qs.session_date >= CURRENT_DATE - INTERVAL '30 days'
        )
    `);

    // Top missed individual questions (highest wrong answer rate, min 5 answers)
    const highMissQuestions = await db.execute(sql`
      SELECT 
        id, question_text, topic_tag, difficulty,
        total_answer_count,
        wrong_answer_count,
        CASE WHEN total_answer_count > 0
          THEN ROUND(CAST(wrong_answer_count AS NUMERIC) / total_answer_count * 100, 1)
          ELSE 0
        END AS wrong_rate
      FROM quiz_questions
      WHERE store_id = ${storeId}
        AND is_active = true
        AND total_answer_count >= 5
      ORDER BY wrong_rate DESC
      LIMIT 10
    `);

    return res.json({
      success: true,
      data: {
        participation: participation.rows,
        topicStats: topicStats.rows,
        coverageGaps: coverageGaps.rows.map((r) => r.topic_tag as string),
        highMissQuestions: highMissQuestions.rows,
      },
    });
  }));

  // ── POST /api/quiz/scenario-answer ──────────────────────────────────────────
  // Records a learner's "What Would You Do?" scenario card selection.
  // Increments scenarioParticipationCount and awards 3 season points for engagement.
  app.post("/api/quiz/scenario-answer", isAuthenticated, asyncHandler(async (req: any, res) => {
    const userId = req.user.id as string;
    const { questionId, selectedIndex } = req.body;
    if (!questionId || typeof selectedIndex !== "number") {
      return res.status(400).json({ success: false, message: "questionId and selectedIndex required" });
    }

    const storeId = await resolveStoreIdForUser(userId).catch(() => null);
    if (!storeId) return res.status(404).json({ success: false, message: "Store not found" });

    // Validate question exists and is a scenario type
    const [question] = await db
      .select()
      .from(quizQuestions)
      .where(and(eq(quizQuestions.id, questionId), eq(quizQuestions.storeId, storeId), eq(quizQuestions.difficulty, "scenario")))
      .limit(1);
    if (!question) return res.status(404).json({ success: false, message: "Scenario question not found" });

    // Weekly lock: only award season points once per 7-day window to prevent point farming
    const [existing] = await db.select().from(userQuizProgress).where(eq(userQuizProgress.userId, userId)).limit(1);
    const season = getCurrentSeason();
    const todayStr = getTodayStr();
    const lastAwardedDate = existing?.scenarioLastAwardedDate;
    const daysSinceLastAward = lastAwardedDate
      ? Math.floor((Date.now() - new Date(lastAwardedDate).getTime()) / 86400000)
      : 999;
    const eligibleForPoints = daysSinceLastAward >= 7;

    if (existing) {
      const updatedSet: Record<string, unknown> = {
        scenarioParticipationCount: sql`COALESCE(scenario_participation_count, 0) + 1`,
        updatedAt: new Date(),
      };
      if (eligibleForPoints) {
        updatedSet.scenarioLastAwardedDate = todayStr;
        updatedSet.seasonPoints = existing.currentSeason === season ? (existing.seasonPoints ?? 0) + 3 : 3;
        updatedSet.currentSeason = season;
      }
      await db.update(userQuizProgress).set(updatedSet as any).where(eq(userQuizProgress.userId, userId));
    } else {
      await db.insert(userQuizProgress).values({
        userId,
        storeId,
        scenarioParticipationCount: 1,
        seasonPoints: 3,
        currentSeason: season,
        scenarioLastAwardedDate: todayStr,
      });
    }

    return res.json({
      success: true,
      data: {
        coachingText: question.coachingText ?? null,
        pointsAwarded: eligibleForPoints ? 3 : 0,
      },
    });
  }));

  // ── GET /api/quiz/scenario-card ─────────────────────────────────────────────
  app.get("/api/quiz/scenario-card", isAuthenticated, asyncHandler(async (req: any, res) => {
    const storeId = await resolveStoreIdForUser(req.user.id as string).catch(() => null);
    if (!storeId) {
      return res.json({ success: true, data: { scenario: null } });
    }

    // Return a stable weekly scenario — same card all week, rotates on Monday.
    // Selection is deterministic: order by id, pick index = (year*53 + isoWeek) % total
    const scenarios = await db
      .select()
      .from(quizQuestions)
      .where(
        and(
          eq(quizQuestions.storeId, storeId),
          eq(quizQuestions.isActive, true),
          eq(quizQuestions.difficulty, "scenario")
        )
      )
      .orderBy(quizQuestions.id);

    if (scenarios.length === 0) {
      return res.json({ success: true, data: { scenario: null } });
    }

    // Compute ISO week number for stable weekly rotation
    const now = new Date();
    const startOfYear = new Date(now.getFullYear(), 0, 1);
    const isoWeek = Math.ceil(((now.getTime() - startOfYear.getTime()) / 86400000 + startOfYear.getDay() + 1) / 7);
    const weekIndex = (now.getFullYear() * 53 + isoWeek) % scenarios.length;
    const scenario = scenarios[weekIndex];

    return res.json({ success: true, data: { scenario: sanitizeQuestionForLearner(scenario as unknown as Record<string, unknown>) } });
  }));
}

async function updateUserProgress(
  userId: string,
  session: typeof quizSessions.$inferSelect,
  correct: number,
  total: number,
  totalPoints: number
) {
  const today = getTodayStr();
  const season = getCurrentSeason();

  const [existing] = await db
    .select()
    .from(userQuizProgress)
    .where(eq(userQuizProgress.userId, userId))
    .limit(1);

  // Fetch all active topics for this store to properly track rotation
  // Sessions always have a storeId (daily endpoint guards against storeless users)
  const allTopics: string[] = session.storeId
    ? (await db
        .selectDistinct({ topic: quizQuestions.topicTag })
        .from(quizQuestions)
        .where(
          and(
            eq(quizQuestions.storeId, session.storeId),
            eq(quizQuestions.isActive, true)
          )
        )).map((r) => r.topic)
    : [];

  const lastDate = existing?.lastQuizDate;
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayStr = yesterday.toISOString().slice(0, 10);

  let newStreak = 1;
  if (lastDate === yesterdayStr) {
    newStreak = (existing?.currentStreakDays || 0) + 1;
  } else if (lastDate === today) {
    newStreak = existing?.currentStreakDays || 1;
  }

  const longestStreak = Math.max(newStreak, existing?.longestStreakDays || 0);

  const coveredTopics = (existing?.coveredTopicsThisRotation as string[]) || [];
  const isBossBattleSession = session.sessionType === "boss_battle";

  // For boss_battle sessions: reset rotation. For daily: track topic coverage.
  let newCovered: string[];
  let newPendingBossBattle: boolean;
  let allTopicsCoveredCountDelta = 0;

  if (isBossBattleSession) {
    // Boss battle completed → reset rotation for next cycle
    newCovered = [];
    newPendingBossBattle = false;
  } else {
    // Daily session completed → track topic coverage
    newCovered = coveredTopics.includes(session.topicTag)
      ? coveredTopics
      : [...coveredTopics, session.topicTag];
    // Check if all topics are now covered → trigger boss battle next
    const allCoveredNow = allTopics.length > 1 && allTopics.every((t) => newCovered.includes(t));
    newPendingBossBattle = allCoveredNow;
    if (allCoveredNow) allTopicsCoveredCountDelta = 1;
  }

  const allTopicsCoveredCount = (existing?.allTopicsCoveredCount || 0) + allTopicsCoveredCountDelta;
  const seasonPoints = (existing?.currentSeason === season ? (existing?.seasonPoints || 0) : 0) + totalPoints;

  if (existing) {
    await db.update(userQuizProgress).set({
      totalQuizzesCompleted: sql`${userQuizProgress.totalQuizzesCompleted} + 1`,
      totalQuestionsAnswered: sql`${userQuizProgress.totalQuestionsAnswered} + ${total}`,
      totalCorrectAnswers: sql`${userQuizProgress.totalCorrectAnswers} + ${correct}`,
      currentStreakDays: newStreak,
      longestStreakDays: longestStreak,
      lastQuizDate: today,
      seasonPoints,
      currentSeason: season,
      coveredTopicsThisRotation: newCovered,
      currentRotationTopics: allTopics,
      allTopicsCoveredCount,
      pendingBossBattle: newPendingBossBattle,
      updatedAt: new Date(),
    }).where(eq(userQuizProgress.userId, userId));
  } else {
    await db.insert(userQuizProgress).values({
      userId,
      storeId: session.storeId,
      totalQuizzesCompleted: 1,
      totalQuestionsAnswered: total,
      totalCorrectAnswers: correct,
      currentStreakDays: 1,
      longestStreakDays: 1,
      lastQuizDate: today,
      seasonPoints: totalPoints,
      currentSeason: season,
      coveredTopicsThisRotation: isBossBattleSession ? [] : [session.topicTag],
      pendingBossBattle: false,
      currentRotationTopics: allTopics,
      allTopicsCoveredCount: allTopicsCoveredCountDelta,
    });
  }
}
