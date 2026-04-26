/**
 * Pure helpers for CreateShiftSplitPanel. All exports are side-effect free
 * (except the localStorage block, which is namespaced and explicit) so they
 * can be unit-tested without rendering the panel.
 *
 * Drift note: extracted from CreateShiftSplitPanel as part of task #387 to keep
 * the 3000-line panel under control and to give the wow-UX features (snap,
 * collision-nudge, margin meter, drafts) a single audited home.
 */

// ─── Time helpers ──────────────────────────────────────────────────────────────

export function timeToMin(t: string): number {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + (m || 0);
}

export function minsToTime(mins: number): string {
  const safe = Math.max(0, Math.floor(mins));
  const h = Math.floor(safe / 60);
  const m = safe % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

// ─── Draft persistence (localStorage) ──────────────────────────────────────────

export interface CreateShiftDraft {
  savedAt: string;
  modalDate: string;
  modalStartTime: string;
  modalEndTime: string;
  selectedUserId: string;
  modalTitle: string;
  modalLocationId: string;
  modalNotes: string;
  manualShifts: unknown[];
  /** Indexes of AI-suggested shifts the user has excluded. */
  excludedIdxs?: number[];
  /** In-memory edits keyed by AI suggestion index. */
  editedShifts?: Record<number, { startTime?: string; endTime?: string; title?: string }>;
}

const DRAFT_PREFIX = 'taime:create-shift-draft:';
const DRAFT_TTL_MS = 24 * 60 * 60 * 1000;

export function draftKey(storeId: string, date: string, userId: string): string {
  return `${DRAFT_PREFIX}${storeId}:${date}:${userId}`;
}

export function loadDraft(storeId: string, date: string, userId: string): CreateShiftDraft | null {
  if (typeof window === 'undefined' || !storeId || !date || !userId) return null;
  try {
    const raw = window.localStorage.getItem(draftKey(storeId, date, userId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CreateShiftDraft;
    const ageMs = Date.now() - new Date(parsed.savedAt).getTime();
    if (!Number.isFinite(ageMs) || ageMs > DRAFT_TTL_MS) {
      window.localStorage.removeItem(draftKey(storeId, date, userId));
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function saveDraft(
  storeId: string,
  date: string,
  userId: string,
  draft: Omit<CreateShiftDraft, 'savedAt'>,
): void {
  if (typeof window === 'undefined' || !storeId || !date || !userId) return;
  try {
    const payload: CreateShiftDraft = { ...draft, savedAt: new Date().toISOString() };
    window.localStorage.setItem(draftKey(storeId, date, userId), JSON.stringify(payload));
  } catch {
    // Quota exceeded or unavailable storage — drafts are best-effort.
  }
}

export function clearDraft(storeId: string, date: string, userId: string): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(draftKey(storeId, date, userId));
  } catch {
    /* ignore */
  }
}

/** Sweep across all stored drafts and remove anything older than 24h. */
export function evictStaleDrafts(): void {
  if (typeof window === 'undefined') return;
  try {
    const toRemove: string[] = [];
    for (let i = 0; i < window.localStorage.length; i++) {
      const k = window.localStorage.key(i);
      if (!k || !k.startsWith(DRAFT_PREFIX)) continue;
      try {
        const raw = window.localStorage.getItem(k);
        if (!raw) { toRemove.push(k); continue; }
        const parsed = JSON.parse(raw) as { savedAt?: string };
        const ageMs = parsed.savedAt ? Date.now() - new Date(parsed.savedAt).getTime() : Infinity;
        if (!Number.isFinite(ageMs) || ageMs > DRAFT_TTL_MS) toRemove.push(k);
      } catch {
        toRemove.push(k);
      }
    }
    for (const k of toRemove) window.localStorage.removeItem(k);
  } catch { /* ignore */ }
}

// ─── Snap-to-availability ──────────────────────────────────────────────────────

export interface AvailWindow {
  start: string;
  end: string;
}

/**
 * Snap a start/end pair to the nearest availability window edge if either edge
 * is within `tolMin` minutes of a window boundary. Returns the input unchanged
 * if no boundary is close enough — preserves the user's intent for explicit
 * mid-window placements.
 */
export function snapToWindow(
  start: string,
  end: string,
  windows: AvailWindow[],
  tolMin = 15,
): { start: string; end: string; snapped: boolean } {
  if (windows.length === 0) return { start, end, snapped: false };
  let s = timeToMin(start);
  let e = timeToMin(end);
  const dur = e - s;
  let snapped = false;

  for (const w of windows) {
    const ws = timeToMin(w.start);
    const we = timeToMin(w.end);
    if (Math.abs(s - ws) <= tolMin) { s = ws; snapped = true; break; }
    if (Math.abs(s - we) <= tolMin) { s = we; snapped = true; break; }
  }
  // Recompute end from the (possibly) snapped start, preserving duration.
  e = s + dur;
  for (const w of windows) {
    const we = timeToMin(w.end);
    const ws = timeToMin(w.start);
    if (Math.abs(e - we) <= tolMin) { e = we; snapped = true; break; }
    if (Math.abs(e - ws) <= tolMin) { e = ws; snapped = true; break; }
  }

  return { start: minsToTime(s), end: minsToTime(e), snapped };
}

// ─── One-hop collision-avoidance ───────────────────────────────────────────────

export interface ShiftRange {
  /** Anything truthy works — used only to identify a shift in the result. */
  id: string | number;
  startTime: string;
  endTime: string;
  /** Shifts for different employees never collide. */
  employeeId?: string | null;
}

/**
 * Compute a single-step nudge for `others` to make room for the dragged shift's
 * new range. Only shifts that share `draggedEmployeeId` are considered. Each
 * candidate is shifted by the smallest delta that resolves the overlap *if and
 * only if* that delta keeps it inside [openMin, closeMin]. Returns a map of
 * id → new {startTime, endTime}. Conflicting shifts that cannot be nudged
 * within bounds are omitted (caller falls back to the existing conflict UI).
 */
export function oneHopNudge(
  draggedStart: string,
  draggedEnd: string,
  draggedEmployeeId: string | null | undefined,
  others: ShiftRange[],
  openMin: number,
  closeMin: number,
): Map<string | number, { startTime: string; endTime: string }> {
  const result = new Map<string | number, { startTime: string; endTime: string }>();
  if (!draggedEmployeeId) return result;
  const ds = timeToMin(draggedStart);
  const de = timeToMin(draggedEnd);
  for (const other of others) {
    if (other.employeeId !== draggedEmployeeId) continue;
    const os = timeToMin(other.startTime);
    const oe = timeToMin(other.endTime);
    // No overlap → skip.
    if (oe <= ds || os >= de) continue;
    const dur = oe - os;
    // Try pushing the other shift earlier (so its end == ds).
    const earlierStart = ds - dur;
    if (earlierStart >= openMin) {
      result.set(other.id, {
        startTime: minsToTime(earlierStart),
        endTime: minsToTime(ds),
      });
      continue;
    }
    // Otherwise push it later (so its start == de).
    const laterEnd = de + dur;
    if (laterEnd <= closeMin) {
      result.set(other.id, {
        startTime: minsToTime(de),
        endTime: minsToTime(laterEnd),
      });
      continue;
    }
    // Cannot resolve in one hop — leave caller's conflict UI to surface it.
  }
  return result;
}

// ─── Live margin meter ─────────────────────────────────────────────────────────

export interface MarginInputShift {
  employeeId: string;
  startTime: string;
  endTime: string;
}

export interface MarginRates {
  /** userId → hourly rate in dollars. */
  byUser: Record<string, number | null | undefined>;
  /** roleId → default hourly rate, used when byUser[id] is null. */
  byRoleDefault?: Record<string, number | null | undefined>;
  /** userId → roleId, used to look up byRoleDefault. */
  userRoleId?: Record<string, string | null | undefined>;
  /** Final fallback when neither user-rate nor role-default is set. */
  fallback?: number;
  /** Projected revenue for the day (used to compute labor %). */
  projectedRevenue?: number | null;
  /** Target labor % (e.g. 25 means 25%). Defaults to 25 when not set. */
  targetLaborPct?: number;
}

/** Color tier returned by the margin meter — purely semantic, the UI maps to colors. */
export type MarginTier = 'green' | 'amber' | 'red' | 'unknown';

export interface MarginResult {
  totalHours: number;
  totalCost: number;
  /** Per-shift breakdown (same order as input). */
  perShift: Array<{ hours: number; cost: number; rateSource: 'user' | 'role' | 'fallback' }>;
  /** Cost / projectedRevenue * 100. null when projectedRevenue is missing or 0. */
  laborPct: number | null;
  /** Threshold tier: green ≤ target, amber ≤ target+5, red above. unknown when no revenue. */
  tier: MarginTier;
  /** The target threshold actually applied (for tooltip display). */
  targetLaborPct: number;
}

/** Returns rounded hours (15-min granularity) for one shift. */
function shiftHours(s: { startTime: string; endTime: string }): number {
  const start = timeToMin(s.startTime);
  let end = timeToMin(s.endTime);
  // Cross-midnight shifts (rare in retail) — assume they end the next day.
  if (end <= start) end += 24 * 60;
  return Math.max(0, (end - start) / 60);
}

export function computeMargin(shifts: MarginInputShift[], rates: MarginRates): MarginResult {
  const fallback = rates.fallback ?? 15;
  const targetLaborPct = rates.targetLaborPct ?? 25;
  let totalHours = 0;
  let totalCost = 0;
  const perShift: MarginResult['perShift'] = [];
  for (const s of shifts) {
    const hours = shiftHours(s);
    const userRate = rates.byUser[s.employeeId];
    let rate: number;
    let rateSource: 'user' | 'role' | 'fallback';
    if (typeof userRate === 'number' && userRate > 0) {
      rate = userRate;
      rateSource = 'user';
    } else {
      const roleId = rates.userRoleId?.[s.employeeId];
      const roleRate = roleId ? rates.byRoleDefault?.[roleId] : null;
      if (typeof roleRate === 'number' && roleRate > 0) {
        rate = roleRate;
        rateSource = 'role';
      } else {
        rate = fallback;
        rateSource = 'fallback';
      }
    }
    const cost = hours * rate;
    totalHours += hours;
    totalCost += cost;
    perShift.push({ hours, cost, rateSource });
  }
  const revenue = rates.projectedRevenue;
  let laborPct: number | null = null;
  let tier: MarginTier = 'unknown';
  if (typeof revenue === 'number' && revenue > 0) {
    laborPct = (totalCost / revenue) * 100;
    if (laborPct <= targetLaborPct) tier = 'green';
    else if (laborPct <= targetLaborPct + 5) tier = 'amber';
    else tier = 'red';
  }
  return {
    totalHours: Math.round(totalHours * 100) / 100,
    totalCost: Math.round(totalCost * 100) / 100,
    perShift,
    laborPct: laborPct === null ? null : Math.round(laborPct * 10) / 10,
    tier,
    targetLaborPct,
  };
}

// ─── Dirty-state detection ─────────────────────────────────────────────────────

export interface DirtyStateInputs {
  /** Number of pending manual shifts not yet persisted. */
  pendingManualCount: number;
  /** Number of AI shifts excluded by the user. */
  excludedCount: number;
  /** Number of AI shifts with un-persisted in-memory edits. */
  editedCount: number;
  /** True when the user has actively typed/modified a draft form on the right. */
  formDirty: boolean;
  /** True when the user is mid-multi-select. */
  multiSelectActive?: boolean;
}

/**
 * Returns true when closing the panel would lose un-persisted client work.
 * Per-card "Save Changes" pushes server-side; this flag only fires for state
 * that lives only in the client.
 */
export function hasUnsavedChanges(s: DirtyStateInputs): boolean {
  return (
    s.pendingManualCount > 0
    || s.excludedCount > 0
    || s.editedCount > 0
    || s.formDirty
    || !!s.multiSelectActive
  );
}
