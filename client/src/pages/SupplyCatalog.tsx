import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  Card, CardContent, CardHeader, CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Form, FormControl, FormField, FormItem, FormLabel, FormMessage,
} from "@/components/ui/form";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Package, Plus, ExternalLink, Edit2, Trash2, ClipboardList,
  Users, Calendar, AlertTriangle, CheckCircle2, RefreshCw, Layers,
  RotateCcw, Search, X as XIcon,
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
  notes: string | null;
  isActive: boolean;
};

type TeamMember = { id: string; firstName: string; lastName: string };

const CATEGORIES = [
  { value: "all", label: "All Items" },
  { value: "bags", label: "Bags" },
  { value: "cleaning", label: "Cleaning" },
  { value: "paper", label: "Paper & Office" },
  { value: "packaging", label: "Packaging" },
  { value: "other", label: "Other" },
];

const UNITS = ["each", "rolls", "boxes", "cases", "packs", "bottles", "pairs", "sets"];
const DAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];
const TIMES = ["morning", "afternoon", "evening"];

const itemSchema = z.object({
  name: z.string().min(1, "Name required"),
  category: z.string().min(1),
  unit: z.string().min(1),
  parLevel: z.coerce.number().int().min(1, "Must be at least 1"),
  safetyStock: z.coerce.number().int().min(0),
  supplierName: z.string().optional(),
  orderUrl: z.string().url("Must be a valid URL").optional().or(z.literal("")),
  isLocalPickup: z.boolean().default(false),
  notes: z.string().optional(),
});

function stockStatus(item: SupplyItem): "stocked" | "low" | "critical" | "unknown" {
  if (item.lastCountedQty === null) return "unknown";
  if (item.lastCountedQty <= item.safetyStock) return "critical";
  if (item.lastCountedQty < item.parLevel) return "low";
  return "stocked";
}

function StockBar({ item }: { item: SupplyItem }) {
  const status = stockStatus(item);
  const qty = item.lastCountedQty ?? 0;
  const pct = item.lastCountedQty === null ? 0 : Math.min(100, (qty / item.parLevel) * 100);
  const color =
    status === "critical" ? "bg-red-500" :
    status === "low" ? "bg-amber-400" :
    status === "unknown" ? "bg-gray-300" : "bg-emerald-500";

  return (
    <div className="space-y-1">
      <div className={`h-2 rounded-full bg-gray-100 overflow-hidden`}>
        <div className={`h-full rounded-full transition-all ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <div className="flex justify-between text-xs text-muted-foreground">
        <span>{item.lastCountedQty === null ? "Not counted" : `${item.lastCountedQty} ${item.unit}`}</span>
        <span>par {item.parLevel}</span>
      </div>
    </div>
  );
}

function StatusBadge({ item }: { item: SupplyItem }) {
  const status = stockStatus(item);
  if (status === "unknown") return <Badge variant="secondary" className="text-xs">Not counted</Badge>;
  if (status === "critical") return <Badge className="text-xs bg-red-100 text-red-700 border-red-200">Critical</Badge>;
  if (status === "low") return <Badge className="text-xs bg-amber-100 text-amber-700 border-amber-200">Low</Badge>;
  return <Badge className="text-xs bg-emerald-100 text-emerald-700 border-emerald-200">Stocked</Badge>;
}

function ItemCard({ item, onEdit, onArchive }: { item: SupplyItem; onEdit: () => void; onArchive: () => void }) {
  const status = stockStatus(item);
  const borderColor =
    status === "critical" ? "border-red-300 bg-red-50/40" :
    status === "low" ? "border-amber-200 bg-amber-50/30" : "border-border";

  return (
    <Card className={`relative overflow-hidden transition-all hover:shadow-md ${borderColor}`}>
      {status === "critical" && (
        <div className="absolute top-0 left-0 right-0 h-1 bg-red-500" />
      )}
      {status === "low" && (
        <div className="absolute top-0 left-0 right-0 h-1 bg-amber-400" />
      )}
      <CardContent className="p-4 space-y-3">
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-sm truncate">{item.name}</p>
            {item.supplierName && (
              <p className="text-xs text-muted-foreground">{item.supplierName}</p>
            )}
          </div>
          <StatusBadge item={item} />
        </div>

        <StockBar item={item} />

        <div className="flex items-center gap-2">
          {item.orderUrl && (
            <a
              href={item.orderUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex-1"
            >
              <Button size="sm" variant="outline" className="w-full text-xs h-7 gap-1">
                <ExternalLink className="h-3 w-3" />
                Order Online
              </Button>
            </a>
          )}
          {item.isLocalPickup && (
            <Badge variant="secondary" className="text-xs">Local Pickup</Badge>
          )}
          <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={onEdit}>
            <Edit2 className="h-3.5 w-3.5" />
          </Button>
          <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive" onClick={onArchive}>
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

export default function SupplyCatalog() {
  const { user } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [, navigate] = useLocation();

  const isAdmin = ["owner", "admin", "manager"].includes(user?.role?.name || "");

  const [activeCategory, setActiveCategory] = useState("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [editItem, setEditItem] = useState<SupplyItem | null>(null);
  const [showAddItem, setShowAddItem] = useState(false);
  const [showCountDialog, setShowCountDialog] = useState(false);
  const [showScheduleDialog, setShowScheduleDialog] = useState(false);
  const [countAssignee, setCountAssignee] = useState("");
  const [countCategories, setCountCategories] = useState<string[]>([]);
  const [scheduleDay, setScheduleDay] = useState("monday");
  const [scheduleTime, setScheduleTime] = useState("morning");

  const { data: items = [], isLoading } = useQuery<SupplyItem[]>({
    queryKey: ["/api/supply/items"],
  });

  const { data: teamMembers = [] } = useQuery<TeamMember[]>({
    queryKey: ["/api/users"],
    enabled: isAdmin,
  });

  const { data: weeklySchedule } = useQuery<any>({
    queryKey: ["/api/supply/weekly-schedule"],
    enabled: isAdmin,
  });

  const { data: stats } = useQuery<{
    total: number; stocked: number; low: number; critical: number; unknown: number;
    reorderNeeded: { id: string; name: string; unit: string; parLevel: number; lastCountedQty: number | null; orderUrl: string | null; supplierName: string | null; isLocalPickup: boolean | null }[];
    lastCountedAt: string | null;
  }>({
    queryKey: ["/api/supply/stats"],
    staleTime: 60_000,
  });

  const form = useForm<z.infer<typeof itemSchema>>({
    resolver: zodResolver(itemSchema),
    defaultValues: {
      name: "", category: "other", unit: "each",
      parLevel: 10, safetyStock: 2,
      supplierName: "", orderUrl: "", isLocalPickup: false, notes: "",
    },
  });

  const createMutation = useMutation({
    mutationFn: (data: any) => apiRequest("POST", "/api/supply/items", data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/supply/items"] });
      setShowAddItem(false);
      form.reset();
      toast({ title: "Supply item added" });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, ...data }: any) => apiRequest("PATCH", `/api/supply/items/${id}`, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/supply/items"] });
      setEditItem(null);
      toast({ title: "Item updated" });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const archiveMutation = useMutation({
    mutationFn: (id: string) => apiRequest("DELETE", `/api/supply/items/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/supply/items"] });
      toast({ title: "Item archived" });
    },
  });

  const createSessionMutation = useMutation({
    mutationFn: (data: any) => apiRequest("POST", "/api/supply/sessions", data),
    onSuccess: (data: any) => {
      qc.invalidateQueries({ queryKey: ["/api/supply/items"] });
      setShowCountDialog(false);
      toast({ title: "Inventory count assigned", description: "Task created and assigned to team member" });
      navigate(`/supply/count/${data.session.id}`);
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const scheduleMutation = useMutation({
    mutationFn: (data: any) => apiRequest("POST", "/api/supply/weekly-schedule", data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/supply/weekly-schedule"] });
      setShowScheduleDialog(false);
      toast({ title: "Weekly schedule saved", description: "AI will assign the inventory count to a team member each week" });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const filtered = items.filter((i) => {
    if (activeCategory !== "all" && i.category !== activeCategory) return false;
    if (searchQuery && !i.name.toLowerCase().includes(searchQuery.toLowerCase()) &&
        !(i.supplierName || "").toLowerCase().includes(searchQuery.toLowerCase())) return false;
    return true;
  });

  const categoryCounts: Record<string, { low: number; critical: number }> = {};
  for (const item of items) {
    if (!categoryCounts[item.category]) categoryCounts[item.category] = { low: 0, critical: 0 };
    const s = stockStatus(item);
    if (s === "critical") categoryCounts[item.category].critical++;
    else if (s === "low") categoryCounts[item.category].low++;
  }

  const totalLow = items.filter((i) => stockStatus(i) === "low").length;
  const totalCritical = items.filter((i) => stockStatus(i) === "critical").length;
  const totalUnknown = items.filter((i) => stockStatus(i) === "unknown").length;

  function openEdit(item: SupplyItem) {
    setEditItem(item);
    form.reset({
      name: item.name,
      category: item.category,
      unit: item.unit,
      parLevel: item.parLevel,
      safetyStock: item.safetyStock,
      supplierName: item.supplierName || "",
      orderUrl: item.orderUrl || "",
      isLocalPickup: item.isLocalPickup,
      notes: item.notes || "",
    });
  }

  function onSubmit(data: z.infer<typeof itemSchema>) {
    const payload = { ...data, orderUrl: data.orderUrl || null, supplierName: data.supplierName || null };
    if (editItem) {
      updateMutation.mutate({ id: editItem.id, ...payload });
    } else {
      createMutation.mutate(payload);
    }
  }

  return (
    <div className="min-h-screen bg-[#FFFBF5] pb-24">
      {/* Header */}
      <div className="bg-white border-b sticky top-0 z-10">
        <div className="max-w-5xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-orange-100 rounded-xl flex items-center justify-center">
              <Package className="h-5 w-5 text-[#F47D31]" />
            </div>
            <div>
              <h1 className="text-lg font-bold">Supply Kanban</h1>
              <p className="text-xs text-muted-foreground">Two-bin inventory system</p>
            </div>
          </div>
          {isAdmin && (
            <div className="flex gap-2">
              <Button
                size="sm" variant="outline"
                className="gap-1.5 text-xs"
                onClick={() => setShowScheduleDialog(true)}
              >
                <RotateCcw className="h-3.5 w-3.5" />
                Weekly
              </Button>
              <Button
                size="sm" variant="outline"
                className="gap-1.5 text-xs"
                onClick={() => setShowCountDialog(true)}
              >
                <ClipboardList className="h-3.5 w-3.5" />
                Count Now
              </Button>
              <Button
                size="sm"
                className="gap-1.5 text-xs bg-[#F47D31] hover:bg-[#e06b20]"
                onClick={() => { setEditItem(null); form.reset(); setShowAddItem(true); }}
              >
                <Plus className="h-3.5 w-3.5" />
                Add Item
              </Button>
            </div>
          )}
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-4 py-6 space-y-6">

        {/* Summary cards */}
        <div className="grid grid-cols-3 gap-3">
          <Card className="text-center">
            <CardContent className="pt-4 pb-3">
              <div className="text-2xl font-bold text-emerald-600">{items.length - totalLow - totalCritical - totalUnknown}</div>
              <div className="text-xs text-muted-foreground mt-0.5">Stocked</div>
            </CardContent>
          </Card>
          <Card className="text-center border-amber-200">
            <CardContent className="pt-4 pb-3">
              <div className="text-2xl font-bold text-amber-600">{totalLow}</div>
              <div className="text-xs text-muted-foreground mt-0.5">Low Stock</div>
            </CardContent>
          </Card>
          <Card className="text-center border-red-200">
            <CardContent className="pt-4 pb-3">
              <div className="text-2xl font-bold text-red-600">{totalCritical}</div>
              <div className="text-xs text-muted-foreground mt-0.5">Critical</div>
            </CardContent>
          </Card>
        </div>

        {/* Last count date */}
        {stats?.lastCountedAt && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
            Last full count: {new Date(stats.lastCountedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
          </div>
        )}

        {/* Reorder needed alert */}
        {(stats?.reorderNeeded?.length ?? 0) > 0 && (
          <div className="bg-orange-50 border border-orange-200 rounded-xl p-4 space-y-2">
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-orange-600 flex-shrink-0" />
              <p className="text-sm font-semibold text-orange-900">{stats!.reorderNeeded.length} item{stats!.reorderNeeded.length !== 1 ? "s" : ""} need reordering</p>
            </div>
            <div className="flex flex-wrap gap-2">
              {stats!.reorderNeeded.slice(0, 5).map((item) => (
                <div key={item.id} className="flex items-center gap-1.5">
                  {item.orderUrl ? (
                    <a href={item.orderUrl} target="_blank" rel="noopener noreferrer">
                      <Badge variant="outline" className="text-xs gap-1 cursor-pointer hover:bg-orange-100 border-orange-300 text-orange-800">
                        <ExternalLink className="h-2.5 w-2.5" />
                        {item.name}
                      </Badge>
                    </a>
                  ) : (
                    <Badge variant="outline" className="text-xs border-orange-300 text-orange-800">
                      {item.name} {item.isLocalPickup ? " (local pickup)" : ""}
                    </Badge>
                  )}
                </div>
              ))}
              {stats!.reorderNeeded.length > 5 && (
                <Badge variant="outline" className="text-xs border-orange-300 text-orange-700">
                  +{stats!.reorderNeeded.length - 5} more
                </Badge>
              )}
            </div>
          </div>
        )}

        {/* Weekly schedule status */}
        {isAdmin && weeklySchedule && (
          <div className="flex items-center gap-2 bg-emerald-50 border border-emerald-200 rounded-lg px-4 py-2.5">
            <CheckCircle2 className="h-4 w-4 text-emerald-600 flex-shrink-0" />
            <p className="text-sm text-emerald-800">
              Weekly count scheduled every{" "}
              <strong className="capitalize">{weeklySchedule.dayOfWeek}</strong>{" "}
              <span className="capitalize">{weeklySchedule.timeOfDay}</span> — AI will auto-assign to a team member
            </p>
          </div>
        )}

        {totalUnknown > 0 && (
          <div className="flex items-center gap-2 bg-blue-50 border border-blue-200 rounded-lg px-4 py-2.5">
            <AlertTriangle className="h-4 w-4 text-blue-600 flex-shrink-0" />
            <p className="text-sm text-blue-800">
              {totalUnknown} item{totalUnknown !== 1 ? "s" : ""} haven't been counted yet. Run an inventory count to track stock levels.
            </p>
          </div>
        )}

        {/* Search */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search items or supplier..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9 pr-9"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery("")}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              <XIcon className="h-4 w-4" />
            </button>
          )}
        </div>

        {/* Category tabs */}
        <Tabs value={activeCategory} onValueChange={setActiveCategory}>
          <TabsList className="flex-wrap h-auto gap-1 bg-transparent p-0">
            {CATEGORIES.map((cat) => {
              const cc = cat.value !== "all" ? categoryCounts[cat.value] : null;
              const hasAlert = cc && (cc.critical > 0 || cc.low > 0);
              return (
                <TabsTrigger
                  key={cat.value}
                  value={cat.value}
                  className="data-[state=active]:bg-[#F47D31] data-[state=active]:text-white rounded-lg px-3 py-1.5 text-sm"
                >
                  {cat.label}
                  {hasAlert && (
                    <span className="ml-1.5 w-4 h-4 rounded-full bg-red-500 text-white text-[10px] flex items-center justify-center">
                      {cc!.critical + cc!.low}
                    </span>
                  )}
                </TabsTrigger>
              );
            })}
          </TabsList>
        </Tabs>

        {/* Items grid */}
        {isLoading ? (
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            {[...Array(6)].map((_, i) => (
              <div key={i} className="h-36 bg-gray-100 rounded-xl animate-pulse" />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-16 text-muted-foreground">
            <Package className="h-12 w-12 mx-auto mb-3 opacity-20" />
            {searchQuery ? (
              <>
                <p className="font-medium">No items match "{searchQuery}"</p>
                <Button variant="ghost" className="mt-3 text-sm" onClick={() => setSearchQuery("")}>
                  Clear search
                </Button>
              </>
            ) : (
              <>
                <p className="font-medium">No supply items yet</p>
                {isAdmin && (
                  <Button
                    className="mt-4 bg-[#F47D31] hover:bg-[#e06b20]"
                    onClick={() => { setEditItem(null); form.reset(); setShowAddItem(true); }}
                  >
                    <Plus className="h-4 w-4 mr-1.5" /> Add First Item
                  </Button>
                )}
              </>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            {filtered.map((item) => (
              <ItemCard
                key={item.id}
                item={item}
                onEdit={() => openEdit(item)}
                onArchive={() => {
                  if (confirm(`Archive "${item.name}"?`)) archiveMutation.mutate(item.id);
                }}
              />
            ))}
          </div>
        )}
      </div>

      {/* ── Add/Edit Item Dialog ── */}
      <Dialog open={showAddItem || !!editItem} onOpenChange={(o) => { if (!o) { setShowAddItem(false); setEditItem(null); } }}>
        <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editItem ? "Edit Supply Item" : "Add Supply Item"}</DialogTitle>
          </DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <FormField control={form.control} name="name" render={({ field }) => (
                <FormItem>
                  <FormLabel>Item Name</FormLabel>
                  <FormControl><Input placeholder="e.g. Shopping Bags (Large)" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />

              <div className="grid grid-cols-2 gap-3">
                <FormField control={form.control} name="category" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Category</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                      <SelectContent>
                        {CATEGORIES.filter(c => c.value !== "all").map(c => (
                          <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )} />

                <FormField control={form.control} name="unit" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Unit</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                      <SelectContent>
                        {UNITS.map(u => <SelectItem key={u} value={u}>{u}</SelectItem>)}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )} />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <FormField control={form.control} name="parLevel" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Par Level (Bin 1)</FormLabel>
                    <FormControl><Input type="number" min={1} {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />

                <FormField control={form.control} name="safetyStock" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Safety Stock (Bin 2)</FormLabel>
                    <FormControl><Input type="number" min={0} {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
              </div>
              <p className="text-xs text-muted-foreground -mt-2">Safety stock = reorder-NOW threshold (red alert)</p>

              <FormField control={form.control} name="supplierName" render={({ field }) => (
                <FormItem>
                  <FormLabel>Supplier Name</FormLabel>
                  <FormControl><Input placeholder="e.g. Amazon, Uline, Walmart" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />

              <FormField control={form.control} name="orderUrl" render={({ field }) => (
                <FormItem>
                  <FormLabel>Order URL (optional)</FormLabel>
                  <FormControl><Input placeholder="https://..." {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />

              <FormField control={form.control} name="isLocalPickup" render={({ field }) => (
                <FormItem className="flex items-center justify-between rounded-lg border p-3">
                  <div>
                    <FormLabel className="text-sm font-medium">Local Pickup</FormLabel>
                    <p className="text-xs text-muted-foreground">Needs to be picked up in person</p>
                  </div>
                  <FormControl><Switch checked={field.value} onCheckedChange={field.onChange} /></FormControl>
                </FormItem>
              )} />

              <FormField control={form.control} name="notes" render={({ field }) => (
                <FormItem>
                  <FormLabel>Notes</FormLabel>
                  <FormControl><Textarea rows={2} placeholder="Any additional info..." {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />

              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => { setShowAddItem(false); setEditItem(null); }}>
                  Cancel
                </Button>
                <Button type="submit" className="bg-[#F47D31] hover:bg-[#e06b20]"
                  disabled={createMutation.isPending || updateMutation.isPending}>
                  {editItem ? "Save Changes" : "Add Item"}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      {/* ── Start Count Dialog ── */}
      <Dialog open={showCountDialog} onOpenChange={setShowCountDialog}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Start Inventory Count</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <label className="text-sm font-medium">Assign To</label>
              <Select value={countAssignee} onValueChange={setCountAssignee}>
                <SelectTrigger className="mt-1.5">
                  <SelectValue placeholder="Select team member…" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="self">Myself</SelectItem>
                  {teamMembers.map((m) => (
                    <SelectItem key={m.id} value={m.id}>
                      {m.firstName} {m.lastName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-sm font-medium">Categories to Count</label>
              <p className="text-xs text-muted-foreground mb-2">Leave empty to count everything</p>
              <div className="flex flex-wrap gap-2">
                {CATEGORIES.filter(c => c.value !== "all").map(cat => (
                  <button
                    key={cat.value}
                    type="button"
                    onClick={() => setCountCategories(prev =>
                      prev.includes(cat.value) ? prev.filter(c => c !== cat.value) : [...prev, cat.value]
                    )}
                    className={`px-3 py-1.5 rounded-full text-xs border transition-colors ${
                      countCategories.includes(cat.value)
                        ? "bg-[#F47D31] text-white border-[#F47D31]"
                        : "border-gray-200 text-gray-600 hover:border-gray-400"
                    }`}
                  >
                    {cat.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCountDialog(false)}>Cancel</Button>
            <Button
              className="bg-[#F47D31] hover:bg-[#e06b20]"
              disabled={createSessionMutation.isPending}
              onClick={() => {
                createSessionMutation.mutate({
                  assignedTo: countAssignee === "self" || !countAssignee ? undefined : countAssignee,
                  categories: countCategories.length > 0 ? countCategories : undefined,
                });
              }}
            >
              {createSessionMutation.isPending ? "Creating…" : "Start Count"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Weekly Schedule Dialog ── */}
      <Dialog open={showScheduleDialog} onOpenChange={setShowScheduleDialog}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <RotateCcw className="h-4 w-4 text-[#F47D31]" />
              Weekly Count Schedule
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <p className="text-sm text-muted-foreground">
              The AI will automatically assign an inventory count task to a team member at this time each week.
            </p>
            <div>
              <label className="text-sm font-medium">Day of Week</label>
              <Select value={scheduleDay} onValueChange={setScheduleDay}>
                <SelectTrigger className="mt-1.5">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {DAYS.map(d => <SelectItem key={d} value={d} className="capitalize">{d.charAt(0).toUpperCase() + d.slice(1)}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-sm font-medium">Time of Day</label>
              <Select value={scheduleTime} onValueChange={setScheduleTime}>
                <SelectTrigger className="mt-1.5">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TIMES.map(t => <SelectItem key={t} value={t} className="capitalize">{t.charAt(0).toUpperCase() + t.slice(1)}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="bg-orange-50 border border-orange-200 rounded-lg p-3 text-xs text-orange-800 space-y-1">
              <p className="font-semibold">How it works</p>
              <p>This creates a recurring task in the AI task rotation. When the AI runs "Auto-Assign" on that day, it will assign the inventory count to a scheduled team member automatically.</p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowScheduleDialog(false)}>Cancel</Button>
            <Button
              className="bg-[#F47D31] hover:bg-[#e06b20]"
              disabled={scheduleMutation.isPending}
              onClick={() => scheduleMutation.mutate({ dayOfWeek: scheduleDay, timeOfDay: scheduleTime })}
            >
              {scheduleMutation.isPending ? "Saving…" : "Save Schedule"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
