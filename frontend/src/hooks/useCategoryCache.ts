/**
 * Category Cache Hook
 * Provides efficient React Query-based caching for Line Items categories
 * 
 * Features:
 * - Long staleTime (5 minutes) for category data that changes infrequently
 * - Automatic fallback handling for API failures
 * - Type-safe category operations
 * - Optimized for SelectionModal usage patterns
 */

import { useQuery } from '@tanstack/react-query';
import categoryService, { CategoryOption } from '../services/categoryService';

// Query keys for consistent cache management
export const CATEGORY_QUERY_KEYS = {
  lineItemsCategories: ['categories', 'line-items'] as const,
  lineItemsCategorySearch: (searchTerm: string) => ['categories', 'line-items', 'search', searchTerm] as const,
  categoryLabel: (value: string) => ['categories', 'label', value] as const,
} as const;

/**
 * Hook to get Line Items categories with efficient caching
 * Optimized for SelectionModal dropdown usage
 */
export const useLineItemsCategories = () => {
  return useQuery({
    queryKey: CATEGORY_QUERY_KEYS.lineItemsCategories,
    queryFn: () => categoryService.getLineItemsCategories(),
    staleTime: 5 * 60 * 1000, // 5 minutes - categories don't change frequently
    gcTime: 30 * 60 * 1000, // 30 minutes in memory
    refetchOnWindowFocus: false,
    retry: 1, // Single retry on failure, then use fallback
    meta: {
      errorMessage: 'Failed to load Line Items categories'
    }
  });
};

/**
 * Hook to search Line Items categories with query-based caching
 * Each search term gets its own cache entry for optimal UX
 */
export const useSearchLineItemsCategories = (searchTerm: string, enabled = true) => {
  return useQuery({
    queryKey: CATEGORY_QUERY_KEYS.lineItemsCategorySearch(searchTerm),
    queryFn: () => categoryService.searchLineItemsCategories(searchTerm),
    enabled: enabled && searchTerm.trim().length > 0,
    staleTime: 2 * 60 * 1000, // 2 minutes - search results can be slightly more volatile
    gcTime: 10 * 60 * 1000, // 10 minutes in memory
    refetchOnWindowFocus: false,
    retry: 1,
    meta: {
      errorMessage: 'Failed to search Line Items categories'
    }
  });
};

/**
 * Hook to get category label by value with caching
 * Useful for display purposes when you only have the category value
 */
export const useCategoryLabel = (value: string | undefined, enabled = true) => {
  return useQuery({
    queryKey: CATEGORY_QUERY_KEYS.categoryLabel(value || ''),
    queryFn: () => categoryService.getCategoryLabel(value!),
    enabled: enabled && Boolean(value),
    staleTime: 10 * 60 * 1000, // 10 minutes - labels rarely change
    gcTime: 30 * 60 * 1000, // 30 minutes in memory
    refetchOnWindowFocus: false,
    retry: 1,
    meta: {
      errorMessage: 'Failed to get category label'
    }
  });
};

/**
 * Utility hook that combines category loading with loading states
 * Provides a more convenient interface for components
 */
export const useCategoryOptions = () => {
  const { data: categories, isLoading, error, isError } = useLineItemsCategories();
  
  return {
    categories: categories || [],
    isLoading,
    error,
    isError,
    isEmpty: !isLoading && (!categories || categories.length === 0)
  };
};

/**
 * Hook for category validation with caching
 * Useful for form validation scenarios
 */
export const useCategoryValidation = () => {
  const { categories } = useCategoryOptions();
  
  const isValidCategory = (value: string): boolean => {
    if (!value || value === 'all') return true;
    return categories.some(cat => cat.value === value);
  };
  
  const getCategoryByValue = (value: string): CategoryOption | undefined => {
    return categories.find(cat => cat.value === value);
  };
  
  return {
    isValidCategory,
    getCategoryByValue,
    categories
  };
};