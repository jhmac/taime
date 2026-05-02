import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  AlertTriangle,
  CheckCircle,
  ChevronRight,
  Clock,
  Download,
  Edit2,
  Send,
  Users,
} from "lucide-react";
import type { PayrollPeriod, Permission } from "@shared/schema";

interface ReviewTimeEntry {
  id: string;
  clockInTime: string;
  clockOutTime: string | null;
  breakMinutes: number | null;
  hours: number;
  notes: string | null;
  isApproved: boolean | null;
  missingClockOut: boolean;
}

interface ReviewDiscrepancy {
  type: string;
  date: string;
  message: string;
  scheduledShift: { start: string; end: string; scheduledHours: number } | null;
}

interface ReviewEmployee {
  userId: string;
  name: string;
  email: string;
  phone: string;
  totalHours: number;
  scheduledHours: number;
  regularHours: number;
  overtimeHours: number;
  holidayHours: number;
  breakMinutes: number;
  hourlyRate: number;
  regularPay: number;
  overtimePay: number;
  holidayPayExtra: number;
  totalPay: number;
  timeEntries: ReviewTimeEntry[];
  schedules: any[];
  discrepancies: ReviewDiscrepancy[];
}

interface ReviewResponse {
  period: {
    id: string;
    startDate: string;
    endDate: string;
    workflowState: string | null;
    isProcessed: boolean | null;
    processedAt?: string | null;
  };
  employees: ReviewEmployee[];
  summary: {
    totalEmployees: number;
    totalHours: number;
    totalScheduledHours: number;
    totalPay: number;
    totalDiscrepancies: number;
  };
}

function formatDate(dateStr: string) {
  return new Date(dateStr).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export default function PayrollReview() {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: userPermissions = [] } = useQuery<Permission[]>({
    queryKey: ["/api/auth/permissions"],
    enabled: !!user,
  });

  const isAdmin = user?.role?.name === "owner" || user?.role?.name === "admin";
  const canManagePayroll =
    isAdmin ||
    userPermissions?.some?.(
      (p) => p.name === "admin.manage_payroll" || p.name === "admin.manage_all"
    ) ||
    false;

  const [selectedPeriodId, setSelectedPeriodId] = useState<string>("");
  const [expandedEmployee, setExpandedEmployee] = useState<string>("");
  const [editingEntryId, setEditingEntryId] = useState<string | null>(null);
  const [editClockOut, setEditClockOut] = useState<string>("");
  const [accountantEmail, setAccountantEmail] = useState<string>("");
  const [emailDialogOpen, setEmailDialogOpen] = useState(false);

  const { data: payPeriods = [] } = useQuery<PayrollPeriod[]>({
    queryKey: ["/api/payroll/periods"],
    enabled: canManagePayroll,
  });

  // Auto-select the current (or most recent) pay period when periods load
  useEffect(() => {
    if (selectedPeriodId || payPeriods.length === 0) return;
    const now = new Date();
    const current = payPeriods.find((p) => {
      const s = new Date(p.startDate);
      const e = new Date(p.endDate);
      return now >= s && now <= e;
    });
    if (current) {
      setSelectedPeriodId(current.id);
      return;
    }
    // Otherwise pick the most recent past period
    const past = [...payPeriods]
      .filter((p) => new Date(p.endDate) < now)
      .sort(
        (a, b) =>
          new Date(b.endDate).getTime() - new Date(a.endDate).getTime()
      );
    if (past.length > 0) {
      setSelectedPeriodId(past[0].id);
    } else {
      setSelectedPeriodId(payPeriods[0].id);
    }
  }, [payPeriods, selectedPeriodId]);

  const { data: reviewData, isLoading: reviewLoading } = useQuery<ReviewResponse>({
    queryKey: ["/api/payroll/periods", selectedPeriodId, "review"],
    enabled: !!selectedPeriodId && canManagePayroll,
  });

  const approveMutation = useMutation({
    mutationFn: async (periodId: string) => {
      const res = await apiRequest("POST", `/api/payroll/periods/${periodId}/approve`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/payroll/periods"] });
      queryClient.invalidateQueries({
        queryKey: ["/api/payroll/periods", selectedPeriodId, "review"],
      });
      toast({
        title: "Approved",
        description: "Payroll has been approved and marked as processed.",
      });
    },
    onError: (err: any) => {
      toast({
        title: "Error",
        description: err.message || "Failed to approve payroll.",
        variant: "destructive",
      });
    },
  });

  const editTimeMutation = useMutation({
    mutationFn: async ({ entryId, updates }: { entryId: string; updates: any }) => {
      const res = await apiRequest("PATCH", `/api/time-entries/${entryId}`, updates);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["/api/payroll/periods", selectedPeriodId, "review"],
      });
      setEditingEntryId(null);
      setEditClockOut("");
      toast({ title: "Updated", description: "Time entry has been updated." });
    },
    onError: (err: any) => {
      toast({
        title: "Error",
        description: err.message || "Failed to update time entry.",
        variant: "destructive",
      });
    },
  });

  const emailExportMutation = useMutation({
    mutationFn: async ({ periodId, email }: { periodId: string; email: string }) => {
      const res = await apiRequest("POST", `/api/payroll/periods/${periodId}/email-export`, {
        email,
      });
      return res.json();
    },
    onSuccess: (data) => {
      toast({ title: "Sent", description: data.message });
      setAccountantEmail("");
      setEmailDialogOpen(false);
    },
    onError: (err: any) => {
      toast({
        title: "Error",
        description: err.message || "Failed to email payroll.",
        variant: "destructive",
      });
    },
  });

  function handleExportCsv() {
    const period = payPeriods.find((p) => p.id === selectedPeriodId);
    if (!period) return;
    const sd = new Date(period.startDate).toISOString().split("T")[0];
    const ed = new Date(period.endDate).toISOString().split("T")[0];
    window.open(`/api/payroll/export?startDate=${sd}&endDate=${ed}`, "_blank");
  }

  if (!canManagePayroll) {
    return (
      <div className="min-h-screen bg-background p-4 md:p-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Access Denied</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              You need payroll management permissions to view this page.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const selectedPeriod = payPeriods.find((p) => p.id === selectedPeriodId);
  const isProcessed = !!reviewData?.period?.isProcessed || !!reviewData?.period?.processedAt;

  return (
    <div className="min-h-screen bg-background p-4 md:p-6" data-testid="page-payroll-review">
      <div className="space-y-4 max-w-3xl mx-auto">
        <div>
          <h1 className="text-2xl font-bold">Payroll Review</h1>
          <p className="text-sm text-muted-foreground">
            Select a pay period to review employee hours, resolve discrepancies, and approve payroll.
          </p>
        </div>

        {/* Period selector */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Select Pay Period</CardTitle>
            <CardDescription>
              {payPeriods.length === 0
                ? "No pay periods exist yet. Set one up in Pay Period Configuration."
                : `${payPeriods.length} pay period${payPeriods.length > 1 ? "s" : ""} available.`}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {payPeriods.length === 0 ? (
              <Button variant="outline" asChild>
                <a href="/payroll" data-testid="link-pay-period-config">
                  Go to Pay Period Configuration
                </a>
              </Button>
            ) : (
              <Select
                value={selectedPeriodId}
                onValueChange={(v) => {
                  setSelectedPeriodId(v);
                  setExpandedEmployee("");
                }}
              >
                <SelectTrigger className="w-full" data-testid="select-pay-period">
                  <SelectValue placeholder="Choose a pay period" />
                </SelectTrigger>
                <SelectContent>
                  {payPeriods
                    .slice()
                    .sort(
                      (a, b) =>
                        new Date(b.startDate).getTime() - new Date(a.startDate).getTime()
                    )
                    .map((p) => {
                      const now = new Date();
                      const s = new Date(p.startDate);
                      const e = new Date(p.endDate);
                      const isCurrent = now >= s && now <= e;
                      const isFuture = now < s;
                      const tag = isCurrent
                        ? " (Current)"
                        : isFuture
                        ? " (Upcoming)"
                        : p.isProcessed
                        ? " (Processed)"
                        : "";
                      return (
                        <SelectItem key={p.id} value={p.id}>
                          {formatDate(p.startDate.toString())} – {formatDate(p.endDate.toString())}
                          {tag}
                        </SelectItem>
                      );
                    })}
                </SelectContent>
              </Select>
            )}
          </CardContent>
        </Card>

        {/* Review */}
        {selectedPeriodId && (
          <Card>
            <CardHeader>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <CardTitle className="text-base flex items-center gap-2">
                    <Users className="h-4 w-4" />
                    Employee Review
                  </CardTitle>
                  <CardDescription>
                    {selectedPeriod
                      ? `${formatDate(selectedPeriod.startDate.toString())} – ${formatDate(
                          selectedPeriod.endDate.toString()
                        )}`
                      : "Loading..."}
                  </CardDescription>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {isProcessed ? (
                    <Badge className="bg-green-600 text-white" data-testid="badge-approved">
                      <CheckCircle className="h-3 w-3 mr-1" />
                      Approved
                      {reviewData?.period?.processedAt
                        ? ` ${new Date(reviewData.period.processedAt).toLocaleDateString()}`
                        : ""}
                    </Badge>
                  ) : (
                    <Button
                      size="sm"
                      onClick={() => approveMutation.mutate(selectedPeriodId)}
                      disabled={approveMutation.isPending || reviewLoading}
                      className="gap-1"
                      data-testid="button-approve-payroll"
                    >
                      <CheckCircle className="h-3 w-3" />
                      {approveMutation.isPending ? "Approving..." : "Approve Payroll"}
                    </Button>
                  )}
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              {reviewLoading ? (
                <p className="text-sm text-muted-foreground text-center py-6">
                  Loading payroll data...
                </p>
              ) : !reviewData || reviewData.employees.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-6">
                  No employee data for this period.
                </p>
              ) : (
                <>
                  {/* Summary */}
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-2">
                    <div className="p-2 bg-muted/30 rounded text-center" data-testid="stat-employees">
                      <p className="text-lg font-bold">{reviewData.summary.totalEmployees}</p>
                      <p className="text-[10px] text-muted-foreground">Employees</p>
                    </div>
                    <div className="p-2 bg-muted/30 rounded text-center" data-testid="stat-hours">
                      <p className="text-lg font-bold">
                        {reviewData.summary.totalHours.toFixed(1)}h
                      </p>
                      <p className="text-[10px] text-muted-foreground">Total Hours</p>
                    </div>
                    <div className="p-2 bg-muted/30 rounded text-center" data-testid="stat-pay">
                      <p className="text-lg font-bold">
                        ${reviewData.summary.totalPay.toFixed(2)}
                      </p>
                      <p className="text-[10px] text-muted-foreground">Total Pay</p>
                    </div>
                    <div
                      className="p-2 bg-muted/30 rounded text-center"
                      data-testid="stat-discrepancies"
                    >
                      <p
                        className={`text-lg font-bold ${
                          reviewData.summary.totalDiscrepancies > 0 ? "text-yellow-600" : ""
                        }`}
                      >
                        {reviewData.summary.totalDiscrepancies}
                      </p>
                      <p className="text-[10px] text-muted-foreground">Discrepancies</p>
                    </div>
                  </div>

                  {/* Employees */}
                  {reviewData.employees.map((emp) => {
                    const initials = (emp.name || "")
                      .split(/\s+/)
                      .filter(Boolean)
                      .slice(0, 2)
                      .map((n) => n[0]?.toUpperCase() ?? "")
                      .join("");
                    const expanded = expandedEmployee === emp.userId;
                    return (
                      <div
                        key={emp.userId}
                        className="border rounded-lg overflow-hidden"
                        data-testid={`employee-row-${emp.userId}`}
                      >
                        <button
                          type="button"
                          className="w-full p-3 flex items-center justify-between cursor-pointer hover:bg-muted/30 text-left"
                          onClick={() =>
                            setExpandedEmployee(expanded ? "" : emp.userId)
                          }
                        >
                          <div className="flex items-center gap-3">
                            <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center text-xs font-bold">
                              {initials || "?"}
                            </div>
                            <div>
                              <p className="text-sm font-medium">{emp.name}</p>
                              <p className="text-xs text-muted-foreground">
                                {emp.totalHours.toFixed(1)}h worked
                                {emp.overtimeHours > 0 && (
                                  <span className="text-orange-500 ml-1">
                                    ({emp.overtimeHours.toFixed(1)}h OT)
                                  </span>
                                )}
                                {emp.scheduledHours > 0 && (
                                  <span className="ml-1">
                                    / {emp.scheduledHours.toFixed(1)}h scheduled
                                  </span>
                                )}
                              </p>
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            {emp.discrepancies.length > 0 && (
                              <Badge variant="destructive" className="text-[10px] gap-1">
                                <AlertTriangle className="h-3 w-3" />
                                {emp.discrepancies.length}
                              </Badge>
                            )}
                            <span className="text-sm font-medium">
                              ${emp.totalPay.toFixed(2)}
                            </span>
                            <ChevronRight
                              className={`h-4 w-4 transition-transform ${
                                expanded ? "rotate-90" : ""
                              }`}
                            />
                          </div>
                        </button>

                        {expanded && (
                          <div className="border-t p-3 bg-muted/10 space-y-3">
                            {/* Hours / Pay breakdown */}
                            <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
                              <div className="p-2 bg-background rounded">
                                <p className="text-muted-foreground">Regular Hours</p>
                                <p className="font-medium">{emp.regularHours.toFixed(1)}h</p>
                              </div>
                              <div className="p-2 bg-background rounded">
                                <p className="text-muted-foreground">Overtime</p>
                                <p className="font-medium text-orange-500">
                                  {emp.overtimeHours.toFixed(1)}h
                                </p>
                              </div>
                              <div className="p-2 bg-background rounded">
                                <p className="text-muted-foreground">Holiday Pay</p>
                                <p className="font-medium text-green-600">
                                  ${emp.holidayPayExtra.toFixed(2)}
                                </p>
                              </div>
                              <div className="p-2 bg-background rounded">
                                <p className="text-muted-foreground">Total Pay</p>
                                <p className="font-bold">${emp.totalPay.toFixed(2)}</p>
                              </div>
                            </div>

                            {/* Discrepancies */}
                            {emp.discrepancies.length > 0 && (
                              <div className="space-y-1">
                                <p className="text-xs font-medium flex items-center gap-1 text-yellow-600">
                                  <AlertTriangle className="h-3 w-3" /> Discrepancies
                                </p>
                                {emp.discrepancies.map((d, i) => (
                                  <div
                                    key={i}
                                    className="p-2 bg-yellow-50 dark:bg-yellow-900/20 rounded text-xs flex items-start gap-2"
                                  >
                                    <AlertTriangle className="h-3 w-3 mt-0.5 text-yellow-600 flex-shrink-0" />
                                    <div>
                                      <p className="font-medium">
                                        {d.type === "missing_clock_out"
                                          ? "Missing Clock Out"
                                          : d.type === "no_show"
                                          ? "No Show"
                                          : d.type}
                                      </p>
                                      <p className="text-muted-foreground">{d.message}</p>
                                      {d.scheduledShift && (
                                        <p className="text-muted-foreground">
                                          Scheduled:{" "}
                                          {new Date(
                                            d.scheduledShift.start
                                          ).toLocaleString()}{" "}
                                          –{" "}
                                          {new Date(
                                            d.scheduledShift.end
                                          ).toLocaleString()}
                                        </p>
                                      )}
                                    </div>
                                  </div>
                                ))}
                              </div>
                            )}

                            {/* Time entries */}
                            {emp.timeEntries.length > 0 && (
                              <div className="space-y-1">
                                <p className="text-xs font-medium flex items-center gap-1">
                                  <Clock className="h-3 w-3" /> Time Cards
                                </p>
                                {emp.timeEntries.map((entry) => (
                                  <div
                                    key={entry.id}
                                    className="p-2 bg-background rounded text-xs flex items-center justify-between"
                                  >
                                    <div>
                                      <p className="font-medium">
                                        {new Date(entry.clockInTime).toLocaleDateString(
                                          "en-US",
                                          {
                                            weekday: "short",
                                            month: "short",
                                            day: "numeric",
                                          }
                                        )}
                                      </p>
                                      <p className="text-muted-foreground">
                                        {new Date(entry.clockInTime).toLocaleTimeString(
                                          "en-US",
                                          { hour: "numeric", minute: "2-digit" }
                                        )}
                                        {entry.clockOutTime
                                          ? ` – ${new Date(
                                              entry.clockOutTime
                                            ).toLocaleTimeString("en-US", {
                                              hour: "numeric",
                                              minute: "2-digit",
                                            })}`
                                          : " – Missing"}
                                      </p>
                                      {entry.hours != null && (
                                        <p className="text-muted-foreground">
                                          {Number(entry.hours).toFixed(2)}h
                                        </p>
                                      )}
                                    </div>
                                    <div className="flex items-center gap-1">
                                      {!entry.clockOutTime && (
                                        <Badge
                                          variant="destructive"
                                          className="text-[10px]"
                                        >
                                          Open
                                        </Badge>
                                      )}
                                      <Dialog
                                        open={editingEntryId === entry.id}
                                        onOpenChange={(open) => {
                                          if (open) {
                                            setEditingEntryId(entry.id);
                                            setEditClockOut(
                                              entry.clockOutTime
                                                ? new Date(entry.clockOutTime)
                                                    .toISOString()
                                                    .slice(0, 16)
                                                : ""
                                            );
                                          } else {
                                            setEditingEntryId(null);
                                            setEditClockOut("");
                                          }
                                        }}
                                      >
                                        <DialogTrigger asChild>
                                          <Button
                                            variant="ghost"
                                            size="sm"
                                            className="h-6 w-6 p-0"
                                            data-testid={`button-edit-entry-${entry.id}`}
                                          >
                                            <Edit2 className="h-3 w-3" />
                                          </Button>
                                        </DialogTrigger>
                                        <DialogContent>
                                          <DialogHeader>
                                            <DialogTitle>Edit Time Entry</DialogTitle>
                                          </DialogHeader>
                                          <div className="space-y-3">
                                            <div>
                                              <Label className="text-sm">Clock In</Label>
                                              <p className="text-sm text-muted-foreground">
                                                {new Date(
                                                  entry.clockInTime
                                                ).toLocaleString()}
                                              </p>
                                            </div>
                                            <div>
                                              <Label className="text-sm">Clock Out</Label>
                                              <Input
                                                type="datetime-local"
                                                value={editClockOut}
                                                onChange={(e) =>
                                                  setEditClockOut(e.target.value)
                                                }
                                              />
                                            </div>
                                          </div>
                                          <DialogFooter>
                                            <DialogClose asChild>
                                              <Button variant="outline" size="sm">
                                                Cancel
                                              </Button>
                                            </DialogClose>
                                            <Button
                                              size="sm"
                                              disabled={
                                                !editClockOut || editTimeMutation.isPending
                                              }
                                              onClick={() => {
                                                if (!editClockOut) return;
                                                editTimeMutation.mutate({
                                                  entryId: entry.id,
                                                  updates: {
                                                    clockOutTime: new Date(
                                                      editClockOut
                                                    ).toISOString(),
                                                  },
                                                });
                                              }}
                                            >
                                              Save
                                            </Button>
                                          </DialogFooter>
                                        </DialogContent>
                                      </Dialog>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}

                  {/* Export actions */}
                  <Separator />
                  <div className="flex flex-wrap gap-2 pt-2">
                    <Button
                      variant="outline"
                      size="sm"
                      className="gap-1"
                      onClick={handleExportCsv}
                      data-testid="button-export-csv"
                    >
                      <Download className="h-3 w-3" />
                      Export CSV
                    </Button>

                    <Dialog open={emailDialogOpen} onOpenChange={setEmailDialogOpen}>
                      <DialogTrigger asChild>
                        <Button
                          variant="outline"
                          size="sm"
                          className="gap-1"
                          data-testid="button-email-accountant"
                        >
                          <Send className="h-3 w-3" />
                          Email to Accountant
                        </Button>
                      </DialogTrigger>
                      <DialogContent>
                        <DialogHeader>
                          <DialogTitle>Email Payroll Report</DialogTitle>
                        </DialogHeader>
                        <div className="space-y-3">
                          <div>
                            <Label className="text-sm">Accountant Email</Label>
                            <Input
                              type="email"
                              placeholder="accountant@company.com"
                              value={accountantEmail}
                              onChange={(e) => setAccountantEmail(e.target.value)}
                              data-testid="input-accountant-email"
                            />
                          </div>
                        </div>
                        <DialogFooter>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setEmailDialogOpen(false)}
                            disabled={emailExportMutation.isPending}
                          >
                            Cancel
                          </Button>
                          <Button
                            size="sm"
                            disabled={!accountantEmail || emailExportMutation.isPending}
                            onClick={() =>
                              emailExportMutation.mutate({
                                periodId: selectedPeriodId,
                                email: accountantEmail,
                              })
                            }
                            data-testid="button-send-email"
                          >
                            <Send className="h-3 w-3 mr-1" />
                            {emailExportMutation.isPending ? "Sending..." : "Send"}
                          </Button>
                        </DialogFooter>
                      </DialogContent>
                    </Dialog>
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
