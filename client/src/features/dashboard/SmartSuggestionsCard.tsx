import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { useEffect, useRef } from "react";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import ErrorWithRetry from "@/components/ErrorWithRetry";
import {
  Sparkles,
  RefreshCw,
  ClipboardList,
  AlertCircle,
  ListChecks,
  Zap,
  Video,
  Star,
  Clock,
  ArrowRight,
} from "lucide-react";

interface TaskSuggestion {
  priority: number;
  type: "task" | "sop" | "issue" | "gtd_action" | "improvement" | "custom";
  entity_id: string | null;
  title: string;
  reason: string;
  time_estimate_minutes: number | null;
  urgency: "overdue" | "due_now" | "upcoming" | "proactive";
}

interface SuggestionsResponse {
  suggestions: TaskSuggestion[];
  context_note: string;
}

const typeIcons: Record<string, typeof ClipboardList> = {
  task: ClipboardList,
  sop: ListChecks,
  issue: AlertCircle,
  gtd_action: Zap,
  improvement: Video,
  custom: Star,
};

const urgencyConfig = {
  overdue: {
    label: "Overdue",
    badgeClass: "bg-red-500 text-white border-0",
    cardClass: "bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800/50 hover:bg-red-100 dark:hover:bg-red-950/50",
    iconBg: "bg-red-500",
    pulse: true,
  },
  due_now: {
    label: "Now",
    badgeClass: "bg-amber-500 text-white border-0",
    cardClass: "bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/50 hover:bg-amber-100 dark:hover:bg-amber-950/50",
    iconBg: "bg-amber-500",
    pulse: false,
  },
  upcoming: {
    label: "Soon",
    badgeClass: "bg-blue-500 text-white border-0",
    cardClass: "bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800/50 hover:bg-blue-100 dark:hover:bg-blue-950/50",
    iconBg: "bg-blue-500",
    pulse: false,
  },
  proactive: {
    label: "Proactive",
    badgeClass: "bg-green-500 text-white border-0",
    cardClass: "bg-green-50 dark:bg-green-950/30 border border-green-200 dark:border-green-800/50 hover:bg-green-100 dark:hover:bg-green-950/50",
    iconBg: "bg-green-500",
    pulse: false,
  },
};

export default function SmartSuggestionsCard() {
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();
  const refreshTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const { data, isLoading, isError, refetch } = useQuery<{ success: boolean; data: SuggestionsResponse }>({
    queryKey: ["/api/ai/suggestions"],
    staleTime: 15 * 60 * 1000,
    refetchOnWindowFocus: false,
  });

  const refreshMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/ai/suggestions/refresh"),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/ai/suggestions"] });
    },
  });

  useEffect(() => {
    refreshTimerRef.current = setInterval(() => {
      queryClient.invalidateQueries({ queryKey: ["/api/ai/suggestions"] });
    }, 30 * 60 * 1000);

    return () => {
      if (refreshTimerRef.current) clearInterval(refreshTimerRef.current);
    };
  }, [queryClient]);

  function handleTap(suggestion: TaskSuggestion) {
    switch (suggestion.type) {
      case "task":
        navigate("/operations");
        break;
      case "sop":
        if (suggestion.entity_id) {
          navigate(`/sops/execute/${suggestion.entity_id}`);
        } else {
          navigate("/sops");
        }
        break;
      case "issue":
        if (suggestion.entity_id) {
          navigate(`/issues/${suggestion.entity_id}`);
        } else {
          navigate("/issues");
        }
        break;
      case "gtd_action":
        navigate("/gtd/actions");
        break;
      case "improvement":
        navigate("/improvements");
        break;
      default:
        break;
    }
  }

  const suggestions = data?.data?.suggestions || [];
  const contextNote = data?.data?.context_note || "What to Focus On";

  if (isLoading) {
    return (
      <Card>
        <CardHeader className="pb-2 px-4 pt-4">
          <Skeleton className="h-5 w-48" />
        </CardHeader>
        <CardContent className="px-4 pb-4 pt-0 space-y-3">
          {[1, 2, 3].map(i => (
            <Skeleton key={i} className="h-16 w-full rounded-2xl" />
          ))}
        </CardContent>
      </Card>
    );
  }

  if (isError) {
    return (
      <Card>
        <CardContent className="px-4 py-4">
          <ErrorWithRetry onRetry={() => refetch()} message="Could not load suggestions" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="overflow-hidden">
      <CardHeader className="pb-2 px-4 pt-4">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-bold flex items-center gap-1.5">
            <Sparkles className="h-4 w-4 text-purple-500" />
            {contextNote}
          </CardTitle>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 w-7 p-0"
            onClick={() => refreshMutation.mutate()}
            disabled={refreshMutation.isPending}
          >
            <RefreshCw className={`h-3.5 w-3.5 ${refreshMutation.isPending ? "animate-spin" : ""}`} />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="px-4 pb-4 pt-0">
        {suggestions.length === 0 ? (
          <div className="text-center py-6 text-muted-foreground text-sm">
            <Sparkles className="h-8 w-8 mx-auto mb-2 text-green-500" />
            <p className="font-medium text-foreground">All caught up!</p>
            <p>No urgent items right now.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {suggestions.map((suggestion, idx) => {
              const Icon = typeIcons[suggestion.type] || Star;
              const urgency = urgencyConfig[suggestion.urgency] || urgencyConfig.upcoming;

              return (
                <button
                  key={idx}
                  onClick={() => handleTap(suggestion)}
                  className={`w-full text-left rounded-2xl p-3.5 transition-all active:scale-[0.98] ${urgency.cardClass} ${
                    urgency.pulse ? "animate-pulse-subtle" : ""
                  }`}
                >
                  <div className="flex items-start gap-3">
                    <div className={`w-9 h-9 rounded-xl ${urgency.iconBg} flex items-center justify-center shrink-0`}>
                      <Icon className="h-4 w-4 text-white" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold truncate">{suggestion.title}</span>
                      </div>
                      <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">
                        {suggestion.reason}
                      </p>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      {suggestion.time_estimate_minutes && (
                        <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-5 font-normal">
                          <Clock className="h-2.5 w-2.5 mr-0.5" />
                          {suggestion.time_estimate_minutes}m
                        </Badge>
                      )}
                      <Badge className={`text-[10px] px-1.5 py-0 h-5 font-medium ${urgency.badgeClass}`}>
                        {urgency.label}
                      </Badge>
                      <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" />
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
