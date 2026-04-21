import { useState, useEffect, useMemo, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
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
  MoreHorizontal, MessageSquare, CalendarCheck, Save, Loader2, CalendarDays, Wand2
} from "lucide-react";
import type { UserAvailability, TimeOffRequest, AvailabilityTemplate } from "@shared/schema";

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

// Map a DayTemplate to morning/afternoon/evening slots for userAvailability
function slotsFromDayTemplate(slot: DayTemplate): { morning: boolean; afternoon: boolean; evening: boolean; all_day: boolean } {
  if (!slot.available) return { morning: false, afternoon: false, evening: false, all_day: false };
  const startH = parseInt(slot.startTime.split(':')[0]);
  const endH = parseInt(slot.endTime.split(':')[0]);
  const endM = parseInt(slot.endTime.split(':')[1]);
  const morning = startH < 12;
  const afternoon = startH < 18 && (endH > 12 || (endH === 12 && endM > 0));
  const evening = endH > 18 || endH === 0; // 0 = midnight
  return { morning, afternoon, evening, all_day: morning && afternoon && evening };
}

// Parse raw template slot (either new or legacy format) into a DayTemplate
function parseDayTemplate(raw: any): DayTemplate {
  if (!raw) return { available: false, startTime: DEFAULT_START, endTime: DEFAULT_END };
  if ('available' in raw) {
    return {
      available: !!raw.available,
      startTime: raw.startTime || DEFAULT_START,
      endTime: raw.endTime || DEFAULT_END,
    };
  }
  // Legacy format: {morning, afternoon, evening}
  const anyOn = !!(raw.morning || raw.afternoon || raw.evening);
  return { available: anyOn, startTime: DEFAULT_START, endTime: DEFAULT_END };
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
export default function Availability() {
  const { user } = useAuth();
  const { toast } = useToast();

  // Tabs
  const [activeTab, setActiveTab] = useState("availability");

  // Weekly view state
  const [selectedWeek, setSelectedWeek] = useState(new Date());
  const [calendarMonth, setCalendarMonth] = useState(new Date());
  const [availabilityData, setAvailabilityData] = useState<Record<string, Record<TimeSlot, boolean>>>({});
  const [hasChanges, setHasChanges] = useState(false);
  // showAutoFilledPill: controls the dismissible info pill; dismissed independently of labels
  const [showAutoFilledPill, setShowAutoFilledPill] = useState(false);
  // weekWasAutoFilled: true for the entire session on this week (not cleared on pill dismiss)
  const [weekWasAutoFilled, setWeekWasAutoFilled] = useState(false);
  // Per-day time ranges stored from template; shown regardless of pill visibility
  const [autoFilledTimeRanges, setAutoFilledTimeRanges] = useState<Record<string, { startTime: string; endTime: string } | null>>({});
  // Session-level guard: track which week-start dates have been auto-filled this session
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
  // Preset time range for quick-fill buttons
  const [presetStart, setPresetStart] = useState(DEFAULT_START);
  const [presetEnd, setPresetEnd] = useState(DEFAULT_END);

  // ── Derived values ──────────────────────────────────────────────────────────
  const weekDates = useMemo(() => getWeekDates(selectedWeek), [selectedWeek]);
  const startParam = formatDateKey(weekDates[0]);
  const endParam = formatDateKey(weekDates[6]);

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
  useEffect(() => {
    if (!availabilityTemplate?.slots) return;
    const rawSlots = availabilityTemplate.slots as Record<string, any>;
    const newSlots = emptyWeekTemplateSlots();
    for (let i = 0; i < 7; i++) {
      newSlots[String(i)] = parseDayTemplate(rawSlots[String(i)]);
    }
    setTemplateSlots(newSlots);
    setTemplateHasChanges(false);
  }, [availabilityTemplate]);

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

    // Session-level guard: each week start is auto-filled at most once per session,
    // preventing re-application after the user navigates away and back to the same week
    if (autoFilledWeeksRef.current.has(startParam)) return;
    autoFilledWeeksRef.current.add(startParam);

    const rawSlots = availabilityTemplate.slots as Record<string, any>;
    const newData: Record<string, Record<TimeSlot, boolean>> = {};
    const timeRanges: Record<string, { startTime: string; endTime: string } | null> = {};

    weekDates.forEach(date => {
      const dow = date.getDay().toString();
      const dateKey = formatDateKey(date);
      const raw = rawSlots[dow];
      const tpl = parseDayTemplate(raw);
      const slots = slotsFromDayTemplate(tpl);
      newData[dateKey] = slots;

      // Store time range for display if it's the new format and available
      if (raw && 'available' in raw && raw.available && raw.startTime && raw.endTime) {
        timeRanges[dateKey] = { startTime: raw.startTime, endTime: raw.endTime };
      } else {
        timeRanges[dateKey] = null;
      }
    });

    setAvailabilityData(prev => ({ ...prev, ...newData }));
    setAutoFilledTimeRanges(timeRanges);
    setHasChanges(true);
    setWeekWasAutoFilled(true);
    setShowAutoFilledPill(true);
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
    mutationFn: async (slots: Record<string, { available: boolean; startTime?: string; endTime?: string }>) => {
      await apiRequest('POST', '/api/availability/template', { slots });
    },
    onSuccess: () => {
      toast({ title: "Default schedule saved", description: "Your default week will auto-fill empty weeks." });
      queryClient.invalidateQueries({ queryKey: ['/api/availability/template'] });
      setTemplateHasChanges(false);
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to save default schedule.", variant: "destructive" });
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
    saveTemplateMutation.mutate(slots);
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

  // ── Computed summary helpers ─────────────────────────────────────────────────
  const getDayAvailabilitySummary = (date: Date): 'full' | 'partial' | 'none' => {
    const dateKey = formatDateKey(date);
    const slots = availabilityData[dateKey];
    if (!slots) return 'none';
    const count = [slots.morning, slots.afternoon, slots.evening].filter(Boolean).length;
    return count === 3 ? 'full' : count > 0 ? 'partial' : 'none';
  };

  const monthDays = useMemo(
    () => getMonthDays(calendarMonth.getFullYear(), calendarMonth.getMonth()),
    [calendarMonth]
  );

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
      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
        <TabsList className="grid w-full grid-cols-3 max-w-md">
          <TabsTrigger value="availability" className="text-sm flex items-center gap-1.5">
            <CalendarCheck className="h-3.5 w-3.5" />
            Availability
          </TabsTrigger>
          <TabsTrigger value="default" className="text-sm flex items-center gap-1.5">
            <CalendarDays className="h-3.5 w-3.5" />
            Default Week
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
              {/* Week navigation */}
              <div className="flex items-center justify-between mb-3">
                <Button variant="ghost" size="icon" onClick={() => {
                  const d = new Date(selectedWeek); d.setDate(d.getDate() - 7); setSelectedWeek(d);
                }}>
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <div className="text-center">
                  <h3 className="font-semibold text-sm">
                    {weekDates[0].toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                    {' – '}
                    {weekDates[6].toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                  </h3>
                </div>
                <Button variant="ghost" size="icon" onClick={() => {
                  const d = new Date(selectedWeek); d.setDate(d.getDate() + 7); setSelectedWeek(d);
                }}>
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>

              {/* Auto-filled pill — dismissible; hides pill but keeps time-range labels */}
              {showAutoFilledPill && (
                <div className="flex items-center gap-2 mb-3 px-3 py-2 rounded-lg bg-primary/5 border border-primary/20">
                  <Wand2 className="h-3.5 w-3.5 text-primary shrink-0" />
                  <span className="text-xs text-muted-foreground flex-1">
                    Auto-filled from your default schedule — edit or save below.
                  </span>
                  <button
                    onClick={() => setShowAutoFilledPill(false)}
                    className="text-muted-foreground hover:text-foreground transition-colors"
                    aria-label="Dismiss"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              )}

              {/* Quick presets */}
              <div className="flex gap-2 mb-4 flex-wrap">
                {(
                  [
                    { key: 'weekdays', label: 'Weekdays' },
                    { key: 'weekends', label: 'Weekends' },
                    { key: 'all', label: 'All' },
                    { key: 'clear', label: 'Clear' },
                  ] as { key: 'weekdays' | 'weekends' | 'all' | 'clear'; label: string }[]
                ).map(({ key, label }) => (
                  <Button key={key} variant="outline" size="sm" className="text-xs" onClick={() => applyPreset(key)}>
                    {label}
                  </Button>
                ))}
              </div>

              {isLoading ? (
                <div className="flex justify-center py-8">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
              ) : (
                <div className="space-y-0 overflow-x-auto">
                  {/* Day headers */}
                  <div className="grid grid-cols-[80px_repeat(7,1fr)] gap-0 mb-1 min-w-[420px]">
                    <div />
                    {weekDates.map(date => {
                      const isToday = date.toDateString() === new Date().toDateString();
                      const summary = getDayAvailabilitySummary(date);
                      const dateKey = formatDateKey(date);
                      const timeRange = weekWasAutoFilled ? autoFilledTimeRanges[dateKey] : null;
                      return (
                        <div key={date.toISOString()} className="text-center px-0.5">
                          <div className="text-[10px] text-muted-foreground uppercase tracking-wide">
                            {date.toLocaleDateString('en-US', { weekday: 'short' })}
                          </div>
                          <div className={cn(
                            "w-8 h-8 mx-auto rounded-full flex items-center justify-center text-sm font-semibold",
                            isToday && "bg-primary text-primary-foreground",
                            !isToday && summary === 'full' && "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400",
                            !isToday && summary === 'partial' && "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",
                            !isToday && summary === 'none' && "text-muted-foreground"
                          )}>
                            {date.getDate()}
                          </div>
                          {/* Time range label — shown for the whole week session after auto-fill,
                              persists even after the user dismisses the pill */}
                          {weekWasAutoFilled && timeRange && (
                            <div className="text-[9px] text-primary leading-tight mt-0.5 truncate">
                              {formatTimeShort(timeRange.startTime)}–{formatTimeShort(timeRange.endTime)}
                            </div>
                          )}
                          {user?.id && (
                            <DayNoteButton date={date} notes={dayNotes} userId={user.id} />
                          )}
                        </div>
                      );
                    })}
                  </div>

                  {/* Slot rows */}
                  {timeSlots.map(({ value: slot, label, hours, Icon }) => (
                    <div key={slot} className="grid grid-cols-[80px_repeat(7,1fr)] gap-0 items-center border-t border-border/60 py-2 min-w-[420px]">
                      <div className="flex items-center gap-1.5 pr-2">
                        <Icon className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                        <div>
                          <div className="text-xs font-medium leading-tight">{label}</div>
                          <div className="text-[10px] text-muted-foreground leading-tight">{hours}</div>
                        </div>
                      </div>
                      {weekDates.map(date => {
                        const dateKey = formatDateKey(date);
                        const dayData = availabilityData[dateKey] || emptyDaySlots();
                        const isActive = slot === 'all_day' ? dayData.all_day : dayData[slot];
                        return (
                          <div key={`${dateKey}-${slot}`} className="flex justify-center">
                            <button
                              onClick={() => toggleSlot(date, slot)}
                              className={cn(
                                "w-8 h-8 rounded-lg flex items-center justify-center transition-all",
                                isActive
                                  ? "bg-green-500 text-white shadow-sm"
                                  : "bg-muted/50 text-muted-foreground hover:bg-muted"
                              )}
                              aria-label={`Toggle ${label} on ${date.toLocaleDateString()}`}
                            >
                              {isActive ? <Check className="h-3.5 w-3.5" /> : <Minus className="h-3 w-3" />}
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  ))}
                </div>
              )}

              <div className="mt-4 flex gap-2 flex-wrap">
                <Button
                  onClick={handleSaveAvailability}
                  disabled={submitAvailabilityMutation.isPending || !hasChanges}
                  className="flex-1 gap-2 min-w-[140px]"
                >
                  {submitAvailabilityMutation.isPending ? (
                    <><Loader2 className="h-4 w-4 animate-spin" />Saving…</>
                  ) : (
                    <><Save className="h-4 w-4" />Save Availability</>
                  )}
                </Button>
                <Button variant="ghost" size="sm" className="text-xs" onClick={() => setSelectedWeek(new Date())}>
                  Today
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* Monthly overview */}
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center justify-between mb-3">
                <h4 className="text-sm font-semibold">Monthly Overview</h4>
                <div className="flex items-center gap-1">
                  <Button
                    variant="ghost" size="icon" className="h-7 w-7"
                    onClick={() => setCalendarMonth(new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() - 1))}
                  >
                    <ChevronLeft className="h-3.5 w-3.5" />
                  </Button>
                  <span className="text-sm font-medium min-w-[120px] text-center">
                    {calendarMonth.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
                  </span>
                  <Button
                    variant="ghost" size="icon" className="h-7 w-7"
                    onClick={() => setCalendarMonth(new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() + 1))}
                  >
                    <ChevronRight className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
              <div className="grid grid-cols-7 gap-1 mb-1">
                {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((d, i) => (
                  <div key={i} className="text-center text-[10px] text-muted-foreground font-medium py-1">{d}</div>
                ))}
              </div>
              <div className="grid grid-cols-7 gap-1">
                {monthDays.map((day, i) => {
                  if (!day) return <div key={`empty-${i}`} />;
                  const isToday = day.toDateString() === new Date().toDateString();
                  const summary = getDayAvailabilitySummary(day);
                  const hasTimeOff = myRequests.some(r => {
                    const start = new Date(r.startDate);
                    const end = new Date(r.endDate);
                    return day >= start && day <= end && r.status !== 'cancelled';
                  });
                  return (
                    <button
                      key={day.toISOString()}
                      onClick={() => { setSelectedWeek(day); setActiveTab('availability'); }}
                      className={cn(
                        "h-8 rounded text-xs font-medium relative",
                        isToday && "ring-1 ring-primary",
                        summary === 'full' && "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400",
                        summary === 'partial' && "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",
                        summary === 'none' && "text-muted-foreground hover:bg-muted",
                        hasTimeOff && "ring-1 ring-red-400"
                      )}
                    >
                      {day.getDate()}
                      {hasTimeOff && (
                        <span className="absolute bottom-0.5 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full bg-red-500" />
                      )}
                    </button>
                  );
                })}
              </div>
              <div className="flex flex-wrap items-center gap-3 mt-3 text-[10px] text-muted-foreground">
                <div className="flex items-center gap-1"><div className="w-3 h-3 rounded bg-green-100 dark:bg-green-900/30" />Available</div>
                <div className="flex items-center gap-1"><div className="w-3 h-3 rounded bg-amber-100 dark:bg-amber-900/30" />Partial</div>
                <div className="flex items-center gap-1"><div className="w-3 h-3 rounded border" />Not set</div>
                <div className="flex items-center gap-1"><div className="w-3 h-3 rounded ring-1 ring-red-400" />Time off</div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Default Week Tab ──────────────────────────────────────────────── */}
        <TabsContent value="default" className="space-y-4">
          <Card>
            <CardContent className="p-4">
              <div className="mb-4">
                <h3 className="font-semibold text-sm">My Default Schedule</h3>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Set the times you're typically available each day. New weeks without saved availability will auto-fill from this.
                </p>
              </div>

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

              <div className="mt-5 space-y-2">
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
                    Saved — auto-fills empty future weeks automatically.
                  </p>
                )}
                {!availabilityTemplate?.slots && !templateHasChanges && (
                  <p className="text-center text-[11px] text-muted-foreground">
                    No default schedule yet. Set your usual hours above and save.
                  </p>
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

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
