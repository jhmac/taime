import type { Express } from "express";
import type { IStorage } from "../storage";
import { db } from "../db";
import { schedules, timeEntries, shopifyDailySales, userShops, users, locationPermissions } from "@shared/schema";
import { eq, and, gte, lte, lt, desc, isNull, ne, inArray, or } from "drizzle-orm";
import { cache } from "../services/cache";
import { gamificationService } from "../services/gamificationService";
import { setLocationPermission, getLocationPermissionPreference } from "../services/locationPermissionStore";

// Maximum time the init endpoint will wait for DB queries before responding
// with a 503 so the client can show a retry prompt rather than hanging.
const SERVER_INIT_TIMEOUT_MS = 5_000;

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms)
    ),
  ]);
}

export function registerDashboardRoutes(app: Express, storage: IStorage, isAuthenticated: any) {

  /**
   * GET /api/location-permission
   * Returns the authenticated user's last-saved location permission status so the
   * client can hydrate localStorage on a new device or after storage was cleared.
   */
  app.get('/api/location-permission', isAuthenticated, async (req: any, res) => {
    try {
      const userId: string = req.user.id;
      const record = await getLocationPermissionPreference(userId);
      if (!record) {
        return res.json({ status: null });
      }
      return res.json({ status: record.status });
    } catch (error) {
      console.error('Error reading location permission:', error);
      res.status(500).json({ message: 'Failed to read location permission' });
    }
  });

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
    // Record absolute deadline so every async branch shares the same budget.
    const deadlineAt = Date.now() + SERVER_INIT_TIMEOUT_MS;
    const remaining = () => Math.max(0, deadlineAt - Date.now());

    try {
      const userId: string = req.user.id;

      const INIT_CACHE_TTL_MS = 30_000;
      const initCacheKey = `dashboard:init:${userId}`;
      const cached = cache.get<object>(initCacheKey);
      if (cached) {
        return res.json(cached);
      }

      const [userWithRole, activeTimeEntry, permissions, companySettings] = await withTimeout(
        Promise.all([
          storage.getUserWithRole(userId),
          storage.getActiveTimeEntry(userId),
          storage.getUserPermissions(userId),
          storage.getCompanySettings(),
        ]),
        remaining(),
        'dashboard/init core',
      );

      const role = userWithRole?.role?.name;
      const isEmployee = role !== 'owner' && role !== 'admin';
      const isManagerOrOwner = role === 'owner' || role === 'admin';

      let gamificationScore: { overallScore: number; tier: string } | null = null;
      let gamificationError = false;
      let todaySummary: {
        totalClockedIn: number;
        totalScheduled: number;
        activeEntries: any[];
      } | null = null;
      let todaySummaryError = false;

      if (isEmployee) {
        const cachedScore = cache.get<{ overallScore: number; tier: string }>(`gamification:score:${userId}`);
        if (cachedScore) {
          gamificationScore = cachedScore;
        } else {
          // Fire gamification in the background — don't hold up the response.
          // Result is cached so the next request (or a quick refetch) gets it instantly.
          // gamificationError stays false here; the client receives gamificationScore=null
          // which it treats as "still loading" rather than a failure.
          setImmediate(() => {
            gamificationService.computeUserScore(userId)
              .then(myScore => {
                const result = { overallScore: myScore.overallScore, tier: myScore.tier };
                cache.set(`gamification:score:${userId}`, result, 5 * 60_000);
              })
              .catch(err => {
                console.warn('[dashboard/init] background gamification score failed:', err instanceof Error ? err.message : err);
              });
          });
        }
      }

      if (isManagerOrOwner) {
        try {
          const now = new Date();
          const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
          const endOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);

          const [todayTimeEntries, overnightEntries, todaySchedules] = await withTimeout(
            Promise.all([
              db.select({
                id: timeEntries.id,
                userId: timeEntries.userId,
                clockInTime: timeEntries.clockInTime,
                clockOutTime: timeEntries.clockOutTime,
              }).from(timeEntries).where(gte(timeEntries.clockInTime, startOfDay)),
              // Also capture overnight entries (clocked in before midnight, still active)
              db.select({
                id: timeEntries.id,
                userId: timeEntries.userId,
                clockInTime: timeEntries.clockInTime,
                clockOutTime: timeEntries.clockOutTime,
              }).from(timeEntries).where(and(
                isNull(timeEntries.clockOutTime),
                lt(timeEntries.clockInTime, startOfDay),
              )),
              db.select({ id: schedules.id }).from(schedules).where(and(
                gte(schedules.startTime, startOfDay),
                lte(schedules.startTime, endOfDay),
              )),
            ]),
            remaining(),
            'dashboard/init today-summary',
          );

          // Merge today entries with overnight active entries (deduplicate by userId)
          const todayUserIds = new Set(todayTimeEntries.map(te => te.userId));
          const mergedEntries = [
            ...todayTimeEntries,
            ...overnightEntries.filter(te => !todayUserIds.has(te.userId)),
          ];

          const activeEntries = mergedEntries.filter(te => !te.clockOutTime);

          todaySummary = {
            totalClockedIn: activeEntries.length,
            totalScheduled: todaySchedules.length,
            activeEntries: activeEntries.map(te => ({
              id: te.id,
              userId: te.userId,
              clockInTime: te.clockInTime,
            })),
          };
        } catch (err) {
          todaySummaryError = true;
          console.warn('[dashboard/init] today summary failed (non-fatal):', err instanceof Error ? err.message : err);
        }
      }

      const initResponse = {
        user: userWithRole,
        activeTimeEntry: activeTimeEntry ?? null,
        permissions,
        companySettings: companySettings ?? null,
        gamificationScore,
        gamificationError,
        todaySummary,
        todaySummaryError,
      };
      cache.set(initCacheKey, initResponse, INIT_CACHE_TTL_MS);
      res.json(initResponse);
    } catch (error) {
      const isTimeout = error instanceof Error && error.message.includes('timed out');
      console.error("Error fetching dashboard init data:", error);
      res
        .status(isTimeout ? 503 : 500)
        .json({ message: isTimeout ? "Dashboard init timed out" : "Failed to fetch dashboard init data" });
    }
  });

  app.get('/api/dashboard/today', isAuthenticated, async (req: any, res) => {
    try {
      const now = new Date();
      const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const endOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);

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

      // Also fetch entries that started BEFORE today but are still active (clocked in overnight).
      // These are "currently on shift" and must appear in the clocked-in list even though
      // their clockInTime predates today's midnight boundary.
      const overnightActiveEntries = await db.select({
          id: timeEntries.id,
          userId: timeEntries.userId,
          clockInTime: timeEntries.clockInTime,
          clockOutTime: timeEntries.clockOutTime,
          locationId: timeEntries.locationId,
        })
        .from(timeEntries)
        .where(
          and(
            isNull(timeEntries.clockOutTime),
            lt(timeEntries.clockInTime, startOfDay),
          )
        );

      // Merge: start with today entries, then append overnight active entries whose
      // user doesn't already have a today entry (avoids double-counting people who
      // clocked out and back in today after an overnight shift).
      const todayUserIds = new Set(todayTimeEntries.map(te => te.userId));
      const allTimeEntries = [
        ...todayTimeEntries,
        ...overnightActiveEntries.filter(te => !todayUserIds.has(te.userId)),
      ];

      const activeEntries = allTimeEntries.filter(te => !te.clockOutTime);

      const entriesByUser = new Map<string, typeof allTimeEntries>();
      for (const te of allTimeEntries) {
        const uid = String(te.userId);
        const arr = entriesByUser.get(uid) ?? [];
        arr.push(te);
        entriesByUser.set(uid, arr);
      }

      // Build a userMap that covers everyone referenced in today's schedules AND
      // active time entries. Start with the cached active-user list, then do a
      // single supplemental fetch for any IDs that are missing (e.g. account
      // owners whose isActive flag is false, or users added after the last cache
      // refresh). This prevents "Unknown" names and missing clock-in entries.
      type UserRow = { id: string; firstName: string | null; lastName: string | null; profileImageUrl: string | null };
      let userList = cache.get<UserRow[]>('dashboard:userlist');
      if (!userList) {
        userList = await db.select({
          id: users.id,
          firstName: users.firstName,
          lastName: users.lastName,
          profileImageUrl: users.profileImageUrl,
        }).from(users).where(eq(users.isActive, true));
        cache.set('dashboard:userlist', userList, 60_000);
      }
      const userMap = new Map<string, UserRow>(userList.map(u => [String(u.id), u]));

      // Collect all user IDs referenced by schedules and active time entries.
      const referencedUserIds = new Set<string>([
        ...todaySchedules.map(s => String(s.userId)),
        ...activeEntries.map(te => String(te.userId)),
      ]);
      const missingUserIds = [...referencedUserIds].filter(id => !userMap.has(id));
      if (missingUserIds.length > 0) {
        const extraUsers = await db.select({
          id: users.id,
          firstName: users.firstName,
          lastName: users.lastName,
          profileImageUrl: users.profileImageUrl,
        }).from(users).where(inArray(users.id, missingUserIds));
        for (const u of extraUsers) {
          userMap.set(String(u.id), u);
        }
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
        const uid = String(s.userId);
        const user = userMap.get(uid);
        const userEntries = entriesByUser.get(uid) ?? [];
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
          timeEntryId: clockedInEntry?.id || null,
          clockInTime: firstClockIn?.clockInTime || null,
          isLate,
          minutesLate,
          minutesUntilShift: minutesUntilShift > 0 ? minutesUntilShift : null,
          shiftPassed: minutesUntilShift <= 0 && !clockedInEntry,
          locationBlocked: locationBlockedMap.get(uid) ?? false,
          isOvernightShift: clockedInEntry ? new Date(clockedInEntry.clockInTime) < startOfDay : false,
        };
      });

      scheduleData.sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());

      // Deduplicate active entries by userId — keep the most-recently-clocked-in
      // entry per user to guard against data-integrity edge cases where two rows
      // somehow lack a clockOutTime for the same person.
      const activeByUser = new Map<string, typeof activeEntries[number]>();
      for (const te of activeEntries) {
        const uid = String(te.userId);
        const existing = activeByUser.get(uid);
        if (!existing || new Date(te.clockInTime) > new Date(existing.clockInTime)) {
          activeByUser.set(uid, te);
        }
      }
      const deduplicatedActiveEntries = [...activeByUser.values()];

      const clockedInData = deduplicatedActiveEntries.map(te => {
        const uid = String(te.userId);
        const user = userMap.get(uid);
        const matchingSchedule = todaySchedules.find(s => String(s.userId) === uid);
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
          timeEntryId: te.id,
          userId: te.userId,
          userName: user ? `${user.firstName || ''} ${user.lastName || ''}`.trim() : 'Unknown',
          profileImageUrl: user?.profileImageUrl || null,
          clockInTime: te.clockInTime,
          scheduledStartTime: matchingSchedule?.startTime ?? null,
          hoursWorked: Math.round(hoursWorked * 100) / 100,
          isLate,
          minutesLate,
          locationId: te.locationId,
          isOvernightShift: new Date(te.clockInTime) < startOfDay,
        };
      });

      res.json({
        schedules: scheduleData,
        clockedIn: clockedInData,
        summary: {
          totalScheduled: todaySchedules.length,
          totalClockedIn: deduplicatedActiveEntries.length,
          totalLate: scheduleData.filter(s => s.isLate).length,
          totalNotArrived: scheduleData.filter(s => !s.isClockedIn && s.shiftPassed).length,
          totalLocationBlocked: new Set(scheduleData.filter(s => s.locationBlocked && !s.isClockedIn).map(s => s.userId)).size,
        },
        serverTimestamp: now.toISOString(),
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
      const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

      // Load company settings to check if feature is enabled and get increase config
      const companySettings = await storage.getCompanySettings();
      const goalEnabled = companySettings?.dailySalesGoalEnabled ?? false;

      const userShopRows = await db.select({ shopDomain: userShops.shopDomain }).from(userShops).limit(1);
      if (userShopRows.length === 0) {
        return res.json({ hasGoal: false, goalEnabled, message: "No Shopify store connected" });
      }

      const shopDomain = userShopRows[0].shopDomain;

      // Find the closest same-day-of-week from approximately one year ago (look in a ±4 week window around exactly 52 weeks back)
      const exactlyOneYearAgo = new Date(now);
      exactlyOneYearAgo.setFullYear(exactlyOneYearAgo.getFullYear() - 1);
      const windowStart = new Date(exactlyOneYearAgo);
      windowStart.setDate(windowStart.getDate() - 28);
      const windowEnd = new Date(exactlyOneYearAgo);
      windowEnd.setDate(windowEnd.getDate() + 28);

      const lastYearSales = await db.select({
          date: shopifyDailySales.date,
          totalRevenue: shopifyDailySales.totalRevenue,
          orderCount: shopifyDailySales.orderCount,
          averageOrderValue: shopifyDailySales.averageOrderValue,
        })
        .from(shopifyDailySales)
        .where(and(
          eq(shopifyDailySales.shopDomain, shopDomain),
          eq(shopifyDailySales.dayOfWeek, todayDow),
          gte(shopifyDailySales.date, windowStart),
          lte(shopifyDailySales.date, windowEnd)
        ))
        .orderBy(desc(shopifyDailySales.date));

      if (lastYearSales.length === 0) {
        return res.json({ hasGoal: false, goalEnabled, message: "No sales data for this day from last year" });
      }

      // Use the closest same-day entry from last year
      const lastYearEntry = lastYearSales[0];
      const lastYearRevenue = parseFloat(lastYearEntry.totalRevenue || '0');
      const lastYearOrders = lastYearEntry.orderCount || 0;
      const avgOrderValue = lastYearOrders > 0
        ? parseFloat(lastYearEntry.averageOrderValue || '0') || (lastYearRevenue / lastYearOrders)
        : 0;

      // Apply increase
      const increaseType = companySettings?.salesGoalIncreaseType ?? 'percentage';
      const increaseValue = parseFloat(String(companySettings?.salesGoalIncreaseValue ?? '0'));
      let increaseAmount = 0;
      if (increaseType === 'percentage') {
        increaseAmount = Math.round(lastYearRevenue * (increaseValue / 100) * 100) / 100;
      } else {
        increaseAmount = increaseValue;
      }
      const goalRevenue = Math.round((lastYearRevenue + increaseAmount) * 100) / 100;
      const goalOrders = lastYearOrders > 0 && avgOrderValue > 0
        ? Math.ceil(goalRevenue / avgOrderValue)
        : lastYearOrders;

      // Fetch today's current sales
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
      const amountRemaining = Math.max(goalRevenue - currentRevenue, 0);
      const salesNeeded = avgOrderValue > 0 ? Math.ceil(amountRemaining / avgOrderValue) : 0;
      const progress = goalRevenue > 0 ? Math.min(Math.round((currentRevenue / goalRevenue) * 100), 100) : 0;

      res.json({
        hasGoal: true,
        goalEnabled,
        dayName: dayNames[todayDow],
        lastYearRevenue,
        lastYearOrders,
        lastYearDate: lastYearEntry.date,
        increaseType,
        increaseValue,
        increaseAmount,
        averageOrderValue: Math.round(avgOrderValue * 100) / 100,
        goal: {
          revenue: goalRevenue,
          orders: goalOrders,
        },
        current: {
          revenue: currentRevenue,
          orders: currentOrders,
        },
        amountRemaining,
        salesNeeded,
        progress,
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

      if (!companyId) {
        return res.json({ clockedIn: [] });
      }

      const now = new Date();

      // "Currently clocked in" = clockOutTime IS NULL, regardless of when they clocked in
      // Filter by company always; also filter by location when both requester and others have one set.
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
          eq(users.isActive, true),
          eq(users.companyId, companyId),
          ...(locationName ? [or(eq(users.locationName, locationName), isNull(users.locationName))] : []),
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

      if (!companyId) {
        return res.json({ upcomingShifts: [] });
      }

      const now = new Date();
      const endOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);

      const [upcomingSchedules, activeEntries] = await Promise.all([
        // Upcoming shifts scoped to same tenant (+ location when set) at SQL level
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
            eq(users.isActive, true),
            eq(users.companyId, companyId),
            ...(locationName ? [or(eq(users.locationName, locationName), isNull(users.locationName))] : []),
          )),

        // Exclude anyone currently clocked in (clockOutTime IS NULL = actively on shift)
        db.select({ entryUserId: timeEntries.userId })
          .from(timeEntries)
          .innerJoin(users, eq(timeEntries.userId, users.id))
          .where(and(
            isNull(timeEntries.clockOutTime),
            eq(users.companyId, companyId),
            ...(locationName ? [or(eq(users.locationName, locationName), isNull(users.locationName))] : []),
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

  /**
   * GET /api/dashboard/my-pay-summary
   * Returns the logged-in user's pay-period hours worked and estimated gross pay.
   * Used by the manager dashboard Today card header.
   */
  app.get('/api/dashboard/my-pay-summary', isAuthenticated, async (req: any, res) => {
    try {
      const userId: string = req.user.id;

      const [userRow] = await db.select({
        hourlyRate: users.hourlyRate,
      }).from(users).where(eq(users.id, userId)).limit(1);

      const companySettings = await storage.getCompanySettings();

      // Allow any manager/owner/admin to view their own pay summary in the header stats bar.
      // The showPaySummaryToManagers toggle controls additional UI widgets, not this endpoint.
      const callerRole = (req.user as any)?.role?.name as string | undefined;
      const isManagerOrAbove = callerRole === 'manager' || callerRole === 'owner' || callerRole === 'admin' || callerRole === 'assistant_manager';
      if (!isManagerOrAbove) {
        return res.status(403).json({ message: 'Access denied.' });
      }

      const hourlyRate = parseFloat(userRow?.hourlyRate ?? '0');

      // Determine current pay period start
      const now = new Date();
      const freq = companySettings?.payScheduleFrequency ?? 'every_two_weeks';
      const nextPayrollDateStr = companySettings?.nextPayrollDate;

      let periodStart: Date;

      if (freq === 'semi_monthly') {
        // Semi-monthly: periods are 1st–15th and 16th–end-of-month.
        // Calendar-based so it never drifts from actual pay dates.
        const day = now.getDate();
        periodStart = day <= 15
          ? new Date(now.getFullYear(), now.getMonth(), 1)
          : new Date(now.getFullYear(), now.getMonth(), 16);
      } else if (freq === 'monthly') {
        // Monthly: always starts on the 1st of the current month.
        periodStart = new Date(now.getFullYear(), now.getMonth(), 1);
      } else if (nextPayrollDateStr) {
        // weekly / every_two_weeks: anchor-based walk-back from next payroll date.
        const nextPayroll = new Date(nextPayrollDateStr);
        const periodDays = freq === 'weekly' ? 7 : 14;
        let cursor = new Date(nextPayroll);
        while (cursor > now) {
          cursor = new Date(cursor.getTime() - periodDays * 86400000);
        }
        periodStart = cursor;
      } else {
        // Fallback: start of current month.
        periodStart = new Date(now.getFullYear(), now.getMonth(), 1);
      }

      const entries = await db.select({
        clockInTime: timeEntries.clockInTime,
        clockOutTime: timeEntries.clockOutTime,
        breakMinutes: timeEntries.breakMinutes,
      }).from(timeEntries).where(
        and(
          eq(timeEntries.userId, userId),
          gte(timeEntries.clockInTime, periodStart),
        )
      );

      let totalHours = 0;
      for (const entry of entries) {
        const clockOut = entry.clockOutTime ? new Date(entry.clockOutTime) : now;
        const rawMs = clockOut.getTime() - new Date(entry.clockInTime).getTime();
        const breakMs = (entry.breakMinutes ?? 0) * 60000;
        totalHours += Math.max(0, rawMs - breakMs) / 3600000;
      }
      totalHours = Math.round(totalHours * 100) / 100;

      const estimatedPay = Math.round(totalHours * hourlyRate * 100) / 100;

      res.json({
        periodStart: periodStart.toISOString(),
        totalHours,
        hourlyRate,
        estimatedPay,
      });
    } catch (error) {
      console.error("Error fetching pay summary:", error);
      res.status(500).json({ message: "Failed to fetch pay summary" });
    }
  });
}
