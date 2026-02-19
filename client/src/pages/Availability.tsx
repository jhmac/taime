import { useState, useEffect, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import type { UserAvailability, TimeOffRequest } from "@shared/schema";

type TimeSlot = 'morning' | 'afternoon' | 'evening' | 'all_day';

const timeSlots: { value: TimeSlot; label: string; hours: string; icon: string }[] = [
  { value: 'all_day', label: 'All Day', hours: '9 AM - 9 PM', icon: 'fas fa-sun' },
  { value: 'morning', label: 'Morning', hours: '6 AM - 12 PM', icon: 'fas fa-cloud-sun' },
  { value: 'afternoon', label: 'Afternoon', hours: '12 PM - 6 PM', icon: 'fas fa-sun' },
  { value: 'evening', label: 'Evening', hours: '6 PM - 12 AM', icon: 'fas fa-moon' },
];

const timeOffTypes = [
  { value: 'vacation', label: 'Vacation', icon: 'fas fa-umbrella-beach' },
  { value: 'sick', label: 'Sick Leave', icon: 'fas fa-thermometer-half' },
  { value: 'personal', label: 'Personal', icon: 'fas fa-user' },
  { value: 'unpaid', label: 'Unpaid Leave', icon: 'fas fa-calendar-minus' },
  { value: 'other', label: 'Other', icon: 'fas fa-ellipsis-h' },
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

  const isAdmin = user?.role?.name === 'admin' || user?.role?.name === 'owner';

  const weekDates = useMemo(() => getWeekDates(selectedWeek), [selectedWeek]);
  const weekStart = weekDates[0];
  const weekEnd = weekDates[6];

  const startParam = `${weekStart.getFullYear()}-${String(weekStart.getMonth() + 1).padStart(2, '0')}-${String(weekStart.getDate()).padStart(2, '0')}`;
  const endParam = `${weekEnd.getFullYear()}-${String(weekEnd.getMonth() + 1).padStart(2, '0')}-${String(weekEnd.getDate()).padStart(2, '0')}`;

  const { data: currentAvailability = [], isLoading } = useQuery<UserAvailability[]>({
    queryKey: ['/api/availability', { startDate: startParam, endDate: endParam }],
    queryFn: async () => {
      const res = await fetch(`/api/availability?startDate=${startParam}&endDate=${endParam}`);
      if (!res.ok) throw new Error('Failed to fetch');
      return res.json();
    },
  });

  const { data: timeOffRequests = [] } = useQuery<TimeOffRequest[]>({
    queryKey: ['/api/time-off-requests'],
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
      const response = await fetch('/api/availability', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ availability }),
      });
      if (!response.ok) throw new Error('Failed to submit availability');
      return response.json();
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
      const response = await fetch('/api/time-off-requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      if (!response.ok) throw new Error('Failed to create request');
      return response.json();
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
      const response = await fetch(`/api/time-off-requests/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'cancelled' }),
      });
      if (!response.ok) throw new Error('Failed to cancel');
      return response.json();
    },
    onSuccess: () => {
      toast({ title: "Cancelled", description: "Time-off request has been cancelled." });
      queryClient.invalidateQueries({ queryKey: ['/api/time-off-requests'] });
    },
  });

  const toggleSlot = (date: Date, slot: TimeSlot) => {
    const dateKey = formatDateKey(date);
    setAvailabilityData(prev => {
      const dayData = prev[dateKey] || { all_day: false, morning: false, afternoon: false, evening: false };
      
      if (slot === 'all_day') {
        const newVal = !dayData.all_day;
        return {
          ...prev,
          [dateKey]: {
            all_day: newVal,
            morning: newVal,
            afternoon: newVal,
            evening: newVal,
          },
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
      const dayOfWeek = date.getDay();
      const isWeekday = dayOfWeek > 0 && dayOfWeek < 6;
      const isWeekend = !isWeekday;
      
      const available =
        preset === 'all' ? true :
        preset === 'clear' ? false :
        preset === 'weekdays' ? isWeekday :
        preset === 'weekends' ? isWeekend : false;
      
      newData[dateKey] = {
        all_day: available,
        morning: available,
        afternoon: available,
        evening: available,
      };
    });
    setAvailabilityData(prev => ({ ...prev, ...newData }));
    setHasChanges(true);
  };

  const handleSaveAvailability = () => {
    const availability: any[] = [];
    Object.entries(availabilityData).forEach(([dateStr, slots]) => {
      (['morning', 'afternoon', 'evening'] as TimeSlot[]).forEach(slot => {
        availability.push({
          date: new Date(dateStr + 'T12:00:00Z'),
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

  const goToPreviousWeek = () => {
    const d = new Date(selectedWeek);
    d.setDate(d.getDate() - 7);
    setSelectedWeek(d);
  };

  const goToNextWeek = () => {
    const d = new Date(selectedWeek);
    d.setDate(d.getDate() + 7);
    setSelectedWeek(d);
  };

  const getDayAvailabilitySummary = (date: Date): string => {
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
          <TabsTrigger value="availability" className="text-sm">
            <i className="fas fa-calendar-check mr-2"></i>Availability
          </TabsTrigger>
          <TabsTrigger value="time-off" className="text-sm relative">
            <i className="fas fa-umbrella-beach mr-2"></i>Time Off
            {pendingCount > 0 && (
              <span className="absolute -top-1 -right-1 bg-amber-500 text-white text-[10px] rounded-full w-4 h-4 flex items-center justify-center">
                {pendingCount}
              </span>
            )}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="availability" className="space-y-4">
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center justify-between mb-4">
                <Button variant="ghost" size="icon" onClick={goToPreviousWeek}>
                  <i className="fas fa-chevron-left"></i>
                </Button>
                <div className="text-center">
                  <h3 className="font-semibold text-sm">
                    {weekDates[0].toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} - {weekDates[6].toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                  </h3>
                </div>
                <Button variant="ghost" size="icon" onClick={goToNextWeek}>
                  <i className="fas fa-chevron-right"></i>
                </Button>
              </div>

              <div className="flex gap-2 mb-4 flex-wrap">
                <Button variant="outline" size="sm" className="text-xs" onClick={() => applyPreset('weekdays')}>
                  <i className="fas fa-briefcase mr-1"></i>Weekdays
                </Button>
                <Button variant="outline" size="sm" className="text-xs" onClick={() => applyPreset('weekends')}>
                  <i className="fas fa-couch mr-1"></i>Weekends
                </Button>
                <Button variant="outline" size="sm" className="text-xs" onClick={() => applyPreset('all')}>
                  <i className="fas fa-check-double mr-1"></i>All
                </Button>
                <Button variant="outline" size="sm" className="text-xs text-muted-foreground" onClick={() => applyPreset('clear')}>
                  <i className="fas fa-eraser mr-1"></i>Clear
                </Button>
              </div>

              {isLoading ? (
                <div className="flex justify-center py-8">
                  <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary"></div>
                </div>
              ) : (
                <div className="space-y-0">
                  <div className="grid grid-cols-[90px_repeat(7,1fr)] gap-0 mb-1">
                    <div></div>
                    {weekDates.map(date => {
                      const isToday = date.toDateString() === new Date().toDateString();
                      const summary = getDayAvailabilitySummary(date);
                      return (
                        <div key={date.toISOString()} className="text-center px-0.5">
                          <div className="text-[10px] text-muted-foreground uppercase">
                            {date.toLocaleDateString('en-US', { weekday: 'short' })}
                          </div>
                          <div className={cn(
                            "w-8 h-8 mx-auto rounded-full flex items-center justify-center text-sm font-medium",
                            isToday && "bg-primary text-primary-foreground",
                            !isToday && summary === 'full' && "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400",
                            !isToday && summary === 'partial' && "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",
                            !isToday && summary === 'none' && "text-muted-foreground"
                          )}>
                            {date.getDate()}
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {timeSlots.map(slot => (
                    <div key={slot.value} className="grid grid-cols-[90px_repeat(7,1fr)] gap-0 items-center border-t border-border py-2">
                      <div className="flex items-center gap-1.5 pr-2">
                        <i className={cn(slot.icon, "text-xs text-muted-foreground w-4")}></i>
                        <div>
                          <div className="text-xs font-medium">{slot.label}</div>
                          <div className="text-[10px] text-muted-foreground">{slot.hours}</div>
                        </div>
                      </div>
                      {weekDates.map(date => {
                        const dateKey = formatDateKey(date);
                        const dayData = availabilityData[dateKey] || { all_day: false, morning: false, afternoon: false, evening: false };
                        const isActive = slot.value === 'all_day' ? dayData.all_day : dayData[slot.value];
                        
                        return (
                          <div key={`${dateKey}-${slot.value}`} className="flex justify-center">
                            <button
                              onClick={() => toggleSlot(date, slot.value)}
                              className={cn(
                                "w-8 h-8 rounded-lg flex items-center justify-center transition-all text-xs",
                                isActive
                                  ? "bg-green-500 text-white shadow-sm"
                                  : "bg-muted/50 text-muted-foreground hover:bg-muted"
                              )}
                            >
                              {isActive ? <i className="fas fa-check text-xs"></i> : <i className="fas fa-minus text-[10px]"></i>}
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  ))}
                </div>
              )}

              <div className="mt-4 flex gap-2">
                <Button
                  onClick={handleSaveAvailability}
                  disabled={submitAvailabilityMutation.isPending || !hasChanges}
                  className="flex-1"
                >
                  {submitAvailabilityMutation.isPending ? (
                    <><i className="fas fa-spinner fa-spin mr-2"></i>Saving...</>
                  ) : (
                    <><i className="fas fa-save mr-2"></i>Save Availability</>
                  )}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-xs"
                  onClick={() => setSelectedWeek(new Date())}
                >
                  Today
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-4">
              <div className="flex items-center justify-between mb-3">
                <h4 className="text-sm font-semibold flex items-center gap-2">
                  <i className="fas fa-calendar text-muted-foreground"></i>
                  Monthly Overview
                </h4>
                <div className="flex items-center gap-2">
                  <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setCalendarMonth(new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() - 1))}>
                    <i className="fas fa-chevron-left text-xs"></i>
                  </Button>
                  <span className="text-sm font-medium min-w-[120px] text-center">
                    {calendarMonth.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
                  </span>
                  <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setCalendarMonth(new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() + 1))}>
                    <i className="fas fa-chevron-right text-xs"></i>
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
                      onClick={() => {
                        setSelectedWeek(day);
                        setActiveTab('availability');
                      }}
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
                        <span className="absolute bottom-0 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full bg-red-500"></span>
                      )}
                    </button>
                  );
                })}
              </div>
              <div className="flex items-center gap-4 mt-3 text-[10px] text-muted-foreground">
                <div className="flex items-center gap-1"><div className="w-3 h-3 rounded bg-green-100 dark:bg-green-900/30"></div>Available</div>
                <div className="flex items-center gap-1"><div className="w-3 h-3 rounded bg-amber-100 dark:bg-amber-900/30"></div>Partial</div>
                <div className="flex items-center gap-1"><div className="w-3 h-3 rounded border"></div>Not set</div>
                <div className="flex items-center gap-1"><div className="w-3 h-3 rounded ring-1 ring-red-400"></div>Time off</div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="time-off" className="space-y-4">
          <Button
            className="w-full"
            onClick={() => setShowTimeOffForm(true)}
          >
            <i className="fas fa-plus mr-2"></i>Request Time Off
          </Button>

          {myRequests.length === 0 ? (
            <Card>
              <CardContent className="p-8 text-center">
                <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-muted flex items-center justify-center">
                  <i className="fas fa-umbrella-beach text-2xl text-muted-foreground"></i>
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
                return (
                  <Card key={req.id}>
                    <CardContent className="p-4">
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                          <i className={cn(typeInfo?.icon || 'fas fa-calendar', "text-muted-foreground")}></i>
                          <span className="text-sm font-medium">{typeInfo?.label || req.type}</span>
                        </div>
                        <Badge className={cn("text-xs", statusColors[req.status] || statusColors.pending)}>
                          {req.status === 'pending' ? 'Pending' : req.status.charAt(0).toUpperCase() + req.status.slice(1)}
                        </Badge>
                      </div>
                      
                      <div className="text-sm text-muted-foreground mb-2">
                        {new Date(req.startDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                        {req.startDate !== req.endDate && (
                          <> - {new Date(req.endDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</>
                        )}
                      </div>
                      
                      {req.reason && (
                        <p className="text-xs text-muted-foreground mb-2 italic">"{req.reason}"</p>
                      )}
                      
                      {req.adminNotes && (
                        <p className="text-xs text-muted-foreground bg-muted/50 p-2 rounded mb-2">
                          <i className="fas fa-comment-dots mr-1"></i> Manager: {req.adminNotes}
                        </p>
                      )}
                      
                      <div className="text-[10px] text-muted-foreground">
                        Submitted {new Date(req.createdAt!).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                      </div>
                      
                      {req.status === 'pending' && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="mt-2 text-xs text-destructive hover:text-destructive"
                          onClick={() => cancelTimeOffMutation.mutate(req.id)}
                          disabled={cancelTimeOffMutation.isPending}
                        >
                          <i className="fas fa-times mr-1"></i>Cancel Request
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

      <Dialog open={showTimeOffForm} onOpenChange={setShowTimeOffForm}>
        <DialogContent className="max-w-sm mx-auto">
          <DialogHeader>
            <DialogTitle className="text-base flex items-center gap-2">
              <i className="fas fa-umbrella-beach text-primary"></i>
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
                        <i className={t.icon}></i> {t.label}
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
                placeholder="Brief reason for your request..."
                rows={3}
              />
            </div>
            
            <Button
              onClick={handleSubmitTimeOff}
              disabled={createTimeOffMutation.isPending || !timeOffStartDate || !timeOffEndDate}
              className="w-full"
            >
              {createTimeOffMutation.isPending ? (
                <><i className="fas fa-spinner fa-spin mr-2"></i>Submitting...</>
              ) : (
                <><i className="fas fa-paper-plane mr-2"></i>Submit Request</>
              )}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
