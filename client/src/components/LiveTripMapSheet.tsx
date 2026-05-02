import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Separator } from '@/components/ui/separator';
import { useGeolocation } from '@/hooks/useGeolocation';
import { CheckCircle2, MapPin, Navigation, RefreshCw, Route, AlertTriangle } from 'lucide-react';

interface LiveTripMapSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sessionId: string | null;
}

const REFRESH_INTERVAL_MS = 30000;

function formatTime(dateStr: string | null | undefined) {
  if (!dateStr) return null;
  return new Date(dateStr).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

export default function LiveTripMapSheet({ open, onOpenChange, sessionId }: LiveTripMapSheetProps) {
  const [refreshTick, setRefreshTick] = useState(() => Date.now());
  const [imgError, setImgError] = useState(false);
  const { position, getCurrentPosition } = useGeolocation();
  const initialLoadRef = useRef(false);

  const { data: session, isLoading: sessionLoading } = useQuery<any>({
    queryKey: ['/api/offsite-sessions', sessionId, 'receipt'],
    queryFn: async () => {
      const res = await fetch(`/api/offsite-sessions/${sessionId}/receipt`, { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to load trip details');
      return res.json();
    },
    enabled: open && !!sessionId,
    refetchInterval: open ? REFRESH_INTERVAL_MS : false,
  });

  // Acquire a fresh GPS reading each time we refresh, so the live pin is current
  useEffect(() => {
    if (!open) return;
    getCurrentPosition().catch(() => {});
  }, [open, refreshTick, getCurrentPosition]);

  // Auto-refresh the map image every REFRESH_INTERVAL_MS while the sheet is open
  useEffect(() => {
    if (!open) return;
    if (!initialLoadRef.current) {
      initialLoadRef.current = true;
      setRefreshTick(Date.now());
      setImgError(false);
    }
    const id = window.setInterval(() => {
      setRefreshTick(Date.now());
      setImgError(false);
    }, REFRESH_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, [open]);

  useEffect(() => {
    if (!open) {
      initialLoadRef.current = false;
    }
  }, [open]);

  const mapSrc = useMemo(() => {
    if (!sessionId) return '';
    const params = new URLSearchParams({
      sessionId,
      live: '1',
      t: String(refreshTick),
    });
    if (position?.latitude != null && position?.longitude != null) {
      params.set('currentLat', String(position.latitude));
      params.set('currentLng', String(position.longitude));
    }
    return `/api/maps/trip-map?${params.toString()}`;
  }, [sessionId, refreshTick, position?.latitude, position?.longitude]);

  const waypoints = (session?.sessionWaypoints ?? []) as Array<{
    name: string;
    lat: number;
    lng: number;
    address?: string;
    arrivedAt?: string;
  }>;

  const destinationName: string | null = session?.rule?.destinationName ?? null;
  const destinationArrivedAt: string | null = session?.destinationArrivedAt ?? null;
  const hasRoute = !!session?.routePolyline;

  const stops: Array<{
    label: string;
    arrivedAt: string | null;
    isDestination: boolean;
  }> = [
    ...waypoints.map((wp) => ({
      label: wp.name,
      arrivedAt: wp.arrivedAt ?? null,
      isDestination: false,
    })),
  ];
  if (destinationName) {
    stops.push({
      label: destinationName,
      arrivedAt: destinationArrivedAt,
      isDestination: true,
    });
  }

  const nextStopIndex = stops.findIndex((s) => !s.arrivedAt);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="rounded-t-2xl max-h-[90vh] overflow-y-auto">
        <SheetHeader className="text-left mb-3">
          <SheetTitle className="flex items-center gap-2">
            <Navigation className="w-4 h-4" />
            Live Trip Route
          </SheetTitle>
          <SheetDescription>
            Your current location updates automatically as you move.
          </SheetDescription>
        </SheetHeader>

        <div className="space-y-4">
          {sessionLoading && !session ? (
            <Skeleton className="h-64 w-full rounded-lg" />
          ) : (
            <div className="rounded-lg overflow-hidden border bg-muted relative">
              {sessionId && !imgError ? (
                <img
                  key={mapSrc}
                  src={mapSrc}
                  alt="Live trip route map"
                  className="w-full h-64 object-cover"
                  onError={() => setImgError(true)}
                  data-testid="live-trip-map-image"
                />
              ) : (
                <div className="h-64 flex items-center justify-center">
                  <div className="text-center text-muted-foreground">
                    <MapPin className="w-8 h-8 mx-auto mb-2 opacity-40" />
                    <p className="text-sm">{imgError ? 'Map unavailable right now' : 'No active trip'}</p>
                  </div>
                </div>
              )}
              <div className="absolute bottom-2 left-2 flex gap-1.5 flex-wrap">
                {hasRoute && (
                  <div className="flex items-center gap-1 bg-white/90 rounded px-2 py-0.5 text-xs font-medium">
                    <div className="w-3 h-1 rounded bg-blue-500" />
                    Planned
                  </div>
                )}
                <div className="flex items-center gap-1 bg-white/90 rounded px-2 py-0.5 text-xs font-medium">
                  <div className="w-3 h-1 rounded bg-green-500" />
                  Travelled
                </div>
                <div className="flex items-center gap-1 bg-white/90 rounded px-2 py-0.5 text-xs font-medium text-purple-700">
                  <Navigation className="w-3 h-3" />
                  You
                </div>
              </div>
            </div>
          )}

          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500" />
              </span>
              Refreshes every 30 seconds
            </span>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs"
              onClick={() => {
                setRefreshTick(Date.now());
                setImgError(false);
                getCurrentPosition().catch(() => {});
              }}
              data-testid="live-trip-refresh-button"
            >
              <RefreshCw className="w-3 h-3 mr-1" />
              Refresh now
            </Button>
          </div>

          {stops.length > 0 && (
            <>
              <Separator />
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2 flex items-center gap-1.5">
                  <Route className="w-3.5 h-3.5" />
                  Trip Progress
                </p>
                <div className="space-y-2">
                  {stops.map((stop, i) => {
                    const isNext = i === nextStopIndex;
                    const arrived = !!stop.arrivedAt;
                    return (
                      <div
                        key={`${stop.label}-${i}`}
                        className={`flex items-center justify-between text-sm rounded-lg px-2.5 py-1.5 ${
                          isNext
                            ? 'bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800'
                            : ''
                        }`}
                        data-testid={`trip-stop-${i}`}
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          {stop.isDestination ? (
                            <MapPin className="w-4 h-4 text-red-500 flex-shrink-0" />
                          ) : (
                            <div
                              className={`w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 ${
                                arrived
                                  ? 'bg-green-100 text-green-700'
                                  : isNext
                                    ? 'bg-blue-100 text-blue-700'
                                    : 'bg-muted text-muted-foreground'
                              }`}
                            >
                              {i + 1}
                            </div>
                          )}
                          <div className="min-w-0">
                            <p className="font-medium truncate">{stop.label}</p>
                            {isNext && (
                              <p className="text-xs text-blue-700 dark:text-blue-400 font-semibold">
                                Up next
                              </p>
                            )}
                          </div>
                        </div>
                        <div className="text-xs text-muted-foreground flex items-center gap-1 ml-2 flex-shrink-0">
                          {arrived ? (
                            <>
                              <CheckCircle2 className="w-3.5 h-3.5 text-green-600" />
                              {formatTime(stop.arrivedAt) ?? 'Arrived'}
                            </>
                          ) : (
                            <span className="text-muted-foreground">Pending</span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </>
          )}

          {!hasRoute && (
            <div className="flex items-start gap-2 text-xs text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/30 rounded-lg p-2.5">
              <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
              <span>No planned route was set for this trip — only your travelled path and current location are shown.</span>
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
