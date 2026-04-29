// Task #437 — Pure helpers for editing AI-proposed shifts in the
// ScheduleManagement grid before they're applied. Kept tiny and side-effect
// free so the in-memory patch logic can be unit-tested without rendering
// the page.

export interface AiScheduleEntry {
  date: string;
  employeeId: string;
  employeeName: string;
  shiftBlock: string;
  startTime: string;
  endTime: string;
  reasoning: string;
}

export type AiScheduleEntryPatch = Partial<
  Pick<AiScheduleEntry, "date" | "employeeId" | "employeeName" | "startTime" | "endTime" | "shiftBlock" | "reasoning">
>;

/**
 * Returns a new entries array with the entry at `idx` shallow-merged with
 * `patch`. Out-of-bounds indexes return the original array unchanged so the
 * caller never has to null-check the index. Never mutates the input.
 */
export function applyAiEntryEdit(
  entries: AiScheduleEntry[],
  idx: number,
  patch: AiScheduleEntryPatch,
): AiScheduleEntry[] {
  if (idx < 0 || idx >= entries.length) return entries;
  const next = entries.slice();
  next[idx] = { ...entries[idx], ...patch };
  return next;
}

/**
 * Validates an HH:MM 24-hour time string (the format both the AI generator
 * and `<Input type="time">` use). Accepts "00:00".."23:59" only.
 */
export function isValidTimeString(value: string): boolean {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

/**
 * Returns true when `endTime` is strictly after `startTime` on the same day,
 * given the HH:MM 24-hour format. Same-day shifts only — overnight shifts
 * are out of scope for the AI generator and rejected here.
 */
export function isValidShiftWindow(startTime: string, endTime: string): boolean {
  if (!isValidTimeString(startTime) || !isValidTimeString(endTime)) return false;
  return startTime < endTime;
}
