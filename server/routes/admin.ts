import type { Express } from "express";
import type { IStorage } from "../storage";
import { z } from "zod";
import { cache } from "../lib/cache";
import { asyncHandler, AppError } from "../lib/routeWrapper";
import { tryResolveStoreIdForUser } from "../lib/storeResolver";

const companySettingsUpdateSchema = z.object({
  companyName: z.string().max(200).optional(),
  timezone: z.string().max(50).optional(),
  businessStartHour: z.number().int().min(0).max(23).optional(),
  businessEndHour: z.number().int().min(0).max(23).optional(),
  overtimeThresholdHours: z.number().int().min(1).max(168).optional(),
  overtimeMultiplier: z.string().optional(),
  geofenceEnforcement: z.boolean().optional(),
  breakDurationMinutes: z.number().int().min(0).max(120).optional(),
  autoClockOutMinutes: z.number().int().min(0).max(1440).optional(),
  defaultGeofenceRadius: z.number().int().min(10).max(10000).optional(),
  locationPhone: z.string().max(30).nullable().optional(),
  address1: z.string().max(200).nullable().optional(),
  address2: z.string().max(200).nullable().optional(),
  city: z.string().max(100).nullable().optional(),
  stateProvince: z.string().max(100).nullable().optional(),
  zipCode: z.string().max(20).nullable().optional(),
  country: z.string().max(100).nullable().optional(),
  businessType: z.string().max(100).nullable().optional(),
  businessCategory: z.string().max(100).nullable().optional(),
  website: z.string().max(200).nullable().optional(),
  accountOwnerName: z.string().max(200).nullable().optional(),
  companyPhone: z.string().max(30).nullable().optional(),
  workWeekStart: z.enum(['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']).optional(),
  schedulingStartTime: z.string().max(10).optional(),
  schedulingEndTime: z.string().max(10).optional(),
  lateThresholdMinutes: z.number().int().min(0).max(120).optional(),
  preventEarlyClockIn: z.boolean().optional(),
  earlyClockInMinutes: z.number().int().min(0).max(60).optional(),
  preventEarlyBreakReturn: z.boolean().optional(),
  singleClockOutReminder: z.boolean().optional(),
  autoClockOutEnabled: z.boolean().optional(),
  autoClockOutAfterMinutes: z.union([z.number(), z.string()]).nullable().optional(),
  textScheduleToEmployees: z.boolean().optional(),
  employeesViewOwnScheduleOnly: z.boolean().optional(),
  notifyManagerLateClockIn: z.boolean().optional(),
  managerLateAlertMinutes: z.number().int().min(1).max(120).optional(),
  requireManagerApprovalAvailability: z.boolean().optional(),
  managersScheduleOwnDept: z.boolean().optional(),
  requestShiftExperience: z.boolean().optional(),
  requireCashTipDeclaration: z.boolean().optional(),
  enableClockRounding: z.boolean().optional(),
  roundingIncrement: z.number().int().min(1).max(30).optional(),
  enableMobileTimeClock: z.boolean().optional(),
  allowUnscheduledMobileClockIn: z.boolean().optional(),
  enableWebTimeClock: z.boolean().optional(),
  allowEmployeeWebClock: z.boolean().optional(),
  unscheduledShiftRoleSelection: z.boolean().optional(),
  enableDailyOvertime: z.boolean().optional(),
  dailyOvertimeHours: z.number().int().min(1).max(24).optional(),
  dailyOvertimeMultiplier: z.string().optional(),
  enableWeeklyOvertime: z.boolean().optional(),
  overtimeAlertEnabled: z.boolean().optional(),
  overtimeAlertHours: z.number().int().min(1).max(168).optional(),
  startOfWorkday: z.string().max(10).optional(),
  trackOvertimeAcrossLocations: z.boolean().optional(),
  enableHolidayPayRate: z.boolean().optional(),
  holidayPayMultiplier: z.string().optional(),
  breakRule1Enabled: z.boolean().optional(),
  breakRule1Minutes: z.number().int().min(1).max(120).optional(),
  breakRule1Type: z.enum(['paid', 'unpaid']).optional(),
  breakRule1EveryHours: z.number().int().min(1).max(24).optional(),
  breakRule1Required: z.enum(['optional', 'mandatory']).optional(),
  breakRule2Enabled: z.boolean().optional(),
  breakRule2Minutes: z.number().int().min(1).max(120).optional(),
  breakRule2Type: z.enum(['paid', 'unpaid']).optional(),
  breakRule2EveryHours: z.number().int().min(1).max(24).optional(),
  breakRule2Required: z.enum(['optional', 'mandatory']).optional(),
  subtractUnpaidBreaks: z.boolean().optional(),
  convertExcessToUnpaid: z.boolean().optional(),
  awardMissedBreakHours: z.boolean().optional(),
  missedBreakAwardHours: z.number().int().min(0).max(8).optional(),
  missedBreakPolicy: z.enum(['managers_only', 'team_members']).optional(),
  payScheduleFrequency: z.enum(['weekly', 'every_two_weeks', 'semi_monthly', 'monthly']).optional(),
  nextPayrollDate: z.string().max(20).nullable().optional(),
  lockTimesheetsAfterApproval: z.boolean().optional(),
  timeOffMaxPerDay: z.number().int().min(0).max(100).nullable().optional(),
  timeOffAdvanceDays: z.number().int().min(0).max(365).optional(),
  limitTimeOffRequests: z.boolean().optional(),
  limitTimeOffAdvance: z.boolean().optional(),
  allowShoutOuts: z.boolean().optional(),
  allowTeamMessaging: z.boolean().optional(),
  enableScheduleEvents: z.boolean().optional(),
  allowUnscheduledClockIn: z.boolean().optional(),
  enableSmartClockPrompt: z.boolean().optional(),
  enableClockOutOnFocusLoss: z.boolean().optional(),
  focusLossGraceSeconds: z.number().int().min(5).max(300).optional(),
  autoResumeWindowSeconds: z.number().int().min(30).max(600).optional(),
  requireMobileClockIn: z.boolean().optional(),
  defaultMileageRateCents: z.number().int().min(0).max(1000).optional(),
}).strict();

async function requireAdmin(storage: IStorage, userId: string): Promise<void> {
  const perms = await storage.getUserPermissions(userId);
  if (!perms.some(p => p.name === 'admin.manage_all')) {
    throw new AppError(403, "Admin access required", "FORBIDDEN");
  }
}

async function requirePayrollOrAdmin(storage: IStorage, userId: string): Promise<void> {
  const perms = await storage.getUserPermissions(userId);
  if (!perms.some(p => p.name === 'admin.manage_payroll' || p.name === 'admin.manage_all')) {
    throw new AppError(403, "Admin or payroll management access required", "FORBIDDEN");
  }
}

const DEFAULT_SETTINGS = {
  companyName: 'My Company',
  timezone: 'America/New_York',
  businessStartHour: 8,
  businessEndHour: 17,
  overtimeThresholdHours: 40,
  overtimeMultiplier: '1.50',
  geofenceEnforcement: false,
  breakDurationMinutes: 30,
  autoClockOutMinutes: 480,
};

export function registerAdminRoutes(app: Express, storage: IStorage, isAuthenticated: any) {
  app.get('/api/company-settings', isAuthenticated, asyncHandler(async (req: any, res) => {
    const storeId = await tryResolveStoreIdForUser(req.user.id);
    const cacheKey = storeId ? `company:settings:${storeId}` : 'company:settings';
    const cached = cache.get(cacheKey);
    if (cached) return res.json(cached);
    const settings = await storage.getCompanySettings(storeId || undefined);
    const result = settings || DEFAULT_SETTINGS;
    cache.set(cacheKey, result);
    res.json(result);
  }));

  app.put('/api/company-settings', isAuthenticated, asyncHandler(async (req: any, res) => {
    const userId = req.user.id;
    await requireAdmin(storage, userId);

    const storeId = await tryResolveStoreIdForUser(userId);

    const { expectedVersion, ...bodyWithoutVersion } = req.body;
    const validated = companySettingsUpdateSchema.parse(bodyWithoutVersion);
    const settingsUpdates: Record<string, any> = { updatedBy: userId, ...validated };

    if (validated.autoClockOutAfterMinutes !== undefined) {
      settingsUpdates.autoClockOutAfterMinutes = validated.autoClockOutAfterMinutes !== null
        ? validated.autoClockOutAfterMinutes.toString()
        : null;
    }

    if (expectedVersion !== undefined) {
      const parsedVersion = z.number().int().safeParse(expectedVersion);
      if (parsedVersion.success) {
        settingsUpdates.expectedVersion = parsedVersion.data;
      }
    }

    const settings = await storage.updateCompanySettings(settingsUpdates, storeId || undefined);
    const cacheKey = storeId ? `company:settings:${storeId}` : 'company:settings';
    cache.invalidate(cacheKey);
    await storage.createActivityLog({ userId, action: 'update', targetType: 'company_settings', details: 'Updated company settings' });
    res.json(settings);
  }));

  app.get('/api/activity-logs', isAuthenticated, asyncHandler(async (req: any, res) => {
    await requireAdmin(storage, req.user.id);
    const limit = Math.min(Math.max(parseInt(req.query.limit as string) || 50, 1), 200);
    const logs = await storage.getActivityLogs(limit);
    res.json(logs);
  }));

  app.post('/api/holiday-pay-rules/bulk', isAuthenticated, asyncHandler(async (req: any, res) => {
    await requirePayrollOrAdmin(storage, req.user.id);

    const { holidays } = req.body;
    if (!Array.isArray(holidays) || holidays.length === 0) {
      throw new AppError(400, "Please provide an array of holidays", "VALIDATION_ERROR");
    }

    const existingRules = await storage.getAllHolidayPayRules();
    const saved = [];
    for (const h of holidays) {
      if (!h.name || typeof h.month !== 'number' || typeof h.day !== 'number') continue;
      if (h.month < 1 || h.month > 12 || h.day < 1 || h.day > 31) continue;
      const multiplier = typeof h.payMultiplier === 'number' && h.payMultiplier > 0 && h.payMultiplier <= 5 ? h.payMultiplier : 1.5;

      const existing = existingRules.find(r => r.month === h.month && r.day === h.day);
      if (existing) {
        const updated = await storage.updateHolidayPayRule(existing.id, {
          name: h.name,
          payMultiplier: multiplier.toFixed(2),
          isActive: true,
        });
        saved.push(updated);
      } else {
        const rule = await storage.createHolidayPayRule({
          name: h.name,
          month: h.month,
          day: h.day,
          payMultiplier: multiplier.toFixed(2),
          isActive: true,
          createdBy: req.user.id,
        });
        saved.push(rule);
      }
    }

    res.json({ rules: saved, count: saved.length });
  }));

  app.get('/api/holiday-pay-rules', isAuthenticated, asyncHandler(async (_req: any, res) => {
    const rules = await storage.getAllHolidayPayRules();
    res.json(rules);
  }));

  app.delete('/api/holiday-pay-rules/:id', isAuthenticated, asyncHandler(async (req: any, res) => {
    await requirePayrollOrAdmin(storage, req.user.id);
    const { id } = req.params;
    await storage.deleteHolidayPayRule(id);
    res.json({ success: true });
  }));

  app.patch('/api/holiday-pay-rules/:id', isAuthenticated, asyncHandler(async (req: any, res) => {
    await requirePayrollOrAdmin(storage, req.user.id);
    const { id } = req.params;
    const { name, month, day, payMultiplier, isActive } = req.body;
    const safeUpdates: Record<string, any> = {};
    if (name !== undefined && typeof name === 'string') safeUpdates.name = name;
    if (month !== undefined && typeof month === 'number' && month >= 1 && month <= 12) safeUpdates.month = month;
    if (day !== undefined && typeof day === 'number' && day >= 1 && day <= 31) safeUpdates.day = day;
    if (payMultiplier !== undefined) {
      const mult = parseFloat(payMultiplier);
      if (!isNaN(mult) && mult > 0 && mult <= 5) safeUpdates.payMultiplier = mult.toFixed(2);
    }
    if (isActive !== undefined && typeof isActive === 'boolean') safeUpdates.isActive = isActive;

    const rule = await storage.updateHolidayPayRule(id, safeUpdates);
    res.json(rule);
  }));
}
