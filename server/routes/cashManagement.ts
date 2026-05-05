import type { Express } from "express";
import { db } from "../db";
import { eq, and, desc, gte, sql } from "drizzle-orm";
import { z } from "zod";
import {
  drawerSessions, cashDeposits, cashDiscrepancyLog, cashManagementSettings,
  shopifyRegisterSessions, shops, users,
  insertDrawerSessionSchema, insertCashDepositSchema,
} from "@shared/schema";
import type { IStorage } from "../storage";
import { resolveStoreId } from "../services/storeResolver";
import {
  calculateDenominations, captureEmployeesOnDuty, analyzeDepositSlip,
  validateDepositSlipImage,
  getDailyCashReport, suggestRecountFocus, logDiscrepancy,
  analyzeCashPatterns, getEmployeeCashProfile,
} from "../services/cashManagement";
import { aiInsights } from "@shared/schema";
import { timeEntries } from "@shared/schema";
import { isNull } from "drizzle-orm";
import logger from "../lib/logger";
import { ShopifyService } from "../services/shopifyService";
import { decryptToken } from "../utils/tokenEncryption";
import { workLocations as workLocationsTable } from "@shared/schema";

function parseClosingTime(raw: string | null | undefined): Record<string, string | null> | null {
  if (!raw) return null;
  if (typeof raw === "object") return raw as Record<string, string | null>;
  try { return JSON.parse(raw as string) as Record<string, string | null>; } catch { return null; }
}

async function requireManagerOrAbove(storage: IStorage, userId: string): Promise<boolean> {
  const user = await storage.getUserWithRole(userId);
  if (!user) throw new Error("User not found");
  const role = user.role?.name;
  return role === "admin" || role === "owner" || role === "manager";
}

async function requireOwnerOrAdmin(storage: IStorage, userId: string): Promise<boolean> {
  const user = await storage.getUserWithRole(userId);
  if (!user) throw new Error("User not found");
  const role = user.role?.name;
  return role === "admin" || role === "owner";
}

async function getStoreId(): Promise<string> {
  const storeId = await resolveStoreId();
  if (!storeId) throw new Error("Store not configured");
  return storeId;
}

async function verifySessionAccess(sessionId: string, storeId: string) {
  const [session] = await db.select().from(drawerSessions)
    .where(and(eq(drawerSessions.id, sessionId), eq(drawerSessions.storeId, storeId)));
  return session || null;
}

async function verifyDepositAccess(depositId: string, storeId: string) {
  const [deposit] = await db.select().from(cashDeposits)
    .where(and(eq(cashDeposits.id, depositId), eq(cashDeposits.storeId, storeId)));
  return deposit || null;
}

async function checkClockedIn(userId: string): Promise<{ clockedIn: boolean; atStore: boolean; activeEntry: any | null }> {
  const [entry] = await db.select().from(timeEntries)
    .where(and(eq(timeEntries.userId, userId), isNull(timeEntries.clockOutTime)))
    .orderBy(desc(timeEntries.clockInTime))
    .limit(1);
  if (!entry) return { clockedIn: false, atStore: false, activeEntry: null };
  const storeId = await resolveStoreId();
  // If no location was recorded on clock-in (web clock-in), treat as at-store
  const atStore = !storeId || !entry.locationId || entry.locationId === storeId;
  return { clockedIn: true, atStore, activeEntry: entry };
}

export function registerCashManagementRoutes(app: Express, storage: IStorage, isAuthenticated: any) {

  app.get("/api/cash/access-check", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user?.id || req.auth?.userId;
      const { clockedIn, atStore, activeEntry } = await checkClockedIn(userId);
      const user = await storage.getUserWithRole(userId);
      const isManagerOrAbove = user?.role?.name === "admin" || user?.role?.name === "owner" || user?.role?.name === "manager";
      res.json({
        allowed: clockedIn || isManagerOrAbove,
        clockedIn,
        atStore,
        isManagerOrAbove,
        activeEntry: activeEntry ? {
          id: activeEntry.id,
          locationId: activeEntry.locationId,
          clockInTime: activeEntry.clockInTime,
        } : null,
      });
    } catch (err: any) {
      logger.error({ error: err.message }, "[Cash] Access check failed");
      res.status(500).json({ error: "Access check failed" });
    }
  });

  async function requireCashAccess(req: any, res: any): Promise<boolean> {
    const userId = req.user?.id || req.auth?.userId;
    const { clockedIn } = await checkClockedIn(userId);
    if (clockedIn) return true;
    const user = await storage.getUserWithRole(userId);
    const role = user?.role?.name;
    if (role === "admin" || role === "owner" || role === "manager") return true;
    res.status(403).json({ error: "You must be clocked in to access Cash Management" });
    return false;
  }

  // ===== Settings =====
  app.get("/api/cash/settings", isAuthenticated, async (req: any, res) => {
    try {
      if (!(await requireCashAccess(req, res))) return;
      const storeId = await getStoreId();
      const [existing] = await db.select().from(cashManagementSettings)
        .where(eq(cashManagementSettings.storeId, storeId));

      if (existing) return res.json({ ...existing, closingTime: parseClosingTime(existing.closingTime) });

      const [created] = await db.insert(cashManagementSettings).values({
        storeId,
        registers: [{ name: "Register 1", id: "register-1" }],
      }).returning();

      res.json({ ...created, closingTime: parseClosingTime(created.closingTime) });
    } catch (err: any) {
      logger.error({ error: err.message }, "[Cash] Failed to get settings");
      res.status(500).json({ error: "Failed to load settings" });
    }
  });

  app.put("/api/cash/settings", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user?.id || req.auth?.userId;
      const isOwnerOrAdmin = await requireOwnerOrAdmin(storage, userId);
      if (!isOwnerOrAdmin) {
        return res.status(403).json({ error: "Only admins and owners can update Cash Management settings" });
      }
      const storeId = await getStoreId();
      const { defaultStartingCash, registers, overShortThreshold, requireDepositPhoto, requireOverShortExplanation, autoFlagThreshold, closingTime, referenceDepositSlip, depositTolerance } = req.body;

      const DAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"] as const;
      const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

      if (closingTime !== undefined && closingTime !== null) {
        if (typeof closingTime !== "object" || Array.isArray(closingTime)) {
          return res.status(400).json({ error: "closingTime must be an object keyed by day name" });
        }
        for (const key of Object.keys(closingTime)) {
          if (!(DAYS as readonly string[]).includes(key)) {
            return res.status(400).json({ error: `Invalid day key: ${key}` });
          }
          const val = (closingTime as Record<string, unknown>)[key];
          if (val !== null && val !== "" && (typeof val !== "string" || !TIME_RE.test(val))) {
            return res.status(400).json({ error: `closingTime.${key} must be HH:MM or null/empty` });
          }
        }
      }

      const normalizedClosingTime = closingTime && typeof closingTime === "object" && !Array.isArray(closingTime)
        ? Object.fromEntries(Object.entries(closingTime as Record<string, string | null>).map(([k, v]) => [k, v || null]))
        : null;
      const closingTimeJson = normalizedClosingTime ? JSON.stringify(normalizedClosingTime) : null;

      const [existing] = await db.select().from(cashManagementSettings)
        .where(eq(cashManagementSettings.storeId, storeId));

      if (existing) {
        const updateData: any = {
          defaultStartingCash: defaultStartingCash?.toString(),
          registers, overShortThreshold: overShortThreshold?.toString(),
          requireDepositPhoto, requireOverShortExplanation,
          autoFlagThreshold: autoFlagThreshold?.toString(),
          closingTime: closingTimeJson,
          updatedAt: new Date(),
        };
        if (depositTolerance !== undefined) updateData.depositTolerance = depositTolerance?.toString();
        if (referenceDepositSlip !== undefined) updateData.referenceDepositSlip = referenceDepositSlip;

        const [updated] = await db.update(cashManagementSettings)
          .set(updateData)
          .where(eq(cashManagementSettings.storeId, storeId))
          .returning();
        return res.json({ ...updated, closingTime: normalizedClosingTime });
      }

      const [created] = await db.insert(cashManagementSettings).values({
        storeId,
        defaultStartingCash: defaultStartingCash?.toString() || "200.00",
        registers: registers || [{ name: "Register 1", id: "register-1" }],
        overShortThreshold: overShortThreshold?.toString() || "5.00",
        requireDepositPhoto, requireOverShortExplanation,
        autoFlagThreshold: autoFlagThreshold?.toString() || "20.00",
        closingTime: closingTimeJson,
        referenceDepositSlip: referenceDepositSlip || null,
        depositTolerance: depositTolerance?.toString() || "1.00",
      }).returning();

      res.json({ ...created, closingTime: normalizedClosingTime });
    } catch (err: any) {
      logger.error({ error: err.message }, "[Cash] Failed to update settings");
      res.status(500).json({ error: "Failed to update settings" });
    }
  });

  // ===== Drawer Sessions =====
  app.post("/api/cash/sessions", isAuthenticated, async (req: any, res) => {
    try {
      const storeId = await getStoreId();
      const userId = req.user?.id || req.auth?.userId;
      const { clockedIn, atStore } = await checkClockedIn(userId);
      if (!clockedIn || !atStore) {
        return res.status(403).json({ error: "You must be clocked in at the store to start a cash count" });
      }
      const { sessionType, registerName, registerId, startingCash } = req.body;

      if (!sessionType || !registerName) {
        return res.status(400).json({ error: "sessionType and registerName are required" });
      }

      if (sessionType === "closing") {
        const [storeSettings] = await db.select().from(cashManagementSettings)
          .where(eq(cashManagementSettings.storeId, storeId));
        const parsedClosingTime = parseClosingTime(storeSettings?.closingTime);
        if (parsedClosingTime) {
          const DAY_NAMES = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"] as const;
          const now = new Date();
          const todayKey = DAY_NAMES[now.getDay()];
          const perDay = parsedClosingTime;
          const todayClosingTime = perDay[todayKey];
          if (todayClosingTime && /^([01]\d|2[0-3]):[0-5]\d$/.test(todayClosingTime)) {
            const [closingHour, closingMinute] = todayClosingTime.split(":").map(Number);
            const closingMinutes = closingHour * 60 + closingMinute;
            const nowMinutes = now.getHours() * 60 + now.getMinutes();
            if (nowMinutes < closingMinutes) {
              const formatted = new Date(0, 0, 0, closingHour, closingMinute).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true });
              return res.status(403).json({ error: `Closing count is not available until ${formatted}`, closingTime: todayClosingTime });
            }
          }
        }
      }

      const today = new Date().toISOString().split("T")[0];
      const employeesOnDuty = await captureEmployeesOnDuty(storeId, today);

      const [session] = await db.insert(drawerSessions).values({
        storeId,
        sessionDate: today,
        sessionType,
        registerName,
        registerId: registerId || null,
        status: "pending",
        countedBy: userId,
        startingCash: startingCash?.toString() || "200.00",
        employeesOnDuty,
      }).returning();

      // Auto-populate Shopify figures if a snapshot already exists for this register/date
      if (sessionType === "closing") {
        try {
          const [snap] = await db.select({
            cashSales: shopifyRegisterSessions.cashSales,
            totalSales: shopifyRegisterSessions.totalSales,
            tenderBreakdown: shopifyRegisterSessions.tenderBreakdown,
          })
            .from(shopifyRegisterSessions)
            .where(and(
              eq(shopifyRegisterSessions.storeId, storeId),
              eq(shopifyRegisterSessions.sessionDate, today),
              eq(shopifyRegisterSessions.registerName, registerName),
            ))
            .limit(1);

          if (snap != null) {
            const breakdown = snap.tenderBreakdown as any[] | null;
            const nonCash = Array.isArray(breakdown)
              ? breakdown
                  .filter((t: any) => t.tenderType && t.tenderType.toLowerCase() !== "cash")
                  .reduce((sum: number, t: any) => sum + parseFloat(t.amount?.shopMoney?.amount || "0"), 0)
              : 0;
            const cashSalesVal = parseFloat(snap.cashSales ?? "0");
            const startingCashVal = parseFloat(startingCash?.toString() || "200");
            const expectedCash = startingCashVal + cashSalesVal;
            await db.update(drawerSessions).set({
              registerCashSales: snap.cashSales ?? "0",
              registerTotalSales: snap.totalSales ?? "0",
              registerShopifyPayments: nonCash.toFixed(2),
              expectedCash: expectedCash.toString(),
            }).where(eq(drawerSessions.id, session.id));
            Object.assign(session, {
              registerCashSales: snap.cashSales ?? "0",
              registerTotalSales: snap.totalSales ?? "0",
              registerShopifyPayments: nonCash.toFixed(2),
              expectedCash: expectedCash.toString(),
            });
          }
        } catch (snapErr: any) {
          logger.warn({ error: snapErr.message }, "[Cash] Shopify snapshot auto-populate failed (non-fatal)");
        }
      }

      res.json(session);
    } catch (err: any) {
      logger.error({ error: err.message }, "[Cash] Failed to create session");
      res.status(500).json({ error: "Failed to create session" });
    }
  });

  app.get("/api/cash/sessions", isAuthenticated, async (req: any, res) => {
    try {
      if (!(await requireCashAccess(req, res))) return;
      const storeId = await getStoreId();
      const date = (req.query.date as string) || new Date().toISOString().split("T")[0];
      const typeFilter = req.query.type as string | undefined;

      let conditions = [eq(drawerSessions.storeId, storeId), eq(drawerSessions.sessionDate, date)];
      if (typeFilter) {
        conditions.push(eq(drawerSessions.sessionType, typeFilter));
      }

      const sessions = await db.select().from(drawerSessions)
        .where(and(...conditions))
        .orderBy(drawerSessions.registerName, drawerSessions.sessionType);

      res.json(sessions);
    } catch (err: any) {
      logger.error({ error: err.message }, "[Cash] Failed to list sessions");
      res.status(500).json({ error: "Failed to list sessions" });
    }
  });

  app.get("/api/cash/sessions/:id", isAuthenticated, async (req: any, res) => {
    try {
      if (!(await requireCashAccess(req, res))) return;
      const storeId = await getStoreId();
      const session = await verifySessionAccess(req.params.id, storeId);
      if (!session) return res.status(404).json({ error: "Session not found" });
      res.json(session);
    } catch (err: any) {
      res.status(500).json({ error: "Failed to get session" });
    }
  });

  app.put("/api/cash/sessions/:id/count", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user?.id || req.auth?.userId;
      const { clockedIn, atStore } = await checkClockedIn(userId);
      if (!clockedIn || !atStore) return res.status(403).json({ error: "You must be clocked in at the store to submit a cash count" });
      const { counts } = req.body;

      const storeId = await getStoreId();
      const session = await verifySessionAccess(req.params.id, storeId);
      if (!session) return res.status(404).json({ error: "Session not found" });

      const startingCash = parseFloat(session.startingCash || "200");
      const breakdown = calculateDenominations(counts, startingCash);

      let expectedCash = startingCash;
      if (session.sessionType === "closing" && session.registerCashSales) {
        expectedCash = startingCash + parseFloat(session.registerCashSales);
      }

      const overShort = breakdown.totalCashCounted - expectedCash;
      const [settings] = await db.select().from(cashManagementSettings)
        .where(eq(cashManagementSettings.storeId, storeId));
      const threshold = parseFloat(settings?.autoFlagThreshold || "20");
      const status = Math.abs(overShort) >= threshold ? "flagged" : "counted";

      const [updated] = await db.update(drawerSessions).set({
        ...counts,
        totalCashCounted: breakdown.totalCashCounted.toString(),
        expectedCash: expectedCash.toString(),
        overShortAmount: overShort.toFixed(2),
        status,
        countedBy: userId,
        countedAt: new Date(),
      }).where(eq(drawerSessions.id, req.params.id)).returning();

      if (Math.abs(overShort) >= parseFloat(settings?.overShortThreshold || "5")) {
        await logDiscrepancy(updated, storeId);
      }

      res.json({ session: updated, breakdown });
    } catch (err: any) {
      logger.error({ error: err.message }, "[Cash] Failed to submit count");
      res.status(500).json({ error: "Failed to submit count" });
    }
  });

  app.put("/api/cash/sessions/:id/register-data", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user?.id || req.auth?.userId;
      const { clockedIn, atStore } = await checkClockedIn(userId);
      if (!clockedIn || !atStore) return res.status(403).json({ error: "You must be clocked in at the store to submit register data" });
      const storeId = await getStoreId();
      const session = await verifySessionAccess(req.params.id, storeId);
      if (!session) return res.status(404).json({ error: "Session not found" });

      const [shopifySnap] = await db.select({
          cashSales: shopifyRegisterSessions.cashSales,
          totalSales: shopifyRegisterSessions.totalSales,
          tenderBreakdown: shopifyRegisterSessions.tenderBreakdown,
        })
        .from(shopifyRegisterSessions)
        .where(and(
          eq(shopifyRegisterSessions.storeId, storeId),
          eq(shopifyRegisterSessions.sessionDate, session.sessionDate),
          eq(shopifyRegisterSessions.registerName, session.registerName),
        ))
        .limit(1);

      let effectiveCashSales: string | null;
      let effectiveTotalSales: string | null;
      let effectiveShopifyPayments: string | null;

      if (shopifySnap != null) {
        effectiveCashSales = shopifySnap.cashSales ?? "0";
        effectiveTotalSales = shopifySnap.totalSales ?? "0";
        const breakdown = shopifySnap.tenderBreakdown as any[] | null;
        const nonCash = Array.isArray(breakdown)
          ? breakdown
              .filter((t: any) => t.tenderType && t.tenderType.toLowerCase() !== "cash")
              .reduce((sum: number, t: any) => sum + parseFloat(t.amount?.shopMoney?.amount || "0"), 0)
          : null;
        effectiveShopifyPayments = nonCash !== null ? nonCash.toFixed(2) : (session.registerShopifyPayments ?? null);
      } else {
        // No Shopify snapshot — preserve any previously synced values; never accept manual overrides for Shopify-sourced fields
        effectiveCashSales = session.registerCashSales ?? null;
        effectiveTotalSales = session.registerTotalSales ?? null;
        effectiveShopifyPayments = session.registerShopifyPayments ?? null;
      }

      const startingCash = parseFloat(session.startingCash || "200");
      const totalCounted = parseFloat(session.totalCashCounted || "0");
      const cashSales = parseFloat(effectiveCashSales || "0");
      const expectedCash = startingCash + cashSales;
      const overShort = totalCounted - expectedCash;

      const [updated] = await db.update(drawerSessions).set({
        registerCashSales: effectiveCashSales?.toString() || null,
        registerTotalSales: effectiveTotalSales?.toString() || null,
        registerShopifyPayments: effectiveShopifyPayments?.toString() || null,
        expectedCash: expectedCash.toString(),
        overShortAmount: overShort.toFixed(2),
      }).where(eq(drawerSessions.id, req.params.id)).returning();
      const [settings] = await db.select().from(cashManagementSettings)
        .where(eq(cashManagementSettings.storeId, storeId));

      if (Math.abs(overShort) >= parseFloat(settings?.overShortThreshold || "5")) {
        await logDiscrepancy(updated, storeId);
      }

      res.json(updated);
    } catch (err: any) {
      logger.error({ error: err.message }, "[Cash] Failed to update register data");
      res.status(500).json({ error: "Failed to update register data" });
    }
  });

  app.put("/api/cash/sessions/:id/recount", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user?.id || req.auth?.userId;
      const { clockedIn, atStore } = await checkClockedIn(userId);
      if (!clockedIn || !atStore) return res.status(403).json({ error: "You must be clocked in at the store to recount" });
      const { counts } = req.body;
      const storeId = await getStoreId();
      const session = await verifySessionAccess(req.params.id, storeId);
      if (!session) return res.status(404).json({ error: "Session not found" });

      const previousAttempt = {
        attempt: (session.recountAttempts || 0) + 1,
        timestamp: new Date().toISOString(),
        totalCashCounted: session.totalCashCounted,
        hundredCount: session.hundredCount, fiftyCount: session.fiftyCount,
        twentyCount: session.twentyCount, tenCount: session.tenCount,
        fiveCount: session.fiveCount, oneCount: session.oneCount,
        rolledQuarterCount: session.rolledQuarterCount, rolledDimeCount: session.rolledDimeCount,
        rolledNickelCount: session.rolledNickelCount, rolledPennyCount: session.rolledPennyCount,
        pennyCount: session.pennyCount, nickelCount: session.nickelCount,
        dimeCount: session.dimeCount, quarterCount: session.quarterCount,
      };

      const history = Array.isArray(session.recountHistory) ? [...(session.recountHistory as any[]), previousAttempt] : [previousAttempt];

      const startingCash = parseFloat(session.startingCash || "200");
      const breakdown = calculateDenominations(counts, startingCash);

      let expectedCash = parseFloat(session.expectedCash || String(startingCash));
      const overShort = breakdown.totalCashCounted - expectedCash;

      const [updated] = await db.update(drawerSessions).set({
        ...counts,
        totalCashCounted: breakdown.totalCashCounted.toString(),
        overShortAmount: overShort.toFixed(2),
        recountAttempts: (session.recountAttempts || 0) + 1,
        recountHistory: history,
        status: "counted",
      }).where(eq(drawerSessions.id, req.params.id)).returning();

      res.json({ session: updated, breakdown });
    } catch (err: any) {
      logger.error({ error: err.message }, "[Cash] Failed to recount");
      res.status(500).json({ error: "Failed to recount" });
    }
  });

  app.put("/api/cash/sessions/:id/explanation", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user?.id || req.auth?.userId;
      const { clockedIn, atStore } = await checkClockedIn(userId);
      if (!clockedIn || !atStore) return res.status(403).json({ error: "You must be clocked in at the store to submit an explanation" });
      const storeId = await getStoreId();
      const session = await verifySessionAccess(req.params.id, storeId);
      if (!session) return res.status(404).json({ error: "Session not found" });
      const { explanation } = req.body;
      const [updated] = await db.update(drawerSessions).set({
        overShortExplanation: explanation,
      }).where(eq(drawerSessions.id, req.params.id)).returning();
      res.json(updated);
    } catch (err: any) {
      res.status(500).json({ error: "Failed to save explanation" });
    }
  });

  app.put("/api/cash/sessions/:id/verify", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user?.id || req.auth?.userId;
      const isManager = await requireManagerOrAbove(storage, userId);
      if (!isManager) return res.status(403).json({ error: "Manager access required" });
      const storeId = await getStoreId();
      const session = await verifySessionAccess(req.params.id, storeId);
      if (!session) return res.status(404).json({ error: "Session not found" });
      const [updated] = await db.update(drawerSessions).set({
        verifiedBy: userId,
        verifiedAt: new Date(),
        status: "verified",
      }).where(eq(drawerSessions.id, req.params.id)).returning();
      res.json(updated);
    } catch (err: any) {
      res.status(500).json({ error: "Failed to verify session" });
    }
  });

  // ===== Deposits =====
  app.post("/api/cash/deposits", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user?.id || req.auth?.userId;
      const { clockedIn, atStore } = await checkClockedIn(userId);
      if (!clockedIn || !atStore) return res.status(403).json({ error: "You must be clocked in at the store to create a deposit" });
      const storeId = await getStoreId();
      const { expectedAmount, actualAmount, depositSlipPhoto, registerSummaryPhoto, drawerSummaryPhoto, drawerSessionId } = req.body;
      const today = new Date().toISOString().split("T")[0];

      const discrepancy = actualAmount && expectedAmount ? (parseFloat(actualAmount) - parseFloat(expectedAmount)) : null;

      const [deposit] = await db.insert(cashDeposits).values({
        storeId,
        depositDate: today,
        depositedBy: userId,
        depositedAt: new Date(),
        expectedAmount: expectedAmount?.toString(),
        actualAmount: actualAmount?.toString(),
        drawerSessionId: drawerSessionId || null,
        depositSlipPhoto,
        registerSummaryPhoto,
        drawerSummaryPhoto,
        discrepancyAmount: discrepancy?.toFixed(2),
        status: "pending",
      }).returning();

      res.json(deposit);
    } catch (err: any) {
      logger.error({ error: err.message }, "[Cash] Failed to create deposit");
      res.status(500).json({ error: "Failed to create deposit" });
    }
  });

  app.get("/api/cash/deposits", isAuthenticated, async (req: any, res) => {
    try {
      if (!(await requireCashAccess(req, res))) return;
      const storeId = await getStoreId();
      const date = (req.query.date as string) || new Date().toISOString().split("T")[0];

      const deposits = await db.select().from(cashDeposits)
        .where(and(eq(cashDeposits.storeId, storeId), eq(cashDeposits.depositDate, date)));

      res.json(deposits);
    } catch (err: any) {
      res.status(500).json({ error: "Failed to list deposits" });
    }
  });

  app.get("/api/cash/deposits/:id", isAuthenticated, async (req: any, res) => {
    try {
      if (!(await requireCashAccess(req, res))) return;
      const storeId = await getStoreId();
      const deposit = await verifyDepositAccess(req.params.id, storeId);
      if (!deposit) return res.status(404).json({ error: "Deposit not found" });
      res.json(deposit);
    } catch (err: any) {
      res.status(500).json({ error: "Failed to get deposit" });
    }
  });

  // ===== Validate deposit slip image =====
  app.post("/api/cash/validate-deposit-slip", isAuthenticated, async (req: any, res) => {
    try {
      const { imageBase64 } = req.body;
      if (!imageBase64) return res.status(400).json({ error: "imageBase64 is required" });

      const storeId = await getStoreId();
      const [storeSettings] = await db.select().from(cashManagementSettings)
        .where(eq(cashManagementSettings.storeId, storeId));
      const referenceSlip = storeSettings?.referenceDepositSlip || null;

      const result = await validateDepositSlipImage(imageBase64, referenceSlip);
      res.json(result);
    } catch (err: any) {
      logger.error({ error: err.message }, "[Cash] Deposit slip validation failed");
      res.status(500).json({ error: "Validation failed" });
    }
  });

  // ===== Employee-level deposit submit =====
  app.put("/api/cash/deposits/:id/submit", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user?.id || req.auth?.userId;
      if (!(await requireCashAccess(req, res))) return;
      const storeId = await getStoreId();
      const deposit = await verifyDepositAccess(req.params.id, storeId);
      if (!deposit) return res.status(404).json({ error: "Deposit not found" });

      const { actualAmount, reviewNotes } = req.body;
      const parsedActual = actualAmount ? parseFloat(actualAmount) : null;
      const parsedExpected = deposit.expectedAmount ? parseFloat(deposit.expectedAmount) : null;
      const discrepancy = parsedActual != null && parsedExpected != null
        ? parsedActual - parsedExpected : null;

      const [updated] = await db.update(cashDeposits).set({
        actualAmount: parsedActual != null ? parsedActual.toFixed(2) : null,
        discrepancyAmount: discrepancy != null ? discrepancy.toFixed(2) : null,
        reviewNotes: reviewNotes || null,
        status: "pending",
        submittedAt: new Date(),
      }).where(eq(cashDeposits.id, req.params.id)).returning();

      // Fire owner alert if variance exceeds tolerance
      try {
        const [settings] = await db.select().from(cashManagementSettings)
          .where(eq(cashManagementSettings.storeId, storeId));
        const tolerance = parseFloat(settings?.depositTolerance || "1.00");
        if (discrepancy != null && Math.abs(discrepancy) > tolerance) {
          const ownerUsers = await db
            .select({ id: users.id })
            .from(users)
            .where(eq(users.companyId, (
              await db.select({ companyId: users.companyId }).from(users).where(eq(users.id, userId)).limit(1)
            )[0]?.companyId || ""));

          const direction = discrepancy > 0 ? "over" : "short";
          const absAmt = Math.abs(discrepancy).toFixed(2);
          const alertTitle = `Deposit Mismatch: $${absAmt} ${direction}`;
          const alertDesc = `A deposit was submitted with $${parsedActual?.toFixed(2)} actual vs $${parsedExpected?.toFixed(2)} expected (${direction} by $${absAmt}). Deposit date: ${deposit.depositDate}.`;

          for (const owner of ownerUsers) {
            await db.insert(aiInsights).values({
              userId: owner.id,
              type: "deposit_mismatch",
              title: alertTitle,
              description: alertDesc,
              severity: Math.abs(discrepancy) > tolerance * 5 ? "critical" : "warning",
              metadata: {
                depositId: req.params.id,
                actualAmount: parsedActual,
                expectedAmount: parsedExpected,
                discrepancy,
                depositDate: deposit.depositDate,
              },
            });
          }
        }
      } catch (alertErr: any) {
        logger.warn({ error: alertErr.message }, "[Cash] Failed to insert owner alert (non-fatal)");
      }

      res.json(updated);
    } catch (err: any) {
      logger.error({ error: err.message }, "[Cash] Failed to submit deposit");
      res.status(500).json({ error: "Failed to submit deposit" });
    }
  });

  app.post("/api/cash/deposits/:id/analyze", isAuthenticated, async (req: any, res) => {
    try {
      const storeId = await getStoreId();
      const deposit = await verifyDepositAccess(req.params.id, storeId);
      if (!deposit) return res.status(404).json({ error: "Deposit not found" });
      if (!deposit.depositSlipPhoto) return res.status(400).json({ error: "No deposit slip photo" });

      const analysis = await analyzeDepositSlip(deposit.depositSlipPhoto);

      const [updated] = await db.update(cashDeposits).set({
        aiExtractedAmount: analysis.extractedAmount?.toString() || null,
        aiConfidence: analysis.confidence,
        aiAnalysis: analysis.analysis,
      }).where(eq(cashDeposits.id, req.params.id)).returning();

      res.json({ deposit: updated, analysis });
    } catch (err: any) {
      logger.error({ error: err.message }, "[Cash] Deposit analysis failed");
      res.status(500).json({ error: "Failed to analyze deposit" });
    }
  });

  app.put("/api/cash/deposits/:id/review", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user?.id || req.auth?.userId;
      const isOwner = await requireOwnerOrAdmin(storage, userId);
      if (!isOwner) return res.status(403).json({ error: "Owner or admin access required" });
      const storeId = await getStoreId();
      const deposit = await verifyDepositAccess(req.params.id, storeId);
      if (!deposit) return res.status(404).json({ error: "Deposit not found" });
      const { status, reviewNotes } = req.body;
      const [updated] = await db.update(cashDeposits).set({
        status,
        reviewedBy: userId,
        reviewedAt: new Date(),
        reviewNotes,
      }).where(eq(cashDeposits.id, req.params.id)).returning();
      res.json(updated);
    } catch (err: any) {
      res.status(500).json({ error: "Failed to review deposit" });
    }
  });

  // ===== Reports & Investigation =====
  app.get("/api/cash/daily-report", isAuthenticated, async (req: any, res) => {
    try {
      if (!(await requireCashAccess(req, res))) return;
      const storeId = await getStoreId();
      const date = (req.query.date as string) || new Date().toISOString().split("T")[0];
      const report = await getDailyCashReport(storeId, date);
      res.json(report);
    } catch (err: any) {
      logger.error({ error: err.message }, "[Cash] Failed daily report");
      res.status(500).json({ error: "Failed to generate report" });
    }
  });

  app.get("/api/cash/trends", isAuthenticated, async (req: any, res) => {
    try {
      if (!(await requireCashAccess(req, res))) return;
      const storeId = await getStoreId();
      const days = parseInt(req.query.days as string) || 30;
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - days);
      const cutoffStr = cutoff.toISOString().split("T")[0];

      const discrepancies = await db.select().from(cashDiscrepancyLog)
        .where(and(
          eq(cashDiscrepancyLog.storeId, storeId),
          gte(cashDiscrepancyLog.sessionDate, cutoffStr),
        ))
        .orderBy(cashDiscrepancyLog.sessionDate);

      const byDate: Record<string, { date: string; totalOverShort: number; events: number }> = {};
      for (const d of discrepancies) {
        if (!byDate[d.sessionDate]) byDate[d.sessionDate] = { date: d.sessionDate, totalOverShort: 0, events: 0 };
        byDate[d.sessionDate].totalOverShort += parseFloat(d.amount);
        byDate[d.sessionDate].events++;
      }

      res.json({
        days,
        totalEvents: discrepancies.length,
        totalAmount: discrepancies.reduce((s, d) => s + parseFloat(d.amount), 0),
        dailyTrend: Object.values(byDate).sort((a, b) => a.date.localeCompare(b.date)),
      });
    } catch (err: any) {
      res.status(500).json({ error: "Failed to get trends" });
    }
  });

  app.get("/api/cash/investigation", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user?.id || req.auth?.userId;
      const isOwner = await requireOwnerOrAdmin(storage, userId);
      if (!isOwner) return res.status(403).json({ error: "Owner or admin access required" });
      const storeId = await getStoreId();
      const days = parseInt(req.query.days as string) || 90;
      const analysis = await analyzeCashPatterns(storeId, days);
      res.json(analysis);
    } catch (err: any) {
      logger.error({ error: err.message }, "[Cash] Investigation failed");
      res.status(500).json({ error: "Failed to run investigation" });
    }
  });

  app.get("/api/cash/employee-profile/:userId", isAuthenticated, async (req: any, res) => {
    try {
      const isManager = await requireManagerOrAbove(storage, req.auth?.userId);
      if (!isManager) return res.status(403).json({ error: "Manager access required" });
      const storeId = await getStoreId();
      const days = parseInt(req.query.days as string) || 90;
      const profile = await getEmployeeCashProfile(storeId, req.params.userId, days);
      res.json(profile);
    } catch (err: any) {
      res.status(500).json({ error: "Failed to get employee profile" });
    }
  });

  app.post("/api/cash/recount-suggestion", isAuthenticated, async (req: any, res) => {
    try {
      const { counts } = req.body;
      const suggestion = await suggestRecountFocus(counts);
      res.json({ suggestion });
    } catch (err: any) {
      res.status(500).json({ error: "Failed to generate suggestion" });
    }
  });

  // ===== Shopify Sync =====
  app.post("/api/cash/sync-shopify", isAuthenticated, async (req: any, res) => {
    try {
      if (!(await requireCashAccess(req, res))) return;
      const userId = req.user?.id || req.auth?.userId;
      const date = (req.query.date as string) || new Date().toISOString().split("T")[0];

      const today = new Date().toISOString().split("T")[0];
      const isPastDate = date < today;

      // For past dates, return stored data using fallback storeId
      if (isPastDate) {
        const storeId = await getStoreId();
        const stored = await db.select().from(shopifyRegisterSessions)
          .where(and(eq(shopifyRegisterSessions.storeId, storeId), eq(shopifyRegisterSessions.sessionDate, date)));
        const registerNames = [...new Set(stored.map((s: any) => s.registerName))];
        return res.json({ synced: 0, sessions: stored, registerNames, message: "Past dates use stored Shopify data only." });
      }

      const [userRow] = await db.select({ companyId: users.companyId })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);
      const userCompanyId = userRow?.companyId;

      if (!userCompanyId) {
        return res.status(400).json({ error: "No connected Shopify store found. Connect Shopify first.", noShopify: true });
      }

      const [shop] = await db.select().from(shops)
        .where(and(eq(shops.isActive, true), eq(shops.companyId, userCompanyId)))
        .limit(1);

      if (!shop || !shop.accessToken) {
        return res.status(400).json({ error: "No connected Shopify store found. Connect Shopify first.", noShopify: true });
      }

      let accessToken = shop.accessToken;
      try { accessToken = decryptToken(accessToken); } catch {}

      const shopifyService = new ShopifyService(shop.shopDomain, accessToken);
      const sessions = await shopifyService.getCashTrackingSessions(date);

      // Pre-load active work locations for this company for storeId resolution by name
      const allWorkLocations = await db.select({ id: workLocationsTable.id, name: workLocationsTable.name })
        .from(workLocationsTable)
        .where(and(eq(workLocationsTable.isActive, true), eq(workLocationsTable.companyId, userCompanyId)));

      // Fallback: first active location (single-store compatibility)
      const fallbackStoreId = allWorkLocations[0]?.id ?? await getStoreId();

      if (sessions.length === 0) {
        const stored = await db.select().from(shopifyRegisterSessions)
          .where(and(eq(shopifyRegisterSessions.storeId, fallbackStoreId), eq(shopifyRegisterSessions.sessionDate, date)));
        const registerNames = [...new Set(stored.map((s: any) => s.registerName))];
        return res.json({ synced: 0, sessions: stored, registerNames, message: "No Shopify POS sessions found for this date (or POS Pro not enabled)." });
      }

      const upserted = [];
      for (const s of sessions) {
        const registerName = s.register?.name || s.name || "Register";
        const shopifySessionId = s.id;

        // Resolve storeId: match Shopify location name (if present) to a work_location by name.
        // If Shopify omits the location field on a session (e.g. POS Basic / older API), we fall
        // back to the first active work_location (single-location compatibility). A future
        // improvement could pre-fetch getLocations() here and use Shopify location IDs for a
        // more reliable mapping when location names are absent.
        const shopifyLocationName: string | null = s.location?.name ?? null;
        let sessionStoreId = fallbackStoreId;
        if (shopifyLocationName) {
          const matchedLoc = allWorkLocations.find(
            l => l.name.toLowerCase() === shopifyLocationName.toLowerCase()
          );
          if (matchedLoc) sessionStoreId = matchedLoc.id;
        }

        const cashSales = s.cashSalesCents?.shopMoney?.amount || s.cashSales?.shopMoney?.amount || null;
        const cashRefunds = s.cashRefundsCents?.shopMoney?.amount || s.cashRefunds?.shopMoney?.amount || null;
        const cashAdjustments = s.cashAdjustments?.shopMoney?.amount || null;
        const totalSales = s.totalSales?.shopMoney?.amount || null;
        const openingFloat = s.openingFloat?.shopMoney?.amount || null;
        const expectedClosingCash = s.expectedClosingCash?.shopMoney?.amount || null;
        const reportedClosingCash = s.reportedClosingCash?.shopMoney?.amount || null;
        const tenderBreakdown = s.tenderTypeSummaries?.nodes || [];
        const cashMovements = s.transactions?.nodes || [];

        const nonCashTenders = (tenderBreakdown as any[]).filter((t: any) =>
          t.tenderType && t.tenderType.toLowerCase() !== "cash"
        );
        const shopifyPayments = nonCashTenders.reduce((sum: number, t: any) => {
          const amount = t.amount?.shopMoney?.amount || "0";
          return sum + parseFloat(amount);
        }, 0);

        const existing = await db.select({ id: shopifyRegisterSessions.id })
          .from(shopifyRegisterSessions)
          .where(eq(shopifyRegisterSessions.shopifySessionId, shopifySessionId))
          .limit(1);

        const record: any = {
          storeId: sessionStoreId,
          sessionDate: date,
          registerName,
          shopifySessionId,
          status: s.status,
          openedAt: s.openedAt ? new Date(s.openedAt) : null,
          closedAt: s.closedAt ? new Date(s.closedAt) : null,
          openingFloat: openingFloat ? parseFloat(openingFloat).toFixed(2) : null,
          expectedClosingCash: expectedClosingCash ? parseFloat(expectedClosingCash).toFixed(2) : null,
          reportedClosingCash: reportedClosingCash ? parseFloat(reportedClosingCash).toFixed(2) : null,
          cashSales: cashSales ? parseFloat(cashSales).toFixed(2) : null,
          cashRefunds: cashRefunds ? parseFloat(cashRefunds).toFixed(2) : null,
          cashAdjustments: cashAdjustments ? parseFloat(cashAdjustments).toFixed(2) : null,
          totalSales: totalSales ? parseFloat(totalSales).toFixed(2) : null,
          tenderBreakdown,
          cashMovements,
          rawPayload: s,
          syncedAt: new Date(),
        };

        if (existing.length > 0) {
          const [updated] = await db.update(shopifyRegisterSessions)
            .set(record)
            .where(eq(shopifyRegisterSessions.id, existing[0].id))
            .returning();
          upserted.push(updated);
        } else {
          const [created] = await db.insert(shopifyRegisterSessions).values(record).returning();
          upserted.push(created);
        }

        const matchingClosing = await db.select().from(drawerSessions)
          .where(and(
            eq(drawerSessions.storeId, sessionStoreId),
            eq(drawerSessions.sessionDate, date),
            eq(drawerSessions.sessionType, "closing"),
            eq(drawerSessions.registerName, registerName),
          ))
          .limit(1);

        if (matchingClosing.length > 0) {
          const sess = matchingClosing[0];
          const startingCash = parseFloat(sess.startingCash || "200");
          const totalCounted = parseFloat(sess.totalCashCounted || "0");
          const cashSalesVal = cashSales ? parseFloat(cashSales) : 0;
          const expectedCash = startingCash + cashSalesVal;
          const overShort = totalCounted > 0 ? totalCounted - expectedCash : parseFloat(sess.overShortAmount || "0");

          await db.update(drawerSessions).set({
            registerCashSales: cashSales ? cashSalesVal.toFixed(2) : sess.registerCashSales,
            registerTotalSales: totalSales ? parseFloat(totalSales).toFixed(2) : sess.registerTotalSales,
            registerShopifyPayments: shopifyPayments > 0 ? shopifyPayments.toFixed(2) : sess.registerShopifyPayments,
            expectedCash: cashSales ? expectedCash.toFixed(2) : sess.expectedCash,
            overShortAmount: (cashSales && totalCounted > 0) ? overShort.toFixed(2) : sess.overShortAmount,
          }).where(eq(drawerSessions.id, sess.id));
        }
      }

      // Return distinct register names from synced sessions so the UI knows which registers exist
      const registerNames = [...new Set(upserted.map((s: any) => s.registerName))];
      res.json({ synced: upserted.length, sessions: upserted, registerNames });
    } catch (err: any) {
      logger.error({ error: err.message }, "[Cash] Shopify sync failed");
      res.status(500).json({ error: "Failed to sync from Shopify", detail: err.message });
    }
  });

  app.get("/api/cash/shopify-sessions", isAuthenticated, async (req: any, res) => {
    try {
      if (!(await requireCashAccess(req, res))) return;
      const storeId = await getStoreId();
      const date = (req.query.date as string) || new Date().toISOString().split("T")[0];
      const sessions = await db.select().from(shopifyRegisterSessions)
        .where(and(eq(shopifyRegisterSessions.storeId, storeId), eq(shopifyRegisterSessions.sessionDate, date)));
      res.json(sessions);
    } catch (err: any) {
      res.status(500).json({ error: "Failed to get Shopify sessions" });
    }
  });

  // ===== Session Notes =====
  app.patch("/api/cash/sessions/:id/notes", isAuthenticated, async (req: any, res) => {
    try {
      if (!(await requireCashAccess(req, res))) return;
      const storeId = await getStoreId();
      const session = await verifySessionAccess(req.params.id, storeId);
      if (!session) return res.status(404).json({ error: "Session not found" });
      const { notes } = req.body;
      if (typeof notes !== "string") return res.status(400).json({ error: "notes must be a string" });
      const [updated] = await db.update(drawerSessions)
        .set({ notes })
        .where(eq(drawerSessions.id, req.params.id))
        .returning();
      res.json(updated);
    } catch (err: any) {
      res.status(500).json({ error: "Failed to update notes" });
    }
  });
}
