import { ReactNode } from 'react';
import { useAuth } from '@/hooks/useAuth';

interface PermissionGuardProps {
  children: ReactNode;
  permission?: string;
  fallback?: ReactNode;
}

export default function PermissionGuard({ children, permission, fallback }: PermissionGuardProps) {
  const { user, isLoading } = useAuth();

  if (!permission) {
    return <>{children}</>;
  }

  if (isLoading || !user) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    );
  }

  const roleName = user?.role?.name;
  if (roleName === 'owner' || roleName === 'admin') {
    return <>{children}</>;
  }

  return fallback || (
    <div className="min-h-screen bg-background p-4">
      <div className="space-y-4 max-w-sm mx-auto">
        <div className="rounded-lg border bg-card p-6">
          <h3 className="text-lg font-semibold">Access Denied</h3>
          <p className="text-sm text-muted-foreground mt-2">
            You don't have permission to access this feature.
          </p>
        </div>
      </div>
    </div>
  );
}
