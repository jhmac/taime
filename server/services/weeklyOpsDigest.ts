import sgMail from "@sendgrid/mail";
import { db } from "../db";
import { eq, and, gte, desc } from "drizzle-orm";
import { operationalInsights, workLocations } from "@shared/schema";
import logger from "../lib/logger";
import { getOwnerAndManagerEmailsForStore } from "./insightGenerator";
import { aggregateOperations } from "./operationsIntelligence";

interface DigestData {
  storeName: string;
  topInsights: Array<{
    severity: string;
    insightType: string;
    affectedArea: string;
    observation: string;
    whyItMatters: string | null;
    recommendedAction: string;
    actedOn: boolean;
  }>;
  actedOnCount: number;
  dismissedCount: number;
  pendingTaskCount: number;
  openIssueCount: number;
  upcomingShifts: number;
  windowLabel: string;
}

async function buildDigestForStore(storeId: string): Promise<DigestData | null> {
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  const [storeRow, allRecentInsights] = await Promise.all([
    db.select({ name: workLocations.name }).from(workLocations).where(eq(workLocations.id, storeId)).limit(1),
    db.select().from(operationalInsights)
      .where(and(
        eq(operationalInsights.storeId, storeId),
        gte(operationalInsights.createdAt, sevenDaysAgo),
      ))
      .orderBy(desc(operationalInsights.createdAt)),
  ]);

  if (!storeRow[0]) return null;

  const active = allRecentInsights.filter(i => i.status === "active");
  const actedOn = allRecentInsights.filter(i => i.status === "acted_on");
  const dismissed = allRecentInsights.filter(i => i.status === "dismissed");

  // Pick top 5 by severity rank
  const sevRank: Record<string, number> = { action_needed: 1, warning: 2, suggestion: 3, info: 4 };
  const top5 = [...active]
    .sort((a, b) => (sevRank[a.severity] || 5) - (sevRank[b.severity] || 5))
    .slice(0, 5)
    .map(i => ({
      severity: i.severity,
      insightType: i.insightType,
      affectedArea: i.affectedArea,
      observation: i.observation,
      whyItMatters: i.whyItMatters,
      recommendedAction: i.recommendedAction,
      actedOn: false,
    }));

  // If we have fewer than 5 active, top up with notable acted-on items (positive signal)
  if (top5.length < 5) {
    const fill = actedOn.slice(0, 5 - top5.length).map(i => ({
      severity: i.severity,
      insightType: i.insightType,
      affectedArea: i.affectedArea,
      observation: i.observation,
      whyItMatters: i.whyItMatters,
      recommendedAction: i.recommendedAction,
      actedOn: true,
    }));
    top5.push(...fill);
  }

  const sevenDayWindow = {
    start: sevenDaysAgo,
    end: new Date(),
    label: "the past 7 days",
  };
  const agg = await aggregateOperations(storeId, sevenDayWindow);
  const upcomingStart = new Date();
  const upcomingEnd = new Date();
  upcomingEnd.setDate(upcomingEnd.getDate() + 7);
  const { schedules } = await import("@shared/schema");
  const { count } = await import("drizzle-orm");
  const { sql } = await import("drizzle-orm");
  const upcomingShifts = await db.select({ c: count() }).from(schedules)
    .where(and(
      eq(schedules.locationId, storeId),
      sql`${schedules.startTime} >= ${upcomingStart}`,
      sql`${schedules.startTime} <= ${upcomingEnd}`,
    ))
    .then(r => r[0]?.c || 0)
    .catch(() => 0);

  return {
    storeName: storeRow[0].name || "Your Store",
    topInsights: top5,
    actedOnCount: actedOn.length,
    dismissedCount: dismissed.length,
    pendingTaskCount: agg.tasks.pending,
    openIssueCount: agg.issues.open,
    upcomingShifts: Number(upcomingShifts),
    windowLabel: "the past 7 days",
  };
}

function severityBadge(severity: string): { label: string; color: string; bg: string } {
  switch (severity) {
    case "action_needed":
      return { label: "Action Needed", color: "#991b1b", bg: "#fee2e2" };
    case "warning":
      return { label: "Warning", color: "#92400e", bg: "#fef3c7" };
    case "suggestion":
      return { label: "Suggestion", color: "#1e40af", bg: "#dbeafe" };
    default:
      return { label: "Info", color: "#374151", bg: "#f3f4f6" };
  }
}

function buildDigestEmailHtml(firstName: string, data: DigestData, appUrl: string): string {
  const insightsHtml = data.topInsights.length === 0
    ? `<p style="color:#666;font-size:14px;text-align:center;padding:24px;">No active insights this week — operations look healthy. Great work!</p>`
    : data.topInsights.map((insight, idx) => {
        const badge = severityBadge(insight.severity);
        const actedTag = insight.actedOn
          ? `<span style="display:inline-block;background:#d1fae5;color:#065f46;font-size:11px;padding:2px 8px;border-radius:10px;margin-left:8px;">Acted on this week</span>`
          : "";
        return `
          <div style="border-left:3px solid ${badge.color};padding:14px 16px;margin-bottom:14px;background:#fafafa;border-radius:4px;">
            <div style="margin-bottom:6px;">
              <span style="display:inline-block;background:${badge.bg};color:${badge.color};font-size:11px;font-weight:600;padding:2px 8px;border-radius:10px;text-transform:uppercase;letter-spacing:0.5px;">${badge.label}</span>
              <span style="color:#666;font-size:11px;margin-left:6px;text-transform:uppercase;">${insight.affectedArea}</span>${actedTag}
            </div>
            <p style="color:#1a1a2e;font-size:14px;font-weight:600;margin:0 0 6px 0;line-height:1.4;">${idx + 1}. ${insight.observation}</p>
            ${insight.whyItMatters ? `<p style="color:#555;font-size:13px;margin:0 0 6px 0;line-height:1.5;font-style:italic;"><strong>Why it matters:</strong> ${insight.whyItMatters}</p>` : ""}
            <p style="color:#555;font-size:13px;margin:0;line-height:1.5;"><strong>Recommended:</strong> ${insight.recommendedAction}</p>
          </div>`;
      }).join("");

  const insightsUrl = `${appUrl}/dashboard?tab=ai-insights`;

  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8" /><meta name="viewport" content="width=device-width,initial-scale=1.0" /><title>Weekly Operations Digest</title></head>
<body style="margin:0;padding:0;background:#f4f4f8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f8;padding:32px 16px;">
    <tr><td align="center">
      <table width="100%" cellpadding="0" cellspacing="0" style="max-width:620px;">
        <tr><td style="padding:0 0 20px 0;text-align:center;">
          <div style="display:inline-block;background:linear-gradient(135deg,#6c63ff,#9b8fff);border-radius:14px;padding:12px 22px;">
            <span style="color:#fff;font-size:20px;font-weight:800;letter-spacing:-0.5px;">MAinager</span>
          </div>
          <p style="color:#888;font-size:11px;margin:6px 0 0 0;letter-spacing:1px;text-transform:uppercase;">Weekly Operations Digest</p>
        </td></tr>
        <tr><td style="background:#fff;border-radius:18px;padding:32px 32px 28px;box-shadow:0 4px 20px rgba(108,99,255,0.08);">
          <h1 style="color:#1a1a2e;font-size:22px;font-weight:700;margin:0 0 6px 0;">Hi ${firstName || "there"},</h1>
          <p style="color:#555;font-size:15px;line-height:1.5;margin:0 0 20px 0;">
            Here's what MAinager noticed about ${data.storeName} over ${data.windowLabel}.
          </p>

          <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
            <tr>
              <td width="33%" style="padding:12px;background:#f9fafb;border-radius:8px;text-align:center;">
                <div style="color:#6c63ff;font-size:24px;font-weight:700;">${data.topInsights.length}</div>
                <div style="color:#666;font-size:11px;text-transform:uppercase;letter-spacing:0.5px;">Top Insights</div>
              </td>
              <td width="2%"></td>
              <td width="33%" style="padding:12px;background:#f9fafb;border-radius:8px;text-align:center;">
                <div style="color:#10b981;font-size:24px;font-weight:700;">${data.actedOnCount}</div>
                <div style="color:#666;font-size:11px;text-transform:uppercase;letter-spacing:0.5px;">Acted On</div>
              </td>
              <td width="2%"></td>
              <td width="33%" style="padding:12px;background:#f9fafb;border-radius:8px;text-align:center;">
                <div style="color:#f59e0b;font-size:24px;font-weight:700;">${data.openIssueCount}</div>
                <div style="color:#666;font-size:11px;text-transform:uppercase;letter-spacing:0.5px;">Open Issues</div>
              </td>
            </tr>
          </table>

          <h2 style="color:#1a1a2e;font-size:16px;font-weight:700;margin:0 0 12px 0;">Top observations</h2>
          ${insightsHtml}

          <div style="background:#f3f4f6;border-radius:10px;padding:16px;margin-top:20px;">
            <p style="color:#555;font-size:13px;margin:0 0 4px 0;line-height:1.5;">
              <strong style="color:#1a1a2e;">Looking ahead:</strong> ${data.upcomingShifts} shifts scheduled for next week, ${data.pendingTaskCount} pending tasks on the board.
            </p>
          </div>

          <div style="text-align:center;margin-top:24px;">
            <a href="${insightsUrl}" style="display:inline-block;background:linear-gradient(135deg,#6c63ff,#9b8fff);color:#fff;padding:13px 32px;border-radius:10px;text-decoration:none;font-size:14px;font-weight:700;box-shadow:0 4px 12px rgba(108,99,255,0.3);">
              View All Insights &rarr;
            </a>
          </div>
        </td></tr>
        <tr><td style="padding:18px 0 0 0;text-align:center;">
          <p style="color:#aaa;font-size:11px;margin:0;line-height:1.6;">
            You receive this because you're an owner of ${data.storeName} on MAinager.
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}

export async function sendWeeklyOpsDigest(): Promise<{ sent: number; skipped: number }> {
  const sendgridKey = process.env.SENDGRID_API_KEY;
  if (!sendgridKey) {
    logger.info("[WeeklyOpsDigest] SENDGRID_API_KEY not set — skipping digest");
    return { sent: 0, skipped: 0 };
  }
  sgMail.setApiKey(sendgridKey);

  const stores = await db.select({ id: workLocations.id }).from(workLocations).where(eq(workLocations.isActive, true));
  if (stores.length === 0) return { sent: 0, skipped: 0 };

  // Build per-store digest content (small installs typically have one store)
  const fromEmail = process.env.SENDGRID_FROM_EMAIL || "noreply@taime.app";
  const appUrl = process.env.APP_URL || process.env.PUBLIC_APP_URL || "https://app.taime.app";

  let sent = 0;
  let skipped = 0;

  for (const store of stores) {
    try {
      // CRITICAL: resolve recipients PER STORE so a store's operational
      // insights only reach people with an explicit membership relation to
      // that store. Cross-store leakage of insight content is a data-
      // exposure bug; do not change this to a global recipient list.
      const owners = await getOwnerAndManagerEmailsForStore(store.id);
      if (owners.length === 0) {
        skipped++;
        logger.info({ storeId: store.id }, "[WeeklyOpsDigest] No owner/manager recipients for store");
        continue;
      }

      const data = await buildDigestForStore(store.id);
      if (!data || data.topInsights.length === 0) {
        skipped++;
        logger.info({ storeId: store.id }, "[WeeklyOpsDigest] No insights to send for store");
        continue;
      }

      for (const owner of owners) {
        try {
          const html = buildDigestEmailHtml(owner.firstName || "", data, appUrl);
          await sgMail.send({
            to: owner.email,
            from: fromEmail,
            subject: `MAinager weekly digest — ${data.topInsights.length} insight${data.topInsights.length === 1 ? "" : "s"} for ${data.storeName}`,
            html,
          });
          sent++;
        } catch (sendErr: any) {
          logger.warn({ error: sendErr.message, email: owner.email }, "[WeeklyOpsDigest] Email send failed");
        }
      }
    } catch (err: any) {
      logger.error({ error: err.message, storeId: store.id }, "[WeeklyOpsDigest] Build digest failed");
    }
  }

  logger.info({ sent, skipped }, "[WeeklyOpsDigest] Weekly digest run complete");
  return { sent, skipped };
}

let cronTimer: ReturnType<typeof setInterval> | null = null;
let lastSentDate = "";

export function startWeeklyOpsDigestCron() {
  cronTimer = setInterval(async () => {
    try {
      const now = new Date();
      const todayStr = now.toISOString().slice(0, 10);
      const dayOfWeek = now.getDay(); // 0 = Sunday
      const hour = now.getHours();

      // Sunday between 17:00 and 19:00, once per week
      if (dayOfWeek !== 0) return;
      if (hour < 17 || hour >= 19) return;
      if (lastSentDate === todayStr) return;
      lastSentDate = todayStr;

      logger.info("[WeeklyOpsDigest] Triggering Sunday evening digest");
      await sendWeeklyOpsDigest();
    } catch (err: any) {
      logger.error({ error: err.message }, "[WeeklyOpsDigest] Cron error");
    }
  }, 15 * 60 * 1000);

  logger.info("[WeeklyOpsDigest] Cron started (checks every 15 minutes, sends Sundays 17:00-19:00)");
}

export function stopWeeklyOpsDigestCron() {
  if (cronTimer) {
    clearInterval(cronTimer);
    cronTimer = null;
  }
}
