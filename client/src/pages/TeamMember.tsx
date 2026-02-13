import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useLocation, useRoute } from "wouter";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import type { User, Role, Permission } from "@shared/schema";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  ArrowLeft,
  Phone,
  Mail,
  Pencil,
  Loader2,
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  CheckCircle2,
  Clock,
  Target,
  TrendingUp,
  Award,
  Star,
} from "lucide-react";

function getInitials(firstName?: string | null, lastName?: string | null) {
  return `${firstName?.[0] || ""}${lastName?.[0] || ""}`.toUpperCase() || "?";
}

function getAccessLevel(role?: { name: string } | null) {
  if (!role) return "Employee";
  if (role.name === "owner" || role.name === "admin") return "Manager";
  if (role.name === "manager" || role.name === "store_manager") return "Manager";
  return "Employee";
}

type TabKey = "job" | "personal" | "documents" | "performance";

export default function TeamMember() {
  const [, params] = useRoute("/team/:id");
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { user: currentUser } = useAuth();
  const userId = params?.id;

  const [activeTab, setActiveTab] = useState<TabKey>("job");
  const [locationSettingsOpen, setLocationSettingsOpen] = useState(true);
  const [editingJob, setEditingJob] = useState(false);
  const [editingPayroll, setEditingPayroll] = useState(false);
  const [terminateDialogOpen, setTerminateDialogOpen] = useState(false);

  const { data: member, isLoading, error } = useQuery<User & { role?: Role }>({
    queryKey: ["/api/users", userId],
    enabled: !!userId,
  });

  const { data: allRoles = [] } = useQuery<Role[]>({
    queryKey: ["/api/roles"],
  });

  const { data: permissions = [] } = useQuery<Permission[]>({
    queryKey: ["/api/auth/permissions"],
    enabled: !!currentUser,
  });

  const { data: timeEntries = [] } = useQuery<any[]>({
    queryKey: ["/api/time-entries"],
  });

  const { data: tasks = [] } = useQuery<any[]>({
    queryKey: ["/api/tasks"],
  });

  const isAdminRole = currentUser?.role?.name === 'owner' || currentUser?.role?.name === 'admin';
  const can = (perm: string) =>
    permissions?.some?.((p) => p.name === perm || p.name === "admin.manage_all") || isAdminRole || false;
  const canEdit = can("hr.edit_team");

  const updateUserMutation = useMutation({
    mutationFn: async (data: Record<string, any>) => {
      const res = await apiRequest("PUT", `/api/users/${userId}`, data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/users", userId] });
      queryClient.invalidateQueries({ queryKey: ["/api/users"] });
      toast({ title: "Updated", description: "Team member updated successfully." });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const terminateMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("PUT", `/api/users/${userId}`, { isActive: false });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/users", userId] });
      queryClient.invalidateQueries({ queryKey: ["/api/users"] });
      setTerminateDialogOpen(false);
      toast({ title: "Terminated", description: "Team member has been terminated." });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const memberTimeEntries = timeEntries.filter((te: any) => te.userId === userId);
  const memberTasks = tasks.filter((t: any) => t.assignedTo === userId);

  const completedTasks = memberTasks.filter((t: any) => t.status === "completed");
  const totalTasks = memberTasks.length;
  const taskCompletionRate = totalTasks > 0 ? Math.round((completedTasks.length / totalTasks) * 100) : 0;

  const onTimeEntries = memberTimeEntries.filter((te: any) => {
    if (!te.clockIn) return false;
    return true;
  });
  const lateEntries = memberTimeEntries.filter((te: any) => te.isLate === true);
  const punctualityScore = onTimeEntries.length > 0
    ? Math.round(((onTimeEntries.length - lateEntries.length) / onTimeEntries.length) * 100)
    : 100;

  const performancePoints = Math.round(
    (taskCompletionRate * 0.4) + (punctualityScore * 0.4) + (Math.min(completedTasks.length * 2, 20))
  );

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error || !member) {
    return (
      <div className="flex flex-col items-center justify-center py-24 gap-3">
        <AlertTriangle className="h-10 w-10 text-destructive" />
        <p className="text-muted-foreground">Team member not found.</p>
        <Button variant="outline" onClick={() => navigate("/team")}>
          Back to Team
        </Button>
      </div>
    );
  }

  const tabs: { key: TabKey; label: string }[] = [
    { key: "job", label: "Job Details" },
    { key: "personal", label: "Personal Information" },
    { key: "documents", label: "Documents" },
    { key: "performance", label: "Performance" },
  ];

  const startDateFormatted = member.startDate
    ? new Date(member.startDate).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" })
    : "--";

  const hiredAtFormatted = member.createdAt
    ? new Date(member.createdAt).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" })
    : "--";

  const invitedAgo = member.createdAt
    ? (() => {
        const diff = Date.now() - new Date(member.createdAt).getTime();
        const months = Math.floor(diff / (1000 * 60 * 60 * 24 * 30));
        if (months > 0) return `Invited ${months} month${months > 1 ? "s" : ""} ago`;
        const days = Math.floor(diff / (1000 * 60 * 60 * 24));
        return `Invited ${days} day${days > 1 ? "s" : ""} ago`;
      })()
    : "";

  return (
    <div className="max-w-4xl mx-auto p-4 lg:p-6 space-y-6">
      <button
        onClick={() => navigate("/team")}
        className="flex items-center gap-1 text-sm text-purple-600 hover:text-purple-800 font-medium"
      >
        <ArrowLeft className="h-4 w-4" />
        Back
      </button>

      <div className="flex items-start justify-between">
        <div className="flex items-start gap-4">
          <div className="w-16 h-16 rounded-full bg-purple-100 flex items-center justify-center flex-shrink-0">
            <span className="text-2xl font-bold text-purple-600">
              {getInitials(member.firstName, member.lastName)}
            </span>
          </div>
          <div>
            <h1 className="text-2xl font-bold">
              {member.firstName} {member.lastName}
            </h1>
            <p className="text-muted-foreground">
              {getAccessLevel(member.role)} at {member.locationName || "—"}
            </p>
            <div className="flex items-center gap-2 mt-1 text-sm">
              {member.phone && (
                <a href={`tel:${member.phone}`} className="flex items-center gap-1 text-purple-600 hover:underline">
                  <Phone className="h-3 w-3" />
                  {member.phone}
                </a>
              )}
              {member.phone && <span className="text-muted-foreground">|</span>}
              {member.email ? (
                <a href={`mailto:${member.email}`} className="flex items-center gap-1 text-purple-600 hover:underline">
                  <Mail className="h-3 w-3" />
                  {member.email}
                </a>
              ) : (
                <span className="text-purple-600 cursor-pointer hover:underline flex items-center gap-1">
                  <Mail className="h-3 w-3" />
                  Add email address
                </span>
              )}
            </div>
            {invitedAgo && (
              <p className="text-xs text-muted-foreground mt-1">{invitedAgo}</p>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2">
          {canEdit && member.isActive !== false && (
            <Button
              variant="outline"
              className="border-orange-400 text-orange-600 hover:bg-orange-50"
              onClick={() => setTerminateDialogOpen(true)}
            >
              Terminate
            </Button>
          )}
          <Button
            variant="outline"
            className="border-purple-400 text-purple-600 hover:bg-purple-50"
            onClick={() => navigate("/communication")}
          >
            Message
          </Button>
        </div>
      </div>

      <div className="border-b">
        <div className="flex gap-0">
          {tabs.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`px-6 py-3 text-sm font-medium border-b-2 transition-colors ${
                activeTab === tab.key
                  ? "border-purple-600 text-purple-600"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {activeTab === "job" && (
        <div className="space-y-6">
          <div>
            <h2 className="text-lg font-bold mb-3">Access, Roles & Wages</h2>
            <div className="border rounded-lg p-4">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <span className="font-semibold">{member.locationName || "—"}</span>
                  <Badge className="bg-green-100 text-green-700 hover:bg-green-100">
                    {member.isActive !== false ? "Active" : "Inactive"}
                  </Badge>
                </div>
                {canEdit && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="border-purple-400 text-purple-600"
                    onClick={() => setEditingJob(!editingJob)}
                  >
                    <Pencil className="h-3 w-3 mr-1" />
                    Edit
                  </Button>
                )}
              </div>

              {editingJob ? (
                <div className="grid grid-cols-2 md:grid-cols-5 gap-4 text-sm">
                  <div>
                    <p className="text-muted-foreground mb-1">Access:</p>
                    <Select
                      defaultValue={member.roleId || ""}
                      onValueChange={(val) => {
                        updateUserMutation.mutate({ roleId: val });
                        setEditingJob(false);
                      }}
                    >
                      <SelectTrigger className="h-8">
                        <SelectValue placeholder="Select role" />
                      </SelectTrigger>
                      <SelectContent>
                        {allRoles.map((r) => (
                          <SelectItem key={r.id} value={r.id}>{r.displayName}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <p className="text-muted-foreground mb-1">PIN:</p>
                    <Input
                      type="password"
                      defaultValue={member.pin || ""}
                      className="h-8"
                      onBlur={(e) => {
                        if (e.target.value !== (member.pin || "")) {
                          updateUserMutation.mutate({ pin: e.target.value });
                        }
                      }}
                    />
                  </div>
                  <div>
                    <p className="text-muted-foreground mb-1">Start Date:</p>
                    <Input
                      type="date"
                      defaultValue={member.startDate ? new Date(member.startDate).toISOString().split("T")[0] : ""}
                      className="h-8"
                      onBlur={(e) => {
                        updateUserMutation.mutate({ startDate: e.target.value ? new Date(e.target.value).toISOString() : null });
                        setEditingJob(false);
                      }}
                    />
                  </div>
                  <div>
                    <p className="text-muted-foreground mb-1">Payroll ID:</p>
                    <Input type="text" defaultValue="" className="h-8" placeholder="--" />
                  </div>
                  <div>
                    <p className="text-muted-foreground mb-1">Wage:</p>
                    <Input
                      type="number"
                      step="0.01"
                      defaultValue={member.hourlyRate || ""}
                      className="h-8"
                      placeholder="0.00"
                      onBlur={(e) => {
                        if (e.target.value !== (member.hourlyRate || "")) {
                          updateUserMutation.mutate({ hourlyRate: e.target.value });
                        }
                        setEditingJob(false);
                      }}
                    />
                  </div>
                </div>
              ) : (
                <div className="grid grid-cols-2 md:grid-cols-5 gap-4 text-sm">
                  <div>
                    <p className="text-muted-foreground">Access:</p>
                    <p className="font-medium">{getAccessLevel(member.role)}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">PIN:</p>
                    <p className="font-medium">{member.pin ? "******" : "--"}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Start Date:</p>
                    <p className="font-medium">{startDateFormatted}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Payroll ID:</p>
                    <p className="font-medium">--</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Role(s) & Wage(s):</p>
                    <p className="font-medium">
                      {member.hourlyRate ? `$${member.hourlyRate}/hr` : "$0.00/hr"}
                    </p>
                  </div>
                </div>
              )}

              <Separator className="my-4" />

              <div>
                <button
                  onClick={() => setLocationSettingsOpen(!locationSettingsOpen)}
                  className="flex items-center gap-2 font-semibold text-sm"
                >
                  {locationSettingsOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                  Location Settings
                </button>
                {locationSettingsOpen && (
                  <div className="mt-3 space-y-3 ml-1">
                    {[
                      { key: "showInSchedule", label: "Show in Schedule" },
                      { key: "sendLocationAlerts", label: "Send Location Alerts" },
                      { key: "includeInTimeClockErrors", label: "Include in Time Clock Errors" },
                      { key: "eligibleForOpenShifts", label: "Eligible for Open Shifts" },
                      { key: "canWaiveMissedBreaks", label: `${member.firstName} can waive or add missed breaks` },
                    ].map((item) => (
                      <div key={item.key} className="flex items-center gap-3">
                        <Checkbox
                          checked={(member as any)[item.key] ?? false}
                          onCheckedChange={(checked) => {
                            if (canEdit) {
                              updateUserMutation.mutate({ [item.key]: checked });
                            }
                          }}
                          disabled={!canEdit}
                          className="data-[state=checked]:bg-green-600 data-[state=checked]:border-green-600"
                        />
                        <span className="text-sm text-muted-foreground">{item.label}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>

          <div>
            <h2 className="text-lg font-bold mb-3">Payroll Information</h2>
            <div className="border rounded-lg p-4">
              <div className="flex items-center justify-between">
                <div className="grid grid-cols-2 gap-x-12 gap-y-2 text-sm">
                  <p className="text-muted-foreground">Payroll Classification:</p>
                  {editingPayroll ? (
                    <Select
                      defaultValue={member.payrollClassification || "1099 Contractor"}
                      onValueChange={(val) => {
                        updateUserMutation.mutate({ payrollClassification: val });
                        setEditingPayroll(false);
                      }}
                    >
                      <SelectTrigger className="h-8 w-48">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="1099 Contractor">1099 Contractor</SelectItem>
                        <SelectItem value="W-2 Employee">W-2 Employee</SelectItem>
                      </SelectContent>
                    </Select>
                  ) : (
                    <p className="font-medium">{member.payrollClassification || "1099 Contractor"}</p>
                  )}
                  <p className="text-muted-foreground">Contractor Type:</p>
                  <p className="font-medium">{member.employmentType || "--"}</p>
                </div>
                {canEdit && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="border-purple-400 text-purple-600 self-start"
                    onClick={() => setEditingPayroll(!editingPayroll)}
                  >
                    <Pencil className="h-3 w-3 mr-1" />
                    Edit
                  </Button>
                )}
              </div>
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-lg font-bold">Recent Job History</h2>
              <button className="text-sm text-purple-600 hover:underline">View all job history</button>
            </div>
            <div className="border rounded-lg p-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-purple-600" />
                  <span className="text-sm">Hired at {member.locationName || "—"}</span>
                </div>
                <span className="text-sm text-muted-foreground">{hiredAtFormatted}</span>
              </div>
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-lg font-bold">Time Off Balances</h2>
              <button className="text-sm text-purple-600 hover:underline flex items-center gap-1">
                View all time off
                <span className="text-xs">↗</span>
              </button>
            </div>
            <div className="border rounded-lg p-4">
              <p className="text-sm text-muted-foreground">
                No time off added for {member.firstName} yet. Visit the Time Off manager to add {member.firstName} to a policy, submit time off, and more.
              </p>
            </div>
          </div>
        </div>
      )}

      {activeTab === "personal" && (
        <div className="space-y-6">
          <h2 className="text-lg font-bold">Personal Information</h2>
          <div className="border rounded-lg p-4 space-y-4">
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <p className="text-muted-foreground">First Name</p>
                <p className="font-medium">{member.firstName || "--"}</p>
              </div>
              <div>
                <p className="text-muted-foreground">Last Name</p>
                <p className="font-medium">{member.lastName || "--"}</p>
              </div>
              <div>
                <p className="text-muted-foreground">Email</p>
                <p className="font-medium">{member.email || "--"}</p>
              </div>
              <div>
                <p className="text-muted-foreground">Phone</p>
                <p className="font-medium">{member.phone || "--"}</p>
              </div>
              <div>
                <p className="text-muted-foreground">Employment Type</p>
                <p className="font-medium">{member.employmentType || "--"}</p>
              </div>
              <div>
                <p className="text-muted-foreground">Location</p>
                <p className="font-medium">{member.locationName || "--"}</p>
              </div>
            </div>
          </div>
        </div>
      )}

      {activeTab === "documents" && (
        <div className="space-y-6">
          <h2 className="text-lg font-bold">Documents</h2>
          <div className="border rounded-lg p-8 text-center">
            <p className="text-muted-foreground">No documents uploaded for {member.firstName} yet.</p>
          </div>
        </div>
      )}

      {activeTab === "performance" && (
        <div className="space-y-6">
          <h2 className="text-lg font-bold">Performance Score</h2>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="border rounded-lg p-4 text-center">
              <div className="w-16 h-16 rounded-full bg-purple-100 flex items-center justify-center mx-auto mb-2">
                <span className="text-2xl font-bold text-purple-600">{performancePoints}</span>
              </div>
              <p className="text-sm font-semibold">Overall Score</p>
              <p className="text-xs text-muted-foreground">out of 100</p>
            </div>

            <div className="border rounded-lg p-4">
              <div className="flex items-center gap-2 mb-3">
                <Target className="h-4 w-4 text-blue-600" />
                <span className="text-sm font-semibold">Task Completion</span>
              </div>
              <div className="text-2xl font-bold text-blue-600">{taskCompletionRate}%</div>
              <p className="text-xs text-muted-foreground mt-1">
                {completedTasks.length} of {totalTasks} tasks completed
              </p>
              <div className="mt-2 w-full bg-gray-200 rounded-full h-2">
                <div
                  className="bg-blue-600 h-2 rounded-full transition-all"
                  style={{ width: `${taskCompletionRate}%` }}
                />
              </div>
            </div>

            <div className="border rounded-lg p-4">
              <div className="flex items-center gap-2 mb-3">
                <Clock className="h-4 w-4 text-green-600" />
                <span className="text-sm font-semibold">Punctuality</span>
              </div>
              <div className="text-2xl font-bold text-green-600">{punctualityScore}%</div>
              <p className="text-xs text-muted-foreground mt-1">
                {onTimeEntries.length - lateEntries.length} on-time out of {onTimeEntries.length} shifts
              </p>
              <div className="mt-2 w-full bg-gray-200 rounded-full h-2">
                <div
                  className="bg-green-600 h-2 rounded-full transition-all"
                  style={{ width: `${punctualityScore}%` }}
                />
              </div>
            </div>
          </div>

          <div>
            <h3 className="font-semibold mb-3">Score Breakdown</h3>
            <div className="border rounded-lg divide-y">
              <div className="flex items-center justify-between p-3">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-blue-600" />
                  <span className="text-sm">Task Completion Rate</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">{taskCompletionRate}%</span>
                  <span className="text-xs text-muted-foreground">(40% weight)</span>
                </div>
              </div>
              <div className="flex items-center justify-between p-3">
                <div className="flex items-center gap-2">
                  <Clock className="h-4 w-4 text-green-600" />
                  <span className="text-sm">On-Time Arrivals</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">{punctualityScore}%</span>
                  <span className="text-xs text-muted-foreground">(40% weight)</span>
                </div>
              </div>
              <div className="flex items-center justify-between p-3">
                <div className="flex items-center gap-2">
                  <Award className="h-4 w-4 text-amber-600" />
                  <span className="text-sm">Completed Tasks Bonus</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">{Math.min(completedTasks.length * 2, 20)} pts</span>
                  <span className="text-xs text-muted-foreground">(max 20)</span>
                </div>
              </div>
            </div>
          </div>

          <div>
            <h3 className="font-semibold mb-3">Activity Summary</h3>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div className="border rounded-lg p-3 text-center">
                <p className="text-2xl font-bold">{memberTimeEntries.length}</p>
                <p className="text-xs text-muted-foreground">Total Shifts</p>
              </div>
              <div className="border rounded-lg p-3 text-center">
                <p className="text-2xl font-bold">{totalTasks}</p>
                <p className="text-xs text-muted-foreground">Assigned Tasks</p>
              </div>
              <div className="border rounded-lg p-3 text-center">
                <p className="text-2xl font-bold">{completedTasks.length}</p>
                <p className="text-xs text-muted-foreground">Completed Tasks</p>
              </div>
              <div className="border rounded-lg p-3 text-center">
                <p className="text-2xl font-bold">{lateEntries.length}</p>
                <p className="text-xs text-muted-foreground">Late Arrivals</p>
              </div>
            </div>
          </div>
        </div>
      )}

      <Dialog open={terminateDialogOpen} onOpenChange={setTerminateDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Terminate {member.firstName} {member.lastName}?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            This will deactivate the team member's account. They will no longer be able to clock in, view schedules, or access the system.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setTerminateDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={terminateMutation.isPending}
              onClick={() => terminateMutation.mutate()}
            >
              {terminateMutation.isPending && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
              Terminate
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
