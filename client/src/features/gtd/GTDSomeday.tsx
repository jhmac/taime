import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
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
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Lightbulb, Plus, Loader2, FolderOpen, Zap, Sparkles,
} from "lucide-react";

interface SomedayItem {
  id: string;
  title: string;
  description?: string;
  category?: string;
  status: string;
  createdAt: string;
}

export default function GTDSomeday() {
  const { toast } = useToast();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [formTitle, setFormTitle] = useState("");
  const [formDescription, setFormDescription] = useState("");
  const [formCategory, setFormCategory] = useState("");

  const { data, isLoading } = useQuery<{ success: boolean; data: SomedayItem[] }>({
    queryKey: ["/api/gtd/someday?status=parked"],
  });

  const addMutation = useMutation({
    mutationFn: async (payload: { title: string; description?: string; category?: string }) => {
      return await apiRequest("POST", "/api/gtd/someday", payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/gtd/someday"] });
      queryClient.invalidateQueries({ queryKey: ["/api/gtd/dashboard"] });
      setDialogOpen(false);
      setFormTitle("");
      setFormDescription("");
      setFormCategory("");
      toast({ title: "Idea saved! 🌱", duration: 1500 });
    },
    onError: () => {
      toast({ title: "Failed to add", variant: "destructive" });
    },
  });

  const activateMutation = useMutation({
    mutationFn: async ({ id, activate_as }: { id: string; activate_as: string }) => {
      return await apiRequest("PUT", `/api/gtd/someday/${id}`, { activate_as });
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ["/api/gtd/someday"] });
      queryClient.invalidateQueries({ queryKey: ["/api/gtd/dashboard"] });
      queryClient.invalidateQueries({ queryKey: ["/api/gtd/projects"] });
      queryClient.invalidateQueries({ queryKey: ["/api/gtd/actions"] });
      const type = variables.activate_as === "project" ? "Project" : "Next Action";
      toast({ title: `Activated as ${type}! 🌱`, duration: 1500 });
    },
    onError: () => {
      toast({ title: "Failed to activate", variant: "destructive" });
    },
  });

  const handleAdd = () => {
    if (!formTitle.trim()) return;
    const payload: any = { title: formTitle.trim() };
    if (formDescription.trim()) payload.description = formDescription.trim();
    if (formCategory.trim()) payload.category = formCategory.trim();
    addMutation.mutate(payload);
  };

  const items = data?.data || [];

  const grouped = items.reduce<Record<string, SomedayItem[]>>((acc, item) => {
    const key = item.category || "Uncategorized";
    if (!acc[key]) acc[key] = [];
    acc[key].push(item);
    return acc;
  }, {});

  const categories = Object.keys(grouped).sort();
  const hasCategories = categories.length > 1 || (categories.length === 1 && categories[0] !== "Uncategorized");

  return (
    <div className="max-w-2xl mx-auto px-4 py-4 pb-24">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <Lightbulb className="h-5 w-5" />
          <h1 className="text-xl font-bold">Someday / Maybe</h1>
        </div>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button size="sm">
              <Plus className="h-4 w-4 mr-1" /> Add Idea
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Add Idea</DialogTitle>
            </DialogHeader>
            <div className="space-y-3 mt-2">
              <Input
                placeholder="Title..."
                value={formTitle}
                onChange={(e) => setFormTitle(e.target.value)}
              />
              <Textarea
                placeholder="Description (optional)..."
                value={formDescription}
                onChange={(e) => setFormDescription(e.target.value)}
                rows={3}
              />
              <Input
                placeholder="Category (optional)..."
                value={formCategory}
                onChange={(e) => setFormCategory(e.target.value)}
              />
              <Button
                className="w-full"
                onClick={handleAdd}
                disabled={!formTitle.trim() || addMutation.isPending}
              >
                {addMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                Save Idea
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      <p className="text-sm text-muted-foreground mb-4">
        These are your seeds. When the time is right, plant one.
      </p>

      {isLoading && (
        <div className="space-y-3">
          {[1, 2, 3].map(i => (
            <Skeleton key={i} className="h-20 rounded-lg" />
          ))}
        </div>
      )}

      {!isLoading && items.length === 0 && (
        <div className="text-center py-16">
          <div className="text-5xl mb-4">🌱</div>
          <h2 className="text-xl font-semibold mb-2">Your garden is empty</h2>
          <p className="text-muted-foreground">Plant some seeds — capture ideas without pressure. 🌱</p>
        </div>
      )}

      {!isLoading && items.length > 0 && (
        <div className="space-y-4">
          {hasCategories ? (
            categories.map((cat) => (
              <div key={cat}>
                <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-2">{cat}</h3>
                <div className="space-y-2">
                  {grouped[cat].map((item) => (
                    <SomedayCard key={item.id} item={item} onActivate={activateMutation} />
                  ))}
                </div>
              </div>
            ))
          ) : (
            <div className="space-y-2">
              {items.map((item) => (
                <SomedayCard key={item.id} item={item} onActivate={activateMutation} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function SomedayCard({ item, onActivate }: { item: SomedayItem; onActivate: any }) {
  return (
    <Card className="p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium">{item.title}</p>
          {item.description && (
            <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{item.description}</p>
          )}
          {item.category && (
            <Badge variant="secondary" className="text-[10px] mt-1.5">{item.category}</Badge>
          )}
        </div>
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline" size="sm" className="shrink-0">
              <Sparkles className="h-3.5 w-3.5 mr-1" />
              Activate
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-48 p-2" align="end">
            <p className="text-xs text-muted-foreground mb-2">Activate as...</p>
            <div className="space-y-1">
              <Button
                variant="ghost"
                size="sm"
                className="w-full justify-start"
                onClick={() => onActivate.mutate({ id: item.id, activate_as: "project" })}
                disabled={onActivate.isPending}
              >
                <FolderOpen className="h-3.5 w-3.5 mr-2" />
                Project
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="w-full justify-start"
                onClick={() => onActivate.mutate({ id: item.id, activate_as: "next_action" })}
                disabled={onActivate.isPending}
              >
                <Zap className="h-3.5 w-3.5 mr-2" />
                Next Action
              </Button>
            </div>
          </PopoverContent>
        </Popover>
      </div>
    </Card>
  );
}