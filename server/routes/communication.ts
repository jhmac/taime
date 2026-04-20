import type { Express } from "express";
import type { IStorage } from "../storage";
import { insertShoutoutSchema } from "@shared/schema";
import { asyncHandler, AppError } from "../lib/routeWrapper";
import logger from "../lib/logger";
import { tryResolveStoreIdForUser } from "../lib/storeResolver";
import { getAllStoreUserIds } from "../lib/permissionUtils";
import { computeShoutoutRecipients } from "../lib/broadcastRecipients";

export function registerCommunicationRoutes(
  app: Express,
  storage: IStorage,
  isAuthenticated: any,
  sendToUsers: (userIds: string[], data: Record<string, unknown>) => void,
) {
  app.get('/api/shoutouts', isAuthenticated, asyncHandler(async (req: any, res) => {
    const limit = Math.min(Math.max(parseInt(req.query.limit as string) || 50, 1), 200);
    const shoutoutsList = await storage.getShoutouts(limit);
    res.json(shoutoutsList);
  }));

  app.post('/api/shoutouts', isAuthenticated, asyncHandler(async (req: any, res) => {
    const userId = req.user.id;
    const settings = await storage.getCompanySettings();
    if (settings && settings.allowShoutOuts === false) {
      throw new AppError(403, "Shout-outs are disabled", "SHOUTOUTS_DISABLED");
    }

    const data = insertShoutoutSchema.parse({
      ...req.body,
      senderId: userId,
    });

    const shoutout = await storage.createShoutout(data);
    const shoutoutStoreId = (await tryResolveStoreIdForUser(userId)) || 'default';
    const shoutoutCreatedRecipients = await computeShoutoutRecipients(shoutoutStoreId, getAllStoreUserIds);
    sendToUsers(shoutoutCreatedRecipients, { type: 'shoutout_created', data: { shoutout } });
    res.json(shoutout);
  }));

  app.post('/api/shoutouts/:id/react', isAuthenticated, asyncHandler(async (req: any, res) => {
    const userId = req.user.id;
    const { id } = req.params;
    const emoji = req.body.emoji || '❤️';
    const shoutout = await storage.addShoutoutReaction(id, userId, emoji);
    const reactionStoreId = (await tryResolveStoreIdForUser(userId)) || 'default';
    const shoutoutReactionRecipients = await computeShoutoutRecipients(reactionStoreId, getAllStoreUserIds);
    sendToUsers(shoutoutReactionRecipients, { type: 'shoutout_reaction', data: { shoutoutId: id, userId, emoji } });
    res.json(shoutout);
  }));
}
