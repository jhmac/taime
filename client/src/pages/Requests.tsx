import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useLocation } from 'wouter';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import type { TimeOffRequest, User } from '@shared/schema';

const timeOffTypes: Record<string, { label: string; icon: string }> = {
  vacation: { label: 'Vacation', icon: 'fas fa-umbrella-beach' },
  sick: { label: 'Sick Leave', icon: 'fas fa-thermometer-half' },
  personal: { label: 'Personal', icon: 'fas fa-user' },
  unpaid: { label: 'Unpaid Leave', icon: 'fas fa-calendar-minus' },
  other: { label: 'Other', icon: 'fas fa-ellipsis-h' },
};

const statusColors: Record<string, string> = {
  pending: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
  approved: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
  denied: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
  cancelled: 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400',
};

const formatDate = (d: string | Date) =>
  new Date(d as string).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

export default function Requests() {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [, navigate] = useLocation();
  const [noteInputs, setNoteInputs] = useState<Record<string, string>>({});

  const roleName = user?.role?.name;
  const canReview = roleName === 'admin' || roleName === 'owner' || roleName === 'manager';

  const { data: allRequests = [], isLoading } = useQuery<TimeOffRequest[]>({
    queryKey: ['/api/time-off-requests', canReview ? 'all' : 'mine'],
    queryFn: () =>
      fetch(canReview ? '/api/time-off-requests?all=true' : '/api/time-off-requests').then(r => r.json()),
    enabled: !!user,
  });

  const { data: users = [] } = useQuery<User[]>({
    queryKey: ['/api/users'],
    enabled: canReview,
  });

  const userMap = Object.fromEntries(users.map(u => [u.id, u]));

  const cancelMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/time-off-requests/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'cancelled' }),
      });
      if (!res.ok) throw new Error('Failed to cancel');
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/time-off-requests'] });
      toast({ title: 'Request cancelled' });
    },
    onError: () => {
      toast({ title: 'Error', description: 'Could not cancel request', variant: 'destructive' });
    },
  });

  const reviewMutation = useMutation({
    mutationFn: async ({ id, status, adminNotes }: { id: string; status: 'approved' | 'denied'; adminNotes?: string }) => {
      const res = await fetch(`/api/time-off-requests/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status, ...(adminNotes ? { adminNotes } : {}) }),
      });
      if (!res.ok) throw new Error('Failed to update request');
      return res.json();
    },
    onSuccess: (_data, vars) => {
      queryClient.invalidateQueries({ queryKey: ['/api/time-off-requests'] });
      setNoteInputs(prev => { const n = { ...prev }; delete n[vars.id]; return n; });
      toast({ title: vars.status === 'approved' ? 'Request approved' : 'Request denied' });
    },
    onError: () => {
      toast({ title: 'Error', description: 'Could not update request', variant: 'destructive' });
    },
  });

  const myRequests = allRequests.filter(r => r.userId === user?.id);
  const pendingOthers = allRequests.filter(r => r.userId !== user?.id && r.status === 'pending');
  const reviewedOthers = allRequests.filter(r => r.userId !== user?.id && r.status !== 'pending');

  const getUserName = (userId: string) => {
    const u = userMap[userId];
    if (!u) return 'Employee';
    return [u.firstName, u.lastName].filter(Boolean).join(' ') || u.email || 'Employee';
  };

  return (
    <div className="min-h-screen bg-background">
      <div className="flex items-center justify-between p-4 border-b border-border">
        <button onClick={() => navigate('/more')} className="text-primary">
          <i className="fas fa-chevron-left text-lg"></i>
        </button>
        <h1 className="text-lg font-bold">Requests</h1>
        <button onClick={() => navigate('/availability')} className="text-primary">
          <i className="fas fa-plus text-lg"></i>
        </button>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-12">
          <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary"></div>
        </div>
      ) : (
        <div className="p-4 space-y-6">

          {canReview && (
            <section>
              <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">
                Pending Approval
                {pendingOthers.length > 0 && (
                  <span className="ml-2 inline-flex items-center justify-center w-5 h-5 rounded-full bg-primary text-primary-foreground text-[10px] font-bold">
                    {pendingOthers.length}
                  </span>
                )}
              </h2>

              {pendingOthers.length === 0 ? (
                <Card>
                  <CardContent className="p-6 text-center">
                    <i className="fas fa-inbox text-2xl text-muted-foreground mb-2 block"></i>
                    <p className="text-sm text-muted-foreground">No pending requests</p>
                  </CardContent>
                </Card>
              ) : (
                <div className="space-y-3">
                  {pendingOthers.map(req => {
                    const typeInfo = timeOffTypes[req.type] || { label: req.type, icon: 'fas fa-calendar' };
                    const note = noteInputs[req.id] ?? '';
                    return (
                      <Card key={req.id} className="border-amber-200 dark:border-amber-800/50">
                        <CardContent className="p-4">
                          <div className="flex items-start justify-between mb-2">
                            <div>
                              <p className="text-sm font-semibold">{getUserName(req.userId)}</p>
                              <div className="flex items-center gap-1.5 text-xs text-muted-foreground mt-0.5">
                                <i className={typeInfo.icon}></i>
                                <span>{typeInfo.label}</span>
                              </div>
                            </div>
                            <Badge className={cn("text-xs", statusColors.pending)}>Pending</Badge>
                          </div>

                          <div className="bg-muted/30 rounded-lg p-3 mb-3">
                            <div className="text-xs text-muted-foreground mb-0.5">Dates</div>
                            <div className="text-sm font-medium">
                              {formatDate(req.startDate as unknown as string)}
                              {String(req.startDate) !== String(req.endDate) && (
                                <> – {formatDate(req.endDate as unknown as string)}</>
                              )}
                            </div>
                            {req.reason && (
                              <div className="mt-2 text-xs text-muted-foreground italic">"{req.reason}"</div>
                            )}
                          </div>

                          <Textarea
                            placeholder="Add a note (optional)"
                            value={note}
                            onChange={e => setNoteInputs(prev => ({ ...prev, [req.id]: e.target.value }))}
                            className="text-xs min-h-[60px] mb-3 resize-none"
                          />

                          <div className="flex gap-2">
                            <Button
                              size="sm"
                              className="flex-1 bg-green-600 hover:bg-green-700 text-white"
                              onClick={() => reviewMutation.mutate({ id: req.id, status: 'approved', adminNotes: note || undefined })}
                              disabled={reviewMutation.isPending}
                            >
                              <i className="fas fa-check mr-1.5"></i>Approve
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              className="flex-1 border-red-300 text-red-600 hover:bg-red-50 dark:hover:bg-red-950/20"
                              onClick={() => reviewMutation.mutate({ id: req.id, status: 'denied', adminNotes: note || undefined })}
                              disabled={reviewMutation.isPending}
                            >
                              <i className="fas fa-times mr-1.5"></i>Deny
                            </Button>
                          </div>
                        </CardContent>
                      </Card>
                    );
                  })}
                </div>
              )}

              {reviewedOthers.length > 0 && (
                <>
                  <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3 mt-5">
                    Reviewed
                  </h2>
                  <div className="space-y-3">
                    {reviewedOthers.map(req => {
                      const typeInfo = timeOffTypes[req.type] || { label: req.type, icon: 'fas fa-calendar' };
                      return (
                        <Card key={req.id} className="opacity-75">
                          <CardContent className="p-4">
                            <div className="flex items-start justify-between mb-2">
                              <div>
                                <p className="text-sm font-semibold">{getUserName(req.userId)}</p>
                                <div className="flex items-center gap-1.5 text-xs text-muted-foreground mt-0.5">
                                  <i className={typeInfo.icon}></i>
                                  <span>{typeInfo.label}</span>
                                </div>
                              </div>
                              <Badge className={cn("text-xs", statusColors[req.status] || statusColors.pending)}>
                                {req.status.charAt(0).toUpperCase() + req.status.slice(1)}
                              </Badge>
                            </div>
                            <div className="text-xs text-muted-foreground">
                              {formatDate(req.startDate as unknown as string)}
                              {String(req.startDate) !== String(req.endDate) && (
                                <> – {formatDate(req.endDate as unknown as string)}</>
                              )}
                            </div>
                            {req.adminNotes && (
                              <div className="mt-2 text-xs text-muted-foreground italic">Note: {req.adminNotes}</div>
                            )}
                          </CardContent>
                        </Card>
                      );
                    })}
                  </div>
                </>
              )}
            </section>
          )}

          <section>
            <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">
              My Requests
            </h2>
            {myRequests.length === 0 ? (
              <Card>
                <CardContent className="p-8 text-center">
                  <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-muted flex items-center justify-center">
                    <i className="fas fa-file-alt text-2xl text-muted-foreground"></i>
                  </div>
                  <p className="font-medium mb-1">No requests yet</p>
                  <p className="text-sm text-muted-foreground mb-4">Submit a time-off request to get started.</p>
                  <Button onClick={() => navigate('/availability')} variant="outline">
                    <i className="fas fa-plus mr-2"></i>New Request
                  </Button>
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-3">
                {myRequests.map(req => {
                  const typeInfo = timeOffTypes[req.type] || { label: req.type, icon: 'fas fa-calendar' };
                  return (
                    <Card key={req.id}>
                      <CardContent className="p-4">
                        <div className="flex items-center justify-between mb-3">
                          <div className="flex items-center gap-2">
                            <i className={cn(typeInfo.icon, "text-muted-foreground")}></i>
                            <span className="text-sm font-semibold">{typeInfo.label}</span>
                          </div>
                          <Badge className={cn("text-xs", statusColors[req.status] || statusColors.pending)}>
                            {req.status === 'pending' ? 'Pending approval' : req.status.charAt(0).toUpperCase() + req.status.slice(1)}
                          </Badge>
                        </div>

                        <div className="bg-muted/30 rounded-lg p-3 mb-3">
                          <div className="text-xs text-muted-foreground">Dates</div>
                          <div className="text-sm font-medium">
                            {formatDate(req.startDate as unknown as string)}
                            {String(req.startDate) !== String(req.endDate) && (
                              <> – {formatDate(req.endDate as unknown as string)}</>
                            )}
                          </div>
                          {req.reason && (
                            <div className="mt-2 text-xs text-muted-foreground italic">"{req.reason}"</div>
                          )}
                        </div>

                        {req.adminNotes && (
                          <div className="text-xs text-muted-foreground bg-blue-50 dark:bg-blue-950/20 p-2 rounded mb-3">
                            <i className="fas fa-comment-dots mr-1 text-blue-500"></i> Manager note: {req.adminNotes}
                          </div>
                        )}

                        <div className="flex items-center justify-between">
                          <span className="text-[10px] text-muted-foreground">
                            Submitted {req.createdAt ? formatDate(req.createdAt as unknown as string) : ''}
                          </span>
                          {req.status === 'pending' && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="text-xs text-destructive hover:text-destructive"
                              onClick={() => cancelMutation.mutate(req.id)}
                              disabled={cancelMutation.isPending}
                            >
                              Cancel request
                            </Button>
                          )}
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
