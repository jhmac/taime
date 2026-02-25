import { useState, useEffect } from "react";
import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider, useQuery } from "@tanstack/react-query";
import { ClerkProvider, SignedIn, SignedOut } from "@clerk/clerk-react";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useAuth } from "@/hooks/useAuth";
import { initGlobalErrorHandlers } from "./lib/errorReporter";
import Layout from "@/components/Layout";
import Landing from "@/pages/Landing";
import DashboardRouter from "@/features/dashboard/DashboardRouter";
import Operations from "@/pages/Operations";
import Communication from "@/pages/Communication";
import HR from "@/pages/HR";
import RoleManagement from "@/pages/RoleManagement";
import ScheduleManagement from "@/pages/ScheduleManagement";
import Team from "@/pages/Team";
import TeamMember from "@/pages/TeamMember";
import Availability from "@/pages/Availability";
import PayPeriodManagement from "@/pages/PayPeriodManagement";
import PayrollSetupModal from "@/components/PayrollSetupModal";
import { usePayrollSetup } from "@/hooks/usePayrollSetup";
import AdminSettings from "@/pages/AdminSettings";
import TaskManagement from "@/pages/TaskManagement";
import Analytics from "@/pages/Analytics";
import Performance from "@/pages/Performance";
import Learning from "@/pages/Learning";
import MoreMenu from "@/pages/MoreMenu";
import Requests from "@/pages/Requests";
import TeamDirectory from "@/pages/TeamDirectory";
import EmployeeSettings from "@/pages/EmployeeSettings";
import SupportPage from "@/pages/Support";
import SOPLibrary from "@/pages/SOPLibrary";
import SOPBuilder from "@/pages/SOPBuilder";
import SOPDetail from "@/pages/SOPDetail";
import SOPExecution from "@/pages/SOPExecution";
import IssueList from "@/pages/IssueList";
import IssueDetail from "@/pages/IssueDetail";
import MorningHuddle from "@/pages/MorningHuddle";
import ImprovementFeed from "@/pages/ImprovementFeed";
import NotFound from "@/pages/not-found";
import OfflineIndicator from "@/components/OfflineIndicator";
import SmartClockPrompt from "@/components/SmartClockPrompt";
import FocusClockOut from "@/components/FocusClockOut";
import AskMAinagerSheet from "@/features/ai-copilot/AskMAinagerSheet";
import QuickCaptureButton from "@/features/gtd/QuickCaptureButton";
import GTDInbox from "@/features/gtd/GTDInbox";
import GTDActions from "@/features/gtd/GTDActions";
import GTDProjects from "@/features/gtd/GTDProjects";
import GTDProjectDetail from "@/features/gtd/GTDProjectDetail";
import GTDWaiting from "@/features/gtd/GTDWaiting";
import GTDSomeday from "@/features/gtd/GTDSomeday";
import WeeklyReview from "@/features/gtd/WeeklyReview";
import MessagingPage from "@/features/messaging/MessagingPage";
import KudosWallPage from "@/features/kudos/KudosWallPage";
import { WebSocketProvider } from "@/contexts/WebSocketContext";
import type { Permission } from "@shared/schema";

function ProtectedRoute({ children, permission }: { children: React.ReactNode; permission?: string }) {
  const { user, isLoading } = useAuth();
  const { data: permissions = [], isError: permissionsError, isLoading: permissionsLoading } = useQuery<Permission[]>({
    queryKey: ["/api/auth/permissions"],
    enabled: !!user,
    retry: 2,
    retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 8000),
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
  });

  const [loadingTimedOut, setLoadingTimedOut] = useState(false);
  useEffect(() => {
    if (isLoading || permissionsLoading) {
      setLoadingTimedOut(false);
      const timer = setTimeout(() => setLoadingTimedOut(true), 10000);
      return () => clearTimeout(timer);
    }
  }, [isLoading, permissionsLoading]);

  if (isLoading || !user || permissionsLoading) {
    if (loadingTimedOut) {
      return (
        <div className="min-h-screen bg-background p-4">
          <div className="space-y-4 max-w-sm mx-auto mt-20">
            <div className="rounded-lg border bg-card p-6">
              <h3 className="text-lg font-semibold">Loading is taking too long</h3>
              <p className="text-sm text-muted-foreground mt-2">
                We're having trouble loading this page. Please try refreshing.
              </p>
              <button onClick={() => window.location.reload()} className="text-sm text-primary underline mt-3">
                Refresh
              </button>
            </div>
          </div>
        </div>
      );
    }
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    );
  }

  if (permissionsError) {
    return (
      <div className="min-h-screen bg-background p-4">
        <div className="space-y-4 max-w-sm mx-auto mt-20">
          <div className="rounded-lg border bg-card p-6">
            <h3 className="text-lg font-semibold">Unable to Verify Permissions</h3>
            <p className="text-sm text-muted-foreground mt-2">
              We couldn't verify your access. Please try refreshing the page.
            </p>
            <button onClick={() => window.location.reload()} className="text-sm text-primary underline mt-3">
              Refresh
            </button>
          </div>
        </div>
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
  const [authTimedOut, setAuthTimedOut] = useState(false);

  useEffect(() => {
    if (isLoading || !isAuthenticated) {
      setAuthTimedOut(false);
      const timer = setTimeout(() => setAuthTimedOut(true), 10000);
      return () => clearTimeout(timer);
    }
  }, [isLoading, isAuthenticated]);

  if (isLoading || !isAuthenticated) {
    if (authTimedOut) {
      return (
        <div className="min-h-screen flex items-center justify-center">
          <div className="text-center space-y-3">
            <p className="text-sm text-muted-foreground">Authentication is taking longer than expected.</p>
            <button onClick={() => window.location.reload()} className="text-sm text-primary underline">
              Refresh
            </button>
          </div>
        </div>
      );
    }
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    );
  }

  return (
    <>
    <OfflineIndicator />
    <SmartClockPrompt />
    <FocusClockOut />
    <AskMAinagerSheet />
    <QuickCaptureButton />
    <Switch>
      <Route path="/" component={DashboardRouter} />
      <Route path="/operations">
        <ProtectedRoute permission="admin.manage_all"><Operations /></ProtectedRoute>
      </Route>
      <Route path="/communication" component={Communication} />
      <Route path="/messages" component={MessagingPage} />
      <Route path="/kudos" component={KudosWallPage} />
      <Route path="/hr">
        <ProtectedRoute permission="hr.view_team"><HR /></ProtectedRoute>
      </Route>
      <Route path="/hr/roles">
        <ProtectedRoute permission="admin.role_management"><RoleManagement /></ProtectedRoute>
      </Route>
      <Route path="/team">
        <ProtectedRoute permission="hr.view_team"><Team /></ProtectedRoute>
      </Route>
      <Route path="/team/:id">
        <ProtectedRoute permission="hr.view_team"><TeamMember /></ProtectedRoute>
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
      <Route path="/performance" component={Performance} />
      <Route path="/learning" component={Learning} />
      <Route path="/more" component={MoreMenu} />
      <Route path="/requests" component={Requests} />
      <Route path="/team-directory" component={TeamDirectory} />
      <Route path="/employee-settings" component={EmployeeSettings} />
      <Route path="/sops" component={SOPLibrary} />
      <Route path="/sops/new">
        <ProtectedRoute permission="admin.manage_all"><SOPBuilder /></ProtectedRoute>
      </Route>
      <Route path="/sops/:id/edit">
        <ProtectedRoute permission="admin.manage_all"><SOPBuilder /></ProtectedRoute>
      </Route>
      <Route path="/sops/execute/:executionId" component={SOPExecution} />
      <Route path="/sops/:id" component={SOPDetail} />
      <Route path="/issues" component={IssueList} />
      <Route path="/issues/:id" component={IssueDetail} />
      <Route path="/huddle" component={MorningHuddle} />
      <Route path="/improvements" component={ImprovementFeed} />
      <Route path="/gtd/inbox" component={GTDInbox} />
      <Route path="/gtd/actions" component={GTDActions} />
      <Route path="/gtd/projects/:id" component={GTDProjectDetail} />
      <Route path="/gtd/projects" component={GTDProjects} />
      <Route path="/gtd/waiting" component={GTDWaiting} />
      <Route path="/gtd/someday" component={GTDSomeday} />
      <Route path="/gtd/review" component={WeeklyReview} />
      <Route path="/support" component={SupportPage} />
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

initGlobalErrorHandlers();

function App() {
  const [clerkKey, setClerkKey] = useState<string | null>(null);
  const [clerkError, setClerkError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const MAX_RETRIES = 3;
    const TIMEOUT_MS = 10000;

    async function fetchClerkKey(attempt = 1): Promise<void> {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);
        const res = await fetch("/api/clerk-key", { signal: controller.signal });
        clearTimeout(timeoutId);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        let data: any;
        try {
          data = await res.json();
        } catch {
          throw new Error("Invalid server response");
        }
        if (!cancelled) {
          if (data.publishableKey) {
            setClerkKey(data.publishableKey);
            setClerkError(null);
          } else {
            throw new Error("Missing publishable key");
          }
        }
      } catch (err: any) {
        if (cancelled) return;
        const isServerError = err?.message?.startsWith('HTTP 5');
        if (attempt < MAX_RETRIES && !isServerError) {
          await new Promise(r => setTimeout(r, Math.min(1000 * 2 ** attempt, 8000)));
          return fetchClerkKey(attempt + 1);
        }
        setClerkError(err?.name === 'AbortError' ? "Connection timed out. Please refresh the page." : "Failed to initialize. Please refresh the page.");
      }
    }

    fetchClerkKey();
    return () => { cancelled = true; };
  }, []);

  if (clerkError) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center space-y-3">
          <p className="text-sm text-destructive">{clerkError}</p>
          <button onClick={() => window.location.reload()} className="text-sm text-primary underline">
            Retry
          </button>
        </div>
      </div>
    );
  }

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
        <WebSocketProvider>
          <TooltipProvider>
            <Layout>
              <Toaster />
              <Router />
            </Layout>
          </TooltipProvider>
        </WebSocketProvider>
      </QueryClientProvider>
    </ClerkProvider>
  );
}

export default App;
