import { sql } from "drizzle-orm";
import {
  pgTable,
  varchar,
  timestamp,
  boolean,
  text,
  jsonb,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { users } from "./identity";
import { payrollPeriods } from "./scheduling";

// User availability
export const userAvailability = pgTable("user_availability", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").references(() => users.id).notNull(),
  payrollPeriodId: varchar("payroll_period_id").references(() => payrollPeriods.id),
  date: timestamp("date").notNull(),
  timeSlot: varchar("time_slot").notNull(),
  isAvailable: boolean("is_available").default(true),
  startTime: varchar("start_time"),
  endTime: varchar("end_time"),
  notes: text("notes"),
  submittedAt: timestamp("submitted_at").defaultNow(),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("idx_user_availability_user_date").on(table.userId, table.date),
  index("idx_user_availability_period").on(table.payrollPeriodId),
]);

// Recurring weekly availability templates — one row per user
// slots is a map of dayOfWeek (0=Sun…6=Sat) → new format { available, startTime?, endTime? }
// or legacy format { morning, afternoon, evening } — both are supported
export type TemplateSlotNew = { available: boolean; startTime?: string; endTime?: string };
export type TemplateSlotLegacy = { morning: boolean; afternoon: boolean; evening: boolean };
export type TemplateSlot = TemplateSlotNew | TemplateSlotLegacy;

export const availabilityTemplates = pgTable("availability_templates", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").references(() => users.id).notNull().unique(),
  slots: jsonb("slots").notNull().$type<Record<string, TemplateSlot>>(),
  autoApplyTemplate: boolean("auto_apply_template").notNull().default(false),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Per-date availability overrides — "only this week/day" entries that take precedence over the template.
// One row per (userId, date). date is stored as "YYYY-MM-DD".
// setByManagerId is non-null when a manager (rather than the employee) set the override.
export const userAvailabilityOverrides = pgTable("user_availability_overrides", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").references(() => users.id).notNull(),
  date: varchar("date", { length: 10 }).notNull(), // "YYYY-MM-DD"
  startTime: varchar("start_time", { length: 5 }), // "HH:mm" — null when unavailable=true
  endTime: varchar("end_time", { length: 5 }),     // "HH:mm"
  unavailable: boolean("unavailable").default(false),
  setByManagerId: varchar("set_by_manager_id").references(() => users.id), // null = employee set it
  submittedByEmployeeId: varchar("submitted_by_employee_id").references(() => users.id), // null = manager-initiated
  status: varchar("status").default("approved"),   // 'pending' | 'approved' | 'rejected'
  approvalNote: text("approval_note"),             // manager's comment on review
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  uniqueIndex("idx_user_avail_overrides_user_date").on(table.userId, table.date),
  index("idx_user_avail_overrides_date").on(table.date),
  index("idx_user_avail_overrides_status").on(table.status),
]);

// Time-off requests
export const timeOffRequests = pgTable("time_off_requests", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").references(() => users.id).notNull(),
  type: varchar("type").notNull(),
  status: varchar("status").notNull().default("pending"),
  startDate: timestamp("start_date").notNull(),
  endDate: timestamp("end_date").notNull(),
  allDay: boolean("all_day").default(true),
  startTime: varchar("start_time"),
  endTime: varchar("end_time"),
  reason: text("reason"),
  adminNotes: text("admin_notes"),
  reviewedBy: varchar("reviewed_by").references(() => users.id),
  reviewedAt: timestamp("reviewed_at"),
  createdAt: timestamp("created_at").defaultNow(),
});

// Insert schemas
export const insertAvailabilityTemplateSchema = createInsertSchema(availabilityTemplates).omit({ id: true, updatedAt: true });
export const insertUserAvailabilityOverrideSchema = createInsertSchema(userAvailabilityOverrides).omit({ id: true, createdAt: true, updatedAt: true });
export const insertUserAvailabilitySchema = createInsertSchema(userAvailability).omit({ id: true, createdAt: true });
export const insertTimeOffRequestSchema = createInsertSchema(timeOffRequests).omit({ id: true, createdAt: true });

// Types
export type AvailabilityTemplate = typeof availabilityTemplates.$inferSelect;
export type InsertAvailabilityTemplate = z.infer<typeof insertAvailabilityTemplateSchema>;
export type UserAvailabilityOverride = typeof userAvailabilityOverrides.$inferSelect;
export type InsertUserAvailabilityOverride = z.infer<typeof insertUserAvailabilityOverrideSchema>;
export type UserAvailability = typeof userAvailability.$inferSelect;
export type InsertUserAvailability = z.infer<typeof insertUserAvailabilitySchema>;
export type TimeOffRequest = typeof timeOffRequests.$inferSelect;
export type InsertTimeOffRequest = z.infer<typeof insertTimeOffRequestSchema>;
