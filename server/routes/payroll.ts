import type { Express } from "express";
import type { IStorage } from "../storage";
import { users, companySettings } from "@shared/schema";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { claudeService } from "../services/claudeService";
import { automationService } from "../services/automationService";
import { payrollAutomationService } from "../services/payrollAutomationService";

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
      
      const timeEntries = await storage.getAllTimeEntries(start, end);
      
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
      const userPermissions = await storage.getUserPermissions(userId);
      const canManagePayroll = userPermissions.some(p => p.name === 'admin.manage_payroll' || p.name === 'admin.manage_all');
      
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
      const userPermissions = await storage.getUserPermissions(userId);
      const canManagePayroll = userPermissions.some(p => p.name === 'admin.manage_payroll' || p.name === 'admin.manage_all');
      
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
      const userPermissions = await storage.getUserPermissions(userId);
      const canManagePayroll = userPermissions.some(p => p.name === 'admin.manage_payroll' || p.name === 'admin.manage_all');
      
      if (!canManagePayroll) {
        return res.status(403).json({ message: "Payroll management access required" });
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
      const userPermissions = await storage.getUserPermissions(userId);
      const canManage = userPermissions.some(p => p.name === 'admin.manage_payroll' || p.name === 'admin.manage_all');

      if (!canManage) {
        return res.status(403).json({ message: "Payroll management access required" });
      }

      const { startDate, endDate } = req.query;
      if (!startDate || !endDate) {
        return res.status(400).json({ message: "startDate and endDate query parameters are required" });
      }

      const start = new Date(startDate as string);
      const end = new Date(endDate as string);

      const timeEntriesData = await storage.getAllTimeEntries(start, end);
      const allUsers = await db.select().from(users);
      const [settings] = await db.select().from(companySettings).limit(1);
      const holidayRules = await storage.getAllHolidayPayRules();

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
          const user = allUsers.find(u => u.id === entry.userId);
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
        const matchingHoliday = holidayRules.find(
          r => r.month === entryMonth && r.day === entryDay
        );
        if (matchingHoliday) {
          const multiplier = parseFloat(matchingHoliday.payMultiplier);
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
      const userPermissions = await storage.getUserPermissions(userId);
      const canManagePayroll = userPermissions.some(p => p.name === 'admin.manage_payroll' || p.name === 'admin.manage_all');
      
      if (!canManagePayroll) {
        return res.status(403).json({ message: "Payroll management access required" });
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
      const userPermissions = await storage.getUserPermissions(userId);
      const canManagePayroll = userPermissions.some(p => 
        p.name === 'admin.manage_payroll' || p.name === 'admin.manage_all'
      );
      
      if (!canManagePayroll) {
        return res.status(403).json({ message: "Payroll management access required" });
      }

      const { 
        intervalType, 
        firstPayPeriodStart, 
        firstPayPeriodEnd, 
        isAutomationEnabled, 
        notificationUserId,
        isSetupComplete 
      } = req.body;

      const existingSettings = await storage.getPayrollSettings();
      
      if (existingSettings) {
        await storage.updatePayrollSettings(existingSettings.id, {
          intervalType,
          firstPayPeriodStart: new Date(firstPayPeriodStart),
          firstPayPeriodEnd: new Date(firstPayPeriodEnd),
          isAutomationEnabled,
          notificationUserId,
          isSetupComplete,
          updatedBy: userId,
        });
      } else {
        await storage.createPayrollSettings({
          intervalType,
          firstPayPeriodStart: new Date(firstPayPeriodStart),
          firstPayPeriodEnd: new Date(firstPayPeriodEnd),
          isAutomationEnabled,
          notificationUserId,
          isSetupComplete,
          createdBy: userId,
        });
      }

      await storage.createPayrollPeriod({
        startDate: new Date(firstPayPeriodStart),
        endDate: new Date(firstPayPeriodEnd),
        workflowState: 'created',
      });

      if (isAutomationEnabled) {
        await payrollAutomationService.scheduleNextPayrollPeriods(intervalType, new Date(firstPayPeriodEnd));
      }

      res.json({ message: "Payroll setup completed successfully" });
    } catch (error) {
      console.error("Error setting up payroll:", error);
      res.status(500).json({ message: "Failed to setup payroll" });
    }
  });

  app.get('/api/payroll/setup-status', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const userPermissions = await storage.getUserPermissions(userId);
      const canManagePayroll = userPermissions.some(p => 
        p.name === 'admin.manage_payroll' || p.name === 'admin.manage_all'
      );
      
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
