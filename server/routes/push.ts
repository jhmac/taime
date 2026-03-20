import type { Express } from "express";
import type { IStorage } from "../storage";
import { insertPushSubscriptionSchema } from "@shared/schema";
import { notificationService } from "../services/notificationService";
import { config } from "../lib/config";

export function registerPushRoutes(app: Express, storage: IStorage, isAuthenticated: any) {
  app.get('/api/push/vapid-key', (_req, res) => {
    const publicKey = config.vapid.publicKey;
    if (!publicKey) {
      return res.status(500).json({ message: "VAPID public key not configured" });
    }
    res.json({ publicKey });
  });

  app.post('/api/push/subscribe', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const data = insertPushSubscriptionSchema.parse({ ...req.body, userId });
      
      const subscription = await storage.createPushSubscription(data);
      res.json(subscription);
    } catch (error) {
      console.error("Error creating push subscription:", error);
      res.status(400).json({ message: (error as Error).message });
    }
  });

  app.post('/api/push/test', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.id;
      await notificationService.sendToUser(userId, {
        title: '🔔 Test Notification',
        body: 'This is a test push notification from Taime. If you see this, notifications are working!',
        data: { type: 'test' },
      });
      res.json({ success: true, message: 'Test notification sent' });
    } catch (error) {
      console.error("Error sending test notification:", error);
      res.status(500).json({ message: "Failed to send test notification" });
    }
  });
}
