import { storage } from "../storage";
import { notificationService } from "./notificationService";
import sgMail from "@sendgrid/mail";
import logger from "../lib/logger";

interface PayPeriodWindow {
  startDate: string;
  endDate: string;
}

function computeRecentPeriods(
  firstStart: Date,
  intervalDays: number,
  count: number = 6
): PayPeriodWindow[] {
  const now = new Date();
  const periods: PayPeriodWindow[] = [];
  let ps = new Date(firstStart);
  ps.setHours(0, 0, 0, 0);

  // Advance to the period that contains today
  while (new Date(ps.getTime() + intervalDays * 86400000) <= now) {
    ps = new Date(ps.getTime() + intervalDays * 86400000);
  }

  // Include current period and count-1 prior periods
  for (let i = count - 1; i >= 0; i--) {
    const periodStart = new Date(ps.getTime() - i * intervalDays * 86400000);
    const periodEnd = new Date(periodStart.getTime() + (intervalDays - 1) * 86400000);
    periods.push({
      startDate: periodStart.toISOString().split("T")[0],
      endDate: periodEnd.toISOString().split("T")[0],
    });
  }

  return periods;
}

function daysBetween(dateA: string, dateB: Date = new Date()): number {
  const a = new Date(dateA + "T00:00:00");
  const diffMs = dateB.getTime() - a.getTime();
  return Math.floor(diffMs / 86400000);
}

async function hasReminderBeenSent(
  periodStart: string,
  periodEnd: string,
  reminderType: string,
  userId?: string,
  storeId?: string | null
): Promise<boolean> {
  const logs = await storage.getTimesheetReminderLogs(periodStart, periodEnd, storeId);
  return logs.some(
    (l) =>
      l.reminderType === reminderType &&
      (!userId || l.userId === userId)
  );
}

async function isPeriodFullyApproved(periodStart: string, periodEnd: string): Promise<boolean> {
  try {
    const entries = await storage.getAllTimeEntries(
      new Date(periodStart + "T00:00:00"),
      new Date(periodEnd + "T23:59:59")
    );
    if (entries.length === 0) return false;
    const completed = entries.filter((e) => e.clockOutTime);
    return completed.length > 0 && completed.every((e) => e.isApproved);
  } catch {
    return false;
  }
}

/**
 * Send a notification via in-app push and optionally via SendGrid email.
 * Email is only sent when emailRemindersEnabled=true and SENDGRID_API_KEY is configured.
 */
async function sendTimesheetNotification(opts: {
  userId: string;
  title: string;
  body: string;
  data: Record<string, string>;
  emailRemindersEnabled: boolean;
  fromEmail?: string | null;
}): Promise<void> {
  // Always send in-app push notification
  await notificationService.sendToUser(opts.userId, {
    title: opts.title,
    body: opts.body,
    data: opts.data,
  });

  // Optionally send email via SendGrid
  if (opts.emailRemindersEnabled) {
    const sendgridKey = process.env.SENDGRID_API_KEY;
    if (!sendgridKey) {
      logger.warn("[TimesheetReminder] emailRemindersEnabled but SENDGRID_API_KEY not set — skipping email");
      return;
    }
    try {
      const user = await storage.getUser(opts.userId);
      if (!user?.email) return;
      sgMail.setApiKey(sendgridKey);
      const fromEmail = opts.fromEmail || "no-reply@taime.app";
      await sgMail.send({
        to: user.email,
        from: fromEmail,
        subject: opts.title,
        text: opts.body,
        html: `<p>${opts.body}</p>`,
      });
      logger.info({ userId: opts.userId, title: opts.title }, "[TimesheetReminder] Email sent via SendGrid");
    } catch (emailErr: unknown) {
      const e = emailErr as { message?: string };
      logger.warn({ error: e?.message, userId: opts.userId }, "[TimesheetReminder] SendGrid email failed (non-fatal)");
    }
  }
}

async function runTimesheetReminderCheckForStore(
  storeId: string | null,
  workflowSettings: import("@shared/schema").TimesheetWorkflowSettings
): Promise<void> {
  const payPeriodSettings = await storage.getPayPeriodSettings();
  if (!payPeriodSettings?.firstPayPeriodStart) return;

  const intervalType = payPeriodSettings.intervalType || "bi-weekly";
  const intervalDays =
    intervalType === "weekly" ? 7
    : intervalType === "bi-weekly" ? 14
    : intervalType === "semi-monthly" ? 15
    : 30;

  const today = new Date().toISOString().split("T")[0];
  const periods = computeRecentPeriods(
    new Date(payPeriodSettings.firstPayPeriodStart),
    intervalDays,
    6
  );

  const managerReminderDays = workflowSettings.managerReminderDaysAfterPeriod ?? 2;
  const escalationDays = workflowSettings.managerEscalationDaysAfterReminder ?? 3;
  const managerUserIds = (workflowSettings.managerUserIds as string[]) || [];
  const adminUserId = workflowSettings.adminUserId;
  const emailRemindersEnabled = workflowSettings.emailRemindersEnabled ?? false;
  const fromEmail = workflowSettings.reminderFromEmail ?? null;

  for (const period of periods) {
    const isPastPeriod = period.endDate < today;

    // ── Employee self-review: send on the last day of the current period ──
    if (workflowSettings.employeeSelfReviewReminder && period.endDate === today) {
      const allUsers = await storage.getAllUsers();
      for (const user of allUsers) {
        if (!user.isActive) continue;
        // Only remind users belonging to this store
        if (storeId && user.locationId !== storeId) continue;
        const alreadySent = await hasReminderBeenSent(period.startDate, period.endDate, "employee_self_review", user.id, storeId);
        if (!alreadySent) {
          await sendTimesheetNotification({
            userId: user.id,
            title: "Please Review Your Hours",
            body: `Today is the last day of your pay period (ending ${period.endDate}). Please check your clock-in/out entries and flag any issues.`,
            data: { type: "employee_self_review", periodStart: period.startDate, periodEnd: period.endDate },
            emailRemindersEnabled,
            fromEmail,
          });
          await storage.createTimesheetReminderLog({
            storeId,
            periodStart: period.startDate,
            periodEnd: period.endDate,
            reminderType: "employee_self_review",
            userId: user.id,
          });
        }
      }
    }

    // ── Manager reminder & escalation: only for past periods ──
    if (!isPastPeriod) continue;

    const daysAfterPeriodEnd = daysBetween(period.endDate);

    // Determine per-stage approval state for this period
    let periodStatus: string = "pending";
    if (storeId) {
      const periodApproval = await storage.getTimesheetPeriodApproval(storeId, period.startDate, period.endDate);
      periodStatus = periodApproval?.status ?? "pending";
    } else {
      // Legacy/unscoped: infer from entry approvals
      const fullyApproved = await isPeriodFullyApproved(period.startDate, period.endDate);
      if (fullyApproved) periodStatus = "final_approved";
    }

    // Skip entirely if already finalized
    if (periodStatus === "final_approved") continue;

    // ── Manager reminder ──
    // Only send when manager has NOT yet approved and at least N days have passed
    // Use >= (not ===) so a missed scheduler window doesn't skip the reminder permanently
    if (periodStatus !== "manager_approved" && daysAfterPeriodEnd >= managerReminderDays && managerUserIds.length > 0) {
      for (const managerId of managerUserIds) {
        const alreadySent = await hasReminderBeenSent(period.startDate, period.endDate, "manager_reminder", managerId, storeId);
        if (!alreadySent) {
          await sendTimesheetNotification({
            userId: managerId,
            title: "Timesheet Review Reminder",
            body: `Please review and approve timesheets for the pay period ending ${period.endDate}.`,
            data: { type: "timesheet_reminder", periodStart: period.startDate, periodEnd: period.endDate },
            emailRemindersEnabled,
            fromEmail,
          });
          await storage.createTimesheetReminderLog({
            storeId,
            periodStart: period.startDate,
            periodEnd: period.endDate,
            reminderType: "manager_reminder",
            userId: managerId,
          });
          logger.info({ managerId, period, storeId }, "[TimesheetReminder] Manager reminder sent");
        }
      }
    }

    // ── Admin escalation ──
    // Two cases:
    //   (a) manager has NOT approved by N+M days — escalate to admin that manager is overdue
    //   (b) manager has approved but admin has NOT finalized by M days after manager_approved — nudge admin
    if (adminUserId) {
      // Case (a): manager still hasn't reviewed by N+M days after period end (>= for resilience)
      if (periodStatus !== "manager_approved" && daysAfterPeriodEnd >= managerReminderDays + escalationDays) {
        const alreadySent = await hasReminderBeenSent(period.startDate, period.endDate, "manager_escalation", adminUserId, storeId);
        if (!alreadySent) {
          await sendTimesheetNotification({
            userId: adminUserId,
            title: "Timesheet Approval Escalation",
            body: `Timesheets for the pay period ending ${period.endDate} have not been reviewed by the manager yet. Please follow up.`,
            data: { type: "timesheet_escalation", periodStart: period.startDate, periodEnd: period.endDate },
            emailRemindersEnabled,
            fromEmail,
          });
          await storage.createTimesheetReminderLog({
            storeId,
            periodStart: period.startDate,
            periodEnd: period.endDate,
            reminderType: "manager_escalation",
            userId: adminUserId,
          });
          logger.info({ adminUserId, period, storeId }, "[TimesheetReminder] Manager-overdue escalation sent to admin");
        }
      }

      // Case (b): manager approved but admin hasn't finalized — nudge admin after escalationDays
      if (periodStatus === "manager_approved") {
        // Only send admin finalize nudge, not a manager escalation
        const alreadySent = await hasReminderBeenSent(period.startDate, period.endDate, "admin_finalize_nudge", adminUserId, storeId);
        if (!alreadySent && daysAfterPeriodEnd >= managerReminderDays + escalationDays) {
          await sendTimesheetNotification({
            userId: adminUserId,
            title: "Timesheets Awaiting Your Final Approval",
            body: `The manager has reviewed timesheets for the period ending ${period.endDate}. Please finalize the approval.`,
            data: { type: "admin_finalize_nudge", periodStart: period.startDate, periodEnd: period.endDate },
            emailRemindersEnabled,
            fromEmail,
          });
          await storage.createTimesheetReminderLog({
            storeId,
            periodStart: period.startDate,
            periodEnd: period.endDate,
            reminderType: "admin_finalize_nudge",
            userId: adminUserId,
          });
          logger.info({ adminUserId, period, storeId }, "[TimesheetReminder] Admin finalize nudge sent");
        }
      }
    }
  }
}

async function runTimesheetReminderCheck(): Promise<void> {
  try {
    // Iterate all store-scoped workflow settings rows so every store is processed independently
    const allSettings = await storage.getAllTimesheetWorkflowSettings();

    // If no settings rows exist yet no store has ever saved workflow settings.
    // Reminders can only run once a store saves settings (or a migration seeds a default row).
    if (allSettings.length === 0) {
      logger.info("[TimesheetReminder] No workflow settings rows found — skipping until a store configures the workflow");
      return;
    }

    for (const ws of allSettings) {
      const storeId: string | null = ws.storeId ?? null;
      try {
        await runTimesheetReminderCheckForStore(storeId, ws);
      } catch (storeErr: unknown) {
        const e = storeErr as { message?: string };
        logger.warn({ error: e?.message, storeId }, "[TimesheetReminder] Per-store check failed (non-fatal)");
      }
    }
  } catch (err: unknown) {
    const e = err as { message?: string };
    logger.warn({ error: e?.message }, "[TimesheetReminder] Daily check failed (non-fatal)");
  }
}

const REMINDER_INTERVAL_MS = 24 * 60 * 60 * 1000;

export function scheduleTimesheetReminders(): void {
  // Run 30s after boot so migrations are done, then daily
  setTimeout(() => {
    runTimesheetReminderCheck();
    setInterval(runTimesheetReminderCheck, REMINDER_INTERVAL_MS);
  }, 30000);
}
