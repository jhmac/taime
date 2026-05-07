import { sql, relations } from "drizzle-orm";
import {
  pgTable,
  text,
  varchar,
  timestamp,
  boolean,
  integer,
  decimal,
  jsonb,
  index,
  uniqueIndex,
  pgEnum,
  date,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { users, workLocations } from "./identity";

// Time tracking entries
export const timeEntries = pgTable("time_entries", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").references(() => users.id).notNull(),
  locationId: varchar("location_id").references(() => workLocations.id),
  clockInTime: timestamp("clock_in_time").notNull(),
  clockOutTime: timestamp("clock_out_time"),
  breakMinutes: integer("break_minutes").default(0),
  breakStartTime: timestamp("break_start_time"),
  notes: text("notes"),
  clockInSource: varchar("clock_in_source").default("shift-start"),
  clockOutSource: varchar("clock_out_source").default("shift-end"),
  isApproved: boolean("is_approved").default(false),
  approvedBy: varchar("approved_by").references(() => users.id),
  approvedAt: timestamp("approved_at"),
  mileageMinutes: integer("mileage_minutes").default(0),
  mileageTotalCents: integer("mileage_total_cents").default(0),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("idx_time_entries_user_clockin").on(table.userId, table.clockInTime),
  index("idx_time_entries_clockin").on(table.clockInTime),
]);

// Schedules
//
// NOTE (Task #432): the `schedules` table also carries a Postgres EXCLUDE
// constraint named `schedules_no_overlap_per_user` that prevents two rows
// for the same `user_id` from having overlapping `[start_time, end_time)`
// ranges. Drizzle has no first-class EXCLUDE constraint support, so the
// constraint is created in `migrations/0022_schedules_no_overlap.sql` and
// re-asserted on every boot by `runSchemaMigrations`. The /api/ai-scheduling/
// apply route catches the constraint-violation error (Postgres code 23P01)
// and reports the offending rows as conflicts in the same `skipped[]` shape
// produced by the application-level overlap guard.
export const schedules = pgTable("schedules", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").references(() => users.id).notNull(),
  locationId: varchar("location_id").references(() => workLocations.id),
  startTime: timestamp("start_time").notNull(),
  endTime: timestamp("end_time").notNull(),
  title: varchar("title"),
  description: text("description"),
  isRecurring: boolean("is_recurring").default(false),
  createdBy: varchar("created_by").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("idx_schedules_user_start").on(table.userId, table.startTime),
  index("idx_schedules_start").on(table.startTime),
]);

export const workflowStateEnum = pgEnum("workflow_state", [
  "created",
  "availability_requested",
  "availability_collected",
  "schedule_generated",
  "schedule_sent_for_review",
  "schedule_confirmed",
  "conflicts_resolved",
  "finalized",
  "processed"
]);

// Pay period settings
export const payPeriodSettings = pgTable("pay_period_settings", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  intervalType: varchar("interval_type").default("bi-weekly"),
  isAutomationEnabled: boolean("is_automation_enabled").default(false),
  daysBeforeNotification: integer("days_before_notification").default(7),
  scheduleGenerationDays: integer("schedule_generation_days").default(5),
  automaticConflictResolution: boolean("automatic_conflict_resolution").default(true),
  firstPayPeriodStart: timestamp("first_pay_period_start"),
  firstPayPeriodEnd: timestamp("first_pay_period_end"),
  payDayOfWeek: integer("pay_day_of_week").default(5),
  notificationUserId: varchar("notification_user_id").references(() => users.id),
  isSetupComplete: boolean("is_setup_complete").default(false),
  createdBy: varchar("created_by").references(() => users.id),
  updatedBy: varchar("updated_by").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Payroll periods
export const payrollPeriods = pgTable("payroll_periods", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  startDate: timestamp("start_date").notNull(),
  endDate: timestamp("end_date").notNull(),
  workflowState: workflowStateEnum("workflow_state").default("created"),
  isProcessed: boolean("is_processed").default(false),
  processedBy: varchar("processed_by").references(() => users.id),
  processedAt: timestamp("processed_at"),
  aiAnalysis: jsonb("ai_analysis"),
  availabilityDeadline: timestamp("availability_deadline"),
  scheduleConfirmationDeadline: timestamp("schedule_confirmation_deadline"),
  availabilityNotificationSentAt: timestamp("availability_notification_sent_at"),
  scheduleGeneratedAt: timestamp("schedule_generated_at"),
  scheduleSentAt: timestamp("schedule_sent_at"),
  scheduleConfirmedAt: timestamp("schedule_confirmed_at"),
  finalizedAt: timestamp("finalized_at"),
  automationMetadata: jsonb("automation_metadata"),
  createdAt: timestamp("created_at").defaultNow(),
});

// Schedule confirmations
export const scheduleConfirmations = pgTable("schedule_confirmations", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  payrollPeriodId: varchar("payroll_period_id").references(() => payrollPeriods.id).notNull(),
  userId: varchar("user_id").references(() => users.id).notNull(),
  isConfirmed: boolean("is_confirmed").default(false),
  feedback: text("feedback"),
  conflicts: jsonb("conflicts"),
  confirmedAt: timestamp("confirmed_at"),
  createdAt: timestamp("created_at").defaultNow(),
});

// Workflow logs
export const workflowLogs = pgTable("workflow_logs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  payrollPeriodId: varchar("payroll_period_id").references(() => payrollPeriods.id).notNull(),
  workflowStep: varchar("workflow_step").notNull(),
  status: varchar("status").notNull(),
  details: text("details"),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at").defaultNow(),
});

// Clock events
export const clockEvents = pgTable("clock_events", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").references(() => users.id).notNull(),
  timeEntryId: varchar("time_entry_id").references(() => timeEntries.id),
  eventType: varchar("event_type").notNull(),
  pointValue: integer("point_value").default(0),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("idx_clock_events_user_created").on(table.userId, table.createdAt),
]);

// Performance score settings
export const performanceScoreSettings = pgTable("performance_score_settings", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  eventType: varchar("event_type").notNull().unique(),
  category: varchar("category").notNull(),
  displayName: varchar("display_name").notNull(),
  pointValue: integer("point_value").notNull(),
  isActive: boolean("is_active").default(true),
  updatedBy: varchar("updated_by").references(() => users.id),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Holiday pay rules
export const holidayPayRules = pgTable("holiday_pay_rules", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: varchar("name").notNull(),
  month: integer("month").notNull(),
  day: integer("day").notNull(),
  payMultiplier: decimal("pay_multiplier", { precision: 3, scale: 2 }).default("1.50"),
  isActive: boolean("is_active").default(true),
  createdBy: varchar("created_by").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow(),
});

// AI Scheduling Settings — one row per store (Task #435).
// store_id is nullable only to allow the column-add migration to land before
// the legacy singleton row(s) are backfilled per active work_location; the
// uq_ai_scheduling_settings_store_id unique index enforces "at most one row
// per store" and the route layer only ever reads/writes store-scoped rows.
export const aiSchedulingSettings = pgTable("ai_scheduling_settings", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  storeId: varchar("store_id").references(() => workLocations.id, { onDelete: 'cascade' }),
  shiftBlocks: jsonb("shift_blocks").default(sql`'[]'::jsonb`),
  staffingTiers: jsonb("staffing_tiers").default(sql`'[]'::jsonb`),
  minimumStaffing: integer("minimum_staffing").default(2),
  updatedBy: varchar("updated_by").references(() => users.id),
  updatedAt: timestamp("updated_at").defaultNow(),
  storeHours: jsonb("store_hours").default(sql`'[]'::jsonb`),
  shiftOverlapMinutes: integer("shift_overlap_minutes").default(60),
  overlapBudgetLimit: decimal("overlap_budget_limit", { precision: 10, scale: 2 }),
  customAiInstructions: text("custom_ai_instructions"),
  laborCostOverPct: decimal("labor_cost_over_pct", { precision: 5, scale: 2 }).default("30"),
  laborCostUnderPct: decimal("labor_cost_under_pct", { precision: 5, scale: 2 }).default("10"),
  payrollTargetPct: decimal("payroll_target_pct", { precision: 5, scale: 2 }).default("30"),
  storeType: varchar("store_type").default("fashion_boutique"),
  minStaffingPreHours: integer("min_staffing_pre_hours").default(1),
  minStaffingDuringHours: integer("min_staffing_during_hours").default(2),
  minStaffingPostHours: integer("min_staffing_post_hours").default(1),
}, (table) => [
  uniqueIndex("uq_ai_scheduling_settings_store_id").on(table.storeId),
]);

// Special Circumstances — store-specific events that affect scheduling (scoped per store)
export const specialCircumstances = pgTable("special_circumstances", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  storeId: varchar("store_id").references(() => workLocations.id, { onDelete: 'cascade' }),
  name: varchar("name").notNull(),
  description: text("description"),
  category: varchar("category"),
  isEnabled: boolean("is_enabled").default(true),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("idx_special_circumstances_store").on(table.storeId),
]);

// AI Scheduling Rules — structured coverage rules (scoped per store/tenant)
export const aiSchedulingRules = pgTable("ai_scheduling_rules", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  storeId: varchar("store_id"),
  ruleType: varchar("rule_type").notNull(),
  params: jsonb("params").default(sql`'{}'::jsonb`).$type<Record<string, string | number | boolean>>(),
  isEnabled: boolean("is_enabled").default(true),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Work pattern templates
export const workPatternTemplates = pgTable("work_pattern_templates", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: varchar("name").notNull(),
  description: text("description"),
  pattern: jsonb("pattern").notNull(), // Array of { dayOfWeek, startTime, endTime, roleId }
  isActive: boolean("is_active").default(true),
  createdAt: timestamp("created_at").defaultNow(),
});

// User work patterns
export const userWorkPatterns = pgTable("user_work_patterns", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").references(() => users.id).notNull(),
  templateId: varchar("template_id").references(() => workPatternTemplates.id),
  customPattern: jsonb("custom_pattern"), // Override template if needed
  effectiveFrom: timestamp("effective_from").notNull(),
  effectiveTo: timestamp("effective_to"),
  isActive: boolean("is_active").default(true),
  createdAt: timestamp("created_at").defaultNow(),
});

// Time entry edit audit trail
export const timeEntryEdits = pgTable("time_entry_edits", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  timeEntryId: varchar("time_entry_id").references(() => timeEntries.id).notNull(),
  editedBy: varchar("edited_by").references(() => users.id).notNull(),
  editedAt: timestamp("edited_at").defaultNow(),
  fieldChanged: varchar("field_changed").notNull(),
  oldValue: text("old_value"),
  newValue: text("new_value"),
  reason: text("reason"),
}, (table) => [
  index("idx_time_entry_edits_entry").on(table.timeEntryId),
  index("idx_time_entry_edits_edited_at").on(table.editedAt),
]);

// Discrepancy resolutions — tracks when admins excuse/resolve time discrepancies
export const discrepancyResolutions = pgTable("discrepancy_resolutions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").references(() => users.id).notNull(),
  date: varchar("date").notNull(), // YYYY-MM-DD
  discrepancyType: varchar("discrepancy_type").notNull(), // no_show, missing_clock_out, etc.
  action: varchar("action").notNull(), // excuse | add_time_card
  reason: text("reason").notNull(),
  resolvedBy: varchar("resolved_by").references(() => users.id).notNull(),
  resolvedAt: timestamp("resolved_at").defaultNow(),
  entryId: varchar("entry_id").references(() => timeEntries.id),
  newEntryId: varchar("new_entry_id").references(() => timeEntries.id),
}, (table) => [
  index("idx_discrepancy_resolutions_user_date").on(table.userId, table.date),
]);

// Off-site allowance rules
export const offsiteAllowanceRules = pgTable("offsite_allowance_rules", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  locationId: varchar("location_id").references(() => workLocations.id).notNull(),
  name: varchar("name").notNull(),
  allowedMinutes: integer("allowed_minutes").notNull().default(30),
  allowedTimeStart: varchar("allowed_time_start"),
  allowedTimeEnd: varchar("allowed_time_end"),
  appliesTo: varchar("applies_to").notNull().default("all"),
  specificEmployeeIds: jsonb("specific_employee_ids").$type<string[]>(),
  alertAfterMinutes: integer("alert_after_minutes").default(20),
  alertRecipients: varchar("alert_recipients").notNull().default("both"),
  customAlertUserIds: jsonb("custom_alert_user_ids").$type<string[]>(),
  isActive: boolean("is_active").default(true),
  destinationAddress: text("destination_address"),
  destinationPlaceId: varchar("destination_place_id"),
  destinationLat: decimal("destination_lat", { precision: 10, scale: 8 }),
  destinationLng: decimal("destination_lng", { precision: 11, scale: 8 }),
  destinationName: varchar("destination_name"),
  mileageRateCents: integer("mileage_rate_cents").default(0),
  maxTripsPerDay: integer("max_trips_per_day"),
  deviationToleranceMeters: integer("deviation_tolerance_meters").default(200),
  waypoints: jsonb("waypoints").$type<Array<{ name: string; placeId: string; lat: number; lng: number; address: string }>>(),
  chosenRoutePolyline: text("chosen_route_polyline"),
  createdBy: varchar("created_by").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("idx_offsite_rules_location").on(table.locationId),
]);

// Off-site sessions (tracks time outside work area)
export const offsiteSessions = pgTable("offsite_sessions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  timeEntryId: varchar("time_entry_id").references(() => timeEntries.id),
  userId: varchar("user_id").references(() => users.id).notNull(),
  locationId: varchar("location_id").references(() => workLocations.id).notNull(),
  ruleId: varchar("rule_id").references(() => offsiteAllowanceRules.id),
  exitTime: timestamp("exit_time").notNull(),
  returnTime: timestamp("return_time"),
  durationMinutes: integer("duration_minutes"),
  wasAlertSent: boolean("was_alert_sent").default(false),
  alertSentAt: timestamp("alert_sent_at"),
  status: varchar("status").notNull().default("active"),
  routePolyline: text("route_polyline"),
  routeDistanceMeters: integer("route_distance_meters"),
  routeDurationSeconds: integer("route_duration_seconds"),
  estimatedReturnTime: timestamp("estimated_return_time"),
  destinationArrivedAt: timestamp("destination_arrived_at"),
  deviationAlertsSent: integer("deviation_alerts_sent").default(0),
  destinationNotReachedAlertSent: boolean("destination_not_reached_alert_sent").default(false),
  overdueReturnAlertSent: boolean("overdue_return_alert_sent").default(false),
  totalDistanceMiles: decimal("total_distance_miles", { precision: 8, scale: 2 }),
  deviationEventCount: integer("deviation_event_count").default(0),
  maxDeviationMiles: decimal("max_deviation_miles", { precision: 8, scale: 2 }),
  destinationReached: boolean("destination_reached"),
  reimbursementCents: integer("reimbursement_cents"),
  breadcrumbs: jsonb("breadcrumbs").$type<Array<{ lat: number; lng: number; ts: number }>>(),
  reviewedBy: varchar("reviewed_by").references(() => users.id),
  reviewedAt: timestamp("reviewed_at"),
  reviewStatus: varchar("review_status"),
  adminNote: text("admin_note"),
  sessionWaypoints: jsonb("session_waypoints").$type<Array<{ name: string; placeId: string; lat: number; lng: number; address: string; arrivedAt?: string }>>(),
  currentLegIndex: integer("current_leg_index").default(0),
  consecutiveOffRouteCount: integer("consecutive_off_route_count").default(0),
  clockedOutOffRoute: boolean("clocked_out_off_route").default(false),
}, (table) => [
  index("idx_offsite_sessions_user").on(table.userId),
  index("idx_offsite_sessions_status").on(table.status),
  index("idx_offsite_sessions_time_entry").on(table.timeEntryId),
]);

// Off-site breadcrumbs (GPS trail during active offsite trips with destinations)
export const offsiteBreadcrumbs = pgTable("offsite_breadcrumbs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  sessionId: varchar("session_id").references(() => offsiteSessions.id).notNull(),
  latitude: decimal("latitude", { precision: 10, scale: 8 }).notNull(),
  longitude: decimal("longitude", { precision: 11, scale: 8 }).notNull(),
  accuracy: integer("accuracy"),
  isDeviation: boolean("is_deviation").default(false),
  distanceFromRouteMt: integer("distance_from_route_mt"),
  timestamp: timestamp("timestamp").notNull().defaultNow(),
}, (table) => [
  index("idx_offsite_breadcrumbs_session").on(table.sessionId),
]);

// Mileage reimbursements — auto-posted when a trip closes with a mileage rate > 0
export const mileageReimbursements = pgTable("mileage_reimbursements", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  sessionId: varchar("session_id").references(() => offsiteSessions.id).notNull(),
  timeEntryId: varchar("time_entry_id").references(() => timeEntries.id),
  userId: varchar("user_id").references(() => users.id).notNull(),
  milesDecimal: decimal("miles_decimal", { precision: 10, scale: 4 }).notNull(),
  rateCents: integer("rate_cents").notNull(),
  totalCents: integer("total_cents").notNull(),
  equivalentMinutes: integer("equivalent_minutes").notNull(),
  appliedAt: timestamp("applied_at").defaultNow(),
  adjustedBy: varchar("adjusted_by").references(() => users.id),
  adjustedAt: timestamp("adjusted_at"),
  adjustedMilesDecimal: decimal("adjusted_miles_decimal", { precision: 10, scale: 4 }),
}, (table) => [
  index("idx_mileage_reimbursements_session").on(table.sessionId),
  index("idx_mileage_reimbursements_user").on(table.userId),
  index("idx_mileage_reimbursements_applied").on(table.appliedAt),
]);

// Overtime alerts (AI-generated swap suggestions)
export const overtimeAlerts = pgTable("overtime_alerts", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  employeeId: varchar("employee_id").references(() => users.id).notNull(),
  currentHours: decimal("current_hours", { precision: 6, scale: 2 }).notNull(),
  projectedHours: decimal("projected_hours", { precision: 6, scale: 2 }).notNull(),
  threshold: decimal("threshold", { precision: 6, scale: 2 }).notNull().default("40.00"),
  atRiskShiftId: varchar("at_risk_shift_id").references(() => schedules.id),
  suggestedReplacementId: varchar("suggested_replacement_id").references(() => users.id),
  aiReasoning: text("ai_reasoning"),
  status: varchar("status").notNull().default("pending"),
  appliedAt: timestamp("applied_at"),
  appliedBy: varchar("applied_by").references(() => users.id),
  dismissedAt: timestamp("dismissed_at"),
  dismissedBy: varchar("dismissed_by").references(() => users.id),
  weekStartDate: timestamp("week_start_date").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("idx_overtime_alerts_employee").on(table.employeeId),
  index("idx_overtime_alerts_status").on(table.status),
  index("idx_overtime_alerts_week").on(table.weekStartDate),
]);

// AI Suggested Schedules (persisted to avoid regenerating)
export const aiSuggestedSchedules = pgTable("ai_suggested_schedules", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  storeId: varchar("store_id").references(() => workLocations.id).notNull(),
  date: varchar("date", { length: 10 }).notNull(),
  scheduleData: jsonb("schedule_data").notNull(),
  generatedAt: timestamp("generated_at").defaultNow(),
}, (t) => [
  uniqueIndex("ai_sched_store_date_idx").on(t.storeId, t.date),
]);

// Action log — persistent audit trail for critical labor events (clock-in/out, edits, exports)
export const actionLog = pgTable("action_log", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  storeId: varchar("store_id").references(() => workLocations.id, { onDelete: 'set null' }),
  userId: varchar("user_id").references(() => users.id, { onDelete: 'set null' }),
  actorId: varchar("actor_id").references(() => users.id, { onDelete: 'set null' }),
  eventType: varchar("event_type").notNull(),
  payload: jsonb("payload").$type<Record<string, unknown>>(),
  ipAddress: varchar("ip_address"),
  userAgent: text("user_agent"),
  source: varchar("source"),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("idx_action_log_user_created").on(table.userId, table.createdAt),
  index("idx_action_log_event_type").on(table.eventType),
  index("idx_action_log_store_created").on(table.storeId, table.createdAt),
  index("idx_action_log_created_at").on(table.createdAt),
]);

export const insertActionLogSchema = createInsertSchema(actionLog).omit({ id: true, createdAt: true });
export type ActionLog = typeof actionLog.$inferSelect;
export type InsertActionLog = z.infer<typeof insertActionLogSchema>;

// Insert schemas
export const insertTimeEntrySchema = createInsertSchema(timeEntries).omit({ id: true, createdAt: true });
export const insertScheduleSchema = createInsertSchema(schedules).omit({ id: true, createdAt: true });
export const insertPayrollPeriodSchema = createInsertSchema(payrollPeriods).omit({ id: true, createdAt: true });
export const insertPayPeriodSettingsSchema = createInsertSchema(payPeriodSettings).omit({ id: true, createdAt: true, updatedAt: true });
export const insertScheduleConfirmationSchema = createInsertSchema(scheduleConfirmations).omit({ id: true, createdAt: true });
export const insertWorkflowLogSchema = createInsertSchema(workflowLogs).omit({ id: true, createdAt: true });
export const insertClockEventSchema = createInsertSchema(clockEvents).omit({ id: true, createdAt: true });
export const insertPerformanceScoreSettingSchema = createInsertSchema(performanceScoreSettings).omit({ id: true, updatedAt: true });
export const insertHolidayPayRuleSchema = createInsertSchema(holidayPayRules).omit({ id: true, createdAt: true });
export const insertAiSchedulingSettingsSchema = createInsertSchema(aiSchedulingSettings).omit({ id: true, updatedAt: true });
export const insertAiSchedulingRuleSchema = createInsertSchema(aiSchedulingRules).omit({ id: true, createdAt: true, updatedAt: true });
export const insertWorkPatternTemplateSchema = createInsertSchema(workPatternTemplates).omit({ id: true, createdAt: true });
export const insertUserWorkPatternSchema = createInsertSchema(userWorkPatterns).omit({ id: true, createdAt: true });
export const insertTimeEntryEditSchema = createInsertSchema(timeEntryEdits).omit({ id: true, editedAt: true });
export const insertDiscrepancyResolutionSchema = createInsertSchema(discrepancyResolutions).omit({ id: true, resolvedAt: true });
export const insertOffsiteAllowanceRuleSchema = createInsertSchema(offsiteAllowanceRules).omit({ id: true, createdAt: true });
export const insertOffsiteSessionSchema = createInsertSchema(offsiteSessions).omit({ id: true });
export const insertOffsiteBreadcrumbSchema = createInsertSchema(offsiteBreadcrumbs).omit({ id: true });
export const insertOvertimeAlertSchema = createInsertSchema(overtimeAlerts).omit({ id: true, createdAt: true });
export const insertMileageReimbursementSchema = createInsertSchema(mileageReimbursements).omit({ id: true, appliedAt: true });
export const insertAiSuggestedScheduleSchema = createInsertSchema(aiSuggestedSchedules).omit({ id: true, generatedAt: true });
export const insertSpecialCircumstanceSchema = createInsertSchema(specialCircumstances).omit({ id: true, createdAt: true, updatedAt: true });

// Timesheet workflow settings — one row per store (location)
export const timesheetWorkflowSettings = pgTable("timesheet_workflow_settings", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  storeId: varchar("store_id").references(() => workLocations.id),
  managerReminderDaysAfterPeriod: integer("manager_reminder_days_after_period").default(2),
  managerEscalationDaysAfterReminder: integer("manager_escalation_days_after_reminder").default(3),
  notifyAdminOnManagerApproval: boolean("notify_admin_on_manager_approval").default(true),
  employeeSelfReviewReminder: boolean("employee_self_review_reminder").default(false),
  singleStepApproval: boolean("single_step_approval").default(false),
  emailRemindersEnabled: boolean("email_reminders_enabled").default(false),
  reminderFromEmail: varchar("reminder_from_email"),
  managerUserIds: jsonb("manager_user_ids").$type<string[]>().default(sql`'[]'::jsonb`),
  adminUserId: varchar("admin_user_id").references(() => users.id),
  updatedBy: varchar("updated_by").references(() => users.id),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Timesheet reminder log — tracks when each reminder/escalation was sent
export const timesheetReminderLog = pgTable("timesheet_reminder_log", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  storeId: varchar("store_id").references(() => workLocations.id),
  periodStart: varchar("period_start").notNull(),
  periodEnd: varchar("period_end").notNull(),
  reminderType: varchar("reminder_type").notNull(),
  userId: varchar("user_id").references(() => users.id),
  sentAt: timestamp("sent_at").defaultNow(),
  wasActedOn: boolean("was_acted_on").default(false),
  actedOnAt: timestamp("acted_on_at"),
}, (table) => [
  index("idx_timesheet_reminder_log_period").on(table.periodStart, table.periodEnd),
]);

// Timesheet period approvals — tracks the two-step manager→admin approval chain per period
export const timesheetPeriodApprovals = pgTable("timesheet_period_approvals", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  storeId: varchar("store_id").references(() => workLocations.id).notNull(),
  periodStart: varchar("period_start").notNull(),
  periodEnd: varchar("period_end").notNull(),
  // 'pending' | 'manager_approved' | 'final_approved'
  status: varchar("status").default("pending").notNull(),
  managerApprovedBy: varchar("manager_approved_by").references(() => users.id),
  managerApprovedAt: timestamp("manager_approved_at"),
  adminApprovedBy: varchar("admin_approved_by").references(() => users.id),
  adminApprovedAt: timestamp("admin_approved_at"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("idx_timesheet_period_approvals_store_period").on(table.storeId, table.periodStart, table.periodEnd),
]);

export const insertTimesheetWorkflowSettingsSchema = createInsertSchema(timesheetWorkflowSettings).omit({ id: true, updatedAt: true });
export const insertTimesheetReminderLogSchema = createInsertSchema(timesheetReminderLog).omit({ id: true, sentAt: true });
export const insertTimesheetPeriodApprovalSchema = createInsertSchema(timesheetPeriodApprovals).omit({ id: true, createdAt: true, updatedAt: true });

// Chore assignment and sign-off schemas
export const choreAssignmentSchema = z.object({
  choreId: z.string().uuid(),
  userId: z.string().uuid(),
});

export const choreSignOffSchema = z.object({
  choreId: z.string(),
  isManager: z.boolean().default(false),
});

// Types
export type TimeEntry = typeof timeEntries.$inferSelect;
export type InsertTimeEntry = z.infer<typeof insertTimeEntrySchema>;
export type Schedule = typeof schedules.$inferSelect;
export type InsertSchedule = z.infer<typeof insertScheduleSchema>;
export type PayrollPeriod = typeof payrollPeriods.$inferSelect;
export type InsertPayrollPeriod = z.infer<typeof insertPayrollPeriodSchema>;
export type PayPeriodSettings = typeof payPeriodSettings.$inferSelect;
export type InsertPayPeriodSettings = z.infer<typeof insertPayPeriodSettingsSchema>;
export type ScheduleConfirmation = typeof scheduleConfirmations.$inferSelect;
export type InsertScheduleConfirmation = z.infer<typeof insertScheduleConfirmationSchema>;
export type WorkflowLog = typeof workflowLogs.$inferSelect;
export type InsertWorkflowLog = z.infer<typeof insertWorkflowLogSchema>;
export type ClockEvent = typeof clockEvents.$inferSelect;
export type InsertClockEvent = z.infer<typeof insertClockEventSchema>;
export type PerformanceScoreSetting = typeof performanceScoreSettings.$inferSelect;
export type InsertPerformanceScoreSetting = z.infer<typeof insertPerformanceScoreSettingSchema>;
export type HolidayPayRule = typeof holidayPayRules.$inferSelect;
export type InsertHolidayPayRule = z.infer<typeof insertHolidayPayRuleSchema>;
export type AiSchedulingRule = typeof aiSchedulingRules.$inferSelect;
export type InsertAiSchedulingRule = z.infer<typeof insertAiSchedulingRuleSchema>;
export type TimeEntryEdit = typeof timeEntryEdits.$inferSelect;
export type InsertTimeEntryEdit = z.infer<typeof insertTimeEntryEditSchema>;
export type DiscrepancyResolution = typeof discrepancyResolutions.$inferSelect;
export type InsertDiscrepancyResolution = z.infer<typeof insertDiscrepancyResolutionSchema>;
export type OffsiteAllowanceRule = typeof offsiteAllowanceRules.$inferSelect;
export type InsertOffsiteAllowanceRule = z.infer<typeof insertOffsiteAllowanceRuleSchema>;
export type OffsiteSession = typeof offsiteSessions.$inferSelect;
export type InsertOffsiteSession = z.infer<typeof insertOffsiteSessionSchema>;
export type OffsiteBreadcrumb = typeof offsiteBreadcrumbs.$inferSelect;
export type InsertOffsiteBreadcrumb = z.infer<typeof insertOffsiteBreadcrumbSchema>;
export type OvertimeAlert = typeof overtimeAlerts.$inferSelect;
export type InsertOvertimeAlert = z.infer<typeof insertOvertimeAlertSchema>;
export type MileageReimbursement = typeof mileageReimbursements.$inferSelect;
export type InsertMileageReimbursement = z.infer<typeof insertMileageReimbursementSchema>;
export type AiSuggestedSchedule = typeof aiSuggestedSchedules.$inferSelect;
export type InsertAiSuggestedSchedule = z.infer<typeof insertAiSuggestedScheduleSchema>;
export type TimesheetWorkflowSettings = typeof timesheetWorkflowSettings.$inferSelect;
export type InsertTimesheetWorkflowSettings = z.infer<typeof insertTimesheetWorkflowSettingsSchema>;
export type TimesheetReminderLog = typeof timesheetReminderLog.$inferSelect;
export type InsertTimesheetReminderLog = z.infer<typeof insertTimesheetReminderLogSchema>;
export type TimesheetPeriodApproval = typeof timesheetPeriodApprovals.$inferSelect;
export type InsertTimesheetPeriodApproval = z.infer<typeof insertTimesheetPeriodApprovalSchema>;
export type SpecialCircumstance = typeof specialCircumstances.$inferSelect;
export type InsertSpecialCircumstance = z.infer<typeof insertSpecialCircumstanceSchema>;
