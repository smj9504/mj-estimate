// Xactimate types for the separated line item structure

export interface XactimateCategory {
  category_code: string;
  category_name: string;
  description?: string;
  created_at?: string;
}

export interface XactimateComponent {
  id: number;
  item_id: number;
  component_type: 'lab' | 'mat' | 'equ' | 'burden' | 'market';
  activity?: '+' | '-' | 'R' | null; // + part of replacing, - part of removing, R detach & reset
  component_code?: string;
  cost?: number;
  direct_yield?: number;
  yield_unit?: string;
  spt_event_percent?: number;
  yield_value?: number;
  unit_price?: number;
}

export interface XactimateItem {
  id: number;
  item_code: string;
  category_code: string;
  description: string;
  unit?: string | null;
  activity?: string | null; // Xactimate's default activity: & (remove and replace), + (replace), - (remove)
  price_list?: string | null;
  is_green?: boolean | null;
  price_year: number;
  price_month: number;
  labor_cost?: number;
  material_cost?: number;
  equipment_cost?: number;
  labor_burden?: number;
  market_conditions?: number;
  untaxed_unit_price: number;
  replace_price?: number | null; // an & item's price split; replace + remove = untaxed_unit_price
  remove_price?: number | null;
  // Which of R (Detach & Reset), M (Material Only), I (Install Only) the item
  // also offers, e.g. "RMI"; "" none; null where not read. Each one's price:
  other_activities?: string | null;
  detach_reset_price?: number | null;
  material_only_price?: number | null;
  install_only_price?: number | null;
  life_expectancy_years?: number;
  depreciation_rate?: number;
  max_depreciation?: number;
  includes_description?: string;
  excludes_description?: string;
  note_description?: string;
  quality_description?: string;
  reference_description?: string;
  has_life_expectancy_data: boolean;
  created_at?: string;
  updated_at?: string;
  components?: XactimateComponent[];
  category?: XactimateCategory;
}

export interface XactimateSearchRequest {
  search_term?: string;
  category_code?: string;
  item_code?: string;
  price_year?: number;
  price_month?: number;
  min_price?: number;
  max_price?: number;
  has_components?: boolean;
  include_components?: boolean;
  page?: number;
  page_size?: number;
}

export interface XactimateSearchResponse {
  items: XactimateItem[];
  total_count: number;
  page: number;
  page_size: number;
  total_pages: number;
}

export interface UnifiedLineItem {
  id: string;
  type: 'XACTIMATE' | 'CUSTOM';
  cat?: string;
  item?: string;
  description: string;
  includes?: string;
  unit?: string;
  untaxed_unit_price: number;
  lab?: number;
  mat?: number;
  equ?: number;
  labor_burden?: number;
  market_condition?: number;
  is_active: boolean;
  version: number;
  company_id?: string;
  created_at?: string;
  updated_at?: string;
}

export interface UnifiedSearchRequest {
  search_term?: string;
  category?: string;
  item_type?: 'XACTIMATE' | 'CUSTOM' | 'ALL';
  company_id?: string;
  page?: number;
  page_size?: number;
}

export interface UnifiedSearchResponse {
  items: UnifiedLineItem[];
  total_count: number;
  page: number;
  page_size: number;
  total_pages: number;
  xactimate_count: number;
  custom_count: number;
}

// Form types for creating/updating
export interface XactimateCategoryCreate {
  category_code: string;
  category_name: string;
  description?: string;
}

export interface XactimateCategoryUpdate {
  category_name?: string;
  description?: string;
}

export interface XactimateComponentCreate {
  component_type: 'lab' | 'mat' | 'equ' | 'burden' | 'market';
  component_code?: string;
  cost?: number;
  direct_yield?: number;
  yield_unit?: string;
  spt_event_percent?: number;
  yield_value?: number;
  unit_price?: number;
}

export interface XactimateItemCreate {
  item_code: string;
  category_code: string;
  description: string;
  price_year: number;
  price_month: number;
  labor_cost?: number;
  material_cost?: number;
  equipment_cost?: number;
  labor_burden?: number;
  market_conditions?: number;
  life_expectancy_years?: number;
  depreciation_rate?: number;
  max_depreciation?: number;
  includes_description?: string;
  excludes_description?: string;
  note_description?: string;
  quality_description?: string;
  reference_description?: string;
  has_life_expectancy_data?: boolean;
  components?: XactimateComponentCreate[];
}

export interface XactimateItemUpdate {
  item_code?: string;
  category_code?: string;
  description?: string;
  price_year?: number;
  price_month?: number;
  labor_cost?: number;
  material_cost?: number;
  equipment_cost?: number;
  labor_burden?: number;
  market_conditions?: number;
  life_expectancy_years?: number;
  depreciation_rate?: number;
  max_depreciation?: number;
  includes_description?: string;
  excludes_description?: string;
  note_description?: string;
  quality_description?: string;
  reference_description?: string;
  has_life_expectancy_data?: boolean;
}