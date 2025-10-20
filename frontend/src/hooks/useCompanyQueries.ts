import { useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../api/config';
import type { Company } from '../types';

/**
 * Query keys for company-related queries
 */
export const companyKeys = {
  all: ['companies'] as const,
  lists: () => [...companyKeys.all, 'list'] as const,
  details: () => [...companyKeys.all, 'detail'] as const,
  detail: (id: string) => [...companyKeys.details(), id] as const,
};

/**
 * Fetch all companies
 */
async function fetchCompanies(): Promise<Company[]> {
  const response = await apiClient.get('/api/companies/');
  // Backend returns PaginatedResponse with 'items' field
  return response.data.items || [];
}

/**
 * Hook to fetch all companies with caching
 */
export function useCompanies(enabled = true) {
  return useQuery({
    queryKey: companyKeys.lists(),
    queryFn: fetchCompanies,
    enabled,
    staleTime: 10 * 60 * 1000, // 10 minutes - companies don't change often
    gcTime: 30 * 60 * 1000, // 30 minutes in cache
  });
}

/**
 * Hook to prefetch companies (useful for preloading)
 */
export function usePrefetchCompanies() {
  const queryClient = useQueryClient();

  return () => {
    queryClient.prefetchQuery({
      queryKey: companyKeys.lists(),
      queryFn: fetchCompanies,
      staleTime: 10 * 60 * 1000,
    });
  };
}
