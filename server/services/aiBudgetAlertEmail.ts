import sgMail from "@sendgrid/mail";
import { db } from "../db";
import { users, roles } from "@shared/schema";
import type { AiBudget } from "@shared/schema";
import { and, eq, inArray, isNotNull } from "drizzle-orm";
import logger from "../lib/logger";

function resolveAppUrl(): string {
  const replitDomains = process.env.REPLIT_DOMAINS;
  if (replitDomains) {
    return `https://${replitDomains.split(",")[0].trim()}`;
  }
  return "http://localhost:5000";
}

const FROM_EMAIL = process.env.SENDGRID_FROM_EMAIL || "noreply@taime.app";
const FROM_NAME = "Taime AI Spend Alerts";

if (process.env.SENDGRID_API_KEY) {
  sgMail.setApiKey(process.env.SENDGRID_API_KEY);
}

async function getRecipientEmails(scope: "global" | "store", storeId: string | null): Promise<string[]> {
  // Owner + admin role names trigger an alert. (Per the user's spec.)
  const ownerAdminRoles = await db
    .select({ id: roles.id })
    .from(roles)
    .where(inArray(roles.name, ["owner", "admin"]));
  if (ownerAdminRoles.length === 0) return [];
  const roleIds = ownerAdminRoles.map((r) => r.id);

  const userConds = [inArray(users.roleId, roleIds), isNotNull(users.email), eq(users.isActive, true)];
  if (scope === "store" && storeId) {
    userConds.push(eq(users.locationId, storeId));
  }
  const userRows = await db
    .select({ email: users.email })
    .from(users)
    .where(and(...userConds));
  return userRows.map((u) => u.email!).filter((e): e is string => !!e);
}

export async function sendBudgetAlertEmail(
  budget: AiBudget,
  thresholdPercent: number,
  spendUsd: number,
  limitUsd: number,
  periodKey: string,
): Promise<void> {
  if (!process.env.SENDGRID_API_KEY) {
    logger.warn("SENDGRID_API_KEY not set — skipping AI budget alert email");
    return;
  }
  const recipients = await getRecipientEmails(budget.scope as "global" | "store", budget.storeId);
  if (recipients.length === 0) {
    logger.warn({ budgetId: budget.id }, "AI budget alert: no owner/admin recipients");
    return;
  }

  const isHardLimit = thresholdPercent >= 100;
  const scopeLabel = budget.scope === "global" ? "Global" : `Store ${budget.storeId}`;
  const subject = isHardLimit
    ? `[Taime] AI budget reached: ${scopeLabel} hit 100% — calls now blocked`
    : `[Taime] AI budget warning: ${scopeLabel} at ${Math.round((spendUsd / limitUsd) * 100)}%`;

  const appUrl = resolveAppUrl();
  const adminUrl = `${appUrl}/admin/ai-spend`;

  const headlineColor = isHardLimit ? "#dc2626" : "#f59e0b";
  const headline = isHardLimit
    ? "AI budget reached 100% — new AI calls are blocked"
    : `AI budget reached ${thresholdPercent}%`;
  const body = isHardLimit
    ? `Your ${budget.scope} AI budget for ${periodKey} has been fully spent. New AI calls are now being rejected with a "budget exceeded" error until the next billing period or until you raise the budget.`
    : `Your ${budget.scope} AI budget for ${periodKey} has crossed the ${thresholdPercent}% warning threshold. Calls will continue to run until you reach 100%, at which point they will be blocked automatically.`;

  const html = `
    <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#0f172a;">
      <div style="border-left:4px solid ${headlineColor};padding-left:16px;margin-bottom:24px;">
        <h2 style="margin:0 0 8px 0;color:${headlineColor};">${headline}</h2>
        <p style="margin:0;color:#475569;font-size:14px;">${body}</p>
      </div>
      <table style="width:100%;border-collapse:collapse;font-size:14px;margin-bottom:24px;">
        <tr><td style="padding:8px 0;color:#64748b;">Scope</td><td style="padding:8px 0;text-align:right;">${scopeLabel}</td></tr>
        <tr><td style="padding:8px 0;color:#64748b;">Period</td><td style="padding:8px 0;text-align:right;">${periodKey}</td></tr>
        <tr><td style="padding:8px 0;color:#64748b;">Month-to-date spend</td><td style="padding:8px 0;text-align:right;font-weight:600;">$${spendUsd.toFixed(2)}</td></tr>
        <tr><td style="padding:8px 0;color:#64748b;">Monthly limit</td><td style="padding:8px 0;text-align:right;">$${limitUsd.toFixed(2)}</td></tr>
      </table>
      <a href="${adminUrl}" style="display:inline-block;background:#6366f1;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:600;">Open AI Spend dashboard</a>
      <p style="color:#94a3b8;font-size:12px;margin-top:32px;">You're receiving this because you're an owner or admin on Taime. Manage AI budgets at ${adminUrl}.</p>
    </div>
  `;

  try {
    await sgMail.send({
      to: recipients,
      from: { email: FROM_EMAIL, name: FROM_NAME },
      subject,
      html,
      text: `${headline}\n\n${body}\n\nMTD: $${spendUsd.toFixed(2)} of $${limitUsd.toFixed(2)}\nManage budgets: ${adminUrl}`,
    });
    logger.info(
      { budgetId: budget.id, threshold: thresholdPercent, recipients: recipients.length },
      "AI budget alert email sent",
    );
  } catch (err) {
    logger.error({ err, budgetId: budget.id }, "AI budget alert email send failed");
  }
}
