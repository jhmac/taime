import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import ScheduleConflictDetector from "@/components/ScheduleConflictDetector";
import ShiftTemplateManager from "@/components/ShiftTemplateManager";
import type { User, Schedule, WorkLocation } from "@shared/schema";

interface ShiftTemplate {
  id: string;
  name: string;
  startTime: string;
  endTime: string;
  color: string;
  defaultRole?: string;
}

const defaultShiftTemplates: ShiftTemplate[] = [
  { id: 'morning', name: 'Morning Shift', startTime: '08:00', endTime: '16:00', color: 'bg-blue-500' },
  { id: 'afternoon', name: 'Afternoon Shift', startTime: '14:00', endTime: '22:00', color: 'bg-green-500' },
  { id: 'evening', name: 'Evening Shift', startTime: '18:00', endTime: '02:00', color: 'bg-purple-500' },
  { id: 'split', name: 'Split Shift', startTime: '10:00', endTime: '14:00', color: 'bg-orange-500' },
];

const shiftColors = [
  'bg-blue-500', 'bg-green-500', 'bg-purple-500', 'bg-orange-500', 
  'bg-red-500', 'bg-pink-500', 'bg-indigo-500', 'bg-teal-500'
];

export default function ScheduleManagement() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [selectedWeek, setSelectedWeek] = useState(0);
  const [viewMode, setViewMode] = useState<'week' | 'employee' | 'role'>('week');
  const [showCreateShift, setShowCreateShift] = useState(false);
  const [selectedEmployee, setSelectedEmployee] = useState<string>('');
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());
  const [draggedShift, setDraggedShift] = useState<Schedule | null>(null);
  const [bulkSelectMode, setBulkSelectMode] = useState(false);
  const [selectedShifts, setSelectedShifts] = useState<Set<string>>(new Set());
  const [showConflicts, setShowConflicts] = useState(true);

  // Fetch data
  const { data: schedules = [], isLoading: schedulesLoading } = useQuery<Schedule[]>({
    queryKey: ["/api/schedules"],
  });

  const { data: users = [], isLoading: usersLoading } = useQuery<User[]>({
    queryKey: ["/api/users"],
  });

  const { data: locations = [] } = useQuery<WorkLocation[]>({
    queryKey: ["/api/work-locations"],
  });

  // Create schedule mutation
  const createScheduleMutation = useMutation({
    mutationFn: async (scheduleData: any) => {
      const response = await apiRequest("POST", "/api/schedules", scheduleData);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/schedules"] });
      setShowCreateShift(false);
      toast({
        title: "Success",
        description: "Shift created successfully",
      });
    },
    onError: (error) => {
      toast({
        title: "Error",
        description: `Failed to create shift: ${error.message}`,
        variant: "destructive",
      });
    },
  });

  // Update schedule mutation
  const updateScheduleMutation = useMutation({
    mutationFn: async ({ id, updates }: { id: string; updates: any }) => {
      const response = await apiRequest("PATCH", `/api/schedules/${id}`, updates);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/schedules"] });
      toast({
        title: "Success",
        description: "Shift updated successfully",
      });
    },
    onError: (error) => {
      toast({
        title: "Error",
        description: `Failed to update shift: ${error.message}`,
        variant: "destructive",
      });
    },
  });

  // Delete schedule mutation
  const deleteScheduleMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/schedules/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/schedules"] });
      toast({
        title: "Success",
        description: "Shift deleted successfully",
      });
    },
    onError: (error) => {
      toast({
        title: "Error",
        description: `Failed to delete shift: ${error.message}`,
        variant: "destructive",
      });
    },
  });

  // Helper functions
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

  const getSchedulesForDate = (date: Date) => {
    return schedules.filter((schedule) => {
      const scheduleDate = new Date(schedule.startTime);
      return scheduleDate.toDateString() === date.toDateString();
    });
  };

  const getSchedulesForEmployee = (userId: string, date: Date) => {
    return schedules.filter((schedule) => {
      const scheduleDate = new Date(schedule.startTime);
      return schedule.userId === userId && scheduleDate.toDateString() === date.toDateString();
    });
  };

  const formatWeekRange = (weekOffset: number) => {
    const dates = getWeekDates(weekOffset);
    const start = dates[0];
    const end = dates[6];
    
    return `${start.toLocaleDateString('en-US', { 
      month: 'short', 
      day: 'numeric' 
    })} - ${end.toLocaleDateString('en-US', { 
      month: 'short', 
      day: 'numeric',
      year: 'numeric'
    })}`;
  };

  const calculateShiftDuration = (startTime: string, endTime: string) => {
    const start = new Date(`2000-01-01T${startTime}`);
    const end = new Date(`2000-01-01T${endTime}`);
    if (end < start) end.setDate(end.getDate() + 1); // Handle overnight shifts
    return (end.getTime() - start.getTime()) / (1000 * 60 * 60);
  };

  const handleQuickCreateShift = (userId: string, date: Date, template: ShiftTemplate) => {
    const startDateTime = new Date(date);
    const [startHour, startMinute] = template.startTime.split(':');
    startDateTime.setHours(parseInt(startHour), parseInt(startMinute), 0, 0);

    const endDateTime = new Date(date);
    const [endHour, endMinute] = template.endTime.split(':');
    endDateTime.setHours(parseInt(endHour), parseInt(endMinute), 0, 0);
    
    // Handle overnight shifts
    if (endDateTime < startDateTime) {
      endDateTime.setDate(endDateTime.getDate() + 1);
    }

    createScheduleMutation.mutate({
      userId,
      startTime: startDateTime.toISOString(),
      endTime: endDateTime.toISOString(),
      title: template.name,
      locationId: locations[0]?.id || null,
    });
  };

  const handleCreateShift = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    
    const startDate = formData.get("startDate") as string;
    const startTime = formData.get("startTime") as string;
    const endDate = formData.get("endDate") as string;
    const endTime = formData.get("endTime") as string;
    
    const startDateTime = new Date(`${startDate}T${startTime}`);
    const endDateTime = new Date(`${endDate}T${endTime}`);

    createScheduleMutation.mutate({
      userId: formData.get("userId") as string,
      startTime: startDateTime.toISOString(),
      endTime: endDateTime.toISOString(),
      title: formData.get("title") as string,
      description: formData.get("description") as string,
      locationId: formData.get("locationId") as string || null,
      isRecurring: formData.get("isRecurring") === "on",
    });
  };

  const handleDragStart = (e: React.DragEvent, schedule: Schedule) => {
    setDraggedShift(schedule);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  };

  const handleDrop = (e: React.DragEvent, targetUserId: string, targetDate: Date) => {
    e.preventDefault();
    if (!draggedShift) return;

    const duration = new Date(draggedShift.endTime).getTime() - new Date(draggedShift.startTime).getTime();
    const newStartTime = new Date(targetDate);
    newStartTime.setHours(new Date(draggedShift.startTime).getHours(), new Date(draggedShift.startTime).getMinutes());
    const newEndTime = new Date(newStartTime.getTime() + duration);

    updateScheduleMutation.mutate({
      id: draggedShift.id,
      updates: {
        userId: targetUserId,
        startTime: newStartTime.toISOString(),
        endTime: newEndTime.toISOString(),
      },
    });

    setDraggedShift(null);
  };

  const weekDates = getWeekDates(selectedWeek);
  const activeEmployees = users.filter(user => user.isActive !== false); // Include users where isActive is true or undefined

  if (schedulesLoading || usersLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-4 space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Schedule Management</h1>
          <p className="text-muted-foreground">Create and manage team schedules</p>
        </div>
        
        <div className="flex items-center gap-2">
          <Button
            variant={bulkSelectMode ? "destructive" : "outline"}
            size="sm"
            onClick={() => {
              setBulkSelectMode(!bulkSelectMode);
              setSelectedShifts(new Set());
            }}
            data-testid="button-bulk-select"
          >
            <i className={`fas ${bulkSelectMode ? 'fa-times' : 'fa-check-square'} mr-1`}></i>
            {bulkSelectMode ? 'Cancel' : 'Bulk'}
          </Button>
          
          {bulkSelectMode && selectedShifts.size > 0 && (
            <Button
              variant="destructive"
              size="sm"
              onClick={() => {
                selectedShifts.forEach(shiftId => deleteScheduleMutation.mutate(shiftId));
                setSelectedShifts(new Set());
                setBulkSelectMode(false);
              }}
              data-testid="button-bulk-delete"
            >
              <i className="fas fa-trash mr-1"></i>
              Delete ({selectedShifts.size})
            </Button>
          )}
          
          <Dialog open={showCreateShift} onOpenChange={setShowCreateShift}>
            <DialogTrigger asChild>
              <Button data-testid="button-create-shift">
                <i className="fas fa-plus mr-2"></i>
                Create Shift
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-md" data-testid="dialog-create-shift">
              <DialogHeader>
                <DialogTitle>Create New Shift</DialogTitle>
              </DialogHeader>
              <form onSubmit={handleCreateShift} className="space-y-4">
                <div>
                  <Label htmlFor="userId">Employee</Label>
                  <Select name="userId" required>
                    <SelectTrigger data-testid="select-employee">
                      <SelectValue placeholder="Select employee" />
                    </SelectTrigger>
                    <SelectContent>
                      {activeEmployees.length === 0 ? (
                        <SelectItem value="" disabled>
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
                
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label htmlFor="startDate">Start Date</Label>
                    <Input
                      id="startDate"
                      name="startDate"
                      type="date"
                      required
                      defaultValue={selectedDate.toISOString().split('T')[0]}
                      data-testid="input-start-date"
                    />
                  </div>
                  <div>
                    <Label htmlFor="startTime">Start Time</Label>
                    <Input
                      id="startTime"
                      name="startTime"
                      type="time"
                      required
                      data-testid="input-start-time"
                    />
                  </div>
                </div>
                
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label htmlFor="endDate">End Date</Label>
                    <Input
                      id="endDate"
                      name="endDate"
                      type="date"
                      required
                      defaultValue={selectedDate.toISOString().split('T')[0]}
                      data-testid="input-end-date"
                    />
                  </div>
                  <div>
                    <Label htmlFor="endTime">End Time</Label>
                    <Input
                      id="endTime"
                      name="endTime"
                      type="time"
                      required
                      data-testid="input-end-time"
                    />
                  </div>
                </div>
                
                <div>
                  <Label htmlFor="title">Title</Label>
                  <Input
                    id="title"
                    name="title"
                    placeholder="e.g., Morning Shift"
                    data-testid="input-shift-title"
                  />
                </div>
                
                <div>
                  <Label htmlFor="locationId">Location</Label>
                  <Select name="locationId">
                    <SelectTrigger data-testid="select-location">
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
                  <Label htmlFor="description">Description</Label>
                  <Textarea
                    id="description"
                    name="description"
                    placeholder="Additional details..."
                    data-testid="textarea-description"
                  />
                </div>
                
                <div className="flex items-center space-x-2">
                  <Switch id="isRecurring" name="isRecurring" />
                  <Label htmlFor="isRecurring">Recurring shift</Label>
                </div>
                
                <div className="flex justify-end space-x-2">
                  <Button type="button" variant="outline" onClick={() => setShowCreateShift(false)}>
                    Cancel
                  </Button>
                  <Button type="submit" disabled={createScheduleMutation.isPending} data-testid="button-save-shift">
                    {createScheduleMutation.isPending ? "Creating..." : "Create Shift"}
                  </Button>
                </div>
              </form>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {/* View Controls */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <Tabs value={viewMode} onValueChange={(value) => setViewMode(value as any)} className="w-full sm:w-auto">
          <TabsList>
            <TabsTrigger value="week" data-testid="tab-week-view">Week</TabsTrigger>
            <TabsTrigger value="employee" data-testid="tab-employee-view">Employee</TabsTrigger>
            <TabsTrigger value="role" data-testid="tab-role-view">Role</TabsTrigger>
          </TabsList>
        </Tabs>
        
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setSelectedWeek(selectedWeek - 1)}
            data-testid="button-previous-week"
          >
            <i className="fas fa-chevron-left"></i>
          </Button>
          <span className="text-sm font-medium min-w-[140px] text-center" data-testid="text-week-range">
            {formatWeekRange(selectedWeek)}
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setSelectedWeek(selectedWeek + 1)}
            data-testid="button-next-week"
          >
            <i className="fas fa-chevron-right"></i>
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setSelectedWeek(0)}
            data-testid="button-current-week"
          >
            Today
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShowConflicts(!showConflicts)}
            data-testid="button-toggle-conflicts"
          >
            <i className={`fas fa-exclamation-triangle mr-1 ${showConflicts ? 'text-orange-500' : 'text-muted-foreground'}`}></i>
            Conflicts
          </Button>
        </div>
      </div>

      {/* Conflict Detection */}
      {showConflicts && (
        <ScheduleConflictDetector schedules={schedules} users={users} />
      )}

      {/* Shift Templates */}
      <ShiftTemplateManager
        templates={defaultShiftTemplates}
        onTemplateSelect={(template) => selectedEmployee && handleQuickCreateShift(selectedEmployee, selectedDate, template)}
        selectedEmployee={selectedEmployee}
      />

      {/* Schedule Grid */}
      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <div className="min-w-[800px] lg:min-w-0">
              {/* Header */}
              <div className="grid grid-cols-8 border-b bg-muted/50">
                <div className="p-2 lg:p-3 font-medium text-xs lg:text-sm sticky left-0 bg-muted/50 z-10">
                  Employee
                </div>
                {weekDates.map((date, index) => {
                  const isToday = date.toDateString() === new Date().toDateString();
                  return (
                    <div key={index} className={`p-2 lg:p-3 text-center border-l ${
                      isToday ? 'bg-blue-50 dark:bg-blue-950/20' : ''
                    }`}>
                      <div className="font-medium text-xs lg:text-sm">
                        {date.toLocaleDateString('en-US', { weekday: 'short' })}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {date.toLocaleDateString('en-US', { month: 'numeric', day: 'numeric' })}
                      </div>
                      {isToday && (
                        <div className="text-xs text-blue-600 dark:text-blue-400 font-medium">
                          Today
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Employee Rows */}
              {activeEmployees.map((employee) => {
                const weeklyHours = schedules
                  .filter(s => s.userId === employee.id && weekDates.some(d => 
                    new Date(s.startTime).toDateString() === d.toDateString()
                  ))
                  .reduce((total, schedule) => {
                    const duration = (new Date(schedule.endTime).getTime() - new Date(schedule.startTime).getTime()) / (1000 * 60 * 60);
                    return total + duration;
                  }, 0);
                
                return (
                  <div key={employee.id} className="grid grid-cols-8 border-b hover:bg-muted/30">
                    <div className="p-2 lg:p-3 border-r sticky left-0 bg-background z-10">
                      <div className="font-medium text-xs lg:text-sm">
                        {employee.firstName} {employee.lastName}
                      </div>
                      <div className="text-xs text-muted-foreground truncate">
                        {employee.email}
                      </div>
                      <div className={`text-xs mt-1 ${
                        weeklyHours > 40 ? 'text-orange-600 dark:text-orange-400 font-medium' : 'text-muted-foreground'
                      }`}>
                        {weeklyHours.toFixed(1)}h/week
                        {weeklyHours > 40 && ' ⚠️'}
                      </div>
                    </div>
                    {weekDates.map((date, dateIndex) => {
                      const daySchedules = getSchedulesForEmployee(employee.id, date);
                      const isToday = date.toDateString() === new Date().toDateString();
                      const isSelected = selectedEmployee === employee.id && selectedDate.toDateString() === date.toDateString();
                      
                      return (
                        <div
                          key={dateIndex}
                          className={`p-1 lg:p-2 border-l min-h-[80px] lg:min-h-[100px] cursor-pointer transition-colors ${
                            isToday ? 'bg-blue-50 dark:bg-blue-950/20' : ''
                          } ${
                            isSelected ? 'bg-primary/10 border-primary/50' : 'hover:bg-blue-50 dark:hover:bg-blue-950/20'
                          }`}
                          onClick={() => {
                            setSelectedEmployee(employee.id);
                            setSelectedDate(date);
                          }}
                          onDragOver={handleDragOver}
                          onDrop={(e) => handleDrop(e, employee.id, date)}
                          data-testid={`cell-${employee.id}-${dateIndex}`}
                        >
                        {daySchedules.map((schedule) => {
                          const startTime = new Date(schedule.startTime);
                          const endTime = new Date(schedule.endTime);
                          const duration = calculateShiftDuration(
                            startTime.toTimeString().slice(0, 5),
                            endTime.toTimeString().slice(0, 5)
                          );
                          
                          return (
                            <div
                              key={schedule.id}
                              className={`mb-1 p-2 rounded-md cursor-move group relative transition-colors ${
                                bulkSelectMode && selectedShifts.has(schedule.id)
                                  ? 'bg-primary/20 border-primary'
                                  : 'bg-blue-100 dark:bg-blue-900/40 border-blue-200 dark:border-blue-800'
                              } border`}
                              draggable={!bulkSelectMode}
                              onDragStart={(e) => !bulkSelectMode && handleDragStart(e, schedule)}
                              onClick={() => {
                                if (bulkSelectMode) {
                                  const newSelected = new Set(selectedShifts);
                                  if (newSelected.has(schedule.id)) {
                                    newSelected.delete(schedule.id);
                                  } else {
                                    newSelected.add(schedule.id);
                                  }
                                  setSelectedShifts(newSelected);
                                }
                              }}
                              data-testid={`shift-${schedule.id}`}
                            >
                              <div className="flex items-center justify-between">
                                <div className="flex-1 min-w-0">
                                  <div className="text-xs font-medium truncate">
                                    {schedule.title || 'Shift'}
                                  </div>
                                  <div className="text-xs text-muted-foreground">
                                    {startTime.toTimeString().slice(0, 5)} - {endTime.toTimeString().slice(0, 5)}
                                  </div>
                                  <div className="flex items-center gap-1 text-xs text-muted-foreground">
                                    <span>{duration}h</span>
                                    {schedule.isRecurring && (
                                      <i className="fas fa-repeat text-xs" title="Recurring shift"></i>
                                    )}
                                  </div>
                                </div>
                                <div className={`transition-opacity ${
                                  bulkSelectMode ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
                                }`}>
                                  {bulkSelectMode ? (
                                    <div className="h-6 w-6 flex items-center justify-center">
                                      <i className={`fas ${
                                        selectedShifts.has(schedule.id) ? 'fa-check-square text-primary' : 'fa-square text-muted-foreground'
                                      } text-sm`}></i>
                                    </div>
                                  ) : (
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      className="h-6 w-6 p-0 text-red-600 hover:text-red-700"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        deleteScheduleMutation.mutate(schedule.id);
                                      }}
                                      data-testid={`button-delete-${schedule.id}`}
                                    >
                                      <i className="fas fa-times text-xs"></i>
                                    </Button>
                                  )}
                                </div>
                              </div>
                            </div>
                          );
                        })}
                        
                        {/* Add Shift Button */}
                        {daySchedules.length === 0 && isSelected && (
                          <div className="flex items-center justify-center h-full">
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-8 w-8 p-0 text-muted-foreground hover:text-primary"
                              onClick={() => setShowCreateShift(true)}
                              data-testid={`button-add-shift-${employee.id}-${dateIndex}`}
                            >
                              <i className="fas fa-plus text-sm"></i>
                            </Button>
                          </div>
                        )}
                        
                        {/* Quick add indicator */}
                        {daySchedules.length === 0 && !isSelected && (
                          <div className="flex items-center justify-center h-full opacity-0 hover:opacity-100 transition-opacity">
                            <div className="text-xs text-muted-foreground">
                              Click to add
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                  </div>
                );
              })}
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}