import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useLocation, useRoute } from 'wouter';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Separator } from '@/components/ui/separator';
import { useToast } from '@/hooks/use-toast';
import { apiRequest } from '@/lib/queryClient';
import { useAuth } from '@/hooks/useAuth';
import {
  ArrowLeft, Edit, Play, Clock, CheckCircle2, Eye, Camera, GitBranch,
  Timer, AlertTriangle, BarChart3, Calendar, Hash, BookOpen, Loader2, History
} from 'lucide-react';

const CATEGORY_COLORS: Record<string, string> = {
  opening: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300',
  closing: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-900/30 dark:text-indigo-300',
  customer_service: 'bg-rose-100 text-rose-800 dark:bg-rose-900/30 dark:text-rose-300',
  visual_merchandising: 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300',
  inventory: 'bg-cyan-100 text-cyan-800 dark:bg-cyan-900/30 dark:text-cyan-300',
  safety: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300',
  shift_handoff: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300',
  custom: 'bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-300',
};

const STEP_TYPE_ICONS: Record<string, typeof CheckCircle2> = {
  action: CheckCircle2,
  verification: Eye,
  photo: Camera,
  decision: GitBranch,
  timer: Timer,
};

function formatDuration(seconds: number | null): string {
  if (!seconds) return '—';
  if (seconds < 60) return `${seconds}s`;
  const mins = Math.round(seconds / 60);
  return `${mins} min`;
}

export default function SOPDetail() {
  const [, navigate] = useLocation();
  const [, params] = useRoute('/sops/:id');
  const id = params?.id;
  const { toast } = useToast();
  const qc = useQueryClient();
  const { user } = useAuth();

  const isAdmin = user?.role?.name === 'admin' || user?.role?.name === 'owner';

  const { data, isLoading, error } = useQuery<{ success: boolean; data: any }>({
    queryKey: ['/api/sops/templates', id],
    queryFn: async () => {
      const res = await fetch(`/api/sops/templates/${id}`, { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to load template');
      return res.json();
    },
    enabled: !!id,
  });

  const startExecutionMutation = useMutation({
    mutationFn: async () => {
      return apiRequest('POST', '/api/sops/executions', { templateId: id });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['/api/sops/templates', id] });
      toast({ title: 'Execution Started', description: 'Good luck — you\'ve got this!' });
    },
    onError: (err: Error) => {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    },
  });

  if (isLoading) {
    return (
      <div className="p-4 space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-48 w-full rounded-xl" />
        <Skeleton className="h-32 w-full rounded-xl" />
      </div>
    );
  }

  if (error || !data?.data) {
    return (
      <div className="p-4">
        <Button variant="ghost" onClick={() => navigate('/sops')} className="gap-2 mb-4">
          <ArrowLeft className="h-4 w-4" /> Back
        </Button>
        <p className="text-muted-foreground">Template not found.</p>
      </div>
    );
  }

  const template = data.data;
  const steps = template.steps || [];
  const stats = template.stats || {};

  return (
    <div className="h-full flex flex-col bg-background">
      <div className="px-4 pt-4 pb-3 border-b">
        <div className="flex items-start gap-3">
          <Button variant="ghost" size="icon" onClick={() => navigate('/sops')} className="shrink-0 mt-0.5">
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div className="flex-1 min-w-0">
            <h1 className="text-xl font-bold leading-tight">{template.title}</h1>
            <div className="flex items-center gap-2 mt-1.5 flex-wrap">
              <Badge className={`text-[10px] ${CATEGORY_COLORS[template.category] || CATEGORY_COLORS.custom}`} variant="secondary">
                {template.category.replace('_', ' ')}
              </Badge>
              <span className="text-xs text-muted-foreground flex items-center gap-1">
                <Hash className="h-3 w-3" /> v{template.version}
              </span>
              {template.estimatedDurationMinutes && (
                <span className="text-xs text-muted-foreground flex items-center gap-1">
                  <Clock className="h-3 w-3" /> {template.estimatedDurationMinutes} min
                </span>
              )}
            </div>
          </div>
          <div className="flex gap-2 shrink-0">
            {isAdmin && (
              <Button variant="outline" size="sm" className="gap-1.5" onClick={() => navigate(`/sops/${id}/edit`)}>
                <Edit className="h-3.5 w-3.5" /> Edit
              </Button>
            )}
            <Button size="sm" className="gap-1.5" onClick={() => startExecutionMutation.mutate()} disabled={startExecutionMutation.isPending}>
              {startExecutionMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
              Start
            </Button>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-auto px-4 py-4 space-y-4">
        {template.description && (
          <p className="text-sm text-muted-foreground">{template.description}</p>
        )}

        <div className="grid grid-cols-3 gap-3">
          <Card className="text-center py-3">
            <div className="text-2xl font-bold text-primary">{stats.totalExecutions || 0}</div>
            <div className="text-[10px] text-muted-foreground uppercase tracking-wider mt-0.5 flex items-center justify-center gap-1">
              <BarChart3 className="h-3 w-3" /> Completed
            </div>
          </Card>
          <Card className="text-center py-3">
            <div className="text-2xl font-bold text-primary">{formatDuration(stats.avgCompletionSeconds)}</div>
            <div className="text-[10px] text-muted-foreground uppercase tracking-wider mt-0.5 flex items-center justify-center gap-1">
              <Clock className="h-3 w-3" /> Avg Time
            </div>
          </Card>
          <Card className="text-center py-3">
            <div className="text-sm font-bold text-primary">
              {stats.lastExecutedAt ? new Date(stats.lastExecutedAt).toLocaleDateString() : '—'}
            </div>
            <div className="text-[10px] text-muted-foreground uppercase tracking-wider mt-0.5 flex items-center justify-center gap-1">
              <Calendar className="h-3 w-3" /> Last Run
            </div>
          </Card>
        </div>

        {template.roleAssignments?.length > 0 && (
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">Assigned to:</span>
            {template.roleAssignments.map((r: string) => (
              <Badge key={r} variant="outline" className="text-xs capitalize">{r}</Badge>
            ))}
          </div>
        )}

        {template.trainingNotes && (
          <Card className="bg-blue-50 dark:bg-blue-950/30 border-blue-200 dark:border-blue-900">
            <CardContent className="py-3 flex gap-2">
              <BookOpen className="h-4 w-4 text-blue-600 shrink-0 mt-0.5" />
              <div>
                <p className="text-xs font-semibold text-blue-800 dark:text-blue-300">Why We Do This</p>
                <p className="text-xs text-blue-700 dark:text-blue-400 mt-0.5">{template.trainingNotes}</p>
              </div>
            </CardContent>
          </Card>
        )}

        <Separator />

        <div className="space-y-3">
          <h2 className="text-sm font-semibold flex items-center gap-2">
            Steps
            <Badge variant="secondary" className="text-xs">{steps.length}</Badge>
          </h2>

          {steps.map((step: any, index: number) => {
            const StepIcon = STEP_TYPE_ICONS[step.stepType] || CheckCircle2;
            return (
              <Card key={step.id} className="overflow-hidden">
                <CardContent className="py-3 px-4">
                  <div className="flex items-start gap-3">
                    <div className="flex items-center justify-center h-7 w-7 rounded-full bg-primary/10 text-primary text-xs font-bold shrink-0 mt-0.5">
                      {index + 1}
                    </div>
                    <div className="flex-1 min-w-0 space-y-1">
                      <div className="flex items-center gap-2">
                        <h3 className="text-sm font-medium leading-tight">{step.title}</h3>
                        {step.isCheckpoint && (
                          <Badge variant="outline" className="text-[9px] px-1.5 py-0 gap-0.5 text-amber-600 border-amber-300">
                            <AlertTriangle className="h-2.5 w-2.5" /> Checkpoint
                          </Badge>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge variant="secondary" className="text-[10px] gap-1 px-1.5 py-0">
                          <StepIcon className="h-3 w-3" />
                          {step.stepType}
                        </Badge>
                        {step.stepType === 'timer' && step.timerDurationSeconds && (
                          <span className="text-[10px] text-muted-foreground">{step.timerDurationSeconds}s</span>
                        )}
                      </div>
                      {step.description && (
                        <p className="text-xs text-muted-foreground mt-1">{step.description}</p>
                      )}
                      {step.stepType === 'decision' && step.decisionOptions?.options && (
                        <div className="flex gap-1 mt-1 flex-wrap">
                          {step.decisionOptions.options.map((opt: any, i: number) => (
                            <Badge key={i} variant="outline" className="text-[10px]">
                              {opt.label} → Step {opt.nextStepOrder}
                            </Badge>
                          ))}
                        </div>
                      )}
                      {step.trainingDetail && (
                        <div className="mt-2 pl-2 border-l-2 border-blue-300 dark:border-blue-800">
                          <p className="text-[11px] text-blue-700 dark:text-blue-400 italic">{step.trainingDetail}</p>
                        </div>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>

        {template.parentTemplateId && (
          <>
            <Separator />
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <History className="h-3.5 w-3.5" />
              This is version {template.version}. Previous versions are preserved for reference.
            </div>
          </>
        )}
      </div>
    </div>
  );
}
