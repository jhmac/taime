import { useMemo } from 'react';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import type { Schedule, User } from '@shared/schema';

interface ConflictDetectorProps {
  schedules: Schedule[];
  users: User[];
}

interface Conflict {
  type: 'overlap' | 'double-booking' | 'overtime' | 'short-break';
  severity: 'warning' | 'error';
  message: string;
  affectedSchedules: Schedule[];
  userId?: string;
}

export default function ScheduleConflictDetector({ schedules, users }: ConflictDetectorProps) {
  const conflicts = useMemo(() => {
    const detectedConflicts: Conflict[] = [];
    
    // Group schedules by user
    const schedulesByUser = schedules.reduce((acc, schedule) => {
      if (!acc[schedule.userId]) acc[schedule.userId] = [];
      acc[schedule.userId].push(schedule);
      return acc;
    }, {} as Record<string, Schedule[]>);

    Object.entries(schedulesByUser).forEach(([userId, userSchedules]) => {
      const user = users.find(u => u.id === userId);
      if (!user) return;

      // Sort schedules by start time
      const sortedSchedules = userSchedules.sort(
        (a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime()
      );

      // Check for overlapping shifts
      for (let i = 0; i < sortedSchedules.length - 1; i++) {
        const current = sortedSchedules[i];
        const next = sortedSchedules[i + 1];
        
        const currentEnd = new Date(current.endTime);
        const nextStart = new Date(next.startTime);
        
        // Overlap detection
        if (currentEnd > nextStart) {
          detectedConflicts.push({
            type: 'overlap',
            severity: 'error',
            message: `${user.firstName} ${user.lastName} has overlapping shifts`,
            affectedSchedules: [current, next],
            userId,
          });
        }
        
        // Short break detection (less than 8 hours between shifts)
        const breakTime = nextStart.getTime() - currentEnd.getTime();
        const hoursBreak = breakTime / (1000 * 60 * 60);
        
        if (hoursBreak > 0 && hoursBreak < 8) {
          detectedConflicts.push({
            type: 'short-break',
            severity: 'warning',
            message: `${user.firstName} ${user.lastName} has only ${hoursBreak.toFixed(1)} hours between shifts`,
            affectedSchedules: [current, next],
            userId,
          });
        }
      }

      // Check for overtime (more than 40 hours per week)
      const weeklyHours = userSchedules.reduce((total, schedule) => {
        const duration = (new Date(schedule.endTime).getTime() - new Date(schedule.startTime).getTime()) / (1000 * 60 * 60);
        return total + duration;
      }, 0);

      if (weeklyHours > 40) {
        detectedConflicts.push({
          type: 'overtime',
          severity: 'warning',
          message: `${user.firstName} ${user.lastName} scheduled for ${weeklyHours.toFixed(1)} hours (overtime)`,
          affectedSchedules: userSchedules,
          userId,
        });
      }

      // Check for double booking (multiple shifts at the same time)
      for (let i = 0; i < sortedSchedules.length; i++) {
        for (let j = i + 1; j < sortedSchedules.length; j++) {
          const shift1 = sortedSchedules[i];
          const shift2 = sortedSchedules[j];
          
          const start1 = new Date(shift1.startTime);
          const end1 = new Date(shift1.endTime);
          const start2 = new Date(shift2.startTime);
          const end2 = new Date(shift2.endTime);
          
          // Check if shifts have exact same time
          if (start1.getTime() === start2.getTime() && end1.getTime() === end2.getTime()) {
            detectedConflicts.push({
              type: 'double-booking',
              severity: 'error',
              message: `${user.firstName} ${user.lastName} has duplicate shifts at the same time`,
              affectedSchedules: [shift1, shift2],
              userId,
            });
          }
        }
      }
    });

    return detectedConflicts;
  }, [schedules, users]);

  if (conflicts.length === 0) {
    return (
      <Alert className="bg-green-50 border-green-200 dark:bg-green-950/20">
        <i className="fas fa-check-circle text-green-600 dark:text-green-400 mr-2"></i>
        <AlertDescription className="text-green-800 dark:text-green-300">
          No scheduling conflicts detected
        </AlertDescription>
      </Alert>
    );
  }

  const errorCount = conflicts.filter(c => c.severity === 'error').length;
  const warningCount = conflicts.filter(c => c.severity === 'warning').length;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <h3 className="text-sm font-medium">Schedule Conflicts</h3>
        {errorCount > 0 && (
          <Badge variant="destructive" className="text-xs">
            {errorCount} Error{errorCount !== 1 ? 's' : ''}
          </Badge>
        )}
        {warningCount > 0 && (
          <Badge variant="secondary" className="text-xs bg-orange-100 text-orange-800">
            {warningCount} Warning{warningCount !== 1 ? 's' : ''}
          </Badge>
        )}
      </div>
      
      <div className="space-y-2">
        {conflicts.map((conflict, index) => (
          <Alert
            key={index}
            className={
              conflict.severity === 'error'
                ? 'bg-red-50 border-red-200 dark:bg-red-950/20'
                : 'bg-orange-50 border-orange-200 dark:bg-orange-950/20'
            }
          >
            <i
              className={`fas ${
                conflict.severity === 'error' ? 'fa-exclamation-triangle' : 'fa-exclamation-circle'
              } ${
                conflict.severity === 'error'
                  ? 'text-red-600 dark:text-red-400'
                  : 'text-orange-600 dark:text-orange-400'
              } mr-2`}
            ></i>
            <AlertDescription
              className={
                conflict.severity === 'error'
                  ? 'text-red-800 dark:text-red-300'
                  : 'text-orange-800 dark:text-orange-300'
              }
            >
              {conflict.message}
            </AlertDescription>
          </Alert>
        ))}
      </div>
    </div>
  );
}