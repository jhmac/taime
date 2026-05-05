import { sendViaNylas } from "./emailService";
import { db } from "../db";
import { users, roles } from "@shared/schema";
import { and, eq, inArray, isNotNull } from "drizzle-orm";
import logger from "../lib/logger";
import { config } from "../lib/config";

function resolveAppUrl(): string {
  const replitDomains = process.env.REPLIT_DOMAINS;
  if (replitDomains) return `https://${replitDomains.split(",")[0].trim()}`;
  return "http://localhost:5000";
}

async function getAdminOwnerEmails(storeId: string): Promise<string[]> {
  const ownerAdminRoles = await db
    .select({ id: roles.id })
    .from(roles)
    .where(inArray(roles.name, ["owner", "admin"]));
  if (ownerAdminRoles.length === 0) return [];
  const roleIds = ownerAdminRoles.map((r) => r.id);
  const userRows = await db
    .select({ email: users.email })
    .from(users)
    .where(and(
      inArray(users.roleId, roleIds),
      isNotNull(users.email),
      eq(users.isActive, true),
      eq(users.locationId, storeId),
    ));
  return userRows.map((u) => u.email!).filter((e): e is string => !!e);
}

export interface ReconciliationEmailParams {
  registerName: string;
  sessionDate: string;
  shopifyExpected: number | null;
  physicalCount: number | null;
  depositSlipAmount: number | null;
  shopifyVsCountDelta: number | null;
  countVsDepositDelta: number | null;
  shopifyVsDepositDelta: number | null;
  threshold: number;
  storeId: string;
}

function fmt(n: number | null): string {
  if (n == null) return "—";
  return `$${Math.abs(n).toFixed(2)}`;
}

function deltaLabel(delta: number | null): string {
  if (delta == null) return "—";
  if (Math.abs(delta) < 0.01) return "Exact match";
  return delta > 0 ? `+$${delta.toFixed(2)} over` : `-$${Math.abs(delta).toFixed(2)} short`;
}

function deltaColor(delta: number | null, threshold: number): string {
  if (delta == null) return "#64748b";
  if (Math.abs(delta) < 0.01) return "#16a34a";
  if (Math.abs(delta) <= threshold) return "#d97706";
  return "#dc2626";
}

export async function sendReconciliationAlertEmail(params: ReconciliationEmailParams): Promise<void> {
  if (!config.nylas.apiKey || !config.nylas.grantId) {
    logger.warn("Nylas not configured — skipping reconciliation alert email");
    return;
  }
  const recipients = await getAdminOwnerEmails(params.storeId);
  if (recipients.length === 0) {
    logger.warn({ storeId: params.storeId }, "Reconciliation alert: no owner/admin recipients found");
    return;
  }

  const appUrl = resolveAppUrl();
  const subject = `[Taime] Cash Discrepancy — ${params.registerName} on ${params.sessionDate}`;

  const svcd = deltaColor(params.shopifyVsCountDelta, params.threshold);
  const cvdd = deltaColor(params.countVsDepositDelta, params.threshold);

  const html = `
    <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:580px;margin:0 auto;padding:24px;color:#0f172a;">
      <div style="border-left:4px solid #dc2626;padding-left:16px;margin-bottom:24px;">
        <h2 style="margin:0 0 8px 0;color:#dc2626;">Cash Reconciliation Discrepancy</h2>
        <p style="margin:0;color:#475569;font-size:14px;">
          A discrepancy was detected for <strong>${params.registerName}</strong> on ${params.sessionDate}.
          One or more sources deviate by more than the configured tolerance ($${params.threshold.toFixed(2)}).
        </p>
      </div>

      <table style="width:100%;border-collapse:collapse;font-size:14px;margin-bottom:24px;">
        <thead>
          <tr style="background:#f8fafc;">
            <th style="padding:10px 8px;text-align:left;border-bottom:1px solid #e2e8f0;color:#64748b;font-weight:500;">Source</th>
            <th style="padding:10px 8px;text-align:right;border-bottom:1px solid #e2e8f0;color:#64748b;font-weight:500;">Amount</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td style="padding:10px 8px;border-bottom:1px solid #f1f5f9;">Shopify Expected</td>
            <td style="padding:10px 8px;text-align:right;font-weight:600;border-bottom:1px solid #f1f5f9;">${fmt(params.shopifyExpected)}</td>
          </tr>
          <tr>
            <td style="padding:10px 8px;border-bottom:1px solid #f1f5f9;">Physical Count</td>
            <td style="padding:10px 8px;text-align:right;font-weight:600;border-bottom:1px solid #f1f5f9;">${fmt(params.physicalCount)}</td>
          </tr>
          <tr>
            <td style="padding:10px 8px;">Deposit Slip (AI)</td>
            <td style="padding:10px 8px;text-align:right;font-weight:600;">${fmt(params.depositSlipAmount)}</td>
          </tr>
        </tbody>
      </table>

      <table style="width:100%;border-collapse:collapse;font-size:14px;margin-bottom:24px;">
        <thead>
          <tr style="background:#f8fafc;">
            <th style="padding:10px 8px;text-align:left;border-bottom:1px solid #e2e8f0;color:#64748b;font-weight:500;">Comparison</th>
            <th style="padding:10px 8px;text-align:right;border-bottom:1px solid #e2e8f0;color:#64748b;font-weight:500;">Variance</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td style="padding:10px 8px;border-bottom:1px solid #f1f5f9;">Shopify vs Physical Count</td>
            <td style="padding:10px 8px;text-align:right;font-weight:600;color:${svcd};border-bottom:1px solid #f1f5f9;">${deltaLabel(params.shopifyVsCountDelta)}</td>
          </tr>
          <tr>
            <td style="padding:10px 8px;border-bottom:1px solid #f1f5f9;">Physical Count vs Deposit Slip</td>
            <td style="padding:10px 8px;text-align:right;font-weight:600;color:${cvdd};border-bottom:1px solid #f1f5f9;">${deltaLabel(params.countVsDepositDelta)}</td>
          </tr>
          <tr>
            <td style="padding:10px 8px;">Shopify vs Deposit Slip</td>
            <td style="padding:10px 8px;text-align:right;font-weight:600;color:${deltaColor(params.shopifyVsDepositDelta, params.threshold)};">${deltaLabel(params.shopifyVsDepositDelta)}</td>
          </tr>
        </tbody>
      </table>

      <a href="${appUrl}/cash" style="display:inline-block;background:#6366f1;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:600;">Open Cash Management</a>
      <p style="color:#94a3b8;font-size:12px;margin-top:32px;">You're receiving this because you're an owner or admin on Taime. Threshold: $${params.threshold.toFixed(2)}.</p>
    </div>
  `;

  try {
    for (const recipient of recipients) {
      await sendViaNylas({ to: recipient, subject, body: html });
    }
    logger.info({ registerName: params.registerName, recipients: recipients.length }, "Reconciliation alert email sent");
  } catch (err) {
    logger.error({ err }, "Reconciliation alert email send failed");
  }
}
