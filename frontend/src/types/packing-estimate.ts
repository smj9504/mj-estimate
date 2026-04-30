/**
 * Packing Estimate Types
 *
 * TypeScript types for the integrated packing estimation system.
 * Supports Quick Estimate and Photo AI modes with
 * client/company DB integration.
 */

// ── Enums ────────────────────────────────────

export type RoomSize = 'small' | 'large' | 'xlarge';
export type Density = 'light' | 'normal' | 'dense' | 'heavy' | 'extreme';
export type Floor = 'basement' | '1st' | '2nd' | '3rd' | '4th+';
export type Region = 'mid_atlantic' | 'northeast' | 'west' | 'midwest' | 'southwest' | 'southeast';
export type ContaminationLevel = 'clean' | 'gray_water' | 'black_water';
export type StagingType = 'off_site' | 'on_site';
export type PackingMode = 'quick' | 'photo_ai';
export type PackEstimateStatus = 'draft' | 'completed' | 'approved';

export type ContentHint =
  | 'clothing_hanging' | 'clothing_folded' | 'bedding'
  | 'books' | 'documents' | 'electronics' | 'kitchenware'
  | 'fragile' | 'artwork' | 'collectibles' | 'valuables'
  | 'wine_collection' | 'furniture' | 'rugs' | 'lamps_lighting'
  | 'appliances_small' | 'appliances_large'
  | 'toys' | 'sports' | 'bicycles'
  | 'tools' | 'equipment_heavy' | 'boxes_stored'
  | 'holiday_decor' | 'instruments' | 'baby_items'
  | 'outdoor_furniture' | 'plants' | 'chemicals';

export const ITEM_CATEGORIES = [
  'Furniture', 'Electronics', 'Books', 'Kitchenware',
  'Clothing', 'Fragile', 'Artwork', 'Collectibles',
  'Appliances', 'Tools', 'Sports', 'Other',
] as const;

export type ItemCategory = (typeof ITEM_CATEGORIES)[number];

// ── Room Preset ──────────────────────────────

export interface RoomPreset {
  key: string;
  name: string;
  category: string;
  size: RoomSize;
  base_items: number;
  default_hints: string[];
  mattress: string | null;
}

// ── Quick Estimate ───────────────────────────

export interface CustomSpecialItem {
  name: string;
  price: number;
}

export interface RoomInput {
  preset: string;
  floor: Floor;
  density: Density;
  hints: string[];
  contamination: ContaminationLevel;
  hint_volume: Record<string, number>;
  hint_qty: Record<string, number>;
  special_items?: string[];
  custom_special_items?: CustomSpecialItem[];
}

export interface QuickEstimateRequest {
  client_id?: string;
  company_id?: string;
  claim_id?: string;
  calculation_name?: string;
  project_address?: string;
  rooms: RoomInput[];
  crew_size: number;
  storage_months: number;
  staging_type: StagingType;
  include_packback: boolean;
  include_op: boolean;
  op_rate: number;
  include_contingency?: boolean;
  contingency_rate?: number;
  region: Region;
  special_items: string[];
  custom_special_items: CustomSpecialItem[];
}

// ── Estimate Response ────────────────────────

export interface SectionDetailLine {
  name: string;
  qty: number;
  unit: string;
  rate: number;
  detail: string;
  amount: number;
}

export interface MaterialItem {
  code: string;
  name: string;
  quantity: number;
  unit: string;
  unit_price: number;
  total: number;
}

export interface RoomItemSummary {
  room_name: string;
  notable_items: string[];
  categories_present: string[];
  high_value_items: string[];
  packing_notes: string[];
  item_count: number;
}

export interface SupplementItem {
  key: string;
  name: string;
  description: string;
  amount: number;
  triggered: boolean;
  enabled: boolean;
  reason?: string;
}

export interface EstimateResponse {
  id?: string;
  created_at?: string;
  total_rooms: number;
  total_items: number;
  total_hours: number;
  crew_size: number;
  sections: Record<string, number>;
  section_details?: Record<string, { lines: SectionDetailLine[] }>;
  materials: Record<string, number>;
  material_details?: MaterialItem[];
  materials_detail?: Record<string, string>;
  storage_sf: number;
  staging_type: StagingType;
  room_summaries?: RoomItemSummary[];
  subtotal: number;
  include_op: boolean;
  op_rate: number;
  op_amount: number;
  include_contingency: boolean;
  contingency_rate: number;
  contingency_amount: number;
  supplements: SupplementItem[];
  supplements_total: number;
  grand_total: number;
}

// ── Photo AI / Detected Items ────────────────

export interface DetectedContentItem {
  name: string;
  category: string;
  quantity: number;
  is_high_value: boolean;
  estimated_value?: string;
  is_fragile: boolean;
  needs_disassembly: boolean;
  packing_method?: string;
  required_materials?: string[];
  base_labor_hours?: number;
  per_unit_labor_hours?: number;
  estimated_labor_hours?: number;
  special_instructions?: string;
  estimator_flags?: string[];
  match_confidence?: number;
}

export interface RoomAnalysisResponse {
  room_name: string;
  items: DetectedContentItem[];
  density: string;
  room_size: string;
  confidence_score: number;
  total_labor_hours: number;
  fragile_count: number;
  high_value_count: number;
  field_notes: string[];
}

// ── Content Estimate (Photo AI mode) ─────────

export interface ContentRoomInput {
  room_name: string;
  preset_id?: string;
  items: DetectedContentItem[];
  density: Density;
  floor: Floor;
  contamination: ContaminationLevel;
  special_items?: string[];
  custom_special_items?: CustomSpecialItem[];
}

export interface ContentEstimateRequest {
  client_id?: string;
  company_id?: string;
  claim_id?: string;
  calculation_name?: string;
  project_address?: string;
  rooms: ContentRoomInput[];
  crew_size: number;
  storage_months: number;
  staging_type: StagingType;
  include_packback: boolean;
  include_op: boolean;
  op_rate: number;
  include_contingency?: boolean;
  contingency_rate?: number;
  region: Region;
  special_items: string[];
  custom_special_items: CustomSpecialItem[];
}

// ── Packing Room State ───────────────────────

/** Room for Quick Estimate mode (preset-based) */
export interface PackingRoom {
  id: string;
  preset: string;
  floor: Floor;
  density: Density;
  hints: string[];
  hint_volume: Record<string, number>;
  hint_qty: Record<string, number>;
  contamination: ContaminationLevel;
  items: DetectedContentItem[];
  photos: string[];
  special_items: string[];
  custom_special_items: CustomSpecialItem[];
}

/** Room for Photo AI mode (item-based) */
export interface PhotoRoom {
  id: string;
  room_name: string;
  preset_id?: string;
  floor: Floor;
  density: Density;
  contamination: ContaminationLevel;
  photos: string[];
  items: DetectedContentItem[];
  analyzed: boolean;
  analyzing: boolean;
  confidence_score?: number;
  room_size?: string;
  field_notes: string[];
  special_items: string[];
  custom_special_items: CustomSpecialItem[];
}

// ── Settings ─────────────────────────────────

export interface PackingSettings {
  crew_size: number;
  storage_months: number;
  staging_type: StagingType;
  include_packback: boolean;
  include_op: boolean;
  op_rate: number;
  include_contingency: boolean;
  contingency_rate: number;
  region: Region;
  special_items: string[];
  custom_special_items: CustomSpecialItem[];
}

// ── Pricing ──────────────────────────────────

export interface PackingPrice {
  id: string;
  code: string;
  name: string;
  unit: string;
  unit_price: number;
  cat: string;
  is_taxable?: boolean;
}

// ── List/Detail ──────────────────────────────

export interface PackEstimateSummary {
  id: string;
  calculation_name: string | null;
  project_address: string | null;
  client_id: string | null;
  client_name: string | null;
  company_id: string | null;
  company_name: string | null;
  mode: PackingMode | null;
  status: PackEstimateStatus | null;
  total_rooms: number;
  total_items: number | null;
  total_hours: number | null;
  grand_total: number | null;
  created_at: string | null;
}

export interface PackEstimateListResponse {
  total: number;
  items: PackEstimateSummary[];
}

// ── Batch Analysis ───────────────────────────

export type BatchRoomStatus = 'success' | 'error';

export interface BatchRoomEvent {
  event: 'room_result';
  batch_id?: string;
  room_index: number;
  total_rooms: number;
  status: BatchRoomStatus;
  room_name: string;
  result?: RoomAnalysisResponse;
  error_code?: string;
  error_message?: string;
}

export interface BatchCompleteEvent {
  event: 'batch_complete';
  batch_id?: string;
  total_rooms: number;
  succeeded: number;
  failed: number;
  failed_rooms: string[];
}
