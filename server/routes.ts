import type { Express } from "express";
import { createServer, type Server } from "http";
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
import { registerAiAssistantRoutes } from "./routes/aiAssistant";
import { registerAiSchedulingRoutes } from "./routes/aiScheduling";
import { registerDashboardRoutes } from "./routes/dashboard";
import { createActionLoggerMiddleware, handleClientErrorReport, getActionSummary } from "./services/actionLogger";
import { initSneebly } from 'sneebly';

const wsConnections = new Map<string, WebSocket>();

export async function registerRoutes(app: Express): Promise<Server> {
  await setupAuth(app);

  app.use(createActionLoggerMiddleware());

  app.post('/api/client-errors', (req, res) => handleClientErrorReport(req, res));

  app.get('/api/action-logs/summary', isAuthenticated, (_req, res) => {
    try {
      res.json(getActionSummary());
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  function broadcastToAll(data: any) {
    wsConnections.forEach((ws, userId) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(data));
      }
    });
  }

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
  registerAiAssistantRoutes(app, storage, isAuthenticated);
  registerAiSchedulingRoutes(app, storage, isAuthenticated);
  registerDashboardRoutes(app, storage, isAuthenticated);

  // Sneebly Dashboard
  initSneebly(app, {
    projectRoot: process.cwd(),
    dashboardPath: '/sneebly/dashboard'
  });

  app.use('/apppilot', (req, res) => {
    res.redirect(301, '/sneebly' + req.url);
  });

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

    wsConnections.set(userId, ws);
    console.log(`WebSocket connected for user: ${userId}`);

    ws.on('close', () => {
      wsConnections.delete(userId);
      console.log(`WebSocket disconnected for user: ${userId}`);
    });

    ws.on('error', (error) => {
      console.error('WebSocket error:', error);
    });
  });

  return httpServer;
}
