import type { Express } from "express";
import type { IStorage } from "../storage";
import { insertPushSubscriptionSchema } from "@shared/schema";
import { notificationService } from "../services/notificationService";
import { config } from "../lib/config";

const nativeTokens = new Map<string, { token: string; platform: string; updatedAt: Date }>();

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

  app.post('/api/push/native-token', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const { token, platform } = req.body;
      if (!token || !platform) {
        return res.status(400).json({ message: 'token and platform are required' });
      }
      nativeTokens.set(userId, { token, platform, updatedAt: new Date() });
      res.json({ success: true });
    } catch (error) {
      console.error('Error saving native push token:', error);
      res.status(500).json({ message: 'Failed to save native push token' });
    }
  });

  app.post('/api/push/test', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const result = await notificationService.sendToUserWithResult(userId, {
        title: '🔔 Test Notification',
        body: 'This is a test push notification from Taime. If you see this, notifications are working!',
        data: { type: 'test' },
      });

      if (result.total === 0) {
        return res.status(400).json({ success: false, message: 'No push subscriptions found. Please enable notifications first.' });
      }

      if (result.succeeded === 0) {
        return res.status(502).json({
          success: false,
          message: `Delivery failed for all ${result.total} subscription(s). Subscriptions may be expired.`,
          telemetry: result,
        });
      }

      res.json({
        success: true,
        message: result.failed > 0
          ? `Test notification sent to ${result.succeeded}/${result.total} subscription(s). ${result.failed} failed.`
          : 'Test notification sent',
        telemetry: result,
      });
    } catch (error) {
      console.error("Error sending test notification:", error);
      res.status(500).json({ message: "Failed to send test notification" });
    }
  });
}
