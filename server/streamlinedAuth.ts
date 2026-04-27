import type { Express, RequestHandler } from "express";
import { clerkMiddleware, getAuth, clerkClient } from "@clerk/express";
import { createHmac, timingSafeEqual } from "crypto";
import { eq } from "drizzle-orm";
import { db } from "./db";
import { users, roles } from "@shared/schema";
import { storage } from "./storage";
import { config } from "./lib/config";

const SUPER_ADMIN_EMAIL = "jh@scuild.com";

const E2E_COOKIE = "__e2e_uid";
const IS_DEV = config.server.nodeEnv !== "production";
// E2E auth bypass requires BOTH IS_DEV and an explicit opt-in flag (not committed to VCS by default).
// E2E_TEST_SECRET must be set via environment/CI secrets (not as a committed env var).
const E2E_BYPASS_ENABLED = IS_DEV && process.env.ENABLE_E2E_AUTH_BYPASS === 'true';
const E2E_TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hour

function createE2EToken(userId: string, secret: string): string {
  const ts = Date.now().toString();
  const payload = `${userId}:${ts}`;
  const sig = createHmac("sha256", secret).update(payload).digest("hex");
  return `${payload}:${sig}`;
}

function verifyE2EToken(raw: string, secret: string): string | null {
  const lastColon = raw.lastIndexOf(":");
  if (lastColon < 0) return null;
  const payload = raw.substring(0, lastColon);
  const sig = raw.substring(lastColon + 1);
  const expected = createHmac("sha256", secret).update(payload).digest("hex");
  try {
    if (!timingSafeEqual(Buffer.from(sig, "hex"), Buffer.from(expected, "hex"))) return null;
  } catch {
    return null;
  }
  const secondColon = payload.lastIndexOf(":");
  if (secondColon < 0) return null;
  const userId = payload.substring(0, secondColon);
  const ts = parseInt(payload.substring(secondColon + 1), 10);
  if (isNaN(ts) || Date.now() - ts > E2E_TOKEN_TTL_MS) return null;
  return userId;
}

/**
 * In-memory map: Clerk user ID (user_XXX) → DB user ID (may differ for
 * legacy users whose DB ID pre-dates Clerk, e.g. "46870047").
 *
 * Populated whenever /api/auth/sync finds an email-matched user whose DB ID
 * differs from the incoming Clerk ID.  Once cached, requireAuth can resolve
 * the correct DB user on every subsequent request without hitting the Clerk
 * admin API or doing an email lookup again.
 */
const clerkToDbIdCache = new Map<string, string>();

export const requireSuperAdmin: RequestHandler = async (req: any, res, next) => {
  if (!req.user?.id) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  try {
    const clerkUser = await clerkClient.users.getUser(req.user.id);
    const primaryEmailObj = clerkUser.emailAddresses?.find(
      (e: any) => e.id === clerkUser.primaryEmailAddressId
    );
    const verifiedEmail = primaryEmailObj?.verification?.status === 'verified' 
      ? primaryEmailObj.emailAddress 
      : null;

    if (!verifiedEmail || verifiedEmail.toLowerCase() !== SUPER_ADMIN_EMAIL.toLowerCase()) {
      console.log(`[Security] Super admin access DENIED for user ${req.user.id} (${verifiedEmail || 'no verified primary email'}) on ${req.method} ${req.path}`);
      return res.status(403).json({ 
        message: "Access denied. Only the system owner can perform this action.",
        code: "SUPER_ADMIN_REQUIRED"
      });
    }
    next();
  } catch (error) {
    console.error("[Security] Super admin check failed:", error);
    return res.status(403).json({ message: "Access denied" });
  }
};

export const requireAuth: RequestHandler = async (req: any, res, next) => {
  // Dev-only: honour an HMAC-signed E2E bypass cookie set by /api/dev/test-login.
  // The cookie value is a signed token; raw user IDs are rejected.
  if (E2E_BYPASS_ENABLED) {
    const e2eSecret = process.env.E2E_TEST_SECRET;
    if (e2eSecret) {
      const cookieHeader = req.headers.cookie || '';
      const rawToken = cookieHeader
        .split(';')
        .map((c: string) => c.trim().split('='))
        .find(([k]: string[]) => k === E2E_COOKIE)?.[1];
      if (rawToken) {
        const userId = verifyE2EToken(decodeURIComponent(rawToken), e2eSecret);
        if (userId) {
          const userWithRole = await storage.getUserWithRole(userId);
          req.user = userWithRole || { id: userId };
          return next();
        }
      }
    }
  }

  const auth = getAuth(req);
  if (!auth?.userId) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  try {
    // If a previous sync already resolved this Clerk ID → DB ID, use that.
    const cachedDbId = clerkToDbIdCache.get(auth.userId);
    const lookupId = cachedDbId ?? auth.userId;

    let userWithRole = await storage.getUserWithRole(lookupId);

    if (!userWithRole && !cachedDbId) {
      // Not in DB by Clerk ID — try auto-sync via Clerk admin API.
      try {
        const clerkUser = await clerkClient.users.getUser(auth.userId);
        const primaryEmailObj = clerkUser.emailAddresses?.find(
          (e: any) => e.id === clerkUser.primaryEmailAddressId
        );
        const email = primaryEmailObj?.emailAddress || '';
        const synced = await storage.upsertUser({
          id: auth.userId,
          email,
          firstName: clerkUser.firstName || '',
          lastName: clerkUser.lastName || '',
          profileImageUrl: clerkUser.imageUrl || '',
        });
        if (synced) {
          userWithRole = await storage.getUserWithRole(synced.id);
          // Cache Clerk ID → DB ID when upsertUser matched by email (IDs differ)
          if (synced.id !== auth.userId) {
            clerkToDbIdCache.set(auth.userId, synced.id);
          }
        }
      } catch (syncErr) {
        // Clerk admin API unavailable — leave userWithRole undefined.
        // The /api/auth/sync endpoint (called by the client) will resolve this
        // using the email from the request body and populate the cache.
      }
    }

    req.user = userWithRole || { id: lookupId };
    next();
  } catch (error) {
    req.user = { id: auth.userId };
    next();
  }
};

export async function setupAuth(app: Express) {
  app.use(clerkMiddleware());

  app.get('/api/clerk-key', (_req, res) => {
    const key = config.clerk.publishableKey;
    if (!key) {
      return res.status(500).json({ error: "Clerk publishable key not configured" });
    }
    res.json({ publishableKey: key });
  });

  // Dev-only: set an E2E bypass cookie so automated tests can authenticate
  // without going through Clerk. Requires E2E_TEST_SECRET env var AND is
  // restricted to localhost requests only to prevent accidental misuse.
  const isLocalhost = (req: any) => {
    const ip = req.ip || req.socket?.remoteAddress || '';
    return ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
  };

  if (E2E_BYPASS_ENABLED) {
    app.get('/api/dev/test-login', async (req: any, res) => {
      if (!isLocalhost(req)) {
        return res.status(403).json({ error: "E2E endpoints are only accessible from localhost" });
      }
      const secret = req.query.secret as string;
      const configuredSecret = process.env.E2E_TEST_SECRET || '';
      if (!configuredSecret) {
        return res.status(503).json({ error: "E2E_TEST_SECRET is not configured" });
      }
      if (!secret || secret !== configuredSecret) {
        return res.status(403).json({ error: "Invalid or missing E2E secret" });
      }
      const userId = req.query.userId as string;
      if (!userId) {
        return res.status(400).json({ error: "userId query param required" });
      }
      const user = await storage.getUserWithRole(userId);
      if (!user) {
        return res.status(404).json({ error: "User not found" });
      }
      const token = createE2EToken(userId, configuredSecret);
      res.cookie(E2E_COOKIE, token, {
        httpOnly: false,
        sameSite: 'lax',
        maxAge: 60 * 60 * 1000,
      });
      res.json({ ok: true, userId, role: user.role?.name });
    });

    app.get('/api/dev/test-logout', (req: any, res) => {
      if (!isLocalhost(req)) {
        return res.status(403).json({ error: "E2E endpoints are only accessible from localhost" });
      }
      res.clearCookie(E2E_COOKIE);
      res.json({ ok: true });
    });

    // Dev-only: return the first available owner-role user so tests don't
    // depend on a hard-coded user ID.
    app.get('/api/dev/test-setup', async (req: any, res) => {
      if (!isLocalhost(req)) {
        return res.status(403).json({ error: "E2E endpoints are only accessible from localhost" });
      }
      const secret = req.query.secret as string;
      const configuredSecret = process.env.E2E_TEST_SECRET || '';
      if (!configuredSecret) {
        return res.status(503).json({ error: "E2E_TEST_SECRET is not configured" });
      }
      if (!secret || secret !== configuredSecret) {
        return res.status(403).json({ error: "Invalid or missing E2E secret" });
      }
      const [ownerRole] = await db
        .select({ id: roles.id })
        .from(roles)
        .where(eq(roles.name, 'owner'))
        .limit(1);
      if (!ownerRole) {
        return res.status(503).json({ error: "No owner role found — seed the database first" });
      }
      const [ownerUser] = await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.roleId, ownerRole.id))
        .limit(1);
      if (!ownerUser) {
        return res.status(503).json({ error: "No owner user found — seed the database first" });
      }
      res.json({ userId: ownerUser.id });
    });
  }

  app.post('/api/auth/sync', requireAuth, async (req: any, res) => {
    try {
      const auth = getAuth(req);
      const clerkUserId = auth?.userId || req.user.id;

      // Prefer email/name from the request body (sent by the Clerk client-side
      // SDK) so we never depend on the Clerk admin API, which fails when the
      // secret key doesn't match the publishable key's Clerk instance.
      const bodyEmail     = req.body?.email           || '';
      const bodyFirst     = req.body?.firstName       || '';
      const bodyLast      = req.body?.lastName        || '';
      const bodyImage     = req.body?.profileImageUrl || '';

      let verifiedEmail     = bodyEmail;
      let verifiedFirstName = bodyFirst;
      let verifiedLastName  = bodyLast;
      let verifiedImageUrl  = bodyImage;

      if (!verifiedEmail) {
        try {
          const clerkUser = await clerkClient.users.getUser(clerkUserId);
          const primaryEmailObj = clerkUser.emailAddresses?.find(
            (e: any) => e.id === clerkUser.primaryEmailAddressId
          );
          verifiedEmail     = primaryEmailObj?.emailAddress || '';
          verifiedFirstName = verifiedFirstName || clerkUser.firstName || '';
          verifiedLastName  = verifiedLastName  || clerkUser.lastName  || '';
          verifiedImageUrl  = verifiedImageUrl  || clerkUser.imageUrl  || '';
        } catch (_clerkErr) {
          // Clerk admin API unreachable — proceed without extra data.
        }
      }

      const synced = await storage.upsertUser({
        id: clerkUserId,
        email: verifiedEmail,
        firstName: verifiedFirstName,
        lastName: verifiedLastName,
        profileImageUrl: verifiedImageUrl,
      });

      // If upsertUser matched an existing user by email whose DB ID differs
      // from the Clerk ID, cache the mapping so requireAuth can resolve it on
      // every subsequent request without going through sync again.
      if (synced.id !== clerkUserId) {
        clerkToDbIdCache.set(clerkUserId, synced.id);
      }

      const userWithRole = await storage.getUserWithRole(synced.id);
      res.json(userWithRole);
    } catch (error) {
      console.error("Error syncing user:", error);
      res.status(500).json({ message: "Failed to sync user" });
    }
  });

  app.get('/api/auth/user', requireAuth, async (req: any, res) => {
    res.json(req.user);
  });

  app.get('/api/auth/permissions', requireAuth, async (req: any, res) => {
    try {
      const permissions = await storage.getUserPermissions(req.user.id);
      res.json(permissions);
    } catch (error) {
      console.error("Error fetching permissions:", error);
      res.status(500).json({ message: "Failed to fetch permissions" });
    }
  });
}
