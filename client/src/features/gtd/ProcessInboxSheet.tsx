import { useState, useEffect } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  Zap, Brain, Check, ChevronDown, ChevronUp,
} from "lucide-react";

interface InboxItem {
  id: string;
  rawInput: string;
  source: string;
  status: string;
  aiClarification: any;
  createdAt: string;
}

interface ProcessInboxSheetProps {
  item: InboxItem | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const DESTINATIONS = [
  { value: "next_action", label: "Next Action" },
  { value: "project", label: "Project" },
  { value: "waiting_for", label: "Waiting For" },
  { value: "someday_maybe", label: "Someday / Maybe" },
  { value: "reference", label: "Reference" },
  { value: "issue", label: "Issue (Tracker)" },
  { value: "trash", label: "Trash" },
];

const CONTEXTS = [
  { value: "@store", label: "@store" },
  { value: "@computer", label: "@computer" },
  { value: "@phone", label: "@phone" },
  { value: "@errands", label: "@errands" },
  { value: "@home", label: "@home" },
  { value: "@anywhere", label: "@anywhere" },
];

export default function ProcessInboxSheet({ item, open, onOpenChange }: ProcessInboxSheetProps) {
  const { toast } = useToast();
  const { user } = useAuth();
  const ai = item?.aiClarification;

  const [destination, setDestination] = useState("next_action");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [context, setContext] = useState("");
  const [energyLevel, setEnergyLevel] = useState("");
  const [timeEstimate, setTimeEstimate] = useState<number | undefined>();
  const [priority, setPriority] = useState("normal");
  const [dueDate, setDueDate] = useState("");
  const [isTwoMinute, setIsTwoMinute] = useState(false);
  const [waitingOn, setWaitingOn] = useState("");
  const [followUpDate, setFollowUpDate] = useState("");
  const [category, setCategory] = useState("");
  const [tags, setTags] = useState("");
  const [showAdvanced, setShowAdvanced] = useState(false);

  useEffect(() => {
    if (item && ai) {
      setDestination(ai.suggested_destination || "next_action");
      setTitle(ai.suggested_title || item.rawInput.slice(0, 200));
      setDescription(ai.suggested_description || "");
      setContext(ai.suggested_context || "");
      setEnergyLevel(ai.suggested_energy_level || "");
      setTimeEstimate(ai.suggested_time_estimate_minutes || undefined);
      setPriority(ai.suggested_priority || "normal");
      setIsTwoMinute(ai.is_two_minute || false);
      setDueDate(ai.suggested_due_date || "");
      setWaitingOn(ai.suggested_waiting_on || "");
      setCategory(ai.suggested_category || "");
    } else if (item) {
      setDestination("next_action");
      setTitle(item.rawInput.slice(0, 200));
      setDescription("");
      setContext("");
      setEnergyLevel("");
      setTimeEstimate(undefined);
      setPriority("normal");
      setIsTwoMinute(false);
      setDueDate("");
      setWaitingOn("");
      setCategory("");
    }
    setTags("");
    setFollowUpDate("");
    setShowAdvanced(false);
  }, [item, ai]);

  const processMutation = useMutation({
    mutationFn: async () => {
      if (!item) return;
      const payload: Record<string, unknown> = { destination };

      if (destination !== "trash") {
        payload.title = title;
        if (description) payload.description = description;
      }

      if (destination === "next_action") {
        if (context) payload.context = context;
        if (energyLevel) payload.energy_level = energyLevel;
        if (timeEstimate) payload.time_estimate_minutes = timeEstimate;
        payload.priority = priority;
        if (dueDate) payload.due_date = dueDate;
        payload.is_two_minute = isTwoMinute;
      } else if (destination === "waiting_for") {
        if (waitingOn) payload.waiting_on = waitingOn;
        if (followUpDate) payload.follow_up_date = followUpDate;
      } else if (destination === "someday_maybe") {
        if (category) payload.category = category;
      } else if (destination === "reference") {
        if (tags) payload.tags = tags.split(",").map(t => t.trim()).filter(Boolean);
      } else if (destination === "issue") {
        if (category) payload.category = category;
        payload.priority = priority;
      }

      return await apiRequest("POST", `/api/gtd/inbox/${item.id}/process`, payload);
    },
    onSuccess: () => {
      const label = DESTINATIONS.find(d => d.value === destination)?.label || destination;
      toast({
        title: destination === "trash" ? "Trashed" : `Processed! Added to ${label}.`,
        duration: 2000,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/gtd/inbox"] });
      queryClient.invalidateQueries({ queryKey: ["/api/gtd/dashboard"] });
      queryClient.invalidateQueries({ queryKey: ["/api/gtd/actions"] });
      queryClient.invalidateQueries({ queryKey: ["/api/gtd/projects"] });
      onOpenChange(false);
    },
    onError: () => {
      toast({ title: "Failed to process item", variant: "destructive" });
    },
  });

  const quickAccept = () => {
    processMutation.mutate();
  };

  if (!item) return null;

  const confidence = ai?.confidence;
  const confidenceColor = confidence >= 0.8 ? "text-green-600" : confidence >= 0.5 ? "text-yellow-600" : "text-muted-foreground";

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="rounded-t-2xl max-h-[90vh] overflow-y-auto">
        <SheetHeader className="pb-3">
          <SheetTitle className="text-lg">Process Inbox Item</SheetTitle>
        </SheetHeader>

        <div className="space-y-4 pb-4">
          <div className="bg-muted/50 rounded-lg p-3">
            <p className="text-sm font-medium text-muted-foreground mb-1">Original capture</p>
            <p className="text-sm">{item.rawInput}</p>
          </div>

          {ai && (
            <div className="border rounded-lg p-3 space-y-2">
              <div className="flex items-center gap-2">
                <Brain className="h-4 w-4 text-primary" />
                <span className="text-sm font-medium">AI Suggestion</span>
                {confidence !== undefined && (
                  <span className={`text-xs ${confidenceColor}`}>
                    {Math.round(confidence * 100)}% confident
                  </span>
                )}
              </div>
              {ai.reasoning && (
                <p className="text-xs text-muted-foreground">{ai.reasoning}</p>
              )}
              {ai.is_two_minute && (
                <div className="flex items-center gap-1.5 bg-yellow-50 dark:bg-yellow-900/20 text-yellow-700 dark:text-yellow-400 rounded-md px-2 py-1 text-xs font-medium">
                  <Zap className="h-3.5 w-3.5" />
                  Quick win — do this now!
                </div>
              )}
              {ai.related_sop_hint && (
                <p className="text-xs text-muted-foreground">Related SOP: {ai.related_sop_hint}</p>
              )}
              <Button size="sm" onClick={quickAccept} disabled={processMutation.isPending} className="w-full">
                <Check className="h-4 w-4 mr-1" />
                {processMutation.isPending ? "Processing..." : "Looks right ✓"}
              </Button>
            </div>
          )}

          <div className="space-y-3">
            <div>
              <Label className="text-sm">Destination</Label>
              <Select value={destination} onValueChange={setDestination}>
                <SelectTrigger className="mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {DESTINATIONS.map(d => (
                    <SelectItem key={d.value} value={d.value}>{d.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {destination !== "trash" && (
              <div>
                <Label className="text-sm">Title</Label>
                <Input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  className="mt-1"
                  placeholder="Action title"
                />
              </div>
            )}

            {destination !== "trash" && destination !== "project" && (
              <div>
                <Label className="text-sm">Description (optional)</Label>
                <Textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  className="mt-1 min-h-[60px]"
                  placeholder="More details..."
                />
              </div>
            )}

            {destination === "next_action" && (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label className="text-sm">Context</Label>
                    <Select value={context} onValueChange={setContext}>
                      <SelectTrigger className="mt-1">
                        <SelectValue placeholder="Select..." />
                      </SelectTrigger>
                      <SelectContent>
                        {CONTEXTS.map(c => (
                          <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label className="text-sm">Priority</Label>
                    <Select value={priority} onValueChange={setPriority}>
                      <SelectTrigger className="mt-1">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="low">Low</SelectItem>
                        <SelectItem value="normal">Normal</SelectItem>
                        <SelectItem value="high">High</SelectItem>
                        <SelectItem value="urgent">Urgent</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setShowAdvanced(!showAdvanced)}
                  className="w-full justify-between text-muted-foreground"
                >
                  More options
                  {showAdvanced ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                </Button>

                {showAdvanced && (
                  <div className="space-y-3 border-t pt-3">
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <Label className="text-sm">Energy</Label>
                        <Select value={energyLevel} onValueChange={setEnergyLevel}>
                          <SelectTrigger className="mt-1">
                            <SelectValue placeholder="Any" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="low">Low</SelectItem>
                            <SelectItem value="medium">Medium</SelectItem>
                            <SelectItem value="high">High</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div>
                        <Label className="text-sm">Time (min)</Label>
                        <Input
                          type="number"
                          value={timeEstimate || ""}
                          onChange={(e) => setTimeEstimate(e.target.value ? parseInt(e.target.value) : undefined)}
                          className="mt-1"
                          placeholder="15"
                          min={1}
                          max={480}
                        />
                      </div>
                    </div>
                    <div>
                      <Label className="text-sm">Due Date</Label>
                      <Input
                        type="date"
                        value={dueDate}
                        onChange={(e) => setDueDate(e.target.value)}
                        className="mt-1"
                      />
                    </div>
                    <div className="flex items-center gap-2">
                      <Switch checked={isTwoMinute} onCheckedChange={setIsTwoMinute} />
                      <Label className="text-sm">Two-minute action</Label>
                    </div>
                  </div>
                )}
              </>
            )}

            {destination === "project" && (
              <div className="space-y-3">
                <div>
                  <Label className="text-sm">Desired Outcome</Label>
                  <Textarea
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    className="mt-1 min-h-[60px]"
                    placeholder="What does 'done' look like for this project?"
                  />
                </div>
                <div>
                  <Label className="text-sm">Due Date (optional)</Label>
                  <Input
                    type="date"
                    value={dueDate}
                    onChange={(e) => setDueDate(e.target.value)}
                    className="mt-1"
                  />
                </div>
              </div>
            )}

            {destination === "waiting_for" && (
              <div className="space-y-3">
                <div>
                  <Label className="text-sm">Waiting on</Label>
                  <Input
                    value={waitingOn}
                    onChange={(e) => setWaitingOn(e.target.value)}
                    className="mt-1"
                    placeholder="Who or what are you waiting on?"
                  />
                </div>
                <div>
                  <Label className="text-sm">Follow-up Date</Label>
                  <Input
                    type="date"
                    value={followUpDate}
                    onChange={(e) => setFollowUpDate(e.target.value)}
                    className="mt-1"
                  />
                </div>
              </div>
            )}

            {destination === "someday_maybe" && (
              <div>
                <Label className="text-sm">Category</Label>
                <Input
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                  className="mt-1"
                  placeholder="e.g. marketing idea, store improvement"
                />
              </div>
            )}

            {destination === "reference" && (
              <div>
                <Label className="text-sm">Tags (comma-separated)</Label>
                <Input
                  value={tags}
                  onChange={(e) => setTags(e.target.value)}
                  className="mt-1"
                  placeholder="vendor, pricing, policy"
                />
              </div>
            )}

            {destination === "issue" && (
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-sm">Category</Label>
                  <Input
                    value={category}
                    onChange={(e) => setCategory(e.target.value)}
                    className="mt-1"
                    placeholder="general"
                  />
                </div>
                <div>
                  <Label className="text-sm">Priority</Label>
                  <Select value={priority} onValueChange={setPriority}>
                    <SelectTrigger className="mt-1">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="low">Low</SelectItem>
                      <SelectItem value="medium">Medium</SelectItem>
                      <SelectItem value="high">High</SelectItem>
                      <SelectItem value="urgent">Urgent</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            )}
          </div>

          <Button
            onClick={() => processMutation.mutate()}
            disabled={processMutation.isPending || (destination !== "trash" && !title.trim())}
            className="w-full"
            size="lg"
          >
            {processMutation.isPending ? "Processing..." : destination === "trash" ? "Move to Trash" : "Process"}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
