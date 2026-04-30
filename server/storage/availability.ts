import {
  userAvailability,
  availabilityTemplates,
  userAvailabilityOverrides,
  timeOffRequests,
  type UserAvailability,
  type InsertUserAvailability,
  type AvailabilityTemplate,
  type InsertAvailabilityTemplate,
  type UserAvailabilityOverride,
  type InsertUserAvailabilityOverride,
  type TimeOffRequest,
  type InsertTimeOffRequest,
  type TemplateSlot,
} from "@shared/schema";
import { db } from "../db";
import { eq, and, desc, gte, lte, inArray, sql } from "drizzle-orm";

export interface IAvailabilityStorage {
  submitAvailability(availability: InsertUserAvailability[]): Promise<UserAvailability[]>;
  getUserAvailability(userId: string, payrollPeriodId?: string): Promise<UserAvailability[]>;
  getUserAvailabilityByDateRange(userId: string, startDate: Date, endDate: Date): Promise<UserAvailability[]>;
  getAllAvailabilityForPeriod(payrollPeriodId: string): Promise<UserAvailability[]>;
  getAllAvailabilityByDateRange(startDate: Date, endDate: Date): Promise<UserAvailability[]>;

  getAvailabilityTemplate(userId: string): Promise<AvailabilityTemplate | undefined>;
  getAvailabilityTemplatesForUsers(userIds: string[]): Promise<AvailabilityTemplate[]>;
  upsertAvailabilityTemplate(userId: string, slots: Record<string, TemplateSlot>, autoApplyTemplate?: boolean): Promise<AvailabilityTemplate>;

  upsertAvailabilityOverride(userId: string, date: string, data: { startTime?: string | null; endTime?: string | null; unavailable: boolean; setByManagerId?: string | null }): Promise<UserAvailabilityOverride>;
  getAvailabilityOverrides(userId: string, startDate: string, endDate: string): Promise<UserAvailabilityOverride[]>;
  getAvailabilityOverridesForUsers(userIds: string[], startDate: string, endDate: string): Promise<UserAvailabilityOverride[]>;
  deleteAvailabilityOverride(userId: string, date: string): Promise<void>;

  createTimeOffRequest(request: InsertTimeOffRequest): Promise<TimeOffRequest>;
  getTimeOffRequests(userId?: string): Promise<TimeOffRequest[]>;
  getTimeOffRequest(id: string): Promise<TimeOffRequest | undefined>;
  updateTimeOffRequest(id: string, updates: Partial<TimeOffRequest>): Promise<TimeOffRequest>;
  deleteTimeOffRequest(id: string): Promise<void>;
}

export class AvailabilityStorage implements IAvailabilityStorage {
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
    slots: Record<string, TemplateSlot>,
    autoApplyTemplate?: boolean
  ): Promise<AvailabilityTemplate> {
    const values: any = { userId, slots };
    if (autoApplyTemplate !== undefined) values.autoApplyTemplate = autoApplyTemplate;
    const setValues: any = { slots, updatedAt: new Date() };
    if (autoApplyTemplate !== undefined) setValues.autoApplyTemplate = autoApplyTemplate;
    const [result] = await db
      .insert(availabilityTemplates)
      .values(values)
      .onConflictDoUpdate({
        target: availabilityTemplates.userId,
        set: setValues,
      })
      .returning();
    return result;
  }

  async upsertAvailabilityOverride(
    userId: string,
    date: string,
    data: { startTime?: string | null; endTime?: string | null; unavailable: boolean; setByManagerId?: string | null }
  ): Promise<UserAvailabilityOverride> {
    const [result] = await db
      .insert(userAvailabilityOverrides)
      .values({
        userId,
        date,
        startTime: data.startTime ?? null,
        endTime: data.endTime ?? null,
        unavailable: data.unavailable,
        setByManagerId: data.setByManagerId ?? null,
      })
      .onConflictDoUpdate({
        target: [userAvailabilityOverrides.userId, userAvailabilityOverrides.date],
        set: {
          startTime: data.startTime ?? null,
          endTime: data.endTime ?? null,
          unavailable: data.unavailable,
          setByManagerId: data.setByManagerId ?? null,
          updatedAt: new Date(),
        },
      })
      .returning();
    return result;
  }

  async getAvailabilityOverrides(userId: string, startDate: string, endDate: string): Promise<UserAvailabilityOverride[]> {
    return await db
      .select()
      .from(userAvailabilityOverrides)
      .where(
        and(
          eq(userAvailabilityOverrides.userId, userId),
          sql`${userAvailabilityOverrides.date} >= ${startDate}`,
          sql`${userAvailabilityOverrides.date} <= ${endDate}`
        )
      );
  }

  async getAvailabilityOverridesForUsers(userIds: string[], startDate: string, endDate: string): Promise<UserAvailabilityOverride[]> {
    if (userIds.length === 0) return [];
    return await db
      .select()
      .from(userAvailabilityOverrides)
      .where(
        and(
          inArray(userAvailabilityOverrides.userId, userIds),
          sql`${userAvailabilityOverrides.date} >= ${startDate}`,
          sql`${userAvailabilityOverrides.date} <= ${endDate}`
        )
      );
  }

  async deleteAvailabilityOverride(userId: string, date: string): Promise<void> {
    await db
      .delete(userAvailabilityOverrides)
      .where(
        and(
          eq(userAvailabilityOverrides.userId, userId),
          eq(userAvailabilityOverrides.date, date)
        )
      );
  }

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
}
