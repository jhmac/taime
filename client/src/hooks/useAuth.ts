import { useQuery } from "@tanstack/react-query";
import type { User } from "@shared/schema";

export function useAuth() {
  const { data: user, isLoading, error } = useQuery<User>({
    queryKey: ["/api/auth/user", Date.now()], // Force cache busting with timestamp
    retry: false,
    throwOnError: false,
    refetchOnWindowFocus: false,
    staleTime: 0, // Data is immediately stale
    cacheTime: 0, // Don't cache at all
  });

  return {
    user,
    isLoading,
    isAuthenticated: !!user && !error,
    error,
  };
}
