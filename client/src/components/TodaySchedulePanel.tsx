import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Clock, UserCheck, AlertTriangle, Timer, Users, ChevronRight, MapPinOff, X } from 'lucide-react';
import { useLocation } from 'wouter';

interface ScheduleEntry {
  scheduleId: string;
  userId: string;
  userName: string;
  profileImageUrl: string | null;
  startTime: string;
  endTime: string;
  title: string | null;
  isClockedIn: boolean;
  clockInTime: string | null;
  isLate: boolean;
  minutesLate: number;
  minutesUntilShift: number | null;
  shiftPassed: boolean;
  locationBlocked: boolean;
}

interface ClockedInEntry {
  userId: string;
  userName: string;
  profileImageUrl: string | null;
  clockInTime: string;
  hoursWorked: number;
  isLate: boolean;
  minutesLate: number;
}

interface DashboardData {
  schedules: ScheduleEntry[];
  clockedIn: ClockedInEntry[];
  summary: {
    totalScheduled: number;
    totalClockedIn: number;
    totalLate: number;
    totalNotArrived: number;
    totalLocationBlocked: number;
  };
}

function formatTime(dateStr: string) {
  return new Date(dateStr).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
}

function formatCountdown(minutes: number) {
  if (minutes < 60) return `${minutes}m`;
  const hrs = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return mins > 0 ? `${hrs}h ${mins}m` : `${hrs}h`;
}

function formatHours(hours: number) {
  const h = Math.floor(hours);
  const m = Math.round((hours - h) * 60);
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

function UserAvatar({ name, imageUrl, size = 'md' }: { name: string; imageUrl: string | null; size?: 'sm' | 'md' }) {
  const initials = name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase();
  const sizeClass = size === 'sm' ? 'w-8 h-8 text-xs' : 'w-10 h-10 text-sm';
  if (imageUrl) {
    return <img src={imageUrl} alt={name} className={`${sizeClass} rounded-full object-cover`} />;
  }
  return (
    <div className={`${sizeClass} rounded-full bg-primary/10 text-primary font-semibold flex items-center justify-center`}>
      {initials}
    </div>
  );
}

export default function TodaySchedulePanel() {
  const [, navigate] = useLocation();
  const [filterLocationBlocked, setFilterLocationBlocked] = useState(false);

  const { data, isLoading } = useQuery<DashboardData>({
    queryKey: ['/api/dashboard/today'],
    refetchInterval: 30000,
  });

  if (isLoading) {
    return (
      <Card>
        <CardContent className="p-6">
          <div className="animate-pulse space-y-4">
            <div className="h-5 bg-muted rounded w-1/3"></div>
            <div className="space-y-3">
              {[1, 2, 3].map(i => (
                <div key={i} className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-muted rounded-full"></div>
                  <div className="flex-1 space-y-2">
                    <div className="h-4 bg-muted rounded w-2/3"></div>
                    <div className="h-3 bg-muted rounded w-1/2"></div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  const summary = data?.summary;
  const allSchedules = data?.schedules || [];
  const schedules = filterLocationBlocked
    ? allSchedules.filter(e => e.locationBlocked && !e.isClockedIn)
    : allSchedules;
  const clockedIn = data?.clockedIn || [];

  return (
    <div className="space-y-4">
      <Card className="overflow-hidden">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base font-semibold flex items-center gap-2">
              <Clock className="h-4 w-4 text-primary" />
              Today's Schedule
            </CardTitle>
            <button
              onClick={() => navigate('/schedules')}
              className="text-xs text-primary font-medium flex items-center gap-1 hover:underline"
            >
              View all <ChevronRight className="h-3 w-3" />
            </button>
          </div>
          {summary && (
            <div className="flex items-center gap-3 mt-2">
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Users className="h-3.5 w-3.5" />
                <span>{summary.totalScheduled} scheduled</span>
              </div>
              <div className="flex items-center gap-1.5 text-xs text-green-600 dark:text-green-400">
                <UserCheck className="h-3.5 w-3.5" />
                <span>{summary.totalClockedIn} clocked in</span>
              </div>
              {summary.totalLate > 0 && (
                <div className="flex items-center gap-1.5 text-xs text-amber-600 dark:text-amber-400">
                  <AlertTriangle className="h-3.5 w-3.5" />
                  <span>{summary.totalLate} late</span>
                </div>
              )}
              {summary.totalLocationBlocked > 0 && (
                <button
                  onClick={() => setFilterLocationBlocked(f => !f)}
                  className={`flex items-center gap-1.5 text-xs rounded-md px-1.5 py-0.5 transition-colors ${
                    filterLocationBlocked
                      ? 'bg-orange-100 dark:bg-orange-950/40 text-orange-700 dark:text-orange-300 ring-1 ring-orange-300 dark:ring-orange-700'
                      : 'text-orange-500 dark:text-orange-400 hover:bg-orange-50 dark:hover:bg-orange-950/20'
                  }`}
                  title={filterLocationBlocked ? 'Clear filter' : 'Filter to location-blocked employees'}
                >
                  <MapPinOff className="h-3.5 w-3.5" />
                  <span>{summary.totalLocationBlocked} location blocked</span>
                  {filterLocationBlocked && <X className="h-3 w-3 ml-0.5" />}
                </button>
              )}
            </div>
          )}
        </CardHeader>
        <CardContent className="pt-0 px-4 pb-4">
          {filterLocationBlocked && (
            <div className="flex items-center justify-between mb-3 px-3 py-2 rounded-lg bg-orange-50 dark:bg-orange-950/20 border border-orange-200 dark:border-orange-800/40 text-xs text-orange-700 dark:text-orange-300">
              <div className="flex items-center gap-1.5">
                <MapPinOff className="h-3.5 w-3.5" />
                <span>Showing location-blocked employees only</span>
              </div>
              <button
                onClick={() => setFilterLocationBlocked(false)}
                className="flex items-center gap-1 hover:text-orange-900 dark:hover:text-orange-100 transition-colors"
              >
                <X className="h-3.5 w-3.5" />
                Clear
              </button>
            </div>
          )}
          {schedules.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <Clock className="h-10 w-10 mx-auto mb-2 opacity-30" />
              {filterLocationBlocked ? (
                <>
                  <p className="text-sm font-medium">No location-blocked employees</p>
                  <p className="text-xs mt-1">All employees have location access enabled</p>
                </>
              ) : (
                <>
                  <p className="text-sm font-medium">No shifts scheduled today</p>
                  <p className="text-xs mt-1">Head to Schedules to add shifts</p>
                </>
              )}
            </div>
          ) : (
            <div className="space-y-1">
              {schedules.map(entry => (
                <div
                  key={entry.scheduleId}
                  className={`flex items-center gap-3 p-3 rounded-xl transition-colors ${
                    entry.isClockedIn
                      ? 'bg-green-50/80 dark:bg-green-950/20 border border-green-100 dark:border-green-900/30'
                      : entry.shiftPassed && !entry.isClockedIn
                        ? 'bg-red-50/60 dark:bg-red-950/15 border border-red-100 dark:border-red-900/30'
                        : 'bg-muted/30 border border-transparent hover:bg-muted/50'
                  }`}
                >
                  <UserAvatar name={entry.userName} imageUrl={entry.profileImageUrl} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium truncate">{entry.userName}</span>
                      {entry.isLate && (
                        <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4 bg-amber-50 dark:bg-amber-950/30 text-amber-700 dark:text-amber-400 border-amber-200 dark:border-amber-800">
                          {entry.minutesLate}m late
                        </Badge>
                      )}
                      {entry.locationBlocked && !entry.isClockedIn && (
                        <TooltipProvider delayDuration={200}>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span className="inline-flex items-center text-orange-500 dark:text-orange-400 cursor-default">
                                <MapPinOff className="h-3.5 w-3.5" />
                              </span>
                            </TooltipTrigger>
                            <TooltipContent side="top" className="max-w-[200px] text-xs">
                              Location access is blocked on this employee's device. They may need help enabling it before they can clock in.
                            </TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                      )}
                    </div>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="text-xs text-muted-foreground">
                        {formatTime(entry.startTime)} – {formatTime(entry.endTime)}
                      </span>
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    {entry.isClockedIn ? (
                      <div>
                        <Badge className="bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-400 border-0 text-[10px] px-1.5 h-5">
                          <span className="w-1.5 h-1.5 rounded-full bg-green-500 mr-1 animate-pulse"></span>
                          Active
                        </Badge>
                        {entry.clockInTime && (
                          <p className="text-[10px] text-green-600/70 dark:text-green-400/60 mt-0.5">
                            In at {formatTime(entry.clockInTime)}
                          </p>
                        )}
                      </div>
                    ) : entry.minutesUntilShift != null ? (
                      <div className="text-right">
                        <div className="flex items-center gap-1 text-xs text-muted-foreground">
                          <Timer className="h-3 w-3" />
                          <span className="font-medium">{formatCountdown(entry.minutesUntilShift)}</span>
                        </div>
                        <p className="text-[10px] text-muted-foreground/70 mt-0.5">until shift</p>
                      </div>
                    ) : entry.shiftPassed ? (
                      <Badge variant="outline" className="text-[10px] px-1.5 h-5 bg-red-50 dark:bg-red-950/30 text-red-600 dark:text-red-400 border-red-200 dark:border-red-800">
                        Not arrived
                      </Badge>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {clockedIn.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-semibold flex items-center gap-2">
              <UserCheck className="h-4 w-4 text-green-600 dark:text-green-400" />
              Currently Clocked In
              <Badge className="bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-400 border-0 ml-auto text-xs">
                {clockedIn.length}
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0 px-4 pb-4">
            <div className="space-y-1">
              {clockedIn.map(entry => (
                <div key={entry.userId} className="flex items-center gap-3 p-2.5 rounded-lg hover:bg-muted/30 transition-colors">
                  <div className="relative">
                    <UserAvatar name={entry.userName} imageUrl={entry.profileImageUrl} size="sm" />
                    <span className="absolute -bottom-0.5 -right-0.5 w-3 h-3 bg-green-500 border-2 border-background rounded-full"></span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <span className="text-sm font-medium truncate block">{entry.userName}</span>
                    <span className="text-xs text-muted-foreground">
                      In at {formatTime(entry.clockInTime)}
                      {entry.isLate && (
                        <span className="text-amber-600 dark:text-amber-400 ml-1.5">
                          • {entry.minutesLate}m late
                        </span>
                      )}
                    </span>
                  </div>
                  <div className="text-right">
                    <span className="text-sm font-semibold text-green-700 dark:text-green-400">
                      {formatHours(entry.hoursWorked)}
                    </span>
                    <p className="text-[10px] text-muted-foreground">worked</p>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
