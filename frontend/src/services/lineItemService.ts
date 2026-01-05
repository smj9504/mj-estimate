/**
 * Line Item Service
 * Handles all line item related API calls for the MJ Estimate Generator
 * 
 * Features:
 * - Xactimate line item search and management
 * - Custom line item CRUD operations
 * - Category management with caching
 * - Note and template management
 * - Tax calculations
 * - Invoice/Estimate integration
 */

import { AxiosError } from 'axios';
import { apiClient } from '../api/config';
import {
  LineItem,
  LineItemCreate,
  LineItemUpdate,
  LineItemSearch,
  LineItemCategory,
  LineItemNote,
  LineItemTemplate,
  TaxCalculationRequest,
  TaxCalculationResponse,
  DocumentLineItem,
  InvoiceLineItemCreate,
  EstimateLineItemCreate,
  AdvancedSearchParams,
  PaginatedResponse,
  TemplateApplicationResult,
  ImportResult,
  UsageStatistics,
  BulkUpdateRequest,
  BulkOperationResult,
  CategoryModalItem,
  LineItemModalItem
} from '../types/lineItem';

/**
 * Helper function to extract error message from unknown error type
 */
function getErrorMessage(error: unknown): string {
  if (error instanceof AxiosError) {
    return error.message;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

/**
 * Helper function to extract status code from error
 */
function getErrorStatus(error: unknown): number | undefined {
  if (error instanceof AxiosError) {
    return error.response?.status;
  }
  return undefined;
}

// Service Error types
export class LineItemServiceError extends Error {
  constructor(
    message: string,
    public statusCode?: number,
    public originalError?: unknown
  ) {
    super(message);
    this.name = 'LineItemServiceError';
  }
}

class LineItemService {
  // =====================================================
  // Category Management
  // =====================================================
  
  /**
   * Get all categories with code and name mapping
   */
  async getCategories(includeInactive = false): Promise<LineItemCategory[]> {
    try {
      const response = await apiClient.get('/api/line-items/categories', {
        params: { include_inactive: includeInactive }
      });
      return response.data.items || response.data;
    } catch (error) {
      throw new LineItemServiceError(
        `Failed to fetch categories: ${getErrorMessage(error)}`,
        getErrorStatus(error),
        error
      );
    }
  }

  /**
   * Search categories by code or name
   */
  async searchCategories(searchTerm: string): Promise<LineItemCategory[]> {
    try {
      const response = await apiClient.get('/api/line-items/categories/search', {
        params: { q: searchTerm }
      });
      return response.data.items || response.data;
    } catch (error) {
      throw new LineItemServiceError(
        `Failed to search categories: ${getErrorMessage(error)}`,
        getErrorStatus(error),
        error
      );
    }
  }

  /**
   * Get categories formatted for modal display
   */
  async getCategoriesForModal(includeInactive = false): Promise<CategoryModalItem[]> {
    try {
      const response = await apiClient.get('/api/line-items/categories/modal', {
        params: { include_inactive: includeInactive }
      });
      return response.data || [];
    } catch (error: any) {
      // Return empty array on error to prevent modal crashes
      console.warn('Failed to fetch categories for modal:', error.message);
      return [];
    }
  }

  /**
   * Search categories for modal with enhanced search
   */
  async searchCategoriesForModal(searchTerm: string, limit = 20): Promise<CategoryModalItem[]> {
    try {
      const response = await apiClient.get('/api/line-items/categories/search', {
        params: { q: searchTerm, limit }
      });
      return response.data || [];
    } catch (error: any) {
      // Return empty array on error
      console.warn('Failed to search categories for modal:', error.message);
      return [];
    }
  }

  /**
   * Get category name by code (with caching)
   */
  private categoryCache: Map<string, LineItemCategory> = new Map();
  
  async getCategoryName(code: string): Promise<string> {
    // Check cache first
    if (this.categoryCache.has(code)) {
      return this.categoryCache.get(code)!.name;
    }
    
    // Load all categories if cache is empty
    if (this.categoryCache.size === 0) {
      const categories = await this.getCategories();
      categories.forEach(cat => {
        this.categoryCache.set(cat.code, cat);
      });
    }
    
    return this.categoryCache.get(code)?.name || code;
  }

  /**
   * Create new category (admin only)
   */
  async createCategory(category: Omit<LineItemCategory, 'created_at' | 'updated_at'>): Promise<LineItemCategory> {
    try {
      const response = await apiClient.post('/api/line-items/categories', category);
      // Clear cache to force reload
      this.categoryCache.clear();
      return response.data;
    } catch (error) {
      throw new LineItemServiceError(
        `Failed to create category: ${getErrorMessage(error)}`,
        getErrorStatus(error),
        error
      );
    }
  }

  /**
   * Update category (admin only)
   */
  async updateCategory(code: string, updates: Partial<LineItemCategory>): Promise<LineItemCategory> {
    try {
      const response = await apiClient.put(`/api/line-items/categories/${code}`, updates);
      // Clear cache to force reload
      this.categoryCache.clear();
      return response.data;
    } catch (error) {
      throw new LineItemServiceError(
        `Failed to update category: ${getErrorMessage(error)}`,
        getErrorStatus(error),
        error
      );
    }
  }

  /**
   * Delete category (admin only)
   */
  async deleteCategory(code: string): Promise<void> {
    try {
      await apiClient.delete(`/api/line-items/categories/${code}`);
      // Clear cache to force reload
      this.categoryCache.clear();
    } catch (error) {
      throw new LineItemServiceError(
        `Failed to delete category: ${getErrorMessage(error)}`,
        getErrorStatus(error),
        error
      );
    }
  }

  // =====================================================
  // Line Item CRUD
  // =====================================================

  /**
   * Get line items with filters (pagination support)
   */
  async getLineItems(params?: {
    search?: string;
    category?: string;
    type?: string;
    is_active?: boolean;
    page?: number;
    page_size?: number;
  }): Promise<PaginatedResponse<LineItem>> {
    try {
      const response = await apiClient.get('/api/line-items/', { params });
      return response.data;
    } catch (error) {
      throw new LineItemServiceError(
        `Failed to get line items: ${getErrorMessage(error)}`,
        getErrorStatus(error),
        error
      );
    }
  }

  /**
   * Search line items with basic filters
   */
  async searchLineItems(params: LineItemSearch): Promise<PaginatedResponse<LineItem>> {
    try {
      const response = await apiClient.get('/api/line-items', { params });
      return response.data;
    } catch (error) {
      throw new LineItemServiceError(
        `Failed to search line items: ${getErrorMessage(error)}`,
        getErrorStatus(error),
        error
      );
    }
  }

  /**
   * Get line items formatted for modal display (unified search - includes both Xactimate and custom)
   */
  async getLineItemsForModal(params: {
    category?: string;
    search_term?: string;
    page?: number;
    page_size?: number;
  } = {}): Promise<LineItemModalItem[]> {
    try {
      const response = await apiClient.get('/api/xactimate/unified/search', {
        params: {
          category: params.category,
          search_term: params.search_term,
          item_type: 'ALL', // Include both Xactimate and custom items
          page: params.page || 1,
          page_size: params.page_size || 50
        }
      });
      console.log('lineItemService: Raw unified API response:', response);
      console.log('lineItemService: Response data:', response.data);
      
      // Transform unified response to modal format
      const unifiedItems = response.data?.items || [];
      const modalItems = unifiedItems.map((item: any) => {
        // Transform unified format to modal format
        const modalItem: LineItemModalItem = {
          id: item.id,
          component_code: item.item, // Use 'item' field as component_code
          item_code: item.item, // Also provide item_code for backward compatibility
          description: item.description || 'No description',
          unit: item.unit || 'EA',
          act: item.type === 'XACTIMATE' ? '&' : '+', // "&" for Xactimate, "+" for custom
          unit_price: parseFloat(item.untaxed_unit_price || 0),
          category: item.cat || '',
          type: item.type || 'CUSTOM',
          includes: item.includes || '', // Work description/notes
        };
        
        console.log('lineItemService: Transformed item:', {
          original: item,
          transformed: modalItem
        });
        
        return modalItem;
      });
      
      console.log('lineItemService: Final modal items:', modalItems);
      console.log('lineItemService: Item count by type:', {
        xactimate: modalItems.filter((item: LineItemModalItem) => item.type === 'XACTIMATE').length,
        custom: modalItems.filter((item: LineItemModalItem) => item.type === 'CUSTOM').length,
        total: modalItems.length
      });
      
      return modalItems;
    } catch (error: any) {
      // Fallback to the original endpoint if unified search fails
      console.warn('Unified search failed, falling back to custom items only:', error.message);
      try {
        const fallbackResponse = await apiClient.get('/api/line-items/modal/items', {
          params: {
            category: params.category,
            search_term: params.search_term,
            page: params.page || 1,
            page_size: params.page_size || 50
          }
        });
        const items = Array.isArray(fallbackResponse.data) ? fallbackResponse.data : [];
        console.log('lineItemService: Fallback items:', items);
        return items;
      } catch (fallbackError: any) {
        console.error('Both unified and fallback requests failed:', fallbackError);
        return [];
      }
    }
  }

  /**
   * Simple search for line items without authentication (for autocomplete)
   */
  async searchLineItemsSimple(
    searchQuery: string,
    limit = 10
  ): Promise<LineItemModalItem[]> {
    try {
      const response = await apiClient.get('/api/line-items/modal/search', {
        params: {
          q: searchQuery,
          limit: limit
        }
      });
      return response.data || [];
    } catch (error: any) {
      console.error('Simple line item search failed:', error);
      return [];
    }
  }

  /**
   * Search line items for modal with multi-keyword support (unified search)
   */
  async searchLineItemsForModal(
    searchQuery: string,
    category?: string,
    limit = 100
  ): Promise<LineItemModalItem[]> {
    try {
      const response = await apiClient.get('/api/xactimate/unified/search', {
        params: {
          search_term: searchQuery,
          category: category,
          item_type: 'ALL', // Include both Xactimate and custom items
          page: 1,
          page_size: limit
        }
      });
      
      // Transform unified response to modal format (same logic as getLineItemsForModal)
      const unifiedItems = response.data?.items || [];
      const modalItems = unifiedItems.map((item: any) => {
        const modalItem: LineItemModalItem = {
          id: item.id,
          component_code: item.item,
          item_code: item.item,
          description: item.description || 'No description',
          unit: item.unit || 'EA',
          act: item.type === 'XACTIMATE' ? '&' : '+',
          unit_price: parseFloat(item.untaxed_unit_price || 0),
          category: item.cat || '',
          type: item.type || 'CUSTOM',
          includes: item.includes || '', // Work description/notes
        };
        return modalItem;
      });
      
      console.log('lineItemService: Search results:', {
        query: searchQuery,
        category: category,
        totalResults: modalItems.length,
        xactimateCount: modalItems.filter((item: LineItemModalItem) => item.type === 'XACTIMATE').length,
        customCount: modalItems.filter((item: LineItemModalItem) => item.type === 'CUSTOM').length
      });
      
      return modalItems;
    } catch (error: any) {
      // Fallback to the original search endpoint
      console.warn('Unified search failed, falling back to custom search only:', error.message);
      try {
        const fallbackResponse = await apiClient.get('/api/line-items/modal/search', {
          params: {
            q: searchQuery,
            category,
            limit
          }
        });
        return fallbackResponse.data || [];
      } catch (fallbackError: any) {
        console.error('Both unified and fallback search failed:', fallbackError);
        return [];
      }
    }
  }

  /**
   * Advanced search with multiple filters
   */
  async advancedSearchLineItems(params: AdvancedSearchParams): Promise<PaginatedResponse<LineItem>> {
    try {
      const response = await apiClient.get('/api/line-items/search', { params });
      return response.data;
    } catch (error) {
      throw new LineItemServiceError(
        `Failed to perform advanced search: ${getErrorMessage(error)}`,
        getErrorStatus(error),
        error
      );
    }
  }

  /**
   * Get single line item by ID
   */
  async getLineItem(id: string): Promise<LineItem> {
    try {
      const response = await apiClient.get(`/api/line-items/${id}`);
      return response.data;
    } catch (error) {
      throw new LineItemServiceError(
        `Failed to fetch line item: ${getErrorMessage(error)}`,
        getErrorStatus(error),
        error
      );
    }
  }

  /**
   * Create new line item
   */
  async createLineItem(lineItem: LineItemCreate): Promise<LineItem> {
    try {
      const response = await apiClient.post('/api/line-items/', lineItem);
      return response.data;
    } catch (error) {
      throw new LineItemServiceError(
        `Failed to create line item: ${getErrorMessage(error)}`,
        getErrorStatus(error),
        error
      );
    }
  }

  /**
   * Create or update a line item based on item code and company_id.
   * If item code already exists, updates the existing item instead of creating a duplicate.
   */
  async upsertLineItem(lineItem: LineItemCreate): Promise<{ line_item: LineItem; is_created: boolean; message: string }> {
    try {
      const response = await apiClient.post('/api/line-items/upsert', lineItem);
      return response.data;
    } catch (error) {
      throw new LineItemServiceError(
        `Failed to save line item: ${getErrorMessage(error)}`,
        getErrorStatus(error),
        error
      );
    }
  }

  /**
   * Update existing line item
   */
  async updateLineItem(id: string, updates: LineItemUpdate): Promise<LineItem> {
    try {
      const response = await apiClient.put(`/api/line-items/${id}`, updates);
      return response.data;
    } catch (error) {
      throw new LineItemServiceError(
        `Failed to update line item: ${getErrorMessage(error)}`,
        getErrorStatus(error),
        error
      );
    }
  }

  /**
   * Delete line item (soft delete)
   */
  async deleteLineItem(id: string): Promise<void> {
    try {
      await apiClient.delete(`/api/line-items/${id}`);
    } catch (error) {
      throw new LineItemServiceError(
        `Failed to delete line item: ${getErrorMessage(error)}`,
        getErrorStatus(error),
        error
      );
    }
  }

  /**
   * Bulk delete line items (soft delete)
   */
  async deleteLineItems(ids: string[]): Promise<void> {
    try {
      await apiClient.delete('/api/line-items/bulk', { data: ids });
    } catch (error) {
      throw new LineItemServiceError(
        `Failed to bulk delete line items: ${getErrorMessage(error)}`,
        getErrorStatus(error),
        error
      );
    }
  }

  /**
   * Bulk create line items
   */
  async bulkCreateLineItems(items: LineItemCreate[]): Promise<LineItem[]> {
    try {
      const response = await apiClient.post('/api/line-items/bulk', { items });
      return response.data.items || response.data;
    } catch (error) {
      throw new LineItemServiceError(
        `Failed to bulk create line items: ${getErrorMessage(error)}`,
        getErrorStatus(error),
        error
      );
    }
  }

  /**
   * Bulk update line items
   */
  async bulkUpdateLineItems(updates: BulkUpdateRequest[]): Promise<BulkOperationResult<LineItem>> {
    try {
      const response = await apiClient.put('/api/line-items/bulk', { updates });
      return response.data;
    } catch (error) {
      throw new LineItemServiceError(
        `Failed to bulk update line items: ${getErrorMessage(error)}`,
        getErrorStatus(error),
        error
      );
    }
  }

  /**
   * Bulk delete line items
   */
  async bulkDeleteLineItems(ids: string[]): Promise<void> {
    try {
      await apiClient.delete('/api/line-items/bulk', { data: ids });
    } catch (error) {
      throw new LineItemServiceError(
        `Failed to bulk delete line items: ${getErrorMessage(error)}`,
        getErrorStatus(error),
        error
      );
    }
  }

  // =====================================================
  // Note Management
  // =====================================================
  
  /**
   * Get all notes with filtering
   */
  async getNotes(companyId?: string, category?: string, isTemplate?: boolean): Promise<LineItemNote[]> {
    try {
      const response = await apiClient.get('/api/line-items/notes', {
        params: { 
          company_id: companyId, 
          category,
          is_template: isTemplate
        }
      });
      return response.data.items || response.data;
    } catch (error) {
      throw new LineItemServiceError(
        `Failed to fetch notes: ${getErrorMessage(error)}`,
        getErrorStatus(error),
        error
      );
    }
  }

  /**
   * Get single note by ID
   */
  async getNote(id: string): Promise<LineItemNote> {
    try {
      const response = await apiClient.get(`/api/line-items/notes/${id}`);
      return response.data;
    } catch (error) {
      throw new LineItemServiceError(
        `Failed to fetch note: ${getErrorMessage(error)}`,
        getErrorStatus(error),
        error
      );
    }
  }

  /**
   * Create new note
   */
  async createNote(note: Omit<LineItemNote, 'id' | 'created_at' | 'updated_at'>): Promise<LineItemNote> {
    try {
      const response = await apiClient.post('/api/line-items/notes', note);
      return response.data;
    } catch (error) {
      throw new LineItemServiceError(
        `Failed to create note: ${getErrorMessage(error)}`,
        getErrorStatus(error),
        error
      );
    }
  }

  /**
   * Update note
   */
  async updateNote(id: string, updates: Partial<LineItemNote>): Promise<LineItemNote> {
    try {
      const response = await apiClient.put(`/api/line-items/notes/${id}`, updates);
      return response.data;
    } catch (error) {
      throw new LineItemServiceError(
        `Failed to update note: ${getErrorMessage(error)}`,
        getErrorStatus(error),
        error
      );
    }
  }

  /**
   * Delete note
   */
  async deleteNote(id: string): Promise<void> {
    try {
      await apiClient.delete(`/api/line-items/notes/${id}`);
    } catch (error) {
      throw new LineItemServiceError(
        `Failed to delete note: ${getErrorMessage(error)}`,
        getErrorStatus(error),
        error
      );
    }
  }

  /**
   * Get notes for a specific line item
   */
  async getLineItemNotes(lineItemId: string): Promise<LineItemNote[]> {
    try {
      const response = await apiClient.get(`/api/line-items/${lineItemId}/notes`);
      // Backend returns empty array if no notes exist (not an error)
      return response.data.items || response.data || [];
    } catch (error: any) {
      // If 404, return empty array (line item has no notes - this is normal)
      if (error.response?.status === 404) {
        return [];
      }
      throw new LineItemServiceError(
        `Failed to fetch line item notes: ${getErrorMessage(error)}`,
        getErrorStatus(error),
        error
      );
    }
  }

  /**
   * Create note for a specific line item
   */
  async createLineItemNote(lineItemId: string, noteData: Omit<LineItemNote, 'id' | 'created_at' | 'updated_at'>): Promise<LineItemNote> {
    try {
      const response = await apiClient.post(`/api/line-items/${lineItemId}/notes`, noteData);
      return response.data;
    } catch (error) {
      throw new LineItemServiceError(
        `Failed to create line item note: ${getErrorMessage(error)}`,
        getErrorStatus(error),
        error
      );
    }
  }

  /**
   * Update note for a specific line item
   */
  async updateLineItemNote(lineItemId: string, noteId: string, noteData: Partial<LineItemNote>): Promise<LineItemNote> {
    try {
      const response = await apiClient.put(`/api/line-items/${lineItemId}/notes/${noteId}`, noteData);
      return response.data;
    } catch (error) {
      throw new LineItemServiceError(
        `Failed to update line item note: ${getErrorMessage(error)}`,
        getErrorStatus(error),
        error
      );
    }
  }

  /**
   * Delete note from a specific line item
   */
  async deleteLineItemNote(lineItemId: string, noteId: string): Promise<void> {
    try {
      await apiClient.delete(`/api/line-items/${lineItemId}/notes/${noteId}`);
    } catch (error) {
      throw new LineItemServiceError(
        `Failed to delete line item note: ${getErrorMessage(error)}`,
        getErrorStatus(error),
        error
      );
    }
  }

  /**
   * Reorder notes for a specific line item
   */
  async reorderLineItemNotes(lineItemId: string, noteOrders: Array<{ id: string; order_index: number }>): Promise<void> {
    try {
      await apiClient.put(`/api/line-items/${lineItemId}/notes/reorder`, { note_orders: noteOrders });
    } catch (error) {
      throw new LineItemServiceError(
        `Failed to reorder line item notes: ${getErrorMessage(error)}`,
        getErrorStatus(error),
        error
      );
    }
  }

  /**
   * Associate note with line item
   */
  async associateNoteWithLineItem(lineItemId: string, noteId: string): Promise<void> {
    try {
      await apiClient.post(`/api/line-items/${lineItemId}/notes/${noteId}`);
    } catch (error) {
      throw new LineItemServiceError(
        `Failed to associate note with line item: ${getErrorMessage(error)}`,
        getErrorStatus(error),
        error
      );
    }
  }

  /**
   * Remove note from line item
   */
  async removeNoteFromLineItem(lineItemId: string, noteId: string): Promise<void> {
    try {
      await apiClient.delete(`/api/line-items/${lineItemId}/notes/${noteId}`);
    } catch (error) {
      throw new LineItemServiceError(
        `Failed to remove note from line item: ${getErrorMessage(error)}`,
        getErrorStatus(error),
        error
      );
    }
  }

  /**
   * Get note templates
   */
  async getNoteTemplates(category?: string): Promise<LineItemNote[]> {
    try {
      // Only include category param if it has a value
      const params: any = {};
      if (category && category !== 'undefined') {
        params.category = category;
      }
      
      const response = await apiClient.get('/api/line-items/notes/templates', {
        params
      });
      return response.data.items || response.data;
    } catch (error) {
      throw new LineItemServiceError(
        `Failed to fetch note templates: ${getErrorMessage(error)}`,
        getErrorStatus(error),
        error
      );
    }
  }

  // =====================================================
  // Template Management
  // =====================================================
  
  /**
   * Get all templates with filtering
   */
  async getTemplates(companyId?: string, category?: string, isActive = true): Promise<LineItemTemplate[]> {
    try {
      const response = await apiClient.get('/api/line-items/templates', {
        params: { company_id: companyId, category, is_active: isActive }
      });
      return response.data.items || response.data;
    } catch (error) {
      throw new LineItemServiceError(
        `Failed to fetch templates: ${getErrorMessage(error)}`,
        getErrorStatus(error),
        error
      );
    }
  }

  /**
   * Get single template by ID with full details
   */
  async getTemplate(id: string): Promise<LineItemTemplate> {
    try {
      const response = await apiClient.get(`/api/line-items/templates/${id}`);
      return response.data;
    } catch (error) {
      throw new LineItemServiceError(
        `Failed to fetch template: ${getErrorMessage(error)}`,
        getErrorStatus(error),
        error
      );
    }
  }

  /**
   * Create new template
   */
  async createTemplate(template: {
    name: string;
    description?: string;
    category?: string;
    company_id?: string;
    line_item_ids: Array<{
      line_item_id?: string;
      quantity_multiplier?: number;
      order_index?: number;
      embedded_data?: {
        item_code: string;
        description: string;
        unit: string;
        rate: number;
      };
    }>;
  }): Promise<LineItemTemplate> {
    try {
      const response = await apiClient.post('/api/line-items/templates', template);
      return response.data;
    } catch (error) {
      throw new LineItemServiceError(
        `Failed to create template: ${getErrorMessage(error)}`,
        getErrorStatus(error),
        error
      );
    }
  }

  /**
   * Update template
   */
  async updateTemplate(id: string, updates: Partial<LineItemTemplate>): Promise<LineItemTemplate> {
    try {
      const response = await apiClient.put(`/api/line-items/templates/${id}`, updates);
      return response.data;
    } catch (error) {
      throw new LineItemServiceError(
        `Failed to update template: ${getErrorMessage(error)}`,
        getErrorStatus(error),
        error
      );
    }
  }

  /**
   * Delete template (soft delete)
   */
  async deleteTemplate(id: string): Promise<void> {
    try {
      await apiClient.delete(`/api/line-items/templates/${id}`);
    } catch (error) {
      throw new LineItemServiceError(
        `Failed to delete template: ${getErrorMessage(error)}`,
        getErrorStatus(error),
        error
      );
    }
  }

  /**
   * Apply template to invoice or estimate
   */
  async applyTemplate(params: {
    template_id: string;
    target_type: 'invoice' | 'estimate' | 'work_order';
    target_id: string;
    quantity_multiplier?: number;
    room?: string; // For estimates
  }): Promise<TemplateApplicationResult> {
    try {
      const response = await apiClient.post('/api/line-items/templates/apply', params);
      return response.data;
    } catch (error) {
      throw new LineItemServiceError(
        `Failed to apply template: ${getErrorMessage(error)}`,
        getErrorStatus(error),
        error
      );
    }
  }

  /**
   * Duplicate existing template
   */
  async duplicateTemplate(id: string, newName: string, newDescription?: string): Promise<LineItemTemplate> {
    try {
      const response = await apiClient.post(`/api/line-items/templates/${id}/duplicate`, {
        name: newName,
        description: newDescription
      });
      return response.data;
    } catch (error) {
      throw new LineItemServiceError(
        `Failed to duplicate template: ${getErrorMessage(error)}`,
        getErrorStatus(error),
        error
      );
    }
  }

  // =====================================================
  // Tax Calculation
  // =====================================================
  
  /**
   * Calculate tax for a line item with detailed breakdown
   */
  async calculateTax(request: TaxCalculationRequest): Promise<TaxCalculationResponse> {
    try {
      const response = await apiClient.post('/api/line-items/tax/calculate', request);
      return response.data;
    } catch (error) {
      throw new LineItemServiceError(
        `Failed to calculate tax: ${getErrorMessage(error)}`,
        getErrorStatus(error),
        error
      );
    }
  }

  /**
   * Batch calculate tax for multiple line items
   */
  async batchCalculateTax(requests: TaxCalculationRequest[]): Promise<TaxCalculationResponse[]> {
    try {
      const response = await apiClient.post('/api/line-items/tax/calculate/batch', { requests });
      return response.data;
    } catch (error) {
      throw new LineItemServiceError(
        `Failed to batch calculate tax: ${getErrorMessage(error)}`,
        getErrorStatus(error),
        error
      );
    }
  }

  // =====================================================
  // Invoice/Estimate Integration
  // =====================================================
  
  /**
   * Add line item to invoice
   */
  async addLineItemToInvoice(invoiceId: string, item: InvoiceLineItemCreate): Promise<{
    success: boolean;
    invoice_item_id: string;
    line_item_id: string;
    created_item?: DocumentLineItem;
  }> {
    try {
      const response = await apiClient.post(`/api/line-items/invoice/${invoiceId}/items`, item);
      return response.data;
    } catch (error) {
      throw new LineItemServiceError(
        `Failed to add line item to invoice: ${getErrorMessage(error)}`,
        getErrorStatus(error),
        error
      );
    }
  }

  /**
   * Add line item to estimate
   */
  async addLineItemToEstimate(estimateId: string, item: EstimateLineItemCreate): Promise<{
    success: boolean;
    estimate_item_id: string;
    line_item_id: string;
    created_item?: DocumentLineItem;
  }> {
    try {
      const response = await apiClient.post(`/api/line-items/estimate/${estimateId}/items`, item);
      return response.data;
    } catch (error) {
      throw new LineItemServiceError(
        `Failed to add line item to estimate: ${getErrorMessage(error)}`,
        getErrorStatus(error),
        error
      );
    }
  }

  /**
   * Get optimized invoice items (prevents N+1 queries)
   */
  async getOptimizedInvoiceItems(invoiceId: string): Promise<DocumentLineItem[]> {
    try {
      const response = await apiClient.get(`/api/line-items/invoice/${invoiceId}/items/optimized`);
      return response.data.items || response.data;
    } catch (error) {
      throw new LineItemServiceError(
        `Failed to fetch optimized invoice items: ${getErrorMessage(error)}`,
        getErrorStatus(error),
        error
      );
    }
  }

  /**
   * Get optimized estimate items (prevents N+1 queries)
   */
  async getOptimizedEstimateItems(estimateId: string): Promise<DocumentLineItem[]> {
    try {
      const response = await apiClient.get(`/api/line-items/estimate/${estimateId}/items/optimized`);
      return response.data.items || response.data;
    } catch (error) {
      throw new LineItemServiceError(
        `Failed to fetch optimized estimate items: ${getErrorMessage(error)}`,
        getErrorStatus(error),
        error
      );
    }
  }

  /**
   * Update line item in document (invoice/estimate)
   */
  async updateDocumentLineItem(
    documentType: 'invoice' | 'estimate', 
    documentId: string, 
    itemId: string, 
    updates: Partial<DocumentLineItem>
  ): Promise<DocumentLineItem> {
    try {
      const response = await apiClient.put(`/api/line-items/${documentType}/${documentId}/items/${itemId}`, updates);
      return response.data;
    } catch (error) {
      throw new LineItemServiceError(
        `Failed to update document line item: ${getErrorMessage(error)}`,
        getErrorStatus(error),
        error
      );
    }
  }

  /**
   * Remove line item from document
   */
  async removeLineItemFromDocument(
    documentType: 'invoice' | 'estimate',
    documentId: string, 
    itemId: string
  ): Promise<void> {
    try {
      await apiClient.delete(`/api/line-items/${documentType}/${documentId}/items/${itemId}`);
    } catch (error) {
      throw new LineItemServiceError(
        `Failed to remove line item from document: ${getErrorMessage(error)}`,
        getErrorStatus(error),
        error
      );
    }
  }

  // =====================================================
  // Utility Methods
  // =====================================================

  /**
   * Export line items to CSV
   */
  async exportToCSV(filters?: LineItemSearch): Promise<Blob> {
    try {
      const response = await apiClient.get('/api/line-items/export/csv', {
        params: filters,
        responseType: 'blob'
      });
      return new Blob([response.data], { type: 'text/csv' });
    } catch (error) {
      throw new LineItemServiceError(
        `Failed to export line items: ${getErrorMessage(error)}`,
        getErrorStatus(error),
        error
      );
    }
  }

  /**
   * Import line items from CSV
   */
  async importFromCSV(file: File, companyId?: string): Promise<ImportResult> {
    try {
      const formData = new FormData();
      formData.append('file', file);
      if (companyId) {
        formData.append('company_id', companyId);
      }

      const response = await apiClient.post('/api/line-items/import/csv', formData, {
        headers: {
          'Content-Type': 'multipart/form-data',
        },
      });
      return response.data;
    } catch (error) {
      throw new LineItemServiceError(
        `Failed to import line items: ${getErrorMessage(error)}`,
        getErrorStatus(error),
        error
      );
    }
  }

  /**
   * Get line item usage statistics
   */
  async getUsageStatistics(lineItemId: string): Promise<UsageStatistics> {
    try {
      const response = await apiClient.get(`/api/line-items/${lineItemId}/statistics`);
      return response.data;
    } catch (error) {
      throw new LineItemServiceError(
        `Failed to fetch usage statistics: ${getErrorMessage(error)}`,
        getErrorStatus(error),
        error
      );
    }
  }

  /**
   * Clear category cache (useful for testing or manual cache refresh)
   */
  clearCategoryCache(): void {
    this.categoryCache.clear();
  }
}

export default new LineItemService();