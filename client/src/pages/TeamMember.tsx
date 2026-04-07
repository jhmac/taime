import { useState, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useLocation, useRoute } from "wouter";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import type { User, Role, Permission } from "@shared/schema";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
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
  Award,
  Star,
  Upload,
  FileText,
  Trash2,
  Download,
  Send,
  Plus,
  Route,
  Wallet,
  MapPin,
  ExternalLink,
} from "lucide-react";
import TripReceiptModal from "@/components/TripReceiptModal";

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
  const [editingContact, setEditingContact] = useState(false);
  const [editingPersonalPayroll, setEditingPersonalPayroll] = useState(false);
  const [terminateDialogOpen, setTerminateDialogOpen] = useState(false);
  const [newNote, setNewNote] = useState("");
  const [selectedTripReceiptId, setSelectedTripReceiptId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const certFileInputRef = useRef<HTMLInputElement>(null);

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

  const { data: documents = [] } = useQuery<any[]>({
    queryKey: ["/api/users", userId, "documents"],
    queryFn: async () => {
      const res = await fetch(`/api/users/${userId}/documents`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch documents");
      return res.json();
    },
    enabled: !!userId,
  });

  const { data: notes = [] } = useQuery<any[]>({
    queryKey: ["/api/users", userId, "notes"],
    queryFn: async () => {
      const res = await fetch(`/api/users/${userId}/notes`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch notes");
      return res.json();
    },
    enabled: !!userId,
  });

  const { data: recentTrips = [], isLoading: isTripsLoading } = useQuery<any[]>({
    queryKey: ["/api/offsite-sessions/employee", userId],
    queryFn: async () => {
      const res = await fetch(`/api/offsite-sessions/employee/${userId}`, { credentials: "include" });
      if (!res.ok) return [];
      const data = await res.json();
      return data.filter((s: any) => s.status !== 'active').slice(0, 5);
    },
    enabled: !!userId && activeTab === "job",
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

  const resendInviteMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/users/${userId}/resend-invite`);
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Sent", description: "Invitation email has been resent." });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const uploadDocMutation = useMutation({
    mutationFn: async (data: any) => {
      const res = await apiRequest("POST", `/api/users/${userId}/documents`, data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/users", userId, "documents"] });
      toast({ title: "Uploaded", description: "Document uploaded successfully." });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const deleteDocMutation = useMutation({
    mutationFn: async (docId: string) => {
      const res = await apiRequest("DELETE", `/api/documents/${docId}`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/users", userId, "documents"] });
      toast({ title: "Deleted", description: "Document removed." });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const addNoteMutation = useMutation({
    mutationFn: async (content: string) => {
      const res = await apiRequest("POST", `/api/users/${userId}/notes`, { content });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/users", userId, "notes"] });
      setNewNote("");
      toast({ title: "Added", description: "Note added." });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const deleteNoteMutation = useMutation({
    mutationFn: async (noteId: string) => {
      const res = await apiRequest("DELETE", `/api/notes/${noteId}`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/users", userId, "notes"] });
      toast({ title: "Deleted", description: "Note removed." });
    },
  });

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>, category: string) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      toast({ title: "Too large", description: "File must be under 5MB.", variant: "destructive" });
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      uploadDocMutation.mutate({
        category,
        name: file.name.replace(/\.[^/.]+$/, ""),
        fileName: file.name,
        fileData: reader.result as string,
        fileType: file.type,
        fileSize: file.size,
      });
    };
    reader.readAsDataURL(file);
    e.target.value = "";
  };

  const memberTimeEntries = timeEntries.filter((te: any) => te.userId === userId);
  const memberTasks = tasks.filter((t: any) => t.assignedTo === userId);

  const completedTasks = memberTasks.filter((t: any) => t.status === "completed");
  const totalTasks = memberTasks.length;
  const taskCompletionRate = totalTasks > 0 ? Math.round((completedTasks.length / totalTasks) * 100) : null;
  const taskCompletionDisplay = taskCompletionRate !== null ? `${taskCompletionRate}%` : "N/A";

  const onTimeEntries = memberTimeEntries.filter((te: any) => {
    if (!te.clockInTime) return false;
    return true;
  });
  const lateEntries = memberTimeEntries.filter((te: any) => te.isLate === true);
  const punctualityScore = onTimeEntries.length > 0
    ? Math.round(((onTimeEntries.length - lateEntries.length) / onTimeEntries.length) * 100)
    : 100;

  const missedClockOuts = memberTimeEntries.filter((te: any) => te.clockInTime && !te.clockOutTime).length;

  const totalHours = memberTimeEntries.reduce((sum: number, te: any) => {
    if (te.clockInTime && te.clockOutTime) {
      const diff = new Date(te.clockOutTime).getTime() - new Date(te.clockInTime).getTime();
      return sum + diff / (1000 * 60 * 60);
    }
    return sum;
  }, 0);
  const weeksWorked = Math.max(1, Math.ceil(memberTimeEntries.length / 5));
  const avgHoursPerWeek = memberTimeEntries.length > 0 ? (totalHours / weeksWorked).toFixed(2) : "0";

  const taskScore = taskCompletionRate !== null ? taskCompletionRate : 100;
  const performancePoints = Math.round(
    (taskScore * 0.4) + (punctualityScore * 0.4) + (Math.min(completedTasks.length * 2, 20))
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

  const certificates = documents.filter((d: any) => d.category === "certificate");
  const onboardingDocs = documents.filter((d: any) => d.category === "onboarding");
  const generalDocs = documents.filter((d: any) => d.category === "general");

  const onboardingForms = [
    { name: "W-4 Form", key: "w4" },
    { name: "I-9 Form", key: "i9" },
    { name: "State Withholding Form", key: "state_withholding" },
    { name: "W-9 Form", key: "w9" },
    { name: "Payment Method Form", key: "payment_method" },
  ];

  const m = member as any;

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
            <div className="flex items-center gap-2 mt-1 text-sm flex-wrap">
              {member.phone && (
                <a 
                  href={`tel:${member.phone}`} 
                  className="flex items-center gap-1 text-purple-600 hover:underline"
                  onClick={(e) => {
                    if (canEdit) {
                      e.preventDefault();
                      setActiveTab("personal");
                      setEditingContact(true);
                    }
                  }}
                >
                  <Phone className="h-3 w-3" />
                  {member.phone}
                </a>
              )}
              {member.phone && <span className="text-muted-foreground">|</span>}
              {member.email ? (
                <a 
                  href={`mailto:${member.email}`} 
                  className="flex items-center gap-1 text-purple-600 hover:underline"
                  onClick={(e) => {
                    if (canEdit) {
                      e.preventDefault();
                      setActiveTab("personal");
                      setEditingContact(true);
                    }
                  }}
                >
                  <Mail className="h-3 w-3" />
                  {member.email}
                </a>
              ) : (
                <span 
                  className="text-purple-600 cursor-pointer hover:underline flex items-center gap-1"
                  onClick={() => {
                    if (canEdit) {
                      setActiveTab("personal");
                      setEditingContact(true);
                    }
                  }}
                >
                  <Mail className="h-3 w-3" />
                  Add email address
                </span>
              )}
            </div>
            <div className="flex items-center gap-2 mt-1">
              {invitedAgo && (
                <span className="text-xs text-muted-foreground">{invitedAgo}</span>
              )}
              {canEdit && (
                <button
                  onClick={() => {
                    if (!member.email) {
                      toast({ title: "No email address", description: "Please add an email address before resending the invite.", variant: "destructive" });
                      return;
                    }
                    resendInviteMutation.mutate();
                  }}
                  disabled={resendInviteMutation.isPending}
                  className="text-xs text-purple-600 hover:underline font-medium"
                >
                  {resendInviteMutation.isPending ? "Sending..." : "Resend Invite"}
                </button>
              )}
            </div>
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
                  <p className="text-muted-foreground">Mileage Rate Override:</p>
                  {editingPayroll ? (
                    <div className="flex items-center gap-1">
                      <span className="text-sm">$</span>
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        className="border rounded px-2 py-1 text-sm w-24"
                        defaultValue={member.mileageRateCentsOverride != null
                          ? (member.mileageRateCentsOverride / 100).toFixed(2)
                          : ""}
                        placeholder="e.g. 0.67"
                        onBlur={(e) => {
                          const val = parseFloat(e.target.value);
                          if (!isNaN(val) && val >= 0) {
                            updateUserMutation.mutate({ mileageRateCentsOverride: Math.round(val * 100) });
                          } else if (e.target.value === "") {
                            updateUserMutation.mutate({ mileageRateCentsOverride: null });
                          }
                        }}
                      />
                      <span className="text-sm text-muted-foreground">/mi</span>
                    </div>
                  ) : (
                    <p className="font-medium">
                      {member.mileageRateCentsOverride != null
                        ? `$${(member.mileageRateCentsOverride / 100).toFixed(2)}/mi`
                        : "—"}
                    </p>
                  )}
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
              <h2 className="text-lg font-bold">Recent Off-Site Trips</h2>
            </div>
            <div className="border rounded-lg overflow-hidden">
              {isTripsLoading ? (
                <div className="p-4 space-y-2">
                  <Skeleton className="h-14 w-full" />
                  <Skeleton className="h-14 w-full" />
                </div>
              ) : recentTrips.length === 0 ? (
                <div className="p-4">
                  <p className="text-sm text-muted-foreground">No completed off-site trips for {member.firstName} yet.</p>
                </div>
              ) : (
                <div className="divide-y">
                  {recentTrips.map((trip: any) => (
                    <button
                      key={trip.id}
                      className="w-full text-left px-4 py-3 hover:bg-muted/50 transition-colors"
                      onClick={() => setSelectedTripReceiptId(trip.id)}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-0.5">
                            <span className="text-sm font-medium">
                              {trip.exitTime ? new Date(trip.exitTime).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—'}
                            </span>
                            {trip.reviewedAt ? (
                              <Badge className="bg-green-100 text-green-700 border-green-200 text-xs">Reviewed</Badge>
                            ) : (
                              <Badge variant="secondary" className="text-xs">Pending</Badge>
                            )}
                          </div>
                          <div className="flex flex-wrap gap-x-3 text-xs text-muted-foreground">
                            {trip.durationMinutes != null && (
                              <span className="flex items-center gap-1">
                                <Clock className="w-3 h-3" />
                                {trip.durationMinutes < 60 ? `${trip.durationMinutes}m` : `${Math.floor(trip.durationMinutes / 60)}h ${trip.durationMinutes % 60}m`}
                              </span>
                            )}
                            {trip.totalDistanceMiles && (
                              <span className="flex items-center gap-1">
                                <Route className="w-3 h-3" />
                                {parseFloat(trip.totalDistanceMiles).toFixed(1)} mi
                              </span>
                            )}
                          </div>
                        </div>
                        <ExternalLink className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          <TripReceiptModal
            sessionId={selectedTripReceiptId}
            onClose={() => setSelectedTripReceiptId(null)}
            isAdmin={isAdminRole}
          />

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
          <div>
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-lg font-bold">Personal Information</h2>
              {canEdit && (
                <Button
                  variant="outline"
                  size="sm"
                  className="border-purple-400 text-purple-600"
                  onClick={() => setEditingContact(!editingContact)}
                >
                  <Pencil className="h-3 w-3 mr-1" />
                  {editingContact ? "Cancel" : "Edit"}
                </Button>
              )}
            </div>
            <div className="border rounded-lg p-4">
              {editingContact ? (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-4">
                    <div>
                      <label className="text-xs font-semibold text-muted-foreground uppercase">Preferred Name</label>
                      <Input
                        defaultValue={member.preferredName || `${member.firstName || ""} ${member.lastName || ""}`}
                        className="mt-1"
                        onBlur={(e) => updateUserMutation.mutate({ preferredName: e.target.value })}
                      />
                    </div>
                    <div>
                      <label className="text-xs font-semibold text-muted-foreground uppercase">Personal Email</label>
                      <Input
                        defaultValue={member.email || ""}
                        className="mt-1"
                        onBlur={(e) => updateUserMutation.mutate({ email: e.target.value })}
                      />
                    </div>
                    <div>
                      <label className="text-xs font-semibold text-muted-foreground uppercase">Phone Number</label>
                      <Input
                        defaultValue={member.phone || ""}
                        className="mt-1"
                        onBlur={(e) => updateUserMutation.mutate({ phone: e.target.value })}
                      />
                    </div>
                  </div>
                  <div className="space-y-4">
                    <div>
                      <label className="text-xs font-semibold text-muted-foreground uppercase">Emergency Contact Name</label>
                      <Input
                        defaultValue={member.emergencyContactName || ""}
                        className="mt-1"
                        onBlur={(e) => updateUserMutation.mutate({ emergencyContactName: e.target.value })}
                      />
                    </div>
                    <div>
                      <label className="text-xs font-semibold text-muted-foreground uppercase">Emergency Contact Phone</label>
                      <Input
                        defaultValue={member.emergencyContactPhone || ""}
                        className="mt-1"
                        onBlur={(e) => updateUserMutation.mutate({ emergencyContactPhone: e.target.value })}
                      />
                    </div>
                  </div>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-4">
                    <div>
                      <p className="text-xs font-semibold text-muted-foreground uppercase">Preferred Name</p>
                      <p className="mt-1">{member.preferredName || `${member.firstName || ""} ${member.lastName || ""}`}</p>
                    </div>
                    <div>
                      <p className="text-xs font-semibold text-muted-foreground uppercase">Personal Email</p>
                      <p className="mt-1">{member.email || "—"}</p>
                    </div>
                    <div>
                      <p className="text-xs font-semibold text-muted-foreground uppercase">Phone Number</p>
                      <p className="mt-1">{member.phone || "—"}</p>
                    </div>
                  </div>
                  <div className="space-y-4">
                    <div>
                      <p className="text-xs font-semibold text-muted-foreground uppercase">Emergency Contact</p>
                      <p className="mt-1">
                        {member.emergencyContactName ? (
                          <>
                            {member.emergencyContactName}
                            {member.emergencyContactPhone && <span className="text-muted-foreground ml-2">({member.emergencyContactPhone})</span>}
                          </>
                        ) : "—"}
                      </p>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-lg font-bold">Payroll Information</h2>
              {canEdit && (
                <Button
                  variant="outline"
                  size="sm"
                  className="border-purple-400 text-purple-600"
                  onClick={() => setEditingPersonalPayroll(!editingPersonalPayroll)}
                >
                  <Pencil className="h-3 w-3 mr-1" />
                  {editingPersonalPayroll ? "Cancel" : "Edit"}
                </Button>
              )}
            </div>
            <div className="border rounded-lg p-4">
              {editingPersonalPayroll ? (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-4">
                    <div>
                      <label className="text-xs font-semibold text-muted-foreground uppercase">Legal Name</label>
                      <Input
                        defaultValue={member.legalName || `${member.firstName || ""} ${member.lastName || ""}`}
                        className="mt-1"
                        onBlur={(e) => updateUserMutation.mutate({ legalName: e.target.value })}
                      />
                    </div>
                    <div>
                      <label className="text-xs font-semibold text-muted-foreground uppercase">Date of Birth</label>
                      <Input
                        type="date"
                        defaultValue={member.dateOfBirth ? new Date(member.dateOfBirth).toISOString().split('T')[0] : ""}
                        className="mt-1"
                        onBlur={(e) => updateUserMutation.mutate({ dateOfBirth: e.target.value })}
                      />
                    </div>
                    <div>
                      <label className="text-xs font-semibold text-muted-foreground uppercase">SSN</label>
                      <Input
                        type="password"
                        defaultValue={member.ssn || ""}
                        placeholder="***-**-****"
                        className="mt-1"
                        onBlur={(e) => updateUserMutation.mutate({ ssn: e.target.value })}
                      />
                    </div>
                  </div>
                  <div className="space-y-4">
                    <div>
                      <label className="text-xs font-semibold text-muted-foreground uppercase">Home Address</label>
                      <Input
                        defaultValue={member.homeAddress || ""}
                        className="mt-1 mb-2"
                        onBlur={(e) => updateUserMutation.mutate({ homeAddress: e.target.value })}
                      />
                      <div className="grid grid-cols-3 gap-2">
                        <Input
                          placeholder="City"
                          defaultValue={member.homeCity || ""}
                          onBlur={(e) => updateUserMutation.mutate({ homeCity: e.target.value })}
                        />
                        <Input
                          placeholder="State"
                          defaultValue={member.homeState || ""}
                          onBlur={(e) => updateUserMutation.mutate({ homeState: e.target.value })}
                        />
                        <Input
                          placeholder="ZIP"
                          defaultValue={member.homeZip || ""}
                          onBlur={(e) => updateUserMutation.mutate({ homeZip: e.target.value })}
                        />
                      </div>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-4">
                    <div>
                      <p className="text-xs font-semibold text-muted-foreground uppercase">Legal Name</p>
                      <p className="mt-1">{member.legalName || `${member.firstName || ""} ${member.lastName || ""}`}</p>
                    </div>
                    <div>
                      <p className="text-xs font-semibold text-muted-foreground uppercase">Date of Birth</p>
                      <p className="mt-1">
                        {member.dateOfBirth ? new Date(member.dateOfBirth).toLocaleDateString() : "—"}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs font-semibold text-muted-foreground uppercase">Social Security Number</p>
                      <p className="mt-1">{member.ssn ? `***-**-${member.ssn.slice(-4)}` : "—"}</p>
                    </div>
                  </div>
                  <div className="space-y-4">
                    <div>
                      <p className="text-xs font-semibold text-muted-foreground uppercase">Home Address</p>
                      <p className="mt-1">
                        {member.homeAddress ? (
                          <>
                            {member.homeAddress}<br />
                            {member.homeCity}, {member.homeState} {member.homeZip}
                          </>
                        ) : "—"}
                      </p>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {activeTab === "documents" && (
        <div className="space-y-6">
          <div>
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-lg font-bold">Certificates ({certificates.length})</h2>
              <button
                onClick={() => certFileInputRef.current?.click()}
                className="text-sm text-purple-600 hover:underline"
              >
                Add a certificate
              </button>
              <input
                ref={certFileInputRef}
                type="file"
                className="hidden"
                accept=".pdf,.jpg,.jpeg,.png,.doc,.docx"
                onChange={(e) => handleFileUpload(e, "certificate")}
              />
            </div>
            <div className="border rounded-lg p-4">
              {certificates.length === 0 ? (
                <p className="text-muted-foreground text-center py-2">
                  No certificates added for {member.firstName} yet.
                </p>
              ) : (
                <div className="space-y-2">
                  {certificates.map((doc: any) => (
                    <div key={doc.id} className="flex items-center justify-between p-2 hover:bg-muted/50 rounded">
                      <div className="flex items-center gap-2">
                        <FileText className="h-4 w-4 text-purple-600" />
                        <span className="text-sm">{doc.name}</span>
                        <span className="text-xs text-muted-foreground">
                          {new Date(doc.createdAt).toLocaleDateString()}
                        </span>
                      </div>
                      <div className="flex items-center gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => window.open(`/api/documents/${doc.id}/download`, "_blank")}
                        >
                          <Download className="h-3 w-3" />
                        </Button>
                        {canEdit && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => deleteDocMutation.mutate(doc.id)}
                          >
                            <Trash2 className="h-3 w-3 text-red-500" />
                          </Button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-lg font-bold">Onboarding ({onboardingDocs.length})</h2>
              <button
                onClick={() => fileInputRef.current?.click()}
                className="text-sm text-purple-600 hover:underline"
              >
                Add a document
              </button>
              <input
                ref={fileInputRef}
                type="file"
                className="hidden"
                accept=".pdf,.jpg,.jpeg,.png,.doc,.docx"
                onChange={(e) => handleFileUpload(e, "onboarding")}
              />
            </div>
            <div className="border rounded-lg">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b">
                    <th className="text-left p-3 font-medium">Name</th>
                    <th className="text-left p-3 font-medium">Versions</th>
                    <th className="text-left p-3 font-medium">File</th>
                  </tr>
                </thead>
                <tbody>
                  {onboardingForms.map((form) => {
                    const uploaded = onboardingDocs.find((d: any) =>
                      d.name.toLowerCase().includes(form.key.replace("_", " ")) ||
                      d.name.toLowerCase().includes(form.name.toLowerCase())
                    );
                    return (
                      <tr key={form.key} className="border-b last:border-0">
                        <td className="p-3">{form.name}</td>
                        <td className="p-3 text-muted-foreground">{uploaded ? "1" : "0"}</td>
                        <td className="p-3">
                          {uploaded ? (
                            <div className="flex items-center gap-2">
                              <span className="text-green-600 flex items-center gap-1">
                                <CheckCircle2 className="h-3 w-3" />
                                Uploaded
                              </span>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => window.open(`/api/documents/${uploaded.id}/download`, "_blank")}
                              >
                                <Download className="h-3 w-3" />
                              </Button>
                            </div>
                          ) : (
                            <span className="text-orange-500 flex items-center gap-1">
                              <Clock className="h-3 w-3" />
                              Not sent
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {generalDocs.length > 0 && (
            <div>
              <h2 className="text-lg font-bold mb-3">Other Documents ({generalDocs.length})</h2>
              <div className="border rounded-lg p-4 space-y-2">
                {generalDocs.map((doc: any) => (
                  <div key={doc.id} className="flex items-center justify-between p-2 hover:bg-muted/50 rounded">
                    <div className="flex items-center gap-2">
                      <FileText className="h-4 w-4 text-purple-600" />
                      <span className="text-sm">{doc.name}</span>
                      <span className="text-xs text-muted-foreground">
                        ({(doc.fileSize / 1024).toFixed(0)} KB)
                      </span>
                    </div>
                    <div className="flex items-center gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => window.open(`/api/documents/${doc.id}/download`, "_blank")}
                      >
                        <Download className="h-3 w-3" />
                      </Button>
                      {canEdit && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => deleteDocMutation.mutate(doc.id)}
                        >
                          <Trash2 className="h-3 w-3 text-red-500" />
                        </Button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="flex justify-center">
            <Button
              variant="outline"
              className="border-purple-400 text-purple-600"
              onClick={() => fileInputRef.current?.click()}
            >
              <Upload className="h-4 w-4 mr-2" />
              Upload Document
            </Button>
          </div>
        </div>
      )}

      {activeTab === "performance" && (
        <div className="space-y-6">
          <div>
            <h2 className="text-lg font-bold mb-3">Attendance - this month</h2>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div className="border rounded-lg p-4">
                <p className="text-sm text-muted-foreground">On time rate</p>
                <p className="text-2xl font-bold text-green-600">{punctualityScore}%</p>
              </div>
              <div className="border rounded-lg p-4">
                <p className="text-sm text-muted-foreground">Average hours/week</p>
                <p className="text-2xl font-bold">{avgHoursPerWeek}</p>
              </div>
              <div className="border rounded-lg p-4">
                <p className="text-sm text-muted-foreground">Missed clock outs</p>
                <p className="text-2xl font-bold">{missedClockOuts}</p>
              </div>
              <div className="border rounded-lg p-4">
                <p className="text-sm text-muted-foreground">No shows</p>
                <p className="text-2xl font-bold">0</p>
              </div>
              <div className="border rounded-lg p-4">
                <p className="text-sm text-muted-foreground">Average shift rating</p>
                <p className="text-2xl font-bold flex items-center gap-1">0 <Star className="h-4 w-4 text-yellow-500" /></p>
              </div>
              <div className="border rounded-lg p-4">
                <p className="text-sm text-muted-foreground">Shifts worked</p>
                <p className="text-2xl font-bold">{memberTimeEntries.length}</p>
              </div>
              <div className="border rounded-lg p-4">
                <p className="text-sm text-muted-foreground">Missed breaks</p>
                <p className="text-2xl font-bold">0</p>
              </div>
              <div className="border rounded-lg p-4">
                <p className="text-sm text-muted-foreground">Task completion</p>
                <p className="text-2xl font-bold text-blue-600">{taskCompletionDisplay}</p>
                <p className="text-xs text-muted-foreground">
                  {completedTasks.length} of {totalTasks} tasks
                </p>
              </div>
            </div>
          </div>

          <div>
            <h2 className="text-lg font-bold mb-3">Role breakdown</h2>
            <div className="border rounded-lg p-4">
              <div className="flex items-center justify-between">
                <span className="text-sm">{member.role?.displayName || member.role?.name || "No role"}</span>
                <span className="text-sm text-muted-foreground">{totalHours.toFixed(1)} hours (100%)</span>
              </div>
            </div>
          </div>

          <div>
            <h2 className="text-lg font-bold mb-3">Milestones</h2>
            <div className="border rounded-lg p-4">
              <div className="flex gap-4 overflow-x-auto pb-2">
                {[
                  { label: "Champion: 5 shifts completed", threshold: 5, icon: "🏆" },
                  { label: "Pro: 10 shifts completed", threshold: 10, icon: "⭐" },
                  { label: "Hero: 25 shifts completed", threshold: 25, icon: "🦸" },
                  { label: "Legend: 50 shifts completed", threshold: 50, icon: "👑" },
                ].map((milestone) => {
                  const earned = memberTimeEntries.length >= milestone.threshold;
                  return (
                    <div
                      key={milestone.label}
                      className={`flex-shrink-0 w-36 border rounded-lg p-3 text-center ${
                        earned ? "bg-purple-50 border-purple-200" : "opacity-50"
                      }`}
                    >
                      <div className="text-2xl mb-1">{milestone.icon}</div>
                      <p className="text-xs">{milestone.label}</p>
                      {earned && (
                        <p className="text-xs text-green-600 mt-1">Earned</p>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          <div>
            <h2 className="text-lg font-bold mb-3">Performance Score</h2>
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
                  <CheckCircle2 className="h-4 w-4 text-blue-600" />
                  <span className="text-sm font-semibold">Task Completion</span>
                </div>
                <div className="text-2xl font-bold text-blue-600">{taskCompletionDisplay}</div>
                <p className="text-xs text-muted-foreground mt-1">
                  {completedTasks.length} of {totalTasks} tasks completed
                </p>
                <div className="mt-2 w-full bg-gray-200 rounded-full h-2">
                  <div
                    className="bg-blue-600 h-2 rounded-full transition-all"
                    style={{ width: `${taskCompletionRate ?? 0}%` }}
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
                  <span className="text-sm font-medium">{taskCompletionDisplay}</span>
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

          {canEdit && (
            <div>
              <h2 className="text-lg font-bold mb-3">Manager notes</h2>
              <div className="border rounded-lg p-4 space-y-4">
                <div>
                  <p className="text-sm font-semibold mb-2">Add new note</p>
                  <Textarea
                    value={newNote}
                    onChange={(e) => setNewNote(e.target.value)}
                    placeholder="Add a note to this time card. Only managers can see this."
                    className="min-h-[80px]"
                  />
                  <div className="flex justify-end mt-2">
                    <Button
                      size="sm"
                      disabled={!newNote.trim() || addNoteMutation.isPending}
                      onClick={() => addNoteMutation.mutate(newNote)}
                      className="bg-purple-600 hover:bg-purple-700 text-white"
                    >
                      {addNoteMutation.isPending ? "Adding..." : "Add note"}
                    </Button>
                  </div>
                </div>

                {notes.length > 0 && (
                  <div className="space-y-3 pt-2 border-t">
                    {notes.map((note: any) => (
                      <div key={note.id} className="flex justify-between items-start">
                        <div>
                          <p className="text-sm">{note.note}</p>
                          <p className="text-xs text-muted-foreground mt-1">
                            {new Date(note.createdAt).toLocaleDateString("en-US", {
                              month: "short",
                              day: "numeric",
                              year: "numeric",
                              hour: "numeric",
                              minute: "2-digit",
                            })}
                          </p>
                        </div>
                        {(note.managerId === currentUser?.id || isAdminRole) && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => deleteNoteMutation.mutate(note.id)}
                          >
                            <Trash2 className="h-3 w-3 text-red-500" />
                          </Button>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
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
