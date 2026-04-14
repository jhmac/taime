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
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { useLocation } from "wouter";
import { cn } from "@/lib/utils";
import { apiRequest, queryClient as globalQueryClient } from "@/lib/queryClient";
import type { User, Schedule, WorkLocation } from "@shared/schema";
import {
  ChevronLeft, ChevronRight, Plus, Trash2, Sparkles, Loader2,
  Check, X, Calendar, Clock, StickyNote, Bell, Pencil
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
  const [shiftFilter, setShiftFilter] = useState<'my' | 'all' | 'open'>('my');
  const [selectedDay, setSelectedDay] = useState<Date | null>(null);
  const [showAIPanel, setShowAIPanel] = useState(false);
  const [editingSchedule, setEditingSchedule] = useState<Schedule | null>(null);
  const [aiResult, setAiResult] = useState<GenerateResult | null>(null);
  const [removedEntries, setRemovedEntries] = useState<Set<number>>(new Set());

  const isAdmin = currentUser?.role?.name === 'admin' || currentUser?.role?.name === 'owner';

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

  const getAvailabilityForDay = (userId: string, date: Date) => {
    const dateStr = date.toDateString();
    return allAvailability.filter((a: any) => a.userId === userId && new Date(a.date).toDateString() === dateStr);
  };

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
    setCreateShiftDefaults({
      userId: userId || '',
      date: date ? date.toISOString().split('T')[0] : new Date().toISOString().split('T')[0],
    });
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
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
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

                    const dayAvailability = getAvailabilityForDay(emp.id, date);
                    const availBySlot: Record<string, any> = {};
                    dayAvailability.forEach((a: any) => { availBySlot[a.timeSlot] = a; });

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

                          {/* Availability indicators */}
                          {dayAvailability.length > 0 && (
                            <div className="flex gap-0.5 flex-wrap mt-1">
                              {(['morning', 'afternoon', 'evening'] as const).map(slot => {
                                const entry = availBySlot[slot];
                                if (!entry) return null;
                                const label = slot === 'morning' ? 'AM' : slot === 'afternoon' ? 'PM' : 'Eve';
                                return (
                                  <span
                                    key={slot}
                                    title={`${slot}: ${entry.isAvailable ? 'available' : 'unavailable'}${entry.startTime ? ` ${entry.startTime}–${entry.endTime}` : ''}`}
                                    className={cn(
                                      "text-[9px] px-1 rounded font-medium leading-[14px]",
                                      entry.isAvailable
                                        ? "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300"
                                        : "bg-red-100 text-red-600 dark:bg-red-900/40 dark:text-red-300 line-through opacity-70"
                                    )}
                                  >
                                    {label}
                                  </span>
                                );
                              })}
                            </div>
                          )}

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
            <div>
              <Label className="text-xs">Employee</Label>
              <Select name="userId" defaultValue={createShiftDefaults.userId} required>
                <SelectTrigger className="h-8">
                  <SelectValue placeholder="Select employee" />
                </SelectTrigger>
                <SelectContent>
                  {activeEmployees.map(user => (
                    <SelectItem key={user.id} value={user.id}>
                      {user.firstName} {user.lastName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Date</Label>
              <Input name="startDate" type="date" className="h-8 text-sm" required defaultValue={createShiftDefaults.date} />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label className="text-xs">Start Time</Label>
                <Input name="startTime" type="time" className="h-8 text-sm" required defaultValue="09:00" />
              </div>
              <div>
                <Label className="text-xs">End Time</Label>
                <Input name="endTime" type="time" className="h-8 text-sm" required defaultValue="17:00" />
              </div>
            </div>
            <div>
              <Label className="text-xs">Role/Title (optional)</Label>
              <Input name="title" className="h-8 text-sm" placeholder="e.g., Opener, Closer" />
            </div>
            <div>
              <Label className="text-xs">Location</Label>
              <Select name="locationId">
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
            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="outline" size="sm" onClick={() => setShowCreateShift(false)}>Cancel</Button>
              <Button type="submit" size="sm" disabled={createScheduleMutation.isPending}>
                {createScheduleMutation.isPending ? "Creating..." : "Create Shift"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

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
            const toLocalDateTimeStr = (d: Date | string) => {
              const dt = new Date(d);
              const pad = (n: number) => String(n).padStart(2, '0');
              return `${dt.getFullYear()}-${pad(dt.getMonth()+1)}-${pad(dt.getDate())}T${pad(dt.getHours())}:${pad(dt.getMinutes())}`;
            };
            return (
              <form
                onSubmit={e => {
                  e.preventDefault();
                  const fd = new FormData(e.currentTarget);
                  updateScheduleMutation.mutate({
                    id: editingSchedule.id,
                    data: {
                      startTime: new Date(fd.get('startTime') as string),
                      endTime: new Date(fd.get('endTime') as string),
                      title: (fd.get('title') as string) || null,
                      description: (fd.get('description') as string) || null,
                      locationId: (fd.get('locationId') as string) || null,
                    },
                  });
                }}
                className="space-y-3"
              >
                <div className="text-sm font-medium text-muted-foreground">{empName}</div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <Label className="text-xs">Start</Label>
                    <Input type="datetime-local" name="startTime" className="h-8 text-xs" defaultValue={toLocalDateTimeStr(editingSchedule.startTime)} required />
                  </div>
                  <div>
                    <Label className="text-xs">End</Label>
                    <Input type="datetime-local" name="endTime" className="h-8 text-xs" defaultValue={toLocalDateTimeStr(editingSchedule.endTime)} required />
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
