import { useAuth } from '@/hooks/useAuth';
import { Skeleton } from '@/components/ui/skeleton';
import AssociateDashboard from './AssociateDashboard';
import ManagerDashboard from './ManagerDashboard';
import OwnerDashboard from './OwnerDashboard';

export default function DashboardRouter() {
  const { user, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="space-y-4 p-4 md:p-6">
        <Skeleton className="h-32 w-full rounded-xl" />
        <Skeleton className="h-48 w-full rounded-xl" />
        <Skeleton className="h-48 w-full rounded-xl" />
      </div>
    );
  }

  const role = user?.role?.name;

  if (role === 'owner') {
    return <OwnerDashboard />;
  }

  if (role === 'admin') {
    return <ManagerDashboard />;
  }

  return <AssociateDashboard />;
}
