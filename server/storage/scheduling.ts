import {
  timeEntries,
  schedules,
  payrollPeriods,
  payPeriodSettings,
  scheduleConfirmations,
  workflowLogs,
  clockEvents,
  performanceScoreSettings,
  holidayPayRules,
  timeEntryEdits,
  discrepancyResolutions,
  offsiteAllowanceRules,
  offsiteSessions,
  offsiteBreadcrumbs,
  overtimeAlerts,
  mileageReimbursements,
  timesheetWorkflowSettings,
  timesheetReminderLog,
  timesheetPeriodApprovals,
  type TimeEntry,
  type InsertTimeEntry,
  type Schedule,
  type InsertSchedule,
  type PayrollPeriod,
  type InsertPayrollPeriod,
  type PayPeriodSettings,
  type InsertPayPeriodSettings,
  type ScheduleConfirmation,
  type InsertScheduleConfirmation,
  type WorkflowLog,
  type InsertWorkflowLog,
  type ClockEvent,
  type InsertClockEvent,
  type PerformanceScoreSetting,
  type InsertPerformanceScoreSetting,
  type HolidayPayRule,
  type InsertHolidayPayRule,
  type TimeEntryEdit,
  type InsertTimeEntryEdit,
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
  type MileageReimbursement,
  type InsertMileageReimbursement,
  type TimesheetWorkflowSettings,
  type TimesheetReminderLog,
  type TimesheetPeriodApproval,
} from "@shared/schema";
import { db } from "../db";
import { eq, and, desc, gte, lte, isNull, sql } from "drizzle-orm";

export interface ISchedulingStorage {
  createTimeEntry(entry: InsertTimeEntry): Promise<TimeEntry>;
  getTimeEntry(id: string): Promise<TimeEntry | undefined>;
  getActiveTimeEntry(userId: string): Promise<TimeEntry | undefined>;
  updateTimeEntry(id: string, updates: Partial<TimeEntry>): Promise<TimeEntry>;
  getUserTimeEntries(userId: string, startDate?: Date, endDate?: Date): Promise<TimeEntry[]>;
  getAllTimeEntries(startDate?: Date, endDate?: Date): Promise<TimeEntry[]>;

  createSchedule(schedule: InsertSchedule): Promise<Schedule>;
  createSchedulesBatch(scheduleList: InsertSchedule[]): Promise<Schedule[]>;
  getUserSchedules(userId: string, startDate?: Date, endDate?: Date): Promise<Schedule[]>;
  getAllSchedules(startDate?: Date, endDate?: Date, locationId?: string): Promise<Schedule[]>;
  updateSchedule(id: string, updates: Partial<Schedule>): Promise<Schedule>;
  deleteSchedule(id: string): Promise<void>;

  createPayrollPeriod(period: InsertPayrollPeriod): Promise<PayrollPeriod>;
  getPayrollPeriods(): Promise<PayrollPeriod[]>;
  updatePayrollPeriod(id: string, updates: Partial<PayrollPeriod>): Promise<PayrollPeriod>;
  getNextPayrollPeriod(): Promise<PayrollPeriod | undefined>;
  getPayrollPeriod(id: string): Promise<any>;
  getPayrollSettings(): Promise<any>;
  createPayrollSettings(data: any): Promise<any>;
  updatePayrollSettings(id: string, updates: any): Promise<any>;
  getUpcomingPayrollPeriods(limit: number): Promise<any[]>;
  getLatestPayrollPeriod(): Promise<any>;
  getPendingPayrollPeriods(): Promise<any[]>;
  getSchedulesByPeriod(periodId: string): Promise<any[]>;
  getTimeEntriesByPeriod(periodId: string): Promise<any[]>;

  getPayPeriodSettings(): Promise<PayPeriodSettings | undefined>;
  updatePayPeriodSettings(settings: InsertPayPeriodSettings): Promise<PayPeriodSettings>;
  createNextPayPeriod(): Promise<PayrollPeriod>;

  createScheduleConfirmation(confirmation: InsertScheduleConfirmation): Promise<ScheduleConfirmation>;
  getScheduleConfirmations(payrollPeriodId: string): Promise<ScheduleConfirmation[]>;
  updateScheduleConfirmation(id: string, updates: Partial<ScheduleConfirmation>): Promise<ScheduleConfirmation>;

  createWorkflowLog(log: InsertWorkflowLog): Promise<WorkflowLog>;
  getWorkflowLogs(payrollPeriodId: string): Promise<WorkflowLog[]>;

  createClockEvent(event: InsertClockEvent): Promise<ClockEvent>;
  getClockEvents(userId: string, startDate?: Date, endDate?: Date): Promise<ClockEvent[]>;
  getAllClockEvents(startDate?: Date, endDate?: Date): Promise<ClockEvent[]>;

  getPerformanceScoreSettings(): Promise<PerformanceScoreSetting[]>;
  upsertPerformanceScoreSetting(setting: InsertPerformanceScoreSetting): Promise<PerformanceScoreSetting>;
  getPerformanceScores(startDate?: Date, endDate?: Date): Promise<{ userId: string; totalPoints: number; eventCount: number }[]>;

  createHolidayPayRule(rule: InsertHolidayPayRule): Promise<HolidayPayRule>;
  getAllHolidayPayRules(): Promise<HolidayPayRule[]>;
  deleteHolidayPayRule(id: string): Promise<void>;
  updateHolidayPayRule(id: string, updates: Partial<HolidayPayRule>): Promise<HolidayPayRule>;

  createTimeEntryEdit(edit: InsertTimeEntryEdit): Promise<TimeEntryEdit>;
  getTimeEntryEdits(timeEntryId: string): Promise<TimeEntryEdit[]>;

  createDiscrepancyResolution(resolution: InsertDiscrepancyResolution): Promise<DiscrepancyResolution>;
  getDiscrepancyResolutions(userId: string, startDate: string, endDate: string): Promise<DiscrepancyResolution[]>;
  getAllDiscrepancyResolutions(startDate: string, endDate: string): Promise<DiscrepancyResolution[]>;

  createOffsiteRule(rule: InsertOffsiteAllowanceRule): Promise<OffsiteAllowanceRule>;
  getOffsiteRules(locationId: string): Promise<OffsiteAllowanceRule[]>;
  getOffsiteRule(id: string): Promise<OffsiteAllowanceRule | undefined>;
  updateOffsiteRule(id: string, updates: Partial<OffsiteAllowanceRule>): Promise<OffsiteAllowanceRule>;
  deleteOffsiteRule(id: string): Promise<void>;

  createOffsiteSession(session: InsertOffsiteSession): Promise<OffsiteSession>;
  getOffsiteSession(id: string): Promise<OffsiteSession | undefined>;
  getOffsiteSessions(filters?: { userId?: string; status?: string; timeEntryId?: string; locationId?: string; from?: Date; to?: Date }): Promise<OffsiteSession[]>;
  updateOffsiteSession(id: string, updates: Partial<OffsiteSession>): Promise<OffsiteSession>;

  createOffsiteBreadcrumb(breadcrumb: InsertOffsiteBreadcrumb): Promise<OffsiteBreadcrumb>;
  getOffsiteBreadcrumbs(sessionId: string): Promise<OffsiteBreadcrumb[]>;

  createOvertimeAlert(alert: InsertOvertimeAlert): Promise<OvertimeAlert>;
  getOvertimeAlerts(filters?: { status?: string; weekStartDate?: Date }): Promise<OvertimeAlert[]>;
  updateOvertimeAlert(id: string, updates: Partial<OvertimeAlert>): Promise<OvertimeAlert>;

  createMileageReimbursement(data: InsertMileageReimbursement): Promise<MileageReimbursement>;
  getMileageReimbursement(id: string): Promise<MileageReimbursement | undefined>;
  getMileageReimbursementBySession(sessionId: string): Promise<MileageReimbursement | undefined>;
  getMileageReimbursements(filters?: { userId?: string; startDate?: Date; endDate?: Date }): Promise<MileageReimbursement[]>;
  updateMileageReimbursement(id: string, updates: Partial<MileageReimbursement>): Promise<MileageReimbursement>;

  getTimesheetWorkflowSettings(storeId?: string | null): Promise<TimesheetWorkflowSettings | undefined>;
  getAllTimesheetWorkflowSettings(): Promise<TimesheetWorkflowSettings[]>;
  upsertTimesheetWorkflowSettings(settings: Partial<Omit<TimesheetWorkflowSettings, 'id'>>, storeId?: string | null): Promise<TimesheetWorkflowSettings>;
  createTimesheetReminderLog(log: { storeId?: string | null; periodStart: string; periodEnd: string; reminderType: string; userId?: string | null }): Promise<TimesheetReminderLog>;
  getTimesheetReminderLogs(periodStart?: string, periodEnd?: string, storeId?: string | null): Promise<TimesheetReminderLog[]>;
  markReminderActedOn(id: string): Promise<void>;
  markRemindersActedOnForPeriod(periodStart: string, periodEnd: string, storeId?: string | null): Promise<void>;
  getTimesheetPeriodApproval(storeId: string, periodStart: string, periodEnd: string): Promise<TimesheetPeriodApproval | undefined>;
  upsertTimesheetPeriodApproval(data: {
    storeId: string;
    periodStart: string;
    periodEnd: string;
    status: string;
    managerApprovedBy?: string | null;
    managerApprovedAt?: Date | null;
    adminApprovedBy?: string | null;
    adminApprovedAt?: Date | null;
  }): Promise<TimesheetPeriodApproval>;
}

export class SchedulingStorage implements ISchedulingStorage {
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

  async getPayPeriodSettings(): Promise<PayPeriodSettings | undefined> {
    const [settings] = await db
      .select()
      .from(payPeriodSettings)
      .orderBy(desc(payPeriodSettings.createdAt))
      .limit(1);
    return settings;
  }

  async updatePayPeriodSettings(settingsData: InsertPayPeriodSettings): Promise<PayPeriodSettings> {
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
      startDate = new Date();
      startDate.setHours(0, 0, 0, 0);
    } else {
      startDate = new Date(lastPeriod[0].endDate);
      startDate.setDate(startDate.getDate() + 1);
    }

    endDate = new Date(startDate);
    switch (settings?.intervalType) {
      case 'weekly':
        endDate.setDate(startDate.getDate() + 6);
        break;
      case 'monthly':
        endDate.setMonth(startDate.getMonth() + 1);
        endDate.setDate(startDate.getDate() - 1);
        break;
      default:
        endDate.setDate(startDate.getDate() + 13);
        break;
    }

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

    return await db
      .select({
        userId: clockEvents.userId,
        totalPoints: sql<number>`COALESCE(SUM(${clockEvents.pointValue}), 0)::int`,
        eventCount: sql<number>`COUNT(*)::int`,
      })
      .from(clockEvents)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .groupBy(clockEvents.userId)
      .orderBy(sql`SUM(${clockEvents.pointValue}) DESC`);
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

  async getAllDiscrepancyResolutions(startDate: string, endDate: string): Promise<DiscrepancyResolution[]> {
    return await db
      .select()
      .from(discrepancyResolutions)
      .where(
        and(
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

  async getTimesheetWorkflowSettings(storeId?: string | null): Promise<TimesheetWorkflowSettings | undefined> {
    if (storeId) {
      // Strict store-scoped lookup — never fall back to a different store's row
      const [row] = await db
        .select()
        .from(timesheetWorkflowSettings)
        .where(eq(timesheetWorkflowSettings.storeId, storeId))
        .limit(1);
      return row;
    }
    // No storeId provided — legacy/unscoped singleton row only
    const [row] = await db
      .select()
      .from(timesheetWorkflowSettings)
      .where(isNull(timesheetWorkflowSettings.storeId))
      .limit(1);
    return row;
  }

  async getAllTimesheetWorkflowSettings(): Promise<TimesheetWorkflowSettings[]> {
    return await db.select().from(timesheetWorkflowSettings);
  }

  async upsertTimesheetWorkflowSettings(settings: Partial<Omit<TimesheetWorkflowSettings, 'id'>>, storeId?: string | null): Promise<TimesheetWorkflowSettings> {
    // Fetch ONLY this store's row (or the unscoped row when storeId is null) — never update another store
    const existing = await this.getTimesheetWorkflowSettings(storeId);
    const merged = { ...settings, storeId: storeId ?? null };
    if (existing) {
      const [updated] = await db
        .update(timesheetWorkflowSettings)
        .set({ ...merged, updatedAt: new Date() })
        .where(eq(timesheetWorkflowSettings.id, existing.id))
        .returning();
      return updated;
    }
    const [created] = await db
      .insert(timesheetWorkflowSettings)
      .values({ ...merged, updatedAt: new Date() })
      .returning();
    return created;
  }

  async createTimesheetReminderLog(log: { storeId?: string | null; periodStart: string; periodEnd: string; reminderType: string; userId?: string | null }): Promise<TimesheetReminderLog> {
    const [created] = await db
      .insert(timesheetReminderLog)
      .values({
        storeId: log.storeId ?? null,
        periodStart: log.periodStart,
        periodEnd: log.periodEnd,
        reminderType: log.reminderType,
        userId: log.userId ?? null,
        sentAt: new Date(),
        wasActedOn: false,
        actedOnAt: null,
      })
      .returning();
    return created;
  }

  async getTimesheetReminderLogs(periodStart?: string, periodEnd?: string, storeId?: string | null): Promise<TimesheetReminderLog[]> {
    const conditions: any[] = [];
    if (storeId) conditions.push(eq(timesheetReminderLog.storeId, storeId));
    if (periodStart) conditions.push(sql`${timesheetReminderLog.periodStart} >= ${periodStart}`);
    if (periodEnd) conditions.push(sql`${timesheetReminderLog.periodEnd} <= ${periodEnd}`);
    const query = conditions.length > 0
      ? db.select().from(timesheetReminderLog).where(and(...conditions))
      : db.select().from(timesheetReminderLog);
    return await query.orderBy(desc(timesheetReminderLog.sentAt)).limit(200);
  }

  async markReminderActedOn(id: string): Promise<void> {
    await db
      .update(timesheetReminderLog)
      .set({ wasActedOn: true, actedOnAt: new Date() })
      .where(eq(timesheetReminderLog.id, id));
  }

  async markRemindersActedOnForPeriod(periodStart: string, periodEnd: string, storeId?: string | null): Promise<void> {
    const conditions: any[] = [
      sql`${timesheetReminderLog.periodStart} = ${periodStart}`,
      sql`${timesheetReminderLog.periodEnd} = ${periodEnd}`,
      eq(timesheetReminderLog.wasActedOn, false),
    ];
    if (storeId) conditions.push(eq(timesheetReminderLog.storeId, storeId));
    await db
      .update(timesheetReminderLog)
      .set({ wasActedOn: true, actedOnAt: new Date() })
      .where(and(...conditions));
  }

  async getTimesheetPeriodApproval(storeId: string, periodStart: string, periodEnd: string): Promise<TimesheetPeriodApproval | undefined> {
    const [row] = await db
      .select()
      .from(timesheetPeriodApprovals)
      .where(
        and(
          eq(timesheetPeriodApprovals.storeId, storeId),
          sql`${timesheetPeriodApprovals.periodStart} = ${periodStart}`,
          sql`${timesheetPeriodApprovals.periodEnd} = ${periodEnd}`
        )
      )
      .limit(1);
    return row;
  }

  async upsertTimesheetPeriodApproval(data: {
    storeId: string;
    periodStart: string;
    periodEnd: string;
    status: string;
    managerApprovedBy?: string | null;
    managerApprovedAt?: Date | null;
    adminApprovedBy?: string | null;
    adminApprovedAt?: Date | null;
  }): Promise<TimesheetPeriodApproval> {
    const existing = await this.getTimesheetPeriodApproval(data.storeId, data.periodStart, data.periodEnd);
    const now = new Date();
    if (existing) {
      const [updated] = await db
        .update(timesheetPeriodApprovals)
        .set({
          status: data.status,
          managerApprovedBy: data.managerApprovedBy ?? existing.managerApprovedBy,
          managerApprovedAt: data.managerApprovedAt ?? existing.managerApprovedAt,
          adminApprovedBy: data.adminApprovedBy ?? existing.adminApprovedBy,
          adminApprovedAt: data.adminApprovedAt ?? existing.adminApprovedAt,
          updatedAt: now,
        })
        .where(eq(timesheetPeriodApprovals.id, existing.id))
        .returning();
      return updated;
    }
    const [created] = await db
      .insert(timesheetPeriodApprovals)
      .values({
        storeId: data.storeId,
        periodStart: data.periodStart,
        periodEnd: data.periodEnd,
        status: data.status,
        managerApprovedBy: data.managerApprovedBy ?? null,
        managerApprovedAt: data.managerApprovedAt ?? null,
        adminApprovedBy: data.adminApprovedBy ?? null,
        adminApprovedAt: data.adminApprovedAt ?? null,
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    return created;
  }
}
