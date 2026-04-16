import type { Express } from "express";
import type { IStorage } from "../storage";
import { db } from "../db";
import { schedules, timeEntries, shopifyDailySales, userShops, users, locationPermissions } from "@shared/schema";
import { eq, and, gte, lte, desc, isNull, ne, inArray } from "drizzle-orm";
import { cache } from "../lib/cache";
import { gamificationService } from "../services/gamificationService";
import { setLocationPermission } from "../lib/locationPermissionStore";

export function registerDashboardRoutes(app: Express, storage: IStorage, isAuthenticated: any) {

  /**
   * POST /api/location-permission
   * Employees report their current location permission state so managers can see
   * which staff have location blocked on the Today dashboard card.
   */
  app.post('/api/location-permission', isAuthenticated, async (req: any, res) => {
    try {
      const userId: string = req.user.id;
      const { status } = req.body;
      const allowed = ['granted', 'denied', 'prompt', 'unknown'];
      if (!status || !allowed.includes(status)) {
        return res.status(400).json({ message: 'Invalid status' });
      }
      await setLocationPermission(userId, status);
      res.json({ ok: true });
    } catch (error) {
      console.error('Error saving location permission:', error);
      res.status(500).json({ message: 'Failed to save location permission' });
    }
  });

  /**
   * GET /api/dashboard/init
   * Returns all first-render data in a single round-trip to reduce dashboard load waterfall.
   * Includes: current user with role, active time entry, permissions, company settings,
   * and (for employees) gamification score, (for managers/owners) today's summary.
   */
  app.get('/api/dashboard/init', isAuthenticated, async (req: any, res) => {
    try {
      const userId: string = req.user.id;

      const [userWithRole, activeTimeEntry, permissions, companySettings] = await Promise.all([
        storage.getUserWithRole(userId),
        storage.getActiveTimeEntry(userId),
        storage.getUserPermissions(userId),
        storage.getCompanySettings(),
      ]);

      const role = userWithRole?.role?.name;
      const isEmployee = role !== 'owner' && role !== 'admin';
      const isManagerOrOwner = role === 'owner' || role === 'admin';

      let gamificationScore: { overallScore: number; tier: string } | null = null;
      let todaySummary: {
        totalClockedIn: number;
        totalScheduled: number;
        activeEntries: any[];
      } | null = null;

      if (isEmployee) {
        try {
          const myScore = await gamificationService.computeUserScore(userId);
          gamificationScore = {
            overallScore: myScore.overallScore,
            tier: myScore.tier,
          };
        } catch {
          // non-fatal — gamification score is optional for first render
        }
      }

      if (isManagerOrOwner) {
        try {
          const now = new Date();
          const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
          const endOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);

          const [todayTimeEntries, todaySchedules] = await Promise.all([
            db.select({
              id: timeEntries.id,
              userId: timeEntries.userId,
              clockInTime: timeEntries.clockInTime,
              clockOutTime: timeEntries.clockOutTime,
            }).from(timeEntries).where(gte(timeEntries.clockInTime, startOfDay)),
            db.select({ id: schedules.id }).from(schedules).where(and(
              gte(schedules.startTime, startOfDay),
              lte(schedules.startTime, endOfDay),
            )),
          ]);

          const activeEntries = todayTimeEntries.filter(te => !te.clockOutTime);

          todaySummary = {
            totalClockedIn: activeEntries.length,
            totalScheduled: todaySchedules.length,
            activeEntries: activeEntries.map(te => ({
              id: te.id,
              userId: te.userId,
              clockInTime: te.clockInTime,
            })),
          };
        } catch {
          // non-fatal — today summary is optional for first render
        }
      }

      res.json({
        user: userWithRole,
        activeTimeEntry: activeTimeEntry ?? null,
        permissions,
        companySettings: companySettings ?? null,
        gamificationScore,
        todaySummary,
      });
    } catch (error) {
      console.error("Error fetching dashboard init data:", error);
      res.status(500).json({ message: "Failed to fetch dashboard init data" });
    }
  });

  app.get('/api/dashboard/today', isAuthenticated, async (req: any, res) => {
    try {
      const now = new Date();
      const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const endOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);

      let userList = cache.get<{ id: string; firstName: string | null; lastName: string | null; profileImageUrl: string | null }[]>('dashboard:userlist');
      if (!userList) {
        userList = await db.select({
          id: users.id,
          firstName: users.firstName,
          lastName: users.lastName,
          profileImageUrl: users.profileImageUrl,
        }).from(users).where(eq(users.isActive, true));
        cache.set('dashboard:userlist', userList, 60_000);
      }
      const userMap = new Map(userList.map(u => [u.id, u]));

      const todaySchedules = await db.select({
          id: schedules.id,
          userId: schedules.userId,
          startTime: schedules.startTime,
          endTime: schedules.endTime,
          title: schedules.title,
        })
        .from(schedules)
        .where(and(
          gte(schedules.startTime, startOfDay),
          lte(schedules.startTime, endOfDay)
        ));

      const todayTimeEntries = await db.select({
          id: timeEntries.id,
          userId: timeEntries.userId,
          clockInTime: timeEntries.clockInTime,
          clockOutTime: timeEntries.clockOutTime,
          locationId: timeEntries.locationId,
        })
        .from(timeEntries)
        .where(
          gte(timeEntries.clockInTime, startOfDay)
        );

      const activeEntries = todayTimeEntries.filter(te => !te.clockOutTime);

      const entriesByUser = new Map<string, typeof todayTimeEntries>();
      for (const te of todayTimeEntries) {
        const arr = entriesByUser.get(te.userId) ?? [];
        arr.push(te);
        entriesByUser.set(te.userId, arr);
      }

      const TTL_MS = 24 * 60 * 60 * 1000;
      const cutoff = new Date(Date.now() - TTL_MS);
      const scheduledUserIds = [...new Set(todaySchedules.map(s => s.userId))];
      const locationBlockedMap = new Map<string, boolean>();
      if (scheduledUserIds.length > 0) {
        const permRows = await db
          .select()
          .from(locationPermissions)
          .where(inArray(locationPermissions.userId, scheduledUserIds));
        const staleUserIds: string[] = [];
        for (const row of permRows) {
          if (row.reportedAt < cutoff) {
            staleUserIds.push(row.userId);
          } else {
            locationBlockedMap.set(row.userId, row.status === 'denied');
          }
        }
        if (staleUserIds.length > 0) {
          await db.delete(locationPermissions).where(inArray(locationPermissions.userId, staleUserIds));
        }
      }

      const scheduleData = todaySchedules.map(s => {
        const user = userMap.get(s.userId);
        const userEntries = entriesByUser.get(s.userId) ?? [];
        const clockedInEntry = userEntries.find(te => !te.clockOutTime);
        const firstClockIn = userEntries.length > 0
          ? userEntries.reduce((earliest, te) =>
              new Date(te.clockInTime) < new Date(earliest.clockInTime) ? te : earliest
            )
          : null;

        let isLate = false;
        let minutesLate = 0;
        if (firstClockIn) {
          const clockInTime = new Date(firstClockIn.clockInTime).getTime();
          const scheduledStart = new Date(s.startTime).getTime();
          if (clockInTime > scheduledStart + 60000) {
            isLate = true;
            minutesLate = Math.round((clockInTime - scheduledStart) / 60000);
          }
        }

        const scheduledStart = new Date(s.startTime);
        const minutesUntilShift = Math.round((scheduledStart.getTime() - now.getTime()) / 60000);

        return {
          scheduleId: s.id,
          userId: s.userId,
          userName: user ? `${user.firstName || ''} ${user.lastName || ''}`.trim() : 'Unknown',
          profileImageUrl: user?.profileImageUrl || null,
          startTime: s.startTime,
          endTime: s.endTime,
          title: s.title,
          isClockedIn: !!clockedInEntry,
          clockInTime: firstClockIn?.clockInTime || null,
          isLate,
          minutesLate,
          minutesUntilShift: minutesUntilShift > 0 ? minutesUntilShift : null,
          shiftPassed: minutesUntilShift <= 0 && !clockedInEntry,
          locationBlocked: locationBlockedMap.get(s.userId) ?? false,
        };
      });

      scheduleData.sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());

      const clockedInData = activeEntries.map(te => {
        const user = userMap.get(te.userId);
        const matchingSchedule = todaySchedules.find(s => s.userId === te.userId);
        let isLate = false;
        let minutesLate = 0;
        if (matchingSchedule) {
          const clockInTime = new Date(te.clockInTime).getTime();
          const scheduledStart = new Date(matchingSchedule.startTime).getTime();
          if (clockInTime > scheduledStart + 60000) {
            isLate = true;
            minutesLate = Math.round((clockInTime - scheduledStart) / 60000);
          }
        }
        const hoursWorked = (now.getTime() - new Date(te.clockInTime).getTime()) / 3600000;

        return {
          userId: te.userId,
          userName: user ? `${user.firstName || ''} ${user.lastName || ''}`.trim() : 'Unknown',
          profileImageUrl: user?.profileImageUrl || null,
          clockInTime: te.clockInTime,
          hoursWorked: Math.round(hoursWorked * 100) / 100,
          isLate,
          minutesLate,
          locationId: te.locationId,
        };
      });

      res.json({
        schedules: scheduleData,
        clockedIn: clockedInData,
        summary: {
          totalScheduled: todaySchedules.length,
          totalClockedIn: activeEntries.length,
          totalLate: scheduleData.filter(s => s.isLate).length,
          totalNotArrived: scheduleData.filter(s => !s.isClockedIn && s.shiftPassed).length,
        },
      });
    } catch (error) {
      console.error("Error fetching dashboard data:", error);
      res.status(500).json({ message: "Failed to fetch dashboard data" });
    }
  });

  app.get('/api/dashboard/daily-goal', isAuthenticated, async (req: any, res) => {
    try {
      const now = new Date();
      const todayDow = now.getDay();

      const userShopRows = await db.select({ shopDomain: userShops.shopDomain }).from(userShops).limit(1);
      if (userShopRows.length === 0) {
        return res.json({ hasGoal: false, message: "No Shopify store connected" });
      }

      const shopDomain = userShopRows[0].shopDomain;

      const oneYearAgo = new Date(now);
      oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
      const twoYearsAgo = new Date(now);
      twoYearsAgo.setFullYear(twoYearsAgo.getFullYear() - 2);

      const lastYearSales = await db.select({
          date: shopifyDailySales.date,
          totalRevenue: shopifyDailySales.totalRevenue,
          orderCount: shopifyDailySales.orderCount,
        })
        .from(shopifyDailySales)
        .where(and(
          eq(shopifyDailySales.shopDomain, shopDomain),
          eq(shopifyDailySales.dayOfWeek, todayDow),
          gte(shopifyDailySales.date, twoYearsAgo),
          lte(shopifyDailySales.date, oneYearAgo)
        ))
        .orderBy(desc(shopifyDailySales.date));

      if (lastYearSales.length === 0) {
        return res.json({ hasGoal: false, message: "No sales data for this day from last year" });
      }

      const closestSameDay = lastYearSales[0];
      const avgRevenue = lastYearSales.reduce((sum, s) => sum + parseFloat(s.totalRevenue || '0'), 0) / lastYearSales.length;
      const avgOrders = lastYearSales.reduce((sum, s) => sum + (s.orderCount || 0), 0) / lastYearSales.length;

      const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

      const todaySales = await db.select({
          totalRevenue: shopifyDailySales.totalRevenue,
          orderCount: shopifyDailySales.orderCount,
        })
        .from(shopifyDailySales)
        .where(and(
          eq(shopifyDailySales.shopDomain, shopDomain),
          gte(shopifyDailySales.date, new Date(now.getFullYear(), now.getMonth(), now.getDate())),
          lte(shopifyDailySales.date, new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59))
        ))
        .limit(1);

      const currentRevenue = todaySales.length > 0 ? parseFloat(todaySales[0].totalRevenue || '0') : 0;
      const currentOrders = todaySales.length > 0 ? (todaySales[0].orderCount || 0) : 0;

      res.json({
        hasGoal: true,
        dayName: dayNames[todayDow],
        goal: {
          revenue: Math.round(avgRevenue * 100) / 100,
          orders: Math.round(avgOrders),
          basedOnDate: closestSameDay.date,
          sampleSize: lastYearSales.length,
        },
        current: {
          revenue: currentRevenue,
          orders: currentOrders,
        },
        progress: avgRevenue > 0 ? Math.min(Math.round((currentRevenue / avgRevenue) * 100), 100) : 0,
      });
    } catch (error) {
      console.error("Error fetching daily goal:", error);
      res.status(500).json({ message: "Failed to fetch daily goal" });
    }
  });

  /**
   * GET /api/team-status/clocked-in
   * Returns teammates currently clocked in at the same location as the requesting user.
   * Excludes the requesting user themselves.
   */
  app.get('/api/team-status/clocked-in', isAuthenticated, async (req: any, res) => {
    try {
      const userId: string = req.user.id;

      const [currentUser] = await db.select({
        locationName: users.locationName,
        companyId: users.companyId,
      })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);

      if (!currentUser) {
        return res.json({ clockedIn: [] });
      }

      const { locationName, companyId } = currentUser;

      // Require both location and company context — never leak cross-location or cross-tenant data
      if (!locationName || !companyId) {
        return res.json({ clockedIn: [] });
      }

      const now = new Date();

      // "Currently clocked in" = clockOutTime IS NULL, regardless of when they clocked in
      // All filters pushed to SQL: tenant (companyId), location (locationName), active user, exclude self
      const activeEntries = await db.select({
        entryUserId: timeEntries.userId,
        clockInTime: timeEntries.clockInTime,
        firstName: users.firstName,
        lastName: users.lastName,
        profileImageUrl: users.profileImageUrl,
      })
        .from(timeEntries)
        .innerJoin(users, eq(timeEntries.userId, users.id))
        .where(and(
          isNull(timeEntries.clockOutTime),
          ne(timeEntries.userId, userId),
          eq(users.isActive, true),
          eq(users.companyId, companyId),
          eq(users.locationName, locationName),
        ));

      // Deduplicate by userId — keep the earliest clock-in per person
      const seenUsers = new Map<string, typeof activeEntries[number]>();
      for (const e of activeEntries) {
        const existing = seenUsers.get(e.entryUserId);
        if (!existing || new Date(e.clockInTime) < new Date(existing.clockInTime)) {
          seenUsers.set(e.entryUserId, e);
        }
      }

      const clockedIn = Array.from(seenUsers.values()).map(e => ({
        userId: e.entryUserId,
        firstName: e.firstName,
        lastName: e.lastName,
        profileImageUrl: e.profileImageUrl,
        clockInTime: e.clockInTime,
        minutesOnShift: Math.floor((now.getTime() - new Date(e.clockInTime).getTime()) / 60000),
      }));

      clockedIn.sort((a, b) => new Date(a.clockInTime).getTime() - new Date(b.clockInTime).getTime());

      res.json({ clockedIn });
    } catch (error) {
      console.error("Error fetching clocked-in team status:", error);
      res.status(500).json({ message: "Failed to fetch team status" });
    }
  });

  /**
   * GET /api/team-status/upcoming-shifts
   * Returns upcoming scheduled shifts for today at the same location,
   * for teammates not yet clocked in.
   */
  app.get('/api/team-status/upcoming-shifts', isAuthenticated, async (req: any, res) => {
    try {
      const userId: string = req.user.id;

      const [currentUser] = await db.select({
        locationName: users.locationName,
        companyId: users.companyId,
      })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);

      if (!currentUser) {
        return res.json({ upcomingShifts: [] });
      }

      const { locationName, companyId } = currentUser;

      // Require both location and company context — never leak cross-location or cross-tenant data
      if (!locationName || !companyId) {
        return res.json({ upcomingShifts: [] });
      }

      const now = new Date();
      const endOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);

      const [upcomingSchedules, activeEntries] = await Promise.all([
        // Upcoming shifts scoped to same tenant + location at SQL level
        db.select({
          scheduleId: schedules.id,
          scheduleUserId: schedules.userId,
          startTime: schedules.startTime,
          endTime: schedules.endTime,
          firstName: users.firstName,
          lastName: users.lastName,
          profileImageUrl: users.profileImageUrl,
        })
          .from(schedules)
          .innerJoin(users, eq(schedules.userId, users.id))
          .where(and(
            gte(schedules.startTime, now),
            lte(schedules.startTime, endOfDay),
            ne(schedules.userId, userId),
            eq(users.isActive, true),
            eq(users.companyId, companyId),
            eq(users.locationName, locationName),
          )),

        // Exclude anyone currently clocked in (clockOutTime IS NULL = actively on shift)
        // Scoped to same tenant + location — avoids suppressing shifts due to cross-location clock-in
        db.select({ entryUserId: timeEntries.userId })
          .from(timeEntries)
          .innerJoin(users, eq(timeEntries.userId, users.id))
          .where(and(
            isNull(timeEntries.clockOutTime),
            eq(users.companyId, companyId),
            eq(users.locationName, locationName),
          )),
      ]);

      const clockedInUserIds = new Set(activeEntries.map(e => e.entryUserId));

      // Deduplicate by userId — keep the earliest upcoming shift per person
      const seenShiftUsers = new Map<string, typeof upcomingSchedules[number]>();
      for (const s of upcomingSchedules) {
        if (clockedInUserIds.has(s.scheduleUserId)) continue;
        const existing = seenShiftUsers.get(s.scheduleUserId);
        if (!existing || new Date(s.startTime) < new Date(existing.startTime)) {
          seenShiftUsers.set(s.scheduleUserId, s);
        }
      }

      const upcomingShifts = Array.from(seenShiftUsers.values()).map(s => ({
        scheduleId: s.scheduleId,
        userId: s.scheduleUserId,
        firstName: s.firstName,
        lastName: s.lastName,
        profileImageUrl: s.profileImageUrl,
        startTime: s.startTime,
        endTime: s.endTime,
        minutesUntilShift: Math.floor((new Date(s.startTime).getTime() - now.getTime()) / 60000),
      }));

      upcomingShifts.sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());

      res.json({ upcomingShifts });
    } catch (error) {
      console.error("Error fetching upcoming shifts team status:", error);
      res.status(500).json({ message: "Failed to fetch upcoming shifts" });
    }
  });
}
