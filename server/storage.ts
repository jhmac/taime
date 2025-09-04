import {
  users,
  timeEntries,
  schedules,
  tasks,
  messages,
  workLocations,
  payrollPeriods,
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
  type WorkLocation,
  type InsertWorkLocation,
  type PayrollPeriod,
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
  markMessageAsRead(messageId: string, userId: string): Promise<void>;
  
  // Work location operations
  createWorkLocation(location: InsertWorkLocation): Promise<WorkLocation>;
  getAllWorkLocations(): Promise<WorkLocation[]>;
  getWorkLocation(id: string): Promise<WorkLocation | undefined>;
  
  // Payroll operations
  createPayrollPeriod(period: Omit<PayrollPeriod, 'id' | 'createdAt'>): Promise<PayrollPeriod>;
  getPayrollPeriods(): Promise<PayrollPeriod[]>;
  updatePayrollPeriod(id: string, updates: Partial<PayrollPeriod>): Promise<PayrollPeriod>;
  
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
  async createPayrollPeriod(period: Omit<PayrollPeriod, 'id' | 'createdAt'>): Promise<PayrollPeriod> {
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
