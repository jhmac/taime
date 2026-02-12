import { useState, useEffect } from "react";
import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider, useQuery } from "@tanstack/react-query";
import { ClerkProvider, SignedIn, SignedOut } from "@clerk/clerk-react";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useAuth } from "@/hooks/useAuth";
import Layout from "@/components/Layout";
import Landing from "@/pages/Landing";
import Dashboard from "@/pages/Dashboard";
import Operations from "@/pages/Operations";
import Communication from "@/pages/Communication";
import HR from "@/pages/HR";
import AdminDashboard from "@/pages/AdminDashboard";
import RoleManagement from "@/pages/RoleManagement";
import ScheduleManagement from "@/pages/ScheduleManagement";
import Team from "@/pages/Team";
import Availability from "@/pages/Availability";
import PayPeriodManagement from "@/pages/PayPeriodManagement";
import PayrollSetupModal from "@/components/PayrollSetupModal";
import { usePayrollSetup } from "@/hooks/usePayrollSetup";
import AdminSettings from "@/pages/AdminSettings";
import TaskManagement from "@/pages/TaskManagement";
import Analytics from "@/pages/Analytics";
import NotFound from "@/pages/not-found";
import OfflineIndicator from "@/components/OfflineIndicator";
import type { Permission } from "@shared/schema";

function ProtectedRoute({ children, permission }: { children: React.ReactNode; permission?: string }) {
  const { user, isLoading } = useAuth();
  const { data: permissions = [] } = useQuery<Permission[]>({
    queryKey: ["/api/auth/permissions"],
    enabled: !!user,
  });

  if (isLoading || !user) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    );
  }

  const roleName = user?.role?.name;
  const isAdminOrOwner = roleName === 'owner' || roleName === 'admin';

  if (isAdminOrOwner) {
    return <>{children}</>;
  }

  if (permission) {
    const hasPermission = permissions.some(p => p.name === permission || p.name === 'admin.manage_all');
    if (hasPermission) {
      return <>{children}</>;
    }
  }

  return (
    <div className="min-h-screen bg-background p-4">
      <div className="space-y-4 max-w-sm mx-auto mt-20">
        <div className="rounded-lg border bg-card p-6">
          <h3 className="text-lg font-semibold">Access Denied</h3>
          <p className="text-sm text-muted-foreground mt-2">
            You don't have permission to access this page.
          </p>
        </div>
      </div>
    </div>
  );
}

function AuthenticatedApp() {
  const { isAuthenticated, isLoading, user } = useAuth();
  const { showSetupModal, closeSetupModal } = usePayrollSetup();

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    );
  }

  const isAdmin = user?.role?.name === 'admin' || user?.role?.name === 'owner';

  return (
    <>
    <OfflineIndicator />
    <Switch>
      <Route path="/" component={isAdmin ? AdminDashboard : Dashboard} />
      <Route path="/operations">
        <ProtectedRoute permission="admin.manage_all"><Operations /></ProtectedRoute>
      </Route>
      <Route path="/communication" component={Communication} />
      <Route path="/hr">
        <ProtectedRoute permission="hr.view_team"><HR /></ProtectedRoute>
      </Route>
      <Route path="/hr/roles">
        <ProtectedRoute permission="admin.role_management"><RoleManagement /></ProtectedRoute>
      </Route>
      <Route path="/team">
        <ProtectedRoute permission="hr.view_team"><Team /></ProtectedRoute>
      </Route>
      <Route path="/tasks" component={TaskManagement} />
      <Route path="/schedules" component={ScheduleManagement} />
      <Route path="/availability" component={Availability} />
      <Route path="/payroll">
        <ProtectedRoute permission="hr.payroll_view"><PayPeriodManagement /></ProtectedRoute>
      </Route>
      <Route path="/analytics">
        <ProtectedRoute permission="hr.view_team"><Analytics /></ProtectedRoute>
      </Route>
      <Route path="/admin">
        <ProtectedRoute permission="admin.manage_all"><AdminSettings /></ProtectedRoute>
      </Route>
      <Route component={NotFound} />
      <PayrollSetupModal isOpen={showSetupModal} onClose={closeSetupModal} />
    </Switch>
    </>
  );
}

function Router() {
  return (
    <>
      <SignedOut>
        <Landing />
      </SignedOut>
      <SignedIn>
        <AuthenticatedApp />
      </SignedIn>
    </>
  );
}

function App() {
  const [clerkKey, setClerkKey] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/clerk-key")
      .then(res => res.json())
      .then(data => setClerkKey(data.publishableKey))
      .catch(console.error);
  }, []);

  if (!clerkKey) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    );
  }

  return (
    <ClerkProvider publishableKey={clerkKey}>
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <Layout>
            <Toaster />
            <Router />
          </Layout>
        </TooltipProvider>
      </QueryClientProvider>
    </ClerkProvider>
  );
}

export default App;
