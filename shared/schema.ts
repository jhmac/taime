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
  serial
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
  isActive: boolean("is_active").default(true),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Work locations for geofencing
export const workLocations = pgTable("work_locations", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: varchar("name").notNull(),
  address: text("address"),
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
});

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
  autoResumeWindowSeconds: integer("auto_resume_window_seconds").default(120),
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
  isPublished: boolean("is_published").default(false),
  version: integer("version").default(1),
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
  createdAt: timestamp("created_at").defaultNow(),
});

// Training modules
export const trainingModules = pgTable("training_modules", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  title: varchar("title").notNull(),
  description: text("description"),
  content: text("content").notNull(),
  category: varchar("category"),
  estimatedMinutes: integer("estimated_minutes"),
  isActive: boolean("is_active").default(true),
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
  eventType: varchar("event_type").notNull(),
  latitude: decimal("latitude", { precision: 10, scale: 8 }),
  longitude: decimal("longitude", { precision: 11, scale: 8 }),
  createdAt: timestamp("created_at").defaultNow(),
});

// AI Scheduling Settings
export const aiSchedulingSettings = pgTable("ai_scheduling_settings", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  locationId: varchar("location_id").references(() => workLocations.id).notNull(),
  minStaffPerShift: integer("min_staff_per_shift").default(1),
  maxStaffPerShift: integer("max_staff_per_shift").default(5),
  targetLaborCostPercentage: decimal("target_labor_cost_percentage", { precision: 5, scale: 2 }).default("15.00"),
  optimizationPriority: varchar("optimization_priority").default("balanced"), // 'cost', 'coverage', 'balanced'
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
});

// User to Shop junction table
export const userShops = pgTable("user_shops", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").references(() => users.id).notNull(),
  shopDomain: varchar("shop_domain").references(() => shops.shopDomain).notNull(),
  createdAt: timestamp("created_at").defaultNow(),
});

// Shopify Daily Sales
export const shopifyDailySales = pgTable("shopify_daily_sales", {
  id: serial("id").primaryKey(),
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
  version: integer("version").notNull().default(1),
  parentTemplateId: varchar("parent_template_id"),
  createdBy: text("created_by").notNull(),
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
  decisionOptions: jsonb("decision_options").$type<{ options: { label: string; nextStepOrder: number }[] }>(),
  trainingDetail: text("training_detail"),
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
export const insertTrainingModuleSchema = createInsertSchema(trainingModules).omit({ id: true, createdAt: true });
export const insertEmployeeTrainingProgressSchema = createInsertSchema(employeeTrainingProgress).omit({ id: true, createdAt: true, updatedAt: true });
export const insertCommuteAlertSchema = createInsertSchema(commuteAlerts).omit({ id: true, createdAt: true });
export const insertShoutoutSchema = createInsertSchema(shoutouts).omit({ id: true, createdAt: true, reactions: true });
export const insertAiSchedulingSettingsSchema = createInsertSchema(aiSchedulingSettings).omit({ id: true, createdAt: true, updatedAt: true });
export const insertWorkPatternTemplateSchema = createInsertSchema(workPatternTemplates).omit({ id: true, createdAt: true });
export const insertUserWorkPatternSchema = createInsertSchema(userWorkPatterns).omit({ id: true, createdAt: true });

// Chore assignment and sign-off schemas
export const choreAssignmentSchema = z.object({
  userId: z.string().uuid(),
});

export const choreSignOffSchema = z.object({
  isManager: z.boolean().default(false),
});

export const insertSopTemplateSchema = createInsertSchema(sopTemplates).omit({ id: true, createdAt: true, updatedAt: true });
export const insertSopStepSchema = createInsertSchema(sopSteps).omit({ id: true, createdAt: true });
export const insertSopExecutionSchema = createInsertSchema(sopExecutions).omit({ id: true, createdAt: true, startedAt: true });
export const insertSopStepCompletionSchema = createInsertSchema(sopStepCompletions).omit({ id: true, createdAt: true });

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

export const insertMorningHuddleSchema = createInsertSchema(morningHuddles).omit({
  id: true,
  createdAt: true,
});

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
export type TrainingModule = typeof trainingModules.$inferSelect;
export type InsertTrainingModule = z.infer<typeof insertTrainingModuleSchema>;
export type EmployeeTrainingProgress = typeof employeeTrainingProgress.$inferSelect;
export type InsertEmployeeTrainingProgress = z.infer<typeof insertEmployeeTrainingProgressSchema>;
export type CommuteAlert = typeof commuteAlerts.$inferSelect;
export type InsertCommuteAlert = z.infer<typeof insertCommuteAlertSchema>;
export type Shoutout = typeof shoutouts.$inferSelect;
export type InsertShoutout = z.infer<typeof insertShoutoutSchema>;
export type GeofenceEvent = typeof geofenceEvents.$inferSelect;
export type SopTemplate = typeof sopTemplates.$inferSelect;
export type InsertSopTemplate = z.infer<typeof insertSopTemplateSchema>;
export type SopStep = typeof sopSteps.$inferSelect;
export type InsertSopStep = z.infer<typeof insertSopStepSchema>;
export type SopExecution = typeof sopExecutions.$inferSelect;
export type InsertSopExecution = z.infer<typeof insertSopExecutionSchema>;
export type SopStepCompletion = typeof sopStepCompletions.$inferSelect;
export type InsertSopStepCompletion = z.infer<typeof insertSopStepCompletionSchema>;
export type Shop = typeof shops.$inferSelect;
export type UserShop = typeof userShops.$inferSelect;
export type ShopifyDailySale = typeof shopifyDailySales.$inferSelect;
export type ShopifyOrder = typeof shopifyOrders.$inferSelect;
