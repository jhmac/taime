import { useState, useEffect, useMemo, useRef, useCallback, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { BarChart, Bar, ResponsiveContainer, Tooltip, Cell, XAxis } from "recharts";
import { Button } from "@/components/ui/button";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { ToastAction } from "@/components/ui/toast";
import { apiRequest } from "@/lib/queryClient";
import { makeDlog } from "@/lib/dlog";
import { cn } from "@/lib/utils";
import { classifyShiftCard } from "./createShiftCardKind";
import {
  Clock, Users, Loader2, TrendingUp, Sparkles, AlertTriangle,
  ChevronDown, ChevronUp, Wand2, Check, X, RefreshCw,
  Maximize2, Minimize2, Pencil, Save, Trash2, Plus, Undo2, Redo2,
  Lock, Keyboard, DollarSign, Store, Copy, CalendarDays,
} from "lucide-react";
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from "@/components/ui/collapsible";
import type { Schedule } from "@shared/schema";
import {
  computeMargin,
  hasUnsavedChanges as hasUnsavedChangesHelper,
  loadDraft,
  saveDraft,
  clearDraft,
  evictStaleDrafts,
  modeFromEvent,
  nextMultiSelection,
  snapToWindow,
  oneHopNudge,
  pickAiGhostForMinute,
  type AiGhostCandidate,
} from "@/lib/createShiftHelpers";
import { useAuth } from "@/hooks/useAuth";
import { useWebSocketContext } from "@/contexts/WebSocketContext";

// ── Structured debug logging ────────────────────────────────────────────────
// Centralized so a session's user actions, state transitions, and save
// payloads can be reconstructed from the browser console when a user reports
// a bug. Toggleable via window.__TAIME_DEBUG__ = false to silence in noisy
// flows; defaults to ON so we capture data from the field by default.
// See docs/edit-shift-bug-trace-guide.md for the user-facing repro guide.
const dlog = makeDlog("Taime/Schedule");

interface HourlyData {
  hour: number;
  label: string;
  revenue: number;
  isPeak: boolean;
  suggestedStaff: number;
}

interface HistoricalSalesData {
  date: string;
  historicalDate: string;
  dataSource: string;
  dailyTotal: number;
  hourlyData: HourlyData[];
  storeHours: { open: string; close: string };
}

interface ProposedShift {
  employeeId: string;
  employeeName: string;
  profileImageUrl: string | null;
  startTime: string;
  endTime: string;
  shiftBlock: string;
  rationale: string;
  revenue: number;
}

interface SuggestData {
  date: string;
  proposedShifts: ProposedShift[];
  historicalDate: string;
  dataSource: string;
  hourlyData: HourlyData[];
  storeHours: { open: string; close: string };
}

interface AvailMember {
  userId: string;
  name: string;
  firstName: string | null;
  lastName: string | null;
  profileImageUrl: string | null;
  roleName: string;
  isAvailable: boolean;
  availableFrom: string | null;
  availableTo: string | null;
  overlapHours: number;
  compositeScore: number;
  source: string;
  /** Concrete availability windows for snap-to-availability (Task #387 B5).
   *  Always present alongside availableFrom/availableTo today (one window),
   *  but the API contract is an array so future split availability "just works". */
  windows?: { start: string; end: string }[];
  /** Hourly rate in dollars, used by the live margin meter (Task #387 C4). */
  hourlyRate?: number | null;
  /** Role FK so the margin meter can fall back to role.defaultHourlyRate. */
  roleId?: string | null;
}

interface TodayAvailData {
  date: string;
  storeHours: { open: string; close: string; isClosed: boolean } | null;
  members: AvailMember[];
}

interface User {
  id: string;
  firstName?: string | null;
  lastName?: string | null;
  email?: string | null;
}

interface WorkLocation {
  id: string;
  name: string;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  defaultDate: string;
  defaultUserId?: string;
  defaultStartTime?: string;
  defaultEndTime?: string;
  employees: User[];
  locations: WorkLocation[];
  filterByAvailability: boolean;
  onFilterChange: (v: boolean) => void;
  onDateChange?: (date: string) => void;
  modalEmployees: User[];
  onCreateShift: (data: {
    userId: string;
    startTime: Date;
    endTime: Date;
    title?: string;
    locationId?: string;
    description?: string;
  }) => void;
  isCreating: boolean;
  autoAssignMutation: {
    mutate: (payload: { date: string; startTime?: string; endTime?: string }) => void;
    isPending: boolean;
  };
  isAdmin?: boolean;
  editingSchedule?: Schedule | null;
  onUpdateSchedule?: (data: {
    id: string;
    userId: string;
    startTime: Date;
    endTime: Date;
    title?: string | null;
    locationId?: string | null;
    description?: string | null;
  }) => void;
  onDeleteSchedule?: (id: string) => void;
  isUpdating?: boolean;
  isDeleting?: boolean;
  onAddNewShift?: () => void;
  schedules?: Schedule[];
  onSelectSchedule?: (schedule: Schedule) => void;
  /** Date range (YYYY-MM-DD inclusive) currently displayed by the schedule grid behind the panel.
   *  Used to detect off-week saves so we can offer a "Jump to that week" toast. */
  currentWeekRange?: { start: string; end: string };
  /** Called when the user clicks the "Jump to that week" toast action after saving shifts
   *  for a date outside the visible week. The receiver should adjust the grid's week state. */
  onJumpToWeek?: (date: string) => void;
}

function fmt12(t: string) {
  const [h, m] = t.split(":").map(Number);
  const ampm = h >= 12 ? "pm" : "am";
  const h12 = h % 12 || 12;
  return m === 0 ? `${h12}${ampm}` : `${h12}:${String(m).padStart(2, "0")}${ampm}`;
}

function timeToMin(t: string) {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + (m || 0);
}

// Bug fix (color consistency): hash user IDs (not names) against the same
// 10-colour palette + ordering used by ScheduleTimelineView so that a person
// gets ONE colour app-wide — their shift cards in the timeline, the shift
// cards in this panel, and their avatar pill in the "Who's Available Today"
// section all line up. Hashing by name caused two people with the same
// initials to collide and made the panel/timeline/avatar diverge whenever
// the palette sizes (8/6/10) hashed to different buckets.
const SHIFT_COLORS = [
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
];

function getShiftColor(userId: string) {
  const key = userId || "";
  let hash = 0;
  for (let i = 0; i < key.length; i++) hash = key.charCodeAt(i) + ((hash << 5) - hash);
  return SHIFT_COLORS[Math.abs(hash) % SHIFT_COLORS.length];
}

function ShiftBlock({
  shift,
  openMin,
  closeMin,
  onClick,
  isSelected,
  isExcluded,
  onToggleExclude,
  hasConflict,
  onResizeStart,
  onBodyPointerDown,
  xTooltip,
}: {
  shift: ProposedShift;
  openMin: number;
  closeMin: number;
  onClick: () => void;
  isSelected: boolean;
  isExcluded: boolean;
  // Accepts any synthetic event so the same handler can be wired to both
  // the parent's onClick (MouseEvent when the card is excluded — the body
  // becomes a "click to restore" target) and the new sibling X button's
  // onPointerUp (PointerEvent). React.PointerEvent does not structurally
  // extend React.MouseEvent in @types/react even though the underlying
  // DOM PointerEvent extends MouseEvent, so widening to SyntheticEvent
  // avoids an `as unknown as React.MouseEvent` cast at every call site.
  onToggleExclude: (e: React.SyntheticEvent) => void;
  hasConflict: boolean;
  onResizeStart?: (e: React.PointerEvent, type: 'top' | 'bottom') => void;
  onBodyPointerDown?: (e: React.PointerEvent) => void;
  /** Tooltip shown on the per-card X button. Differs by card type
   *  (AI suggestion vs manual draft) so the user knows what X will do. */
  xTooltip?: string;
}) {
  const totalMin = closeMin - openMin;
  if (totalMin <= 0) return null;
  const startMin = timeToMin(shift.startTime);
  const endMin = timeToMin(shift.endTime);
  const topPct = ((Math.max(startMin, openMin) - openMin) / totalMin) * 100;
  const heightPct = ((Math.min(endMin, closeMin) - Math.max(startMin, openMin)) / totalMin) * 100;
  if (heightPct <= 0) return null;
  const color = getShiftColor(shift.employeeId || shift.employeeName);

  let title = shift.rationale;
  if (isExcluded) title = "Click to restore this shift";
  else if (hasConflict) title = `${shift.employeeName} already has a shift scheduled on this day`;

  const isDraft = !shift.employeeId;

  return (
    <div
      data-shift-card="true"
      style={{ top: `${topPct}%`, height: `${heightPct}%` }}
      className="absolute inset-x-0.5"
    >
      {/* Top resize handle */}
      {!isExcluded && onResizeStart && (
        <div
          className="absolute top-0 left-0 right-0 h-2 cursor-ns-resize z-20 rounded-t-md hover:bg-black/25 select-none"
          onPointerDown={(e) => { e.stopPropagation(); onResizeStart(e, 'top'); }}
        />
      )}
      <button
        onPointerDown={!isExcluded ? onBodyPointerDown : undefined}
        onClick={isExcluded ? onToggleExclude : onClick}
        title={title}
        className={cn(
          "w-full h-full rounded-md px-1.5 py-0.5 text-left transition-all overflow-hidden group",
          isExcluded
            ? "bg-muted/60 border border-dashed border-border opacity-50"
            : isDraft
            ? "bg-slate-200 dark:bg-slate-700 border-2 border-dashed border-slate-400 dark:border-slate-500"
            : hasConflict
            ? "bg-amber-100 dark:bg-amber-900/40 border-2 border-amber-500"
            : color,
          isExcluded
            ? "text-muted-foreground text-[10px] font-medium leading-tight"
            : isDraft
            ? "text-slate-500 dark:text-slate-400 text-[10px] font-medium leading-tight"
            : hasConflict
            ? "text-amber-900 dark:text-amber-200 text-[10px] font-medium leading-tight"
            : "text-white text-[10px] font-medium leading-tight",
          !isExcluded && isSelected
            ? hasConflict
              ? "ring-[3px] ring-amber-400 ring-offset-2 opacity-100 scale-[1.02] shadow-lg z-10 relative"
              : isDraft
              ? "ring-[3px] ring-slate-400 ring-offset-2 opacity-100 scale-[1.02] shadow-lg z-10 relative"
              : "ring-[3px] ring-white ring-offset-2 opacity-100 scale-[1.02] shadow-lg z-10 relative"
            : !isExcluded
            ? "opacity-90 hover:opacity-100"
            : ""
        )}
      >
        <div className={cn("truncate pt-1", isExcluded && "line-through")}>
          {isDraft ? "← Select employee" : shift.employeeName}
        </div>
        {/* Claude's per-shift rationale — rendered immediately under the
            employee name (per Task #334) so it reads naturally as "why this
            person got picked". Shown for AI-suggested cards regardless of
            conflict state — the conflict warning below is additive, not a
            replacement, so the manager always sees the reasoning when
            deciding whether to keep or drop a duplicate-day proposal. */}
        {!isExcluded && !isDraft && shift.rationale ? (
          <div
            className="opacity-90 text-[10px] leading-snug line-clamp-2 italic"
            data-testid="shift-card-rationale"
          >
            {shift.rationale}
          </div>
        ) : null}
        <div className={cn("truncate opacity-80", isExcluded && "line-through")}>
          {fmt12(shift.startTime)}–{fmt12(shift.endTime)}
        </div>
        {!isExcluded && hasConflict ? (
          <div className="flex items-center gap-0.5 text-amber-600 dark:text-amber-400 text-[9px] font-semibold">
            <AlertTriangle className="h-2.5 w-2.5 shrink-0" />
            Already scheduled
          </div>
        ) : null}
      </button>
      {!isExcluded && (
        <button
          type="button"
          role="button"
          title={xTooltip ?? "Exclude this shift"}
          onPointerDown={(e) => {
            // Stop the parent body's pointerdown so pressing the X never
            // initiates a drag/resize on the underlying card.
            e.stopPropagation();
          }}
          onPointerUp={(e) => {
            // Commit on pointerup with stopPropagation so the parent's click
            // handler (selection) cannot also fire and re-open the shift.
            e.stopPropagation();
            e.preventDefault();
            onToggleExclude(e);
          }}
          onClick={(e) => {
            // Defensive fallback for non-pointer activations (keyboard,
            // accessibility tooling). Plain pointer paths exit at pointerup.
            e.stopPropagation();
            onToggleExclude(e);
          }}
          className="absolute top-0.5 right-0.5 z-30 flex items-center justify-center w-5 h-5 rounded-full bg-black/45 opacity-70 hover:opacity-100 hover:bg-red-500 hover:scale-110 text-white transition-all cursor-pointer shadow"
        >
          <X className="h-3 w-3" />
        </button>
      )}
      {/* Bottom resize handle */}
      {!isExcluded && onResizeStart && (
        <div
          className="absolute bottom-0 left-0 right-0 h-2 cursor-ns-resize z-20 rounded-b-md hover:bg-black/25 select-none"
          onPointerDown={(e) => { e.stopPropagation(); onResizeStart(e, 'bottom'); }}
        />
      )}
    </div>
  );
}

// ── DataSourceBanner ─────────────────────────────────────────────────────────
// Surfaces, at the top of the Suggested Schedule Review panel, *which* data
// Claude based its proposals on (real Shopify orders / estimated daily total /
// no historical data) and the historical date that was used. Without this the
// user has no way to gauge how trustworthy the AI's per-shift rationales are.
// `manual` source is hidden because there is no AI rationale for user-added
// shifts. `synthetic` skips the date line — the date isn't meaningful when no
// data was found.
function DataSourceBanner({
  dataSource,
  historicalDate,
}: {
  dataSource: string | undefined;
  historicalDate: string | undefined;
}) {
  if (!dataSource || dataSource === "manual") return null;

  const config: Record<
    string,
    { label: string; classes: string; iconColor: string; Icon: typeof TrendingUp }
  > = {
    actual: {
      label: "Real Shopify orders",
      classes:
        "border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-800 dark:bg-emerald-900/20 dark:text-emerald-200",
      iconColor: "text-emerald-600 dark:text-emerald-400",
      Icon: TrendingUp,
    },
    estimated: {
      label: "Estimated from daily total",
      classes:
        "border-sky-200 bg-sky-50 text-sky-900 dark:border-sky-800 dark:bg-sky-900/20 dark:text-sky-200",
      iconColor: "text-sky-600 dark:text-sky-400",
      Icon: TrendingUp,
    },
    synthetic: {
      label: "No historical sales data — using minimum staffing defaults",
      classes:
        "border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-200",
      iconColor: "text-amber-600 dark:text-amber-400",
      Icon: AlertTriangle,
    },
  };

  const cfg = config[dataSource];
  if (!cfg) return null;

  const dateLabel = historicalDate
    ? new Date(historicalDate + "T12:00:00Z").toLocaleDateString("en-US", {
        month: "long",
        day: "numeric",
        year: "numeric",
      })
    : "";

  return (
    <div
      className={cn(
        "flex items-start gap-2 text-xs rounded-lg border px-3 py-2",
        cfg.classes
      )}
      data-testid="data-source-banner"
    >
      <cfg.Icon className={cn("h-3.5 w-3.5 shrink-0 mt-0.5", cfg.iconColor)} />
      <div className="flex-1 leading-snug">
        <p className="font-semibold" data-testid="data-source-label">
          Data source: {cfg.label}
        </p>
        {dateLabel && dataSource !== "synthetic" && (
          <p className="opacity-80 mt-0.5" data-testid="data-source-historical-date">
            Based on {dateLabel} sales data
          </p>
        )}
      </div>
    </div>
  );
}

function SalesChart({
  data,
  isLoading,
}: {
  data: HistoricalSalesData | null | undefined;
  isLoading: boolean;
}) {

  if (isLoading) {
    return (
      <div className="mb-4 space-y-2">
        <Skeleton className="h-4 w-48 rounded" />
        <Skeleton className="h-24 w-full rounded-lg" />
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
      <div className="mb-4 rounded-lg border border-dashed border-border bg-muted/30 p-4 text-center">
        <TrendingUp className="h-6 w-6 text-muted-foreground mx-auto mb-1" />
        <p className="text-xs text-muted-foreground font-medium">No historical sales data for this date</p>
        <p className="text-[10px] text-muted-foreground mt-0.5">AI suggestions will use minimum staffing defaults.</p>
      </div>
    );
  }

  const dailyFmt = data.dailyTotal >= 1000
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
    <div className="mb-3">
      <div className="flex items-center justify-between mb-1">
        <span className="text-[11px] font-medium text-muted-foreground flex items-center gap-1">
          <TrendingUp className="h-3 w-3" />
          Projected Revenue
        </span>
        <div className="flex items-center gap-2">
          <span className="text-[9px] text-muted-foreground italic">Based on {historicalLabel}</span>
          <div className="flex items-center gap-1">
            <span className="text-[11px] font-semibold text-foreground">{dailyFmt} total</span>
          </div>
        </div>
      </div>
      <div className="h-28 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data.hourlyData} margin={{ top: 2, right: 2, bottom: 2, left: 2 }}>
            <Tooltip
              cursor={false}
              content={({ active, payload }) => {
                if (!active || !payload?.[0]) return null;
                const d = payload[0].payload as HourlyData;
                return (
                  <div className="bg-popover border border-border rounded px-2 py-1 text-[10px] shadow">
                    <div className="font-medium">{d.label}</div>
                    <div className="text-muted-foreground">${Math.round(d.revenue).toLocaleString()}{d.isPeak ? " · peak" : ""}</div>
                    <div className="text-muted-foreground">{d.suggestedStaff} staff recommended</div>
                  </div>
                );
              }}
            />
            <XAxis
              dataKey="label"
              tick={{ fontSize: 8, fill: '#94a3b8' }}
              axisLine={false}
              tickLine={false}
              interval={0}
            />
            <Bar dataKey="revenue" radius={[2, 2, 0, 0]} maxBarSize={22}>
              {data.hourlyData.map((entry, i) => (
                <Cell
                  key={i}
                  fill={entry.isPeak ? "#f59e0b" : "#94a3b8"}
                />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      <div className="flex items-center gap-3 mt-0.5">
        <span className="flex items-center gap-1 text-[9px] text-muted-foreground">
          <span className="inline-block w-3 h-2 rounded-sm bg-amber-400" />peak
        </span>
        <span className="flex items-center gap-1 text-[9px] text-muted-foreground">
          <span className="inline-block w-3 h-2 rounded-sm bg-slate-400" />standard
        </span>
      </div>
    </div>
  );
}

// ── Pill score badge ─────────────────────────────────────────────────────────
// Color-blind safe: each tier carries a distinct shape symbol AND a distinct
// aria-label so screen-readers announce "Top match" / "Strong match" / "OK
// match" rather than a bare number. Color is supplemental, not load-bearing.
function PillScoreBadge({ score }: { score: number }) {
  let tier: 'top' | 'strong' | 'ok';
  let symbol: string;
  let suffix: string;
  let bg: string;
  let fg: string;
  let label: string;
  if (score >= 85) {
    tier = 'top'; symbol = '★'; suffix = 'Top'; bg = 'bg-yellow-400'; fg = 'text-yellow-900';
    label = `Top match — score ${score}`;
  } else if (score >= 60) {
    tier = 'strong'; symbol = '◆'; suffix = 'Strong'; bg = 'bg-slate-300'; fg = 'text-slate-700';
    label = `Strong match — score ${score}`;
  } else {
    tier = 'ok'; symbol = '•'; suffix = 'OK'; bg = 'bg-muted'; fg = 'text-muted-foreground';
    label = `OK match — score ${score}`;
  }
  return (
    <span
      className={cn('inline-flex items-center gap-0.5 px-1.5 h-5 rounded-full text-[9px] font-bold shrink-0', bg, fg)}
      title={label}
      aria-label={label}
      data-tier={tier}
    >
      <span aria-hidden="true">{symbol}</span>
      <span aria-hidden="true">{suffix}</span>
      <span aria-hidden="true" className="opacity-70">{score}</span>
    </span>
  );
}

// ── Mini availability bar ─────────────────────────────────────────────────────
function PillAvailBar({ member, storeOpen, storeClose }: { member: AvailMember; storeOpen: string; storeClose: string }) {
  if (!member.isAvailable || !member.availableFrom || !member.availableTo) return null;
  function t2m(t: string) { const [h, m] = t.split(':').map(Number); return h * 60 + (m || 0); }
  const openMins = t2m(storeOpen);
  const closeMins = t2m(storeClose);
  const total = closeMins - openMins;
  if (total <= 0) return null;
  const from = Math.max(t2m(member.availableFrom), openMins);
  const to = Math.min(t2m(member.availableTo), closeMins);
  const startPct = ((from - openMins) / total) * 100;
  const widthPct = Math.max(0, ((to - from) / total) * 100);
  return (
    <div className="w-full h-1 bg-muted rounded-full overflow-hidden mt-0.5">
      <div
        className="h-full bg-emerald-500 rounded-full"
        style={{ marginLeft: `${startPct}%`, width: `${widthPct}%` }}
      />
    </div>
  );
}

// ── AvailableEmployeePills ────────────────────────────────────────────────────
function AvailableEmployeePills({
  members,
  storeHours,
  isLoading,
  scheduledEmployeeIds,
  onAdd,
  showUnavailable,
  onToggleUnavailable,
  dateKey,
  onPillDragStart,
}: {
  members: AvailMember[];
  storeHours: { open: string; close: string } | null;
  isLoading: boolean;
  scheduledEmployeeIds: Set<string>;
  onAdd: (member: AvailMember) => void;
  showUnavailable: boolean;
  onToggleUnavailable: () => void;
  dateKey?: string;
  /** Task #392 C1 — start a drag-from-pill onto the timeline. Caller installs
   *  the document-level pointermove/pointerup listeners and renders the green
   *  band + ghost preview on DayTimeline. */
  onPillDragStart?: (member: AvailMember, e: React.PointerEvent) => void;
}) {
  // Filters are restored from localStorage only when the saved dateKey matches
  // the current dateKey, preventing stale values from a previous day bleeding
  // through on fresh mounts.
  const [roleFilter, setRoleFilter] = useState(() => {
    try {
      const saved = localStorage.getItem('pillFilter_dateKey');
      if (saved !== dateKey) return 'all';
      return localStorage.getItem('pillFilter_roleFilter') || 'all';
    } catch { return 'all'; }
  });
  const [minScore, setMinScore] = useState(() => {
    try {
      const saved = localStorage.getItem('pillFilter_dateKey');
      if (saved !== dateKey) return 0;
      return parseInt(localStorage.getItem('pillFilter_minScore') || '0', 10);
    } catch { return 0; }
  });
  const [minHours, setMinHours] = useState(() => {
    try {
      const saved = localStorage.getItem('pillFilter_dateKey');
      if (saved !== dateKey) return 0;
      return parseFloat(localStorage.getItem('pillFilter_minHours') || '0');
    } catch { return 0; }
  });

  // Track previous dateKey so we skip the reset on initial mount and only
  // reset when the date actually changes between renders.
  const prevDateKeyRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (prevDateKeyRef.current !== undefined && prevDateKeyRef.current !== dateKey) {
      setRoleFilter('all');
      setMinScore(0);
      setMinHours(0);
      try {
        localStorage.removeItem('pillFilter_roleFilter');
        localStorage.removeItem('pillFilter_minScore');
        localStorage.removeItem('pillFilter_minHours');
        localStorage.removeItem('pillFilter_dateKey');
      } catch {}
    }
    prevDateKeyRef.current = dateKey;
  }, [dateKey]);

  useEffect(() => {
    try {
      localStorage.setItem('pillFilter_roleFilter', roleFilter);
      if (dateKey) localStorage.setItem('pillFilter_dateKey', dateKey);
    } catch {}
  }, [roleFilter, dateKey]);
  useEffect(() => {
    try {
      localStorage.setItem('pillFilter_minScore', String(minScore));
      if (dateKey) localStorage.setItem('pillFilter_dateKey', dateKey);
    } catch {}
  }, [minScore, dateKey]);
  useEffect(() => {
    try {
      localStorage.setItem('pillFilter_minHours', String(minHours));
      if (dateKey) localStorage.setItem('pillFilter_dateKey', dateKey);
    } catch {}
  }, [minHours, dateKey]);

  const roles = useMemo(() => {
    return Array.from(new Set(members.map(m => m.roleName))).sort();
  }, [members]);

  const filteredMembers = useMemo(() => {
    return members.filter(m => {
      if (roleFilter !== 'all' && m.roleName !== roleFilter) return false;
      if (m.compositeScore < minScore) return false;
      if (minHours > 0 && m.overlapHours < minHours) return false;
      return true;
    });
  }, [members, roleFilter, minScore, minHours]);

  const availableMembers = filteredMembers.filter(m => m.isAvailable);
  // Unavailable list is always derived from the unfiltered set so that
  // role/score filters never affect the "Show unavailable" toggle.
  const allUnavailableMembers = members.filter(m => !m.isAvailable);
  const visibleMembers = showUnavailable
    ? [...availableMembers, ...allUnavailableMembers]
    : availableMembers;

  // For the empty-state message: detect if filters are actively hiding available members.
  const unfilteredAvailableCount = members.filter(m => m.isAvailable).length;

  const storeOpen = storeHours?.open || '09:00';
  const storeClose = storeHours?.close || '21:00';

  function fmtTime(t: string) {
    const [h, m] = t.split(':').map(Number);
    const ampm = h >= 12 ? 'pm' : 'am';
    const h12 = h % 12 || 12;
    return m === 0 ? `${h12}${ampm}` : `${h12}:${String(m).padStart(2, '0')}${ampm}`;
  }

  function memberInitials(m: AvailMember) {
    return ((m.firstName?.[0] || '') + (m.lastName?.[0] || '')).toUpperCase() || '?';
  }

  // Re-use the canonical SHIFT_COLORS palette + getShiftColor helper so the
  // avatar dot here matches the user's shift card colour exactly. See the
  // comment above SHIFT_COLORS for the underlying rationale.
  const pillColor = getShiftColor;

  if (isLoading) {
    return (
      <div>
        <div className="text-[11px] font-medium text-muted-foreground mb-2 flex items-center gap-1">
          <Users className="h-3 w-3" />
          Who's Available Today
        </div>
        <div className="flex flex-wrap gap-2">
          {[1, 2, 3, 4].map(i => (
            <Skeleton key={i} className="h-16 w-44 rounded-lg flex-shrink-0" />
          ))}
        </div>
      </div>
    );
  }

  const allScheduled = availableMembers.length > 0 && availableMembers.every(m => scheduledEmployeeIds.has(m.userId));

  return (
    <div>
      {/* Section header */}
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-[11px] font-medium text-muted-foreground flex items-center gap-1">
          <Users className="h-3 w-3" />
          Who's Available Today
          {availableMembers.length > 0 && (
            <span className="ml-1 text-foreground font-semibold">({availableMembers.length})</span>
          )}
        </span>
        {allUnavailableMembers.length > 0 && (
          <button
            onClick={onToggleUnavailable}
            className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors"
          >
            {showUnavailable ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
            {showUnavailable ? 'Hide unavailable' : `+${allUnavailableMembers.length} unavailable`}
          </button>
        )}
      </div>

      {/* Filter chips */}
      {members.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-2">
          <Select value={roleFilter} onValueChange={setRoleFilter}>
            <SelectTrigger className="h-6 text-[10px] w-auto min-w-[80px] px-2 border-border/60">
              <SelectValue placeholder="Role" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All roles</SelectItem>
              {roles.map(r => <SelectItem key={r} value={r}>{r}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={String(minScore)} onValueChange={v => setMinScore(Number(v))}>
            <SelectTrigger className="h-6 text-[10px] w-auto min-w-[80px] px-2 border-border/60">
              <SelectValue placeholder="Min score" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="0">Any score</SelectItem>
              <SelectItem value="35">≥35 (Bronze+)</SelectItem>
              <SelectItem value="60">≥60 (Silver+)</SelectItem>
              <SelectItem value="85">≥85 (Gold)</SelectItem>
            </SelectContent>
          </Select>
          <Select value={String(minHours)} onValueChange={v => setMinHours(Number(v))}>
            <SelectTrigger className="h-6 text-[10px] w-auto min-w-[80px] px-2 border-border/60">
              <SelectValue placeholder="Min hours" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="0">Any hours</SelectItem>
              <SelectItem value="2">≥2h</SelectItem>
              <SelectItem value="4">≥4h</SelectItem>
              <SelectItem value="6">≥6h</SelectItem>
            </SelectContent>
          </Select>
        </div>
      )}

      {/* Empty states */}
      {availableMembers.length === 0 && !showUnavailable && (
        <div className="rounded-lg border border-dashed border-border bg-muted/30 py-3 px-4 text-center">
          <p className="text-xs text-muted-foreground">
            {unfilteredAvailableCount > 0
              ? 'No employees match the current filters.'
              : 'No availability data yet for this day.'}
          </p>
        </div>
      )}
      {availableMembers.length > 0 && allScheduled && !showUnavailable && (
        <div className="rounded-lg border border-dashed border-emerald-300 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-900/20 py-3 px-4 text-center">
          <p className="text-xs text-emerald-700 dark:text-emerald-400">Everyone is already scheduled for this day.</p>
        </div>
      )}

      {/* Pill grid — horizontally wrapping */}
      {visibleMembers.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {visibleMembers.map(member => {
            const isScheduled = scheduledEmployeeIds.has(member.userId);
            const windowLabel = member.availableFrom && member.availableTo
              ? `${fmtTime(member.availableFrom)} – ${fmtTime(member.availableTo)}`
              : 'All day';
            const unavailReason = !member.isAvailable
              ? (member.source === 'time_off' ? 'Time off' : 'Not available')
              : null;

            const canDrag = member.isAvailable && !isScheduled && !!onPillDragStart;
            return (
              <div
                key={member.userId}
                data-testid={`avail-pill-${member.userId}`}
                className={cn(
                  "relative flex flex-col gap-1 p-2 rounded-lg border w-44 flex-shrink-0 transition-all touch-none",
                  !member.isAvailable
                    ? "bg-muted/20 border-border/30 opacity-50"
                    : isScheduled
                    ? "bg-muted/30 border-border/40"
                    : "bg-background border-border hover:border-primary/40 hover:shadow-sm",
                  canDrag && "cursor-grab active:cursor-grabbing"
                )}
                title={unavailReason || (canDrag ? `Drag onto the timeline to add a shift for ${member.name}` : undefined)}
                onPointerDown={canDrag ? (e) => {
                  // Only left-button / primary input triggers a drag. Buttons
                  // inside the pill (e.g. "Add shift") still get their click —
                  // we only promote to a real drag once the pointer moves
                  // beyond a small threshold (handled by the parent).
                  if (e.button !== 0) return;
                  const target = e.target as HTMLElement;
                  if (target.closest('button')) return;
                  onPillDragStart?.(member, e);
                } : undefined}
              >
                {/* Avatar + name row */}
                <div className="flex items-center gap-1.5 min-w-0">
                  {member.profileImageUrl ? (
                    <img
                      src={member.profileImageUrl}
                      alt={member.name}
                      className="w-6 h-6 rounded-full object-cover shrink-0"
                    />
                  ) : (
                    <div className={cn("w-6 h-6 rounded-full flex items-center justify-center text-white text-[9px] font-bold shrink-0", pillColor(member.userId))}>
                      {memberInitials(member)}
                    </div>
                  )}
                  <span className="text-[11px] font-medium truncate flex-1 min-w-0">{member.name}</span>
                  <PillScoreBadge score={member.compositeScore} />
                </div>

                {/* Availability range + bar */}
                {member.isAvailable ? (
                  <>
                    <span className="text-[10px] text-emerald-600 dark:text-emerald-400 leading-none">{windowLabel}</span>
                    <PillAvailBar member={member} storeOpen={storeOpen} storeClose={storeClose} />
                  </>
                ) : (
                  <span className="text-[10px] text-muted-foreground italic flex items-center gap-0.5 leading-none">
                    <Lock className="h-2.5 w-2.5" />
                    {unavailReason}
                  </span>
                )}

                {/* Action */}
                {member.isAvailable && (
                  isScheduled ? (
                    <span className="flex items-center gap-0.5 text-[10px] text-emerald-600 dark:text-emerald-400 font-medium mt-0.5">
                      <Check className="h-3 w-3" />
                      Scheduled
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => onAdd(member)}
                      className="flex items-center gap-0.5 text-[10px] font-medium text-primary hover:text-primary/80 mt-0.5 w-fit"
                      title={`Add shift for ${member.name}`}
                    >
                      <Plus className="h-3 w-3" />
                      Add shift
                    </button>
                  )
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

type DragState = {
  idx: number;
  type: 'top' | 'bottom' | 'move';
  offsetPct?: number;
  initialY?: number;
} | null;

type ActualShiftEntry = { schedule: Schedule; name: string; startTime: string; endTime: string };

// Always-visible delete button for persisted "Scheduled" cards.
//
// Earlier versions hid this button until you hovered the card AND dwelt for
// 200ms ("hover-intent"). That made deletion feel broken: the X often
// disappeared mid-click when the cursor crossed the card boundary, and on
// touch devices it never appeared at all. Worse, when the card had pointer
// capture from the parent's drag handler, the click could be silently
// swallowed.
//
// The new behavior:
//   - The X is always rendered in the corner. It dims to a subtle 60%
//     opacity when not hovered so it doesn't compete visually with the
//     shift label, then jumps to full red on hover.
//   - We commit on pointerup with stopPropagation, NOT click. This avoids
//     the parent card's pointer-capture flow stealing the event before a
//     synthetic "click" can fire.
//   - pointerdown also stops propagation so the parent never starts a drag
//     just because the user pressed the X.
function HoverIntentDeleteButton({ onConfirm }: { onConfirm: () => void }) {
  const [hovered, setHovered] = useState(false);
  return (
    <button
      type="button"
      data-testid="hover-intent-delete"
      data-armed={hovered ? 'true' : 'false'}
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
      onPointerDown={(e) => {
        // Block the parent card's drag-start handler so pressing the X
        // never initiates a move.
        e.stopPropagation();
      }}
      onPointerUp={(e) => {
        // Commit on pointerup. Stop both propagation and default so the
        // parent card never sees a click — otherwise we'd both delete the
        // card AND select it on the way out.
        e.stopPropagation();
        e.preventDefault();
        onConfirm();
      }}
      onClick={(e) => {
        // Defensive: if pointerup didn't fire (e.g. keyboard activation),
        // honor the click. Synthetic clicks from screen readers count.
        e.stopPropagation();
        onConfirm();
      }}
      title="Delete from schedule"
      className={`absolute top-0.5 right-0.5 flex items-center justify-center w-5 h-5 rounded-full text-white z-30 transition-all cursor-pointer ${
        hovered
          ? 'bg-red-500 opacity-100 scale-110 shadow-md'
          : 'bg-black/45 opacity-60 hover:opacity-100'
      }`}
    >
      <X className="h-3 w-3" />
    </button>
  );
}

function DayTimeline({
  suggestData,
  isLoading,
  isError,
  errorMsg,
  storeHours,
  selectedIdx,
  onSelectShift,
  excludedIdxs,
  onToggleExclude,
  conflictingEmployeeIds,
  onShiftEdit,
  onDragStart,
  onDragEnd,
  actualShifts,
  onSelectActualShift,
  selectedActualId,
  multiSelectedActualIds,
  onActualShiftChange,
  onDeleteActualShift,
  aiCount,
  pillDrag,
  aiGhostCandidates,
  onApplyAiGhost,
  scheduledEmployeeIds,
}: {
  suggestData: SuggestData | null | undefined;
  isLoading: boolean;
  isError?: boolean;
  errorMsg?: string;
  storeHours: { open: string; close: string } | null;
  selectedIdx: number | null;
  onSelectShift: (shift: ProposedShift, idx: number) => void;
  excludedIdxs: Set<number>;
  onToggleExclude: (idx: number, shift: ProposedShift) => void;
  conflictingEmployeeIds: Set<string>;
  onShiftEdit?: (idx: number, updates: { startTime?: string; endTime?: string }) => void;
  onDragStart?: (idx: number) => void;
  onDragEnd?: () => void;
  actualShifts?: ActualShiftEntry[];
  onSelectActualShift?: (s: Schedule, e?: React.MouseEvent) => void;
  selectedActualId?: string | null;
  multiSelectedActualIds?: ReadonlySet<string>;
  onActualShiftChange?: (s: Schedule, startTime: string, endTime: string) => void;
  onDeleteActualShift?: (s: Schedule) => void;
  aiCount: number;
  /** Task #392 C1/C2 — when set, render a green availability band + dashed
   *  ghost block so the user sees where their drop will land. */
  pillDrag?: { member: AvailMember; clientY: number } | null;
  /** Task #392 C5 — list of AI-suggested shifts (with original idx) so the
   *  timeline can render a faint ghost on empty hover space. */
  aiGhostCandidates?: AiGhostCandidate[];
  onApplyAiGhost?: (candidate: AiGhostCandidate) => void;
  /** Set of employeeIds that already have a scheduled or manual shift on this
   *  day — used to filter the AI ghost so it doesn't suggest a duplicate. */
  scheduledEmployeeIds?: ReadonlySet<string>;
}) {
  const open = storeHours?.open || suggestData?.storeHours?.open || "09:00";
  const close = storeHours?.close || suggestData?.storeHours?.close || "21:00";
  // Bug #4 — allow scheduling pre-open/post-close (e.g. opening or closing
  // duties). The displayed grid extends BUFFER_MIN minutes beyond the store's
  // actual open/close times so a shift like 7:30 AM on a 9:00 AM store still
  // renders as a positioned card. Drag-clamping uses the same buffered range
  // so the user can drag/resize into the buffer zone too.
  const storeOpenMin = timeToMin(open);
  const storeCloseMin = timeToMin(close);
  const BUFFER_MIN = 60;
  const openMin = Math.max(0, storeOpenMin - BUFFER_MIN);
  const closeMin = Math.min(24 * 60, storeCloseMin + BUFFER_MIN);
  const totalMin = closeMin - openMin;
  const containerRef = useRef<HTMLDivElement>(null);
  // Bug #1 — don't immediately setPointerCapture on pointerdown. Capture
  // re-routes the synthetic `click` event to the captured ancestor instead
  // of the original button, blocking ShiftBlock onClick from selecting any
  // card after a previous interaction. We promote a "pending" drag to an
  // "active" drag (with capture) only after the user actually moves >5px.
  type DragState = { idx: number; type: 'top' | 'bottom' | 'move'; offsetPct?: number; initialY?: number; pointerId?: number; captured?: boolean } | null;
  const dragRef = useRef<DragState>(null);
  const blockClickSuppressRef = useRef(false);
  type ActualDrag = { idx: number; schedule: Schedule; type: 'top' | 'bottom' | 'move'; offsetPct?: number; initialY?: number; previewStart: string; previewEnd: string; pointerId?: number; captured?: boolean };
  const actualDragRef = useRef<ActualDrag | null>(null);
  const [actualDragPreview, setActualDragPreview] = useState<{ idx: number; startTime: string; endTime: string } | null>(null);
  const actualClickSuppressRef = useRef(false);
  // Task #392 C5 — hover Y over the empty timeline area, used to render the
  // AI ghost preview. Set to null when the cursor leaves or is over a card.
  const [hoverY, setHoverY] = useState<number | null>(null);

  const minsToStr = (mins: number) =>
    `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;

  const handleResizeStart = useCallback((e: React.PointerEvent, idx: number, type: 'top' | 'bottom') => {
    if (!containerRef.current) return;
    e.preventDefault();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    dragRef.current = { idx, type };
    onDragStart?.(idx);
  }, [onDragStart]);

  const handleBodyPointerDown = useCallback((e: React.PointerEvent, idx: number) => {
    if (!containerRef.current || !onShiftEdit) return;
    const rect = containerRef.current.getBoundingClientRect();
    const relY = (e.clientY - rect.top) / rect.height;
    const shifts = suggestData?.proposedShifts ?? [];
    const shift = shifts[idx];
    if (!shift) return;
    const startMin = timeToMin(shift.startTime);
    const offsetPct = relY - (startMin - openMin) / totalMin;
    // Bug #1 — record a "pending" drag with the pointerId so handlePointerMove
    // can promote it to an active capture only AFTER the user actually moves
    // >5px. Pure clicks (no movement) skip pointer capture entirely so the
    // synthetic click event reaches the button's onClick → selection works.
    dragRef.current = { idx, type: 'move', offsetPct, initialY: e.clientY, pointerId: e.pointerId, captured: false };
  }, [openMin, totalMin, suggestData, onShiftEdit]);

  const handleBlockClick = useCallback((shift: ProposedShift, idx: number) => {
    if (blockClickSuppressRef.current) {
      blockClickSuppressRef.current = false;
      return;
    }
    onSelectShift(shift, idx);
  }, [onSelectShift]);

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const relY = Math.max(0, Math.min(e.clientY - rect.top, rect.height));
    const rawMin = openMin + (relY / rect.height) * totalMin;
    const snapped = Math.round(rawMin / 15) * 15;

    // ── actual-shift drag ──
    // Code-review hardening: only honor moves from the SAME pointer that
    // started this drag. A second touch (multi-touch) or stray mouse move
    // must not alter or hijack an in-progress drag.
    if (actualDragRef.current) {
      const ad = actualDragRef.current;
      if (ad.pointerId !== undefined && ad.pointerId !== e.pointerId) return;
      const { idx, type } = ad;
      const curStartMin = timeToMin(ad.previewStart);
      const curEndMin   = timeToMin(ad.previewEnd);
      if (type === 'bottom') {
        if (snapped > curStartMin + 15 && snapped <= closeMin) {
          const newEnd = minsToStr(snapped);
          ad.previewEnd = newEnd;
          setActualDragPreview({ idx, startTime: ad.previewStart, endTime: newEnd });
        }
      } else if (type === 'top') {
        if (snapped < curEndMin - 15 && snapped >= openMin) {
          const newStart = minsToStr(snapped);
          ad.previewStart = newStart;
          setActualDragPreview({ idx, startTime: newStart, endTime: ad.previewEnd });
        }
      } else if (type === 'move') {
        const initialY = ad.initialY ?? e.clientY;
        if (Math.abs(e.clientY - initialY) > 5) {
          // Bug #1 — promote pending drag to captured drag on first qualifying
          // movement. Without this, pure clicks on actual cards wouldn't fire
          // the button's onClick because the synthetic click is rerouted.
          if (!ad.captured && ad.pointerId !== undefined && containerRef.current) {
            try { containerRef.current.setPointerCapture(ad.pointerId); } catch {}
            ad.captured = true;
          }
          actualClickSuppressRef.current = true;
          const offsetPct = ad.offsetPct ?? 0;
          const rawStart = openMin + ((relY / rect.height) - offsetPct) * totalMin;
          const snappedStart = Math.round(rawStart / 15) * 15;
          const dur = curEndMin - curStartMin;
          const clampedStart = Math.max(openMin, Math.min(closeMin - dur, snappedStart));
          const newStart = minsToStr(clampedStart);
          const newEnd   = minsToStr(clampedStart + dur);
          ad.previewStart = newStart;
          ad.previewEnd   = newEnd;
          setActualDragPreview({ idx, startTime: newStart, endTime: newEnd });
        }
      }
      return;
    }

    // ── AI-suggestion drag ──
    if (!dragRef.current || !onShiftEdit) return;
    const dr0 = dragRef.current;
    if (dr0.pointerId !== undefined && dr0.pointerId !== e.pointerId) return;
    const { idx, type } = dr0;
    const shifts = suggestData?.proposedShifts ?? [];
    const shift = shifts[idx];
    if (!shift) return;

    if (type === 'bottom') {
      const startMin = timeToMin(shift.startTime);
      if (snapped > startMin + 15 && snapped <= closeMin) {
        onShiftEdit(idx, { endTime: minsToStr(snapped) });
      }
    } else if (type === 'top') {
      const endMin = timeToMin(shift.endTime);
      if (snapped < endMin - 15 && snapped >= openMin) {
        onShiftEdit(idx, { startTime: minsToStr(snapped) });
      }
    } else if (type === 'move') {
      const initialY = dragRef.current.initialY ?? e.clientY;
      if (Math.abs(e.clientY - initialY) > 5) {
        // Bug #1 — promote pending drag to captured drag once the user
        // actually moves. Pure click → no capture, click reaches button.
        const dr = dragRef.current;
        if (!dr.captured && dr.pointerId !== undefined && containerRef.current) {
          try { containerRef.current.setPointerCapture(dr.pointerId); } catch {}
          dr.captured = true;
          onDragStart?.(idx);
        }
        blockClickSuppressRef.current = true;
        const offsetPct = dragRef.current.offsetPct ?? 0;
        const rawStartMin = openMin + ((relY / rect.height) - offsetPct) * totalMin;
        const snappedStart = Math.round(rawStartMin / 15) * 15;
        const duration = timeToMin(shift.endTime) - timeToMin(shift.startTime);
        const clampedStart = Math.max(openMin, Math.min(closeMin - duration, snappedStart));
        const newStart = minsToStr(clampedStart);
        const newEnd = minsToStr(clampedStart + duration);
        if (newStart !== shift.startTime || newEnd !== shift.endTime) {
          onShiftEdit(idx, { startTime: newStart, endTime: newEnd });
        }
      }
    }
  }, [openMin, totalMin, closeMin, suggestData, onShiftEdit, onDragStart]);

  // Code-review hardening: optional `e` so callers (onPointerLeave/Cancel)
  // can pass through the event for pointerId-gating. When `e` is absent we
  // treat it as an unconditional teardown (legacy callers + safety net).
  // `cancelled` skips committing the preview — used by onPointerCancel where
  // the gesture was aborted (e.g. OS gesture, lost capture) and should not
  // be persisted as a user-intended change.
  const handlePointerUp = useCallback((e?: React.PointerEvent, cancelled = false) => {
    // ── actual-shift drag end ──
    if (actualDragRef.current) {
      const ad = actualDragRef.current;
      if (e && ad.pointerId !== undefined && ad.pointerId !== e.pointerId) return;
      const wasMove = ad.type === 'move';
      const schedule = ad.schedule;
      const preview = actualDragPreview;
      actualDragRef.current = null;
      if (preview && !cancelled) {
        setActualDragPreview(null);
        onActualShiftChange?.(schedule, preview.startTime, preview.endTime);
      } else {
        setActualDragPreview(null);
      }
      if (wasMove) {
        requestAnimationFrame(() => requestAnimationFrame(() => {
          actualClickSuppressRef.current = false;
        }));
      }
      return;
    }
    // ── AI-suggestion drag end ──
    if (dragRef.current && e && dragRef.current.pointerId !== undefined &&
        dragRef.current.pointerId !== e.pointerId) return;
    const wasDragging = dragRef.current !== null;
    const wasMove = dragRef.current?.type === 'move';
    dragRef.current = null;
    if (wasDragging) onDragEnd?.();
    if (wasMove) {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          blockClickSuppressRef.current = false;
        });
      });
    }
  }, [actualDragPreview, onActualShiftChange, onDragEnd]);

  const hourLabels: number[] = [];
  for (let h = Math.ceil(openMin / 60); h <= Math.floor(closeMin / 60); h++) {
    hourLabels.push(h);
  }

  if (isLoading && !actualShifts?.length) {
    return (
      <div className="space-y-2">
        <Skeleton className="h-4 w-40 rounded" />
        <Skeleton className="h-48 w-full rounded-lg" />
      </div>
    );
  }

  const shifts = suggestData?.proposedShifts ?? [];
  const activeCount = shifts.filter((_, i) => !excludedIdxs.has(i)).length;
  const hasActual = (actualShifts?.length ?? 0) > 0;
  const hasAi = shifts.length > 0;

  return (
    <div>
      <div className="text-[11px] font-medium text-muted-foreground mb-2 flex items-center gap-1.5 flex-wrap">
        {hasActual && (
          <>
            <Clock className="h-3 w-3 text-orange-500" />
            <span>Scheduled <span className="text-foreground font-semibold">({actualShifts!.length})</span></span>
          </>
        )}
        {hasActual && hasAi && <span className="text-border/60 select-none">·</span>}
        {hasAi && (
          <>
            <Sparkles className="h-3 w-3" />
            <span>{suggestData?.dataSource === 'manual' ? 'Added' : 'AI Suggested'} <span className="text-foreground font-semibold">({activeCount}{excludedIdxs.size > 0 ? ` of ${shifts.length}` : ""})</span></span>
          </>
        )}
        {!hasActual && !hasAi && (
          <>
            <Sparkles className="h-3 w-3" />
            <span>AI-Recommended Shifts</span>
          </>
        )}
      </div>
      {shifts.length === 0 && !hasActual ? (
        <div className={`rounded-lg border border-dashed p-3 text-center ${isError ? "border-red-300 bg-red-50 dark:border-red-800 dark:bg-red-900/20" : "border-border bg-muted/30"}`}>
          {isError ? (
            <>
              <AlertTriangle className="h-5 w-5 text-red-500 mx-auto mb-1" />
              <p className="text-xs text-red-600 dark:text-red-400 font-medium">Failed to load suggestions</p>
              {errorMsg && <p className="text-[10px] text-red-500 dark:text-red-500 mt-0.5 max-w-[180px] mx-auto">{errorMsg}</p>}
            </>
          ) : (
            <p className="text-xs text-muted-foreground">
              {suggestData ? "No shifts suggested. Add employees or adjust availability." : "Loading suggestions…"}
            </p>
          )}
        </div>
      ) : (
        <div className="flex gap-2">
          {/* Hour labels axis */}
          <div
            className="relative flex-shrink-0 w-8"
            style={{ height: Math.max(160, Math.min(300, totalMin * 0.6)) }}
          >
            {hourLabels.map((h) => {
              const topPct = ((h * 60 - openMin) / totalMin) * 100;
              if (topPct < 0 || topPct > 100) return null;
              return (
                <div
                  key={h}
                  style={{ top: `${topPct}%` }}
                  className="absolute right-0 text-[9px] text-muted-foreground -translate-y-1/2 leading-none"
                >
                  {fmt12(`${String(h).padStart(2, "0")}:00`)}
                </div>
              );
            })}
          </div>
          {/* Timeline body: one column per shift */}
          <div
            ref={containerRef}
            data-timeline-body="true"
            data-testid="day-timeline-body"
            // Bug #3 — `overflow-x-auto` so when many shift columns push the
            // total width past the visible area, the user can scroll
            // horizontally to reach off-screen cards instead of having them
            // clipped. Vertical overflow stays hidden because shift positions
            // are computed against the buffered grid range (Bug #4).
            className="relative flex flex-1 border border-border/50 rounded-lg bg-muted/20 overflow-x-auto overflow-y-hidden touch-pan-x"
            style={{ height: Math.max(160, Math.min(300, totalMin * 0.6)) }}
            onPointerMove={(e) => {
              handlePointerMove(e);
              // Task #392 C5 — track empty-space hover for AI ghost. Only
              // record positions over the bare timeline background, not over
              // a shift card (which sets z-10 / z-20 above the body).
              if (!actualDragRef.current && !dragRef.current && !pillDrag) {
                const rect = containerRef.current?.getBoundingClientRect();
                if (!rect) return;
                const target = e.target as HTMLElement;
                const overCard = !!target.closest('[data-shift-card], [data-testid^="actual-shift-card"]');
                if (overCard) {
                  setHoverY(null);
                } else {
                  setHoverY(Math.max(0, Math.min(e.clientY - rect.top, rect.height)));
                }
              }
            }}
            onPointerUp={(e) => handlePointerUp(e)}
            onPointerLeave={(e) => { handlePointerUp(e); setHoverY(null); }}
            // Code-review hardening: pointercancel fires when the OS or the
            // browser yanks the gesture (back-swipe, scroll-takeover, lost
            // capture). Without this, dragRef/actualDragRef stay populated
            // and subsequent moves keep editing a "ghost" drag.
            onPointerCancel={(e) => { handlePointerUp(e, true); setHoverY(null); }}
          >
            {/* Hour grid lines — span all columns */}
            <div className="absolute inset-0 pointer-events-none z-0">
              {hourLabels.map((h) => {
                const topPct = ((h * 60 - openMin) / totalMin) * 100;
                if (topPct <= 0 || topPct >= 100) return null;
                return (
                  <div
                    key={h}
                    style={{ top: `${topPct}%` }}
                    className="absolute left-0 right-0 border-t border-border/30"
                  />
                );
              })}
              {/* Bug #4 — visually mark the actual store open/close hours so
                  the buffer zones (used for opening/closing duty shifts) read
                  as "outside business hours" rather than just empty grid. */}
              {(() => {
                const openTopPct = ((storeOpenMin - openMin) / totalMin) * 100;
                const closeTopPct = ((storeCloseMin - openMin) / totalMin) * 100;
                return (
                  <>
                    {openTopPct > 0 && openTopPct < 100 && (
                      <>
                        <div
                          className="absolute left-0 right-0 bg-muted/40"
                          style={{ top: 0, height: `${openTopPct}%` }}
                          title="Before store open"
                        />
                        <div
                          className="absolute left-0 right-0 border-t-2 border-dashed border-emerald-500/60"
                          style={{ top: `${openTopPct}%` }}
                        />
                      </>
                    )}
                    {closeTopPct > 0 && closeTopPct < 100 && (
                      <>
                        <div
                          className="absolute left-0 right-0 bg-muted/40"
                          style={{ top: `${closeTopPct}%`, bottom: 0 }}
                          title="After store close"
                        />
                        <div
                          className="absolute left-0 right-0 border-t-2 border-dashed border-rose-500/60"
                          style={{ top: `${closeTopPct}%` }}
                        />
                      </>
                    )}
                  </>
                );
              })()}
            </div>

            {/* ── Task #392 C2 — green availability band overlay during pill drag ── */}
            {pillDrag && (() => {
              const m = pillDrag.member;
              const wins = (m.windows && m.windows.length > 0)
                ? m.windows
                : (m.availableFrom && m.availableTo
                    ? [{ start: m.availableFrom, end: m.availableTo }]
                    : []);
              if (wins.length === 0) return null;
              return (
                <div className="absolute inset-0 pointer-events-none z-[5]" data-testid="pill-drag-band">
                  {wins.map((w, i) => {
                    const ws = Math.max(timeToMin(w.start), openMin);
                    const we = Math.min(timeToMin(w.end), closeMin);
                    if (we <= ws) return null;
                    const top = ((ws - openMin) / totalMin) * 100;
                    const h = ((we - ws) / totalMin) * 100;
                    return (
                      <div
                        key={`band-${i}`}
                        style={{ top: `${top}%`, height: `${h}%` }}
                        className="absolute left-0 right-0 bg-emerald-400/20 border-y-2 border-emerald-500/50"
                      />
                    );
                  })}
                </div>
              );
            })()}

            {/* ── Task #392 C1 — dashed ghost preview at the snapped drop ── */}
            {pillDrag && containerRef.current && (() => {
              const rect = containerRef.current.getBoundingClientRect();
              // Allow some slack so the preview doesn't disappear right at
              // the edge of the body when the cursor briefly leaves it.
              if (pillDrag.clientY < rect.top - 30 || pillDrag.clientY > rect.bottom + 30) return null;
              const relY = Math.max(0, Math.min(pillDrag.clientY - rect.top, rect.height));
              const rawStart = openMin + (relY / rect.height) * totalMin;
              const snappedStart = Math.round(rawStart / 15) * 15;
              const m = pillDrag.member;
              const wins = (m.windows && m.windows.length > 0)
                ? m.windows
                : (m.availableFrom && m.availableTo
                    ? [{ start: m.availableFrom, end: m.availableTo }]
                    : []);
              const dur = 240; // default 4-hour drop length
              const baseStart = Math.max(openMin, Math.min(closeMin - 60, snappedStart));
              const baseEnd = Math.min(closeMin, baseStart + dur);
              const snap = snapToWindow(minsToStr(baseStart), minsToStr(baseEnd), wins, 15);
              const sM = Math.max(openMin, Math.min(closeMin, timeToMin(snap.start)));
              const eM = Math.max(sM + 15, Math.min(closeMin, timeToMin(snap.end)));
              const top = ((sM - openMin) / totalMin) * 100;
              const h = ((eM - sM) / totalMin) * 100;
              return (
                <div
                  data-testid="pill-drag-ghost"
                  style={{ top: `${top}%`, height: `${h}%` }}
                  className="absolute inset-x-1 rounded-md border-2 border-dashed border-primary bg-primary/15 pointer-events-none z-[40] flex flex-col px-1.5 py-1 shadow-lg"
                >
                  <div className="text-[10px] font-bold text-primary truncate leading-tight">{m.name}</div>
                  <div className="text-[9px] text-primary/80 leading-tight">{fmt12(snap.start)}–{fmt12(snap.end)}</div>
                  {snap.snapped && (
                    <div className="text-[8px] text-emerald-700 dark:text-emerald-400 leading-tight mt-auto">snapped to availability</div>
                  )}
                </div>
              );
            })()}

            {/* ── Task #392 C5 — faint AI ghost on hover empty space ── */}
            {!pillDrag && hoverY !== null && containerRef.current && aiGhostCandidates && aiGhostCandidates.length > 0 && onApplyAiGhost && (() => {
              const rect = containerRef.current.getBoundingClientRect();
              const hoverMin = openMin + (hoverY / rect.height) * totalMin;
              const cand = pickAiGhostForMinute(hoverMin, aiGhostCandidates, excludedIdxs, scheduledEmployeeIds ?? new Set<string>());
              if (!cand) return null;
              const sM = Math.max(openMin, Math.min(closeMin, timeToMin(cand.startTime)));
              const eM = Math.max(sM + 15, Math.min(closeMin, timeToMin(cand.endTime)));
              const top = ((sM - openMin) / totalMin) * 100;
              const h = ((eM - sM) / totalMin) * 100;
              return (
                <div
                  data-testid="ai-ghost-preview"
                  style={{ top: `${top}%`, height: `${h}%` }}
                  className="absolute inset-x-1 rounded-md border border-dashed border-violet-500/60 bg-violet-500/10 hover:bg-violet-500/20 z-[15] flex flex-col px-1.5 py-1 cursor-pointer transition-colors"
                  title={`AI suggests ${cand.employeeName} ${fmt12(cand.startTime)}–${fmt12(cand.endTime)} — click to add`}
                  onClick={(e) => { e.stopPropagation(); onApplyAiGhost(cand); }}
                >
                  <div className="text-[10px] font-medium text-violet-700 dark:text-violet-300 truncate leading-tight">✨ {cand.employeeName}</div>
                  <div className="text-[9px] text-violet-600 dark:text-violet-400 leading-tight">{fmt12(cand.startTime)}–{fmt12(cand.endTime)}</div>
                  <div className="text-[8px] text-violet-500 leading-tight mt-auto">click to add</div>
                </div>
              );
            })()}
            {/* Actual scheduled shift columns — shown first */}
            {actualShifts?.map((actual, idx) => {
              const preview = actualDragPreview?.idx === idx ? actualDragPreview : null;
              const dispStart = preview?.startTime ?? actual.startTime;
              const dispEnd   = preview?.endTime   ?? actual.endTime;
              const startMin  = timeToMin(dispStart);
              const endMin    = timeToMin(dispEnd);
              const topPct = ((Math.max(startMin, openMin) - openMin) / totalMin) * 100;
              const hPct   = ((Math.min(endMin, closeMin) - Math.max(startMin, openMin)) / totalMin) * 100;
              if (hPct <= 0) return null;
              const isActive    = selectedActualId === actual.schedule.id;
              const isMultiSelected = !!multiSelectedActualIds?.has(actual.schedule.id);
              const isDragging  = !!preview;
              const colorCls    = getShiftColor(actual.schedule.userId || actual.name);
              return (
                <div key={`actual-${idx}`} className="relative flex-1 min-w-[64px] border-l border-border/20 first:border-l-0 z-10">
                  <div
                    data-testid={`actual-shift-card-${actual.schedule.id}`}
                    aria-selected={isMultiSelected || isActive}
                    style={{ top: `${topPct}%`, height: `${Math.max(hPct, 3)}%` }}
                    className={cn(
                      "absolute inset-x-0.5 rounded-md text-left text-white overflow-hidden select-none group/actual",
                      colorCls,
                      // Single-focus orange ring (existing behavior)
                      isActive   ? "ring-[3px] ring-orange-400 ring-offset-2 scale-[1.02] shadow-lg opacity-100 z-20"
                               : "opacity-90 hover:opacity-100",
                      // Multi-select cyan ring (Task #391 B6) — distinct from
                      // the orange single-focus ring so users can tell which is
                      // which when multiple are highlighted at once.
                      isMultiSelected && !isActive
                        ? "ring-[3px] ring-cyan-400 ring-offset-2 shadow-lg opacity-100 z-20"
                        : null,
                      isDragging ? "opacity-100 z-30 shadow-xl cursor-grabbing"
                               : "cursor-pointer",
                    )}
                    title={`${actual.name}: ${fmt12(dispStart)}–${fmt12(dispEnd)}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      if (actualClickSuppressRef.current) {
                        actualClickSuppressRef.current = false;
                        return;
                      }
                      // Pass the click event so the parent can detect Shift /
                      // Cmd / Ctrl modifiers and route to multi-select. Plain
                      // clicks still focus the shift in the right-hand form.
                      onSelectActualShift?.(actual.schedule, e);
                    }}
                    onPointerDown={(e) => {
                      if (!containerRef.current) return;
                      const target = e.target as HTMLElement;
                      if (target.dataset.dragHandle) return; // handled by the handle divs
                      if (!onActualShiftChange) {
                        // no drag support: just select
                        return;
                      }
                      const rect = containerRef.current.getBoundingClientRect();
                      const relY = (e.clientY - rect.top) / rect.height;
                      const offsetPct = relY - (timeToMin(dispStart) - openMin) / totalMin;
                      // Bug #1 — defer setPointerCapture until handlePointerMove
                      // detects >5px movement. Otherwise the synthetic click
                      // gets re-routed and the card's onClick (selection)
                      // never fires for any card except the first.
                      actualDragRef.current = { idx, schedule: actual.schedule, type: 'move', offsetPct, initialY: e.clientY, previewStart: dispStart, previewEnd: dispEnd, pointerId: e.pointerId, captured: false };
                    }}
                  >
                    {/* Top resize handle */}
                    <div
                      data-drag-handle="top"
                      className="absolute top-0 left-0 right-0 h-2.5 cursor-ns-resize z-10 flex items-center justify-center"
                      onPointerDown={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        if (!containerRef.current) return;
                        containerRef.current.setPointerCapture(e.pointerId);
                        actualDragRef.current = { idx, schedule: actual.schedule, type: 'top', previewStart: dispStart, previewEnd: dispEnd };
                      }}
                    >
                      <div className="w-5 h-0.5 rounded-full bg-white/40" />
                    </div>
                    {/* Content */}
                    <div className="px-1.5 pt-3 pb-1 pointer-events-none">
                      <div className="text-[9px] font-bold truncate leading-tight">{actual.name}</div>
                      <div className="text-[8px] opacity-80 truncate">{fmt12(dispStart)}–{fmt12(dispEnd)}</div>
                      {!isDragging && (
                        <div className="text-[7px] opacity-60 mt-0.5 flex items-center gap-0.5">
                          <span className="inline-block w-1.5 h-1.5 rounded-full bg-white/70" />
                          scheduled
                        </div>
                      )}
                    </div>
                    {/* Bottom resize handle */}
                    <div
                      data-drag-handle="bottom"
                      className="absolute bottom-0 left-0 right-0 h-2.5 cursor-ns-resize z-10 flex items-center justify-center"
                      onPointerDown={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        if (!containerRef.current) return;
                        containerRef.current.setPointerCapture(e.pointerId);
                        actualDragRef.current = { idx, schedule: actual.schedule, type: 'bottom', previewStart: dispStart, previewEnd: dispEnd };
                      }}
                    >
                      <div className="w-5 h-0.5 rounded-full bg-white/40" />
                    </div>
                    {/* Hover X — delete this shift, with 200ms hover-intent
                        delay so accidental cursor flicks don't trigger a delete. */}
                    {onDeleteActualShift && !isDragging && (
                      <HoverIntentDeleteButton
                        onConfirm={() => onDeleteActualShift(actual.schedule)}
                      />
                    )}
                  </div>
                </div>
              );
            })}

            {/* Subtle divider between scheduled and AI columns */}
            {hasActual && hasAi && (
              <div className="w-px bg-border/50 flex-shrink-0 self-stretch" />
            )}

            {/* One column per AI / manual shift. */}
            {shifts.map((shift, idx) => {
              const cardKind = classifyShiftCard(idx, aiCount, shift.shiftBlock);
              const xTooltip = cardKind === 'ai'
                ? "Remove from suggestions"
                : "Remove this draft";
              return (
                <div
                  key={idx}
                  className="relative flex-1 min-w-[64px] border-l border-border/20 first:border-l-0 z-10"
                >
                  <ShiftBlock
                    shift={shift}
                    openMin={openMin}
                    closeMin={closeMin}
                    isSelected={selectedIdx === idx}
                    isExcluded={excludedIdxs.has(idx)}
                    onClick={() => handleBlockClick(shift, idx)}
                    onToggleExclude={(e) => { e.stopPropagation(); onToggleExclude(idx, shift); }}
                    hasConflict={conflictingEmployeeIds.has(shift.employeeId)}
                    onResizeStart={onShiftEdit && !excludedIdxs.has(idx) ? (e, type) => handleResizeStart(e, idx, type) : undefined}
                    onBodyPointerDown={onShiftEdit && !excludedIdxs.has(idx) ? (e) => handleBodyPointerDown(e, idx) : undefined}
                    xTooltip={xTooltip}
                  />
                </div>
              );
            })}
          </div>
        </div>
      )}
      {(shifts.length > 0 || (actualShifts?.length ?? 0) > 0) && (
        <div className="flex items-center justify-between mt-1.5">
          <p className="text-[9px] text-muted-foreground">
            Click to select · drag body to move · drag edge to resize
          </p>
          {conflictingEmployeeIds.size > 0 && (
            <span className="flex items-center gap-0.5 text-[9px] text-amber-600 dark:text-amber-400 font-medium">
              <span className="inline-block w-3 h-2 rounded-sm border-2 border-amber-500 bg-amber-100 dark:bg-amber-900/40" />
              Already scheduled
            </span>
          )}
        </div>
      )}
    </div>
  );
}

type DialogSize = 'normal' | 'wide' | 'full';
type ShiftEdit = { startTime?: string; endTime?: string; employeeId?: string; employeeName?: string };

// Tagged-union of reversible actions tracked by the panel's undo stack.
// `edit` covers per-shift time/employee edits via ShiftBlock drag/resize/form.
// `remove-ai`/`remove-manual` are pushed when the X-button removes a card so
// Cmd+Z restores it. For persisted-Manual removals we record `wasPersisted`
// so handleUndo can re-PUT the suggestion to the server cache.
type UndoEntry =
  | { kind: 'edit'; prevEdited: Record<number, ShiftEdit> }
  | { kind: 'remove-ai'; idx: number }
  | { kind: 'remove-manual'; shift: ProposedShift; insertIdx: number; wasPersisted: boolean };

// Copy-day picker (Task #391 B7). Lives as a sub-component so its react-query
// hooks are conditionally mounted only when the dialog opens — that way the
// preview fetch doesn't fire (or pollute the cache) on panels where the user
// never touches "Copy day". Server contract:
//   GET /api/schedules/copy-day-preview?sourceDate=YYYY-MM-DD&targetDates=...
//     → { sourceCount, perTarget: [{ date, existing }] }
//   POST /api/schedules/copy-day { sourceDate, targetDates[], replace? }
//     → { created: Schedule[], replacedCount }
function CopyDayDialog({
  open,
  onOpenChange,
  sourceDate,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  sourceDate: string | null;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [targetDates, setTargetDates] = useState<string[]>([]);
  const [pendingDate, setPendingDate] = useState("");
  const [replace, setReplace] = useState(false);

  // Reset whenever the dialog opens so a stale list doesn't leak between
  // invocations (e.g. user copies Mon→Tue, closes, then later wants Wed→Thu).
  useEffect(() => {
    if (open) {
      setTargetDates([]);
      setPendingDate("");
      setReplace(false);
    }
  }, [open]);

  const targetParam = targetDates.join(",");
  type Preview = { sourceCount: number; perTarget: { date: string; existing: number }[] };
  const { data: preview, isFetching: previewLoading } = useQuery<Preview>({
    queryKey: ["/api/schedules/copy-day-preview", sourceDate, targetParam],
    enabled: open && !!sourceDate && targetDates.length > 0,
    queryFn: async () => {
      const url = `/api/schedules/copy-day-preview?sourceDate=${encodeURIComponent(sourceDate!)}&targetDates=${encodeURIComponent(targetParam)}`;
      const res = await apiRequest("GET", url);
      return res.json();
    },
  });

  const copyMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/schedules/copy-day", {
        sourceDate,
        targetDates,
        replace,
      });
      return res.json() as Promise<{ created: Schedule[]; replacedCount: number }>;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/schedules"] });
      toast({
        title: `Copied to ${targetDates.length} day${targetDates.length === 1 ? "" : "s"}`,
        description: `${data.created.length} shift${data.created.length === 1 ? "" : "s"} created${data.replacedCount > 0 ? `, ${data.replacedCount} replaced` : ""}.`,
      });
      onOpenChange(false);
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to copy day.", variant: "destructive" });
    },
  });

  const addTarget = () => {
    if (!pendingDate || !sourceDate) return;
    if (pendingDate === sourceDate) {
      toast({
        title: "Pick a different day",
        description: "Source and target dates can't be the same.",
        variant: "destructive",
      });
      return;
    }
    if (targetDates.includes(pendingDate)) return;
    if (targetDates.length >= 60) return;
    setTargetDates(prev => [...prev, pendingDate].sort());
    setPendingDate("");
  };

  const totalToCreate = preview ? preview.sourceCount * targetDates.length : 0;
  const totalToReplace = replace && preview
    ? preview.perTarget.reduce((s, p) => s + p.existing, 0)
    : 0;

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="max-w-md" data-testid="copy-day-dialog">
        <AlertDialogHeader>
          <AlertDialogTitle>Copy this day to…</AlertDialogTitle>
          <AlertDialogDescription>
            Pick one or more dates to receive copies of every shift on{sourceDate ? ` ${sourceDate}` : " this day"}.
          </AlertDialogDescription>
        </AlertDialogHeader>

        <div className="space-y-3">
          <div className="flex items-end gap-2">
            <div className="flex-1">
              <Label className="text-xs">Add target date</Label>
              <Input
                type="date"
                value={pendingDate}
                onChange={(e) => setPendingDate(e.target.value)}
                min={sourceDate ?? undefined}
                data-testid="copy-day-date-input"
              />
            </div>
            <Button
              size="sm"
              onClick={addTarget}
              disabled={!pendingDate || targetDates.length >= 60}
              data-testid="copy-day-add-target-button"
            >
              Add
            </Button>
          </div>

          {targetDates.length > 0 && (
            <div className="border rounded-md max-h-40 overflow-y-auto divide-y">
              {targetDates.map(d => {
                const t = preview?.perTarget.find(p => p.date === d);
                return (
                  <div key={d} className="px-3 py-2 flex items-center gap-2 text-xs" data-testid={`copy-day-target-${d}`}>
                    <span className="flex-1 font-mono">{d}</span>
                    <span className="text-muted-foreground">
                      {previewLoading && !t ? "…" : t ? `${t.existing} existing` : "0 existing"}
                    </span>
                    <button
                      type="button"
                      onClick={() => setTargetDates(prev => prev.filter(x => x !== d))}
                      className="text-muted-foreground hover:text-destructive"
                      aria-label={`Remove ${d}`}
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                );
              })}
            </div>
          )}

          {targetDates.length > 0 && preview && (
            <div className="text-xs text-muted-foreground space-y-1" data-testid="copy-day-preview-summary">
              <div>
                Will create <span className="font-semibold text-foreground">{totalToCreate}</span> shift
                {totalToCreate === 1 ? "" : "s"} ({preview.sourceCount} × {targetDates.length} day{targetDates.length === 1 ? "" : "s"}).
              </div>
              {totalToReplace > 0 && (
                <div className="text-amber-600 dark:text-amber-400">
                  Will first delete {totalToReplace} existing shift{totalToReplace === 1 ? "" : "s"} on those dates.
                </div>
              )}
            </div>
          )}

          <label className="flex items-center gap-2 text-xs cursor-pointer pt-1">
            <Switch checked={replace} onCheckedChange={setReplace} data-testid="copy-day-replace-toggle" />
            <span>Replace existing shifts on target dates</span>
          </label>
        </div>

        <AlertDialogFooter>
          <AlertDialogCancel data-testid="copy-day-cancel">Cancel</AlertDialogCancel>
          <Button
            onClick={() => copyMutation.mutate()}
            disabled={targetDates.length === 0 || copyMutation.isPending || !sourceDate}
            data-testid="copy-day-confirm"
          >
            {copyMutation.isPending ? (
              <><Loader2 className="h-3 w-3 mr-1.5 animate-spin" />Copying…</>
            ) : (
              `Copy to ${targetDates.length || 0} day${targetDates.length === 1 ? "" : "s"}`
            )}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

// Move-to-date picker (Task #395). Lives as a sub-component so its local
// state (the chosen target date) is reset every time the dialog re-opens
// without having to plumb it through the parent. The actual mutation lives
// on the parent so it can share the toast/undo wiring with the other bulk
// actions on the floating action bar.
function MoveToDateDialog({
  open,
  onOpenChange,
  sourceDate,
  count,
  isMoving,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  sourceDate: string | null;
  count: number;
  isMoving: boolean;
  onConfirm: (targetDate: string) => void;
}) {
  const [targetDate, setTargetDate] = useState("");

  // Reset every time the dialog opens so the previous pick doesn't leak in.
  useEffect(() => {
    if (open) setTargetDate("");
  }, [open]);

  const sameAsSource = !!sourceDate && !!targetDate && targetDate === sourceDate;
  const canConfirm = !!targetDate && !!sourceDate && !sameAsSource && !isMoving;

  // Pre-format a friendly date label for the description / button without
  // pulling in date-fns just for this. Parsing as UTC midnight keeps the
  // displayed weekday consistent with the YYYY-MM-DD value the user picked.
  const targetLabel = targetDate
    ? new Date(targetDate + "T12:00:00Z").toLocaleDateString("en-US", {
        weekday: "short",
        month: "short",
        day: "numeric",
        year: "numeric",
      })
    : "";

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="max-w-md" data-testid="move-to-dialog">
        <AlertDialogHeader>
          <AlertDialogTitle>Move {count} shift{count === 1 ? "" : "s"} to…</AlertDialogTitle>
          <AlertDialogDescription>
            Each shift keeps its original start and end time — only the date changes.
          </AlertDialogDescription>
        </AlertDialogHeader>

        <div className="space-y-3">
          <div>
            <Label className="text-xs">New date</Label>
            <Input
              type="date"
              value={targetDate}
              onChange={(e) => setTargetDate(e.target.value)}
              data-testid="move-to-date-input"
              autoFocus
            />
          </div>

          {sameAsSource && (
            <div className="text-xs text-amber-600 dark:text-amber-400" data-testid="move-to-same-date-warning">
              That's the same date these shifts are already on. Pick a different day.
            </div>
          )}

          {targetDate && !sameAsSource && (
            <div className="text-xs text-muted-foreground" data-testid="move-to-summary">
              {count} shift{count === 1 ? "" : "s"} will move to <span className="font-semibold text-foreground">{targetLabel}</span>.
            </div>
          )}
        </div>

        <AlertDialogFooter>
          <AlertDialogCancel data-testid="move-to-cancel">Cancel</AlertDialogCancel>
          <Button
            onClick={() => { if (canConfirm) onConfirm(targetDate); }}
            disabled={!canConfirm}
            data-testid="move-to-confirm"
          >
            {isMoving ? (
              <><Loader2 className="h-3 w-3 mr-1.5 animate-spin" />Moving…</>
            ) : (
              `Move to ${targetLabel || "date"}`
            )}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export default function CreateShiftSplitPanel({
  open,
  onOpenChange,
  defaultDate,
  defaultUserId,
  defaultStartTime,
  defaultEndTime,
  employees,
  locations,
  filterByAvailability,
  onFilterChange,
  onDateChange,
  modalEmployees,
  onCreateShift,
  isCreating,
  autoAssignMutation,
  isAdmin = false,
  editingSchedule,
  onUpdateSchedule,
  onDeleteSchedule,
  isUpdating = false,
  isDeleting = false,
  onAddNewShift,
  schedules,
  onSelectSchedule,
  currentWeekRange,
  onJumpToWeek,
}: Props) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { user: currentUser } = useAuth();
  const { lastMessage: panelWsMessage } = useWebSocketContext();
  // Drafts are namespaced by (storeId, date, userId). storeId comes from the
  // first available work-location for this user (single-store users have one);
  // we never bleed across users because userId is in the key.
  const draftStoreId = locations[0]?.id || 'panel';
  const draftUserId = currentUser?.id ?? '';

  const [modalDate, setModalDate] = useState(defaultDate || "");
  const [modalStartTime, setModalStartTime] = useState(defaultStartTime || "09:00");
  const [modalEndTime, setModalEndTime] = useState(defaultEndTime || "17:00");
  const [selectedUserId, setSelectedUserId] = useState(defaultUserId || "");
  const [selectedShiftIdx, setSelectedShiftIdx] = useState<number | null>(null);
  const [leftCollapsed, setLeftCollapsed] = useState(false);
  const [excludedIdxs, setExcludedIdxs] = useState<Set<number>>(new Set());
  const [editedShifts, setEditedShifts] = useState<Record<number, ShiftEdit>>({});
  const [undoStack, setUndoStack] = useState<UndoEntry[]>([]);
  const [redoStack, setRedoStack] = useState<UndoEntry[]>([]);
  const [dialogSize, setDialogSize] = useState<DialogSize>('normal');
  const [dialogDims, setDialogDims] = useState<{ width: number; height: number } | null>(null);
  const [selectedActualSchedule, setSelectedActualSchedule] = useState<Schedule | null>(null);
  const [actualFormEdits, setActualFormEdits] = useState<{ startTime: string; endTime: string; userId: string } | null>(null);
  // Bug-fix: pending edits that survive selection changes. `actualFormEdits`
  // only holds the *currently-selected* shift's edits and gets overwritten
  // when the user clicks a sibling, which made their previous edits visually
  // revert ("the edited shift collapses back to its original state"). This
  // map keeps each shift's pending edits alive — keyed by schedule.id —
  // until the user either Saves (mutation success drops the entry) or
  // closes the panel (cleared in the open/close effect).
  const [pendingActualEdits, setPendingActualEdits] = useState<Record<string, { startTime: string; endTime: string; userId: string }>>({});
  const [manualShifts, setManualShifts] = useState<ProposedShift[]>([]);
  // Multi-select for persisted (actual) shifts on the day timeline (Task #391
  // B6). Plain click still focuses a single shift in the right-hand form;
  // Cmd/Ctrl-click toggles, Shift-click extends a range. Anchor tracks the
  // pivot for shift-click range expansion.
  const [selectedActualIds, setSelectedActualIds] = useState<Set<string>>(new Set());
  const [multiSelectAnchorId, setMultiSelectAnchorId] = useState<string | null>(null);
  const [showCopyDayDialog, setShowCopyDayDialog] = useState(false);
  const [showMoveDayDialog, setShowMoveDayDialog] = useState(false);
  // Task #392 C1/C2 — drag-from-pill state. `null` = no drag in progress.
  // Updated on every pointermove via document-level listener installed by
  // `startPillDrag`. DayTimeline reads this to render the green availability
  // band + dashed ghost preview at the snapped drop location.
  const [pillDrag, setPillDrag] = useState<{ member: AvailMember; clientY: number } | null>(null);
  const [shiftSaved, setShiftSaved] = useState(false);
  const shiftSavedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingSkippedCountRef = useRef(0);

  // Flash "Saved ✓" on the per-card Save button for 2s; clears on unmount/card switch.
  const flashSaved = useCallback(() => {
    if (shiftSavedTimerRef.current) clearTimeout(shiftSavedTimerRef.current);
    setShiftSaved(true);
    shiftSavedTimerRef.current = setTimeout(() => {
      setShiftSaved(false);
      shiftSavedTimerRef.current = null;
    }, 2000);
  }, []);

  // Clear the timer on unmount to avoid setState-on-unmounted warnings
  useEffect(() => () => {
    if (shiftSavedTimerRef.current) {
      clearTimeout(shiftSavedTimerRef.current);
      shiftSavedTimerRef.current = null;
    }
  }, []);

  // Reset "Saved ✓" flash on card switch.
  useEffect(() => {
    if (shiftSavedTimerRef.current) {
      clearTimeout(shiftSavedTimerRef.current);
      shiftSavedTimerRef.current = null;
    }
    setShiftSaved(false);
  }, [selectedShiftIdx, selectedActualSchedule?.id]);
  const [showPillsUnavailable, setShowPillsUnavailable] = useState(false);
  // Who's Available accordion: open by default on desktop, closed on mobile
  const [showPillsOpen, setShowPillsOpen] = useState(() =>
    typeof window !== 'undefined' ? window.innerWidth >= 768 : true
  );
  // Reset accordion to closed on mobile each time the panel opens
  useEffect(() => {
    if (open && typeof window !== 'undefined' && window.innerWidth < 768) {
      setShowPillsOpen(false);
    }
  }, [open]);
  // A1 confirm-on-close dialog state.
  const [pendingCloseConfirm, setPendingCloseConfirm] = useState(false);
  // Pre-save reassignment-conflict dialog (Task #707). Set when the user
  // tries to save an editingSchedule edit but the destination employee
  // already has another shift overlapping the new time window. Carries the
  // conflicting Schedule + employee display name so the dialog can show
  // exactly which existing shift is in the way and offer a "View conflict"
  // jump.
  const [pendingOverlapConflict, setPendingOverlapConflict] = useState<
    { conflictSchedule: Schedule; employeeName: string } | null
  >(null);
  // Local confirmation + in-flight state for the Delete button (Task #700,
  // Bug 4). Tracking pending here — instead of relying on the parent's
  // shared `isDeleting` prop — ensures the spinner only appears on the
  // shift the user actually clicked Delete on.
  const [pendingDeleteConfirm, setPendingDeleteConfirm] = useState(false);
  const [localDeletePending, setLocalDeletePending] = useState(false);
  useEffect(() => {
    // When the parent's mutation finishes (panel typically closes on
    // success), drop our local pending flag so a subsequent open starts
    // fresh.
    if (!isDeleting) setLocalDeletePending(false);
  }, [isDeleting]);
  // C6 keyboard cheat-sheet, toggled by ? and /.
  const [showShortcutOverlay, setShowShortcutOverlay] = useState(false);
  // Last batch of created IDs so bulk-undo can DELETE them within 10s.
  const lastCreatedIdsRef = useRef<string[]>([]);
  // A4 external-change banner state.
  const [externalChangeNotice, setExternalChangeNotice] = useState(false);
  // Guard so re-renders don't overwrite a freshly restored draft with blanks.
  const draftHydratedRef = useRef<string | null>(null);
  const [modalTitle, setModalTitle] = useState(editingSchedule?.title ?? '');
  const [modalLocationId, setModalLocationId] = useState(editingSchedule?.locationId ?? locations[0]?.id ?? '');
  const [modalNotes, setModalNotes] = useState(editingSchedule?.description ?? '');
  const forceRegenRef = useRef(false);
  const resizeGripRef = useRef<{ startX: number; startY: number; startW: number; startH: number } | null>(null);
  const dragActiveRef = useRef(false);
  const editedShiftsRef = useRef<Record<number, ShiftEdit>>({});
  const timelineWrapperRef = useRef<HTMLDivElement>(null);

  const dateActualShifts = useMemo(() => {
    if (!schedules || !modalDate) return [];
    return schedules
      .filter(s => {
        const d = new Date(s.startTime);
        const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        return dateStr === modalDate;
      })
      .map(s => {
        const user = employees.find(e => e.id === s.userId);
        const name = user
          ? `${user.firstName || ''} ${user.lastName || ''}`.trim() || user.email || 'Unknown'
          : 'Unknown';
        const st = new Date(s.startTime);
        const et = new Date(s.endTime);
        const startTime = `${String(st.getHours()).padStart(2, '0')}:${String(st.getMinutes()).padStart(2, '0')}`;
        const endTime = `${String(et.getHours()).padStart(2, '0')}:${String(et.getMinutes()).padStart(2, '0')}`;
        return { schedule: s, name, startTime, endTime };
      });
  }, [schedules, modalDate, employees]);
  // Live preview: overlay any in-progress form edits onto the selected actual shift card
  const liveActualShifts = useMemo(() => {
    // Overlay pending edits onto EVERY shift (not just the currently
    // selected one) so a user can edit shift A, click to focus shift B,
    // and still see A's pending changes on the timeline. The selected
    // shift gets `actualFormEdits` (the live form values) layered on
    // top of the map entry so unsaved typing is reflected immediately.
    const hasMapEdits = Object.keys(pendingActualEdits).length > 0;
    if (!hasMapEdits && (!selectedActualSchedule || !actualFormEdits)) return dateActualShifts;
    return dateActualShifts.map((actual) => {
      const isSelected = selectedActualSchedule && actual.schedule.id === selectedActualSchedule.id;
      const mapEdit = pendingActualEdits[actual.schedule.id];
      const liveEdit = isSelected && actualFormEdits ? actualFormEdits : mapEdit;
      if (!liveEdit) return actual;
      const user = employees.find((e) => e.id === liveEdit.userId);
      const name = user
        ? `${user.firstName || ''} ${user.lastName || ''}`.trim() || actual.name
        : actual.name;
      return { ...actual, name, startTime: liveEdit.startTime, endTime: liveEdit.endTime };
    });
  }, [dateActualShifts, selectedActualSchedule, actualFormEdits, pendingActualEdits, employees]);

  const suggestDataRef = useRef<SuggestData | undefined>(undefined);

  useEffect(() => {
    if (open) {
      setModalDate(defaultDate || "");
      setModalStartTime(defaultStartTime || "09:00");
      setModalEndTime(defaultEndTime || "17:00");
      setSelectedUserId(defaultUserId || "");
      setSelectedShiftIdx(null);
      setExcludedIdxs(new Set());
      setEditedShifts({});
      editedShiftsRef.current = {};
      setUndoStack([]);
      setRedoStack([]);
      setDialogDims(null);
      setModalTitle('');
      setModalLocationId(locations[0]?.id ?? '');
      setModalNotes('');
      setSelectedActualSchedule(null);
      setActualFormEdits(null);
      setPendingActualEdits({});
      setManualShifts([]);
      setShowPillsUnavailable(false);
      setSelectedActualIds(new Set());
      setMultiSelectAnchorId(null);
      setShowCopyDayDialog(false);
      setShowMoveDayDialog(false);
      setPendingOverlapConflict(null);
      forceRegenRef.current = false;
      dlog("panel/open");
    } else {
      // Clear undo/redo history immediately when dialog closes
      setUndoStack([]);
      setRedoStack([]);
      editedShiftsRef.current = {};
      dragActiveRef.current = false;
      setManualShifts([]);
      setPendingActualEdits({});
      // Acceptance: multi-select state is cleared on closing the panel.
      setSelectedActualIds(new Set());
      setMultiSelectAnchorId(null);
      setShowCopyDayDialog(false);
      setShowMoveDayDialog(false);
      dlog("panel/close");
    }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  // Single-source sync: any time the form's `actualFormEdits` changes for the
  // currently-selected actual shift, mirror it into the per-shift map keyed
  // by schedule.id. This keeps Bug-2's overlay alive across selection
  // changes (clicking a sibling shift no longer wipes the prior shift's
  // pending edits) without sprinkling map writes through every input handler.
  useEffect(() => {
    if (!selectedActualSchedule || !actualFormEdits) return;
    setPendingActualEdits(prev => {
      const id = selectedActualSchedule.id;
      const existing = prev[id];
      if (
        existing &&
        existing.startTime === actualFormEdits.startTime &&
        existing.endTime === actualFormEdits.endTime &&
        existing.userId === actualFormEdits.userId
      ) {
        return prev;
      }
      dlog("pendingActualEdits/upsert", { id, ...actualFormEdits });
      return { ...prev, [id]: actualFormEdits };
    });
  }, [actualFormEdits, selectedActualSchedule]);

  // When editing an existing saved schedule, pre-fill ALL form fields with its data
  useEffect(() => {
    if (!open || !editingSchedule) return;
    const dt = new Date(editingSchedule.startTime);
    const dtEnd = new Date(editingSchedule.endTime);
    const pad = (n: number) => String(n).padStart(2, '0');
    const dateStr = `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`;
    const startStr = `${pad(dt.getHours())}:${pad(dt.getMinutes())}`;
    const endStr = `${pad(dtEnd.getHours())}:${pad(dtEnd.getMinutes())}`;
    dlog("editingSchedule/populate", {
      id: editingSchedule.id,
      userId: editingSchedule.userId,
      rawStartISO: typeof editingSchedule.startTime === 'string' ? editingSchedule.startTime : new Date(editingSchedule.startTime).toISOString(),
      rawEndISO: typeof editingSchedule.endTime === 'string' ? editingSchedule.endTime : new Date(editingSchedule.endTime).toISOString(),
      derivedDate: dateStr,
      derivedStart: startStr,
      derivedEnd: endStr,
    });
    setModalDate(dateStr);
    setModalStartTime(startStr);
    setModalEndTime(endStr);
    setSelectedUserId(editingSchedule.userId);
    setSelectedShiftIdx(null);
    setModalTitle(editingSchedule.title ?? '');
    setModalLocationId(editingSchedule.locationId ?? locations[0]?.id ?? '');
    setModalNotes(editingSchedule.description ?? '');
    if (onDateChange) onDateChange(dateStr);
  }, [open, editingSchedule]); // eslint-disable-line react-hooks/exhaustive-deps

  // If `locations` resolves AFTER the populate effect ran (async fetch),
  // back-fill `modalLocationId` with the first available location so the
  // location dropdown isn't blank on re-open (Task #700, Bug 3).
  useEffect(() => {
    if (!open || !editingSchedule) return;
    if (modalLocationId) return;
    if (editingSchedule.locationId) {
      setModalLocationId(editingSchedule.locationId);
    } else if (locations.length > 0) {
      setModalLocationId(locations[0].id);
    }
  }, [open, editingSchedule, locations, modalLocationId]);

  // When editingSchedule is cleared while the panel is still open (e.g. "Add Shift" clicked),
  // reset the form fields so the user sees a blank create form for the same date
  useEffect(() => {
    if (!open || editingSchedule) return;
    setModalTitle('');
    setModalLocationId(locations[0]?.id ?? '');
    setModalNotes('');
    setSelectedUserId('');
    setSelectedShiftIdx(null);
  }, [editingSchedule]); // eslint-disable-line react-hooks/exhaustive-deps

  // Tracks whether the right-panel form has been edited beyond its initial
  // values. Triggers the unsaved-changes confirmation on close. Reset whenever
  // selection or date changes (a new context = a new clean form).
  const [formDirty, setFormDirty] = useState(false);
  useEffect(() => { setFormDirty(false); }, [selectedShiftIdx, selectedActualSchedule?.id, modalDate]);

  const dirty = hasUnsavedChangesHelper({
    pendingManualCount: manualShifts.length,
    excludedCount: excludedIdxs.size,
    editedCount: Object.keys(editedShifts).length,
    formDirty,
    // Multi-select alone is not "dirty" enough to warrant a confirm-on-close —
    // it's a transient view state and is cleared on close anyway.
    multiSelectActive: false,
  });

  // Single funnel for "user wants to close the panel". Branches into the
  // confirmation dialog when dirty, otherwise closes immediately. Used by
  // backdrop click, X button, Escape key, and Cancel button.
  const requestClose = useCallback(() => {
    if (dirty) {
      setPendingCloseConfirm(true);
      return;
    }
    onOpenChange(false);
  }, [dirty, onOpenChange]);

  // ── Localstorage drafts (Task #387 A8) ──────────────────────────────────────
  // 1. On first mount, sweep stale drafts (>24h old) so we don't hold onto them
  //    forever. Cheap synchronous loop; runs once per page load.
  useEffect(() => { evictStaleDrafts(); }, []);

  // 2. Rehydrate draft on open (guarded by draftHydratedRef so the save-effect doesn't clobber it).
  useEffect(() => {
    if (!open) { draftHydratedRef.current = null; return; }
    if (!modalDate || !draftUserId) return;
    if (editingSchedule) return; // Don't restore drafts when editing a saved shift.
    const key = `${draftStoreId}:${modalDate}:${draftUserId}`;
    if (draftHydratedRef.current === key) return;
    draftHydratedRef.current = key;
    const draft = loadDraft(draftStoreId, modalDate, draftUserId);
    if (!draft) return;
    // Only restore if the user actually has un-persisted work in the draft
    // (manualShifts > 0 OR a non-default field). Avoids confusing rehydrate
    // when we previously cleared the draft on save.
    const hasContent = (draft.manualShifts?.length ?? 0) > 0
      || (draft.excludedIdxs?.length ?? 0) > 0
      || (draft.editedShifts && Object.keys(draft.editedShifts).length > 0)
      || draft.modalTitle || draft.modalNotes || draft.selectedUserId;
    if (!hasContent) return;
    if (draft.modalStartTime) setModalStartTime(draft.modalStartTime);
    if (draft.modalEndTime) setModalEndTime(draft.modalEndTime);
    if (draft.selectedUserId) setSelectedUserId(draft.selectedUserId);
    if (draft.modalTitle) setModalTitle(draft.modalTitle);
    if (draft.modalLocationId) setModalLocationId(draft.modalLocationId);
    if (draft.modalNotes) setModalNotes(draft.modalNotes);
    if (Array.isArray(draft.manualShifts) && draft.manualShifts.length > 0) {
      setManualShifts(draft.manualShifts as ProposedShift[]);
    }
    if (Array.isArray(draft.excludedIdxs) && draft.excludedIdxs.length > 0) {
      setExcludedIdxs(new Set(draft.excludedIdxs));
    }
    if (draft.editedShifts && typeof draft.editedShifts === 'object') {
      const restored: Record<number, ShiftEdit> = {};
      for (const [k, v] of Object.entries(draft.editedShifts)) {
        const idx = Number(k);
        if (Number.isFinite(idx) && v && typeof v === 'object') restored[idx] = v as ShiftEdit;
      }
      setEditedShifts(restored);
      editedShiftsRef.current = restored;
    }
    toast({
      title: 'Draft restored',
      description: 'Picked up where you left off in this panel.',
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, modalDate, draftUserId, editingSchedule]);

  // 3. Debounced save: whenever the form/manual shifts change while the
  //    panel is open, persist a snapshot. Only writes when there is content
  //    worth saving so we don't pollute storage with empty drafts.
  useEffect(() => {
    if (!open || !modalDate || !draftUserId || editingSchedule) return;
    const hasContent = manualShifts.length > 0
      || !!modalTitle || !!modalNotes || !!selectedUserId
      || excludedIdxs.size > 0
      || Object.keys(editedShifts).length > 0;
    if (!hasContent) return;
    const t = setTimeout(() => {
      saveDraft(draftStoreId, modalDate, draftUserId, {
        modalDate,
        modalStartTime,
        modalEndTime,
        selectedUserId,
        modalTitle,
        modalLocationId,
        modalNotes,
        manualShifts: manualShifts as unknown[],
        excludedIdxs: Array.from(excludedIdxs),
        editedShifts,
      });
    }, 500);
    return () => clearTimeout(t);
  }, [
    open, modalDate, draftUserId, editingSchedule,
    modalStartTime, modalEndTime, selectedUserId,
    modalTitle, modalLocationId, modalNotes, manualShifts,
    excludedIdxs, editedShifts,
  ]);

  // A4: surface non-blocking notice when a WS event for the open day arrives.
  useEffect(() => {
    if (!open || !panelWsMessage || !modalDate) return;
    const t = panelWsMessage.type;
    const isBulk = t === 'schedules_bulk_created' || t === 'schedules_bulk_updated' || t === 'schedules_bulk_deleted';
    const isSingle = t === 'schedule_created' || t === 'schedule_updated' || t === 'schedule_deleted';
    if (!isBulk && !isSingle) return;
    type SchedulePayload = { startTime?: string };
    const msg = panelWsMessage as {
      data?: {
        schedules?: SchedulePayload[];
        schedule?: SchedulePayload;
        dates?: string[];
      };
    };
    const data = msg.data;
    const schedules: SchedulePayload[] = Array.isArray(data?.schedules)
      ? data!.schedules!
      : data?.schedule
        ? [data.schedule]
        : [];
    const datePayload = Array.isArray(data?.dates) ? data!.dates! : [];
    // Server now ships affected dates for delete events; everywhere else we
    // derive the date from the schedule body. If neither source matches the
    // open day, suppress the notice.
    const matchesDay = datePayload.includes(modalDate)
      || schedules.some((s) => {
        if (!s.startTime) return false;
        try { return new Date(s.startTime).toISOString().slice(0, 10) === modalDate; }
        catch { return false; }
      });
    if (!matchesDay) return;
    setExternalChangeNotice(true);
  }, [open, panelWsMessage, modalDate]);
  useEffect(() => { setExternalChangeNotice(false); }, [modalDate, open]);

  // Escape key, `?`/`/` shortcut overlay, and body scroll lock.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      const inField = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
      if (e.key === 'Escape') {
        if (showShortcutOverlay) { setShowShortcutOverlay(false); return; }
        // Acceptance: Esc clears multi-select before falling through to close.
        // This matches platform conventions (Finder, file managers, etc.) and
        // gives users a fast way to bail out of an accidental selection.
        if (selectedActualIds.size > 0) {
          setSelectedActualIds(new Set());
          setMultiSelectAnchorId(null);
          return;
        }
        requestClose();
        return;
      }
      // `?` and `/` both toggle the cheat-sheet (most users hit `?` which
      // requires Shift; `/` is the unshifted equivalent and is also useful
      // on layouts where `?` is awkward).
      if (!inField && (e.key === '?' || e.key === '/')) {
        e.preventDefault();
        setShowShortcutOverlay((v) => !v);
      }
    };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
    // selectedActualIds in deps so the Esc branch always sees the current
    // selection. Without it, the listener captured an empty set on first
    // mount and would skip the clear-multi-select branch — falling through
    // to close the panel instead of just dropping the selection.
  }, [open, requestClose, showShortcutOverlay, selectedActualIds]);

  // Reset custom dimensions when switching preset sizes
  const cycleSize = () => {
    setDialogSize((s) => s === 'normal' ? 'wide' : s === 'wide' ? 'full' : 'normal');
    setDialogDims(null);
  };

  const handleGripPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    // Get dialog dimensions from the grip's parent
    const dialog = (e.target as HTMLElement).closest('[data-dialog-resizable]') as HTMLElement | null;
    if (!dialog) return;
    resizeGripRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      startW: dialog.offsetWidth,
      startH: dialog.offsetHeight,
    };
  }, []);

  const handleGripPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!resizeGripRef.current) return;
    const { startX, startY, startW, startH } = resizeGripRef.current;
    // Dialog is centered — dragging right by dx means right edge moves dx, so width grows 2dx
    const newW = Math.max(560, Math.min(window.innerWidth * 0.96, startW + (e.clientX - startX) * 2));
    const newH = Math.max(300, Math.min(window.innerHeight * 0.92, startH + (e.clientY - startY) * 2));
    setDialogDims({ width: Math.round(newW), height: Math.round(newH) });
  }, []);

  const handleGripPointerUp = useCallback(() => {
    resizeGripRef.current = null;
  }, []);

  const handleShiftEdit = useCallback((idx: number, updates: ShiftEdit) => {
    const aiCount = suggestDataRef.current?.proposedShifts?.length ?? 0;
    dlog("handleShiftEdit", { idx, aiCount, isManual: idx >= aiCount, updates });
    if (idx >= aiCount) {
      // Manual shift — update manualShifts array directly
      const manualIdx = idx - aiCount;
      setManualShifts((prev) => prev.map((s, i) => i === manualIdx ? { ...s, ...updates } : s));
      if (selectedShiftIdx === idx) {
        if (updates.startTime) setModalStartTime(updates.startTime);
        if (updates.endTime) setModalEndTime(updates.endTime);
      }
      return;
    }
    // AI shift — only push to undo stack when NOT in a drag
    if (!dragActiveRef.current) {
      const snapshot = editedShiftsRef.current;
      setUndoStack((prev) => {
        const next: UndoEntry[] = [...prev, { kind: 'edit', prevEdited: snapshot }];
        return next.length > 20 ? next.slice(next.length - 20) : next;
      });
      setRedoStack([]);
    }
    setEditedShifts((prev) => {
      const next = { ...prev, [idx]: { ...prev[idx], ...updates } };
      editedShiftsRef.current = next;
      return next;
    });
    if (selectedShiftIdx === idx) {
      if (updates.startTime) setModalStartTime(updates.startTime);
      if (updates.endTime) setModalEndTime(updates.endTime);
      if (updates.employeeId) setSelectedUserId(updates.employeeId);
    }
  }, [selectedShiftIdx]);

  const handleDragStart = useCallback((_idx: number) => {
    if (dragActiveRef.current) return; // already tracking a drag
    dragActiveRef.current = true;
    const snapshot = editedShiftsRef.current;
    setUndoStack((prev) => {
      const next: UndoEntry[] = [...prev, { kind: 'edit', prevEdited: snapshot }];
      return next.length > 20 ? next.slice(next.length - 20) : next;
    });
    setRedoStack([]);
  }, []);

  const handleDragEnd = useCallback(() => {
    dragActiveRef.current = false;
  }, []);

  // Task #392 C3 — one-hop collision-avoidance closure stored in a ref so
  // `handleActualShiftChange` (declared above the late-bound `storeHours` and
  // `updateActualMutation`) can compute nudges without a forward reference.
  // The effect below keeps the closure in sync whenever its inputs change.
  //
  // Nudges are NOT persisted on resize. They are queued in
  // `pendingNudgesRef` and only dispatched when the user clicks Save Changes
  // for the dragged shift, so cancelling the edit also cancels the nudges.
  const nudgeOnResizeRef = useRef<(schedule: Schedule, startTime: string, endTime: string, dateStr: string) => void>(() => {});
  const pendingNudgesRef = useRef<Array<{
    id: string;
    userId: string;
    startTime: Date;
    endTime: Date;
    title: string | null;
    locationId: string | null;
    description: string | null;
  }>>([]);
  // Drop the queued nudges if the user deselects/cancels the actual edit
  // before saving — they were only ever a "what would happen" preview.
  useEffect(() => {
    if (!selectedActualSchedule) {
      pendingNudgesRef.current = [];
    }
  }, [selectedActualSchedule]);

  // When user drags an actual shift block, select it and update the form times.
  // Also fires the one-hop nudge for sibling shifts owned by the same employee.
  const handleActualShiftChange = useCallback((schedule: Schedule, startTime: string, endTime: string) => {
    dlog("handleActualShiftChange/drag", { id: schedule.id, startTime, endTime });
    const st = new Date(schedule.startTime);
    const pad = (n: number) => String(n).padStart(2, '0');
    const dateStr = `${st.getFullYear()}-${pad(st.getMonth() + 1)}-${pad(st.getDate())}`;
    setSelectedActualSchedule(schedule);
    setActualFormEdits({ startTime, endTime, userId: schedule.userId });
    setModalDate(dateStr);
    setModalStartTime(startTime);
    setModalEndTime(endTime);
    setSelectedUserId(schedule.userId);
    setModalTitle(schedule.title ?? '');
    setModalLocationId(schedule.locationId ?? locations[0]?.id ?? '');
    setModalNotes(schedule.description ?? '');
    setSelectedShiftIdx(null);
    nudgeOnResizeRef.current(schedule, startTime, endTime, dateStr);
  }, [locations]);

  const applyEditSnapshot = useCallback((snapshot: Record<number, ShiftEdit>, currentSelectedIdx: number | null) => {
    editedShiftsRef.current = snapshot;
    setEditedShifts(snapshot);
    if (currentSelectedIdx !== null) {
      const restoredEdit = snapshot[currentSelectedIdx];
      const originalShift = suggestDataRef.current?.proposedShifts[currentSelectedIdx];
      setModalStartTime(restoredEdit?.startTime ?? originalShift?.startTime ?? "09:00");
      setModalEndTime(restoredEdit?.endTime ?? originalShift?.endTime ?? "17:00");
      if (restoredEdit?.employeeId) setSelectedUserId(restoredEdit.employeeId);
      else if (originalShift?.employeeId) setSelectedUserId(originalShift.employeeId);
    }
  }, []);

  // Apply an UndoEntry in either direction. 'undo' reverses the original
  // action; 'redo' re-applies it. Returns the inverse entry that should be
  // pushed onto the opposite stack so undo/redo are round-trippable.
  const applyUndoEntry = useCallback((
    entry: UndoEntry,
    direction: 'undo' | 'redo',
    currentSelectedIdx: number | null,
  ): UndoEntry => {
    if (entry.kind === 'edit') {
      // Edit snapshots carry the previous editedShifts map, so undo/redo
      // swap snapshots either way.
      const inverse: UndoEntry = { kind: 'edit', prevEdited: editedShiftsRef.current };
      applyEditSnapshot(entry.prevEdited, currentSelectedIdx);
      return inverse;
    }
    if (entry.kind === 'remove-ai') {
      setExcludedIdxs((prev) => {
        const next = new Set(prev);
        if (direction === 'undo') next.delete(entry.idx);
        else next.add(entry.idx);
        return next;
      });
      return { kind: 'remove-ai', idx: entry.idx };
    }
    // remove-manual: undo splices the shift back at its original manual
    // index; redo removes that same object by reference. Object identity is
    // preserved through the round trip, so duplicate cards stay independent.
    if (direction === 'undo') {
      setManualShifts((prev) => {
        const insertAt = Math.max(0, Math.min(entry.insertIdx, prev.length));
        const next = [...prev];
        next.splice(insertAt, 0, entry.shift);
        return next;
      });
      if (entry.wasPersisted && modalDate && entry.shift.employeeId) {
        persistPillShiftMutation.mutate({ shift: entry.shift, date: modalDate });
      }
    } else {
      setManualShifts((prev) => {
        const targetIdx = prev.indexOf(entry.shift);
        if (targetIdx < 0) return prev;
        const next = [...prev];
        next.splice(targetIdx, 1);
        return next;
      });
      if (entry.wasPersisted && modalDate && entry.shift.employeeId && entry.shift.startTime && entry.shift.endTime) {
        removeSuggestShiftMutation.mutate({
          date: modalDate,
          employeeId: entry.shift.employeeId,
          startTime: entry.shift.startTime,
          endTime: entry.shift.endTime,
        });
      }
    }
    return { kind: 'remove-manual', shift: entry.shift, insertIdx: entry.insertIdx, wasPersisted: entry.wasPersisted };
  }, [applyEditSnapshot, modalDate]);

  const handleUndo = useCallback(() => {
    setUndoStack((prev) => {
      if (prev.length === 0) return prev;
      const next = [...prev];
      const entry = next.pop()!;
      const inverse = applyUndoEntry(entry, 'undo', selectedShiftIdx);
      setRedoStack((r) => {
        const rNext: UndoEntry[] = [...r, inverse];
        return rNext.length > 20 ? rNext.slice(rNext.length - 20) : rNext;
      });
      return next;
    });
  }, [selectedShiftIdx, applyUndoEntry]);

  const handleRedo = useCallback(() => {
    setRedoStack((prev) => {
      if (prev.length === 0) return prev;
      const next = [...prev];
      const entry = next.pop()!;
      const inverse = applyUndoEntry(entry, 'redo', selectedShiftIdx);
      setUndoStack((u) => {
        const uNext: UndoEntry[] = [...u, inverse];
        return uNext.length > 20 ? uNext.slice(uNext.length - 20) : uNext;
      });
      return next;
    });
  }, [selectedShiftIdx, applyUndoEntry]);

  // Ctrl+Z / Ctrl+Y / Ctrl+Shift+Z keyboard shortcuts for undo/redo
  // Declared after handleUndo/handleRedo to avoid temporal dead zone
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      // Skip when focus is inside a text field to preserve native text undo
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      const k = e.key.toLowerCase();
      if (k === 'z' && !e.shiftKey) { e.preventDefault(); handleUndo(); }
      else if (k === 'y' || (k === 'z' && e.shiftKey)) { e.preventDefault(); handleRedo(); }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, handleUndo, handleRedo]);

  // Removes a single shift from the cached AI suggestion on the server.
  // Used by handleToggleExclude when the user X's a Manual draft that has
  // already been persisted into suggestData.proposedShifts — without this
  // call the next refetch would resurrect the draft.
  const removeSuggestShiftMutation = useMutation({
    mutationFn: async (params: { date: string; employeeId: string; startTime: string; endTime: string }) => {
      const url = `/api/schedules/suggest/shift?date=${encodeURIComponent(params.date)}`
        + `&employeeId=${encodeURIComponent(params.employeeId)}`
        + `&startTime=${encodeURIComponent(params.startTime)}`
        + `&endTime=${encodeURIComponent(params.endTime)}`;
      return apiRequest("DELETE", url);
    },
    onSuccess: (_data, variables) => {
      dlog("removeSuggestShift/success", variables);
      queryClient.invalidateQueries({ queryKey: ["/api/schedules/suggest", variables.date] });
    },
    onError: (err, variables) => {
      dlog("removeSuggestShift/error", { error: String(err), variables });
      toast({ title: "Error", description: "Couldn't remove that draft from the suggestion.", variant: "destructive" });
    },
  });

  // Single entry-point for clicking the X on any timeline card. Branches by
  // card kind (AI / persisted-manual / pending-manual) — see classifyShiftCard
  // for the rules. Manual cards are spliced from local state by index;
  // persisted-manuals additionally drop their cache entry server-side.
  const handleToggleExclude = (idx: number, shift: ProposedShift) => {
    const aiCount = suggestDataRef.current?.proposedShifts?.length ?? 0;
    const cardKind = classifyShiftCard(idx, aiCount, shift.shiftBlock);
    dlog("handleToggleExclude", { idx, aiCount, cardKind, employeeId: shift.employeeId, startTime: shift.startTime, endTime: shift.endTime });
    const isPersistedManual = cardKind === 'persisted-manual';
    const isManualDraft = cardKind !== 'ai';

    if (isManualDraft) {
      // Pending drafts live at idx >= aiCount; persisted-manuals are removed via mutation.
      const manualIdx = idx - aiCount;
      if (manualIdx >= 0) {
        setManualShifts((prev) => {
          if (manualIdx >= prev.length) return prev;
          const next = [...prev];
          next.splice(manualIdx, 1);
          return next;
        });
      }
      if (isPersistedManual && modalDate && shift.employeeId && shift.startTime && shift.endTime) {
        removeSuggestShiftMutation.mutate({
          date: modalDate,
          employeeId: shift.employeeId,
          startTime: shift.startTime,
          endTime: shift.endTime,
        });
      }
      setUndoStack((prev) => {
        const next: UndoEntry[] = [...prev, {
          kind: 'remove-manual',
          shift,
          // Manual-array index for undo splice (persisted-manuals stay at 0).
          insertIdx: Math.max(0, manualIdx),
          wasPersisted: isPersistedManual,
        }];
        return next.length > 20 ? next.slice(next.length - 20) : next;
      });
      setRedoStack([]);
      // Adjust selection + excluded-idx mask for the splice.
      if (selectedShiftIdx === idx) {
        setSelectedShiftIdx(null);
      } else if (selectedShiftIdx !== null && selectedShiftIdx > idx) {
        setSelectedShiftIdx(selectedShiftIdx - 1);
      }
      setExcludedIdxs((prev) => {
        const remapped = new Set<number>();
        prev.forEach((v) => {
          if (v === idx) return;
          remapped.add(v > idx ? v - 1 : v);
        });
        return remapped;
      });
      return;
    }
    // AI suggestion — toggle exclusion (existing behavior).
    setExcludedIdxs((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) {
        next.delete(idx);
      } else {
        next.add(idx);
        if (selectedShiftIdx === idx) setSelectedShiftIdx(null);
        setUndoStack((prevStack) => {
          const nextStack: UndoEntry[] = [...prevStack, { kind: 'remove-ai', idx }];
          return nextStack.length > 20 ? nextStack.slice(nextStack.length - 20) : nextStack;
        });
        setRedoStack([]);
      }
      return next;
    });
  };

  const { data: salesData, isLoading: salesLoading } = useQuery<HistoricalSalesData>({
    queryKey: ["/api/schedules/historical-sales", modalDate],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/schedules/historical-sales?date=${modalDate}`);
      return res.json();
    },
    enabled: open && !!modalDate,
    retry: 1,
  });

  const { data: availData, isLoading: availLoading } = useQuery<TodayAvailData>({
    queryKey: ['/api/schedules/today-availability', modalDate],
    queryFn: async () => {
      const res = await fetch(`/api/schedules/today-availability?date=${modalDate}`, { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to fetch availability');
      return res.json();
    },
    enabled: open && !!modalDate,
    staleTime: 2 * 60_000,
  });

  // Roles list — used by the live margin meter to fall back to
  // `role.defaultHourlyRate` when an employee has no per-user hourly rate set.
  // Cheap query (cached server-side) and only fired while the panel is open.
  const { data: rolesList = [] } = useQuery<Array<{ id: string; defaultHourlyRate?: string | number | null }>>({
    queryKey: ['/api/roles'],
    enabled: open,
    staleTime: 5 * 60_000,
  });

  const {
    data: suggestData,
    isLoading: suggestLoading,
    isFetching: suggestFetching,
    isError: suggestError,
    error: suggestErrorObj,
    dataUpdatedAt: suggestUpdatedAt,
    refetch: refetchSuggest,
  } = useQuery<SuggestData>({
    queryKey: ["/api/schedules/suggest", modalDate],
    queryFn: async () => {
      const skipCache = forceRegenRef.current;
      forceRegenRef.current = false;
      dlog("suggest/fetch", { date: modalDate, skipCache });
      if (!skipCache) {
        try {
          const getRes = await apiRequest("GET", `/api/schedules/suggest?date=${modalDate}`);
          const saved = await getRes.json();
          if (saved?.proposedShifts?.length > 0) {
            dlog("suggest/cacheHit", { date: modalDate, count: saved.proposedShifts.length });
            return saved;
          }
        } catch {
          // no saved suggestion — fall through to generate
        }
      }
      // When the user explicitly clicked "Refresh AI suggestions", send
      // `force: true` so the server bypasses its cache short-circuit and
      // regenerates a fresh batch (Task #413). The non-force branch (initial
      // open with no cache row) omits the flag so first-time generation still
      // runs, while reopens that hit an existing cache row will short-circuit
      // server-side and return the cached payload unchanged.
      const body: { date: string; force?: boolean } = { date: modalDate };
      if (skipCache) body.force = true;
      const res = await apiRequest("POST", "/api/schedules/suggest", body);
      return res.json();
    },
    // editingSchedule mode is a focused single-shift editor — skip the fetch
    // so we don't surface AI proposals the user didn't ask for. See
    // effectiveSuggestData below for the matching render-side mask.
    enabled: open && !!modalDate && !editingSchedule,
    staleTime: 5 * 60_000,
    gcTime: 10 * 60_000,
    retry: 1,
  });

  // Single source of truth for AI suggestion data the UI is allowed to read.
  // In editingSchedule mode this collapses to undefined so all derived AI
  // surfaces (timeline column, ghost preview, conflict banner, synthetic-data
  // disclaimer) auto-disappear without per-site `editingSchedule` checks.
  // The Refresh button and the suggest useQuery `enabled` clause are gated
  // directly by `editingSchedule` instead — they're about NOT FETCHING /
  // disabling an action, not about masking already-loaded data. Routing all
  // AI reads through this value also blocks stale react-query cache from a
  // prior create-mode open on the same date from leaking into the edit view.
  const effectiveSuggestData = editingSchedule ? undefined : suggestData;

  // Mirror into ref so undo/redo and handler-side aiCount math (which can't
  // re-read from useState during a callback) stay aligned with the rendered UI.
  useEffect(() => {
    suggestDataRef.current = effectiveSuggestData;
  }, [effectiveSuggestData]);

  // Mutation to persist a pill-added shift to the suggested schedule cache
  const persistPillShiftMutation = useMutation({
    mutationFn: async ({ shift, date }: { shift: ProposedShift; date: string }) => {
      const res = await apiRequest("PUT", "/api/schedules/suggest", {
        date,
        shiftIndex: -1,
        employeeId: shift.employeeId,
        employeeName: shift.employeeName,
        startTime: shift.startTime,
        endTime: shift.endTime,
        shiftBlock: shift.shiftBlock,
        rationale: shift.rationale,
      });
      return res.json();
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ["/api/schedules/suggest", variables.date] });
    },
    onError: () => {
      toast({ title: "Warning", description: "Shift added locally but could not be saved — it may not persist after reopening.", variant: "destructive" });
    },
  });

  // Mutation to persist a single edited shift back to DB
  const saveShiftMutation = useMutation({
    mutationFn: async ({ idx, edit }: { idx: number; edit: ShiftEdit }) => {
      const shift = suggestData?.proposedShifts[idx];
      const res = await apiRequest("PUT", "/api/schedules/suggest", {
        date: modalDate,
        shiftIndex: idx,
        startTime: edit.startTime ?? shift?.startTime,
        endTime: edit.endTime ?? shift?.endTime,
        employeeId: edit.employeeId ?? shift?.employeeId,
        employeeName: edit.employeeName ?? shift?.employeeName,
      });
      return res.json();
    },
    onSuccess: (_data, variables) => {
      dlog("saveShiftMutation/success", { idx: variables.idx, edit: variables.edit });
      queryClient.invalidateQueries({ queryKey: ["/api/schedules/suggest", modalDate] });
      toast({ title: "Shift saved", description: "Changes persisted to the suggested schedule." });
      // Flash "Saved ✓" on the button for 2s — but ONLY if the same card is still selected.
      // Prevents a stale "Saved ✓" appearing on card B when the user saves A then switches to B
      // before the network round-trip resolves.
      if (selectedShiftIdx === variables.idx) {
        flashSaved();
      }
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to save shift changes.", variant: "destructive" });
    },
  });

  // Mutations to update / delete an existing scheduled shift inline
  const updateActualMutation = useMutation({
    mutationFn: async (data: {
      id: string;
      userId: string;
      startTime: Date;
      endTime: Date;
      title?: string | null;
      locationId?: string | null;
      description?: string | null;
    }) => {
      const res = await apiRequest("PATCH", `/api/schedules/${data.id}`, data);
      return res.json();
    },
    onSuccess: (_data, vars) => {
      dlog("updateActualMutation/success", { id: vars.id, userId: vars.userId });
      queryClient.invalidateQueries({ queryKey: ["/api/schedules"] });
      // Drop the saved shift's entry from the pending-edits map so the
      // overlay stops layering already-persisted values on top of fresh
      // server data after invalidation.
      setPendingActualEdits(prev => {
        if (!prev[vars.id]) return prev;
        const next = { ...prev };
        delete next[vars.id];
        return next;
      });
      setSelectedActualSchedule(null);
      setActualFormEdits(null);
      toast({ title: "Shift updated", description: "Changes saved to the schedule." });
    },
    onError: (err, vars) => {
      dlog("updateActualMutation/error", { id: vars?.id, error: String(err) });
      toast({ title: "Error", description: "Failed to update shift.", variant: "destructive" });
    },
  });

  // Recreates a deleted shift via POST /api/schedules — used by the Undo path
  // on the actual-delete toast. Refetches /api/schedules so the panel + grid
  // immediately show the restored card without manual reload.
  const recreateScheduleMutation = useMutation({
    mutationFn: async (data: {
      userId: string;
      startTime: Date;
      endTime: Date;
      title?: string | null;
      locationId?: string | null;
      description?: string | null;
    }) => {
      const res = await apiRequest("POST", "/api/schedules", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.refetchQueries({ queryKey: ["/api/schedules"], type: 'active' });
      toast({ title: "Shift restored", description: "The deleted shift has been re-created." });
    },
    onError: () => {
      toast({
        title: "Couldn't restore shift",
        description: "Try recreating it manually from the schedule.",
        variant: "destructive",
      });
    },
  });

  // Bulk-delete N persisted shifts in one round-trip (Task #391 B6 floating
  // action bar). Captures the full pre-delete payloads so the toast can offer
  // a single-click "Undo all N" that recreates them. Uses the existing
  // /api/schedules/bulk DELETE route which is already store-scoped + permission
  // checked server-side.
  const bulkDeleteActualsMutation = useMutation({
    mutationFn: async (params: { schedules: Schedule[] }) => {
      const ids = params.schedules.map(s => s.id);
      const res = await apiRequest("DELETE", "/api/schedules/bulk", { ids });
      // Server returns { deleted: string[] } on success. Parse defensively
      // without an `any` cast: a missing/malformed body just yields an empty
      // deleted list, which matches the "nothing happened" UX.
      let deleted: string[] = [];
      try {
        const json: unknown = await res.json();
        if (json && typeof json === 'object' && Array.isArray((json as { deleted?: unknown }).deleted)) {
          deleted = ((json as { deleted: unknown[] }).deleted).filter(
            (x): x is string => typeof x === 'string'
          );
        }
      } catch {
        // Body wasn't JSON (e.g. 204) — leave deleted empty.
      }
      return { deleted };
    },
    onSuccess: (data, variables) => {
      dlog("bulkDeleteActualsMutation/success", { deletedCount: data.deleted.length, deletedIds: data.deleted });
      queryClient.invalidateQueries({ queryKey: ["/api/schedules"] });
      // Clear multi-select once the server confirms the delete — the cards
      // they referenced are no longer in liveActualShifts.
      setSelectedActualIds(new Set());
      setMultiSelectAnchorId(null);
      // If the right-side form was focused on one of the deleted shifts,
      // drop that focus too — otherwise the editor keeps pointing to a row
      // that no longer exists until the refetch lands.
      const removedSetForFocus = new Set(data.deleted);
      if (selectedActualSchedule && removedSetForFocus.has(selectedActualSchedule.id)) {
        setSelectedActualSchedule(null);
        setActualFormEdits(null);
      }
      // Drop pending-edit overlays for any rows the server confirmed deleted,
      // so the map doesn't accumulate orphaned entries until the panel closes.
      if (removedSetForFocus.size > 0) {
        setPendingActualEdits(prev => {
          let mutated = false;
          const next = { ...prev };
          for (const id of removedSetForFocus) {
            if (id in next) { delete next[id]; mutated = true; }
          }
          return mutated ? next : prev;
        });
      }
      const removedCount = data.deleted.length;
      // Capture original payloads for undo; only include the rows the server
      // actually deleted (in case some failed scope check and were skipped).
      const removedSet = new Set(data.deleted);
      const restorable = variables.schedules.filter(s => removedSet.has(s.id));
      toast({
        title: removedCount === 1 ? "1 shift deleted" : `${removedCount} shifts deleted`,
        description: removedCount > 0 ? "Click undo within 10s to restore." : "No shifts were eligible for deletion.",
        action: removedCount > 0 ? (
          <ToastAction
            altText={`Undo delete of ${removedCount} shift${removedCount === 1 ? "" : "s"}`}
            data-testid="bulk-delete-undo-action"
            onClick={async () => {
              // Sequential POSTs so each recreate gets its own row + WS event.
              // For ≤200 shifts this is well within a couple of seconds and
              // keeps the API surface unchanged.
              for (const s of restorable) {
                try {
                  await apiRequest("POST", "/api/schedules", {
                    userId: s.userId,
                    startTime: new Date(s.startTime),
                    endTime: new Date(s.endTime),
                    title: s.title ?? null,
                    locationId: s.locationId ?? null,
                    description: s.description ?? null,
                  });
                } catch {
                  // Swallow per-row errors — the toast below summarizes overall.
                }
              }
              queryClient.invalidateQueries({ queryKey: ["/api/schedules"] });
              toast({ title: "Shifts restored", description: `${restorable.length} shift${restorable.length === 1 ? "" : "s"} re-created.` });
            }}
          >
            Undo
          </ToastAction>
        ) : undefined,
        duration: 10_000,
      });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to delete shifts.", variant: "destructive" });
    },
  });

  // Bulk-move N persisted shifts to a different date in one round-trip
  // (Task #395 — "Move to…" on the floating action bar). All cards on the
  // floating action bar belong to the currently-displayed `modalDate`, so
  // moving them to `targetDate` is equivalent to shifting every shift's
  // start/end timestamp by exactly (targetDate − modalDate) whole days.
  // We use the existing `shiftMinutes` op on /api/schedules/bulk so the
  // server can do the math + per-row update in a single transaction. Undo
  // is just the same call with the inverse delta.
  const bulkMoveActualsMutation = useMutation({
    mutationFn: async (params: { ids: string[]; deltaMin: number; targetDate: string }) => {
      const res = await apiRequest("PATCH", "/api/schedules/bulk", {
        ids: params.ids,
        op: { kind: 'shiftMinutes', deltaMin: params.deltaMin },
      });
      // Server returns { updated: Schedule[] }; parse defensively without
      // an `any` cast (a malformed body just yields an empty list).
      let updated: Schedule[] = [];
      try {
        const json: unknown = await res.json();
        if (json && typeof json === 'object' && Array.isArray((json as { updated?: unknown }).updated)) {
          updated = (json as { updated: Schedule[] }).updated;
        }
      } catch {
        // Body wasn't JSON — leave updated empty.
      }
      return { updated };
    },
    onSuccess: (data, variables) => {
      queryClient.invalidateQueries({ queryKey: ["/api/schedules"] });
      // Acceptance: selection clears after the move completes. Also dismiss
      // the dialog and clear any focused-row state pointing at a moved shift
      // (the editor on the right would otherwise still show the old date).
      setSelectedActualIds(new Set());
      setMultiSelectAnchorId(null);
      setShowMoveDayDialog(false);
      const removedSetForFocus = new Set(data.updated.map(s => s.id));
      if (selectedActualSchedule && removedSetForFocus.has(selectedActualSchedule.id)) {
        setSelectedActualSchedule(null);
        setActualFormEdits(null);
      }

      const movedCount = data.updated.length;
      const movedIds = data.updated.map(s => s.id);
      const targetLabel = variables.targetDate
        ? new Date(variables.targetDate + "T12:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric" })
        : "";
      toast({
        title:
          movedCount === 0
            ? "No shifts moved"
            : `${movedCount} shift${movedCount === 1 ? "" : "s"} moved to ${targetLabel}`,
        description: movedCount > 0 ? "Click undo within 10s to restore the original date." : "No shifts were eligible for move.",
        action: movedCount > 0 ? (
          <ToastAction
            altText={`Undo move of ${movedCount} shift${movedCount === 1 ? "" : "s"}`}
            data-testid="bulk-move-undo-action"
            onClick={async () => {
              try {
                await apiRequest("PATCH", "/api/schedules/bulk", {
                  ids: movedIds,
                  op: { kind: 'shiftMinutes', deltaMin: -variables.deltaMin },
                });
                queryClient.invalidateQueries({ queryKey: ["/api/schedules"] });
                toast({
                  title: "Move undone",
                  description: `${movedCount} shift${movedCount === 1 ? "" : "s"} restored to the original date.`,
                });
              } catch {
                toast({
                  title: "Couldn't undo move",
                  description: "Try moving them back manually from the schedule.",
                  variant: "destructive",
                });
              }
            }}
          >
            Undo
          </ToastAction>
        ) : undefined,
        duration: 10_000,
      });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to move shifts.", variant: "destructive" });
    },
  });

  // Capture the full payload of an actual shift before deleting so we can recreate
  // it on undo. The mutation receives the whole `Schedule` (not just an id) so
  // the closure has every field needed for the POST in recreateScheduleMutation.
  const deleteActualMutation = useMutation({
    mutationFn: async (params: { schedule: Schedule }) => {
      return apiRequest("DELETE", `/api/schedules/${params.schedule.id}`);
    },
    onSuccess: (_data, variables) => {
      dlog("deleteActualMutation/success", { id: variables.schedule.id, userId: variables.schedule.userId });
      queryClient.invalidateQueries({ queryKey: ["/api/schedules"] });
      setSelectedActualSchedule(null);
      setActualFormEdits(null);
      // Drop any pending edits for the deleted shift so a stale overlay
      // doesn't ressurect on subsequent renders or undo flows.
      setPendingActualEdits(prev => {
        if (!prev[variables.schedule.id]) return prev;
        const next = { ...prev };
        delete next[variables.schedule.id];
        return next;
      });
      const original = variables.schedule;
      const empName = employees.find((e) => e.id === original.userId);
      const who = empName ? `${empName.firstName ?? ''}`.trim() || 'shift' : 'shift';
      const startTimeStr = new Date(original.startTime).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
      const endTimeStr = new Date(original.endTime).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
      toast({
        title: "Shift deleted",
        description: `${who}'s ${startTimeStr}–${endTimeStr} shift removed.`,
        action: (
          <ToastAction
            altText="Undo delete"
            onClick={() => {
              recreateScheduleMutation.mutate({
                userId: original.userId,
                startTime: new Date(original.startTime),
                endTime: new Date(original.endTime),
                title: original.title ?? null,
                locationId: original.locationId ?? null,
                description: original.description ?? null,
              });
            }}
          >
            Undo
          </ToastAction>
        ),
        duration: 10_000,
      });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to delete shift.", variant: "destructive" });
    },
  });

  const approveMutation = useMutation({
    mutationFn: async (shifts: ProposedShift[]) => {
      const entries = shifts.map((s) => ({
        employeeId: s.employeeId,
        date: modalDate,
        startTime: s.startTime,
        endTime: s.endTime,
        shiftBlock: s.shiftBlock,
        reasoning: s.rationale,
      }));
      // `trace: true` routes the HTTP request/response pair through the
      // shared apiDlog stream so the user only needs to share the console
      // output (no Network-tab screenshots required) — see Task #420.
      return apiRequest(
        "POST",
        "/api/ai-scheduling/apply",
        { scheduleEntries: entries },
        { trace: true },
      );
    },
    onSuccess: async (response: any) => {
      const result = await response.json();
      const skipped = pendingSkippedCountRef.current;
      pendingSkippedCountRef.current = 0;
      // Capture created IDs for the bulk-undo toast (Task #387 B8). The W1.1
      // server change appends `created: Schedule[]` so we can DELETE them in a
      // single round-trip if the user clicks Undo within the toast lifetime.
      const createdIds: string[] = Array.isArray(result?.created)
        ? result.created.map((s: { id: string }) => s.id).filter(Boolean)
        : [];
      lastCreatedIdsRef.current = createdIds;
      // Task #328: server-side overlap guard. The server may refuse to
      // insert a shift that overlaps an existing one even when the client's
      // cached overlap check missed it (stale or unloaded cache). The
      // panel's contract is to surface the per-row reasons in a follow-up
      // toast so the manager knows exactly which shifts didn't write.
      const serverSkipped: Array<{
        employeeId: string;
        date: string;
        startTime: string;
        endTime: string;
        reason: string;
        existingStart?: string;
        existingEnd?: string;
      }> = Array.isArray(result?.skipped) ? result.skipped : [];
      dlog("approveMutation/success", {
        schedulesCreated: result?.schedulesCreated,
        createdCount: createdIds.length,
        createdIds,
        skipped,
        serverSkippedCount: serverSkipped.length,
        rawResultKeys: result && typeof result === 'object' ? Object.keys(result) : null,
      });
      // Refetch grid + availability so the user lands on populated views.
      // Task #712 — also refetch the AI suggest cache for the saved date so
      // the "AI Suggested" column doesn't re-present employees the user
      // just scheduled (the May 9 "+N shifts on every reopen" trust bug).
      // We refetch per-modalDate (precise) AND invalidate the namespace as
      // a safety net for any other date queries currently mounted.
      const refetches: Array<Promise<unknown>> = [
        queryClient.refetchQueries({ queryKey: ["/api/schedules"], type: 'active' }),
        queryClient.refetchQueries({ queryKey: ["/api/schedules/today-availability"], type: 'active' }),
        queryClient.refetchQueries({ queryKey: ["/api/availability/calendar/team"], type: 'active' }),
      ];
      if (modalDate) {
        refetches.push(
          queryClient.refetchQueries({ queryKey: ["/api/schedules/suggest", modalDate], type: 'active' }),
        );
      }
      queryClient.invalidateQueries({ queryKey: ["/api/schedules/suggest"] });
      await Promise.all(refetches);
      // Also clear pending manual draft shifts so a subsequent panel open doesn't show
      // them as "still pending" alongside the now-persisted versions.
      setManualShifts([]);
      setFormDirty(false);
      // Drop the localStorage draft for this (date, user) — the work is now
      // persisted server-side, no need to restore it on next open.
      if (draftUserId && modalDate) clearDraft(draftStoreId, modalDate, draftUserId);

      // Detect off-week save: if the saved date is outside the schedule grid's
      // current visible week, surface a "Jump to that week" toast action so the
      // user lands on the page actually showing their changes.
      const savedDate = modalDate;
      const range = currentWeekRange;
      const isOffWeek = !!range && !!savedDate && (savedDate < range.start || savedDate > range.end);

      const dayLabel = savedDate
        ? new Date(savedDate + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
        : '';
      const baseDescription = skipped > 0
        ? `${result.schedulesCreated} shift${result.schedulesCreated !== 1 ? "s" : ""} added${dayLabel ? ` for ${dayLabel}` : ''}, ${skipped} blank shift${skipped !== 1 ? "s" : ""} skipped.`
        : `${result.schedulesCreated} shift${result.schedulesCreated !== 1 ? "s" : ""} added${dayLabel ? ` for ${dayLabel}` : ''}.`;

      // Bulk-undo action (Task #387 B8) — fires DELETE /api/schedules/bulk
      // with the just-created IDs. Independent of the off-week jump action;
      // we prefer the jump-to-week CTA when both apply (off-week saves are
      // rare and the jump is the more useful next step).
      const undoAction = createdIds.length > 0 ? (
        <ToastAction
          altText="Undo last save"
          data-testid="bulk-undo-toast-action"
          onClick={async () => {
            try {
              await apiRequest('DELETE', '/api/schedules/bulk', { ids: createdIds });
              await Promise.all([
                queryClient.refetchQueries({ queryKey: ["/api/schedules"], type: 'active' }),
                queryClient.refetchQueries({ queryKey: ["/api/schedules/today-availability"], type: 'active' }),
              ]);
              toast({ title: 'Undone', description: `Removed ${createdIds.length} shift${createdIds.length !== 1 ? 's' : ''}.` });
              lastCreatedIdsRef.current = [];
            } catch {
              toast({ title: 'Undo failed', description: 'Some shifts may have already been modified.', variant: 'destructive' });
            }
          }}
        >
          Undo
        </ToastAction>
      ) : null;

      toast({
        title: isOffWeek ? "Saved — outside current week" : "Schedule Approved",
        description: baseDescription,
        ...(isOffWeek && onJumpToWeek ? {
          action: (
            <ToastAction
              altText="Jump to that week"
              onClick={() => onJumpToWeek(savedDate)}
            >
              Jump to that week
            </ToastAction>
          ),
          duration: 10_000,
        } : undoAction ? {
          action: undoAction,
          duration: 10_000,
        } : {}),
      });

      // Task #328: surface server-side conflict skips in a separate toast so
      // the manager sees BOTH the success count AND a per-row breakdown of
      // anything the server refused to write. The success toast above stays
      // unchanged so existing flows (off-week jump / undo) keep working.
      if (serverSkipped.length > 0) {
        const empName = (id: string): string => {
          const u = employees.find((e) => e.id === id);
          if (!u) return 'A teammate';
          const full = `${u.firstName ?? ''} ${u.lastName ?? ''}`.trim();
          return full || u.email || 'A teammate';
        };
        // Render the existing-shift window in the user's local TZ rather than
        // hardcoding a single "overlaps an existing shift" line, so that as
        // the server contract grows new reason codes the client surfaces
        // them verbatim instead of silently mislabelling them.
        const fmtLocalTime = (iso?: string): string => {
          if (!iso) return '';
          try {
            return new Date(iso).toLocaleTimeString('en-GB', {
              hour: '2-digit',
              minute: '2-digit',
              hour12: false,
            });
          } catch {
            return '';
          }
        };
        const reasonText = (s: typeof serverSkipped[number]): string => {
          if (s.reason === 'overlaps_existing_schedule') {
            const win = s.existingStart && s.existingEnd
              ? ` ${fmtLocalTime(s.existingStart)}–${fmtLocalTime(s.existingEnd)}`
              : '';
            return `overlaps existing shift${win}`;
          }
          // Fallback for any new server-side reason codes — surface the raw
          // reason rather than swallowing it, so the bug is visible in the UI.
          return s.reason.replace(/_/g, ' ');
        };
        const lines = serverSkipped.slice(0, 3).map((s) =>
          `${empName(s.employeeId)} (${s.startTime}–${s.endTime}) — ${reasonText(s)}`,
        );
        const more = serverSkipped.length > lines.length
          ? ` +${serverSkipped.length - lines.length} more`
          : '';
        toast({
          title: `${serverSkipped.length} shift${serverSkipped.length !== 1 ? 's' : ''} skipped`,
          description: `${lines.join(' • ')}${more}`,
          variant: 'destructive',
          duration: 12_000,
        });
      }
      onOpenChange(false);
    },
    onError: (err) => {
      dlog("approveMutation/error", { error: String(err) });
      pendingSkippedCountRef.current = 0;
      toast({ title: "Error", description: "Failed to approve shifts.", variant: "destructive" });
    },
  });

  const handleSelectShift = (shift: ProposedShift, idx: number) => {
    dlog("handleSelectShift", { idx, employeeId: shift.employeeId, startTime: shift.startTime, endTime: shift.endTime });
    if (idx === selectedShiftIdx) {
      setSelectedShiftIdx(null);
      return;
    }
    setSelectedShiftIdx(idx);
    setSelectedUserId(shift.employeeId);
    setModalStartTime(shift.startTime);
    setModalEndTime(shift.endTime);
    // Populate role / location / notes — ProposedShift has no locationId field,
    // so clear to empty to avoid stale carryover from a previous selection
    setModalTitle(shift.shiftBlock || "");
    setModalLocationId("");
    setModalNotes(shift.rationale || "");
    // Clear any actual-shift selection
    setSelectedActualSchedule(null);
    setActualFormEdits(null);
  };

  const handleSelectActualShift = useCallback((schedule: Schedule, e?: React.MouseEvent) => {
    // Multi-select branch (Task #391 B6). Cmd/Ctrl-click toggles, Shift-click
    // extends a range from the last anchor. We deliberately do NOT touch the
    // single-focus form state in these branches — multi-select is for bulk
    // actions only and shouldn't replace what's in the editor on the right.
    const mode = e ? modeFromEvent(e) : 'single';
    dlog("handleSelectActualShift", { id: schedule.id, mode, prevSelectedId: selectedActualSchedule?.id });
    if (mode === 'toggle' || mode === 'range') {
      const orderedIds = (liveActualShifts ?? []).map(a => a.schedule.id);
      setSelectedActualIds(prev => nextMultiSelection(prev, orderedIds, multiSelectAnchorId, schedule.id, mode));
      // Range clicks keep the existing anchor; toggle clicks adopt the most
      // recently clicked id as the next anchor (so a follow-up Shift-click
      // pivots from there).
      if (mode === 'toggle') setMultiSelectAnchorId(schedule.id);
      return;
    }
    // Plain click — clear any prior multi-selection and behave as before.
    setSelectedActualIds(new Set());
    setMultiSelectAnchorId(schedule.id);

    if (selectedActualSchedule?.id === schedule.id) {
      // Deselect
      setSelectedActualSchedule(null);
      setActualFormEdits(null);
      return;
    }
    const st = new Date(schedule.startTime);
    const et = new Date(schedule.endTime);
    const pad = (n: number) => String(n).padStart(2, '0');
    const dateStr = `${st.getFullYear()}-${pad(st.getMonth() + 1)}-${pad(st.getDate())}`;
    const serverStart = `${pad(st.getHours())}:${pad(st.getMinutes())}`;
    const serverEnd   = `${pad(et.getHours())}:${pad(et.getMinutes())}`;
    // Bug-2 round-trip fix: if the user previously edited this shift in the
    // current panel session (e.g. tweaked A's times, clicked B, now clicked
    // A again), prefer the pending map values over the server-side ones.
    // Without this, re-populating from `schedule.startTime/endTime` would
    // immediately bleed into `pendingActualEdits` via the sync effect and
    // wipe the user's unsaved work.
    const pending = pendingActualEdits[schedule.id];
    const startStr = pending?.startTime ?? serverStart;
    const endStr   = pending?.endTime ?? serverEnd;
    const userId   = pending?.userId ?? schedule.userId;
    dlog("handleSelectActualShift/populate", {
      id: schedule.id,
      hadPending: !!pending,
      startStr,
      endStr,
      userId,
    });
    setSelectedActualSchedule(schedule);
    setActualFormEdits({ startTime: startStr, endTime: endStr, userId });
    setModalDate(dateStr);
    setModalStartTime(startStr);
    setModalEndTime(endStr);
    setSelectedUserId(userId);
    setModalTitle(schedule.title ?? '');
    setModalLocationId(schedule.locationId ?? locations[0]?.id ?? '');
    setModalNotes(schedule.description ?? '');
    setSelectedShiftIdx(null);
    if (onDateChange) onDateChange(dateStr);
    // multiSelectAnchorId + liveActualShifts must be in deps so range and
    // toggle clicks always read the freshest anchor and ordered id list.
    // pendingActualEdits is in deps so the round-trip restore above always
    // reads the freshest map entry (otherwise the closure would capture a
    // stale snapshot from before the user's most recent typing).
  }, [selectedActualSchedule, locations, onDateChange, multiSelectAnchorId, liveActualShifts, pendingActualEdits]);

  const handleSaveActual = useCallback((closeOnSave: boolean = false) => {
    if (!selectedActualSchedule) return;
    const [y, mo, d] = modalDate.split('-').map(Number);
    const [sh, sm] = modalStartTime.split(':').map(Number);
    const [eh, em] = modalEndTime.split(':').map(Number);
    const startDate = new Date(y, mo - 1, d, sh, sm, 0, 0);
    const endDate   = new Date(y, mo - 1, d, eh, em, 0, 0);
    if (endDate <= startDate) endDate.setDate(endDate.getDate() + 1);
    dlog("handleSaveActual", {
      id: selectedActualSchedule.id,
      modalDate, modalStartTime, modalEndTime,
      userId: selectedUserId,
      startISO: startDate.toISOString(),
      endISO: endDate.toISOString(),
      queuedNudges: pendingNudgesRef.current.length,
      closeOnSave,
    });
    // Task #392 C3 — capture any queued one-hop nudges and only dispatch them
    // AFTER the primary update succeeds. If the primary save fails, the
    // sibling shifts are left untouched so the schedule stays consistent
    // with what the user sees.
    const queued = pendingNudgesRef.current;
    pendingNudgesRef.current = [];
    updateActualMutation.mutate(
      {
        id: selectedActualSchedule.id,
        userId: selectedUserId,
        startTime: startDate,
        endTime: endDate,
        title: modalTitle || null,
        locationId: modalLocationId || null,
        description: modalNotes || null,
      },
      {
        onSuccess: () => {
          if (queued.length === 0) {
            if (closeOnSave) {
              dlog("handleSaveActual/closingAfterSave", { id: selectedActualSchedule.id });
              onOpenChange(false);
            }
            return;
          }
          // Dispatch nudges via apiRequest directly (not `updateActualMutation`)
          // to avoid the per-mutation toast spam and selection-clear side
          // effects. One summary toast + one invalidate at the end.
          Promise.all(queued.map((n) =>
            apiRequest('PATCH', `/api/schedules/${n.id}`, n).catch((err) => {
              console.warn('[CreateShiftSplitPanel] nudge PATCH failed', n.id, err);
              return null;
            })
          )).then(() => {
            queryClient.invalidateQueries({ queryKey: ['/api/schedules'] });
            toast({
              title: 'Made room',
              description: `Nudged ${queued.length} other shift${queued.length === 1 ? '' : 's'} to make space.`,
            });
            if (closeOnSave) {
              dlog("handleSaveActual/closingAfterSaveAndNudge", { id: selectedActualSchedule.id, nudgeCount: queued.length });
              onOpenChange(false);
            }
          });
        },
      },
    );
  }, [selectedActualSchedule, modalDate, modalStartTime, modalEndTime, selectedUserId, modalTitle, modalLocationId, modalNotes, updateActualMutation, queryClient, toast, onOpenChange]);

  const handleSaveShiftEdit = () => {
    if (selectedShiftIdx === null) return;
    const aiCount = suggestDataRef.current?.proposedShifts?.length ?? 0;
    dlog("handleSaveShiftEdit", {
      selectedShiftIdx,
      aiCount,
      isManual: selectedShiftIdx >= aiCount,
      modalStartTime,
      modalEndTime,
      selectedUserId,
      modalTitle,
    });

    if (selectedShiftIdx >= aiCount) {
      // Manual shift — save to local state only (no API call needed).
      // Persist role/title and notes too so they reach the apply route as `shiftBlock`/`reasoning`
      // instead of falling back to the generic "AI Generated Shift" default on the server.
      const manualIdx = selectedShiftIdx - aiCount;
      const emp = selectedUserId ? employees.find((e) => e.id === selectedUserId) : null;
      const empName = emp ? `${emp.firstName ?? ""} ${emp.lastName ?? ""}`.trim() : undefined;
      setManualShifts((prev) => prev.map((s, i) =>
        i === manualIdx
          ? {
              ...s,
              startTime: modalStartTime,
              endTime: modalEndTime,
              ...(selectedUserId ? { employeeId: selectedUserId } : {}),
              ...(empName ? { employeeName: empName } : {}),
              shiftBlock: modalTitle?.trim() ? modalTitle.trim() : 'Manual Shift',
              rationale: modalNotes?.trim() || s.rationale || '',
            }
          : s
      ));
      // Keep card selected and flash "Saved ✓" (same UX as AI shifts)
      flashSaved();
      return;
    }

    // AI shift — persist via mutation
    const currentEdit = editedShifts[selectedShiftIdx] ?? {};
    const mergedEdit: ShiftEdit = {
      ...currentEdit,
      startTime: modalStartTime,
      endTime: modalEndTime,
      employeeId: selectedUserId || currentEdit.employeeId,
      employeeName: selectedUserId !== (suggestData?.proposedShifts[selectedShiftIdx]?.employeeId ?? "")
        ? employees.find((e) => e.id === selectedUserId)
            ? `${employees.find((e) => e.id === selectedUserId)?.firstName ?? ""} ${employees.find((e) => e.id === selectedUserId)?.lastName ?? ""}`.trim()
            : currentEdit.employeeName
        : currentEdit.employeeName,
    };
    setEditedShifts((prev) => {
      const next = { ...prev, [selectedShiftIdx]: mergedEdit };
      editedShiftsRef.current = next;
      return next;
    });
    saveShiftMutation.mutate({ idx: selectedShiftIdx, edit: mergedEdit });
  };

  // Persists the editingSchedule edit via the parent's mutation. Extracted
  // from handleSubmit so the close-confirm dialog can reuse the same path
  // when the user clicks "Save & close" while editing a single shift —
  // otherwise that dialog would call handleBulkSave and create the AI
  // proposals as brand-new shifts each cycle (the "+1 shift on every
  // reopen" bug). Returns true if the save was dispatched.
  // Pre-save destination-overlap check for editingSchedule mode (Task #707).
  // Returns the conflicting Schedule (other than the one being edited) on the
  // destination employee whose time window overlaps the modal start/end on
  // `modalDate`, or null when the save is safe to proceed. Uses local-time
  // construction to mirror handleEditingScheduleSave's payload — otherwise a
  // user in a non-UTC zone could see a false "no conflict" result while the
  // server still rejects the save.
  const findEditingDestinationConflict = useCallback((): Schedule | null => {
    if (!editingSchedule) return null;
    const targetUserId = selectedUserId || editingSchedule.userId;
    if (!targetUserId || !modalDate || !modalStartTime || !modalEndTime) return null;
    const [y, mo, d] = modalDate.split('-').map(Number);
    const [sh, sm] = modalStartTime.split(':').map(Number);
    const [eh, em] = modalEndTime.split(':').map(Number);
    if ([y, mo, d, sh, sm, eh, em].some((n) => Number.isNaN(n))) return null;
    const newStart = new Date(y, mo - 1, d, sh, sm, 0, 0);
    const newEnd = new Date(y, mo - 1, d, eh, em, 0, 0);
    if (newEnd <= newStart) newEnd.setDate(newEnd.getDate() + 1);
    const newStartMs = newStart.getTime();
    const newEndMs = newEnd.getTime();
    for (const s of schedules ?? []) {
      if (s.id === editingSchedule.id) continue;
      if (s.userId !== targetUserId) continue;
      const otherStart = new Date(s.startTime as unknown as string).getTime();
      const otherEnd = new Date(s.endTime as unknown as string).getTime();
      if (!Number.isFinite(otherStart) || !Number.isFinite(otherEnd)) continue;
      // Half-open interval overlap, matching the GIST exclusion constraint.
      if (newStartMs < otherEnd && newEndMs > otherStart) return s;
    }
    return null;
  }, [editingSchedule, selectedUserId, modalDate, modalStartTime, modalEndTime, schedules]);

  const handleEditingScheduleSave = useCallback((): boolean => {
    if (!editingSchedule || !onUpdateSchedule) return false;
    const effectiveUserId = selectedUserId || editingSchedule.userId;
    // Determine if the currently-selected card is the editingSchedule shift
    // itself (selectedShiftIdx === null) or one of the pending manual shifts.
    // In editingSchedule mode aiProposedShifts=[] so manual idx == selectedShiftIdx.
    const editingTheOriginal = selectedShiftIdx === null;
    dlog("handleEditingScheduleSave", {
      id: editingSchedule.id,
      userId: effectiveUserId,
      modalDate, modalStartTime, modalEndTime,
      editingTheOriginal,
      pendingManualCount: manualShifts.length,
    });
    // Save the original shift edit. Only apply the modal form fields to
    // the original if the user was actually editing it (selectedShiftIdx === null);
    // otherwise the form fields belong to a manual shift and applying them
    // here would corrupt the original shift's times.
    if (editingTheOriginal) {
      // Mirror handleSaveActual's local-time construction so re-opening the
      // panel after a save does not drift the displayed times for users in
      // non-UTC timezones (Task #700, Bug 2).
      const [y, mo, d] = modalDate.split('-').map(Number);
      const [sh, sm] = modalStartTime.split(':').map(Number);
      const [eh, em] = modalEndTime.split(':').map(Number);
      const startDate = new Date(y, mo - 1, d, sh, sm, 0, 0);
      const endDate = new Date(y, mo - 1, d, eh, em, 0, 0);
      if (endDate <= startDate) endDate.setDate(endDate.getDate() + 1);
      const editingPayload = {
        id: editingSchedule.id,
        userId: effectiveUserId,
        startTime: startDate,
        endTime: endDate,
        title: modalTitle || null,
        locationId: modalLocationId || null,
        description: modalNotes || null,
      };
      // Snapshot the payload going to the parent so we can reconcile what
      // the form actually sent vs. what the parent's mutation observes
      // when the user reproduces a save bug — see Task #420.
      dlog("handleEditingScheduleSave/onUpdateSchedule(editingTheOriginal)", {
        ...editingPayload,
        startTime: editingPayload.startTime.toISOString(),
        endTime: editingPayload.endTime.toISOString(),
      });
      onUpdateSchedule(editingPayload);
    } else {
      // User had a manual shift selected when they hit Save — preserve the
      // original shift's existing values rather than overwriting with the
      // manual shift's form state.
      const origStart = editingSchedule.startTime instanceof Date
        ? editingSchedule.startTime
        : new Date(editingSchedule.startTime);
      const origEnd = editingSchedule.endTime instanceof Date
        ? editingSchedule.endTime
        : new Date(editingSchedule.endTime);
      const preservePayload = {
        id: editingSchedule.id,
        userId: editingSchedule.userId,
        startTime: origStart,
        endTime: origEnd,
        title: editingSchedule.title ?? null,
        locationId: editingSchedule.locationId ?? null,
        description: editingSchedule.description ?? null,
      };
      dlog("handleEditingScheduleSave/onUpdateSchedule(preserveOriginal)", {
        ...preservePayload,
        startTime: origStart.toISOString(),
        endTime: origEnd.toISOString(),
      });
      onUpdateSchedule(preservePayload);
    }
    // Also create any manually-added pending shifts. In editingSchedule mode
    // aiProposedShifts=[] so proposedShifts = pendingManualShifts only. If
    // a manual shift is currently selected in the right-panel form, apply
    // the form's live edits to it before submitting (otherwise the in-flight
    // edits get silently dropped). React Query mutations survive component
    // unmount, so the panel closing (triggered by onUpdateSchedule) won't
    // abort this in-flight request.
    if (manualShifts.length > 0) {
      let liveMnl = manualShifts;
      if (selectedShiftIdx !== null && selectedShiftIdx >= 0) {
        const mIdx = selectedShiftIdx; // aiCount=0 in editingSchedule mode
        const emp = selectedUserId ? employees.find(e => e.id === selectedUserId) : null;
        const empName = emp ? `${emp.firstName ?? ''} ${emp.lastName ?? ''}`.trim() : undefined;
        liveMnl = manualShifts.map((s, i) =>
          i === mIdx
            ? {
                ...s,
                startTime: modalStartTime,
                endTime: modalEndTime,
                ...(selectedUserId ? { employeeId: selectedUserId } : {}),
                ...(empName ? { employeeName: empName } : {}),
                shiftBlock: modalTitle?.trim() ? modalTitle.trim() : (s.shiftBlock || 'Manual Shift'),
                rationale: modalNotes?.trim() || s.rationale || '',
              }
            : s
        );
      }
      const manualValid = liveMnl.filter((s, i) => !!s.employeeId && !excludedIdxs.has(i));
      if (manualValid.length > 0) {
        // Full payload snapshot so we can correlate what the panel believed
        // it was sending with what the apply endpoint actually receives.
        dlog("handleEditingScheduleSave/approveManual", {
          count: manualValid.length,
          modalDate,
          shifts: manualValid.map(s => ({
            employeeId: s.employeeId,
            startTime: s.startTime,
            endTime: s.endTime,
            shiftBlock: s.shiftBlock,
          })),
        });
        pendingSkippedCountRef.current = liveMnl.length - manualValid.length;
        approveMutation.mutate(manualValid);
      } else {
        dlog("handleEditingScheduleSave/approveManualSkipped", {
          reason: "no manual shifts passed validation",
          totalManual: manualShifts.length,
          excludedCount: excludedIdxs.size,
        });
      }
    }
    return true;
  }, [editingSchedule, onUpdateSchedule, selectedUserId, modalDate, modalStartTime, modalEndTime, modalTitle, modalLocationId, modalNotes, manualShifts, selectedShiftIdx, employees, excludedIdxs, approveMutation]);

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    // Branch trace — distinguishes the "edit existing schedule via parent
    // mutation" path from the "create-new via onCreateShift prop" path.
    // Required for Task #420 because the bug only manifests in one of these.
    dlog("handleSubmit", {
      branch: editingSchedule && onUpdateSchedule ? "editingSchedule" : "createNew",
      hasEditingSchedule: !!editingSchedule,
      editingScheduleId: editingSchedule?.id ?? null,
      hasOnUpdateSchedule: !!onUpdateSchedule,
      selectedUserId,
      modalDate, modalStartTime, modalEndTime,
      modalTitle: modalTitle || null,
    });
    if (editingSchedule && onUpdateSchedule) {
      // Task #707 — block the save when reassignment (or simply moving the
      // time) would land on top of another shift the destination employee
      // already has. The dialog explains which shift conflicts and offers
      // a "View conflict" jump; the user has to explicitly confirm or
      // cancel before the request is sent. Skip the check when the user
      // had a manual draft selected (selectedShiftIdx !== null) since the
      // approve path handles those separately.
      if (selectedShiftIdx === null) {
        const conflict = findEditingDestinationConflict();
        if (conflict) {
          const emp = employees.find((u) => u.id === conflict.userId);
          const empName = emp
            ? `${emp.firstName ?? ''} ${emp.lastName ?? ''}`.trim() || emp.email || 'this employee'
            : 'this employee';
          dlog("handleSubmit/blockedByOverlap", {
            editingId: editingSchedule.id,
            conflictId: conflict.id,
            destinationUserId: selectedUserId || editingSchedule.userId,
          });
          setPendingOverlapConflict({ conflictSchedule: conflict, employeeName: empName });
          return;
        }
      }
      handleEditingScheduleSave();
    } else {
      onCreateShift({
        userId: selectedUserId,
        startTime: new Date(`${modalDate}T${modalStartTime}`),
        endTime: new Date(`${modalDate}T${modalEndTime}`),
        title: modalTitle || undefined,
        locationId: modalLocationId || undefined,
        description: modalNotes || undefined,
      });
    }
  };

  // Reads through effectiveSuggestData so this is automatically [] in
  // editingSchedule mode (see derivation near the suggest useQuery).
  const aiProposedShifts = (effectiveSuggestData?.proposedShifts ?? []).map(
    (shift, idx) => editedShifts[idx] ? { ...shift, ...editedShifts[idx] } : shift
  );

  // Ghost-preview candidates for the timeline's hover-to-add affordance.
  // IMPORTANT: capture the ORIGINAL index BEFORE filtering — `excludedIdxs`
  // is keyed to the original suggestion index, so any reordering would
  // mis-attribute exclusions. Manual-tagged entries are filtered out so the
  // ghost preview only ever surfaces genuine AI suggestions (no duplicate-
  // add of manual entries). Auto-empty in editingSchedule mode via
  // effectiveSuggestData.
  const aiGhostCandidates = useMemo<AiGhostCandidate[]>(
    () => (effectiveSuggestData?.proposedShifts ?? [])
      .map((s, idx) => ({ s, idx }))
      .filter(({ s }) => (s.shiftBlock || '').toLowerCase() !== 'manual')
      .map(({ s, idx }): AiGhostCandidate => ({
        employeeId: s.employeeId,
        employeeName: s.employeeName,
        startTime: s.startTime,
        endTime: s.endTime,
        idx,
      }))
      .filter((c) => !!c.employeeId),
    [effectiveSuggestData],
  );
  // Exclude manual shifts that have already been persisted to and returned from the cache
  const persistedManualKeys = new Set(
    aiProposedShifts
      .filter(s => s.shiftBlock === 'Manual')
      .map(s => `${s.employeeId}:${s.startTime}:${s.endTime}`)
  );
  const pendingManualShifts = manualShifts.filter(
    s => !persistedManualKeys.has(`${s.employeeId}:${s.startTime}:${s.endTime}`)
  );
  const proposedShifts = [...aiProposedShifts, ...pendingManualShifts];
  // Reads through effectiveSuggestData so the merged payload (passed to
  // DayTimeline) carries no AI metadata in editingSchedule mode.
  const mergedSuggestData = effectiveSuggestData
    ? { ...effectiveSuggestData, proposedShifts }
    : proposedShifts.length > 0
    ? {
        date: modalDate,
        proposedShifts,
        historicalDate: '',
        dataSource: 'manual',
        hourlyData: [],
        storeHours: salesData?.storeHours ?? { open: '09:00', close: '21:00' },
      }
    : undefined;
  const activeShifts = proposedShifts.filter((_, i) => !excludedIdxs.has(i));
  // Shifts with an assigned employee — these are what actually get approved/saved
  const validActiveShifts = activeShifts.filter((s) => !!s.employeeId);

  // Bulk save handler — wraps the inline button onClick so Cmd+S can call it
  // too. Auto-commits in-progress right-panel edits to the selected manual
  // draft before computing the save payload (otherwise an unsaved assignment
  // gets silently dropped). Defined after aiProposedShifts/persistedManualKeys
  // so its closure captures their current values.
  const handleBulkSave = useCallback(() => {
    dlog("handleBulkSave/start", { isPending: approveMutation.isPending, suggestLoading, hasEditingSchedule: !!editingSchedule });
    if (approveMutation.isPending || suggestLoading) return;
    // Defensive guard: handleBulkSave creates the AI-suggested shifts as
    // brand-new schedule rows. In editingSchedule mode the user opened the
    // panel to edit ONE existing shift — bulk-creating AI proposals here
    // is never the intent and was the root cause of the "+N shifts on
    // every reopen" bug. Route to the single-shift update path; if no
    // update callback was wired up by the parent, refuse the operation
    // outright rather than silently falling through to bulk-apply.
    if (editingSchedule) {
      if (onUpdateSchedule) {
        dlog("handleBulkSave/editingScheduleRoute", { id: editingSchedule.id, pendingManualCount: manualShifts.length });
        // handleEditingScheduleSave now handles BOTH the original shift edit
        // AND any pending manualShifts (created via "+Add shift" or pill add).
        handleEditingScheduleSave();
      } else {
        dlog("handleBulkSave/blockedNoUpdateCallback", { id: editingSchedule.id });
        toast({
          title: "Cannot save",
          description: "Edit-shift save handler is unavailable. Close and try again.",
          variant: "destructive",
        });
      }
      return;
    }
    const aiCount = suggestDataRef.current?.proposedShifts?.length ?? 0;
    // Bug fix (excluded AI shift reappears): when the user X's an AI
    // suggestion the only thing that happens locally is a flag in
    // `excludedIdxs` — `approveMutation` writes the KEPT shifts but the
    // server's AI cache still holds the rejected one. Without the calls
    // below, the next refetch (triggered by approve, by reopening the
    // panel, or by clicking another shift) resurrects the excluded shift
    // as a fresh AI suggestion. Manual-draft exclusions are removed
    // inline by handleToggleExclude, so this only fires for AI cards.
    const excludedAiToPersist: ProposedShift[] = [];
    excludedIdxs.forEach((idx) => {
      if (idx >= aiCount) return; // skip manual idxs (already removed)
      const s = aiProposedShifts[idx];
      if (s && s.employeeId && s.startTime && s.endTime) {
        excludedAiToPersist.push(s);
      }
    });
    if (modalDate && excludedAiToPersist.length > 0) {
      dlog("handleBulkSave/persistingExcludedAi", {
        date: modalDate,
        count: excludedAiToPersist.length,
        shifts: excludedAiToPersist.map((s) => ({
          employeeId: s.employeeId,
          startTime: s.startTime,
          endTime: s.endTime,
        })),
      });
      for (const s of excludedAiToPersist) {
        removeSuggestShiftMutation.mutate({
          date: modalDate,
          employeeId: s.employeeId!,
          startTime: s.startTime,
          endTime: s.endTime,
        });
      }
    }
    let liveManual = manualShifts;
    if (selectedShiftIdx !== null && selectedShiftIdx >= aiCount) {
      const manualIdx = selectedShiftIdx - aiCount;
      const emp = selectedUserId ? employees.find((e) => e.id === selectedUserId) : null;
      const empName = emp ? `${emp.firstName ?? ''} ${emp.lastName ?? ''}`.trim() : undefined;
      liveManual = manualShifts.map((s, i) =>
        i === manualIdx
          ? {
              ...s,
              startTime: modalStartTime,
              endTime: modalEndTime,
              ...(selectedUserId ? { employeeId: selectedUserId } : {}),
              ...(empName ? { employeeName: empName } : {}),
              shiftBlock: modalTitle?.trim() ? modalTitle.trim() : (s.shiftBlock || 'Manual Shift'),
              rationale: modalNotes?.trim() || s.rationale || '',
            }
          : s
      );
      setManualShifts(liveManual);
    }
    const liveProposed = [...aiProposedShifts, ...liveManual.filter(
      s => !persistedManualKeys.has(`${s.employeeId}:${s.startTime}:${s.endTime}`)
    )];
    const liveActive = liveProposed.filter((_, i) => !excludedIdxs.has(i));
    const liveValid = liveActive.filter((s) => !!s.employeeId);
    if (liveValid.length === 0) {
      toast({
        title: 'No shifts to save',
        description: 'Assign an employee to at least one shift before saving.',
        variant: 'destructive',
      });
      return;
    }

    // Final guard: refuse to save if any shift in this batch (or already-saved
    // shifts on the same date) would put the same employee on two overlapping
    // shifts. The dropdown grays out conflicting employees as you build the
    // schedule, but a manager can still slide an existing card's start/end
    // into another card's window after the fact — this catches that case.
    const conflictReports: string[] = [];
    const liveActuals = liveActualShifts ?? [];
    // Inline isActualEditing (= selectedActualSchedule !== null) so this
    // useCallback doesn't depend on a const declared further down in the
    // file, which would break the temporal-dead-zone check at compile time.
    const editingActualId = selectedActualSchedule ? selectedActualSchedule.id : null;
    for (let i = 0; i < liveValid.length; i++) {
      const a = liveValid[i];
      const aStart = timeToMin(a.startTime);
      const aEnd = timeToMin(a.endTime);
      // Other pending entries in this same save batch
      for (let j = i + 1; j < liveValid.length; j++) {
        const b = liveValid[j];
        if (b.employeeId !== a.employeeId) continue;
        const bStart = timeToMin(b.startTime);
        const bEnd = timeToMin(b.endTime);
        if (aStart < bEnd && aEnd > bStart) {
          conflictReports.push(
            `${a.employeeName || 'This employee'} would have two overlapping shifts (${a.startTime}–${a.endTime} and ${b.startTime}–${b.endTime}).`,
          );
        }
      }
      // Already-saved actual shifts for this same date
      for (const act of liveActuals) {
        if (editingActualId && act.schedule.id === editingActualId) continue;
        if (act.schedule.userId !== a.employeeId) continue;
        const actStart = timeToMin(act.startTime);
        const actEnd = timeToMin(act.endTime);
        if (aStart < actEnd && aEnd > actStart) {
          conflictReports.push(
            `${a.employeeName || 'This employee'} is already scheduled ${act.startTime}–${act.endTime}; a new ${a.startTime}–${a.endTime} shift would overlap.`,
          );
        }
      }
    }
    if (conflictReports.length > 0) {
      toast({
        title: 'Overlapping shifts',
        description: conflictReports.slice(0, 2).join(' '),
        variant: 'destructive',
      });
      return;
    }

    pendingSkippedCountRef.current = liveActive.length - liveValid.length;
    dlog("handleBulkSave/payload", {
      date: modalDate,
      manualCount: liveManual.length,
      excludedCount: excludedIdxs.size,
      activeCount: liveActive.length,
      validCount: liveValid.length,
      skippedCount: pendingSkippedCountRef.current,
      shifts: liveValid.map(s => ({
        employeeId: s.employeeId,
        startTime: s.startTime,
        endTime: s.endTime,
        shiftBlock: s.shiftBlock,
      })),
    });
    approveMutation.mutate(liveValid);
    // The new overlap guard above reads `liveActualShifts`,
    // `selectedActualSchedule`, and `isActualEditing` — including them in
    // the deps array prevents the callback from holding a stale snapshot
    // (e.g. immediately after another shift is saved on the same date,
    // the freshly-added actual must be visible to the next save attempt).
  }, [approveMutation, suggestLoading, manualShifts, selectedShiftIdx, employees, selectedUserId, modalStartTime, modalEndTime, modalTitle, modalNotes, aiProposedShifts, persistedManualKeys, excludedIdxs, toast, liveActualShifts, selectedActualSchedule, editingSchedule, onUpdateSchedule, handleEditingScheduleSave]);

  // Cmd/Ctrl+S — save all pending shifts. Only fires when the panel is open
  // AND there are valid shifts to save (so the browser's default page-save
  // behavior still works on the rest of the app).
  // Mode-aware routing: in editingSchedule mode, save the single shift via
  // the parent's update mutation; in isActualEditing mode, save the focused
  // actual shift; otherwise, run the bulk-create path. Without this, Cmd+S
  // in Edit Shift mode would create the AI proposals as new shifts (the
  // "+N shifts on every reopen" bug).
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
        if (editingSchedule && onUpdateSchedule) {
          e.preventDefault();
          dlog("cmdS/saveEditingSchedule", { id: editingSchedule.id });
          handleEditingScheduleSave();
          return;
        }
        if (selectedActualSchedule) {
          e.preventDefault();
          dlog("cmdS/saveActual", { id: selectedActualSchedule.id });
          handleSaveActual(false);
          return;
        }
        if (validActiveShifts.length === 0) return;
        e.preventDefault();
        dlog("cmdS/bulkSave", { count: validActiveShifts.length });
        handleBulkSave();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, validActiveShifts.length, handleBulkSave, editingSchedule, onUpdateSchedule, selectedActualSchedule, handleEditingScheduleSave, handleSaveActual]);
  const storeHours = salesData?.storeHours ?? suggestData?.storeHours ?? null;

  // Task #392 C3 — keep the nudge-on-resize closure synced with its inputs.
  // Defined here (after `storeHours`) so we don't run into TS2454/TS2448
  // forward-reference errors. The closure QUEUES nudges into
  // `pendingNudgesRef` rather than dispatching them. `handleSaveActual`
  // flushes the queue once the user commits the dragged shift; cancelling
  // the edit clears it. This avoids touching sibling shifts before the
  // primary edit is confirmed and prevents the per-mutation toast/selection
  // reset side effects from firing repeatedly.
  useEffect(() => {
    nudgeOnResizeRef.current = (schedule, startTime, endTime, dateStr) => {
      const sOpen = storeHours?.open || '09:00';
      const sClose = storeHours?.close || '21:00';
      const oMin = timeToMin(sOpen);
      const cMin = timeToMin(sClose);
      const others = dateActualShifts
        .filter((a) => a.schedule.id !== schedule.id && a.schedule.userId === schedule.userId)
        .map((a) => ({
          id: a.schedule.id,
          startTime: a.startTime,
          endTime: a.endTime,
          employeeId: a.schedule.userId,
        }));
      const nudges = oneHopNudge(startTime, endTime, schedule.userId, others, oMin, cMin);
      const queued: typeof pendingNudgesRef.current = [];
      Array.from(nudges.entries()).forEach(([id, range]) => {
        const target = dateActualShifts.find((a) => a.schedule.id === id);
        if (!target) return;
        queued.push({
          id: target.schedule.id,
          userId: target.schedule.userId,
          startTime: new Date(`${dateStr}T${range.startTime}:00`),
          endTime: new Date(`${dateStr}T${range.endTime}:00`),
          title: target.schedule.title ?? null,
          locationId: target.schedule.locationId ?? null,
          description: target.schedule.description ?? null,
        });
      });
      pendingNudgesRef.current = queued;
      if (queued.length > 0) {
        toast({
          title: 'Made room (preview)',
          description: `${queued.length} other shift${queued.length === 1 ? '' : 's'} will be nudged when you save.`,
        });
      }
    };
  }, [storeHours, dateActualShifts, toast]);

  const conflictingEmployeeIds = useMemo<Set<string>>(() => {
    if (!modalDate || proposedShifts.length === 0) return new Set();
    const allCached = queryClient.getQueriesData<Array<{ userId: string; startTime: string }>>({
      queryKey: ["/api/schedules"],
    });
    const scheduledOnDate = new Set<string>();
    for (const [, data] of allCached) {
      if (!data) continue;
      for (const s of data) {
        if (!s.startTime) continue;
        const sDate = new Date(s.startTime).toISOString().slice(0, 10);
        if (sDate === modalDate) scheduledOnDate.add(s.userId);
      }
    }
    return new Set(proposedShifts.filter((s) => scheduledOnDate.has(s.employeeId)).map((s) => s.employeeId));
  }, [modalDate, proposedShifts, queryClient]);

  const conflictCount = activeShifts.filter((s) => conflictingEmployeeIds.has(s.employeeId)).length;

  // Employees who already have a shift overlapping the right-form's
  // current start/end window on the chosen date. Used to gray out the
  // employee dropdown so a manager can't double-book the same person at
  // the same time. We consider both already-saved (actual) shifts AND
  // pending manual shifts in this draft so multiple manuals chained
  // together also block correctly. The currently-edited shift (whether
  // a saved one being moved or a manual draft being tweaked) is excluded
  // so an employee can re-time their own shift without "self-conflicting".
  const dropdownConflictingEmployeeIds = useMemo<Set<string>>(() => {
    const blocked = new Set<string>();
    if (!modalDate || !modalStartTime || !modalEndTime) return blocked;
    const startMin = timeToMin(modalStartTime);
    const endMin = timeToMin(modalEndTime);
    if (!(endMin > startMin)) return blocked;

    // Inline `isActualEditing` (selectedActualSchedule !== null) so this
    // useMemo doesn't depend on a const declared further down in the file.
    // Also ignore `editingSchedule.id` (Task #707) — when the panel is
    // opened to edit a single saved shift, the shift itself is in
    // `liveActualShifts` and would otherwise mark its own assignee as
    // "already scheduled" against themselves.
    const ignoreScheduleId = selectedActualSchedule
      ? selectedActualSchedule.id
      : editingSchedule
      ? editingSchedule.id
      : null;
    // Index of the manual shift currently being edited (if any) so we
    // skip it when checking for self-overlap. selectedShiftIdx is into
    // proposedShifts (AI then manual); subtracting aiCount yields the
    // manual index, or a negative value if the selected card is AI.
    const aiCount = proposedShifts.length - manualShifts.length;
    const editingManualIdx =
      selectedShiftIdx !== null && selectedShiftIdx >= aiCount
        ? selectedShiftIdx - aiCount
        : -1;

    const overlaps = (aStart: number, aEnd: number) =>
      startMin < aEnd && endMin > aStart;

    for (const a of liveActualShifts ?? []) {
      if (ignoreScheduleId && a.schedule.id === ignoreScheduleId) continue;
      if (overlaps(timeToMin(a.startTime), timeToMin(a.endTime))) {
        blocked.add(a.schedule.userId);
      }
    }
    manualShifts.forEach((m, idx) => {
      if (idx === editingManualIdx) return;
      if (!m.employeeId) return;
      if (overlaps(timeToMin(m.startTime), timeToMin(m.endTime))) {
        blocked.add(m.employeeId);
      }
    });
    return blocked;
  }, [
    modalDate,
    modalStartTime,
    modalEndTime,
    liveActualShifts,
    manualShifts,
    proposedShifts.length,
    selectedShiftIdx,
    selectedActualSchedule,
    editingSchedule,
  ]);

  // Employee IDs that already appear on the timeline (proposed + actual) — used by pills
  const scheduledForPills = useMemo<Set<string>>(() => {
    const ids = new Set<string>();
    proposedShifts.forEach((s, i) => { if (!excludedIdxs.has(i)) ids.add(s.employeeId); });
    dateActualShifts.forEach(a => ids.add(a.schedule.userId));
    return ids;
  }, [proposedShifts, excludedIdxs, dateActualShifts]);

  // Task #392 C5 — the AI ghost preview is suppressed when the candidate
  // already has any shift on the timeline (manual draft, persisted actual,
  // OR a non-excluded AI proposal). Otherwise the violet ghost overlay can
  // render directly on top of an existing AI card and steal the click,
  // turning an attempted "edit" into a duplicate add.
  const scheduledForAiGhost = useMemo<Set<string>>(() => {
    const ids = new Set<string>();
    proposedShifts.forEach((s, i) => { if (!excludedIdxs.has(i)) ids.add(s.employeeId); });
    pendingManualShifts.forEach(s => ids.add(s.employeeId));
    dateActualShifts.forEach(a => ids.add(a.schedule.userId));
    return ids;
  }, [proposedShifts, excludedIdxs, pendingManualShifts, dateActualShifts]);

  const handlePillAdd = useCallback((member: AvailMember) => {
    // Guard: if the employee already has a shift in the proposed or actual list,
    // just select their existing entry instead of creating a duplicate.
    const existingProposedIdx = proposedShifts.findIndex(s => s.employeeId === member.userId);
    if (existingProposedIdx >= 0) {
      const existing = proposedShifts[existingProposedIdx];
      setSelectedShiftIdx(existingProposedIdx);
      setSelectedUserId(existing.employeeId ?? '');
      setModalStartTime(existing.startTime);
      setModalEndTime(existing.endTime);
      setSelectedActualSchedule(null);
      setActualFormEdits(null);
      return;
    }
    if (dateActualShifts.some(a => a.schedule.userId === member.userId)) {
      return; // already has an actual scheduled shift on this day — do nothing
    }

    const clampFn = (t: string, min: string, max: string) => {
      function t2m(x: string) { const [h, m] = x.split(':').map(Number); return h * 60 + (m || 0); }
      function m2t(m: number) { return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`; }
      const minM = t2m(min); const maxM = t2m(max); const tM = t2m(t);
      return m2t(Math.max(minM, Math.min(maxM, tM)));
    };
    const sOpen = storeHours?.open || '09:00';
    const sClose = storeHours?.close || '21:00';
    const rawStart = member.availableFrom || sOpen;
    const rawEnd = member.availableTo || sClose;
    const clampedStart = clampFn(rawStart, sOpen, sClose);
    const clampedEnd = clampFn(rawEnd, sOpen, sClose);
    const newShift: ProposedShift = {
      employeeId: member.userId,
      employeeName: member.name,
      profileImageUrl: member.profileImageUrl,
      startTime: clampedStart,
      endTime: clampedEnd,
      shiftBlock: 'Manual',
      rationale: 'Manually added',
      revenue: 0,
    };
    // Auto-select the newly added shift so the right form shows its details
    const newIdx = proposedShifts.length; // index this shift will occupy
    setManualShifts(prev => [...prev, newShift]);
    setSelectedShiftIdx(newIdx);
    setSelectedUserId(member.userId);
    setModalStartTime(clampedStart);
    setModalEndTime(clampedEnd);
    setModalTitle('');
    setModalNotes('');
    setSelectedActualSchedule(null);
    setActualFormEdits(null);
    if (modalDate) persistPillShiftMutation.mutate({ shift: newShift, date: modalDate });
    // Scroll the timeline into view so the new block is visible
    requestAnimationFrame(() => {
      timelineWrapperRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    });
  }, [storeHours, proposedShifts, dateActualShifts, persistPillShiftMutation, modalDate]);

  // Task #392 C1/C2 — handle a pill drop on the timeline body. `clientY` is
  // the cursor's pageY at drop, `bodyRect` is the timeline body's bounds.
  // Computes a snapped 4-hour shift centered at the drop position, then
  // snaps to the member's availability window edges if either end is within
  // 15 minutes. Persists via the same `persistPillShiftMutation` as the
  // single-click "Add shift" affordance, so undo/redo + form selection match.
  //
  // The optional `explicitRange` argument lets callers (e.g. C5 ghost-apply)
  // bypass the snap-to-cursor flow and persist exact start/end times. When
  // supplied, the cursor position is ignored.
  const handlePillDrop = useCallback((
    member: AvailMember,
    clientY: number,
    bodyRect: DOMRect,
    explicitRange?: { start: string; end: string },
  ) => {
    const sOpen = storeHours?.open || '09:00';
    const sClose = storeHours?.close || '21:00';
    const oMin = timeToMin(sOpen);
    const cMin = timeToMin(sClose);
    const total = cMin - oMin;
    if (total <= 0) return;

    let finalStart: string;
    let finalEnd: string;
    let snapped = false;
    let rationale = 'Dragged from availability';
    if (explicitRange) {
      finalStart = explicitRange.start;
      finalEnd = explicitRange.end;
      rationale = 'Applied AI suggestion';
    } else {
      const relY = Math.max(0, Math.min(clientY - bodyRect.top, bodyRect.height));
      const rawStart = oMin + (relY / bodyRect.height) * total;
      const snappedStart = Math.round(rawStart / 15) * 15;
      const dur = 240; // default 4-hour shift on drop
      const baseStart = Math.max(oMin, Math.min(cMin - 60, snappedStart));
      const baseEnd = Math.min(cMin, baseStart + dur);
      const m2t = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
      const wins = (member.windows && member.windows.length > 0)
        ? member.windows
        : (member.availableFrom && member.availableTo
            ? [{ start: member.availableFrom, end: member.availableTo }]
            : []);
      const snap = snapToWindow(m2t(baseStart), m2t(baseEnd), wins, 15);
      finalStart = snap.start;
      finalEnd = snap.end;
      snapped = snap.snapped;
      rationale = snap.snapped ? 'Dragged from availability (snapped)' : 'Dragged from availability';
    }

    const newShift: ProposedShift = {
      employeeId: member.userId,
      employeeName: member.name,
      profileImageUrl: member.profileImageUrl,
      startTime: finalStart,
      endTime: finalEnd,
      shiftBlock: 'Manual',
      rationale,
      revenue: 0,
    };
    const newIdx = proposedShifts.length;
    setManualShifts(prev => [...prev, newShift]);
    setSelectedShiftIdx(newIdx);
    setSelectedUserId(member.userId);
    setModalStartTime(finalStart);
    setModalEndTime(finalEnd);
    setModalTitle('');
    setModalLocationId('');
    setModalNotes('');
    setSelectedActualSchedule(null);
    setActualFormEdits(null);
    if (modalDate) persistPillShiftMutation.mutate({ shift: newShift, date: modalDate });
    if (snapped) {
      toast({ title: 'Snapped to availability', description: `${member.name}: ${finalStart}–${finalEnd}` });
    }
  }, [storeHours, modalDate, persistPillShiftMutation, proposedShifts.length, toast]);

  // Task #392 C1 — install document-level pointermove/pointerup listeners
  // when a pill is grabbed. Only promotes to a real drag once the cursor
  // has moved >5px so simple taps still pass through to the pill's
  // "Add shift" button. Esc cancels the drag without dropping.
  const startPillDrag = useCallback((member: AvailMember, e: React.PointerEvent) => {
    const startX = e.clientX;
    const startY = e.clientY;
    let promoted = false;
    const onMove = (ev: PointerEvent) => {
      if (!promoted) {
        if (Math.hypot(ev.clientX - startX, ev.clientY - startY) <= 5) return;
        promoted = true;
      }
      setPillDrag({ member, clientY: ev.clientY });
    };
    const cleanup = () => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      // The Escape handler is registered in the capture phase, so we must
      // remove it the same way or it will leak.
      document.removeEventListener('keydown', onKey, true);
    };
    const onUp = (ev: PointerEvent) => {
      cleanup();
      if (!promoted) { setPillDrag(null); return; }
      const body = document.querySelector('[data-timeline-body="true"]') as HTMLElement | null;
      setPillDrag(null);
      if (!body) return;
      const rect = body.getBoundingClientRect();
      if (
        ev.clientX < rect.left || ev.clientX > rect.right
        || ev.clientY < rect.top || ev.clientY > rect.bottom
      ) {
        return; // dropped outside the timeline — cancel quietly
      }
      handlePillDrop(member, ev.clientY, rect);
    };
    // Register in the capture phase + stop immediate propagation so Esc
    // cancels the drag without falling through to the panel's outer Escape
    // handler (which would close the modal).
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') {
        ev.stopImmediatePropagation();
        ev.preventDefault();
        cleanup();
        setPillDrag(null);
      }
    };
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
    document.addEventListener('keydown', onKey, true);
  }, [handlePillDrop]);

  // Add a blank draft shift to the timeline so the manager can fill it in from the right panel
  const handleAddBlankShift = useCallback(() => {
    const sOpen = storeHours?.open || '09:00';
    const sClose = storeHours?.close || '21:00';
    const blank: ProposedShift = {
      employeeId: '',
      employeeName: 'New Shift',
      profileImageUrl: null,
      startTime: sOpen,
      endTime: sClose,
      shiftBlock: '',
      rationale: '',
      revenue: 0,
    };
    const newIdx = proposedShifts.length; // index this shift will occupy
    setManualShifts(prev => [...prev, blank]);
    setSelectedShiftIdx(newIdx);
    setSelectedUserId('');
    setModalStartTime(sOpen);
    setModalEndTime(sClose);
    setModalTitle('');
    // Clear location to empty so the form doesn't carry a stale default into the new shift —
    // consistent with handleSelectShift, which also clears location on selection.
    setModalLocationId('');
    setModalNotes('');
    setSelectedActualSchedule(null);
    setActualFormEdits(null);
    requestAnimationFrame(() => {
      timelineWrapperRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    });
  }, [storeHours, proposedShifts.length]);

  const dateLabel = modalDate
    ? new Date(modalDate + "T12:00:00Z").toLocaleDateString("en-US", {
        weekday: "long",
        month: "long",
        day: "numeric",
      })
    : "";

  const selectedShift = selectedShiftIdx !== null ? proposedShifts[selectedShiftIdx] : null;
  const isEditingBlock = selectedShiftIdx !== null && selectedShift !== undefined;
  const isActualEditing = selectedActualSchedule !== null;

  const dialogWidthClass =
    dialogSize === 'full'
      ? 'w-[99vw] max-w-none'
      : dialogSize === 'wide'
      ? 'w-[96vw] max-w-[1200px]'
      : 'w-[96vw] max-w-[920px]';

  // Mobile bounds (Task #387 A7): clamp custom dimensions to the current
  // viewport so a power-user resize on desktop doesn't trap the dialog
  // off-screen on mobile after a window-resize. The grip is also hidden
  // below 768px so touch users don't accidentally drag the dialog.
  const isMobile = typeof window !== 'undefined' && window.innerWidth < 768;
  const clampedDims = dialogDims && typeof window !== 'undefined'
    ? {
        width: Math.min(dialogDims.width, Math.round(window.innerWidth * 0.98)),
        height: Math.min(dialogDims.height, Math.round(window.innerHeight * 0.96)),
      }
    : null;

  const dialogStyle: CSSProperties = {
    display: 'flex',
    flexDirection: 'column',
    ...(clampedDims
      ? { width: clampedDims.width, height: clampedDims.height, maxWidth: 'none', maxHeight: 'none' }
      : dialogSize === 'full'
      ? { maxHeight: '98vh', height: '98vh' }
      : { maxHeight: '92vh', height: '92vh' }),
  };

  return (
    <>
    {open && createPortal(
      <>
        {/* Backdrop */}
        <div
          className="fixed inset-0 z-50 bg-black/80"
          onClick={requestClose}
          aria-hidden="true"
        />
        {/* Panel — bottom sheet on mobile, centered dialog on desktop */}
        <div
          role="dialog"
          aria-modal="true"
          aria-label={editingSchedule ? 'Edit Shift' : 'Create Shift'}
          data-dialog-resizable
          className={cn(
            isMobile
              ? "fixed inset-x-0 bottom-0 z-50 bg-background border-t shadow-2xl rounded-t-2xl flex flex-col"
              : cn(dialogWidthClass, "fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50 bg-background border shadow-lg rounded-lg overflow-hidden transition-[width,height] duration-200")
          )}
          style={isMobile ? { maxHeight: '96dvh' } : dialogStyle}
          onPointerMove={handleGripPointerMove}
          onPointerUp={handleGripPointerUp}
          onPointerLeave={handleGripPointerUp}
        >
          {/* Mobile drag handle */}
          {isMobile && (
            <div className="flex justify-center pt-2 pb-1 flex-shrink-0" aria-hidden="true">
              <div className="w-10 h-1.5 rounded-full bg-muted-foreground/30" />
            </div>
          )}
          {/* Close button */}
          <button
            type="button"
            className="absolute right-4 top-4 rounded-sm opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 z-10"
            onClick={requestClose}
          >
            <X className="h-4 w-4" />
            <span className="sr-only">Close</span>
          </button>

          {/* Floating action bar (Task #391 B6) — appears centered at the
              bottom of the panel only when one or more persisted shifts are
              multi-selected. Stays inside the dialog (absolute, not fixed) so
              it doesn't fight a closed/closing panel. Esc clears selection;
              this gives mouse users an equivalent path. */}
          {selectedActualIds.size > 0 && (
            <div
              role="region"
              aria-label="Bulk actions for selected shifts"
              data-testid="multi-select-action-bar"
              className="absolute bottom-4 left-1/2 -translate-x-1/2 z-40 flex items-center gap-2 px-3 py-2 rounded-full bg-foreground text-background shadow-2xl border border-border/30"
            >
              <span className="text-xs font-medium pl-1 pr-1">
                {selectedActualIds.size} shift{selectedActualIds.size === 1 ? "" : "s"} selected
              </span>
              <Button
                size="sm"
                variant="destructive"
                className="h-7 gap-1 text-xs"
                disabled={bulkDeleteActualsMutation.isPending}
                data-testid="bulk-delete-button"
                onClick={() => {
                  // Snapshot the full payloads before delete so the undo path
                  // has everything it needs to recreate them.
                  const payload = (liveActualShifts ?? [])
                    .filter(a => selectedActualIds.has(a.schedule.id))
                    .map(a => a.schedule);
                  if (payload.length === 0) return;
                  bulkDeleteActualsMutation.mutate({ schedules: payload });
                }}
              >
                {bulkDeleteActualsMutation.isPending ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <Trash2 className="h-3 w-3" />
                )}
                Delete
              </Button>
              {/* Move-to (Task #395) — reassigns every selected shift's date
                  while preserving its time-of-day. Sits between Delete and
                  Copy day so the most-common bulk actions cluster from
                  destructive → reorganize → duplicate, mirroring the
                  expected mental escalation. Disabled while a move is
                  in-flight to prevent double-submits. */}
              <Button
                size="sm"
                variant="secondary"
                className="h-7 gap-1 text-xs"
                disabled={!modalDate || bulkMoveActualsMutation.isPending}
                data-testid="bulk-move-button"
                title={`Move ${selectedActualIds.size} selected shift${selectedActualIds.size === 1 ? "" : "s"} to a different date (keeps each shift's time of day)`}
                onClick={() => setShowMoveDayDialog(true)}
              >
                {bulkMoveActualsMutation.isPending ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <CalendarDays className="h-3 w-3" />
                )}
                Move to…
              </Button>
              {/* Copy from the bar mirrors the header "Copy day" button so
                  the bulk-action UX is self-contained: a manager who's
                  already in selection mode can replicate the day to other
                  dates without breaking flow to find the header button.
                  Note: copy-day operates on the full day (not just the
                  selected subset) — that matches the existing endpoint and
                  the most common manager intent. */}
              <Button
                size="sm"
                variant="secondary"
                className="h-7 gap-1 text-xs"
                disabled={!modalDate}
                data-testid="bulk-copy-button"
                title="Copy this whole day's shifts to other dates (not just the selected ones)"
                onClick={() => setShowCopyDayDialog(true)}
              >
                <Copy className="h-3 w-3" />
                Copy day
              </Button>
              <Button
                size="sm"
                variant="secondary"
                className="h-7 text-xs"
                data-testid="clear-selection-button"
                onClick={() => {
                  setSelectedActualIds(new Set());
                  setMultiSelectAnchorId(null);
                }}
              >
                Clear
              </Button>
            </div>
          )}
          {/* Header */}
          <div className="px-5 py-3 border-b flex-shrink-0">
            <h2 className="text-sm font-semibold leading-none tracking-tight flex items-center gap-2">
              <Clock className="h-4 w-4" />
              {editingSchedule ? 'Edit Shift' : 'Create Shift'}
              <button
                type="button"
                onClick={cycleSize}
                title={dialogSize === 'normal' ? 'Expand dialog' : dialogSize === 'wide' ? 'Full width' : 'Shrink dialog'}
                className="ml-auto text-muted-foreground hover:text-foreground transition-colors"
              >
                {dialogSize === 'full' ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
              </button>
            </h2>
          </div>

        {/* Body — on mobile: single natural-scroll container; on desktop: two side-by-side scroll panes */}
        <div className={cn(
          "flex-1 min-h-0",
          isMobile ? "overflow-y-auto flex flex-col" : "overflow-hidden flex flex-col md:flex-row"
        )}>

          {/* ── LEFT PANEL ── */}
          <div className={cn(
            "border-border",
            isMobile
              ? "flex flex-col border-b"
              : "md:w-[55%] border-b md:border-b-0 md:border-r flex flex-col min-h-0"
          )}>
            {/* Left header */}
            <div className="px-4 py-3 border-b border-border/50 flex-shrink-0 flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="text-sm font-semibold text-foreground leading-tight">
                  {dateLabel || "Select a date"}
                </div>
                <div className="text-[11px] text-muted-foreground mt-0.5 flex items-center gap-1">
                  <Sparkles className="h-3 w-3 text-violet-500" />
                  AI Recommended Schedule for today
                </div>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                {/* Collapse toggle — only shown on tablet-width non-mobile dialog layout */}
                {!isMobile && (
                  <button
                    className="md:hidden text-muted-foreground hover:text-foreground"
                    onClick={() => setLeftCollapsed((v) => !v)}
                  >
                    {leftCollapsed ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
                  </button>
                )}
                {/* Add blank shift — always visible so managers can build shifts from scratch.
                    Dashed border subtly signals "create new" affordance distinct from Refresh. */}
                <Button
                  size="sm"
                  variant="outline"
                  className="gap-1 text-xs h-8 border-dashed border-slate-400 dark:border-slate-500 hover:border-orange-400 hover:bg-orange-50 dark:hover:bg-orange-950/30"
                  title="Add a blank shift to the timeline"
                  onClick={handleAddBlankShift}
                >
                  <Plus className="h-3 w-3" />
                  <span className="hidden sm:inline">Add Shift</span>
                </Button>
                {/* Copy this day to other dates (Task #391 B7). Disabled when
                    there are no persisted shifts to copy — copying an empty
                    day is a no-op and would just confuse users. */}
                <Button
                  size="sm"
                  variant="outline"
                  className="gap-1 text-xs h-8"
                  title="Copy this day's shifts to another date"
                  disabled={!modalDate || (liveActualShifts?.length ?? 0) === 0}
                  onClick={() => setShowCopyDayDialog(true)}
                  data-testid="copy-day-button"
                >
                  <Plus className="h-3 w-3 rotate-45" />
                  <span className="hidden sm:inline">Copy day</span>
                </Button>
                {/* Refresh button */}
                <Button
                  size="sm"
                  variant="outline"
                  className="gap-1 text-xs h-8"
                  disabled={suggestFetching || !modalDate || !!editingSchedule}
                  title={
                    editingSchedule
                      ? "AI suggestions are hidden while editing a saved shift"
                      : suggestUpdatedAt
                      ? `Last fetched ${new Date(suggestUpdatedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} — click to refresh`
                      : "Refresh AI suggestions"
                  }
                  onClick={() => {
                    // Defense-in-depth: even though the button is disabled in
                    // editingSchedule mode, this guard ensures a programmatic
                    // click can't trigger an AI suggest fetch (which would be
                    // wasted work — the proposals aren't shown when editing).
                    if (editingSchedule) return;
                    forceRegenRef.current = true;
                    editedShiftsRef.current = {};
                    setEditedShifts({});
                    setUndoStack([]);
                    setRedoStack([]);
                    refetchSuggest();
                  }}
                >
                  <RefreshCw className={cn("h-3 w-3", suggestFetching && "animate-spin")} />
                  {suggestUpdatedAt && !suggestFetching ? (
                    <span className="hidden sm:inline">
                      {new Date(suggestUpdatedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                    </span>
                  ) : null}
                </Button>
              </div>
            </div>

            {/* Left scrollable content — on mobile, natural flow; on desktop, scrollable pane */}
            <div
              className={cn(
                "px-4 py-3 space-y-4",
                isMobile ? "" : "flex-1 overflow-y-auto",
                !isMobile && leftCollapsed && "hidden md:block"
              )}
              onClick={() => setSelectedShiftIdx(null)}
            >
              {/* Data source banner — shows which sales data Claude used to
                  build the proposed shifts (real Shopify orders / estimated /
                  synthetic) plus the historical date. Auto-suppressed in
                  editing mode via effectiveSuggestData and for manual-only
                  sources where no AI rationale exists. */}
              <DataSourceBanner
                dataSource={effectiveSuggestData?.dataSource}
                historicalDate={effectiveSuggestData?.historicalDate}
              />

              {/* Conflict warning */}
              {conflictCount > 0 && (
                <div className="flex items-start gap-2 text-xs text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg px-3 py-2">
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                  <span>
                    <span className="font-semibold">{conflictCount} suggested shift{conflictCount !== 1 ? "s" : ""}</span>
                    {" "}conflict with shifts already scheduled on this day. Approving will create duplicate shifts for those employees.
                  </span>
                </div>
              )}

              {/* Sales chart */}
              <SalesChart
                data={salesData}
                isLoading={salesLoading && !!modalDate}
              />

              {/* Divider */}
              <div className="border-t border-border/40" />

              {/* External-change banner (Task #387 A4 panel-side) — appears when
                  another tab/user creates/updates/deletes shifts for the open day
                  via the bulk routes. Refresh CTA re-pulls server data, then the
                  notice clears. */}
              {externalChangeNotice && (
                <div
                  className="rounded-lg border border-sky-300 dark:border-sky-800 bg-sky-50 dark:bg-sky-950/30 px-3 py-2 flex items-center justify-between gap-3"
                  data-testid="external-change-banner"
                >
                  <span className="flex items-center gap-2 text-xs text-sky-800 dark:text-sky-200">
                    <RefreshCw className="h-3.5 w-3.5" />
                    Schedule changed elsewhere — pulled new data is available.
                  </span>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-7 text-xs gap-1.5"
                    data-testid="external-change-refresh"
                    onClick={async () => {
                      await Promise.all([
                        queryClient.refetchQueries({ queryKey: ['/api/schedules'], type: 'active' }),
                        queryClient.refetchQueries({ queryKey: ['/api/schedules/suggest'], type: 'active' }),
                        queryClient.refetchQueries({ queryKey: ['/api/schedules/today-availability'], type: 'active' }),
                      ]);
                      setExternalChangeNotice(false);
                    }}
                  >
                    <RefreshCw className="h-3 w-3" />
                    Refresh
                  </Button>
                </div>
              )}

              {/* Closed-store handling (Task #387 A5) ──
                  When there's nothing in the timeline yet AND the store is
                  closed, replace the timeline with a dedicated empty state +
                  two clear escape hatches: jump to a different date, or add
                  a shift anyway (the right-panel form remains available). */}
              {availData?.storeHours?.isClosed && validActiveShifts.length === 0 && manualShifts.length === 0 ? (
                <div
                  className="rounded-lg border-2 border-dashed border-amber-300 dark:border-amber-800 bg-amber-50/60 dark:bg-amber-950/20 px-4 py-8 flex flex-col items-center text-center gap-3"
                  data-testid="closed-store-empty-state"
                >
                  <div className="h-10 w-10 rounded-full bg-amber-100 dark:bg-amber-900/40 flex items-center justify-center">
                    <Store className="h-5 w-5 text-amber-600 dark:text-amber-400" />
                  </div>
                  <div className="space-y-1 max-w-sm">
                    <p className="text-sm font-semibold text-amber-900 dark:text-amber-100">
                      The store is closed on this day
                    </p>
                    <p className="text-xs text-amber-800/80 dark:text-amber-200/80 leading-relaxed">
                      We can't suggest shifts because operating hours are off. Pick a different date,
                      or add a shift anyway — it'll be flagged as outside hours when saved.
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2 justify-center pt-1">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="h-8 gap-1.5 text-xs"
                      data-testid="closed-store-pick-date"
                      onClick={() => {
                        // Focus the Date input on the right panel so the user can
                        // immediately type/pick a different day without hunting.
                        const el = document.querySelector<HTMLInputElement>('input[name="startDate"]');
                        el?.focus();
                        el?.showPicker?.();
                      }}
                    >
                      Pick a different date
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      className="h-8 gap-1.5 text-xs"
                      data-testid="closed-store-add-anyway"
                      onClick={() => onAddNewShift?.()}
                    >
                      <Plus className="h-3 w-3" />
                      Add shift anyway
                    </Button>
                  </div>
                </div>
              ) : (
                <>
                  {/* Compact closed-store banner above timeline when there is content */}
                  {availData?.storeHours?.isClosed && (
                    <div
                      className="rounded-lg border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30 px-3 py-2.5 flex items-start gap-2"
                      data-testid="closed-store-banner"
                    >
                      <Store className="h-4 w-4 text-amber-600 dark:text-amber-400 mt-0.5 shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-semibold text-amber-800 dark:text-amber-200 leading-tight">
                          Store is closed on this day
                        </p>
                        <p className="text-[11px] text-amber-700/90 dark:text-amber-300/90 leading-snug mt-0.5">
                          You're scheduling outside operating hours — saves will be flagged.
                        </p>
                      </div>
                    </div>
                  )}

                  {/* Day-view timeline — actual scheduled shifts + AI suggestions unified */}
                  {/* stop bubble so empty-space clicks on the scrollable area deselect  */}
                  {/* while block clicks don't.                                          */}
                  <div ref={timelineWrapperRef} onClick={(e) => e.stopPropagation()}>
                    <DayTimeline
                      suggestData={mergedSuggestData}
                      isLoading={suggestLoading && !!modalDate}
                      isError={suggestError}
                      errorMsg={suggestError ? (suggestErrorObj as Error)?.message : undefined}
                      storeHours={storeHours}
                      selectedIdx={selectedShiftIdx}
                      onSelectShift={handleSelectShift}
                      excludedIdxs={excludedIdxs}
                      onToggleExclude={handleToggleExclude}
                      conflictingEmployeeIds={conflictingEmployeeIds}
                      onShiftEdit={handleShiftEdit}
                      onDragStart={handleDragStart}
                      onDragEnd={handleDragEnd}
                      actualShifts={liveActualShifts}
                      onSelectActualShift={handleSelectActualShift}
                      selectedActualId={selectedActualSchedule?.id}
                      multiSelectedActualIds={selectedActualIds}
                      onActualShiftChange={handleActualShiftChange}
                      onDeleteActualShift={(s) => deleteActualMutation.mutate({ schedule: s })}
                      aiCount={aiProposedShifts.length}
                      pillDrag={pillDrag}
                      aiGhostCandidates={aiGhostCandidates}
                      onApplyAiGhost={(c) => {
                        const member = (availData?.members ?? []).find((m) => m.userId === c.employeeId);
                        if (!member) return;
                        // Re-use the pill-drop persistence path with an explicit range so
                        // the candidate's exact start/end times are honored (no snapping
                        // and no 4-hour default duration).
                        const body = document.querySelector('[data-timeline-body="true"]') as HTMLElement | null;
                        const rect = body ? body.getBoundingClientRect() : new DOMRect(0, 0, 0, 0);
                        handlePillDrop(member, 0, rect, { start: c.startTime, end: c.endTime });
                      }}
                      scheduledEmployeeIds={scheduledForAiGhost}
                    />
                  </div>
                </>
              )}

              {/* Who's Available — collapsible accordion (closed by default on mobile) */}
              {!!modalDate && (
                <>
                  <div className="border-t border-border/40" />
                  <Collapsible open={showPillsOpen} onOpenChange={setShowPillsOpen}>
                    <CollapsibleTrigger asChild>
                      <button className="w-full flex items-center justify-between px-0.5 py-1 group text-left">
                        <span className="text-[11px] font-medium text-muted-foreground flex items-center gap-1">
                          <Users className="h-3 w-3" />
                          Who's Available
                          {(availData?.members ?? []).filter(m => m.isAvailable).length > 0 && (
                            <span className="ml-1 text-foreground font-semibold">
                              ({(availData?.members ?? []).filter(m => m.isAvailable).length})
                            </span>
                          )}
                        </span>
                        {showPillsOpen
                          ? <ChevronUp className="h-3.5 w-3.5 text-muted-foreground group-hover:text-foreground transition-colors" />
                          : <ChevronDown className="h-3.5 w-3.5 text-muted-foreground group-hover:text-foreground transition-colors" />
                        }
                      </button>
                    </CollapsibleTrigger>
                    <CollapsibleContent>
                      <AvailableEmployeePills
                        members={availData?.members ?? []}
                        storeHours={availData?.storeHours ?? storeHours}
                        isLoading={availLoading && !availData}
                        scheduledEmployeeIds={scheduledForPills}
                        onAdd={handlePillAdd}
                        showUnavailable={showPillsUnavailable}
                        onToggleUnavailable={() => setShowPillsUnavailable(v => !v)}
                        dateKey={modalDate}
                        onPillDragStart={startPillDrag}
                      />
                    </CollapsibleContent>
                  </Collapsible>
                </>
              )}
            </div>
          </div>

          {/* ── RIGHT PANEL ── */}
          <div className={cn(
            "flex flex-col",
            isMobile ? "" : "md:w-[45%] min-h-0 overflow-y-auto"
          )}>
            {/* Edit mode banner when an AI block or actual shift is selected */}
            {(isEditingBlock || isActualEditing) && (
              <div className="px-4 pt-3 pb-0 flex-shrink-0">
                <div className={cn(
                  "flex items-center justify-between rounded-lg border px-3 py-2",
                  isActualEditing
                    ? "border-orange-400/40 bg-orange-50 dark:bg-orange-900/20"
                    : "border-primary/30 bg-primary/5"
                )}>
                  <span className={cn(
                    "text-xs font-medium flex items-center gap-1.5",
                    isActualEditing ? "text-orange-600 dark:text-orange-400" : "text-primary"
                  )}>
                    <Pencil className="h-3 w-3" />
                    {isActualEditing
                      ? `Editing ${employees.find(e => e.id === (actualFormEdits?.userId ?? selectedActualSchedule?.userId))?.firstName ?? ''}'s scheduled shift`
                      : `Editing ${selectedShift!.employeeName}'s shift`}
                  </span>
                  <button
                    onClick={() => {
                      if (isActualEditing) {
                        setSelectedActualSchedule(null);
                        setActualFormEdits(null);
                      } else {
                        setSelectedShiftIdx(null);
                      }
                    }}
                    className="text-muted-foreground hover:text-foreground"
                    title="Cancel edit"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            )}

            {/* Undo / Redo controls — shown when there are undoable drag edits */}
            {undoStack.length > 0 && (
              <div className="px-4 pt-2 pb-0 flex-shrink-0 flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={handleUndo}
                  disabled={undoStack.length === 0}
                  title="Undo last drag edit (Ctrl+Z)"
                  className="flex items-center gap-1 rounded px-2 py-1 text-[11px] font-medium text-muted-foreground hover:text-foreground hover:bg-muted/60 disabled:opacity-40 disabled:pointer-events-none transition-colors"
                >
                  <Undo2 className="h-3 w-3" />
                  Undo
                </button>
                <button
                  type="button"
                  onClick={handleRedo}
                  disabled={redoStack.length === 0}
                  title="Redo (Ctrl+Y)"
                  className="flex items-center gap-1 rounded px-2 py-1 text-[11px] font-medium text-muted-foreground hover:text-foreground hover:bg-muted/60 disabled:opacity-40 disabled:pointer-events-none transition-colors"
                >
                  <Redo2 className="h-3 w-3" />
                  Redo
                </button>
                <span className="text-[10px] text-muted-foreground/60 ml-1">{undoStack.length} step{undoStack.length !== 1 ? 's' : ''}</span>
              </div>
            )}

            <form
              onSubmit={(e) => {
                // Decision-point trace (Task #420). Captures which of the
                // three save handlers the form actually dispatched, plus
                // the state flags that decided the routing — so a "wrong
                // handler ran" failure mode is visible from the console.
                const handlerName = isEditingBlock
                  ? "handleSaveShiftEdit"
                  : isActualEditing
                    ? "handleSaveActual"
                    : "handleSubmit";
                dlog("form/onSubmit", {
                  handler: handlerName,
                  isEditingBlock,
                  isActualEditing,
                  selectedShiftIdx,
                  selectedActualScheduleId: selectedActualSchedule?.id ?? null,
                  hasEditingSchedule: !!editingSchedule,
                  editingScheduleId: editingSchedule?.id ?? null,
                  hasOnUpdateSchedule: !!onUpdateSchedule,
                  manualShiftCount: manualShifts.length,
                });
                if (isEditingBlock) { e.preventDefault(); handleSaveShiftEdit(); }
                else if (isActualEditing) { e.preventDefault(); handleSaveActual(); }
                else handleSubmit(e);
              }}
              className="px-4 py-3 space-y-3 flex-1"
            >
              {/* Availability filter toggle */}
              <div className="flex items-center justify-between rounded-lg border bg-muted/30 px-3 py-2">
                <div className="flex items-center gap-2">
                  <Users className="h-3.5 w-3.5 text-muted-foreground" />
                  <span className="text-xs text-muted-foreground">
                    Show available only
                    {filterByAvailability && (
                      <span
                        className={`ml-1 font-medium ${
                          modalEmployees.length === 0
                            ? "text-red-500"
                            : "text-emerald-600 dark:text-emerald-400"
                        }`}
                      >
                        ({modalEmployees.length} of {employees.length})
                      </span>
                    )}
                  </span>
                </div>
                <Switch
                  checked={filterByAvailability}
                  onCheckedChange={onFilterChange}
                  className="scale-90"
                />
              </div>

              <div>
                <Label className="text-xs">Employee</Label>
                <Select
                  name="userId"
                  value={selectedUserId}
                  onValueChange={(v) => {
                    setSelectedUserId(v);
                    setFormDirty(true);
                    if (isEditingBlock) {
                      const emp = employees.find((e) => e.id === v);
                      const empName = emp ? `${emp.firstName ?? ""} ${emp.lastName ?? ""}`.trim() : "";
                      handleShiftEdit(selectedShiftIdx!, { employeeId: v, employeeName: empName });
                    } else if (isActualEditing) {
                      setActualFormEdits(prev => prev ? { ...prev, userId: v } : { startTime: modalStartTime, endTime: modalEndTime, userId: v });
                    }
                  }}
                  required={!editingSchedule && !isActualEditing}
                >
                  <SelectTrigger className="h-8">
                    <SelectValue
                      placeholder={
                        modalEmployees.length === 0
                          ? "No available employees"
                          : "Select employee"
                      }
                    />
                  </SelectTrigger>
                  <SelectContent>
                    {(() => {
                      // When editing a saved shift, always include the currently-assigned
                      // employee even if the availability filter would hide them.
                      const base = filterByAvailability ? modalEmployees : employees;
                      const list =
                        editingSchedule && selectedUserId && !base.some((e) => e.id === selectedUserId)
                          ? [...base, ...employees.filter((e) => e.id === selectedUserId)]
                          : base;
                      if (list.length === 0) {
                        return (
                          <div className="py-2 px-3 text-xs text-muted-foreground">
                            No employees with availability. Turn off the filter to see all.
                          </div>
                        );
                      }
                      return list.map((user) => {
                        const hasConflict =
                          dropdownConflictingEmployeeIds.has(user.id) &&
                          user.id !== selectedUserId;
                        return (
                          <SelectItem
                            key={user.id}
                            value={user.id}
                            disabled={hasConflict}
                            data-testid={
                              hasConflict
                                ? `select-employee-conflict-${user.id}`
                                : undefined
                            }
                          >
                            <span className="flex items-center justify-between gap-2 w-full">
                              <span
                                className={
                                  hasConflict ? "text-muted-foreground" : ""
                                }
                              >
                                {user.firstName} {user.lastName}
                              </span>
                              {hasConflict && (
                                <span className="text-[10px] text-amber-600 dark:text-amber-400 font-medium ml-2 shrink-0">
                                  already scheduled
                                </span>
                              )}
                            </span>
                          </SelectItem>
                        );
                      });
                    })()}
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label className="text-xs">Date</Label>
                <Input
                  name="startDate"
                  type="date"
                  className="h-8 text-sm"
                  required
                  value={modalDate}
                  onChange={(e) => {
                    setModalDate(e.target.value);
                    setFormDirty(true);
                    setSelectedShiftIdx(null);
                    setExcludedIdxs(new Set());
                    setSelectedActualSchedule(null);
                    setActualFormEdits(null);
                    setManualShifts([]);
                    onDateChange?.(e.target.value);
                  }}
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label className="text-xs">Start Time</Label>
                  <Input
                    name="startTime"
                    type="time"
                    className="h-8 text-sm"
                    required
                    value={modalStartTime}
                    onChange={(e) => {
                      setModalStartTime(e.target.value);
                      setFormDirty(true);
                      if (isEditingBlock) {
                        handleShiftEdit(selectedShiftIdx!, { startTime: e.target.value });
                      } else if (isActualEditing) {
                        setActualFormEdits(prev => prev ? { ...prev, startTime: e.target.value } : { startTime: e.target.value, endTime: modalEndTime, userId: selectedUserId });
                      }
                    }}
                  />
                </div>
                <div>
                  <Label className="text-xs">End Time</Label>
                  <Input
                    name="endTime"
                    type="time"
                    className="h-8 text-sm"
                    required
                    value={modalEndTime}
                    onChange={(e) => {
                      setModalEndTime(e.target.value);
                      setFormDirty(true);
                      if (isEditingBlock) {
                        handleShiftEdit(selectedShiftIdx!, { endTime: e.target.value });
                      } else if (isActualEditing) {
                        setActualFormEdits(prev => prev ? { ...prev, endTime: e.target.value } : { startTime: modalStartTime, endTime: e.target.value, userId: selectedUserId });
                      }
                    }}
                  />
                </div>
              </div>

              <div>
                <Label className="text-xs">Role/Title (optional)</Label>
                <Input
                  name="title"
                  className="h-8 text-sm"
                  placeholder="e.g., Opener, Closer"
                  value={modalTitle}
                  onChange={(e) => { setModalTitle(e.target.value); setFormDirty(true); }}
                />
              </div>

              <div>
                <Label className="text-xs">Location</Label>
                <Select
                  name="locationId"
                  value={modalLocationId}
                  onValueChange={(v) => { setModalLocationId(v); setFormDirty(true); }}
                >
                  <SelectTrigger className="h-8">
                    <SelectValue placeholder="Select location (optional)" />
                  </SelectTrigger>
                  <SelectContent>
                    {locations.map((loc) => (
                      <SelectItem key={loc.id} value={loc.id}>
                        {loc.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label className="text-xs">Notes</Label>
                <Textarea
                  name="description"
                  className="text-sm"
                  placeholder="Optional notes..."
                  rows={2}
                  value={modalNotes}
                  onChange={(e) => { setModalNotes(e.target.value); setFormDirty(true); }}
                />
              </div>

              {/* AI Auto-Assign — only when creating new shifts, not when editing a saved one */}
              {!isEditingBlock && !editingSchedule && (
                <div className="rounded-lg border border-primary/20 bg-primary/5 px-3 py-2.5 space-y-2">
                  <p className="text-[11px] font-medium text-primary flex items-center gap-1.5">
                    <Wand2 className="h-3 w-3" />
                    AI Auto-Assign
                  </p>
                  <p className="text-[10px] text-muted-foreground leading-relaxed">
                    Automatically fill the needed staffing slots for this day using
                    top-scored available employees.
                  </p>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="w-full border-primary/30 text-primary hover:bg-primary/10 gap-1.5 text-xs"
                    disabled={autoAssignMutation.isPending || !modalDate}
                    onClick={() =>
                      autoAssignMutation.mutate({
                        date: modalDate,
                        startTime: modalStartTime,
                        endTime: modalEndTime,
                      })
                    }
                  >
                    {autoAssignMutation.isPending ? (
                      <><Loader2 className="h-3 w-3 animate-spin" />Assigning…</>
                    ) : (
                      <><Wand2 className="h-3 w-3" />Auto-Assign Shifts</>
                    )}
                  </Button>
                </div>
              )}

              {/* ── Live margin meter (Task #387 C4) ──
                  Sums labor cost across the currently valid pending shifts and
                  shows projected labor % vs revenue. Cost uses per-user
                  hourlyRate from today-availability, falling back to
                  role.defaultHourlyRate, then to $15/hr. Tier coloring is
                  computed by the helper: green ≤ 25%, amber ≤ 30%, red above.
                  Tooltip explains the threshold and any fallback rates. */}
              {validActiveShifts.length > 0 && (() => {
                const members = (availData?.members ?? []) as AvailMember[];
                const byUser: Record<string, number | null> = {};
                const userRoleId: Record<string, string | null> = {};
                for (const m of members) {
                  byUser[m.userId] = m.hourlyRate ?? null;
                  userRoleId[m.userId] = m.roleId ?? null;
                }
                const byRoleDefault: Record<string, number | null> = {};
                for (const r of rolesList) {
                  const raw = r.defaultHourlyRate;
                  const parsed = typeof raw === 'string' ? parseFloat(raw) : (typeof raw === 'number' ? raw : null);
                  byRoleDefault[r.id] = (parsed != null && Number.isFinite(parsed) && parsed > 0) ? parsed : null;
                }
                const projectedRevenue = salesData?.dailyTotal ?? null;
                const margin = computeMargin(
                  validActiveShifts.map(s => ({
                    employeeId: s.employeeId,
                    startTime: s.startTime,
                    endTime: s.endTime,
                  })),
                  { byUser, userRoleId, byRoleDefault, fallback: 15, projectedRevenue },
                );
                const usedFallback = margin.perShift.some(p => p.rateSource === 'fallback');
                const fmt = (n: number) => `$${n.toFixed(0)}`;
                const tierClasses: Record<string, string> = {
                  green: 'border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-300',
                  amber: 'border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-300',
                  red:   'border-rose-300 bg-rose-50 text-rose-800 dark:border-rose-800 dark:bg-rose-950/30 dark:text-rose-300',
                  unknown: 'border-border bg-muted/40 text-foreground',
                };
                const tierLabel: Record<string, string> = {
                  green: 'Healthy margin',
                  amber: 'Tight margin',
                  red: 'Negative / low margin',
                  unknown: '',
                };
                const tipParts: string[] = [];
                if (margin.tier !== 'unknown') {
                  tipParts.push(`Margin = (revenue − labor) / revenue. Green ≥ 35%, amber 20–35%, red < 20%.`);
                  tipParts.push(`Projected revenue: ${fmt(projectedRevenue ?? 0)}.`);
                }
                if (usedFallback) tipParts.push('Some employees have no hourly rate set — using $15/hr fallback.');
                return (
                  <div
                    data-testid="margin-meter"
                    className={cn(
                      'rounded-md border px-3 py-2 flex items-center justify-between gap-3 text-xs transition-colors',
                      tierClasses[margin.tier],
                    )}
                    title={tipParts.join(' ') || undefined}
                  >
                    <span className="flex items-center gap-1.5">
                      <DollarSign className="h-3.5 w-3.5" />
                      Estimated labor
                      {usedFallback && (
                        <span className="text-[10px] font-medium opacity-80">(est.)</span>
                      )}
                      {margin.tier !== 'unknown' && (
                        <span
                          className="text-[10px] font-semibold uppercase tracking-wide opacity-90"
                          data-testid="margin-meter-tier"
                        >
                          · {tierLabel[margin.tier]}
                        </span>
                      )}
                    </span>
                    <span className="font-mono font-semibold tabular-nums">
                      {fmt(margin.totalCost)}
                      <span className="font-normal opacity-80 ml-1">· {margin.totalHours.toFixed(1)}h</span>
                      {margin.marginPct !== null && (
                        <span
                          className="ml-2 font-semibold"
                          data-testid="margin-meter-pct"
                          aria-label={`Margin ${margin.marginPct.toFixed(1)} percent`}
                        >
                          {margin.marginPct.toFixed(1)}% margin
                        </span>
                      )}
                    </span>
                  </div>
                );
              })()}

              <div className="flex justify-between gap-2 pt-1 pb-2">
                {/* Delete button — actual shift or existing saved schedule */}
                {isActualEditing ? (
                  <Button
                    type="button"
                    variant="destructive"
                    size="sm"
                    disabled={deleteActualMutation.isPending}
                    onClick={() => deleteActualMutation.mutate({ schedule: selectedActualSchedule! })}
                    className="gap-1.5"
                  >
                    {deleteActualMutation.isPending ? (
                      <><Loader2 className="h-3 w-3 animate-spin" />Deleting…</>
                    ) : (
                      <><Trash2 className="h-3 w-3" />Delete</>
                    )}
                  </Button>
                ) : editingSchedule && onDeleteSchedule ? (
                  <Button
                    type="button"
                    variant="destructive"
                    size="sm"
                    disabled={localDeletePending && isDeleting}
                    onClick={() => setPendingDeleteConfirm(true)}
                    className="gap-1.5"
                    data-testid="edit-shift-delete"
                  >
                    {localDeletePending && isDeleting ? (
                      <><Loader2 className="h-3 w-3 animate-spin" />Deleting…</>
                    ) : (
                      <><Trash2 className="h-3 w-3" />Delete</>
                    )}
                  </Button>
                ) : <div />}

                <div className="flex gap-2 flex-wrap">
                  {/* Cancel / Deselect */}
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      if (isEditingBlock) setSelectedShiftIdx(null);
                      else if (isActualEditing) { setSelectedActualSchedule(null); setActualFormEdits(null); }
                      else requestClose();
                    }}
                  >
                    {(isEditingBlock || isActualEditing) ? "Deselect" : "Cancel"}
                  </Button>

                  {/* Per-card "Save Changes" — secondary, shown while editing a specific card or the editingSchedule shift */}
                  {isEditingBlock ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={saveShiftMutation.isPending}
                      onClick={handleSaveShiftEdit}
                      className={cn(
                        "gap-1.5 transition-all",
                        shiftSaved && "border-green-600 text-green-700 dark:text-green-400 hover:bg-green-50 dark:hover:bg-green-900/20 scale-[1.03] shadow-sm"
                      )}
                    >
                      {saveShiftMutation.isPending ? (
                        <><Loader2 className="h-3 w-3 animate-spin" />Saving…</>
                      ) : shiftSaved ? (
                        <><Check className="h-3 w-3" />Saved ✓</>
                      ) : (
                        <><Save className="h-3 w-3" />Save Changes</>
                      )}
                    </Button>
                  ) : isActualEditing ? (
                    <>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={updateActualMutation.isPending}
                        onClick={() => handleSaveActual(false)}
                        className="gap-1.5"
                      >
                        {updateActualMutation.isPending ? (
                          <><Loader2 className="h-3 w-3 animate-spin" />Saving…</>
                        ) : (
                          <><Save className="h-3 w-3" />Save Changes</>
                        )}
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        disabled={updateActualMutation.isPending}
                        onClick={() => handleSaveActual(true)}
                        className="gap-1.5 bg-orange-500 hover:bg-orange-600 text-white font-semibold shadow-md"
                        title="Save changes and close this panel"
                      >
                        {updateActualMutation.isPending ? (
                          <><Loader2 className="h-3 w-3 animate-spin" />Saving…</>
                        ) : (
                          <><Check className="h-3 w-3" />Save &amp; Close</>
                        )}
                      </Button>
                    </>
                  ) : editingSchedule ? (
                    <Button type="submit" size="sm" variant="outline" disabled={isUpdating} className="gap-1.5">
                      {isUpdating ? (
                        <><Loader2 className="h-3 w-3 animate-spin" />Saving…</>
                      ) : (
                        <><Save className="h-3 w-3" />Save Changes</>
                      )}
                    </Button>
                  ) : null}

                  {/* Primary bulk-save CTA — always rightmost whenever the timeline has any active shifts,
                      across both create and edit modes. Blank/unassigned draft shifts show in the count
                      but are filtered out at submission; a toast explains any skipped shifts.
                      HIDDEN in editingSchedule mode: when the panel is opened to edit a single
                      existing shift, the user's intent is to save THAT shift — not to bulk-create
                      AI proposals. Showing the orange "Save N New Shifts" CTA next to "Save Changes"
                      caused users to accidentally create the AI proposals as real shifts on every
                      Edit Shift cycle (the "+N shifts on every reopen" bug). */}
                  {!editingSchedule && activeShifts.length > 0 ? (
                    <Button
                      type="button"
                      size="sm"
                      className={cn(
                        "gap-1.5 text-white font-semibold shadow-md transition-all",
                        validActiveShifts.length === 0
                          ? "bg-slate-400 hover:bg-slate-500 shadow-none font-normal"
                          : conflictCount > 0
                          ? "bg-amber-500 hover:bg-amber-600 hover:shadow-lg"
                          : "bg-orange-500 hover:bg-orange-600 hover:shadow-lg"
                      )}
                      disabled={approveMutation.isPending || suggestLoading}
                      onClick={handleBulkSave}
                      title={
                        validActiveShifts.length === 0
                          ? "Select an employee for each shift before saving"
                          : conflictCount > 0
                          ? `${conflictCount} shift${conflictCount !== 1 ? "s" : ""} conflict with existing schedules`
                          : dateActualShifts.length > 0
                          ? `${dateActualShifts.length} shift${dateActualShifts.length !== 1 ? "s are" : " is"} already scheduled on this day. ${validActiveShifts.length} new shift${validActiveShifts.length !== 1 ? "s" : ""} will be added.`
                          : `Add ${validActiveShifts.length} shift${validActiveShifts.length !== 1 ? "s" : ""} to the schedule`
                      }
                    >
                      {approveMutation.isPending ? (
                        <><Loader2 className="h-3 w-3 animate-spin" />Saving…</>
                      ) : validActiveShifts.length === 0 ? (
                        <>Assign employees to save</>
                      ) : conflictCount > 0 ? (
                        <><AlertTriangle className="h-3 w-3" />Save {activeShifts.length} New Shift{activeShifts.length !== 1 ? "s" : ""} · {conflictCount} conflict{conflictCount !== 1 ? "s" : ""}</>
                      ) : (
                        <><Check className="h-3 w-3" />Save {activeShifts.length} New Shift{activeShifts.length !== 1 ? "s" : ""} to Schedule</>
                      )}
                    </Button>
                  ) : !editingSchedule && !isActualEditing ? (
                    /* No active timeline shifts and not in edit context — offer single-shift create */
                    <Button type="submit" size="sm" disabled={isCreating}>
                      {isCreating ? "Creating..." : "Create Shift"}
                    </Button>
                  ) : null}
                </div>
              </div>
            </form>
          </div>
        </div>

        {/* ── Resize grip (bottom-right corner) ──
            Hidden below 768px (mobile) so touch users can't accidentally
            drag the panel into a non-recoverable position. Task #387 A7. */}
        {!isMobile && (
        <div
          title="Drag to resize"
          className="absolute bottom-1 right-1 w-5 h-5 cursor-nwse-resize z-50 flex items-end justify-end p-0.5 opacity-30 hover:opacity-70 transition-opacity select-none hidden md:flex"
          onPointerDown={handleGripPointerDown}
        >
          <svg viewBox="0 0 10 10" className="w-3.5 h-3.5 text-muted-foreground fill-current">
            <rect x="6" y="0" width="2" height="10" rx="1" />
            <rect x="0" y="6" width="10" height="2" rx="1" />
          </svg>
        </div>
        )}
        </div>

        {/* ── Keyboard shortcut cheat-sheet (toggled with `?`) ── */}
        {showShortcutOverlay && (
          <div
            className="fixed inset-0 z-[60] flex items-center justify-center p-4"
            onClick={() => setShowShortcutOverlay(false)}
          >
            <div className="absolute inset-0 bg-black/60" aria-hidden="true" />
            <div
              role="dialog"
              aria-label="Keyboard shortcuts"
              className="relative bg-background border rounded-lg shadow-2xl w-full max-w-md p-5"
              onClick={(e) => e.stopPropagation()}
              data-testid="shortcut-cheat-sheet"
            >
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold flex items-center gap-2">
                  <Keyboard className="h-4 w-4" />
                  Keyboard shortcuts
                </h3>
                <button
                  type="button"
                  onClick={() => setShowShortcutOverlay(false)}
                  className="text-muted-foreground hover:text-foreground"
                  aria-label="Close shortcuts"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              <ul className="text-xs space-y-1.5">
                {[
                  ['?  or  /', 'Show / hide this cheat-sheet'],
                  ['Esc', 'Close panel (confirm if unsaved)'],
                  ['Ctrl/⌘ + Z', 'Undo last change'],
                  ['Ctrl/⌘ + ⇧ + Z', 'Redo'],
                  ['Ctrl/⌘ + S', 'Save all pending shifts'],
                ].map(([k, v]) => (
                  <li key={k} className="flex justify-between gap-3">
                    <kbd className="font-mono bg-muted px-1.5 py-0.5 rounded text-[10px]">{k}</kbd>
                    <span className="text-muted-foreground">{v}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}
      </>,
      document.body
    )}

    {/* Copy-day picker dialog (Task #391 B7) — only mounted when invoked so
        the preview query doesn't fire on every panel open. `modalDate` is the
        currently-displayed date in YYYY-MM-DD form; if it's null the button
        that opens this dialog is also disabled, so passing null is defensive. */}
    <CopyDayDialog
      open={showCopyDayDialog}
      onOpenChange={setShowCopyDayDialog}
      sourceDate={modalDate}
    />

    {/* Move-to-date dialog (Task #395). Only mounted when triggered so its
        local state resets cleanly between invocations. The mutation lives
        on the panel itself; this dialog is a thin date picker that hands
        the chosen target date back to the parent for the actual call. */}
    <MoveToDateDialog
      open={showMoveDayDialog}
      onOpenChange={setShowMoveDayDialog}
      sourceDate={modalDate}
      count={selectedActualIds.size}
      isMoving={bulkMoveActualsMutation.isPending}
      onConfirm={(targetDate) => {
        if (!modalDate || !targetDate) return;
        // Compute whole-day delta in minutes. Parsing both strings as UTC
        // midnight avoids any DST-driven off-by-one in the diff itself; the
        // subsequent server-side timestamp shift is symmetric for ±N days.
        const sourceMs = new Date(modalDate + "T00:00:00Z").getTime();
        const targetMs = new Date(targetDate + "T00:00:00Z").getTime();
        const deltaMin = Math.round((targetMs - sourceMs) / 60000);
        if (deltaMin === 0) return;
        const ids = Array.from(selectedActualIds);
        if (ids.length === 0) return;
        bulkMoveActualsMutation.mutate({ ids, deltaMin, targetDate });
      }}
    />

    {/* ── Unsaved-changes confirmation (Task #387 A1) ──
        Three explicit choices: Save (the safe default), Discard (destructive,
        styled as such), and Keep editing (cancel the close). The Save action
        only enables when there are valid shifts to persist; otherwise the
        user can still Discard or Keep editing. */}
    <AlertDialog open={pendingCloseConfirm} onOpenChange={setPendingCloseConfirm}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-amber-500" />
            Save changes before closing?
          </AlertDialogTitle>
          <AlertDialogDescription>
            You have shifts or edits in this panel that haven't been saved to the schedule yet.
            Choose what to do.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter className="gap-2 sm:gap-2">
          <AlertDialogCancel
            onClick={() => setPendingCloseConfirm(false)}
            data-testid="close-confirm-keep-editing"
          >
            Keep editing
          </AlertDialogCancel>
          <Button
            type="button"
            variant="outline"
            className="border-destructive text-destructive hover:bg-destructive/10"
            onClick={() => {
              setPendingCloseConfirm(false);
              if (draftUserId && modalDate) clearDraft(draftStoreId, modalDate, draftUserId);
              onOpenChange(false);
            }}
            data-testid="close-confirm-discard"
          >
            Discard
          </Button>
          <AlertDialogAction
            disabled={approveMutation.isPending || updateActualMutation.isPending || isUpdating}
            onClick={() => {
              setPendingCloseConfirm(false);
              // In editingSchedule mode, "Save & close" must save the
              // single-shift edit via the parent's update mutation —
              // NOT call handleBulkSave, which would create the AI
              // proposed shifts as brand-new schedule rows on every
              // close (the "+1 shift on every reopen" bug).
              if (editingSchedule && onUpdateSchedule) {
                dlog("closeConfirm/saveEditingSchedule", { id: editingSchedule.id });
                handleEditingScheduleSave();
                // Parent's onSuccess closes the panel via setShowCreateShift(false).
              } else if (isActualEditing && selectedActualSchedule) {
                dlog("closeConfirm/saveActualAndClose", { id: selectedActualSchedule.id });
                handleSaveActual(true);
              } else if (validActiveShifts.length > 0) {
                dlog("closeConfirm/bulkSave", { count: validActiveShifts.length });
                handleBulkSave();
              } else {
                onOpenChange(false);
              }
            }}
            data-testid="close-confirm-save"
          >
            {approveMutation.isPending || updateActualMutation.isPending || isUpdating ? (
              <><Loader2 className="h-3 w-3 mr-1.5 animate-spin" />Saving…</>
            ) : (editingSchedule || isActualEditing) ? 'Save & close' : validActiveShifts.length > 0 ? 'Save & close' : 'Keep draft & close'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>

    {/* Reassignment-overlap confirmation (Task #707).
        Triggered before the PATCH is fired when the destination employee
        already has another shift overlapping the new time window. Two
        explicit choices: Cancel (keep editing — the panel stays open with
        the user's pending changes intact) and View conflict (close this
        edit and open the conflicting shift so the manager can resolve it
        directly). Details are pre-computed from the conflict state so the
        JSX stays flat — no IIFEs, no conditional rendering scattered
        through the body. */}
    {(() => {
      const oc = pendingOverlapConflict;
      if (!oc) return null;
      const sd = new Date(oc.conflictSchedule.startTime as unknown as string);
      const ed = new Date(oc.conflictSchedule.endTime as unknown as string);
      const conflictDay = sd.toLocaleDateString('en-US', {
        weekday: 'short', month: 'short', day: 'numeric',
      });
      const fmtTime = (d: Date) =>
        d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
      const conflictTitle = oc.conflictSchedule.title
        ? `${oc.conflictSchedule.title} – ${conflictDay}`
        : conflictDay;
      return (
        <AlertDialog
          open
          onOpenChange={(o) => { if (!o) setPendingOverlapConflict(null); }}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle className="flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-amber-500" />
                Scheduling conflict
              </AlertDialogTitle>
              <AlertDialogDescription asChild>
                <div className="space-y-2 text-sm">
                  <p>
                    <span className="font-medium">{oc.employeeName}</span>{' '}
                    already has a shift that overlaps this time range.
                  </p>
                  <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-200">
                    <div className="font-medium">{conflictTitle}</div>
                    <div>{fmtTime(sd)}–{fmtTime(ed)}</div>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Adjust the time or pick a different employee, or jump to the
                    conflicting shift to resolve it first.
                  </p>
                </div>
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter className="gap-2 sm:gap-2">
              <AlertDialogCancel data-testid="overlap-conflict-cancel">
                Cancel
              </AlertDialogCancel>
              {onSelectSchedule && (
                <AlertDialogAction
                  onClick={() => {
                    const conflict = oc.conflictSchedule;
                    setPendingOverlapConflict(null);
                    onSelectSchedule(conflict);
                  }}
                  data-testid="overlap-conflict-view"
                >
                  View conflict
                </AlertDialogAction>
              )}
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      );
    })()}

    {/* Delete-shift confirmation (Task #700, Bug 4) */}
    <AlertDialog open={pendingDeleteConfirm} onOpenChange={setPendingDeleteConfirm}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-destructive" />
            Delete this shift?
          </AlertDialogTitle>
          <AlertDialogDescription>
            This cannot be undone. The shift will be removed from the schedule.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter className="gap-2 sm:gap-2">
          <AlertDialogCancel data-testid="delete-confirm-cancel">Cancel</AlertDialogCancel>
          <AlertDialogAction
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            onClick={() => {
              if (!editingSchedule || !onDeleteSchedule) return;
              setPendingDeleteConfirm(false);
              setLocalDeletePending(true);
              onDeleteSchedule(editingSchedule.id);
            }}
            data-testid="delete-confirm-confirm"
          >
            Delete
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>


    </>
  );
}
