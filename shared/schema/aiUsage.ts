import { sql } from "drizzle-orm";
import {
  pgTable,
  varchar,
  text,
  integer,
  boolean,
  decimal,
  timestamp,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// Every LLM / transcription / embedding / image call is logged here.
export const aiUsageEvents = pgTable("ai_usage_events", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  provider: varchar("provider", { length: 32 }).notNull(),
  model: varchar("model", { length: 96 }).notNull(),
  operation: varchar("operation", { length: 32 }).notNull(),
  feature: varchar("feature", { length: 64 }).notNull(),
  storeId: varchar("store_id"),
  userId: varchar("user_id"),
  isBackground: boolean("is_background").default(false).notNull(),
  inputTokens: integer("input_tokens").default(0).notNull(),
  outputTokens: integer("output_tokens").default(0).notNull(),
  audioSeconds: decimal("audio_seconds", { precision: 10, scale: 3 }),
  costUsd: decimal("cost_usd", { precision: 12, scale: 6 }).notNull(),
  latencyMs: integer("latency_ms"),
  status: varchar("status", { length: 16 }).notNull(),
  errorMessage: text("error_message"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => [
  index("idx_ai_usage_events_created").on(t.createdAt),
  index("idx_ai_usage_events_store_created").on(t.storeId, t.createdAt),
  index("idx_ai_usage_events_feature_created").on(t.feature, t.createdAt),
  index("idx_ai_usage_events_model_created").on(t.model, t.createdAt),
]);

// Monthly budgets. Scope = 'global' (single row, storeId null) or 'store' (per-store).
export const aiBudgets = pgTable("ai_budgets", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  scope: varchar("scope", { length: 16 }).notNull(),
  storeId: varchar("store_id"),
  monthlyLimitUsd: decimal("monthly_limit_usd", { precision: 12, scale: 2 }).notNull(),
  alertThresholdPercent: integer("alert_threshold_percent").default(80).notNull(),
  hardBlock: boolean("hard_block").default(true).notNull(),
  enabled: boolean("enabled").default(true).notNull(),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (t) => [
  uniqueIndex("uq_ai_budgets_scope_store").on(t.scope, t.storeId),
]);

// Dedup table: which budget x period x threshold has already alerted.
export const aiBudgetAlerts = pgTable("ai_budget_alerts", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  budgetId: varchar("budget_id").notNull(),
  periodKey: varchar("period_key", { length: 7 }).notNull(),
  thresholdPercent: integer("threshold_percent").notNull(),
  spendAtAlert: decimal("spend_at_alert", { precision: 12, scale: 4 }).notNull(),
  sentAt: timestamp("sent_at").defaultNow(),
}, (t) => [
  uniqueIndex("uq_ai_budget_alerts_budget_period_threshold")
    .on(t.budgetId, t.periodKey, t.thresholdPercent),
]);

export const insertAiUsageEventSchema = createInsertSchema(aiUsageEvents).omit({
  id: true,
  createdAt: true,
});
export const insertAiBudgetSchema = createInsertSchema(aiBudgets).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export const insertAiBudgetAlertSchema = createInsertSchema(aiBudgetAlerts).omit({
  id: true,
  sentAt: true,
});

export type AiUsageEvent = typeof aiUsageEvents.$inferSelect;
export type InsertAiUsageEvent = z.infer<typeof insertAiUsageEventSchema>;
export type AiBudget = typeof aiBudgets.$inferSelect;
export type InsertAiBudget = z.infer<typeof insertAiBudgetSchema>;
export type AiBudgetAlert = typeof aiBudgetAlerts.$inferSelect;
export type InsertAiBudgetAlert = z.infer<typeof insertAiBudgetAlertSchema>;
