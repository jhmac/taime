import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useLocation } from 'wouter';
import { useAuth } from '@/hooks/useAuth';
import { useIsMobile } from '@/hooks/use-mobile';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import SurfacedSOPBanner from '@/components/SurfacedSOPBanner';
import MiddayPulseCard from '@/components/MiddayPulseCard';
import ImprovementFeedWidget from '@/components/ImprovementFeedWidget';
import { DashboardErrorBoundary } from '@/features/dashboard/DashboardErrorBoundary';
import GTDDashboardWidget from '@/features/gtd/GTDDashboardWidget';
import WeeklyReviewCard from '@/features/gtd/WeeklyReviewCard';
import LeanBoardCard from '@/features/dashboard/LeanBoardCard';
import SOPInsightsCard from '@/features/dashboard/SOPInsightsCard';
import BackgroundInsightsCard from '@/features/dashboard/BackgroundInsightsCard';
import SOPRevisionCard from '@/features/dashboard/SOPRevisionCard';
import CashStatusCard from '@/features/dashboard/CashStatusCard';
import TimeClockWidget from '@/components/TimeClockWidget';
import {
  Briefcase, Users, ShieldCheck, AlertTriangle, TrendingUp,
  Calendar, DollarSign, ClipboardList, BarChart3, Settings,
  Bot, Clock, Video, ShoppingBag, ExternalLink,
  AlertCircle, CheckCircle2, MessageSquareQuestion,
} from 'lucide-react';

export default function OwnerDashboard() {
  const { user } = useAuth();
  const isMobile = useIsMobile();
  const [, navigate] = useLocation();
  const [currentTime, setCurrentTime] = useState(new Date());

  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 60000);
    return () => clearInterval(timer);
  }, []);

  // Pre-hydrated by DashboardRouter from /api/dashboard/init — no network request on first render
  const { data: todaySummary } = useQuery<{ totalClockedIn: number; totalScheduled: number; activeEntries: any[] } | null>({
    queryKey: ['/api/dashboard/today-summary'],
    staleTime: 60 * 1000,
    enabled: false,
  });

  // Defer non-critical list queries until after first paint
  const [deferredEnabled, setDeferredEnabled] = useState(false);
  useEffect(() => {
    const enable = () => setDeferredEnabled(true);
    if (typeof (window as Window & typeof globalThis).requestIdleCallback === 'function') {
      const id = (window as Window & typeof globalThis).requestIdleCallback(enable);
      return () => (window as Window & typeof globalThis).cancelIdleCallback(id);
    }
    const id = setTimeout(enable, 200);
    return () => clearTimeout(id);
  }, []);

  const { data: unansweredCountData } = useQuery<{ pending: number }>({
    queryKey: ['/api/ai/questions/count'],
    refetchInterval: 60000,
    staleTime: 30000,
  });
  const unansweredCount = unansweredCountData?.pending || 0;

  const { data: analyticsData, isLoading: analyticsLoading } = useQuery<any>({
    queryKey: ['/api/analytics/dashboard'],
    enabled: deferredEnabled,
  });

  const { data: shopifyData, isLoading: shopifyLoading } = useQuery<any>({
    queryKey: ['/api/shopify/sales-data'],
    enabled: deferredEnabled,
  });

  const { data: dashboardToday, isLoading: dashboardLoading } = useQuery<any>({
    queryKey: ['/api/dashboard/today'],
    enabled: deferredEnabled,
  });

  const { data: sopExecutionsRaw, isLoading: sopsLoading } = useQuery<any>({
    queryKey: ['/api/sops/executions'],
    enabled: deferredEnabled,
  });
  const sopExecutions = Array.isArray(sopExecutionsRaw) ? sopExecutionsRaw : (sopExecutionsRaw?.data || []);

  const { data: issuesRaw, isLoading: issuesLoading } = useQuery<any>({
    queryKey: ['/api/issues'],
    enabled: deferredEnabled,
  });
  const issues = Array.isArray(issuesRaw) ? issuesRaw : (issuesRaw?.data || []);

  const { data: tasks, isLoading: tasksLoading } = useQuery<any[]>({
    queryKey: ['/api/tasks'],
    enabled: deferredEnabled,
  });

  const { data: improvementVideos } = useQuery<any[]>({
    queryKey: ['/api/improvement-videos'],
    enabled: deferredEnabled,
  });

  const getGreeting = () => {
    const hour = currentTime.getHours();
    if (hour < 12) return 'Good morning';
    if (hour < 17) return 'Good afternoon';
    return 'Good evening';
  };

  const now = new Date();
  const startOfWeek = new Date(now);
  startOfWeek.setDate(now.getDate() - now.getDay());
  startOfWeek.setHours(0, 0, 0, 0);

  const weeklyExecutions = (sopExecutions || []).filter(
    (e: any) => new Date(e.startedAt || e.createdAt) >= startOfWeek
  );
  const completedWeeklyExecutions = weeklyExecutions.filter((e: any) => e.status === 'completed');
  const sopCompletionRate = weeklyExecutions.length > 0
    ? Math.round((completedWeeklyExecutions.length / weeklyExecutions.length) * 100)
    : 0;

  const resolvedIssues = (issues || []).filter((i: any) => i.status === 'resolved' || i.status === 'closed');
  const avgResolutionTime = resolvedIssues.length > 0
    ? resolvedIssues.reduce((sum: number, i: any) => {
        const created = new Date(i.createdAt).getTime();
        const resolved = new Date(i.resolvedAt || i.updatedAt).getTime();
        return sum + (resolved - created);
      }, 0) / resolvedIssues.length / 3600000
    : 0;

  const allTasks = tasks || [];
  const completedTasks = allTasks.filter((t: any) => t.status === 'completed');
  const taskCompletionRate = allTasks.length > 0
    ? Math.round((completedTasks.length / allTasks.length) * 100)
    : 0;

  const weeklyVideos = (improvementVideos || []).filter(
    (v: any) => new Date(v.createdAt) >= startOfWeek
  );

  const urgentIssues = (issues || []).filter(
    (i: any) => (i.priority === 'urgent' || i.priority === 'high') && i.status !== 'resolved' && i.status !== 'closed'
  );
  const overdueTasks = allTasks.filter(
    (t: any) => t.status !== 'completed' && t.dueDate && new Date(t.dueDate) < now
  );

  const flaggedItems = [
    ...urgentIssues.map((i: any) => ({
      type: 'issue' as const,
      label: i.title || `Issue #${String(i.id).slice(-4)}`,
      priority: i.priority,
      link: `/issues/${i.id}`,
    })),
    ...overdueTasks.map((t: any) => ({
      type: 'task' as const,
      label: t.title || `Task #${String(t.id).slice(-4)}`,
      priority: 'overdue',
      link: '/tasks',
    })),
  ].slice(0, 8);

  return (
    <div className="min-h-full bg-background">
      <DashboardErrorBoundary fallback="Header failed to load">
        <section className="bg-gradient-to-br from-slate-900 to-slate-800 text-white p-5 md:p-8 md:rounded-xl md:m-6 md:mt-4">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-lg md:text-2xl font-bold">
                {getGreeting()}, {(user as any)?.firstName || 'Owner'}
              </h1>
              <p className="text-sm opacity-70 mt-1">
                Here's your business at a glance &bull;{' '}
                {currentTime.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
              </p>
            </div>
            <Button
              onClick={() => window.dispatchEvent(new Event("open-ask-mainager"))}
              size="icon"
              className="bg-white/10 hover:bg-white/20 text-white rounded-full h-10 w-10"
            >
              <Bot className="h-5 w-5" />
            </Button>
          </div>
        </section>
      </DashboardErrorBoundary>

      <div className={isMobile ? 'px-4 pt-3 pb-1 space-y-4' : 'px-6 pt-4 pb-2 space-y-4'}>
        <DashboardErrorBoundary fallback="Time clock failed to load">
          <TimeClockWidget />
        </DashboardErrorBoundary>

        <DashboardErrorBoundary fallback="Could not load SOP banner">
          <SurfacedSOPBanner />
        </DashboardErrorBoundary>
      </div>

      <div className={isMobile ? 'px-4 pb-3 space-y-4' : 'px-6 pb-4 space-y-6'}>
        <DashboardErrorBoundary fallback="Morning Whisper failed to load">
          <Card className="border-gray-200 dark:border-gray-700">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2 text-muted-foreground">
                <Briefcase className="h-4 w-4" />
                Morning Whisper (Preview)
              </CardTitle>
            </CardHeader>
            <CardContent>
              {analyticsLoading ? (
                <div className="space-y-2">
                  <Skeleton className="h-4 w-3/4" />
                  <Skeleton className="h-4 w-1/2" />
                </div>
              ) : (
                <div className="grid grid-cols-3 gap-4">
                  <div className="text-center">
                    <p className="text-2xl font-bold">{analyticsData?.totalHours?.toFixed(1) || '—'}</p>
                    <p className="text-xs text-muted-foreground">Total Hours</p>
                  </div>
                  <div className="text-center">
                    <p className="text-2xl font-bold">{analyticsData?.tasksCompleted ?? completedTasks.length}</p>
                    <p className="text-xs text-muted-foreground">Tasks Completed</p>
                  </div>
                  <div className="text-center">
                    <p className="text-2xl font-bold">{analyticsData?.punctuality ? `${analyticsData.punctuality}%` : '—'}</p>
                    <p className="text-xs text-muted-foreground">Punctuality</p>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </DashboardErrorBoundary>

        <DashboardErrorBoundary fallback="Sales data failed to load">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <ShoppingBag className="h-4 w-4 text-green-600" />
                Sales Snapshot
              </CardTitle>
            </CardHeader>
            <CardContent>
              {shopifyLoading ? (
                <div className="space-y-2">
                  <Skeleton className="h-8 w-1/3" />
                  <Skeleton className="h-4 w-2/3" />
                </div>
              ) : shopifyData?.todayRevenue !== undefined ? (
                <div className="space-y-3">
                  <div className="flex items-end gap-3">
                    <div>
                      <p className="text-3xl font-bold text-green-600">${Number(shopifyData.todayRevenue || 0).toFixed(0)}</p>
                      <p className="text-xs text-muted-foreground">Today's Revenue</p>
                    </div>
                    {shopifyData.lastWeekRevenue !== undefined && shopifyData.lastWeekRevenue > 0 && (
                      <div className="flex items-center gap-1 text-sm">
                        <TrendingUp className="h-4 w-4 text-muted-foreground" />
                        <span className="text-muted-foreground">
                          vs ${Number(shopifyData.lastWeekRevenue || 0).toFixed(0)} last week
                        </span>
                      </div>
                    )}
                  </div>
                  {shopifyData.orderCount !== undefined && (
                    <p className="text-sm text-muted-foreground">
                      {shopifyData.orderCount} orders today
                    </p>
                  )}
                </div>
              ) : (
                <div className="text-center py-4">
                  <ShoppingBag className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
                  <p className="text-sm text-muted-foreground mb-2">Connect Shopify to see sales data</p>
                  <Button variant="outline" size="sm" onClick={() => navigate('/admin')}>
                    <ExternalLink className="h-3 w-3 mr-1" /> Connect
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        </DashboardErrorBoundary>

        <DashboardErrorBoundary fallback="Team health failed to load">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <Users className="h-4 w-4 text-[#F47D31]" />
                Team Health
              </CardTitle>
            </CardHeader>
            <CardContent>
              {dashboardLoading ? (
                <div className="space-y-2">
                  <Skeleton className="h-4 w-full" />
                  <Skeleton className="h-4 w-2/3" />
                  <Skeleton className="h-4 w-3/4" />
                </div>
              ) : (() => {
                const totalIn = dashboardToday?.summary?.totalClockedIn ?? 0;
                const totalSched = dashboardToday?.summary?.totalScheduled ?? 0;
                const notArrived = dashboardToday?.summary?.totalNotArrived ?? 0;
                const onShift: any[] = dashboardToday?.clockedIn ?? [];
                const upcoming: any[] = (dashboardToday?.schedules ?? []).filter((s: any) => !s.isClockedIn && !s.shiftPassed);
                return (
                  <div className="space-y-3">
                    {/* Summary */}
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-1.5">
                        <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
                        <span className="text-sm font-semibold">{totalIn}</span>
                        <span className="text-sm text-muted-foreground">on shift</span>
                      </div>
                      <span className="text-xs text-muted-foreground">{totalSched} scheduled today</span>
                    </div>

                    {/* Not-arrived alert */}
                    {notArrived > 0 && (
                      <div className="flex items-center gap-1.5 bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-800/40 rounded-md px-2.5 py-1.5">
                        <AlertCircle className="h-3 w-3 text-red-600 dark:text-red-400 shrink-0" />
                        <span className="text-xs font-medium text-red-700 dark:text-red-400">
                          {notArrived} not clocked in yet
                        </span>
                      </div>
                    )}

                    {/* Currently on shift */}
                    {onShift.length > 0 && (
                      <div className="space-y-1.5">
                        <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">On Shift Now</p>
                        {onShift.slice(0, 5).map((emp: any) => (
                          <div key={emp.userId} className="flex items-center justify-between">
                            <div className="flex items-center gap-1.5 min-w-0">
                              <div className="w-1.5 h-1.5 bg-green-500 rounded-full shrink-0" />
                              <span className="text-xs font-medium truncate">{emp.userName}</span>
                              {emp.isLate && (
                                <span className="text-[10px] text-red-500 shrink-0">({emp.minutesLate}m late)</span>
                              )}
                            </div>
                            <span className="text-xs text-muted-foreground shrink-0 ml-2">
                              in {new Date(emp.clockInTime).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Coming up */}
                    {upcoming.length > 0 && (
                      <div className="space-y-1.5">
                        <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Scheduled Today</p>
                        {upcoming.slice(0, 4).map((s: any) => (
                          <div key={s.scheduleId} className="flex items-center justify-between">
                            <div className="flex items-center gap-1.5 min-w-0">
                              <div className="w-1.5 h-1.5 bg-blue-400 rounded-full shrink-0" />
                              <span className="text-xs truncate">{s.userName}</span>
                            </div>
                            <span className="text-xs text-muted-foreground shrink-0 ml-2">
                              {new Date(s.startTime).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })}
                              {' – '}
                              {new Date(s.endTime).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}

                    {totalSched === 0 && totalIn === 0 && (
                      <p className="text-xs text-muted-foreground text-center py-1">No shifts scheduled today</p>
                    )}
                  </div>
                );
              })()}
            </CardContent>
          </Card>
        </DashboardErrorBoundary>

        <DashboardErrorBoundary fallback="Scorecard failed to load">
          <div>
            <h3 className="text-sm font-semibold text-muted-foreground mb-3 px-1">Operational Scorecard</h3>
            <div className={isMobile ? 'grid grid-cols-2 gap-3' : 'grid grid-cols-4 gap-4'}>
              <Card>
                <CardContent className="p-4 text-center">
                  <ShieldCheck className="h-5 w-5 mx-auto mb-2 text-emerald-600" />
                  {sopsLoading ? (
                    <Skeleton className="h-8 w-12 mx-auto" />
                  ) : (
                    <p className="text-2xl font-bold">{sopCompletionRate}%</p>
                  )}
                  <p className="text-xs text-muted-foreground mt-1">SOP Completion</p>
                  <p className="text-[10px] text-muted-foreground">This week</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-4 text-center">
                  <Clock className="h-5 w-5 mx-auto mb-2 text-blue-600" />
                  {issuesLoading ? (
                    <Skeleton className="h-8 w-12 mx-auto" />
                  ) : (
                    <p className="text-2xl font-bold">
                      {avgResolutionTime > 0 ? `${avgResolutionTime.toFixed(1)}h` : '—'}
                    </p>
                  )}
                  <p className="text-xs text-muted-foreground mt-1">Avg Resolution</p>
                  <p className="text-[10px] text-muted-foreground">Issue response</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-4 text-center">
                  <CheckCircle2 className="h-5 w-5 mx-auto mb-2 text-purple-600" />
                  {tasksLoading ? (
                    <Skeleton className="h-8 w-12 mx-auto" />
                  ) : (
                    <p className="text-2xl font-bold">{taskCompletionRate}%</p>
                  )}
                  <p className="text-xs text-muted-foreground mt-1">Task Completion</p>
                  <p className="text-[10px] text-muted-foreground">All time</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-4 text-center">
                  <Video className="h-5 w-5 mx-auto mb-2 text-amber-600" />
                  <p className="text-2xl font-bold">{weeklyVideos.length}</p>
                  <p className="text-xs text-muted-foreground mt-1">Videos</p>
                  <p className="text-[10px] text-muted-foreground">This week</p>
                </CardContent>
              </Card>
            </div>
          </div>
        </DashboardErrorBoundary>

        <DashboardErrorBoundary fallback="Flagged items failed to load">
          {flaggedItems.length > 0 && (
            <Card className="border-amber-200 dark:border-amber-800/50">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2 text-amber-700 dark:text-amber-400">
                  <AlertTriangle className="h-4 w-4" />
                  Flagged Items ({flaggedItems.length})
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {flaggedItems.map((item, idx) => (
                    <div
                      key={idx}
                      className="flex items-center justify-between p-2.5 rounded-lg bg-muted/50 cursor-pointer hover:bg-muted transition-colors"
                      onClick={() => navigate(item.link)}
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        {item.type === 'issue' ? (
                          <AlertCircle className="h-4 w-4 text-red-500 flex-shrink-0" />
                        ) : (
                          <Clock className="h-4 w-4 text-amber-500 flex-shrink-0" />
                        )}
                        <span className="text-sm truncate">{item.label}</span>
                      </div>
                      <Badge
                        variant="outline"
                        className={
                          item.priority === 'urgent' ? 'border-red-300 text-red-700 dark:text-red-400' :
                          item.priority === 'high' ? 'border-orange-300 text-orange-700 dark:text-orange-400' :
                          'border-amber-300 text-amber-700 dark:text-amber-400'
                        }
                      >
                        {item.priority === 'overdue' ? 'Overdue' : item.priority}
                      </Badge>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </DashboardErrorBoundary>

        <DashboardErrorBoundary fallback="AI questions card failed to load">
          <Card
            className={`cursor-pointer hover:shadow-md transition-shadow ${unansweredCount > 0 ? "border-amber-200 dark:border-amber-800/50 bg-amber-50/50 dark:bg-amber-950/10" : "border-border"}`}
            onClick={() => navigate('/ai-questions')}
          >
            <CardContent className="p-4 flex items-center gap-3">
              <div className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 ${unansweredCount > 0 ? "bg-amber-100 dark:bg-amber-900/30" : "bg-muted"}`}>
                <MessageSquareQuestion className={`h-5 w-5 ${unansweredCount > 0 ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground"}`} />
              </div>
              <div className="flex-1 min-w-0">
                <p className={`font-semibold text-sm ${unansweredCount > 0 ? "text-amber-800 dark:text-amber-300" : "text-foreground"}`}>
                  {unansweredCount > 0
                    ? `${unansweredCount} Pending ${unansweredCount === 1 ? "Question" : "Questions"}`
                    : "Questions for You"}
                </p>
                <p className={`text-xs ${unansweredCount > 0 ? "text-amber-600 dark:text-amber-400/80" : "text-muted-foreground"}`}>
                  {unansweredCount > 0 ? "MAinager needs your help — review and answer" : "No pending questions"}
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {unansweredCount > 0 && (
                  <Badge className="bg-amber-500 text-white border-0">{unansweredCount}</Badge>
                )}
                <span className="text-xs text-muted-foreground">View all →</span>
              </div>
            </CardContent>
          </Card>
        </DashboardErrorBoundary>

        <DashboardErrorBoundary fallback="GTD widget failed to load">
          <GTDDashboardWidget />
        </DashboardErrorBoundary>

        <DashboardErrorBoundary fallback="Weekly review card failed to load">
          <WeeklyReviewCard />
        </DashboardErrorBoundary>

        <DashboardErrorBoundary fallback="Cash status card failed to load">
          <CashStatusCard />
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

        <DashboardErrorBoundary fallback="Midday pulse failed to load">
          <MiddayPulseCard />
        </DashboardErrorBoundary>

        <DashboardErrorBoundary fallback="Improvement feed failed to load">
          <ImprovementFeedWidget />
        </DashboardErrorBoundary>

        <DashboardErrorBoundary fallback="Quick links failed to load">
          <div>
            <h3 className="text-sm font-semibold text-muted-foreground mb-3 px-1">Quick Links</h3>
            <div className={isMobile ? 'grid grid-cols-3 gap-2' : 'grid grid-cols-6 gap-3'}>
              {[
                { icon: Calendar, label: 'Schedule', path: '/schedules' },
                { icon: DollarSign, label: 'Payroll', path: '/payroll' },
                { icon: ClipboardList, label: 'SOP Library', path: '/sops' },
                { icon: AlertCircle, label: 'Issues', path: '/issues' },
                { icon: BarChart3, label: 'Analytics', path: '/analytics' },
                { icon: Settings, label: 'Settings', path: '/admin' },
              ].map((link) => (
                <Button
                  key={link.path}
                  variant="outline"
                  className="h-auto py-3 flex flex-col items-center gap-1.5"
                  onClick={() => navigate(link.path)}
                >
                  <link.icon className="h-5 w-5 text-primary" />
                  <span className="text-xs">{link.label}</span>
                </Button>
              ))}
            </div>
          </div>
        </DashboardErrorBoundary>
      </div>

    </div>
  );
}
