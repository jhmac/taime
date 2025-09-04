import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/hooks/useAuth';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { apiRequest } from '@/lib/queryClient';
import { isUnauthorizedError } from '@/lib/authUtils';
import type { Task } from '@shared/schema';

export default function ChoresWidget() {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [showScheduleModal, setShowScheduleModal] = useState(false);

  const { data: tasks, isLoading } = useQuery<Task[]>({
    queryKey: ['/api/tasks'],
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
                            {new Date(task.dueDate).toLocaleDateString('en-US', {
                              weekday: 'short',
                              month: 'short',
                              day: 'numeric',
                            })}
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
