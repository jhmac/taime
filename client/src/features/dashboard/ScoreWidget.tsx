import { useQuery } from '@tanstack/react-query';
import { useLocation } from 'wouter';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { ShieldCheck, CheckCircle2, Inbox, CalendarCheck, AlertTriangle, Zap, ArrowRight, Timer, Video } from 'lucide-react';

export default function ScoreWidget() {
  const { user } = useAuth();
  const [, navigate] = useLocation();

  const { data: gtdData, isLoading: gtdLoading } = useQuery<{
    success: boolean;
    data: {
      inbox_count: number;
      actions_today_count: number;
      actions_overdue_count: number;
      waiting_overdue_count: number;
      two_minute_actions_count: number;
    };
  }>({
    queryKey: ['/api/gtd/dashboard'],
    enabled: !!user,
    staleTime: 60_000,
  });

  const { data: tasks, isLoading: tasksLoading } = useQuery<any[]>({
    queryKey: ['/api/tasks'],
    enabled: !!user,
    staleTime: 60_000,
  });

  const { data: sopExecutionsRaw, isLoading: sopsLoading } = useQuery<any>({
    queryKey: ['/api/sops/executions'],
    enabled: !!user,
    staleTime: 60_000,
  });

  const sopExecutions = Array.isArray(sopExecutionsRaw) ? sopExecutionsRaw : (sopExecutionsRaw?.data || []);

  const now = new Date();
  const startOfWeek = new Date(now);
  startOfWeek.setDate(now.getDate() - now.getDay());
  startOfWeek.setHours(0, 0, 0, 0);

  const weeklyExecutions = sopExecutions.filter(
    (e: any) => new Date(e.startedAt || e.createdAt) >= startOfWeek
  );
  const completedWeeklyExecutions = weeklyExecutions.filter((e: any) => e.status === 'completed');
  const sopCompletionRate = weeklyExecutions.length > 0
    ? Math.round((completedWeeklyExecutions.length / weeklyExecutions.length) * 100)
    : 0;

  const allTasks = tasks || [];
  const completedTasks = allTasks.filter((t: any) => t.status === 'completed');
  const taskCompletionRate = allTasks.length > 0
    ? Math.round((completedTasks.length / allTasks.length) * 100)
    : 0;

  const { data: issuesRaw } = useQuery<any>({
    queryKey: ['/api/issues'],
    enabled: !!user,
    staleTime: 60_000,
  });

  const { data: improvementVideos } = useQuery<any[]>({
    queryKey: ['/api/improvement-videos'],
    enabled: !!user,
    staleTime: 60_000,
  });

  const issues = Array.isArray(issuesRaw) ? issuesRaw : (issuesRaw?.data || []);
  const closedIssues = issues.filter((i: any) => i.status === 'resolved' && i.resolvedAt && i.createdAt);
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

  const overdueGtdTotal = (gtdData?.data?.actions_overdue_count || 0) + (gtdData?.data?.waiting_overdue_count || 0);
  const quickWins = gtdData?.data?.two_minute_actions_count || 0;

  return (
    <div className="rounded-2xl border border-border bg-card p-4">
      <div className="flex items-center gap-2 mb-3">
        <CheckCircle2 className="h-4 w-4 text-purple-600" />
        <h3 className="text-sm font-semibold text-foreground">Tasks & Operations</h3>
      </div>

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
            <p className="text-xl font-bold text-white">{sopCompletionRate}%</p>
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

      <Button
        variant="outline"
        size="sm"
        className="w-full"
        onClick={() => navigate('/gtd/actions')}
      >
        What should I do next?
        <ArrowRight className="h-4 w-4 ml-2" />
      </Button>
    </div>
  );
}
