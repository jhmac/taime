import * as client from "openid-client";
import { Strategy, type VerifyFunction } from "openid-client/passport";
import passport from "passport";
import session from "express-session";
import type { Express, RequestHandler } from "express";
import memoize from "memoizee";
import connectPg from "connect-pg-simple";
import { storage } from "./storage";

if (!process.env.REPLIT_DOMAINS) {
  throw new Error("Environment variable REPLIT_DOMAINS not provided");
}

const getOidcConfig = memoize(
  async () => {
    return await client.discovery(
      new URL(process.env.ISSUER_URL ?? "https://replit.com/oidc"),
      process.env.REPL_ID!
    );
  },
  { maxAge: 3600 * 1000 }
);

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
    saveUninitialized: true, // Changed to true for OAuth
    rolling: true,
    cookie: {
      httpOnly: true,
      secure: false, // Development mode
      sameSite: "lax",
      path: "/",
      maxAge: sessionTtl,
    },
  });
}

function updateUserSession(
  user: any,
  tokens: client.TokenEndpointResponse & client.TokenEndpointResponseHelpers
) {
  user.claims = tokens.claims();
  user.access_token = tokens.access_token;
  user.refresh_token = tokens.refresh_token;
  user.expires_at = user.claims?.exp;
}

async function upsertUser(claims: any) {
  await storage.upsertUser({
    id: String(claims["sub"]),
    email: String(claims["email"] || ''),
    firstName: String(claims["first_name"] || ''),
    lastName: String(claims["last_name"] || ''),
    profileImageUrl: String(claims["profile_image_url"] || ''),
  });
}

export async function setupAuth(app: Express) {
  app.set("trust proxy", 1);
  app.use(getSession());
  app.use(passport.initialize());
  app.use(passport.session());

  const config = await getOidcConfig();

  const verify: VerifyFunction = async (
    tokens: client.TokenEndpointResponse & client.TokenEndpointResponseHelpers,
    verified: passport.AuthenticateCallback
  ) => {
    try {
      console.log("Verify function called with tokens:", !!tokens);
      const claims = tokens.claims();
      console.log("Claims received:", claims);
      
      const user = {};
      updateUserSession(user, tokens);
      console.log("User session updated:", user);
      
      await upsertUser(claims);
      console.log("User upserted successfully");
      
      verified(null, user);
    } catch (error) {
      console.error("Verify function error:", error);
      verified(error, null);
    }
  };

  // Register strategy for localhost development
  const localhostStrategy = new Strategy(
    {
      name: `replitauth:localhost`,
      config,
      scope: "openid email profile offline_access",
      callbackURL: `http://localhost:5000/api/callback`,
    },
    verify,
  );
  passport.use(localhostStrategy);

  // Register strategies for production domains
  for (const domain of process.env.REPLIT_DOMAINS!.split(",")) {
    const strategy = new Strategy(
      {
        name: `replitauth:${domain}`,
        config,
        scope: "openid email profile offline_access",
        callbackURL: `https://${domain}/api/callback`,
      },
      verify,
    );
    passport.use(strategy);
  }

  passport.serializeUser((user: Express.User, cb) => cb(null, user));
  passport.deserializeUser((user: Express.User, cb) => cb(null, user));

  app.get("/api/login", (req, res, next) => {
    console.log("Login attempt - hostname:", req.hostname);
    console.log("Available strategies:", passport._strategies);
    passport.authenticate(`replitauth:${req.hostname}`, {
      scope: ["openid", "email", "profile", "offline_access"],
    })(req, res, next);
  });

  app.get("/api/callback", (req, res, next) => {
    console.log("Callback attempt - hostname:", req.hostname);
    console.log("Query params:", req.query);
    console.log("Session ID:", req.sessionID);
    
    passport.authenticate(`replitauth:${req.hostname}`, (err, user, info) => {
      console.log("Passport authenticate result:");
      console.log("- Error:", err);
      console.log("- User:", !!user);
      console.log("- Info:", info);
      
      if (err) {
        console.error("Authentication error:", err);
        return res.redirect("/api/login");
      }
      
      if (!user) {
        console.error("No user returned");
        return res.redirect("/api/login");
      }
      
      req.logIn(user, (loginErr) => {
        if (loginErr) {
          console.error("Login error:", loginErr);
          return res.redirect("/api/login");
        }
        console.log("User logged in successfully, redirecting to /");
        return res.redirect("/");
      });
    })(req, res, next);
  });

  app.get("/api/logout", (req, res) => {
    req.logout(() => {
      res.redirect(
        client.buildEndSessionUrl(config, {
          client_id: process.env.REPL_ID!,
          post_logout_redirect_uri: `${req.protocol}://${req.hostname}`,
        }).href
      );
    });
  });
}

export const isAuthenticated: RequestHandler = async (req, res, next) => {
  const user = req.user as any;

  if (!req.isAuthenticated() || !user?.expires_at) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  const now = Math.floor(Date.now() / 1000);
  if (now <= user.expires_at) {
    return next();
  }

  const refreshToken = user.refresh_token;
  if (!refreshToken) {
    res.status(401).json({ message: "Unauthorized" });
    return;
  }

  try {
    const config = await getOidcConfig();
    const tokenResponse = await client.refreshTokenGrant(config, refreshToken);
    updateUserSession(user, tokenResponse);
    return next();
  } catch (error) {
    res.status(401).json({ message: "Unauthorized" });
    return;
  }
};