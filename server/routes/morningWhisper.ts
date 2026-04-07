import type { Express } from "express";
import type { IStorage } from "../storage";
import { db } from "../db";
import { eq, and, desc } from "drizzle-orm";
import { morningWhispers } from "@shared/schema";
import { getOrGenerateWhisper } from "../services/morningWhisper";
import { resolveStoreId } from "../lib/storeResolver";

export function registerMorningWhisperRoutes(app: Express, storage: IStorage, isAuthenticated: any) {
  app.get("/api/whisper/today", isAuthenticated, async (req: any, res) => {
    try {
      const user = await storage.getUserWithRole(req.user.id);
      if (!user || !["admin", "owner", "manager"].includes(user.role?.name || "")) {
        return res.status(403).json({ message: "Morning Whisper is available for managers and owners." });
      }

      const storeId = await resolveStoreId() || "default";
      const result = await getOrGenerateWhisper(storeId, req.user.id);

      res.json(result);
    } catch (error: any) {
      console.error("[MorningWhisper] Error:", error.message);
      res.status(500).json({ message: "Failed to generate Morning Whisper." });
    }
  });

  app.put("/api/whisper/today/listened", isAuthenticated, async (req: any, res) => {
    try {
      const today = new Date().toISOString().split("T")[0];

      await db.update(morningWhispers)
        .set({ listened: true, listenedAt: new Date() })
        .where(and(
          eq(morningWhispers.userId, req.user.id),
          eq(morningWhispers.whisperDate, today),
        ));

      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/whisper/history", isAuthenticated, async (req: any, res) => {
    try {
      const limit = Math.min(parseInt(req.query.limit as string) || 30, 30);
      const offset = parseInt(req.query.offset as string) || 0;

      const whispers = await db.select({
        id: morningWhispers.id,
        whisperDate: morningWhispers.whisperDate,
        content: morningWhispers.content,
        listened: morningWhispers.listened,
        createdAt: morningWhispers.createdAt,
      }).from(morningWhispers)
        .where(eq(morningWhispers.userId, req.user.id))
        .orderBy(desc(morningWhispers.whisperDate))
        .limit(limit)
        .offset(offset);

      res.json(whispers);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });
}
