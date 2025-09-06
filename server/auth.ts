import type { Express, RequestHandler } from "express";
import session from "express-session";
import passport from "passport";
import { Strategy } from "openid-client/passport";
import * as client from "openid-client";
import { storage } from "./storage";

// Simple session configuration
export function getSessionMiddleware() {
  return session({
    secret: process.env.SESSION_SECRET!,
    resave: false,
    saveUninitialized: true,
    cookie: {
      secure: false, // Development mode
      httpOnly: true,
      maxAge: 24 * 60 * 60 * 1000, // 24 hours
    },
  });
}

// Simple authentication middleware
export const requireAuth: RequestHandler = (req, res, next) => {
  if (req.isAuthenticated()) {
    next();
  } else {
    res.status(401).json({ error: "Authentication required" });
  }
};

// Setup clean authentication
export async function setupAuth(app: Express) {
  app.use(getSessionMiddleware());
  app.use(passport.initialize());
  app.use(passport.session());

  // Get OIDC configuration
  const issuer = await client.discovery(
    new URL("https://replit.com/oidc"),
    process.env.REPL_ID!
  );

  // Simple passport strategy
  const strategy = new Strategy({
    name: "replit",
    config: issuer,
    scope: "openid email profile",
    callbackURL: `https://${process.env.REPLIT_DOMAINS}/api/auth/callback`,
  }, async (tokens, done) => {
    try {
      const claims = tokens.claims();
      
      // Create or update user
      const user = await storage.upsertUser({
        id: claims.sub,
        email: claims.email,
        firstName: claims.first_name,
        lastName: claims.last_name,
        profileImageUrl: claims.profile_image_url,
      });

      done(null, user);
    } catch (error) {
      done(error);
    }
  });

  passport.use(strategy);
  passport.serializeUser((user: any, done) => done(null, user.id));
  passport.deserializeUser(async (id: string, done) => {
    try {
      const user = await storage.getUserWithRole(id);
      done(null, user);
    } catch (error) {
      done(error);
    }
  });

  // Auth routes
  app.get("/api/auth/login", passport.authenticate("replit"));
  
  app.get("/api/auth/callback", 
    passport.authenticate("replit", { 
      successRedirect: "/",
      failureRedirect: "/api/auth/login",
    })
  );

  app.get("/api/auth/logout", (req, res) => {
    req.logout(() => {
      res.redirect("/");
    });
  });

  app.get("/api/auth/user", requireAuth, async (req: any, res) => {
    res.json(req.user);
  });

  app.get("/api/auth/permissions", requireAuth, async (req: any, res) => {
    try {
      const permissions = await storage.getUserPermissions(req.user.id);
      res.json(permissions);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch permissions" });
    }
  });
}