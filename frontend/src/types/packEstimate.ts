/**
 * Pack Estimate Types
 *
 * TypeScript types for Pack-Out Estimate generation system.
 */

// ============================================================
// Phase 1: Photo Analysis Types
// ============================================================

export type ItemCondition = 'good' | 'fair' | 'poor';
export type SizeCategory = 'SM' | 'MD' | 'LG' | 'OV';
export type DensityLevel = 'MINIMAL' | 'MODERATE' | 'FULL' | 'PACKED';
export type RoomSize = 'small' | 'medium' | 'large';

export interface PackInventoryItem {
  category: string;
  description: string;
  quantity: number;
  condition: ItemCondition;
  size_category: SizeCategory;
  special_handling: string[];
  estimated_boxes: number;
  notes?: string;
}

export interface PackRoomCharacteristics {
  approximate_size: RoomSize;
  density_level: DensityLevel;
  access_notes?: string;
}

export interface PackingRecommendations {
  estimated_total_boxes: number;
  special_supplies_needed: string[];
  estimated_pack_time_hours: number;
}

export interface Phase1Result {
  room_name: string;
  items: PackInventoryItem[];
  room_characteristics: PackRoomCharacteristics;
  packing_recommendations: PackingRecommendations;
}

// ============================================================
// Phase 2: Estimate Generation Types
// ============================================================

export type PackUnit = 'HR' | 'EA' | 'BX' | 'SF' | 'LF' | 'LD';
export type PackCategory = 'LABOR' | 'MATERIALS' | 'EQUIPMENT' | 'SPECIAL';

export interface PackEstimateLineItem {
  id: string;
  name: string;
  description?: string;
  quantity: number;
  unit: PackUnit;
  unit_price: number;
  total: number;
  category: PackCategory;
  primary_group: string;
  secondary_group?: string;
  notes?: string;
  taxable: boolean;
  sort_order: number;
}

export interface PackEstimateSummary {
  subtotal: number;
  tax_rate: number;
  tax_amount: number;
  total: number;
  estimated_duration_hours: number;
}

export interface Phase2Result {
  line_items: PackEstimateLineItem[];
  summary: PackEstimateSummary;
}

// ============================================================
// Combined Result Types
// ============================================================

export interface PackEstimateProcessingInfo {
  photo_count: number;
  room_name: string;
  phase1_method: 'ai' | 'mock' | 'rule_based';
  phase2_method: 'ai' | 'rule_based';
  items_detected?: number;
  boxes_estimated?: number;
  line_items_generated?: number;
  estimated_total?: number;
}

export interface PackEstimateResult {
  phase1_inventory?: Phase1Result;
  line_items: PackEstimateLineItem[];
  summary: PackEstimateSummary;
  processing_info: PackEstimateProcessingInfo;
}

// ============================================================
// Export to Estimate Types
// ============================================================

export interface EstimateLineItem {
  id: string;
  line_item_id?: string;
  name: string;
  description?: string;
  note?: string;
  quantity: number;
  unit: string;
  unit_price: number;
  total: number;
  taxable: boolean;
  primary_group: string;
  secondary_group?: string;
  sort_order: number;
}

export interface ExportToEstimateResponse {
  line_items: EstimateLineItem[];
  summary: PackEstimateSummary;
}

// ============================================================
// UI State Types
// ============================================================

export type PackEstimateStep = 'upload' | 'analyzing' | 'inventory' | 'estimate' | 'export';

export interface PackEstimateState {
  currentStep: PackEstimateStep;
  photoUrls: string[];
  roomName: string;
  phase1Result?: Phase1Result;
  phase2Result?: Phase2Result;
  packEstimateResult?: PackEstimateResult;
  isLoading: boolean;
  error?: string;
}

export interface PackEstimateActions {
  setPhotoUrls: (urls: string[]) => void;
  setRoomName: (name: string) => void;
  generateEstimate: () => Promise<void>;
  analyzePhotos: () => Promise<void>;
  generateFromInventory: () => Promise<void>;
  exportToEstimate: () => Promise<EstimateLineItem[]>;
  reset: () => void;
}

// ============================================================
// Pricing Data Types
// ============================================================

export interface PricingItem {
  code: string;
  description: string;
  unit: PackUnit;
  unit_price: number;
  category: PackCategory;
}

export interface PricingData {
  labor: PricingItem[];
  materials: PricingItem[];
  specialty: PricingItem[];
  equipment: PricingItem[];
}

// ============================================================
// Component Props Types
// ============================================================

export interface PackEstimateGeneratorProps {
  onExport?: (items: EstimateLineItem[]) => void;
  onCancel?: () => void;
  initialPhotoUrls?: string[];
}

export interface PackInventoryEditorProps {
  inventory: Phase1Result;
  onChange: (inventory: Phase1Result) => void;
  onContinue: () => void;
  onBack: () => void;
}

export interface PackEstimatePreviewProps {
  result: PackEstimateResult;
  onExport: () => void;
  onBack: () => void;
  onRegenerateWithAI: () => void;
}

export interface PackEstimateLineItemRowProps {
  item: PackEstimateLineItem;
  index: number;
  onUpdate: (item: PackEstimateLineItem) => void;
  onDelete: (id: string) => void;
}
