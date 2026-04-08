import { useState, useEffect } from "react";
import { useParams, useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  ArrowLeft, ArrowRight, CheckCircle2, Package,
  AlertTriangle, ExternalLink, Loader2, ChevronLeft, Users,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/hooks/useAuth";

type SupplyItem = {
  id: string;
  name: string;
  category: string;
  unit: string;
  parLevel: number;
  safetyStock: number;
  lastCountedQty: number | null;
  lastCountedAt: string | null;
  orderUrl: string | null;
  supplierName: string | null;
  isLocalPickup: boolean;
};

type Session = {
  id: string;
  status: string;
  assignedTo: string | null;
  storeId: string;
};

type SessionData = {
  session: Session;
  items: SupplyItem[];
  entries: Record<string, { countedQty: number }>;
};

const CATEGORY_LABELS: Record<string, string> = {
  bags: "Bags",
  cleaning: "Cleaning",
  paper: "Paper & Office",
  packaging: "Packaging",
  other: "Other",
};

function stockColor(counted: number, item: SupplyItem) {
  if (counted <= item.safetyStock) return "text-red-600 bg-red-50 border-red-200";
  if (counted < item.parLevel) return "text-amber-600 bg-amber-50 border-amber-200";
  return "text-emerald-600 bg-emerald-50 border-emerald-200";
}

type TeamMember = { id: string; firstName: string; lastName: string };

export default function InventoryCount() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const qc = useQueryClient();
  const { user } = useAuth();

  const isAdmin = ["owner", "admin", "manager"].includes(user?.role?.name || "");

  const { data: teamMembers = [] } = useQuery<TeamMember[]>({
    queryKey: ["/api/users"],
    enabled: isAdmin,
  });

  const isNew = sessionId === "new";
  const [realSessionId, setRealSessionId] = useState<string | null>(isNew ? null : sessionId);
  const [step, setStep] = useState(0); // 0 = intro, 1..N = item cards, N+1 = done
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [submitted, setSubmitted] = useState(false);
  const [summary, setSummary] = useState<{
    lowItems: number;
    reorderTasksCreated: number;
    localPickupTasks: Array<{ task: { id: string; title: string }; item: { name: string; supplierName: string | null } }>;
  } | null>(null);
  const [pickupAssignees, setPickupAssignees] = useState<Record<string, string>>({});

  // Quick-start for "new" sessions (from recurring task link)
  const quickStartMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/supply/sessions/quick-start");
      return res.json();
    },
    onSuccess: (data: any) => {
      setRealSessionId(data.session.id);
    },
    onError: (e: any) => {
      toast({ title: "Could not start count", description: e.message, variant: "destructive" });
      navigate("/supply");
    },
  });

  useEffect(() => {
    if (isNew && !realSessionId) {
      quickStartMutation.mutate();
    }
  }, []);

  const { data, isLoading } = useQuery<SessionData>({
    queryKey: ["/api/supply/sessions", realSessionId],
    queryFn: () =>
      fetch(`/api/supply/sessions/${realSessionId}`, { credentials: "include" }).then(r => r.json()),
    enabled: !!realSessionId,
  });

  // Pre-fill counts from existing entries
  useEffect(() => {
    if (data?.entries) {
      const pre: Record<string, number> = {};
      for (const [itemId, entry] of Object.entries(data.entries)) {
        pre[itemId] = entry.countedQty;
      }
      setCounts(pre);
    }
  }, [data]);

  const submitMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/supply/sessions/${realSessionId}/submit`, {
        counts: Object.entries(counts).map(([supplyItemId, countedQty]) => ({
          supplyItemId,
          countedQty,
        })),
      });
      return res.json();
    },
    onSuccess: (res: any) => {
      setSubmitted(true);
      setSummary({
        lowItems: res.lowItems,
        reorderTasksCreated: res.reorderTasksCreated,
        localPickupTasks: res.localPickupTasks || [],
      });
      qc.invalidateQueries({ queryKey: ["/api/supply/items"] });
      qc.invalidateQueries({ queryKey: ["/api/supply/stats"] });
    },
    onError: (e: any) => toast({ title: "Submit failed", description: e.message, variant: "destructive" }),
  });

  const assignPickupMutation = useMutation({
    mutationFn: ({ taskId, assignedTo }: { taskId: string; assignedTo: string }) =>
      apiRequest("PATCH", `/api/supply/reorder-tasks/${taskId}/assign`, { assignedTo }),
    onSuccess: (_, { taskId, assignedTo }) => {
      setPickupAssignees(prev => ({ ...prev, [taskId]: assignedTo }));
      toast({ title: "Pickup task assigned" });
      qc.invalidateQueries({ queryKey: ["/api/tasks"] });
    },
    onError: (e: any) => toast({ title: "Assignment failed", description: e.message, variant: "destructive" }),
  });

  if (isLoading || (isNew && !realSessionId)) {
    return (
      <div className="min-h-screen bg-[#FFFBF5] flex items-center justify-center">
        <div className="text-center space-y-3">
          <Loader2 className="h-8 w-8 animate-spin text-[#F47D31] mx-auto" />
          <p className="text-sm text-muted-foreground">Loading inventory count…</p>
        </div>
      </div>
    );
  }

  if (!data) return null;

  const { items } = data;

  // Group by category for display
  const grouped: Record<string, SupplyItem[]> = {};
  for (const item of items) {
    if (!grouped[item.category]) grouped[item.category] = [];
    grouped[item.category].push(item);
  }

  // Flatten into ordered list
  const orderedItems: SupplyItem[] = Object.values(grouped).flat();

  const totalItems = orderedItems.length;
  const countedItems = Object.keys(counts).filter(id => counts[id] !== undefined).length;
  const progress = totalItems === 0 ? 0 : Math.round((countedItems / totalItems) * 100);

  // ── Done screen ──
  if (submitted && summary) {
    return (
      <div className="min-h-screen bg-[#FFFBF5] flex flex-col items-center justify-center px-4 text-center space-y-6">
        <div className="w-20 h-20 bg-emerald-100 rounded-full flex items-center justify-center">
          <CheckCircle2 className="h-10 w-10 text-emerald-600" />
        </div>
        <div>
          <h1 className="text-2xl font-bold">Count Complete!</h1>
          <p className="text-muted-foreground mt-1">Great work. Here's what happened:</p>
        </div>
        <div className="grid grid-cols-2 gap-4 w-full max-w-sm">
          <Card>
            <CardContent className="pt-5 pb-4 text-center">
              <div className="text-3xl font-bold text-emerald-600">{totalItems - summary.lowItems}</div>
              <div className="text-xs text-muted-foreground mt-1">Items Stocked</div>
            </CardContent>
          </Card>
          <Card className={summary.lowItems > 0 ? "border-amber-200" : ""}>
            <CardContent className="pt-5 pb-4 text-center">
              <div className={`text-3xl font-bold ${summary.lowItems > 0 ? "text-amber-600" : "text-gray-400"}`}>
                {summary.lowItems}
              </div>
              <div className="text-xs text-muted-foreground mt-1">Below Par</div>
            </CardContent>
          </Card>
        </div>
        {summary.reorderTasksCreated > 0 && (
          <div className="bg-orange-50 border border-orange-200 rounded-xl p-4 max-w-sm w-full text-left">
            <div className="flex items-center gap-2 mb-1.5">
              <AlertTriangle className="h-4 w-4 text-orange-600 flex-shrink-0" />
              <p className="font-semibold text-sm text-orange-900">
                {summary.reorderTasksCreated} reorder task{summary.reorderTasksCreated !== 1 ? "s" : ""} created
              </p>
            </div>
            <p className="text-sm text-orange-800">
              Online reorder tasks were assigned automatically. Check <strong>Task Management</strong> to review them.
            </p>
          </div>
        )}

        {/* Local-pickup assignment gate */}
        {summary.localPickupTasks && summary.localPickupTasks.length > 0 && isAdmin && (
          <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 max-w-sm w-full text-left space-y-3">
            <div className="flex items-center gap-2">
              <Users className="h-4 w-4 text-blue-600 flex-shrink-0" />
              <p className="font-semibold text-sm text-blue-900">
                Assign local pickup tasks ({summary.localPickupTasks.length})
              </p>
            </div>
            <p className="text-xs text-blue-700">These items need someone to arrange in-store pickup with the supplier. Assign each to a team member:</p>
            {summary.localPickupTasks.map(({ task, item }) => {
              const assigned = pickupAssignees[task.id];
              return (
                <div key={task.id} className="space-y-1">
                  <p className="text-xs font-medium text-blue-900">{item.name}{item.supplierName ? ` — ${item.supplierName}` : ""}</p>
                  {assigned ? (
                    <div className="flex items-center gap-2">
                      <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
                      <span className="text-xs text-emerald-700">
                        Assigned to {teamMembers.find(m => m.id === assigned)?.firstName || "team member"}
                      </span>
                    </div>
                  ) : (
                    <Select
                      onValueChange={(userId) => {
                        assignPickupMutation.mutate({ taskId: task.id, assignedTo: userId });
                      }}
                    >
                      <SelectTrigger className="h-8 text-xs">
                        <SelectValue placeholder="Select team member" />
                      </SelectTrigger>
                      <SelectContent>
                        {teamMembers.map((m) => (
                          <SelectItem key={m.id} value={m.id}>{m.firstName} {m.lastName}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                </div>
              );
            })}
          </div>
        )}
        <div className="flex gap-3">
          <Button variant="outline" onClick={() => navigate("/tasks")}>
            View Tasks
          </Button>
          <Button className="bg-[#F47D31] hover:bg-[#e06b20]" onClick={() => navigate("/supply")}>
            Back to Supply
          </Button>
        </div>
      </div>
    );
  }

  // ── Intro screen ──
  if (step === 0) {
    return (
      <div className="min-h-screen bg-[#FFFBF5] flex flex-col">
        <div className="bg-white border-b px-4 py-3 flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => navigate("/supply")}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <h1 className="font-bold">Inventory Count</h1>
        </div>
        <div className="flex-1 flex flex-col items-center justify-center px-6 text-center space-y-6 py-12">
          <div className="w-20 h-20 bg-orange-100 rounded-full flex items-center justify-center">
            <Package className="h-10 w-10 text-[#F47D31]" />
          </div>
          <div>
            <h2 className="text-2xl font-bold">Ready to Count?</h2>
            <p className="text-muted-foreground mt-2 max-w-xs">
              You'll go through {totalItems} supply item{totalItems !== 1 ? "s" : ""} one at a time.
              Enter the current quantity for each. It only takes a few minutes.
            </p>
          </div>
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 max-w-xs w-full text-left space-y-1">
            <p className="text-sm font-semibold text-amber-900">How to count</p>
            <p className="text-xs text-amber-800">Count what's physically on the shelf right now — don't guess. Include open packs and partial boxes.</p>
          </div>
          <Button
            size="lg"
            className="bg-[#F47D31] hover:bg-[#e06b20] px-10"
            onClick={() => setStep(1)}
            disabled={totalItems === 0}
          >
            {totalItems === 0 ? "No items to count" : "Start Counting"}
          </Button>
        </div>
      </div>
    );
  }

  // ── Item counting screen ──
  const currentItem = orderedItems[step - 1];
  const currentCount = currentItem ? (counts[currentItem.id] ?? null) : null;
  const hasCount = currentCount !== null && currentCount >= 0;
  const isLastItem = step === totalItems;
  const allCounted = countedItems === totalItems;

  const predictedStatus = hasCount
    ? Number(currentCount) <= currentItem.safetyStock
      ? "critical"
      : Number(currentCount) < currentItem.parLevel
      ? "low"
      : "stocked"
    : null;

  return (
    <div className="min-h-screen bg-[#FFFBF5] flex flex-col">
      {/* Top bar */}
      <div className="bg-white border-b sticky top-0 z-10">
        <div className="px-4 py-3 flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => setStep(Math.max(0, step - 1))}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <div className="flex-1">
            <div className="flex items-center justify-between text-xs text-muted-foreground mb-1">
              <span>Item {step} of {totalItems}</span>
              <span>{progress}% done</span>
            </div>
            <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
              <div
                className="h-full bg-[#F47D31] rounded-full transition-all"
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>
        </div>
      </div>

      {/* Item card */}
      <div className="flex-1 flex flex-col items-center justify-center px-4 py-8">
        {currentItem && (
          <div className="w-full max-w-sm space-y-6">
            {/* Category label */}
            <div className="text-center">
              <Badge variant="outline" className="text-xs capitalize">
                {CATEGORY_LABELS[currentItem.category] || currentItem.category}
              </Badge>
            </div>

            {/* Item card */}
            <Card className="shadow-lg">
              <CardContent className="pt-6 pb-6 space-y-5">
                <div className="text-center">
                  <h2 className="text-xl font-bold">{currentItem.name}</h2>
                  {currentItem.supplierName && (
                    <p className="text-sm text-muted-foreground mt-0.5">{currentItem.supplierName}</p>
                  )}
                </div>

                {/* Previous count reference */}
                <div className="flex items-center justify-between bg-gray-50 rounded-lg px-4 py-2.5 text-sm">
                  <span className="text-muted-foreground">Last count</span>
                  <span className="font-medium">
                    {currentItem.lastCountedQty !== null
                      ? `${currentItem.lastCountedQty} ${currentItem.unit}`
                      : "Not counted"}
                  </span>
                </div>

                {/* Count input */}
                <div className="space-y-2">
                  <label className="text-sm font-semibold block text-center">
                    How many {currentItem.unit} do you have right now?
                  </label>
                  <div className="flex items-center gap-3">
                    <Button
                      variant="outline"
                      size="lg"
                      className="text-lg h-14 w-14 flex-shrink-0"
                      onClick={() => {
                        const v = Math.max(0, (currentCount ?? 0) - 1);
                        setCounts(p => ({ ...p, [currentItem.id]: v }));
                      }}
                    >
                      −
                    </Button>
                    <Input
                      type="number"
                      min={0}
                      autoFocus
                      className="h-14 text-center text-2xl font-bold flex-1"
                      value={currentCount !== null ? currentCount : ""}
                      onChange={e => {
                        const v = parseInt(e.target.value, 10);
                        if (!isNaN(v) && v >= 0) {
                          setCounts(p => ({ ...p, [currentItem.id]: v }));
                        } else if (e.target.value === "") {
                          setCounts(p => { const n = { ...p }; delete n[currentItem.id]; return n; });
                        }
                      }}
                      onKeyDown={e => {
                        if (e.key === "Enter" && hasCount) {
                          if (!isLastItem) setStep(step + 1);
                          else if (allCounted) submitMutation.mutate();
                        }
                      }}
                      placeholder="0"
                    />
                    <Button
                      variant="outline"
                      size="lg"
                      className="text-lg h-14 w-14 flex-shrink-0"
                      onClick={() => {
                        const v = (currentCount ?? 0) + 1;
                        setCounts(p => ({ ...p, [currentItem.id]: v }));
                      }}
                    >
                      +
                    </Button>
                  </div>
                  <p className="text-xs text-center text-muted-foreground">Par level: {currentItem.parLevel} {currentItem.unit}</p>
                </div>

                {/* Predicted status */}
                {predictedStatus && (
                  <div className={`rounded-lg border px-4 py-2.5 text-sm font-medium text-center ${stockColor(Number(currentCount), currentItem)}`}>
                    {predictedStatus === "critical" && `🔴 Critical — needs reorder immediately`}
                    {predictedStatus === "low" && `🟡 Below par — reorder task will be created`}
                    {predictedStatus === "stocked" && `✅ Stocked`}
                  </div>
                )}

                {/* Order link quick access */}
                {currentItem.orderUrl && hasCount && predictedStatus !== "stocked" && (
                  <a href={currentItem.orderUrl} target="_blank" rel="noopener noreferrer">
                    <Button variant="outline" className="w-full gap-2 text-sm">
                      <ExternalLink className="h-4 w-4" />
                      Order Now
                    </Button>
                  </a>
                )}
              </CardContent>
            </Card>

            {/* Navigation */}
            <div className="flex gap-3">
              {!isLastItem ? (
                <Button
                  className="flex-1 bg-[#F47D31] hover:bg-[#e06b20] h-12 text-base"
                  disabled={!hasCount}
                  onClick={() => setStep(step + 1)}
                >
                  Next <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
              ) : (
                <Button
                  className="flex-1 bg-emerald-600 hover:bg-emerald-700 h-12 text-base"
                  disabled={!allCounted || submitMutation.isPending}
                  onClick={() => submitMutation.mutate()}
                >
                  {submitMutation.isPending
                    ? <><Loader2 className="h-4 w-4 animate-spin mr-2" /> Submitting…</>
                    : <><CheckCircle2 className="h-4 w-4 mr-2" /> Submit Count</>
                  }
                </Button>
              )}
            </div>

            {/* Skip option */}
            {!isLastItem && (
              <button
                type="button"
                className="w-full text-center text-xs text-muted-foreground underline"
                onClick={() => setStep(step + 1)}
              >
                Skip this item
              </button>
            )}
          </div>
        )}
      </div>

      {/* Bottom summary strip */}
      <div className="bg-white border-t px-4 py-3">
        <div className="flex items-center justify-between max-w-sm mx-auto text-sm">
          <span className="text-muted-foreground">{countedItems}/{totalItems} counted</span>
          {countedItems > 0 && (
            <button
              type="button"
              className="text-xs text-[#F47D31] underline"
              onClick={() => {
                const firstUncounted = orderedItems.findIndex(i => !(i.id in counts));
                setStep(firstUncounted >= 0 ? firstUncounted + 1 : totalItems);
              }}
            >
              Jump to uncounted
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
