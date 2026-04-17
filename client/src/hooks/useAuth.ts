import { useUser, useAuth as useClerkAuth } from "@clerk/clerk-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { UserWithRole } from "@shared/schema";
import { useEffect, useRef } from "react";
import { clearTokenCache } from "@/lib/queryClient";

export function useAuth() {
  const { user: clerkUser, isLoaded, isSignedIn } = useUser();
  const { getToken } = useClerkAuth();
  const hasSynced = useRef(false);
  const queryClient = useQueryClient();

  const { data: syncedUser, isLoading: isSyncing } = useQuery<UserWithRole>({
    queryKey: ["/api/auth/user"],
    enabled: isLoaded && isSignedIn,
    retry: 1,
    staleTime: 30000,
    queryFn: async () => {
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
    if (isLoaded && isSignedIn && clerkUser && !syncedUser && !hasSynced.current) {
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
  }, [isLoaded, isSignedIn, clerkUser, syncedUser, getToken, queryClient]);

  return {
    user: syncedUser,
    isLoading: !isLoaded || (isSignedIn && isSyncing && !syncedUser),
    isAuthenticated: isLoaded && isSignedIn && !!syncedUser,
    error: null,
  };
}
