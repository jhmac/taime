import { useState, useEffect } from "react";
import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { ClerkProvider, SignedIn, SignedOut } from "@clerk/clerk-react";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useAuth } from "@/hooks/useAuth";
import Layout from "@/components/Layout";
import PermissionGuard from "@/components/PermissionGuard";
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
import NotFound from "@/pages/not-found";

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

  return (
    <Switch>
      <Route path="/" component={(user?.role?.name === 'admin' || user?.role?.name === 'owner') ? AdminDashboard : Dashboard} />
      <Route path="/operations">
        <PermissionGuard permission="admin.manage_all">
          <Operations />
        </PermissionGuard>
      </Route>
      <Route path="/communication" component={Communication} />
      <Route path="/hr">
        <PermissionGuard permission="hr.manage_employees">
          <HR />
        </PermissionGuard>
      </Route>
      <Route path="/hr/roles">
        <PermissionGuard permission="admin.role_management">
          <RoleManagement />
        </PermissionGuard>
      </Route>
      <Route path="/team">
        <PermissionGuard permission="hr.manage_employees">
          <Team />
        </PermissionGuard>
      </Route>
      <Route path="/tasks" component={TaskManagement} />
      <Route path="/schedules" component={ScheduleManagement} />
      <Route path="/availability" component={Availability} />
      <Route path="/payroll">
        <PermissionGuard permission="admin.manage_payroll">
          <PayPeriodManagement />
        </PermissionGuard>
      </Route>
      <Route path="/admin">
        <PermissionGuard permission="admin.manage_all">
          <AdminSettings />
        </PermissionGuard>
      </Route>
      <Route component={NotFound} />
      <PayrollSetupModal isOpen={showSetupModal} onClose={closeSetupModal} />
    </Switch>
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