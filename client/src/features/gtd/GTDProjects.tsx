import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient, invalidatePrefix } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Progress } from "@/components/ui/progress";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  FolderOpen,
  Plus,
  Loader2,
  CalendarDays,
} from "lucide-react";

interface Project {
  id: string;
  title: string;
  description?: string;
  status: string;
  desiredOutcome?: string;
  dueDate?: string;
  progress?: number;
  actionCount?: number;
  completedActionCount?: number;
  createdAt: string;
}

export default function GTDProjects() {
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [formData, setFormData] = useState({
    title: "",
    description: "",
    desired_outcome: "",
    due_date: "",
  });

  const { data, isLoading } = useQuery<{ success: boolean; data: Project[] }>({
    queryKey: ["/api/gtd/projects?status=active"],
  });

  const createMutation = useMutation({
    mutationFn: async (payload: any) => {
      return await apiRequest("POST", "/api/gtd/projects", payload);
    },
    onSuccess: () => {
      invalidatePrefix("/api/gtd/projects");
      queryClient.invalidateQueries({ queryKey: ["/api/gtd/dashboard"] });
      setDialogOpen(false);
      setFormData({ title: "", description: "", desired_outcome: "", due_date: "" });
      toast({ title: "Project created! ✓", duration: 1500 });
    },
    onError: () => {
      toast({ title: "Failed to create project", variant: "destructive" });
    },
  });

  const handleCreate = () => {
    if (!formData.title.trim()) return;
    const payload: any = { title: formData.title.trim() };
    if (formData.description.trim()) payload.description = formData.description.trim();
    if (formData.desired_outcome.trim()) payload.desired_outcome = formData.desired_outcome.trim();
    if (formData.due_date) payload.due_date = formData.due_date;
    createMutation.mutate(payload);
  };

  const projects = data?.data || [];

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

  const getProgress = (project: Project) => {
    if (typeof project.progress === "number") return project.progress;
    if (project.actionCount && project.actionCount > 0) {
      return Math.round(((project.completedActionCount || 0) / project.actionCount) * 100);
    }
    return 0;
  };

  const getActionText = (project: Project) => {
    const completed = project.completedActionCount || 0;
    const total = project.actionCount || 0;
    return `${completed}/${total} actions`;
  };

  return (
    <div className="max-w-2xl mx-auto px-4 py-4 pb-24">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <FolderOpen className="h-5 w-5" />
          <h1 className="text-xl font-bold">Projects</h1>
        </div>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button size="sm">
              <Plus className="h-4 w-4 mr-1" />
              New Project
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>New Project</DialogTitle>
            </DialogHeader>
            <div className="space-y-3 mt-2">
              <Input
                placeholder="Project title *"
                value={formData.title}
                onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleCreate();
                }}
              />
              <Textarea
                placeholder="Description"
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                rows={2}
              />
              <Textarea
                placeholder="Desired outcome — what does done look like?"
                value={formData.desired_outcome}
                onChange={(e) => setFormData({ ...formData, desired_outcome: e.target.value })}
                rows={2}
              />
              <Input
                type="date"
                value={formData.due_date}
                onChange={(e) => setFormData({ ...formData, due_date: e.target.value })}
              />
              <Button
                className="w-full"
                onClick={handleCreate}
                disabled={!formData.title.trim() || createMutation.isPending}
              >
                {createMutation.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                ) : null}
                Create Project
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {isLoading && (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-24 rounded-lg" />
          ))}
        </div>
      )}

      {!isLoading && projects.length === 0 && (
        <div className="text-center py-16">
          <FolderOpen className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
          <h2 className="text-lg font-semibold mb-2">No active projects</h2>
          <p className="text-muted-foreground text-sm">
            Start one from your inbox or create directly.
          </p>
        </div>
      )}

      {!isLoading && projects.length > 0 && (
        <div className="space-y-2">
          {projects.map((project) => {
            const progress = getProgress(project);
            return (
              <Card
                key={project.id}
                className="p-4 cursor-pointer transition-colors hover:bg-accent/50"
                onClick={() => navigate(`/gtd/projects/${project.id}`)}
              >
                <div className="flex items-start justify-between mb-2">
                  <h3 className="font-semibold text-sm leading-snug">{project.title}</h3>
                  {project.dueDate && (
                    <span className={`flex items-center gap-1 text-xs shrink-0 ml-2 ${getDueDateColor(project.dueDate)}`}>
                      <CalendarDays className="h-3 w-3" />
                      {new Date(project.dueDate).toLocaleDateString()}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-3">
                  <Progress value={progress} className="flex-1 h-2" />
                  <span className="text-xs text-muted-foreground whitespace-nowrap">
                    {getActionText(project)}
                  </span>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
