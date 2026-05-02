import { storage } from "../storage";
import { notificationService } from "./notificationService";
import logger from "../lib/logger";

interface PayPeriodWindow {
  startDate: string;
  endDate: string;
}

function computeCurrentAndRecentPeriods(
  firstStart: Date,
  intervalDays: number,
  count: number = 4
): PayPeriodWindow[] {
  const now = new Date();
  const periods: PayPeriodWindow[] = [];
  let ps = new Date(firstStart);
  ps.setHours(0, 0, 0, 0);

  while (new Date(ps.getTime() + intervalDays * 86400000) < now) {
    ps = new Date(ps.getTime() + intervalDays * 86400000);
  }

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
  userId?: string
): Promise<boolean> {
  const logs = await storage.getTimesheetReminderLogs(periodStart, periodEnd);
  return logs.some(
    (l) =>
      l.reminderType === reminderType &&
      (!userId || l.userId === userId)
  );
}

async function runTimesheetReminderCheck(): Promise<void> {
  try {
    const workflowSettings = await storage.getTimesheetWorkflowSettings();
    if (!workflowSettings) return;

    const payPeriodSettings = await storage.getPayPeriodSettings();
    if (!payPeriodSettings?.firstPayPeriodStart) return;

    const intervalType = payPeriodSettings.intervalType || "bi-weekly";
    const intervalDays =
      intervalType === "weekly" ? 7
      : intervalType === "bi-weekly" ? 14
      : intervalType === "semi-monthly" ? 15
      : 30;

    const periods = computeCurrentAndRecentPeriods(
      new Date(payPeriodSettings.firstPayPeriodStart),
      intervalDays,
      4
    );

    const now = new Date();
    const today = now.toISOString().split("T")[0];

    for (const period of periods) {
      if (period.endDate >= today) continue;

      const daysAfterPeriodEnd = daysBetween(period.endDate);

      const managerReminderDays = workflowSettings.managerReminderDaysAfterPeriod ?? 2;
      const escalationDays = workflowSettings.managerEscalationDaysAfterReminder ?? 3;
      const managerUserIds = (workflowSettings.managerUserIds as string[]) || [];
      const adminUserId = workflowSettings.adminUserId;

      if (daysAfterPeriodEnd === managerReminderDays && managerUserIds.length > 0) {
        for (const managerId of managerUserIds) {
          const alreadySent = await hasReminderBeenSent(period.startDate, period.endDate, "manager_reminder", managerId);
          if (!alreadySent) {
            await notificationService.sendToUser(managerId, {
              title: "Timesheet Review Reminder",
              body: `Please review and approve timesheets for the pay period ending ${period.endDate}.`,
              data: { type: "timesheet_reminder", periodStart: period.startDate, periodEnd: period.endDate },
            });
            await storage.createTimesheetReminderLog({
              periodStart: period.startDate,
              periodEnd: period.endDate,
              reminderType: "manager_reminder",
              userId: managerId,
            });
            logger.info({ managerId, period }, "[TimesheetReminder] Manager reminder sent");
          }
        }
      }

      if (daysAfterPeriodEnd === managerReminderDays + escalationDays && adminUserId) {
        const alreadySent = await hasReminderBeenSent(period.startDate, period.endDate, "manager_escalation", adminUserId);
        if (!alreadySent) {
          await notificationService.sendToUser(adminUserId, {
            title: "Timesheet Approval Escalation",
            body: `Timesheets for the pay period ending ${period.endDate} have not been approved yet. Please review.`,
            data: { type: "timesheet_escalation", periodStart: period.startDate, periodEnd: period.endDate },
          });
          await storage.createTimesheetReminderLog({
            periodStart: period.startDate,
            periodEnd: period.endDate,
            reminderType: "manager_escalation",
            userId: adminUserId,
          });
          logger.info({ adminUserId, period }, "[TimesheetReminder] Escalation sent to admin");
        }
      }

      if (workflowSettings.employeeSelfReviewReminder && period.endDate === today) {
        const allUsers = await storage.getAllUsers();
        for (const user of allUsers) {
          if (!user.isActive) continue;
          const alreadySent = await hasReminderBeenSent(period.startDate, period.endDate, "employee_self_review", user.id);
          if (!alreadySent) {
            await notificationService.sendToUser(user.id, {
              title: "Please Review Your Hours",
              body: `Today is the last day of your pay period. Please check your clock-in/out entries and flag any issues.`,
              data: { type: "employee_self_review", periodStart: period.startDate, periodEnd: period.endDate },
            });
            await storage.createTimesheetReminderLog({
              periodStart: period.startDate,
              periodEnd: period.endDate,
              reminderType: "employee_self_review",
              userId: user.id,
            });
          }
        }
      }
    }
  } catch (err: unknown) {
    const e = err as { message?: string };
    logger.warn({ error: e?.message }, "[TimesheetReminder] Daily check failed (non-fatal)");
  }
}

const REMINDER_INTERVAL_MS = 24 * 60 * 60 * 1000;

export function scheduleTimesheetReminders(): void {
  setTimeout(() => {
    runTimesheetReminderCheck();
    setInterval(runTimesheetReminderCheck, REMINDER_INTERVAL_MS);
  }, 30000);
}
