import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { useLocation } from "wouter";
import type { User, Role, Permission, WorkLocation } from "@shared/schema";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
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
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Search,
  Plus,
  ArrowUpDown,
  Filter,
  Loader2,
  AlertTriangle,
  Users,
  Send,
  Link,
  Check,
  Clock,
  Mail,
  Navigation,
  MapPin,
} from "lucide-react";

function getInitials(firstName?: string | null, lastName?: string | null) {
  return `${firstName?.[0] || ""}${lastName?.[0] || ""}`.toUpperCase() || "?";
}

function timeAgo(dateStr: string | Date | null | undefined): string {
  if (!dateStr) return "";
  const diff = Date.now() - new Date(dateStr).getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function getEmploymentTypeLabel(type?: string | null) {
  if (!type) return "Employee";
  const map: Record<string, string> = {
    "w2": "W-2 Employee",
    "w-2": "W-2 Employee",
    "w2_employee": "W-2 Employee",
    "contractor": "Contractor",
    "1099": "Contractor",
    "owner": "Account Owner",
    "account_owner": "Account Owner",
  };
  return map[type.toLowerCase()] || type;
}

function getAccessLevel(roleName?: string | null) {
  if (!roleName) return "Employee";
  const managerRoles = ["owner", "admin", "manager", "assistant_manager"];
  return managerRoles.includes(roleName) ? "Manager" : "Employee";
}

export default function Team() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { user: currentUser } = useAuth();
  const [, navigate] = useLocation();

  const [search, setSearch] = useState("");
  const [showTerminated, setShowTerminated] = useState(false);
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [confirmAction, setConfirmAction] = useState<{
    type: "deactivate" | "remove";
    user: User;
  } | null>(null);
  const [editingPayRate, setEditingPayRate] = useState<string | null>(null);
  const [payRateValue, setPayRateValue] = useState("");
  const [sortAsc, setSortAsc] = useState(true);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [invitedMember, setInvitedMember] = useState<{ name: string; email: string } | null>(null);
  const [assignLocationUser, setAssignLocationUser] = useState<User | null>(null);
  const [selectedLocationId, setSelectedLocationId] = useState<string>("");

  const { data: members = [], isLoading, error } = useQuery<User[]>({
    queryKey: ["/api/users", { includeAll: showTerminated }],
    queryFn: async () => {
      const url = showTerminated ? "/api/users?includeAll=true" : "/api/users";
      const res = await fetch(url, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch users");
      return res.json();
    },
  });

  const isAdminRole = currentUser?.role?.name === 'owner' || currentUser?.role?.name === 'admin' || currentUser?.role?.name === 'manager';
  const isOwnerOrAdmin = currentUser?.role?.name === 'owner' || currentUser?.role?.name === 'admin';

  // Role hierarchy enforcement — lower number = higher authority
  const ROLE_RANK: Record<string, number> = {
    owner: 0,
    admin: 1,
    manager: 2,
    assistant_manager: 3,
    employee: 4,
    stylist: 4,
  };
  const currentUserRoleName = currentUser?.role?.name ?? '';
  const currentUserRank = ROLE_RANK[currentUserRoleName] ?? 0;

  const { data: workLocations = [] } = useQuery<WorkLocation[]>({
    queryKey: ["/api/work-locations"],
    enabled: isOwnerOrAdmin,
  });

  const { data: activeOffsiteSessions = [] } = useQuery<any[]>({
    queryKey: ["/api/offsite-sessions"],
    queryFn: async () => {
      const res = await fetch("/api/offsite-sessions?status=active", { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
    refetchInterval: 30000,
    enabled: isAdminRole,
  });

  const inTransitUserIds = new Set(
    activeOffsiteSessions
      .filter((s: any) => s.routePolyline)
      .map((s: any) => s.userId)
  );

  const { data: roles = [] } = useQuery<Role[]>({
    queryKey: ["/api/roles"],
  });

  const { data: permissions = [] } = useQuery<Permission[]>({
    queryKey: ["/api/auth/permissions"],
    enabled: !!currentUser,
  });

  const can = (perm: string) =>
    permissions?.some?.((p) => p.name === perm || p.name === "admin.manage_all") || isAdminRole || false;

  const canManageEmployees = can("hr.edit_team") || can("hr.manage_employees");
  const canEditRoles = can("admin.role_management");
  const canViewPayRates = can("hr.view_team");
  const canEditPayRates = can("hr.edit_team");

  const addMemberMutation = useMutation({
    mutationFn: async (data: Record<string, string>) => {
      const res = await apiRequest("POST", "/api/users", data);
      return res.json();
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ["/api/users"] });
      const name = [variables.firstName, variables.lastName].filter(Boolean).join(" ") || variables.email;
      setInvitedMember({ name, email: variables.email });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const copyInviteLink = (member: User) => {
    if (!member.inviteToken) return;
    const link = `${window.location.origin}/join/${member.inviteToken}`;
    navigator.clipboard.writeText(link).then(() => {
      setCopiedId(member.id);
      setTimeout(() => setCopiedId(null), 2000);
    });
  };

  const updateRoleMutation = useMutation({
    mutationFn: async ({ userId, roleId }: { userId: string; roleId: string }) => {
      const res = await apiRequest("PUT", `/api/users/${userId}/role`, { roleId });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/users"] });
      toast({ title: "Role updated", description: "Member role has been changed." });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const updatePayRateMutation = useMutation({
    mutationFn: async ({ userId, hourlyRate }: { userId: string; hourlyRate: string }) => {
      const res = await apiRequest("PUT", `/api/users/${userId}/pay-rate`, { hourlyRate });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/users"] });
      setEditingPayRate(null);
      toast({ title: "Pay rate updated", description: "Hourly rate has been updated." });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const resendInviteMutation = useMutation({
    mutationFn: async (userId: string) => {
      const res = await apiRequest("POST", `/api/users/${userId}/resend-invite`);
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Invite sent", description: "Invitation email has been resent successfully." });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const deactivateMutation = useMutation({
    mutationFn: async (userId: string) => {
      const res = await apiRequest("PUT", `/api/users/${userId}`, { isActive: false });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/users"] });
      setConfirmAction(null);
      toast({ title: "Member deactivated", description: "Team member has been deactivated." });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const removeMutation = useMutation({
    mutationFn: async (userId: string) => {
      const res = await apiRequest("DELETE", `/api/users/${userId}`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/users"] });
      setConfirmAction(null);
      toast({ title: "Member removed", description: "Team member has been permanently removed." });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const assignLocationMutation = useMutation({
    mutationFn: async ({ userId, locationId }: { userId: string; locationId: string | null }) => {
      const res = await apiRequest("PATCH", `/api/users/${userId}/assign-location`, { locationId });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/users"] });
      setAssignLocationUser(null);
      setSelectedLocationId("");
      toast({ title: "Location assigned", description: "Store assignment has been updated." });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const roleMap = useMemo(() => {
    const map: Record<string, Role> = {};
    roles.forEach((r) => (map[r.id] = r));
    return map;
  }, [roles]);

  // Users who have a locationName (from before the locationId column existed) but whose
  // locationId is still null — the startup backfill missed them (name mismatch, inactive store, etc.).
  // Admins see all users, so we can compute this client-side.
  const unassignedLocationUsers = useMemo(() => {
    if (!isOwnerOrAdmin) return [];
    return members.filter((m) => m.locationName && !m.locationId);
  }, [members, isOwnerOrAdmin]);

  const filtered = useMemo(() => {
    let list = members;
    if (!showTerminated) {
      list = list.filter((m) => m.isActive !== false || !m.inviteAcceptedAt);
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(
        (m) =>
          (m.firstName || "").toLowerCase().includes(q) ||
          (m.lastName || "").toLowerCase().includes(q) ||
          (m.email || "").toLowerCase().includes(q) ||
          `${m.firstName} ${m.lastName}`.toLowerCase().includes(q)
      );
    }
    list = [...list].sort((a, b) => {
      const nameA = `${a.firstName || ""} ${a.lastName || ""}`.toLowerCase();
      const nameB = `${b.firstName || ""} ${b.lastName || ""}`.toLowerCase();
      return sortAsc ? nameA.localeCompare(nameB) : nameB.localeCompare(nameA);
    });
    return list;
  }, [members, search, showTerminated, sortAsc]);

  const handleAddSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const email = (fd.get("email") as string)?.trim();
    if (!email) {
      toast({ title: "Validation error", description: "Email is required.", variant: "destructive" });
      return;
    }
    addMemberMutation.mutate({
      email,
      firstName: (fd.get("firstName") as string) || "",
      lastName: (fd.get("lastName") as string) || "",
      roleId: (fd.get("roleId") as string) || "",
      hourlyRate: (fd.get("hourlyRate") as string) || "",
    });
  };

  const commitPayRate = (userId: string) => {
    if (payRateValue.trim()) {
      updatePayRateMutation.mutate({ userId, hourlyRate: payRateValue });
    }
    setEditingPayRate(null);
  };

  if (isLoading) {
    const colWidths = ['w-24', 'w-28', 'w-20', 'w-16', 'w-10', 'w-14'];
    return (
      <div className="p-4 lg:p-6 space-y-4">
        <div className="flex items-center gap-3">
          <Skeleton className="h-9 flex-1 max-w-xs rounded-md" />
          <Skeleton className="h-9 w-24 rounded-md" />
          <Skeleton className="h-9 w-28 rounded-md" />
        </div>
        <div className="rounded-lg border bg-card overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/50">
                {colWidths.map((w, i) => (
                  <th key={i} className="text-left p-3 font-medium">
                    <Skeleton className={`h-3.5 ${w} rounded`} />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {Array.from({ length: 5 }).map((_, i) => (
                <tr key={i} className="border-b last:border-0">
                  <td className="p-3">
                    <div className="flex items-center gap-3">
                      <Skeleton className="h-9 w-9 rounded-full shrink-0" />
                      <div className="space-y-1.5">
                        <Skeleton className="h-3.5 w-28 rounded" />
                        <Skeleton className="h-3 w-16 rounded" />
                      </div>
                    </div>
                  </td>
                  <td className="p-3">
                    <div className="space-y-1.5">
                      <Skeleton className="h-3.5 w-36 rounded" />
                      <Skeleton className="h-3 w-20 rounded" />
                    </div>
                  </td>
                  <td className="p-3"><Skeleton className="h-3.5 w-16 rounded" /></td>
                  <td className="p-3"><Skeleton className="h-3.5 w-20 rounded" /></td>
                  <td className="p-3"><Skeleton className="h-5 w-20 rounded-full" /></td>
                  <td className="p-3"><Skeleton className="h-5 w-14 rounded-full" /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center py-24 gap-3">
        <AlertTriangle className="h-10 w-10 text-destructive" />
        <p className="text-muted-foreground">Failed to load team members.</p>
        <Button variant="outline" onClick={() => queryClient.invalidateQueries({ queryKey: ["/api/users"] })}>
          Retry
        </Button>
      </div>
    );
  }

  return (
    <div className="p-4 lg:p-6 space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search team members..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <div className="flex items-center gap-2">
          <Label htmlFor="show-terminated" className="text-sm whitespace-nowrap">Show terminated</Label>
          <Switch
            id="show-terminated"
            checked={showTerminated}
            onCheckedChange={setShowTerminated}
          />
        </div>
        <Button
          variant="outline"
          className="border-violet-600 text-violet-600 hover:bg-violet-50 dark:hover:bg-violet-950"
        >
          <Filter className="h-4 w-4 mr-1" />
          Filter
        </Button>
        {canManageEmployees && (
          <Button
            className="bg-violet-600 hover:bg-violet-700 text-white"
            onClick={() => setAddDialogOpen(true)}
          >
            <Plus className="h-4 w-4 mr-1" />
            Add Member
          </Button>
        )}
      </div>

      {isOwnerOrAdmin && unassignedLocationUsers.length > 0 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 dark:bg-amber-950/20 dark:border-amber-800 p-4 space-y-3">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0" />
            <p className="text-sm font-medium text-amber-800 dark:text-amber-300">
              {unassignedLocationUsers.length} team member{unassignedLocationUsers.length !== 1 ? "s" : ""} need{unassignedLocationUsers.length === 1 ? "s" : ""} a store assignment
            </p>
          </div>
          <p className="text-xs text-amber-700 dark:text-amber-400">
            These users have a location name on file but are missing the store ID link. Until fixed, managers at their store may not see them in team views.
          </p>
          <div className="space-y-2">
            {unassignedLocationUsers.map((u) => (
              <div key={u.id} className="flex items-center justify-between gap-3 rounded-md bg-white dark:bg-amber-950/40 border border-amber-200 dark:border-amber-700 px-3 py-2">
                <div className="flex items-center gap-2 min-w-0">
                  <div className="h-7 w-7 rounded-full bg-violet-600 text-white flex items-center justify-center text-xs font-semibold shrink-0">
                    {getInitials(u.firstName, u.lastName)}
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">{u.firstName} {u.lastName}</p>
                    <p className="text-xs text-muted-foreground truncate flex items-center gap-1">
                      <MapPin className="h-2.5 w-2.5 shrink-0" />
                      {u.locationName} (unlinked)
                    </p>
                  </div>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  className="shrink-0 border-amber-400 text-amber-700 hover:bg-amber-100 dark:hover:bg-amber-900"
                  onClick={() => {
                    setAssignLocationUser(u);
                    setSelectedLocationId("");
                  }}
                >
                  <MapPin className="h-3 w-3 mr-1" />
                  Assign store
                </Button>
              </div>
            ))}
          </div>
        </div>
      )}

      {filtered.length === 0 && (
        <div className="flex flex-col items-center py-16 gap-3">
          <Users className="h-12 w-12 text-muted-foreground/50" />
          <p className="text-muted-foreground">No team members found.</p>
          {search ? (
            <Button variant="ghost" size="sm" onClick={() => setSearch("")}>
              Clear search
            </Button>
          ) : null}
        </div>
      )}

      {filtered.length > 0 && (
        <div className="rounded-lg border bg-card overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/50">
                <th className="text-left p-3 font-medium">
                  <button
                    className="flex items-center gap-1 hover:text-violet-600 transition-colors"
                    onClick={() => setSortAsc(!sortAsc)}
                  >
                    Team Member
                    <ArrowUpDown className="h-3.5 w-3.5" />
                  </button>
                </th>
                <th className="text-left p-3 font-medium">Contact Information</th>
                <th className="text-left p-3 font-medium">Access level</th>
                <th className="text-left p-3 font-medium">Location</th>
                <th className="text-left p-3 font-medium">Role</th>
                {canViewPayRates && <th className="text-left p-3 font-medium">Wage</th>}
                <th className="text-left p-3 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((member) => {
                const role = member.roleId ? roleMap[member.roleId] : null;
                return (
                  <tr
                    key={member.id}
                    className="border-b last:border-0 hover:bg-muted/30 transition-colors"
                  >
                    <td className="p-3">
                      <div className="flex items-center gap-3">
                        <div className="h-9 w-9 rounded-full bg-violet-600 text-white flex items-center justify-center text-xs font-semibold shrink-0">
                          {getInitials(member.firstName, member.lastName)}
                        </div>
                        <div>
                          <button
                            className="font-medium text-left hover:text-violet-600 transition-colors"
                            onClick={() => navigate(`/team/${member.id}`)}
                          >
                            {member.firstName} {member.lastName}
                          </button>
                          <p className="text-xs text-muted-foreground">
                            {getEmploymentTypeLabel(member.employmentType)}
                          </p>
                        </div>
                      </div>
                    </td>
                    <td className="p-3">
                      <div>
                        {member.email ? (
                          <a href={`mailto:${member.email}`} className="text-violet-600 hover:underline text-sm">
                            {member.email}
                          </a>
                        ) : (
                          <button className="text-violet-600 hover:underline text-sm" onClick={(e) => e.stopPropagation()}>
                            Add email
                          </button>
                        )}
                        {member.phone && (
                          <p className="text-xs text-muted-foreground">{member.phone}</p>
                        )}
                      </div>
                    </td>
                    <td className="p-3 text-sm">
                      {getAccessLevel(role?.name)}
                    </td>
                    <td className="p-3 text-sm">
                      {member.locationName || "—"}
                    </td>
                    <td className="p-3" onClick={(e) => e.stopPropagation()}>
                      {(() => {
                        const memberRoleName = role?.name ?? '';
                        const memberRank = ROLE_RANK[memberRoleName] ?? 99;
                        const canEditThisMember = canEditRoles && (isOwnerOrAdmin || memberRank > currentUserRank);
                        const assignableRoles = roles.filter(r => isOwnerOrAdmin || (ROLE_RANK[r.name] ?? 99) > currentUserRank);
                        return canEditThisMember && assignableRoles.length > 0 ? (
                          <Select
                            value={member.roleId || ""}
                            onValueChange={(val) => updateRoleMutation.mutate({ userId: member.id, roleId: val })}
                          >
                            <SelectTrigger className="w-[140px] h-8 text-xs border-none shadow-none text-violet-600 p-0 hover:underline">
                              <SelectValue placeholder="Add role" />
                            </SelectTrigger>
                            <SelectContent>
                              {assignableRoles.map((r) => (
                                <SelectItem key={r.id} value={r.id}>{r.displayName}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        ) : role ? (
                          <span className="text-violet-600">{role.displayName}</span>
                        ) : (
                          <span className="text-violet-600">Add role</span>
                        );
                      })()}
                    </td>
                    {canViewPayRates && (
                      <td className="p-3" onClick={(e) => e.stopPropagation()}>
                        {canEditPayRates ? (
                          editingPayRate === member.id ? (
                            <Input
                              type="number"
                              step="0.01"
                              autoFocus
                              value={payRateValue}
                              onChange={(e) => setPayRateValue(e.target.value)}
                              onBlur={() => commitPayRate(member.id)}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") commitPayRate(member.id);
                                if (e.key === "Escape") setEditingPayRate(null);
                              }}
                              className="w-24 h-8 text-sm"
                            />
                          ) : (
                            <button
                              className="text-left text-violet-600 hover:underline text-sm"
                              onClick={() => {
                                setEditingPayRate(member.id);
                                setPayRateValue(member.hourlyRate || "");
                              }}
                            >
                              {member.hourlyRate ? `$${member.hourlyRate}/hr` : "Add wage"}
                            </button>
                          )
                        ) : (
                          <span className="text-sm">
                            {member.hourlyRate ? `$${member.hourlyRate}/hr` : "—"}
                          </span>
                        )}
                      </td>
                    )}
                    <td className="p-3" onClick={(e) => e.stopPropagation()}>
                      <div className="flex flex-col gap-1.5">
                        <div className="flex items-center gap-2 flex-wrap">
                          {member.isActive !== false ? (
                            member.invitedAt && !member.inviteAcceptedAt ? (
                              <Badge variant="outline" className="border-amber-400 text-amber-600 bg-amber-50 gap-1">
                                <Clock className="h-2.5 w-2.5" />
                                Pending
                              </Badge>
                            ) : (
                              <Badge className="bg-green-100 text-green-700 border-green-300 hover:bg-green-100">
                                Active
                              </Badge>
                            )
                          ) : (
                            <Badge variant="outline" className="border-gray-400 text-gray-500">
                              Inactive
                            </Badge>
                          )}
                          {inTransitUserIds.has(member.id) && (
                            <Badge className="bg-blue-100 text-blue-700 border-blue-300 hover:bg-blue-100 gap-1 animate-pulse">
                              <Navigation className="h-2.5 w-2.5" />
                              In Transit
                            </Badge>
                          )}
                        </div>
                        {member.invitedAt && !member.inviteAcceptedAt && (
                          <p className="text-xs text-muted-foreground flex items-center gap-1">
                            <Mail className="h-2.5 w-2.5" />
                            Invited {timeAgo(member.invitedAt)}
                            {(member.inviteCount || 0) > 1 && ` · ${member.inviteCount}x`}
                          </p>
                        )}
                        {canManageEmployees && member.isActive !== false && member.invitedAt && !member.inviteAcceptedAt && member.email && (
                          <div className="flex items-center gap-1">
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-6 text-xs text-violet-600 hover:text-violet-700 px-2"
                              disabled={resendInviteMutation.isPending}
                              onClick={() => resendInviteMutation.mutate(member.id)}
                            >
                              <Send className="h-2.5 w-2.5 mr-1" />
                              Resend
                            </Button>
                            {member.inviteToken && (
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-6 text-xs text-muted-foreground hover:text-violet-600 px-2"
                                onClick={() => copyInviteLink(member)}
                              >
                                {copiedId === member.id ? (
                                  <Check className="h-2.5 w-2.5 mr-1 text-green-600" />
                                ) : (
                                  <Link className="h-2.5 w-2.5 mr-1" />
                                )}
                                {copiedId === member.id ? "Copied!" : "Copy link"}
                              </Button>
                            )}
                          </div>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <Dialog open={addDialogOpen} onOpenChange={(open) => {
        setAddDialogOpen(open);
        if (!open) setInvitedMember(null);
      }}>
        <DialogContent className="sm:max-w-md">
          {invitedMember ? (
            <>
              <DialogHeader>
                <DialogTitle>Invite Sent!</DialogTitle>
              </DialogHeader>
              <div className="py-4 space-y-4">
                <div className="flex flex-col items-center text-center gap-3 py-4">
                  <div className="h-14 w-14 rounded-full bg-green-100 flex items-center justify-center">
                    <Check className="h-7 w-7 text-green-600" />
                  </div>
                  <div>
                    <p className="font-semibold text-gray-900">{invitedMember.name}</p>
                    <p className="text-sm text-muted-foreground">{invitedMember.email}</p>
                  </div>
                  <div className="bg-violet-50 rounded-xl px-4 py-3 text-sm text-violet-700 max-w-xs">
                    <Mail className="h-4 w-4 inline mr-1.5 mb-0.5" />
                    An invite email has been sent. They'll see a personalized welcome page when they click the link.
                  </div>
                </div>
              </div>
              <DialogFooter className="gap-2">
                <Button variant="outline" onClick={() => {
                  setInvitedMember(null);
                }}>
                  Add Another
                </Button>
                <Button className="bg-violet-600 hover:bg-violet-700 text-white" onClick={() => {
                  setAddDialogOpen(false);
                  setInvitedMember(null);
                }}>
                  Done
                </Button>
              </DialogFooter>
            </>
          ) : (
            <>
              <DialogHeader>
                <DialogTitle>Invite Team Member</DialogTitle>
              </DialogHeader>
              <form onSubmit={handleAddSubmit} className="space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label htmlFor="firstName">First Name</Label>
                    <Input id="firstName" name="firstName" placeholder="Jane" />
                  </div>
                  <div>
                    <Label htmlFor="lastName">Last Name</Label>
                    <Input id="lastName" name="lastName" placeholder="Smith" />
                  </div>
                </div>
                <div>
                  <Label htmlFor="email">Work Email *</Label>
                  <Input id="email" name="email" type="email" required placeholder="jane@company.com" />
                  <p className="text-xs text-muted-foreground mt-1">They'll receive an invite at this address</p>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label htmlFor="roleId">Role</Label>
                    <Select name="roleId">
                      <SelectTrigger>
                        <SelectValue placeholder="Select role" />
                      </SelectTrigger>
                      <SelectContent>
                        {roles.map((r) => (
                          <SelectItem key={r.id} value={r.id}>{r.displayName}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label htmlFor="hourlyRate">Hourly Rate</Label>
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">$</span>
                      <Input id="hourlyRate" name="hourlyRate" type="number" step="0.01" placeholder="0.00" className="pl-6" />
                    </div>
                  </div>
                </div>
                <DialogFooter>
                  <Button type="button" variant="outline" onClick={() => setAddDialogOpen(false)}>
                    Cancel
                  </Button>
                  <Button
                    type="submit"
                    className="bg-violet-600 hover:bg-violet-700 text-white gap-2"
                    disabled={addMemberMutation.isPending}
                  >
                    {addMemberMutation.isPending ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Sending invite...
                      </>
                    ) : (
                      <>
                        <Send className="h-4 w-4" />
                        Send Invite
                      </>
                    )}
                  </Button>
                </DialogFooter>
              </form>
            </>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={!!assignLocationUser} onOpenChange={(open) => { if (!open) { setAssignLocationUser(null); setSelectedLocationId(""); } }}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Assign Store</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <p className="text-sm text-muted-foreground">
              Choose the store for <span className="font-medium text-foreground">{assignLocationUser?.firstName} {assignLocationUser?.lastName}</span>.
              Their current location name on file is <span className="font-medium text-foreground">&ldquo;{assignLocationUser?.locationName}&rdquo;</span>.
            </p>
            <div className="space-y-1.5">
              <Label>Store</Label>
              {workLocations.length === 0 ? (
                <p className="text-sm text-muted-foreground rounded-md border border-dashed p-3 text-center">
                  No active stores configured. Add a store in Settings first.
                </p>
              ) : (
                <Select value={selectedLocationId} onValueChange={setSelectedLocationId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select a store" />
                  </SelectTrigger>
                  <SelectContent>
                    {workLocations.map((loc) => (
                      <SelectItem key={loc.id} value={loc.id}>{loc.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setAssignLocationUser(null); setSelectedLocationId(""); }}>
              Cancel
            </Button>
            <Button
              className="bg-violet-600 hover:bg-violet-700 text-white"
              disabled={!selectedLocationId || assignLocationMutation.isPending}
              onClick={() => {
                if (assignLocationUser && selectedLocationId) {
                  assignLocationMutation.mutate({ userId: assignLocationUser.id, locationId: selectedLocationId });
                }
              }}
            >
              {assignLocationMutation.isPending ? (
                <><Loader2 className="h-4 w-4 animate-spin mr-1" />Saving...</>
              ) : (
                <><Check className="h-4 w-4 mr-1" />Save</>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!confirmAction} onOpenChange={() => setConfirmAction(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {confirmAction?.type === "deactivate" ? "Deactivate Member" : "Remove Member"}
            </DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            {confirmAction?.type === "deactivate"
              ? `Are you sure you want to deactivate ${confirmAction?.user?.firstName} ${confirmAction?.user?.lastName}? They will no longer be able to access the system.`
              : `Are you sure you want to permanently remove ${confirmAction?.user?.firstName} ${confirmAction?.user?.lastName}? This action cannot be undone.`}
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmAction(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={deactivateMutation.isPending || removeMutation.isPending}
              onClick={() => {
                if (confirmAction?.type === "deactivate") {
                  deactivateMutation.mutate(confirmAction.user.id);
                } else if (confirmAction?.type === "remove") {
                  removeMutation.mutate(confirmAction!.user.id);
                }
              }}
            >
              {(deactivateMutation.isPending || removeMutation.isPending)
                ? "Processing..."
                : confirmAction?.type === "deactivate"
                ? "Deactivate"
                : "Remove"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}