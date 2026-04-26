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
import { cn } from "@/lib/utils";
import { classifyShiftCard } from "./createShiftCardKind";
import {
  Clock, Users, Loader2, TrendingUp, Sparkles, AlertTriangle,
  ChevronDown, ChevronUp, Wand2, Check, X, RefreshCw,
  Maximize2, Minimize2, Pencil, Save, Trash2, Plus, Undo2, Redo2,
  Lock, Keyboard, DollarSign, Store,
} from "lucide-react";
import type { Schedule } from "@shared/schema";
import {
  computeMargin,
  hasUnsavedChanges as hasUnsavedChangesHelper,
  loadDraft,
  saveDraft,
  clearDraft,
  evictStaleDrafts,
} from "@/lib/createShiftHelpers";
import { useAuth } from "@/hooks/useAuth";
import { useWebSocketContext } from "@/contexts/WebSocketContext";

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

const SHIFT_COLORS = [
  "bg-violet-500",
  "bg-blue-500",
  "bg-emerald-500",
  "bg-amber-500",
  "bg-rose-500",
  "bg-cyan-500",
  "bg-pink-500",
  "bg-indigo-500",
];

function getShiftColor(name: string) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
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
  onToggleExclude: (e: React.MouseEvent) => void;
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
  const color = getShiftColor(shift.employeeName);

  let title = shift.rationale;
  if (isExcluded) title = "Click to restore this shift";
  else if (hasConflict) title = `${shift.employeeName} already has a shift scheduled on this day`;

  const isDraft = !shift.employeeId;

  return (
    <div
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
        <div className={cn("truncate opacity-80", isExcluded && "line-through")}>
          {fmt12(shift.startTime)}–{fmt12(shift.endTime)}
        </div>
        {!isExcluded && hasConflict ? (
          <div className="flex items-center gap-0.5 text-amber-600 dark:text-amber-400 text-[9px] font-semibold">
            <AlertTriangle className="h-2.5 w-2.5 shrink-0" />
            Already scheduled
          </div>
        ) : !isExcluded && shift.rationale ? (
          <div className="truncate opacity-70 text-[9px]">{shift.rationale}</div>
        ) : null}
        {!isExcluded && (
          <span
            role="button"
            title={xTooltip ?? "Exclude this shift"}
            onClick={onToggleExclude}
            className="absolute top-0.5 right-0.5 hidden group-hover:flex items-center justify-center w-4 h-4 rounded-full bg-black/30 hover:bg-black/50 text-white"
          >
            <X className="h-2.5 w-2.5" />
          </span>
        )}
      </button>
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

function SalesChart({
  data,
  isLoading,
  onCorrect,
  isCorrecting,
}: {
  data: HistoricalSalesData | null | undefined;
  isLoading: boolean;
  onCorrect?: (historicalDate: string, newTotal: number) => void;
  isCorrecting?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [correctionVal, setCorrectionVal] = useState("");

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

  const handleSaveCorrection = () => {
    const val = parseFloat(correctionVal.replace(/[^0-9.]/g, ""));
    if (isNaN(val) || val < 0) return;
    onCorrect?.(data.historicalDate, val);
    setEditing(false);
    setCorrectionVal("");
  };

  return (
    <div className="mb-3">
      <div className="flex items-center justify-between mb-1">
        <span className="text-[11px] font-medium text-muted-foreground flex items-center gap-1">
          <TrendingUp className="h-3 w-3" />
          Projected Revenue
        </span>
        <div className="flex items-center gap-2">
          <span className="text-[9px] text-muted-foreground italic">Based on {historicalLabel}</span>
          {editing ? (
            <div className="flex items-center gap-1">
              <span className="text-[11px] text-muted-foreground">$</span>
              <Input
                autoFocus
                className="h-6 w-24 text-[11px] px-1 py-0"
                value={correctionVal}
                onChange={(e) => setCorrectionVal(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleSaveCorrection();
                  if (e.key === "Escape") { setEditing(false); setCorrectionVal(""); }
                }}
                placeholder={String(Math.round(data.dailyTotal))}
              />
              <button
                onClick={handleSaveCorrection}
                disabled={isCorrecting}
                className="text-emerald-600 hover:text-emerald-700 disabled:opacity-50"
                title="Save correction"
              >
                {isCorrecting ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
              </button>
              <button
                onClick={() => { setEditing(false); setCorrectionVal(""); }}
                className="text-muted-foreground hover:text-foreground"
                title="Cancel"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-1 group">
              <span className="text-[11px] font-semibold text-foreground">{dailyFmt} total</span>
              {onCorrect && (
                <button
                  onClick={() => { setEditing(true); setCorrectionVal(String(Math.round(data.dailyTotal))); }}
                  title="Correct this revenue total"
                  className="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-foreground"
                >
                  <Pencil className="h-2.5 w-2.5" />
                </button>
              )}
            </div>
          )}
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
        {onCorrect && (
          <span className="text-[9px] text-muted-foreground italic ml-auto">Hover total to correct</span>
        )}
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
}: {
  members: AvailMember[];
  storeHours: { open: string; close: string } | null;
  isLoading: boolean;
  scheduledEmployeeIds: Set<string>;
  onAdd: (member: AvailMember) => void;
  showUnavailable: boolean;
  onToggleUnavailable: () => void;
  dateKey?: string;
}) {
  const [roleFilter, setRoleFilter] = useState('all');
  const [minScore, setMinScore] = useState(0);

  useEffect(() => {
    setRoleFilter('all');
    setMinScore(0);
  }, [dateKey]);

  const roles = useMemo(() => {
    return Array.from(new Set(members.map(m => m.roleName))).sort();
  }, [members]);

  const filteredMembers = useMemo(() => {
    return members.filter(m => {
      if (roleFilter !== 'all' && m.roleName !== roleFilter) return false;
      if (m.compositeScore < minScore) return false;
      return true;
    });
  }, [members, roleFilter, minScore]);

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

  const PILL_COLORS = ['bg-violet-500','bg-blue-500','bg-emerald-500','bg-amber-500','bg-rose-500','bg-cyan-500'];
  function pillColor(name: string) {
    let hash = 0;
    for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
    return PILL_COLORS[Math.abs(hash) % PILL_COLORS.length];
  }

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

            return (
              <div
                key={member.userId}
                className={cn(
                  "relative flex flex-col gap-1 p-2 rounded-lg border w-44 flex-shrink-0 transition-all",
                  !member.isAvailable
                    ? "bg-muted/20 border-border/30 opacity-50"
                    : isScheduled
                    ? "bg-muted/30 border-border/40"
                    : "bg-background border-border hover:border-primary/40 hover:shadow-sm"
                )}
                title={unavailReason || undefined}
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
                    <div className={cn("w-6 h-6 rounded-full flex items-center justify-center text-white text-[9px] font-bold shrink-0", pillColor(member.name))}>
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

// Hover-intent delete button for persisted "Scheduled" cards. Requires the
// cursor to dwell for 200ms before the click is honored, so an accidental
// flick across the card doesn't fire the destructive delete.
function HoverIntentDeleteButton({ onConfirm }: { onConfirm: () => void }) {
  const [armed, setArmed] = useState(false);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const handleEnter = () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setArmed(true), 200);
  };
  const handleLeave = () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
    setArmed(false);
  };
  useEffect(() => () => {
    if (timerRef.current) clearTimeout(timerRef.current);
  }, []);
  return (
    <button
      type="button"
      data-testid="hover-intent-delete"
      data-armed={armed ? 'true' : 'false'}
      onPointerEnter={handleEnter}
      onPointerLeave={handleLeave}
      onClick={(e) => {
        e.stopPropagation();
        if (armed) onConfirm();
      }}
      onPointerDown={(e) => e.stopPropagation()}
      title="Delete from schedule"
      className={`absolute top-0.5 right-0.5 hidden group-hover/actual:flex items-center justify-center w-4 h-4 rounded-full text-white z-30 transition-colors ${
        armed ? 'bg-red-500/90 hover:bg-red-600' : 'bg-black/40 cursor-progress'
      }`}
    >
      <X className="h-2.5 w-2.5" />
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
  onActualShiftChange,
  onDeleteActualShift,
  aiCount,
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
  onSelectActualShift?: (s: Schedule) => void;
  selectedActualId?: string | null;
  onActualShiftChange?: (s: Schedule, startTime: string, endTime: string) => void;
  onDeleteActualShift?: (s: Schedule) => void;
  aiCount: number;
}) {
  const open = storeHours?.open || suggestData?.storeHours?.open || "09:00";
  const close = storeHours?.close || suggestData?.storeHours?.close || "21:00";
  const openMin = timeToMin(open);
  const closeMin = timeToMin(close);
  const totalMin = closeMin - openMin;
  const containerRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragState>(null);
  const blockClickSuppressRef = useRef(false);
  type ActualDrag = { idx: number; schedule: Schedule; type: 'top' | 'bottom' | 'move'; offsetPct?: number; initialY?: number; previewStart: string; previewEnd: string };
  const actualDragRef = useRef<ActualDrag | null>(null);
  const [actualDragPreview, setActualDragPreview] = useState<{ idx: number; startTime: string; endTime: string } | null>(null);
  const actualClickSuppressRef = useRef(false);

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
    dragRef.current = { idx, type: 'move', offsetPct, initialY: e.clientY };
    // Capture on the container so all move/up events bubble there
    containerRef.current.setPointerCapture(e.pointerId);
    onDragStart?.(idx);
  }, [openMin, totalMin, suggestData, onShiftEdit, onDragStart]);

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
    if (actualDragRef.current) {
      const ad = actualDragRef.current;
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
    const { idx, type } = dragRef.current;
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
  }, [openMin, totalMin, closeMin, suggestData, onShiftEdit]);

  const handlePointerUp = useCallback(() => {
    // ── actual-shift drag end ──
    if (actualDragRef.current) {
      const wasMove = actualDragRef.current.type === 'move';
      const schedule = actualDragRef.current.schedule;
      const preview = actualDragPreview;
      actualDragRef.current = null;
      if (preview) {
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
            <span>AI Suggested <span className="text-foreground font-semibold">({activeCount}{excludedIdxs.size > 0 ? ` of ${shifts.length}` : ""})</span></span>
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
            className="relative flex flex-1 border border-border/50 rounded-lg bg-muted/20 overflow-hidden touch-none"
            style={{ height: Math.max(160, Math.min(300, totalMin * 0.6)) }}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerLeave={handlePointerUp}
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
            </div>
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
              const isDragging  = !!preview;
              const colorCls    = getShiftColor(actual.name);
              return (
                <div key={`actual-${idx}`} className="relative flex-1 min-w-[52px] border-l border-border/20 first:border-l-0 z-10">
                  <div
                    style={{ top: `${topPct}%`, height: `${Math.max(hPct, 3)}%` }}
                    className={cn(
                      "absolute inset-x-0.5 rounded-md text-left text-white overflow-hidden select-none group/actual",
                      colorCls,
                      isActive   ? "ring-[3px] ring-orange-400 ring-offset-2 scale-[1.02] shadow-lg opacity-100 z-20"
                               : "opacity-90 hover:opacity-100",
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
                      onSelectActualShift?.(actual.schedule);
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
                      containerRef.current.setPointerCapture(e.pointerId);
                      actualDragRef.current = { idx, schedule: actual.schedule, type: 'move', offsetPct, initialY: e.clientY, previewStart: dispStart, previewEnd: dispEnd };
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
                  className="relative flex-1 min-w-[52px] border-l border-border/20 first:border-l-0 z-10"
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
  // Drafts are namespaced by (storeId, date, userId).
  const draftStoreId = 'panel';
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
  const [manualShifts, setManualShifts] = useState<ProposedShift[]>([]);
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
  const [pendingCorrectionWarning, setPendingCorrectionWarning] = useState<{
    historicalDate: string;
    totalRevenue: number;
    message: string;
  } | null>(null);
  // A1 confirm-on-close dialog state.
  const [pendingCloseConfirm, setPendingCloseConfirm] = useState(false);
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
    if (!selectedActualSchedule || !actualFormEdits) return dateActualShifts;
    return dateActualShifts.map((actual) => {
      if (actual.schedule.id !== selectedActualSchedule.id) return actual;
      const user = employees.find((e) => e.id === actualFormEdits.userId);
      const name = user
        ? `${user.firstName || ''} ${user.lastName || ''}`.trim() || actual.name
        : actual.name;
      return { ...actual, name, startTime: actualFormEdits.startTime, endTime: actualFormEdits.endTime };
    });
  }, [dateActualShifts, selectedActualSchedule, actualFormEdits, employees]);

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
      setManualShifts([]);
      setShowPillsUnavailable(false);
      forceRegenRef.current = false;
    } else {
      // Clear undo/redo history immediately when dialog closes
      setUndoStack([]);
      setRedoStack([]);
      editedShiftsRef.current = {};
      dragActiveRef.current = false;
      setManualShifts([]);
    }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  // When editing an existing saved schedule, pre-fill ALL form fields with its data
  useEffect(() => {
    if (!open || !editingSchedule) return;
    const dt = new Date(editingSchedule.startTime);
    const dtEnd = new Date(editingSchedule.endTime);
    const pad = (n: number) => String(n).padStart(2, '0');
    const dateStr = `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`;
    const startStr = `${pad(dt.getHours())}:${pad(dt.getMinutes())}`;
    const endStr = `${pad(dtEnd.getHours())}:${pad(dtEnd.getMinutes())}`;
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
    if (!open || !panelWsMessage) return;
    const t = panelWsMessage.type;
    const isBulk = t === 'schedules_bulk_created' || t === 'schedules_bulk_updated' || t === 'schedules_bulk_deleted';
    const isSingle = t === 'schedule_created' || t === 'schedule_updated' || t === 'schedule_deleted';
    if (!isBulk && !isSingle) return;
    type SchedulePayload = { startTime?: string };
    const msg = panelWsMessage as { data?: { schedules?: SchedulePayload[]; schedule?: SchedulePayload } };
    const data = msg.data;
    const schedules: SchedulePayload[] = Array.isArray(data?.schedules)
      ? data!.schedules!
      : data?.schedule
        ? [data.schedule]
        : [];
    if (t !== 'schedules_bulk_deleted' && t !== 'schedule_deleted' && modalDate) {
      const matchesDay = schedules.some((s) => {
        if (!s.startTime) return false;
        try { return new Date(s.startTime).toISOString().slice(0, 10) === modalDate; }
        catch { return false; }
      });
      if (!matchesDay) return;
    }
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
  }, [open, requestClose, showShortcutOverlay]);

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

  // When user drags an actual shift block, select it and update the form times
  const handleActualShiftChange = useCallback((schedule: Schedule, startTime: string, endTime: string) => {
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
      queryClient.invalidateQueries({ queryKey: ["/api/schedules/suggest", variables.date] });
    },
    onError: () => {
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
      if (!skipCache) {
        try {
          const getRes = await apiRequest("GET", `/api/schedules/suggest?date=${modalDate}`);
          const saved = await getRes.json();
          if (saved?.proposedShifts?.length > 0) {
            return saved;
          }
        } catch {
          // no saved suggestion — fall through to generate
        }
      }
      const res = await apiRequest("POST", "/api/schedules/suggest", { date: modalDate });
      return res.json();
    },
    enabled: open && !!modalDate,
    staleTime: 5 * 60_000,
    gcTime: 10 * 60_000,
    retry: 1,
  });

  // Keep suggestDataRef in sync so undo/redo can access original shift times
  useEffect(() => { suggestDataRef.current = suggestData; }, [suggestData]);

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
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/schedules"] });
      setSelectedActualSchedule(null);
      setActualFormEdits(null);
      toast({ title: "Shift updated", description: "Changes saved to the schedule." });
    },
    onError: () => {
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

  // Capture the full payload of an actual shift before deleting so we can recreate
  // it on undo. The mutation receives the whole `Schedule` (not just an id) so
  // the closure has every field needed for the POST in recreateScheduleMutation.
  const deleteActualMutation = useMutation({
    mutationFn: async (params: { schedule: Schedule }) => {
      return apiRequest("DELETE", `/api/schedules/${params.schedule.id}`);
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ["/api/schedules"] });
      setSelectedActualSchedule(null);
      setActualFormEdits(null);
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

  // Mutation to correct a historical revenue total
  const correctRevenueMutation = useMutation({
    mutationFn: async ({ historicalDate, totalRevenue, confirmed }: { historicalDate: string; totalRevenue: number; confirmed?: boolean }) => {
      const res = await apiRequest("POST", "/api/schedules/historical-sales/correct", { date: historicalDate, totalRevenue, confirmed });
      return res.json();
    },
    onSuccess: (data, variables) => {
      if (data?.requiresConfirmation) {
        setPendingCorrectionWarning({
          historicalDate: variables.historicalDate,
          totalRevenue: variables.totalRevenue,
          message: data.message,
        });
        return;
      }
      queryClient.invalidateQueries({ queryKey: ["/api/schedules/historical-sales", modalDate] });
      toast({ title: "Revenue corrected", description: "The historical total has been updated." });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to correct revenue total.", variant: "destructive" });
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
      return apiRequest("POST", "/api/ai-scheduling/apply", { scheduleEntries: entries });
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
      // Refetch grid + availability so the user lands on populated views.
      await Promise.all([
        queryClient.refetchQueries({ queryKey: ["/api/schedules"], type: 'active' }),
        queryClient.refetchQueries({ queryKey: ["/api/schedules/today-availability"], type: 'active' }),
        queryClient.refetchQueries({ queryKey: ["/api/availability/calendar/team"], type: 'active' }),
      ]);
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
      onOpenChange(false);
    },
    onError: () => {
      pendingSkippedCountRef.current = 0;
      toast({ title: "Error", description: "Failed to approve shifts.", variant: "destructive" });
    },
  });

  const handleSelectShift = (shift: ProposedShift, idx: number) => {
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

  const handleSelectActualShift = useCallback((schedule: Schedule) => {
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
    const startStr = `${pad(st.getHours())}:${pad(st.getMinutes())}`;
    const endStr   = `${pad(et.getHours())}:${pad(et.getMinutes())}`;
    setSelectedActualSchedule(schedule);
    setActualFormEdits({ startTime: startStr, endTime: endStr, userId: schedule.userId });
    setModalDate(dateStr);
    setModalStartTime(startStr);
    setModalEndTime(endStr);
    setSelectedUserId(schedule.userId);
    setModalTitle(schedule.title ?? '');
    setModalLocationId(schedule.locationId ?? locations[0]?.id ?? '');
    setModalNotes(schedule.description ?? '');
    setSelectedShiftIdx(null);
    if (onDateChange) onDateChange(dateStr);
  }, [selectedActualSchedule, locations, onDateChange]);

  const handleSaveActual = useCallback(() => {
    if (!selectedActualSchedule) return;
    const [y, mo, d] = modalDate.split('-').map(Number);
    const [sh, sm] = modalStartTime.split(':').map(Number);
    const [eh, em] = modalEndTime.split(':').map(Number);
    const startDate = new Date(y, mo - 1, d, sh, sm, 0, 0);
    const endDate   = new Date(y, mo - 1, d, eh, em, 0, 0);
    if (endDate <= startDate) endDate.setDate(endDate.getDate() + 1);
    updateActualMutation.mutate({
      id: selectedActualSchedule.id,
      userId: selectedUserId,
      startTime: startDate,
      endTime: endDate,
      title: modalTitle || null,
      locationId: modalLocationId || null,
      description: modalNotes || null,
    });
  }, [selectedActualSchedule, modalDate, modalStartTime, modalEndTime, selectedUserId, modalTitle, modalLocationId, modalNotes, updateActualMutation]);

  const handleSaveShiftEdit = () => {
    if (selectedShiftIdx === null) return;
    const aiCount = suggestDataRef.current?.proposedShifts?.length ?? 0;

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

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (editingSchedule && onUpdateSchedule) {
      const effectiveUserId = selectedUserId || editingSchedule.userId;
      onUpdateSchedule({
        id: editingSchedule.id,
        userId: effectiveUserId,
        startTime: new Date(`${modalDate}T${modalStartTime}`),
        endTime: new Date(`${modalDate}T${modalEndTime}`),
        title: modalTitle || null,
        locationId: modalLocationId || null,
        description: modalNotes || null,
      });
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

  const aiProposedShifts = (suggestData?.proposedShifts ?? []).map((shift, idx) =>
    editedShifts[idx] ? { ...shift, ...editedShifts[idx] } : shift
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
  const mergedSuggestData = suggestData
    ? { ...suggestData, proposedShifts }
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
    if (approveMutation.isPending || suggestLoading) return;
    const aiCount = suggestDataRef.current?.proposedShifts?.length ?? 0;
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
    pendingSkippedCountRef.current = liveActive.length - liveValid.length;
    approveMutation.mutate(liveValid);
  }, [approveMutation, suggestLoading, manualShifts, selectedShiftIdx, employees, selectedUserId, modalStartTime, modalEndTime, modalTitle, modalNotes, aiProposedShifts, persistedManualKeys, excludedIdxs, toast]);

  // Cmd/Ctrl+S — save all pending shifts. Only fires when the panel is open
  // AND there are valid shifts to save (so the browser's default page-save
  // behavior still works on the rest of the app).
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
        if (validActiveShifts.length === 0) return;
        e.preventDefault();
        handleBulkSave();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, validActiveShifts.length, handleBulkSave]);
  const storeHours = salesData?.storeHours ?? suggestData?.storeHours ?? null;

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

  // Employee IDs that already appear on the timeline (proposed + actual) — used by pills
  const scheduledForPills = useMemo<Set<string>>(() => {
    const ids = new Set<string>();
    proposedShifts.forEach((s, i) => { if (!excludedIdxs.has(i)) ids.add(s.employeeId); });
    dateActualShifts.forEach(a => ids.add(a.schedule.userId));
    return ids;
  }, [proposedShifts, excludedIdxs, dateActualShifts]);

  const handlePillAdd = useCallback((member: AvailMember) => {
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
  }, [storeHours, proposedShifts.length, persistPillShiftMutation, modalDate]);

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
        {/* Panel */}
        <div
          role="dialog"
          aria-modal="true"
          aria-label={editingSchedule ? 'Edit Shift' : 'Create Shift'}
          data-dialog-resizable
          className={cn(dialogWidthClass, "fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50 bg-background border shadow-lg rounded-lg overflow-hidden transition-[width,height] duration-200")}
          style={dialogStyle}
          onPointerMove={handleGripPointerMove}
          onPointerUp={handleGripPointerUp}
          onPointerLeave={handleGripPointerUp}
        >
          {/* Close button */}
          <button
            type="button"
            className="absolute right-4 top-4 rounded-sm opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 z-10"
            onClick={requestClose}
          >
            <X className="h-4 w-4" />
            <span className="sr-only">Close</span>
          </button>
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

        {/* Body */}
        <div className="flex-1 overflow-hidden flex flex-col md:flex-row min-h-0">

          {/* ── LEFT PANEL ── */}
          <div className="md:w-[55%] border-b md:border-b-0 md:border-r border-border flex flex-col min-h-0">
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
                {/* Mobile collapse toggle */}
                <button
                  className="md:hidden text-muted-foreground hover:text-foreground"
                  onClick={() => setLeftCollapsed((v) => !v)}
                >
                  {leftCollapsed ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
                </button>
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
                {/* Refresh button */}
                <Button
                  size="sm"
                  variant="outline"
                  className="gap-1 text-xs h-8"
                  disabled={suggestFetching || !modalDate}
                  title={
                    suggestUpdatedAt
                      ? `Last fetched ${new Date(suggestUpdatedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} — click to refresh`
                      : "Refresh AI suggestions"
                  }
                  onClick={() => {
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

            {/* Left scrollable content */}
            <div
              className={cn(
                "flex-1 overflow-y-auto px-4 py-3 space-y-4",
                leftCollapsed && "hidden md:block"
              )}
              onClick={() => setSelectedShiftIdx(null)}
            >
              {/* Synthetic warning */}
              {suggestData?.dataSource === "synthetic" && (
                <div className="flex items-start gap-2 text-xs text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg px-3 py-2">
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                  No Shopify sales data found. Recommendations use minimum staffing defaults.
                </div>
              )}

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
                onCorrect={isAdmin ? (historicalDate, newTotal) =>
                  correctRevenueMutation.mutate({ historicalDate, totalRevenue: newTotal })
                : undefined}
                isCorrecting={correctRevenueMutation.isPending}
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
                      onActualShiftChange={handleActualShiftChange}
                      onDeleteActualShift={(s) => deleteActualMutation.mutate({ schedule: s })}
                      aiCount={aiProposedShifts.length}
                    />
                  </div>
                </>
              )}

              {/* Who's Available pills */}
              {!!modalDate && (
                <>
                  <div className="border-t border-border/40" />
                  <AvailableEmployeePills
                    members={availData?.members ?? []}
                    storeHours={availData?.storeHours ?? storeHours}
                    isLoading={availLoading && !availData}
                    scheduledEmployeeIds={scheduledForPills}
                    onAdd={handlePillAdd}
                    showUnavailable={showPillsUnavailable}
                    onToggleUnavailable={() => setShowPillsUnavailable(v => !v)}
                    dateKey={modalDate}
                  />
                </>
              )}
            </div>
          </div>

          {/* ── RIGHT PANEL ── */}
          <div className="md:w-[45%] flex flex-col min-h-0 overflow-y-auto">
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
              onSubmit={
                isEditingBlock ? (e) => { e.preventDefault(); handleSaveShiftEdit(); }
                : isActualEditing ? (e) => { e.preventDefault(); handleSaveActual(); }
                : handleSubmit
              }
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
                      return list.map((user) => (
                        <SelectItem key={user.id} value={user.id}>
                          {user.firstName} {user.lastName}
                        </SelectItem>
                      ));
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
                  { byUser, userRoleId, byRoleDefault, fallback: 15, projectedRevenue, targetLaborPct: 25 },
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
                  green: 'On budget',
                  amber: 'Watch labor',
                  red: 'Over budget',
                  unknown: '',
                };
                const tipParts: string[] = [];
                if (margin.tier !== 'unknown') {
                  tipParts.push(`Target labor ≤ ${margin.targetLaborPct}% of revenue.`);
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
                      {margin.laborPct !== null && (
                        <span
                          className="ml-2 font-semibold"
                          data-testid="margin-meter-pct"
                        >
                          {margin.laborPct.toFixed(1)}%
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
                    disabled={isDeleting}
                    onClick={() => onDeleteSchedule(editingSchedule.id)}
                    className="gap-1.5"
                  >
                    {isDeleting ? (
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
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={updateActualMutation.isPending}
                      onClick={handleSaveActual}
                      className="gap-1.5"
                    >
                      {updateActualMutation.isPending ? (
                        <><Loader2 className="h-3 w-3 animate-spin" />Saving…</>
                      ) : (
                        <><Save className="h-3 w-3" />Save Changes</>
                      )}
                    </Button>
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
                      but are filtered out at submission; a toast explains any skipped shifts. */}
                  {activeShifts.length > 0 ? (
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
            disabled={approveMutation.isPending}
            onClick={() => {
              setPendingCloseConfirm(false);
              if (validActiveShifts.length > 0) {
                handleBulkSave();
              } else {
                onOpenChange(false);
              }
            }}
            data-testid="close-confirm-save"
          >
            {approveMutation.isPending ? (
              <><Loader2 className="h-3 w-3 mr-1.5 animate-spin" />Saving…</>
            ) : validActiveShifts.length > 0 ? 'Save & close' : 'Keep draft & close'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>


    {/* ── Suspicious revenue correction confirmation dialog ── */}
    <AlertDialog
      open={!!pendingCorrectionWarning}
      onOpenChange={(open) => { if (!open) setPendingCorrectionWarning(null); }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-amber-500" />
            Unusual Revenue Total
          </AlertDialogTitle>
          <AlertDialogDescription>
            {pendingCorrectionWarning?.message}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={() => setPendingCorrectionWarning(null)}>
            Cancel
          </AlertDialogCancel>
          <AlertDialogAction
            onClick={() => {
              if (!pendingCorrectionWarning) return;
              const { historicalDate, totalRevenue } = pendingCorrectionWarning;
              setPendingCorrectionWarning(null);
              correctRevenueMutation.mutate({ historicalDate, totalRevenue, confirmed: true });
            }}
          >
            Yes, save it
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
    </>
  );
}
