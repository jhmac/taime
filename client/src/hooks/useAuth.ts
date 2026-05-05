import { useUser, useAuth as useClerkAuth } from "@clerk/clerk-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { UserWithRole, Permission } from "@shared/schema";
import { useEffect, useRef } from "react";
import { clearTokenCache } from "@/lib/queryClient";

function hasE2ECookie() {
  if (!import.meta.env.DEV) return false;
  if (import.meta.env.VITE_ENABLE_E2E_AUTH_BYPASS !== 'true') return false;
  return document.cookie.split(';').some(c => c.trim().startsWith('__e2e_uid='));
}

interface BootstrapData {
  user: UserWithRole;
  permissions: Permission[];
}

function readBootstrapData(): BootstrapData | null {
  try {
    const el = document.getElementById('app-bootstrap');
    if (!el?.textContent) return null;
    const parsed = JSON.parse(el.textContent) as unknown;
    if (
      parsed &&
      typeof parsed === 'object' &&
      'user' in parsed &&
      'permissions' in parsed &&
      parsed.user &&
      Array.isArray((parsed as BootstrapData).permissions)
    ) {
      return parsed as BootstrapData;
    }
    return null;
  } catch {
    return null;
  }
}

export function useAuth() {
  const e2eMode = hasE2ECookie();

  const { isLoaded, isSignedIn } = useUser();
  const { getToken } = useClerkAuth();
  const hasInvalidatedPerms = useRef(false);
  const queryClient = useQueryClient();

  const { data: syncedUser, isLoading: isSyncing } = useQuery<UserWithRole | null>({
    queryKey: ["/api/auth/user"],
    enabled: e2eMode || (isLoaded && !!isSignedIn),
    retry: 1,
    staleTime: 30000,
    queryFn: async (): Promise<UserWithRole | null> => {
      if (e2eMode) {
        const res = await fetch("/api/auth/user", { credentials: "include" });
        if (!res.ok) {
          if (res.status === 401) return null;
          throw new Error("Failed to fetch user");
        }
        const data = await res.json() as UserWithRole & { permissions?: Permission[] };
        if (Array.isArray(data?.permissions)) {
          queryClient.setQueryData(["/api/auth/permissions"], data.permissions);
        }
        return data;
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
      // GET /api/auth/user returns user + permissions in one response.
      // Pre-populate the permissions cache so ProtectedRoute gets a cache hit.
      const data = await res.json() as UserWithRole & { permissions?: Permission[] };
      if (Array.isArray(data?.permissions)) {
        queryClient.setQueryData(["/api/auth/permissions"], data.permissions);
      }
      return data;
    },
    initialData: () => {
      // Server-injected bootstrap data is available synchronously for returning
      // users in production — zero network round-trips on first render.
      const bootstrap = readBootstrapData();
      if (!bootstrap) return undefined;
      queryClient.setQueryData(["/api/auth/permissions"], bootstrap.permissions);
      return bootstrap.user;
    },
    initialDataUpdatedAt: Date.now(),
  });

  // Safeguard: if bootstrap gave us an authenticated user but empty permissions
  // (e.g. legacy Clerk→DB ID mismatch on the server during HTML serve), trigger
  // one background refetch of permissions. Gated by a ref so it fires at most
  // once per mount — users with legitimately zero permissions are not repeatedly
  // refetched.
  const bootstrapPerms = queryClient.getQueryData<unknown[]>(["/api/auth/permissions"]);
  useEffect(() => {
    if (
      syncedUser &&
      Array.isArray(bootstrapPerms) &&
      bootstrapPerms.length === 0 &&
      !hasInvalidatedPerms.current
    ) {
      hasInvalidatedPerms.current = true;
      queryClient.invalidateQueries({ queryKey: ["/api/auth/permissions"] });
    }
  }, [syncedUser?.id, bootstrapPerms, queryClient]);

  // Sign-out cleanup: clear the cached Clerk JWT so the next sign-in
  // gets a fresh token rather than a stale one.
  useEffect(() => {
    if (!isSignedIn && isLoaded) {
      clearTokenCache();
    }
  }, [isLoaded, isSignedIn]);

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
