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
  pgEnum
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
  sendLocationAlerts: boolean("send_location_alerts").default(true),
  includeInTimeClockErrors: boolean("include_in_time_clock_errors").default(true),
  eligibleForOpenShifts: boolean("eligible_for_open_shifts").default(true),
  canWaiveMissedBreaks: boolean("can_waive_missed_breaks").default(false),
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
  radius: integer("radius").default(100), // meters
  isActive: boolean("is_active").default(true),
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
  isApproved: boolean("is_approved").default(false),
  approvedBy: varchar("approved_by").references(() => users.id),
  approvedAt: timestamp("approved_at"),
  createdAt: timestamp("created_at").defaultNow(),
});

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
});

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

// Team messages/communication (updated for group chat support)
export const messages = pgTable("messages", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  senderId: varchar("sender_id").references(() => users.id).notNull(),
  recipientId: varchar("recipient_id").references(() => users.id),
  groupId: varchar("group_id").references(() => chatGroups.id),
  content: text("content").notNull(),
  isAnnouncement: boolean("is_announcement").default(false),
  readBy: jsonb("read_by").$type<string[]>().default([]),
  createdAt: timestamp("created_at").defaultNow(),
});

// Pay period automation settings
export const payPeriodSettings = pgTable("pay_period_settings", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  intervalType: varchar("interval_type").default("bi-weekly"), // 'weekly', 'bi-weekly', 'monthly'
  isAutomationEnabled: boolean("is_automation_enabled").default(false),
  daysBeforeNotification: integer("days_before_notification").default(7), // Days before period ends to send availability notice
  scheduleGenerationDays: integer("schedule_generation_days").default(5), // Days before period starts to generate schedule
  automaticConflictResolution: boolean("automatic_conflict_resolution").default(true),
  firstPayPeriodStart: timestamp("first_pay_period_start"),
  firstPayPeriodEnd: timestamp("first_pay_period_end"),
  notificationUserId: varchar("notification_user_id").references(() => users.id), // User who receives payroll confirmations
  isSetupComplete: boolean("is_setup_complete").default(false),
  createdBy: varchar("created_by").references(() => users.id),
  updatedBy: varchar("updated_by").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Workflow states enum for pay periods
export const workflowStateEnum = pgEnum("workflow_state", [
  "created", // Pay period created
  "availability_requested", // Availability notification sent to team
  "availability_collected", // Team has submitted availability
  "schedule_generated", // AI has generated initial schedule
  "schedule_sent_for_review", // Schedule sent to team for confirmation
  "schedule_confirmed", // Team has confirmed schedule
  "conflicts_resolved", // Any conflicts have been automatically resolved
  "finalized", // Schedule is final and locked
  "processed" // Payroll has been processed
]);

// Payroll periods with enhanced automation and workflow support
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
  automationMetadata: jsonb("automation_metadata"), // Store automation-related data
  createdAt: timestamp("created_at").defaultNow(),
});

// User availability for scheduling
export const userAvailability = pgTable("user_availability", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").references(() => users.id).notNull(),
  payrollPeriodId: varchar("payroll_period_id").references(() => payrollPeriods.id).notNull(),
  date: timestamp("date").notNull(),
  timeSlot: varchar("time_slot").notNull(), // 'morning', 'afternoon', 'evening', 'overnight'
  isAvailable: boolean("is_available").default(true),
  submittedAt: timestamp("submitted_at").defaultNow(),
  createdAt: timestamp("created_at").defaultNow(),
});

// Schedule confirmations from team members
export const scheduleConfirmations = pgTable("schedule_confirmations", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  payrollPeriodId: varchar("payroll_period_id").references(() => payrollPeriods.id).notNull(),
  userId: varchar("user_id").references(() => users.id).notNull(),
  isConfirmed: boolean("is_confirmed").default(false),
  feedback: text("feedback"), // Optional feedback about the schedule
  conflicts: jsonb("conflicts"), // Any conflicts the user has with the schedule
  confirmedAt: timestamp("confirmed_at"),
  createdAt: timestamp("created_at").defaultNow(),
});

// Automated workflow logs
export const workflowLogs = pgTable("workflow_logs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  payrollPeriodId: varchar("payroll_period_id").references(() => payrollPeriods.id).notNull(),
  workflowStep: varchar("workflow_step").notNull(), // e.g., 'availability_requested', 'schedule_generated'
  status: varchar("status").notNull(), // 'success', 'failed', 'pending'
  details: text("details"), // Additional details about the workflow step
  metadata: jsonb("metadata"), // JSON data related to the workflow step
  createdAt: timestamp("created_at").defaultNow(),
});

// AI monitoring and insights
export const aiInsights = pgTable("ai_insights", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  type: varchar("type").notNull(), // 'overtime_alert', 'anomaly_detected', 'optimization'
  userId: varchar("user_id").references(() => users.id),
  title: varchar("title").notNull(),
  description: text("description"),
  severity: varchar("severity").default("info"), // 'info', 'warning', 'critical'
  isRead: boolean("is_read").default(false),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at").defaultNow(),
});

// Company settings (singleton)
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
});

// Activity log for admin actions
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

// Push notification subscriptions
export const pushSubscriptions = pgTable("push_subscriptions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").references(() => users.id).notNull(),
  endpoint: text("endpoint").notNull(),
  p256dh: text("p256dh").notNull(),
  auth: text("auth").notNull(),
  isActive: boolean("is_active").default(true),
  createdAt: timestamp("created_at").defaultNow(),
});

// Relations
export const usersRelations = relations(users, ({ one, many }) => ({
  role: one(roles, {
    fields: [users.roleId],
    references: [roles.id],
  }),
  timeEntries: many(timeEntries),
  schedules: many(schedules),
  assignedTasks: many(tasks, { relationName: "assignedTasks" }),
  createdTasks: many(tasks, { relationName: "createdTasks" }),
  sentMessages: many(messages, { relationName: "sentMessages" }),
  receivedMessages: many(messages, { relationName: "receivedMessages" }),
  createdGroups: many(chatGroups),
  groupMemberships: many(groupMembers),
  availability: many(userAvailability),
  insights: many(aiInsights),
  pushSubscriptions: many(pushSubscriptions),
}));

export const rolesRelations = relations(roles, ({ many }) => ({
  users: many(users),
  rolePermissions: many(rolePermissions),
}));

export const permissionsRelations = relations(permissions, ({ many }) => ({
  rolePermissions: many(rolePermissions),
}));

export const rolePermissionsRelations = relations(rolePermissions, ({ one }) => ({
  role: one(roles, {
    fields: [rolePermissions.roleId],
    references: [roles.id],
  }),
  permission: one(permissions, {
    fields: [rolePermissions.permissionId],
    references: [permissions.id],
  }),
}));

export const timeEntriesRelations = relations(timeEntries, ({ one }) => ({
  user: one(users, {
    fields: [timeEntries.userId],
    references: [users.id],
  }),
  location: one(workLocations, {
    fields: [timeEntries.locationId],
    references: [workLocations.id],
  }),
  approver: one(users, {
    fields: [timeEntries.approvedBy],
    references: [users.id],
  }),
}));

export const schedulesRelations = relations(schedules, ({ one }) => ({
  user: one(users, {
    fields: [schedules.userId],
    references: [users.id],
  }),
  location: one(workLocations, {
    fields: [schedules.locationId],
    references: [workLocations.id],
  }),
  creator: one(users, {
    fields: [schedules.createdBy],
    references: [users.id],
  }),
}));

export const tasksRelations = relations(tasks, ({ one }) => ({
  assignedUser: one(users, {
    fields: [tasks.assignedTo],
    references: [users.id],
    relationName: "assignedTasks",
  }),
  creator: one(users, {
    fields: [tasks.createdBy],
    references: [users.id],
    relationName: "createdTasks",
  }),
  location: one(workLocations, {
    fields: [tasks.locationId],
    references: [workLocations.id],
  }),
}));

export const chatGroupsRelations = relations(chatGroups, ({ one, many }) => ({
  creator: one(users, {
    fields: [chatGroups.createdBy],
    references: [users.id],
  }),
  members: many(groupMembers),
  messages: many(messages),
}));

export const groupMembersRelations = relations(groupMembers, ({ one }) => ({
  group: one(chatGroups, {
    fields: [groupMembers.groupId],
    references: [chatGroups.id],
  }),
  user: one(users, {
    fields: [groupMembers.userId],
    references: [users.id],
  }),
}));

export const messagesRelations = relations(messages, ({ one }) => ({
  sender: one(users, {
    fields: [messages.senderId],
    references: [users.id],
    relationName: "sentMessages",
  }),
  recipient: one(users, {
    fields: [messages.recipientId],
    references: [users.id],
    relationName: "receivedMessages",
  }),
  group: one(chatGroups, {
    fields: [messages.groupId],
    references: [chatGroups.id],
  }),
}));

export const aiInsightsRelations = relations(aiInsights, ({ one }) => ({
  user: one(users, {
    fields: [aiInsights.userId],
    references: [users.id],
  }),
}));

export const pushSubscriptionsRelations = relations(pushSubscriptions, ({ one }) => ({
  user: one(users, {
    fields: [pushSubscriptions.userId],
    references: [users.id],
  }),
}));

// Insert schemas
export const insertUserSchema = createInsertSchema(users).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertRoleSchema = createInsertSchema(roles).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertPermissionSchema = createInsertSchema(permissions).omit({
  id: true,
  createdAt: true,
});

export const insertRolePermissionSchema = createInsertSchema(rolePermissions).omit({
  id: true,
  createdAt: true,
});

export const insertTimeEntrySchema = createInsertSchema(timeEntries).omit({
  id: true,
  createdAt: true,
});

export const insertScheduleSchema = createInsertSchema(schedules).omit({
  id: true,
  createdAt: true,
});

export const insertTaskSchema = createInsertSchema(tasks).omit({
  id: true,
  createdAt: true,
});

export const insertChatGroupSchema = createInsertSchema(chatGroups).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertGroupMemberSchema = createInsertSchema(groupMembers).omit({
  id: true,
  joinedAt: true,
});

export const insertMessageSchema = createInsertSchema(messages).omit({
  id: true,
  createdAt: true,
});

export const insertUserAvailabilitySchema = createInsertSchema(userAvailability).omit({
  id: true,
  createdAt: true,
  submittedAt: true,
});

export const insertPayPeriodSettingsSchema = createInsertSchema(payPeriodSettings).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertScheduleConfirmationSchema = createInsertSchema(scheduleConfirmations).omit({
  id: true,
  createdAt: true,
});

export const insertWorkflowLogSchema = createInsertSchema(workflowLogs).omit({
  id: true,
  createdAt: true,
});

export const insertPayrollPeriodSchema = createInsertSchema(payrollPeriods).omit({
  id: true,
  createdAt: true,
});

export const insertWorkLocationSchema = createInsertSchema(workLocations).omit({
  id: true,
  createdAt: true,
});

export const insertPushSubscriptionSchema = createInsertSchema(pushSubscriptions).omit({
  id: true,
  createdAt: true,
});

export const insertCompanySettingsSchema = createInsertSchema(companySettings).omit({
  id: true,
  updatedAt: true,
});

export const insertActivityLogSchema = createInsertSchema(activityLogs).omit({
  id: true,
  createdAt: true,
});

// Chore assignment schema
export const choreAssignmentSchema = z.object({
  choreId: z.string(),
  userId: z.string(),
});

// Chore sign-off schema
export const choreSignOffSchema = z.object({
  choreId: z.string(),
  isManager: z.boolean().default(false),
});

// Types
export type UpsertUser = typeof users.$inferInsert;
export type User = typeof users.$inferSelect;
export type TimeEntry = typeof timeEntries.$inferSelect;
export type InsertTimeEntry = z.infer<typeof insertTimeEntrySchema>;
export type Schedule = typeof schedules.$inferSelect;
export type InsertSchedule = z.infer<typeof insertScheduleSchema>;
export type Task = typeof tasks.$inferSelect;
export type InsertTask = z.infer<typeof insertTaskSchema>;
export type ChatGroup = typeof chatGroups.$inferSelect;
export type InsertChatGroup = z.infer<typeof insertChatGroupSchema>;
export type GroupMember = typeof groupMembers.$inferSelect;
export type InsertGroupMember = z.infer<typeof insertGroupMemberSchema>;
export type Message = typeof messages.$inferSelect;
export type InsertMessage = z.infer<typeof insertMessageSchema>;
export type UserAvailability = typeof userAvailability.$inferSelect;
export type InsertUserAvailability = z.infer<typeof insertUserAvailabilitySchema>;
export type WorkLocation = typeof workLocations.$inferSelect;
export type InsertWorkLocation = z.infer<typeof insertWorkLocationSchema>;
export type PayrollPeriod = typeof payrollPeriods.$inferSelect;
export type InsertPayrollPeriod = z.infer<typeof insertPayrollPeriodSchema>;
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
export type Permission = typeof permissions.$inferSelect;
export type InsertPermission = z.infer<typeof insertPermissionSchema>;
export type RolePermission = typeof rolePermissions.$inferSelect;
export type InsertRolePermission = z.infer<typeof insertRolePermissionSchema>;
export type ChoreAssignment = z.infer<typeof choreAssignmentSchema>;
export type ChoreSignOff = z.infer<typeof choreSignOffSchema>;
export type CompanySettings = typeof companySettings.$inferSelect;
export type InsertCompanySettings = z.infer<typeof insertCompanySettingsSchema>;
export type ActivityLog = typeof activityLogs.$inferSelect;
export type InsertActivityLog = z.infer<typeof insertActivityLogSchema>;

// Holiday pay rules
export const holidayPayRules = pgTable("holiday_pay_rules", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: varchar("name").notNull(),
  month: integer("month").notNull(),
  day: integer("day").notNull(),
  payMultiplier: decimal("pay_multiplier", { precision: 3, scale: 2 }).notNull().default("1.50"),
  isActive: boolean("is_active").default(true),
  createdBy: varchar("created_by").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertHolidayPayRuleSchema = createInsertSchema(holidayPayRules).omit({
  id: true,
  createdAt: true,
});

export type HolidayPayRule = typeof holidayPayRules.$inferSelect;
export type InsertHolidayPayRule = z.infer<typeof insertHolidayPayRuleSchema>;

// Shopify connected shops
export const shops = pgTable("shops", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  shopDomain: varchar("shop_domain").notNull().unique(),
  accessToken: text("access_token").notNull(),
  shopName: varchar("shop_name"),
  shopEmail: varchar("shop_email"),
  currency: varchar("currency").default("USD"),
  timezone: varchar("timezone"),
  isActive: boolean("is_active").default(true),
  lastSyncAt: timestamp("last_sync_at"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// User-to-shop linking (which users connected which stores)
export const userShops = pgTable("user_shops", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").references(() => users.id).notNull(),
  shopDomain: varchar("shop_domain").notNull(),
  connectedAt: timestamp("connected_at").defaultNow(),
});

// Aggregated daily sales data from Shopify
export const shopifyDailySales = pgTable("shopify_daily_sales", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  shopDomain: varchar("shop_domain").notNull(),
  date: timestamp("date").notNull(),
  dayOfWeek: integer("day_of_week").notNull(), // 0=Sunday, 6=Saturday
  orderCount: integer("order_count").default(0),
  totalRevenue: decimal("total_revenue", { precision: 12, scale: 2 }).default("0"),
  itemCount: integer("item_count").default(0),
  averageOrderValue: decimal("average_order_value", { precision: 10, scale: 2 }).default("0"),
  createdAt: timestamp("created_at").defaultNow(),
});

// Insert schemas for Shopify tables
export const insertShopSchema = createInsertSchema(shops).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertUserShopSchema = createInsertSchema(userShops).omit({
  id: true,
  connectedAt: true,
});

export const insertShopifyDailySalesSchema = createInsertSchema(shopifyDailySales).omit({
  id: true,
  createdAt: true,
});

// Shopify types
export type Shop = typeof shops.$inferSelect;
export type InsertShop = z.infer<typeof insertShopSchema>;
export type UserShop = typeof userShops.$inferSelect;
export type InsertUserShop = z.infer<typeof insertUserShopSchema>;
export type ShopifyDailySale = typeof shopifyDailySales.$inferSelect;
export type InsertShopifyDailySale = z.infer<typeof insertShopifyDailySalesSchema>;

// Extended user type with role information
export type UserWithRole = User & {
  role?: Role & {
    rolePermissions?: (RolePermission & {
      permission: Permission;
    })[];
  };
};
