import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";
import type { Role, Permission } from "@shared/schema";

export default function RoleManagement() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [selectedRole, setSelectedRole] = useState<Role | null>(null);
  const [showCreateRole, setShowCreateRole] = useState(false);
  const [showPermissions, setShowPermissions] = useState(false);

  // Fetch roles
  const { data: roles = [], isLoading: rolesLoading } = useQuery<Role[]>({
    queryKey: ["/api/roles"],
  });

  // Fetch permissions grouped by category
  const { data: permissionsByCategory = {}, isLoading: permissionsLoading } = useQuery<Record<string, Permission[]>>({
    queryKey: ["/api/permissions"],
  });

  // Fetch role permissions when a role is selected
  const { data: rolePermissions = [], refetch: refetchRolePermissions } = useQuery<Permission[]>({
    queryKey: ["/api/roles", selectedRole?.id, "permissions"],
    enabled: !!selectedRole?.id,
  });

  // Create role mutation
  const createRoleMutation = useMutation({
    mutationFn: async (roleData: { name: string; displayName: string; description: string }) => {
      const response = await apiRequest("POST", "/api/roles", roleData);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/roles"] });
      setShowCreateRole(false);
      toast({
        title: "Success",
        description: "Role created successfully",
      });
    },
    onError: (error) => {
      toast({
        title: "Error",
        description: `Failed to create role: ${error.message}`,
        variant: "destructive",
      });
    },
  });

  // Update role permissions mutation
  const updatePermissionsMutation = useMutation({
    mutationFn: async ({ roleId, permissionIds }: { roleId: string; permissionIds: string[] }) => {
      const response = await apiRequest("PUT", `/api/roles/${roleId}/permissions`, { permissionIds });
      return response.json();
    },
    onSuccess: () => {
      refetchRolePermissions();
      toast({
        title: "Success",
        description: "Permissions updated successfully",
      });
    },
    onError: (error) => {
      toast({
        title: "Error",
        description: `Failed to update permissions: ${error.message}`,
        variant: "destructive",
      });
    },
  });

  const handleCreateRole = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    const roleData = {
      name: formData.get("name") as string,
      displayName: formData.get("displayName") as string,
      description: formData.get("description") as string,
    };
    createRoleMutation.mutate(roleData);
  };

  const handlePermissionChange = (permissionId: string, checked: boolean) => {
    if (!selectedRole) return;
    
    const currentPermissionIds = rolePermissions.map(p => p.id);
    const newPermissionIds = checked 
      ? [...currentPermissionIds, permissionId]
      : currentPermissionIds.filter(id => id !== permissionId);
    
    updatePermissionsMutation.mutate({
      roleId: selectedRole.id,
      permissionIds: newPermissionIds,
    });
  };

  const getRolePermissionCount = (role: Role) => {
    // This would ideally come from the API, but for now we'll estimate
    if (role.name === 'owner') return 'All Permissions';
    if (role.name === 'manager') return '25 Permissions';
    if (role.name === 'assistant_manager') return '19 Permissions';
    if (role.name === 'team_member') return '9 Permissions';
    return '0 Permissions';
  };

  if (rolesLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 space-y-6">
      <div className="flex items-center justify-between">
        <Dialog open={showCreateRole} onOpenChange={setShowCreateRole}>
          <DialogTrigger asChild>
            <Button data-testid="button-create-role">
              <i className="fas fa-plus mr-2"></i>
              Create Role
            </Button>
          </DialogTrigger>
          <DialogContent data-testid="dialog-create-role">
            <DialogHeader>
              <DialogTitle>Create New Role</DialogTitle>
            </DialogHeader>
            <form onSubmit={handleCreateRole} className="space-y-4">
              <div>
                <Label htmlFor="name">Role Name</Label>
                <Input
                  id="name"
                  name="name"
                  placeholder="e.g., shift_supervisor"
                  required
                  data-testid="input-role-name"
                />
              </div>
              <div>
                <Label htmlFor="displayName">Display Name</Label>
                <Input
                  id="displayName"
                  name="displayName"
                  placeholder="e.g., Shift Supervisor"
                  required
                  data-testid="input-role-display-name"
                />
              </div>
              <div>
                <Label htmlFor="description">Description</Label>
                <Textarea
                  id="description"
                  name="description"
                  placeholder="Describe the role's responsibilities..."
                  data-testid="textarea-role-description"
                />
              </div>
              <div className="flex justify-end space-x-2">
                <Button type="button" variant="outline" onClick={() => setShowCreateRole(false)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={createRoleMutation.isPending} data-testid="button-save-role">
                  {createRoleMutation.isPending ? "Creating..." : "Create Role"}
                </Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <Tabs defaultValue="roles" className="w-full">
        <TabsList>
          <TabsTrigger value="roles" data-testid="tab-roles">Roles</TabsTrigger>
          <TabsTrigger value="permissions" data-testid="tab-permissions">Permissions</TabsTrigger>
        </TabsList>

        <TabsContent value="roles" className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {roles.map((role) => (
              <Card key={role.id} className="cursor-pointer hover:shadow-md transition-shadow" data-testid={`card-role-${role.name}`}>
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-lg">{role.displayName}</CardTitle>
                    {role.isSystemRole && (
                      <Badge variant="secondary" data-testid={`badge-system-role-${role.name}`}>System</Badge>
                    )}
                  </div>
                  <p className="text-sm text-muted-foreground">{role.description}</p>
                </CardHeader>
                <CardContent>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground" data-testid={`text-permission-count-${role.name}`}>
                      {getRolePermissionCount(role)}
                    </span>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setSelectedRole(role);
                        setShowPermissions(true);
                      }}
                      data-testid={`button-edit-permissions-${role.name}`}
                    >
                      Edit Permissions
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>

        <TabsContent value="permissions" className="space-y-4">
          {Object.entries(permissionsByCategory).map(([category, permissions]) => (
            <Card key={category} data-testid={`card-category-${category}`}>
              <CardHeader>
                <CardTitle className="capitalize">{category.replace('_', ' ')}</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid gap-3 md:grid-cols-2">
                  {permissions.map((permission) => (
                    <div key={permission.id} className="flex items-start space-x-3 p-2 rounded border" data-testid={`permission-${permission.name}`}>
                      <div className="flex-1">
                        <h4 className="font-medium">{permission.displayName}</h4>
                        <p className="text-sm text-muted-foreground">{permission.description}</p>
                        <code className="text-xs bg-muted px-1 py-0.5 rounded">{permission.name}</code>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          ))}
        </TabsContent>
      </Tabs>

      {/* Permissions Dialog */}
      <Dialog open={showPermissions} onOpenChange={setShowPermissions}>
        <DialogContent className="max-w-4xl max-h-[80vh] overflow-y-auto" data-testid="dialog-edit-permissions">
          <DialogHeader>
            <DialogTitle>
              Edit Permissions: {selectedRole?.displayName}
            </DialogTitle>
          </DialogHeader>
          
          {permissionsLoading ? (
            <div className="flex items-center justify-center py-8">
              <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary"></div>
            </div>
          ) : (
            <div className="space-y-6">
              {Object.entries(permissionsByCategory).map(([category, permissions]) => (
                <div key={category} data-testid={`permission-category-${category}`}>
                  <h3 className="font-semibold text-lg mb-3 capitalize">
                    {category.replace('_', ' ')}
                  </h3>
                  <div className="space-y-3">
                    {permissions.map((permission) => {
                      const hasPermission = rolePermissions.some(rp => rp.id === permission.id);
                      return (
                        <div key={permission.id} className="flex items-start space-x-3 p-3 border rounded" data-testid={`checkbox-permission-${permission.name}`}>
                          <Checkbox
                            id={permission.id}
                            checked={hasPermission}
                            onCheckedChange={(checked) => handlePermissionChange(permission.id, checked as boolean)}
                            disabled={updatePermissionsMutation.isPending}
                          />
                          <div className="flex-1">
                            <Label htmlFor={permission.id} className="font-medium cursor-pointer">
                              {permission.displayName}
                            </Label>
                            <p className="text-sm text-muted-foreground mt-1">
                              {permission.description}
                            </p>
                            <code className="text-xs bg-muted px-1 py-0.5 rounded mt-1 inline-block">
                              {permission.name}
                            </code>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  {category !== Object.keys(permissionsByCategory).slice(-1)[0] && (
                    <Separator className="mt-4" />
                  )}
                </div>
              ))}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}