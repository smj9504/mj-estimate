import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CategoryModalItem } from '../types/lineItem';
import { apiClient } from '../api/config';

/**
 * Simple hook to get categories with automatic loading using React Query
 * Perfect for components that just need the category list without complex state management
 */
export const useCategories = () => {
  const queryClient = useQueryClient();
  
  const { data: categories = [], isLoading: loading, error, refetch } = useQuery({
    queryKey: ['categories'],
    queryFn: async (): Promise<CategoryModalItem[]> => {
      const response = await apiClient.get<CategoryModalItem[]>('/api/line-items/categories/modal');
      return response.data;
    },
    staleTime: 5 * 60 * 1000, // 5 minutes
    gcTime: 10 * 60 * 1000, // 10 minutes
    refetchOnMount: false,
    refetchOnWindowFocus: false,
  });

  const refresh = async () => {
    await refetch();
  };

  // Check if data is stale (older than 5 minutes)
  const isStale = () => {
    const state = queryClient.getQueryState(['categories']);
    if (!state?.dataUpdatedAt) return true;
    const staleTime = 5 * 60 * 1000; // 5 minutes
    return Date.now() - state.dataUpdatedAt > staleTime;
  };

  // For CacheMonitor compatibility - provide metrics and invalidateCache
  const metrics = {
    hitCount: 0, // React Query doesn't expose this directly
    missCount: 0,
    lastUpdate: queryClient.getQueryState(['categories'])?.dataUpdatedAt ? 
      new Date(queryClient.getQueryState(['categories'])!.dataUpdatedAt!) : null,
    size: categories.length,
  };

  const invalidateCache = () => {
    queryClient.invalidateQueries({ queryKey: ['categories'] });
  };

  return {
    categories,
    loading,
    error: error?.message || null,
    refresh,
    isStale: isStale(),
    metrics,
    invalidateCache,
  };
};

/**
 * Hook for searching categories with built-in caching
 */
export const useCategorySearch = () => {
  const { categories } = useCategories();

  const search = async (searchTerm: string): Promise<CategoryModalItem[]> => {
    // Perform local search on cached categories
    const results = categories.filter(category =>
      category.code.toLowerCase().includes(searchTerm.toLowerCase()) ||
      category.description.toLowerCase().includes(searchTerm.toLowerCase()) ||
      category.full_description.toLowerCase().includes(searchTerm.toLowerCase())
    );
    
    return results;
  };

  return {
    search,
    loading: false, // Local search is instant
  };
};