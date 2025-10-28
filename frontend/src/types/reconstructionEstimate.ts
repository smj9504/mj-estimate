/**
 * TypeScript types for Reconstruction Estimate domain
 */

export enum MoistureLevel {
  DRY = 'dry',
  DAMP = 'damp',
  WET = 'wet',
  SATURATED = 'saturated',
}

export enum UnitType {
  SF = 'SF',  // Square Feet
  LF = 'LF',  // Linear Feet
  EA = 'EA',  // Each
}

// Material Category
export interface MaterialCategory {
  id: string;
  category_name: string;
  display_order: number;
  active: boolean;
  description?: string;
  created_at: string;
  updated_at?: string;
}

export interface MaterialCategoryCreate {
  category_name: string;
  display_order?: number;
  active?: boolean;
  description?: string;
}

export interface MaterialCategoryUpdate {
  category_name?: string;
  display_order?: number;
  active?: boolean;
  description?: string;
}

// Material Weight
export interface MaterialWeight {
  id: string;
  material_type: string;
  category_id: string;
  category_name?: string;
  description?: string;
  dry_weight_per_unit: number;
  unit: UnitType;
  damp_multiplier: number;
  wet_multiplier: number;
  saturated_multiplier: number;
  active: boolean;
  created_at: string;
  updated_at?: string;
  created_by_id?: string;
  updated_by_id?: string;
}

export interface MaterialWeightCreate {
  material_type: string;
  category_id: string;
  description?: string;
  dry_weight_per_unit: number;
  unit: UnitType;
  damp_multiplier?: number;
  wet_multiplier?: number;
  saturated_multiplier?: number;
  active?: boolean;
}

export interface MaterialWeightUpdate {
  material_type?: string;
  category_id?: string;
  description?: string;
  dry_weight_per_unit?: number;
  unit?: UnitType;
  damp_multiplier?: number;
  wet_multiplier?: number;
  saturated_multiplier?: number;
  active?: boolean;
}

export interface MaterialWeightListResponse {
  materials: MaterialWeight[];
  total: number;
}

// Debris Item
export interface DebrisItemInput {
  material_id: string;
  quantity: number;
  moisture_level: MoistureLevel;
  description?: string;
}

export interface DebrisItemResponse {
  id?: string;
  material_id: string;
  material_type: string;
  quantity: number;
  unit: UnitType;
  moisture_level: MoistureLevel;
  unit_weight_lb: number;
  moisture_multiplier: number;
  total_weight_lb: number;
  total_weight_ton: number;
  description?: string;
}

// Debris Calculation
export interface DumpsterRecommendation {
  size: string;
  capacity_ton: number;
  capacity_lb: number;
  multiple_loads: boolean;
  load_count: number;
}

export interface CategoryBreakdown {
  category_name: string;
  weight_lb: number;
  weight_ton: number;
  item_count: number;
  percentage: number;
}

export interface DebrisCalculationInput {
  calculation_name?: string;
  project_address?: string;
  notes?: string;
  items: DebrisItemInput[];
}

export interface DebrisCalculationResult {
  items: DebrisItemResponse[];
  total_weight_lb: number;
  total_weight_ton: number;
  category_breakdown: CategoryBreakdown[];
  dumpster_recommendation: DumpsterRecommendation;
}

export interface DebrisCalculation {
  id: string;
  calculation_name?: string;
  project_address?: string;
  notes?: string;
  total_weight_lb: number;
  total_weight_ton: number;
  category_breakdown: Record<string, number>;
  dumpster_recommendation: Record<string, any>;
  items: DebrisItemResponse[];
  created_at: string;
  updated_at?: string;
  created_by_id: string;
}

export interface DebrisCalculationListResponse {
  calculations: DebrisCalculation[];
  total: number;
}

export interface QuickCalculationRequest {
  items: DebrisItemInput[];
}
