import Nylas from "nylas";

const nylas = new Nylas({
  apiKey: process.env.NYLAS_API_KEY!,
  apiUri: "https://api.us.nylas.com",
});

const grantId = process.env.NYLAS_GRANT_ID!;

function getAppUrl(req: { headers: Record<string, string | undefined> }): string {
  const host = req.headers["host"] || "localhost:5000";
  const protocol = host.includes(".replit.app") || host.includes(".repl.co") ? "https" : "http";
  return `${protocol}://${host}`;
}

export async function sendTeamInviteEmail(
  req: { headers: Record<string, string | undefined> },
  recipientEmail: string,
  recipientName: string,
  inviterName: string,
  companyName: string,
): Promise<boolean> {
  try {
    const appUrl = getAppUrl(req);
    const displayName = recipientName.trim() || recipientEmail;

    const htmlBody = `
      <div style="font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif; max-width: 600px; margin: 0 auto; padding: 32px; background-color: #ffffff;">
        <div style="text-align: center; margin-bottom: 32px;">
          <h1 style="color: #1a1a2e; font-size: 24px; margin: 0;">Welcome to ${companyName}</h1>
        </div>
        <div style="background: #f8f9fa; border-radius: 12px; padding: 24px; margin-bottom: 24px;">
          <p style="color: #333; font-size: 16px; line-height: 1.6; margin: 0 0 16px 0;">
            Hi ${displayName},
          </p>
          <p style="color: #333; font-size: 16px; line-height: 1.6; margin: 0 0 16px 0;">
            ${inviterName} has added you to the <strong>${companyName}</strong> team on Taime Clock, our workforce management platform.
          </p>
          <p style="color: #333; font-size: 16px; line-height: 1.6; margin: 0 0 24px 0;">
            With Taime Clock, you can clock in and out, view your schedule, manage tasks, and stay connected with your team.
          </p>
          <div style="text-align: center;">
            <a href="${appUrl}" style="display: inline-block; background-color: #6c63ff; color: #ffffff; padding: 14px 32px; border-radius: 8px; text-decoration: none; font-size: 16px; font-weight: 600;">
              Get Started
            </a>
          </div>
        </div>
        <p style="color: #888; font-size: 13px; text-align: center; margin: 0;">
          If you have any questions, reach out to your manager or reply to this email.
        </p>
      </div>
    `;

    await nylas.messages.send({
      identifier: grantId,
      requestBody: {
        to: [{ name: displayName, email: recipientEmail }],
        subject: `You've been invited to join ${companyName} on Taime Clock`,
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
