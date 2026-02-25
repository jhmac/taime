import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useLocation, useRoute } from "wouter";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Progress } from "@/components/ui/progress";
import { Input } from "@/components/ui/input";
import {
  ArrowLeft,
  CalendarDays,
  CheckSquare,
  Square,
  Clock,
  FolderOpen,
  Loader2,
  Plus,
  Hourglass,
  FileText,
} from "lucide-react";

interface Action {
  id: string;
  title: string;
  status: string;
  context?: string;
  energyLevel?: string;
  timeEstimateMinutes?: number;
  priority?: string;
  dueDate?: string;
  isTwoMinute?: boolean;
}

interface WaitingItem {
  id: string;
  waitingOn: string;
  description: string;
  followUpDate?: string;
  status: string;
}

interface ReferenceItem {
  id: string;
  title: string;
  content?: string;
}

interface ProjectDetail {
  id: string;
  title: string;
  description?: string;
  status: string;
  desiredOutcome?: string;
  dueDate?: string;
  progress?: number;
  actions?: Action[];
  waitingFor?: WaitingItem[];
  reference?: ReferenceItem[];
}

const CONTEXT_COLORS: Record<string, string> = {
  "@store": "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400",
  "@computer": "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
  "@phone": "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400",
  "@errands": "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400",
  "@anywhere": "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-400",
};

const PRIORITY_COLORS: Record<string, string> = {
  urgent: "bg-red-500",
  high: "bg-orange-500",
  normal: "bg-blue-500",
  low: "bg-gray-400",
};

export default function GTDProjectDetail() {
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const [, params] = useRoute("/gtd/projects/:id");
  const id = params?.id;
  const [newActionTitle, setNewActionTitle] = useState("");

  const { data, isLoading } = useQuery<{ success: boolean; data: ProjectDetail }>({
    queryKey: ["/api/gtd/projects", id],
    enabled: !!id,
  });

  const completeMutation = useMutation({
    mutationFn: async (actionId: string) => {
      return await apiRequest("PUT", `/api/gtd/actions/${actionId}`, { status: "completed" });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/gtd/projects", id] });
      queryClient.invalidateQueries({ queryKey: ["/api/gtd/projects"] });
      queryClient.invalidateQueries({ queryKey: ["/api/gtd/actions"] });
      queryClient.invalidateQueries({ queryKey: ["/api/gtd/dashboard"] });
      toast({ title: "Done! ✓", duration: 1500 });
    },
    onError: () => {
      toast({ title: "Failed to complete action", variant: "destructive" });
    },
  });

  const addActionMutation = useMutation({
    mutationFn: async (title: string) => {
      return await apiRequest("POST", "/api/gtd/actions", {
        title,
        project_id: id,
      });
    },
    onSuccess: () => {
      setNewActionTitle("");
      queryClient.invalidateQueries({ queryKey: ["/api/gtd/projects", id] });
      queryClient.invalidateQueries({ queryKey: ["/api/gtd/projects"] });
      queryClient.invalidateQueries({ queryKey: ["/api/gtd/actions"] });
      queryClient.invalidateQueries({ queryKey: ["/api/gtd/dashboard"] });
      toast({ title: "Action added! ✓", duration: 1500 });
    },
    onError: () => {
      toast({ title: "Failed to add action", variant: "destructive" });
    },
  });

  const completeProjectMutation = useMutation({
    mutationFn: async () => {
      return await apiRequest("PUT", `/api/gtd/projects/${id}`, { status: "completed" });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/gtd/projects", id] });
      queryClient.invalidateQueries({ queryKey: ["/api/gtd/projects"] });
      queryClient.invalidateQueries({ queryKey: ["/api/gtd/dashboard"] });
      toast({ title: "Project complete! 🎉", duration: 2000 });
      navigate("/gtd/projects");
    },
    onError: () => {
      toast({ title: "Failed to complete project", variant: "destructive" });
    },
  });

  const handleAddAction = () => {
    const trimmed = newActionTitle.trim();
    if (!trimmed) return;
    addActionMutation.mutate(trimmed);
  };

  const handleCompleteProject = () => {
    const activeActions = project?.actions?.filter((a) => a.status === "active") || [];
    if (activeActions.length > 0) {
      const confirmed = window.confirm(
        `There are ${activeActions.length} active actions remaining. Complete project anyway?`
      );
      if (!confirmed) return;
    }
    completeProjectMutation.mutate();
  };

  const project = data?.data;
  const actions = project?.actions || [];
  const waitingFor = project?.waitingFor || [];
  const reference = project?.reference || [];

  const activeActions = actions.filter((a) => a.status === "active");
  const completedActions = actions.filter((a) => a.status === "completed");
  const totalActions = actions.length;
  const progress = totalActions > 0 ? Math.round((completedActions.length / totalActions) * 100) : 0;

  const getDueDateColor = (dateStr?: string) => {
    if (!dateStr) return "";
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const due = new Date(dateStr);
    due.setHours(0, 0, 0, 0);
    if (due < today) return "text-red-500";
    if (due.getTime() === today.getTime()) return "text-yellow-600 dark:text-yellow-400";
    return "text-muted-foreground";
  };

  if (isLoading) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-4 pb-24 space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-6 w-full" />
        <Skeleton className="h-20 rounded-lg" />
        <Skeleton className="h-20 rounded-lg" />
        <Skeleton className="h-20 rounded-lg" />
      </div>
    );
  }

  if (!project) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-4">
        <Button variant="ghost" size="sm" onClick={() => navigate("/gtd/projects")}>
          <ArrowLeft className="h-4 w-4 mr-1" /> Back
        </Button>
        <div className="text-center py-16">
          <p className="text-muted-foreground">Project not found.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto px-4 py-4 pb-24">
      <Button variant="ghost" size="sm" className="mb-3" onClick={() => navigate("/gtd/projects")}>
        <ArrowLeft className="h-4 w-4 mr-1" /> Projects
      </Button>

      <div className="mb-4">
        <div className="flex items-start justify-between">
          <h1 className="text-xl font-bold">{project.title}</h1>
          <Badge variant={project.status === "active" ? "default" : "secondary"}>
            {project.status}
          </Badge>
        </div>
        {project.desiredOutcome && (
          <p className="text-sm text-muted-foreground mt-1">{project.desiredOutcome}</p>
        )}
        {project.dueDate && (
          <span className={`flex items-center gap-1 text-xs mt-1 ${getDueDateColor(project.dueDate)}`}>
            <CalendarDays className="h-3 w-3" />
            Due {new Date(project.dueDate).toLocaleDateString()}
          </span>
        )}
      </div>

      <div className="mb-6">
        <div className="flex items-center gap-3 mb-1">
          <Progress value={progress} className="flex-1 h-2" />
          <span className="text-xs text-muted-foreground">{progress}%</span>
        </div>
        <p className="text-xs text-muted-foreground">
          {completedActions.length}/{totalActions} actions completed
        </p>
      </div>

      <div className="mb-6">
        <h2 className="text-sm font-semibold mb-2 flex items-center gap-1.5">
          <Square className="h-4 w-4" /> Next Actions
        </h2>
        <div className="space-y-1.5">
          {activeActions.map((action) => (
            <Card key={action.id} className="p-3">
              <div className="flex items-center gap-3">
                <button
                  onClick={() => completeMutation.mutate(action.id)}
                  className="shrink-0 text-muted-foreground hover:text-foreground transition-colors"
                  disabled={completeMutation.isPending}
                >
                  <Square className="h-4 w-4" />
                </button>
                <div className="flex-1 min-w-0">
                  <span className="text-sm">{action.title}</span>
                  <div className="flex items-center gap-2 mt-0.5">
                    {action.context && (
                      <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${CONTEXT_COLORS[action.context] || CONTEXT_COLORS["@anywhere"]}`}>
                        {action.context}
                      </span>
                    )}
                    {action.timeEstimateMinutes && (
                      <span className="text-[10px] text-muted-foreground flex items-center gap-0.5">
                        <Clock className="h-2.5 w-2.5" /> {action.timeEstimateMinutes}m
                      </span>
                    )}
                    {action.priority && (
                      <span className={`h-2 w-2 rounded-full ${PRIORITY_COLORS[action.priority] || PRIORITY_COLORS.normal}`} />
                    )}
                    {action.dueDate && (
                      <span className={`text-[10px] flex items-center gap-0.5 ${getDueDateColor(action.dueDate)}`}>
                        <CalendarDays className="h-2.5 w-2.5" />
                        {new Date(action.dueDate).toLocaleDateString()}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </Card>
          ))}
          {completedActions.length > 0 && (
            <div className="pt-2">
              <p className="text-xs text-muted-foreground mb-1">{completedActions.length} completed</p>
              {completedActions.map((action) => (
                <div key={action.id} className="flex items-center gap-3 py-1 opacity-50">
                  <CheckSquare className="h-4 w-4 text-green-500 shrink-0" />
                  <span className="text-sm line-through">{action.title}</span>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="flex gap-2 mt-3">
          <Input
            placeholder="Add action..."
            value={newActionTitle}
            onChange={(e) => setNewActionTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleAddAction();
            }}
            className="text-sm"
          />
          <Button
            size="sm"
            onClick={handleAddAction}
            disabled={!newActionTitle.trim() || addActionMutation.isPending}
          >
            {addActionMutation.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Plus className="h-4 w-4" />
            )}
          </Button>
        </div>
      </div>

      {waitingFor.length > 0 && (
        <div className="mb-6">
          <h2 className="text-sm font-semibold mb-2 flex items-center gap-1.5">
            <Hourglass className="h-4 w-4" /> Waiting For
          </h2>
          <div className="space-y-1.5">
            {waitingFor.map((item) => (
              <Card key={item.id} className="p-3">
                <p className="text-sm">{item.description}</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Waiting on: {item.waitingOn}
                </p>
                {item.followUpDate && (
                  <span className={`text-xs flex items-center gap-1 mt-0.5 ${getDueDateColor(item.followUpDate)}`}>
                    <CalendarDays className="h-3 w-3" />
                    Follow up: {new Date(item.followUpDate).toLocaleDateString()}
                  </span>
                )}
              </Card>
            ))}
          </div>
        </div>
      )}

      {reference.length > 0 && (
        <div className="mb-6">
          <h2 className="text-sm font-semibold mb-2 flex items-center gap-1.5">
            <FileText className="h-4 w-4" /> Reference
          </h2>
          <div className="space-y-1.5">
            {reference.map((item) => (
              <Card key={item.id} className="p-3">
                <p className="text-sm font-medium">{item.title}</p>
                {item.content && (
                  <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{item.content}</p>
                )}
              </Card>
            ))}
          </div>
        </div>
      )}

      {project.status === "active" && (
        <Button
          variant="outline"
          className="w-full"
          onClick={handleCompleteProject}
          disabled={completeProjectMutation.isPending}
        >
          {completeProjectMutation.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin mr-2" />
          ) : (
            <FolderOpen className="h-4 w-4 mr-2" />
          )}
          Complete Project
        </Button>
      )}
    </div>
  );
}
