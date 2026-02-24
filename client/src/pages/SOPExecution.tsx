import { useState, useEffect, useRef, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useRoute, useLocation } from 'wouter';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Progress } from '@/components/ui/progress';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/hooks/useAuth';
import { useWebSocket } from '@/hooks/useWebSocket';
import { apiRequest } from '@/lib/queryClient';
import type { SopStep, SopStepCompletion, SopTemplate, SopExecution as SopExecutionType } from '@shared/schema';
import {
  ArrowLeft, CheckCircle2, Eye, Camera, GitBranch, Timer, Play, Pause,
  SkipForward, Clock, Loader2, PartyPopper, MessageSquare, ChevronLeft,
  ChevronRight, ShieldCheck, Upload, X
} from 'lucide-react';

const STEP_TYPE_CONFIG: Record<string, { icon: typeof CheckCircle2; label: string }> = {
  action: { icon: CheckCircle2, label: 'Action' },
  verification: { icon: Eye, label: 'Verification' },
  photo: { icon: Camera, label: 'Photo Required' },
  decision: { icon: GitBranch, label: 'Decision' },
  timer: { icon: Timer, label: 'Timer' },
};

const LS_PREFIX = 'sop_exec_';
const LS_PENDING_SYNC = 'sop_pending_sync';

interface ExecutionData extends SopExecutionType {
  template: SopTemplate;
  steps: SopStep[];
  stepCompletions: SopStepCompletion[];
}

function compressImage(file: File, maxSizeKB: number = 1024): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        let { width, height } = img;
        const maxDim = 1200;
        if (width > maxDim || height > maxDim) {
          const ratio = Math.min(maxDim / width, maxDim / height);
          width = Math.round(width * ratio);
          height = Math.round(height * ratio);
        }
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) { reject(new Error('Canvas context unavailable')); return; }
        ctx.drawImage(img, 0, 0, width, height);

        let quality = 0.8;
        let dataUrl = canvas.toDataURL('image/jpeg', quality);
        while (dataUrl.length > maxSizeKB * 1024 * 1.37 && quality > 0.1) {
          quality -= 0.1;
          dataUrl = canvas.toDataURL('image/jpeg', quality);
        }
        resolve(dataUrl);
      };
      img.onerror = () => reject(new Error('Failed to load image'));
      img.src = e.target?.result as string;
    };
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsDataURL(file);
  });
}

function formatElapsed(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export default function SOPExecution() {
  const [, params] = useRoute('/sops/execute/:executionId');
  const [, navigate] = useLocation();
  const { user } = useAuth();
  const { toast } = useToast();
  const { lastMessage } = useWebSocket();
  const qc = useQueryClient();
  const executionId = params?.executionId ?? '';

  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [trainingMode, setTrainingMode] = useState(false);
  const [showSkipInput, setShowSkipInput] = useState(false);
  const [skipReason, setSkipReason] = useState('');
  const [stepNotes, setStepNotes] = useState('');
  const [showNotesInput, setShowNotesInput] = useState(false);
  const [capturedPhoto, setCapturedPhoto] = useState<string | null>(null);
  const [timerRunning, setTimerRunning] = useState(false);
  const [timerRemaining, setTimerRemaining] = useState(0);
  const [elapsedTime, setElapsedTime] = useState(0);
  const [feedbackText, setFeedbackText] = useState('');
  const [showCompletion, setShowCompletion] = useState(false);
  const [initialStepRestored, setInitialStepRestored] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const timerIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const stepStartTimeRef = useRef<number>(Date.now());

  const { data, isLoading, error } = useQuery<{ success: boolean; data: ExecutionData }>({
    queryKey: ['/api/sops/executions', executionId],
    enabled: !!executionId,
  });

  const execution = data?.data;
  const steps = execution?.steps ?? [];
  const completions = execution?.stepCompletions ?? [];

  const completedCount = completions.filter(c => c.status === 'completed' || c.status === 'skipped').length;
  const totalSteps = steps.length;
  const progressPercent = totalSteps > 0 ? (completedCount / totalSteps) * 100 : 0;

  const currentStep = steps[currentStepIndex];
  const currentCompletion = currentStep
    ? completions.find(c => c.stepId === currentStep.id)
    : undefined;
  const isCurrentStepDone = currentCompletion?.status === 'completed' || currentCompletion?.status === 'skipped';
  const isWaitingForSignOff = currentStep?.isCheckpoint && currentCompletion?.status === 'completed' && currentCompletion?.managerSignOff === false;

  useEffect(() => {
    if (execution?.status === 'completed') {
      setShowCompletion(true);
    }
  }, [execution?.status]);

  useEffect(() => {
    if (initialStepRestored || steps.length === 0 || completions.length === 0) return;
    setInitialStepRestored(true);

    try {
      const saved = localStorage.getItem(`${LS_PREFIX}${executionId}`);
      if (saved) {
        const parsed = JSON.parse(saved) as { currentStepIndex: number; timestamp: number };
        if (Date.now() - parsed.timestamp < 3600000 && parsed.currentStepIndex < steps.length) {
          setCurrentStepIndex(parsed.currentStepIndex);
          return;
        }
      }
    } catch { /* ignore parse errors */ }

    const firstPendingIndex = steps.findIndex(s => {
      const comp = completions.find(c => c.stepId === s.id);
      return !comp || comp.status === 'pending';
    });
    if (firstPendingIndex >= 0) {
      setCurrentStepIndex(firstPendingIndex);
    }
  }, [initialStepRestored, steps.length, completions.length, executionId]);

  useEffect(() => {
    if (!execution?.startedAt) return;
    const started = new Date(execution.startedAt).getTime();
    setElapsedTime(Math.floor((Date.now() - started) / 1000));

    const interval = setInterval(() => {
      setElapsedTime(Math.floor((Date.now() - started) / 1000));
    }, 1000);
    return () => clearInterval(interval);
  }, [execution?.startedAt]);

  useEffect(() => {
    stepStartTimeRef.current = Date.now();
    setShowSkipInput(false);
    setSkipReason('');
    setStepNotes('');
    setShowNotesInput(false);
    setCapturedPhoto(null);
    setTimerRunning(false);
    if (timerIntervalRef.current) {
      clearInterval(timerIntervalRef.current);
      timerIntervalRef.current = null;
    }
    if (currentStep?.stepType === 'timer' && currentStep.timerDurationSeconds) {
      setTimerRemaining(currentStep.timerDurationSeconds);
    }

    if (executionId && execution) {
      try {
        localStorage.setItem(`${LS_PREFIX}${executionId}`, JSON.stringify({
          currentStepIndex,
          timestamp: Date.now(),
        }));
      } catch { /* localStorage might be full */ }
    }
  }, [currentStepIndex, currentStep?.id]);

  useEffect(() => {
    return () => {
      if (timerIntervalRef.current) clearInterval(timerIntervalRef.current);
    };
  }, []);

  useEffect(() => {
    if (!lastMessage) return;
    if (lastMessage.type === 'sign_off_completed' || lastMessage.type === 'step_completed' || lastMessage.type === 'execution_completed') {
      qc.invalidateQueries({ queryKey: ['/api/sops/executions', executionId] });
    }
  }, [lastMessage, executionId, qc]);

  const cleanupLocalStorage = useCallback(() => {
    try { localStorage.removeItem(`${LS_PREFIX}${executionId}`); } catch { /* ignore */ }
  }, [executionId]);

  const completeStepMutation = useMutation({
    mutationFn: async (payload: { stepId: string; status: string; skipReason?: string; photoUrl?: string; notes?: string; timeSpentSeconds?: number }) => {
      return await apiRequest('PUT', `/api/sops/executions/${executionId}/steps/${payload.stepId}`, payload);
    },
    onSuccess: async (res) => {
      const result = await res.json() as { success: boolean; data: { executionCompleted: boolean } };
      qc.invalidateQueries({ queryKey: ['/api/sops/executions', executionId] });
      if (result.data.executionCompleted) {
        setShowCompletion(true);
        cleanupLocalStorage();
      } else if (currentStepIndex < totalSteps - 1) {
        setCurrentStepIndex(prev => prev + 1);
      }
    },
    onError: () => {
      toast({ title: 'Error', description: 'Failed to update step. Your progress has been saved locally.', variant: 'destructive' });
      try {
        const queue = JSON.parse(localStorage.getItem(LS_PENDING_SYNC) ?? '[]') as Record<string, unknown>[];
        queue.push({ executionId, stepId: currentStep?.id, timestamp: Date.now() });
        localStorage.setItem(LS_PENDING_SYNC, JSON.stringify(queue));
      } catch { /* ignore */ }
    },
  });

  const abandonMutation = useMutation({
    mutationFn: async () => {
      return await apiRequest('PUT', `/api/sops/executions/${executionId}`, {
        status: 'abandoned',
        notes: feedbackText || undefined,
      });
    },
    onSuccess: () => {
      cleanupLocalStorage();
      navigate('/sops');
    },
  });

  const handleComplete = useCallback(() => {
    if (!currentStep) return;
    const timeSpent = Math.floor((Date.now() - stepStartTimeRef.current) / 1000);
    completeStepMutation.mutate({
      stepId: currentStep.id,
      status: 'completed',
      notes: stepNotes || undefined,
      photoUrl: capturedPhoto || undefined,
      timeSpentSeconds: timeSpent,
    });
  }, [currentStep, stepNotes, capturedPhoto, completeStepMutation]);

  const handleSkip = useCallback(() => {
    if (!currentStep || !skipReason.trim()) return;
    const timeSpent = Math.floor((Date.now() - stepStartTimeRef.current) / 1000);
    completeStepMutation.mutate({
      stepId: currentStep.id,
      status: 'skipped',
      skipReason: skipReason.trim(),
      timeSpentSeconds: timeSpent,
    });
  }, [currentStep, skipReason, completeStepMutation]);

  const handleDecisionSelect = useCallback((option: { label: string; nextStepOrder: number }) => {
    if (!currentStep) return;
    const timeSpent = Math.floor((Date.now() - stepStartTimeRef.current) / 1000);
    completeStepMutation.mutate({
      stepId: currentStep.id,
      status: 'completed',
      notes: `Decision: ${option.label}`,
      timeSpentSeconds: timeSpent,
    });
  }, [currentStep, completeStepMutation]);

  const handlePhotoCapture = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const compressed = await compressImage(file);
      setCapturedPhoto(compressed);
    } catch {
      toast({ title: 'Error', description: 'Failed to process photo', variant: 'destructive' });
    }
  }, [toast]);

  const startTimer = useCallback(() => {
    setTimerRunning(true);
    timerIntervalRef.current = setInterval(() => {
      setTimerRemaining(prev => {
        if (prev <= 1) {
          if (timerIntervalRef.current) clearInterval(timerIntervalRef.current);
          timerIntervalRef.current = null;
          setTimerRunning(false);
          handleComplete();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  }, [handleComplete]);

  if (isLoading) {
    return (
      <div className="flex flex-col h-screen bg-background p-4 gap-4">
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="flex-1 w-full" />
        <Skeleton className="h-14 w-full" />
      </div>
    );
  }

  if (error || !execution) {
    return (
      <div className="flex flex-col items-center justify-center h-screen bg-background p-4 gap-4">
        <p className="text-lg text-muted-foreground">Execution not found</p>
        <Button onClick={() => navigate('/sops')}>Back to SOPs</Button>
      </div>
    );
  }

  if (showCompletion) {
    const skippedCount = completions.filter(c => c.status === 'skipped').length;
    const doneCount = completions.filter(c => c.status === 'completed').length;
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-background p-6 gap-6">
        <div className="animate-bounce">
          <PartyPopper className="h-16 w-16 text-amber-500" />
        </div>
        <h1 className="text-2xl font-bold text-center">
          {execution.template?.title ?? 'SOP'} Complete!
        </h1>
        <p className="text-lg text-muted-foreground text-center">
          Nice work{user?.firstName ? `, ${user.firstName}` : ''}!
        </p>

        <div className="grid grid-cols-3 gap-4 w-full max-w-sm">
          <Card>
            <CardContent className="p-4 text-center">
              <p className="text-2xl font-bold">{formatElapsed(elapsedTime)}</p>
              <p className="text-xs text-muted-foreground">Total Time</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4 text-center">
              <p className="text-2xl font-bold text-green-600">{doneCount}</p>
              <p className="text-xs text-muted-foreground">Completed</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4 text-center">
              <p className="text-2xl font-bold text-amber-600">{skippedCount}</p>
              <p className="text-xs text-muted-foreground">Skipped</p>
            </CardContent>
          </Card>
        </div>

        <div className="w-full max-w-sm space-y-2">
          <label className="text-sm font-medium text-muted-foreground">
            What bugged you about this process? (optional)
          </label>
          <Textarea
            value={feedbackText}
            onChange={e => setFeedbackText(e.target.value)}
            placeholder="Any steps that felt unnecessary, confusing, or slow..."
            className="min-h-[80px]"
          />
        </div>

        <Button size="lg" className="w-full max-w-sm min-h-[48px] text-lg" onClick={() => {
          if (feedbackText.trim()) {
            apiRequest('PUT', `/api/sops/executions/${executionId}`, {
              status: 'completed',
              notes: feedbackText.trim(),
            }).catch(() => {});
          }
          navigate('/sops');
        }}>
          Done
        </Button>
      </div>
    );
  }

  const StepIcon = currentStep ? STEP_TYPE_CONFIG[currentStep.stepType]?.icon ?? CheckCircle2 : CheckCircle2;
  const stepConfig = currentStep ? STEP_TYPE_CONFIG[currentStep.stepType] : undefined;

  return (
    <div className="flex flex-col h-screen bg-background">
      <div className="flex-shrink-0 border-b bg-card px-4 py-3 space-y-2">
        <div className="flex items-center justify-between">
          <Button variant="ghost" size="sm" className="gap-1 min-h-[44px]" onClick={() => {
            if (window.confirm('Leave this SOP? Your progress is saved.')) {
              navigate('/sops');
            }
          }}>
            <ArrowLeft className="h-4 w-4" />
            Exit
          </Button>
          <div className="text-center flex-1 px-2">
            <p className="font-semibold text-sm truncate">{execution.template?.title}</p>
            <p className="text-xs text-muted-foreground">
              Step {currentStepIndex + 1} of {totalSteps}
            </p>
          </div>
          <div className="flex items-center gap-1 text-xs text-muted-foreground min-w-[60px] justify-end">
            <Clock className="h-3 w-3" />
            {formatElapsed(elapsedTime)}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Progress value={progressPercent} className="h-2 flex-1 transition-all duration-500" />
          <span className="text-xs font-medium text-muted-foreground whitespace-nowrap">
            {completedCount}/{totalSteps}
          </span>
        </div>

        <div className="flex gap-1 justify-center overflow-x-auto py-1">
          {steps.map((step, i) => {
            const comp = completions.find(c => c.stepId === step.id);
            const isDone = comp?.status === 'completed' || comp?.status === 'skipped';
            const isCurrent = i === currentStepIndex;
            return (
              <button
                key={step.id}
                className={`w-2.5 h-2.5 rounded-full transition-all duration-300 flex-shrink-0 ${
                  isDone ? 'bg-green-500 scale-100' :
                  isCurrent ? 'bg-primary scale-125 ring-2 ring-primary/30' :
                  'bg-muted-foreground/20'
                }`}
                onClick={() => setCurrentStepIndex(i)}
                aria-label={`Step ${i + 1}: ${step.title}`}
              />
            );
          })}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        {currentStep && (
          <Card className="border-2 shadow-sm">
            <CardContent className="p-5 space-y-4">
              <div className="flex items-start gap-3">
                <div className="p-2 rounded-lg bg-primary/10 flex-shrink-0">
                  <StepIcon className="h-5 w-5 text-primary" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap mb-1">
                    <Badge variant="outline" className="text-xs">
                      {stepConfig?.label ?? currentStep.stepType}
                    </Badge>
                    {currentStep.isCheckpoint && (
                      <Badge className="bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300 text-xs gap-1">
                        <ShieldCheck className="h-3 w-3" />
                        Manager Sign-off
                      </Badge>
                    )}
                  </div>
                  <h2 className="text-xl font-bold mt-2">{currentStep.title}</h2>
                  {currentStep.description && (
                    <p className="text-sm text-muted-foreground mt-2">{currentStep.description}</p>
                  )}
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={() => setTrainingMode(prev => !prev)}
                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                    trainingMode ? 'bg-blue-600' : 'bg-gray-300 dark:bg-gray-600'
                  }`}
                  role="switch"
                  aria-checked={trainingMode}
                >
                  <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                    trainingMode ? 'translate-x-6' : 'translate-x-1'
                  }`} />
                </button>
                <span className="text-sm text-muted-foreground">Training Mode</span>
              </div>

              {trainingMode && currentStep.trainingDetail && (
                <div className="rounded-lg border-2 border-blue-200 bg-blue-50 dark:border-blue-800 dark:bg-blue-950/30 p-4 animate-in fade-in slide-in-from-top-2 duration-300">
                  <p className="text-sm text-blue-800 dark:text-blue-200 leading-relaxed">
                    {currentStep.trainingDetail}
                  </p>
                </div>
              )}

              {isWaitingForSignOff && (
                <div className="rounded-lg border-2 border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/30 p-4 text-center space-y-2">
                  <ShieldCheck className="h-8 w-8 text-amber-600 mx-auto" />
                  <p className="font-medium text-amber-800 dark:text-amber-200">Waiting for manager approval</p>
                  <p className="text-xs text-amber-600 dark:text-amber-400">A manager has been notified to review and sign off on this step.</p>
                  <Loader2 className="h-4 w-4 animate-spin text-amber-600 mx-auto" />
                </div>
              )}

              {!isCurrentStepDone && !isWaitingForSignOff && (
                <div className="space-y-3 pt-2">
                  {currentStep.stepType === 'action' && (
                    <Button
                      size="lg"
                      className="w-full min-h-[52px] text-lg font-semibold transition-all active:scale-95"
                      onClick={handleComplete}
                      disabled={completeStepMutation.isPending}
                    >
                      {completeStepMutation.isPending ? <Loader2 className="h-5 w-5 animate-spin mr-2" /> : <CheckCircle2 className="h-5 w-5 mr-2" />}
                      Mark Complete
                    </Button>
                  )}

                  {currentStep.stepType === 'verification' && (
                    <Button
                      size="lg"
                      className="w-full min-h-[52px] text-lg font-semibold transition-all active:scale-95"
                      onClick={handleComplete}
                      disabled={completeStepMutation.isPending}
                    >
                      {completeStepMutation.isPending ? <Loader2 className="h-5 w-5 animate-spin mr-2" /> : <Eye className="h-5 w-5 mr-2" />}
                      Confirm Done
                    </Button>
                  )}

                  {currentStep.stepType === 'photo' && (
                    <div className="space-y-3">
                      <input
                        ref={fileInputRef}
                        type="file"
                        accept="image/*"
                        capture="environment"
                        className="hidden"
                        onChange={handlePhotoCapture}
                      />
                      {capturedPhoto ? (
                        <div className="relative rounded-lg overflow-hidden border">
                          <img src={capturedPhoto} alt="Captured" className="w-full max-h-48 object-cover" />
                          <Button
                            variant="destructive"
                            size="sm"
                            className="absolute top-2 right-2 min-h-[36px] min-w-[36px] p-0"
                            onClick={() => setCapturedPhoto(null)}
                          >
                            <X className="h-4 w-4" />
                          </Button>
                        </div>
                      ) : (
                        <Button
                          variant="outline"
                          size="lg"
                          className="w-full min-h-[52px] text-lg border-dashed border-2 gap-2"
                          onClick={() => fileInputRef.current?.click()}
                        >
                          <Camera className="h-5 w-5" />
                          Take Photo
                        </Button>
                      )}
                      {capturedPhoto && (
                        <Button
                          size="lg"
                          className="w-full min-h-[52px] text-lg font-semibold transition-all active:scale-95"
                          onClick={handleComplete}
                          disabled={completeStepMutation.isPending}
                        >
                          {completeStepMutation.isPending ? <Loader2 className="h-5 w-5 animate-spin mr-2" /> : <Upload className="h-5 w-5 mr-2" />}
                          Upload & Complete
                        </Button>
                      )}
                    </div>
                  )}

                  {currentStep.stepType === 'decision' && currentStep.decisionOptions?.options && (
                    <div className="space-y-2">
                      {currentStep.decisionOptions.options.map((opt, i) => (
                        <Button
                          key={i}
                          variant="outline"
                          size="lg"
                          className="w-full min-h-[52px] text-base justify-start transition-all active:scale-95"
                          onClick={() => handleDecisionSelect(opt)}
                          disabled={completeStepMutation.isPending}
                        >
                          <GitBranch className="h-4 w-4 mr-2 flex-shrink-0" />
                          {opt.label}
                        </Button>
                      ))}
                    </div>
                  )}

                  {currentStep.stepType === 'timer' && (
                    <div className="space-y-3 text-center">
                      <div className="text-4xl font-mono font-bold tracking-wider">
                        {formatElapsed(timerRemaining)}
                      </div>
                      {!timerRunning ? (
                        <Button
                          size="lg"
                          className="w-full min-h-[52px] text-lg font-semibold gap-2 transition-all active:scale-95"
                          onClick={startTimer}
                          disabled={completeStepMutation.isPending}
                        >
                          <Play className="h-5 w-5" />
                          Start Timer
                        </Button>
                      ) : (
                        <div className="flex gap-2">
                          <Button
                            variant="outline"
                            size="lg"
                            className="flex-1 min-h-[52px]"
                            onClick={() => {
                              setTimerRunning(false);
                              if (timerIntervalRef.current) {
                                clearInterval(timerIntervalRef.current);
                                timerIntervalRef.current = null;
                              }
                            }}
                          >
                            <Pause className="h-5 w-5 mr-2" />
                            Pause
                          </Button>
                          <Button
                            size="lg"
                            className="flex-1 min-h-[52px]"
                            onClick={handleComplete}
                            disabled={completeStepMutation.isPending}
                          >
                            Done Early
                          </Button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              {isCurrentStepDone && !isWaitingForSignOff && (
                <div className="rounded-lg bg-green-50 dark:bg-green-950/30 border border-green-200 dark:border-green-800 p-4 text-center">
                  <CheckCircle2 className="h-6 w-6 text-green-600 mx-auto mb-1" />
                  <p className="text-sm font-medium text-green-700 dark:text-green-300">
                    {currentCompletion?.status === 'skipped' ? 'Step Skipped' : 'Step Complete'}
                  </p>
                  {currentCompletion?.skipReason && (
                    <p className="text-xs text-muted-foreground mt-1">Reason: {currentCompletion.skipReason}</p>
                  )}
                </div>
              )}

              {!isCurrentStepDone && !isWaitingForSignOff && (
                <>
                  {!showSkipInput ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="w-full min-h-[44px] text-muted-foreground"
                      onClick={() => setShowSkipInput(true)}
                    >
                      <SkipForward className="h-4 w-4 mr-2" />
                      Skip this step
                    </Button>
                  ) : (
                    <div className="space-y-2 pt-2 border-t animate-in fade-in slide-in-from-bottom-2 duration-200">
                      <Input
                        placeholder="Why are you skipping this step? (required)"
                        value={skipReason}
                        onChange={e => setSkipReason(e.target.value)}
                        className="min-h-[44px]"
                      />
                      <div className="flex gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          className="flex-1 min-h-[44px]"
                          onClick={() => { setShowSkipInput(false); setSkipReason(''); }}
                        >
                          Cancel
                        </Button>
                        <Button
                          variant="destructive"
                          size="sm"
                          className="flex-1 min-h-[44px]"
                          onClick={handleSkip}
                          disabled={!skipReason.trim() || completeStepMutation.isPending}
                        >
                          {completeStepMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                          Confirm Skip
                        </Button>
                      </div>
                    </div>
                  )}
                </>
              )}
            </CardContent>
          </Card>
        )}
      </div>

      <div className="flex-shrink-0 border-t bg-card px-4 py-3">
        <div className="flex items-center justify-between gap-2">
          <Button
            variant="outline"
            size="sm"
            className="min-h-[44px] min-w-[44px]"
            disabled={currentStepIndex === 0}
            onClick={() => setCurrentStepIndex(prev => Math.max(0, prev - 1))}
          >
            <ChevronLeft className="h-5 w-5" />
          </Button>

          <button
            className="flex items-center gap-1 text-sm text-muted-foreground min-h-[44px] px-3"
            onClick={() => setShowNotesInput(prev => !prev)}
          >
            <MessageSquare className="h-4 w-4" />
            {showNotesInput ? 'Hide Notes' : 'Notes'}
          </button>

          <Button
            variant="outline"
            size="sm"
            className="min-h-[44px] min-w-[44px]"
            disabled={currentStepIndex >= totalSteps - 1}
            onClick={() => setCurrentStepIndex(prev => Math.min(totalSteps - 1, prev + 1))}
          >
            <ChevronRight className="h-5 w-5" />
          </Button>
        </div>

        {showNotesInput && (
          <div className="mt-2 animate-in fade-in slide-in-from-bottom-2 duration-200">
            <Textarea
              value={stepNotes}
              onChange={e => setStepNotes(e.target.value)}
              placeholder="Add notes for this step..."
              className="min-h-[60px] text-sm"
            />
          </div>
        )}
      </div>
    </div>
  );
}
