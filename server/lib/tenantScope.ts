import { db } from "../db";
import { users, roles } from "@shared/schema";
import { eq } from "drizzle-orm";

/**
 * TENANT ISOLATION POLICY — Admin / Manager Endpoints
 * =====================================================
 *
 * STORE-SCOPED (requires requester to have a resolved locationId)
 * ---------------------------------------------------------------
 * These endpoints now filter both their primary data query AND the user
 * lookup to the requester's store via tryResolveStoreIdForUser().
 * Multi-store owners (locationId = null) see all data (intentional).
 *
 *  GET /api/geofence/events        (server/routes/geofence.ts)
 *    - geofenceEvents WHERE locationId = storeId
 *    - getAllUsers(storeId) for name enrichment
 *
 *  GET /api/offsite-sessions       (server/routes/offsiteRules.ts)
 *    - getOffsiteSessions({ locationId: storeId })
 *    - getAllUsers(storeId) for name enrichment
 *
 *  GET /api/offsite-sessions/:id/receipt  (server/routes/offsiteRules.ts)
 *    - Per-session ownership check for the owner path
 *    - Admin path: resolves requester storeId, checks session.locationId ===
 *      storeId before returning data; multi-store owners (storeId = null) pass
 *    - Uses getUser() point-lookups for employee/reviewer (no cross-store scan)
 *
 *  GET /api/trip-history           (server/routes/offsiteRules.ts)
 *    - getOffsiteSessions({ locationId: storeId })
 *    - getAllUsers(storeId) for name enrichment
 *
 *  GET /api/training/manager/matrix        (server/routes/trainingPlayer.ts)
 *  GET /api/training/manager/export-csv    (server/routes/trainingPlayer.ts)
 *    - getAllUsers(storeId) scoped by resolved location
 *    - getTrainingModules(storeId) already scoped
 *
 *  GET /api/timesheets/review      (server/routes/timesheets.ts)
 *  GET /api/timesheets/export      (server/routes/timesheets.ts)
 *    - getAllUsers() with post-filter by locationId (pre-existing, correct)
 *
 * INTENTIONALLY GLOBAL (multi-store / system-wide)
 * -------------------------------------------------
 * These services operate across all stores and are NOT store-scoped.
 * They run as system-wide sweeps, not on behalf of a single user/store.
 *
 *  timesheetReminderService.ts  — scheduled sweep across all active users
 *  payrollAutomationService.ts  — automated payroll for all stores
 *  routeTrackingService.ts      — background breadcrumb processing
 *  geofencingService.ts         — geofence sweep / auto-clock-out daemon
 *  overtimePreventionService.ts — weekly overtime monitor across all stores
 *
 * To add a new admin endpoint: call tryResolveStoreIdForUser(requesterId),
 * pass the result to getAllUsers() and any storage query that supports a
 * locationId filter. If storeId is null the caller is a multi-store owner
 * and should see unfiltered data.
 */

export class CrossTenantError extends Error {
  readonly statusCode = 403;
  constructor(message = "Access denied: cross-tenant operation not permitted") {
    super(message);
    this.name = "CrossTenantError";
  }
}

export async function resolveUserTenant(
  userId: string,
): Promise<string | null> {
  const [row] = await db
    .select({ locationId: users.locationId, companyId: users.companyId })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return row?.locationId ?? row?.companyId ?? null;
}

export async function assertSameTenant(
  requestingUserId: string,
  targetUserId: string,
): Promise<void> {
  if (requestingUserId === targetUserId) return;

  const [requesterRow, targetTenant] = await Promise.all([
    db
      .select({ locationId: users.locationId, companyId: users.companyId, roleName: roles.name })
      .from(users)
      .leftJoin(roles, eq(users.roleId, roles.id))
      .where(eq(users.id, requestingUserId))
      .limit(1)
      .then(rows => rows[0] ?? null),
    resolveUserTenant(targetUserId),
  ]);

  const requesterTenant =
    requesterRow?.locationId ?? requesterRow?.companyId ?? null;

  if (requesterTenant === null) {
    if (requesterRow?.roleName !== "owner") {
      throw new CrossTenantError();
    }
    return;
  }

  if (requesterTenant !== targetTenant) {
    throw new CrossTenantError();
  }
}
