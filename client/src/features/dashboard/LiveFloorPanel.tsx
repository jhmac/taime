import { useQuery } from '@tanstack/react-query';
import { Skeleton } from '@/components/ui/skeleton';
import { ChevronRight } from 'lucide-react';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';
import { useLocation } from 'wouter';

interface Schedule {
  id: string;
  userId: string;
  startTime: string;
  endTime: string;
}

const AVATAR_COLORS = [
  'bg-violet-500', 'bg-sky-500', 'bg-emerald-500', 'bg-amber-500',
  'bg-rose-500', 'bg-indigo-500', 'bg-teal-500', 'bg-orange-500',
];
function avatarColor(uid: string): string {
  let h = 0;
  for (let i = 0; i < uid.length; i++) h = uid.charCodeAt(i) + ((h << 5) - h);
  return AVATAR_COLORS[Math.abs(h) % AVATAR_COLORS.length];
}
function getInitials(firstName: string | null, lastName: string | null) {
  return ((firstName?.[0] ?? '') + (lastName?.[0] ?? '')).toUpperCase() || '?';
}
function fmtT(d: string) { return format(new Date(d), 'h:mm a'); }
function durationLabel(mins: number) {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

interface Props {
  onNavigate?: (path: string) => void;
}

export default function LiveFloorPanel({ onNavigate }: Props) {
  const [, navigate] = useLocation();
  const go = onNavigate ?? navigate;

  const { data: clockedInData, isLoading: clockedInLoading } = useQuery<{
    clockedIn: Array<{
      userId: string; firstName: string | null; lastName: string | null;
      profileImageUrl: string | null; clockInTime: string; minutesOnShift: number;
    }>;
  }>({
    queryKey: ['/api/team-status/clocked-in'],
    refetchInterval: 30_000,
    staleTime: 15_000,
  });

  const { data: upcomingData, isLoading: upcomingLoading } = useQuery<{
    upcomingShifts: Array<{
      scheduleId: string; userId: string; firstName: string | null; lastName: string | null;
      profileImageUrl: string | null; startTime: string; endTime: string;
      minutesUntilShift: number; minutesLate?: number;
    }>;
  }>({
    queryKey: ['/api/team-status/upcoming-shifts'],
    refetchInterval: 60_000,
    staleTime: 30_000,
  });

  const { data: schedulesRaw } = useQuery<Schedule[]>({
    queryKey: ['/api/schedules', 'today'],
    staleTime: 15_000,
    refetchInterval: 30_000,
  });

  if (clockedInLoading || upcomingLoading) {
    return (
      <div className="space-y-2">
        {[1, 2, 3].map((i) => (
          <div key={i} className="flex items-center gap-3 py-2">
            <Skeleton className="w-8 h-8 rounded-full shrink-0" />
            <div className="flex-1 space-y-1.5">
              <Skeleton className="h-3.5 w-24" />
              <Skeleton className="h-3 w-32" />
            </div>
            <Skeleton className="h-5 w-16 rounded-full" />
          </div>
        ))}
      </div>
    );
  }

  const clockedIn = clockedInData?.clockedIn ?? [];
  const upcomingShifts = upcomingData?.upcomingShifts ?? [];
  const schedByUserId = new Map((schedulesRaw ?? []).map((s) => [s.userId, s]));

  const isEmpty = clockedIn.length === 0 && upcomingShifts.length === 0;

  return (
    <div className="space-y-1">
      {isEmpty && (
        <p className="text-sm text-muted-foreground py-3 text-center">No active shifts right now.</p>
      )}

      {clockedIn.map((m) => {
        const sched = schedByUserId.get(m.userId);
        return (
          <div key={m.userId} className="flex items-center gap-3 py-2 px-1.5 rounded-md border-b border-border/40 last:border-0">
            <div className={cn('w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-bold shrink-0 overflow-hidden', avatarColor(m.userId))}>
              {m.profileImageUrl
                ? <img src={m.profileImageUrl} alt="" className="w-full h-full object-cover" />
                : getInitials(m.firstName, m.lastName)}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-foreground truncate">
                {`${m.firstName ?? ''} ${m.lastName ?? ''}`.trim() || 'Employee'}
              </p>
              <p className="text-xs text-muted-foreground">
                Since {fmtT(m.clockInTime)} · {durationLabel(m.minutesOnShift)}
                {sched && <span className="text-muted-foreground/70"> · Until {fmtT(sched.endTime)}</span>}
              </p>
            </div>
            <span className="text-xs font-medium px-2 py-0.5 rounded-full shrink-0 bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400">
              On shift
            </span>
          </div>
        );
      })}

      {upcomingShifts.length > 0 && (
        <>
          {clockedIn.length > 0 && (
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide pt-3 pb-1">
              Coming in today
            </p>
          )}
          {upcomingShifts.slice(0, 4).map((s) => {
            const minsLeft = s.minutesUntilShift;
            const arrivalLabel = minsLeft > 0
              ? `In ${minsLeft < 60 ? `${minsLeft}m` : `${Math.floor(minsLeft / 60)}h ${minsLeft % 60}m`}`
              : 'Starting now';
            return (
              <div key={s.scheduleId} className="flex items-center gap-3 py-2 px-1.5 rounded-md border-b border-border/40 last:border-0">
                <div className={cn('w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-bold shrink-0 overflow-hidden', avatarColor(s.userId))}>
                  {s.profileImageUrl
                    ? <img src={s.profileImageUrl} alt="" className="w-full h-full object-cover" />
                    : getInitials(s.firstName, s.lastName)}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-foreground truncate">
                    {`${s.firstName ?? ''} ${s.lastName ?? ''}`.trim() || 'Employee'}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {fmtT(s.startTime)}–{fmtT(s.endTime)} · {arrivalLabel}
                  </p>
                </div>
                <span className="text-xs font-medium px-2 py-0.5 rounded-full shrink-0 bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400">
                  Scheduled
                </span>
              </div>
            );
          })}
        </>
      )}

      <button
        onClick={() => go('/time')}
        className="text-xs text-blue-600 dark:text-blue-400 hover:underline flex items-center gap-0.5 pt-1"
      >
        All locations <ChevronRight className="h-3 w-3" />
      </button>
    </div>
  );
}
