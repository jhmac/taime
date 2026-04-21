import { useState, useEffect, useMemo } from "react";
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
  MoreHorizontal, MessageSquare, CalendarCheck, Save, Loader2, Bookmark, Wand2
} from "lucide-react";
import type { UserAvailability, TimeOffRequest, AvailabilityTemplate } from "@shared/schema";

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

const timeSlots: { value: TimeSlot; label: string; hours: string; Icon: React.ComponentType<{ className?: string }> }[] = [
  { value: 'all_day', label: 'All Day', hours: '9 AM–9 PM', Icon: Clock },
  { value: 'morning', label: 'Morning', hours: '6 AM–12 PM', Icon: Sun },
  { value: 'afternoon', label: 'Afternoon', hours: '12–6 PM', Icon: Sunset },
  { value: 'evening', label: 'Evening', hours: '6 PM–close', Icon: Moon },
];

const timeOffTypes = [
  { value: 'vacation', label: 'Vacation', Icon: Umbrella },
  { value: 'sick', label: 'Sick Leave', Icon: Thermometer },
  { value: 'personal', label: 'Personal', Icon: User },
  { value: 'unpaid', label: 'Unpaid Leave', Icon: CalendarMinus },
  { value: 'other', label: 'Other', Icon: MoreHorizontal },
];

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

export default function Availability() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState("availability");
  const [selectedWeek, setSelectedWeek] = useState(new Date());
  const [calendarMonth, setCalendarMonth] = useState(new Date());
  const [availabilityData, setAvailabilityData] = useState<Record<string, Record<TimeSlot, boolean>>>({});
  const [showTimeOffForm, setShowTimeOffForm] = useState(false);
  const [timeOffType, setTimeOffType] = useState("vacation");
  const [timeOffStartDate, setTimeOffStartDate] = useState("");
  const [timeOffEndDate, setTimeOffEndDate] = useState("");
  const [timeOffReason, setTimeOffReason] = useState("");
  const [hasChanges, setHasChanges] = useState(false);

  const weekDates = useMemo(() => getWeekDates(selectedWeek), [selectedWeek]);
  const weekStart = weekDates[0];
  const weekEnd = weekDates[6];

  const startParam = formatDateKey(weekStart);
  const endParam = formatDateKey(weekEnd);

  const { data: currentAvailability = [], isLoading } = useQuery<UserAvailability[]>({
    queryKey: ['/api/availability', { startDate: startParam, endDate: endParam }],
    queryFn: async () => {
      const res = await fetch(`/api/availability?startDate=${startParam}&endDate=${endParam}`, {
        credentials: 'include',
      });
      if (!res.ok) throw new Error('Failed to fetch');
      return res.json();
    },
  });

  const { data: dayNotes = [] } = useQuery<DayNote[]>({
    queryKey: ['/api/day-notes', startParam, endParam],
    queryFn: async () => {
      const res = await fetch(`/api/day-notes?startDate=${startParam}&endDate=${endParam}`, {
        credentials: 'include',
      });
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

  useEffect(() => {
    const availMap: Record<string, Record<TimeSlot, boolean>> = {};
    if (Array.isArray(currentAvailability)) {
      currentAvailability.forEach((avail: any) => {
        const dateKey = avail.date.split('T')[0];
        if (!availMap[dateKey]) {
          availMap[dateKey] = { all_day: false, morning: false, afternoon: false, evening: false };
        }
        availMap[dateKey][avail.timeSlot as TimeSlot] = avail.isAvailable ?? false;
      });
    }
    setAvailabilityData(availMap);
    setHasChanges(false);
  }, [currentAvailability]);

  const submitAvailabilityMutation = useMutation({
    mutationFn: async (availability: any[]) => {
      await apiRequest('POST', '/api/availability', { availability });
    },
    onSuccess: () => {
      toast({ title: "Availability saved", description: "Your availability has been updated." });
      queryClient.invalidateQueries({ queryKey: ['/api/availability'] });
      setHasChanges(false);
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to save availability.", variant: "destructive" });
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

  const saveTemplateMutation = useMutation({
    mutationFn: async () => {
      const slots: Record<string, { morning: boolean; afternoon: boolean; evening: boolean }> = {};
      weekDates.forEach(date => {
        const dow = date.getDay().toString();
        const dateKey = formatDateKey(date);
        const dayData = availabilityData[dateKey] || { all_day: false, morning: false, afternoon: false, evening: false };
        slots[dow] = { morning: dayData.morning, afternoon: dayData.afternoon, evening: dayData.evening };
      });
      await apiRequest('POST', '/api/availability/template', { slots });
    },
    onSuccess: () => {
      toast({ title: "Default week saved", description: "This week's availability will prefill future weeks automatically." });
      queryClient.invalidateQueries({ queryKey: ['/api/availability/template'] });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to save default week.", variant: "destructive" });
    },
  });

  const applyTemplate = () => {
    if (!availabilityTemplate?.slots) return;
    const slots = availabilityTemplate.slots as Record<string, { morning: boolean; afternoon: boolean; evening: boolean }>;
    const newData: Record<string, Record<TimeSlot, boolean>> = {};
    weekDates.forEach(date => {
      const dow = date.getDay().toString();
      const dateKey = formatDateKey(date);
      const daySlots = slots[dow] || { morning: false, afternoon: false, evening: false };
      newData[dateKey] = {
        morning: daySlots.morning,
        afternoon: daySlots.afternoon,
        evening: daySlots.evening,
        all_day: daySlots.morning && daySlots.afternoon && daySlots.evening,
      };
    });
    setAvailabilityData(prev => ({ ...prev, ...newData }));
    setHasChanges(true);
    toast({ title: "Template applied", description: "Your default week has been loaded. Save to keep these changes." });
  };

  const weekHasNoAvailability = useMemo(() => {
    if (!Array.isArray(currentAvailability)) return true;
    const weekDateKeys = new Set(weekDates.map(formatDateKey));
    return !currentAvailability.some((avail: UserAvailability) => {
      const dateKey = (avail.date as unknown as string).split('T')[0];
      return weekDateKeys.has(dateKey);
    });
  }, [currentAvailability, weekDates]);

  const isWeekInPast = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return weekDates[6] < today;
  }, [weekDates]);

  const showTemplateBanner = !isLoading && !hasChanges && weekHasNoAvailability && !!availabilityTemplate?.slots && !isWeekInPast;

  const toggleSlot = (date: Date, slot: TimeSlot) => {
    const dateKey = formatDateKey(date);
    setAvailabilityData(prev => {
      const dayData = prev[dateKey] || { all_day: false, morning: false, afternoon: false, evening: false };

      if (slot === 'all_day') {
        const newVal = !dayData.all_day;
        return {
          ...prev,
          [dateKey]: { all_day: newVal, morning: newVal, afternoon: newVal, evening: newVal },
        };
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
      const isWeekend = !isWeekday;
      const available =
        preset === 'all' ? true :
        preset === 'clear' ? false :
        preset === 'weekdays' ? isWeekday :
        preset === 'weekends' ? isWeekend : false;
      newData[dateKey] = { all_day: available, morning: available, afternoon: available, evening: available };
    });
    setAvailabilityData(prev => ({ ...prev, ...newData }));
    setHasChanges(true);
  };

  const handleSaveAvailability = () => {
    const availability: any[] = [];
    weekDates.forEach(date => {
      const dateKey = formatDateKey(date);
      const slots = availabilityData[dateKey] || { all_day: false, morning: false, afternoon: false, evening: false };
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

  const getDayAvailabilitySummary = (date: Date): 'full' | 'partial' | 'none' => {
    const dateKey = formatDateKey(date);
    const slots = availabilityData[dateKey];
    if (!slots) return 'none';
    const count = [slots.morning, slots.afternoon, slots.evening].filter(Boolean).length;
    if (count === 3) return 'full';
    if (count > 0) return 'partial';
    return 'none';
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

  return (
    <div className="min-h-screen bg-background p-4 md:p-6">
      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
        <TabsList className="grid w-full grid-cols-2 max-w-md">
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

        {/* ── Availability Tab ── */}
        <TabsContent value="availability" className="space-y-4">
          <Card>
            <CardContent className="p-4">
              {/* Week navigation */}
              <div className="flex items-center justify-between mb-4">
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
                  <Button
                    key={key}
                    variant="outline"
                    size="sm"
                    className="text-xs"
                    onClick={() => applyPreset(key)}
                  >
                    {label}
                  </Button>
                ))}
              </div>

              {showTemplateBanner && (
                <div className="mb-3 flex items-center gap-3 rounded-lg border border-primary/30 bg-primary/5 px-3 py-2.5">
                  <Wand2 className="h-4 w-4 text-primary shrink-0" />
                  <p className="text-xs text-muted-foreground flex-1">
                    This week has no availability set. Apply your default week template?
                  </p>
                  <Button size="sm" variant="outline" className="h-7 text-xs shrink-0" onClick={applyTemplate}>
                    Apply
                  </Button>
                </div>
              )}

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
                        const dayData = availabilityData[dateKey] || { all_day: false, morning: false, afternoon: false, evening: false };
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
                              {isActive
                                ? <Check className="h-3.5 w-3.5" />
                                : <Minus className="h-3 w-3" />
                              }
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
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1.5 text-xs"
                  disabled={saveTemplateMutation.isPending}
                  onClick={() => saveTemplateMutation.mutate()}
                  title="Save this week's slots as your recurring default"
                >
                  {saveTemplateMutation.isPending ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Bookmark className="h-3.5 w-3.5" />
                  )}
                  Set as default week
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
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    onClick={() => setCalendarMonth(new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() - 1))}
                  >
                    <ChevronLeft className="h-3.5 w-3.5" />
                  </Button>
                  <span className="text-sm font-medium min-w-[120px] text-center">
                    {calendarMonth.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
                  </span>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
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

        {/* ── Time Off Tab ── */}
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
                          variant="ghost"
                          size="sm"
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
