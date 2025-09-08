import type { Express, RequestHandler } from "express";
import session from "express-session";
import connectPg from "connect-pg-simple";
import { storage } from "./storage";
import crypto from "crypto";

// Simple session configuration
export function getSession() {
  const sessionTtl = 7 * 24 * 60 * 60 * 1000; // 1 week
  const pgStore = connectPg(session);
  const sessionStore = new pgStore({
    conString: process.env.DATABASE_URL,
    createTableIfMissing: false,
    ttl: sessionTtl,
    tableName: "sessions",
  });
  
  return session({
    secret: process.env.SESSION_SECRET!,
    store: sessionStore,
    resave: false,
    saveUninitialized: true,
    rolling: true,
    cookie: {
      httpOnly: true,
      secure: false,
      sameSite: "lax",
      path: "/",
      maxAge: sessionTtl,
    },
  });
}

// Simple authentication middleware
export const requireAuth: RequestHandler = (req: any, res, next) => {
  if (req.session?.user) {
    req.user = req.session.user;
    next();
  } else {
    res.status(401).json({ message: "Unauthorized" });
  }
};

// Setup simple authentication
export async function setupAuth(app: Express) {
  app.use(getSession());

  // Login route - direct redirect to Replit OAuth
  app.get("/api/login", (req: any, res) => {
    const domain = process.env.REPLIT_DOMAINS?.split(',')[0] || req.hostname;
    const redirectUri = `https://${domain}/api/callback`;
    const state = crypto.randomUUID();
    
    // Store state in session for verification
    req.session.oauth_state = state;
    req.session.save((err: any) => {
      if (err) {
        console.error("Session save error:", err);
        return res.status(500).json({ error: "Session error" });
      }
      
      const authUrl = new URL("https://replit.com/oidc/auth");
      authUrl.searchParams.set("client_id", process.env.REPL_ID!);
      authUrl.searchParams.set("response_type", "code");
      authUrl.searchParams.set("scope", "openid email profile");
      authUrl.searchParams.set("redirect_uri", redirectUri);
      authUrl.searchParams.set("state", state);
      
      console.log("Redirecting to Replit OAuth:", authUrl.toString());
      res.redirect(authUrl.toString());
    });
  });

  // Callback route - handle OAuth response
  app.get("/api/callback", async (req: any, res) => {
    try {
      const { code, state } = req.query;
      
      console.log("Callback received:");
      console.log("- Code:", !!code);
      console.log("- State:", state);
      console.log("- Session state:", req.session?.oauth_state);
      console.log("- Session ID:", req.sessionID);
      
      if (!code) {
        console.error("No code in callback");
        return res.redirect("/api/login");
      }
      
      if (!state || state !== req.session?.oauth_state) {
        console.error("State mismatch:", { received: state, expected: req.session?.oauth_state });
        return res.redirect("/api/login");
      }
      
      // Exchange code for token
      const domain = process.env.REPLIT_DOMAINS?.split(',')[0] || req.hostname;
      const redirectUri = `https://${domain}/api/callback`;
      
      const tokenResponse = await fetch("https://replit.com/oidc/token", {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          client_id: process.env.REPL_ID!,
          client_secret: process.env.REPL_SECRET || process.env.REPL_ID!,
          code: code as string,
          grant_type: "authorization_code",
          redirect_uri: redirectUri,
        }),
      });
      
      if (!tokenResponse.ok) {
        console.error("Token exchange failed:", await tokenResponse.text());
        return res.redirect("/api/login");
      }
      
      const tokens = await tokenResponse.json();
      console.log("Tokens received:", !!tokens.access_token);
      
      // Get user info
      const userResponse = await fetch("https://replit.com/oidc/userinfo", {
        headers: {
          Authorization: `Bearer ${tokens.access_token}`,
        },
      });
      
      if (!userResponse.ok) {
        console.error("User info failed:", await userResponse.text());
        return res.redirect("/api/login");
      }
      
      const userInfo = await userResponse.json();
      console.log("User info received:", userInfo);
      
      // Create/update user in database
      const user = await storage.upsertUser({
        id: String(userInfo.sub),
        email: String(userInfo.email || ''),
        firstName: String(userInfo.first_name || ''),
        lastName: String(userInfo.last_name || ''),
        profileImageUrl: String(userInfo.profile_image_url || ''),
      });
      
      // Get user with role
      const userWithRole = await storage.getUserWithRole(user.id);
      
      // Store user in session
      req.session.user = userWithRole;
      req.session.oauth_state = null; // Clear the state
      
      req.session.save((err: any) => {
        if (err) {
          console.error("Session save error after login:", err);
          return res.redirect("/api/login");
        }
        console.log("User logged in successfully, redirecting to /");
        res.redirect("/");
      });
      
    } catch (error) {
      console.error("Callback error:", error);
      res.redirect("/api/login");
    }
  });

  // Logout route
  app.get("/api/logout", (req: any, res) => {
    req.session.destroy((err: any) => {
      if (err) {
        console.error("Logout error:", err);
      }
      res.redirect("/");
    });
  });

  // Auth user route
  app.get('/api/auth/user', requireAuth, async (req: any, res) => {
    res.json(req.user);
  });

  // Auth permissions route  
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