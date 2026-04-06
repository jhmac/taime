import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiRequest } from '@/lib/queryClient';
import { useToast } from '@/hooks/use-toast';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Textarea } from '@/components/ui/textarea';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Clock,
  Route,
  Car,
  Wallet,
  CheckCircle2,
  AlertTriangle,
  MapPin,
  ChevronDown,
  ChevronUp,
  Printer,
  CheckCheck,
  User,
} from 'lucide-react';

interface TripReceiptModalProps {
  sessionId: string | null;
  onClose: () => void;
  isAdmin?: boolean;
}

function StatRow({ icon, label, value, className }: { icon: React.ReactNode; label: string; value: string; className?: string }) {
  return (
    <div className={`flex items-center justify-between py-2 ${className || ''}`}>
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        {icon}
        <span>{label}</span>
      </div>
      <span className="font-mono text-sm font-medium">{value}</span>
    </div>
  );
}

export default function TripReceiptModal({ sessionId, onClose, isAdmin = false }: TripReceiptModalProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [showDeviations, setShowDeviations] = useState(false);
  const [adminNote, setAdminNote] = useState('');
  const [editingNote, setEditingNote] = useState(false);

  const { data: receipt, isLoading } = useQuery<any>({
    queryKey: ['/api/offsite-sessions', sessionId, 'receipt'],
    queryFn: async () => {
      const res = await fetch(`/api/offsite-sessions/${sessionId}/receipt`, { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to load receipt');
      return res.json();
    },
    enabled: !!sessionId,
  });

  const reviewMutation = useMutation({
    mutationFn: async (data: { adminNote?: string; markReviewed?: boolean }) => {
      const res = await apiRequest('PATCH', `/api/offsite-sessions/${sessionId}/review`, data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/offsite-sessions', sessionId, 'receipt'] });
      queryClient.invalidateQueries({ queryKey: ['/api/trip-history'] });
      setEditingNote(false);
      toast({ title: 'Updated', description: 'Trip review updated.' });
    },
    onError: (err: any) => {
      toast({ title: 'Error', description: err.message || 'Failed to update.', variant: 'destructive' });
    },
  });

  const handleMarkReviewed = () => {
    reviewMutation.mutate({ markReviewed: !receipt?.reviewedAt });
  };

  const handleSaveNote = () => {
    reviewMutation.mutate({ adminNote });
  };

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return '—';
    return new Date(dateStr).toLocaleDateString('en-US', {
      weekday: 'short', month: 'short', day: 'numeric', year: 'numeric',
    });
  };

  const formatTime = (dateStr: string | null) => {
    if (!dateStr) return '—';
    return new Date(dateStr).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  };

  const formatDuration = (minutes: number | null) => {
    if (minutes == null) return '—';
    if (minutes < 60) return `${minutes} min`;
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return m > 0 ? `${h}h ${m}m` : `${h}h`;
  };

  const formatMiles = (miles: string | null) => {
    if (!miles) return '—';
    return `${parseFloat(miles).toFixed(1)} mi`;
  };

  const formatCurrency = (cents: number) => {
    return `$${(cents / 100).toFixed(2)}`;
  };

  const getEmployeeName = () => {
    if (!receipt?.employee) return 'Unknown';
    const { firstName, lastName, email } = receipt.employee;
    return `${firstName || ''} ${lastName || ''}`.trim() || email || 'Unknown';
  };

  const getInitials = () => {
    if (!receipt?.employee) return '?';
    const { firstName, lastName } = receipt.employee;
    return `${firstName?.[0] || ''}${lastName?.[0] || ''}`.toUpperCase() || '?';
  };

  const getStatusBadge = () => {
    if (receipt?.reviewedAt) {
      return <Badge className="bg-green-100 text-green-700 border-green-200">Approved</Badge>;
    }
    const status = receipt?.status;
    if (status === 'active') return <Badge variant="secondary">In Progress</Badge>;
    if (status === 'exceeded') return <Badge className="bg-amber-100 text-amber-700 border-amber-200">Time Exceeded</Badge>;
    if (status === 'auto_clocked_out') return <Badge className="bg-orange-100 text-orange-700 border-orange-200">Auto Clocked Out</Badge>;
    return <Badge className="bg-blue-100 text-blue-700 border-blue-200">Pending Review</Badge>;
  };

  if (!sessionId) return null;

  return (
    <Dialog open={!!sessionId} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto print:shadow-none print:border-none" id="trip-receipt-content">
        <DialogHeader className="print:hidden">
          <DialogTitle className="flex items-center justify-between">
            <span>Trip Receipt</span>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => window.print()}
              className="text-muted-foreground hover:text-foreground"
            >
              <Printer className="w-4 h-4 mr-1" />
              Print
            </Button>
          </DialogTitle>
        </DialogHeader>

        {isLoading ? (
          <div className="space-y-4 py-4">
            <div className="flex items-center gap-3">
              <Skeleton className="w-14 h-14 rounded-full" />
              <div className="space-y-2">
                <Skeleton className="h-4 w-32" />
                <Skeleton className="h-3 w-24" />
              </div>
            </div>
            <Skeleton className="h-32 w-full" />
            <Skeleton className="h-24 w-full" />
          </div>
        ) : receipt ? (
          <div className="space-y-0 print:text-black">
            <div className="py-4 print-section">
              <div className="flex items-center gap-3 mb-3">
                {receipt.employee?.profileImageUrl ? (
                  <img
                    src={receipt.employee.profileImageUrl}
                    alt={getEmployeeName()}
                    className="w-12 h-12 rounded-full object-cover border"
                  />
                ) : (
                  <div className="w-12 h-12 rounded-full bg-purple-100 flex items-center justify-center flex-shrink-0">
                    <span className="text-lg font-bold text-purple-600">{getInitials()}</span>
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <div className="font-semibold text-base">{getEmployeeName()}</div>
                  <div className="text-sm text-muted-foreground">
                    {receipt.rule?.name || 'Off-Site Trip'}
                  </div>
                  <div className="text-xs text-muted-foreground mt-0.5">
                    {formatDate(receipt.exitTime)}
                  </div>
                </div>
                <div className="flex-shrink-0">
                  {getStatusBadge()}
                </div>
              </div>
            </div>

            <Separator />

            <div className="py-3 print-section">
              <div className="flex items-center gap-1.5 mb-2">
                <MapPin className="w-3.5 h-3.5 text-muted-foreground" />
                <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Route</span>
              </div>
              {receipt.rule?.destinationLat && receipt.rule?.destinationLng ? (
                <div
                  className="rounded-lg overflow-hidden border bg-muted h-32 flex items-center justify-center relative"
                >
                  <img
                    src={`/api/maps/static-map?lat=${receipt.rule.destinationLat}&lng=${receipt.rule.destinationLng}`}
                    alt="Destination map"
                    className="w-full h-full object-cover"
                    onError={(e) => {
                      (e.target as HTMLImageElement).style.display = 'none';
                    }}
                  />
                  <div className="absolute bottom-2 left-2 bg-white/90 rounded px-2 py-0.5 text-xs font-medium">
                    {receipt.rule.destinationName || 'Destination'}
                  </div>
                </div>
              ) : (
                <div className="rounded-lg bg-muted h-28 flex items-center justify-center border">
                  <div className="text-center text-muted-foreground">
                    <Route className="w-6 h-6 mx-auto mb-1 opacity-40" />
                    <span className="text-xs">No route data available</span>
                  </div>
                </div>
              )}
            </div>

            <Separator />

            <div className="py-3 print-section">
              <div className="flex items-center gap-1.5 mb-1">
                <Car className="w-3.5 h-3.5 text-muted-foreground" />
                <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Trip Stats</span>
              </div>
              <StatRow
                icon={<Clock className="w-3.5 h-3.5" />}
                label="Time out"
                value={`${formatTime(receipt.exitTime)} – ${formatTime(receipt.returnTime)}`}
              />
              <StatRow
                icon={<Clock className="w-3.5 h-3.5" />}
                label="Duration"
                value={formatDuration(receipt.durationMinutes)}
              />
              <StatRow
                icon={<Route className="w-3.5 h-3.5" />}
                label="Distance"
                value={formatMiles(receipt.totalDistanceMiles)}
              />
              {receipt.maxDeviationMiles && parseFloat(receipt.maxDeviationMiles) > 0 && (
                <StatRow
                  icon={<AlertTriangle className="w-3.5 h-3.5 text-amber-500" />}
                  label="Max deviation"
                  value={formatMiles(receipt.maxDeviationMiles)}
                />
              )}
            </div>

            <Separator />

            <div className="py-3 print-section">
              {receipt.rule?.destinationName ? (
                receipt.destinationReached !== false ? (
                  <div className="flex items-center gap-2 text-sm text-green-700">
                    <CheckCircle2 className="w-4 h-4 flex-shrink-0" />
                    <span>Arrived at <strong>{receipt.rule.destinationName}</strong></span>
                  </div>
                ) : (
                  <div className="flex items-center gap-2 text-sm text-amber-600">
                    <AlertTriangle className="w-4 h-4 flex-shrink-0" />
                    <span>Destination not reached</span>
                  </div>
                )
              ) : (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <MapPin className="w-4 h-4 flex-shrink-0" />
                  <span>No destination set for this trip type</span>
                </div>
              )}
            </div>

            {(receipt.deviationEventCount ?? 0) > 0 && (
              <>
                <Separator />
                <div className="py-3 print-section">
                  <button
                    type="button"
                    className="flex items-center justify-between w-full text-sm font-medium text-amber-700"
                    onClick={() => setShowDeviations(!showDeviations)}
                  >
                    <span className="flex items-center gap-1.5">
                      <AlertTriangle className="w-4 h-4" />
                      {receipt.deviationEventCount} deviation{receipt.deviationEventCount !== 1 ? 's' : ''} recorded
                    </span>
                    {showDeviations ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                  </button>
                  {showDeviations && (
                    <p className="mt-2 text-xs text-muted-foreground">
                      Deviation details are tracked when the GPS path diverges significantly from the expected route.
                    </p>
                  )}
                </div>
              </>
            )}

            {receipt.computedReimbursementCents > 0 && (
              <>
                <Separator />
                <div className="py-3 print-section">
                  <div className="flex items-center gap-1.5 mb-2">
                    <Wallet className="w-3.5 h-3.5 text-muted-foreground" />
                    <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Reimbursement</span>
                  </div>
                  <div className="rounded-lg bg-emerald-50 border border-emerald-100 p-3">
                    <div className="font-mono text-sm">
                      {parseFloat(receipt.totalDistanceMiles || '0').toFixed(1)} mi × {formatCurrency(receipt.mileageRateCents)}/mi ={' '}
                      <strong>{formatCurrency(receipt.computedReimbursementCents)}</strong>
                    </div>
                    {receipt.reimbursementMinutes > 0 && (
                      <div className="text-xs text-emerald-700 mt-0.5">
                        Added as {receipt.reimbursementMinutes} min to timesheet
                      </div>
                    )}
                  </div>
                </div>
              </>
            )}

            {isAdmin && (
              <>
                <Separator />
                <div className="py-3 space-y-2 print:hidden">
                  <div className="flex items-center gap-1.5 mb-1">
                    <User className="w-3.5 h-3.5 text-muted-foreground" />
                    <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Admin Review</span>
                  </div>

                  {receipt.reviewedAt && receipt.reviewer && (
                    <div className="text-xs text-muted-foreground">
                      Reviewed by {receipt.reviewer.firstName} {receipt.reviewer.lastName} on{' '}
                      {formatDate(receipt.reviewedAt)}
                    </div>
                  )}

                  <Button
                    variant={receipt.reviewedAt ? 'outline' : 'default'}
                    size="sm"
                    onClick={handleMarkReviewed}
                    disabled={reviewMutation.isPending}
                    className="w-full"
                  >
                    <CheckCheck className="w-4 h-4 mr-1.5" />
                    {receipt.reviewedAt ? 'Unmark Reviewed' : 'Mark as Reviewed'}
                  </Button>

                  {editingNote ? (
                    <div className="space-y-2">
                      <Textarea
                        value={adminNote}
                        onChange={(e) => setAdminNote(e.target.value)}
                        placeholder="Add a note..."
                        rows={3}
                        className="text-sm"
                      />
                      <div className="flex gap-2">
                        <Button size="sm" onClick={handleSaveNote} disabled={reviewMutation.isPending}>
                          Save Note
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => setEditingNote(false)}>
                          Cancel
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div>
                      {receipt.adminNote && (
                        <div className="text-sm rounded-md bg-muted p-2 mb-2">
                          <p className="text-xs font-medium text-muted-foreground mb-0.5">Admin Note</p>
                          <p>{receipt.adminNote}</p>
                        </div>
                      )}
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-xs h-7"
                        onClick={() => {
                          setAdminNote(receipt.adminNote || '');
                          setEditingNote(true);
                        }}
                      >
                        {receipt.adminNote ? 'Edit Note' : 'Add Note'}
                      </Button>
                    </div>
                  )}
                </div>
              </>
            )}

            {receipt.adminNote && !isAdmin && (
              <>
                <Separator />
                <div className="py-2">
                  <div className="text-sm rounded-md bg-muted p-2">
                    <p className="text-xs font-medium text-muted-foreground mb-0.5">Note</p>
                    <p className="text-sm">{receipt.adminNote}</p>
                  </div>
                </div>
              </>
            )}
          </div>
        ) : (
          <div className="py-8 text-center text-muted-foreground text-sm">
            Receipt not found.
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
