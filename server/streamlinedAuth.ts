import type { Express, RequestHandler } from "express";
import { clerkMiddleware, getAuth, clerkClient } from "@clerk/express";
import { storage } from "./storage";
import { config } from "./lib/config";

const SUPER_ADMIN_EMAIL = "jh@scuild.com";

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
    console.log(`[Auth] 401 on ${req.method} ${req.path} - No userId from Clerk. sessionId=${auth?.sessionId || 'none'}`);
    return res.status(401).json({ message: "Unauthorized" });
  }
  
  try {
    let userWithRole = await storage.getUserWithRole(auth.userId);
    if (!userWithRole) {
      try {
        const clerkUser = await clerkClient.users.getUser(auth.userId);
        const primaryEmailObj = clerkUser.emailAddresses?.find(
          (e: any) => e.id === clerkUser.primaryEmailAddressId
        );
        const email = primaryEmailObj?.emailAddress || '';
        const defaultCompany = await storage.getOrCreateDefaultCompany();
        const synced = await storage.upsertUser({
          id: auth.userId,
          email,
          firstName: clerkUser.firstName || '',
          lastName: clerkUser.lastName || '',
          profileImageUrl: clerkUser.imageUrl || '',
          companyId: defaultCompany.id,
        });
        if (synced) {
          userWithRole = await storage.getUserWithRole(synced.id);
        }
      } catch (syncErr) {
        console.warn('[Auth] Auto-sync failed for', auth.userId, syncErr);
      }
    }
    if (!userWithRole) {
      console.error('[Auth] Could not resolve user record for', auth.userId, '— failing closed');
      return res.status(503).json({ message: "User account not found. Please try again." });
    }
    if (!userWithRole.companyId) {
      console.error('[Auth] User', auth.userId, 'has no companyId — rejecting to prevent unscoped data access');
      return res.status(503).json({ message: "User account configuration incomplete. Please contact support." });
    }
    req.user = userWithRole;
    next();
  } catch (error) {
    console.error('[Auth] Error resolving user for', auth.userId, '— failing closed for security');
    return res.status(503).json({ message: "Service temporarily unavailable. Please try again." });
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
      const clerkUser = await clerkClient.users.getUser(clerkUserId);
      const primaryEmailObj = clerkUser.emailAddresses?.find(
        (e: any) => e.id === clerkUser.primaryEmailAddressId
      );
      const verifiedEmail = primaryEmailObj?.emailAddress || '';
      const verifiedFirstName = clerkUser.firstName || '';
      const verifiedLastName = clerkUser.lastName || '';
      const verifiedImageUrl = clerkUser.imageUrl || '';

      const synced = await storage.upsertUser({
        id: clerkUserId,
        email: verifiedEmail,
        firstName: verifiedFirstName,
        lastName: verifiedLastName,
        profileImageUrl: verifiedImageUrl,
      });

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