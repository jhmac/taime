import { useState, useCallback, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { invalidatePrefix } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import TimeCardModal from "@/components/TimeCardModal";
import ExportOptionsModal from "@/components/timesheets/ExportOptionsModal";
import OvertimePreventionPanel from "@/components/timesheets/OvertimePreventionPanel";
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
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient as qc } from "@/lib/queryClient";
import {
  Download,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  AlertTriangle,
  Clock,
  Lock,
  Mail,
  Users,
  Zap,
  ShieldAlert,
  Plus,
  MapPin,
} from "lucide-react";

interface OffsiteSessionInfo {
  id: string;
  exitTime: string;
  returnTime: string | null;
  durationMinutes: number | null;
  status: string;
  ruleId: string | null;
}

interface DailyEntry {
  id: string;
  clockInTime: string;
  clockOutTime: string | null;
  breakMinutes: number;
  hours: number;
  isApproved: boolean;
  notes: string | null;
  offsiteSessions?: OffsiteSessionInfo[];
}

interface DailyBreakdown {
  date: string;
  actual: number;
  regular: number;
  ot: number;
  offsiteMinutes?: number;
  entries: DailyEntry[];
}

interface NeedsReviewFlag {
  type: string;
  message: string;
  entryId: string;
}

interface ActiveOffsite {
  id: string;
  exitTime: string;
  durationMinutes: number | null;
  status: string;
  ruleId: string | null;
}

interface EmployeeReview {
  userId: string;
  firstName: string | null;
  lastName: string | null;
  profileImageUrl: string | null;
  email: string | null;
  actualHours: number;
  regularHours: number;
  otHours: number;
  offsiteMinutes?: number;
  status: string;
  needsReviewFlags: NeedsReviewFlag[];
  needsReviewCount: number;
  entryCount: number;
  dailyBreakdown: DailyBreakdown[];
  activeOffsite?: ActiveOffsite | null;
}

interface TimesheetReviewData {
  employees: EmployeeReview[];
  totals: { actualHours: number; regularHours: number; otHours: number };
  totalNeedsReview: number;
  otThreshold: number;
}

interface OTRiskEmployee {
  userId: string;
  firstName: string;
  lastName: string;
  currentHours: number;
  projectedHours: number;
  remainingShifts: Array<{
    scheduleId: string;
    startTime: string;
    endTime: string;
    shiftHours: number;
  }>;
  riskLevel: "green" | "yellow" | "red";
}

interface OTAlert {
  id: string;
  employeeId: string;
  currentHours: string;
  projectedHours: string;
  threshold: string;
  atRiskShiftId: string;
  suggestedReplacementId: string;
  aiReasoning: string;
  status: string;
  atRiskEmployeeName: string;
  replacementEmployeeName: string | null;
  shiftStart?: string;
  shiftEnd?: string;
  shiftHours?: number;
}

interface OTAlertsData {
  atRiskEmployees: OTRiskEmployee[];
  alerts: OTAlert[];
  weekStart: string;
  weekEnd: string;
  threshold: number;
}

function getDefaultDateRange() {
  const now = new Date();
  const dayOfWeek = now.getDay();
  const start = new Date(now);
  start.setDate(now.getDate() - dayOfWeek);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  end.setHours(23, 59, 59, 999);
  return {
    startDate: start.toISOString().split("T")[0],
    endDate: end.toISOString().split("T")[0],
  };
}

function formatTime(dateStr: string | null): string {
  if (!dateStr) return "—";
  return new Date(dateStr).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr + "T12:00:00");
  return d.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

function StatusBadge({ status }: { status: string }) {
  if (status === "approved") {
    return (
      <Badge variant="default" className="bg-green-600 hover:bg-green-700">
        <CheckCircle2 className="h-3 w-3 mr-1" />
        Approved
      </Badge>
    );
  }
  if (status === "needs-review") {
    return (
      <Badge variant="destructive" className="bg-amber-500 hover:bg-amber-600">
        <AlertTriangle className="h-3 w-3 mr-1" />
        Needs Review
      </Badge>
    );
  }
  return (
    <Badge variant="secondary">
      <Clock className="h-3 w-3 mr-1" />
      Pending
    </Badge>
  );
}

function OTProgressBar({ hours, threshold }: { hours: number; threshold: number }) {
  const pct = Math.min((hours / threshold) * 100, 100);
  let colorClass = "bg-green-500";
  if (hours >= threshold - 2) colorClass = "bg-red-500";
  else if (hours >= threshold - 5) colorClass = "bg-amber-500";

  return (
    <div className="flex items-center gap-2 min-w-[120px]">
      <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
        <div className={`h-full rounded-full transition-all ${colorClass}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-[10px] text-muted-foreground whitespace-nowrap">
        {hours.toFixed(1)}/{threshold}
      </span>
    </div>
  );
}

interface UserOption {
  id: string;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
}

function AddTimeCardDialog({
  open,
  onOpenChange,
  preselectedEmployeeId,
  employees,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  preselectedEmployeeId?: string;
  employees?: UserOption[];
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const today = new Date().toISOString().split("T")[0];
  const [employeeId, setEmployeeId] = useState(preselectedEmployeeId || "");
  const [date, setDate] = useState(today);
  const [clockInTime, setClockInTime] = useState("09:00");
  const [clockOutTime, setClockOutTime] = useState("17:00");
  const [breakMinutes, setBreakMinutes] = useState("0");
  const [notes, setNotes] = useState("");

  const { data: userList } = useQuery<UserOption[]>({
    queryKey: ["/api/users"],
    enabled: open && !employees?.length,
  });

  const availableEmployees = employees?.length ? employees : userList || [];

  const addEntryMutation = useMutation({
    mutationFn: async () => {
      const clockIn = new Date(`${date}T${clockInTime}:00`).toISOString();
      const clockOut = clockOutTime ? new Date(`${date}T${clockOutTime}:00`).toISOString() : undefined;
      await apiRequest("POST", "/api/timesheets/add-entry", {
        employeeId: preselectedEmployeeId || employeeId,
        clockInTime: clockIn,
        clockOutTime: clockOut,
        breakMinutes: parseInt(breakMinutes) || 0,
        notes: notes || undefined,
      });
    },
    onSuccess: () => {
      toast({ title: "Time card added", description: "Manual time entry has been created." });
      invalidatePrefix("/api/timesheets/review");
      onOpenChange(false);
      setEmployeeId("");
      setDate(today);
      setClockInTime("09:00");
      setClockOutTime("17:00");
      setBreakMinutes("0");
      setNotes("");
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const selectedEmp = availableEmployees.find((e) => e.id === preselectedEmployeeId);
  const selectedEmpName = selectedEmp
    ? [selectedEmp.firstName, selectedEmp.lastName].filter(Boolean).join(" ") || selectedEmp.email
    : "Selected employee";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Add Time Card</DialogTitle>
          <DialogDescription>
            Create a manual time entry for an employee. This will be logged in the audit trail.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-4">
          <div className="grid gap-2">
            <Label htmlFor="employee">Employee</Label>
            {preselectedEmployeeId ? (
              <p className="text-sm font-medium">{selectedEmpName}</p>
            ) : (
              <Select value={employeeId} onValueChange={setEmployeeId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select employee" />
                </SelectTrigger>
                <SelectContent>
                  {availableEmployees.map((emp) => (
                    <SelectItem key={emp.id} value={emp.id}>
                      {[emp.firstName, emp.lastName].filter(Boolean).join(" ") || emp.email || "Unknown"}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>
          <div className="grid gap-2">
            <Label htmlFor="date">Date</Label>
            <Input
              id="date"
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="grid gap-2">
              <Label htmlFor="clockIn">Clock In</Label>
              <Input
                id="clockIn"
                type="time"
                value={clockInTime}
                onChange={(e) => setClockInTime(e.target.value)}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="clockOut">Clock Out</Label>
              <Input
                id="clockOut"
                type="time"
                value={clockOutTime}
                onChange={(e) => setClockOutTime(e.target.value)}
              />
            </div>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="breakMinutes">Break Minutes</Label>
            <Input
              id="breakMinutes"
              type="number"
              min="0"
              max="480"
              value={breakMinutes}
              onChange={(e) => setBreakMinutes(e.target.value)}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="notes">Notes</Label>
            <Textarea
              id="notes"
              placeholder="Reason for manual entry..."
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={() => addEntryMutation.mutate()}
            disabled={addEntryMutation.isPending || (!preselectedEmployeeId && !employeeId) || !date || !clockInTime}
          >
            {addEntryMutation.isPending ? "Adding..." : "Add Time Card"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ExpandableEmployeeRow({
  employee,
  isExpanded,
  onToggle,
  otThreshold,
  onAddTimeCard,
  onEntryClick,
}: {
  employee: EmployeeReview;
  isExpanded: boolean;
  onToggle: () => void;
  otThreshold?: number;
  onAddTimeCard: (employeeId: string) => void;
  onEntryClick?: (entry: DailyEntry, date: string, employee: EmployeeReview) => void;
}) {
  const initials =
    ((employee.firstName?.[0] || "") + (employee.lastName?.[0] || "")).toUpperCase() || "?";
  const fullName = [employee.firstName, employee.lastName].filter(Boolean).join(" ") || "Unknown";
  const threshold = otThreshold || 40;

  return (
    <>
      <TableRow
        className="cursor-pointer hover:bg-muted/50 transition-colors"
        onClick={onToggle}
      >
        <TableCell>
          <div className="flex items-center gap-3">
            {isExpanded ? (
              <ChevronDown className="h-4 w-4 text-muted-foreground flex-shrink-0" />
            ) : (
              <ChevronRight className="h-4 w-4 text-muted-foreground flex-shrink-0" />
            )}
            <Avatar className="h-8 w-8">
              <AvatarImage src={employee.profileImageUrl || undefined} />
              <AvatarFallback className="text-xs">{initials}</AvatarFallback>
            </Avatar>
            <div>
              <p className="font-medium text-sm">{fullName}</p>
              <p className="text-xs text-muted-foreground">{employee.email}</p>
            </div>
          </div>
        </TableCell>
        <TableCell className="text-right font-mono text-sm">
          <div className="flex flex-col items-end gap-1">
            <span>{employee.actualHours.toFixed(2)}</span>
            <OTProgressBar hours={employee.actualHours} threshold={threshold} />
          </div>
        </TableCell>
        <TableCell className="text-right font-mono text-sm">
          {employee.regularHours.toFixed(2)}
        </TableCell>
        <TableCell className="text-right font-mono text-sm">
          <span className={employee.otHours > 0 ? "text-red-600 font-semibold" : ""}>
            {employee.otHours.toFixed(2)}
          </span>
        </TableCell>
        <TableCell className="text-right">
          <StatusBadge status={employee.status} />
        </TableCell>
      </TableRow>

      {isExpanded &&
        employee.dailyBreakdown.map((day) => (
          <TableRow
            key={day.date}
            className={
              day.entries.some((e) => !e.isApproved)
                ? "bg-amber-50 dark:bg-amber-950/20"
                : "bg-muted/30"
            }
          >
            <TableCell className="pl-16">
              <div className="flex flex-col">
                <span className="text-sm">{formatDate(day.date)}</span>
                <div className="flex flex-wrap gap-1 mt-1">
                  {day.entries.map((entry) => (
                    <div key={entry.id} className="flex flex-col">
                      <button
                        className="text-xs text-muted-foreground hover:text-primary hover:underline cursor-pointer transition-colors text-left"
                        onClick={(e) => {
                          e.stopPropagation();
                          onEntryClick?.(entry, day.date, employee);
                        }}
                      >
                        {formatTime(entry.clockInTime)} – {formatTime(entry.clockOutTime)}
                        {entry.breakMinutes > 0 && (
                          <span className="ml-1 text-muted-foreground/60">
                            ({entry.breakMinutes}m break)
                          </span>
                        )}
                      </button>
                      {entry.offsiteSessions && entry.offsiteSessions.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-0.5">
                          {entry.offsiteSessions.map((session) => {
                            const statusColor = session.status === "returned"
                              ? "text-green-600 bg-green-50 dark:bg-green-950/30 border-green-200 dark:border-green-800"
                              : session.status === "exceeded"
                              ? "text-amber-600 bg-amber-50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-800"
                              : session.status === "auto_clocked_out"
                              ? "text-red-600 bg-red-50 dark:bg-red-950/30 border-red-200 dark:border-red-800"
                              : "text-blue-600 bg-blue-50 dark:bg-blue-950/30 border-blue-200 dark:border-blue-800";
                            return (
                              <span
                                key={session.id}
                                className={`inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded border ${statusColor}`}
                              >
                                <MapPin className="h-2.5 w-2.5" />
                                Off-site: {formatTime(session.exitTime)}
                                {session.returnTime ? ` – ${formatTime(session.returnTime)}` : " (still out)"}
                                {session.durationMinutes != null && ` (${session.durationMinutes}m)`}
                              </span>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
                {(day.offsiteMinutes ?? 0) > 0 && (
                  <div className="flex items-center gap-1 mt-1">
                    <MapPin className="h-3 w-3 text-muted-foreground" />
                    <span className="text-[10px] text-muted-foreground">
                      {day.offsiteMinutes}m off-site total
                    </span>
                  </div>
                )}
              </div>
            </TableCell>
            <TableCell className="text-right font-mono text-xs text-muted-foreground">
              {day.actual.toFixed(2)}
            </TableCell>
            <TableCell className="text-right font-mono text-xs text-muted-foreground">
              {day.regular.toFixed(2)}
            </TableCell>
            <TableCell className="text-right font-mono text-xs text-muted-foreground">
              <span className={day.ot > 0 ? "text-red-500" : ""}>
                {day.ot.toFixed(2)}
              </span>
            </TableCell>
            <TableCell className="text-right">
              {day.entries.every((e) => e.isApproved) ? (
                <span className="text-xs text-green-600">✓</span>
              ) : (
                <span className="text-xs text-amber-500">Pending</span>
              )}
            </TableCell>
          </TableRow>
        ))}
      {isExpanded && (
        <TableRow className="bg-muted/10">
          <TableCell colSpan={5} className="pl-16">
            <Button
              variant="ghost"
              size="sm"
              className="text-xs text-primary hover:text-primary/80 h-7 px-2"
              onClick={(e) => {
                e.stopPropagation();
                onAddTimeCard(employee.userId);
              }}
            >
              <Plus className="h-3 w-3 mr-1" />
              Add time card
            </Button>
          </TableCell>
        </TableRow>
      )}
    </>
  );
}

function PayPeriodReviewTab({
  data,
  isLoading,
  onEntryClick,
}: {
  data: TimesheetReviewData | undefined;
  isLoading: boolean;
  onEntryClick?: (entry: DailyEntry, date: string, employee: EmployeeReview) => void;
}) {
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
  const [addTimeCardOpen, setAddTimeCardOpen] = useState(false);
  const [addTimeCardEmployeeId, setAddTimeCardEmployeeId] = useState<string | undefined>();

  const handleAddTimeCard = (employeeId: string) => {
    setAddTimeCardEmployeeId(employeeId);
    setAddTimeCardOpen(true);
  };

  const toggleRow = (userId: string) => {
    setExpandedRows((prev) => {
      const next = new Set(prev);
      if (next.has(userId)) {
        next.delete(userId);
      } else {
        next.add(userId);
      }
      return next;
    });
  };

  if (isLoading) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-12 w-full" />
        ))}
      </div>
    );
  }

  if (!data || data.employees.length === 0) {
    return (
      <Card>
        <CardContent className="py-12 text-center">
          <Users className="h-12 w-12 mx-auto text-muted-foreground mb-3" />
          <p className="text-muted-foreground">No time entries found for this period.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <>
    <Card>
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[300px]">Employee</TableHead>
                <TableHead className="text-right w-[120px]">Actual Hours</TableHead>
                <TableHead className="text-right w-[120px]">Regular Hours</TableHead>
                <TableHead className="text-right w-[120px]">OT Hours</TableHead>
                <TableHead className="text-right w-[140px]">Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.employees.map((emp) => (
                <ExpandableEmployeeRow
                  key={emp.userId}
                  employee={emp}
                  isExpanded={expandedRows.has(emp.userId)}
                  onToggle={() => toggleRow(emp.userId)}
                  otThreshold={data.otThreshold}
                  onAddTimeCard={handleAddTimeCard}
                  onEntryClick={onEntryClick}
                />
              ))}

              <TableRow className="bg-muted font-semibold border-t-2">
                <TableCell>
                  <span className="text-sm font-semibold">
                    Totals ({data.employees.length} employees)
                  </span>
                </TableCell>
                <TableCell className="text-right font-mono text-sm">
                  {data.totals.actualHours.toFixed(2)}
                </TableCell>
                <TableCell className="text-right font-mono text-sm">
                  {data.totals.regularHours.toFixed(2)}
                </TableCell>
                <TableCell className="text-right font-mono text-sm">
                  <span className={data.totals.otHours > 0 ? "text-red-600" : ""}>
                    {data.totals.otHours.toFixed(2)}
                  </span>
                </TableCell>
                <TableCell />
              </TableRow>
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
    <AddTimeCardDialog
      open={addTimeCardOpen}
      onOpenChange={(open) => {
        setAddTimeCardOpen(open);
        if (!open) setAddTimeCardEmployeeId(undefined);
      }}
      preselectedEmployeeId={addTimeCardEmployeeId}
      employees={data?.employees.map((e) => ({
        id: e.userId,
        firstName: e.firstName,
        lastName: e.lastName,
        email: e.email,
      }))}
    />
    </>
  );
}

function OffsiteLiveBadge({ activeOffsite }: { activeOffsite: ActiveOffsite }) {
  const exitDate = new Date(activeOffsite.exitTime);
  const elapsedMs = Date.now() - exitDate.getTime();
  const elapsedMinutes = Math.floor(elapsedMs / 60000);

  let colorClass = "border-green-500 text-green-600 bg-green-50 dark:bg-green-950/30";
  if (elapsedMinutes >= 30) {
    colorClass = "border-red-500 text-red-600 bg-red-50 dark:bg-red-950/30";
  } else if (elapsedMinutes >= 20) {
    colorClass = "border-amber-500 text-amber-600 bg-amber-50 dark:bg-amber-950/30";
  }

  return (
    <Badge variant="outline" className={`text-[10px] px-1 py-0 ${colorClass}`}>
      <MapPin className="h-2.5 w-2.5 mr-0.5" />
      Off-site {elapsedMinutes}m
    </Badge>
  );
}

function DailyReviewTab({ startDate, onEntryClick }: { startDate: string; onEntryClick?: (entry: DailyEntry, date: string, employee: EmployeeReview) => void }) {
  const today = new Date().toISOString().split("T")[0];

  const { data, isLoading } = useQuery<TimesheetReviewData>({
    queryKey: [`/api/timesheets/review?startDate=${today}&endDate=${today}`],
  });

  if (isLoading) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-16 w-full" />
        ))}
      </div>
    );
  }

  if (!data || data.employees.length === 0) {
    return (
      <Card>
        <CardContent className="py-12 text-center">
          <Clock className="h-12 w-12 mx-auto text-muted-foreground mb-3" />
          <p className="text-muted-foreground">No entries for today.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Employee</TableHead>
                <TableHead>Clock In</TableHead>
                <TableHead>Clock Out</TableHead>
                <TableHead className="text-right">Hours</TableHead>
                <TableHead className="text-right">Breaks</TableHead>
                <TableHead className="text-right">Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.employees.map((emp) => {
                const initials =
                  ((emp.firstName?.[0] || "") + (emp.lastName?.[0] || "")).toUpperCase() || "?";
                const fullName =
                  [emp.firstName, emp.lastName].filter(Boolean).join(" ") || "Unknown";
                const todayEntries = emp.dailyBreakdown[0]?.entries || [];
                const latestEntry = todayEntries[todayEntries.length - 1];

                return (
                  <TableRow
                    key={emp.userId}
                    className="cursor-pointer hover:bg-muted/50 transition-colors"
                    onClick={() => {
                      if (latestEntry) {
                        onEntryClick?.(latestEntry, today, emp);
                      }
                    }}
                  >
                    <TableCell>
                      <div className="flex items-center gap-3">
                        <Avatar className="h-8 w-8">
                          <AvatarImage src={emp.profileImageUrl || undefined} />
                          <AvatarFallback className="text-xs">{initials}</AvatarFallback>
                        </Avatar>
                        <div>
                          <p className="font-medium text-sm">{fullName}</p>
                          <div className="flex flex-wrap gap-1 mt-0.5">
                            {!latestEntry?.clockOutTime && (
                              <Badge variant="outline" className="text-[10px] px-1 py-0 border-green-500 text-green-600">
                                Clocked In
                              </Badge>
                            )}
                            {emp.activeOffsite && (
                              <OffsiteLiveBadge activeOffsite={emp.activeOffsite} />
                            )}
                          </div>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="text-sm">
                      {latestEntry ? formatTime(latestEntry.clockInTime) : "—"}
                    </TableCell>
                    <TableCell className="text-sm">
                      {latestEntry ? formatTime(latestEntry.clockOutTime) : "—"}
                    </TableCell>
                    <TableCell className="text-right font-mono text-sm">
                      {emp.actualHours.toFixed(2)}
                    </TableCell>
                    <TableCell className="text-right text-sm">
                      {todayEntries.reduce((sum, e) => sum + e.breakMinutes, 0)}m
                    </TableCell>
                    <TableCell className="text-right">
                      <StatusBadge status={emp.status} />
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}

function OvertimeAlertsBanner({ alertCount, onToggle, isExpanded }: { alertCount: number; onToggle: () => void; isExpanded: boolean }) {
  if (alertCount === 0) return null;

  return (
    <div
      className="flex items-center justify-between p-3 rounded-lg bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 cursor-pointer"
      onClick={onToggle}
    >
      <div className="flex items-center gap-3">
        <div className="p-2 rounded-full bg-red-100 dark:bg-red-900/50">
          <ShieldAlert className="h-5 w-5 text-red-600 dark:text-red-400" />
        </div>
        <div>
          <p className="font-semibold text-red-800 dark:text-red-300 text-sm">
            {alertCount} employee{alertCount !== 1 ? "s" : ""} approaching overtime this week
          </p>
          <p className="text-xs text-red-600 dark:text-red-400">
            Click to review AI-powered swap suggestions
          </p>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <Badge variant="destructive" className="bg-red-600">
          <Zap className="h-3 w-3 mr-1" />
          {alertCount} Alert{alertCount !== 1 ? "s" : ""}
        </Badge>
        {isExpanded ? (
          <ChevronUp className="h-5 w-5 text-red-600" />
        ) : (
          <ChevronDown className="h-5 w-5 text-red-600" />
        )}
      </div>
    </div>
  );
}


export default function Timesheets() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const defaults = getDefaultDateRange();
  const [startDate, setStartDate] = useState(defaults.startDate);
  const [endDate, setEndDate] = useState(defaults.endDate);
  const [activeTab, setActiveTab] = useState("pay-period");
  const [showOTPanel, setShowOTPanel] = useState(false);
  const [timeCardModalOpen, setTimeCardModalOpen] = useState(false);
  const [selectedEntry, setSelectedEntry] = useState<DailyEntry | null>(null);
  const [selectedDate, setSelectedDate] = useState("");
  const [selectedEmployee, setSelectedEmployee] = useState<EmployeeReview | null>(null);
  const [allFlatEntries, setAllFlatEntries] = useState<Array<{ entry: DailyEntry; date: string; employee: EmployeeReview }>>([]);
  const [showAddTimeCard, setShowAddTimeCard] = useState(false);
  const [exportModalOpen, setExportModalOpen] = useState(false);

  const { data, isLoading, refetch } = useQuery<TimesheetReviewData>({
    queryKey: [`/api/timesheets/review?startDate=${startDate}&endDate=${endDate}`],
  });

  const { data: otData } = useQuery<OTAlertsData>({
    queryKey: ["/api/timesheets/overtime-alerts"],
  });

  const otRiskCount = otData?.atRiskEmployees?.length || 0;

  const handleEntryClick = useCallback((entry: DailyEntry, date: string, employee: EmployeeReview) => {
    setSelectedEntry(entry);
    setSelectedDate(date);
    setSelectedEmployee(employee);
    setTimeCardModalOpen(true);

    if (data) {
      const flat: Array<{ entry: DailyEntry; date: string; employee: EmployeeReview }> = [];
      for (const emp of data.employees) {
        for (const day of emp.dailyBreakdown) {
          for (const e of day.entries) {
            flat.push({ entry: e, date: day.date, employee: emp });
          }
        }
      }
      setAllFlatEntries(flat);
    }
  }, [data]);

  const handleNavigate = useCallback((direction: "prev" | "next") => {
    if (!selectedEntry || allFlatEntries.length === 0) return;
    const idx = allFlatEntries.findIndex((item) => item.entry.id === selectedEntry.id);
    if (idx === -1) return;
    const newIdx = direction === "prev" ? idx - 1 : idx + 1;
    if (newIdx < 0 || newIdx >= allFlatEntries.length) return;
    const next = allFlatEntries[newIdx];
    setSelectedEntry(next.entry);
    setSelectedDate(next.date);
    setSelectedEmployee(next.employee);
  }, [selectedEntry, allFlatEntries]);

  const currentIdx = selectedEntry ? allFlatEntries.findIndex((item) => item.entry.id === selectedEntry.id) : -1;

  const approveAllMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("POST", "/api/timesheets/approve-all", { startDate, endDate });
    },
    onSuccess: () => {
      toast({ title: "All entries approved", description: "All eligible time entries have been approved." });
      invalidatePrefix("/api/timesheets/review");
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const lockPeriodMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("POST", "/api/timesheets/lock-period", { startDate, endDate });
    },
    onSuccess: () => {
      toast({ title: "Period locked", description: "This pay period has been locked." });
      invalidatePrefix("/api/timesheets/review");
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const handleEmailAccountant = async () => {
    toast({ title: "Coming soon", description: "Email export will be available shortly." });
  };

  return (
    <div className="max-w-7xl mx-auto p-4 md:p-6 space-y-6 pb-24 md:pb-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold">Timesheets</h1>
          {data && data.totalNeedsReview > 0 && (
            <Badge variant="destructive" className="bg-amber-500 hover:bg-amber-600">
              <AlertTriangle className="h-3 w-3 mr-1" />
              {data.totalNeedsReview} Needs Review
            </Badge>
          )}
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <Input
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            className="w-[150px] text-sm"
          />
          <span className="text-muted-foreground text-sm">to</span>
          <Input
            type="date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            className="w-[150px] text-sm"
          />
        </div>
      </div>

      <OvertimeAlertsBanner
        alertCount={otRiskCount}
        onToggle={() => setShowOTPanel(!showOTPanel)}
        isExpanded={showOTPanel}
      />

      {showOTPanel && <OvertimePreventionPanel />}

      <div className="flex flex-wrap gap-2">
        <Button
          onClick={() => approveAllMutation.mutate()}
          disabled={approveAllMutation.isPending}
          variant="default"
          size="sm"
        >
          <CheckCircle2 className="h-4 w-4 mr-1" />
          {approveAllMutation.isPending ? "Approving…" : "Approve All"}
        </Button>
        <Button onClick={() => setExportModalOpen(true)} variant="outline" size="sm">
          <Download className="h-4 w-4 mr-1" />
          Download CSV
        </Button>
        <Button onClick={handleEmailAccountant} variant="outline" size="sm">
          <Mail className="h-4 w-4 mr-1" />
          Email to Accountant
        </Button>
        <Button
          onClick={() => lockPeriodMutation.mutate()}
          disabled={lockPeriodMutation.isPending}
          variant="outline"
          size="sm"
        >
          <Lock className="h-4 w-4 mr-1" />
          {lockPeriodMutation.isPending ? "Locking…" : "Lock Period"}
        </Button>
        <Button
          onClick={() => setShowAddTimeCard(true)}
          variant="outline"
          size="sm"
        >
          <Plus className="h-4 w-4 mr-1" />
          Add Time Card
        </Button>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="pay-period">Pay Period Review</TabsTrigger>
          <TabsTrigger value="daily">Daily Review</TabsTrigger>
        </TabsList>

        <TabsContent value="pay-period" className="mt-4">
          <PayPeriodReviewTab data={data} isLoading={isLoading} onEntryClick={handleEntryClick} />
        </TabsContent>

        <TabsContent value="daily" className="mt-4">
          <DailyReviewTab startDate={startDate} onEntryClick={handleEntryClick} />
        </TabsContent>
      </Tabs>

      <AddTimeCardDialog
        open={showAddTimeCard}
        onOpenChange={setShowAddTimeCard}
      />

      <ExportOptionsModal
        open={exportModalOpen}
        onOpenChange={setExportModalOpen}
        startDate={startDate}
        endDate={endDate}
      />

      <TimeCardModal
        open={timeCardModalOpen}
        onOpenChange={setTimeCardModalOpen}
        entry={selectedEntry}
        employee={selectedEmployee ? {
          userId: selectedEmployee.userId,
          firstName: selectedEmployee.firstName,
          lastName: selectedEmployee.lastName,
          profileImageUrl: selectedEmployee.profileImageUrl,
          email: selectedEmployee.email,
        } : null}
        date={selectedDate}
        onNavigate={handleNavigate}
        hasPrev={currentIdx > 0}
        hasNext={currentIdx >= 0 && currentIdx < allFlatEntries.length - 1}
      />
    </div>
  );
}
