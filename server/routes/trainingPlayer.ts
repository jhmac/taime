import type { Express, Request, Response } from "express";
import type { IStorage } from "../storage";
import { db } from "../db";
import {
  trainingLessons,
  trainingQuestions,
  trainingLessonProgress,
  trainingFlags,
  trainingPracticeSchedule,
  employeeTrainingProgress,
  trainingModules,
  clockEvents,
  performanceScoreSettings,
  users,
} from "@shared/schema";
import { eq, and, lte, desc, sql, count } from "drizzle-orm";
import { z } from "zod";
import { tryResolveStoreIdForUser } from "../lib/storeResolver";

const TRAINING_SCORE_SETTINGS = [
  { eventType: "training-module-complete", pointValue: 50 },
  { eventType: "training-quiz-pass", pointValue: 25 },
  { eventType: "training-daily-practice", pointValue: 15 },
  { eventType: "training-streak-7day", pointValue: 100 },
];

async function awardTrainingPoints(userId: string, eventType: string, metadata?: Record<string, unknown>) {
  const scoreSettings = await db.select().from(performanceScoreSettings).where(eq(performanceScoreSettings.eventType, eventType)).limit(1);
  const defaultSetting = TRAINING_SCORE_SETTINGS.find(s => s.eventType === eventType);
  const pointValue = scoreSettings[0]?.isActive ? scoreSettings[0].pointValue : (defaultSetting?.pointValue ?? 0);
  if (pointValue !== 0) {
    await db.insert(clockEvents).values({ userId, eventType, pointValue, metadata: metadata ?? null });
  }
  return pointValue;
}

export function registerTrainingPlayerRoutes(app: Express, storage: IStorage, isAuthenticated: any) {

  // ── Module full content ──────────────────────────────────────────────────────
  app.get("/api/training/modules/:moduleId/player", isAuthenticated, async (req: any, res: Response) => {
    try {
      const { moduleId } = req.params;
      const userId = req.user.id;
      const [moduleRow] = await db.select().from(trainingModules).where(eq(trainingModules.id, moduleId)).limit(1);
      if (!moduleRow) return res.status(404).json({ message: "Module not found" });

      const lessons = await storage.getTrainingLessons(moduleId);
      const questionsMap: Record<string, any[]> = {};
      for (const lesson of lessons) {
        questionsMap[lesson.id] = await storage.getTrainingQuestions(lesson.id);
      }
      const lessonProgress = await storage.getTrainingLessonProgress(userId, moduleId);
      const progressMap: Record<string, any> = {};
      for (const p of lessonProgress) {
        progressMap[p.lessonId] = p;
      }

      res.json({
        success: true,
        data: {
          module: moduleRow,
          lessons: lessons.map(l => ({
            ...l,
            questions: questionsMap[l.id] ?? [],
            progress: progressMap[l.id] ?? null,
          })),
        },
      });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ── Save lesson progress ─────────────────────────────────────────────────────
  app.post("/api/training/lessons/:lessonId/progress", isAuthenticated, async (req: any, res: Response) => {
    try {
      const { lessonId } = req.params;
      const userId = req.user.id;
      const schema = z.object({
        moduleId: z.string(),
        status: z.enum(["not_started", "in_progress", "completed"]),
        quizScore: z.number().min(0).max(100).optional(),
      });
      const { moduleId, status, quizScore } = schema.parse(req.body);

      const progress = await storage.upsertTrainingLessonProgress({
        employeeId: userId,
        lessonId,
        moduleId,
        status,
        quizScore: quizScore ?? null,
        completedAt: status === "completed" ? new Date() : null,
      });

      // If quiz lesson passed (>= 70%), award quiz pass points
      if (status === "completed" && quizScore !== undefined && quizScore >= 70) {
        await awardTrainingPoints(userId, "training-quiz-pass", { lessonId, moduleId, score: quizScore });

        // Enqueue questions for spaced-repetition practice
        const questions = await storage.getTrainingQuestions(lessonId);
        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);
        for (const q of questions) {
          await storage.upsertPracticeSchedule({
            employeeId: userId,
            questionId: q.id,
            nextReviewAt: tomorrow,
            intervalDays: 1,
            lastResult: null,
            lastAnsweredAt: null,
          });
        }
      }

      // Check if whole module is now complete
      const lessons = await storage.getTrainingLessons(moduleId);
      const allProgress = await storage.getTrainingLessonProgress(userId, moduleId);
      const completedIds = new Set(allProgress.filter(p => p.status === "completed").map(p => p.lessonId));
      const allDone = lessons.every(l => completedIds.has(l.id));

      if (allDone) {
        const existing = (await storage.getEmployeeTrainingProgress(userId)).find(p => p.moduleId === moduleId);
        if (!existing || existing.status !== "completed") {
          await storage.upsertEmployeeTrainingProgress({ userId, moduleId, status: "completed", completedAt: new Date(), score: null });
          await awardTrainingPoints(userId, "training-module-complete", { moduleId });
        }
      }

      res.json({ success: true, data: progress });
    } catch (err: any) {
      res.status(400).json({ message: err.message });
    }
  });

  // ── Flag a lesson/question ───────────────────────────────────────────────────
  app.post("/api/training/lessons/:lessonId/flag", isAuthenticated, async (req: any, res: Response) => {
    try {
      const { lessonId } = req.params;
      const userId = req.user.id;
      const schema = z.object({ reason: z.string().optional(), questionId: z.string().optional() });
      const { reason, questionId } = schema.parse(req.body);

      const flag = await storage.createTrainingFlag({
        employeeId: userId,
        lessonId,
        questionId: questionId ?? null,
        reason: reason ?? null,
        status: "open",
        resolvedBy: null,
        resolvedAt: null,
      });

      await storage.upsertTrainingLessonProgress({
        employeeId: userId,
        lessonId,
        moduleId: req.body.moduleId ?? "",
        status: "in_progress",
        isFlagged: true,
        flagReason: reason ?? null,
      });

      res.json({ success: true, data: flag });
    } catch (err: any) {
      res.status(400).json({ message: err.message });
    }
  });

  // ── Daily practice queue ─────────────────────────────────────────────────────
  app.get("/api/training/practice/due", isAuthenticated, async (req: any, res: Response) => {
    try {
      const userId = req.user.id;
      const queue = await storage.getDuePracticeQuestions(userId, 5);
      res.json({ success: true, data: queue });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ── Answer a practice question ───────────────────────────────────────────────
  app.post("/api/training/practice/:questionId/answer", isAuthenticated, async (req: any, res: Response) => {
    try {
      const { questionId } = req.params;
      const userId = req.user.id;
      const schema = z.object({ selectedIndex: z.number().int().min(0) });
      const { selectedIndex } = schema.parse(req.body);

      const question = await storage.getTrainingQuestion(questionId);
      if (!question) return res.status(404).json({ message: "Question not found" });

      const isCorrect = selectedIndex === question.correctAnswerIndex;

      const [existing] = await db
        .select()
        .from(trainingPracticeSchedule)
        .where(and(eq(trainingPracticeSchedule.employeeId, userId), eq(trainingPracticeSchedule.questionId, questionId)))
        .limit(1);

      const currentInterval = existing?.intervalDays ?? 1;
      const nextInterval = isCorrect ? Math.min(currentInterval * 2, 14) : 1;
      const nextReview = new Date();
      nextReview.setDate(nextReview.getDate() + nextInterval);

      await storage.upsertPracticeSchedule({
        employeeId: userId,
        questionId,
        nextReviewAt: nextReview,
        intervalDays: nextInterval,
        lastResult: isCorrect ? "correct" : "incorrect",
        lastAnsweredAt: new Date(),
      });

      // Check if this completes today's practice session (5 questions done)
      const [{ cnt }] = await db
        .select({ cnt: count() })
        .from(trainingPracticeSchedule)
        .where(and(eq(trainingPracticeSchedule.employeeId, userId), eq(trainingPracticeSchedule.lastResult, "correct")));

      if (Number(cnt) > 0 && Number(cnt) % 5 === 0) {
        await awardTrainingPoints(userId, "training-daily-practice", { questionId });
      }

      res.json({
        success: true,
        data: {
          isCorrect,
          correctAnswerIndex: question.correctAnswerIndex,
          coachingText: question.coachingText,
          nextIntervalDays: nextInterval,
        },
      });
    } catch (err: any) {
      res.status(400).json({ message: err.message });
    }
  });

  // ── Manager: team training matrix ────────────────────────────────────────────
  app.get("/api/training/manager/matrix", isAuthenticated, async (req: any, res: Response) => {
    try {
      const requesterId = req.user.id;
      const perms = await storage.getUserPermissions(requesterId);
      const isManager = perms.some(p => p.name === "admin.manage_all" || p.name === "hr.view_team");
      if (!isManager) return res.status(403).json({ message: "Access denied" });

      const storeId = await tryResolveStoreIdForUser(requesterId);
      const allModules = await storage.getTrainingModules(storeId ?? undefined);
      const managerUser = await storage.getUser(requesterId);
      const managerLocation = managerUser?.locationName;
      const rawUsers = await storage.getAllUsers();
      const allUsers = rawUsers.filter(u => u.isActive && (managerLocation ? u.locationName === managerLocation : true));
      const allProgress = await db.select().from(employeeTrainingProgress);

      const matrix = allUsers.map(u => ({
        userId: u.id,
        name: `${u.firstName ?? ""} ${u.lastName ?? ""}`.trim() || u.email,
        modules: allModules.map(m => {
          const prog = allProgress.find(p => p.userId === u.id && p.moduleId === m.id);
          return { moduleId: m.id, moduleTitle: m.title, status: prog?.status ?? "not_started", score: prog?.score ?? null, completedAt: prog?.completedAt ?? null };
        }),
      }));

      res.json({ success: true, data: { modules: allModules, employees: matrix } });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ── Manager: top flagged questions ───────────────────────────────────────────
  app.get("/api/training/manager/flags", isAuthenticated, async (req: any, res: Response) => {
    try {
      const requesterId = req.user.id;
      const perms = await storage.getUserPermissions(requesterId);
      const isManager = perms.some(p => p.name === "admin.manage_all" || p.name === "hr.view_team");
      if (!isManager) return res.status(403).json({ message: "Access denied" });

      const flags = await storage.getTrainingFlags("open");
      res.json({ success: true, data: flags });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ── Manager: resolve flag ────────────────────────────────────────────────────
  app.patch("/api/training/manager/flags/:flagId", isAuthenticated, async (req: any, res: Response) => {
    try {
      const requesterId = req.user.id;
      const perms = await storage.getUserPermissions(requesterId);
      const isManager = perms.some(p => p.name === "admin.manage_all" || p.name === "hr.view_team");
      if (!isManager) return res.status(403).json({ message: "Access denied" });

      const { flagId } = req.params;
      const flag = await storage.updateTrainingFlag(flagId, { status: "resolved", resolvedBy: requesterId, resolvedAt: new Date() });
      res.json({ success: true, data: flag });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ── Manager: reassign/retake/exempt ──────────────────────────────────────────
  app.post("/api/training/manager/progress/:userId/:moduleId", isAuthenticated, async (req: any, res: Response) => {
    try {
      const requesterId = req.user.id;
      const perms = await storage.getUserPermissions(requesterId);
      const isManager = perms.some(p => p.name === "admin.manage_all" || p.name === "hr.view_team");
      if (!isManager) return res.status(403).json({ message: "Access denied" });

      const { userId, moduleId } = req.params;
      const schema = z.object({ action: z.enum(["reassign", "require_retake", "exempt"]) });
      const { action } = schema.parse(req.body);

      const newStatus = action === "exempt" ? "exempted" : "not_started";
      await storage.upsertEmployeeTrainingProgress({ userId, moduleId, status: newStatus, completedAt: null, score: null });

      res.json({ success: true, data: { userId, moduleId, action } });
    } catch (err: any) {
      res.status(400).json({ message: err.message });
    }
  });

  // ── Manager: CSV export ──────────────────────────────────────────────────────
  app.get("/api/training/manager/export-csv", isAuthenticated, async (req: any, res: Response) => {
    try {
      const requesterId = req.user.id;
      const perms = await storage.getUserPermissions(requesterId);
      const isManager = perms.some(p => p.name === "admin.manage_all" || p.name === "hr.view_team");
      if (!isManager) return res.status(403).json({ message: "Access denied" });

      const storeId = await tryResolveStoreIdForUser(requesterId);
      const managerUser = await storage.getUser(requesterId);
      const managerLocation = managerUser?.locationName;
      const rawUsersForExport = await storage.getAllUsers();
      const allModules = await storage.getTrainingModules(storeId ?? undefined);
      const allUsers = rawUsersForExport.filter(u => u.isActive && (managerLocation ? u.locationName === managerLocation : true));
      const allProgress = await db.select().from(employeeTrainingProgress);

      const headers = ["Employee", "Email", ...allModules.map(m => m.title), "Overall %"];
      const rows = allUsers.map(u => {
        const name = `${u.firstName ?? ""} ${u.lastName ?? ""}`.trim() || "Unknown";
        const moduleStatuses = allModules.map(m => {
          const prog = allProgress.find(p => p.userId === u.id && p.moduleId === m.id);
          return prog?.status ?? "not_started";
        });
        const completedCount = moduleStatuses.filter(s => s === "completed").length;
        const overallPct = allModules.length > 0 ? Math.round((completedCount / allModules.length) * 100) : 0;
        return [name, u.email ?? "", ...moduleStatuses, `${overallPct}%`];
      });

      const csvLines = [headers.join(","), ...rows.map(r => r.join(","))].join("\n");
      res.setHeader("Content-Type", "text/csv");
      res.setHeader("Content-Disposition", `attachment; filename="training-report-${new Date().toISOString().split("T")[0]}.csv"`);
      res.send(csvLines);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ── Lesson management (manager) ──────────────────────────────────────────────
  app.post("/api/training/modules/:moduleId/lessons", isAuthenticated, async (req: any, res: Response) => {
    try {
      const requesterId = req.user.id;
      const perms = await storage.getUserPermissions(requesterId);
      const isManager = perms.some(p => p.name === "admin.manage_all");
      if (!isManager) return res.status(403).json({ message: "Access denied" });

      const { moduleId } = req.params;
      const schema = z.object({
        type: z.enum(["concept", "script_practice", "scenario", "quiz"]),
        title: z.string().min(1),
        contentJson: z.record(z.unknown()),
        orderIndex: z.number().int().min(0),
        questions: z.array(z.object({
          questionText: z.string(),
          answerChoices: z.array(z.string()),
          correctAnswerIndex: z.number().int().min(0),
          coachingText: z.string().optional(),
        })).optional(),
      });
      const { questions, ...lessonData } = schema.parse(req.body);
      const lesson = await storage.createTrainingLesson({ ...lessonData, moduleId });

      const createdQuestions = [];
      for (const q of questions ?? []) {
        const question = await storage.createTrainingQuestion({ ...q, lessonId: lesson.id, coachingText: q.coachingText ?? null });
        createdQuestions.push(question);
      }

      res.json({ success: true, data: { lesson, questions: createdQuestions } });
    } catch (err: any) {
      res.status(400).json({ message: err.message });
    }
  });

  // ── Employee training dashboard data ─────────────────────────────────────────
  app.get("/api/training/dashboard", isAuthenticated, async (req: any, res: Response) => {
    try {
      const userId = req.user.id;
      const storeId = await tryResolveStoreIdForUser(userId);
      const allModules = await storage.getTrainingModules(storeId ?? undefined);
      const allProgress = await storage.getEmployeeTrainingProgress(userId);
      const due = await storage.getDuePracticeQuestions(userId, 5);

      // Compute streak
      const recentProgress = await db
        .select()
        .from(trainingLessonProgress)
        .where(eq(trainingLessonProgress.employeeId, userId))
        .orderBy(desc(trainingLessonProgress.completedAt))
        .limit(30);

      // Simple streak: count consecutive days with at least one completed lesson
      const daySet = new Set<string>();
      for (const p of recentProgress) {
        if (p.completedAt) {
          daySet.add(p.completedAt.toISOString().split("T")[0]);
        }
      }
      let streak = 0;
      const today = new Date();
      for (let i = 0; i < 30; i++) {
        const d = new Date(today);
        d.setDate(d.getDate() - i);
        const key = d.toISOString().split("T")[0];
        if (daySet.has(key)) streak++;
        else break;
      }

      // Check 7-day streak milestone
      if (streak > 0 && streak % 7 === 0) {
        const recentEvents = await storage.getClockEvents(userId);
        const streakEventsToday = recentEvents.filter(e =>
          e.eventType === "training-streak-7day" &&
          e.createdAt &&
          e.createdAt.toISOString().split("T")[0] === today.toISOString().split("T")[0]
        );
        if (streakEventsToday.length === 0) {
          await awardTrainingPoints(userId, "training-streak-7day", { streak });
        }
      }

      const moduleSummaries = allModules.map(m => {
        const prog = allProgress.find(p => p.moduleId === m.id);
        return {
          ...m,
          status: prog?.status ?? "not_started",
          completedAt: prog?.completedAt ?? null,
          score: prog?.score ?? null,
        };
      });

      res.json({
        success: true,
        data: {
          modules: moduleSummaries,
          practiceQueue: due,
          streak,
          practiceCount: due.length,
        },
      });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });
}
