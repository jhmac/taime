import type { Express, RequestHandler } from "express";
import { clerkMiddleware, getAuth } from "@clerk/express";
import { storage } from "./storage";

export const requireAuth: RequestHandler = async (req: any, res, next) => {
  const auth = getAuth(req);
  if (!auth?.userId) {
    console.log(`[Auth] 401 on ${req.method} ${req.path} - No userId from Clerk. sessionId=${auth?.sessionId || 'none'}`);
    return res.status(401).json({ message: "Unauthorized" });
  }
  
  try {
    const userWithRole = await storage.getUserWithRole(auth.userId);
    if (userWithRole) {
      req.user = userWithRole;
    } else {
      req.user = { id: auth.userId };
    }
    next();
  } catch (error) {
    req.user = { id: auth.userId };
    next();
  }
};

export async function setupAuth(app: Express) {
  app.use(clerkMiddleware());

  app.get('/api/clerk-key', (_req, res) => {
    const key = process.env.CLERK_PUBLISHABLE_KEY;
    if (!key) {
      return res.status(500).json({ error: "Clerk publishable key not configured" });
    }
    res.json({ publishableKey: key });
  });

  app.post('/api/auth/sync', requireAuth, async (req: any, res) => {
    try {
      const { email, firstName, lastName, profileImageUrl } = req.body;
      
      await storage.upsertUser({
        id: req.user.id,
        email: email || '',
        firstName: firstName || '',
        lastName: lastName || '',
        profileImageUrl: profileImageUrl || '',
      });

      const userWithRole = await storage.getUserWithRole(req.user.id);
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