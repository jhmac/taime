/**
 * Regression tests for GET /api/auth/user — legacy Clerk-ID↔DB-ID mismatch
 *
 * Core scenario: an admin pre-invites a user by email (creating a DB record
 * with a role). The user later signs up via Clerk, which creates a *new* DB
 * row under the Clerk ID. The new row has an email but no role.
 *
 * GET /api/auth/user's Stage 1 inline sync must:
 *   1. Re-upsert using the DB email (from req.user, NOT from the client request).
 *   2. Detect that upsertUser returned a DIFFERENT record ID (the invited row).
 *   3. Cache the Clerk→DB ID mapping so future requests skip the lookup.
 *   4. Return the role-bearing invited record without touching the Clerk Admin API.
 *
 * Stage 2 (Clerk Admin API) must be skipped when Stage 1 resolves the role
 * and must absorb API errors gracefully when it IS needed.
 */

import { describe, it, expect, vi } from "vitest";

// ---------------------------------------------------------------------------
// Helpers that mirror the sync guard conditions in the real handler
// ---------------------------------------------------------------------------

type SyncCandidate = { id: string; email: string; role: string | null };
type UpsertResult  = { id: string; email: string };
type UserWithRole  = { id: string; email: string; role: string | null };

function stageOneShouldRun(user: SyncCandidate): boolean {
  return !!user.id && !user.role && !!user.email;
}

function stageTwoShouldRun(user: SyncCandidate): boolean {
  return !!user.id && !user.role;
}

async function simulateGetAuthUserSync(
  initialUser: SyncCandidate,
  clerkUserId: string,
  upsertUser: (id: string, email: string) => Promise<UpsertResult>,
  getUserWithRole: (id: string) => Promise<UserWithRole | null>,
  clerkApiCall: () => Promise<{ email: string } | null>,
  clerkToDbIdCache: Map<string, string>,
): Promise<UserWithRole | null> {
  let user: UserWithRole = { ...initialUser };

  if (stageOneShouldRun(initialUser)) {
    const synced = await upsertUser(clerkUserId, user.email);
    if (synced.id !== clerkUserId) {
      clerkToDbIdCache.set(clerkUserId, synced.id);
    }
    const refreshed = await getUserWithRole(synced.id);
    if (refreshed?.role) user = refreshed;
  }

  if (stageTwoShouldRun(user)) {
    try {
      const apiResult = await clerkApiCall();
      if (apiResult?.email) {
        const synced = await upsertUser(clerkUserId, apiResult.email);
        if (synced.id !== clerkUserId) {
          clerkToDbIdCache.set(clerkUserId, synced.id);
        }
        const refreshed = await getUserWithRole(synced.id);
        if (refreshed) user = refreshed;
      }
    } catch {
      // Clerk Admin API unavailable — return user as-is.
    }
  }

  return user;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("GET /api/auth/user — Stage 1 inline sync (legacy Clerk-ID↔DB-ID mismatch)", () => {
  it("maps Clerk ID to invited record when upsertUser returns a different ID", async () => {
    const clerkId    = "clerk_abc";
    const invitedId  = "db_invited_xyz";
    const userEmail  = "alice@example.com";

    const clerkToDbIdCache = new Map<string, string>();

    // upsertUser returns the PRE-EXISTING invited record (different ID)
    const upsertUser = vi.fn().mockResolvedValue({ id: invitedId, email: userEmail });
    const getUserWithRole = vi.fn().mockResolvedValue({ id: invitedId, email: userEmail, role: "employee" });
    const clerkApiCall = vi.fn(); // must NOT be called when Stage 1 succeeds

    const initialUser: SyncCandidate = { id: clerkId, email: userEmail, role: null };

    const result = await simulateGetAuthUserSync(
      initialUser, clerkId, upsertUser, getUserWithRole, clerkApiCall, clerkToDbIdCache,
    );

    expect(result?.role).toBe("employee");
    expect(result?.id).toBe(invitedId);

    // Mapping must be cached for future requests
    expect(clerkToDbIdCache.get(clerkId)).toBe(invitedId);

    // Stage 2 (Clerk Admin API) must NOT be called when Stage 1 resolved role
    expect(clerkApiCall).not.toHaveBeenCalled();
  });

  it("skips Stage 1 when req.user.email is blank (nothing to match against)", async () => {
    const clerkId = "clerk_nomail";
    const clerkToDbIdCache = new Map<string, string>();

    const upsertUser     = vi.fn();
    const getUserWithRole = vi.fn();
    const clerkApiCall   = vi.fn().mockResolvedValue({ email: "alice@example.com" });

    // User in DB but with no email stored yet
    const initialUser: SyncCandidate = { id: clerkId, email: "", role: null };

    // getUserWithRole only called by Stage 2 here
    getUserWithRole.mockResolvedValue({ id: clerkId, email: "alice@example.com", role: null });
    upsertUser.mockResolvedValue({ id: clerkId, email: "alice@example.com" });

    await simulateGetAuthUserSync(
      initialUser, clerkId, upsertUser, getUserWithRole, clerkApiCall, clerkToDbIdCache,
    );

    // Stage 1 upsert not called (no email to match with)
    expect(upsertUser).toHaveBeenCalledTimes(1); // called only from Stage 2
    expect(clerkApiCall).toHaveBeenCalledTimes(1);
  });

  it("absorbs Clerk Admin API errors without throwing (Stage 2 graceful failure)", async () => {
    const clerkId = "clerk_apifail";
    const clerkToDbIdCache = new Map<string, string>();

    const upsertUser      = vi.fn();
    const getUserWithRole = vi.fn();
    const clerkApiCall    = vi.fn().mockRejectedValue(new Error("Clerk API unavailable"));

    // Stage 1 skipped (no email); Stage 2 API throws
    const initialUser: SyncCandidate = { id: clerkId, email: "", role: null };

    const result = await simulateGetAuthUserSync(
      initialUser, clerkId, upsertUser, getUserWithRole, clerkApiCall, clerkToDbIdCache,
    );

    // Must return the original user without crashing
    expect(result?.role).toBeNull();
    expect(result?.id).toBe(clerkId);
  });

  it("returns same record when upsertUser returns the Clerk ID (no mismatch)", async () => {
    const clerkId   = "clerk_same";
    const userEmail = "bob@example.com";
    const clerkToDbIdCache = new Map<string, string>();

    // upsertUser returns the SAME ID — this is the normal first-login path
    const upsertUser      = vi.fn().mockResolvedValue({ id: clerkId, email: userEmail });
    const getUserWithRole = vi.fn().mockResolvedValue({ id: clerkId, email: userEmail, role: null });
    const clerkApiCall    = vi.fn().mockResolvedValue(null);

    const initialUser: SyncCandidate = { id: clerkId, email: userEmail, role: null };

    const result = await simulateGetAuthUserSync(
      initialUser, clerkId, upsertUser, getUserWithRole, clerkApiCall, clerkToDbIdCache,
    );

    // No role found; cache should NOT have an entry (no mismatch)
    expect(clerkToDbIdCache.has(clerkId)).toBe(false);
    expect(result?.role).toBeNull();
  });
});

describe("POST /api/auth/sync — deprecation contract", () => {
  it("endpoint path is still registered in streamlinedAuth (backward-compat)", async () => {
    // Verify the route is still exported so older clients don't get a 404.
    // We do a source-level check: the file must contain the route definition.
    const { readFileSync } = await import("fs");
    const src = readFileSync("server/streamlinedAuth.ts", "utf8");
    expect(src).toContain("app.post('/api/auth/sync'");
    expect(src).toContain("DEPRECATED");
    expect(src).toContain("Deprecation");   // HTTP Deprecation header is set
    expect(src).toContain("Sunset");        // HTTP Sunset header is set
  });
});
