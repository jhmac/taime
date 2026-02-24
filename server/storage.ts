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
} from "@shared/schema";
import { db } from "./db";
import { eq, and, desc, gte, lte, isNull, sql } from "drizzle-orm";
import { cache } from "./lib/cache";

export interface IStorage {
  // User operations (mandatory for Replit Auth)
  getUser(id: string): Promise<User | undefined>;
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
  getAllSchedules(startDate?: Date, endDate?: Date): Promise<Schedule[]>;
  updateSchedule(id: string, updates: Partial<Schedule>): Promise<Schedule>;
  deleteSchedule(id: string): Promise<void>;
  
  // Task operations
  createTask(task: InsertTask): Promise<Task>;
  getTask(id: string): Promise<Task | undefined>;
  getUserTasks(userId: string): Promise<Task[]>;
  getAllTasks(): Promise<Task[]>;
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
  
  // Company settings operations
  getCompanySettings(): Promise<CompanySettings | undefined>;
  updateCompanySettings(settings: InsertCompanySettings): Promise<CompanySettings>;
  
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
  updateUserRole(userId: string, roleId: string): Promise<User>;
  deleteUser(userId: string): Promise<void>;
  deactivateUser(userId: string): Promise<User>;
  updateUser(userId: string, updates: Partial<User>): Promise<User>;

  // Holiday pay rules
  createHolidayPayRule(rule: InsertHolidayPayRule): Promise<HolidayPayRule>;
  getAllHolidayPayRules(): Promise<HolidayPayRule[]>;
  deleteHolidayPayRule(id: string): Promise<void>;
  updateHolidayPayRule(id: string, updates: Partial<HolidayPayRule>): Promise<HolidayPayRule>;

  // SOP operations
  createSopCategory(category: InsertSopCategory): Promise<SopCategory>;
  getSopCategories(): Promise<SopCategory[]>;
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
  getTrainingModules(): Promise<TrainingModule[]>;
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
}

export class DatabaseStorage implements IStorage {
  // User operations
  async getUser(id: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user;
  }

  async upsertUser(userData: UpsertUser): Promise<User> {
    if (userData.email) {
      const [existingByEmail] = await db.select().from(users).where(eq(users.email, userData.email));
      if (existingByEmail && existingByEmail.id !== userData.id) {
        const updateData: any = { updatedAt: new Date() };
        if (userData.firstName) updateData.firstName = userData.firstName;
        if (userData.lastName) updateData.lastName = userData.lastName;
        if (userData.profileImageUrl) updateData.profileImageUrl = userData.profileImageUrl;
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

  async getAllSchedules(startDate?: Date, endDate?: Date): Promise<Schedule[]> {
    const conditions = [];
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

  async getAllTasks(): Promise<Task[]> {
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
    return await db.select().from(users).where(eq(users.isActive, true));
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

  async getCompanySettings(): Promise<CompanySettings | undefined> {
    const cached = cache.get<CompanySettings>('company:settings');
    if (cached) return cached;
    const [settings] = await db.select().from(companySettings).limit(1);
    if (settings) cache.set('company:settings', settings, 2 * 60 * 1000);
    return settings;
  }

  async updateCompanySettings(updates: Partial<CompanySettings> & { expectedVersion?: number }): Promise<CompanySettings> {
    const existing = await this.getCompanySettings();
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
      return updated;
    }
    
    const insertData: any = { ...settingsData, version: 1 };
    if (settingsData.autoClockOutAfterMinutes !== undefined) {
      insertData.autoClockOutAfterMinutes = settingsData.autoClockOutAfterMinutes !== null ? settingsData.autoClockOutAfterMinutes.toString() : null;
    }

    const [created] = await db
      .insert(companySettings)
      .values(insertData)
      .returning();
    cache.invalidate('company:settings');
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

  async getSopCategories(): Promise<SopCategory[]> {
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

  async getTrainingModules(): Promise<TrainingModule[]> {
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
}

export const storage = new DatabaseStorage();
