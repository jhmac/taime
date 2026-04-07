import type { Express } from "express";
import express from "express";
import { createServer, type Server } from "http";
import path from "path";
import { WebSocketServer, WebSocket } from "ws";
import { storage } from "./storage";
import { setupAuth, requireAuth as isAuthenticated } from "./streamlinedAuth";
import { registerAuthRoutes } from "./routes/auth";
import { registerTimeEntryRoutes } from "./routes/timeEntries";
import { registerScheduleRoutes } from "./routes/schedules";
import { registerTaskRoutes } from "./routes/tasks";
import { registerAIRoutes } from "./routes/ai";
import { registerAdminRoutes } from "./routes/admin";
import { registerUserRoutes } from "./routes/users";
import { registerRoleRoutes } from "./routes/roles";
import { registerCommunicationRoutes } from "./routes/communication";
import { registerPayrollRoutes } from "./routes/payroll";
import { registerShopifyRoutes } from "./routes/shopify";
import { registerGeofenceRoutes } from "./routes/geofence";
import { registerPushRoutes } from "./routes/push";
import { registerChoreRoutes } from "./routes/chores";
import { registerAvailabilityRoutes } from "./routes/availability";
import { registerAnalyticsRoutes } from "./routes/analytics";
import { registerInsightRoutes } from "./routes/insights";
import { registerClockEventRoutes } from "./routes/clockEvents";
import { registerSopRoutes } from "./routes/sop";
import { registerSopLibraryRoutes } from "./routes/sops";
import { registerAiAssistantRoutes } from "./routes/aiAssistant";
import { registerAiSchedulingRoutes } from "./routes/aiScheduling";
import { registerDashboardRoutes } from "./routes/dashboard";
import { registerGtdRoutes } from "./routes/gtd";
import { registerMeetingRoutes } from "./routes/meetings";
import { registerWeeklyReviewRoutes, startWeeklyReviewCron, stopWeeklyReviewCron } from "./routes/weeklyReview";
import { registerIssueRoutes } from "./routes/issues";
import { registerRitualRoutes } from "./routes/rituals";
import { registerVideoRoutes } from "./routes/videos";
import { registerMessageRoutes } from "./routes/messaging";
import { registerRAGRoutes } from "./routes/ragSearch";
import { registerMorningWhisperRoutes } from "./routes/morningWhisper";
import { registerLeanBoardRoutes } from "./routes/leanBoard";
import { startLeanBoardCron, stopLeanBoardCron } from "./services/leanBoard";
import { registerSOPIntelligenceRoutes } from "./routes/sopIntelligence";
import { startSOPInsightsCron, stopSOPInsightsCron } from "./services/sopIntelligence";
import { registerSOPEvolutionRoutes } from "./routes/sopEvolution";
import { startSOPEvolutionCron, stopSOPEvolutionCron } from "./services/sopEvolution";
import { registerBackgroundInsightRoutes } from "./routes/backgroundInsights";
import { registerSmartSuggestionRoutes } from "./routes/smartSuggestions";
import { registerCashManagementRoutes } from "./routes/cashManagement";
import { registerTimesheetRoutes } from "./routes/timesheets";
import { registerOffsiteRulesRoutes } from "./routes/offsiteRules";
import { registerGamificationRoutes } from "./routes/gamification";
import { registerDayNoteRoutes } from "./routes/dayNotes";
import { registerOnboardingRoutes } from "./routes/onboarding";
import { registerKnowledgeRoutes } from "./routes/knowledge";
import { registerAiLearningRoutes } from "./routes/aiLearning";
import { registerTrainingPlayerRoutes } from "./routes/trainingPlayer";
import { registerMorningMomentRoutes } from "./routes/morningMoment";
import { startBackgroundInsightsCron, stopBackgroundInsightsCron } from "./services/backgroundInsights";
import { startGamificationCron, stopGamificationCron } from "./services/gamificationCron";
import { createActionLoggerMiddleware, handleClientErrorReport, getActionSummary } from "./services/actionLogger";
import { startSurfacingCron, stopSurfacingCron } from "./services/sopSurfacing";
import { startMiddayPulseCron, stopMiddayPulseCron } from "./services/middayPulse";
import { seedShiftHandoffSOP } from "./services/shiftHandoffSeed";
import logger from "./lib/logger";

const HEARTBEAT_INTERVAL_MS = 30_000;

interface TrackedConnection {
  ws: WebSocket;
  userId: string;
  alive: boolean;
}

const wsConnections = new Map<string, Set<TrackedConnection>>();

let heartbeatTimer: ReturnType<typeof setInterval> | null = null;

function startHeartbeat() {
  heartbeatTimer = setInterval(() => {
    wsConnections.forEach((conns, userId) => {
      for (const conn of Array.from(conns)) {
        if (!conn.alive) {
          logger.warn({ userId }, "ws: no pong received, closing connection");
          conn.ws.terminate();
          conns.delete(conn);
          continue;
        }

        conn.alive = false;
        if (conn.ws.readyState === WebSocket.OPEN) {
          conn.ws.ping();
        }
      }
      if (conns.size === 0) {
        wsConnections.delete(userId);
      }
    });
  }, HEARTBEAT_INTERVAL_MS);
}

function stopHeartbeat() {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
}

export async function registerRoutes(app: Express): Promise<Server> {
  await setupAuth(app);

  app.use(createActionLoggerMiddleware());

  app.post('/api/client-errors', (req, res) => handleClientErrorReport(req, res));

  app.get('/api/action-logs/summary', isAuthenticated, (_req, res) => {
    try {
      res.json(getActionSummary());
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Unknown error";
      res.status(500).json({ message });
    }
  });

  function broadcastToAll(data: Record<string, unknown>) {
    const payload = JSON.stringify(data);
    wsConnections.forEach((conns) => {
      for (const conn of Array.from(conns)) {
        if (conn.ws.readyState === WebSocket.OPEN) {
          conn.ws.send(payload);
        }
      }
    });
  }

  function sendToUsers(userIds: string[], data: Record<string, unknown>) {
    const payload = JSON.stringify(data);
    for (const uid of userIds) {
      const conns = wsConnections.get(uid);
      if (!conns) continue;
      for (const conn of Array.from(conns)) {
        if (conn.ws.readyState === WebSocket.OPEN) {
          conn.ws.send(payload);
        }
      }
    }
  }

  app.use("/uploads", express.static(path.join(process.cwd(), "uploads")));

  registerAuthRoutes(app, storage, isAuthenticated);
  registerTimeEntryRoutes(app, storage, isAuthenticated, broadcastToAll);
  registerScheduleRoutes(app, storage, isAuthenticated, broadcastToAll);
  registerTaskRoutes(app, storage, isAuthenticated, broadcastToAll);
  registerAIRoutes(app, storage, isAuthenticated);
  registerAdminRoutes(app, storage, isAuthenticated);
  registerUserRoutes(app, storage, isAuthenticated);
  registerRoleRoutes(app, storage, isAuthenticated);
  registerCommunicationRoutes(app, storage, isAuthenticated, broadcastToAll);
  registerPayrollRoutes(app, storage, isAuthenticated);
  registerShopifyRoutes(app, storage, isAuthenticated);
  registerGeofenceRoutes(app, storage, isAuthenticated);
  registerPushRoutes(app, storage, isAuthenticated);
  registerChoreRoutes(app, storage, isAuthenticated, broadcastToAll);
  registerAvailabilityRoutes(app, storage, isAuthenticated);
  registerAnalyticsRoutes(app, storage, isAuthenticated);
  registerInsightRoutes(app, storage, isAuthenticated);
  registerClockEventRoutes(app, storage, isAuthenticated);
  registerSopRoutes(app, storage, isAuthenticated);
  registerSopLibraryRoutes(app, storage, isAuthenticated, broadcastToAll);
  registerAiAssistantRoutes(app, storage, isAuthenticated);
  registerAiSchedulingRoutes(app, storage, isAuthenticated);
  registerDashboardRoutes(app, storage, isAuthenticated);
  registerIssueRoutes(app, storage, isAuthenticated, broadcastToAll);
  registerRitualRoutes(app, storage, isAuthenticated, broadcastToAll);
  registerVideoRoutes(app, storage, isAuthenticated, broadcastToAll);
  registerGtdRoutes(app, storage, isAuthenticated, broadcastToAll);
  registerMeetingRoutes(app, storage, isAuthenticated, broadcastToAll, sendToUsers);
  registerWeeklyReviewRoutes(app, storage, isAuthenticated);
  registerMessageRoutes(app, storage, isAuthenticated, sendToUsers);
  registerRAGRoutes(app, storage, isAuthenticated);
  registerMorningWhisperRoutes(app, storage, isAuthenticated);
  registerLeanBoardRoutes(app, storage, isAuthenticated);
  registerSOPIntelligenceRoutes(app, storage, isAuthenticated);
  registerSOPEvolutionRoutes(app, storage, isAuthenticated);
  registerBackgroundInsightRoutes(app, storage, isAuthenticated);
  registerSmartSuggestionRoutes(app, storage, isAuthenticated);
  registerCashManagementRoutes(app, storage, isAuthenticated);
  registerOffsiteRulesRoutes(app, storage, isAuthenticated);
  registerTimesheetRoutes(app, storage, isAuthenticated);
  registerGamificationRoutes(app, storage, isAuthenticated);
  registerDayNoteRoutes(app, storage, isAuthenticated);
  registerOnboardingRoutes(app, storage, isAuthenticated);
  registerKnowledgeRoutes(app, storage, isAuthenticated);
  registerAiLearningRoutes(app, storage, isAuthenticated);
  registerTrainingPlayerRoutes(app, storage, isAuthenticated);
  registerMorningMomentRoutes(app, storage, isAuthenticated);

  const httpServer = createServer(app);

  const wss = new WebSocketServer({ server: httpServer, path: '/ws' });

  wss.on('connection', async (ws: WebSocket, request) => {
    const url = new URL(request.url!, `http://${request.headers.host}`);
    const userId = url.searchParams.get('userId');

    if (!userId) {
      ws.close(4001, 'Missing userId');
      return;
    }

    try {
      const user = await storage.getUser(userId);
      if (!user) {
        ws.close(4003, 'User not found');
        return;
      }
    } catch {
      ws.close(4003, 'Auth verification failed');
      return;
    }

    const conn: TrackedConnection = { ws, userId, alive: true };
    if (!wsConnections.has(userId)) {
      wsConnections.set(userId, new Set());
    }
    wsConnections.get(userId)!.add(conn);
    logger.info({ userId, totalConnections: wsConnections.size }, "ws: client connected");

    ws.on('pong', () => {
      conn.alive = true;
    });

    ws.on('close', (code, reason) => {
      const conns = wsConnections.get(userId);
      if (conns) {
        conns.delete(conn);
        if (conns.size === 0) {
          wsConnections.delete(userId);
        }
      }
      logger.info({ userId, code, reason: reason.toString(), totalConnections: wsConnections.size }, "ws: client disconnected");
    });

    ws.on('error', (error) => {
      logger.error({ userId, error: error.message }, "ws: connection error");
    });
  });

  startHeartbeat();

  // Stagger cron job startup to avoid DB and AI API spikes during initial user requests.
  const staggered = [
    { fn: () => startSurfacingCron(broadcastToAll), label: 'SOP Surfacing', delay: 5_000 },
    { fn: () => startMiddayPulseCron(broadcastToAll), label: 'Midday Pulse', delay: 15_000 },
    { fn: () => startWeeklyReviewCron(), label: 'Weekly Review', delay: 25_000 },
    { fn: () => startLeanBoardCron(), label: 'Lean Board', delay: 35_000 },
    { fn: () => startSOPInsightsCron(), label: 'SOP Insights', delay: 45_000 },
    { fn: () => startSOPEvolutionCron(), label: 'SOP Evolution', delay: 55_000 },
    { fn: () => startBackgroundInsightsCron(), label: 'Background Insights', delay: 65_000 },
    { fn: () => startGamificationCron(), label: 'Gamification', delay: 75_000 },
    {
      fn: () => seedShiftHandoffSOP().catch(err => logger.error({ error: err.message }, 'Handoff SOP seed failed')),
      label: 'Shift Handoff Seed',
      delay: 10_000,
    },
  ];

  for (const { fn, label, delay } of staggered) {
    setTimeout(() => {
      try {
        fn();
        logger.info({ service: label }, 'background service started');
      } catch (err: any) {
        logger.error({ service: label, error: err.message }, 'background service failed to start');
      }
    }, delay);
  }

  function gracefulShutdown() {
    logger.info("ws: graceful shutdown initiated");
    stopHeartbeat();
    stopSurfacingCron();
    stopMiddayPulseCron();
    stopWeeklyReviewCron();
    stopLeanBoardCron();
    stopSOPInsightsCron();
    stopSOPEvolutionCron();
    stopBackgroundInsightsCron();
    stopGamificationCron();

    const shutdownPayload = JSON.stringify({ type: "server_restarting" });
    wsConnections.forEach((conns) => {
      for (const conn of Array.from(conns)) {
        if (conn.ws.readyState === WebSocket.OPEN) {
          try {
            conn.ws.send(shutdownPayload);
            conn.ws.close(1001, 'Server shutting down');
          } catch {
            conn.ws.terminate();
          }
        }
      }
    });
    wsConnections.clear();
    wss.close();
  }

  process.on('SIGTERM', () => {
    gracefulShutdown();
    setTimeout(() => process.exit(0), 2000);
  });

  process.on('SIGINT', () => {
    gracefulShutdown();
    setTimeout(() => process.exit(0), 2000);
  });

  return httpServer;
}
