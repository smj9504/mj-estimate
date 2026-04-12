/**
 * Xactimate Helper Tool - TypeScript Interfaces
 */

// ─── Line Item ───────────────────────────────────────────────────────────────

export interface XactLineItem {
  id: string;
  item_code: string;
  category: string;
  description?: string;
  unit?: string;
  unit_price: number;
  definition?: Record<string, any>;
  is_active: boolean;
  created_at?: string;
  updated_at?: string;
}

export interface XactLineItemSearchResult {
  items: XactLineItem[];
  total: number;
  limit: number;
  offset: number;
}

// ─── Assembly ────────────────────────────────────────────────────────────────

export interface XactAssemblyItem {
  id: string;
  assembly_id: string;
  item_code: string;
  condition?: string;
  qty_formula?: string;
  is_required: boolean;
  sort_order: number;
}

export interface XactAssembly {
  id: string;
  name: string;
  damage_type?: string;
  room_type?: string;
  trigger_keywords?: string[];
  is_active: boolean;
  items?: XactAssemblyItem[];
  created_at?: string;
  updated_at?: string;
}

export interface XactAssemblyCreateRequest {
  name: string;
  damage_type?: string;
  room_type?: string;
  trigger_keywords?: string[];
  items?: Omit<XactAssemblyItem, 'id' | 'assembly_id'>[];
}

// ─── Room ────────────────────────────────────────────────────────────────────

export interface RoomDimensions {
  LF?: number;
  SF?: number;
  height?: number;
}

export interface ConditionFlags {
  paint?: boolean;
  stain?: boolean;
  after_hours?: boolean;
  occupied?: boolean;
}

export interface XactRoom {
  id: string;
  project_id?: string;
  user_id?: string;
  name: string;
  room_type?: string;
  dimensions?: RoomDimensions;
  damage_type?: string;
  condition_flags?: ConditionFlags;
  selected_assemblies?: any[];
  final_line_items?: RecommendedItem[];
  status: 'draft' | 'confirmed' | 'exported';
  created_at?: string;
  updated_at?: string;
}

export interface XactRoomCreateRequest {
  project_id?: string;
  name: string;
  room_type?: string;
  dimensions?: RoomDimensions;
  damage_type?: string;
  condition_flags?: ConditionFlags;
}

export interface XactRoomUpdateRequest {
  name?: string;
  room_type?: string;
  dimensions?: RoomDimensions;
  damage_type?: string;
  condition_flags?: ConditionFlags;
  selected_assemblies?: any[];
  final_line_items?: RecommendedItem[];
  status?: 'draft' | 'confirmed' | 'exported';
}

// ─── AI Analysis ─────────────────────────────────────────────────────────────

export interface AnalyzeRequest {
  photos?: string[];  // Base64 encoded images
  manual_keywords?: string[];
}

export interface RecommendedItem {
  item_code: string;
  category?: string;       // Category code (e.g. FNC, DRY, PNT) — from DB
  description?: string;
  qty: number;
  unit?: string;
  unit_price: number;
  reason?: string;
}

export interface AssemblyRecommendation {
  assembly_name: string;
  items: RecommendedItem[];
  source: 'ai' | 'feedback' | 'assembly_rule';
  confidence?: number;
}

export interface AnalyzeResponse {
  room_id: string;
  keywords: string[];
  recommendations: AssemblyRecommendation[];
  feedback_applied: boolean;
  feedback_message?: string;
}

// ─── Correction Feedback ─────────────────────────────────────────────────────

export interface CorrectionCreateRequest {
  ai_suggested: Record<string, any>[];
  user_corrected: Record<string, any>[];
  situation_summary?: string;
}

export interface CorrectionFeedback {
  id: string;
  room_id?: string;
  situation_summary?: string;
  damage_type?: string;
  room_type?: string;
  ai_suggested?: Record<string, any>[];
  user_corrected?: Record<string, any>[];
  correction_type?: string[];
  confidence_score: number;
  is_applied_to_rule: boolean;
  created_at?: string;
}

// ─── Descriptions ────────────────────────────────────────────────────────────

export type DescriptionType =
  | 'waste'
  | 'building_code'
  | 'secondary_damage'
  | 'scope_of_work'
  | 'industry_standard';

export interface XactItemDescription {
  id: string;
  item_code: string;
  description_type: DescriptionType;
  trigger_condition?: Record<string, any>;
  title: string;
  body: string;
  variables?: Record<string, any>;
  source_reference?: string;
  is_ai_generated: boolean;
  approved: boolean;
  usage_count: number;
  created_at?: string;
  updated_at?: string;
}

export interface DescriptionCreateRequest {
  item_code: string;
  description_type: DescriptionType;
  title: string;
  body: string;
  trigger_condition?: Record<string, any>;
  variables?: Record<string, any>;
  source_reference?: string;
}

export interface DescriptionUpdateRequest {
  title?: string;
  body?: string;
  trigger_condition?: Record<string, any>;
  variables?: Record<string, any>;
  source_reference?: string;
  approved?: boolean;
}

// ─── Embedding Sync ──────────────────────────────────────────────────────────

export interface EmbeddingSyncRequest {
  category?: string;
  force_regenerate?: boolean;
}

export interface EmbeddingSyncResponse {
  total_items: number;
  processed: number;
  skipped: number;
  errors: number;
  message: string;
}

// ─── Constants ───────────────────────────────────────────────────────────────

export const ROOM_TYPES = [
  { value: 'living_room', label: 'Living Room' },
  { value: 'bedroom', label: 'Bedroom' },
  { value: 'kitchen', label: 'Kitchen' },
  { value: 'bathroom', label: 'Bathroom' },
  { value: 'hallway', label: 'Hallway' },
  { value: 'garage', label: 'Garage' },
  { value: 'basement', label: 'Basement' },
  { value: 'attic', label: 'Attic' },
  { value: 'laundry', label: 'Laundry Room' },
  { value: 'other', label: 'Other' },
] as const;

export const DAMAGE_TYPES = [
  { value: 'water', label: 'Water Damage' },
  { value: 'fire', label: 'Fire Damage' },
  { value: 'mold', label: 'Mold Damage' },
  { value: 'general', label: 'General' },
] as const;

export const DESCRIPTION_TYPES = [
  { value: 'waste', label: 'Waste Factor' },
  { value: 'building_code', label: 'Building Code' },
  { value: 'secondary_damage', label: 'Secondary Damage' },
  { value: 'scope_of_work', label: 'Scope of Work' },
  { value: 'industry_standard', label: 'Industry Standard' },
] as const;
