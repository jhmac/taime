import { useQuery } from '@tanstack/react-query';
import { Skeleton } from '@/components/ui/skeleton';
import { Users, Clock, Calendar, AlertCircle } from 'lucide-react';

interface ClockedInMember {
  userId: string;
  firstName: string | null;
  lastName: string | null;
  profileImageUrl: string | null;
  clockInTime: string;
  minutesOnShift: number;
}

interface UpcomingShift {
  scheduleId: string;
  userId: string;
  firstName: string | null;
  lastName: string | null;
  profileImageUrl: string | null;
  startTime: string;
  endTime: string;
  minutesUntilShift: number;
}

function getInitials(firstName: string | null, lastName: string | null): string {
  const f = firstName?.[0] ?? '';
  const l = lastName?.[0] ?? '';
  return (f + l).toUpperCase() || '?';
}

function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes}m`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

function formatTime(dateStr: string): string {
  return new Date(dateStr).toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}

function Avatar({ firstName, lastName, profileImageUrl, size = 'md' }: {
  firstName: string | null;
  lastName: string | null;
  profileImageUrl: string | null;
  size?: 'sm' | 'md';
}) {
  const initials = getInitials(firstName, lastName);
  const sizeClass = size === 'sm' ? 'w-8 h-8 text-xs' : 'w-9 h-9 text-sm';

  if (profileImageUrl) {
    return (
      <img
        src={profileImageUrl}
        alt={initials}
        className={`${sizeClass} rounded-full object-cover flex-shrink-0`}
      />
    );
  }

  return (
    <div
      className={`${sizeClass} rounded-full flex items-center justify-center flex-shrink-0 font-bold text-white`}
      style={{ background: 'hsl(var(--primary))' }}
    >
      {initials}
    </div>
  );
}

export default function TeamStatusWidget() {
  const {
    data: clockedInData,
    isLoading: clockedInLoading,
    isError: clockedInError,
  } = useQuery<{ clockedIn: ClockedInMember[] }>({
    queryKey: ['/api/team-status/clocked-in'],
    refetchInterval: 60_000,
    staleTime: 30_000,
  });

  const {
    data: upcomingData,
    isLoading: upcomingLoading,
    isError: upcomingError,
  } = useQuery<{ upcomingShifts: UpcomingShift[] }>({
    queryKey: ['/api/team-status/upcoming-shifts'],
    refetchInterval: 120_000,
    staleTime: 60_000,
  });

  const isLoading = clockedInLoading || upcomingLoading;
  const hasError = clockedInError || upcomingError;
  const clockedIn = clockedInData?.clockedIn ?? [];
  const upcomingShifts = upcomingData?.upcomingShifts ?? [];

  if (isLoading) {
    return (
      <div className="rounded-3xl bg-card border border-border p-4 space-y-4">
        <div className="flex items-center gap-2.5">
          <Skeleton className="w-9 h-9 rounded-2xl" />
          <Skeleton className="h-5 w-28" />
        </div>
        <div className="space-y-2.5">
          {[1, 2].map(i => (
            <div key={i} className="flex items-center gap-3">
              <Skeleton className="w-9 h-9 rounded-full" />
              <div className="flex-1 space-y-1.5">
                <Skeleton className="h-3.5 w-24" />
                <Skeleton className="h-3 w-16" />
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (hasError) {
    return (
      <div className="rounded-3xl bg-card border border-border p-4 flex items-center gap-3">
        <div className="w-9 h-9 rounded-2xl flex items-center justify-center flex-shrink-0 bg-destructive/10">
          <AlertCircle className="h-4 w-4 text-destructive" />
        </div>
        <div>
          <p className="text-sm font-bold text-foreground">Team Status unavailable</p>
          <p className="text-xs text-muted-foreground">Could not load team data right now</p>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-3xl bg-card border border-border overflow-hidden">
      <div className="px-4 pt-4 pb-3 flex items-center gap-2.5">
        <div className="w-9 h-9 rounded-2xl flex items-center justify-center flex-shrink-0"
          style={{ background: 'hsl(var(--primary) / 0.12)' }}>
          <Users className="h-4.5 w-4.5 text-primary" style={{ width: '18px', height: '18px' }} />
        </div>
        <h3 className="text-base font-extrabold text-foreground">Team Status</h3>
      </div>

      <div className="border-t border-border" />

      {/* Clocked In Section */}
      <div className="px-4 pt-3 pb-1">
        <div className="flex items-center gap-1.5 mb-2.5">
          <Clock className="h-3.5 w-3.5 text-green-500" />
          <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
            On Shift
            {clockedIn.length > 0 && (
              <span className="ml-1.5 inline-flex items-center justify-center w-4 h-4 rounded-full text-[10px] font-extrabold text-white bg-green-500">
                {clockedIn.length}
              </span>
            )}
          </p>
        </div>

        {clockedIn.length === 0 ? (
          <div className="py-3 text-center">
            <p className="text-sm text-muted-foreground">No teammates on shift right now</p>
          </div>
        ) : (
          <div className="space-y-2.5">
            {clockedIn.map(member => (
              <div key={member.userId} className="flex items-center gap-3">
                <div className="relative flex-shrink-0">
                  <Avatar
                    firstName={member.firstName}
                    lastName={member.lastName}
                    profileImageUrl={member.profileImageUrl}
                  />
                  <span className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-green-500 border-2 border-background" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-bold text-foreground truncate">
                    {[member.firstName, member.lastName].filter(Boolean).join(' ') || 'Team Member'}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Clocked in at {formatTime(member.clockInTime)}
                  </p>
                </div>
                <span className="text-xs font-bold text-green-600 dark:text-green-400 flex-shrink-0 bg-green-500/10 px-2 py-0.5 rounded-full">
                  {formatDuration(member.minutesOnShift)}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="border-t border-border mx-4 my-3" />

      {/* Upcoming Shifts Section */}
      <div className="px-4 pb-4">
        <div className="flex items-center gap-1.5 mb-2.5">
          <Calendar className="h-3.5 w-3.5 text-muted-foreground" />
          <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
            Coming Up Today
            {upcomingShifts.length > 0 && (
              <span className="ml-1.5 inline-flex items-center justify-center w-4 h-4 rounded-full text-[10px] font-extrabold text-muted-foreground bg-muted">
                {upcomingShifts.length}
              </span>
            )}
          </p>
        </div>

        {upcomingShifts.length === 0 ? (
          <div className="py-3 text-center">
            <p className="text-sm text-muted-foreground">No upcoming shifts today</p>
          </div>
        ) : (
          <div className="space-y-2.5">
            {upcomingShifts.map(shift => (
              <div key={shift.scheduleId} className="flex items-center gap-3">
                <Avatar
                  firstName={shift.firstName}
                  lastName={shift.lastName}
                  profileImageUrl={shift.profileImageUrl}
                  size="sm"
                />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-bold text-foreground truncate">
                    {[shift.firstName, shift.lastName].filter(Boolean).join(' ') || 'Team Member'}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Starts at {formatTime(shift.startTime)}
                  </p>
                </div>
                <span className="text-xs font-semibold text-muted-foreground flex-shrink-0 bg-muted px-2 py-0.5 rounded-full">
                  in {formatDuration(shift.minutesUntilShift)}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
