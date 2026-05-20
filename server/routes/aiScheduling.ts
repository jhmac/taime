import type { Express } from "express";
import type { IStorage } from "../storage";
import { aiSchedulingSettings, aiSchedulingRules, specialCircumstances, shopifyDailySales, shopifyOrders, users, userAvailability, availabilityTemplates, schedules, shops, userShops, roles, workPatternTemplates, userWorkPatterns, clockEvents, workLocations, aiSuggestedSchedules, shopifyRegisterSessions } from "@shared/schema";
import { eq, and, gte, lte, lt, gt, desc, inArray, sql, count, isNull, or } from "drizzle-orm";
import { db } from "../db";
import { anthropic, withAiContext } from "../lib/aiClients";
import rateLimit from "express-rate-limit";
import { ShopifyService } from "../services/shopifyService";
import { decryptToken } from "../utils/tokenEncryption";

import { config } from "../lib/config";
import { sameWeekdayLastYear } from "../lib/dateUtils";
import {
  applyShiftOverlap,
  calculateOverlapLaborCost,
  checkBudgetThreshold,
  calculateDailyLaborCost,
  checkDailyLaborCostThresholds,
} from "../lib/shiftOverlap";
import { computeScheduleStoreRecipients } from "../lib/broadcastRecipients";
import logger from "../lib/logger";
import { resolvePermission, resolveAnyPermission } from "../services/permissionResolver";
import { tryResolveStoreIdForUser } from "../services/storeResolver";
import { hasEntitlement } from "../services/entitlements";

// Typed params shape for AI scheduling rules — avoids `as any` in prompt generation
interface AiRuleParams {
  count?: number;
  classification?: string;
  text?: string;
}

const aiRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  message: { message: "Too many AI scheduling requests, please try again later" },
});

/**
 * Returns the local hour (0-23) for a UTC timestamp in the given IANA timezone.
 * Falls back to UTC hours if the timezone is invalid.
 */
function getLocalHourInTz(timestamp: Date, timezone: string): number {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      hour: 'numeric',
      hour12: false,
    }).formatToParts(timestamp);
    const h = parts.find(p => p.type === 'hour')?.value;
    return parseInt(h ?? '0', 10) % 24;
  } catch {
    return timestamp.getUTCHours();
  }
}

/**
 * Returns minutes-since-local-midnight (0..1439) for a UTC timestamp in the
 * given IANA timezone. Falls back to UTC hours/minutes if the timezone is
 * invalid. Useful for comparing against store open/close times like "09:30".
 */
function getLocalMinutesInTz(timestamp: Date, timezone: string): number {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).formatToParts(timestamp);
    const h = parseInt(parts.find(p => p.type === 'hour')?.value ?? '0', 10) % 24;
    const m = parseInt(parts.find(p => p.type === 'minute')?.value ?? '0', 10);
    return h * 60 + m;
  } catch {
    return timestamp.getUTCHours() * 60 + timestamp.getUTCMinutes();
  }
}

/**
 * Returns the local day-of-week (0=Sun..6=Sat) for a UTC timestamp in the
 * given IANA timezone. Falls back to the UTC day if the timezone is invalid.
 */
function getLocalDayOfWeekInTz(timestamp: Date, timezone: string): number {
  try {
    const wk = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      weekday: 'short',
    }).format(timestamp);
    const map: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
    return map[wk] ?? timestamp.getUTCDay();
  } catch {
    return timestamp.getUTCDay();
  }
}

/**
 * Returns the timezone offset for a given UTC instant in a given IANA tz,
 * in minutes east of UTC (positive east, negative west). Handles DST
 * automatically because the offset is computed at the supplied instant.
 *
 * Example: For "America/Chicago" on a CDT date, returns -300; on a CST
 * date returns -360.
 */
function getTimezoneOffsetMinutes(date: Date, timezone: string): number {
  try {
    const dtf = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    });
    const parts = dtf.formatToParts(date);
    const get = (t: string) => parseInt(parts.find(p => p.type === t)?.value ?? '0', 10);
    const y = get('year');
    const mo = get('month');
    const d = get('day');
    const h = get('hour') % 24;
    const mi = get('minute');
    const s = get('second');
    const localAsUtc = Date.UTC(y, mo - 1, d, h, mi, s);
    return Math.round((localAsUtc - date.getTime()) / 60000);
  } catch {
    return 0;
  }
}

/**
 * For a calendar day expressed as YYYY-MM-DD in `timezone`, returns the
 * UTC instants that bracket that local day (start = local-midnight in UTC,
 * end = next local-midnight in UTC, exclusive end).
 *
 * Critical for accurate "daily sales" lookups against Shopify orders:
 * a UTC-only window of `T00:00:00Z .. T23:59:59Z` for a CST/CDT store
 * misses 5–6 hours of evening orders (which fall into the next UTC day)
 * and incorrectly includes 5–6 hours of the previous evening, dramatically
 * understating any single-day revenue figure.
 */
function localDayBoundsUtc(dateStr: string, timezone: string): { start: Date; endExclusive: Date } {
  // Pick noon UTC on the target date as a stable reference instant for
  // computing the offset (well away from DST jump hours).
  const reference = new Date(`${dateStr}T12:00:00Z`);
  const offsetMinutes = getTimezoneOffsetMinutes(reference, timezone);
  // local-midnight = UTC midnight - offset (in ms). For CDT (-300):
  // local-00:00 on a date is 05:00 UTC.
  const utcMidnight = Date.UTC(
    reference.getUTCFullYear(),
    reference.getUTCMonth(),
    reference.getUTCDate(),
    0, 0, 0,
  );
  const start = new Date(utcMidnight - offsetMinutes * 60 * 1000);
  const endExclusive = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return { start, endExclusive };
}

/**
 * Parse a YYYY-MM-DD string as a UTC midnight Date. Returns null if the string
 * is malformed or yields an invalid date. Use this everywhere we accept
 * `startDate`/`endDate` in request bodies so that day-iteration math
 * (`getUTCDay`, `setUTCDate`) and DB date predicates stay timezone-stable.
 */
function parseDateOnlyUtc(s: unknown): Date | null {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d = new Date(`${s}T00:00:00.000Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

function findClosestDayOfWeekDate(targetDate: Date, salesDates: Array<{ date: Date; dayOfWeek: number; totalRevenue: string }>): { date: Date; totalRevenue: string } | null {
  // Use UTC day-of-week so this matches callers that build dates with Date.UTC().
  // Using local getDay() here previously caused weekday off-by-one matches in
  // non-UTC server timezones, returning revenue from the wrong weekday.
  const targetDow = targetDate.getUTCDay();

  // Anchor at exactly 52 weeks back so the closest-match search centres on the
  // correct week rather than the same calendar date (which shifts the weekday).
  const lastYearApprox = sameWeekdayLastYear(targetDate);

  const sameDowDates = salesDates.filter(s => s.dayOfWeek === targetDow);
  if (sameDowDates.length === 0) return null;

  let closest = sameDowDates[0];
  let closestDiff = Math.abs(sameDowDates[0].date.getTime() - lastYearApprox.getTime());

  for (const entry of sameDowDates) {
    const diff = Math.abs(entry.date.getTime() - lastYearApprox.getTime());
    if (diff < closestDiff) {
      closest = entry;
      closestDiff = diff;
    }
  }

  return { date: closest.date, totalRevenue: closest.totalRevenue };
}

function getStaffingForRevenue(revenue: number, tiers: Array<{ minRevenue: number; maxRevenue: number; employeeCount: number }>, minimumStaffing: number): number {
  if (!tiers || tiers.length === 0) return minimumStaffing;

  for (const tier of tiers) {
    if (revenue >= tier.minRevenue && revenue <= tier.maxRevenue) {
      return Math.max(tier.employeeCount, minimumStaffing);
    }
  }

  const sortedTiers = [...tiers].sort((a, b) => b.maxRevenue - a.maxRevenue);
  if (revenue > sortedTiers[0].maxRevenue) {
    return Math.max(sortedTiers[0].employeeCount, minimumStaffing);
  }

  return minimumStaffing;
}

// ── Shopify helpers (shared across suggest + backfill-day) ────────────────────

async function getShopCredentialsForUser(userId: string): Promise<{ shopDomain: string; accessToken: string; service: ShopifyService } | null> {
  const links = await db.select({ shopDomain: userShops.shopDomain })
    .from(userShops).where(eq(userShops.userId, userId)).limit(1);
  const shopDomain = links[0]?.shopDomain;
  if (!shopDomain) return null;

  const shopRows = await db.select({ shopDomain: shops.shopDomain, accessToken: shops.accessToken })
    .from(shops).where(eq(shops.shopDomain, shopDomain)).limit(1);
  if (!shopRows[0]?.accessToken) return null;

  let token = shopRows[0].accessToken;
  try { token = decryptToken(token); } catch { /* not encrypted */ }

  return { shopDomain: shopRows[0].shopDomain, accessToken: token, service: new ShopifyService(shopRows[0].shopDomain, token) };
}

/**
 * Fetches orders from Shopify GraphQL for a specific calendar date,
 * upserts each order into shopify_orders (preserving per-hour timestamps),
 * and upserts the daily aggregate into shopify_daily_sales.
 * Returns { ordersFound, dayRevenue }.
 */
async function backfillDayOrdersFromShopify(
  shopDomain: string,
  service: ShopifyService,
  dateStr: string,
  storeTimezone: string = 'UTC',
): Promise<{ ordersFound: number; dayRevenue: number }> {
  // Use the store's local calendar day to bracket the Shopify query.
  // A naive `${dateStr}T00:00:00Z .. T23:59:59Z` window for a CST/CDT store
  // misses ~5–6 hours of evening orders (which fall into the next UTC day),
  // and that partial total then gets cached as the "authoritative net" —
  // exactly the cause of the $94 figure on the projected-revenue card.
  const { start: startBound, endExclusive: endBound } = localDayBoundsUtc(dateStr, storeTimezone);
  const startIso = startBound.toISOString();
  // Shopify's createdAtMax is inclusive; subtract 1ms so we don't pull the
  // first order of the *next* local day into this bucket.
  const endIso = new Date(endBound.getTime() - 1).toISOString();

  const orders = await service.getOrders({
    first: 250,
    createdAtMin: startIso,
    createdAtMax: endIso,
    maxPages: 5,
  });

  if (orders.length === 0) return { ordersFound: 0, dayRevenue: 0 };

  let dayRevenue = 0;
  let itemCount  = 0;

  for (const order of orders) {
    const rawId = order.id ?? '';
    // Shopify uses "gid://shopify/Order/1234567890" — extract the numeric part as orderId
    const orderId = rawId.includes('/') ? rawId.split('/').pop()! : rawId;
    const orderPrice = parseFloat(order.totalPriceSet?.shopMoney?.amount ?? '0');
    dayRevenue += orderPrice;
    const lineItems = order.lineItems?.nodes ?? [];
    for (const li of lineItems) itemCount += li.quantity || 1;
    const orderCreatedAt = order.createdAt ? new Date(order.createdAt) : new Date(startIso);

    // Atomic upsert keyed on (shop_domain, order_id) — see uq_shopify_orders_shop_order.
    // The previous select-then-insert pattern wasn't atomic and let two
    // concurrent backfills both miss the row, both insert, and end up with
    // duplicate per-order rows that the daily aggregate then summed.
    await db.insert(shopifyOrders)
      .values({
        shopDomain,
        orderId,
        orderNumber: (order as any).name ?? null,
        totalPrice: String(Math.round(orderPrice * 100) / 100),
        currency: order.totalPriceSet?.shopMoney?.currencyCode ?? 'USD',
        financialStatus: (order as any).displayFinancialStatus ?? null,
        fulfillmentStatus: (order as any).displayFulfillmentStatus ?? null,
        lineItems: lineItems as any,
        customerData: null,
        orderCreatedAt,
      })
      .onConflictDoUpdate({
        target: [shopifyOrders.shopDomain, shopifyOrders.orderId],
        set: {
          totalPrice: String(Math.round(orderPrice * 100) / 100),
          financialStatus: (order as any).displayFinancialStatus ?? null,
          fulfillmentStatus: (order as any).displayFulfillmentStatus ?? null,
          lineItems: lineItems as any,
          orderCreatedAt,
          updatedAt: new Date(),
        },
      });
  }

  // Atomic upsert daily aggregate, keyed on (shop_domain, date) — see
  // uq_shopify_daily_sales_shop_date.
  const dateObj = new Date(`${dateStr}T00:00:00Z`);
  const dayOfWeek = dateObj.getUTCDay();
  const avgOrderValue = orders.length > 0 ? Math.round((dayRevenue / orders.length) * 100) / 100 : 0;

  // AUTHORIZED SYNC WRITE: totalRevenue may only be set here (Shopify ingestion path).
  await db.insert(shopifyDailySales)
    .values({
      shopDomain,
      date: dateObj,
      dayOfWeek,
      orderCount: orders.length,
      totalRevenue: String(Math.round(dayRevenue * 100) / 100),
      itemCount,
      averageOrderValue: String(avgOrderValue),
    })
    .onConflictDoUpdate({
      target: [shopifyDailySales.shopDomain, shopifyDailySales.date],
      set: {
        orderCount: orders.length,
        totalRevenue: String(Math.round(dayRevenue * 100) / 100),
        itemCount,
        averageOrderValue: String(avgOrderValue),
        dayOfWeek,
      },
    });

  return { ordersFound: orders.length, dayRevenue: Math.round(dayRevenue * 100) / 100 };
}

/**
 * Resolves the store_id that an /api/ai-scheduling/settings request applies
 * to. Defaults to the requester's own store. If a `storeId` is explicitly
 * passed in (chains with multiple stores), we authorize the requester for
 * that store before returning it — never trust an admin's claim that they
 * "manage" an arbitrary work_location id.
 *
 * Authorization rules for an explicit storeId:
 *   1. If it matches the requester's own users.locationId, allow.
 *   2. Otherwise the work_location must belong to the requester's company.
 *      work_locations has no companyId column today, so we infer ownership
 *      from users: a store belongs to the requester's company iff some user
 *      with the same companyId has locationId = requested. The store must
 *      also be active.
 *   3. If neither holds, return null so the route can return 403/400. We do
 *      NOT fall back to "any active store" — that would be a cross-tenant
 *      IDOR.
 */
async function resolveSettingsStoreId(
  userId: string,
  storeIdParam: unknown,
): Promise<string | null> {
  const { tryResolveStoreIdForUser } = await import('../services/storeResolver');
  const requested = typeof storeIdParam === 'string' && storeIdParam.length > 0
    ? storeIdParam
    : null;
  if (!requested) {
    return await tryResolveStoreIdForUser(userId);
  }

  const userRow = await db.select({ locationId: users.locationId, companyId: users.companyId })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (userRow[0]?.locationId === requested) {
    // Belt-and-suspenders: also confirm the location is still active so a
    // soft-deleted store can't be edited via direct id.
    const loc = await db.select({ id: workLocations.id })
      .from(workLocations)
      .where(and(eq(workLocations.id, requested), eq(workLocations.isActive, true)))
      .limit(1);
    return loc[0]?.id ?? null;
  }

  const requesterCompanyId = userRow[0]?.companyId;
  if (!requesterCompanyId) {
    // Without a company we can't prove same-tenant ownership. Deny.
    return null;
  }

  // The store is in the requester's company iff some user in that company
  // has it as their locationId. Joined with work_locations.is_active so a
  // disabled store can't be edited.
  const sameCompanyStore = await db
    .select({ id: workLocations.id })
    .from(workLocations)
    .innerJoin(users, eq(users.locationId, workLocations.id))
    .where(and(
      eq(workLocations.id, requested),
      eq(workLocations.isActive, true),
      eq(users.companyId, requesterCompanyId),
    ))
    .limit(1);
  return sameCompanyStore[0]?.id ?? null;
}

export function registerAiSchedulingRoutes(
  app: Express,
  storage: IStorage,
  isAuthenticated: any,
  sendToUsers: (userIds: string[], data: Record<string, unknown>) => void,
) {
  app.get("/api/ai-scheduling/settings", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const isAdmin = await resolveAnyPermission(userId, ['admin.manage_all', 'schedule.create'], storage);
      if (!isAdmin) {
        return res.status(403).json({ message: "Admin access required" });
      }

      const storeId = await resolveSettingsStoreId(userId, req.query.storeId);
      if (!storeId) {
        return res.status(400).json({ message: "No store associated with your account" });
      }

      const result = await db.select().from(aiSchedulingSettings)
        .where(eq(aiSchedulingSettings.storeId, storeId))
        .limit(1);
      if (result.length > 0) {
        res.json({ ...result[0], storeId });
      } else {
        res.json({
          storeId,
          shiftBlocks: [
            { name: "Morning", startTime: "09:00", endTime: "14:00" },
            { name: "Afternoon", startTime: "14:00", endTime: "21:00" },
          ],
          staffingTiers: [
            { minRevenue: 0, maxRevenue: 2000, employeeCount: 2 },
            { minRevenue: 2001, maxRevenue: 5000, employeeCount: 3 },
            { minRevenue: 5001, maxRevenue: 10000, employeeCount: 5 },
          ],
          minimumStaffing: 2,
          storeHours: [
            { day: 0, openTime: "09:00", closeTime: "21:00", isClosed: true },
            { day: 1, openTime: "09:00", closeTime: "21:00", isClosed: false },
            { day: 2, openTime: "09:00", closeTime: "21:00", isClosed: false },
            { day: 3, openTime: "09:00", closeTime: "21:00", isClosed: false },
            { day: 4, openTime: "09:00", closeTime: "21:00", isClosed: false },
            { day: 5, openTime: "09:00", closeTime: "21:00", isClosed: false },
            { day: 6, openTime: "09:00", closeTime: "21:00", isClosed: false },
          ],
          laborCostOverPct: "30",
          laborCostUnderPct: "10",
        });
      }
    } catch (error) {
      console.error("Error fetching AI scheduling settings:", error);
      res.status(500).json({ message: "Failed to fetch settings" });
    }
  });

  app.put("/api/ai-scheduling/settings", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const isAdmin = await resolveAnyPermission(userId, ['admin.manage_all', 'schedule.create'], storage);
      if (!isAdmin) {
        return res.status(403).json({ message: "Admin access required" });
      }

      const storeId = await resolveSettingsStoreId(userId, req.body?.storeId ?? req.query.storeId);
      if (!storeId) {
        return res.status(400).json({ message: "No store associated with your account" });
      }

      const { shiftBlocks, staffingTiers, minimumStaffing, storeHours, shiftOverlapMinutes, overlapBudgetLimit, laborCostOverPct, laborCostUnderPct, minStaffingPreHours, minStaffingDuringHours, minStaffingPostHours } = req.body;

      let parsedOverPct: number | undefined;
      let parsedUnderPct: number | undefined;
      if (laborCostOverPct !== undefined) {
        parsedOverPct = Number(laborCostOverPct);
        if (!Number.isFinite(parsedOverPct) || parsedOverPct < 0 || parsedOverPct > 100) {
          return res.status(400).json({ message: "laborCostOverPct must be a number between 0 and 100" });
        }
      }
      if (laborCostUnderPct !== undefined) {
        parsedUnderPct = Number(laborCostUnderPct);
        if (!Number.isFinite(parsedUnderPct) || parsedUnderPct < 0 || parsedUnderPct > 100) {
          return res.status(400).json({ message: "laborCostUnderPct must be a number between 0 and 100" });
        }
      }

      const existing = await db.select().from(aiSchedulingSettings)
        .where(eq(aiSchedulingSettings.storeId, storeId))
        .limit(1);

      // Enforce under < over against the effective values (incoming overrides + existing/default).
      // This catches partial updates where only one of the two fields is sent.
      const existingRow: typeof aiSchedulingSettings.$inferSelect | undefined = existing[0];
      const effectiveOverPct = parsedOverPct
        ?? (existingRow?.laborCostOverPct != null ? Number(existingRow.laborCostOverPct) : 30);
      const effectiveUnderPct = parsedUnderPct
        ?? (existingRow?.laborCostUnderPct != null ? Number(existingRow.laborCostUnderPct) : 10);
      if (
        Number.isFinite(effectiveOverPct) &&
        Number.isFinite(effectiveUnderPct) &&
        effectiveUnderPct >= effectiveOverPct
      ) {
        return res.status(400).json({ message: "laborCostUnderPct must be less than laborCostOverPct" });
      }

      const parsedPreHours = minStaffingPreHours !== undefined ? Math.max(1, parseInt(minStaffingPreHours) || 1) : undefined;
      const parsedDuringHours = minStaffingDuringHours !== undefined ? Math.max(1, parseInt(minStaffingDuringHours) || 2) : undefined;
      const parsedPostHours = minStaffingPostHours !== undefined ? Math.max(1, parseInt(minStaffingPostHours) || 1) : undefined;

      if (existing.length > 0) {
        await db.update(aiSchedulingSettings)
          .set({
            shiftBlocks: shiftBlocks || existing[0].shiftBlocks,
            staffingTiers: staffingTiers || existing[0].staffingTiers,
            minimumStaffing: minimumStaffing ?? existing[0].minimumStaffing,
            storeHours: storeHours !== undefined ? storeHours : existing[0].storeHours,
            ...(parsedPreHours !== undefined && { minStaffingPreHours: parsedPreHours }),
            ...(parsedDuringHours !== undefined && { minStaffingDuringHours: parsedDuringHours }),
            ...(parsedPostHours !== undefined && { minStaffingPostHours: parsedPostHours }),
            updatedBy: userId,
            updatedAt: new Date(),
          })
          .where(eq(aiSchedulingSettings.storeId, storeId));

        if (shiftOverlapMinutes !== undefined || overlapBudgetLimit !== undefined) {
          const overlapVal = shiftOverlapMinutes !== undefined ? Number(shiftOverlapMinutes) : null;
          const budgetVal = overlapBudgetLimit !== undefined ? (overlapBudgetLimit !== null ? Number(overlapBudgetLimit) : null) : undefined;

          if (overlapVal !== null && budgetVal !== undefined) {
            await db.execute(sql`UPDATE ai_scheduling_settings SET shift_overlap_minutes = ${overlapVal}, overlap_budget_limit = ${budgetVal} WHERE store_id = ${storeId}`);
          } else if (overlapVal !== null) {
            await db.execute(sql`UPDATE ai_scheduling_settings SET shift_overlap_minutes = ${overlapVal} WHERE store_id = ${storeId}`);
          } else if (budgetVal !== undefined) {
            await db.execute(sql`UPDATE ai_scheduling_settings SET overlap_budget_limit = ${budgetVal} WHERE store_id = ${storeId}`);
          }
        }

        if (parsedOverPct !== undefined || parsedUnderPct !== undefined) {
          if (parsedOverPct !== undefined && parsedUnderPct !== undefined) {
            await db.execute(sql`UPDATE ai_scheduling_settings SET labor_cost_over_pct = ${parsedOverPct}, labor_cost_under_pct = ${parsedUnderPct} WHERE store_id = ${storeId}`);
          } else if (parsedOverPct !== undefined) {
            await db.execute(sql`UPDATE ai_scheduling_settings SET labor_cost_over_pct = ${parsedOverPct} WHERE store_id = ${storeId}`);
          } else if (parsedUnderPct !== undefined) {
            await db.execute(sql`UPDATE ai_scheduling_settings SET labor_cost_under_pct = ${parsedUnderPct} WHERE store_id = ${storeId}`);
          }
        }
      } else {
        await db.insert(aiSchedulingSettings).values({
          storeId,
          shiftBlocks: shiftBlocks || [],
          staffingTiers: staffingTiers || [],
          minimumStaffing: minimumStaffing ?? 2,
          storeHours: storeHours || [],
          minStaffingPreHours: parsedPreHours ?? 1,
          minStaffingDuringHours: parsedDuringHours ?? 2,
          minStaffingPostHours: parsedPostHours ?? 1,
          updatedBy: userId,
        });
        if (shiftOverlapMinutes !== undefined || overlapBudgetLimit !== undefined || parsedOverPct !== undefined || parsedUnderPct !== undefined) {
          const overlapVal = shiftOverlapMinutes !== undefined ? Number(shiftOverlapMinutes) : 60;
          const budgetVal = overlapBudgetLimit !== undefined ? (overlapBudgetLimit !== null ? Number(overlapBudgetLimit) : null) : null;
          const overPctVal = parsedOverPct ?? 30;
          const underPctVal = parsedUnderPct ?? 10;
          await db.execute(sql`UPDATE ai_scheduling_settings SET shift_overlap_minutes = ${overlapVal}, overlap_budget_limit = ${budgetVal}, labor_cost_over_pct = ${overPctVal}, labor_cost_under_pct = ${underPctVal} WHERE store_id = ${storeId}`);
        }
      }

      const updated = await db.select().from(aiSchedulingSettings)
        .where(eq(aiSchedulingSettings.storeId, storeId))
        .limit(1);
      res.json(updated[0] ? { ...updated[0], storeId } : { storeId });
    } catch (error) {
      console.error("Error updating AI scheduling settings:", error);
      res.status(500).json({ message: "Failed to update settings" });
    }
  });

  // ── Special Circumstances CRUD ───────────────────────────────────────────────

  app.get("/api/scheduling/special-circumstances", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const isAdmin = await resolveAnyPermission(userId, ['admin.manage_all', 'schedule.create'], storage);
      if (!isAdmin) return res.status(403).json({ message: "Admin access required" });

      const storeId = await resolveSettingsStoreId(userId, req.query.storeId);
      if (!storeId) return res.status(400).json({ message: "No store associated with your account" });

      const rows = await db.select().from(specialCircumstances)
        .where(eq(specialCircumstances.storeId, storeId));
      res.json(rows);
    } catch (error) {
      console.error("Error fetching special circumstances:", error);
      res.status(500).json({ message: "Failed to fetch special circumstances" });
    }
  });

  app.post("/api/scheduling/special-circumstances", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const isAdmin = await resolveAnyPermission(userId, ['admin.manage_all', 'schedule.create'], storage);
      if (!isAdmin) return res.status(403).json({ message: "Admin access required" });

      const storeId = await resolveSettingsStoreId(userId, req.body?.storeId ?? req.query.storeId);
      if (!storeId) return res.status(400).json({ message: "No store associated with your account" });

      const { name, description, category, isEnabled } = req.body;
      if (!name || typeof name !== 'string' || name.trim().length === 0) {
        return res.status(400).json({ message: "name is required" });
      }

      const [row] = await db.insert(specialCircumstances).values({
        storeId,
        name: name.trim().slice(0, 200),
        description: description ? String(description).slice(0, 2000) : null,
        category: category ? String(category).slice(0, 100) : null,
        isEnabled: isEnabled !== false,
      }).returning();
      res.status(201).json(row);
    } catch (error) {
      console.error("Error creating special circumstance:", error);
      res.status(500).json({ message: "Failed to create special circumstance" });
    }
  });

  app.patch("/api/scheduling/special-circumstances/:id", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const isAdmin = await resolveAnyPermission(userId, ['admin.manage_all', 'schedule.create'], storage);
      if (!isAdmin) return res.status(403).json({ message: "Admin access required" });

      const storeId = await resolveSettingsStoreId(userId, req.body?.storeId ?? req.query.storeId);
      if (!storeId) return res.status(400).json({ message: "No store associated with your account" });

      const { id } = req.params;
      const { name, description, category, isEnabled } = req.body;

      const existing = await db.select().from(specialCircumstances)
        .where(and(eq(specialCircumstances.id, id), eq(specialCircumstances.storeId, storeId)))
        .limit(1);
      if (!existing[0]) return res.status(404).json({ message: "Special circumstance not found" });

      const updates: Partial<typeof specialCircumstances.$inferInsert> = { updatedAt: new Date() };
      if (name !== undefined) updates.name = String(name).trim().slice(0, 200);
      if (description !== undefined) updates.description = description ? String(description).slice(0, 2000) : null;
      if (category !== undefined) updates.category = category ? String(category).slice(0, 100) : null;
      if (isEnabled !== undefined) updates.isEnabled = Boolean(isEnabled);

      const [row] = await db.update(specialCircumstances)
        .set(updates)
        .where(eq(specialCircumstances.id, id))
        .returning();
      res.json(row);
    } catch (error) {
      console.error("Error updating special circumstance:", error);
      res.status(500).json({ message: "Failed to update special circumstance" });
    }
  });

  app.delete("/api/scheduling/special-circumstances/:id", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const isAdmin = await resolveAnyPermission(userId, ['admin.manage_all', 'schedule.create'], storage);
      if (!isAdmin) return res.status(403).json({ message: "Admin access required" });

      const storeId = await resolveSettingsStoreId(userId, req.query.storeId);
      if (!storeId) return res.status(400).json({ message: "No store associated with your account" });

      const { id } = req.params;
      const existing = await db.select({ id: specialCircumstances.id }).from(specialCircumstances)
        .where(and(eq(specialCircumstances.id, id), eq(specialCircumstances.storeId, storeId)))
        .limit(1);
      if (!existing[0]) return res.status(404).json({ message: "Special circumstance not found" });

      await db.delete(specialCircumstances).where(eq(specialCircumstances.id, id));
      res.json({ success: true });
    } catch (error) {
      console.error("Error deleting special circumstance:", error);
      res.status(500).json({ message: "Failed to delete special circumstance" });
    }
  });

  app.post("/api/ai-scheduling/generate", isAuthenticated, aiRateLimiter, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const isAdmin = await resolveAnyPermission(userId, ['admin.manage_all', 'schedule.create'], storage);
      if (!isAdmin) {
        return res.status(403).json({ message: "Admin access required" });
      }

      const { startDate, endDate, shopDomain } = req.body;
      if (!startDate || !endDate) {
        return res.status(400).json({ message: "Start date and end date are required" });
      }
      const startParsed = parseDateOnlyUtc(startDate);
      const endParsed = parseDateOnlyUtc(endDate);
      if (!startParsed || !endParsed) {
        return res.status(400).json({ message: "startDate and endDate must be YYYY-MM-DD" });
      }
      if (startParsed > endParsed) {
        return res.status(400).json({ message: "startDate must be on or before endDate" });
      }
      // Cap range to ~3 months so a malformed/abusive request can't iterate
      // unbounded days, balloon prompt size, or hit Anthropic max_tokens.
      const rangeDays = Math.round((endParsed.getTime() - startParsed.getTime()) / 86400000) + 1;
      if (rangeDays > 95) {
        return res.status(400).json({ message: "Date range cannot exceed 95 days" });
      }

      // Resolve which store this generation run is for. The labor cost band,
      // staffing tiers, and store hours are all per-store now (Task #435), so
      // the wrong store would warn against the wrong target. Caller can
      // override with `storeId` in the body, otherwise default to the
      // requester's store.
      //
      // If the caller EXPLICITLY passed a storeId but failed authorization,
      // we 403 rather than silently falling back to defaults — otherwise an
      // attacker would get a "successful" generate run that quietly used the
      // wrong band, masking the auth failure.
      const explicitStoreId = typeof req.body?.storeId === 'string' && req.body.storeId.length > 0
        ? req.body.storeId
        : null;
      const generateStoreId = await resolveSettingsStoreId(userId, explicitStoreId);
      if (explicitStoreId && !generateStoreId) {
        return res.status(403).json({ message: "You don't have access to that store" });
      }

      // Entitlement check (ADR-0011): AI schedule generation is a paid feature.
      if (generateStoreId && !await hasEntitlement(generateStoreId, "ai.scheduling")) {
        return res.status(403).json({ message: "Your plan does not include AI scheduling. Please upgrade to continue." });
      }

      const settingsResult = generateStoreId
        ? await db.select().from(aiSchedulingSettings)
            .where(eq(aiSchedulingSettings.storeId, generateStoreId))
            .limit(1)
        : [];
      const settings = settingsResult[0] || {
        shiftBlocks: [
          { name: "Morning", startTime: "09:00", endTime: "14:00" },
          { name: "Afternoon", startTime: "14:00", endTime: "21:00" },
        ],
        staffingTiers: [
          { minRevenue: 0, maxRevenue: 2000, employeeCount: 2 },
          { minRevenue: 2001, maxRevenue: 5000, employeeCount: 3 },
          { minRevenue: 5001, maxRevenue: 10000, employeeCount: 5 },
        ],
        minimumStaffing: 2,
        minStaffingPreHours: 1,
        minStaffingDuringHours: 2,
        minStaffingPostHours: 1,
        storeHours: [],
      };

      const storeHoursArray = (settings.storeHours as any[]) || [];

      const start = startParsed;
      const end = endParsed;

      let salesData: Array<{ date: Date; dayOfWeek: number; totalRevenue: string }> = [];
      let resolvedShopDomain = shopDomain;

      if (!resolvedShopDomain) {
        const activeShops = await db.select().from(shops).where(eq(shops.isActive, true)).limit(1);
        if (activeShops.length > 0) {
          resolvedShopDomain = activeShops[0].shopDomain;
        }
      }

      if (resolvedShopDomain) {
        // Pull 2 years of data so findClosestDayOfWeekDate has enough same-weekday
        // candidates to pick from. The variable is deliberately 2 years, not 1.
        const twoYearsAgo = new Date(start);
        twoYearsAgo.setFullYear(twoYearsAgo.getFullYear() - 2);
        const salesResult = await db.select()
          .from(shopifyDailySales)
          .where(and(
            eq(shopifyDailySales.shopDomain, resolvedShopDomain),
            gte(shopifyDailySales.date, twoYearsAgo)
          ))
          .orderBy(desc(shopifyDailySales.date));

        salesData = salesResult.map(s => ({
          date: new Date(s.date),
          dayOfWeek: s.dayOfWeek ?? 0,
          totalRevenue: s.totalRevenue || '0',
        }));
      }

      const days: Array<{
        date: string;
        dayOfWeek: number;
        dayName: string;
        predictedRevenue: number;
        requiredStaff: number;
        requiredStaffPre: number;
        requiredStaffDuring: number;
        requiredStaffPost: number;
        matchedLastYearDate?: string;
      }> = [];

      const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

      for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
        const current = new Date(d);
        const dateStr = current.toISOString().split('T')[0];
        const dow = current.getUTCDay();

        let predictedRevenue = 0;
        let matchedDate: string | undefined;

        if (salesData.length > 0) {
          const match = findClosestDayOfWeekDate(current, salesData);
          if (match) {
            predictedRevenue = parseFloat(match.totalRevenue);
            matchedDate = match.date.toISOString().split('T')[0];
          }
        }

        const genMinPre = settings.minStaffingPreHours ?? settings.minimumStaffing ?? 1;
        const genMinDuring = settings.minStaffingDuringHours ?? settings.minimumStaffing ?? 2;
        const genMinPost = settings.minStaffingPostHours ?? settings.minimumStaffing ?? 1;
        const tiers = settings.staffingTiers as any[];
        const requiredStaffPre = getStaffingForRevenue(predictedRevenue, tiers, genMinPre);
        const requiredStaffDuring = getStaffingForRevenue(predictedRevenue, tiers, genMinDuring);
        const requiredStaffPost = getStaffingForRevenue(predictedRevenue, tiers, genMinPost);
        const requiredStaff = requiredStaffDuring; // peak zone as primary indicator

        days.push({
          date: dateStr,
          dayOfWeek: dow,
          dayName: dayNames[dow],
          predictedRevenue: Math.round(predictedRevenue * 100) / 100,
          requiredStaff,
          requiredStaffPre,
          requiredStaffDuring,
          requiredStaffPost,
          matchedLastYearDate: matchedDate,
        });
      }

      const allUsers = await db.select().from(users).where(eq(users.isActive, true));

      const availabilityResult = await db.select()
        .from(userAvailability)
        .where(and(
          gte(userAvailability.date, start),
          lte(userAvailability.date, end)
        ));

      const allWorkPatterns = await db.select().from(userWorkPatterns);
      const workPatternsByUser: Record<string, Record<number, string>> = {};
      for (const wp of allWorkPatterns) {
        if (!workPatternsByUser[wp.userId]) workPatternsByUser[wp.userId] = {};
        workPatternsByUser[wp.userId][(wp as any).dayOfWeek] = (wp as any).status;
      }

      const availabilityByUserDate: Record<string, Record<string, { isAvailable: boolean; startTime?: string; endTime?: string; timeSlot: string }[]>> = {};
      for (const avail of availabilityResult) {
        const dateKey = new Date(avail.date).toISOString().split('T')[0];
        if (!availabilityByUserDate[avail.userId]) {
          availabilityByUserDate[avail.userId] = {};
        }
        if (!availabilityByUserDate[avail.userId][dateKey]) {
          availabilityByUserDate[avail.userId][dateKey] = [];
        }
        availabilityByUserDate[avail.userId][dateKey].push({
          isAvailable: avail.isAvailable ?? true,
          startTime: avail.startTime || undefined,
          endTime: avail.endTime || undefined,
          timeSlot: avail.timeSlot,
        });
      }

      const scoreWindow = new Date();
      scoreWindow.setDate(scoreWindow.getDate() - 90);
      const performanceScores = await db
        .select({
          userId: clockEvents.userId,
          totalPoints: sql<number>`COALESCE(SUM(${clockEvents.pointValue}), 0)::int`,
        })
        .from(clockEvents)
        .where(gte(clockEvents.createdAt, scoreWindow))
        .groupBy(clockEvents.userId);
      const scoreMap: Record<string, number> = {};
      for (const s of performanceScores) {
        scoreMap[s.userId] = s.totalPoints;
      }

      // Fetch active coverage rules and custom instructions for prompt injection.
      // Both are stored in ai_scheduling_rules (store-scoped via storeId) — custom instructions
      // use ruleType='custom_instructions' as a singleton row to avoid unscoped settings reads.
      const { tryResolveStoreIdForUser } = await import('../services/storeResolver');
      const promptStoreId = await tryResolveStoreIdForUser(userId);
      const allPromptRules = promptStoreId
        ? await db.select().from(aiSchedulingRules).where(and(eq(aiSchedulingRules.storeId, promptStoreId), eq(aiSchedulingRules.isEnabled, true)))
        : [];
      const instructionsSingleton = allPromptRules.find(r => r.ruleType === 'custom_instructions');
      const activeRules = allPromptRules.filter(r => r.ruleType !== 'custom_instructions');
      const customAiInstructions = instructionsSingleton
        ? String((instructionsSingleton.params as AiRuleParams).text || '')
        : '';

      const enabledSpecialCircumstances = promptStoreId
        ? await db.select().from(specialCircumstances)
            .where(and(eq(specialCircumstances.storeId, promptStoreId), eq(specialCircumstances.isEnabled, true)))
        : [];

      const employeeList = allUsers
        .filter(u => u.showInSchedule !== false && u.eligibleForAutoScheduling !== false)
        .map(u => {
          const userAvail: Record<string, any> = {};
          const userPatterns = workPatternsByUser[u.id] || {};

          for (const day of days) {
            const explicitAvail = availabilityByUserDate[u.id]?.[day.date];
            const workPattern = userPatterns[day.dayOfWeek];

            if (workPattern === 'hard_off') {
              userAvail[day.date] = 'HARD_OFF';
            } else if (explicitAvail) {
              const unavailable = explicitAvail.some(a => a.isAvailable === false);
              userAvail[day.date] = unavailable ? 'unavailable' : (workPattern === 'required' ? 'REQUIRED' : 'available');
            } else if (workPattern === 'required') {
              userAvail[day.date] = 'REQUIRED';
            } else if (workPattern === 'preferred_off') {
              userAvail[day.date] = 'preferred_off';
            } else {
              userAvail[day.date] = 'available';
            }
          }
          const classifications = u.schedulingClassifications as string[] | null;
          return {
            id: u.id,
            name: `${u.firstName || ''} ${u.lastName || ''}`.trim() || u.email || 'Unknown',
            availability: userAvail,
            targetWeeklyHours: u.targetWeeklyHours ? parseFloat(u.targetWeeklyHours) : null,
            performanceScore: scoreMap[u.id] ?? 0,
            classifications: classifications && classifications.length > 0 ? classifications : [],
          };
        });

      const shiftBlocks = (settings.shiftBlocks as any[]) || [];

      const storeHoursInfo = storeHoursArray.length === 7
        ? `\nSTORE HOURS:\n${storeHoursArray.map((sh: any) => {
            const dayName = dayNames[sh.day];
            return sh.isClosed ? `${dayName}: CLOSED` : `${dayName}: ${sh.openTime} - ${sh.closeTime}`;
          }).join('\n')}\n`
        : '';

      const closedDays = new Set<number>();
      for (const sh of storeHoursArray) {
        if (sh.isClosed) closedDays.add(sh.day);
      }

      const schedulableDays = days.filter(d => !closedDays.has(d.dayOfWeek));

      const prompt = `You are a workforce scheduling AI that ONLY outputs valid JSON. No markdown, no explanations, no text before or after the JSON object.

SCHEDULING PRINCIPLES (core rules — apply these to every schedule):
- Coverage priority: staffing levels are driven by revenue projections mapped to staffing tiers. Always meet the required headcount per shift block before considering fairness or preferences.
- Rest gaps: never schedule the same employee with fewer than 10 hours between the end of one shift and the start of the next.
- Role sequencing: opening shifts require at least one Opener or Key Holder; closing shifts require at least one Closer or Key Holder.
- No clopening: do not assign an employee to a closing shift on day N and an opening shift on day N+1.
- New Hire pairing: any New Hire on a shift must share that shift with at least one Trainer.
- Target-hours priority: full-time employees (those with targetWeeklyHours set) must receive enough shifts to meet their weekly target before part-timers receive extra shifts.
- Fairness: distribute undesirable shifts (early opens, late closes, weekends) as evenly as possible across eligible employees over the week.
- Labor cost guardrail: target 15–25% of projected daily revenue in labor cost. Warn if a day's scheduled labor would exceed 30% of projected revenue.
- Composite scoring tiebreaker: when multiple employees are equally eligible, rank by composite score — availability overlap (40%), 90-day performance score (40%), hours remaining toward weekly target (20%).

DATA:

SHIFT BLOCKS: ${JSON.stringify(shiftBlocks.map((b: any) => ({ name: b.name, start: b.startTime, end: b.endTime })))}
${storeHoursInfo}
SCHEDULE PERIOD:
${schedulableDays.map(d => `${d.date} (${d.dayName}): revenue=$${d.predictedRevenue}, need ${d.requiredStaff} staff${d.matchedLastYearDate ? ` (matched ${d.matchedLastYearDate})` : ''}`).join('\n')}
${closedDays.size > 0 ? `\nCLOSED DAYS (DO NOT schedule anyone): ${days.filter(d => closedDays.has(d.dayOfWeek)).map(d => `${d.date} (${d.dayName})`).join(', ')}\n` : ''}
MIN STAFFING BY TIME ZONE:
- Opening zone (first shift block / pre-hours): ${settings.minStaffingPreHours ?? 1} employee(s) minimum
- Peak zone (middle shift blocks / during-hours): ${settings.minStaffingDuringHours ?? settings.minimumStaffing ?? 2} employee(s) minimum
- Closing zone (last shift block / post-hours): ${settings.minStaffingPostHours ?? 1} employee(s) minimum

EMPLOYEES:
${employeeList.map(e => {
  const targetInfo = e.targetWeeklyHours ? ` [TARGET: ${e.targetWeeklyHours}hrs/wk]` : '';
  const scoreInfo = ` [SCORE: ${e.performanceScore}]`;
  const classInfo = e.classifications.length > 0 ? ` [ROLES: ${e.classifications.join(', ')}]` : '';
  return `${e.name} (${e.id})${targetInfo}${scoreInfo}${classInfo}: ${Object.entries(e.availability).map(([date, status]) => `${date}=${status}`).join(', ')}`;
}).join('\n')}

EMPLOYEE ROLE CLASSIFICATIONS:
Employee roles describe their scheduling qualifications. Use these to satisfy coverage rules below.
- Opener: Qualified to open the store and run opening procedures
- Closer: Qualified to close the store and run closing procedures
- Key Holder: Has a store key and can open/close independently
- Trainer: Can train and supervise New Hires
- New Hire: Recently onboarded and should be paired with a Trainer when possible

AVAILABILITY STATUS KEY:
- REQUIRED = employee MUST be scheduled this day (their recurring work pattern demands it)
- HARD_OFF = employee MUST NOT be scheduled this day (their recurring day off)
- preferred_off = employee prefers not to work but CAN be scheduled if needed
- available = employee can work
- unavailable = employee cannot work this specific date

PERFORMANCE SCORE: Points earned over the last 90 days from attendance, task completion, and workplace reliability. Higher scores indicate more dependable employees.

RULES:
1. Meet required staff count per day per shift block.
2. Distribute shifts fairly. Never schedule unavailable or HARD_OFF employees.
3. REQUIRED days: employees marked REQUIRED on a date MUST be scheduled that day.
4. Employees with TARGET hours are full-time and MUST be prioritized — give them enough shifts to meet their weekly target before assigning others.
5. Employees MAY work multiple shift blocks per day to meet targets.
6. NEVER schedule shifts outside store operating hours. All shift times must fall within store hours for that day.
7. NEVER schedule anyone on days the store is closed.
8. preferred_off employees should only be scheduled as a last resort to fill minimum staffing.
9. When multiple employees are equally available for the same shift, prefer employees with higher SCORE values. Higher scores mean better attendance, task completion, and reliability. Use scores as a tiebreaker after availability, REQUIRED status, and target hours priorities are satisfied.
${activeRules.length > 0 ? `
COVERAGE RULES (treat as hard constraints, just below availability):
${activeRules.map((r, i) => {
  const p: AiRuleParams = (r.params as AiRuleParams) || {};
  switch (r.ruleType) {
    case 'opening_requires_classification':
      return `${i + 1}. Opening shift must include at least ${p.count || 1} employee(s) with the [${p.classification || 'Key Holder'}] role.`;
    case 'closing_requires_classification':
      return `${i + 1}. Closing shift must include at least ${p.count || 1} employee(s) with the [${p.classification || 'Closer'}] role.`;
    case 'new_hire_paired_with_trainer':
      return `${i + 1}. Any New Hire scheduled for a shift MUST be on the same shift as at least one Trainer.`;
    case 'no_clopening':
      return `${i + 1}. Avoid "clopening" — do not schedule the same employee to close one day and open the next.`;
    case 'min_classification_per_shift':
      return `${i + 1}. Every shift must have at least ${p.count || 1} employee(s) with the [${p.classification || 'Key Holder'}] role.`;
    default:
      return `${i + 1}. ${r.ruleType}: ${JSON.stringify(p)}`;
  }
}).join('\n')}
` : ''}${customAiInstructions ? `
CUSTOM INSTRUCTIONS FROM ADMIN:
${customAiInstructions}
` : ''}${enabledSpecialCircumstances.length > 0 ? `
SPECIAL CIRCUMSTANCES — apply these when assigning shifts this week:
${enabledSpecialCircumstances.map((c: any, i: number) => `${i + 1}. ${c.name}${c.category ? ` [${c.category}]` : ''}${c.description ? ': ' + c.description : ''}`).join('\n')}
` : ''}
OUTPUT INSTRUCTIONS: Return ONLY a single JSON object. Do NOT include any text, markdown formatting, or code fences. The response must start with { and end with }.

Required JSON structure:
{"schedule":[{"date":"YYYY-MM-DD","employeeId":"id","employeeName":"Name","shiftBlock":"block name","startTime":"HH:MM","endTime":"HH:MM","reasoning":"brief reason"}],"summary":"Brief summary","warnings":["any warnings"]}`;

      let aiResponseText: string = '';
      await withAiContext({ feature: "ai.scheduling.generate", storeId: generateStoreId, userId }, async () => {
        const aiResult = await anthropic.messages.create({
          model: "claude-sonnet-4-20250514",
          max_tokens: 8192,
          system: "You are a workforce scheduling AI. You MUST respond with valid JSON only. No markdown, no explanations, no code fences. Your entire response must be a single JSON object starting with { and ending with }.",
          messages: [{ role: 'user', content: prompt }],
        });
        const aiContent = aiResult.content[0];
        if (aiContent.type !== 'text') {
          throw new Error('Expected text response from Claude');
        }
        aiResponseText = aiContent.text;
      });
      const aiResponse = aiResponseText;

      let parsedSchedule: any;
      try {
        let jsonStr = aiResponse.trim();

        const codeBlockMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
        if (codeBlockMatch) {
          jsonStr = codeBlockMatch[1].trim();
        }

        if (!jsonStr.startsWith('{')) {
          const firstBrace = jsonStr.indexOf('{');
          if (firstBrace !== -1) {
            jsonStr = jsonStr.slice(firstBrace);
          }
        }

        const lastBrace = jsonStr.lastIndexOf('}');
        if (lastBrace !== -1 && lastBrace < jsonStr.length - 1) {
          jsonStr = jsonStr.slice(0, lastBrace + 1);
        }

        parsedSchedule = JSON.parse(jsonStr);
      } catch (parseErr) {
        try {
          const deepMatch = aiResponse.match(/\{[\s\S]*"schedule"\s*:\s*\[[\s\S]*\][\s\S]*\}/);
          if (deepMatch) {
            parsedSchedule = JSON.parse(deepMatch[0]);
          } else {
            throw parseErr;
          }
        } catch {
          console.error('Failed to parse AI schedule response:', parseErr);
          console.error('Raw AI response (first 1000 chars):', aiResponse.slice(0, 1000));
          return res.status(500).json({
            message: "AI generated a response but it couldn't be parsed. Please try again.",
          });
        }
      }

      const employeeIds = new Set(employeeList.map(e => e.id));
      const validSchedule = (parsedSchedule.schedule || []).filter((entry: any) => {
        if (!entry.date || !entry.employeeId || !entry.startTime || !entry.endTime) return false;
        if (!employeeIds.has(entry.employeeId)) return false;
        if (!/^\d{4}-\d{2}-\d{2}$/.test(entry.date)) return false;
        if (!/^\d{2}:\d{2}$/.test(entry.startTime) || !/^\d{2}:\d{2}$/.test(entry.endTime)) return false;
        return true;
      }).map((entry: any) => ({
        date: String(entry.date),
        employeeId: String(entry.employeeId),
        employeeName: String(entry.employeeName || '').slice(0, 200),
        shiftBlock: String(entry.shiftBlock || '').slice(0, 100),
        startTime: String(entry.startTime),
        endTime: String(entry.endTime),
        reasoning: String(entry.reasoning || '').slice(0, 500),
      }));

      const overlapMinutes = (settings as any).shiftOverlapMinutes ?? 60;
      const budgetLimit = (settings as any).overlapBudgetLimit ? parseFloat((settings as any).overlapBudgetLimit) : null;

      const { adjustedShifts, overlapBlocks } = applyShiftOverlap(validSchedule, overlapMinutes);

      const hourlyRates = new Map<string, number>();
      for (const emp of employeeList) {
        hourlyRates.set(emp.id, (emp as any).hourlyRate || 15);
      }
      const additionalLaborCost = calculateOverlapLaborCost(overlapBlocks, hourlyRates);
      const budgetWarning = checkBudgetThreshold(additionalLaborCost, budgetLimit);

      const warnings = Array.isArray(parsedSchedule.warnings)
        ? parsedSchedule.warnings.map((w: any) => String(w).slice(0, 300))
        : [];

      if (budgetWarning?.overBudget) {
        warnings.push(
          `Shift overlap adds $${additionalLaborCost.toFixed(2)} in labor costs, which exceeds your weekly budget limit of $${budgetWarning.weeklyBudgetLimit.toFixed(2)}.`
        );
      }

      const dailyLaborCosts = calculateDailyLaborCost(adjustedShifts, hourlyRates);
      const projectedRevenueByDate = new Map<string, number>(
        days.map(d => [d.date, d.predictedRevenue])
      );
      const settingsRow: typeof aiSchedulingSettings.$inferSelect | undefined = settingsResult[0];
      const rawOverPct = settingsRow?.laborCostOverPct;
      const rawUnderPct = settingsRow?.laborCostUnderPct;
      const overThresholdPct = rawOverPct != null ? Number(rawOverPct) : NaN;
      const underThresholdPct = rawUnderPct != null ? Number(rawUnderPct) : NaN;
      const effectiveOverPct = Number.isFinite(overThresholdPct) ? overThresholdPct : 30;
      const effectiveUnderPct = Number.isFinite(underThresholdPct) ? underThresholdPct : 10;
      const dailyLaborCostWarnings = checkDailyLaborCostThresholds(
        dailyLaborCosts,
        projectedRevenueByDate,
        {
          overThresholdPct: effectiveOverPct,
          underThresholdPct: effectiveUnderPct,
        }
      );
      const laborCostBand = {
        overPct: effectiveOverPct,
        underPct: effectiveUnderPct,
      };
      for (const w of dailyLaborCostWarnings) {
        warnings.push(w.message);
      }

      logger.info(
        {
          overlapMinutes,
          overlapBlocks: overlapBlocks.length,
          additionalLaborCost,
          dailyLaborCostWarnings: dailyLaborCostWarnings.length,
        },
        "Shift overlap applied to generated schedule"
      );

      res.json({
        success: true,
        days,
        generatedSchedule: validSchedule,
        adjustedSchedule: adjustedShifts,
        overlapBlocks,
        additionalLaborCost,
        budgetWarning,
        dailyLaborCosts,
        dailyLaborCostWarnings,
        laborCostBand,
        summary: typeof parsedSchedule.summary === 'string' ? parsedSchedule.summary.slice(0, 1000) : '',
        warnings,
        settings: {
          shiftBlocks,
          staffingTiers: settings.staffingTiers,
          minimumStaffing: settings.minimumStaffing,
          minStaffingPreHours: settings.minStaffingPreHours ?? 1,
          minStaffingDuringHours: settings.minStaffingDuringHours ?? settings.minimumStaffing ?? 2,
          minStaffingPostHours: settings.minStaffingPostHours ?? 1,
          shiftOverlapMinutes: overlapMinutes,
        },
        salesDataAvailable: salesData.length > 0,
      });
    } catch (error: any) {
      console.error("Error generating AI schedule:", error);
      if (error?.name === 'BudgetExceededError' || error?.constructor?.name === 'BudgetExceededError') {
        return res.status(402).json({ message: error.message || "AI spending budget exceeded. Contact your administrator." });
      }
      const msg = error instanceof Error ? `${error.message}` : "Failed to generate schedule";
      res.status(500).json({ message: msg });
    }
  });

  // ── Prebuild status — which days in the next 4 weeks already have suggestions ──
  app.get("/api/ai-scheduling/prebuild-status", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const isAdmin = await resolveAnyPermission(userId, ['admin.manage_all', 'schedule.view_all', 'schedule.create'], storage);
      if (!isAdmin) return res.status(403).json({ message: "Manager access required" });

      const storeId = await tryResolveStoreIdForUser(userId);
      if (!storeId) return res.status(400).json({ message: "No store associated with your account" });

      // Use UTC throughout so the default 28-day window stays stable across
      // timezones (a `setDate` rollover in UTC+ regions would otherwise skip
      // a day or include a day already past store-local midnight).
      const { startDate, endDate } = req.query as { startDate?: string; endDate?: string };
      const todayUtc = new Date();
      const fmt = (d: Date) =>
        `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;

      const rangeStartParsed = startDate
        ? parseDateOnlyUtc(startDate)
        : new Date(`${fmt(todayUtc)}T00:00:00.000Z`);
      if (!rangeStartParsed) {
        return res.status(400).json({ message: "startDate must be YYYY-MM-DD" });
      }
      let rangeEndParsed: Date | null;
      if (endDate) {
        rangeEndParsed = parseDateOnlyUtc(endDate);
        if (!rangeEndParsed) return res.status(400).json({ message: "endDate must be YYYY-MM-DD" });
      } else {
        rangeEndParsed = new Date(rangeStartParsed);
        rangeEndParsed.setUTCDate(rangeEndParsed.getUTCDate() + 27);
      }
      const rangeStart = fmt(rangeStartParsed);
      const rangeEnd = fmt(rangeEndParsed);

      // Load store hours so the UI can show "X of N schedulable days" instead
      // of dividing by a hardcoded 28 (which never reaches 100% for stores
      // closed one or more days per week — Sunday-closed stores would always
      // show 24/28 even when fully built).
      const [rows, settingsRow] = await Promise.all([
        db.select({
          date: aiSuggestedSchedules.date,
          generatedAt: aiSuggestedSchedules.generatedAt,
        }).from(aiSuggestedSchedules)
          .where(and(
            eq(aiSuggestedSchedules.storeId, storeId),
            gte(aiSuggestedSchedules.date, rangeStart),
            lte(aiSuggestedSchedules.date, rangeEnd),
          )),
        db.select({ storeHours: aiSchedulingSettings.storeHours })
          .from(aiSchedulingSettings)
          .where(eq(aiSchedulingSettings.storeId, storeId))
          .limit(1),
      ]);

      const storeHoursArr = (settingsRow[0]?.storeHours as any[]) || [];
      const closedDow = new Set<number>(
        storeHoursArr.filter((h: any) => h?.isClosed).map((h: any) => h.dayOfWeek)
      );
      let schedulableTotal = 0;
      for (let d = new Date(rangeStartParsed); d <= rangeEndParsed; d.setUTCDate(d.getUTCDate() + 1)) {
        if (!closedDow.has(d.getUTCDay())) schedulableTotal++;
      }

      res.json({
        prebuiltDates: rows.map(r => ({
          date: typeof r.date === 'string' ? r.date : new Date(r.date).toISOString().split('T')[0],
          generatedAt: r.generatedAt,
        })),
        rangeStart,
        rangeEnd,
        total: rows.length,
        schedulableTotal,
      });
    } catch (error) {
      logger.error({ error: String(error) }, "[prebuild-status] error");
      res.status(500).json({ message: "Failed to fetch prebuild status" });
    }
  });

  // ── Prebuild — generate one month of suggestions in a single AI call ──────────
  app.post("/api/ai-scheduling/prebuild", isAuthenticated, aiRateLimiter, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const isAdmin = await resolveAnyPermission(userId, ['admin.manage_all', 'schedule.create'], storage);
      if (!isAdmin) return res.status(403).json({ message: "Admin access required" });

      const storeId = await tryResolveStoreIdForUser(userId);
      if (!storeId) return res.status(400).json({ message: "No store associated with your account" });

      if (!await hasEntitlement(storeId, "ai.scheduling")) {
        return res.status(403).json({ message: "Your plan does not include AI scheduling. Please upgrade." });
      }

      const { force = false } = req.body;
      // Use UTC throughout to avoid local-timezone off-by-one weekday labels.
      // Validate any caller-provided dates strictly so malformed input becomes
      // a clean 400 rather than `Invalid Date` propagating into Drizzle.
      const todayUtc = new Date();
      const formatUtc = (d: Date) =>
        `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;

      let pbStart: Date;
      if (req.body.startDate !== undefined) {
        const parsed = parseDateOnlyUtc(req.body.startDate);
        if (!parsed) return res.status(400).json({ message: "startDate must be YYYY-MM-DD" });
        pbStart = parsed;
      } else {
        pbStart = new Date(`${formatUtc(todayUtc)}T00:00:00.000Z`);
      }

      let pbEnd: Date;
      if (req.body.endDate !== undefined) {
        const parsed = parseDateOnlyUtc(req.body.endDate);
        if (!parsed) return res.status(400).json({ message: "endDate must be YYYY-MM-DD" });
        pbEnd = parsed;
      } else {
        pbEnd = new Date(pbStart);
        pbEnd.setUTCDate(pbEnd.getUTCDate() + 27);
      }
      if (pbStart > pbEnd) {
        return res.status(400).json({ message: "startDate must be on or before endDate" });
      }
      const pbRangeDays = Math.round((pbEnd.getTime() - pbStart.getTime()) / 86400000) + 1;
      if (pbRangeDays > 31) {
        return res.status(400).json({ message: "Pre-build range cannot exceed 31 days (one AI call)" });
      }
      const pbStartRaw = formatUtc(pbStart);
      const pbEndRaw = formatUtc(pbEnd);

      // ── If not forced, skip days that already have suggestions ─────────────
      const existingRows = force ? [] : await db.select({ date: aiSuggestedSchedules.date })
        .from(aiSuggestedSchedules)
        .where(and(
          eq(aiSuggestedSchedules.storeId, storeId),
          gte(aiSuggestedSchedules.date, pbStartRaw),
          lte(aiSuggestedSchedules.date, pbEndRaw),
        ));
      const existingDates = new Set(existingRows.map(r => typeof r.date === 'string' ? r.date : new Date(r.date).toISOString().split('T')[0]));

      // ── Load settings ───────────────────────────────────────────────────────
      const settingsResult = await db.select().from(aiSchedulingSettings)
        .where(eq(aiSchedulingSettings.storeId, storeId)).limit(1);
      const settings = settingsResult[0] || {
        shiftBlocks: [
          { name: "Morning", startTime: "09:00", endTime: "14:00" },
          { name: "Afternoon", startTime: "14:00", endTime: "21:00" },
        ],
        staffingTiers: [
          { minRevenue: 0, maxRevenue: 2000, employeeCount: 2 },
          { minRevenue: 2001, maxRevenue: 5000, employeeCount: 3 },
          { minRevenue: 5001, maxRevenue: 10000, employeeCount: 5 },
        ],
        minimumStaffing: 2,
        minStaffingPreHours: 1,
        minStaffingDuringHours: 2,
        minStaffingPostHours: 1,
        storeHours: [],
      };
      const storeHoursArray = (settings.storeHours as any[]) || [];

      // ── Load Shopify sales data ─────────────────────────────────────────────
      const activeShops = await db.select().from(shops).where(eq(shops.isActive, true)).limit(1);
      const shopDomain = activeShops[0]?.shopDomain;
      let salesData: Array<{ date: Date; dayOfWeek: number; totalRevenue: string }> = [];
      if (shopDomain) {
        const twoYearsAgo = new Date(pbStart);
        twoYearsAgo.setFullYear(twoYearsAgo.getFullYear() - 2);
        const salesResult = await db.select().from(shopifyDailySales)
          .where(and(eq(shopifyDailySales.shopDomain, shopDomain), gte(shopifyDailySales.date, twoYearsAgo)))
          .orderBy(desc(shopifyDailySales.date));
        salesData = salesResult.map(s => ({
          date: new Date(s.date),
          dayOfWeek: s.dayOfWeek ?? 0,
          totalRevenue: s.totalRevenue || '0',
        }));
      }

      // ── Build days array ────────────────────────────────────────────────────
      const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
      const days: Array<{
        date: string; dayOfWeek: number; dayName: string;
        predictedRevenue: number; requiredStaff: number;
        requiredStaffPre: number; requiredStaffDuring: number; requiredStaffPost: number;
        matchedLastYearDate?: string;
      }> = [];

      for (let d = new Date(pbStart); d <= pbEnd; d.setUTCDate(d.getUTCDate() + 1)) {
        const current = new Date(d);
        const dateStr = current.toISOString().split('T')[0];
        const dow = current.getUTCDay();
        let predictedRevenue = 0;
        let matchedDate: string | undefined;
        if (salesData.length > 0) {
          const match = findClosestDayOfWeekDate(current, salesData);
          if (match) {
            predictedRevenue = parseFloat(match.totalRevenue);
            matchedDate = match.date.toISOString().split('T')[0];
          }
        }
        const genMinPre = settings.minStaffingPreHours ?? settings.minimumStaffing ?? 1;
        const genMinDuring = settings.minStaffingDuringHours ?? settings.minimumStaffing ?? 2;
        const genMinPost = settings.minStaffingPostHours ?? settings.minimumStaffing ?? 1;
        const tiers = settings.staffingTiers as any[];
        days.push({
          date: dateStr,
          dayOfWeek: dow,
          dayName: dayNames[dow],
          predictedRevenue: Math.round(predictedRevenue * 100) / 100,
          requiredStaff: getStaffingForRevenue(predictedRevenue, tiers, genMinDuring),
          requiredStaffPre: getStaffingForRevenue(predictedRevenue, tiers, genMinPre),
          requiredStaffDuring: getStaffingForRevenue(predictedRevenue, tiers, genMinDuring),
          requiredStaffPost: getStaffingForRevenue(predictedRevenue, tiers, genMinPost),
          matchedLastYearDate: matchedDate,
        });
      }

      // ── Load users + availability ───────────────────────────────────────────
      const { getAllStoreUserIds } = await import('../lib/permissionUtils');
      const storeUserIds = await getAllStoreUserIds(storeId);
      if (storeUserIds.length === 0) {
        return res.json({ success: true, daysPrebuilt: 0, skipped: 0, message: "No employees found for this store." });
      }

      const allUsers = await db.select().from(users)
        .where(and(eq(users.isActive, true), inArray(users.id, storeUserIds)));

      const availabilityResult = await db.select().from(userAvailability)
        .where(and(gte(userAvailability.date, pbStart), lte(userAvailability.date, pbEnd)));
      const availabilityByUserDate: Record<string, Record<string, { isAvailable: boolean }[]>> = {};
      for (const avail of availabilityResult) {
        const dateKey = new Date(avail.date).toISOString().split('T')[0];
        if (!availabilityByUserDate[avail.userId]) availabilityByUserDate[avail.userId] = {};
        if (!availabilityByUserDate[avail.userId][dateKey]) availabilityByUserDate[avail.userId][dateKey] = [];
        availabilityByUserDate[avail.userId][dateKey].push({ isAvailable: avail.isAvailable ?? true });
      }

      const allWorkPatterns = await db.select().from(userWorkPatterns);
      const workPatternsByUser: Record<string, Record<number, string>> = {};
      for (const wp of allWorkPatterns) {
        if (!workPatternsByUser[wp.userId]) workPatternsByUser[wp.userId] = {};
        workPatternsByUser[wp.userId][(wp as any).dayOfWeek] = (wp as any).status;
      }

      const scoreWindow = new Date();
      scoreWindow.setDate(scoreWindow.getDate() - 90);
      const performanceScores = await db.select({
        userId: clockEvents.userId,
        totalPoints: sql<number>`COALESCE(SUM(${clockEvents.pointValue}), 0)::int`,
      }).from(clockEvents).where(gte(clockEvents.createdAt, scoreWindow)).groupBy(clockEvents.userId);
      const scoreMap: Record<string, number> = {};
      for (const s of performanceScores) scoreMap[s.userId] = s.totalPoints;

      // ── AI rules + special circumstances ───────────────────────────────────
      const allPromptRules = await db.select().from(aiSchedulingRules)
        .where(and(eq(aiSchedulingRules.storeId, storeId), eq(aiSchedulingRules.isEnabled, true)));
      const instructionsSingleton = allPromptRules.find(r => r.ruleType === 'custom_instructions');
      const activeRules = allPromptRules.filter(r => r.ruleType !== 'custom_instructions');
      const customAiInstructions = instructionsSingleton
        ? String(((instructionsSingleton.params as AiRuleParams).text) || '')
        : '';
      const enabledSpecialCircumstances = await db.select().from(specialCircumstances)
        .where(and(eq(specialCircumstances.storeId, storeId), eq(specialCircumstances.isEnabled, true)));

      // ── Employee list ───────────────────────────────────────────────────────
      const employeeList = allUsers.filter(u => u.showInSchedule !== false && u.eligibleForAutoScheduling !== false).map(u => {
        const userAvail: Record<string, any> = {};
        const userPatterns = workPatternsByUser[u.id] || {};
        for (const day of days) {
          const explicitAvail = availabilityByUserDate[u.id]?.[day.date];
          const workPattern = userPatterns[day.dayOfWeek];
          if (workPattern === 'hard_off') {
            userAvail[day.date] = 'HARD_OFF';
          } else if (explicitAvail) {
            const unavailable = explicitAvail.some(a => a.isAvailable === false);
            userAvail[day.date] = unavailable ? 'unavailable' : (workPattern === 'required' ? 'REQUIRED' : 'available');
          } else if (workPattern === 'required') {
            userAvail[day.date] = 'REQUIRED';
          } else if (workPattern === 'preferred_off') {
            userAvail[day.date] = 'preferred_off';
          } else {
            userAvail[day.date] = 'available';
          }
        }
        return {
          id: u.id,
          name: `${u.firstName || ''} ${u.lastName || ''}`.trim() || u.email || 'Unknown',
          availability: userAvail,
          targetWeeklyHours: u.targetWeeklyHours ? parseFloat(u.targetWeeklyHours) : null,
          performanceScore: scoreMap[u.id] ?? 0,
          classifications: (u.schedulingClassifications as string[] | null) || [],
        };
      });

      const shiftBlocks = (settings.shiftBlocks as any[]) || [];
      const closedDays = new Set<number>();
      for (const sh of storeHoursArray) { if (sh.isClosed) closedDays.add(sh.day); }
      const schedulableDays = days.filter(d => !closedDays.has(d.dayOfWeek));

      const storeHoursInfo = storeHoursArray.length === 7
        ? `\nSTORE HOURS:\n${storeHoursArray.map((sh: any) => {
            const dn = dayNames[sh.day];
            return sh.isClosed ? `${dn}: CLOSED` : `${dn}: ${sh.openTime} - ${sh.closeTime}`;
          }).join('\n')}\n`
        : '';

      const prompt = `You are a workforce scheduling AI that ONLY outputs valid JSON. No markdown, no explanations, no text before or after the JSON object.

SCHEDULING PRINCIPLES:
- Coverage priority: meet required headcount per shift block before considering fairness.
- Rest gaps: never schedule the same employee with fewer than 10 hours between shifts.
- Role sequencing: opening shifts require at least one Opener or Key Holder; closing shifts require at least one Closer or Key Holder.
- No clopening: do not assign an employee to a closing shift on day N and an opening shift on day N+1.
- New Hire pairing: any New Hire on a shift must share that shift with at least one Trainer.
- Target-hours priority: full-time employees must receive enough shifts to meet their weekly target.
- Fairness: distribute undesirable shifts evenly.
- Composite scoring tiebreaker: availability overlap (40%), 90-day performance score (40%), hours remaining toward target (20%).

DATA:
SHIFT BLOCKS: ${JSON.stringify(shiftBlocks.map((b: any) => ({ name: b.name, start: b.startTime, end: b.endTime })))}
${storeHoursInfo}
SCHEDULE PERIOD:
${schedulableDays.map(d => `${d.date} (${d.dayName}): revenue=$${d.predictedRevenue}, need ${d.requiredStaff} staff${d.matchedLastYearDate ? ` (matched ${d.matchedLastYearDate})` : ''}`).join('\n')}
${closedDays.size > 0 ? `\nCLOSED DAYS: ${days.filter(d => closedDays.has(d.dayOfWeek)).map(d => `${d.date} (${d.dayName})`).join(', ')}\n` : ''}
MIN STAFFING BY ZONE:
- Opening zone: ${settings.minStaffingPreHours ?? 1} employee(s)
- Peak zone: ${settings.minStaffingDuringHours ?? settings.minimumStaffing ?? 2} employee(s)
- Closing zone: ${settings.minStaffingPostHours ?? 1} employee(s)

EMPLOYEES:
${employeeList.map(e => {
  const targetInfo = e.targetWeeklyHours ? ` [TARGET: ${e.targetWeeklyHours}hrs/wk]` : '';
  const scoreInfo = ` [SCORE: ${e.performanceScore}]`;
  const classInfo = e.classifications.length > 0 ? ` [ROLES: ${e.classifications.join(', ')}]` : '';
  return `${e.name} (${e.id})${targetInfo}${scoreInfo}${classInfo}: ${Object.entries(e.availability).map(([date, status]) => `${date}=${status}`).join(', ')}`;
}).join('\n')}

AVAILABILITY STATUS KEY:
- REQUIRED = must be scheduled; HARD_OFF = must NOT be scheduled; preferred_off = prefer not to work; available = can work; unavailable = cannot work
${activeRules.length > 0 ? `\nCOVERAGE RULES:\n${activeRules.map((r, i) => {
  const p: AiRuleParams = (r.params as AiRuleParams) || {};
  switch (r.ruleType) {
    case 'opening_requires_classification': return `${i + 1}. Opening shift must include at least ${p.count || 1} employee(s) with [${p.classification || 'Key Holder'}] role.`;
    case 'closing_requires_classification': return `${i + 1}. Closing shift must include at least ${p.count || 1} employee(s) with [${p.classification || 'Closer'}] role.`;
    case 'no_clopening': return `${i + 1}. Avoid clopening.`;
    default: return `${i + 1}. ${r.ruleType}: ${JSON.stringify(p)}`;
  }
}).join('\n')}\n` : ''}${customAiInstructions ? `\nCUSTOM INSTRUCTIONS:\n${customAiInstructions}\n` : ''}${enabledSpecialCircumstances.length > 0 ? `\nSPECIAL CIRCUMSTANCES:\n${enabledSpecialCircumstances.map((c: any, i: number) => `${i + 1}. ${c.name}${c.description ? ': ' + c.description : ''}`).join('\n')}\n` : ''}
OUTPUT: Return ONLY a single JSON object. No text, no markdown.
Required format:
{"schedule":[{"date":"YYYY-MM-DD","employeeId":"id","employeeName":"Name","shiftBlock":"block name","startTime":"HH:MM","endTime":"HH:MM","reasoning":"brief reason"}],"summary":"Brief summary"}`;

      let parsedSchedule: any;
      await withAiContext({ feature: "ai.scheduling.prebuild", storeId, userId }, async () => {
        const aiResult = await anthropic.messages.create({
          model: "claude-sonnet-4-20250514",
          max_tokens: 16000,
          system: "You are a workforce scheduling AI. Respond with valid JSON only. No markdown, no explanations, no code fences. Your entire response must be a single JSON object starting with { and ending with }.",
          messages: [{ role: 'user', content: prompt }],
        });
        const aiContent = aiResult.content[0];
        if (aiContent.type !== 'text') throw new Error('Expected text response from Claude');
        let jsonStr = aiContent.text.trim();
        const codeBlockMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
        if (codeBlockMatch) jsonStr = codeBlockMatch[1].trim();
        if (!jsonStr.startsWith('{')) {
          const firstBrace = jsonStr.indexOf('{');
          if (firstBrace !== -1) jsonStr = jsonStr.slice(firstBrace);
        }
        const lastBrace = jsonStr.lastIndexOf('}');
        if (lastBrace !== -1 && lastBrace < jsonStr.length - 1) jsonStr = jsonStr.slice(0, lastBrace + 1);
        parsedSchedule = JSON.parse(jsonStr);
      });

      // ── Group validated entries by date ────────────────────────────────────
      const employeeIds = new Set(employeeList.map(e => e.id));
      const userMap: Record<string, typeof allUsers[0]> = {};
      for (const u of allUsers) userMap[u.id] = u;

      const validEntries = (parsedSchedule.schedule || []).filter((entry: any) => {
        if (!entry.date || !entry.employeeId || !entry.startTime || !entry.endTime) return false;
        if (!employeeIds.has(entry.employeeId)) return false;
        if (!/^\d{4}-\d{2}-\d{2}$/.test(entry.date)) return false;
        if (!/^\d{2}:\d{2}$/.test(entry.startTime) || !/^\d{2}:\d{2}$/.test(entry.endTime)) return false;
        return true;
      });

      const byDate: Record<string, any[]> = {};
      for (const entry of validEntries) {
        if (!byDate[entry.date]) byDate[entry.date] = [];
        byDate[entry.date].push(entry);
      }

      // ── Get store hours per day ────────────────────────────────────────────
      const getStoreHoursForDow = (dow: number) => {
        const sh = storeHoursArray.find((h: any) => h.day === dow);
        if (!sh || sh.isClosed) return { open: '09:00', close: '21:00' };
        return { open: sh.openTime || '09:00', close: sh.closeTime || '21:00' };
      };

      // ── Build upsert rows, then batch into a single statement ──────────────
      let skipped = 0;
      const employeeById = new Map(employeeList.map(e => [e.id, e]));
      const summaryText = typeof parsedSchedule.summary === 'string' ? parsedSchedule.summary.slice(0, 500) : '';
      const dataSource = salesData.length > 0 ? 'shopify' : 'synthetic';

      const upsertRows = days.flatMap(day => {
        if (closedDays.has(day.dayOfWeek)) return [];
        if (!force && existingDates.has(day.date)) { skipped++; return []; }

        const dayEntries = byDate[day.date] || [];
        const proposedShifts = dayEntries.map((entry: any) => {
          const emp = employeeById.get(entry.employeeId);
          const user = userMap[entry.employeeId];
          return {
            employeeId: entry.employeeId,
            employeeName: String(entry.employeeName || emp?.name || 'Unknown').slice(0, 200),
            profileImageUrl: user?.profileImageUrl || null,
            startTime: String(entry.startTime),
            endTime: String(entry.endTime),
            shiftBlock: String(entry.shiftBlock || '').slice(0, 100),
            rationale: String(entry.reasoning || '').slice(0, 500),
            revenue: day.predictedRevenue || 0,
          };
        });

        const scheduleData = {
          date: day.date,
          proposedShifts,
          historicalDate: day.matchedLastYearDate || '',
          dataSource,
          hourlyData: [],
          storeHours: getStoreHoursForDow(day.dayOfWeek),
          prebuildSummary: summaryText,
        };

        return [{ storeId, date: day.date, scheduleData: scheduleData as any }];
      });

      const daysPrebuilt = upsertRows.length;
      if (daysPrebuilt > 0) {
        await db.insert(aiSuggestedSchedules)
          .values(upsertRows)
          .onConflictDoUpdate({
            target: [aiSuggestedSchedules.storeId, aiSuggestedSchedules.date],
            set: {
              scheduleData: sql`EXCLUDED.schedule_data`,
              generatedAt: sql`NOW()`,
            },
          });
      }

      logger.info({ storeId, daysPrebuilt, skipped, force }, "[prebuild] completed");
      res.json({
        success: true,
        daysPrebuilt,
        skipped,
        message: `Pre-built suggestions for ${daysPrebuilt} day${daysPrebuilt !== 1 ? 's' : ''}${skipped > 0 ? ` (${skipped} already had suggestions — use force to overwrite)` : ''}.`,
      });
    } catch (error: any) {
      logger.error({ error: String(error) }, "[prebuild] error");
      if (error?.name === 'BudgetExceededError' || error?.constructor?.name === 'BudgetExceededError') {
        return res.status(402).json({ message: error.message || "AI spending budget exceeded." });
      }
      const msg = error instanceof Error ? error.message : "Failed to pre-build schedules";
      res.status(500).json({ message: msg });
    }
  });

  app.post("/api/ai-scheduling/apply", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const canApply = await resolveAnyPermission(userId, ['admin.manage_all', 'schedule.create'], storage);
      if (!canApply) {
        return res.status(403).json({ message: "Schedule creation permission required" });
      }

      const { scheduleEntries } = req.body;
      if (!scheduleEntries || !Array.isArray(scheduleEntries) || scheduleEntries.length === 0) {
        return res.status(400).json({ message: "Schedule entries are required" });
      }

      // Log only aggregate counts on entry — per-row employee IDs and
      // times are operational/PII-adjacent data that should not land in
      // application logs. Per-row detail still appears in [Taime/apply]
      // exit, but only for ROWS THAT WERE REJECTED, where we need it to
      // diagnose validator failures.
      console.log("[Taime/apply] entry", {
        entryCount: scheduleEntries.length,
      });

      // Scope employee authorization to the requester's store — prevents cross-tenant IDOR
      const { getAllStoreUserIds } = await import('../lib/permissionUtils');
      const applyStoreId = await tryResolveStoreIdForUser(userId);
      if (!applyStoreId) return res.status(403).json({ message: "No store associated with your account" });

      // Entitlement check (ADR-0011): applying AI-generated schedules is part of the
      // paid ai.scheduling feature.
      if (!await hasEntitlement(applyStoreId, "ai.scheduling")) {
        return res.status(403).json({ message: "Your plan does not include AI scheduling. Please upgrade to continue." });
      }

      const authorizedUserIds = await getAllStoreUserIds(applyStoreId);
      const validUserIds = new Set(authorizedUserIds);

      // Resolve store timezone so the wall-clock times the user picks
      // (e.g. "08:00" for an 8am store-local shift) are persisted as the
      // correct UTC instant. Without this, naive `new Date("YYYY-MM-DDTHH:mm:00")`
      // is parsed in the SERVER's local TZ (UTC on Replit), and an 8am
      // store-local shift gets stored as 08:00Z — which then renders as
      // 03:00/04:00 in the user's browser, the source of "shifts appear
      // collapsed at the top of the timeline" reports.
      const applyTzRow = await db.select({ timezone: workLocations.timezone })
        .from(workLocations).where(eq(workLocations.id, applyStoreId)).limit(1);
      const applyStoreTz = applyTzRow[0]?.timezone ?? 'America/New_York';
      const localToUtc = (dateStr: string, timeStr: string): Date => {
        // Interpret `${date}T${time}:00Z` as if it were UTC, then subtract
        // the store's TZ offset at that instant to land on the real UTC moment
        // when the local clock reads `time` on `date` in `applyStoreTz`.
        const naive = new Date(`${dateStr}T${timeStr}:00Z`);
        const offsetMin = getTimezoneOffsetMinutes(naive, applyStoreTz);
        return new Date(naive.getTime() - offsetMin * 60_000);
      };

      // TODO: remove after task #420. Track per-row drop reasons so a
      // "succeeded but wrote fewer rows than expected" trace tells us
      // exactly which row was rejected and why — eliminates the need to
      // infer from aggregate counts when reading the apply log.
      const rejectedEntries: Array<{
        index: number;
        employeeId: string | null;
        date: string | null;
        startTime: string | null;
        endTime: string | null;
        reason: string;
      }> = [];
      const validEntries = scheduleEntries
        .filter((entry: any, index: number) => {
          const reject = (reason: string) => {
            rejectedEntries.push({
              index,
              employeeId: entry?.employeeId ?? null,
              date: entry?.date ?? null,
              startTime: entry?.startTime ?? null,
              endTime: entry?.endTime ?? null,
              reason,
            });
            return false;
          };
          if (!entry.employeeId || !entry.date || !entry.startTime || !entry.endTime) {
            return reject("missing required field (employeeId/date/startTime/endTime)");
          }
          if (!validUserIds.has(entry.employeeId)) {
            return reject(`employeeId '${entry.employeeId}' not in requester's store`);
          }
          if (!/^\d{4}-\d{2}-\d{2}$/.test(entry.date)) {
            return reject(`date '${entry.date}' not in YYYY-MM-DD format`);
          }
          if (!/^\d{2}:\d{2}$/.test(entry.startTime) || !/^\d{2}:\d{2}$/.test(entry.endTime)) {
            return reject(`startTime '${entry.startTime}' or endTime '${entry.endTime}' not in HH:MM format`);
          }
          const st = localToUtc(entry.date, entry.startTime);
          const et = localToUtc(entry.date, entry.endTime);
          if (isNaN(st.getTime()) || isNaN(et.getTime())) {
            return reject("startTime or endTime parsed to NaN after timezone conversion");
          }
          return true;
        })
        .map((entry: any) => {
          const st = localToUtc(entry.date, entry.startTime);
          let et = localToUtc(entry.date, entry.endTime);
          // End-of-day shifts that wrap past midnight (rare for retail but
          // possible with the new "schedule past close" feature) — bump end
          // forward a day so the shift duration stays positive.
          if (et.getTime() <= st.getTime()) {
            et = new Date(et.getTime() + 24 * 60 * 60 * 1000);
          }
          return {
            userId: entry.employeeId,
            startTime: st,
            endTime: et,
            title: String(entry.shiftBlock || 'AI Generated Shift').slice(0, 100),
            description: String(entry.reasoning || 'Generated by AI scheduling').slice(0, 500),
            createdBy: userId,
            // Stamp the requester's store on every row so the schedule grid's
            // store-scoped GET (`/api/schedules` filters by locationId) actually
            // returns these saved shifts. Without this, applied shifts persist
            // but are invisible on the grid and the editor reverts to AI
            // suggestions on reopen — the cause of the "Schedule Approved but
            // grid is empty" + "saved shifts revert to suggested" bugs.
            locationId: applyStoreId,
            // Original wall-clock fields (date/start/end strings) — kept on the
            // mapped entry so that conflict skips can echo them back to the
            // client in the same shape the panel posted, no UTC→local round
            // trip required on the receiving side.
            _origDate: entry.date as string,
            _origStartTime: entry.startTime as string,
            _origEndTime: entry.endTime as string,
          };
        });

      // Dedup against the live `schedules` table BEFORE inserting. The panel
      // posts the FULL day's set of shifts on every Save (AI suggestions +
      // pending manuals + persisted-manuals), and a pure INSERT created a new
      // row for each entry every time — so a single shift could end up with
      // 6–8 identical rows after a few save cycles. Skipping any row that
      // already exists for the same (userId, startTime, endTime, locationId)
      // makes the endpoint idempotent for the panel-as-master flow.
      const skippedAsDuplicate: Array<{ userId: string; startTime: string; endTime: string }> = [];
      // Server-side overlap guard (Task #328). The panel runs the same check
      // against React-Query cache, but stale/uninitialized cache could let an
      // overlapping shift through. We re-run the overlap predicate against
      // the live `schedules` table here so the DB never accepts two
      // overlapping shifts for the same employee, regardless of what the
      // browser thought it had cached.
      const skippedAsConflict: Array<{
        employeeId: string;
        date: string;
        startTime: string;
        endTime: string;
        reason: string;
        existingStart: string;
        existingEnd: string;
      }> = [];
      let entriesToInsert = validEntries;
      if (validEntries.length > 0) {
        const userIds = Array.from(new Set(validEntries.map((e) => e.userId)));
        const minStart = new Date(Math.min(...validEntries.map((e) => e.startTime.getTime())));
        const maxEnd = new Date(Math.max(...validEntries.map((e) => e.endTime.getTime())));
        // Classic overlap predicate: any existing shift whose
        // startTime < pendingMaxEnd AND endTime > pendingMinStart could
        // collide with at least one pending entry. The previous "fully
        // contained in window" filter (gte start, lte end) missed shifts
        // that straddled the window boundaries.
        const existing = await db.select({
          userId: schedules.userId,
          startTime: schedules.startTime,
          endTime: schedules.endTime,
          locationId: schedules.locationId,
        })
          .from(schedules)
          .where(and(
            inArray(schedules.userId, userIds),
            lt(schedules.startTime, maxEnd),
            gt(schedules.endTime, minStart),
          ));
        const existingKeys = new Set(
          existing.map((r) => `${r.userId}|${r.startTime.toISOString()}|${r.endTime.toISOString()}|${r.locationId ?? ''}`),
        );
        // Group existing shifts by userId so the per-entry overlap scan is O(k)
        // in the user's existing-shift count, not O(N) in all existing rows.
        const existingByUser = new Map<string, Array<{ startTime: Date; endTime: Date }>>();
        for (const r of existing) {
          const arr = existingByUser.get(r.userId) ?? [];
          arr.push({ startTime: r.startTime, endTime: r.endTime });
          existingByUser.set(r.userId, arr);
        }
        entriesToInsert = validEntries.filter((e) => {
          const key = `${e.userId}|${e.startTime.toISOString()}|${e.endTime.toISOString()}|${e.locationId ?? ''}`;
          if (existingKeys.has(key)) {
            // Exact duplicate → silently skip (idempotent re-save flow).
            skippedAsDuplicate.push({
              userId: e.userId,
              startTime: e.startTime.toISOString(),
              endTime: e.endTime.toISOString(),
            });
            return false;
          }
          // Different times, same employee, overlapping window → conflict.
          const userExisting = existingByUser.get(e.userId) ?? [];
          const overlap = userExisting.find(
            (r) =>
              r.startTime.getTime() < e.endTime.getTime() &&
              r.endTime.getTime() > e.startTime.getTime(),
          );
          if (overlap) {
            skippedAsConflict.push({
              employeeId: e.userId,
              date: e._origDate,
              startTime: e._origStartTime,
              endTime: e._origEndTime,
              reason: 'overlaps_existing_schedule',
              existingStart: overlap.startTime.toISOString(),
              existingEnd: overlap.endTime.toISOString(),
            });
            return false;
          }
          // Also dedup within this batch (so two identical entries in one
          // payload don't both insert).
          existingKeys.add(key);
          return true;
        });
      }

      // Strip the _orig* helper fields before handing rows to storage — they
      // are only there to enrich the conflict skip list above, and would
      // otherwise be passed straight into the Drizzle insert.
      const inserts = entriesToInsert.map(({ _origDate, _origStartTime, _origEndTime, ...rest }) => rest);

      // Try the batch insert first (the fast path). If it fails with a
      // Postgres exclusion-constraint violation (code 23P01) from the
      // `schedules_no_overlap_per_user` constraint added in Task #432, that
      // means a concurrent request slipped a colliding row into the table
      // between our overlap-check SELECT and our INSERT. Fall back to
      // per-row inserts so we can persist the rows that DON'T conflict and
      // surface the rejected ones in the same `skipped[]` shape the
      // application-level guard already produces.
      let created: any[] = [];
      if (inserts.length > 0) {
        try {
          created = await storage.createSchedulesBatch(inserts);
        } catch (batchErr: unknown) {
          const pgErr = batchErr as { code?: string };
          if (pgErr?.code !== '23P01') throw batchErr;
          for (let i = 0; i < inserts.length; i++) {
            try {
              const [row] = await storage.createSchedulesBatch([inserts[i]]);
              created.push(row);
            } catch (rowErr: unknown) {
              const rowPgErr = rowErr as { code?: string };
              if (rowPgErr?.code === '23P01') {
                const e = entriesToInsert[i];
                skippedAsConflict.push({
                  employeeId: e.userId,
                  date: e._origDate,
                  startTime: e._origStartTime,
                  endTime: e._origEndTime,
                  reason: 'overlaps_existing_schedule',
                  // The DB constraint doesn't tell us which existing row
                  // collided, only that one did. Empty strings flag this as
                  // a race-detected conflict (vs the app-level guard which
                  // can echo the existing window).
                  existingStart: '',
                  existingEnd: '',
                });
              } else {
                throw rowErr;
              }
            }
          }
        }
      }

      // Aggregate counts only — per-row rejection reasons (which include
      // employeeId/date/time) are kept ONLY when validation actually dropped
      // rows, since that's the failure mode we need detail for. Successful
      // inserts log only counts to keep operational/PII-adjacent fields
      // out of the application log stream.
      console.log("[Taime/apply] exit", {
        receivedCount: scheduleEntries.length,
        validCount: validEntries.length,
        droppedByValidation: rejectedEntries.length,
        droppedAsDuplicate: skippedAsDuplicate.length,
        droppedAsConflict: skippedAsConflict.length,
        createdCount: created.length,
        ...(rejectedEntries.length > 0 ? { rejectedEntries } : {}),
        ...(skippedAsConflict.length > 0 ? { skippedAsConflict } : {}),
      });

      // Task #712 — write-time prune of the cached AI suggestion. The GET
      // `/api/schedules/suggest` self-heals at read time, but a stale React
      // Query cache on either the saving client or another tab/device can
      // re-present already-scheduled employees and trigger "overlaps existing
      // shift" toasts on the next save attempt. Prune the cached
      // `proposedShifts` for every (store, date) we just wrote so the cache
      // is clean even if a client forgets to invalidate.
      const affectedDatesSet = new Set<string>();
      for (const e of entriesToInsert) {
        if (e._origDate) affectedDatesSet.add(e._origDate);
      }
      const affectedDates = Array.from(affectedDatesSet);
      if (affectedDates.length > 0) {
        try {
          const cachedRows = await db.select()
            .from(aiSuggestedSchedules)
            .where(and(
              eq(aiSuggestedSchedules.storeId, applyStoreId),
              inArray(aiSuggestedSchedules.date, affectedDates),
            ));
          for (const row of cachedRows) {
            const cached = row.scheduleData as any;
            if (!cached || !Array.isArray(cached.proposedShifts) || cached.proposedShifts.length === 0) continue;
            const scheduledIdsForDate = new Set(
              created
                .filter((c) => {
                  try { return new Date(c.startTime).toISOString().slice(0, 10) === row.date; }
                  catch { return false; }
                })
                .map((c) => c.userId),
            );
            // Also include rows we just inserted whose original date matches
            // (covers TZ edge cases where the UTC ISO date != the store-local date).
            for (const e of entriesToInsert) {
              if (e._origDate === row.date) scheduledIdsForDate.add(e.userId);
            }
            if (scheduledIdsForDate.size === 0) continue;
            const before = cached.proposedShifts.length;
            cached.proposedShifts = cached.proposedShifts.filter(
              (s: any) => !scheduledIdsForDate.has(s?.employeeId),
            );
            if (cached.proposedShifts.length !== before) {
              await db.update(aiSuggestedSchedules)
                .set({ scheduleData: cached })
                .where(and(
                  eq(aiSuggestedSchedules.storeId, applyStoreId),
                  eq(aiSuggestedSchedules.date, row.date),
                ));
            }
          }
        } catch (pruneErr) {
          console.warn("[Taime/apply] write-time AI cache prune failed:", pruneErr);
        }
      }

      // Single consolidated WS broadcast — clients invalidate `/api/schedules` once.
      // Task #712 — include `dates` (store-local YYYY-MM-DD) so listening
      // clients can precisely invalidate `["/api/schedules/suggest", date]`
      // for each affected day instead of nuking the whole suggest cache.
      const broadcastIds = created.map(c => c.id);
      sendToUsers(
        await computeScheduleStoreRecipients(applyStoreId, getAllStoreUserIds),
        { type: 'schedules_bulk_created', data: { ids: broadcastIds, schedules: created, dates: affectedDates } },
      );

      res.json({
        success: true,
        schedulesCreated: created.length,
        // Stable contract for bulk-undo toast and UI follow-ups (Task #387 B4)
        created,
        // Task #328: server-side overlap guard. The panel surfaces these in
        // the post-save toast so the manager knows exactly which shifts the
        // server refused to write and why.
        skipped: skippedAsConflict,
      });
    } catch (error) {
      console.error("Error applying AI schedule:", error);
      res.status(500).json({ message: "Failed to apply schedule" });
    }
  });

  app.get("/api/ai-scheduling/roster", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const isAdmin = await resolveAnyPermission(userId, ['admin.manage_all', 'schedule.create'], storage);
      if (!isAdmin) {
        return res.status(403).json({ message: "Admin access required" });
      }

      const allUsers = await db.select({
        id: users.id,
        firstName: users.firstName,
        lastName: users.lastName,
        email: users.email,
        employmentType: users.employmentType,
        showInSchedule: users.showInSchedule,
        targetWeeklyHours: users.targetWeeklyHours,
        roleId: users.roleId,
        isActive: users.isActive,
      }).from(users).where(eq(users.isActive, true));

      const allRoles = await db.select().from(roles);
      const roleMap = Object.fromEntries(allRoles.map(r => [r.id, r.name]));

      const roster = allUsers.map(u => ({
        id: u.id,
        name: `${u.firstName || ''} ${u.lastName || ''}`.trim() || u.email || 'Unknown',
        email: u.email,
        employmentType: u.employmentType,
        roleName: u.roleId ? roleMap[u.roleId] || 'Unknown' : 'No Role',
        showInSchedule: u.showInSchedule ?? true,
        targetWeeklyHours: u.targetWeeklyHours ? parseFloat(u.targetWeeklyHours) : null,
      }));

      res.json(roster);
    } catch (error) {
      console.error("Error fetching scheduling roster:", error);
      res.status(500).json({ message: "Failed to fetch roster" });
    }
  });

  app.put("/api/ai-scheduling/roster/:employeeId", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const isAdmin = await resolveAnyPermission(userId, ['admin.manage_all', 'schedule.create'], storage);
      if (!isAdmin) {
        return res.status(403).json({ message: "Admin access required" });
      }

      const { employeeId } = req.params;
      const { showInSchedule, targetWeeklyHours } = req.body;

      const updateData: any = {};
      if (typeof showInSchedule === 'boolean') {
        updateData.showInSchedule = showInSchedule;
      }
      if (targetWeeklyHours !== undefined) {
        if (targetWeeklyHours === null) {
          updateData.targetWeeklyHours = null;
        } else {
          const parsed = parseFloat(targetWeeklyHours);
          if (isNaN(parsed) || parsed < 0 || parsed > 80) {
            return res.status(400).json({ message: "Target weekly hours must be between 0 and 80" });
          }
          updateData.targetWeeklyHours = String(Math.round(parsed * 2) / 2);
        }
      }

      if (Object.keys(updateData).length === 0) {
        return res.status(400).json({ message: "No valid fields to update" });
      }

      await db.update(users)
        .set(updateData)
        .where(eq(users.id, employeeId));

      res.json({ success: true });
    } catch (error) {
      console.error("Error updating roster entry:", error);
      res.status(500).json({ message: "Failed to update employee scheduling settings" });
    }
  });

  // ── Employee Classifications API ────────────────────────────────────────────

  app.get("/api/ai-scheduling/classifications", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const isAdmin = await resolveAnyPermission(userId, ['admin.manage_all', 'schedule.create'], storage);
      if (!isAdmin) return res.status(403).json({ message: "Admin access required" });

      // Scope to the requester's store to prevent cross-tenant data exposure
      const { tryResolveStoreIdForUser } = await import('../services/storeResolver');
      const { getAllStoreUserIds } = await import('../lib/permissionUtils');
      const storeId = await tryResolveStoreIdForUser(userId);
      if (!storeId) return res.status(403).json({ message: "No store associated with your account" });
      const authorizedUserIds = await getAllStoreUserIds(storeId);

      const allUsers = await db.select({
        id: users.id,
        firstName: users.firstName,
        lastName: users.lastName,
        email: users.email,
        isActive: users.isActive,
        showInSchedule: users.showInSchedule,
        schedulingClassifications: users.schedulingClassifications,
      }).from(users).where(and(eq(users.isActive, true), inArray(users.id, authorizedUserIds)));

      const classifications = allUsers.map(u => ({
        id: u.id,
        name: `${u.firstName || ''} ${u.lastName || ''}`.trim() || u.email || 'Unknown',
        email: u.email,
        showInSchedule: u.showInSchedule ?? true,
        classifications: (u.schedulingClassifications as string[] | null) || [],
      }));

      res.json(classifications);
    } catch (error) {
      console.error("Error fetching classifications:", error);
      res.status(500).json({ message: "Failed to fetch classifications" });
    }
  });

  app.patch("/api/ai-scheduling/classifications/:employeeId", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const isAdmin = await resolveAnyPermission(userId, ['admin.manage_all', 'schedule.create'], storage);
      if (!isAdmin) return res.status(403).json({ message: "Admin access required" });

      const { employeeId } = req.params;

      // Scope: verify the target employee belongs to the requester's store
      const { tryResolveStoreIdForUser } = await import('../services/storeResolver');
      const { getAllStoreUserIds } = await import('../lib/permissionUtils');
      const storeId = await tryResolveStoreIdForUser(userId);
      if (!storeId) return res.status(403).json({ message: "No store associated with your account" });
      const authorizedUserIds = await getAllStoreUserIds(storeId);
      if (!authorizedUserIds.includes(employeeId)) {
        return res.status(403).json({ message: "Employee not found in your store" });
      }

      const { classifications } = req.body;

      if (!Array.isArray(classifications)) {
        return res.status(400).json({ message: "classifications must be an array of strings" });
      }

      const sanitized = classifications
        .filter(c => typeof c === 'string')
        .map(c => c.trim())
        .filter(c => c.length > 0 && c.length <= 100)
        .slice(0, 20);

      await db.update(users)
        .set({ schedulingClassifications: sanitized })
        .where(eq(users.id, employeeId));

      res.json({ success: true, classifications: sanitized });
    } catch (error) {
      console.error("Error updating classifications:", error);
      res.status(500).json({ message: "Failed to update classifications" });
    }
  });

  // ── AI Scheduling Rules & Custom Instructions API ───────────────────────────

  app.get("/api/ai-scheduling/rules", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const isAdmin = await resolveAnyPermission(userId, ['admin.manage_all', 'schedule.create'], storage);
      if (!isAdmin) return res.status(403).json({ message: "Admin access required" });

      const { tryResolveStoreIdForUser } = await import('../services/storeResolver');
      const storeId = await tryResolveStoreIdForUser(userId);
      if (!storeId) return res.status(403).json({ message: "No store associated with your account" });

      const allStoreRows = await db.select().from(aiSchedulingRules)
        .where(eq(aiSchedulingRules.storeId, storeId))
        .orderBy(aiSchedulingRules.createdAt);

      // Custom instructions are stored as a special singleton row (ruleType='custom_instructions')
      // so they stay within the same store-scoped table and require no separate unscoped read.
      const instructionsRow = allStoreRows.find(r => r.ruleType === 'custom_instructions');
      const coverageRules = allStoreRows.filter(r => r.ruleType !== 'custom_instructions');
      const customAiInstructions = instructionsRow
        ? String((instructionsRow.params as AiRuleParams).text || '')
        : '';

      res.json({ rules: coverageRules, customAiInstructions });
    } catch (error) {
      console.error("Error fetching AI rules:", error);
      res.status(500).json({ message: "Failed to fetch AI rules" });
    }
  });

  app.put("/api/ai-scheduling/rules", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const isAdmin = await resolveAnyPermission(userId, ['admin.manage_all', 'schedule.create'], storage);
      if (!isAdmin) return res.status(403).json({ message: "Admin access required" });

      const { tryResolveStoreIdForUser } = await import('../services/storeResolver');
      const storeId = await tryResolveStoreIdForUser(userId);
      if (!storeId) return res.status(403).json({ message: "No store associated with your account" });

      const { rules, customAiInstructions } = req.body;

      // Build the replacement rows list
      const toInsert: (typeof aiSchedulingRules.$inferInsert)[] = [];

      if (Array.isArray(rules)) {
        for (const r of rules) {
          if (!r.ruleType || typeof r.ruleType !== 'string') continue;
          const typedParams: AiRuleParams = {
            count: typeof r.params?.count === 'number' ? r.params.count : undefined,
            classification: typeof r.params?.classification === 'string' ? r.params.classification : undefined,
          };
          toInsert.push({
            storeId,
            ruleType: String(r.ruleType).slice(0, 100),
            params: typedParams as Record<string, string | number | boolean>,
            isEnabled: typeof r.isEnabled === 'boolean' ? r.isEnabled : true,
          });
        }
      }

      // Store custom instructions as a store-scoped singleton row (no separate unscoped table)
      if (typeof customAiInstructions === 'string') {
        const sanitizedText = customAiInstructions.slice(0, 5000);
        const instructionsParams: AiRuleParams = { text: sanitizedText };
        toInsert.push({
          storeId,
          ruleType: 'custom_instructions',
          params: instructionsParams as Record<string, string | number | boolean>,
          isEnabled: true,
        });
      }

      // Atomically replace all rows for this store so a mid-request failure cannot
      // leave the store without rules (delete-then-insert wrapped in a transaction).
      await db.transaction(async (tx) => {
        await tx.delete(aiSchedulingRules).where(eq(aiSchedulingRules.storeId, storeId));
        if (toInsert.length > 0) {
          await tx.insert(aiSchedulingRules).values(toInsert);
        }
      });

      const updatedRows = await db.select().from(aiSchedulingRules)
        .where(eq(aiSchedulingRules.storeId, storeId))
        .orderBy(aiSchedulingRules.createdAt);

      const instructionsRow = updatedRows.find(r => r.ruleType === 'custom_instructions');
      const coverageRules = updatedRows.filter(r => r.ruleType !== 'custom_instructions');
      const savedInstructions = instructionsRow
        ? String((instructionsRow.params as AiRuleParams).text || '')
        : '';

      res.json({ rules: coverageRules, customAiInstructions: savedInstructions });
    } catch (error) {
      console.error("Error saving AI rules:", error);
      res.status(500).json({ message: "Failed to save AI rules" });
    }
  });

  app.get("/api/ai-scheduling/work-pattern-templates", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const isAdmin = await resolveAnyPermission(userId, ['admin.manage_all', 'schedule.create'], storage);
      if (!isAdmin) return res.status(403).json({ message: "Manager access required" });

      const templates = await db.select().from(workPatternTemplates).orderBy(workPatternTemplates.name);
      res.json(templates);
    } catch (error) {
      console.error("Error fetching work pattern templates:", error);
      res.status(500).json({ message: "Failed to fetch templates" });
    }
  });

  app.get("/api/ai-scheduling/work-patterns", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.id;
            const isAdmin = await resolveAnyPermission(userId, ['admin.manage_all', 'schedule.create'], storage);
      if (!isAdmin) {
        return res.status(403).json({ message: "Admin access required" });
      }

      const allUsers = await db.select().from(users).where(eq(users.isActive, true));
      const allPatterns = await db.select().from(userWorkPatterns);
      const allRoles = await db.select().from(roles);
      const roleMap = Object.fromEntries(allRoles.map(r => [r.id, r.name]));

      const patternsByUser: Record<string, any[]> = {};
      for (const p of allPatterns) {
        if (!patternsByUser[p.userId]) patternsByUser[p.userId] = [];
        patternsByUser[p.userId].push(p);
      }

      const result = allUsers.map(u => ({
        id: u.id,
        name: `${u.firstName || ''} ${u.lastName || ''}`.trim() || u.email || 'Unknown',
        roleName: u.roleId ? roleMap[u.roleId] || 'Unknown' : 'No Role',
        patterns: patternsByUser[u.id] || [],
      }));

      res.json(result);
    } catch (error) {
      console.error("Error fetching work patterns:", error);
      res.status(500).json({ message: "Failed to fetch work patterns" });
    }
  });

  app.put("/api/ai-scheduling/work-patterns/:employeeId", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.id;
            const isAdmin = await resolveAnyPermission(userId, ['admin.manage_all', 'schedule.create'], storage);
      if (!isAdmin) {
        return res.status(403).json({ message: "Admin access required" });
      }

      const { employeeId } = req.params;
      const { patterns, templateId } = req.body;

      if (!patterns || !Array.isArray(patterns) || patterns.length !== 7) {
        return res.status(400).json({ message: "Must provide patterns for all 7 days" });
      }

      const validStatuses = ['required', 'available', 'preferred_off', 'hard_off'];
      for (const p of patterns) {
        if (typeof p.day !== 'number' || p.day < 0 || p.day > 6) {
          return res.status(400).json({ message: "Invalid day of week" });
        }
        if (!validStatuses.includes(p.status)) {
          return res.status(400).json({ message: `Invalid status: ${p.status}` });
        }
      }

      await db.delete(userWorkPatterns).where(eq(userWorkPatterns.userId, employeeId));

      const values = patterns.map((p: any) => ({
        userId: employeeId,
        dayOfWeek: p.day,
        status: p.status,
        templateId: templateId || null,
      }));

      await db.insert(userWorkPatterns).values(values as any);

      res.json({ success: true });
    } catch (error) {
      console.error("Error updating work patterns:", error);
      res.status(500).json({ message: "Failed to update work patterns" });
    }
  });

  app.post("/api/ai-scheduling/work-patterns/bulk-apply", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.id;
            const isAdmin = await resolveAnyPermission(userId, ['admin.manage_all', 'schedule.create'], storage);
      if (!isAdmin) {
        return res.status(403).json({ message: "Admin access required" });
      }

      const { employeeIds, patterns, templateId } = req.body;

      if (!employeeIds || !Array.isArray(employeeIds) || employeeIds.length === 0) {
        return res.status(400).json({ message: "Must provide at least one employee ID" });
      }
      if (!patterns || !Array.isArray(patterns) || patterns.length !== 7) {
        return res.status(400).json({ message: "Must provide patterns for all 7 days" });
      }

      await db.delete(userWorkPatterns).where(inArray(userWorkPatterns.userId, employeeIds));

      const values = employeeIds.flatMap((empId: string) =>
        patterns.map((p: any) => ({
          userId: empId,
          dayOfWeek: p.day,
          status: p.status,
          templateId: templateId || null,
        }))
      );

      await db.insert(userWorkPatterns).values(values as any);

      res.json({ success: true, updated: employeeIds.length });
    } catch (error) {
      console.error("Error bulk applying work patterns:", error);
      res.status(500).json({ message: "Failed to apply patterns" });
    }
  });

  // ── Today's Availability Ranking ─────────────────────────────────────────────
  app.get("/api/schedules/today-availability", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.id;
            const isAdmin = await resolveAnyPermission(userId, ['admin.manage_all', 'schedule.view_all', 'schedule.create'], storage);
      if (!isAdmin) return res.status(403).json({ message: "Manager access required" });

      const { tryResolveStoreIdForUser } = await import('../services/storeResolver');
      const { getAllStoreUserIds } = await import('../lib/permissionUtils');

      const storeId = await tryResolveStoreIdForUser(userId);
      if (!storeId) return res.json({ members: [], coverage: [], storeHours: null });

      const storeUserIds = await getAllStoreUserIds(storeId);
      if (storeUserIds.length === 0) return res.json({ members: [], coverage: [], storeHours: null });

      // Date parameter (default: today)
      const dateParam = (req.query.date as string) || new Date().toISOString().split('T')[0];
      const dateObj = new Date(dateParam + 'T12:00:00Z');
      const dow = dateObj.getUTCDay();

      // Fetch settings for store hours (per-store; Task #435)
      const settingsResult = await db.select().from(aiSchedulingSettings)
        .where(eq(aiSchedulingSettings.storeId, storeId))
        .limit(1);
      const settings = settingsResult[0];
      const storeHoursArray = ((settings?.storeHours as any[]) || []);
      const todayHours = storeHoursArray.find((sh: any) => sh.day === dow);

      // Fetch users (active, showInSchedule)
      const allUsers = await db.select({
        id: users.id,
        firstName: users.firstName,
        lastName: users.lastName,
        email: users.email,
        profileImageUrl: users.profileImageUrl,
        targetWeeklyHours: users.targetWeeklyHours,
        hourlyRate: users.hourlyRate,
        roleId: users.roleId,
        showInSchedule: users.showInSchedule,
      }).from(users).where(and(eq(users.isActive, true), inArray(users.id, storeUserIds)));

      const showableUsers = allUsers.filter(u => u.showInSchedule !== false);

      // Fetch roles
      const allRoles = await db.select().from(roles);
      const roleMap = Object.fromEntries(allRoles.map(r => [r.id, r]));

      // Fetch availability: templates, overrides, time-off
      const [templates, overrides, allTimeOff] = await Promise.all([
        storage.getAvailabilityTemplatesForUsers(storeUserIds),
        storage.getAvailabilityOverridesForUsers(storeUserIds, dateParam, dateParam),
        storage.getTimeOffRequests(),
      ]);
      const templateByUser: Record<string, typeof templates[0]> = {};
      for (const t of templates) templateByUser[t.userId] = t;
      const overridesByUser: Record<string, typeof overrides[0]> = {};
      for (const o of overrides) overridesByUser[o.userId] = o;

      // Performance scores (last 90 days)
      const scoreWindow = new Date();
      scoreWindow.setDate(scoreWindow.getDate() - 90);
      const performanceRows = await db
        .select({
          userId: clockEvents.userId,
          totalPoints: sql<number>`COALESCE(SUM(${clockEvents.pointValue}), 0)::int`,
        })
        .from(clockEvents)
        .where(gte(clockEvents.createdAt, scoreWindow))
        .groupBy(clockEvents.userId);
      const scoreMap: Record<string, number> = {};
      for (const s of performanceRows) scoreMap[s.userId] = s.totalPoints;

      // Scheduled hours this pay week (Mon→Sun surrounding dateParam)
      const weekStart = new Date(dateObj);
      const weekDow = weekStart.getUTCDay();
      weekStart.setUTCDate(weekStart.getUTCDate() - (weekDow === 0 ? 6 : weekDow - 1));
      weekStart.setUTCHours(0, 0, 0, 0);
      const weekEnd = new Date(weekStart);
      weekEnd.setUTCDate(weekEnd.getUTCDate() + 6);
      weekEnd.setUTCHours(23, 59, 59, 999);

      const weekSchedules = await db.select({
        userId: schedules.userId,
        startTime: schedules.startTime,
        endTime: schedules.endTime,
      }).from(schedules).where(and(
        gte(schedules.startTime, weekStart),
        lte(schedules.endTime, weekEnd),
        inArray(schedules.userId, storeUserIds),
      ));

      const scheduledHoursMap: Record<string, number> = {};
      for (const s of weekSchedules) {
        const h = (new Date(s.endTime).getTime() - new Date(s.startTime).getTime()) / (1000 * 60 * 60);
        scheduledHoursMap[s.userId] = (scheduledHoursMap[s.userId] || 0) + h;
      }

      // Today's schedule (to compute per-hour scheduled coverage)
      const todayStart = new Date(dateParam + 'T00:00:00Z');
      const todayEnd = new Date(dateParam + 'T23:59:59Z');
      const todayScheduleRows = await db.select().from(schedules).where(and(
        gte(schedules.startTime, todayStart),
        lte(schedules.startTime, todayEnd),
        inArray(schedules.userId, storeUserIds),
      ));

      // Store open/close hours for coverage timeline
      const storeOpen = todayHours && !todayHours.isClosed ? todayHours.openTime : '09:00';
      const storeClose = todayHours && !todayHours.isClosed ? todayHours.closeTime : '21:00';
      const [openH] = storeOpen.split(':').map(Number);
      const [closeH] = storeClose.split(':').map(Number);
      const storeHourCount = Math.max(1, closeH - openH);

      const timeToMinutes = (t: string): number => {
        const [h, m] = t.split(':').map(Number);
        return h * 60 + (m || 0);
      };

      const storeOpenMins = timeToMinutes(storeOpen);
      const storeCloseMins = timeToMinutes(storeClose);

      // Build coverage per hour (0 = openH, 1 = openH+1, etc.)
      const coverageAvailable: number[] = new Array(storeHourCount).fill(0);
      const coverageScheduled: number[] = new Array(storeHourCount).fill(0);

      // Build member list with computed availability
      const members: any[] = [];

      for (const u of showableUsers) {
        const uid = u.id;

        // Compute availability
        const hasTimeOff = allTimeOff.some(r => {
          if (r.status === 'cancelled' || r.userId !== uid) return false;
          const s = new Date(r.startDate); const e = new Date(r.endDate);
          return dateObj >= s && dateObj <= e;
        });

        let isAvailable = false;
        let availStart: string | null = null;
        let availEnd: string | null = null;
        let source = 'default';
        // Concrete time windows for snap-to-availability (Task #387 B5).
        // Today this is one window per member, but the field is an array so
        // future split-availability (e.g. 9-12 + 14-18) drops in cleanly.
        let windows: { start: string; end: string }[] = [];

        if (hasTimeOff) {
          isAvailable = false;
          source = 'time_off';
        } else {
          const override = overridesByUser[uid];
          if (override) {
            isAvailable = !override.unavailable;
            availStart = override.startTime ?? null;
            availEnd = override.endTime ?? null;
            source = 'override';
          } else {
            const tmpl = templateByUser[uid];
            const rawSlots = (tmpl?.slots ?? {}) as Record<string, any>;
            const slot = rawSlots[dow.toString()];
            if (!slot) {
              isAvailable = true;
              source = 'default';
            } else if ('available' in slot) {
              isAvailable = !!slot.available;
              availStart = slot.available ? (slot.startTime ?? null) : null;
              availEnd = slot.available ? (slot.endTime ?? null) : null;
              source = 'template';
            } else {
              isAvailable = !!(slot.morning || slot.afternoon || slot.evening);
              source = 'template';
            }
          }
        }

        // If available and no explicit window, default to store hours
        if (isAvailable) {
          if (!availStart) availStart = storeOpen;
          if (!availEnd) availEnd = storeClose;
          if (availStart && availEnd) windows = [{ start: availStart, end: availEnd }];
        }

        // Compute overlap with store hours
        let overlapHours = 0;
        let overlapPct = 0;
        if (isAvailable && availStart && availEnd) {
          const aStartMins = Math.max(timeToMinutes(availStart), storeOpenMins);
          const aEndMins = Math.min(timeToMinutes(availEnd), storeCloseMins);
          overlapHours = Math.max(0, (aEndMins - aStartMins) / 60);
          overlapPct = storeHourCount > 0 ? overlapHours / storeHourCount : 0;
        }

        // Performance score (normalize 0–100)
        const rawScore = scoreMap[uid] ?? 0;
        const maxScore = 500;
        const normalizedScore = Math.min(100, Math.round((rawScore / maxScore) * 100));

        // Scheduled hours this week
        const scheduledHours = scheduledHoursMap[uid] || 0;
        const targetHours = u.targetWeeklyHours ? parseFloat(u.targetWeeklyHours) : 40;
        const hoursRemaining = Math.max(0, targetHours - scheduledHours);
        const hoursRemainingFactor = targetHours > 0 ? hoursRemaining / targetHours : 1;

        // Composite score: overlap (40%) + perf (40%) + hoursRemaining (20%)
        const compositeScore = isAvailable
          ? Math.round((overlapPct * 0.4 + (normalizedScore / 100) * 0.4 + hoursRemainingFactor * 0.2) * 100)
          : 0;

        // Update per-hour coverage
        if (isAvailable && availStart && availEnd) {
          const aStartMins = timeToMinutes(availStart);
          const aEndMins = timeToMinutes(availEnd);
          for (let h = 0; h < storeHourCount; h++) {
            const hourStartMins = storeOpenMins + h * 60;
            const hourEndMins = hourStartMins + 60;
            if (aStartMins < hourEndMins && aEndMins > hourStartMins) {
              coverageAvailable[h]++;
            }
          }
        }

        // Check scheduled today
        const todayShifts = todayScheduleRows.filter(s => s.userId === uid);
        for (const shift of todayShifts) {
          const shiftStartMins = (new Date(shift.startTime).getUTCHours() * 60 + new Date(shift.startTime).getUTCMinutes());
          const shiftEndMins = (new Date(shift.endTime).getUTCHours() * 60 + new Date(shift.endTime).getUTCMinutes());
          for (let h = 0; h < storeHourCount; h++) {
            const hourStartMins = storeOpenMins + h * 60;
            const hourEndMins = hourStartMins + 60;
            if (shiftStartMins < hourEndMins && shiftEndMins > hourStartMins) {
              coverageScheduled[h]++;
            }
          }
        }

        const role = u.roleId ? roleMap[u.roleId] : null;

        members.push({
          userId: uid,
          name: `${u.firstName || ''} ${u.lastName || ''}`.trim() || u.email || 'Unknown',
          firstName: u.firstName,
          lastName: u.lastName,
          profileImageUrl: u.profileImageUrl,
          roleName: role?.displayName || role?.name || 'Employee',
          isAvailable,
          availableFrom: availStart,
          availableTo: availEnd,
          overlapHours: Math.round(overlapHours * 10) / 10,
          compositeScore,
          performanceScore: normalizedScore,
          scheduledHoursThisWeek: Math.round(scheduledHours * 10) / 10,
          targetWeeklyHours: u.targetWeeklyHours ? parseFloat(u.targetWeeklyHours) : null,
          source,
          windows,
          hourlyRate: u.hourlyRate ? parseFloat(u.hourlyRate) : null,
          roleId: u.roleId,
        });
      }

      // Sort: available first, then by composite score descending
      members.sort((a, b) => {
        if (a.isAvailable !== b.isAvailable) return b.isAvailable ? 1 : -1;
        return b.compositeScore - a.compositeScore;
      });

      // Build hourly coverage timeline
      const coverage = Array.from({ length: storeHourCount }, (_, i) => ({
        hour: openH + i,
        label: `${((openH + i) % 12) || 12}${(openH + i) < 12 ? 'am' : 'pm'}`,
        available: coverageAvailable[i],
        scheduled: coverageScheduled[i],
      }));

      // Team readiness: scheduled hours / available hours today
      const totalAvailableHours = members.filter(m => m.isAvailable).reduce((s, m) => s + m.overlapHours, 0);
      const totalScheduledHours = todayScheduleRows.reduce((s, r) => {
        return s + (new Date(r.endTime).getTime() - new Date(r.startTime).getTime()) / (1000 * 60 * 60);
      }, 0);
      const readinessPct = totalAvailableHours > 0
        ? Math.round((totalScheduledHours / totalAvailableHours) * 100)
        : 0;

      res.json({
        date: dateParam,
        storeHours: todayHours ? { open: storeOpen, close: storeClose, isClosed: !!todayHours.isClosed } : null,
        members,
        coverage,
        readinessPct,
      });
    } catch (error) {
      console.error("Error fetching today-availability:", error);
      res.status(500).json({ message: "Failed to fetch availability ranking" });
    }
  });

  // ── Historical Shopify Sales by Hour ────────────────────────────────────────
  app.get("/api/schedules/historical-sales", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.id;
            const isAdmin = await resolveAnyPermission(userId, ['admin.manage_all', 'schedule.view_all', 'schedule.create'], storage);
      if (!isAdmin) return res.status(403).json({ message: "Manager access required" });

      const dateParam = (req.query.date as string) || new Date().toISOString().split('T')[0];
      const targetDate = new Date(dateParam + 'T12:00:00Z');
      const targetDow = targetDate.getUTCDay();

      // Use 52 weeks ago (same day of week, 364 days) as the historical comparison date.
      const historicalDate = sameWeekdayLastYear(targetDate);
      let historicalDateStr = historicalDate.toISOString().slice(0, 10);

      // Resolve Shopify credentials for this user (enables auto-backfill)
      const shopCreds = await getShopCredentialsForUser(userId);

      // Fetch store timezone for accurate local-time hour bucketing
      const tzRow = await db.select({ timezone: workLocations.timezone })
        .from(users).innerJoin(workLocations, eq(users.locationId, workLocations.id))
        .where(eq(users.id, userId)).limit(1);
      const storeTimezone = tzRow[0]?.timezone ?? 'America/Chicago';
      const shopDomain = shopCreds?.shopDomain ?? null;

      let hourlyRevenue: number[] = new Array(24).fill(0);
      let dataSource = 'synthetic';

      if (shopDomain) {
        const weights = [0,0,0,0,0,0,0.01,0.02,0.05,0.08,0.09,0.10,0.10,0.09,0.08,0.07,0.07,0.06,0.06,0.05,0.04,0.03,0.01,0];

        const tryFetchRevenue = async (dateStr: string): Promise<{ found: boolean; source: 'actual' | 'estimated' }> => {
          // Per-order window must use the store's local calendar day so a
          // CST/CDT store doesn't lose its evening orders to the next UTC
          // day (which is exactly what produced the wrong tiny historical
          // total). The daily-aggregate row is still keyed on UTC midnight
          // of `dateStr`, kept as `dailyKey` below for the lookup.
          const { start, endExclusive } = localDayBoundsUtc(dateStr, storeTimezone);
          const dailyKey = new Date(dateStr + 'T00:00:00Z');

          // Auto-backfill: pull from Shopify GraphQL if no per-order rows exist for this date
          const existingCount = await db.select({ cnt: count() })
            .from(shopifyOrders)
            .where(and(
              eq(shopifyOrders.shopDomain, shopDomain),
              gte(shopifyOrders.orderCreatedAt, start),
              lt(shopifyOrders.orderCreatedAt, endExclusive),
            ));
          if ((existingCount[0]?.cnt ?? 0) === 0 && shopCreds) {
            try {
              console.log(`[historical-sales] auto-backfill: fetching Shopify orders for ${dateStr} (tz=${storeTimezone})`);
              await backfillDayOrdersFromShopify(shopDomain, shopCreds.service, dateStr, storeTimezone);
            } catch (backfillErr) {
              console.warn(`[historical-sales] auto-backfill failed (non-fatal): ${backfillErr}`);
            }
          }

          // Query orders (may have just been populated by backfill)
          const orders = await db.select({
            totalPrice: shopifyOrders.totalPrice,
            orderCreatedAt: shopifyOrders.orderCreatedAt,
          }).from(shopifyOrders).where(and(
            eq(shopifyOrders.shopDomain, shopDomain),
            gte(shopifyOrders.orderCreatedAt, start),
            lt(shopifyOrders.orderCreatedAt, endExclusive),
          ));
          if (orders.length > 0) {
            for (const order of orders) {
              if (!order.orderCreatedAt || !order.totalPrice) continue;
              // Use store's local timezone so hours align with what the team observes
              const h = getLocalHourInTz(new Date(order.orderCreatedAt), storeTimezone);
              hourlyRevenue[h] += parseFloat(order.totalPrice);
            }
            return { found: true, source: 'actual' };
          }

          // Fall back to daily aggregate (estimated hour distribution)
          const dailySales = await db.select({ totalRevenue: shopifyDailySales.totalRevenue })
            .from(shopifyDailySales)
            .where(and(eq(shopifyDailySales.shopDomain, shopDomain), eq(shopifyDailySales.date, dailyKey)))
            .limit(1);
          const dailyTotal = dailySales[0]?.totalRevenue ? parseFloat(dailySales[0].totalRevenue) : 0;
          if (dailyTotal > 0) {
            for (let h = 0; h < 24; h++) hourlyRevenue[h] = Math.round(dailyTotal * weights[h] * 100) / 100;
            return { found: true, source: 'estimated' };
          }
          return { found: false, source: 'estimated' };
        };

        // Fetch and process the 52-week comparison date
        const result = await tryFetchRevenue(historicalDateStr);
        dataSource = result.found ? result.source : 'synthetic';
      }

      // Get AI scheduling settings for staffing tiers (per-store; Task #435)
      const histStoreId = await resolveSettingsStoreId(userId, undefined);
      const settingsResult = histStoreId
        ? await db.select().from(aiSchedulingSettings)
            .where(eq(aiSchedulingSettings.storeId, histStoreId))
            .limit(1)
        : [];
      const settings = settingsResult[0];
      const staffingTiers = ((settings?.staffingTiers as any[]) || [
        { minRevenue: 0, maxRevenue: 2000, employeeCount: 2 },
        { minRevenue: 2001, maxRevenue: 5000, employeeCount: 3 },
        { minRevenue: 5001, maxRevenue: 10000, employeeCount: 5 },
      ]);
      // Zone-aware minimums — fall back to minimumStaffing for backward compat
      const histMinPre = settings?.minStaffingPreHours ?? settings?.minimumStaffing ?? 1;
      const histMinDuring = settings?.minStaffingDuringHours ?? settings?.minimumStaffing ?? 2;
      const histMinPost = settings?.minStaffingPostHours ?? settings?.minimumStaffing ?? 1;

      // Determine zone boundaries from configured shift blocks
      const histShiftBlocks: any[] = ((settings?.shiftBlocks as any[]) || [
        { name: 'Morning', startTime: '09:00', endTime: '14:00' },
        { name: 'Afternoon', startTime: '14:00', endTime: '21:00' },
      ]).sort((a: any, b: any) => a.startTime.localeCompare(b.startTime));

      function hourToZoneFloor(h: number): number {
        if (histShiftBlocks.length === 0) return histMinDuring;
        const [fS] = histShiftBlocks[0].startTime.split(':').map(Number);
        const [fE] = histShiftBlocks[0].endTime.split(':').map(Number);
        const [lS] = histShiftBlocks[histShiftBlocks.length - 1].startTime.split(':').map(Number);
        if (h >= fS && h < fE) return histMinPre;   // Opening zone = first block
        if (h >= lS) return histMinPost;             // Closing zone = last block
        return histMinDuring;                         // Peak zone = middle
      }

      const storeHoursArray = ((settings?.storeHours as any[]) || []);
      const todayHours = storeHoursArray.find((sh: any) => sh.day === targetDow);
      const storeOpen = todayHours && !todayHours.isClosed ? todayHours.openTime : '09:00';
      const storeClose = todayHours && !todayHours.isClosed ? todayHours.closeTime : '21:00';
      const [openH] = storeOpen.split(':').map(Number);
      const [closeH] = storeClose.split(':').map(Number);

      // The per-order sum from shopify_orders IS the authoritative daily
      // total — the daily aggregate is just a cached recomputation of the
      // same per-order rows (see backfillDayOrdersFromShopify), not an
      // independent figure from Shopify analytics. An earlier version of
      // this code overrode with the aggregate when it was strictly greater,
      // assuming a larger value meant "more of the day covered" — but in
      // practice a larger aggregate just means the per-order table had
      // duplicates at the time the aggregate was last written, so reading
      // it back inflated the historical total to several × the real figure.
      const dailyTotal = hourlyRevenue.reduce((s, v) => s + v, 0);
      const avgHourlyRevenue = dailyTotal / Math.max(1, closeH - openH);

      // Build hourly breakdown for store hours only
      const hourlyData: Array<{
        hour: number;
        label: string;
        revenue: number;
        isPeak: boolean;
        suggestedStaff: number;
      }> = [];

      for (let h = openH; h < closeH; h++) {
        const revenue = hourlyRevenue[h];
        const isPeak = revenue > avgHourlyRevenue * 1.3;
        const zoneFloor = hourToZoneFloor(h);
        const suggestedStaff = getStaffingForRevenue(revenue, staffingTiers, zoneFloor);
        hourlyData.push({
          hour: h,
          label: `${(h % 12) || 12}${h < 12 ? 'am' : 'pm'}`,
          revenue: Math.round(revenue * 100) / 100,
          isPeak,
          suggestedStaff,
        });
      }

      console.info(`[historical-sales] date=${dateParam} historicalDate=${historicalDateStr} dataSource=${dataSource} dailyTotal=${Math.round(dailyTotal * 100) / 100}`);

      res.json({
        date: dateParam,
        historicalDate: historicalDateStr,
        dataSource,
        dailyTotal: Math.round(dailyTotal * 100) / 100,
        hourlyData,
        storeHours: { open: storeOpen, close: storeClose },
      });
    } catch (error) {
      console.error("Error fetching historical sales:", error);
      res.status(500).json({ message: "Failed to fetch historical sales" });
    }
  });

  // ── Suggested Schedule Generation ──────────────────────────────────────────
  // GET /api/schedules/suggest — load a previously saved AI-generated schedule
  app.get("/api/schedules/suggest", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const isAdmin = await resolveAnyPermission(userId, ['admin.manage_all', 'schedule.create'], storage);
      if (!isAdmin) return res.status(403).json({ message: "Manager access required" });

      const dateParam = (req.query.date as string) || new Date().toISOString().split('T')[0];
      const { tryResolveStoreIdForUser } = await import('../services/storeResolver');
      const { getAllStoreUserIds } = await import('../lib/permissionUtils');
      const storeId = await tryResolveStoreIdForUser(userId);
      if (!storeId) return res.json(null);
      const rows = await db.select()
        .from(aiSuggestedSchedules)
        .where(and(eq(aiSuggestedSchedules.storeId, storeId), eq(aiSuggestedSchedules.date, dateParam)))
        .limit(1);
      if (rows.length === 0) return res.json(null);

      const cached = rows[0].scheduleData as any;
      // Self-healing: drop any cached proposals for employees who already
      // have a saved schedule on this store for the same local day. Without
      // this, opening a day after Save shows the same shifts re-suggested
      // and flagged "already scheduled" — duplicating what the user just
      // approved. Use the store's local-day window so a CT/CDT store with
      // shifts that span the UTC midnight boundary still match correctly.
      try {
        if (cached && Array.isArray(cached.proposedShifts) && cached.proposedShifts.length > 0) {
          const tzRow = await db.select({ timezone: workLocations.timezone })
            .from(workLocations).where(eq(workLocations.id, storeId)).limit(1);
          const storeTz = tzRow[0]?.timezone ?? 'America/New_York';
          const { start: dayStart, endExclusive: dayEnd } = localDayBoundsUtc(dateParam, storeTz);
          const storeUserIds = await getAllStoreUserIds(storeId);
          if (storeUserIds.length > 0) {
            // Code-review fix: dayEnd is exclusive (next-local-midnight UTC),
            // so use lt(...) — lte() would wrongly include shifts starting at
            // exactly next-day midnight and over-prune. Also overlap-correct:
            // a shift overlaps the day iff `start < dayEnd && end > dayStart`,
            // which catches overnight shifts that start before dayStart.
            const todays = await db.select({ userId: schedules.userId })
              .from(schedules).where(and(
                inArray(schedules.userId, storeUserIds),
                lt(schedules.startTime, dayEnd),
                gt(schedules.endTime, dayStart),
              ));
            const scheduledIds = new Set(todays.map(r => r.userId));
            if (scheduledIds.size > 0) {
              const before = cached.proposedShifts.length;
              cached.proposedShifts = cached.proposedShifts.filter(
                (s: any) => !scheduledIds.has(s?.employeeId),
              );
              if (cached.proposedShifts.length !== before) {
                // Persist the pruned cache so subsequent reads stay fast and
                // we don't re-pay this filter cost on every modal open.
                await db.update(aiSuggestedSchedules)
                  .set({ scheduleData: cached })
                  .where(and(eq(aiSuggestedSchedules.storeId, storeId), eq(aiSuggestedSchedules.date, dateParam)));
              }
            }
          }
        }
      } catch (filterErr) {
        // Filtering is a best-effort; never let it block returning the cache
        console.warn("[suggest GET] already-scheduled filter failed:", filterErr);
      }

      return res.json(cached);
    } catch (err) {
      console.error("[suggest GET] error:", err);
      return res.json(null);
    }
  });

  // DELETE /api/schedules/suggest — clear a saved schedule so it can be regenerated
  app.delete("/api/schedules/suggest", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const isAdmin = await resolveAnyPermission(userId, ['admin.manage_all', 'schedule.create'], storage);
      if (!isAdmin) return res.status(403).json({ message: "Manager access required" });

      const dateParam = (req.query.date as string) || new Date().toISOString().split('T')[0];
      const { tryResolveStoreIdForUser } = await import('../services/storeResolver');
      const storeId = await tryResolveStoreIdForUser(userId);
      if (!storeId) return res.json({ success: false });
      await db.delete(aiSuggestedSchedules)
        .where(and(eq(aiSuggestedSchedules.storeId, storeId), eq(aiSuggestedSchedules.date, dateParam)));
      return res.json({ success: true });
    } catch (err) {
      console.error("[suggest DELETE] error:", err);
      return res.json({ success: false });
    }
  });

  // DELETE /api/schedules/suggest/shift — remove a single shift from the saved suggestion
  // Matches by employeeId + startTime + endTime to avoid index drift races.
  app.delete("/api/schedules/suggest/shift", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.id;
            const isAdmin = await resolveAnyPermission(userId, ['admin.manage_all', 'schedule.view_all', 'schedule.create'], storage);
      if (!isAdmin) return res.status(403).json({ message: "Manager access required" });

      const date = req.query.date as string;
      const employeeId = req.query.employeeId as string | undefined;
      const startTime = req.query.startTime as string | undefined;
      const endTime = req.query.endTime as string | undefined;
      if (!date || !startTime || !endTime) {
        return res.status(400).json({ message: "date, startTime, and endTime are required" });
      }

      const { tryResolveStoreIdForUser } = await import('../services/storeResolver');
      const storeId = await tryResolveStoreIdForUser(userId);
      if (!storeId) return res.status(403).json({ message: "No store associated with your account" });

      const rows = await db.select()
        .from(aiSuggestedSchedules)
        .where(and(eq(aiSuggestedSchedules.storeId, storeId), eq(aiSuggestedSchedules.date, date)))
        .limit(1);

      if (rows.length === 0) return res.json({ success: true, removed: 0 });

      const scheduleData = rows[0].scheduleData as any;
      if (!Array.isArray(scheduleData?.proposedShifts)) {
        return res.json({ success: true, removed: 0 });
      }

      const before = scheduleData.proposedShifts.length;
      scheduleData.proposedShifts = scheduleData.proposedShifts.filter((s: any) => {
        if (s.startTime !== startTime) return true;
        if (s.endTime !== endTime) return true;
        if (employeeId && s.employeeId !== employeeId) return true;
        return false;
      });
      const removed = before - scheduleData.proposedShifts.length;

      await db.update(aiSuggestedSchedules)
        .set({ scheduleData })
        .where(and(eq(aiSuggestedSchedules.storeId, storeId), eq(aiSuggestedSchedules.date, date)));

      return res.json({ success: true, removed });
    } catch (err) {
      console.error("[suggest DELETE shift] error:", err);
      return res.status(500).json({ message: "Failed to remove shift from suggestion" });
    }
  });

  // PUT /api/schedules/suggest — patch a single shift in the saved suggestion
  app.put("/api/schedules/suggest", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.id;
            const isAdmin = await resolveAnyPermission(userId, ['admin.manage_all', 'schedule.view_all', 'schedule.create'], storage);
      if (!isAdmin) return res.status(403).json({ message: "Manager access required" });

      const { date, shiftIndex, startTime, endTime, employeeId, employeeName, shiftBlock, rationale } = req.body;
      if (!date || typeof shiftIndex !== 'number') {
        return res.status(400).json({ message: "date and shiftIndex are required" });
      }

      const { tryResolveStoreIdForUser } = await import('../services/storeResolver');
      const storeId = await tryResolveStoreIdForUser(userId);
      if (!storeId) return res.status(403).json({ message: "No store associated with your account" });

      const rows = await db.select()
        .from(aiSuggestedSchedules)
        .where(and(eq(aiSuggestedSchedules.storeId, storeId), eq(aiSuggestedSchedules.date, date)))
        .limit(1);

      // shiftIndex === -1 means "append a new shift"
      if (shiftIndex === -1) {
        if (!employeeId || !employeeName || !startTime || !endTime) {
          return res.status(400).json({ message: "employeeId, employeeName, startTime, and endTime are required when appending" });
        }
        const newShift = {
          employeeId,
          employeeName,
          startTime,
          endTime,
          shiftBlock: shiftBlock || 'Manual',
          rationale: rationale || 'Manually added',
          revenue: 0,
        };
        if (rows.length === 0) {
          // No cache yet — create a minimal one containing just this shift
          const minimalSchedule = {
            date,
            proposedShifts: [newShift],
            historicalDate: '',
            dataSource: 'manual',
            hourlyData: [],
            storeHours: { open: '09:00', close: '21:00' },
          };
          await db.insert(aiSuggestedSchedules).values({ storeId, date, scheduleData: minimalSchedule });
        } else {
          const scheduleData = rows[0].scheduleData as any;
          if (!Array.isArray(scheduleData?.proposedShifts)) scheduleData.proposedShifts = [];
          // Dedup: if a proposed shift already exists for the same employee
          // at the same start/end time, treat the request as a no-op rather
          // than appending another card. Without this, repeated "+Add shift"
          // clicks (or callback storms during drag-resize) pile identical
          // cards into the cache — observed: 5 identical Sydney Wall cards
          // for the same date in the suggest cache.
          const dup = scheduleData.proposedShifts.find((s: any) =>
            s?.employeeId === newShift.employeeId &&
            s?.startTime === newShift.startTime &&
            s?.endTime === newShift.endTime,
          );
          if (dup) {
            return res.json({ success: true, shift: dup, deduped: true });
          }
          scheduleData.proposedShifts.push(newShift);
          await db.update(aiSuggestedSchedules)
            .set({ scheduleData })
            .where(and(eq(aiSuggestedSchedules.storeId, storeId), eq(aiSuggestedSchedules.date, date)));
        }
        return res.json({ success: true, shift: newShift });
      }

      if (rows.length === 0) return res.status(404).json({ message: "No saved suggestion found for this date" });

      const scheduleData = rows[0].scheduleData as any;
      if (!scheduleData?.proposedShifts?.[shiftIndex]) {
        return res.status(404).json({ message: "Shift index out of range" });
      }

      const shift = scheduleData.proposedShifts[shiftIndex];
      if (startTime) shift.startTime = startTime;
      if (endTime) shift.endTime = endTime;
      if (employeeId) shift.employeeId = employeeId;
      if (employeeName) shift.employeeName = employeeName;

      await db.update(aiSuggestedSchedules)
        .set({ scheduleData })
        .where(and(eq(aiSuggestedSchedules.storeId, storeId), eq(aiSuggestedSchedules.date, date)));

      return res.json({ success: true, shift });
    } catch (err) {
      console.error("[suggest PUT] error:", err);
      return res.status(500).json({ message: "Failed to update shift" });
    }
  });

  app.post("/api/schedules/suggest", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.id;
      logger.info({ userId, body: req.body }, "[suggest] request received");

            const isAdmin = await resolveAnyPermission(userId, ['admin.manage_all', 'schedule.view_all', 'schedule.create'], storage);
      if (!isAdmin) {
        logger.warn({ userId }, "[suggest] 403 — missing permission");
        return res.status(403).json({ message: "Manager access required" });
      }

      const { date, force } = req.body;
      const dateParam = date || new Date().toISOString().split('T')[0];

      // ── Resolve store and get availability data directly from DB ─────────────
      const { getAllStoreUserIds } = await import('../lib/permissionUtils');

      const storeId = await tryResolveStoreIdForUser(userId);
      if (!storeId) {
        logger.warn({ userId }, "[suggest] 403 — no store for user");
        return res.status(403).json({ message: "No store associated with your account" });
      }

      // Entitlement check (ADR-0011): /suggest is the AI scheduling
      // generation/cache endpoint — gate it on the paid ai.scheduling
      // feature. Run before the cache short-circuit so a downgraded store
      // can no longer access premium suggestions previously generated on a
      // higher plan.
      if (!await hasEntitlement(storeId, "ai.scheduling")) {
        return res.status(403).json({ message: "Your plan does not include AI scheduling. Please upgrade to continue." });
      }

      // Short-circuit: if a cached suggestion row already exists for this
      // store+date and the caller didn't explicitly request a regen, return
      // the cached payload without doing any AI/synthetic generation work.
      // This prevents the panel from silently regenerating suggestions every
      // time it's reopened after the GET endpoint's self-healing prune leaves
      // `proposedShifts` empty (Task #413). The explicit "Refresh AI
      // suggestions" button still works because the frontend sends
      // `force: true` in that path, which bypasses this guard.
      if (force !== true) {
        const cachedRows = await db.select()
          .from(aiSuggestedSchedules)
          .where(and(eq(aiSuggestedSchedules.storeId, storeId), eq(aiSuggestedSchedules.date, dateParam)))
          .limit(1);
        if (cachedRows.length > 0) {
          logger.info({ storeId, dateParam }, "[suggest] short-circuit — returning cached payload");
          const cachedPayload = cachedRows[0].scheduleData as Record<string, unknown>;
          return res.json({ ...cachedPayload, _fromCache: true });
        }
      }

      const storeUserIds = await getAllStoreUserIds(storeId);
      logger.info({ storeId, userCount: storeUserIds.length, dateParam, force: force === true }, "[suggest] store resolved");
      if (storeUserIds.length === 0) return res.json({ date: dateParam, proposedShifts: [], historicalDate: '', dataSource: 'synthetic', hourlyData: [], storeHours: { open: '09:00', close: '21:00' } });

      // ── Mirror today-availability data gathering exactly ─────────────────────
      const dateObj = new Date(dateParam + 'T12:00:00Z');
      const dow = dateObj.getUTCDay(); // numeric 0=Sun…6=Sat (matches today-availability)
      const dayOfWeekMap: Record<number, string> = {0:'sunday',1:'monday',2:'tuesday',3:'wednesday',4:'thursday',5:'friday',6:'saturday'};
      const todayDow = dayOfWeekMap[dow]; // used for storeHours in salesData below

      // Fetch AI settings for store hours (NUMERIC dow matching, mirrors today-availability)
      // Per-store (Task #435).
      const settingsResult2 = await db.select().from(aiSchedulingSettings)
        .where(eq(aiSchedulingSettings.storeId, storeId))
        .limit(1);
      const settings2 = settingsResult2[0];
      const storeHoursArray2 = ((settings2?.storeHours as any[]) || []);
      const todayHours2 = storeHoursArray2.find((sh: any) => sh.day === dow); // numeric match
      const storeOpen2 = todayHours2 && !todayHours2.isClosed ? todayHours2.openTime : '09:00';
      const storeClose2 = todayHours2 && !todayHours2.isClosed ? todayHours2.closeTime : '21:00';
      const [openH2] = storeOpen2.split(':').map(Number);
      const [closeH2] = storeClose2.split(':').map(Number);
      const storeHourCount2 = Math.max(1, closeH2 - openH2);

      const timeToMinutes2 = (t: string): number => { const [h, m] = t.split(':').map(Number); return h * 60 + (m || 0); };
      const storeOpenMins2 = timeToMinutes2(storeOpen2);
      const storeCloseMins2 = timeToMinutes2(storeClose2);

      // Get active users in store (same fields + showInSchedule filter as today-availability)
      const allStoreUsers = await db.select({
        id: users.id,
        firstName: users.firstName,
        lastName: users.lastName,
        profileImageUrl: users.profileImageUrl,
        targetWeeklyHours: users.targetWeeklyHours,
        showInSchedule: users.showInSchedule,
      }).from(users).where(and(eq(users.isActive, true), inArray(users.id, storeUserIds)));
      // Apply the same showInSchedule visibility filter as today-availability
      const storeUsers = allStoreUsers.filter(u => u.showInSchedule !== false);

      // Use same storage methods as today-availability for consistent availability resolution
      const [availTmplsRaw, availOverridesRaw, allTimeOff2] = await Promise.all([
        storage.getAvailabilityTemplatesForUsers(storeUserIds),
        storage.getAvailabilityOverridesForUsers(storeUserIds, dateParam, dateParam),
        storage.getTimeOffRequests(),
      ]);
      const templateByUser2: Record<string, typeof availTmplsRaw[0]> = {};
      for (const t of availTmplsRaw) templateByUser2[t.userId] = t;
      const overridesByUser2: Record<string, typeof availOverridesRaw[0]> = {};
      for (const o of availOverridesRaw) overridesByUser2[o.userId] = o;

      // Performance scores from clockEvents (last 90 days) — same as today-availability
      const scoreWindow2 = new Date();
      scoreWindow2.setDate(scoreWindow2.getDate() - 90);
      const perfRows2 = await db.select({
        userId: clockEvents.userId,
        totalPoints: sql<number>`COALESCE(SUM(${clockEvents.pointValue}), 0)::int`,
      }).from(clockEvents).where(gte(clockEvents.createdAt, scoreWindow2)).groupBy(clockEvents.userId);
      const scoreMap2: Record<string, number> = {};
      for (const s of perfRows2) scoreMap2[s.userId] = s.totalPoints;

      // Week scheduled hours (Mon→Sun surrounding dateParam) — same as today-availability
      const weekStart2 = new Date(dateObj);
      const weekDow2 = weekStart2.getUTCDay();
      weekStart2.setUTCDate(weekStart2.getUTCDate() - (weekDow2 === 0 ? 6 : weekDow2 - 1));
      weekStart2.setUTCHours(0, 0, 0, 0);
      const weekEnd2 = new Date(weekStart2);
      weekEnd2.setUTCDate(weekEnd2.getUTCDate() + 6);
      weekEnd2.setUTCHours(23, 59, 59, 999);
      const weekScheds2 = await db.select({
        userId: schedules.userId,
        startTime: schedules.startTime,
        endTime: schedules.endTime,
      }).from(schedules).where(and(
        gte(schedules.startTime, weekStart2),
        lte(schedules.endTime, weekEnd2),
        inArray(schedules.userId, storeUserIds),
      ));
      const scheduledHoursMap2: Record<string, number> = {};
      for (const s of weekScheds2) {
        const h = (new Date(s.endTime).getTime() - new Date(s.startTime).getTime()) / (1000 * 60 * 60);
        scheduledHoursMap2[s.userId] = (scheduledHoursMap2[s.userId] || 0) + h;
      }

      // Today's existing schedules (to exclude already-scheduled members)
      const todayStart2 = new Date(dateParam + 'T00:00:00Z');
      const todayEnd2 = new Date(dateParam + 'T23:59:59Z');
      const todayScheds2 = await db.select({
        userId: schedules.userId,
      }).from(schedules).where(and(
        inArray(schedules.userId, storeUserIds),
        gte(schedules.startTime, todayStart2),
        lte(schedules.startTime, todayEnd2),
      ));
      const alreadyScheduledSet = new Set(todayScheds2.map(s => s.userId));

      // ── Work-pattern fetch — must happen before availableMembers is built ────────
      // Required employees must bypass availability filtering, so we resolve status first.
      type WorkPatternStatus = 'required' | 'available' | 'preferred_off' | 'hard_off';
      interface WorkPatternRow {
        userId: string;
        dayOfWeek: number;
        status: WorkPatternStatus;
        effectiveFrom: Date;
      }

      // Fetch active records effective on the requested date.
      // day_of_week and status are real DB columns selected via sql<> (not in TS schema).
      const workPatternsForDay: WorkPatternRow[] = await db.select({
        userId: userWorkPatterns.userId,
        dayOfWeek: sql<number>`"user_work_patterns"."day_of_week"`,
        status: sql<WorkPatternStatus>`"user_work_patterns"."status"`,
        effectiveFrom: userWorkPatterns.effectiveFrom,
      }).from(userWorkPatterns).where(and(
        inArray(userWorkPatterns.userId, storeUserIds),
        eq(userWorkPatterns.isActive, true),
        lte(userWorkPatterns.effectiveFrom, dateObj),
        or(
          isNull(userWorkPatterns.effectiveTo),
          gte(userWorkPatterns.effectiveTo, dateObj),
        ),
      ));

      // Resolve one status per user for today's day-of-week (most-recent effectiveFrom wins).
      const workPatternStatusMap: Record<string, WorkPatternStatus> = {};
      const wpBestByUser: Record<string, WorkPatternRow> = {};
      for (const wp of workPatternsForDay) {
        if (wp.dayOfWeek !== dow) continue;
        const prev = wpBestByUser[wp.userId];
        if (!prev || new Date(wp.effectiveFrom) > new Date(prev.effectiveFrom)) {
          wpBestByUser[wp.userId] = wp;
        }
      }
      for (const [wpUserId, wp] of Object.entries(wpBestByUser)) {
        workPatternStatusMap[wpUserId] = wp.status;
      }

      // Build ranked members list using exact same algorithm as today-availability
      const availableMembers: any[] = [];
      for (const u of storeUsers) {
        const uid = u.id;
        // Time-off check
        const hasTimeOff = allTimeOff2.some((r: any) => {
          if (r.status === 'cancelled' || r.userId !== uid) return false;
          const s = new Date(r.startDate); const e = new Date(r.endDate);
          return dateObj >= s && dateObj <= e;
        });

        let isAvailable = false;
        let availStart: string | null = null;
        let availEnd: string | null = null;

        if (hasTimeOff) {
          isAvailable = false;
        } else {
          const override = overridesByUser2[uid];
          if (override) {
            isAvailable = !override.unavailable;
            availStart = override.startTime ?? null;
            availEnd = override.endTime ?? null;
          } else {
            const tmpl = templateByUser2[uid];
            const rawSlots = (tmpl?.slots ?? {}) as Record<string, any>;
            const slot = rawSlots[dow.toString()];
            if (!slot) {
              isAvailable = true; // default available (matches today-availability)
            } else if ('available' in slot) {
              isAvailable = !!slot.available;
              availStart = slot.available ? (slot.startTime ?? null) : null;
              availEnd = slot.available ? (slot.endTime ?? null) : null;
            } else {
              isAvailable = !!(slot.morning || slot.afternoon || slot.evening);
            }
          }
        }

        // Default window to store hours when available but no explicit window
        if (isAvailable) {
          if (!availStart) availStart = storeOpen2;
          if (!availEnd) availEnd = storeClose2;
        }

        // Required employees bypass unavailability — they must always appear in roster.
        // Exception: already-scheduled employees are skipped regardless (no duplicates).
        const isRequired = workPatternStatusMap[uid] === 'required';
        if (alreadyScheduledSet.has(uid)) continue;
        if (!isAvailable && !isRequired) continue;
        // Required-but-unavailable: default to full store-hour window
        if (!isAvailable && isRequired) {
          isAvailable = true;
          availStart = storeOpen2;
          availEnd = storeClose2;
        }

        // Overlap with store hours (same formula as today-availability)
        const aStartMins = Math.max(timeToMinutes2(availStart!), storeOpenMins2);
        const aEndMins = Math.min(timeToMinutes2(availEnd!), storeCloseMins2);
        const overlapHours = Math.max(0, (aEndMins - aStartMins) / 60);
        const overlapPct = storeHourCount2 > 0 ? overlapHours / storeHourCount2 : 0;

        // Performance score (normalize 0–100, same as today-availability)
        const rawScore = scoreMap2[uid] ?? 0;
        const normalizedScore = Math.min(100, Math.round((rawScore / 500) * 100));

        // Hours remaining factor (same as today-availability)
        const scheduledHours = scheduledHoursMap2[uid] || 0;
        const targetHours = u.targetWeeklyHours ? parseFloat(u.targetWeeklyHours) : 40;
        const hoursRemaining = Math.max(0, targetHours - scheduledHours);
        const hoursRemainingFactor = targetHours > 0 ? hoursRemaining / targetHours : 1;

        // Composite score: overlap (40%) + perf (40%) + hoursRemaining (20%)
        const compositeScore = Math.round((overlapPct * 0.4 + (normalizedScore / 100) * 0.4 + hoursRemainingFactor * 0.2) * 100);

        availableMembers.push({
          userId: uid,
          name: `${u.firstName || ''} ${u.lastName || ''}`.trim() || uid,
          firstName: u.firstName,
          lastName: u.lastName,
          profileImageUrl: u.profileImageUrl,
          availableFrom: availStart,
          availableTo: availEnd,
          overlapHours,
          compositeScore,
        });
      }
      availableMembers.sort((a, b) => b.compositeScore - a.compositeScore);

      // workPatternStatusMap resolved above (before availableMembers loop) so Required users
      // are included in availableMembers even when their template marks them unavailable.

      // Remove Day Off (hard_off) employees — they must never be scheduled
      const filteredMembers = availableMembers.filter(m => {
        const pattern = workPatternStatusMap[m.userId];
        return pattern !== 'hard_off';
      });
      interface RosterMember {
        userId: string;
        name: string;
        firstName: string | null;
        lastName: string | null;
        profileImageUrl: string | null;
        availableFrom: string | null;
        availableTo: string | null;
        overlapHours: number;
        compositeScore: number;
        workPatternStatus: WorkPatternStatus;
        targetWeeklyHours: number | null;
        scheduledHoursThisWeek: number;
        hoursRemaining: number | null;
      }

      const enrichMember = (m: typeof availableMembers[0]): RosterMember => {
        const rawStatus = workPatternStatusMap[m.userId];
        const workPatternStatus: WorkPatternStatus =
          rawStatus === 'required' || rawStatus === 'preferred_off' || rawStatus === 'hard_off'
            ? rawStatus
            : 'available';
        const targetHoursRaw = storeUsers.find(u => u.id === m.userId)?.targetWeeklyHours;
        const scheduledHrs = scheduledHoursMap2[m.userId] || 0;
        const targetHrsNum = targetHoursRaw ? parseFloat(targetHoursRaw) : null;
        return {
          userId: m.userId,
          name: m.name,
          firstName: m.firstName ?? null,
          lastName: m.lastName ?? null,
          profileImageUrl: m.profileImageUrl ?? null,
          availableFrom: m.availableFrom,
          availableTo: m.availableTo,
          overlapHours: m.overlapHours,
          compositeScore: m.compositeScore,
          workPatternStatus,
          targetWeeklyHours: targetHrsNum,
          scheduledHoursThisWeek: Math.round(scheduledHrs * 10) / 10,
          hoursRemaining: targetHrsNum !== null ? Math.max(0, Math.round((targetHrsNum - scheduledHrs) * 10) / 10) : null,
        };
      };

      // Required employees must always appear in the roster regardless of composite score.
      // Fill remaining slots (up to 30) with non-required members sorted by composite score.
      const MAX_ROSTER = 30;
      const requiredInFiltered = filteredMembers.filter(m => workPatternStatusMap[m.userId] === 'required');
      const nonRequiredInFiltered = filteredMembers.filter(m => workPatternStatusMap[m.userId] !== 'required');
      const rosterMembers: RosterMember[] = [
        ...requiredInFiltered.map(enrichMember),
        ...nonRequiredInFiltered.slice(0, Math.max(0, MAX_ROSTER - requiredInFiltered.length)).map(enrichMember),
      ];

      // Pull shiftOverlapMinutes from settings (default 0 for suggest endpoint — handoff overlap)
      const shiftOverlapMinutes2: number = settings2?.shiftOverlapMinutes ?? 0;

      // ── Get historical sales: backfill from Shopify GraphQL if needed ────────
      // Use 52 weeks ago (same day of week, 364 days) for like-for-like comparison
      const historicalDate2 = sameWeekdayLastYear(dateObj);
      let historicalDateStr2 = historicalDate2.toISOString().slice(0, 10);

      // Resolve Shopify shop credentials for this user
      const shopCreds = await getShopCredentialsForUser(userId);
      const shopDomain2 = shopCreds?.shopDomain ?? null;

      // Fetch store timezone for accurate local-time hourly bucketing
      const tzRow2 = await db.select({ timezone: workLocations.timezone })
        .from(users).innerJoin(workLocations, eq(users.locationId, workLocations.id))
        .where(eq(users.id, userId)).limit(1);
      const storeTimezone2 = tzRow2[0]?.timezone ?? 'America/Chicago';

      let hourlyRevenue2: number[] = new Array(24).fill(0);
      let dataSource2 = 'synthetic';

      if (shopDomain2 && shopCreds) {
        const weights2 = [0,0,0,0,0,0,0.01,0.02,0.05,0.08,0.09,0.10,0.10,0.09,0.08,0.07,0.07,0.06,0.06,0.05,0.04,0.03,0.01,0];

        const tryFetchRevenue2 = async (dateStr: string): Promise<{ found: boolean; source: 'actual' | 'estimated' }> => {
          // Bracket on store-local calendar day (mirrors tryFetchRevenue
          // above). Daily aggregate row is keyed on UTC midnight of dateStr.
          const { start, endExclusive } = localDayBoundsUtc(dateStr, storeTimezone2);
          const dailyKey = new Date(dateStr + 'T00:00:00Z');

          // ── Auto-backfill: if shopify_orders has no rows for this date, pull from Shopify GraphQL ──
          const existingOrderCount = await db.select({ cnt: count() })
            .from(shopifyOrders)
            .where(and(
              eq(shopifyOrders.shopDomain, shopDomain2),
              gte(shopifyOrders.orderCreatedAt, start),
              lt(shopifyOrders.orderCreatedAt, endExclusive),
            ));
          if ((existingOrderCount[0]?.cnt ?? 0) === 0) {
            try {
              logger.info({ dateStr, shopDomain: shopDomain2, tz: storeTimezone2 }, "[suggest] auto-backfill: fetching Shopify orders for");
              await backfillDayOrdersFromShopify(shopDomain2, shopCreds.service, dateStr, storeTimezone2);
            } catch (backfillErr) {
              logger.warn({ dateStr, error: String(backfillErr) }, "[suggest] auto-backfill failed (non-fatal)");
            }
          }

          // Now query orders (may have just been populated)
          const ordersInner = await db.select({
            totalPrice: shopifyOrders.totalPrice,
            orderCreatedAt: shopifyOrders.orderCreatedAt,
          }).from(shopifyOrders).where(and(
            eq(shopifyOrders.shopDomain, shopDomain2),
            gte(shopifyOrders.orderCreatedAt, start),
            lt(shopifyOrders.orderCreatedAt, endExclusive),
          ));
          if (ordersInner.length > 0) {
            for (const o of ordersInner) {
              if (!o.orderCreatedAt || !o.totalPrice) continue;
              // Use store's local timezone so hours align with what the team observes
              const h = getLocalHourInTz(new Date(o.orderCreatedAt), storeTimezone2);
              hourlyRevenue2[h] += parseFloat(o.totalPrice);
            }
            return { found: true, source: 'actual' };
          }
          // Fall back to shopify_daily_sales aggregate (estimated distribution)
          const dailySalesRows2 = await db.select({ totalRevenue: shopifyDailySales.totalRevenue })
            .from(shopifyDailySales)
            .where(and(eq(shopifyDailySales.shopDomain, shopDomain2), eq(shopifyDailySales.date, dailyKey)))
            .limit(1);
          const dailyTotal2Inner = dailySalesRows2[0]?.totalRevenue ? parseFloat(dailySalesRows2[0].totalRevenue) : 0;
          if (dailyTotal2Inner > 0) {
            for (let h = 0; h < 24; h++) hourlyRevenue2[h] = Math.round(dailyTotal2Inner * weights2[h] * 100) / 100;
            return { found: true, source: 'estimated' as const };
          }
          return { found: false, source: 'estimated' as const };
        };

        // Fetch and process the 52-week comparison date
        const result2 = await tryFetchRevenue2(historicalDateStr2);
        dataSource2 = result2.found ? result2.source : 'synthetic';
      }

      // Build hourly data using settings2 queried above (no duplicate round-trip)
      const staffingTiers2 = ((settings2?.staffingTiers as any[]) || [
        { minRevenue: 0, maxRevenue: 2000, employeeCount: 2 },
        { minRevenue: 2001, maxRevenue: 5000, employeeCount: 3 },
        { minRevenue: 5001, maxRevenue: 10000, employeeCount: 5 },
      ]);
      const minStaffPre2 = settings2?.minStaffingPreHours ?? settings2?.minimumStaffing ?? 1;
      const minStaffDuring2 = settings2?.minStaffingDuringHours ?? settings2?.minimumStaffing ?? 2;
      const minStaffPost2 = settings2?.minStaffingPostHours ?? settings2?.minimumStaffing ?? 1;
      const minimumStaffing2 = minStaffDuring2; // peak-zone floor used as overall default

      // Determine zone boundaries from shift blocks:
      // - Opening zone  = hours of the first shift block
      // - Closing zone  = hours of the last shift block
      // - Peak zone     = all middle shift blocks
      // Falls back to store-hours thirds when shift blocks are unavailable.
      const shiftBlocksEarly: any[] = ((settings2?.shiftBlocks as any[]) || [
        { name: 'Morning', startTime: '09:00', endTime: '14:00' },
        { name: 'Afternoon', startTime: '14:00', endTime: '21:00' },
      ]).sort((a: any, b: any) => a.startTime.localeCompare(b.startTime));

      function hourToZoneFloor2(h: number): number {
        if (shiftBlocksEarly.length === 0) return minStaffDuring2;
        const [firstS] = shiftBlocksEarly[0].startTime.split(':').map(Number);
        const [firstE] = shiftBlocksEarly[0].endTime.split(':').map(Number);
        const last = shiftBlocksEarly[shiftBlocksEarly.length - 1];
        const [lastS] = last.startTime.split(':').map(Number);
        if (h >= firstS && h < firstE) return minStaffPre2;    // first block = Opening
        if (h >= lastS) return minStaffPost2;                   // last block = Closing
        return minStaffDuring2;                                  // middle = Peak
      }

      // Peak computation mirrors /historical-sales exactly: avg-based threshold over store hours
      const dailyRevTotal2 = hourlyRevenue2.slice(openH2, closeH2).reduce((s, v) => s + v, 0);
      const avgHourlyRevenue2 = dailyRevTotal2 / Math.max(1, closeH2 - openH2);
      const hourlyData: any[] = [];
      for (let h = openH2; h < closeH2; h++) {
        const rev = hourlyRevenue2[h];
        const hLabel = `${(h % 12) || 12}${h < 12 ? 'am' : 'pm'}`;
        const isPeak = rev > avgHourlyRevenue2 * 1.3;
        const tier = staffingTiers2.find((t: any) => rev >= t.minRevenue && rev <= t.maxRevenue);
        const zoneFloor = hourToZoneFloor2(h);
        const suggestedStaff = Math.max(zoneFloor, tier?.employeeCount || zoneFloor);
        hourlyData.push({ hour: h, label: hLabel, revenue: Math.round(rev * 100) / 100, isPeak, suggestedStaff });
      }

      const salesData = {
        historicalDate: historicalDateStr2,
        dataSource: dataSource2,
        storeHours: { open: storeOpen2, close: storeClose2 },
        hourlyData,
      };

      // Group hours into shift windows
      const shiftBlocks: any[] = ((settings2?.shiftBlocks as any[]) || [
        { name: 'Morning', startTime: '09:00', endTime: '14:00' },
        { name: 'Afternoon', startTime: '14:00', endTime: '21:00' },
      ]);

      const proposedShiftShape: Array<{
        employeeId: string;
        employeeName: string;
        profileImageUrl: string | null;
        startTime: string;
        endTime: string;
        shiftBlock: string;
        rationale: string;
        revenue: number;
      }> = [];

      // ── Claude AI schedule generation ─────────────────────────────────────────
      let claudeSucceeded = false;
      try {
        const dayLabel = dateObj.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
        const historicalDateLabel = historicalDateStr2
          ? new Date(historicalDateStr2 + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
          : 'N/A';

        const hourlyBreakdown = hourlyData.length > 0
          ? hourlyData.map((h: any) => `  ${h.label}: $${h.revenue} revenue${h.isPeak ? ' [PEAK]' : ''} → ${h.suggestedStaff} staff needed`).join('\n')
          : '  No historical sales data — use minimum staffing defaults.';

        const requiredMembers = rosterMembers.filter(m => m.workPatternStatus === 'required');
        const preferredOffMembers = rosterMembers.filter(m => m.workPatternStatus === 'preferred_off');

        const teamRoster = rosterMembers.map(m => {
          const patternNote = m.workPatternStatus === 'required' ? ' [REQUIRED — must be scheduled]'
            : m.workPatternStatus === 'preferred_off' ? ' [prefers day off — schedule only if needed]'
            : '';
          const hoursNote = m.hoursRemaining !== null
            ? ` | target ${m.targetWeeklyHours}h/wk, ${m.hoursRemaining}h remaining`
            : '';
          return `  - ${m.name} (id:${m.userId}) | available ${m.availableFrom}–${m.availableTo} | score:${m.compositeScore}/100${hoursNote}${patternNote}`;
        }).join('\n');

        const shiftBlockSummary = shiftBlocks.map((b: any) => {
          const blockHrs = hourlyData.filter((h: any) => {
            const [bS] = b.startTime.split(':').map(Number);
            const [bE] = b.endTime.split(':').map(Number);
            return h.hour >= bS && h.hour < bE;
          });
          const blockRev = blockHrs.reduce((s: number, h: any) => s + h.revenue, 0);
          const maxStaff = blockHrs.length > 0 ? Math.max(...blockHrs.map((h: any) => h.suggestedStaff)) : minStaffDuring2;
          return `  ${b.name} (${b.startTime}–${b.endTime}): $${Math.round(blockRev)} revenue → ${maxStaff} staff recommended`;
        }).join('\n');

        const overlapNote = shiftOverlapMinutes2 > 0
          ? `SHIFT HANDOFF OVERLAP: ${shiftOverlapMinutes2} minutes — when one shift block ends and another begins, extend the outgoing shift end time by ${shiftOverlapMinutes2} minutes so the two employees overlap during handoff. For example, if Morning ends at 14:00 and Afternoon starts at 14:00, the Morning employee's endTime should be 14:${String(shiftOverlapMinutes2).padStart(2,'0')} and the Afternoon employee's startTime should remain 14:00.`
          : 'SHIFT HANDOFF OVERLAP: none configured — use exact shift block start/end times.';

        const claudePrompt = `You are an expert retail staffing scheduler for Libby Story boutique. Generate a specific shift schedule for ${dayLabel}.

STORE HOURS: ${storeOpen2} – ${storeClose2}
DATA SOURCE: Sales from ${historicalDateLabel} (${dataSource2 === 'synthetic' ? 'no historical data — use minimum staffing' : dataSource2 === 'actual' ? 'real Shopify orders' : 'estimated from daily total'})

HOURLY SALES BREAKDOWN (from ${historicalDateLabel}):
${hourlyBreakdown}

SHIFT BLOCKS:
${shiftBlockSummary}

${overlapNote}

AVAILABLE TEAM MEMBERS (ranked by availability+performance+hours remaining toward target):
${teamRoster || '  No available employees found.'}
${requiredMembers.length > 0 ? `\nREQUIRED employees (must appear in schedule): ${requiredMembers.map(m => m.name).join(', ')}` : ''}
${preferredOffMembers.length > 0 ? `PREFER DAY OFF (schedule only if needed to meet staffing minimums): ${preferredOffMembers.map(m => m.name).join(', ')}` : ''}

RULES:
1. Assign real employees from the roster above to each shift block
2. REQUIRED employees MUST be assigned to a shift — do not omit them
3. Employees with more hours remaining toward their weekly target should be prioritized first
4. Match employees to blocks where they are available (check their available hours)
5. Prioritize higher-scored employees for peak revenue hours
6. Do not assign the same employee to two overlapping blocks
7. Each shift block needs the recommended number of staff (see SHIFT BLOCKS above)
8. If no historical data, use zone-based minimums: Opening zone ${minStaffPre2}, Peak zone ${minStaffDuring2}, Closing zone ${minStaffPost2} employee(s) per block
9. Apply the configured shift handoff overlap to shift end/start times as described above
10. Only schedule "prefers day off" employees if the staffing minimum cannot otherwise be met

Respond ONLY with a valid JSON object (no markdown, no explanation) in this exact format:
{
  "proposedShifts": [
    {
      "employeeId": "<exact id from roster>",
      "employeeName": "<exact name from roster>",
      "startTime": "<HH:MM>",
      "endTime": "<HH:MM>",
      "shiftBlock": "<block name>",
      "rationale": "<1 sentence: why this person for this block, referencing revenue and hours remaining if available>"
    }
  ]
}`;

        const claudeResponse = await anthropic.messages.create({
          model: 'claude-opus-4-5',
          max_tokens: 1500,
          messages: [{ role: 'user', content: claudePrompt }],
        });

        const rawText = claudeResponse.content[0]?.type === 'text' ? claudeResponse.content[0].text : '';
        const jsonMatch = rawText.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]);
          const shifts: any[] = parsed.proposedShifts || [];
          if (shifts.length > 0) {
            for (const s of shifts) {
              const member = filteredMembers.find((m: any) => m.userId === s.employeeId);
              if (!member) continue;
              // Find the matching shift block for revenue
              const block = shiftBlocks.find((b: any) => b.name === s.shiftBlock);
              const blockHrs = block ? hourlyData.filter((h: any) => {
                const [bS] = block.startTime.split(':').map(Number);
                const [bE] = block.endTime.split(':').map(Number);
                return h.hour >= bS && h.hour < bE;
              }) : [];
              const blockRevenue = blockHrs.reduce((sum: number, h: any) => sum + h.revenue, 0);
              proposedShiftShape.push({
                employeeId: member.userId,
                employeeName: member.name,
                profileImageUrl: member.profileImageUrl || null,
                startTime: s.startTime || block?.startTime || storeOpen2,
                endTime: s.endTime || block?.endTime || storeClose2,
                shiftBlock: s.shiftBlock || 'Shift',
                rationale: s.rationale || `Assigned by AI`,
                revenue: Math.round(blockRevenue * 100) / 100,
              });
            }
            claudeSucceeded = proposedShiftShape.length > 0;
            logger.info({ count: proposedShiftShape.length, dateParam }, "[suggest] Claude generated shifts");
          }
        }
      } catch (claudeErr) {
        logger.warn({ error: String(claudeErr) }, "[suggest] Claude call failed, falling back to algorithm");
      }

      // ── Fallback: algorithmic shift assignment if Claude failed or returned nothing ──
      if (!claudeSucceeded) {
        logger.info({ dateParam }, "[suggest] using algorithmic fallback");
        const assignedMemberShifts: Record<string, string[]> = {};
        for (const block of shiftBlocks) {
          const [blockStartH] = block.startTime.split(':').map(Number);
          const [blockEndH] = block.endTime.split(':').map(Number);
          const blockHours = hourlyData.filter(h => h.hour >= blockStartH && h.hour < blockEndH);
          if (blockHours.length === 0) continue;
          const maxStaff = Math.max(...blockHours.map((h: any) => h.suggestedStaff));
          const blockRevenue = blockHours.reduce((s: number, h: any) => s + h.revenue, 0);
          const peakHours = blockHours.filter((h: any) => h.isPeak);
          const peakLabel = peakHours.length > 0
            ? `Peak ${peakHours[0].label}–${peakHours[peakHours.length - 1].label}`
            : block.name;
          const blockMembers = filteredMembers.filter(m => {
            if (!m.availableFrom || !m.availableTo) return true;
            const [mStartH] = m.availableFrom.split(':').map(Number);
            const [mEndH] = m.availableTo.split(':').map(Number);
            return mStartH <= blockStartH && mEndH >= blockEndH;
          });

          // Sort: Required first, then by hours remaining (more = schedule first), then composite score
          blockMembers.sort((a, b) => {
            const aReq = workPatternStatusMap[a.userId] === 'required' ? 1 : 0;
            const bReq = workPatternStatusMap[b.userId] === 'required' ? 1 : 0;
            if (bReq !== aReq) return bReq - aReq;
            const aUser = storeUsers.find(u => u.id === a.userId);
            const bUser = storeUsers.find(u => u.id === b.userId);
            const aTarget = aUser?.targetWeeklyHours ? parseFloat(aUser.targetWeeklyHours) : 0;
            const bTarget = bUser?.targetWeeklyHours ? parseFloat(bUser.targetWeeklyHours) : 0;
            const aRemaining = Math.max(0, aTarget - (scheduledHoursMap2[a.userId] || 0));
            const bRemaining = Math.max(0, bTarget - (scheduledHoursMap2[b.userId] || 0));
            if (bRemaining !== aRemaining) return bRemaining - aRemaining;
            return b.compositeScore - a.compositeScore;
          });

          // Only use preferred_off employees if we still need more staff after exhausting others
          const nonPrefOff = blockMembers.filter(m => workPatternStatusMap[m.userId] !== 'preferred_off');
          const prefOff = blockMembers.filter(m => workPatternStatusMap[m.userId] === 'preferred_off');
          const orderedMembers = [...nonPrefOff, ...prefOff];

          let assigned = 0;
          for (const member of orderedMembers) {
            if (assigned >= maxStaff) break;
            const existing = assignedMemberShifts[member.userId] || [];
            if (existing.includes(block.name)) continue;
            assignedMemberShifts[member.userId] = [...existing, block.name];
            const rationaleRevenue = blockRevenue > 0
              ? `$${Math.round(blockRevenue).toLocaleString()} in ${block.name.toLowerCase()} window`
              : `${block.name} shift`;
            const prefNote = workPatternStatusMap[member.userId] === 'preferred_off' ? ' (prefers day off — included to meet staffing minimum)' : '';
            proposedShiftShape.push({
              employeeId: member.userId,
              employeeName: member.name,
              profileImageUrl: member.profileImageUrl || null,
              startTime: block.startTime,
              endTime: block.endTime,
              shiftBlock: block.name,
              rationale: `${peakLabel}: ${rationaleRevenue} → ${maxStaff} staff recommended${prefNote}`,
              revenue: Math.round(blockRevenue * 100) / 100,
            });
            assigned++;
          }
        }
      }

      // ── Post-processing: enforce Required employees ───────────────────────────
      // Any rosterMember with workPatternStatus === 'required' must appear in the output.
      // If Claude or the fallback omitted them, add them to the best-fitting shift block.
      const requiredRosterMembers = rosterMembers.filter(m => m.workPatternStatus === 'required');
      for (const rm of requiredRosterMembers) {
        const alreadyIncluded = proposedShiftShape.some(s => s.employeeId === rm.userId);
        if (alreadyIncluded) continue;
        // Find a shift block that fits within the employee's availability window
        const bestBlock: { name: string; startTime: string; endTime: string } | undefined =
          shiftBlocks.find((b: { startTime: string; endTime: string }) => {
            if (!rm.availableFrom || !rm.availableTo) return true;
            const [mS] = rm.availableFrom.split(':').map(Number);
            const [mE] = rm.availableTo.split(':').map(Number);
            const [bS] = b.startTime.split(':').map(Number);
            const [bE] = b.endTime.split(':').map(Number);
            return mS <= bS && mE >= bE;
          }) ?? shiftBlocks[0];
        if (!bestBlock) continue;
        const blockHrs = hourlyData.filter((h: { hour: number }) => {
          const [bS] = bestBlock.startTime.split(':').map(Number);
          const [bE] = bestBlock.endTime.split(':').map(Number);
          return h.hour >= bS && h.hour < bE;
        });
        const blockRevenue = blockHrs.reduce((s: number, h: { revenue: number }) => s + h.revenue, 0);
        proposedShiftShape.push({
          employeeId: rm.userId,
          employeeName: rm.name,
          profileImageUrl: rm.profileImageUrl || null,
          startTime: bestBlock.startTime,
          endTime: bestBlock.endTime,
          shiftBlock: bestBlock.name,
          rationale: `Required work pattern for this day — must be scheduled`,
          revenue: Math.round(blockRevenue * 100) / 100,
        });
        logger.info({ userId: rm.userId, block: bestBlock.name }, "[suggest] forced Required employee into schedule");
      }

      // ── Post-processing: apply shift handoff overlap to adjacent block boundaries ──
      // When shiftOverlapMinutes > 0 and two consecutive blocks share a boundary (A.end == B.start),
      // extend the outgoing (A) employee shifts by the overlap duration so handoffs are built in.
      if (shiftOverlapMinutes2 > 0 && shiftBlocks.length > 1) {
        type ShiftBlock = { name: string; startTime: string; endTime: string };
        const sortedBlocks = ([...shiftBlocks] as ShiftBlock[]).sort((a, b) =>
          timeToMinutes2(a.startTime) - timeToMinutes2(b.startTime)
        );
        for (let bi = 0; bi < sortedBlocks.length - 1; bi++) {
          const curBlock = sortedBlocks[bi];
          const nextBlock = sortedBlocks[bi + 1];
          // Only apply when blocks are adjacent
          if (curBlock.endTime !== nextBlock.startTime) continue;
          const extEndMins = timeToMinutes2(curBlock.endTime) + shiftOverlapMinutes2;
          const extH = Math.floor(extEndMins / 60);
          const extM = extEndMins % 60;
          const extEndTime = `${String(extH).padStart(2, '0')}:${String(extM).padStart(2, '0')}`;
          // Extend any proposed shift assigned to curBlock whose endTime matches the block boundary
          for (const s of proposedShiftShape) {
            if (s.shiftBlock === curBlock.name && s.endTime === curBlock.endTime) {
              s.endTime = extEndTime;
            }
          }
        }
      }

      const proposedShifts = proposedShiftShape;

      logger.info({
        dateParam,
        proposedShifts: proposedShifts.length,
        dataSource: salesData.dataSource,
        availableMembers: availableMembers.length,
      }, "[suggest] responding");

      const responsePayload = {
        date: dateParam,
        proposedShifts,
        historicalDate: salesData.historicalDate,
        dataSource: salesData.dataSource,
        hourlyData,
        storeHours: salesData.storeHours,
      };

      // Persist generated schedule so it won't need to be regenerated on next view
      if (storeId) {
        try {
          await db.insert(aiSuggestedSchedules)
            .values({ storeId, date: dateParam, scheduleData: responsePayload as any })
            .onConflictDoUpdate({
              target: [aiSuggestedSchedules.storeId, aiSuggestedSchedules.date],
              set: { scheduleData: responsePayload as any, generatedAt: new Date() },
            });
        } catch (saveErr) {
          logger.warn({ saveErr: String(saveErr) }, "[suggest] failed to persist schedule (non-fatal):");
        }
      }

      res.json(responsePayload);
    } catch (error) {
      logger.error({ error: String(error) }, "[suggest] unhandled error");
      console.error("Error generating suggested schedule:", error);
      res.status(500).json({ message: "Failed to generate suggested schedule", detail: String(error) });
    }
  });

  app.post("/api/ai-scheduling/review", isAuthenticated, aiRateLimiter, async (req: any, res) => {
    try {
      const userId = req.user.id;
            const isAdmin = await resolveAnyPermission(userId, ['admin.manage_all', 'schedule.create', 'schedule.view_all'], storage);
      if (!isAdmin) {
        return res.status(403).json({ message: "Admin access required" });
      }

      // scheduleEntries: required. days: optional revenue projections from the generate result.
      const { scheduleEntries, startDate, endDate, days: providedDays } = req.body;
      if (!scheduleEntries || !Array.isArray(scheduleEntries) || scheduleEntries.length === 0) {
        return res.status(400).json({ message: "scheduleEntries array is required and must not be empty" });
      }
      if (!startDate || !endDate) {
        return res.status(400).json({ message: "startDate and endDate are required" });
      }
      const reviewStartParsed = parseDateOnlyUtc(startDate);
      const reviewEndParsed = parseDateOnlyUtc(endDate);
      if (!reviewStartParsed || !reviewEndParsed) {
        return res.status(400).json({ message: "startDate and endDate must be YYYY-MM-DD" });
      }
      if (reviewStartParsed > reviewEndParsed) {
        return res.status(400).json({ message: "startDate must be on or before endDate" });
      }

      // ── Resolve store and scope all queries to the caller's store ─────────────
      const { getAllStoreUserIds } = await import('../lib/permissionUtils');
      const storeId = await tryResolveStoreIdForUser(userId);
      if (!storeId) {
        return res.status(403).json({ message: "No store associated with your account" });
      }

      // Entitlement check (ADR-0011): AI schedule review is part of the paid
      // ai.scheduling feature.
      if (!await hasEntitlement(storeId, "ai.scheduling")) {
        return res.status(403).json({ message: "Your plan does not include AI scheduling. Please upgrade to continue." });
      }

      const storeUserIds = await getAllStoreUserIds(storeId);
      if (storeUserIds.length === 0) {
        return res.status(400).json({ message: "No employees found for your store" });
      }

      // Per-store settings (Task #435)
      const settingsResult = await db.select().from(aiSchedulingSettings)
        .where(eq(aiSchedulingSettings.storeId, storeId))
        .limit(1);
      const settings = settingsResult[0] || {
        shiftBlocks: [
          { name: "Morning", startTime: "09:00", endTime: "14:00" },
          { name: "Afternoon", startTime: "14:00", endTime: "21:00" },
        ],
        minimumStaffing: 2,
        minStaffingPreHours: 1,
        minStaffingDuringHours: 2,
        minStaffingPostHours: 1,
        storeHours: [],
      };

      const storeHoursArray = (settings.storeHours as any[]) || [];
      const shiftBlocks = (settings.shiftBlocks as any[]) || [];
      const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

      const start = reviewStartParsed;
      const end = reviewEndParsed;

      // Build the days array (use provided days with revenue if available, otherwise build from range)
      const days: Array<{ date: string; dayOfWeek: number; dayName: string; predictedRevenue?: number; requiredStaff?: number }> = [];
      if (Array.isArray(providedDays) && providedDays.length > 0) {
        for (const d of providedDays) {
          if (d.date) days.push(d);
        }
      } else {
        for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
          const current = new Date(d);
          const dateStr = current.toISOString().split('T')[0];
          const dow = current.getUTCDay();
          days.push({ date: dateStr, dayOfWeek: dow, dayName: dayNames[dow] });
        }
      }

      // Scope all user queries to the resolved store's user IDs
      const [allUsers, availabilityResult, allWorkPatterns] = await Promise.all([
        db.select().from(users).where(and(eq(users.isActive, true), inArray(users.id, storeUserIds))),
        db.select().from(userAvailability).where(and(
          gte(userAvailability.date, start),
          lte(userAvailability.date, end),
          inArray(userAvailability.userId, storeUserIds)
        )),
        db.select().from(userWorkPatterns).where(inArray(userWorkPatterns.userId, storeUserIds)),
      ]);

      const workPatternsByUser: Record<string, Record<number, string>> = {};
      for (const wp of allWorkPatterns) {
        if (!workPatternsByUser[wp.userId]) workPatternsByUser[wp.userId] = {};
        workPatternsByUser[wp.userId][(wp as any).dayOfWeek] = (wp as any).status;
      }

      const availabilityByUserDate: Record<string, Record<string, boolean>> = {};
      for (const avail of availabilityResult) {
        const dateKey = new Date(avail.date).toISOString().split('T')[0];
        if (!availabilityByUserDate[avail.userId]) availabilityByUserDate[avail.userId] = {};
        if (avail.isAvailable === false) {
          availabilityByUserDate[avail.userId][dateKey] = false;
        }
      }

      const scoreWindow = new Date();
      scoreWindow.setDate(scoreWindow.getDate() - 90);
      const performanceScores = await db
        .select({ userId: clockEvents.userId, totalPoints: sql<number>`COALESCE(SUM(${clockEvents.pointValue}), 0)::int` })
        .from(clockEvents)
        .where(and(gte(clockEvents.createdAt, scoreWindow), inArray(clockEvents.userId, storeUserIds)))
        .groupBy(clockEvents.userId);
      const scoreMap: Record<string, number> = {};
      for (const s of performanceScores) scoreMap[s.userId] = s.totalPoints;

      const allPromptRules = await db.select().from(aiSchedulingRules)
        .where(and(eq(aiSchedulingRules.storeId, storeId), eq(aiSchedulingRules.isEnabled, true)));
      const activeRules = allPromptRules.filter(r => r.ruleType !== 'custom_instructions');

      const employeeList = allUsers
        .filter(u => u.showInSchedule !== false && u.eligibleForAutoScheduling !== false)
        .map(u => {
          const userPatterns = workPatternsByUser[u.id] || {};
          const availByDate: Record<string, string> = {};
          for (const day of days) {
            const pattern = userPatterns[day.dayOfWeek];
            const explicitUnavailable = availabilityByUserDate[u.id]?.[day.date] === false;
            if (pattern === 'hard_off') {
              availByDate[day.date] = 'HARD_OFF';
            } else if (explicitUnavailable) {
              availByDate[day.date] = 'unavailable';
            } else if (pattern === 'required') {
              availByDate[day.date] = 'REQUIRED';
            } else if (pattern === 'preferred_off') {
              availByDate[day.date] = 'preferred_off';
            } else {
              availByDate[day.date] = 'available';
            }
          }
          const classifications = u.schedulingClassifications as string[] | null;
          return {
            id: u.id,
            name: `${u.firstName || ''} ${u.lastName || ''}`.trim() || u.email || 'Unknown',
            availability: availByDate,
            targetWeeklyHours: u.targetWeeklyHours ? parseFloat(u.targetWeeklyHours) : null,
            performanceScore: scoreMap[u.id] ?? 0,
            classifications: classifications && classifications.length > 0 ? classifications : [],
          };
        });

      // ── Build Template 2 prompt ──────────────────────────────────────────────
      // Template source: .agents/skills/retail-scheduling-agent/references/prompt-templates.md
      const storeHoursStr = storeHoursArray.length === 7
        ? storeHoursArray.map((sh: any) => {
            const dayName = dayNames[sh.day];
            return sh.isClosed ? `${dayName}: CLOSED` : `${dayName}: ${sh.openTime}–${sh.closeTime}`;
          }).join(', ')
        : 'Not configured';

      const coverageRulesStr = activeRules.length > 0
        ? activeRules.map((r, i) => {
            const p: AiRuleParams = (r.params as AiRuleParams) || {};
            switch (r.ruleType) {
              case 'opening_requires_classification':
                return `${i + 1}. Opening shift must include at least ${p.count || 1} employee(s) with [${p.classification || 'Key Holder'}] role.`;
              case 'closing_requires_classification':
                return `${i + 1}. Closing shift must include at least ${p.count || 1} employee(s) with [${p.classification || 'Closer'}] role.`;
              case 'new_hire_paired_with_trainer':
                return `${i + 1}. Any New Hire on a shift must be paired with at least one Trainer.`;
              case 'no_clopening':
                return `${i + 1}. No clopenings — do not schedule the same employee to close one day and open the next.`;
              case 'min_classification_per_shift':
                return `${i + 1}. Every shift must have at least ${p.count || 1} employee(s) with [${p.classification || 'Key Holder'}] role.`;
              default:
                return `${i + 1}. ${r.ruleType}: ${JSON.stringify(p)}`;
            }
          }).join('\n')
        : 'None configured';

      const revenueByDayStr = days.some(d => d.predictedRevenue !== undefined)
        ? days.map(d => `${d.date} (${d.dayName}): revenue=$${d.predictedRevenue ?? 0}, need ${d.requiredStaff ?? 'unknown'} staff`).join('\n')
        : 'Not available — estimate labor cost based on shift hours and typical retail wages ($15–$20/hr)';

      // Follows Template 2 structure from prompt-templates.md exactly
      const prompt = `You are a retail scheduling auditor. Review the following draft schedule and identify all constraint violations, coverage gaps, fairness issues, and labor cost concerns.

STORE CONFIGURATION:
- Store hours: ${storeHoursStr}
- Shift blocks: ${JSON.stringify(shiftBlocks.map((b: any) => ({ name: b.name, startTime: b.startTime, endTime: b.endTime })))}
- Minimum staffing by zone — Opening: ${settings.minStaffingPreHours ?? 1}, Peak: ${settings.minStaffingDuringHours ?? settings.minimumStaffing ?? 2}, Closing: ${settings.minStaffingPostHours ?? 1}
- Labor cost target: 15–25% of daily revenue

EMPLOYEES (with availability, hour targets, scores, and role classifications):
${employeeList.map(e => {
  const targetInfo = e.targetWeeklyHours ? ` [TARGET: ${e.targetWeeklyHours}hrs/wk]` : '';
  const scoreInfo = ` [SCORE: ${e.performanceScore}]`;
  const classInfo = e.classifications.length > 0 ? ` [ROLES: ${e.classifications.join(', ')}]` : '';
  return `${e.name} (${e.id})${targetInfo}${scoreInfo}${classInfo}: ${Object.entries(e.availability).map(([date, status]) => `${date}=${status}`).join(', ')}`;
}).join('\n')}

DRAFT SCHEDULE TO REVIEW:
${JSON.stringify(scheduleEntries)}

REVENUE PROJECTIONS BY DAY:
${revenueByDayStr}

ACTIVE COVERAGE RULES:
${coverageRulesStr}

For each issue found, report:
1. The type of violation (e.g., rest gap, missing role, coverage gap, clopening, over-budget)
2. The affected date and shift block
3. The affected employee(s)
4. A recommended fix

Also provide:
- An overall coverage assessment (are all required staff counts met?)
- An estimated labor cost % of projected revenue
- A fairness summary (are undesirable shifts distributed equitably?)

Return your findings as JSON only — no markdown, no text outside JSON:
{"issues":[{"type":"violation type","date":"YYYY-MM-DD","shiftBlock":"block","employees":["Name"],"description":"what is wrong","recommendation":"how to fix"}],"coverageAssessment":"overall coverage status","estimatedLaborCostPct":number,"fairnessSummary":"brief fairness assessment","overallRating":"pass|warn|fail"}`;

      const aiResult = await anthropic.messages.create({
        model: "claude-sonnet-4-20250514",
        max_tokens: 4096,
        system: "You are a retail scheduling auditor. You MUST respond with valid JSON only. No markdown, no explanations, no code fences. Your entire response must be a single JSON object starting with { and ending with }.",
        messages: [{ role: 'user', content: prompt }],
      });

      const aiContent = aiResult.content[0];
      if (aiContent.type !== 'text') {
        throw new Error('Expected text response from Claude');
      }

      let parsedReview: any;
      try {
        let jsonStr = aiContent.text.trim();
        const codeBlockMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
        if (codeBlockMatch) jsonStr = codeBlockMatch[1].trim();
        if (!jsonStr.startsWith('{')) {
          const firstBrace = jsonStr.indexOf('{');
          if (firstBrace !== -1) jsonStr = jsonStr.slice(firstBrace);
        }
        const lastBrace = jsonStr.lastIndexOf('}');
        if (lastBrace !== -1 && lastBrace < jsonStr.length - 1) jsonStr = jsonStr.slice(0, lastBrace + 1);
        parsedReview = JSON.parse(jsonStr);
      } catch (parseErr) {
        logger.error({ parseErr: String(parseErr) }, "[review] failed to parse AI response");
        return res.status(500).json({ message: "AI returned an unparseable response. Please try again." });
      }

      res.json({
        issues: Array.isArray(parsedReview.issues) ? parsedReview.issues : [],
        coverageAssessment: typeof parsedReview.coverageAssessment === 'string' ? parsedReview.coverageAssessment : '',
        estimatedLaborCostPct: typeof parsedReview.estimatedLaborCostPct === 'number' ? parsedReview.estimatedLaborCostPct : null,
        fairnessSummary: typeof parsedReview.fairnessSummary === 'string' ? parsedReview.fairnessSummary : '',
        overallRating: ['pass', 'warn', 'fail'].includes(parsedReview.overallRating) ? parsedReview.overallRating : 'warn',
      });
    } catch (error) {
      logger.error({ error: String(error) }, "[review] unhandled error");
      res.status(500).json({ message: "Failed to review schedule" });
    }
  });

  // ── Fairness metrics ─────────────────────────────────────────────────────────
  // Returns per-employee counts of opening, closing, and weekend shifts over
  // the trailing 4-week (28-day) window. Flags any employee whose count for a
  // category is ≥ 2× the team average for that category.
  //
  // Definitions (timezone-aware, evaluated in the requester's store timezone):
  //   Opening shift  — startTime is within FAIRNESS_WINDOW_MIN minutes of the
  //                    configured open time for that local day-of-week.
  //   Closing shift  — endTime is within FAIRNESS_WINDOW_MIN minutes of the
  //                    configured close time for that local day-of-week.
  //   Weekend shift  — startTime falls on Saturday (6) or Sunday (0) in the
  //                    store-local calendar.
  //
  // Store hours come from ai_scheduling_settings.storeHours; days that aren't
  // configured fall back to a 09:00–21:00 default. Days marked isClosed do not
  // produce opening/closing flags.
  app.get("/api/ai-scheduling/fairness-metrics", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const canViewFairness = await resolveAnyPermission(userId, ['admin.manage_all', 'schedule.view_all', 'schedule.create'], storage);
      if (!canViewFairness) {
        return res.status(403).json({ message: "Scheduling permission required" });
      }

      // Resolve the requester's company so we only aggregate their team's data.
      // If the row is not found, we cannot safely scope the query — return 403.
      const [requesterRow] = await db
        .select({ companyId: users.companyId })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);
      const companyId = requesterRow?.companyId ?? null;
      if (!companyId) {
        return res.status(403).json({ message: "User company context could not be resolved" });
      }

      const now = new Date();
      const windowStart = new Date(now);
      windowStart.setDate(windowStart.getDate() - 28);

      // Resolve the store timezone for the requester via their primary work
      // location. Fall back to a sensible default if not configured so we
      // never crash on missing data.
      const tzRow = await db
        .select({ timezone: workLocations.timezone })
        .from(users)
        .innerJoin(workLocations, eq(users.locationId, workLocations.id))
        .where(eq(users.id, userId))
        .limit(1);
      const storeTimezone = tzRow[0]?.timezone || 'America/Chicago';

      // Resolve store hours from the AI scheduling settings (per-store; Task #435).
      // Build a per-day lookup with explicit defaults for any missing day so
      // we always have something to compare each shift against.
      const fairnessStoreId = await resolveSettingsStoreId(userId, undefined);
      const settingsResult = fairnessStoreId
        ? await db.select().from(aiSchedulingSettings)
            .where(eq(aiSchedulingSettings.storeId, fairnessStoreId))
            .limit(1)
        : [];
      const rawStoreHours: unknown = settingsResult[0]?.storeHours ?? [];

      interface StoreHourEntry {
        day: number;
        openTime: string;
        closeTime: string;
        isClosed: boolean;
      }

      // Parse a "HH:mm" string into minutes-since-midnight (0..1440). Returns
      // null when the input isn't a well-formed clock value so the caller can
      // fall back to a default rather than silently coerce garbage to 0.
      // Accepts "24:00" as the end-of-day sentinel but rejects any other
      // "24:xx" to avoid ambiguous normalization.
      const parseClockMinutes = (raw: unknown): number | null => {
        if (typeof raw !== 'string') return null;
        const m = /^(\d{1,2}):(\d{2})$/.exec(raw.trim());
        if (!m) return null;
        const h = Number(m[1]);
        const min = Number(m[2]);
        if (!Number.isFinite(h) || !Number.isFinite(min)) return null;
        if (h < 0 || min < 0 || min > 59) return null;
        if (h > 24) return null;
        if (h === 24 && min !== 0) return null;
        return h * 60 + min;
      };

      // Narrow an unknown JSON value into a StoreHourEntry, or return null when
      // it doesn't look like one. This keeps the rest of the route free of
      // `any` casts while tolerating partially-valid rows.
      const toStoreHourEntry = (value: unknown): StoreHourEntry | null => {
        if (value === null || typeof value !== 'object') return null;
        const v = value as Record<string, unknown>;
        const day = typeof v.day === 'number' && Number.isInteger(v.day) && v.day >= 0 && v.day <= 6
          ? v.day
          : null;
        if (day === null) return null;
        return {
          day,
          openTime: typeof v.openTime === 'string' ? v.openTime : '09:00',
          closeTime: typeof v.closeTime === 'string' ? v.closeTime : '21:00',
          isClosed: v.isClosed === true,
        };
      };

      const storeHourEntries: StoreHourEntry[] = Array.isArray(rawStoreHours)
        ? rawStoreHours
            .map(toStoreHourEntry)
            .filter((e): e is StoreHourEntry => e !== null)
        : [];

      const FAIRNESS_DEFAULT_OPEN_MIN = 9 * 60;   // 09:00
      const FAIRNESS_DEFAULT_CLOSE_MIN = 21 * 60; // 21:00
      const FAIRNESS_WINDOW_MIN = 30;

      // Circular minute distance on a 24h clock — keeps the window correct
      // when the configured close is at/near midnight (e.g. 00:00 vs an
      // 23:50 end is 10 min away, not 1430).
      const minuteDistance = (a: number, b: number): number => {
        const diff = Math.abs(a - b);
        return Math.min(diff, 24 * 60 - diff);
      };

      const hoursByDay: Record<number, { openMin: number; closeMin: number; isClosed: boolean }> = {};
      for (let d = 0; d < 7; d++) {
        const entry = storeHourEntries.find(sh => sh.day === d);
        if (entry && !entry.isClosed) {
          const openMin = parseClockMinutes(entry.openTime) ?? FAIRNESS_DEFAULT_OPEN_MIN;
          const closeMin = parseClockMinutes(entry.closeTime) ?? FAIRNESS_DEFAULT_CLOSE_MIN;
          hoursByDay[d] = { openMin, closeMin, isClosed: false };
        } else {
          hoursByDay[d] = {
            openMin: FAIRNESS_DEFAULT_OPEN_MIN,
            closeMin: FAIRNESS_DEFAULT_CLOSE_MIN,
            isClosed: !!entry?.isClosed,
          };
        }
      }

      // Fetch all schedulable active users scoped strictly to the requester's company.
      const allActiveUsers = await db
        .select({
          id: users.id,
          firstName: users.firstName,
          lastName: users.lastName,
          email: users.email,
          showInSchedule: users.showInSchedule,
        })
        .from(users)
        .where(
          and(
            eq(users.isActive, true),
            eq(users.showInSchedule, true),
            eq(users.companyId, companyId),
          )
        );

      // Scope schedules to this team's user IDs AND cap at now to exclude future shifts.
      const teamUserIds = allActiveUsers.map(u => u.id);
      const recentSchedules = teamUserIds.length > 0
        ? await db
          .select({
            userId: schedules.userId,
            startTime: schedules.startTime,
            endTime: schedules.endTime,
          })
          .from(schedules)
          .where(
            and(
              gte(schedules.startTime, windowStart),
              lte(schedules.startTime, now),
              inArray(schedules.userId, teamUserIds),
            )
          )
        : [];

      const counts: Record<string, { name: string; opening: number; closing: number; weekend: number; total: number }> = {};
      for (const u of allActiveUsers) {
        const name = `${u.firstName || ''} ${u.lastName || ''}`.trim() || u.email || 'Unknown';
        counts[u.id] = { name, opening: 0, closing: 0, weekend: 0, total: 0 };
      }

      for (const s of recentSchedules) {
        if (!counts[s.userId]) continue;
        const start = new Date(s.startTime);
        const end = new Date(s.endTime);
        const startMin = getLocalMinutesInTz(start, storeTimezone);
        const endMin = getLocalMinutesInTz(end, storeTimezone);
        // Compare each end of the shift against the configured hours of the
        // local day it actually falls on. For overnight shifts (close after
        // local midnight), this means the closing comparison uses the
        // following day's configured close time, not the start day's.
        const startDow = getLocalDayOfWeekInTz(start, storeTimezone);
        const endDow = getLocalDayOfWeekInTz(end, storeTimezone);
        const startDayHours = hoursByDay[startDow];
        const endDayHours = hoursByDay[endDow];
        counts[s.userId].total++;
        if (startDayHours && !startDayHours.isClosed) {
          if (minuteDistance(startMin, startDayHours.openMin) <= FAIRNESS_WINDOW_MIN) counts[s.userId].opening++;
        }
        if (endDayHours && !endDayHours.isClosed) {
          if (minuteDistance(endMin, endDayHours.closeMin) <= FAIRNESS_WINDOW_MIN) counts[s.userId].closing++;
        }
        // Weekend is anchored to the shift's start day (matches prior behavior
        // and how managers think about a shift's calendar slot).
        if (startDow === 0 || startDow === 6) counts[s.userId].weekend++;
      }

      const employeeMetrics = Object.entries(counts).map(([empId, data]) => ({
        userId: empId,
        name: data.name,
        openingShifts: data.opening,
        closingShifts: data.closing,
        weekendShifts: data.weekend,
        totalShifts: data.total,
      }));

      const withShifts = employeeMetrics.filter(e => e.totalShifts > 0);
      const n = withShifts.length || 1;
      const avgOpening = withShifts.reduce((acc, e) => acc + e.openingShifts, 0) / n;
      const avgClosing = withShifts.reduce((acc, e) => acc + e.closingShifts, 0) / n;
      const avgWeekend = withShifts.reduce((acc, e) => acc + e.weekendShifts, 0) / n;

      const employeesWithFlags = employeeMetrics.map(e => ({
        ...e,
        flags: [
          ...(avgOpening > 0 && e.openingShifts >= 2 * avgOpening ? ['opening'] : []),
          ...(avgClosing > 0 && e.closingShifts >= 2 * avgClosing ? ['closing'] : []),
          ...(avgWeekend > 0 && e.weekendShifts >= 2 * avgWeekend ? ['weekend'] : []),
        ] as string[],
      }));

      // Build a serializable per-day hours summary for the UI footnote so it
      // can describe the actual thresholds being applied.
      const fmt = (m: number) => {
        // Treat both 0 and the end-of-day sentinel 1440 ("24:00") as midnight.
        if (m <= 0 || m >= 24 * 60) return 'Midnight';
        const h24 = Math.floor(m / 60) % 24;
        const mm = String(m % 60).padStart(2, '0');
        const ampm = h24 >= 12 ? 'PM' : 'AM';
        const h12 = ((h24 + 11) % 12) + 1;
        return mm === '00' ? `${h12} ${ampm}` : `${h12}:${mm} ${ampm}`;
      };
      const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
      const thresholdHours = Array.from({ length: 7 }, (_, d) => {
        const h = hoursByDay[d];
        return {
          day: d,
          label: DAY_LABELS[d],
          isClosed: h.isClosed,
          openLabel: h.isClosed ? null : fmt(h.openMin),
          closeLabel: h.isClosed ? null : fmt(h.closeMin),
        };
      });

      res.json({
        windowDays: 28,
        teamAverages: {
          openingShifts: Math.round(avgOpening * 10) / 10,
          closingShifts: Math.round(avgClosing * 10) / 10,
          weekendShifts: Math.round(avgWeekend * 10) / 10,
        },
        employees: employeesWithFlags,
        flaggedCount: employeesWithFlags.filter(e => e.flags.length > 0).length,
        thresholds: {
          timezone: storeTimezone,
          windowMinutes: FAIRNESS_WINDOW_MIN,
          hoursByDay: thresholdHours,
        },
      });
    } catch (error) {
      logger.error({ error: String(error) }, "[fairness-metrics] error");
      res.status(500).json({ message: "Failed to fetch fairness metrics" });
    }
  });

  // GET /api/shopify/registers/live — today's Shopify POS register sessions for this store
  // Returns { connected: false } when no Shopify shop is linked to the store.
  // Returns { connected: true, registers: [...] } when connected.
  app.get("/api/shopify/registers/live", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const isAdmin = await resolveAnyPermission(userId, ['admin.manage_all', 'schedule.view_all'], storage);
      if (!isAdmin) return res.status(403).json({ message: "Manager access required" });

      const storeId = await tryResolveStoreIdForUser(userId);
      if (!storeId) return res.json({ connected: false, registers: [] });

      // Check whether the store has a Shopify shop linked
      const shopLink = await db.select({ shopDomain: userShops.shopDomain })
        .from(userShops).where(eq(userShops.userId, userId)).limit(1);
      if (!shopLink[0]?.shopDomain) {
        return res.json({ connected: false, registers: [] });
      }

      // Use today's date in the store's local timezone if available, otherwise UTC
      const todayUtc = new Date().toISOString().slice(0, 10);
      let todayDate = todayUtc;
      try {
        const [locRow] = await db.select({ timezone: workLocations.timezone })
          .from(workLocations).where(eq(workLocations.id, storeId)).limit(1);
        if (locRow?.timezone) {
          todayDate = new Date().toLocaleDateString('en-CA', { timeZone: locRow.timezone });
        }
      } catch { /* use UTC fallback */ }

      const registers = await db.select()
        .from(shopifyRegisterSessions)
        .where(and(
          eq(shopifyRegisterSessions.storeId, storeId),
          eq(shopifyRegisterSessions.sessionDate, todayDate),
        ))
        .orderBy(shopifyRegisterSessions.registerName);

      res.json({ connected: true, registers });
    } catch (error) {
      logger.error({ error: String(error) }, "[registers/live] error");
      res.status(500).json({ message: "Failed to fetch live registers" });
    }
  });
}
