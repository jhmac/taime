import { sql } from "drizzle-orm";
import {
  pgTable,
  pgEnum,
  text,
  varchar,
  timestamp,
  boolean,
  integer,
  decimal,
  jsonb,
  index,
  uniqueIndex,
  unique,
  date,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { users, workLocations, companies } from "./identity";
import { sopTemplates } from "./sop";

// ── Task / Chore ──────────────────────────────────────────────────────────────

export const taskStatusEnum = pgEnum("task_status", ["pending", "in_progress", "completed", "cancelled"]);
export const taskAssigneeStatusEnum = pgEnum("task_assignee_status", [
  "pending", "in_progress", "completed", "approved", "rejected"
]);

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
  dayOfWeek: varchar("day_of_week"),
  timeOfDay: varchar("time_of_day"),
  isRecurring: boolean("is_recurring").default(false),
  requiresSignature: boolean("requires_signature").default(false),
  requiresPhoto: boolean("requires_photo").default(false),
  employeeSignedAt: timestamp("employee_signed_at"),
  managerSignedAt: timestamp("manager_signed_at"),
  signedBy: varchar("signed_by").references(() => users.id),
  verifiedBy: varchar("verified_by").references(() => users.id),
  choreZone: varchar("chore_zone"),
  priority: varchar("priority").default("medium"),
  completionImageUrl: text("completion_image_url"),
}, (table) => [
  index("idx_tasks_assigned_to").on(table.assignedTo),
  index("idx_tasks_due_date").on(table.dueDate),
  index("idx_tasks_assigned_created").on(table.assignedTo, table.createdAt),
]);

// Per-employee broadcast task assignments
export const taskAssignees = pgTable("task_assignees", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  taskId: varchar("task_id").references(() => tasks.id, { onDelete: 'cascade' }).notNull(),
  userId: varchar("user_id").references(() => users.id).notNull(),
  assignedBy: varchar("assigned_by").references(() => users.id).notNull(),
  broadcastGroupId: varchar("broadcast_group_id").notNull(),
  status: taskAssigneeStatusEnum("status").default("pending"),
  startedAt: timestamp("started_at"),
  completedAt: timestamp("completed_at"),
  completionNote: text("completion_note"),
  completionImageUrl: text("completion_image_url"),
  previousImageUrl: text("previous_image_url"),
  managerApprovedAt: timestamp("manager_approved_at"),
  approvedBy: varchar("approved_by").references(() => users.id),
  rejectedAt: timestamp("rejected_at"),
  rejectionNote: text("rejection_note"),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("idx_task_assignees_task_id").on(table.taskId),
  index("idx_task_assignees_user_id").on(table.userId),
  index("idx_task_assignees_broadcast_group").on(table.broadcastGroupId),
  index("idx_task_assignees_status").on(table.status),
]);

// ── Chat / Messaging ─────────────────────────────────────────────────────────

export const chatGroups = pgTable("chat_groups", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: varchar("name").notNull(),
  description: text("description"),
  createdBy: varchar("created_by").references(() => users.id).notNull(),
  isActive: boolean("is_active").default(true),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const groupMembers = pgTable("group_members", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  groupId: varchar("group_id").references(() => chatGroups.id).notNull(),
  userId: varchar("user_id").references(() => users.id).notNull(),
  joinedAt: timestamp("joined_at").defaultNow(),
});

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
  reactions: jsonb("reactions").$type<Array<{ userId: string; emoji: string }>>().default([]),
  toEmployeeId: text("to_employee_id"),
  kudoCategory: text("kudo_category"),
}, (table) => [
  index("idx_thread_messages_thread_created").on(table.threadId, table.createdAt),
  index("idx_thread_messages_sender").on(table.senderId, table.createdAt),
]);

// ── Recognition ──────────────────────────────────────────────────────────────

export const shoutouts = pgTable("shoutouts", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  senderId: varchar("sender_id").references(() => users.id).notNull(),
  recipientId: varchar("recipient_id").references(() => users.id).notNull(),
  category: varchar("category").notNull(),
  message: text("message").notNull(),
  emoji: varchar("emoji"),
  reactions: jsonb("reactions").$type<Array<{ userId: string; emoji: string }>>().default([]),
  createdAt: timestamp("created_at").defaultNow(),
});

export const kudos = pgTable("kudos", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  storeId: varchar("store_id").references(() => workLocations.id).notNull(),
  fromEmployeeId: varchar("from_employee_id").notNull(),
  toEmployeeId: varchar("to_employee_id").notNull(),
  message: text("message").notNull(),
  reactions: jsonb("reactions").$type<Array<{ userId: string; emoji: string }>>().default([]),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
}, (table) => [
  index("idx_kudos_store_created").on(table.storeId, table.createdAt),
  index("idx_kudos_to_employee_created").on(table.toEmployeeId, table.createdAt),
]);

// ── Company / Admin ───────────────────────────────────────────────────────────

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
  enableClockOutOnFocusLoss: boolean("enable_clock_out_on_focus_loss").default(false),
  focusLossGraceSeconds: integer("focus_loss_grace_seconds").default(30),
  autoResumeWindowSeconds: integer("auto_resume_window_seconds").default(600),
  requireMobileClockIn: boolean("require_mobile_clock_in").default(false),
  requireLocationPermission: boolean("require_location_permission").default(false),
  defaultMileageRateCents: integer("default_mileage_rate_cents").default(0),
  taskAutoAssign: boolean("task_auto_assign").default(false),
  dailySalesGoalEnabled: boolean("daily_sales_goal_enabled").default(false),
  salesGoalIncreaseType: varchar("sales_goal_increase_type").default("percentage"),
  salesGoalIncreaseValue: decimal("sales_goal_increase_value", { precision: 10, scale: 2 }).default("0"),
  showPaySummaryToEmployees: boolean("show_pay_summary_to_employees").default(false),
  showPaySummaryToManagers: boolean("show_pay_summary_to_managers").default(false),
  version: integer("version").default(1).notNull(),
});

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

// ── HR / Employee docs ────────────────────────────────────────────────────────

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

// ── AI Chat ───────────────────────────────────────────────────────────────────

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

// ── Training ─────────────────────────────────────────────────────────────────

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

// Training lessons (sub-steps within a training module)
export const trainingLessons = pgTable("training_lessons", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  moduleId: varchar("module_id").references(() => trainingModules.id, { onDelete: "cascade" }).notNull(),
  type: varchar("type").notNull(),
  title: varchar("title").notNull(),
  contentJson: jsonb("content_json").notNull().$type<Record<string, unknown>>(),
  orderIndex: integer("order_index").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("idx_training_lessons_module_order").on(table.moduleId, table.orderIndex),
]);

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

export const trainingPracticeSchedule = pgTable("training_practice_schedule", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  employeeId: varchar("employee_id").references(() => users.id).notNull(),
  questionId: varchar("question_id").references(() => trainingQuestions.id).notNull(),
  nextReviewAt: timestamp("next_review_at").notNull(),
  intervalDays: integer("interval_days").notNull().default(1),
  lastResult: varchar("last_result"),
  lastAnsweredAt: timestamp("last_answered_at"),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("idx_practice_schedule_employee_review").on(table.employeeId, table.nextReviewAt),
  unique("uq_practice_schedule_employee_question").on(table.employeeId, table.questionId),
]);

export const trainingLessonProgress = pgTable("training_lesson_progress", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  employeeId: varchar("employee_id").references(() => users.id).notNull(),
  lessonId: varchar("lesson_id").references(() => trainingLessons.id).notNull(),
  moduleId: varchar("module_id").references(() => trainingModules.id).notNull(),
  status: varchar("status").notNull().default("not_started"),
  completedAt: timestamp("completed_at"),
  quizScore: integer("quiz_score"),
  isFlagged: boolean("is_flagged").default(false),
  flagReason: text("flag_reason"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("idx_lesson_progress_employee_module").on(table.employeeId, table.moduleId),
  unique("uq_lesson_progress_employee_lesson").on(table.employeeId, table.lessonId),
]);

export const morningLearningMoments = pgTable("morning_learning_moments", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  storeId: varchar("store_id").references(() => workLocations.id),
  momentDate: varchar("moment_date").notNull(),
  tipText: text("tip_text").notNull(),
  quizQuestion: text("quiz_question"),
  quizChoices: jsonb("quiz_choices").$type<string[]>(),
  quizCorrectIndex: integer("quiz_correct_index"),
  quizContext: text("quiz_context"),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  uniqueIndex("uq_morning_moments_store_date").on(table.storeId, table.momentDate),
]);

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

export const trainingFlags = pgTable("training_flags", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  employeeId: varchar("employee_id").references(() => users.id).notNull(),
  lessonId: varchar("lesson_id").references(() => trainingLessons.id).notNull(),
  questionId: varchar("question_id").references(() => trainingQuestions.id),
  reason: text("reason"),
  status: varchar("status").notNull().default("open"),
  resolvedBy: varchar("resolved_by").references(() => users.id),
  resolvedAt: timestamp("resolved_at"),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("idx_training_flags_lesson").on(table.lessonId),
  index("idx_training_flags_status").on(table.status),
]);

// ── Commute / Location alerts ─────────────────────────────────────────────────

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

export const geofenceEvents = pgTable("geofence_events", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").references(() => users.id).notNull(),
  locationId: varchar("location_id").references(() => workLocations.id).notNull(),
  eventType: varchar("event_type", { length: 20 }).notNull(),
  latitude: decimal("latitude", { precision: 10, scale: 8 }),
  longitude: decimal("longitude", { precision: 11, scale: 8 }),
  distanceFromCenter: decimal("distance_from_center", { precision: 10, scale: 2 }),
  timeEntryId: varchar("time_entry_id"),
  createdAt: timestamp("created_at").defaultNow(),
});

// ── Issues ────────────────────────────────────────────────────────────────────

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

// ── Daily Ritual System ───────────────────────────────────────────────────────

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

export const middayPulses = pgTable("midday_pulses", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  storeId: varchar("store_id").references(() => workLocations.id).notNull(),
  pulseDate: date("pulse_date").notNull(),
  data: jsonb("data").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
}, (table) => [
  uniqueIndex("uq_midday_pulses_store_date").on(table.storeId, table.pulseDate),
]);

// ── Video ─────────────────────────────────────────────────────────────────────

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

// ── Lean Board ────────────────────────────────────────────────────────────────

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

// ── Background Insights ───────────────────────────────────────────────────────

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

// ── Operational Insights (Queryable Company AI Intelligence) ─────────────────

export const operationalInsights = pgTable("operational_insights", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  storeId: varchar("store_id").references(() => workLocations.id, { onDelete: "cascade" }).notNull(),
  insightType: varchar("insight_type").notNull(),
  affectedArea: varchar("affected_area").notNull(),
  severity: varchar("severity").notNull().default("info"),
  observation: text("observation").notNull(),
  whyItMatters: text("why_it_matters"),
  recommendedAction: text("recommended_action").notNull(),
  dataPayload: jsonb("data_payload"),
  status: varchar("status").notNull().default("active"),
  dismissedBy: varchar("dismissed_by").references(() => users.id),
  dismissedAt: timestamp("dismissed_at", { withTimezone: true }),
  dismissReason: text("dismiss_reason"),
  actedOnBy: varchar("acted_on_by").references(() => users.id),
  actedOnAt: timestamp("acted_on_at", { withTimezone: true }),
  linkedTaskId: varchar("linked_task_id").references(() => tasks.id, { onDelete: "set null" }),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  generatedAt: timestamp("generated_at", { withTimezone: true }).defaultNow(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
}, (table) => [
  index("idx_op_insights_store_status_sev").on(table.storeId, table.status, table.severity, table.createdAt),
  index("idx_op_insights_store_type").on(table.storeId, table.insightType),
]);

export const insertOperationalInsightSchema = createInsertSchema(operationalInsights).omit({
  id: true,
  createdAt: true,
  generatedAt: true,
});
export type InsertOperationalInsight = z.infer<typeof insertOperationalInsightSchema>;
export type OperationalInsight = typeof operationalInsights.$inferSelect;

// ── Cash Management ───────────────────────────────────────────────────────────

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

export const cashDeposits = pgTable("cash_deposits", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  storeId: text("store_id").notNull(),
  depositDate: text("deposit_date").notNull(),
  depositedBy: varchar("deposited_by"),
  depositedAt: timestamp("deposited_at", { withTimezone: true }),
  expectedAmount: decimal("expected_amount", { precision: 10, scale: 2 }),
  actualAmount: decimal("actual_amount", { precision: 10, scale: 2 }),
  drawerSessionId: varchar("drawer_session_id"),
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

// ── Gamification ──────────────────────────────────────────────────────────────

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

// ── Meetings ──────────────────────────────────────────────────────────────────

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

// ── Knowledge / AI Learning ───────────────────────────────────────────────────

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

// ── Day Notes ─────────────────────────────────────────────────────────────────

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

// ── AI Learning Center ────────────────────────────────────────────────────────

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

// ── Supply / Inventory ────────────────────────────────────────────────────────

export const supplyItems = pgTable("supply_items", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  storeId: varchar("store_id").notNull(),
  name: varchar("name").notNull(),
  category: varchar("category").notNull().default("other"),
  unit: varchar("unit").notNull().default("each"),
  parLevel: integer("par_level").notNull().default(10),
  safetyStock: integer("safety_stock").notNull().default(2),
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

export const inventoryCountSessions = pgTable("inventory_count_sessions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  storeId: varchar("store_id").notNull(),
  assignedTo: varchar("assigned_to").references(() => users.id),
  assignedBy: varchar("assigned_by").references(() => users.id),
  status: varchar("status").notNull().default("pending"),
  categories: jsonb("categories").$type<string[]>(),
  taskId: varchar("task_id"),
  startedAt: timestamp("started_at"),
  completedAt: timestamp("completed_at"),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("idx_inv_sessions_store").on(table.storeId),
  index("idx_inv_sessions_assigned").on(table.assignedTo),
]);

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

// ── Quiz / Learning Platform ──────────────────────────────────────────────────

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

// ── Daily Training Questionnaire ──────────────────────────────────────────────

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

// ── Unanswered Questions ──────────────────────────────────────────────────────

export const unansweredQuestions = pgTable("unanswered_questions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  storeId: varchar("store_id").references(() => workLocations.id).notNull(),
  askedByUserId: varchar("asked_by_user_id").references(() => users.id).notNull(),
  question: text("question").notNull(),
  aiAnswer: text("ai_answer"),
  status: varchar("status").notNull().default("pending"),
  answer: text("answer"),
  answeredByUserId: varchar("answered_by_user_id").references(() => users.id),
  answeredAt: timestamp("answered_at"),
  conversationId: varchar("conversation_id").references(() => aiChatConversations.id),
  askedAt: timestamp("asked_at").defaultNow(),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("idx_unanswered_questions_store").on(table.storeId),
  index("idx_unanswered_questions_status").on(table.status),
  index("idx_unanswered_questions_asked_by").on(table.askedByUserId),
]);

// ── Supply Requests ───────────────────────────────────────────────────────────

export const supplies = pgTable("supplies", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: varchar("name").notNull(),
  notes: text("notes"),
  requestedBy: varchar("requested_by").references(() => users.id).notNull(),
  companyId: varchar("company_id").references(() => companies.id),
  requestedAt: timestamp("requested_at").defaultNow(),
  purchased: boolean("purchased").default(false),
  purchasedAt: timestamp("purchased_at"),
}, (table) => [
  index("idx_supplies_company_id").on(table.companyId),
  index("idx_supplies_requested_at").on(table.requestedAt),
  index("idx_supplies_purchased").on(table.purchased),
]);

// ── Insert Schemas ────────────────────────────────────────────────────────────

export const insertTaskAssigneeSchema = createInsertSchema(taskAssignees).omit({ id: true, createdAt: true });
export const insertTaskSchema = createInsertSchema(tasks).omit({ id: true, createdAt: true });
export const insertMessageSchema = createInsertSchema(messages).omit({ id: true, createdAt: true });
export const insertChatGroupSchema = createInsertSchema(chatGroups).omit({ id: true, createdAt: true, updatedAt: true });
export const insertGroupMemberSchema = createInsertSchema(groupMembers).omit({ id: true, joinedAt: true });
export const insertShoutoutSchema = createInsertSchema(shoutouts).omit({ id: true, createdAt: true });
export const insertCompanySettingsSchema = createInsertSchema(companySettings).omit({ id: true, updatedAt: true });
export const insertActivityLogSchema = createInsertSchema(activityLogs).omit({ id: true, createdAt: true });
export const insertEmployeeDocumentSchema = createInsertSchema(employeeDocuments).omit({ id: true, createdAt: true });
export const insertManagerNoteSchema = createInsertSchema(managerNotes).omit({ id: true, createdAt: true, updatedAt: true });
export const insertAiChatConversationSchema = createInsertSchema(aiChatConversations).omit({ id: true, createdAt: true });
export const insertAiChatMessageSchema = createInsertSchema(aiChatMessages).omit({ id: true, createdAt: true });
export const insertAiFeedbackSchema = createInsertSchema(aiFeedback).omit({ id: true, createdAt: true });
export const insertTrainingModuleSchema = createInsertSchema(trainingModules).omit({ id: true, createdAt: true });
export const insertEmployeeTrainingProgressSchema = createInsertSchema(employeeTrainingProgress).omit({ id: true, createdAt: true, updatedAt: true });
export const insertTrainingLessonSchema = createInsertSchema(trainingLessons).omit({ id: true, createdAt: true });
export const insertTrainingQuestionSchema = createInsertSchema(trainingQuestions).omit({ id: true, createdAt: true });
export const insertTrainingPracticeScheduleSchema = createInsertSchema(trainingPracticeSchedule).omit({ id: true, createdAt: true });
export const insertTrainingLessonProgressSchema = createInsertSchema(trainingLessonProgress).omit({ id: true, createdAt: true, updatedAt: true });
export const insertMorningLearningMomentSchema = createInsertSchema(morningLearningMoments).omit({ id: true, createdAt: true });
export const insertMorningMomentAnswerSchema = createInsertSchema(morningMomentAnswers).omit({ id: true, answeredAt: true });
export const insertTrainingFlagSchema = createInsertSchema(trainingFlags).omit({ id: true, createdAt: true });
export const insertCommuteAlertSchema = createInsertSchema(commuteAlerts).omit({ id: true, createdAt: true });
export const insertIssueSchema = createInsertSchema(issues).omit({ id: true, createdAt: true, updatedAt: true });
export const insertIssueCommentSchema = createInsertSchema(issueComments).omit({ id: true, createdAt: true });
export const insertMorningHuddleSchema = createInsertSchema(morningHuddles).omit({ id: true, createdAt: true });
export const insertMorningWhisperSchema = createInsertSchema(morningWhispers).omit({ id: true, createdAt: true });
export const insertDailyDebriefSchema = createInsertSchema(dailyDebriefs).omit({ id: true, createdAt: true });
export const insertDailyQuoteSchema = createInsertSchema(dailyQuotes).omit({ id: true, createdAt: true });
export const insertDailyQuoteHistorySchema = createInsertSchema(dailyQuoteHistory).omit({ id: true, createdAt: true });
export const insertKudoSchema = createInsertSchema(kudos).omit({ id: true, createdAt: true });
export const insertMiddayPulseSchema = createInsertSchema(middayPulses).omit({ id: true, createdAt: true });
export const insertMessageThreadSchema = createInsertSchema(messageThreads).omit({ id: true, createdAt: true, updatedAt: true });
export const insertThreadParticipantSchema = createInsertSchema(threadParticipants).omit({ id: true, joinedAt: true });
export const insertThreadMessageSchema = createInsertSchema(threadMessages).omit({ id: true, createdAt: true, editedAt: true, deletedAt: true });
export const insertImprovementVideoSchema = createInsertSchema(improvementVideos).omit({ id: true, createdAt: true, viewCount: true, isFeatured: true, status: true });
export const insertVideoLikeSchema = createInsertSchema(videoLikes).omit({ id: true, createdAt: true });
export const insertVideoCommentSchema = createInsertSchema(videoComments).omit({ id: true, createdAt: true });
export const insertLeanBoardSnapshotSchema = createInsertSchema(leanBoardSnapshots).omit({ id: true, createdAt: true });
export const insertBackgroundInsightSchema = createInsertSchema(backgroundInsights).omit({ id: true, createdAt: true });
export const insertDrawerSessionSchema = createInsertSchema(drawerSessions).omit({ id: true, createdAt: true });
export const insertCashDepositSchema = createInsertSchema(cashDeposits).omit({ id: true, createdAt: true });
export const insertCashManagementSettingsSchema = createInsertSchema(cashManagementSettings).omit({ id: true, createdAt: true, updatedAt: true });
export const insertCashDiscrepancyLogSchema = createInsertSchema(cashDiscrepancyLog).omit({ id: true, createdAt: true });
export const insertScoreNoticeSchema = createInsertSchema(scoreNotices).omit({ id: true, createdAt: true });
export const insertUserBadgeSchema = createInsertSchema(userBadges).omit({ id: true, earnedAt: true });
export const insertMeetingSchema = createInsertSchema(meetings).omit({ id: true, createdAt: true, updatedAt: true });
export const insertMeetingTaskRecommendationSchema = createInsertSchema(meetingTaskRecommendations).omit({ id: true, createdAt: true, updatedAt: true });
export const insertKnowledgeDocumentSchema = createInsertSchema(knowledgeDocuments).omit({ id: true, createdAt: true, updatedAt: true });
export const insertDayNoteSchema = createInsertSchema(dayNotes).omit({ id: true, createdAt: true, updatedAt: true });
export const insertCompanyAiContextSchema = createInsertSchema(companyAiContext).omit({ id: true, updatedAt: true });
export const insertGenerationJobSchema = createInsertSchema(generationJobs).omit({ id: true, createdAt: true, updatedAt: true });
export const insertAiStoreQASessionSchema = createInsertSchema(aiStoreQASessions).omit({ id: true, createdAt: true, updatedAt: true });
export const insertAiStoreQAMessageSchema = createInsertSchema(aiStoreQAMessages).omit({ id: true, createdAt: true });
export const insertAiGeneratedItemSchema = createInsertSchema(aiGeneratedItems).omit({ id: true, createdAt: true, updatedAt: true });
export const insertSupplyItemSchema = createInsertSchema(supplyItems).omit({ id: true, createdAt: true, updatedAt: true });
export const insertInventoryCountSessionSchema = createInsertSchema(inventoryCountSessions).omit({ id: true, createdAt: true });
export const insertInventoryCountEntrySchema = createInsertSchema(inventoryCountEntries).omit({ id: true, createdAt: true });
export const insertQuizQuestionSchema = createInsertSchema(quizQuestions).omit({ id: true, createdAt: true });
export const insertUserQuizProgressSchema = createInsertSchema(userQuizProgress).omit({ id: true, updatedAt: true });
export const insertQuizSessionSchema = createInsertSchema(quizSessions).omit({ id: true, createdAt: true });
export const insertQuizAnswerSchema = createInsertSchema(quizAnswers).omit({ id: true, answeredAt: true });
export const insertDailyQuestionnaireSchema = createInsertSchema(dailyQuestionnaires).omit({ id: true, createdAt: true });
export const insertQuestionnaireResponseSchema = createInsertSchema(questionnaireResponses).omit({ id: true, completedAt: true });
export const insertUnansweredQuestionSchema = createInsertSchema(unansweredQuestions).omit({ id: true, createdAt: true, askedAt: true });
export const insertSupplySchema = createInsertSchema(supplies).omit({ id: true, requestedAt: true, purchasedAt: true });

// selectDayNoteSchema (backward compat)
export const selectDayNoteSchema = z.object({
  id: z.string(),
  userId: z.string().nullable(),
  date: z.string(),
  noteText: z.string(),
  isManagerNote: z.boolean().nullable(),
  createdAt: z.date().nullable(),
  updatedAt: z.date().nullable(),
});

// ── Types ─────────────────────────────────────────────────────────────────────

export type TaskAssignee = typeof taskAssignees.$inferSelect;
export type InsertTaskAssignee = z.infer<typeof insertTaskAssigneeSchema>;
export type Task = typeof tasks.$inferSelect;
export type InsertTask = z.infer<typeof insertTaskSchema>;
export type Message = typeof messages.$inferSelect;
export type InsertMessage = z.infer<typeof insertMessageSchema>;
export type ChatGroup = typeof chatGroups.$inferSelect;
export type InsertChatGroup = z.infer<typeof insertChatGroupSchema>;
export type GroupMember = typeof groupMembers.$inferSelect;
export type InsertGroupMember = z.infer<typeof insertGroupMemberSchema>;
export type Shoutout = typeof shoutouts.$inferSelect;
export type InsertShoutout = z.infer<typeof insertShoutoutSchema>;
export type CompanySettings = typeof companySettings.$inferSelect;
export type InsertCompanySettings = z.infer<typeof insertCompanySettingsSchema>;
export type ActivityLog = typeof activityLogs.$inferSelect;
export type InsertActivityLog = z.infer<typeof insertActivityLogSchema>;
export type EmployeeDocument = typeof employeeDocuments.$inferSelect;
export type InsertEmployeeDocument = z.infer<typeof insertEmployeeDocumentSchema>;
export type ManagerNote = typeof managerNotes.$inferSelect;
export type InsertManagerNote = z.infer<typeof insertManagerNoteSchema>;
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
export type TrainingLesson = typeof trainingLessons.$inferSelect;
export type InsertTrainingLesson = z.infer<typeof insertTrainingLessonSchema>;
export type TrainingQuestion = typeof trainingQuestions.$inferSelect;
export type InsertTrainingQuestion = z.infer<typeof insertTrainingQuestionSchema>;
export type TrainingPracticeSchedule = typeof trainingPracticeSchedule.$inferSelect;
export type InsertTrainingPracticeSchedule = z.infer<typeof insertTrainingPracticeScheduleSchema>;
export type TrainingLessonProgress = typeof trainingLessonProgress.$inferSelect;
export type InsertTrainingLessonProgress = z.infer<typeof insertTrainingLessonProgressSchema>;
export type MorningLearningMoment = typeof morningLearningMoments.$inferSelect;
export type InsertMorningLearningMoment = z.infer<typeof insertMorningLearningMomentSchema>;
export type MorningMomentAnswer = typeof morningMomentAnswers.$inferSelect;
export type InsertMorningMomentAnswer = z.infer<typeof insertMorningMomentAnswerSchema>;
export type TrainingFlag = typeof trainingFlags.$inferSelect;
export type InsertTrainingFlag = z.infer<typeof insertTrainingFlagSchema>;
export type CommuteAlert = typeof commuteAlerts.$inferSelect;
export type InsertCommuteAlert = z.infer<typeof insertCommuteAlertSchema>;
export type GeofenceEvent = typeof geofenceEvents.$inferSelect;
export type Issue = typeof issues.$inferSelect;
export type InsertIssue = z.infer<typeof insertIssueSchema>;
export type IssueComment = typeof issueComments.$inferSelect;
export type InsertIssueComment = z.infer<typeof insertIssueCommentSchema>;
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
export type MiddayPulse = typeof middayPulses.$inferSelect;
export type InsertMiddayPulse = z.infer<typeof insertMiddayPulseSchema>;
export type MessageThread = typeof messageThreads.$inferSelect;
export type InsertMessageThread = z.infer<typeof insertMessageThreadSchema>;
export type ThreadParticipant = typeof threadParticipants.$inferSelect;
export type InsertThreadParticipant = z.infer<typeof insertThreadParticipantSchema>;
export type ThreadMessage = typeof threadMessages.$inferSelect;
export type InsertThreadMessage = z.infer<typeof insertThreadMessageSchema>;
export type ImprovementVideo = typeof improvementVideos.$inferSelect;
export type InsertImprovementVideo = z.infer<typeof insertImprovementVideoSchema>;
export type VideoLike = typeof videoLikes.$inferSelect;
export type InsertVideoLike = z.infer<typeof insertVideoLikeSchema>;
export type VideoComment = typeof videoComments.$inferSelect;
export type InsertVideoComment = z.infer<typeof insertVideoCommentSchema>;
export type LeanBoardSnapshot = typeof leanBoardSnapshots.$inferSelect;
export type InsertLeanBoardSnapshot = z.infer<typeof insertLeanBoardSnapshotSchema>;
export type BackgroundInsight = typeof backgroundInsights.$inferSelect;
export type InsertBackgroundInsight = z.infer<typeof insertBackgroundInsightSchema>;
export type DrawerSession = typeof drawerSessions.$inferSelect;
export type InsertDrawerSession = z.infer<typeof insertDrawerSessionSchema>;
export type CashDeposit = typeof cashDeposits.$inferSelect;
export type InsertCashDeposit = z.infer<typeof insertCashDepositSchema>;
export type CashManagementSettings = typeof cashManagementSettings.$inferSelect;
export type InsertCashManagementSettings = z.infer<typeof insertCashManagementSettingsSchema>;
export type CashDiscrepancyLog = typeof cashDiscrepancyLog.$inferSelect;
export type InsertCashDiscrepancyLog = z.infer<typeof insertCashDiscrepancyLogSchema>;
export type ScoreHistory = typeof scoreHistory.$inferSelect;
export type GamificationSettings = typeof gamificationSettings.$inferSelect;
export type UserAchievement = typeof userAchievements.$inferSelect;
export type ScoreNotice = typeof scoreNotices.$inferSelect;
export type InsertScoreNotice = z.infer<typeof insertScoreNoticeSchema>;
export type UserBadge = typeof userBadges.$inferSelect;
export type InsertUserBadge = z.infer<typeof insertUserBadgeSchema>;
export type Meeting = typeof meetings.$inferSelect;
export type InsertMeeting = z.infer<typeof insertMeetingSchema>;
export type MeetingTaskRecommendation = typeof meetingTaskRecommendations.$inferSelect;
export type InsertMeetingTaskRecommendation = z.infer<typeof insertMeetingTaskRecommendationSchema>;
export type KnowledgeDocument = typeof knowledgeDocuments.$inferSelect;
export type InsertKnowledgeDocument = z.infer<typeof insertKnowledgeDocumentSchema>;
export type InsertDayNote = z.infer<typeof insertDayNoteSchema>;
export type DayNote = typeof dayNotes.$inferSelect;
export type CompanyAiContext = typeof companyAiContext.$inferSelect;
export type InsertCompanyAiContext = z.infer<typeof insertCompanyAiContextSchema>;
export type GenerationJob = typeof generationJobs.$inferSelect;
export type InsertGenerationJob = z.infer<typeof insertGenerationJobSchema>;
export type AiStoreQASession = typeof aiStoreQASessions.$inferSelect;
export type InsertAiStoreQASession = z.infer<typeof insertAiStoreQASessionSchema>;
export type AiStoreQAMessage = typeof aiStoreQAMessages.$inferSelect;
export type InsertAiStoreQAMessage = z.infer<typeof insertAiStoreQAMessageSchema>;
export type AiGeneratedItem = typeof aiGeneratedItems.$inferSelect;
export type InsertAiGeneratedItem = z.infer<typeof insertAiGeneratedItemSchema>;
export type SupplyItem = typeof supplyItems.$inferSelect;
export type InsertSupplyItem = z.infer<typeof insertSupplyItemSchema>;
export type InventoryCountSession = typeof inventoryCountSessions.$inferSelect;
export type InsertInventoryCountSession = z.infer<typeof insertInventoryCountSessionSchema>;
export type InventoryCountEntry = typeof inventoryCountEntries.$inferSelect;
export type InsertInventoryCountEntry = z.infer<typeof insertInventoryCountEntrySchema>;
export type QuizQuestion = typeof quizQuestions.$inferSelect;
export type InsertQuizQuestion = z.infer<typeof insertQuizQuestionSchema>;
export type UserQuizProgress = typeof userQuizProgress.$inferSelect;
export type InsertUserQuizProgress = z.infer<typeof insertUserQuizProgressSchema>;
export type QuizSession = typeof quizSessions.$inferSelect;
export type InsertQuizSession = z.infer<typeof insertQuizSessionSchema>;
export type QuizAnswer = typeof quizAnswers.$inferSelect;
export type InsertQuizAnswer = z.infer<typeof insertQuizAnswerSchema>;
export type DailyQuestionnaire = typeof dailyQuestionnaires.$inferSelect;
export type InsertDailyQuestionnaire = z.infer<typeof insertDailyQuestionnaireSchema>;
export type QuestionnaireResponse = typeof questionnaireResponses.$inferSelect;
export type InsertQuestionnaireResponse = z.infer<typeof insertQuestionnaireResponseSchema>;
export type UnansweredQuestion = typeof unansweredQuestions.$inferSelect;
export type InsertUnansweredQuestion = z.infer<typeof insertUnansweredQuestionSchema>;
export type Supply = typeof supplies.$inferSelect;
export type InsertSupply = z.infer<typeof insertSupplySchema>;
