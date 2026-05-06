import { useState, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  Card, CardContent,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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
  Package, Plus, ExternalLink, Edit2, Trash2,
  AlertTriangle, CheckCircle2, Search, X as XIcon, Save, Loader2,
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

const CATEGORIES = [
  { value: "all", label: "All Items" },
  { value: "bags", label: "Bags" },
  { value: "cleaning", label: "Cleaning" },
  { value: "paper", label: "Paper & Office" },
  { value: "packaging", label: "Packaging" },
  { value: "other", label: "Other" },
];

const UNITS = ["each", "rolls", "boxes", "cases", "packs", "bottles", "pairs", "sets"];

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
      <div className="h-2 rounded-full bg-gray-100 overflow-hidden">
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

function QuantityInput({ item, onSaved }: { item: SupplyItem; onSaved: () => void }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState<string>(
    item.lastCountedQty !== null ? String(item.lastCountedQty) : ""
  );
  const inputRef = useRef<HTMLInputElement>(null);

  const updateMutation = useMutation({
    mutationFn: (qty: number) =>
      apiRequest("PATCH", `/api/supply/items/${item.id}/quantity`, { quantity: qty }),
    onSuccess: async (res: any) => {
      const data = await res.json().catch(() => ({}));
      setEditing(false);
      qc.invalidateQueries({ queryKey: ["/api/supply/items"] });
      qc.invalidateQueries({ queryKey: ["/api/supply/stats"] });
      onSaved();
      if (data.isCritical) {
        toast({ title: `Critical: ${item.name}`, description: `Only ${data.quantity} ${item.unit} left — admins have been alerted.`, variant: "destructive" });
      } else if (data.isLow) {
        toast({ title: `Low stock: ${item.name}`, description: `${data.quantity} ${item.unit} remaining — below par level.` });
      } else {
        toast({ title: "Quantity saved" });
      }
    },
    onError: (e: any) => toast({ title: "Error saving quantity", description: e.message, variant: "destructive" }),
  });

  const handleSave = () => {
    const num = parseInt(value, 10);
    if (isNaN(num) || num < 0) {
      toast({ title: "Invalid quantity", description: "Enter a whole number (0 or more).", variant: "destructive" });
      return;
    }
    updateMutation.mutate(num);
  };

  if (editing) {
    return (
      <div className="flex items-center gap-1.5 mt-2">
        <Input
          ref={inputRef}
          type="number"
          min={0}
          autoFocus
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleSave();
            if (e.key === "Escape") setEditing(false);
          }}
          className="h-8 text-sm w-20 text-center font-medium"
        />
        <Button
          size="sm"
          className="h-8 px-2 bg-emerald-600 hover:bg-emerald-700"
          onClick={handleSave}
          disabled={updateMutation.isPending}
        >
          {updateMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="h-8 px-2"
          onClick={() => setEditing(false)}
        >
          <XIcon className="h-3 w-3" />
        </Button>
      </div>
    );
  }

  return (
    <button
      onClick={() => {
        setValue(item.lastCountedQty !== null ? String(item.lastCountedQty) : "");
        setEditing(true);
      }}
      className="mt-1.5 text-xs text-primary underline underline-offset-2 hover:text-primary/80 transition-colors"
    >
      {item.lastCountedQty === null ? "Enter quantity" : "Update qty"}
    </button>
  );
}

function ItemCard({ item, isAdmin, onEdit, onArchive }: { item: SupplyItem; isAdmin: boolean; onEdit: () => void; onArchive: () => void }) {
  const status = stockStatus(item);
  const borderColor =
    status === "critical" ? "border-red-300 bg-red-50/40" :
    status === "low" ? "border-amber-200 bg-amber-50/30" : "border-border";

  const qc = useQueryClient();

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

        <QuantityInput item={item} onSaved={() => {
          qc.invalidateQueries({ queryKey: ["/api/supply/items"] });
          qc.invalidateQueries({ queryKey: ["/api/supply/stats"] });
        }} />

        <div className="flex items-center gap-2">
          {item.orderUrl && (
            <a href={item.orderUrl} target="_blank" rel="noopener noreferrer" className="flex-1">
              <Button size="sm" variant="outline" className="w-full text-xs h-7 gap-1">
                <ExternalLink className="h-3 w-3" />
                Order Online
              </Button>
            </a>
          )}
          {item.isLocalPickup && (
            <Badge variant="secondary" className="text-xs">Local Pickup</Badge>
          )}
          {isAdmin && (
            <>
              <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={onEdit}>
                <Edit2 className="h-3.5 w-3.5" />
              </Button>
              <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive" onClick={onArchive}>
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

export default function SupplyCatalog() {
  const { user } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();

  const isAdmin = ["owner", "admin", "manager"].includes(user?.role?.name || "");

  const [activeCategory, setActiveCategory] = useState("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [editItem, setEditItem] = useState<SupplyItem | null>(null);
  const [showAddItem, setShowAddItem] = useState(false);

  const { data: items = [], isLoading } = useQuery<SupplyItem[]>({
    queryKey: ["/api/supply/items"],
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
              <h1 className="text-lg font-bold">Supply Catalog</h1>
              <p className="text-xs text-muted-foreground">Tap any item to update its quantity</p>
            </div>
          </div>
          {isAdmin && (
            <Button
              size="sm"
              className="gap-1.5 text-xs bg-[#F47D31] hover:bg-[#e06b20]"
              onClick={() => { setEditItem(null); form.reset(); setShowAddItem(true); }}
            >
              <Plus className="h-3.5 w-3.5" />
              Add Item
            </Button>
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
            Last updated: {new Date(stats.lastCountedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
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

        {totalUnknown > 0 && (
          <div className="flex items-center gap-2 bg-blue-50 border border-blue-200 rounded-lg px-4 py-2.5">
            <AlertTriangle className="h-4 w-4 text-blue-600 flex-shrink-0" />
            <p className="text-sm text-blue-800">
              {totalUnknown} item{totalUnknown !== 1 ? "s" : ""} haven't been counted yet. Tap "Enter quantity" on any card to update stock levels.
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
              <div key={i} className="h-44 bg-gray-100 rounded-xl animate-pulse" />
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
                isAdmin={isAdmin}
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
                    <FormLabel>Par Level</FormLabel>
                    <FormControl><Input type="number" min={1} {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />

                <FormField control={form.control} name="safetyStock" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Safety Stock</FormLabel>
                    <FormControl><Input type="number" min={0} {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
              </div>
              <p className="text-xs text-muted-foreground -mt-2">Safety stock = critical reorder threshold (red alert)</p>

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
    </div>
  );
}
