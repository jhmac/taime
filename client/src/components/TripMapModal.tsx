import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiRequest } from '@/lib/queryClient';
import { useToast } from '@/hooks/use-toast';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Separator } from '@/components/ui/separator';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { AlertTriangle, CheckCircle2, MapPin, Route, Clock, CheckCheck, Flag, X } from 'lucide-react';

interface TripMapModalProps {
  sessionId: string | null;
  onClose: () => void;
  isAdmin?: boolean;
}

function formatDuration(seconds: number) {
  const m = Math.round(seconds / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const rem = m % 60;
  return rem > 0 ? `${h}h ${rem}m` : `${h}h`;
}

function formatDistance(meters: number) {
  const miles = meters / 1609.34;
  return `${miles.toFixed(1)} mi`;
}

function formatTime(dateStr: string | null | undefined) {
  if (!dateStr) return '—';
  return new Date(dateStr).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

function formatDate(dateStr: string | null | undefined) {
  if (!dateStr) return '—';
  return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export default function TripMapModal({ sessionId, onClose, isAdmin = false }: TripMapModalProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [mapError, setMapError] = useState(false);
  const [showFlagInput, setShowFlagInput] = useState(false);
  const [flagNote, setFlagNote] = useState('');

  const { data: receipt, isLoading } = useQuery<any>({
    queryKey: ['/api/offsite-sessions', sessionId, 'receipt'],
    queryFn: async () => {
      const res = await fetch(`/api/offsite-sessions/${sessionId}/receipt`, { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to load receipt');
      return res.json();
    },
    enabled: !!sessionId,
  });

  const { data: breadcrumbs = [], isLoading: crumbsLoading } = useQuery<any[]>({
    queryKey: ['/api/offsite-sessions', sessionId, 'breadcrumbs'],
    queryFn: async () => {
      const res = await fetch(`/api/offsite-sessions/${sessionId}/breadcrumbs`, { credentials: 'include' });
      if (!res.ok) return [];
      return res.json();
    },
    enabled: !!sessionId,
  });

  const reviewMutation = useMutation({
    mutationFn: async (data: { reviewStatus?: 'approved' | 'flagged' | null; adminNote?: string | null }) => {
      const res = await apiRequest('PATCH', `/api/offsite-sessions/${sessionId}/review`, data);
      return res.json();
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['/api/offsite-sessions', sessionId, 'receipt'] });
      queryClient.invalidateQueries({ queryKey: ['/api/trip-history'] });
      setShowFlagInput(false);
      setFlagNote('');
      const action =
        variables.reviewStatus === 'approved'
          ? 'Trip approved.'
          : variables.reviewStatus === 'flagged'
          ? 'Trip flagged for review.'
          : 'Trip review cleared.';
      toast({ title: 'Updated', description: action });
    },
    onError: (err: any) => {
      toast({ title: 'Error', description: err.message || 'Failed to update trip review.', variant: 'destructive' });
    },
  });

  if (!sessionId) return null;

  const waypoints = receipt?.sessionWaypoints as Array<{ name: string; lat: number; lng: number; address?: string; arrivedAt?: string }> | null;
  const deviationCrumbs = breadcrumbs.filter((b: any) => b.isDeviation);
  const hasRoute = !!(receipt?.routePolyline);
  const hasBreadcrumbs = breadcrumbs.length > 0;
  const hasTripData = hasRoute || hasBreadcrumbs;
  const reviewStatus: string | null = receipt?.reviewStatus ?? null;
  const isApproved = reviewStatus === 'approved' || (!reviewStatus && !!receipt?.reviewedAt);
  const isFlagged = reviewStatus === 'flagged';

  const handleApprove = () => {
    reviewMutation.mutate({ reviewStatus: isApproved ? null : 'approved' });
  };

  const handleOpenFlag = () => {
    setFlagNote(receipt?.adminNote || '');
    setShowFlagInput(true);
  };

  const handleSaveFlag = () => {
    reviewMutation.mutate({ reviewStatus: 'flagged', adminNote: flagNote.trim() || null });
  };

  const handleClearFlag = () => {
    reviewMutation.mutate({ reviewStatus: null, adminNote: null });
  };

  // Compute per-leg durations from waypoint arrivedAt times and session exitTime
  const legBreakdown: Array<{ label: string; durationMin: number | null; arrivedAt: string | null }> = [];
  if (waypoints && waypoints.length > 0 && receipt?.exitTime) {
    const startMs = new Date(receipt.exitTime).getTime();
    waypoints.forEach((wp, i) => {
      const prevMs = i === 0 ? startMs : (waypoints[i - 1]?.arrivedAt ? new Date(waypoints[i - 1].arrivedAt!).getTime() : null);
      const arrMs = wp.arrivedAt ? new Date(wp.arrivedAt).getTime() : null;
      const legMin = (prevMs != null && arrMs != null) ? Math.round((arrMs - prevMs) / 60000) : null;
      legBreakdown.push({ label: wp.name, durationMin: legMin, arrivedAt: wp.arrivedAt ?? null });
    });
    // Final leg: last waypoint → destination
    if (receipt?.rule?.destinationName) {
      const lastArrMs = waypoints[waypoints.length - 1]?.arrivedAt
        ? new Date(waypoints[waypoints.length - 1].arrivedAt!).getTime()
        : null;
      const destArrMs = receipt?.destinationArrivedAt ? new Date(receipt.destinationArrivedAt).getTime() : null;
      const finalMin = (lastArrMs != null && destArrMs != null) ? Math.round((destArrMs - lastArrMs) / 60000) : null;
      legBreakdown.push({ label: receipt.rule.destinationName, durationMin: finalMin, arrivedAt: receipt?.destinationArrivedAt ?? null });
    }
  }

  return (
    <Dialog open={!!sessionId} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Route className="w-4 h-4" />
            Trip Route Map
            {isApproved && (
              <Badge className="ml-2 bg-green-100 text-green-700 border-green-200" data-testid="badge-trip-approved">
                Approved
              </Badge>
            )}
            {isFlagged && (
              <Badge className="ml-2 bg-red-100 text-red-700 border-red-200" data-testid="badge-trip-flagged">
                Flagged
              </Badge>
            )}
          </DialogTitle>
        </DialogHeader>

        {isLoading ? (
          <div className="space-y-3">
            <Skeleton className="h-64 w-full rounded-lg" />
            <Skeleton className="h-24 w-full" />
          </div>
        ) : (
          <div className="space-y-4">
            {hasTripData && !mapError ? (
              <div className="rounded-lg overflow-hidden border bg-muted relative">
                <img
                  src={`/api/maps/trip-map?sessionId=${sessionId}`}
                  alt="Trip route map"
                  className="w-full h-64 object-cover"
                  onError={() => setMapError(true)}
                />
                <div className="absolute bottom-2 left-2 flex gap-1.5 flex-wrap">
                  {hasRoute && (
                    <div className="flex items-center gap-1 bg-white/90 rounded px-2 py-0.5 text-xs font-medium">
                      <div className="w-3 h-1 rounded bg-blue-500" />
                      Planned route
                    </div>
                  )}
                  {hasBreadcrumbs && (
                    <div className="flex items-center gap-1 bg-white/90 rounded px-2 py-0.5 text-xs font-medium">
                      <div className="w-3 h-1 rounded bg-green-500" />
                      Actual path
                    </div>
                  )}
                  {deviationCrumbs.length > 0 && (
                    <div className="flex items-center gap-1 bg-white/90 rounded px-2 py-0.5 text-xs font-medium text-red-600">
                      <AlertTriangle className="w-3 h-3" />
                      {deviationCrumbs.length} deviation{deviationCrumbs.length !== 1 ? 's' : ''}
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div className="rounded-lg bg-muted h-48 flex items-center justify-center border">
                <div className="text-center text-muted-foreground">
                  <MapPin className="w-8 h-8 mx-auto mb-2 opacity-40" />
                  <p className="text-sm">{mapError ? 'Map unavailable' : 'No GPS data recorded for this trip'}</p>
                </div>
              </div>
            )}

            <div className="grid grid-cols-3 gap-3 text-center">
              <div className="rounded-lg border p-3">
                <p className="text-xs text-muted-foreground mb-1">Duration</p>
                <p className="font-semibold text-sm">
                  {receipt?.durationMinutes != null
                    ? receipt.durationMinutes < 60
                      ? `${receipt.durationMinutes} min`
                      : `${Math.floor(receipt.durationMinutes / 60)}h ${receipt.durationMinutes % 60}m`
                    : '—'}
                </p>
              </div>
              <div className="rounded-lg border p-3">
                <p className="text-xs text-muted-foreground mb-1">Distance</p>
                <p className="font-semibold text-sm">
                  {receipt?.totalDistanceMiles ? `${parseFloat(receipt.totalDistanceMiles).toFixed(1)} mi` : '—'}
                </p>
              </div>
              <div className="rounded-lg border p-3">
                <p className="text-xs text-muted-foreground mb-1">GPS Points</p>
                <p className="font-semibold text-sm">{crumbsLoading ? '…' : breadcrumbs.length}</p>
              </div>
            </div>

            {receipt?.routeDistanceMeters && receipt?.routeDurationSeconds && (
              <>
                <Separator />
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">Planned Route</p>
                  <div className="flex gap-4 text-sm">
                    <span className="flex items-center gap-1 text-muted-foreground">
                      <Route className="w-3.5 h-3.5" />
                      {formatDistance(receipt.routeDistanceMeters)} planned
                    </span>
                    <span className="flex items-center gap-1 text-muted-foreground">
                      <Clock className="w-3.5 h-3.5" />
                      {formatDuration(receipt.routeDurationSeconds)} est.
                    </span>
                  </div>
                </div>
              </>
            )}

            {legBreakdown.length > 0 && (
              <>
                <Separator />
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
                    Leg Breakdown
                  </p>
                  <div className="space-y-2">
                    {legBreakdown.map((leg, i) => {
                      const isLast = i === legBreakdown.length - 1;
                      const isDestination = isLast && !!receipt?.rule?.destinationName;
                      return (
                        <div key={i} className="flex items-center justify-between text-sm">
                          <div className="flex items-center gap-2">
                            {isDestination ? (
                              <MapPin className="w-4 h-4 text-red-500 flex-shrink-0" />
                            ) : (
                              <div className="w-5 h-5 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center text-xs font-bold flex-shrink-0">
                                {i + 1}
                              </div>
                            )}
                            <div>
                              <span className="font-medium">{leg.label}</span>
                              {leg.durationMin != null && (
                                <span className="text-xs text-muted-foreground ml-1.5">
                                  (+{leg.durationMin} min travel)
                                </span>
                              )}
                            </div>
                          </div>
                          <div className="text-xs text-muted-foreground flex items-center gap-1">
                            {leg.arrivedAt ? (
                              <>
                                <CheckCircle2 className="w-3.5 h-3.5 text-green-600" />
                                {formatTime(leg.arrivedAt)}
                              </>
                            ) : (
                              <span className="text-amber-600">Not reached</span>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </>
            )}

            {waypoints && waypoints.length > 0 && legBreakdown.length === 0 && (
              <>
                <Separator />
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
                    Stops ({waypoints.length})
                  </p>
                  <div className="space-y-2">
                    {waypoints.map((wp, i) => (
                      <div key={i} className="flex items-center justify-between text-sm">
                        <div className="flex items-center gap-2">
                          <div className="w-5 h-5 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center text-xs font-bold flex-shrink-0">
                            {i + 1}
                          </div>
                          <span className="font-medium">{wp.name}</span>
                        </div>
                        <div className="text-xs text-muted-foreground flex items-center gap-1">
                          {wp.arrivedAt ? (
                            <>
                              <CheckCircle2 className="w-3.5 h-3.5 text-green-600" />
                              {formatTime(wp.arrivedAt)}
                            </>
                          ) : (
                            <span className="text-amber-600">Not reached</span>
                          )}
                        </div>
                      </div>
                    ))}
                    {receipt?.rule?.destinationName && (
                      <div className="flex items-center justify-between text-sm mt-1">
                        <div className="flex items-center gap-2">
                          <MapPin className="w-4 h-4 text-red-500 flex-shrink-0" />
                          <span className="font-medium">{receipt.rule.destinationName}</span>
                        </div>
                        <div className="text-xs text-muted-foreground flex items-center gap-1">
                          {receipt.destinationArrivedAt ? (
                            <>
                              <CheckCircle2 className="w-3.5 h-3.5 text-green-600" />
                              {formatTime(receipt.destinationArrivedAt)}
                            </>
                          ) : (
                            <span className="text-amber-600">Not reached</span>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </>
            )}

            {deviationCrumbs.length > 0 && (
              <>
                <Separator />
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2 flex items-center gap-1">
                    <AlertTriangle className="w-3.5 h-3.5 text-amber-500" />
                    Route Deviations ({deviationCrumbs.length})
                  </p>
                  <div className="space-y-1 max-h-32 overflow-y-auto">
                    {deviationCrumbs.slice(0, 10).map((d: any, i: number) => (
                      <div key={i} className="flex items-center justify-between text-xs text-amber-700 bg-amber-50 rounded px-2 py-1">
                        <span>{formatTime(d.timestamp)}</span>
                        <Badge variant="outline" className="text-amber-700 border-amber-300 text-xs py-0 h-4">
                          {d.distanceFromRouteMt}m off route
                        </Badge>
                      </div>
                    ))}
                  </div>
                </div>
              </>
            )}

            {receipt?.clockedOutOffRoute && (
              <>
                <Separator />
                <div className="flex items-center gap-2 text-sm text-red-600 bg-red-50 rounded-lg p-3">
                  <AlertTriangle className="w-4 h-4 flex-shrink-0" />
                  <span>This trip was automatically ended due to repeated route deviations.</span>
                </div>
              </>
            )}

            {isAdmin && (
              <>
                <Separator />
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Admin Review
                    </p>
                    {receipt?.reviewedAt && receipt?.reviewer && (
                      <p className="text-xs text-muted-foreground">
                        {isFlagged ? 'Flagged' : 'Reviewed'} by{' '}
                        {receipt.reviewer.firstName} {receipt.reviewer.lastName} on{' '}
                        {formatDate(receipt.reviewedAt)}
                      </p>
                    )}
                  </div>

                  {receipt?.adminNote && !showFlagInput && (
                    <div className={`rounded-md p-2.5 text-sm ${isFlagged ? 'bg-red-50 border border-red-100' : 'bg-muted'}`}>
                      <p className="text-xs font-medium text-muted-foreground mb-0.5">
                        {isFlagged ? 'Flag note' : 'Admin note'}
                      </p>
                      <p>{receipt.adminNote}</p>
                    </div>
                  )}

                  {showFlagInput ? (
                    <div className="space-y-2">
                      <Textarea
                        value={flagNote}
                        onChange={(e) => setFlagNote(e.target.value)}
                        placeholder="Add a short note about why this trip is flagged..."
                        rows={3}
                        maxLength={2000}
                        className="text-sm"
                        data-testid="textarea-flag-note"
                      />
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          variant="destructive"
                          onClick={handleSaveFlag}
                          disabled={reviewMutation.isPending}
                          data-testid="button-save-flag"
                        >
                          <Flag className="w-3.5 h-3.5 mr-1.5" />
                          {reviewMutation.isPending ? 'Saving…' : 'Flag Trip'}
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => { setShowFlagInput(false); setFlagNote(''); }}
                          disabled={reviewMutation.isPending}
                        >
                          Cancel
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      <Button
                        size="sm"
                        variant={isApproved ? 'outline' : 'default'}
                        onClick={handleApprove}
                        disabled={reviewMutation.isPending}
                        data-testid="button-approve-trip"
                      >
                        <CheckCheck className="w-3.5 h-3.5 mr-1.5" />
                        {isApproved ? 'Unapprove' : 'Approve Trip'}
                      </Button>
                      {isFlagged ? (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={handleClearFlag}
                          disabled={reviewMutation.isPending}
                          data-testid="button-clear-flag"
                        >
                          <X className="w-3.5 h-3.5 mr-1.5" />
                          Clear Flag
                        </Button>
                      ) : (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={handleOpenFlag}
                          disabled={reviewMutation.isPending}
                          className="border-red-200 text-red-700 hover:bg-red-50 hover:text-red-700"
                          data-testid="button-flag-trip"
                        >
                          <Flag className="w-3.5 h-3.5 mr-1.5" />
                          Flag for Review
                        </Button>
                      )}
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
