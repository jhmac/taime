import type { Express } from "express";
import type { IStorage } from "../storage";
import { aiSchedulingSettings, shopifyDailySales, shopifyOrders, users, userAvailability, availabilityTemplates, schedules, shops, userShops, roles, workPatternTemplates, userWorkPatterns, clockEvents } from "@shared/schema";
import { eq, and, gte, lte, desc, inArray, sql, count } from "drizzle-orm";
import { db } from "../db";
import Anthropic from '@anthropic-ai/sdk';
import rateLimit from "express-rate-limit";
import { ShopifyService } from "../services/shopifyService";
import { decryptToken } from "../utils/tokenEncryption";

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

// ── Shopify helpers (shared across suggest + backfill-day) ────────────────────

async function getShopCredentialsForUser(userId: string): Promise<{ shopDomain: string; accessToken: string; service: ShopifyService } | null> {
  const links = await db.select({ shopDomain: userShops.shopDomain })
    .from(userShops).where(eq(userShops.userId, userId)).limit(1);
  const shopDomain = links[0]?.shopDomain;
  if (!shopDomain) return null;

  const shopRows = await db.select({ shopDomain: shops.shopDomain, accessToken: shops.accessToken })
    .from(shops).where(eq(shops.shopDomain, shopDomain)).limit(1);
  if (!shopRows[0]?.accessToken) return null;

  let token = shopRows[0].accessToken;
  try { token = decryptToken(token); } catch { /* not encrypted */ }

  return { shopDomain: shopRows[0].shopDomain, accessToken: token, service: new ShopifyService(shopRows[0].shopDomain, token) };
}

/**
 * Fetches orders from Shopify GraphQL for a specific calendar date,
 * upserts each order into shopify_orders (preserving per-hour timestamps),
 * and upserts the daily aggregate into shopify_daily_sales.
 * Returns { ordersFound, dayRevenue }.
 */
async function backfillDayOrdersFromShopify(
  shopDomain: string,
  service: ShopifyService,
  dateStr: string,
): Promise<{ ordersFound: number; dayRevenue: number }> {
  const startIso = `${dateStr}T00:00:00Z`;
  const endIso   = `${dateStr}T23:59:59Z`;

  const orders = await service.getOrders({
    first: 250,
    createdAtMin: startIso,
    createdAtMax: endIso,
    maxPages: 5,
  });

  if (orders.length === 0) return { ordersFound: 0, dayRevenue: 0 };

  let dayRevenue = 0;
  let itemCount  = 0;

  for (const order of orders) {
    const rawId = order.id ?? '';
    // Shopify uses "gid://shopify/Order/1234567890" — extract the numeric part as orderId
    const orderId = rawId.includes('/') ? rawId.split('/').pop()! : rawId;
    const orderPrice = parseFloat(order.totalPriceSet?.shopMoney?.amount ?? '0');
    dayRevenue += orderPrice;
    const lineItems = order.lineItems?.nodes ?? [];
    for (const li of lineItems) itemCount += li.quantity || 1;
    const orderCreatedAt = order.createdAt ? new Date(order.createdAt) : new Date(startIso);

    const existing = await db.select({ id: shopifyOrders.id })
      .from(shopifyOrders)
      .where(and(eq(shopifyOrders.shopDomain, shopDomain), eq(shopifyOrders.orderId, orderId)))
      .limit(1);

    if (existing.length > 0) {
      await db.update(shopifyOrders)
        .set({
          totalPrice: String(Math.round(orderPrice * 100) / 100),
          financialStatus: (order as any).displayFinancialStatus ?? null,
          fulfillmentStatus: (order as any).displayFulfillmentStatus ?? null,
          lineItems: lineItems as any,
          orderCreatedAt,
          updatedAt: new Date(),
        })
        .where(eq(shopifyOrders.id, existing[0].id));
    } else {
      await db.insert(shopifyOrders).values({
        shopDomain,
        orderId,
        orderNumber: (order as any).name ?? null,
        totalPrice: String(Math.round(orderPrice * 100) / 100),
        currency: order.totalPriceSet?.shopMoney?.currencyCode ?? 'USD',
        financialStatus: (order as any).displayFinancialStatus ?? null,
        fulfillmentStatus: (order as any).displayFulfillmentStatus ?? null,
        lineItems: lineItems as any,
        customerData: null,
        orderCreatedAt,
      });
    }
  }

  // Upsert daily aggregate
  const dateObj = new Date(`${dateStr}T00:00:00Z`);
  const dayOfWeek = dateObj.getUTCDay();
  const avgOrderValue = orders.length > 0 ? Math.round((dayRevenue / orders.length) * 100) / 100 : 0;

  const existingDay = await db.select({ id: shopifyDailySales.id })
    .from(shopifyDailySales)
    .where(and(eq(shopifyDailySales.shopDomain, shopDomain), eq(shopifyDailySales.date, dateObj)))
    .limit(1);

  if (existingDay.length > 0) {
    await db.update(shopifyDailySales).set({
      orderCount: orders.length,
      totalRevenue: String(Math.round(dayRevenue * 100) / 100),
      itemCount,
      averageOrderValue: String(avgOrderValue),
      dayOfWeek,
    }).where(eq(shopifyDailySales.id, existingDay[0].id));
  } else {
    await db.insert(shopifyDailySales).values({
      shopDomain,
      date: dateObj,
      dayOfWeek,
      orderCount: orders.length,
      totalRevenue: String(Math.round(dayRevenue * 100) / 100),
      itemCount,
      averageOrderValue: String(avgOrderValue),
    });
  }

  return { ordersFound: orders.length, dayRevenue: Math.round(dayRevenue * 100) / 100 };
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
      const userPermissions = await storage.getUserPermissions(userId);
      const isAdmin = userPermissions.some(p => p.name === 'admin.manage_all');
      if (!isAdmin) {
        return res.status(403).json({ message: "Admin access required" });
      }

      const { shiftBlocks, staffingTiers, minimumStaffing, storeHours, shiftOverlapMinutes, overlapBudgetLimit } = req.body;

      const existing = await db.select().from(aiSchedulingSettings).limit(1);

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
          .where(eq(aiSchedulingSettings.id, existing[0].id));

        if (shiftOverlapMinutes !== undefined || overlapBudgetLimit !== undefined) {
          const id = existing[0].id;
          const overlapVal = shiftOverlapMinutes !== undefined ? Number(shiftOverlapMinutes) : null;
          const budgetVal = overlapBudgetLimit !== undefined ? (overlapBudgetLimit !== null ? Number(overlapBudgetLimit) : null) : undefined;

          if (overlapVal !== null && budgetVal !== undefined) {
            await db.execute(sql`UPDATE ai_scheduling_settings SET shift_overlap_minutes = ${overlapVal}, overlap_budget_limit = ${budgetVal} WHERE id = ${id}`);
          } else if (overlapVal !== null) {
            await db.execute(sql`UPDATE ai_scheduling_settings SET shift_overlap_minutes = ${overlapVal} WHERE id = ${id}`);
          } else if (budgetVal !== undefined) {
            await db.execute(sql`UPDATE ai_scheduling_settings SET overlap_budget_limit = ${budgetVal} WHERE id = ${id}`);
          }
        }
      } else {
        await db.insert(aiSchedulingSettings).values({
          shiftBlocks: shiftBlocks || [],
          staffingTiers: staffingTiers || [],
          minimumStaffing: minimumStaffing ?? 2,
          storeHours: storeHours || [],
          updatedBy: userId,
        });
        if (shiftOverlapMinutes !== undefined || overlapBudgetLimit !== undefined) {
          const result = await db.select({ id: aiSchedulingSettings.id }).from(aiSchedulingSettings).limit(1);
          if (result.length > 0) {
            const id = result[0].id;
            const overlapVal = shiftOverlapMinutes !== undefined ? Number(shiftOverlapMinutes) : 60;
            const budgetVal = overlapBudgetLimit !== undefined ? (overlapBudgetLimit !== null ? Number(overlapBudgetLimit) : null) : null;
            await db.execute(sql`UPDATE ai_scheduling_settings SET shift_overlap_minutes = ${overlapVal}, overlap_budget_limit = ${budgetVal} WHERE id = ${id}`);
          }
        }
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
        storeHours: [],
      };

      const storeHoursArray = (settings.storeHours as any[]) || [];

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
          dayOfWeek: s.dayOfWeek ?? 0,
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

      const allWorkPatterns = await db.select().from(userWorkPatterns);
      const workPatternsByUser: Record<string, Record<number, string>> = {};
      for (const wp of allWorkPatterns) {
        if (!workPatternsByUser[wp.userId]) workPatternsByUser[wp.userId] = {};
        workPatternsByUser[wp.userId][(wp as any).dayOfWeek] = (wp as any).status;
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
      const performanceScores = await db
        .select({
          userId: clockEvents.userId,
          totalPoints: sql<number>`COALESCE(SUM(${clockEvents.pointValue}), 0)::int`,
        })
        .from(clockEvents)
        .where(gte(clockEvents.createdAt, scoreWindow))
        .groupBy(clockEvents.userId);
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
      const userPermissions = await storage.getUserPermissions(userId);
      const canApply = userPermissions.some(p =>
        p.name === 'admin.manage_all' || p.name === 'schedule.create'
      );
      if (!canApply) {
        return res.status(403).json({ message: "Schedule creation permission required" });
      }

      const { scheduleEntries } = req.body;
      if (!scheduleEntries || !Array.isArray(scheduleEntries) || scheduleEntries.length === 0) {
        return res.status(400).json({ message: "Schedule entries are required" });
      }

      // Scope employee authorization to the requester's store — prevents cross-tenant IDOR
      const { tryResolveStoreIdForUser } = await import('../lib/storeResolver');
      const { getAllStoreUserIds } = await import('../lib/permissionUtils');
      const applyStoreId = await tryResolveStoreIdForUser(userId);
      if (!applyStoreId) return res.status(403).json({ message: "No store associated with your account" });
      const authorizedUserIds = await getAllStoreUserIds(applyStoreId);
      const validUserIds = new Set(authorizedUserIds);

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
      }).from(users).where(eq(users.isActive, true));

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
      const userPermissions = await storage.getUserPermissions(userId);
      const isAdmin = userPermissions.some(p => p.name === 'admin.manage_all');
      if (!isAdmin) {
        return res.status(403).json({ message: "Admin access required" });
      }

      const { employeeId } = req.params;
      const { showInSchedule, targetWeeklyHours } = req.body;

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
        .where(eq(users.id, employeeId));

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
      const userPermissions = await storage.getUserPermissions(userId);
      const isAdmin = userPermissions.some((p: any) => p.name === 'admin.manage_all');
      if (!isAdmin) {
        return res.status(403).json({ message: "Admin access required" });
      }

      const allUsers = await db.select().from(users).where(eq(users.isActive, true));
      const allPatterns = await db.select().from(userWorkPatterns);
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
      const userPermissions = await storage.getUserPermissions(userId);
      const isAdmin = userPermissions.some((p: any) => p.name === 'admin.manage_all');
      if (!isAdmin) {
        return res.status(403).json({ message: "Admin access required" });
      }

      const { employeeId } = req.params;
      const { patterns, templateId } = req.body;

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

      await db.insert(userWorkPatterns).values(values as any);

      res.json({ success: true });
    } catch (error) {
      console.error("Error updating work patterns:", error);
      res.status(500).json({ message: "Failed to update work patterns" });
    }
  });

  app.post("/api/ai-scheduling/work-patterns/bulk-apply", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.id;
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

      await db.delete(userWorkPatterns).where(inArray(userWorkPatterns.userId, employeeIds));

      const values = employeeIds.flatMap((empId: string) =>
        patterns.map((p: any) => ({
          userId: empId,
          dayOfWeek: p.day,
          status: p.status,
          templateId: templateId || null,
        }))
      );

      await db.insert(userWorkPatterns).values(values as any);

      res.json({ success: true, updated: employeeIds.length });
    } catch (error) {
      console.error("Error bulk applying work patterns:", error);
      res.status(500).json({ message: "Failed to apply patterns" });
    }
  });

  // ── Today's Availability Ranking ─────────────────────────────────────────────
  app.get("/api/schedules/today-availability", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const userPermissions = await storage.getUserPermissions(userId);
      const isAdmin = userPermissions.some((p: any) =>
        p.name === 'admin.manage_all' || p.name === 'schedule.view_all' || p.name === 'schedule.create'
      );
      if (!isAdmin) return res.status(403).json({ message: "Manager access required" });

      const { tryResolveStoreIdForUser } = await import('../lib/storeResolver');
      const { getAllStoreUserIds } = await import('../lib/permissionUtils');

      const storeId = await tryResolveStoreIdForUser(userId);
      if (!storeId) return res.json({ members: [], coverage: [], storeHours: null });

      const storeUserIds = await getAllStoreUserIds(storeId);
      if (storeUserIds.length === 0) return res.json({ members: [], coverage: [], storeHours: null });

      // Date parameter (default: today)
      const dateParam = (req.query.date as string) || new Date().toISOString().split('T')[0];
      const dateObj = new Date(dateParam + 'T12:00:00Z');
      const dow = dateObj.getUTCDay();

      // Fetch settings for store hours
      const settingsResult = await db.select().from(aiSchedulingSettings).limit(1);
      const settings = settingsResult[0];
      const storeHoursArray = ((settings?.storeHours as any[]) || []);
      const todayHours = storeHoursArray.find((sh: any) => sh.day === dow);

      // Fetch users (active, showInSchedule)
      const allUsers = await db.select({
        id: users.id,
        firstName: users.firstName,
        lastName: users.lastName,
        email: users.email,
        profileImageUrl: users.profileImageUrl,
        targetWeeklyHours: users.targetWeeklyHours,
        hourlyRate: users.hourlyRate,
        roleId: users.roleId,
        showInSchedule: users.showInSchedule,
      }).from(users).where(and(eq(users.isActive, true), inArray(users.id, storeUserIds)));

      const showableUsers = allUsers.filter(u => u.showInSchedule !== false);

      // Fetch roles
      const allRoles = await db.select().from(roles);
      const roleMap = Object.fromEntries(allRoles.map(r => [r.id, r]));

      // Fetch availability: templates, overrides, time-off
      const [templates, overrides, allTimeOff] = await Promise.all([
        storage.getAvailabilityTemplatesForUsers(storeUserIds),
        storage.getAvailabilityOverridesForUsers(storeUserIds, dateParam, dateParam),
        storage.getTimeOffRequests(),
      ]);
      const templateByUser: Record<string, typeof templates[0]> = {};
      for (const t of templates) templateByUser[t.userId] = t;
      const overridesByUser: Record<string, typeof overrides[0]> = {};
      for (const o of overrides) overridesByUser[o.userId] = o;

      // Performance scores (last 90 days)
      const scoreWindow = new Date();
      scoreWindow.setDate(scoreWindow.getDate() - 90);
      const performanceRows = await db
        .select({
          userId: clockEvents.userId,
          totalPoints: sql<number>`COALESCE(SUM(${clockEvents.pointValue}), 0)::int`,
        })
        .from(clockEvents)
        .where(gte(clockEvents.createdAt, scoreWindow))
        .groupBy(clockEvents.userId);
      const scoreMap: Record<string, number> = {};
      for (const s of performanceRows) scoreMap[s.userId] = s.totalPoints;

      // Scheduled hours this pay week (Mon→Sun surrounding dateParam)
      const weekStart = new Date(dateObj);
      const weekDow = weekStart.getUTCDay();
      weekStart.setUTCDate(weekStart.getUTCDate() - (weekDow === 0 ? 6 : weekDow - 1));
      weekStart.setUTCHours(0, 0, 0, 0);
      const weekEnd = new Date(weekStart);
      weekEnd.setUTCDate(weekEnd.getUTCDate() + 6);
      weekEnd.setUTCHours(23, 59, 59, 999);

      const weekSchedules = await db.select({
        userId: schedules.userId,
        startTime: schedules.startTime,
        endTime: schedules.endTime,
      }).from(schedules).where(and(
        gte(schedules.startTime, weekStart),
        lte(schedules.endTime, weekEnd),
        inArray(schedules.userId, storeUserIds),
      ));

      const scheduledHoursMap: Record<string, number> = {};
      for (const s of weekSchedules) {
        const h = (new Date(s.endTime).getTime() - new Date(s.startTime).getTime()) / (1000 * 60 * 60);
        scheduledHoursMap[s.userId] = (scheduledHoursMap[s.userId] || 0) + h;
      }

      // Today's schedule (to compute per-hour scheduled coverage)
      const todayStart = new Date(dateParam + 'T00:00:00Z');
      const todayEnd = new Date(dateParam + 'T23:59:59Z');
      const todayScheduleRows = await db.select().from(schedules).where(and(
        gte(schedules.startTime, todayStart),
        lte(schedules.startTime, todayEnd),
        inArray(schedules.userId, storeUserIds),
      ));

      // Store open/close hours for coverage timeline
      const storeOpen = todayHours && !todayHours.isClosed ? todayHours.openTime : '09:00';
      const storeClose = todayHours && !todayHours.isClosed ? todayHours.closeTime : '21:00';
      const [openH] = storeOpen.split(':').map(Number);
      const [closeH] = storeClose.split(':').map(Number);
      const storeHourCount = Math.max(1, closeH - openH);

      const timeToMinutes = (t: string): number => {
        const [h, m] = t.split(':').map(Number);
        return h * 60 + (m || 0);
      };

      const storeOpenMins = timeToMinutes(storeOpen);
      const storeCloseMins = timeToMinutes(storeClose);

      // Build coverage per hour (0 = openH, 1 = openH+1, etc.)
      const coverageAvailable: number[] = new Array(storeHourCount).fill(0);
      const coverageScheduled: number[] = new Array(storeHourCount).fill(0);

      // Build member list with computed availability
      const members: any[] = [];

      for (const u of showableUsers) {
        const uid = u.id;

        // Compute availability
        const hasTimeOff = allTimeOff.some(r => {
          if (r.status === 'cancelled' || r.userId !== uid) return false;
          const s = new Date(r.startDate); const e = new Date(r.endDate);
          return dateObj >= s && dateObj <= e;
        });

        let isAvailable = false;
        let availStart: string | null = null;
        let availEnd: string | null = null;
        let source = 'default';

        if (hasTimeOff) {
          isAvailable = false;
          source = 'time_off';
        } else {
          const override = overridesByUser[uid];
          if (override) {
            isAvailable = !override.unavailable;
            availStart = override.startTime ?? null;
            availEnd = override.endTime ?? null;
            source = 'override';
          } else {
            const tmpl = templateByUser[uid];
            const rawSlots = (tmpl?.slots ?? {}) as Record<string, any>;
            const slot = rawSlots[dow.toString()];
            if (!slot) {
              isAvailable = true;
              source = 'default';
            } else if ('available' in slot) {
              isAvailable = !!slot.available;
              availStart = slot.available ? (slot.startTime ?? null) : null;
              availEnd = slot.available ? (slot.endTime ?? null) : null;
              source = 'template';
            } else {
              isAvailable = !!(slot.morning || slot.afternoon || slot.evening);
              source = 'template';
            }
          }
        }

        // If available and no explicit window, default to store hours
        if (isAvailable) {
          if (!availStart) availStart = storeOpen;
          if (!availEnd) availEnd = storeClose;
        }

        // Compute overlap with store hours
        let overlapHours = 0;
        let overlapPct = 0;
        if (isAvailable && availStart && availEnd) {
          const aStartMins = Math.max(timeToMinutes(availStart), storeOpenMins);
          const aEndMins = Math.min(timeToMinutes(availEnd), storeCloseMins);
          overlapHours = Math.max(0, (aEndMins - aStartMins) / 60);
          overlapPct = storeHourCount > 0 ? overlapHours / storeHourCount : 0;
        }

        // Performance score (normalize 0–100)
        const rawScore = scoreMap[uid] ?? 0;
        const maxScore = 500;
        const normalizedScore = Math.min(100, Math.round((rawScore / maxScore) * 100));

        // Scheduled hours this week
        const scheduledHours = scheduledHoursMap[uid] || 0;
        const targetHours = u.targetWeeklyHours ? parseFloat(u.targetWeeklyHours) : 40;
        const hoursRemaining = Math.max(0, targetHours - scheduledHours);
        const hoursRemainingFactor = targetHours > 0 ? hoursRemaining / targetHours : 1;

        // Composite score: overlap (40%) + perf (40%) + hoursRemaining (20%)
        const compositeScore = isAvailable
          ? Math.round((overlapPct * 0.4 + (normalizedScore / 100) * 0.4 + hoursRemainingFactor * 0.2) * 100)
          : 0;

        // Update per-hour coverage
        if (isAvailable && availStart && availEnd) {
          const aStartMins = timeToMinutes(availStart);
          const aEndMins = timeToMinutes(availEnd);
          for (let h = 0; h < storeHourCount; h++) {
            const hourStartMins = storeOpenMins + h * 60;
            const hourEndMins = hourStartMins + 60;
            if (aStartMins < hourEndMins && aEndMins > hourStartMins) {
              coverageAvailable[h]++;
            }
          }
        }

        // Check scheduled today
        const todayShifts = todayScheduleRows.filter(s => s.userId === uid);
        for (const shift of todayShifts) {
          const shiftStartMins = (new Date(shift.startTime).getUTCHours() * 60 + new Date(shift.startTime).getUTCMinutes());
          const shiftEndMins = (new Date(shift.endTime).getUTCHours() * 60 + new Date(shift.endTime).getUTCMinutes());
          for (let h = 0; h < storeHourCount; h++) {
            const hourStartMins = storeOpenMins + h * 60;
            const hourEndMins = hourStartMins + 60;
            if (shiftStartMins < hourEndMins && shiftEndMins > hourStartMins) {
              coverageScheduled[h]++;
            }
          }
        }

        const role = u.roleId ? roleMap[u.roleId] : null;

        members.push({
          userId: uid,
          name: `${u.firstName || ''} ${u.lastName || ''}`.trim() || u.email || 'Unknown',
          firstName: u.firstName,
          lastName: u.lastName,
          profileImageUrl: u.profileImageUrl,
          roleName: role?.displayName || role?.name || 'Employee',
          isAvailable,
          availableFrom: availStart,
          availableTo: availEnd,
          overlapHours: Math.round(overlapHours * 10) / 10,
          compositeScore,
          performanceScore: normalizedScore,
          scheduledHoursThisWeek: Math.round(scheduledHours * 10) / 10,
          targetWeeklyHours: u.targetWeeklyHours ? parseFloat(u.targetWeeklyHours) : null,
          source,
        });
      }

      // Sort: available first, then by composite score descending
      members.sort((a, b) => {
        if (a.isAvailable !== b.isAvailable) return b.isAvailable ? 1 : -1;
        return b.compositeScore - a.compositeScore;
      });

      // Build hourly coverage timeline
      const coverage = Array.from({ length: storeHourCount }, (_, i) => ({
        hour: openH + i,
        label: `${((openH + i) % 12) || 12}${(openH + i) < 12 ? 'am' : 'pm'}`,
        available: coverageAvailable[i],
        scheduled: coverageScheduled[i],
      }));

      // Team readiness: scheduled hours / available hours today
      const totalAvailableHours = members.filter(m => m.isAvailable).reduce((s, m) => s + m.overlapHours, 0);
      const totalScheduledHours = todayScheduleRows.reduce((s, r) => {
        return s + (new Date(r.endTime).getTime() - new Date(r.startTime).getTime()) / (1000 * 60 * 60);
      }, 0);
      const readinessPct = totalAvailableHours > 0
        ? Math.round((totalScheduledHours / totalAvailableHours) * 100)
        : 0;

      res.json({
        date: dateParam,
        storeHours: todayHours ? { open: storeOpen, close: storeClose, isClosed: !!todayHours.isClosed } : null,
        members,
        coverage,
        readinessPct,
      });
    } catch (error) {
      console.error("Error fetching today-availability:", error);
      res.status(500).json({ message: "Failed to fetch availability ranking" });
    }
  });

  // ── Historical Shopify Sales by Hour ────────────────────────────────────────
  app.get("/api/schedules/historical-sales", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const userPermissions = await storage.getUserPermissions(userId);
      const isAdmin = userPermissions.some((p: any) =>
        p.name === 'admin.manage_all' || p.name === 'schedule.view_all' || p.name === 'schedule.create'
      );
      if (!isAdmin) return res.status(403).json({ message: "Manager access required" });

      const dateParam = (req.query.date as string) || new Date().toISOString().split('T')[0];
      const targetDate = new Date(dateParam + 'T12:00:00Z');
      const targetDow = targetDate.getUTCDay();

      // Compute both candidate dates: exact calendar year-ago first, same-weekday fallback
      const oneYearAgo = new Date(targetDate);
      oneYearAgo.setUTCFullYear(oneYearAgo.getUTCFullYear() - 1);
      const exactHistoricalDateStr = oneYearAgo.toISOString().slice(0, 10);

      // Same-weekday fallback (shift forward to match target day of week)
      const sameWeekdayDate = new Date(oneYearAgo);
      const hisDow = sameWeekdayDate.getUTCDay();
      const weekdayDiff = (targetDow - hisDow + 7) % 7;
      sameWeekdayDate.setUTCDate(sameWeekdayDate.getUTCDate() + weekdayDiff);
      const sameWeekdayDateStr = sameWeekdayDate.toISOString().slice(0, 10);

      // historicalDateStr will be resolved below: exact first, weekday fallback only if no data
      let historicalDateStr = exactHistoricalDateStr;

      // Resolve Shopify credentials for this user (enables auto-backfill)
      const shopCreds = await getShopCredentialsForUser(userId);
      const shopDomain = shopCreds?.shopDomain ?? null;

      let hourlyRevenue: number[] = new Array(24).fill(0);
      let dataSource = 'synthetic';

      if (shopDomain) {
        const weights = [0,0,0,0,0,0,0.01,0.02,0.05,0.08,0.09,0.10,0.10,0.09,0.08,0.07,0.07,0.06,0.06,0.05,0.04,0.03,0.01,0];

        const tryFetchRevenue = async (dateStr: string): Promise<{ found: boolean; source: 'actual' | 'estimated' }> => {
          const start = new Date(dateStr + 'T00:00:00Z');
          const end = new Date(dateStr + 'T23:59:59Z');

          // Auto-backfill: pull from Shopify GraphQL if no per-order rows exist for this date
          const existingCount = await db.select({ cnt: count() })
            .from(shopifyOrders)
            .where(and(
              eq(shopifyOrders.shopDomain, shopDomain),
              gte(shopifyOrders.orderCreatedAt, start),
              lte(shopifyOrders.orderCreatedAt, end),
            ));
          if ((existingCount[0]?.cnt ?? 0) === 0 && shopCreds) {
            try {
              console.log(`[historical-sales] auto-backfill: fetching Shopify orders for ${dateStr}`);
              await backfillDayOrdersFromShopify(shopDomain, shopCreds.service, dateStr);
            } catch (backfillErr) {
              console.warn(`[historical-sales] auto-backfill failed (non-fatal): ${backfillErr}`);
            }
          }

          // Query orders (may have just been populated by backfill)
          const orders = await db.select({
            totalPrice: shopifyOrders.totalPrice,
            orderCreatedAt: shopifyOrders.orderCreatedAt,
          }).from(shopifyOrders).where(and(
            eq(shopifyOrders.shopDomain, shopDomain),
            gte(shopifyOrders.orderCreatedAt, start),
            lte(shopifyOrders.orderCreatedAt, end),
          ));
          if (orders.length > 0) {
            for (const order of orders) {
              if (!order.orderCreatedAt || !order.totalPrice) continue;
              const h = new Date(order.orderCreatedAt).getUTCHours();
              hourlyRevenue[h] += parseFloat(order.totalPrice);
            }
            return { found: true, source: 'actual' };
          }

          // Fall back to daily aggregate (estimated hour distribution)
          const dailySales = await db.select({ totalRevenue: shopifyDailySales.totalRevenue })
            .from(shopifyDailySales)
            .where(and(eq(shopifyDailySales.shopDomain, shopDomain), eq(shopifyDailySales.date, start)))
            .limit(1);
          const dailyTotal = dailySales[0]?.totalRevenue ? parseFloat(dailySales[0].totalRevenue) : 0;
          if (dailyTotal > 0) {
            for (let h = 0; h < 24; h++) hourlyRevenue[h] = Math.round(dailyTotal * weights[h] * 100) / 100;
            return { found: true, source: 'estimated' };
          }
          return { found: false, source: 'estimated' };
        };

        // 1. Try exact calendar date one year prior
        const exactResult = await tryFetchRevenue(exactHistoricalDateStr);
        if (exactResult.found) {
          historicalDateStr = exactHistoricalDateStr;
          dataSource = exactResult.source;
        } else {
          // 2. Fall back to nearest same weekday if exact date has no data
          hourlyRevenue = new Array(24).fill(0);
          const weekdayResult = await tryFetchRevenue(sameWeekdayDateStr);
          historicalDateStr = sameWeekdayDateStr;
          dataSource = weekdayResult.found ? weekdayResult.source : 'synthetic';
        }
      }

      // Get AI scheduling settings for staffing tiers
      const settingsResult = await db.select().from(aiSchedulingSettings).limit(1);
      const settings = settingsResult[0];
      const staffingTiers = ((settings?.staffingTiers as any[]) || [
        { minRevenue: 0, maxRevenue: 2000, employeeCount: 2 },
        { minRevenue: 2001, maxRevenue: 5000, employeeCount: 3 },
        { minRevenue: 5001, maxRevenue: 10000, employeeCount: 5 },
      ]);
      const minimumStaffing = settings?.minimumStaffing || 2;

      const storeHoursArray = ((settings?.storeHours as any[]) || []);
      const todayHours = storeHoursArray.find((sh: any) => sh.day === targetDow);
      const storeOpen = todayHours && !todayHours.isClosed ? todayHours.openTime : '09:00';
      const storeClose = todayHours && !todayHours.isClosed ? todayHours.closeTime : '21:00';
      const [openH] = storeOpen.split(':').map(Number);
      const [closeH] = storeClose.split(':').map(Number);

      // Total daily revenue for threshold calculation
      const dailyTotal = hourlyRevenue.reduce((s, v) => s + v, 0);
      const avgHourlyRevenue = dailyTotal / Math.max(1, closeH - openH);

      // Build hourly breakdown for store hours only
      const hourlyData: Array<{
        hour: number;
        label: string;
        revenue: number;
        isPeak: boolean;
        suggestedStaff: number;
      }> = [];

      for (let h = openH; h < closeH; h++) {
        const revenue = hourlyRevenue[h];
        const isPeak = revenue > avgHourlyRevenue * 1.3;
        const suggestedStaff = getStaffingForRevenue(revenue, staffingTiers, minimumStaffing);
        hourlyData.push({
          hour: h,
          label: `${(h % 12) || 12}${h < 12 ? 'am' : 'pm'}`,
          revenue: Math.round(revenue * 100) / 100,
          isPeak,
          suggestedStaff,
        });
      }

      res.json({
        date: dateParam,
        historicalDate: historicalDateStr,
        dataSource,
        dailyTotal: Math.round(dailyTotal * 100) / 100,
        hourlyData,
        storeHours: { open: storeOpen, close: storeClose },
      });
    } catch (error) {
      console.error("Error fetching historical sales:", error);
      res.status(500).json({ message: "Failed to fetch historical sales" });
    }
  });

  // ── Suggested Schedule Generation ──────────────────────────────────────────
  app.post("/api/schedules/suggest", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.id;
      logger.info("[suggest] request received", { userId, body: req.body });

      const userPermissions = await storage.getUserPermissions(userId);
      const isAdmin = userPermissions.some((p: any) =>
        p.name === 'admin.manage_all' || p.name === 'schedule.view_all' || p.name === 'schedule.create'
      );
      if (!isAdmin) {
        logger.warn("[suggest] 403 — missing permission", { userId });
        return res.status(403).json({ message: "Manager access required" });
      }

      const { date } = req.body;
      const dateParam = date || new Date().toISOString().split('T')[0];

      // ── Resolve store and get availability data directly from DB ─────────────
      const { tryResolveStoreIdForUser } = await import('../lib/storeResolver');
      const { getAllStoreUserIds } = await import('../lib/permissionUtils');

      const storeId = await tryResolveStoreIdForUser(userId);
      if (!storeId) {
        logger.warn("[suggest] 403 — no store for user", { userId });
        return res.status(403).json({ message: "No store associated with your account" });
      }
      const storeUserIds = await getAllStoreUserIds(storeId);
      logger.info("[suggest] store resolved", { storeId, userCount: storeUserIds.length, dateParam });
      if (storeUserIds.length === 0) return res.json({ date: dateParam, proposedShifts: [], historicalDate: '', dataSource: 'synthetic', hourlyData: [], storeHours: { open: '09:00', close: '21:00' } });

      // ── Mirror today-availability data gathering exactly ─────────────────────
      const dateObj = new Date(dateParam + 'T12:00:00Z');
      const dow = dateObj.getUTCDay(); // numeric 0=Sun…6=Sat (matches today-availability)
      const dayOfWeekMap: Record<number, string> = {0:'sunday',1:'monday',2:'tuesday',3:'wednesday',4:'thursday',5:'friday',6:'saturday'};
      const todayDow = dayOfWeekMap[dow]; // used for storeHours in salesData below

      // Fetch AI settings for store hours (NUMERIC dow matching, mirrors today-availability)
      const settingsResult2 = await db.select().from(aiSchedulingSettings).limit(1);
      const settings2 = settingsResult2[0];
      const storeHoursArray2 = ((settings2?.storeHours as any[]) || []);
      const todayHours2 = storeHoursArray2.find((sh: any) => sh.day === dow); // numeric match
      const storeOpen2 = todayHours2 && !todayHours2.isClosed ? todayHours2.openTime : '09:00';
      const storeClose2 = todayHours2 && !todayHours2.isClosed ? todayHours2.closeTime : '21:00';
      const [openH2] = storeOpen2.split(':').map(Number);
      const [closeH2] = storeClose2.split(':').map(Number);
      const storeHourCount2 = Math.max(1, closeH2 - openH2);

      const timeToMinutes2 = (t: string): number => { const [h, m] = t.split(':').map(Number); return h * 60 + (m || 0); };
      const storeOpenMins2 = timeToMinutes2(storeOpen2);
      const storeCloseMins2 = timeToMinutes2(storeClose2);

      // Get active users in store (same fields + showInSchedule filter as today-availability)
      const allStoreUsers = await db.select({
        id: users.id,
        firstName: users.firstName,
        lastName: users.lastName,
        profileImageUrl: users.profileImageUrl,
        targetWeeklyHours: users.targetWeeklyHours,
        showInSchedule: users.showInSchedule,
      }).from(users).where(and(eq(users.isActive, true), inArray(users.id, storeUserIds)));
      // Apply the same showInSchedule visibility filter as today-availability
      const storeUsers = allStoreUsers.filter(u => u.showInSchedule !== false);

      // Use same storage methods as today-availability for consistent availability resolution
      const [availTmplsRaw, availOverridesRaw, allTimeOff2] = await Promise.all([
        storage.getAvailabilityTemplatesForUsers(storeUserIds),
        storage.getAvailabilityOverridesForUsers(storeUserIds, dateParam, dateParam),
        storage.getTimeOffRequests(),
      ]);
      const templateByUser2: Record<string, typeof availTmplsRaw[0]> = {};
      for (const t of availTmplsRaw) templateByUser2[t.userId] = t;
      const overridesByUser2: Record<string, typeof availOverridesRaw[0]> = {};
      for (const o of availOverridesRaw) overridesByUser2[o.userId] = o;

      // Performance scores from clockEvents (last 90 days) — same as today-availability
      const scoreWindow2 = new Date();
      scoreWindow2.setDate(scoreWindow2.getDate() - 90);
      const perfRows2 = await db.select({
        userId: clockEvents.userId,
        totalPoints: sql<number>`COALESCE(SUM(${clockEvents.pointValue}), 0)::int`,
      }).from(clockEvents).where(gte(clockEvents.createdAt, scoreWindow2)).groupBy(clockEvents.userId);
      const scoreMap2: Record<string, number> = {};
      for (const s of perfRows2) scoreMap2[s.userId] = s.totalPoints;

      // Week scheduled hours (Mon→Sun surrounding dateParam) — same as today-availability
      const weekStart2 = new Date(dateObj);
      const weekDow2 = weekStart2.getUTCDay();
      weekStart2.setUTCDate(weekStart2.getUTCDate() - (weekDow2 === 0 ? 6 : weekDow2 - 1));
      weekStart2.setUTCHours(0, 0, 0, 0);
      const weekEnd2 = new Date(weekStart2);
      weekEnd2.setUTCDate(weekEnd2.getUTCDate() + 6);
      weekEnd2.setUTCHours(23, 59, 59, 999);
      const weekScheds2 = await db.select({
        userId: schedules.userId,
        startTime: schedules.startTime,
        endTime: schedules.endTime,
      }).from(schedules).where(and(
        gte(schedules.startTime, weekStart2),
        lte(schedules.endTime, weekEnd2),
        inArray(schedules.userId, storeUserIds),
      ));
      const scheduledHoursMap2: Record<string, number> = {};
      for (const s of weekScheds2) {
        const h = (new Date(s.endTime).getTime() - new Date(s.startTime).getTime()) / (1000 * 60 * 60);
        scheduledHoursMap2[s.userId] = (scheduledHoursMap2[s.userId] || 0) + h;
      }

      // Today's existing schedules (to exclude already-scheduled members)
      const todayStart2 = new Date(dateParam + 'T00:00:00Z');
      const todayEnd2 = new Date(dateParam + 'T23:59:59Z');
      const todayScheds2 = await db.select({
        userId: schedules.userId,
      }).from(schedules).where(and(
        inArray(schedules.userId, storeUserIds),
        gte(schedules.startTime, todayStart2),
        lte(schedules.startTime, todayEnd2),
      ));
      const alreadyScheduledSet = new Set(todayScheds2.map(s => s.userId));

      // Build ranked members list using exact same algorithm as today-availability
      const availableMembers: any[] = [];
      for (const u of storeUsers) {
        const uid = u.id;
        // Time-off check
        const hasTimeOff = allTimeOff2.some((r: any) => {
          if (r.status === 'cancelled' || r.userId !== uid) return false;
          const s = new Date(r.startDate); const e = new Date(r.endDate);
          return dateObj >= s && dateObj <= e;
        });

        let isAvailable = false;
        let availStart: string | null = null;
        let availEnd: string | null = null;

        if (hasTimeOff) {
          isAvailable = false;
        } else {
          const override = overridesByUser2[uid];
          if (override) {
            isAvailable = !override.unavailable;
            availStart = override.startTime ?? null;
            availEnd = override.endTime ?? null;
          } else {
            const tmpl = templateByUser2[uid];
            const rawSlots = (tmpl?.slots ?? {}) as Record<string, any>;
            const slot = rawSlots[dow.toString()];
            if (!slot) {
              isAvailable = true; // default available (matches today-availability)
            } else if ('available' in slot) {
              isAvailable = !!slot.available;
              availStart = slot.available ? (slot.startTime ?? null) : null;
              availEnd = slot.available ? (slot.endTime ?? null) : null;
            } else {
              isAvailable = !!(slot.morning || slot.afternoon || slot.evening);
            }
          }
        }

        // Default window to store hours when available but no explicit window
        if (isAvailable) {
          if (!availStart) availStart = storeOpen2;
          if (!availEnd) availEnd = storeClose2;
        }

        // Skip unavailable or already scheduled
        if (!isAvailable || alreadyScheduledSet.has(uid)) continue;

        // Overlap with store hours (same formula as today-availability)
        const aStartMins = Math.max(timeToMinutes2(availStart!), storeOpenMins2);
        const aEndMins = Math.min(timeToMinutes2(availEnd!), storeCloseMins2);
        const overlapHours = Math.max(0, (aEndMins - aStartMins) / 60);
        const overlapPct = storeHourCount2 > 0 ? overlapHours / storeHourCount2 : 0;

        // Performance score (normalize 0–100, same as today-availability)
        const rawScore = scoreMap2[uid] ?? 0;
        const normalizedScore = Math.min(100, Math.round((rawScore / 500) * 100));

        // Hours remaining factor (same as today-availability)
        const scheduledHours = scheduledHoursMap2[uid] || 0;
        const targetHours = u.targetWeeklyHours ? parseFloat(u.targetWeeklyHours) : 40;
        const hoursRemaining = Math.max(0, targetHours - scheduledHours);
        const hoursRemainingFactor = targetHours > 0 ? hoursRemaining / targetHours : 1;

        // Composite score: overlap (40%) + perf (40%) + hoursRemaining (20%)
        const compositeScore = Math.round((overlapPct * 0.4 + (normalizedScore / 100) * 0.4 + hoursRemainingFactor * 0.2) * 100);

        availableMembers.push({
          userId: uid,
          name: `${u.firstName || ''} ${u.lastName || ''}`.trim() || uid,
          firstName: u.firstName,
          lastName: u.lastName,
          profileImageUrl: u.profileImageUrl,
          availableFrom: availStart,
          availableTo: availEnd,
          overlapHours,
          compositeScore,
        });
      }
      availableMembers.sort((a, b) => b.compositeScore - a.compositeScore);

      // ── Get historical sales: backfill from Shopify GraphQL if needed ────────
      const oneYearAgo2 = new Date(dateObj);
      oneYearAgo2.setUTCFullYear(oneYearAgo2.getUTCFullYear() - 1);
      const exactHistoricalDateStr2 = oneYearAgo2.toISOString().slice(0, 10);

      // Same-weekday fallback
      const sameWeekdayDate2 = new Date(oneYearAgo2);
      const hisDow2 = sameWeekdayDate2.getUTCDay();
      const weekdayDiff2 = (dow - hisDow2 + 7) % 7;
      sameWeekdayDate2.setUTCDate(sameWeekdayDate2.getUTCDate() + weekdayDiff2);
      const sameWeekdayDateStr2 = sameWeekdayDate2.toISOString().slice(0, 10);

      let historicalDateStr2 = exactHistoricalDateStr2;

      // Resolve Shopify shop credentials for this user
      const shopCreds = await getShopCredentialsForUser(userId);
      const shopDomain2 = shopCreds?.shopDomain ?? null;

      let hourlyRevenue2: number[] = new Array(24).fill(0);
      let dataSource2 = 'synthetic';

      if (shopDomain2 && shopCreds) {
        const weights2 = [0,0,0,0,0,0,0.01,0.02,0.05,0.08,0.09,0.10,0.10,0.09,0.08,0.07,0.07,0.06,0.06,0.05,0.04,0.03,0.01,0];

        const tryFetchRevenue2 = async (dateStr: string): Promise<{ found: boolean; source: 'actual' | 'estimated' }> => {
          const start = new Date(dateStr + 'T00:00:00Z');
          const end = new Date(dateStr + 'T23:59:59Z');

          // ── Auto-backfill: if shopify_orders has no rows for this date, pull from Shopify GraphQL ──
          const existingOrderCount = await db.select({ cnt: count() })
            .from(shopifyOrders)
            .where(and(
              eq(shopifyOrders.shopDomain, shopDomain2),
              gte(shopifyOrders.orderCreatedAt, start),
              lte(shopifyOrders.orderCreatedAt, end),
            ));
          if ((existingOrderCount[0]?.cnt ?? 0) === 0) {
            try {
              logger.info("[suggest] auto-backfill: fetching Shopify orders for", { dateStr, shopDomain: shopDomain2 });
              await backfillDayOrdersFromShopify(shopDomain2, shopCreds.service, dateStr);
            } catch (backfillErr) {
              logger.warn("[suggest] auto-backfill failed (non-fatal)", { dateStr, error: String(backfillErr) });
            }
          }

          // Now query orders (may have just been populated)
          const ordersInner = await db.select({
            totalPrice: shopifyOrders.totalPrice,
            orderCreatedAt: shopifyOrders.orderCreatedAt,
          }).from(shopifyOrders).where(and(
            eq(shopifyOrders.shopDomain, shopDomain2),
            gte(shopifyOrders.orderCreatedAt, start),
            lte(shopifyOrders.orderCreatedAt, end),
          ));
          if (ordersInner.length > 0) {
            for (const o of ordersInner) {
              if (!o.orderCreatedAt || !o.totalPrice) continue;
              const h = new Date(o.orderCreatedAt).getUTCHours();
              hourlyRevenue2[h] += parseFloat(o.totalPrice);
            }
            return { found: true, source: 'actual' };
          }
          // Fall back to shopify_daily_sales aggregate (estimated distribution)
          const dailySalesRows2 = await db.select({ totalRevenue: shopifyDailySales.totalRevenue })
            .from(shopifyDailySales)
            .where(and(eq(shopifyDailySales.shopDomain, shopDomain2), eq(shopifyDailySales.date, start)))
            .limit(1);
          const dailyTotal2Inner = dailySalesRows2[0]?.totalRevenue ? parseFloat(dailySalesRows2[0].totalRevenue) : 0;
          if (dailyTotal2Inner > 0) {
            for (let h = 0; h < 24; h++) hourlyRevenue2[h] = Math.round(dailyTotal2Inner * weights2[h] * 100) / 100;
            return { found: true, source: 'estimated' as const };
          }
          return { found: false, source: 'estimated' as const };
        };

        // 1. Try exact calendar date one year prior
        const exactResult2 = await tryFetchRevenue2(exactHistoricalDateStr2);
        if (exactResult2.found) {
          historicalDateStr2 = exactHistoricalDateStr2;
          dataSource2 = exactResult2.source;
        } else {
          // 2. Fall back to nearest same weekday if exact date has no data
          hourlyRevenue2 = new Array(24).fill(0);
          const weekdayResult2 = await tryFetchRevenue2(sameWeekdayDateStr2);
          historicalDateStr2 = sameWeekdayDateStr2;
          dataSource2 = weekdayResult2.found ? weekdayResult2.source : 'synthetic';
        }
      }

      // Build hourly data using settings2 queried above (no duplicate round-trip)
      const staffingTiers2 = ((settings2?.staffingTiers as any[]) || [
        { minRevenue: 0, maxRevenue: 2000, employeeCount: 2 },
        { minRevenue: 2001, maxRevenue: 5000, employeeCount: 3 },
        { minRevenue: 5001, maxRevenue: 10000, employeeCount: 5 },
      ]);
      const minimumStaffing2 = settings2?.minimumStaffing || 2;

      // Peak computation mirrors /historical-sales exactly: avg-based threshold over store hours
      const dailyRevTotal2 = hourlyRevenue2.slice(openH2, closeH2).reduce((s, v) => s + v, 0);
      const avgHourlyRevenue2 = dailyRevTotal2 / Math.max(1, closeH2 - openH2);
      const hourlyData: any[] = [];
      for (let h = openH2; h < closeH2; h++) {
        const rev = hourlyRevenue2[h];
        const hLabel = `${(h % 12) || 12}${h < 12 ? 'am' : 'pm'}`;
        const isPeak = rev > avgHourlyRevenue2 * 1.3;
        const tier = staffingTiers2.find((t: any) => rev >= t.minRevenue && rev <= t.maxRevenue);
        const suggestedStaff = Math.max(minimumStaffing2, tier?.employeeCount || minimumStaffing2);
        hourlyData.push({ hour: h, label: hLabel, revenue: Math.round(rev * 100) / 100, isPeak, suggestedStaff });
      }

      const salesData = {
        historicalDate: historicalDateStr2,
        dataSource: dataSource2,
        storeHours: { open: storeOpen2, close: storeClose2 },
        hourlyData,
      };

      // Group hours into shift windows
      const shiftBlocks: any[] = ((settings2?.shiftBlocks as any[]) || [
        { name: 'Morning', startTime: '09:00', endTime: '14:00' },
        { name: 'Afternoon', startTime: '14:00', endTime: '21:00' },
      ]);

      const proposedShiftShape: Array<{
        employeeId: string;
        employeeName: string;
        profileImageUrl: string | null;
        startTime: string;
        endTime: string;
        shiftBlock: string;
        rationale: string;
        revenue: number;
      }> = [];

      // ── Claude AI schedule generation ─────────────────────────────────────────
      let claudeSucceeded = false;
      try {
        const dayLabel = dateObj.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
        const historicalDateLabel = historicalDateStr2
          ? new Date(historicalDateStr2 + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
          : 'N/A';

        const hourlyBreakdown = hourlyData.length > 0
          ? hourlyData.map((h: any) => `  ${h.label}: $${h.revenue} revenue${h.isPeak ? ' [PEAK]' : ''} → ${h.suggestedStaff} staff needed`).join('\n')
          : '  No historical sales data — use minimum staffing defaults.';

        const teamRoster = availableMembers.slice(0, 30).map((m: any) =>
          `  - ${m.name} (id:${m.userId}) | available ${m.availableFrom}–${m.availableTo} | score:${m.compositeScore}/100`
        ).join('\n');

        const shiftBlockSummary = shiftBlocks.map((b: any) => {
          const blockHrs = hourlyData.filter((h: any) => {
            const [bS] = b.startTime.split(':').map(Number);
            const [bE] = b.endTime.split(':').map(Number);
            return h.hour >= bS && h.hour < bE;
          });
          const blockRev = blockHrs.reduce((s: number, h: any) => s + h.revenue, 0);
          const maxStaff = blockHrs.length > 0 ? Math.max(...blockHrs.map((h: any) => h.suggestedStaff)) : minimumStaffing2;
          return `  ${b.name} (${b.startTime}–${b.endTime}): $${Math.round(blockRev)} revenue → ${maxStaff} staff recommended`;
        }).join('\n');

        const claudePrompt = `You are an expert retail staffing scheduler for Libby Story boutique. Generate a specific shift schedule for ${dayLabel}.

STORE HOURS: ${storeOpen2} – ${storeClose2}
DATA SOURCE: Sales from ${historicalDateLabel} (${dataSource2 === 'synthetic' ? 'no historical data — use minimum staffing' : dataSource2 === 'actual' ? 'real Shopify orders' : 'estimated from daily total'})

HOURLY SALES BREAKDOWN (from ${historicalDateLabel}):
${hourlyBreakdown}

SHIFT BLOCKS:
${shiftBlockSummary}

AVAILABLE TEAM MEMBERS (ranked by availability+performance+hours):
${teamRoster || '  No available employees found.'}

RULES:
1. Assign real employees from the roster above to each shift block
2. Match employees to blocks where they are available (check their available hours)
3. Prioritize higher-scored employees for peak revenue hours
4. Do not assign the same employee to two overlapping blocks
5. Each shift block needs the recommended number of staff (see SHIFT BLOCKS above)
6. If no historical data, use the minimum staffing of ${minimumStaffing2} per block

Respond ONLY with a valid JSON object (no markdown, no explanation) in this exact format:
{
  "proposedShifts": [
    {
      "employeeId": "<exact id from roster>",
      "employeeName": "<exact name from roster>",
      "startTime": "<HH:MM from shift block>",
      "endTime": "<HH:MM from shift block>",
      "shiftBlock": "<block name>",
      "rationale": "<1 sentence: why this person for this block, referencing revenue if available>"
    }
  ]
}`;

        const claudeResponse = await anthropic.messages.create({
          model: 'claude-opus-4-5',
          max_tokens: 1500,
          messages: [{ role: 'user', content: claudePrompt }],
        });

        const rawText = claudeResponse.content[0]?.type === 'text' ? claudeResponse.content[0].text : '';
        const jsonMatch = rawText.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]);
          const shifts: any[] = parsed.proposedShifts || [];
          if (shifts.length > 0) {
            for (const s of shifts) {
              const member = availableMembers.find((m: any) => m.userId === s.employeeId);
              if (!member) continue;
              // Find the matching shift block for revenue
              const block = shiftBlocks.find((b: any) => b.name === s.shiftBlock);
              const blockHrs = block ? hourlyData.filter((h: any) => {
                const [bS] = block.startTime.split(':').map(Number);
                const [bE] = block.endTime.split(':').map(Number);
                return h.hour >= bS && h.hour < bE;
              }) : [];
              const blockRevenue = blockHrs.reduce((sum: number, h: any) => sum + h.revenue, 0);
              proposedShiftShape.push({
                employeeId: member.userId,
                employeeName: member.name,
                profileImageUrl: member.profileImageUrl || null,
                startTime: s.startTime || block?.startTime || storeOpen2,
                endTime: s.endTime || block?.endTime || storeClose2,
                shiftBlock: s.shiftBlock || 'Shift',
                rationale: s.rationale || `Assigned by AI`,
                revenue: Math.round(blockRevenue * 100) / 100,
              });
            }
            claudeSucceeded = proposedShiftShape.length > 0;
            logger.info("[suggest] Claude generated shifts", { count: proposedShiftShape.length, dateParam });
          }
        }
      } catch (claudeErr) {
        logger.warn("[suggest] Claude call failed, falling back to algorithm", { error: String(claudeErr) });
      }

      // ── Fallback: algorithmic shift assignment if Claude failed or returned nothing ──
      if (!claudeSucceeded) {
        logger.info("[suggest] using algorithmic fallback", { dateParam });
        const assignedMemberShifts: Record<string, string[]> = {};
        for (const block of shiftBlocks) {
          const [blockStartH] = block.startTime.split(':').map(Number);
          const [blockEndH] = block.endTime.split(':').map(Number);
          const blockHours = hourlyData.filter(h => h.hour >= blockStartH && h.hour < blockEndH);
          if (blockHours.length === 0) continue;
          const maxStaff = Math.max(...blockHours.map((h: any) => h.suggestedStaff));
          const blockRevenue = blockHours.reduce((s: number, h: any) => s + h.revenue, 0);
          const peakHours = blockHours.filter((h: any) => h.isPeak);
          const peakLabel = peakHours.length > 0
            ? `Peak ${peakHours[0].label}–${peakHours[peakHours.length - 1].label}`
            : block.name;
          const blockMembers = availableMembers.filter(m => {
            if (!m.availableFrom || !m.availableTo) return true;
            const [mStartH] = m.availableFrom.split(':').map(Number);
            const [mEndH] = m.availableTo.split(':').map(Number);
            return mStartH <= blockStartH && mEndH >= blockEndH;
          });
          let assigned = 0;
          for (const member of blockMembers) {
            if (assigned >= maxStaff) break;
            const existing = assignedMemberShifts[member.userId] || [];
            if (existing.includes(block.name)) continue;
            assignedMemberShifts[member.userId] = [...existing, block.name];
            const rationaleRevenue = blockRevenue > 0
              ? `$${Math.round(blockRevenue).toLocaleString()} in ${block.name.toLowerCase()} window`
              : `${block.name} shift`;
            proposedShiftShape.push({
              employeeId: member.userId,
              employeeName: member.name,
              profileImageUrl: member.profileImageUrl || null,
              startTime: block.startTime,
              endTime: block.endTime,
              shiftBlock: block.name,
              rationale: `${peakLabel}: ${rationaleRevenue} → ${maxStaff} staff recommended`,
              revenue: Math.round(blockRevenue * 100) / 100,
            });
            assigned++;
          }
        }
      }

      const proposedShifts = proposedShiftShape;

      logger.info("[suggest] responding", {
        dateParam,
        proposedShifts: proposedShifts.length,
        dataSource: salesData.dataSource,
        availableMembers: availableMembers.length,
      });
      res.json({
        date: dateParam,
        proposedShifts,
        historicalDate: salesData.historicalDate,
        dataSource: salesData.dataSource,
        hourlyData,
        storeHours: salesData.storeHours,
      });
    } catch (error) {
      logger.error("[suggest] unhandled error", { error: String(error) });
      console.error("Error generating suggested schedule:", error);
      res.status(500).json({ message: "Failed to generate suggested schedule", detail: String(error) });
    }
  });
}
