import { useState, useMemo, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { useLocation } from "wouter";
import { cn } from "@/lib/utils";
import { apiRequest, queryClient as globalQueryClient } from "@/lib/queryClient";
import type { User, Schedule, WorkLocation, AvailabilityTemplate, TemplateSlot, TemplateSlotNew } from "@shared/schema";
import {
  ChevronLeft, ChevronRight, Plus, Trash2, Sparkles, Loader2,
  Check, X, Calendar, Clock, StickyNote, Bell, Pencil, Wand2, Users,
  ChevronDown, ChevronUp, CalendarDays, UserCog
} from "lucide-react";

interface DayNote {
  id: string;
  userId: string | null;
  date: string;
  noteText: string;
  isManagerNote: boolean;
  createdAt: string;
  updatedAt: string;
}

interface ScheduleEntry {
  date: string;
  employeeId: string;
  employeeName: string;
  shiftBlock: string;
  startTime: string;
  endTime: string;
  reasoning: string;
}

interface GenerateResult {
  success: boolean;
  days: any[];
  generatedSchedule: ScheduleEntry[];
  summary: string;
  warnings: string[];
  settings: any;
  salesDataAvailable: boolean;
}

function formatLocalDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// ── Employee Default Schedule read-only summary (manager view) ────────────────
const SCHED_DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function formatSchedTimeShort(hhmm: string): string {
  if (!hhmm) return '';
  const [h, m] = hhmm.split(':').map(Number);
  const h12 = h > 12 ? h - 12 : h === 0 ? 12 : h;
  const ampm = h >= 12 ? 'PM' : 'AM';
  return m === 0 ? `${h12} ${ampm}` : `${h12}:${String(m).padStart(2, '0')} ${ampm}`;
}

function isNewSlot(slot: TemplateSlot): slot is TemplateSlotNew {
  return 'available' in slot;
}

function buildDefaultScheduleSummary(rawSlots: Record<string, TemplateSlot>): string {
  type DayInfo = { available: boolean; startTime?: string; endTime?: string; legacyLabel?: string };
  const days: DayInfo[] = Array.from({ length: 7 }, (_, i) => {
    const raw = rawSlots[String(i)];
    if (!raw) return { available: false };
    if (isNewSlot(raw)) return { available: raw.available, startTime: raw.startTime, endTime: raw.endTime };
    // Legacy format — derive a human-readable label from the slot flags
    const legacyAvail = raw.morning || raw.afternoon || raw.evening;
    if (!legacyAvail) return { available: false };
    const parts: string[] = [];
    if (raw.morning) parts.push('morning');
    if (raw.afternoon) parts.push('afternoon');
    if (raw.evening) parts.push('evening');
    return { available: true, legacyLabel: parts.join('/') };
  });

  const parts: string[] = [];
  let i = 0;
  while (i < 7) {
    const d = days[i];
    if (!d.available) { i++; continue; }
    const timeStr = d.startTime && d.endTime
      ? `${formatSchedTimeShort(d.startTime)}–${formatSchedTimeShort(d.endTime)}`
      : d.legacyLabel ?? 'Available';
    let j = i;
    while (
      j + 1 < 7 &&
      days[j + 1].available &&
      days[j + 1].startTime === d.startTime &&
      days[j + 1].endTime === d.endTime &&
      days[j + 1].legacyLabel === d.legacyLabel
    ) j++;
    parts.push(j > i ? `${SCHED_DAY_NAMES[i]}–${SCHED_DAY_NAMES[j]}: ${timeStr}` : `${SCHED_DAY_NAMES[i]}: ${timeStr}`);
    i = j + 1;
  }
  return parts.length ? parts.join(' · ') : 'No available days set.';
}

function EmployeeDefaultSchedule({ userId }: { userId: string }) {
  const [expanded, setExpanded] = useState(false);

  const { data: template, isLoading } = useQuery<AvailabilityTemplate | null>({
    queryKey: ['/api/availability/template', userId],
    queryFn: async () => {
      const res = await fetch(`/api/availability/template?userId=${userId}`, { credentials: 'include' });
      if (res.status === 404 || res.status === 204) return null;
      if (!res.ok) return null;
      return res.json();
    },
    enabled: expanded,
  });

  const summary = useMemo(() => {
    if (!template?.slots) return null;
    return buildDefaultScheduleSummary(template.slots as Record<string, TemplateSlot>);
  }, [template]);

  return (
    <div className="mt-0.5">
      <button
        onClick={() => setExpanded(e => !e)}
        className="flex items-center gap-0.5 text-[10px] text-muted-foreground hover:text-foreground transition-colors"
      >
        <CalendarDays className="h-2.5 w-2.5 shrink-0" />
        <span>Default</span>
        {expanded ? <ChevronUp className="h-2.5 w-2.5" /> : <ChevronDown className="h-2.5 w-2.5" />}
      </button>
      {expanded && (
        <div className="mt-0.5 text-[10px] text-muted-foreground leading-snug max-w-[160px]">
          {isLoading ? (
            <span className="italic">Loading…</span>
          ) : !template?.slots ? (
            <span className="italic">No default schedule set.</span>
          ) : (
            summary
          )}
        </div>
      )}
    </div>
  );
}

type CalendarDay = {
  date: string;
  source: 'template' | 'override' | 'time_off' | 'none';
  available: boolean;
  unavailable: boolean;
  startTime: string | null;
  endTime: string | null;
  timeOff: { type: string; status: string } | null;
};

function AvailabilityOverrideDialog({
  target,
  onClose,
}: {
  target: { userId: string; date: string; empName: string };
  onClose: () => void;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: calendarData, isLoading } = useQuery<CalendarDay[]>({
    queryKey: ['/api/availability/calendar', target.userId, target.date],
    queryFn: async () => {
      const res = await fetch(
        `/api/availability/calendar?userId=${encodeURIComponent(target.userId)}&start=${target.date}&end=${target.date}`,
        { credentials: 'include' }
      );
      if (!res.ok) throw new Error('Failed to fetch');
      return res.json();
    },
  });

  const dayInfo = calendarData?.[0] ?? null;

  const [mode, setMode] = useState<'available' | 'unavailable'>('available');
  const [startTime, setStartTime] = useState('09:00');
  const [endTime, setEndTime] = useState('17:00');

  useEffect(() => {
    if (!dayInfo) return;
    if (dayInfo.unavailable || !dayInfo.available) {
      setMode('unavailable');
    } else {
      setMode('available');
      setStartTime(dayInfo.startTime ?? '09:00');
      setEndTime(dayInfo.endTime ?? '17:00');
    }
  }, [dayInfo]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      return apiRequest('PATCH', '/api/availability/day', {
        userId: target.userId,
        date: target.date,
        unavailable: mode === 'unavailable',
        startTime: mode === 'available' ? startTime : undefined,
        endTime: mode === 'available' ? endTime : undefined,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/availability/calendar/team'] });
      queryClient.invalidateQueries({ queryKey: ['/api/availability/calendar', target.userId, target.date] });
      toast({ title: "Availability updated", description: `Saved override for ${target.empName}` });
      onClose();
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to save availability override.", variant: "destructive" });
    },
  });

  const clearMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(
        `/api/availability/day?date=${encodeURIComponent(target.date)}&userId=${encodeURIComponent(target.userId)}`,
        { method: 'DELETE', credentials: 'include' }
      );
      if (!res.ok) throw new Error('Failed to clear');
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/availability/calendar/team'] });
      queryClient.invalidateQueries({ queryKey: ['/api/availability/calendar', target.userId, target.date] });
      toast({ title: "Override cleared", description: `${target.empName} reverted to their default schedule.` });
      onClose();
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to clear availability override.", variant: "destructive" });
    },
  });

  const dateLabel = new Date(target.date + 'T12:00:00Z').toLocaleDateString('en-US', {
    weekday: 'long', month: 'short', day: 'numeric',
  });

  const sourceLabel = dayInfo?.source === 'override'
    ? 'Override active'
    : dayInfo?.source === 'time_off'
    ? 'Time-off request'
    : dayInfo?.source === 'template'
    ? 'From default schedule'
    : 'No availability set';

  const isTimeOff = dayInfo?.source === 'time_off';

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="text-sm flex items-center gap-2">
            <UserCog className="h-4 w-4" />Availability Override
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <div className="text-sm font-medium">{target.empName}</div>
            <div className="text-xs text-muted-foreground">{dateLabel}</div>
          </div>

          {isLoading ? (
            <div className="text-xs text-muted-foreground italic">Loading current availability…</div>
          ) : (
            <div className={cn(
              "text-xs px-2.5 py-1.5 rounded-md border",
              dayInfo?.source === 'override' ? "bg-amber-50 border-amber-200 text-amber-700 dark:bg-amber-900/20 dark:border-amber-800 dark:text-amber-300" :
              dayInfo?.source === 'time_off' ? "bg-red-50 border-red-200 text-red-700 dark:bg-red-900/20 dark:border-red-800 dark:text-red-300" :
              dayInfo?.available ? "bg-emerald-50 border-emerald-200 text-emerald-700 dark:bg-emerald-900/20 dark:border-emerald-800 dark:text-emerald-300" :
              "bg-muted border-border text-muted-foreground"
            )}>
              <span className="font-medium">{sourceLabel}</span>
              {dayInfo?.available && dayInfo.startTime && dayInfo.endTime && (
                <span className="ml-1">· {formatSchedTimeShort(dayInfo.startTime)}–{formatSchedTimeShort(dayInfo.endTime)}</span>
              )}
              {isTimeOff && dayInfo?.timeOff && (
                <span className="ml-1 capitalize">· {dayInfo.timeOff.type}</span>
              )}
            </div>
          )}

          {isTimeOff ? (
            <p className="text-xs text-muted-foreground">
              This day is covered by a time-off request. To change availability, the time-off request must be cancelled first.
            </p>
          ) : (
            <>
              <div className="space-y-2">
                <Label className="text-xs font-medium">Set availability for this day</Label>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setMode('available')}
                    className={cn(
                      "flex-1 text-xs px-3 py-2 rounded-md border transition-colors",
                      mode === 'available'
                        ? "bg-emerald-100 border-emerald-400 text-emerald-800 dark:bg-emerald-900/40 dark:border-emerald-600 dark:text-emerald-200"
                        : "bg-background border-border text-foreground hover:bg-muted"
                    )}
                  >
                    Available
                  </button>
                  <button
                    type="button"
                    onClick={() => setMode('unavailable')}
                    className={cn(
                      "flex-1 text-xs px-3 py-2 rounded-md border transition-colors",
                      mode === 'unavailable'
                        ? "bg-red-100 border-red-400 text-red-800 dark:bg-red-900/40 dark:border-red-600 dark:text-red-200"
                        : "bg-background border-border text-foreground hover:bg-muted"
                    )}
                  >
                    Unavailable
                  </button>
                </div>
              </div>

              {mode === 'available' && (
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <Label className="text-xs">Start Time</Label>
                    <Input
                      type="time"
                      className="h-8 text-sm"
                      value={startTime}
                      onChange={e => setStartTime(e.target.value)}
                    />
                  </div>
                  <div>
                    <Label className="text-xs">End Time</Label>
                    <Input
                      type="time"
                      className="h-8 text-sm"
                      value={endTime}
                      onChange={e => setEndTime(e.target.value)}
                    />
                  </div>
                </div>
              )}

              <div className="flex items-center justify-between gap-2 pt-1">
                <div className="flex gap-2">
                  {dayInfo?.source === 'override' && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="text-xs"
                      disabled={clearMutation.isPending}
                      onClick={() => clearMutation.mutate()}
                    >
                      {clearMutation.isPending ? "Clearing…" : "Revert to Default"}
                    </Button>
                  )}
                </div>
                <div className="flex gap-2">
                  <Button type="button" variant="ghost" size="sm" onClick={onClose}>Cancel</Button>
                  <Button
                    type="button"
                    size="sm"
                    disabled={saveMutation.isPending}
                    onClick={() => saveMutation.mutate()}
                  >
                    {saveMutation.isPending ? "Saving…" : "Save Override"}
                  </Button>
                </div>
              </div>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function DayNoteAdminCell({ date, notes, currentUserId, isAdmin }: {
  date: Date;
  notes: DayNote[];
  currentUserId: string;
  isAdmin: boolean;
}) {
  const { toast } = useToast();
  const dateStr = formatLocalDate(date);
  const managerNote = notes.find(n => n.date === dateStr && n.isManagerNote);
  const employeeNotes = notes.filter(n => n.date === dateStr && !n.isManagerNote);
  const [open, setOpen] = useState(false);
  const [managerText, setManagerText] = useState(managerNote?.noteText || '');

  useEffect(() => {
    setManagerText(managerNote?.noteText || '');
  }, [managerNote]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (managerNote) {
        return apiRequest('PATCH', `/api/day-notes/${managerNote.id}`, { noteText: managerText });
      } else {
        return apiRequest('POST', '/api/day-notes', { date: dateStr, noteText: managerText, isManagerNote: true });
      }
    },
    onSuccess: () => {
      globalQueryClient.invalidateQueries({ queryKey: ['/api/day-notes'] });
      setOpen(false);
      toast({ title: "Manager note saved" });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to save note.", variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      return apiRequest('DELETE', `/api/day-notes/${id}`);
    },
    onSuccess: () => {
      globalQueryClient.invalidateQueries({ queryKey: ['/api/day-notes'] });
      toast({ title: "Note deleted" });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to delete note.", variant: "destructive" });
    },
  });

  const hasAnyNote = !!managerNote || employeeNotes.length > 0;

  return (
    <Popover open={open} onOpenChange={(o) => { setOpen(o); if (o) setManagerText(managerNote?.noteText || ''); }}>
      <PopoverTrigger asChild>
        <button
          className={cn(
            "inline-flex items-center justify-center w-5 h-5 rounded transition-all ml-1",
            hasAnyNote
              ? "text-amber-500 hover:text-amber-600"
              : "text-muted-foreground/30 hover:text-muted-foreground"
          )}
          title="Day notes"
        >
          <StickyNote className="h-3.5 w-3.5" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-3" side="bottom" align="center">
        <div className="space-y-3">
          <div className="text-xs font-medium text-muted-foreground">
            {date.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })}
          </div>

          {/* Manager Note Section */}
          <div>
            <div className="text-xs font-semibold mb-1 flex items-center gap-1">
              <StickyNote className="h-3 w-3 text-primary" />
              Manager Note
            </div>
            <Textarea
              value={managerText}
              onChange={e => setManagerText(e.target.value)}
              placeholder="Add a team-wide note for this day..."
              className="text-xs min-h-[70px] resize-none"
            />
            <div className="flex gap-2 mt-1.5">
              <Button
                size="sm"
                className="flex-1 h-7 text-xs"
                disabled={saveMutation.isPending || !managerText.trim()}
                onClick={() => saveMutation.mutate()}
              >
                {saveMutation.isPending ? "Saving..." : "Save Note"}
              </Button>
              {managerNote && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 text-xs text-destructive hover:text-destructive"
                  disabled={deleteMutation.isPending}
                  onClick={() => deleteMutation.mutate(managerNote.id)}
                >
                  Delete
                </Button>
              )}
            </div>
          </div>

          {/* Employee Notes (read-only list) */}
          {employeeNotes.length > 0 && (
            <div>
              <div className="text-xs font-semibold mb-1 text-muted-foreground">Employee Notes</div>
              <div className="space-y-1 max-h-32 overflow-y-auto">
                {employeeNotes.map(note => (
                  <div key={note.id} className="text-xs bg-muted/50 rounded p-2 relative group">
                    <p className="text-foreground pr-4">{note.noteText}</p>
                    <button
                      onClick={() => deleteMutation.mutate(note.id)}
                      className="absolute top-1 right-1 opacity-0 group-hover:opacity-100 transition-opacity text-destructive"
                      title="Delete"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

export default function ScheduleManagement() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { user: currentUser } = useAuth();
  const [, navigate] = useLocation();
  const [selectedWeek, setSelectedWeek] = useState(0);
  const [showCreateShift, setShowCreateShift] = useState(false);
  const [createShiftDefaults, setCreateShiftDefaults] = useState<{userId?: string, date?: string}>({});
  const [filterByAvailability, setFilterByAvailability] = useState(true);
  const [modalDate, setModalDate] = useState<string>('');
  const [modalStartTime, setModalStartTime] = useState('09:00');
  const [modalEndTime, setModalEndTime] = useState('17:00');
  const [shiftFilter, setShiftFilter] = useState<'my' | 'all' | 'open'>('my');
  const [selectedDay, setSelectedDay] = useState<Date | null>(null);
  const [showAIPanel, setShowAIPanel] = useState(false);
  const [editingSchedule, setEditingSchedule] = useState<Schedule | null>(null);
  const [aiResult, setAiResult] = useState<GenerateResult | null>(null);
  const [removedEntries, setRemovedEntries] = useState<Set<number>>(new Set());
  const [availabilityEditTarget, setAvailabilityEditTarget] = useState<{ userId: string; date: string; empName: string } | null>(null);

  const isAdmin = ['owner', 'admin', 'manager', 'assistant_manager'].includes(currentUser?.role?.name || '');

  const getWeekDates = (weekOffset: number) => {
    const today = new Date();
    const startOfWeek = new Date(today);
    startOfWeek.setDate(today.getDate() - today.getDay() + (weekOffset * 7));
    startOfWeek.setHours(0, 0, 0, 0);
    const dates = [];
    for (let i = 0; i < 7; i++) {
      const date = new Date(startOfWeek);
      date.setDate(startOfWeek.getDate() + i);
      dates.push(date);
    }
    return dates;
  };

  const weekDates = getWeekDates(selectedWeek);
  const startDateParam = formatLocalDate(weekDates[0]);
  const endDateParam = formatLocalDate(weekDates[6]);

  const { data: schedules = [], isLoading: schedulesLoading } = useQuery<Schedule[]>({
    queryKey: ["/api/schedules", startDateParam, endDateParam],
    queryFn: async () => {
      const res = await fetch(`/api/schedules?startDate=${startDateParam}&endDate=${endDateParam}`);
      if (!res.ok) throw new Error('Failed to fetch schedules');
      return res.json();
    },
  });

  const { data: users = [], isLoading: usersLoading } = useQuery<User[]>({
    queryKey: ["/api/users"],
  });

  const { data: locations = [] } = useQuery<WorkLocation[]>({
    queryKey: ["/api/work-locations"],
  });

  const { data: connectedShops = [] } = useQuery<any[]>({
    queryKey: ["/api/shopify/shops"],
  });

  const { data: dayNotes = [] } = useQuery<DayNote[]>({
    queryKey: ["/api/day-notes", startDateParam, endDateParam],
    queryFn: async () => {
      const res = await fetch(`/api/day-notes?startDate=${startDateParam}&endDate=${endDateParam}`);
      if (!res.ok) throw new Error('Failed to fetch notes');
      return res.json();
    },
    enabled: isAdmin,
  });

  const { data: allAvailability = [] } = useQuery<any[]>({
    queryKey: ["/api/availability/all", startDateParam, endDateParam],
    queryFn: async () => {
      const res = await fetch(`/api/availability/all?startDate=${startDateParam}&endDate=${endDateParam}`);
      if (!res.ok) throw new Error('Failed to fetch availability');
      return res.json();
    },
    enabled: isAdmin,
  });

  // Team merged calendar availability (new — template + overrides + time-off per date)
  const { data: teamCalendar = {} } = useQuery<Record<string, { userId: string; startTime: string | null; endTime: string | null; setByManagerId: string | null }[]>>({
    queryKey: ["/api/availability/calendar/team", startDateParam, endDateParam],
    queryFn: async () => {
      const res = await fetch(`/api/availability/calendar/team?start=${startDateParam}&end=${endDateParam}`, { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to fetch team calendar');
      return res.json();
    },
    enabled: isAdmin,
  });

  const activeShop = connectedShops.find((s: any) => s.isActive) || (connectedShops.length > 0 ? connectedShops[0] : null);

  const createScheduleMutation = useMutation({
    mutationFn: async (scheduleData: any) => {
      return apiRequest('POST', '/api/schedules', scheduleData);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/schedules"] });
      setShowCreateShift(false);
      toast({ title: "Success", description: "Shift created!" });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to create shift.", variant: "destructive" });
    },
  });

  const autoAssignMutation = useMutation({
    mutationFn: async (payload: { date: string; startTime?: string; endTime?: string }) => {
      const res = await apiRequest('POST', '/api/schedules/auto-assign-day', payload);
      return res.json();
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/schedules"] });
      setShowCreateShift(false);
      if (data.created === 0) {
        toast({ title: "Auto-Assign", description: data.message });
      } else {
        toast({ title: `Auto-Assigned ${data.created} shift${data.created !== 1 ? 's' : ''}`, description: data.message });
      }
    },
    onError: () => {
      toast({ title: "Error", description: "Auto-assign failed.", variant: "destructive" });
    },
  });

  const deleteScheduleMutation = useMutation({
    mutationFn: async (id: string) => {
      return apiRequest('DELETE', `/api/schedules/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/schedules"] });
      toast({ title: "Deleted", description: "Shift removed." });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to delete shift.", variant: "destructive" });
    },
  });

  const updateScheduleMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: any }) => {
      const res = await apiRequest('PATCH', `/api/schedules/${id}`, data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/schedules"] });
      setEditingSchedule(null);
      toast({ title: "Shift updated", description: "Changes saved." });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to update shift.", variant: "destructive" });
    },
  });

  const notifyTeamMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest('POST', '/api/schedules/notify-week', {
        startDate: weekDates[0].toISOString(),
        endDate: weekDates[6].toISOString(),
      });
      return res.json();
    },
    onSuccess: (data: any) => {
      toast({ title: "Team notified!", description: data.message });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to send notifications.", variant: "destructive" });
    },
  });

  const generateMutation = useMutation({
    mutationFn: async (dates: { startDate: string; endDate: string }) => {
      return apiRequest('POST', '/api/ai-scheduling/generate', {
        ...dates,
        shopDomain: activeShop?.shopDomain,
      });
    },
    onSuccess: async (response: any) => {
      const data = await response.json();
      setAiResult(data);
      setRemovedEntries(new Set());
      toast({ title: "Schedule Generated", description: data.summary || "AI schedule ready for review." });
    },
    onError: (error: any) => {
      toast({ title: "Generation Failed", description: error.message || "Failed to generate.", variant: "destructive" });
    },
  });

  const applyMutation = useMutation({
    mutationFn: async () => {
      if (!aiResult) throw new Error('No schedule');
      const entries = aiResult.generatedSchedule.filter((_, i) => !removedEntries.has(i));
      return apiRequest('POST', '/api/ai-scheduling/apply', { scheduleEntries: entries });
    },
    onSuccess: async (response: any) => {
      const data = await response.json();
      queryClient.invalidateQueries({ queryKey: ["/api/schedules"] });
      toast({ title: "Applied!", description: `${data.schedulesCreated} shifts created.` });
      setAiResult(null);
      setShowAIPanel(false);
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to apply schedule.", variant: "destructive" });
    },
  });

  const formatTime = (dateStr: string | Date) => {
    const d = new Date(dateStr);
    const h = d.getHours();
    const m = d.getMinutes();
    const ampm = h >= 12 ? 'pm' : 'am';
    const h12 = h % 12 || 12;
    return m === 0 ? `${h12}${ampm}` : `${h12}:${m.toString().padStart(2, '0')}${ampm}`;
  };

  const activeEmployees = users.filter(user => user.isActive !== false);

  // Employees filtered for the Create Shift modal (respects the availability toggle)
  const modalEmployees = useMemo(() => {
    if (!filterByAvailability || !modalDate) return activeEmployees;
    const dateStr = new Date(modalDate + 'T12:00:00').toDateString();
    const availableIds = new Set(
      (allAvailability as any[])
        .filter((a: any) => a.isAvailable && new Date(a.date).toDateString() === dateStr)
        .map((a: any) => a.userId)
    );
    return activeEmployees.filter(emp => availableIds.has(emp.id));
  }, [activeEmployees, allAvailability, filterByAvailability, modalDate]);

  const formatWeekRange = () => {
    const start = weekDates[0];
    const end = weekDates[6];
    const opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric', year: 'numeric' };
    return `${start.toLocaleDateString('en-US', opts)} - ${end.toLocaleDateString('en-US', opts)}`;
  };

  const employeeStats = useMemo(() => {
    const stats: Record<string, { hours: number; wages: number }> = {};
    activeEmployees.forEach(emp => {
      const empSchedules = schedules.filter(s =>
        s.userId === emp.id &&
        weekDates.some(d => new Date(s.startTime).toDateString() === d.toDateString())
      );
      const hours = empSchedules.reduce((sum, s) => {
        return sum + (new Date(s.endTime).getTime() - new Date(s.startTime).getTime()) / (1000 * 60 * 60);
      }, 0);
      const rate = parseFloat(emp.hourlyRate || '0');
      stats[emp.id] = { hours: Math.round(hours * 100) / 100, wages: Math.round(hours * rate * 100) / 100 };
    });
    return stats;
  }, [activeEmployees, schedules, weekDates]);

  const dailyTotals = useMemo(() => {
    return weekDates.map(date => {
      const daySchedules = schedules.filter(s =>
        new Date(s.startTime).toDateString() === date.toDateString()
      );
      let hours = 0;
      let wages = 0;
      daySchedules.forEach(s => {
        const h = (new Date(s.endTime).getTime() - new Date(s.startTime).getTime()) / (1000 * 60 * 60);
        hours += h;
        const emp = activeEmployees.find(e => e.id === s.userId);
        wages += h * parseFloat(emp?.hourlyRate || '0');
      });
      const staffCount = new Set(daySchedules.map(s => s.userId)).size;
      return { hours: Math.round(hours * 100) / 100, wages: Math.round(wages * 100) / 100, staffCount };
    });
  }, [weekDates, schedules, activeEmployees]);

  const getInitials = (user: User) => {
    return ((user.firstName?.[0] || '') + (user.lastName?.[0] || '')).toUpperCase();
  };

  const getInitialColor = (name: string) => {
    const colors = [
      'bg-violet-500', 'bg-blue-500', 'bg-emerald-500', 'bg-amber-500',
      'bg-rose-500', 'bg-cyan-500', 'bg-pink-500', 'bg-indigo-500',
      'bg-teal-500', 'bg-orange-500'
    ];
    let hash = 0;
    for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
    return colors[Math.abs(hash) % colors.length];
  };

  const openCreateShift = (userId?: string, date?: Date) => {
    const dateStr = date ? date.toISOString().split('T')[0] : new Date().toISOString().split('T')[0];
    setCreateShiftDefaults({ userId: userId || '', date: dateStr });
    setModalDate(dateStr);
    setShowCreateShift(true);
  };

  const handleCreateShift = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    const startDate = formData.get('startDate') as string;
    const startTime = formData.get('startTime') as string;
    const endTime = formData.get('endTime') as string;
    createScheduleMutation.mutate({
      userId: formData.get('userId') as string,
      startTime: new Date(`${startDate}T${startTime}`),
      endTime: new Date(`${startDate}T${endTime}`),
      title: formData.get('title') as string || undefined,
      locationId: formData.get('locationId') as string || undefined,
      description: formData.get('description') as string || undefined,
    });
  };

  const handleAIGenerate = () => {
    const startDate = weekDates[0].toISOString().split('T')[0];
    const endDate = weekDates[6].toISOString().split('T')[0];
    generateMutation.mutate({ startDate, endDate });
  };

  if (schedulesLoading || usersLoading) {
    return (
      <div className="min-h-screen bg-background p-4 md:p-6">
        <div className="max-w-lg mx-auto space-y-4">
          {/* Week range label */}
          <Skeleton className="h-4 w-40 mx-auto rounded" />
          {/* Week navigator: prev arrow + 7 day circles + next arrow */}
          <div className="flex items-center justify-between">
            <Skeleton className="h-8 w-8 rounded-md" />
            <div className="flex gap-1">
              {Array.from({ length: 7 }).map((_, i) => (
                <div key={i} className="flex flex-col items-center gap-1">
                  <Skeleton className="h-3 w-6 rounded" />
                  <Skeleton className="h-9 w-9 rounded-full" />
                </div>
              ))}
            </div>
            <Skeleton className="h-8 w-8 rounded-md" />
          </div>
          {/* Filter pills */}
          <div className="flex gap-2 justify-center">
            {[60, 56, 68].map((w, i) => (
              <Skeleton key={i} className="h-7 rounded-full" style={{ width: `${w}px` }} />
            ))}
          </div>
          {/* Skeleton shift cards */}
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="rounded-lg border bg-card p-3 space-y-2">
              <Skeleton className="h-3.5 w-32 rounded" />
              {Array.from({ length: i === 1 ? 2 : 1 }).map((_, j) => (
                <div key={j} className="rounded border p-2 bg-muted/30 space-y-1.5">
                  <div className="flex items-center justify-between">
                    <Skeleton className="h-4 w-36 rounded" />
                    <Skeleton className="h-3 w-8 rounded" />
                  </div>
                  <Skeleton className="h-3 w-24 rounded" />
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    );
  }

  // ===== EMPLOYEE VIEW (non-admin) =====
  if (!isAdmin) {
    const mySchedules = schedules.filter(s =>
      s.userId === currentUser?.id &&
      weekDates.some(d => new Date(s.startTime).toDateString() === d.toDateString())
    );
    const allWeekSchedules = schedules.filter(s =>
      weekDates.some(d => new Date(s.startTime).toDateString() === d.toDateString())
    );
    const allUpcomingSchedules = schedules
      .filter(s => s.userId === currentUser?.id && new Date(s.startTime) >= new Date(new Date().setHours(0,0,0,0)))
      .sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());
    const getFilteredSchedules = () => {
      if (shiftFilter === 'all' && !selectedDay) return schedules.filter(s => new Date(s.startTime) >= new Date(new Date().setHours(0,0,0,0))).sort((a,b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());
      if (selectedDay) {
        const daySchedules = schedules.filter(s => new Date(s.startTime).toDateString() === selectedDay.toDateString());
        if (shiftFilter === 'my') return daySchedules.filter(s => s.userId === currentUser?.id);
        return daySchedules;
      }
      if (shiftFilter === 'my') return mySchedules;
      return allWeekSchedules;
    };
    const filteredSchedules = getFilteredSchedules();
    const groupedSchedules: Record<string, Schedule[]> = {};
    filteredSchedules.forEach(s => {
      const dayKey = new Date(s.startTime).toDateString();
      if (!groupedSchedules[dayKey]) groupedSchedules[dayKey] = [];
      groupedSchedules[dayKey].push(s);
    });

    return (
      <div className="min-h-screen bg-background p-4 md:p-6">
        <div className="max-w-lg mx-auto space-y-4">
          <div className="text-center space-y-1">
            <p className="text-sm text-muted-foreground">{formatWeekRange()}</p>
          </div>
          <div className="flex items-center justify-between">
            <Button variant="ghost" size="sm" onClick={() => { setSelectedWeek(selectedWeek - 1); setSelectedDay(null); }}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <div className="flex gap-1">
              {weekDates.map(date => {
                const isToday = date.toDateString() === new Date().toDateString();
                const isSelected = selectedDay?.toDateString() === date.toDateString();
                const hasShift = mySchedules.some(s => new Date(s.startTime).toDateString() === date.toDateString());
                return (
                  <button key={date.toISOString()} onClick={() => setSelectedDay(isSelected ? null : date)} className="flex flex-col items-center gap-1">
                    <span className="text-[10px] text-muted-foreground uppercase">{date.toLocaleDateString('en-US', { weekday: 'short' })}</span>
                    <div className={cn("w-9 h-9 rounded-full flex items-center justify-center text-sm font-medium transition-all",
                      isSelected ? 'bg-primary text-primary-foreground ring-2 ring-primary/30' : isToday ? 'bg-primary text-primary-foreground' : hasShift ? 'bg-primary/10 text-primary border border-primary/30' : 'text-muted-foreground hover:bg-muted'
                    )}>{date.getDate()}</div>
                  </button>
                );
              })}
            </div>
            <Button variant="ghost" size="sm" onClick={() => { setSelectedWeek(selectedWeek + 1); setSelectedDay(null); }}>
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
          <div className="flex gap-2 justify-center">
            {(['all', 'my', 'open'] as const).map(filter => (
              <Button key={filter} variant={shiftFilter === filter ? 'default' : 'outline'} size="sm" className="text-xs px-4" onClick={() => { setShiftFilter(filter); if (filter === 'all') setSelectedDay(null); }}>
                {filter === 'all' ? 'All shifts' : filter === 'my' ? 'My shifts' : 'Open shifts'}
              </Button>
            ))}
          </div>
          {Object.keys(groupedSchedules).length > 0 ? (
            <div className="space-y-2">
              {Object.entries(groupedSchedules).map(([dayKey, dayShifts]) => {
                const dayDate = new Date(dayKey);
                return (
                  <Card key={dayKey}><CardContent className="p-3">
                    <div className="text-xs font-medium text-muted-foreground mb-2">
                      {dayDate.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })}
                      {dayDate.toDateString() === new Date().toDateString() && <span className="ml-1 text-primary">(Today)</span>}
                    </div>
                    {dayShifts.map(shift => {
                      const shiftUser = users.find(u => u.id === shift.userId);
                      const isMine = shift.userId === currentUser?.id;
                      const duration = ((new Date(shift.endTime).getTime() - new Date(shift.startTime).getTime()) / (1000 * 60 * 60)).toFixed(1);
                      return (
                        <div key={shift.id} className={cn("p-2 rounded border mb-1", isMine ? "bg-primary/5 border-primary/10" : "bg-muted/30 border-border")}>
                          <div className="flex items-center justify-between">
                            <div className="text-sm font-medium">{formatTime(shift.startTime)} - {formatTime(shift.endTime)}</div>
                            <span className="text-[10px] text-muted-foreground">{duration}h</span>
                          </div>
                          {shiftFilter !== 'my' && shiftUser && (
                            <div className="text-xs text-muted-foreground mt-1">{shiftUser.firstName} {shiftUser.lastName}{isMine && <span className="text-primary ml-1">(You)</span>}</div>
                          )}
                        </div>
                      );
                    })}
                  </CardContent></Card>
                );
              })}
            </div>
          ) : (
            <Card><CardContent className="p-8 text-center">
              <p className="text-base font-medium mb-1">No shifts scheduled</p>
              <p className="text-sm text-muted-foreground">Check back later or ask your manager.</p>
            </CardContent></Card>
          )}
          <div className="space-y-3 pt-2">
            <Button variant="outline" className="w-full h-12 text-sm font-medium border-primary/30 text-primary hover:bg-primary/5" onClick={() => navigate('/availability')}>
              <Calendar className="h-4 w-4 mr-2" />Update availability
            </Button>
          </div>
          <div className="text-center pt-2">
            <Button variant="ghost" size="sm" className="text-xs text-muted-foreground" onClick={() => { setSelectedWeek(0); setSelectedDay(null); }}>Back to current week</Button>
          </div>
        </div>
      </div>
    );
  }

  // ===== ADMIN VIEW - Homebase-style Grid =====
  return (
    <div className="min-h-screen bg-background">
      {/* Top Navigation Bar */}
      <div className="sticky top-0 z-10 bg-background border-b px-4 py-3">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" className="text-xs font-medium" onClick={() => setSelectedWeek(0)}>
              Today
            </Button>
            <div className="flex items-center gap-1 bg-muted rounded-md px-3 py-1.5">
              <Calendar className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="text-sm font-medium">{formatWeekRange()}</span>
            </div>
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setSelectedWeek(selectedWeek - 1)}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setSelectedWeek(selectedWeek + 1)}>
              <ChevronRight className="h-4 w-4" />
            </Button>
            <Badge variant="secondary" className="text-xs">Week</Badge>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5 text-xs"
              onClick={() => setShowAIPanel(!showAIPanel)}
            >
              <Sparkles className="h-3.5 w-3.5" />
              AI Auto-Schedule
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5 text-xs"
              onClick={() => notifyTeamMutation.mutate()}
              disabled={notifyTeamMutation.isPending || schedules.length === 0}
              title="Send push notifications to all employees with shifts this week"
            >
              {notifyTeamMutation.isPending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Bell className="h-3.5 w-3.5" />
              )}
              Notify Team
            </Button>
            <Button size="sm" className="gap-1.5 text-xs" onClick={() => openCreateShift()}>
              <Plus className="h-3.5 w-3.5" />
              Add Shift
            </Button>
          </div>
        </div>
      </div>

      {/* AI Auto-Schedule Panel */}
      {showAIPanel && (
        <div className="border-b bg-violet-50 dark:bg-violet-950/20 px-4 py-3">
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-violet-600" />
              <span className="text-sm font-medium">AI Auto-Schedule</span>
              <span className="text-xs text-muted-foreground">
                Generate optimized schedules for {formatWeekRange()}
                {!activeShop && ' (no Shopify data — using minimum staffing)'}
              </span>
            </div>
            <div className="flex items-center gap-2">
              {!aiResult ? (
                <Button
                  size="sm"
                  className="gap-1.5"
                  onClick={handleAIGenerate}
                  disabled={generateMutation.isPending}
                >
                  {generateMutation.isPending ? (
                    <><Loader2 className="h-3.5 w-3.5 animate-spin" />Generating...</>
                  ) : (
                    <><Sparkles className="h-3.5 w-3.5" />Generate</>
                  )}
                </Button>
              ) : (
                <>
                  <span className="text-xs text-muted-foreground">
                    {aiResult.generatedSchedule.length - removedEntries.size} shifts ready
                  </span>
                  <Button size="sm" variant="outline" onClick={() => { setAiResult(null); setRemovedEntries(new Set()); }}>
                    <X className="h-3.5 w-3.5 mr-1" />Discard
                  </Button>
                  <Button
                    size="sm"
                    className="gap-1.5"
                    onClick={() => applyMutation.mutate()}
                    disabled={applyMutation.isPending}
                  >
                    {applyMutation.isPending ? (
                      <><Loader2 className="h-3.5 w-3.5 animate-spin" />Applying...</>
                    ) : (
                      <><Check className="h-3.5 w-3.5" />Apply Schedule</>
                    )}
                  </Button>
                </>
              )}
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => { setShowAIPanel(false); setAiResult(null); }}>
                <X className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
          {aiResult && aiResult.warnings && aiResult.warnings.length > 0 && (
            <div className="mt-2 text-xs text-amber-700 dark:text-amber-300">
              {aiResult.warnings.map((w, i) => <span key={i} className="block">{w}</span>)}
            </div>
          )}
        </div>
      )}

      {/* Schedule Grid */}
      <div className="overflow-x-auto">
        <table className="w-full border-collapse min-w-[900px]">
          <thead>
            <tr className="border-b">
              <th className="sticky left-0 bg-background z-[5] text-left px-3 py-2 w-[200px] min-w-[200px] border-r">
                <div className="text-xs text-muted-foreground font-normal">Team members ({activeEmployees.length})</div>
              </th>
              {weekDates.map((date, i) => {
                const isToday = date.toDateString() === new Date().toDateString();
                const dayName = date.toLocaleDateString('en-US', { weekday: 'short' });
                const dayNum = date.getDate();
                return (
                  <th key={i} className={cn("text-center px-1 py-2 min-w-[100px] border-r last:border-r-0", isToday && "bg-primary/5")}>
                    <div className={cn("text-xs font-medium flex items-center justify-center", isToday ? "text-primary" : "text-foreground")}>
                      {dayName}, {dayNum}
                      <DayNoteAdminCell
                        date={date}
                        notes={dayNotes}
                        currentUserId={currentUser?.id || ''}
                        isAdmin={isAdmin}
                      />
                    </div>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {/* ── Team Availability Summary Row ──────────────────────────── */}
            <tr className="border-b bg-emerald-50/40 dark:bg-emerald-950/10">
              <td className="sticky left-0 bg-emerald-50/60 dark:bg-emerald-950/20 z-[5] px-3 py-1.5 border-r">
                <div className="flex items-center gap-1.5 text-xs text-emerald-700 dark:text-emerald-400 font-medium">
                  <Users className="h-3 w-3 shrink-0" />
                  Available
                </div>
              </td>
              {weekDates.map((date, dayIdx) => {
                const dateStr = formatLocalDate(date);
                const dayAvail = teamCalendar[dateStr] ?? [];
                const count = dayAvail.length;
                const isToday = date.toDateString() === new Date().toDateString();
                return (
                  <td key={dayIdx} className={cn("text-center px-1 py-1 border-r last:border-r-0", isToday && "bg-primary/5")}>
                    <Popover>
                      <PopoverTrigger asChild>
                        <button disabled={count === 0} className={cn(
                          "text-xs font-semibold rounded px-1.5 py-0.5 transition-colors",
                          count > 0 ? "text-emerald-700 dark:text-emerald-300 bg-emerald-100 dark:bg-emerald-900/40 hover:bg-emerald-200 cursor-pointer" : "text-muted-foreground/40 cursor-default"
                        )}>
                          {count > 0 ? `${count} avail` : '—'}
                        </button>
                      </PopoverTrigger>
                      {count > 0 && (
                        <PopoverContent side="bottom" className="w-56 p-2">
                          <div className="text-xs font-medium mb-1.5 text-muted-foreground">
                            {date.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })}
                          </div>
                          <div className="space-y-1">
                            {dayAvail.map((a: { userId: string; startTime: string | null; endTime: string | null }) => {
                              const emp = users.find((u: User) => u.id === a.userId);
                              if (!emp) return null;
                              const empName = `${emp.firstName} ${emp.lastName}`;
                              return (
                                <div key={a.userId} className="flex items-center justify-between gap-2">
                                  <span className="text-xs truncate">{empName}</span>
                                  {a.startTime && a.endTime ? (
                                    <span className="text-[10px] text-muted-foreground shrink-0">
                                      {formatSchedTimeShort(a.startTime)}–{formatSchedTimeShort(a.endTime)}
                                    </span>
                                  ) : (
                                    <span className="text-[10px] text-muted-foreground shrink-0">avail</span>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        </PopoverContent>
                      )}
                    </Popover>
                  </td>
                );
              })}
            </tr>

            {activeEmployees.map(emp => {
              const stats = employeeStats[emp.id] || { hours: 0, wages: 0 };
              const name = `${emp.firstName} ${emp.lastName}`;
              return (
                <tr key={emp.id} className="border-b hover:bg-muted/20 group">
                  {/* Employee Info Cell */}
                  <td className="sticky left-0 bg-background z-[5] px-3 py-2 border-r group-hover:bg-muted/20">
                    <div className="flex items-center gap-2">
                      <div className={cn("w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-bold shrink-0", getInitialColor(name))}>
                        {getInitials(emp)}
                      </div>
                      <div className="min-w-0">
                        <div className="text-sm font-medium truncate">{name}</div>
                        <div className="text-[10px] text-muted-foreground">
                          {stats.hours.toFixed(2)} hrs / ${stats.wages.toFixed(2)}
                        </div>
                        <EmployeeDefaultSchedule userId={emp.id} />
                      </div>
                    </div>
                  </td>

                  {/* Day Cells */}
                  {weekDates.map((date, dayIdx) => {
                    const isToday = date.toDateString() === new Date().toDateString();
                    const daySchedules = schedules.filter(s =>
                      s.userId === emp.id && new Date(s.startTime).toDateString() === date.toDateString()
                    );
                    const aiEntries = aiResult?.generatedSchedule
                      .map((e, i) => ({ ...e, idx: i }))
                      .filter(e => e.employeeId === emp.id && e.date === date.toISOString().split('T')[0]) || [];

                    const dateStr = formatLocalDate(date);
                    const mergedAvail = (teamCalendar[dateStr] ?? []).find(
                      (a: { userId: string; startTime: string | null; endTime: string | null; setByManagerId: string | null }) => a.userId === emp.id
                    );

                    return (
                      <td key={dayIdx} className={cn("px-1 py-1 border-r last:border-r-0 align-top min-h-[60px] relative", isToday && "bg-primary/5")}>
                        <div className="space-y-0.5 min-h-[48px]">
                          {daySchedules.map(schedule => (
                            <div
                              key={schedule.id}
                              onClick={() => setEditingSchedule(schedule)}
                              className="group/shift bg-indigo-100 dark:bg-indigo-900/40 border border-indigo-200 dark:border-indigo-800 rounded px-1.5 py-1 text-xs relative cursor-pointer hover:bg-indigo-200 dark:hover:bg-indigo-900/60 transition-colors"
                            >
                              <div className="font-medium text-indigo-800 dark:text-indigo-200 leading-tight">
                                {formatTime(schedule.startTime)}–{formatTime(schedule.endTime)}
                              </div>
                              {schedule.title && (
                                <div className="text-[10px] text-indigo-600 dark:text-indigo-400 truncate">{schedule.title}</div>
                              )}
                              <button
                                onClick={e => { e.stopPropagation(); deleteScheduleMutation.mutate(schedule.id); }}
                                className="absolute top-0.5 right-0.5 opacity-0 group-hover/shift:opacity-100 transition-opacity bg-red-100 dark:bg-red-900/40 rounded p-0.5"
                                title="Delete shift"
                              >
                                <Trash2 className="h-3 w-3 text-red-500" />
                              </button>
                            </div>
                          ))}

                          {/* AI Generated Preview Entries */}
                          {aiEntries.map(entry => {
                            const isRemoved = removedEntries.has(entry.idx);
                            return (
                              <div
                                key={`ai-${entry.idx}`}
                                className={cn(
                                  "rounded px-1.5 py-1 text-xs border-2 border-dashed",
                                  isRemoved
                                    ? "bg-muted/30 border-muted-foreground/20 opacity-40 line-through"
                                    : "bg-violet-50 dark:bg-violet-900/30 border-violet-300 dark:border-violet-700"
                                )}
                              >
                                <div className="flex items-center justify-between gap-1">
                                  <span className={cn("font-medium leading-tight", isRemoved ? "text-muted-foreground" : "text-violet-800 dark:text-violet-200")}>
                                    {entry.startTime}–{entry.endTime}
                                  </span>
                                  <button
                                    onClick={() => {
                                      const next = new Set(removedEntries);
                                      next.has(entry.idx) ? next.delete(entry.idx) : next.add(entry.idx);
                                      setRemovedEntries(next);
                                    }}
                                    className="shrink-0"
                                    title={isRemoved ? 'Restore' : 'Remove'}
                                  >
                                    {isRemoved ? (
                                      <Plus className="h-3 w-3 text-muted-foreground" />
                                    ) : (
                                      <X className="h-3 w-3 text-violet-500" />
                                    )}
                                  </button>
                                </div>
                                {!isRemoved && entry.shiftBlock && (
                                  <div className="text-[10px] text-violet-600 dark:text-violet-400">{entry.shiftBlock}</div>
                                )}
                              </div>
                            );
                          })}

                          {/* Availability indicator — merged calendar (template + overrides + time-off) */}
                          <div className="mt-1 flex items-center gap-0.5">
                            {mergedAvail ? (
                              <button
                                title={
                                  mergedAvail.setByManagerId
                                    ? (isAdmin ? "Manager override — click to edit" : "Availability set by management")
                                    : (isAdmin ? "Click to edit availability" : (mergedAvail.startTime && mergedAvail.endTime
                                        ? `Available ${formatSchedTimeShort(mergedAvail.startTime)}–${formatSchedTimeShort(mergedAvail.endTime)}`
                                        : 'Available'))
                                }
                                onClick={() => isAdmin && setAvailabilityEditTarget({ userId: emp.id, date: dateStr, empName: `${emp.firstName} ${emp.lastName}` })}
                                className={cn(
                                  "text-[9px] px-1.5 py-0.5 rounded-sm font-medium leading-[14px] inline-flex items-center gap-0.5",
                                  mergedAvail.setByManagerId
                                    ? "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300"
                                    : "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300",
                                  isAdmin && mergedAvail.setByManagerId && "hover:bg-amber-200 dark:hover:bg-amber-900/60 cursor-pointer",
                                  isAdmin && !mergedAvail.setByManagerId && "hover:bg-emerald-200 dark:hover:bg-emerald-900/60 cursor-pointer"
                                )}
                              >
                                {mergedAvail.startTime && mergedAvail.endTime
                                  ? `${formatSchedTimeShort(mergedAvail.startTime)}–${formatSchedTimeShort(mergedAvail.endTime)}`
                                  : 'avail'}
                                {mergedAvail.setByManagerId
                                  ? <UserCog className="h-2 w-2 ml-0.5 opacity-70" />
                                  : isAdmin && <Pencil className="h-2 w-2 ml-0.5 opacity-60" />}
                              </button>
                            ) : isAdmin ? (
                              <button
                                title="Set availability for this day"
                                onClick={() => setAvailabilityEditTarget({ userId: emp.id, date: dateStr, empName: `${emp.firstName} ${emp.lastName}` })}
                                className="text-[9px] px-1.5 py-0.5 rounded-sm font-medium text-muted-foreground/30 hover:text-muted-foreground hover:bg-muted/60 leading-[14px] inline-flex items-center gap-0.5 opacity-30 group-hover:opacity-100 transition-opacity cursor-pointer"
                              >
                                <UserCog className="h-2.5 w-2.5" />
                                <span>set avail</span>
                              </button>
                            ) : null}
                          </div>

                          {/* Add Shift Button */}
                          {daySchedules.length === 0 && aiEntries.length === 0 && (
                            <button
                              onClick={() => openCreateShift(emp.id, date)}
                              className="w-full h-[44px] flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-primary"
                              title="Add shift"
                            >
                              <Plus className="h-4 w-4" />
                            </button>
                          )}
                          {(daySchedules.length > 0 || aiEntries.length > 0) && (
                            <button
                              onClick={() => openCreateShift(emp.id, date)}
                              className="w-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-primary py-0.5"
                              title="Add another shift"
                            >
                              <Plus className="h-3 w-3" />
                            </button>
                          )}
                        </div>
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
          {/* Totals Footer */}
          <tfoot>
            <tr className="border-t-2 bg-muted/30">
              <td className="sticky left-0 bg-muted/30 z-[5] px-3 py-2 border-r">
                <div className="text-xs font-medium">Totals</div>
              </td>
              {dailyTotals.map((totals, i) => (
                <td key={i} className="text-center px-1 py-2 border-r last:border-r-0">
                  <div className="text-xs font-medium">${totals.wages.toFixed(2)}</div>
                  <div className="text-[10px] text-muted-foreground flex items-center justify-center gap-1">
                    <span>{totals.staffCount}</span>
                    <span>{totals.hours.toFixed(1)} hrs</span>
                  </div>
                </td>
              ))}
            </tr>
          </tfoot>
        </table>
      </div>

      {/* Create Shift Dialog */}
      <Dialog open={showCreateShift} onOpenChange={setShowCreateShift}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-sm flex items-center gap-2">
              <Clock className="h-4 w-4" />Create Shift
            </DialogTitle>
          </DialogHeader>
          <form onSubmit={handleCreateShift} className="space-y-3">
            {/* Availability filter toggle */}
            <div className="flex items-center justify-between rounded-lg border bg-muted/30 px-3 py-2">
              <div className="flex items-center gap-2">
                <Users className="h-3.5 w-3.5 text-muted-foreground" />
                <span className="text-xs text-muted-foreground">
                  Show available only
                  {filterByAvailability && modalEmployees.length < activeEmployees.length && (
                    <span className="ml-1 font-medium text-foreground">({modalEmployees.length} of {activeEmployees.length})</span>
                  )}
                </span>
              </div>
              <Switch
                checked={filterByAvailability}
                onCheckedChange={setFilterByAvailability}
                className="scale-90"
              />
            </div>

            <div>
              <Label className="text-xs">Employee</Label>
              <Select name="userId" defaultValue={createShiftDefaults.userId} required>
                <SelectTrigger className="h-8">
                  <SelectValue placeholder={modalEmployees.length === 0 ? "No available employees" : "Select employee"} />
                </SelectTrigger>
                <SelectContent>
                  {modalEmployees.length === 0 ? (
                    <div className="py-2 px-3 text-xs text-muted-foreground">
                      No employees with availability for this date. Turn off the filter to see all.
                    </div>
                  ) : (
                    modalEmployees.map(user => (
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
                onChange={e => setModalDate(e.target.value)}
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
                  onChange={e => setModalStartTime(e.target.value)}
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
                  onChange={e => setModalEndTime(e.target.value)}
                />
              </div>
            </div>
            <div>
              <Label className="text-xs">Role/Title (optional)</Label>
              <Input name="title" className="h-8 text-sm" placeholder="e.g., Opener, Closer" />
            </div>
            <div>
              <Label className="text-xs">Location</Label>
              <Select name="locationId" key={`loc-${showCreateShift}-${locations[0]?.id}`} defaultValue={locations[0]?.id ?? ''}>
                <SelectTrigger className="h-8">
                  <SelectValue placeholder="Select location (optional)" />
                </SelectTrigger>
                <SelectContent>
                  {locations.map(loc => (
                    <SelectItem key={loc.id} value={loc.id}>{loc.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Notes</Label>
              <Textarea name="description" className="text-sm" placeholder="Optional notes..." rows={2} />
            </div>
            {/* Auto-Assign section */}
            <div className="rounded-lg border border-primary/20 bg-primary/5 px-3 py-2.5 space-y-2">
              <p className="text-[11px] font-medium text-primary flex items-center gap-1.5">
                <Wand2 className="h-3 w-3" />AI Auto-Assign
              </p>
              <p className="text-[10px] text-muted-foreground leading-relaxed">
                Automatically fill the needed staffing slots for this day using top-scored available employees.
              </p>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="w-full border-primary/30 text-primary hover:bg-primary/10 gap-1.5 text-xs"
                disabled={autoAssignMutation.isPending || !modalDate}
                onClick={() => autoAssignMutation.mutate({ date: modalDate, startTime: modalStartTime, endTime: modalEndTime })}
              >
                {autoAssignMutation.isPending
                  ? <><Loader2 className="h-3 w-3 animate-spin" />Assigning...</>
                  : <><Wand2 className="h-3 w-3" />Auto-Assign Shifts</>}
              </Button>
            </div>

            <div className="flex justify-end gap-2 pt-1">
              <Button type="button" variant="outline" size="sm" onClick={() => setShowCreateShift(false)}>Cancel</Button>
              <Button type="submit" size="sm" disabled={createScheduleMutation.isPending}>
                {createScheduleMutation.isPending ? "Creating..." : "Create Shift"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* Availability Override Dialog */}
      {availabilityEditTarget && (
        <AvailabilityOverrideDialog
          target={availabilityEditTarget}
          onClose={() => setAvailabilityEditTarget(null)}
        />
      )}

      {/* Edit Shift Dialog */}
      <Dialog open={!!editingSchedule} onOpenChange={open => { if (!open) setEditingSchedule(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-sm flex items-center gap-2">
              <Pencil className="h-4 w-4" />Edit Shift
            </DialogTitle>
          </DialogHeader>
          {editingSchedule && (() => {
            const empName = (() => {
              const u = activeEmployees.find(e => e.id === editingSchedule.userId);
              return u ? `${u.firstName} ${u.lastName}` : 'Employee';
            })();
            const pad = (n: number) => String(n).padStart(2, '0');
            const dt = new Date(editingSchedule.startTime);
            const dtEnd = new Date(editingSchedule.endTime);
            const defaultDate = `${dt.getFullYear()}-${pad(dt.getMonth()+1)}-${pad(dt.getDate())}`;
            const defaultStartTime = `${pad(dt.getHours())}:${pad(dt.getMinutes())}`;
            const defaultEndTime = `${pad(dtEnd.getHours())}:${pad(dtEnd.getMinutes())}`;
            return (
              <form
                onSubmit={e => {
                  e.preventDefault();
                  const fd = new FormData(e.currentTarget);
                  const date = fd.get('startDate') as string;
                  const startTime = fd.get('startTime') as string;
                  const endTime = fd.get('endTime') as string;
                  updateScheduleMutation.mutate({
                    id: editingSchedule.id,
                    data: {
                      startTime: new Date(`${date}T${startTime}`),
                      endTime: new Date(`${date}T${endTime}`),
                      title: (fd.get('title') as string) || null,
                      description: (fd.get('description') as string) || null,
                      locationId: (fd.get('locationId') as string) || null,
                    },
                  });
                }}
                className="space-y-3"
              >
                <div className="text-sm font-medium text-muted-foreground">{empName}</div>
                <div>
                  <Label className="text-xs">Date</Label>
                  <Input name="startDate" type="date" className="h-8 text-sm" required defaultValue={defaultDate} />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <Label className="text-xs">Start Time</Label>
                    <Input name="startTime" type="time" className="h-8 text-sm" required defaultValue={defaultStartTime} />
                  </div>
                  <div>
                    <Label className="text-xs">End Time</Label>
                    <Input name="endTime" type="time" className="h-8 text-sm" required defaultValue={defaultEndTime} />
                  </div>
                </div>
                <div>
                  <Label className="text-xs">Title (optional)</Label>
                  <Input name="title" className="h-8 text-sm" placeholder="e.g. Opening, Closing..." defaultValue={editingSchedule.title ?? ''} />
                </div>
                {locations.length > 0 && (
                  <div>
                    <Label className="text-xs">Location</Label>
                    <Select name="locationId" defaultValue={editingSchedule.locationId ?? ''}>
                      <SelectTrigger className="h-8">
                        <SelectValue placeholder="No location" />
                      </SelectTrigger>
                      <SelectContent>
                        {locations.map(loc => (
                          <SelectItem key={loc.id} value={loc.id}>{loc.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
                <div>
                  <Label className="text-xs">Notes</Label>
                  <Textarea name="description" className="text-sm" placeholder="Optional notes..." rows={2} defaultValue={editingSchedule.description ?? ''} />
                </div>
                <div className="flex justify-between gap-2 pt-2">
                  <Button
                    type="button"
                    variant="destructive"
                    size="sm"
                    onClick={() => { deleteScheduleMutation.mutate(editingSchedule.id); setEditingSchedule(null); }}
                  >
                    <Trash2 className="h-3.5 w-3.5 mr-1" />Delete
                  </Button>
                  <div className="flex gap-2">
                    <Button type="button" variant="outline" size="sm" onClick={() => setEditingSchedule(null)}>Cancel</Button>
                    <Button type="submit" size="sm" disabled={updateScheduleMutation.isPending}>
                      {updateScheduleMutation.isPending ? "Saving..." : "Save Changes"}
                    </Button>
                  </div>
                </div>
              </form>
            );
          })()}
        </DialogContent>
      </Dialog>
    </div>
  );
}
