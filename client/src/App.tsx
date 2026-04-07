import { useState, useEffect, lazy, Suspense, Component, type ReactNode, type ErrorInfo } from "react";
import { Switch, Route, useLocation } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider, useQuery } from "@tanstack/react-query";
import { ClerkProvider, SignedIn, SignedOut } from "@clerk/clerk-react";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useAuth } from "@/hooks/useAuth";
import { initGlobalErrorHandlers } from "./lib/errorReporter";
import Layout from "@/components/Layout";
import { usePWAUpdate } from "@/hooks/usePWAUpdate";
import PWAInstallPrompt from "@/components/PWAInstallPrompt";
const OnboardingGuard = lazy(() => import("@/components/OnboardingGuard"));

class AppErrorBoundary extends Component<{ children: ReactNode }, { hasError: boolean; error: Error | null }> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { hasError: false, error: null };
  }
  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }
  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('App Error Boundary caught:', error, errorInfo);
    try {
      fetch('/api/client-errors', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: error.message, stack: error.stack, action: 'ErrorBoundary' }),
      }).catch(() => {});
    } catch {}
  }
  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-background p-4">
          <div className="text-center space-y-4 max-w-sm">
            <h2 className="text-lg font-semibold">Something went wrong</h2>
            <p className="text-sm text-muted-foreground">{this.state.error?.message || 'An unexpected error occurred.'}</p>
            <button
              onClick={() => {
                if ('caches' in window) {
                  caches.keys().then(names => names.forEach(name => caches.delete(name)));
                }
                window.location.reload();
              }}
              className="px-4 py-2 bg-primary text-primary-foreground rounded-md text-sm"
            >
              Clear Cache & Reload
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

const Landing = lazy(() => import("@/pages/Landing"));
const DashboardRouter = lazy(() => import("@/features/dashboard/DashboardRouter"));
const Operations = lazy(() => import("@/pages/Operations"));
const Communication = lazy(() => import("@/pages/Communication"));
const HR = lazy(() => import("@/pages/HR"));
const RoleManagement = lazy(() => import("@/pages/RoleManagement"));
const ScheduleManagement = lazy(() => import("@/pages/ScheduleManagement"));
const Team = lazy(() => import("@/pages/Team"));
const TeamMember = lazy(() => import("@/pages/TeamMember"));
const Availability = lazy(() => import("@/pages/Availability"));
const PayPeriodManagement = lazy(() => import("@/pages/PayPeriodManagement"));
const PayrollSetupModal = lazy(() => import("@/components/PayrollSetupModal"));
import { usePayrollSetup } from "@/hooks/usePayrollSetup";
const AdminSettings = lazy(() => import("@/pages/AdminSettings"));
const TaskManagement = lazy(() => import("@/pages/TaskManagement"));
const Analytics = lazy(() => import("@/pages/Analytics"));
const Performance = lazy(() => import("@/pages/Performance"));
const Learning = lazy(() => import("@/pages/Learning"));
const MoreMenu = lazy(() => import("@/pages/MoreMenu"));
const Requests = lazy(() => import("@/pages/Requests"));
const TeamDirectory = lazy(() => import("@/pages/TeamDirectory"));
const EmployeeSettings = lazy(() => import("@/pages/EmployeeSettings"));
const SupportPage = lazy(() => import("@/pages/Support"));
const TermsOfService = lazy(() => import("@/pages/TermsOfService"));
const PrivacyPolicy = lazy(() => import("@/pages/PrivacyPolicy"));
const SOPLibrary = lazy(() => import("@/pages/SOPLibrary"));
const SOPBuilder = lazy(() => import("@/pages/SOPBuilder"));
const SOPDetail = lazy(() => import("@/pages/SOPDetail"));
const SOPExecution = lazy(() => import("@/pages/SOPExecution"));
const SOPRevisions = lazy(() => import("@/pages/SOPRevisions"));
const TrainingHub = lazy(() => import("@/pages/TrainingHub"));
const IssueList = lazy(() => import("@/pages/IssueList"));
const IssueDetail = lazy(() => import("@/pages/IssueDetail"));
const MorningHuddle = lazy(() => import("@/pages/MorningHuddle"));
const MorningWhisper = lazy(() => import("@/pages/MorningWhisper"));
const ImprovementFeed = lazy(() => import("@/pages/ImprovementFeed"));
const NotFound = lazy(() => import("@/pages/not-found"));
const ShopifyCallbackSuccess = lazy(() => import("@/pages/ShopifyCallbackSuccess"));
import OfflineIndicator from "@/components/OfflineIndicator";
const SmartClockPrompt = lazy(() => import("@/components/SmartClockPrompt"));
const FocusClockOut = lazy(() => import("@/components/FocusClockOut"));
const AskMAinagerSheet = lazy(() => import("@/features/ai-copilot/AskMAinagerSheet"));
const QuickCaptureButton = lazy(() => import("@/features/gtd/QuickCaptureButton"));
const GTDInbox = lazy(() => import("@/features/gtd/GTDInbox"));
const GTDActions = lazy(() => import("@/features/gtd/GTDActions"));
const GTDProjects = lazy(() => import("@/features/gtd/GTDProjects"));
const GTDProjectDetail = lazy(() => import("@/features/gtd/GTDProjectDetail"));
const GTDWaiting = lazy(() => import("@/features/gtd/GTDWaiting"));
const GTDSomeday = lazy(() => import("@/features/gtd/GTDSomeday"));
const WeeklyReview = lazy(() => import("@/features/gtd/WeeklyReview"));
const MessagingPage = lazy(() => import("@/features/messaging/MessagingPage"));
const KudosWallPage = lazy(() => import("@/features/kudos/KudosWallPage"));
const LeanBoard = lazy(() => import("@/pages/LeanBoard"));
const InsightsPage = lazy(() => import("@/pages/InsightsPage"));
const CashManagement = lazy(() => import("@/pages/CashManagement"));
const MileageReport = lazy(() => import("@/pages/MileageReport"));
const Timesheets = lazy(() => import("@/pages/Timesheets"));
const PayrollExport = lazy(() => import("@/pages/PayrollExport"));
const MyScore = lazy(() => import("@/pages/MyScore"));
const JoinPage = lazy(() => import("@/pages/JoinPage"));
const MeetingsList = lazy(() => import("@/pages/MeetingsList"));
const MeetingsNew = lazy(() => import("@/pages/MeetingsNew"));
const MeetingDetail = lazy(() => import("@/pages/MeetingDetail"));
import { WebSocketProvider } from "@/contexts/WebSocketContext";
import type { Permission } from "@shared/schema";

function PageLoader() {
  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
    </div>
  );
}

function ProtectedRoute({ children, permission, allowAllAuthenticated }: { children: React.ReactNode; permission?: string; allowAllAuthenticated?: boolean }) {
  const { user, isLoading } = useAuth();
  const { data: permissions = [], isError: permissionsError, isLoading: permissionsLoading } = useQuery<Permission[]>({
    queryKey: ["/api/auth/permissions"],
    enabled: !!user && !allowAllAuthenticated,
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

  if (isLoading) {
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

  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    );
  }

  if (allowAllAuthenticated) {
    return <>{children}</>;
  }

  if (permissionsLoading) {
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
    <Suspense fallback={null}>
      <SmartClockPrompt />
      <FocusClockOut />
      <AskMAinagerSheet />
      <QuickCaptureButton />
    </Suspense>
    <Suspense fallback={<PageLoader />}>
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
        <Route path="/tasks">
          <ProtectedRoute><TaskManagement /></ProtectedRoute>
        </Route>
        <Route path="/schedules" component={ScheduleManagement} />
        <Route path="/availability" component={Availability} />
        <Route path="/payroll">
          <ProtectedRoute permission="hr.payroll_view"><PayPeriodManagement /></ProtectedRoute>
        </Route>
        <Route path="/analytics">
          <ProtectedRoute permission="admin.manage_all"><Analytics /></ProtectedRoute>
        </Route>
        <Route path="/performance">
          <ProtectedRoute><Performance /></ProtectedRoute>
        </Route>
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
        <Route path="/sops/revisions" component={SOPRevisions} />
        <Route path="/sops/training" component={TrainingHub} />
        <Route path="/sops/execute/:executionId" component={SOPExecution} />
        <Route path="/sops/:id" component={SOPDetail} />
        <Route path="/issues" component={IssueList} />
        <Route path="/issues/:id" component={IssueDetail} />
        <Route path="/huddle" component={MorningHuddle} />
        <Route path="/whisper" component={MorningWhisper} />
        <Route path="/improvements" component={ImprovementFeed} />
        <Route path="/gtd/inbox" component={GTDInbox} />
        <Route path="/gtd/actions" component={GTDActions} />
        <Route path="/gtd/projects/:id" component={GTDProjectDetail} />
        <Route path="/gtd/projects" component={GTDProjects} />
        <Route path="/gtd/waiting" component={GTDWaiting} />
        <Route path="/gtd/someday" component={GTDSomeday} />
        <Route path="/gtd/review" component={WeeklyReview} />
        <Route path="/lean-board" component={LeanBoard} />
        <Route path="/cash">
          <ProtectedRoute allowAllAuthenticated><CashManagement /></ProtectedRoute>
        </Route>
        <Route path="/timesheets">
          <ProtectedRoute permission="hr.payroll_view"><Timesheets /></ProtectedRoute>
        </Route>
        <Route path="/mileage-report">
          <ProtectedRoute permission="hr.payroll_view"><MileageReport /></ProtectedRoute>
        </Route>
        <Route path="/payroll-export">
          <ProtectedRoute permission="hr.payroll_view"><PayrollExport /></ProtectedRoute>
        </Route>
        <Route path="/meetings/new">
          <ProtectedRoute permission="admin.manage_all"><MeetingsNew /></ProtectedRoute>
        </Route>
        <Route path="/meetings/:id">
          <ProtectedRoute permission="admin.manage_all"><MeetingDetail /></ProtectedRoute>
        </Route>
        <Route path="/meetings">
          <ProtectedRoute permission="admin.manage_all"><MeetingsList /></ProtectedRoute>
        </Route>
        <Route path="/my-score" component={MyScore} />
        <Route path="/insights" component={InsightsPage} />
        <Route path="/support" component={SupportPage} />
        <Route path="/admin">
          <ProtectedRoute permission="admin.manage_all"><AdminSettings /></ProtectedRoute>
        </Route>
        <Route component={NotFound} />
      </Switch>
    </Suspense>
    <Suspense fallback={null}>
      <PayrollSetupModal isOpen={showSetupModal} onClose={closeSetupModal} />
    </Suspense>
    </>
  );
}

function Router() {
  const [location] = useLocation();

  if (location.startsWith("/join/")) {
    return (
      <Suspense fallback={<PageLoader />}>
        <Switch>
          <Route path="/join/:token" component={JoinPage} />
        </Switch>
      </Suspense>
    );
  }

  if (location === "/terms") {
    return (
      <Suspense fallback={<PageLoader />}>
        <TermsOfService />
      </Suspense>
    );
  }

  if (location === "/privacy") {
    return (
      <Suspense fallback={<PageLoader />}>
        <PrivacyPolicy />
      </Suspense>
    );
  }

  if (location.startsWith("/shopify-callback-success")) {
    return (
      <Suspense fallback={<PageLoader />}>
        <Switch>
          <Route path="/shopify-callback-success" component={ShopifyCallbackSuccess} />
        </Switch>
      </Suspense>
    );
  }

  return (
    <>
      <SignedOut>
        <Suspense fallback={<PageLoader />}>
          <Landing />
        </Suspense>
      </SignedOut>
      <SignedIn>
        <Suspense fallback={
          <div className="min-h-screen flex items-center justify-center bg-[#FFFBF5]">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#F47D31]" />
          </div>
        }>
          <OnboardingGuard>
            <AuthenticatedApp />
          </OnboardingGuard>
        </Suspense>
      </SignedIn>
    </>
  );
}

function PWAUpdateWatcher() {
  usePWAUpdate();
  return null;
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
    <AppErrorBoundary>
      <ClerkProvider publishableKey={clerkKey}>
        <QueryClientProvider client={queryClient}>
          <WebSocketProvider>
            <TooltipProvider>
              <Layout>
                <Toaster />
                <Router />
                <PWAInstallPrompt />
                <PWAUpdateWatcher />
              </Layout>
            </TooltipProvider>
          </WebSocketProvider>
        </QueryClientProvider>
      </ClerkProvider>
    </AppErrorBoundary>
  );
}

export default App;
