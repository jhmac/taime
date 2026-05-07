import type { Express } from "express";
import type { IStorage } from "../storage";
import { users, tasks, roles } from "@shared/schema";
import { db } from "../db";
import { inArray, eq } from "drizzle-orm";
import fs from "fs";
import path from "path";
import { claudeService } from "../services/claudeService";
import { notificationService } from "../services/notificationService";
import rateLimit from "express-rate-limit";
import { resolvePermission, resolveAnyPermission } from "../services/permissionResolver";

const aiRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  message: { message: "Too many AI requests, please try again later" },
  standardHeaders: true,
  legacyHeaders: false,
});

type BroadcastFn = (data: Record<string, unknown>) => void;

// Durable daily-run guard — persisted to disk so server restarts don't cause re-runs.
const AUTO_ASSIGN_DATE_FILE = path.join(process.cwd(), ".local", "last-auto-assign-date.txt");

function readLastAutoAssignDate(): string | null {
  try { return fs.readFileSync(AUTO_ASSIGN_DATE_FILE, "utf-8").trim(); } catch { return null; }
}

function writeLastAutoAssignDate(dateStr: string): void {
  try {
    fs.mkdirSync(path.dirname(AUTO_ASSIGN_DATE_FILE), { recursive: true });
    fs.writeFileSync(AUTO_ASSIGN_DATE_FILE, dateStr, "utf-8");
  } catch { /* non-fatal */ }
}

// Eligible-role token contract: tasks store canonical tokens { all, team, manager, admin, owner }.
// DB roles table uses 'employee' as the name for the 'team' role.
// Map DB role name → canonical token before comparing.
function dbRoleToToken(roleName: string): string {
  return roleName === "employee" ? "team" : roleName;
}

// Check if an employee's DB role name satisfies the task's eligibleRoles token list.
function isEligible(employeeRole: string | null, eligibleRoles: string[] | null): boolean {
  if (!eligibleRoles || eligibleRoles.length === 0) return true;
  if (eligibleRoles.includes("all")) return true;
  if (!employeeRole) return false;
  return eligibleRoles.includes(dbRoleToToken(employeeRole));
}

// Shared assignment logic — used by both the manual endpoint and auto-assign on task creation
export async function runAutoAssign(
  storage: IStorage,
  broadcastToAll?: BroadcastFn,
): Promise<{ assignments: { choreId: string; assignedTo: string; reasoning: string; estimatedCompletion: string }[]; source: string; message?: string }> {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  // 1. Build employee pool — clocked-in employees are the primary pool for daily assignment.
  //    Fall back to today's scheduled employees if nobody is clocked in yet
  //    (common early in the morning before shifts start).
  type PoolEntry = { id: string; name: string; shiftStart: string; shiftEnd: string; skills: string[]; workload: number; pastPerformance: number; roleName: string | null };

  async function buildPoolWithRoles(userList: { id: string; firstName: string | null; lastName: string | null; shiftStart?: string; shiftEnd?: string }[]): Promise<PoolEntry[]> {
    const ids = userList.map(u => u.id);
    if (ids.length === 0) return [];
    const userRoleRows = await db.select({ id: users.id, roleId: users.roleId }).from(users).where(inArray(users.id, ids));
    const roleIdsNeeded = Array.from(new Set(userRoleRows.map(r => r.roleId).filter(Boolean) as string[]));
    const roleNameRows = roleIdsNeeded.length > 0
      ? await db.select({ id: roles.id, name: roles.name }).from(roles).where(inArray(roles.id, roleIdsNeeded))
      : [];
    const roleById = new Map(roleNameRows.map(r => [r.id, r.name]));
    const roleByUserId = new Map(userRoleRows.map(r => [r.id, r.roleId ? roleById.get(r.roleId) ?? null : null]));
    return userList.map(u => ({
      id: u.id,
      name: `${u.firstName || ''} ${u.lastName || ''}`.trim(),
      shiftStart: u.shiftStart ?? '',
      shiftEnd: u.shiftEnd ?? '',
      skills: [],
      workload: 50,
      pastPerformance: 85,
      roleName: roleByUserId.get(u.id) ?? null,
    }));
  }

  const clockedIn = await storage.getClockedInUsers();
  let employeePool: PoolEntry[];
  let source: string;

  if (clockedIn.length > 0) {
    employeePool = await buildPoolWithRoles(clockedIn.map(u => ({ id: u.id, firstName: u.firstName, lastName: u.lastName })));
    source = 'clocked-in';
  } else {
    // Fall back to today's scheduled employees (early-morning run before anyone clocks in)
    const schedules = await storage.getAllSchedules(today, tomorrow);
    const seenIds = new Set<string>();
    const uniqueScheduled: { id: string; firstName: string | null; lastName: string | null; shiftStart: string; shiftEnd: string }[] = [];
    const uniqueUserIds = Array.from(new Set(schedules.map(s => s.userId)));
    const scheduledUsers = uniqueUserIds.length > 0
      ? await db.select({ id: users.id, firstName: users.firstName, lastName: users.lastName }).from(users).where(inArray(users.id, uniqueUserIds))
      : [];
    const userMap = new Map(scheduledUsers.map(u => [u.id, u]));
    for (const s of schedules) {
      if (seenIds.has(s.userId)) continue;
      seenIds.add(s.userId);
      const u = userMap.get(s.userId);
      if (u) uniqueScheduled.push({ ...u, shiftStart: s.startTime.toISOString(), shiftEnd: s.endTime.toISOString() });
    }
    employeePool = await buildPoolWithRoles(uniqueScheduled);
    source = 'schedule';
  }

  if (employeePool.length === 0) {
    return { assignments: [], source, message: 'No employees clocked in or scheduled' };
  }

  // 3. Gather tasks to distribute:
  //    - Overdue/missed tasks: due before today, not completed
  //    - Due today: due on or before end of today, not completed
  //    - Unassigned pending tasks with no due date
  const allTasks = await storage.getAllTasks();
  const endOfToday = new Date(today);
  endOfToday.setHours(23, 59, 59, 999);

  const availableChores = allTasks.filter(task => {
    if (task.status === 'completed' || task.status === 'cancelled') return false;
    // Skip tasks that are already manually pinned (assigned but not AI-assigned)
    if (task.assignedTo && !task.isAIAssigned) return false;
    // Skip tasks with a deferred pin intent waiting for the employee to clock in
    if (task.pinnedTo) return false;
    if (task.dueDate) {
      return new Date(task.dueDate) <= endOfToday;
    }
    return !task.assignedTo && task.status === 'pending';
  });

  if (availableChores.length === 0) {
    return { assignments: [], source, message: 'No tasks to distribute' };
  }

  // 4. Round-robin distribution, filtering pool by each task's eligibleRoles.
  //    A single global counter ensures different tasks go to different employees
  //    (cycling through the eligible pool in order across all task assignments).
  const assignments: { choreId: string; assignedTo: string; reasoning: string; estimatedCompletion: string }[] = [];
  let globalRoundRobinIndex = 0;

  for (const task of availableChores) {
    const eligiblePool = employeePool.filter(emp => isEligible(emp.roleName, task.eligibleRoles as string[] | null));
    if (eligiblePool.length === 0) continue;

    const roleDesc = task.eligibleRoles && !task.eligibleRoles.includes('all')
      ? task.eligibleRoles.join(', ')
      : 'all roles';

    const employee = eligiblePool[globalRoundRobinIndex % eligiblePool.length];
    globalRoundRobinIndex++;

    assignments.push({
      choreId: task.id,
      assignedTo: employee.id,
      reasoning: `Morning distribution — shared equally across eligible employees (${roleDesc})`,
      estimatedCompletion: employee.shiftEnd || '',
    });
  }

  for (const assignment of assignments) {
    const updated = await storage.updateTask(assignment.choreId, {
      assignedTo: assignment.assignedTo,
      isAIAssigned: true,
      aiReasoning: assignment.reasoning,
    });

    // Push real-time update so open task list views refresh automatically
    broadcastToAll?.({ type: 'task_updated', data: { task: updated } });

    if (updated) {
      await notificationService.sendTaskAssignment(
        assignment.assignedTo,
        updated.title,
        assignment.estimatedCompletion,
      );
    }
  }

  return { assignments, source };
}

/**
 * Activates any deferred manual pins for a specific user.
 * Called whenever a user clocks in. If a manager previously pinned a task to
 * this employee while they were off-shift, the task's assignedTo is set now.
 */
export async function activateDeferredPins(
  userId: string,
  storage: IStorage,
  broadcastToAll?: BroadcastFn,
): Promise<void> {
  const pinnedRows = await db
    .select({ id: tasks.id })
    .from(tasks)
    .where(eq(tasks.pinnedTo, userId));
  for (const row of pinnedRows) {
    const updated = await storage.updateTask(row.id, {
      assignedTo: userId,
      pinnedTo: null,
    });
    broadcastToAll?.({ type: 'task_updated', data: { task: updated } });
  }
}

export function scheduleDailyAutoAssign(storage: IStorage, broadcastToAll: BroadcastFn): void {
  const runIfNeeded = async () => {
    const todayStr = new Date().toDateString();
    if (readLastAutoAssignDate() === todayStr) return;
    try {
      const settings = await storage.getCompanySettings();
      if (!settings?.taskAutoAssign) return;
      console.log('[auto-assign] Running daily auto-assign...');
      const result = await runAutoAssign(storage, broadcastToAll);
      writeLastAutoAssignDate(todayStr);
      console.log(`[auto-assign] Daily run complete: ${result.assignments.length} assignment(s) made`);
    } catch (err) {
      console.error('[auto-assign] Daily run failed:', err);
    }
  };

  // Run once shortly after boot
  setTimeout(runIfNeeded, 5000);
  // Then run every 24 hours
  setInterval(runIfNeeded, 24 * 60 * 60 * 1000);
}

/**
 * Redistributes all AI-assigned pending tasks equally among currently clocked-in employees.
 * Called whenever a new employee clocks in so the workload stays balanced.
 * Fire-and-forget — errors are logged but do not affect the clock-in response.
 */
export async function runClockInRedistribute(
  storage: IStorage,
  broadcastToAll?: BroadcastFn,
): Promise<void> {
  const clockedIn = await storage.getClockedInUsers();
  if (clockedIn.length === 0) return;

  // Today's day-of-week in lowercase (e.g. "monday") to match the dayOfWeek column
  const todayDow = new Date().toLocaleDateString('en-US', { weekday: 'long' }).toLowerCase();

  const allTasks = await storage.getAllTasks();

  // Include tasks that should be assigned/re-assigned today:
  //  1. Already AI-assigned pending tasks (rebalance as more people clock in)
  //  2. Unassigned pending tasks that are for today or have no specific day
  // In both cases skip: manually-assigned tasks, deferred pins, completed/cancelled, and tasks for other days.
  const pendingTasks = allTasks.filter(t => {
    if (t.status === 'completed' || t.status === 'cancelled') return false;
    // Skip tasks with a deferred pin intent — they wait for the pinned employee to clock in
    if (t.pinnedTo) return false;
    // Skip tasks that are explicitly manually assigned by a manager (not eligible for AI redistribution)
    if (t.assignedTo && !t.isAIAssigned) return false;
    // Only include tasks for today or with no specific day scheduled
    if (t.dayOfWeek && t.dayOfWeek !== todayDow) return false;
    // Include: already AI-assigned (rebalance) OR unassigned pending (first assignment)
    return t.isAIAssigned || (!t.assignedTo && t.status === 'pending');
  });

  if (pendingTasks.length === 0) return;

  // Fetch role names for clocked-in employees so eligibility can be respected
  const clockedInIds = clockedIn.map(u => u.id);
  const userRoleRows = clockedInIds.length > 0
    ? await db.select({ id: users.id, roleId: users.roleId }).from(users).where(inArray(users.id, clockedInIds))
    : [];
  const roleIdsNeeded = Array.from(new Set(userRoleRows.map(r => r.roleId).filter(Boolean) as string[]));
  const roleNameRows = roleIdsNeeded.length > 0
    ? await db.select({ id: roles.id, name: roles.name }).from(roles).where(inArray(roles.id, roleIdsNeeded))
    : [];
  const roleById = new Map(roleNameRows.map(r => [r.id, r.name]));
  const roleByUserId = new Map(userRoleRows.map(r => [r.id, r.roleId ? roleById.get(r.roleId) ?? null : null]));

  const clockedInPool = clockedIn.map(u => ({ id: u.id, roleName: roleByUserId.get(u.id) ?? null }));

  let roundRobinIndex = 0;
  for (const task of pendingTasks) {
    // Filter pool by task's eligible roles before redistributing
    const eligiblePool = clockedInPool.filter(emp => isEligible(emp.roleName, task.eligibleRoles as string[] | null));
    if (eligiblePool.length === 0) continue;

    const newAssigneeId = eligiblePool[roundRobinIndex % eligiblePool.length].id;
    roundRobinIndex++;
    if (task.assignedTo !== newAssigneeId) {
      const updated = await storage.updateTask(task.id, {
        assignedTo: newAssigneeId,
        isAIAssigned: true,
        aiReasoning: `Auto-assigned on clock-in — distributed equally across ${eligiblePool.length} eligible clocked-in employee(s)`,
      });
      broadcastToAll?.({ type: 'task_updated', data: { task: updated } });
    }
  }
}

export function registerAIRoutes(app: Express, storage: IStorage, isAuthenticated: any, broadcastToAll: BroadcastFn) {
  app.post('/api/ai/assign-chores', isAuthenticated, aiRateLimiter, async (req: any, res) => {
    try {
      const result = await runAutoAssign(storage, broadcastToAll);
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
      const canView = await resolveAnyPermission(userId, ['hr.view_team', 'admin.manage_all'], storage);

      if (!canView) {
        return res.status(403).json({ message: "HR or admin access required" });
      }

      const endDate = new Date();
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - 30);

      const timeEntriesData = await storage.getAllTimeEntries(startDate, endDate, false, null);
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
        } as any);
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
      const canManage = await resolveAnyPermission(userId, ['admin.manage_payroll', 'admin.manage_all'], storage);

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
