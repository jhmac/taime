import { db } from "../db";
import { sopTemplates, sopExecutions, timeEntries, workLocations, aiSchedulingSettings, users } from "@shared/schema";
import { eq, and, gte, isNull, count, inArray } from "drizzle-orm";
import { cache } from "./cache";
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

async function getStoreHours(storeId?: string): Promise<StoreHoursEntry[]> {
  // Per-store cache key (Task #435). Without storeId we still cache under the
  // "default" bucket and read whichever single row exists — this preserves
  // legacy behavior for callers that haven't been threaded with a store yet.
  const cacheKey = `surfacing:store_hours:${storeId || "default"}`;
  const cached = cache.get<StoreHoursEntry[]>(cacheKey);
  if (cached) return cached;

  const settings = storeId
    ? await db.select().from(aiSchedulingSettings)
        .where(eq(aiSchedulingSettings.storeId, storeId))
        .limit(1)
    : await db.select().from(aiSchedulingSettings).limit(1);
  const hours: StoreHoursEntry[] = (settings[0] as any)?.storeHours || [
    { day: 0, openTime: "09:00", closeTime: "21:00", isClosed: true },
    { day: 1, openTime: "09:00", closeTime: "21:00", isClosed: false },
    { day: 2, openTime: "09:00", closeTime: "21:00", isClosed: false },
    { day: 3, openTime: "09:00", closeTime: "21:00", isClosed: false },
    { day: 4, openTime: "09:00", closeTime: "21:00", isClosed: false },
    { day: 5, openTime: "09:00", closeTime: "21:00", isClosed: false },
    { day: 6, openTime: "09:00", closeTime: "21:00", isClosed: false },
  ];

  cache.set(cacheKey, hours, 5 * 60 * 1000);
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

async function getEmployeeExecutionCounts(
  employeeId: string,
  templateIds: string[]
): Promise<Map<string, number>> {
  if (templateIds.length === 0) return new Map();
  const result = await db
    .select({
      templateId: sopExecutions.templateId,
      count: count(),
    })
    .from(sopExecutions)
    .where(
      and(
        eq(sopExecutions.employeeId, employeeId),
        inArray(sopExecutions.templateId, templateIds),
        eq(sopExecutions.status, "completed")
      )
    )
    .groupBy(sopExecutions.templateId);

  return new Map(result.map(r => [r.templateId, r.count]));
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

  const storeHours = await getStoreHours(storeId);
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
    .select({ userId: timeEntries.userId })
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
  const handoffTemplates = templates.filter(matchesHandoff);
  if (handoffTemplates.length === 0) return [];

  const execCounts = await getEmployeeExecutionCounts(
    clockingInUserId,
    handoffTemplates.map(t => t.id)
  );

  const allIds = [clockingInUserId, ...otherActive.map(e => e.userId)];
  const uniqueIds = Array.from(new Set(allIds));
  const userRows = uniqueIds.length > 0
    ? await db
        .select({ id: users.id, firstName: users.firstName, lastName: users.lastName })
        .from(users)
        .where(inArray(users.id, uniqueIds))
    : [];
  const nameMap = new Map(userRows.map(u => [u.id, `${u.firstName || ""} ${u.lastName || ""}`.trim() || "Team member"]));

  const incomingName = nameMap.get(clockingInUserId) || "Incoming";
  const outgoingName = nameMap.get(otherActive[0].userId) || "Outgoing";

  return handoffTemplates.map((t) => ({
    templateId: t.id,
    title: t.title,
    category: t.category,
    reason: "event_based" as const,
    triggerType: "event_based" as const,
    priority: 2,
    trainingModeRecommended: (execCounts.get(t.id) || 0) < 3,
    message: `Shift handoff time! ${outgoingName} → ${incomingName}. Time to brief and 3S together.`,
  }));
}

export async function getOpeningSOPsForClockIn(
  userId: string,
  storeId: string
): Promise<SurfacedSOP[]> {
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  const todayEntries = await db
    .select({ userId: timeEntries.userId })
    .from(timeEntries)
    .where(
      and(
        eq(timeEntries.locationId, storeId),
        gte(timeEntries.clockInTime, todayStart)
      )
    );

  const isFirstShift = !todayEntries.some((e) => e.userId !== userId);
  if (!isFirstShift) return [];

  const templates = await getActiveSOPTemplates(storeId);
  const openingTemplates = templates.filter(matchesOpening);
  if (openingTemplates.length === 0) return [];

  const execCounts = await getEmployeeExecutionCounts(
    userId,
    openingTemplates.map(t => t.id)
  );

  return openingTemplates.map((t) => ({
    templateId: t.id,
    title: t.title,
    category: t.category,
    reason: "event_based" as const,
    triggerType: "event_based" as const,
    priority: 1,
    trainingModeRecommended: (execCounts.get(t.id) || 0) < 3,
    message: "You're the first one in today! Time for the Opening Checklist.",
  }));
}

export async function getRoleBasedSOPs(
  userId: string,
  storeId?: string
): Promise<SurfacedSOP[]> {
  const templates = await getActiveSOPTemplates(storeId);
  if (templates.length === 0) return [];

  const execCounts = await getEmployeeExecutionCounts(
    userId,
    templates.map(t => t.id)
  );

  return templates
    .filter((t) => {
      const c = execCounts.get(t.id) || 0;
      return c > 0 && c < 3;
    })
    .map((t) => {
      const c = execCounts.get(t.id) || 0;
      return {
        templateId: t.id,
        title: t.title,
        category: t.category,
        reason: "role_based" as const,
        triggerType: "role_based" as const,
        priority: 3,
        trainingModeRecommended: true,
        message: `You've completed "${t.title}" ${c} time${c === 1 ? "" : "s"}. Training mode is recommended.`,
      };
    });
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
    .select({ id: timeEntries.id })
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

export interface CronDeps {
  resolveStoreId: () => Promise<string | null>;
  getActiveOnShift: () => Promise<Array<{ userId: string }>>;
  getTimeBased: (storeId: string) => Promise<SurfacedSOP[]>;
  logger: { info: (obj: Record<string, unknown>, msg: string) => void; error: (obj: Record<string, unknown>, msg: string) => void };
}

export async function runSurfacingTick(
  sendToUsers: (userIds: string[], data: Record<string, unknown>) => void,
  deps: CronDeps
): Promise<void> {
  const storeId = await deps.resolveStoreId();
  if (!storeId) return;

  // Fetch all users currently clocked in (no limit — SOPs must reach every
  // on-shift employee). De-duplicate in case of data anomalies (e.g. an
  // employee with two open time entries).
  const activeOnShift = await deps.getActiveOnShift();

  if (activeOnShift.length === 0) return;

  const timeBased = await deps.getTimeBased(storeId);

  if (timeBased.length > 0) {
    // Only on-shift users should receive SOP surfacing events — this is an
    // intentional security boundary (mirrors the sales-view filter used for
    // midday pulse broadcasts).
    const onShiftUserIds = Array.from(new Set(activeOnShift.map((e) => e.userId)));

    deps.logger.info(
      {
        sopCount: timeBased.length,
        trigger: "time_based_cron",
        templates: timeBased.map((s) => s.templateId),
        recipientCount: onShiftUserIds.length,
      },
      "SOP surfacing: time-based SOPs detected, broadcasting to on-shift users only"
    );

    sendToUsers(onShiftUserIds, {
      type: "sop_surfaced",
      data: {
        sops: timeBased,
        trigger: "time_based",
      },
    });
  }
}

function makeProdDeps(): CronDeps {
  return {
    resolveStoreId,
    getActiveOnShift: () =>
      db
        .select({ userId: timeEntries.userId })
        .from(timeEntries)
        .where(isNull(timeEntries.clockOutTime)),
    getTimeBased,
    logger: {
      info: (obj, msg) => logger.info(obj, msg),
      error: (obj, msg) => logger.error(obj, msg),
    },
  };
}

let surfacingInterval: ReturnType<typeof setInterval> | null = null;

export function startSurfacingCron(
  sendToUsers: (userIds: string[], data: Record<string, unknown>) => void
) {
  if (surfacingInterval) return;

  const deps = makeProdDeps();

  surfacingInterval = setInterval(async () => {
    try {
      await runSurfacingTick(sendToUsers, deps);
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
