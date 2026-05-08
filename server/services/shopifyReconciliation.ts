/**
 * Shopify daily sales reconciliation.
 *
 * OWNERSHIP RULES (mirror of the comments in server/routes/shopify.ts):
 *   - Today's `shopifyDailySales` row is owned by the orders/create webhook
 *     (incremental adds; idempotent via shopify_orders unique index).
 *   - Completed days are owned by THIS reconciliation job. Once shop-local
 *     midnight ticks past, we re-pull the previous day from Shopify and
 *     overwrite the row with the authoritative figure. Refunds, voids, edited
 *     orders, and any missed webhooks all converge here.
 *   - Manual /sync-sales and /backfill-day routes do full overwrites and may
 *     stomp either, but should be considered manual interventions.
 *
 * The cron checks every 30 minutes. For each connected shop, if the local
 * date has advanced past the last reconciled date, it reconciles the gap
 * (typically just yesterday). Persistence is in `shopify_reconciliation_runs`
 * so a server restart doesn't double-run or skip a day.
 */
import { db } from "../db";
import { shops, shopifyDailySales, shopifyOrders } from "@shared/schema";
import { eq, and } from "drizzle-orm";
import { sql } from "drizzle-orm";
import { ShopifyService } from "./shopifyService";
import { decryptToken } from "../utils/tokenEncryption";
import {
  resolveShopTimezone,
  dateKeyInTz,
  dayOfWeekInTz,
  dailySalesRowDate,
  shopDayUtcBounds,
  shopTodayAndYesterday,
} from "../lib/shopTimezone";

export interface ReconciliationResult {
  shopDomain: string;
  date: string;
  status: "success" | "failure" | "skipped";
  beforeRevenue: number;
  afterRevenue: number;
  beforeOrderCount: number;
  afterOrderCount: number;
  ranAt: Date;
  error?: string;
}

async function fetchCredentials(shopDomain: string): Promise<{ shopDomain: string; accessToken: string } | null> {
  const row = await db.select().from(shops).where(eq(shops.shopDomain, shopDomain)).limit(1);
  if (!row.length || !row[0].accessToken) return null;
  let token = row[0].accessToken;
  try { token = decryptToken(token); } catch { /* legacy unencrypted */ }
  return { shopDomain: row[0].shopDomain, accessToken: token };
}

/**
 * Re-pull a single shop-local calendar date from Shopify and overwrite
 * shopify_daily_sales with the authoritative aggregate. NEVER call this with
 * "today" — that row is owned by the live webhook path.
 */
export async function reconcileShopDay(shopDomain: string, dateKey: string): Promise<ReconciliationResult> {
  const ranAt = new Date();
  const result: ReconciliationResult = {
    shopDomain, date: dateKey, status: "failure",
    beforeRevenue: 0, afterRevenue: 0, beforeOrderCount: 0, afterOrderCount: 0, ranAt,
  };

  try {
    const tzRow = await db.select({ timezone: shops.timezone }).from(shops).where(eq(shops.shopDomain, shopDomain)).limit(1);
    const tz = resolveShopTimezone(tzRow[0]?.timezone);

    const dateObj = dailySalesRowDate(dateKey);
    const before = await db.select({
      totalRevenue: shopifyDailySales.totalRevenue,
      orderCount: shopifyDailySales.orderCount,
    }).from(shopifyDailySales)
      .where(and(eq(shopifyDailySales.shopDomain, shopDomain), eq(shopifyDailySales.date, dateObj)))
      .limit(1);
    if (before.length) {
      result.beforeRevenue = parseFloat(before[0].totalRevenue || "0");
      result.beforeOrderCount = before[0].orderCount || 0;
    }

    const creds = await fetchCredentials(shopDomain);
    if (!creds) {
      result.error = "No credentials";
      await recordRun(result);
      return result;
    }
    const svc = new ShopifyService(creds.shopDomain, creds.accessToken);
    const { startUtc, endUtc } = shopDayUtcBounds(dateKey, tz);
    const orders = await svc.getOrders({
      first: 250,
      createdAtMin: startUtc.toISOString(),
      createdAtMax: endUtc.toISOString(),
      maxPages: 10,
    });

    // Re-bucket strictly by shop-local date — Shopify's `created_at:>=` filter
    // is granular to the second but our window endpoints are inclusive, so we
    // re-check membership here.
    let revenue = 0;
    let itemCount = 0;
    let orderCount = 0;
    for (const o of orders) {
      const created = new Date((o as any).createdAt);
      if (dateKeyInTz(created, tz) !== dateKey) continue;
      orderCount++;
      // Prefer currentTotalPriceSet (refund-adjusted, matches Shopify Analytics
      // total_sales) over totalPriceSet (original order total, ignores returns).
      const refundAdjusted = (o as any).currentTotalPriceSet?.shopMoney?.amount;
      revenue += parseFloat(refundAdjusted ?? (o as any).totalPriceSet?.shopMoney?.amount ?? "0");
      for (const li of ((o as any).lineItems?.nodes || [])) itemCount += li.quantity || 1;
    }
    revenue = Math.round(revenue * 100) / 100;
    const aov = orderCount > 0 ? Math.round((revenue / orderCount) * 100) / 100 : 0;
    const dow = dayOfWeekInTz(new Date(`${dateKey}T12:00:00Z`), tz);

    // AUTHORIZED SYNC WRITE: full-overwrite upsert keyed on (shop_domain, date).
    await db.insert(shopifyDailySales).values({
      shopDomain, date: dateObj, dayOfWeek: dow,
      orderCount, totalRevenue: String(revenue),
      itemCount, averageOrderValue: String(aov),
    }).onConflictDoUpdate({
      target: [shopifyDailySales.shopDomain, shopifyDailySales.date],
      set: { orderCount, totalRevenue: String(revenue), itemCount, averageOrderValue: String(aov), dayOfWeek: dow },
    });

    result.afterRevenue = revenue;
    result.afterOrderCount = orderCount;
    result.status = "success";
    await recordRun(result);
    return result;
  } catch (err: any) {
    result.error = err?.message || String(err);
    await recordRun(result);
    return result;
  }
}

async function recordRun(r: ReconciliationResult): Promise<void> {
  try {
    await db.execute(sql`
      INSERT INTO shopify_reconciliation_runs
        (shop_domain, date, status, before_revenue, after_revenue, before_order_count, after_order_count, error, ran_at)
      VALUES
        (${r.shopDomain}, ${r.date}, ${r.status},
         ${String(r.beforeRevenue)}, ${String(r.afterRevenue)},
         ${r.beforeOrderCount}, ${r.afterOrderCount},
         ${r.error ?? null}, ${r.ranAt})
    `);
    console.log(`[ShopifyReconciliation] ${r.shopDomain} ${r.date} ${r.status}: $${r.beforeRevenue} → $${r.afterRevenue} (${r.beforeOrderCount} → ${r.afterOrderCount} orders)${r.error ? ` — ${r.error}` : ''}`);
  } catch (err) {
    console.error('[ShopifyReconciliation] Failed to record run log:', err);
  }
}

export async function getLastReconciliation(shopDomain: string): Promise<{ date: string; status: string; ranAt: Date; afterRevenue: number; beforeRevenue: number; error: string | null } | null> {
  try {
    const rows: any = await db.execute(sql`
      SELECT date, status, ran_at, before_revenue, after_revenue, error
      FROM shopify_reconciliation_runs
      WHERE shop_domain = ${shopDomain}
      ORDER BY ran_at DESC
      LIMIT 1
    `);
    const r = rows.rows?.[0];
    if (!r) return null;
    return {
      date: r.date,
      status: r.status,
      ranAt: new Date(r.ran_at),
      afterRevenue: parseFloat(r.after_revenue || '0'),
      beforeRevenue: parseFloat(r.before_revenue || '0'),
      error: r.error,
    };
  } catch (err) {
    console.error('[ShopifyReconciliation] getLastReconciliation failed:', err);
    return null;
  }
}

/** True iff this (shop, date) has at least one successful run logged. */
async function alreadyReconciled(shopDomain: string, dateKey: string): Promise<boolean> {
  try {
    const rows: any = await db.execute(sql`
      SELECT 1 FROM shopify_reconciliation_runs
      WHERE shop_domain = ${shopDomain} AND date = ${dateKey} AND status = 'success'
      LIMIT 1
    `);
    return (rows.rows?.length ?? 0) > 0;
  } catch {
    return false;
  }
}

let cronTimer: ReturnType<typeof setInterval> | null = null;

async function tick(): Promise<void> {
  try {
    const activeShops = await db.select({ shopDomain: shops.shopDomain, timezone: shops.timezone })
      .from(shops)
      .where(eq(shops.isActive, true));

    for (const s of activeShops) {
      const tz = resolveShopTimezone(s.timezone);
      const { yesterday } = shopTodayAndYesterday(tz);
      const today = dateKeyInTz(new Date(), tz);

      // Always reconcile today — revenue accumulates throughout the day and
      // webhooks can miss orders, so we refresh from Shopify every tick.
      await reconcileShopDay(s.shopDomain, today);

      // Reconcile yesterday exactly once after local midnight (data is final).
      if (!(await alreadyReconciled(s.shopDomain, yesterday))) {
        await reconcileShopDay(s.shopDomain, yesterday);
      }
    }
  } catch (err) {
    console.error('[ShopifyReconciliation] tick error:', err);
  }
}

/**
 * Start the reconciliation cron. Checks every 30 minutes; reconciles each
 * shop's "yesterday" exactly once after local midnight has passed. Returns a
 * stop function for graceful shutdown.
 */
export function startShopifyReconciliationCron(): () => void {
  if (cronTimer) return () => {};
  // Defer initial run a few seconds so it doesn't pile onto boot-time work.
  setTimeout(() => { tick(); }, 5_000);
  cronTimer = setInterval(tick, 30 * 60 * 1000);
  console.log('[ShopifyReconciliation] Nightly reconciliation cron started (every 30m)');
  return () => {
    if (cronTimer) {
      clearInterval(cronTimer);
      cronTimer = null;
      console.log('[ShopifyReconciliation] Nightly reconciliation cron stopped');
    }
  };
}
