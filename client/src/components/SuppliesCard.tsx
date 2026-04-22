import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { apiRequest, queryClient } from '@/lib/queryClient';
import { useToast } from '@/hooks/use-toast';
import { ShoppingCart, Plus, Check, Clock } from 'lucide-react';

type SupplyItem = {
  id: string;
  name: string;
  notes: string | null;
  requestedBy: string;
  requestedByName: string;
  requestedAt: string;
  purchased: boolean;
  purchasedAt: string | null;
};

function formatRelativeTime(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  return `${diffDays}d ago`;
}

export default function SuppliesCard() {
  const { toast } = useToast();
  const [newName, setNewName] = useState('');
  const [newNotes, setNewNotes] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [pendingToggleId, setPendingToggleId] = useState<string | null>(null);

  const { data: supplies, isLoading } = useQuery<SupplyItem[]>({
    queryKey: ['/api/supplies'],
    staleTime: 60_000,
  });

  const toggleMutation = useMutation({
    mutationFn: ({ id, purchased }: { id: string; purchased: boolean }) => {
      setPendingToggleId(id);
      return apiRequest('PATCH', `/api/supplies/${id}`, { purchased });
    },
    onSuccess: () => {
      setPendingToggleId(null);
      queryClient.invalidateQueries({ queryKey: ['/api/supplies'] });
    },
    onError: () => {
      setPendingToggleId(null);
      toast({ title: 'Error', description: 'Could not update supply item.', variant: 'destructive' });
    },
  });

  const createMutation = useMutation({
    mutationFn: (body: { name: string; notes?: string }) =>
      apiRequest('POST', '/api/supplies', body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/supplies'] });
      setNewName('');
      setNewNotes('');
      setShowForm(false);
      toast({ title: 'Supply added', description: 'Supply request created.' });
    },
    onError: () => {
      toast({ title: 'Error', description: 'Could not add supply item.', variant: 'destructive' });
    },
  });

  const handleAdd = () => {
    const trimmed = newName.trim();
    if (!trimmed) return;
    createMutation.mutate({ name: trimmed, notes: newNotes.trim() || undefined });
  };

  const pending = (supplies ?? []).filter((s) => !s.purchased);
  const purchased = (supplies ?? []).filter((s) => s.purchased);

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm flex items-center gap-2">
            <ShoppingCart className="h-4 w-4 text-blue-500" />
            Supplies
            {pending.length > 0 && (
              <Badge variant="secondary" className="ml-1 text-[10px] h-4 px-1.5">
                {pending.length} needed
              </Badge>
            )}
          </CardTitle>
          <Button
            size="sm"
            variant="ghost"
            className="h-7 px-2 text-xs"
            onClick={() => setShowForm((v) => !v)}
          >
            <Plus className="h-3 w-3 mr-1" />
            Add
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {showForm && (
          <div className="p-3 rounded-lg bg-muted/50 border border-border space-y-2">
            <Input
              placeholder="Supply name (e.g. Paper bags)"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              className="h-8 text-sm"
              onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
            />
            <Input
              placeholder="Notes (optional)"
              value={newNotes}
              onChange={(e) => setNewNotes(e.target.value)}
              className="h-8 text-sm"
              onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
            />
            <div className="flex gap-2">
              <Button
                size="sm"
                className="h-7 text-xs flex-1"
                onClick={handleAdd}
                disabled={createMutation.isPending || !newName.trim()}
              >
                {createMutation.isPending ? 'Adding…' : 'Add Supply'}
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-xs"
                onClick={() => { setShowForm(false); setNewName(''); setNewNotes(''); }}
              >
                Cancel
              </Button>
            </div>
          </div>
        )}

        {isLoading ? (
          <div className="space-y-2">
            {[1, 2, 3].map((i) => <Skeleton key={i} className="h-10 w-full" />)}
          </div>
        ) : (supplies ?? []).length === 0 ? (
          <p className="text-xs text-muted-foreground text-center py-3 italic">
            No supply requests this week
          </p>
        ) : (
          <div className="space-y-1.5">
            {pending.length > 0 && (
              <>
                <p className="text-[10px] uppercase tracking-widest text-muted-foreground font-semibold">Needed</p>
                {pending.map((item) => (
                  <SupplyRow
                    key={item.id}
                    item={item}
                    onToggle={(purchased) => toggleMutation.mutate({ id: item.id, purchased })}
                    isPending={toggleMutation.isPending && pendingToggleId === item.id}
                  />
                ))}
              </>
            )}
            {purchased.length > 0 && (
              <>
                <p className="text-[10px] uppercase tracking-widest text-muted-foreground font-semibold mt-2">Purchased</p>
                {purchased.map((item) => (
                  <SupplyRow
                    key={item.id}
                    item={item}
                    onToggle={(purchased) => toggleMutation.mutate({ id: item.id, purchased })}
                    isPending={toggleMutation.isPending && pendingToggleId === item.id}
                  />
                ))}
              </>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function SupplyRow({
  item,
  onToggle,
  isPending,
}: {
  item: SupplyItem;
  onToggle: (purchased: boolean) => void;
  isPending: boolean;
}) {
  return (
    <div
      className={`flex items-start gap-2.5 p-2.5 rounded-lg border transition-colors ${
        item.purchased
          ? 'bg-green-50 dark:bg-green-950/20 border-green-200 dark:border-green-800/30 opacity-70'
          : 'bg-muted/40 border-border'
      }`}
    >
      <button
        onClick={() => onToggle(!item.purchased)}
        disabled={isPending}
        className={`shrink-0 mt-0.5 w-5 h-5 rounded-full border-2 flex items-center justify-center transition-colors ${
          item.purchased
            ? 'bg-green-500 border-green-500 text-white'
            : 'border-muted-foreground/40 hover:border-primary'
        }`}
        aria-label={item.purchased ? 'Mark as not purchased' : 'Mark as purchased'}
      >
        {item.purchased && <Check className="h-3 w-3" />}
      </button>
      <div className="flex-1 min-w-0">
        <p className={`text-sm font-medium leading-tight ${item.purchased ? 'line-through text-muted-foreground' : ''}`}>
          {item.name}
        </p>
        {item.notes && (
          <p className="text-xs text-muted-foreground mt-0.5 truncate">{item.notes}</p>
        )}
        <div className="flex items-center gap-1.5 mt-0.5">
          <Clock className="h-3 w-3 text-muted-foreground/60" />
          <span className="text-[10px] text-muted-foreground">
            {item.requestedByName} · {formatRelativeTime(item.requestedAt)}
          </span>
        </div>
      </div>
    </div>
  );
}
