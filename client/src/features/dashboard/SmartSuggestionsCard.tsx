import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { useAuth } from "@/hooks/useAuth";
import { apiRequest } from "@/lib/queryClient";
import { Skeleton } from "@/components/ui/skeleton";
import { Sparkles, ChevronDown, CheckCircle2, Circle } from "lucide-react";
import type { Task } from "@shared/schema";

interface TaskSuggestion {
  priority: number;
  type: "task" | "sop" | "issue" | "gtd_action" | "improvement" | "custom";
  entity_id: string | null;
  title: string;
  reason: string;
  time_estimate_minutes: number | null;
  urgency: "overdue" | "due_now" | "upcoming" | "proactive";
}

const urgencyBadge: Record<string, { label: string; className: string }> = {
  overdue: { label: "Overdue", className: "bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400" },
  due_now: { label: "Now", className: "bg-orange-100 text-orange-600 dark:bg-orange-900/30 dark:text-orange-400" },
  upcoming: { label: "Soon", className: "bg-blue-100 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400" },
  proactive: { label: "Soon", className: "bg-blue-100 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400" },
};

function getTimeLabel(task: Task): string | null {
  if (task.timeOfDay) {
    const map: Record<string, string> = {
      morning: "9 AM",
      afternoon: "1 PM",
      evening: "5 PM",
      closing: "8 PM",
      opening: "8 AM",
    };
    return map[task.timeOfDay] ?? task.timeOfDay;
  }
  if (task.dueDate) {
    const d = new Date(task.dueDate);
    const now = new Date();
    const diffMs = d.getTime() - now.getTime();
    if (Math.abs(diffMs) < 30 * 60 * 1000) return "Now";
    return d.toLocaleTimeString("en-US", { hour: "numeric", hour12: true });
  }
  return null;
}

function TaskRow({
  task,
  onToggle,
  isPending,
}: {
  task: Task;
  onToggle: (id: string, status: string) => void;
  isPending: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const isCompleted = task.status === "completed";
  const hasDescription = !!(task.description?.trim());
  const timeLabel = getTimeLabel(task);
  const isNow = timeLabel === "Now";

  return (
    <div className="border-t border-border/40 first:border-t-0">
      <div className="flex items-center gap-3 px-4 py-3.5">
        {/* Checkbox — clicking it toggles completion */}
        <button
          onClick={() => onToggle(task.id, isCompleted ? "pending" : "completed")}
          disabled={isPending}
          className="flex-shrink-0 active:scale-90 transition-transform"
          aria-label={isCompleted ? "Mark incomplete" : "Mark complete"}
        >
          {isCompleted ? (
            <CheckCircle2 className="h-[22px] w-[22px] text-green-500" />
          ) : (
            <Circle className="h-[22px] w-[22px] text-muted-foreground/40" />
          )}
        </button>

        {/* Title — also tappable to complete */}
        <button
          className="flex-1 text-left"
          onClick={() => onToggle(task.id, isCompleted ? "pending" : "completed")}
          disabled={isPending}
        >
          <span
            className={`text-[15px] font-semibold leading-snug ${
              isCompleted
                ? "line-through text-muted-foreground"
                : "text-foreground"
            }`}
          >
            {task.title}
          </span>
        </button>

        {/* Right: time badge + optional expand arrow */}
        <div className="flex items-center gap-2 flex-shrink-0">
          {timeLabel && (
            <span
              className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
                isNow
                  ? "bg-orange-100 text-orange-600 dark:bg-orange-900/30 dark:text-orange-400"
                  : "text-muted-foreground"
              }`}
            >
              {timeLabel}
            </span>
          )}
          {hasDescription && (
            <button
              onClick={() => setExpanded((v) => !v)}
              className="text-muted-foreground active:scale-90 transition-transform"
              aria-label={expanded ? "Collapse notes" : "Expand notes"}
            >
              <ChevronDown
                className={`h-4 w-4 transition-transform duration-200 ${
                  expanded ? "rotate-180" : ""
                }`}
              />
            </button>
          )}
        </div>
      </div>

      {/* Expanded description */}
      {hasDescription && expanded && (
        <div className="px-4 pb-4 -mt-1">
          <div className="ml-[34px] bg-muted/60 rounded-xl p-3">
            <p className="text-xs text-muted-foreground leading-relaxed whitespace-pre-wrap">
              {task.description}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

function SuggestionRow({ suggestion, onTap }: { suggestion: TaskSuggestion; onTap: () => void }) {
  const badge = urgencyBadge[suggestion.urgency] ?? urgencyBadge.upcoming;
  return (
    <div className="border-t border-border/40">
      <button className="w-full flex items-center gap-3 px-4 py-3.5 text-left active:bg-muted/40 transition-colors" onClick={onTap}>
        <Circle className="h-[22px] w-[22px] text-muted-foreground/40 flex-shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-[15px] font-semibold leading-snug text-foreground truncate">{suggestion.title}</p>
          <p className="text-xs text-muted-foreground mt-0.5 truncate">{suggestion.reason}</p>
        </div>
        <span className={`text-xs font-semibold px-2 py-0.5 rounded-full flex-shrink-0 ${badge.className}`}>
          {badge.label}
        </span>
      </button>
    </div>
  );
}

export default function SmartSuggestionsCard() {
  const { user } = useAuth();
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();
  const roleName = user?.role?.name;
  const isAdminOrOwner = roleName === "admin" || roleName === "owner";

  const { data: allTasks = [], isLoading: tasksLoading } = useQuery<Task[]>({
    queryKey: ["/api/tasks"],
    staleTime: 30_000,
  });

  const { data: suggestionsRes, isLoading: suggestionsLoading } = useQuery<{
    success: boolean;
    data: { suggestions: TaskSuggestion[]; context_note: string };
  }>({
    queryKey: ["/api/ai/suggestions"],
    staleTime: 15 * 60 * 1000,
    refetchOnWindowFocus: false,
  });

  const toggleMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) =>
      apiRequest("PATCH", `/api/tasks/${id}`, { status }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/tasks"] }),
  });

  const myTasks = allTasks.filter(
    (t) => t.assignedTo === user?.id && t.status !== "completed"
  );

  const suggestions = suggestionsRes?.data?.suggestions ?? [];

  const isLoading = tasksLoading || suggestionsLoading;
  const hasContent = myTasks.length > 0 || suggestions.length > 0;

  function handleSuggestionTap(s: TaskSuggestion) {
    switch (s.type) {
      case "sop":
        navigate(s.entity_id ? `/sops/execute/${s.entity_id}` : "/sops");
        break;
      case "issue":
        navigate(s.entity_id ? `/issues/${s.entity_id}` : "/issues");
        break;
      case "gtd_action":
        navigate("/gtd/actions");
        break;
      case "improvement":
        navigate("/improvements");
        break;
      case "custom":
        if (s.entity_id === "brain_boost") {
          window.dispatchEvent(new CustomEvent("open-brain-boost"));
        } else if (s.entity_id === "daily_training") {
          navigate("/sops/training");
        }
        break;
      default:
        navigate(isAdminOrOwner ? "/operations" : "/tasks");
    }
  }

  return (
    <div className="bg-card dark:bg-card rounded-2xl border border-border overflow-hidden shadow-sm">
      {/* Header */}
      <div className="flex items-center justify-between px-4 pt-4 pb-3">
        <div className="flex items-center gap-1.5">
          <Sparkles className="h-4 w-4 text-purple-500" />
          <span className="text-sm font-bold text-foreground">
            Here's what to focus on right now.
          </span>
        </div>
        <button
          onClick={() => navigate("/tasks")}
          className="text-xs font-bold text-primary"
        >
          See all
        </button>
      </div>

      {isLoading ? (
        <div className="px-4 pb-4 space-y-2">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-14 w-full rounded-xl" />
          ))}
        </div>
      ) : !hasContent ? (
        <div className="px-4 pb-6 text-center">
          <CheckCircle2 className="h-8 w-8 mx-auto mb-2 text-green-500" />
          <p className="font-medium text-foreground text-sm">All caught up!</p>
          <p className="text-xs text-muted-foreground">No urgent items right now.</p>
        </div>
      ) : (
        <div className="pb-2">
          {myTasks.map((task) => (
            <TaskRow
              key={task.id}
              task={task}
              onToggle={(id, status) => toggleMutation.mutate({ id, status })}
              isPending={toggleMutation.isPending}
            />
          ))}
          {suggestions.map((s, i) => (
            <SuggestionRow key={i} suggestion={s} onTap={() => handleSuggestionTap(s)} />
          ))}
        </div>
      )}
    </div>
  );
}
