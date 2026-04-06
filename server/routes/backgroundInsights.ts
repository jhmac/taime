import type { Express } from "express";
import { z } from "zod";
import { db } from "../db";
import { eq, and, desc, sql } from "drizzle-orm";
import { backgroundInsights } from "@shared/schema";
import { asyncHandler, AppError } from "../lib/routeWrapper";
import type { IStorage } from "../storage";
import { runAllInsightGenerators } from "../services/backgroundInsights";
import { cache } from "../lib/cache";
import logger from "../lib/logger";
import { resolveStoreId } from "../lib/storeResolver";

async function requireManagerOrAbove(storage: IStorage, userId: string): Promise<boolean> {
  const perms = await storage.getUserPermissions(userId);
  return perms.some(p =>
    p.name === "admin.manage_all" ||
    p.name === "manager.view_reports" ||
    p.name === "manager.manage_schedules"
  );
}

export function registerBackgroundInsightRoutes(app: Express, storage: IStorage, isAuthenticated: any) {

  app.get("/api/background-insights/summary", isAuthenticated, asyncHandler(async (req: any, res) => {
    const isManager = await requireManagerOrAbove(storage, req.user.id);
    if (!isManager) throw new AppError(403, "Manager or above access required", "FORBIDDEN");

    const storeId = await resolveStoreId();
    if (!storeId) {
      return res.json({ success: true, data: { totalActive: 0, actionNeededCount: 0, byType: {} } });
    }

    const cacheKey = `bg-insights-summary:${storeId}`;
    const cached = cache.get<any>(cacheKey);
    if (cached) return res.json(cached);

    const allActive = await db.select().from(backgroundInsights)
      .where(and(
        eq(backgroundInsights.storeId, storeId),
        eq(backgroundInsights.status, "active"),
      ));

    const actionNeeded = allActive.filter(i => i.severity === "action_needed").length;
    const byType: Record<string, number> = {};
    for (const i of allActive) {
      byType[i.insightType] = (byType[i.insightType] || 0) + 1;
    }

    const response = {
      success: true,
      data: { totalActive: allActive.length, actionNeededCount: actionNeeded, byType },
    };
    cache.set(cacheKey, response, 3 * 60 * 1000);
    res.json(response);
  }));

  app.get("/api/background-insights", isAuthenticated, asyncHandler(async (req: any, res) => {
    const isManager = await requireManagerOrAbove(storage, req.user.id);
    if (!isManager) throw new AppError(403, "Manager or above access required", "FORBIDDEN");

    const storeId = await resolveStoreId();
    if (!storeId) {
      return res.json({ success: true, data: [] });
    }

    const limit = Math.min(Math.max(parseInt(req.query.limit as string) || 20, 1), 50);
    const offset = Math.max(parseInt(req.query.offset as string) || 0, 0);
    const typeFilter = req.query.insight_type as string | undefined;
    const severityFilter = req.query.severity as string | undefined;
    const statusFilter = (req.query.status as string) || "active";

    const conditions = [
      eq(backgroundInsights.storeId, storeId),
      eq(backgroundInsights.status, statusFilter),
    ];

    if (typeFilter) conditions.push(eq(backgroundInsights.insightType, typeFilter));
    if (severityFilter) conditions.push(eq(backgroundInsights.severity, severityFilter));

    const results = await db.select().from(backgroundInsights)
      .where(and(...conditions))
      .orderBy(
        sql`CASE severity WHEN 'action_needed' THEN 1 WHEN 'warning' THEN 2 WHEN 'suggestion' THEN 3 ELSE 4 END`,
        desc(backgroundInsights.createdAt),
      )
      .limit(limit)
      .offset(offset);

    res.json({ success: true, data: results });
  }));

  app.put("/api/background-insights/:id", isAuthenticated, asyncHandler(async (req: any, res) => {
    const isManager = await requireManagerOrAbove(storage, req.user.id);
    if (!isManager) throw new AppError(403, "Manager or above access required", "FORBIDDEN");

    const { id } = req.params;
    const body = z.object({
      status: z.enum(["acknowledged", "dismissed", "acted_on"]),
    }).parse(req.body);

    const [insight] = await db.select().from(backgroundInsights).where(eq(backgroundInsights.id, id));
    if (!insight) throw new AppError(404, "Insight not found", "NOT_FOUND");

    const updateData: Record<string, unknown> = {
      status: body.status,
      acknowledgedBy: req.user.id,
    };

    if (body.status === "acted_on") {
      updateData.actedOnAt = new Date();
    }

    await db.update(backgroundInsights)
      .set(updateData)
      .where(eq(backgroundInsights.id, id));

    cache.invalidatePrefix("bg-insights-summary:");
    const [updated] = await db.select().from(backgroundInsights).where(eq(backgroundInsights.id, id));
    res.json({ success: true, data: updated });
  }));

  app.post("/api/background-insights/generate", isAuthenticated, asyncHandler(async (req: any, res) => {
    const perms = await storage.getUserPermissions(req.user.id);
    if (!perms.some(p => p.name === "admin.manage_all")) {
      throw new AppError(403, "Admin access required", "FORBIDDEN");
    }

    const storeId = await resolveStoreId();
    if (!storeId) throw new AppError(400, "No store configured", "MISSING_STORE");

    runAllInsightGenerators(storeId).catch(err =>
      logger.error({ error: err.message }, "[BackgroundInsights] Manual generation failed")
    );

    res.json({ success: true, message: "Insight generation started" });
  }));
}
