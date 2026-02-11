import { ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useAuth } from '@/hooks/useAuth';
import type { Permission } from '@shared/schema';

interface PermissionGuardProps {
  children: ReactNode;
  permission?: string;
  fallback?: ReactNode;
}

export default function PermissionGuard({ children, permission, fallback }: PermissionGuardProps) {
  const { user } = useAuth();

  const { data: userPermissions = [], isLoading: isPermissionsLoading, isPending } = useQuery<Permission[]>({
    queryKey: ["/api/auth/permissions"],
    enabled: !!user,
  });

  if (!permission) {
    return <>{children}</>;
  }

  const isAdmin = user?.role?.name === 'owner' || user?.role?.name === 'admin';
  if (isAdmin) {
    return <>{children}</>;
  }

  if (!user || (isPending && !isPermissionsLoading)) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    );
  }

  if (isPermissionsLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    );
  }

  const hasPermission = userPermissions?.some?.(p => p.name === permission) || false;

  if (!hasPermission) {
    return fallback || (
      <div className="min-h-screen bg-background p-4">
        <div className="space-y-4 max-w-sm mx-auto">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Access Denied</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">
                You don't have permission to access this feature.
              </p>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
