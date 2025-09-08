import type { Express, RequestHandler } from "express";
import session from "express-session";
import { storage } from "./storage";

// Ultra-simple session middleware
export function getSession() {
  return session({
    secret: process.env.SESSION_SECRET!,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: false,
      maxAge: 24 * 60 * 60 * 1000, // 24 hours
    },
  });
}

// Simple auth middleware
export const requireAuth: RequestHandler = (req: any, res, next) => {
  if (req.session?.user) {
    req.user = req.session.user;
    next();
  } else {
    res.status(401).json({ message: "Unauthorized" });
  }
};

export async function setupAuth(app: Express) {
  app.use(getSession());

  // Simplified login - redirect to Replit OAuth
  app.get("/api/login", (req: any, res) => {
    const redirectUri = `https://${process.env.REPLIT_DOMAINS?.split(',')[0]}/api/callback`;
    const authUrl = `https://replit.com/oidc/auth?client_id=${process.env.REPL_ID}&response_type=code&scope=openid+email+profile&redirect_uri=${encodeURIComponent(redirectUri)}`;
    
    console.log("Redirecting to:", authUrl);
    res.redirect(authUrl);
  });

  // Simplified callback
  app.get("/api/callback", async (req: any, res) => {
    const { code } = req.query;
    
    console.log("Callback - Code received:", !!code);
    
    if (!code) {
      console.log("No code, redirecting to login");
      return res.redirect("/api/login");
    }

    try {
      // Exchange code for token
      const redirectUri = `https://${process.env.REPLIT_DOMAINS?.split(',')[0]}/api/callback`;
      const response = await fetch("https://replit.com/oidc/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: process.env.REPL_ID!,
          code: code as string,
          grant_type: "authorization_code",
          redirect_uri: redirectUri,
        }),
      });

      if (!response.ok) {
        console.error("Token exchange failed:", response.status);
        return res.redirect("/api/login");
      }

      const tokens = await response.json();
      
      // Get user info
      const userResponse = await fetch("https://replit.com/oidc/userinfo", {
        headers: { Authorization: `Bearer ${tokens.access_token}` },
      });

      const userInfo = await userResponse.json();
      console.log("User authenticated:", userInfo.email);

      // Create/update user
      await storage.upsertUser({
        id: String(userInfo.sub),
        email: String(userInfo.email || ''),
        firstName: String(userInfo.first_name || ''),
        lastName: String(userInfo.last_name || ''),
        profileImageUrl: String(userInfo.profile_image_url || ''),
      });

      // Get user with role
      const userWithRole = await storage.getUserWithRole(String(userInfo.sub));
      
      // Store in session
      req.session.user = userWithRole;
      
      console.log("User logged in, redirecting to dashboard");
      res.redirect("/");
      
    } catch (error) {
      console.error("Authentication error:", error);
      res.redirect("/api/login");
    }
  });

  // Logout
  app.get("/api/logout", (req: any, res) => {
    req.session.destroy(() => {
      res.redirect("/");
    });
  });

  // User endpoint
  app.get('/api/auth/user', requireAuth, (req: any, res) => {
    res.json(req.user);
  });

  // Permissions endpoint
  app.get('/api/auth/permissions', requireAuth, async (req: any, res) => {
    try {
      const permissions = await storage.getUserPermissions(req.user.id);
      res.json(permissions);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch permissions" });
    }
  });
}