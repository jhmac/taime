import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useAuth } from "@/hooks/useAuth";
import { useWebSocket } from "@/hooks/useWebSocket";
import { useToast } from "@/hooks/use-toast";
import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Inbox, Plus, Loader2, Sparkles, Trash2, RotateCcw,
  MessageSquare, AlertTriangle, ClipboardList, Mic, Zap,
  CheckCircle2,
} from "lucide-react";
import ProcessInboxSheet from "./ProcessInboxSheet";

interface InboxItem {
  id: string;
  rawInput: string;
  source: string;
  status: string;
  aiClarification: any;
  capturedBy: string;
  createdAt: string;
}

const SOURCE_CONFIG: Record<string, { label: string; icon: any; color: string }> = {
  manual: { label: "Manual", icon: Plus, color: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400" },
  quick_capture: { label: "Quick", icon: Zap, color: "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400" },
  voice: { label: "Voice", icon: Mic, color: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400" },
  debrief: { label: "Debrief", icon: MessageSquare, color: "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400" },
  issue_auto: { label: "Issue", icon: AlertTriangle, color: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400" },
  sop_feedback: { label: "SOP", icon: ClipboardList, color: "bg-teal-100 text-teal-700 dark:bg-teal-900/30 dark:text-teal-400" },
  huddle: { label: "Huddle", icon: Sparkles, color: "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400" },
};

function relativeTime(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

export default function GTDInbox() {
  const { user } = useAuth();
  const { lastMessage } = useWebSocket();
  const { toast } = useToast();
  const [showProcessed, setShowProcessed] = useState(false);
  const [selectedItem, setSelectedItem] = useState<InboxItem | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [quickCaptureInput, setQuickCaptureInput] = useState("");

  const { data, isLoading, isError, refetch } = useQuery<{ success: boolean; data: InboxItem[] }>({
    queryKey: ["/api/gtd/inbox", showProcessed ? "all" : "active"],
    queryFn: async () => {
      const url = showProcessed ? "/api/gtd/inbox?status=processed" : "/api/gtd/inbox";
      const authHeaders: Record<string, string> = {};
      try {
        if (typeof window !== 'undefined' && (window as any).Clerk) {
          const token = await (window as any).Clerk.session?.getToken();
          if (token) authHeaders.Authorization = `Bearer ${token}`;
        }
      } catch {}
      const res = await fetch(url, { credentials: "include", headers: authHeaders });
      if (!res.ok) throw new Error("Failed to load inbox");
      return res.json();
    },
  });

  useEffect(() => {
    if (!lastMessage) return;
    if (
      lastMessage.type === "inbox_item_clarified" ||
      lastMessage.type === "inbox_item_created" ||
      lastMessage.type === "inbox_item_processed"
    ) {
      queryClient.invalidateQueries({ queryKey: ["/api/gtd/inbox"] });
      queryClient.invalidateQueries({ queryKey: ["/api/gtd/dashboard"] });
    }
  }, [lastMessage]);

  const captureMutation = useMutation({
    mutationFn: async (rawInput: string) => {
      return await apiRequest("POST", "/api/gtd/inbox", {
        raw_input: rawInput,
        source: "manual",
      });
    },
    onSuccess: () => {
      setQuickCaptureInput("");
      queryClient.invalidateQueries({ queryKey: ["/api/gtd/inbox"] });
      queryClient.invalidateQueries({ queryKey: ["/api/gtd/dashboard"] });
      toast({ title: "Captured! ✓", duration: 1500 });
    },
    onError: () => {
      toast({ title: "Failed to capture", variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      return await apiRequest("DELETE", `/api/gtd/inbox/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/gtd/inbox"] });
      queryClient.invalidateQueries({ queryKey: ["/api/gtd/dashboard"] });
      toast({ title: "Deleted", duration: 1500 });
    },
    onError: () => {
      toast({ title: "Failed to delete", variant: "destructive" });
    },
  });

  const reclarifyMutation = useMutation({
    mutationFn: async (id: string) => {
      return await apiRequest("POST", `/api/gtd/inbox/${id}/reclarify`);
    },
    onSuccess: () => {
      toast({ title: "Re-analyzing...", duration: 1500 });
    },
    onError: () => {
      toast({ title: "Failed to reclarify", variant: "destructive" });
    },
  });

  const items = data?.data || [];
  const activeItems = showProcessed ? items : items.filter(i => i.status !== "processed" && i.status !== "deleted");
  const inboxCount = activeItems.length;

  const handleItemClick = (item: InboxItem) => {
    setSelectedItem(item);
    setSheetOpen(true);
  };

  const handleCapture = () => {
    const trimmed = quickCaptureInput.trim();
    if (!trimmed) return;
    captureMutation.mutate(trimmed);
  };

  return (
    <div className="max-w-2xl mx-auto px-4 py-4 pb-24">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Inbox className="h-5 w-5" />
          <h1 className="text-xl font-bold">Inbox</h1>
          {inboxCount > 0 && (
            <Badge variant="secondary" className="text-xs">{inboxCount}</Badge>
          )}
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setShowProcessed(!showProcessed)}
        >
          {showProcessed ? "Hide processed" : "Show processed"}
        </Button>
      </div>

      <div className="mb-4">
        <div className="flex gap-2">
          <input
            type="text"
            value={quickCaptureInput}
            onChange={(e) => setQuickCaptureInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleCapture();
              }
            }}
            placeholder="Capture something..."
            className="flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          />
          <Button
            onClick={handleCapture}
            disabled={!quickCaptureInput.trim() || captureMutation.isPending}
            size="sm"
          >
            {captureMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
          </Button>
        </div>
      </div>

      {isLoading && (
        <div className="space-y-3">
          {[1, 2, 3].map(i => (
            <Skeleton key={i} className="h-20 rounded-lg" />
          ))}
        </div>
      )}

      {!isLoading && isError && (
        <div className="text-center py-16">
          <AlertTriangle className="h-10 w-10 text-destructive mx-auto mb-3" />
          <h2 className="text-lg font-semibold mb-2">Couldn't load inbox</h2>
          <p className="text-muted-foreground text-sm mb-4">Something went wrong. Please try again.</p>
          <Button variant="outline" onClick={() => refetch()}>
            <RotateCcw className="h-4 w-4 mr-2" />
            Retry
          </Button>
        </div>
      )}

      {!isLoading && !isError && activeItems.length === 0 && (
        <div className="text-center py-16">
          <div className="text-5xl mb-4">🧘</div>
          <h2 className="text-xl font-semibold mb-2">Inbox Zero!</h2>
          <p className="text-muted-foreground">Your mind is clear. Nothing to process.</p>
        </div>
      )}

      {!isLoading && !isError && activeItems.length > 0 && (
        <div className="space-y-2">
          {activeItems.map((item) => {
            const sourceConf = SOURCE_CONFIG[item.source] || SOURCE_CONFIG.manual;
            const SourceIcon = sourceConf.icon;
            const isClarified = item.status === "clarified" && item.aiClarification;
            const isProcessing = item.status === "unprocessed";
            const isProcessed = item.status === "processed";

            return (
              <Card
                key={item.id}
                className={`p-3 cursor-pointer transition-colors hover:bg-accent/50 ${
                  isProcessed ? "opacity-60" : ""
                }`}
                onClick={() => !isProcessed && handleItemClick(item)}
              >
                <div className="flex items-start gap-3">
                  <div className="mt-0.5">
                    {isProcessed ? (
                      <CheckCircle2 className="h-5 w-5 text-green-500" />
                    ) : isClarified ? (
                      <div className="h-5 w-5 rounded-full bg-green-500 flex items-center justify-center">
                        <Sparkles className="h-3 w-3 text-white" />
                      </div>
                    ) : (
                      <Loader2 className="h-5 w-5 text-blue-500 animate-spin" />
                    )}
                  </div>

                  <div className="flex-1 min-w-0">
                    <p className="text-sm leading-snug line-clamp-2">{item.rawInput}</p>

                    <div className="flex items-center gap-2 mt-1.5">
                      <span className={`inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded ${sourceConf.color}`}>
                        <SourceIcon className="h-2.5 w-2.5" />
                        {sourceConf.label}
                      </span>
                      <span className="text-[10px] text-muted-foreground">{relativeTime(item.createdAt)}</span>
                      {isClarified && item.aiClarification?.suggested_destination && (
                        <span className="text-[10px] text-muted-foreground">
                          → {item.aiClarification.suggested_destination.replace("_", " ")}
                        </span>
                      )}
                      {isClarified && item.aiClarification?.is_two_minute && (
                        <span className="text-[10px] text-yellow-600 dark:text-yellow-400 font-medium flex items-center gap-0.5">
                          <Zap className="h-2.5 w-2.5" /> 2min
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-1 shrink-0" onClick={(e) => e.stopPropagation()}>
                    {!isProcessed && (
                      <>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          onClick={() => reclarifyMutation.mutate(item.id)}
                          title="Re-analyze"
                        >
                          <RotateCcw className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-destructive"
                          onClick={() => deleteMutation.mutate(item.id)}
                          title="Delete"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </>
                    )}
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      <ProcessInboxSheet
        item={selectedItem}
        open={sheetOpen}
        onOpenChange={(open) => {
          setSheetOpen(open);
          if (!open) setSelectedItem(null);
        }}
      />
    </div>
  );
}
