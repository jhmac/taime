import { sql } from "drizzle-orm";
import {
  pgTable,
  varchar,
  timestamp,
  boolean,
  text,
  integer,
  jsonb,
  index,
  unique,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { users } from "./identity";

// AI Insights
export const aiInsights = pgTable("ai_insights", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").references(() => users.id),
  type: varchar("type").notNull(),
  title: varchar("title").notNull(),
  description: text("description"),
  severity: varchar("severity").default("info"),
  isRead: boolean("is_read").default(false),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at").defaultNow(),
});

// Push subscriptions
export const pushSubscriptions = pgTable("push_subscriptions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").references(() => users.id).notNull(),
  endpoint: text("endpoint").notNull(),
  p256dh: text("p256dh").notNull(),
  auth: text("auth").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
});

// Native push tokens (APNs / FCM)
export const nativePushTokens = pgTable("native_push_tokens", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").references(() => users.id).notNull(),
  token: text("token").notNull(),
  platform: varchar("platform", { length: 10 }).notNull(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (t) => ({
  uniqueToken: unique("uq_native_push_tokens_token").on(t.token),
}));

// Push credential storage — admin-managed APNs/FCM credentials
export const pushCredentials = pgTable("push_credentials", {
  key: varchar("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Notification delivery log
export const notificationDeliveryLogs = pgTable("notification_delivery_logs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").references(() => users.id).notNull(),
  notificationType: varchar("notification_type", { length: 64 }).notNull(),
  channel: varchar("channel", { length: 16 }).notNull(),
  status: varchar("status", { length: 16 }).notNull(),
  errorMessage: text("error_message"),
  sentAt: timestamp("sent_at").defaultNow(),
}, (t) => [index("idx_notif_delivery_logs_sent_at").on(t.sentAt)]);

// Insert schemas
export const insertPushSubscriptionSchema = createInsertSchema(pushSubscriptions).omit({ id: true, createdAt: true });
export const insertNativePushTokenSchema = createInsertSchema(nativePushTokens).omit({ id: true, updatedAt: true });
export const insertNotificationDeliveryLogSchema = createInsertSchema(notificationDeliveryLogs).omit({ id: true, sentAt: true });

// Types
export type AIInsight = typeof aiInsights.$inferSelect;
export type PushSubscription = typeof pushSubscriptions.$inferSelect;
export type InsertPushSubscription = z.infer<typeof insertPushSubscriptionSchema>;
export type NativePushToken = typeof nativePushTokens.$inferSelect;
export type InsertNativePushToken = z.infer<typeof insertNativePushTokenSchema>;
export type PushCredential = typeof pushCredentials.$inferSelect;
export type NotificationDeliveryLog = typeof notificationDeliveryLogs.$inferSelect;
export type InsertNotificationDeliveryLog = z.infer<typeof insertNotificationDeliveryLogSchema>;
export type NotificationDeliveryLogWithUser = NotificationDeliveryLog & { recipientName: string | null };
