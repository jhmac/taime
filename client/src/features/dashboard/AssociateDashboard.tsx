import { useState, useEffect } from 'react';
import { useLocation } from 'wouter';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/hooks/useAuth';
import { useIsMobile } from '@/hooks/use-mobile';
import { apiRequest } from '@/lib/queryClient';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Checkbox } from '@/components/ui/checkbox';
import DailyQuoteCard from '@/components/DailyQuoteCard';
import SurfacedSOPBanner from '@/components/SurfacedSOPBanner';
import ImprovementFeedWidget from '@/components/ImprovementFeedWidget';
import LeanBoardCard from '@/features/dashboard/LeanBoardCard';
import SmartSuggestionsCard from '@/features/dashboard/SmartSuggestionsCard';
import { DashboardErrorBoundary } from '@/features/dashboard/DashboardErrorBoundary';
import GTDDashboardWidget from '@/features/gtd/GTDDashboardWidget';
import ScoreWidget from '@/features/dashboard/ScoreWidget';
import TimeClockWidget from '@/components/TimeClockWidget';
import type { UserWithRole, Task, SopExecution } from '@shared/schema';
import {
  Bot,
  AlertTriangle,
  Video,
  Heart,
  ChevronRight,
  CheckCircle2,
  ClipboardList,
  BarChart3,
  GraduationCap,
  Building2,
} from 'lucide-react';

export default function AssociateDashboard() {
  const { user } = useAuth() as { user: UserWithRole | undefined; isLoading: boolean; isAuthenticated: boolean; error: any };
  const isMobile = useIsMobile();
  const [, navigate] = useLocation();
  const [currentTime, setCurrentTime] = useState(new Date());
  const queryClient = useQueryClient();

  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 60000);
    return () => clearInterval(timer);
  }, []);

  const getGreeting = () => {
    const hour = currentTime.getHours();
    if (hour < 12) return 'Good morning';
    if (hour < 17) return 'Good afternoon';
    return 'Good evening';
  };

  const { data: tasks = [], isLoading: tasksLoading } = useQuery<Task[]>({
    queryKey: ['/api/tasks'],
  });

  const { data: sopExecutionsRaw = [], isLoading: sopsLoading } = useQuery<any>({
    queryKey: ['/api/sops/executions'],
  });
  const sopExecutions = Array.isArray(sopExecutionsRaw) ? sopExecutionsRaw : (sopExecutionsRaw?.data || []);

  const inProgressExecutions = (sopExecutions as any[]).filter(
    (e: any) => e.status === 'in_progress' && e.employeeId === user?.id
  );

  const toggleTaskMutation = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      return await apiRequest('PATCH', `/api/tasks/${id}`, { status });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/tasks'] });
    },
  });

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayEnd = new Date(today);
  todayEnd.setHours(23, 59, 59, 999);

  const myTasksToday = tasks.filter((t) => {
    if (t.assignedTo !== user?.id) return false;
    if (!t.dueDate) return false;
    const due = new Date(t.dueDate);
    return due >= today && due <= todayEnd;
  });

  const tasksCompletedToday = myTasksToday.filter((t) => t.status === 'completed').length;

  const startOfWeek = new Date(today);
  startOfWeek.setDate(startOfWeek.getDate() - startOfWeek.getDay());
  const sopExecutionsThisWeek = (sopExecutions as any[]).filter((e: any) => {
    if (e.employeeId !== user?.id) return false;
    if (!e.completedAt) return false;
    return new Date(e.completedAt) >= startOfWeek;
  }).length;

  return (
    <div className="min-h-full bg-background">
      <DashboardErrorBoundary fallback="Header failed to load">
        <div className="bg-gradient-to-br from-primary to-primary/80 text-primary-foreground p-5 rounded-b-2xl md:rounded-xl md:m-6 md:mt-4">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-white/20 flex items-center justify-center text-sm font-semibold overflow-hidden">
                {user?.profileImageUrl ? (
                  <img src={user.profileImageUrl} alt="" className="w-10 h-10 rounded-full object-cover" />
                ) : (
                  `${(user?.firstName || '')[0] || ''}${(user?.lastName || '')[0] || ''}`
                )}
              </div>
              <div>
                <h1 className="text-base md:text-lg font-bold">
                  {getGreeting()}, {user?.firstName || 'there'}!
                </h1>
                <p className="text-xs opacity-80">Here's your day.</p>
              </div>
            </div>
            <Button
              onClick={() => window.dispatchEvent(new Event("open-ask-mainager"))}
              size="icon"
              className="bg-white/20 hover:bg-white/30 text-white rounded-full h-9 w-9"
            >
              <Bot className="h-4 w-4" />
            </Button>
          </div>
          <p className="text-xs opacity-70">
            {currentTime.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })} &bull;{' '}
            {currentTime.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })}
          </p>
        </div>
      </DashboardErrorBoundary>

      <div className={`p-4 space-y-4 ${!isMobile ? 'max-w-3xl mx-auto' : ''}`}>
        <DashboardErrorBoundary fallback="Time clock failed to load">
          <TimeClockWidget />
        </DashboardErrorBoundary>

        <DashboardErrorBoundary fallback="Score widget failed to load">
          <ScoreWidget />
        </DashboardErrorBoundary>

        <DashboardErrorBoundary fallback="Quote failed to load">
          <DailyQuoteCard />
        </DashboardErrorBoundary>

        <DashboardErrorBoundary fallback="SOP banner failed to load">
          <SurfacedSOPBanner />
        </DashboardErrorBoundary>

        <DashboardErrorBoundary fallback="Suggestions failed to load">
          <SmartSuggestionsCard />
        </DashboardErrorBoundary>

        <DashboardErrorBoundary fallback="Tasks failed to load">
          <Card>
            <CardHeader className="pb-2 px-4 pt-4">
              <CardTitle className="text-sm font-bold flex items-center gap-1.5">
                <ClipboardList className="h-4 w-4 text-blue-500" />
                My Tasks Today
              </CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-4 pt-0">
              {tasksLoading ? (
                <div className="space-y-2">
                  {[1, 2, 3].map((i) => (
                    <Skeleton key={i} className="h-10 w-full" />
                  ))}
                </div>
              ) : myTasksToday.length === 0 ? (
                <p className="text-sm text-muted-foreground py-2">No tasks assigned for today. 🎉</p>
              ) : (
                <div className="space-y-2">
                  {myTasksToday.map((task) => (
                    <div
                      key={task.id}
                      className="flex items-center gap-3 p-2 rounded-lg hover:bg-muted/50 transition-colors"
                    >
                      <Checkbox
                        checked={task.status === 'completed'}
                        disabled={toggleTaskMutation.isPending}
                        onCheckedChange={(checked) => {
                          toggleTaskMutation.mutate({
                            id: task.id,
                            status: checked ? 'completed' : 'pending',
                          });
                        }}
                      />
                      <span
                        className={`text-sm flex-1 ${
                          task.status === 'completed' ? 'line-through text-muted-foreground' : ''
                        }`}
                      >
                        {task.title}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </DashboardErrorBoundary>

        <DashboardErrorBoundary fallback="GTD widget failed to load">
          <GTDDashboardWidget />
        </DashboardErrorBoundary>

        {!sopsLoading && inProgressExecutions.length > 0 && (
          <DashboardErrorBoundary fallback="Active SOP failed to load">
            <Card className="border-green-200 dark:border-green-800/50 bg-green-50/50 dark:bg-green-950/20">
              <CardContent className="p-4 flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-green-100 dark:bg-green-900/40 flex items-center justify-center shrink-0">
                  <CheckCircle2 className="h-5 w-5 text-green-600 dark:text-green-400" />
                </div>
                <div className="flex-1 min-w-0">
                  <h3 className="text-sm font-bold">Active SOP in Progress</h3>
                  <p className="text-xs text-muted-foreground truncate">
                    Continue where you left off
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  className="shrink-0"
                  onClick={() => navigate(`/sops/execute/${inProgressExecutions[0].id}`)}
                >
                  Continue <ChevronRight className="h-3 w-3 ml-1" />
                </Button>
              </CardContent>
            </Card>
          </DashboardErrorBoundary>
        )}

        <DashboardErrorBoundary fallback="Quick actions failed to load">
          <div className="grid grid-cols-3 gap-3">
            <Card
              className="cursor-pointer hover:shadow-md transition-shadow"
              onClick={() => navigate('/issues')}
            >
              <CardContent className="p-3 flex flex-col items-center text-center">
                <div className="w-10 h-10 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center mb-1.5">
                  <AlertTriangle className="h-4 w-4 text-red-600 dark:text-red-400" />
                </div>
                <span className="text-xs font-medium">Report Issue</span>
              </CardContent>
            </Card>
            <Card
              className="cursor-pointer hover:shadow-md transition-shadow"
              onClick={() => navigate('/improvements')}
            >
              <CardContent className="p-3 flex flex-col items-center text-center">
                <div className="w-10 h-10 rounded-full bg-orange-100 dark:bg-orange-900/30 flex items-center justify-center mb-1.5">
                  <Video className="h-4 w-4 text-orange-600 dark:text-orange-400" />
                </div>
                <span className="text-xs font-medium">Record Improvement</span>
              </CardContent>
            </Card>
            <Card
              className="cursor-pointer hover:shadow-md transition-shadow"
              onClick={() => navigate('/communication')}
            >
              <CardContent className="p-3 flex flex-col items-center text-center">
                <div className="w-10 h-10 rounded-full bg-pink-100 dark:bg-pink-900/30 flex items-center justify-center mb-1.5">
                  <Heart className="h-4 w-4 text-pink-600 dark:text-pink-400" />
                </div>
                <span className="text-xs font-medium">Give a Kudo</span>
              </CardContent>
            </Card>
            <Card
              className="cursor-pointer hover:shadow-md transition-shadow"
              onClick={() => navigate('/cash')}
            >
              <CardContent className="p-3 flex flex-col items-center text-center">
                <div className="w-10 h-10 rounded-full bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center mb-1.5">
                  <Building2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                </div>
                <span className="text-xs font-medium">Cash Management</span>
              </CardContent>
            </Card>
          </div>
        </DashboardErrorBoundary>

        <DashboardErrorBoundary fallback="Training card failed to load">
          <TrainingProgressCard />
        </DashboardErrorBoundary>

        <DashboardErrorBoundary fallback="Lean board card failed to load">
          <LeanBoardCard />
        </DashboardErrorBoundary>

        <DashboardErrorBoundary fallback="Improvement feed failed to load">
          <ImprovementFeedWidget />
        </DashboardErrorBoundary>

        <DashboardErrorBoundary fallback="Stats failed to load">
          <Card>
            <CardContent className="p-4">
              <h3 className="text-sm font-bold flex items-center gap-1.5 mb-3">
                <BarChart3 className="h-4 w-4 text-indigo-500" />
                My Stats
              </h3>
              <div className="grid grid-cols-2 gap-3">
                <div className="bg-muted/50 rounded-lg p-3 text-center">
                  <div className="text-2xl font-bold text-foreground">{tasksCompletedToday}</div>
                  <div className="text-xs text-muted-foreground">Tasks done today</div>
                </div>
                <div className="bg-muted/50 rounded-lg p-3 text-center">
                  <div className="text-2xl font-bold text-foreground">{sopExecutionsThisWeek}</div>
                  <div className="text-xs text-muted-foreground">SOPs this week</div>
                </div>
              </div>
            </CardContent>
          </Card>
        </DashboardErrorBoundary>
      </div>

    </div>
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
    <Card className="cursor-pointer hover:shadow-md transition-shadow" onClick={() => navigate('/sops/training')}>
      <CardContent className="p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center">
              <GraduationCap className="h-5 w-5 text-blue-600 dark:text-blue-400" />
            </div>
            <div>
              <h3 className="text-sm font-bold">Training Hub</h3>
              <p className="text-xs text-muted-foreground">
                {remaining > 0 
                  ? `${remaining} procedure${remaining > 1 ? 's' : ''} to learn` 
                  : 'All training mastered!'}
              </p>
            </div>
          </div>
          <div className="text-right">
            <div className="text-lg font-bold text-primary">{masteredCount}/{total}</div>
            <div className="text-[10px] text-muted-foreground">mastered</div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
