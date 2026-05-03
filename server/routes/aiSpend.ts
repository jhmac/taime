import type { Express } from "express";
import { z } from "zod";
import { db } from "../db";
import { aiUsageEvents, aiBudgets, aiBudgetAlerts, users, roles } from "@shared/schema";
import { and, eq, gte, sql, desc, isNull } from "drizzle-orm";
import { asyncHandler, AppError } from "../lib/routeWrapper";
import type { IStorage } from "../storage";
import { invalidateBudgetCache } from "../services/aiUsageTracker";
import { getRateSheet } from "../lib/aiPricing";

async function isOwnerOrAdmin(userId: string): Promise<boolean> {
  const [row] = await db
    .select({ roleName: roles.name })
    .from(users)
    .leftJoin(roles, eq(users.roleId, roles.id))
    .where(eq(users.id, userId));
  const name = row?.roleName?.toLowerCase();
  return name === "owner" || name === "admin";
}

function startOfMonthUtc(d: Date = new Date()): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
}
function startOfDayUtc(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

const budgetUpsertSchema = z.object({
  scope: z.enum(["global", "store"]),
  storeId: z.string().nullable().optional(),
  monthlyLimitUsd: z.number().nonnegative(),
  alertThresholdPercent: z.number().int().min(1).max(99).default(80),
  hardBlock: z.boolean().default(true),
  enabled: z.boolean().default(true),
});

export function registerAiSpendRoutes(app: Express, _storage: IStorage, isAuthenticated: any) {
  // Gate: owner or admin only
  const requireOwnerAdmin = async (req: any, _res: any, next: any) => {
    try {
      const ok = await isOwnerOrAdmin(req.user.id);
      if (!ok) return next(new AppError(403, "Owner or admin access required", "FORBIDDEN"));
      next();
    } catch (e) {
      next(e);
    }
  };

  // ── Summary: MTD spend, vs budget(s), projection, top breakdowns ──────────
  app.get("/api/ai-spend/summary", isAuthenticated, requireOwnerAdmin, asyncHandler(async (_req, res) => {
    const monthStart = startOfMonthUtc();
    const now = new Date();
    const daysElapsed = Math.max(1, Math.floor((now.getTime() - monthStart.getTime()) / 86_400_000) + 1);
    const monthEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
    const totalDaysInMonth = Math.round((monthEnd.getTime() - monthStart.getTime()) / 86_400_000);

    const [totals] = await db
      .select({
        totalUsd: sql<string>`COALESCE(SUM(CASE WHEN status='success' THEN cost_usd ELSE 0 END), 0)`,
        totalCalls: sql<string>`COUNT(*)`,
        totalSuccess: sql<string>`COUNT(*) FILTER (WHERE status='success')`,
        totalErrors: sql<string>`COUNT(*) FILTER (WHERE status='error')`,
        totalBlocked: sql<string>`COUNT(*) FILTER (WHERE status='blocked')`,
        totalInputTokens: sql<string>`COALESCE(SUM(input_tokens), 0)`,
        totalOutputTokens: sql<string>`COALESCE(SUM(output_tokens), 0)`,
      })
      .from(aiUsageEvents)
      .where(gte(aiUsageEvents.createdAt, monthStart));

    const mtdSpend = Number(totals?.totalUsd ?? 0);
    const projectedSpend = (mtdSpend / daysElapsed) * totalDaysInMonth;

    const byFeature = await db
      .select({
        feature: aiUsageEvents.feature,
        spend: sql<string>`COALESCE(SUM(CASE WHEN status='success' THEN cost_usd ELSE 0 END), 0)`,
        calls: sql<string>`COUNT(*)`,
      })
      .from(aiUsageEvents)
      .where(gte(aiUsageEvents.createdAt, monthStart))
      .groupBy(aiUsageEvents.feature)
      .orderBy(desc(sql`SUM(CASE WHEN status='success' THEN cost_usd ELSE 0 END)`))
      .limit(20);

    const byModel = await db
      .select({
        model: aiUsageEvents.model,
        provider: aiUsageEvents.provider,
        spend: sql<string>`COALESCE(SUM(CASE WHEN status='success' THEN cost_usd ELSE 0 END), 0)`,
        calls: sql<string>`COUNT(*)`,
        inputTokens: sql<string>`COALESCE(SUM(input_tokens), 0)`,
        outputTokens: sql<string>`COALESCE(SUM(output_tokens), 0)`,
      })
      .from(aiUsageEvents)
      .where(gte(aiUsageEvents.createdAt, monthStart))
      .groupBy(aiUsageEvents.model, aiUsageEvents.provider)
      .orderBy(desc(sql`SUM(CASE WHEN status='success' THEN cost_usd ELSE 0 END)`));

    const byStore = await db
      .select({
        storeId: aiUsageEvents.storeId,
        spend: sql<string>`COALESCE(SUM(CASE WHEN status='success' THEN cost_usd ELSE 0 END), 0)`,
        calls: sql<string>`COUNT(*)`,
      })
      .from(aiUsageEvents)
      .where(gte(aiUsageEvents.createdAt, monthStart))
      .groupBy(aiUsageEvents.storeId)
      .orderBy(desc(sql`SUM(CASE WHEN status='success' THEN cost_usd ELSE 0 END)`));

    const [bgVsUser] = await db
      .select({
        backgroundSpend: sql<string>`COALESCE(SUM(CASE WHEN status='success' AND is_background=true THEN cost_usd ELSE 0 END), 0)`,
        userSpend: sql<string>`COALESCE(SUM(CASE WHEN status='success' AND is_background=false THEN cost_usd ELSE 0 END), 0)`,
      })
      .from(aiUsageEvents)
      .where(gte(aiUsageEvents.createdAt, monthStart));

    const budgets = await db.select().from(aiBudgets);

    res.json({
      success: true,
      data: {
        period: {
          start: monthStart.toISOString(),
          daysElapsed,
          totalDaysInMonth,
        },
        totals: {
          mtdSpend,
          projectedSpend: Math.round(projectedSpend * 100) / 100,
          totalCalls: Number(totals?.totalCalls ?? 0),
          totalSuccess: Number(totals?.totalSuccess ?? 0),
          totalErrors: Number(totals?.totalErrors ?? 0),
          totalBlocked: Number(totals?.totalBlocked ?? 0),
          totalInputTokens: Number(totals?.totalInputTokens ?? 0),
          totalOutputTokens: Number(totals?.totalOutputTokens ?? 0),
        },
        backgroundVsUser: {
          backgroundSpend: Number(bgVsUser?.backgroundSpend ?? 0),
          userSpend: Number(bgVsUser?.userSpend ?? 0),
        },
        byFeature: byFeature.map((r) => ({ feature: r.feature, spend: Number(r.spend), calls: Number(r.calls) })),
        byModel: byModel.map((r) => ({
          model: r.model,
          provider: r.provider,
          spend: Number(r.spend),
          calls: Number(r.calls),
          inputTokens: Number(r.inputTokens),
          outputTokens: Number(r.outputTokens),
        })),
        byStore: byStore.map((r) => ({ storeId: r.storeId, spend: Number(r.spend), calls: Number(r.calls) })),
        budgets: budgets.map((b) => ({
          ...b,
          monthlyLimitUsd: Number(b.monthlyLimitUsd),
        })),
      },
    });
  }));

  // ── Daily timeseries for the past N days ───────────────────────────────────
  app.get("/api/ai-spend/timeseries", isAuthenticated, requireOwnerAdmin, asyncHandler(async (req, res) => {
    const days = Math.min(Math.max(parseInt(req.query.days as string) || 30, 1), 90);
    const since = startOfDayUtc(new Date(Date.now() - (days - 1) * 86_400_000));
    const rows = await db
      .select({
        day: sql<string>`DATE_TRUNC('day', created_at)::date::text`,
        spend: sql<string>`COALESCE(SUM(CASE WHEN status='success' THEN cost_usd ELSE 0 END), 0)`,
        calls: sql<string>`COUNT(*)`,
        provider: aiUsageEvents.provider,
      })
      .from(aiUsageEvents)
      .where(gte(aiUsageEvents.createdAt, since))
      .groupBy(sql`DATE_TRUNC('day', created_at)`, aiUsageEvents.provider)
      .orderBy(sql`DATE_TRUNC('day', created_at)`);

    res.json({
      success: true,
      data: rows.map((r) => ({ day: r.day, provider: r.provider, spend: Number(r.spend), calls: Number(r.calls) })),
    });
  }));

  // ── Recent events (paged) ──────────────────────────────────────────────────
  app.get("/api/ai-spend/events", isAuthenticated, requireOwnerAdmin, asyncHandler(async (req, res) => {
    const limit = Math.min(Math.max(parseInt(req.query.limit as string) || 50, 1), 200);
    const offset = Math.max(parseInt(req.query.offset as string) || 0, 0);
    const conds: any[] = [];
    if (req.query.feature) conds.push(eq(aiUsageEvents.feature, String(req.query.feature)));
    if (req.query.model) conds.push(eq(aiUsageEvents.model, String(req.query.model)));
    if (req.query.storeId) conds.push(eq(aiUsageEvents.storeId, String(req.query.storeId)));
    if (req.query.status) conds.push(eq(aiUsageEvents.status, String(req.query.status)));
    const where = conds.length ? and(...conds) : undefined;
    const rows = await db
      .select()
      .from(aiUsageEvents)
      .where(where as any)
      .orderBy(desc(aiUsageEvents.createdAt))
      .limit(limit)
      .offset(offset);
    res.json({ success: true, data: rows });
  }));

  // ── Budgets CRUD ───────────────────────────────────────────────────────────
  app.get("/api/ai-spend/budgets", isAuthenticated, requireOwnerAdmin, asyncHandler(async (_req, res) => {
    const rows = await db.select().from(aiBudgets);
    res.json({
      success: true,
      data: rows.map((b) => ({ ...b, monthlyLimitUsd: Number(b.monthlyLimitUsd) })),
    });
  }));

  app.post("/api/ai-spend/budgets", isAuthenticated, requireOwnerAdmin, asyncHandler(async (req, res) => {
    const parsed = budgetUpsertSchema.parse(req.body);
    if (parsed.scope === "store" && !parsed.storeId) {
      throw new AppError(400, "storeId required for store-scope budgets", "INVALID_REQUEST");
    }
    if (parsed.scope === "global") parsed.storeId = null;
    const [existing] = await db
      .select()
      .from(aiBudgets)
      .where(and(
        eq(aiBudgets.scope, parsed.scope),
        parsed.storeId ? eq(aiBudgets.storeId, parsed.storeId) : isNull(aiBudgets.storeId),
      ));
    let row;
    if (existing) {
      [row] = await db
        .update(aiBudgets)
        .set({
          monthlyLimitUsd: String(parsed.monthlyLimitUsd),
          alertThresholdPercent: parsed.alertThresholdPercent,
          hardBlock: parsed.hardBlock,
          enabled: parsed.enabled,
          updatedAt: new Date(),
        })
        .where(eq(aiBudgets.id, existing.id))
        .returning();
    } else {
      [row] = await db
        .insert(aiBudgets)
        .values({
          scope: parsed.scope,
          storeId: parsed.storeId ?? null,
          monthlyLimitUsd: String(parsed.monthlyLimitUsd),
          alertThresholdPercent: parsed.alertThresholdPercent,
          hardBlock: parsed.hardBlock,
          enabled: parsed.enabled,
        })
        .returning();
    }
    invalidateBudgetCache();
    res.json({ success: true, data: { ...row, monthlyLimitUsd: Number(row.monthlyLimitUsd) } });
  }));

  app.delete("/api/ai-spend/budgets/:id", isAuthenticated, requireOwnerAdmin, asyncHandler(async (req, res) => {
    // Clean up alert rows first so they don't orphan (no FK constraint exists).
    await db.delete(aiBudgetAlerts).where(eq(aiBudgetAlerts.budgetId, req.params.id));
    await db.delete(aiBudgets).where(eq(aiBudgets.id, req.params.id));
    invalidateBudgetCache();
    res.json({ success: true });
  }));

  // ── Alerts log (recent threshold crossings) ────────────────────────────────
  app.get("/api/ai-spend/alerts", isAuthenticated, requireOwnerAdmin, asyncHandler(async (_req, res) => {
    const rows = await db
      .select()
      .from(aiBudgetAlerts)
      .orderBy(desc(aiBudgetAlerts.sentAt))
      .limit(50);
    res.json({ success: true, data: rows });
  }));

  // ── Static rate sheet (for "Why this cost?" UI) ────────────────────────────
  app.get("/api/ai-spend/rates", isAuthenticated, requireOwnerAdmin, asyncHandler(async (_req, res) => {
    res.json({ success: true, data: getRateSheet() });
  }));
}
