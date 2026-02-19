import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useLocation } from 'wouter';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';

interface AvailabilityRequest {
  id: string;
  userId: string;
  type: string;
  status: string;
  startDate: string;
  endDate?: string;
  notes?: string;
  createdAt: string;
}

export default function Requests() {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [, navigate] = useLocation();

  const { data: requests = [], isLoading } = useQuery<AvailabilityRequest[]>({
    queryKey: ['/api/availability-requests'],
    retry: 1,
  });

  const cancelMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/availability-requests/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Failed to cancel');
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/availability-requests'] });
      toast({ title: 'Request cancelled' });
    },
    onError: () => {
      toast({ title: 'Error', description: 'Could not cancel request', variant: 'destructive' });
    },
  });

  const myRequests = requests.filter(r => r.userId === user?.id);
  const initials = `${(user?.firstName || '')[0] || ''}${(user?.lastName || '')[0] || ''}`.toUpperCase();

  const formatDate = (d: string) => new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  const formatTime = (d: string) => new Date(d).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });

  const statusColors: Record<string, string> = {
    pending: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400',
    approved: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
    denied: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
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
          myRequests.map(req => (
            <Card key={req.id}>
              <CardContent className="p-4">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    {req.type === 'time-off' ? 'Time Off Request' : 'Availability Request'}
                  </span>
                  <span className="text-xs text-muted-foreground">{formatTime(req.createdAt)}</span>
                </div>

                <div className="flex items-center gap-3 mb-3">
                  <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-primary text-xs font-semibold">
                    {initials}
                  </div>
                  <span className="text-sm font-medium">{user?.firstName} {user?.lastName}</span>
                </div>

                <Badge className={`text-xs mb-3 ${statusColors[req.status] || statusColors.pending}`}>
                  {req.status === 'pending' ? 'Pending approval' : req.status.charAt(0).toUpperCase() + req.status.slice(1)}
                </Badge>

                <Card className="bg-muted/30">
                  <CardContent className="p-3">
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="text-xs text-muted-foreground">Start date</div>
                        <div className="text-sm font-medium">{formatDate(req.startDate)}</div>
                        {req.notes && <div className="text-xs text-muted-foreground mt-1">{req.notes}</div>}
                      </div>
                      <i className="fas fa-chevron-right text-xs text-muted-foreground"></i>
                    </div>
                  </CardContent>
                </Card>

                {req.status === 'pending' && (
                  <Button
                    variant="outline"
                    className="w-full mt-3 text-destructive border-destructive/30 hover:bg-destructive/5"
                    onClick={() => cancelMutation.mutate(req.id)}
                    disabled={cancelMutation.isPending}
                  >
                    Cancel request
                  </Button>
                )}
              </CardContent>
            </Card>
          ))
        )}
      </div>
    </div>
  );
}
