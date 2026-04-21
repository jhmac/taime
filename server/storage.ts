import {
  users,
  timeEntries,
  schedules,
  tasks,
  messages,
  chatGroups,
  groupMembers,
  workLocations,
  payrollPeriods,
  userAvailability,
  availabilityTemplates,
  type AvailabilityTemplate,
  type InsertAvailabilityTemplate,
  payPeriodSettings,
  scheduleConfirmations,
  workflowLogs,
  aiInsights,
  pushSubscriptions,
  nativePushTokens,
  pushCredentials,
  roles,
  permissions,
  rolePermissions,
  userPermissionOverrides,
  companySettings,
  activityLogs,
  holidayPayRules,
  clockEvents,
  performanceScoreSettings,
  sopCategories,
  sopDocuments,
  aiChatConversations,
  aiChatMessages,
  trainingModules,
  employeeTrainingProgress,
  commuteAlerts,
  timeOffRequests,
  shoutouts,
  meetings,
  meetingTaskRecommendations,
  dayNotes,
  knowledgeDocuments,
  trainingLessons,
  trainingQuestions,
  trainingPracticeSchedule,
  trainingLessonProgress,
  morningLearningMoments,
  morningMomentAnswers,
  trainingFlags,
  dailyQuestionnaires,
  questionnaireResponses,
  userBadges,
  type TrainingLesson,
  type InsertTrainingLesson,
  type TrainingQuestion,
  type InsertTrainingQuestion,
  type TrainingPracticeSchedule,
  type InsertTrainingPracticeSchedule,
  type TrainingLessonProgress,
  type InsertTrainingLessonProgress,
  type MorningLearningMoment,
  type InsertMorningLearningMoment,
  type MorningMomentAnswer,
  type InsertMorningMomentAnswer,
  type TrainingFlag,
  type InsertTrainingFlag,
  type DailyQuestionnaire,
  type InsertDailyQuestionnaire,
  type QuestionnaireResponse,
  type InsertQuestionnaireResponse,
  type UserBadge,
  type InsertUserBadge,
  type Meeting,
  type InsertMeeting,
  type MeetingTaskRecommendation,
  type InsertMeetingTaskRecommendation,
  type User,
  type UpsertUser,
  type TimeEntry,
  type InsertTimeEntry,
  type Schedule,
  type InsertSchedule,
  type Task,
  type InsertTask,
  type Message,
  type InsertMessage,
  type ChatGroup,
  type InsertChatGroup,
  type GroupMember,
  type InsertGroupMember,
  type WorkLocation,
  type InsertWorkLocation,
  type PayrollPeriod,
  type InsertPayrollPeriod,
  type UserAvailability,
  type InsertUserAvailability,
  type TimeOffRequest,
  type InsertTimeOffRequest,
  type PayPeriodSettings,
  type InsertPayPeriodSettings,
  type ScheduleConfirmation,
  type InsertScheduleConfirmation,
  type WorkflowLog,
  type InsertWorkflowLog,
  type AIInsight,
  type PushSubscription,
  type InsertPushSubscription,
  type NativePushToken,
  type InsertNativePushToken,
  type NotificationDeliveryLog,
  type NotificationDeliveryLogWithUser,
  type InsertNotificationDeliveryLog,
  notificationDeliveryLogs,
  type Role,
  type InsertRole,
  type Permission,
  type InsertPermission,
  type RolePermission,
  type InsertRolePermission,
  type UserPermissionOverride,
  type UserWithRole,
  type CompanySettings,
  type InsertCompanySettings,
  type ClockEvent,
  type InsertClockEvent,
  type PerformanceScoreSetting,
  type InsertPerformanceScoreSetting,
  type ActivityLog,
  type InsertActivityLog,
  type HolidayPayRule,
  type InsertHolidayPayRule,
  type SopCategory,
  type InsertSopCategory,
  type SopDocument,
  type InsertSopDocument,
  type AiChatConversation,
  type InsertAiChatConversation,
  type AiChatMessage,
  type InsertAiChatMessage,
  type TrainingModule,
  type InsertTrainingModule,
  type EmployeeTrainingProgress,
  type InsertEmployeeTrainingProgress,
  type CommuteAlert,
  type InsertCommuteAlert,
  type Shoutout,
  type InsertShoutout,
  timeEntryEdits,
  offsiteAllowanceRules,
  offsiteSessions,
  offsiteBreadcrumbs,
  overtimeAlerts,
  type TimeEntryEdit,
  type InsertTimeEntryEdit,
  discrepancyResolutions,
  type DiscrepancyResolution,
  type InsertDiscrepancyResolution,
  type OffsiteAllowanceRule,
  type InsertOffsiteAllowanceRule,
  type OffsiteSession,
  type InsertOffsiteSession,
  type OffsiteBreadcrumb,
  type InsertOffsiteBreadcrumb,
  type OvertimeAlert,
  type InsertOvertimeAlert,
  type DayNote,
  type InsertDayNote,
  mileageReimbursements,
  type MileageReimbursement,
  type InsertMileageReimbursement,
  type KnowledgeDocument,
  type InsertKnowledgeDocument,
} from "@shared/schema";
import { db } from "./db";
import { eq, and, desc, gte, lte, isNull, sql, or, inArray } from "drizzle-orm";
import { cache } from "./lib/cache";

export interface IStorage {
  // User operations (mandatory for Replit Auth)
  getUser(id: string): Promise<User | undefined>;
  getUserByEmail(email: string): Promise<User | undefined>;
  upsertUser(user: UpsertUser): Promise<User>;
  
  // Time tracking operations
  createTimeEntry(entry: InsertTimeEntry): Promise<TimeEntry>;
  getTimeEntry(id: string): Promise<TimeEntry | undefined>;
  getActiveTimeEntry(userId: string): Promise<TimeEntry | undefined>;
  updateTimeEntry(id: string, updates: Partial<TimeEntry>): Promise<TimeEntry>;
  getUserTimeEntries(userId: string, startDate?: Date, endDate?: Date): Promise<TimeEntry[]>;
  getAllTimeEntries(startDate?: Date, endDate?: Date): Promise<TimeEntry[]>;
  
  // Schedule operations
  createSchedule(schedule: InsertSchedule): Promise<Schedule>;
  createSchedulesBatch(scheduleList: InsertSchedule[]): Promise<Schedule[]>;
  getUserSchedules(userId: string, startDate?: Date, endDate?: Date): Promise<Schedule[]>;
  getAllSchedules(startDate?: Date, endDate?: Date, locationId?: string): Promise<Schedule[]>;
  updateSchedule(id: string, updates: Partial<Schedule>): Promise<Schedule>;
  deleteSchedule(id: string): Promise<void>;
  
  // Task operations
  createTask(task: InsertTask): Promise<Task>;
  getTask(id: string): Promise<Task | undefined>;
  getUserTasks(userId: string): Promise<Task[]>;
  getAllTasks(locationId?: string): Promise<Task[]>;
  updateTask(id: string, updates: Partial<Task>): Promise<Task>;
  deleteTask(id: string): Promise<void>;
  getTasksForDate(date: Date): Promise<Task[]>;
  
  // Chore operations
  getChoresForDay(dayOfWeek: string, timeOfDay?: string): Promise<Task[]>;
  assignChoreToUser(choreId: string, userId: string): Promise<Task>;
  signOffChore(choreId: string, userId: string, isManager: boolean): Promise<Task>;
  getWeeklyChoreSchedule(): Promise<Record<string, Task[]>>;
  getChoresByZone(zone: string): Promise<Task[]>;
  
  // Message operations
  createMessage(message: InsertMessage): Promise<Message>;
  getMessages(userId?: string): Promise<Message[]>;
  
  // Group chat operations
  createGroup(group: InsertChatGroup): Promise<ChatGroup>;
  getGroups(userId: string): Promise<ChatGroup[]>;
  addGroupMember(member: InsertGroupMember): Promise<GroupMember>;
  removeGroupMember(groupId: string, userId: string): Promise<void>;
  getGroupMessages(groupId: string): Promise<Message[]>;
  getGroupMembers(groupId: string): Promise<GroupMember[]>;
  markMessageAsRead(messageId: string, userId: string): Promise<void>;
  
  // Availability operations
  submitAvailability(availability: InsertUserAvailability[]): Promise<UserAvailability[]>;
  getUserAvailability(userId: string, payrollPeriodId?: string): Promise<UserAvailability[]>;
  getUserAvailabilityByDateRange(userId: string, startDate: Date, endDate: Date): Promise<UserAvailability[]>;
  getAllAvailabilityForPeriod(payrollPeriodId: string): Promise<UserAvailability[]>;
  getAllAvailabilityByDateRange(startDate: Date, endDate: Date): Promise<UserAvailability[]>;

  // Availability template operations
  getAvailabilityTemplate(userId: string): Promise<AvailabilityTemplate | undefined>;
  getAvailabilityTemplatesForUsers(userIds: string[]): Promise<AvailabilityTemplate[]>;
  upsertAvailabilityTemplate(userId: string, slots: Record<string, import('@shared/schema').TemplateSlot>): Promise<AvailabilityTemplate>;

  // Time-off request operations
  createTimeOffRequest(request: InsertTimeOffRequest): Promise<TimeOffRequest>;
  getTimeOffRequests(userId?: string): Promise<TimeOffRequest[]>;
  getTimeOffRequest(id: string): Promise<TimeOffRequest | undefined>;
  updateTimeOffRequest(id: string, updates: Partial<TimeOffRequest>): Promise<TimeOffRequest>;
  deleteTimeOffRequest(id: string): Promise<void>;
  
  // Work location operations
  createWorkLocation(location: InsertWorkLocation): Promise<WorkLocation>;
  getAllWorkLocations(): Promise<WorkLocation[]>;
  getWorkLocation(id: string): Promise<WorkLocation | undefined>;
  
  // Payroll operations
  createPayrollPeriod(period: InsertPayrollPeriod): Promise<PayrollPeriod>;
  getPayrollPeriods(): Promise<PayrollPeriod[]>;
  updatePayrollPeriod(id: string, updates: Partial<PayrollPeriod>): Promise<PayrollPeriod>;
  getNextPayrollPeriod(): Promise<PayrollPeriod | undefined>;
  getPayrollPeriod(id: string): Promise<any>;
  getPayrollSettings(): Promise<any>;
  createPayrollSettings(data: any): Promise<any>;
  updatePayrollSettings(id: string, updates: any): Promise<any>;
  
  // Pay period automation operations
  getPayPeriodSettings(): Promise<PayPeriodSettings | undefined>;
  updatePayPeriodSettings(settings: InsertPayPeriodSettings): Promise<PayPeriodSettings>;
  createNextPayPeriod(): Promise<PayrollPeriod>;
  
  // Schedule confirmation operations
  createScheduleConfirmation(confirmation: InsertScheduleConfirmation): Promise<ScheduleConfirmation>;
  getScheduleConfirmations(payrollPeriodId: string): Promise<ScheduleConfirmation[]>;
  updateScheduleConfirmation(id: string, updates: Partial<ScheduleConfirmation>): Promise<ScheduleConfirmation>;
  
  // Workflow log operations
  createWorkflowLog(log: InsertWorkflowLog): Promise<WorkflowLog>;
  getWorkflowLogs(payrollPeriodId: string): Promise<WorkflowLog[]>;
  
  // AI insights operations
  createAIInsight(insight: Omit<AIInsight, 'id' | 'createdAt'>): Promise<AIInsight>;
  getUserInsights(userId?: string): Promise<AIInsight[]>;
  markInsightAsRead(id: string): Promise<void>;
  
  // Push notification operations
  createPushSubscription(subscription: InsertPushSubscription): Promise<PushSubscription>;
  getUserPushSubscriptions(userId: string): Promise<PushSubscription[]>;
  deletePushSubscription(id: string): Promise<void>;

  // Native push token operations
  upsertNativePushToken(userId: string, token: string, platform: string): Promise<NativePushToken>;
  getUserNativePushTokens(userId: string): Promise<NativePushToken[]>;
  deleteNativePushToken(userId: string, token: string): Promise<void>;
  deleteStaleNativePushTokens(olderThanDays: number): Promise<number>;

  // Push credential operations (admin-managed APNs/FCM secrets)
  getPushCredential(key: string): Promise<string | null>;
  setPushCredential(key: string, value: string): Promise<void>;

  // Notification delivery log operations
  createNotificationDeliveryLog(log: InsertNotificationDeliveryLog): Promise<NotificationDeliveryLog>;
  getNotificationDeliveryLogs(options?: { channel?: string; userId?: string; notificationType?: string; since?: Date; limit?: number }): Promise<NotificationDeliveryLogWithUser[]>;
  getNotificationDeliveryStats(options?: { since?: Date }): Promise<{ userId: string; recipientName: string | null; total: number; failures: number }[]>;
  getDistinctNotificationTypes(): Promise<string[]>;
  deleteOldNotificationDeliveryLogs(olderThanDays: number): Promise<number>;

  // Role management operations
  getUserWithRole(id: string): Promise<UserWithRole | undefined>;
  getAllRoles(): Promise<Role[]>;
  getRole(id: string): Promise<Role | undefined>;
  createRole(role: InsertRole): Promise<Role>;
  updateRole(id: string, updates: Partial<Role>): Promise<Role>;
  deleteRole(id: string): Promise<void>;
  assignUserRole(userId: string, roleId: string): Promise<void>;
  
  // Permission management operations
  getAllPermissions(): Promise<Permission[]>;
  getPermissionsByCategory(): Promise<Record<string, Permission[]>>;
  getRolePermissions(roleId: string): Promise<Permission[]>;
  updateRolePermissions(roleId: string, permissionIds: string[]): Promise<void>;
  getUserPermissions(userId: string): Promise<Permission[]>;
  getUserRoleName(userId: string): Promise<string | null>;
  getUserSalesAccessOverride(userId: string): Promise<UserPermissionOverride | null>;
  setUserSalesAccessOverride(userId: string, grant: boolean | null): Promise<void>;
  
  // Company settings operations
  getCompanySettings(storeId?: string): Promise<CompanySettings | undefined>;
  updateCompanySettings(settings: InsertCompanySettings, storeId?: string): Promise<CompanySettings>;
  getClockedInUsers(): Promise<{ id: string; firstName: string | null; lastName: string | null }[]>;
  
  // Work location update/delete
  updateWorkLocation(id: string, updates: Partial<WorkLocation>): Promise<WorkLocation>;
  deleteWorkLocation(id: string): Promise<void>;
  
  // Activity log operations
  createActivityLog(log: InsertActivityLog): Promise<ActivityLog>;
  getActivityLogs(limit?: number): Promise<ActivityLog[]>;

  // Clock events operations
  createClockEvent(event: InsertClockEvent): Promise<ClockEvent>;
  getClockEvents(userId: string, startDate?: Date, endDate?: Date): Promise<ClockEvent[]>;
  getAllClockEvents(startDate?: Date, endDate?: Date): Promise<ClockEvent[]>;

  // Performance score settings operations
  getPerformanceScoreSettings(): Promise<PerformanceScoreSetting[]>;
  upsertPerformanceScoreSetting(setting: InsertPerformanceScoreSetting): Promise<PerformanceScoreSetting>;
  getPerformanceScores(startDate?: Date, endDate?: Date): Promise<{ userId: string; totalPoints: number; eventCount: number }[]>;
  
  // User management
  getAllUsers(): Promise<User[]>;
  getUsersByRole(roleId: string): Promise<User[]>;
  updateUserRole(userId: string, roleId: string): Promise<User>;
  deleteUser(userId: string): Promise<void>;
  deactivateUser(userId: string): Promise<User>;
  updateUser(userId: string, updates: Partial<User>): Promise<User>;
  updateUserPayRate(userId: string, hourlyRate: number): Promise<User>;

  // Holiday pay rules
  createHolidayPayRule(rule: InsertHolidayPayRule): Promise<HolidayPayRule>;
  getAllHolidayPayRules(): Promise<HolidayPayRule[]>;
  deleteHolidayPayRule(id: string): Promise<void>;
  updateHolidayPayRule(id: string, updates: Partial<HolidayPayRule>): Promise<HolidayPayRule>;

  // SOP operations
  createSopCategory(category: InsertSopCategory): Promise<SopCategory>;
  getSopCategories(storeId?: string): Promise<SopCategory[]>;
  updateSopCategory(id: string, updates: Partial<SopCategory>): Promise<SopCategory>;
  deleteSopCategory(id: string): Promise<void>;
  
  createSopDocument(doc: InsertSopDocument): Promise<SopDocument>;
  getSopDocuments(categoryId?: string): Promise<SopDocument[]>;
  getSopDocument(id: string): Promise<SopDocument | undefined>;
  updateSopDocument(id: string, updates: Partial<SopDocument>): Promise<SopDocument>;
  deleteSopDocument(id: string): Promise<void>;
  searchSopDocuments(query: string): Promise<SopDocument[]>;
  
  // AI Chat operations
  createAiChatConversation(conv: InsertAiChatConversation): Promise<AiChatConversation>;
  getUserConversations(userId: string): Promise<AiChatConversation[]>;
  getConversation(id: string): Promise<AiChatConversation | undefined>;
  deleteConversation(id: string): Promise<void>;
  
  createAiChatMessage(msg: InsertAiChatMessage): Promise<AiChatMessage>;
  getConversationMessages(conversationId: string): Promise<AiChatMessage[]>;
  
  // Training operations
  createTrainingModule(module: InsertTrainingModule): Promise<TrainingModule>;
  getTrainingModules(storeId?: string): Promise<TrainingModule[]>;
  updateTrainingModule(id: string, updates: Partial<TrainingModule>): Promise<TrainingModule>;
  deleteTrainingModule(id: string): Promise<void>;
  
  getEmployeeTrainingProgress(userId: string): Promise<EmployeeTrainingProgress[]>;
  upsertEmployeeTrainingProgress(progress: InsertEmployeeTrainingProgress): Promise<EmployeeTrainingProgress>;
  
  // Commute alerts
  createCommuteAlert(alert: InsertCommuteAlert): Promise<CommuteAlert>;
  getUserCommuteAlerts(userId: string): Promise<CommuteAlert[]>;

  // Shoutouts
  createShoutout(shoutout: InsertShoutout): Promise<Shoutout>;
  getShoutouts(limit?: number): Promise<Shoutout[]>;
  addShoutoutReaction(id: string, userId: string, emoji: string): Promise<Shoutout>;

  // Time entry edit audit trail
  createTimeEntryEdit(edit: InsertTimeEntryEdit): Promise<TimeEntryEdit>;
  getTimeEntryEdits(timeEntryId: string): Promise<TimeEntryEdit[]>;

  // Discrepancy resolutions
  createDiscrepancyResolution(resolution: InsertDiscrepancyResolution): Promise<DiscrepancyResolution>;
  getDiscrepancyResolutions(userId: string, startDate: string, endDate: string): Promise<DiscrepancyResolution[]>;

  // Off-site allowance rules
  createOffsiteRule(rule: InsertOffsiteAllowanceRule): Promise<OffsiteAllowanceRule>;
  getOffsiteRules(locationId: string): Promise<OffsiteAllowanceRule[]>;
  getOffsiteRule(id: string): Promise<OffsiteAllowanceRule | undefined>;
  updateOffsiteRule(id: string, updates: Partial<OffsiteAllowanceRule>): Promise<OffsiteAllowanceRule>;
  deleteOffsiteRule(id: string): Promise<void>;

  // Off-site sessions
  createOffsiteSession(session: InsertOffsiteSession): Promise<OffsiteSession>;
  getOffsiteSession(id: string): Promise<OffsiteSession | undefined>;
  getOffsiteSessions(filters?: { userId?: string; status?: string; timeEntryId?: string; locationId?: string; from?: Date; to?: Date }): Promise<OffsiteSession[]>;
  updateOffsiteSession(id: string, updates: Partial<OffsiteSession>): Promise<OffsiteSession>;

  // Off-site breadcrumbs
  createOffsiteBreadcrumb(breadcrumb: InsertOffsiteBreadcrumb): Promise<OffsiteBreadcrumb>;
  getOffsiteBreadcrumbs(sessionId: string): Promise<OffsiteBreadcrumb[]>;

  // Overtime alerts
  createOvertimeAlert(alert: InsertOvertimeAlert): Promise<OvertimeAlert>;
  getOvertimeAlerts(filters?: { status?: string; weekStartDate?: Date }): Promise<OvertimeAlert[]>;
  updateOvertimeAlert(id: string, updates: Partial<OvertimeAlert>): Promise<OvertimeAlert>;

  // Mileage reimbursements
  createMileageReimbursement(data: InsertMileageReimbursement): Promise<MileageReimbursement>;
  getMileageReimbursement(id: string): Promise<MileageReimbursement | undefined>;
  getMileageReimbursementBySession(sessionId: string): Promise<MileageReimbursement | undefined>;
  getMileageReimbursements(filters?: { userId?: string; startDate?: Date; endDate?: Date }): Promise<MileageReimbursement[]>;
  updateMileageReimbursement(id: string, updates: Partial<MileageReimbursement>): Promise<MileageReimbursement>;

  // Meeting intelligence
  createMeeting(meeting: InsertMeeting): Promise<Meeting>;
  getMeeting(id: string): Promise<Meeting | undefined>;
  getMeetingsByStore(storeId: string): Promise<Meeting[]>;
  updateMeeting(id: string, updates: Partial<Meeting>): Promise<Meeting>;
  deleteMeeting(id: string): Promise<void>;

  createMeetingTaskRecommendation(rec: InsertMeetingTaskRecommendation): Promise<MeetingTaskRecommendation>;
  getMeetingTaskRecommendations(meetingId: string): Promise<MeetingTaskRecommendation[]>;
  getMeetingTaskRecommendation(id: string): Promise<MeetingTaskRecommendation | undefined>;
  updateMeetingTaskRecommendation(id: string, updates: Partial<MeetingTaskRecommendation>): Promise<MeetingTaskRecommendation>;
  deleteMeetingTaskRecommendation(id: string): Promise<void>;

  // Day notes
  createDayNote(note: InsertDayNote): Promise<DayNote>;
  getDayNotes(startDate: string, endDate: string): Promise<DayNote[]>;
  getDayNotesByUser(startDate: string, endDate: string, userId: string): Promise<DayNote[]>;
  updateDayNote(id: string, noteText: string): Promise<DayNote>;
  deleteDayNote(id: string): Promise<void>;
  getDayNote(id: string): Promise<DayNote | undefined>;

  // Knowledge documents
  createKnowledgeDocument(doc: InsertKnowledgeDocument): Promise<KnowledgeDocument>;
  getKnowledgeDocuments(storeId?: string): Promise<KnowledgeDocument[]>;
  getKnowledgeDocument(id: string): Promise<KnowledgeDocument | undefined>;
  updateKnowledgeDocument(id: string, updates: Partial<KnowledgeDocument>): Promise<KnowledgeDocument>;
  deleteKnowledgeDocument(id: string): Promise<void>;

  // Training lessons
  createTrainingLesson(lesson: InsertTrainingLesson): Promise<TrainingLesson>;
  getTrainingLessons(moduleId: string): Promise<TrainingLesson[]>;
  updateTrainingLesson(id: string, updates: Partial<TrainingLesson>): Promise<TrainingLesson>;
  deleteTrainingLesson(id: string): Promise<void>;

  // Training questions
  createTrainingQuestion(question: InsertTrainingQuestion): Promise<TrainingQuestion>;
  getTrainingQuestions(lessonId: string): Promise<TrainingQuestion[]>;
  getTrainingQuestion(id: string): Promise<TrainingQuestion | undefined>;

  // Training lesson progress
  upsertTrainingLessonProgress(progress: InsertTrainingLessonProgress): Promise<TrainingLessonProgress>;
  getTrainingLessonProgress(employeeId: string, moduleId?: string): Promise<TrainingLessonProgress[]>;
  getLessonProgress(employeeId: string, lessonId: string): Promise<TrainingLessonProgress | undefined>;

  // Practice schedule (spaced repetition)
  upsertPracticeSchedule(item: InsertTrainingPracticeSchedule): Promise<TrainingPracticeSchedule>;
  getDuePracticeQuestions(employeeId: string, limit?: number): Promise<(TrainingPracticeSchedule & { question: TrainingQuestion })[]>;

  // Training flags
  createTrainingFlag(flag: InsertTrainingFlag): Promise<TrainingFlag>;
  getTrainingFlags(status?: string): Promise<TrainingFlag[]>;
  updateTrainingFlag(id: string, updates: Partial<TrainingFlag>): Promise<TrainingFlag>;

  // Morning learning moments
  upsertMorningLearningMoment(moment: InsertMorningLearningMoment): Promise<MorningLearningMoment>;
  getMorningLearningMoment(storeId: string, date: string): Promise<MorningLearningMoment | undefined>;
  recordMorningMomentAnswer(answer: InsertMorningMomentAnswer): Promise<MorningMomentAnswer>;
  getMorningMomentAnswer(momentId: string, employeeId: string): Promise<MorningMomentAnswer | undefined>;

  // Daily questionnaire
  getDailyQuestionnaire(storeId: string, date: string): Promise<DailyQuestionnaire | undefined>;
  getDailyQuestionnaireById(id: string): Promise<DailyQuestionnaire | undefined>;
  createDailyQuestionnaire(data: InsertDailyQuestionnaire): Promise<DailyQuestionnaire>;
  updateDailyQuestionnaire(id: string, updates: Partial<DailyQuestionnaire>): Promise<DailyQuestionnaire>;
  getQuestionnaireResponse(userId: string, questionnaireId: string): Promise<QuestionnaireResponse | undefined>;
  createQuestionnaireResponse(data: InsertQuestionnaireResponse): Promise<QuestionnaireResponse>;
  getUserBadges(userId: string): Promise<UserBadge[]>;
  getStoreBadges(storeId: string): Promise<UserBadge[]>;
  createUserBadge(data: InsertUserBadge): Promise<UserBadge>;
}

export class DatabaseStorage implements IStorage {
  // User operations
  async getUser(id: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user;
  }

  async getUserByEmail(email: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.email, email));
    return user;
  }

  async upsertUser(userData: UpsertUser): Promise<User> {
    if (userData.email) {
      const [existingByEmail] = await db.select().from(users).where(eq(users.email, userData.email));
      if (existingByEmail && existingByEmail.id !== userData.id) {
        const updateData: Record<string, string | boolean | Date | null> = { updatedAt: new Date(), isActive: true };
        if (userData.firstName) updateData.firstName = userData.firstName;
        if (userData.lastName) updateData.lastName = userData.lastName;
        if (userData.profileImageUrl) updateData.profileImageUrl = userData.profileImageUrl;
        if (!existingByEmail.inviteAcceptedAt && existingByEmail.invitedAt) {
          updateData.inviteAcceptedAt = new Date();
        }
        const [updated] = await db.update(users).set(updateData).where(eq(users.id, existingByEmail.id)).returning();
        return updated;
      }
    }
    const [user] = await db
      .insert(users)
      .values(userData)
      .onConflictDoUpdate({
        target: users.id,
        set: {
          ...userData,
          isActive: true,
          updatedAt: new Date(),
        },
      })
      .returning();
    return user;
  }

  // Time tracking operations
  async createTimeEntry(entry: InsertTimeEntry): Promise<TimeEntry> {
    const [timeEntry] = await db.insert(timeEntries).values(entry).returning();
    return timeEntry;
  }

  async getTimeEntry(id: string): Promise<TimeEntry | undefined> {
    const [entry] = await db
      .select()
      .from(timeEntries)
      .where(eq(timeEntries.id, id))
      .limit(1);
    return entry;
  }

  async getActiveTimeEntry(userId: string): Promise<TimeEntry | undefined> {
    const [entry] = await db
      .select()
      .from(timeEntries)
      .where(and(eq(timeEntries.userId, userId), isNull(timeEntries.clockOutTime)))
      .orderBy(desc(timeEntries.clockInTime))
      .limit(1);
    return entry;
  }

  async updateTimeEntry(id: string, updates: Partial<TimeEntry>): Promise<TimeEntry> {
    const [updated] = await db
      .update(timeEntries)
      .set(updates)
      .where(eq(timeEntries.id, id))
      .returning();
    return updated;
  }

  async getUserTimeEntries(userId: string, startDate?: Date, endDate?: Date): Promise<TimeEntry[]> {
    const conditions = [eq(timeEntries.userId, userId)];
    if (startDate) conditions.push(gte(timeEntries.clockInTime, startDate));
    if (endDate) conditions.push(lte(timeEntries.clockInTime, endDate));

    return await db
      .select()
      .from(timeEntries)
      .where(and(...conditions))
      .orderBy(desc(timeEntries.clockInTime))
      .limit(1000);
  }

  async getAllTimeEntries(startDate?: Date, endDate?: Date): Promise<TimeEntry[]> {
    const conditions = [];
    if (startDate) conditions.push(gte(timeEntries.clockInTime, startDate));
    if (endDate) conditions.push(lte(timeEntries.clockInTime, endDate));

    const query = conditions.length > 0 
      ? db.select().from(timeEntries).where(and(...conditions))
      : db.select().from(timeEntries);

    return await query.orderBy(desc(timeEntries.clockInTime)).limit(1000);
  }

  // Schedule operations
  async createSchedule(schedule: InsertSchedule): Promise<Schedule> {
    const [created] = await db.insert(schedules).values(schedule).returning();
    return created;
  }

  async createSchedulesBatch(scheduleList: InsertSchedule[]): Promise<Schedule[]> {
    if (scheduleList.length === 0) return [];
    return await db.insert(schedules).values(scheduleList).returning();
  }

  async getUserSchedules(userId: string, startDate?: Date, endDate?: Date): Promise<Schedule[]> {
    const conditions = [eq(schedules.userId, userId)];
    if (startDate) conditions.push(gte(schedules.startTime, startDate));
    if (endDate) conditions.push(lte(schedules.startTime, endDate));

    return await db
      .select()
      .from(schedules)
      .where(and(...conditions))
      .orderBy(schedules.startTime);
  }

  async getAllSchedules(startDate?: Date, endDate?: Date, locationId?: string): Promise<Schedule[]> {
    const conditions = [];
    if (locationId) conditions.push(eq(schedules.locationId, locationId));
    if (startDate) conditions.push(gte(schedules.startTime, startDate));
    if (endDate) conditions.push(lte(schedules.startTime, endDate));

    const query = conditions.length > 0 
      ? db.select().from(schedules).where(and(...conditions))
      : db.select().from(schedules);

    return await query.orderBy(schedules.startTime).limit(1000);
  }

  async updateSchedule(id: string, updates: Partial<Schedule>): Promise<Schedule> {
    const [updated] = await db
      .update(schedules)
      .set(updates)
      .where(eq(schedules.id, id))
      .returning();
    return updated;
  }

  async deleteSchedule(id: string): Promise<void> {
    await db.delete(schedules).where(eq(schedules.id, id));
  }

  // Task operations
  async createTask(task: InsertTask): Promise<Task> {
    const [created] = await db.insert(tasks).values(task).returning();
    return created;
  }

  async getTask(id: string): Promise<Task | undefined> {
    const [task] = await db
      .select()
      .from(tasks)
      .where(eq(tasks.id, id))
      .limit(1);
    return task;
  }

  async getUserTasks(userId: string): Promise<Task[]> {
    return await db
      .select()
      .from(tasks)
      .where(eq(tasks.assignedTo, userId))
      .orderBy(desc(tasks.createdAt))
      .limit(200);
  }

  async getAllTasks(locationId?: string): Promise<Task[]> {
    if (locationId) {
      return await db.select().from(tasks).where(eq(tasks.locationId, locationId)).orderBy(desc(tasks.createdAt)).limit(500);
    }
    return await db.select().from(tasks).orderBy(desc(tasks.createdAt)).limit(500);
  }

  async updateTask(id: string, updates: Partial<Task>): Promise<Task> {
    const [updated] = await db
      .update(tasks)
      .set(updates)
      .where(eq(tasks.id, id))
      .returning();
    return updated;
  }

  async deleteTask(id: string): Promise<void> {
    await db.delete(tasks).where(eq(tasks.id, id));
  }

  async getTasksForDate(date: Date): Promise<Task[]> {
    const startOfDay = new Date(date);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(date);
    endOfDay.setHours(23, 59, 59, 999);

    return await db
      .select()
      .from(tasks)
      .where(and(
        gte(tasks.dueDate, startOfDay),
        lte(tasks.dueDate, endOfDay)
      ))
      .orderBy(tasks.dueDate);
  }

  // Chore operations
  async getChoresForDay(dayOfWeek: string, timeOfDay?: string): Promise<Task[]> {
    const conditions = [eq(tasks.dayOfWeek, dayOfWeek)];
    if (timeOfDay) {
      conditions.push(eq(tasks.timeOfDay, timeOfDay));
    }

    return await db
      .select()
      .from(tasks)
      .where(and(...conditions))
      .orderBy(tasks.timeOfDay, tasks.estimatedMinutes);
  }

  async assignChoreToUser(choreId: string, userId: string): Promise<Task> {
    const [updated] = await db
      .update(tasks)
      .set({ 
        assignedTo: userId, 
        status: 'in_progress',
        // Reset signatures when reassigning
        employeeSignedAt: null,
        managerSignedAt: null,
        signedBy: null,
        verifiedBy: null
      })
      .where(eq(tasks.id, choreId))
      .returning();
    return updated;
  }

  async signOffChore(choreId: string, userId: string, isManager: boolean): Promise<Task> {
    const updateData: any = {};
    
    if (isManager) {
      updateData.managerSignedAt = new Date();
      updateData.verifiedBy = userId;
      updateData.status = 'completed';
      updateData.completedAt = new Date();
    } else {
      updateData.employeeSignedAt = new Date();
      updateData.signedBy = userId;
    }

    const [updated] = await db
      .update(tasks)
      .set(updateData)
      .where(eq(tasks.id, choreId))
      .returning();
    return updated;
  }

  async getWeeklyChoreSchedule(): Promise<Record<string, Task[]>> {
    const chores = await db
      .select()
      .from(tasks)
      .where(eq(tasks.isRecurring, true))
      .orderBy(tasks.dayOfWeek, tasks.timeOfDay, tasks.estimatedMinutes);

    const schedule: Record<string, Task[]> = {};
    chores.forEach(chore => {
      if (chore.dayOfWeek) {
        const key = `${chore.dayOfWeek}_${chore.timeOfDay}`;
        if (!schedule[key]) {
          schedule[key] = [];
        }
        schedule[key].push(chore);
      }
    });

    return schedule;
  }

  async getChoresByZone(zone: string): Promise<Task[]> {
    return await db
      .select()
      .from(tasks)
      .where(eq(tasks.choreZone, zone))
      .orderBy(tasks.dayOfWeek, tasks.timeOfDay);
  }

  // Message operations
  async createMessage(message: InsertMessage): Promise<Message> {
    const messageData = {
      ...message,
      readBy: Array.isArray(message.readBy) ? message.readBy : [],
    };
    const [created] = await db.insert(messages).values([messageData] as any).returning();
    return created;
  }

  async getMessages(userId?: string): Promise<Message[]> {
    const query = userId 
      ? db.select().from(messages).where(
          and(
            eq(messages.isAnnouncement, true),
            sql`NOT (${messages.readBy} @> ${JSON.stringify([userId])})`
          )
        )
      : db.select().from(messages);

    return await query.orderBy(desc(messages.createdAt)).limit(200);
  }

  async markMessageAsRead(messageId: string, userId: string): Promise<void> {
    await db
      .update(messages)
      .set({
        readBy: sql`${messages.readBy} || ${JSON.stringify([userId])}`
      })
      .where(eq(messages.id, messageId));
  }

  // Group chat operations
  async createGroup(group: InsertChatGroup): Promise<ChatGroup> {
    const [created] = await db.insert(chatGroups).values(group).returning();
    return created;
  }

  async getGroups(userId: string): Promise<ChatGroup[]> {
    const result = await db
      .select({ group: chatGroups })
      .from(chatGroups)
      .innerJoin(groupMembers, eq(chatGroups.id, groupMembers.groupId))
      .where(and(
        eq(groupMembers.userId, userId),
        eq(chatGroups.isActive, true)
      ))
      .orderBy(desc(chatGroups.updatedAt));
    
    return result.map(row => row.group);
  }

  async addGroupMember(member: InsertGroupMember): Promise<GroupMember> {
    const [created] = await db.insert(groupMembers).values(member).returning();
    return created;
  }

  async removeGroupMember(groupId: string, userId: string): Promise<void> {
    await db
      .delete(groupMembers)
      .where(and(
        eq(groupMembers.groupId, groupId),
        eq(groupMembers.userId, userId)
      ));
  }

  async getGroupMessages(groupId: string): Promise<Message[]> {
    return await db
      .select()
      .from(messages)
      .where(eq(messages.groupId, groupId))
      .orderBy(desc(messages.createdAt))
      .limit(100);
  }

  async getGroupMembers(groupId: string): Promise<GroupMember[]> {
    return await db
      .select()
      .from(groupMembers)
      .where(eq(groupMembers.groupId, groupId))
      .orderBy(groupMembers.joinedAt);
  }

  // Availability operations
  async submitAvailability(availability: InsertUserAvailability[]): Promise<UserAvailability[]> {
    const result = [];
    
    for (const avail of availability) {
      const conditions: any[] = [
        eq(userAvailability.userId, avail.userId),
        eq(userAvailability.date, avail.date),
        eq(userAvailability.timeSlot, avail.timeSlot)
      ];
      if (avail.payrollPeriodId) {
        conditions.push(eq(userAvailability.payrollPeriodId, avail.payrollPeriodId));
      }

      const existing = await db
        .select()
        .from(userAvailability)
        .where(and(...conditions));

      if (existing.length > 0) {
        const [updated] = await db
          .update(userAvailability)
          .set({ 
            isAvailable: avail.isAvailable,
            startTime: avail.startTime,
            endTime: avail.endTime,
            notes: avail.notes,
          })
          .where(eq(userAvailability.id, existing[0].id))
          .returning();
        result.push(updated);
      } else {
        const [created] = await db.insert(userAvailability).values(avail).returning();
        result.push(created);
      }
    }
    
    return result;
  }

  async getUserAvailability(userId: string, payrollPeriodId?: string): Promise<UserAvailability[]> {
    const conditions: any[] = [eq(userAvailability.userId, userId)];
    if (payrollPeriodId) {
      conditions.push(eq(userAvailability.payrollPeriodId, payrollPeriodId));
    }

    return await db
      .select()
      .from(userAvailability)
      .where(and(...conditions))
      .orderBy(userAvailability.date, userAvailability.timeSlot);
  }

  async getUserAvailabilityByDateRange(userId: string, startDate: Date, endDate: Date): Promise<UserAvailability[]> {
    return await db
      .select()
      .from(userAvailability)
      .where(and(
        eq(userAvailability.userId, userId),
        gte(userAvailability.date, startDate),
        lte(userAvailability.date, endDate)
      ))
      .orderBy(userAvailability.date, userAvailability.timeSlot);
  }

  async getAllAvailabilityForPeriod(payrollPeriodId: string): Promise<UserAvailability[]> {
    return await db
      .select()
      .from(userAvailability)
      .where(eq(userAvailability.payrollPeriodId, payrollPeriodId))
      .orderBy(userAvailability.date, userAvailability.timeSlot);
  }

  async getAllAvailabilityByDateRange(startDate: Date, endDate: Date): Promise<UserAvailability[]> {
    return await db
      .select()
      .from(userAvailability)
      .where(and(
        gte(userAvailability.date, startDate),
        lte(userAvailability.date, endDate)
      ))
      .orderBy(userAvailability.userId, userAvailability.date, userAvailability.timeSlot);
  }

  // Availability template operations
  async getAvailabilityTemplate(userId: string): Promise<AvailabilityTemplate | undefined> {
    const [template] = await db
      .select()
      .from(availabilityTemplates)
      .where(eq(availabilityTemplates.userId, userId));
    return template;
  }

  async getAvailabilityTemplatesForUsers(userIds: string[]): Promise<AvailabilityTemplate[]> {
    if (userIds.length === 0) return [];
    return db
      .select()
      .from(availabilityTemplates)
      .where(inArray(availabilityTemplates.userId, userIds));
  }

  async upsertAvailabilityTemplate(
    userId: string,
    slots: Record<string, import('@shared/schema').TemplateSlot>
  ): Promise<AvailabilityTemplate> {
    const [result] = await db
      .insert(availabilityTemplates)
      .values({ userId, slots })
      .onConflictDoUpdate({
        target: availabilityTemplates.userId,
        set: { slots, updatedAt: new Date() },
      })
      .returning();
    return result;
  }

  // Time-off request operations
  async createTimeOffRequest(request: InsertTimeOffRequest): Promise<TimeOffRequest> {
    const [created] = await db.insert(timeOffRequests).values(request).returning();
    return created;
  }

  async getTimeOffRequests(userId?: string): Promise<TimeOffRequest[]> {
    if (userId) {
      return await db
        .select()
        .from(timeOffRequests)
        .where(eq(timeOffRequests.userId, userId))
        .orderBy(desc(timeOffRequests.createdAt))
        .limit(100);
    }
    return await db
      .select()
      .from(timeOffRequests)
      .orderBy(desc(timeOffRequests.createdAt))
      .limit(200);
  }

  async getTimeOffRequest(id: string): Promise<TimeOffRequest | undefined> {
    const [request] = await db
      .select()
      .from(timeOffRequests)
      .where(eq(timeOffRequests.id, id));
    return request;
  }

  async updateTimeOffRequest(id: string, updates: Partial<TimeOffRequest>): Promise<TimeOffRequest> {
    const [updated] = await db
      .update(timeOffRequests)
      .set(updates)
      .where(eq(timeOffRequests.id, id))
      .returning();
    return updated;
  }

  async deleteTimeOffRequest(id: string): Promise<void> {
    await db.delete(timeOffRequests).where(eq(timeOffRequests.id, id));
  }

  // Work location operations
  async createWorkLocation(location: InsertWorkLocation): Promise<WorkLocation> {
    const [created] = await db.insert(workLocations).values(location as any).returning();
    cache.invalidate('work_locations:all');
    return created;
  }

  async getAllWorkLocations(): Promise<WorkLocation[]> {
    return cache.getOrSet('work_locations:all', async () => {
      return await db.select().from(workLocations).where(eq(workLocations.isActive, true));
    }, 60_000);
  }

  async getWorkLocation(id: string): Promise<WorkLocation | undefined> {
    const [location] = await db.select().from(workLocations).where(eq(workLocations.id, id));
    return location;
  }

  // Payroll operations
  async createPayrollPeriod(period: InsertPayrollPeriod): Promise<PayrollPeriod> {
    const [created] = await db.insert(payrollPeriods).values(period).returning();
    return created;
  }

  async getPayrollPeriods(): Promise<PayrollPeriod[]> {
    return await db.select().from(payrollPeriods).orderBy(desc(payrollPeriods.startDate)).limit(100);
  }

  async updatePayrollPeriod(id: string, updates: Partial<PayrollPeriod>): Promise<PayrollPeriod> {
    const [updated] = await db
      .update(payrollPeriods)
      .set(updates)
      .where(eq(payrollPeriods.id, id))
      .returning();
    return updated;
  }

  async getNextPayrollPeriod(): Promise<PayrollPeriod | undefined> {
    const [period] = await db
      .select()
      .from(payrollPeriods)
      .where(eq(payrollPeriods.isProcessed, false))
      .orderBy(payrollPeriods.startDate)
      .limit(1);
    return period;
  }

  // Pay period automation operations
  async getPayPeriodSettings(): Promise<PayPeriodSettings | undefined> {
    const [settings] = await db
      .select()
      .from(payPeriodSettings)
      .orderBy(desc(payPeriodSettings.createdAt))
      .limit(1);
    return settings;
  }

  async updatePayPeriodSettings(settingsData: InsertPayPeriodSettings): Promise<PayPeriodSettings> {
    // Delete existing settings (only one should exist)
    await db.delete(payPeriodSettings);
    
    const [settings] = await db
      .insert(payPeriodSettings)
      .values(settingsData)
      .returning();
    return settings;
  }

  async createNextPayPeriod(): Promise<PayrollPeriod> {
    const settings = await this.getPayPeriodSettings();
    const lastPeriod = await db
      .select()
      .from(payrollPeriods)
      .orderBy(desc(payrollPeriods.endDate))
      .limit(1);

    let startDate: Date;
    let endDate: Date;

    if (lastPeriod.length === 0) {
      // First pay period starts today
      startDate = new Date();
      startDate.setHours(0, 0, 0, 0);
    } else {
      // Start the day after the last period ends
      startDate = new Date(lastPeriod[0].endDate);
      startDate.setDate(startDate.getDate() + 1);
    }

    // Calculate end date based on interval
    endDate = new Date(startDate);
    switch (settings?.intervalType) {
      case 'weekly':
        endDate.setDate(startDate.getDate() + 6);
        break;
      case 'monthly':
        endDate.setMonth(startDate.getMonth() + 1);
        endDate.setDate(startDate.getDate() - 1);
        break;
      default: // 'bi-weekly'
        endDate.setDate(startDate.getDate() + 13);
        break;
    }

    // Calculate deadlines
    const availabilityDeadline = new Date(endDate);
    availabilityDeadline.setDate(endDate.getDate() - (settings?.daysBeforeNotification || 7));

    const scheduleConfirmationDeadline = new Date(startDate);
    scheduleConfirmationDeadline.setDate(startDate.getDate() - (settings?.scheduleGenerationDays || 5));

    const periodData: InsertPayrollPeriod = {
      startDate,
      endDate,
      workflowState: 'created',
      availabilityDeadline,
      scheduleConfirmationDeadline,
      automationMetadata: {
        intervalType: settings?.intervalType || 'bi-weekly',
        isAutomated: true,
        createdAt: new Date().toISOString()
      }
    };

    return await this.createPayrollPeriod(periodData);
  }

  // Schedule confirmation operations
  async createScheduleConfirmation(confirmation: InsertScheduleConfirmation): Promise<ScheduleConfirmation> {
    const [created] = await db.insert(scheduleConfirmations).values(confirmation).returning();
    return created;
  }

  async getScheduleConfirmations(payrollPeriodId: string): Promise<ScheduleConfirmation[]> {
    return await db
      .select()
      .from(scheduleConfirmations)
      .where(eq(scheduleConfirmations.payrollPeriodId, payrollPeriodId))
      .orderBy(scheduleConfirmations.createdAt);
  }

  async updateScheduleConfirmation(id: string, updates: Partial<ScheduleConfirmation>): Promise<ScheduleConfirmation> {
    const [updated] = await db
      .update(scheduleConfirmations)
      .set(updates)
      .where(eq(scheduleConfirmations.id, id))
      .returning();
    return updated;
  }

  // Workflow log operations
  async createWorkflowLog(log: InsertWorkflowLog): Promise<WorkflowLog> {
    const [created] = await db.insert(workflowLogs).values(log).returning();
    return created;
  }

  async getWorkflowLogs(payrollPeriodId: string): Promise<WorkflowLog[]> {
    return await db
      .select()
      .from(workflowLogs)
      .where(eq(workflowLogs.payrollPeriodId, payrollPeriodId))
      .orderBy(workflowLogs.createdAt);
  }

  // AI insights operations
  async createAIInsight(insight: Omit<AIInsight, 'id' | 'createdAt'>): Promise<AIInsight> {
    const [created] = await db.insert(aiInsights).values(insight).returning();
    return created;
  }

  async getUserInsights(userId?: string): Promise<AIInsight[]> {
    const query = userId 
      ? db.select().from(aiInsights).where(eq(aiInsights.userId, userId))
      : db.select().from(aiInsights);

    return await query.orderBy(desc(aiInsights.createdAt)).limit(100);
  }

  async markInsightAsRead(id: string): Promise<void> {
    await db.update(aiInsights).set({ isRead: true }).where(eq(aiInsights.id, id));
  }

  // Push notification operations
  async createPushSubscription(subscription: InsertPushSubscription): Promise<PushSubscription> {
    const [created] = await db.insert(pushSubscriptions).values(subscription).returning();
    return created;
  }

  async getUserPushSubscriptions(userId: string): Promise<PushSubscription[]> {
    return await db
      .select()
      .from(pushSubscriptions)
      .where(eq(pushSubscriptions.userId, userId));
  }

  async deletePushSubscription(id: string): Promise<void> {
    await db.delete(pushSubscriptions).where(eq(pushSubscriptions.id, id));
  }

  // Native push token operations
  async upsertNativePushToken(userId: string, token: string, platform: string): Promise<NativePushToken> {
    const [row] = await db
      .insert(nativePushTokens)
      .values({ userId, token, platform })
      .onConflictDoUpdate({
        target: nativePushTokens.token,
        set: { userId, platform, updatedAt: new Date() },
      })
      .returning();
    return row;
  }

  async getUserNativePushTokens(userId: string): Promise<NativePushToken[]> {
    return await db
      .select()
      .from(nativePushTokens)
      .where(eq(nativePushTokens.userId, userId));
  }

  async deleteNativePushToken(userId: string, token: string): Promise<void> {
    await db
      .delete(nativePushTokens)
      .where(
        and(
          eq(nativePushTokens.userId, userId),
          eq(nativePushTokens.token, token)
        )
      );
  }

  async deleteStaleNativePushTokens(olderThanDays: number): Promise<number> {
    const cutoff = new Date(Date.now() - olderThanDays * 24 * 60 * 60 * 1000);
    const deleted = await db
      .delete(nativePushTokens)
      .where(sql`${nativePushTokens.updatedAt} < ${cutoff}`)
      .returning({ id: nativePushTokens.id });
    return deleted.length;
  }

  // Push credential operations (admin-managed APNs/FCM secrets)
  async getPushCredential(key: string): Promise<string | null> {
    const [row] = await db
      .select()
      .from(pushCredentials)
      .where(eq(pushCredentials.key, key));
    return row?.value ?? null;
  }

  async setPushCredential(key: string, value: string): Promise<void> {
    await db
      .insert(pushCredentials)
      .values({ key, value })
      .onConflictDoUpdate({
        target: pushCredentials.key,
        set: { value, updatedAt: new Date() },
      });
  }

  async createNotificationDeliveryLog(log: InsertNotificationDeliveryLog): Promise<NotificationDeliveryLog> {
    const [created] = await db.insert(notificationDeliveryLogs).values(log).returning();
    return created;
  }

  async getNotificationDeliveryLogs(options?: { channel?: string; userId?: string; notificationType?: string; since?: Date; limit?: number }): Promise<NotificationDeliveryLogWithUser[]> {
    const conditions: any[] = [];
    if (options?.channel) {
      conditions.push(eq(notificationDeliveryLogs.channel, options.channel));
    }
    if (options?.userId) {
      conditions.push(eq(notificationDeliveryLogs.userId, options.userId));
    }
    if (options?.notificationType) {
      conditions.push(eq(notificationDeliveryLogs.notificationType, options.notificationType));
    }
    if (options?.since) {
      conditions.push(sql`${notificationDeliveryLogs.sentAt} >= ${options.since}`);
    }
    const rows = await db
      .select({
        id: notificationDeliveryLogs.id,
        userId: notificationDeliveryLogs.userId,
        notificationType: notificationDeliveryLogs.notificationType,
        channel: notificationDeliveryLogs.channel,
        status: notificationDeliveryLogs.status,
        errorMessage: notificationDeliveryLogs.errorMessage,
        sentAt: notificationDeliveryLogs.sentAt,
        firstName: users.firstName,
        lastName: users.lastName,
      })
      .from(notificationDeliveryLogs)
      .leftJoin(users, eq(notificationDeliveryLogs.userId, users.id))
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(sql`${notificationDeliveryLogs.sentAt} DESC`)
      .limit(options?.limit ?? 200);
    return rows.map((r) => ({
      id: r.id,
      userId: r.userId,
      notificationType: r.notificationType,
      channel: r.channel,
      status: r.status,
      errorMessage: r.errorMessage,
      sentAt: r.sentAt,
      recipientName: r.firstName && r.lastName ? `${r.firstName} ${r.lastName}` : r.firstName || r.lastName || null,
    }));
  }

  async getNotificationDeliveryStats(options?: { since?: Date }): Promise<{ userId: string; recipientName: string | null; total: number; failures: number }[]> {
    const conditions: any[] = [];
    if (options?.since) {
      conditions.push(sql`${notificationDeliveryLogs.sentAt} >= ${options.since}`);
    }
    const rows = await db
      .select({
        userId: notificationDeliveryLogs.userId,
        firstName: users.firstName,
        lastName: users.lastName,
        total: sql<number>`cast(count(*) as int)`,
        failures: sql<number>`cast(sum(case when ${notificationDeliveryLogs.status} = 'failure' then 1 else 0 end) as int)`,
      })
      .from(notificationDeliveryLogs)
      .leftJoin(users, eq(notificationDeliveryLogs.userId, users.id))
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .groupBy(notificationDeliveryLogs.userId, users.firstName, users.lastName)
      .orderBy(sql`sum(case when ${notificationDeliveryLogs.status} = 'failure' then 1 else 0 end) DESC`);
    return rows.map((r) => ({
      userId: r.userId,
      recipientName: r.firstName && r.lastName ? `${r.firstName} ${r.lastName}` : r.firstName || r.lastName || null,
      total: r.total,
      failures: r.failures,
    }));
  }

  async getDistinctNotificationTypes(): Promise<string[]> {
    const rows = await db
      .selectDistinct({ notificationType: notificationDeliveryLogs.notificationType })
      .from(notificationDeliveryLogs)
      .orderBy(notificationDeliveryLogs.notificationType);
    return rows.map((r) => r.notificationType).filter(Boolean) as string[];
  }

  async deleteOldNotificationDeliveryLogs(olderThanDays: number): Promise<number> {
    const cutoff = new Date(Date.now() - olderThanDays * 24 * 60 * 60 * 1000);
    const deleted = await db
      .delete(notificationDeliveryLogs)
      .where(sql`${notificationDeliveryLogs.sentAt} < ${cutoff}`)
      .returning({ id: notificationDeliveryLogs.id });
    return deleted.length;
  }

  // Role management operations
  async getUserWithRole(id: string): Promise<any> {
    // Get the user first
    const user = await this.getUser(id);
    if (!user) return undefined;

    // Get the role if user has one
    let role = null;
    if (user.roleId) {
      role = await this.getRole(user.roleId);
    }

    // Return user with role information
    return {
      ...user,
      role: role ? {
        id: role.id,
        name: role.name,
        displayName: role.displayName,
        description: role.description
      } : null
    };
  }

  async getAllRoles(): Promise<Role[]> {
    return await db.select().from(roles).where(eq(roles.isActive, true)).orderBy(roles.name);
  }

  async getRole(id: string): Promise<Role | undefined> {
    const [role] = await db.select().from(roles).where(eq(roles.id, id));
    return role;
  }

  async createRole(role: InsertRole): Promise<Role> {
    const [created] = await db.insert(roles).values(role).returning();
    return created;
  }

  async updateRole(id: string, updates: Partial<Role>): Promise<Role> {
    const [updated] = await db
      .update(roles)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(roles.id, id))
      .returning();
    return updated;
  }

  async deleteRole(id: string): Promise<void> {
    // Soft delete by setting isActive to false
    await db.update(roles).set({ isActive: false }).where(eq(roles.id, id));
  }

  async assignUserRole(userId: string, roleId: string): Promise<void> {
    await db
      .update(users)
      .set({ roleId, updatedAt: new Date() })
      .where(eq(users.id, userId));
  }

  // Permission management operations
  async getAllPermissions(): Promise<Permission[]> {
    return await db.select().from(permissions).orderBy(permissions.category, permissions.name);
  }

  async getPermissionsByCategory(): Promise<Record<string, Permission[]>> {
    // Normalize legacy/inconsistent category names to canonical keys before grouping
    const CATEGORY_ALIASES: Record<string, string> = {
      time_tracking: 'time',
      scheduling: 'schedule',
    };
    const allPermissions = await this.getAllPermissions();
    return allPermissions.reduce((acc, permission) => {
      const category = CATEGORY_ALIASES[permission.category] ?? permission.category;
      if (!acc[category]) {
        acc[category] = [];
      }
      acc[category].push(permission);
      return acc;
    }, {} as Record<string, Permission[]>);
  }

  async getRolePermissions(roleId: string): Promise<Permission[]> {
    const result = await db
      .select({ permission: permissions })
      .from(rolePermissions)
      .innerJoin(permissions, eq(rolePermissions.permissionId, permissions.id))
      .where(eq(rolePermissions.roleId, roleId));
    
    return result.map(row => row.permission);
  }

  async updateRolePermissions(roleId: string, permissionIds: string[]): Promise<void> {
    await db.delete(rolePermissions).where(eq(rolePermissions.roleId, roleId));
    
    if (permissionIds.length > 0) {
      const newRolePermissions = permissionIds.map(permissionId => ({
        roleId,
        permissionId
      }));

      await db.insert(rolePermissions).values(newRolePermissions);
    }
    cache.invalidatePrefix('permissions:');
  }

  async getUserPermissions(userId: string): Promise<Permission[]> {
    const cacheKey = `permissions:${userId}`;
    const cached = cache.get<Permission[]>(cacheKey);
    if (cached) return cached;

    const userWithRole = await db
      .select({ roleName: roles.name })
      .from(users)
      .innerJoin(roles, eq(users.roleId, roles.id))
      .where(eq(users.id, userId))
      .limit(1);

    let perms: Permission[];

    if (userWithRole.length > 0 && (userWithRole[0].roleName === 'owner' || userWithRole[0].roleName === 'admin')) {
      perms = await db.select().from(permissions);
    } else {
      const result = await db
        .select({ permission: permissions })
        .from(users)
        .innerJoin(roles, eq(users.roleId, roles.id))
        .innerJoin(rolePermissions, eq(roles.id, rolePermissions.roleId))
        .innerJoin(permissions, eq(rolePermissions.permissionId, permissions.id))
        .where(eq(users.id, userId));
      perms = result.map(row => row.permission);
    }

    // Apply per-user permission overrides
    const overrides = await db
      .select()
      .from(userPermissionOverrides)
      .where(eq(userPermissionOverrides.userId, userId));

    if (overrides.length > 0) {
      const permMap = new Map(perms.map(p => [p.name, p]));
      for (const override of overrides) {
        if (override.grant) {
          // Grant: add permission if not already present
          if (!permMap.has(override.permissionName)) {
            const [perm] = await db
              .select()
              .from(permissions)
              .where(eq(permissions.name, override.permissionName))
              .limit(1);
            if (perm) permMap.set(perm.name, perm);
          }
        } else {
          // Revoke: remove permission
          permMap.delete(override.permissionName);
        }
      }
      perms = Array.from(permMap.values());
    }

    cache.set(cacheKey, perms, 2 * 60 * 1000);
    return perms;
  }

  async getUserRoleName(userId: string): Promise<string | null> {
    const [row] = await db
      .select({ roleName: roles.name })
      .from(users)
      .innerJoin(roles, eq(users.roleId, roles.id))
      .where(eq(users.id, userId))
      .limit(1);
    return row?.roleName ?? null;
  }

  async getUserSalesAccessOverride(userId: string): Promise<UserPermissionOverride | null> {
    const [override] = await db
      .select()
      .from(userPermissionOverrides)
      .where(and(
        eq(userPermissionOverrides.userId, userId),
        eq(userPermissionOverrides.permissionName, 'sales.view')
      ))
      .limit(1);
    return override ?? null;
  }

  async setUserSalesAccessOverride(userId: string, grant: boolean | null): Promise<void> {
    if (grant === null) {
      // Remove the override — revert to role default
      await db
        .delete(userPermissionOverrides)
        .where(and(
          eq(userPermissionOverrides.userId, userId),
          eq(userPermissionOverrides.permissionName, 'sales.view')
        ));
    } else {
      // Upsert the override
      await db
        .insert(userPermissionOverrides)
        .values({ userId, permissionName: 'sales.view', grant })
        .onConflictDoUpdate({
          target: [userPermissionOverrides.userId, userPermissionOverrides.permissionName],
          set: { grant, updatedAt: new Date() },
        });
    }
    // Bust the permissions cache for this user
    cache.invalidatePrefix(`permissions:${userId}`);
  }

  // Payroll settings operations
  async getPayrollSettings(): Promise<any> {
    const [settings] = await db.select().from(payPeriodSettings).limit(1);
    return settings;
  }

  async createPayrollSettings(data: any): Promise<any> {
    const [created] = await db.insert(payPeriodSettings).values(data).returning();
    return created;
  }

  async updatePayrollSettings(id: string, updates: any): Promise<any> {
    const [updated] = await db
      .update(payPeriodSettings)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(payPeriodSettings.id, id))
      .returning();
    return updated;
  }

  async getPayrollPeriod(id: string): Promise<any> {
    const [period] = await db.select().from(payrollPeriods).where(eq(payrollPeriods.id, id));
    return period;
  }

  async getUpcomingPayrollPeriods(limit: number): Promise<any[]> {
    return await db
      .select()
      .from(payrollPeriods)
      .where(sql`start_date > NOW()`)
      .orderBy(payrollPeriods.startDate)
      .limit(limit);
  }

  async getLatestPayrollPeriod(): Promise<any> {
    const [period] = await db
      .select()
      .from(payrollPeriods)
      .orderBy(sql`end_date DESC`)
      .limit(1);
    return period;
  }

  async getPendingPayrollPeriods(): Promise<any[]> {
    return await db
      .select()
      .from(payrollPeriods)
      .where(sql`workflow_state NOT IN ('processed', 'finalized')`);
  }

  async getSchedulesByPeriod(periodId: string): Promise<any[]> {
    return await db
      .select()
      .from(schedules)
      .where(eq(schedules.id, periodId));
  }

  async getTimeEntriesByPeriod(periodId: string): Promise<any[]> {
    const period = await this.getPayrollPeriod(periodId);
    if (!period) return [];

    return await db
      .select()
      .from(timeEntries)
      .where(
        sql`clock_in_time >= ${period.startDate} AND clock_in_time <= ${period.endDate}`
      );
  }


  async getAllUsers(): Promise<User[]> {
    return await db.select().from(users).where(
      or(eq(users.isActive, true), isNull(users.isActive))
    );
  }

  async getUsersByRole(roleId: string): Promise<User[]> {
    return await db.select().from(users).where(
      and(
        eq(users.roleId, roleId),
        or(eq(users.isActive, true), isNull(users.isActive))
      )
    );
  }

  async updateUserPayRate(userId: string, hourlyRate: number): Promise<User> {
    const [updatedUser] = await db
      .update(users)
      .set({ hourlyRate: hourlyRate.toString() })
      .where(eq(users.id, userId))
      .returning();
    return updatedUser;
  }

  async updateUserRole(userId: string, roleId: string): Promise<User> {
    const [updatedUser] = await db
      .update(users)
      .set({ roleId })
      .where(eq(users.id, userId))
      .returning();
    cache.invalidate(`permissions:${userId}`);
    return updatedUser;
  }

  async deleteUser(userId: string): Promise<void> {
    await db.delete(users).where(eq(users.id, userId));
  }

  async deactivateUser(userId: string): Promise<User> {
    const [updatedUser] = await db
      .update(users)
      .set({ isActive: false, updatedAt: new Date() })
      .where(eq(users.id, userId))
      .returning();
    cache.invalidate(`permissions:${userId}`);
    cache.invalidate('dashboard:userlist');
    return updatedUser;
  }

  async updateUser(userId: string, updates: Partial<User>): Promise<User> {
    const [updatedUser] = await db
      .update(users)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(users.id, userId))
      .returning();
    return updatedUser;
  }

  async getClockedInUsers(): Promise<{ id: string; firstName: string | null; lastName: string | null }[]> {
    const rows = await db
      .selectDistinct({ id: users.id, firstName: users.firstName, lastName: users.lastName })
      .from(timeEntries)
      .innerJoin(users, eq(timeEntries.userId, users.id))
      .where(isNull(timeEntries.clockOutTime));
    return rows;
  }

  async getCompanySettings(storeId?: string): Promise<CompanySettings | undefined> {
    const cacheKey = storeId ? `company:settings:${storeId}` : 'company:settings';
    const cached = cache.get<CompanySettings>(cacheKey);
    if (cached) return cached;
    const query = storeId
      ? db.select().from(companySettings).where(eq(companySettings.storeId, storeId)).limit(1)
      : db.select().from(companySettings).limit(1);
    const [settings] = await query;
    if (settings) cache.set(cacheKey, settings, 2 * 60 * 1000);
    return settings;
  }

  async updateCompanySettings(updates: Partial<CompanySettings> & { expectedVersion?: number }, storeId?: string): Promise<CompanySettings> {
    const existing = await this.getCompanySettings(storeId);
    const { expectedVersion, ...settingsData } = updates;
    const cacheKey = storeId ? `company:settings:${storeId}` : 'company:settings';

    if (existing) {
      if (expectedVersion !== undefined && expectedVersion !== (existing.version || 1)) {
        throw new Error("Settings were modified by another user. Please refresh and try again.");
      }

      const updatePayload: any = { 
        ...settingsData, 
        updatedAt: new Date(), 
        version: (existing.version || 1) + 1 
      };
      
      if (settingsData.autoClockOutAfterMinutes !== undefined) {
        updatePayload.autoClockOutAfterMinutes = settingsData.autoClockOutAfterMinutes !== null ? settingsData.autoClockOutAfterMinutes.toString() : null;
      }

      const [updated] = await db
        .update(companySettings)
        .set(updatePayload)
        .where(eq(companySettings.id, existing.id))
        .returning();
      cache.invalidate(cacheKey);
      return updated;
    }
    
    const insertData: any = { ...settingsData, version: 1 };
    if (storeId) insertData.storeId = storeId;
    if (settingsData.autoClockOutAfterMinutes !== undefined) {
      insertData.autoClockOutAfterMinutes = settingsData.autoClockOutAfterMinutes !== null ? settingsData.autoClockOutAfterMinutes.toString() : null;
    }

    const [created] = await db
      .insert(companySettings)
      .values(insertData)
      .returning();
    cache.invalidate(cacheKey);
    return created;
  }

  async updateWorkLocation(id: string, updates: Partial<WorkLocation>): Promise<WorkLocation> {
    const finalUpdates: any = { ...updates };
    if (updates.geofenceGraceMinutes !== undefined) {
      finalUpdates.geofenceGraceMinutes = updates.geofenceGraceMinutes !== null ? updates.geofenceGraceMinutes.toString() : "5.00";
    }
    cache.invalidate('work_locations:all');
    const [updated] = await db
      .update(workLocations)
      .set(finalUpdates)
      .where(eq(workLocations.id, id))
      .returning();
    return updated;
  }

  async deleteWorkLocation(id: string): Promise<void> {
    await db.delete(workLocations).where(eq(workLocations.id, id));
    cache.invalidate('work_locations:all');
  }

  async createActivityLog(log: InsertActivityLog): Promise<ActivityLog> {
    const [created] = await db
      .insert(activityLogs)
      .values(log)
      .returning();
    return created;
  }

  async getActivityLogs(limit: number = 50): Promise<ActivityLog[]> {
    return await db
      .select()
      .from(activityLogs)
      .orderBy(desc(activityLogs.createdAt))
      .limit(limit);
  }

  async createHolidayPayRule(rule: InsertHolidayPayRule): Promise<HolidayPayRule> {
    const [created] = await db.insert(holidayPayRules).values(rule).returning();
    return created;
  }

  async getAllHolidayPayRules(): Promise<HolidayPayRule[]> {
    return await db
      .select()
      .from(holidayPayRules)
      .where(eq(holidayPayRules.isActive, true))
      .orderBy(holidayPayRules.month, holidayPayRules.day);
  }

  async deleteHolidayPayRule(id: string): Promise<void> {
    await db.delete(holidayPayRules).where(eq(holidayPayRules.id, id));
  }

  async updateHolidayPayRule(id: string, updates: Partial<HolidayPayRule>): Promise<HolidayPayRule> {
    const [updated] = await db
      .update(holidayPayRules)
      .set(updates)
      .where(eq(holidayPayRules.id, id))
      .returning();
    return updated;
  }

  async createClockEvent(event: InsertClockEvent): Promise<ClockEvent> {
    const [created] = await db.insert(clockEvents).values(event).returning();
    return created;
  }

  async getClockEvents(userId: string, startDate?: Date, endDate?: Date): Promise<ClockEvent[]> {
    const conditions = [eq(clockEvents.userId, userId)];
    if (startDate) conditions.push(gte(clockEvents.createdAt, startDate));
    if (endDate) conditions.push(lte(clockEvents.createdAt, endDate));
    return await db
      .select()
      .from(clockEvents)
      .where(and(...conditions))
      .orderBy(desc(clockEvents.createdAt))
      .limit(500);
  }

  async getAllClockEvents(startDate?: Date, endDate?: Date): Promise<ClockEvent[]> {
    const conditions: ReturnType<typeof eq>[] = [];
    if (startDate) conditions.push(gte(clockEvents.createdAt, startDate));
    if (endDate) conditions.push(lte(clockEvents.createdAt, endDate));
    return await db
      .select()
      .from(clockEvents)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(clockEvents.createdAt))
      .limit(1000);
  }

  async getPerformanceScoreSettings(): Promise<PerformanceScoreSetting[]> {
    return await db.select().from(performanceScoreSettings).orderBy(performanceScoreSettings.category);
  }

  async upsertPerformanceScoreSetting(setting: InsertPerformanceScoreSetting): Promise<PerformanceScoreSetting> {
    const [result] = await db
      .insert(performanceScoreSettings)
      .values(setting)
      .onConflictDoUpdate({
        target: performanceScoreSettings.eventType,
        set: {
          pointValue: setting.pointValue,
          displayName: setting.displayName,
          category: setting.category,
          isActive: setting.isActive,
          updatedBy: setting.updatedBy,
          updatedAt: new Date(),
        },
      })
      .returning();
    return result;
  }

  async getPerformanceScores(startDate?: Date, endDate?: Date): Promise<{ userId: string; totalPoints: number; eventCount: number }[]> {
    const conditions: any[] = [];
    if (startDate) conditions.push(gte(clockEvents.createdAt, startDate));
    if (endDate) conditions.push(lte(clockEvents.createdAt, endDate));

    const result = await db
      .select({
        userId: clockEvents.userId,
        totalPoints: sql<number>`COALESCE(SUM(${clockEvents.pointValue}), 0)::int`,
        eventCount: sql<number>`COUNT(*)::int`,
      })
      .from(clockEvents)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .groupBy(clockEvents.userId)
      .orderBy(sql`SUM(${clockEvents.pointValue}) DESC`);

    return result;
  }

  // SOP operations
  async createSopCategory(category: InsertSopCategory): Promise<SopCategory> {
    const [created] = await db.insert(sopCategories).values(category).returning();
    return created;
  }

  async getSopCategories(storeId?: string): Promise<SopCategory[]> {
    if (storeId) {
      return await db.select().from(sopCategories).where(eq(sopCategories.storeId, storeId)).orderBy(sopCategories.sortOrder);
    }
    return await db.select().from(sopCategories).orderBy(sopCategories.sortOrder);
  }

  async updateSopCategory(id: string, updates: Partial<SopCategory>): Promise<SopCategory> {
    const [updated] = await db
      .update(sopCategories)
      .set(updates)
      .where(eq(sopCategories.id, id))
      .returning();
    return updated;
  }

  async deleteSopCategory(id: string): Promise<void> {
    await db.delete(sopCategories).where(eq(sopCategories.id, id));
  }

  async createSopDocument(doc: InsertSopDocument): Promise<SopDocument> {
    const [created] = await db.insert(sopDocuments).values(doc).returning();
    return created;
  }

  async getSopDocuments(categoryId?: string): Promise<SopDocument[]> {
    if (categoryId) {
      return await db
        .select()
        .from(sopDocuments)
        .where(eq(sopDocuments.categoryId, categoryId))
        .orderBy(sopDocuments.title)
        .limit(200);
    }
    return await db.select().from(sopDocuments).orderBy(sopDocuments.title).limit(200);
  }

  async getSopDocument(id: string): Promise<SopDocument | undefined> {
    const [doc] = await db.select().from(sopDocuments).where(eq(sopDocuments.id, id));
    return doc;
  }

  async updateSopDocument(id: string, updates: Partial<SopDocument>): Promise<SopDocument> {
    const [updated] = await db
      .update(sopDocuments)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(sopDocuments.id, id))
      .returning();
    return updated;
  }

  async deleteSopDocument(id: string): Promise<void> {
    await db.delete(sopDocuments).where(eq(sopDocuments.id, id));
  }

  async searchSopDocuments(query: string): Promise<SopDocument[]> {
    const searchPattern = `%${query}%`;
    return await db
      .select()
      .from(sopDocuments)
      .where(
        and(
          eq(sopDocuments.isPublished, true),
          sql`(${sopDocuments.title} ILIKE ${searchPattern} OR ${sopDocuments.content} ILIKE ${searchPattern} OR ${sopDocuments.summary} ILIKE ${searchPattern})`
        )
      )
      .orderBy(sopDocuments.title);
  }

  // AI Chat operations
  async createAiChatConversation(conv: InsertAiChatConversation): Promise<AiChatConversation> {
    const [created] = await db.insert(aiChatConversations).values(conv).returning();
    return created;
  }

  async getUserConversations(userId: string): Promise<AiChatConversation[]> {
    return await db
      .select()
      .from(aiChatConversations)
      .where(eq(aiChatConversations.userId, userId))
      .orderBy(desc(aiChatConversations.lastMessageAt))
      .limit(50);
  }

  async getConversation(id: string): Promise<AiChatConversation | undefined> {
    const [conv] = await db.select().from(aiChatConversations).where(eq(aiChatConversations.id, id));
    return conv;
  }

  async deleteConversation(id: string): Promise<void> {
    await db.delete(aiChatMessages).where(eq(aiChatMessages.conversationId, id));
    await db.delete(aiChatConversations).where(eq(aiChatConversations.id, id));
  }

  async createAiChatMessage(msg: InsertAiChatMessage): Promise<AiChatMessage> {
    const [created] = await db.insert(aiChatMessages).values(msg).returning();
    await db
      .update(aiChatConversations)
      .set({ lastMessageAt: new Date() })
      .where(eq(aiChatConversations.id, msg.conversationId));
    return created;
  }

  async getConversationMessages(conversationId: string): Promise<AiChatMessage[]> {
    return await db
      .select()
      .from(aiChatMessages)
      .where(eq(aiChatMessages.conversationId, conversationId))
      .orderBy(aiChatMessages.createdAt)
      .limit(200);
  }

  // Training operations
  async createTrainingModule(module: InsertTrainingModule): Promise<TrainingModule> {
    const [created] = await db.insert(trainingModules).values(module).returning();
    return created;
  }

  async getTrainingModules(storeId?: string): Promise<TrainingModule[]> {
    if (storeId) {
      return await db.select().from(trainingModules).where(eq(trainingModules.storeId, storeId)).orderBy(trainingModules.createdAt);
    }
    return await db.select().from(trainingModules).orderBy(trainingModules.createdAt);
  }

  async updateTrainingModule(id: string, updates: Partial<TrainingModule>): Promise<TrainingModule> {
    const [updated] = await db
      .update(trainingModules)
      .set(updates)
      .where(eq(trainingModules.id, id))
      .returning();
    return updated;
  }

  async deleteTrainingModule(id: string): Promise<void> {
    await db.delete(trainingModules).where(eq(trainingModules.id, id));
  }

  async getEmployeeTrainingProgress(userId: string): Promise<EmployeeTrainingProgress[]> {
    return await db
      .select()
      .from(employeeTrainingProgress)
      .where(eq(employeeTrainingProgress.userId, userId))
      .orderBy(employeeTrainingProgress.createdAt);
  }

  async upsertEmployeeTrainingProgress(progress: InsertEmployeeTrainingProgress): Promise<EmployeeTrainingProgress> {
    const existing = await db
      .select()
      .from(employeeTrainingProgress)
      .where(
        and(
          eq(employeeTrainingProgress.userId, progress.userId),
          eq(employeeTrainingProgress.moduleId, progress.moduleId)
        )
      );

    if (existing.length > 0) {
      const [updated] = await db
        .update(employeeTrainingProgress)
        .set(progress)
        .where(eq(employeeTrainingProgress.id, existing[0].id))
        .returning();
      return updated;
    }

    const [created] = await db.insert(employeeTrainingProgress).values(progress).returning();
    return created;
  }

  // Commute alerts
  async createCommuteAlert(alert: InsertCommuteAlert): Promise<CommuteAlert> {
    const [created] = await db.insert(commuteAlerts).values(alert).returning();
    return created;
  }

  async getUserCommuteAlerts(userId: string): Promise<CommuteAlert[]> {
    return await db
      .select()
      .from(commuteAlerts)
      .where(eq(commuteAlerts.userId, userId))
      .orderBy(desc(commuteAlerts.createdAt))
      .limit(50);
  }

  // Shoutouts
  async createShoutout(shoutout: InsertShoutout): Promise<Shoutout> {
    const [created] = await db.insert(shoutouts).values(shoutout as any).returning();
    return created;
  }

  async getShoutouts(limit: number = 50): Promise<Shoutout[]> {
    return await db
      .select()
      .from(shoutouts)
      .orderBy(desc(shoutouts.createdAt))
      .limit(limit);
  }

  async addShoutoutReaction(id: string, userId: string, emoji: string): Promise<Shoutout> {
    const [existing] = await db.select().from(shoutouts).where(eq(shoutouts.id, id));
    if (!existing) throw new Error("Shoutout not found");
    const currentReactions = (existing.reactions || []) as Array<{ userId: string; emoji: string }>;
    const alreadyReacted = currentReactions.find(r => r.userId === userId && r.emoji === emoji);
    let newReactions;
    if (alreadyReacted) {
      newReactions = currentReactions.filter(r => !(r.userId === userId && r.emoji === emoji));
    } else {
      newReactions = [...currentReactions, { userId, emoji }];
    }
    const [updated] = await db
      .update(shoutouts)
      .set({ reactions: newReactions })
      .where(eq(shoutouts.id, id))
      .returning();
    return updated;
  }

  async createTimeEntryEdit(edit: InsertTimeEntryEdit): Promise<TimeEntryEdit> {
    const [created] = await db.insert(timeEntryEdits).values(edit).returning();
    return created;
  }

  async getTimeEntryEdits(timeEntryId: string): Promise<TimeEntryEdit[]> {
    return await db
      .select()
      .from(timeEntryEdits)
      .where(eq(timeEntryEdits.timeEntryId, timeEntryId))
      .orderBy(desc(timeEntryEdits.editedAt));
  }

  async createDiscrepancyResolution(resolution: InsertDiscrepancyResolution): Promise<DiscrepancyResolution> {
    const [created] = await db.insert(discrepancyResolutions).values(resolution).returning();
    return created;
  }

  async getDiscrepancyResolutions(userId: string, startDate: string, endDate: string): Promise<DiscrepancyResolution[]> {
    return await db
      .select()
      .from(discrepancyResolutions)
      .where(
        and(
          eq(discrepancyResolutions.userId, userId),
          sql`${discrepancyResolutions.date} >= ${startDate}`,
          sql`${discrepancyResolutions.date} <= ${endDate}`,
        )
      )
      .orderBy(desc(discrepancyResolutions.resolvedAt));
  }

  async createOffsiteRule(rule: InsertOffsiteAllowanceRule): Promise<OffsiteAllowanceRule> {
    const [created] = await db.insert(offsiteAllowanceRules).values(rule).returning();
    return created;
  }

  async getOffsiteRules(locationId: string): Promise<OffsiteAllowanceRule[]> {
    return await db
      .select()
      .from(offsiteAllowanceRules)
      .where(eq(offsiteAllowanceRules.locationId, locationId))
      .orderBy(offsiteAllowanceRules.name);
  }

  async getOffsiteRule(id: string): Promise<OffsiteAllowanceRule | undefined> {
    const [rule] = await db.select().from(offsiteAllowanceRules).where(eq(offsiteAllowanceRules.id, id));
    return rule;
  }

  async updateOffsiteRule(id: string, updates: Partial<OffsiteAllowanceRule>): Promise<OffsiteAllowanceRule> {
    const [updated] = await db
      .update(offsiteAllowanceRules)
      .set(updates)
      .where(eq(offsiteAllowanceRules.id, id))
      .returning();
    return updated;
  }

  async deleteOffsiteRule(id: string): Promise<void> {
    await db.delete(offsiteAllowanceRules).where(eq(offsiteAllowanceRules.id, id));
  }

  async createOffsiteSession(session: InsertOffsiteSession): Promise<OffsiteSession> {
    const [created] = await db.insert(offsiteSessions).values(session).returning();
    return created;
  }

  async getOffsiteSession(id: string): Promise<OffsiteSession | undefined> {
    const [session] = await db.select().from(offsiteSessions).where(eq(offsiteSessions.id, id));
    return session;
  }

  async getOffsiteSessions(filters?: { userId?: string; status?: string; timeEntryId?: string; locationId?: string; from?: Date; to?: Date }): Promise<OffsiteSession[]> {
    const conditions: any[] = [];
    if (filters?.userId) conditions.push(eq(offsiteSessions.userId, filters.userId));
    if (filters?.status) conditions.push(eq(offsiteSessions.status, filters.status));
    if (filters?.timeEntryId) conditions.push(eq(offsiteSessions.timeEntryId, filters.timeEntryId));
    if (filters?.locationId) conditions.push(eq(offsiteSessions.locationId, filters.locationId));
    if (filters?.from) conditions.push(gte(offsiteSessions.exitTime, filters.from));
    if (filters?.to) conditions.push(lte(offsiteSessions.exitTime, filters.to));
    return await db
      .select()
      .from(offsiteSessions)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(offsiteSessions.exitTime))
      .limit(200);
  }

  async updateOffsiteSession(id: string, updates: Partial<OffsiteSession>): Promise<OffsiteSession> {
    const [updated] = await db
      .update(offsiteSessions)
      .set(updates)
      .where(eq(offsiteSessions.id, id))
      .returning();
    return updated;
  }

  async createOffsiteBreadcrumb(breadcrumb: InsertOffsiteBreadcrumb): Promise<OffsiteBreadcrumb> {
    const [created] = await db.insert(offsiteBreadcrumbs).values(breadcrumb).returning();
    return created;
  }

  async getOffsiteBreadcrumbs(sessionId: string): Promise<OffsiteBreadcrumb[]> {
    return await db
      .select()
      .from(offsiteBreadcrumbs)
      .where(eq(offsiteBreadcrumbs.sessionId, sessionId))
      .orderBy(offsiteBreadcrumbs.timestamp);
  }

  async createOvertimeAlert(alert: InsertOvertimeAlert): Promise<OvertimeAlert> {
    const [created] = await db.insert(overtimeAlerts).values(alert).returning();
    return created;
  }

  async getOvertimeAlerts(filters?: { status?: string; weekStartDate?: Date }): Promise<OvertimeAlert[]> {
    const conditions: ReturnType<typeof eq>[] = [];
    if (filters?.status) conditions.push(eq(overtimeAlerts.status, filters.status));
    if (filters?.weekStartDate) conditions.push(eq(overtimeAlerts.weekStartDate, filters.weekStartDate));
    return await db
      .select()
      .from(overtimeAlerts)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(overtimeAlerts.createdAt))
      .limit(100);
  }

  async updateOvertimeAlert(id: string, updates: Partial<OvertimeAlert>): Promise<OvertimeAlert> {
    const [updated] = await db
      .update(overtimeAlerts)
      .set(updates)
      .where(eq(overtimeAlerts.id, id))
      .returning();
    return updated;
  }

  // Mileage reimbursements
  async createMileageReimbursement(data: InsertMileageReimbursement): Promise<MileageReimbursement> {
    const [created] = await db.insert(mileageReimbursements).values(data).returning();
    return created;
  }

  async getMileageReimbursement(id: string): Promise<MileageReimbursement | undefined> {
    const [rec] = await db.select().from(mileageReimbursements).where(eq(mileageReimbursements.id, id)).limit(1);
    return rec;
  }

  async getMileageReimbursementBySession(sessionId: string): Promise<MileageReimbursement | undefined> {
    const [rec] = await db.select().from(mileageReimbursements).where(eq(mileageReimbursements.sessionId, sessionId)).limit(1);
    return rec;
  }

  async getMileageReimbursements(filters?: { userId?: string; startDate?: Date; endDate?: Date }): Promise<MileageReimbursement[]> {
    const conditions: any[] = [];
    if (filters?.userId) conditions.push(eq(mileageReimbursements.userId, filters.userId));
    if (filters?.startDate) conditions.push(gte(mileageReimbursements.appliedAt, filters.startDate));
    if (filters?.endDate) conditions.push(lte(mileageReimbursements.appliedAt, filters.endDate));

    const query = conditions.length > 0
      ? db.select().from(mileageReimbursements).where(and(...conditions))
      : db.select().from(mileageReimbursements);

    return await query.orderBy(desc(mileageReimbursements.appliedAt)).limit(10000);
  }

  async updateMileageReimbursement(id: string, updates: Partial<MileageReimbursement>): Promise<MileageReimbursement> {
    const [updated] = await db
      .update(mileageReimbursements)
      .set(updates)
      .where(eq(mileageReimbursements.id, id))
      .returning();
    return updated;
  }

  // Meeting intelligence
  async createMeeting(meeting: InsertMeeting): Promise<Meeting> {
    const [created] = await db.insert(meetings).values(meeting).returning();
    return created;
  }

  async getMeeting(id: string): Promise<Meeting | undefined> {
    const [meeting] = await db.select().from(meetings).where(eq(meetings.id, id)).limit(1);
    return meeting;
  }

  async getMeetingsByStore(storeId: string): Promise<Meeting[]> {
    return await db
      .select()
      .from(meetings)
      .where(eq(meetings.storeId, storeId))
      .orderBy(desc(meetings.date))
      .limit(200);
  }

  async updateMeeting(id: string, updates: Partial<Meeting>): Promise<Meeting> {
    const [updated] = await db
      .update(meetings)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(meetings.id, id))
      .returning();
    return updated;
  }

  async deleteMeeting(id: string): Promise<void> {
    await db.delete(meetings).where(eq(meetings.id, id));
  }

  async createMeetingTaskRecommendation(rec: InsertMeetingTaskRecommendation): Promise<MeetingTaskRecommendation> {
    const [created] = await db.insert(meetingTaskRecommendations).values(rec).returning();
    return created;
  }

  async getMeetingTaskRecommendations(meetingId: string): Promise<MeetingTaskRecommendation[]> {
    return await db
      .select()
      .from(meetingTaskRecommendations)
      .where(eq(meetingTaskRecommendations.meetingId, meetingId))
      .orderBy(desc(meetingTaskRecommendations.createdAt));
  }

  async getMeetingTaskRecommendation(id: string): Promise<MeetingTaskRecommendation | undefined> {
    const [rec] = await db.select().from(meetingTaskRecommendations).where(eq(meetingTaskRecommendations.id, id)).limit(1);
    return rec;
  }

  async updateMeetingTaskRecommendation(id: string, updates: Partial<MeetingTaskRecommendation>): Promise<MeetingTaskRecommendation> {
    const [updated] = await db
      .update(meetingTaskRecommendations)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(meetingTaskRecommendations.id, id))
      .returning();
    return updated;
  }

  async deleteMeetingTaskRecommendation(id: string): Promise<void> {
    await db.delete(meetingTaskRecommendations).where(eq(meetingTaskRecommendations.id, id));
  }

  // Day notes
  async createDayNote(note: InsertDayNote): Promise<DayNote> {
    const [created] = await db.insert(dayNotes).values(note).returning();
    return created;
  }

  async getDayNotes(startDate: string, endDate: string): Promise<DayNote[]> {
    return await db
      .select()
      .from(dayNotes)
      .where(and(gte(dayNotes.date, startDate), lte(dayNotes.date, endDate)))
      .orderBy(dayNotes.date);
  }

  async getDayNotesByUser(startDate: string, endDate: string, userId: string): Promise<DayNote[]> {
    return await db
      .select()
      .from(dayNotes)
      .where(
        and(
          gte(dayNotes.date, startDate),
          lte(dayNotes.date, endDate),
          eq(dayNotes.userId, userId)
        )
      )
      .orderBy(dayNotes.date);
  }

  async updateDayNote(id: string, noteText: string): Promise<DayNote> {
    const [updated] = await db
      .update(dayNotes)
      .set({ noteText, updatedAt: new Date() })
      .where(eq(dayNotes.id, id))
      .returning();
    return updated;
  }

  async deleteDayNote(id: string): Promise<void> {
    await db.delete(dayNotes).where(eq(dayNotes.id, id));
  }

  async getDayNote(id: string): Promise<DayNote | undefined> {
    const [note] = await db.select().from(dayNotes).where(eq(dayNotes.id, id)).limit(1);
    return note;
  }

  // Knowledge documents
  async createKnowledgeDocument(doc: InsertKnowledgeDocument): Promise<KnowledgeDocument> {
    const [created] = await db.insert(knowledgeDocuments).values(doc).returning();
    return created;
  }

  async getKnowledgeDocuments(storeId?: string): Promise<KnowledgeDocument[]> {
    if (storeId) {
      return await db
        .select()
        .from(knowledgeDocuments)
        .where(eq(knowledgeDocuments.storeId, storeId))
        .orderBy(desc(knowledgeDocuments.createdAt));
    }
    return await db
      .select()
      .from(knowledgeDocuments)
      .orderBy(desc(knowledgeDocuments.createdAt));
  }

  async getKnowledgeDocument(id: string): Promise<KnowledgeDocument | undefined> {
    const [doc] = await db.select().from(knowledgeDocuments).where(eq(knowledgeDocuments.id, id)).limit(1);
    return doc;
  }

  async updateKnowledgeDocument(id: string, updates: Partial<KnowledgeDocument>): Promise<KnowledgeDocument> {
    const [updated] = await db
      .update(knowledgeDocuments)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(knowledgeDocuments.id, id))
      .returning();
    return updated;
  }

  async deleteKnowledgeDocument(id: string): Promise<void> {
    await db.delete(knowledgeDocuments).where(eq(knowledgeDocuments.id, id));
  }

  // ── Training Lessons ─────────────────────────────────────────────────────────

  async createTrainingLesson(lesson: InsertTrainingLesson): Promise<TrainingLesson> {
    const [row] = await db.insert(trainingLessons).values(lesson).returning();
    return row;
  }

  async getTrainingLessons(moduleId: string): Promise<TrainingLesson[]> {
    return db
      .select()
      .from(trainingLessons)
      .where(eq(trainingLessons.moduleId, moduleId))
      .orderBy(trainingLessons.orderIndex);
  }

  async updateTrainingLesson(id: string, updates: Partial<TrainingLesson>): Promise<TrainingLesson> {
    const [row] = await db.update(trainingLessons).set(updates).where(eq(trainingLessons.id, id)).returning();
    return row;
  }

  async deleteTrainingLesson(id: string): Promise<void> {
    await db.delete(trainingLessons).where(eq(trainingLessons.id, id));
  }

  // ── Training Questions ───────────────────────────────────────────────────────

  async createTrainingQuestion(question: InsertTrainingQuestion): Promise<TrainingQuestion> {
    const [row] = await db.insert(trainingQuestions).values(question).returning();
    return row;
  }

  async getTrainingQuestions(lessonId: string): Promise<TrainingQuestion[]> {
    return db.select().from(trainingQuestions).where(eq(trainingQuestions.lessonId, lessonId));
  }

  async getTrainingQuestion(id: string): Promise<TrainingQuestion | undefined> {
    const [row] = await db.select().from(trainingQuestions).where(eq(trainingQuestions.id, id)).limit(1);
    return row;
  }

  // ── Training Lesson Progress ─────────────────────────────────────────────────

  async upsertTrainingLessonProgress(progress: InsertTrainingLessonProgress): Promise<TrainingLessonProgress> {
    const [row] = await db
      .insert(trainingLessonProgress)
      .values(progress)
      .onConflictDoUpdate({
        target: [trainingLessonProgress.employeeId, trainingLessonProgress.lessonId],
        set: { ...progress, updatedAt: new Date() },
      })
      .returning();
    return row;
  }

  async getTrainingLessonProgress(employeeId: string, moduleId?: string): Promise<TrainingLessonProgress[]> {
    const conditions = [eq(trainingLessonProgress.employeeId, employeeId)];
    if (moduleId) conditions.push(eq(trainingLessonProgress.moduleId, moduleId));
    return db.select().from(trainingLessonProgress).where(and(...conditions));
  }

  async getLessonProgress(employeeId: string, lessonId: string): Promise<TrainingLessonProgress | undefined> {
    const [row] = await db
      .select()
      .from(trainingLessonProgress)
      .where(and(eq(trainingLessonProgress.employeeId, employeeId), eq(trainingLessonProgress.lessonId, lessonId)))
      .limit(1);
    return row;
  }

  // ── Practice Schedule ────────────────────────────────────────────────────────

  async upsertPracticeSchedule(item: InsertTrainingPracticeSchedule): Promise<TrainingPracticeSchedule> {
    const [row] = await db
      .insert(trainingPracticeSchedule)
      .values(item)
      .onConflictDoUpdate({
        target: [trainingPracticeSchedule.employeeId, trainingPracticeSchedule.questionId],
        set: item,
      })
      .returning();
    return row;
  }

  async getDuePracticeQuestions(employeeId: string, limit = 5): Promise<(TrainingPracticeSchedule & { question: TrainingQuestion })[]> {
    const now = new Date();
    const rows = await db
      .select()
      .from(trainingPracticeSchedule)
      .innerJoin(trainingQuestions, eq(trainingPracticeSchedule.questionId, trainingQuestions.id))
      .where(and(eq(trainingPracticeSchedule.employeeId, employeeId), lte(trainingPracticeSchedule.nextReviewAt, now)))
      .orderBy(trainingPracticeSchedule.nextReviewAt)
      .limit(limit);
    return rows.map(r => ({ ...r.training_practice_schedule, question: r.training_questions }));
  }

  // ── Training Flags ───────────────────────────────────────────────────────────

  async createTrainingFlag(flag: InsertTrainingFlag): Promise<TrainingFlag> {
    const [row] = await db.insert(trainingFlags).values(flag).returning();
    return row;
  }

  async getTrainingFlags(status?: string): Promise<TrainingFlag[]> {
    if (status) {
      return db.select().from(trainingFlags).where(eq(trainingFlags.status, status)).orderBy(desc(trainingFlags.createdAt));
    }
    return db.select().from(trainingFlags).orderBy(desc(trainingFlags.createdAt));
  }

  async updateTrainingFlag(id: string, updates: Partial<TrainingFlag>): Promise<TrainingFlag> {
    const [row] = await db.update(trainingFlags).set(updates).where(eq(trainingFlags.id, id)).returning();
    return row;
  }

  // ── Morning Learning Moments ─────────────────────────────────────────────────

  async upsertMorningLearningMoment(moment: InsertMorningLearningMoment): Promise<MorningLearningMoment> {
    const [row] = await db
      .insert(morningLearningMoments)
      .values(moment)
      .onConflictDoUpdate({
        target: [morningLearningMoments.storeId, morningLearningMoments.momentDate],
        set: moment,
      })
      .returning();
    return row;
  }

  async getMorningLearningMoment(storeId: string, date: string): Promise<MorningLearningMoment | undefined> {
    const [row] = await db
      .select()
      .from(morningLearningMoments)
      .where(and(eq(morningLearningMoments.storeId, storeId), eq(morningLearningMoments.momentDate, date)))
      .limit(1);
    return row;
  }

  async recordMorningMomentAnswer(answer: InsertMorningMomentAnswer): Promise<MorningMomentAnswer> {
    const [row] = await db.insert(morningMomentAnswers).values(answer).returning();
    return row;
  }

  async getMorningMomentAnswer(momentId: string, employeeId: string): Promise<MorningMomentAnswer | undefined> {
    const [row] = await db
      .select()
      .from(morningMomentAnswers)
      .where(and(eq(morningMomentAnswers.momentId, momentId), eq(morningMomentAnswers.employeeId, employeeId)))
      .limit(1);
    return row;
  }

  async getDailyQuestionnaire(storeId: string, date: string): Promise<DailyQuestionnaire | undefined> {
    const [row] = await db
      .select()
      .from(dailyQuestionnaires)
      .where(and(eq(dailyQuestionnaires.storeId, storeId), eq(dailyQuestionnaires.quizDate, date)))
      .limit(1);
    return row;
  }

  async getDailyQuestionnaireById(id: string): Promise<DailyQuestionnaire | undefined> {
    const [row] = await db.select().from(dailyQuestionnaires).where(eq(dailyQuestionnaires.id, id)).limit(1);
    return row;
  }

  async createDailyQuestionnaire(data: InsertDailyQuestionnaire): Promise<DailyQuestionnaire> {
    const [row] = await db.insert(dailyQuestionnaires).values(data).returning();
    return row;
  }

  async updateDailyQuestionnaire(id: string, updates: Partial<DailyQuestionnaire>): Promise<DailyQuestionnaire> {
    const [row] = await db
      .update(dailyQuestionnaires)
      .set(updates)
      .where(eq(dailyQuestionnaires.id, id))
      .returning();
    return row;
  }

  async getQuestionnaireResponse(userId: string, questionnaireId: string): Promise<QuestionnaireResponse | undefined> {
    const [row] = await db
      .select()
      .from(questionnaireResponses)
      .where(and(eq(questionnaireResponses.userId, userId), eq(questionnaireResponses.questionnaireId, questionnaireId)))
      .limit(1);
    return row;
  }

  async createQuestionnaireResponse(data: InsertQuestionnaireResponse): Promise<QuestionnaireResponse> {
    const [row] = await db.insert(questionnaireResponses).values(data).returning();
    return row;
  }

  async getUserBadges(userId: string): Promise<UserBadge[]> {
    return db.select().from(userBadges).where(eq(userBadges.userId, userId));
  }

  async getStoreBadges(storeId: string): Promise<UserBadge[]> {
    return db.select().from(userBadges).where(eq(userBadges.storeId, storeId));
  }

  async createUserBadge(data: InsertUserBadge): Promise<UserBadge> {
    const [row] = await db.insert(userBadges).values(data).returning();
    return row;
  }
}

export const storage = new DatabaseStorage();
