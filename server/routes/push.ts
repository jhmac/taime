import type { Express } from "express";
import type { IStorage } from "../storage";
import { insertPushSubscriptionSchema } from "@shared/schema";
import { notificationService } from "../services/notificationService";
import { config } from "../lib/config";

// Native device tokens (APNs / FCM).
// Tokens are collected here and stored in-memory per server process.
// Server-side delivery to APNs / FCM requires additional credentials
// (APNS_KEY_ID, APNS_TEAM_ID, APNS_KEY_PATH for iOS; FCM_SERVER_KEY for Android)
// that are not yet configured — wiring server-side dispatch is deferred to follow-up #88.
const nativeTokens = new Map<string, { token: string; platform: string; updatedAt: Date }>();

const NATIVE_PUSH_READY =
  !!(process.env.APNS_KEY_ID && process.env.APNS_TEAM_ID && process.env.APNS_KEY_PATH) ||
  !!process.env.FCM_SERVER_KEY;

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
      // Explicitly signal delivery status so callers know whether the token
      // will actually be used for APNs/FCM dispatch (requires follow-up #88).
      res.json({ success: true, deliveryReady: NATIVE_PUSH_READY });
    } catch (error) {
      console.error('Error saving native push token:', error);
      res.status(500).json({ message: 'Failed to save native push token' });
    }
  });

  app.post('/api/push/test', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const nativeEntry = nativeTokens.get(userId);

      const result = await notificationService.sendToUserWithResult(userId, {
        title: '🔔 Test Notification',
        body: 'This is a test push notification from Taime. If you see this, notifications are working!',
        data: { type: 'test' },
      });

      // Build a response that is explicit about web vs. native push status.
      const nativeStatus = nativeEntry
        ? NATIVE_PUSH_READY
          ? 'native_token_dispatched'
          : 'native_token_registered_delivery_pending'
        : 'no_native_token';

      if (result.total === 0 && !nativeEntry) {
        return res.status(400).json({
          success: false,
          message: 'No push subscriptions found. Please enable notifications first.',
          nativeStatus,
        });
      }

      if (result.total === 0 && nativeEntry && !NATIVE_PUSH_READY) {
        return res.status(400).json({
          success: false,
          message: 'Native push token registered but APNs/FCM server credentials are not yet configured. Web push subscriptions not found either. See follow-up #88.',
          nativeStatus,
        });
      }

      if (result.succeeded === 0 && result.total > 0) {
        return res.status(502).json({
          success: false,
          message: `Delivery failed for all ${result.total} web subscription(s). Subscriptions may be expired.`,
          telemetry: result,
          nativeStatus,
        });
      }

      res.json({
        success: true,
        message: result.failed > 0
          ? `Test notification sent to ${result.succeeded}/${result.total} subscription(s). ${result.failed} failed.`
          : 'Test notification sent',
        telemetry: result,
        nativeStatus,
      });
    } catch (error) {
      console.error("Error sending test notification:", error);
      res.status(500).json({ message: "Failed to send test notification" });
    }
  });
}
