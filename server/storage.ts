import {
  users,
  companies,
  timeEntries,
  schedules,
  tasks,
  messages,
  chatGroups,
  groupMembers,
  workLocations,
  payrollPeriods,
  userAvailability,
  payPeriodSettings,
  scheduleConfirmations,
  workflowLogs,
  aiInsights,
  pushSubscriptions,
  roles,
  permissions,
  rolePermissions,
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
  type Company,
  type InsertCompany,
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
  type Role,
  type InsertRole,
  type Permission,
  type InsertPermission,
  type RolePermission,
  type InsertRolePermission,
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
  overtimeAlerts,
  type TimeEntryEdit,
  type InsertTimeEntryEdit,
  type OffsiteAllowanceRule,
  type InsertOffsiteAllowanceRule,
  type OffsiteSession,
  type InsertOffsiteSession,
  type OvertimeAlert,
  type InsertOvertimeAlert,
} from "@shared/schema";
import { db } from "./db";
import { eq, and, desc, gte, lte, isNull, sql, type SQL } from "drizzle-orm";
import { cache } from "./lib/cache";

export interface IStorage {
  // Company operations
  getOrCreateDefaultCompany(): Promise<Company>;
  getCompany(id: string): Promise<Company | undefined>;
  getAllCompanies(): Promise<Company[]>;
  createCompany(company: InsertCompany): Promise<Company>;

  // User operations (mandatory for Replit Auth)
  getUser(id: string): Promise<User | undefined>;
  upsertUser(user: UpsertUser): Promise<User>;
  
  // Time tracking operations
  createTimeEntry(entry: InsertTimeEntry): Promise<TimeEntry>;
  getTimeEntry(id: string, companyId: string): Promise<TimeEntry | undefined>;
  getActiveTimeEntry(userId: string, companyId: string): Promise<TimeEntry | undefined>;
  updateTimeEntry(id: string, companyId: string, updates: Partial<TimeEntry>): Promise<TimeEntry>;
  getUserTimeEntries(userId: string, companyId: string, startDate?: Date, endDate?: Date): Promise<TimeEntry[]>;
  getAllTimeEntries(startDate?: Date, endDate?: Date, companyId?: string): Promise<TimeEntry[]>;
  
  // Schedule operations
  createSchedule(schedule: InsertSchedule): Promise<Schedule>;
  createSchedulesBatch(scheduleList: InsertSchedule[]): Promise<Schedule[]>;
  getUserSchedules(userId: string, companyId: string, startDate?: Date, endDate?: Date): Promise<Schedule[]>;
  getAllSchedules(startDate?: Date, endDate?: Date, companyId?: string): Promise<Schedule[]>;
  getSchedule(id: string, companyId: string): Promise<Schedule | undefined>;
  updateSchedule(id: string, companyId: string, updates: Partial<Schedule>): Promise<Schedule>;
  deleteSchedule(id: string, companyId: string): Promise<void>;
  
  // Task operations
  createTask(task: InsertTask): Promise<Task>;
  getTask(id: string, companyId: string): Promise<Task | undefined>;
  getUserTasks(userId: string, companyId: string): Promise<Task[]>;
  getAllTasks(companyId?: string): Promise<Task[]>;
  updateTask(id: string, companyId: string, updates: Partial<Task>): Promise<Task>;
  deleteTask(id: string, companyId: string): Promise<void>;
  getTasksForDate(date: Date, companyId?: string): Promise<Task[]>;
  
  // Chore operations
  getChoresForDay(dayOfWeek: string, timeOfDay?: string, companyId?: string): Promise<Task[]>;
  assignChoreToUser(choreId: string, companyId: string, userId: string): Promise<Task>;
  signOffChore(choreId: string, companyId: string, userId: string, isManager: boolean): Promise<Task>;
  getWeeklyChoreSchedule(companyId?: string): Promise<Record<string, Task[]>>;
  getChoresByZone(zone: string, companyId?: string): Promise<Task[]>;
  
  // Message operations
  createMessage(message: InsertMessage): Promise<Message>;
  getMessages(userId?: string, companyId?: string): Promise<Message[]>;
  
  // Group chat operations
  createGroup(group: InsertChatGroup): Promise<ChatGroup>;
  getGroups(userId: string, companyId?: string): Promise<ChatGroup[]>;
  addGroupMember(member: InsertGroupMember): Promise<GroupMember>;
  removeGroupMember(groupId: string, userId: string): Promise<void>;
  getGroupMessages(groupId: string, companyId: string): Promise<Message[]>;
  getGroupMembers(groupId: string, companyId: string): Promise<GroupMember[]>;
  markMessageAsRead(messageId: string, userId: string, companyId: string): Promise<void>;
  
  // Availability operations
  submitAvailability(availability: InsertUserAvailability[]): Promise<UserAvailability[]>;
  getUserAvailability(userId: string, companyId: string, payrollPeriodId?: string): Promise<UserAvailability[]>;
  getUserAvailabilityByDateRange(userId: string, companyId: string, startDate: Date, endDate: Date): Promise<UserAvailability[]>;
  getAllAvailabilityForPeriod(payrollPeriodId: string, companyId?: string): Promise<UserAvailability[]>;
  getAllAvailabilityByDateRange(startDate: Date, endDate: Date, companyId?: string): Promise<UserAvailability[]>;

  // Time-off request operations
  createTimeOffRequest(request: InsertTimeOffRequest): Promise<TimeOffRequest>;
  getTimeOffRequests(userId?: string, companyId?: string): Promise<TimeOffRequest[]>;
  getTimeOffRequest(id: string, companyId: string): Promise<TimeOffRequest | undefined>;
  updateTimeOffRequest(id: string, companyId: string, updates: Partial<TimeOffRequest>): Promise<TimeOffRequest>;
  deleteTimeOffRequest(id: string, companyId: string): Promise<void>;
  
  // Work location operations
  createWorkLocation(location: InsertWorkLocation): Promise<WorkLocation>;
  getAllWorkLocations(companyId?: string): Promise<WorkLocation[]>;
  getWorkLocation(id: string, companyId: string): Promise<WorkLocation | undefined>;
  
  // Payroll operations
  createPayrollPeriod(period: InsertPayrollPeriod): Promise<PayrollPeriod>;
  getPayrollPeriods(companyId?: string): Promise<PayrollPeriod[]>;
  getPayrollPeriod(id: string, companyId: string): Promise<PayrollPeriod | undefined>;
  getPayrollPeriodByIdInternal(id: string): Promise<PayrollPeriod | undefined>;
  updatePayrollPeriod(id: string, updates: Partial<PayrollPeriod>, companyId: string): Promise<PayrollPeriod>;
  getUpcomingPayrollPeriods(limit: number, companyId?: string): Promise<PayrollPeriod[]>;
  getLatestPayrollPeriod(companyId?: string): Promise<PayrollPeriod | undefined>;
  getPendingPayrollPeriods(companyId?: string): Promise<PayrollPeriod[]>;
  getTimeEntriesByPeriod(periodId: string, companyId?: string): Promise<any[]>;
  getNextPayrollPeriod(companyId?: string): Promise<PayrollPeriod | undefined>;
  
  // Pay period automation operations
  getPayPeriodSettings(companyId?: string): Promise<PayPeriodSettings | undefined>;
  updatePayPeriodSettings(settings: InsertPayPeriodSettings): Promise<PayPeriodSettings>;
  createNextPayPeriod(companyId?: string): Promise<PayrollPeriod>;
  
  // Payroll settings (legacy API used by setup routes)
  getPayrollSettings(companyId: string): Promise<any>;
  createPayrollSettings(data: any): Promise<any>;
  updatePayrollSettings(id: string, updates: any): Promise<any>;
  
  // Schedule confirmation operations
  createScheduleConfirmation(confirmation: InsertScheduleConfirmation): Promise<ScheduleConfirmation>;
  getScheduleConfirmations(payrollPeriodId: string, companyId: string): Promise<ScheduleConfirmation[]>;
  updateScheduleConfirmation(id: string, updates: Partial<ScheduleConfirmation>, companyId: string): Promise<ScheduleConfirmation>;
  
  // Workflow log operations
  createWorkflowLog(log: InsertWorkflowLog): Promise<WorkflowLog>;
  getWorkflowLogs(payrollPeriodId: string, companyId: string): Promise<WorkflowLog[]>;
  
  // AI insights operations
  createAIInsight(insight: Omit<AIInsight, 'id' | 'createdAt'>): Promise<AIInsight>;
  getUserInsights(userId?: string, companyId?: string): Promise<AIInsight[]>;
  markInsightAsRead(id: string, companyId: string): Promise<void>;
  
  // Push notification operations
  createPushSubscription(subscription: InsertPushSubscription): Promise<PushSubscription>;
  getUserPushSubscriptions(userId: string): Promise<PushSubscription[]>;
  deletePushSubscription(id: string): Promise<void>;
  
  // Role management operations
  getUserWithRole(id: string): Promise<UserWithRole | undefined>;
  getAllRoles(): Promise<Role[]>;
  getRole(id: string): Promise<Role | undefined>;
  createRole(role: InsertRole): Promise<Role>;
  updateRole(id: string, updates: Partial<Role>): Promise<Role>;
  deleteRole(id: string): Promise<void>;
  assignUserRole(userId: string, roleId: string, companyId: string): Promise<void>;
  
  // Permission management operations
  getAllPermissions(): Promise<Permission[]>;
  getPermissionsByCategory(): Promise<Record<string, Permission[]>>;
  getRolePermissions(roleId: string): Promise<Permission[]>;
  updateRolePermissions(roleId: string, permissionIds: string[]): Promise<void>;
  getUserPermissions(userId: string): Promise<Permission[]>;
  
  // Company settings operations
  getCompanySettings(companyId?: string): Promise<CompanySettings | undefined>;
  updateCompanySettings(settings: InsertCompanySettings, companyId?: string): Promise<CompanySettings>;
  
  // Work location update/delete
  updateWorkLocation(id: string, companyId: string, updates: Partial<WorkLocation>): Promise<WorkLocation>;
  deleteWorkLocation(id: string, companyId: string): Promise<void>;
  
  // Activity log operations
  createActivityLog(log: InsertActivityLog): Promise<ActivityLog>;
  getActivityLogs(limit?: number, companyId?: string): Promise<ActivityLog[]>;

  // Clock events operations
  createClockEvent(event: InsertClockEvent): Promise<ClockEvent>;
  getClockEvents(userId: string, startDate?: Date, endDate?: Date, companyId?: string): Promise<ClockEvent[]>;
  getAllClockEvents(startDate?: Date, endDate?: Date, companyId?: string): Promise<ClockEvent[]>;

  // Performance score settings operations
  getPerformanceScoreSettings(companyId?: string): Promise<PerformanceScoreSetting[]>;
  upsertPerformanceScoreSetting(setting: InsertPerformanceScoreSetting): Promise<PerformanceScoreSetting>;
  getPerformanceScores(startDate?: Date, endDate?: Date, companyId?: string): Promise<{ userId: string; totalPoints: number; eventCount: number }[]>;
  
  // User management
  getAllUsers(companyId?: string): Promise<User[]>;
  updateUserRole(userId: string, roleId: string, companyId: string): Promise<User>;
  updateUserPayRate(userId: string, hourlyRate: number, companyId: string): Promise<User>;
  deleteUser(userId: string, companyId: string): Promise<void>;
  deactivateUser(userId: string, companyId: string): Promise<User>;
  updateUser(userId: string, updates: Partial<User>, companyId: string): Promise<User>;

  // Holiday pay rules
  createHolidayPayRule(rule: InsertHolidayPayRule): Promise<HolidayPayRule>;
  getAllHolidayPayRules(companyId?: string): Promise<HolidayPayRule[]>;
  getHolidayPayRule(id: string, companyId: string): Promise<HolidayPayRule | undefined>;
  deleteHolidayPayRule(id: string, companyId: string): Promise<void>;
  updateHolidayPayRule(id: string, companyId: string, updates: Partial<HolidayPayRule>): Promise<HolidayPayRule>;

  // SOP operations
  createSopCategory(category: InsertSopCategory): Promise<SopCategory>;
  getSopCategories(companyId?: string): Promise<SopCategory[]>;
  updateSopCategory(id: string, companyId: string, updates: Partial<SopCategory>): Promise<SopCategory>;
  deleteSopCategory(id: string, companyId: string): Promise<void>;
  
  createSopDocument(doc: InsertSopDocument): Promise<SopDocument>;
  getSopDocuments(categoryId?: string, companyId?: string): Promise<SopDocument[]>;
  getSopDocument(id: string, companyId: string): Promise<SopDocument | undefined>;
  updateSopDocument(id: string, companyId: string, updates: Partial<SopDocument>): Promise<SopDocument>;
  deleteSopDocument(id: string, companyId: string): Promise<void>;
  searchSopDocuments(query: string, companyId?: string): Promise<SopDocument[]>;
  
  // AI Chat operations
  createAiChatConversation(conv: InsertAiChatConversation): Promise<AiChatConversation>;
  getUserConversations(userId: string, companyId: string): Promise<AiChatConversation[]>;
  getConversation(id: string, companyId: string): Promise<AiChatConversation | undefined>;
  deleteConversation(id: string, companyId: string): Promise<void>;
  
  createAiChatMessage(msg: InsertAiChatMessage): Promise<AiChatMessage>;
  getConversationMessages(conversationId: string, companyId: string): Promise<AiChatMessage[]>;
  
  // Training operations
  createTrainingModule(module: InsertTrainingModule): Promise<TrainingModule>;
  getTrainingModules(companyId?: string): Promise<TrainingModule[]>;
  updateTrainingModule(id: string, companyId: string, updates: Partial<TrainingModule>): Promise<TrainingModule>;
  deleteTrainingModule(id: string, companyId: string): Promise<void>;
  
  getEmployeeTrainingProgress(userId: string, companyId: string): Promise<EmployeeTrainingProgress[]>;
  upsertEmployeeTrainingProgress(progress: InsertEmployeeTrainingProgress): Promise<EmployeeTrainingProgress>;
  
  // Commute alerts
  createCommuteAlert(alert: InsertCommuteAlert): Promise<CommuteAlert>;
  getUserCommuteAlerts(userId: string, companyId: string): Promise<CommuteAlert[]>;

  // Shoutouts
  createShoutout(shoutout: InsertShoutout): Promise<Shoutout>;
  getShoutouts(limit?: number, companyId?: string): Promise<Shoutout[]>;
  addShoutoutReaction(id: string, companyId: string, userId: string, emoji: string): Promise<Shoutout>;

  // Time entry edit audit trail
  createTimeEntryEdit(edit: InsertTimeEntryEdit): Promise<TimeEntryEdit>;
  getTimeEntryEdits(timeEntryId: string, companyId: string): Promise<TimeEntryEdit[]>;

  // Off-site allowance rules
  createOffsiteRule(rule: InsertOffsiteAllowanceRule): Promise<OffsiteAllowanceRule>;
  getOffsiteRules(locationId: string, companyId?: string): Promise<OffsiteAllowanceRule[]>;
  getOffsiteRule(id: string, companyId?: string): Promise<OffsiteAllowanceRule | undefined>;
  updateOffsiteRule(id: string, updates: Partial<OffsiteAllowanceRule>, companyId?: string): Promise<OffsiteAllowanceRule>;
  deleteOffsiteRule(id: string, companyId?: string): Promise<void>;

  // Off-site sessions
  createOffsiteSession(session: InsertOffsiteSession): Promise<OffsiteSession>;
  getOffsiteSessions(filters?: { userId?: string; status?: string; timeEntryId?: string; companyId?: string }): Promise<OffsiteSession[]>;
  updateOffsiteSession(id: string, companyId: string, updates: Partial<OffsiteSession>): Promise<OffsiteSession>;

  // Overtime alerts
  createOvertimeAlert(alert: InsertOvertimeAlert): Promise<OvertimeAlert>;
  getOvertimeAlerts(filters?: { status?: string; weekStartDate?: Date; companyId?: string }): Promise<OvertimeAlert[]>;
  updateOvertimeAlert(id: string, companyId: string, updates: Partial<OvertimeAlert>): Promise<OvertimeAlert>;
}

export class DatabaseStorage implements IStorage {
  // Company operations
  async getOrCreateDefaultCompany(): Promise<Company> {
    const cached = cache.get<Company>('company:default');
    if (cached) return cached;
    const [existing] = await db.select().from(companies).limit(1);
    if (existing) {
      cache.set('company:default', existing, 5 * 60 * 1000);
      return existing;
    }
    const [created] = await db.insert(companies).values({ name: 'My Company', plan: 'starter' }).returning();
    cache.set('company:default', created, 5 * 60 * 1000);
    return created;
  }

  async getCompany(id: string): Promise<Company | undefined> {
    const [company] = await db.select().from(companies).where(eq(companies.id, id));
    return company;
  }

  async getAllCompanies(): Promise<Company[]> {
    return await db.select().from(companies);
  }

  async createCompany(company: InsertCompany): Promise<Company> {
    const [created] = await db.insert(companies).values(company).returning();
    return created;
  }

  // User operations
  async getUser(id: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user;
  }

  async upsertUser(userData: UpsertUser): Promise<User> {
    if (userData.email) {
      const [existingByEmail] = await db.select().from(users).where(eq(users.email, userData.email));
      if (existingByEmail && existingByEmail.id !== userData.id) {
        const updateData: Record<string, string | Date | null> = { updatedAt: new Date() };
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
          updatedAt: new Date(),
        },
      })
      .returning();
    return user;
  }

  // Time tracking operations
  async createTimeEntry(entry: InsertTimeEntry): Promise<TimeEntry> {
    if (!entry.companyId) throw new Error('[Storage] createTimeEntry requires companyId for tenant isolation');
    const [timeEntry] = await db.insert(timeEntries).values(entry).returning();
    return timeEntry;
  }

  async getTimeEntry(id: string, companyId: string): Promise<TimeEntry | undefined> {
    const [entry] = await db
      .select()
      .from(timeEntries)
      .where(and(eq(timeEntries.id, id), eq(timeEntries.companyId, companyId)))
      .limit(1);
    return entry;
  }

  async getActiveTimeEntry(userId: string, companyId: string): Promise<TimeEntry | undefined> {
    if (!companyId) throw new Error('[Storage] getActiveTimeEntry requires companyId for tenant isolation');
    const [entry] = await db
      .select()
      .from(timeEntries)
      .where(and(eq(timeEntries.userId, userId), isNull(timeEntries.clockOutTime), eq(timeEntries.companyId, companyId)))
      .orderBy(desc(timeEntries.clockInTime))
      .limit(1);
    return entry;
  }

  async updateTimeEntry(id: string, companyId: string, updates: Partial<TimeEntry>): Promise<TimeEntry> {
    const [updated] = await db
      .update(timeEntries)
      .set(updates)
      .where(and(eq(timeEntries.id, id), eq(timeEntries.companyId, companyId)))
      .returning();
    if (!updated) throw new Error('[Storage] Time entry not found or access denied');
    return updated;
  }

  async getUserTimeEntries(userId: string, companyId: string, startDate?: Date, endDate?: Date): Promise<TimeEntry[]> {
    if (!companyId) throw new Error('[Storage] getUserTimeEntries requires companyId for tenant isolation');
    const conditions = [eq(timeEntries.userId, userId), eq(timeEntries.companyId, companyId)];
    if (startDate) conditions.push(gte(timeEntries.clockInTime, startDate));
    if (endDate) conditions.push(lte(timeEntries.clockInTime, endDate));

    return await db
      .select()
      .from(timeEntries)
      .where(and(...conditions))
      .orderBy(desc(timeEntries.clockInTime))
      .limit(1000);
  }

  async getAllTimeEntries(startDate?: Date, endDate?: Date, companyId?: string): Promise<TimeEntry[]> {
    if (!companyId) throw new Error('[Storage] getAllTimeEntries requires companyId for tenant isolation');
    const conditions: ReturnType<typeof eq>[] = [eq(timeEntries.companyId, companyId)];
    if (startDate) conditions.push(gte(timeEntries.clockInTime, startDate));
    if (endDate) conditions.push(lte(timeEntries.clockInTime, endDate));

    return await db.select().from(timeEntries).where(and(...conditions)).orderBy(desc(timeEntries.clockInTime)).limit(1000);
  }

  // Schedule operations
  async createSchedule(schedule: InsertSchedule): Promise<Schedule> {
    if (!schedule.companyId) throw new Error('[Storage] createSchedule requires companyId for tenant isolation');
    const [created] = await db.insert(schedules).values(schedule).returning();
    return created;
  }

  async createSchedulesBatch(scheduleList: InsertSchedule[]): Promise<Schedule[]> {
    if (scheduleList.length === 0) return [];
    return await db.insert(schedules).values(scheduleList).returning();
  }

  async getUserSchedules(userId: string, companyId: string, startDate?: Date, endDate?: Date): Promise<Schedule[]> {
    if (!companyId) throw new Error('[Storage] getUserSchedules requires companyId for tenant isolation');
    const conditions = [eq(schedules.userId, userId), eq(schedules.companyId, companyId)];
    if (startDate) conditions.push(gte(schedules.startTime, startDate));
    if (endDate) conditions.push(lte(schedules.startTime, endDate));

    return await db
      .select()
      .from(schedules)
      .where(and(...conditions))
      .orderBy(schedules.startTime);
  }

  async getAllSchedules(startDate?: Date, endDate?: Date, companyId?: string): Promise<Schedule[]> {
    if (!companyId) throw new Error('[Storage] getAllSchedules requires companyId for tenant isolation');
    const conditions: ReturnType<typeof eq>[] = [eq(schedules.companyId, companyId)];
    if (startDate) conditions.push(gte(schedules.startTime, startDate));
    if (endDate) conditions.push(lte(schedules.startTime, endDate));

    return await db.select().from(schedules).where(and(...conditions)).orderBy(schedules.startTime).limit(1000);
  }

  async updateSchedule(id: string, companyId: string, updates: Partial<Schedule>): Promise<Schedule> {
    const [updated] = await db
      .update(schedules)
      .set(updates)
      .where(and(eq(schedules.id, id), eq(schedules.companyId, companyId)))
      .returning();
    if (!updated) throw new Error('[Storage] Schedule not found or access denied');
    return updated;
  }

  async getSchedule(id: string, companyId: string): Promise<Schedule | undefined> {
    const [schedule] = await db.select().from(schedules).where(and(eq(schedules.id, id), eq(schedules.companyId, companyId)));
    return schedule;
  }

  async deleteSchedule(id: string, companyId: string): Promise<void> {
    await db.delete(schedules).where(and(eq(schedules.id, id), eq(schedules.companyId, companyId)));
  }

  // Task operations
  async createTask(task: InsertTask): Promise<Task> {
    if (!task.companyId) throw new Error('[Storage] createTask requires companyId for tenant isolation');
    const [created] = await db.insert(tasks).values(task).returning();
    return created;
  }

  async getTask(id: string, companyId: string): Promise<Task | undefined> {
    const [task] = await db
      .select()
      .from(tasks)
      .where(and(eq(tasks.id, id), eq(tasks.companyId, companyId)))
      .limit(1);
    return task;
  }

  async getUserTasks(userId: string, companyId: string): Promise<Task[]> {
    if (!companyId) throw new Error('[Storage] getUserTasks requires companyId for tenant isolation');
    return await db
      .select()
      .from(tasks)
      .where(and(eq(tasks.assignedTo, userId), eq(tasks.companyId, companyId)))
      .orderBy(desc(tasks.createdAt))
      .limit(200);
  }

  async getAllTasks(companyId?: string): Promise<Task[]> {
    if (!companyId) throw new Error('[Storage] getAllTasks requires companyId for tenant isolation');
    return await db.select().from(tasks).where(eq(tasks.companyId, companyId)).orderBy(desc(tasks.createdAt)).limit(500);
  }

  async updateTask(id: string, companyId: string, updates: Partial<Task>): Promise<Task> {
    const [updated] = await db
      .update(tasks)
      .set(updates)
      .where(and(eq(tasks.id, id), eq(tasks.companyId, companyId)))
      .returning();
    if (!updated) throw new Error('[Storage] Task not found or access denied');
    return updated;
  }

  async deleteTask(id: string, companyId: string): Promise<void> {
    await db.delete(tasks).where(and(eq(tasks.id, id), eq(tasks.companyId, companyId)));
  }

  async getTasksForDate(date: Date, companyId?: string): Promise<Task[]> {
    if (!companyId) throw new Error('[Storage] getTasksForDate requires companyId for tenant isolation');
    const startOfDay = new Date(date);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(date);
    endOfDay.setHours(23, 59, 59, 999);

    const conditions: SQL<unknown>[] = [
      eq(tasks.companyId, companyId),
      gte(tasks.dueDate, startOfDay),
      lte(tasks.dueDate, endOfDay)
    ];

    return await db
      .select()
      .from(tasks)
      .where(and(...conditions))
      .orderBy(tasks.dueDate);
  }

  // Chore operations
  async getChoresForDay(dayOfWeek: string, timeOfDay?: string, companyId?: string): Promise<Task[]> {
    if (!companyId) throw new Error('[Storage] getChoresForDay requires companyId for tenant isolation');
    const conditions: SQL<unknown>[] = [eq(tasks.dayOfWeek, dayOfWeek), eq(tasks.companyId, companyId)];
    if (timeOfDay) {
      conditions.push(eq(tasks.timeOfDay, timeOfDay));
    }

    return await db
      .select()
      .from(tasks)
      .where(and(...conditions))
      .orderBy(tasks.timeOfDay, tasks.estimatedMinutes);
  }

  async assignChoreToUser(choreId: string, companyId: string, userId: string): Promise<Task> {
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
      .where(and(eq(tasks.id, choreId), eq(tasks.companyId, companyId)))
      .returning();
    if (!updated) throw new Error('[Storage] Chore not found or access denied');
    return updated;
  }

  async signOffChore(choreId: string, companyId: string, userId: string, isManager: boolean): Promise<Task> {
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
      .where(and(eq(tasks.id, choreId), eq(tasks.companyId, companyId)))
      .returning();
    if (!updated) throw new Error('[Storage] Chore not found or access denied');
    return updated;
  }

  async getWeeklyChoreSchedule(companyId?: string): Promise<Record<string, Task[]>> {
    if (!companyId) throw new Error('[Storage] getWeeklyChoreSchedule requires companyId for tenant isolation');
    const conditions: SQL<unknown>[] = [eq(tasks.isRecurring, true), eq(tasks.companyId, companyId)];

    const chores = await db
      .select()
      .from(tasks)
      .where(and(...conditions))
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

  async getChoresByZone(zone: string, companyId?: string): Promise<Task[]> {
    if (!companyId) throw new Error('[Storage] getChoresByZone requires companyId for tenant isolation');
    const conditions: SQL<unknown>[] = [eq(tasks.choreZone, zone), eq(tasks.companyId, companyId)];
    return await db
      .select()
      .from(tasks)
      .where(and(...conditions))
      .orderBy(tasks.dayOfWeek, tasks.timeOfDay);
  }

  // Message operations
  async createMessage(message: InsertMessage): Promise<Message> {
    if (!message.companyId) throw new Error('[Storage] createMessage requires companyId for tenant isolation');
    const messageData = {
      ...message,
      readBy: Array.isArray(message.readBy) ? message.readBy : [],
    };
    const [created] = await db.insert(messages).values([messageData] as any).returning();
    return created;
  }

  async getMessages(userId?: string, companyId?: string): Promise<Message[]> {
    if (!companyId) throw new Error('[Storage] getMessages requires companyId for tenant isolation');
    const conditions: SQL<unknown>[] = [eq(messages.companyId, companyId)];
    if (userId) {
      conditions.push(eq(messages.isAnnouncement, true));
      conditions.push(sql`NOT (${messages.readBy} @> ${JSON.stringify([userId])})`);
    }

    return await db
      .select()
      .from(messages)
      .where(and(...conditions))
      .orderBy(desc(messages.createdAt))
      .limit(200);
  }

  async markMessageAsRead(messageId: string, userId: string, companyId: string): Promise<void> {
    if (!companyId) throw new Error('[Storage] markMessageAsRead requires companyId for tenant isolation');
    await db
      .update(messages)
      .set({
        readBy: sql`${messages.readBy} || ${JSON.stringify([userId])}`
      })
      .where(and(eq(messages.id, messageId), eq(messages.companyId, companyId)));
  }

  // Group chat operations
  async createGroup(group: InsertChatGroup): Promise<ChatGroup> {
    const [created] = await db.insert(chatGroups).values(group).returning();
    return created;
  }

  async getGroups(userId: string, companyId?: string): Promise<ChatGroup[]> {
    if (!companyId) throw new Error('[Storage] getGroups requires companyId for tenant isolation');
    const result = await db
      .select({ group: chatGroups })
      .from(chatGroups)
      .innerJoin(groupMembers, eq(chatGroups.id, groupMembers.groupId))
      .where(and(
        eq(groupMembers.userId, userId),
        eq(chatGroups.isActive, true),
        eq(chatGroups.companyId, companyId),
      ))
      .orderBy(desc(chatGroups.updatedAt));
    
    return result.map(row => row.group);
  }

  async addGroupMember(member: InsertGroupMember): Promise<GroupMember> {
    if (!member.companyId) throw new Error('[Storage] addGroupMember requires companyId for tenant isolation');
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

  async getGroupMessages(groupId: string, companyId: string): Promise<Message[]> {
    if (!companyId) throw new Error('[Storage] getGroupMessages requires companyId for tenant isolation');
    return await db
      .select()
      .from(messages)
      .where(and(eq(messages.groupId, groupId), eq(messages.companyId, companyId)))
      .orderBy(desc(messages.createdAt))
      .limit(100);
  }

  async getGroupMembers(groupId: string, companyId: string): Promise<GroupMember[]> {
    if (!companyId) throw new Error('[Storage] getGroupMembers requires companyId for tenant isolation');
    return await db
      .select({ id: groupMembers.id, groupId: groupMembers.groupId, userId: groupMembers.userId, joinedAt: groupMembers.joinedAt })
      .from(groupMembers)
      .innerJoin(chatGroups, eq(groupMembers.groupId, chatGroups.id))
      .where(and(eq(groupMembers.groupId, groupId), eq(chatGroups.companyId, companyId)))
      .orderBy(groupMembers.joinedAt);
  }

  // Availability operations
  async submitAvailability(availability: InsertUserAvailability[]): Promise<UserAvailability[]> {
    const result = [];
    
    for (const avail of availability) {
      const conditions: SQL<unknown>[] = [
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

  async getUserAvailability(userId: string, companyId: string, payrollPeriodId?: string): Promise<UserAvailability[]> {
    if (!companyId) throw new Error('[Storage] getUserAvailability requires companyId for tenant isolation');
    const conditions: SQL<unknown>[] = [eq(userAvailability.userId, userId), eq(userAvailability.companyId, companyId)];
    if (payrollPeriodId) {
      conditions.push(eq(userAvailability.payrollPeriodId, payrollPeriodId));
    }

    return await db
      .select()
      .from(userAvailability)
      .where(and(...conditions))
      .orderBy(userAvailability.date, userAvailability.timeSlot);
  }

  async getUserAvailabilityByDateRange(userId: string, companyId: string, startDate: Date, endDate: Date): Promise<UserAvailability[]> {
    if (!companyId) throw new Error('[Storage] getUserAvailabilityByDateRange requires companyId for tenant isolation');
    return await db
      .select()
      .from(userAvailability)
      .where(and(
        eq(userAvailability.userId, userId),
        eq(userAvailability.companyId, companyId),
        gte(userAvailability.date, startDate),
        lte(userAvailability.date, endDate)
      ))
      .orderBy(userAvailability.date, userAvailability.timeSlot);
  }

  async getAllAvailabilityForPeriod(payrollPeriodId: string, companyId?: string): Promise<UserAvailability[]> {
    if (!companyId) throw new Error('[Storage] getAllAvailabilityForPeriod requires companyId for tenant isolation');
    return await db
      .select()
      .from(userAvailability)
      .where(and(eq(userAvailability.payrollPeriodId, payrollPeriodId), eq(userAvailability.companyId, companyId)))
      .orderBy(userAvailability.date, userAvailability.timeSlot);
  }

  async getAllAvailabilityByDateRange(startDate: Date, endDate: Date, companyId?: string): Promise<UserAvailability[]> {
    if (!companyId) throw new Error('[Storage] getAllAvailabilityByDateRange requires companyId for tenant isolation');
    const conditions: SQL<unknown>[] = [
      eq(userAvailability.companyId, companyId),
      gte(userAvailability.date, startDate),
      lte(userAvailability.date, endDate)
    ];
    return await db
      .select()
      .from(userAvailability)
      .where(and(...conditions))
      .orderBy(userAvailability.userId, userAvailability.date, userAvailability.timeSlot);
  }

  // Time-off request operations
  async createTimeOffRequest(request: InsertTimeOffRequest): Promise<TimeOffRequest> {
    const [created] = await db.insert(timeOffRequests).values(request).returning();
    return created;
  }

  async getTimeOffRequests(userId?: string, companyId?: string): Promise<TimeOffRequest[]> {
    if (!companyId) throw new Error('[Storage] getTimeOffRequests requires companyId for tenant isolation');
    const condition = userId
      ? and(eq(timeOffRequests.companyId, companyId), eq(timeOffRequests.userId, userId))
      : eq(timeOffRequests.companyId, companyId);

    return await db
      .select()
      .from(timeOffRequests)
      .where(condition)
      .orderBy(desc(timeOffRequests.createdAt))
      .limit(200);
  }

  async getTimeOffRequest(id: string, companyId: string): Promise<TimeOffRequest | undefined> {
    const [request] = await db
      .select()
      .from(timeOffRequests)
      .where(and(eq(timeOffRequests.id, id), eq(timeOffRequests.companyId, companyId)));
    return request;
  }

  async updateTimeOffRequest(id: string, companyId: string, updates: Partial<TimeOffRequest>): Promise<TimeOffRequest> {
    const [updated] = await db
      .update(timeOffRequests)
      .set(updates)
      .where(and(eq(timeOffRequests.id, id), eq(timeOffRequests.companyId, companyId)))
      .returning();
    if (!updated) throw new Error('[Storage] Time-off request not found or access denied');
    return updated;
  }

  async deleteTimeOffRequest(id: string, companyId: string): Promise<void> {
    await db.delete(timeOffRequests).where(and(eq(timeOffRequests.id, id), eq(timeOffRequests.companyId, companyId)));
  }

  // Work location operations
  async createWorkLocation(location: InsertWorkLocation): Promise<WorkLocation> {
    if (!location.companyId) throw new Error('[Storage] createWorkLocation requires companyId for tenant isolation');
    const [created] = await db.insert(workLocations).values(location).returning();
    cache.invalidate('work_locations:all');
    return created;
  }

  async getAllWorkLocations(companyId?: string): Promise<WorkLocation[]> {
    if (!companyId) throw new Error('[Storage] getAllWorkLocations requires companyId for tenant isolation');
    const cacheKey = `work_locations:${companyId}`;
    return cache.getOrSet(cacheKey, async () => {
      return await db.select().from(workLocations).where(and(eq(workLocations.isActive, true), eq(workLocations.companyId, companyId)));
    }, 60_000);
  }

  async getWorkLocation(id: string, companyId: string): Promise<WorkLocation | undefined> {
    const [location] = await db.select().from(workLocations).where(and(eq(workLocations.id, id), eq(workLocations.companyId, companyId)));
    return location;
  }

  // Payroll operations
  async createPayrollPeriod(period: InsertPayrollPeriod): Promise<PayrollPeriod> {
    if (!period.companyId) throw new Error('[Storage] createPayrollPeriod requires companyId for tenant isolation');
    const [created] = await db.insert(payrollPeriods).values(period).returning();
    return created;
  }

  async getPayrollPeriods(companyId?: string): Promise<PayrollPeriod[]> {
    if (!companyId) throw new Error('[Storage] getPayrollPeriods requires companyId for tenant isolation');
    return await db.select().from(payrollPeriods).where(eq(payrollPeriods.companyId, companyId)).orderBy(desc(payrollPeriods.startDate)).limit(100);
  }

  async updatePayrollPeriod(id: string, updates: Partial<PayrollPeriod>, companyId: string): Promise<PayrollPeriod> {
    if (!companyId) throw new Error('[Storage] updatePayrollPeriod requires companyId for tenant isolation');
    const [updated] = await db
      .update(payrollPeriods)
      .set(updates)
      .where(and(eq(payrollPeriods.id, id), eq(payrollPeriods.companyId, companyId)))
      .returning();
    if (!updated) throw new Error('Payroll period not found or access denied');
    return updated;
  }

  async getNextPayrollPeriod(companyId?: string): Promise<PayrollPeriod | undefined> {
    if (!companyId) throw new Error('[Storage] getNextPayrollPeriod requires companyId for tenant isolation');
    const [period] = await db
      .select()
      .from(payrollPeriods)
      .where(and(eq(payrollPeriods.isProcessed, false), eq(payrollPeriods.companyId, companyId)))
      .orderBy(payrollPeriods.startDate)
      .limit(1);
    return period;
  }

  // Pay period automation operations
  async getPayPeriodSettings(companyId?: string): Promise<PayPeriodSettings | undefined> {
    if (!companyId) throw new Error('[Storage] getPayPeriodSettings requires companyId for tenant isolation');
    const [settings] = await db
      .select()
      .from(payPeriodSettings)
      .where(eq(payPeriodSettings.companyId, companyId))
      .orderBy(desc(payPeriodSettings.createdAt))
      .limit(1);
    return settings;
  }

  async updatePayPeriodSettings(settingsData: InsertPayPeriodSettings): Promise<PayPeriodSettings> {
    if (!settingsData.companyId) throw new Error('[Storage] updatePayPeriodSettings requires companyId for tenant isolation');
    // Delete existing settings for this company only
    await db.delete(payPeriodSettings).where(eq(payPeriodSettings.companyId, settingsData.companyId));
    
    const [settings] = await db
      .insert(payPeriodSettings)
      .values(settingsData)
      .returning();
    return settings;
  }

  async createNextPayPeriod(companyId?: string): Promise<PayrollPeriod> {
    if (!companyId) throw new Error('[Storage] createNextPayPeriod requires companyId for tenant isolation');
    const settings = await this.getPayPeriodSettings(companyId);
    const lastPeriod = await db
      .select()
      .from(payrollPeriods)
      .where(eq(payrollPeriods.companyId, companyId))
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
      companyId,
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

  async getScheduleConfirmations(payrollPeriodId: string, companyId: string): Promise<ScheduleConfirmation[]> {
    if (!companyId) throw new Error('[Storage] getScheduleConfirmations requires companyId for tenant isolation');
    return await db
      .select()
      .from(scheduleConfirmations)
      .where(and(eq(scheduleConfirmations.payrollPeriodId, payrollPeriodId), eq(scheduleConfirmations.companyId, companyId)))
      .orderBy(scheduleConfirmations.createdAt);
  }

  async updateScheduleConfirmation(id: string, updates: Partial<ScheduleConfirmation>, companyId: string): Promise<ScheduleConfirmation> {
    if (!companyId) throw new Error('[Storage] updateScheduleConfirmation requires companyId for tenant isolation');
    const [updated] = await db
      .update(scheduleConfirmations)
      .set(updates)
      .where(and(eq(scheduleConfirmations.id, id), eq(scheduleConfirmations.companyId, companyId)))
      .returning();
    return updated;
  }

  // Workflow log operations
  async createWorkflowLog(log: InsertWorkflowLog): Promise<WorkflowLog> {
    const [created] = await db.insert(workflowLogs).values(log).returning();
    return created;
  }

  async getWorkflowLogs(payrollPeriodId: string, companyId: string): Promise<WorkflowLog[]> {
    if (!companyId) throw new Error('[Storage] getWorkflowLogs requires companyId for tenant isolation');
    return await db
      .select()
      .from(workflowLogs)
      .where(and(eq(workflowLogs.payrollPeriodId, payrollPeriodId), eq(workflowLogs.companyId, companyId)))
      .orderBy(workflowLogs.createdAt);
  }

  // AI insights operations
  async createAIInsight(insight: Omit<AIInsight, 'id' | 'createdAt'>): Promise<AIInsight> {
    const [created] = await db.insert(aiInsights).values(insight).returning();
    return created;
  }

  async getUserInsights(userId?: string, companyId?: string): Promise<AIInsight[]> {
    if (!companyId) throw new Error('[Storage] getUserInsights requires companyId for tenant isolation');
    const condition = userId
      ? and(eq(aiInsights.companyId, companyId), eq(aiInsights.userId, userId))
      : eq(aiInsights.companyId, companyId);

    return await db
      .select()
      .from(aiInsights)
      .where(condition)
      .orderBy(desc(aiInsights.createdAt))
      .limit(100);
  }

  async markInsightAsRead(id: string, companyId: string): Promise<void> {
    if (!companyId) throw new Error('[Storage] markInsightAsRead requires companyId for tenant isolation');
    await db.update(aiInsights).set({ isRead: true }).where(and(eq(aiInsights.id, id), eq(aiInsights.companyId, companyId)));
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

  async assignUserRole(userId: string, roleId: string, companyId: string): Promise<void> {
    if (!companyId) throw new Error('[Storage] assignUserRole requires companyId for tenant isolation');
    await db
      .update(users)
      .set({ roleId, updatedAt: new Date() })
      .where(and(eq(users.id, userId), eq(users.companyId, companyId)));
  }

  // Permission management operations
  async getAllPermissions(): Promise<Permission[]> {
    return await db.select().from(permissions).orderBy(permissions.category, permissions.name);
  }

  async getPermissionsByCategory(): Promise<Record<string, Permission[]>> {
    const allPermissions = await this.getAllPermissions();
    return allPermissions.reduce((acc, permission) => {
      if (!acc[permission.category]) {
        acc[permission.category] = [];
      }
      acc[permission.category].push(permission);
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

    cache.set(cacheKey, perms, 2 * 60 * 1000);
    return perms;
  }

  // Payroll settings operations
  async getPayrollSettings(companyId: string): Promise<any> {
    if (!companyId) throw new Error('[Storage] getPayrollSettings requires companyId for tenant isolation');
    const [settings] = await db.select().from(payPeriodSettings).where(eq(payPeriodSettings.companyId, companyId)).limit(1);
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

  async getPayrollPeriod(id: string, companyId: string): Promise<PayrollPeriod | undefined> {
    if (!companyId) throw new Error('[Storage] getPayrollPeriod requires companyId for tenant isolation');
    const [period] = await db.select().from(payrollPeriods).where(and(eq(payrollPeriods.id, id), eq(payrollPeriods.companyId, companyId)));
    return period;
  }

  async getPayrollPeriodByIdInternal(id: string): Promise<PayrollPeriod | undefined> {
    const [period] = await db.select().from(payrollPeriods).where(eq(payrollPeriods.id, id));
    return period;
  }

  async getUpcomingPayrollPeriods(limit: number, companyId?: string): Promise<PayrollPeriod[]> {
    if (!companyId) throw new Error('[Storage] getUpcomingPayrollPeriods requires companyId for tenant isolation');
    return await db
      .select()
      .from(payrollPeriods)
      .where(and(sql`start_date > NOW()`, eq(payrollPeriods.companyId, companyId)))
      .orderBy(payrollPeriods.startDate)
      .limit(limit);
  }

  async getLatestPayrollPeriod(companyId?: string): Promise<PayrollPeriod | undefined> {
    if (!companyId) throw new Error('[Storage] getLatestPayrollPeriod requires companyId for tenant isolation');
    const [period] = await db
      .select()
      .from(payrollPeriods)
      .where(eq(payrollPeriods.companyId, companyId))
      .orderBy(sql`end_date DESC`)
      .limit(1);
    return period;
  }

  async getPendingPayrollPeriods(companyId?: string): Promise<PayrollPeriod[]> {
    if (!companyId) throw new Error('[Storage] getPendingPayrollPeriods requires companyId for tenant isolation');
    return await db
      .select()
      .from(payrollPeriods)
      .where(and(sql`workflow_state NOT IN ('processed', 'finalized')`, eq(payrollPeriods.companyId, companyId)));
  }

  async getSchedulesByPeriod(periodId: string, companyId?: string): Promise<any[]> {
    const conditions: SQL<unknown>[] = [eq(schedules.id, periodId)];
    if (companyId) conditions.push(eq(schedules.companyId, companyId));
    return await db
      .select()
      .from(schedules)
      .where(and(...conditions));
  }

  async getTimeEntriesByPeriod(periodId: string, companyId?: string): Promise<any[]> {
    if (!companyId) throw new Error('[Storage] getTimeEntriesByPeriod requires companyId for tenant isolation');
    const period = await this.getPayrollPeriod(periodId, companyId);
    if (!period) return [];

    return await db
      .select()
      .from(timeEntries)
      .where(and(
        sql`clock_in_time >= ${period.startDate} AND clock_in_time <= ${period.endDate}`,
        eq(timeEntries.companyId, companyId),
      ));
  }


  async getAllUsers(companyId?: string): Promise<User[]> {
    if (!companyId) throw new Error('[Storage] getAllUsers requires companyId for tenant isolation');
    return await db.select().from(users).where(and(eq(users.isActive, true), eq(users.companyId, companyId)));
  }

  async updateUserPayRate(userId: string, hourlyRate: number, companyId: string): Promise<User> {
    if (!companyId) throw new Error('[Storage] updateUserPayRate requires companyId for tenant isolation');
    const [updatedUser] = await db
      .update(users)
      .set({ hourlyRate: hourlyRate.toString() })
      .where(and(eq(users.id, userId), eq(users.companyId, companyId)))
      .returning();
    return updatedUser;
  }

  async updateUserRole(userId: string, roleId: string, companyId: string): Promise<User> {
    if (!companyId) throw new Error('[Storage] updateUserRole requires companyId for tenant isolation');
    const [updatedUser] = await db
      .update(users)
      .set({ roleId })
      .where(and(eq(users.id, userId), eq(users.companyId, companyId)))
      .returning();
    if (!updatedUser) throw new Error('[Storage] User not found or access denied');
    cache.invalidate(`permissions:${userId}`);
    return updatedUser;
  }

  async deleteUser(userId: string, companyId: string): Promise<void> {
    if (!companyId) throw new Error('[Storage] deleteUser requires companyId for tenant isolation');
    await db.delete(users).where(and(eq(users.id, userId), eq(users.companyId, companyId)));
  }

  async deactivateUser(userId: string, companyId: string): Promise<User> {
    if (!companyId) throw new Error('[Storage] deactivateUser requires companyId for tenant isolation');
    const [updatedUser] = await db
      .update(users)
      .set({ isActive: false, updatedAt: new Date() })
      .where(and(eq(users.id, userId), eq(users.companyId, companyId)))
      .returning();
    if (!updatedUser) throw new Error('[Storage] User not found or access denied');
    cache.invalidate(`permissions:${userId}`);
    cache.invalidate('dashboard:userlist');
    return updatedUser;
  }

  async updateUser(userId: string, updates: Partial<User>, companyId: string): Promise<User> {
    if (!companyId) throw new Error('[Storage] updateUser requires companyId for tenant isolation');
    const [updatedUser] = await db
      .update(users)
      .set({ ...updates, updatedAt: new Date() })
      .where(and(eq(users.id, userId), eq(users.companyId, companyId)))
      .returning();
    if (!updatedUser) throw new Error('[Storage] User not found or access denied');
    return updatedUser;
  }

  async getCompanySettings(companyId?: string): Promise<CompanySettings | undefined> {
    if (!companyId) throw new Error('[Storage] getCompanySettings requires companyId for tenant isolation');
    const cacheKey = `company:settings:${companyId}`;
    const cached = cache.get<CompanySettings>(cacheKey);
    if (cached) return cached;
    const query = db.select().from(companySettings).where(eq(companySettings.companyId, companyId)).limit(1);
    const [settings] = await query;
    if (settings) cache.set(cacheKey, settings, 2 * 60 * 1000);
    return settings;
  }

  async updateCompanySettings(updates: Partial<CompanySettings> & { expectedVersion?: number }, companyId?: string): Promise<CompanySettings> {
    const existing = await this.getCompanySettings(companyId);
    const { expectedVersion, ...settingsData } = updates;

    if (existing) {
      if (expectedVersion !== undefined && expectedVersion !== (existing.version || 1)) {
        throw new Error("Settings were modified by another user. Please refresh and try again.");
      }

      // Ensure decimal values are stored as strings for the text column
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
      cache.invalidate('company:settings');
      if (companyId) cache.invalidate(`company:settings:${companyId}`);
      return updated;
    }
    
    const insertData: any = { ...settingsData, version: 1 };
    if (companyId) insertData.companyId = companyId;
    if (settingsData.autoClockOutAfterMinutes !== undefined) {
      insertData.autoClockOutAfterMinutes = settingsData.autoClockOutAfterMinutes !== null ? settingsData.autoClockOutAfterMinutes.toString() : null;
    }

    const [created] = await db
      .insert(companySettings)
      .values(insertData)
      .returning();
    cache.invalidate('company:settings');
    if (companyId) cache.invalidate(`company:settings:${companyId}`);
    return created;
  }

  async updateWorkLocation(id: string, companyId: string, updates: Partial<WorkLocation>): Promise<WorkLocation> {
    const finalUpdates: any = { ...updates };
    if (updates.geofenceGraceMinutes !== undefined) {
      finalUpdates.geofenceGraceMinutes = updates.geofenceGraceMinutes !== null ? updates.geofenceGraceMinutes.toString() : "5.00";
    }
    cache.invalidate('work_locations:all');
    const [updated] = await db
      .update(workLocations)
      .set(finalUpdates)
      .where(and(eq(workLocations.id, id), eq(workLocations.companyId, companyId)))
      .returning();
    if (!updated) throw new Error('[Storage] Work location not found or access denied');
    return updated;
  }

  async deleteWorkLocation(id: string, companyId: string): Promise<void> {
    await db.delete(workLocations).where(and(eq(workLocations.id, id), eq(workLocations.companyId, companyId)));
    cache.invalidate('work_locations:all');
  }

  async createActivityLog(log: InsertActivityLog): Promise<ActivityLog> {
    const [created] = await db
      .insert(activityLogs)
      .values(log)
      .returning();
    return created;
  }

  async getActivityLogs(limit: number = 50, companyId?: string): Promise<ActivityLog[]> {
    if (!companyId) throw new Error('[Storage] getActivityLogs requires companyId for tenant isolation');
    return await db
      .select()
      .from(activityLogs)
      .where(eq(activityLogs.companyId, companyId))
      .orderBy(desc(activityLogs.createdAt))
      .limit(limit);
  }

  async createHolidayPayRule(rule: InsertHolidayPayRule): Promise<HolidayPayRule> {
    const [created] = await db.insert(holidayPayRules).values(rule).returning();
    return created;
  }

  async getAllHolidayPayRules(companyId?: string): Promise<HolidayPayRule[]> {
    if (!companyId) throw new Error('[Storage] getAllHolidayPayRules requires companyId for tenant isolation');
    return await db
      .select()
      .from(holidayPayRules)
      .where(and(eq(holidayPayRules.isActive, true), eq(holidayPayRules.companyId, companyId)))
      .orderBy(holidayPayRules.month, holidayPayRules.day);
  }

  async getHolidayPayRule(id: string, companyId: string): Promise<HolidayPayRule | undefined> {
    const [rule] = await db.select().from(holidayPayRules).where(and(eq(holidayPayRules.id, id), eq(holidayPayRules.companyId, companyId)));
    return rule;
  }

  async deleteHolidayPayRule(id: string, companyId: string): Promise<void> {
    await db.delete(holidayPayRules).where(and(eq(holidayPayRules.id, id), eq(holidayPayRules.companyId, companyId)));
  }

  async updateHolidayPayRule(id: string, companyId: string, updates: Partial<HolidayPayRule>): Promise<HolidayPayRule> {
    const [updated] = await db
      .update(holidayPayRules)
      .set(updates)
      .where(and(eq(holidayPayRules.id, id), eq(holidayPayRules.companyId, companyId)))
      .returning();
    if (!updated) throw new Error('[Storage] Holiday pay rule not found or access denied');
    return updated;
  }

  async createClockEvent(event: InsertClockEvent): Promise<ClockEvent> {
    const [created] = await db.insert(clockEvents).values(event).returning();
    return created;
  }

  async getClockEvents(userId: string, startDate?: Date, endDate?: Date, companyId?: string): Promise<ClockEvent[]> {
    if (!companyId) throw new Error('[Storage] getClockEvents requires companyId for tenant isolation');
    const conditions: SQL<unknown>[] = [eq(clockEvents.userId, userId), eq(clockEvents.companyId, companyId)];
    if (startDate) conditions.push(gte(clockEvents.createdAt, startDate));
    if (endDate) conditions.push(lte(clockEvents.createdAt, endDate));
    return await db
      .select()
      .from(clockEvents)
      .where(and(...conditions))
      .orderBy(desc(clockEvents.createdAt))
      .limit(500);
  }

  async getAllClockEvents(startDate?: Date, endDate?: Date, companyId?: string): Promise<ClockEvent[]> {
    if (!companyId) throw new Error('[Storage] getAllClockEvents requires companyId for tenant isolation');
    const conditions: SQL<unknown>[] = [eq(clockEvents.companyId, companyId)];
    if (startDate) conditions.push(gte(clockEvents.createdAt, startDate));
    if (endDate) conditions.push(lte(clockEvents.createdAt, endDate));
    return await db
      .select()
      .from(clockEvents)
      .where(and(...conditions))
      .orderBy(desc(clockEvents.createdAt))
      .limit(1000);
  }

  async getPerformanceScoreSettings(companyId?: string): Promise<PerformanceScoreSetting[]> {
    if (!companyId) throw new Error('[Storage] getPerformanceScoreSettings requires companyId for tenant isolation');
    return await db.select().from(performanceScoreSettings).where(eq(performanceScoreSettings.companyId, companyId)).orderBy(performanceScoreSettings.category);
  }

  async upsertPerformanceScoreSetting(setting: InsertPerformanceScoreSetting): Promise<PerformanceScoreSetting> {
    if (!setting.companyId) throw new Error('[Storage] upsertPerformanceScoreSetting requires companyId for tenant isolation');
    const [result] = await db
      .insert(performanceScoreSettings)
      .values(setting)
      .onConflictDoUpdate({
        target: [performanceScoreSettings.companyId, performanceScoreSettings.eventType],
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

  async getPerformanceScores(startDate?: Date, endDate?: Date, companyId?: string): Promise<{ userId: string; totalPoints: number; eventCount: number }[]> {
    if (!companyId) throw new Error('[Storage] getPerformanceScores requires companyId for tenant isolation');
    const conditions: SQL<unknown>[] = [eq(clockEvents.companyId, companyId)];
    if (startDate) conditions.push(gte(clockEvents.createdAt, startDate));
    if (endDate) conditions.push(lte(clockEvents.createdAt, endDate));

    const result = await db
      .select({
        userId: clockEvents.userId,
        totalPoints: sql<number>`COALESCE(SUM(${clockEvents.pointValue}), 0)::int`,
        eventCount: sql<number>`COUNT(*)::int`,
      })
      .from(clockEvents)
      .where(and(...conditions))
      .groupBy(clockEvents.userId)
      .orderBy(sql`SUM(${clockEvents.pointValue}) DESC`);

    return result;
  }

  // SOP operations
  async createSopCategory(category: InsertSopCategory): Promise<SopCategory> {
    const [created] = await db.insert(sopCategories).values(category).returning();
    return created;
  }

  async getSopCategories(companyId?: string): Promise<SopCategory[]> {
    if (!companyId) throw new Error('[Storage] getSopCategories requires companyId for tenant isolation');
    return await db.select().from(sopCategories).where(eq(sopCategories.companyId, companyId)).orderBy(sopCategories.sortOrder);
  }

  async updateSopCategory(id: string, companyId: string, updates: Partial<SopCategory>): Promise<SopCategory> {
    const [updated] = await db
      .update(sopCategories)
      .set(updates)
      .where(and(eq(sopCategories.id, id), eq(sopCategories.companyId, companyId)))
      .returning();
    if (!updated) throw new Error('[Storage] SOP category not found or access denied');
    return updated;
  }

  async deleteSopCategory(id: string, companyId: string): Promise<void> {
    await db.delete(sopCategories).where(and(eq(sopCategories.id, id), eq(sopCategories.companyId, companyId)));
  }

  async createSopDocument(doc: InsertSopDocument): Promise<SopDocument> {
    const [created] = await db.insert(sopDocuments).values(doc).returning();
    return created;
  }

  async getSopDocuments(categoryId?: string, companyId?: string): Promise<SopDocument[]> {
    if (!companyId) throw new Error('[Storage] getSopDocuments requires companyId for tenant isolation');
    const conditions: SQL<unknown>[] = [eq(sopDocuments.companyId, companyId)];
    if (categoryId) conditions.push(eq(sopDocuments.categoryId, categoryId));
    return await db
      .select()
      .from(sopDocuments)
      .where(and(...conditions))
      .orderBy(sopDocuments.title)
      .limit(200);
  }

  async getSopDocument(id: string, companyId: string): Promise<SopDocument | undefined> {
    const [doc] = await db.select().from(sopDocuments).where(and(eq(sopDocuments.id, id), eq(sopDocuments.companyId, companyId)));
    return doc;
  }

  async updateSopDocument(id: string, companyId: string, updates: Partial<SopDocument>): Promise<SopDocument> {
    const [updated] = await db
      .update(sopDocuments)
      .set({ ...updates, updatedAt: new Date() })
      .where(and(eq(sopDocuments.id, id), eq(sopDocuments.companyId, companyId)))
      .returning();
    if (!updated) throw new Error('[Storage] SOP document not found or access denied');
    return updated;
  }

  async deleteSopDocument(id: string, companyId: string): Promise<void> {
    await db.delete(sopDocuments).where(and(eq(sopDocuments.id, id), eq(sopDocuments.companyId, companyId)));
  }

  async searchSopDocuments(query: string, companyId?: string): Promise<SopDocument[]> {
    if (!companyId) throw new Error('[Storage] searchSopDocuments requires companyId for tenant isolation');
    const searchPattern = `%${query}%`;
    const conditions: SQL<unknown>[] = [
      eq(sopDocuments.isPublished, true),
      eq(sopDocuments.companyId, companyId),
      sql`(${sopDocuments.title} ILIKE ${searchPattern} OR ${sopDocuments.content} ILIKE ${searchPattern} OR ${sopDocuments.summary} ILIKE ${searchPattern})`
    ];
    return await db
      .select()
      .from(sopDocuments)
      .where(and(...conditions))
      .orderBy(sopDocuments.title);
  }

  // AI Chat operations
  async createAiChatConversation(conv: InsertAiChatConversation): Promise<AiChatConversation> {
    const [created] = await db.insert(aiChatConversations).values(conv).returning();
    return created;
  }

  async getUserConversations(userId: string, companyId: string): Promise<AiChatConversation[]> {
    if (!companyId) throw new Error('[Storage] getUserConversations requires companyId for tenant isolation');
    return await db
      .select()
      .from(aiChatConversations)
      .where(and(eq(aiChatConversations.userId, userId), eq(aiChatConversations.companyId, companyId)))
      .orderBy(desc(aiChatConversations.lastMessageAt))
      .limit(50);
  }

  async getConversation(id: string, companyId: string): Promise<AiChatConversation | undefined> {
    if (!companyId) throw new Error('[Storage] getConversation requires companyId for tenant isolation');
    const [conv] = await db.select().from(aiChatConversations).where(and(eq(aiChatConversations.id, id), eq(aiChatConversations.companyId, companyId)));
    return conv;
  }

  async deleteConversation(id: string, companyId: string): Promise<void> {
    if (!companyId) throw new Error('[Storage] deleteConversation requires companyId for tenant isolation');
    const [existing] = await db.select({ id: aiChatConversations.id }).from(aiChatConversations)
      .where(and(eq(aiChatConversations.id, id), eq(aiChatConversations.companyId, companyId)));
    if (!existing) return;
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

  async getConversationMessages(conversationId: string, companyId: string): Promise<AiChatMessage[]> {
    if (!companyId) throw new Error('[Storage] getConversationMessages requires companyId for tenant isolation');
    const conv = await db.select({ id: aiChatConversations.id }).from(aiChatConversations)
      .where(and(eq(aiChatConversations.id, conversationId), eq(aiChatConversations.companyId, companyId))).limit(1);
    if (!conv.length) return [];
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

  async getTrainingModules(companyId?: string): Promise<TrainingModule[]> {
    if (!companyId) throw new Error('[Storage] getTrainingModules requires companyId for tenant isolation');
    return await db.select().from(trainingModules).where(eq(trainingModules.companyId, companyId)).orderBy(trainingModules.createdAt);
  }

  async updateTrainingModule(id: string, companyId: string, updates: Partial<TrainingModule>): Promise<TrainingModule> {
    const [updated] = await db
      .update(trainingModules)
      .set(updates)
      .where(and(eq(trainingModules.id, id), eq(trainingModules.companyId, companyId)))
      .returning();
    if (!updated) throw new Error('[Storage] Training module not found or access denied');
    return updated;
  }

  async deleteTrainingModule(id: string, companyId: string): Promise<void> {
    await db.delete(trainingModules).where(and(eq(trainingModules.id, id), eq(trainingModules.companyId, companyId)));
  }

  async getEmployeeTrainingProgress(userId: string, companyId: string): Promise<EmployeeTrainingProgress[]> {
    if (!companyId) throw new Error('[Storage] getEmployeeTrainingProgress requires companyId for tenant isolation');
    const userRecord = await db.select({ id: users.id }).from(users).where(and(eq(users.id, userId), eq(users.companyId, companyId))).limit(1);
    if (!userRecord.length) return [];
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
    if (!alert.companyId) throw new Error('[Storage] createCommuteAlert requires companyId for tenant isolation');
    const [created] = await db.insert(commuteAlerts).values(alert).returning();
    return created;
  }

  async getUserCommuteAlerts(userId: string, companyId: string): Promise<CommuteAlert[]> {
    if (!companyId) throw new Error('[Storage] getUserCommuteAlerts requires companyId for tenant isolation');
    return await db
      .select({ id: commuteAlerts.id, userId: commuteAlerts.userId, type: commuteAlerts.type, title: commuteAlerts.title, message: commuteAlerts.message, severity: commuteAlerts.severity, isRead: commuteAlerts.isRead, metadata: commuteAlerts.metadata, createdAt: commuteAlerts.createdAt })
      .from(commuteAlerts)
      .innerJoin(users, eq(commuteAlerts.userId, users.id))
      .where(and(eq(commuteAlerts.userId, userId), eq(users.companyId, companyId)))
      .orderBy(desc(commuteAlerts.createdAt))
      .limit(50);
  }

  // Shoutouts
  async createShoutout(shoutout: InsertShoutout): Promise<Shoutout> {
    const [created] = await db.insert(shoutouts).values({
      companyId: shoutout.companyId ?? null,
      senderId: shoutout.senderId,
      recipientId: shoutout.recipientId,
      category: shoutout.category,
      message: shoutout.message,
      emoji: shoutout.emoji ?? null,
    }).returning();
    return created;
  }

  async getShoutouts(limit: number = 50, companyId?: string): Promise<Shoutout[]> {
    if (!companyId) throw new Error('[Storage] getShoutouts requires companyId for tenant isolation');
    return await db
      .select()
      .from(shoutouts)
      .where(eq(shoutouts.companyId, companyId))
      .orderBy(desc(shoutouts.createdAt))
      .limit(limit);
  }

  async addShoutoutReaction(id: string, companyId: string, userId: string, emoji: string): Promise<Shoutout> {
    const [existing] = await db.select().from(shoutouts).where(and(eq(shoutouts.id, id), eq(shoutouts.companyId, companyId)));
    if (!existing) throw new Error("Shoutout not found or access denied");
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
    if (!edit.companyId) throw new Error('[Storage] createTimeEntryEdit requires companyId for tenant isolation');
    const [created] = await db.insert(timeEntryEdits).values(edit).returning();
    return created;
  }

  async getTimeEntryEdits(timeEntryId: string, companyId: string): Promise<TimeEntryEdit[]> {
    if (!companyId) throw new Error('[Storage] getTimeEntryEdits requires companyId for tenant isolation');
    return await db
      .select({ id: timeEntryEdits.id, timeEntryId: timeEntryEdits.timeEntryId, editedBy: timeEntryEdits.editedBy, editedAt: timeEntryEdits.editedAt, fieldChanged: timeEntryEdits.fieldChanged, oldValue: timeEntryEdits.oldValue, newValue: timeEntryEdits.newValue, reason: timeEntryEdits.reason })
      .from(timeEntryEdits)
      .innerJoin(timeEntries, eq(timeEntryEdits.timeEntryId, timeEntries.id))
      .where(and(eq(timeEntryEdits.timeEntryId, timeEntryId), eq(timeEntries.companyId, companyId)))
      .orderBy(desc(timeEntryEdits.editedAt));
  }

  async createOffsiteRule(rule: InsertOffsiteAllowanceRule): Promise<OffsiteAllowanceRule> {
    const [created] = await db.insert(offsiteAllowanceRules).values(rule).returning();
    return created;
  }

  async getOffsiteRules(locationId: string, companyId?: string): Promise<OffsiteAllowanceRule[]> {
    if (!companyId) throw new Error('[Storage] getOffsiteRules requires companyId for tenant isolation');
    return await db
      .select()
      .from(offsiteAllowanceRules)
      .where(and(eq(offsiteAllowanceRules.locationId, locationId), eq(offsiteAllowanceRules.companyId, companyId)))
      .orderBy(offsiteAllowanceRules.name);
  }

  async getOffsiteRule(id: string, companyId?: string): Promise<OffsiteAllowanceRule | undefined> {
    if (!companyId) throw new Error('[Storage] getOffsiteRule requires companyId for tenant isolation');
    const [rule] = await db.select().from(offsiteAllowanceRules).where(and(eq(offsiteAllowanceRules.id, id), eq(offsiteAllowanceRules.companyId, companyId)));
    return rule;
  }

  async updateOffsiteRule(id: string, updates: Partial<OffsiteAllowanceRule>, companyId?: string): Promise<OffsiteAllowanceRule> {
    if (!companyId) throw new Error('[Storage] updateOffsiteRule requires companyId for tenant isolation');
    const [updated] = await db
      .update(offsiteAllowanceRules)
      .set(updates)
      .where(and(eq(offsiteAllowanceRules.id, id), eq(offsiteAllowanceRules.companyId, companyId)))
      .returning();
    if (!updated) throw new Error('Offsite rule not found or access denied');
    return updated;
  }

  async deleteOffsiteRule(id: string, companyId?: string): Promise<void> {
    if (!companyId) throw new Error('[Storage] deleteOffsiteRule requires companyId for tenant isolation');
    await db.delete(offsiteAllowanceRules).where(and(eq(offsiteAllowanceRules.id, id), eq(offsiteAllowanceRules.companyId, companyId)));
  }

  async createOffsiteSession(session: InsertOffsiteSession): Promise<OffsiteSession> {
    const [created] = await db.insert(offsiteSessions).values(session).returning();
    return created;
  }

  async getOffsiteSessions(filters?: { userId?: string; status?: string; timeEntryId?: string; companyId?: string }): Promise<OffsiteSession[]> {
    if (!filters?.companyId) throw new Error('[Storage] getOffsiteSessions requires companyId for tenant isolation');
    const conditions: SQL<unknown>[] = [eq(offsiteSessions.companyId, filters.companyId)];
    if (filters.userId) conditions.push(eq(offsiteSessions.userId, filters.userId));
    if (filters.status) conditions.push(eq(offsiteSessions.status, filters.status));
    if (filters.timeEntryId) conditions.push(eq(offsiteSessions.timeEntryId, filters.timeEntryId));
    return await db
      .select()
      .from(offsiteSessions)
      .where(and(...conditions))
      .orderBy(desc(offsiteSessions.exitTime))
      .limit(200);
  }

  async updateOffsiteSession(id: string, companyId: string, updates: Partial<OffsiteSession>): Promise<OffsiteSession> {
    const [updated] = await db
      .update(offsiteSessions)
      .set(updates)
      .where(and(eq(offsiteSessions.id, id), eq(offsiteSessions.companyId, companyId)))
      .returning();
    if (!updated) throw new Error('[Storage] Offsite session not found or access denied');
    return updated;
  }

  async createOvertimeAlert(alert: InsertOvertimeAlert): Promise<OvertimeAlert> {
    const [created] = await db.insert(overtimeAlerts).values(alert).returning();
    return created;
  }

  async getOvertimeAlerts(filters?: { status?: string; weekStartDate?: Date; companyId?: string }): Promise<OvertimeAlert[]> {
    if (!filters?.companyId) throw new Error('[Storage] getOvertimeAlerts requires companyId for tenant isolation');
    const conditions: SQL<unknown>[] = [eq(overtimeAlerts.companyId, filters.companyId)];
    if (filters.status) conditions.push(eq(overtimeAlerts.status, filters.status));
    if (filters.weekStartDate) conditions.push(eq(overtimeAlerts.weekStartDate, filters.weekStartDate));
    return await db
      .select()
      .from(overtimeAlerts)
      .where(and(...conditions))
      .orderBy(desc(overtimeAlerts.createdAt))
      .limit(100);
  }

  async updateOvertimeAlert(id: string, companyId: string, updates: Partial<OvertimeAlert>): Promise<OvertimeAlert> {
    const [updated] = await db
      .update(overtimeAlerts)
      .set(updates)
      .where(and(eq(overtimeAlerts.id, id), eq(overtimeAlerts.companyId, companyId)))
      .returning();
    if (!updated) throw new Error('[Storage] Overtime alert not found or access denied');
    return updated;
  }
}

export const storage = new DatabaseStorage();
