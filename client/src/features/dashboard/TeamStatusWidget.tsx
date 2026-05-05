import { useState, useEffect, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useUser } from '@clerk/clerk-react';
import { Skeleton } from '@/components/ui/skeleton';
import { AlertTriangle, CalendarDays, MapPinOff, Users, X } from 'lucide-react';
import ErrorWithRetry from '@/components/ErrorWithRetry';
import { useOnlineRetry } from '@/hooks/useOnlineRetry';
import { readShopifyConnectionCache, writeShopifyConnectionCache } from '@/lib/shopifyConnectionCache';
import { useWebSocketContext } from '@/contexts/WebSocketContext';

interface ShopifyData {
  connected?: boolean;
  todayRevenue?: number;
  orderCount?: number;
}

interface HoursStats {
  todayHours: number;
  weekHours: number;
  periodHours?: number;
  estimatedPay?: number;
  hourlyRate?: number;
}

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
  minutesLate?: number;
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

interface ScheduleEntry {
  userId: string;
  locationBlocked: boolean;
  isClockedIn: boolean;
}

export default function TeamStatusWidget({ hoursStats }: { hoursStats?: HoursStats } = {}) {
  const [filterLocationBlocked, setFilterLocationBlocked] = useState(false);
  const [filterLate, setFilterLate] = useState(false);
  const { user: clerkUser } = useUser();
  const queryClient = useQueryClient();

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

  const { data: usersData } = useQuery<any[]>({
    queryKey: ['/api/users'],
    staleTime: 300_000,
  });

  const { data: todayData } = useQuery<{
    schedules: ScheduleEntry[];
    summary: { totalLocationBlocked: number };
  }>({
    queryKey: ['/api/dashboard/today'],
    refetchInterval: 60_000,
    staleTime: 30_000,
  });

  const { data: shopifyData, isLoading: shopifyLoading } = useQuery<ShopifyData>({
    queryKey: ['/api/shopify/sales-data'],
    staleTime: 60_000,
  });

  const { data: availabilitySummary } = useQuery<{ availableCount: number; totalCount: number }>({
    queryKey: ['/api/availability/today/summary'],
    refetchInterval: 60_000,
    staleTime: 30_000,
    enabled: !!hoursStats,
    retry: false,
  });

  const shopifyCacheKey = clerkUser?.id ? `shopify_connected:${clerkUser.id}` : null;
  const cachedShopifyConnected = readShopifyConnectionCache(shopifyCacheKey);

  useEffect(() => {
    if (shopifyCacheKey && shopifyData !== undefined) {
      writeShopifyConnectionCache(shopifyCacheKey, shopifyData.connected === true);
    }
  }, [shopifyData, shopifyCacheKey]);

  // Instant refetch when any clock-in or clock-out event arrives over WebSocket
  // so the "Today" list updates immediately instead of waiting 60 s.
  const { lastMessage } = useWebSocketContext();
  const lastMessageIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (!lastMessage) return;
    const msgId = (lastMessage as any).id ?? JSON.stringify(lastMessage);
    if (msgId === lastMessageIdRef.current) return;
    lastMessageIdRef.current = msgId;
    if (
      lastMessage.type === 'time_entry_created' ||
      lastMessage.type === 'time_entry_updated'
    ) {
      refetchClockedIn();
      refetchUpcoming();
      queryClient.invalidateQueries({ queryKey: ['/api/schedules'] });
    }
  }, [lastMessage, refetchClockedIn, refetchUpcoming, queryClient]);

  const totalLocationBlocked = todayData?.summary?.totalLocationBlocked ?? 0;

  const blockedUserIds = new Set(
    (todayData?.schedules ?? [])
      .filter(s => s.locationBlocked && !s.isClockedIn)
      .map(s => s.userId)
  );

  const isLoading = clockedInLoading || upcomingLoading;
  const hasError = clockedInError || upcomingError;

  useOnlineRetry(() => {
    refetchClockedIn();
    refetchUpcoming();
  }, hasError);

  const clockedIn = clockedInData?.clockedIn ?? [];
  const upcomingShifts = upcomingData?.upcomingShifts ?? [];

  const todayStr = new Date().toDateString();
  const now = Date.now();

  const userById = new Map<string, { firstName: string | null; lastName: string | null; profileImageUrl: string | null }>(
    (usersData || []).map((u: any) => [u.id, { firstName: u.firstName ?? null, lastName: u.lastName ?? null, profileImageUrl: u.profileImageUrl ?? null }])
  );

  const todaySchedules: any[] = (schedulesRaw || []).filter(
    (s: any) => s.startTime && new Date(s.startTime).toDateString() === todayStr
  );

  const clockedInByUserId = new Map(clockedIn.map(m => [m.userId, m]));
  const upcomingByUserId = new Map(upcomingShifts.map(s => [s.userId, s]));

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
        const userInfo = userById.get(sched.userId);
        const shift: UpcomingShift = upcomingShift ?? {
          scheduleId: sched.id || sched.scheduleId || sched.userId,
          userId: sched.userId,
          firstName: userInfo?.firstName ?? sched.firstName ?? sched.user?.firstName ?? null,
          lastName: userInfo?.lastName ?? sched.lastName ?? sched.user?.lastName ?? null,
          profileImageUrl: userInfo?.profileImageUrl ?? sched.profileImageUrl ?? sched.user?.profileImageUrl ?? null,
          startTime: sched.startTime,
          endTime: sched.endTime,
          minutesUntilShift: Math.round((schedStart - now) / 60000),
        };
        combined.push({ kind: 'upcoming', shift, sortTime: schedStart });
      } else {
        const userInfo = userById.get(sched.userId);
        combined.push({
          kind: 'absent',
          userId: sched.userId,
          firstName: userInfo?.firstName ?? upcomingShift?.firstName ?? sched.firstName ?? sched.user?.firstName ?? null,
          lastName: userInfo?.lastName ?? upcomingShift?.lastName ?? sched.lastName ?? sched.user?.lastName ?? null,
          profileImageUrl: userInfo?.profileImageUrl ?? upcomingShift?.profileImageUrl ?? sched.profileImageUrl ?? null,
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
        const shiftStart = new Date(s.startTime).getTime();
        if (shiftStart > now) {
          combined.push({ kind: 'upcoming', shift: s, sortTime: shiftStart });
        } else {
          combined.push({
            kind: 'absent',
            userId: s.userId,
            firstName: s.firstName,
            lastName: s.lastName,
            profileImageUrl: s.profileImageUrl,
            scheduledStart: s.startTime,
            scheduledEnd: s.endTime,
            sortTime: shiftStart,
          });
        }
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
      const shiftStart = new Date(s.startTime).getTime();
      if (shiftStart > now) {
        combined.push({ kind: 'upcoming', shift: s, sortTime: shiftStart });
      } else {
        combined.push({
          kind: 'absent',
          userId: s.userId,
          firstName: s.firstName,
          lastName: s.lastName,
          profileImageUrl: s.profileImageUrl,
          scheduledStart: s.startTime,
          scheduledEnd: s.endTime,
          sortTime: shiftStart,
        });
      }
    }
  }

  combined.sort((a, b) => a.sortTime - b.sortTime);

  const totalLate = combined.filter(e => e.kind === 'on-shift' && e.lateMins > 0).length;

  const displayEntries = filterLocationBlocked
    ? combined.filter(entry => {
        const uid = entry.kind === 'on-shift' ? entry.member.userId
          : entry.kind === 'upcoming' ? entry.shift.userId
          : entry.userId;
        return blockedUserIds.has(uid);
      })
    : filterLate
      ? combined.filter((e): e is OnShiftEntry => e.kind === 'on-shift' && e.lateMins > 0)
      : combined;

  const hasShopify = shopifyData?.connected === true;
  const showRevenueColumn = hasShopify || (shopifyLoading && cachedShopifyConnected);

  return (
    <div className="rounded-3xl bg-card border border-border overflow-hidden">
      {/* Header */}
      <div className="px-4 pt-4 pb-3">
        {hoursStats ? (
          <div className="flex items-center gap-2 overflow-x-auto flex-nowrap">
            <CalendarDays className="h-4 w-4 text-primary shrink-0" />
            <span className="text-sm font-semibold shrink-0">Today</span>
            <span className="text-sm font-bold tabular-nums shrink-0">{hoursStats.todayHours.toFixed(1)} hrs</span>
            <span className="text-muted-foreground/40 shrink-0 text-xs">|</span>
            <span className="text-xs text-muted-foreground shrink-0">This week</span>
            <span className="text-xs font-bold tabular-nums shrink-0">{hoursStats.weekHours.toFixed(1)} hrs</span>
            {hoursStats.periodHours !== undefined && (
              <>
                <span className="text-muted-foreground/40 shrink-0 text-xs">|</span>
                <span className="text-xs text-muted-foreground shrink-0">This Period</span>
                <span className="text-xs font-bold tabular-nums shrink-0">{hoursStats.periodHours.toFixed(1)} hrs</span>
              </>
            )}
            {hoursStats.estimatedPay !== undefined && (hoursStats.hourlyRate ?? 0) > 0 && (
              <>
                <span className="text-muted-foreground/40 shrink-0 text-xs">|</span>
                <span className="text-xs text-muted-foreground shrink-0">Estimated Pay</span>
                <span className="text-xs font-bold tabular-nums text-green-600 dark:text-green-400 shrink-0">${hoursStats.estimatedPay.toFixed(2)}</span>
              </>
            )}
            {availabilitySummary && (
              <>
                <span className="text-muted-foreground/40 shrink-0 text-xs">|</span>
                <Users className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                <span className="text-xs font-bold tabular-nums shrink-0">{availabilitySummary.availableCount}</span>
                <span className="text-xs text-muted-foreground shrink-0">available</span>
              </>
            )}
          </div>
        ) : (
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-2xl flex items-center justify-center flex-shrink-0"
              style={{ background: 'hsl(var(--primary) / 0.12)' }}>
              <CalendarDays className="h-4.5 w-4.5 text-primary" style={{ width: '18px', height: '18px' }} />
            </div>
            <h3 className="text-base font-extrabold text-foreground">Today</h3>
          </div>
        )}
        {(totalLate > 0 || totalLocationBlocked > 0) && (
          <div className="flex items-center gap-2 mt-2 ml-0.5 flex-wrap">
            {totalLate > 0 && (
              <button
                onClick={() => { setFilterLate(f => !f); setFilterLocationBlocked(false); }}
                className={`flex items-center gap-1.5 text-xs rounded-md px-1.5 py-0.5 transition-colors ${
                  filterLate
                    ? 'bg-amber-100 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 ring-1 ring-amber-300 dark:ring-amber-700'
                    : 'text-amber-600 dark:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-950/20'
                }`}
                title={filterLate ? 'Clear filter' : 'Filter to late employees'}
              >
                <AlertTriangle className="h-3.5 w-3.5" />
                <span>{totalLate} late</span>
                {filterLate && <X className="h-3 w-3 ml-0.5" />}
              </button>
            )}
            {totalLocationBlocked > 0 && (
              <button
                onClick={() => { setFilterLocationBlocked(f => !f); setFilterLate(false); }}
                className={`flex items-center gap-1.5 text-xs rounded-md px-1.5 py-0.5 transition-colors ${
                  filterLocationBlocked
                    ? 'bg-orange-100 dark:bg-orange-950/40 text-orange-700 dark:text-orange-300 ring-1 ring-orange-300 dark:ring-orange-700'
                    : 'text-orange-500 dark:text-orange-400 hover:bg-orange-50 dark:hover:bg-orange-950/20'
                }`}
                title={filterLocationBlocked ? 'Clear filter' : 'Filter to location-blocked employees'}
              >
                <MapPinOff className="h-3.5 w-3.5" />
                <span>{totalLocationBlocked} location blocked</span>
                {filterLocationBlocked && <X className="h-3 w-3 ml-0.5" />}
              </button>
            )}
          </div>
        )}
      </div>

      <div className="border-t border-border" />

      {/* Body: 1/6 revenue + divider + 5/6 shifts when Shopify access exists; full-width shifts otherwise */}
      <div className="px-4 py-3">
        <div className="flex gap-3 items-start">
          {/* Revenue column — only rendered when Shopify is confirmed connected */}
          {showRevenueColumn && (
            <>
              <div className="w-1/6 shrink-0">
                {shopifyLoading ? (
                  <div className="space-y-1.5">
                    <Skeleton className="h-6 w-full" />
                    <Skeleton className="h-3 w-3/4" />
                  </div>
                ) : (
                  <div>
                    <p className="text-xl font-bold text-green-600 leading-tight break-words">
                      ${Number(shopifyData!.todayRevenue || 0).toFixed(0)}
                    </p>
                    <p className="text-[10px] text-muted-foreground leading-tight mt-0.5">Today's Revenue</p>
                    {shopifyData!.orderCount !== undefined && (
                      <p className="text-[10px] text-muted-foreground mt-1">{shopifyData!.orderCount} orders</p>
                    )}
                  </div>
                )}
              </div>

              {/* Vertical divider */}
              <div className="w-px self-stretch bg-border shrink-0" />
            </>
          )}

          {/* Shifts column — full-width when no Shopify, 5/6 wide when Shopify exists */}
          <div className="flex-1 min-w-0">
            {filterLate && (
              <div className="flex items-center justify-between mb-3 px-3 py-2 rounded-lg bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800/40 text-xs text-amber-700 dark:text-amber-300">
                <div className="flex items-center gap-1.5">
                  <AlertTriangle className="h-3.5 w-3.5" />
                  <span>Showing late employees only</span>
                </div>
                <button
                  onClick={() => setFilterLate(false)}
                  className="flex items-center gap-1 hover:text-amber-900 dark:hover:text-amber-100 transition-colors"
                >
                  <X className="h-3.5 w-3.5" />
                  Clear
                </button>
              </div>
            )}
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
            {displayEntries.length === 0 ? (
              <div className="py-4 text-center">
                {filterLate ? (
                  <p className="text-sm text-muted-foreground font-medium">No late employees</p>
                ) : filterLocationBlocked ? (
                  <>
                    <p className="text-sm text-muted-foreground font-medium">No location-blocked employees</p>
                    <p className="text-xs text-muted-foreground mt-1">All employees have location access enabled</p>
                  </>
                ) : (
                  <p className="text-sm text-muted-foreground">No shifts scheduled today</p>
                )}
              </div>
            ) : (
              <div className="space-y-2.5">
                {displayEntries.map((entry, i) => {
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
      </div>
    </div>
  );
}
