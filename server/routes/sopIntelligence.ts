import type { Express } from "express";
import { db } from "../db";
import { eq, and, desc, sql } from "drizzle-orm";
import { sopInsights } from "@shared/schema";
import { analyzeSOP, generateSOPInsights } from "../services/sopIntelligence";
import type { IStorage } from "../storage";
import { cache } from "../lib/cache";
import logger from "../lib/logger";
import { resolveStoreId } from "../lib/storeResolver";

async function requireManagerOrAbove(storage: IStorage, userId: string): Promise<boolean> {
  const user = await storage.getUserWithRole(userId);
  if (!user) throw new Error("User not found");
  const roleName = user.role?.name;
  return roleName === "admin" || roleName === "owner" || roleName === "manager";
}

export function registerSOPIntelligenceRoutes(app: Express, storage: IStorage, isAuthenticated: any) {
  app.get("/api/sops/insights", isAuthenticated, async (req: any, res) => {
    try {
      const isManager = await requireManagerOrAbove(storage, req.user.id);
      if (!isManager) return res.status(403).json({ message: "Manager or owner access required" });

      const storeId = await resolveStoreId();
      if (!storeId) return res.status(400).json({ message: "No store configured" });

      const { severity, sop_template_id, status } = req.query;
      const filterStatus = (status as string) || "active";

      const conditions = [
        eq(sopInsights.storeId, storeId),
        eq(sopInsights.status, filterStatus),
      ];

      if (severity) {
        conditions.push(eq(sopInsights.severity, severity as string));
      }
      if (sop_template_id) {
        conditions.push(eq(sopInsights.sopTemplateId, sop_template_id as string));
      }

      const insights = await db.select().from(sopInsights)
        .where(and(...conditions))
        .orderBy(
          sql`CASE severity WHEN 'action_needed' THEN 1 WHEN 'warning' THEN 2 WHEN 'info' THEN 3 END`,
          desc(sopInsights.createdAt),
        );

      res.json(insights);
    } catch (error: any) {
      logger.error({ error: error.message }, "[SOPIntelligence] Error fetching insights");
      res.status(500).json({ message: "Failed to load insights" });
    }
  });

  app.put("/api/sops/insights/:id/acknowledge", isAuthenticated, async (req: any, res) => {
    try {
      const isManager = await requireManagerOrAbove(storage, req.user.id);
      if (!isManager) return res.status(403).json({ message: "Manager or owner access required" });

      const storeId = await resolveStoreId();
      if (!storeId) return res.status(400).json({ message: "No store configured" });

      const { id } = req.params;

      const updated = await db.update(sopInsights)
        .set({
          status: "acknowledged",
          acknowledgedBy: req.user.id,
          acknowledgedAt: new Date(),
        })
        .where(and(
          eq(sopInsights.id, id),
          eq(sopInsights.storeId, storeId),
          eq(sopInsights.status, "active"),
        ))
        .returning();

      if (updated.length === 0) return res.status(404).json({ message: "Insight not found" });

      res.json(updated[0]);
    } catch (error: any) {
      logger.error({ error: error.message }, "[SOPIntelligence] Error acknowledging insight");
      res.status(500).json({ message: "Failed to acknowledge insight" });
    }
  });

  app.get("/api/sops/analytics/:templateId", isAuthenticated, async (req: any, res) => {
    try {
      const isManager = await requireManagerOrAbove(storage, req.user.id);
      if (!isManager) return res.status(403).json({ message: "Manager or owner access required" });

      const storeId = await resolveStoreId();
      if (!storeId) return res.status(400).json({ message: "No store configured" });

      const { templateId } = req.params;
      const cacheKey = `sop-analytics:${templateId}:${storeId}`;
      const cached = cache.get<any>(cacheKey);
      if (cached) return res.json(cached);

      const analysis = await analyzeSOP(templateId, storeId);

      if (!analysis) return res.status(404).json({ message: "Template not found" });

      cache.set(cacheKey, analysis, 5 * 60 * 1000);
      res.json(analysis);
    } catch (error: any) {
      logger.error({ error: error.message }, "[SOPIntelligence] Error fetching analytics");
      res.status(500).json({ message: "Failed to load analytics" });
    }
  });

  app.post("/api/sops/insights/generate", isAuthenticated, async (req: any, res) => {
    try {
      const isManager = await requireManagerOrAbove(storage, req.user.id);
      if (!isManager) return res.status(403).json({ message: "Manager or owner access required" });

      const storeId = await resolveStoreId();
      if (!storeId) return res.status(400).json({ message: "No store configured" });

      await generateSOPInsights(storeId);
      res.json({ message: "Insights generated successfully" });
    } catch (error: any) {
      logger.error({ error: error.message }, "[SOPIntelligence] Error generating insights");
      res.status(500).json({ message: "Failed to generate insights" });
    }
  });
}
