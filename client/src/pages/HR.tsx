import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/hooks/useAuth';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import PayrollModal from '@/components/PayrollModal';
import type { Permission, TimeEntry, Task, Schedule, User } from '@shared/schema';

export default function HR() {
  const { user } = useAuth();
  const [showPayrollModal, setShowPayrollModal] = useState(false);
  const [liveNow, setLiveNow] = useState(() => new Date());

  // Tick every minute to keep elapsed durations live
  useEffect(() => {
    const interval = setInterval(() => setLiveNow(new Date()), 60_000);
    return () => clearInterval(interval);
  }, []);

  // Fetch user permissions
  const { data: userPermissions = [] } = useQuery<Permission[]>({
    queryKey: ["/api/auth/permissions"],
    enabled: !!user,
  });

  const isAdmin = user?.role?.name === 'owner' || user?.role?.name === 'admin';
  const isManagerOrAdmin = isAdmin || user?.role?.name === 'manager';
  const canManageEmployees = isAdmin || userPermissions?.some?.(p => p.name === 'hr.edit_team' || p.name === 'hr.view_team' || p.name === 'admin.manage_all') || false;

  // Fetch time entries
  const { data: timeEntries = [], isLoading: timeEntriesLoading } = useQuery<TimeEntry[]>({
    queryKey: ['/api/time-entries'],
  });

  // Fetch users for Live Team panel (only needed for admins/managers)
  const { data: users = [] } = useQuery<User[]>({
    queryKey: ['/api/users'],
    enabled: isManagerOrAdmin,
  });

  // Fetch tasks
  const { data: tasks = [], isLoading: tasksLoading } = useQuery<Task[]>({
    queryKey: ['/api/tasks'],
  });

  // Fetch schedules
  const { data: schedules = [], isLoading: schedulesLoading } = useQuery<Schedule[]>({
    queryKey: ['/api/schedules'],
  });

  // Calculate week start and end dates
  const today = new Date();
  const startOfWeek = new Date(today);
  startOfWeek.setDate(today.getDate() - today.getDay());
  
  const endOfWeek = new Date(startOfWeek);
  endOfWeek.setDate(startOfWeek.getDate() + 6);
  endOfWeek.setHours(23, 59, 59, 999);

  // Get this week's entries
  const thisWeekEntries = timeEntries?.filter((entry: TimeEntry) => {
    const entryDate = new Date(entry.clockInTime);
    return entryDate >= startOfWeek && entryDate <= endOfWeek;
  }) || [];

  // Calculate total hours this week (active sessions use now as end time)
  const totalHoursThisWeek = thisWeekEntries.reduce((total: number, entry: TimeEntry) => {
    const clockIn = new Date(entry.clockInTime);
    const clockOut = entry.clockOutTime ? new Date(entry.clockOutTime) : liveNow;
    const hours = (clockOut.getTime() - clockIn.getTime()) / (1000 * 60 * 60);
    const breakHours = (entry.breakMinutes || 0) / 60;
    return total + Math.max(0, hours - breakHours);
  }, 0);

  // Live Team: employees currently clocked in (open entries from today)
  const todayStart = new Date(liveNow);
  todayStart.setHours(0, 0, 0, 0);
  const liveEntries = (timeEntries as TimeEntry[]).filter((entry: TimeEntry) => {
    if (entry.clockOutTime) return false;
    const clockIn = new Date(entry.clockInTime);
    return clockIn >= todayStart;
  });

  const formatElapsed = (clockInTime: string | Date) => {
    const start = new Date(clockInTime);
    const diffMs = liveNow.getTime() - start.getTime();
    const totalMins = Math.max(0, Math.floor(diffMs / 60_000));
    const h = Math.floor(totalMins / 60);
    const m = totalMins % 60;
    if (h === 0) return `${m}m`;
    return `${h}h ${m}m`;
  };

  const getUserName = (userId: string) => {
    const found = users.find((u: User) => u.id === userId);
    if (!found) return 'Unknown';
    return `${found.firstName || ''} ${found.lastName || ''}`.trim() || found.username || 'Unknown';
  };

  // Calculate attendance rate
  const userSchedulesThisWeek = schedules.filter((schedule: Schedule) => {
    if (schedule.userId !== user?.id) return false;
    const scheduleDate = new Date(schedule.startTime);
    return scheduleDate >= startOfWeek && scheduleDate <= endOfWeek;
  });

  const daysWithClockIn = new Set(
    thisWeekEntries.map((entry: TimeEntry) => {
      const date = new Date(entry.clockInTime);
      return date.toDateString();
    })
  ).size;

  const attendanceRate = userSchedulesThisWeek.length > 0
    ? (daysWithClockIn / userSchedulesThisWeek.length) * 100
    : totalHoursThisWeek > 0 ? 100 : 0;

  // Calculate task completion rate
  const userTasks = tasks.filter((task: Task) => task.assignedTo === user?.id) || [];
  const completedTasks = userTasks.filter((task: Task) => task.status === 'completed').length;
  const taskCompletionRate = userTasks.length > 0
    ? (completedTasks / userTasks.length) * 100
    : 0;

  // Calculate punctuality score (based on clock-in times)
  let punctualityScore = 0;
  if (thisWeekEntries.length > 0) {
    const onTimeCount = thisWeekEntries.filter((entry: TimeEntry) => {
      const clockInTime = new Date(entry.clockInTime);
      // Assume 8 AM is on-time
      return clockInTime.getHours() <= 8 || (clockInTime.getHours() === 8 && clockInTime.getMinutes() <= 30);
    }).length;
    punctualityScore = (onTimeCount / thisWeekEntries.length) * 100;
  }

  // Calculate performance score (average of attendance, task completion, and punctuality)
  const performanceScore = thisWeekEntries.length > 0 || userTasks.length > 0
    ? ((attendanceRate + taskCompletionRate + punctualityScore) / 3) / 20
    : 0;

  // Format week range
  const formatWeekRange = () => {
    const startMonth = startOfWeek.toLocaleString('en-US', { month: 'short' });
    const startDay = startOfWeek.getDate();
    const endMonth = endOfWeek.toLocaleString('en-US', { month: 'short' });
    const endDay = endOfWeek.getDate();
    const year = startOfWeek.getFullYear();
    
    if (startMonth === endMonth) {
      return `Week of ${startMonth} ${startDay}-${endDay}, ${year}`;
    }
    return `Week of ${startMonth} ${startDay} - ${endMonth} ${endDay}, ${year}`;
  };

  // Get latest 5 time entries for Recent Activity
  const recentActivity = [...thisWeekEntries]
    .sort((a: TimeEntry, b: TimeEntry) => {
      const dateA = new Date(a.clockInTime);
      const dateB = new Date(b.clockInTime);
      return dateB.getTime() - dateA.getTime();
    })
    .slice(0, 5);

  if (!canManageEmployees) {
    return (
      <div className="min-h-screen bg-background p-4 md:p-6">
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Access Denied</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">
                You need HR management permissions to view this page.
              </p>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="p-4 md:p-6">
        <Tabs defaultValue="performance" className="w-full">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="performance">Performance</TabsTrigger>
            <TabsTrigger value="payroll">Payroll</TabsTrigger>
            <TabsTrigger value="policies">Policies</TabsTrigger>
          </TabsList>

          <TabsContent value="performance" className="space-y-4">
            {/* Live Team Panel — visible to managers/admins */}
            {isManagerOrAdmin && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base flex items-center gap-2">
                    <span className="relative flex h-2 w-2">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
                      <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500"></span>
                    </span>
                    Live Team
                    {!timeEntriesLoading && (
                      <Badge className="ml-1 bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200">
                        {liveEntries.length} clocked in
                      </Badge>
                    )}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {timeEntriesLoading ? (
                    <div className="space-y-2">
                      {[...Array(3)].map((_, i) => (
                        <div key={i} className="flex items-center justify-between p-3 bg-muted/50 rounded-lg">
                          <Skeleton className="h-4 w-32" />
                          <Skeleton className="h-4 w-16" />
                        </div>
                      ))}
                    </div>
                  ) : liveEntries.length === 0 ? (
                    <div className="text-center py-4">
                      <p className="text-muted-foreground text-sm">No team members currently clocked in</p>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {liveEntries.map((entry: TimeEntry) => (
                        <div key={entry.id} className="flex items-center justify-between p-3 bg-muted/50 rounded-lg">
                          <div>
                            <p className="font-medium text-sm">{getUserName(entry.userId)}</p>
                            <p className="text-xs text-muted-foreground">
                              Since {new Date(entry.clockInTime).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true })}
                            </p>
                          </div>
                          <div className="flex items-center gap-2">
                            {entry.breakStartTime && (
                              <Badge className="bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200 text-xs">On Break</Badge>
                            )}
                            <span className="text-sm font-medium tabular-nums">{formatElapsed(entry.clockInTime)}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            )}

            {/* Performance Overview */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center">
                  <i className="fas fa-chart-line text-primary mr-2"></i>
                  Performance Overview
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="text-center">
                    {timeEntriesLoading || schedulesLoading ? (
                      <Skeleton className="h-8 w-20 mx-auto mb-1" />
                    ) : (
                      <p className="text-2xl font-bold text-green-600">
                        {userSchedulesThisWeek.length === 0 && totalHoursThisWeek === 0
                          ? "No Data"
                          : `${Math.round(attendanceRate)}%`}
                      </p>
                    )}
                    <p className="text-xs text-muted-foreground">Attendance Rate</p>
                  </div>
                  <div className="text-center">
                    {timeEntriesLoading || tasksLoading || schedulesLoading ? (
                      <Skeleton className="h-8 w-20 mx-auto mb-1" />
                    ) : (
                      <p className="text-2xl font-bold text-blue-600">
                        {(performanceScore).toFixed(1)}
                      </p>
                    )}
                    <p className="text-xs text-muted-foreground">Performance Score</p>
                  </div>
                </div>

                <div className="space-y-3">
                  <div>
                    <div className="flex justify-between text-sm mb-1">
                      <span>Task Completion Rate</span>
                      {tasksLoading ? (
                        <Skeleton className="h-4 w-12" />
                      ) : (
                        <span>{userTasks.length === 0 ? "No tasks" : `${Math.round(taskCompletionRate)}%`}</span>
                      )}
                    </div>
                    <Progress value={userTasks.length === 0 ? 0 : taskCompletionRate} className="h-2" />
                  </div>
                  
                  <div>
                    <div className="flex justify-between text-sm mb-1">
                      <span>Punctuality Score</span>
                      {timeEntriesLoading ? (
                        <Skeleton className="h-4 w-12" />
                      ) : (
                        <span>{thisWeekEntries.length === 0 ? "N/A" : `${Math.round(punctualityScore)}%`}</span>
                      )}
                    </div>
                    <Progress value={thisWeekEntries.length === 0 ? 0 : punctualityScore} className="h-2" />
                  </div>
                  
                  <div>
                    <div className="flex justify-between text-sm mb-1">
                      <span>Total Hours This Week</span>
                      {timeEntriesLoading ? (
                        <Skeleton className="h-4 w-12" />
                      ) : (
                        <span>{totalHoursThisWeek.toFixed(1)}h</span>
                      )}
                    </div>
                    <Progress value={Math.min((totalHoursThisWeek / 40) * 100, 100)} className="h-2" />
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Recent Activity */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center">
                  <i className="fas fa-history text-primary mr-2"></i>
                  Recent Activity
                </CardTitle>
              </CardHeader>
              <CardContent>
                {timeEntriesLoading ? (
                  <div className="space-y-3">
                    {[...Array(3)].map((_, i) => (
                      <div key={i} className="flex items-center justify-between p-3 bg-muted/50 rounded-lg">
                        <Skeleton className="h-12 w-32" />
                        <Skeleton className="h-6 w-20" />
                      </div>
                    ))}
                  </div>
                ) : recentActivity.length === 0 ? (
                  <div className="text-center py-4">
                    <i className="fas fa-inbox text-muted-foreground text-xl mb-2"></i>
                    <p className="text-muted-foreground text-sm">No activity this week</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {recentActivity.map((entry: TimeEntry) => (
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
                            {new Date(entry.clockInTime).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true })}
                            {entry.clockOutTime && (
                              <> - {new Date(entry.clockOutTime).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true })}</>
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
                            <Badge className="bg-green-100 text-green-800">Active</Badge>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="payroll" className="space-y-4">
            {/* Current Period Summary */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center">
                  <i className="fas fa-dollar-sign text-primary mr-2"></i>
                  Current Pay Period
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-muted-foreground">{formatWeekRange()}</span>
                    <Badge variant={totalHoursThisWeek > 40 ? "destructive" : "default"}>
                      {totalHoursThisWeek.toFixed(1)} hours
                    </Badge>
                  </div>

                  <div className="grid grid-cols-2 gap-4 text-sm">
                    <div>
                      <p className="text-muted-foreground">Regular Hours</p>
                      <p className="font-semibold" data-testid="regular-hours">
                        {Math.min(40, totalHoursThisWeek).toFixed(1)}h
                      </p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">Overtime</p>
                      <p className="font-semibold" data-testid="overtime-hours">
                        {Math.max(0, totalHoursThisWeek - 40).toFixed(1)}h
                      </p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">Hourly Rate</p>
                      <p className="font-semibold" data-testid="hourly-rate">
                        ${user?.hourlyRate || '18.50'}/hr
                      </p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">Est. Total</p>
                      <p className="font-semibold" data-testid="estimated-pay">
                        ${((user?.hourlyRate ? parseFloat(user.hourlyRate) : 18.50) * totalHoursThisWeek).toFixed(2)}
                      </p>
                    </div>
                  </div>

                  <Button
                    onClick={() => setShowPayrollModal(true)}
                    className="w-full"
                    data-testid="review-timesheet-button"
                  >
                    <i className="fas fa-file-invoice-dollar mr-2"></i>
                    Review Timesheet
                  </Button>
                </div>
              </CardContent>
            </Card>

            {/* Timesheet History */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Timesheet History</CardTitle>
              </CardHeader>
              <CardContent>
                {timeEntriesLoading ? (
                  <div className="space-y-2">
                    {[...Array(3)].map((_, i) => (
                      <div key={i} className="animate-pulse h-16 bg-muted rounded-lg"></div>
                    ))}
                  </div>
                ) : thisWeekEntries.length === 0 ? (
                  <div className="text-center py-4">
                    <i className="fas fa-calendar text-muted-foreground text-xl mb-2"></i>
                    <p className="text-muted-foreground text-sm">No time entries this week</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {thisWeekEntries.map((entry: any) => (
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
                            {new Date(entry.clockInTime).toLocaleTimeString('en-US', { hour12: true })}
                            {entry.clockOutTime && (
                              <> - {new Date(entry.clockOutTime).toLocaleTimeString('en-US', { hour12: true })}</>
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
                            <Badge className="bg-green-100 text-green-800">Active</Badge>
                          )}
                          {entry.isApproved && (
                            <i className="fas fa-check-circle text-green-500 text-xs ml-2"></i>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="policies" className="space-y-4">
            {/* Company Policies */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center">
                  <i className="fas fa-file-contract text-primary mr-2"></i>
                  Company Policies
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="space-y-2">
                  <Button variant="ghost" className="w-full justify-start h-auto p-3">
                    <div className="text-left">
                      <p className="font-medium text-sm">Employee Handbook</p>
                      <p className="text-xs text-muted-foreground">Updated Jan 2025 • 42 pages</p>
                    </div>
                  </Button>
                  
                  <Button variant="ghost" className="w-full justify-start h-auto p-3">
                    <div className="text-left">
                      <p className="font-medium text-sm">Time Off Policy</p>
                      <p className="text-xs text-muted-foreground">Vacation, sick leave, and PTO guidelines</p>
                    </div>
                  </Button>
                  
                  <Button variant="ghost" className="w-full justify-start h-auto p-3">
                    <div className="text-left">
                      <p className="font-medium text-sm">Safety Procedures</p>
                      <p className="text-xs text-muted-foreground">Workplace safety and emergency protocols</p>
                    </div>
                  </Button>
                  
                  <Button variant="ghost" className="w-full justify-start h-auto p-3">
                    <div className="text-left">
                      <p className="font-medium text-sm">Code of Conduct</p>
                      <p className="text-xs text-muted-foreground">Professional behavior guidelines</p>
                    </div>
                  </Button>
                </div>
              </CardContent>
            </Card>

            {/* Training Resources */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center">
                  <i className="fas fa-graduation-cap text-primary mr-2"></i>
                  Training & Development
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="space-y-3">
                  <div className="flex items-center justify-between p-3 bg-muted/50 rounded-lg">
                    <div className="flex items-center space-x-3">
                      <div className="w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center">
                        <i className="fas fa-play text-blue-600 text-xs"></i>
                      </div>
                      <div>
                        <p className="font-medium text-sm">Safety Training</p>
                        <p className="text-xs text-muted-foreground">Complete by Feb 1st</p>
                      </div>
                    </div>
                    <Badge className="bg-yellow-100 text-yellow-800">In Progress</Badge>
                  </div>
                  
                  <div className="flex items-center justify-between p-3 bg-muted/50 rounded-lg">
                    <div className="flex items-center space-x-3">
                      <div className="w-8 h-8 bg-green-100 rounded-full flex items-center justify-center">
                        <i className="fas fa-check text-green-600 text-xs"></i>
                      </div>
                      <div>
                        <p className="font-medium text-sm">Time Clock Training</p>
                        <p className="text-xs text-muted-foreground">Completed Jan 15th</p>
                      </div>
                    </div>
                    <Badge className="bg-green-100 text-green-800">Complete</Badge>
                  </div>
                  
                  <div className="flex items-center justify-between p-3 bg-muted/50 rounded-lg">
                    <div className="flex items-center space-x-3">
                      <div className="w-8 h-8 bg-gray-100 rounded-full flex items-center justify-center">
                        <i className="fas fa-book text-gray-600 text-xs"></i>
                      </div>
                      <div>
                        <p className="font-medium text-sm">Customer Service Excellence</p>
                        <p className="text-xs text-muted-foreground">Available</p>
                      </div>
                    </div>
                    <Badge variant="outline">Available</Badge>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Performance Metrics */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">This Month's Metrics</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="space-y-2">
                  <div className="flex justify-between text-sm">
                    <span>Tasks Completed</span>
                    <span className="font-medium">24/26</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span>On-Time Clock-ins</span>
                    <span className="font-medium">18/20</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span>Team Feedback Score</span>
                    <span className="font-medium">4.8/5.0</span>
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="payroll" className="space-y-4">
            {/* Current Pay Period */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center">
                  <i className="fas fa-money-check-alt text-primary mr-2"></i>
                  Current Pay Period
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="bg-muted/50 rounded-lg p-4">
                  <div className="flex justify-between items-center mb-2">
                    <span className="text-sm font-medium">{formatWeekRange()}</span>
                    <Badge>{totalHoursThisWeek.toFixed(1)} hours</Badge>
                  </div>
                  
                  <div className="grid grid-cols-2 gap-4 text-sm">
                    <div>
                      <p className="text-muted-foreground">Total Hours</p>
                      <p className="font-semibold">{totalHoursThisWeek.toFixed(1)}h</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">Overtime</p>
                      <p className="font-semibold text-orange-600">
                        {Math.max(0, totalHoursThisWeek - 40).toFixed(1)}h
                      </p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">Regular Rate</p>
                      <p className="font-semibold">${user?.hourlyRate || '18.50'}/hr</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">Est. Total</p>
                      <p className="font-semibold">
                        ${((user?.hourlyRate ? parseFloat(user.hourlyRate) : 18.50) * totalHoursThisWeek).toFixed(2)}
                      </p>
                    </div>
                  </div>
                </div>

                <Button
                  onClick={() => setShowPayrollModal(true)}
                  className="w-full"
                  data-testid="open-payroll-modal"
                >
                  <i className="fas fa-file-invoice mr-2"></i>
                  Review Timesheet with AI
                </Button>
              </CardContent>
            </Card>

            {/* Pay History */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Pay History</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  <div className="flex items-center justify-between p-3 bg-muted/50 rounded-lg">
                    <div>
                      <p className="font-medium text-sm">Jan 13-17, 2025</p>
                      <p className="text-xs text-muted-foreground">38.5 hours • Approved</p>
                    </div>
                    <div className="text-right">
                      <p className="font-medium text-sm">$712.25</p>
                      <p className="text-xs text-green-600">Paid</p>
                    </div>
                  </div>
                  
                  <div className="flex items-center justify-between p-3 bg-muted/50 rounded-lg">
                    <div>
                      <p className="font-medium text-sm">Jan 6-10, 2025</p>
                      <p className="text-xs text-muted-foreground">40.0 hours • Approved</p>
                    </div>
                    <div className="text-right">
                      <p className="font-medium text-sm">$740.00</p>
                      <p className="text-xs text-green-600">Paid</p>
                    </div>
                  </div>
                  
                  <div className="flex items-center justify-between p-3 bg-muted/50 rounded-lg">
                    <div>
                      <p className="font-medium text-sm">Dec 30 - Jan 3, 2025</p>
                      <p className="text-xs text-muted-foreground">32.0 hours • Holiday week</p>
                    </div>
                    <div className="text-right">
                      <p className="font-medium text-sm">$592.00</p>
                      <p className="text-xs text-green-600">Paid</p>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="policies" className="space-y-4">
            {/* Time Off Requests */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center">
                  <i className="fas fa-calendar-plus text-primary mr-2"></i>
                  Time Off Requests
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <Button className="w-full" data-testid="request-time-off">
                  <i className="fas fa-plus mr-2"></i>
                  Request Time Off
                </Button>
                
                <div className="text-center py-4">
                  <i className="fas fa-calendar-check text-muted-foreground text-xl mb-2"></i>
                  <p className="text-muted-foreground text-sm">No pending requests</p>
                </div>
              </CardContent>
            </Card>

            {/* Available PTO */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Available Time Off</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 gap-4">
                  <div className="text-center">
                    <p className="text-2xl font-bold text-primary">15</p>
                    <p className="text-xs text-muted-foreground">Vacation Days</p>
                  </div>
                  <div className="text-center">
                    <p className="text-2xl font-bold text-primary">8</p>
                    <p className="text-xs text-muted-foreground">Sick Days</p>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Benefits Overview */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center">
                  <i className="fas fa-heart text-primary mr-2"></i>
                  Benefits Overview
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  <div className="flex justify-between items-center">
                    <span className="text-sm">Health Insurance</span>
                    <Badge className="bg-green-100 text-green-800">Active</Badge>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-sm">Dental Coverage</span>
                    <Badge className="bg-green-100 text-green-800">Active</Badge>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-sm">401(k) Plan</span>
                    <Badge className="bg-blue-100 text-blue-800">Enrolled</Badge>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-sm">Life Insurance</span>
                    <Badge className="bg-green-100 text-green-800">Active</Badge>
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>

      {/* Payroll Modal */}
      <PayrollModal
        isOpen={showPayrollModal}
        onClose={() => setShowPayrollModal(false)}
      />
    </div>
  );
}
