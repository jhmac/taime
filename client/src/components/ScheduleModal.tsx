import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/hooks/useAuth';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

interface ScheduleModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function ScheduleModal({ isOpen, onClose }: ScheduleModalProps) {
  const { user } = useAuth();
  const [selectedWeek, setSelectedWeek] = useState(0); // 0 = this week, 1 = next week, etc.

  const { data: schedules, isLoading } = useQuery({
    queryKey: ['/api/schedules'],
    enabled: isOpen,
  });

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

  const getSchedulesForWeek = (weekOffset: number) => {
    const weekDates = getWeekDates(weekOffset);
    const startOfWeek = weekDates[0];
    const endOfWeek = weekDates[6];
    
    return schedules?.filter((schedule: any) => {
      const scheduleDate = new Date(schedule.startTime);
      return scheduleDate >= startOfWeek && scheduleDate <= endOfWeek;
    }) || [];
  };

  const getSchedulesForDate = (date: Date, weekSchedules: any[]) => {
    return weekSchedules.filter((schedule: any) => {
      const scheduleDate = new Date(schedule.startTime);
      return scheduleDate.toDateString() === date.toDateString();
    });
  };

  const getScheduleStatus = (schedule: any) => {
    const now = new Date();
    const start = new Date(schedule.startTime);
    const end = new Date(schedule.endTime);

    if (now >= start && now <= end) {
      return { label: 'Active', color: 'bg-green-100 text-green-800' };
    } else if (now < start) {
      return { label: 'Scheduled', color: 'bg-blue-100 text-blue-800' };
    } else {
      return { label: 'Completed', color: 'bg-gray-100 text-gray-800' };
    }
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

  const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

  const weekSchedules = getSchedulesForWeek(selectedWeek);
  const totalHoursThisWeek = weekSchedules.reduce((total, schedule) => {
    const duration = (new Date(schedule.endTime).getTime() - new Date(schedule.startTime).getTime()) / (1000 * 60 * 60);
    return total + duration;
  }, 0);

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-md mx-auto max-h-[90vh] overflow-y-auto" data-testid="schedule-modal">
        <DialogHeader>
          <DialogTitle className="flex items-center">
            <i className="fas fa-calendar-alt text-primary mr-2"></i>
            Schedule Overview
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Week Navigation */}
          <div className="flex items-center justify-between">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setSelectedWeek(Math.max(-1, selectedWeek - 1))}
              disabled={selectedWeek <= -1}
              data-testid="previous-week"
            >
              <i className="fas fa-chevron-left"></i>
            </Button>
            
            <div className="text-center">
              <p className="font-medium text-sm">{formatWeekRange(selectedWeek)}</p>
              <p className="text-xs text-muted-foreground">
                {selectedWeek === 0 ? 'This Week' : selectedWeek === 1 ? 'Next Week' : selectedWeek > 1 ? `${selectedWeek} weeks ahead` : 'Last Week'}
              </p>
            </div>
            
            <Button
              variant="outline"
              size="sm"
              onClick={() => setSelectedWeek(selectedWeek + 1)}
              disabled={selectedWeek >= 4}
              data-testid="next-week"
            >
              <i className="fas fa-chevron-right"></i>
            </Button>
          </div>

          {/* Week Summary */}
          <Card>
            <CardContent className="p-4">
              <div className="grid grid-cols-3 gap-4 text-center">
                <div>
                  <p className="text-lg font-bold text-primary">{weekSchedules.length}</p>
                  <p className="text-xs text-muted-foreground">Shifts</p>
                </div>
                <div>
                  <p className="text-lg font-bold text-primary">{totalHoursThisWeek.toFixed(1)}h</p>
                  <p className="text-xs text-muted-foreground">Total Hours</p>
                </div>
                <div>
                  <p className="text-lg font-bold text-primary">
                    {weekSchedules.filter(s => getScheduleStatus(s).label === 'Active').length}
                  </p>
                  <p className="text-xs text-muted-foreground">Active Now</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Tabs defaultValue="week" className="w-full">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="week">Week View</TabsTrigger>
              <TabsTrigger value="list">List View</TabsTrigger>
            </TabsList>

            <TabsContent value="week" className="space-y-3">
              {isLoading ? (
                <div className="space-y-2">
                  {[...Array(7)].map((_, i) => (
                    <div key={i} className="animate-pulse h-16 bg-muted rounded-lg"></div>
                  ))}
                </div>
              ) : (
                <div className="space-y-2">
                  {getWeekDates(selectedWeek).map((date, index) => {
                    const daySchedules = getSchedulesForDate(date, weekSchedules);
                    const isToday = date.toDateString() === new Date().toDateString();
                    
                    return (
                      <Card key={index} className={isToday ? 'border-primary' : ''}>
                        <CardContent className="p-3">
                          <div className="flex items-center justify-between mb-2">
                            <div className="flex items-center space-x-2">
                              <p className={`font-medium text-sm ${isToday ? 'text-primary' : ''}`}>
                                {dayNames[index]}
                              </p>
                              <p className="text-xs text-muted-foreground">
                                {date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                              </p>
                              {isToday && (
                                <Badge className="bg-primary/10 text-primary">Today</Badge>
                              )}
                            </div>
                            {daySchedules.length > 0 && (
                              <Badge variant="outline" className="text-xs">
                                {daySchedules.length} shift{daySchedules.length !== 1 ? 's' : ''}
                              </Badge>
                            )}
                          </div>
                          
                          {daySchedules.length === 0 ? (
                            <p className="text-xs text-muted-foreground">No shifts scheduled</p>
                          ) : (
                            <div className="space-y-2">
                              {daySchedules.map((schedule: any) => {
                                const status = getScheduleStatus(schedule);
                                return (
                                  <div key={schedule.id} className="flex items-center justify-between p-2 bg-muted/30 rounded-lg">
                                    <div>
                                      <p className="text-sm font-medium">{schedule.title || 'Shift'}</p>
                                      <p className="text-xs text-muted-foreground">
                                        {new Date(schedule.startTime).toLocaleTimeString('en-US', { 
                                          hour: 'numeric', 
                                          minute: '2-digit',
                                          hour12: true 
                                        })} - {new Date(schedule.endTime).toLocaleTimeString('en-US', { 
                                          hour: 'numeric', 
                                          minute: '2-digit',
                                          hour12: true 
                                        })}
                                      </p>
                                    </div>
                                    <span className={`text-xs px-2 py-1 rounded-full ${status.color}`}>
                                      {status.label}
                                    </span>
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </CardContent>
                      </Card>
                    );
                  })}
                </div>
              )}
            </TabsContent>

            <TabsContent value="list" className="space-y-3">
              {isLoading ? (
                <div className="space-y-2">
                  {[...Array(5)].map((_, i) => (
                    <div key={i} className="animate-pulse h-16 bg-muted rounded-lg"></div>
                  ))}
                </div>
              ) : weekSchedules.length === 0 ? (
                <div className="text-center py-8">
                  <i className="fas fa-calendar-times text-muted-foreground text-2xl mb-2"></i>
                  <p className="text-muted-foreground">No shifts scheduled for this week</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {weekSchedules
                    .sort((a: any, b: any) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime())
                    .map((schedule: any) => {
                      const status = getScheduleStatus(schedule);
                      const startDate = new Date(schedule.startTime);
                      const endDate = new Date(schedule.endTime);
                      const duration = (endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60);
                      
                      return (
                        <Card key={schedule.id}>
                          <CardContent className="p-3">
                            <div className="flex items-center justify-between mb-2">
                              <div>
                                <p className="font-medium text-sm">{schedule.title || 'Shift'}</p>
                                <p className="text-xs text-muted-foreground">
                                  {startDate.toLocaleDateString('en-US', { 
                                    weekday: 'short',
                                    month: 'short', 
                                    day: 'numeric' 
                                  })}
                                </p>
                              </div>
                              <span className={`text-xs px-2 py-1 rounded-full ${status.color}`}>
                                {status.label}
                              </span>
                            </div>
                            
                            <div className="flex items-center justify-between">
                              <p className="text-sm text-muted-foreground">
                                {startDate.toLocaleTimeString('en-US', { 
                                  hour: 'numeric', 
                                  minute: '2-digit',
                                  hour12: true 
                                })} - {endDate.toLocaleTimeString('en-US', { 
                                  hour: 'numeric', 
                                  minute: '2-digit',
                                  hour12: true 
                                })}
                              </p>
                              <Badge variant="outline" className="text-xs">
                                {duration.toFixed(1)}h
                              </Badge>
                            </div>
                            
                            {schedule.description && (
                              <p className="text-xs text-muted-foreground mt-2">{schedule.description}</p>
                            )}
                          </CardContent>
                        </Card>
                      );
                    })}
                </div>
              )}
            </TabsContent>
          </Tabs>
        </div>
      </DialogContent>
    </Dialog>
  );
}
