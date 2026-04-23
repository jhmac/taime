import { useState, useEffect, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { BarChart, Bar, ResponsiveContainer, Tooltip, Cell } from "recharts";
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
  ChevronDown, ChevronUp, Wand2, Check, X, RefreshCw
} from "lucide-react";

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
}: {
  shift: ProposedShift;
  openMin: number;
  closeMin: number;
  onClick: () => void;
  isSelected: boolean;
  isExcluded: boolean;
  onToggleExclude: (e: React.MouseEvent) => void;
  hasConflict: boolean;
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
    <button
      onClick={isExcluded ? onToggleExclude : onClick}
      title={title}
      style={{ top: `${topPct}%`, height: `${heightPct}%` }}
      className={cn(
        "absolute inset-x-0.5 rounded-md px-1.5 py-0.5 text-left transition-all overflow-hidden group",
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
      <div className={cn("truncate", isExcluded && "line-through")}>{shift.employeeName}</div>
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

  const maxRev = Math.max(...data.hourlyData.map((h) => h.revenue), 1);
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
    <div className="mb-4">
      <div className="flex items-center justify-between mb-1">
        <span className="text-[11px] font-medium text-muted-foreground flex items-center gap-1">
          <TrendingUp className="h-3 w-3" />
          Projected Revenue
        </span>
        <span className="text-[11px] font-semibold text-foreground">{dailyFmt} total</span>
      </div>
      <div className="h-20 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data.hourlyData} margin={{ top: 2, right: 0, bottom: 0, left: 0 }}>
            <Tooltip
              cursor={false}
              content={({ active, payload }) => {
                if (!active || !payload?.[0]) return null;
                const d = payload[0].payload as HourlyData;
                return (
                  <div className="bg-popover border border-border rounded px-2 py-1 text-[10px] shadow">
                    <div className="font-medium">{d.label}</div>
                    <div>${Math.round(d.revenue).toLocaleString()}{d.isPeak ? " · peak" : ""}</div>
                  </div>
                );
              }}
            />
            <Bar dataKey="revenue" radius={[2, 2, 0, 0]} maxBarSize={20}>
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
      <div className="flex items-center justify-between mt-0.5">
        <span className="text-[9px] text-muted-foreground">{data.hourlyData[0]?.label}</span>
        <span className="text-[9px] text-muted-foreground italic">
          Based on {historicalLabel}
        </span>
        <span className="text-[9px] text-muted-foreground">{data.hourlyData[data.hourlyData.length - 1]?.label}</span>
      </div>
      <div className="flex items-center gap-3 mt-1">
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
}) {
  const open = storeHours?.open || suggestData?.storeHours?.open || "09:00";
  const close = storeHours?.close || suggestData?.storeHours?.close || "21:00";
  const openMin = timeToMin(open);
  const closeMin = timeToMin(close);
  const totalMin = closeMin - openMin;

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
            className="relative flex flex-1 border border-border/50 rounded-lg bg-muted/20 overflow-hidden"
            style={{ height: Math.max(160, Math.min(300, totalMin * 0.6)) }}
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
                  onClick={() => onSelectShift(shift, idx)}
                  onToggleExclude={(e) => { e.stopPropagation(); onToggleExclude(idx); }}
                  hasConflict={conflictingEmployeeIds.has(shift.employeeId)}
                />
              </div>
            ))}
          </div>
        </div>
      )}
      {shifts.length > 0 && (
        <div className="flex items-center justify-between mt-1.5">
          <p className="text-[9px] text-muted-foreground">
            Click a block to pre-fill the form →
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

  useEffect(() => {
    if (open) {
      setModalDate(defaultDate || "");
      setModalStartTime(defaultStartTime || "09:00");
      setModalEndTime(defaultEndTime || "17:00");
      setSelectedUserId(defaultUserId || "");
      setSelectedShiftIdx(null);
      setExcludedIdxs(new Set());
    }
  }, [open, defaultDate, defaultUserId, defaultStartTime, defaultEndTime]);

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
      const res = await apiRequest("POST", "/api/schedules/suggest", { date: modalDate });
      return res.json();
    },
    enabled: open && !!modalDate,
    staleTime: 5 * 60_000,
    gcTime: 10 * 60_000,
    retry: 1,
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
    setSelectedShiftIdx(idx === selectedShiftIdx ? null : idx);
    setSelectedUserId(shift.employeeId);
    setModalStartTime(shift.startTime);
    setModalEndTime(shift.endTime);
  };

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    const userId = formData.get("userId") as string;
    const startDate = formData.get("startDate") as string;
    const startTime = formData.get("startTime") as string;
    const endTime = formData.get("endTime") as string;
    onCreateShift({
      userId,
      startTime: new Date(`${startDate}T${startTime}`),
      endTime: new Date(`${startDate}T${endTime}`),
      title: (formData.get("title") as string) || undefined,
      locationId: (formData.get("locationId") as string) || undefined,
      description: (formData.get("description") as string) || undefined,
    });
  };

  const proposedShifts = suggestData?.proposedShifts ?? [];
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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[96vw] max-w-[920px] max-h-[92vh] flex flex-col p-0 gap-0 overflow-hidden">
        <DialogHeader className="px-5 py-3 border-b flex-shrink-0">
          <DialogTitle className="text-sm flex items-center gap-2">
            <Clock className="h-4 w-4" />
            Create Shift
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
                  onClick={() => refetchSuggest()}
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
              <SalesChart data={salesData} isLoading={salesLoading && !!modalDate} />

              {/* Divider */}
              <div className="border-t border-border/40" />

              {/* Day-view timeline */}
              <DayTimeline
                suggestData={suggestData}
                isLoading={suggestLoading && !!modalDate}
                isError={suggestError}
                errorMsg={suggestError ? (suggestErrorObj as Error)?.message : undefined}
                storeHours={storeHours}
                selectedIdx={selectedShiftIdx}
                onSelectShift={handleSelectShift}
                excludedIdxs={excludedIdxs}
                onToggleExclude={handleToggleExclude}
                conflictingEmployeeIds={conflictingEmployeeIds}
              />
            </div>
          </div>

          {/* ── RIGHT PANEL ── */}
          <div className="md:w-[45%] flex flex-col min-h-0 overflow-y-auto">
            <form onSubmit={handleSubmit} className="px-4 py-3 space-y-3 flex-1">
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
                  onValueChange={setSelectedUserId}
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
                    onChange={(e) => setModalStartTime(e.target.value)}
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
                    onChange={(e) => setModalEndTime(e.target.value)}
                  />
                </div>
              </div>

              <div>
                <Label className="text-xs">Role/Title (optional)</Label>
                <Input
                  name="title"
                  className="h-8 text-sm"
                  placeholder="e.g., Opener, Closer"
                />
              </div>

              <div>
                <Label className="text-xs">Location</Label>
                <Select
                  name="locationId"
                  key={`loc-${open}-${locations[0]?.id}`}
                  defaultValue={locations[0]?.id ?? ""}
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
                />
              </div>

              {/* AI Auto-Assign */}
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

              <div className="flex justify-end gap-2 pt-1 pb-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => onOpenChange(false)}
                >
                  Cancel
                </Button>
                <Button type="submit" size="sm" disabled={isCreating}>
                  {isCreating ? "Creating..." : "Create Shift"}
                </Button>
              </div>
            </form>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
