import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import TimeClockWidget from '@/components/TimeClockWidget';
import ScheduleModal from '@/components/ScheduleModal';
import { useAuth } from '@/hooks/useAuth';
import type { TimeEntry, Schedule, Permission } from '@shared/schema';

export default function Operations() {
  const [showScheduleModal, setShowScheduleModal] = useState(false);
  const [currentTime, setCurrentTime] = useState(new Date());
  const { user } = useAuth();

  // Fetch user permissions
  const { data: userPermissions = [] } = useQuery<Permission[]>({
    queryKey: ["/api/auth/permissions"],
    enabled: !!user,
  });

  // Check permissions
  const canAccessOperations = userPermissions?.some?.(p => p.name === 'admin.manage_all' || p.name === 'operations.view') || false;

  const { data: timeEntries, isLoading: timeEntriesLoading } = useQuery<TimeEntry[]>({
    queryKey: ['/api/time-entries'],
  });

  const { data: schedules, isLoading: schedulesLoading } = useQuery<Schedule[]>({
    queryKey: ['/api/schedules'],
  });

  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentTime(new Date());
    }, 1000);

    return () => clearInterval(timer);
  }, []);

  const today = new Date();
  const startOfWeek = new Date(today);
  startOfWeek.setDate(today.getDate() - today.getDay());

  const thisWeekEntries = timeEntries?.filter((entry: any) => {
    const entryDate = new Date(entry.clockInTime);
    return entryDate >= startOfWeek;
  }) || [];

  const totalHoursThisWeek = thisWeekEntries.reduce((total: number, entry: any) => {
    if (entry.clockOutTime) {
      const clockIn = new Date(entry.clockInTime);
      const clockOut = new Date(entry.clockOutTime);
      const hours = (clockOut.getTime() - clockIn.getTime()) / (1000 * 60 * 60);
      const breakHours = (entry.breakMinutes || 0) / 60;
      return total + (hours - breakHours);
    }
    return total;
  }, 0);

  if (!canAccessOperations) {
    return (
      <div className="min-h-screen bg-background p-4">
        <div className="space-y-4 max-w-sm mx-auto">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Access Denied</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">
                You need operations management permissions to view this page.
              </p>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="bg-primary text-primary-foreground p-4">
        <h1 className="text-xl font-bold">Operations Hub</h1>
        <p className="text-sm opacity-80">Time tracking & scheduling</p>
      </header>

      <div className="p-4 space-y-4">
        {/* Time Clock */}
        <TimeClockWidget />

        {/* Tabs for different operations views */}
        <Tabs defaultValue="timesheets" className="w-full">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="timesheets">Timesheets</TabsTrigger>
            <TabsTrigger value="schedules">Schedules</TabsTrigger>
            <TabsTrigger value="analytics">Analytics</TabsTrigger>
          </TabsList>

          <TabsContent value="timesheets" className="space-y-4">
            {/* Weekly Summary */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">This Week's Summary</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <p className="text-muted-foreground">Total Hours</p>
                    <p className="text-2xl font-bold">{totalHoursThisWeek.toFixed(1)}h</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Days Worked</p>
                    <p className="text-2xl font-bold">{thisWeekEntries.length}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Overtime</p>
                    <p className="text-2xl font-bold text-orange-600">
                      {Math.max(0, totalHoursThisWeek - 40).toFixed(1)}h
                    </p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Status</p>
                    <p className="text-sm font-medium text-green-600">On Track</p>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Recent Time Entries */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Recent Time Entries</CardTitle>
              </CardHeader>
              <CardContent>
                {timeEntriesLoading ? (
                  <div className="space-y-2">
                    {[...Array(3)].map((_, i) => (
                      <div key={i} className="animate-pulse h-16 bg-muted rounded-lg"></div>
                    ))}
                  </div>
                ) : thisWeekEntries.length === 0 ? (
                  <p className="text-muted-foreground text-center py-4">
                    No time entries yet this week
                  </p>
                ) : (
                  <div className="space-y-3">
                    {thisWeekEntries.slice(0, 5).map((entry: any) => (
                      <div key={entry.id} className="flex items-center justify-between p-3 bg-muted/50 rounded-lg">
                        <div>
                          <p className="font-medium text-sm">
                            {new Date(entry.clockInTime).toLocaleDateString('en-US', {
                              weekday: 'short',
                              month: 'short',
                              day: 'numeric',
                            })}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {new Date(entry.clockInTime).toLocaleTimeString('en-US', {
                              hour: 'numeric',
                              minute: '2-digit',
                              hour12: true,
                            })}
                            {entry.clockOutTime && (
                              <>
                                {' - '}
                                {new Date(entry.clockOutTime).toLocaleTimeString('en-US', {
                                  hour: 'numeric',
                                  minute: '2-digit',
                                  hour12: true,
                                })}
                              </>
                            )}
                          </p>
                        </div>
                        <div className="text-right">
                          {entry.clockOutTime ? (
                            <p className="font-medium text-sm">
                              {(() => {
                                const clockIn = new Date(entry.clockInTime);
                                const clockOut = new Date(entry.clockOutTime);
                                const hours = (clockOut.getTime() - clockIn.getTime()) / (1000 * 60 * 60);
                                const breakHours = (entry.breakMinutes || 0) / 60;
                                return `${(hours - breakHours).toFixed(1)}h`;
                              })()}
                            </p>
                          ) : (
                            <span className="text-xs bg-green-100 text-green-800 px-2 py-1 rounded-full">
                              Active
                            </span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="schedules" className="space-y-4">
            {/* Schedule Overview */}
            <div className="flex items-center justify-between">
              <h3 className="font-semibold">Your Schedule</h3>
              <Button
                onClick={() => setShowScheduleModal(true)}
                size="sm"
                data-testid="view-full-schedule"
              >
                View Full Schedule
              </Button>
            </div>

            {schedulesLoading ? (
              <div className="space-y-2">
                {[...Array(3)].map((_, i) => (
                  <div key={i} className="animate-pulse h-20 bg-muted rounded-lg"></div>
                ))}
              </div>
            ) : (
              <div className="space-y-3">
                {schedules?.slice(0, 5).map((schedule: any) => (
                  <Card key={schedule.id}>
                    <CardContent className="p-4">
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="font-medium text-sm">
                            {schedule.title || 'Shift'}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {new Date(schedule.startTime).toLocaleDateString('en-US', {
                              weekday: 'long',
                              month: 'short',
                              day: 'numeric',
                            })}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {new Date(schedule.startTime).toLocaleTimeString('en-US', {
                              hour: 'numeric',
                              minute: '2-digit',
                              hour12: true,
                            })}
                            {' - '}
                            {new Date(schedule.endTime).toLocaleTimeString('en-US', {
                              hour: 'numeric',
                              minute: '2-digit',
                              hour12: true,
                            })}
                          </p>
                        </div>
                        <div>
                          {(() => {
                            const now = new Date();
                            const start = new Date(schedule.startTime);
                            const end = new Date(schedule.endTime);
                            
                            if (now >= start && now <= end) {
                              return (
                                <span className="text-xs bg-green-100 text-green-800 px-2 py-1 rounded-full">
                                  Active
                                </span>
                              );
                            } else if (now < start) {
                              return (
                                <span className="text-xs bg-blue-100 text-blue-800 px-2 py-1 rounded-full">
                                  Scheduled
                                </span>
                              );
                            } else {
                              return (
                                <span className="text-xs bg-gray-100 text-gray-800 px-2 py-1 rounded-full">
                                  Completed
                                </span>
                              );
                            }
                          })()}
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </TabsContent>

          <TabsContent value="analytics" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Performance Analytics</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="text-center">
                      <p className="text-2xl font-bold text-green-600">95%</p>
                      <p className="text-xs text-muted-foreground">On-time Rate</p>
                    </div>
                    <div className="text-center">
                      <p className="text-2xl font-bold text-blue-600">8.2h</p>
                      <p className="text-xs text-muted-foreground">Avg Daily Hours</p>
                    </div>
                  </div>
                  
                  <div className="space-y-2">
                    <div className="flex justify-between text-sm">
                      <span>Weekly Target</span>
                      <span>{totalHoursThisWeek.toFixed(1)}/40 hours</span>
                    </div>
                    <div className="w-full bg-muted rounded-full h-2">
                      <div 
                        className="bg-primary rounded-full h-2 transition-all duration-300"
                        style={{ width: `${Math.min(100, (totalHoursThisWeek / 40) * 100)}%` }}
                      ></div>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>

      {/* Schedule Modal */}
      <ScheduleModal
        isOpen={showScheduleModal}
        onClose={() => setShowScheduleModal(false)}
      />
    </div>
  );
}
