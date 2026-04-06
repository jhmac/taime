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

  // Clock-in state
  const { data: activeTimeEntry } = useQuery<TimeEntry | null>({
    queryKey: ['/api/time-entries/active'],
    refetchInterval: 30000,
  });
  const isClockedIn = !!activeTimeEntry;

  // Tasks
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

  // SOP executions
  const { data: sopExecutionsRaw = [] } = useQuery<any>({ queryKey: ['/api/sops/executions'] });
  const sopExecutions = Array.isArray(sopExecutionsRaw) ? sopExecutionsRaw : (sopExecutionsRaw?.data || []);
  const inProgressExecutions = sopExecutions.filter((e: any) => e.status === 'in_progress' && e.employeeId === user?.id);

  // Score
  const { data: scoreData } = useQuery<{ overallScore: number; tier: string }>({
    queryKey: ['/api/gamification/my-score'],
    staleTime: 5 * 60 * 1000,
  });

  // Unread messages
  const { data: unreadData } = useQuery<{ success: boolean; data: { count: number } }>({
    queryKey: ['/api/messages/unread-count'],
    refetchInterval: 30000,
  });
  const unreadCount = unreadData?.data?.count || 0;

  const pendingTasks = myTasksToday.filter(t => t.status !== 'completed');
  const completedTasks = myTasksToday.filter(t => t.status === 'completed');

  const wrapper = `p-4 space-y-4 ${!isMobile ? 'max-w-2xl mx-auto' : ''}`;

  return (
    <div className="min-h-full bg-background">

      {/* ── COMPACT HEADER ─────────────────────────────── */}
      <div className="px-5 pt-5 pb-3 flex items-center justify-between">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground mb-0.5">{dateStr}</p>
          <h1 className="text-[22px] font-extrabold leading-tight text-foreground">
            {getGreeting()}, {user?.firstName || 'there'} 👋
          </h1>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => window.dispatchEvent(new Event('open-ask-mainager'))}
            className="w-10 h-10 rounded-full flex items-center justify-center"
            style={{ backgroundColor: 'hsl(25 91% 57% / 0.12)', border: '1px solid hsl(25 91% 57% / 0.25)' }}
          >
            <Bot className="h-4 w-4 text-primary" />
          </button>
        </div>
      </div>

      {/* ── PRE-CLOCK-IN LAYOUT ─────────────────────────── */}
      {!isClockedIn && (
        <div className={wrapper}>

          {/* Time Clock — HERO */}
          <DashboardErrorBoundary fallback="Time clock failed to load">
            <TimeClockWidget />
          </DashboardErrorBoundary>

          {/* Suggestions / alerts */}
          <DashboardErrorBoundary fallback="">
            <SmartSuggestionsCard />
          </DashboardErrorBoundary>

          {/* Stats chips */}
          <div className="grid grid-cols-3 gap-2.5">
            <StatChip
              icon={<ClipboardList className="h-3.5 w-3.5" style={{ color: '#F47D31' }} />}
              label="Tasks"
              value={pendingTasks.length > 0 ? `${pendingTasks.length} to do` : 'All done!'}
              iconBg="bg-primary/10"
              onClick={() => navigate('/tasks')}
            />
            <StatChip
              icon={<Trophy className="h-3.5 w-3.5" style={{ color: '#F9C846' }} />}
              label="Score"
              value={scoreData ? `${scoreData.overallScore}` : '—'}
              iconBg="bg-yellow-100 dark:bg-yellow-900/30"
              onClick={() => navigate('/my-score')}
            />
            <StatChip
              icon={<MessageCircle className="h-3.5 w-3.5" style={{ color: '#4ECDC4' }} />}
              label="Messages"
              value={unreadCount > 0 ? `${unreadCount} new` : 'Clear'}
              iconBg="bg-teal-100 dark:bg-teal-900/30"
              onClick={() => navigate('/messages')}
            />
          </div>

          {/* Task preview */}
          {myTasksToday.length > 0 && (
            <DashboardErrorBoundary fallback="">
              <div>
                <div className="flex items-center justify-between mb-3">
                  <h2 className="text-[16px] font-extrabold text-foreground">Today's To-Do</h2>
                  <span className="w-5 h-5 rounded-full text-white text-[10px] font-extrabold flex items-center justify-center bg-primary">
                    {pendingTasks.length}
                  </span>
                </div>
                <div className="rounded-3xl overflow-hidden bg-card border border-border">
                  {myTasksToday.slice(0, 4).map((task, i) => (
                    <button
                      key={task.id}
                      onClick={() => toggleTaskMutation.mutate({ id: task.id, status: task.status === 'completed' ? 'pending' : 'completed' })}
                      className="w-full flex items-center gap-3.5 px-4 py-3.5 text-left hover:bg-muted/40 transition-colors"
                      style={{ borderBottom: i < Math.min(myTasksToday.length, 4) - 1 ? '1px solid hsl(var(--border))' : 'none' }}
                    >
                      {task.status === 'completed'
                        ? <CheckCircle2 className="h-5 w-5 flex-shrink-0 text-green-500" />
                        : <Circle className="h-5 w-5 flex-shrink-0 text-muted-foreground/30" />
                      }
                      <div className="flex-1 min-w-0">
                        <p className={`text-[13px] font-bold leading-snug ${task.status === 'completed' ? 'line-through text-muted-foreground' : 'text-foreground'}`}>
                          {task.title}
                        </p>
                        {task.dueDate && (
                          <p className="text-[10px] font-semibold text-muted-foreground mt-0.5">
                            Due {new Date(task.dueDate).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
                          </p>
                        )}
                      </div>
                      <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/30 flex-shrink-0" />
                    </button>
                  ))}
                </div>
                {myTasksToday.length > 4 && (
                  <button onClick={() => navigate('/tasks')} className="w-full text-center text-[12px] font-bold text-primary mt-2">
                    See all {myTasksToday.length} tasks →
                  </button>
                )}
              </div>
            </DashboardErrorBoundary>
          )}

          <DashboardErrorBoundary fallback="">
            <ScoreWidget />
          </DashboardErrorBoundary>

          <DashboardErrorBoundary fallback="">
            <DailyQuoteCard />
          </DashboardErrorBoundary>

          <DashboardErrorBoundary fallback="">
            <SurfacedSOPBanner />
          </DashboardErrorBoundary>

          <QuickActions navigate={navigate} />

          <DashboardErrorBoundary fallback="">
            <TrainingProgressCard />
          </DashboardErrorBoundary>

          <DashboardErrorBoundary fallback="">
            <LeanBoardCard />
          </DashboardErrorBoundary>

          <DashboardErrorBoundary fallback="">
            <GTDDashboardWidget />
          </DashboardErrorBoundary>

          <DashboardErrorBoundary fallback="">
            <ImprovementFeedWidget />
          </DashboardErrorBoundary>

        </div>
      )}

      {/* ── POST-CLOCK-IN LAYOUT ─────────────────────────── */}
      {isClockedIn && (
        <div className={wrapper}>

          {/* Tasks — HERO */}
          <DashboardErrorBoundary fallback="Tasks failed to load">
            {tasksLoading ? (
              <div className="space-y-2.5">
                {[1, 2, 3].map(i => <Skeleton key={i} className="h-20 w-full rounded-3xl" />)}
              </div>
            ) : (
              <div>
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2.5">
                    <h2 className="text-[19px] font-extrabold text-foreground">Your tasks today</h2>
                    {pendingTasks.length > 0 && (
                      <span className="w-6 h-6 rounded-full text-white text-[11px] font-extrabold flex items-center justify-center bg-primary">
                        {pendingTasks.length}
                      </span>
                    )}
                  </div>
                  <button onClick={() => navigate('/tasks')} className="text-[12px] font-bold text-primary flex items-center gap-0.5">
                    See all <ChevronRight className="h-3 w-3" />
                  </button>
                </div>

                {myTasksToday.length === 0 ? (
                  <div className="rounded-3xl p-6 text-center bg-card border border-border">
                    <p className="text-2xl mb-2">🎉</p>
                    <p className="text-[14px] font-bold text-foreground">All clear!</p>
                    <p className="text-[12px] text-muted-foreground mt-1">No tasks assigned for today.</p>
                  </div>
                ) : (
                  <div className="space-y-2.5">
                    {/* Pending tasks as numbered hero cards */}
                    {pendingTasks.map((task, i) => (
                      <button
                        key={task.id}
                        onClick={() => toggleTaskMutation.mutate({ id: task.id, status: 'completed' })}
                        disabled={toggleTaskMutation.isPending}
                        className="w-full rounded-3xl px-4 py-4 flex items-center gap-4 text-left transition-transform active:scale-[0.98] bg-card border"
                        style={{
                          borderColor: `${TASK_COLORS[i % TASK_COLORS.length]}22`,
                          boxShadow: `0 2px 12px ${TASK_COLORS[i % TASK_COLORS.length]}10`,
                        }}
                      >
                        {/* Number badge */}
                        <div
                          className="w-10 h-10 rounded-2xl flex items-center justify-center font-extrabold text-white text-[15px] flex-shrink-0"
                          style={{ backgroundColor: TASK_COLORS[i % TASK_COLORS.length] }}
                        >
                          {i + 1}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-[14px] font-extrabold leading-snug text-foreground">{task.title}</p>
                          {task.dueDate && (
                            <p className="text-[11px] font-semibold text-muted-foreground mt-0.5">
                              Due {new Date(task.dueDate).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
                            </p>
                          )}
                        </div>
                        <div className="flex flex-col items-end gap-1.5 flex-shrink-0">
                          {task.dueDate && (
                            <span
                              className="text-[10px] font-extrabold px-2 py-0.5 rounded-lg"
                              style={{
                                backgroundColor: `${TASK_COLORS[i % TASK_COLORS.length]}15`,
                                color: TASK_COLORS[i % TASK_COLORS.length],
                              }}
                            >
                              {new Date(task.dueDate).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
                            </span>
                          )}
                          <Circle className="h-5 w-5 text-muted-foreground/20" />
                        </div>
                      </button>
                    ))}

                    {/* Completed tasks */}
                    {completedTasks.map(task => (
                      <button
                        key={task.id}
                        onClick={() => toggleTaskMutation.mutate({ id: task.id, status: 'pending' })}
                        disabled={toggleTaskMutation.isPending}
                        className="w-full flex items-center gap-3 px-4 py-3 rounded-2xl text-left transition-colors hover:bg-muted/30"
                        style={{ backgroundColor: 'hsl(142 60% 50% / 0.06)', border: '1px solid hsl(142 60% 50% / 0.2)' }}
                      >
                        <CheckCircle2 className="h-4 w-4 text-green-500 flex-shrink-0" />
                        <div className="flex-1 min-w-0">
                          <p className="text-[12px] font-bold line-through truncate text-muted-foreground">{task.title}</p>
                          <p className="text-[10px] font-semibold text-muted-foreground/60">Done · tap to undo</p>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </DashboardErrorBoundary>

          {/* Suggestions / alerts */}
          <DashboardErrorBoundary fallback="">
            <SmartSuggestionsCard />
          </DashboardErrorBoundary>

          {/* SOP in progress */}
          {inProgressExecutions.length > 0 && (
            <DashboardErrorBoundary fallback="">
              <button
                onClick={() => navigate(`/sops/execute/${inProgressExecutions[0].id}`)}
                className="w-full rounded-2xl p-4 flex items-center gap-3 text-left border"
                style={{ backgroundColor: 'hsl(142 60% 50% / 0.06)', borderColor: 'hsl(142 60% 50% / 0.25)' }}
              >
                <div className="w-10 h-10 rounded-full flex items-center justify-center shrink-0"
                  style={{ backgroundColor: 'hsl(142 60% 50% / 0.15)' }}>
                  <CheckCircle2 className="h-5 w-5 text-green-600" />
                </div>
                <div className="flex-1 min-w-0">
                  <h3 className="text-sm font-bold text-foreground">Active SOP in Progress</h3>
                  <p className="text-xs text-muted-foreground">Continue where you left off</p>
                </div>
                <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
              </button>
            </DashboardErrorBoundary>
          )}

          {/* Compact clock widget (shows clock-out when clocked in) */}
          <DashboardErrorBoundary fallback="Time clock failed to load">
            <TimeClockWidget />
          </DashboardErrorBoundary>

          <DashboardErrorBoundary fallback="">
            <SurfacedSOPBanner />
          </DashboardErrorBoundary>

          <DashboardErrorBoundary fallback="">
            <DailyQuoteCard />
          </DashboardErrorBoundary>

          <QuickActions navigate={navigate} />

          <DashboardErrorBoundary fallback="">
            <TrainingProgressCard />
          </DashboardErrorBoundary>

          <DashboardErrorBoundary fallback="">
            <ScoreWidget />
          </DashboardErrorBoundary>

          <DashboardErrorBoundary fallback="">
            <LeanBoardCard />
          </DashboardErrorBoundary>

          <DashboardErrorBoundary fallback="">
            <GTDDashboardWidget />
          </DashboardErrorBoundary>

          <DashboardErrorBoundary fallback="">
            <ImprovementFeedWidget />
          </DashboardErrorBoundary>

        </div>
      )}
    </div>
  );
}

// ── SHARED SUBCOMPONENTS ─────────────────────────────────────────

function StatChip({ icon, label, value, iconBg, onClick }: {
  icon: React.ReactNode; label: string; value: string; iconBg: string; onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="rounded-2xl p-3 text-center bg-card border border-border w-full hover:bg-muted/30 transition-colors"
    >
      <div className={`w-7 h-7 rounded-xl flex items-center justify-center mx-auto mb-1.5 ${iconBg}`}>
        {icon}
      </div>
      <p className="text-[13px] font-extrabold text-foreground leading-none">{value}</p>
      <p className="text-[9px] font-bold uppercase tracking-wide text-muted-foreground mt-1">{label}</p>
    </button>
  );
}

function QuickActions({ navigate }: { navigate: (path: string) => void }) {
  return (
    <DashboardErrorBoundary fallback="">
      <div className="grid grid-cols-2 gap-3">
        <button onClick={() => navigate('/issues')}
          className="rounded-2xl bg-red-500 dark:bg-red-600 p-4 flex flex-col items-center text-center gap-2 transition-transform active:scale-95 hover:brightness-110">
          <div className="w-11 h-11 rounded-full bg-white/20 flex items-center justify-center">
            <AlertTriangle className="h-5 w-5 text-white" />
          </div>
          <span className="text-sm font-semibold text-white">Report Issue</span>
        </button>
        <button onClick={() => navigate('/improvements')}
          className="rounded-2xl bg-orange-500 dark:bg-orange-600 p-4 flex flex-col items-center text-center gap-2 transition-transform active:scale-95 hover:brightness-110">
          <div className="w-11 h-11 rounded-full bg-white/20 flex items-center justify-center">
            <Video className="h-5 w-5 text-white" />
          </div>
          <span className="text-sm font-semibold text-white">Record Improvement</span>
        </button>
        <button onClick={() => navigate('/communication')}
          className="rounded-2xl bg-pink-500 dark:bg-pink-600 p-4 flex flex-col items-center text-center gap-2 transition-transform active:scale-95 hover:brightness-110">
          <div className="w-11 h-11 rounded-full bg-white/20 flex items-center justify-center">
            <Heart className="h-5 w-5 text-white" />
          </div>
          <span className="text-sm font-semibold text-white">Give a Kudo</span>
        </button>
        <button onClick={() => navigate('/cash')}
          className="rounded-2xl bg-emerald-500 dark:bg-emerald-600 p-4 flex flex-col items-center text-center gap-2 transition-transform active:scale-95 hover:brightness-110">
          <div className="w-11 h-11 rounded-full bg-white/20 flex items-center justify-center">
            <Building2 className="h-5 w-5 text-white" />
          </div>
          <span className="text-sm font-semibold text-white">Cash Management</span>
        </button>
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
      className="w-full rounded-2xl bg-blue-600 dark:bg-blue-700 p-4 flex items-center gap-4 transition-transform active:scale-95 hover:brightness-110 text-left"
    >
      <div className="w-12 h-12 rounded-full bg-white/20 flex items-center justify-center shrink-0">
        <GraduationCap className="h-6 w-6 text-white" />
      </div>
      <div className="flex-1 min-w-0">
        <h3 className="text-sm font-bold text-white">Training Hub</h3>
        <p className="text-xs text-white/70">
          {remaining > 0 ? `${remaining} procedure${remaining > 1 ? 's' : ''} to learn` : 'All training mastered!'}
        </p>
      </div>
      <div className="text-right shrink-0">
        <div className="text-lg font-bold text-white">{masteredCount}/{total}</div>
        <div className="text-[10px] text-white/70">mastered</div>
      </div>
      <ChevronRight className="h-5 w-5 text-white/70 shrink-0" />
    </button>
  );
}
