import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useLocation } from 'wouter';
import { useAuth } from '@/hooks/useAuth';
import { useIsMobile } from '@/hooks/use-mobile';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';
import { apiRequest } from '@/lib/queryClient';
import AIChatModal from '@/components/AIChatModal';
import TodaySchedulePanel from '@/components/TodaySchedulePanel';
import DailyGoalWidget from '@/components/DailyGoalWidget';

export default function AdminDashboard() {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const isMobile = useIsMobile();
  const [, navigate] = useLocation();
  const [showAIChat, setShowAIChat] = useState(false);
  const [showTasksPopup, setShowTasksPopup] = useState(false);
  const [currentTime, setCurrentTime] = useState(new Date());
  const [lastAssignResult, setLastAssignResult] = useState<any>(null);

  const { data: timeEntries } = useQuery({ queryKey: ['/api/time-entries'] });
  const { data: schedules, isLoading: schedulesLoading } = useQuery({ queryKey: ['/api/schedules'] });
  const { data: tasks, isLoading: tasksLoading } = useQuery({ queryKey: ['/api/tasks'] });
  const { data: insights } = useQuery({ queryKey: ['/api/insights'] });
  const { data: users } = useQuery({ queryKey: ['/api/users'] });

  const getUserName = (userId: string) => {
    const u = (users as any[])?.find((u: any) => u.id === userId);
    return u ? `${u.firstName} ${u.lastName}` : `#${userId.slice(-4)}`;
  };

  const assignChoresMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest('POST', '/api/ai/assign-chores', {});
      return res.json();
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ['/api/tasks'] });
      setLastAssignResult(data);
      if (data.message === 'No unassigned chores available') {
        toast({ title: "No Tasks to Assign", description: "All tasks are already assigned or none are pending." });
      } else {
        const count = data.assignments?.length || 0;
        const uniqueEmployees = new Set(data.assignments?.map((a: any) => a.assignedTo) || []).size;
        toast({
          title: "AI Auto-Assign Complete",
          description: `${count} task${count !== 1 ? 's' : ''} assigned to ${uniqueEmployees} employee${uniqueEmployees !== 1 ? 's' : ''}`,
        });
      }
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to assign chores.", variant: "destructive" });
    },
  });

  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  const today = new Date();
  const activeEntries = (timeEntries as any[])?.filter((e: any) => !e.clockOutTime) || [];
  const todayTasks = (tasks as any[])?.filter((t: any) => new Date(t.createdAt).toDateString() === today.toDateString()) || [];
  const completedToday = todayTasks.filter((t: any) => t.status === 'completed').length;
  const totalEmployees = (users as any[])?.length || 0;

  const todaySchedules = (schedules as any[])?.filter((s: any) => {
    return new Date(s.startTime).toDateString() === today.toDateString();
  }) || [];

  const formatTime = (date: Date) =>
    date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });

  const getGreeting = () => {
    const hour = currentTime.getHours();
    if (hour < 12) return 'Good morning';
    if (hour < 17) return 'Good afternoon';
    return 'Good evening';
  };

  return (
    <div className="min-h-full bg-background">
      <section className="bg-gradient-to-br from-primary to-primary/80 text-primary-foreground p-5 md:p-6 md:rounded-xl md:m-6 md:mt-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-lg md:text-xl font-bold">
              {getGreeting()}, {(user as any)?.firstName || 'Admin'}!
            </h1>
            <p className="text-sm opacity-80">
              {currentTime.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })} &bull; {formatTime(currentTime)}
            </p>
          </div>
          <Button
            onClick={() => setShowAIChat(true)}
            size="icon"
            className="bg-white/20 hover:bg-white/30 text-white rounded-full h-10 w-10"
            data-testid="admin-ai-assistant"
          >
            <i className="fas fa-robot"></i>
          </Button>
        </div>
      </section>

      <div className={isMobile ? "px-4 py-3" : "px-6 py-4"}>
        <div className={isMobile ? "grid grid-cols-2 gap-3" : "grid grid-cols-4 gap-4"}>
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center flex-shrink-0">
                  <i className="fas fa-user-check text-green-600 dark:text-green-400"></i>
                </div>
                <div className="min-w-0">
                  <p className="text-2xl font-bold">{activeEntries.length}</p>
                  <p className="text-xs text-muted-foreground truncate">Clocked In</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center flex-shrink-0">
                  <i className="fas fa-users text-blue-600 dark:text-blue-400"></i>
                </div>
                <div className="min-w-0">
                  <p className="text-2xl font-bold">{totalEmployees}</p>
                  <p className="text-xs text-muted-foreground truncate">Team Size</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center flex-shrink-0">
                  <i className="fas fa-calendar-day text-amber-600 dark:text-amber-400"></i>
                </div>
                <div className="min-w-0">
                  <p className="text-2xl font-bold">{todaySchedules.length}</p>
                  <p className="text-xs text-muted-foreground truncate">Shifts Today</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card className="cursor-pointer hover:shadow-md transition-shadow" onClick={() => setShowTasksPopup(true)}>
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-purple-100 dark:bg-purple-900/30 flex items-center justify-center flex-shrink-0">
                  <i className="fas fa-tasks text-purple-600 dark:text-purple-400"></i>
                </div>
                <div className="min-w-0">
                  <p className="text-2xl font-bold">{completedToday}/{todayTasks.length}</p>
                  <p className="text-xs text-muted-foreground truncate">Tasks Done</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      <div className={isMobile ? "px-4 pb-4 space-y-4" : "px-6 pb-6"}>
        {isMobile ? (
          <>
            <TodaySchedulePanel />
            <DailyGoalWidget />
          </>
        ) : (
          <div className="grid grid-cols-12 gap-6 mb-6">
            <div className="col-span-7">
              <TodaySchedulePanel />
            </div>
            <div className="col-span-5">
              <DailyGoalWidget />
            </div>
          </div>
        )}

        <Tabs defaultValue="overview" className="w-full">
          <TabsList className={isMobile ? "grid w-full grid-cols-4 mb-4" : "mb-4"}>
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="team">Team</TabsTrigger>
            <TabsTrigger value="tasks">Tasks</TabsTrigger>
            <TabsTrigger value="ai">AI</TabsTrigger>
          </TabsList>

          <TabsContent value="overview">
            <div className={isMobile ? "space-y-4" : "grid grid-cols-2 gap-6"}>
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <i className="fas fa-brain text-primary"></i>
                    AI Insights
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {(insights as any[])?.length > 0 ? (
                    <div className="space-y-2">
                      {(insights as any[]).slice(0, 4).map((insight: any) => (
                        <div
                          key={insight.id}
                          className={`border rounded-lg p-3 text-sm ${
                            insight.severity === 'high' ? 'bg-red-50 dark:bg-red-900/10 border-red-200 dark:border-red-800' :
                            insight.severity === 'medium' ? 'bg-yellow-50 dark:bg-yellow-900/10 border-yellow-200 dark:border-yellow-800' :
                            'bg-blue-50 dark:bg-blue-900/10 border-blue-200 dark:border-blue-800'
                          }`}
                        >
                          <p className="font-medium text-sm">{insight.title}</p>
                          <p className="text-xs text-muted-foreground mt-0.5">{insight.description}</p>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-center py-6">
                      <i className="fas fa-chart-line text-muted-foreground text-2xl mb-2"></i>
                      <p className="text-sm text-muted-foreground">AI is analyzing team data...</p>
                    </div>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm">Quick Access</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-2 gap-2">
                    <Button variant="outline" className="h-auto py-3 flex flex-col items-center gap-1" onClick={() => navigate('/schedules')}>
                      <i className="fas fa-calendar-alt text-primary"></i>
                      <span className="text-xs">Schedules</span>
                    </Button>
                    <Button variant="outline" className="h-auto py-3 flex flex-col items-center gap-1" onClick={() => navigate('/team')}>
                      <i className="fas fa-users text-primary"></i>
                      <span className="text-xs">Team</span>
                    </Button>
                    <Button variant="outline" className="h-auto py-3 flex flex-col items-center gap-1" onClick={() => navigate('/payroll')}>
                      <i className="fas fa-dollar-sign text-primary"></i>
                      <span className="text-xs">Payroll</span>
                    </Button>
                    <Button variant="outline" className="h-auto py-3 flex flex-col items-center gap-1" onClick={() => navigate('/operations')}>
                      <i className="fas fa-cogs text-primary"></i>
                      <span className="text-xs">Operations</span>
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          <TabsContent value="team">
            <div className={isMobile ? "space-y-4" : "grid grid-cols-2 gap-6"}>
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <i className="fas fa-user-clock text-green-600"></i>
                    Currently Active ({activeEntries.length})
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {activeEntries.length === 0 ? (
                    <div className="text-center py-6">
                      <i className="fas fa-user-clock text-muted-foreground text-2xl mb-2"></i>
                      <p className="text-sm text-muted-foreground">No one clocked in right now</p>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {activeEntries.map((entry: any) => (
                        <div key={entry.id} className="flex items-center justify-between p-3 bg-green-50 dark:bg-green-900/10 rounded-lg border border-green-200 dark:border-green-800">
                          <div className="flex items-center gap-2">
                            <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></div>
                            <div>
                              <p className="font-medium text-sm">{getUserName(entry.userId)}</p>
                              <p className="text-xs text-muted-foreground">
                                Since {new Date(entry.clockInTime).toLocaleTimeString('en-US', { hour12: true, hour: 'numeric', minute: '2-digit' })}
                              </p>
                            </div>
                          </div>
                          <span className="text-sm font-medium">
                            {((Date.now() - new Date(entry.clockInTime).getTime()) / 3600000).toFixed(1)}h
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm">Today's Shifts ({todaySchedules.length})</CardTitle>
                </CardHeader>
                <CardContent>
                  {schedulesLoading ? (
                    <div className="space-y-2">
                      {[1,2,3].map(i => <div key={i} className="animate-pulse h-14 bg-muted rounded-lg"></div>)}
                    </div>
                  ) : todaySchedules.length === 0 ? (
                    <div className="text-center py-6">
                      <i className="fas fa-calendar text-muted-foreground text-2xl mb-2"></i>
                      <p className="text-sm text-muted-foreground">No shifts scheduled today</p>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {todaySchedules.slice(0, 5).map((schedule: any) => {
                        const now = new Date();
                        const start = new Date(schedule.startTime);
                        const end = new Date(schedule.endTime);
                        const status = now >= start && now <= end ? 'active' : now < start ? 'upcoming' : 'complete';

                        return (
                          <div key={schedule.id} className="flex items-center justify-between p-3 bg-muted/50 rounded-lg">
                            <div>
                              <p className="font-medium text-sm">{schedule.title || getUserName(schedule.userId)}</p>
                              <p className="text-xs text-muted-foreground">
                                {start.toLocaleTimeString('en-US', { hour12: true, hour: 'numeric', minute: '2-digit' })} - {end.toLocaleTimeString('en-US', { hour12: true, hour: 'numeric', minute: '2-digit' })}
                              </p>
                            </div>
                            <span className={`text-xs px-2 py-1 rounded-full ${
                              status === 'active' ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400' :
                              status === 'upcoming' ? 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400' :
                              'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-400'
                            }`}>
                              {status === 'active' ? 'Active' : status === 'upcoming' ? 'Upcoming' : 'Done'}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          <TabsContent value="tasks">
            <div className={isMobile ? "space-y-4" : "grid grid-cols-2 gap-6"}>
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <i className="fas fa-robot text-primary"></i>
                    AI Task Management
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <Button
                    onClick={() => assignChoresMutation.mutate()}
                    disabled={assignChoresMutation.isPending}
                    className="w-full"
                    data-testid="ai-assign-chores"
                  >
                    {assignChoresMutation.isPending ? (
                      <><i className="fas fa-spinner fa-spin mr-2"></i>AI is distributing tasks...</>
                    ) : (
                      <><i className="fas fa-magic mr-2"></i>Auto-Assign Tasks with AI</>
                    )}
                  </Button>
                  {lastAssignResult && lastAssignResult.assignments?.length > 0 && (
                    <div className="border rounded-lg p-3 bg-primary/5 border-primary/20 space-y-2">
                      <div className="flex items-center justify-between">
                        <p className="text-sm font-medium text-primary flex items-center gap-1.5">
                          <i className="fas fa-check-circle"></i>
                          {lastAssignResult.assignments.length} task{lastAssignResult.assignments.length !== 1 ? 's' : ''} assigned to {new Set(lastAssignResult.assignments.map((a: any) => a.assignedTo)).size} employee{new Set(lastAssignResult.assignments.map((a: any) => a.assignedTo)).size !== 1 ? 's' : ''}
                        </p>
                        <button onClick={() => setLastAssignResult(null)} className="text-muted-foreground hover:text-foreground text-xs">
                          <i className="fas fa-times"></i>
                        </button>
                      </div>
                      <div className="space-y-1.5 max-h-[150px] overflow-y-auto">
                        {lastAssignResult.assignments.map((assignment: any, idx: number) => (
                          <div key={idx} className="flex items-center justify-between text-xs bg-background rounded p-2 border">
                            <div className="flex items-center gap-1.5 min-w-0">
                              <Badge variant="outline" className="text-[10px] flex-shrink-0">
                                <i className="fas fa-robot mr-1"></i>AI
                              </Badge>
                              <span className="truncate">Task #{assignment.choreId.slice(-4)}</span>
                            </div>
                            <span className="text-muted-foreground flex-shrink-0 ml-2">→ {getUserName(assignment.assignedTo)}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  {lastAssignResult?.message === 'No unassigned chores available' && (
                    <div className="border rounded-lg p-3 bg-muted/50 text-center">
                      <p className="text-sm text-muted-foreground">
                        <i className="fas fa-info-circle mr-1.5"></i>
                        All tasks are already assigned
                      </p>
                    </div>
                  )}
                  <div className="grid grid-cols-2 gap-3">
                    <div className="text-center p-3 bg-muted/50 rounded-lg">
                      <p className="text-xl font-bold text-primary">{todayTasks.length}</p>
                      <p className="text-xs text-muted-foreground">Today's Tasks</p>
                    </div>
                    <div className="text-center p-3 bg-muted/50 rounded-lg">
                      <p className="text-xl font-bold text-green-600">{completedToday}</p>
                      <p className="text-xs text-muted-foreground">Completed</p>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm">Recent Tasks</CardTitle>
                </CardHeader>
                <CardContent>
                  {tasksLoading ? (
                    <div className="space-y-2">
                      {[1,2,3].map(i => <div key={i} className="animate-pulse h-12 bg-muted rounded-lg"></div>)}
                    </div>
                  ) : (tasks as any[])?.length === 0 ? (
                    <div className="text-center py-6">
                      <i className="fas fa-tasks text-muted-foreground text-2xl mb-2"></i>
                      <p className="text-sm text-muted-foreground">No tasks yet</p>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {(tasks as any[])?.slice(0, 6).map((task: any) => (
                        <div key={task.id} className="flex items-center justify-between p-3 bg-muted/50 rounded-lg">
                          <div className="min-w-0 flex-1">
                            <p className="font-medium text-sm truncate">{task.title}</p>
                            <div className="flex items-center gap-2 mt-0.5">
                              {task.isAIAssigned && (
                                <span className="text-[10px] bg-primary/10 text-primary px-1.5 py-0.5 rounded-full">AI</span>
                              )}
                              <span className="text-xs text-muted-foreground truncate">
                                {task.assignedTo ? getUserName(task.assignedTo) : 'Unassigned'}
                              </span>
                            </div>
                          </div>
                          <span className={`text-xs px-2 py-1 rounded-full flex-shrink-0 ml-2 ${
                            task.status === 'completed' ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400' :
                            task.status === 'in_progress' ? 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400' :
                            'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-400'
                          }`}>
                            {task.status.replace('_', ' ')}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          <TabsContent value="ai">
            <div className={isMobile ? "space-y-4" : "grid grid-cols-2 gap-6"}>
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <i className="fas fa-cogs text-primary"></i>
                    AI Configuration
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    {[
                      { label: 'Overtime Prevention', desc: 'Auto-alert when approaching overtime', icon: 'fa-clock' },
                      { label: 'Anomaly Detection', desc: 'Monitor unusual patterns', icon: 'fa-search' },
                      { label: 'Auto Task Assignment', desc: 'AI-powered task distribution', icon: 'fa-magic' },
                      { label: 'Payroll Analysis', desc: 'Timesheet error detection', icon: 'fa-file-invoice-dollar' },
                    ].map((item) => (
                      <div key={item.label} className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <i className={`fas ${item.icon} text-muted-foreground text-sm w-4`}></i>
                          <div>
                            <p className="text-sm font-medium">{item.label}</p>
                            <p className="text-xs text-muted-foreground">{item.desc}</p>
                          </div>
                        </div>
                        <div className="w-9 h-5 bg-primary rounded-full relative flex-shrink-0">
                          <div className="w-4 h-4 bg-white rounded-full absolute right-0.5 top-0.5"></div>
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm">AI Analytics</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    {[
                      { label: 'Tasks Auto-Assigned', value: String(todayTasks.filter((t: any) => t.isAIAssigned).length), color: 'text-primary' },
                      { label: 'Anomalies Detected', value: String((insights as any[])?.filter((i: any) => i.severity === 'high').length || 0), color: 'text-yellow-600' },
                      { label: 'AI Accuracy Rate', value: '97%', color: 'text-green-600' },
                    ].map((item) => (
                      <div key={item.label} className="flex justify-between items-center p-3 bg-muted/50 rounded-lg">
                        <span className="text-sm">{item.label}</span>
                        <span className={`font-semibold ${item.color}`}>{item.value}</span>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            </div>
          </TabsContent>
        </Tabs>
      </div>

      <Dialog open={showTasksPopup} onOpenChange={setShowTasksPopup}>
        <DialogContent className="max-w-lg max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <i className="fas fa-tasks text-purple-600"></i>
              Today's Tasks
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-1 mb-3">
            <div className="flex items-center gap-4 text-sm text-muted-foreground">
              <span><span className="font-semibold text-foreground">{todayTasks.length}</span> total</span>
              <span><span className="font-semibold text-green-600">{completedToday}</span> completed</span>
              <span><span className="font-semibold text-amber-600">{todayTasks.filter((t: any) => t.status === 'in_progress').length}</span> in progress</span>
              <span><span className="font-semibold text-muted-foreground">{todayTasks.filter((t: any) => t.status === 'pending').length}</span> pending</span>
            </div>
          </div>
          {todayTasks.length === 0 ? (
            <div className="text-center py-8">
              <i className="fas fa-clipboard-check text-muted-foreground text-3xl mb-3"></i>
              <p className="text-sm text-muted-foreground">No tasks assigned for today</p>
            </div>
          ) : (
            <div className="space-y-2">
              {todayTasks.map((task: any) => (
                <div key={task.id} className={`flex items-start gap-3 p-3 rounded-lg border ${
                  task.status === 'completed' ? 'bg-green-50 dark:bg-green-900/10 border-green-200 dark:border-green-800' :
                  task.status === 'in_progress' ? 'bg-amber-50 dark:bg-amber-900/10 border-amber-200 dark:border-amber-800' :
                  'bg-muted/30 border-border'
                }`}>
                  <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0 mt-0.5 ${
                    task.status === 'completed' ? 'border-green-500 bg-green-500' :
                    task.status === 'in_progress' ? 'border-amber-500' :
                    'border-gray-300 dark:border-gray-600'
                  }`}>
                    {task.status === 'completed' && <i className="fas fa-check text-white text-[8px]"></i>}
                    {task.status === 'in_progress' && <div className="w-2 h-2 bg-amber-500 rounded-full"></div>}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className={`text-sm font-medium ${task.status === 'completed' ? 'line-through text-muted-foreground' : ''}`}>
                      {task.title}
                    </p>
                    {task.description && (
                      <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{task.description}</p>
                    )}
                    <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                      <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${
                        task.status === 'completed' ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' :
                        task.status === 'in_progress' ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400' :
                        'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400'
                      }`}>
                        {task.status === 'completed' ? 'Done' : task.status === 'in_progress' ? 'In Progress' : 'Pending'}
                      </span>
                      {task.assignedTo ? (
                        <span className="text-[10px] text-muted-foreground flex items-center gap-1">
                          <i className="fas fa-user text-[8px]"></i>
                          {getUserName(task.assignedTo)}
                        </span>
                      ) : (
                        <span className="text-[10px] text-orange-500 flex items-center gap-1">
                          <i className="fas fa-exclamation-circle text-[8px]"></i>
                          Unassigned
                        </span>
                      )}
                      {task.isAIAssigned && (
                        <span className="text-[10px] bg-primary/10 text-primary px-1.5 py-0.5 rounded-full">AI assigned</span>
                      )}
                      {task.dueDate && (
                        <span className="text-[10px] text-muted-foreground flex items-center gap-1">
                          <i className="fas fa-clock text-[8px]"></i>
                          {new Date(task.dueDate).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </DialogContent>
      </Dialog>

      <AIChatModal isOpen={showAIChat} onClose={() => setShowAIChat(false)} />
    </div>
  );
}
