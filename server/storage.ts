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
} from "@shared/schema";
import { db } from "./db";
import { eq, and, desc, gte, lte, isNull, sql } from "drizzle-orm";

export interface IStorage {
  // User operations (mandatory for Replit Auth)
  getUser(id: string): Promise<User | undefined>;
  upsertUser(user: UpsertUser): Promise<User>;
  
  // Time tracking operations
  createTimeEntry(entry: InsertTimeEntry): Promise<TimeEntry>;
  getActiveTimeEntry(userId: string): Promise<TimeEntry | undefined>;
  updateTimeEntry(id: string, updates: Partial<TimeEntry>): Promise<TimeEntry>;
  getUserTimeEntries(userId: string, startDate?: Date, endDate?: Date): Promise<TimeEntry[]>;
  getAllTimeEntries(startDate?: Date, endDate?: Date): Promise<TimeEntry[]>;
  
  // Schedule operations
  createSchedule(schedule: InsertSchedule): Promise<Schedule>;
  getUserSchedules(userId: string, startDate?: Date, endDate?: Date): Promise<Schedule[]>;
  getAllSchedules(startDate?: Date, endDate?: Date): Promise<Schedule[]>;
  updateSchedule(id: string, updates: Partial<Schedule>): Promise<Schedule>;
  deleteSchedule(id: string): Promise<void>;
  
  // Task operations
  createTask(task: InsertTask): Promise<Task>;
  getUserTasks(userId: string): Promise<Task[]>;
  getAllTasks(): Promise<Task[]>;
  updateTask(id: string, updates: Partial<Task>): Promise<Task>;
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
  getAllAvailabilityForPeriod(payrollPeriodId: string): Promise<UserAvailability[]>;
  
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
}

export class DatabaseStorage implements IStorage {
  // User operations
  async getUser(id: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user;
  }

  async upsertUser(userData: UpsertUser): Promise<User> {
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
      .orderBy(desc(timeEntries.clockInTime));
  }

  async getAllTimeEntries(startDate?: Date, endDate?: Date): Promise<TimeEntry[]> {
    const conditions = [];
    if (startDate) conditions.push(gte(timeEntries.clockInTime, startDate));
    if (endDate) conditions.push(lte(timeEntries.clockInTime, endDate));

    const query = conditions.length > 0 
      ? db.select().from(timeEntries).where(and(...conditions))
      : db.select().from(timeEntries);

    return await query.orderBy(desc(timeEntries.clockInTime));
  }

  // Schedule operations
  async createSchedule(schedule: InsertSchedule): Promise<Schedule> {
    const [created] = await db.insert(schedules).values(schedule).returning();
    return created;
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

    return await query.orderBy(schedules.startTime);
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

  async getUserTasks(userId: string): Promise<Task[]> {
    return await db
      .select()
      .from(tasks)
      .where(eq(tasks.assignedTo, userId))
      .orderBy(desc(tasks.createdAt));
  }

  async getAllTasks(): Promise<Task[]> {
    return await db.select().from(tasks).orderBy(desc(tasks.createdAt));
  }

  async updateTask(id: string, updates: Partial<Task>): Promise<Task> {
    const [updated] = await db
      .update(tasks)
      .set(updates)
      .where(eq(tasks.id, id))
      .returning();
    return updated;
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
      readBy: message.readBy || [],
    };
    const [created] = await db.insert(messages).values(messageData).returning();
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

    return await query.orderBy(desc(messages.createdAt));
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
      .orderBy(desc(messages.createdAt));
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
      // Check if availability already exists for this user, period, date, and time slot
      const existing = await db
        .select()
        .from(userAvailability)
        .where(and(
          eq(userAvailability.userId, avail.userId),
          eq(userAvailability.payrollPeriodId, avail.payrollPeriodId),
          eq(userAvailability.date, avail.date),
          eq(userAvailability.timeSlot, avail.timeSlot)
        ));

      if (existing.length > 0) {
        // Update existing
        const [updated] = await db
          .update(userAvailability)
          .set({ isAvailable: avail.isAvailable })
          .where(eq(userAvailability.id, existing[0].id))
          .returning();
        result.push(updated);
      } else {
        // Create new
        const [created] = await db.insert(userAvailability).values(avail).returning();
        result.push(created);
      }
    }
    
    return result;
  }

  async getUserAvailability(userId: string, payrollPeriodId?: string): Promise<UserAvailability[]> {
    const conditions = [eq(userAvailability.userId, userId)];
    if (payrollPeriodId) {
      conditions.push(eq(userAvailability.payrollPeriodId, payrollPeriodId));
    }

    return await db
      .select()
      .from(userAvailability)
      .where(and(...conditions))
      .orderBy(userAvailability.date, userAvailability.timeSlot);
  }

  async getAllAvailabilityForPeriod(payrollPeriodId: string): Promise<UserAvailability[]> {
    return await db
      .select()
      .from(userAvailability)
      .where(eq(userAvailability.payrollPeriodId, payrollPeriodId))
      .orderBy(userAvailability.date, userAvailability.timeSlot);
  }

  // Work location operations
  async createWorkLocation(location: InsertWorkLocation): Promise<WorkLocation> {
    const [created] = await db.insert(workLocations).values(location).returning();
    return created;
  }

  async getAllWorkLocations(): Promise<WorkLocation[]> {
    return await db.select().from(workLocations).where(eq(workLocations.isActive, true));
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
    return await db.select().from(payrollPeriods).orderBy(desc(payrollPeriods.startDate));
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

    return await query.orderBy(desc(aiInsights.createdAt));
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
      .where(and(eq(pushSubscriptions.userId, userId), eq(pushSubscriptions.isActive, true)));
  }

  async deletePushSubscription(id: string): Promise<void> {
    await db.update(pushSubscriptions).set({ isActive: false }).where(eq(pushSubscriptions.id, id));
  }

  // Role management operations
  async getUserWithRole(id: string): Promise<UserWithRole | undefined> {
    const [user] = await db
      .select()
      .from(users)
      .leftJoin(roles, eq(users.roleId, roles.id))
      .leftJoin(rolePermissions, eq(roles.id, rolePermissions.roleId))
      .leftJoin(permissions, eq(rolePermissions.permissionId, permissions.id))
      .where(eq(users.id, id));

    if (!user.users) return undefined;

    // Transform the result to match our expected structure
    const userWithRole: UserWithRole = {
      ...user.users,
      role: user.roles ? {
        ...user.roles,
        rolePermissions: user.permissions ? [{
          id: user.role_permissions?.id || '',
          roleId: user.role_permissions?.roleId || '',
          permissionId: user.role_permissions?.permissionId || '',
          createdAt: user.role_permissions?.createdAt || new Date(),
          permission: user.permissions
        }] : []
      } : undefined
    };

    return userWithRole;
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
    // First, delete existing permissions for this role
    await db.delete(rolePermissions).where(eq(rolePermissions.roleId, roleId));
    
    // Then insert new permissions
    if (permissionIds.length > 0) {
      const newRolePermissions = permissionIds.map(permissionId => ({
        roleId,
        permissionId
      }));
      
      await db.insert(rolePermissions).values(newRolePermissions);
    }
  }

  async getUserPermissions(userId: string): Promise<Permission[]> {
    const result = await db
      .select({ permission: permissions })
      .from(users)
      .innerJoin(roles, eq(users.roleId, roles.id))
      .innerJoin(rolePermissions, eq(roles.id, rolePermissions.roleId))
      .innerJoin(permissions, eq(rolePermissions.permissionId, permissions.id))
      .where(eq(users.id, userId));
    
    return result.map(row => row.permission);
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
    return updatedUser;
  }

  async deleteUser(userId: string): Promise<void> {
    await db.delete(users).where(eq(users.id, userId));
  }
}

export const storage = new DatabaseStorage();
