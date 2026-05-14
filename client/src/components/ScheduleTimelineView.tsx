import { useState, useRef, useCallback, useEffect, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { cn } from "@/lib/utils";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { Schedule, User } from "@shared/schema";
import type { AiScheduleEntry } from "@/lib/aiScheduleEditing";
import { ChevronLeft, ChevronRight, Circle } from "lucide-react";

// Constants
const DAY_START_HOUR = 6;
const DAY_END_HOUR   = 22;
const TOTAL_HOURS    = DAY_END_HOUR - DAY_START_HOUR;

const DEFAULT_WEEK_HOUR_PX = 60;
const DEFAULT_DAY_HOUR_PX  = 80;
const SNAP_MINUTES = 15;
const MIN_HOUR_PX  = 40;
const MAX_HOUR_PX  = 160;

// Mobile breakpoint (md = 768px)
const MOBILE_BREAKPOINT = 768;

// Colour helpers
const COLOR_KEYS = [
  'violet','blue','emerald','amber','rose','cyan','pink','indigo','teal','orange',
] as const;
type ColorKey = typeof COLOR_KEYS[number];

function colorKeyFromId(id: string): ColorKey {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = id.charCodeAt(i) + ((h << 5) - h);
  return COLOR_KEYS[Math.abs(h) % COLOR_KEYS.length];
}

const COLOR_CLASSES: Record<ColorKey, { block: string; text: string; border: string }> = {
  violet:  { block:'bg-violet-500 dark:bg-violet-600', text:'text-white', border:'border-violet-600 dark:border-violet-500' },
  blue:    { block:'bg-blue-500 dark:bg-blue-600',     text:'text-white', border:'border-blue-600 dark:border-blue-500' },
  emerald: { block:'bg-emerald-500 dark:bg-emerald-600',text:'text-white', border:'border-emerald-600 dark:border-emerald-500' },
  amber:   { block:'bg-amber-500 dark:bg-amber-600',   text:'text-white', border:'border-amber-600 dark:border-amber-500' },
  rose:    { block:'bg-rose-500 dark:bg-rose-600',     text:'text-white', border:'border-rose-600 dark:border-rose-500' },
  cyan:    { block:'bg-cyan-500 dark:bg-cyan-600',     text:'text-white', border:'border-cyan-600 dark:border-cyan-500' },
  pink:    { block:'bg-pink-500 dark:bg-pink-600',     text:'text-white', border:'border-pink-600 dark:border-pink-500' },
  indigo:  { block:'bg-indigo-500 dark:bg-indigo-600', text:'text-white', border:'border-indigo-600 dark:border-indigo-500' },
  teal:    { block:'bg-teal-500 dark:bg-teal-600',     text:'text-white', border:'border-teal-600 dark:border-teal-500' },
  orange:  { block:'bg-orange-500 dark:bg-orange-600', text:'text-white', border:'border-orange-600 dark:border-orange-500' },
};

function getColors(userId: string) {
  return COLOR_CLASSES[colorKeyFromId(userId)];
}

// Utilities
function formatLocalDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

function formatHour(h: number): string {
  if (h === 0)  return '12 AM';
  if (h === 12) return '12 PM';
  return h < 12 ? `${h} AM` : `${h - 12} PM`;
}

function formatTimeShort(date: Date): string {
  const h = date.getHours(), m = date.getMinutes();
  const h12 = h % 12 || 12;
  const ap = h >= 12 ? 'pm' : 'am';
  return m === 0 ? `${h12}${ap}` : `${h12}:${String(m).padStart(2,'0')}${ap}`;
}

function snapToGrid(minutes: number): number {
  return Math.round(minutes / SNAP_MINUTES) * SNAP_MINUTES;
}

function minutesFromMidnight(date: Date): number {
  return date.getHours() * 60 + date.getMinutes();
}

function clamp(val: number, min: number, max: number) {
  return Math.max(min, Math.min(max, val));
}

// Types
export type ScheduleSubView = 'day' | 'week' | 'month' | 'year';

interface Props {
  subView: ScheduleSubView;
  onSubViewChange: (v: ScheduleSubView) => void;
  schedules: Schedule[];
  pendingShifts?: AiScheduleEntry[];
  users: User[];
  weekDates: Date[];
  selectedWeek: number;
  onWeekChange: (w: number) => void;
  onEditSchedule: (s: Schedule) => void;
  onCreateShift: (date: string, startTime: string) => void;
  isAdmin: boolean;
  selectedScheduleId?: string | null;
}

// Overlap layout
interface PositionedShift {
  schedule: Schedule;
  col: number;
  totalCols: number;
}

function layoutOverlapping(shifts: Schedule[]): PositionedShift[] {
  if (!shifts.length) return [];
  const sorted = [...shifts].sort((a, b) =>
    new Date(a.startTime).getTime() - new Date(b.startTime).getTime()
  );
  const columns: Schedule[][] = [];
  for (const s of sorted) {
    const sStart = new Date(s.startTime).getTime();
    placed: {
      for (let ci = 0; ci < columns.length; ci++) {
        const last = columns[ci][columns[ci].length - 1];
        if (new Date(last.endTime).getTime() <= sStart) {
          columns[ci].push(s);
          break placed;
        }
      }
      columns.push([s]);
    }
  }
  const result: PositionedShift[] = [];
  for (let ci = 0; ci < columns.length; ci++) {
    for (const s of columns[ci]) {
      const sStart = new Date(s.startTime).getTime();
      const sEnd   = new Date(s.endTime).getTime();
      const concurrent = columns.filter(col =>
        col.some(x =>
          new Date(x.startTime).getTime() < sEnd &&
          new Date(x.endTime).getTime()   > sStart
        )
      ).length;
      result.push({ schedule: s, col: ci, totalCols: concurrent });
    }
  }
  return result;
}

// Drag state
type DragEdge = 'top' | 'bottom';
interface DragState {
  scheduleId: string;
  edge: DragEdge;
  originalMs: number;
  pixelsPerMinute: number;
  startY: number;
  currentMs: number;
}

// ── usePinchZoom ──────────────────────────────────────────────────────────────
// Reads the distance between two touch points on the container and maps the
// scale ratio to hourPx state (clamped 40–160). Only activates on 2-finger
// touches so single-finger scroll and swipe are not affected.
function usePinchZoom(
  containerRef: React.RefObject<HTMLElement>,
  hourPx: number,
  setHourPx: (px: number) => void,
  disabled?: boolean
): React.MutableRefObject<boolean> {
  const isPinchingRef = useRef(false);
  const initialDistRef = useRef(0);
  const initialHourPxRef = useRef(hourPx);

  useEffect(() => {
    const el = containerRef.current;
    if (!el || disabled) return;

    function getTouchDist(t: TouchList): number {
      const dx = t[0].clientX - t[1].clientX;
      const dy = t[0].clientY - t[1].clientY;
      return Math.hypot(dx, dy);
    }

    function onTouchStart(e: TouchEvent) {
      if (e.touches.length === 2) {
        isPinchingRef.current = true;
        initialDistRef.current = getTouchDist(e.touches);
        initialHourPxRef.current = hourPx;
        e.preventDefault();
      }
    }

    function onTouchMove(e: TouchEvent) {
      if (!isPinchingRef.current || e.touches.length !== 2) return;
      const d = getTouchDist(e.touches);
      if (initialDistRef.current === 0) return;
      const scale = d / initialDistRef.current;
      const newPx = clamp(Math.round(initialHourPxRef.current * scale), MIN_HOUR_PX, MAX_HOUR_PX);
      setHourPx(newPx);
      e.preventDefault();
    }

    function onTouchEnd(e: TouchEvent) {
      if (e.touches.length < 2) {
        isPinchingRef.current = false;
      }
    }

    el.addEventListener('touchstart', onTouchStart, { passive: false });
    el.addEventListener('touchmove', onTouchMove, { passive: false });
    el.addEventListener('touchend', onTouchEnd);
    el.addEventListener('touchcancel', onTouchEnd);
    return () => {
      el.removeEventListener('touchstart', onTouchStart);
      el.removeEventListener('touchmove', onTouchMove);
      el.removeEventListener('touchend', onTouchEnd);
      el.removeEventListener('touchcancel', onTouchEnd);
    };
  }, [containerRef, hourPx, setHourPx, disabled]);

  return isPinchingRef;
}

// ── useSwipeNav ───────────────────────────────────────────────────────────────
// A fast single-finger horizontal swipe (≥ 50 px, < 300 ms, not part of a
// pinch) triggers next/previous navigation. Guards against vertical scroll and
// active pinch gestures.
function useSwipeNav(
  containerRef: React.RefObject<HTMLElement>,
  onSwipeLeft: () => void,
  onSwipeRight: () => void,
  isPinchingRef: React.MutableRefObject<boolean>,
  disabled?: boolean
) {
  const startXRef = useRef(0);
  const startYRef = useRef(0);
  const startTimeRef = useRef(0);
  const touchCountRef = useRef(0);

  useEffect(() => {
    const el = containerRef.current;
    if (!el || disabled) return;

    function onTouchStart(e: TouchEvent) {
      touchCountRef.current = e.touches.length;
      if (e.touches.length !== 1) return;
      startXRef.current = e.touches[0].clientX;
      startYRef.current = e.touches[0].clientY;
      startTimeRef.current = Date.now();
    }

    function onTouchEnd(e: TouchEvent) {
      if (touchCountRef.current !== 1 || isPinchingRef.current) return;
      const t = e.changedTouches[0];
      const dx = t.clientX - startXRef.current;
      const dy = t.clientY - startYRef.current;
      const dt = Date.now() - startTimeRef.current;
      // Must be horizontal, fast, and primarily horizontal
      if (dt < 300 && Math.abs(dx) >= 50 && Math.abs(dx) > Math.abs(dy) * 1.5) {
        if (dx < 0) onSwipeLeft();
        else onSwipeRight();
      }
    }

    el.addEventListener('touchstart', onTouchStart, { passive: true });
    el.addEventListener('touchend', onTouchEnd, { passive: true });
    return () => {
      el.removeEventListener('touchstart', onTouchStart);
      el.removeEventListener('touchend', onTouchEnd);
    };
  }, [containerRef, onSwipeLeft, onSwipeRight, isPinchingRef, disabled]);
}

// ShiftBlock
function ShiftBlock({
  positioned,
  user,
  hourPx,
  onEdit,
  onDragStart,
  dragState,
  isSelected,
  isMobile,
}: {
  positioned: PositionedShift;
  user: User | undefined;
  hourPx: number;
  onEdit: (s: Schedule) => void;
  onDragStart: (e: React.MouseEvent | React.TouchEvent, s: Schedule, edge: DragEdge) => void;
  dragState: DragState | null;
  isSelected?: boolean;
  isMobile?: boolean;
}) {
  const { schedule: s, col, totalCols } = positioned;
  const isDragging = dragState?.scheduleId === s.id;

  const startMs = isDragging && dragState.edge === 'top'    ? dragState.currentMs : new Date(s.startTime).getTime();
  const endMs   = isDragging && dragState.edge === 'bottom'  ? dragState.currentMs : new Date(s.endTime).getTime();

  const startMin    = minutesFromMidnight(new Date(startMs));
  const endMin      = minutesFromMidnight(new Date(endMs));
  const dayStartMin = DAY_START_HOUR * 60;

  const top    = ((startMin - dayStartMin) / 60) * hourPx;
  const height = Math.max(((endMin - startMin) / 60) * hourPx, isMobile ? 56 : hourPx * 0.25);

  const widthPct = 100 / totalCols;
  const leftPct  = col * widthPct;

  const displayName = user
    ? `${user.firstName ?? ''} ${user.lastName ?? ''}`.trim()
      || user.email
      || (user as any).username
      || 'Unknown'
    : 'Unknown';
  const colors = getColors(s.userId);
  const timeLabel = `${formatTimeShort(new Date(startMs))}–${formatTimeShort(new Date(endMs))}`;
  const showRole = !!s.title && height >= 60;
  const showTime = height >= 40;

  // On mobile: drag handles are 44px tall (WCAG 2.5.5 touch target minimum).
  // onClick is NOT stopped on the handle divs so tap-to-edit still bubbles to the
  // outer block div. Only drag gesture initiation (onTouchStart/onMouseDown) is intercepted.
  const handleHeight = isMobile ? 44 : 8;
  const handleOpacityClass = isMobile ? "opacity-40" : "opacity-0 hover:opacity-60";

  return (
    <div
      className={cn(
        "absolute border-2 rounded-md overflow-hidden select-none transition-shadow",
        colors.block, colors.border,
        isDragging && "shadow-lg ring-2 ring-primary/40 z-30",
        isSelected && !isDragging && "ring-2 ring-white ring-offset-1 shadow-xl z-20 border-white/60",
        !isDragging && !isSelected && "z-10 hover:z-20 hover:shadow-md",
      )}
      style={{
        top:      `${top}px`,
        height:   `${height}px`,
        left:     `calc(${leftPct}% + 1px)`,
        width:    `calc(${widthPct}% - 2px)`,
        cursor:   'pointer',
        minHeight: isMobile ? '56px' : '44px',
        touchAction: isDragging ? 'none' : 'auto',
      }}
      onClick={(e) => { e.stopPropagation(); onEdit(s); }}
      title={`${displayName}: ${timeLabel}${s.title ? ` · ${s.title}` : ''}`}
    >
      {/* Top drag handle — 44px hit area on mobile */}
      <div
        className={cn(
          "absolute top-0 left-0 right-0 cursor-ns-resize flex items-center justify-center transition-opacity",
          handleOpacityClass
        )}
        style={{ height: `${handleHeight}px`, zIndex: 10 }}
        onMouseDown={e => { e.stopPropagation(); onDragStart(e, s, 'top'); }}
        onTouchStart={e => { e.stopPropagation(); onDragStart(e, s, 'top'); }}
        // No onClick stopPropagation — taps bubble to the outer block's onEdit handler
      >
        <div className="w-8 h-0.5 rounded-full bg-current opacity-40" />
      </div>

      {/* Content — fills the full block, sits behind handles (z-index 1); clickable for edit */}
      <div
        className={cn("absolute inset-0 px-1.5 pt-1 pb-1 flex flex-col gap-0", colors.text)}
        style={{ zIndex: 1 }}
      >
        <span className="text-[10px] font-semibold truncate leading-tight">{displayName}</span>
        {showRole && <span className="text-[8px] opacity-60 truncate leading-tight">{s.title}</span>}
        {showTime && <span className="text-[9px] opacity-70 truncate">{timeLabel}</span>}
      </div>

      {/* Bottom drag handle — 44px touch target on mobile */}
      <div
        className={cn(
          "absolute bottom-0 left-0 right-0 cursor-ns-resize flex items-center justify-center transition-opacity",
          handleOpacityClass
        )}
        style={{ height: `${handleHeight}px`, zIndex: 10 }}
        onMouseDown={e => { e.stopPropagation(); onDragStart(e, s, 'bottom'); }}
        onTouchStart={e => { e.stopPropagation(); onDragStart(e, s, 'bottom'); }}
        // No onClick stopPropagation — taps bubble to the outer block's onEdit handler
      >
        <div className="w-8 h-0.5 rounded-full bg-current opacity-40" />
      </div>
    </div>
  );
}

// Unified layout: places confirmed + pending shifts side-by-side without overlap
type UnifiedItem =
  | { isPending: false; id: string; startMs: number; endMs: number; schedule: Schedule }
  | { isPending: true;  id: string; startMs: number; endMs: number; entry: AiScheduleEntry };

interface PositionedUnified { item: UnifiedItem; col: number; totalCols: number; }

function layoutUnified(confirmed: Schedule[], pending: AiScheduleEntry[], date: Date): PositionedUnified[] {
  const dayStr = formatLocalDate(date);
  const confirmedItems = confirmed.map(s => ({
    isPending: false as const,
    id: s.id,
    startMs: new Date(s.startTime).getTime(),
    endMs:   new Date(s.endTime).getTime(),
    schedule: s,
  }));
  const filteredPending = pending.filter(e => {
    if (e.date !== dayStr) return false;
    const [sh, sm] = e.startTime.split(':').map(Number);
    const [eh, em] = e.endTime.split(':').map(Number);
    const pStart = new Date(date); pStart.setHours(sh, sm, 0, 0);
    const pEnd   = new Date(date); pEnd.setHours(eh, em, 0, 0);
    const pStartMs = pStart.getTime();
    const pEndMs   = pEnd.getTime();
    return !confirmed.some(
      s => s.userId === e.employeeId &&
        new Date(s.startTime).getTime() < pEndMs &&
        new Date(s.endTime).getTime() > pStartMs,
    );
  });
  const all: UnifiedItem[] = [
    ...confirmedItems,
    ...filteredPending.map(e => {
      const [sh, sm] = e.startTime.split(':').map(Number);
      const [eh, em] = e.endTime.split(':').map(Number);
      const start = new Date(date); start.setHours(sh, sm, 0, 0);
      const end   = new Date(date); end.setHours(eh, em, 0, 0);
      return {
        isPending: true as const,
        id: `pending-${e.employeeId}-${e.startTime}`,
        startMs: start.getTime(),
        endMs:   end.getTime(),
        entry: e,
      };
    }),
  ].sort((a, b) => a.startMs - b.startMs);

  const columns: UnifiedItem[][] = [];
  for (const s of all) {
    let placed = false;
    for (const col of columns) {
      const last = col[col.length - 1];
      if (last.endMs <= s.startMs) { col.push(s); placed = true; break; }
    }
    if (!placed) columns.push([s]);
  }

  const result: PositionedUnified[] = [];
  for (let ci = 0; ci < columns.length; ci++) {
    for (const s of columns[ci]) {
      const concurrent = columns.filter(col =>
        col.some(x => x.startMs < s.endMs && x.endMs > s.startMs)
      ).length;
      result.push({ item: s, col: ci, totalCols: concurrent });
    }
  }
  return result;
}

// PendingShiftBlock — purple dashed block for AI-proposed shifts, positioned side-by-side
function PendingShiftBlock({ entry, hourPx, col, totalCols, isMobile }: {
  entry: AiScheduleEntry;
  hourPx: number;
  col: number;
  totalCols: number;
  isMobile?: boolean;
}) {
  const [sh, sm] = entry.startTime.split(':').map(Number);
  const [eh, em] = entry.endTime.split(':').map(Number);
  const startMin    = sh * 60 + sm;
  const endMin      = eh * 60 + em;
  const dayStartMin = DAY_START_HOUR * 60;
  const top    = ((startMin - dayStartMin) / 60) * hourPx;
  const height = Math.max(((endMin - startMin) / 60) * hourPx, isMobile ? 40 : 28);
  const widthPct = 100 / totalCols;
  const leftPct  = col * widthPct;
  const h12s = sh % 12 || 12, aps = sh >= 12 ? 'pm' : 'am';
  const h12e = eh % 12 || 12, ape = eh >= 12 ? 'pm' : 'am';
  const timeLabel = `${h12s}${sm > 0 ? ':' + String(sm).padStart(2,'0') : ''}${aps}–${h12e}${em > 0 ? ':' + String(em).padStart(2,'0') : ''}${ape}`;
  const showTime = height >= 40;
  return (
    <div
      className="absolute rounded-md overflow-hidden border-2 border-dashed border-violet-400 dark:border-violet-500 bg-violet-100/70 dark:bg-violet-900/40 z-[5] pointer-events-auto cursor-default"
      onClick={e => e.stopPropagation()}
      style={{
        top: `${top}px`,
        height: `${height}px`,
        left: `calc(${leftPct}% + 1px)`,
        width: `calc(${widthPct}% - 2px)`,
      }}
      title={`Pending: ${entry.employeeName} · ${timeLabel}`}
    >
      <div className="px-1.5 pt-0.5 flex flex-col gap-0">
        <span className="text-[8px] font-bold uppercase tracking-wide text-violet-600 dark:text-violet-300 leading-tight">Pending</span>
        <span className="text-[10px] font-semibold truncate leading-tight text-violet-700 dark:text-violet-200">{entry.employeeName}</span>
        {showTime && <span className="text-[9px] truncate text-violet-600/80 dark:text-violet-300/80">{timeLabel}</span>}
      </div>
    </div>
  );
}

// CurrentTimeLine — red horizontal line at the current hour in Day/Week views
function CurrentTimeLine({ hourPx, nowSentinelRef }: {
  hourPx: number;
  nowSentinelRef?: React.RefObject<HTMLDivElement>;
}) {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const tick = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(tick);
  }, []);

  const startMin = DAY_START_HOUR * 60;
  const endMin   = DAY_END_HOUR   * 60;
  const nowMin   = now.getHours() * 60 + now.getMinutes();

  if (nowMin < startMin || nowMin > endMin) return null;

  const top = ((nowMin - startMin) / 60) * hourPx;

  return (
    <div
      className="absolute left-0 right-0 z-20 pointer-events-none"
      style={{ top: `${top}px` }}
    >
      {/* Sentinel div for IntersectionObserver */}
      <div ref={nowSentinelRef} className="absolute -top-1 left-0 w-1 h-2" aria-hidden="true" />
      <div className="flex items-center">
        <div className="w-2 h-2 rounded-full bg-red-500 shrink-0 -ml-1" />
        <div className="flex-1 h-px bg-red-500 opacity-80" />
      </div>
    </div>
  );
}

// DayColumn
function DayColumn({
  date,
  shifts,
  pendingShifts,
  users,
  hourPx,
  onEdit,
  onDragStart,
  dragState,
  onSlotClick,
  isToday,
  selectedScheduleId,
  isMobile,
  showNowLine,
  nowSentinelRef,
}: {
  date: Date;
  shifts: Schedule[];
  pendingShifts?: AiScheduleEntry[];
  users: User[];
  hourPx: number;
  onEdit: (s: Schedule) => void;
  onDragStart: (e: React.MouseEvent | React.TouchEvent, s: Schedule, edge: DragEdge) => void;
  dragState: DragState | null;
  onSlotClick: (date: Date, startTime: string) => void;
  isToday: boolean;
  selectedScheduleId?: string | null;
  isMobile?: boolean;
  showNowLine?: boolean;
  nowSentinelRef?: React.RefObject<HTMLDivElement>;
}) {
  const totalHeight   = TOTAL_HOURS * hourPx;
  const positionedAll = useMemo(
    () => layoutUnified(shifts, pendingShifts ?? [], date),
    [shifts, pendingShifts, date]
  );

  const handleColumnClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const y = e.clientY - rect.top;
    const rawMinutes   = (y / hourPx) * 60;
    const snapped      = snapToGrid(rawMinutes);
    const totalMinutes = DAY_START_HOUR * 60 + snapped;
    const clampedMin   = clamp(totalMinutes, DAY_START_HOUR * 60, DAY_END_HOUR * 60 - SNAP_MINUTES);
    const hh = String(Math.floor(clampedMin / 60)).padStart(2, '0');
    const mm = String(clampedMin % 60).padStart(2, '0');
    onSlotClick(date, `${hh}:${mm}`);
  }, [hourPx, date, onSlotClick]);

  return (
    <div
      className={cn("relative h-full", isToday && "bg-primary/[0.03]")}
      style={{ minHeight: `${totalHeight}px`, minWidth: 0 }}
      onClick={handleColumnClick}
    >
      {Array.from({ length: TOTAL_HOURS * 4 }).map((_, qi) => {
        const isHour = qi % 4 === 0;
        const isHalf = qi % 4 === 2;
        const top    = (qi / 4) * hourPx;
        return (
          <div
            key={qi}
            className={cn(
              "absolute left-0 right-0 border-t",
              isHour ? "border-border/30" : isHalf ? "border-border/15 border-dashed" : "border-border/[0.07] border-dotted"
            )}
            style={{ top: `${top}px` }}
          />
        );
      })}

      {/* Current-time line (only in today's column) */}
      {showNowLine && isToday && (
        <CurrentTimeLine hourPx={hourPx} nowSentinelRef={nowSentinelRef} />
      )}

      {positionedAll.map(p =>
        p.item.isPending ? (
          <PendingShiftBlock
            key={p.item.id}
            entry={p.item.entry}
            hourPx={hourPx}
            col={p.col}
            totalCols={p.totalCols}
            isMobile={isMobile}
          />
        ) : (
          <ShiftBlock
            key={p.item.id}
            positioned={{ schedule: p.item.schedule, col: p.col, totalCols: p.totalCols }}
            user={users.find(u => u.id === p.item.schedule.userId)}
            hourPx={hourPx}
            onEdit={onEdit}
            onDragStart={onDragStart}
            dragState={dragState}
            isSelected={selectedScheduleId === p.item.schedule.id}
            isMobile={isMobile}
          />
        )
      )}
    </div>
  );
}

// TimeLabels
function TimeLabels({ hourPx }: { hourPx: number }) {
  return (
    <div className="relative shrink-0" style={{ width: '48px' }}>
      {Array.from({ length: TOTAL_HOURS + 1 }).map((_, hi) => (
        <div
          key={hi}
          className="absolute right-2 text-[10px] text-muted-foreground leading-none"
          style={{ top: `${hi * hourPx - 6}px` }}
        >
          {formatHour(DAY_START_HOUR + hi)}
        </div>
      ))}
    </div>
  );
}

// DayView
function DayView({
  date,
  schedules,
  pendingShifts,
  users,
  hourPx,
  onEdit,
  onDragStart,
  dragState,
  onSlotClick,
  selectedScheduleId,
  isMobile,
  containerRef,
  nowSentinelRef,
}: {
  date: Date;
  schedules: Schedule[];
  pendingShifts?: AiScheduleEntry[];
  users: User[];
  hourPx: number;
  onEdit: (s: Schedule) => void;
  onDragStart: (e: React.MouseEvent | React.TouchEvent, s: Schedule, edge: DragEdge) => void;
  dragState: DragState | null;
  onSlotClick: (date: Date, startTime: string) => void;
  selectedScheduleId?: string | null;
  isMobile?: boolean;
  containerRef?: React.RefObject<HTMLDivElement>;
  nowSentinelRef?: React.RefObject<HTMLDivElement>;
}) {
  const dayStr    = formatLocalDate(date);
  const dayShifts = schedules.filter(s => formatLocalDate(new Date(s.startTime)) === dayStr);
  const isToday   = date.toDateString() === new Date().toDateString();

  return (
    <div
      ref={containerRef}
      className="flex-1 overflow-y-auto"
      style={{ touchAction: dragState ? 'none' : 'pan-y' }}
    >
      <div className="flex" style={{ minHeight: `${TOTAL_HOURS * hourPx}px` }}>
        <TimeLabels hourPx={hourPx} />
        <div className="flex-1 relative">
          <DayColumn
            date={date}
            shifts={dayShifts}
            pendingShifts={pendingShifts}
            users={users}
            hourPx={hourPx}
            onEdit={onEdit}
            onDragStart={onDragStart}
            dragState={dragState}
            onSlotClick={onSlotClick}
            isToday={isToday}
            selectedScheduleId={selectedScheduleId}
            isMobile={isMobile}
            showNowLine
            nowSentinelRef={nowSentinelRef}
          />
        </div>
      </div>
    </div>
  );
}

// MobileWeekStrip — 7-day pill strip for mobile week view
function MobileWeekStrip({
  weekDates,
  visibleDates,
  onDayTap,
}: {
  weekDates: Date[];
  visibleDates: Date[];
  onDayTap: (date: Date) => void;
}) {
  const today = new Date().toDateString();
  const visibleSet = new Set(visibleDates.map(d => d.toDateString()));

  return (
    <div className="flex items-center justify-around px-2 py-2 bg-background border-b gap-1">
      {weekDates.map((date) => {
        const isToday = date.toDateString() === today;
        const isVisible = visibleSet.has(date.toDateString());
        return (
          <button
            key={date.toISOString()}
            onClick={() => onDayTap(date)}
            className={cn(
              "flex flex-col items-center gap-0.5 flex-1 min-w-0 py-1 px-1 rounded-lg transition-colors",
              isVisible
                ? "bg-primary/10 text-primary"
                : "text-muted-foreground hover:bg-muted"
            )}
          >
            <span className="text-[9px] font-medium uppercase">
              {date.toLocaleDateString('en-US', { weekday: 'short' })}
            </span>
            <span className={cn(
              "text-[13px] font-semibold leading-tight rounded-full w-7 h-7 flex items-center justify-center",
              isToday && "bg-primary text-primary-foreground",
              isVisible && !isToday && "text-primary",
            )}>
              {date.getDate()}
            </span>
          </button>
        );
      })}
    </div>
  );
}

// WeekView
function WeekView({
  weekDates,
  schedules,
  pendingShifts,
  users,
  hourPx,
  onEdit,
  onDragStart,
  dragState,
  onSlotClick,
  selectedScheduleId,
  isMobile,
  mobileDayCenter,
  onMobileDayCenterChange,
  containerRef,
  nowSentinelRef,
}: {
  weekDates: Date[];
  schedules: Schedule[];
  pendingShifts?: AiScheduleEntry[];
  users: User[];
  hourPx: number;
  onEdit: (s: Schedule) => void;
  onDragStart: (e: React.MouseEvent | React.TouchEvent, s: Schedule, edge: DragEdge) => void;
  dragState: DragState | null;
  onSlotClick: (date: Date, startTime: string) => void;
  selectedScheduleId?: string | null;
  isMobile?: boolean;
  mobileDayCenter?: Date;
  onMobileDayCenterChange?: (date: Date) => void;
  containerRef?: React.RefObject<HTMLDivElement>;
  nowSentinelRef?: React.RefObject<HTMLDivElement>;
}) {
  const today = new Date().toDateString();

  // On mobile: show 3-day sliding window centred on mobileDayCenter
  const displayDates = useMemo(() => {
    if (!isMobile || !mobileDayCenter) return weekDates;
    const centerIdx = weekDates.findIndex(d => d.toDateString() === mobileDayCenter.toDateString());
    const ci = centerIdx >= 0 ? centerIdx : Math.round(weekDates.length / 2) - 1;
    const start = clamp(ci - 1, 0, weekDates.length - 3);
    return weekDates.slice(start, start + 3);
  }, [isMobile, mobileDayCenter, weekDates]);

  return (
    <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
      {/* Mobile 7-day strip above the grid */}
      {isMobile && (
        <MobileWeekStrip
          weekDates={weekDates}
          visibleDates={displayDates}
          onDayTap={(date) => onMobileDayCenterChange?.(date)}
        />
      )}

      <div
        ref={containerRef}
        className="flex-1 overflow-auto"
        style={{ touchAction: dragState ? 'none' : 'pan-y' }}
      >
        {/* Desktop sticky day header */}
        {!isMobile && (
          <div className="sticky top-0 z-20 bg-background border-b flex" style={{ paddingLeft: '48px' }}>
            {weekDates.map((date, i) => {
              const isToday = date.toDateString() === today;
              return (
                <div
                  key={i}
                  className={cn(
                    "flex-1 text-center py-2 border-r last:border-r-0 text-xs font-medium",
                    isToday ? "text-primary" : "text-muted-foreground"
                  )}
                >
                  {date.toLocaleDateString('en-US', { weekday:'short' })} {date.getDate()}
                </div>
              );
            })}
          </div>
        )}

        {/* Mobile compact column header */}
        {isMobile && (
          <div className="sticky top-0 z-20 bg-background border-b flex" style={{ paddingLeft: '48px' }}>
            {displayDates.map((date, i) => {
              const isToday = date.toDateString() === today;
              return (
                <div
                  key={i}
                  className={cn(
                    "flex-1 text-center py-1.5 border-r last:border-r-0 text-xs font-medium",
                    isToday ? "text-primary" : "text-muted-foreground"
                  )}
                >
                  {date.toLocaleDateString('en-US', { weekday:'short' })} {date.getDate()}
                </div>
              );
            })}
          </div>
        )}

        <div className="flex" style={{ minHeight: `${TOTAL_HOURS * hourPx}px` }}>
          <TimeLabels hourPx={hourPx} />
          {displayDates.map((date, i) => {
            const dayStr    = formatLocalDate(date);
            const dayShifts = schedules.filter(s => formatLocalDate(new Date(s.startTime)) === dayStr);
            const isToday   = date.toDateString() === today;
            return (
              <div key={i} className="flex-1 min-w-0 border-r last:border-r-0">
                <DayColumn
                  date={date}
                  shifts={dayShifts}
                  pendingShifts={pendingShifts}
                  users={users}
                  hourPx={hourPx}
                  onEdit={onEdit}
                  onDragStart={onDragStart}
                  dragState={dragState}
                  onSlotClick={onSlotClick}
                  isToday={isToday}
                  selectedScheduleId={selectedScheduleId}
                  isMobile={isMobile}
                  showNowLine
                  nowSentinelRef={isToday ? nowSentinelRef : undefined}
                />
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// MonthView
function MonthView({
  year,
  month,
  schedules,
  users,
  onEdit,
  onDayClick,
  onEmptyDayClick,
  pendingShifts = [],
}: {
  year: number;
  month: number;
  schedules: Schedule[];
  users: User[];
  onEdit: (s: Schedule) => void;
  onDayClick: (date: Date) => void;
  onEmptyDayClick?: (date: Date) => void;
  pendingShifts?: AiScheduleEntry[];
}) {
  const firstDay    = new Date(year, month, 1);
  const lastDay     = new Date(year, month + 1, 0);
  const startDow    = firstDay.getDay();
  const daysInMonth = lastDay.getDate();
  const today       = new Date();

  const cells: (Date | null)[] = [];
  for (let i = 0; i < startDow; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(new Date(year, month, d));

  const dowLabels = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

  return (
    <div className="flex-1 overflow-y-auto p-4">
      <div className="max-w-5xl mx-auto">
        <div className="grid grid-cols-7 gap-1 mb-1">
          {dowLabels.map(d => (
            <div key={d} className="text-center text-[10px] font-medium text-muted-foreground py-1">{d}</div>
          ))}
        </div>
        <div className="grid grid-cols-7 gap-1">
          {cells.map((date, idx) => {
            if (!date) return <div key={`e-${idx}`} className="min-h-[80px]" />;
            const dateStr   = formatLocalDate(date);
            const dayShifts  = schedules.filter(s => formatLocalDate(new Date(s.startTime)) === dateStr);
            const dayPending = pendingShifts.filter(e => e.date === dateStr);
            const isToday    = date.toDateString() === today.toDateString();
            return (
              <div
                key={dateStr}
                className={cn(
                  "min-h-[80px] border rounded-md p-1 cursor-pointer hover:bg-muted/40 transition-colors",
                  isToday && "ring-1 ring-primary bg-primary/5"
                )}
                onClick={() => dayShifts.length === 0 && onEmptyDayClick
                  ? onEmptyDayClick(date)
                  : onDayClick(date)
                }
              >
                <div className={cn("text-xs font-medium mb-1", isToday ? "text-primary" : "text-foreground")}>
                  {date.getDate()}
                </div>
                <div className="space-y-0.5">
                  {dayShifts.slice(0, 3).map(s => {
                    const user   = users.find(u => u.id === s.userId);
                    const uName  = user ? `${user.firstName ?? ''} ${user.lastName ?? ''}`.trim() || user.email || (user as any).username || '' : '';
                    const colors = getColors(s.userId);
                    const dur    = ((new Date(s.endTime).getTime() - new Date(s.startTime).getTime()) / 3600000).toFixed(1);
                    return (
                      <div
                        key={s.id}
                        className={cn("text-[9px] px-1 py-0.5 rounded truncate border", colors.block, colors.text, colors.border)}
                        onClick={e => { e.stopPropagation(); onEdit(s); }}
                        title={`${uName || user?.firstName}: ${formatTimeShort(new Date(s.startTime))}–${formatTimeShort(new Date(s.endTime))}`}
                      >
                        {uName || user?.firstName} {dur}h
                      </div>
                    );
                  })}
                  {dayPending.slice(0, 2).map(e => (
                    <div
                      key={`pending-${e.employeeId}-${e.startTime}-${e.endTime}`}
                      className="text-[9px] px-1 py-0.5 rounded truncate border border-dashed border-violet-400 bg-violet-100/70 text-violet-700 dark:border-violet-500 dark:bg-violet-900/40 dark:text-violet-200"
                      title={`Pending: ${e.employeeName} · ${e.startTime}–${e.endTime}`}
                    >
                      {e.employeeName} ~{e.startTime}
                    </div>
                  ))}
                  {dayShifts.length > 3 && (
                    <div className="text-[9px] text-muted-foreground pl-1">+{dayShifts.length - 3} more</div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// YearView
function YearView({
  year,
  schedules,
  onDayNavigate,
  pendingShifts = [],
}: {
  year: number;
  schedules: Schedule[];
  onDayNavigate: (date: Date) => void;
  pendingShifts?: AiScheduleEntry[];
}) {
  const today = new Date();

  const coverageMap = useMemo(() => {
    const map: Record<string, number> = {};
    for (const s of schedules) {
      const key = formatLocalDate(new Date(s.startTime));
      map[key] = (map[key] || 0) + 1;
    }
    for (const e of pendingShifts) {
      map[e.date] = (map[e.date] || 0) + 1;
    }
    return map;
  }, [schedules, pendingShifts]);

  const maxCoverage = Math.max(1, ...Object.values(coverageMap));

  function heatClass(count: number): string {
    if (!count) return 'bg-muted/40';
    const ratio = count / maxCoverage;
    if (ratio < 0.25) return 'bg-primary/20';
    if (ratio < 0.5)  return 'bg-primary/40';
    if (ratio < 0.75) return 'bg-primary/60';
    return 'bg-primary/90';
  }

  const months = Array.from({ length: 12 }, (_, mi) => {
    const firstDay = new Date(year, mi, 1);
    const lastDay  = new Date(year, mi + 1, 0);
    const startDow = firstDay.getDay();
    const days: (Date | null)[] = [];
    for (let i = 0; i < startDow; i++) days.push(null);
    for (let d = 1; d <= lastDay.getDate(); d++) days.push(new Date(year, mi, d));
    return { name: firstDay.toLocaleDateString('en-US', { month: 'short' }), days };
  });

  return (
    <div className="flex-1 overflow-y-auto p-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6 max-w-5xl mx-auto">
        {months.map(({ name, days }, mi) => (
          <div key={mi}>
            <div className="text-xs font-semibold text-muted-foreground mb-2">{name}</div>
            <div className="grid grid-cols-7 gap-[2px]">
              {['S','M','T','W','T','F','S'].map((d, i) => (
                <div key={i} className="text-center text-[8px] text-muted-foreground/60">{d}</div>
              ))}
              {days.map((date, idx) => {
                if (!date) return <div key={`e-${idx}`} className="w-full aspect-square" />;
                const dateStr = formatLocalDate(date);
                const count   = coverageMap[dateStr] || 0;
                const isToday = date.toDateString() === today.toDateString();
                return (
                  <div
                    key={dateStr}
                    className={cn("w-full aspect-square rounded-sm cursor-pointer hover:opacity-70 transition-opacity", heatClass(count), isToday && "ring-1 ring-primary")}
                    title={`${date.toLocaleDateString()}: ${count} shift${count !== 1 ? 's' : ''}`}
                    onClick={() => onDayNavigate(date)}
                  />
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────
export default function ScheduleTimelineView({
  subView,
  onSubViewChange,
  schedules: weekSchedules,
  pendingShifts,
  users,
  weekDates,
  selectedWeek,
  onWeekChange,
  onEditSchedule,
  onCreateShift,
  isAdmin,
  selectedScheduleId,
}: Props) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Responsive: detect md breakpoint internally
  const [isMobile, setIsMobile] = useState(() => typeof window !== 'undefined' && window.innerWidth < MOBILE_BREAKPOINT);
  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < MOBILE_BREAKPOINT);
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);

  // Reactive hourPx — controlled by pinch-to-zoom, defaults by subview and breakpoint
  const [hourPx, setHourPx] = useState(() => {
    if (typeof window === 'undefined') return DEFAULT_DAY_HOUR_PX;
    // Try to restore from localStorage
    try {
      const saved = localStorage.getItem('scheduleHourPx');
      if (saved !== null) {
        const parsed = Number(saved);
        if (!Number.isNaN(parsed) && parsed >= MIN_HOUR_PX && parsed <= MAX_HOUR_PX) {
          return parsed;
        }
      }
    } catch { /* ignore storage errors */ }
    // Mobile always starts at the compact week density regardless of subview
    if (window.innerWidth < MOBILE_BREAKPOINT) return DEFAULT_WEEK_HOUR_PX;
    // Desktop: match the initial subview for a sensible baseline
    return subView === 'week' ? DEFAULT_WEEK_HOUR_PX : DEFAULT_DAY_HOUR_PX;
  });

  // Debounced localStorage persistence for hourPx
  useEffect(() => {
    const id = setTimeout(() => {
      try {
        localStorage.setItem('scheduleHourPx', String(hourPx));
      } catch { /* ignore storage errors */ }
    }, 500);
    return () => clearTimeout(id);
  }, [hourPx]);

  const defaultHourPx = typeof window !== 'undefined' && window.innerWidth < MOBILE_BREAKPOINT
    ? DEFAULT_WEEK_HOUR_PX
    : subView === 'week' ? DEFAULT_WEEK_HOUR_PX : DEFAULT_DAY_HOUR_PX;

  const handleResetZoom = useCallback(() => {
    setHourPx(defaultHourPx);
    try { localStorage.removeItem('scheduleHourPx'); } catch { /* ignore */ }
  }, [defaultHourPx]);

  // Slide animation state
  const [slideClass, setSlideClass] = useState('');

  // Timeline container refs (for pinch/swipe)
  const timelineContainerRef = useRef<HTMLDivElement>(null);

  // "Now" FAB refs — observer effect is declared after date states below
  const nowSentinelRef = useRef<HTMLDivElement>(null);
  const [showNowFab, setShowNowFab] = useState(false);
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  // Pinch-to-zoom — only active in day/week views
  const isPinchingRef = usePinchZoom(
    timelineContainerRef,
    hourPx,
    useCallback((px: number) => setHourPx(px), []),
    subView === 'month' || subView === 'year'
  );

  // On mobile, restrict to day/week only — reset if currently on month/year
  const effectiveSubView: ScheduleSubView = subView;
  useEffect(() => {
    if (isMobile && (subView === 'month' || subView === 'year')) {
      onSubViewChange('day');
    }
  }, [isMobile, subView, onSubViewChange]);

  // Day view date
  const [dayViewDate, setDayViewDate] = useState<Date>(() => {
    const today = new Date();
    return weekDates.find(d => d.toDateString() === today.toDateString()) || weekDates[0] || today;
  });

  // Mobile week view: center day (starts at today, falls back to first of week)
  const [mobileDayCenter, setMobileDayCenter] = useState<Date>(() => {
    const today = new Date();
    return weekDates.find(d => d.toDateString() === today.toDateString()) || weekDates[1] || today;
  });
  // Preserves swipe-initiated center when navigating across week boundaries
  const pendingMobileCenterRef = useRef<Date | null>(null);

  // IntersectionObserver for the "Now" FAB — declared after date states so deps are in scope
  useEffect(() => {
    const sentinel = nowSentinelRef.current;
    if (!sentinel) {
      // No now-line visible (non-today day or non day/week view) — hide FAB
      setShowNowFab(false);
      return;
    }
    const root = scrollContainerRef.current ?? undefined;
    const observer = new IntersectionObserver(
      ([entry]) => setShowNowFab(!entry.isIntersecting),
      { root, threshold: 0 }
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
    // Re-run when sentinel/container mount, subview changes, or displayed date changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nowSentinelRef.current, scrollContainerRef.current, subView,
      dayViewDate.toDateString(), mobileDayCenter.toDateString()]);

  // Scroll the timeline so the current time is centred in view
  const scrollToNow = useCallback(() => {
    const sentinel = nowSentinelRef.current;
    if (!sentinel) return;
    sentinel.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, []);

  // Month view
  const [monthViewDate, setMonthViewDate] = useState<Date>(() => weekDates[0] || new Date());

  // Year view
  const [yearViewYear, setYearViewYear] = useState<number>(() => (weekDates[0] || new Date()).getFullYear());

  // Keep dayViewDate in sync with week navigation
  useEffect(() => {
    const today = new Date();
    const inWeek = weekDates.find(d => d.toDateString() === today.toDateString());
    setDayViewDate(inWeek || weekDates[0] || today);
    // If a swipe crossed a week boundary, restore the intended center day
    if (pendingMobileCenterRef.current) {
      setMobileDayCenter(pendingMobileCenterRef.current);
      pendingMobileCenterRef.current = null;
    } else {
      setMobileDayCenter(inWeek || weekDates[1] || weekDates[0] || today);
    }
  }, [weekDates]);

  // Swipe navigation helpers
  const navigateWithSlide = useCallback((direction: 'left' | 'right', action: () => void) => {
    setSlideClass(direction === 'left' ? 'animate-slide-out-left' : 'animate-slide-out-right');
    const handle = setTimeout(() => {
      action();
      setSlideClass(direction === 'left' ? 'animate-slide-in-right' : 'animate-slide-in-left');
      const clearHandle = setTimeout(() => setSlideClass(''), 250);
      return () => clearTimeout(clearHandle);
    }, 150);
    return () => clearTimeout(handle);
  }, []);

  const goNext = useCallback(() => {
    if (effectiveSubView === 'day') {
      navigateWithSlide('left', () => setDayViewDate(d => { const n=new Date(d); n.setDate(n.getDate()+1); return n; }));
    } else if (effectiveSubView === 'week') {
      if (isMobile) {
        navigateWithSlide('left', () => {
          const n = new Date(mobileDayCenter);
          n.setDate(n.getDate() + 1);
          const inCurrentWeek = weekDates.some(wd => wd.toDateString() === n.toDateString());
          if (!inCurrentWeek) {
            // Crossing week boundary — stash intended center so useEffect restores it
            pendingMobileCenterRef.current = n;
            onWeekChange(selectedWeek + 1);
          } else {
            setMobileDayCenter(n);
          }
        });
      } else {
        navigateWithSlide('left', () => onWeekChange(selectedWeek + 1));
      }
    }
  }, [effectiveSubView, isMobile, mobileDayCenter, navigateWithSlide, onWeekChange, selectedWeek, weekDates]);

  const goPrev = useCallback(() => {
    if (effectiveSubView === 'day') {
      navigateWithSlide('right', () => setDayViewDate(d => { const n=new Date(d); n.setDate(n.getDate()-1); return n; }));
    } else if (effectiveSubView === 'week') {
      if (isMobile) {
        navigateWithSlide('right', () => {
          const n = new Date(mobileDayCenter);
          n.setDate(n.getDate() - 1);
          const inCurrentWeek = weekDates.some(wd => wd.toDateString() === n.toDateString());
          if (!inCurrentWeek) {
            pendingMobileCenterRef.current = n;
            onWeekChange(selectedWeek - 1);
          } else {
            setMobileDayCenter(n);
          }
        });
      } else {
        navigateWithSlide('right', () => onWeekChange(selectedWeek - 1));
      }
    }
  }, [effectiveSubView, isMobile, mobileDayCenter, navigateWithSlide, onWeekChange, selectedWeek, weekDates]);

  // Wire swipe navigation to timeline container
  useSwipeNav(timelineContainerRef, goNext, goPrev, isPinchingRef,
    effectiveSubView === 'month' || effectiveSubView === 'year'
  );

  // Broad-scope schedule queries for month/year
  const monthStart = formatLocalDate(new Date(monthViewDate.getFullYear(), monthViewDate.getMonth(), 1));
  const monthEnd   = formatLocalDate(new Date(monthViewDate.getFullYear(), monthViewDate.getMonth() + 1, 0));

  const { data: monthSchedules = [] } = useQuery<Schedule[]>({
    queryKey: ["/api/schedules", monthStart, monthEnd],
    queryFn: async () => {
      const res = await fetch(`/api/schedules?startDate=${monthStart}&endDate=${monthEnd}`);
      if (!res.ok) throw new Error('Failed to fetch schedules');
      return res.json();
    },
    enabled: effectiveSubView === 'month',
  });

  const yearStart = `${yearViewYear}-01-01`;
  const yearEnd   = `${yearViewYear}-12-31`;

  const { data: yearSchedules = [] } = useQuery<Schedule[]>({
    queryKey: ["/api/schedules", yearStart, yearEnd],
    queryFn: async () => {
      const res = await fetch(`/api/schedules?startDate=${yearStart}&endDate=${yearEnd}`);
      if (!res.ok) throw new Error('Failed to fetch schedules');
      return res.json();
    },
    enabled: effectiveSubView === 'year',
  });

  // For Day sub-view: if dayViewDate is outside the parent's weekDates window, fetch its own data
  const dayDateStr    = formatLocalDate(dayViewDate);
  const dayInWeek     = weekDates.some(d => formatLocalDate(d) === dayDateStr);
  const { data: daySpecificSchedules = [] } = useQuery<Schedule[]>({
    queryKey: ["/api/schedules", dayDateStr, dayDateStr],
    queryFn: async () => {
      const res = await fetch(`/api/schedules?startDate=${dayDateStr}&endDate=${dayDateStr}`);
      if (!res.ok) throw new Error('Failed to fetch schedules');
      return res.json();
    },
    enabled: effectiveSubView === 'day' && !dayInWeek,
  });

  const dayViewSchedules = dayInWeek ? weekSchedules : daySpecificSchedules;

  // Drag state
  const [dragState, setDragState] = useState<DragState | null>(null);
  const dragRef = useRef<DragState | null>(null);

  const updateScheduleMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: { startTime?: Date; endTime?: Date } }) => {
      const res = await apiRequest('PATCH', `/api/schedules/${id}`, data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/schedules"] });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to resize shift.", variant: "destructive" });
    },
  });

  const handleDragStart = useCallback((
    e: React.MouseEvent | React.TouchEvent,
    schedule: Schedule,
    edge: DragEdge,
  ) => {
    e.preventDefault();
    const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;
    const px      = hourPx;
    const pxPerMin = px / 60;
    const origMs   = edge === 'top' ? new Date(schedule.startTime).getTime() : new Date(schedule.endTime).getTime();

    const state: DragState = {
      scheduleId: schedule.id,
      edge,
      originalMs: origMs,
      pixelsPerMinute: pxPerMin,
      startY: clientY,
      currentMs: origMs,
    };
    dragRef.current = state;
    setDragState({ ...state });
  }, [hourPx]);

  useEffect(() => {
    const onMove = (e: MouseEvent | TouchEvent) => {
      if (!dragRef.current) return;
      const clientY     = 'touches' in e ? e.touches[0].clientY : e.clientY;
      const dy          = clientY - dragRef.current.startY;
      const deltaMin    = snapToGrid(dy / dragRef.current.pixelsPerMinute);
      const newMs       = dragRef.current.originalMs + deltaMin * 60_000;
      const refDate     = new Date(dragRef.current.originalMs);
      const dayStartMs  = new Date(refDate).setHours(DAY_START_HOUR, 0, 0, 0);
      const dayEndMs    = new Date(refDate).setHours(DAY_END_HOUR,   0, 0, 0);
      dragRef.current.currentMs = clamp(newMs, dayStartMs, dayEndMs);
      setDragState({ ...dragRef.current });
    };

    const onUp = () => {
      if (!dragRef.current) return;
      const ds = dragRef.current;
      dragRef.current = null;
      setDragState(null);

      const schedule = weekSchedules.find(s => s.id === ds.scheduleId)
        || daySpecificSchedules.find(s => s.id === ds.scheduleId)
        || monthSchedules.find(s => s.id === ds.scheduleId);
      if (!schedule) return;

      const minGapMs = 15 * 60_000;
      const newTime  = new Date(ds.currentMs);

      if (ds.edge === 'top') {
        if (newTime.getTime() >= new Date(schedule.endTime).getTime() - minGapMs) return;
        updateScheduleMutation.mutate({ id: ds.scheduleId, data: { startTime: newTime } });
      } else {
        if (newTime.getTime() <= new Date(schedule.startTime).getTime() + minGapMs) return;
        updateScheduleMutation.mutate({ id: ds.scheduleId, data: { endTime: newTime } });
      }
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('touchmove', onMove, { passive: false });
    window.addEventListener('mouseup', onUp);
    window.addEventListener('touchend', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('touchmove', onMove);
      window.removeEventListener('mouseup', onUp);
      window.removeEventListener('touchend', onUp);
    };
  }, [weekSchedules, daySpecificSchedules, monthSchedules, updateScheduleMutation]);

  // Click-to-create
  const handleSlotClick = useCallback((date: Date, startTime: string) => {
    if (!isAdmin) return;
    onCreateShift(formatLocalDate(date), startTime);
  }, [isAdmin, onCreateShift]);

  // Month/Year navigation
  const handleMonthDayClick = useCallback((date: Date) => {
    onSubViewChange('day');
    setDayViewDate(date);
  }, [onSubViewChange]);

  const handleMonthEmptyDayClick = useCallback((date: Date) => {
    if (!isAdmin) return;
    onCreateShift(formatLocalDate(date), '08:00');
  }, [isAdmin, onCreateShift]);

  const handleYearDayNavigate = useCallback((date: Date) => {
    onSubViewChange('day');
    setDayViewDate(date);
    setMonthViewDate(date);
  }, [onSubViewChange]);

  // Sub-view options — mobile shows Day + Week, desktop shows all four
  const subViewOptions: { key: ScheduleSubView; label: string }[] = isMobile
    ? [
        { key: 'day',  label: 'Day'  },
        { key: 'week', label: 'Week' },
      ]
    : [
        { key: 'day',   label: 'Day'   },
        { key: 'week',  label: 'Week'  },
        { key: 'month', label: 'Month' },
        { key: 'year',  label: 'Year'  },
      ];

  // Navigation controls
  const renderNav = () => {
    if (effectiveSubView === 'day') return (
      <div className="flex items-center gap-1">
        <button
          className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded hover:bg-muted"
          onClick={goPrev}
          aria-label="Previous day"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <span className="text-xs sm:text-sm font-medium text-center" style={{ minWidth: isMobile ? '100px' : '160px' }}>
          {isMobile
            ? dayViewDate.toLocaleDateString('en-US', { weekday:'short', month:'short', day:'numeric' })
            : dayViewDate.toLocaleDateString('en-US', { weekday:'long', month:'short', day:'numeric', year:'numeric' })
          }
        </span>
        <button
          className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded hover:bg-muted"
          onClick={goNext}
          aria-label="Next day"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>
    );
    if (effectiveSubView === 'week') return (
      <div className="flex items-center gap-1">
        <button className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded hover:bg-muted" onClick={goPrev} aria-label="Previous week">
          <ChevronLeft className="h-4 w-4" />
        </button>
        <span className="text-xs sm:text-sm font-medium text-center" style={{ minWidth: isMobile ? '80px' : '180px' }}>
          {isMobile
            ? `${weekDates[0]?.toLocaleDateString('en-US', { month:'short', day:'numeric' })} – ${weekDates[6]?.toLocaleDateString('en-US', { month:'short', day:'numeric' })}`
            : `${weekDates[0]?.toLocaleDateString('en-US', { month:'short', day:'numeric' })} – ${weekDates[6]?.toLocaleDateString('en-US', { month:'short', day:'numeric', year:'numeric' })}`
          }
        </span>
        <button className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded hover:bg-muted" onClick={goNext} aria-label="Next week">
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>
    );
    if (effectiveSubView === 'month') return (
      <div className="flex items-center gap-1">
        <button className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded hover:bg-muted" onClick={() => setMonthViewDate(d => new Date(d.getFullYear(), d.getMonth()-1, 1))}><ChevronLeft className="h-4 w-4" /></button>
        <span className="text-sm font-medium min-w-[140px] text-center">
          {monthViewDate.toLocaleDateString('en-US', { month:'long', year:'numeric' })}
        </span>
        <button className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded hover:bg-muted" onClick={() => setMonthViewDate(d => new Date(d.getFullYear(), d.getMonth()+1, 1))}><ChevronRight className="h-4 w-4" /></button>
      </div>
    );
    return (
      <div className="flex items-center gap-1">
        <button className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded hover:bg-muted" onClick={() => setYearViewYear(y => y-1)}><ChevronLeft className="h-4 w-4" /></button>
        <span className="text-sm font-medium min-w-[60px] text-center">{yearViewYear}</span>
        <button className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded hover:bg-muted" onClick={() => setYearViewYear(y => y+1)}><ChevronRight className="h-4 w-4" /></button>
      </div>
    );
  };

  // Scroll to now on initial load when in day/week view
  useEffect(() => {
    if (effectiveSubView !== 'day' && effectiveSubView !== 'week') return;
    const timer = setTimeout(() => {
      scrollToNow();
    }, 300);
    return () => clearTimeout(timer);
  }, [effectiveSubView]);

  return (
    <div className="flex flex-col flex-1 min-h-0 overflow-hidden relative" style={{ touchAction: 'pan-x pan-y' }}>
      {/* Toolbar */}
      <div className="flex items-center justify-between px-2 sm:px-4 py-2 border-b bg-background/95 gap-2 flex-wrap">
        {/* View switcher */}
        <div className="flex items-center rounded-md border overflow-hidden flex-shrink-0">
          {subViewOptions.map(sv => (
            <button
              key={sv.key}
              onClick={() => onSubViewChange(sv.key)}
              className={cn(
                "px-3 text-xs font-medium border-r last:border-r-0 transition-colors",
                "min-h-[44px] min-w-[44px]",
                effectiveSubView === sv.key
                  ? "bg-primary text-primary-foreground"
                  : "bg-background text-muted-foreground hover:bg-muted"
              )}
            >
              {sv.label}
            </button>
          ))}
        </div>
        {renderNav()}
        {/* Reset zoom — only shown in day/week views where pinch-zoom is active */}
        {(effectiveSubView === 'day' || effectiveSubView === 'week') && hourPx !== defaultHourPx && (
          <button
            onClick={handleResetZoom}
            className="text-xs text-muted-foreground hover:text-foreground px-2 py-1 rounded border border-border hover:bg-muted transition-colors flex-shrink-0"
            title="Reset zoom to default"
          >
            Reset zoom
          </button>
        )}
      </div>

      {/* Content — slide animation wrapper; explicit max-height keeps timeline inside viewport on mobile */}
      <div
        ref={timelineContainerRef}
        className={cn(
          "flex flex-col flex-1 min-h-0 overflow-hidden relative",
          slideClass
        )}
        style={isMobile ? { maxHeight: 'calc(100dvh - 120px)' } : undefined}
      >
        {effectiveSubView === 'day' && (
          <DayView
            date={dayViewDate}
            schedules={dayViewSchedules}
            pendingShifts={pendingShifts}
            users={users}
            hourPx={hourPx}
            onEdit={onEditSchedule}
            onDragStart={handleDragStart}
            dragState={dragState}
            onSlotClick={handleSlotClick}
            selectedScheduleId={selectedScheduleId}
            isMobile={isMobile}
            containerRef={scrollContainerRef}
            nowSentinelRef={nowSentinelRef}
          />
        )}
        {effectiveSubView === 'week' && (
          <WeekView
            weekDates={weekDates}
            schedules={weekSchedules}
            pendingShifts={pendingShifts}
            users={users}
            hourPx={hourPx}
            onEdit={onEditSchedule}
            onDragStart={handleDragStart}
            dragState={dragState}
            onSlotClick={handleSlotClick}
            selectedScheduleId={selectedScheduleId}
            isMobile={isMobile}
            mobileDayCenter={mobileDayCenter}
            onMobileDayCenterChange={setMobileDayCenter}
            containerRef={scrollContainerRef}
            nowSentinelRef={nowSentinelRef}
          />
        )}
        {effectiveSubView === 'month' && (
          <MonthView
            year={monthViewDate.getFullYear()}
            month={monthViewDate.getMonth()}
            schedules={monthSchedules}
            users={users}
            onEdit={onEditSchedule}
            onDayClick={handleMonthDayClick}
            onEmptyDayClick={handleMonthEmptyDayClick}
            pendingShifts={pendingShifts}
          />
        )}
        {effectiveSubView === 'year' && (
          <YearView
            year={yearViewYear}
            schedules={yearSchedules}
            onDayNavigate={handleYearDayNavigate}
            pendingShifts={pendingShifts}
          />
        )}
      </div>

      {/* "Now" FAB — bottom-right, appears when current-time line is not visible */}
      {showNowFab && (effectiveSubView === 'day' || effectiveSubView === 'week') && (
        <button
          onClick={scrollToNow}
          className={cn(
            "fixed bottom-6 right-4 z-30 flex items-center gap-1.5 px-3 py-2 rounded-full",
            "bg-red-500 text-white shadow-lg hover:bg-red-600 active:bg-red-700",
            "text-xs font-medium transition-colors",
            "pb-[calc(0.5rem+env(safe-area-inset-bottom,0px))]"
          )}
          aria-label="Scroll to current time"
          style={{ marginBottom: 'env(safe-area-inset-bottom, 0px)' }}
        >
          <Circle className="h-3 w-3 fill-white" />
          Now
        </button>
      )}
    </div>
  );
}
