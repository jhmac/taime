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
}

interface OnboardingGuardProps {
  children: React.ReactNode;
}

export default function OnboardingGuard({ children }: OnboardingGuardProps) {
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const queryClient = useQueryClient();

  const { data: status, isLoading: statusLoading } = useQuery<OnboardingStatus>({
    queryKey: ["/api/onboarding/status"],
    enabled: isAuthenticated,
    staleTime: 30_000,
    retry: 1,
  });

  // Not authenticated yet — render children (Clerk handles the sign-in wall)
  if (authLoading || !isAuthenticated) {
    return <>{children}</>;
  }

  // Still loading onboarding status — render children so the app shell is visible
  if (statusLoading) {
    return <>{children}</>;
  }

  // Owner/admin first login: no store exists yet
  if (status?.needsStoreSetup) {
    return (
      <StoreSetupWizard
        onComplete={() => {
          queryClient.invalidateQueries({ queryKey: ["/api/onboarding/status"] });
        }}
      />
    );
  }

  // Newly accepted invited user: show welcome modal on top of app
  if (status?.isNewInvitedUser) {
    const storageKey = `welcome_shown_v1`;

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
