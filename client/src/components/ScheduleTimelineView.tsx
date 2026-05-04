import { useState, useRef, useCallback, useEffect, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { cn } from "@/lib/utils";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { Schedule, User } from "@shared/schema";
import { ChevronLeft, ChevronRight } from "lucide-react";

// Constants
const DAY_START_HOUR = 6;
const DAY_END_HOUR   = 22;
const TOTAL_HOURS    = DAY_END_HOUR - DAY_START_HOUR;

const WEEK_HOUR_PX   = 60;
const DAY_HOUR_PX    = 80;
const SNAP_MINUTES   = 15;

// Mobile breakpoint (md = 768px)
const MOBILE_BREAKPOINT = 768;

// Colour helpers
const COLOR_KEYS = [
  'violet','blue','emerald','amber','rose','cyan','pink','indigo','teal','orange',
] as const;
type ColorKey = typeof COLOR_KEYS[number];

function colorKeyFromName(name: string): ColorKey {
  const ORDER: ColorKey[] = ['violet','blue','emerald','amber','rose','cyan','pink','indigo'];
  let h = 0;
  for (let i = 0; i < name.length; i++) h = name.charCodeAt(i) + ((h << 5) - h);
  return ORDER[Math.abs(h) % ORDER.length];
}

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
  schedules: Schedule[];          // week-scoped schedules from parent
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

// ShiftBlock
function ShiftBlock({
  positioned,
  user,
  hourPx,
  onEdit,
  onDragStart,
  dragState,
  isSelected,
}: {
  positioned: PositionedShift;
  user: User | undefined;
  hourPx: number;
  onEdit: (s: Schedule) => void;
  onDragStart: (e: React.MouseEvent | React.TouchEvent, s: Schedule, edge: DragEdge) => void;
  dragState: DragState | null;
  isSelected?: boolean;
}) {
  const { schedule: s, col, totalCols } = positioned;
  const isDragging = dragState?.scheduleId === s.id;

  const startMs = isDragging && dragState.edge === 'top'    ? dragState.currentMs : new Date(s.startTime).getTime();
  const endMs   = isDragging && dragState.edge === 'bottom'  ? dragState.currentMs : new Date(s.endTime).getTime();

  const startMin    = minutesFromMidnight(new Date(startMs));
  const endMin      = minutesFromMidnight(new Date(endMs));
  const dayStartMin = DAY_START_HOUR * 60;

  const top    = ((startMin - dayStartMin) / 60) * hourPx;
  const height = Math.max(((endMin - startMin) / 60) * hourPx, hourPx * 0.25);

  const widthPct = 100 / totalCols;
  const leftPct  = col * widthPct;

  // Consistency fix: resolve the display name the same way the panel does
  // (firstName + lastName → email → username → 'Unknown') and colour by
  // userId (same 10-color hash as CreateShiftSplitPanel) so a person gets
  // an identical colour and name in both the timeline and the edit panel.
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
        minHeight:'44px',
      }}
      onClick={(e) => { e.stopPropagation(); onEdit(s); }}
      title={`${displayName}: ${timeLabel}${s.title ? ` · ${s.title}` : ''}`}
    >
      {/* Top drag handle */}
      <div
        className="absolute top-0 left-0 right-0 h-2 cursor-ns-resize flex items-center justify-center opacity-0 hover:opacity-60 transition-opacity"
        onMouseDown={e => { e.stopPropagation(); onDragStart(e, s, 'top'); }}
        onTouchStart={e => { e.stopPropagation(); onDragStart(e, s, 'top'); }}
        onClick={e => e.stopPropagation()}
      >
        <div className="w-8 h-0.5 rounded-full bg-current opacity-40" />
      </div>

      {/* Content */}
      <div className={cn("px-1.5 pt-2 pb-1 flex flex-col gap-0", colors.text)}>
        <span className="text-[10px] font-semibold truncate leading-tight">{displayName}</span>
        {showRole && <span className="text-[8px] opacity-60 truncate leading-tight">{s.title}</span>}
        {showTime && <span className="text-[9px] opacity-70 truncate">{timeLabel}</span>}
      </div>

      {/* Bottom drag handle */}
      <div
        className="absolute bottom-0 left-0 right-0 h-2 cursor-ns-resize flex items-center justify-center opacity-0 hover:opacity-60 transition-opacity"
        onMouseDown={e => { e.stopPropagation(); onDragStart(e, s, 'bottom'); }}
        onTouchStart={e => { e.stopPropagation(); onDragStart(e, s, 'bottom'); }}
        onClick={e => e.stopPropagation()}
      >
        <div className="w-8 h-0.5 rounded-full bg-current opacity-40" />
      </div>
    </div>
  );
}

// DayColumn
function DayColumn({
  date,
  shifts,
  users,
  hourPx,
  onEdit,
  onDragStart,
  dragState,
  onSlotClick,
  isToday,
  selectedScheduleId,
}: {
  date: Date;
  shifts: Schedule[];
  users: User[];
  hourPx: number;
  onEdit: (s: Schedule) => void;
  onDragStart: (e: React.MouseEvent | React.TouchEvent, s: Schedule, edge: DragEdge) => void;
  dragState: DragState | null;
  onSlotClick: (date: Date, startTime: string) => void;
  isToday: boolean;
  selectedScheduleId?: string | null;
}) {
  const totalHeight = TOTAL_HOURS * hourPx;
  const positioned  = useMemo(() => layoutOverlapping(shifts), [shifts]);

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
      {positioned.map(p => (
        <ShiftBlock
          key={p.schedule.id}
          positioned={p}
          user={users.find(u => u.id === p.schedule.userId)}
          hourPx={hourPx}
          onEdit={onEdit}
          onDragStart={onDragStart}
          dragState={dragState}
          isSelected={selectedScheduleId === p.schedule.id}
        />
      ))}
    </div>
  );
}

// TimeLabels
function TimeLabels({ hourPx }: { hourPx: number }) {
  return (
    <div className="relative shrink-0" style={{ width: '52px' }}>
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
  users,
  onEdit,
  onDragStart,
  dragState,
  onSlotClick,
  selectedScheduleId,
}: {
  date: Date;
  schedules: Schedule[];
  users: User[];
  onEdit: (s: Schedule) => void;
  onDragStart: (e: React.MouseEvent | React.TouchEvent, s: Schedule, edge: DragEdge) => void;
  dragState: DragState | null;
  onSlotClick: (date: Date, startTime: string) => void;
  selectedScheduleId?: string | null;
}) {
  const dayStr    = formatLocalDate(date);
  const dayShifts = schedules.filter(s => formatLocalDate(new Date(s.startTime)) === dayStr);
  const isToday   = date.toDateString() === new Date().toDateString();

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="flex" style={{ minHeight: `${TOTAL_HOURS * DAY_HOUR_PX}px` }}>
        <TimeLabels hourPx={DAY_HOUR_PX} />
        <div className="flex-1 relative">
          <DayColumn
            date={date}
            shifts={dayShifts}
            users={users}
            hourPx={DAY_HOUR_PX}
            onEdit={onEdit}
            onDragStart={onDragStart}
            dragState={dragState}
            onSlotClick={onSlotClick}
            isToday={isToday}
            selectedScheduleId={selectedScheduleId}
          />
        </div>
      </div>
    </div>
  );
}

// WeekView
function WeekView({
  weekDates,
  schedules,
  users,
  onEdit,
  onDragStart,
  dragState,
  onSlotClick,
  selectedScheduleId,
}: {
  weekDates: Date[];
  schedules: Schedule[];
  users: User[];
  onEdit: (s: Schedule) => void;
  onDragStart: (e: React.MouseEvent | React.TouchEvent, s: Schedule, edge: DragEdge) => void;
  dragState: DragState | null;
  onSlotClick: (date: Date, startTime: string) => void;
  selectedScheduleId?: string | null;
}) {
  const today = new Date().toDateString();

  return (
    <div className="flex-1 overflow-auto">
      <div className="sticky top-0 z-20 bg-background border-b flex" style={{ paddingLeft: '52px' }}>
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
      <div className="flex" style={{ minHeight: `${TOTAL_HOURS * WEEK_HOUR_PX}px` }}>
        <TimeLabels hourPx={WEEK_HOUR_PX} />
        {weekDates.map((date, i) => {
          const dayStr    = formatLocalDate(date);
          const dayShifts = schedules.filter(s => formatLocalDate(new Date(s.startTime)) === dayStr);
          return (
            <div key={i} className="flex-1 min-w-0 border-r last:border-r-0">
              <DayColumn
                date={date}
                shifts={dayShifts}
                users={users}
                hourPx={WEEK_HOUR_PX}
                onEdit={onEdit}
                onDragStart={onDragStart}
                dragState={dragState}
                onSlotClick={onSlotClick}
                isToday={date.toDateString() === today}
                selectedScheduleId={selectedScheduleId}
              />
            </div>
          );
        })}
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
}: {
  year: number;
  month: number;
  schedules: Schedule[];
  users: User[];
  onEdit: (s: Schedule) => void;
  onDayClick: (date: Date) => void;
  onEmptyDayClick?: (date: Date) => void;
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
            const dayShifts = schedules.filter(s => formatLocalDate(new Date(s.startTime)) === dateStr);
            const isToday   = date.toDateString() === today.toDateString();
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
                    // Same name + colour resolution as ShiftBlock/panel for consistency.
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
}: {
  year: number;
  schedules: Schedule[];
  onDayNavigate: (date: Date) => void;
}) {
  const today = new Date();

  const coverageMap = useMemo(() => {
    const map: Record<string, number> = {};
    for (const s of schedules) {
      const key = formatLocalDate(new Date(s.startTime));
      map[key] = (map[key] || 0) + 1;
    }
    return map;
  }, [schedules]);

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

// Main Component
export default function ScheduleTimelineView({
  subView,
  onSubViewChange,
  schedules: weekSchedules,
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

  // Month view
  const [monthViewDate, setMonthViewDate] = useState<Date>(() => weekDates[0] || new Date());

  // Year view
  const [yearViewYear, setYearViewYear] = useState<number>(() => (weekDates[0] || new Date()).getFullYear());

  // Keep dayViewDate in sync with week navigation
  useEffect(() => {
    const today = new Date();
    const inWeek = weekDates.find(d => d.toDateString() === today.toDateString());
    setDayViewDate(inWeek || weekDates[0] || today);
  }, [weekDates]);

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
    const hourPx   = effectiveSubView === 'day' ? DAY_HOUR_PX : WEEK_HOUR_PX;
    const pxPerMin = hourPx / 60;
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
  }, [effectiveSubView]);

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
        <button className="p-1 rounded hover:bg-muted" onClick={() => setDayViewDate(d => { const n=new Date(d); n.setDate(n.getDate()-1); return n; })}>
          <ChevronLeft className="h-4 w-4" />
        </button>
        <span className="text-sm font-medium min-w-[160px] text-center">
          {dayViewDate.toLocaleDateString('en-US', { weekday:'long', month:'short', day:'numeric', year:'numeric' })}
        </span>
        <button className="p-1 rounded hover:bg-muted" onClick={() => setDayViewDate(d => { const n=new Date(d); n.setDate(n.getDate()+1); return n; })}>
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>
    );
    if (effectiveSubView === 'week') return (
      <div className="flex items-center gap-1">
        <button className="p-1 rounded hover:bg-muted" onClick={() => onWeekChange(selectedWeek - 1)}><ChevronLeft className="h-4 w-4" /></button>
        <span className="text-sm font-medium min-w-[180px] text-center">
          {weekDates[0]?.toLocaleDateString('en-US', { month:'short', day:'numeric' })} – {weekDates[6]?.toLocaleDateString('en-US', { month:'short', day:'numeric', year:'numeric' })}
        </span>
        <button className="p-1 rounded hover:bg-muted" onClick={() => onWeekChange(selectedWeek + 1)}><ChevronRight className="h-4 w-4" /></button>
      </div>
    );
    if (effectiveSubView === 'month') return (
      <div className="flex items-center gap-1">
        <button className="p-1 rounded hover:bg-muted" onClick={() => setMonthViewDate(d => new Date(d.getFullYear(), d.getMonth()-1, 1))}><ChevronLeft className="h-4 w-4" /></button>
        <span className="text-sm font-medium min-w-[140px] text-center">
          {monthViewDate.toLocaleDateString('en-US', { month:'long', year:'numeric' })}
        </span>
        <button className="p-1 rounded hover:bg-muted" onClick={() => setMonthViewDate(d => new Date(d.getFullYear(), d.getMonth()+1, 1))}><ChevronRight className="h-4 w-4" /></button>
      </div>
    );
    return (
      <div className="flex items-center gap-1">
        <button className="p-1 rounded hover:bg-muted" onClick={() => setYearViewYear(y => y-1)}><ChevronLeft className="h-4 w-4" /></button>
        <span className="text-sm font-medium min-w-[60px] text-center">{yearViewYear}</span>
        <button className="p-1 rounded hover:bg-muted" onClick={() => setYearViewYear(y => y+1)}><ChevronRight className="h-4 w-4" /></button>
      </div>
    );
  };

  return (
    <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
      {/* Toolbar */}
      <div className="flex items-center justify-between px-4 py-2 border-b bg-background/95 gap-4 flex-wrap">
        <div className="flex items-center rounded-md border overflow-hidden">
          {subViewOptions.map(sv => (
            <button
              key={sv.key}
              onClick={() => onSubViewChange(sv.key)}
              className={cn(
                "px-3 py-1 text-xs font-medium border-r last:border-r-0 transition-colors",
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
      </div>

      {/* Content */}
      {effectiveSubView === 'day' && (
        <DayView
          date={dayViewDate}
          schedules={dayViewSchedules}
          users={users}
          onEdit={onEditSchedule}
          onDragStart={handleDragStart}
          dragState={dragState}
          onSlotClick={handleSlotClick}
          selectedScheduleId={selectedScheduleId}
        />
      )}
      {effectiveSubView === 'week' && (
        <WeekView
          weekDates={weekDates}
          schedules={weekSchedules}
          users={users}
          onEdit={onEditSchedule}
          onDragStart={handleDragStart}
          dragState={dragState}
          onSlotClick={handleSlotClick}
          selectedScheduleId={selectedScheduleId}
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
        />
      )}
      {effectiveSubView === 'year' && (
        <YearView
          year={yearViewYear}
          schedules={yearSchedules}
          onDayNavigate={handleYearDayNavigate}
        />
      )}
    </div>
  );
}
