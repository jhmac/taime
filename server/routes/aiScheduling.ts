import type { Express } from "express";
import type { IStorage } from "../storage";
import { aiSchedulingSettings, shopifyDailySales, users, userAvailability, schedules, shops, userShops, roles, workPatternTemplates, userWorkPatterns, clockEvents } from "@shared/schema";
import { eq, and, gte, lte, desc, inArray, sql } from "drizzle-orm";
import { db } from "../db";
import Anthropic from '@anthropic-ai/sdk';
import rateLimit from "express-rate-limit";

import { config } from "../lib/config";
import {
  applyShiftOverlap,
  calculateOverlapLaborCost,
  checkBudgetThreshold,
} from "../services/shiftOverlap";
import logger from "../lib/logger";

const anthropic = new Anthropic({ apiKey: config.anthropic.apiKey });

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
      const companyId = req.user?.companyId;
      if (!companyId) return res.status(403).json({ message: "Company context required" });
      const userPermissions = await storage.getUserPermissions(userId);
      const isAdmin = userPermissions.some(p => p.name === 'admin.manage_all');
      if (!isAdmin) {
        return res.status(403).json({ message: "Admin access required" });
      }

      const result = await db.select().from(aiSchedulingSettings).where(eq(aiSchedulingSettings.companyId, companyId)).limit(1);
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
          storeHours: [
            { day: 0, openTime: "09:00", closeTime: "21:00", isClosed: true },
            { day: 1, openTime: "09:00", closeTime: "21:00", isClosed: false },
            { day: 2, openTime: "09:00", closeTime: "21:00", isClosed: false },
            { day: 3, openTime: "09:00", closeTime: "21:00", isClosed: false },
            { day: 4, openTime: "09:00", closeTime: "21:00", isClosed: false },
            { day: 5, openTime: "09:00", closeTime: "21:00", isClosed: false },
            { day: 6, openTime: "09:00", closeTime: "21:00", isClosed: false },
          ],
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
      const companyId = req.user?.companyId;
      if (!companyId) return res.status(403).json({ message: "Company context required" });
      const userPermissions = await storage.getUserPermissions(userId);
      const isAdmin = userPermissions.some(p => p.name === 'admin.manage_all');
      if (!isAdmin) {
        return res.status(403).json({ message: "Admin access required" });
      }

      const { shiftBlocks, staffingTiers, minimumStaffing, storeHours, shiftOverlapMinutes, overlapBudgetLimit } = req.body;

      const existing = await db.select().from(aiSchedulingSettings).where(eq(aiSchedulingSettings.companyId, companyId)).limit(1);

      if (existing.length > 0) {
        await db.update(aiSchedulingSettings)
          .set({
            shiftBlocks: shiftBlocks || existing[0].shiftBlocks,
            staffingTiers: staffingTiers || existing[0].staffingTiers,
            minimumStaffing: minimumStaffing ?? existing[0].minimumStaffing,
            storeHours: storeHours !== undefined ? storeHours : existing[0].storeHours,
            updatedBy: userId,
            updatedAt: new Date(),
          })
          .where(and(eq(aiSchedulingSettings.id, existing[0].id), eq(aiSchedulingSettings.companyId, companyId)));

        if (shiftOverlapMinutes !== undefined || overlapBudgetLimit !== undefined) {
          const id = existing[0].id;
          const overlapVal = shiftOverlapMinutes !== undefined ? Number(shiftOverlapMinutes) : null;
          const budgetVal = overlapBudgetLimit !== undefined ? (overlapBudgetLimit !== null ? Number(overlapBudgetLimit) : null) : undefined;

          if (overlapVal !== null && budgetVal !== undefined) {
            await db.execute(sql`UPDATE ai_scheduling_settings SET shift_overlap_minutes = ${overlapVal}, overlap_budget_limit = ${budgetVal} WHERE id = ${id} AND company_id = ${companyId}`);
          } else if (overlapVal !== null) {
            await db.execute(sql`UPDATE ai_scheduling_settings SET shift_overlap_minutes = ${overlapVal} WHERE id = ${id} AND company_id = ${companyId}`);
          } else if (budgetVal !== undefined) {
            await db.execute(sql`UPDATE ai_scheduling_settings SET overlap_budget_limit = ${budgetVal} WHERE id = ${id} AND company_id = ${companyId}`);
          }
        }
      } else {
        await db.insert(aiSchedulingSettings).values({
          companyId,
          shiftBlocks: shiftBlocks || [],
          staffingTiers: staffingTiers || [],
          minimumStaffing: minimumStaffing ?? 2,
          storeHours: storeHours || [],
          updatedBy: userId,
        });
        if (shiftOverlapMinutes !== undefined || overlapBudgetLimit !== undefined) {
          const result = await db.select({ id: aiSchedulingSettings.id }).from(aiSchedulingSettings).where(eq(aiSchedulingSettings.companyId, companyId)).limit(1);
          if (result.length > 0) {
            const id = result[0].id;
            const overlapVal = shiftOverlapMinutes !== undefined ? Number(shiftOverlapMinutes) : 60;
            const budgetVal = overlapBudgetLimit !== undefined ? (overlapBudgetLimit !== null ? Number(overlapBudgetLimit) : null) : null;
            await db.execute(sql`UPDATE ai_scheduling_settings SET shift_overlap_minutes = ${overlapVal}, overlap_budget_limit = ${budgetVal} WHERE id = ${id} AND company_id = ${companyId}`);
          }
        }
      }

      const updated = await db.select().from(aiSchedulingSettings).where(eq(aiSchedulingSettings.companyId, companyId)).limit(1);
      res.json(updated[0]);
    } catch (error) {
      console.error("Error updating AI scheduling settings:", error);
      res.status(500).json({ message: "Failed to update settings" });
    }
  });

  app.post("/api/ai-scheduling/generate", isAuthenticated, aiRateLimiter, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const companyId = req.user?.companyId;
      if (!companyId) return res.status(403).json({ message: "Company context required" });
      const userPermissions = await storage.getUserPermissions(userId);
      const isAdmin = userPermissions.some(p => p.name === 'admin.manage_all');
      if (!isAdmin) {
        return res.status(403).json({ message: "Admin access required" });
      }

      const { startDate, endDate, shopDomain } = req.body;
      if (!startDate || !endDate) {
        return res.status(400).json({ message: "Start date and end date are required" });
      }

      const settingsResult = await db.select().from(aiSchedulingSettings).where(eq(aiSchedulingSettings.companyId, companyId)).limit(1);
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
        storeHours: [],
      };

      const storeHoursArray = (settings.storeHours as any[]) || [];

      const start = new Date(startDate);
      const end = new Date(endDate);

      let salesData: Array<{ date: Date; dayOfWeek: number; totalRevenue: string }> = [];
      let resolvedShopDomain = shopDomain;

      if (!resolvedShopDomain) {
        // Scope shop lookup to the current user via userShops to prevent cross-tenant data access
        const userShopResult = await db
          .select({ shopDomain: shops.shopDomain })
          .from(shops)
          .innerJoin(userShops, eq(userShops.shopDomain, shops.shopDomain))
          .where(and(eq(userShops.userId, userId), eq(shops.isActive, true)))
          .limit(1);
        if (userShopResult.length > 0) {
          resolvedShopDomain = userShopResult[0].shopDomain;
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

      const allUsers = await db.select().from(users).where(and(eq(users.isActive, true), eq(users.companyId, companyId)));

      const companyUserIds = allUsers.map(u => u.id);
      const availabilityResult = companyUserIds.length > 0
        ? await db.select()
            .from(userAvailability)
            .where(and(
              gte(userAvailability.date, start),
              lte(userAvailability.date, end),
              inArray(userAvailability.userId, companyUserIds)
            ))
        : [];

      const allWorkPatterns = companyUserIds.length > 0
        ? await db.select().from(userWorkPatterns).where(inArray(userWorkPatterns.userId, companyUserIds))
        : [];
      const workPatternsByUser: Record<string, Record<number, string>> = {};
      for (const wp of allWorkPatterns) {
        if (!workPatternsByUser[wp.userId]) workPatternsByUser[wp.userId] = {};
        workPatternsByUser[wp.userId][wp.dayOfWeek] = wp.status;
      }

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

      const scoreWindow = new Date();
      scoreWindow.setDate(scoreWindow.getDate() - 90);
      const performanceScores = companyUserIds.length > 0
        ? await db
            .select({
              userId: clockEvents.userId,
              totalPoints: sql<number>`COALESCE(SUM(${clockEvents.pointValue}), 0)::int`,
            })
            .from(clockEvents)
            .where(and(gte(clockEvents.createdAt, scoreWindow), inArray(clockEvents.userId, companyUserIds)))
            .groupBy(clockEvents.userId)
        : [];
      const scoreMap: Record<string, number> = {};
      for (const s of performanceScores) {
        scoreMap[s.userId] = s.totalPoints;
      }

      const employeeList = allUsers
        .filter(u => u.showInSchedule !== false)
        .map(u => {
          const userAvail: Record<string, any> = {};
          const userPatterns = workPatternsByUser[u.id] || {};

          for (const day of days) {
            const explicitAvail = availabilityByUserDate[u.id]?.[day.date];
            const workPattern = userPatterns[day.dayOfWeek];

            if (workPattern === 'hard_off') {
              userAvail[day.date] = 'HARD_OFF';
            } else if (explicitAvail) {
              const unavailable = explicitAvail.some(a => a.isAvailable === false);
              userAvail[day.date] = unavailable ? 'unavailable' : (workPattern === 'required' ? 'REQUIRED' : 'available');
            } else if (workPattern === 'required') {
              userAvail[day.date] = 'REQUIRED';
            } else if (workPattern === 'preferred_off') {
              userAvail[day.date] = 'preferred_off';
            } else {
              userAvail[day.date] = 'available';
            }
          }
          return {
            id: u.id,
            name: `${u.firstName || ''} ${u.lastName || ''}`.trim() || u.email || 'Unknown',
            availability: userAvail,
            targetWeeklyHours: u.targetWeeklyHours ? parseFloat(u.targetWeeklyHours) : null,
            performanceScore: scoreMap[u.id] ?? 0,
          };
        });

      const shiftBlocks = (settings.shiftBlocks as any[]) || [];

      const storeHoursInfo = storeHoursArray.length === 7
        ? `\nSTORE HOURS:\n${storeHoursArray.map((sh: any) => {
            const dayName = dayNames[sh.day];
            return sh.isClosed ? `${dayName}: CLOSED` : `${dayName}: ${sh.openTime} - ${sh.closeTime}`;
          }).join('\n')}\n`
        : '';

      const closedDays = new Set<number>();
      for (const sh of storeHoursArray) {
        if (sh.isClosed) closedDays.add(sh.day);
      }

      const schedulableDays = days.filter(d => !closedDays.has(d.dayOfWeek));

      const prompt = `You are a workforce scheduling AI that ONLY outputs valid JSON. No markdown, no explanations, no text before or after the JSON object.

DATA:

SHIFT BLOCKS: ${JSON.stringify(shiftBlocks.map((b: any) => ({ name: b.name, start: b.startTime, end: b.endTime })))}
${storeHoursInfo}
SCHEDULE PERIOD:
${schedulableDays.map(d => `${d.date} (${d.dayName}): revenue=$${d.predictedRevenue}, need ${d.requiredStaff} staff${d.matchedLastYearDate ? ` (matched ${d.matchedLastYearDate})` : ''}`).join('\n')}
${closedDays.size > 0 ? `\nCLOSED DAYS (DO NOT schedule anyone): ${days.filter(d => closedDays.has(d.dayOfWeek)).map(d => `${d.date} (${d.dayName})`).join(', ')}\n` : ''}
MIN STAFFING: ${settings.minimumStaffing}

EMPLOYEES:
${employeeList.map(e => {
  const targetInfo = e.targetWeeklyHours ? ` [TARGET: ${e.targetWeeklyHours}hrs/wk]` : '';
  const scoreInfo = ` [SCORE: ${e.performanceScore}]`;
  return `${e.name} (${e.id})${targetInfo}${scoreInfo}: ${Object.entries(e.availability).map(([date, status]) => `${date}=${status}`).join(', ')}`;
}).join('\n')}

AVAILABILITY STATUS KEY:
- REQUIRED = employee MUST be scheduled this day (their recurring work pattern demands it)
- HARD_OFF = employee MUST NOT be scheduled this day (their recurring day off)
- preferred_off = employee prefers not to work but CAN be scheduled if needed
- available = employee can work
- unavailable = employee cannot work this specific date

PERFORMANCE SCORE: Points earned over the last 90 days from attendance, task completion, and workplace reliability. Higher scores indicate more dependable employees.

RULES:
1. Meet required staff count per day per shift block.
2. Distribute shifts fairly. Never schedule unavailable or HARD_OFF employees.
3. REQUIRED days: employees marked REQUIRED on a date MUST be scheduled that day.
4. Employees with TARGET hours are full-time and MUST be prioritized — give them enough shifts to meet their weekly target before assigning others.
5. Employees MAY work multiple shift blocks per day to meet targets.
6. NEVER schedule shifts outside store operating hours. All shift times must fall within store hours for that day.
7. NEVER schedule anyone on days the store is closed.
8. preferred_off employees should only be scheduled as a last resort to fill minimum staffing.
9. When multiple employees are equally available for the same shift, prefer employees with higher SCORE values. Higher scores mean better attendance, task completion, and reliability. Use scores as a tiebreaker after availability, REQUIRED status, and target hours priorities are satisfied.

OUTPUT INSTRUCTIONS: Return ONLY a single JSON object. Do NOT include any text, markdown formatting, or code fences. The response must start with { and end with }.

Required JSON structure:
{"schedule":[{"date":"YYYY-MM-DD","employeeId":"id","employeeName":"Name","shiftBlock":"block name","startTime":"HH:MM","endTime":"HH:MM","reasoning":"brief reason"}],"summary":"Brief summary","warnings":["any warnings"]}`;

      const aiResult = await anthropic.messages.create({
        model: "claude-sonnet-4-20250514",
        max_tokens: 8192,
        system: "You are a workforce scheduling AI. You MUST respond with valid JSON only. No markdown, no explanations, no code fences. Your entire response must be a single JSON object starting with { and ending with }.",
        messages: [{ role: 'user', content: prompt }],
      });
      const aiContent = aiResult.content[0];
      if (aiContent.type !== 'text') {
        throw new Error('Expected text response from Claude');
      }
      const aiResponse = aiContent.text;

      let parsedSchedule: any;
      try {
        let jsonStr = aiResponse.trim();

        const codeBlockMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
        if (codeBlockMatch) {
          jsonStr = codeBlockMatch[1].trim();
        }

        if (!jsonStr.startsWith('{')) {
          const firstBrace = jsonStr.indexOf('{');
          if (firstBrace !== -1) {
            jsonStr = jsonStr.slice(firstBrace);
          }
        }

        const lastBrace = jsonStr.lastIndexOf('}');
        if (lastBrace !== -1 && lastBrace < jsonStr.length - 1) {
          jsonStr = jsonStr.slice(0, lastBrace + 1);
        }

        parsedSchedule = JSON.parse(jsonStr);
      } catch (parseErr) {
        try {
          const deepMatch = aiResponse.match(/\{[\s\S]*"schedule"\s*:\s*\[[\s\S]*\][\s\S]*\}/);
          if (deepMatch) {
            parsedSchedule = JSON.parse(deepMatch[0]);
          } else {
            throw parseErr;
          }
        } catch {
          console.error('Failed to parse AI schedule response:', parseErr);
          console.error('Raw AI response (first 1000 chars):', aiResponse.slice(0, 1000));
          return res.status(500).json({
            message: "AI generated a response but it couldn't be parsed. Please try again.",
          });
        }
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

      const overlapMinutes = (settings as any).shiftOverlapMinutes ?? 60;
      const budgetLimit = (settings as any).overlapBudgetLimit ? parseFloat((settings as any).overlapBudgetLimit) : null;

      const { adjustedShifts, overlapBlocks } = applyShiftOverlap(validSchedule, overlapMinutes);

      const hourlyRates = new Map<string, number>();
      for (const emp of employeeList) {
        hourlyRates.set(emp.id, (emp as any).hourlyRate || 15);
      }
      const additionalLaborCost = calculateOverlapLaborCost(overlapBlocks, hourlyRates);
      const budgetWarning = checkBudgetThreshold(additionalLaborCost, budgetLimit);

      const warnings = Array.isArray(parsedSchedule.warnings)
        ? parsedSchedule.warnings.map((w: any) => String(w).slice(0, 300))
        : [];

      if (budgetWarning?.overBudget) {
        warnings.push(
          `Shift overlap adds $${additionalLaborCost.toFixed(2)} in labor costs, which exceeds your weekly budget limit of $${budgetWarning.weeklyBudgetLimit.toFixed(2)}.`
        );
      }

      logger.info(
        { overlapMinutes, overlapBlocks: overlapBlocks.length, additionalLaborCost },
        "Shift overlap applied to generated schedule"
      );

      res.json({
        success: true,
        days,
        generatedSchedule: validSchedule,
        adjustedSchedule: adjustedShifts,
        overlapBlocks,
        additionalLaborCost,
        budgetWarning,
        summary: typeof parsedSchedule.summary === 'string' ? parsedSchedule.summary.slice(0, 1000) : '',
        warnings,
        settings: {
          shiftBlocks,
          staffingTiers: settings.staffingTiers,
          minimumStaffing: settings.minimumStaffing,
          shiftOverlapMinutes: overlapMinutes,
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
      const companyId = req.user?.companyId;
      if (!companyId) return res.status(403).json({ message: "Company context required" });
      const userPermissions = await storage.getUserPermissions(userId);
      const isAdmin = userPermissions.some(p => p.name === 'admin.manage_all');
      if (!isAdmin) {
        return res.status(403).json({ message: "Admin access required" });
      }

      const { scheduleEntries } = req.body;
      if (!scheduleEntries || !Array.isArray(scheduleEntries) || scheduleEntries.length === 0) {
        return res.status(400).json({ message: "Schedule entries are required" });
      }

      const allUserIds = await db.select({ id: users.id }).from(users).where(and(eq(users.isActive, true), eq(users.companyId, companyId)));
      const validUserIds = new Set(allUserIds.map(u => u.id));

      const validEntries = scheduleEntries
        .filter((entry: any) => {
          if (!entry.employeeId || !entry.date || !entry.startTime || !entry.endTime) return false;
          if (!validUserIds.has(entry.employeeId)) return false;
          if (!/^\d{4}-\d{2}-\d{2}$/.test(entry.date)) return false;
          if (!/^\d{2}:\d{2}$/.test(entry.startTime) || !/^\d{2}:\d{2}$/.test(entry.endTime)) return false;
          const st = new Date(`${entry.date}T${entry.startTime}:00`);
          const et = new Date(`${entry.date}T${entry.endTime}:00`);
          return !isNaN(st.getTime()) && !isNaN(et.getTime());
        })
        .map((entry: any) => ({
          userId: entry.employeeId,
          startTime: new Date(`${entry.date}T${entry.startTime}:00`),
          endTime: new Date(`${entry.date}T${entry.endTime}:00`),
          title: String(entry.shiftBlock || 'AI Generated Shift').slice(0, 100),
          description: String(entry.reasoning || 'Generated by AI scheduling').slice(0, 500),
          createdBy: userId,
        }));

      const created = await storage.createSchedulesBatch(validEntries);

      res.json({
        success: true,
        schedulesCreated: created.length,
      });
    } catch (error) {
      console.error("Error applying AI schedule:", error);
      res.status(500).json({ message: "Failed to apply schedule" });
    }
  });

  app.get("/api/ai-scheduling/roster", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const companyId = req.user?.companyId;
      if (!companyId) return res.status(403).json({ message: "Company context required" });
      const userPermissions = await storage.getUserPermissions(userId);
      const isAdmin = userPermissions.some(p => p.name === 'admin.manage_all');
      if (!isAdmin) {
        return res.status(403).json({ message: "Admin access required" });
      }

      const allUsers = await db.select({
        id: users.id,
        firstName: users.firstName,
        lastName: users.lastName,
        email: users.email,
        employmentType: users.employmentType,
        showInSchedule: users.showInSchedule,
        targetWeeklyHours: users.targetWeeklyHours,
        roleId: users.roleId,
        isActive: users.isActive,
      }).from(users).where(and(eq(users.isActive, true), eq(users.companyId, companyId)));

      const allRoles = await db.select().from(roles);
      const roleMap = Object.fromEntries(allRoles.map(r => [r.id, r.name]));

      const roster = allUsers.map(u => ({
        id: u.id,
        name: `${u.firstName || ''} ${u.lastName || ''}`.trim() || u.email || 'Unknown',
        email: u.email,
        employmentType: u.employmentType,
        roleName: u.roleId ? roleMap[u.roleId] || 'Unknown' : 'No Role',
        showInSchedule: u.showInSchedule ?? true,
        targetWeeklyHours: u.targetWeeklyHours ? parseFloat(u.targetWeeklyHours) : null,
      }));

      res.json(roster);
    } catch (error) {
      console.error("Error fetching scheduling roster:", error);
      res.status(500).json({ message: "Failed to fetch roster" });
    }
  });

  app.put("/api/ai-scheduling/roster/:employeeId", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const companyId = req.user?.companyId;
      if (!companyId) return res.status(403).json({ message: "Company context required" });
      const userPermissions = await storage.getUserPermissions(userId);
      const isAdmin = userPermissions.some(p => p.name === 'admin.manage_all');
      if (!isAdmin) {
        return res.status(403).json({ message: "Admin access required" });
      }

      const { employeeId } = req.params;
      const { showInSchedule, targetWeeklyHours } = req.body;

      const targetUser = await db.select({ id: users.id }).from(users).where(and(eq(users.id, employeeId), eq(users.companyId, companyId))).limit(1);
      if (targetUser.length === 0) return res.status(403).json({ message: "Access denied: employee not in your company" });

      const updateData: any = {};
      if (typeof showInSchedule === 'boolean') {
        updateData.showInSchedule = showInSchedule;
      }
      if (targetWeeklyHours !== undefined) {
        if (targetWeeklyHours === null) {
          updateData.targetWeeklyHours = null;
        } else {
          const parsed = parseFloat(targetWeeklyHours);
          if (isNaN(parsed) || parsed < 0 || parsed > 80) {
            return res.status(400).json({ message: "Target weekly hours must be between 0 and 80" });
          }
          updateData.targetWeeklyHours = String(Math.round(parsed * 2) / 2);
        }
      }

      if (Object.keys(updateData).length === 0) {
        return res.status(400).json({ message: "No valid fields to update" });
      }

      await db.update(users)
        .set(updateData)
        .where(and(eq(users.id, employeeId), eq(users.companyId, companyId)));

      res.json({ success: true });
    } catch (error) {
      console.error("Error updating roster entry:", error);
      res.status(500).json({ message: "Failed to update employee scheduling settings" });
    }
  });

  app.get("/api/ai-scheduling/work-pattern-templates", isAuthenticated, async (req: any, res) => {
    try {
      const templates = await db.select().from(workPatternTemplates).orderBy(workPatternTemplates.name);
      res.json(templates);
    } catch (error) {
      console.error("Error fetching work pattern templates:", error);
      res.status(500).json({ message: "Failed to fetch templates" });
    }
  });

  app.get("/api/ai-scheduling/work-patterns", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const companyId = req.user?.companyId;
      if (!companyId) return res.status(403).json({ message: "Company context required" });
      const userPermissions = await storage.getUserPermissions(userId);
      const isAdmin = userPermissions.some((p: any) => p.name === 'admin.manage_all');
      if (!isAdmin) {
        return res.status(403).json({ message: "Admin access required" });
      }

      const allUsers = await db.select().from(users).where(and(eq(users.isActive, true), eq(users.companyId, companyId)));
      const companyUserIds = allUsers.map(u => u.id);
      const allPatterns = companyUserIds.length > 0
        ? await db.select().from(userWorkPatterns).where(inArray(userWorkPatterns.userId, companyUserIds))
        : [];
      const allRoles = await db.select().from(roles);
      const roleMap = Object.fromEntries(allRoles.map(r => [r.id, r.name]));

      const patternsByUser: Record<string, any[]> = {};
      for (const p of allPatterns) {
        if (!patternsByUser[p.userId]) patternsByUser[p.userId] = [];
        patternsByUser[p.userId].push(p);
      }

      const result = allUsers.map(u => ({
        id: u.id,
        name: `${u.firstName || ''} ${u.lastName || ''}`.trim() || u.email || 'Unknown',
        roleName: u.roleId ? roleMap[u.roleId] || 'Unknown' : 'No Role',
        patterns: patternsByUser[u.id] || [],
      }));

      res.json(result);
    } catch (error) {
      console.error("Error fetching work patterns:", error);
      res.status(500).json({ message: "Failed to fetch work patterns" });
    }
  });

  app.put("/api/ai-scheduling/work-patterns/:employeeId", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const companyId = req.user?.companyId;
      if (!companyId) return res.status(403).json({ message: "Company context required" });
      const userPermissions = await storage.getUserPermissions(userId);
      const isAdmin = userPermissions.some((p: any) => p.name === 'admin.manage_all');
      if (!isAdmin) {
        return res.status(403).json({ message: "Admin access required" });
      }

      const { employeeId } = req.params;
      const { patterns, templateId } = req.body;

      const targetUser = await db.select({ id: users.id }).from(users).where(and(eq(users.id, employeeId), eq(users.companyId, companyId))).limit(1);
      if (targetUser.length === 0) return res.status(403).json({ message: "Access denied: employee not in your company" });

      if (!patterns || !Array.isArray(patterns) || patterns.length !== 7) {
        return res.status(400).json({ message: "Must provide patterns for all 7 days" });
      }

      const validStatuses = ['required', 'available', 'preferred_off', 'hard_off'];
      for (const p of patterns) {
        if (typeof p.day !== 'number' || p.day < 0 || p.day > 6) {
          return res.status(400).json({ message: "Invalid day of week" });
        }
        if (!validStatuses.includes(p.status)) {
          return res.status(400).json({ message: `Invalid status: ${p.status}` });
        }
      }

      await db.delete(userWorkPatterns).where(eq(userWorkPatterns.userId, employeeId));

      const values = patterns.map((p: any) => ({
        userId: employeeId,
        dayOfWeek: p.day,
        status: p.status,
        templateId: templateId || null,
      }));

      await db.insert(userWorkPatterns).values(values);

      res.json({ success: true });
    } catch (error) {
      console.error("Error updating work patterns:", error);
      res.status(500).json({ message: "Failed to update work patterns" });
    }
  });

  app.post("/api/ai-scheduling/work-patterns/bulk-apply", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const companyId = req.user?.companyId;
      if (!companyId) return res.status(403).json({ message: "Company context required" });
      const userPermissions = await storage.getUserPermissions(userId);
      const isAdmin = userPermissions.some((p: any) => p.name === 'admin.manage_all');
      if (!isAdmin) {
        return res.status(403).json({ message: "Admin access required" });
      }

      const { employeeIds, patterns, templateId } = req.body;

      if (!employeeIds || !Array.isArray(employeeIds) || employeeIds.length === 0) {
        return res.status(400).json({ message: "Must provide at least one employee ID" });
      }
      if (!patterns || !Array.isArray(patterns) || patterns.length !== 7) {
        return res.status(400).json({ message: "Must provide patterns for all 7 days" });
      }

      const companyUsers = await db.select({ id: users.id }).from(users).where(and(eq(users.companyId, companyId), inArray(users.id, employeeIds)));
      const validEmployeeIds = companyUsers.map(u => u.id);
      if (validEmployeeIds.length === 0) return res.status(403).json({ message: "Access denied: no valid employees in your company" });

      await db.delete(userWorkPatterns).where(inArray(userWorkPatterns.userId, validEmployeeIds));

      const values = validEmployeeIds.flatMap((empId: string) =>
        patterns.map((p: any) => ({
          userId: empId,
          dayOfWeek: p.day,
          status: p.status,
          templateId: templateId || null,
        }))
      );

      await db.insert(userWorkPatterns).values(values);

      res.json({ success: true, updated: validEmployeeIds.length });
    } catch (error) {
      console.error("Error bulk applying work patterns:", error);
      res.status(500).json({ message: "Failed to apply patterns" });
    }
  });
}
