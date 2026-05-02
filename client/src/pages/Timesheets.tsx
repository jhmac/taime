import { useState, useCallback, useMemo, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { invalidatePrefix } from "@/lib/queryClient";
import { cn } from "@/lib/utils";
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
import { Switch } from "@/components/ui/switch";
import {
  Download,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
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
  X,
  Calendar,
  UserX,
  LogOut,
  TrendingDown,
  Settings,
  Bell,
  ClockIcon,
  MinusCircle,
  ShieldCheck,
  ShieldOff,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

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
  scheduledStart?: string | null;
  scheduledEnd?: string | null;
  scheduledHours?: number | null;
  discrepancies?: string[];
  offsiteSessions?: OffsiteSessionInfo[];
  mileageReimbursements?: Array<{
    id: string;
    milesDecimal: number;
    rateCents: number;
    totalCents: number;
    equivalentMinutes: number;
    adjustedMilesDecimal: string | null;
  }>;
}

interface DailyBreakdown {
  date: string;
  actual: number;
  regular: number;
  ot: number;
  offsiteMinutes?: number;
  scheduledHours?: number;
  schedules?: Array<{ id: string; startTime: string; endTime: string }>;
  entries: DailyEntry[];
}

interface NeedsReviewFlag {
  type: string;
  message: string;
  entryId: string;
}

interface DiscrepancyAlert {
  type: "no_show" | "missing_clock_out" | "early_departure" | "short_shift" | "long_shift" | "unapproved";
  message: string;
  entryId?: string;
  scheduleId?: string;
  userId: string;
  date: string;
  scheduledStart?: string;
  scheduledEnd?: string;
  scheduledHours?: number;
  actualHours?: number;
  actualClockIn?: string;
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
  discrepancyAlerts?: DiscrepancyAlert[];
  entryCount: number;
  dailyBreakdown: DailyBreakdown[];
  activeOffsite?: ActiveOffsite | null;
}

interface PeriodApproval {
  id: string;
  storeId: string;
  periodStart: string;
  periodEnd: string;
  status: string;
  managerApprovedBy?: string | null;
  managerApprovedAt?: string | null;
  managerApproverName?: string | null;
  adminApprovedBy?: string | null;
  adminApprovedAt?: string | null;
  adminApproverName?: string | null;
}

interface HealthSummary {
  totalEmployees: number;
  approvedCount: number;
  needsReviewCount: number;
  noEntriesCount: number;
  pendingClockOutCount: number;
}

interface TimesheetReviewData {
  employees: EmployeeReview[];
  totals: { actualHours: number; regularHours: number; otHours: number };
  totalNeedsReview: number;
  otThreshold: number;
  discrepancyAlerts?: DiscrepancyAlert[];
  periodApproval?: PeriodApproval | null;
  healthSummary?: HealthSummary;
}

interface PayPeriodSettings {
  id: string;
  intervalType: string | null;
  firstPayPeriodStart: string | null;
  firstPayPeriodEnd: string | null;
  payScheduleFrequency?: string | null;
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
  if (status === "pending_clock_out") {
    return (
      <Badge variant="outline" className="border-orange-400 text-orange-600 dark:text-orange-400">
        <ClockIcon className="h-3 w-3 mr-1" />
        Clocked In
      </Badge>
    );
  }
  if (status === "no_entries") {
    return (
      <Badge variant="outline" className="border-muted text-muted-foreground">
        <MinusCircle className="h-3 w-3 mr-1" />
        No entries
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

interface WorkflowSettings {
  id?: string;
  managerReminderDaysAfterPeriod: number;
  managerEscalationDaysAfterReminder: number;
  notifyAdminOnManagerApproval: boolean;
  employeeSelfReviewReminder: boolean;
  singleStepApproval: boolean;
  emailRemindersEnabled: boolean;
  reminderFromEmail: string | null;
  managerUserIds: string[];
  adminUserId: string | null;
}

function WorkflowSettingsTab() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: settings, isLoading } = useQuery<WorkflowSettings>({
    queryKey: ["/api/timesheets/workflow-settings"],
  });

  const { data: allUsersData } = useQuery<{ id: string; firstName: string | null; lastName: string | null; email: string | null }[]>({
    queryKey: ["/api/users"],
  });

  const [form, setForm] = useState<WorkflowSettings>({
    managerReminderDaysAfterPeriod: 2,
    managerEscalationDaysAfterReminder: 3,
    notifyAdminOnManagerApproval: true,
    employeeSelfReviewReminder: false,
    singleStepApproval: false,
    emailRemindersEnabled: false,
    reminderFromEmail: null,
    managerUserIds: [],
    adminUserId: null,
  });

  const [dirty, setDirty] = useState(false);

  const mergeSettings = (s: WorkflowSettings) => {
    setForm({
      managerReminderDaysAfterPeriod: s.managerReminderDaysAfterPeriod ?? 2,
      managerEscalationDaysAfterReminder: s.managerEscalationDaysAfterReminder ?? 3,
      notifyAdminOnManagerApproval: s.notifyAdminOnManagerApproval ?? true,
      employeeSelfReviewReminder: s.employeeSelfReviewReminder ?? false,
      singleStepApproval: s.singleStepApproval ?? false,
      emailRemindersEnabled: s.emailRemindersEnabled ?? false,
      reminderFromEmail: s.reminderFromEmail ?? null,
      managerUserIds: (s.managerUserIds as string[]) || [],
      adminUserId: s.adminUserId || null,
    });
    setDirty(false);
  };

  useEffect(() => {
    if (settings) mergeSettings(settings);
  }, [settings]);

  const saveMutation = useMutation({
    mutationFn: async (data: WorkflowSettings) => {
      await apiRequest("POST", "/api/timesheets/workflow-settings", data);
    },
    onSuccess: () => {
      toast({ title: "Workflow settings saved" });
      queryClient.invalidateQueries({ queryKey: ["/api/timesheets/workflow-settings"] });
      setDirty(false);
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const updateField = <K extends keyof WorkflowSettings>(key: K, value: WorkflowSettings[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
    setDirty(true);
  };

  const userOptions = allUsersData || [];
  const getUserLabel = (id: string) => {
    const u = userOptions.find((u) => u.id === id);
    if (!u) return id;
    return [u.firstName, u.lastName].filter(Boolean).join(" ") || u.email || id;
  };

  if (isLoading) {
    return (
      <div className="space-y-4 py-4">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-12 w-full" />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-6 py-2 max-w-2xl">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold">Approval workflow</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Configure how timesheets are reviewed and approved each pay period.
          </p>
        </div>
        <Button
          size="sm"
          disabled={!dirty || saveMutation.isPending}
          onClick={() => saveMutation.mutate(form)}
        >
          {saveMutation.isPending ? "Saving…" : "Save settings"}
        </Button>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <Settings className="h-4 w-4" />
            Approval mode
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <Label className="text-sm font-medium">Single-step approval</Label>
              <p className="text-xs text-muted-foreground mt-0.5">
                When enabled, "Approve All" immediately finalizes the period without a second confirmation step.
              </p>
            </div>
            <Switch
              checked={form.singleStepApproval}
              onCheckedChange={(v) => updateField("singleStepApproval", v)}
            />
          </div>
          <div className="flex items-center justify-between">
            <div>
              <Label className="text-sm font-medium">Notify admin on manager approval</Label>
              <p className="text-xs text-muted-foreground mt-0.5">
                Admin receives a notification when a manager approves the period.
              </p>
            </div>
            <Switch
              checked={form.notifyAdminOnManagerApproval}
              onCheckedChange={(v) => updateField("notifyAdminOnManagerApproval", v)}
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <Bell className="h-4 w-4" />
            Reminder schedule
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label className="text-xs">Manager reminder (days after period end)</Label>
              <Input
                type="number"
                min={0}
                max={30}
                value={form.managerReminderDaysAfterPeriod}
                onChange={(e) => updateField("managerReminderDaysAfterPeriod", Number(e.target.value))}
                className="h-8 text-sm"
              />
              <p className="text-[10px] text-muted-foreground">
                Reminder sent this many days after pay period ends
              </p>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Escalation (days after reminder)</Label>
              <Input
                type="number"
                min={0}
                max={30}
                value={form.managerEscalationDaysAfterReminder}
                onChange={(e) => updateField("managerEscalationDaysAfterReminder", Number(e.target.value))}
                className="h-8 text-sm"
              />
              <p className="text-[10px] text-muted-foreground">
                Admin escalation sent this many days after the manager reminder
              </p>
            </div>
          </div>

          <div className="flex items-center justify-between pt-2 border-t">
            <div>
              <Label className="text-sm font-medium">Employee self-review reminder</Label>
              <p className="text-xs text-muted-foreground mt-0.5">
                Notify employees on the last day of their pay period to review their own hours.
              </p>
            </div>
            <Switch
              checked={form.employeeSelfReviewReminder}
              onCheckedChange={(v) => updateField("employeeSelfReviewReminder", v)}
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <Users className="h-4 w-4" />
            Approval chain
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label className="text-xs">Manager(s) — who reviews timesheets first</Label>
            <div className="space-y-2">
              {form.managerUserIds.map((uid) => (
                <div key={uid} className="flex items-center justify-between rounded-md border px-3 py-1.5 bg-muted/30 text-sm">
                  <span>{getUserLabel(uid)}</span>
                  <button
                    className="text-muted-foreground hover:text-destructive transition-colors"
                    onClick={() => updateField("managerUserIds", form.managerUserIds.filter((id) => id !== uid))}
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
              <Select
                value=""
                onValueChange={(v) => {
                  if (v && !form.managerUserIds.includes(v)) {
                    updateField("managerUserIds", [...form.managerUserIds, v]);
                  }
                }}
              >
                <SelectTrigger className="h-8 text-xs text-muted-foreground">
                  <SelectValue placeholder="+ Add manager" />
                </SelectTrigger>
                <SelectContent>
                  {userOptions
                    .filter((u) => !form.managerUserIds.includes(u.id))
                    .map((u) => (
                      <SelectItem key={u.id} value={u.id}>
                        {[u.firstName, u.lastName].filter(Boolean).join(" ") || u.email || u.id}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">Admin — receives escalations</Label>
            <Select
              value={form.adminUserId || "none"}
              onValueChange={(v) => updateField("adminUserId", v === "none" ? null : v)}
            >
              <SelectTrigger className="h-8 text-sm">
                <SelectValue placeholder="Select admin" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">None</SelectItem>
                {userOptions.map((u) => (
                  <SelectItem key={u.id} value={u.id}>
                    {[u.firstName, u.lastName].filter(Boolean).join(" ") || u.email || u.id}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <Mail className="h-4 w-4" />
            Email reminders
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <Label className="text-sm font-medium">Send email reminders via SendGrid</Label>
              <p className="text-xs text-muted-foreground mt-0.5">
                In addition to in-app notifications, send emails. Requires SENDGRID_API_KEY to be configured.
              </p>
            </div>
            <Switch
              checked={form.emailRemindersEnabled}
              onCheckedChange={(v) => updateField("emailRemindersEnabled", v)}
            />
          </div>
          {form.emailRemindersEnabled && (
            <div className="space-y-1.5">
              <Label className="text-xs">From email address</Label>
              <Input
                type="email"
                placeholder="no-reply@yourstore.com"
                value={form.reminderFromEmail || ""}
                onChange={(e) => updateField("reminderFromEmail", e.target.value || null)}
                className="h-8 text-sm"
              />
              <p className="text-[10px] text-muted-foreground">
                Leave blank to use the default sender (no-reply@taime.app)
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {!form.singleStepApproval && (
        <Card className="bg-muted/30">
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
              Reminder sequence preview (two-step mode)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ol className="text-xs text-muted-foreground space-y-1.5 list-decimal list-inside">
              {form.employeeSelfReviewReminder && (
                <li>Last day of period — employees reminded to review their hours</li>
              )}
              <li>Day {form.managerReminderDaysAfterPeriod} after period end — manager(s) reminded to review timesheets</li>
              <li>Day {form.managerReminderDaysAfterPeriod + form.managerEscalationDaysAfterReminder} after period end — admin escalation if manager hasn't reviewed</li>
              <li>After manager approves — admin nudged to finalize within {form.managerEscalationDaysAfterReminder} days</li>
              {form.notifyAdminOnManagerApproval && (
                <li>Immediately on manager approval — admin notified to finalize</li>
              )}
            </ol>
          </CardContent>
        </Card>
      )}

      <div className="text-xs text-muted-foreground flex items-center gap-1.5 pt-2 border-t">
        <Bell className="h-3.5 w-3.5 flex-shrink-0" />
        Reminders run once daily. Configure pay period intervals in{" "}
        <a href="/settings?tab=pay-period" className="underline hover:text-foreground">
          Pay Period Settings
        </a>
        .
      </div>

      <ReminderLogTable />
    </div>
  );
}

function ReminderLogTable() {
  const { data: logs, isLoading } = useQuery<{
    id: string;
    periodStart: string;
    periodEnd: string;
    reminderType: string;
    userId: string | null;
    sentAt: string | null;
    wasActedOn: boolean | null;
    actedOnAt: string | null;
  }[]>({
    queryKey: ["/api/timesheets/reminder-log"],
    staleTime: 30000,
  });

  const reminderTypeLabel = (type: string) => {
    switch (type) {
      case "manager_reminder": return "Manager reminder";
      case "manager_escalation": return "Admin escalation";
      case "employee_self_review": return "Employee self-review";
      case "manager_approval_notify": return "Admin notified (approval)";
      case "admin_finalize_nudge": return "Admin finalize nudge";
      default: return type;
    }
  };

  if (isLoading) {
    return <Skeleton className="h-24 w-full mt-4" />;
  }

  if (!logs || logs.length === 0) {
    return (
      <div className="mt-4 rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
        No reminders have been sent yet. They will appear here once the daily schedule runs.
      </div>
    );
  }

  return (
    <Card className="mt-4">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm flex items-center gap-2">
          <Bell className="h-4 w-4" />
          Recent reminder activity
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="text-xs pl-4">Type</TableHead>
              <TableHead className="text-xs">Pay period</TableHead>
              <TableHead className="text-xs">Sent</TableHead>
              <TableHead className="text-xs">Acted on</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {logs.slice(0, 30).map((log) => (
              <TableRow key={log.id} className="text-xs">
                <TableCell className="pl-4 py-2 font-medium">{reminderTypeLabel(log.reminderType)}</TableCell>
                <TableCell className="py-2 text-muted-foreground">
                  {log.periodStart} – {log.periodEnd}
                </TableCell>
                <TableCell className="py-2 text-muted-foreground">
                  {log.sentAt ? new Date(log.sentAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "—"}
                </TableCell>
                <TableCell className="py-2">
                  {log.wasActedOn ? (
                    <span className="text-green-600 dark:text-green-400 flex items-center gap-1">
                      <CheckCircle2 className="h-3 w-3" /> Yes
                    </span>
                  ) : (
                    <span className="text-muted-foreground">No</span>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
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
  scheduleSource,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  preselectedEmployeeId?: string;
  employees?: UserOption[];
  scheduleSource?: EmployeeReview[];
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

  const effectiveEmployeeId = preselectedEmployeeId || employeeId;

  const matchedSchedule = useMemo(() => {
    if (!effectiveEmployeeId || !date || !scheduleSource?.length) return null;
    const emp = scheduleSource.find((e) => e.userId === effectiveEmployeeId);
    const day = emp?.dailyBreakdown.find((d) => d.date === date);
    return day?.schedules?.[0] || null;
  }, [scheduleSource, effectiveEmployeeId, date]);

  useEffect(() => {
    if (!open) return;
    if (matchedSchedule) {
      setClockInTime(toTimeInput(matchedSchedule.startTime) || "09:00");
      setClockOutTime(toTimeInput(matchedSchedule.endTime) || "17:00");
    } else {
      setClockInTime("09:00");
      setClockOutTime("17:00");
    }
  }, [open, matchedSchedule]);

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
              day.entries.length === 0 && (day.scheduledHours ?? 0) > 0
                ? "bg-red-50 dark:bg-red-950/20"
                : day.entries.some((e) => e.discrepancies && e.discrepancies.length > 0)
                ? "bg-amber-50 dark:bg-amber-950/20"
                : day.entries.some((e) => !e.isApproved)
                ? "bg-muted/40"
                : "bg-muted/30"
            }
          >
            <TableCell className="pl-16">
              <div className="flex flex-col gap-1">
                <span className="text-sm font-medium">{formatDate(day.date)}</span>
                {day.scheduledHours != null && day.scheduledHours > 0 && (
                  <span className="text-xs text-muted-foreground flex items-center gap-1">
                    <Calendar className="h-3 w-3" />
                    Scheduled: {day.scheduledHours.toFixed(1)}h
                    {day.schedules && day.schedules[0] && (
                      <span className="text-muted-foreground/60">
                        ({formatTime(day.schedules[0].startTime)} – {formatTime(day.schedules[0].endTime)})
                      </span>
                    )}
                  </span>
                )}
                <div className="flex flex-wrap gap-1 mt-0.5">
                  {day.entries.length === 0 && day.scheduledHours != null && day.scheduledHours > 0 && (
                    <span className="inline-flex items-center gap-1 text-xs text-red-600 dark:text-red-400 font-medium">
                      <AlertTriangle className="h-3 w-3" />
                      No show
                    </span>
                  )}
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
                        {entry.discrepancies && entry.discrepancies.length > 0 && (
                          <span className="ml-1 text-amber-600">
                            <AlertTriangle className="h-3 w-3 inline" />
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
                      {entry.mileageReimbursements && entry.mileageReimbursements.length > 0 && (
                        <div className="mt-1 flex flex-col gap-0.5">
                          {entry.mileageReimbursements.map((reimb) => {
                            const miles = reimb.adjustedMilesDecimal != null
                              ? parseFloat(reimb.adjustedMilesDecimal)
                              : reimb.milesDecimal;
                            const ratePerMile = (reimb.rateCents / 100).toFixed(2);
                            const total = (reimb.totalCents / 100).toFixed(2);
                            return (
                              <div
                                key={reimb.id}
                                className="pl-2 border-l-2 border-dashed border-muted-foreground/30 text-[10px] text-muted-foreground"
                              >
                                🚗 Mileage: {miles.toFixed(2)} mi × ${ratePerMile}/mi = ${total}
                                {reimb.equivalentMinutes > 0 && ` (+${reimb.equivalentMinutes}min)`}
                                {reimb.adjustedMilesDecimal != null && (
                                  <span className="ml-1 text-amber-600">(adjusted)</span>
                                )}
                              </div>
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

function getDiscrepancyIcon(type: string) {
  switch (type) {
    case "no_show": return <UserX className="h-4 w-4 text-red-500" />;
    case "missing_clock_out": return <LogOut className="h-4 w-4 text-amber-500" />;
    case "early_departure": return <TrendingDown className="h-4 w-4 text-orange-500" />;
    case "short_shift": return <Clock className="h-4 w-4 text-amber-500" />;
    case "long_shift": return <Clock className="h-4 w-4 text-blue-500" />;
    default: return <AlertTriangle className="h-4 w-4 text-amber-500" />;
  }
}

function getDiscrepancyLabel(type: string) {
  switch (type) {
    case "no_show": return "No show";
    case "missing_clock_out": return "Missing clock-out";
    case "early_departure": return "Early departure";
    case "short_shift": return "Short shift";
    case "long_shift": return "Long shift";
    default: return "Review needed";
  }
}

function formatDuration(hours: number): string {
  const totalMinutes = Math.round(hours * 60);
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  if (h === 0) return `${m} min`;
  if (m === 0) return `${h} hr${h !== 1 ? "s" : ""}`;
  return `${h} hr${h !== 1 ? "s" : ""} ${m} min`;
}

function IssueBadge({ type }: { type: string }) {
  const configs: Record<string, { label: string; className: string }> = {
    no_show: { label: "No show", className: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400 border-red-200 dark:border-red-800" },
    missing_clock_out: { label: "Missing clock-out", className: "bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-400 border-orange-200 dark:border-orange-800" },
    unscheduled_shift: { label: "Unscheduled shift", className: "bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-400 border-orange-200 dark:border-orange-800" },
    early_departure: { label: "Early departure", className: "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-400 border-yellow-200 dark:border-yellow-800" },
    short_shift: { label: "Short shift", className: "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-400 border-yellow-200 dark:border-yellow-800" },
    long_shift: { label: "Long shift", className: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-400 border-blue-200 dark:border-blue-800" },
  };
  const cfg = configs[type] || { label: getDiscrepancyLabel(type), className: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400 border-amber-200 dark:border-amber-800" };
  const Icon = getDiscrepancyIcon(type);
  return (
    <span className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full border ${cfg.className}`}>
      {Icon}
      {cfg.label}
    </span>
  );
}

function toTimeInput(dateStr?: string | null): string {
  if (!dateStr) return "";
  const d = new Date(dateStr);
  return `${d.getHours().toString().padStart(2, "0")}:${d.getMinutes().toString().padStart(2, "0")}`;
}

function ResolveDiscrepancyDialog({
  open,
  onOpenChange,
  alert,
  employees,
  onResolved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  alert: DiscrepancyAlert | null;
  employees: EmployeeReview[];
  onResolved: () => void;
}) {
  const { toast } = useToast();
  const [action, setAction] = useState<"excuse" | "add_time_card">("excuse");
  const [reason, setReason] = useState("");
  const [clockInTime, setClockInTime] = useState("09:00");
  const [clockOutTime, setClockOutTime] = useState("17:00");
  const [breakMins, setBreakMins] = useState("0");

  useEffect(() => {
    if (open && alert) {
      setClockInTime(
        toTimeInput(alert.actualClockIn) ||
        toTimeInput(alert.scheduledStart) ||
        "09:00"
      );
      setClockOutTime(toTimeInput(alert.scheduledEnd) || "17:00");
      setAction("excuse");
      setReason("");
      setBreakMins("0");
    }
  }, [open, alert]);

  const employee = employees.find((e) => e.userId === alert?.userId);
  const employeeName = employee
    ? [employee.firstName, employee.lastName].filter(Boolean).join(" ") || employee.email || "Employee"
    : "Employee";

  const resolveMutation = useMutation({
    mutationFn: async () => {
      if (!alert) return;

      const payload: {
        action: "excuse" | "add_time_card";
        employeeId: string;
        date: string;
        discrepancyType: string;
        reason: string;
        entryId?: string;
        clockInTime?: string;
        clockOutTime?: string;
        breakMinutes?: number;
      } = {
        action,
        employeeId: alert.userId,
        date: alert.date,
        discrepancyType: alert.type,
        reason,
        entryId: alert.entryId || undefined,
      };

      if (action === "add_time_card") {
        payload.clockInTime = clockInTime;
        payload.clockOutTime = clockOutTime || undefined;
        payload.breakMinutes = parseInt(breakMins) || 0;
      }

      await apiRequest("POST", "/api/timesheets/resolve-discrepancy", payload);
    },
    onSuccess: () => {
      toast({ title: "Resolved", description: "Discrepancy has been resolved and saved to audit trail." });
      invalidatePrefix("/api/timesheets/review");
      onResolved();
      onOpenChange(false);
      setReason("");
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  if (!alert) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {getDiscrepancyIcon(alert.type)}
            Resolve: {getDiscrepancyLabel(alert.type)}
          </DialogTitle>
          <DialogDescription>
            {employeeName} &bull; {formatDate(alert.date)}
            {alert.scheduledStart && (
              <span className="block mt-1 text-xs">
                Scheduled: {formatTime(alert.scheduledStart)} – {formatTime(alert.scheduledEnd || null)}
                {alert.scheduledHours != null && ` (${alert.scheduledHours.toFixed(1)} hr)`}
              </span>
            )}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-4">
          <div className="grid gap-2">
            <Label>Resolution action</Label>
            <Select value={action} onValueChange={(v) => setAction(v as "excuse" | "add_time_card")}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="excuse">Mark as excused absence</SelectItem>
                <SelectItem value="add_time_card">Add manual time card</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {action === "add_time_card" && (
            <>
              {alert?.scheduledStart && (
                <div className="flex items-center justify-between rounded-md bg-muted/60 px-3 py-2 text-sm text-muted-foreground">
                  <span>Scheduled shift</span>
                  <span className="font-medium">
                    {formatTime(alert.scheduledStart)} – {formatTime(alert.scheduledEnd ?? null)}
                  </span>
                </div>
              )}
              <div className="grid grid-cols-2 gap-4">
                <div className="grid gap-2">
                  <Label>Clock In</Label>
                  <Input type="time" value={clockInTime} onChange={(e) => setClockInTime(e.target.value)} />
                </div>
                <div className="grid gap-2">
                  <Label>Clock Out</Label>
                  <Input type="time" value={clockOutTime} onChange={(e) => setClockOutTime(e.target.value)} />
                </div>
              </div>
              <div className="grid gap-2">
                <Label>Break Minutes</Label>
                <Input type="number" min="0" value={breakMins} onChange={(e) => setBreakMins(e.target.value)} />
              </div>
            </>
          )}

          <div className="grid gap-2">
            <Label>
              Reason <span className="text-red-500">*</span>
            </Label>
            <Textarea
              placeholder={action === "excuse" ? "e.g. Employee called in sick, doctor's note provided" : "e.g. Employee forgot to clock in, verified by manager"}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="min-h-[80px]"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={() => resolveMutation.mutate()}
            disabled={resolveMutation.isPending || !reason.trim()}
          >
            {resolveMutation.isPending ? "Saving…" : "Resolve & Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function NeedsReviewBanner({
  alerts,
  employees,
  onAlertClick,
}: {
  alerts: DiscrepancyAlert[];
  employees: EmployeeReview[];
  onAlertClick: (alert: DiscrepancyAlert) => void;
}) {
  const [dismissed, setDismissed] = useState(false);

  if (alerts.length === 0 || dismissed) return null;

  const employeeMap = new Map(employees.map((e) => [e.userId, e]));

  return (
    <div className="rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/20 p-3">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400" />
          <span className="font-semibold text-sm text-amber-800 dark:text-amber-300">
            Needs review
          </span>
          <Badge variant="destructive" className="bg-amber-500 hover:bg-amber-600 text-xs px-1.5">
            {alerts.length}
          </Badge>
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6 text-amber-600 hover:text-amber-800"
          onClick={() => setDismissed(true)}
        >
          <X className="h-3 w-3" />
        </Button>
      </div>
      <div className="flex gap-2 overflow-x-auto pb-1">
        {alerts.map((alert, idx) => {
          const emp = employeeMap.get(alert.userId);
          const name = emp
            ? [emp.firstName, emp.lastName].filter(Boolean).join(" ") || emp.email || "?"
            : "?";
          const initials = emp
            ? ((emp.firstName?.[0] || "") + (emp.lastName?.[0] || "")).toUpperCase() || "?"
            : "?";

          return (
            <button
              key={idx}
              className="flex-shrink-0 flex items-center gap-2 bg-white dark:bg-amber-950/40 border border-amber-200 dark:border-amber-700 rounded-lg px-3 py-2 hover:bg-amber-100 dark:hover:bg-amber-900/40 transition-colors text-left min-w-[240px]"
              onClick={() => onAlertClick(alert)}
            >
              <Avatar className="h-7 w-7 flex-shrink-0">
                <AvatarImage src={emp?.profileImageUrl || undefined} />
                <AvatarFallback className="text-[10px]">{initials}</AvatarFallback>
              </Avatar>
              <div className="min-w-0">
                <p className="text-xs font-medium truncate">{name}</p>
                <p className="text-[10px] text-muted-foreground truncate">{formatDate(alert.date)}</p>
                <div className="flex items-center gap-1 mt-0.5">
                  {getDiscrepancyIcon(alert.type)}
                  <span className="text-[10px] text-amber-700 dark:text-amber-400 font-medium">
                    {getDiscrepancyLabel(alert.type)}
                  </span>
                </div>
                {alert.actualClockIn && alert.scheduledStart && alert.scheduledEnd && (
                  <p
                    className="text-[10px] text-muted-foreground truncate mt-0.5"
                    data-testid={`text-alert-times-${idx}`}
                  >
                    Actual in: {formatTime(alert.actualClockIn)} / Scheduled:{" "}
                    {formatTime(alert.scheduledStart)} – {formatTime(alert.scheduledEnd ?? null)}
                  </p>
                )}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function PayPeriodReviewTab({
  data,
  isLoading,
  isError,
  onEntryClick,
}: {
  data: TimesheetReviewData | undefined;
  isLoading: boolean;
  isError: boolean;
  onEntryClick?: (entry: DailyEntry, date: string, employee: EmployeeReview) => void;
}) {
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
  const [addTimeCardOpen, setAddTimeCardOpen] = useState(false);
  const [addTimeCardEmployeeId, setAddTimeCardEmployeeId] = useState<string | undefined>();
  const [resolveOpen, setResolveOpen] = useState(false);
  const [resolveAlert, setResolveAlert] = useState<DiscrepancyAlert | null>(null);

  const handleAddTimeCard = (employeeId: string) => {
    setAddTimeCardEmployeeId(employeeId);
    setAddTimeCardOpen(true);
  };

  const handleAlertClick = (alert: DiscrepancyAlert) => {
    setResolveAlert(alert);
    setResolveOpen(true);
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

  const allDiscrepancies = data?.discrepancyAlerts || [];

  if (isLoading) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-12 w-full" />
        ))}
      </div>
    );
  }

  if (isError && !data) {
    return (
      <Card>
        <CardContent className="py-12 text-center">
          <AlertTriangle className="h-12 w-12 mx-auto text-amber-500 mb-3" />
          <p className="font-medium text-sm">Unable to load timesheet data</p>
          <p className="text-xs text-muted-foreground mt-1">Check your permissions or try refreshing</p>
        </CardContent>
      </Card>
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
    <div className="space-y-4">
      <NeedsReviewBanner
        alerts={allDiscrepancies}
        employees={data.employees}
        onAlertClick={handleAlertClick}
      />
      <ResolveDiscrepancyDialog
        open={resolveOpen}
        onOpenChange={setResolveOpen}
        alert={resolveAlert}
        employees={data.employees}
        onResolved={() => setResolveAlert(null)}
      />
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
      scheduleSource={data?.employees}
    />
    </div>
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

function DailyReviewTab({ onEntryClick }: { onEntryClick?: (entry: DailyEntry, date: string, employee: EmployeeReview) => void }) {
  const today = new Date().toISOString().split("T")[0];
  const [selectedDate, setSelectedDate] = useState(today);
  const [filter, setFilter] = useState<"all" | "needs-review">("all");
  const [resolveOpen, setResolveOpen] = useState(false);
  const [resolveAlert, setResolveAlert] = useState<DiscrepancyAlert | null>(null);
  const [addTimeCardOpen, setAddTimeCardOpen] = useState(false);
  const [addTimeCardEmpId, setAddTimeCardEmpId] = useState<string | undefined>();

  const { data, isLoading, isError } = useQuery<TimesheetReviewData>({
    queryKey: [`/api/timesheets/review?startDate=${selectedDate}&endDate=${selectedDate}`],
  });

  const navigateDate = (direction: "prev" | "next") => {
    const d = new Date(selectedDate + "T12:00:00");
    d.setDate(d.getDate() + (direction === "prev" ? -1 : 1));
    const next = d.toISOString().split("T")[0];
    if (next <= today) setSelectedDate(next);
  };

  const formattedDate = new Date(selectedDate + "T12:00:00").toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });

  const dayEmployees = useMemo(() => {
    if (!data) return [];
    return data.employees.filter((emp) => {
      const day = emp.dailyBreakdown.find((d) => d.date === selectedDate);
      return day && (day.entries.length > 0 || (day.scheduledHours ?? 0) > 0);
    });
  }, [data, selectedDate]);

  const filteredEmployees = useMemo(() => {
    if (filter === "needs-review") {
      return dayEmployees.filter((emp) =>
        (emp.discrepancyAlerts || []).some((a) => a.date === selectedDate)
      );
    }
    return dayEmployees;
  }, [dayEmployees, filter, selectedDate]);

  const needsReviewCount = useMemo(
    () => dayEmployees.filter((emp) =>
      (emp.discrepancyAlerts || []).some((a) => a.date === selectedDate)
    ).length,
    [dayEmployees, selectedDate]
  );

  return (
    <div className="space-y-4">
      {/* Date navigation + filters */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-3 justify-between">
        <div className="flex items-center gap-1">
          <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => navigateDate("prev")}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <div className="flex items-center gap-2 px-2 min-w-[240px]">
            <Calendar className="h-4 w-4 text-muted-foreground flex-shrink-0" />
            <span className="font-medium text-sm">{formattedDate}</span>
          </div>
          <Button
            variant="outline"
            size="icon"
            className="h-8 w-8"
            onClick={() => navigateDate("next")}
            disabled={selectedDate >= today}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant={filter === "all" ? "default" : "outline"}
            size="sm"
            className="h-8"
            onClick={() => setFilter("all")}
          >
            All
          </Button>
          <Button
            variant={filter === "needs-review" ? "default" : "outline"}
            size="sm"
            className={cn("h-8", filter === "needs-review" && "bg-amber-500 hover:bg-amber-600 text-white border-amber-500")}
            onClick={() => setFilter("needs-review")}
          >
            Needs review
            {needsReviewCount > 0 && (
              <Badge className="ml-1.5 h-4 min-w-[16px] px-1 text-[10px] bg-amber-600 hover:bg-amber-600">
                {needsReviewCount}
              </Badge>
            )}
          </Button>
        </div>
      </div>

      {isLoading && (
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-16 w-full rounded-xl" />
          ))}
        </div>
      )}

      {isError && !isLoading && (
        <Card>
          <CardContent className="py-12 text-center">
            <AlertTriangle className="h-12 w-12 mx-auto text-amber-500 mb-3" />
            <p className="font-medium text-sm">Unable to load timesheet data</p>
            <p className="text-xs text-muted-foreground mt-1">Check your permissions or try refreshing</p>
          </CardContent>
        </Card>
      )}

      {!isLoading && !isError && filteredEmployees.length === 0 && (
        <Card>
          <CardContent className="py-12 text-center">
            <Clock className="h-12 w-12 mx-auto text-muted-foreground mb-3" />
            <p className="text-muted-foreground text-sm">
              {filter === "needs-review"
                ? "No entries needing review for this day."
                : "No scheduled or worked shifts for this day."}
            </p>
          </CardContent>
        </Card>
      )}

      {!isLoading && !isError && filteredEmployees.length > 0 && (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/40 hover:bg-muted/40">
                  <TableHead className="w-[200px] font-semibold text-xs uppercase tracking-wide">Team member</TableHead>
                  <TableHead className="font-semibold text-xs uppercase tracking-wide">Worked</TableHead>
                  <TableHead className="text-center font-semibold text-xs uppercase tracking-wide w-[110px]">Total breaks</TableHead>
                  <TableHead className="font-semibold text-xs uppercase tracking-wide w-[220px]">Issues</TableHead>
                  <TableHead className="text-right font-semibold text-xs uppercase tracking-wide w-[160px]">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredEmployees.map((emp) => {
                  const initials = ((emp.firstName?.[0] || "") + (emp.lastName?.[0] || "")).toUpperCase() || "?";
                  const fullName = [emp.firstName, emp.lastName].filter(Boolean).join(" ") || "Unknown";
                  const day = emp.dailyBreakdown.find((d) => d.date === selectedDate);
                  const entries = day?.entries || [];
                  const schedule = day?.schedules?.[0];
                  const scheduledHours = day?.scheduledHours ?? 0;
                  const breakMins = entries.reduce((sum, e) => sum + e.breakMinutes, 0);
                  const issues = (emp.discrepancyAlerts || []).filter((a) => a.date === selectedDate);
                  const isNoShow = entries.length === 0 && scheduledHours > 0;
                  const actualHours = entries.reduce((sum, e) => sum + e.hours, 0);
                  const underScheduleMinutes = scheduledHours > 0
                    ? Math.round((scheduledHours - actualHours) * 60)
                    : 0;

                  return (
                    <TableRow
                      key={emp.userId}
                      className={cn(
                        "align-top border-b",
                        isNoShow && "bg-red-50/60 dark:bg-red-950/20",
                        !isNoShow && issues.length > 0 && "bg-amber-50/60 dark:bg-amber-950/20",
                      )}
                    >
                      {/* Team member */}
                      <TableCell className="py-4">
                        <div className="flex items-center gap-2.5">
                          <Avatar className="h-9 w-9 flex-shrink-0">
                            <AvatarImage src={emp.profileImageUrl || undefined} />
                            <AvatarFallback className="text-xs font-semibold bg-primary/10 text-primary">
                              {initials}
                            </AvatarFallback>
                          </Avatar>
                          <div>
                            <p className="font-semibold text-sm leading-tight">{fullName}</p>
                            {entries.length > 0 && !entries[entries.length - 1]?.clockOutTime && (
                              <Badge variant="outline" className="text-[10px] px-1.5 py-0 mt-0.5 h-4 border-green-500 text-green-600">
                                Clocked in
                              </Badge>
                            )}
                            {emp.activeOffsite && <OffsiteLiveBadge activeOffsite={emp.activeOffsite} />}
                          </div>
                        </div>
                      </TableCell>

                      {/* Worked */}
                      <TableCell className="py-4">
                        {isNoShow ? (
                          <div>
                            <p className="text-muted-foreground/50 text-sm font-mono tracking-widest">— — — — — —</p>
                            {schedule && (
                              <p className="text-xs text-muted-foreground mt-0.5">
                                Scheduled: {formatTime(schedule.startTime)} – {formatTime(schedule.endTime)}
                              </p>
                            )}
                          </div>
                        ) : entries.length > 0 ? (
                          <div className="space-y-2">
                            {entries.map((entry) => (
                              <div key={entry.id}>
                                <button
                                  className="text-sm font-medium hover:text-primary hover:underline cursor-pointer transition-colors text-left"
                                  onClick={() => onEntryClick?.(entry, selectedDate, emp)}
                                >
                                  {formatTime(entry.clockInTime)} –{" "}
                                  {entry.clockOutTime
                                    ? formatTime(entry.clockOutTime)
                                    : <span className="text-green-600 dark:text-green-400">active</span>}
                                </button>
                                {entry.clockOutTime && (
                                  <p className="text-xs text-muted-foreground">Total: {formatDuration(entry.hours)}</p>
                                )}
                                {underScheduleMinutes > 15 && entries.length === 1 && entry.clockOutTime && (
                                  <p className="text-xs text-blue-600 dark:text-blue-400">
                                    {underScheduleMinutes} min under scheduled time
                                  </p>
                                )}
                              </div>
                            ))}
                            {schedule && (
                              <p className="text-xs text-muted-foreground/50">
                                Scheduled: {formatTime(schedule.startTime)} – {formatTime(schedule.endTime)}
                              </p>
                            )}
                          </div>
                        ) : (
                          <span className="text-muted-foreground/40 text-sm">—</span>
                        )}
                      </TableCell>

                      {/* Total breaks */}
                      <TableCell className="py-4 text-center">
                        <span className="text-sm text-muted-foreground">
                          {breakMins > 0 ? `${breakMins} min` : "0 min"}
                        </span>
                      </TableCell>

                      {/* Issues */}
                      <TableCell className="py-4">
                        {issues.length > 0 ? (
                          <div className="flex flex-col gap-1">
                            {issues.map((issue, idx) => (
                              <IssueBadge key={idx} type={issue.type} />
                            ))}
                          </div>
                        ) : (
                          <span className="text-xs text-muted-foreground/40">—</span>
                        )}
                      </TableCell>

                      {/* Actions */}
                      <TableCell className="py-4 text-right">
                        {issues.length > 0 ? (
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="outline" size="sm" className="text-xs h-8 gap-1 font-medium">
                                Resolve issues
                                <ChevronDown className="h-3 w-3" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="w-52">
                              {issues.map((issue, idx) => (
                                <DropdownMenuItem
                                  key={idx}
                                  onClick={() => { setResolveAlert(issue); setResolveOpen(true); }}
                                  className="cursor-pointer gap-2"
                                >
                                  {getDiscrepancyIcon(issue.type)}
                                  Resolve: {getDiscrepancyLabel(issue.type)}
                                </DropdownMenuItem>
                              ))}
                              {isNoShow && (
                                <DropdownMenuItem
                                  onClick={() => { setAddTimeCardEmpId(emp.userId); setAddTimeCardOpen(true); }}
                                  className="cursor-pointer gap-2"
                                >
                                  <Plus className="h-4 w-4" />
                                  Add time card
                                </DropdownMenuItem>
                              )}
                            </DropdownMenuContent>
                          </DropdownMenu>
                        ) : entries.length > 0 && entries.every((e) => e.isApproved) ? (
                          <span className="inline-flex items-center gap-1 text-xs text-green-600 dark:text-green-400">
                            <CheckCircle2 className="h-3.5 w-3.5" /> Approved
                          </span>
                        ) : entries.length > 0 ? (
                          <span className="text-xs text-muted-foreground">Pending</span>
                        ) : null}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </Card>
      )}

      <ResolveDiscrepancyDialog
        open={resolveOpen}
        onOpenChange={setResolveOpen}
        alert={resolveAlert}
        employees={data?.employees || []}
        onResolved={() => { setResolveAlert(null); setResolveOpen(false); }}
      />

      <AddTimeCardDialog
        open={addTimeCardOpen}
        onOpenChange={setAddTimeCardOpen}
        preselectedEmployeeId={addTimeCardEmpId}
        employees={
          data?.employees?.map((e) => ({
            id: e.userId,
            firstName: e.firstName,
            lastName: e.lastName,
            email: e.email,
          })) || []
        }
        scheduleSource={data?.employees}
      />
    </div>
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


function ApprovalChainPanel({
  periodApproval,
  singleStep,
  onFinalize,
  isFinalizing,
}: {
  periodApproval: PeriodApproval | null | undefined;
  singleStep: boolean;
  onFinalize?: () => void;
  isFinalizing?: boolean;
}) {
  const status = periodApproval?.status ?? "pending";

  const stepManagerDone = status === "manager_approved" || status === "final_approved";
  const stepAdminDone = status === "final_approved";

  if (singleStep) {
    return (
      <div className="rounded-lg border bg-card p-3 flex items-center gap-3">
        <div className={`flex items-center gap-2 text-sm font-medium ${stepAdminDone ? "text-green-600 dark:text-green-400" : "text-muted-foreground"}`}>
          {stepAdminDone ? <ShieldCheck className="h-4 w-4" /> : <ShieldOff className="h-4 w-4" />}
          {stepAdminDone ? "Period Approved" : "Pending Approval"}
        </div>
        {stepAdminDone && periodApproval?.adminApprovedAt && (
          <span className="text-xs text-muted-foreground">
            {new Date(periodApproval.adminApprovedAt).toLocaleDateString()}
          </span>
        )}
      </div>
    );
  }

  return (
    <div className="rounded-lg border bg-card p-3 space-y-3">
      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Approval chain</p>
      <div className="flex items-start gap-4">
        {/* Step 1: Manager */}
        <div className="flex flex-col items-center gap-1 min-w-[120px]">
          <div className={`rounded-full p-1.5 ${stepManagerDone ? "bg-green-100 dark:bg-green-900/40 text-green-600 dark:text-green-400" : "bg-muted text-muted-foreground"}`}>
            <CheckCircle2 className="h-4 w-4" />
          </div>
          <span className={`text-xs font-medium text-center ${stepManagerDone ? "text-green-700 dark:text-green-400" : "text-muted-foreground"}`}>
            Manager review
          </span>
          {stepManagerDone && (
            <span className="text-[10px] text-muted-foreground text-center">
              {periodApproval?.managerApproverName && <span className="block font-medium">{periodApproval.managerApproverName}</span>}
              {periodApproval?.managerApprovedAt && new Date(periodApproval.managerApprovedAt).toLocaleDateString()}
            </span>
          )}
          {!stepManagerDone && <span className="text-[10px] text-muted-foreground">Pending</span>}
        </div>

        {/* Connector line */}
        <div className={`flex-1 h-px mt-4 ${stepManagerDone ? "bg-green-400 dark:bg-green-600" : "bg-border"}`} />

        {/* Step 2: Admin */}
        <div className="flex flex-col items-center gap-1 min-w-[120px]">
          <div className={`rounded-full p-1.5 ${stepAdminDone ? "bg-green-100 dark:bg-green-900/40 text-green-600 dark:text-green-400" : stepManagerDone ? "bg-amber-100 dark:bg-amber-900/40 text-amber-600 dark:text-amber-400" : "bg-muted text-muted-foreground"}`}>
            <ShieldCheck className="h-4 w-4" />
          </div>
          <span className={`text-xs font-medium text-center ${stepAdminDone ? "text-green-700 dark:text-green-400" : stepManagerDone ? "text-amber-700 dark:text-amber-400" : "text-muted-foreground"}`}>
            Admin final
          </span>
          {stepAdminDone && (
            <span className="text-[10px] text-muted-foreground text-center">
              {periodApproval?.adminApproverName && <span className="block font-medium">{periodApproval.adminApproverName}</span>}
              {periodApproval?.adminApprovedAt && new Date(periodApproval.adminApprovedAt).toLocaleDateString()}
            </span>
          )}
          {!stepAdminDone && stepManagerDone && (
            <Button size="sm" className="h-6 text-[10px] px-2 mt-1" onClick={onFinalize} disabled={isFinalizing}>
              {isFinalizing ? "Finalizing…" : "Finalize"}
            </Button>
          )}
          {!stepAdminDone && !stepManagerDone && <span className="text-[10px] text-muted-foreground">Waiting</span>}
        </div>
      </div>
    </div>
  );
}

function HealthBar({ health }: { health: HealthSummary | undefined }) {
  if (!health || health.totalEmployees === 0) return null;
  const { totalEmployees, approvedCount, needsReviewCount, noEntriesCount, pendingClockOutCount } = health;
  const pending = totalEmployees - approvedCount - needsReviewCount - noEntriesCount - pendingClockOutCount;

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>Period health</span>
        <span>{approvedCount}/{totalEmployees} approved</span>
      </div>
      <div className="flex h-2 rounded-full overflow-hidden gap-px">
        {approvedCount > 0 && (
          <div
            className="bg-green-500 dark:bg-green-600 transition-all"
            style={{ width: `${(approvedCount / totalEmployees) * 100}%` }}
            title={`${approvedCount} approved`}
          />
        )}
        {needsReviewCount > 0 && (
          <div
            className="bg-amber-500 dark:bg-amber-600 transition-all"
            style={{ width: `${(needsReviewCount / totalEmployees) * 100}%` }}
            title={`${needsReviewCount} needs review`}
          />
        )}
        {pendingClockOutCount > 0 && (
          <div
            className="bg-orange-400 dark:bg-orange-500 transition-all"
            style={{ width: `${(pendingClockOutCount / totalEmployees) * 100}%` }}
            title={`${pendingClockOutCount} pending clock-out`}
          />
        )}
        {noEntriesCount > 0 && (
          <div
            className="bg-red-400 dark:bg-red-600 transition-all"
            style={{ width: `${(noEntriesCount / totalEmployees) * 100}%` }}
            title={`${noEntriesCount} no entries`}
          />
        )}
        {pending > 0 && (
          <div
            className="bg-muted-foreground/20 transition-all"
            style={{ width: `${(pending / totalEmployees) * 100}%` }}
            title={`${pending} pending`}
          />
        )}
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] text-muted-foreground">
        {approvedCount > 0 && <span className="flex items-center gap-1"><span className="inline-block w-2 h-2 rounded-full bg-green-500" />{approvedCount} approved</span>}
        {needsReviewCount > 0 && <span className="flex items-center gap-1"><span className="inline-block w-2 h-2 rounded-full bg-amber-500" />{needsReviewCount} needs review</span>}
        {pendingClockOutCount > 0 && <span className="flex items-center gap-1"><span className="inline-block w-2 h-2 rounded-full bg-orange-400" />{pendingClockOutCount} pending clock-out</span>}
        {noEntriesCount > 0 && <span className="flex items-center gap-1"><span className="inline-block w-2 h-2 rounded-full bg-red-400" />{noEntriesCount} no entries</span>}
      </div>
    </div>
  );
}

function computePayPeriods(settings: PayPeriodSettings | null, count: number = 6): Array<{ label: string; startDate: string; endDate: string }> {
  if (!settings?.firstPayPeriodStart) return [];

  const intervalType = settings.intervalType || "bi-weekly";
  const intervalDays = intervalType === "weekly" ? 7 : intervalType === "bi-weekly" ? 14 : intervalType === "semi-monthly" ? 15 : 30;

  const start = new Date(settings.firstPayPeriodStart);
  start.setHours(0, 0, 0, 0);

  const now = new Date();
  const periods: Array<{ label: string; startDate: string; endDate: string }> = [];

  // Find current period start
  let periodStart = new Date(start);
  while (new Date(periodStart.getTime() + intervalDays * 86400000) < now) {
    periodStart = new Date(periodStart.getTime() + intervalDays * 86400000);
  }

  // Go back a bit to include recent past periods
  for (let i = count - 1; i >= 0; i--) {
    const ps = new Date(periodStart.getTime() - i * intervalDays * 86400000);
    const pe = new Date(ps.getTime() + (intervalDays - 1) * 86400000);
    const label = `${ps.toLocaleDateString("en-US", { month: "short", day: "numeric" })} – ${pe.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`;
    periods.push({
      label,
      startDate: ps.toISOString().split("T")[0],
      endDate: pe.toISOString().split("T")[0],
    });
  }

  return periods;
}

export default function Timesheets() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const defaults = getDefaultDateRange();
  const [startDate, setStartDate] = useState(defaults.startDate);
  const [endDate, setEndDate] = useState(defaults.endDate);
  const [periodInitialized, setPeriodInitialized] = useState(false);
  const [activeTab, setActiveTab] = useState("daily");
  const [showOTPanel, setShowOTPanel] = useState(false);
  const [timeCardModalOpen, setTimeCardModalOpen] = useState(false);
  const [selectedEntry, setSelectedEntry] = useState<DailyEntry | null>(null);
  const [selectedDate, setSelectedDate] = useState("");
  const [selectedEmployee, setSelectedEmployee] = useState<EmployeeReview | null>(null);
  const [allFlatEntries, setAllFlatEntries] = useState<Array<{ entry: DailyEntry; date: string; employee: EmployeeReview }>>([]);
  const [showAddTimeCard, setShowAddTimeCard] = useState(false);
  const [exportModalOpen, setExportModalOpen] = useState(false);

  const { data: payPeriodSettings } = useQuery<PayPeriodSettings | null>({
    queryKey: ["/api/timesheets/pay-period-settings"],
  });

  const { data: workflowSettings } = useQuery<{ singleStepApproval?: boolean } | null>({
    queryKey: ["/api/timesheets/workflow-settings"],
  });
  const singleStepApproval = workflowSettings?.singleStepApproval ?? false;

  // Initialize date range from pay period settings when they load
  const payPeriods = useMemo(() => computePayPeriods(payPeriodSettings || null), [payPeriodSettings]);
  const currentPeriod = payPeriods.length > 0 ? payPeriods[payPeriods.length - 1] : null;

  // Auto-set to current pay period once loaded (only once)
  useEffect(() => {
    if (!periodInitialized && currentPeriod) {
      setStartDate(currentPeriod.startDate);
      setEndDate(currentPeriod.endDate);
      setPeriodInitialized(true);
    }
  }, [currentPeriod, periodInitialized]);

  const { data, isLoading, isError, refetch } = useQuery<TimesheetReviewData>({
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
      const res = await apiRequest("POST", "/api/timesheets/approve-all", { startDate, endDate });
      return res.json();
    },
    onSuccess: (result: any) => {
      if (result?.singleStep || result?.status === "final_approved") {
        toast({ title: "Period approved", description: `${result?.approvedCount ?? 0} time entries approved.` });
      } else {
        toast({ title: "Manager review submitted", description: "The admin has been notified to finalize this period." });
      }
      invalidatePrefix("/api/timesheets/review");
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const finalizePeriodMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/timesheets/finalize-period", { startDate, endDate });
      return res.json();
    },
    onSuccess: (result: any) => {
      toast({ title: "Period finalized", description: `${result?.approvedCount ?? 0} entries approved. Two-step chain complete.` });
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
        <div className="flex items-center gap-3 flex-wrap">
          <h1 className="text-2xl font-bold">Timesheets</h1>
          {data && data.totalNeedsReview > 0 && (
            <Badge variant="destructive" className="bg-amber-500 hover:bg-amber-600">
              <AlertTriangle className="h-3 w-3 mr-1" />
              {data.totalNeedsReview} Needs Review
            </Badge>
          )}
              {/* Next pay period chip */}
          {(() => {
            if (!payPeriodSettings?.firstPayPeriodStart) return null;
            const intervalType = payPeriodSettings.intervalType || "bi-weekly";
            const intervalDays = intervalType === "weekly" ? 7 : intervalType === "bi-weekly" ? 14 : intervalType === "semi-monthly" ? 15 : 30;
            const allPeriods = computePayPeriods(payPeriodSettings, 8);
            if (allPeriods.length === 0) return null;
            const lastKnown = allPeriods[allPeriods.length - 1];
            const nextStart = new Date(lastKnown.endDate + "T12:00:00");
            nextStart.setDate(nextStart.getDate() + 1);
            const nextEnd = new Date(nextStart.getTime() + (intervalDays - 1) * 86400000);
            return (
              <span className="inline-flex items-center gap-1 text-xs text-muted-foreground bg-muted rounded-full px-2.5 py-1">
                <Calendar className="h-3 w-3" />
                Next period: {nextStart.toLocaleDateString("en-US", { month: "short", day: "numeric" })} – {nextEnd.toLocaleDateString("en-US", { month: "short", day: "numeric" })}
              </span>
            );
          })()}
          {!payPeriodSettings?.firstPayPeriodStart && (
            <a
              href="/settings?tab=pay-period"
              className="inline-flex items-center gap-1 text-xs text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-700 rounded-full px-2.5 py-1 hover:bg-amber-100 dark:hover:bg-amber-900/40 transition-colors"
            >
              <Settings className="h-3 w-3" />
              Set up pay periods
            </a>
          )}
          {payPeriodSettings?.firstPayPeriodStart && (
            <a
              href="/settings?tab=pay-period"
              className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
              title="Pay period settings"
            >
              <Settings className="h-3 w-3" />
              Pay period settings
            </a>
          )}
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {payPeriods.length > 0 && (
            <Select
              value={`${startDate}|${endDate}`}
              onValueChange={(val) => {
                const [s, e] = val.split("|");
                setStartDate(s);
                setEndDate(e);
              }}
            >
              <SelectTrigger className="w-[220px] text-sm">
                <Calendar className="h-4 w-4 mr-1 text-muted-foreground" />
                <SelectValue placeholder="Select pay period" />
              </SelectTrigger>
              <SelectContent>
                {payPeriods.map((p) => (
                  <SelectItem key={p.startDate} value={`${p.startDate}|${p.endDate}`}>
                    {p.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
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

      {data?.healthSummary && (
        <HealthBar health={data.healthSummary} />
      )}

      {data?.periodApproval !== undefined && (
        <ApprovalChainPanel
          periodApproval={data.periodApproval}
          singleStep={singleStepApproval}
          onFinalize={() => finalizePeriodMutation.mutate()}
          isFinalizing={finalizePeriodMutation.isPending}
        />
      )}

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
          <TabsTrigger value="daily" className="gap-1.5">
            Daily review
            {data && data.totalNeedsReview > 0 && (
              <Badge className="h-4 min-w-[16px] px-1 text-[10px] bg-amber-500 hover:bg-amber-500 text-white">
                {data.totalNeedsReview}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="pay-period">Pay period review</TabsTrigger>
          <TabsTrigger value="workflow" className="gap-1.5">
            <Settings className="h-3.5 w-3.5" />
            Workflow
          </TabsTrigger>
        </TabsList>

        <TabsContent value="daily" className="mt-4">
          <DailyReviewTab onEntryClick={handleEntryClick} />
        </TabsContent>

        <TabsContent value="pay-period" className="mt-4">
          <PayPeriodReviewTab data={data} isLoading={isLoading} isError={isError} onEntryClick={handleEntryClick} />
        </TabsContent>

        <TabsContent value="workflow" className="mt-4">
          <WorkflowSettingsTab />
        </TabsContent>
      </Tabs>

      <AddTimeCardDialog
        open={showAddTimeCard}
        onOpenChange={setShowAddTimeCard}
        scheduleSource={data?.employees}
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
