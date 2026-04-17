import type { Express } from "express";
import type { IStorage } from "../storage";
import { users } from "@shared/schema";
import { db } from "../db";
import { inArray } from "drizzle-orm";
import { claudeService } from "../services/claudeService";
import { notificationService } from "../services/notificationService";
import rateLimit from "express-rate-limit";

const aiRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  message: { message: "Too many AI requests, please try again later" },
  standardHeaders: true,
  legacyHeaders: false,
});

// Shared assignment logic — used by both the manual endpoint and auto-assign on task creation
export async function runAutoAssign(storage: IStorage): Promise<{ assignments: { choreId: string; assignedTo: string; reasoning: string; estimatedCompletion: string }[]; source: string; message?: string }> {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  // 1. Try scheduled employees first
  const schedules = await storage.getAllSchedules(today, tomorrow);
  const tasks = await storage.getTasksForDate(today);

  const uniqueUserIds = Array.from(new Set(schedules.map(s => s.userId)));
  const userRows = uniqueUserIds.length > 0
    ? await db.select({ id: users.id, firstName: users.firstName, lastName: users.lastName })
        .from(users)
        .where(inArray(users.id, uniqueUserIds))
    : [];
  const usersById = new Map(userRows.map(u => [u.id, u]));

  let employeePool: { id: string; name: string; shiftStart?: string; shiftEnd?: string; skills: string[]; workload: number; pastPerformance: number }[] = schedules.map((schedule) => {
    const user = usersById.get(schedule.userId);
    return {
      id: schedule.userId,
      name: `${user?.firstName || ''} ${user?.lastName || ''}`.trim(),
      shiftStart: schedule.startTime.toISOString(),
      shiftEnd: schedule.endTime.toISOString(),
      skills: [],
      workload: 50,
      pastPerformance: 85,
    };
  });

  let source = 'schedule';

  // 2. Fall back to clocked-in employees if nobody is scheduled today
  if (employeePool.length === 0) {
    const clockedIn = await storage.getClockedInUsers();
    employeePool = clockedIn.map(u => ({
      id: u.id,
      name: `${u.firstName || ''} ${u.lastName || ''}`.trim(),
      skills: [],
      workload: 50,
      pastPerformance: 85,
    }));
    source = 'clocked-in';
  }

  const availableChores = tasks
    .filter(task => !task.assignedTo && task.status === 'pending')
    .map(task => ({
      id: task.id,
      title: task.title,
      description: task.description || '',
      estimatedMinutes: task.estimatedMinutes || 30,
      requiredSkills: [],
      priority: 'medium' as const,
    }));

  if (availableChores.length === 0) {
    return { assignments: [], source, message: 'No unassigned chores available' };
  }

  if (employeePool.length === 0) {
    return { assignments: [], source, message: 'No employees scheduled or clocked in' };
  }

  const result = await claudeService.assignChores({
    scheduledEmployees: employeePool,
    availableChores,
  });

  for (const assignment of result.assignments) {
    await storage.updateTask(assignment.choreId, {
      assignedTo: assignment.assignedTo,
      isAIAssigned: true,
      aiReasoning: assignment.reasoning,
    });

    const task = await storage.getTask(assignment.choreId);
    if (task) {
      await notificationService.sendTaskAssignment(
        assignment.assignedTo,
        task.title,
        assignment.estimatedCompletion
      );
    }
  }

  return { ...result, source };
}

export function registerAIRoutes(app: Express, storage: IStorage, isAuthenticated: any) {
  app.post('/api/ai/assign-chores', isAuthenticated, aiRateLimiter, async (req: any, res) => {
    try {
      const result = await runAutoAssign(storage);
      if (result.message && result.assignments.length === 0) {
        return res.json({ message: result.message });
      }
      const count = result.assignments.length;
      res.json({
        ...result,
        message: result.source === 'clocked-in'
          ? `${count} task${count !== 1 ? 's' : ''} assigned to clocked-in employees (no schedule found for today)`
          : undefined,
      });
    } catch (error) {
      console.error("Error assigning chores:", error);
      res.status(500).json({ message: "Failed to assign chores with AI" });
    }
  });

  app.post('/api/ai/chat', isAuthenticated, aiRateLimiter, async (req: any, res) => {
    try {
      const { message } = req.body;
      const userId = req.user.id;

      if (!message || typeof message !== 'string') {
        return res.status(400).json({ message: "Message is required" });
      }
      if (message.length > 2000) {
        return res.status(400).json({ message: "Message too long (max 2000 characters)" });
      }
      
      const user = await storage.getUser(userId);
      const activeTimeEntry = await storage.getActiveTimeEntry(userId);
      const recentTasks = await storage.getUserTasks(userId);
      
      const context = {
        user: {
          name: `${user?.firstName} ${user?.lastName}`,
          role: 'employee',
        },
        isCurrentlyClockedIn: !!activeTimeEntry,
        recentTasks: recentTasks.slice(0, 5),
      };

      const response = await claudeService.chat(message, context);
      res.json({ response });
    } catch (error) {
      console.error("Error processing AI chat:", error);
      res.status(500).json({ message: "Failed to process AI chat" });
    }
  });

  app.post('/api/ai/detect-anomalies', isAuthenticated, aiRateLimiter, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const userPermissions = await storage.getUserPermissions(userId);
      const canView = userPermissions.some(p => p.name === 'hr.view_team' || p.name === 'admin.manage_all');

      if (!canView) {
        return res.status(403).json({ message: "HR or admin access required" });
      }

      const endDate = new Date();
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - 30);

      const timeEntriesData = await storage.getAllTimeEntries(startDate, endDate);
      const allUsers = await db.select().from(users);
      const userMap: Record<string, string> = {};
      allUsers.forEach(u => {
        userMap[u.id] = `${u.firstName || ''} ${u.lastName || ''}`.trim() || 'Unknown';
      });

      const formattedEntries = timeEntriesData.map(entry => ({
        userId: entry.userId,
        clockInTime: entry.clockInTime.toISOString(),
        clockOutTime: entry.clockOutTime?.toISOString() || '',
        breakMinutes: entry.breakMinutes || 0,
        locationId: entry.locationId || '',
      }));

      const result = await claudeService.detectAnomalies({
        timeEntries: formattedEntries,
        historicalPatterns: {},
      });

      for (const anomaly of result.anomalies) {
        await storage.createAIInsight({
          type: 'anomaly_detected',
          userId: anomaly.userId || null,
          title: anomaly.type,
          description: `${anomaly.description} — Recommendation: ${anomaly.recommendation}`,
          severity: anomaly.severity === 'high' ? 'critical' : anomaly.severity === 'medium' ? 'warning' : 'info',
          isRead: false,
          metadata: { recommendation: anomaly.recommendation, detectedAt: new Date().toISOString() },
        });
      }

      res.json({ anomalies: result.anomalies, patterns: result.patterns });
    } catch (error) {
      console.error("Error detecting anomalies:", error);
      res.status(500).json({ message: "Failed to detect anomalies" });
    }
  });

  app.post('/api/ai/parse-holiday-pay', isAuthenticated, aiRateLimiter, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const userPermissions = await storage.getUserPermissions(userId);
      const canManage = userPermissions.some(p => p.name === 'admin.manage_payroll' || p.name === 'admin.manage_all');

      if (!canManage) {
        return res.status(403).json({ message: "Admin or payroll management access required" });
      }

      const { instruction } = req.body;
      if (!instruction) {
        return res.status(400).json({ message: "Instruction text is required" });
      }

      const result = await claudeService.parseHolidayPayRules(instruction);

      if (!result.holidays || !Array.isArray(result.holidays)) {
        return res.status(500).json({ message: "AI returned invalid response format" });
      }

      const savedRules = [];
      const existingRules = await storage.getAllHolidayPayRules();
      for (const holiday of result.holidays) {
        if (!holiday.name || typeof holiday.month !== 'number' || typeof holiday.day !== 'number') continue;
        if (holiday.month < 1 || holiday.month > 12 || holiday.day < 1 || holiday.day > 31) continue;
        const multiplier = typeof holiday.payMultiplier === 'number' && holiday.payMultiplier > 0 ? holiday.payMultiplier : 1.5;

        const existing = existingRules.find(
          r => r.month === holiday.month && r.day === holiday.day
        );
        if (existing) {
          const updated = await storage.updateHolidayPayRule(existing.id, {
            name: holiday.name,
            payMultiplier: multiplier.toFixed(2),
          });
          savedRules.push(updated);
        } else {
          const rule = await storage.createHolidayPayRule({
            name: holiday.name,
            month: holiday.month,
            day: holiday.day,
            payMultiplier: multiplier.toFixed(2),
            isActive: true,
            createdBy: userId,
          });
          savedRules.push(rule);
        }
      }

      res.json({ rules: savedRules, summary: result.summary });
    } catch (error) {
      console.error("Error parsing holiday pay rules:", error);
      res.status(500).json({ message: "Failed to parse holiday pay instructions" });
    }
  });
}
