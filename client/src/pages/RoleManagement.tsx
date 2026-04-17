import { useState, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useIsMobile } from "@/hooks/use-mobile";
import type { Role, Permission } from "@shared/schema";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Clock,
  Calendar,
  Users,
  Shield,
  MessageSquare,
  DollarSign,
  Sparkles,
  Plus,
  Loader2,
  AlertCircle,
  Copy,
  Zap,
  ShoppingBag,
} from "lucide-react";

const CATEGORY_META: Record<string, { label: string; icon: typeof Clock }> = {
  time_tracking: { label: "Time & Attendance", icon: Clock },
  time: { label: "Time & Attendance", icon: Clock },
  scheduling: { label: "Scheduling", icon: Calendar },
  schedule: { label: "Scheduling", icon: Calendar },
  hr: { label: "HR & People", icon: Users },
  admin: { label: "Administration", icon: Shield },
  communication: { label: "Communication", icon: MessageSquare },
  tasks: { label: "Task Management", icon: Zap },
  payroll: { label: "Payroll", icon: DollarSign },
  ai: { label: "AI Features", icon: Sparkles },
  sales: { label: "Sales & Revenue", icon: ShoppingBag },
};

const ROLE_PRESETS: Record<string, { label: string; description: string; categories: Record<string, boolean> }> = {
  basic_employee: {
    label: "Basic Employee",
    description: "View own schedule, clock in/out, basic communication",
    categories: { time_tracking: true },
  },
  shift_lead: {
    label: "Shift Lead",
    description: "Employee permissions plus team scheduling and basic HR views",
    categories: { time_tracking: true, scheduling: true, communication: true },
  },
  manager: {
    label: "Manager",
    description: "Full scheduling, HR management, payroll views, and team communication",
    categories: { time_tracking: true, scheduling: true, hr: true, communication: true, payroll: true },
  },
  full_admin: {
    label: "Full Admin",
    description: "All permissions across every category",
    categories: { time_tracking: true, scheduling: true, hr: true, admin: true, communication: true, payroll: true, ai: true },
  },
};

export default function RoleManagement() {
  const { toast } = useToast();
  const isMobile = useIsMobile();

  const [selectedRoleId, setSelectedRoleId] = useState<string | null>(null);
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [showPresetDialog, setShowPresetDialog] = useState(false);
  const [pendingPreset, setPendingPreset] = useState<string | null>(null);
  const [cloneFromRoleId, setCloneFromRoleId] = useState<string>("none");
  const [pendingCells, setPendingCells] = useState<Set<string>>(new Set());
  const [mobileSelectedRole, setMobileSelectedRole] = useState<string | null>(null);

  const { data: roles = [], isLoading: rolesLoading, error: rolesError } = useQuery<Role[]>({
    queryKey: ["/api/roles"],
  });

  const { data: permissionsByCategory = {}, isLoading: permissionsLoading, error: permissionsError } = useQuery<Record<string, Permission[]>>({
    queryKey: ["/api/permissions"],
  });

  const allRolePermissions = useQuery<Record<string, string[]>>({
    queryKey: ["/api/roles/all-permissions"],
    enabled: roles.length > 0,
  });

  const rolePermsMap = allRolePermissions.data ?? {};

  const allPermissions = useMemo(() => {
    const result: { category: string; permissions: Permission[] }[] = [];
    for (const [category, perms] of Object.entries(permissionsByCategory)) {
      result.push({ category, permissions: perms });
    }
    return result;
  }, [permissionsByCategory]);

  const totalPermissionCount = useMemo(() => {
    let count = 0;
    for (const perms of Object.values(permissionsByCategory)) {
      count += perms.length;
    }
    return count;
  }, [permissionsByCategory]);

  const getRolePermissionCount = (roleId: string) => {
    return rolePermsMap[roleId]?.length ?? 0;
  };

  const selectedRole = roles.find((r) => r.id === selectedRoleId) ?? null;

  const createRoleMutation = useMutation({
    mutationFn: async (roleData: { name: string; displayName: string; description: string; cloneFromRoleId?: string }) => {
      const { cloneFromRoleId: cloneId, ...data } = roleData;
      const response = await apiRequest("POST", "/api/roles", data);
      const newRole = await response.json();
      if (cloneId && cloneId !== "none" && rolePermsMap[cloneId]) {
        await apiRequest("PUT", `/api/roles/${newRole.id}/permissions`, {
          permissionIds: rolePermsMap[cloneId],
        });
      }
      return newRole;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/roles"] });
      queryClient.invalidateQueries({ queryKey: ["/api/roles/all-permissions"] });
      setShowCreateDialog(false);
      setCloneFromRoleId("none");
      toast({ title: "Role created", description: "New role has been created successfully." });
    },
    onError: (error) => {
      toast({ title: "Error", description: `Failed to create role: ${error.message}`, variant: "destructive" });
    },
  });

  const updatePermissionsMutation = useMutation({
    mutationFn: async ({ roleId, permissionIds }: { roleId: string; permissionIds: string[] }) => {
      const response = await apiRequest("PUT", `/api/roles/${roleId}/permissions`, { permissionIds });
      return response.json();
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ["/api/roles/all-permissions"] });
      setPendingCells(new Set());
    },
    onError: (error) => {
      setPendingCells(new Set());
      toast({ title: "Error", description: `Failed to update permissions: ${error.message}`, variant: "destructive" });
    },
  });

  const handleTogglePermission = (roleId: string, permissionId: string) => {
    const current = rolePermsMap[roleId] ?? [];
    const has = current.includes(permissionId);
    const newIds = has ? current.filter((id) => id !== permissionId) : [...current, permissionId];

    const cellKey = `${roleId}-${permissionId}`;
    setPendingCells((prev) => new Set(prev).add(cellKey));

    updatePermissionsMutation.mutate({ roleId, permissionIds: newIds });
  };

  const handleApplyPreset = () => {
    if (!pendingPreset || !selectedRoleId) return;
    const preset = ROLE_PRESETS[pendingPreset];
    if (!preset) return;

    const newPermissionIds: string[] = [];
    for (const [category, perms] of Object.entries(permissionsByCategory)) {
      if (preset.categories[category]) {
        newPermissionIds.push(...perms.map((p) => p.id));
      }
    }

    updatePermissionsMutation.mutate(
      { roleId: selectedRoleId, permissionIds: newPermissionIds },
      {
        onSuccess: () => {
          toast({ title: "Preset applied", description: `"${preset.label}" permissions have been applied.` });
          setShowPresetDialog(false);
          setPendingPreset(null);
        },
      }
    );
  };

  const handleCreateRole = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    createRoleMutation.mutate({
      name: formData.get("name") as string,
      displayName: formData.get("displayName") as string,
      description: formData.get("description") as string,
      cloneFromRoleId: cloneFromRoleId,
    });
  };

  if (rolesLoading || permissionsLoading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <p className="text-sm text-muted-foreground">Loading roles and permissions…</p>
        </div>
      </div>
    );
  }

  if (rolesError || permissionsError) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="flex flex-col items-center gap-3 text-center">
          <AlertCircle className="h-8 w-8 text-destructive" />
          <p className="text-sm text-destructive">Failed to load data. Please try refreshing.</p>
        </div>
      </div>
    );
  }

  if (roles.length === 0) {
    return (
      <div className="p-4 md:p-6 flex flex-col items-center justify-center min-h-[60vh] gap-4">
        <Shield className="h-12 w-12 text-muted-foreground" />
        <p className="text-muted-foreground">No roles configured yet.</p>
        <Button onClick={() => setShowCreateDialog(true)}>
          <Plus className="h-4 w-4 mr-2" />
          Create First Role
        </Button>
      </div>
    );
  }

  const mobileViewRole = roles.find((r) => r.id === mobileSelectedRole) ?? null;

  return (
    <TooltipProvider>
      <div className="p-4 md:p-6 space-y-6">
        {/* Role Cards */}
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-lg font-semibold text-muted-foreground">
            {roles.length} Role{roles.length !== 1 ? "s" : ""}
          </h2>
          <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
            <DialogTrigger asChild>
              <Button size="sm">
                <Plus className="h-4 w-4 mr-2" />
                Create Role
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Create New Role</DialogTitle>
              </DialogHeader>
              <form onSubmit={handleCreateRole} className="space-y-4">
                <div>
                  <Label htmlFor="name">Name (slug)</Label>
                  <Input id="name" name="name" placeholder="e.g., shift_supervisor" required pattern="[a-z0-9_]+" title="Lowercase letters, numbers, and underscores only" />
                </div>
                <div>
                  <Label htmlFor="displayName">Display Name</Label>
                  <Input id="displayName" name="displayName" placeholder="e.g., Shift Supervisor" required />
                </div>
                <div>
                  <Label htmlFor="description">Description</Label>
                  <Textarea id="description" name="description" placeholder="Describe the role's responsibilities…" />
                </div>
                <div>
                  <Label>Clone permissions from</Label>
                  <Select value={cloneFromRoleId} onValueChange={setCloneFromRoleId}>
                    <SelectTrigger>
                      <SelectValue placeholder="None (start empty)" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">None (start empty)</SelectItem>
                      {roles.map((r) => (
                        <SelectItem key={r.id} value={r.id}>
                          <span className="flex items-center gap-2">
                            <Copy className="h-3 w-3" />
                            {r.displayName}
                          </span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <DialogFooter>
                  <Button type="button" variant="outline" onClick={() => setShowCreateDialog(false)}>
                    Cancel
                  </Button>
                  <Button type="submit" disabled={createRoleMutation.isPending}>
                    {createRoleMutation.isPending ? (
                      <>
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        Creating…
                      </>
                    ) : (
                      "Create Role"
                    )}
                  </Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        </div>

        <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">
          {roles.map((role) => {
            const isSelected = selectedRoleId === role.id;
            const permCount = getRolePermissionCount(role.id);
            return (
              <Card
                key={role.id}
                className={`cursor-pointer transition-all hover:shadow-md ${isSelected ? "ring-2 ring-primary shadow-md" : ""}`}
                onClick={() => {
                  setSelectedRoleId(isSelected ? null : role.id);
                  if (isMobile) setMobileSelectedRole(isSelected ? null : role.id);
                }}
              >
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-base">{role.displayName}</CardTitle>
                    {role.isSystemRole && <Badge variant="secondary">System</Badge>}
                  </div>
                </CardHeader>
                <CardContent className="pt-0">
                  <p className="text-xs text-muted-foreground line-clamp-2 mb-2">{role.description}</p>
                  <Badge variant="outline" className="text-xs">
                    {permCount} / {totalPermissionCount} permissions
                  </Badge>
                </CardContent>
              </Card>
            );
          })}
        </div>

        {/* Role Presets */}
        {selectedRoleId && (
          <>
            <Separator />
            <div>
              <h3 className="text-sm font-medium text-muted-foreground mb-3 flex items-center gap-2">
                <Zap className="h-4 w-4" />
                Quick Presets for {selectedRole?.displayName}
              </h3>
              <div className="flex flex-wrap gap-2">
                {Object.entries(ROLE_PRESETS).map(([key, preset]) => (
                  <Tooltip key={key}>
                    <TooltipTrigger asChild>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          setPendingPreset(key);
                          setShowPresetDialog(true);
                        }}
                      >
                        {preset.label}
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>
                      <p className="max-w-xs">{preset.description}</p>
                    </TooltipContent>
                  </Tooltip>
                ))}
              </div>
            </div>
          </>
        )}

        {/* Preset Confirmation Dialog */}
        <Dialog open={showPresetDialog} onOpenChange={setShowPresetDialog}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Apply Preset</DialogTitle>
            </DialogHeader>
            {pendingPreset && ROLE_PRESETS[pendingPreset] && (
              <div className="space-y-3">
                <p className="text-sm text-muted-foreground">
                  This will replace all current permissions for <strong>{selectedRole?.displayName}</strong> with the <strong>{ROLE_PRESETS[pendingPreset].label}</strong> preset.
                </p>
                <p className="text-sm text-muted-foreground">{ROLE_PRESETS[pendingPreset].description}</p>
              </div>
            )}
            <DialogFooter>
              <Button variant="outline" onClick={() => setShowPresetDialog(false)}>
                Cancel
              </Button>
              <Button onClick={handleApplyPreset} disabled={updatePermissionsMutation.isPending}>
                {updatePermissionsMutation.isPending ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Applying…
                  </>
                ) : (
                  "Apply Preset"
                )}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Separator />

        {/* Permission Matrix */}
        {isMobile ? (
          <MobilePermissionView
            roles={roles}
            allPermissions={allPermissions}
            rolePermsMap={rolePermsMap}
            pendingCells={pendingCells}
            selectedRoleId={mobileSelectedRole}
            onSelectRole={setMobileSelectedRole}
            onToggle={handleTogglePermission}
          />
        ) : (
          <div className="border rounded-lg overflow-auto max-h-[60vh]">
            <table className="w-full border-collapse text-sm">
              <thead className="sticky top-0 z-10 bg-background">
                <tr>
                  <th className="text-left p-3 border-b border-r font-medium text-muted-foreground min-w-[250px] sticky left-0 bg-background z-20">
                    Permission
                  </th>
                  {roles.map((role) => {
                    const isActive = selectedRoleId === role.id;
                    return (
                      <th
                        key={role.id}
                        className={`p-3 border-b border-r text-center font-medium min-w-[100px] cursor-pointer transition-colors ${isActive ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted/50"}`}
                        onClick={() => setSelectedRoleId(isActive ? null : role.id)}
                      >
                        <div className="flex flex-col items-center gap-1">
                          <span className="text-xs leading-tight">{role.displayName}</span>
                          {role.isSystemRole && <Badge variant="secondary" className="text-[10px] px-1 py-0">System</Badge>}
                        </div>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {allPermissions.map(({ category, permissions }) => {
                  const meta = CATEGORY_META[category] ?? { label: category.replace(/_/g, " "), icon: Shield };
                  const Icon = meta.icon;
                  return (
                    <>
                      <tr key={`cat-${category}`} className="bg-muted/30">
                        <td colSpan={roles.length + 1} className="p-2 pl-3 border-b sticky left-0 bg-muted/30">
                          <div className="flex items-center gap-2 font-semibold text-sm">
                            <Icon className="h-4 w-4 text-muted-foreground" />
                            {meta.label}
                            <Badge variant="outline" className="text-[10px] ml-1">{permissions.length}</Badge>
                          </div>
                        </td>
                      </tr>
                      {permissions.map((perm, idx) => (
                        <tr key={perm.id} className={idx % 2 === 0 ? "bg-background" : "bg-muted/10"}>
                          <td className="p-2 pl-6 border-b border-r sticky left-0 bg-inherit" title={perm.description ?? ""}>
                            <span className="font-medium text-foreground">{perm.displayName}</span>
                          </td>
                          {roles.map((role) => {
                            const cellKey = `${role.id}-${perm.id}`;
                            const hasPermission = (rolePermsMap[role.id] ?? []).includes(perm.id);
                            const isPending = pendingCells.has(cellKey);
                            const isActiveCol = selectedRoleId === role.id;
                            return (
                              <td
                                key={cellKey}
                                className={`p-2 border-b border-r text-center ${isActiveCol ? "bg-primary/5" : ""}`}
                              >
                                {isPending ? (
                                  <Loader2 className="h-4 w-4 animate-spin mx-auto text-muted-foreground" />
                                ) : (
                                  <Checkbox
                                    checked={hasPermission}
                                    onCheckedChange={() => handleTogglePermission(role.id, perm.id)}
                                    className="mx-auto"
                                  />
                                )}
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </TooltipProvider>
  );
}

function MobilePermissionView({
  roles,
  allPermissions,
  rolePermsMap,
  pendingCells,
  selectedRoleId,
  onSelectRole,
  onToggle,
}: {
  roles: Role[];
  allPermissions: { category: string; permissions: Permission[] }[];
  rolePermsMap: Record<string, string[]>;
  pendingCells: Set<string>;
  selectedRoleId: string | null;
  onSelectRole: (id: string | null) => void;
  onToggle: (roleId: string, permissionId: string) => void;
}) {
  const selectedRole = roles.find((r) => r.id === selectedRoleId) ?? null;

  return (
    <div className="space-y-4">
      <div>
        <Label className="text-sm font-medium">Select a role to manage</Label>
        <Select value={selectedRoleId ?? "none"} onValueChange={(v) => onSelectRole(v === "none" ? null : v)}>
          <SelectTrigger className="mt-1">
            <SelectValue placeholder="Choose a role…" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">Choose a role…</SelectItem>
            {roles.map((r) => (
              <SelectItem key={r.id} value={r.id}>
                {r.displayName}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {selectedRole && (
        <div className="space-y-4">
          {allPermissions.map(({ category, permissions }) => {
            const meta = CATEGORY_META[category] ?? { label: category.replace(/_/g, " "), icon: Shield };
            const Icon = meta.icon;
            return (
              <Card key={category}>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <Icon className="h-4 w-4" />
                    {meta.label}
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  {permissions.map((perm) => {
                    const cellKey = `${selectedRole.id}-${perm.id}`;
                    const hasPermission = (rolePermsMap[selectedRole.id] ?? []).includes(perm.id);
                    const isPending = pendingCells.has(cellKey);
                    return (
                      <div key={perm.id} className="flex items-center gap-3 p-2 rounded border">
                        {isPending ? (
                          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground shrink-0" />
                        ) : (
                          <Checkbox
                            checked={hasPermission}
                            onCheckedChange={() => onToggle(selectedRole.id, perm.id)}
                            className="shrink-0"
                          />
                        )}
                        <div className="min-w-0">
                          <p className="text-sm font-medium truncate" title={perm.description ?? ""}>
                            {perm.displayName}
                          </p>
                        </div>
                      </div>
                    );
                  })}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
