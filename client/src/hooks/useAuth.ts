import { useQuery } from "@tanstack/react-query";
import type { UserWithRole } from "@shared/schema";

export function useAuth() {
  const { data: user, isLoading, error } = useQuery<UserWithRole>({
    queryKey: ["/api/auth/user"],
    retry: false,
    throwOnError: false,
    refetchOnWindowFocus: false,
    staleTime: 0, // Always fetch fresh data for auth
    gcTime: 0, // Don't cache auth data
    refetchInterval: false, // Don't auto-refetch
  });

  return {
    user,
    isLoading,
    isAuthenticated: !!user && !error,
    error,
  };
}
