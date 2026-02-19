import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useLocation } from 'wouter';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import type { TimeOffRequest } from '@shared/schema';

const timeOffTypes: Record<string, { label: string; icon: string }> = {
  vacation: { label: 'Vacation', icon: 'fas fa-umbrella-beach' },
  sick: { label: 'Sick Leave', icon: 'fas fa-thermometer-half' },
  personal: { label: 'Personal', icon: 'fas fa-user' },
  unpaid: { label: 'Unpaid Leave', icon: 'fas fa-calendar-minus' },
  other: { label: 'Other', icon: 'fas fa-ellipsis-h' },
};

export default function Requests() {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [, navigate] = useLocation();

  const { data: requests = [], isLoading } = useQuery<TimeOffRequest[]>({
    queryKey: ['/api/time-off-requests'],
  });

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

  const myRequests = requests.filter(r => r.userId === user?.id);

  const statusColors: Record<string, string> = {
    pending: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
    approved: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
    denied: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
    cancelled: 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400',
  };

  const formatDate = (d: string) => new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

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

      <div className="p-4 space-y-4">
        {isLoading ? (
          <div className="flex justify-center py-12">
            <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary"></div>
          </div>
        ) : myRequests.length === 0 ? (
          <Card>
            <CardContent className="p-8 text-center">
              <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-muted flex items-center justify-center">
                <i className="fas fa-file-alt text-2xl text-muted-foreground"></i>
              </div>
              <p className="font-medium mb-1">No requests yet</p>
              <p className="text-sm text-muted-foreground mb-4">Submit an availability or time-off request to get started.</p>
              <Button onClick={() => navigate('/availability')} variant="outline">
                <i className="fas fa-plus mr-2"></i>New Request
              </Button>
            </CardContent>
          </Card>
        ) : (
          myRequests.map(req => {
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
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="text-xs text-muted-foreground">Dates</div>
                        <div className="text-sm font-medium">
                          {formatDate(req.startDate as unknown as string)}
                          {req.startDate !== req.endDate && (
                            <> - {formatDate(req.endDate as unknown as string)}</>
                          )}
                        </div>
                      </div>
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
          })
        )}
      </div>
    </div>
  );
}
