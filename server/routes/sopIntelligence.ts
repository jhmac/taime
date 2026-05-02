import type { Express } from "express";
import { db } from "../db";
import { eq, and, desc, sql } from "drizzle-orm";
import { sopInsights } from "@shared/schema";
import { analyzeSOP, generateSOPInsights } from "../services/sopIntelligence";
import type { IStorage } from "../storage";
import { cache } from "../services/cache";
import { resolveStoreId } from "../services/storeResolver";
import { asyncHandler, AppError } from "../lib/routeWrapper";

async function requireManagerOrAbove(storage: IStorage, userId: string): Promise<boolean> {
  const user = await storage.getUserWithRole(userId);
  if (!user) throw new AppError(404, "User not found", "NOT_FOUND");
  const roleName = user.role?.name;
  return roleName === "admin" || roleName === "owner" || roleName === "manager";
}

export function registerSOPIntelligenceRoutes(app: Express, storage: IStorage, isAuthenticated: any) {
  app.get("/api/sops/insights", isAuthenticated, asyncHandler(async (req: any, res) => {
    const isManager = await requireManagerOrAbove(storage, req.user.id);
    if (!isManager) throw new AppError(403, "Manager or owner access required", "FORBIDDEN");

    const storeId = await resolveStoreId();
    if (!storeId) throw new AppError(400, "No store configured", "NO_STORE");

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
  }));

  app.put("/api/sops/insights/:id/acknowledge", isAuthenticated, asyncHandler(async (req: any, res) => {
    const isManager = await requireManagerOrAbove(storage, req.user.id);
    if (!isManager) throw new AppError(403, "Manager or owner access required", "FORBIDDEN");

    const storeId = await resolveStoreId();
    if (!storeId) throw new AppError(400, "No store configured", "NO_STORE");

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

    if (updated.length === 0) throw new AppError(404, "Insight not found", "NOT_FOUND");

    res.json(updated[0]);
  }));

  app.get("/api/sops/analytics/:templateId", isAuthenticated, asyncHandler(async (req: any, res) => {
    const isManager = await requireManagerOrAbove(storage, req.user.id);
    if (!isManager) throw new AppError(403, "Manager or owner access required", "FORBIDDEN");

    const storeId = await resolveStoreId();
    if (!storeId) throw new AppError(400, "No store configured", "NO_STORE");

    const { templateId } = req.params;
    const cacheKey = `sop-analytics:${templateId}:${storeId}`;
    const cached = cache.get<any>(cacheKey);
    if (cached) return res.json(cached);

    const analysis = await analyzeSOP(templateId, storeId);

    if (!analysis) throw new AppError(404, "Template not found", "NOT_FOUND");

    cache.set(cacheKey, analysis, 5 * 60 * 1000);
    res.json(analysis);
  }));

  app.post("/api/sops/insights/generate", isAuthenticated, asyncHandler(async (req: any, res) => {
    const isManager = await requireManagerOrAbove(storage, req.user.id);
    if (!isManager) throw new AppError(403, "Manager or owner access required", "FORBIDDEN");

    const storeId = await resolveStoreId();
    if (!storeId) throw new AppError(400, "No store configured", "NO_STORE");

    await generateSOPInsights(storeId);
    res.json({ message: "Insights generated successfully" });
  }));
}
