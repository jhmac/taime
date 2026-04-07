import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/hooks/useAuth";
import StoreSetupWizard from "./StoreSetupWizard";
import InvitedWelcomeModal from "./InvitedWelcomeModal";

interface OnboardingStatus {
  needsStoreSetup: boolean;
  isNewInvitedUser: boolean;
  storeInfo: { name: string } | null;
  userRole: string;
  userName: string;
  userId?: string;
}

interface OnboardingGuardProps {
  children: React.ReactNode;
}

function LoadingScreen() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-[#FFFBF5]">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#F47D31]" />
    </div>
  );
}

export default function OnboardingGuard({ children }: OnboardingGuardProps) {
  const { user, isAuthenticated, isLoading: authLoading } = useAuth();
  const queryClient = useQueryClient();

  const { data: status, isLoading: statusLoading } = useQuery<OnboardingStatus>({
    queryKey: ["/api/onboarding/status"],
    enabled: isAuthenticated,
    staleTime: 30_000,
    retry: 1,
  });

  // Auth still loading — show spinner to prevent flicker
  if (authLoading) {
    return <LoadingScreen />;
  }

  // Not authenticated — Clerk handles the sign-in wall, render children (Landing)
  if (!isAuthenticated) {
    return <>{children}</>;
  }

  // Authenticated but onboarding status still resolving — BLOCK with spinner
  // This prevents the dashboard from flashing before we know if setup is needed
  if (statusLoading || !status) {
    return <LoadingScreen />;
  }

  // Owner/admin first login: no store exists yet → block with full-screen wizard
  if (status.needsStoreSetup) {
    return (
      <StoreSetupWizard
        onComplete={() => {
          queryClient.invalidateQueries({ queryKey: ["/api/onboarding/status"] });
        }}
      />
    );
  }

  // Newly accepted invited user: show welcome modal on top of the app
  if (status.isNewInvitedUser) {
    // Per-user key so different employees on the same device each see their welcome
    const userId = user?.id || "unknown";
    const storageKey = `welcome_shown_${userId}`;
    const alreadyShown =
      typeof window !== "undefined" &&
      localStorage.getItem(storageKey) === "true";

    if (!alreadyShown) {
      const handleDismiss = () => {
        localStorage.setItem(storageKey, "true");
        queryClient.invalidateQueries({ queryKey: ["/api/onboarding/status"] });
      };

      return (
        <>
          {children}
          <InvitedWelcomeModal
            userName={status.userName}
            storeName={status.storeInfo?.name || "your boutique"}
            roleName={status.userRole}
            onDismiss={handleDismiss}
          />
        </>
      );
    }
  }

  return <>{children}</>;
}
