import { useState, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/hooks/useAuth';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { apiRequest } from '@/lib/queryClient';
import { isUnauthorizedError } from '@/lib/authUtils';
import type { Task, TaskAssignee } from '@shared/schema';

type BroadcastAssignment = TaskAssignee & { task: Task };

export default function ChoresWidget() {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [showScheduleModal, setShowScheduleModal] = useState(false);
  const [completingId, setCompletingId] = useState<string | null>(null);
  const [completionNote, setCompletionNote] = useState('');
  const [capturedImage, setCapturedImage] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { data: tasks, isLoading } = useQuery<Task[]>({
    queryKey: ['/api/tasks'],
  });

  const { data: broadcastAssignments = [], refetch: refetchAssignments } = useQuery<BroadcastAssignment[]>({
    queryKey: ['/api/tasks/my-assignments'],
    refetchInterval: 20000,
    enabled: !!user,
  });

  const updateTaskMutation = useMutation({
    mutationFn: async ({ id, updates }: { id: string; updates: any }) => {
      return await apiRequest('PATCH', `/api/tasks/${id}`, updates);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/tasks'] });
    },
    onError: (error: Error) => {
      if (isUnauthorizedError(error)) {
        toast({
          title: "Unauthorized",
          description: "You are logged out. Logging in again...",
          variant: "destructive",
        });
        setTimeout(() => {
          window.location.href = "/api/login";
        }, 500);
        return;
      }
      toast({
        title: "Error",
        description: "Failed to update task. Please try again.",
        variant: "destructive",
      });
    },
  });

  const startAssigneeMutation = useMutation({
    mutationFn: async ({ taskId, assigneeId }: { taskId: string; assigneeId: string }) => {
      const res = await apiRequest('PATCH', `/api/tasks/${taskId}/assignees/${assigneeId}/start`, {});
      return res.json();
    },
    onSuccess: () => refetchAssignments(),
  });

  const completeAssigneeMutation = useMutation({
    mutationFn: async ({ taskId, assigneeId, completionImageUrl, note }: { taskId: string; assigneeId: string; completionImageUrl?: string; note?: string }) => {
      const res = await apiRequest('PATCH', `/api/tasks/${taskId}/assignees/${assigneeId}/complete`, { completionImageUrl, completionNote: note });
      return res.json();
    },
    onSuccess: () => {
      refetchAssignments();
      setCompletingId(null);
      setCompletionNote('');
      setCapturedImage(null);
      toast({ title: "Submitted!", description: "Awaiting manager approval." });
    },
    onError: (err: Error) => toast({ title: "Submit Failed", description: err.message, variant: "destructive" }),
  });

  const userTasks = tasks?.filter((task) => task.assignedTo === user?.id) || [];
  const today = new Date();
  const todayTasks = userTasks.filter((task) => {
    if (!task.dueDate) return true;
    const taskDate = new Date(task.dueDate);
    return taskDate.toDateString() === today.toDateString();
  });
  
  const upcomingSchedules = userTasks.filter((task) => task.status === 'pending' && task.dueDate && new Date(task.dueDate) > today);

  const handleTaskComplete = (taskId: string, completed: boolean) => {
    updateTaskMutation.mutate({
      id: taskId,
      updates: {
        status: completed ? 'completed' : 'pending',
        completedAt: completed ? new Date() : null,
      },
    });

    if (completed) {
      toast({
        title: "Task Completed!",
        description: "Great job! Your task has been marked as complete.",
      });
    }
  };

  const getPriorityColor = (estimatedMinutes: number) => {
    if (estimatedMinutes <= 15) return 'text-green-600';
    if (estimatedMinutes <= 45) return 'text-yellow-600';
    return 'text-red-600';
  };

  const getTaskIcon = (task: Task) => {
    if (task.status === 'completed') return 'fas fa-check-circle text-green-500';
    if (task.isAIAssigned) return 'fas fa-robot text-primary';
    return 'fas fa-circle text-muted-foreground';
  };

  return (
    <>
    <Card data-testid="chores-widget">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
        <CardTitle className="text-base flex items-center">
          <i className="fas fa-tasks text-primary mr-2"></i>
          My Tasks
          {userTasks.filter((t) => t.status !== 'completed').length > 0 && (
            <Badge className="ml-2 bg-primary/10 text-primary">
              {userTasks.filter((t) => t.status !== 'completed').length}
            </Badge>
          )}
        </CardTitle>
        {userTasks.some((task) => task.isAIAssigned) && (
          <Badge className="bg-gradient-to-r from-primary to-accent text-primary-foreground text-xs">
            <i className="fas fa-magic mr-1"></i>
            Claude AI
          </Badge>
        )}
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="space-y-2">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="animate-pulse h-16 bg-muted rounded-lg"></div>
            ))}
          </div>
        ) : todayTasks.length === 0 ? (
          <div className="text-center py-6">
            <i className="fas fa-check-circle text-green-500 text-2xl mb-2"></i>
            <p className="text-muted-foreground text-sm">No tasks for today</p>
            <p className="text-xs text-muted-foreground mt-1">All caught up!</p>
          </div>
        ) : (
          <div className="space-y-3">
            {todayTasks.map((task) => (
              <div
                key={task.id}
                className={`flex items-start space-x-3 p-3 rounded-lg border transition-colors ${
                  task.status === 'completed'
                    ? 'bg-green-50 border-green-200'
                    : 'bg-muted/50 border-border hover:bg-muted/70'
                }`}
              >
                <Checkbox
                  checked={task.status === 'completed'}
                  onCheckedChange={(checked) => handleTaskComplete(task.id, !!checked)}
                  disabled={updateTaskMutation.isPending}
                  className="mt-1"
                  data-testid={`task-checkbox-${task.id}`}
                />
                <div className="flex-1">
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <p className={`font-medium text-sm ${
                        task.status === 'completed' ? 'line-through text-muted-foreground' : ''
                      }`}>
                        {task.title}
                      </p>
                      {task.description && (
                        <p className="text-xs text-muted-foreground mt-1">
                          {task.description}
                        </p>
                      )}
                      
                      <div className="flex items-center space-x-2 mt-2">
                        {task.isAIAssigned && (
                          <span className="text-xs bg-gradient-to-r from-primary/10 to-accent/10 text-primary px-2 py-0.5 rounded-full border border-primary/20">
                            AI assigned based on schedule
                          </span>
                        )}
                        
                        {task.dueDate && (
                          <span className="text-xs text-muted-foreground">
                            <i className="fas fa-clock mr-1"></i>
                            Due: {new Date(task.dueDate).toLocaleTimeString('en-US', { 
                              hour: 'numeric', 
                              minute: '2-digit',
                              hour12: true 
                            })}
                          </span>
                        )}
                      </div>

                      {task.estimatedMinutes && (
                        <div className="flex items-center mt-2">
                          <i className={`fas fa-clock ${getPriorityColor(task.estimatedMinutes)} text-xs mr-1`}></i>
                          <span className="text-xs text-muted-foreground">
                            {task.estimatedMinutes} min estimated
                          </span>
                        </div>
                      )}

                      {task.status === 'completed' && task.completedAt && (
                        <div className="flex items-center mt-2">
                          <i className="fas fa-check-circle text-green-500 text-xs mr-1"></i>
                          <span className="text-xs text-green-600">
                            Completed at {new Date(task.completedAt).toLocaleTimeString('en-US', { hour12: true })}
                          </span>
                        </div>
                      )}

                      {task.isAIAssigned && task.aiReasoning && (
                        <details className="mt-2">
                          <summary className="text-xs text-primary cursor-pointer hover:underline">
                            <i className="fas fa-brain mr-1"></i>
                            View AI reasoning
                          </summary>
                          <p className="text-xs text-muted-foreground mt-1 ml-4">
                            {task.aiReasoning}
                          </p>
                        </details>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            ))}

            {/* Upcoming Tasks Preview */}
            {upcomingSchedules.length > 0 && todayTasks.every((task: any) => task.status === 'completed') && (
              <div className="mt-4 pt-3 border-t border-border">
                <h4 className="text-sm font-medium mb-2 text-muted-foreground">
                  Upcoming Tasks
                </h4>
                <div className="space-y-2">
                  {upcomingSchedules
                    .slice(0, 2)
                    .map((task) => (
                      <div key={task.id} className="flex items-center justify-between p-2 bg-muted/30 rounded-lg">
                        <div>
                          <p className="font-medium text-xs">{task.title}</p>
                          <p className="text-xs text-muted-foreground">
                            {task.dueDate ? new Date(task.dueDate).toLocaleDateString('en-US', {
                              weekday: 'short' as const,
                              month: 'short' as const,
                              day: 'numeric' as const,
                            }) : ''}
                          </p>
                        </div>
                        {task.estimatedMinutes && (
                          <span className="text-xs text-muted-foreground">
                            {task.estimatedMinutes}m
                          </span>
                        )}
                      </div>
                    ))}
                </div>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>

    {/* Broadcast assignments card */}
    {broadcastAssignments.length > 0 && (
      <Card className="border-primary/30" data-testid="broadcast-assignments-widget">
        <CardHeader className="pb-2 flex flex-row items-center gap-2">
          <i className="fas fa-broadcast-tower text-primary"></i>
          <CardTitle className="text-base flex-1">
            Assigned Tasks
            <Badge className="ml-2 bg-primary/10 text-primary">{broadcastAssignments.length}</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {broadcastAssignments.map((assignment) => {
            const isExpanded = completingId === assignment.id;
            const statusColor = assignment.status === 'in_progress' ? 'bg-blue-50 border-blue-200 dark:bg-blue-900/20 dark:border-blue-800/50'
              : assignment.status === 'completed' ? 'bg-green-50 border-green-200 dark:bg-green-900/20 dark:border-green-800/50'
              : 'bg-amber-50 border-amber-200 dark:bg-amber-900/20 dark:border-amber-800/50';
            return (
              <div key={assignment.id} className={`rounded-lg border p-3 transition-colors ${statusColor}`}>
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-sm">{assignment.task.title}</p>
                    {assignment.task.description && (
                      <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{assignment.task.description}</p>
                    )}
                    <div className="flex items-center gap-1.5 mt-1">
                      <Badge className={`text-[10px] ${
                        assignment.status === 'pending' ? 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400'
                        : assignment.status === 'in_progress' ? 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400'
                        : 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400'
                      }`}>
                        {assignment.status === 'in_progress' ? 'In Progress' : assignment.status === 'completed' ? 'Submitted' : 'Assigned'}
                      </Badge>
                      {assignment.task.estimatedMinutes && (
                        <span className="text-[10px] text-muted-foreground">
                          <i className="fas fa-hourglass-half mr-0.5"></i>{assignment.task.estimatedMinutes}m
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex gap-1.5 flex-shrink-0">
                    {assignment.status === 'pending' && (
                      <Button
                        size="sm"
                        className="h-8 bg-blue-600 hover:bg-blue-700 text-white text-xs"
                        disabled={startAssigneeMutation.isPending}
                        onClick={() => startAssigneeMutation.mutate({ taskId: assignment.taskId, assigneeId: assignment.id })}
                      >
                        <i className="fas fa-play mr-1"></i>Start
                      </Button>
                    )}
                    {assignment.status === 'in_progress' && !isExpanded && (
                      <Button
                        size="sm"
                        className="h-8 bg-green-600 hover:bg-green-700 text-white text-xs"
                        onClick={() => { setCompletingId(assignment.id); setCapturedImage(null); setCompletionNote(''); }}
                      >
                        <i className="fas fa-check mr-1"></i>Done
                      </Button>
                    )}
                    {isExpanded && (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-8 text-xs"
                        onClick={() => setCompletingId(null)}
                      >
                        Cancel
                      </Button>
                    )}
                  </div>
                </div>

                {/* Expand completion form inline */}
                {isExpanded && (
                  <div className="mt-3 space-y-2 border-t pt-3">
                    <p className="text-xs text-muted-foreground">Take a completion photo to submit for approval:</p>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/*"
                      capture="environment"
                      className="hidden"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (!file) return;
                        const reader = new FileReader();
                        reader.onloadend = () => setCapturedImage(reader.result as string);
                        reader.readAsDataURL(file);
                      }}
                    />
                    {capturedImage ? (
                      <div className="relative">
                        <img src={capturedImage} alt="Captured" className="w-full h-32 object-cover rounded-lg border" />
                        <Button
                          size="sm"
                          variant="ghost"
                          className="absolute top-1 right-1 h-6 px-2 text-xs bg-black/50 text-white hover:bg-black/70"
                          onClick={() => { setCapturedImage(null); if (fileInputRef.current) fileInputRef.current.value = ''; }}
                        >
                          Retake
                        </Button>
                      </div>
                    ) : (
                      <Button
                        variant="outline"
                        size="sm"
                        className="w-full h-20 border-dashed flex-col gap-1"
                        onClick={() => fileInputRef.current?.click()}
                      >
                        <i className="fas fa-camera text-lg text-muted-foreground"></i>
                        <span className="text-xs text-muted-foreground">Tap to take photo</span>
                      </Button>
                    )}
                    <textarea
                      placeholder="Optional note..."
                      value={completionNote}
                      onChange={e => setCompletionNote(e.target.value)}
                      className="w-full text-xs border rounded-md p-2 min-h-[56px] resize-none bg-background"
                    />
                    <Button
                      className="w-full bg-green-600 hover:bg-green-700 text-white"
                      size="sm"
                      disabled={completeAssigneeMutation.isPending}
                      onClick={() => completeAssigneeMutation.mutate({
                        taskId: assignment.taskId,
                        assigneeId: assignment.id,
                        completionImageUrl: capturedImage || undefined,
                        note: completionNote || undefined,
                      })}
                    >
                      {completeAssigneeMutation.isPending
                        ? <><i className="fas fa-spinner fa-spin mr-2"></i>Submitting...</>
                        : <><i className="fas fa-paper-plane mr-2"></i>Submit for Approval</>
                      }
                    </Button>
                  </div>
                )}

                {/* Show submitted state */}
                {assignment.status === 'completed' && assignment.completionImageUrl && (
                  <div className="mt-2">
                    <img src={assignment.completionImageUrl} alt="Completion" className="w-full h-24 object-cover rounded-lg border opacity-75" />
                    <p className="text-xs text-muted-foreground text-center mt-1">Awaiting manager review</p>
                  </div>
                )}
              </div>
            );
          })}
        </CardContent>
      </Card>
    )}

    {showScheduleModal && (
      <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
        <div className="bg-background p-6 rounded-lg shadow-lg max-w-md w-full">
          <h3 className="text-lg font-semibold mb-4">Schedule Details</h3>
          <p className="text-muted-foreground mb-4">Schedule management features coming soon!</p>
          <Button onClick={() => setShowScheduleModal(false)}>Close</Button>
        </div>
      </div>
    )}
    </>
  );
}
