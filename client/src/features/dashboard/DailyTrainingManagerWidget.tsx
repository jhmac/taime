import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiRequest } from '@/lib/queryClient';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { BookOpen, RefreshCw, CheckCircle, Clock, AlertTriangle } from 'lucide-react';
import ErrorWithRetry from '@/components/ErrorWithRetry';
import { useOnlineRetry } from '@/hooks/useOnlineRetry';

interface SummaryData {
  questionnaire: {
    id: string;
    topic: string;
    xpReward: number;
    questionCount: number;
  } | null;
  completionCount: number;
  totalTeamCount: number;
  completionRate: number;
  avgScore: number;
  completedUsers: Array<{ id: string; firstName: string | null; lastName: string | null }>;
  notCompletedUsers: Array<{ id: string; firstName: string | null; lastName: string | null }>;
}

export default function DailyTrainingManagerWidget() {
  const queryClient = useQueryClient();
  const [expanded, setExpanded] = useState(false);

  const { data, isLoading, isError, refetch } = useQuery<{ success: boolean; data: SummaryData }>({
    queryKey: ['/api/daily-questionnaire/summary'],
    staleTime: 60_000,
  });

  const [generateError, setGenerateError] = useState<string | null>(null);

  const generateMutation = useMutation({
    mutationFn: async (force: boolean) => {
      setGenerateError(null);
      const res = await apiRequest('POST', '/api/daily-questionnaire/generate', { force });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error?.message ?? `Server error: ${res.status}`);
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/daily-questionnaire/summary'] });
    },
    onError: (err: Error) => {
      setGenerateError(err.message);
    },
  });

  useOnlineRetry(refetch, isError);

  if (isLoading) return <Skeleton className="h-36 w-full rounded-2xl" />;

  if (isError) {
    return (
      <Card>
        <CardContent className="p-4">
          <ErrorWithRetry onRetry={() => refetch()} message="Could not load training data" />
        </CardContent>
      </Card>
    );
  }

  const summary = data?.data;

  if (!summary?.questionnaire) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <BookOpen className="h-4 w-4 text-orange-500" />
            Today's Training
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-0 space-y-3">
          <p className="text-sm text-muted-foreground text-center py-2">
            No questionnaire generated for today yet.
          </p>
          <Button
            size="sm"
            className="w-full"
            onClick={() => generateMutation.mutate(false)}
            disabled={generateMutation.isPending}
          >
            {generateMutation.isPending ? (
              <>
                <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                Generating...
              </>
            ) : (
              <>
                <RefreshCw className="h-4 w-4 mr-2" />
                Generate Today's Questions
              </>
            )}
          </Button>
        </CardContent>
      </Card>
    );
  }

  const { questionnaire, completionCount, totalTeamCount, completionRate, avgScore, completedUsers, notCompletedUsers } = summary;

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm flex items-center gap-2">
            <BookOpen className="h-4 w-4 text-orange-500" />
            Today's Training
          </CardTitle>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-xs"
            onClick={() => generateMutation.mutate(true)}
            disabled={generateMutation.isPending}
          >
            {generateMutation.isPending ? (
              <RefreshCw className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <RefreshCw className="h-3.5 w-3.5" />
            )}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="pt-0 space-y-3">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-muted-foreground truncate flex-1">Topic: {questionnaire.topic}</span>
          <span className="text-xs text-muted-foreground">{questionnaire.questionCount} questions · {questionnaire.xpReward} XP</span>
        </div>

        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">{completionCount} of {totalTeamCount} completed</span>
            <span className="font-bold">{completionRate}%</span>
          </div>
          <Progress value={completionRate} className="h-2" />
        </div>

        {avgScore > 0 && (
          <div className="flex items-center gap-2 text-sm">
            <span className="text-muted-foreground">Avg score:</span>
            <span className={`font-bold ${avgScore >= 80 ? 'text-green-600 dark:text-green-400' : avgScore >= 60 ? 'text-yellow-600 dark:text-yellow-400' : 'text-red-600 dark:text-red-400'}`}>
              {avgScore}%
            </span>
          </div>
        )}

        {generateError && (
          <div className="flex items-start gap-1.5 text-xs text-destructive bg-destructive/10 rounded-lg px-3 py-2">
            <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
            <span>{generateError}</span>
          </div>
        )}

        <button
          onClick={() => setExpanded(v => !v)}
          className="w-full text-xs font-semibold text-primary hover:underline text-left"
        >
          {expanded ? 'Hide details ↑' : "Show who's done ↓"}
        </button>

        {expanded && (
          <div className="space-y-2 border-t pt-2">
            {completedUsers.length > 0 && (
              <div>
                <p className="text-xs font-bold text-muted-foreground mb-1 flex items-center gap-1">
                  <CheckCircle className="h-3 w-3 text-green-500" /> Completed ({completedUsers.length})
                </p>
                <div className="space-y-1">
                  {completedUsers.map(u => (
                    <div key={u.id} className="flex items-center gap-2 text-xs text-foreground px-2 py-1 bg-green-50 dark:bg-green-950/10 rounded-lg">
                      <span>{u.firstName} {u.lastName}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {notCompletedUsers.length > 0 && (
              <div>
                <p className="text-xs font-bold text-muted-foreground mb-1 flex items-center gap-1">
                  <Clock className="h-3 w-3 text-yellow-500" /> Not Yet ({notCompletedUsers.length})
                </p>
                <div className="space-y-1">
                  {notCompletedUsers.map(u => (
                    <div key={u.id} className="flex items-center gap-2 text-xs text-muted-foreground px-2 py-1 bg-muted/50 rounded-lg">
                      <span>{u.firstName} {u.lastName}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
