import { useState, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient, invalidatePrefix } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  Zap, Clock, CalendarDays, FolderOpen, Plus, Loader2,
  ListChecks,
} from "lucide-react";
import { useLocation } from "wouter";

interface ActionItem {
  id: string;
  title: string;
  description?: string;
  context?: string;
  energyLevel?: string;
  energy_level?: string;
  timeEstimateMinutes?: number;
  time_estimate_minutes?: number;
  priority?: string;
  dueDate?: string;
  due_date?: string;
  isTwoMinute?: boolean;
  is_two_minute?: boolean;
  projectId?: string;
  project_id?: string;
  projectTitle?: string;
  project_title?: string;
  status?: string;
}

interface ProjectOption {
  id: string;
  title: string;
}

const CONTEXTS = [
  { value: "all", label: "All" },
  { value: "@store", label: "@Store" },
  { value: "@computer", label: "@Computer" },
  { value: "@phone", label: "@Phone" },
  { value: "@errands", label: "@Errands" },
  { value: "@anywhere", label: "@Anywhere" },
];

const CONTEXT_COLORS: Record<string, string> = {
  "@store": "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400",
  "@computer": "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
  "@phone": "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400",
  "@errands": "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400",
  "@anywhere": "bg-gray-100 text-gray-700 dark:bg-gray-800/50 dark:text-gray-400",
};

const PRIORITY_COLORS: Record<string, string> = {
  urgent: "bg-red-500",
  high: "bg-orange-500",
  normal: "bg-blue-500",
  low: "bg-gray-400",
};

const ENERGY_OPTIONS = [
  { value: "all", label: "All Energy" },
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
];

const TIME_OPTIONS = [
  { value: "any", label: "Any Time" },
  { value: "5", label: "< 5 min" },
  { value: "15", label: "< 15 min" },
  { value: "30", label: "< 30 min" },
  { value: "60", label: "< 1 hr" },
];

function getVal<T>(a: T | undefined, b: T | undefined): T | undefined {
  return a !== undefined ? a : b;
}

function isToday(dateStr: string): boolean {
  const d = new Date(dateStr);
  const now = new Date();
  return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
}

function isOverdue(dateStr: string): boolean {
  const d = new Date(dateStr);
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  d.setHours(0, 0, 0, 0);
  return d < now;
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

const PRIORITY_ORDER: Record<string, number> = { urgent: 4, high: 3, normal: 2, low: 1 };

export default function GTDActions() {
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const [contextFilter, setContextFilter] = useState("all");
  const [energyFilter, setEnergyFilter] = useState("all");
  const [timeFilter, setTimeFilter] = useState("any");
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [newAction, setNewAction] = useState({
    title: "",
    context: "",
    priority: "normal",
    time_estimate_minutes: "",
    due_date: "",
    is_two_minute: false,
    project_id: "",
  });

  const queryParams = new URLSearchParams({ status: "active" });
  if (contextFilter !== "all") queryParams.set("context", contextFilter);
  if (energyFilter !== "all") queryParams.set("energy_level", energyFilter);
  const actionsUrl = `/api/gtd/actions?${queryParams.toString()}`;

  const { data, isLoading } = useQuery<{ success: boolean; data: ActionItem[] }>({
    queryKey: [actionsUrl],
  });

  const { data: projectsData } = useQuery<{ success: boolean; data: ProjectOption[] }>({
    queryKey: ["/api/gtd/projects?status=active"],
  });

  const completeMutation = useMutation({
    mutationFn: async (id: string) => {
      return await apiRequest("PUT", `/api/gtd/actions/${id}`, { status: "completed" });
    },
    onSuccess: () => {
      invalidatePrefix("/api/gtd/actions");
      queryClient.invalidateQueries({ queryKey: ["/api/gtd/dashboard"] });
      toast({ title: "Done! ✓", duration: 1500 });
    },
    onError: () => {
      toast({ title: "Failed to complete action", variant: "destructive" });
    },
  });

  const createMutation = useMutation({
    mutationFn: async (data: Record<string, any>) => {
      return await apiRequest("POST", "/api/gtd/actions", data);
    },
    onSuccess: () => {
      invalidatePrefix("/api/gtd/actions");
      queryClient.invalidateQueries({ queryKey: ["/api/gtd/dashboard"] });
      setAddDialogOpen(false);
      setNewAction({ title: "", context: "", priority: "normal", time_estimate_minutes: "", due_date: "", is_two_minute: false, project_id: "" });
      toast({ title: "Action created! ✓", duration: 1500 });
    },
    onError: () => {
      toast({ title: "Failed to create action", variant: "destructive" });
    },
  });

  const items = data?.data || [];
  const projects = projectsData?.data || [];

  const filteredItems = useMemo(() => {
    let result = items;
    if (timeFilter !== "any") {
      const max = parseInt(timeFilter);
      result = result.filter(item => {
        const est = getVal(item.timeEstimateMinutes, item.time_estimate_minutes);
        return !est || est <= max;
      });
    }
    return result;
  }, [items, timeFilter]);

  const { twoMinute, dueToday, active } = useMemo(() => {
    const twoMin: ActionItem[] = [];
    const today: ActionItem[] = [];
    const rest: ActionItem[] = [];

    for (const item of filteredItems) {
      const isTwoMin = getVal(item.isTwoMinute, item.is_two_minute);
      const due = getVal(item.dueDate, item.due_date);
      if (isTwoMin) {
        twoMin.push(item);
      } else if (due && (isToday(due) || isOverdue(due))) {
        today.push(item);
      } else {
        rest.push(item);
      }
    }

    const sortByPriority = (a: ActionItem, b: ActionItem) =>
      (PRIORITY_ORDER[b.priority || "normal"] || 2) - (PRIORITY_ORDER[a.priority || "normal"] || 2);

    today.sort(sortByPriority);
    rest.sort(sortByPriority);

    return { twoMinute: twoMin, dueToday: today, active: rest };
  }, [filteredItems]);

  const handleCreate = () => {
    if (!newAction.title.trim()) return;
    const payload: Record<string, any> = { title: newAction.title.trim() };
    if (newAction.context) payload.context = newAction.context;
    if (newAction.priority) payload.priority = newAction.priority;
    if (newAction.time_estimate_minutes) payload.time_estimate_minutes = parseInt(newAction.time_estimate_minutes);
    if (newAction.due_date) payload.due_date = newAction.due_date;
    if (newAction.is_two_minute) payload.is_two_minute = true;
    if (newAction.project_id) payload.project_id = newAction.project_id;
    createMutation.mutate(payload);
  };

  const renderActionCard = (item: ActionItem) => {
    const ctx = item.context;
    const due = getVal(item.dueDate, item.due_date);
    const est = getVal(item.timeEstimateMinutes, item.time_estimate_minutes);
    const projId = getVal(item.projectId, item.project_id);
    const projTitle = getVal(item.projectTitle, item.project_title);
    const priority = item.priority || "normal";

    return (
      <Card key={item.id} className="p-3">
        <div className="flex items-start gap-3">
          <div className="mt-0.5">
            <Checkbox
              className="h-5 w-5"
              onCheckedChange={() => completeMutation.mutate(item.id)}
            />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium leading-snug">{item.title}</p>
            <div className="flex items-center gap-2 mt-1.5 flex-wrap">
              {ctx && (
                <Badge variant="secondary" className={`text-[10px] px-1.5 py-0 ${CONTEXT_COLORS[ctx] || ""}`}>
                  {ctx}
                </Badge>
              )}
              {est && (
                <span className="text-[10px] text-muted-foreground flex items-center gap-0.5">
                  <Clock className="h-2.5 w-2.5" />{est}m
                </span>
              )}
              <span className={`h-2 w-2 rounded-full ${PRIORITY_COLORS[priority] || PRIORITY_COLORS.normal}`} />
              {projId && (
                <button
                  className="text-[10px] text-muted-foreground flex items-center gap-0.5 hover:text-foreground"
                  onClick={(e) => { e.stopPropagation(); navigate(`/gtd/projects/${projId}`); }}
                >
                  <FolderOpen className="h-2.5 w-2.5" />{projTitle || "Project"}
                </button>
              )}
              {due && (
                <span className={`text-[10px] flex items-center gap-0.5 ${
                  isOverdue(due) ? "text-red-500 font-medium" : isToday(due) ? "text-yellow-600 dark:text-yellow-400" : "text-muted-foreground"
                }`}>
                  <CalendarDays className="h-2.5 w-2.5" />{formatDate(due)}
                </span>
              )}
            </div>
          </div>
        </div>
      </Card>
    );
  };

  return (
    <div className="max-w-2xl mx-auto px-4 py-4 pb-24">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <ListChecks className="h-5 w-5" />
          <h1 className="text-xl font-bold">Next Actions</h1>
        </div>
        <Dialog open={addDialogOpen} onOpenChange={setAddDialogOpen}>
          <DialogTrigger asChild>
            <Button size="sm">
              <Plus className="h-4 w-4 mr-1" />Add Action
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>New Action</DialogTitle>
            </DialogHeader>
            <div className="space-y-3">
              <Input
                placeholder="What needs to be done?"
                value={newAction.title}
                onChange={(e) => setNewAction(prev => ({ ...prev, title: e.target.value }))}
                onKeyDown={(e) => { if (e.key === "Enter") handleCreate(); }}
              />
              <div className="grid grid-cols-2 gap-3">
                <Select value={newAction.context} onValueChange={(v) => setNewAction(prev => ({ ...prev, context: v }))}>
                  <SelectTrigger><SelectValue placeholder="Context" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="@store">@Store</SelectItem>
                    <SelectItem value="@computer">@Computer</SelectItem>
                    <SelectItem value="@phone">@Phone</SelectItem>
                    <SelectItem value="@errands">@Errands</SelectItem>
                    <SelectItem value="@anywhere">@Anywhere</SelectItem>
                  </SelectContent>
                </Select>
                <Select value={newAction.priority} onValueChange={(v) => setNewAction(prev => ({ ...prev, priority: v }))}>
                  <SelectTrigger><SelectValue placeholder="Priority" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="urgent">Urgent</SelectItem>
                    <SelectItem value="high">High</SelectItem>
                    <SelectItem value="normal">Normal</SelectItem>
                    <SelectItem value="low">Low</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Input
                  type="number"
                  placeholder="Time estimate (min)"
                  value={newAction.time_estimate_minutes}
                  onChange={(e) => setNewAction(prev => ({ ...prev, time_estimate_minutes: e.target.value }))}
                />
                <Input
                  type="date"
                  value={newAction.due_date}
                  onChange={(e) => setNewAction(prev => ({ ...prev, due_date: e.target.value }))}
                />
              </div>
              <Select value={newAction.project_id} onValueChange={(v) => setNewAction(prev => ({ ...prev, project_id: v }))}>
                <SelectTrigger><SelectValue placeholder="Project (optional)" /></SelectTrigger>
                <SelectContent>
                  {projects.map(p => (
                    <SelectItem key={p.id} value={p.id}>{p.title}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <div className="flex items-center gap-2">
                <Checkbox
                  id="two-minute"
                  checked={newAction.is_two_minute}
                  onCheckedChange={(checked) => setNewAction(prev => ({ ...prev, is_two_minute: !!checked }))}
                />
                <label htmlFor="two-minute" className="text-sm">Two-minute task</label>
              </div>
              <Button className="w-full" onClick={handleCreate} disabled={!newAction.title.trim() || createMutation.isPending}>
                {createMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                Create Action
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      <div className="mb-3">
        <ToggleGroup
          type="single"
          value={contextFilter}
          onValueChange={(v) => v && setContextFilter(v)}
          className="flex flex-wrap gap-1"
        >
          {CONTEXTS.map(c => (
            <ToggleGroupItem key={c.value} value={c.value} size="sm" className="text-xs px-2.5 py-1 h-7">
              {c.label}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </div>

      <div className="flex gap-2 mb-4">
        <Select value={energyFilter} onValueChange={setEnergyFilter}>
          <SelectTrigger className="w-[140px] h-8 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {ENERGY_OPTIONS.map(o => (
              <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={timeFilter} onValueChange={setTimeFilter}>
          <SelectTrigger className="w-[140px] h-8 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {TIME_OPTIONS.map(o => (
              <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {isLoading && (
        <div className="space-y-3">
          {[1, 2, 3, 4].map(i => (
            <Skeleton key={i} className="h-16 rounded-lg" />
          ))}
        </div>
      )}

      {!isLoading && filteredItems.length === 0 && (
        <div className="text-center py-16">
          <p className="text-muted-foreground">No actions match your filters. Capture something or adjust your filters.</p>
        </div>
      )}

      {!isLoading && filteredItems.length > 0 && (
        <div className="space-y-6">
          {twoMinute.length > 0 && (
            <div>
              <div className="flex items-center gap-2 mb-2">
                <Zap className="h-4 w-4 text-amber-500" />
                <h2 className="text-sm font-semibold">Two-Minute Quick Wins</h2>
              </div>
              <div className="space-y-2 bg-amber-50 dark:bg-amber-950/30 rounded-lg p-2">
                {twoMinute.map(renderActionCard)}
              </div>
            </div>
          )}

          {dueToday.length > 0 && (
            <div>
              <div className="flex items-center gap-2 mb-2">
                <CalendarDays className="h-4 w-4 text-blue-500" />
                <h2 className="text-sm font-semibold">Due Today</h2>
              </div>
              <div className="space-y-2">
                {dueToday.map(renderActionCard)}
              </div>
            </div>
          )}

          {active.length > 0 && (
            <div>
              <div className="flex items-center gap-2 mb-2">
                <ListChecks className="h-4 w-4 text-muted-foreground" />
                <h2 className="text-sm font-semibold">Active Actions</h2>
              </div>
              <div className="space-y-2">
                {active.map(renderActionCard)}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
