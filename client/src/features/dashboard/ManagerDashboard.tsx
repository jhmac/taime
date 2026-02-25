import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useLocation } from 'wouter';
import { useAuth } from '@/hooks/useAuth';
import { useIsMobile } from '@/hooks/use-mobile';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import { DashboardErrorBoundary } from '@/features/dashboard/DashboardErrorBoundary';
import MiddayPulseCard from '@/components/MiddayPulseCard';
import ImprovementFeedWidget from '@/components/ImprovementFeedWidget';
import KudosWidget from '@/components/KudosWidget';
import GTDDashboardWidget from '@/features/gtd/GTDDashboardWidget';
import WeeklyReviewCard from '@/features/gtd/WeeklyReviewCard';
import LeanBoardCard from '@/features/dashboard/LeanBoardCard';
import SOPInsightsCard from '@/features/dashboard/SOPInsightsCard';
import BackgroundInsightsCard from '@/features/dashboard/BackgroundInsightsCard';
import SOPRevisionCard from '@/features/dashboard/SOPRevisionCard';
import SurfacedSOPBanner from '@/components/SurfacedSOPBanner';
import {
  Users,
  UserCheck,
  CalendarDays,
  CheckSquare,
  Sun,
  Check,
  AlertTriangle,
  Clock,
  ChevronRight,
  CircleAlert,
  ListTodo,
  Bot,
} from 'lucide-react';

export default function ManagerDashboard() {
  const { user } = useAuth();
  const isMobile = useIsMobile();
  const [, navigate] = useLocation();
  const [currentTime, setCurrentTime] = useState(new Date());

  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 60000);
    return () => clearInterval(timer);
  }, []);

  const { data: timeEntries } = useQuery<any[]>({ queryKey: ['/api/time-entries'] });
  const { data: users } = useQuery<any[]>({ queryKey: ['/api/users'] });
  const { data: schedules } = useQuery<any[]>({ queryKey: ['/api/schedules'] });
  const { data: tasks, isLoading: tasksLoading } = useQuery<any[]>({ queryKey: ['/api/tasks'] });
  const { data: issues, isLoading: issuesLoading } = useQuery<any[]>({ queryKey: ['/api/issues'] });
  const { data: sopExecutions, isLoading: sopsLoading } = useQuery<any[]>({ queryKey: ['/api/sops/executions'] });
  const { data: huddleData } = useQuery<any>({ queryKey: ['/api/rituals/huddle/today'] });

  const today = new Date();
  const todayStr = today.toDateString();

  const activeEntries = (timeEntries || []).filter((e: any) => !e.clockOutTime);
  const totalEmployees = (users || []).length;
  const todaySchedules = (schedules || []).filter((s: any) => new Date(s.startTime).toDateString() === todayStr);
  const todayTasks = (tasks || []).filter((t: any) => new Date(t.createdAt).toDateString() === todayStr);
  const completedToday = todayTasks.filter((t: any) => t.status === 'completed').length;

  const getUserName = (userId: string) => {
    const u = (users || []).find((u: any) => u.id === userId);
    return u ? `${u.firstName} ${u.lastName}` : `#${userId.slice(-4)}`;
  };

  const getGreeting = () => {
    const hour = currentTime.getHours();
    if (hour < 12) return 'Good morning';
    if (hour < 17) return 'Good afternoon';
    return 'Good evening';
  };

  const formatTime = (date: Date) =>
    date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });

  const openIssues = (issues || []).filter((i: any) => i.status === 'open' || i.status === 'in_progress');
  const issueCounts = {
    urgent: openIssues.filter((i: any) => i.priority === 'urgent').length,
    high: openIssues.filter((i: any) => i.priority === 'high').length,
    medium: openIssues.filter((i: any) => i.priority === 'medium').length,
    low: openIssues.filter((i: any) => i.priority === 'low').length,
  };

  const todaySopExecutions = (sopExecutions || []).filter(
    (e: any) => new Date(e.startedAt || e.createdAt).toDateString() === todayStr
  );
  const completedSops = todaySopExecutions.filter((e: any) => e.status === 'completed').length;
  const totalSops = todaySopExecutions.length;
  const sopProgress = totalSops > 0 ? Math.round((completedSops / totalSops) * 100) : 0;

  const { overdueTasks, dueTodayTasks, upcomingTasks } = (tasks || []).reduce(
    (acc: { overdueTasks: any[]; dueTodayTasks: any[]; upcomingTasks: any[] }, t: any) => {
      if (t.status === 'completed' || !t.dueDate) return acc;
      const due = new Date(t.dueDate);
      const dueStr = due.toDateString();
      if (dueStr === todayStr) acc.dueTodayTasks.push(t);
      else if (due < today) acc.overdueTasks.push(t);
      else acc.upcomingTasks.push(t);
      return acc;
    },
    { overdueTasks: [], dueTodayTasks: [], upcomingTasks: [] }
  );

  const huddleDone = huddleData?.data?.completedAt || huddleData?.completedAt;

  return (
    <div className="min-h-full bg-background">
      <DashboardErrorBoundary fallback="Could not load header">
        <section className="bg-gradient-to-br from-primary to-primary/80 text-primary-foreground p-5 md:p-6 md:rounded-xl md:m-6 md:mt-4">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-lg md:text-xl font-bold">
                {getGreeting()}, {(user as any)?.firstName || 'Manager'}!
              </h1>
              <p className="text-sm opacity-80">
                {currentTime.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })} &bull; {formatTime(currentTime)}
              </p>
            </div>
            <Button
              onClick={() => window.dispatchEvent(new Event("open-ask-mainager"))}
              size="icon"
              className="bg-white/20 hover:bg-white/30 text-white rounded-full h-10 w-10"
            >
              <Bot className="h-5 w-5" />
            </Button>
          </div>
        </section>
      </DashboardErrorBoundary>

      <div className={isMobile ? "px-4 py-3" : "px-6 py-4"}>
        <DashboardErrorBoundary fallback="Could not load metrics">
          <div className={isMobile ? "grid grid-cols-2 gap-3" : "grid grid-cols-4 gap-4"}>
            <Card>
              <CardContent className="p-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center flex-shrink-0">
                    <UserCheck className="h-5 w-5 text-green-600 dark:text-green-400" />
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
                    <Users className="h-5 w-5 text-blue-600 dark:text-blue-400" />
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
                    <CalendarDays className="h-5 w-5 text-amber-600 dark:text-amber-400" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-2xl font-bold">{todaySchedules.length}</p>
                    <p className="text-xs text-muted-foreground truncate">Shifts Today</p>
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-purple-100 dark:bg-purple-900/30 flex items-center justify-center flex-shrink-0">
                    <CheckSquare className="h-5 w-5 text-purple-600 dark:text-purple-400" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-2xl font-bold">{completedToday}/{todayTasks.length}</p>
                    <p className="text-xs text-muted-foreground truncate">Tasks Done</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </DashboardErrorBoundary>
      </div>

      <div className={isMobile ? "px-4 pb-1" : "px-6 pb-2"}>
        <DashboardErrorBoundary fallback="Could not load SOP banner">
          <SurfacedSOPBanner />
        </DashboardErrorBoundary>
      </div>

      <div className={isMobile ? "px-4 pb-4 space-y-4" : "px-6 pb-6"}>
        <div className={isMobile ? "space-y-4" : "grid grid-cols-2 gap-6"}>
          <DashboardErrorBoundary fallback="Could not load morning huddle">
            <Card
              className={`cursor-pointer hover:shadow-md transition-shadow ${
                huddleDone
                  ? 'bg-green-50/50 dark:bg-green-950/10 border-green-200/50 dark:border-green-800/30'
                  : 'bg-gradient-to-r from-amber-50 to-orange-50 dark:from-amber-950/20 dark:to-orange-950/20 border-amber-200/50 dark:border-amber-800/30'
              }`}
              onClick={() => !huddleDone && navigate('/huddle')}
            >
              <CardContent className="p-4 flex items-center gap-3">
                <div className={`w-11 h-11 rounded-full flex items-center justify-center shrink-0 ${
                  huddleDone
                    ? 'bg-green-100 dark:bg-green-900/40'
                    : 'bg-amber-100 dark:bg-amber-900/40'
                }`}>
                  {huddleDone ? (
                    <Check className="h-5 w-5 text-green-600 dark:text-green-400" />
                  ) : (
                    <Sun className="h-5 w-5 text-amber-600 dark:text-amber-400" />
                  )}
                </div>
                <div className="flex-1">
                  <h3 className="text-sm font-bold">
                    {huddleDone ? 'Morning Huddle Complete' : 'Start Morning Huddle'}
                  </h3>
                  <p className="text-xs text-muted-foreground">
                    {huddleDone ? "Today's huddle is done" : "Rally the team for today's standup"}
                  </p>
                </div>
                {!huddleDone && <ChevronRight className="h-4 w-4 text-muted-foreground" />}
              </CardContent>
            </Card>
          </DashboardErrorBoundary>

          <DashboardErrorBoundary fallback="Could not load team on shift">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Clock className="h-4 w-4 text-green-600" />
                  Team On Shift ({activeEntries.length})
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-0">
                {activeEntries.length === 0 ? (
                  <div className="text-center py-6">
                    <Clock className="h-8 w-8 text-muted-foreground/30 mx-auto mb-2" />
                    <p className="text-sm text-muted-foreground">No one clocked in right now</p>
                  </div>
                ) : (
                  <div className="space-y-2 max-h-[200px] overflow-auto">
                    {activeEntries.map((entry: any) => {
                      const hoursWorked = ((Date.now() - new Date(entry.clockInTime).getTime()) / 3600000).toFixed(1);
                      return (
                        <div key={entry.id} className="flex items-center justify-between p-2.5 bg-green-50 dark:bg-green-900/10 rounded-lg border border-green-200/50 dark:border-green-800/30">
                          <div className="flex items-center gap-2">
                            <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
                            <div>
                              <p className="font-medium text-sm">{getUserName(entry.userId)}</p>
                              <p className="text-xs text-muted-foreground">
                                In at {new Date(entry.clockInTime).toLocaleTimeString('en-US', { hour12: true, hour: 'numeric', minute: '2-digit' })}
                              </p>
                            </div>
                          </div>
                          <span className="text-sm font-medium">{hoursWorked}h</span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </CardContent>
            </Card>
          </DashboardErrorBoundary>

          <DashboardErrorBoundary fallback="Could not load open issues">
            <Card className="cursor-pointer hover:shadow-md transition-shadow" onClick={() => navigate('/issues')}>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <CircleAlert className="h-4 w-4 text-red-500" />
                    Open Issues ({openIssues.length})
                  </CardTitle>
                  <ChevronRight className="h-4 w-4 text-muted-foreground" />
                </div>
              </CardHeader>
              <CardContent className="pt-0">
                {issuesLoading ? (
                  <div className="space-y-2">
                    {[1,2].map(i => <Skeleton key={i} className="h-6 w-full" />)}
                  </div>
                ) : openIssues.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-4">No open issues</p>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {issueCounts.urgent > 0 && (
                      <Badge className="bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400 border-0">
                        {issueCounts.urgent} Urgent
                      </Badge>
                    )}
                    {issueCounts.high > 0 && (
                      <Badge className="bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400 border-0">
                        {issueCounts.high} High
                      </Badge>
                    )}
                    {issueCounts.medium > 0 && (
                      <Badge className="bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400 border-0">
                        {issueCounts.medium} Medium
                      </Badge>
                    )}
                    {issueCounts.low > 0 && (
                      <Badge className="bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400 border-0">
                        {issueCounts.low} Low
                      </Badge>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          </DashboardErrorBoundary>

          <DashboardErrorBoundary fallback="Could not load SOP completion">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm flex items-center gap-2">
                  <CheckSquare className="h-4 w-4 text-primary" />
                  SOP Completion Today
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-0">
                {sopsLoading ? (
                  <Skeleton className="h-10 w-full" />
                ) : totalSops === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-4">No SOP executions today</p>
                ) : (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground">{completedSops} of {totalSops} completed</span>
                      <span className="font-bold">{sopProgress}%</span>
                    </div>
                    <Progress value={sopProgress} className="h-2" />
                  </div>
                )}
              </CardContent>
            </Card>
          </DashboardErrorBoundary>

          <DashboardErrorBoundary fallback="Could not load tasks overview">
            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <ListTodo className="h-4 w-4 text-primary" />
                    Tasks Overview
                  </CardTitle>
                  <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => navigate('/tasks')}>
                    View All <ChevronRight className="h-3 w-3 ml-1" />
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="pt-0">
                {tasksLoading ? (
                  <div className="space-y-2">
                    {[1,2,3].map(i => <Skeleton key={i} className="h-8 w-full" />)}
                  </div>
                ) : (
                  <div className="space-y-3">
                    <div className="flex items-center gap-3">
                      <div className="flex items-center gap-2 flex-1">
                        <div className="w-3 h-3 rounded-full bg-red-500" />
                        <span className="text-sm">Overdue</span>
                      </div>
                      <Badge variant="outline" className="text-red-600 border-red-200 dark:text-red-400 dark:border-red-800">
                        {overdueTasks.length}
                      </Badge>
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="flex items-center gap-2 flex-1">
                        <div className="w-3 h-3 rounded-full bg-yellow-500" />
                        <span className="text-sm">Due Today</span>
                      </div>
                      <Badge variant="outline" className="text-yellow-600 border-yellow-200 dark:text-yellow-400 dark:border-yellow-800">
                        {dueTodayTasks.length}
                      </Badge>
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="flex items-center gap-2 flex-1">
                        <div className="w-3 h-3 rounded-full bg-blue-500" />
                        <span className="text-sm">Upcoming</span>
                      </div>
                      <Badge variant="outline" className="text-blue-600 border-blue-200 dark:text-blue-400 dark:border-blue-800">
                        {upcomingTasks.length}
                      </Badge>
                    </div>
                    {overdueTasks.length > 0 && (
                      <div className="border-t pt-2 mt-2 space-y-1.5">
                        {overdueTasks.slice(0, 3).map((t: any) => (
                          <div key={t.id} className="flex items-center gap-2 text-xs p-2 bg-red-50 dark:bg-red-950/10 rounded-lg">
                            <AlertTriangle className="h-3 w-3 text-red-500 shrink-0" />
                            <span className="truncate">{t.title}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          </DashboardErrorBoundary>

          <DashboardErrorBoundary fallback="GTD widget failed to load">
            <GTDDashboardWidget />
          </DashboardErrorBoundary>

          <DashboardErrorBoundary fallback="Weekly review card failed to load">
            <WeeklyReviewCard />
          </DashboardErrorBoundary>

          <DashboardErrorBoundary fallback="AI insights card failed to load">
            <BackgroundInsightsCard />
          </DashboardErrorBoundary>

          <DashboardErrorBoundary fallback="SOP insights card failed to load">
            <SOPInsightsCard />
          </DashboardErrorBoundary>

          <DashboardErrorBoundary fallback="SOP revision card failed to load">
            <SOPRevisionCard />
          </DashboardErrorBoundary>

          <DashboardErrorBoundary fallback="Lean board card failed to load">
            <LeanBoardCard />
          </DashboardErrorBoundary>

          <DashboardErrorBoundary fallback="Could not load team kudos">
            <KudosWidget />
          </DashboardErrorBoundary>

          <DashboardErrorBoundary fallback="Could not load midday pulse">
            <MiddayPulseCard />
          </DashboardErrorBoundary>

          <DashboardErrorBoundary fallback="Could not load improvement feed">
            <ImprovementFeedWidget />
          </DashboardErrorBoundary>
        </div>
      </div>

    </div>
  );
}
