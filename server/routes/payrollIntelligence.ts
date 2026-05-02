import type { Express } from "express";
import type { IStorage } from "../storage";
import { shopifyDailySales, timeEntries, users, aiSchedulingSettings, userShops } from "@shared/schema";
import { eq, and, gte } from "drizzle-orm";
import { db } from "../db";
import { resolveAnyPermission } from "../services/permissionResolver";
import { tryResolveStoreIdForUser } from "../services/storeResolver";

export function registerPayrollIntelligenceRoutes(
  app: Express,
  storage: IStorage,
  isAuthenticated: any,
) {
  // ── GET /api/payroll-intelligence/summary ─────────────────────────────────
  app.get("/api/payroll-intelligence/summary", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const isAdmin = await resolveAnyPermission(userId, ['admin.manage_all'], storage);
      if (!isAdmin) {
        return res.status(403).json({ message: "Owner or admin access required" });
      }

      const daysBack = Math.min(Math.max(parseInt(String(req.query.daysBack ?? '7')) || 7, 1), 90);

      // Get connected shop
      const shopLinks = await db.select({ shopDomain: userShops.shopDomain })
        .from(userShops)
        .where(eq(userShops.userId, userId))
        .limit(1);
      const shopDomain = shopLinks[0]?.shopDomain ?? null;
      const shopConnected = !!shopDomain;

      // Get saved payroll settings
      const storeId = await tryResolveStoreIdForUser(userId);
      let savedSettings = { payrollTargetPct: 30, storeType: 'fashion_boutique' };
      if (storeId) {
        const settingsRow = await db.select()
          .from(aiSchedulingSettings)
          .where(eq(aiSchedulingSettings.storeId, storeId))
          .limit(1);
        if (settingsRow[0]) {
          savedSettings = {
            payrollTargetPct: settingsRow[0].payrollTargetPct != null
              ? parseFloat(String(settingsRow[0].payrollTargetPct)) : 30,
            storeType: settingsRow[0].storeType ?? 'fashion_boutique',
          };
        }
      }

      if (!shopConnected) {
        return res.json({
          shopConnected: false,
          settings: savedSettings,
          grossSales: 0, totalHours: 0, totalLaborCost: 0,
          splh: 0, avgTicket: 0, laborPct: 0, orderCount: 0, daysBack,
          dailyBreakdown: [], employees: [],
        });
      }

      // Date window
      const now = new Date();
      const startDate = new Date(now.getTime() - daysBack * 24 * 60 * 60 * 1000);
      startDate.setHours(0, 0, 0, 0);

      // Sales data
      const salesRows = await db.select()
        .from(shopifyDailySales)
        .where(and(
          eq(shopifyDailySales.shopDomain, shopDomain!),
          gte(shopifyDailySales.date, startDate),
        ))
        .orderBy(shopifyDailySales.date);

      // Time entries joined with users — scoped to this store via users.locationId
      const entryRows = await db.select({
        userId: timeEntries.userId,
        clockInTime: timeEntries.clockInTime,
        clockOutTime: timeEntries.clockOutTime,
        breakMinutes: timeEntries.breakMinutes,
        firstName: users.firstName,
        lastName: users.lastName,
        hourlyRate: users.hourlyRate,
      })
        .from(timeEntries)
        .innerJoin(users, eq(timeEntries.userId, users.id))
        .where(and(
          gte(timeEntries.clockInTime, startDate),
          eq(users.isActive, true),
          storeId ? eq(users.locationId, storeId) : undefined,
        ));

      // Build revenue maps
      const revenueByDate = new Map<string, { revenue: number; orders: number; avgTicket: number }>();
      let grossSales = 0;
      let totalOrders = 0;

      for (const row of salesRows) {
        const dateKey = new Date(row.date).toISOString().split('T')[0];
        const rev = parseFloat(String(row.totalRevenue ?? '0'));
        const orders = row.orderCount ?? 0;
        const avg = parseFloat(String(row.averageOrderValue ?? '0'));
        revenueByDate.set(dateKey, { revenue: rev, orders, avgTicket: avg });
        grossSales += rev;
        totalOrders += orders;
      }

      // Build labor maps
      const laborByDate = new Map<string, number>();
      const hoursByDate = new Map<string, number>();
      const employeeMap = new Map<string, { name: string; totalHours: number; laborCost: number; wageRate: number }>();

      let totalHours = 0;
      let totalLaborCost = 0;

      for (const entry of entryRows) {
        if (!entry.clockOutTime) continue;
        const clockIn = new Date(entry.clockInTime);
        const clockOut = new Date(entry.clockOutTime);
        const hours = Math.max(0,
          (clockOut.getTime() - clockIn.getTime()) / 3600000 - (entry.breakMinutes ?? 0) / 60
        );
        const rate = parseFloat(String(entry.hourlyRate ?? '15'));
        const cost = hours * rate;
        const dateKey = clockIn.toISOString().split('T')[0];

        laborByDate.set(dateKey, (laborByDate.get(dateKey) ?? 0) + cost);
        hoursByDate.set(dateKey, (hoursByDate.get(dateKey) ?? 0) + hours);
        totalHours += hours;
        totalLaborCost += cost;

        const name = [entry.firstName, entry.lastName].filter(Boolean).join(' ') || 'Unknown';
        const prev = employeeMap.get(entry.userId) ?? { name, totalHours: 0, laborCost: 0, wageRate: rate };
        employeeMap.set(entry.userId, {
          name: prev.name,
          totalHours: prev.totalHours + hours,
          laborCost: prev.laborCost + cost,
          wageRate: rate,
        });
      }

      // Daily breakdown
      const allDates = new Set([
        ...Array.from(revenueByDate.keys()),
        ...Array.from(laborByDate.keys()),
      ]);

      const dailyBreakdown = Array.from(allDates).sort().map(date => {
        const s = revenueByDate.get(date) ?? { revenue: 0, orders: 0, avgTicket: 0 };
        const laborCost = Math.round((laborByDate.get(date) ?? 0) * 100) / 100;
        const hours = Math.round((hoursByDate.get(date) ?? 0) * 100) / 100;
        const revenue = Math.round(s.revenue * 100) / 100;
        const laborPct = revenue > 0 ? Math.round((laborCost / revenue) * 10000) / 100 : 0;
        const splh = hours > 0 ? Math.round((revenue / hours) * 100) / 100 : 0;
        return { date, revenue, laborCost, hours, laborPct, splh, orderCount: s.orders };
      });

      // Aggregate metrics
      const splh = totalHours > 0 ? Math.round((grossSales / totalHours) * 100) / 100 : 0;
      const avgTicket = totalOrders > 0 ? Math.round((grossSales / totalOrders) * 100) / 100 : 0;
      const laborPct = grossSales > 0 ? Math.round((totalLaborCost / grossSales) * 10000) / 100 : 0;

      // Employee breakdown
      const employees = Array.from(employeeMap.entries())
        .map(([uid, emp]) => ({
          userId: uid,
          name: emp.name,
          totalHours: Math.round(emp.totalHours * 100) / 100,
          laborCost: Math.round(emp.laborCost * 100) / 100,
          wageRate: emp.wageRate,
          splh: null,
          roi: null,
        }))
        .sort((a, b) => b.totalHours - a.totalHours);

      return res.json({
        shopConnected: true,
        settings: savedSettings,
        grossSales: Math.round(grossSales * 100) / 100,
        totalHours: Math.round(totalHours * 100) / 100,
        totalLaborCost: Math.round(totalLaborCost * 100) / 100,
        splh,
        avgTicket,
        laborPct,
        orderCount: totalOrders,
        daysBack,
        dailyBreakdown,
        employees,
      });
    } catch (err) {
      console.error("[PayrollIntelligence] summary error:", err);
      return res.status(500).json({ message: "Failed to compute payroll summary" });
    }
  });

  // ── PATCH /api/payroll-intelligence/settings ──────────────────────────────
  app.patch("/api/payroll-intelligence/settings", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const isAdmin = await resolveAnyPermission(userId, ['admin.manage_all'], storage);
      if (!isAdmin) {
        return res.status(403).json({ message: "Admin access required" });
      }

      const storeId = await tryResolveStoreIdForUser(userId);
      if (!storeId) {
        return res.status(400).json({ message: "No store associated with your account" });
      }

      // Validate and extract typed values — decimal columns expect string in Drizzle
      let newPayrollTargetPct: string | undefined;
      let newStoreType: string | undefined;

      if (req.body.payrollTargetPct !== undefined) {
        const pct = Number(req.body.payrollTargetPct);
        if (!Number.isFinite(pct) || pct < 0 || pct > 100) {
          return res.status(400).json({ message: "payrollTargetPct must be 0–100" });
        }
        newPayrollTargetPct = String(pct);
      }

      if (req.body.storeType !== undefined) {
        newStoreType = String(req.body.storeType);
      }

      if (newPayrollTargetPct === undefined && newStoreType === undefined) {
        return res.status(400).json({ message: "No valid fields to update" });
      }

      const existing = await db.select({ id: aiSchedulingSettings.id })
        .from(aiSchedulingSettings)
        .where(eq(aiSchedulingSettings.storeId, storeId))
        .limit(1);

      // Build typed partial — no `as any` casts needed
      const typedUpdate: {
        payrollTargetPct?: string;
        storeType?: string;
        updatedAt?: Date;
      } = { updatedAt: new Date() };
      if (newPayrollTargetPct !== undefined) typedUpdate.payrollTargetPct = newPayrollTargetPct;
      if (newStoreType !== undefined)         typedUpdate.storeType = newStoreType;

      if (existing.length > 0) {
        await db.update(aiSchedulingSettings)
          .set(typedUpdate)
          .where(eq(aiSchedulingSettings.storeId, storeId));
      } else {
        await db.insert(aiSchedulingSettings).values({
          storeId,
          ...(newPayrollTargetPct !== undefined ? { payrollTargetPct: newPayrollTargetPct } : {}),
          ...(newStoreType !== undefined ? { storeType: newStoreType } : {}),
        });
      }

      return res.json({ success: true });
    } catch (err) {
      console.error("[PayrollIntelligence] settings error:", err);
      return res.status(500).json({ message: "Failed to save settings" });
    }
  });
}
