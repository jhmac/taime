import type { Express } from "express";
import { z } from "zod";
import { db } from "../db";
import { eq, and, desc, sql, gte, lte, inArray } from "drizzle-orm";
import { operationalInsights, tasks } from "@shared/schema";
import { asyncHandler, AppError } from "../lib/routeWrapper";
import type { IStorage } from "../storage";
import { generateOperationalInsights } from "../services/insightGenerator";
import {
  aggregateOperations,
  summarizeForAI,
  computeActedOnOutcome,
} from "../services/operationsIntelligence";
import { cache } from "../services/cache";
import logger from "../lib/logger";
import { resolveStoreIdForUser, tryResolveStoreIdForUser } from "../services/storeResolver";
import { resolveAnyPermission } from "../services/permissionResolver";

async function requireManagerOrAbove(storage: IStorage, userId: string): Promise<boolean> {
  return resolveAnyPermission(
    userId,
    ["admin.manage_all", "manager.view_reports", "manager.manage_schedules"],
    storage,
  );
}

const SEVERITY_RANK = sql`CASE severity WHEN 'action_needed' THEN 1 WHEN 'warning' THEN 2 WHEN 'suggestion' THEN 3 ELSE 4 END`;

export function registerOperationalInsightRoutes(app: Express, storage: IStorage, isAuthenticated: any) {
  // ── Summary ───────────────────────────────────────────────────────────────
  app.get("/api/insights/operational/summary", isAuthenticated, asyncHandler(async (req: any, res) => {
    const isMgr = await requireManagerOrAbove(storage, req.user.id);
    if (!isMgr) throw new AppError(403, "Manager or above access required", "FORBIDDEN");

    const storeId = await tryResolveStoreIdForUser(req.user.id);
    if (!storeId) {
      return res.json({ success: true, data: { totalActive: 0, actionNeededCount: 0, byType: {}, byArea: {} } });
    }

    const cacheKey = `op-insights-summary:${storeId}`;
    const cached = cache.get<any>(cacheKey);
    if (cached) return res.json(cached);

    const rows = await db.select().from(operationalInsights).where(and(
      eq(operationalInsights.storeId, storeId),
      eq(operationalInsights.status, "active"),
    ));

    const byType: Record<string, number> = {};
    const byArea: Record<string, number> = {};
    let actionNeeded = 0;
    for (const r of rows) {
      byType[r.insightType] = (byType[r.insightType] || 0) + 1;
      byArea[r.affectedArea] = (byArea[r.affectedArea] || 0) + 1;
      if (r.severity === "action_needed") actionNeeded++;
    }

    const response = {
      success: true,
      data: { totalActive: rows.length, actionNeededCount: actionNeeded, byType, byArea },
    };
    cache.set(cacheKey, response, 3 * 60 * 1000);
    res.json(response);
  }));

  // ── List ──────────────────────────────────────────────────────────────────
  app.get("/api/insights/operational", isAuthenticated, asyncHandler(async (req: any, res) => {
    const isMgr = await requireManagerOrAbove(storage, req.user.id);
    if (!isMgr) throw new AppError(403, "Manager or above access required", "FORBIDDEN");

    const storeId = await tryResolveStoreIdForUser(req.user.id);
    if (!storeId) return res.json({ success: true, data: [] });

    const limit = Math.min(Math.max(parseInt(req.query.limit as string) || 30, 1), 100);
    const offset = Math.max(parseInt(req.query.offset as string) || 0, 0);
    const typeFilter = req.query.insight_type as string | undefined;
    const severityFilter = req.query.severity as string | undefined;
    const statusFilter = (req.query.status as string) || "active";
    const sinceParam = req.query.since as string | undefined;

    const conditions = [
      eq(operationalInsights.storeId, storeId),
      eq(operationalInsights.status, statusFilter),
    ];
    if (typeFilter) conditions.push(eq(operationalInsights.insightType, typeFilter));
    if (severityFilter) conditions.push(eq(operationalInsights.severity, severityFilter));
    if (sinceParam) {
      const since = new Date(sinceParam);
      if (!isNaN(since.getTime())) conditions.push(gte(operationalInsights.createdAt, since));
    }

    const rows = await db.select().from(operationalInsights)
      .where(and(...conditions))
      .orderBy(SEVERITY_RANK, desc(operationalInsights.createdAt))
      .limit(limit)
      .offset(offset);

    // For the "acted on" tab we close the loop by attaching the linked task's
    // current state and a 1-line outcome summary so owners can see what
    // actually changed since they pressed "Act on this".
    if (statusFilter === "acted_on" && rows.length > 0) {
      const linkedTaskIds = rows
        .map(r => r.linkedTaskId)
        .filter((id): id is string => !!id);

      const taskRows = linkedTaskIds.length > 0
        ? await db.select({
            id: tasks.id,
            title: tasks.title,
            status: tasks.status,
            assignedTo: tasks.assignedTo,
            completedAt: tasks.completedAt,
            createdAt: tasks.createdAt,
          }).from(tasks).where(inArray(tasks.id, linkedTaskIds))
        : [];
      const taskMap = new Map(taskRows.map(t => [t.id, t]));

      const enriched = await Promise.all(rows.map(async r => {
        const linkedTask = r.linkedTaskId ? taskMap.get(r.linkedTaskId) || null : null;
        const outcome = await computeActedOnOutcome(
          {
            storeId: r.storeId,
            affectedArea: r.affectedArea,
            insightType: r.insightType,
            actedOnAt: r.actedOnAt,
            dataPayload: r.dataPayload,
          },
          linkedTask
            ? {
                id: linkedTask.id,
                status: linkedTask.status as string | null,
                completedAt: linkedTask.completedAt,
                createdAt: linkedTask.createdAt,
              }
            : null,
        );
        return {
          ...r,
          linkedTask: linkedTask
            ? {
                id: linkedTask.id,
                title: linkedTask.title,
                status: linkedTask.status,
                assignedTo: linkedTask.assignedTo,
                completedAt: linkedTask.completedAt,
              }
            : null,
          outcomeSummary: outcome.summary,
          outcomeTaskStatus: outcome.taskStatus,
          daysSinceActedOn: outcome.daysSinceActedOn,
          daysToComplete: outcome.daysToComplete,
        };
      }));

      return res.json({ success: true, data: enriched });
    }

    res.json({ success: true, data: rows });
  }));

  // ── Dismiss ───────────────────────────────────────────────────────────────
  app.post("/api/insights/operational/:id/dismiss", isAuthenticated, asyncHandler(async (req: any, res) => {
    const isMgr = await requireManagerOrAbove(storage, req.user.id);
    if (!isMgr) throw new AppError(403, "Manager or above access required", "FORBIDDEN");

    const { id } = req.params;
    const body = z.object({ reason: z.string().max(500).optional() }).parse(req.body || {});

    const [insight] = await db.select().from(operationalInsights).where(eq(operationalInsights.id, id));
    if (!insight) throw new AppError(404, "Insight not found", "NOT_FOUND");

    const userStoreId = await tryResolveStoreIdForUser(req.user.id);
    if (!userStoreId || insight.storeId !== userStoreId) {
      throw new AppError(403, "Cross-store access denied", "FORBIDDEN");
    }

    const [updated] = await db.update(operationalInsights).set({
      status: "dismissed",
      dismissedBy: req.user.id,
      dismissedAt: new Date(),
      dismissReason: body.reason || null,
    }).where(eq(operationalInsights.id, id)).returning();

    cache.invalidatePrefix("op-insights-summary:");
    res.json({ success: true, data: updated });
  }));

  // ── Act on (creates linked task) ──────────────────────────────────────────
  app.post("/api/insights/operational/:id/act-on", isAuthenticated, asyncHandler(async (req: any, res) => {
    const isMgr = await requireManagerOrAbove(storage, req.user.id);
    if (!isMgr) throw new AppError(403, "Manager or above access required", "FORBIDDEN");

    const { id } = req.params;
    const body = z.object({
      taskTitle: z.string().min(1).max(255).optional(),
      taskDescription: z.string().max(2000).optional(),
      assignedTo: z.string().optional(),
      dueDate: z.string().datetime().optional(),
      priority: z.enum(["low", "medium", "high", "urgent"]).optional(),
    }).parse(req.body || {});

    const [insight] = await db.select().from(operationalInsights).where(eq(operationalInsights.id, id));
    if (!insight) throw new AppError(404, "Insight not found", "NOT_FOUND");

    const userStoreId = await tryResolveStoreIdForUser(req.user.id);
    if (!userStoreId || insight.storeId !== userStoreId) {
      throw new AppError(403, "Cross-store access denied", "FORBIDDEN");
    }

    const title = body.taskTitle || `[AI Insight] ${insight.observation.slice(0, 80)}`;
    const description = body.taskDescription
      || `AI Recommendation:\n${insight.recommendedAction}\n\nOriginal observation:\n${insight.observation}`;

    const [createdTask] = await db.insert(tasks).values({
      title: title.slice(0, 255),
      description,
      assignedTo: body.assignedTo || null,
      createdBy: req.user.id,
      locationId: insight.storeId,
      dueDate: body.dueDate ? new Date(body.dueDate) : null,
      status: "pending",
      priority: body.priority || "medium",
      isAIAssigned: true,
      aiReasoning: `Created from operational insight: ${insight.insightType} (${insight.affectedArea})`,
    }).returning();

    const [updated] = await db.update(operationalInsights).set({
      status: "acted_on",
      actedOnBy: req.user.id,
      actedOnAt: new Date(),
      linkedTaskId: createdTask.id,
    }).where(eq(operationalInsights.id, id)).returning();

    cache.invalidatePrefix("op-insights-summary:");
    res.json({ success: true, data: { insight: updated, task: createdTask } });
  }));

  // ── Manual regenerate ─────────────────────────────────────────────────────
  app.post("/api/insights/operational/regenerate", isAuthenticated, asyncHandler(async (req: any, res) => {
    const isMgr = await requireManagerOrAbove(storage, req.user.id);
    if (!isMgr) throw new AppError(403, "Manager or above access required", "FORBIDDEN");

    const storeId = await tryResolveStoreIdForUser(req.user.id);
    if (!storeId) throw new AppError(400, "No store configured", "MISSING_STORE");

    // Run async; respond immediately
    generateOperationalInsights(storeId).catch(err =>
      logger.error({ error: err.message, storeId }, "[OperationalInsights] Manual regenerate failed")
    );

    res.json({ success: true, message: "Insight regeneration started" });
  }));

  // ── Ops aggregate snapshot (used by Ask MAinager Ops mode + UI) ───────────
  app.get("/api/insights/operational/snapshot", isAuthenticated, asyncHandler(async (req: any, res) => {
    const isMgr = await requireManagerOrAbove(storage, req.user.id);
    if (!isMgr) throw new AppError(403, "Manager or above access required", "FORBIDDEN");

    const storeId = await tryResolveStoreIdForUser(req.user.id);
    if (!storeId) throw new AppError(400, "No store configured", "MISSING_STORE");

    const days = Math.min(Math.max(parseInt(req.query.days as string) || 14, 1), 90);

    const cacheKey = `op-insights-snapshot:${storeId}:${days}`;
    const cached = cache.get<any>(cacheKey);
    if (cached) return res.json(cached);

    const end = new Date();
    const start = new Date();
    start.setDate(start.getDate() - days);
    start.setHours(0, 0, 0, 0);

    const agg = await aggregateOperations(storeId, { start, end, label: `last ${days} days` });
    const response = { success: true, data: { aggregate: agg, summary: summarizeForAI(agg) } };
    cache.set(cacheKey, response, 5 * 60 * 1000);
    res.json(response);
  }));
}
