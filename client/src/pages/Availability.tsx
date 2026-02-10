import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Clock, CalendarDays, Check, X, ChevronLeft, ChevronRight, Sparkles, Users, Settings } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useAuth } from "@/hooks/useAuth";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type TimeSlot = 'morning' | 'afternoon' | 'evening' | 'overnight';

const timeSlots: { value: TimeSlot; label: string; time: string }[] = [
  { value: 'morning', label: 'Morning', time: '6:00 AM - 12:00 PM' },
  { value: 'afternoon', label: 'Afternoon', time: '12:00 PM - 6:00 PM' },
  { value: 'evening', label: 'Evening', time: '6:00 PM - 12:00 AM' },
  { value: 'overnight', label: 'Overnight', time: '12:00 AM - 6:00 AM' },
];

// AI Schedule Creator Component
function AIScheduleCreator({ payrollPeriodId, onScheduleCreated }: { 
  payrollPeriodId: string; 
  onScheduleCreated: () => void;
}) {
  const { toast } = useToast();
  const [isOpen, setIsOpen] = useState(false);
  const [businessSettings, setBusinessSettings] = useState({
    dailyHours: 8,
    minimumStaffing: 2,
    peakHours: ['afternoon', 'evening'],
  });
  const [constraints, setConstraints] = useState({
    maxWeeklyHours: 40,
    overtimeThreshold: 8,
    minimumShiftLength: 4,
  });

  const createScheduleMutation = useMutation({
    mutationFn: async (data: any) => {
      const response = await fetch('/api/schedules/create-from-availability', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      if (!response.ok) throw new Error('Failed to create schedule');
      return response.json();
    },
    onSuccess: (result) => {
      toast({
        title: "Schedule Created Successfully!",
        description: `Generated ${result.scheduleCreated} schedule entries with AI insights.`,
      });
      setIsOpen(false);
      onScheduleCreated();
      
      // Show insights in a second toast
      if (result.insights && result.insights.length > 0) {
        setTimeout(() => {
          toast({
            title: "AI Insights",
            description: result.insights[0],
            duration: 5000,
          });
        }, 1000);
      }
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to create schedule. Please try again.",
        variant: "destructive",
      });
    },
  });

  const handleCreateSchedule = () => {
    createScheduleMutation.mutate({
      payrollPeriodId,
      businessHours: businessSettings,
      constraints,
    });
  };

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger asChild>
        <Button className="w-full" data-testid="create-ai-schedule">
          <Sparkles className="h-4 w-4 mr-2" />
          Create AI Schedule
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-sm mx-auto max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-sm">AI Schedule Creation</DialogTitle>
          <DialogDescription className="text-xs">
            Configure business requirements and let AI create an optimized schedule.
          </DialogDescription>
        </DialogHeader>
        
        <div className="space-y-3">
          <div>
            <Label htmlFor="dailyHours" className="text-xs">Daily Operating Hours</Label>
            <Input
              id="dailyHours"
              type="number"
              className="h-8 text-sm"
              value={businessSettings.dailyHours}
              onChange={(e) => setBusinessSettings(prev => ({ 
                ...prev, 
                dailyHours: parseInt(e.target.value) || 8 
              }))}
            />
          </div>
          
          <div>
            <Label htmlFor="minimumStaffing" className="text-xs">Minimum Staffing</Label>
            <Input
              id="minimumStaffing"
              type="number"
              className="h-8 text-sm"
              value={businessSettings.minimumStaffing}
              onChange={(e) => setBusinessSettings(prev => ({ 
                ...prev, 
                minimumStaffing: parseInt(e.target.value) || 2 
              }))}
            />
          </div>
          
          <div>
            <Label htmlFor="maxWeeklyHours" className="text-xs">Max Weekly Hours per Employee</Label>
            <Input
              id="maxWeeklyHours"
              type="number"
              className="h-8 text-sm"
              value={constraints.maxWeeklyHours}
              onChange={(e) => setConstraints(prev => ({ 
                ...prev, 
                maxWeeklyHours: parseInt(e.target.value) || 40 
              }))}
            />
          </div>
          
          <div>
            <Label htmlFor="overtimeThreshold" className="text-xs">Overtime Threshold (daily)</Label>
            <Input
              id="overtimeThreshold"
              type="number"
              className="h-8 text-sm"
              value={constraints.overtimeThreshold}
              onChange={(e) => setConstraints(prev => ({ 
                ...prev, 
                overtimeThreshold: parseInt(e.target.value) || 8 
              }))}
            />
          </div>

          <Button 
            onClick={handleCreateSchedule}
            disabled={createScheduleMutation.isPending}
            className="w-full h-8 text-sm mt-4"
            data-testid="confirm-create-schedule"
          >
            {createScheduleMutation.isPending ? (
              <>Creating...</>
            ) : (
              <>
                <Sparkles className="h-3 w-3 mr-1" />
                Generate
              </>
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default function Availability() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [selectedPeriodId, setSelectedPeriodId] = useState<string>("");
  const [selectedWeek, setSelectedWeek] = useState(new Date());
  const [availabilityData, setAvailabilityData] = useState<Record<string, boolean>>({});

  // Get next payroll period
  const { data: payrollPeriods = [] } = useQuery({
    queryKey: ['/api/payroll/periods'],
  });

  const nextPeriod = Array.isArray(payrollPeriods) ? payrollPeriods.find((period: any) => !period.isProcessed) : null;

  // Set the selected period to the next unprocessed period
  useEffect(() => {
    if (nextPeriod && !selectedPeriodId) {
      setSelectedPeriodId(nextPeriod.id);
    }
  }, [nextPeriod, selectedPeriodId]);

  // Get user's current availability
  const { data: currentAvailability = [] } = useQuery({
    queryKey: ['/api/availability', selectedPeriodId],
    enabled: !!selectedPeriodId,
  });

  // Convert availability data to a more usable format
  useEffect(() => {
    const availMap: Record<string, boolean> = {};
    if (Array.isArray(currentAvailability)) {
      currentAvailability.forEach((avail: any) => {
        const key = `${avail.date.split('T')[0]}-${avail.timeSlot}`;
        availMap[key] = avail.isAvailable;
      });
    }
    setAvailabilityData(availMap);
  }, [currentAvailability]);

  // Submit availability mutation
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
      toast({
        title: "Success",
        description: "Your availability has been saved!",
      });
      queryClient.invalidateQueries({ queryKey: ['/api/availability'] });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to save availability. Please try again.",
        variant: "destructive",
      });
    },
  });

  const getWeekDates = (startDate: Date) => {
    const dates = [];
    const start = new Date(startDate);
    start.setDate(start.getDate() - start.getDay()); // Start from Sunday
    
    for (let i = 0; i < 7; i++) {
      const date = new Date(start);
      date.setDate(start.getDate() + i);
      dates.push(date);
    }
    return dates;
  };

  const toggleAvailability = (date: Date, timeSlot: TimeSlot) => {
    const dateStr = date.toISOString().split('T')[0];
    const key = `${dateStr}-${timeSlot}`;
    const newValue = !availabilityData[key];
    
    setAvailabilityData(prev => ({
      ...prev,
      [key]: newValue,
    }));
  };

  const handleSubmit = () => {
    if (!selectedPeriodId) return;

    const availability = Object.entries(availabilityData).map(([key, isAvailable]) => {
      const [dateStr, timeSlot] = key.split('-');
      return {
        payrollPeriodId: selectedPeriodId,
        date: new Date(dateStr + 'T12:00:00Z'),
        timeSlot,
        isAvailable,
      };
    });

    submitAvailabilityMutation.mutate(availability);
  };

  const isDateInPeriod = (date: Date) => {
    if (!nextPeriod) return false;
    const dateStr = date.toISOString().split('T')[0];
    const startStr = nextPeriod.startDate.split('T')[0];
    const endStr = nextPeriod.endDate.split('T')[0];
    return dateStr >= startStr && dateStr <= endStr;
  };

  const weekDates = getWeekDates(selectedWeek);

  const goToPreviousWeek = () => {
    const newDate = new Date(selectedWeek);
    newDate.setDate(newDate.getDate() - 7);
    setSelectedWeek(newDate);
  };

  const goToNextWeek = () => {
    const newDate = new Date(selectedWeek);
    newDate.setDate(newDate.getDate() + 7);
    setSelectedWeek(newDate);
  };

  if (!nextPeriod) {
    return (
      <div className="min-h-screen bg-background p-4 md:p-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Clock className="h-5 w-5" />
              Availability Calendar
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-muted-foreground">No upcoming payroll periods available for scheduling.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background p-4 md:p-6">
      <div className="space-y-6">
        {/* Week Navigation */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <Button variant="outline" size="sm" onClick={goToPreviousWeek}>
                <ChevronLeft className="h-4 w-4" />
                Previous Week
              </Button>
              <h3 className="font-medium">
                Week of {weekDates[0].toLocaleDateString()}
              </h3>
              <Button variant="outline" size="sm" onClick={goToNextWeek}>
                Next Week
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {/* Day Headers */}
            <div className="grid grid-cols-7 gap-1 mb-4">
              {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day) => (
                <div key={day} className="text-center font-medium p-2 text-sm">
                  {day}
                </div>
              ))}
            </div>

            {/* Date Headers */}
            <div className="grid grid-cols-7 gap-1 mb-4">
              {weekDates.map((date) => (
                <div key={date.toISOString()} className="text-center p-2">
                  <div className={`text-sm ${!isDateInPeriod(date) ? 'text-muted-foreground' : ''}`}>
                    {date.getDate()}
                  </div>
                  {!isDateInPeriod(date) && (
                    <div className="text-xs text-muted-foreground">Outside period</div>
                  )}
                </div>
              ))}
            </div>

            {/* Time Slots Grid */}
            <div className="space-y-3">
              {timeSlots.map((slot) => (
                <div key={slot.value} className="space-y-2">
                  <div className="text-sm font-medium flex items-center gap-2">
                    <Badge variant="outline">{slot.label}</Badge>
                    <span className="text-xs text-muted-foreground">{slot.time}</span>
                  </div>
                  <div className="grid grid-cols-7 gap-1">
                    {weekDates.map((date) => {
                      const dateStr = date.toISOString().split('T')[0];
                      const key = `${dateStr}-${slot.value}`;
                      const isAvailable = availabilityData[key] ?? false;
                      const isInPeriod = isDateInPeriod(date);

                      return (
                        <Button
                          key={key}
                          variant={isAvailable ? "default" : "outline"}
                          size="sm"
                          disabled={!isInPeriod}
                          onClick={() => toggleAvailability(date, slot.value)}
                          className={`h-8 ${isAvailable ? 'bg-green-600 hover:bg-green-700' : 'bg-red-100 hover:bg-red-200 text-red-800'}`}
                          data-testid={`availability-${dateStr}-${slot.value}`}
                        >
                          {isAvailable ? <Check className="h-3 w-3" /> : <X className="h-3 w-3" />}
                        </Button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>

            {/* Submit Button */}
            <div className="mt-6 flex justify-center">
              <Button 
                onClick={handleSubmit}
                disabled={submitAvailabilityMutation.isPending}
                className="w-full"
                data-testid="submit-availability"
              >
                {submitAvailabilityMutation.isPending ? "Saving..." : "Save Availability"}
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* AI Schedule Creation (Manager Only) */}
        {user?.roleId === 'manager' || user?.roleId === 'admin' ? (
          <Card>
            <CardHeader>
              <CardTitle className="text-sm flex items-center gap-2">
                🤖 AI Schedule Creation
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <p className="text-sm text-muted-foreground">
                  Generate an optimized schedule based on employee availability for this payroll period.
                </p>
                <AIScheduleCreator 
                  payrollPeriodId={selectedPeriodId} 
                  onScheduleCreated={() => {
                    toast({
                      title: "Schedule Created!",
                      description: "AI has generated an optimized schedule based on availability.",
                    });
                  }}
                />
              </div>
            </CardContent>
          </Card>
        ) : null}

        {/* Legend */}
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Legend</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-4 text-sm">
              <div className="flex items-center gap-2">
                <div className="w-4 h-4 bg-green-600 rounded flex items-center justify-center">
                  <Check className="h-3 w-3 text-white" />
                </div>
                <span>Available</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-4 h-4 bg-red-100 rounded flex items-center justify-center">
                  <X className="h-3 w-3 text-red-800" />
                </div>
                <span>Not Available</span>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}