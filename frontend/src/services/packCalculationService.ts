/**
 * API service for Pack Calculation domain
 */

import api from './api';

const API_BASE_URL = '/api/pack-calculation';

// Types
export interface PackItemInput {
  item_name: string;
  item_category?: string;
  quantity: number;
  size_category?: string;
  floor_level: string;
  fragile?: boolean;
  requires_disassembly?: boolean;
  special_notes?: string;
}

export interface PackRoomInput {
  room_name: string;
  floor_level: string;
  input_method: 'STRUCTURED' | 'TEXT' | 'IMAGE';
  items: PackItemInput[];
  raw_input?: string;
  image_url?: string;
}

export interface BuildingInfo {
  building_type: 'HOUSE' | 'APARTMENT' | 'CONDO' | 'COMMERCIAL';
  total_floors: number;
  has_elevator: boolean;
}

export interface StrategyOverrides {
  material_strategy?: string;
  labor_strategy?: string;
  protection_strategy?: string;
  debris_strategy?: string;
}

export interface PackCalculationRequest {
  calculation_name: string;
  project_address?: string;
  notes?: string;
  rooms: PackRoomInput[];
  building_info: BuildingInfo;
  strategy_overrides?: StrategyOverrides;
  auto_detect_strategies?: boolean;
}

export interface XactimateLineItem {
  code: string;
  description?: string;
  unit?: string;
  quantity: number;
  category: string;
  ml_used?: boolean;
  confidence?: number;
}

export interface RoomBreakdown {
  room_id: string;
  room_name: string;
  floor_level: string;
  materials: XactimateLineItem[];
  pack_out_labor?: XactimateLineItem[];
  pack_out_labor_hours: number;
  pack_in_labor_hours: number;
  item_count: number;
  explanation_pack_out?: string;
  explanation_protection?: string;
  explanation_pack_in?: string;
}

export interface DebrisBreakdown {
  cardboard_recyclable_lb: number;
  cardboard_recyclable_ton: number;
  plastic_waste_lb: number;
  paper_waste_lb: number;
  total_debris_lb: number;
  total_debris_ton: number;
}

export interface FuzzyMatch {
  original_name: string;
  matched_key: string;
  matched_materials: Record<string, number>;
  quantity: number;
}

export interface StrategiesUsed {
  material_estimation?: string;
  labor_calculation?: string;
  protection_estimate?: string;
  debris_calculation?: string;
  fuzzy_matching_used?: boolean;
  fuzzy_matches?: FuzzyMatch[];
}

export interface PackCalculationResult {
  id: string;
  calculation_name: string;
  pack_out_materials: XactimateLineItem[];
  pack_out_labor: XactimateLineItem[];
  protection: XactimateLineItem[];
  pack_in_labor: XactimateLineItem[];
  rooms: RoomBreakdown[];
  debris: DebrisBreakdown;
  total_pack_out_hours: number;
  total_pack_in_hours: number;
  total_protection_sf: number;
  explanation_protection?: string;
  ml_confidence: number;
  needs_review: boolean;
  strategies_used: StrategiesUsed;
  auto_selected: boolean;
  created_at: string;
  created_by_id: string;
}

export interface PackItemDetail {
  id: string;
  item_name: string;
  item_category?: string;
  quantity: number;
  floor_level: string;
  detected_by: string;
  confidence_score?: number;
  xactimate_materials: Record<string, number>;
  fragile?: boolean;
  requires_disassembly?: boolean;
  special_notes?: string;
}

export interface PackRoomDetail {
  id: string;
  room_name: string;
  floor_level: string;
  input_method: string;
  ai_confidence?: number;
  items: PackItemDetail[];
  xactimate_materials: Record<string, number>;
  xactimate_labor: Record<string, number>;
  packing_hours: number;
  moving_hours: number;
}

export interface PackCalculationDetail extends PackCalculationResult {
  // Inherits rooms: RoomBreakdown[] from PackCalculationResult
  building_info?: BuildingInfo;
  project_address?: string;
  notes?: string;
  detail_rooms?: PackRoomDetail[];  // Detailed room data with items for editing
}

export interface CorrectionInput {
  corrected_materials: Record<string, number>;
  corrected_labor: Record<string, number>;
  correction_notes?: string;
}

export interface ItemMaterialMapping {
  id: string;
  item_name: string;
  item_category?: string;
  size_category?: string;
  xactimate_materials: Record<string, number>;
  estimated_weight_lb?: number;
  fragile: boolean;
  requires_disassembly: boolean;
  packing_hours_base?: number;
  moving_hours_base?: number;
  usage_count: number;
  created_at: string;
  updated_at: string;
}

export interface ItemMaterialMappingInput {
  item_name: string;
  item_category?: string;
  size_category?: string;
  xactimate_materials: Record<string, number>;
  estimated_weight_lb?: number;
  fragile?: boolean;
  requires_disassembly?: boolean;
  packing_hours_base?: number;
  moving_hours_base?: number;
}

export interface MLMetrics {
  boxes_mae: number;
  labor_mae: number;
  avg_confidence: number;
  correction_rate: number;
  total_calculations: number;
  total_corrections: number;
  last_training_date?: string;
  model_version?: string;
}

// Pack Calculation API
export const packCalculationAPI = {
  // Calculate pack-in/out materials and labor
  calculate: async (request: PackCalculationRequest): Promise<PackCalculationResult> => {
    const response = await api.post(`${API_BASE_URL}/calculate`, request);
    return response.data;
  },

  // Get calculation by ID with full details
  getById: async (id: string): Promise<PackCalculationDetail> => {
    const response = await api.get(`${API_BASE_URL}/${id}`);
    return response.data;
  },

  // List all calculations
  getAll: async (params?: {
    skip?: number;
    limit?: number;
  }): Promise<PackCalculationResult[]> => {
    const response = await api.get(`${API_BASE_URL}/`, { params });
    return response.data;
  },

  // Save human correction
  saveCorrection: async (
    calculationId: string,
    correction: CorrectionInput
  ): Promise<{
    message: string;
    magnitude: number;
    should_retrain: boolean;
    corrections_count: number;
  }> => {
    const response = await api.post(`${API_BASE_URL}/${calculationId}/correct`, correction);
    return response.data;
  },

  // Update calculation - recalculate with new inputs
  update: async (id: string, request: PackCalculationRequest): Promise<PackCalculationResult> => {
    const response = await api.put(`${API_BASE_URL}/${id}`, request);
    return response.data;
  },

  // Delete calculation
  delete: async (id: string): Promise<{ message: string }> => {
    const response = await api.delete(`${API_BASE_URL}/${id}`);
    return response.data;
  },
};

// Item Material Mapping API (Admin)
export const itemMappingAPI = {
  // Get seed categories for dropdown
  getSeedCategories: async (): Promise<{
    categories: Array<{
      value: string;
      label: string;
      category: string;
      size: string;
    }>;
  }> => {
    const response = await api.get(`${API_BASE_URL}/seed-categories`);
    return response.data;
  },

  // List item mappings
  getAll: async (params?: {
    category?: string;
    skip?: number;
    limit?: number;
  }): Promise<ItemMaterialMapping[]> => {
    const response = await api.get(`${API_BASE_URL}/mappings`, { params });
    return response.data;
  },

  // Create new mapping
  create: async (data: ItemMaterialMappingInput): Promise<ItemMaterialMapping> => {
    const response = await api.post(`${API_BASE_URL}/mappings`, data);
    return response.data;
  },

  // Update mapping
  update: async (id: string, data: ItemMaterialMappingInput): Promise<ItemMaterialMapping> => {
    const response = await api.put(`${API_BASE_URL}/mappings/${id}`, data);
    return response.data;
  },

  // Delete mapping
  delete: async (id: string): Promise<{ message: string }> => {
    const response = await api.delete(`${API_BASE_URL}/mappings/${id}`);
    return response.data;
  },
};

// ML Metrics API
export const mlMetricsAPI = {
  // Get ML model performance metrics
  getMetrics: async (): Promise<MLMetrics> => {
    const response = await api.get(`${API_BASE_URL}/ml/metrics`);
    return response.data;
  },

  // Trigger ML retraining (Admin)
  triggerRetraining: async (): Promise<{ message: string; status: string }> => {
    const response = await api.post(`${API_BASE_URL}/ml/trigger-retraining`);
    return response.data;
  },
};
