import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useIsMobile } from "@/hooks/use-mobile";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import type { User, Role, Permission } from "@shared/schema";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Separator } from "@/components/ui/separator";
import {
  Search,
  Plus,
  MoreVertical,
  Eye,
  UserMinus,
  Trash2,
  Mail,
  ChevronDown,
  Users,
  Loader2,
  AlertTriangle,
} from "lucide-react";

const ROLE_COLORS: Record<string, string> = {
  owner: "bg-purple-500 text-white hover:bg-purple-600",
  admin: "bg-blue-500 text-white hover:bg-blue-600",
  manager: "bg-blue-500 text-white hover:bg-blue-600",
  assistant_manager: "bg-green-500 text-white hover:bg-green-600",
  team_member: "bg-gray-500 text-white hover:bg-gray-600",
  employee: "bg-gray-500 text-white hover:bg-gray-600",
};

function getRoleBadgeClass(roleName?: string) {
  return ROLE_COLORS[roleName || ""] || "bg-gray-500 text-white hover:bg-gray-600";
}

function getInitials(firstName?: string | null, lastName?: string | null) {
  return `${firstName?.[0] || ""}${lastName?.[0] || ""}`.toUpperCase() || "?";
}

export default function Team() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const isMobile = useIsMobile();
  const { user: currentUser } = useAuth();

  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("active");
  const [selectedMember, setSelectedMember] = useState<User | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [confirmAction, setConfirmAction] = useState<{
    type: "deactivate" | "remove";
    user: User;
  } | null>(null);
  const [editingPayRate, setEditingPayRate] = useState<string | null>(null);
  const [payRateValue, setPayRateValue] = useState("");

  const { data: members = [], isLoading, error } = useQuery<User[]>({
    queryKey: ["/api/users"],
  });

  const { data: roles = [] } = useQuery<Role[]>({
    queryKey: ["/api/roles"],
  });

  const { data: permissions = [] } = useQuery<Permission[]>({
    queryKey: ["/api/auth/permissions"],
    enabled: !!currentUser,
  });

  const isAdminRole = currentUser?.role?.name === 'owner' || currentUser?.role?.name === 'admin';
  const can = (perm: string) =>
    permissions?.some?.((p) => p.name === perm || p.name === "admin.manage_all") || isAdminRole || false;

  const canManageEmployees = can("hr.edit_team");
  const canEditRoles = can("admin.role_management");
  const canViewPayRates = can("hr.view_team");
  const canEditPayRates = can("hr.edit_team");

  const addMemberMutation = useMutation({
    mutationFn: async (data: Record<string, string>) => {
      const res = await apiRequest("POST", "/api/users", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/users"] });
      setAddDialogOpen(false);
      toast({ title: "Member added", description: "New team member has been added successfully." });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

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

  const deactivateMutation = useMutation({
    mutationFn: async (userId: string) => {
      const res = await apiRequest("PUT", `/api/users/${userId}`, { isActive: false });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/users"] });
      setConfirmAction(null);
      setSheetOpen(false);
      setSelectedMember(null);
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
      setSheetOpen(false);
      setSelectedMember(null);
      toast({ title: "Member removed", description: "Team member has been permanently removed." });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const filtered = useMemo(() => {
    let list = members;
    if (statusFilter === "active") list = list.filter((m) => m.isActive !== false);
    else if (statusFilter === "inactive") list = list.filter((m) => m.isActive === false);
    if (roleFilter !== "all") list = list.filter((m) => m.roleId === roleFilter);
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
    return list;
  }, [members, search, roleFilter, statusFilter]);

  const roleMap = useMemo(() => {
    const map: Record<string, Role> = {};
    roles.forEach((r) => (map[r.id] = r));
    return map;
  }, [roles]);

  const openProfile = (member: User) => {
    setSelectedMember(member);
    setSheetOpen(true);
  };

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
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
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
    <div className="space-y-4 p-4 lg:p-6">
      {/* Search & Filter Bar */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search by name or email..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <div className="flex gap-2 flex-wrap">
          <Select value={roleFilter} onValueChange={setRoleFilter}>
            <SelectTrigger className="w-[160px]">
              <SelectValue placeholder="All Roles" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Roles</SelectItem>
              {roles.map((r) => (
                <SelectItem key={r.id} value={r.id}>
                  {r.displayName}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-[130px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="active">Active</SelectItem>
              <SelectItem value="inactive">Inactive</SelectItem>
            </SelectContent>
          </Select>
          {canManageEmployees && (
            <Button onClick={() => setAddDialogOpen(true)}>
              <Plus className="h-4 w-4 mr-1" />
              Add Member
            </Button>
          )}
        </div>
      </div>

      {/* Member count */}
      <p className="text-sm text-muted-foreground">
        {filtered.length} member{filtered.length !== 1 ? "s" : ""}
      </p>

      {/* Empty state */}
      {filtered.length === 0 && (
        <div className="flex flex-col items-center py-16 gap-3">
          <Users className="h-12 w-12 text-muted-foreground/50" />
          <p className="text-muted-foreground">No team members found.</p>
          {search || roleFilter !== "all" || statusFilter !== "all" ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => { setSearch(""); setRoleFilter("all"); setStatusFilter("active"); }}
            >
              Clear filters
            </Button>
          ) : null}
        </div>
      )}

      {/* Desktop Table */}
      {!isMobile && filtered.length > 0 && (
        <div className="rounded-lg border bg-card overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/50">
                <th className="text-left p-3 font-medium">Member</th>
                <th className="text-left p-3 font-medium">Email</th>
                <th className="text-left p-3 font-medium">Role</th>
                {canViewPayRates && <th className="text-left p-3 font-medium">Pay Rate</th>}
                <th className="text-left p-3 font-medium">Status</th>
                <th className="text-right p-3 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((member) => {
                const role = member.roleId ? roleMap[member.roleId] : null;
                return (
                  <tr
                    key={member.id}
                    className="border-b last:border-0 hover:bg-muted/30 cursor-pointer transition-colors"
                    onClick={() => openProfile(member)}
                  >
                    <td className="p-3">
                      <div className="flex items-center gap-3">
                        <Avatar className="h-9 w-9">
                          <AvatarImage src={member.profileImageUrl || undefined} />
                          <AvatarFallback className="text-xs">
                            {getInitials(member.firstName, member.lastName)}
                          </AvatarFallback>
                        </Avatar>
                        <span className="font-medium">
                          {member.firstName} {member.lastName}
                        </span>
                      </div>
                    </td>
                    <td className="p-3 text-muted-foreground">{member.email}</td>
                    <td className="p-3" onClick={(e) => e.stopPropagation()}>
                      {canEditRoles && roles.length > 0 ? (
                        <Select
                          value={member.roleId || ""}
                          onValueChange={(val) => updateRoleMutation.mutate({ userId: member.id, roleId: val })}
                        >
                          <SelectTrigger className="w-[150px] h-8 text-xs">
                            <SelectValue placeholder="Assign role" />
                          </SelectTrigger>
                          <SelectContent>
                            {roles.map((r) => (
                              <SelectItem key={r.id} value={r.id}>{r.displayName}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      ) : role ? (
                        <Badge className={getRoleBadgeClass(role.name)}>{role.displayName}</Badge>
                      ) : (
                        <span className="text-muted-foreground text-xs">Unassigned</span>
                      )}
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
                              className="text-left hover:underline"
                              onClick={() => {
                                setEditingPayRate(member.id);
                                setPayRateValue(member.hourlyRate || "");
                              }}
                            >
                              {member.hourlyRate ? `$${member.hourlyRate}/hr` : "—"}
                            </button>
                          )
                        ) : (
                          <span>{member.hourlyRate ? `$${member.hourlyRate}/hr` : "—"}</span>
                        )}
                      </td>
                    )}
                    <td className="p-3">
                      {member.isActive !== false ? (
                        <Badge variant="outline" className="border-green-500 text-green-600">Active</Badge>
                      ) : (
                        <Badge variant="outline" className="border-gray-400 text-gray-500">Inactive</Badge>
                      )}
                    </td>
                    <td className="p-3 text-right" onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center justify-end gap-1">
                        <Button variant="ghost" size="sm" onClick={() => openProfile(member)}>
                          <Eye className="h-4 w-4" />
                        </Button>
                        {canManageEmployees && (
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="sm">
                                <MoreVertical className="h-4 w-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              {member.isActive !== false && (
                                <DropdownMenuItem
                                  onClick={() => setConfirmAction({ type: "deactivate", user: member })}
                                >
                                  <UserMinus className="h-4 w-4 mr-2" />
                                  Deactivate
                                </DropdownMenuItem>
                              )}
                              <DropdownMenuItem
                                className="text-destructive focus:text-destructive"
                                onClick={() => setConfirmAction({ type: "remove", user: member })}
                              >
                                <Trash2 className="h-4 w-4 mr-2" />
                                Remove
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
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

      {/* Mobile Cards */}
      {isMobile && filtered.length > 0 && (
        <div className="space-y-3">
          {filtered.map((member) => {
            const role = member.roleId ? roleMap[member.roleId] : null;
            return (
              <Card
                key={member.id}
                className="cursor-pointer hover:shadow-md transition-shadow"
                onClick={() => openProfile(member)}
              >
                <CardContent className="p-4">
                  <div className="flex items-center gap-3">
                    <Avatar className="h-11 w-11">
                      <AvatarImage src={member.profileImageUrl || undefined} />
                      <AvatarFallback>{getInitials(member.firstName, member.lastName)}</AvatarFallback>
                    </Avatar>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium truncate">
                        {member.firstName} {member.lastName}
                      </p>
                      <p className="text-xs text-muted-foreground truncate">{member.email}</p>
                    </div>
                    <div className="flex flex-col items-end gap-1">
                      {role && (
                        <Badge className={`text-xs ${getRoleBadgeClass(role.name)}`}>
                          {role.displayName}
                        </Badge>
                      )}
                      {member.isActive !== false ? (
                        <Badge variant="outline" className="text-xs border-green-500 text-green-600">Active</Badge>
                      ) : (
                        <Badge variant="outline" className="text-xs border-gray-400 text-gray-500">Inactive</Badge>
                      )}
                    </div>
                  </div>
                  {canViewPayRates && member.hourlyRate && (
                    <p className="text-xs text-muted-foreground mt-2 ml-14">
                      ${member.hourlyRate}/hr
                    </p>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Profile Slide-out */}
      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetContent side="right" className="w-full sm:max-w-md overflow-y-auto">
          {selectedMember && (
            <>
              <SheetHeader>
                <SheetTitle>Member Profile</SheetTitle>
              </SheetHeader>
              <div className="mt-6 space-y-6">
                <div className="flex flex-col items-center gap-3">
                  <Avatar className="h-20 w-20">
                    <AvatarImage src={selectedMember.profileImageUrl || undefined} />
                    <AvatarFallback className="text-xl">
                      {getInitials(selectedMember.firstName, selectedMember.lastName)}
                    </AvatarFallback>
                  </Avatar>
                  <div className="text-center">
                    <h3 className="text-lg font-semibold">
                      {selectedMember.firstName} {selectedMember.lastName}
                    </h3>
                    <p className="text-sm text-muted-foreground">{selectedMember.email}</p>
                  </div>
                </div>

                <Separator />

                <div className="space-y-4">
                  <div>
                    <Label className="text-xs text-muted-foreground uppercase tracking-wide">Role</Label>
                    {canEditRoles && roles.length > 0 ? (
                      <Select
                        value={selectedMember.roleId || ""}
                        onValueChange={(val) => {
                          updateRoleMutation.mutate({ userId: selectedMember.id, roleId: val });
                          setSelectedMember({ ...selectedMember, roleId: val });
                        }}
                      >
                        <SelectTrigger className="mt-1">
                          <SelectValue placeholder="Assign role" />
                        </SelectTrigger>
                        <SelectContent>
                          {roles.map((r) => (
                            <SelectItem key={r.id} value={r.id}>{r.displayName}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : (
                      <p className="mt-1 font-medium">
                        {selectedMember.roleId && roleMap[selectedMember.roleId]
                          ? roleMap[selectedMember.roleId].displayName
                          : "Unassigned"}
                      </p>
                    )}
                  </div>

                  {canViewPayRates && (
                    <div>
                      <Label className="text-xs text-muted-foreground uppercase tracking-wide">
                        Pay Rate
                      </Label>
                      {canEditPayRates ? (
                        <div className="flex items-center gap-2 mt-1">
                          <span className="text-sm">$</span>
                          <Input
                            type="number"
                            step="0.01"
                            defaultValue={selectedMember.hourlyRate || ""}
                            className="w-28"
                            onBlur={(e) => {
                              const val = e.target.value;
                              if (val && val !== selectedMember.hourlyRate) {
                                updatePayRateMutation.mutate({
                                  userId: selectedMember.id,
                                  hourlyRate: val,
                                });
                              }
                            }}
                          />
                          <span className="text-sm text-muted-foreground">/hr</span>
                        </div>
                      ) : (
                        <p className="mt-1 font-medium">
                          {selectedMember.hourlyRate ? `$${selectedMember.hourlyRate}/hr` : "—"}
                        </p>
                      )}
                    </div>
                  )}

                  <div>
                    <Label className="text-xs text-muted-foreground uppercase tracking-wide">
                      Joined
                    </Label>
                    <p className="mt-1 font-medium">
                      {selectedMember.createdAt
                        ? new Date(selectedMember.createdAt).toLocaleDateString("en-US", {
                            year: "numeric",
                            month: "long",
                            day: "numeric",
                          })
                        : "—"}
                    </p>
                  </div>

                  <div>
                    <Label className="text-xs text-muted-foreground uppercase tracking-wide">
                      Status
                    </Label>
                    <div className="mt-1">
                      {selectedMember.isActive !== false ? (
                        <Badge variant="outline" className="border-green-500 text-green-600">Active</Badge>
                      ) : (
                        <Badge variant="outline" className="border-gray-400 text-gray-500">Inactive</Badge>
                      )}
                    </div>
                  </div>
                </div>

                <Separator />

                <div className="space-y-2">
                  <Button variant="outline" className="w-full justify-start" asChild>
                    <a href={`mailto:${selectedMember.email}`}>
                      <Mail className="h-4 w-4 mr-2" />
                      Send Message
                    </a>
                  </Button>
                  {canManageEmployees && selectedMember.isActive !== false && (
                    <Button
                      variant="outline"
                      className="w-full justify-start"
                      onClick={() => setConfirmAction({ type: "deactivate", user: selectedMember })}
                    >
                      <UserMinus className="h-4 w-4 mr-2" />
                      Deactivate
                    </Button>
                  )}
                  {canManageEmployees && (
                    <Button
                      variant="destructive"
                      className="w-full justify-start"
                      onClick={() => setConfirmAction({ type: "remove", user: selectedMember })}
                    >
                      <Trash2 className="h-4 w-4 mr-2" />
                      Remove
                    </Button>
                  )}
                </div>
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>

      {/* Add Member Dialog */}
      <Dialog open={addDialogOpen} onOpenChange={setAddDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Team Member</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleAddSubmit} className="space-y-4">
            <div>
              <Label htmlFor="add-email">Email *</Label>
              <Input id="add-email" name="email" type="email" required placeholder="member@company.com" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="add-fn">First Name</Label>
                <Input id="add-fn" name="firstName" placeholder="Jane" />
              </div>
              <div>
                <Label htmlFor="add-ln">Last Name</Label>
                <Input id="add-ln" name="lastName" placeholder="Doe" />
              </div>
            </div>
            <div>
              <Label htmlFor="add-role">Role</Label>
              <Select name="roleId">
                <SelectTrigger>
                  <SelectValue placeholder="Select a role" />
                </SelectTrigger>
                <SelectContent>
                  {roles.map((r) => (
                    <SelectItem key={r.id} value={r.id}>{r.displayName}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="add-rate">Hourly Rate ($)</Label>
              <Input id="add-rate" name="hourlyRate" type="number" step="0.01" min="0" placeholder="0.00" />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setAddDialogOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={addMemberMutation.isPending}>
                {addMemberMutation.isPending && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
                Add Member
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Confirmation Dialog */}
      <Dialog open={!!confirmAction} onOpenChange={(open) => !open && setConfirmAction(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {confirmAction?.type === "deactivate" ? "Deactivate Member" : "Remove Member"}
            </DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            {confirmAction?.type === "deactivate"
              ? `Are you sure you want to deactivate ${confirmAction.user.firstName} ${confirmAction.user.lastName}? They will no longer be able to access the system.`
              : `Are you sure you want to permanently remove ${confirmAction?.user.firstName} ${confirmAction?.user.lastName}? This action cannot be undone.`}
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmAction(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={deactivateMutation.isPending || removeMutation.isPending}
              onClick={() => {
                if (!confirmAction) return;
                if (confirmAction.type === "deactivate") {
                  deactivateMutation.mutate(confirmAction.user.id);
                } else {
                  removeMutation.mutate(confirmAction.user.id);
                }
              }}
            >
              {(deactivateMutation.isPending || removeMutation.isPending) && (
                <Loader2 className="h-4 w-4 mr-1 animate-spin" />
              )}
              {confirmAction?.type === "deactivate" ? "Deactivate" : "Remove"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
