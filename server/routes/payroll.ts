import type { Express } from "express";
import type { IStorage } from "../storage";
import { users, companySettings } from "@shared/schema";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { claudeService } from "../services/claudeService";
import { automationService } from "../services/automationService";
import { payrollAutomationService } from "../services/payrollAutomationService";
import { resolvePermission, resolveAnyPermission } from "../services/permissionResolver";
import { tryResolveStoreIdForUser } from "../services/storeResolver";
import { hasEntitlement } from "../services/entitlements";

function sanitizeCsvField(field: string): string {
  const dangerous = /^[=+\-@\t\r]/;
  if (dangerous.test(field)) {
    return "'" + field;
  }
  return field;
}

export function registerPayrollRoutes(app: Express, storage: IStorage, isAuthenticated: any) {
  app.post('/api/payroll/analyze', isAuthenticated, async (req: any, res) => {
    try {
      const { startDate, endDate } = req.body;
      const start = new Date(startDate);
      const end = new Date(endDate);
      
      const timeEntries = await storage.getAllTimeEntries(start, end, false, null);
      
      const payrollData = timeEntries.map(entry => {
        const clockIn = new Date(entry.clockInTime);
        const clockOut = entry.clockOutTime ? new Date(entry.clockOutTime) : null;
        const totalHours = clockOut 
          ? (clockOut.getTime() - clockIn.getTime()) / (1000 * 60 * 60) - (entry.breakMinutes || 0) / 60
          : 0;
        
        return {
          userId: entry.userId,
          userName: 'User',
          clockInTime: entry.clockInTime.toISOString(),
          clockOutTime: entry.clockOutTime?.toISOString() || '',
          breakMinutes: entry.breakMinutes || 0,
          totalHours,
          overtime: Math.max(0, totalHours - 8),
        };
      });

      const analysis = await claudeService.analyzePayroll({
        timeEntries: payrollData,
        payrollRules: {
          overtimeThreshold: 8,
          maxDailyHours: 12,
          requiredBreaks: 'Minimum 30 minutes for shifts over 6 hours',
        },
      });

      res.json(analysis);
    } catch (error) {
      console.error("Error analyzing payroll:", error);
      res.status(500).json({ message: "Failed to analyze payroll" });
    }
  });

  app.get('/api/payroll/periods', isAuthenticated, async (req: any, res) => {
    try {
      const periods = await storage.getPayrollPeriods();
      res.json(periods);
    } catch (error) {
      console.error("Error fetching payroll periods:", error);
      res.status(500).json({ message: "Failed to fetch payroll periods" });
    }
  });

  app.post('/api/payroll/periods', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const canManagePayroll = await resolveAnyPermission(userId, ['admin.manage_payroll', 'admin.manage_all'], storage);
      
      if (!canManagePayroll) {
        return res.status(403).json({ message: "Payroll management access required" });
      }

      const period = await storage.createNextPayPeriod();
      res.json(period);
    } catch (error) {
      console.error("Error creating payroll period:", error);
      res.status(500).json({ message: "Failed to create payroll period" });
    }
  });

  app.get('/api/payroll/settings', isAuthenticated, async (req: any, res) => {
    try {
      const settings = await storage.getPayPeriodSettings();
      res.json(settings);
    } catch (error) {
      console.error("Error fetching pay period settings:", error);
      res.status(500).json({ message: "Failed to fetch settings" });
    }
  });

  app.post('/api/payroll/settings', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const canManagePayroll = await resolveAnyPermission(userId, ['admin.manage_payroll', 'admin.manage_all'], storage);
      
      if (!canManagePayroll) {
        return res.status(403).json({ message: "Payroll management access required" });
      }

      const settingsData = { ...req.body, createdBy: userId, updatedBy: userId };
      const settings = await storage.updatePayPeriodSettings(settingsData);
      res.json(settings);
    } catch (error) {
      console.error("Error updating pay period settings:", error);
      res.status(500).json({ message: "Failed to update settings" });
    }
  });

  app.post('/api/payroll/automation/trigger', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const canManagePayroll = await resolveAnyPermission(userId, ['admin.manage_payroll', 'admin.manage_all'], storage);
      
      if (!canManagePayroll) {
        return res.status(403).json({ message: "Payroll management access required" });
      }

      // Entitlement check (ADR-0011): payroll automation is a paid feature.
      const storeId = await tryResolveStoreIdForUser(userId);
      if (storeId && !await hasEntitlement(storeId, "payroll.automation")) {
        return res.status(403).json({ message: "Your plan does not include payroll automation. Please upgrade to continue." });
      }

      await automationService.checkAndTriggerAutomation();
      res.json({ success: true, message: "Automation triggered successfully" });
    } catch (error) {
      console.error("Error triggering automation:", error);
      res.status(500).json({ message: "Failed to trigger automation" });
    }
  });

  app.get('/api/payroll/export', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const canManage = await resolveAnyPermission(userId, ['admin.manage_payroll', 'admin.manage_all'], storage);

      if (!canManage) {
        return res.status(403).json({ message: "Payroll management access required" });
      }

      // Entitlement check (ADR-0011): payroll CSV export is a paid feature.
      const storeId = await tryResolveStoreIdForUser(userId);
      if (storeId && !await hasEntitlement(storeId, "payroll.export")) {
        return res.status(403).json({ message: "Your plan does not include payroll export. Please upgrade to continue." });
      }

      const { startDate, endDate } = req.query;
      if (!startDate || !endDate) {
        return res.status(400).json({ message: "startDate and endDate query parameters are required" });
      }

      const start = new Date(startDate as string);
      const end = new Date(endDate as string);

      const timeEntriesData = await storage.getAllTimeEntries(start, end, false, null);
      const allUsers = await db.select().from(users);
      const [settings] = await db.select().from(companySettings).limit(1);
      const holidayRules = await storage.getAllHolidayPayRules();

      const userMap = new Map(allUsers.map(u => [u.id, u]));
      const holidayMap = new Map(holidayRules.map(r => [`${r.month}-${r.day}`, r]));

      const overtimeThreshold = settings?.overtimeThresholdHours || 40;
      const overtimeMultiplier = parseFloat(settings?.overtimeMultiplier || "1.50");

      const employeeMap: Record<string, {
        name: string;
        email: string;
        totalHours: number;
        holidayHours: number;
        holidayPayExtra: number;
        breakMinutes: number;
        hourlyRate: number;
      }> = {};

      for (const entry of timeEntriesData) {
        if (!entry.clockOutTime) continue;

        const clockIn = new Date(entry.clockInTime);
        const clockOut = new Date(entry.clockOutTime);
        const breakMins = entry.breakMinutes || 0;
        const workedHours = (clockOut.getTime() - clockIn.getTime()) / (1000 * 60 * 60) - breakMins / 60;

        if (!employeeMap[entry.userId]) {
          const user = userMap.get(entry.userId);
          employeeMap[entry.userId] = {
            name: user ? `${user.firstName || ''} ${user.lastName || ''}`.trim() : 'Unknown',
            email: user?.email || '',
            totalHours: 0,
            holidayHours: 0,
            holidayPayExtra: 0,
            breakMinutes: 0,
            hourlyRate: parseFloat(user?.hourlyRate || "0"),
          };
        }

        const hours = Math.max(0, workedHours);
        employeeMap[entry.userId].totalHours += hours;
        employeeMap[entry.userId].breakMinutes += breakMins;

        const entryMonth = clockIn.getMonth() + 1;
        const entryDay = clockIn.getDate();
        const matchingHoliday = holidayMap.get(`${entryMonth}-${entryDay}`);
        if (matchingHoliday) {
          const multiplier = parseFloat(matchingHoliday.payMultiplier || '1');
          const extraMultiplier = multiplier - 1;
          employeeMap[entry.userId].holidayHours += hours;
          employeeMap[entry.userId].holidayPayExtra += hours * employeeMap[entry.userId].hourlyRate * extraMultiplier;
        }
      }

      const csvHeaders = [
        'Employee Name', 'Email', 'Total Hours', 'Regular Hours', 'Overtime Hours',
        'Holiday Hours', 'Break Minutes', 'Hourly Rate', 'Regular Pay', 'Overtime Pay', 'Holiday Pay Bonus', 'Total Pay'
      ];

      const csvRows = Object.values(employeeMap).map(emp => {
        const regularHours = Math.min(emp.totalHours, overtimeThreshold);
        const overtimeHours = Math.max(0, emp.totalHours - overtimeThreshold);
        const regularPay = regularHours * emp.hourlyRate;
        const overtimePay = overtimeHours * emp.hourlyRate * overtimeMultiplier;
        const totalPay = regularPay + overtimePay + emp.holidayPayExtra;

        return [
          `"${sanitizeCsvField(emp.name)}"`,
          `"${sanitizeCsvField(emp.email)}"`,
          emp.totalHours.toFixed(2),
          regularHours.toFixed(2),
          overtimeHours.toFixed(2),
          emp.holidayHours.toFixed(2),
          emp.breakMinutes.toString(),
          emp.hourlyRate.toFixed(2),
          regularPay.toFixed(2),
          overtimePay.toFixed(2),
          emp.holidayPayExtra.toFixed(2),
          totalPay.toFixed(2),
        ].join(',');
      });

      const csv = [csvHeaders.join(','), ...csvRows].join('\n');

      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename=payroll_export_${startDate}_${endDate}.csv`);
      res.send(csv);
    } catch (error) {
      console.error("Error exporting payroll:", error);
      res.status(500).json({ message: "Failed to export payroll data" });
    }
  });

  app.get('/api/payroll/periods/:id/workflow-logs', isAuthenticated, async (req: any, res) => {
    try {
      const { id } = req.params;
      const logs = await storage.getWorkflowLogs(id);
      res.json(logs);
    } catch (error) {
      console.error("Error fetching workflow logs:", error);
      res.status(500).json({ message: "Failed to fetch workflow logs" });
    }
  });

  app.get('/api/payroll/periods/:id/confirmations', isAuthenticated, async (req: any, res) => {
    try {
      const { id } = req.params;
      const confirmations = await storage.getScheduleConfirmations(id);
      res.json(confirmations);
    } catch (error) {
      console.error("Error fetching schedule confirmations:", error);
      res.status(500).json({ message: "Failed to fetch confirmations" });
    }
  });

  app.post('/api/payroll/periods/:id/confirm-schedule', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const { id } = req.params;
      const { isConfirmed, feedback, conflicts } = req.body;
      
      const confirmation = await storage.createScheduleConfirmation({
        payrollPeriodId: id,
        userId,
        isConfirmed,
        feedback,
        conflicts,
        confirmedAt: isConfirmed ? new Date() : undefined
      });
      
      res.json(confirmation);
    } catch (error) {
      console.error("Error confirming schedule:", error);
      res.status(500).json({ message: "Failed to confirm schedule" });
    }
  });

  app.post('/api/payroll/automation/initialize', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const canManagePayroll = await resolveAnyPermission(userId, ['admin.manage_payroll', 'admin.manage_all'], storage);
      
      if (!canManagePayroll) {
        return res.status(403).json({ message: "Payroll management access required" });
      }

      // Entitlement check (ADR-0011): payroll automation is a paid feature.
      const storeId = await tryResolveStoreIdForUser(userId);
      if (storeId && !await hasEntitlement(storeId, "payroll.automation")) {
        return res.status(403).json({ message: "Your plan does not include payroll automation. Please upgrade to continue." });
      }

      await automationService.initializeDefaultSettings(userId);
      res.json({ success: true, message: "Automation settings initialized" });
    } catch (error) {
      console.error("Error initializing automation:", error);
      res.status(500).json({ message: "Failed to initialize automation" });
    }
  });

  app.post('/api/payroll/setup', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.id;
            const canManagePayroll = await resolveAnyPermission(userId, ['admin.manage_payroll', 'admin.manage_all'], storage);
      
      if (!canManagePayroll) {
        return res.status(403).json({ message: "Payroll management access required" });
      }

      const { 
        intervalType, 
        firstPayPeriodStart, 
        firstPayPeriodEnd, 
        isAutomationEnabled, 
        notificationUserId,
        isSetupComplete,
        daysBeforeNotification,
        scheduleGenerationDays,
        payDayOfWeek,
      } = req.body;

      // Entitlement check (ADR-0011): payroll automation is a paid feature.
      // Run BEFORE any settings/period writes so a denied request leaves no
      // partial state (e.g. settings flipped to isAutomationEnabled=true with
      // no scheduled periods). Only enforced when the caller is actually
      // requesting automation.
      if (isAutomationEnabled) {
        const storeId = await tryResolveStoreIdForUser(userId);
        if (storeId && !await hasEntitlement(storeId, "payroll.automation")) {
          return res.status(403).json({ message: "Your plan does not include payroll automation. Please upgrade to enable automated payroll periods." });
        }
      }

      const settingsPayload: any = {
        intervalType,
        firstPayPeriodStart: new Date(firstPayPeriodStart),
        firstPayPeriodEnd: new Date(firstPayPeriodEnd),
        isAutomationEnabled,
        notificationUserId,
        isSetupComplete,
      };
      if (typeof daysBeforeNotification === 'number') {
        settingsPayload.daysBeforeNotification = daysBeforeNotification;
      }
      if (typeof scheduleGenerationDays === 'number') {
        settingsPayload.scheduleGenerationDays = scheduleGenerationDays;
      }
      if (typeof payDayOfWeek === 'number' && payDayOfWeek >= 0 && payDayOfWeek <= 6) {
        settingsPayload.payDayOfWeek = payDayOfWeek;
      }

      const existingSettings = await storage.getPayrollSettings();
      
      if (existingSettings) {
        await storage.updatePayrollSettings(existingSettings.id, {
          ...settingsPayload,
          updatedBy: userId,
        });
      } else {
        await storage.createPayrollSettings({
          ...settingsPayload,
          createdBy: userId,
        });
      }

      const existingPeriods = await storage.getPayrollPeriods();
      const firstStart = new Date(firstPayPeriodStart).toISOString().split('T')[0];
      const firstEnd = new Date(firstPayPeriodEnd).toISOString().split('T')[0];
      const alreadyExists = existingPeriods.some(p => {
        const s = new Date(p.startDate).toISOString().split('T')[0];
        const e = new Date(p.endDate).toISOString().split('T')[0];
        return s === firstStart && e === firstEnd;
      });
      if (!alreadyExists) {
        await storage.createPayrollPeriod({
          startDate: new Date(firstPayPeriodStart),
          endDate: new Date(firstPayPeriodEnd),
          workflowState: 'created',
        });
      }

      if (isAutomationEnabled) {
        await payrollAutomationService.scheduleNextPayrollPeriods(intervalType, new Date(firstPayPeriodEnd), 6);
      }

      res.json({ message: "Payroll setup completed successfully" });
    } catch (error) {
      console.error("Error setting up payroll:", error);
      res.status(500).json({ message: "Failed to setup payroll" });
    }
  });

  app.get('/api/payroll/periods/:id/review', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const canManage = await resolveAnyPermission(userId, ['admin.manage_payroll', 'admin.manage_all'], storage);
      if (!canManage) return res.status(403).json({ message: "Payroll management access required" });

      const period = await storage.getPayrollPeriod(req.params.id);
      if (!period) return res.status(404).json({ message: "Pay period not found" });

      const start = new Date(period.startDate);
      const end = new Date(period.endDate);
      const timeEntriesData = await storage.getAllTimeEntries(start, end, false, null);
      const schedulesData = await storage.getAllSchedules(start, end);
      const allUsers = await db.select().from(users);
      const [settings] = await db.select().from(companySettings).limit(1);
      const holidayRules = await storage.getAllHolidayPayRules();

      const userMap = new Map(allUsers.map(u => [u.id, u]));
      const holidayMap = new Map(holidayRules.map(r => [`${r.month}-${r.day}`, r]));
      const timeEntryDateSet = new Set(
        timeEntriesData.map(e => `${e.userId}|${new Date(e.clockInTime).toDateString()}`)
      );

      const overtimeThreshold = settings?.overtimeThresholdHours || 40;
      const overtimeMultiplier = parseFloat(settings?.overtimeMultiplier || "1.50");

      const employeeMap: Record<string, {
        userId: string;
        name: string;
        email: string;
        phone: string;
        totalHours: number;
        scheduledHours: number;
        regularHours: number;
        overtimeHours: number;
        holidayHours: number;
        breakMinutes: number;
        hourlyRate: number;
        regularPay: number;
        overtimePay: number;
        holidayPayExtra: number;
        totalPay: number;
        timeEntries: any[];
        schedules: any[];
        discrepancies: any[];
      }> = {};

      for (const entry of timeEntriesData) {
        const user = userMap.get(entry.userId);
        if (!user) continue;
        if (!employeeMap[entry.userId]) {
          employeeMap[entry.userId] = {
            userId: entry.userId,
            name: `${user.firstName || ''} ${user.lastName || ''}`.trim() || user.email || 'Unknown',
            email: user.email || '',
            phone: (user as any).phone || '',
            totalHours: 0,
            scheduledHours: 0,
            regularHours: 0,
            overtimeHours: 0,
            holidayHours: 0,
            breakMinutes: 0,
            hourlyRate: parseFloat(user.hourlyRate || "0"),
            regularPay: 0,
            overtimePay: 0,
            holidayPayExtra: 0,
            totalPay: 0,
            timeEntries: [],
            schedules: [],
            discrepancies: [],
          };
        }

        const clockIn = new Date(entry.clockInTime);
        const clockOut = entry.clockOutTime ? new Date(entry.clockOutTime) : null;
        const hours = clockOut
          ? (clockOut.getTime() - clockIn.getTime()) / (1000 * 60 * 60) - (entry.breakMinutes || 0) / 60
          : 0;
        employeeMap[entry.userId].totalHours += hours;
        employeeMap[entry.userId].breakMinutes += entry.breakMinutes || 0;
        employeeMap[entry.userId].timeEntries.push({
          id: entry.id,
          clockInTime: entry.clockInTime,
          clockOutTime: entry.clockOutTime,
          breakMinutes: entry.breakMinutes,
          hours: Math.round(hours * 100) / 100,
          notes: entry.notes,
          isApproved: entry.isApproved,
          missingClockOut: !clockOut,
        });

        if (!clockOut) {
          const daySchedules = schedulesData.filter(s =>
            s.userId === entry.userId &&
            new Date(s.startTime).toDateString() === clockIn.toDateString()
          );
          employeeMap[entry.userId].discrepancies.push({
            type: 'missing_clock_out',
            date: clockIn.toISOString(),
            message: 'Employee did not clock out',
            scheduledShift: daySchedules.length > 0 ? {
              start: daySchedules[0].startTime,
              end: daySchedules[0].endTime,
              scheduledHours: (new Date(daySchedules[0].endTime).getTime() - new Date(daySchedules[0].startTime).getTime()) / (1000 * 60 * 60),
            } : null,
          });
        }

        const entryMonth = clockIn.getMonth() + 1;
        const entryDay = clockIn.getDate();
        const matchingHoliday = holidayMap.get(`${entryMonth}-${entryDay}`);
        if (matchingHoliday) {
          const mult = parseFloat(matchingHoliday.payMultiplier || '1');
          employeeMap[entry.userId].holidayHours += hours;
          employeeMap[entry.userId].holidayPayExtra += hours * employeeMap[entry.userId].hourlyRate * (mult - 1);
        }
      }

      for (const schedule of schedulesData) {
        const uid = schedule.userId;
        if (!employeeMap[uid]) {
          const user = userMap.get(uid);
          if (!user) continue;
          employeeMap[uid] = {
            userId: uid,
            name: `${user.firstName || ''} ${user.lastName || ''}`.trim() || user.email || 'Unknown',
            email: user.email || '',
            phone: (user as any).phone || '',
            totalHours: 0,
            scheduledHours: 0,
            regularHours: 0,
            overtimeHours: 0,
            holidayHours: 0,
            breakMinutes: 0,
            hourlyRate: parseFloat(user.hourlyRate || "0"),
            regularPay: 0,
            overtimePay: 0,
            holidayPayExtra: 0,
            totalPay: 0,
            timeEntries: [],
            schedules: [],
            discrepancies: [],
          };
        }
        const schedHours = (new Date(schedule.endTime).getTime() - new Date(schedule.startTime).getTime()) / (1000 * 60 * 60);
        employeeMap[uid].scheduledHours += schedHours;
        employeeMap[uid].schedules.push({
          id: schedule.id,
          startTime: schedule.startTime,
          endTime: schedule.endTime,
          title: schedule.title,
        });

        const hasEntry = timeEntryDateSet.has(
          `${uid}|${new Date(schedule.startTime).toDateString()}`
        );
        if (!hasEntry) {
          employeeMap[uid].discrepancies.push({
            type: 'no_show',
            date: new Date(schedule.startTime).toISOString(),
            message: 'Scheduled but did not clock in',
            scheduledShift: {
              start: schedule.startTime,
              end: schedule.endTime,
              scheduledHours: schedHours,
            },
          });
        }
      }

      for (const emp of Object.values(employeeMap)) {
        emp.regularHours = Math.min(emp.totalHours, overtimeThreshold);
        emp.overtimeHours = Math.max(0, emp.totalHours - overtimeThreshold);
        emp.regularPay = Math.round(emp.regularHours * emp.hourlyRate * 100) / 100;
        emp.overtimePay = Math.round(emp.overtimeHours * emp.hourlyRate * overtimeMultiplier * 100) / 100;
        emp.totalPay = Math.round((emp.regularPay + emp.overtimePay + emp.holidayPayExtra) * 100) / 100;
      }

      const employees = Object.values(employeeMap).sort((a, b) => a.name.localeCompare(b.name));
      const totalDiscrepancies = employees.reduce((sum, e) => sum + e.discrepancies.length, 0);

      res.json({
        period: {
          id: period.id,
          startDate: period.startDate,
          endDate: period.endDate,
          workflowState: period.workflowState,
          isProcessed: period.isProcessed,
        },
        employees,
        summary: {
          totalEmployees: employees.length,
          totalHours: Math.round(employees.reduce((s, e) => s + e.totalHours, 0) * 100) / 100,
          totalScheduledHours: Math.round(employees.reduce((s, e) => s + e.scheduledHours, 0) * 100) / 100,
          totalPay: Math.round(employees.reduce((s, e) => s + e.totalPay, 0) * 100) / 100,
          totalDiscrepancies,
        },
      });
    } catch (error) {
      console.error("Error getting payroll review:", error);
      res.status(500).json({ message: "Failed to get payroll review" });
    }
  });

  app.post('/api/payroll/periods/:id/approve', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const canManage = await resolveAnyPermission(userId, ['admin.manage_payroll', 'admin.manage_all'], storage);
      if (!canManage) return res.status(403).json({ message: "Payroll management access required" });

      const period = await storage.getPayrollPeriod(req.params.id);
      if (!period) return res.status(404).json({ message: "Pay period not found" });

      await storage.updatePayrollPeriod(req.params.id, {
        workflowState: 'processed',
        isProcessed: true,
        processedBy: userId,
        processedAt: new Date(),
      });

      res.json({ message: "Payroll approved successfully" });
    } catch (error) {
      console.error("Error approving payroll:", error);
      res.status(500).json({ message: "Failed to approve payroll" });
    }
  });

  app.post('/api/payroll/periods/:id/email-export', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const canManage = await resolveAnyPermission(userId, ['admin.manage_payroll', 'admin.manage_all'], storage);
      if (!canManage) return res.status(403).json({ message: "Payroll management access required" });

      const { email } = req.body;
      if (!email) return res.status(400).json({ message: "Accountant email is required" });

      const period = await storage.getPayrollPeriod(req.params.id);
      if (!period) return res.status(404).json({ message: "Pay period not found" });

      res.json({ message: `Payroll export would be emailed to ${email}. Email integration pending setup.` });
    } catch (error) {
      console.error("Error emailing payroll:", error);
      res.status(500).json({ message: "Failed to email payroll" });
    }
  });

  app.get('/api/payroll/setup-status', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.id;
            const canManagePayroll = await resolveAnyPermission(userId, ['admin.manage_payroll', 'admin.manage_all'], storage);
      
      const settings = await storage.getPayrollSettings();
      
      res.json({ 
        needsSetup: canManagePayroll && (!settings || !settings.isSetupComplete),
        canManagePayroll 
      });
    } catch (error) {
      console.error("Error checking setup status:", error);
      res.status(500).json({ message: "Failed to check setup status" });
    }
  });
}
