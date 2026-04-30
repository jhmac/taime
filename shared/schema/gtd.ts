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
  date,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { workLocations } from "./identity";

export const gtdInboxItems = pgTable("gtd_inbox_items", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  storeId: text("store_id").notNull().references(() => workLocations.id),
  capturedBy: text("captured_by").notNull(),
  rawInput: text("raw_input").notNull(),
  source: text("source").notNull().default("manual"),
  status: text("status").notNull().default("unprocessed"),
  aiClarification: jsonb("ai_clarification"),
  processedAt: timestamp("processed_at", { withTimezone: true }),
  processedIntoType: text("processed_into_type"),
  processedIntoId: varchar("processed_into_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
}, (table) => [
  index("idx_gtd_inbox_store_status_created").on(table.storeId, table.status, table.createdAt),
  index("idx_gtd_inbox_captured_status").on(table.capturedBy, table.status),
]);

export const gtdProjects = pgTable("gtd_projects", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  storeId: text("store_id").notNull().references(() => workLocations.id),
  ownerId: text("owner_id").notNull(),
  title: text("title").notNull(),
  description: text("description"),
  status: text("status").notNull().default("active"),
  desiredOutcome: text("desired_outcome"),
  dueDate: date("due_date"),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
}, (table) => [
  index("idx_gtd_projects_store_owner_status").on(table.storeId, table.ownerId, table.status),
]);

export const gtdNextActions = pgTable("gtd_next_actions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  storeId: text("store_id").notNull().references(() => workLocations.id),
  projectId: varchar("project_id").references(() => gtdProjects.id, { onDelete: "set null" }),
  assignedTo: text("assigned_to").notNull(),
  createdBy: text("created_by").notNull(),
  title: text("title").notNull(),
  description: text("description"),
  context: text("context"),
  energyLevel: text("energy_level"),
  timeEstimateMinutes: integer("time_estimate_minutes"),
  priority: text("priority").notNull().default("normal"),
  status: text("status").notNull().default("active"),
  dueDate: date("due_date"),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  isTwoMinute: boolean("is_two_minute").default(false),
  sourceInboxItemId: varchar("source_inbox_item_id").references(() => gtdInboxItems.id),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
}, (table) => [
  index("idx_gtd_actions_store_assigned_status").on(table.storeId, table.assignedTo, table.status),
  index("idx_gtd_actions_store_context_status").on(table.storeId, table.context, table.status),
  index("idx_gtd_actions_store_priority_status").on(table.storeId, table.priority, table.status),
  index("idx_gtd_actions_project_status").on(table.projectId, table.status),
  index("idx_gtd_actions_due_active").on(table.dueDate).where(sql`status = 'active'`),
]);

export const gtdWaitingFor = pgTable("gtd_waiting_for", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  storeId: text("store_id").notNull().references(() => workLocations.id),
  projectId: varchar("project_id").references(() => gtdProjects.id, { onDelete: "set null" }),
  ownerId: text("owner_id").notNull(),
  waitingOn: text("waiting_on").notNull(),
  waitingOnEmployeeId: text("waiting_on_employee_id"),
  description: text("description").notNull(),
  followUpDate: date("follow_up_date"),
  status: text("status").notNull().default("waiting"),
  receivedAt: timestamp("received_at", { withTimezone: true }),
  sourceInboxItemId: varchar("source_inbox_item_id").references(() => gtdInboxItems.id),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
}, (table) => [
  index("idx_gtd_waiting_store_owner_status").on(table.storeId, table.ownerId, table.status),
  index("idx_gtd_waiting_followup_active").on(table.followUpDate).where(sql`status = 'waiting'`),
]);

export const gtdSomedayMaybe = pgTable("gtd_someday_maybe", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  storeId: text("store_id").notNull().references(() => workLocations.id),
  ownerId: text("owner_id").notNull(),
  title: text("title").notNull(),
  description: text("description"),
  category: text("category"),
  status: text("status").notNull().default("parked"),
  activatedIntoType: text("activated_into_type"),
  activatedIntoId: varchar("activated_into_id"),
  sourceInboxItemId: varchar("source_inbox_item_id").references(() => gtdInboxItems.id),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
}, (table) => [
  index("idx_gtd_someday_store_owner_status").on(table.storeId, table.ownerId, table.status),
]);

export const gtdReference = pgTable("gtd_reference", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  storeId: text("store_id").notNull().references(() => workLocations.id),
  ownerId: text("owner_id").notNull(),
  title: text("title").notNull(),
  content: text("content").notNull(),
  tags: jsonb("tags").default([]),
  sourceInboxItemId: varchar("source_inbox_item_id").references(() => gtdInboxItems.id),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
}, (table) => [
  index("idx_gtd_reference_store_owner").on(table.storeId, table.ownerId),
]);

export const weeklyReviews = pgTable("weekly_reviews", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  storeId: text("store_id").notNull(),
  userId: text("user_id").notNull(),
  reviewWeekStart: date("review_week_start").notNull(),
  aiContent: jsonb("ai_content").notNull().default({}),
  status: text("status").notNull().default("pending"),
  startedAt: timestamp("started_at", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
}, (table) => [
  index("idx_weekly_reviews_user_store").on(table.userId, table.storeId),
]);

// Insert schemas
export const insertGtdInboxItemSchema = createInsertSchema(gtdInboxItems).omit({ id: true, createdAt: true, updatedAt: true });
export const insertGtdProjectSchema = createInsertSchema(gtdProjects).omit({ id: true, createdAt: true, updatedAt: true });
export const insertGtdNextActionSchema = createInsertSchema(gtdNextActions).omit({ id: true, createdAt: true, updatedAt: true });
export const insertGtdWaitingForSchema = createInsertSchema(gtdWaitingFor).omit({ id: true, createdAt: true, updatedAt: true });
export const insertGtdSomedayMaybeSchema = createInsertSchema(gtdSomedayMaybe).omit({ id: true, createdAt: true, updatedAt: true });
export const insertGtdReferenceSchema = createInsertSchema(gtdReference).omit({ id: true, createdAt: true, updatedAt: true });
export const insertWeeklyReviewSchema = createInsertSchema(weeklyReviews).omit({ id: true, createdAt: true });

// Types
export type GtdInboxItem = typeof gtdInboxItems.$inferSelect;
export type InsertGtdInboxItem = z.infer<typeof insertGtdInboxItemSchema>;
export type GtdProject = typeof gtdProjects.$inferSelect;
export type InsertGtdProject = z.infer<typeof insertGtdProjectSchema>;
export type GtdNextAction = typeof gtdNextActions.$inferSelect;
export type InsertGtdNextAction = z.infer<typeof insertGtdNextActionSchema>;
export type GtdWaitingFor = typeof gtdWaitingFor.$inferSelect;
export type InsertGtdWaitingFor = z.infer<typeof insertGtdWaitingForSchema>;
export type GtdSomedayMaybe = typeof gtdSomedayMaybe.$inferSelect;
export type InsertGtdSomedayMaybe = z.infer<typeof insertGtdSomedayMaybeSchema>;
export type GtdReference = typeof gtdReference.$inferSelect;
export type InsertGtdReference = z.infer<typeof insertGtdReferenceSchema>;
export type WeeklyReview = typeof weeklyReviews.$inferSelect;
export type InsertWeeklyReview = z.infer<typeof insertWeeklyReviewSchema>;
