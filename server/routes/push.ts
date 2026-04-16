import type { Express } from "express";
import type { IStorage } from "../storage";
import { insertPushSubscriptionSchema } from "@shared/schema";
import { notificationService } from "../services/notificationService";
import { config } from "../lib/config";

const APNS_READY = !!(
  process.env.APNS_KEY_ID &&
  process.env.APNS_TEAM_ID &&
  process.env.APNS_KEY_P8
);

function isFcmConfigured(): boolean {
  const saJson = process.env.FCM_SERVICE_ACCOUNT_JSON || process.env.FCM_SERVER_KEY;
  if (!saJson) return false;
  try {
    const parsed = JSON.parse(saJson);
    if (parsed.project_id && parsed.private_key && parsed.client_email) {
      return true;
    }
  } catch {
    // Not JSON — check if FCM_SERVER_KEY is a plain legacy server key string
  }
  if (process.env.FCM_SERVER_KEY) {
    try {
      JSON.parse(process.env.FCM_SERVER_KEY);
    } catch {
      return true;
    }
  }
  return false;
}

const FCM_READY = isFcmConfigured();

function platformReady(platform: string): boolean {
  if (platform === 'ios') return APNS_READY;
  if (platform === 'android') return FCM_READY;
  return false;
}

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
      if (platform !== 'ios' && platform !== 'android') {
        return res.status(400).json({ message: 'platform must be "ios" or "android"' });
      }
      await storage.upsertNativePushToken(userId, token, platform);
      res.json({
        success: true,
        deliveryReady: platformReady(platform),
        apnsReady: APNS_READY,
        fcmReady: FCM_READY,
      });
    } catch (error) {
      console.error('Error saving native push token:', error);
      res.status(500).json({ message: 'Failed to save native push token' });
    }
  });

  app.post('/api/push/test', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const nativeTokens = await storage.getUserNativePushTokens(userId);

      const result = await notificationService.sendToUserWithResult(userId, {
        title: '🔔 Test Notification',
        body: 'This is a test push notification from Taime. If you see this, notifications are working!',
        data: { type: 'test' },
      });

      const totalSucceeded = result.succeeded + result.nativeSucceeded;
      const totalAttempted = result.total + result.nativeTotal;

      const nativeStatus = nativeTokens.length > 0
        ? nativeTokens.every(t => platformReady(t.platform))
          ? 'native_token_dispatched'
          : 'native_token_registered_delivery_pending'
        : 'no_native_token';

      if (totalAttempted === 0) {
        return res.status(400).json({
          success: false,
          message: 'No push subscriptions found. Please enable notifications first.',
          nativeStatus,
        });
      }

      if (totalSucceeded === 0) {
        return res.status(502).json({
          success: false,
          message: `Delivery failed for all ${totalAttempted} subscription(s). Check credentials and token validity.`,
          telemetry: result,
          nativeStatus,
        });
      }

      res.json({
        success: true,
        message: (result.failed > 0 || result.nativeFailed > 0)
          ? `Test notification sent to ${result.succeeded}/${result.total} web and ${result.nativeSucceeded}/${result.nativeTotal} native subscription(s).`
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
