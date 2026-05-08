import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useLocation } from 'wouter';
import { useAuth } from '@/hooks/useAuth';
import { useIsMobile } from '@/hooks/use-mobile';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { DashboardErrorBoundary } from '@/features/dashboard/DashboardErrorBoundary';
import MiddayPulseCard from '@/components/MiddayPulseCard';
import ImprovementFeedWidget from '@/components/ImprovementFeedWidget';
import KudosWidget from '@/components/KudosWidget';
import WeeklyReviewCard from '@/features/gtd/WeeklyReviewCard';
import LeanBoardCard from '@/features/dashboard/LeanBoardCard';
import SOPInsightsCard from '@/features/dashboard/SOPInsightsCard';
import BackgroundInsightsCard from '@/features/dashboard/BackgroundInsightsCard';
import SmartSuggestionsCard from '@/features/dashboard/SmartSuggestionsCard';
import SOPRevisionCard from '@/features/dashboard/SOPRevisionCard';
import CashStatusCard from '@/features/dashboard/CashStatusCard';
import SurfacedSOPBanner from '@/components/SurfacedSOPBanner';
import DailyTrainingManagerWidget from '@/features/dashboard/DailyTrainingManagerWidget';
import TimeClockWidget from '@/components/TimeClockWidget';
import TeamStatusWidget from '@/features/dashboard/TeamStatusWidget';
import {
  Sun,
  Check,
  AlertTriangle,
  Clock,
  ChevronRight,
  CircleAlert,
  Bot,
  ShieldCheck,
  CheckCircle2,
  Inbox,
  CalendarCheck,
  Zap,
  ArrowRight,
  Video,
  Timer,
  TrendingUp,
  TrendingDown,
  Package,
} from 'lucide-react';
import { DELIVERY_FAILURE_HIGH_THRESHOLD } from '@/lib/notificationConstants';
import { PayrollSummary, BENCHMARKS } from '@/lib/payrollBenchmarks';

export default function ManagerDashboard() {
  const { user } = useAuth();
  const isMobile = useIsMobile();
  const roleName = user?.role?.name;
  const isAdminOrOwner = roleName === 'admin' || roleName === 'owner';
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

  // Partial-failure flags written by DashboardRouter — cache-only, no network request
  const { data: partialErrors } = useQuery<{ gamificationError: boolean; todaySummaryError: boolean }>({
    queryKey: ['/api/dashboard/partial-errors'],
    enabled: false,
  });

  // Company settings — used for showPaySummaryToManagers toggle
  const { data: companySettings } = useQuery<any>({
    queryKey: ['/api/company-settings'],
    staleTime: 5 * 60 * 1000,
  });

  const showPaySummary = companySettings?.showPaySummaryToManagers ?? false;

  // Manager pay summary — always fetch for the header stats bar (period hrs + estimated pay)
  const { data: myPaySummary } = useQuery<{ periodStart: string; totalHours: number; hourlyRate: number; estimatedPay: number }>({
    queryKey: ['/api/dashboard/my-pay-summary'],
    enabled: true,
    staleTime: 5 * 60 * 1000,
  });

  // Defer non-critical list queries until after first paint so the initial
  // render uses only the pre-hydrated /api/dashboard/init data (1-2 requests).
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

  const { data: timeEntries } = useQuery<any[]>({ queryKey: ['/api/time-entries'], enabled: deferredEnabled });
  const { data: users } = useQuery<any[]>({ queryKey: ['/api/users'], enabled: deferredEnabled });
  const { data: schedules } = useQuery<any[]>({ queryKey: ['/api/schedules'], enabled: deferredEnabled });
  const { data: tasks, isLoading: tasksLoading } = useQuery<any[]>({ queryKey: ['/api/tasks'], enabled: deferredEnabled });
  const { data: issuesRaw, isLoading: issuesLoading } = useQuery<any>({ queryKey: ['/api/issues'], enabled: deferredEnabled });
  const issues = Array.isArray(issuesRaw) ? issuesRaw : (issuesRaw?.data || []);
  const { data: sopExecutionsRaw, isLoading: sopsLoading } = useQuery<any>({ queryKey: ['/api/sops/executions'], enabled: deferredEnabled });
  const sopExecutions = Array.isArray(sopExecutionsRaw) ? sopExecutionsRaw : (sopExecutionsRaw?.data || []);
  const { data: huddleData } = useQuery<any>({ queryKey: ['/api/rituals/huddle/today'], enabled: deferredEnabled });

  const { data: gtdData, isLoading: gtdLoading } = useQuery<{ success: boolean; data: { inbox_count: number; actions_today_count: number; actions_overdue_count: number; waiting_overdue_count: number; two_minute_actions_count: number } }>({
    queryKey: ['/api/gtd/dashboard'],
    enabled: deferredEnabled,
    staleTime: 60_000,
  });

  const { data: supplySummary = [] } = useQuery<{ taskId: string; title: string; checkedCount: number; totalAssigned: number; flaggedNotes: { userId: string; note: string }[] }[]>({
    queryKey: ['/api/tasks/supply-summary'],
    enabled: deferredEnabled,
    staleTime: 60_000,
  });

  const { data: improvementVideos } = useQuery<any[]>({
    queryKey: ['/api/improvement-videos'],
    enabled: deferredEnabled,
    staleTime: 60_000,
  });

  const { data: payrollSummary, isLoading: payrollLoading } = useQuery<PayrollSummary>({
    queryKey: ['/api/payroll-intelligence/summary'],
    enabled: isAdminOrOwner && deferredEnabled,
    staleTime: 5 * 60 * 1000,
  });

  const { data: deliveryStats } = useQuery<{ userId: string; total: number; failures: number }[]>({
    queryKey: ['/api/push/delivery-stats'],
    staleTime: 5 * 60 * 1000,
    enabled: isAdminOrOwner,
  });

  const highRiskCount = (deliveryStats ?? []).filter(
    row => row.total > 0 && row.failures > 0 && row.failures / row.total >= DELIVERY_FAILURE_HIGH_THRESHOLD
  ).length;

  const { data: unansweredCountData } = useQuery<{ pending: number }>({
    queryKey: ['/api/ai/questions/count'],
    refetchInterval: 60000,
    staleTime: 30000,
  });
  const unansweredCount = unansweredCountData?.pending || 0;

  const today = new Date();
  const todayStr = today.toDateString();

  // Prefer pre-hydrated summary stats, fall back to computed values
  const activeEntries = todaySummary?.activeEntries ?? (timeEntries || []).filter((e: any) => !e.clockOutTime);
  const totalClockedIn = todaySummary?.totalClockedIn ?? activeEntries.length;
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

  const overdueGtdTotal = (gtdData?.data?.actions_overdue_count || 0) + (gtdData?.data?.waiting_overdue_count || 0);
  const quickWins = gtdData?.data?.two_minute_actions_count || 0;

  const closedIssues = (issues || []).filter((i: any) => i.status === 'resolved' && i.resolvedAt && i.createdAt);
  const avgResolutionHours = closedIssues.length > 0
    ? Math.round(closedIssues.reduce((sum: number, i: any) => {
        const hrs = (new Date(i.resolvedAt).getTime() - new Date(i.createdAt).getTime()) / (1000 * 60 * 60);
        return sum + hrs;
      }, 0) / closedIssues.length)
    : 0;

  const startOfThisWeek = new Date();
  startOfThisWeek.setDate(startOfThisWeek.getDate() - startOfThisWeek.getDay());
  startOfThisWeek.setHours(0, 0, 0, 0);
  const weeklyVideos = (improvementVideos || []).filter(
    (v: any) => new Date(v.createdAt) >= startOfThisWeek
  ).length;

  // My personal hours (for the stats bar)
  const myEntriesToday = (timeEntries || []).filter((e: any) =>
    e.userId === user?.id && new Date(e.clockInTime).toDateString() === todayStr
  );
  const myTodayHours = myEntriesToday.reduce((sum: number, e: any) => {
    const start = new Date(e.clockInTime).getTime();
    const end = e.clockOutTime ? new Date(e.clockOutTime).getTime() : Date.now();
    return sum + (end - start) / 3600000;
  }, 0);

  const myEntriesThisWeek = (timeEntries || []).filter((e: any) =>
    e.userId === user?.id && new Date(e.clockInTime) >= startOfThisWeek
  );
  const myWeekHours = myEntriesThisWeek.reduce((sum: number, e: any) => {
    const start = new Date(e.clockInTime).getTime();
    const end = e.clockOutTime ? new Date(e.clockOutTime).getTime() : Date.now();
    return sum + (end - start) / 3600000;
  }, 0);

  const formatHeaderDateTime = (date: Date) =>
    date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }) +
    ' ' + date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });

  return (
    <div className="min-h-full bg-background">
      {/* ── Header ── */}
      <DashboardErrorBoundary fallback="Could not load header">
        <section className="bg-gradient-to-br from-primary to-primary/80 text-primary-foreground p-5 md:p-6 md:rounded-xl md:m-6 md:mt-4">
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0 shrink-0">
              <h1 className={`font-bold truncate ${isMobile ? 'text-base' : 'text-lg'}`}>
                {getGreeting()}, {(user as any)?.firstName || 'Manager'}!
              </h1>
              <p className="text-xs opacity-70">
                {currentTime.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
              </p>
            </div>
            <div className="flex-1 flex justify-center px-2">
              <p className={`font-bold tabular-nums tracking-tight leading-none text-center ${isMobile ? 'text-xl' : 'text-3xl'}`}>
                {formatHeaderDateTime(currentTime)}
              </p>
            </div>
            <Button
              onClick={() => window.dispatchEvent(new Event("open-ask-mainager"))}
              size="icon"
              className="bg-white/20 hover:bg-white/30 text-white rounded-full h-10 w-10 flex-shrink-0"
            >
              <Bot className="h-5 w-5" />
            </Button>
          </div>
        </section>
      </DashboardErrorBoundary>

      <div className={isMobile ? "px-4 py-3" : "px-6 py-4"}>
        {/* Personal time clock widget — clock face hidden to avoid redundancy with header live time, but today's total, geofencing badge, and action buttons are shown */}
        <DashboardErrorBoundary fallback="Time clock failed to load">
          <TimeClockWidget hideClock />
        </DashboardErrorBoundary>
      </div>

      {/* ── Today Card — hours stats bar merged with real Shopify revenue + team schedule ── */}
      <div className={isMobile ? "px-4 pb-2" : "px-6 pb-2"}>
        <DashboardErrorBoundary fallback="Could not load team status">
          <TeamStatusWidget hoursStats={{
            todayHours: myTodayHours,
            weekHours: myWeekHours,
            periodHours: myPaySummary?.totalHours,
            estimatedPay: myPaySummary?.estimatedPay,
            hourlyRate: myPaySummary?.hourlyRate,
          }} />
        </DashboardErrorBoundary>
      </div>

      {isAdminOrOwner && highRiskCount > 0 && (
        <div className={isMobile ? "px-4 pb-2" : "px-6 pb-2"}>
          <Card
            className="cursor-pointer hover:shadow-md transition-shadow border-amber-200 dark:border-amber-800/40 bg-amber-50/50 dark:bg-amber-950/10"
            onClick={() => navigate('/admin?section=notifications&focus=delivery-summary')}
          >
            <CardContent className="p-4 flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center shrink-0">
                <AlertTriangle className="h-5 w-5 text-amber-600 dark:text-amber-400" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-bold text-amber-800 dark:text-amber-300">
                  {highRiskCount} employee{highRiskCount !== 1 ? 's' : ''} {highRiskCount !== 1 ? 'have' : 'has'} high notification failure rates
                </p>
                <p className="text-xs text-amber-600 dark:text-amber-400/80">
                  Review delivery summary in Notification Settings
                </p>
              </div>
              <ChevronRight className="h-4 w-4 text-amber-500 shrink-0" />
            </CardContent>
          </Card>
        </div>
      )}

      {isAdminOrOwner && (
        <div className={isMobile ? "px-4 pb-2" : "px-6 pb-2"}>
          <DashboardErrorBoundary fallback="Payroll health card failed to load">
            {(() => {
              const benchmark = payrollSummary?.settings?.storeType
                ? BENCHMARKS[payrollSummary.settings.storeType]
                : null;
              const target = payrollSummary?.settings?.payrollTargetPct ?? benchmark?.payrollPct?.ideal ?? null;
              const laborPct = payrollSummary?.laborPct ?? 0;
              const splh = payrollSummary?.splh ?? 0;
              const totalLaborCost = payrollSummary?.totalLaborCost ?? 0;
              const isOnTarget = target !== null && laborPct > 0 ? laborPct <= target : null;

              return (
                <Card
                  className="cursor-pointer hover:shadow-md transition-shadow border-border"
                  onClick={() => navigate('/payroll-intelligence')}
                >
                  <CardHeader className="pb-2">
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-sm flex items-center gap-2">
                        <TrendingUp className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                        Payroll Health
                      </CardTitle>
                      <div className="flex items-center gap-1.5">
                        {payrollLoading ? (
                          <Skeleton className="h-5 w-16" />
                        ) : isOnTarget === true ? (
                          <Badge className="bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400 border-0 text-[11px] font-semibold flex items-center gap-1">
                            <TrendingUp className="h-3 w-3" />
                            On target
                          </Badge>
                        ) : isOnTarget === false ? (
                          <Badge className="bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400 border-0 text-[11px] font-semibold flex items-center gap-1">
                            <TrendingDown className="h-3 w-3" />
                            Over target
                          </Badge>
                        ) : null}
                        <ChevronRight className="h-4 w-4 text-muted-foreground" />
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent>
                    {payrollLoading ? (
                      <div className="flex gap-4">
                        <Skeleton className="h-12 w-20" />
                        <Skeleton className="h-12 w-20" />
                        <Skeleton className="h-12 w-20" />
                      </div>
                    ) : (
                      <div className="flex gap-0 divide-x divide-border">
                        <div className="flex-1 pr-4 text-center">
                          <p className={`text-2xl font-extrabold tabular-nums leading-tight ${isOnTarget === false ? 'text-red-600 dark:text-red-400' : isOnTarget === true ? 'text-green-600 dark:text-green-400' : 'text-foreground'}`}>
                            {payrollSummary?.shopConnected === false ? '—' : laborPct > 0 ? `${laborPct.toFixed(1)}%` : '—'}
                          </p>
                          <p className="text-[10px] text-muted-foreground leading-tight mt-0.5">Payroll %</p>
                          {target !== null && (
                            <p className="text-[10px] text-muted-foreground/70 leading-tight">target {target}%</p>
                          )}
                        </div>
                        <div className="flex-1 px-4 text-center">
                          <p className="text-2xl font-extrabold tabular-nums leading-tight text-foreground">
                            {payrollSummary?.shopConnected === false ? '—' : splh > 0 ? `$${splh.toFixed(0)}` : '—'}
                          </p>
                          <p className="text-[10px] text-muted-foreground leading-tight mt-0.5">SPLH</p>
                          {benchmark && (
                            <p className="text-[10px] text-muted-foreground/70 leading-tight">target ${benchmark.splh.ideal}</p>
                          )}
                        </div>
                        <div className="flex-1 pl-4 text-center">
                          <p className="text-2xl font-extrabold tabular-nums leading-tight text-foreground">
                            {totalLaborCost > 0
                              ? totalLaborCost.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
                              : '—'}
                          </p>
                          <p className="text-[10px] text-muted-foreground leading-tight mt-0.5">Labor cost</p>
                          <p className="text-[10px] text-muted-foreground/70 leading-tight">this week</p>
                        </div>
                      </div>
                    )}
                  </CardContent>
                </Card>
              );
            })()}
          </DashboardErrorBoundary>
        </div>
      )}

      <div className={isMobile ? "px-4 pb-1" : "px-6 pb-2"}>
        <DashboardErrorBoundary fallback="Could not load SOP banner">
          <SurfacedSOPBanner />
        </DashboardErrorBoundary>
      </div>

      <div className={isMobile ? "px-4 pb-2" : "px-6 pb-2"}>
        <DashboardErrorBoundary fallback="Suggestions failed to load">
          <SmartSuggestionsCard />
        </DashboardErrorBoundary>
      </div>

      <div className={isMobile ? "px-4 pb-4 space-y-4" : "px-6 pb-6"}>
        {/* ── Training + Open Issues row (moved up, before AI/huddle) ── */}
        <div className={isMobile ? "space-y-4" : "grid grid-cols-2 gap-6 mb-6"}>
          <DashboardErrorBoundary fallback="Daily training widget failed to load">
            <DailyTrainingManagerWidget />
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
        </div>

        {/* ── AI questions + Morning huddle ── */}
        <div className={isMobile ? "space-y-4" : "grid grid-cols-2 gap-6"}>
          <DashboardErrorBoundary fallback="AI questions card failed to load">
            <Card
              className={`cursor-pointer hover:shadow-md transition-shadow ${unansweredCount > 0 ? "border-amber-200 dark:border-amber-800/50 bg-amber-50/50 dark:bg-amber-950/10" : "border-border"}`}
              onClick={() => navigate('/ai-questions')}
            >
              <CardContent className="p-4 flex items-center gap-3">
                <div className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 ${unansweredCount > 0 ? "bg-amber-100 dark:bg-amber-900/30" : "bg-muted"}`}>
                  <AlertTriangle className={`h-5 w-5 ${unansweredCount > 0 ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground"}`} />
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

          <DashboardErrorBoundary fallback="Tasks & Operations failed to load">
            <Card className="col-span-full">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-purple-600" />
                  Tasks & Operations
                </CardTitle>
              </CardHeader>
              <CardContent>
                {/* 3×2 grid of tiles */}
                <div className="grid grid-cols-3 gap-2 mb-3">
                  {/* SOP Completion */}
                  <button
                    onClick={() => navigate('/sops')}
                    className="bg-emerald-500 dark:bg-emerald-600 rounded-2xl p-3 text-center transition-transform active:scale-95 hover:brightness-110 cursor-pointer"
                  >
                    <ShieldCheck className="h-4 w-4 mx-auto mb-1 text-white" />
                    {sopsLoading ? (
                      <Skeleton className="h-6 w-10 mx-auto bg-white/30" />
                    ) : (
                      <p className="text-xl font-bold text-white">{sopProgress}%</p>
                    )}
                    <p className="text-[10px] text-white/80 mt-0.5">SOP</p>
                  </button>

                  {/* Task Completion */}
                  <button
                    onClick={() => navigate('/tasks')}
                    className="bg-purple-500 dark:bg-purple-600 rounded-2xl p-3 text-center transition-transform active:scale-95 hover:brightness-110 cursor-pointer"
                  >
                    <CheckCircle2 className="h-4 w-4 mx-auto mb-1 text-white" />
                    {tasksLoading ? (
                      <Skeleton className="h-6 w-10 mx-auto bg-white/30" />
                    ) : (
                      <p className="text-xl font-bold text-white">{completedToday}/{todayTasks.length}</p>
                    )}
                    <p className="text-[10px] text-white/80 mt-0.5">Tasks</p>
                  </button>

                  {/* GTD Inbox */}
                  <button
                    onClick={() => navigate('/gtd/inbox')}
                    className="bg-blue-500 dark:bg-blue-600 rounded-2xl p-3 text-center transition-transform active:scale-95 hover:brightness-110 cursor-pointer"
                  >
                    <Inbox className="h-4 w-4 mx-auto mb-1 text-white" />
                    {gtdLoading ? (
                      <Skeleton className="h-6 w-10 mx-auto bg-white/30" />
                    ) : (
                      <p className="text-xl font-bold text-white">{gtdData?.data?.inbox_count ?? 0}</p>
                    )}
                    <p className="text-[10px] text-white/80 mt-0.5">Inbox</p>
                  </button>

                  {/* Due Today */}
                  <button
                    onClick={() => navigate('/gtd/actions')}
                    className="bg-teal-500 dark:bg-teal-600 rounded-2xl p-3 text-center transition-transform active:scale-95 hover:brightness-110 cursor-pointer"
                  >
                    <CalendarCheck className="h-4 w-4 mx-auto mb-1 text-white" />
                    {gtdLoading ? (
                      <Skeleton className="h-6 w-10 mx-auto bg-white/30" />
                    ) : (
                      <p className="text-xl font-bold text-white">{gtdData?.data?.actions_today_count ?? 0}</p>
                    )}
                    <p className="text-[10px] text-white/80 mt-0.5">Due Today</p>
                  </button>

                  {/* Overdue */}
                  <button
                    onClick={() => navigate('/gtd/actions')}
                    className={`${overdueGtdTotal > 0 ? 'bg-red-500 dark:bg-red-600' : 'bg-slate-400 dark:bg-slate-600'} rounded-2xl p-3 text-center transition-transform active:scale-95 hover:brightness-110 cursor-pointer`}
                  >
                    <AlertTriangle className="h-4 w-4 mx-auto mb-1 text-white" />
                    {gtdLoading ? (
                      <Skeleton className="h-6 w-10 mx-auto bg-white/30" />
                    ) : (
                      <p className="text-xl font-bold text-white">{overdueGtdTotal}</p>
                    )}
                    <p className="text-[10px] text-white/80 mt-0.5">Overdue</p>
                  </button>

                  {/* Quick Wins */}
                  <button
                    onClick={() => navigate('/gtd/actions')}
                    className={`${quickWins > 0 ? 'bg-amber-500 dark:bg-amber-600' : 'bg-slate-400 dark:bg-slate-600'} rounded-2xl p-3 text-center transition-transform active:scale-95 hover:brightness-110 cursor-pointer`}
                  >
                    <Zap className="h-4 w-4 mx-auto mb-1 text-white" />
                    {gtdLoading ? (
                      <Skeleton className="h-6 w-10 mx-auto bg-white/30" />
                    ) : (
                      <p className="text-xl font-bold text-white">{quickWins}</p>
                    )}
                    <p className="text-[10px] text-white/80 mt-0.5">Quick Wins</p>
                  </button>
                </div>

                {/* Slim 2-stat row */}
                <div className="grid grid-cols-2 gap-2 mb-3">
                  <div className="flex items-center gap-2 rounded-xl border border-border bg-muted/40 px-3 py-2">
                    <Timer className="h-4 w-4 text-muted-foreground shrink-0" />
                    <div className="min-w-0">
                      <p className="text-xs font-semibold text-foreground truncate">
                        {avgResolutionHours > 0 ? `${avgResolutionHours}h` : '—'}
                      </p>
                      <p className="text-[10px] text-muted-foreground">Avg Resolution</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 rounded-xl border border-border bg-muted/40 px-3 py-2">
                    <Video className="h-4 w-4 text-muted-foreground shrink-0" />
                    <div className="min-w-0">
                      <p className="text-xs font-semibold text-foreground truncate">{weeklyVideos}</p>
                      <p className="text-[10px] text-muted-foreground">Videos this week</p>
                    </div>
                  </div>
                </div>

                {/* CTA */}
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full"
                  onClick={() => navigate('/gtd/actions')}
                >
                  What should I do next?
                  <ArrowRight className="h-4 w-4 ml-2" />
                </Button>
              </CardContent>
            </Card>
          </DashboardErrorBoundary>

          <DashboardErrorBoundary fallback="Weekly review card failed to load">
            <WeeklyReviewCard />
          </DashboardErrorBoundary>

          <DashboardErrorBoundary fallback="Cash status card failed to load">
            <CashStatusCard />
          </DashboardErrorBoundary>

          {supplySummary.length > 0 && (
            <DashboardErrorBoundary fallback="Supply status card failed to load">
              <Card
                className="cursor-pointer hover:shadow-md transition-shadow"
                onClick={() => navigate('/tasks?tab=supply')}
              >
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-sm flex items-center gap-2">
                      <Package className="h-4 w-4 text-teal-600 dark:text-teal-400" />
                      Supply Status — Today
                    </CardTitle>
                    <ChevronRight className="h-4 w-4 text-muted-foreground" />
                  </div>
                </CardHeader>
                <CardContent className="pt-0">
                  {(() => {
                    const totalFlagged = supplySummary.reduce((sum, s) => sum + s.flaggedNotes.length, 0);
                    const allFlagged = supplySummary.filter(s => s.flaggedNotes.length > 0);
                    const totalChecked = supplySummary.filter(s => (s.checkedCount ?? 0) > 0).length;
                    const totalItems = supplySummary.length;
                    const completionPct = totalItems > 0 ? Math.round((totalChecked / totalItems) * 100) : 0;
                    return (
                      <>
                        {/* Completion rate bar */}
                        <div className="mb-3">
                          <div className="flex justify-between items-center mb-1">
                            <span className="text-xs text-muted-foreground">Today's completion</span>
                            <span className="text-xs font-medium">{totalChecked} / {totalItems} checked</span>
                          </div>
                          <div className="w-full bg-muted rounded-full h-1.5">
                            <div
                              className="bg-teal-500 h-1.5 rounded-full transition-all"
                              style={{ width: `${completionPct}%` }}
                            />
                          </div>
                        </div>
                        {totalFlagged > 0 && (
                          <div className="flex items-center gap-2 mb-3 p-2 rounded-lg bg-orange-50 dark:bg-orange-950/20 border border-orange-200 dark:border-orange-800/40">
                            <AlertTriangle className="h-4 w-4 text-orange-500 shrink-0" />
                            <p className="text-xs text-orange-700 dark:text-orange-400 font-medium">
                              {totalFlagged} low-stock alert{totalFlagged !== 1 ? 's' : ''} flagged
                            </p>
                          </div>
                        )}
                        <div className="space-y-2">
                          {allFlagged.length > 0 ? allFlagged.slice(0, 4).map(item => (
                            <div key={item.taskId} className="flex items-start gap-2">
                              <AlertTriangle className="h-3 w-3 text-orange-500 mt-0.5 shrink-0" />
                              <div className="min-w-0">
                                <p className="text-xs font-medium truncate">{item.title.replace(/^\[.*?\]\s*/, '')}</p>
                                {item.flaggedNotes.slice(0, 1).map((n, i) => (
                                  <p key={i} className="text-[11px] text-orange-600 dark:text-orange-400 italic truncate">"{n.note}"</p>
                                ))}
                              </div>
                            </div>
                          )) : (
                            <div className="flex items-center gap-2">
                              <Check className="h-4 w-4 text-green-500" />
                              <p className="text-xs text-muted-foreground">
                                {totalItems} item{totalItems !== 1 ? 's' : ''} tracked — no alerts
                              </p>
                            </div>
                          )}
                          {allFlagged.length > 4 && (
                            <p className="text-xs text-muted-foreground">+{allFlagged.length - 4} more flagged items</p>
                          )}
                        </div>
                      </>
                    );
                  })()}
                </CardContent>
              </Card>
            </DashboardErrorBoundary>
          )}

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
