import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient, invalidatePrefix } from "@/lib/queryClient";
import { useCompanySettings } from "@/hooks/useCompanySettings";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import {
  Sun, Sunset, Moon, Clock, Check, Minus, ChevronLeft, ChevronRight,
  StickyNote, Plus, X, Umbrella, Thermometer, User, CalendarMinus,
  MoreHorizontal, MessageSquare, CalendarCheck, Save, Loader2, CalendarDays, Wand2,
  Ban, RefreshCcw, Repeat, Sparkles, Users, CalendarRange, CheckCircle2, XCircle
} from "lucide-react";
import type { UserAvailability, TimeOffRequest, AvailabilityTemplate, TemplateSlot, TemplateSlotNew, TemplateSlotLegacy } from "@shared/schema";

// ─── Responsive breakpoint hook ──────────────────────────────────────────────
function useIsDesktop(): boolean {
  const [isDesktop, setIsDesktop] = useState(() =>
    typeof window !== 'undefined' ? window.innerWidth >= 768 : true
  );
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 768px)');
    const handler = (e: MediaQueryListEvent) => setIsDesktop(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);
  return isDesktop;
}

// ─── Calendar day entry type (from merged API) ───────────────────────────────
interface CalDayTemplateDefault {
  available: boolean;
  startTime: string | null;
  endTime: string | null;
}

interface CalDayEntry {
  date: string; // "YYYY-MM-DD"
  source: 'override' | 'template' | 'time_off' | 'none';
  available: boolean;
  unavailable: boolean;
  startTime: string | null;
  endTime: string | null;
  timeOff: { type: string; status: string } | null;
  /** Only present when source === 'override' and the day also has a recurring template rule */
  templateDefault?: CalDayTemplateDefault | null;
}

// ─── Time slot types (for the weekly grid — unchanged) ─────────────────────
type TimeSlot = 'morning' | 'afternoon' | 'evening' | 'all_day';

interface DayNote {
  id: string;
  userId: string | null;
  date: string;
  noteText: string;
  isManagerNote: boolean;
  createdAt: string;
  updatedAt: string;
}

// ─── Default Schedule types ─────────────────────────────────────────────────
interface DayTemplate {
  available: boolean;
  startTime: string; // "HH:mm"
  endTime: string;   // "HH:mm"
}

const DEFAULT_START = '09:00';
const DEFAULT_END = '17:00';

// Generate 15-min increments from 5 AM to 11:45 PM, plus midnight
function generateTimeOptions(): { value: string; label: string }[] {
  const opts: { value: string; label: string }[] = [];
  for (let h = 5; h < 24; h++) {
    for (let m = 0; m < 60; m += 15) {
      const value = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
      const h12 = h > 12 ? h - 12 : h === 0 ? 12 : h;
      const ampm = h >= 12 ? 'PM' : 'AM';
      opts.push({ value, label: `${h12}:${String(m).padStart(2, '0')} ${ampm}` });
    }
  }
  opts.push({ value: '00:00', label: '12:00 AM (midnight)' });
  return opts;
}

const TIME_OPTIONS = generateTimeOptions();

function formatTimeShort(hhmm: string): string {
  if (!hhmm) return '';
  const [h, m] = hhmm.split(':').map(Number);
  const h12 = h > 12 ? h - 12 : h === 0 ? 12 : h;
  const ampm = h >= 12 ? 'PM' : 'AM';
  return m === 0 ? `${h12} ${ampm}` : `${h12}:${String(m).padStart(2, '0')} ${ampm}`;
}

// Type guards for the two slot shapes
function isNewSlot(slot: TemplateSlot): slot is TemplateSlotNew {
  return 'available' in slot;
}
function isLegacySlot(slot: TemplateSlot): slot is TemplateSlotLegacy {
  return 'morning' in slot;
}

// Map a DayTemplate to morning/afternoon/evening slots for userAvailability
function slotsFromDayTemplate(slot: DayTemplate): { morning: boolean; afternoon: boolean; evening: boolean; all_day: boolean } {
  if (!slot.available) return { morning: false, afternoon: false, evening: false, all_day: false };
  const [startH] = slot.startTime.split(':').map(Number);
  const [endH, endM] = slot.endTime.split(':').map(Number);
  // morning:   covers 6 AM – 12 PM slot; available if shift starts before noon
  const morning = startH < 12;
  // afternoon: covers 12 PM – 6 PM; available if end is past noon and start is before 6 PM
  const afternoon = startH < 18 && (endH > 12 || (endH === 12 && endM > 0));
  // evening:   covers 6 PM – close; available if end goes past 18:00 OR midnight (endH === 0)
  const evening = endH > 18 || (endH === 18 && endM > 0) || endH === 0;
  return { morning, afternoon, evening, all_day: morning && afternoon && evening };
}

// Parse a raw TemplateSlot (new or legacy format) into the editor DayTemplate shape
function parseDayTemplate(raw: TemplateSlot | undefined): DayTemplate {
  if (!raw) return { available: false, startTime: DEFAULT_START, endTime: DEFAULT_END };
  if (isNewSlot(raw)) {
    return {
      available: raw.available,
      startTime: raw.startTime ?? DEFAULT_START,
      endTime: raw.endTime ?? DEFAULT_END,
    };
  }
  if (isLegacySlot(raw)) {
    return {
      available: raw.morning || raw.afternoon || raw.evening,
      startTime: DEFAULT_START,
      endTime: DEFAULT_END,
    };
  }
  return { available: false, startTime: DEFAULT_START, endTime: DEFAULT_END };
}

function emptyWeekTemplateSlots(): Record<string, DayTemplate> {
  return Object.fromEntries(
    Array.from({ length: 7 }, (_, i) => [String(i), { available: false, startTime: DEFAULT_START, endTime: DEFAULT_END }])
  );
}

// ─── Static config ──────────────────────────────────────────────────────────
const timeSlots: { value: TimeSlot; label: string; hours: string; Icon: React.ComponentType<{ className?: string }> }[] = [
  { value: 'all_day', label: 'All Day', hours: '9 AM–9 PM', Icon: Clock },
  { value: 'morning', label: 'Morning', hours: '6 AM–12 PM', Icon: Sun },
  { value: 'afternoon', label: 'Afternoon', hours: '12–6 PM', Icon: Sunset },
  { value: 'evening', label: 'Evening', hours: '6 PM–close', Icon: Moon },
];

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DAY_FULL = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const timeOffTypes = [
  { value: 'vacation', label: 'Vacation', Icon: Umbrella },
  { value: 'sick', label: 'Sick Leave', Icon: Thermometer },
  { value: 'personal', label: 'Personal', Icon: User },
  { value: 'unpaid', label: 'Unpaid Leave', Icon: CalendarMinus },
  { value: 'other', label: 'Other', Icon: MoreHorizontal },
];

// ─── Helpers ─────────────────────────────────────────────────────────────────
function emptyDaySlots(): Record<TimeSlot, boolean> {
  return { all_day: false, morning: false, afternoon: false, evening: false };
}

function getWeekDates(referenceDate: Date): Date[] {
  const start = new Date(referenceDate);
  start.setDate(start.getDate() - start.getDay());
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    return d;
  });
}

function getMonthDays(year: number, month: number): (Date | null)[] {
  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);
  const days: (Date | null)[] = [];
  for (let i = 0; i < firstDay.getDay(); i++) days.push(null);
  for (let i = 1; i <= lastDay.getDate(); i++) {
    days.push(new Date(year, month, i));
  }
  return days;
}

function formatDateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// ─── DayNoteButton sub-component ─────────────────────────────────────────────
function DayNoteButton({ date, notes, userId }: {
  date: Date;
  notes: DayNote[];
  userId: string;
}) {
  const { toast } = useToast();
  const dateKey = formatDateKey(date);
  const myNote = notes.find(n => n.date === dateKey && n.userId === userId && !n.isManagerNote);
  const [open, setOpen] = useState(false);
  const [text, setText] = useState(myNote?.noteText || '');

  useEffect(() => {
    setText(myNote?.noteText || '');
  }, [myNote]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (myNote) {
        return apiRequest('PATCH', `/api/day-notes/${myNote.id}`, { noteText: text });
      } else {
        return apiRequest('POST', '/api/day-notes', { date: dateKey, noteText: text, isManagerNote: false });
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/day-notes'] });
      setOpen(false);
      toast({ title: "Note saved" });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to save note.", variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async () => {
      if (!myNote) return;
      return apiRequest('DELETE', `/api/day-notes/${myNote.id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/day-notes'] });
      setOpen(false);
      setText('');
      toast({ title: "Note deleted" });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to delete note.", variant: "destructive" });
    },
  });

  const hasNote = !!myNote;

  return (
    <Popover open={open} onOpenChange={(o) => { setOpen(o); if (o) setText(myNote?.noteText || ''); }}>
      <PopoverTrigger asChild>
        <button
          className={cn(
            "mx-auto flex items-center justify-center w-6 h-6 rounded transition-all mt-0.5",
            hasNote ? "text-amber-500 hover:text-amber-600" : "text-muted-foreground/40 hover:text-muted-foreground"
          )}
          title={hasNote ? "Edit note" : "Add note"}
        >
          <StickyNote className="h-3.5 w-3.5" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-64 p-3" side="bottom" align="center">
        <div className="space-y-2">
          <div className="text-xs font-medium text-muted-foreground">
            Note for {date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
          </div>
          <Textarea
            value={text}
            onChange={e => setText(e.target.value)}
            placeholder="Add a note for this day..."
            className="text-xs min-h-[80px] resize-none"
            autoFocus
          />
          <div className="flex gap-2">
            <Button
              size="sm"
              className="flex-1 h-7 text-xs"
              disabled={saveMutation.isPending || !text.trim()}
              onClick={() => saveMutation.mutate()}
            >
              {saveMutation.isPending ? "Saving..." : "Save"}
            </Button>
            {hasNote && (
              <Button
                size="sm"
                variant="ghost"
                className="h-7 text-xs text-destructive hover:text-destructive"
                disabled={deleteMutation.isPending}
                onClick={() => deleteMutation.mutate()}
              >
                Delete
              </Button>
            )}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

// ─── Main Availability page ───────────────────────────────────────────────────
const DOW_KEYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'] as const;

export default function Availability() {
  const { user } = useAuth();
  const { toast } = useToast();
  const { settings: companySettings } = useCompanySettings();

  const [showDefaultSchedule, setShowDefaultSchedule] = useState(false);
  // Tabs
  const [activeTab, setActiveTab] = useState("availability");

  // Weekly view state
  const [selectedWeek, setSelectedWeek] = useState(new Date());
  const [availabilityData, setAvailabilityData] = useState<Record<string, Record<TimeSlot, boolean>>>({});
  const [hasChanges, setHasChanges] = useState(false);
  // showAutoFilledPill: controls the dismissible info pill; dismissed independently of labels
  const [showAutoFilledPill, setShowAutoFilledPill] = useState(false);
  // weekWasAutoFilled: true for the entire session on this week (not cleared on pill dismiss)
  const [weekWasAutoFilled, setWeekWasAutoFilled] = useState(false);
  // Per-day time ranges stored from template; shown regardless of pill visibility
  const [autoFilledTimeRanges, setAutoFilledTimeRanges] = useState<Record<string, { startTime: string; endTime: string } | null>>({});
  // Keyed by week-start: once a week is auto-filled, it won't re-fill after user clears slots.
  const autoFilledWeeksRef = useRef<Set<string>>(new Set());

  // Time-off form state
  const [showTimeOffForm, setShowTimeOffForm] = useState(false);
  const [timeOffType, setTimeOffType] = useState("vacation");
  const [timeOffStartDate, setTimeOffStartDate] = useState("");
  const [timeOffEndDate, setTimeOffEndDate] = useState("");
  const [timeOffReason, setTimeOffReason] = useState("");

  // Default Week editor state
  const [templateSlots, setTemplateSlots] = useState<Record<string, DayTemplate>>(emptyWeekTemplateSlots);
  const [templateHasChanges, setTemplateHasChanges] = useState(false);
  const [autoApplyTemplate, setAutoApplyTemplate] = useState(false);
  // Preset time range for quick-fill buttons — seeded from the specific day's store hours in openDayEditor
  const [presetStart, setPresetStart] = useState(DEFAULT_START);
  const [presetEnd, setPresetEnd] = useState(DEFAULT_END);

  const isDesktop = useIsDesktop();

  // ── Manager / team toggle ───────────────────────────────────────────────────
  const roleName = user?.role?.name;
  const isManagerOrAbove = ['owner', 'admin', 'manager', 'assistant_manager'].includes(roleName ?? '');

  const [viewMode, setViewMode] = useState<'my' | 'team'>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('availability_view_mode');
      if (saved === 'team' || saved === 'my') return saved;
    }
    return 'my';
  });

  // Once the user role is known, enforce 'my' for non-managers (handles auth hydration timing)
  useEffect(() => {
    if (user && !isManagerOrAbove && viewMode === 'team') {
      setViewMode('my');
    }
  }, [user?.id, isManagerOrAbove]);

  const handleViewModeChange = (mode: 'my' | 'team') => {
    setViewMode(mode);
    localStorage.setItem('availability_view_mode', mode);
  };

  // ── Team grid week state ────────────────────────────────────────────────────
  const [teamWeek, setTeamWeek] = useState(new Date());
  const teamWeekDates = useMemo(() => getWeekDates(teamWeek), [teamWeek]);
  const teamWeekStart = formatDateKey(teamWeekDates[0]);
  const teamWeekEnd = formatDateKey(teamWeekDates[6]);

  // ── Per-card approval loading state ────────────────────────────────────────
  const [approvingIds, setApprovingIds] = useState<Set<string>>(new Set());
  const [approveAllPending, setApproveAllPending] = useState(false);

  // ── New calendar state ──────────────────────────────────────────────────────
  const [calViewMonth, setCalViewMonth] = useState(new Date());
  const [editorDay, setEditorDay] = useState<string | null>(null);

  // ── Team editor state (manager editing another employee's day) ───────────────
  const [teamEditorTarget, setTeamEditorTarget] = useState<{ userId: string; dateStr: string; empName: string } | null>(null);
  const [teamEditorMode, setTeamEditorMode] = useState<'available' | 'unavailable'>('available');
  const [teamEditorStart, setTeamEditorStart] = useState('09:00');
  const [teamEditorEnd, setTeamEditorEnd] = useState('17:00');
  const [editorStartTime, setEditorStartTime] = useState(DEFAULT_START);
  const [editorEndTime, setEditorEndTime] = useState(DEFAULT_END);
  const [editorUnavailable, setEditorUnavailable] = useState(false);
  // 'override' = only this specific date; 'template' = update the recurring weekly template
  const [editorScope, setEditorScope] = useState<'override' | 'template'>('override');

  // ── Derived values ──────────────────────────────────────────────────────────
  const weekDates = useMemo(() => getWeekDates(selectedWeek), [selectedWeek]);
  const startParam = formatDateKey(weekDates[0]);
  const endParam = formatDateKey(weekDates[6]);

  // Set of date keys that were silently auto-filled this session
  const autoFilledDateKeys = useMemo(
    () => weekWasAutoFilled ? new Set(weekDates.map(formatDateKey)) : new Set<string>(),
    [weekWasAutoFilled, weekDates]
  );

  const isWeekInPast = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return weekDates[6] < today;
  }, [weekDates]);

  // ── Queries ─────────────────────────────────────────────────────────────────
  const { data: currentAvailability = [], isLoading } = useQuery<UserAvailability[]>({
    queryKey: ['/api/availability', { startDate: startParam, endDate: endParam }],
    queryFn: async () => {
      const res = await fetch(`/api/availability?startDate=${startParam}&endDate=${endParam}`, { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to fetch');
      return res.json();
    },
  });

  const { data: dayNotes = [] } = useQuery<DayNote[]>({
    queryKey: ['/api/day-notes', startParam, endParam],
    queryFn: async () => {
      const res = await fetch(`/api/day-notes?startDate=${startParam}&endDate=${endParam}`, { credentials: 'include' });
      if (!res.ok) return [];
      return res.json();
    },
  });

  const { data: timeOffRequests = [] } = useQuery<TimeOffRequest[]>({
    queryKey: ['/api/time-off-requests'],
  });

  const { data: availabilityTemplate } = useQuery<AvailabilityTemplate | null>({
    queryKey: ['/api/availability/template'],
    queryFn: async () => {
      const res = await fetch('/api/availability/template', { credentials: 'include' });
      if (res.status === 404 || res.status === 204) return null;
      if (!res.ok) throw new Error('Failed to fetch availability template');
      return res.json();
    },
  });

  // ── New: merged calendar query ───────────────────────────────────────────────
  const calStart = formatDateKey(new Date(calViewMonth.getFullYear(), calViewMonth.getMonth(), 1));
  const calEnd = formatDateKey(new Date(calViewMonth.getFullYear(), calViewMonth.getMonth() + 1, 0));

  const { data: calendarData = [], isLoading: calendarLoading } = useQuery<CalDayEntry[]>({
    queryKey: ['/api/availability/calendar', calStart, calEnd],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/availability/calendar?start=${calStart}&end=${calEnd}`);
      return res.json();
    },
  });

  const calByDate = useMemo(() => {
    const map: Record<string, CalDayEntry> = {};
    for (const e of calendarData) map[e.date] = e;
    return map;
  }, [calendarData]);

  // ── Team view queries (manager-only) ─────────────────────────────────────────
  interface TeamEntryRow {
    userId: string;
    available: boolean;
    unavailable: boolean;
    startTime: string | null;
    endTime: string | null;
    setByManagerId: string | null;
    source: 'time_off' | 'override' | 'template' | 'default';
    overridePending?: boolean;
    overrideId?: string;
  }

  interface PendingOverride {
    id: string;
    userId: string;
    date: string;
    startTime: string | null;
    endTime: string | null;
    unavailable: boolean;
    status: string;
    approvalNote: string | null;
    createdAt: string;
    firstName: string | null;
    lastName: string | null;
    email: string | null;
  }

  interface StoreUser {
    id: string;
    firstName: string | null;
    lastName: string | null;
    email: string | null;
  }

  const { data: teamCalendarData = {}, isLoading: teamCalendarLoading } = useQuery<Record<string, TeamEntryRow[]>>({
    queryKey: ['/api/availability/calendar/team', teamWeekStart, teamWeekEnd],
    queryFn: async () => {
      const res = await apiRequest('GET', `/api/availability/calendar/team?start=${teamWeekStart}&end=${teamWeekEnd}`);
      return res.json();
    },
    enabled: isManagerOrAbove && viewMode === 'team',
  });

  const { data: pendingOverrides = [], isLoading: pendingOverridesLoading } = useQuery<PendingOverride[]>({
    queryKey: ['/api/availability/pending-approvals'],
    queryFn: async () => {
      const res = await apiRequest('GET', '/api/availability/pending-approvals');
      return res.json();
    },
    enabled: isManagerOrAbove,
  });

  const { data: allTimeOffRequests = [], isLoading: allTimeOffLoading } = useQuery<TimeOffRequest[]>({
    queryKey: ['/api/time-off-requests', 'all'],
    queryFn: async () => {
      const res = await apiRequest('GET', '/api/time-off-requests?all=true');
      return res.json();
    },
    enabled: isManagerOrAbove,
  });

  const { data: storeUsers = [] } = useQuery<StoreUser[]>({
    queryKey: ['/api/users'],
    queryFn: async () => {
      const res = await apiRequest('GET', '/api/users');
      return res.json();
    },
    enabled: isManagerOrAbove && viewMode === 'team',
  });

  const pendingTimeOff = useMemo(
    () => allTimeOffRequests.filter(r => r.status === 'pending'),
    [allTimeOffRequests]
  );

  const totalPendingCount = pendingOverrides.length + pendingTimeOff.length;

  const userNameMap = useMemo(() => {
    const map: Record<string, string> = {};
    for (const u of storeUsers) {
      const name = [u.firstName, u.lastName].filter(Boolean).join(' ') || u.email || u.id;
      map[u.id] = name;
    }
    for (const o of pendingOverrides) {
      if (!map[o.userId]) {
        map[o.userId] = [o.firstName, o.lastName].filter(Boolean).join(' ') || o.email || o.userId;
      }
    }
    return map;
  }, [storeUsers, pendingOverrides]);

  const teamUserIds = useMemo(() => {
    const ids = new Set<string>();
    Object.values(teamCalendarData).forEach(entries => entries.forEach(e => ids.add(e.userId)));
    return Array.from(ids);
  }, [teamCalendarData]);

  // ── Team editor: fetch single day data for the target employee ───────────────
  const { data: teamEditorDayData } = useQuery<CalDayEntry[]>({
    queryKey: ['/api/availability/calendar', teamEditorTarget?.userId, teamEditorTarget?.dateStr],
    queryFn: async () => {
      const res = await fetch(
        `/api/availability/calendar?userId=${encodeURIComponent(teamEditorTarget!.userId)}&start=${teamEditorTarget!.dateStr}&end=${teamEditorTarget!.dateStr}`,
        { credentials: 'include' }
      );
      if (!res.ok) throw new Error('Failed to fetch');
      return res.json();
    },
    enabled: !!teamEditorTarget,
  });

  // ── Effects: sync server data → local state ─────────────────────────────────
  // Sync weekly availability from server (reset auto-fill UI state when new data loads)
  useEffect(() => {
    const availMap: Record<string, Record<TimeSlot, boolean>> = {};
    if (Array.isArray(currentAvailability)) {
      currentAvailability.forEach((avail: any) => {
        const dateKey = avail.date.split('T')[0];
        if (!availMap[dateKey]) availMap[dateKey] = emptyDaySlots();
        availMap[dateKey][avail.timeSlot as TimeSlot] = avail.isAvailable ?? false;
      });
    }
    setAvailabilityData(availMap);
    setHasChanges(false);
    setShowAutoFilledPill(false);
    setWeekWasAutoFilled(false);
    setAutoFilledTimeRanges({});
  }, [currentAvailability]);

  // Sync template from server → Default Week editor state
  // When the user has unsaved slot edits (templateHasChanges), only update the autoApplyTemplate
  // flag (which may have been saved independently via the instant-save toggle) and leave the
  // local slot state and dirty flag intact.
  useEffect(() => {
    if (!availabilityTemplate?.slots) return;
    if (templateHasChanges) {
      // Only sync the auto-apply flag — don't clobber unsaved slot edits
      setAutoApplyTemplate(availabilityTemplate.autoApplyTemplate ?? false);
      return;
    }
    const rawSlots = availabilityTemplate.slots as Record<string, TemplateSlot>;
    const newSlots = emptyWeekTemplateSlots();
    for (let i = 0; i < 7; i++) {
      newSlots[String(i)] = parseDayTemplate(rawSlots[String(i)]);
    }
    setTemplateSlots(newSlots);
    setAutoApplyTemplate(availabilityTemplate.autoApplyTemplate ?? false);
    setTemplateHasChanges(false);
  }, [availabilityTemplate, templateHasChanges]);

  // Auto-apply template to empty future weeks (silent, no prompt)
  const weekHasNoAvailability = useMemo(() => {
    if (!Array.isArray(currentAvailability)) return true;
    const weekDateKeys = new Set(weekDates.map(formatDateKey));
    return !currentAvailability.some((avail: UserAvailability) => {
      const dateKey = (avail.date as unknown as string).split('T')[0];
      return weekDateKeys.has(dateKey);
    });
  }, [currentAvailability, weekDates]);

  useEffect(() => {
    if (isLoading) return;
    if (!weekHasNoAvailability) return;
    if (isWeekInPast) return;
    if (hasChanges) return; // User has already interacted with this week this session — do not overwrite
    if (!availabilityTemplate?.slots) return;
    if (!availabilityTemplate.autoApplyTemplate) return; // Only auto-fill when the setting is enabled

    if (autoFilledWeeksRef.current.has(startParam)) return; // session guard: don't re-fill cleared weeks

    const rawSlots = availabilityTemplate.slots as Record<string, TemplateSlot>;
    const newData: Record<string, Record<TimeSlot, boolean>> = {};
    const timeRanges: Record<string, { startTime: string; endTime: string } | null> = {};

    weekDates.forEach(date => {
      const dow = date.getDay().toString();
      const dateKey = formatDateKey(date);
      const raw = rawSlots[dow];

      if (raw && isLegacySlot(raw)) {
        // Preserve original legacy granularity — do not round-trip through default times
        newData[dateKey] = {
          morning: raw.morning,
          afternoon: raw.afternoon,
          evening: raw.evening,
          all_day: raw.morning && raw.afternoon && raw.evening,
        };
        timeRanges[dateKey] = null; // No explicit time range for legacy slots
      } else {
        // New format: derive time-slot buckets from explicit start/end times
        const tpl = parseDayTemplate(raw);
        newData[dateKey] = slotsFromDayTemplate(tpl);
        // Store time range for display — only for new-format slots that are available with explicit times
        if (raw && isNewSlot(raw) && raw.available && raw.startTime && raw.endTime) {
          timeRanges[dateKey] = { startTime: raw.startTime, endTime: raw.endTime };
        } else {
          timeRanges[dateKey] = null;
        }
      }
    });

    autoFilledWeeksRef.current.add(startParam);

    setAvailabilityData(prev => ({ ...prev, ...newData }));
    setAutoFilledTimeRanges(timeRanges);
    setHasChanges(true);
    setWeekWasAutoFilled(true);
    // No banner when auto-apply is silently enabled
  }, [isLoading, weekHasNoAvailability, isWeekInPast, availabilityTemplate, weekDates, hasChanges, startParam]);

  // ── Mutations ────────────────────────────────────────────────────────────────
  const submitAvailabilityMutation = useMutation({
    mutationFn: async (availability: any[]) => {
      await apiRequest('POST', '/api/availability', { availability });
    },
    onSuccess: () => {
      toast({ title: "Availability saved", description: "Your availability has been updated." });
      queryClient.invalidateQueries({ queryKey: ['/api/availability'] });
      setHasChanges(false);
      setShowAutoFilledPill(false);
      setWeekWasAutoFilled(false);
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to save availability.", variant: "destructive" });
    },
  });

  const saveTemplateMutation = useMutation({
    mutationFn: async ({ slots, autoApply }: { slots: Record<string, { available: boolean; startTime?: string; endTime?: string }>; autoApply: boolean }) => {
      await apiRequest('POST', '/api/availability/template', { slots, autoApplyTemplate: autoApply });
    },
    onSuccess: () => {
      toast({ title: "Default schedule saved", description: "Your default week has been updated." });
      queryClient.invalidateQueries({ queryKey: ['/api/availability/template'] });
      setTemplateHasChanges(false);
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to save default schedule.", variant: "destructive" });
    },
  });

  const saveAutoApplyMutation = useMutation({
    mutationFn: async (autoApply: boolean) => {
      const result = await apiRequest('PATCH', '/api/availability/template/auto-apply', { autoApplyTemplate: autoApply });
      return result;
    },
    onSuccess: (_, autoApply) => {
      toast({
        title: autoApply ? "Auto-fill enabled" : "Auto-fill disabled",
        description: autoApply
          ? "Empty future weeks will now be filled from your default schedule."
          : "New weeks will no longer be auto-filled.",
      });
      // Update only the autoApplyTemplate field in the cached template to avoid a refetch
      // that would trigger the sync effect and overwrite any unsaved slot edits.
      queryClient.setQueryData(['/api/availability/template'], (old: AvailabilityTemplate | null | undefined) => {
        if (!old) return old;
        return { ...old, autoApplyTemplate: autoApply };
      });
    },
    onError: (_, autoApply) => {
      // Revert the optimistic switch state on failure
      setAutoApplyTemplate(!autoApply);
      toast({ title: "Error", description: "Failed to update auto-fill setting.", variant: "destructive" });
    },
  });

  const createTimeOffMutation = useMutation({
    mutationFn: async (data: any) => {
      await apiRequest('POST', '/api/time-off-requests', data);
    },
    onSuccess: () => {
      toast({ title: "Request submitted", description: "Your time-off request has been sent to your manager." });
      queryClient.invalidateQueries({ queryKey: ['/api/time-off-requests'] });
      setShowTimeOffForm(false);
      setTimeOffType("vacation");
      setTimeOffStartDate("");
      setTimeOffEndDate("");
      setTimeOffReason("");
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to submit request.", variant: "destructive" });
    },
  });

  const cancelTimeOffMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest('PATCH', `/api/time-off-requests/${id}`, { status: 'cancelled' });
    },
    onSuccess: () => {
      toast({ title: "Cancelled", description: "Time-off request has been cancelled." });
      queryClient.invalidateQueries({ queryKey: ['/api/time-off-requests'] });
    },
  });

  const saveDayOverrideMutation = useMutation({
    mutationFn: async (body: { date: string; startTime?: string; endTime?: string; unavailable: boolean }) => {
      await apiRequest('PATCH', '/api/availability/day', body);
    },
    onSuccess: () => {
      toast({ title: "Availability saved" });
      invalidatePrefix('/api/availability/calendar');
      setEditorDay(null);
      setWeekWasAutoFilled(false);
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to save.", variant: "destructive" });
    },
  });

  const clearDayOverrideMutation = useMutation({
    mutationFn: async (date: string) => {
      await apiRequest('DELETE', `/api/availability/day?date=${date}`);
    },
    onSuccess: () => {
      toast({ title: "Cleared", description: "Reverted to your default schedule." });
      invalidatePrefix('/api/availability/calendar');
      setEditorDay(null);
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to clear.", variant: "destructive" });
    },
  });

  // ── Team editor mutations (manager editing another employee) ─────────────────
  const teamEditorSaveMutation = useMutation({
    mutationFn: async () => {
      return apiRequest('PATCH', '/api/availability/day', {
        userId: teamEditorTarget!.userId,
        date: teamEditorTarget!.dateStr,
        unavailable: teamEditorMode === 'unavailable',
        startTime: teamEditorMode === 'available' ? teamEditorStart : undefined,
        endTime: teamEditorMode === 'available' ? teamEditorEnd : undefined,
      });
    },
    onSuccess: () => {
      toast({ title: "Availability updated", description: `Saved for ${teamEditorTarget?.empName}` });
      invalidatePrefix('/api/availability/calendar');
      setTeamEditorTarget(null);
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to save override.", variant: "destructive" });
    },
  });

  const teamEditorClearMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(
        `/api/availability/day?date=${encodeURIComponent(teamEditorTarget!.dateStr)}&userId=${encodeURIComponent(teamEditorTarget!.userId)}`,
        { method: 'DELETE', credentials: 'include' }
      );
      if (!res.ok) throw new Error('Failed');
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Override cleared", description: `${teamEditorTarget?.empName} reverted to default schedule.` });
      invalidatePrefix('/api/availability/calendar');
      setTeamEditorTarget(null);
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to clear override.", variant: "destructive" });
    },
  });

  const reviewOverrideMutation = useMutation({
    mutationFn: async ({ id, action }: { id: string; action: 'approve' | 'reject' }) => {
      await apiRequest('PATCH', `/api/availability/overrides/${id}/review`, { action });
    },
    onMutate: async ({ id }) => {
      setApprovingIds(prev => new Set(prev).add(id));
      // Optimistically remove the card from the pending list
      await queryClient.cancelQueries({ queryKey: ['/api/availability/pending-approvals'] });
      const previous = queryClient.getQueryData<PendingOverride[]>(['/api/availability/pending-approvals']);
      queryClient.setQueryData<PendingOverride[]>(['/api/availability/pending-approvals'], (old = []) =>
        old.filter(o => o.id !== id)
      );
      return { previous };
    },
    onSuccess: (_, { action }) => {
      toast({ title: action === 'approve' ? "Approved" : "Denied", description: "Availability request updated." });
      queryClient.invalidateQueries({ queryKey: ['/api/availability/pending-approvals'] });
      invalidatePrefix('/api/availability/calendar/team');
    },
    onError: (_, { action }, context: any) => {
      if (context?.previous !== undefined) {
        queryClient.setQueryData(['/api/availability/pending-approvals'], context.previous);
      }
      toast({ title: "Error", description: `Failed to ${action === 'approve' ? 'approve' : 'deny'} request.`, variant: "destructive" });
    },
    onSettled: (_, __, { id }) => {
      setApprovingIds(prev => { const s = new Set(prev); s.delete(id); return s; });
    },
  });

  const reviewTimeOffMutation = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: 'approved' | 'denied' }) => {
      await apiRequest('PATCH', `/api/time-off-requests/${id}`, { status });
    },
    onMutate: async ({ id }) => {
      setApprovingIds(prev => new Set(prev).add(`to-${id}`));
      // Optimistically remove the card from the pending time-off list
      await queryClient.cancelQueries({ queryKey: ['/api/time-off-requests', 'all'] });
      const previous = queryClient.getQueryData<TimeOffRequest[]>(['/api/time-off-requests', 'all']);
      queryClient.setQueryData<TimeOffRequest[]>(['/api/time-off-requests', 'all'], (old = []) =>
        old.filter(r => r.id !== id)
      );
      return { previous };
    },
    onSuccess: (_, { status }) => {
      toast({ title: status === 'approved' ? "Approved" : "Denied", description: "Time-off request updated." });
      queryClient.invalidateQueries({ queryKey: ['/api/time-off-requests', 'all'] });
      queryClient.invalidateQueries({ queryKey: ['/api/time-off-requests'] });
      queryClient.invalidateQueries({ queryKey: ['/api/availability/pending-approvals'] });
      invalidatePrefix('/api/availability/calendar/team');
    },
    onError: (_, { status }, context: any) => {
      if (context?.previous !== undefined) {
        queryClient.setQueryData(['/api/time-off-requests', 'all'], context.previous);
      }
      toast({ title: "Error", description: `Failed to ${status === 'approved' ? 'approve' : 'deny'} time-off request.`, variant: "destructive" });
    },
    onSettled: (_, __, { id }) => {
      setApprovingIds(prev => { const s = new Set(prev); s.delete(`to-${id}`); return s; });
    },
  });

  const handleApproveAll = useCallback(async () => {
    if (totalPendingCount === 0 || approveAllPending) return;
    setApproveAllPending(true);
    try {
      await Promise.all([
        ...pendingOverrides.map(o =>
          apiRequest('PATCH', `/api/availability/overrides/${o.id}/review`, { action: 'approve' })
        ),
        ...pendingTimeOff.map(r =>
          apiRequest('PATCH', `/api/time-off-requests/${r.id}`, { status: 'approved' })
        ),
      ]);
      queryClient.invalidateQueries({ queryKey: ['/api/availability/pending-approvals'] });
      queryClient.invalidateQueries({ queryKey: ['/api/time-off-requests', 'all'] });
      queryClient.invalidateQueries({ queryKey: ['/api/time-off-requests'] });
      invalidatePrefix('/api/availability/calendar/team');
      toast({ title: `Approved all ${totalPendingCount} request${totalPendingCount !== 1 ? 's' : ''}`, description: "All pending requests have been approved." });
    } catch {
      toast({ title: "Error", description: "Some requests could not be approved.", variant: "destructive" });
      queryClient.invalidateQueries({ queryKey: ['/api/availability/pending-approvals'] });
      queryClient.invalidateQueries({ queryKey: ['/api/time-off-requests', 'all'] });
    } finally {
      setApproveAllPending(false);
    }
  }, [totalPendingCount, approveAllPending, pendingOverrides, pendingTimeOff, queryClient, invalidatePrefix, toast]);

  const saveTemplateDayMutation = useMutation({
    mutationFn: async (body: { dow: number; startTime?: string; endTime?: string; unavailable: boolean }) => {
      // Preserve existing entries exactly as-is; only write the day that changed.
      // Do NOT auto-fill missing days with available:false — a missing entry means
      // "available by default" (unavailability-first model) and must stay absent.
      const currentSlots = availabilityTemplate?.slots
        ? { ...(availabilityTemplate.slots as Record<string, { available: boolean; startTime?: string; endTime?: string }>) }
        : {} as Record<string, { available: boolean; startTime?: string; endTime?: string }>;
      currentSlots[String(body.dow)] = {
        available: !body.unavailable,
        startTime: !body.unavailable ? body.startTime : undefined,
        endTime: !body.unavailable ? body.endTime : undefined,
      };
      await apiRequest('POST', '/api/availability/template', { slots: currentSlots });
    },
    onSuccess: () => {
      toast({ title: "Default schedule updated", description: "This day-of-week will now auto-fill every week." });
      queryClient.invalidateQueries({ queryKey: ['/api/availability/template'] });
      invalidatePrefix('/api/availability/calendar');
      setEditorDay(null);
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to save default schedule.", variant: "destructive" });
    },
  });

  // ── Handlers: weekly view ────────────────────────────────────────────────────
  const toggleSlot = (date: Date, slot: TimeSlot) => {
    const dateKey = formatDateKey(date);
    setAvailabilityData(prev => {
      const dayData = prev[dateKey] || emptyDaySlots();
      if (slot === 'all_day') {
        const newVal = !dayData.all_day;
        return { ...prev, [dateKey]: { all_day: newVal, morning: newVal, afternoon: newVal, evening: newVal } };
      }
      const newSlotVal = !dayData[slot];
      const newDay = { ...dayData, [slot]: newSlotVal };
      newDay.all_day = newDay.morning && newDay.afternoon && newDay.evening;
      return { ...prev, [dateKey]: newDay };
    });
    setHasChanges(true);
  };

  const applyPreset = (preset: 'weekdays' | 'weekends' | 'all' | 'clear') => {
    const newData: Record<string, Record<TimeSlot, boolean>> = {};
    weekDates.forEach(date => {
      const dateKey = formatDateKey(date);
      const dow = date.getDay();
      const isWeekday = dow > 0 && dow < 6;
      const available =
        preset === 'all' ? true :
        preset === 'clear' ? false :
        preset === 'weekdays' ? isWeekday : !isWeekday;
      newData[dateKey] = { all_day: available, morning: available, afternoon: available, evening: available };
    });
    setAvailabilityData(prev => ({ ...prev, ...newData }));
    setHasChanges(true);
  };

  const handleSaveAvailability = () => {
    const availability: any[] = [];
    weekDates.forEach(date => {
      const dateKey = formatDateKey(date);
      const slots = availabilityData[dateKey] || emptyDaySlots();
      (['morning', 'afternoon', 'evening'] as TimeSlot[]).forEach(slot => {
        availability.push({
          date: new Date(dateKey + 'T12:00:00Z').toISOString(),
          timeSlot: slot,
          isAvailable: slots[slot] ?? false,
        });
      });
    });
    submitAvailabilityMutation.mutate(availability);
  };

  // ── Handlers: Default Week editor ───────────────────────────────────────────
  const toggleTemplateDay = (dow: string) => {
    setTemplateSlots(prev => {
      const slot = prev[dow];
      return { ...prev, [dow]: { ...slot, available: !slot.available } };
    });
    setTemplateHasChanges(true);
  };

  const updateTemplateTime = (dow: string, field: 'startTime' | 'endTime', value: string) => {
    setTemplateSlots(prev => {
      const slot = prev[dow];
      return { ...prev, [dow]: { ...slot, [field]: value } };
    });
    setTemplateHasChanges(true);
  };

  const applyTemplatePreset = (preset: 'weekdays' | 'weekends' | 'all' | 'clear') => {
    const newSlots = emptyWeekTemplateSlots();
    for (let i = 0; i < 7; i++) {
      const isWeekday = i > 0 && i < 6;
      const on =
        preset === 'all' ? true :
        preset === 'clear' ? false :
        preset === 'weekdays' ? isWeekday : !isWeekday;
      newSlots[String(i)] = {
        available: on,
        startTime: on ? presetStart : DEFAULT_START,
        endTime: on ? presetEnd : DEFAULT_END,
      };
    }
    setTemplateSlots(newSlots);
    setTemplateHasChanges(true);
  };

  const handleSaveTemplate = () => {
    // Validate time ranges before saving
    for (let i = 0; i < 7; i++) {
      const slot = templateSlots[String(i)];
      if (slot.available && slot.startTime >= slot.endTime && slot.endTime !== '00:00') {
        toast({
          title: "Invalid time range",
          description: `${DAY_NAMES[i]}: end time must be after start time.`,
          variant: "destructive",
        });
        return;
      }
    }
    const slots: Record<string, { available: boolean; startTime?: string; endTime?: string }> = {};
    for (let i = 0; i < 7; i++) {
      const key = String(i);
      const slot = templateSlots[key];
      slots[key] = {
        available: slot.available,
        startTime: slot.available ? slot.startTime : undefined,
        endTime: slot.available ? slot.endTime : undefined,
      };
    }
    saveTemplateMutation.mutate({ slots, autoApply: autoApplyTemplate });
  };

  const handleSubmitTimeOff = () => {
    if (!timeOffStartDate || !timeOffEndDate) {
      toast({ title: "Missing dates", description: "Please select start and end dates.", variant: "destructive" });
      return;
    }
    createTimeOffMutation.mutate({
      type: timeOffType,
      startDate: timeOffStartDate,
      endDate: timeOffEndDate,
      reason: timeOffReason || null,
    });
  };

  // ── Calendar day editor opener ──────────────────────────────────────────────
  const openDayEditor = (dateStr: string) => {
    const entry = calByDate[dateStr];
    // Time-off days cannot be edited here
    if (entry?.source === 'time_off') {
      toast({ title: "Time off", description: "This day has an approved time-off request." });
      return;
    }
    // User is actively editing — dismiss the auto-fill indicator
    if (weekWasAutoFilled) setWeekWasAutoFilled(false);

    // Derive per-day scheduling hours for this date
    const dowIndex = new Date(dateStr + 'T12:00:00Z').getUTCDay();
    const dayKey = DOW_KEYS[dowIndex];
    const daySchedule = companySettings?.schedulingHoursByDay?.[dayKey];
    const storeStart = (daySchedule?.enabled && daySchedule.startTime) ? daySchedule.startTime : DEFAULT_START;
    const storeEnd = (daySchedule?.enabled && daySchedule.endTime) ? daySchedule.endTime : DEFAULT_END;

    // Seed preset buttons for this specific day
    setPresetStart(storeStart);
    setPresetEnd(storeEnd);

    // Pre-fill from existing data
    if (entry && entry.available) {
      setEditorStartTime(entry.startTime || storeStart);
      setEditorEndTime(entry.endTime || storeEnd);
      setEditorUnavailable(false);
    } else if (entry && entry.unavailable) {
      setEditorStartTime(storeStart);
      setEditorEndTime(storeEnd);
      setEditorUnavailable(true);
    } else {
      setEditorStartTime(storeStart);
      setEditorEndTime(storeEnd);
      setEditorUnavailable(false);
    }
    // If the day already has an override, default scope to override; else default to override too (most common case)
    setEditorScope('override');
    setEditorDay(dateStr);
  };

  const handleSaveDay = () => {
    if (!editorDay) return;
    if (editorScope === 'override') {
      saveDayOverrideMutation.mutate({
        date: editorDay,
        startTime: editorUnavailable ? undefined : editorStartTime,
        endTime: editorUnavailable ? undefined : editorEndTime,
        unavailable: editorUnavailable,
      });
    } else {
      const dateObj = new Date(editorDay + 'T12:00:00Z');
      saveTemplateDayMutation.mutate({
        dow: dateObj.getUTCDay(),
        startTime: editorUnavailable ? undefined : editorStartTime,
        endTime: editorUnavailable ? undefined : editorEndTime,
        unavailable: editorUnavailable,
      });
    }
  };

  // ── Team editor: seed state when fetched day data arrives ───────────────────
  useEffect(() => {
    if (!teamEditorDayData) return;
    const dayInfo = teamEditorDayData[0] ?? null;
    if (!dayInfo) {
      setTeamEditorMode('available');
      setTeamEditorStart('09:00');
      setTeamEditorEnd('17:00');
      return;
    }
    if (dayInfo.unavailable || !dayInfo.available) {
      setTeamEditorMode('unavailable');
    } else {
      setTeamEditorMode('available');
      setTeamEditorStart(dayInfo.startTime ?? '09:00');
      setTeamEditorEnd(dayInfo.endTime ?? '17:00');
    }
  }, [teamEditorDayData]);

  // ── Team editor: open helper ─────────────────────────────────────────────────
  const openTeamEditor = (userId: string, dateStr: string, empName: string) => {
    setTeamEditorMode('available');
    setTeamEditorStart('09:00');
    setTeamEditorEnd('17:00');
    setTeamEditorTarget({ userId, dateStr, empName });
  };

  // ── Computed summary helpers ─────────────────────────────────────────────────
  const getDayAvailabilitySummary = (date: Date): 'full' | 'partial' | 'none' => {
    const dateKey = formatDateKey(date);
    const slots = availabilityData[dateKey];
    if (!slots) return 'none';
    const count = [slots.morning, slots.afternoon, slots.evening].filter(Boolean).length;
    return count === 3 ? 'full' : count > 0 ? 'partial' : 'none';
  };


  const myRequests = timeOffRequests.filter((r: TimeOffRequest) => r.userId === user?.id);
  const pendingCount = myRequests.filter(r => r.status === 'pending').length;

  const statusColors: Record<string, string> = {
    pending: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
    approved: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
    denied: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
    cancelled: 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400',
  };

  // ── Render ───────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-background p-4 md:p-6">
      {/* ── Manager/Team toggle ─────────────────────────────────────────────── */}
      {isManagerOrAbove && (
        <div className="mb-4 flex rounded-xl border bg-muted/40 p-1 gap-1">
          <button
            onClick={() => handleViewModeChange('my')}
            className={cn(
              "flex-1 flex items-center justify-center gap-2 rounded-lg py-2.5 text-sm font-semibold transition-all",
              viewMode === 'my'
                ? "bg-primary text-primary-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            <User className="h-4 w-4" />
            My Availability
          </button>
          <button
            onClick={() => handleViewModeChange('team')}
            className={cn(
              "flex-1 flex items-center justify-center gap-2 rounded-lg py-2.5 text-sm font-semibold transition-all relative",
              viewMode === 'team'
                ? "bg-primary text-primary-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            <Users className="h-4 w-4" />
            Team View
            {totalPendingCount > 0 && (
              <span className={cn(
                "ml-0.5 inline-flex items-center justify-center rounded-full text-[10px] font-bold min-w-[18px] h-[18px] px-1",
                viewMode === 'team'
                  ? "bg-white text-primary"
                  : "bg-destructive text-destructive-foreground"
              )}>
                {totalPendingCount}
              </span>
            )}
          </button>
        </div>
      )}

      {/* ── Team View ──────────────────────────────────────────────────────── */}
      {isManagerOrAbove && viewMode === 'team' && (
        <div className="space-y-4">
          {/* Team availability grid */}
          <Card>
            <CardContent className="p-4">
              {/* Week navigation */}
              <div className="flex items-center justify-between mb-4">
                <button
                  onClick={() => setTeamWeek(d => { const n = new Date(d); n.setDate(n.getDate() - 7); return n; })}
                  className="p-1.5 rounded-md hover:bg-muted transition-colors"
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>
                <span className="text-sm font-semibold">
                  {teamWeekDates[0].toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                  {' – '}
                  {teamWeekDates[6].toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                </span>
                <button
                  onClick={() => setTeamWeek(d => { const n = new Date(d); n.setDate(n.getDate() + 7); return n; })}
                  className="p-1.5 rounded-md hover:bg-muted transition-colors"
                >
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>

              {teamCalendarLoading ? (
                <div className="space-y-2">
                  {[1,2,3,4].map(i => (
                    <div key={i} className="h-10 bg-muted/50 rounded-lg animate-pulse" />
                  ))}
                </div>
              ) : teamUserIds.length === 0 ? (
                <div className="text-center py-8 text-sm text-muted-foreground">
                  <Users className="h-8 w-8 mx-auto mb-2 text-muted-foreground/40" />
                  No team members found
                </div>
              ) : (
                <div className="overflow-x-auto -mx-4 px-4">
                  <table className="w-full text-xs border-collapse" style={{ minWidth: '480px' }}>
                    <thead>
                      <tr>
                        <th className="sticky left-0 bg-background z-10 text-left py-1.5 pr-3 font-medium text-muted-foreground w-28 min-w-[7rem]">
                          Employee
                        </th>
                        {teamWeekDates.map((date, colIdx) => (
                          <th
                            key={colIdx}
                            className={cn(
                              "text-center py-1.5 px-1 font-medium text-muted-foreground",
                              colIdx % 2 === 0 ? "bg-background" : "bg-muted/30"
                            )}
                          >
                            <span className="block">{DAY_NAMES[date.getDay()]}</span>
                            <span className="block text-[10px] font-normal">
                              {date.toLocaleDateString('en-US', { month: 'numeric', day: 'numeric' })}
                            </span>
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {teamUserIds.map((uid) => {
                        const name = userNameMap[uid] || uid;
                        const todayStr = formatDateKey(new Date());
                        const nameClickDate = teamWeekDates.find(d => formatDateKey(d) === todayStr)
                          ? todayStr
                          : formatDateKey(teamWeekDates[0]);
                        return (
                          <tr key={uid} className="border-t border-border/40">
                            <td className="sticky left-0 bg-background z-10 py-2 pr-3 max-w-[7rem]">
                              <button
                                onClick={() => openTeamEditor(uid, nameClickDate, name)}
                                className="text-left font-medium text-foreground truncate max-w-[7rem] hover:text-primary hover:underline transition-colors cursor-pointer w-full"
                                title={`Edit ${name}'s availability`}
                              >
                                {name.split(' ')[0]}
                                {name.includes(' ') && (
                                  <span className="text-muted-foreground"> {name.split(' ').slice(1).join(' ')}</span>
                                )}
                              </button>
                            </td>
                            {teamWeekDates.map((date, colIdx) => {
                              const dateStr = formatDateKey(date);
                              const entries = teamCalendarData[dateStr] ?? [];
                              const entry = entries.find(e => e.userId === uid);
                              const isPending = !!(entry?.overridePending);
                              const isTimeOff = entry?.source === 'time_off';
                              const isUnavailable = !!(entry?.unavailable) && !isPending;
                              const isAvailable = entry?.available && !isTimeOff && !isUnavailable && !isPending;
                              const hasHours = isAvailable && entry?.startTime && entry?.endTime;
                              const pendingHasHours = isPending && entry?.startTime && entry?.endTime;

                              return (
                                <td
                                  key={colIdx}
                                  className={cn(
                                    "py-2 px-1 text-center align-middle",
                                    colIdx % 2 === 0 ? "bg-background" : "bg-muted/30"
                                  )}
                                >
                                  {isPending ? (
                                    <button
                                      title={entry?.unavailable
                                        ? "Pending: wants to mark unavailable — click to approve"
                                        : pendingHasHours
                                          ? `Pending: ${formatTimeShort(entry!.startTime!)}–${formatTimeShort(entry!.endTime!)} — click to approve`
                                          : "Pending availability change — click to approve"}
                                      className="inline-flex flex-col items-center gap-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400 cursor-pointer hover:bg-amber-200 dark:hover:bg-amber-900/50 transition-colors"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        if (entry?.overrideId) {
                                          reviewOverrideMutation.mutate({ id: entry.overrideId, action: 'approve' });
                                        }
                                      }}
                                    >
                                      {pendingHasHours ? (
                                        <>
                                          {formatTimeShort(entry!.startTime!)}
                                          <span className="text-[9px] font-normal opacity-80">–{formatTimeShort(entry!.endTime!)}</span>
                                        </>
                                      ) : entry?.unavailable ? (
                                        <span>No*</span>
                                      ) : (
                                        <span>Avail*</span>
                                      )}
                                    </button>
                                  ) : (
                                    <button
                                      onClick={() => openTeamEditor(uid, dateStr, name)}
                                      className="inline-flex items-center justify-center w-full rounded hover:opacity-80 active:scale-95 transition-all focus:outline-none focus:ring-1 focus:ring-primary/50"
                                      title={`Edit ${name}'s availability for ${date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}`}
                                    >
                                      {isTimeOff ? (
                                        <span className="inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[10px] font-medium bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-400">
                                          <Umbrella className="h-2.5 w-2.5" />
                                          Off
                                        </span>
                                      ) : isUnavailable ? (
                                        <span className="inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[10px] font-medium bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400">
                                          <Ban className="h-2.5 w-2.5" />
                                          No
                                        </span>
                                      ) : hasHours ? (
                                        <span className="inline-flex flex-col items-center rounded-full px-1.5 py-0.5 text-[10px] font-medium bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400">
                                          {formatTimeShort(entry!.startTime!)}
                                          <span className="text-[9px] font-normal opacity-80">–{formatTimeShort(entry!.endTime!)}</span>
                                        </span>
                                      ) : isAvailable ? (
                                        <span className="inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[10px] font-medium bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400">
                                          <Check className="h-2.5 w-2.5" />
                                          Avail
                                        </span>
                                      ) : (
                                        <span className="inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[10px] font-medium bg-green-50 text-green-600 dark:bg-green-950/20 dark:text-green-500">
                                          <Check className="h-2.5 w-2.5 opacity-60" />
                                          Open
                                        </span>
                                      )}
                                    </button>
                                  )}
                                </td>
                              );
                            })}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}

              {/* Grid legend */}
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-3 text-[10px] text-muted-foreground">
                <div className="flex items-center gap-1"><span className="rounded-full px-1.5 py-0.5 bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400">Open</span>Available by default</div>
                <div className="flex items-center gap-1"><span className="rounded-full px-1.5 py-0.5 bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400">9 AM–5 PM</span>Hours set</div>
                <div className="flex items-center gap-1"><span className="rounded-full px-1.5 py-0.5 bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400">No</span>Unavailable</div>
                <div className="flex items-center gap-1"><span className="rounded-full px-1.5 py-0.5 bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-400">Off</span>Time off</div>
                <div className="flex items-center gap-1"><span className="rounded-full px-1.5 py-0.5 bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">Avail*</span>Pending approval — click to approve</div>
                <div className="flex items-center gap-1 ml-auto italic opacity-70">Tap any cell or name to edit</div>
              </div>
            </CardContent>
          </Card>

          {/* Pending approvals */}
          <div>
            <div className="flex items-center gap-2 mb-3">
              <CalendarRange className="h-4 w-4 text-muted-foreground" />
              <h3 className="text-sm font-semibold">Pending Approvals</h3>
              {totalPendingCount > 0 && (
                <span className="inline-flex items-center justify-center rounded-full bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400 text-[10px] font-bold min-w-[18px] h-[18px] px-1">
                  {totalPendingCount}
                </span>
              )}
              {totalPendingCount > 1 && (
                <Button
                  size="sm"
                  variant="outline"
                  className="ml-auto h-7 text-xs border-green-400 text-green-700 hover:bg-green-50 dark:text-green-400 dark:hover:bg-green-950/20 gap-1"
                  disabled={approveAllPending}
                  onClick={handleApproveAll}
                >
                  {approveAllPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <CheckCircle2 className="h-3 w-3" />}
                  Approve All ({totalPendingCount})
                </Button>
              )}
            </div>

            {(pendingOverridesLoading || allTimeOffLoading) ? (
              <div className="space-y-2">
                {[1,2].map(i => <div key={i} className="h-20 bg-muted/50 rounded-xl animate-pulse" />)}
              </div>
            ) : totalPendingCount === 0 ? (
              <Card>
                <CardContent className="p-8 text-center">
                  <CheckCircle2 className="h-8 w-8 mx-auto mb-2 text-green-500/60" />
                  <p className="text-sm font-medium text-muted-foreground">All caught up</p>
                  <p className="text-xs text-muted-foreground mt-1">No pending requests to review</p>
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-3">
                {/* Pending availability overrides */}
                {pendingOverrides.map(override => {
                  const isBusy = approvingIds.has(override.id);
                  const empName = userNameMap[override.userId] || [override.firstName, override.lastName].filter(Boolean).join(' ') || override.email || 'Unknown';
                  const changeDesc = override.unavailable
                    ? 'Mark as unavailable'
                    : (override.startTime && override.endTime)
                      ? `Available ${formatTimeShort(override.startTime)} – ${formatTimeShort(override.endTime)}`
                      : 'Availability change';
                  const dateLabel = new Date(override.date + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });

                  return (
                    <Card key={override.id}>
                      <CardContent className="p-4">
                        <div className="flex items-start justify-between gap-2 mb-1">
                          <div>
                            <p className="text-sm font-semibold">{empName}</p>
                            <p className="text-xs text-muted-foreground">Availability change · {dateLabel}</p>
                          </div>
                          <span className="text-xs rounded-full px-2 py-0.5 bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400 shrink-0">
                            Pending
                          </span>
                        </div>
                        <p className="text-xs text-foreground/80 mb-3 font-medium">{changeDesc}</p>
                        <div className="flex gap-2">
                          <Button
                            size="sm"
                            variant="outline"
                            className="flex-1 h-8 text-xs border-green-400 text-green-700 hover:bg-green-50 dark:text-green-400 dark:hover:bg-green-950/20 gap-1"
                            disabled={isBusy}
                            onClick={() => reviewOverrideMutation.mutate({ id: override.id, action: 'approve' })}
                          >
                            {isBusy ? <Loader2 className="h-3 w-3 animate-spin" /> : <CheckCircle2 className="h-3 w-3" />}
                            Approve
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            className="flex-1 h-8 text-xs border-red-400 text-red-700 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/20 gap-1"
                            disabled={isBusy}
                            onClick={() => reviewOverrideMutation.mutate({ id: override.id, action: 'reject' })}
                          >
                            {isBusy ? <Loader2 className="h-3 w-3 animate-spin" /> : <XCircle className="h-3 w-3" />}
                            Deny
                          </Button>
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}

                {/* Pending time-off requests */}
                {pendingTimeOff.map(req => {
                  const toKey = `to-${req.id}`;
                  const isBusy = approvingIds.has(toKey);
                  const empName = userNameMap[req.userId] || req.userId;
                  const typeInfo = timeOffTypes.find(t => t.value === req.type);
                  const typeLabel = typeInfo?.label || req.type;
                  const startLabel = new Date(req.startDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
                  const endLabel = new Date(req.endDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
                  const dateLabel = req.startDate === req.endDate ? startLabel : `${startLabel} – ${endLabel}`;

                  return (
                    <Card key={req.id}>
                      <CardContent className="p-4">
                        <div className="flex items-start justify-between gap-2 mb-1">
                          <div>
                            <p className="text-sm font-semibold">{empName}</p>
                            <p className="text-xs text-muted-foreground">{typeLabel} · {dateLabel}</p>
                          </div>
                          <span className="text-xs rounded-full px-2 py-0.5 bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400 shrink-0">
                            Pending
                          </span>
                        </div>
                        {req.reason && (
                          <p className="text-xs text-muted-foreground italic mb-3">"{req.reason}"</p>
                        )}
                        {!req.reason && <div className="mb-2" />}
                        <div className="flex gap-2">
                          <Button
                            size="sm"
                            variant="outline"
                            className="flex-1 h-8 text-xs border-green-400 text-green-700 hover:bg-green-50 dark:text-green-400 dark:hover:bg-green-950/20 gap-1"
                            disabled={isBusy}
                            onClick={() => reviewTimeOffMutation.mutate({ id: req.id, status: 'approved' })}
                          >
                            {isBusy ? <Loader2 className="h-3 w-3 animate-spin" /> : <CheckCircle2 className="h-3 w-3" />}
                            Approve
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            className="flex-1 h-8 text-xs border-red-400 text-red-700 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/20 gap-1"
                            disabled={isBusy}
                            onClick={() => reviewTimeOffMutation.mutate({ id: req.id, status: 'denied' })}
                          >
                            {isBusy ? <Loader2 className="h-3 w-3 animate-spin" /> : <XCircle className="h-3 w-3" />}
                            Deny
                          </Button>
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── My Availability (default) — shown when viewMode = 'my' OR for non-managers ── */}
      {(!isManagerOrAbove || viewMode === 'my') && (
      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
        <TabsList className="grid w-full grid-cols-2 max-w-sm">
          <TabsTrigger value="availability" className="text-sm flex items-center gap-1.5">
            <CalendarCheck className="h-3.5 w-3.5" />
            Availability
          </TabsTrigger>
          <TabsTrigger value="time-off" className="text-sm relative flex items-center gap-1.5">
            <Umbrella className="h-3.5 w-3.5" />
            Time Off
            {pendingCount > 0 && (
              <span className="absolute -top-1 -right-1 bg-amber-500 text-white text-[10px] rounded-full w-4 h-4 flex items-center justify-center font-bold">
                {pendingCount}
              </span>
            )}
          </TabsTrigger>
        </TabsList>

        {/* ── Availability Tab ──────────────────────────────────────────────── */}
        <TabsContent value="availability" className="space-y-4">
          <Card>
            <CardContent className="p-4">
              {/* Header: month nav + default schedule button */}
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-1">
                  <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() =>
                    setCalViewMonth(new Date(calViewMonth.getFullYear(), calViewMonth.getMonth() - 1))
                  }>
                    <ChevronLeft className="h-4 w-4" />
                  </Button>
                  <span className="text-sm font-semibold min-w-[130px] text-center">
                    {calViewMonth.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
                  </span>
                  <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() =>
                    setCalViewMonth(new Date(calViewMonth.getFullYear(), calViewMonth.getMonth() + 1))
                  }>
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                  <Button variant="ghost" size="sm" className="text-xs ml-1 text-muted-foreground" onClick={() => setCalViewMonth(new Date())}>
                    Today
                  </Button>
                </div>
                <Button variant="ghost" size="sm" className="text-xs gap-1 px-2" onClick={() => setShowDefaultSchedule(true)}>
                  <Repeat className="h-3.5 w-3.5" />
                  Recurring
                </Button>
              </div>

              {/* Auto-fill indicator strip */}
              {weekWasAutoFilled && (
                <div className="flex items-center gap-1.5 mb-2 px-1 py-1 rounded-md bg-violet-50 dark:bg-violet-950/20 border border-violet-200 dark:border-violet-800/40">
                  <Wand2 className="h-3 w-3 text-violet-400 shrink-0" />
                  <span className="text-[11px] text-violet-600 dark:text-violet-400 leading-tight">
                    Auto-filled from your default schedule
                  </span>
                </div>
              )}

              {/* Day-of-week header */}
              <div className="grid grid-cols-7 gap-1 mb-1">
                {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(d => (
                  <div key={d} className="text-center text-[10px] text-muted-foreground font-medium py-0.5">{d}</div>
                ))}
              </div>

              {/* Calendar grid */}
              {calendarLoading ? (
                <div className="flex justify-center py-10">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
              ) : (
                <div className="grid grid-cols-7 gap-1">
                  {getMonthDays(calViewMonth.getFullYear(), calViewMonth.getMonth()).map((day, i) => {
                    if (!day) return <div key={`blank-${i}`} className="h-14" />;
                    const dateStr = formatDateKey(day);
                    const isToday = day.toDateString() === new Date().toDateString();
                    const entry = calByDate[dateStr];
                    const isTimeOff = entry?.source === 'time_off';
                    const isUnavailable = !!(entry?.unavailable) && !isTimeOff;
                    const isAvailable = !!(entry?.available) && !isTimeOff && !isUnavailable;
                    const isDefaultOpen = !entry && !isTimeOff; // no entry = available by default
                    const isTemplateOnly = entry?.source === 'template';
                    const hasOverride = entry?.source === 'override';
                    const hasHours = !isUnavailable && !isTimeOff && entry?.startTime && entry?.endTime;
                    const templateDefault = (hasOverride && entry?.templateDefault) || null;
                    const isOverridingTemplate = hasOverride && !!templateDefault;

                    // Human-readable description of the template default
                    const templateDesc = templateDefault
                      ? templateDefault.available
                        ? templateDefault.startTime && templateDefault.endTime
                          ? `Available ${formatTimeShort(templateDefault.startTime)}–${formatTimeShort(templateDefault.endTime)}`
                          : 'Available'
                        : 'Blocked'
                      : null;

                    // Human-readable description of the override
                    const overrideDesc = hasOverride
                      ? entry!.unavailable
                        ? 'Blocked'
                        : entry!.startTime && entry!.endTime
                          ? `Available ${formatTimeShort(entry!.startTime)}–${formatTimeShort(entry!.endTime)}`
                          : 'Available'
                      : null;

                    return (
                      <div key={dateStr} className="relative group/cal">
                        <button
                          onClick={() => openDayEditor(dateStr)}
                          className={cn(
                            "h-14 w-full rounded-lg flex flex-col items-center justify-start pt-1 px-0.5 relative transition-all active:scale-95 select-none",
                            "focus:outline-none focus:ring-2 focus:ring-primary/50",
                            isTimeOff && "bg-gray-100 dark:bg-gray-800/50 cursor-default",
                            isUnavailable && "bg-red-50 dark:bg-red-950/20",
                            isAvailable && isTemplateOnly && "bg-emerald-50/60 dark:bg-emerald-950/20 border border-dashed border-emerald-300 dark:border-emerald-700",
                            isAvailable && hasOverride && "bg-emerald-100 dark:bg-emerald-900/30",
                            isDefaultOpen && "bg-emerald-50/40 dark:bg-emerald-950/10 hover:bg-emerald-50/80 dark:hover:bg-emerald-950/20",
                            isToday && "ring-2 ring-primary"
                          )}
                        >
                          {/* Day number */}
                          <span className={cn(
                            "text-xs font-semibold leading-none",
                            isToday && "text-primary",
                            isTimeOff && "text-gray-500 dark:text-gray-400",
                            isUnavailable && "text-red-500 dark:text-red-400",
                            (isAvailable || isDefaultOpen) && !isToday && "text-emerald-700 dark:text-emerald-300"
                          )}>
                            {day.getDate()}
                          </span>

                          {/* Status indicator */}
                          {isTimeOff && (
                            <div className="mt-0.5 flex flex-col items-center">
                              <Umbrella className="h-3 w-3 text-gray-400" />
                              <span className="text-[9px] text-gray-400 leading-none mt-0.5 truncate max-w-[36px]">{entry?.timeOff?.type || 'Off'}</span>
                            </div>
                          )}
                          {isUnavailable && (
                            <div className="mt-0.5">
                              <Ban className="h-3 w-3 text-red-400" />
                            </div>
                          )}
                          {hasHours && (
                            <div className="mt-0.5 text-[9px] text-emerald-600 dark:text-emerald-400 leading-none text-center px-0.5 truncate max-w-[48px]">
                              {`${formatTimeShort(entry!.startTime!)}–${formatTimeShort(entry!.endTime!)}`}
                            </div>
                          )}
                          {isDefaultOpen && !isToday && (
                            <div className="mt-0.5">
                              <Check className="h-2.5 w-2.5 text-emerald-400/60" />
                            </div>
                          )}
                          {isTemplateOnly && (isAvailable || isUnavailable) && (
                            <Repeat className="absolute bottom-0.5 right-0.5 h-2 w-2 text-emerald-400 opacity-60" />
                          )}

                          {/* Custom override indicator dot */}
                          {isOverridingTemplate && (
                            <span className="absolute top-0.5 right-0.5 flex items-center justify-center">
                              <Sparkles className="h-2.5 w-2.5 text-amber-400" />
                            </span>
                          )}
                        </button>

                        {/* Hover tooltip for override-over-template days */}
                        {isOverridingTemplate && (
                          <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 z-50 invisible group-hover/cal:visible opacity-0 group-hover/cal:opacity-100 transition-opacity duration-150 pointer-events-none w-44">
                            <div className="bg-popover text-popover-foreground rounded-md border shadow-md p-2 text-[10px]">
                              <div className="flex items-center gap-1 text-amber-500 font-semibold mb-1.5">
                                <Sparkles className="h-2.5 w-2.5" />
                                <span>Custom override</span>
                              </div>
                              <div className="space-y-1">
                                <div className="flex items-start gap-1.5">
                                  <Repeat className="h-2.5 w-2.5 text-muted-foreground mt-0.5 shrink-0" />
                                  <div>
                                    <span className="text-muted-foreground">Template: </span>
                                    <span className="font-medium">{templateDesc}</span>
                                  </div>
                                </div>
                                <div className="flex items-start gap-1.5">
                                  <Sparkles className="h-2.5 w-2.5 text-amber-400 mt-0.5 shrink-0" />
                                  <div>
                                    <span className="text-muted-foreground">This day: </span>
                                    <span className="font-medium">{overrideDesc}</span>
                                  </div>
                                </div>
                              </div>
                            </div>
                            {/* Arrow */}
                            <div className="flex justify-center">
                              <div className="w-2 h-2 bg-popover border-r border-b rotate-45 -mt-1 border-border" />
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Legend */}
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-3 text-[10px] text-muted-foreground">
                <div className="flex items-center gap-1"><div className="w-3 h-3 rounded bg-emerald-50/80 dark:bg-emerald-950/20 border border-emerald-200/50" />Open (default)</div>
                <div className="flex items-center gap-1"><div className="w-3 h-3 rounded bg-emerald-100 dark:bg-emerald-900/30" />Hours set</div>
                <div className="flex items-center gap-1"><div className="w-3 h-3 rounded bg-red-50 dark:bg-red-950/20" />Blocked</div>
                <div className="flex items-center gap-1"><div className="w-3 h-3 rounded bg-gray-100 dark:bg-gray-800/50" />Time off</div>
                <div className="flex items-center gap-1"><Sparkles className="h-2.5 w-2.5 text-amber-400" />Custom override</div>
              </div>

              <p className="text-[11px] text-muted-foreground mt-2 text-center">
                Tap a day to block it or set specific hours
              </p>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Day Editor (Sheet on mobile, Dialog on desktop) ──────────────── */}
        {editorDay && (() => {
          const editorDateObj = new Date(editorDay + 'T12:00:00Z');
          const dow = editorDateObj.getUTCDay();
          const entry = calByDate[editorDay];
          const hasExistingOverride = entry?.source === 'override';
          const isSaving = saveDayOverrideMutation.isPending || saveTemplateDayMutation.isPending;
          const isClearing = clearDayOverrideMutation.isPending;

          // Derive editor mode name for UX labeling
          const isCurrentlyBlocked = entry?.unavailable === true;
          const isCurrentlyHours = !!(entry?.available && entry?.startTime && entry?.endTime && !entry?.unavailable);
          const isCurrentlyDefault = !isCurrentlyBlocked && !isCurrentlyHours; // covers no-entry + available-no-hours

          const editorBody = (
            <div className="space-y-5">
              {/* Current status banner */}
              <div className={cn(
                "rounded-lg p-3 flex items-center gap-2.5",
                isCurrentlyBlocked && "bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-800",
                isCurrentlyHours && "bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-200 dark:border-emerald-800",
                (isCurrentlyDefault) && "bg-emerald-50/50 dark:bg-emerald-950/10 border border-emerald-200/50 dark:border-emerald-800/30"
              )}>
                {isCurrentlyBlocked && <Ban className="h-4 w-4 text-red-500 shrink-0" />}
                {isCurrentlyHours && <Clock className="h-4 w-4 text-emerald-600 shrink-0" />}
                {isCurrentlyDefault && <Check className="h-4 w-4 text-emerald-500 shrink-0" />}
                <div>
                  {isCurrentlyBlocked && (
                    <>
                      <p className="text-sm font-medium text-red-700 dark:text-red-300">Blocked</p>
                      <p className="text-xs text-red-500 dark:text-red-400">You're marked as unavailable this day</p>
                    </>
                  )}
                  {isCurrentlyHours && (
                    <>
                      <p className="text-sm font-medium text-emerald-700 dark:text-emerald-300">
                        Available {formatTimeShort(entry!.startTime!)}–{formatTimeShort(entry!.endTime!)}
                      </p>
                      <p className="text-xs text-emerald-600 dark:text-emerald-400">Specific hours set for this day</p>
                    </>
                  )}
                  {isCurrentlyDefault && (
                    <>
                      <p className="text-sm font-medium text-emerald-700 dark:text-emerald-300">Open all day</p>
                      <p className="text-xs text-emerald-600/70 dark:text-emerald-400/70">Available by default — no restrictions set</p>
                    </>
                  )}
                </div>
              </div>

              {/* Mode selection */}
              <div>
                <p className="text-xs font-medium text-muted-foreground mb-2 uppercase tracking-wide">Change to</p>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={() => setEditorUnavailable(true)}
                    className={cn(
                      "rounded-xl border-2 px-3 py-3 text-center transition-all",
                      editorUnavailable
                        ? "border-red-400 bg-red-50 dark:bg-red-950/20"
                        : "border-border hover:border-red-200 hover:bg-red-50/30"
                    )}
                  >
                    <Ban className={cn("h-5 w-5 mx-auto mb-1", editorUnavailable ? "text-red-500" : "text-muted-foreground/50")} />
                    <p className="text-xs font-semibold">Block all day</p>
                    <p className="text-[10px] text-muted-foreground mt-0.5">Mark unavailable</p>
                  </button>
                  <button
                    onClick={() => setEditorUnavailable(false)}
                    className={cn(
                      "rounded-xl border-2 px-3 py-3 text-center transition-all",
                      !editorUnavailable
                        ? "border-primary bg-primary/5"
                        : "border-border hover:border-primary/30 hover:bg-primary/5"
                    )}
                  >
                    <Clock className={cn("h-5 w-5 mx-auto mb-1", !editorUnavailable ? "text-primary" : "text-muted-foreground/50")} />
                    <p className="text-xs font-semibold">Set hours</p>
                    <p className="text-[10px] text-muted-foreground mt-0.5">Specific window</p>
                  </button>
                </div>
              </div>

              {/* Time pickers — only when setting hours mode */}
              {!editorUnavailable && (
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label className="text-xs text-muted-foreground mb-1 block">Available from</Label>
                      <Input type="time" step={1800} value={editorStartTime} onChange={e => setEditorStartTime(e.target.value)} className="text-sm" />
                    </div>
                    <div>
                      <Label className="text-xs text-muted-foreground mb-1 block">Until</Label>
                      <Input type="time" step={1800} value={editorEndTime} onChange={e => setEditorEndTime(e.target.value)} className="text-sm" />
                    </div>
                  </div>
                  <div className="flex gap-2 flex-wrap">
                    {[
                      { label: '9–5', start: '09:00', end: '17:00' },
                      { label: '10–6', start: '10:00', end: '18:00' },
                      { label: '8–4', start: '08:00', end: '16:00' },
                      { label: '12–8', start: '12:00', end: '20:00' },
                    ].map(p => (
                      <Button key={p.label} variant="outline" size="sm" className="text-xs h-7"
                        onClick={() => { setEditorStartTime(p.start); setEditorEndTime(p.end); }}>
                        {p.label}
                      </Button>
                    ))}
                  </div>
                </div>
              )}

              {/* Scope selector */}
              <div>
                <p className="text-xs font-medium text-muted-foreground mb-2 uppercase tracking-wide">Apply to</p>
                <div className="grid grid-cols-2 gap-2">
                  <button onClick={() => setEditorScope('override')}
                    className={cn(
                      "rounded-lg border px-3 py-2 text-left transition-all",
                      editorScope === 'override' ? "border-primary bg-primary/5 ring-1 ring-primary" : "border-border hover:border-muted-foreground"
                    )}>
                    <p className="text-sm font-medium">{editorDateObj.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} only</p>
                    <p className="text-xs text-muted-foreground">Just this one day</p>
                  </button>
                  <button onClick={() => setEditorScope('template')}
                    className={cn(
                      "rounded-lg border px-3 py-2 text-left transition-all",
                      editorScope === 'template' ? "border-primary bg-primary/5 ring-1 ring-primary" : "border-border hover:border-muted-foreground"
                    )}>
                    <p className="text-sm font-medium">Every {DAY_FULL[dow]}</p>
                    <p className="text-xs text-muted-foreground">Recurring weekly</p>
                  </button>
                </div>
              </div>

              {/* Actions */}
              <div className="flex flex-col gap-2">
                <Button className="w-full gap-2" onClick={handleSaveDay} disabled={isSaving}>
                  {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                  {isSaving ? 'Saving…' : 'Save changes'}
                </Button>
                {hasExistingOverride && (
                  <Button variant="ghost" size="sm" className="text-xs text-muted-foreground gap-1"
                    onClick={() => clearDayOverrideMutation.mutate(editorDay!)} disabled={isClearing}>
                    {isClearing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCcw className="h-3.5 w-3.5" />}
                    {isClearing ? 'Clearing…' : 'Remove override (revert to default)'}
                  </Button>
                )}
                <Button variant="ghost" size="sm" className="text-xs text-muted-foreground" onClick={() => setEditorDay(null)}>
                  Cancel
                </Button>
              </div>
            </div>
          );

          const editorTitle = `${DAY_FULL[dow]}, ${editorDateObj.toLocaleDateString('en-US', { month: 'long', day: 'numeric' })}`;

          if (isDesktop) {
            return (
              <Dialog open={true} onOpenChange={(open) => { if (!open) setEditorDay(null); }}>
                <DialogContent className="sm:max-w-md">
                  <DialogHeader>
                    <DialogTitle>{editorTitle}</DialogTitle>
                  </DialogHeader>
                  {editorBody}
                </DialogContent>
              </Dialog>
            );
          }
          return (
            <Sheet open={true} onOpenChange={(open) => { if (!open) setEditorDay(null); }}>
              <SheetContent side="bottom" className="rounded-t-2xl pb-8 max-h-[85vh] overflow-y-auto px-4 pt-4">
                <SheetHeader className="mb-4">
                  <SheetTitle className="text-lg">{editorTitle}</SheetTitle>
                </SheetHeader>
                {editorBody}
              </SheetContent>
            </Sheet>
          );
        })()}

        {/* ── Team Availability Editor (manager editing another employee) ──── */}
        {teamEditorTarget && (() => {
          const { dateStr: tDate, empName: tName } = teamEditorTarget;
          const tDateObj = new Date(tDate + 'T12:00:00Z');
          const tDow = tDateObj.getUTCDay();
          const tDateLabel = `${DAY_FULL[tDow]}, ${tDateObj.toLocaleDateString('en-US', { month: 'long', day: 'numeric' })}`;
          const tDayInfo = teamEditorDayData?.[0] ?? null;
          const tIsTimeOff = tDayInfo?.source === 'time_off';
          const tHasOverride = tDayInfo?.source === 'override';
          const tIsSaving = teamEditorSaveMutation.isPending;
          const tIsClearing = teamEditorClearMutation.isPending;

          const sourceLabel = tDayInfo?.source === 'override'
            ? 'Override active'
            : tDayInfo?.source === 'time_off'
            ? 'Time-off approved'
            : tDayInfo?.source === 'template'
            ? 'From default schedule'
            : 'Available by default';

          const editorBody = (
            <div className="space-y-5">
              {/* Employee + date */}
              <div className="flex items-center gap-2">
                <User className="h-4 w-4 text-muted-foreground shrink-0" />
                <div>
                  <p className="text-sm font-semibold">{tName}</p>
                  <p className="text-xs text-muted-foreground">{tDateLabel}</p>
                </div>
              </div>

              {/* Current status */}
              {!teamEditorDayData ? (
                <div className="h-8 bg-muted/50 rounded-lg animate-pulse" />
              ) : (
                <div className={cn(
                  "text-xs px-2.5 py-1.5 rounded-md border",
                  tHasOverride && "bg-amber-50 border-amber-200 text-amber-700 dark:bg-amber-900/20 dark:border-amber-800 dark:text-amber-300",
                  tIsTimeOff && "bg-sky-50 border-sky-200 text-sky-700 dark:bg-sky-900/20 dark:border-sky-800 dark:text-sky-300",
                  !tHasOverride && !tIsTimeOff && tDayInfo?.available && "bg-emerald-50 border-emerald-200 text-emerald-700 dark:bg-emerald-900/20 dark:border-emerald-800 dark:text-emerald-300",
                  !tHasOverride && !tIsTimeOff && !tDayInfo?.available && "bg-muted border-border text-muted-foreground",
                )}>
                  <span className="font-medium">{sourceLabel}</span>
                  {tDayInfo?.available && tDayInfo.startTime && tDayInfo.endTime && (
                    <span className="ml-1">· {formatTimeShort(tDayInfo.startTime)}–{formatTimeShort(tDayInfo.endTime)}</span>
                  )}
                  {tIsTimeOff && tDayInfo?.timeOff && (
                    <span className="ml-1 capitalize">· {tDayInfo.timeOff.type}</span>
                  )}
                </div>
              )}

              {tIsTimeOff ? (
                <p className="text-xs text-muted-foreground">
                  This day has an approved time-off request. To change availability, the time-off request must be cancelled first.
                </p>
              ) : (
                <>
                  {/* Mode selection */}
                  <div>
                    <p className="text-xs font-medium text-muted-foreground mb-2 uppercase tracking-wide">Set availability</p>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => setTeamEditorMode('available')}
                        className={cn(
                          "flex-1 text-xs px-3 py-2 rounded-md border transition-colors",
                          teamEditorMode === 'available'
                            ? "bg-emerald-100 border-emerald-400 text-emerald-800 dark:bg-emerald-900/40 dark:border-emerald-600 dark:text-emerald-200"
                            : "bg-background border-border text-foreground hover:bg-muted"
                        )}
                      >
                        <Check className="h-3.5 w-3.5 mx-auto mb-0.5" />
                        Available
                      </button>
                      <button
                        type="button"
                        onClick={() => setTeamEditorMode('unavailable')}
                        className={cn(
                          "flex-1 text-xs px-3 py-2 rounded-md border transition-colors",
                          teamEditorMode === 'unavailable'
                            ? "bg-red-100 border-red-400 text-red-800 dark:bg-red-900/40 dark:border-red-600 dark:text-red-200"
                            : "bg-background border-border text-foreground hover:bg-muted"
                        )}
                      >
                        <Ban className="h-3.5 w-3.5 mx-auto mb-0.5" />
                        Unavailable
                      </button>
                    </div>
                  </div>

                  {/* Time pickers */}
                  {teamEditorMode === 'available' && (
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <Label className="text-xs text-muted-foreground mb-1 block">Available from</Label>
                        <Input type="time" step={1800} value={teamEditorStart} onChange={e => setTeamEditorStart(e.target.value)} className="text-sm" />
                      </div>
                      <div>
                        <Label className="text-xs text-muted-foreground mb-1 block">Until</Label>
                        <Input type="time" step={1800} value={teamEditorEnd} onChange={e => setTeamEditorEnd(e.target.value)} className="text-sm" />
                      </div>
                    </div>
                  )}

                  {/* Actions */}
                  <div className="flex flex-col gap-2">
                    <Button className="w-full gap-2" onClick={() => teamEditorSaveMutation.mutate()} disabled={tIsSaving || tIsClearing}>
                      {tIsSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                      {tIsSaving ? 'Saving…' : 'Save'}
                    </Button>
                    {tHasOverride && (
                      <Button variant="outline" size="sm" className="text-xs gap-1" onClick={() => teamEditorClearMutation.mutate()} disabled={tIsSaving || tIsClearing}>
                        {tIsClearing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCcw className="h-3.5 w-3.5" />}
                        {tIsClearing ? 'Clearing…' : 'Revert to default schedule'}
                      </Button>
                    )}
                    <Button variant="ghost" size="sm" className="text-xs text-muted-foreground" onClick={() => setTeamEditorTarget(null)}>
                      Cancel
                    </Button>
                  </div>
                </>
              )}
            </div>
          );

          if (isDesktop) {
            return (
              <Dialog open={true} onOpenChange={(open) => { if (!open) setTeamEditorTarget(null); }}>
                <DialogContent className="sm:max-w-sm">
                  <DialogHeader>
                    <DialogTitle className="text-base flex items-center gap-2">
                      <Users className="h-4 w-4" />
                      Edit Availability
                    </DialogTitle>
                  </DialogHeader>
                  {editorBody}
                </DialogContent>
              </Dialog>
            );
          }
          return (
            <Sheet open={true} onOpenChange={(open) => { if (!open) setTeamEditorTarget(null); }}>
              <SheetContent side="bottom" className="rounded-t-2xl pb-8 max-h-[85vh] overflow-y-auto px-4 pt-4">
                <SheetHeader className="mb-4">
                  <SheetTitle className="text-base flex items-center gap-2">
                    <Users className="h-4 w-4" />
                    Edit Availability
                  </SheetTitle>
                </SheetHeader>
                {editorBody}
              </SheetContent>
            </Sheet>
          );
        })()}

        <Sheet open={showDefaultSchedule} onOpenChange={setShowDefaultSchedule}>
          <SheetContent side="bottom" className="max-h-[92vh] overflow-y-auto rounded-t-2xl px-4 pt-4 pb-8">
            <SheetHeader className="mb-4">
              <SheetTitle className="text-base flex items-center gap-2">
                <Repeat className="h-4 w-4 text-primary" />
                Recurring Availability
              </SheetTitle>
              <p className="text-xs text-muted-foreground">
                Set your typical weekly pattern. Days marked unavailable will repeat every week. You can always override specific dates on the calendar.
              </p>
            </SheetHeader>
            <div className="space-y-4">
              {/* Quick presets + default time range */}
              <div className="space-y-2 mb-4">
                <div className="flex gap-2 flex-wrap">
                  {(
                    [
                      { key: 'weekdays', label: 'Weekdays' },
                      { key: 'weekends', label: 'Weekends' },
                      { key: 'all', label: 'All Week' },
                      { key: 'clear', label: 'Clear' },
                    ] as { key: 'weekdays' | 'weekends' | 'all' | 'clear'; label: string }[]
                  ).map(({ key, label }) => (
                    <Button key={key} variant="outline" size="sm" className="text-xs" onClick={() => applyTemplatePreset(key)}>
                      {label}
                    </Button>
                  ))}
                </div>
                {/* Default time for presets */}
                <div className="flex items-center gap-2 text-xs text-muted-foreground flex-wrap">
                  <span className="shrink-0">Preset time:</span>
                  <Select value={presetStart} onValueChange={setPresetStart}>
                    <SelectTrigger className="h-7 text-xs w-32">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="max-h-48">
                      {TIME_OPTIONS.map(o => (
                        <SelectItem key={o.value} value={o.value} className="text-xs">{o.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <span>to</span>
                  <Select value={presetEnd} onValueChange={setPresetEnd}>
                    <SelectTrigger className="h-7 text-xs w-32">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="max-h-48">
                      {TIME_OPTIONS.map(o => (
                        <SelectItem key={o.value} value={o.value} className="text-xs">{o.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {/* Day rows */}
              <div className="space-y-1">
                {DAY_NAMES.map((name, dow) => {
                  const key = String(dow);
                  const slot = templateSlots[key];
                  return (
                    <div
                      key={dow}
                      className={cn(
                        "flex items-center gap-2 py-2.5 px-1 rounded-lg transition-colors",
                        !slot.available && "opacity-60"
                      )}
                    >
                      {/* Day name */}
                      <span className="text-sm font-medium w-9 shrink-0">{name}</span>

                      {/* Available/Unavailable toggle */}
                      <button
                        onClick={() => toggleTemplateDay(key)}
                        className={cn(
                          "shrink-0 rounded-full px-2.5 py-1 text-xs font-medium transition-all border",
                          slot.available
                            ? "bg-primary text-primary-foreground border-primary"
                            : "bg-muted text-muted-foreground border-border"
                        )}
                      >
                        {slot.available ? "Available" : "Unavailable"}
                      </button>

                      {/* Time pickers — shown only when available */}
                      {slot.available && (
                        <div className="flex items-center gap-1.5 flex-1 min-w-0">
                          <Select value={slot.startTime} onValueChange={v => updateTemplateTime(key, 'startTime', v)}>
                            <SelectTrigger className="h-7 text-xs flex-1 min-w-[90px]">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent className="max-h-48">
                              {TIME_OPTIONS.filter(o => o.value !== '00:00').map(o => (
                                <SelectItem key={o.value} value={o.value} className="text-xs">{o.label}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <span className="text-xs text-muted-foreground shrink-0">–</span>
                          <Select value={slot.endTime} onValueChange={v => updateTemplateTime(key, 'endTime', v)}>
                            <SelectTrigger className="h-7 text-xs flex-1 min-w-[90px]">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent className="max-h-48">
                              {TIME_OPTIONS.map(o => (
                                <SelectItem key={o.value} value={o.value} className="text-xs">{o.label}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Auto-apply toggle */}
              <div className="flex items-center justify-between rounded-lg border px-3 py-2.5 mt-4">
                <div className="space-y-0.5">
                  <Label htmlFor="auto-apply-toggle" className="text-sm font-medium cursor-pointer">
                    Auto-fill new weeks
                  </Label>
                  <p className="text-xs text-muted-foreground">
                    Automatically apply this schedule to empty future weeks.
                  </p>
                </div>
                <Switch
                  id="auto-apply-toggle"
                  checked={autoApplyTemplate}
                  disabled={saveAutoApplyMutation.isPending}
                  onCheckedChange={(checked) => {
                    setAutoApplyTemplate(checked);
                    saveAutoApplyMutation.mutate(checked);
                  }}
                />
              </div>

              <div className="mt-3 space-y-2">
                <Button
                  onClick={handleSaveTemplate}
                  disabled={saveTemplateMutation.isPending || !templateHasChanges}
                  className="w-full gap-2"
                >
                  {saveTemplateMutation.isPending ? (
                    <><Loader2 className="h-4 w-4 animate-spin" />Saving…</>
                  ) : (
                    <><Save className="h-4 w-4" />Save Default Schedule</>
                  )}
                </Button>
                {availabilityTemplate?.slots && !templateHasChanges && (
                  <p className="text-center text-[11px] text-muted-foreground">
                    {availabilityTemplate.autoApplyTemplate
                      ? "Saved — new empty weeks will be auto-filled."
                      : "Saved — enable auto-fill above to apply automatically."}
                  </p>
                )}
                {!availabilityTemplate?.slots && !templateHasChanges && (
                  <p className="text-center text-[11px] text-muted-foreground">
                    No default schedule yet. Set your usual hours above and save.
                  </p>
                )}
              </div>
            </div>
          </SheetContent>
        </Sheet>

        {/* ── Time Off Tab ──────────────────────────────────────────────────── */}
        <TabsContent value="time-off" className="space-y-4">
          <Button className="w-full gap-2" onClick={() => setShowTimeOffForm(true)}>
            <Plus className="h-4 w-4" />
            Request Time Off
          </Button>

          {myRequests.length === 0 ? (
            <Card>
              <CardContent className="p-8 text-center">
                <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-muted flex items-center justify-center">
                  <Umbrella className="h-7 w-7 text-muted-foreground" />
                </div>
                <p className="font-medium mb-1">No time-off requests</p>
                <p className="text-sm text-muted-foreground">
                  Submit a request for vacation, sick leave, or personal time.
                </p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-3">
              {myRequests.map((req: TimeOffRequest) => {
                const typeInfo = timeOffTypes.find(t => t.value === req.type);
                const TypeIcon = typeInfo?.Icon || CalendarCheck;
                return (
                  <Card key={req.id}>
                    <CardContent className="p-4">
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                          <TypeIcon className="h-4 w-4 text-muted-foreground" />
                          <span className="text-sm font-medium">{typeInfo?.label || req.type}</span>
                        </div>
                        <Badge className={cn("text-xs", statusColors[req.status] || statusColors.pending)}>
                          {req.status.charAt(0).toUpperCase() + req.status.slice(1)}
                        </Badge>
                      </div>
                      <div className="text-sm text-muted-foreground mb-2">
                        {new Date(req.startDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                        {req.startDate !== req.endDate && (
                          <> – {new Date(req.endDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</>
                        )}
                      </div>
                      {req.reason && (
                        <p className="text-xs text-muted-foreground mb-2 italic">"{req.reason}"</p>
                      )}
                      {req.adminNotes && (
                        <p className="text-xs text-muted-foreground bg-muted/50 p-2 rounded mb-2 flex items-start gap-1.5">
                          <MessageSquare className="h-3 w-3 mt-0.5 shrink-0" />
                          Manager: {req.adminNotes}
                        </p>
                      )}
                      <div className="text-[10px] text-muted-foreground">
                        Submitted {new Date(req.createdAt!).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                      </div>
                      {req.status === 'pending' && (
                        <Button
                          variant="ghost" size="sm"
                          className="mt-2 text-xs text-destructive hover:text-destructive gap-1"
                          onClick={() => cancelTimeOffMutation.mutate(req.id)}
                          disabled={cancelTimeOffMutation.isPending}
                        >
                          <X className="h-3 w-3" />
                          Cancel Request
                        </Button>
                      )}
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </TabsContent>
      </Tabs>
      )}

      {/* Time-Off Request Dialog */}
      <Dialog open={showTimeOffForm} onOpenChange={setShowTimeOffForm}>
        <DialogContent className="max-w-sm mx-auto">
          <DialogHeader>
            <DialogTitle className="text-base flex items-center gap-2">
              <Umbrella className="h-4 w-4 text-primary" />
              Request Time Off
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label className="text-sm">Type</Label>
              <Select value={timeOffType} onValueChange={setTimeOffType}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {timeOffTypes.map(t => (
                    <SelectItem key={t.value} value={t.value}>
                      <span className="flex items-center gap-2">
                        <t.Icon className="h-3.5 w-3.5" />
                        {t.label}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-sm">Start Date</Label>
                <Input
                  type="date"
                  value={timeOffStartDate}
                  onChange={e => {
                    setTimeOffStartDate(e.target.value);
                    if (!timeOffEndDate || e.target.value > timeOffEndDate) {
                      setTimeOffEndDate(e.target.value);
                    }
                  }}
                  min={new Date().toISOString().split('T')[0]}
                />
              </div>
              <div>
                <Label className="text-sm">End Date</Label>
                <Input
                  type="date"
                  value={timeOffEndDate}
                  onChange={e => setTimeOffEndDate(e.target.value)}
                  min={timeOffStartDate || new Date().toISOString().split('T')[0]}
                />
              </div>
            </div>
            <div>
              <Label className="text-sm">Reason (optional)</Label>
              <Textarea
                value={timeOffReason}
                onChange={e => setTimeOffReason(e.target.value)}
                placeholder="Any notes for your manager..."
                className="text-sm min-h-[80px] resize-none"
              />
            </div>
            <div className="flex gap-2">
              <Button variant="outline" className="flex-1" onClick={() => setShowTimeOffForm(false)}>
                Cancel
              </Button>
              <Button
                className="flex-1 gap-2"
                onClick={handleSubmitTimeOff}
                disabled={createTimeOffMutation.isPending}
              >
                {createTimeOffMutation.isPending ? (
                  <><Loader2 className="h-4 w-4 animate-spin" />Submitting…</>
                ) : (
                  <>Submit Request</>
                )}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
