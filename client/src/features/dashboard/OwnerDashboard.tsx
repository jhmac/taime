import { useState, useEffect, useRef } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { useLocation } from 'wouter';
import { useAuth } from '@/hooks/useAuth';
import { useIsMobile } from '@/hooks/use-mobile';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import SurfacedSOPBanner from '@/components/SurfacedSOPBanner';
import MiddayPulseCard from '@/components/MiddayPulseCard';
import ImprovementFeedWidget from '@/components/ImprovementFeedWidget';
import { DashboardErrorBoundary } from '@/features/dashboard/DashboardErrorBoundary';
import WeeklyReviewCard from '@/features/gtd/WeeklyReviewCard';
import LeanBoardCard from '@/features/dashboard/LeanBoardCard';
import SOPInsightsCard from '@/features/dashboard/SOPInsightsCard';
import BackgroundInsightsCard from '@/features/dashboard/BackgroundInsightsCard';
import SOPRevisionCard from '@/features/dashboard/SOPRevisionCard';
import CashStatusCard from '@/features/dashboard/CashStatusCard';
import TimeClockWidget from '@/components/TimeClockWidget';
import DailyQuoteCard from '@/components/DailyQuoteCard';
import { apiRequest, queryClient } from '@/lib/queryClient';
import { useToast } from '@/hooks/use-toast';
import {
  Briefcase, ShieldCheck, AlertTriangle, TrendingUp,
  Calendar, DollarSign, ClipboardList, BarChart3, Settings,
  Clock, Video, ShoppingBag, ExternalLink,
  AlertCircle, CheckCircle2, CalendarDays, Inbox, CalendarCheck, Zap, ArrowRight,
  LogOut, Moon, ChevronRight, Circle,
} from 'lucide-react';

type ClockOutTarget = {
  timeEntryId: string;
  userId: string;
  userName: string;
  clockInTime: string;
  isOvernightShift: boolean;
};

function toLocalDatetimeValue(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function formatDuration(from: string, to: string): string {
  const diff = new Date(to).getTime() - new Date(from).getTime();
  if (diff <= 0 || isNaN(diff)) return '—';
  const totalMins = Math.round(diff / 60000);
  const h = Math.floor(totalMins / 60);
  const m = totalMins % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function TimeEditCard({
  label,
  labelColor,
  value,
  onChange,
}: {
  label: string;
  labelColor: string;
  value: string;
  onChange: (v: string) => void;
}) {
  const dateRef = useRef<HTMLInputElement>(null);
  const timeRef = useRef<HTMLInputElement>(null);

  if (!value || !value.includes('T')) return null;
  const [datePart, rawTime] = value.split('T');
  // Normalise to "HH:MM" — some browsers return "HH:MM:SS" from the picker
  const timePart = rawTime?.slice(0, 5) ?? '';
  const d = new Date(`${datePart}T${timePart}`);
  const dateLabel = isNaN(d.getTime())
    ? datePart
    : d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  const timeLabel = isNaN(d.getTime())
    ? timePart
    : d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });

  const openDate = () => {
    const el = dateRef.current;
    if (!el) return;
    try { el.showPicker(); } catch { el.focus(); el.click(); }
  };
  const openTime = () => {
    const el = timeRef.current;
    if (!el) return;
    try { el.showPicker(); } catch { el.focus(); el.click(); }
  };

  return (
    <div className="space-y-2">
      <p className={`text-[10px] uppercase tracking-widest font-bold ${labelColor}`}>{label}</p>
      <div className="flex gap-2">
        {/* Date card — clicking the visible card calls showPicker() on the hidden input */}
        <div
          className="relative flex-1 h-16 bg-muted/50 hover:bg-muted rounded-2xl flex items-center justify-center cursor-pointer active:scale-[0.98] transition-transform select-none"
          onClick={openDate}
        >
          <input
            ref={dateRef}
            type="date"
            value={datePart}
            onChange={e => onChange(`${e.target.value}T${timePart}`)}
            className="sr-only"
            tabIndex={-1}
          />
          <div className="text-center">
            <p className="text-[9px] text-muted-foreground uppercase tracking-wide mb-0.5">Date</p>
            <p className="text-sm font-semibold leading-tight">{dateLabel}</p>
          </div>
        </div>
        {/* Time card */}
        <div
          className="relative h-16 px-5 bg-muted/50 hover:bg-muted rounded-2xl flex items-center justify-center cursor-pointer active:scale-[0.98] transition-transform select-none"
          onClick={openTime}
        >
          <input
            ref={timeRef}
            type="time"
            value={timePart}
            onChange={e => onChange(`${datePart}T${e.target.value.slice(0, 5)}`)}
            className="sr-only"
            tabIndex={-1}
          />
          <div className="text-center">
            <p className="text-[9px] text-muted-foreground uppercase tracking-wide mb-0.5">Time</p>
            <p className="text-2xl font-bold tabular-nums leading-tight">{timeLabel}</p>
          </div>
        </div>
      </div>
    </div>
  );
}

function SlideToConfirm({ onConfirm, isPending }: { onConfirm: () => void; isPending: boolean }) {
  const trackEl = useRef<HTMLDivElement | null>(null);
  const isDragging = useRef(false);
  const startClientX = useRef(0);
  const startPct = useRef(0);

  const [pct, setPct] = useState(0);
  const [confirmed, setConfirmed] = useState(false);
  const [isDraggingState, setIsDraggingState] = useState(false);

  const THUMB_W = 52;
  const CONFIRM_THRESHOLD = 88;

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (confirmed || isPending) return;
    isDragging.current = true;
    setIsDraggingState(true);
    startClientX.current = e.clientX;
    startPct.current = pct;
    (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isDragging.current) return;
    const track = trackEl.current;
    const trackWidth = track ? track.getBoundingClientRect().width : 280;
    const maxPx = trackWidth - THUMB_W;
    const dx = e.clientX - startClientX.current;
    const newPx = Math.max(0, Math.min(maxPx, (startPct.current / 100) * maxPx + dx));
    const newPct = (newPx / maxPx) * 100;
    setPct(newPct);
    if (newPct >= CONFIRM_THRESHOLD) {
      isDragging.current = false;
      setIsDraggingState(false);
      setConfirmed(true);
      setPct(100);
      onConfirm();
    }
  };

  const handlePointerUp = () => {
    if (isDragging.current && !confirmed) {
      isDragging.current = false;
      setIsDraggingState(false);
      setPct(0);
    }
  };

  return (
    <div
      ref={trackEl}
      className="relative h-13 rounded-full bg-red-100 dark:bg-red-950/40 overflow-hidden select-none"
      style={{ touchAction: 'none', height: '52px' }}
    >
      {/* Fill */}
      <div
        className="absolute inset-y-0 left-0"
        style={{
          width: `${Math.max(pct, 0)}%`,
          background: confirmed ? '#16a34a' : `rgba(239,68,68,${0.15 + pct * 0.006})`,
          transition: isDraggingState ? 'none' : 'width 0.35s ease',
        }}
      />
      {/* Label */}
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
        {!confirmed && (
          <span
            className="text-xs font-semibold text-red-700 dark:text-red-400 transition-opacity"
            style={{ opacity: pct > 55 ? 0 : 1 }}
          >
            Slide to clock out →
          </span>
        )}
        {confirmed && (
          <span className="text-xs font-semibold text-green-700 dark:text-green-400">
            {isPending ? 'Saving…' : 'Confirmed ✓'}
          </span>
        )}
      </div>
      {/* Thumb */}
      <div
        className="absolute top-1.5 bottom-1.5 rounded-full bg-white shadow-md flex items-center justify-center cursor-grab active:cursor-grabbing"
        style={{
          width: THUMB_W,
          left: `calc(${pct / 100} * (100% - ${THUMB_W}px))`,
          transition: isDraggingState ? 'none' : 'left 0.35s ease',
        }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
      >
        <ChevronRight className="h-5 w-5 text-red-500" />
      </div>
    </div>
  );
}

export default function OwnerDashboard() {
  const { user } = useAuth();
  const isMobile = useIsMobile();
  const [, navigate] = useLocation();
  const [currentTime, setCurrentTime] = useState(new Date());
  const { toast } = useToast();

  // Admin clock-out dialog state
  const [clockOutTarget, setClockOutTarget] = useState<ClockOutTarget | null>(null);
  const [clockInEdit, setClockInEdit] = useState('');
  const [clockOutEdit, setClockOutEdit] = useState('');

  const openClockOut = (emp: ClockOutTarget) => {
    setClockOutTarget(emp);
    setClockInEdit(toLocalDatetimeValue(new Date(emp.clockInTime)));
    setClockOutEdit(toLocalDatetimeValue(new Date()));
  };

  const clockOutMutation = useMutation({
    mutationFn: (vars: { id: string; clockInTime: string; clockOutTime: string }) =>
      apiRequest('PATCH', `/api/time-entries/${vars.id}`, {
        clockInTime: new Date(vars.clockInTime).toISOString(),
        clockOutTime: new Date(vars.clockOutTime).toISOString(),
        editReason: 'Admin clock-out from dashboard',
      }),
    onSuccess: () => {
      toast({ title: 'Clocked out', description: `${clockOutTarget?.userName} has been clocked out.` });
      setClockOutTarget(null);
      queryClient.invalidateQueries({ queryKey: ['/api/dashboard/today'] });
      queryClient.invalidateQueries({ queryKey: ['/api/dashboard/today-summary'] });
    },
    onError: () => {
      toast({ title: 'Error', description: 'Could not clock out. Please try again.', variant: 'destructive' });
    },
  });

  const completeTaskMutation = useMutation({
    mutationFn: (taskId: string) =>
      apiRequest('PATCH', `/api/tasks/${taskId}`, {
        status: 'completed',
        completedAt: new Date().toISOString(),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/tasks'] });
      toast({ title: 'Task done!', description: 'Marked as complete.' });
    },
    onError: () => {
      toast({ title: 'Error', description: 'Could not complete task. Try again.', variant: 'destructive' });
    },
  });

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

  const { data: gtdData, isLoading: gtdLoading } = useQuery<{ success: boolean; data: { inbox_count: number; actions_today_count: number; actions_overdue_count: number; waiting_overdue_count: number; two_minute_actions_count: number } }>({
    queryKey: ['/api/gtd/dashboard'],
    enabled: deferredEnabled,
    staleTime: 60_000,
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

  const overdueGtdTotal = (gtdData?.data?.actions_overdue_count || 0) + (gtdData?.data?.waiting_overdue_count || 0);
  const quickWins = gtdData?.data?.two_minute_actions_count || 0;

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

  const greetingSlot = (
    <div>
      <h1 className="text-xl font-extrabold text-foreground leading-tight">
        {getGreeting()}, {(user as any)?.firstName || 'Owner'}
      </h1>
      <p className="text-sm text-muted-foreground mt-1">
        Here's your business at a glance &bull;{' '}
        {currentTime.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
      </p>
    </div>
  );

  const myTasksForFooter = allTasks.filter((t: any) => t.assignedTo === user?.id && t.status !== 'completed');

  const statsFooterSlot = (
    <div className="flex gap-3 items-start">
      {/* Hrs Today — 1/4 */}
      <div className="w-1/4 shrink-0 text-center py-1">
        <p className="text-[11px] text-muted-foreground mb-0.5 leading-tight">Hrs Today</p>
        <p className="text-2xl font-extrabold text-foreground tabular-nums" data-testid="today-hours">
          {analyticsData?.totalHours != null ? `${analyticsData.totalHours.toFixed(1)}h` : '0.0h'}
        </p>
      </div>

      {/* Divider */}
      <div className="w-px self-stretch bg-border shrink-0" />

      {/* Task list — 3/4 */}
      <div className="flex-1 min-w-0 py-1">
        <div className="flex items-center justify-between mb-1.5">
          <p className="text-[11px] text-muted-foreground leading-tight">Your Tasks</p>
          <button onClick={() => navigate('/tasks')} className="text-[11px] font-bold text-primary leading-tight">See all</button>
        </div>
        {myTasksForFooter.length === 0 ? (
          <p className="text-[12px] text-muted-foreground italic">All caught up!</p>
        ) : (
          <div className="space-y-1.5">
            {myTasksForFooter.slice(0, 4).map((t: any) => {
              const isCompleting = completeTaskMutation.isPending && completeTaskMutation.variables === t.id;
              return (
                <div key={t.id} className="flex items-center gap-2 min-w-0">
                  <button
                    onClick={() => completeTaskMutation.mutate(t.id)}
                    disabled={isCompleting}
                    className="shrink-0 text-muted-foreground hover:text-primary active:scale-90 transition-transform disabled:opacity-40"
                    aria-label="Complete task"
                  >
                    {isCompleting
                      ? <CheckCircle2 size={16} className="text-primary animate-pulse" />
                      : <Circle size={16} />}
                  </button>
                  <p className="text-[12px] font-semibold text-foreground truncate flex-1">{t.title}</p>
                  {t.dueDate && (
                    <span className="text-[10px] text-muted-foreground shrink-0">
                      {new Date(t.dueDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );

  return (
    <div className="min-h-full bg-background">

      <div className={isMobile ? 'px-4 pt-4 pb-3 space-y-3' : 'px-6 pt-5 pb-4 space-y-3'}>
        <DashboardErrorBoundary fallback="Time clock failed to load">
          <TimeClockWidget greetingSlot={greetingSlot} footerSlot={statsFooterSlot} />
        </DashboardErrorBoundary>

        <DashboardErrorBoundary fallback="Could not load SOP banner">
          <SurfacedSOPBanner />
        </DashboardErrorBoundary>
      </div>

      <div className={isMobile ? 'px-4 pb-3 space-y-4' : 'px-6 pb-4 space-y-6'}>

        <DashboardErrorBoundary fallback="">
          <DailyQuoteCard />
        </DashboardErrorBoundary>

        <DashboardErrorBoundary fallback="Today card failed to load">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <CalendarDays className="h-4 w-4 text-[#F47D31]" />
                Today
              </CardTitle>
            </CardHeader>
            <CardContent>
              {/* Sales snapshot at top */}
              {shopifyLoading ? (
                <div className="space-y-2 mb-4 pb-4 border-b border-border">
                  <Skeleton className="h-8 w-1/3" />
                  <Skeleton className="h-4 w-2/3" />
                </div>
              ) : shopifyData?.todayRevenue !== undefined ? (
                <div className="mb-4 pb-4 border-b border-border">
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
                    <p className="text-sm text-muted-foreground mt-1">
                      {shopifyData.orderCount} orders today
                    </p>
                  )}
                </div>
              ) : (
                <div className="text-center py-3 mb-4 pb-4 border-b border-border">
                  <ShoppingBag className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
                  <p className="text-sm text-muted-foreground mb-2">Connect Shopify to see sales data</p>
                  <Button variant="outline" size="sm" onClick={() => navigate('/admin?section=pos-connection')}>
                    <ExternalLink className="h-3 w-3 mr-1" /> Connect
                  </Button>
                </div>
              )}

              {/* Staff list — flat, sorted by shift start time */}
              {dashboardLoading ? (
                <div className="space-y-2">
                  <Skeleton className="h-4 w-full" />
                  <Skeleton className="h-4 w-2/3" />
                  <Skeleton className="h-4 w-3/4" />
                </div>
              ) : (() => {
                const allSchedules: any[] = dashboardToday?.schedules ?? [];
                const clockedInArr: any[] = dashboardToday?.clockedIn ?? [];
                const clockedInMap = new Map(clockedInArr.map((e: any) => [e.userName, e]));

                const sorted = [...allSchedules]
                  .filter((s: any) => !s.shiftPassed || s.isClockedIn)
                  .sort((a: any, b: any) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());

                const scheduledNames = new Set(sorted.map((s: any) => s.userName));
                const unscheduledOnShift = clockedInArr.filter((e: any) => !scheduledNames.has(e.userName));

                if (sorted.length === 0 && unscheduledOnShift.length === 0) {
                  return <p className="text-xs text-muted-foreground text-center py-1">No shifts scheduled today</p>;
                }

                return (
                  <div className="space-y-1.5">
                    {sorted.map((s: any, i: number) => {
                      const clockedEntry = clockedInMap.get(s.userName);
                      const isOnShift = s.isClockedIn || !!clockedEntry;
                      const overnight = s.isOvernightShift || clockedEntry?.isOvernightShift;
                      const teId = s.timeEntryId || clockedEntry?.timeEntryId;
                      const cinTime = s.clockInTime || clockedEntry?.clockInTime;
                      return (
                        <div key={s.scheduleId || i} className="flex items-center justify-between min-h-[32px] gap-2">
                          <div className="flex items-center gap-1.5 min-w-0 flex-1">
                            <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${isOnShift ? 'bg-green-500' : 'bg-blue-400'}`} />
                            <span className="text-xs font-medium truncate">{s.userName}</span>
                            {overnight && (
                              <span className="text-[10px] bg-amber-100 dark:bg-amber-950/30 text-amber-600 dark:text-amber-400 px-1.5 py-0.5 rounded-full shrink-0 font-semibold flex items-center gap-0.5">
                                <Moon className="h-2.5 w-2.5" />overnight
                              </span>
                            )}
                            {isOnShift && (clockedEntry?.isLate || s.isLate) && !overnight && (
                              <span className="text-[10px] bg-red-100 dark:bg-red-950/30 text-red-600 dark:text-red-400 px-1.5 py-0.5 rounded-full shrink-0 font-semibold">
                                {(clockedEntry?.minutesLate || s.minutesLate)}m late
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            {isOnShift ? (
                              <div className="text-right">
                                <span className="text-[10px] text-muted-foreground block">
                                  sched {new Date(s.startTime).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })}
                                </span>
                                {cinTime && (
                                  <span className="text-[10px] text-green-600 dark:text-green-400 block">
                                    in {new Date(cinTime).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })}
                                  </span>
                                )}
                              </div>
                            ) : (
                              <span className="text-xs text-muted-foreground">
                                {new Date(s.startTime).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })}
                                {' – '}
                                {new Date(s.endTime).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })}
                              </span>
                            )}
                            {isOnShift && teId && cinTime && (
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-6 px-2 text-[10px] text-red-600 border-red-200 hover:bg-red-50 dark:hover:bg-red-950/20 shrink-0"
                                onClick={() => openClockOut({
                                  timeEntryId: teId,
                                  userId: s.userId,
                                  userName: s.userName,
                                  clockInTime: cinTime,
                                  isOvernightShift: !!overnight,
                                })}
                              >
                                <LogOut className="h-2.5 w-2.5 mr-1" />
                                Clock out
                              </Button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                    {unscheduledOnShift.map((emp: any) => (
                      <div key={emp.userId} className="flex items-center justify-between min-h-[32px] gap-2">
                        <div className="flex items-center gap-1.5 min-w-0 flex-1">
                          <div className="w-1.5 h-1.5 bg-green-500 rounded-full shrink-0" />
                          <span className="text-xs font-medium truncate">{emp.userName}</span>
                          {emp.isOvernightShift && (
                            <span className="text-[10px] bg-amber-100 dark:bg-amber-950/30 text-amber-600 dark:text-amber-400 px-1.5 py-0.5 rounded-full shrink-0 font-semibold flex items-center gap-0.5">
                              <Moon className="h-2.5 w-2.5" />overnight
                            </span>
                          )}
                          {emp.isLate && !emp.isOvernightShift && (
                            <span className="text-[10px] bg-red-100 dark:bg-red-950/30 text-red-600 dark:text-red-400 px-1.5 py-0.5 rounded-full shrink-0 font-semibold">
                              {emp.minutesLate}m late
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <span className="text-[10px] text-green-600 dark:text-green-400">
                            in {new Date(emp.clockInTime).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })}
                          </span>
                          {emp.timeEntryId && (
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-6 px-2 text-[10px] text-red-600 border-red-200 hover:bg-red-50 dark:hover:bg-red-950/20 shrink-0"
                              onClick={() => openClockOut({
                                timeEntryId: emp.timeEntryId,
                                userId: emp.userId,
                                userName: emp.userName,
                                clockInTime: emp.clockInTime,
                                isOvernightShift: !!emp.isOvernightShift,
                              })}
                            >
                              <LogOut className="h-2.5 w-2.5 mr-1" />
                              Clock out
                            </Button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                );
              })()}
            </CardContent>
          </Card>
        </DashboardErrorBoundary>

        <DashboardErrorBoundary fallback="Tasks & Operations failed to load">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-purple-600" />
                Tasks & Operations
              </CardTitle>
            </CardHeader>
            <CardContent>
              {/* 3×2 grid of action tiles */}
              <div className="grid grid-cols-3 gap-2 mb-3">
                {/* SOP Completion % */}
                <button
                  onClick={() => navigate('/sops')}
                  className="bg-emerald-500 dark:bg-emerald-600 rounded-2xl p-3 text-center transition-transform active:scale-95 hover:brightness-110 cursor-pointer"
                >
                  <ShieldCheck className="h-4 w-4 mx-auto mb-1 text-white" />
                  {sopsLoading ? (
                    <Skeleton className="h-6 w-10 mx-auto bg-white/30" />
                  ) : (
                    <p className="text-xl font-bold text-white">{sopCompletionRate}%</p>
                  )}
                  <p className="text-[10px] text-white/80 mt-0.5">SOP</p>
                </button>

                {/* Task Completion % */}
                <button
                  onClick={() => navigate('/tasks')}
                  className="bg-purple-500 dark:bg-purple-600 rounded-2xl p-3 text-center transition-transform active:scale-95 hover:brightness-110 cursor-pointer"
                >
                  <CheckCircle2 className="h-4 w-4 mx-auto mb-1 text-white" />
                  {tasksLoading ? (
                    <Skeleton className="h-6 w-10 mx-auto bg-white/30" />
                  ) : (
                    <p className="text-xl font-bold text-white">{taskCompletionRate}%</p>
                  )}
                  <p className="text-[10px] text-white/80 mt-0.5">Tasks</p>
                </button>

                {/* Inbox */}
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
              <div className="flex gap-2 mb-3">
                <div className="flex-1 bg-muted/50 rounded-xl p-2.5 flex items-center gap-2">
                  <Clock className="h-3.5 w-3.5 text-blue-500 shrink-0" />
                  <div>
                    {issuesLoading ? (
                      <Skeleton className="h-4 w-10" />
                    ) : (
                      <p className="text-sm font-bold">{avgResolutionTime > 0 ? `${avgResolutionTime.toFixed(1)}h` : '—'}</p>
                    )}
                    <p className="text-[10px] text-muted-foreground leading-none">Avg Resolution</p>
                  </div>
                </div>
                <div className="flex-1 bg-muted/50 rounded-xl p-2.5 flex items-center gap-2">
                  <Video className="h-3.5 w-3.5 text-amber-500 shrink-0" />
                  <div>
                    <p className="text-sm font-bold">{weeklyVideos.length}</p>
                    <p className="text-[10px] text-muted-foreground leading-none">Videos this week</p>
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

      {/* Admin clock-out / time-adjust dialog — mobile-first */}
      <Dialog open={!!clockOutTarget} onOpenChange={(open) => { if (!open) setClockOutTarget(null); }}>
        <DialogContent className="max-w-sm w-[calc(100vw-1.5rem)] rounded-3xl p-0 overflow-hidden gap-0">
          {/* Header */}
          <div className="px-6 pt-6 pb-4 border-b border-border/50">
            <DialogTitle className="text-lg font-bold">{clockOutTarget?.userName}</DialogTitle>
            <p className="text-xs text-muted-foreground mt-0.5">Adjust times and confirm clock-out</p>
          </div>

          {/* Overnight warning */}
          {clockOutTarget?.isOvernightShift && (
            <div className="mx-4 mt-4 flex items-start gap-2.5 text-amber-700 dark:text-amber-400 text-xs bg-amber-50 dark:bg-amber-950/30 border border-amber-200/60 dark:border-amber-800/30 px-3 py-2.5 rounded-xl">
              <Moon className="h-4 w-4 shrink-0 mt-0.5" />
              <span>Clocked in since <strong>yesterday</strong> — please check both times before confirming.</span>
            </div>
          )}

          {/* Time cards */}
          <div className="px-5 pt-4 pb-2 space-y-4">
            <TimeEditCard
              label="Clocked in"
              labelColor="text-green-600 dark:text-green-400"
              value={clockInEdit}
              onChange={setClockInEdit}
            />

            {/* Duration strip */}
            <div className="flex items-center gap-3">
              <div className="flex-1 h-px bg-border" />
              <div className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground bg-muted/60 px-3 py-1.5 rounded-full">
                <Clock className="h-3 w-3" />
                <span>{formatDuration(clockInEdit, clockOutEdit)}</span>
                <span className="font-normal">total</span>
              </div>
              <div className="flex-1 h-px bg-border" />
            </div>

            <TimeEditCard
              label="Clocking out"
              labelColor="text-red-600 dark:text-red-400"
              value={clockOutEdit}
              onChange={setClockOutEdit}
            />
          </div>

          {/* Slide to confirm + cancel */}
          <div className="px-5 pt-3 pb-6 space-y-3">
            <SlideToConfirm
              isPending={clockOutMutation.isPending}
              onConfirm={() => {
                if (!clockOutTarget) return;
                clockOutMutation.mutate({
                  id: clockOutTarget.timeEntryId,
                  clockInTime: clockInEdit,
                  clockOutTime: clockOutEdit,
                });
              }}
            />
            <Button
              variant="ghost"
              size="sm"
              className="w-full text-muted-foreground h-10"
              onClick={() => setClockOutTarget(null)}
            >
              Cancel
            </Button>
          </div>
        </DialogContent>
      </Dialog>

    </div>
  );
}
