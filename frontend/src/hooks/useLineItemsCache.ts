/**
 * Shared Line Items Cache Hook
 * Loads all line items once and provides local filtering for instant search
 * Used by ItemCodeSelector and SelectionModal for consistent caching
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import lineItemService from '../services/lineItemService';
import { LineItem } from '../types/lineItem';

// Module-level cache to share across all component instances
let cachedLineItems: LineItem[] | null = null;
let cachePromise: Promise<LineItem[]> | null = null;
let cacheTimestamp: number = 0;
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes TTL

interface UseLineItemsCacheResult {
  lineItems: LineItem[];
  isLoading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
  filterBySearch: (searchTerm: string, limit?: number) => LineItem[];
  filterByCategory: (category: string) => LineItem[];
}

export function useLineItemsCache(): UseLineItemsCacheResult {
  const [lineItems, setLineItems] = useState<LineItem[]>(cachedLineItems || []);
  const [isLoading, setIsLoading] = useState(!cachedLineItems);
  const [error, setError] = useState<string | null>(null);

  const loadLineItems = useCallback(async (forceRefresh = false) => {
    const now = Date.now();

    // Return cached data if valid
    if (!forceRefresh && cachedLineItems && (now - cacheTimestamp) < CACHE_TTL) {
      setLineItems(cachedLineItems);
      setIsLoading(false);
      return;
    }

    // If already loading, wait for existing promise
    if (cachePromise && !forceRefresh) {
      try {
        const items = await cachePromise;
        setLineItems(items);
        setIsLoading(false);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load line items');
        setIsLoading(false);
      }
      return;
    }

    setIsLoading(true);
    setError(null);

    // Create new loading promise
    cachePromise = (async () => {
      const response = await lineItemService.getLineItems({
        is_active: true,
        page_size: 500  // Load all items (currently ~122)
      });
      return response.items || [];
    })();

    try {
      const items = await cachePromise;
      cachedLineItems = items;
      cacheTimestamp = Date.now();
      setLineItems(items);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load line items');
      console.error('Failed to load line items for cache:', err);
    } finally {
      setIsLoading(false);
      cachePromise = null;
    }
  }, []);

  // Initial load
  useEffect(() => {
    loadLineItems();
  }, [loadLineItems]);

  // Filter by search term (item code or description)
  const filterBySearch = useCallback((searchTerm: string, limit = 10): LineItem[] => {
    if (!searchTerm || searchTerm.length < 2) {
      return [];
    }

    const lowerSearch = searchTerm.toLowerCase();

    return lineItems
      .filter(item => {
        const itemCode = (item.item || '').toLowerCase();
        const description = (item.description || '').toLowerCase();
        return itemCode.includes(lowerSearch) || description.includes(lowerSearch);
      })
      .slice(0, limit);
  }, [lineItems]);

  // Filter by category
  const filterByCategory = useCallback((category: string): LineItem[] => {
    if (!category || category === 'all') {
      return lineItems;
    }

    const lowerCategory = category.toLowerCase();
    return lineItems.filter(item =>
      (item.cat || '').toLowerCase().includes(lowerCategory)
    );
  }, [lineItems]);

  // Force refresh
  const refetch = useCallback(async () => {
    await loadLineItems(true);
  }, [loadLineItems]);

  return {
    lineItems,
    isLoading,
    error,
    refetch,
    filterBySearch,
    filterByCategory
  };
}

// Utility to invalidate cache (call when line items are added/updated)
export function invalidateLineItemsCache(): void {
  cachedLineItems = null;
  cacheTimestamp = 0;
  cachePromise = null;
}

export default useLineItemsCache;
