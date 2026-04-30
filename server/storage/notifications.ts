import {
  pushSubscriptions,
  nativePushTokens,
  pushCredentials,
  notificationDeliveryLogs,
  aiInsights,
  users,
  type PushSubscription,
  type InsertPushSubscription,
  type NativePushToken,
  type InsertNativePushToken,
  type NotificationDeliveryLog,
  type NotificationDeliveryLogWithUser,
  type InsertNotificationDeliveryLog,
  type AIInsight,
} from "@shared/schema";
import { db } from "../db";
import { eq, and, desc, sql } from "drizzle-orm";

export interface INotificationsStorage {
  createPushSubscription(subscription: InsertPushSubscription): Promise<PushSubscription>;
  getUserPushSubscriptions(userId: string): Promise<PushSubscription[]>;
  deletePushSubscription(id: string): Promise<void>;

  upsertNativePushToken(userId: string, token: string, platform: string): Promise<NativePushToken>;
  getUserNativePushTokens(userId: string): Promise<NativePushToken[]>;
  deleteNativePushToken(userId: string, token: string): Promise<void>;
  deleteStaleNativePushTokens(olderThanDays: number): Promise<number>;

  getPushCredential(key: string): Promise<string | null>;
  setPushCredential(key: string, value: string): Promise<void>;

  createNotificationDeliveryLog(log: InsertNotificationDeliveryLog): Promise<NotificationDeliveryLog>;
  getNotificationDeliveryLogs(options?: { channel?: string; userId?: string; notificationType?: string; since?: Date; limit?: number }): Promise<NotificationDeliveryLogWithUser[]>;
  getNotificationDeliveryStats(options?: { since?: Date }): Promise<{ userId: string; recipientName: string | null; total: number; failures: number }[]>;
  getDistinctNotificationTypes(): Promise<string[]>;
  deleteOldNotificationDeliveryLogs(olderThanDays: number): Promise<number>;

  createAIInsight(insight: Omit<AIInsight, 'id' | 'createdAt'>): Promise<AIInsight>;
  getUserInsights(userId?: string): Promise<AIInsight[]>;
  markInsightAsRead(id: string): Promise<void>;
}

export class NotificationsStorage implements INotificationsStorage {
  async createPushSubscription(subscription: InsertPushSubscription): Promise<PushSubscription> {
    const [created] = await db.insert(pushSubscriptions).values(subscription).returning();
    return created;
  }

  async getUserPushSubscriptions(userId: string): Promise<PushSubscription[]> {
    return await db
      .select()
      .from(pushSubscriptions)
      .where(eq(pushSubscriptions.userId, userId));
  }

  async deletePushSubscription(id: string): Promise<void> {
    await db.delete(pushSubscriptions).where(eq(pushSubscriptions.id, id));
  }

  async upsertNativePushToken(userId: string, token: string, platform: string): Promise<NativePushToken> {
    const [row] = await db
      .insert(nativePushTokens)
      .values({ userId, token, platform })
      .onConflictDoUpdate({
        target: nativePushTokens.token,
        set: { userId, platform, updatedAt: new Date() },
      })
      .returning();
    return row;
  }

  async getUserNativePushTokens(userId: string): Promise<NativePushToken[]> {
    return await db
      .select()
      .from(nativePushTokens)
      .where(eq(nativePushTokens.userId, userId));
  }

  async deleteNativePushToken(userId: string, token: string): Promise<void> {
    await db
      .delete(nativePushTokens)
      .where(
        and(
          eq(nativePushTokens.userId, userId),
          eq(nativePushTokens.token, token)
        )
      );
  }

  async deleteStaleNativePushTokens(olderThanDays: number): Promise<number> {
    const cutoff = new Date(Date.now() - olderThanDays * 24 * 60 * 60 * 1000);
    const deleted = await db
      .delete(nativePushTokens)
      .where(sql`${nativePushTokens.updatedAt} < ${cutoff}`)
      .returning({ id: nativePushTokens.id });
    return deleted.length;
  }

  async getPushCredential(key: string): Promise<string | null> {
    const [row] = await db
      .select()
      .from(pushCredentials)
      .where(eq(pushCredentials.key, key));
    return row?.value ?? null;
  }

  async setPushCredential(key: string, value: string): Promise<void> {
    await db
      .insert(pushCredentials)
      .values({ key, value })
      .onConflictDoUpdate({
        target: pushCredentials.key,
        set: { value, updatedAt: new Date() },
      });
  }

  async createNotificationDeliveryLog(log: InsertNotificationDeliveryLog): Promise<NotificationDeliveryLog> {
    const [created] = await db.insert(notificationDeliveryLogs).values(log).returning();
    return created;
  }

  async getNotificationDeliveryLogs(options?: { channel?: string; userId?: string; notificationType?: string; since?: Date; limit?: number }): Promise<NotificationDeliveryLogWithUser[]> {
    const conditions: any[] = [];
    if (options?.channel) {
      conditions.push(eq(notificationDeliveryLogs.channel, options.channel));
    }
    if (options?.userId) {
      conditions.push(eq(notificationDeliveryLogs.userId, options.userId));
    }
    if (options?.notificationType) {
      conditions.push(eq(notificationDeliveryLogs.notificationType, options.notificationType));
    }
    if (options?.since) {
      conditions.push(sql`${notificationDeliveryLogs.sentAt} >= ${options.since}`);
    }
    const rows = await db
      .select({
        id: notificationDeliveryLogs.id,
        userId: notificationDeliveryLogs.userId,
        notificationType: notificationDeliveryLogs.notificationType,
        channel: notificationDeliveryLogs.channel,
        status: notificationDeliveryLogs.status,
        errorMessage: notificationDeliveryLogs.errorMessage,
        sentAt: notificationDeliveryLogs.sentAt,
        firstName: users.firstName,
        lastName: users.lastName,
      })
      .from(notificationDeliveryLogs)
      .leftJoin(users, eq(notificationDeliveryLogs.userId, users.id))
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(sql`${notificationDeliveryLogs.sentAt} DESC`)
      .limit(options?.limit ?? 200);
    return rows.map((r) => ({
      id: r.id,
      userId: r.userId,
      notificationType: r.notificationType,
      channel: r.channel,
      status: r.status,
      errorMessage: r.errorMessage,
      sentAt: r.sentAt,
      recipientName: r.firstName && r.lastName ? `${r.firstName} ${r.lastName}` : r.firstName || r.lastName || null,
    }));
  }

  async getNotificationDeliveryStats(options?: { since?: Date }): Promise<{ userId: string; recipientName: string | null; total: number; failures: number }[]> {
    const conditions: any[] = [];
    if (options?.since) {
      conditions.push(sql`${notificationDeliveryLogs.sentAt} >= ${options.since}`);
    }
    const rows = await db
      .select({
        userId: notificationDeliveryLogs.userId,
        firstName: users.firstName,
        lastName: users.lastName,
        total: sql<number>`cast(count(*) as int)`,
        failures: sql<number>`cast(sum(case when ${notificationDeliveryLogs.status} = 'failure' then 1 else 0 end) as int)`,
      })
      .from(notificationDeliveryLogs)
      .leftJoin(users, eq(notificationDeliveryLogs.userId, users.id))
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .groupBy(notificationDeliveryLogs.userId, users.firstName, users.lastName)
      .orderBy(sql`sum(case when ${notificationDeliveryLogs.status} = 'failure' then 1 else 0 end) DESC`);
    return rows.map((r) => ({
      userId: r.userId,
      recipientName: r.firstName && r.lastName ? `${r.firstName} ${r.lastName}` : r.firstName || r.lastName || null,
      total: r.total,
      failures: r.failures,
    }));
  }

  async getDistinctNotificationTypes(): Promise<string[]> {
    const rows = await db
      .selectDistinct({ notificationType: notificationDeliveryLogs.notificationType })
      .from(notificationDeliveryLogs)
      .orderBy(notificationDeliveryLogs.notificationType);
    return rows.map((r) => r.notificationType).filter(Boolean) as string[];
  }

  async deleteOldNotificationDeliveryLogs(olderThanDays: number): Promise<number> {
    const cutoff = new Date(Date.now() - olderThanDays * 24 * 60 * 60 * 1000);
    const deleted = await db
      .delete(notificationDeliveryLogs)
      .where(sql`${notificationDeliveryLogs.sentAt} < ${cutoff}`)
      .returning({ id: notificationDeliveryLogs.id });
    return deleted.length;
  }

  async createAIInsight(insight: Omit<AIInsight, 'id' | 'createdAt'>): Promise<AIInsight> {
    const [created] = await db.insert(aiInsights).values(insight).returning();
    return created;
  }

  async getUserInsights(userId?: string): Promise<AIInsight[]> {
    const query = userId
      ? db.select().from(aiInsights).where(eq(aiInsights.userId, userId))
      : db.select().from(aiInsights);
    return await query.orderBy(desc(aiInsights.createdAt)).limit(100);
  }

  async markInsightAsRead(id: string): Promise<void> {
    await db.update(aiInsights).set({ isRead: true }).where(eq(aiInsights.id, id));
  }
}
