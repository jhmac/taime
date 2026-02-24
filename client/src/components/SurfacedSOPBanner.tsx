import { useState, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useWebSocket } from "@/hooks/useWebSocket";
import { useLocation } from "wouter";
import { X, ClipboardCheck, ChevronRight, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";

interface SurfacedSOP {
  templateId: string;
  title: string;
  category: string;
  reason: string;
  triggerType: "time_based" | "event_based" | "role_based" | "issue_based";
  priority: number;
  trainingModeRecommended: boolean;
  message: string;
}

const TRIGGER_COLORS: Record<string, { bg: string; border: string; icon: string }> = {
  time_based: {
    bg: "bg-amber-50 dark:bg-amber-950/30",
    border: "border-amber-200 dark:border-amber-800/50",
    icon: "text-amber-600 dark:text-amber-400",
  },
  event_based: {
    bg: "bg-blue-50 dark:bg-blue-950/30",
    border: "border-blue-200 dark:border-blue-800/50",
    icon: "text-blue-600 dark:text-blue-400",
  },
  role_based: {
    bg: "bg-purple-50 dark:bg-purple-950/30",
    border: "border-purple-200 dark:border-purple-800/50",
    icon: "text-purple-600 dark:text-purple-400",
  },
  issue_based: {
    bg: "bg-red-50 dark:bg-red-950/30",
    border: "border-red-200 dark:border-red-800/50",
    icon: "text-red-600 dark:text-red-400",
  },
};

export default function SurfacedSOPBanner() {
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();
  const { lastMessage } = useWebSocket();
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());

  const { data: surfacedSOPs = [] } = useQuery<SurfacedSOP[]>({
    queryKey: ["/api/sops/surfaced"],
    refetchInterval: 5 * 60 * 1000,
  });

  useEffect(() => {
    if (!lastMessage) return;
    if (lastMessage.type === "sop_surfaced") {
      queryClient.invalidateQueries({ queryKey: ["/api/sops/surfaced"] });
    }
  }, [lastMessage, queryClient]);

  const visibleSOPs = surfacedSOPs.filter((s) => !dismissed.has(s.templateId));

  if (visibleSOPs.length === 0) return null;

  const handleDismiss = (templateId: string) => {
    setDismissed((prev) => {
      const next = new Set(prev);
      next.add(templateId);
      return next;
    });
  };

  const handleStart = (sop: SurfacedSOP) => {
    navigate(`/sops/${sop.templateId}`);
  };

  return (
    <div className="space-y-2">
      {visibleSOPs.map((sop) => {
        const colors = TRIGGER_COLORS[sop.triggerType] || TRIGGER_COLORS.time_based;

        return (
          <div
            key={sop.templateId}
            className={`rounded-xl border p-3 ${colors.bg} ${colors.border} transition-all animate-in slide-in-from-top-2 duration-300`}
          >
            <div className="flex items-start gap-3">
              <div className={`mt-0.5 shrink-0 ${colors.icon}`}>
                {sop.trainingModeRecommended ? (
                  <Sparkles className="h-5 w-5" />
                ) : (
                  <ClipboardCheck className="h-5 w-5" />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-foreground leading-tight">
                  {sop.message}
                </p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {sop.title}
                  {sop.trainingModeRecommended && (
                    <span className="ml-1.5 inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300">
                      Training Mode
                    </span>
                  )}
                </p>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 px-2 text-xs font-medium"
                  onClick={() => handleStart(sop)}
                >
                  Start <ChevronRight className="h-3 w-3 ml-0.5" />
                </Button>
                <button
                  onClick={() => handleDismiss(sop.templateId)}
                  className="p-1 rounded-full hover:bg-black/5 dark:hover:bg-white/10 transition-colors"
                >
                  <X className="h-3.5 w-3.5 text-muted-foreground" />
                </button>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
