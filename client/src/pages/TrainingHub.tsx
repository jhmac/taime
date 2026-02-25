import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { useLocation } from 'wouter';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/hooks/useAuth';
import { apiRequest } from '@/lib/queryClient';
import {
  ArrowLeft, GraduationCap, BookOpen, CheckCircle2, Play, Star,
  Clock, Film, ChevronRight
} from 'lucide-react';

interface TrainingTemplate {
  id: string;
  storeId: string;
  title: string;
  description: string | null;
  category: string;
  estimatedDurationMinutes: number | null;
  walkthroughVideoUrl: string | null;
  isTrainingPriority: boolean;
  stepCount: number;
  completionCount: number;
  mastery: 'beginner' | 'practicing' | 'mastered';
}

const MASTERY_CONFIG = {
  beginner: {
    label: 'Start Learning',
    color: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
    icon: Play,
  },
  practicing: {
    label: 'Practice Again',
    color: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
    icon: BookOpen,
  },
  mastered: {
    label: 'Mastered',
    color: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300',
    icon: CheckCircle2,
  },
};

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

export default function TrainingHub() {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const { user } = useAuth();

  const { data, isLoading } = useQuery<{ success: boolean; data: TrainingTemplate[] }>({
    queryKey: ['/api/sops/templates/training-priority'],
  });

  const startMutation = useMutation({
    mutationFn: async (templateId: string) => {
      const res = await apiRequest('POST', '/api/sops/executions', { templateId });
      return res.json();
    },
    onSuccess: (result) => {
      if (result?.data?.id) {
        navigate(`/sops/execute/${result.data.id}`);
      }
    },
    onError: () => {
      toast({ title: 'Error', description: 'Failed to start SOP', variant: 'destructive' });
    },
  });

  const templates = data?.data ?? [];
  const masteredCount = templates.filter(t => t.mastery === 'mastered').length;
  const totalCount = templates.length;
  const progressPercent = totalCount > 0 ? (masteredCount / totalCount) * 100 : 0;

  if (isLoading) {
    return (
      <div className="p-4 space-y-4 max-w-2xl mx-auto">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-32 w-full rounded-xl" />
        <Skeleton className="h-32 w-full rounded-xl" />
        <Skeleton className="h-32 w-full rounded-xl" />
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col bg-background">
      <div className="px-4 pt-4 pb-3 border-b">
        <div className="flex items-center gap-3 mb-3">
          <Button variant="ghost" size="icon" onClick={() => navigate('/sops')} className="shrink-0">
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div className="flex-1">
            <h1 className="text-lg font-bold flex items-center gap-2">
              <GraduationCap className="h-5 w-5 text-primary" />
              Training Hub
            </h1>
            <p className="text-xs text-muted-foreground">
              {user?.firstName ? `${user.firstName}, here's` : `Here's`} everything you need to learn
            </p>
          </div>
        </div>

        {totalCount > 0 && (
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Your Progress</span>
              <span className="font-semibold">
                {masteredCount} of {totalCount} mastered
              </span>
            </div>
            <Progress value={progressPercent} className="h-2.5" />
          </div>
        )}
      </div>

      <div className="flex-1 overflow-auto px-4 py-4 space-y-3 max-w-2xl mx-auto w-full">
        {templates.length === 0 ? (
          <div className="text-center py-16 space-y-3">
            <Star className="h-12 w-12 text-muted-foreground/30 mx-auto" />
            <p className="text-lg font-medium text-muted-foreground">No Training Procedures Yet</p>
            <p className="text-sm text-muted-foreground/60">
              When your manager flags SOPs as training priorities, they'll appear here.
            </p>
          </div>
        ) : (
          <>
            {templates.filter(t => t.mastery === 'beginner').length > 0 && (
              <div className="space-y-2">
                <h2 className="text-sm font-semibold text-blue-600 dark:text-blue-400 uppercase tracking-wide">
                  New — Start Here
                </h2>
                {templates.filter(t => t.mastery === 'beginner').map(t => (
                  <TrainingCard key={t.id} template={t} onStart={() => startMutation.mutate(t.id)} isPending={startMutation.isPending} />
                ))}
              </div>
            )}

            {templates.filter(t => t.mastery === 'practicing').length > 0 && (
              <div className="space-y-2">
                <h2 className="text-sm font-semibold text-amber-600 dark:text-amber-400 uppercase tracking-wide">
                  Keep Practicing
                </h2>
                {templates.filter(t => t.mastery === 'practicing').map(t => (
                  <TrainingCard key={t.id} template={t} onStart={() => startMutation.mutate(t.id)} isPending={startMutation.isPending} />
                ))}
              </div>
            )}

            {templates.filter(t => t.mastery === 'mastered').length > 0 && (
              <div className="space-y-2">
                <h2 className="text-sm font-semibold text-green-600 dark:text-green-400 uppercase tracking-wide">
                  Mastered
                </h2>
                {templates.filter(t => t.mastery === 'mastered').map(t => (
                  <TrainingCard key={t.id} template={t} onStart={() => startMutation.mutate(t.id)} isPending={startMutation.isPending} />
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function TrainingCard({ template, onStart, isPending }: { template: TrainingTemplate; onStart: () => void; isPending: boolean }) {
  const config = MASTERY_CONFIG[template.mastery];
  const MasteryIcon = config.icon;

  return (
    <Card className="overflow-hidden hover:shadow-md transition-shadow">
      <CardContent className="p-4">
        <div className="flex items-start gap-3">
          <div className={`p-2 rounded-lg shrink-0 ${config.color}`}>
            <MasteryIcon className="h-5 w-5" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap mb-1">
              <h3 className="font-semibold text-sm truncate">{template.title}</h3>
              {template.walkthroughVideoUrl && (
                <Film className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
              )}
            </div>
            {template.description && (
              <p className="text-xs text-muted-foreground line-clamp-2 mb-2">{template.description}</p>
            )}
            <div className="flex items-center gap-3 text-xs text-muted-foreground">
              <Badge variant="outline" className="text-[10px] h-5">
                {CATEGORY_LABELS[template.category] ?? template.category}
              </Badge>
              {template.estimatedDurationMinutes && (
                <span className="flex items-center gap-0.5">
                  <Clock className="h-3 w-3" />
                  {template.estimatedDurationMinutes}m
                </span>
              )}
              <span>{template.stepCount} steps</span>
              {template.completionCount > 0 && (
                <span className="text-green-600 dark:text-green-400">
                  {template.completionCount}x completed
                </span>
              )}
            </div>
          </div>
          <Button
            size="sm"
            variant={template.mastery === 'mastered' ? 'outline' : 'default'}
            className="shrink-0 gap-1 min-h-[36px]"
            onClick={onStart}
            disabled={isPending}
          >
            {config.label}
            <ChevronRight className="h-3.5 w-3.5" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
