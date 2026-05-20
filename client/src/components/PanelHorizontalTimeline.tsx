/**
 * PanelHorizontalTimeline — horizontal shift timeline for the Create/Edit Shift panel.
 *
 * Two exported components share the same PANEL_HOUR_PX column width so their
 * hour axes are pixel-perfect-aligned when wrapped in a common overflow-x-auto
 * scroll container:
 *
 *   AlignedRevenueBar  — div-based revenue bar chart (replaces the Recharts version)
 *   PanelHorizontalTimeline (default) — shift lanes + coverage row + hour header
 */

import { useState, useMemo, useCallback } from "react";
import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";
import { TrendingUp, AlertTriangle, Sparkles, X } from "lucide-react";
import type { Schedule } from "@shared/schema";
import {
  PANEL_HOUR_PX,
  panelTimeToMin,
  layoutPanelLanes,
  type HourlyData,
  type HistoricalSalesData,
  type PanelLaneItem,
} from "@/lib/panelTimelineHelpers";

// ── Local helpers ─────────────────────────────────────────────────────────────

function fmt12(t: string): string {
  const [h, m] = t.split(":").map(Number);
  const ampm = h >= 12 ? "pm" : "am";
  const h12 = h % 12 || 12;
  return m === 0 ? `${h12}${ampm}` : `${h12}:${String(m).padStart(2, "0")}${ampm}`;
}

const SHIFT_COLOR_CLASSES = [
  "bg-violet-500",
  "bg-blue-500",
  "bg-emerald-500",
  "bg-amber-500",
  "bg-rose-500",
  "bg-cyan-500",
  "bg-pink-500",
  "bg-indigo-500",
  "bg-teal-500",
  "bg-orange-500",
] as const;

function getShiftColorClass(userId: string): string {
  const key = userId || "";
  let hash = 0;
  for (let i = 0; i < key.length; i++) hash = key.charCodeAt(i) + ((hash << 5) - hash);
  return SHIFT_COLOR_CLASSES[Math.abs(hash) % SHIFT_COLOR_CLASSES.length];
}

// ── Shared types ──────────────────────────────────────────────────────────────

/** A already-saved shift entry, matching the ActualShiftEntry shape in CreateShiftSplitPanel. */
export interface ConfirmedShiftEntry {
  schedule: Schedule;
  name: string;
  startTime: string; // HH:MM local
  endTime: string;   // HH:MM local
}

/** The shift currently being drafted in the right-side form fields. */
export interface PanelDraftShift {
  employeeId: string;
  employeeName: string;
  startTime: string; // HH:MM
  endTime: string;   // HH:MM
}

/** Minimal shape of a proposed (AI/manual) shift needed by this component.
 *  Structurally compatible with ProposedShift from CreateShiftSplitPanel. */
export interface ProposedShiftLike {
  employeeId: string;
  employeeName: string;
  startTime: string;
  endTime: string;
  shiftBlock?: string;
  rationale?: string;
  revenue?: number;
}

// ── AlignedRevenueBar ─────────────────────────────────────────────────────────
// A div-based bar chart whose column width equals PANEL_HOUR_PX so it stays
// pixel-aligned with the PanelHorizontalTimeline below it when both are inside
// a shared overflow-x-auto container.

interface AlignedRevenueBarProps {
  data: HistoricalSalesData | null | undefined;
  isLoading: boolean;
  storeHours?: { open: string; close: string };
}

export function AlignedRevenueBar({ data, isLoading, storeHours }: AlignedRevenueBarProps) {
  const [hoveredHour, setHoveredHour] = useState<number | null>(null);

  if (isLoading) {
    return (
      <div className="mb-2 space-y-1.5 pt-0.5">
        <Skeleton className="h-3 w-48 rounded" />
        <Skeleton className="h-20 w-full rounded" />
      </div>
    );
  }

  const noData =
    !data ||
    !data.hourlyData ||
    data.hourlyData.length === 0 ||
    data.dataSource === "synthetic";

  if (noData) {
    return (
      <div className="mb-2 rounded border border-dashed border-border bg-muted/30 flex items-center justify-center" style={{ height: "72px" }}>
        <div className="text-center">
          <TrendingUp className="h-4 w-4 text-muted-foreground mx-auto mb-0.5" />
          <p className="text-[10px] text-muted-foreground">No historical sales data</p>
          <p className="text-[9px] text-muted-foreground">AI will use minimum staffing defaults</p>
        </div>
      </div>
    );
  }

  const open = storeHours?.open ?? data.storeHours?.open ?? "09:00";
  const openHour = parseInt(open.split(":")[0], 10);
  const maxRevenue = Math.max(...data.hourlyData.map(d => d.revenue), 1);
  const BAR_AREA_H = 56;
  const LABEL_H = 14;
  const TOTAL_H = BAR_AREA_H + LABEL_H;

  const dailyFmt =
    data.dailyTotal >= 1000
      ? `$${(data.dailyTotal / 1000).toFixed(1)}k`
      : `$${Math.round(data.dailyTotal)}`;

  const historicalLabel = data.historicalDate
    ? new Date(data.historicalDate + "T12:00:00Z").toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      })
    : "";

  return (
    <div className="mb-1">
      {/* Header row */}
      <div className="flex items-center justify-between mb-1 px-0.5">
        <span className="text-[10px] font-medium text-muted-foreground flex items-center gap-1">
          <TrendingUp className="h-2.5 w-2.5" />
          Projected Revenue
          {data.dataSource === 'estimated' && (
            <span className="ml-1 text-[8px] font-medium text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/30 border border-amber-200 dark:border-amber-700 rounded px-1 py-0.5 leading-none">
              Estimated
            </span>
          )}
          {data.dataSource === 'actual' && (
            <span className="ml-1 text-[8px] font-medium text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-900/30 border border-emerald-200 dark:border-emerald-700 rounded px-1 py-0.5 leading-none">
              Real orders
            </span>
          )}
        </span>
        <div className="flex items-center gap-2">
          {historicalLabel && (
            <span className="text-[9px] text-muted-foreground italic">
              Based on {historicalLabel}
            </span>
          )}
          <span className="text-[10px] font-semibold text-foreground">{dailyFmt} total</span>
        </div>
      </div>

      {/* Bar chart area */}
      <div className="relative" style={{ height: `${TOTAL_H}px` }}>
        {data.hourlyData.map(entry => {
          const left = (entry.hour - openHour) * PANEL_HOUR_PX;
          const barH = Math.max((entry.revenue / maxRevenue) * BAR_AREA_H, entry.revenue > 0 ? 2 : 0);
          const isHovered = hoveredHour === entry.hour;

          return (
            <div
              key={entry.hour}
              className="absolute"
              style={{
                left: `${left}px`,
                width: `${PANEL_HOUR_PX}px`,
                top: 0,
                height: `${TOTAL_H}px`,
              }}
              onMouseEnter={() => setHoveredHour(entry.hour)}
              onMouseLeave={() => setHoveredHour(null)}
            >
              {/* Vertical column separator */}
              <div
                className="absolute top-0 bottom-0 left-0 w-px bg-border/20"
              />

              {/* Bar */}
              <div
                className={cn(
                  "absolute left-0.5 rounded-t-sm",
                  entry.isPeak ? "bg-amber-400" : "bg-slate-400/70"
                )}
                style={{
                  width: `${PANEL_HOUR_PX - 2}px`,
                  height: `${barH}px`,
                  bottom: `${LABEL_H}px`,
                }}
              />

              {/* Hour label at bottom */}
              <div
                className="absolute bottom-0 left-0.5 text-[8px] text-muted-foreground leading-none"
                style={{ height: `${LABEL_H}px`, display: "flex", alignItems: "flex-end" }}
              >
                {entry.label}
              </div>

              {/* Hover tooltip */}
              {isHovered && (
                <div
                  className="absolute z-50 bg-popover border border-border rounded-md px-2 py-1 text-[10px] shadow-md whitespace-nowrap pointer-events-none"
                  style={{ bottom: `${TOTAL_H + 4}px`, left: "50%", transform: "translateX(-50%)" }}
                >
                  <div className="font-semibold">{entry.label}</div>
                  <div className="text-muted-foreground">
                    ${Math.round(entry.revenue).toLocaleString()}
                    {entry.isPeak ? " · peak" : ""}
                  </div>
                  <div className="text-muted-foreground">{entry.suggestedStaff} staff rec'd</div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Legend */}
      <div className="flex items-center gap-3 px-0.5 mt-0.5">
        <span className="flex items-center gap-1 text-[9px] text-muted-foreground">
          <span className="inline-block w-3 h-2 rounded-sm bg-amber-400" />
          peak
        </span>
        <span className="flex items-center gap-1 text-[9px] text-muted-foreground">
          <span className="inline-block w-3 h-2 rounded-sm bg-slate-400/70" />
          standard
        </span>
      </div>
    </div>
  );
}

// ── PanelHorizontalTimeline ───────────────────────────────────────────────────

const LANE_H = 30;   // height of each shift lane in px
const LANE_PAD = 6;  // vertical padding around the lane area

interface PanelHorizontalTimelineProps {
  proposedShifts: ProposedShiftLike[];
  confirmedShifts?: ConfirmedShiftEntry[];
  draftShift?: PanelDraftShift | null;
  storeHours: { open: string; close: string };
  hourlyData?: HourlyData[];
  isLoading?: boolean;
  isError?: boolean;
  errorMsg?: string;
  selectedIdx?: number | null;
  // Method signatures (not arrow types) use bivariant checking so ProposedShift
  // (which extends ProposedShiftLike structurally) can be passed without casts.
  onSelectShift?(shift: ProposedShiftLike, idx: number): void;
  selectedActualId?: string | null;
  onSelectActualShift?(s: Schedule): void;
  excludedIdxs?: Set<number>;
  onToggleExclude?(idx: number, shift: ProposedShiftLike): void;
  conflictingEmployeeIds?: Set<string>;
  aiCount?: number;
  /** When provided, empty-zone clicks fire this with the snapped start time. */
  onSlotClick?: (startTime: string) => void;
}

export default function PanelHorizontalTimeline({
  proposedShifts,
  confirmedShifts = [],
  draftShift,
  storeHours,
  hourlyData,
  isLoading,
  isError,
  errorMsg,
  selectedIdx,
  onSelectShift,
  selectedActualId,
  onSelectActualShift,
  excludedIdxs = new Set(),
  onToggleExclude,
  conflictingEmployeeIds = new Set(),
  onSlotClick,
}: PanelHorizontalTimelineProps) {
  const openMin = panelTimeToMin(storeHours.open);
  const closeMin = panelTimeToMin(storeHours.close);
  const openHour = Math.floor(openMin / 60);
  const closeHour = Math.ceil(closeMin / 60);
  const numHours = Math.max(closeHour - openHour, 1);

  // Current time indicator
  const now = new Date();
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const showNowLine = nowMin >= openMin && nowMin <= closeMin;
  const nowLeft = ((nowMin - openMin) / 60) * PANEL_HOUR_PX;

  // Build lane items from all shift types
  const allLaneItems = useMemo<Array<PanelLaneItem & { kind: "confirmed" | "proposed" | "draft"; idx?: number }>>(() => {
    const items: Array<PanelLaneItem & { kind: "confirmed" | "proposed" | "draft"; idx?: number }> = [];

    for (const cs of confirmedShifts) {
      const startMin = panelTimeToMin(cs.startTime);
      const endMin = panelTimeToMin(cs.endTime);
      if (endMin > startMin) {
        items.push({ id: `confirmed-${cs.schedule.id}`, startMin, endMin, kind: "confirmed" });
      }
    }

    for (let i = 0; i < proposedShifts.length; i++) {
      if (excludedIdxs.has(i)) continue;
      const s = proposedShifts[i];
      const startMin = panelTimeToMin(s.startTime);
      const endMin = panelTimeToMin(s.endTime);
      if (endMin > startMin) {
        items.push({ id: `proposed-${i}`, startMin, endMin, kind: "proposed", idx: i });
      }
    }

    if (draftShift) {
      const startMin = panelTimeToMin(draftShift.startTime);
      const endMin = panelTimeToMin(draftShift.endTime);
      if (endMin > startMin) {
        items.push({ id: "draft", startMin, endMin, kind: "draft" });
      }
    }

    return items;
  }, [confirmedShifts, proposedShifts, excludedIdxs, draftShift]);

  const laned = useMemo(() => layoutPanelLanes(allLaneItems), [allLaneItems]);

  const laneMap = useMemo(() => {
    const m = new Map<string, number>();
    for (const l of laned) m.set(l.id, l.lane);
    return m;
  }, [laned]);

  const maxLane = laned.length > 0 ? laned.reduce((m, x) => Math.max(m, x.lane), 0) : 0;
  const laneAreaH = LANE_PAD + (maxLane + 1) * LANE_H + LANE_PAD;

  // Coverage data — actual scheduled (confirmed only) vs AI-recommended per hour.
  // Proposed/AI suggestions are intentionally excluded so the ratio reflects
  // real staffing already on the schedule, not the suggestions being reviewed.
  const coverageData = useMemo<Array<{ hour: number; scheduled: number; recommended: number }> | null>(() => {
    if (!hourlyData || hourlyData.length === 0) return null;
    return hourlyData.map(hd => {
      const hStart = hd.hour * 60;
      const hEnd = hStart + 60;
      let scheduled = 0;
      for (const cs of confirmedShifts) {
        const sm = panelTimeToMin(cs.startTime);
        const em = panelTimeToMin(cs.endTime);
        if (sm < hEnd && em > hStart) scheduled++;
      }
      return { hour: hd.hour, scheduled, recommended: hd.suggestedStaff };
    });
  }, [hourlyData, confirmedShifts]);

  const COVERAGE_H = 24;
  const HEADER_H = 22;

  const handleShiftAreaClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (!onSlotClick) return;
    const target = e.target as HTMLElement;
    if (target.closest("[data-panel-shift]")) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = Math.max(0, e.clientX - rect.left);
    const rawMin = openMin + (x / PANEL_HOUR_PX) * 60;
    const snapped = Math.round(rawMin / 15) * 15;
    const clamped = Math.max(openMin, Math.min(closeMin - 60, snapped));
    const hh = String(Math.floor(clamped / 60)).padStart(2, "0");
    const mm = String(clamped % 60).padStart(2, "0");
    onSlotClick(`${hh}:${mm}`);
  }, [onSlotClick, openMin, closeMin]);

  if (isLoading) {
    return (
      <div className="space-y-1.5 mt-1">
        <Skeleton className="h-4 w-36 rounded" />
        <Skeleton className="h-16 w-full rounded" />
      </div>
    );
  }

  const hasAny = confirmedShifts.length > 0 || proposedShifts.length > 0 || !!draftShift;

  if (isError) {
    return (
      <div className="rounded-lg border border-dashed border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-900/20 p-3 text-center mt-1">
        <AlertTriangle className="h-5 w-5 text-red-500 mx-auto mb-1" />
        <p className="text-xs text-red-600 dark:text-red-400 font-medium">Failed to load suggestions</p>
        {errorMsg && <p className="text-[10px] text-red-500 dark:text-red-500 mt-0.5 max-w-[200px] mx-auto">{errorMsg}</p>}
      </div>
    );
  }

  if (!hasAny) {
    return (
      <div className="rounded-lg border border-dashed border-border bg-muted/30 p-3 text-center mt-1">
        <Sparkles className="h-5 w-5 text-muted-foreground mx-auto mb-1" />
        <p className="text-xs text-muted-foreground">
          No shifts suggested. Add employees or adjust availability.
        </p>
      </div>
    );
  }

  return (
    <div>
      {/* Label row */}
      <div className="flex items-center gap-1.5 mb-1 px-0.5 flex-wrap">
        {confirmedShifts.length > 0 && (
          <span className="text-[10px] text-muted-foreground flex items-center gap-1">
            <span className="inline-block w-2 h-2 rounded-full bg-orange-400" />
            Scheduled ({confirmedShifts.length})
          </span>
        )}
        {proposedShifts.length > 0 && (
          <span className="text-[10px] text-muted-foreground flex items-center gap-1">
            {confirmedShifts.length > 0 && <span className="text-border/60">·</span>}
            <Sparkles className="h-2.5 w-2.5" />
            AI Suggested ({proposedShifts.filter((_, i) => !excludedIdxs.has(i)).length}
            {excludedIdxs.size > 0 ? ` of ${proposedShifts.length}` : ""})
          </span>
        )}
        {conflictingEmployeeIds.size > 0 && (
          <span className="flex items-center gap-0.5 text-[9px] text-amber-600 dark:text-amber-400 font-medium ml-auto">
            <span className="inline-block w-3 h-2 rounded-sm border-2 border-amber-500 bg-amber-100 dark:bg-amber-900/40" />
            Already scheduled
          </span>
        )}
      </div>

      {/* Scrollable timeline body — width is controlled by parent container */}
      <div className="relative border border-border/30 rounded-md overflow-hidden bg-muted/10">
        {/* Current-time indicator — spans coverage row + shift lanes (not the header) */}
        {showNowLine && (
          <div
            className="absolute w-0.5 bg-red-500/70 z-20 pointer-events-none"
            style={{ left: `${nowLeft}px`, top: `${HEADER_H}px`, bottom: 0 }}
            title={`Now: ${fmt12(`${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`)}`}
          />
        )}

        {/* Hour label header — sticky within the scroll container */}
        <div
          className="sticky top-0 z-10 bg-background/95 backdrop-blur-sm border-b border-border/20"
          style={{ height: `${HEADER_H}px` }}
        >
          <div className="relative w-full h-full">
            {Array.from({ length: numHours + 1 }).map((_, i) => {
              const h = openHour + i;
              return (
                <div
                  key={h}
                  className="absolute top-0 bottom-0 flex items-end pb-0.5"
                  style={{ left: `${i * PANEL_HOUR_PX + 2}px` }}
                >
                  <span className="text-[9px] text-muted-foreground leading-none whitespace-nowrap">
                    {fmt12(`${String(h).padStart(2, "0")}:00`)}
                  </span>
                  {/* Vertical column line */}
                  <div
                    className="absolute top-0 bottom-0 -left-0.5 w-px bg-border/20"
                  />
                </div>
              );
            })}
          </div>
        </div>

        {/* Coverage indicator row */}
        {coverageData && (
          <div
            className="relative border-b border-border/20 bg-muted/20"
            style={{ height: `${COVERAGE_H}px` }}
          >
            <div className="absolute left-0.5 top-0.5 text-[7px] text-muted-foreground/60 leading-none z-[1]">
              staffed/rec
            </div>
            {coverageData.map(cd => {
              const left = (cd.hour - openHour) * PANEL_HOUR_PX;
              const isOver = cd.scheduled >= cd.recommended && cd.recommended > 0;
              const isUnder = cd.scheduled < cd.recommended;
              return (
                <div
                  key={cd.hour}
                  className="absolute inset-y-0 flex flex-col items-center justify-center"
                  style={{ left: `${left}px`, width: `${PANEL_HOUR_PX}px` }}
                  title={`Hour ${cd.hour}: ${cd.scheduled} scheduled / ${cd.recommended} recommended`}
                >
                  <span
                    className={cn(
                      "text-[8px] font-medium leading-none",
                      isOver
                        ? "text-emerald-600 dark:text-emerald-400"
                        : isUnder
                        ? "text-amber-600 dark:text-amber-400"
                        : "text-muted-foreground"
                    )}
                  >
                    {cd.scheduled}/{cd.recommended}
                  </span>
                  <div className="absolute top-0 bottom-0 left-0 w-px bg-border/15" />
                </div>
              );
            })}
          </div>
        )}

        {/* Shift lane area */}
        <div
          className={cn("relative", onSlotClick && "cursor-pointer")}
          style={{ height: `${laneAreaH}px` }}
          onClick={handleShiftAreaClick}
        >
          {/* Vertical grid lines + half-hour dashes */}
          {Array.from({ length: numHours }).map((_, i) => (
            <div key={`col-${i}`}>
              <div
                className="absolute top-0 bottom-0 w-px bg-border/15"
                style={{ left: `${i * PANEL_HOUR_PX}px` }}
              />
              <div
                className="absolute top-0 bottom-0 w-px border-l border-dashed border-border/10"
                style={{ left: `${i * PANEL_HOUR_PX + PANEL_HOUR_PX / 2}px` }}
              />
            </div>
          ))}
          {/* Final column line */}
          <div
            className="absolute top-0 bottom-0 w-px bg-border/15"
            style={{ left: `${numHours * PANEL_HOUR_PX}px` }}
          />

          {/* Confirmed shifts */}
          {confirmedShifts.map(cs => {
            const laneIdx = laneMap.get(`confirmed-${cs.schedule.id}`) ?? 0;
            const startMin = panelTimeToMin(cs.startTime);
            const endMin = panelTimeToMin(cs.endTime);
            const left = ((startMin - openMin) / 60) * PANEL_HOUR_PX;
            const width = Math.max(((endMin - startMin) / 60) * PANEL_HOUR_PX - 2, 4);
            const top = LANE_PAD + laneIdx * LANE_H;
            const height = LANE_H - 4;
            const colorCls = getShiftColorClass(cs.schedule.userId);
            const isSelected = selectedActualId === cs.schedule.id;
            const timeLabel = `${fmt12(cs.startTime)}–${fmt12(cs.endTime)}`;

            return (
              <div
                key={`confirmed-${cs.schedule.id}`}
                data-panel-shift="true"
                className={cn(
                  "absolute rounded overflow-hidden text-white transition-shadow",
                  colorCls,
                  onSelectActualShift ? "cursor-pointer" : "cursor-default",
                  isSelected
                    ? "ring-2 ring-white ring-offset-1 z-20 shadow-lg opacity-100"
                    : "opacity-90 hover:opacity-100 hover:shadow-sm"
                )}
                style={{ left: `${left}px`, width: `${width}px`, top: `${top}px`, height: `${height}px` }}
                onClick={e => {
                  e.stopPropagation();
                  onSelectActualShift?.(cs.schedule);
                }}
                title={`${cs.name}: ${timeLabel} (scheduled)`}
              >
                <div className="px-1 flex flex-col overflow-hidden h-full justify-center">
                  <span className="text-[9px] font-semibold truncate leading-tight">{cs.name}</span>
                  {height >= 22 && (
                    <span className="text-[8px] opacity-80 truncate leading-tight">{timeLabel}</span>
                  )}
                </div>
              </div>
            );
          })}

          {/* Proposed (AI/manual) shifts */}
          {proposedShifts.map((shift, idx) => {
            if (excludedIdxs.has(idx)) return null;
            const laneIdx = laneMap.get(`proposed-${idx}`) ?? 0;
            const startMin = panelTimeToMin(shift.startTime);
            const endMin = panelTimeToMin(shift.endTime);
            const left = ((startMin - openMin) / 60) * PANEL_HOUR_PX;
            const width = Math.max(((endMin - startMin) / 60) * PANEL_HOUR_PX - 2, 4);
            const top = LANE_PAD + laneIdx * LANE_H;
            const height = LANE_H - 4;
            const isDraftCard = !shift.employeeId;
            const hasConflict = conflictingEmployeeIds.has(shift.employeeId);
            const colorCls = getShiftColorClass(shift.employeeId || shift.employeeName);
            const isSelected = selectedIdx === idx;
            const timeLabel = `${fmt12(shift.startTime)}–${fmt12(shift.endTime)}`;
            const displayName = isDraftCard ? "← Select employee" : shift.employeeName;

            return (
              <div
                key={`proposed-${idx}`}
                data-panel-shift="true"
                className={cn(
                  "absolute rounded overflow-hidden transition-shadow cursor-pointer",
                  isDraftCard
                    ? "bg-slate-200 dark:bg-slate-700 border-2 border-dashed border-slate-400 dark:border-slate-500 text-slate-600 dark:text-slate-300"
                    : hasConflict
                    ? "bg-amber-100 dark:bg-amber-900/40 border-2 border-amber-500 text-amber-900 dark:text-amber-200"
                    : cn("text-white", colorCls),
                  isSelected
                    ? hasConflict
                      ? "ring-[2px] ring-amber-400 ring-offset-1 shadow-lg z-10 opacity-100"
                      : isDraftCard
                      ? "ring-[2px] ring-slate-400 ring-offset-1 shadow-lg z-10 opacity-100"
                      : "ring-[2px] ring-white ring-offset-1 shadow-lg z-10 opacity-100"
                    : "opacity-90 hover:opacity-100 hover:shadow-sm"
                )}
                style={{ left: `${left}px`, width: `${width}px`, top: `${top}px`, height: `${height}px` }}
                onClick={e => {
                  e.stopPropagation();
                  onSelectShift?.(shift, idx);
                }}
                title={`${displayName}: ${timeLabel}${shift.rationale ? ` — ${shift.rationale}` : ""}`}
              >
                {/* Content (leave right padding for X button) */}
                <div className="px-1 pr-4 flex flex-col overflow-hidden h-full justify-center">
                  <span className="text-[9px] font-semibold truncate leading-tight">{displayName}</span>
                  {height >= 22 && (
                    <span className="text-[8px] opacity-80 truncate leading-tight">{timeLabel}</span>
                  )}
                </div>
                {/* Exclude button */}
                {onToggleExclude && (
                  <button
                    type="button"
                    data-panel-shift="true"
                    className="absolute top-0.5 right-0.5 flex items-center justify-center w-4 h-4 rounded-full bg-black/30 hover:bg-red-500 text-white z-10 transition-colors"
                    onClick={e => {
                      e.stopPropagation();
                      onToggleExclude(idx, shift);
                    }}
                    title="Remove from suggestions"
                  >
                    <X className="h-2.5 w-2.5" />
                  </button>
                )}
              </div>
            );
          })}

          {/* Draft shift — dashed outline, live-updates with form state */}
          {draftShift && (() => {
            const startMin = panelTimeToMin(draftShift.startTime);
            const endMin = panelTimeToMin(draftShift.endTime);
            if (endMin <= startMin) return null;
            const laneIdx = laneMap.get("draft") ?? 0;
            const left = ((startMin - openMin) / 60) * PANEL_HOUR_PX;
            const width = Math.max(((endMin - startMin) / 60) * PANEL_HOUR_PX - 2, 4);
            const top = LANE_PAD + laneIdx * LANE_H;
            const height = LANE_H - 4;
            const timeLabel = `${fmt12(draftShift.startTime)}–${fmt12(draftShift.endTime)}`;
            const displayName = draftShift.employeeName || "New Shift";

            return (
              <div
                key="draft"
                data-panel-shift="true"
                className="absolute rounded overflow-hidden border-2 border-dashed border-primary bg-primary/15 text-primary pointer-events-none z-[5]"
                style={{ left: `${left}px`, width: `${width}px`, top: `${top}px`, height: `${height}px` }}
                title={`Draft: ${displayName} ${timeLabel}`}
              >
                <div className="px-1 flex flex-col overflow-hidden h-full justify-center">
                  <span className="text-[9px] font-semibold truncate leading-tight">{displayName}</span>
                  {height >= 22 && (
                    <span className="text-[8px] opacity-80 truncate leading-tight">{timeLabel}</span>
                  )}
                </div>
              </div>
            );
          })()}

          {/* Click hint when no shifts */}
          {!hasAny && onSlotClick && (
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <span className="text-[10px] text-muted-foreground">Click to set shift start time</span>
            </div>
          )}
        </div>
      </div>

      {/* Footer hint */}
      {hasAny && (
        <p className="text-[9px] text-muted-foreground mt-1 px-0.5">
          {onSlotClick ? "Click empty area to set time · " : ""}
          Click shift to select
          {draftShift && " · dashed = your current draft"}
        </p>
      )}
    </div>
  );
}
