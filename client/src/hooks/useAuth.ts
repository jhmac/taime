import { useUser, useAuth as useClerkAuth } from "@clerk/clerk-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { UserWithRole } from "@shared/schema";
import { useEffect, useRef } from "react";
import { clearTokenCache } from "@/lib/queryClient";

function hasE2ECookie() {
  if (!import.meta.env.DEV) return false;
  // Mirror the server-side opt-in: requires explicit Vite env flag in addition to the cookie.
  // Without this, a stray __e2e_uid cookie would put the UI into the auth shell while
  // the server rejects the (unsigned) cookie on every request.
  if (import.meta.env.VITE_ENABLE_E2E_AUTH_BYPASS !== 'true') return false;
  return document.cookie.split(';').some(c => c.trim().startsWith('__e2e_uid='));
}

export function useAuth() {
  const e2eMode = hasE2ECookie();

  const { user: clerkUser, isLoaded, isSignedIn } = useUser();
  const { getToken } = useClerkAuth();
  const hasSynced = useRef(false);
  const queryClient = useQueryClient();

  const { data: syncedUser, isLoading: isSyncing } = useQuery<UserWithRole>({
    queryKey: ["/api/auth/user"],
    enabled: e2eMode || (isLoaded && !!isSignedIn),
    retry: 1,
    staleTime: 30000,
    queryFn: async () => {
      if (e2eMode) {
        const res = await fetch("/api/auth/user", { credentials: "include" });
        if (!res.ok) {
          if (res.status === 401) return null;
          throw new Error("Failed to fetch user");
        }
        return res.json();
      }
      const token = await getToken();
      const res = await fetch("/api/auth/user", {
        credentials: "include",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) {
        if (res.status === 401) return null;
        throw new Error("Failed to fetch user");
      }
      return res.json();
    },
  });

  useEffect(() => {
    if (e2eMode) return;
    if (isLoaded && isSignedIn && clerkUser && (!syncedUser || !(syncedUser as any).role) && !hasSynced.current) {
      hasSynced.current = true;
      (async () => {
        try {
          const token = await getToken();
          const res = await fetch("/api/auth/sync", {
            method: "POST",
            credentials: "include",
            headers: {
              "Content-Type": "application/json",
              ...(token ? { Authorization: `Bearer ${token}` } : {}),
            },
            body: JSON.stringify({
              email: clerkUser.primaryEmailAddress?.emailAddress || '',
              firstName: clerkUser.firstName || '',
              lastName: clerkUser.lastName || '',
              profileImageUrl: clerkUser.imageUrl || '',
            }),
          });
          if (res.ok) {
            queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
          }
        } catch (err) {
          console.error("User sync error:", err);
          hasSynced.current = false;
        }
      })();
    }
    if (!isSignedIn) {
      hasSynced.current = false;
      clearTokenCache();
    }
  }, [e2eMode, isLoaded, isSignedIn, clerkUser, syncedUser, getToken, queryClient]);

  if (e2eMode) {
    return {
      user: syncedUser,
      isLoading: isSyncing && !syncedUser,
      isAuthenticated: !!syncedUser,
      error: null,
    };
  }

  return {
    user: syncedUser,
    isLoading: !isLoaded || (isSignedIn && isSyncing && !syncedUser),
    isAuthenticated: isLoaded && isSignedIn && !!syncedUser,
    error: null,
  };
}
