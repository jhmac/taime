/**
 * Permission Resolution Module (ADR-0002)
 *
 * Implements the authoritative three-tier resolution chain:
 *   1. UserPermissionOverride row  → explicit grant or deny
 *   2. rolePermissions for the User's Role  → role default
 *   3. deny  → no access
 *
 * External callers should use `resolvePermission` for all single-key checks.
 * For unit tests that need to run without a database, use `buildPermissionResolver`
 * to construct a pure resolver from pre-fetched row data.
 *
 * Cache note: `storage.getUserPermissions` already maintains a 2-minute per-user
 * cache (keyed `permissions:<userId>`).  `resolvePermission` delegates to that
 * function so there is no additional cache layer here — no regression in DB load.
 *
 * TODO: Add unit tests in `tests/permissionResolver.test.ts` covering:
 *   - override=false beats role grant
 *   - override=true beats role deny
 *   - no override falls through to role grant
 *   - no override, no role grant → deny (false)
 *   - owner/admin short-circuit → always true
 */

import { storage as defaultStorage } from "../storage";

/** Minimal storage interface required by the resolver (allows test mocks). */
interface PermissionStorage {
  getUserPermissions(userId: string): Promise<Array<{ name: string }>>;
}

// ---------------------------------------------------------------------------
// Types shared between pure helper and DB-backed resolver
// ---------------------------------------------------------------------------

/** Minimal shape of a user_permission_overrides row needed for resolution. */
export interface OverrideRow {
  permissionName: string;
  grant: boolean;
}

/** Minimal shape of a resolved permission row needed for resolution. */
export interface RolePermRow {
  name: string;
}

// ---------------------------------------------------------------------------
// Pure helper — no DB calls, suitable for unit testing
// ---------------------------------------------------------------------------

/**
 * Builds a synchronous permission-resolver function from pre-fetched data.
 *
 * @param overrides     All override rows for the user (from `user_permission_overrides`).
 * @param rolePerms     All permissions granted to the user's role (already resolved permission rows).
 * @param isOwnerOrAdmin  When true, the user holds a system-level role and receives every permission.
 *
 * @returns A pure function `(permissionKey: string) => boolean` that implements
 *          the ADR-0002 chain without touching the database.
 *
 * @example
 * ```ts
 * const resolve = buildPermissionResolver(overrides, rolePerms, false);
 * assert(resolve('sales.view_all') === true);
 * ```
 */
export function buildPermissionResolver(
  overrides: OverrideRow[],
  rolePerms: RolePermRow[],
  isOwnerOrAdmin = false,
): (permissionKey: string) => boolean {
  const rolePermSet = new Set(rolePerms.map((p) => p.name));
  const overrideMap = new Map(overrides.map((o) => [o.permissionName, o.grant]));

  return (permissionKey: string): boolean => {
    // Tier 1 — explicit override row
    const override = overrideMap.get(permissionKey);
    if (override === false) return false; // explicit deny beats everything
    if (override === true) return true;   // explicit grant

    // Tier 2 — role default (owner/admin always have all permissions)
    if (isOwnerOrAdmin) return true;
    return rolePermSet.has(permissionKey);

    // Tier 3 — implicit deny (fall-through to false)
  };
}

// ---------------------------------------------------------------------------
// DB-backed resolver — the single authoritative entry point
// ---------------------------------------------------------------------------

/**
 * Resolves whether `userId` holds `permissionKey`, following the ADR-0002 chain:
 *   PermissionOverride row → rolePermissions for the User's Role → deny.
 *
 * Results are served from the per-user permission cache maintained by
 * `storage.getUserPermissions` (2-minute TTL), so repeated calls within the
 * same request cycle are free.
 *
 * @param userId        The DB user ID to check.
 * @param permissionKey The permission name string (e.g. `"admin.manage_all"`).
 * @returns `true` if the user holds the permission, `false` otherwise.
 */
export async function resolvePermission(
  userId: string,
  permissionKey: string,
  storageOverride?: PermissionStorage,
): Promise<boolean> {
  const s = storageOverride ?? defaultStorage;
  const perms = await s.getUserPermissions(userId);
  return perms.some((p) => p.name === permissionKey);
}

/**
 * Convenience helper: resolves whether `userId` holds **any** of the given
 * `permissionKeys`.  All keys are evaluated against the same cached permission
 * list, so this is no more expensive than a single `resolvePermission` call.
 *
 * Useful for guards that accept multiple equivalent permissions (e.g.
 * `"hr.edit_team" | "admin.manage_all"`).
 *
 * @param userId          The DB user ID to check.
 * @param permissionKeys  One or more permission name strings.
 * @param storageOverride Optional storage implementation (for test injection).
 * @returns `true` if the user holds at least one of the given permissions.
 */
export async function resolveAnyPermission(
  userId: string,
  permissionKeys: string[],
  storageOverride?: PermissionStorage,
): Promise<boolean> {
  const s = storageOverride ?? defaultStorage;
  const perms = await s.getUserPermissions(userId);
  const permSet = new Set(perms.map((p) => p.name));
  return permissionKeys.some((key) => permSet.has(key));
}
