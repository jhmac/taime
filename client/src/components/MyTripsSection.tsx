import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/hooks/useAuth';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Route, Clock, AlertTriangle, MapPin } from 'lucide-react';
import TripMapModal from '@/components/TripMapModal';

interface MyTripsSectionProps {
  /** Optional: when set, only renders the trips list (caller already shows trips-remaining elsewhere). */
  hideTripsRemaining?: boolean;
  /** Trips-remaining counter data. When omitted, the section won't show the counter. */
  todayTripCounts?: Record<string, number>;
  activeRules?: Array<{ id: string; name: string; maxTripsPerDay?: number | null }>;
  /** Limit number of trips listed. Defaults to 5. */
  limit?: number;
  /** Optional wrapper className applied only when the section has content. Useful for parent borders/spacing. */
  wrapperClassName?: string;
}

function formatDuration(minutes: number | null | undefined) {
  if (minutes == null) return '—';
  if (minutes < 60) return `${minutes}m`;
  const h = Math.floor(minutes / 60);
  const rem = minutes % 60;
  return rem > 0 ? `${h}h ${rem}m` : `${h}h`;
}

function formatDate(dateStr: string | null | undefined) {
  if (!dateStr) return '—';
  const d = new Date(dateStr);
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  const isYesterday = d.toDateString() === yesterday.toDateString();
  if (sameDay) return `Today ${d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`;
  if (isYesterday) return `Yesterday ${d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export default function MyTripsSection({
  hideTripsRemaining = false,
  todayTripCounts,
  activeRules,
  limit = 5,
  wrapperClassName,
}: MyTripsSectionProps = {}) {
  const { user } = useAuth();
  const userId = user?.id;
  const [selectedTripId, setSelectedTripId] = useState<string | null>(null);

  const { data: trips = [], isLoading } = useQuery<any[]>({
    queryKey: ['/api/offsite-sessions/employee', userId],
    queryFn: async () => {
      const res = await fetch(`/api/offsite-sessions/employee/${userId}`, { credentials: 'include' });
      if (!res.ok) return [];
      return res.json();
    },
    enabled: !!userId,
    refetchInterval: 60000,
  });

  const completedTrips = trips
    .filter((t: any) => t.status !== 'active')
    .sort((a: any, b: any) => new Date(b.exitTime || 0).getTime() - new Date(a.exitTime || 0).getTime())
    .slice(0, limit);

  // Build "trips remaining today" rows for any active rule with a daily limit configured
  const remainingRows = !hideTripsRemaining && activeRules && todayTripCounts
    ? activeRules
        .filter((r: any) => r.maxTripsPerDay != null && r.maxTripsPerDay > 0)
        .map((r: any) => {
          const used = todayTripCounts[r.id] ?? 0;
          const remaining = Math.max(0, r.maxTripsPerDay - used);
          return { id: r.id, name: r.name, used, max: r.maxTripsPerDay, remaining };
        })
    : [];

  // Don't render anything if there are no trips and no remaining-trip rows
  if (!isLoading && completedTrips.length === 0 && remainingRows.length === 0) {
    return null;
  }

  return (
    <div className={`space-y-3 ${wrapperClassName ?? ''}`} data-testid="my-trips-section">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-bold text-foreground flex items-center gap-1.5">
          <Route className="w-4 h-4 text-blue-600" />
          My Trips
        </h3>
        {completedTrips.length > 0 && (
          <span className="text-xs text-muted-foreground">Last {completedTrips.length}</span>
        )}
      </div>

      {remainingRows.length > 0 && (
        <div className="space-y-1.5" data-testid="trips-remaining-counter">
          {remainingRows.map((row) => {
            const exhausted = row.remaining === 0;
            return (
              <div
                key={row.id}
                className={`flex items-center justify-between text-xs rounded-xl px-3 py-2 border ${
                  exhausted
                    ? 'bg-destructive/5 border-destructive/30 text-destructive'
                    : 'bg-blue-50 dark:bg-blue-950/20 border-blue-200 dark:border-blue-900 text-blue-700 dark:text-blue-300'
                }`}
              >
                <div className="flex items-center gap-1.5 min-w-0">
                  <Route className="w-3.5 h-3.5 flex-shrink-0" />
                  <span className="font-medium truncate">{row.name}</span>
                </div>
                <span className="font-semibold whitespace-nowrap ml-2">
                  {exhausted ? 'Daily limit reached' : `${row.remaining} of ${row.max} left today`}
                </span>
              </div>
            );
          })}
        </div>
      )}

      {isLoading ? (
        <div className="space-y-2">
          <Skeleton className="h-14 w-full rounded-xl" />
          <Skeleton className="h-14 w-full rounded-xl" />
        </div>
      ) : completedTrips.length === 0 ? (
        <p className="text-xs text-muted-foreground text-center py-3">
          No off-site trips yet.
        </p>
      ) : (
        <div className="space-y-2">
          {completedTrips.map((trip: any) => {
            const deviationCount = trip.deviationEventCount ?? 0;
            const autoEnded = trip.status === 'auto_clocked_out' || trip.clockedOutOffRoute;
            const distMiles = trip.totalDistanceMiles ? parseFloat(String(trip.totalDistanceMiles)) : null;
            return (
              <button
                key={trip.id}
                type="button"
                onClick={() => setSelectedTripId(trip.id)}
                className="w-full text-left rounded-xl border border-border bg-card hover:bg-muted/50 transition-colors p-3"
                data-testid={`my-trip-${trip.id}`}
              >
                <div className="flex items-start justify-between gap-2 mb-1.5">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-sm font-semibold truncate">
                      {formatDate(trip.exitTime)}
                    </span>
                    {autoEnded && (
                      <Badge
                        variant="outline"
                        className="text-[10px] py-0 h-4 border-red-300 text-red-700 bg-red-50 dark:bg-red-950/30 dark:text-red-300"
                      >
                        Auto-ended
                      </Badge>
                    )}
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 text-xs text-blue-700 dark:text-blue-300 hover:bg-blue-50 dark:hover:bg-blue-950/30 flex-shrink-0"
                    onClick={(e) => {
                      e.stopPropagation();
                      setSelectedTripId(trip.id);
                    }}
                    data-testid={`view-trip-map-${trip.id}`}
                  >
                    <MapPin className="w-3.5 h-3.5 mr-1" />
                    Map
                  </Button>
                </div>
                <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                  <span className="flex items-center gap-1">
                    <Clock className="w-3 h-3" />
                    {formatDuration(trip.durationMinutes)}
                  </span>
                  <span className="flex items-center gap-1">
                    <Route className="w-3 h-3" />
                    {distMiles != null ? `${distMiles.toFixed(1)} mi` : '—'}
                  </span>
                  {deviationCount > 0 && (
                    <span
                      className="flex items-center gap-1 text-amber-700 dark:text-amber-400 font-medium"
                      data-testid={`trip-deviations-${trip.id}`}
                    >
                      <AlertTriangle className="w-3 h-3" />
                      {deviationCount} deviation{deviationCount !== 1 ? 's' : ''}
                    </span>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      )}

      <TripMapModal sessionId={selectedTripId} onClose={() => setSelectedTripId(null)} />
    </div>
  );
}
