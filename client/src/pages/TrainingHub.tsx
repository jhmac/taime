import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { useLocation } from 'wouter';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/hooks/useAuth';
import { apiRequest } from '@/lib/queryClient';
import {
  ArrowLeft, GraduationCap, BookOpen, CheckCircle2, Play, Star,
  Clock, Film, ChevronRight, Flame, Dumbbell, Target, Loader2,
} from 'lucide-react';

interface TrainingModule {
  id: string;
  storeId?: string;
  title: string;
  description: string | null;
  category: string;
  estimatedDurationMinutes: number | null;
  walkthroughVideoUrl?: string | null;
  isTrainingPriority?: boolean;
  stepCount?: number;
  completionCount?: number;
  mastery?: 'beginner' | 'practicing' | 'mastered';
  status: 'not_started' | 'in_progress' | 'completed' | 'exempted';
  completedAt?: string | null;
  score?: number | null;
}

interface DashboardData {
  modules: TrainingModule[];
  practiceQueue: any[];
  streak: number;
  practiceCount: number;
}

interface PracticeQuestion {
  question: {
    id: string;
    questionText: string;
    answerChoices: string[];
    correctAnswerIndex: number;
    coachingText?: string;
  };
}

const CATEGORY_LABELS: Record<string, string> = {
  opening: 'Opening',
  closing: 'Closing',
  customer_service: 'Customer Service',
  visual_merchandising: 'Visual Merchandising',
  inventory: 'Inventory',
  safety: 'Safety',
  shift_handoff: 'Shift Handoff',
  custom: 'Custom',
};

function StreakBadge({ streak }: { streak: number }) {
  if (streak === 0) return null;
  return (
    <div className="flex items-center gap-1.5 bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-300 rounded-full px-3 py-1">
      <Flame className="h-4 w-4" />
      <span className="text-sm font-bold">{streak} day streak</span>
    </div>
  );
}

function PracticeCard({ queue, onStart }: { queue: PracticeQuestion[]; onStart: () => void }) {
  if (queue.length === 0) return null;
  return (
    <Card className="border-2 border-amber-200 dark:border-amber-800 bg-amber-50/50 dark:bg-amber-900/10">
      <CardContent className="p-4 flex items-center gap-4">
        <div className="w-12 h-12 rounded-xl bg-amber-100 dark:bg-amber-900/40 flex items-center justify-center shrink-0">
          <Dumbbell className="h-6 w-6 text-amber-600 dark:text-amber-400" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-sm">Practice Today</p>
          <p className="text-xs text-muted-foreground">{queue.length} question{queue.length > 1 ? 's' : ''} due for review</p>
        </div>
        <Button size="sm" onClick={onStart} className="shrink-0">
          Start <ChevronRight className="h-3.5 w-3.5 ml-1" />
        </Button>
      </CardContent>
    </Card>
  );
}

function ModuleCard({ module, onStart }: { module: TrainingModule; onStart: () => void }) {
  const isComplete = module.status === 'completed';
  const isExempt = module.status === 'exempted';

  return (
    <Card className="overflow-hidden hover:shadow-md transition-shadow">
      <CardContent className="p-4">
        <div className="flex items-start gap-3">
          <div className={`p-2.5 rounded-xl shrink-0 ${
            isComplete ? 'bg-green-100 dark:bg-green-900/40' :
            isExempt ? 'bg-gray-100 dark:bg-gray-800' :
            'bg-primary/10'
          }`}>
            {isComplete ? (
              <CheckCircle2 className="h-5 w-5 text-green-600 dark:text-green-400" />
            ) : (
              <Play className="h-5 w-5 text-primary" />
            )}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap mb-1">
              <h3 className="font-semibold text-sm">{module.title}</h3>
              {module.isTrainingPriority && (
                <Star className="h-3.5 w-3.5 text-amber-500 fill-amber-500 shrink-0" />
              )}
            </div>
            {module.description && (
              <p className="text-xs text-muted-foreground line-clamp-2 mb-2">{module.description}</p>
            )}
            <div className="flex items-center gap-2 text-xs text-muted-foreground flex-wrap">
              {module.category && (
                <Badge variant="outline" className="text-[10px] h-5">
                  {CATEGORY_LABELS[module.category] ?? module.category}
                </Badge>
              )}
              {module.estimatedDurationMinutes && (
                <span className="flex items-center gap-0.5">
                  <Clock className="h-3 w-3" />
                  {module.estimatedDurationMinutes}m
                </span>
              )}
              {isComplete && module.score !== null && module.score !== undefined && (
                <span className="text-green-600 dark:text-green-400 font-medium">Score: {module.score}%</span>
              )}
            </div>
          </div>
          <Button
            size="sm"
            variant={isComplete ? 'outline' : 'default'}
            className="shrink-0 gap-1 min-h-[36px]"
            onClick={onStart}
            disabled={isExempt}
          >
            {isComplete ? 'Review' : isExempt ? 'Exempt' : 'Start'}
            {!isExempt && <ChevronRight className="h-3.5 w-3.5" />}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function PracticeSession({ questions, onComplete }: { questions: PracticeQuestion[]; onComplete: () => void }) {
  const { toast } = useToast();
  const [currentIdx, setCurrentIdx] = useState(0);
  const [selected, setSelected] = useState<number | null>(null);
  const [showResult, setShowResult] = useState(false);
  const [correctCount, setCorrectCount] = useState(0);

  const answerMutation = useMutation({
    mutationFn: async ({ questionId, selectedIndex }: { questionId: string; selectedIndex: number }) => {
      const res = await apiRequest('POST', `/api/training/practice/${questionId}/answer`, { selectedIndex });
      return res.json();
    },
    onSuccess: (data) => {
      const result = data.data;
      const isCorrect = result.isCorrect;
      if (isCorrect) setCorrectCount(c => c + 1);
      setShowResult(true);
    },
    onError: () => {
      toast({ title: 'Error submitting answer', variant: 'destructive' });
    },
  });

  const currentQ = questions[currentIdx]?.question;

  if (!currentQ || currentIdx >= questions.length) {
    return (
      <div className="fixed inset-0 bg-background flex flex-col items-center justify-center px-6 text-center space-y-4">
        <CheckCircle2 className="h-16 w-16 text-green-500" />
        <h2 className="text-xl font-bold">Practice Complete!</h2>
        <p className="text-muted-foreground">{correctCount} of {questions.length} correct</p>
        <Button onClick={onComplete}>Done</Button>
      </div>
    );
  }

  const isCorrect = selected !== null && selected === currentQ.correctAnswerIndex;

  const handleAnswer = (idx: number) => {
    if (selected !== null) return;
    setSelected(idx);
    answerMutation.mutate({ questionId: currentQ.id, selectedIndex: idx });
  };

  const handleNext = () => {
    setSelected(null);
    setShowResult(false);
    setCurrentIdx(i => i + 1);
  };

  return (
    <div className="fixed inset-0 bg-background flex flex-col">
      <div className="px-4 pt-4 pb-2 border-b flex items-center gap-3">
        <div className="flex-1">
          <p className="text-xs text-muted-foreground">Daily Practice</p>
          <Progress value={((currentIdx) / questions.length) * 100} className="h-1.5 mt-1" />
        </div>
        <span className="text-xs text-muted-foreground">{currentIdx + 1}/{questions.length}</span>
      </div>

      <div className="flex-1 flex flex-col px-6 py-6 space-y-4">
        <p className="text-base font-semibold text-center">{currentQ.questionText}</p>
        <div className="space-y-3">
          {currentQ.answerChoices.map((choice, idx) => {
            let extraClass = "";
            if (showResult) {
              if (idx === currentQ.correctAnswerIndex) extraClass = "border-green-500 bg-green-50 dark:bg-green-950/30";
              else if (idx === selected) extraClass = "border-red-500 bg-red-50 dark:bg-red-950/30";
            } else if (idx === selected) {
              extraClass = "border-primary";
            }
            return (
              <button
                key={idx}
                className={`w-full text-left rounded-xl border-2 px-4 py-3 text-sm font-medium transition-all ${
                  extraClass || "border-border hover:border-primary/50 hover:bg-accent"
                }`}
                onClick={() => handleAnswer(idx)}
                disabled={selected !== null}
              >
                {choice}
              </button>
            );
          })}
        </div>

        {showResult && !isCorrect && currentQ.coachingText && (
          <div className="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 rounded-xl p-3">
            <p className="text-xs text-amber-800 dark:text-amber-200">{currentQ.coachingText}</p>
          </div>
        )}

        {showResult && (
          <Button onClick={handleNext} className="w-full">
            {currentIdx < questions.length - 1 ? 'Next Question' : 'Finish'}
            <ChevronRight className="h-4 w-4 ml-1" />
          </Button>
        )}
      </div>
    </div>
  );
}

export default function TrainingHub() {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const { user } = useAuth();
  const [practiceMode, setPracticeMode] = useState(false);

  const { data, isLoading } = useQuery<{ success: boolean; data: DashboardData }>({
    queryKey: ['/api/training/dashboard'],
  });

  const dashboard = data?.data;
  const modules = dashboard?.modules ?? [];
  const practiceQueue = dashboard?.practiceQueue ?? [];
  const streak = dashboard?.streak ?? 0;

  const completedCount = modules.filter(m => m.status === 'completed').length;
  const totalCount = modules.length;
  const progressPercent = totalCount > 0 ? (completedCount / totalCount) * 100 : 0;

  if (isLoading) {
    return (
      <div className="p-4 space-y-4 max-w-2xl mx-auto">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-24 w-full rounded-xl" />
        <Skeleton className="h-24 w-full rounded-xl" />
      </div>
    );
  }

  if (practiceMode && practiceQueue.length > 0) {
    return <PracticeSession questions={practiceQueue} onComplete={() => setPracticeMode(false)} />;
  }

  return (
    <div className="h-full flex flex-col bg-background">
      <div className="px-4 pt-4 pb-3 border-b">
        <div className="flex items-center gap-3 mb-3">
          <Button variant="ghost" size="icon" onClick={() => navigate('/')} className="shrink-0">
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div className="flex-1">
            <h1 className="text-lg font-bold flex items-center gap-2">
              <GraduationCap className="h-5 w-5 text-primary" />
              Training Hub
            </h1>
            <p className="text-xs text-muted-foreground">
              {user?.firstName ? `${user.firstName}, here's` : "Here's"} your learning dashboard
            </p>
          </div>
          <StreakBadge streak={streak} />
        </div>

        {totalCount > 0 && (
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Role Progress</span>
              <span className="font-semibold">{completedCount} of {totalCount} complete</span>
            </div>
            <Progress value={progressPercent} className="h-2.5" />
          </div>
        )}
      </div>

      <div className="flex-1 overflow-auto px-4 py-4 space-y-3 max-w-2xl mx-auto w-full">
        <PracticeCard queue={practiceQueue} onStart={() => setPracticeMode(true)} />

        {modules.length === 0 ? (
          <div className="text-center py-16 space-y-3">
            <Star className="h-12 w-12 text-muted-foreground/30 mx-auto" />
            <p className="text-lg font-medium text-muted-foreground">No Training Modules Yet</p>
            <p className="text-sm text-muted-foreground/60">
              When your manager creates training modules, they'll appear here.
            </p>
          </div>
        ) : (
          <>
            {modules.filter(m => m.status !== 'completed' && m.status !== 'exempted').length > 0 && (
              <div className="space-y-2">
                <h2 className="text-sm font-semibold text-primary uppercase tracking-wide">
                  In Progress & Not Started
                </h2>
                {modules.filter(m => m.status !== 'completed' && m.status !== 'exempted').map(m => (
                  <ModuleCard key={m.id} module={m} onStart={() => navigate(`/training/${m.id}`)} />
                ))}
              </div>
            )}

            {modules.filter(m => m.status === 'completed').length > 0 && (
              <div className="space-y-2">
                <h2 className="text-sm font-semibold text-green-600 dark:text-green-400 uppercase tracking-wide">
                  Completed
                </h2>
                {modules.filter(m => m.status === 'completed').map(m => (
                  <ModuleCard key={m.id} module={m} onStart={() => navigate(`/training/${m.id}`)} />
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
