import { useQuery } from '@tanstack/react-query';
import type { CompanySettings } from '@shared/schema';

export function useCompanySettings() {
  const { data: settings, isLoading, error } = useQuery<CompanySettings>({
    queryKey: ['/api/company-settings'],
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
  });

  return { settings, isLoading, error };
}
