import { useQuery } from '@tanstack/react-query';
import { Skeleton } from '@/components/ui/skeleton';
import { CalendarDays, MapPinOff } from 'lucide-react';
import ErrorWithRetry from '@/components/ErrorWithRetry';

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
    refetch: refetchClockedIn,
  } = useQuery<{ clockedIn: ClockedInMember[] }>({
    queryKey: ['/api/team-status/clocked-in'],
    refetchInterval: 60_000,
    staleTime: 30_000,
  });

  const {
    data: upcomingData,
    isLoading: upcomingLoading,
    isError: upcomingError,
    refetch: refetchUpcoming,
  } = useQuery<{ upcomingShifts: UpcomingShift[] }>({
    queryKey: ['/api/team-status/upcoming-shifts'],
    refetchInterval: 120_000,
    staleTime: 60_000,
  });

  const { data: schedulesRaw } = useQuery<any[]>({
    queryKey: ['/api/schedules'],
    staleTime: 120_000,
  });

  const { data: todayData } = useQuery<{
    summary: { totalLocationBlocked: number };
  }>({
    queryKey: ['/api/dashboard/today'],
    refetchInterval: 60_000,
    staleTime: 30_000,
  });

  const totalLocationBlocked = todayData?.summary?.totalLocationBlocked ?? 0;

  const isLoading = clockedInLoading || upcomingLoading;
  const hasError = clockedInError || upcomingError;
  const clockedIn = clockedInData?.clockedIn ?? [];
  const upcomingShifts = upcomingData?.upcomingShifts ?? [];

  const todayStr = new Date().toDateString();
  const now = Date.now();

  const todaySchedules: any[] = (schedulesRaw || []).filter(
    (s: any) => s.startTime && new Date(s.startTime).toDateString() === todayStr
  );

  const clockedInByUserId = new Map(clockedIn.map(m => [m.userId, m]));
  const upcomingByUserId = new Map(upcomingShifts.map(s => [s.userId, s]));
  const scheduledUserIds = new Set(todaySchedules.map((s: any) => s.userId));

  const getLateMins = (clockInTime: string, scheduledStart: string): number => {
    const diffMs = new Date(clockInTime).getTime() - new Date(scheduledStart).getTime();
    const diffMin = diffMs / 60000;
    return diffMin > 5 ? Math.round(diffMin) : 0;
  };

  if (isLoading) {
    return (
      <div className="rounded-3xl bg-card border border-border p-4 space-y-4">
        <div className="flex items-center gap-2.5">
          <Skeleton className="w-9 h-9 rounded-2xl" />
          <Skeleton className="h-5 w-28" />
        </div>
        <div className="space-y-2.5">
          {[1, 2, 3].map(i => (
            <div key={i} className="flex items-center gap-3">
              <Skeleton className="w-9 h-9 rounded-full" />
              <div className="flex-1 space-y-1.5">
                <Skeleton className="h-3.5 w-24" />
                <Skeleton className="h-3 w-32" />
              </div>
              <Skeleton className="h-5 w-14 rounded-full" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (hasError) {
    return (
      <div className="rounded-3xl bg-card border border-border p-4">
        <ErrorWithRetry
          onRetry={() => { refetchClockedIn(); refetchUpcoming(); }}
          message="Could not load team status"
        />
      </div>
    );
  }

  type OnShiftEntry = {
    kind: 'on-shift';
    member: ClockedInMember;
    scheduledStart: string | null;
    lateMins: number;
    sortTime: number;
  };
  type UpcomingEntry = { kind: 'upcoming'; shift: UpcomingShift; sortTime: number };
  type AbsentEntry = {
    kind: 'absent';
    userId: string;
    firstName: string | null;
    lastName: string | null;
    profileImageUrl: string | null;
    scheduledStart: string;
    scheduledEnd: string;
    sortTime: number;
  };
  type CombinedEntry = OnShiftEntry | UpcomingEntry | AbsentEntry;

  const combined: CombinedEntry[] = [];
  const processedUserIds = new Set<string>();

  if (todaySchedules.length > 0) {
    for (const sched of todaySchedules) {
      const schedStart = new Date(sched.startTime).getTime();
      const member = clockedInByUserId.get(sched.userId);
      const upcomingShift = upcomingByUserId.get(sched.userId);
      processedUserIds.add(sched.userId);

      if (member) {
        const lateMins = getLateMins(member.clockInTime, sched.startTime);
        combined.push({
          kind: 'on-shift',
          member,
          scheduledStart: sched.startTime,
          lateMins,
          sortTime: schedStart,
        });
      } else if (schedStart > now) {
        const shift: UpcomingShift = upcomingShift ?? {
          scheduleId: sched.id || sched.scheduleId || sched.userId,
          userId: sched.userId,
          firstName: sched.firstName ?? sched.user?.firstName ?? null,
          lastName: sched.lastName ?? sched.user?.lastName ?? null,
          profileImageUrl: sched.profileImageUrl ?? sched.user?.profileImageUrl ?? null,
          startTime: sched.startTime,
          endTime: sched.endTime,
          minutesUntilShift: Math.round((schedStart - now) / 60000),
        };
        combined.push({ kind: 'upcoming', shift, sortTime: schedStart });
      } else {
        combined.push({
          kind: 'absent',
          userId: sched.userId,
          firstName: sched.firstName ?? sched.user?.firstName ?? null,
          lastName: sched.lastName ?? sched.user?.lastName ?? null,
          profileImageUrl: sched.profileImageUrl ?? null,
          scheduledStart: sched.startTime,
          scheduledEnd: sched.endTime,
          sortTime: schedStart,
        });
      }
    }

    for (const m of clockedIn) {
      if (!processedUserIds.has(m.userId)) {
        combined.push({
          kind: 'on-shift',
          member: m,
          scheduledStart: null,
          lateMins: 0,
          sortTime: new Date(m.clockInTime).getTime(),
        });
      }
    }

    for (const s of upcomingShifts) {
      if (!processedUserIds.has(s.userId)) {
        combined.push({
          kind: 'upcoming',
          shift: s,
          sortTime: new Date(s.startTime).getTime(),
        });
      }
    }
  } else {
    for (const m of clockedIn) {
      combined.push({
        kind: 'on-shift',
        member: m,
        scheduledStart: null,
        lateMins: 0,
        sortTime: new Date(m.clockInTime).getTime(),
      });
    }
    for (const s of upcomingShifts) {
      combined.push({
        kind: 'upcoming',
        shift: s,
        sortTime: new Date(s.startTime).getTime(),
      });
    }
  }

  combined.sort((a, b) => a.sortTime - b.sortTime);

  return (
    <div className="rounded-3xl bg-card border border-border overflow-hidden">
      <div className="px-4 pt-4 pb-3">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-2xl flex items-center justify-center flex-shrink-0"
            style={{ background: 'hsl(var(--primary) / 0.12)' }}>
            <CalendarDays className="h-4.5 w-4.5 text-primary" style={{ width: '18px', height: '18px' }} />
          </div>
          <h3 className="text-base font-extrabold text-foreground">Today</h3>
        </div>
        {totalLocationBlocked > 0 && (
          <div className="flex items-center gap-1.5 mt-2 ml-0.5 text-xs text-orange-500 dark:text-orange-400">
            <MapPinOff className="h-3.5 w-3.5" />
            <span>{totalLocationBlocked} location blocked</span>
          </div>
        )}
      </div>

      <div className="border-t border-border" />

      <div className="px-4 py-3">
        {combined.length === 0 ? (
          <div className="py-4 text-center">
            <p className="text-sm text-muted-foreground">No shifts scheduled today</p>
          </div>
        ) : (
          <div className="space-y-2.5">
            {combined.map((entry, i) => {
              if (entry.kind === 'on-shift') {
                const m = entry.member;
                const fullName = [m.firstName, m.lastName].filter(Boolean).join(' ') || 'Team Member';
                return (
                  <div key={`on-${m.userId}-${i}`} className="flex items-center gap-3">
                    <div className="relative flex-shrink-0">
                      <Avatar firstName={m.firstName} lastName={m.lastName} profileImageUrl={m.profileImageUrl} />
                      <span className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-green-500 border-2 border-background" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-bold text-foreground truncate">{fullName}</p>
                      <p className="text-xs text-muted-foreground">
                        {entry.scheduledStart ? (
                          <>sched {formatTime(entry.scheduledStart)} &bull; in {formatTime(m.clockInTime)}</>
                        ) : (
                          <>Clocked in at {formatTime(m.clockInTime)}</>
                        )}
                      </p>
                    </div>
                    <div className="flex items-center gap-1 flex-shrink-0">
                      {entry.lateMins > 0 && (
                        <span className="text-xs font-bold text-red-600 dark:text-red-400 bg-red-500/10 px-1.5 py-0.5 rounded-full">
                          {entry.lateMins}m late
                        </span>
                      )}
                      <span className="text-xs font-bold text-green-600 dark:text-green-400 bg-green-500/10 px-2 py-0.5 rounded-full">
                        On shift
                      </span>
                    </div>
                  </div>
                );
              } else if (entry.kind === 'upcoming') {
                const s = entry.shift;
                const fullName = [s.firstName, s.lastName].filter(Boolean).join(' ') || 'Team Member';
                return (
                  <div key={`up-${s.scheduleId}-${i}`} className="flex items-center gap-3">
                    <Avatar firstName={s.firstName} lastName={s.lastName} profileImageUrl={s.profileImageUrl} size="sm" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-bold text-foreground truncate">{fullName}</p>
                      <p className="text-xs text-muted-foreground">
                        {formatTime(s.startTime)} – {formatTime(s.endTime)}
                      </p>
                    </div>
                    <span className="text-xs font-semibold text-muted-foreground flex-shrink-0 bg-muted px-2 py-0.5 rounded-full">
                      Upcoming
                    </span>
                  </div>
                );
              } else {
                const fullName = [entry.firstName, entry.lastName].filter(Boolean).join(' ') || 'Team Member';
                return (
                  <div key={`ab-${entry.userId}-${i}`} className="flex items-center gap-3">
                    <div className="relative flex-shrink-0">
                      <Avatar firstName={entry.firstName} lastName={entry.lastName} profileImageUrl={entry.profileImageUrl} size="sm" />
                      <span className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-amber-400 border-2 border-background" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-bold text-foreground truncate">{fullName}</p>
                      <p className="text-xs text-muted-foreground">
                        sched {formatTime(entry.scheduledStart)}
                      </p>
                    </div>
                    <span className="text-xs font-semibold text-amber-600 dark:text-amber-400 flex-shrink-0 bg-amber-400/10 px-2 py-0.5 rounded-full">
                      Not In
                    </span>
                  </div>
                );
              }
            })}
          </div>
        )}
      </div>
    </div>
  );
}
