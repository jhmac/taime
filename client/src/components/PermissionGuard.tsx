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

  // Fetch user permissions
  const { data: userPermissions = [], isLoading } = useQuery<Permission[]>({
    queryKey: ["/api/auth/permissions"],
    enabled: !!user,
  });

  // If no permission is required, render children
  if (!permission) {
    return <>{children}</>;
  }

  // Show loading state while permissions are being fetched
  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    );
  }

  // Check if user has the required permission
  const hasPermission = userPermissions?.some?.(p => p.name === permission) || user?.role?.name === 'owner' || user?.role?.name === 'admin' || false;

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