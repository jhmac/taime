import type { Express } from "express";
import { db } from "../db";
import { eq, and, desc } from "drizzle-orm";
import { weeklyReviews } from "@shared/schema";
import { generateWeeklyReview } from "../services/weeklyReviewAI";
import logger from "../lib/logger";
import type { IStorage } from "../storage";

function getWeekStart(date: Date = new Date()): string {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  d.setDate(diff);
  return d.toISOString().split('T')[0];
}

export function registerWeeklyReviewRoutes(
  app: Express,
  _storage: IStorage,
  isAuthenticated: any,
) {
  app.get("/api/gtd/review/current", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user?.id;
      const storeId = req.user?.storeId;
      if (!userId || !storeId) return res.status(401).json({ success: false, message: "Not authenticated" });

      const weekStart = getWeekStart();

      const [existing] = await db.select().from(weeklyReviews)
        .where(and(
          eq(weeklyReviews.storeId, storeId),
          eq(weeklyReviews.userId, userId),
          eq(weeklyReviews.reviewWeekStart, weekStart),
        ));

      if (existing) {
        return res.json({ success: true, data: existing });
      }

      const aiContent = await generateWeeklyReview(storeId, userId);

      const [review] = await db.insert(weeklyReviews).values({
        storeId,
        userId,
        reviewWeekStart: weekStart,
        aiContent,
        status: "pending",
      }).returning();

      return res.json({ success: true, data: review });
    } catch (err: any) {
      logger.error({ error: err.message }, "Failed to get weekly review");
      return res.status(500).json({ success: false, message: "Failed to generate review" });
    }
  });

  app.put("/api/gtd/review/current", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user?.id;
      const storeId = req.user?.storeId;
      if (!userId || !storeId) return res.status(401).json({ success: false, message: "Not authenticated" });

      const weekStart = getWeekStart();
      const { status, notes } = req.body;

      const updates: Record<string, any> = {};
      if (status === "in_progress") {
        updates.status = "in_progress";
        updates.startedAt = new Date();
      } else if (status === "completed") {
        updates.status = "completed";
        updates.completedAt = new Date();
      }
      if (notes !== undefined) {
        updates.notes = notes;
      }

      if (Object.keys(updates).length === 0) {
        return res.status(400).json({ success: false, message: "No valid updates" });
      }

      const [updated] = await db.update(weeklyReviews)
        .set(updates)
        .where(and(
          eq(weeklyReviews.storeId, storeId),
          eq(weeklyReviews.userId, userId),
          eq(weeklyReviews.reviewWeekStart, weekStart),
        ))
        .returning();

      if (!updated) {
        return res.status(404).json({ success: false, message: "No review found for this week" });
      }

      return res.json({ success: true, data: updated });
    } catch (err: any) {
      logger.error({ error: err.message }, "Failed to update weekly review");
      return res.status(500).json({ success: false, message: "Failed to update review" });
    }
  });

  app.get("/api/gtd/review/history", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user?.id;
      const storeId = req.user?.storeId;
      if (!userId || !storeId) return res.status(401).json({ success: false, message: "Not authenticated" });

      const limit = Math.min(parseInt(req.query.limit as string) || 10, 50);
      const offset = parseInt(req.query.offset as string) || 0;

      const reviews = await db.select().from(weeklyReviews)
        .where(and(
          eq(weeklyReviews.storeId, storeId),
          eq(weeklyReviews.userId, userId),
        ))
        .orderBy(desc(weeklyReviews.reviewWeekStart))
        .limit(limit)
        .offset(offset);

      return res.json({ success: true, data: reviews });
    } catch (err: any) {
      logger.error({ error: err.message }, "Failed to get review history");
      return res.status(500).json({ success: false, message: "Failed to load history" });
    }
  });
}

let weeklyReviewCronTimer: ReturnType<typeof setInterval> | null = null;
let lastPregenWeek = "";

export function startWeeklyReviewCron() {
  weeklyReviewCronTimer = setInterval(async () => {
    try {
      const now = new Date();
      const dayOfWeek = now.getDay();
      const hour = now.getHours();
      const minute = now.getMinutes();

      if (dayOfWeek !== 5 || hour < 14 || (hour === 14 && minute < 45)) return;

      const thisWeek = getWeekStart();
      if (lastPregenWeek === thisWeek) return;

      logger.info("[WeeklyReview] Pre-generating reviews for this Friday");
      lastPregenWeek = thisWeek;

      const { users } = await import("@shared/schema");
      const adminUsers = await db.select({ id: users.id, storeId: users.storeId })
        .from(users)
        .where(eq(users.isActive, true));

      for (const u of adminUsers) {
        if (!u.storeId) continue;
        try {
          const [existing] = await db.select({ id: weeklyReviews.id }).from(weeklyReviews)
            .where(and(
              eq(weeklyReviews.storeId, u.storeId),
              eq(weeklyReviews.userId, u.id),
              eq(weeklyReviews.reviewWeekStart, thisWeek),
            ));
          if (existing) continue;

          const aiContent = await generateWeeklyReview(u.storeId, u.id);
          await db.insert(weeklyReviews).values({
            storeId: u.storeId,
            userId: u.id,
            reviewWeekStart: thisWeek,
            aiContent,
            status: "pending",
          });
          logger.info({ userId: u.id }, "[WeeklyReview] Pre-generated review");
        } catch (err: any) {
          logger.warn({ userId: u.id, error: err.message }, "[WeeklyReview] Failed to pre-generate");
        }
      }
    } catch (err: any) {
      logger.error({ error: err.message }, "[WeeklyReview] Cron error");
    }
  }, 15 * 60 * 1000);

  logger.info("[WeeklyReview] Cron started (checks every 15 minutes)");
}

export function stopWeeklyReviewCron() {
  if (weeklyReviewCronTimer) {
    clearInterval(weeklyReviewCronTimer);
    weeklyReviewCronTimer = null;
  }
}
