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
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { users, workLocations } from "./identity";

// SOP categories
export const sopCategories = pgTable("sop_categories", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  storeId: varchar("store_id").references(() => workLocations.id),
  name: varchar("name").notNull(),
  description: text("description"),
  icon: varchar("icon"),
  sortOrder: integer("sort_order").default(0),
  createdAt: timestamp("created_at").defaultNow(),
});

// SOP documents
export const sopDocuments = pgTable("sop_documents", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  categoryId: varchar("category_id").references(() => sopCategories.id).notNull(),
  title: varchar("title").notNull(),
  content: text("content").notNull(),
  summary: text("summary"),
  tags: text("tags").array(),
  isPublished: boolean("is_published").default(false),
  version: integer("version").default(1),
  source: varchar("source").default("manual"),
  updatedBy: varchar("updated_by").references(() => users.id),
  updatedAt: timestamp("updated_at").defaultNow(),
  createdAt: timestamp("created_at").defaultNow(),
});

// SOP Library — Templates, Steps, Executions, Step Completions
export const sopTemplates = pgTable("sop_templates", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  storeId: varchar("store_id").references(() => workLocations.id).notNull(),
  title: text("title").notNull(),
  description: text("description"),
  category: text("category").notNull(),
  estimatedDurationMinutes: integer("estimated_duration_minutes"),
  roleAssignments: jsonb("role_assignments").$type<string[]>(),
  isActive: boolean("is_active").default(true),
  trainingNotes: text("training_notes"),
  walkthroughVideoUrl: text("walkthrough_video_url"),
  isTrainingPriority: boolean("is_training_priority").default(false),
  version: integer("version").notNull().default(1),
  parentTemplateId: varchar("parent_template_id"),
  createdBy: text("created_by").notNull(),
  tags: text("tags").array(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
}, (table) => [
  index("idx_sop_templates_store_active_cat").on(table.storeId, table.isActive, table.category),
  index("idx_sop_templates_store_created").on(table.storeId, table.createdAt),
]);

export const sopSteps = pgTable("sop_steps", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  templateId: varchar("template_id").references(() => sopTemplates.id, { onDelete: "cascade" }).notNull(),
  stepOrder: integer("step_order").notNull(),
  title: text("title").notNull(),
  description: text("description"),
  stepType: text("step_type").notNull(),
  isCheckpoint: boolean("is_checkpoint").default(false),
  timerDurationSeconds: integer("timer_duration_seconds"),
  decisionOptions: jsonb("decision_options").$type<{ question?: string; options: { label: string; nextStepOrder: number; color?: string }[] }>(),
  trainingDetail: text("training_detail"),
  trainingVideoUrl: text("training_video_url"),
  trainingPhotoUrls: jsonb("training_photo_urls").$type<string[]>().default([]),
  trainingVideoThumbnail: text("training_video_thumbnail"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
}, (table) => [
  index("idx_sop_steps_template_order").on(table.templateId, table.stepOrder),
]);

export const sopExecutions = pgTable("sop_executions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  templateId: varchar("template_id").references(() => sopTemplates.id).notNull(),
  employeeId: text("employee_id").notNull(),
  storeId: varchar("store_id").references(() => workLocations.id).notNull(),
  status: text("status").notNull().default("in_progress"),
  branchPath: jsonb("branch_path").$type<{ stepId: string; choice: string; targetStepOrder: number }[]>().default([]),
  startedAt: timestamp("started_at", { withTimezone: true }).defaultNow(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
}, (table) => [
  index("idx_sop_executions_store_emp_status").on(table.storeId, table.employeeId, table.status),
  index("idx_sop_executions_template_started").on(table.templateId, table.startedAt),
  index("idx_sop_executions_store_started").on(table.storeId, table.startedAt),
]);

export const sopStepCompletions = pgTable("sop_step_completions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  executionId: varchar("execution_id").references(() => sopExecutions.id, { onDelete: "cascade" }).notNull(),
  stepId: varchar("step_id").references(() => sopSteps.id).notNull(),
  status: text("status").notNull().default("pending"),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  timeSpentSeconds: integer("time_spent_seconds"),
  skipReason: text("skip_reason"),
  photoUrl: text("photo_url"),
  notes: text("notes"),
  managerSignOff: boolean("manager_sign_off").default(false),
  managerSignOffBy: text("manager_sign_off_by"),
  managerSignOffAt: timestamp("manager_sign_off_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
}, (table) => [
  index("idx_sop_step_completions_exec_step").on(table.executionId, table.stepId),
]);

export const sopEmbeddings = pgTable("sop_embeddings", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  storeId: text("store_id").notNull(),
  sourceType: text("source_type").notNull(),
  sourceId: varchar("source_id").notNull(),
  contentText: text("content_text").notNull(),
  contentHash: text("content_hash").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
}, (table) => [
  index("idx_sop_embeddings_store_type").on(table.storeId, table.sourceType),
  index("idx_sop_embeddings_source").on(table.sourceId),
  uniqueIndex("uq_sop_embeddings_source_type").on(table.sourceId, table.sourceType),
]);

export const sopInsights = pgTable("sop_insights", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  storeId: text("store_id").notNull(),
  insightType: text("insight_type").notNull(),
  severity: text("severity").notNull(),
  sopTemplateId: varchar("sop_template_id").references(() => sopTemplates.id),
  stepId: varchar("step_id"),
  headline: text("headline").notNull(),
  detail: text("detail").notNull(),
  recommendation: text("recommendation").notNull(),
  dataPoint: text("data_point"),
  status: text("status").notNull().default("active"),
  acknowledgedBy: text("acknowledged_by"),
  acknowledgedAt: timestamp("acknowledged_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
}, (table) => [
  index("idx_sop_insights_store_status").on(table.storeId, table.status, table.severity),
  index("idx_sop_insights_template").on(table.sopTemplateId),
]);

export const sopRevisionProposals = pgTable("sop_revision_proposals", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  storeId: text("store_id").notNull(),
  sopTemplateId: varchar("sop_template_id").references(() => sopTemplates.id).notNull(),
  sourceType: text("source_type").notNull(),
  sourceIds: jsonb("source_ids").$type<string[]>().default([]),
  proposalType: text("proposal_type").notNull(),
  title: text("title").notNull(),
  description: text("description").notNull(),
  aiRationale: text("ai_rationale"),
  proposedChanges: jsonb("proposed_changes"),
  status: text("status").notNull().default("pending"),
  reviewedBy: text("reviewed_by"),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
  reviewNotes: text("review_notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
}, (table) => [
  index("idx_sop_revisions_store_status").on(table.storeId, table.status, table.createdAt),
  index("idx_sop_revisions_template_status").on(table.sopTemplateId, table.status),
]);

// Insert schemas
export const insertSopCategorySchema = createInsertSchema(sopCategories).omit({ id: true, createdAt: true });
export const insertSopDocumentSchema = createInsertSchema(sopDocuments).omit({ id: true, createdAt: true, updatedAt: true });
export const insertSopTemplateSchema = createInsertSchema(sopTemplates).omit({ id: true, createdAt: true, updatedAt: true });
export const insertSopStepSchema = createInsertSchema(sopSteps).omit({ id: true, createdAt: true });
export const insertSopExecutionSchema = createInsertSchema(sopExecutions).omit({ id: true, createdAt: true, startedAt: true });
export const insertSopStepCompletionSchema = createInsertSchema(sopStepCompletions).omit({ id: true, createdAt: true });
export const insertSopInsightSchema = createInsertSchema(sopInsights).omit({ id: true, createdAt: true });
export const insertSopRevisionProposalSchema = createInsertSchema(sopRevisionProposals).omit({ id: true, createdAt: true });

// Types
export type SopCategory = typeof sopCategories.$inferSelect;
export type InsertSopCategory = z.infer<typeof insertSopCategorySchema>;
export type SopDocument = typeof sopDocuments.$inferSelect;
export type InsertSopDocument = z.infer<typeof insertSopDocumentSchema>;
export type SopTemplate = typeof sopTemplates.$inferSelect;
export type InsertSopTemplate = z.infer<typeof insertSopTemplateSchema>;
export type SopStep = typeof sopSteps.$inferSelect;
export type InsertSopStep = z.infer<typeof insertSopStepSchema>;
export type SopExecution = typeof sopExecutions.$inferSelect;
export type InsertSopExecution = z.infer<typeof insertSopExecutionSchema>;
export type SopStepCompletion = typeof sopStepCompletions.$inferSelect;
export type InsertSopStepCompletion = z.infer<typeof insertSopStepCompletionSchema>;
export type SopEmbedding = typeof sopEmbeddings.$inferSelect;
export type SopInsight = typeof sopInsights.$inferSelect;
export type InsertSopInsight = z.infer<typeof insertSopInsightSchema>;
export type SopRevisionProposal = typeof sopRevisionProposals.$inferSelect;
export type InsertSopRevisionProposal = z.infer<typeof insertSopRevisionProposalSchema>;
