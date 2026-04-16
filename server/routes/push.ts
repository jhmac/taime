import type { Express } from "express";
import type { IStorage } from "../storage";
import { insertPushSubscriptionSchema } from "@shared/schema";
import { notificationService } from "../services/notificationService";
import { config } from "../lib/config";
import {
  isApnsReady,
  isFcmReady,
  saveApnsCredentials,
  saveFcmCredentials,
} from "../lib/pushCredentialStore";
import { z } from "zod";

function platformReady(platform: string): boolean {
  if (platform === 'ios') return isApnsReady();
  if (platform === 'android') return isFcmReady();
  return false;
}

async function requireAdmin(storage: IStorage, userId: string): Promise<void> {
  const perms = await storage.getUserPermissions(userId);
  if (!perms.some((p: any) => p.name === 'admin.manage_all')) {
    throw Object.assign(new Error("Admin access required"), { status: 403 });
  }
}

const apnsCredentialsSchema = z.object({
  keyId: z.string().min(1, "Key ID is required"),
  teamId: z.string().min(1, "Team ID is required"),
  keyP8: z.string().min(1, "Key P8 content is required"),
  bundleId: z.string().default(""),
});

const fcmCredentialsSchema = z.object({
  serviceAccountJson: z.string().min(1, "Service account JSON is required"),
});


export function registerPushRoutes(app: Express, storage: IStorage, isAuthenticated: any) {
  app.get('/api/push/credentials-status', isAuthenticated, (_req, res) => {
    const vapidReady = !!(config.vapid.publicKey && config.vapid.privateKey);
    res.json({
      vapidReady,
      apnsReady: isApnsReady(),
      fcmReady: isFcmReady(),
    });
  });

  app.patch('/api/push/credentials/apns', isAuthenticated, async (req: any, res) => {
    try {
      await requireAdmin(storage, req.user.id);
      const data = apnsCredentialsSchema.parse(req.body);
      await saveApnsCredentials(storage, data.keyId, data.teamId, data.keyP8, data.bundleId);
      res.json({ success: true });
    } catch (err: any) {
      if (err.status === 403) return res.status(403).json({ message: err.message });
      if (err.name === 'ZodError') return res.status(400).json({ message: err.errors[0].message });
      console.error("Error saving APNs credentials:", err);
      res.status(500).json({ message: "Failed to save APNs credentials" });
    }
  });

  app.patch('/api/push/credentials/fcm', isAuthenticated, async (req: any, res) => {
    try {
      await requireAdmin(storage, req.user.id);
      const data = fcmCredentialsSchema.parse(req.body);
      try {
        const parsed = JSON.parse(data.serviceAccountJson);
        if (!parsed.project_id || !parsed.private_key || !parsed.client_email) {
          return res.status(400).json({ message: "Invalid service account JSON: missing project_id, private_key, or client_email" });
        }
      } catch {
        return res.status(400).json({ message: "Invalid JSON format" });
      }
      await saveFcmCredentials(storage, data.serviceAccountJson);
      res.json({ success: true });
    } catch (err: any) {
      if (err.status === 403) return res.status(403).json({ message: err.message });
      if (err.name === 'ZodError') return res.status(400).json({ message: err.errors[0].message });
      console.error("Error saving FCM credentials:", err);
      res.status(500).json({ message: "Failed to save FCM credentials" });
    }
  });

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
        apnsReady: isApnsReady(),
        fcmReady: isFcmReady(),
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

      const iosTokens = nativeTokens.filter(t => t.platform === 'ios');
      const androidTokens = nativeTokens.filter(t => t.platform === 'android');

      const result = await notificationService.sendToUserWithResult(userId, {
        title: '🔔 Test Notification',
        body: 'This is a test push notification from Taime. If you see this, notifications are working!',
        data: { type: 'test' },
        notificationType: 'test',
      });

      const totalSucceeded = result.succeeded + result.nativeSucceeded;
      const totalAttempted = result.total + result.nativeTotal;

      const nativeStatus = nativeTokens.length > 0
        ? nativeTokens.every(t => platformReady(t.platform))
          ? 'native_token_dispatched'
          : 'native_token_registered_delivery_pending'
        : 'no_native_token';

      const channels = {
        web: {
          attempted: result.total,
          succeeded: result.succeeded,
          failed: result.failed,
          credentialsReady: !!(config.vapid.publicKey && config.vapid.privateKey),
        },
        ios: {
          tokensRegistered: iosTokens.length,
          credentialsReady: isApnsReady(),
          succeeded: result.iosSucceeded,
          failed: result.iosFailed,
        },
        android: {
          tokensRegistered: androidTokens.length,
          credentialsReady: isFcmReady(),
          succeeded: result.androidSucceeded,
          failed: result.androidFailed,
        },
      };

      if (totalAttempted === 0) {
        return res.status(400).json({
          success: false,
          message: 'No push subscriptions found. Please enable notifications first.',
          nativeStatus,
          channels,
        });
      }

      if (totalSucceeded === 0) {
        return res.status(502).json({
          success: false,
          message: `Delivery failed for all ${totalAttempted} subscription(s). Check credentials and token validity.`,
          telemetry: result,
          nativeStatus,
          channels,
        });
      }

      res.json({
        success: true,
        message: (result.failed > 0 || result.nativeFailed > 0)
          ? `Test notification sent to ${result.succeeded}/${result.total} web and ${result.nativeSucceeded}/${result.nativeTotal} native subscription(s).`
          : 'Test notification sent',
        telemetry: result,
        nativeStatus,
        channels,
      });
    } catch (error) {
      console.error("Error sending test notification:", error);
      res.status(500).json({ message: "Failed to send test notification" });
    }
  });

  app.get('/api/push/delivery-logs', isAuthenticated, async (req: any, res) => {
    try {
      await requireAdmin(storage, req.user.id);

      const { channel, since, limit, userId, notificationType } = req.query;

      const sinceDate = since ? new Date(since as string) : undefined;
      const limitNum = limit ? Math.min(parseInt(limit as string, 10) || 100, 500) : 100;

      if (sinceDate && isNaN(sinceDate.getTime())) {
        return res.status(400).json({ message: 'Invalid since date' });
      }

      const logs = await storage.getNotificationDeliveryLogs({
        channel: channel as string | undefined,
        userId: userId as string | undefined,
        notificationType: notificationType as string | undefined,
        since: sinceDate,
        limit: limitNum,
      });

      res.json(logs);
    } catch (error: any) {
      if (error?.status === 403) {
        return res.status(403).json({ message: error.message || 'Admin access required' });
      }
      console.error('Error fetching delivery logs:', error);
      res.status(500).json({ message: 'Failed to fetch delivery logs' });
    }
  });
}
