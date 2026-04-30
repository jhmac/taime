import {
  tasks,
  taskAssignees,
  meetings,
  meetingTaskRecommendations,
  dayNotes,
  users,
  roles,
  timeEntries,
  type Task,
  type InsertTask,
  type TaskAssignee,
  type InsertTaskAssignee,
  type Meeting,
  type InsertMeeting,
  type MeetingTaskRecommendation,
  type InsertMeetingTaskRecommendation,
  type DayNote,
  type InsertDayNote,
} from "@shared/schema";
import { db } from "../db";
import { eq, and, desc, gte, lte, isNull, sql, inArray } from "drizzle-orm";

export interface IGtdStorage {
  createTask(task: InsertTask): Promise<Task>;
  getTask(id: string): Promise<Task | undefined>;
  getUserTasks(userId: string): Promise<Task[]>;
  getAllTasks(locationId?: string): Promise<Task[]>;
  updateTask(id: string, updates: Partial<Task>): Promise<Task>;
  deleteTask(id: string): Promise<void>;
  getTasksForDate(date: Date): Promise<Task[]>;

  getChoresForDay(dayOfWeek: string, timeOfDay?: string): Promise<Task[]>;
  assignChoreToUser(choreId: string, userId: string): Promise<Task>;
  signOffChore(choreId: string, userId: string, isManager: boolean): Promise<Task>;
  getWeeklyChoreSchedule(): Promise<Record<string, Task[]>>;
  getChoresByZone(zone: string): Promise<Task[]>;

  broadcastTask(taskId: string, managerId: string, locationId?: string): Promise<{ assignees: TaskAssignee[]; count: number }>;
  getTaskAssignees(taskId: string, broadcastGroupId?: string): Promise<Array<TaskAssignee & { user: { id: string; firstName: string | null; lastName: string | null; profileImageUrl: string | null } }>>;
  getMyBroadcastAssignments(userId: string): Promise<Array<TaskAssignee & { task: Task }>>;
  updateTaskAssignee(assigneeId: string, updates: Partial<TaskAssignee>): Promise<TaskAssignee>;
  createRedoAssignment(rejectedAssigneeId: string): Promise<TaskAssignee>;
  getPendingVerifications(locationId?: string): Promise<Array<{ assignee: TaskAssignee; task: Task; user: { id: string; firstName: string | null; lastName: string | null; profileImageUrl: string | null }; streak: number }>>;
  getCompletionStreak(taskId: string, userId: string, excludeId?: string): Promise<number>;
  getTaskBroadcastProgress(taskId: string): Promise<{ total: number; approved: number; completed: number; in_progress: number; pending: number; rejected: number }>;
  getAllTaskBroadcastSummary(locationId?: string): Promise<Record<string, { total: number; approved: number }>>;
  getClockedInEmployeeCount(locationId?: string): Promise<number>;

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

  createDayNote(note: InsertDayNote): Promise<DayNote>;
  getDayNotes(startDate: string, endDate: string): Promise<DayNote[]>;
  getDayNotesByUser(startDate: string, endDate: string, userId: string): Promise<DayNote[]>;
  updateDayNote(id: string, noteText: string): Promise<DayNote>;
  deleteDayNote(id: string): Promise<void>;
  getDayNote(id: string): Promise<DayNote | undefined>;
}

export class GtdStorage implements IGtdStorage {
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

  async broadcastTask(taskId: string, managerId: string, locationId?: string): Promise<{ assignees: TaskAssignee[]; count: number }> {
    const { randomUUID } = await import("crypto");
    const broadcastGroupId = randomUUID();

    const managerRoleNames = ['owner', 'admin', 'manager', 'assistant_manager'];

    const baseWhere = and(
      isNull(timeEntries.clockOutTime),
      sql`${users.id} != ${managerId}`,
      sql`${roles.name} NOT IN (${sql.join(managerRoleNames.map(n => sql`${n}`), sql`, `)})`,
      ...(locationId ? [eq(timeEntries.locationId, locationId)] : []),
    );

    const clockedInUsers = await db
      .selectDistinct({ id: users.id, firstName: users.firstName, lastName: users.lastName })
      .from(timeEntries)
      .innerJoin(users, eq(timeEntries.userId, users.id))
      .innerJoin(roles, eq(users.roleId, roles.id))
      .where(baseWhere);

    if (clockedInUsers.length === 0) return { assignees: [], count: 0 };

    const activeAssignees = await db
      .select({ userId: taskAssignees.userId })
      .from(taskAssignees)
      .where(and(
        eq(taskAssignees.taskId, taskId),
        sql`${taskAssignees.status} NOT IN ('approved', 'rejected')`
      ));
    const alreadyAssignedIds = new Set(activeAssignees.map(a => a.userId));

    const eligibleUsers = clockedInUsers.filter(u => !alreadyAssignedIds.has(u.id));
    if (eligibleUsers.length === 0) return { assignees: [], count: 0 };

    const [taskLevelApproved] = await db
      .select({ completionImageUrl: taskAssignees.completionImageUrl })
      .from(taskAssignees)
      .where(and(
        eq(taskAssignees.taskId, taskId),
        eq(taskAssignees.status, "approved"),
        sql`${taskAssignees.completionImageUrl} IS NOT NULL`,
      ))
      .orderBy(sql`${taskAssignees.managerApprovedAt} DESC NULLS LAST`)
      .limit(1);
    const taskPreviousImageUrl = taskLevelApproved?.completionImageUrl ?? null;

    const result: TaskAssignee[] = [];
    for (const u of eligibleUsers) {
      const [created] = await db.insert(taskAssignees).values({
        taskId,
        userId: u.id,
        assignedBy: managerId,
        broadcastGroupId,
        status: "pending",
        previousImageUrl: taskPreviousImageUrl,
      }).returning();
      result.push(created);
    }

    return { assignees: result, count: result.length };
  }

  async getTaskAssignees(taskId: string, broadcastGroupId?: string): Promise<Array<TaskAssignee & { user: { id: string; firstName: string | null; lastName: string | null; profileImageUrl: string | null } }>> {
    const condition = broadcastGroupId
      ? and(eq(taskAssignees.taskId, taskId), eq(taskAssignees.broadcastGroupId, broadcastGroupId))
      : eq(taskAssignees.taskId, taskId);
    const rows = await db
      .select({
        assignee: taskAssignees,
        user: { id: users.id, firstName: users.firstName, lastName: users.lastName, profileImageUrl: users.profileImageUrl },
      })
      .from(taskAssignees)
      .innerJoin(users, eq(taskAssignees.userId, users.id))
      .where(condition)
      .orderBy(desc(taskAssignees.createdAt));
    return rows.map(r => ({ ...r.assignee, user: r.user }));
  }

  async getMyBroadcastAssignments(userId: string): Promise<Array<TaskAssignee & { task: Task }>> {
    const rows = await db
      .selectDistinctOn([taskAssignees.taskId, taskAssignees.broadcastGroupId], { assignee: taskAssignees, task: tasks })
      .from(taskAssignees)
      .innerJoin(tasks, eq(taskAssignees.taskId, tasks.id))
      .where(and(
        eq(taskAssignees.userId, userId),
        sql`${taskAssignees.status} NOT IN ('approved')`
      ))
      .orderBy(taskAssignees.taskId, taskAssignees.broadcastGroupId, desc(taskAssignees.createdAt));
    return rows.map(r => ({ ...r.assignee, task: r.task }));
  }

  async updateTaskAssignee(assigneeId: string, updates: Partial<TaskAssignee>): Promise<TaskAssignee> {
    const [updated] = await db
      .update(taskAssignees)
      .set(updates)
      .where(eq(taskAssignees.id, assigneeId))
      .returning();
    return updated;
  }

  async createRedoAssignment(rejectedAssigneeId: string): Promise<TaskAssignee> {
    const [rejectedRow] = await db
      .select()
      .from(taskAssignees)
      .where(eq(taskAssignees.id, rejectedAssigneeId))
      .limit(1);
    if (!rejectedRow) throw new Error(`Assignee row ${rejectedAssigneeId} not found`);
    if (rejectedRow.status !== 'rejected') throw new Error(`Assignment is not in rejected state`);

    const [taskApproved] = await db
      .select({ completionImageUrl: taskAssignees.completionImageUrl })
      .from(taskAssignees)
      .where(and(
        eq(taskAssignees.taskId, rejectedRow.taskId),
        eq(taskAssignees.status, 'approved'),
        sql`${taskAssignees.completionImageUrl} IS NOT NULL`,
      ))
      .orderBy(sql`${taskAssignees.managerApprovedAt} DESC NULLS LAST`)
      .limit(1);

    const [newRow] = await db.insert(taskAssignees).values({
      taskId: rejectedRow.taskId,
      userId: rejectedRow.userId,
      assignedBy: rejectedRow.assignedBy,
      broadcastGroupId: rejectedRow.broadcastGroupId,
      status: 'in_progress' as const,
      startedAt: new Date(),
      previousImageUrl: taskApproved?.completionImageUrl ?? null,
    }).returning();
    return newRow;
  }

  async getPendingVerifications(locationId?: string): Promise<Array<{ assignee: TaskAssignee; task: Task; user: { id: string; firstName: string | null; lastName: string | null; profileImageUrl: string | null }; streak: number }>> {
    const where = locationId
      ? and(eq(taskAssignees.status, "completed"), eq(tasks.locationId, locationId))
      : eq(taskAssignees.status, "completed");
    const rows = await db
      .select({ assignee: taskAssignees, task: tasks, user: { id: users.id, firstName: users.firstName, lastName: users.lastName, profileImageUrl: users.profileImageUrl } })
      .from(taskAssignees)
      .innerJoin(tasks, eq(taskAssignees.taskId, tasks.id))
      .innerJoin(users, eq(taskAssignees.userId, users.id))
      .where(where)
      .orderBy(desc(taskAssignees.completedAt));
    const result = await Promise.all(rows.map(async (r) => {
      const streak = await this.getCompletionStreak(r.assignee.taskId, r.assignee.userId, r.assignee.id);
      return { assignee: r.assignee, task: r.task, user: r.user, streak };
    }));
    return result;
  }

  async getCompletionStreak(taskId: string, userId: string, excludeId?: string): Promise<number> {
    const rows = await db
      .select({ id: taskAssignees.id, status: taskAssignees.status })
      .from(taskAssignees)
      .where(and(eq(taskAssignees.taskId, taskId), eq(taskAssignees.userId, userId)))
      .orderBy(desc(taskAssignees.createdAt));
    let streak = 0;
    for (const row of rows) {
      if (excludeId && row.id === excludeId) continue;
      if (row.status === "approved") streak++;
      else break;
    }
    return streak;
  }

  async getTaskBroadcastProgress(taskId: string): Promise<{ total: number; approved: number; completed: number; in_progress: number; pending: number; rejected: number }> {
    const [latestGroup] = await db
      .selectDistinctOn([taskAssignees.taskId], { broadcastGroupId: taskAssignees.broadcastGroupId })
      .from(taskAssignees)
      .where(eq(taskAssignees.taskId, taskId))
      .orderBy(taskAssignees.taskId, desc(taskAssignees.createdAt));

    if (!latestGroup) return { total: 0, approved: 0, completed: 0, in_progress: 0, pending: 0, rejected: 0 };

    const rows = await db
      .selectDistinctOn([taskAssignees.userId], { status: taskAssignees.status })
      .from(taskAssignees)
      .where(and(
        eq(taskAssignees.taskId, taskId),
        eq(taskAssignees.broadcastGroupId, latestGroup.broadcastGroupId),
      ))
      .orderBy(taskAssignees.userId, desc(taskAssignees.createdAt));

    const counts = { total: rows.length, approved: 0, completed: 0, in_progress: 0, pending: 0, rejected: 0 };
    for (const r of rows) {
      const k = r.status as keyof typeof counts;
      if (k in counts && k !== 'total') counts[k]++;
    }
    return counts;
  }

  async getAllTaskBroadcastSummary(locationId?: string): Promise<Record<string, { total: number; approved: number }>> {
    const latestGroupQuery = db
      .selectDistinctOn([taskAssignees.taskId], {
        taskId: taskAssignees.taskId,
        broadcastGroupId: taskAssignees.broadcastGroupId,
      })
      .from(taskAssignees)
      .innerJoin(tasks, eq(taskAssignees.taskId, tasks.id))
      .orderBy(taskAssignees.taskId, desc(taskAssignees.createdAt));

    const latestGroups = locationId
      ? await latestGroupQuery.where(eq(tasks.locationId, locationId))
      : await latestGroupQuery;

    if (latestGroups.length === 0) return {};

    const map: Record<string, { total: number; approved: number }> = {};
    for (const { taskId, broadcastGroupId } of latestGroups) {
      const userRows = await db
        .selectDistinctOn([taskAssignees.userId], { status: taskAssignees.status })
        .from(taskAssignees)
        .where(and(
          eq(taskAssignees.taskId, taskId),
          eq(taskAssignees.broadcastGroupId, broadcastGroupId),
        ))
        .orderBy(taskAssignees.userId, desc(taskAssignees.createdAt));

      map[taskId] = {
        total: userRows.length,
        approved: userRows.filter(r => r.status === 'approved').length,
      };
    }
    return map;
  }

  async getClockedInEmployeeCount(locationId?: string): Promise<number> {
    const managerRoleNames = ['owner', 'admin', 'manager', 'assistant_manager'];
    const baseWhere = and(
      isNull(timeEntries.clockOutTime),
      sql`${roles.name} NOT IN (${sql.join(managerRoleNames.map(n => sql`${n}`), sql`, `)})`,
      ...(locationId ? [eq(timeEntries.locationId, locationId)] : []),
    );
    const rows = await db
      .selectDistinct({ id: users.id })
      .from(timeEntries)
      .innerJoin(users, eq(timeEntries.userId, users.id))
      .innerJoin(roles, eq(users.roleId, roles.id))
      .where(baseWhere);
    return rows.length;
  }

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
}
