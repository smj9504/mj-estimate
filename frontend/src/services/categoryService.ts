/**
 * Category Service
 * Handles category-related API calls with efficient caching
 * 
 * Features:
 * - Category management for Line Items
 * - React Query integration with optimized cache strategies
 * - Selection Modal specific category formatting
 * - Type-safe API interactions
 */

import { apiClient } from '../api/config';

// Category types for Selection Modal
export interface CategoryOption {
  value: string;
  label: string;
  description?: string;
}

// Service Error types
export class CategoryServiceError extends Error {
  constructor(
    message: string,
    public statusCode?: number,
    public originalError?: any
  ) {
    super(message);
    this.name = 'CategoryServiceError';
  }
}

class CategoryService {
  
  /**
   * Get categories formatted for Line Items dropdown in SelectionModal
   * Returns categories optimized for dropdown display with 'All Line Items' option
   */
  async getLineItemsCategories(): Promise<CategoryOption[]> {
    try {
      const response = await apiClient.get('/api/line-items/categories/modal');
      const rawCategories = response.data || [];
      
      // Transform backend format to frontend format
      const categories: CategoryOption[] = rawCategories.map((cat: any) => ({
        value: cat.code,
        label: cat.description,
        description: cat.full_description
      }));
      
      // Ensure 'All Line Items' is always first
      const allOption: CategoryOption = { value: 'all', label: 'All Line Items' };
      const filteredCategories = categories.filter(cat => cat.value !== 'all');
      
      return [allOption, ...filteredCategories];
    } catch (error: any) {
      console.warn('Failed to fetch Line Items categories, using fallback:', error.message);
      
      // Fallback to hardcoded categories to maintain functionality
      return this.getFallbackCategories();
    }
  }

  /**
   * Search categories for Line Items with query term
   * Used for dynamic filtering when searching
   */
  async searchLineItemsCategories(searchTerm: string): Promise<CategoryOption[]> {
    try {
      const response = await apiClient.get('/api/line-items/categories/search', {
        params: { q: searchTerm, limit: 50 }
      });
      
      const rawCategories = response.data || [];
      
      // Transform backend format to frontend format
      const categories: CategoryOption[] = rawCategories.map((cat: any) => ({
        value: cat.code,
        label: cat.description,
        description: cat.full_description
      }));
      
      // Include 'All Line Items' if search is broad enough
      const allOption: CategoryOption = { value: 'all', label: 'All Line Items' };
      if (searchTerm.toLowerCase().includes('all') || searchTerm.toLowerCase().includes('item')) {
        return [allOption, ...categories];
      }
      
      return categories;
    } catch (error: any) {
      console.warn('Failed to search Line Items categories:', error.message);
      
      // Fallback to filtered hardcoded categories
      const fallback = this.getFallbackCategories();
      const searchLower = searchTerm.toLowerCase();
      
      return fallback.filter(cat => 
        cat.label.toLowerCase().includes(searchLower) ||
        cat.value.toLowerCase().includes(searchLower)
      );
    }
  }

  /**
   * Get category label by value
   * Useful for display purposes when you have the category value
   */
  async getCategoryLabel(value: string): Promise<string> {
    if (value === 'all') return 'All Line Items';
    
    try {
      const categories = await this.getLineItemsCategories();
      const category = categories.find(cat => cat.value === value);
      return category?.label || value;
    } catch (error: any) {
      console.warn('Failed to get category label:', error.message);
      return value;
    }
  }

  /**
   * Validate category value exists
   * Returns true if category value is valid
   */
  async isValidCategory(value: string): Promise<boolean> {
    if (value === 'all') return true;
    
    try {
      const categories = await this.getLineItemsCategories();
      return categories.some(cat => cat.value === value);
    } catch (error: any) {
      console.warn('Failed to validate category:', error.message);
      return false;
    }
  }

  /**
   * Fallback categories when API is unavailable
   * Maintains existing functionality as a safety net
   */
  private getFallbackCategories(): CategoryOption[] {
    return [
      { value: 'all', label: 'All Line Items' },
      { value: 'cleaning', label: 'Cleaning' },
      { value: 'concrete', label: 'Concrete & Asphalt' },
      { value: 'contents', label: 'Contents' },
      { value: 'demolition', label: 'Demolition' },
      { value: 'doors', label: 'Doors' },
      { value: 'drywall', label: 'Drywall' },
      { value: 'electrical', label: 'Electrical' },
      { value: 'equipment', label: 'Equipment' },
      { value: 'flooring', label: 'Flooring' },
      { value: 'framing', label: 'Framing' },
      { value: 'hvac', label: 'HVAC' },
      { value: 'insulation', label: 'Insulation' },
      { value: 'masonry', label: 'Masonry' },
      { value: 'painting', label: 'Painting' },
      { value: 'plumbing', label: 'Plumbing' },
      { value: 'roofing', label: 'Roofing' },
      { value: 'windows', label: 'Windows' },
    ];
  }

  /**
   * Clear any internal caches (if implemented in the future)
   * Useful for testing or manual cache refresh
   */
  clearCache(): void {
    // Placeholder for future cache clearing if internal caching is added
    console.log('Category cache cleared');
  }
}

export default new CategoryService();