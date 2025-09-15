// Xactimate service for API communication

import api from './api';
import {
  XactimateCategory,
  XactimateCategoryCreate,
  XactimateCategoryUpdate,
  XactimateItem,
  XactimateItemCreate,
  XactimateItemUpdate,
  XactimateComponent,
  XactimateComponentCreate,
  XactimateSearchRequest,
  XactimateSearchResponse,
  UnifiedSearchRequest,
  UnifiedSearchResponse
} from '../types/xactimate';

class XactimateService {
  private baseUrl = '/api/xactimate';

  // Category methods
  async getCategories(): Promise<XactimateCategory[]> {
    const response = await api.get(`${this.baseUrl}/categories`);
    return response.data;
  }

  async getCategory(categoryCode: string): Promise<XactimateCategory> {
    const response = await api.get(`${this.baseUrl}/categories/${categoryCode}`);
    return response.data;
  }

  async createCategory(categoryData: XactimateCategoryCreate): Promise<XactimateCategory> {
    const response = await api.post(`${this.baseUrl}/categories`, categoryData);
    return response.data;
  }

  async updateCategory(categoryCode: string, categoryData: XactimateCategoryUpdate): Promise<XactimateCategory> {
    const response = await api.put(`${this.baseUrl}/categories/${categoryCode}`, categoryData);
    return response.data;
  }

  async deleteCategory(categoryCode: string): Promise<void> {
    await api.delete(`${this.baseUrl}/categories/${categoryCode}`);
  }

  // Item methods
  async searchItems(searchRequest: XactimateSearchRequest): Promise<XactimateSearchResponse> {
    const params = new URLSearchParams();
    
    // Add search parameters
    if (searchRequest.search_term) params.append('search_term', searchRequest.search_term);
    if (searchRequest.category_code) params.append('category_code', searchRequest.category_code);
    if (searchRequest.item_code) params.append('item_code', searchRequest.item_code);
    if (searchRequest.price_year) params.append('price_year', searchRequest.price_year.toString());
    if (searchRequest.price_month) params.append('price_month', searchRequest.price_month.toString());
    if (searchRequest.min_price !== undefined) params.append('min_price', searchRequest.min_price.toString());
    if (searchRequest.max_price !== undefined) params.append('max_price', searchRequest.max_price.toString());
    if (searchRequest.has_components !== undefined) params.append('has_components', searchRequest.has_components.toString());
    if (searchRequest.include_components !== undefined) params.append('include_components', searchRequest.include_components.toString());
    if (searchRequest.page) params.append('page', searchRequest.page.toString());
    if (searchRequest.page_size) params.append('page_size', searchRequest.page_size.toString());

    const response = await api.get(`${this.baseUrl}/items/search?${params.toString()}`);
    return response.data;
  }

  async getItem(itemId: number, includeComponents: boolean = true): Promise<XactimateItem> {
    const params = new URLSearchParams();
    if (includeComponents !== undefined) {
      params.append('include_components', includeComponents.toString());
    }
    
    const response = await api.get(`${this.baseUrl}/items/${itemId}?${params.toString()}`);
    return response.data;
  }

  async getItemByCode(itemCode: string, includeComponents: boolean = true): Promise<XactimateItem> {
    const params = new URLSearchParams();
    if (includeComponents !== undefined) {
      params.append('include_components', includeComponents.toString());
    }
    
    const response = await api.get(`${this.baseUrl}/items/by-code/${itemCode}?${params.toString()}`);
    return response.data;
  }

  async getItemsByCategory(categoryCode: string, limit: number = 100, includeComponents: boolean = false): Promise<XactimateItem[]> {
    const params = new URLSearchParams();
    params.append('limit', limit.toString());
    if (includeComponents !== undefined) {
      params.append('include_components', includeComponents.toString());
    }
    
    const response = await api.get(`${this.baseUrl}/items/by-category/${categoryCode}?${params.toString()}`);
    return response.data;
  }

  async getLatestItems(itemCodes: string[]): Promise<XactimateItem[]> {
    const response = await api.post(`${this.baseUrl}/items/latest`, itemCodes);
    return response.data;
  }

  async getPriceHistory(itemCode: string): Promise<XactimateItem[]> {
    const response = await api.get(`${this.baseUrl}/items/history/${itemCode}`);
    return response.data;
  }

  async createItem(itemData: XactimateItemCreate): Promise<XactimateItem> {
    const response = await api.post(`${this.baseUrl}/items`, itemData);
    return response.data;
  }

  async updateItem(itemId: number, itemData: XactimateItemUpdate, componentsData?: XactimateComponentCreate[]): Promise<XactimateItem> {
    const payload = {
      ...itemData,
      ...(componentsData && { components_data: componentsData })
    };
    
    const response = await api.put(`${this.baseUrl}/items/${itemId}`, payload);
    return response.data;
  }

  async deleteItem(itemId: number): Promise<void> {
    await api.delete(`${this.baseUrl}/items/${itemId}`);
  }

  // Component methods
  async getItemComponents(itemId: number): Promise<XactimateComponent[]> {
    const response = await api.get(`${this.baseUrl}/items/${itemId}/components`);
    return response.data;
  }

  async getComponentsByType(componentType: string, limit: number = 100): Promise<XactimateComponent[]> {
    const params = new URLSearchParams();
    params.append('limit', limit.toString());
    
    const response = await api.get(`${this.baseUrl}/components/by-type/${componentType}?${params.toString()}`);
    return response.data;
  }

  async createItemComponents(itemId: number, componentsData: XactimateComponentCreate[]): Promise<XactimateComponent[]> {
    const response = await api.post(`${this.baseUrl}/items/${itemId}/components`, componentsData);
    return response.data;
  }

  async getComponent(componentId: number): Promise<XactimateComponent> {
    const response = await api.get(`${this.baseUrl}/components/${componentId}`);
    return response.data;
  }

  async updateComponent(componentId: number, componentData: Partial<XactimateComponentCreate>): Promise<XactimateComponent> {
    const response = await api.put(`${this.baseUrl}/components/${componentId}`, componentData);
    return response.data;
  }

  async deleteComponent(componentId: number): Promise<void> {
    await api.delete(`${this.baseUrl}/components/${componentId}`);
  }

  // Unified search
  async unifiedSearch(searchRequest: UnifiedSearchRequest): Promise<UnifiedSearchResponse> {
    const params = new URLSearchParams();
    
    if (searchRequest.search_term) params.append('search_term', searchRequest.search_term);
    if (searchRequest.category) params.append('category', searchRequest.category);
    if (searchRequest.item_type) params.append('item_type', searchRequest.item_type);
    if (searchRequest.company_id) params.append('company_id', searchRequest.company_id);
    if (searchRequest.page) params.append('page', searchRequest.page.toString());
    if (searchRequest.page_size) params.append('page_size', searchRequest.page_size.toString());

    const response = await api.get(`${this.baseUrl}/unified/search?${params.toString()}`);
    return response.data;
  }

  // Utility methods
  calculateTotalPrice(item: XactimateItem): number {
    return (
      (item.labor_cost || 0) +
      (item.material_cost || 0) +
      (item.equipment_cost || 0) +
      (item.labor_burden || 0) +
      (item.market_conditions || 0)
    );
  }

  getTaxableAmount(item: XactimateItem): number {
    // For Xactimate items, only material cost is taxable
    return item.material_cost || 0;
  }

  calculateTax(item: XactimateItem, taxRate: number): number {
    const taxableAmount = this.getTaxableAmount(item);
    return (taxableAmount * taxRate) / 100;
  }

  formatPricePeriod(year: number, month: number): string {
    return `${year}-${month.toString().padStart(2, '0')}`;
  }

  // Convert Xactimate item to legacy line item format for compatibility
  toLineItemFormat(item: XactimateItem): any {
    return {
      id: `xactimate_${item.id}`,
      type: 'XACTIMATE',
      cat: item.category_code,
      item: item.item_code,
      description: item.description,
      includes: item.includes_description,
      unit: 'EA', // Default for Xactimate
      untaxed_unit_price: item.untaxed_unit_price,
      lab: item.labor_cost,
      mat: item.material_cost,
      equ: item.equipment_cost,
      labor_burden: item.labor_burden,
      market_condition: item.market_conditions,
      is_active: true,
      version: 1,
      company_id: null,
      created_at: item.created_at,
      updated_at: item.updated_at
    };
  }
}

export const xactimateService = new XactimateService();
export default xactimateService;