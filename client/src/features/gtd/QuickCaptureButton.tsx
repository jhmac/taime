import { useState, useRef, useEffect } from "react";
import {
  Drawer, DrawerContent, DrawerHeader, DrawerTitle, DrawerFooter,
} from "@/components/ui/drawer";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Inbox, CheckCircle2, Loader2 } from "lucide-react";

interface MySubmission {
  id: string;
  rawInput: string;
  source: string;
  status: string;
  processedIntoType: string | null;
  createdAt: string;
}

type StatusKey = "received" | "in_review" | "resolved" | "dismissed";

const STATUS_META: Record<StatusKey, { label: string; className: string }> = {
  received: {
    label: "Received",
    className: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
  },
  in_review: {
    label: "In Review",
    className: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300",
  },
  resolved: {
    label: "Resolved",
    className: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300",
  },
  dismissed: {
    label: "Dismissed",
    className: "bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300",
  },
};

function deriveStatus(item: MySubmission): StatusKey {
  if (item.status === "deleted") return "dismissed";
  if (item.status === "processed") return "resolved";
  if (item.status === "clarified") return "in_review";
  return "received";
}

function relativeTime(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.floor(months / 12)}y ago`;
}

function formatExactDate(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function MySubmissionsList({ isAdmin }: { isAdmin: boolean }) {
  const { toast } = useToast();

  const { data, isLoading, isError, refetch } = useQuery<{ success: boolean; data: MySubmission[] }>({
    queryKey: ["/api/gtd/inbox", "my-submissions"],
    queryFn: async () => {
      const url = "/api/gtd/inbox?source=quick_capture&status=all&captured_by=me&limit=50";
      const authHeaders: Record<string, string> = {};
      try {
        if (typeof window !== "undefined" && (window as any).Clerk) {
          const token = await (window as any).Clerk.session?.getToken();
          if (token) authHeaders.Authorization = `Bearer ${token}`;
        }
      } catch {}
      const res = await fetch(url, { credentials: "include", headers: authHeaders });
      if (!res.ok) throw new Error("Failed to load submissions");
      return res.json();
    },
  });

  const resolveMutation = useMutation({
    mutationFn: async (id: string) => {
      return await apiRequest("POST", `/api/gtd/inbox/${id}/resolve`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/gtd/inbox"] });
      queryClient.invalidateQueries({ queryKey: ["/api/gtd/dashboard"] });
      toast({ title: "Marked as resolved", duration: 1500 });
    },
    onError: () => {
      toast({ title: "Failed to mark resolved", variant: "destructive" });
    },
  });

  const items = data?.data ?? [];

  if (isLoading) {
    return (
      <div className="space-y-2" data-testid="my-submissions-loading">
        {[1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-16 rounded-lg" />
        ))}
      </div>
    );
  }

  if (isError) {
    return (
      <div className="text-center py-8" data-testid="my-submissions-error">
        <p className="text-sm text-muted-foreground mb-3">Couldn't load your submissions.</p>
        <Button variant="outline" size="sm" onClick={() => refetch()}>
          Retry
        </Button>
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="text-center py-8" data-testid="my-submissions-empty">
        <Inbox className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
        <p className="text-sm text-muted-foreground">
          You haven't sent any submissions yet.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-2" data-testid="my-submissions-list">
      {items.map((item) => {
        const statusKey = deriveStatus(item);
        const meta = STATUS_META[statusKey];
        const canResolve = isAdmin && statusKey !== "resolved" && statusKey !== "dismissed";
        return (
          <div
            key={item.id}
            className="rounded-lg border bg-card p-3"
            data-testid={`submission-item-${item.id}`}
          >
            <div className="flex items-start justify-between gap-2 mb-1.5">
              <span
                className={`inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded ${meta.className}`}
                data-testid={`submission-status-${item.id}`}
              >
                {statusKey === "resolved" && <CheckCircle2 className="h-2.5 w-2.5" />}
                {meta.label}
              </span>
              <span
                className="text-[10px] text-muted-foreground shrink-0"
                title={formatExactDate(item.createdAt)}
              >
                {relativeTime(item.createdAt)}
              </span>
            </div>
            <p className="text-sm leading-snug whitespace-pre-wrap break-words">
              {item.rawInput}
            </p>
            {canResolve && (
              <div className="mt-2 flex justify-end">
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 text-xs"
                  onClick={() => resolveMutation.mutate(item.id)}
                  disabled={resolveMutation.isPending}
                  data-testid={`button-resolve-${item.id}`}
                >
                  {resolveMutation.isPending && resolveMutation.variables === item.id ? (
                    <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                  ) : (
                    <CheckCircle2 className="h-3 w-3 mr-1" />
                  )}
                  Mark resolved
                </Button>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

export default function QuickCaptureButton() {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<"submit" | "history">("submit");
  const [input, setInput] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const { toast } = useToast();
  const { user } = useAuth();
  const roleName = user?.role?.name;
  const isAdmin = roleName === "owner" || roleName === "admin";

  useEffect(() => {
    const handler = () => {
      setTab("submit");
      setOpen(true);
    };
    window.addEventListener("open-let-us-know", handler);
    return () => window.removeEventListener("open-let-us-know", handler);
  }, []);

  useEffect(() => {
    if (open && tab === "submit" && textareaRef.current) {
      setTimeout(() => textareaRef.current?.focus(), 100);
    }
  }, [open, tab]);

  const captureMutation = useMutation({
    mutationFn: async (rawInput: string) => {
      return await apiRequest("POST", "/api/gtd/inbox", {
        raw_input: rawInput,
        source: "quick_capture",
      });
    },
    onSuccess: () => {
      setInput("");
      queryClient.invalidateQueries({ queryKey: ["/api/gtd/inbox"] });
      queryClient.invalidateQueries({ queryKey: ["/api/gtd/dashboard"] });
      toast({ title: "Captured! ✓", duration: 1500 });
      if (textareaRef.current) {
        textareaRef.current.focus();
      }
    },
    onError: () => {
      toast({ title: "Failed to capture", variant: "destructive" });
    },
  });

  const handleCapture = () => {
    const trimmed = input.trim();
    if (!trimmed) return;
    captureMutation.mutate(trimmed);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleCapture();
    }
  };

  return (
    <Drawer open={open} onOpenChange={setOpen}>
      <DrawerContent className="max-h-[70vh]">
        <DrawerHeader className="pb-2">
          <DrawerTitle className="text-lg">Let us Know</DrawerTitle>
        </DrawerHeader>

        <Tabs value={tab} onValueChange={(v) => setTab(v as "submit" | "history")} className="px-6">
          <TabsList className="grid w-full grid-cols-2 h-9">
            <TabsTrigger value="submit" className="text-xs" data-testid="tab-submit">
              New
            </TabsTrigger>
            <TabsTrigger value="history" className="text-xs" data-testid="tab-history">
              My Submissions
            </TabsTrigger>
          </TabsList>

          <TabsContent value="submit" className="mt-3">
            <Textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="What's on your mind?"
              className="min-h-[80px] text-base resize-none"
              maxLength={2000}
              data-testid="input-let-us-know"
            />
            <p className="text-xs text-muted-foreground mt-1">
              Press Enter to capture, Shift+Enter for new line
            </p>
          </TabsContent>

          <TabsContent value="history" className="mt-3">
            <div className="max-h-[40vh] overflow-y-auto -mx-1 px-1">
              <MySubmissionsList isAdmin={isAdmin} />
            </div>
          </TabsContent>
        </Tabs>

        {tab === "submit" ? (
          <DrawerFooter className="pt-2 px-6 flex-row gap-2">
            <Button
              onClick={handleCapture}
              disabled={!input.trim() || captureMutation.isPending}
              className="flex-1"
              data-testid="button-submit-let-us-know"
            >
              {captureMutation.isPending ? "Submitting..." : "Submit"}
            </Button>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Done
            </Button>
          </DrawerFooter>
        ) : (
          <DrawerFooter className="pt-2 px-6">
            <Button variant="outline" onClick={() => setOpen(false)}>
              Close
            </Button>
          </DrawerFooter>
        )}
      </DrawerContent>
    </Drawer>
  );
}
