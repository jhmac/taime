import type { Express, RequestHandler } from "express";
import { clerkMiddleware, getAuth, clerkClient } from "@clerk/express";
import { storage } from "./storage";
import { config } from "./lib/config";

const SUPER_ADMIN_EMAIL = "jh@scuild.com";

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
