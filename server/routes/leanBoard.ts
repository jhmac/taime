import type { Express } from "express";
import { db } from "../db";
import { eq, and, gte, lte, desc } from "drizzle-orm";
import { leanBoardSnapshots } from "@shared/schema";
import { getLeanBoardData, generateDailySnapshot, generateWeeklyLeanSummary } from "../services/leanBoard";
import type { IStorage } from "../storage";
import logger from "../lib/logger";
import { resolveStoreId } from "../services/storeResolver";

export function registerLeanBoardRoutes(app: Express, storage: IStorage, isAuthenticated: any) {
  app.get("/api/lean-board", isAuthenticated, async (req: any, res) => {
    try {
      const storeId = await resolveStoreId() || "default";
      const period = (req.query.period as string) || "week";

      if (!["today", "week", "month"].includes(period)) {
        return res.status(400).json({ message: "Invalid period. Use today, week, or month." });
      }

      const data = await getLeanBoardData(storeId, period as any);
      res.json(data);
    } catch (error: any) {
      logger.error({ error: error.message }, "[LeanBoard] Error loading data");
      res.status(500).json({ message: "Failed to load lean board data." });
    }
  });

  app.get("/api/lean-board/history", isAuthenticated, async (req: any, res) => {
    try {
      const user = await storage.getUserWithRole(req.user.id);
      if (!user || !["admin", "owner", "manager"].includes(user.role?.name || "")) {
        return res.status(403).json({ message: "History is available for managers and owners." });
      }

      const storeId = await resolveStoreId() || "default";
      const dateFrom = req.query.date_from as string;
      const dateTo = req.query.date_to as string;

      if (!dateFrom || !dateTo) {
        return res.status(400).json({ message: "date_from and date_to are required." });
      }

      const snapshots = await db.select().from(leanBoardSnapshots)
        .where(and(
          eq(leanBoardSnapshots.storeId, storeId),
          gte(leanBoardSnapshots.snapshotDate, dateFrom),
          lte(leanBoardSnapshots.snapshotDate, dateTo),
        ))
        .orderBy(desc(leanBoardSnapshots.snapshotDate));

      res.json(snapshots);
    } catch (error: any) {
      logger.error({ error: error.message }, "[LeanBoard] History error");
      res.status(500).json({ message: "Failed to load history." });
    }
  });

  app.post("/api/lean-board/generate-snapshot", isAuthenticated, async (req: any, res) => {
    try {
      const user = await storage.getUserWithRole(req.user.id);
      if (!user || !["admin", "owner", "manager"].includes(user.role?.name || "")) {
        return res.status(403).json({ message: "Only managers and owners can trigger snapshots." });
      }

      const storeId = await resolveStoreId() || "default";
      await generateDailySnapshot(storeId, new Date());

      res.json({ success: true, message: "Snapshot generated." });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/lean-board/generate-summary", isAuthenticated, async (req: any, res) => {
    try {
      const user = await storage.getUserWithRole(req.user.id);
      if (!user || !["admin", "owner", "manager"].includes(user.role?.name || "")) {
        return res.status(403).json({ message: "Only managers and owners can trigger summaries." });
      }

      const storeId = await resolveStoreId() || "default";
      const summary = await generateWeeklyLeanSummary(storeId);

      res.json({ success: true, summary });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });
}
