import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/hooks/useAuth';
import { useWebSocket } from '@/hooks/useWebSocket';
import { useOnlineRetry } from '@/hooks/useOnlineRetry';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useEffect } from 'react';
import ErrorWithRetry from '@/components/ErrorWithRetry';

export default function TeamActivityFeed() {
  const { user } = useAuth();
  const { lastMessage } = useWebSocket();

  const { data: timeEntries = [], refetch: refetchTimeEntries, isError: timeEntriesError, isFetching: timeEntriesFetching } = useQuery<any[]>({
    queryKey: ['/api/time-entries'],
  });

  const { data: tasks = [], refetch: refetchTasks, isError: tasksError, isFetching: tasksFetching } = useQuery<any[]>({
    queryKey: ['/api/tasks'],
  });

  const isError = timeEntriesError || tasksError;
  const isFetching = timeEntriesFetching || tasksFetching;
  const refetch = () => { refetchTimeEntries(); refetchTasks(); };

  useOnlineRetry(refetch, isError);

  // Refetch data when receiving WebSocket updates
  useEffect(() => {
    if (lastMessage?.type === 'time_entry_created' || lastMessage?.type === 'time_entry_updated') {
      refetchTimeEntries();
    }
    if (lastMessage?.type === 'task_created' || lastMessage?.type === 'task_updated') {
      refetchTasks();
    }
  }, [lastMessage, refetchTimeEntries, refetchTasks]);

  // Create activity feed from recent time entries and task completions
  const getRecentActivity = () => {
    const activities: any[] = [];

    // Recent clock-ins (last 24 hours)
    const recentClockIns = timeEntries
      ?.filter((entry: any) => {
        const entryTime = new Date(entry.clockInTime);
        const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
        return entryTime > oneDayAgo && entry.userId !== user?.id;
      })
      .slice(0, 3) || [];

    recentClockIns.forEach((entry: any) => {
      activities.push({
        id: `clock-in-${entry.id}`,
        type: 'clock_in',
        userId: entry.userId,
        userName: `Employee ${entry.userId.slice(-4)}`,
        time: entry.clockInTime,
        description: 'clocked in',
        status: 'on_time', // Would be calculated based on schedule
      });
    });

    // Recent task completions
    const recentCompletions = tasks
      ?.filter((task: any) => {
        return task.status === 'completed' && task.completedAt && task.assignedTo !== user?.id;
      })
      .slice(0, 3) || [];

    recentCompletions.forEach((task: any) => {
      activities.push({
        id: `task-complete-${task.id}`,
        type: 'task_complete',
        userId: task.assignedTo,
        userName: `Employee ${task.assignedTo.slice(-4)}`,
        time: task.completedAt,
        description: `completed "${task.title}"`,
        isAIAssigned: task.isAIAssigned,
      });
    });

    // Sort by time (most recent first) and take top 6
    return activities
      .sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime())
      .slice(0, 6);
  };

  const getActivityIcon = (activity: any) => {
    switch (activity.type) {
      case 'clock_in':
        return 'fas fa-sign-in-alt text-blue-600';
      case 'task_complete':
        return 'fas fa-check-circle text-green-600';
      default:
        return 'fas fa-info-circle text-gray-600';
    }
  };

  const getStatusBadge = (activity: any) => {
    switch (activity.type) {
      case 'clock_in':
        return activity.status === 'on_time' ? (
          <Badge className="bg-green-100 text-green-800">On Time</Badge>
        ) : (
          <Badge className="bg-yellow-100 text-yellow-800">Late</Badge>
        );
      case 'task_complete':
        return <i className="fas fa-check-circle text-green-500"></i>;
      default:
        return null;
    }
  };

  const getTimeAgo = (time: string | Date) => {
    const now = new Date();
    const activityTime = new Date(time);
    const diffMs = now.getTime() - activityTime.getTime();
    const diffMins = Math.floor(diffMs / (1000 * 60));
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins} minutes ago`;
    if (diffHours < 24) return `${diffHours} hours ago`;
    return activityTime.toLocaleDateString();
  };

  const recentActivity = getRecentActivity();

  if (isError) {
    return <ErrorWithRetry onRetry={refetch} message="Failed to load team activity" isRetrying={isFetching} />;
  }

  return (
    <Card data-testid="team-activity-feed">
      <CardHeader>
        <CardTitle className="text-base flex items-center">
          <i className="fas fa-users text-primary mr-2"></i>
          Team Activity
          <div className="ml-auto flex items-center">
            <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse mr-2"></div>
            <span className="text-xs text-muted-foreground">Live</span>
          </div>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {recentActivity.length === 0 ? (
          <div className="text-center py-6">
            <i className="fas fa-users text-muted-foreground text-2xl mb-2"></i>
            <p className="text-muted-foreground text-sm">No recent team activity</p>
            <p className="text-xs text-muted-foreground mt-1">Activity will appear here as your team works</p>
          </div>
        ) : (
          <div className="space-y-3">
            {recentActivity.map((activity) => (
              <div key={activity.id} className="flex items-start space-x-3">
                <img 
                  src={`https://api.dicebear.com/7.x/initials/svg?seed=${activity.userName}`}
                  alt="Team member avatar"
                  className="w-8 h-8 rounded-full"
                  data-testid={`activity-avatar-${activity.userId}`}
                />
                <div className="flex-1">
                  <p className="text-sm">
                    <span className="font-medium">{activity.userName}</span> {activity.description}
                  </p>
                  <div className="flex items-center space-x-2 mt-1">
                    <p className="text-xs text-muted-foreground">
                      {getTimeAgo(activity.time)}
                    </p>
                    {activity.isAIAssigned && (
                      <span className="text-xs bg-gradient-to-r from-primary/10 to-accent/10 text-primary px-1.5 py-0.5 rounded-full">
                        AI assigned
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex items-center">
                  {getStatusBadge(activity)}
                </div>
              </div>
            ))}

            {/* Show if there are more activities */}
            {timeEntries && tasks && (timeEntries.length > 3 || tasks.length > 3) && (
              <div className="text-center pt-2">
                <Button variant="ghost" size="sm" className="text-xs">
                  View All Activity
                  <i className="fas fa-arrow-right ml-1"></i>
                </Button>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
