import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/hooks/useAuth';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import ScheduleModal from './ScheduleModal';
import type { Schedule } from '@shared/schema';

export default function ScheduleWidget() {
  const { user } = useAuth();
  const [showScheduleModal, setShowScheduleModal] = useState(false);

  const { data: schedules, isLoading } = useQuery({
    queryKey: ['/api/schedules'],
  });

  const today = new Date();
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  const todaySchedules = schedules?.filter((schedule: any) => {
    const scheduleDate = new Date(schedule.startTime);
    return scheduleDate.toDateString() === today.toDateString();
  }) || [];

  const upcomingSchedules = schedules?.filter((schedule: any) => {
    const scheduleDate = new Date(schedule.startTime);
    return scheduleDate > today && scheduleDate <= new Date(today.getTime() + 7 * 24 * 60 * 60 * 1000);
  }) || [];

  const getScheduleStatus = (schedule: any) => {
    const now = new Date();
    const start = new Date(schedule.startTime);
    const end = new Date(schedule.endTime);

    if (now >= start && now <= end) {
      return { label: 'Active', variant: 'default' as const, color: 'bg-green-100 text-green-800' };
    } else if (now < start) {
      return { label: 'Scheduled', variant: 'secondary' as const, color: 'bg-blue-100 text-blue-800' };
    } else {
      return { label: 'Completed', variant: 'outline' as const, color: 'bg-gray-100 text-gray-800' };
    }
  };

  return (
    <>
      <Card data-testid="schedule-widget">
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-base flex items-center">
            <i className="fas fa-calendar-day text-primary mr-2"></i>
            Today's Schedule
          </CardTitle>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShowScheduleModal(true)}
            data-testid="view-full-schedule"
          >
            <i className="fas fa-external-link-alt text-xs"></i>
          </Button>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-2">
              {[...Array(2)].map((_, i) => (
                <div key={i} className="animate-pulse h-16 bg-muted rounded-lg"></div>
              ))}
            </div>
          ) : todaySchedules.length === 0 ? (
            <div className="text-center py-6">
              <i className="fas fa-calendar-times text-muted-foreground text-2xl mb-2"></i>
              <p className="text-muted-foreground text-sm">No shifts scheduled for today</p>
              <p className="text-xs text-muted-foreground mt-1">Enjoy your day off!</p>
            </div>
          ) : (
            <div className="space-y-3">
              {todaySchedules.map((schedule: any) => {
                const status = getScheduleStatus(schedule);
                return (
                  <div key={schedule.id} className="flex justify-between items-center p-3 bg-muted/50 rounded-lg">
                    <div>
                      <p className="font-medium text-sm">{schedule.title || 'Shift'}</p>
                      <p className="text-xs text-muted-foreground">
                        {new Date(schedule.startTime).toLocaleTimeString('en-US', { 
                          hour: 'numeric', 
                          minute: '2-digit',
                          hour12: true 
                        })} - {new Date(schedule.endTime).toLocaleTimeString('en-US', { 
                          hour: 'numeric', 
                          minute: '2-digit',
                          hour12: true 
                        })}
                      </p>
                      {schedule.description && (
                        <p className="text-xs text-muted-foreground mt-1">{schedule.description}</p>
                      )}
                    </div>
                    <span className={`text-xs px-2 py-1 rounded-full ${status.color}`}>
                      {status.label}
                    </span>
                  </div>
                );
              })}
            </div>
          )}

          {/* Upcoming Schedule Preview */}
          {upcomingSchedules.length > 0 && (
            <div className="mt-4 pt-4 border-t border-border">
              <h4 className="text-sm font-medium mb-2 flex items-center">
                <i className="fas fa-clock text-muted-foreground mr-2"></i>
                Upcoming This Week
              </h4>
              <div className="space-y-2">
                {upcomingSchedules.slice(0, 2).map((schedule: any) => (
                  <div key={schedule.id} className="flex justify-between items-center p-2 bg-muted/30 rounded-lg">
                    <div>
                      <p className="font-medium text-xs">
                        {new Date(schedule.startTime).toLocaleDateString('en-US', {
                          weekday: 'short',
                          month: 'short',
                          day: 'numeric',
                        })}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {new Date(schedule.startTime).toLocaleTimeString('en-US', { 
                          hour: 'numeric', 
                          minute: '2-digit',
                          hour12: true 
                        })} - {new Date(schedule.endTime).toLocaleTimeString('en-US', { 
                          hour: 'numeric', 
                          minute: '2-digit',
                          hour12: true 
                        })}
                      </p>
                    </div>
                    <Badge variant="outline" className="text-xs">
                      {(() => {
                        const duration = (new Date(schedule.endTime).getTime() - new Date(schedule.startTime).getTime()) / (1000 * 60 * 60);
                        return `${duration}h`;
                      })()}
                    </Badge>
                  </div>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <ScheduleModal
        isOpen={showScheduleModal}
        onClose={() => setShowScheduleModal(false)}
      />
    </>
  );
}
