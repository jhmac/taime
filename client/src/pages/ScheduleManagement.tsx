import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { useLocation } from "wouter";
import { cn } from "@/lib/utils";
import type { User, Schedule, WorkLocation } from "@shared/schema";
import AIStaffingPanel from "@/components/AIStaffingPanel";

export default function ScheduleManagement() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { user: currentUser } = useAuth();
  const [, navigate] = useLocation();
  const [selectedWeek, setSelectedWeek] = useState(0);
  const [showCreateShift, setShowCreateShift] = useState(false);
  const [selectedEmployee, setSelectedEmployee] = useState<string>('');
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());
  const [shiftFilter, setShiftFilter] = useState<'my' | 'all' | 'open'>('my');
  const [selectedDay, setSelectedDay] = useState<Date | null>(null);

  const isAdmin = currentUser?.role?.name === 'admin' || currentUser?.role?.name === 'owner';

  const { data: schedules = [], isLoading: schedulesLoading } = useQuery<Schedule[]>({
    queryKey: ["/api/schedules"],
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

  const activeShop = connectedShops.find((s: any) => s.isActive) || (connectedShops.length > 0 ? connectedShops[0] : null);

  const createScheduleMutation = useMutation({
    mutationFn: async (scheduleData: any) => {
      const response = await fetch("/api/schedules", {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(scheduleData),
      });
      if (!response.ok) throw new Error('Failed to create schedule');
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/schedules"] });
      setShowCreateShift(false);
      toast({ title: "Success", description: "Shift created successfully!" });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to create shift. Please try again.", variant: "destructive" });
    },
  });

  const formatTime = (dateStr: string | Date) => {
    return new Date(dateStr).toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true
    });
  };

  const getWeekDates = (weekOffset: number) => {
    const today = new Date();
    const startOfWeek = new Date(today);
    startOfWeek.setDate(today.getDate() - today.getDay() + (weekOffset * 7));
    const dates = [];
    for (let i = 0; i < 7; i++) {
      const date = new Date(startOfWeek);
      date.setDate(startOfWeek.getDate() + i);
      dates.push(date);
    }
    return dates;
  };

  const formatWeekRange = (weekOffset: number) => {
    const dates = getWeekDates(weekOffset);
    const start = dates[0].toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    const end = dates[6].toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    return `${start} - ${end}`;
  };

  const handleCreateShift = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    const startDate = formData.get('startDate') as string;
    const startTime = formData.get('startTime') as string;
    const endDate = formData.get('endDate') as string;
    const endTime = formData.get('endTime') as string;
    createScheduleMutation.mutate({
      userId: formData.get('userId') as string,
      startTime: new Date(`${startDate}T${startTime}`),
      endTime: new Date(`${endDate}T${endTime}`),
      title: formData.get('title') as string,
      locationId: formData.get('locationId') as string,
      description: formData.get('description') as string,
    });
  };

  const weekDates = getWeekDates(selectedWeek);
  const activeEmployees = users.filter(user => user.isActive !== false);

  if (schedulesLoading || usersLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    );
  }

  if (!isAdmin) {
    const mySchedules = schedules.filter(s =>
      s.userId === currentUser?.id &&
      weekDates.some(d => new Date(s.startTime).toDateString() === d.toDateString())
    );

    const allWeekSchedules = schedules.filter(s =>
      weekDates.some(d => new Date(s.startTime).toDateString() === d.toDateString())
    );
    
    const allUpcomingMyShifts = schedules
      .filter(s => s.userId === currentUser?.id && new Date(s.startTime) >= new Date(new Date().setHours(0, 0, 0, 0)))
      .sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());

    const allUpcomingSchedules = schedules
      .filter(s => new Date(s.startTime) >= new Date(new Date().setHours(0, 0, 0, 0)))
      .sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());

    const getFilteredSchedules = () => {
      if (shiftFilter === 'all' && !selectedDay) {
        return allUpcomingSchedules;
      }
      
      if (selectedDay) {
        const daySchedules = schedules.filter(s =>
          new Date(s.startTime).toDateString() === selectedDay.toDateString()
        );
        if (shiftFilter === 'my') return daySchedules.filter(s => s.userId === currentUser?.id);
        if (shiftFilter === 'open') return daySchedules.filter(s => !s.userId);
        return daySchedules;
      }

      if (shiftFilter === 'my') return mySchedules;
      if (shiftFilter === 'open') return allWeekSchedules.filter(s => !s.userId);
      return allWeekSchedules;
    };

    const filteredSchedules = getFilteredSchedules();
    const hasShifts = filteredSchedules.length > 0;
    const showingAllUpcoming = shiftFilter === 'all' && !selectedDay;

    const handleDayClick = (date: Date) => {
      if (selectedDay && selectedDay.toDateString() === date.toDateString()) {
        setSelectedDay(null);
      } else {
        setSelectedDay(date);
      }
    };

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
            <p className="text-sm text-muted-foreground" data-testid="employee-week-range">
              {formatWeekRange(selectedWeek)}
            </p>
          </div>

          <div className="flex items-center justify-between">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => { setSelectedWeek(selectedWeek - 1); setSelectedDay(null); }}
              data-testid="button-previous-week"
            >
              <i className="fas fa-chevron-left"></i>
            </Button>

            <div className="flex gap-1">
              {weekDates.map((date) => {
                const isToday = date.toDateString() === new Date().toDateString();
                const isSelected = selectedDay && selectedDay.toDateString() === date.toDateString();
                const hasShiftOnDay = mySchedules.some(s =>
                  new Date(s.startTime).toDateString() === date.toDateString()
                );
                const allShiftsOnDay = allWeekSchedules.filter(s =>
                  new Date(s.startTime).toDateString() === date.toDateString()
                );
                return (
                  <button
                    key={date.toISOString()}
                    onClick={() => handleDayClick(date)}
                    className="flex flex-col items-center gap-1 group"
                  >
                    <span className="text-[10px] text-muted-foreground uppercase">
                      {date.toLocaleDateString('en-US', { weekday: 'short' })}
                    </span>
                    <div
                      className={cn(
                        "w-9 h-9 rounded-full flex items-center justify-center text-sm font-medium transition-all",
                        isSelected
                          ? 'bg-primary text-primary-foreground ring-2 ring-primary/30'
                          : isToday
                            ? 'bg-primary text-primary-foreground'
                            : hasShiftOnDay
                              ? 'bg-primary/10 text-primary border border-primary/30'
                              : 'text-muted-foreground hover:bg-muted'
                      )}
                    >
                      {date.getDate()}
                    </div>
                    {allShiftsOnDay.length > 0 && (
                      <div className="flex gap-0.5">
                        {allShiftsOnDay.slice(0, 3).map((_, i) => (
                          <div key={i} className="w-1 h-1 rounded-full bg-primary/60"></div>
                        ))}
                      </div>
                    )}
                  </button>
                );
              })}
            </div>

            <Button
              variant="ghost"
              size="sm"
              onClick={() => { setSelectedWeek(selectedWeek + 1); setSelectedDay(null); }}
              data-testid="button-next-week"
            >
              <i className="fas fa-chevron-right"></i>
            </Button>
          </div>

          <div className="flex gap-2 justify-center">
            {(['all', 'my', 'open'] as const).map(filter => (
              <Button
                key={filter}
                variant={shiftFilter === filter ? 'default' : 'outline'}
                size="sm"
                className="text-xs px-4"
                onClick={() => {
                  setShiftFilter(filter);
                  if (filter === 'all') setSelectedDay(null);
                }}
              >
                {filter === 'all' ? 'All shifts' : filter === 'my' ? 'My shifts' : 'Open shifts'}
              </Button>
            ))}
          </div>

          {selectedDay && (
            <div className="bg-primary/5 border border-primary/10 rounded-lg px-3 py-2 flex items-center justify-between">
              <span className="text-sm font-medium">
                {selectedDay.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
              </span>
              <Button variant="ghost" size="sm" className="text-xs h-6" onClick={() => setSelectedDay(null)}>
                <i className="fas fa-times mr-1"></i>Clear
              </Button>
            </div>
          )}

          {showingAllUpcoming && (
            <div className="bg-blue-50 dark:bg-blue-950/20 border border-blue-100 dark:border-blue-900 rounded-lg px-3 py-2">
              <span className="text-xs text-blue-600 dark:text-blue-400 font-medium">
                <i className="fas fa-calendar-alt mr-1"></i>
                Showing all upcoming shifts ({filteredSchedules.length} total)
              </span>
            </div>
          )}

          {hasShifts ? (
            <div className="space-y-2">
              {Object.entries(groupedSchedules).map(([dayKey, dayShifts]) => {
                const dayDate = new Date(dayKey);
                const isToday = dayDate.toDateString() === new Date().toDateString();
                return (
                  <Card key={dayKey}>
                    <CardContent className="p-3">
                      <div className="text-xs font-medium text-muted-foreground mb-2">
                        {dayDate.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })}
                        {isToday && <span className="ml-1 text-primary">(Today)</span>}
                      </div>
                      {dayShifts.map(shift => {
                        const shiftUser = users.find(u => u.id === shift.userId);
                        const isMine = shift.userId === currentUser?.id;
                        const duration = ((new Date(shift.endTime).getTime() - new Date(shift.startTime).getTime()) / (1000 * 60 * 60)).toFixed(1);
                        return (
                          <div key={shift.id} className={cn(
                            "p-2 rounded border mb-1",
                            isMine
                              ? "bg-primary/5 border-primary/10"
                              : "bg-muted/30 border-border"
                          )}>
                            <div className="flex items-center justify-between">
                              <div className="text-sm font-medium">
                                {formatTime(shift.startTime)} - {formatTime(shift.endTime)}
                              </div>
                              <div className="flex items-center gap-1">
                                <span className="text-[10px] text-muted-foreground">{duration}h</span>
                                {shift.title && (
                                  <Badge variant="outline" className="text-[10px]">{shift.title}</Badge>
                                )}
                              </div>
                            </div>
                            {shiftFilter !== 'my' && shiftUser && (
                              <div className="text-xs text-muted-foreground mt-1">
                                {shiftUser.firstName} {shiftUser.lastName}
                                {isMine && <span className="text-primary ml-1">(You)</span>}
                              </div>
                            )}
                            {shift.description && (
                              <div className="text-xs text-muted-foreground mt-1 italic">{shift.description}</div>
                            )}
                          </div>
                        );
                      })}
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          ) : (
            <Card>
              <CardContent className="p-8 text-center">
                <div className="mx-auto w-24 h-24 mb-4 opacity-30">
                  <svg viewBox="0 0 100 100" className="w-full h-full text-muted-foreground">
                    <rect x="10" y="10" width="30" height="30" rx="3" fill="none" stroke="currentColor" strokeWidth="2" strokeDasharray="5,3" />
                    <rect x="45" y="25" width="30" height="30" rx="3" fill="none" stroke="currentColor" strokeWidth="2" strokeDasharray="5,3" />
                    <rect x="25" y="50" width="30" height="30" rx="3" fill="none" stroke="currentColor" strokeWidth="2" strokeDasharray="5,3" />
                    <rect x="60" y="60" width="15" height="15" rx="2" fill="currentColor" opacity="0.2" />
                  </svg>
                </div>
                <p className="text-base font-medium mb-1">
                  {selectedDay
                    ? `No shifts on ${selectedDay.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })}`
                    : 'You don\'t have any shifts this week'}
                </p>
                <p className="text-sm text-muted-foreground">Check back later or ask your manager about upcoming shifts.</p>
              </CardContent>
            </Card>
          )}

          <div className="space-y-3 pt-2">
            <Button
              variant="outline"
              className="w-full h-12 text-sm font-medium border-primary/30 text-primary hover:bg-primary/5"
              onClick={() => navigate('/availability')}
            >
              <i className="fas fa-calendar-check mr-2"></i>
              Update availability
            </Button>
            <Button
              variant="outline"
              className="w-full h-12 text-sm font-medium border-primary/30 text-primary hover:bg-primary/5"
              onClick={() => navigate('/availability')}
            >
              <i className="fas fa-umbrella-beach mr-2"></i>
              Submit time-off request
            </Button>
          </div>

          <div className="text-center pt-2">
            <Button
              variant="ghost"
              size="sm"
              className="text-xs text-muted-foreground"
              onClick={() => { setSelectedWeek(0); setSelectedDay(null); }}
              data-testid="button-current-week"
            >
              Back to current week
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background p-4 md:p-6">
      <div className="space-y-4">
        <Card>
          <CardContent className="p-4">
            <div className="space-y-3">
              <Dialog open={showCreateShift} onOpenChange={setShowCreateShift}>
                <DialogTrigger asChild>
                  <Button size="sm" className="w-full" data-testid="button-create-shift">
                    <i className="fas fa-plus mr-2"></i>
                    Create Shift
                  </Button>
                </DialogTrigger>
                <DialogContent className="max-w-sm mx-auto max-h-[90vh] overflow-y-auto" data-testid="dialog-create-shift">
                  <DialogHeader>
                    <DialogTitle className="text-sm">Create New Shift</DialogTitle>
                  </DialogHeader>
                  <form onSubmit={handleCreateShift} className="space-y-3">
                    <div>
                      <Label htmlFor="userId" className="text-xs">Employee</Label>
                      <Select name="userId" required>
                        <SelectTrigger className="h-8" data-testid="select-employee">
                          <SelectValue placeholder="Select employee" />
                        </SelectTrigger>
                        <SelectContent>
                          {activeEmployees.length === 0 ? (
                            <SelectItem value="none" disabled>
                              No employees available
                            </SelectItem>
                          ) : (
                            activeEmployees.map((user) => (
                              <SelectItem key={user.id} value={user.id}>
                                {user.firstName} {user.lastName}
                              </SelectItem>
                            ))
                          )}
                        </SelectContent>
                      </Select>
                    </div>
                    
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <Label htmlFor="startDate" className="text-xs">Start Date</Label>
                        <Input id="startDate" name="startDate" type="date" className="h-8 text-sm" required defaultValue={selectedDate.toISOString().split('T')[0]} data-testid="input-start-date" />
                      </div>
                      <div>
                        <Label htmlFor="startTime" className="text-xs">Start Time</Label>
                        <Input id="startTime" name="startTime" type="time" className="h-8 text-sm" required data-testid="input-start-time" />
                      </div>
                    </div>
                    
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <Label htmlFor="endDate" className="text-xs">End Date</Label>
                        <Input id="endDate" name="endDate" type="date" className="h-8 text-sm" required defaultValue={selectedDate.toISOString().split('T')[0]} data-testid="input-end-date" />
                      </div>
                      <div>
                        <Label htmlFor="endTime" className="text-xs">End Time</Label>
                        <Input id="endTime" name="endTime" type="time" className="h-8 text-sm" required data-testid="input-end-time" />
                      </div>
                    </div>
                    
                    <div>
                      <Label htmlFor="title" className="text-xs">Title</Label>
                      <Input id="title" name="title" className="h-8 text-sm" placeholder="e.g., Morning Shift" data-testid="input-shift-title" />
                    </div>
                    
                    <div>
                      <Label htmlFor="locationId" className="text-xs">Location</Label>
                      <Select name="locationId">
                        <SelectTrigger className="h-8" data-testid="select-location">
                          <SelectValue placeholder="Select location (optional)" />
                        </SelectTrigger>
                        <SelectContent>
                          {locations.map((location) => (
                            <SelectItem key={location.id} value={location.id}>
                              {location.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    
                    <div>
                      <Label htmlFor="description" className="text-xs">Description</Label>
                      <Textarea id="description" name="description" className="text-sm" placeholder="Additional details..." rows={2} data-testid="textarea-description" />
                    </div>
                    
                    <div className="flex justify-end space-x-2 pt-2">
                      <Button type="button" variant="outline" size="sm" onClick={() => setShowCreateShift(false)}>Cancel</Button>
                      <Button type="submit" size="sm" disabled={createScheduleMutation.isPending} data-testid="button-save-shift">
                        {createScheduleMutation.isPending ? "Creating..." : "Create"}
                      </Button>
                    </div>
                  </form>
                </DialogContent>
              </Dialog>

              <div className="flex items-center justify-between">
                <Button variant="outline" size="sm" onClick={() => setSelectedWeek(selectedWeek - 1)} data-testid="button-previous-week">
                  <i className="fas fa-chevron-left"></i>
                </Button>
                <span className="text-sm font-medium" data-testid="text-week-range">
                  {formatWeekRange(selectedWeek)}
                </span>
                <Button variant="outline" size="sm" onClick={() => setSelectedWeek(selectedWeek + 1)} data-testid="button-next-week">
                  <i className="fas fa-chevron-right"></i>
                </Button>
              </div>
              
              <Button variant="outline" size="sm" className="w-full" onClick={() => setSelectedWeek(0)} data-testid="button-current-week">
                Today
              </Button>
            </div>
          </CardContent>
        </Card>

        {activeShop?.shopDomain && (
          <AIStaffingPanel shopDomain={activeShop.shopDomain} />
        )}

        <Card>
          <CardContent className="p-2">
            <div className="space-y-3">
              {activeEmployees.map((employee) => {
                const employeeSchedules = schedules.filter(s => 
                  s.userId === employee.id && 
                  weekDates.some(d => new Date(s.startTime).toDateString() === d.toDateString())
                );
                
                return (
                  <Card key={employee.id} className="p-3">
                    <div className="flex items-center justify-between mb-2">
                      <div>
                        <div className="font-medium text-sm">{employee.firstName} {employee.lastName}</div>
                        <div className="text-xs text-muted-foreground">{employee.email}</div>
                      </div>
                      <Badge variant="outline" className="text-xs">{employeeSchedules.length} shifts</Badge>
                    </div>
                    
                    <div className="space-y-2">
                      {weekDates.map((date) => {
                        const daySchedules = employeeSchedules.filter(s => 
                          new Date(s.startTime).toDateString() === date.toDateString()
                        );
                        const isToday = date.toDateString() === new Date().toDateString();
                        
                        return (
                          <div key={date.toISOString()} className={`p-2 rounded border ${isToday ? 'bg-blue-50 border-blue-200 dark:bg-blue-950/30 dark:border-blue-800' : 'bg-muted/30'}`}>
                            <div className="flex items-center justify-between">
                              <div className="text-xs font-medium">
                                {date.toLocaleDateString('en-US', { weekday: 'short', month: 'numeric', day: 'numeric' })}
                                {isToday && <span className="ml-1 text-blue-600 dark:text-blue-400">(Today)</span>}
                              </div>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-6 px-2 text-xs"
                                onClick={() => {
                                  setSelectedEmployee(employee.id);
                                  setSelectedDate(date);
                                  setShowCreateShift(true);
                                }}
                              >
                                + Add
                              </Button>
                            </div>
                            
                            {daySchedules.length > 0 ? (
                              <div className="mt-1 space-y-1">
                                {daySchedules.map((schedule) => (
                                  <div key={schedule.id} className="text-xs p-2 bg-blue-100 dark:bg-blue-900/30 rounded border border-blue-200 dark:border-blue-800">
                                    <div className="font-medium">
                                      {formatTime(schedule.startTime)} - {formatTime(schedule.endTime)}
                                    </div>
                                    {schedule.title && (
                                      <div className="text-muted-foreground">{schedule.title}</div>
                                    )}
                                  </div>
                                ))}
                              </div>
                            ) : (
                              <div className="text-xs text-muted-foreground mt-1">No shifts</div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </Card>
                );
              })}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
