import { useState, useMemo } from 'react';
import { useOnlineRetry } from '@/hooks/useOnlineRetry';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/hooks/useAuth';
import { apiRequest } from '@/lib/queryClient';
import { useToast } from '@/hooks/use-toast';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Skeleton } from '@/components/ui/skeleton';
import { Heart, Send, Loader2 } from 'lucide-react';
import ErrorWithRetry from '@/components/ErrorWithRetry';

function getInitials(firstName?: string | null, lastName?: string | null): string {
  return ((firstName?.[0] || '') + (lastName?.[0] || '')).toUpperCase() || '?';
}

function timeAgo(date: string): string {
  const seconds = Math.floor((Date.now() - new Date(date).getTime()) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export default function KudosWidget() {
  const { user } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [selectedRecipient, setSelectedRecipient] = useState<string | null>(null);
  const [message, setMessage] = useState('');

  const { data: kudosData, isLoading, isError, refetch, isFetching } = useQuery<{ success: boolean; data: any[] }>({
    queryKey: ['/api/kudos'],
  });

  const { data: teamData } = useQuery<any[]>({
    queryKey: ['/api/users'],
  });

  const kudosList = kudosData?.data ?? [];
  const team = (teamData ?? []).filter((u: any) => u.id !== user?.id && u.isActive !== false);

  const sendMutation = useMutation({
    mutationFn: async () => {
      return await apiRequest('POST', '/api/kudos', {
        toEmployeeId: selectedRecipient,
        message: message.trim(),
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['/api/kudos'] });
      setDialogOpen(false);
      setSelectedRecipient(null);
      setMessage('');
      toast({ title: 'Kudo sent!', description: 'Your teammate will love this.' });
    },
    onError: () => {
      toast({ title: 'Error', description: 'Failed to send kudo', variant: 'destructive' });
    },
  });

  const charsLeft = 280 - message.length;

  useOnlineRetry(refetch, isError);

  if (isLoading) {
    return (
      <Card>
        <CardContent className="p-4 space-y-3">
          <Skeleton className="h-5 w-32" />
          <Skeleton className="h-16 w-full" />
        </CardContent>
      </Card>
    );
  }

  if (isError) {
    return <ErrorWithRetry onRetry={() => refetch()} message="Failed to load kudos" isRetrying={isFetching} />;
  }

  return (
    <>
      <Card>
        <CardContent className="p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold flex items-center gap-1.5">
              <Heart className="h-4 w-4 text-pink-500" />
              Team Kudos
            </h3>
            <Button
              size="sm"
              variant="outline"
              className="h-8 text-xs rounded-full gap-1"
              onClick={() => setDialogOpen(true)}
            >
              <Heart className="h-3 w-3" />
              Give a Kudo
            </Button>
          </div>

          {kudosList.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">
              No kudos yet this week. Be the first to recognize a teammate!
            </p>
          ) : (
            <div className="space-y-3 max-h-[240px] overflow-auto">
              {kudosList.slice(0, 7).map((k: any) => (
                <div key={k.id} className="flex gap-2.5 items-start">
                  <div className="h-7 w-7 rounded-full bg-pink-100 dark:bg-pink-900/30 flex items-center justify-center text-[10px] font-bold text-pink-600 dark:text-pink-400 shrink-0">
                    {k.fromName?.split(' ').map((w: string) => w[0]).join('').slice(0, 2).toUpperCase() || '?'}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs">
                      <span className="font-semibold">{k.fromName}</span>
                      <span className="text-muted-foreground"> &rarr; </span>
                      <span className="font-semibold">{k.toName}</span>
                    </p>
                    <p className="text-xs text-muted-foreground mt-0.5">"{k.message}"</p>
                    <p className="text-[10px] text-muted-foreground/60 mt-0.5">{timeAgo(k.createdAt)}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Heart className="h-5 w-5 text-pink-500" />
              Give a Kudo
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div>
              <p className="text-sm font-medium mb-2">Who deserves recognition?</p>
              <div className="grid grid-cols-4 sm:grid-cols-5 gap-2 max-h-[200px] overflow-auto">
                {team.map((u: any) => {
                  const selected = selectedRecipient === u.id;
                  return (
                    <button
                      key={u.id}
                      type="button"
                      onClick={() => setSelectedRecipient(u.id)}
                      className={`flex flex-col items-center gap-1 p-2 rounded-xl border-2 transition-all ${
                        selected
                          ? 'border-pink-400 bg-pink-50 dark:bg-pink-950/30'
                          : 'border-transparent hover:border-muted-foreground/20'
                      }`}
                    >
                      <Avatar className="h-10 w-10">
                        <AvatarFallback className={`text-xs font-bold ${selected ? 'bg-pink-200 dark:bg-pink-800 text-pink-700 dark:text-pink-300' : ''}`}>
                          {getInitials(u.firstName, u.lastName)}
                        </AvatarFallback>
                      </Avatar>
                      <span className="text-[10px] font-medium leading-tight text-center truncate w-full">
                        {u.firstName || u.email?.split('@')[0]}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between mb-1">
                <p className="text-sm font-medium">Your message</p>
                <span className={`text-[10px] ${charsLeft < 20 ? 'text-red-500' : 'text-muted-foreground'}`}>
                  {charsLeft}
                </span>
              </div>
              <Textarea
                placeholder="What did they do that was awesome?"
                value={message}
                onChange={e => setMessage(e.target.value.slice(0, 280))}
                className="min-h-[80px] text-sm resize-none"
              />
            </div>

            <Button
              className="w-full min-h-[44px] font-semibold rounded-xl gap-2"
              disabled={!selectedRecipient || !message.trim() || sendMutation.isPending}
              onClick={() => sendMutation.mutate()}
            >
              {sendMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              Send Kudo
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
