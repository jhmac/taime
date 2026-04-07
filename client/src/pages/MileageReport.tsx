import { useState, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Car, Download, Pencil, ChevronLeft, ChevronRight, ArrowUpDown } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { format, subMonths, addMonths, startOfMonth, endOfMonth } from "date-fns";

interface PayPeriodSettings {
  id: string;
  intervalType: string | null;
  firstPayPeriodStart: string | null;
}

interface MileageRecord {
  id: string;
  sessionId: string;
  timeEntryId: string | null;
  userId: string;
  milesDecimal: string;
  rateCents: number;
  totalCents: number;
  equivalentMinutes: number;
  appliedAt: string;
  adjustedBy: string | null;
  adjustedAt: string | null;
  adjustedMilesDecimal: string | null;
  ruleName: string | null;
  sessionStatus: string | null;
}

interface User {
  id: string;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
}

type SortKey = "employee" | "date" | "rule" | "miles" | "rate" | "pay" | "minutes";
type SortDir = "asc" | "desc";

function computePayPeriods(settings: PayPeriodSettings | null, count = 6): Array<{ label: string; startDate: string; endDate: string }> {
  if (!settings?.firstPayPeriodStart) return [];
  const intervalType = settings.intervalType || "bi-weekly";
  const intervalDays = intervalType === "weekly" ? 7 : intervalType === "bi-weekly" ? 14 : intervalType === "semi-monthly" ? 15 : 30;
  const start = new Date(settings.firstPayPeriodStart);
  start.setHours(0, 0, 0, 0);
  const now = new Date();
  let periodStart = new Date(start);
  while (new Date(periodStart.getTime() + intervalDays * 86400000) < now) {
    periodStart = new Date(periodStart.getTime() + intervalDays * 86400000);
  }
  const periods: Array<{ label: string; startDate: string; endDate: string }> = [];
  for (let i = count - 1; i >= 0; i--) {
    const ps = new Date(periodStart.getTime() - i * intervalDays * 86400000);
    const pe = new Date(ps.getTime() + (intervalDays - 1) * 86400000);
    const label = `${ps.toLocaleDateString("en-US", { month: "short", day: "numeric" })} – ${pe.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`;
    periods.push({ label, startDate: ps.toISOString().split("T")[0], endDate: pe.toISOString().split("T")[0] });
  }
  return periods;
}

export default function MileageReport() {
  const { toast } = useToast();
  const [viewMode, setViewMode] = useState<"month" | "pay-period">("month");
  const [periodDate, setPeriodDate] = useState(new Date());
  const [selectedPayPeriod, setSelectedPayPeriod] = useState<string>("");
  const [editRecord, setEditRecord] = useState<MileageRecord | null>(null);
  const [editMiles, setEditMiles] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("date");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  const { data: payPeriodSettings } = useQuery<PayPeriodSettings | null>({
    queryKey: ["/api/timesheets/pay-period-settings"],
  });

  const payPeriods = useMemo(() => computePayPeriods(payPeriodSettings || null), [payPeriodSettings]);

  const startDate = viewMode === "month"
    ? startOfMonth(periodDate).toISOString().split("T")[0]
    : (payPeriods.find((p) => p.label === selectedPayPeriod)?.startDate ?? (payPeriods[payPeriods.length - 1]?.startDate ?? startOfMonth(periodDate).toISOString().split("T")[0]));

  const endDate = viewMode === "month"
    ? endOfMonth(periodDate).toISOString().split("T")[0]
    : (payPeriods.find((p) => p.label === selectedPayPeriod)?.endDate ?? (payPeriods[payPeriods.length - 1]?.endDate ?? endOfMonth(periodDate).toISOString().split("T")[0]));

  const { data: reimbursements = [], isLoading } = useQuery<MileageRecord[]>({
    queryKey: ["/api/mileage-reimbursements", startDate, endDate],
    queryFn: () =>
      apiRequest("GET", `/api/mileage-reimbursements?startDate=${startDate}&endDate=${endDate}T23:59:59`).then((r) => r.json()),
  });

  const { data: allUsers = [] } = useQuery<User[]>({
    queryKey: ["/api/users"],
  });

  const userMap = new Map(allUsers.map((u) => [u.id, u]));

  const adjustMutation = useMutation({
    mutationFn: ({ id, adjustedMilesDecimal }: { id: string; adjustedMilesDecimal: number }) =>
      apiRequest("PATCH", `/api/mileage-reimbursements/${id}`, { adjustedMilesDecimal }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/mileage-reimbursements"] });
      toast({ title: "Mileage updated", description: "Reimbursement has been recalculated." });
      setEditRecord(null);
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to update mileage.", variant: "destructive" });
    },
  });

  const totalMiles = reimbursements.reduce((sum, r) => {
    const miles = r.adjustedMilesDecimal != null ? parseFloat(r.adjustedMilesDecimal) : parseFloat(r.milesDecimal);
    return sum + miles;
  }, 0);

  const totalPay = reimbursements.reduce((sum, r) => sum + r.totalCents, 0) / 100;
  const totalMinutes = reimbursements.reduce((sum, r) => sum + r.equivalentMinutes, 0);

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  }

  const sortedReimbursements = useMemo(() => {
    return [...reimbursements].sort((a, b) => {
      const userA = userMap.get(a.userId);
      const userB = userMap.get(b.userId);
      const nameA = userA ? `${userA.firstName || ""} ${userA.lastName || ""}`.trim() : "";
      const nameB = userB ? `${userB.firstName || ""} ${userB.lastName || ""}`.trim() : "";
      const milesA = a.adjustedMilesDecimal != null ? parseFloat(a.adjustedMilesDecimal) : parseFloat(a.milesDecimal);
      const milesB = b.adjustedMilesDecimal != null ? parseFloat(b.adjustedMilesDecimal) : parseFloat(b.milesDecimal);
      let cmp = 0;
      if (sortKey === "employee") cmp = nameA.localeCompare(nameB);
      else if (sortKey === "date") cmp = new Date(a.appliedAt).getTime() - new Date(b.appliedAt).getTime();
      else if (sortKey === "rule") cmp = (a.ruleName || "").localeCompare(b.ruleName || "");
      else if (sortKey === "miles") cmp = milesA - milesB;
      else if (sortKey === "rate") cmp = a.rateCents - b.rateCents;
      else if (sortKey === "pay") cmp = a.totalCents - b.totalCents;
      else if (sortKey === "minutes") cmp = a.equivalentMinutes - b.equivalentMinutes;
      return sortDir === "asc" ? cmp : -cmp;
    });
  }, [reimbursements, sortKey, sortDir, userMap]);

  function SortableHead({ col, label, className }: { col: SortKey; label: string; className?: string }) {
    return (
      <TableHead className={className}>
        <button
          className="flex items-center gap-1 hover:text-foreground transition-colors"
          onClick={() => toggleSort(col)}
        >
          {label}
          <ArrowUpDown className={`h-3 w-3 ${sortKey === col ? "opacity-100" : "opacity-40"}`} />
        </button>
      </TableHead>
    );
  }

  function exportCsv() {
    const headers = ["Employee", "Date", "Rule", "Miles", "Rate ($/mi)", "Pay ($)", "Equivalent Minutes", "Adjusted", "Session ID"];
    const rows = sortedReimbursements.map((r) => {
      const user = userMap.get(r.userId);
      const name = user ? `${user.firstName || ""} ${user.lastName || ""}`.trim() : r.userId;
      const miles = r.adjustedMilesDecimal != null ? parseFloat(r.adjustedMilesDecimal) : parseFloat(r.milesDecimal);
      return [
        `"${name}"`,
        r.appliedAt ? format(new Date(r.appliedAt), "yyyy-MM-dd") : "",
        `"${r.ruleName || ""}"`,
        miles.toFixed(2),
        (r.rateCents / 100).toFixed(2),
        (r.totalCents / 100).toFixed(2),
        r.equivalentMinutes,
        r.adjustedMilesDecimal != null ? "Yes" : "No",
        r.sessionId,
      ].join(",");
    });
    const csv = [headers.join(","), ...rows].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `mileage-report-${startDate}-to-${endDate}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const periodLabel = viewMode === "month"
    ? format(periodDate, "MMMM yyyy")
    : (payPeriods.find((p) => p.label === selectedPayPeriod)?.label ?? payPeriods[payPeriods.length - 1]?.label ?? "");

  return (
    <div className="container mx-auto py-6 space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-2">
          <Car className="h-6 w-6 text-muted-foreground" />
          <h1 className="text-2xl font-bold">Mileage Report</h1>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Select value={viewMode} onValueChange={(v) => setViewMode(v as "month" | "pay-period")}>
            <SelectTrigger className="h-8 w-32 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="month">By Month</SelectItem>
              <SelectItem value="pay-period" disabled={payPeriods.length === 0}>By Pay Period</SelectItem>
            </SelectContent>
          </Select>

          {viewMode === "month" ? (
            <>
              <Button variant="outline" size="sm" onClick={() => setPeriodDate((d) => subMonths(d, 1))}>
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <span className="text-sm font-medium w-32 text-center">{format(periodDate, "MMMM yyyy")}</span>
              <Button variant="outline" size="sm" onClick={() => setPeriodDate((d) => addMonths(d, 1))}>
                <ChevronRight className="h-4 w-4" />
              </Button>
            </>
          ) : (
            <Select
              value={selectedPayPeriod || (payPeriods[payPeriods.length - 1]?.label ?? "")}
              onValueChange={setSelectedPayPeriod}
            >
              <SelectTrigger className="h-8 w-64 text-xs">
                <SelectValue placeholder="Select pay period" />
              </SelectTrigger>
              <SelectContent>
                {payPeriods.map((p) => (
                  <SelectItem key={p.startDate} value={p.label}>
                    {p.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}

          <Button variant="outline" size="sm" onClick={exportCsv} disabled={reimbursements.length === 0}>
            <Download className="h-4 w-4 mr-1" />
            Export CSV
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <Card>
          <CardHeader className="pb-1">
            <CardTitle className="text-sm text-muted-foreground font-normal">Total Miles</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{totalMiles.toFixed(1)}</p>
            <p className="text-xs text-muted-foreground">{reimbursements.length} trip{reimbursements.length !== 1 ? "s" : ""}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-1">
            <CardTitle className="text-sm text-muted-foreground font-normal">Total Reimbursement</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">${totalPay.toFixed(2)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-1">
            <CardTitle className="text-sm text-muted-foreground font-normal">Equivalent Pay-Minutes</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{totalMinutes}</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <SortableHead col="employee" label="Employee" />
                <SortableHead col="date" label="Date" />
                <SortableHead col="rule" label="Rule" />
                <SortableHead col="miles" label="Miles" className="text-right" />
                <SortableHead col="rate" label="Rate" className="text-right" />
                <SortableHead col="pay" label="Pay" className="text-right" />
                <SortableHead col="minutes" label="+ Minutes" className="text-right" />
                <TableHead className="text-center">Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <TableRow key={i}>
                    {Array.from({ length: 9 }).map((_, j) => (
                      <TableCell key={j}><Skeleton className="h-4 w-full" /></TableCell>
                    ))}
                  </TableRow>
                ))
              ) : sortedReimbursements.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={9} className="text-center text-muted-foreground py-8">
                    No mileage reimbursements for {periodLabel}
                  </TableCell>
                </TableRow>
              ) : (
                <>
                  {sortedReimbursements.map((r) => {
                    const user = userMap.get(r.userId);
                    const name = user ? `${user.firstName || ""} ${user.lastName || ""}`.trim() : "—";
                    const miles = r.adjustedMilesDecimal != null
                      ? parseFloat(r.adjustedMilesDecimal)
                      : parseFloat(r.milesDecimal);
                    return (
                      <TableRow key={r.id}>
                        <TableCell className="font-medium">{name}</TableCell>
                        <TableCell className="text-muted-foreground">
                          {r.appliedAt ? format(new Date(r.appliedAt), "MMM d, yyyy") : "—"}
                        </TableCell>
                        <TableCell className="text-muted-foreground text-sm">
                          {r.ruleName || "—"}
                        </TableCell>
                        <TableCell className="text-right font-mono">{miles.toFixed(2)}</TableCell>
                        <TableCell className="text-right font-mono">${(r.rateCents / 100).toFixed(2)}</TableCell>
                        <TableCell className="text-right font-mono font-semibold">
                          ${(r.totalCents / 100).toFixed(2)}
                        </TableCell>
                        <TableCell className="text-right text-muted-foreground">
                          {r.equivalentMinutes > 0 ? `+${r.equivalentMinutes}` : "—"}
                        </TableCell>
                        <TableCell className="text-center">
                          {r.adjustedMilesDecimal != null ? (
                            <Badge variant="outline" className="text-amber-600 border-amber-400">Adjusted</Badge>
                          ) : (
                            <Badge variant="outline" className="text-green-600 border-green-400">Auto</Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                              setEditRecord(r);
                              setEditMiles(miles.toFixed(2));
                            }}
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                  <TableRow className="bg-muted/40 font-semibold">
                    <TableCell colSpan={3} className="text-sm">Period Total</TableCell>
                    <TableCell className="text-right font-mono">{totalMiles.toFixed(2)}</TableCell>
                    <TableCell />
                    <TableCell className="text-right font-mono">${totalPay.toFixed(2)}</TableCell>
                    <TableCell className="text-right font-mono">{totalMinutes > 0 ? `+${totalMinutes}` : "—"}</TableCell>
                    <TableCell colSpan={2} />
                  </TableRow>
                </>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={!!editRecord} onOpenChange={(open) => !open && setEditRecord(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Adjust Mileage</DialogTitle>
          </DialogHeader>
          {editRecord && (
            <div className="space-y-4 py-2">
              <p className="text-sm text-muted-foreground">
                Original: {parseFloat(editRecord.milesDecimal).toFixed(2)} mi at ${(editRecord.rateCents / 100).toFixed(2)}/mi
              </p>
              <div className="flex items-center gap-2">
                <label className="text-sm font-medium w-24">Miles</label>
                <Input
                  type="number"
                  step="0.01"
                  min="0"
                  value={editMiles}
                  onChange={(e) => setEditMiles(e.target.value)}
                  className="flex-1"
                />
              </div>
              {editMiles && !isNaN(parseFloat(editMiles)) && (
                <p className="text-sm text-muted-foreground">
                  New total: ${(parseFloat(editMiles) * editRecord.rateCents / 100).toFixed(2)}
                </p>
              )}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditRecord(null)}>Cancel</Button>
            <Button
              onClick={() => {
                if (editRecord && editMiles) {
                  adjustMutation.mutate({
                    id: editRecord.id,
                    adjustedMilesDecimal: parseFloat(editMiles),
                  });
                }
              }}
              disabled={adjustMutation.isPending || !editMiles || isNaN(parseFloat(editMiles))}
            >
              {adjustMutation.isPending ? "Saving..." : "Save Adjustment"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
