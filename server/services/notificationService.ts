import webpush from 'web-push';
import crypto from 'node:crypto';
import http2 from 'node:http2';
import https from 'node:https';
import { storage } from '../storage';
import { config } from '../lib/config';
import { getApnsCredentials, getFcmCredential, isApnsReady } from '../lib/pushCredentialStore';

if (config.vapid.publicKey && config.vapid.privateKey) {
  webpush.setVapidDetails(
    'mailto:admin@taime.app',
    config.vapid.publicKey,
    config.vapid.privateKey
  );
}

export interface NotificationPayload {
  title: string;
  body: string;
  icon?: string;
  badge?: string;
  data?: Record<string, any>;
  actions?: Array<{
    action: string;
    title: string;
    icon?: string;
  }>;
}

export interface SendResult {
  total: number;
  succeeded: number;
  failed: number;
  nativeTotal: number;
  nativeSucceeded: number;
  nativeFailed: number;
  iosSucceeded: number;
  iosFailed: number;
  androidSucceeded: number;
  androidFailed: number;
}

// ─── Utilities ───────────────────────────────────────────────────────────────

function base64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

// ─── APNs JWT helpers ────────────────────────────────────────────────────────

let _apnsJwt: { token: string; issuedAt: number } | null = null;

function getApnsJwt(): string {
  const now = Math.floor(Date.now() / 1000);
  if (_apnsJwt && now - _apnsJwt.issuedAt < 3000) {
    return _apnsJwt.token;
  }

  const apns = getApnsCredentials();
  const keyId = apns.keyId;
  const teamId = apns.teamId;
  const keyP8 = apns.keyP8.replace(/\\n/g, '\n');

  const header = base64url(Buffer.from(JSON.stringify({ alg: 'ES256', kid: keyId })));
  const payload = base64url(Buffer.from(JSON.stringify({ iss: teamId, iat: now })));
  const signingInput = `${header}.${payload}`;

  const sign = crypto.createSign('SHA256');
  sign.update(signingInput);
  const signature = base64url(sign.sign({ key: keyP8, dsaEncoding: 'ieee-p1363' }));

  const token = `${signingInput}.${signature}`;
  _apnsJwt = { token, issuedAt: now };
  return token;
}

async function sendApns(
  deviceToken: string,
  payload: NotificationPayload,
  bundleId: string = getApnsCredentials().bundleId || 'com.taime.app'
): Promise<void> {
  const jwt = getApnsJwt();
  const host = process.env.APNS_ENV === 'production'
    ? 'api.push.apple.com'
    : 'api.sandbox.push.apple.com';

  const body = JSON.stringify({
    aps: {
      alert: { title: payload.title, body: payload.body },
      badge: 1,
      sound: 'default',
    },
    data: payload.data || {},
  });

  return new Promise((resolve, reject) => {
    const client = http2.connect(`https://${host}`);
    client.on('error', reject);

    const req = client.request({
      ':method': 'POST',
      ':path': `/3/device/${deviceToken}`,
      ':scheme': 'https',
      ':authority': host,
      'authorization': `bearer ${jwt}`,
      'apns-topic': bundleId,
      'apns-push-type': 'alert',
      'content-type': 'application/json',
      'content-length': Buffer.byteLength(body).toString(),
    });

    let status = 0;
    let responseBody = '';

    req.on('response', (headers) => {
      status = headers[':status'] as number;
    });

    req.on('data', (chunk) => { responseBody += chunk; });

    req.on('end', () => {
      client.close();
      if (status === 200) {
        resolve();
      } else {
        reject(new Error(`APNs error ${status}: ${responseBody}`));
      }
    });

    req.on('error', (err) => { client.close(); reject(err); });

    req.write(body);
    req.end();
  });
}

// ─── FCM HTTP v1 API helpers ─────────────────────────────────────────────────

interface ServiceAccount {
  type: string;
  project_id: string;
  private_key_id: string;
  private_key: string;
  client_email: string;
  token_uri: string;
}

let _fcmAccessToken: { token: string; expiresAt: number } | null = null;

async function getFcmAccessToken(serviceAccount: ServiceAccount): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  if (_fcmAccessToken && now < _fcmAccessToken.expiresAt - 60) {
    return _fcmAccessToken.token;
  }

  const iat = now;
  const exp = iat + 3600;
  const scope = 'https://www.googleapis.com/auth/firebase.messaging';

  const header = base64url(Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })));
  const claimSet = base64url(Buffer.from(JSON.stringify({
    iss: serviceAccount.client_email,
    sub: serviceAccount.client_email,
    aud: serviceAccount.token_uri,
    iat,
    exp,
    scope,
  })));

  const signingInput = `${header}.${claimSet}`;
  const sign = crypto.createSign('SHA256');
  sign.update(signingInput);
  const sig = base64url(sign.sign(serviceAccount.private_key));
  const jwtToken = `${signingInput}.${sig}`;

  const tokenUri = serviceAccount.token_uri || 'https://oauth2.googleapis.com/token';
  const postBody = `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwtToken}`;

  const accessToken = await new Promise<string>((resolve, reject) => {
    const url = new URL(tokenUri);
    const options = {
      hostname: url.hostname,
      path: url.pathname + url.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(postBody),
      },
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        if (res.statusCode === 200) {
          const parsed = JSON.parse(data);
          resolve(parsed.access_token);
        } else {
          reject(new Error(`OAuth2 token error ${res.statusCode}: ${data}`));
        }
      });
    });

    req.on('error', reject);
    req.write(postBody);
    req.end();
  });

  _fcmAccessToken = { token: accessToken, expiresAt: exp };
  return accessToken;
}

async function sendFcmV1(
  deviceToken: string,
  payload: NotificationPayload,
  serviceAccount: ServiceAccount
): Promise<void> {
  const accessToken = await getFcmAccessToken(serviceAccount);
  const projectId = serviceAccount.project_id;

  const body = JSON.stringify({
    message: {
      token: deviceToken,
      notification: {
        title: payload.title,
        body: payload.body,
      },
      android: {
        priority: 'high',
        notification: { sound: 'default' },
        data: Object.fromEntries(
          Object.entries(payload.data || {}).map(([k, v]) => [k, String(v)])
        ),
      },
    },
  });

  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'fcm.googleapis.com',
      path: `/v1/projects/${projectId}/messages:send`,
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        if (res.statusCode === 200) {
          resolve();
        } else {
          reject(new Error(`FCM v1 error ${res.statusCode}: ${data}`));
        }
      });
    });

    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function parseFcmServiceAccount(): ServiceAccount | null {
  const raw = getFcmCredential();
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (parsed.project_id && parsed.private_key && parsed.client_email) {
      return parsed as ServiceAccount;
    }
  } catch {
    // Not a JSON service account key
  }
  return null;
}

let _legacyFcmWarningEmitted = false;

function getLegacyFcmServerKey(): string | null {
  const key = process.env.FCM_SERVER_KEY;
  if (!key) return null;
  try {
    JSON.parse(key);
    return null;
  } catch {
    return key;
  }
}

async function sendFcmLegacy(
  deviceToken: string,
  payload: NotificationPayload,
  serverKey: string
): Promise<void> {
  const body = JSON.stringify({
    to: deviceToken,
    priority: 'high',
    notification: {
      title: payload.title,
      body: payload.body,
      sound: 'default',
    },
    data: Object.fromEntries(
      Object.entries(payload.data || {}).map(([k, v]) => [k, String(v)])
    ),
  });

  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'fcm.googleapis.com',
      path: '/fcm/send',
      method: 'POST',
      headers: {
        'Authorization': `key=${serverKey}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        if (res.statusCode === 200) {
          try {
            const parsed = JSON.parse(data);
            if (parsed.failure === 0 || parsed.success > 0) {
              resolve();
            } else {
              reject(new Error(`FCM legacy send failed: ${data}`));
            }
          } catch {
            reject(new Error(`FCM legacy returned non-JSON response: ${data}`));
          }
        } else {
          reject(new Error(`FCM legacy error ${res.statusCode}: ${data}`));
        }
      });
    });

    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// ─── Notification Service ────────────────────────────────────────────────────

export class NotificationService {
  /**
   * Send push notification to a specific user, returning delivery telemetry
   */
  async sendToUserWithResult(userId: string, payload: NotificationPayload): Promise<SendResult> {
    const [subscriptions, nativeTokens] = await Promise.all([
      storage.getUserPushSubscriptions(userId),
      storage.getUserNativePushTokens(userId),
    ]);

    const notificationPayload = JSON.stringify({
      title: payload.title,
      body: payload.body,
      icon: payload.icon || '/icon-192x192.png',
      badge: payload.badge || '/badge-72x72.png',
      data: payload.data || {},
      actions: payload.actions || [],
    });

    // ── Web Push ──
    let succeeded = 0;
    let failed = 0;

    if (subscriptions.length > 0) {
      const webResults = await Promise.allSettled(
        subscriptions.map(async (subscription) => {
          await webpush.sendNotification(
            {
              endpoint: subscription.endpoint,
              keys: {
                p256dh: subscription.p256dh,
                auth: subscription.auth,
              },
            },
            notificationPayload
          );
        })
      );

      for (let i = 0; i < webResults.length; i++) {
        const result = webResults[i];
        if (result.status === 'fulfilled') {
          succeeded++;
        } else {
          failed++;
          const error = result.reason;
          console.error(`Failed to send notification to subscription ${subscriptions[i].id}:`, error);
          if (error?.statusCode === 410) {
            await storage.deletePushSubscription(subscriptions[i].id);
          }
        }
      }
    }

    // ── Native Push ──
    let nativeSucceeded = 0;
    let nativeFailed = 0;
    let iosSucceeded = 0;
    let iosFailed = 0;
    let androidSucceeded = 0;
    let androidFailed = 0;

    if (nativeTokens.length > 0) {
      const fcmServiceAccount = parseFcmServiceAccount();

      const legacyFcmServerKey = getLegacyFcmServerKey();

      const nativeResults = await Promise.allSettled(
        nativeTokens.map(async (entry) => {
          if (entry.platform === 'ios') {
            if (!isApnsReady()) {
              throw new Error('APNs credentials not configured');
            }
            await sendApns(entry.token, payload);
          } else if (entry.platform === 'android') {
            if (fcmServiceAccount) {
              await sendFcmV1(entry.token, payload, fcmServiceAccount);
            } else if (legacyFcmServerKey) {
              if (!_legacyFcmWarningEmitted) {
                _legacyFcmWarningEmitted = true;
                console.warn('FCM: using legacy server key (Authorization: key=). Migrate to FCM_SERVICE_ACCOUNT_JSON for the HTTP v1 API.');
              }
              await sendFcmLegacy(entry.token, payload, legacyFcmServerKey);
            } else {
              throw new Error('FCM credentials not configured. Set FCM_SERVICE_ACCOUNT_JSON (recommended) or FCM_SERVER_KEY.');
            }
          } else {
            throw new Error(`Unknown platform: ${entry.platform}`);
          }
        })
      );

      for (let i = 0; i < nativeResults.length; i++) {
        const result = nativeResults[i];
        const platform = nativeTokens[i].platform;
        if (result.status === 'fulfilled') {
          nativeSucceeded++;
          if (platform === 'ios') iosSucceeded++;
          else if (platform === 'android') androidSucceeded++;
        } else {
          nativeFailed++;
          if (platform === 'ios') iosFailed++;
          else if (platform === 'android') androidFailed++;
          console.error(
            `Failed to send native notification for user ${userId} (${platform}):`,
            result.reason
          );
          const errMsg = (result.reason as Error)?.message || '';
          if (
            errMsg.includes('BadDeviceToken') ||
            errMsg.includes('Unregistered') ||
            errMsg.includes('InvalidRegistration') ||
            errMsg.includes('NotRegistered')
          ) {
            await storage.deleteNativePushToken(userId, nativeTokens[i].token);
          }
        }
      }
    }

    if (subscriptions.length === 0 && nativeTokens.length === 0) {
      console.log(`No push subscriptions found for user ${userId}`);
    }

    return {
      total: subscriptions.length,
      succeeded,
      failed,
      nativeTotal: nativeTokens.length,
      nativeSucceeded,
      nativeFailed,
      iosSucceeded,
      iosFailed,
      androidSucceeded,
      androidFailed,
    };
  }

  /**
   * Send push notification to a specific user
   */
  async sendToUser(userId: string, payload: NotificationPayload): Promise<void> {
    try {
      await this.sendToUserWithResult(userId, payload);
    } catch (error) {
      console.error('Failed to send notifications:', error);
      throw error;
    }
  }

  async sendClockInReminder(userId: string, locationName: string): Promise<void> {
    await this.sendToUser(userId, {
      title: '🕐 Clock In Reminder',
      body: `You've arrived at ${locationName}. Don't forget to clock in!`,
      data: { type: 'clock_in_reminder', locationName },
      actions: [
        { action: 'clock_in', title: 'Clock In Now' },
        { action: 'dismiss', title: 'Dismiss' },
      ],
    });
  }

  async sendClockOutReminder(userId: string, locationName: string): Promise<void> {
    await this.sendToUser(userId, {
      title: '🕐 Clock Out Reminder',
      body: `You've left ${locationName}. Don't forget to clock out!`,
      data: { type: 'clock_out_reminder', locationName },
      actions: [
        { action: 'clock_out', title: 'Clock Out Now' },
        { action: 'dismiss', title: 'Dismiss' },
      ],
    });
  }

  async sendTaskAssignment(userId: string, taskTitle: string, dueTime: string): Promise<void> {
    await this.sendToUser(userId, {
      title: '📋 New Task Assigned',
      body: `You have a new task: ${taskTitle}. Due: ${dueTime}`,
      data: { type: 'task_assignment', taskTitle, dueTime },
      actions: [
        { action: 'view_task', title: 'View Task' },
        { action: 'dismiss', title: 'Dismiss' },
      ],
    });
  }

  async sendTaskReminder(userId: string, taskTitle: string, minutesUntilDue: number): Promise<void> {
    await this.sendToUser(userId, {
      title: '⏰ Task Reminder',
      body: `Task "${taskTitle}" is due in ${minutesUntilDue} minutes!`,
      data: { type: 'task_reminder', taskTitle, minutesUntilDue },
      actions: [
        { action: 'mark_complete', title: 'Mark Complete' },
        { action: 'view_task', title: 'View Task' },
      ],
    });
  }

  async sendOvertimeWarning(userId: string, currentHours: number, overtimeThreshold: number): Promise<void> {
    const hoursUntilOvertime = overtimeThreshold - currentHours;
    await this.sendToUser(userId, {
      title: '⚠️ Overtime Warning',
      body: `You'll reach overtime in ${hoursUntilOvertime.toFixed(1)} hours. Consider taking a break or clocking out early.`,
      data: { type: 'overtime_warning', currentHours, overtimeThreshold },
      actions: [
        { action: 'clock_out', title: 'Clock Out Now' },
        { action: 'dismiss', title: 'Acknowledge' },
      ],
    });
  }

  async sendScheduleUpdate(userId: string, changeDescription: string): Promise<void> {
    await this.sendToUser(userId, {
      title: '📅 Schedule Updated',
      body: changeDescription,
      data: { type: 'schedule_update', changeDescription },
      actions: [
        { action: 'view_schedule', title: 'View Schedule' },
        { action: 'dismiss', title: 'Dismiss' },
      ],
    });
  }

  async sendPayrollReady(userId: string, periodDescription: string): Promise<void> {
    await this.sendToUser(userId, {
      title: '💰 Payroll Ready for Review',
      body: `Your timesheet for ${periodDescription} is ready for approval.`,
      data: { type: 'payroll_ready', periodDescription },
      actions: [
        { action: 'review_payroll', title: 'Review Now' },
        { action: 'dismiss', title: 'Later' },
      ],
    });
  }

  async sendTeamAnnouncement(userIds: string[], title: string, message: string): Promise<void> {
    const payload: NotificationPayload = {
      title,
      body: message,
      data: { type: 'team_announcement' },
      actions: [
        { action: 'view_announcement', title: 'View Details' },
        { action: 'dismiss', title: 'Dismiss' },
      ],
    };
    const promises = userIds.map(userId => this.sendToUser(userId, payload));
    await Promise.allSettled(promises);
  }

  async sendAnomalyAlert(userId: string, headline: string, detail: string, severity: string, insightType: string): Promise<void> {
    const emoji = severity === 'action_needed' ? '🚨' : '⚠️';
    const typeLabel = insightType === 'clock_in_anomaly' ? 'Clock-In Anomaly' : 'Payroll Alert';
    await this.sendToUser(userId, {
      title: `${emoji} ${typeLabel}`,
      body: headline,
      data: { type: 'anomaly_alert', insightType, severity, url: '/dashboard' },
      actions: [
        { action: 'view_details', title: 'View Details' },
        { action: 'dismiss', title: 'Dismiss' },
      ],
    });
  }

  async sendAIInsight(userId: string, insightTitle: string, insightDescription: string, severity: string): Promise<void> {
    const emoji = severity === 'high' ? '🚨' : severity === 'medium' ? '⚠️' : 'ℹ️';
    await this.sendToUser(userId, {
      title: `${emoji} AI Insight`,
      body: `${insightTitle}: ${insightDescription}`,
      data: { type: 'ai_insight', insightTitle, insightDescription, severity },
      actions: [
        { action: 'view_insight', title: 'View Details' },
        { action: 'dismiss', title: 'Dismiss' },
      ],
    });
  }
}

export const notificationService = new NotificationService();
