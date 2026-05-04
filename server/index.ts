import path from "path";
import express, { type Request, Response, NextFunction } from "express";
import helmet from "helmet";
import compression from "compression";
import rateLimit from "express-rate-limit";
import fs from "fs";
import { registerRoutes } from "./routes";
import { setupVite, serveStatic, log } from "./vite";
import { config } from "./lib/config";
import { getAuth } from "@clerk/express";
import type { Permission } from "@shared/schema";
import { resolveDbUserId } from "./streamlinedAuth";
import { storage } from "./storage";
import { cache } from "./services/cache";
import logger from "./lib/logger";
import { globalErrorHandler } from "./lib/routeWrapper";
import { startRitualScheduler } from "./services/ritualScheduler";
import { startDailyQuestionnaireScheduler } from "./services/dailyQuestionnaireScheduler";
import { startShopifyReportScheduler } from "./routes/shopify";
import { backfillLegacyUserRoles, backfillInactiveAuthenticatedUsers, backfillStoreCreatorOwnerRole } from "./services/backfill";
import { runSchemaMigrations, scheduleStaleTokenCleanup, scheduleDeliveryLogCleanup } from "./services/migrations";
import { runStartupAiContentBackfill } from "./services/sopIndexer";
import { validateMigrationJournal } from "./lib/validateMigrations";

validateMigrationJournal();

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

app.use(compression());

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

  // Apple App Site Association — enables Universal Links so iOS/iPadOS opens the native
  // Taime app (com.taime.app) when users tap taime.us links instead of Safari.
  // The developer must also add "applinks:taime.us" to the iOS target's Associated Domains
  // entitlement in Xcode for this to take effect.
  const aasaPayload = JSON.stringify({
    applinks: {
      apps: [],
      details: [
        {
          appIDs: ["TAIMEAPPTEAMID.com.taime.app"],
          components: [
            { "/": "/*", comment: "All paths open in the native app" },
          ],
        },
      ],
    },
  });
  app.get("/.well-known/apple-app-site-association", (_req: Request, res: Response) => {
    res.set("Content-Type", "application/json");
    res.send(aasaPayload);
  });
  // Android App Links (fallback for future Android release)
  app.get("/.well-known/assetlinks.json", (_req: Request, res: Response) => {
    res.set("Content-Type", "application/json");
    res.json([{
      relation: ["delegate_permission/common.handle_all_urls"],
      target: { namespace: "android_app", package_name: "com.taime.app", sha256_cert_fingerprints: [] },
    }]);
  });

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
    const assetsDir = path.resolve(process.cwd(), 'dist', 'public', 'assets');

    // Scan for critical vendor chunks once at startup and cache the modulepreload hints.
    // These prefixes match the manualChunks names in vite.config.ts.
    const CRITICAL_CHUNK_PREFIXES = ['vendor-react-', 'vendor-clerk-', 'vendor-query-'];
    let modulePreloadHints = '';
    try {
      const files = await fs.promises.readdir(assetsDir);
      const hints = files
        .filter(f => f.endsWith('.js') && CRITICAL_CHUNK_PREFIXES.some(p => f.startsWith(p)))
        .map(f => `<link rel="modulepreload" href="/assets/${f}" as="script" crossorigin>`)
        .join('\n    ');
      if (hints) modulePreloadHints = `\n    ${hints}`;
    } catch {
      // dist/assets not available — hints are optional, skip silently.
    }

    app.use(async (req: Request, res: Response, next: NextFunction) => {
      if (req.method !== 'GET') return next();
      if (req.path.startsWith('/api') || req.path.startsWith('/uploads') || req.path === '/sw.js') return next();
      if (!req.headers.accept?.includes('text/html') && req.path !== '/') return next();
      try {
        let html = await fs.promises.readFile(htmlSourcePath, 'utf8');
        html = html.replace(CLERK_META_PLACEHOLDER, CLERK_META_FILLED);

        // Inject modulepreload hints for critical vendor chunks so the browser
        // starts fetching them in parallel with HTML parsing.
        if (modulePreloadHints) {
          html = html.replace('</head>', `${modulePreloadHints}\n  </head>`);
        }

        // Bootstrap injection: embed user + permissions as inline JSON so the
        // client JS starts with data already available, skipping the auth
        // round-trips for returning users.  Uses cache-backed storage calls
        // with 200ms race timeouts so DB latency never blocks HTML delivery.
        try {
          const auth = getAuth(req as unknown as Parameters<typeof getAuth>[0]);
          if (auth?.userId) {
            // Apply Clerk→DB ID mapping so legacy users (whose DB ID differs
            // from their Clerk ID) get a cache hit instead of a miss.
            const dbUserId = resolveDbUserId(auth.userId);
            const cacheKey = `permissions:${dbUserId}`;
            const cachedPerms = cache.get<Permission[]>(cacheKey);
            // getUserWithRole is cheap (cache-backed in storage layer)
            const userWithRole = await Promise.race([
              storage.getUserWithRole(dbUserId),
              new Promise<null>(resolve => setTimeout(() => resolve(null), 200)),
            ]);
            if (userWithRole) {
              const permissions = cachedPerms ?? await Promise.race([
                storage.getUserPermissions(dbUserId),
                new Promise<null>(resolve => setTimeout(() => resolve(null), 200)),
              ]);
              // Escape </script> sequences so user-controlled fields (names, etc.)
              // cannot break out of the script block — this is critical to prevent XSS.
              const bootstrapJson = JSON.stringify({ user: userWithRole, permissions: permissions ?? [] })
                .replace(/</g, '\\u003c');
              const bootstrapScript = `<script id="app-bootstrap" type="application/json">${bootstrapJson}</script>`;
              html = html.replace('</head>', `${bootstrapScript}\n</head>`);
            }
          }
        } catch {
          // Bootstrap injection failure is non-fatal — serve HTML without it.
        }

        res.set({
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'no-cache, no-store, must-revalidate',
          'Pragma': 'no-cache',
          'Expires': '0',
        }).send(html);
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
    startDailyQuestionnaireScheduler(storage);
    // Run migrations first so default roles are seeded, then run backfills that depend on them
    let stopShopifyReportScheduler: (() => void) | null = null;
    runSchemaMigrations().then(async () => {
      backfillLegacyUserRoles();
      backfillInactiveAuthenticatedUsers();
      backfillStoreCreatorOwnerRole();
      scheduleStaleTokenCleanup();
      scheduleDeliveryLogCleanup();
      // Start after migrations so the shopify_report_schedules table is guaranteed to exist
      stopShopifyReportScheduler = startShopifyReportScheduler();
      const { scheduleTimesheetReminders } = await import('./services/timesheetReminderService');
      scheduleTimesheetReminders();
    }).catch((err) => console.error('[Startup] Migration failed:', err));

    // Graceful shutdown: stop all background schedulers
    const gracefulStop = () => {
      stopShopifyReportScheduler?.();
      process.exit(0);
    };
    process.once('SIGTERM', gracefulStop);
    process.once('SIGINT', gracefulStop);
    setTimeout(() => runStartupAiContentBackfill(), 5000);
  });
})();
