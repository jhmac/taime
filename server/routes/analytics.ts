import type { Express } from "express";
import type { IStorage } from "../storage";
import { users } from "@shared/schema";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { cache } from "../services/cache";
import { resolveAnyPermission } from "../services/permissionResolver";

export function registerAnalyticsRoutes(app: Express, storage: IStorage, isAuthenticated: any) {
  app.get('/api/analytics/dashboard', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const roleName = req.user?.role?.name ?? '';
      const isAdminOrOwner = roleName === 'owner' || roleName === 'admin';
      const canView = isAdminOrOwner || (await resolveAnyPermission(userId, ['admin.manage_all', 'sales.view_all'], storage));

      if (!canView) {
        return res.status(403).json({ message: "Access denied" });
      }

      const now = new Date();
      const rawDaysBack = parseInt((req.query.daysBack as string) || '30', 10);
      const daysBack = [1, 7, 30, 90].includes(rawDaysBack) ? rawDaysBack : 30;
      const thirtyDaysAgo = new Date(now);
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - daysBack);
      thirtyDaysAgo.setHours(0, 0, 0, 0);

      const todayStart = new Date(now);
      todayStart.setHours(0, 0, 0, 0);
      const todayEnd = new Date(now);
      todayEnd.setHours(23, 59, 59, 999);

      const weekStart = new Date(now);
      weekStart.setDate(now.getDate() - now.getDay());
      weekStart.setHours(0, 0, 0, 0);

      const lastWeekStart = new Date(weekStart);
      lastWeekStart.setDate(lastWeekStart.getDate() - 7);
      const lastWeekEnd = new Date(weekStart);
      lastWeekEnd.setMilliseconds(-1);

      const [allTimeEntries, allUsers, allSchedules, allTasks] = await Promise.all([
        storage.getAllTimeEntries(thirtyDaysAgo, now),
        cache.getOrSet('analytics:users', () =>
          db.select({ id: users.id, hourlyRate: users.hourlyRate, isActive: users.isActive, firstName: users.firstName, lastName: users.lastName })
            .from(users).where(eq(users.isActive, true)),
          120_000
        ),
        storage.getAllSchedules(thirtyDaysAgo, now),
        storage.getAllTasks(),
      ]);

      const userRateMap = new Map<string, number>();
      allUsers.forEach(u => {
        userRateMap.set(u.id, parseFloat(u.hourlyRate || '15'));
      });

      const dayMap = new Map<string, { totalHours: number; totalCost: number; employees: Set<string> }>();
      for (let d = new Date(thirtyDaysAgo); d <= now; d.setDate(d.getDate() + 1)) {
        const key = d.toISOString().split('T')[0];
        dayMap.set(key, { totalHours: 0, totalCost: 0, employees: new Set() });
      }

      allTimeEntries.forEach(entry => {
        if (!entry.clockOutTime) return;
        const clockIn = new Date(entry.clockInTime);
        const clockOut = new Date(entry.clockOutTime);
        const hours = Math.max(0, (clockOut.getTime() - clockIn.getTime()) / 3600000 - (entry.breakMinutes || 0) / 60);
        const dateKey = clockIn.toISOString().split('T')[0];
        const rate = userRateMap.get(entry.userId) || 15;
        const dayData = dayMap.get(dateKey);
        if (dayData) {
          dayData.totalHours += hours;
          dayData.totalCost += hours * rate;
          dayData.employees.add(entry.userId);
        }
      });

      const laborCostByDay = Array.from(dayMap.entries())
        .map(([date, data]) => ({
          date,
          totalHours: Math.round(data.totalHours * 100) / 100,
          totalCost: Math.round(data.totalCost * 100) / 100,
          employeeCount: data.employees.size,
        }))
        .sort((a, b) => a.date.localeCompare(b.date));

      let onTime = 0;
      let late = 0;
      const scheduleMap = new Map<string, Date[]>();
      allSchedules.forEach(s => {
        const key = `${s.userId}_${new Date(s.startTime).toISOString().split('T')[0]}`;
        if (!scheduleMap.has(key)) scheduleMap.set(key, []);
        scheduleMap.get(key)!.push(new Date(s.startTime));
      });

      const userNameMap = new Map<string, string>();
      allUsers.forEach(u => {
        const name = [u.firstName, u.lastName].filter(Boolean).join(' ') || u.id;
        userNameMap.set(u.id, name);
      });

      const employeePunctuality = new Map<string, { onTime: number; late: number }>();

      allTimeEntries.forEach(entry => {
        const clockIn = new Date(entry.clockInTime);
        const key = `${entry.userId}_${clockIn.toISOString().split('T')[0]}`;
        const scheduledStarts = scheduleMap.get(key);
        if (scheduledStarts && scheduledStarts.length > 0) {
          const closest = scheduledStarts.reduce((prev, curr) =>
            Math.abs(curr.getTime() - clockIn.getTime()) < Math.abs(prev.getTime() - clockIn.getTime()) ? curr : prev
          );
          const diffMinutes = (clockIn.getTime() - closest.getTime()) / 60000;

          if (!employeePunctuality.has(entry.userId)) {
            employeePunctuality.set(entry.userId, { onTime: 0, late: 0 });
          }
          const ep = employeePunctuality.get(entry.userId)!;

          if (diffMinutes <= 5) {
            onTime++;
            ep.onTime++;
          } else {
            late++;
            ep.late++;
          }
        }
      });

      const punctualityTotal = onTime + late;
      const punctualityScore = {
        onTime,
        late,
        total: punctualityTotal,
        percentage: punctualityTotal > 0 ? Math.round((onTime / punctualityTotal) * 100) : 100,
      };

      const employeePunctualityBreakdown = Array.from(employeePunctuality.entries())
        .map(([uid, data]) => {
          const total = data.onTime + data.late;
          return {
            userId: uid,
            name: userNameMap.get(uid) || uid,
            onTime: data.onTime,
            late: data.late,
            total,
            percentage: total > 0 ? Math.round((data.onTime / total) * 100) : 100,
          };
        })
        .sort((a, b) => a.percentage - b.percentage);

      const weekTasks = allTasks.filter(t => {
        const created = new Date(t.createdAt!);
        return created >= weekStart;
      });
      const completedTasks = weekTasks.filter(t => t.status === 'completed').length;
      const taskCompletion = {
        completed: completedTasks,
        total: weekTasks.length,
        percentage: weekTasks.length > 0 ? Math.round((completedTasks / weekTasks.length) * 100) : 0,
      };

      const lastWeekTasks = allTasks.filter(t => {
        const created = new Date(t.createdAt!);
        return created >= lastWeekStart && created <= lastWeekEnd;
      });
      const lastWeekCompleted = lastWeekTasks.filter(t => t.status === 'completed').length;

      const activeEntries = allTimeEntries.filter(e => !e.clockOutTime);
      const todayEntries = allTimeEntries.filter(e => {
        const clockIn = new Date(e.clockInTime);
        return clockIn >= todayStart && clockIn <= todayEnd;
      });
      let totalHoursToday = 0;
      todayEntries.forEach(e => {
        const clockIn = new Date(e.clockInTime);
        const clockOut = e.clockOutTime ? new Date(e.clockOutTime) : now;
        totalHoursToday += Math.max(0, (clockOut.getTime() - clockIn.getTime()) / 3600000 - (e.breakMinutes || 0) / 60);
      });

      const todayTasks = allTasks.filter(t => {
        if (!t.completedAt) return false;
        const completed = new Date(t.completedAt);
        return completed >= todayStart && completed <= todayEnd;
      });

      const teamSummary = {
        activeNow: activeEntries.length,
        totalHoursToday: Math.round(totalHoursToday * 10) / 10,
        tasksCompletedToday: todayTasks.length,
        totalEmployees: allUsers.length,
      };

      let thisWeekHours = 0;
      let thisWeekCost = 0;
      let lastWeekHours = 0;
      let lastWeekCost = 0;

      allTimeEntries.forEach(entry => {
        if (!entry.clockOutTime) return;
        const clockIn = new Date(entry.clockInTime);
        const clockOut = new Date(entry.clockOutTime);
        const hours = Math.max(0, (clockOut.getTime() - clockIn.getTime()) / 3600000 - (entry.breakMinutes || 0) / 60);
        const rate = userRateMap.get(entry.userId) || 15;

        if (clockIn >= weekStart) {
          thisWeekHours += hours;
          thisWeekCost += hours * rate;
        } else if (clockIn >= lastWeekStart && clockIn <= lastWeekEnd) {
          lastWeekHours += hours;
          lastWeekCost += hours * rate;
        }
      });

      const weeklyComparison = {
        thisWeek: {
          hours: Math.round(thisWeekHours * 100) / 100,
          cost: Math.round(thisWeekCost * 100) / 100,
          tasksCompleted: completedTasks,
          tasksTotal: weekTasks.length,
        },
        lastWeek: {
          hours: Math.round(lastWeekHours * 100) / 100,
          cost: Math.round(lastWeekCost * 100) / 100,
          tasksCompleted: lastWeekCompleted,
          tasksTotal: lastWeekTasks.length,
        },
      };

      res.json({ laborCostByDay, punctualityScore, taskCompletion, teamSummary, employeePunctualityBreakdown, weeklyComparison, daysBack });
    } catch (error) {
      console.error("Error fetching analytics dashboard:", error);
      res.status(500).json({ message: "Failed to fetch analytics data" });
    }
  });
}
