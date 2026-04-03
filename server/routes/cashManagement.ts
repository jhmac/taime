import type { Express } from "express";
import { db } from "../db";
import { eq, and, desc, gte, sql } from "drizzle-orm";
import { z } from "zod";
import {
  drawerSessions, cashDeposits, cashDiscrepancyLog, cashManagementSettings,
  insertDrawerSessionSchema, insertCashDepositSchema,
} from "@shared/schema";
import type { IStorage } from "../storage";
import { resolveStoreId } from "../lib/storeResolver";
import {
  calculateDenominations, captureEmployeesOnDuty, analyzeDepositSlip,
  getDailyCashReport, suggestRecountFocus, logDiscrepancy,
  analyzeCashPatterns, getEmployeeCashProfile,
} from "../services/cashManagement";
import { timeEntries } from "@shared/schema";
import { isNull } from "drizzle-orm";
import logger from "../lib/logger";

async function requireManagerOrAbove(storage: IStorage, userId: string): Promise<boolean> {
  const user = await storage.getUser(userId);
  if (!user) throw new Error("User not found");
  return user.role === "admin" || user.role === "owner" || user.role === "manager";
}

async function requireOwnerOrAdmin(storage: IStorage, userId: string): Promise<boolean> {
  const user = await storage.getUser(userId);
  if (!user) throw new Error("User not found");
  return user.role === "admin" || user.role === "owner";
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

async function checkClockedIn(userId: string, companyId?: string): Promise<{ clockedIn: boolean; atStore: boolean; activeEntry: any | null }> {
  const [entry] = await db.select().from(timeEntries)
    .where(and(eq(timeEntries.userId, userId), isNull(timeEntries.clockOutTime)))
    .limit(1);
  if (!entry) return { clockedIn: false, atStore: false, activeEntry: null };
  const storeId = await resolveStoreId(companyId);
  const atStore = !storeId || entry.locationId === storeId;
  return { clockedIn: true, atStore, activeEntry: entry };
}

export function registerCashManagementRoutes(app: Express, storage: IStorage, isAuthenticated: any) {

  app.get("/api/cash/access-check", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.auth?.userId || req.user?.id;
      const { clockedIn, atStore, activeEntry } = await checkClockedIn(userId, req.user?.companyId);
      const user = await storage.getUser(userId);
      const isManagerOrAbove = user?.role === "admin" || user?.role === "owner" || user?.role === "manager";
      res.json({
        allowed: (clockedIn && atStore) || isManagerOrAbove,
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
    const userId = req.auth?.userId || req.user?.id;
    const { clockedIn, atStore } = await checkClockedIn(userId, req.user?.companyId);
    if (clockedIn && atStore) return true;
    const user = await storage.getUser(userId);
    if (user?.role === "admin" || user?.role === "owner" || user?.role === "manager") return true;
    res.status(403).json({ error: "You must be clocked in at the store to access Cash Management" });
    return false;
  }

  // ===== Settings =====
  app.get("/api/cash/settings", isAuthenticated, async (req: any, res) => {
    try {
      if (!(await requireCashAccess(req, res))) return;
      const storeId = await resolveStoreId(req.user?.companyId);
      const [existing] = await db.select().from(cashManagementSettings)
        .where(eq(cashManagementSettings.storeId, storeId));

      if (existing) return res.json(existing);

      const [created] = await db.insert(cashManagementSettings).values({
        storeId,
        registers: [{ name: "Register 1", id: "register-1" }],
      }).returning();

      res.json(created);
    } catch (err: any) {
      logger.error({ error: err.message }, "[Cash] Failed to get settings");
      res.status(500).json({ error: "Failed to load settings" });
    }
  });

  app.put("/api/cash/settings", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.auth?.userId;
      const isOwnerOrAdmin = await requireOwnerOrAdmin(storage, userId);
      if (!isOwnerOrAdmin) {
        return res.status(403).json({ error: "Only admins and owners can update Cash Management settings" });
      }
      const storeId = await resolveStoreId(req.user?.companyId);
      const { defaultStartingCash, registers, overShortThreshold, requireDepositPhoto, requireOverShortExplanation, autoFlagThreshold, closingTime } = req.body;

      if (closingTime !== undefined && closingTime !== null && closingTime !== "") {
        if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(closingTime)) {
          return res.status(400).json({ error: "closingTime must be in HH:MM 24-hour format (e.g. '21:00')" });
        }
      }

      const [existing] = await db.select().from(cashManagementSettings)
        .where(eq(cashManagementSettings.storeId, storeId));

      if (existing) {
        const [updated] = await db.update(cashManagementSettings)
          .set({
            defaultStartingCash: defaultStartingCash?.toString(),
            registers, overShortThreshold: overShortThreshold?.toString(),
            requireDepositPhoto, requireOverShortExplanation,
            autoFlagThreshold: autoFlagThreshold?.toString(),
            closingTime: closingTime || null,
            updatedAt: new Date(),
          })
          .where(eq(cashManagementSettings.storeId, storeId))
          .returning();
        return res.json(updated);
      }

      const [created] = await db.insert(cashManagementSettings).values({
        storeId,
        defaultStartingCash: defaultStartingCash?.toString() || "200.00",
        registers: registers || [{ name: "Register 1", id: "register-1" }],
        overShortThreshold: overShortThreshold?.toString() || "5.00",
        requireDepositPhoto, requireOverShortExplanation,
        autoFlagThreshold: autoFlagThreshold?.toString() || "20.00",
        closingTime: closingTime || null,
      }).returning();

      res.json(created);
    } catch (err: any) {
      logger.error({ error: err.message }, "[Cash] Failed to update settings");
      res.status(500).json({ error: "Failed to update settings" });
    }
  });

  // ===== Drawer Sessions =====
  app.post("/api/cash/sessions", isAuthenticated, async (req: any, res) => {
    try {
      const storeId = await resolveStoreId(req.user?.companyId);
      const userId = req.auth?.userId;
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
        if (storeSettings?.closingTime) {
          const now = new Date();
          const [closingHour, closingMinute] = storeSettings.closingTime.split(":").map(Number);
          const closingMinutes = closingHour * 60 + closingMinute;
          const nowMinutes = now.getHours() * 60 + now.getMinutes();
          if (nowMinutes < closingMinutes) {
            const formatted = new Date(0, 0, 0, closingHour, closingMinute).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true });
            return res.status(403).json({ error: `Closing count is not available until ${formatted}`, closingTime: storeSettings.closingTime });
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

      res.json(session);
    } catch (err: any) {
      logger.error({ error: err.message }, "[Cash] Failed to create session");
      res.status(500).json({ error: "Failed to create session" });
    }
  });

  app.get("/api/cash/sessions", isAuthenticated, async (req: any, res) => {
    try {
      if (!(await requireCashAccess(req, res))) return;
      const storeId = await resolveStoreId(req.user?.companyId);
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
      const storeId = await resolveStoreId(req.user?.companyId);
      const session = await verifySessionAccess(req.params.id, storeId);
      if (!session) return res.status(404).json({ error: "Session not found" });
      res.json(session);
    } catch (err: any) {
      res.status(500).json({ error: "Failed to get session" });
    }
  });

  app.put("/api/cash/sessions/:id/count", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.auth?.userId;
      const { clockedIn, atStore } = await checkClockedIn(userId);
      if (!clockedIn || !atStore) return res.status(403).json({ error: "You must be clocked in at the store to submit a cash count" });
      const { counts } = req.body;

      const storeId = await resolveStoreId(req.user?.companyId);
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
      const userId = req.auth?.userId;
      const { clockedIn, atStore } = await checkClockedIn(userId);
      if (!clockedIn || !atStore) return res.status(403).json({ error: "You must be clocked in at the store to submit register data" });
      const { registerCashSales, registerTotalSales, registerShopifyPayments } = req.body;
      const storeId = await resolveStoreId(req.user?.companyId);
      const session = await verifySessionAccess(req.params.id, storeId);
      if (!session) return res.status(404).json({ error: "Session not found" });

      const startingCash = parseFloat(session.startingCash || "200");
      const totalCounted = parseFloat(session.totalCashCounted || "0");
      const cashSales = parseFloat(registerCashSales || "0");
      const expectedCash = startingCash + cashSales;
      const overShort = totalCounted - expectedCash;

      const [updated] = await db.update(drawerSessions).set({
        registerCashSales: registerCashSales?.toString(),
        registerTotalSales: registerTotalSales?.toString(),
        registerShopifyPayments: registerShopifyPayments?.toString(),
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
      const userId = req.auth?.userId;
      const { clockedIn, atStore } = await checkClockedIn(userId);
      if (!clockedIn || !atStore) return res.status(403).json({ error: "You must be clocked in at the store to recount" });
      const { counts } = req.body;
      const storeId = await resolveStoreId(req.user?.companyId);
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
      const userId = req.auth?.userId;
      const { clockedIn, atStore } = await checkClockedIn(userId);
      if (!clockedIn || !atStore) return res.status(403).json({ error: "You must be clocked in at the store to submit an explanation" });
      const storeId = await resolveStoreId(req.user?.companyId);
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
      const userId = req.auth?.userId;
      const isManager = await requireManagerOrAbove(storage, userId);
      if (!isManager) return res.status(403).json({ error: "Manager access required" });
      const storeId = await resolveStoreId(req.user?.companyId);
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
      const userId = req.auth?.userId;
      const { clockedIn, atStore } = await checkClockedIn(userId);
      if (!clockedIn || !atStore) return res.status(403).json({ error: "You must be clocked in at the store to create a deposit" });
      const storeId = await resolveStoreId(req.user?.companyId);
      const { expectedAmount, actualAmount, depositSlipPhoto, registerSummaryPhoto, drawerSummaryPhoto } = req.body;
      const today = new Date().toISOString().split("T")[0];

      const discrepancy = actualAmount && expectedAmount ? (parseFloat(actualAmount) - parseFloat(expectedAmount)) : null;

      const [deposit] = await db.insert(cashDeposits).values({
        storeId,
        depositDate: today,
        depositedBy: userId,
        depositedAt: new Date(),
        expectedAmount: expectedAmount?.toString(),
        actualAmount: actualAmount?.toString(),
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
      const storeId = await resolveStoreId(req.user?.companyId);
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
      const storeId = await resolveStoreId(req.user?.companyId);
      const deposit = await verifyDepositAccess(req.params.id, storeId);
      if (!deposit) return res.status(404).json({ error: "Deposit not found" });
      res.json(deposit);
    } catch (err: any) {
      res.status(500).json({ error: "Failed to get deposit" });
    }
  });

  app.post("/api/cash/deposits/:id/analyze", isAuthenticated, async (req: any, res) => {
    try {
      const storeId = await resolveStoreId(req.user?.companyId);
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
      const userId = req.auth?.userId;
      const isOwner = await requireOwnerOrAdmin(storage, userId);
      if (!isOwner) return res.status(403).json({ error: "Owner or admin access required" });
      const storeId = await resolveStoreId(req.user?.companyId);
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
      const storeId = await resolveStoreId(req.user?.companyId);
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
      const storeId = await resolveStoreId(req.user?.companyId);
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
      const userId = req.auth?.userId;
      const isOwner = await requireOwnerOrAdmin(storage, userId);
      if (!isOwner) return res.status(403).json({ error: "Owner or admin access required" });
      const storeId = await resolveStoreId(req.user?.companyId);
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
      const storeId = await resolveStoreId(req.user?.companyId);
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
}
