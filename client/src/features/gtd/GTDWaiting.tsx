import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient, invalidatePrefix } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Clock, Plus, CalendarDays, CheckCircle2, Loader2, AlertTriangle,
} from "lucide-react";

interface WaitingItem {
  id: string;
  waitingOn: string;
  description: string;
  waitingOnEmployeeId?: string;
  followUpDate?: string;
  projectId?: string;
  status: string;
  createdAt: string;
}

function isOverdue(dateStr?: string): boolean {
  if (!dateStr) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return new Date(dateStr) < today;
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

export default function GTDWaiting() {
  const { toast } = useToast();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [formWaitingOn, setFormWaitingOn] = useState("");
  const [formDescription, setFormDescription] = useState("");
  const [formFollowUpDate, setFormFollowUpDate] = useState("");

  const { data, isLoading } = useQuery<{ success: boolean; data: WaitingItem[] }>({
    queryKey: ["/api/gtd/waiting?status=waiting"],
  });

  const markReceivedMutation = useMutation({
    mutationFn: async (id: string) => {
      return await apiRequest("PUT", `/api/gtd/waiting/${id}`, { status: "received" });
    },
    onSuccess: () => {
      invalidatePrefix("/api/gtd/waiting");
      queryClient.invalidateQueries({ queryKey: ["/api/gtd/dashboard"] });
      toast({ title: "Received! ✓", duration: 1500 });
    },
    onError: () => {
      toast({ title: "Failed to update", variant: "destructive" });
    },
  });

  const addMutation = useMutation({
    mutationFn: async (data: { waiting_on: string; description: string; follow_up_date?: string }) => {
      return await apiRequest("POST", "/api/gtd/waiting", data);
    },
    onSuccess: () => {
      invalidatePrefix("/api/gtd/waiting");
      queryClient.invalidateQueries({ queryKey: ["/api/gtd/dashboard"] });
      setDialogOpen(false);
      setFormWaitingOn("");
      setFormDescription("");
      setFormFollowUpDate("");
      toast({ title: "Added! ✓", duration: 1500 });
    },
    onError: () => {
      toast({ title: "Failed to add", variant: "destructive" });
    },
  });

  const handleAdd = () => {
    if (!formWaitingOn.trim() || !formDescription.trim()) return;
    const payload: any = {
      waiting_on: formWaitingOn.trim(),
      description: formDescription.trim(),
    };
    if (formFollowUpDate) payload.follow_up_date = formFollowUpDate;
    addMutation.mutate(payload);
  };

  const items = data?.data || [];
  const sorted = [...items].sort((a, b) => {
    const aOverdue = isOverdue(a.followUpDate) ? 0 : 1;
    const bOverdue = isOverdue(b.followUpDate) ? 0 : 1;
    return aOverdue - bOverdue;
  });

  return (
    <div className="max-w-2xl mx-auto px-4 py-4 pb-24">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Clock className="h-5 w-5" />
          <h1 className="text-xl font-bold">Waiting For</h1>
          {sorted.length > 0 && (
            <Badge variant="secondary" className="text-xs">{sorted.length}</Badge>
          )}
        </div>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button size="sm">
              <Plus className="h-4 w-4 mr-1" /> Add
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Add Waiting Item</DialogTitle>
            </DialogHeader>
            <div className="space-y-3 mt-2">
              <Input
                placeholder="Waiting on (person/thing)..."
                value={formWaitingOn}
                onChange={(e) => setFormWaitingOn(e.target.value)}
              />
              <Input
                placeholder="Description..."
                value={formDescription}
                onChange={(e) => setFormDescription(e.target.value)}
              />
              <div>
                <label className="text-sm text-muted-foreground mb-1 block">Follow-up date (optional)</label>
                <Input
                  type="date"
                  value={formFollowUpDate}
                  onChange={(e) => setFormFollowUpDate(e.target.value)}
                />
              </div>
              <Button
                className="w-full"
                onClick={handleAdd}
                disabled={!formWaitingOn.trim() || !formDescription.trim() || addMutation.isPending}
              >
                {addMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                Add
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {isLoading && (
        <div className="space-y-3">
          {[1, 2, 3].map(i => (
            <Skeleton key={i} className="h-20 rounded-lg" />
          ))}
        </div>
      )}

      {!isLoading && sorted.length === 0 && (
        <div className="text-center py-16">
          <div className="text-5xl mb-4">✓</div>
          <h2 className="text-xl font-semibold mb-2">Nothing pending</h2>
          <p className="text-muted-foreground">You're all caught up! ✓</p>
        </div>
      )}

      {!isLoading && sorted.length > 0 && (
        <div className="space-y-2">
          {sorted.map((item) => {
            const overdue = isOverdue(item.followUpDate);
            return (
              <Card
                key={item.id}
                className={`p-3 ${overdue ? "border-red-400 dark:border-red-600" : ""}`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm leading-snug">{item.description}</p>
                    <p className="text-xs text-muted-foreground mt-1">
                      Waiting on: {item.waitingOn}
                    </p>
                    <div className="flex items-center gap-2 mt-1.5">
                      {item.followUpDate && (
                        <span className={`inline-flex items-center gap-1 text-xs ${overdue ? "text-red-500 dark:text-red-400" : "text-muted-foreground"}`}>
                          <CalendarDays className="h-3 w-3" />
                          {formatDate(item.followUpDate)}
                        </span>
                      )}
                      {overdue && (
                        <Badge variant="destructive" className="text-[10px] px-1.5 py-0">
                          <AlertTriangle className="h-2.5 w-2.5 mr-0.5" />
                          Follow up needed!
                        </Badge>
                      )}
                    </div>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => markReceivedMutation.mutate(item.id)}
                    disabled={markReceivedMutation.isPending}
                    className="shrink-0"
                  >
                    {markReceivedMutation.isPending ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <CheckCircle2 className="h-3.5 w-3.5 mr-1" />
                    )}
                    Received
                  </Button>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}