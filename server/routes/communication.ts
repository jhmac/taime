import type { Express } from "express";
import type { IStorage } from "../storage";
import { insertMessageSchema, insertShoutoutSchema } from "@shared/schema";
import { z } from "zod";

export function registerCommunicationRoutes(app: Express, storage: IStorage, isAuthenticated: any, broadcastToAll: (data: any) => void) {
  app.get('/api/shoutouts', isAuthenticated, async (req: any, res) => {
    try {
      const limit = parseInt(req.query.limit as string) || 50;
      const shoutoutsList = await storage.getShoutouts(limit);
      res.json(shoutoutsList);
    } catch (error) {
      console.error("Error fetching shoutouts:", error);
      res.status(500).json({ message: "Failed to fetch shoutouts" });
    }
  });

  app.post('/api/shoutouts', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const settings = await storage.getCompanySettings();
      if (settings && settings.allowShoutOuts === false) {
        return res.status(403).json({ message: "Shout-outs are disabled" });
      }
      
      const data = insertShoutoutSchema.parse({
        ...req.body,
        senderId: userId,
      });
      
      const shoutout = await storage.createShoutout(data);
      broadcastToAll({ type: 'shoutout_created', data: { shoutout } });
      res.json(shoutout);
    } catch (error) {
      console.error("Error creating shoutout:", error);
      res.status(400).json({ message: (error as Error).message });
    }
  });

  app.post('/api/shoutouts/:id/react', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const { id } = req.params;
      const emoji = req.body.emoji || '❤️';
      const shoutout = await storage.addShoutoutReaction(id, userId, emoji);
      broadcastToAll({ type: 'shoutout_reaction', data: { shoutoutId: id, userId, emoji } });
      res.json(shoutout);
    } catch (error) {
      console.error("Error reacting to shoutout:", error);
      res.status(400).json({ message: (error as Error).message });
    }
  });
}
