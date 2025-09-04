import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/hooks/useAuth';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useToast } from '@/hooks/use-toast';
import { apiRequest } from '@/lib/queryClient';
import { isUnauthorizedError } from '@/lib/authUtils';
import AIChatModal from '@/components/AIChatModal';

export default function AdminDashboard() {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [showAIChat, setShowAIChat] = useState(false);
  const [currentTime, setCurrentTime] = useState(new Date());

  const { data: timeEntries, isLoading: timeEntriesLoading } = useQuery({
    queryKey: ['/api/time-entries'],
  });

  const { data: schedules, isLoading: schedulesLoading } = useQuery({
    queryKey: ['/api/schedules'],
  });

  const { data: tasks, isLoading: tasksLoading } = useQuery({
    queryKey: ['/api/tasks'],
  });

  const { data: insights } = useQuery({
    queryKey: ['/api/insights'],
  });

  const assignChoresMutation = useMutation({
    mutationFn: async () => {
      return await apiRequest('POST', '/api/ai/assign-chores', {});
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['/api/tasks'] });
      toast({
        title: "Chores Assigned",
        description: `AI assigned ${data.assignments?.length || 0} chores to team members.`,
      });
    },
    onError: (error: Error) => {
      if (isUnauthorizedError(error)) {
        toast({
          title: "Unauthorized",
          description: "You are logged out. Logging in again...",
          variant: "destructive",
        });
        setTimeout(() => {
          window.location.href = "/api/login";
        }, 500);
        return;
      }
      toast({
        title: "Error",
        description: "Failed to assign chores. Please try again.",
        variant: "destructive",
      });
    },
  });

  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentTime(new Date());
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  const today = new Date();
  const activeTimeEntries = timeEntries?.filter((entry: any) => !entry.clockOutTime) || [];
  const todayTasks = tasks?.filter((task: any) => {
    const taskDate = new Date(task.createdAt);
    return taskDate.toDateString() === today.toDateString();
  }) || [];
  
  const completedTasksToday = todayTasks.filter((task: any) => task.status === 'completed').length;
  const totalTasksToday = todayTasks.length;

  const formatTime = (date: Date) => {
    return date.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Admin Header */}
      <header className="bg-primary text-primary-foreground p-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold">Admin Dashboard</h1>
            <p className="text-sm opacity-80">Team management & AI insights</p>
          </div>
          
          <Button
            onClick={() => setShowAIChat(true)}
            className="bg-primary-foreground text-primary p-2 rounded-full shadow-lg hover:scale-105 transition-transform"
            data-testid="admin-ai-assistant"
          >
            <i className="fas fa-robot text-lg"></i>
          </Button>
        </div>

        {/* Real-time Overview */}
        <div className="mt-4 grid grid-cols-3 gap-3">
          <div className="bg-primary-foreground/10 rounded-lg p-3 text-center">
            <p className="text-2xl font-bold">{activeTimeEntries.length}</p>
            <p className="text-xs opacity-80">Currently Clocked In</p>
          </div>
          <div className="bg-primary-foreground/10 rounded-lg p-3 text-center">
            <p className="text-2xl font-bold">{completedTasksToday}/{totalTasksToday}</p>
            <p className="text-xs opacity-80">Tasks Completed</p>
          </div>
          <div className="bg-primary-foreground/10 rounded-lg p-3 text-center">
            <p className="text-2xl font-bold">{formatTime(currentTime)}</p>
            <p className="text-xs opacity-80">Current Time</p>
          </div>
        </div>
      </header>

      <div className="p-4">
        <Tabs defaultValue="overview" className="w-full">
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="team">Team</TabsTrigger>
            <TabsTrigger value="tasks">Tasks</TabsTrigger>
            <TabsTrigger value="ai">AI Control</TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="space-y-4">
            {/* AI Insights */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center">
                  <i className="fas fa-brain text-primary mr-2"></i>
                  AI Insights & Alerts
                </CardTitle>
              </CardHeader>
              <CardContent>
                {insights && insights.length > 0 ? (
                  <div className="space-y-3">
                    {insights.slice(0, 3).map((insight: any) => (
                      <div
                        key={insight.id}
                        className={`border rounded-lg p-3 ${
                          insight.severity === 'high' 
                            ? 'bg-red-50 border-red-200' 
                            : insight.severity === 'medium'
                            ? 'bg-yellow-50 border-yellow-200'
                            : 'bg-blue-50 border-blue-200'
                        }`}
                      >
                        <div className="flex items-start space-x-2">
                          <i className={`fas ${
                            insight.severity === 'high' 
                              ? 'fa-exclamation-circle text-red-600' 
                              : insight.severity === 'medium'
                              ? 'fa-exclamation-triangle text-yellow-600'
                              : 'fa-info-circle text-blue-600'
                          } text-sm mt-0.5`}></i>
                          <div>
                            <p className="text-sm font-medium">{insight.title}</p>
                            <p className="text-xs text-muted-foreground">{insight.description}</p>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-4">
                    <i className="fas fa-chart-line text-muted-foreground text-xl mb-2"></i>
                    <p className="text-muted-foreground text-sm">AI is analyzing team data...</p>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Team Performance */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Team Performance</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 gap-4 mb-4">
                  <div className="text-center">
                    <p className="text-2xl font-bold text-green-600">94%</p>
                    <p className="text-xs text-muted-foreground">Team Attendance</p>
                  </div>
                  <div className="text-center">
                    <p className="text-2xl font-bold text-blue-600">87%</p>
                    <p className="text-xs text-muted-foreground">Task Completion</p>
                  </div>
                </div>

                <div className="space-y-2">
                  <div className="flex justify-between text-sm">
                    <span>Weekly Target</span>
                    <span>On Track</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span>Labor Cost</span>
                    <span className="text-green-600">Under Budget</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span>Overtime</span>
                    <span className="text-yellow-600">Within Limits</span>
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="team" className="space-y-4">
            {/* Currently Active */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center">
                  <i className="fas fa-users-clock text-primary mr-2"></i>
                  Currently Active ({activeTimeEntries.length})
                </CardTitle>
              </CardHeader>
              <CardContent>
                {activeTimeEntries.length === 0 ? (
                  <div className="text-center py-4">
                    <i className="fas fa-user-clock text-muted-foreground text-xl mb-2"></i>
                    <p className="text-muted-foreground text-sm">No team members currently clocked in</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {activeTimeEntries.map((entry: any) => (
                      <div key={entry.id} className="flex items-center justify-between p-3 bg-green-50 rounded-lg border border-green-200">
                        <div className="flex items-center space-x-3">
                          <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></div>
                          <div>
                            <p className="font-medium text-sm">Employee {entry.userId.slice(-4)}</p>
                            <p className="text-xs text-green-700">
                              Started at {new Date(entry.clockInTime).toLocaleTimeString('en-US', { hour12: true })}
                            </p>
                          </div>
                        </div>
                        <div className="text-right">
                          <p className="text-sm font-medium">
                            {(() => {
                              const now = new Date();
                              const clockIn = new Date(entry.clockInTime);
                              const hours = (now.getTime() - clockIn.getTime()) / (1000 * 60 * 60);
                              return `${hours.toFixed(1)}h`;
                            })()}
                          </p>
                          <p className="text-xs text-green-600">Active</p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Today's Schedule */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Today's Schedule Overview</CardTitle>
              </CardHeader>
              <CardContent>
                {schedulesLoading ? (
                  <div className="space-y-2">
                    {[...Array(3)].map((_, i) => (
                      <div key={i} className="animate-pulse h-16 bg-muted rounded-lg"></div>
                    ))}
                  </div>
                ) : (
                  <div className="space-y-2">
                    {schedules?.filter((schedule: any) => {
                      const scheduleDate = new Date(schedule.startTime);
                      return scheduleDate.toDateString() === today.toDateString();
                    }).length === 0 ? (
                      <div className="text-center py-4">
                        <i className="fas fa-calendar text-muted-foreground text-xl mb-2"></i>
                        <p className="text-muted-foreground text-sm">No scheduled shifts for today</p>
                      </div>
                    ) : (
                      schedules
                        ?.filter((schedule: any) => {
                          const scheduleDate = new Date(schedule.startTime);
                          return scheduleDate.toDateString() === today.toDateString();
                        })
                        .map((schedule: any) => (
                          <div key={schedule.id} className="flex items-center justify-between p-3 bg-muted/50 rounded-lg">
                            <div>
                              <p className="font-medium text-sm">{schedule.title || 'Shift'}</p>
                              <p className="text-xs text-muted-foreground">
                                Employee {schedule.userId.slice(-4)} • {new Date(schedule.startTime).toLocaleTimeString('en-US', { hour12: true })} - {new Date(schedule.endTime).toLocaleTimeString('en-US', { hour12: true })}
                              </p>
                            </div>
                            <div className="text-xs">
                              {(() => {
                                const now = new Date();
                                const start = new Date(schedule.startTime);
                                const end = new Date(schedule.endTime);
                                
                                if (now >= start && now <= end) {
                                  return <span className="bg-green-100 text-green-800 px-2 py-1 rounded-full">Active</span>;
                                } else if (now < start) {
                                  return <span className="bg-blue-100 text-blue-800 px-2 py-1 rounded-full">Upcoming</span>;
                                } else {
                                  return <span className="bg-gray-100 text-gray-800 px-2 py-1 rounded-full">Complete</span>;
                                }
                              })()}
                            </div>
                          </div>
                        ))
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="tasks" className="space-y-4">
            {/* AI Task Assignment */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center">
                  <i className="fas fa-robot text-primary mr-2"></i>
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
                    <>
                      <i className="fas fa-spinner fa-spin mr-2"></i>
                      AI Assigning Tasks...
                    </>
                  ) : (
                    <>
                      <i className="fas fa-magic mr-2"></i>
                      Auto-Assign Tasks with Claude AI
                    </>
                  )}
                </Button>

                <div className="grid grid-cols-2 gap-3">
                  <div className="text-center">
                    <p className="text-xl font-bold text-primary">{todayTasks.length}</p>
                    <p className="text-xs text-muted-foreground">Total Tasks Today</p>
                  </div>
                  <div className="text-center">
                    <p className="text-xl font-bold text-green-600">{completedTasksToday}</p>
                    <p className="text-xs text-muted-foreground">Completed</p>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Task Overview */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Task Status</CardTitle>
              </CardHeader>
              <CardContent>
                {tasksLoading ? (
                  <div className="space-y-2">
                    {[...Array(3)].map((_, i) => (
                      <div key={i} className="animate-pulse h-12 bg-muted rounded-lg"></div>
                    ))}
                  </div>
                ) : tasks?.length === 0 ? (
                  <div className="text-center py-4">
                    <i className="fas fa-tasks text-muted-foreground text-xl mb-2"></i>
                    <p className="text-muted-foreground text-sm">No tasks created yet</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {tasks?.slice(0, 5).map((task: any) => (
                      <div key={task.id} className="flex items-center justify-between p-3 bg-muted/50 rounded-lg">
                        <div>
                          <p className="font-medium text-sm">{task.title}</p>
                          <div className="flex items-center space-x-2 mt-1">
                            {task.isAIAssigned && (
                              <span className="text-xs bg-gradient-to-r from-primary to-accent text-primary-foreground px-2 py-0.5 rounded-full">
                                AI Assigned
                              </span>
                            )}
                            <span className="text-xs text-muted-foreground">
                              Assigned to Employee {task.assignedTo?.slice(-4) || 'Unassigned'}
                            </span>
                          </div>
                        </div>
                        <span className={`text-xs px-2 py-1 rounded-full ${
                          task.status === 'completed' 
                            ? 'bg-green-100 text-green-800'
                            : task.status === 'in_progress'
                            ? 'bg-yellow-100 text-yellow-800'
                            : 'bg-gray-100 text-gray-800'
                        }`}>
                          {task.status.replace('_', ' ')}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="ai" className="space-y-4">
            {/* AI Configuration */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center">
                  <i className="fas fa-cogs text-primary mr-2"></i>
                  AI Parameters
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium">Overtime Prevention</p>
                      <p className="text-xs text-muted-foreground">Auto-alert when approaching overtime</p>
                    </div>
                    <Switch defaultChecked data-testid="overtime-prevention" />
                  </div>
                  
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium">Anomaly Detection</p>
                      <p className="text-xs text-muted-foreground">Monitor unusual clock-in/out patterns</p>
                    </div>
                    <Switch defaultChecked data-testid="anomaly-detection" />
                  </div>
                  
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium">Auto Task Assignment</p>
                      <p className="text-xs text-muted-foreground">Automatically assign tasks to optimal team members</p>
                    </div>
                    <Switch defaultChecked data-testid="auto-task-assignment" />
                  </div>
                  
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium">Payroll Analysis</p>
                      <p className="text-xs text-muted-foreground">AI-powered timesheet error detection</p>
                    </div>
                    <Switch defaultChecked data-testid="payroll-analysis" />
                  </div>
                </div>

                <div className="pt-4 border-t">
                  <h4 className="font-medium text-sm mb-2">Overtime Threshold</h4>
                  <div className="flex items-center space-x-2">
                    <span className="text-sm">8 hours/day</span>
                    <span className="text-xs text-muted-foreground">•</span>
                    <span className="text-sm">40 hours/week</span>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* AI Analytics */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">AI Analytics Summary</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  <div className="flex justify-between items-center">
                    <span className="text-sm">Tasks Auto-Assigned This Week</span>
                    <span className="font-medium">12</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-sm">Anomalies Detected</span>
                    <span className="font-medium text-yellow-600">2</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-sm">Cost Savings Identified</span>
                    <span className="font-medium text-green-600">$245</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-sm">AI Accuracy Rate</span>
                    <span className="font-medium">97%</span>
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>

      {/* AI Chat Modal */}
      <AIChatModal
        isOpen={showAIChat}
        onClose={() => setShowAIChat(false)}
      />
    </div>
  );
}
