import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { BarChart, Bar, ResponsiveContainer, Tooltip, Cell, XAxis } from "recharts";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { cn } from "@/lib/utils";
import {
  Clock, Users, Loader2, TrendingUp, Sparkles, AlertTriangle,
  ChevronDown, ChevronUp, Wand2, Check, X, RefreshCw,
  Maximize2, Minimize2, Pencil, Save, Trash2,
} from "lucide-react";
import type { Schedule } from "@shared/schema";

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
            : hasConflict
            ? "bg-amber-100 dark:bg-amber-900/40 border-2 border-amber-500"
            : color,
          isExcluded
            ? "text-muted-foreground text-[10px] font-medium leading-tight"
            : hasConflict
            ? "text-amber-900 dark:text-amber-200 text-[10px] font-medium leading-tight"
            : "text-white text-[10px] font-medium leading-tight",
          !isExcluded && isSelected
            ? hasConflict
              ? "ring-2 ring-amber-400 ring-offset-1 opacity-100"
              : "ring-2 ring-white ring-offset-1 opacity-100"
            : !isExcluded
            ? "opacity-90 hover:opacity-100"
            : ""
        )}
      >
        <div className={cn("truncate pt-1", isExcluded && "line-through")}>{shift.employeeName}</div>
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
            title="Exclude this shift"
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

type DragState = {
  idx: number;
  type: 'top' | 'bottom' | 'move';
  offsetPct?: number;
  initialY?: number;
} | null;

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
}: {
  suggestData: SuggestData | null | undefined;
  isLoading: boolean;
  isError?: boolean;
  errorMsg?: string;
  storeHours: { open: string; close: string } | null;
  selectedIdx: number | null;
  onSelectShift: (shift: ProposedShift, idx: number) => void;
  excludedIdxs: Set<number>;
  onToggleExclude: (idx: number) => void;
  conflictingEmployeeIds: Set<string>;
  onShiftEdit?: (idx: number, updates: { startTime?: string; endTime?: string }) => void;
}) {
  const open = storeHours?.open || suggestData?.storeHours?.open || "09:00";
  const close = storeHours?.close || suggestData?.storeHours?.close || "21:00";
  const openMin = timeToMin(open);
  const closeMin = timeToMin(close);
  const totalMin = closeMin - openMin;
  const containerRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragState>(null);
  const blockClickSuppressRef = useRef(false);

  const minsToStr = (mins: number) =>
    `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;

  const handleResizeStart = useCallback((e: React.PointerEvent, idx: number, type: 'top' | 'bottom') => {
    if (!containerRef.current) return;
    e.preventDefault();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    dragRef.current = { idx, type };
  }, []);

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
  }, [openMin, totalMin, suggestData, onShiftEdit]);

  const handleBlockClick = useCallback((shift: ProposedShift, idx: number) => {
    if (blockClickSuppressRef.current) {
      blockClickSuppressRef.current = false;
      return;
    }
    onSelectShift(shift, idx);
  }, [onSelectShift]);

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (!dragRef.current || !containerRef.current || !onShiftEdit) return;
    const { idx, type } = dragRef.current;
    const rect = containerRef.current.getBoundingClientRect();
    const relY = Math.max(0, Math.min(e.clientY - rect.top, rect.height));
    const rawMin = openMin + (relY / rect.height) * totalMin;
    const snapped = Math.round(rawMin / 15) * 15;
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
    const wasMove = dragRef.current?.type === 'move';
    dragRef.current = null;
    if (wasMove) {
      // Click fires after pointerup. handleBlockClick clears the ref on receipt.
      // Safety net: if the pointer was released outside the element (no click fires),
      // clear the suppress ref after two animation frames so future clicks aren't blocked.
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          blockClickSuppressRef.current = false;
        });
      });
    }
  }, []);

  const hourLabels: number[] = [];
  for (let h = Math.ceil(openMin / 60); h <= Math.floor(closeMin / 60); h++) {
    hourLabels.push(h);
  }

  if (isLoading) {
    return (
      <div className="space-y-2">
        <Skeleton className="h-4 w-40 rounded" />
        <Skeleton className="h-48 w-full rounded-lg" />
      </div>
    );
  }

  const shifts = suggestData?.proposedShifts ?? [];
  const activeCount = shifts.filter((_, i) => !excludedIdxs.has(i)).length;

  return (
    <div>
      <div className="text-[11px] font-medium text-muted-foreground mb-2 flex items-center gap-1">
        <Sparkles className="h-3 w-3" />
        AI-Recommended Shifts
        {shifts.length > 0 && (
          <span className="ml-1 text-foreground font-semibold">
            ({activeCount}{excludedIdxs.size > 0 ? ` of ${shifts.length}` : ""})
          </span>
        )}
      </div>
      {shifts.length === 0 ? (
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
            {/* One column per shift */}
            {shifts.map((shift, idx) => (
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
                  onToggleExclude={(e) => { e.stopPropagation(); onToggleExclude(idx); }}
                  hasConflict={conflictingEmployeeIds.has(shift.employeeId)}
                  onResizeStart={onShiftEdit && !excludedIdxs.has(idx) ? (e, type) => handleResizeStart(e, idx, type) : undefined}
                  onBodyPointerDown={onShiftEdit && !excludedIdxs.has(idx) ? (e) => handleBodyPointerDown(e, idx) : undefined}
                />
              </div>
            ))}
          </div>
        </div>
      )}
      {shifts.length > 0 && (
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
}: Props) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [modalDate, setModalDate] = useState(defaultDate || "");
  const [modalStartTime, setModalStartTime] = useState(defaultStartTime || "09:00");
  const [modalEndTime, setModalEndTime] = useState(defaultEndTime || "17:00");
  const [selectedUserId, setSelectedUserId] = useState(defaultUserId || "");
  const [selectedShiftIdx, setSelectedShiftIdx] = useState<number | null>(null);
  const [leftCollapsed, setLeftCollapsed] = useState(false);
  const [excludedIdxs, setExcludedIdxs] = useState<Set<number>>(new Set());
  const [editedShifts, setEditedShifts] = useState<Record<number, ShiftEdit>>({});
  const [dialogSize, setDialogSize] = useState<DialogSize>('normal');
  const [dialogDims, setDialogDims] = useState<{ width: number; height: number } | null>(null);
  const forceRegenRef = useRef(false);
  const resizeGripRef = useRef<{ startX: number; startY: number; startW: number; startH: number } | null>(null);

  useEffect(() => {
    if (open) {
      setModalDate(defaultDate || "");
      setModalStartTime(defaultStartTime || "09:00");
      setModalEndTime(defaultEndTime || "17:00");
      setSelectedUserId(defaultUserId || "");
      setSelectedShiftIdx(null);
      setExcludedIdxs(new Set());
      setEditedShifts({});
      setDialogDims(null);
      forceRegenRef.current = false;
    }
  }, [open, defaultDate, defaultUserId, defaultStartTime, defaultEndTime]);

  // When editing an existing saved schedule, pre-fill the form with its data
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
    if (onDateChange) onDateChange(dateStr);
  }, [open, editingSchedule]); // eslint-disable-line react-hooks/exhaustive-deps

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
    setEditedShifts((prev) => ({ ...prev, [idx]: { ...prev[idx], ...updates } }));
    if (selectedShiftIdx === idx) {
      if (updates.startTime) setModalStartTime(updates.startTime);
      if (updates.endTime) setModalEndTime(updates.endTime);
      if (updates.employeeId) setSelectedUserId(updates.employeeId);
    }
  }, [selectedShiftIdx]);

  const handleToggleExclude = (idx: number) => {
    setExcludedIdxs((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) {
        next.delete(idx);
      } else {
        next.add(idx);
        if (selectedShiftIdx === idx) setSelectedShiftIdx(null);
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
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/schedules/suggest", modalDate] });
      toast({ title: "Shift saved", description: "Changes persisted to the suggested schedule." });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to save shift changes.", variant: "destructive" });
    },
  });

  // Mutation to correct a historical revenue total
  const correctRevenueMutation = useMutation({
    mutationFn: async ({ historicalDate, totalRevenue }: { historicalDate: string; totalRevenue: number }) => {
      const res = await apiRequest("POST", "/api/schedules/historical-sales/correct", { date: historicalDate, totalRevenue });
      return res.json();
    },
    onSuccess: () => {
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
      queryClient.invalidateQueries({ queryKey: ["/api/schedules"] });
      queryClient.invalidateQueries({ queryKey: ["/api/schedules/today-availability"] });
      toast({
        title: "Schedule Approved",
        description: `${result.schedulesCreated} shift${result.schedulesCreated !== 1 ? "s" : ""} created.`,
      });
      onOpenChange(false);
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to approve shifts.", variant: "destructive" });
    },
  });

  const handleSelectShift = (shift: ProposedShift, idx: number) => {
    if (idx === selectedShiftIdx) {
      // Deselect
      setSelectedShiftIdx(null);
      return;
    }
    setSelectedShiftIdx(idx);
    setSelectedUserId(shift.employeeId);
    setModalStartTime(shift.startTime);
    setModalEndTime(shift.endTime);
  };

  const handleSaveShiftEdit = () => {
    if (selectedShiftIdx === null) return;
    const currentEdit = editedShifts[selectedShiftIdx] ?? {};
    // Merge in any form-level changes
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
    setEditedShifts((prev) => ({ ...prev, [selectedShiftIdx]: mergedEdit }));
    saveShiftMutation.mutate({ idx: selectedShiftIdx, edit: mergedEdit });
  };

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    const userId = formData.get("userId") as string;
    const startDate = formData.get("startDate") as string;
    const startTime = formData.get("startTime") as string;
    const endTime = formData.get("endTime") as string;
    if (editingSchedule && onUpdateSchedule) {
      onUpdateSchedule({
        id: editingSchedule.id,
        userId,
        startTime: new Date(`${startDate}T${startTime}`),
        endTime: new Date(`${startDate}T${endTime}`),
        title: (formData.get("title") as string) || null,
        locationId: (formData.get("locationId") as string) || null,
        description: (formData.get("description") as string) || null,
      });
    } else {
      onCreateShift({
        userId,
        startTime: new Date(`${startDate}T${startTime}`),
        endTime: new Date(`${startDate}T${endTime}`),
        title: (formData.get("title") as string) || undefined,
        locationId: (formData.get("locationId") as string) || undefined,
        description: (formData.get("description") as string) || undefined,
      });
    }
  };

  const proposedShifts = (suggestData?.proposedShifts ?? []).map((shift, idx) =>
    editedShifts[idx] ? { ...shift, ...editedShifts[idx] } : shift
  );
  const mergedSuggestData = suggestData
    ? { ...suggestData, proposedShifts }
    : suggestData;
  const activeShifts = proposedShifts.filter((_, i) => !excludedIdxs.has(i));
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

  const dateLabel = modalDate
    ? new Date(modalDate + "T12:00:00Z").toLocaleDateString("en-US", {
        weekday: "long",
        month: "long",
        day: "numeric",
      })
    : "";

  const selectedShift = selectedShiftIdx !== null ? proposedShifts[selectedShiftIdx] : null;
  const isEditingBlock = selectedShiftIdx !== null && selectedShift !== undefined;

  const dialogWidthClass =
    dialogSize === 'full'
      ? 'w-[99vw] max-w-none'
      : dialogSize === 'wide'
      ? 'w-[96vw] max-w-[1200px]'
      : 'w-[96vw] max-w-[920px]';

  const dialogStyle = dialogDims
    ? { width: dialogDims.width, height: dialogDims.height, maxWidth: 'none', maxHeight: 'none' }
    : dialogSize === 'full'
    ? { maxHeight: '98vh', height: '98vh' }
    : undefined;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        data-dialog-resizable
        className={cn(dialogWidthClass, "max-h-[92vh] flex flex-col p-0 gap-0 overflow-hidden transition-[width,height] duration-200 relative")}
        style={dialogStyle}
        onPointerMove={handleGripPointerMove}
        onPointerUp={handleGripPointerUp}
        onPointerLeave={handleGripPointerUp}
      >
        <DialogHeader className="px-5 py-3 border-b flex-shrink-0">
          <DialogTitle className="text-sm flex items-center gap-2">
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
          </DialogTitle>
        </DialogHeader>

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
                  onClick={() => { forceRegenRef.current = true; setEditedShifts({}); refetchSuggest(); }}
                >
                  <RefreshCw className={cn("h-3 w-3", suggestFetching && "animate-spin")} />
                  {suggestUpdatedAt && !suggestFetching ? (
                    <span className="hidden sm:inline">
                      {new Date(suggestUpdatedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                    </span>
                  ) : null}
                </Button>
                <Button
                  size="sm"
                  className={cn(
                    "gap-1.5 text-xs h-8 text-white",
                    conflictCount > 0
                      ? "bg-amber-500 hover:bg-amber-600"
                      : "bg-orange-500 hover:bg-orange-600"
                  )}
                  disabled={
                    approveMutation.isPending ||
                    activeShifts.length === 0 ||
                    suggestLoading
                  }
                  onClick={() => approveMutation.mutate(activeShifts)}
                  title={
                    conflictCount > 0
                      ? `${conflictCount} active shift${conflictCount !== 1 ? "s" : ""} conflict with existing schedules`
                      : undefined
                  }
                >
                  {approveMutation.isPending ? (
                    <><Loader2 className="h-3 w-3 animate-spin" />Approving…</>
                  ) : conflictCount > 0 ? (
                    <><AlertTriangle className="h-3 w-3" />Approve ({activeShifts.length}) · {conflictCount} conflict{conflictCount !== 1 ? "s" : ""}</>
                  ) : (
                    <><Check className="h-3 w-3" />Approve ({activeShifts.length})</>
                  )}
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

              {/* Day-view timeline — stop bubble so empty-space clicks on the */}
              {/* scrollable area (above) deselect while block clicks don't.   */}
              <div onClick={(e) => e.stopPropagation()}>
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
                />
              </div>
            </div>
          </div>

          {/* ── RIGHT PANEL ── */}
          <div className="md:w-[45%] flex flex-col min-h-0 overflow-y-auto">
            {/* Edit mode banner when a block is selected */}
            {isEditingBlock && (
              <div className="px-4 pt-3 pb-0 flex-shrink-0">
                <div className="flex items-center justify-between rounded-lg border border-primary/30 bg-primary/5 px-3 py-2">
                  <span className="text-xs font-medium text-primary flex items-center gap-1.5">
                    <Pencil className="h-3 w-3" />
                    Editing {selectedShift.employeeName}&apos;s shift
                  </span>
                  <button
                    onClick={() => setSelectedShiftIdx(null)}
                    className="text-muted-foreground hover:text-foreground"
                    title="Cancel edit"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            )}

            <form
              onSubmit={isEditingBlock ? (e) => { e.preventDefault(); handleSaveShiftEdit(); } : handleSubmit}
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
                    if (isEditingBlock) {
                      const emp = employees.find((e) => e.id === v);
                      const empName = emp ? `${emp.firstName ?? ""} ${emp.lastName ?? ""}`.trim() : "";
                      handleShiftEdit(selectedShiftIdx!, { employeeId: v, employeeName: empName });
                    }
                  }}
                  required
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
                    {modalEmployees.length === 0 ? (
                      <div className="py-2 px-3 text-xs text-muted-foreground">
                        No employees with availability. Turn off the filter to see all.
                      </div>
                    ) : (
                      modalEmployees.map((user) => (
                        <SelectItem key={user.id} value={user.id}>
                          {user.firstName} {user.lastName}
                        </SelectItem>
                      ))
                    )}
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
                    setSelectedShiftIdx(null);
                    setExcludedIdxs(new Set());
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
                      if (isEditingBlock) {
                        handleShiftEdit(selectedShiftIdx!, { startTime: e.target.value });
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
                      if (isEditingBlock) {
                        handleShiftEdit(selectedShiftIdx!, { endTime: e.target.value });
                      }
                    }}
                  />
                </div>
              </div>

              <div>
                <Label className="text-xs">Role/Title (optional)</Label>
                <Input
                  key={`title-${editingSchedule?.id ?? 'new'}`}
                  name="title"
                  className="h-8 text-sm"
                  placeholder="e.g., Opener, Closer"
                  defaultValue={editingSchedule?.title ?? ''}
                />
              </div>

              <div>
                <Label className="text-xs">Location</Label>
                <Select
                  name="locationId"
                  key={`loc-${editingSchedule?.id ?? 'new'}-${open}`}
                  defaultValue={editingSchedule?.locationId ?? locations[0]?.id ?? ""}
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
                  key={`notes-${editingSchedule?.id ?? 'new'}`}
                  name="description"
                  className="text-sm"
                  placeholder="Optional notes..."
                  rows={2}
                  defaultValue={editingSchedule?.description ?? ''}
                />
              </div>

              {/* AI Auto-Assign */}
              {!isEditingBlock && (
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

              <div className="flex justify-between gap-2 pt-1 pb-2">
                {/* Delete button — only when editing an existing saved schedule */}
                {editingSchedule && onDeleteSchedule ? (
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

                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => isEditingBlock ? setSelectedShiftIdx(null) : onOpenChange(false)}
                  >
                    {isEditingBlock ? "Deselect" : "Cancel"}
                  </Button>
                  {isEditingBlock ? (
                    <Button
                      type="button"
                      size="sm"
                      disabled={saveShiftMutation.isPending}
                      onClick={handleSaveShiftEdit}
                      className="gap-1.5"
                    >
                      {saveShiftMutation.isPending ? (
                        <><Loader2 className="h-3 w-3 animate-spin" />Saving…</>
                      ) : (
                        <><Save className="h-3 w-3" />Save Changes</>
                      )}
                    </Button>
                  ) : editingSchedule ? (
                    <Button type="submit" size="sm" disabled={isUpdating} className="gap-1.5">
                      {isUpdating ? (
                        <><Loader2 className="h-3 w-3 animate-spin" />Saving…</>
                      ) : (
                        <><Save className="h-3 w-3" />Save Changes</>
                      )}
                    </Button>
                  ) : (
                    <Button type="submit" size="sm" disabled={isCreating}>
                      {isCreating ? "Creating..." : "Create Shift"}
                    </Button>
                  )}
                </div>
              </div>
            </form>
          </div>
        </div>

        {/* ── Resize grip (bottom-right corner) ── */}
        <div
          title="Drag to resize"
          className="absolute bottom-1 right-1 w-5 h-5 cursor-nwse-resize z-50 flex items-end justify-end p-0.5 opacity-30 hover:opacity-70 transition-opacity select-none"
          onPointerDown={handleGripPointerDown}
        >
          <svg viewBox="0 0 10 10" className="w-3.5 h-3.5 text-muted-foreground fill-current">
            <rect x="6" y="0" width="2" height="10" rx="1" />
            <rect x="0" y="6" width="10" height="2" rx="1" />
          </svg>
        </div>
      </DialogContent>
    </Dialog>
  );
}
