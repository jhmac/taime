import type { Express } from "express";
import type { IStorage } from "../storage";
import { insertShoutoutSchema } from "@shared/schema";
import { asyncHandler, AppError } from "../lib/routeWrapper";
import logger from "../lib/logger";

export function registerCommunicationRoutes(app: Express, storage: IStorage, isAuthenticated: any, broadcastToAll: (data: any) => void) {
  app.get('/api/shoutouts', isAuthenticated, asyncHandler(async (req: any, res) => {
    const limit = Math.min(Math.max(parseInt(req.query.limit as string) || 50, 1), 200);
    const shoutoutsList = await storage.getShoutouts(limit, req.user?.companyId);
    res.json(shoutoutsList);
  }));

  app.post('/api/shoutouts', isAuthenticated, asyncHandler(async (req: any, res) => {
    const userId = req.user.id;
    const settings = await storage.getCompanySettings(req.user?.companyId);
    if (settings && settings.allowShoutOuts === false) {
      throw new AppError(403, "Shout-outs are disabled", "SHOUTOUTS_DISABLED");
    }

    const data = insertShoutoutSchema.parse({
      ...req.body,
      senderId: userId,
      ...(req.user?.companyId ? { companyId: req.user.companyId } : {}),
    });

    const shoutout = await storage.createShoutout(data);
    broadcastToAll({ type: 'shoutout_created', data: { shoutout } });
    res.json(shoutout);
  }));

  app.post('/api/shoutouts/:id/react', isAuthenticated, asyncHandler(async (req: any, res) => {
    const userId = req.user.id;
    const companyId = req.user?.companyId;
    if (!companyId) throw new AppError(403, "Company context required", "NO_COMPANY");
    const { id } = req.params;
    const emoji = req.body.emoji || '❤️';

    const existing = await storage.getShoutouts(1000, companyId);
    const target = existing.find(s => s.id === id);
    if (!target) throw new AppError(404, "Shoutout not found", "NOT_FOUND");

    const shoutout = await storage.addShoutoutReaction(id, companyId, userId, emoji);
    broadcastToAll({ type: 'shoutout_reaction', data: { shoutoutId: id, userId, emoji } });
    res.json(shoutout);
  }));
}
