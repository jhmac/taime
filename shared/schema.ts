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
  date,
  pgEnum,
  serial,
  unique
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// Session storage table for Replit Auth
export const sessions = pgTable(
  "sessions",
  {
    sid: varchar("sid").primaryKey(),
    sess: jsonb("sess").notNull(),
    expire: timestamp("expire").notNull(),
  },
  (table) => [index("IDX_session_expire").on(table.expire)],
);

// Companies table — the root tenant entity for multi-tenancy.
// Every user and every Shopify shop belongs to exactly one company.
export const companies = pgTable("companies", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: varchar("name").notNull().default("My Company"),
  createdAt: timestamp("created_at").defaultNow(),
});

// Roles table for granular permissions
export const roles = pgTable("roles", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: varchar("name").notNull().unique(),
  displayName: varchar("display_name").notNull(),
  description: text("description"),
  isSystemRole: boolean("is_system_role").default(false),
  isActive: boolean("is_active").default(true),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Permissions table
export const permissions = pgTable("permissions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: varchar("name").notNull().unique(),
  displayName: varchar("display_name").notNull(),
  description: text("description"),
  category: varchar("category").notNull(), // 'time_tracking', 'scheduling', 'hr', 'communication', etc.
  createdAt: timestamp("created_at").defaultNow(),
});

// Role permissions junction table
export const rolePermissions = pgTable("role_permissions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  roleId: varchar("role_id").references(() => roles.id).notNull(),
  permissionId: varchar("permission_id").references(() => permissions.id).notNull(),
  createdAt: timestamp("created_at").defaultNow(),
});

// User storage table for Replit Auth
export const users = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  email: varchar("email").unique(),
  firstName: varchar("first_name"),
  lastName: varchar("last_name"),
  profileImageUrl: varchar("profile_image_url"),
  phone: varchar("phone"),
  employmentType: varchar("employment_type").default("contractor"),
  roleId: varchar("role_id").references(() => roles.id),
  hourlyRate: decimal("hourly_rate", { precision: 10, scale: 2 }),
  locationName: varchar("location_name"),
  payrollClassification: varchar("payroll_classification").default("1099 Contractor"),
  startDate: timestamp("start_date"),
  pin: varchar("pin"),
  showInSchedule: boolean("show_in_schedule").default(true),
  targetWeeklyHours: decimal("target_weekly_hours", { precision: 5, scale: 1 }),
  sendLocationAlerts: boolean("send_location_alerts").default(true),
  includeInTimeClockErrors: boolean("include_in_time_clock_errors").default(true),
  eligibleForOpenShifts: boolean("eligible_for_open_shifts").default(true),
  canWaiveMissedBreaks: boolean("can_waive_missed_breaks").default(false),
  homeLatitude: decimal("home_latitude", { precision: 10, scale: 8 }),
  homeLongitude: decimal("home_longitude", { precision: 11, scale: 8 }),
  legalName: varchar("legal_name"),
  dateOfBirth: varchar("date_of_birth"),
  ssn: varchar("ssn"),
  homeAddress: text("home_address"),
  homeCity: varchar("home_city"),
  homeState: varchar("home_state"),
  homeZip: varchar("home_zip"),
  emergencyContactName: varchar("emergency_contact_name"),
  emergencyContactPhone: varchar("emergency_contact_phone"),
  preferredName: varchar("preferred_name"),
  personalEmail: varchar("personal_email"),
  scoreNotificationsEnabled: boolean("score_notifications_enabled").default(true),
  mileageRateCentsOverride: integer("mileage_rate_cents_override"),
  invitedAt: timestamp("invited_at"),
  inviteAcceptedAt: timestamp("invite_accepted_at"),
  inviteToken: varchar("invite_token").unique(),
  inviteCount: integer("invite_count").default(0),
  isActive: boolean("is_active").default(true),
  companyId: varchar("company_id").references(() => companies.id),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("idx_users_role_id").on(table.roleId),
  index("idx_users_is_active").on(table.isActive),
  index("idx_users_company_id").on(table.companyId),
]);

// Work locations for geofencing
export const workLocations = pgTable("work_locations", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: varchar("name").notNull(),
  address: text("address"),
  phone: varchar("phone"),
  email: varchar("email"),
  timezone: varchar("timezone"),
  hoursOfOperation: jsonb("hours_of_operation").$type<Record<string, { isOpen: boolean; open: string; close: string }>>(),
  latitude: decimal("latitude", { precision: 10, scale: 8 }),
  longitude: decimal("longitude", { precision: 11, scale: 8 }),
  radius: integer("radius").default(100),
  wifiSsid: varchar("wifi_ssid"),
  isActive: boolean("is_active").default(true),
  geofenceType: varchar("geofence_type", { length: 20 }).default("radius"),
  geofencePolygon: jsonb("geofence_polygon").$type<Array<{ lat: number; lng: number }>>(),
  geofenceGraceMinutes: text("geofence_grace_minutes").default("5.00"),
  geofenceEnabled: boolean("geofence_enabled").default(true),
  autoClockOut: boolean("auto_clock_out").default(true),
  createdAt: timestamp("created_at").defaultNow(),
});

// Time tracking entries
export const timeEntries = pgTable("time_entries", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").references(() => users.id).notNull(),
  locationId: varchar("location_id").references(() => workLocations.id),
  clockInTime: timestamp("clock_in_time").notNull(),
  clockOutTime: timestamp("clock_out_time"),
  breakMinutes: integer("break_minutes").default(0),
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

// Task/Chore status enum
export const taskStatusEnum = pgEnum("task_status", ["pending", "in_progress", "completed", "cancelled"]);

// Tasks/Chores
export const tasks = pgTable("tasks", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  title: varchar("title").notNull(),
  description: text("description"),
  assignedTo: varchar("assigned_to").references(() => users.id),
  createdBy: varchar("created_by").references(() => users.id).notNull(),
  locationId: varchar("location_id").references(() => workLocations.id),
  dueDate: timestamp("due_date"),
  estimatedMinutes: integer("estimated_minutes"),
  status: taskStatusEnum("status").default("pending"),
  isAIAssigned: boolean("is_ai_assigned").default(false),
  aiReasoning: text("ai_reasoning"),
  completedAt: timestamp("completed_at"),
  createdAt: timestamp("created_at").defaultNow(),
  // Chore management fields
  dayOfWeek: varchar("day_of_week"), // 'monday', 'tuesday', etc.
  timeOfDay: varchar("time_of_day"), // 'morning', 'afternoon'
  isRecurring: boolean("is_recurring").default(false),
  requiresSignature: boolean("requires_signature").default(false),
  employeeSignedAt: timestamp("employee_signed_at"),
  managerSignedAt: timestamp("manager_signed_at"),
  signedBy: varchar("signed_by").references(() => users.id),
  verifiedBy: varchar("verified_by").references(() => users.id),
  choreZone: varchar("chore_zone"), // 'zone 1', 'zone 2', etc.
  priority: varchar("priority").default("medium"), // 'low', 'medium', 'high'
  completionImageUrl: text("completion_image_url"),
}, (table) => [
  index("idx_tasks_assigned_to").on(table.assignedTo),
  index("idx_tasks_due_date").on(table.dueDate),
  index("idx_tasks_assigned_created").on(table.assignedTo, table.createdAt),
]);

// Chat groups for group messaging
export const chatGroups = pgTable("chat_groups", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: varchar("name").notNull(),
  description: text("description"),
  createdBy: varchar("created_by").references(() => users.id).notNull(),
  isActive: boolean("is_active").default(true),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Group members junction table
export const groupMembers = pgTable("group_members", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  groupId: varchar("group_id").references(() => chatGroups.id).notNull(),
  userId: varchar("user_id").references(() => users.id).notNull(),
  joinedAt: timestamp("joined_at").defaultNow(),
});

// Team messages/communication
export const messages = pgTable("messages", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  senderId: varchar("sender_id").references(() => users.id).notNull(),
  recipientId: varchar("recipient_id").references(() => users.id),
  groupId: varchar("group_id").references(() => chatGroups.id),
  content: text("content").notNull(),
  isAnnouncement: boolean("is_announcement").default(false),
  readBy: jsonb("read_by").$type<string[]>().default([]),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("idx_messages_sender_recipient").on(table.senderId, table.recipientId),
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

// Shoutouts for team recognition
export const shoutouts = pgTable("shoutouts", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  senderId: varchar("sender_id").references(() => users.id).notNull(),
  recipientId: varchar("recipient_id").references(() => users.id).notNull(),
  category: varchar("category").notNull(), // 'Great Attitude', 'Team Player', 'Above & Beyond', 'Problem Solver', 'Customer Hero'
  message: text("message").notNull(),
  emoji: varchar("emoji"),
  reactions: jsonb("reactions").$type<Array<{ userId: string; emoji: string }>>().default([]),
  createdAt: timestamp("created_at").defaultNow(),
});

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

// AI insights
export const aiInsights = pgTable("ai_insights", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  type: varchar("type").notNull(),
  userId: varchar("user_id").references(() => users.id),
  title: varchar("title").notNull(),
  description: text("description"),
  severity: varchar("severity").default("info"),
  isRead: boolean("is_read").default(false),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at").defaultNow(),
});

// Company settings
export const companySettings = pgTable("company_settings", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  storeId: varchar("store_id").references(() => workLocations.id),
  companyName: varchar("company_name").default("My Company"),
  timezone: varchar("timezone").default("America/New_York"),
  businessStartHour: integer("business_start_hour").default(8),
  businessEndHour: integer("business_end_hour").default(17),
  overtimeThresholdHours: integer("overtime_threshold_hours").default(40),
  overtimeMultiplier: decimal("overtime_multiplier", { precision: 3, scale: 2 }).default("1.50"),
  geofenceEnforcement: boolean("geofence_enforcement").default(false),
  breakDurationMinutes: integer("break_duration_minutes").default(30),
  autoClockOutMinutes: integer("auto_clock_out_minutes").default(480),
  updatedBy: varchar("updated_by").references(() => users.id),
  updatedAt: timestamp("updated_at").defaultNow(),
  locationPhone: varchar("location_phone"),
  address1: varchar("address_1"),
  address2: varchar("address_2"),
  city: varchar("city"),
  stateProvince: varchar("state_province"),
  zipCode: varchar("zip_code"),
  country: varchar("country").default("United States"),
  businessType: varchar("business_type"),
  businessCategory: varchar("business_category"),
  website: varchar("website"),
  accountOwnerName: varchar("account_owner_name"),
  companyPhone: varchar("company_phone"),
  workWeekStart: varchar("work_week_start").default("sunday"),
  schedulingStartTime: varchar("scheduling_start_time").default("09:00"),
  schedulingEndTime: varchar("scheduling_end_time").default("17:00"),
  lateThresholdMinutes: integer("late_threshold_minutes").default(5),
  preventEarlyClockIn: boolean("prevent_early_clock_in").default(false),
  earlyClockInMinutes: integer("early_clock_in_minutes").default(5),
  preventEarlyBreakReturn: boolean("prevent_early_break_return").default(false),
  singleClockOutReminder: boolean("single_clock_out_reminder").default(true),
  autoClockOutEnabled: boolean("auto_clock_out_enabled").default(false),
  autoClockOutAfterMinutes: text("auto_clock_out_after_minutes"),
  textScheduleToEmployees: boolean("text_schedule_to_employees").default(false),
  employeesViewOwnScheduleOnly: boolean("employees_view_own_schedule_only").default(false),
  notifyManagerLateClockIn: boolean("notify_manager_late_clock_in").default(true),
  managerLateAlertMinutes: integer("manager_late_alert_minutes").default(19),
  requireManagerApprovalAvailability: boolean("require_manager_approval_availability").default(true),
  managersScheduleOwnDept: boolean("managers_schedule_own_dept").default(false),
  requestShiftExperience: boolean("request_shift_experience").default(true),
  requireCashTipDeclaration: boolean("require_cash_tip_declaration").default(false),
  enableClockRounding: boolean("enable_clock_rounding").default(false),
  roundingIncrement: integer("rounding_increment").default(5),
  enableMobileTimeClock: boolean("enable_mobile_time_clock").default(true),
  allowUnscheduledMobileClockIn: boolean("allow_unscheduled_mobile_clock_in").default(false),
  enableWebTimeClock: boolean("enable_web_time_clock").default(false),
  allowEmployeeWebClock: boolean("allow_employee_web_clock").default(false),
  unscheduledShiftRoleSelection: boolean("unscheduled_shift_role_selection").default(false),
  enableDailyOvertime: boolean("enable_daily_overtime").default(false),
  dailyOvertimeHours: integer("daily_overtime_hours").default(8),
  dailyOvertimeMultiplier: decimal("daily_overtime_multiplier", { precision: 3, scale: 2 }).default("1.50"),
  enableWeeklyOvertime: boolean("enable_weekly_overtime").default(true),
  overtimeAlertEnabled: boolean("overtime_alert_enabled").default(false),
  overtimeAlertHours: integer("overtime_alert_hours").default(40),
  startOfWorkday: varchar("start_of_workday").default("00:00"),
  trackOvertimeAcrossLocations: boolean("track_overtime_across_locations").default(false),
  enableHolidayPayRate: boolean("enable_holiday_pay_rate").default(false),
  holidayPayMultiplier: decimal("holiday_pay_multiplier", { precision: 3, scale: 2 }).default("1.50"),
  breakRule1Enabled: boolean("break_rule_1_enabled").default(true),
  breakRule1Minutes: integer("break_rule_1_minutes").default(10),
  breakRule1Type: varchar("break_rule_1_type").default("paid"),
  breakRule1EveryHours: integer("break_rule_1_every_hours").default(4),
  breakRule1Required: varchar("break_rule_1_required").default("optional"),
  breakRule2Enabled: boolean("break_rule_2_enabled").default(true),
  breakRule2Minutes: integer("break_rule_2_minutes").default(30),
  breakRule2Type: varchar("break_rule_2_type").default("unpaid"),
  breakRule2EveryHours: integer("break_rule_2_every_hours").default(6),
  breakRule2Required: varchar("break_rule_2_required").default("optional"),
  subtractUnpaidBreaks: boolean("subtract_unpaid_breaks").default(true),
  convertExcessToUnpaid: boolean("convert_excess_to_unpaid").default(false),
  awardMissedBreakHours: boolean("award_missed_break_hours").default(false),
  missedBreakAwardHours: integer("missed_break_award_hours").default(1),
  missedBreakPolicy: varchar("missed_break_policy").default("managers_only"),
  payScheduleFrequency: varchar("pay_schedule_frequency").default("every_two_weeks"),
  nextPayrollDate: varchar("next_payroll_date"),
  lockTimesheetsAfterApproval: boolean("lock_timesheets_after_approval").default(false),
  timeOffMaxPerDay: integer("time_off_max_per_day"),
  timeOffAdvanceDays: integer("time_off_advance_days").default(0),
  limitTimeOffRequests: boolean("limit_time_off_requests").default(false),
  limitTimeOffAdvance: boolean("limit_time_off_advance").default(false),
  allowShoutOuts: boolean("allow_shout_outs").default(true),
  allowTeamMessaging: boolean("allow_team_messaging").default(true),
  enableScheduleEvents: boolean("enable_schedule_events").default(true),
  defaultGeofenceRadius: integer("default_geofence_radius").default(100),
  enableSmartClockPrompt: boolean("enable_smart_clock_prompt").default(false),
  enableClockOutOnFocusLoss: boolean("enable_clock_out_on_focus_loss").default(false),
  focusLossGraceSeconds: integer("focus_loss_grace_seconds").default(30),
  autoResumeWindowSeconds: integer("auto_resume_window_seconds").default(600),
  requireMobileClockIn: boolean("require_mobile_clock_in").default(false),
  defaultMileageRateCents: integer("default_mileage_rate_cents").default(0),
  version: integer("version").default(1).notNull(),
});

// Activity logs
export const activityLogs = pgTable("activity_logs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").references(() => users.id).notNull(),
  action: varchar("action").notNull(),
  targetType: varchar("target_type").notNull(),
  targetId: varchar("target_id"),
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

// Employee documents
export const employeeDocuments = pgTable("employee_documents", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").references(() => users.id).notNull(),
  category: varchar("category").notNull(),
  name: varchar("name").notNull(),
  fileName: varchar("file_name").notNull(),
  fileData: text("file_data").notNull(),
  fileType: varchar("file_type"),
  fileSize: integer("file_size"),
  uploadedBy: varchar("uploaded_by").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow(),
});

// Manager notes
export const managerNotes = pgTable("manager_notes", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").references(() => users.id).notNull(),
  managerId: varchar("manager_id").references(() => users.id).notNull(),
  note: text("note").notNull(),
  category: varchar("category").notNull(),
  isPrivate: boolean("is_private").default(false),
  createdAt: timestamp("created_at").defaultNow(),
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

// AI Chat
export const aiChatConversations = pgTable("ai_chat_conversations", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").references(() => users.id).notNull(),
  title: varchar("title").notNull(),
  context: jsonb("context"),
  lastMessageAt: timestamp("last_message_at").defaultNow(),
  createdAt: timestamp("created_at").defaultNow(),
});

export const aiChatMessages = pgTable("ai_chat_messages", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  conversationId: varchar("conversation_id").references(() => aiChatConversations.id).notNull(),
  role: varchar("role").notNull(),
  content: text("content").notNull(),
  sopReferences: text("sop_references").array(),
  createdAt: timestamp("created_at").defaultNow(),
});

export const aiFeedback = pgTable("ai_feedback", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  conversationId: varchar("conversation_id").references(() => aiChatConversations.id).notNull(),
  messageIndex: integer("message_index").notNull(),
  helpful: boolean("helpful").notNull(),
  feedbackText: text("feedback_text"),
  createdAt: timestamp("created_at").defaultNow(),
});

// Training modules
export const trainingModules = pgTable("training_modules", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  storeId: varchar("store_id").references(() => workLocations.id),
  title: varchar("title").notNull(),
  description: text("description"),
  content: text("content").notNull(),
  category: varchar("category"),
  estimatedMinutes: integer("estimated_minutes"),
  isActive: boolean("is_active").default(true),
  isRequired: boolean("is_required").default(false),
  sopDocumentIds: text("sop_document_ids").array(),
  createdAt: timestamp("created_at").defaultNow(),
});

// Employee training progress
export const employeeTrainingProgress = pgTable("employee_training_progress", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").references(() => users.id).notNull(),
  moduleId: varchar("module_id").references(() => trainingModules.id).notNull(),
  status: varchar("status").notNull().default("not_started"),
  completedAt: timestamp("completed_at"),
  score: integer("score"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Commute alerts
export const commuteAlerts = pgTable("commute_alerts", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").references(() => users.id).notNull(),
  type: varchar("type").notNull(),
  title: varchar("title").notNull(),
  message: text("message").notNull(),
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

// Geofence events
export const geofenceEvents = pgTable("geofence_events", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").references(() => users.id).notNull(),
  locationId: varchar("location_id").references(() => workLocations.id).notNull(),
  eventType: varchar("event_type", { length: 20 }).notNull(),
  latitude: decimal("latitude", { precision: 10, scale: 8 }),
  longitude: decimal("longitude", { precision: 11, scale: 8 }),
  distanceFromCenter: decimal("distance_from_center", { precision: 10, scale: 2 }),
  timeEntryId: varchar("time_entry_id").references(() => timeEntries.id),
  createdAt: timestamp("created_at").defaultNow(),
});

// AI Scheduling Settings
export const aiSchedulingSettings = pgTable("ai_scheduling_settings", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  shiftBlocks: jsonb("shift_blocks").default(sql`'[]'::jsonb`),
  staffingTiers: jsonb("staffing_tiers").default(sql`'[]'::jsonb`),
  minimumStaffing: integer("minimum_staffing").default(2),
  updatedBy: varchar("updated_by").references(() => users.id),
  updatedAt: timestamp("updated_at").defaultNow(),
  storeHours: jsonb("store_hours").default(sql`'[]'::jsonb`),
  shiftOverlapMinutes: integer("shift_overlap_minutes").default(60),
  overlapBudgetLimit: decimal("overlap_budget_limit", { precision: 10, scale: 2 }),
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

// Shopify Store table
export const shops = pgTable("shops", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  shopDomain: varchar("shop_domain").notNull().unique(),
  shopName: varchar("shop_name"),
  shopEmail: varchar("shop_email"),
  accessToken: varchar("access_token"),
  scope: varchar("scope"),
  currency: varchar("currency").default("USD"),
  timezone: varchar("timezone"),
  isActive: boolean("is_active").default(true),
  lastSyncAt: timestamp("last_sync_at"),
  installedAt: timestamp("installed_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
  companyId: varchar("company_id").references(() => companies.id),
}, (table) => [
  index("idx_shops_company_id").on(table.companyId),
]);

// User to Shop junction table — this is the authorization boundary for multi-tenancy.
// Every shop access must be verified through this table. A user can only see/manage
// shops they have an explicit link to.
export const userShops = pgTable("user_shops", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").references(() => users.id).notNull(),
  shopDomain: varchar("shop_domain").references(() => shops.shopDomain).notNull(),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  uniqueIndex("idx_user_shops_unique").on(table.userId, table.shopDomain),
]);

// Shopify Daily Sales
export const shopifyDailySales = pgTable("shopify_daily_sales", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  shopDomain: varchar("shop_domain").notNull(),
  date: timestamp("date").notNull(),
  dayOfWeek: integer("day_of_week"),
  orderCount: integer("order_count").default(0),
  totalRevenue: decimal("total_revenue", { precision: 12, scale: 2 }).default("0.00"),
  itemCount: integer("item_count").default(0),
  averageOrderValue: decimal("average_order_value", { precision: 10, scale: 2 }).default("0.00"),
  createdAt: timestamp("created_at").defaultNow(),
});

// Shopify Orders
export const shopifyOrders = pgTable("shopify_orders", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  shopDomain: varchar("shop_domain").notNull(),
  orderId: varchar("order_id").notNull(),
  orderNumber: varchar("order_number"),
  email: varchar("email"),
  totalPrice: decimal("total_price", { precision: 12, scale: 2 }),
  currency: varchar("currency"),
  financialStatus: varchar("financial_status"),
  fulfillmentStatus: varchar("fulfillment_status"),
  lineItems: jsonb("line_items"),
  customerData: jsonb("customer_data"),
  orderCreatedAt: timestamp("order_created_at"),
  processedAt: timestamp("processed_at"),
  syncedAt: timestamp("synced_at").defaultNow(),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("IDX_shopify_orders_shop_date").on(table.shopDomain, table.orderCreatedAt),
  index("IDX_shopify_orders_order_id").on(table.orderId),
]);

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

// Zod schemas
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

export const insertDiscrepancyResolutionSchema = createInsertSchema(discrepancyResolutions).omit({ id: true, resolvedAt: true });
export type DiscrepancyResolution = typeof discrepancyResolutions.$inferSelect;
export type InsertDiscrepancyResolution = z.infer<typeof insertDiscrepancyResolutionSchema>;

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
  // Trip receipt summary fields
  totalDistanceMiles: decimal("total_distance_miles", { precision: 8, scale: 2 }),
  deviationEventCount: integer("deviation_event_count").default(0),
  maxDeviationMiles: decimal("max_deviation_miles", { precision: 8, scale: 2 }),
  destinationReached: boolean("destination_reached"),
  reimbursementCents: integer("reimbursement_cents"),
  breadcrumbs: jsonb("breadcrumbs").$type<Array<{ lat: number; lng: number; ts: number }>>(),
  // Admin review fields
  reviewedBy: varchar("reviewed_by").references(() => users.id),
  reviewedAt: timestamp("reviewed_at"),
  adminNote: text("admin_note"),
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

export const insertUserSchema = createInsertSchema(users).omit({ id: true, createdAt: true, updatedAt: true });
export const insertTimeEntrySchema = createInsertSchema(timeEntries).omit({ id: true, createdAt: true });
export const insertScheduleSchema = createInsertSchema(schedules).omit({ id: true, createdAt: true });
export const insertTaskSchema = createInsertSchema(tasks).omit({ id: true, createdAt: true });
export const insertMessageSchema = createInsertSchema(messages).omit({ id: true, createdAt: true });
export const insertChatGroupSchema = createInsertSchema(chatGroups).omit({ id: true, createdAt: true, updatedAt: true });
export const insertGroupMemberSchema = createInsertSchema(groupMembers).omit({ id: true, joinedAt: true });
export const insertWorkLocationSchema = createInsertSchema(workLocations).omit({ id: true, createdAt: true });
export const insertPayrollPeriodSchema = createInsertSchema(payrollPeriods).omit({ id: true, createdAt: true });
export const insertUserAvailabilitySchema = createInsertSchema(userAvailability).omit({ id: true, createdAt: true });
export const insertTimeOffRequestSchema = createInsertSchema(timeOffRequests).omit({ id: true, createdAt: true });
export const insertPayPeriodSettingsSchema = createInsertSchema(payPeriodSettings).omit({ id: true, createdAt: true, updatedAt: true });
export const insertScheduleConfirmationSchema = createInsertSchema(scheduleConfirmations).omit({ id: true, createdAt: true });
export const insertWorkflowLogSchema = createInsertSchema(workflowLogs).omit({ id: true, createdAt: true });
export const insertPushSubscriptionSchema = createInsertSchema(pushSubscriptions).omit({ id: true, createdAt: true });
export const insertRoleSchema = createInsertSchema(roles).omit({ id: true, createdAt: true, updatedAt: true });
export const insertPermissionSchema = createInsertSchema(permissions).omit({ id: true, createdAt: true });
export const insertRolePermissionSchema = createInsertSchema(rolePermissions).omit({ id: true, createdAt: true });
export const insertCompanySettingsSchema = createInsertSchema(companySettings).omit({ id: true, updatedAt: true });
export const insertActivityLogSchema = createInsertSchema(activityLogs).omit({ id: true, createdAt: true });
export const insertClockEventSchema = createInsertSchema(clockEvents).omit({ id: true, createdAt: true });
export const insertPerformanceScoreSettingSchema = createInsertSchema(performanceScoreSettings).omit({ id: true, updatedAt: true });
export const insertEmployeeDocumentSchema = createInsertSchema(employeeDocuments).omit({ id: true, createdAt: true });
export const insertManagerNoteSchema = createInsertSchema(managerNotes).omit({ id: true, createdAt: true, updatedAt: true });
export const insertHolidayPayRuleSchema = createInsertSchema(holidayPayRules).omit({ id: true, createdAt: true });
export const insertSopCategorySchema = createInsertSchema(sopCategories).omit({ id: true, createdAt: true });
export const insertSopDocumentSchema = createInsertSchema(sopDocuments).omit({ id: true, createdAt: true, updatedAt: true });
export const insertAiChatConversationSchema = createInsertSchema(aiChatConversations).omit({ id: true, createdAt: true });
export const insertAiChatMessageSchema = createInsertSchema(aiChatMessages).omit({ id: true, createdAt: true });
export const insertAiFeedbackSchema = createInsertSchema(aiFeedback).omit({ id: true, createdAt: true });
export const insertTrainingModuleSchema = createInsertSchema(trainingModules).omit({ id: true, createdAt: true });
export const insertEmployeeTrainingProgressSchema = createInsertSchema(employeeTrainingProgress).omit({ id: true, createdAt: true, updatedAt: true });
export const insertCommuteAlertSchema = createInsertSchema(commuteAlerts).omit({ id: true, createdAt: true });
export const insertShoutoutSchema = createInsertSchema(shoutouts).omit({ id: true, createdAt: true });
export const insertAiSchedulingSettingsSchema = createInsertSchema(aiSchedulingSettings).omit({ id: true, updatedAt: true });
export const insertWorkPatternTemplateSchema = createInsertSchema(workPatternTemplates).omit({ id: true, createdAt: true });
export const insertUserWorkPatternSchema = createInsertSchema(userWorkPatterns).omit({ id: true, createdAt: true });
export const insertTimeEntryEditSchema = createInsertSchema(timeEntryEdits).omit({ id: true, editedAt: true });
export const insertOffsiteAllowanceRuleSchema = createInsertSchema(offsiteAllowanceRules).omit({ id: true, createdAt: true });
export const insertOffsiteSessionSchema = createInsertSchema(offsiteSessions).omit({ id: true });
export const insertOffsiteBreadcrumbSchema = createInsertSchema(offsiteBreadcrumbs).omit({ id: true });
export const insertOvertimeAlertSchema = createInsertSchema(overtimeAlerts).omit({ id: true, createdAt: true });
export const insertMileageReimbursementSchema = createInsertSchema(mileageReimbursements).omit({ id: true, appliedAt: true });

// Chore assignment and sign-off schemas
export const choreAssignmentSchema = z.object({
  choreId: z.string().uuid(),
  userId: z.string().uuid(),
});

export const choreSignOffSchema = z.object({
  choreId: z.string(),
  isManager: z.boolean().default(false),
});

export const insertSopTemplateSchema = createInsertSchema(sopTemplates).omit({ id: true, createdAt: true, updatedAt: true });
export const insertSopStepSchema = createInsertSchema(sopSteps).omit({ id: true, createdAt: true });
export const insertSopExecutionSchema = createInsertSchema(sopExecutions).omit({ id: true, createdAt: true, startedAt: true });
export const insertSopStepCompletionSchema = createInsertSchema(sopStepCompletions).omit({ id: true, createdAt: true });

export const insertCompanySchema = createInsertSchema(companies).omit({ id: true, createdAt: true });
export const insertShopSchema = createInsertSchema(shops).omit({ id: true, installedAt: true, updatedAt: true });
export const insertUserShopSchema = createInsertSchema(userShops).omit({ id: true, createdAt: true });
export const insertShopifyDailySalesSchema = createInsertSchema(shopifyDailySales).omit({ id: true, createdAt: true });
export const insertShopifyOrderSchema = createInsertSchema(shopifyOrders).omit({ id: true, syncedAt: true, createdAt: true, updatedAt: true });

// Types
export type User = typeof users.$inferSelect;
export type InsertUser = z.infer<typeof insertUserSchema>;
export type UpsertUser = InsertUser & { id: string };
export type TimeEntry = typeof timeEntries.$inferSelect;
export type InsertTimeEntry = z.infer<typeof insertTimeEntrySchema>;
export type Schedule = typeof schedules.$inferSelect;
export type InsertSchedule = z.infer<typeof insertScheduleSchema>;
export type Task = typeof tasks.$inferSelect;
export type InsertTask = z.infer<typeof insertTaskSchema>;
export type Message = typeof messages.$inferSelect;
export type InsertMessage = z.infer<typeof insertMessageSchema>;
export type ChatGroup = typeof chatGroups.$inferSelect;
export type InsertChatGroup = z.infer<typeof insertChatGroupSchema>;
export type GroupMember = typeof groupMembers.$inferSelect;
export type InsertGroupMember = z.infer<typeof insertGroupMemberSchema>;
export type WorkLocation = typeof workLocations.$inferSelect;
export type InsertWorkLocation = z.infer<typeof insertWorkLocationSchema>;
export type PayrollPeriod = typeof payrollPeriods.$inferSelect;
export type InsertPayrollPeriod = z.infer<typeof insertPayrollPeriodSchema>;
export type UserAvailability = typeof userAvailability.$inferSelect;
export type InsertUserAvailability = z.infer<typeof insertUserAvailabilitySchema>;
export type TimeOffRequest = typeof timeOffRequests.$inferSelect;
export type InsertTimeOffRequest = z.infer<typeof insertTimeOffRequestSchema>;
export type PayPeriodSettings = typeof payPeriodSettings.$inferSelect;
export type InsertPayPeriodSettings = z.infer<typeof insertPayPeriodSettingsSchema>;
export type ScheduleConfirmation = typeof scheduleConfirmations.$inferSelect;
export type InsertScheduleConfirmation = z.infer<typeof insertScheduleConfirmationSchema>;
export type WorkflowLog = typeof workflowLogs.$inferSelect;
export type InsertWorkflowLog = z.infer<typeof insertWorkflowLogSchema>;
export type AIInsight = typeof aiInsights.$inferSelect;
export type PushSubscription = typeof pushSubscriptions.$inferSelect;
export type InsertPushSubscription = z.infer<typeof insertPushSubscriptionSchema>;
export type Role = typeof roles.$inferSelect;
export type InsertRole = z.infer<typeof insertRoleSchema>;
export type MileageReimbursement = typeof mileageReimbursements.$inferSelect;
export type InsertMileageReimbursement = z.infer<typeof insertMileageReimbursementSchema>;
// Issue Tracker
export const issues = pgTable("issues", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  storeId: varchar("store_id").references(() => workLocations.id).notNull(),
  reportedBy: varchar("reported_by").notNull(),
  assignedTo: varchar("assigned_to"),
  title: text("title").notNull(),
  description: text("description"),
  category: varchar("category").notNull(),
  priority: varchar("priority").notNull().default("medium"),
  status: varchar("status").notNull().default("open"),
  photoUrl: text("photo_url"),
  resolutionNotes: text("resolution_notes"),
  relatedSopId: varchar("related_sop_id").references(() => sopTemplates.id),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  resolvedBy: varchar("resolved_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
}, (table) => [
  index("idx_issues_store_status_priority").on(table.storeId, table.status, table.priority),
  index("idx_issues_store_category_created").on(table.storeId, table.category, table.createdAt),
  index("idx_issues_store_assigned_status").on(table.storeId, table.assignedTo, table.status),
  index("idx_issues_reported_created").on(table.reportedBy, table.createdAt),
]);

export const issueComments = pgTable("issue_comments", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  issueId: varchar("issue_id").references(() => issues.id, { onDelete: "cascade" }).notNull(),
  authorId: varchar("author_id").notNull(),
  commentText: text("comment_text").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
}, (table) => [
  index("idx_issue_comments_issue_created").on(table.issueId, table.createdAt),
]);

export const insertIssueSchema = createInsertSchema(issues).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertIssueCommentSchema = createInsertSchema(issueComments).omit({
  id: true,
  createdAt: true,
});

// --- Daily Ritual System ---

export const morningHuddles = pgTable("morning_huddles", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  storeId: varchar("store_id").references(() => workLocations.id).notNull(),
  huddleDate: date("huddle_date").notNull(),
  ledBy: varchar("led_by"),
  attendees: jsonb("attendees").default([]),
  winOfTheDay: text("win_of_the_day"),
  leanPrinciple: text("lean_principle"),
  goals: jsonb("goals").default([]),
  headsUp: jsonb("heads_up").default([]),
  kudosSurfaced: jsonb("kudos_surfaced").default([]),
  aiGeneratedContent: jsonb("ai_generated_content"),
  status: text("status").notNull().default('pending'),
  startedAt: timestamp("started_at", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
}, (table) => [
  uniqueIndex("uq_morning_huddles_store_date").on(table.storeId, table.huddleDate),
  index("idx_morning_huddles_store_date").on(table.storeId, table.huddleDate),
]);

export const morningWhispers = pgTable("morning_whispers", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  storeId: text("store_id").notNull(),
  userId: text("user_id").notNull(),
  whisperDate: date("whisper_date").notNull(),
  content: jsonb("content").notNull(),
  listened: boolean("listened").default(false),
  listenedAt: timestamp("listened_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
}, (table) => [
  uniqueIndex("uq_morning_whispers_store_user_date").on(table.storeId, table.userId, table.whisperDate),
  index("idx_morning_whispers_user_date").on(table.userId, table.whisperDate),
]);

export const dailyDebriefs = pgTable("daily_debriefs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  storeId: varchar("store_id").references(() => workLocations.id).notNull(),
  employeeId: varchar("employee_id").notNull(),
  debriefDate: date("debrief_date").notNull(),
  whatWentWell: text("what_went_well"),
  whatBuggedYou: text("what_bugged_you"),
  whatBuggedYouCategory: text("what_bugged_you_category"),
  whatBuggedYouPhotoUrl: text("what_bugged_you_photo_url"),
  customerHighlights: text("customer_highlights"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
}, (table) => [
  uniqueIndex("uq_daily_debriefs_employee_date").on(table.employeeId, table.debriefDate),
  index("idx_daily_debriefs_store_date").on(table.storeId, table.debriefDate),
  index("idx_daily_debriefs_employee_date").on(table.employeeId, table.debriefDate),
  index("idx_daily_debriefs_store_category_created").on(table.storeId, table.whatBuggedYouCategory, table.createdAt),
]);

export const dailyQuotes = pgTable("daily_quotes", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  storeId: varchar("store_id").references(() => workLocations.id).notNull(),
  quoteDate: date("quote_date").notNull(),
  quoteText: text("quote_text").notNull(),
  quoteAuthor: text("quote_author").notNull(),
  generatedByAi: boolean("generated_by_ai").default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
}, (table) => [
  uniqueIndex("uq_daily_quotes_store_date").on(table.storeId, table.quoteDate),
]);

export const dailyQuoteHistory = pgTable("daily_quote_history", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  storeId: varchar("store_id").references(() => workLocations.id).notNull(),
  quoteTextHash: text("quote_text_hash").notNull(),
  usedDate: date("used_date").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
}, (table) => [
  index("idx_daily_quote_history_store_hash").on(table.storeId, table.quoteTextHash),
]);

export const kudos = pgTable("kudos", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  storeId: varchar("store_id").references(() => workLocations.id).notNull(),
  fromEmployeeId: varchar("from_employee_id").notNull(),
  toEmployeeId: varchar("to_employee_id").notNull(),
  message: text("message").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
}, (table) => [
  index("idx_kudos_store_created").on(table.storeId, table.createdAt),
  index("idx_kudos_to_employee_created").on(table.toEmployeeId, table.createdAt),
]);

export const middayPulses = pgTable("midday_pulses", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  storeId: varchar("store_id").references(() => workLocations.id).notNull(),
  pulseDate: date("pulse_date").notNull(),
  data: jsonb("data").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
}, (table) => [
  uniqueIndex("uq_midday_pulses_store_date").on(table.storeId, table.pulseDate),
]);

export const insertMiddayPulseSchema = createInsertSchema(middayPulses).omit({
  id: true,
  createdAt: true,
});
export type MiddayPulse = typeof middayPulses.$inferSelect;
export type InsertMiddayPulse = z.infer<typeof insertMiddayPulseSchema>;

export const insertMorningHuddleSchema = createInsertSchema(morningHuddles).omit({
  id: true,
  createdAt: true,
});

export const insertMorningWhisperSchema = createInsertSchema(morningWhispers).omit({ id: true, createdAt: true });
export const insertDailyDebriefSchema = createInsertSchema(dailyDebriefs).omit({
  id: true,
  createdAt: true,
});

export const insertDailyQuoteSchema = createInsertSchema(dailyQuotes).omit({
  id: true,
  createdAt: true,
});

export const insertDailyQuoteHistorySchema = createInsertSchema(dailyQuoteHistory).omit({
  id: true,
  createdAt: true,
});

export const insertKudoSchema = createInsertSchema(kudos).omit({
  id: true,
  createdAt: true,
});

// --- Type Exports ---

export type MorningHuddle = typeof morningHuddles.$inferSelect;
export type InsertMorningHuddle = z.infer<typeof insertMorningHuddleSchema>;
export type MorningWhisper = typeof morningWhispers.$inferSelect;
export type InsertMorningWhisper = z.infer<typeof insertMorningWhisperSchema>;
export type DailyDebrief = typeof dailyDebriefs.$inferSelect;
export type InsertDailyDebrief = z.infer<typeof insertDailyDebriefSchema>;
export type DailyQuote = typeof dailyQuotes.$inferSelect;
export type InsertDailyQuote = z.infer<typeof insertDailyQuoteSchema>;
export type DailyQuoteHistory = typeof dailyQuoteHistory.$inferSelect;
export type InsertDailyQuoteHistory = z.infer<typeof insertDailyQuoteHistorySchema>;
export type Kudo = typeof kudos.$inferSelect;
export type InsertKudo = z.infer<typeof insertKudoSchema>;

export type Issue = typeof issues.$inferSelect;
export type InsertIssue = z.infer<typeof insertIssueSchema>;
export type IssueComment = typeof issueComments.$inferSelect;
export type InsertIssueComment = z.infer<typeof insertIssueCommentSchema>;

export type Permission = typeof permissions.$inferSelect;
export type InsertPermission = z.infer<typeof insertPermissionSchema>;
export type RolePermission = typeof rolePermissions.$inferSelect;
export type InsertRolePermission = z.infer<typeof insertRolePermissionSchema>;
export type UserWithRole = User & { role?: Role };
export type CompanySettings = typeof companySettings.$inferSelect;
export type InsertCompanySettings = z.infer<typeof insertCompanySettingsSchema>;
export type ActivityLog = typeof activityLogs.$inferSelect;
export type InsertActivityLog = z.infer<typeof insertActivityLogSchema>;
export type ClockEvent = typeof clockEvents.$inferSelect;
export type InsertClockEvent = z.infer<typeof insertClockEventSchema>;
export type PerformanceScoreSetting = typeof performanceScoreSettings.$inferSelect;
export type InsertPerformanceScoreSetting = z.infer<typeof insertPerformanceScoreSettingSchema>;
export type EmployeeDocument = typeof employeeDocuments.$inferSelect;
export type InsertEmployeeDocument = z.infer<typeof insertEmployeeDocumentSchema>;
export type ManagerNote = typeof managerNotes.$inferSelect;
export type InsertManagerNote = z.infer<typeof insertManagerNoteSchema>;
export type HolidayPayRule = typeof holidayPayRules.$inferSelect;
export type InsertHolidayPayRule = z.infer<typeof insertHolidayPayRuleSchema>;
export type SopCategory = typeof sopCategories.$inferSelect;
export type InsertSopCategory = z.infer<typeof insertSopCategorySchema>;
export type SopDocument = typeof sopDocuments.$inferSelect;
export type InsertSopDocument = z.infer<typeof insertSopDocumentSchema>;
export type AiChatConversation = typeof aiChatConversations.$inferSelect;
export type InsertAiChatConversation = z.infer<typeof insertAiChatConversationSchema>;
export type AiChatMessage = typeof aiChatMessages.$inferSelect;
export type InsertAiChatMessage = z.infer<typeof insertAiChatMessageSchema>;
export type AiFeedback = typeof aiFeedback.$inferSelect;
export type InsertAiFeedback = z.infer<typeof insertAiFeedbackSchema>;
export type TrainingModule = typeof trainingModules.$inferSelect;
export type InsertTrainingModule = z.infer<typeof insertTrainingModuleSchema>;
export type EmployeeTrainingProgress = typeof employeeTrainingProgress.$inferSelect;
export type InsertEmployeeTrainingProgress = z.infer<typeof insertEmployeeTrainingProgressSchema>;
export type CommuteAlert = typeof commuteAlerts.$inferSelect;
export type InsertCommuteAlert = z.infer<typeof insertCommuteAlertSchema>;
export type Shoutout = typeof shoutouts.$inferSelect;
export type InsertShoutout = z.infer<typeof insertShoutoutSchema>;
export type GeofenceEvent = typeof geofenceEvents.$inferSelect;
export type TimeEntryEdit = typeof timeEntryEdits.$inferSelect;
export type InsertTimeEntryEdit = z.infer<typeof insertTimeEntryEditSchema>;
export type OffsiteAllowanceRule = typeof offsiteAllowanceRules.$inferSelect;
export type InsertOffsiteAllowanceRule = z.infer<typeof insertOffsiteAllowanceRuleSchema>;
export type OffsiteSession = typeof offsiteSessions.$inferSelect;
export type InsertOffsiteSession = z.infer<typeof insertOffsiteSessionSchema>;
export type OffsiteBreadcrumb = typeof offsiteBreadcrumbs.$inferSelect;
export type InsertOffsiteBreadcrumb = z.infer<typeof insertOffsiteBreadcrumbSchema>;
export type OvertimeAlert = typeof overtimeAlerts.$inferSelect;
export type InsertOvertimeAlert = z.infer<typeof insertOvertimeAlertSchema>;
export type SopTemplate = typeof sopTemplates.$inferSelect;
export type InsertSopTemplate = z.infer<typeof insertSopTemplateSchema>;
export type SopStep = typeof sopSteps.$inferSelect;
export type InsertSopStep = z.infer<typeof insertSopStepSchema>;
export type SopExecution = typeof sopExecutions.$inferSelect;
export type InsertSopExecution = z.infer<typeof insertSopExecutionSchema>;
export type SopStepCompletion = typeof sopStepCompletions.$inferSelect;
export type InsertSopStepCompletion = z.infer<typeof insertSopStepCompletionSchema>;
export type Company = typeof companies.$inferSelect;
export type InsertCompany = z.infer<typeof insertCompanySchema>;
export type Shop = typeof shops.$inferSelect;
export type UserShop = typeof userShops.$inferSelect;
export type ShopifyDailySale = typeof shopifyDailySales.$inferSelect;
export type ShopifyOrder = typeof shopifyOrders.$inferSelect;

export const improvementVideos = pgTable("improvement_videos", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  storeId: text("store_id").notNull(),
  employeeId: text("employee_id").notNull(),
  title: text("title").notNull(),
  description: text("description"),
  category: text("category").notNull(),
  storageType: text("storage_type").notNull(),
  youtubeVideoId: text("youtube_video_id"),
  s3Key: text("s3_key"),
  s3Url: text("s3_url"),
  thumbnailUrl: text("thumbnail_url"),
  durationSeconds: integer("duration_seconds"),
  status: text("status").notNull().default("processing"),
  isFeatured: boolean("is_featured").default(false),
  viewCount: integer("view_count").default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
}, (table) => [
  index("idx_improvement_videos_store_created").on(table.storeId, table.createdAt),
  index("idx_improvement_videos_store_status_cat").on(table.storeId, table.status, table.category),
  index("idx_improvement_videos_employee_created").on(table.employeeId, table.createdAt),
  index("idx_improvement_videos_store_featured").on(table.storeId, table.isFeatured),
]);

export const videoLikes = pgTable("video_likes", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  videoId: varchar("video_id").notNull(),
  employeeId: text("employee_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
}, (table) => [
  unique("uq_video_likes_video_employee").on(table.videoId, table.employeeId),
  index("idx_video_likes_video").on(table.videoId),
  index("idx_video_likes_employee").on(table.employeeId),
]);

export const videoComments = pgTable("video_comments", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  videoId: varchar("video_id").notNull(),
  employeeId: text("employee_id").notNull(),
  commentText: text("comment_text").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
}, (table) => [
  index("idx_video_comments_video_created").on(table.videoId, table.createdAt),
]);

export const insertImprovementVideoSchema = createInsertSchema(improvementVideos).omit({
  id: true,
  createdAt: true,
  viewCount: true,
  isFeatured: true,
  status: true,
});
export const insertVideoLikeSchema = createInsertSchema(videoLikes).omit({
  id: true,
  createdAt: true,
});
export const insertVideoCommentSchema = createInsertSchema(videoComments).omit({
  id: true,
  createdAt: true,
});

export type ImprovementVideo = typeof improvementVideos.$inferSelect;
export type InsertImprovementVideo = z.infer<typeof insertImprovementVideoSchema>;
export type VideoLike = typeof videoLikes.$inferSelect;
export type InsertVideoLike = z.infer<typeof insertVideoLikeSchema>;
export type VideoComment = typeof videoComments.$inferSelect;
export type InsertVideoComment = z.infer<typeof insertVideoCommentSchema>;

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

export const insertGtdInboxItemSchema = createInsertSchema(gtdInboxItems).omit({ id: true, createdAt: true, updatedAt: true });
export const insertGtdProjectSchema = createInsertSchema(gtdProjects).omit({ id: true, createdAt: true, updatedAt: true });
export const insertGtdNextActionSchema = createInsertSchema(gtdNextActions).omit({ id: true, createdAt: true, updatedAt: true });
export const insertGtdWaitingForSchema = createInsertSchema(gtdWaitingFor).omit({ id: true, createdAt: true, updatedAt: true });
export const insertGtdSomedayMaybeSchema = createInsertSchema(gtdSomedayMaybe).omit({ id: true, createdAt: true, updatedAt: true });
export const insertGtdReferenceSchema = createInsertSchema(gtdReference).omit({ id: true, createdAt: true, updatedAt: true });

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

export const insertWeeklyReviewSchema = createInsertSchema(weeklyReviews).omit({ id: true, createdAt: true });
export type WeeklyReview = typeof weeklyReviews.$inferSelect;
export type InsertWeeklyReview = z.infer<typeof insertWeeklyReviewSchema>;

export const messageThreads = pgTable("message_threads", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  storeId: text("store_id").notNull(),
  threadType: text("thread_type").notNull(),
  title: text("title"),
  createdBy: text("created_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
}, (table) => [
  index("idx_message_threads_store_updated").on(table.storeId, table.updatedAt),
]);

export const threadParticipants = pgTable("thread_participants", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  threadId: varchar("thread_id").notNull(),
  userId: text("user_id").notNull(),
  lastReadAt: timestamp("last_read_at", { withTimezone: true }),
  joinedAt: timestamp("joined_at", { withTimezone: true }).defaultNow(),
}, (table) => [
  unique("uq_thread_participant").on(table.threadId, table.userId),
  index("idx_thread_participants_user").on(table.userId, table.threadId),
  index("idx_thread_participants_thread").on(table.threadId),
]);

export const threadMessages = pgTable("thread_messages", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  threadId: varchar("thread_id").notNull(),
  senderId: text("sender_id").notNull(),
  content: text("content").notNull(),
  messageType: text("message_type").notNull().default("text"),
  imageUrl: text("image_url"),
  replyToId: varchar("reply_to_id"),
  editedAt: timestamp("edited_at", { withTimezone: true }),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
}, (table) => [
  index("idx_thread_messages_thread_created").on(table.threadId, table.createdAt),
  index("idx_thread_messages_sender").on(table.senderId, table.createdAt),
]);

export const insertMessageThreadSchema = createInsertSchema(messageThreads).omit({ id: true, createdAt: true, updatedAt: true });
export type MessageThread = typeof messageThreads.$inferSelect;
export type InsertMessageThread = z.infer<typeof insertMessageThreadSchema>;

export const insertThreadParticipantSchema = createInsertSchema(threadParticipants).omit({ id: true, joinedAt: true });
export type ThreadParticipant = typeof threadParticipants.$inferSelect;
export type InsertThreadParticipant = z.infer<typeof insertThreadParticipantSchema>;

export const insertThreadMessageSchema = createInsertSchema(threadMessages).omit({ id: true, createdAt: true, editedAt: true, deletedAt: true });
export type ThreadMessage = typeof threadMessages.$inferSelect;
export type InsertThreadMessage = z.infer<typeof insertThreadMessageSchema>;

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

export type SopEmbedding = typeof sopEmbeddings.$inferSelect;

export const leanBoardSnapshots = pgTable("lean_board_snapshots", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  storeId: text("store_id").notNull(),
  snapshotDate: date("snapshot_date").notNull(),
  metrics: jsonb("metrics").notNull(),
  aiSummary: text("ai_summary"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
}, (table) => [
  uniqueIndex("uq_lean_board_store_date").on(table.storeId, table.snapshotDate),
  index("idx_lean_board_store_date").on(table.storeId, table.snapshotDate),
]);

export const insertLeanBoardSnapshotSchema = createInsertSchema(leanBoardSnapshots).omit({ id: true, createdAt: true });
export type LeanBoardSnapshot = typeof leanBoardSnapshots.$inferSelect;
export type InsertLeanBoardSnapshot = z.infer<typeof insertLeanBoardSnapshotSchema>;

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

export const insertSopInsightSchema = createInsertSchema(sopInsights).omit({ id: true, createdAt: true });
export type SopInsight = typeof sopInsights.$inferSelect;
export type InsertSopInsight = z.infer<typeof insertSopInsightSchema>;

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

export const insertSopRevisionProposalSchema = createInsertSchema(sopRevisionProposals).omit({ id: true, createdAt: true });
export type SopRevisionProposal = typeof sopRevisionProposals.$inferSelect;
export type InsertSopRevisionProposal = z.infer<typeof insertSopRevisionProposalSchema>;

export const backgroundInsights = pgTable("background_insights", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  storeId: text("store_id").notNull(),
  insightType: text("insight_type").notNull(),
  severity: text("severity").notNull().default("info"),
  headline: text("headline").notNull(),
  detail: text("detail").notNull(),
  recommendation: text("recommendation").notNull(),
  dataPayload: jsonb("data_payload"),
  status: text("status").notNull().default("active"),
  acknowledgedBy: text("acknowledged_by"),
  actedOnAt: timestamp("acted_on_at", { withTimezone: true }),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
}, (table) => [
  index("idx_bg_insights_store_status_sev").on(table.storeId, table.status, table.severity, table.createdAt),
  index("idx_bg_insights_store_type").on(table.storeId, table.insightType, table.createdAt),
]);

export const insertBackgroundInsightSchema = createInsertSchema(backgroundInsights).omit({ id: true, createdAt: true });
export type BackgroundInsight = typeof backgroundInsights.$inferSelect;
export type InsertBackgroundInsight = z.infer<typeof insertBackgroundInsightSchema>;

// Cash Management - Drawer Sessions
export const drawerSessions = pgTable("drawer_sessions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  storeId: text("store_id").notNull(),
  sessionDate: text("session_date").notNull(),
  sessionType: text("session_type").notNull(),
  registerName: text("register_name").notNull(),
  registerId: text("register_id"),
  status: text("status").notNull().default("pending"),
  countedBy: varchar("counted_by"),
  countedAt: timestamp("counted_at", { withTimezone: true }),
  verifiedBy: varchar("verified_by"),
  verifiedAt: timestamp("verified_at", { withTimezone: true }),
  startingCash: decimal("starting_cash", { precision: 10, scale: 2 }).default("200.00"),
  hundredCount: integer("hundred_count"),
  fiftyCount: integer("fifty_count"),
  twentyCount: integer("twenty_count"),
  tenCount: integer("ten_count"),
  fiveCount: integer("five_count"),
  oneCount: integer("one_count"),
  rolledQuarterCount: integer("rolled_quarter_count"),
  rolledDimeCount: integer("rolled_dime_count"),
  rolledNickelCount: integer("rolled_nickel_count"),
  rolledPennyCount: integer("rolled_penny_count"),
  pennyCount: integer("penny_count"),
  nickelCount: integer("nickel_count"),
  dimeCount: integer("dime_count"),
  quarterCount: integer("quarter_count"),
  totalCashCounted: decimal("total_cash_counted", { precision: 10, scale: 2 }),
  expectedCash: decimal("expected_cash", { precision: 10, scale: 2 }),
  overShortAmount: decimal("over_short_amount", { precision: 10, scale: 2 }),
  overShortExplanation: text("over_short_explanation"),
  registerCashSales: decimal("register_cash_sales", { precision: 10, scale: 2 }),
  registerTotalSales: decimal("register_total_sales", { precision: 10, scale: 2 }),
  registerShopifyPayments: decimal("register_shopify_payments", { precision: 10, scale: 2 }),
  recountAttempts: integer("recount_attempts").default(0),
  recountHistory: jsonb("recount_history"),
  employeesOnDuty: jsonb("employees_on_duty"),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
}, (table) => [
  index("idx_drawer_sessions_store_date").on(table.storeId, table.sessionDate),
  index("idx_drawer_sessions_store_status").on(table.storeId, table.status),
  index("idx_drawer_sessions_counted_by").on(table.countedBy),
]);

export const insertDrawerSessionSchema = createInsertSchema(drawerSessions).omit({ id: true, createdAt: true });
export type DrawerSession = typeof drawerSessions.$inferSelect;
export type InsertDrawerSession = z.infer<typeof insertDrawerSessionSchema>;

// Cash Management - Deposits
export const cashDeposits = pgTable("cash_deposits", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  storeId: text("store_id").notNull(),
  depositDate: text("deposit_date").notNull(),
  depositedBy: varchar("deposited_by"),
  depositedAt: timestamp("deposited_at", { withTimezone: true }),
  expectedAmount: decimal("expected_amount", { precision: 10, scale: 2 }),
  actualAmount: decimal("actual_amount", { precision: 10, scale: 2 }),
  depositSlipPhoto: text("deposit_slip_photo"),
  registerSummaryPhoto: text("register_summary_photo"),
  drawerSummaryPhoto: text("drawer_summary_photo"),
  aiExtractedAmount: decimal("ai_extracted_amount", { precision: 10, scale: 2 }),
  aiConfidence: text("ai_confidence"),
  aiAnalysis: text("ai_analysis"),
  discrepancyAmount: decimal("discrepancy_amount", { precision: 10, scale: 2 }),
  discrepancyExplanation: text("discrepancy_explanation"),
  status: text("status").notNull().default("pending"),
  reviewedBy: varchar("reviewed_by"),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
  reviewNotes: text("review_notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
}, (table) => [
  index("idx_cash_deposits_store_date").on(table.storeId, table.depositDate),
  index("idx_cash_deposits_store_status").on(table.storeId, table.status),
]);

export const insertCashDepositSchema = createInsertSchema(cashDeposits).omit({ id: true, createdAt: true });
export type CashDeposit = typeof cashDeposits.$inferSelect;
export type InsertCashDeposit = z.infer<typeof insertCashDepositSchema>;

// Cash Management - Settings
export const cashManagementSettings = pgTable("cash_management_settings", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  storeId: text("store_id").notNull().unique(),
  defaultStartingCash: decimal("default_starting_cash", { precision: 10, scale: 2 }).default("200.00"),
  registers: jsonb("registers"),
  overShortThreshold: decimal("over_short_threshold", { precision: 10, scale: 2 }).default("5.00"),
  requireDepositPhoto: boolean("require_deposit_photo").default(true),
  requireOverShortExplanation: boolean("require_over_short_explanation").default(true),
  autoFlagThreshold: decimal("auto_flag_threshold", { precision: 10, scale: 2 }).default("20.00"),
  closingTime: text("closing_time"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});

export const insertCashManagementSettingsSchema = createInsertSchema(cashManagementSettings).omit({ id: true, createdAt: true, updatedAt: true });
export type CashManagementSettings = typeof cashManagementSettings.$inferSelect;
export type InsertCashManagementSettings = z.infer<typeof insertCashManagementSettingsSchema>;

// Cash Management - Discrepancy Log (for AI investigation)
export const cashDiscrepancyLog = pgTable("cash_discrepancy_log", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  storeId: text("store_id").notNull(),
  drawerSessionId: varchar("drawer_session_id"),
  sessionDate: text("session_date").notNull(),
  registerName: text("register_name").notNull(),
  sessionType: text("session_type").notNull(),
  countedBy: varchar("counted_by"),
  amount: decimal("amount", { precision: 10, scale: 2 }).notNull(),
  explanation: text("explanation"),
  employeesOnDuty: jsonb("employees_on_duty"),
  openedBy: varchar("opened_by"),
  previousClosedBy: varchar("previous_closed_by"),
  aiFlags: jsonb("ai_flags"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
}, (table) => [
  index("idx_cash_discrepancy_store_date").on(table.storeId, table.sessionDate),
  index("idx_cash_discrepancy_counted_by").on(table.countedBy),
  index("idx_cash_discrepancy_store_created").on(table.storeId, table.createdAt),
]);

export const insertCashDiscrepancyLogSchema = createInsertSchema(cashDiscrepancyLog).omit({ id: true, createdAt: true });
export type CashDiscrepancyLog = typeof cashDiscrepancyLog.$inferSelect;
export type InsertCashDiscrepancyLog = z.infer<typeof insertCashDiscrepancyLogSchema>;

export const scoreHistory = pgTable("score_history", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").references(() => users.id).notNull(),
  snapshotDate: date("snapshot_date").notNull(),
  overallScore: integer("overall_score").notNull().default(0),
  attendanceScore: integer("attendance_score").notNull().default(0),
  taskScore: integer("task_score").notNull().default(0),
  sopScore: integer("sop_score").notNull().default(0),
  engagementScore: integer("engagement_score").notNull().default(0),
  tier: varchar("tier").notNull().default('bronze'),
  rank: integer("rank"),
  totalPoints: integer("total_points").default(0),
  streakDays: integer("streak_days").default(0),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("idx_score_history_user_date").on(table.userId, table.snapshotDate),
  uniqueIndex("uq_score_history_user_date").on(table.userId, table.snapshotDate),
]);

export const gamificationSettings = pgTable("gamification_settings", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  storeId: varchar("store_id"),
  tierThresholds: jsonb("tier_thresholds").default({
    bronze: 0, silver: 40, gold: 60, platinum: 80, diamond: 95
  }),
  prizeDescriptions: jsonb("prize_descriptions").default({
    gold: "Free lunch this month!",
    platinum: "Gift card reward",
    diamond: "Employee of the month recognition"
  }),
  categoryWeights: jsonb("category_weights").default({
    attendance: 30, tasks: 30, sops: 20, engagement: 20
  }),
  scoreNotificationsEnabled: boolean("score_notifications_enabled").default(true),
  updatedBy: varchar("updated_by").references(() => users.id),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const userAchievements = pgTable("user_achievements", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").references(() => users.id).notNull(),
  achievementKey: varchar("achievement_key").notNull(),
  achievementName: varchar("achievement_name").notNull(),
  achievementDescription: varchar("achievement_description"),
  achievementIcon: varchar("achievement_icon"),
  earnedAt: timestamp("earned_at").defaultNow(),
}, (table) => [
  index("idx_user_achievements_user").on(table.userId),
  uniqueIndex("uq_user_achievements_user_key").on(table.userId, table.achievementKey),
]);

export type ScoreHistory = typeof scoreHistory.$inferSelect;
export type GamificationSettings = typeof gamificationSettings.$inferSelect;
export type UserAchievement = typeof userAchievements.$inferSelect;

export const scoreNotices = pgTable("score_notices", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").references(() => users.id).notNull(),
  category: varchar("category").notNull(),
  severity: varchar("severity").notNull().default("info"),
  message: text("message").notNull(),
  isRead: boolean("is_read").default(false),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("idx_score_notices_user").on(table.userId),
  uniqueIndex("uq_score_notices_user_category").on(table.userId, table.category),
]);

export const insertScoreNoticeSchema = createInsertSchema(scoreNotices).omit({ id: true, createdAt: true });
export type InsertScoreNotice = z.infer<typeof insertScoreNoticeSchema>;
export type ScoreNotice = typeof scoreNotices.$inferSelect;

// ── Meeting Intelligence ────────────────────────────────────────────

export const meetingStatusEnum = pgEnum("meeting_status", ["recording", "processing", "ready", "failed"]);
export const meetingTaskRecommendationStatusEnum = pgEnum("meeting_task_recommendation_status", ["pending", "accepted", "rejected"]);

export const meetings = pgTable("meetings", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  storeId: varchar("store_id").references(() => workLocations.id).notNull(),
  createdBy: varchar("created_by").references(() => users.id).notNull(),
  title: varchar("title").notNull(),
  date: timestamp("date").notNull(),
  durationSeconds: integer("duration_seconds"),
  audioUrl: text("audio_url"),
  transcript: text("transcript"),
  synopsis: jsonb("synopsis"),
  status: meetingStatusEnum("status").default("recording"),
  participantIds: text("participant_ids").array().default([]),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("idx_meetings_store_created").on(table.storeId, table.createdAt),
  index("idx_meetings_created_by").on(table.createdBy),
]);

export const insertMeetingSchema = createInsertSchema(meetings).omit({ id: true, createdAt: true, updatedAt: true });
export type Meeting = typeof meetings.$inferSelect;
export type InsertMeeting = z.infer<typeof insertMeetingSchema>;

export const meetingTaskRecommendations = pgTable("meeting_task_recommendations", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  meetingId: varchar("meeting_id").references(() => meetings.id, { onDelete: "cascade" }).notNull(),
  description: text("description").notNull(),
  context: text("context"),
  priority: varchar("priority").notNull().default("medium"),
  assigneeId: varchar("assignee_id").references(() => users.id),
  status: meetingTaskRecommendationStatusEnum("status").default("pending"),
  gtdInboxItemId: varchar("gtd_inbox_item_id"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("idx_meeting_task_recs_meeting_id").on(table.meetingId),
]);

export const insertMeetingTaskRecommendationSchema = createInsertSchema(meetingTaskRecommendations).omit({ id: true, createdAt: true, updatedAt: true });
export type MeetingTaskRecommendation = typeof meetingTaskRecommendations.$inferSelect;
export type InsertMeetingTaskRecommendation = z.infer<typeof insertMeetingTaskRecommendationSchema>;

// ── AI Learning Center ────────────────────────────────────────────

export const knowledgeDocumentTypeEnum = pgEnum("knowledge_document_type", [
  "policy_manual",
  "sales_script",
  "sales_training",
  "style_guide",
  "operations_reference",
  "other",
]);

export const knowledgeProcessingStatusEnum = pgEnum("knowledge_processing_status", [
  "pending",
  "processing",
  "ready",
  "failed",
]);

export const knowledgeDocuments = pgTable("knowledge_documents", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  storeId: varchar("store_id").references(() => workLocations.id),
  uploadedByUserId: varchar("uploaded_by_user_id").references(() => users.id).notNull(),
  originalFileName: varchar("original_file_name").notNull(),
  fileType: varchar("file_type").notNull(),
  rawContent: text("raw_content"),
  extractedText: text("extracted_text"),
  summaryFromClaude: text("summary_from_claude"),
  documentType: knowledgeDocumentTypeEnum("document_type").default("other"),
  autoTags: text("auto_tags").array().default([]),
  processingStatus: knowledgeProcessingStatusEnum("processing_status").default("pending"),
  errorMessage: text("error_message"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("idx_knowledge_docs_store_status").on(table.storeId, table.processingStatus),
  index("idx_knowledge_docs_store_created").on(table.storeId, table.createdAt),
]);

export const insertKnowledgeDocumentSchema = createInsertSchema(knowledgeDocuments).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertKnowledgeDocument = z.infer<typeof insertKnowledgeDocumentSchema>;
export type KnowledgeDocument = typeof knowledgeDocuments.$inferSelect;

// ── Phase 3: Interactive Training System ─────────────────────────────────────

// Training lessons (sub-steps within a training module)
export const trainingLessons = pgTable("training_lessons", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  moduleId: varchar("module_id").references(() => trainingModules.id, { onDelete: "cascade" }).notNull(),
  type: varchar("type").notNull(), // 'concept' | 'script_practice' | 'scenario' | 'quiz'
  title: varchar("title").notNull(),
  contentJson: jsonb("content_json").notNull().$type<Record<string, unknown>>(),
  orderIndex: integer("order_index").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("idx_training_lessons_module_order").on(table.moduleId, table.orderIndex),
]);

// Training questions (for scenario/script_practice/quiz lessons)
export const trainingQuestions = pgTable("training_questions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  lessonId: varchar("lesson_id").references(() => trainingLessons.id, { onDelete: "cascade" }).notNull(),
  questionText: text("question_text").notNull(),
  answerChoices: jsonb("answer_choices").notNull().$type<string[]>(),
  correctAnswerIndex: integer("correct_answer_index").notNull(),
  coachingText: text("coaching_text"),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("idx_training_questions_lesson").on(table.lessonId),
]);

// Spaced-repetition practice schedule per employee/question
export const trainingPracticeSchedule = pgTable("training_practice_schedule", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  employeeId: varchar("employee_id").references(() => users.id).notNull(),
  questionId: varchar("question_id").references(() => trainingQuestions.id).notNull(),
  nextReviewAt: timestamp("next_review_at").notNull(),
  intervalDays: integer("interval_days").notNull().default(1),
  lastResult: varchar("last_result"), // 'correct' | 'incorrect'
  lastAnsweredAt: timestamp("last_answered_at"),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("idx_practice_schedule_employee_review").on(table.employeeId, table.nextReviewAt),
  unique("uq_practice_schedule_employee_question").on(table.employeeId, table.questionId),
]);

// Per-lesson completion tracking
export const trainingLessonProgress = pgTable("training_lesson_progress", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  employeeId: varchar("employee_id").references(() => users.id).notNull(),
  lessonId: varchar("lesson_id").references(() => trainingLessons.id).notNull(),
  moduleId: varchar("module_id").references(() => trainingModules.id).notNull(),
  status: varchar("status").notNull().default("not_started"), // 'not_started' | 'in_progress' | 'completed'
  completedAt: timestamp("completed_at"),
  quizScore: integer("quiz_score"), // percentage 0-100 for quiz lessons
  isFlagged: boolean("is_flagged").default(false),
  flagReason: text("flag_reason"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("idx_lesson_progress_employee_module").on(table.employeeId, table.moduleId),
  unique("uq_lesson_progress_employee_lesson").on(table.employeeId, table.lessonId),
]);

// Morning learning moment (daily AI-selected tip/question)
export const morningLearningMoments = pgTable("morning_learning_moments", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  storeId: varchar("store_id").references(() => workLocations.id),
  momentDate: varchar("moment_date").notNull(), // YYYY-MM-DD
  tipText: text("tip_text").notNull(),
  quizQuestion: text("quiz_question"),
  quizChoices: jsonb("quiz_choices").$type<string[]>(),
  quizCorrectIndex: integer("quiz_correct_index"),
  quizContext: text("quiz_context"), // explanation shown to manager
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  uniqueIndex("uq_morning_moments_store_date").on(table.storeId, table.momentDate),
]);

// Employee answers to morning learning moment quizzes
export const morningMomentAnswers = pgTable("morning_moment_answers", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  momentId: varchar("moment_id").references(() => morningLearningMoments.id).notNull(),
  employeeId: varchar("employee_id").references(() => users.id).notNull(),
  selectedIndex: integer("selected_index").notNull(),
  isCorrect: boolean("is_correct").notNull(),
  pointsAwarded: integer("points_awarded").default(0),
  answeredAt: timestamp("answered_at").defaultNow(),
}, (table) => [
  unique("uq_moment_answer_employee").on(table.momentId, table.employeeId),
  index("idx_moment_answers_employee").on(table.employeeId),
]);

// Flagged cards (employees flag confusing content)
export const trainingFlags = pgTable("training_flags", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  employeeId: varchar("employee_id").references(() => users.id).notNull(),
  lessonId: varchar("lesson_id").references(() => trainingLessons.id).notNull(),
  questionId: varchar("question_id").references(() => trainingQuestions.id),
  reason: text("reason"),
  status: varchar("status").notNull().default("open"), // 'open' | 'resolved'
  resolvedBy: varchar("resolved_by").references(() => users.id),
  resolvedAt: timestamp("resolved_at"),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("idx_training_flags_lesson").on(table.lessonId),
  index("idx_training_flags_status").on(table.status),
]);

// Zod schemas + types for new tables
export const insertTrainingLessonSchema = createInsertSchema(trainingLessons).omit({ id: true, createdAt: true });
export type TrainingLesson = typeof trainingLessons.$inferSelect;
export type InsertTrainingLesson = z.infer<typeof insertTrainingLessonSchema>;

export const insertTrainingQuestionSchema = createInsertSchema(trainingQuestions).omit({ id: true, createdAt: true });
export type TrainingQuestion = typeof trainingQuestions.$inferSelect;
export type InsertTrainingQuestion = z.infer<typeof insertTrainingQuestionSchema>;

export const insertTrainingPracticeScheduleSchema = createInsertSchema(trainingPracticeSchedule).omit({ id: true, createdAt: true });
export type TrainingPracticeSchedule = typeof trainingPracticeSchedule.$inferSelect;
export type InsertTrainingPracticeSchedule = z.infer<typeof insertTrainingPracticeScheduleSchema>;

export const insertTrainingLessonProgressSchema = createInsertSchema(trainingLessonProgress).omit({ id: true, createdAt: true, updatedAt: true });
export type TrainingLessonProgress = typeof trainingLessonProgress.$inferSelect;
export type InsertTrainingLessonProgress = z.infer<typeof insertTrainingLessonProgressSchema>;

export const insertMorningLearningMomentSchema = createInsertSchema(morningLearningMoments).omit({ id: true, createdAt: true });
export type MorningLearningMoment = typeof morningLearningMoments.$inferSelect;
export type InsertMorningLearningMoment = z.infer<typeof insertMorningLearningMomentSchema>;

export const insertMorningMomentAnswerSchema = createInsertSchema(morningMomentAnswers).omit({ id: true, answeredAt: true });
export type MorningMomentAnswer = typeof morningMomentAnswers.$inferSelect;
export type InsertMorningMomentAnswer = z.infer<typeof insertMorningMomentAnswerSchema>;

export const insertTrainingFlagSchema = createInsertSchema(trainingFlags).omit({ id: true, createdAt: true });
export type TrainingFlag = typeof trainingFlags.$inferSelect;
export type InsertTrainingFlag = z.infer<typeof insertTrainingFlagSchema>;

// Day notes for Availability and Schedule views
export const dayNotes = pgTable("day_notes", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").references(() => users.id),
  date: varchar("date").notNull(),
  noteText: text("note_text").notNull(),
  isManagerNote: boolean("is_manager_note").default(false),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("idx_day_notes_date").on(table.date),
  index("idx_day_notes_user_date").on(table.userId, table.date),
]);

export const insertDayNoteSchema = createInsertSchema(dayNotes).omit({ id: true, createdAt: true, updatedAt: true });
export const selectDayNoteSchema = z.object({
  id: z.string(),
  userId: z.string().nullable(),
  date: z.string(),
  noteText: z.string(),
  isManagerNote: z.boolean().nullable(),
  createdAt: z.date().nullable(),
  updatedAt: z.date().nullable(),
});
export type InsertDayNote = z.infer<typeof insertDayNoteSchema>;
export type DayNote = typeof dayNotes.$inferSelect;

// ── AI Learning Center: Store Context ──────────────────────────────────────
export const companyAiContext = pgTable("company_ai_context", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  storeId: varchar("store_id").references(() => workLocations.id),
  storeName: varchar("store_name").notNull().default("My Store"),
  businessType: varchar("business_type").notNull().default("Fashion Boutique"),
  brandVoice: text("brand_voice"),
  teamRoles: jsonb("team_roles").$type<string[]>().default(["New Associate", "Lead", "Manager"]),
  goals: jsonb("goals").$type<string[]>().default([]),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertCompanyAiContextSchema = createInsertSchema(companyAiContext).omit({ id: true, updatedAt: true });
export type CompanyAiContext = typeof companyAiContext.$inferSelect;
export type InsertCompanyAiContext = z.infer<typeof insertCompanyAiContextSchema>;

// ── AI Learning Center: Generation Jobs ────────────────────────────────────
export const generationJobs = pgTable("generation_jobs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  storeId: varchar("store_id").references(() => workLocations.id),
  status: varchar("status").notNull().default("pending"),
  selectedDocumentIds: jsonb("selected_document_ids").$type<string[]>().default([]),
  outputTypes: jsonb("output_types").$type<string[]>().default([]),
  targetRoles: jsonb("target_roles").$type<string[]>().default([]),
  selectedCategories: jsonb("selected_categories").$type<string[]>().default([]),
  resultsJson: jsonb("results_json"),
  progressLog: jsonb("progress_log").$type<string[]>().default([]),
  createdBy: varchar("created_by").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("idx_generation_jobs_status").on(table.status),
  index("idx_generation_jobs_created_by").on(table.createdBy),
  index("idx_generation_jobs_store_id").on(table.storeId),
]);

export const insertGenerationJobSchema = createInsertSchema(generationJobs).omit({ id: true, createdAt: true, updatedAt: true });
export type GenerationJob = typeof generationJobs.$inferSelect;
export type InsertGenerationJob = z.infer<typeof insertGenerationJobSchema>;

// ── AI Learning Center: Store Q&A Sessions ─────────────────────────────────
export const aiStoreQASessions = pgTable("ai_store_qa_sessions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").references(() => users.id).notNull(),
  title: varchar("title").notNull().default("Store Q&A"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("idx_ai_store_qa_sessions_user").on(table.userId),
]);

export const aiStoreQAMessages = pgTable("ai_store_qa_messages", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  sessionId: varchar("session_id").references(() => aiStoreQASessions.id).notNull(),
  role: varchar("role").notNull(),
  content: text("content").notNull(),
  sourceDocumentIds: jsonb("source_document_ids").$type<string[]>().default([]),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("idx_ai_store_qa_messages_session").on(table.sessionId),
]);

export const insertAiStoreQASessionSchema = createInsertSchema(aiStoreQASessions).omit({ id: true, createdAt: true, updatedAt: true });
export const insertAiStoreQAMessageSchema = createInsertSchema(aiStoreQAMessages).omit({ id: true, createdAt: true });
export type AiStoreQASession = typeof aiStoreQASessions.$inferSelect;
export type InsertAiStoreQASession = z.infer<typeof insertAiStoreQASessionSchema>;
export type AiStoreQAMessage = typeof aiStoreQAMessages.$inferSelect;
export type InsertAiStoreQAMessage = z.infer<typeof insertAiStoreQAMessageSchema>;

// ── AI Content Studio ─────────────────────────────────────────────────────

export const aiGeneratedItems = pgTable("ai_generated_items", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  storeId: varchar("store_id").references(() => workLocations.id),
  jobId: varchar("job_id").references(() => generationJobs.id),
  type: varchar("type").notNull(),
  title: varchar("title").notNull(),
  content: jsonb("content").notNull(),
  sourceDocumentIds: jsonb("source_document_ids").$type<string[]>().default([]),
  status: varchar("status").notNull().default("in_review"),
  feedbackNotes: text("feedback_notes"),
  createdBy: varchar("created_by").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("idx_ai_gen_items_store_type").on(table.storeId, table.type),
  index("idx_ai_gen_items_job").on(table.jobId),
  index("idx_ai_gen_items_status").on(table.status),
]);

export const insertAiGeneratedItemSchema = createInsertSchema(aiGeneratedItems).omit({ id: true, createdAt: true, updatedAt: true });
export type AiGeneratedItem = typeof aiGeneratedItems.$inferSelect;
export type InsertAiGeneratedItem = z.infer<typeof insertAiGeneratedItemSchema>;

// ── Supply & Inventory Kanban System ────────────────────────────────────────

export const supplyItems = pgTable("supply_items", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  storeId: varchar("store_id").notNull(),
  name: varchar("name").notNull(),
  category: varchar("category").notNull().default("other"), // bags | cleaning | paper | other
  unit: varchar("unit").notNull().default("each"), // rolls, boxes, each, cases, etc.
  parLevel: integer("par_level").notNull().default(10),
  safetyStock: integer("safety_stock").notNull().default(2), // triggers red alert
  lastCountedQty: integer("last_counted_qty"),
  lastCountedAt: timestamp("last_counted_at"),
  orderUrl: text("order_url"),
  supplierName: varchar("supplier_name"),
  isLocalPickup: boolean("is_local_pickup").default(false),
  notes: text("notes"),
  isActive: boolean("is_active").default(true),
  createdBy: varchar("created_by").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("idx_supply_items_store").on(table.storeId),
  index("idx_supply_items_category").on(table.category),
]);

export const insertSupplyItemSchema = createInsertSchema(supplyItems).omit({ id: true, createdAt: true, updatedAt: true });
export type SupplyItem = typeof supplyItems.$inferSelect;
export type InsertSupplyItem = z.infer<typeof insertSupplyItemSchema>;

export const inventoryCountSessions = pgTable("inventory_count_sessions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  storeId: varchar("store_id").notNull(),
  assignedTo: varchar("assigned_to").references(() => users.id),
  assignedBy: varchar("assigned_by").references(() => users.id),
  status: varchar("status").notNull().default("pending"), // pending | in_progress | completed
  categories: jsonb("categories").$type<string[]>(), // null = all
  taskId: varchar("task_id"), // linked task in tasks table
  startedAt: timestamp("started_at"),
  completedAt: timestamp("completed_at"),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("idx_inv_sessions_store").on(table.storeId),
  index("idx_inv_sessions_assigned").on(table.assignedTo),
]);

export const insertInventoryCountSessionSchema = createInsertSchema(inventoryCountSessions).omit({ id: true, createdAt: true });
export type InventoryCountSession = typeof inventoryCountSessions.$inferSelect;
export type InsertInventoryCountSession = z.infer<typeof insertInventoryCountSessionSchema>;

export const inventoryCountEntries = pgTable("inventory_count_entries", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  sessionId: varchar("session_id").references(() => inventoryCountSessions.id).notNull(),
  supplyItemId: varchar("supply_item_id").references(() => supplyItems.id).notNull(),
  countedQty: integer("counted_qty").notNull(),
  previousQty: integer("previous_qty"),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("idx_inv_entries_session").on(table.sessionId),
]);

export const insertInventoryCountEntrySchema = createInsertSchema(inventoryCountEntries).omit({ id: true, createdAt: true });
export type InventoryCountEntry = typeof inventoryCountEntries.$inferSelect;
export type InsertInventoryCountEntry = z.infer<typeof insertInventoryCountEntrySchema>;

// ── Unified AI Learning Platform ─────────────────────────────────────────────

export const quizQuestions = pgTable("quiz_questions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  storeId: varchar("store_id").references(() => workLocations.id),
  sourceDocumentId: varchar("source_document_id").references(() => knowledgeDocuments.id),
  jobId: varchar("job_id").references(() => generationJobs.id),
  topicTag: varchar("topic_tag").notNull(),
  difficulty: varchar("difficulty").notNull().default("medium"),
  questionText: text("question_text").notNull(),
  answerChoices: jsonb("answer_choices").$type<string[]>().notNull(),
  correctAnswerIndex: integer("correct_answer_index").notNull(),
  coachingText: text("coaching_text"),
  isActive: boolean("is_active").default(true),
  wrongAnswerCount: integer("wrong_answer_count").default(0),
  totalAnswerCount: integer("total_answer_count").default(0),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("idx_quiz_questions_store").on(table.storeId),
  index("idx_quiz_questions_topic").on(table.storeId, table.topicTag),
]);

export const insertQuizQuestionSchema = createInsertSchema(quizQuestions).omit({ id: true, createdAt: true });
export type QuizQuestion = typeof quizQuestions.$inferSelect;
export type InsertQuizQuestion = z.infer<typeof insertQuizQuestionSchema>;

export const userQuizProgress = pgTable("user_quiz_progress", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").references(() => users.id).notNull(),
  storeId: varchar("store_id").references(() => workLocations.id),
  currentRotationTopics: jsonb("current_rotation_topics").$type<string[]>().default([]),
  coveredTopicsThisRotation: jsonb("covered_topics_this_rotation").$type<string[]>().default([]),
  totalQuizzesCompleted: integer("total_quizzes_completed").default(0),
  totalQuestionsAnswered: integer("total_questions_answered").default(0),
  totalCorrectAnswers: integer("total_correct_answers").default(0),
  currentStreakDays: integer("current_streak_days").default(0),
  longestStreakDays: integer("longest_streak_days").default(0),
  lastQuizDate: date("last_quiz_date"),
  seasonPoints: integer("season_points").default(0),
  currentSeason: varchar("current_season"),
  allTopicsCoveredCount: integer("all_topics_covered_count").default(0),
  pendingBossBattle: boolean("pending_boss_battle").default(false),
  scenarioParticipationCount: integer("scenario_participation_count").default(0),
  scenarioLastAwardedDate: date("scenario_last_awarded_date"),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  uniqueIndex("uq_user_quiz_progress").on(table.userId),
  index("idx_user_quiz_progress_store").on(table.storeId),
]);

export const insertUserQuizProgressSchema = createInsertSchema(userQuizProgress).omit({ id: true, updatedAt: true });
export type UserQuizProgress = typeof userQuizProgress.$inferSelect;
export type InsertUserQuizProgress = z.infer<typeof insertUserQuizProgressSchema>;

export const quizSessions = pgTable("quiz_sessions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").references(() => users.id).notNull(),
  storeId: varchar("store_id").references(() => workLocations.id),
  sessionDate: date("session_date").notNull(),
  topicTag: varchar("topic_tag").notNull(),
  sessionType: varchar("session_type").notNull().default("daily"),
  questionIds: jsonb("question_ids").$type<string[]>().default([]),
  status: varchar("status").notNull().default("in_progress"),
  score: integer("score"),
  totalQuestions: integer("total_questions").default(0),
  correctAnswers: integer("correct_answers").default(0),
  streakMultiplier: integer("streak_multiplier").default(1),
  basePoints: integer("base_points").default(0),
  totalPoints: integer("total_points").default(0),
  completedAt: timestamp("completed_at"),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("idx_quiz_sessions_user_date").on(table.userId, table.sessionDate),
  uniqueIndex("uq_quiz_session_user_date_type").on(table.userId, table.sessionDate, table.sessionType),
]);

export const insertQuizSessionSchema = createInsertSchema(quizSessions).omit({ id: true, createdAt: true });
export type QuizSession = typeof quizSessions.$inferSelect;
export type InsertQuizSession = z.infer<typeof insertQuizSessionSchema>;

export const quizAnswers = pgTable("quiz_answers", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  sessionId: varchar("session_id").references(() => quizSessions.id).notNull(),
  questionId: varchar("question_id").references(() => quizQuestions.id).notNull(),
  selectedIndex: integer("selected_index").notNull(),
  isCorrect: boolean("is_correct").notNull(),
  answeredAt: timestamp("answered_at").defaultNow(),
}, (table) => [
  index("idx_quiz_answers_session").on(table.sessionId),
  uniqueIndex("uq_quiz_answer_session_question").on(table.sessionId, table.questionId),
]);

export const insertQuizAnswerSchema = createInsertSchema(quizAnswers).omit({ id: true, answeredAt: true });
export type QuizAnswer = typeof quizAnswers.$inferSelect;
export type InsertQuizAnswer = z.infer<typeof insertQuizAnswerSchema>;

// ── Daily Training Questionnaire ─────────────────────────────────────────────

export const dailyQuestionnaires = pgTable("daily_questionnaires", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  storeId: varchar("store_id").references(() => workLocations.id).notNull(),
  quizDate: date("quiz_date").notNull(),
  topic: varchar("topic").notNull(),
  questions: jsonb("questions").$type<Array<{
    id: string;
    questionText: string;
    questionType: "multiple_choice" | "true_false" | "scenario";
    contextParagraph?: string;
    answerChoices: string[];
    correctAnswerIndex: number;
    coachingText: string;
  }>>().notNull(),
  xpReward: integer("xp_reward").default(50),
  generatedBy: varchar("generated_by").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  uniqueIndex("uq_daily_questionnaire_store_date").on(table.storeId, table.quizDate),
  index("idx_daily_questionnaire_store").on(table.storeId),
]);

export const insertDailyQuestionnaireSchema = createInsertSchema(dailyQuestionnaires).omit({ id: true, createdAt: true });
export type DailyQuestionnaire = typeof dailyQuestionnaires.$inferSelect;
export type InsertDailyQuestionnaire = z.infer<typeof insertDailyQuestionnaireSchema>;

export const questionnaireResponses = pgTable("questionnaire_responses", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").references(() => users.id).notNull(),
  questionnaireId: varchar("questionnaire_id").references(() => dailyQuestionnaires.id).notNull(),
  answers: jsonb("answers").$type<Array<{ questionIndex: number; selectedIndex: number; isCorrect: boolean }>>().notNull(),
  score: integer("score").notNull(),
  xpEarned: integer("xp_earned").notNull(),
  completedAt: timestamp("completed_at").defaultNow(),
  durationSeconds: integer("duration_seconds"),
}, (table) => [
  uniqueIndex("uq_questionnaire_response_user").on(table.userId, table.questionnaireId),
  index("idx_questionnaire_responses_user").on(table.userId),
  index("idx_questionnaire_responses_questionnaire").on(table.questionnaireId),
]);

export const insertQuestionnaireResponseSchema = createInsertSchema(questionnaireResponses).omit({ id: true, completedAt: true });
export type QuestionnaireResponse = typeof questionnaireResponses.$inferSelect;
export type InsertQuestionnaireResponse = z.infer<typeof insertQuestionnaireResponseSchema>;

export const userBadges = pgTable("user_badges", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").references(() => users.id).notNull(),
  storeId: varchar("store_id").references(() => workLocations.id).notNull(),
  badgeType: varchar("badge_type").notNull(),
  topic: varchar("topic"),
  earnedAt: timestamp("earned_at").defaultNow(),
}, (table) => [
  index("idx_user_badges_user").on(table.userId),
  index("idx_user_badges_store").on(table.storeId),
]);

export const insertUserBadgeSchema = createInsertSchema(userBadges).omit({ id: true, earnedAt: true });
export type UserBadge = typeof userBadges.$inferSelect;
export type InsertUserBadge = z.infer<typeof insertUserBadgeSchema>;

// Unanswered questions escalation queue — questions MAinager couldn't confidently answer
export const unansweredQuestions = pgTable("unanswered_questions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  storeId: varchar("store_id").references(() => workLocations.id).notNull(),
  askedByUserId: varchar("asked_by_user_id").references(() => users.id).notNull(),
  question: text("question").notNull(),
  aiAnswer: text("ai_answer"),
  status: varchar("status").notNull().default("pending"), // 'pending' | 'answered' | 'dismissed'
  answer: text("answer"),
  answeredByUserId: varchar("answered_by_user_id").references(() => users.id),
  answeredAt: timestamp("answered_at"),
  conversationId: varchar("conversation_id"),
  askedAt: timestamp("asked_at").defaultNow(),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("idx_unanswered_questions_store").on(table.storeId),
  index("idx_unanswered_questions_status").on(table.status),
  index("idx_unanswered_questions_asked_by").on(table.askedByUserId),
]);

export const insertUnansweredQuestionSchema = createInsertSchema(unansweredQuestions).omit({ id: true, createdAt: true, askedAt: true });
export type UnansweredQuestion = typeof unansweredQuestions.$inferSelect;
export type InsertUnansweredQuestion = z.infer<typeof insertUnansweredQuestionSchema>;
