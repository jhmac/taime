import type { IStorage } from "../storage";
import { claudeService } from "./claudeService";
import { notificationService } from "./notificationService";
import logger from "../lib/logger";

function calculateHours(clockIn: Date, clockOut: Date | null, breakMinutes: number = 0): number {
  if (!clockOut) return 0;
  const diffMs = new Date(clockOut).getTime() - new Date(clockIn).getTime();
  const totalMinutes = diffMs / 60000;
  return Math.max(0, (totalMinutes - breakMinutes) / 60);
}

function getWeekStart(date: Date, workWeekStart: string = "sunday"): Date {
  const dayMap: Record<string, number> = {
    sunday: 0, monday: 1, tuesday: 2, wednesday: 3,
    thursday: 4, friday: 5, saturday: 6,
  };
  const targetDay = dayMap[workWeekStart.toLowerCase()] ?? 0;
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  const currentDay = d.getDay();
  const diff = (currentDay - targetDay + 7) % 7;
  d.setDate(d.getDate() - diff);
  return d;
}

function getWeekEnd(weekStart: Date): Date {
  const end = new Date(weekStart);
  end.setDate(end.getDate() + 6);
  end.setHours(23, 59, 59, 999);
  return end;
}

interface EmployeeOTRisk {
  userId: string;
  firstName: string;
  lastName: string;
  currentHours: number;
  projectedHours: number;
  remainingShifts: Array<{
    scheduleId: string;
    startTime: Date;
    endTime: Date;
    shiftHours: number;
  }>;
  riskLevel: "green" | "yellow" | "red";
}

interface SwapSuggestion {
  atRiskEmployeeId: string;
  atRiskEmployeeName: string;
  shiftId: string;
  shiftStart: string;
  shiftEnd: string;
  shiftHours: number;
  replacementEmployeeId: string;
  replacementEmployeeName: string;
  replacementCurrentHours: number;
  replacementProjectedHours: number;
  reasoning: string;
}

export class OvertimePreventionService {
  private storage: IStorage;

  constructor(storage: IStorage) {
    this.storage = storage;
  }

  async detectOvertimeRisks(): Promise<{
    atRiskEmployees: EmployeeOTRisk[];
    suggestions: SwapSuggestion[];
    weekStart: Date;
    weekEnd: Date;
    threshold: number;
  }> {
    const settings = await this.storage.getCompanySettings();
    const otThreshold = settings?.overtimeThresholdHours ?? 40;
    const workWeekStart = settings?.workWeekStart ?? "sunday";
    const warningThreshold = Math.max(otThreshold - 5, otThreshold * 0.875);
    const now = new Date();
    const weekStart = getWeekStart(now, workWeekStart);
    const weekEnd = getWeekEnd(weekStart);

    const [allEntries, allSchedules, allUsers, allAvailability] = await Promise.all([
      this.storage.getAllTimeEntries(weekStart, weekEnd, false, null),
      this.storage.getAllSchedules(weekStart, weekEnd),
      this.storage.getAllUsers(),
      this.storage.getAllAvailabilityByDateRange(weekStart, weekEnd),
    ]);

    const activeUsers = allUsers.filter((u: any) => u.isActive !== false);
    const userMap = new Map(activeUsers.map((u: any) => [u.id, u]));

    const hoursWorkedByUser = new Map<string, number>();
    for (const entry of allEntries) {
      const hours = calculateHours(entry.clockInTime, entry.clockOutTime, entry.breakMinutes || 0);
      hoursWorkedByUser.set(entry.userId, (hoursWorkedByUser.get(entry.userId) || 0) + hours);
    }

    const remainingSchedulesByUser = new Map<string, Array<{ scheduleId: string; startTime: Date; endTime: Date; shiftHours: number }>>();
    for (const schedule of allSchedules) {
      if (new Date(schedule.startTime) <= now) continue;
      const shiftHours = (new Date(schedule.endTime).getTime() - new Date(schedule.startTime).getTime()) / 3600000;
      const list = remainingSchedulesByUser.get(schedule.userId) || [];
      list.push({
        scheduleId: schedule.id,
        startTime: new Date(schedule.startTime),
        endTime: new Date(schedule.endTime),
        shiftHours,
      });
      remainingSchedulesByUser.set(schedule.userId, list);
    }

    const atRiskEmployees: EmployeeOTRisk[] = [];
    for (const user of activeUsers) {
      const currentHours = hoursWorkedByUser.get(user.id) || 0;
      const remaining = remainingSchedulesByUser.get(user.id) || [];
      const scheduledHours = remaining.reduce((sum, s) => sum + s.shiftHours, 0);
      const projectedHours = currentHours + scheduledHours;

      let riskLevel: "green" | "yellow" | "red" = "green";
      if (currentHours >= otThreshold - 2 || projectedHours >= otThreshold) {
        riskLevel = "red";
      } else if (currentHours >= warningThreshold || projectedHours >= warningThreshold) {
        riskLevel = "yellow";
      }

      if (riskLevel !== "green" && remaining.length > 0) {
        atRiskEmployees.push({
          userId: user.id,
          firstName: user.firstName || "",
          lastName: user.lastName || "",
          currentHours: Math.round(currentHours * 100) / 100,
          projectedHours: Math.round(projectedHours * 100) / 100,
          remainingShifts: remaining,
          riskLevel,
        });
      }
    }

    if (atRiskEmployees.length === 0) {
      return { atRiskEmployees: [], suggestions: [], weekStart, weekEnd, threshold: otThreshold };
    }

    const scheduledUserShifts = new Map<string, Set<string>>();
    for (const schedule of allSchedules) {
      if (new Date(schedule.startTime) <= now) continue;
      const dateKey = new Date(schedule.startTime).toISOString().split("T")[0];
      const key = `${schedule.userId}_${dateKey}`;
      if (!scheduledUserShifts.has(key)) scheduledUserShifts.set(key, new Set());
      const startH = new Date(schedule.startTime).getHours();
      const endH = new Date(schedule.endTime).getHours() || 24;
      for (let h = startH; h < endH; h++) {
        scheduledUserShifts.get(key)!.add(String(h));
      }
    }

    const availabilityByUserDate = new Map<string, boolean>();
    for (const avail of allAvailability) {
      if (avail.isAvailable) {
        const dateKey = new Date(avail.date).toISOString().split("T")[0];
        availabilityByUserDate.set(`${avail.userId}_${dateKey}`, true);
      }
    }

    const suggestions: SwapSuggestion[] = [];

    for (const risk of atRiskEmployees) {
      for (const shift of risk.remainingShifts) {
        const shiftDateKey = new Date(shift.startTime).toISOString().split("T")[0];

        const candidates: Array<{
          userId: string;
          name: string;
          currentHours: number;
          projectedAfterSwap: number;
          capacityRemaining: number;
        }> = [];

        for (const user of activeUsers) {
          if (user.id === risk.userId) continue;

          const userCurrentHours = hoursWorkedByUser.get(user.id) || 0;
          const userRemaining = remainingSchedulesByUser.get(user.id) || [];
          const userScheduledHours = userRemaining.reduce((sum, s) => sum + s.shiftHours, 0);
          const userProjected = userCurrentHours + userScheduledHours;

          if (userProjected + shift.shiftHours > otThreshold) continue;

          const schedKey = `${user.id}_${shiftDateKey}`;
          const isAlreadyScheduled = scheduledUserShifts.has(schedKey);

          if (isAlreadyScheduled) {
            const userHoursSet = scheduledUserShifts.get(schedKey)!;
            const shiftStartH = shift.startTime.getHours();
            const shiftEndH = shift.endTime.getHours() || 24;
            let hasConflict = false;
            for (let h = shiftStartH; h < shiftEndH; h++) {
              if (userHoursSet.has(String(h))) {
                hasConflict = true;
                break;
              }
            }
            if (hasConflict) continue;
          }

          candidates.push({
            userId: user.id,
            name: `${user.firstName || ""} ${user.lastName || ""}`.trim(),
            currentHours: Math.round(userCurrentHours * 100) / 100,
            projectedAfterSwap: Math.round((userProjected + shift.shiftHours) * 100) / 100,
            capacityRemaining: Math.round((otThreshold - userProjected) * 100) / 100,
          });
        }

        candidates.sort((a, b) => b.capacityRemaining - a.capacityRemaining);

        const topCandidates = candidates.slice(0, 3);

        for (const candidate of topCandidates) {
          suggestions.push({
            atRiskEmployeeId: risk.userId,
            atRiskEmployeeName: `${risk.firstName} ${risk.lastName}`.trim(),
            shiftId: shift.scheduleId,
            shiftStart: shift.startTime.toISOString(),
            shiftEnd: shift.endTime.toISOString(),
            shiftHours: Math.round(shift.shiftHours * 100) / 100,
            replacementEmployeeId: candidate.userId,
            replacementEmployeeName: candidate.name,
            replacementCurrentHours: candidate.currentHours,
            replacementProjectedHours: candidate.projectedAfterSwap,
            reasoning: `${risk.firstName} ${risk.lastName} is at ${risk.currentHours} hrs (projected ${risk.projectedHours} hrs). Moving this ${shift.shiftHours.toFixed(1)}-hr shift to ${candidate.name} (currently at ${candidate.currentHours} hrs, would go to ${candidate.projectedAfterSwap} hrs) keeps both under the ${otThreshold}-hr threshold.`,
          });
        }
      }
    }

    return { atRiskEmployees, suggestions, weekStart, weekEnd, threshold: otThreshold };
  }

  async generateAISuggestions(
    atRiskEmployees: EmployeeOTRisk[],
    suggestions: SwapSuggestion[],
    threshold: number
  ): Promise<SwapSuggestion[]> {
    if (suggestions.length === 0) return suggestions;

    try {
      const prompt = `You are analyzing overtime risks for a team. The overtime threshold is ${threshold} hours/week.

At-risk employees:
${atRiskEmployees.map(e => `- ${e.firstName} ${e.lastName}: ${e.currentHours} hrs worked, ${e.projectedHours} hrs projected, ${e.remainingShifts.length} remaining shifts`).join("\n")}

Possible swap suggestions (already filtered for availability/conflicts):
${suggestions.map((s, i) => `${i + 1}. Move ${s.atRiskEmployeeName}'s shift (${new Date(s.shiftStart).toLocaleDateString()} ${new Date(s.shiftStart).toLocaleTimeString()} - ${new Date(s.shiftEnd).toLocaleTimeString()}, ${s.shiftHours} hrs) to ${s.replacementEmployeeName} (current: ${s.replacementCurrentHours} hrs, after swap: ${s.replacementProjectedHours} hrs)`).join("\n")}

Rank these suggestions from best to worst. For each, provide a concise reasoning explaining why this swap makes sense (or doesn't). Return JSON:
{
  "rankedSuggestions": [
    { "index": 0, "reasoning": "string explaining the swap benefit", "priority": "high|medium|low" }
  ]
}`;

      const response = await claudeService.chat(prompt, { type: "overtime_prevention" });
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        if (parsed.rankedSuggestions && Array.isArray(parsed.rankedSuggestions)) {
          for (const ranked of parsed.rankedSuggestions) {
            if (ranked.index >= 0 && ranked.index < suggestions.length && ranked.reasoning) {
              suggestions[ranked.index].reasoning = ranked.reasoning;
            }
          }
        }
      }
    } catch (error: any) {
      logger.warn({ error: error.message }, "AI suggestion ranking failed, using default reasoning");
    }

    return suggestions;
  }

  async getOvertimeAlerts(): Promise<{
    atRiskEmployees: EmployeeOTRisk[];
    alerts: any[];
    weekStart: Date;
    weekEnd: Date;
    threshold: number;
  }> {
    const result = await this.detectOvertimeRisks();

    let enrichedSuggestions = result.suggestions;
    if (result.suggestions.length > 0) {
      enrichedSuggestions = await this.generateAISuggestions(
        result.atRiskEmployees,
        result.suggestions,
        result.threshold
      );
    }

    const alerts = [];
    const weekStartDate = result.weekStart;

    for (const suggestion of enrichedSuggestions) {
      const existing = await this.storage.getOvertimeAlerts({
        status: "pending",
        weekStartDate,
      });

      const alreadyExists = existing.some(
        (e) =>
          e.employeeId === suggestion.atRiskEmployeeId &&
          e.atRiskShiftId === suggestion.shiftId &&
          e.suggestedReplacementId === suggestion.replacementEmployeeId
      );

      if (!alreadyExists) {
        const alert = await this.storage.createOvertimeAlert({
          employeeId: suggestion.atRiskEmployeeId,
          currentHours: String(suggestion.replacementCurrentHours),
          projectedHours: String(suggestion.replacementProjectedHours),
          threshold: String(result.threshold),
          atRiskShiftId: suggestion.shiftId,
          suggestedReplacementId: suggestion.replacementEmployeeId,
          aiReasoning: suggestion.reasoning,
          status: "pending",
          weekStartDate,
        });
        alerts.push({
          ...alert,
          atRiskEmployeeName: suggestion.atRiskEmployeeName,
          replacementEmployeeName: suggestion.replacementEmployeeName,
          shiftStart: suggestion.shiftStart,
          shiftEnd: suggestion.shiftEnd,
          shiftHours: suggestion.shiftHours,
        });
      }
    }

    const allAlerts = await this.storage.getOvertimeAlerts({
      status: "pending",
      weekStartDate,
    });

    const usersMap = new Map<string, any>();
    const allUsers = await this.storage.getAllUsers();
    for (const u of allUsers) usersMap.set(u.id, u);

    const enrichedAlerts = allAlerts.map((alert) => {
      const employee = usersMap.get(alert.employeeId);
      const replacement = alert.suggestedReplacementId
        ? usersMap.get(alert.suggestedReplacementId)
        : null;
      return {
        ...alert,
        atRiskEmployeeName: employee
          ? `${employee.firstName || ""} ${employee.lastName || ""}`.trim()
          : "Unknown",
        replacementEmployeeName: replacement
          ? `${replacement.firstName || ""} ${replacement.lastName || ""}`.trim()
          : null,
      };
    });

    return {
      atRiskEmployees: result.atRiskEmployees,
      alerts: enrichedAlerts,
      weekStart: result.weekStart,
      weekEnd: result.weekEnd,
      threshold: result.threshold,
    };
  }

  async applySwap(alertId: string, approvedBy: string): Promise<{ success: boolean; message: string }> {
    const alerts = await this.storage.getOvertimeAlerts({});
    const alert = alerts.find((a) => a.id === alertId);

    if (!alert) {
      return { success: false, message: "Alert not found" };
    }

    if (alert.status !== "pending") {
      return { success: false, message: `Alert already ${alert.status}` };
    }

    if (!alert.atRiskShiftId || !alert.suggestedReplacementId) {
      return { success: false, message: "Missing shift or replacement information" };
    }

    try {
      const schedules = await this.storage.getAllSchedules();
      const originalShift = schedules.find((s) => s.id === alert.atRiskShiftId);

      if (!originalShift) {
        return { success: false, message: "Original shift not found" };
      }

      await this.storage.updateSchedule(alert.atRiskShiftId, {
        userId: alert.suggestedReplacementId,
      });

      await this.storage.updateOvertimeAlert(alertId, {
        status: "applied",
        appliedAt: new Date(),
        appliedBy: approvedBy,
      });

      const employee = await this.storage.getUser(alert.employeeId);
      const replacement = await this.storage.getUser(alert.suggestedReplacementId);

      const employeeName = employee
        ? `${employee.firstName || ""} ${employee.lastName || ""}`.trim()
        : "Employee";
      const replacementName = replacement
        ? `${replacement.firstName || ""} ${replacement.lastName || ""}`.trim()
        : "Replacement";

      logger.info(
        {
          alertId,
          shiftId: alert.atRiskShiftId,
          fromEmployee: alert.employeeId,
          toEmployee: alert.suggestedReplacementId,
          approvedBy,
        },
        "Overtime prevention swap applied"
      );

      try {
        await notificationService.sendScheduleUpdate(
          alert.employeeId,
          `Your shift has been reassigned to ${replacementName} to prevent overtime.`
        );
        await notificationService.sendScheduleUpdate(
          alert.suggestedReplacementId,
          `A shift has been assigned to you (previously ${employeeName}'s). Please check your updated schedule.`
        );
      } catch (notifError: any) {
        logger.warn({ error: notifError.message, alertId }, "Failed to send swap notifications");
      }

      return {
        success: true,
        message: `Shift reassigned from ${employeeName} to ${replacementName}. Both employees have been notified.`,
      };
    } catch (error: any) {
      logger.error({ error: error.message, alertId }, "Failed to apply overtime swap");
      return { success: false, message: `Failed to apply swap: ${error.message}` };
    }
  }

  async dismissAlert(alertId: string, dismissedBy: string): Promise<{ success: boolean; message: string }> {
    try {
      await this.storage.updateOvertimeAlert(alertId, {
        status: "dismissed",
        dismissedAt: new Date(),
        dismissedBy,
      });
      return { success: true, message: "Alert dismissed" };
    } catch (error: any) {
      return { success: false, message: `Failed to dismiss: ${error.message}` };
    }
  }
}
