/**
 * Shared constants and helpers for the panel horizontal timeline.
 * Used by PanelHorizontalTimeline and AlignedRevenueBar to ensure
 * pixel-perfect column alignment between the revenue chart and shift bars.
 */

// ── Constants ──────────────────────────────────────────────────────────────────

/** Fixed pixel width per store hour. Both the revenue chart and shift timeline
 *  use this constant so their columns are always pixel-aligned. */
export const PANEL_HOUR_PX = 56;

// ── Types ─────────────────────────────────────────────────────────────────────

export interface HourlyData {
  hour: number;
  label: string;
  revenue: number;
  isPeak: boolean;
  suggestedStaff: number;
}

export interface HistoricalSalesData {
  date: string;
  historicalDate: string;
  dataSource: string;
  dailyTotal: number;
  hourlyData: HourlyData[];
  storeHours: { open: string; close: string };
}

// ── Time helpers ──────────────────────────────────────────────────────────────

/** Convert "HH:MM" → total minutes since midnight. */
export function panelTimeToMin(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + (m || 0);
}

/**
 * Convert "HH:MM" → left-offset pixels from `openHour` (integer hour).
 * Both the revenue chart and the shift bars call this with the same
 * `openHour` so their columns stay perfectly aligned.
 */
export function timeToOffset(hhmm: string, openHour: number, hourPx = PANEL_HOUR_PX): number {
  const minutes = panelTimeToMin(hhmm) - openHour * 60;
  return (minutes / 60) * hourPx;
}

/** Convert a start/end pair to pixel width, clamped to a minimum of 4 px. */
export function durationToPx(startHhmm: string, endHhmm: string, hourPx = PANEL_HOUR_PX): number {
  const dur = panelTimeToMin(endHhmm) - panelTimeToMin(startHhmm);
  return Math.max((dur / 60) * hourPx, 4);
}

// ── Lane layout ───────────────────────────────────────────────────────────────

export interface PanelLaneItem {
  id: string;
  startMin: number;
  endMin: number;
}

/**
 * Greedy interval scheduling: assigns each item to the lowest-indexed lane
 * that is free at `item.startMin`. Returns items with an added `lane` field.
 * Input order does not matter — items are sorted by startMin internally.
 */
export function layoutPanelLanes(
  items: PanelLaneItem[],
): Array<PanelLaneItem & { lane: number }> {
  if (!items.length) return [];
  const sorted = [...items].sort((a, b) => a.startMin - b.startMin);
  const laneEnds: number[] = [];
  const result: Array<PanelLaneItem & { lane: number }> = [];
  for (const item of sorted) {
    let lane = laneEnds.findIndex(end => end <= item.startMin);
    if (lane === -1) lane = laneEnds.length;
    laneEnds[lane] = item.endMin;
    result.push({ ...item, lane });
  }
  return result;
}

// ── Store-hours utility ───────────────────────────────────────────────────────

/** Returns the integer number of whole store-hours (open → close), min 1. */
export function storeHoursCount(storeHours: { open: string; close: string }): number {
  const [oh] = storeHours.open.split(':').map(Number);
  const [ch, cm] = storeHours.close.split(':').map(Number);
  const closeHour = Math.ceil(ch + cm / 60);
  return Math.max(closeHour - oh, 1);
}
