import { useState, useEffect } from 'react';
import { useLocation } from 'wouter';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/hooks/useAuth';
import { useIsMobile } from '@/hooks/use-mobile';
import { apiRequest } from '@/lib/queryClient';
import { Skeleton } from '@/components/ui/skeleton';
import SurfacedSOPBanner from '@/components/SurfacedSOPBanner';
import ImprovementFeedWidget from '@/components/ImprovementFeedWidget';
import LeanBoardCard from '@/features/dashboard/LeanBoardCard';
import SmartSuggestionsCard from '@/features/dashboard/SmartSuggestionsCard';
import { DashboardErrorBoundary } from '@/features/dashboard/DashboardErrorBoundary';
import GTDDashboardWidget from '@/features/gtd/GTDDashboardWidget';
import ScoreWidget from '@/features/dashboard/ScoreWidget';
import TimeClockWidget from '@/components/TimeClockWidget';
import DailyQuoteCard from '@/components/DailyQuoteCard';
import type { UserWithRole, Task, TimeEntry } from '@shared/schema';
import {
  Bot, AlertTriangle, Video, Heart, ChevronRight, CheckCircle2,
  GraduationCap, Building2, Circle, Trophy, MessageCircle,
  ClipboardList,
} from 'lucide-react';

const TASK_COLORS = ['#F47D31', '#4ECDC4', '#9B59B6', '#F9C846', '#6BCB77', '#FF6B6B'];

export default function AssociateDashboard() {
  const { user } = useAuth() as { user: UserWithRole | undefined; isLoading: boolean; isAuthenticated: boolean; error: any };
  const isMobile = useIsMobile();
  const [, navigate] = useLocation();
  const [currentTime, setCurrentTime] = useState(new Date());
  const queryClient = useQueryClient();

  useEffect(() => {
    const t = setInterval(() => setCurrentTime(new Date()), 60000);
    return () => clearInterval(t);
  }, []);

  const getGreeting = () => {
    const h = currentTime.getHours();
    if (h < 12) return 'Good morning';
    if (h < 17) return 'Good afternoon';
    return 'Good evening';
  };

  const dateStr = currentTime.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });

  const { data: activeTimeEntry } = useQuery<TimeEntry | null>({
    queryKey: ['/api/time-entries/active'],
    refetchInterval: 30000,
  });
  const isClockedIn = !!activeTimeEntry;

  const { data: tasks = [], isLoading: tasksLoading } = useQuery<Task[]>({
    queryKey: ['/api/tasks'],
  });
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const todayEnd = new Date(today); todayEnd.setHours(23, 59, 59, 999);
  const myTasksToday = tasks.filter(t =>
    t.assignedTo === user?.id && t.dueDate &&
    new Date(t.dueDate) >= today && new Date(t.dueDate) <= todayEnd
  );

  const toggleTaskMutation = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) =>
      apiRequest('PATCH', `/api/tasks/${id}`, { status }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['/api/tasks'] }),
  });

  const { data: sopExecutionsRaw = [] } = useQuery<any>({ queryKey: ['/api/sops/executions'] });
  const sopExecutions = Array.isArray(sopExecutionsRaw) ? sopExecutionsRaw : (sopExecutionsRaw?.data || []);
  const inProgressExecutions = sopExecutions.filter((e: any) => e.status === 'in_progress' && e.employeeId === user?.id);

  const { data: scoreData } = useQuery<{ overallScore: number; tier: string }>({
    queryKey: ['/api/gamification/my-score'],
    staleTime: 5 * 60 * 1000,
  });

  const { data: unreadData } = useQuery<{ success: boolean; data: { count: number } }>({
    queryKey: ['/api/messages/unread-count'],
    refetchInterval: 30000,
  });
  const unreadCount = unreadData?.data?.count || 0;

  const pendingTasks = myTasksToday.filter(t => t.status !== 'completed');
  const completedTasks = myTasksToday.filter(t => t.status === 'completed');

  const wrapper = `p-4 space-y-5 ${!isMobile ? 'max-w-2xl mx-auto' : ''}`;

  return (
    <div className="min-h-full bg-background">

      {/* ── HEADER ─────────────────────────────────────── */}
      <div className="px-5 pt-5 pb-3 flex items-center justify-between">
        <div>
          {/* 12px all-caps label is fine — it's decorative metadata, not readable content */}
          <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-1">{dateStr}</p>
          {/* 24px greeting — comfortable at arm's length */}
          <h1 className="text-2xl font-extrabold leading-tight text-foreground">
            {getGreeting()}, {user?.firstName || 'there'} 👋
          </h1>
        </div>
        <button
          onClick={() => window.dispatchEvent(new Event('open-ask-mainager'))}
          className="w-11 h-11 rounded-full flex items-center justify-center flex-shrink-0"
          style={{ backgroundColor: 'hsl(25 91% 57% / 0.12)', border: '1px solid hsl(25 91% 57% / 0.25)' }}
        >
          <Bot className="h-5 w-5 text-primary" />
        </button>
      </div>

      {/* ── PRE-CLOCK-IN ────────────────────────────────── */}
      {!isClockedIn && (
        <div className={wrapper}>

          <DashboardErrorBoundary fallback="Time clock failed to load">
            <TimeClockWidget />
          </DashboardErrorBoundary>

          <DashboardErrorBoundary fallback="">
            <SmartSuggestionsCard />
          </DashboardErrorBoundary>

          {/* Stat chips — 3 column */}
          <div className="grid grid-cols-3 gap-3">
            <StatChip
              icon={<ClipboardList className="h-4 w-4" style={{ color: '#F47D31' }} />}
              label="Tasks"
              value={pendingTasks.length > 0 ? `${pendingTasks.length}` : '✓'}
              sub={pendingTasks.length > 0 ? 'to do' : 'All done'}
              iconBg="bg-primary/10"
              onClick={() => navigate('/tasks')}
            />
            <StatChip
              icon={<Trophy className="h-4 w-4" style={{ color: '#F9C846' }} />}
              label="Score"
              value={scoreData ? `${scoreData.overallScore}` : '—'}
              sub={scoreData?.tier ?? 'pts'}
              iconBg="bg-yellow-100 dark:bg-yellow-900/30"
              onClick={() => navigate('/my-score')}
            />
            <StatChip
              icon={<MessageCircle className="h-4 w-4" style={{ color: '#4ECDC4' }} />}
              label="Messages"
              value={unreadCount > 0 ? `${unreadCount}` : '—'}
              sub={unreadCount > 0 ? 'unread' : 'Clear'}
              iconBg="bg-teal-100 dark:bg-teal-900/30"
              onClick={() => navigate('/messages')}
            />
          </div>

          {/* Task preview */}
          {myTasksToday.length > 0 && (
            <DashboardErrorBoundary fallback="">
              <div>
                <div className="flex items-center justify-between mb-3">
                  {/* 18px subheading — readable on mobile */}
                  <h2 className="text-lg font-extrabold text-foreground">Today's To-Do</h2>
                  {pendingTasks.length > 0 && (
                    <span className="w-6 h-6 rounded-full text-white text-xs font-extrabold flex items-center justify-center bg-primary">
                      {pendingTasks.length}
                    </span>
                  )}
                </div>
                <div className="rounded-3xl overflow-hidden bg-card border border-border">
                  {myTasksToday.slice(0, 4).map((task, i) => (
                    <button
                      key={task.id}
                      onClick={() => toggleTaskMutation.mutate({ id: task.id, status: task.status === 'completed' ? 'pending' : 'completed' })}
                      className="w-full flex items-center gap-3.5 px-4 py-4 text-left hover:bg-muted/40 transition-colors min-h-[56px]"
                      style={{ borderBottom: i < Math.min(myTasksToday.length, 4) - 1 ? '1px solid hsl(var(--border))' : 'none' }}
                    >
                      {task.status === 'completed'
                        ? <CheckCircle2 className="h-5 w-5 flex-shrink-0 text-green-500" />
                        : <Circle className="h-5 w-5 flex-shrink-0 text-muted-foreground/30" />
                      }
                      <div className="flex-1 min-w-0">
                        {/* 15px task title — just above minimum for body text */}
                        <p className={`text-[15px] font-bold leading-snug ${task.status === 'completed' ? 'line-through text-muted-foreground' : 'text-foreground'}`}>
                          {task.title}
                        </p>
                        {task.dueDate && (
                          // 12px for metadata only — acceptable as it's supplementary info
                          <p className="text-xs text-muted-foreground mt-0.5 font-medium">
                            Due {new Date(task.dueDate).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
                          </p>
                        )}
                      </div>
                      <ChevronRight className="h-4 w-4 text-muted-foreground/30 flex-shrink-0" />
                    </button>
                  ))}
                </div>
                {myTasksToday.length > 4 && (
                  // 14px for link text — minimum for tappable text
                  <button onClick={() => navigate('/tasks')} className="w-full text-center text-sm font-bold text-primary mt-3 py-1">
                    See all {myTasksToday.length} tasks →
                  </button>
                )}
              </div>
            </DashboardErrorBoundary>
          )}

          <DashboardErrorBoundary fallback=""><ScoreWidget /></DashboardErrorBoundary>
          <DashboardErrorBoundary fallback=""><DailyQuoteCard /></DashboardErrorBoundary>
          <DashboardErrorBoundary fallback=""><SurfacedSOPBanner /></DashboardErrorBoundary>
          <QuickActions navigate={navigate} />
          <DashboardErrorBoundary fallback=""><TrainingProgressCard /></DashboardErrorBoundary>
          <DashboardErrorBoundary fallback=""><LeanBoardCard /></DashboardErrorBoundary>
          <DashboardErrorBoundary fallback=""><GTDDashboardWidget /></DashboardErrorBoundary>
          <DashboardErrorBoundary fallback=""><ImprovementFeedWidget /></DashboardErrorBoundary>

        </div>
      )}

      {/* ── POST-CLOCK-IN ────────────────────────────────── */}
      {isClockedIn && (
        <div className={wrapper}>

          {/* Tasks — HERO */}
          <DashboardErrorBoundary fallback="Tasks failed to load">
            {tasksLoading ? (
              <div className="space-y-3">
                {[1, 2, 3].map(i => <Skeleton key={i} className="h-20 w-full rounded-3xl" />)}
              </div>
            ) : (
              <div>
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-2.5">
                    {/* 20px section heading — clear hierarchy on mobile */}
                    <h2 className="text-xl font-extrabold text-foreground">Your tasks today</h2>
                    {pendingTasks.length > 0 && (
                      <span className="w-6 h-6 rounded-full text-white text-xs font-extrabold flex items-center justify-center bg-primary">
                        {pendingTasks.length}
                      </span>
                    )}
                  </div>
                  <button onClick={() => navigate('/tasks')} className="text-sm font-bold text-primary flex items-center gap-0.5 py-1 px-2">
                    See all <ChevronRight className="h-3.5 w-3.5" />
                  </button>
                </div>

                {myTasksToday.length === 0 ? (
                  <div className="rounded-3xl p-8 text-center bg-card border border-border">
                    <p className="text-3xl mb-2">🎉</p>
                    {/* 18px for empty state heading — should feel comfortable, not tiny */}
                    <p className="text-lg font-bold text-foreground">All clear!</p>
                    <p className="text-sm text-muted-foreground mt-1">No tasks assigned for today.</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {/* Pending — numbered hero cards */}
                    {pendingTasks.map((task, i) => (
                      <button
                        key={task.id}
                        onClick={() => toggleTaskMutation.mutate({ id: task.id, status: 'completed' })}
                        disabled={toggleTaskMutation.isPending}
                        className="w-full rounded-3xl px-4 py-4 flex items-center gap-4 text-left transition-transform active:scale-[0.98] bg-card border min-h-[72px]"
                        style={{
                          borderColor: `${TASK_COLORS[i % TASK_COLORS.length]}30`,
                          boxShadow: `0 2px 12px ${TASK_COLORS[i % TASK_COLORS.length]}12`,
                        }}
                      >
                        {/* Number badge — 18px, well-sized for finger tap */}
                        <div
                          className="w-11 h-11 rounded-2xl flex items-center justify-center font-extrabold text-white text-lg flex-shrink-0"
                          style={{ backgroundColor: TASK_COLORS[i % TASK_COLORS.length] }}
                        >
                          {i + 1}
                        </div>
                        <div className="flex-1 min-w-0">
                          {/* 16px body — the minimum for comfortable mobile reading */}
                          <p className="text-base font-extrabold leading-snug text-foreground">{task.title}</p>
                          {task.dueDate && (
                            // 13px for supplementary metadata — acceptable below body min
                            <p className="text-[13px] font-semibold text-muted-foreground mt-1">
                              Due {new Date(task.dueDate).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
                            </p>
                          )}
                        </div>
                        {task.dueDate && (
                          <span
                            className="text-xs font-extrabold px-2.5 py-1 rounded-xl flex-shrink-0"
                            style={{
                              backgroundColor: `${TASK_COLORS[i % TASK_COLORS.length]}18`,
                              color: TASK_COLORS[i % TASK_COLORS.length],
                            }}
                          >
                            {new Date(task.dueDate).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
                          </span>
                        )}
                      </button>
                    ))}

                    {/* Completed — compact rows */}
                    {completedTasks.map(task => (
                      <button
                        key={task.id}
                        onClick={() => toggleTaskMutation.mutate({ id: task.id, status: 'pending' })}
                        disabled={toggleTaskMutation.isPending}
                        className="w-full flex items-center gap-3 px-4 py-3.5 rounded-2xl text-left transition-colors hover:bg-muted/30 min-h-[52px]"
                        style={{ backgroundColor: 'hsl(142 60% 50% / 0.06)', border: '1px solid hsl(142 60% 50% / 0.2)' }}
                      >
                        <CheckCircle2 className="h-5 w-5 text-green-500 flex-shrink-0" />
                        <div className="flex-1 min-w-0">
                          {/* 14px — secondary text, acceptable for "done" items */}
                          <p className="text-sm font-bold line-through truncate text-muted-foreground">{task.title}</p>
                          <p className="text-xs text-muted-foreground/60 mt-0.5">Done · tap to undo</p>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </DashboardErrorBoundary>

          <DashboardErrorBoundary fallback=""><SmartSuggestionsCard /></DashboardErrorBoundary>

          {inProgressExecutions.length > 0 && (
            <DashboardErrorBoundary fallback="">
              <button
                onClick={() => navigate(`/sops/execute/${inProgressExecutions[0].id}`)}
                className="w-full rounded-2xl p-4 flex items-center gap-3 text-left border min-h-[64px]"
                style={{ backgroundColor: 'hsl(142 60% 50% / 0.06)', borderColor: 'hsl(142 60% 50% / 0.25)' }}
              >
                <div className="w-11 h-11 rounded-full flex items-center justify-center shrink-0"
                  style={{ backgroundColor: 'hsl(142 60% 50% / 0.15)' }}>
                  <CheckCircle2 className="h-5 w-5 text-green-600" />
                </div>
                <div className="flex-1 min-w-0">
                  <h3 className="text-base font-bold text-foreground">Active SOP in Progress</h3>
                  <p className="text-sm text-muted-foreground">Continue where you left off</p>
                </div>
                <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
              </button>
            </DashboardErrorBoundary>
          )}

          <DashboardErrorBoundary fallback="Time clock failed to load">
            <TimeClockWidget />
          </DashboardErrorBoundary>

          <DashboardErrorBoundary fallback=""><SurfacedSOPBanner /></DashboardErrorBoundary>
          <DashboardErrorBoundary fallback=""><DailyQuoteCard /></DashboardErrorBoundary>
          <QuickActions navigate={navigate} />
          <DashboardErrorBoundary fallback=""><TrainingProgressCard /></DashboardErrorBoundary>
          <DashboardErrorBoundary fallback=""><ScoreWidget /></DashboardErrorBoundary>
          <DashboardErrorBoundary fallback=""><LeanBoardCard /></DashboardErrorBoundary>
          <DashboardErrorBoundary fallback=""><GTDDashboardWidget /></DashboardErrorBoundary>
          <DashboardErrorBoundary fallback=""><ImprovementFeedWidget /></DashboardErrorBoundary>

        </div>
      )}
    </div>
  );
}

// ── SHARED SUBCOMPONENTS ─────────────────────────────────────────

function StatChip({ icon, label, value, sub, iconBg, onClick }: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub: string;
  iconBg: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="rounded-2xl p-3.5 text-center bg-card border border-border w-full hover:bg-muted/30 transition-colors min-h-[80px] flex flex-col items-center justify-center"
    >
      <div className={`w-8 h-8 rounded-xl flex items-center justify-center mx-auto mb-2 ${iconBg}`}>
        {icon}
      </div>
      {/* 18px value — big enough to read at a glance */}
      <p className="text-lg font-extrabold text-foreground leading-none">{value}</p>
      {/* 11px is borderline but acceptable for a 3-column layout with very limited width */}
      <p className="text-[11px] font-semibold text-muted-foreground mt-1 uppercase tracking-wide leading-tight">{sub}</p>
    </button>
  );
}

function QuickActions({ navigate }: { navigate: (path: string) => void }) {
  return (
    <DashboardErrorBoundary fallback="">
      <div className="grid grid-cols-2 gap-3">
        {[
          { path: '/issues', bg: 'bg-red-500 dark:bg-red-600', icon: <AlertTriangle className="h-6 w-6 text-white" />, label: 'Report Issue' },
          { path: '/improvements', bg: 'bg-orange-500 dark:bg-orange-600', icon: <Video className="h-6 w-6 text-white" />, label: 'Record Improvement' },
          { path: '/communication', bg: 'bg-pink-500 dark:bg-pink-600', icon: <Heart className="h-6 w-6 text-white" />, label: 'Give a Kudo' },
          { path: '/cash', bg: 'bg-emerald-500 dark:bg-emerald-600', icon: <Building2 className="h-6 w-6 text-white" />, label: 'Cash Management' },
        ].map(({ path, bg, icon, label }) => (
          <button
            key={path}
            onClick={() => navigate(path)}
            className={`rounded-2xl ${bg} p-4 flex flex-col items-center text-center gap-2.5 transition-transform active:scale-95 hover:brightness-110 min-h-[96px]`}
          >
            <div className="w-12 h-12 rounded-full bg-white/20 flex items-center justify-center">
              {icon}
            </div>
            {/* 15px label on solid color — stands out enough even at this size */}
            <span className="text-[15px] font-semibold text-white leading-tight">{label}</span>
          </button>
        ))}
      </div>
    </DashboardErrorBoundary>
  );
}

function TrainingProgressCard() {
  const [, navigate] = useLocation();
  const { data } = useQuery<{ success: boolean; data: any[] }>({
    queryKey: ['/api/sops/templates/training-priority'],
  });
  const templates = data?.data ?? [];
  if (templates.length === 0) return null;
  const masteredCount = templates.filter((t: any) => t.mastery === 'mastered').length;
  const total = templates.length;
  const remaining = total - masteredCount;
  return (
    <button
      onClick={() => navigate('/sops/training')}
      className="w-full rounded-2xl bg-blue-600 dark:bg-blue-700 p-4 flex items-center gap-4 transition-transform active:scale-95 hover:brightness-110 text-left min-h-[72px]"
    >
      <div className="w-12 h-12 rounded-full bg-white/20 flex items-center justify-center shrink-0">
        <GraduationCap className="h-6 w-6 text-white" />
      </div>
      <div className="flex-1 min-w-0">
        <h3 className="text-base font-bold text-white">Training Hub</h3>
        <p className="text-sm text-white/70 mt-0.5">
          {remaining > 0 ? `${remaining} procedure${remaining > 1 ? 's' : ''} to learn` : 'All training mastered!'}
        </p>
      </div>
      <div className="text-right shrink-0">
        <div className="text-xl font-bold text-white">{masteredCount}/{total}</div>
        <div className="text-xs text-white/70">mastered</div>
      </div>
      <ChevronRight className="h-5 w-5 text-white/70 shrink-0" />
    </button>
  );
}
