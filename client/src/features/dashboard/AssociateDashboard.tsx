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
import ScoreWidget from '@/features/dashboard/ScoreWidget';
import TimeClockWidget from '@/components/TimeClockWidget';
import PaySummaryWidget from '@/features/dashboard/PaySummaryWidget';
import DailyQuestionnaireCard from '@/features/dashboard/DailyQuestionnaireCard';
import DailyQuoteCard from '@/components/DailyQuoteCard';
import TeamStatusWidget from '@/features/dashboard/TeamStatusWidget';
import type { UserWithRole, Task, TimeEntry } from '@shared/schema';
import {
  Bot, AlertTriangle, Video, Heart, ChevronRight, CheckCircle2,
  GraduationCap, Building2, Circle, Trophy, MessageCircle,
  ClipboardList, Brain, Flame, Zap, CheckCircle, XCircle,
} from 'lucide-react';

// ── Brain Boost Card ────────────────────────────────────────────────────────

interface QuizQuestion {
  id: string;
  questionText: string;
  answerChoices: string[];
  correctAnswerIndex: number;
  coachingText?: string;
  topicTag: string;
  difficulty: string;
}

interface QuizAnswerResponse {
  success: boolean;
  data: {
    isCorrect: boolean;
    coachingText?: string;
    correctAnswerIndex: number;
    sessionCompleted?: boolean;
    alreadyCompleted?: boolean;
    alreadyAnswered?: boolean;
    session?: {
      id: string;
      score?: number;
      totalPoints?: number;
      correctAnswers?: number;
      totalQuestions?: number;
      streakMultiplier?: number;
    };
  };
}

interface DailyQuizData {
  session: { id: string; status: string; topicTag: string; streakMultiplier: number; totalPoints?: number; score?: number; correctAnswers?: number; totalQuestions: number } | null;
  topic?: string;
  questions?: QuizQuestion[];
  answeredCount?: number;
  totalCount?: number;
  completed: boolean;
  noQuestions?: boolean;
  isBossBattle?: boolean;
  streakMultiplier?: number;
}

function BrainBoostCard() {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [qIndex, setQIndex] = useState(0);
  const [selected, setSelected] = useState<number | null>(null);
  const [answerResult, setAnswerResult] = useState<{ isCorrect: boolean; coachingText?: string; correctAnswerIndex: number } | null>(null);
  const [sessionDone, setSessionDone] = useState(false);
  const [finalData, setFinalData] = useState<{ score: number; totalPoints: number; correctAnswers: number; totalQuestions: number; multiplier: number } | null>(null);

  const { data: quizData, isLoading } = useQuery<{ success: boolean; data: DailyQuizData }>({
    queryKey: ['/api/quiz/daily'],
    staleTime: 60_000,
  });

  const { data: statsData } = useQuery<{ success: boolean; data: { currentStreak: number; streakMultiplier: number; seasonPoints: number } }>({
    queryKey: ['/api/quiz/stats'],
    staleTime: 60_000,
  });

  const { data: leaderboardData } = useQuery<{ success: boolean; data: { season: string; leaders: Array<{ userId: string; firstName: string; lastName: string; seasonPoints: number; currentStreakDays: number }> } }>({
    queryKey: ['/api/quiz/leaderboard/season'],
    staleTime: 120_000,
    enabled: open,
  });

  const answerMutation = useMutation<QuizAnswerResponse, Error, { sessionId: string; questionId: string; selectedIndex: number }>({
    mutationFn: async ({ sessionId, questionId, selectedIndex }) => {
      const res = await apiRequest('POST', '/api/quiz/answer', { sessionId, questionId, selectedIndex });
      return res.json() as Promise<QuizAnswerResponse>;
    },
    onSuccess: (response) => {
      const d = response?.data;
      if (!d || d.alreadyCompleted || d.alreadyAnswered) return;
      setAnswerResult({
        isCorrect: d.isCorrect,
        coachingText: d.coachingText,
        correctAnswerIndex: d.correctAnswerIndex,
      });
      if (d.sessionCompleted && d.session) {
        setSessionDone(true);
        setFinalData({
          score: d.session.score ?? 0,
          totalPoints: d.session.totalPoints ?? 0,
          correctAnswers: d.session.correctAnswers ?? 0,
          totalQuestions: d.session.totalQuestions ?? 0,
          multiplier: d.session.streakMultiplier ?? 1,
        });
        queryClient.invalidateQueries({ queryKey: ['/api/quiz/daily'] });
        queryClient.invalidateQueries({ queryKey: ['/api/quiz/stats'] });
        queryClient.invalidateQueries({ queryKey: ['/api/gamification/my-score'] });
      }
    },
  });

  const quiz = quizData?.data;
  const streak = statsData?.data?.currentStreak ?? 0;
  const multiplier = statsData?.data?.streakMultiplier ?? 1;
  const seasonPoints = statsData?.data?.seasonPoints ?? 0;

  const questions: QuizQuestion[] = quiz?.questions ?? [];
  const currentQ = questions[qIndex];
  const sessionId = quiz?.session?.id ?? '';

  function handleOpen() {
    setOpen(true);
    setQIndex(quiz?.answeredCount ?? 0);
    setSelected(null);
    setAnswerResult(null);
    setSessionDone(quiz?.completed ?? false);
  }

  function handleSelect(idx: number) {
    if (selected !== null || !currentQ || !sessionId) return;
    setSelected(idx);
    answerMutation.mutate({ sessionId, questionId: currentQ.id, selectedIndex: idx });
  }

  function handleNext() {
    setSelected(null);
    setAnswerResult(null);
    setQIndex(i => i + 1);
  }

  if (isLoading) return <Skeleton className="h-24 w-full rounded-3xl" />;
  if (quiz?.noQuestions) return null;

  const isCompleted = quiz?.completed || sessionDone;
  const isBossBattle = quiz?.isBossBattle;
  const topicLabel = (quiz?.topic ?? quiz?.session?.topicTag ?? 'Daily Quiz')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c: string) => c.toUpperCase());

  return (
    <>
      <button
        onClick={handleOpen}
        className="w-full rounded-3xl p-4 text-left transition-all active:scale-[0.98]"
        style={{
          background: isCompleted
            ? 'linear-gradient(135deg, hsl(142 60% 50% / 0.08), hsl(142 60% 50% / 0.04))'
            : isBossBattle
              ? 'linear-gradient(135deg, hsl(0 90% 60% / 0.12), hsl(280 90% 60% / 0.08))'
              : 'linear-gradient(135deg, hsl(260 80% 60% / 0.1), hsl(200 80% 60% / 0.06))',
          border: `1px solid ${isCompleted ? 'hsl(142 60% 50% / 0.25)' : isBossBattle ? 'hsl(0 90% 60% / 0.3)' : 'hsl(260 80% 60% / 0.25)'}`,
        }}
      >
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-2xl flex items-center justify-center flex-shrink-0"
            style={{ background: isCompleted ? 'hsl(142 60% 50% / 0.15)' : isBossBattle ? 'hsl(0 90% 60% / 0.15)' : 'hsl(260 80% 60% / 0.15)' }}>
            {isCompleted ? <CheckCircle className="h-5 w-5 text-green-500" /> :
             isBossBattle ? <Zap className="h-5 w-5" style={{ color: 'hsl(0 90% 60%)' }} /> :
             <Brain className="h-5 w-5" style={{ color: 'hsl(260 80% 60%)' }} />}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-base font-extrabold text-foreground">
              {isCompleted ? 'Brain Boost Complete!' : isBossBattle ? 'Boss Battle!' : 'Brain Boost'}
            </p>
            <p className="text-sm text-muted-foreground">
              {isCompleted ? `Score: ${finalData?.score ?? quiz?.session?.score ?? 0}%` :
               isBossBattle ? '10-question challenge — all topics!' :
               `Topic: ${topicLabel}`}
            </p>
          </div>
          <div className="flex flex-col items-end gap-1">
            {streak > 0 && (
              <span className="flex items-center gap-0.5 text-orange-500 font-bold text-sm">
                <Flame className="h-3.5 w-3.5" />{streak}
              </span>
            )}
            {multiplier > 1 && !isCompleted && (
              <span className="text-xs font-bold text-yellow-600 bg-yellow-100 dark:bg-yellow-900/30 px-2 py-0.5 rounded-full">
                {multiplier}× pts
              </span>
            )}
            {!isCompleted && <ChevronRight className="h-4 w-4 text-muted-foreground/50" />}
          </div>
        </div>
      </button>

      {open && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-end justify-center sm:items-center" onClick={() => setOpen(false)}>
          <div className="bg-background w-full max-w-lg rounded-t-3xl sm:rounded-3xl max-h-[85vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="p-5">
              {/* Header */}
              <div className="flex items-center justify-between mb-4">
                <div>
                  <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                    {isBossBattle ? 'Boss Battle' : 'Brain Boost'} · {topicLabel}
                  </p>
                  <p className="text-lg font-extrabold text-foreground">
                    {isCompleted || sessionDone ? 'Session Complete!' :
                     `Question ${qIndex + 1} of ${questions.length}`}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  {streak > 0 && <span className="flex items-center gap-0.5 text-orange-500 font-bold"><Flame className="h-4 w-4" />{streak}-day streak</span>}
                  {multiplier > 1 && <span className="text-xs font-bold text-yellow-600 bg-yellow-100 dark:bg-yellow-900/30 px-2.5 py-1 rounded-full">{multiplier}× pts</span>}
                </div>
              </div>

              {/* Completed state */}
              {(isCompleted || sessionDone) && finalData && (
                <div className="py-4 space-y-4">
                  <div className="text-center space-y-2">
                    <div className="text-5xl">{finalData.score >= 80 ? '🏆' : finalData.score >= 60 ? '🎯' : '📚'}</div>
                    <p className="text-3xl font-extrabold text-foreground">{finalData.score}%</p>
                    <p className="text-muted-foreground">{finalData.correctAnswers} / {finalData.totalQuestions} correct</p>
                  </div>
                  <div className="rounded-2xl p-4" style={{ background: 'hsl(var(--muted))' }}>
                    <p className="text-sm font-bold text-foreground">+{finalData.totalPoints} points earned</p>
                    {finalData.multiplier > 1 && (
                      <p className="text-xs text-muted-foreground mt-0.5">{finalData.multiplier}× streak bonus applied!</p>
                    )}
                  </div>
                  {/* Seasonal leaderboard mini-view */}
                  {leaderboardData?.data?.leaders && leaderboardData.data.leaders.length > 0 && (
                    <div className="rounded-2xl overflow-hidden" style={{ background: 'hsl(var(--muted))' }}>
                      <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground px-4 pt-3 pb-1">
                        Season Standings · {leaderboardData.data.season}
                      </p>
                      <div className="px-4 pb-3 space-y-1.5">
                        {leaderboardData.data.leaders.slice(0, 5).map((leader, i) => (
                          <div key={leader.userId} className="flex items-center gap-3">
                            <span className="w-5 text-xs font-bold text-muted-foreground">{i + 1}</span>
                            <span className="flex-1 text-sm font-medium truncate">{leader.firstName} {leader.lastName}</span>
                            {Number(leader.currentStreakDays) > 0 && (
                              <span className="text-xs text-orange-500">🔥{leader.currentStreakDays}</span>
                            )}
                            <span className="text-xs font-bold text-foreground">{Number(leader.seasonPoints)} pts</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  <button onClick={() => setOpen(false)} className="w-full py-3 rounded-2xl bg-primary text-primary-foreground font-bold">Done</button>
                </div>
              )}

              {/* Already completed, no finalData */}
              {(isCompleted || sessionDone) && !finalData && quiz?.session && (
                <div className="text-center py-6 space-y-4">
                  <div className="text-5xl">✅</div>
                  <p className="text-xl font-extrabold">Already completed today!</p>
                  <p className="text-muted-foreground">Score: {quiz.session.score ?? 0}%</p>
                  <button onClick={() => setOpen(false)} className="w-full py-3 rounded-2xl bg-primary text-primary-foreground font-bold">Close</button>
                </div>
              )}

              {/* Active question */}
              {!isCompleted && !sessionDone && currentQ && (
                <div className="space-y-4">
                  <div className="rounded-2xl p-4" style={{ background: 'hsl(var(--muted))' }}>
                    <p className="text-base font-bold text-foreground leading-snug">{currentQ.questionText}</p>
                    <p className="text-xs font-semibold text-muted-foreground mt-1.5 capitalize">{currentQ.difficulty} · {currentQ.topicTag.replace(/_/g, ' ')}</p>
                  </div>

                  <div className="space-y-2.5">
                    {currentQ.answerChoices.map((choice, i) => {
                      const isSelected = selected === i;
                      const isCorrectAnswer = answerResult && i === answerResult.correctAnswerIndex;
                      const isWrongSelected = answerResult && isSelected && !answerResult.isCorrect;
                      return (
                        <button
                          key={i}
                          onClick={() => handleSelect(i)}
                          disabled={selected !== null}
                          className="w-full text-left px-4 py-3.5 rounded-2xl font-semibold text-sm transition-all"
                          style={{
                            background: isCorrectAnswer ? 'hsl(142 60% 50% / 0.15)' :
                                        isWrongSelected ? 'hsl(0 90% 60% / 0.15)' :
                                        isSelected ? 'hsl(var(--primary) / 0.1)' : 'hsl(var(--muted))',
                            border: `2px solid ${isCorrectAnswer ? 'hsl(142 60% 50%)' :
                                                  isWrongSelected ? 'hsl(0 90% 60%)' :
                                                  isSelected ? 'hsl(var(--primary))' : 'transparent'}`,
                            color: isCorrectAnswer ? 'hsl(142 60% 30%)' : 'inherit',
                          }}
                        >
                          <span className="flex items-center gap-2">
                            {answerResult && isCorrectAnswer && <CheckCircle className="h-4 w-4 text-green-500 flex-shrink-0" />}
                            {answerResult && isWrongSelected && <XCircle className="h-4 w-4 text-red-500 flex-shrink-0" />}
                            {choice}
                          </span>
                        </button>
                      );
                    })}
                  </div>

                  {answerResult && (
                    <div className="rounded-2xl p-4 space-y-2" style={{ background: answerResult.isCorrect ? 'hsl(142 60% 50% / 0.08)' : 'hsl(0 90% 60% / 0.08)' }}>
                      <p className="font-bold" style={{ color: answerResult.isCorrect ? 'hsl(142 60% 35%)' : 'hsl(0 90% 45%)' }}>
                        {answerResult.isCorrect ? '✓ Correct!' : '✗ Not quite'}
                      </p>
                      {answerResult.coachingText && <p className="text-sm text-muted-foreground">{answerResult.coachingText}</p>}
                      {qIndex < questions.length - 1 ? (
                        <button onClick={handleNext} className="mt-2 w-full py-2.5 rounded-xl bg-primary text-primary-foreground font-bold text-sm">
                          Next Question →
                        </button>
                      ) : (
                        <p className="text-sm text-muted-foreground mt-1">Finishing session...</p>
                      )}
                    </div>
                  )}

                  {answerMutation.isPending && (
                    <div className="flex justify-center py-2">
                      <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-primary" />
                    </div>
                  )}
                </div>
              )}

              {/* Progress bar */}
              {!isCompleted && !sessionDone && questions.length > 0 && (
                <div className="mt-4">
                  <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                    <div className="h-full bg-primary rounded-full transition-all" style={{ width: `${((qIndex) / questions.length) * 100}%` }} />
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// ── What Would You Do? Scenario Card ────────────────────────────────────────

interface ScenarioQuestion {
  id: string;
  questionText: string;
  answerChoices: string[];
  coachingText?: string;
  topicTag: string;
}

function ScenarioCard() {
  const [selected, setSelected] = useState<number | null>(null);
  const [serverCoaching, setServerCoaching] = useState<string | null>(null);

  const { data: scenarioData, isLoading } = useQuery<{ success: boolean; data: { scenario: ScenarioQuestion | null } }>({
    queryKey: ['/api/quiz/scenario-card'],
    staleTime: 5 * 60 * 1000,
  });

  const scenario = scenarioData?.data?.scenario;

  const answerScenarioMutation = useMutation<{ success: boolean; data: { coachingText: string | null } }, Error, { questionId: string; selectedIndex: number }>({
    mutationFn: async ({ questionId, selectedIndex }) => {
      const res = await apiRequest('POST', '/api/quiz/scenario-answer', { questionId, selectedIndex });
      return res.json();
    },
    onSuccess: (data) => {
      if (data?.data?.coachingText) setServerCoaching(data.data.coachingText);
    },
  });

  const handleSelect = (i: number) => {
    setSelected(i);
    if (scenario?.id) {
      answerScenarioMutation.mutate({ questionId: scenario.id, selectedIndex: i });
    }
  };

  if (isLoading || !scenario) return null;

  const coaching = serverCoaching ?? scenario.coachingText;

  return (
    <div className="rounded-3xl p-4"
      style={{
        background: 'linear-gradient(135deg, hsl(210 80% 60% / 0.08), hsl(240 80% 60% / 0.05))',
        border: '1px solid hsl(210 80% 60% / 0.2)',
      }}
    >
      <p className="text-xs font-bold uppercase tracking-wider text-blue-600 dark:text-blue-400 mb-1">
        What Would You Do?
      </p>
      <p className="text-sm font-semibold text-foreground mb-3 leading-snug">{scenario.questionText}</p>

      {selected === null ? (
        <div className="space-y-2">
          {scenario.answerChoices.map((choice, i) => (
            <button
              key={i}
              onClick={() => handleSelect(i)}
              className="w-full text-left px-3 py-2.5 rounded-xl text-sm font-medium transition-all"
              style={{ background: 'hsl(var(--muted))', border: '1.5px solid transparent' }}
            >
              {choice}
            </button>
          ))}
        </div>
      ) : (
        <div className="rounded-xl p-3 space-y-2"
          style={{ background: 'hsl(210 80% 60% / 0.08)', border: '1.5px solid hsl(210 80% 60% / 0.2)' }}>
          <p className="text-xs font-semibold text-blue-700 dark:text-blue-300">You chose: "{scenario.answerChoices[selected]}"</p>
          {coaching && (
            <p className="text-xs text-muted-foreground leading-relaxed">{coaching}</p>
          )}
        </div>
      )}
    </div>
  );
}

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

  // Critical: pre-hydrated by DashboardRouter from /api/dashboard/init
  const { data: activeTimeEntry } = useQuery<TimeEntry | null>({
    queryKey: ['/api/time-entries/active'],
    refetchInterval: 30000,
  });
  const isClockedIn = !!activeTimeEntry;

  // Gamification score — pre-hydrated from init, staleTime 5 minutes
  const { data: scoreData } = useQuery<{ overallScore: number; tier: string }>({
    queryKey: ['/api/gamification/my-score'],
    staleTime: 5 * 60 * 1000,
  });

  // Partial-failure flags written by DashboardRouter — cache-only, no network request
  const { data: partialErrors } = useQuery<{ gamificationError: boolean; todaySummaryError: boolean }>({
    queryKey: ['/api/dashboard/partial-errors'],
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

  const { data: tasks = [], isLoading: tasksLoading } = useQuery<Task[]>({
    queryKey: ['/api/tasks'],
    enabled: deferredEnabled,
  });
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const todayEnd = new Date(today); todayEnd.setHours(23, 59, 59, 999);
  // Show ALL tasks assigned to this user that aren't completed (not just ones with today's due date)
  const myTasksToday = tasks.filter(t =>
    t.assignedTo === user?.id && t.status !== 'completed'
  );

  const DOW_NAMES = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  const todayDOW = DOW_NAMES[new Date().getDay()];
  const teamChoresToday = tasks.filter(t =>
    (t as any).isRecurring && (t as any).dayOfWeek === todayDOW && t.status !== 'completed'
  );

  const toggleTaskMutation = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) =>
      apiRequest('PATCH', `/api/tasks/${id}`, { status }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['/api/tasks'] }),
  });

  const { data: sopExecutionsRaw = [] } = useQuery<any>({ queryKey: ['/api/sops/executions'], enabled: deferredEnabled });
  const sopExecutions = Array.isArray(sopExecutionsRaw) ? sopExecutionsRaw : (sopExecutionsRaw?.data || []);
  const inProgressExecutions = sopExecutions.filter((e: any) => e.status === 'in_progress' && e.employeeId === user?.id);

  const { data: unreadData } = useQuery<{ success: boolean; data: { count: number } }>({
    queryKey: ['/api/messages/unread-count'],
    refetchInterval: 30000,
  });
  const unreadCount = unreadData?.data?.count || 0;

  const { data: companySettings } = useQuery<{ showPaySummaryToEmployees?: boolean }>({
    queryKey: ['/api/company-settings'],
    staleTime: 5 * 60 * 1000,
  });
  const showPaySummary = companySettings?.showPaySummaryToEmployees ?? false;

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
            <div className="relative">
              <StatChip
                icon={<Trophy className="h-4 w-4" style={{ color: '#F9C846' }} />}
                label="Score"
                value={scoreData ? `${scoreData.overallScore}` : '—'}
                sub={scoreData?.tier ?? 'pts'}
                iconBg="bg-yellow-100 dark:bg-yellow-900/30"
                onClick={() => navigate('/my-score')}
              />
              {partialErrors?.gamificationError && (
                <span
                  className="absolute top-1.5 right-1.5 text-amber-500"
                  title="Score data couldn't load — may be stale"
                >
                  <AlertTriangle size={11} />
                </span>
              )}
            </div>
            <StatChip
              icon={<MessageCircle className="h-4 w-4" style={{ color: '#4ECDC4' }} />}
              label="Messages"
              value={unreadCount > 0 ? `${unreadCount}` : '—'}
              sub={unreadCount > 0 ? 'unread' : 'Clear'}
              iconBg="bg-teal-100 dark:bg-teal-900/30"
              onClick={() => navigate('/messages')}
            />
          </div>

          {/* Today's Team Chores */}
          {teamChoresToday.length > 0 && (
            <DashboardErrorBoundary fallback="">
              <div>
                <div className="flex items-center justify-between mb-3">
                  <h2 className="text-lg font-extrabold text-foreground">Today's Chores</h2>
                  <button onClick={() => navigate('/tasks')} className="text-sm font-bold text-primary">
                    View all
                  </button>
                </div>
                <div className="rounded-3xl overflow-hidden bg-card border border-border">
                  {teamChoresToday.slice(0, 5).map((task, i) => (
                    <div
                      key={task.id}
                      className="flex items-center gap-3.5 px-4 py-3 min-h-[52px]"
                      style={{ borderBottom: i < Math.min(teamChoresToday.length, 5) - 1 ? '1px solid hsl(var(--border))' : 'none' }}
                    >
                      <div className="w-2 h-2 rounded-full bg-primary/60 flex-shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-[14px] font-semibold text-foreground leading-snug truncate">{task.title}</p>
                        {(task as any).timeOfDay && (
                          <p className="text-xs text-muted-foreground capitalize">{(task as any).timeOfDay}</p>
                        )}
                      </div>
                      {(task as any).assignedTo ? (
                        <span className="text-xs text-muted-foreground font-medium shrink-0">Assigned</span>
                      ) : (
                        <span className="text-xs text-orange-500 font-semibold shrink-0">Open</span>
                      )}
                    </div>
                  ))}
                </div>
                {teamChoresToday.length > 5 && (
                  <button onClick={() => navigate('/tasks')} className="w-full text-center text-sm font-bold text-primary mt-3 py-1">
                    +{teamChoresToday.length - 5} more chores today
                  </button>
                )}
              </div>
            </DashboardErrorBoundary>
          )}

          {/* Task preview */}
          {myTasksToday.length > 0 && (
            <DashboardErrorBoundary fallback="">
              <div>
                <div className="flex items-center justify-between mb-3">
                  {/* 18px subheading — readable on mobile */}
                  <h2 className="text-lg font-extrabold text-foreground">Your Tasks</h2>
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

          <DashboardErrorBoundary fallback=""><DailyQuestionnaireCard /></DashboardErrorBoundary>
          <DashboardErrorBoundary fallback=""><BrainBoostCard /></DashboardErrorBoundary>
          <DashboardErrorBoundary fallback=""><ScenarioCard /></DashboardErrorBoundary>
          <DashboardErrorBoundary fallback=""><ScoreWidget /></DashboardErrorBoundary>
          <DashboardErrorBoundary fallback=""><DailyQuoteCard /></DashboardErrorBoundary>
          <DashboardErrorBoundary fallback=""><TeamStatusWidget /></DashboardErrorBoundary>
          <DashboardErrorBoundary fallback=""><SurfacedSOPBanner /></DashboardErrorBoundary>
          <QuickActions navigate={navigate} />
          <DashboardErrorBoundary fallback=""><TrainingProgressCard /></DashboardErrorBoundary>
          <DashboardErrorBoundary fallback=""><LeanBoardCard /></DashboardErrorBoundary>
          <DashboardErrorBoundary fallback=""><ImprovementFeedWidget /></DashboardErrorBoundary>
          {showPaySummary && (
            <DashboardErrorBoundary fallback=""><PaySummaryWidget /></DashboardErrorBoundary>
          )}

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
                    <h2 className="text-xl font-extrabold text-foreground">Your Tasks</h2>
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
                    <p className="text-sm text-muted-foreground mt-1">No tasks assigned to you yet.</p>
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

          {/* Today's Team Chores (post-clock-in) */}
          {teamChoresToday.length > 0 && (
            <DashboardErrorBoundary fallback="">
              <div>
                <div className="flex items-center justify-between mb-3">
                  <h2 className="text-lg font-extrabold text-foreground">Today's Chores</h2>
                  <button onClick={() => navigate('/tasks')} className="text-sm font-bold text-primary">View all</button>
                </div>
                <div className="rounded-3xl overflow-hidden bg-card border border-border">
                  {teamChoresToday.slice(0, 5).map((task, i) => (
                    <div
                      key={task.id}
                      className="flex items-center gap-3.5 px-4 py-3 min-h-[52px]"
                      style={{ borderBottom: i < Math.min(teamChoresToday.length, 5) - 1 ? '1px solid hsl(var(--border))' : 'none' }}
                    >
                      <div className="w-2 h-2 rounded-full bg-primary/60 flex-shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-[14px] font-semibold text-foreground leading-snug truncate">{task.title}</p>
                        {(task as any).timeOfDay && (
                          <p className="text-xs text-muted-foreground capitalize">{(task as any).timeOfDay}</p>
                        )}
                      </div>
                      {(task as any).assignedTo ? (
                        <span className="text-xs text-muted-foreground font-medium shrink-0">Assigned</span>
                      ) : (
                        <span className="text-xs text-orange-500 font-semibold shrink-0">Open</span>
                      )}
                    </div>
                  ))}
                </div>
                {teamChoresToday.length > 5 && (
                  <button onClick={() => navigate('/tasks')} className="w-full text-center text-sm font-bold text-primary mt-3 py-1">
                    +{teamChoresToday.length - 5} more chores today
                  </button>
                )}
              </div>
            </DashboardErrorBoundary>
          )}

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

          <DashboardErrorBoundary fallback=""><DailyQuestionnaireCard /></DashboardErrorBoundary>
          <DashboardErrorBoundary fallback=""><BrainBoostCard /></DashboardErrorBoundary>
          <DashboardErrorBoundary fallback=""><ScenarioCard /></DashboardErrorBoundary>
          <DashboardErrorBoundary fallback=""><SurfacedSOPBanner /></DashboardErrorBoundary>
          <DashboardErrorBoundary fallback=""><DailyQuoteCard /></DashboardErrorBoundary>
          <DashboardErrorBoundary fallback=""><TeamStatusWidget /></DashboardErrorBoundary>
          <QuickActions navigate={navigate} />
          <DashboardErrorBoundary fallback=""><TrainingProgressCard /></DashboardErrorBoundary>
          <DashboardErrorBoundary fallback=""><ScoreWidget /></DashboardErrorBoundary>
          <DashboardErrorBoundary fallback=""><LeanBoardCard /></DashboardErrorBoundary>
          <DashboardErrorBoundary fallback=""><ImprovementFeedWidget /></DashboardErrorBoundary>
          {showPaySummary && (
            <DashboardErrorBoundary fallback=""><PaySummaryWidget /></DashboardErrorBoundary>
          )}

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
