import express, { type Request, Response, NextFunction } from "express";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import fs from "fs";
import { registerRoutes } from "./routes";
import { setupVite, serveStatic, log } from "./vite";
import { config } from "./lib/config";
import logger from "./lib/logger";
import { globalErrorHandler } from "./lib/routeWrapper";
import { startRitualScheduler } from "./services/ritualScheduler";
import { backfillLegacyUserRoles, backfillInactiveAuthenticatedUsers } from "./lib/backfill";
import { runSchemaMigrations } from "./lib/migrations";

process.on('uncaughtException', (err) => {
  if (err.message?.includes('Cannot set property message') ||
      err.message?.includes('EAI_AGAIN') ||
      err.message?.includes('ECONNRESET')) {
    console.error('Caught non-fatal error:', err.message);
  } else {
    console.error('Uncaught exception:', err);
    process.exit(1);
  }
});

process.on('unhandledRejection', (reason: any) => {
  console.error('Unhandled rejection:', reason?.message || reason);
});

const app = express();

app.set('trust proxy', 1);

app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false,
}));

app.use('/api/webhooks/shopify', express.raw({ type: 'application/json', limit: '10mb' }), (req: any, _res, next) => {
  if (Buffer.isBuffer(req.body)) {
    req.rawBody = req.body;
    try {
      req.body = JSON.parse(req.body.toString('utf8'));
    } catch {
      req.body = {};
    }
  }
  next();
});

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: false, limit: '10mb' }));

const globalApiRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 300,
  message: { message: "Too many requests, please try again later" },
  standardHeaders: true,
  legacyHeaders: false,
});
app.use('/api', globalApiRateLimiter);

import path from "path";
app.use('/uploads/videos', express.static(path.resolve(process.cwd(), 'uploads', 'videos'), {
  maxAge: '7d',
  immutable: true,
}));

app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse: Record<string, any> | undefined = undefined;

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
      }

      if (logLine.length > 300) {
        logLine = logLine.slice(0, 299) + "…";
      }

      log(logLine);

      if (duration > 200) {
        logger.warn({ method: req.method, path, statusCode: res.statusCode, durationMs: duration }, "slow endpoint detected (>200ms)");
      }
    }
  });

  next();
});

(async () => {
  const server = await registerRoutes(app);

  app.use(globalErrorHandler);

  // Stable build identifier used for SW cache versioning.
  // Derived from server start time: constant for the lifetime of this process,
  // changes on each deploy/restart so the SW cache name rotates per deploy.
  const BUILD_ID = String(Date.now());
  const clerkPublishableKey = config.clerk.publishableKey || '';

  // Serve sw.js via a dedicated route so we can do deterministic string
  // replacement. We CANNOT rely on res.send/res.end monkey-patching because
  // express.static and sendFile bypass those via res.write streaming.
  const swSourcePath = path.resolve(process.cwd(), 'client', 'public', 'sw.js');
  app.get('/sw.js', async (_req: Request, res: Response) => {
    try {
      let swContent = await fs.promises.readFile(swSourcePath, 'utf8');
      swContent = swContent.replace(`'__BUILD_ID__'`, `'${BUILD_ID}'`);
      res.set({
        'Content-Type': 'application/javascript; charset=utf-8',
        'Service-Worker-Allowed': '/',
        'Cache-Control': 'no-cache, no-store, must-revalidate',
      });
      res.send(swContent);
    } catch (err) {
      console.error('[sw.js] Failed to read service worker source:', err);
      res.status(500).send('// Service worker unavailable');
    }
  });

  const isDev = app.get('env') === 'development';

  // In production: inject the Clerk publishable key into index.html at serve time.
  // This eliminates the /api/clerk-key blocking round-trip.
  // In development: Vite handles HTML serving and transforms — we must NOT intercept
  // HTML requests here or we bypass Vite's React Fast Refresh preamble injection.
  if (!isDev && clerkPublishableKey) {
    const CLERK_META_PLACEHOLDER = `content="" id="clerk-publishable-key"`;
    const CLERK_META_FILLED = `content="${clerkPublishableKey}" data-build="${BUILD_ID}" id="clerk-publishable-key"`;
    const htmlSourcePath = path.resolve(process.cwd(), 'dist', 'public', 'index.html');

    app.use(async (req: Request, res: Response, next: NextFunction) => {
      if (req.method !== 'GET') return next();
      if (req.path.startsWith('/api') || req.path.startsWith('/uploads') || req.path === '/sw.js') return next();
      if (!req.headers.accept?.includes('text/html') && req.path !== '/') return next();
      try {
        let html = await fs.promises.readFile(htmlSourcePath, 'utf8');
        html = html.replace(CLERK_META_PLACEHOLDER, CLERK_META_FILLED);
        res.set('Content-Type', 'text/html; charset=utf-8').send(html);
      } catch {
        next();
      }
    });
  }

  // importantly only setup vite in development and after
  // setting up all the other routes so the catch-all route
  // doesn't interfere with the other routes
  if (isDev) {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  // ALWAYS serve the app on the port specified in the environment variable PORT
  // Other ports are firewalled. Default to 5000 if not specified.
  // this serves both the API and the client.
  // It is the only port that is not firewalled.
  const port = config.server.port;
  server.listen({
    port,
    host: "0.0.0.0",
    reusePort: true,
  }, () => {
    log(`serving on port ${port}`);

    // Stagger background job startup so they don't all hit the DB and AI APIs
    // simultaneously when the server is also handling the first user requests.
    startRitualScheduler();
    runSchemaMigrations();
    backfillLegacyUserRoles();
    backfillInactiveAuthenticatedUsers();
  });
})();
