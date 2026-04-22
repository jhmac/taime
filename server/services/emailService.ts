import Nylas from "nylas";
import sgMail from "@sendgrid/mail";
import { config } from "../lib/config";

const nylas = new Nylas({
  apiKey: config.nylas.apiKey,
  apiUri: "https://api.us.nylas.com",
});

const grantId = config.nylas.grantId;

function getAppUrl(req: { headers: Record<string, string | undefined> }): string {
  if (config.server.appUrl) {
    return config.server.appUrl.replace(/\/$/, "");
  }
  const replitDomains = process.env.REPLIT_DOMAINS;
  if (replitDomains) {
    const primaryDomain = replitDomains.split(",")[0].trim();
    return `https://${primaryDomain}`;
  }
  const host = req.headers["host"] || "localhost:5000";
  const protocol = host.includes(".replit.app") || host.includes(".repl.co") ? "https" : "http";
  return `${protocol}://${host}`;
}

/**
 * Resolve the public-facing app URL without a request object.
 * Prefers explicit config, then REPLIT_DOMAINS, then falls back to localhost.
 */
export function resolveAppUrl(host?: string): string {
  if (config.server.appUrl) {
    return config.server.appUrl.replace(/\/$/, "");
  }
  const replitDomains = process.env.REPLIT_DOMAINS;
  if (replitDomains) {
    const primaryDomain = replitDomains.split(",")[0].trim();
    return `https://${primaryDomain}`;
  }
  const h = host || "localhost:5000";
  const protocol = h.includes(".replit.app") || h.includes(".repl.co") ? "https" : "http";
  return `${protocol}://${h}`;
}

export async function sendTeamInviteEmail(
  req: { headers: Record<string, string | undefined> },
  recipientEmail: string,
  recipientName: string,
  inviterName: string,
  companyName: string,
  inviteToken?: string | null,
  roleName?: string | null,
): Promise<boolean> {
  try {
    const appUrl = getAppUrl(req);
    const displayName = recipientName.trim() || recipientEmail;
    const firstName = displayName.split(" ")[0] || displayName;

    const inviteUrl = inviteToken ? `${appUrl}/join/${inviteToken}` : appUrl;

    const roleText = roleName ? `<p style="color:#6c63ff;font-size:14px;font-weight:600;margin:0 0 20px 0;letter-spacing:0.3px;">Your role: ${roleName}</p>` : "";

    const featuresHtml = `
      <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
        <tr>
          <td width="33%" style="padding:0 8px 0 0;vertical-align:top;">
            <div style="background:#f0eeff;border-radius:10px;padding:14px 12px;text-align:center;">
              <div style="font-size:20px;margin-bottom:6px;">⏰</div>
              <p style="color:#1a1a2e;font-size:12px;font-weight:600;margin:0;">Time Tracking</p>
              <p style="color:#666;font-size:11px;margin:4px 0 0 0;line-height:1.4;">Clock in & out from anywhere</p>
            </div>
          </td>
          <td width="33%" style="padding:0 4px;vertical-align:top;">
            <div style="background:#f0eeff;border-radius:10px;padding:14px 12px;text-align:center;">
              <div style="font-size:20px;margin-bottom:6px;">📅</div>
              <p style="color:#1a1a2e;font-size:12px;font-weight:600;margin:0;">Schedules</p>
              <p style="color:#666;font-size:11px;margin:4px 0 0 0;line-height:1.4;">View shifts & availability</p>
            </div>
          </td>
          <td width="33%" style="padding:0 0 0 8px;vertical-align:top;">
            <div style="background:#f0eeff;border-radius:10px;padding:14px 12px;text-align:center;">
              <div style="font-size:20px;margin-bottom:6px;">✅</div>
              <p style="color:#1a1a2e;font-size:12px;font-weight:600;margin:0;">Tasks & SOPs</p>
              <p style="color:#666;font-size:11px;margin:4px 0 0 0;line-height:1.4;">Stay on top of your work</p>
            </div>
          </td>
        </tr>
      </table>
    `;

    const htmlBody = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>You're invited to join ${companyName}</title>
</head>
<body style="margin:0;padding:0;background-color:#f4f4f8;font-family:'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f4f8;padding:40px 16px;">
    <tr>
      <td align="center">
        <table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;">

          <!-- Header -->
          <tr>
            <td style="padding:0 0 24px 0;text-align:center;">
              <div style="display:inline-block;background:linear-gradient(135deg,#6c63ff,#9b8fff);border-radius:16px;padding:14px 24px;">
                <span style="color:#ffffff;font-size:22px;font-weight:800;letter-spacing:-0.5px;">Taime</span>
              </div>
              <p style="color:#888;font-size:12px;margin:8px 0 0 0;letter-spacing:1px;text-transform:uppercase;">AI Boutique Manager</p>
            </td>
          </tr>

          <!-- Main card -->
          <tr>
            <td style="background:#ffffff;border-radius:20px;padding:36px 36px 32px 36px;box-shadow:0 4px 24px rgba(108,99,255,0.08);">

              <!-- Inviter avatar -->
              <div style="text-align:center;margin-bottom:24px;">
                <div style="width:56px;height:56px;background:linear-gradient(135deg,#6c63ff,#9b8fff);border-radius:50%;display:inline-flex;align-items:center;justify-content:center;margin:0 auto;">
                  <span style="color:#fff;font-size:22px;font-weight:700;line-height:56px;">${inviterName.charAt(0).toUpperCase()}</span>
                </div>
                <p style="color:#666;font-size:13px;margin:8px 0 0 0;"><strong style="color:#1a1a2e;">${inviterName}</strong> invited you</p>
              </div>

              <h1 style="color:#1a1a2e;font-size:24px;font-weight:700;margin:0 0 8px 0;text-align:center;line-height:1.3;">
                Join ${companyName}<br />on Taime
              </h1>
              <p style="color:#555;font-size:15px;line-height:1.6;margin:0 0 6px 0;text-align:center;">
                Hi ${firstName}, you're invited to join the <strong>${companyName}</strong> team.
              </p>
              ${roleText}

              <!-- Divider -->
              <div style="border-top:1px solid #f0f0f8;margin:20px 0 24px 0;"></div>

              <!-- Features -->
              ${featuresHtml}

              <!-- CTA button -->
              <div style="text-align:center;margin-bottom:20px;">
                <a href="${inviteUrl}" style="display:inline-block;background:linear-gradient(135deg,#6c63ff,#9b8fff);color:#ffffff;padding:16px 40px;border-radius:12px;text-decoration:none;font-size:16px;font-weight:700;letter-spacing:0.2px;box-shadow:0 4px 14px rgba(108,99,255,0.35);">
                  Accept Invitation &rarr;
                </a>
              </div>
              <p style="color:#aaa;font-size:12px;text-align:center;margin:0;">
                Or copy this link: <a href="${inviteUrl}" style="color:#6c63ff;text-decoration:none;word-break:break-all;">${inviteUrl}</a>
              </p>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding:24px 0 0 0;text-align:center;">
              <p style="color:#aaa;font-size:12px;margin:0;line-height:1.6;">
                You received this because ${inviterName} added you to ${companyName}.<br />
                If you weren't expecting this, you can safely ignore this email.
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>
    `;

    await nylas.messages.send({
      identifier: grantId,
      requestBody: {
        to: [{ name: displayName, email: recipientEmail }],
        subject: `${inviterName} invited you to join ${companyName} on Taime`,
        body: htmlBody,
      },
    });

    console.log(`Invitation email sent to ${recipientEmail}`);
    return true;
  } catch (error) {
    console.error("Failed to send invitation email:", error);
    return false;
  }
}

export async function sendAvailabilityUpdateEmail(
  managerEmail: string,
  managerName: string,
  employeeName: string,
  appUrl: string,
): Promise<boolean> {
  const sendgridKey = process.env.SENDGRID_API_KEY;
  if (!sendgridKey) {
    return false;
  }

  sgMail.setApiKey(sendgridKey);

  const firstName = (managerName || managerEmail).split(" ")[0] || managerName;
  const scheduleUrl = `${appUrl}/schedule`;

  const htmlBody = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Availability Updated — ${employeeName}</title>
</head>
<body style="margin:0;padding:0;background-color:#f4f4f8;font-family:'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f4f8;padding:40px 16px;">
    <tr>
      <td align="center">
        <table width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;">
          <tr>
            <td style="padding:0 0 24px 0;text-align:center;">
              <div style="display:inline-block;background:linear-gradient(135deg,#6c63ff,#9b8fff);border-radius:16px;padding:14px 24px;">
                <span style="color:#ffffff;font-size:22px;font-weight:800;letter-spacing:-0.5px;">Taime</span>
              </div>
              <p style="color:#888;font-size:12px;margin:8px 0 0 0;letter-spacing:1px;text-transform:uppercase;">AI Boutique Manager</p>
            </td>
          </tr>
          <tr>
            <td style="background:#ffffff;border-radius:20px;padding:36px 36px 32px 36px;box-shadow:0 4px 24px rgba(108,99,255,0.08);">
              <div style="text-align:center;margin-bottom:24px;">
                <div style="width:56px;height:56px;background:linear-gradient(135deg,#6c63ff,#9b8fff);border-radius:50%;display:inline-flex;align-items:center;justify-content:center;margin:0 auto;">
                  <span style="color:#fff;font-size:26px;line-height:56px;">📅</span>
                </div>
              </div>
              <h1 style="color:#1a1a2e;font-size:22px;font-weight:700;margin:0 0 8px 0;text-align:center;">Availability Updated</h1>
              <p style="color:#555;font-size:15px;line-height:1.6;margin:0 0 20px 0;text-align:center;">
                Hi ${firstName}, <strong style="color:#1a1a2e;">${employeeName}</strong> has just updated their availability. You may want to review it before finalising the schedule.
              </p>
              <div style="text-align:center;margin-bottom:20px;">
                <a href="${scheduleUrl}" style="display:inline-block;background:linear-gradient(135deg,#6c63ff,#9b8fff);color:#ffffff;padding:14px 36px;border-radius:12px;text-decoration:none;font-size:15px;font-weight:700;box-shadow:0 4px 14px rgba(108,99,255,0.35);">
                  Review Availability &rarr;
                </a>
              </div>
            </td>
          </tr>
          <tr>
            <td style="padding:24px 0 0 0;text-align:center;">
              <p style="color:#aaa;font-size:12px;margin:0;line-height:1.6;">
                You received this because you have scheduling permissions in Taime.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
  `;

  try {
    await sgMail.send({
      to: managerEmail,
      from: process.env.SENDGRID_FROM_EMAIL || "noreply@taime.app",
      subject: `${employeeName} updated their availability`,
      html: htmlBody,
    });
    return true;
  } catch (error) {
    console.error("[Availability] Failed to send availability update email:", error);
    return false;
  }
}

export async function sendAvailabilityOverrideEmail(
  employeeEmail: string,
  employeeName: string,
  managerName: string,
  date: string,
  changeDescription: string,
  appUrl: string,
): Promise<boolean> {
  const sendgridKey = process.env.SENDGRID_API_KEY;
  if (!sendgridKey) {
    return false;
  }

  sgMail.setApiKey(sendgridKey);

  const firstName = (employeeName || employeeEmail).split(" ")[0] || employeeName;
  const formattedDate = (() => {
    try {
      return new Date(date + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' });
    } catch {
      return date;
    }
  })();
  const availabilityUrl = `${appUrl}/availability`;

  const htmlBody = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Your Availability Was Updated</title>
</head>
<body style="margin:0;padding:0;background-color:#f4f4f8;font-family:'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f4f8;padding:40px 16px;">
    <tr>
      <td align="center">
        <table width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;">
          <tr>
            <td style="padding:0 0 24px 0;text-align:center;">
              <div style="display:inline-block;background:linear-gradient(135deg,#6c63ff,#9b8fff);border-radius:16px;padding:14px 24px;">
                <span style="color:#ffffff;font-size:22px;font-weight:800;letter-spacing:-0.5px;">Taime</span>
              </div>
              <p style="color:#888;font-size:12px;margin:8px 0 0 0;letter-spacing:1px;text-transform:uppercase;">AI Boutique Manager</p>
            </td>
          </tr>
          <tr>
            <td style="background:#ffffff;border-radius:20px;padding:36px 36px 32px 36px;box-shadow:0 4px 24px rgba(108,99,255,0.08);">
              <div style="text-align:center;margin-bottom:24px;">
                <div style="width:56px;height:56px;background:linear-gradient(135deg,#6c63ff,#9b8fff);border-radius:50%;display:inline-flex;align-items:center;justify-content:center;margin:0 auto;">
                  <span style="color:#fff;font-size:26px;line-height:56px;">📅</span>
                </div>
              </div>
              <h1 style="color:#1a1a2e;font-size:22px;font-weight:700;margin:0 0 8px 0;text-align:center;">Your Availability Was Updated</h1>
              <p style="color:#555;font-size:15px;line-height:1.6;margin:0 0 20px 0;text-align:center;">
                Hi ${firstName}, <strong style="color:#1a1a2e;">${managerName}</strong> has updated your availability for <strong style="color:#1a1a2e;">${formattedDate}</strong>: ${changeDescription}.
              </p>
              <div style="text-align:center;margin-bottom:20px;">
                <a href="${availabilityUrl}" style="display:inline-block;background:linear-gradient(135deg,#6c63ff,#9b8fff);color:#ffffff;padding:14px 36px;border-radius:12px;text-decoration:none;font-size:15px;font-weight:700;box-shadow:0 4px 14px rgba(108,99,255,0.35);">
                  View My Availability &rarr;
                </a>
              </div>
            </td>
          </tr>
          <tr>
            <td style="padding:24px 0 0 0;text-align:center;">
              <p style="color:#aaa;font-size:12px;margin:0;line-height:1.6;">
                You received this because a manager updated your availability in Taime.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
  `;

  try {
    await sgMail.send({
      to: employeeEmail,
      from: process.env.SENDGRID_FROM_EMAIL || "noreply@taime.app",
      subject: `Your availability on ${formattedDate} was updated`,
      html: htmlBody,
    });
    return true;
  } catch (error) {
    console.error("[Availability] Failed to send availability override email:", error);
    return false;
  }
}

export async function sendShopifyAnalyticsReport(
  recipientEmail: string,
  shopDomain: string,
  frequency: string,
  csvContent: string,
  summary: { totalRevenue: number; totalLaborCost: number; laborCostPercentage: number; daysBack: number },
): Promise<boolean> {
  const sendgridKey = process.env.SENDGRID_API_KEY;
  if (!sendgridKey) {
    console.error("[ShopifyReport] SENDGRID_API_KEY not configured");
    return false;
  }

  sgMail.setApiKey(sendgridKey);

  const today = new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
  const frequencyLabel = frequency === "daily" ? "Daily" : frequency === "weekly" ? "Weekly" : "Monthly";
  const filename = `shopify-analytics-${frequency}-${new Date().toISOString().split("T")[0]}.csv`;

  const ratioColor = summary.laborCostPercentage < 30 ? "#16a34a" : summary.laborCostPercentage <= 40 ? "#ca8a04" : "#dc2626";
  const ratioLabel = summary.laborCostPercentage < 30 ? "Healthy" : summary.laborCostPercentage <= 40 ? "Moderate" : "High";

  const htmlBody = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Shopify Analytics Report — ${today}</title>
</head>
<body style="margin:0;padding:0;background-color:#f4f4f8;font-family:'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f4f8;padding:40px 16px;">
    <tr>
      <td align="center">
        <table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;">
          <tr>
            <td style="padding:0 0 24px 0;text-align:center;">
              <div style="display:inline-block;background:linear-gradient(135deg,#6c63ff,#9b8fff);border-radius:16px;padding:14px 24px;">
                <span style="color:#ffffff;font-size:22px;font-weight:800;letter-spacing:-0.5px;">Taime</span>
              </div>
              <p style="color:#888;font-size:12px;margin:8px 0 0 0;letter-spacing:1px;text-transform:uppercase;">AI Boutique Manager</p>
            </td>
          </tr>
          <tr>
            <td style="background:#ffffff;border-radius:20px;padding:36px 36px 32px 36px;box-shadow:0 4px 24px rgba(108,99,255,0.08);">
              <h1 style="color:#1a1a2e;font-size:22px;font-weight:700;margin:0 0 6px 0;text-align:center;">
                ${frequencyLabel} Shopify Report
              </h1>
              <p style="color:#888;font-size:13px;text-align:center;margin:0 0 24px 0;">${shopDomain} &middot; ${today}</p>

              <div style="border-top:1px solid #f0f0f8;margin:0 0 24px 0;"></div>

              <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
                <tr>
                  <td width="33%" style="padding:0 6px 0 0;vertical-align:top;">
                    <div style="background:#f0eeff;border-radius:12px;padding:16px 12px;text-align:center;">
                      <p style="color:#6c63ff;font-size:11px;font-weight:600;margin:0 0 4px 0;text-transform:uppercase;letter-spacing:0.5px;">Labor Ratio</p>
                      <p style="color:${ratioColor};font-size:24px;font-weight:800;margin:0 0 2px 0;">${summary.laborCostPercentage}%</p>
                      <p style="color:#888;font-size:11px;margin:0;">${ratioLabel}</p>
                    </div>
                  </td>
                  <td width="33%" style="padding:0 3px;vertical-align:top;">
                    <div style="background:#eff6ff;border-radius:12px;padding:16px 12px;text-align:center;">
                      <p style="color:#2563eb;font-size:11px;font-weight:600;margin:0 0 4px 0;text-transform:uppercase;letter-spacing:0.5px;">Revenue</p>
                      <p style="color:#1a1a2e;font-size:20px;font-weight:800;margin:0 0 2px 0;">$${summary.totalRevenue.toLocaleString()}</p>
                      <p style="color:#888;font-size:11px;margin:0;">${summary.daysBack}d period</p>
                    </div>
                  </td>
                  <td width="33%" style="padding:0 0 0 6px;vertical-align:top;">
                    <div style="background:#fffbeb;border-radius:12px;padding:16px 12px;text-align:center;">
                      <p style="color:#d97706;font-size:11px;font-weight:600;margin:0 0 4px 0;text-transform:uppercase;letter-spacing:0.5px;">Labor Cost</p>
                      <p style="color:#1a1a2e;font-size:20px;font-weight:800;margin:0 0 2px 0;">$${summary.totalLaborCost.toLocaleString()}</p>
                      <p style="color:#888;font-size:11px;margin:0;">${summary.daysBack}d period</p>
                    </div>
                  </td>
                </tr>
              </table>

              <p style="color:#555;font-size:14px;line-height:1.6;margin:0 0 16px 0;text-align:center;">
                The full CSV breakdown is attached to this email.
              </p>
            </td>
          </tr>
          <tr>
            <td style="padding:24px 0 0 0;text-align:center;">
              <p style="color:#aaa;font-size:12px;margin:0;line-height:1.6;">
                This is an automated ${frequencyLabel.toLowerCase()} report from Taime.<br />
                Manage your report settings in the Shopify Analytics panel.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
  `;

  try {
    await sgMail.send({
      to: recipientEmail,
      from: process.env.SENDGRID_FROM_EMAIL || "noreply@taime.app",
      subject: `${frequencyLabel} Shopify Report — ${shopDomain} (${today})`,
      html: htmlBody,
      attachments: [
        {
          content: Buffer.from(csvContent).toString("base64"),
          filename,
          type: "text/csv",
          disposition: "attachment",
        },
      ],
    });
    console.log(`[ShopifyReport] Sent ${frequency} report to ${recipientEmail} for ${shopDomain}`);
    return true;
  } catch (error) {
    console.error("[ShopifyReport] Failed to send report email:", error);
    return false;
  }
}
