import { db } from "../db";
import { aiUsageEvents, aiBudgets, aiBudgetAlerts } from "@shared/schema";
import type { InsertAiUsageEvent, AiBudget } from "@shared/schema";
import { and, eq, gte, isNull, sql } from "drizzle-orm";
import logger from "../lib/logger";
import { sendBudgetAlertEmail } from "./aiBudgetAlertEmail";

export class BudgetExceededError extends Error {
  scope: "global" | "store";
  storeId: string | null;
  spendUsd: number;
  limitUsd: number;
  constructor(scope: "global" | "store", storeId: string | null, spendUsd: number, limitUsd: number) {
    const where = scope === "global" ? "Global AI budget" : `AI budget for store ${storeId}`;
    super(`${where} exceeded: $${spendUsd.toFixed(2)} of $${limitUsd.toFixed(2)} this month. Increase the budget on the AI Spend admin page or wait until next month.`);
    this.name = "BudgetExceededError";
    this.scope = scope;
    this.storeId = storeId;
    this.spendUsd = spendUsd;
    this.limitUsd = limitUsd;
  }
}

// ── In-memory caches (per-process, short TTL) ────────────────────────────────
// Budgets change rarely; spend changes constantly.
// We invalidate the spend cache on every insert so over-budget detection is sharp.
type Scope = "global" | "store";

interface BudgetCacheEntry { rows: AiBudget[]; expiresAt: number; }
const BUDGET_CACHE_TTL_MS = 60_000;
let globalBudgetCache: BudgetCacheEntry | null = null;
const storeBudgetCache = new Map<string, BudgetCacheEntry>();

interface SpendCacheEntry { spendUsd: number; expiresAt: number; }
const SPEND_CACHE_TTL_MS = 30_000;
let globalSpendCache: SpendCacheEntry | null = null;
const storeSpendCache = new Map<string, SpendCacheEntry>();

function invalidateSpendCache(storeId: string | null) {
  globalSpendCache = null;
  if (storeId) storeSpendCache.delete(storeId);
}

export function invalidateBudgetCache(scope?: Scope, storeId?: string | null) {
  if (!scope) {
    globalBudgetCache = null;
    storeBudgetCache.clear();
    return;
  }
  if (scope === "global") globalBudgetCache = null;
  else if (storeId) storeBudgetCache.delete(storeId);
  else storeBudgetCache.clear();
}

function periodKey(d: Date = new Date()): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

function startOfMonthUtc(d: Date = new Date()): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
}

async function loadGlobalBudget(): Promise<AiBudget | null> {
  const now = Date.now();
  if (globalBudgetCache && globalBudgetCache.expiresAt > now) {
    return globalBudgetCache.rows[0] ?? null;
  }
  const rows = await db
    .select()
    .from(aiBudgets)
    .where(and(eq(aiBudgets.scope, "global"), isNull(aiBudgets.storeId)));
  globalBudgetCache = { rows, expiresAt: now + BUDGET_CACHE_TTL_MS };
  return rows[0] ?? null;
}

async function loadStoreBudget(storeId: string): Promise<AiBudget | null> {
  const now = Date.now();
  const cached = storeBudgetCache.get(storeId);
  if (cached && cached.expiresAt > now) return cached.rows[0] ?? null;
  const rows = await db
    .select()
    .from(aiBudgets)
    .where(and(eq(aiBudgets.scope, "store"), eq(aiBudgets.storeId, storeId)));
  storeBudgetCache.set(storeId, { rows, expiresAt: now + BUDGET_CACHE_TTL_MS });
  return rows[0] ?? null;
}

async function loadMtdSpend(scope: Scope, storeId: string | null): Promise<number> {
  const now = Date.now();
  if (scope === "global") {
    if (globalSpendCache && globalSpendCache.expiresAt > now) return globalSpendCache.spendUsd;
  } else {
    const cached = storeSpendCache.get(storeId!);
    if (cached && cached.expiresAt > now) return cached.spendUsd;
  }
  const since = startOfMonthUtc();
  const conds = [gte(aiUsageEvents.createdAt, since), eq(aiUsageEvents.status, "success")];
  if (scope === "store") conds.push(eq(aiUsageEvents.storeId, storeId!));
  const [row] = await db
    .select({ total: sql<string>`COALESCE(SUM(${aiUsageEvents.costUsd}), 0)` })
    .from(aiUsageEvents)
    .where(and(...conds));
  const spend = Number(row?.total ?? 0);
  if (scope === "global") {
    globalSpendCache = { spendUsd: spend, expiresAt: now + SPEND_CACHE_TTL_MS };
  } else {
    storeSpendCache.set(storeId!, { spendUsd: spend, expiresAt: now + SPEND_CACHE_TTL_MS });
  }
  return spend;
}

/**
 * Pre-flight budget check. Throws BudgetExceededError if any applicable budget
 * is at or over 100% of its monthlyLimitUsd for the current month.
 *
 * Hard-block is gated by budget.hardBlock=true. If hardBlock=false the budget
 * is treated as alert-only and won't throw.
 */
export async function assertBudgets(storeId: string | null | undefined): Promise<void> {
  // Two layers of error handling:
  //  - BudgetExceededError MUST propagate (intentional hard-block).
  //  - Any other error (DB down, schema missing, etc.) MUST be swallowed —
  //    we never want a broken tracker to block live AI calls.
  let globalBudget: AiBudget | null = null;
  try { globalBudget = await loadGlobalBudget(); } catch (err) {
    logger.error({ err }, "AI tracker: failed to load global budget — skipping budget check");
    return;
  }
  if (globalBudget?.enabled && globalBudget.hardBlock) {
    const spend = await loadMtdSpend("global", null).catch(() => 0);
    const limit = Number(globalBudget.monthlyLimitUsd);
    if (spend >= limit) {
      throw new BudgetExceededError("global", null, spend, limit);
    }
  }
  if (storeId) {
    let storeBudget: AiBudget | null = null;
    try { storeBudget = await loadStoreBudget(storeId); } catch { return; }
    if (storeBudget?.enabled && storeBudget.hardBlock) {
      const spend = await loadMtdSpend("store", storeId).catch(() => 0);
      const limit = Number(storeBudget.monthlyLimitUsd);
      if (spend >= limit) {
        throw new BudgetExceededError("store", storeId, spend, limit);
      }
    }
  }
}

/**
 * Insert one usage event. Fire-and-forget by callers — we still await to keep
 * cost accounting accurate, but errors here are swallowed so a broken tracker
 * never breaks the upstream AI call.
 */
export async function recordUsageEvent(event: InsertAiUsageEvent): Promise<void> {
  try {
    await db.insert(aiUsageEvents).values(event);
    if (event.status === "success" && Number(event.costUsd) > 0) {
      invalidateSpendCache(event.storeId ?? null);
      // Threshold checks run async — never block the caller.
      void checkAndFireAlerts(event.storeId ?? null).catch((err) =>
        logger.error({ err }, "AI budget alert check failed"),
      );
    }
  } catch (err) {
    logger.error({ err, feature: event.feature }, "AI usage event insert failed");
  }
}

/**
 * After a successful chargeable call, see whether any budget just crossed an
 * 80% (warning) or 100% (limit) threshold this period. If so, send the email
 * once per (budget, period, threshold).
 */
async function checkAndFireAlerts(storeId: string | null): Promise<void> {
  const period = periodKey();
  const targets: Array<{ budget: AiBudget; spend: number }> = [];
  const globalBudget = await loadGlobalBudget();
  if (globalBudget?.enabled) {
    targets.push({ budget: globalBudget, spend: await loadMtdSpend("global", null) });
  }
  if (storeId) {
    const storeBudget = await loadStoreBudget(storeId);
    if (storeBudget?.enabled) {
      targets.push({ budget: storeBudget, spend: await loadMtdSpend("store", storeId) });
    }
  }
  for (const { budget, spend } of targets) {
    const limit = Number(budget.monthlyLimitUsd);
    if (limit <= 0) continue;
    const pct = (spend / limit) * 100;
    const thresholdsCrossed: number[] = [];
    if (pct >= budget.alertThresholdPercent) thresholdsCrossed.push(budget.alertThresholdPercent);
    if (pct >= 100) thresholdsCrossed.push(100);
    for (const threshold of thresholdsCrossed) {
      try {
        await db.insert(aiBudgetAlerts).values({
          budgetId: budget.id,
          periodKey: period,
          thresholdPercent: threshold,
          spendAtAlert: String(spend),
        });
        // First time this (budget,period,threshold) ever inserted — fire email.
        await sendBudgetAlertEmail(budget, threshold, spend, limit, period).catch((err) =>
          logger.error({ err, budgetId: budget.id, threshold }, "AI budget alert email failed"),
        );
        logger.warn(
          { scope: budget.scope, storeId: budget.storeId, threshold, spend, limit },
          "AI budget threshold crossed",
        );
      } catch {
        // Unique constraint hit ⇒ already alerted for this period+threshold. Skip silently.
      }
    }
  }
}
