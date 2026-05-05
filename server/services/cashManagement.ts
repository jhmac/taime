import { anthropic, withAiContext } from "../lib/aiClients";
import { config } from "../lib/config";
import { db } from "../db";
import { eq, and, gte, lte, desc, sql, isNull, isNotNull, inArray } from "drizzle-orm";
import {
  drawerSessions, cashDeposits, cashDiscrepancyLog, cashManagementSettings,
  shopifyRegisterSessions, timeEntries, users, roles,
} from "@shared/schema";
import { resolveStoreId } from "./storeResolver";
import { notificationService } from "./notificationService";
import { sendReconciliationAlertEmail } from "./cashReconciliationEmail";
import logger from "../lib/logger";

const MODEL = "claude-sonnet-4-20250514";

export const DENOMINATION_VALUES: Record<string, number> = {
  hundred: 100, fifty: 50, twenty: 20, ten: 10, five: 5, one: 1,
  rolledQuarter: 10, rolledDime: 5, rolledNickel: 2, rolledPenny: 0.50,
  quarter: 0.25, dime: 0.10, nickel: 0.05, penny: 0.01,
};

export const DENOMINATION_LABELS: Record<string, string> = {
  penny: "Pennies", nickel: "Nickels", dime: "Dimes", quarter: "Quarters",
  rolledPenny: "Rolled Pennies", rolledNickel: "Rolled Nickels",
  rolledDime: "Rolled Dimes", rolledQuarter: "Rolled Quarters",
  one: "$1 Bills", five: "$5 Bills", ten: "$10 Bills",
  twenty: "$20 Bills", fifty: "$50 Bills", hundred: "$100 Bills",
};

export interface DenominationCounts {
  hundredCount?: number;
  fiftyCount?: number;
  twentyCount?: number;
  tenCount?: number;
  fiveCount?: number;
  oneCount?: number;
  rolledQuarterCount?: number;
  rolledDimeCount?: number;
  rolledNickelCount?: number;
  rolledPennyCount?: number;
  pennyCount?: number;
  nickelCount?: number;
  dimeCount?: number;
  quarterCount?: number;
}

export interface DenominationBreakdown {
  denominations: { name: string; label: string; count: number; value: number }[];
  coinsSubtotal: number;
  billsSubtotal: number;
  totalCashCounted: number;
}

export function calculateDenominations(counts: DenominationCounts, startingCash: number = 200): DenominationBreakdown & { cashToDeposit: number } {
  const denominations = [
    { name: "penny", label: "Pennies", count: counts.pennyCount || 0, value: (counts.pennyCount || 0) * 0.01 },
    { name: "nickel", label: "Nickels", count: counts.nickelCount || 0, value: (counts.nickelCount || 0) * 0.05 },
    { name: "dime", label: "Dimes", count: counts.dimeCount || 0, value: (counts.dimeCount || 0) * 0.10 },
    { name: "quarter", label: "Quarters", count: counts.quarterCount || 0, value: (counts.quarterCount || 0) * 0.25 },
    { name: "rolledPenny", label: "Rolled Pennies", count: counts.rolledPennyCount || 0, value: (counts.rolledPennyCount || 0) * 0.50 },
    { name: "rolledNickel", label: "Rolled Nickels", count: counts.rolledNickelCount || 0, value: (counts.rolledNickelCount || 0) * 2.00 },
    { name: "rolledDime", label: "Rolled Dimes", count: counts.rolledDimeCount || 0, value: (counts.rolledDimeCount || 0) * 5.00 },
    { name: "rolledQuarter", label: "Rolled Quarters", count: counts.rolledQuarterCount || 0, value: (counts.rolledQuarterCount || 0) * 10.00 },
    { name: "one", label: "$1 Bills", count: counts.oneCount || 0, value: (counts.oneCount || 0) * 1 },
    { name: "five", label: "$5 Bills", count: counts.fiveCount || 0, value: (counts.fiveCount || 0) * 5 },
    { name: "ten", label: "$10 Bills", count: counts.tenCount || 0, value: (counts.tenCount || 0) * 10 },
    { name: "twenty", label: "$20 Bills", count: counts.twentyCount || 0, value: (counts.twentyCount || 0) * 20 },
    { name: "fifty", label: "$50 Bills", count: counts.fiftyCount || 0, value: (counts.fiftyCount || 0) * 50 },
    { name: "hundred", label: "$100 Bills", count: counts.hundredCount || 0, value: (counts.hundredCount || 0) * 100 },
  ];

  denominations.forEach(d => { d.value = Math.round(d.value * 100) / 100; });

  const coinNames = ["penny", "nickel", "dime", "quarter", "rolledPenny", "rolledNickel", "rolledDime", "rolledQuarter"];
  const coinsSubtotal = denominations.filter(d => coinNames.includes(d.name)).reduce((sum, d) => sum + d.value, 0);
  const billsSubtotal = denominations.filter(d => !coinNames.includes(d.name)).reduce((sum, d) => sum + d.value, 0);
  const totalCashCounted = Math.round((coinsSubtotal + billsSubtotal) * 100) / 100;
  const cashToDeposit = Math.round((totalCashCounted - startingCash) * 100) / 100;

  return { denominations, coinsSubtotal, billsSubtotal, totalCashCounted, cashToDeposit };
}

export async function captureEmployeesOnDuty(storeId: string, date: string): Promise<any[]> {
  const dayStart = new Date(`${date}T00:00:00Z`);
  const dayEnd = new Date(`${date}T23:59:59Z`);

  const entries = await db.select({
    userId: timeEntries.userId,
    firstName: users.firstName,
    lastName: users.lastName,
    clockInTime: timeEntries.clockInTime,
    clockOutTime: timeEntries.clockOutTime,
  })
    .from(timeEntries)
    .leftJoin(users, eq(timeEntries.userId, users.id))
    .where(and(
      gte(timeEntries.clockInTime, dayStart),
      lte(timeEntries.clockInTime, dayEnd),
    ));

  return entries.map(e => ({
    userId: e.userId,
    name: `${e.firstName || ""} ${e.lastName || ""}`.trim(),
    clockIn: e.clockInTime,
    clockOut: e.clockOutTime,
  }));
}

export async function validateDepositSlipImage(photoBase64: string, referenceSlipBase64?: string | null): Promise<{
  valid: boolean;
  reason: string;
}> {
  try {
    const mediaType = photoBase64.startsWith("data:image/png") ? "image/png" : "image/jpeg";
    const base64Data = photoBase64.replace(/^data:image\/\w+;base64,/, "");

    const contentParts: any[] = [
      {
        type: "image",
        source: { type: "base64", media_type: mediaType, data: base64Data },
      },
    ];

    if (referenceSlipBase64) {
      const refMediaType = referenceSlipBase64.startsWith("data:image/png") ? "image/png" : "image/jpeg";
      const refBase64 = referenceSlipBase64.replace(/^data:image\/\w+;base64,/, "");
      contentParts.unshift({
        type: "image",
        source: { type: "base64", media_type: refMediaType, data: refBase64 },
      });
      contentParts.push({
        type: "text",
        text: `The first image is a reference bank deposit slip template provided by management. The second image is a photo submitted by an employee.

Determine if the second image is a valid bank deposit slip (it does not need to be identical to the reference, just the same type of document).

Respond in JSON only:
{"valid": true, "reason": "This appears to be a bank deposit slip showing deposit details."}
or
{"valid": false, "reason": "This image appears to be [description], not a bank deposit slip."}`,
      });
    } else {
      contentParts.push({
        type: "text",
        text: `Is this image a bank deposit slip? Look for: bank name, deposit amount, account number, date, teller stamp, or typical deposit slip layout.

Respond in JSON only:
{"valid": true, "reason": "This appears to be a bank deposit slip showing deposit details."}
or
{"valid": false, "reason": "This image appears to be [description], not a bank deposit slip."}`,
      });
    }

    const result = await Promise.race([
      anthropic.messages.create({
        model: MODEL,
        max_tokens: 200,
        messages: [{ role: "user", content: contentParts }],
      }),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("timeout")), 15000)),
    ]);

    const text = result.content[0].type === "text" ? result.content[0].text : "";
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("No JSON in response");

    const parsed = JSON.parse(jsonMatch[0]);
    return {
      valid: !!parsed.valid,
      reason: parsed.reason || (parsed.valid ? "Valid deposit slip" : "Not a deposit slip"),
    };
  } catch (err: any) {
    logger.error({ error: err.message }, "[CashManagement] Deposit slip validation failed");
    return { valid: true, reason: "Validation unavailable — proceeding." };
  }
}

export async function analyzeDepositSlip(photoBase64: string): Promise<{
  extractedAmount: number | null;
  confidence: string;
  analysis: string;
  bankName: string | null;
}> {
  try {
    const mediaType = photoBase64.startsWith("data:image/png") ? "image/png" : "image/jpeg";
    const base64Data = photoBase64.replace(/^data:image\/\w+;base64,/, "");

    const result = await Promise.race([
      anthropic.messages.create({
        model: MODEL,
        max_tokens: 500,
        messages: [{
          role: "user",
          content: [
            {
              type: "image",
              source: { type: "base64", media_type: mediaType, data: base64Data },
            },
            {
              type: "text",
              text: `Analyze this bank deposit slip. Extract:
1. The deposit amount (total amount deposited)
2. The bank name
3. Any date visible

Respond in JSON only:
{"amount": 507.18, "bank": "Origin Bank", "date": "02/19/2026", "confidence": "high", "notes": "Clear deposit slip showing $507.18"}

confidence: "high" if amount is clearly readable, "medium" if partially obscured, "low" if hard to read.
If you cannot read the amount at all, use {"amount": null, "confidence": "failed", "notes": "reason"}.`,
            },
          ],
        }],
      }),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("timeout")), 15000)),
    ]);

    const text = result.content[0].type === "text" ? result.content[0].text : "";
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("No JSON in response");

    const parsed = JSON.parse(jsonMatch[0]);
    return {
      extractedAmount: parsed.amount != null ? Number(parsed.amount) : null,
      confidence: parsed.confidence || "medium",
      analysis: parsed.notes || text,
      bankName: parsed.bank || null,
    };
  } catch (err: any) {
    logger.error({ error: err.message }, "[CashManagement] Deposit slip analysis failed");
    return {
      extractedAmount: null,
      confidence: "failed",
      analysis: `Could not analyze deposit slip: ${err.message}`,
      bankName: null,
    };
  }
}

export async function logDiscrepancy(session: any, storeId: string): Promise<void> {
  const amount = parseFloat(session.overShortAmount || "0");
  if (Math.abs(amount) < 0.01) return;

  let previousClosedBy: string | null = null;
  if (session.sessionType === "opening") {
    const [prevClose] = await db.select({ countedBy: drawerSessions.countedBy })
      .from(drawerSessions)
      .where(and(
        eq(drawerSessions.storeId, storeId),
        eq(drawerSessions.registerName, session.registerName),
        eq(drawerSessions.sessionType, "closing"),
        eq(drawerSessions.status, "counted"),
      ))
      .orderBy(desc(drawerSessions.createdAt))
      .limit(1);
    previousClosedBy = prevClose?.countedBy || null;
  }

  let openedBy: string | null = null;
  if (session.sessionType === "closing") {
    const [openSession] = await db.select({ countedBy: drawerSessions.countedBy })
      .from(drawerSessions)
      .where(and(
        eq(drawerSessions.storeId, storeId),
        eq(drawerSessions.registerName, session.registerName),
        eq(drawerSessions.sessionDate, session.sessionDate),
        eq(drawerSessions.sessionType, "opening"),
      ))
      .limit(1);
    openedBy = openSession?.countedBy || null;
  }

  await db.insert(cashDiscrepancyLog).values({
    storeId,
    drawerSessionId: session.id,
    sessionDate: session.sessionDate,
    registerName: session.registerName,
    sessionType: session.sessionType,
    countedBy: session.countedBy,
    amount: String(amount),
    explanation: session.overShortExplanation || null,
    employeesOnDuty: session.employeesOnDuty || [],
    openedBy,
    previousClosedBy,
  });
}

export async function getDailyCashReport(storeId: string, date: string) {
  const sessions = await db.select().from(drawerSessions)
    .where(and(eq(drawerSessions.storeId, storeId), eq(drawerSessions.sessionDate, date)))
    .orderBy(drawerSessions.registerName, drawerSessions.sessionType);

  const deposits = await db.select().from(cashDeposits)
    .where(and(eq(cashDeposits.storeId, storeId), eq(cashDeposits.depositDate, date)));

  const onDuty = await captureEmployeesOnDuty(storeId, date);

  const closingSessions = sessions.filter(s => s.sessionType === "closing" && s.status === "counted");
  const totalExpectedDeposit = closingSessions.reduce((sum, s) => {
    const counted = parseFloat(s.totalCashCounted || "0");
    const starting = parseFloat(s.startingCash || "200");
    return sum + (counted - starting);
  }, 0);

  const totalOverShort = sessions
    .filter(s => s.overShortAmount)
    .reduce((sum, s) => sum + parseFloat(s.overShortAmount!), 0);

  return {
    date,
    sessions,
    deposits,
    employeesOnDuty: onDuty,
    totalExpectedDeposit: Math.round(totalExpectedDeposit * 100) / 100,
    totalOverShort: Math.round(totalOverShort * 100) / 100,
    allRegistersCounted: sessions.filter(s => s.sessionType === "closing").length > 0 &&
      sessions.filter(s => s.sessionType === "closing").every(s => s.status === "counted" || s.status === "verified"),
    depositMade: deposits.length > 0,
    depositVerified: deposits.some(d => d.status === "approved"),
  };
}

export async function suggestRecountFocus(counts: DenominationCounts): Promise<string> {
  const breakdown = calculateDenominations(counts);
  const sorted = [...breakdown.denominations].filter(d => d.value > 0).sort((a, b) => b.value - a.value);

  if (sorted.length === 0) return "Try counting all denominations again.";

  const top = sorted[0];
  const suggestions = [
    `Your ${top.label} count of ${top.count} (${formatCurrency(top.value)}) is the largest amount — try double-checking that one first.`,
  ];

  if (sorted.length > 1) {
    suggestions.push(`Then verify your ${sorted[1].label} (${formatCurrency(sorted[1].value)}).`);
  }

  const twentyVal = breakdown.denominations.find(d => d.name === "twenty");
  if (twentyVal && twentyVal.value > 0 && twentyVal.name !== top.name) {
    suggestions.push(`$20 bills are the most commonly miscounted denomination.`);
  }

  return suggestions.join(" ");
}

export async function analyzeCashPatterns(storeId: string, days: number = 90): Promise<any> {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  const cutoffStr = cutoff.toISOString().split("T")[0];

  const discrepancies = await db.select().from(cashDiscrepancyLog)
    .where(and(
      eq(cashDiscrepancyLog.storeId, storeId),
      gte(cashDiscrepancyLog.sessionDate, cutoffStr),
    ))
    .orderBy(desc(cashDiscrepancyLog.createdAt));

  if (discrepancies.length === 0) {
    return {
      riskScore: 1,
      totalEvents: 0,
      findings: [{ level: "good", title: "No discrepancies found", detail: `No cash discrepancies in the last ${days} days.` }],
      recommendations: ["Keep up the great work!"],
    };
  }

  const byEmployee: Record<string, { count: number; totalAmount: number; shorts: number; overs: number }> = {};
  const byRegister: Record<string, { count: number; totalAmount: number }> = {};
  const byDayOfWeek: Record<string, number> = {};
  const amounts: number[] = [];

  for (const d of discrepancies) {
    const amt = parseFloat(d.amount);
    amounts.push(amt);

    const emp = d.countedBy || "unknown";
    if (!byEmployee[emp]) byEmployee[emp] = { count: 0, totalAmount: 0, shorts: 0, overs: 0 };
    byEmployee[emp].count++;
    byEmployee[emp].totalAmount += amt;
    if (amt < 0) byEmployee[emp].shorts++;
    else byEmployee[emp].overs++;

    if (!byRegister[d.registerName]) byRegister[d.registerName] = { count: 0, totalAmount: 0 };
    byRegister[d.registerName].count++;
    byRegister[d.registerName].totalAmount += amt;

    const dow = new Date(d.sessionDate + "T12:00:00Z").toLocaleDateString("en-US", { weekday: "long" });
    byDayOfWeek[dow] = (byDayOfWeek[dow] || 0) + 1;

    if (d.employeesOnDuty && Array.isArray(d.employeesOnDuty)) {
      for (const onDuty of d.employeesOnDuty as any[]) {
        const dutyId = onDuty.userId;
        if (dutyId && dutyId !== emp) {
          if (!byEmployee[dutyId]) byEmployee[dutyId] = { count: 0, totalAmount: 0, shorts: 0, overs: 0 };
        }
      }
    }
  }

  const totalShort = amounts.filter(a => a < 0).reduce((s, a) => s + a, 0);
  const totalOver = amounts.filter(a => a > 0).reduce((s, a) => s + a, 0);
  const avgDiscrepancy = amounts.reduce((s, a) => s + Math.abs(a), 0) / amounts.length;

  const prompt = `Analyze these cash drawer discrepancy patterns for a retail boutique over the last ${days} days.

DATA:
- Total discrepancy events: ${discrepancies.length}
- Total short: ${formatCurrency(totalShort)}
- Total over: ${formatCurrency(totalOver)}
- Average absolute discrepancy: ${formatCurrency(avgDiscrepancy)}

By employee who counted:
${Object.entries(byEmployee).map(([id, d]) => `  ${id}: ${d.count} events, net ${formatCurrency(d.totalAmount)}, ${d.shorts} shorts, ${d.overs} overs`).join("\n")}

By register:
${Object.entries(byRegister).map(([name, d]) => `  ${name}: ${d.count} events, net ${formatCurrency(d.totalAmount)}`).join("\n")}

By day of week:
${Object.entries(byDayOfWeek).map(([day, count]) => `  ${day}: ${count} events`).join("\n")}

Individual amounts (most recent first): ${amounts.slice(0, 30).map(a => formatCurrency(a)).join(", ")}

Analyze for:
1. Employee patterns (who has the most shortages, is anyone suspicious)
2. Register patterns (hardware issues vs human)
3. Day/time patterns
4. Amount patterns (same amount repeating = very suspicious)
5. Overall trend direction

Respond as JSON:
{
  "riskScore": 1-10,
  "findings": [{"level": "critical|warning|info", "title": "...", "detail": "..."}],
  "recommendations": ["..."],
  "summary": "One paragraph executive summary"
}`;

  try {
    const result = await Promise.race([
      anthropic.messages.create({
        model: MODEL,
        max_tokens: 1000,
        messages: [{ role: "user", content: prompt }],
      }),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("timeout")), 15000)),
    ]);

    const text = result.content[0].type === "text" ? result.content[0].text : "";
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      return {
        ...parsed,
        totalEvents: discrepancies.length,
        totalShort,
        totalOver,
        avgDiscrepancy,
        byEmployee,
        byRegister,
        byDayOfWeek,
      };
    }
  } catch (err: any) {
    logger.warn({ error: err.message }, "[CashManagement] AI pattern analysis failed, using fallback");
  }

  const findings: any[] = [];
  if (Math.abs(totalShort) > 100) findings.push({ level: "warning", title: "Significant total shortage", detail: `${formatCurrency(totalShort)} total short over ${days} days` });
  const topEmployee = Object.entries(byEmployee).sort((a, b) => a[1].totalAmount - b[1].totalAmount)[0];
  if (topEmployee && topEmployee[1].count >= 3) {
    findings.push({ level: "warning", title: "Employee pattern detected", detail: `Employee ${topEmployee[0]} has ${topEmployee[1].count} discrepancy events` });
  }

  return {
    riskScore: Math.min(10, Math.ceil(discrepancies.length / 5)),
    totalEvents: discrepancies.length,
    findings,
    recommendations: ["Review counting procedures with staff", "Consider additional training"],
    totalShort, totalOver, avgDiscrepancy, byEmployee, byRegister, byDayOfWeek,
  };
}

export async function getEmployeeCashProfile(storeId: string, userId: string, days: number = 90) {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  const cutoffStr = cutoff.toISOString().split("T")[0];

  const sessions = await db.select().from(drawerSessions)
    .where(and(
      eq(drawerSessions.storeId, storeId),
      eq(drawerSessions.countedBy, userId),
      gte(drawerSessions.sessionDate, cutoffStr),
    ))
    .orderBy(desc(drawerSessions.sessionDate));

  const discrepancies = await db.select().from(cashDiscrepancyLog)
    .where(and(
      eq(cashDiscrepancyLog.storeId, storeId),
      eq(cashDiscrepancyLog.countedBy, userId),
      gte(cashDiscrepancyLog.sessionDate, cutoffStr),
    ));

  const onDutyDuring = await db.select().from(cashDiscrepancyLog)
    .where(and(
      eq(cashDiscrepancyLog.storeId, storeId),
      gte(cashDiscrepancyLog.sessionDate, cutoffStr),
      sql`${cashDiscrepancyLog.employeesOnDuty}::jsonb @> ${JSON.stringify([{ userId }])}::jsonb`,
    ));

  const totalCounted = sessions.length;
  const discrepancyCount = discrepancies.length;
  const totalOverShort = discrepancies.reduce((sum, d) => sum + parseFloat(d.amount), 0);
  const avgOverShort = discrepancyCount > 0 ? totalOverShort / discrepancyCount : 0;
  const accuracyRate = totalCounted > 0 ? ((totalCounted - discrepancyCount) / totalCounted) * 100 : 100;

  return {
    userId,
    totalCounted,
    discrepancyCount,
    totalOverShort: Math.round(totalOverShort * 100) / 100,
    avgOverShort: Math.round(avgOverShort * 100) / 100,
    accuracyRate: Math.round(accuracyRate * 10) / 10,
    onDutyDuringShortages: onDutyDuring.length,
    recentSessions: sessions.slice(0, 10).map(s => ({
      date: s.sessionDate,
      registerName: s.registerName,
      type: s.sessionType,
      totalCounted: s.totalCashCounted,
      overShort: s.overShortAmount,
    })),
  };
}

function formatCurrency(amount: number): string {
  return `$${Math.abs(amount).toFixed(2)}${amount < 0 ? " short" : amount > 0 ? " over" : ""}`;
}

export interface ReconciliationResult {
  shopifyExpectedCash: number | null;
  physicalCountCash: number | null;
  depositSlipAmount: number | null;
  shopifyVsCountDelta: number | null;
  countVsDepositDelta: number | null;
  shopifyVsDepositDelta: number | null;
  threshold: number;
  hasDiscrepancy: boolean;
  discrepancySources: Array<{ pair: string; delta: number; exceeds: boolean }>;
}

export async function reconcileDrawer(
  drawerSessionId: string,
  depositId: string,
  storeId: string,
): Promise<ReconciliationResult> {
  const [settings] = await db.select().from(cashManagementSettings)
    .where(eq(cashManagementSettings.storeId, storeId));
  const threshold = parseFloat(settings?.overShortThreshold || "5.00");

  const [session] = await db.select().from(drawerSessions)
    .where(and(eq(drawerSessions.id, drawerSessionId), eq(drawerSessions.storeId, storeId)));

  if (!session) {
    throw new Error(`Drawer session ${drawerSessionId} not found for store ${storeId}`);
  }

  const [deposit] = await db.select().from(cashDeposits)
    .where(and(eq(cashDeposits.id, depositId), eq(cashDeposits.storeId, storeId)));

  if (!deposit) {
    throw new Error(`Deposit ${depositId} not found for store ${storeId}`);
  }

  const physicalCountCash = session?.totalCashCounted
    ? parseFloat(session.totalCashCounted)
    : null;

  // Prefer Shopify's authoritative expectedClosingCash; fall back to drawerSession.expectedCash
  let shopifyExpectedCash: number | null = null;
  if (session) {
    const [shopifySession] = await db.select().from(shopifyRegisterSessions)
      .where(and(
        eq(shopifyRegisterSessions.storeId, storeId),
        eq(shopifyRegisterSessions.sessionDate, session.sessionDate),
        eq(shopifyRegisterSessions.registerName, session.registerName),
      ));
    if (shopifySession?.expectedClosingCash != null) {
      shopifyExpectedCash = parseFloat(shopifySession.expectedClosingCash);
    } else if (session.expectedCash != null) {
      shopifyExpectedCash = parseFloat(session.expectedCash);
    }
  }

  const depositSlipAmount = deposit?.aiExtractedAmount
    ? parseFloat(deposit.aiExtractedAmount)
    : null;

  const shopifyVsCountDelta =
    shopifyExpectedCash != null && physicalCountCash != null
      ? Math.round((physicalCountCash - shopifyExpectedCash) * 100) / 100
      : null;

  const countVsDepositDelta =
    physicalCountCash != null && depositSlipAmount != null
      ? Math.round((depositSlipAmount - physicalCountCash + parseFloat(session?.startingCash || "200")) * 100) / 100
      : null;

  const shopifyVsDepositDelta =
    shopifyExpectedCash != null && depositSlipAmount != null
      ? Math.round((depositSlipAmount - (shopifyExpectedCash - parseFloat(session?.startingCash || "200"))) * 100) / 100
      : null;

  const discrepancySources: Array<{ pair: string; delta: number; exceeds: boolean }> = [];
  if (shopifyVsCountDelta != null && Math.abs(shopifyVsCountDelta) > 0.005) {
    discrepancySources.push({ pair: "shopify_vs_count", delta: shopifyVsCountDelta, exceeds: Math.abs(shopifyVsCountDelta) > threshold });
  }
  if (countVsDepositDelta != null && Math.abs(countVsDepositDelta) > 0.005) {
    discrepancySources.push({ pair: "count_vs_deposit", delta: countVsDepositDelta, exceeds: Math.abs(countVsDepositDelta) > threshold });
  }
  if (shopifyVsDepositDelta != null && Math.abs(shopifyVsDepositDelta) > 0.005) {
    discrepancySources.push({ pair: "shopify_vs_deposit", delta: shopifyVsDepositDelta, exceeds: Math.abs(shopifyVsDepositDelta) > threshold });
  }

  const hasDiscrepancy = discrepancySources.some(s => s.exceeds);
  const reconStatus = hasDiscrepancy ? "discrepancy" : discrepancySources.length > 0 ? "within_tolerance" : "matched";

  await db.update(cashDeposits).set({
    shopifyExpectedCash: shopifyExpectedCash?.toFixed(2) ?? null,
    physicalCountCash: physicalCountCash?.toFixed(2) ?? null,
    shopifyVsCountDelta: shopifyVsCountDelta?.toFixed(2) ?? null,
    countVsDepositDelta: countVsDepositDelta?.toFixed(2) ?? null,
    shopifyVsDepositDelta: shopifyVsDepositDelta?.toFixed(2) ?? null,
    reconciliationStatus: reconStatus,
  }).where(eq(cashDeposits.id, depositId));

  if (hasDiscrepancy && session) {
    const largestDelta = discrepancySources.filter(s => s.exceeds).reduce((max, s) => Math.abs(s.delta) > Math.abs(max.delta) ? s : max, discrepancySources[0]);

    await db.insert(cashDiscrepancyLog).values({
      storeId,
      drawerSessionId: session.id,
      depositId,
      sessionDate: session.sessionDate,
      registerName: session.registerName,
      sessionType: "reconciliation",
      countedBy: session.countedBy || null,
      amount: String(largestDelta.delta),
      explanation: `Reconciliation: ${discrepancySources.map(s => `${s.pair}=${s.delta >= 0 ? "+" : ""}${s.delta.toFixed(2)}`).join(", ")}`,
      employeesOnDuty: session.employeesOnDuty || [],
      discrepancySources: discrepancySources,
    });

    try {
      const ownerAdminRoles = await db.select({ id: roles.id }).from(roles)
        .where(inArray(roles.name, ["owner", "admin"]));
      if (ownerAdminRoles.length > 0) {
        const roleIds = ownerAdminRoles.map(r => r.id);
        const adminUsers = await db.select({ id: users.id }).from(users)
          .where(and(
            inArray(users.roleId, roleIds),
            eq(users.isActive, true),
            eq(users.locationId, storeId),
          ));

        const notifBody = [
          shopifyVsCountDelta != null ? `Shopify vs Count: ${shopifyVsCountDelta >= 0 ? "+" : ""}$${Math.abs(shopifyVsCountDelta).toFixed(2)}` : null,
          countVsDepositDelta != null ? `Count vs Deposit: ${countVsDepositDelta >= 0 ? "+" : ""}$${Math.abs(countVsDepositDelta).toFixed(2)}` : null,
          shopifyVsDepositDelta != null ? `Shopify vs Deposit: ${shopifyVsDepositDelta >= 0 ? "+" : ""}$${Math.abs(shopifyVsDepositDelta).toFixed(2)}` : null,
        ].filter(Boolean).join(" | ");

        for (const admin of adminUsers) {
          await notificationService.sendToUserWithResult(admin.id, {
            title: `Cash Discrepancy: ${session.registerName}`,
            body: notifBody || "A discrepancy was found during reconciliation.",
            notificationType: "cash_reconciliation_alert",
            data: {
              type: "cash_reconciliation_alert",
              drawerSessionId: session.id,
              depositId,
              registerName: session.registerName,
              sessionDate: session.sessionDate,
              url: "/cash",
            },
          });
        }
      }
    } catch (notifErr: any) {
      logger.warn({ error: notifErr.message }, "[Reconcile] Push notification send failed (non-fatal)");
    }

    try {
      await sendReconciliationAlertEmail({
        registerName: session.registerName,
        sessionDate: session.sessionDate,
        shopifyExpected: shopifyExpectedCash,
        physicalCount: physicalCountCash,
        depositSlipAmount,
        shopifyVsCountDelta,
        countVsDepositDelta,
        shopifyVsDepositDelta,
        threshold,
        storeId,
      });
    } catch (emailErr: any) {
      logger.warn({ error: emailErr.message }, "[Reconcile] Email alert send failed (non-fatal)");
    }
  }

  logger.info({
    drawerSessionId,
    depositId,
    shopifyExpectedCash,
    physicalCountCash,
    depositSlipAmount,
    shopifyVsCountDelta,
    countVsDepositDelta,
    hasDiscrepancy,
  }, "[Reconcile] Drawer reconciliation complete");

  return {
    shopifyExpectedCash,
    physicalCountCash,
    depositSlipAmount,
    shopifyVsCountDelta,
    countVsDepositDelta,
    shopifyVsDepositDelta,
    threshold,
    hasDiscrepancy,
    discrepancySources,
  };
}
