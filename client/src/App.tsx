import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
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
import NotFound from "@/pages/not-found";

function Router() {
  const { isAuthenticated, isLoading, user } = useAuth();

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    );
  }

  return (
    <Switch>
      {!isAuthenticated ? (
        <Route path="/" component={Landing} />
      ) : (
        <>
          <Route path="/" component={user?.role === 'admin' ? AdminDashboard : Dashboard} />
          <Route path="/operations" component={Operations} />
          <Route path="/communication" component={Communication} />
          <Route path="/hr" component={HR} />
          <Route path="/hr/roles" component={RoleManagement} />
          <Route path="/team" component={Team} />
          <Route path="/schedules" component={ScheduleManagement} />
          <Route path="/availability" component={Availability} />
          <Route path="/payroll" component={PayPeriodManagement} />
          <Route path="/admin" component={AdminDashboard} />
        </>
      )}
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Layout>
          <Toaster />
          <Router />
        </Layout>
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
