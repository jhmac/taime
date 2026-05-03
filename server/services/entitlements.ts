/**
 * Entitlement read module — ADR-0011
 *
 * Single source of truth for feature-level access checks.
 * Every route that needs to gate a feature MUST use hasEntitlement or
 * getEntitlements; no code should query the store_entitlements table or
 * Stripe directly.
 *
 * The Stripe webhook handler is the sole writer of store_entitlements rows.
 * This module is read-only.
 *
 * Trial / pre-subscription state: when no rows exist for a store, full access is
 * returned. This matches ADR-0011: "14 days, full feature access, no credit card
 * required at signup." The Stripe webhook handler populates this table when a paid
 * subscription is activated, narrowing the allowed feature set to the plan's keys.
 *
 * Caller audit (Task #457): no pre-existing route-level plan/entitlement checks
 * existed — all access control used RBAC (resolveAnyPermission). The routes listed
 * in the task spec (analytics.ts, payroll.ts) now call hasEntitlement() as the
 * first plan-based feature gates in the codebase.
 */

import { db } from "../db";
import { storeEntitlements } from "@shared/schema";
import { eq } from "drizzle-orm";

// Known feature keys. This list is the source of truth for what constitutes
// "full access" during the trial period. The Stripe webhook handler writes a
// subset of these into store_entitlements when a paid subscription is active.
// Plan-to-feature-key mapping lives in the webhook handler, not here.
const ALL_FEATURE_KEYS: readonly string[] = [
  "core.time_clock",
  "core.scheduling",
  "core.task_management",
  "core.communication",
  "payroll.export",
  "payroll.automation",
  "analytics.dashboard",
  "analytics.advanced",
  "sales.view_all",
  "reports.scheduled",
  "ai.scheduling",
  "ai.payroll_analysis",
  "ai.learning",
  "ai.sop_intelligence",
];

// ─── In-memory cache ────────────────────────────────────────────────────────────
// Per-storeId TTL cache avoids a DB round-trip on every request.
// The Stripe webhook handler should call invalidateEntitlementCache(storeId) after
// writing new rows so routes see the update immediately rather than after the TTL.

const CACHE_TTL_MS = 60_000; // 60 seconds

interface CacheEntry {
  keys: string[];
  expiresAt: number;
}

const _cache = new Map<string, CacheEntry>();

function cacheGet(storeId: string): string[] | null {
  const entry = _cache.get(storeId);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    _cache.delete(storeId);
    return null;
  }
  return entry.keys;
}

function cacheSet(storeId: string, keys: string[]): void {
  _cache.set(storeId, { keys, expiresAt: Date.now() + CACHE_TTL_MS });
}

/**
 * Invalidate the in-memory cache for a store. Call this from the Stripe webhook
 * handler immediately after writing new entitlement rows so subsequent requests
 * reflect the updated subscription without waiting for the TTL.
 */
export function invalidateEntitlementCache(storeId: string): void {
  _cache.delete(storeId);
}

// ─── Core read functions ────────────────────────────────────────────────────────

/**
 * Return all feature keys the store is entitled to.
 *
 * No rows → trial / pre-subscription state: all feature keys are returned per
 * ADR-0011 (14-day full-access trial, no credit card required at signup).
 *
 * DB errors are NOT caught — they propagate so the route returns 500 rather than
 * silently granting access that cannot be verified (billing-bypass prevention).
 */
export async function getEntitlements(storeId: string): Promise<string[]> {
  const cached = cacheGet(storeId);
  if (cached !== null) return cached;

  // Intentionally not wrapped in try/catch: a DB error must surface as 500,
  // not silently grant full access (which would be a billing-bypass vulnerability).
  const rows = await db
    .select({ featureKey: storeEntitlements.featureKey })
    .from(storeEntitlements)
    .where(eq(storeEntitlements.storeId, storeId));

  // No rows → trial / pre-subscription: grant full access per ADR-0011.
  const keys: string[] = rows.length === 0
    ? [...ALL_FEATURE_KEYS]
    : rows.map((r) => r.featureKey);

  cacheSet(storeId, keys);
  return keys;
}

/**
 * Return true if the store holds the given feature key.
 *
 * Usage in a route:
 *   if (!await hasEntitlement(storeId, "analytics.dashboard")) {
 *     return res.status(403).json({ message: "Your plan does not include this feature." });
 *   }
 */
export async function hasEntitlement(storeId: string, featureKey: string): Promise<boolean> {
  const keys = await getEntitlements(storeId);
  return keys.includes(featureKey);
}
