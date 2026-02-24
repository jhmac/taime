import type { Express } from "express";
import type { IStorage } from "../storage";
import { db } from "../db";
import { schedules, timeEntries, shopifyDailySales, userShops, users } from "@shared/schema";
import { eq, and, gte, lte, desc } from "drizzle-orm";
import { cache } from "../lib/cache";

export function registerDashboardRoutes(app: Express, storage: IStorage, isAuthenticated: any) {
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

      const userShopRows = await db.select().from(userShops).limit(1);
      if (userShopRows.length === 0) {
        return res.json({ hasGoal: false, message: "No Shopify store connected" });
      }

      const shopDomain = userShopRows[0].shopDomain;

      const oneYearAgo = new Date(now);
      oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
      const twoYearsAgo = new Date(now);
      twoYearsAgo.setFullYear(twoYearsAgo.getFullYear() - 2);

      const lastYearSales = await db.select()
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

      const todaySales = await db.select()
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
}
