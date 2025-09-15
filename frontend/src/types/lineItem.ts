/**
 * Line Item Type Definitions
 */

// =====================================================
// Enums
// =====================================================
export enum LineItemType {
  XACTIMATE = 'xactimate',
  CUSTOM = 'custom'
}

export enum TaxMethod {
  PERCENTAGE = 'percentage',
  SPECIFIC = 'specific',
  NONE = 'none'
}

// =====================================================
// Category Types
// =====================================================
export interface LineItemCategory {
  code: string;
  name: string;
  description?: string;
  parent_code?: string;
  display_order: number;
  is_active: boolean;
  created_at?: string;
  updated_at?: string;
  subcategories?: LineItemCategory[];
}

// Modal-specific category format
export interface CategoryModalItem {
  code: string;
  description: string;
  full_description: string;
}

// Modal-specific line item format
export interface LineItemModalItem {
  component_code?: string; // Made optional to handle Xactimate items
  item_code?: string; // Added for Xactimate compatibility
  description: string;
  unit: string;
  act: string; // "&" for Xactimate, "+" for custom
  unit_price: number;
  id: string | number; // Allow both string and number IDs
  category: string;
  type?: string; // Made optional as not all items may have this
}

// =====================================================
// Line Item Types
// =====================================================
export interface LineItem {
  id: string;
  cat?: string;
  item?: string;
  description: string;
  includes?: string;
  unit?: string;
  untaxed_unit_price?: number;
  
  // Xactimate specific fields
  lab?: number;
  mat?: number;
  equ?: number;
  labor_burden?: number;
  market_condition?: number;
  
  // Metadata
  is_active: boolean;
  version: number;
  company_id?: string;
  created_by?: string;
  created_at: string;
  updated_at?: string;
  
  // Relations
  notes?: LineItemNote[];
  calculated_price?: number;
}

export interface LineItemCreate extends Omit<LineItem, 'id' | 'created_at' | 'updated_at' | 'version' | 'calculated_price'> {
  note_ids?: string[];
}

export interface LineItemUpdate {
  cat?: string;
  item?: string;
  description?: string;
  includes?: string;
  unit?: string;
  lab?: number;
  mat?: number;
  equ?: number;
  labor_burden?: number;
  market_condition?: number;
  untaxed_unit_price?: number;
  is_active?: boolean;
  note_ids?: string[];
}

export interface LineItemSearch {
  type?: LineItemType;
  cat?: string;
  search_term?: string;
  company_id?: string;
  is_active?: boolean;
  page?: number;
  page_size?: number;
}

// =====================================================
// Note Types
// =====================================================
export interface LineItemNote {
  id: string;
  title?: string;
  content: string;
  category?: string;
  is_template: boolean;
  company_id?: string;
  created_by?: string;
  created_at: string;
  updated_at?: string;
  // Internal state for UI management
  _isSaved?: boolean; // true = saved to DB, false/undefined = pending save
}

// =====================================================
// Template Types
// =====================================================
export interface TemplateLineItem {
  id: string;
  line_item_id: string;
  quantity_multiplier: number;
  order_index: number;
  line_item?: LineItem;
}

export interface LineItemTemplate {
  id: string;
  name: string;
  description?: string;
  category?: string;
  company_id?: string;
  is_active: boolean;
  created_by?: string;
  created_at: string;
  updated_at?: string;
  template_items: TemplateLineItem[];
}

// =====================================================
// Tax Calculation Types
// =====================================================
export interface LineItemOverride {
  lab?: number;
  mat?: number;
  equ?: number;
  labor_burden?: number;
  market_condition?: number;
  untaxed_unit_price?: number;
  quantity?: number;
  description?: string;
}

export interface TaxCalculationRequest {
  line_item_id: string;
  quantity?: number;
  tax_method: TaxMethod;
  tax_rate?: number;
  override_values?: LineItemOverride;
}

export interface TaxCalculationResponse {
  subtotal: number;
  taxable_amount: number;
  tax_amount: number;
  total: number;
  breakdown: {
    [key: string]: number;
  };
}

// =====================================================
// Invoice/Estimate Integration Types
// =====================================================
export interface DocumentLineItem {
  id: string;
  lineItemId?: string;
  lineItem?: LineItem;
  description: string;
  quantity: number;
  unit?: string;
  rate: number;
  amount: number;
  tax_rate?: number;
  tax_amount?: number;
  order_index: number;
  
  // Override tracking
  is_custom_override: boolean;
  override_values?: LineItemOverride;
  
  // For estimates
  room?: string;
  category?: string;
  
  // For insurance
  depreciation_rate?: number;
  depreciation_amount?: number;
  acv_amount?: number;
  rcv_amount?: number;
}

export interface InvoiceLineItemCreate {
  line_item_id?: string;
  custom_item?: Omit<LineItem, 'id' | 'created_at' | 'updated_at' | 'version'>;
  quantity?: number;
  override_values?: LineItemOverride;
  order_index?: number;
}

export interface EstimateLineItemCreate extends InvoiceLineItemCreate {
  room?: string;
}

// =====================================================
// Advanced Search & Filtering Types
// =====================================================
export interface AdvancedSearchParams extends LineItemSearch {
  category_codes?: string[];
  item_codes?: string[];
  description_keywords?: string[];
  min_price?: number;
  max_price?: number;
  has_notes?: boolean;
  created_after?: string;
  created_before?: string;
  sort_by?: 'description' | 'price' | 'created_at' | 'category';
  sort_order?: 'asc' | 'desc';
}

// =====================================================
// API Response Types
// =====================================================
export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  page_size: number;
  total_pages: number;
}

export interface ApiResponse<T = any> {
  success: boolean;
  message?: string;
  data?: T;
}

// =====================================================
// Template Application Types
// =====================================================
export interface TemplateApplicationResult {
  success: boolean;
  message: string;
  items_created: number;
  applied_items?: DocumentLineItem[];
}

// =====================================================
// Import/Export Types
// =====================================================
export interface ImportResult {
  success: boolean;
  imported: number;
  errors: string[];
  skipped: number;
}

export interface UsageStatistics {
  total_usage: number;
  recent_usage: number;
  average_quantity: number;
  documents_used_in: Array<{
    document_type: string;
    document_id: string;
    document_name: string;
    usage_date: string;
  }>;
}

// =====================================================
// Error Types
// =====================================================
export interface LineItemError {
  field?: string;
  message: string;
  code?: string;
}

export interface ValidationError {
  errors: LineItemError[];
  message: string;
}

// =====================================================
// Bulk Operation Types
// =====================================================
export interface BulkUpdateRequest {
  id: string;
  data: LineItemUpdate;
}

export interface BulkOperationResult<T = any> {
  success: boolean;
  processed: number;
  failed: number;
  results: T[];
  errors?: Array<{
    id: string;
    error: string;
  }>;
}