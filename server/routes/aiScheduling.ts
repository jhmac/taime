import type { Express } from "express";
import type { IStorage } from "../storage";
import { aiSchedulingSettings, shopifyDailySales, users, userAvailability, schedules, shops } from "@shared/schema";
import { eq, and, gte, lte, desc } from "drizzle-orm";
import { db } from "../db";
import { claudeService } from "../services/claudeService";
import rateLimit from "express-rate-limit";

const aiRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  message: { message: "Too many AI scheduling requests, please try again later" },
});

function findClosestDayOfWeekDate(targetDate: Date, salesDates: Array<{ date: Date; dayOfWeek: number; totalRevenue: string }>): { date: Date; totalRevenue: string } | null {
  const targetDow = targetDate.getDay();
  const targetMonth = targetDate.getMonth();
  const targetDay = targetDate.getDate();

  const lastYearApprox = new Date(targetDate);
  lastYearApprox.setFullYear(lastYearApprox.getFullYear() - 1);

  const sameDowDates = salesDates.filter(s => s.dayOfWeek === targetDow);
  if (sameDowDates.length === 0) return null;

  let closest = sameDowDates[0];
  let closestDiff = Math.abs(sameDowDates[0].date.getTime() - lastYearApprox.getTime());

  for (const entry of sameDowDates) {
    const diff = Math.abs(entry.date.getTime() - lastYearApprox.getTime());
    if (diff < closestDiff) {
      closest = entry;
      closestDiff = diff;
    }
  }

  return { date: closest.date, totalRevenue: closest.totalRevenue };
}

function getStaffingForRevenue(revenue: number, tiers: Array<{ minRevenue: number; maxRevenue: number; employeeCount: number }>, minimumStaffing: number): number {
  if (!tiers || tiers.length === 0) return minimumStaffing;

  for (const tier of tiers) {
    if (revenue >= tier.minRevenue && revenue <= tier.maxRevenue) {
      return Math.max(tier.employeeCount, minimumStaffing);
    }
  }

  const sortedTiers = [...tiers].sort((a, b) => b.maxRevenue - a.maxRevenue);
  if (revenue > sortedTiers[0].maxRevenue) {
    return Math.max(sortedTiers[0].employeeCount, minimumStaffing);
  }

  return minimumStaffing;
}

export function registerAiSchedulingRoutes(app: Express, storage: IStorage, isAuthenticated: any) {
  app.get("/api/ai-scheduling/settings", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const userPermissions = await storage.getUserPermissions(userId);
      const isAdmin = userPermissions.some(p => p.name === 'admin.manage_all');
      if (!isAdmin) {
        return res.status(403).json({ message: "Admin access required" });
      }

      const result = await db.select().from(aiSchedulingSettings).limit(1);
      if (result.length > 0) {
        res.json(result[0]);
      } else {
        res.json({
          shiftBlocks: [
            { name: "Morning", startTime: "09:00", endTime: "14:00" },
            { name: "Afternoon", startTime: "14:00", endTime: "21:00" },
          ],
          staffingTiers: [
            { minRevenue: 0, maxRevenue: 2000, employeeCount: 2 },
            { minRevenue: 2001, maxRevenue: 5000, employeeCount: 3 },
            { minRevenue: 5001, maxRevenue: 10000, employeeCount: 5 },
          ],
          minimumStaffing: 2,
        });
      }
    } catch (error) {
      console.error("Error fetching AI scheduling settings:", error);
      res.status(500).json({ message: "Failed to fetch settings" });
    }
  });

  app.put("/api/ai-scheduling/settings", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const userPermissions = await storage.getUserPermissions(userId);
      const isAdmin = userPermissions.some(p => p.name === 'admin.manage_all');
      if (!isAdmin) {
        return res.status(403).json({ message: "Admin access required" });
      }

      const { shiftBlocks, staffingTiers, minimumStaffing } = req.body;

      const existing = await db.select().from(aiSchedulingSettings).limit(1);

      if (existing.length > 0) {
        await db.update(aiSchedulingSettings)
          .set({
            shiftBlocks: shiftBlocks || existing[0].shiftBlocks,
            staffingTiers: staffingTiers || existing[0].staffingTiers,
            minimumStaffing: minimumStaffing ?? existing[0].minimumStaffing,
            updatedBy: userId,
            updatedAt: new Date(),
          })
          .where(eq(aiSchedulingSettings.id, existing[0].id));
      } else {
        await db.insert(aiSchedulingSettings).values({
          shiftBlocks: shiftBlocks || [],
          staffingTiers: staffingTiers || [],
          minimumStaffing: minimumStaffing ?? 2,
          updatedBy: userId,
        });
      }

      const updated = await db.select().from(aiSchedulingSettings).limit(1);
      res.json(updated[0]);
    } catch (error) {
      console.error("Error updating AI scheduling settings:", error);
      res.status(500).json({ message: "Failed to update settings" });
    }
  });

  app.post("/api/ai-scheduling/generate", isAuthenticated, aiRateLimiter, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const userPermissions = await storage.getUserPermissions(userId);
      const isAdmin = userPermissions.some(p => p.name === 'admin.manage_all');
      if (!isAdmin) {
        return res.status(403).json({ message: "Admin access required" });
      }

      const { startDate, endDate, shopDomain } = req.body;
      if (!startDate || !endDate) {
        return res.status(400).json({ message: "Start date and end date are required" });
      }

      const settingsResult = await db.select().from(aiSchedulingSettings).limit(1);
      const settings = settingsResult[0] || {
        shiftBlocks: [
          { name: "Morning", startTime: "09:00", endTime: "14:00" },
          { name: "Afternoon", startTime: "14:00", endTime: "21:00" },
        ],
        staffingTiers: [
          { minRevenue: 0, maxRevenue: 2000, employeeCount: 2 },
          { minRevenue: 2001, maxRevenue: 5000, employeeCount: 3 },
          { minRevenue: 5001, maxRevenue: 10000, employeeCount: 5 },
        ],
        minimumStaffing: 2,
      };

      const start = new Date(startDate);
      const end = new Date(endDate);

      let salesData: Array<{ date: Date; dayOfWeek: number; totalRevenue: string }> = [];
      let resolvedShopDomain = shopDomain;

      if (!resolvedShopDomain) {
        const activeShops = await db.select().from(shops).where(eq(shops.isActive, true)).limit(1);
        if (activeShops.length > 0) {
          resolvedShopDomain = activeShops[0].shopDomain;
        }
      }

      if (resolvedShopDomain) {
        const oneYearAgo = new Date(start);
        oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 2);
        const salesResult = await db.select()
          .from(shopifyDailySales)
          .where(and(
            eq(shopifyDailySales.shopDomain, resolvedShopDomain),
            gte(shopifyDailySales.date, oneYearAgo)
          ))
          .orderBy(desc(shopifyDailySales.date));

        salesData = salesResult.map(s => ({
          date: new Date(s.date),
          dayOfWeek: s.dayOfWeek,
          totalRevenue: s.totalRevenue || '0',
        }));
      }

      const days: Array<{
        date: string;
        dayOfWeek: number;
        dayName: string;
        predictedRevenue: number;
        requiredStaff: number;
        matchedLastYearDate?: string;
      }> = [];

      const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

      for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
        const current = new Date(d);
        const dateStr = current.toISOString().split('T')[0];
        const dow = current.getDay();

        let predictedRevenue = 0;
        let matchedDate: string | undefined;

        if (salesData.length > 0) {
          const match = findClosestDayOfWeekDate(current, salesData);
          if (match) {
            predictedRevenue = parseFloat(match.totalRevenue);
            matchedDate = match.date.toISOString().split('T')[0];
          }
        }

        const requiredStaff = getStaffingForRevenue(
          predictedRevenue,
          settings.staffingTiers as any[],
          settings.minimumStaffing || 2
        );

        days.push({
          date: dateStr,
          dayOfWeek: dow,
          dayName: dayNames[dow],
          predictedRevenue: Math.round(predictedRevenue * 100) / 100,
          requiredStaff,
          matchedLastYearDate: matchedDate,
        });
      }

      const allUsers = await db.select().from(users).where(eq(users.isActive, true));

      const availabilityResult = await db.select()
        .from(userAvailability)
        .where(and(
          gte(userAvailability.date, start),
          lte(userAvailability.date, end)
        ));

      const availabilityByUserDate: Record<string, Record<string, { isAvailable: boolean; startTime?: string; endTime?: string; timeSlot: string }[]>> = {};
      for (const avail of availabilityResult) {
        const dateKey = new Date(avail.date).toISOString().split('T')[0];
        if (!availabilityByUserDate[avail.userId]) {
          availabilityByUserDate[avail.userId] = {};
        }
        if (!availabilityByUserDate[avail.userId][dateKey]) {
          availabilityByUserDate[avail.userId][dateKey] = [];
        }
        availabilityByUserDate[avail.userId][dateKey].push({
          isAvailable: avail.isAvailable ?? true,
          startTime: avail.startTime || undefined,
          endTime: avail.endTime || undefined,
          timeSlot: avail.timeSlot,
        });
      }

      const employeeList = allUsers
        .filter(u => u.showInSchedule !== false)
        .map(u => {
          const userAvail: Record<string, any> = {};
          for (const day of days) {
            const explicitAvail = availabilityByUserDate[u.id]?.[day.date];
            if (explicitAvail) {
              const unavailable = explicitAvail.some(a => a.isAvailable === false);
              userAvail[day.date] = unavailable ? 'unavailable' : 'available';
            } else {
              userAvail[day.date] = 'available';
            }
          }
          return {
            id: u.id,
            name: `${u.firstName || ''} ${u.lastName || ''}`.trim() || u.email || 'Unknown',
            availability: userAvail,
          };
        });

      const shiftBlocks = (settings.shiftBlocks as any[]) || [];

      const prompt = `You are a workforce scheduling AI. Generate an optimized employee schedule based on the following data.

SHIFT BLOCKS (the time slots employees work):
${shiftBlocks.map((b: any) => `- ${b.name}: ${b.startTime} to ${b.endTime}`).join('\n')}

SCHEDULE PERIOD:
${days.map(d => `- ${d.date} (${d.dayName}): Predicted revenue $${d.predictedRevenue}, need ${d.requiredStaff} staff${d.matchedLastYearDate ? ` (based on ${d.matchedLastYearDate} last year sales)` : ''}`).join('\n')}

MINIMUM STAFFING: Always have at least ${settings.minimumStaffing} employees at any time.

AVAILABLE EMPLOYEES:
${employeeList.map(e => `- ${e.name} (ID: ${e.id}): ${Object.entries(e.availability).map(([date, status]) => `${date}=${status}`).join(', ')}`).join('\n')}

RULES:
1. Each shift block needs enough employees to meet the required staff count for that day.
2. Distribute shifts fairly among available employees.
3. Never schedule an employee on a day they are unavailable.
4. Employees with no explicit availability are available by default.
5. Try to give employees consistent shift blocks when possible.
6. Each employee should work at most one shift block per day.

Respond in JSON format ONLY with no additional text:
{
  "schedule": [
    {
      "date": "YYYY-MM-DD",
      "employeeId": "employee_id",
      "employeeName": "Employee Name",
      "shiftBlock": "shift block name",
      "startTime": "HH:MM",
      "endTime": "HH:MM",
      "reasoning": "brief reason for this assignment"
    }
  ],
  "summary": "Brief summary of the schedule",
  "warnings": ["any warnings about understaffing or conflicts"]
}`;

      const aiResponse = await claudeService.chat(prompt);

      let parsedSchedule: any;
      try {
        const jsonMatch = aiResponse.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          parsedSchedule = JSON.parse(jsonMatch[0]);
        } else {
          throw new Error('No JSON found in AI response');
        }
      } catch (parseErr) {
        console.error('Failed to parse AI schedule response:', parseErr);
        return res.status(500).json({
          message: "AI generated a response but it couldn't be parsed. Please try again.",
          rawResponse: aiResponse.slice(0, 500),
        });
      }

      const employeeIds = new Set(employeeList.map(e => e.id));
      const validSchedule = (parsedSchedule.schedule || []).filter((entry: any) => {
        if (!entry.date || !entry.employeeId || !entry.startTime || !entry.endTime) return false;
        if (!employeeIds.has(entry.employeeId)) return false;
        if (!/^\d{4}-\d{2}-\d{2}$/.test(entry.date)) return false;
        if (!/^\d{2}:\d{2}$/.test(entry.startTime) || !/^\d{2}:\d{2}$/.test(entry.endTime)) return false;
        return true;
      }).map((entry: any) => ({
        date: String(entry.date),
        employeeId: String(entry.employeeId),
        employeeName: String(entry.employeeName || '').slice(0, 200),
        shiftBlock: String(entry.shiftBlock || '').slice(0, 100),
        startTime: String(entry.startTime),
        endTime: String(entry.endTime),
        reasoning: String(entry.reasoning || '').slice(0, 500),
      }));

      res.json({
        success: true,
        days,
        generatedSchedule: validSchedule,
        summary: typeof parsedSchedule.summary === 'string' ? parsedSchedule.summary.slice(0, 1000) : '',
        warnings: Array.isArray(parsedSchedule.warnings) ? parsedSchedule.warnings.map((w: any) => String(w).slice(0, 300)) : [],
        settings: {
          shiftBlocks,
          staffingTiers: settings.staffingTiers,
          minimumStaffing: settings.minimumStaffing,
        },
        salesDataAvailable: salesData.length > 0,
      });
    } catch (error) {
      console.error("Error generating AI schedule:", error);
      res.status(500).json({ message: "Failed to generate schedule" });
    }
  });

  app.post("/api/ai-scheduling/apply", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const userPermissions = await storage.getUserPermissions(userId);
      const isAdmin = userPermissions.some(p => p.name === 'admin.manage_all');
      if (!isAdmin) {
        return res.status(403).json({ message: "Admin access required" });
      }

      const { scheduleEntries } = req.body;
      if (!scheduleEntries || !Array.isArray(scheduleEntries) || scheduleEntries.length === 0) {
        return res.status(400).json({ message: "Schedule entries are required" });
      }

      const allUsers = await db.select().from(users).where(eq(users.isActive, true));
      const validUserIds = new Set(allUsers.map(u => u.id));

      const created = [];
      for (const entry of scheduleEntries) {
        if (!entry.employeeId || !entry.date || !entry.startTime || !entry.endTime) continue;
        if (!validUserIds.has(entry.employeeId)) continue;
        if (!/^\d{4}-\d{2}-\d{2}$/.test(entry.date)) continue;
        if (!/^\d{2}:\d{2}$/.test(entry.startTime) || !/^\d{2}:\d{2}$/.test(entry.endTime)) continue;

        const startTime = new Date(`${entry.date}T${entry.startTime}:00`);
        const endTime = new Date(`${entry.date}T${entry.endTime}:00`);
        if (isNaN(startTime.getTime()) || isNaN(endTime.getTime())) continue;

        const schedule = await storage.createSchedule({
          userId: entry.employeeId,
          startTime,
          endTime,
          title: String(entry.shiftBlock || 'AI Generated Shift').slice(0, 100),
          description: String(entry.reasoning || 'Generated by AI scheduling').slice(0, 500),
          createdBy: userId,
        });
        created.push(schedule);
      }

      res.json({
        success: true,
        schedulesCreated: created.length,
      });
    } catch (error) {
      console.error("Error applying AI schedule:", error);
      res.status(500).json({ message: "Failed to apply schedule" });
    }
  });
}
