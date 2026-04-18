import { useMemo, useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { apiRequest, queryClient } from '@/lib/queryClient';
import { useLocation } from 'wouter';
import { useToast } from '@/hooks/use-toast';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Shield, ExternalLink, ShoppingBag, Loader2 } from 'lucide-react';
import type { Role, Permission } from '@shared/schema';

export default function TeamPermissionsSection() {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const [pendingToggles, setPendingToggles] = useState<Set<string>>(new Set());

  const { data: roles = [], isLoading: rolesLoading } = useQuery<Role[]>({
    queryKey: ['/api/roles'],
  });

  const { data: permissionsByCategory = {}, isLoading: permissionsLoading } = useQuery<Record<string, Permission[]>>({
    queryKey: ['/api/permissions'],
  });

  const { data: allRolePerms = {}, isLoading: rolePermsLoading } = useQuery<Record<string, string[]>>({
    queryKey: ['/api/roles/all-permissions'],
    enabled: roles.length > 0,
  });

  const salesViewPermissionId = useMemo(() => {
    const salesPerms = permissionsByCategory['sales'] ?? [];
    return salesPerms.find(p => p.name === 'sales.view')?.id ?? null;
  }, [permissionsByCategory]);

  const updatePermissionsMutation = useMutation({
    mutationFn: async ({ roleId, permissionIds }: { roleId: string; permissionIds: string[] }) => {
      const response = await apiRequest('PUT', `/api/roles/${roleId}/permissions`, { permissionIds });
      return response.json();
    },
    onMutate: async ({ roleId, permissionIds }) => {
      await queryClient.cancelQueries({ queryKey: ['/api/roles/all-permissions'] });
      const previous = queryClient.getQueryData<Record<string, string[]>>(['/api/roles/all-permissions']);
      queryClient.setQueryData<Record<string, string[]>>(['/api/roles/all-permissions'], (old) =>
        old ? { ...old, [roleId]: permissionIds } : old
      );
      return { previous };
    },
    onError: (error, { roleId }, context) => {
      if (context?.previous) {
        queryClient.setQueryData(['/api/roles/all-permissions'], context.previous);
      }
      setPendingToggles(prev => {
        const next = new Set(prev);
        next.delete(roleId);
        return next;
      });
      toast({ title: 'Error', description: `Failed to update permissions: ${error.message}`, variant: 'destructive' });
    },
    onSuccess: (_data, { roleId }) => {
      queryClient.invalidateQueries({ queryKey: ['/api/roles/all-permissions'] });
      setPendingToggles(prev => {
        const next = new Set(prev);
        next.delete(roleId);
        return next;
      });
    },
  });

  const handleToggleSalesView = (role: Role) => {
    if (!salesViewPermissionId) return;
    const current = allRolePerms[role.id] ?? [];
    const hasSalesView = current.includes(salesViewPermissionId);
    const newIds = hasSalesView
      ? current.filter(id => id !== salesViewPermissionId)
      : [...current, salesViewPermissionId];

    setPendingToggles(prev => new Set(prev).add(role.id));
    updatePermissionsMutation.mutate({ roleId: role.id, permissionIds: newIds });
  };

  const isLoading = rolesLoading || permissionsLoading || rolePermsLoading;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <ShoppingBag className="w-4 h-4 text-primary" />
            Sales data access
          </CardTitle>
          <CardDescription>
            Choose which staff roles can view sales analytics, Shopify data, and revenue dashboards.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
              <Loader2 className="w-4 h-4 animate-spin" />
              Loading roles…
            </div>
          ) : !salesViewPermissionId ? (
            <p className="text-sm text-muted-foreground">Sales permission not found. Please check your permissions setup.</p>
          ) : (
            <div className="divide-y">
              {roles.map(role => {
                const hasSalesView = (allRolePerms[role.id] ?? []).includes(salesViewPermissionId);
                const isPending = pendingToggles.has(role.id);
                return (
                  <div key={role.id} className="flex items-center justify-between py-3">
                    <div className="flex flex-col gap-0.5">
                      <span className="text-sm font-medium">{role.displayName ?? role.name}</span>
                      {role.description && (
                        <span className="text-xs text-muted-foreground line-clamp-1">{role.description}</span>
                      )}
                    </div>
                    <div className="flex items-center gap-2 shrink-0 ml-4">
                      {hasSalesView && !isPending && (
                        <Badge variant="secondary" className="text-xs hidden sm:inline-flex">Access granted</Badge>
                      )}
                      {isPending ? (
                        <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
                      ) : (
                        <Switch
                          checked={hasSalesView}
                          onCheckedChange={() => handleToggleSalesView(role)}
                          aria-label={`Toggle sales access for ${role.displayName ?? role.name}`}
                        />
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Full permission matrix</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground mb-4">
            Manage all roles and their complete permission sets in the dedicated role management page.
          </p>
          <Button onClick={() => navigate('/hr/roles')} className="gap-2">
            <Shield className="w-4 h-4" /> Manage Roles & Permissions <ExternalLink className="w-4 h-4" />
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
