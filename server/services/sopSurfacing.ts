import { db } from "../db";
import { sopTemplates, sopExecutions, timeEntries, workLocations, issues, aiSchedulingSettings } from "@shared/schema";
import { eq, and, gte, isNull, desc, sql, count } from "drizzle-orm";
import { cache } from "../lib/cache";
import logger from "../lib/logger";

export interface SurfacedSOP {
  templateId: string;
  title: string;
  category: string;
  reason: string;
  triggerType: "time_based" | "event_based" | "role_based" | "issue_based";
  priority: number;
  trainingModeRecommended: boolean;
  message: string;
}

interface StoreHoursEntry {
  day: number;
  openTime: string;
  closeTime: string;
  isClosed: boolean;
}

const CATEGORY_KEYWORD_MAP: Record<string, string[]> = {
  equipment: ["equipment", "safety", "maintenance", "machine", "repair"],
  safety: ["safety", "equipment", "hazard", "emergency", "injury"],
  process: ["process", "procedure", "workflow", "checklist"],
  customer_experience: ["customer", "service", "complaint", "experience"],
  inventory: ["inventory", "stock", "supply", "order", "receiving"],
  workspace: ["cleaning", "maintenance", "workspace", "facility"],
  training: ["training", "onboarding", "orientation"],
};

async function getStoreHours(): Promise<StoreHoursEntry[]> {
  const cached = cache.get<StoreHoursEntry[]>("surfacing:store_hours");
  if (cached) return cached;

  const settings = await db.select().from(aiSchedulingSettings).limit(1);
  const hours: StoreHoursEntry[] = (settings[0] as any)?.storeHours || [
    { day: 0, openTime: "09:00", closeTime: "21:00", isClosed: true },
    { day: 1, openTime: "09:00", closeTime: "21:00", isClosed: false },
    { day: 2, openTime: "09:00", closeTime: "21:00", isClosed: false },
    { day: 3, openTime: "09:00", closeTime: "21:00", isClosed: false },
    { day: 4, openTime: "09:00", closeTime: "21:00", isClosed: false },
    { day: 5, openTime: "09:00", closeTime: "21:00", isClosed: false },
    { day: 6, openTime: "09:00", closeTime: "21:00", isClosed: false },
  ];

  cache.set("surfacing:store_hours", hours, 5 * 60 * 1000);
  return hours;
}

async function getActiveSOPTemplates(storeId?: string): Promise<any[]> {
  const cacheKey = `surfacing:templates:${storeId || "all"}`;
  const cached = cache.get<any[]>(cacheKey);
  if (cached) return cached;

  const conditions = [eq(sopTemplates.isActive, true)];
  if (storeId) {
    conditions.push(eq(sopTemplates.storeId, storeId));
  }

  const templates = await db
    .select()
    .from(sopTemplates)
    .where(and(...conditions));

  cache.set(cacheKey, templates, 2 * 60 * 1000);
  return templates;
}

async function getEmployeeExecutionCount(
  employeeId: string,
  templateId: string
): Promise<number> {
  const result = await db
    .select({ count: count() })
    .from(sopExecutions)
    .where(
      and(
        eq(sopExecutions.employeeId, employeeId),
        eq(sopExecutions.templateId, templateId),
        eq(sopExecutions.status, "completed")
      )
    );
  return result[0]?.count || 0;
}

function parseTimeToMinutes(timeStr: string): number {
  const [h, m] = timeStr.split(":").map(Number);
  return h * 60 + m;
}

function matchesOpening(template: any): boolean {
  const title = template.title.toLowerCase();
  const cat = (template.category || "").toLowerCase();
  return (
    title.includes("open") ||
    title.includes("morning") ||
    title.includes("start of day") ||
    cat.includes("open")
  );
}

function matchesClosing(template: any): boolean {
  const title = template.title.toLowerCase();
  const cat = (template.category || "").toLowerCase();
  return (
    title.includes("clos") ||
    title.includes("end of day") ||
    title.includes("shutdown") ||
    cat.includes("clos")
  );
}

function matchesHandoff(template: any): boolean {
  const title = template.title.toLowerCase();
  const cat = (template.category || "").toLowerCase();
  return (
    title.includes("handoff") ||
    title.includes("hand-off") ||
    title.includes("shift change") ||
    title.includes("transition") ||
    cat.includes("handoff")
  );
}

export async function getTimeBased(storeId?: string): Promise<SurfacedSOP[]> {
  const now = new Date();
  const dayOfWeek = now.getDay();
  const currentMinutes = now.getHours() * 60 + now.getMinutes();

  const storeHours = await getStoreHours();
  const todayHours = storeHours.find((h) => h.day === dayOfWeek);

  if (!todayHours || todayHours.isClosed) return [];

  const openMinutes = parseTimeToMinutes(todayHours.openTime);
  const closeMinutes = parseTimeToMinutes(todayHours.closeTime);

  const templates = await getActiveSOPTemplates(storeId);
  const surfaced: SurfacedSOP[] = [];

  const withinOpenWindow =
    currentMinutes >= openMinutes - 15 && currentMinutes <= openMinutes + 30;
  const withinCloseWindow =
    currentMinutes >= closeMinutes - 30 && currentMinutes <= closeMinutes;

  if (withinOpenWindow) {
    for (const t of templates) {
      if (matchesOpening(t)) {
        surfaced.push({
          templateId: t.id,
          title: t.title,
          category: t.category,
          reason: "time_based",
          triggerType: "time_based",
          priority: 1,
          trainingModeRecommended: false,
          message: "Opening time! Your Opening Checklist is ready.",
        });
      }
    }
  }

  if (withinCloseWindow) {
    for (const t of templates) {
      if (matchesClosing(t)) {
        surfaced.push({
          templateId: t.id,
          title: t.title,
          category: t.category,
          reason: "time_based",
          triggerType: "time_based",
          priority: 1,
          trainingModeRecommended: false,
          message: `Closing in ${closeMinutes - currentMinutes} minutes! Time for the Closing Checklist.`,
        });
      }
    }
  }

  return surfaced;
}

export async function getShiftHandoffSOPs(
  clockingInUserId: string,
  storeId: string
): Promise<SurfacedSOP[]> {
  const activeEntries = await db
    .select()
    .from(timeEntries)
    .where(
      and(
        isNull(timeEntries.clockOutTime),
        eq(timeEntries.locationId, storeId)
      )
    );

  const otherActive = activeEntries.filter((e) => e.userId !== clockingInUserId);
  if (otherActive.length === 0) return [];

  const templates = await getActiveSOPTemplates(storeId);
  const surfaced: SurfacedSOP[] = [];

  for (const t of templates) {
    if (matchesHandoff(t)) {
      const execCount = await getEmployeeExecutionCount(clockingInUserId, t.id);
      surfaced.push({
        templateId: t.id,
        title: t.title,
        category: t.category,
        reason: "event_based",
        triggerType: "event_based",
        priority: 2,
        trainingModeRecommended: execCount < 3,
        message: "Shift handoff detected! Complete the handoff checklist with your teammate.",
      });
    }
  }

  return surfaced;
}

export async function getOpeningSOPsForClockIn(
  userId: string,
  storeId: string
): Promise<SurfacedSOP[]> {
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  const todayEntries = await db
    .select()
    .from(timeEntries)
    .where(
      and(
        eq(timeEntries.locationId, storeId),
        gte(timeEntries.clockInTime, todayStart)
      )
    );

  const otherEmployeesToday = todayEntries.filter((e) => e.userId !== userId);
  const isFirstShift = otherEmployeesToday.length === 0;

  if (!isFirstShift) return [];

  const templates = await getActiveSOPTemplates(storeId);
  const surfaced: SurfacedSOP[] = [];

  for (const t of templates) {
    if (matchesOpening(t)) {
      const execCount = await getEmployeeExecutionCount(userId, t.id);
      surfaced.push({
        templateId: t.id,
        title: t.title,
        category: t.category,
        reason: "event_based",
        triggerType: "event_based",
        priority: 1,
        trainingModeRecommended: execCount < 3,
        message: "You're the first one in today! Time for the Opening Checklist.",
      });
    }
  }

  return surfaced;
}

export async function getRoleBasedSOPs(
  userId: string,
  storeId?: string
): Promise<SurfacedSOP[]> {
  const templates = await getActiveSOPTemplates(storeId);
  const surfaced: SurfacedSOP[] = [];

  for (const t of templates) {
    const execCount = await getEmployeeExecutionCount(userId, t.id);
    if (execCount < 3 && execCount > 0) {
      surfaced.push({
        templateId: t.id,
        title: t.title,
        category: t.category,
        reason: "role_based",
        triggerType: "role_based",
        priority: 3,
        trainingModeRecommended: true,
        message: `You've completed "${t.title}" ${execCount} time${execCount === 1 ? "" : "s"}. Training mode is recommended.`,
      });
    }
  }

  return surfaced;
}

export async function getIssueBasedSOPs(
  issueCategory: string,
  issueTitle: string,
  storeId?: string
): Promise<SurfacedSOP[]> {
  const templates = await getActiveSOPTemplates(storeId);
  const surfaced: SurfacedSOP[] = [];
  const lowerTitle = issueTitle.toLowerCase();
  const lowerCategory = issueCategory.toLowerCase();

  const relatedKeywords = CATEGORY_KEYWORD_MAP[lowerCategory] || [lowerCategory];

  for (const t of templates) {
    const sopTitle = t.title.toLowerCase();
    const sopCategory = (t.category || "").toLowerCase();

    const categoryMatch = relatedKeywords.some(
      (kw) => sopCategory.includes(kw) || sopTitle.includes(kw)
    );
    const titleMatch = lowerTitle
      .split(/\s+/)
      .some((word) => word.length > 3 && (sopTitle.includes(word) || sopCategory.includes(word)));

    if (categoryMatch || titleMatch) {
      surfaced.push({
        templateId: t.id,
        title: t.title,
        category: t.category,
        reason: "issue_based",
        triggerType: "issue_based",
        priority: 2,
        trainingModeRecommended: false,
        message: `Related SOP found for this issue: "${t.title}"`,
      });
    }
  }

  return surfaced;
}

export async function getSurfacedSOPsForEmployee(
  userId: string,
  storeId?: string
): Promise<SurfacedSOP[]> {
  const allSurfaced: SurfacedSOP[] = [];

  const resolvedStoreId = storeId || await resolveStoreId();
  if (!resolvedStoreId) return [];

  const activeEntry = await db
    .select()
    .from(timeEntries)
    .where(
      and(eq(timeEntries.userId, userId), isNull(timeEntries.clockOutTime))
    )
    .limit(1);

  const isOnShift = activeEntry.length > 0;

  const timeBased = await getTimeBased(resolvedStoreId);
  allSurfaced.push(...timeBased);

  if (isOnShift) {
    const roleBased = await getRoleBasedSOPs(userId, resolvedStoreId);
    allSurfaced.push(...roleBased);
  }

  const seen = new Set<string>();
  const deduped = allSurfaced.filter((s) => {
    if (seen.has(s.templateId)) return false;
    seen.add(s.templateId);
    return true;
  });

  deduped.sort((a, b) => a.priority - b.priority);

  return deduped;
}

async function resolveStoreId(): Promise<string | null> {
  const locations = await db
    .select({ id: workLocations.id })
    .from(workLocations)
    .where(eq(workLocations.isActive, true))
    .limit(1);
  return locations[0]?.id || null;
}

let surfacingInterval: ReturnType<typeof setInterval> | null = null;

export function startSurfacingCron(
  broadcastToAll: (data: Record<string, unknown>) => void
) {
  if (surfacingInterval) return;

  surfacingInterval = setInterval(async () => {
    try {
      const storeId = await resolveStoreId();
      if (!storeId) return;

      const activeOnShift = await db
        .select({ userId: timeEntries.userId })
        .from(timeEntries)
        .where(isNull(timeEntries.clockOutTime));

      if (activeOnShift.length === 0) return;

      const timeBased = await getTimeBased(storeId);

      if (timeBased.length > 0) {
        logger.info(
          {
            sopCount: timeBased.length,
            trigger: "time_based_cron",
            templates: timeBased.map((s) => s.templateId),
          },
          "SOP surfacing: time-based SOPs detected"
        );

        broadcastToAll({
          type: "sop_surfaced",
          data: {
            sops: timeBased,
            trigger: "time_based",
          },
        });
      }
    } catch (error: any) {
      logger.error({ error: error.message }, "SOP surfacing cron error");
    }
  }, 5 * 60 * 1000);

  logger.info("SOP surfacing cron started (every 5 minutes)");
}

export function stopSurfacingCron() {
  if (surfacingInterval) {
    clearInterval(surfacingInterval);
    surfacingInterval = null;
  }
}
