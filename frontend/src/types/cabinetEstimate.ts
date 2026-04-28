/**
 * Cabinet Estimate types
 */

// ── Enums ──

export type CabinetTier = 'Stock' | 'Semi-Custom' | 'Custom';
export type BoxMaterial = 'Plywood' | 'MDF' | 'Particle';
export type FinishType = 'Stained' | 'Painted' | 'Glazed' | 'Laminate';
export type CabType = 'base' | 'wall' | 'tall' | 'specialty';
export type EstimateStatus = 'draft' | 'calculated' | 'approved' | 'exported';
export type SpecialtyType = 'sink_base' | 'lazy_susan' | 'blind_corner' | 'drawer_base' | 'diagonal_corner_wall';

// ── Box ──

export interface CabinetBox {
  id: string;
  estimate_id: string;
  code: string;
  cab_type: CabType;
  width_inches: number;
  height_inches: number;
  is_specialty: boolean;
  specialty_type?: SpecialtyType | null;
  qty: number;
  display_order: number;
  created_at?: string;
}

export interface CabinetBoxCreate {
  code: string;
  cab_type: CabType;
  width_inches: number;
  height_inches: number;
  is_specialty: boolean;
  specialty_type?: SpecialtyType | null;
  qty: number;
  display_order?: number;
}

// ── Line Item ──

export interface EstimateLineItem {
  id: string;
  estimate_id: string;
  description: string;
  quantity: number;
  unit: string;
  unit_price: number;
  total: number;
  category?: string;
  notes?: string;
  display_order: number;
  created_at?: string;
}

// ── Estimate ──

export interface CabinetEstimate {
  id: string;
  claim_id?: string | null;
  company_id?: string | null;
  created_by_id?: string | null;
  status: EstimateStatus;
  property_address?: string;
  zip_code?: string;
  layout_type?: string;
  kitchen_size_sqft?: number;
  ceiling_height?: number;
  has_soffit: boolean;
  tier?: CabinetTier;
  box_material?: BoxMaterial;
  finish?: FinishType;
  door_style?: string;
  include_demo: boolean;
  include_install: boolean;
  include_delivery: boolean;
  include_plumbing: boolean;
  include_countertop_reset: boolean;
  include_hardware: boolean;
  countertop_material?: string;
  countertop_sqft?: number;
  subtotal: number;
  overhead_pct: number;
  overhead_amount: number;
  profit_pct: number;
  profit_amount: number;
  total: number;
  methodology_notes?: string;
  warning_flags?: string[];
  notes?: string;
  boxes: CabinetBox[];
  line_items: EstimateLineItem[];
  // Enriched from claim
  claim_number?: string;
  client_name?: string;
  created_at?: string;
  updated_at?: string;
}

export interface CabinetEstimateCreate {
  claim_id?: string | null;
  company_id?: string | null;
  property_address?: string;
  zip_code?: string;
  layout_type?: string;
  kitchen_size_sqft?: number;
  ceiling_height?: number;
  has_soffit?: boolean;
  tier?: CabinetTier;
  box_material?: BoxMaterial;
  finish?: FinishType;
  door_style?: string;
  include_demo?: boolean;
  include_install?: boolean;
  include_delivery?: boolean;
  include_plumbing?: boolean;
  include_countertop_reset?: boolean;
  include_hardware?: boolean;
  countertop_material?: string;
  countertop_sqft?: number;
  overhead_pct?: number;
  profit_pct?: number;
  notes?: string;
  boxes: CabinetBoxCreate[];
}

export interface CabinetEstimateUpdate {
  claim_id?: string | null;
  company_id?: string | null;
  property_address?: string;
  zip_code?: string;
  layout_type?: string;
  kitchen_size_sqft?: number;
  ceiling_height?: number;
  has_soffit?: boolean;
  tier?: CabinetTier;
  box_material?: BoxMaterial;
  finish?: FinishType;
  door_style?: string;
  include_demo?: boolean;
  include_install?: boolean;
  include_delivery?: boolean;
  include_plumbing?: boolean;
  include_countertop_reset?: boolean;
  include_hardware?: boolean;
  countertop_material?: string;
  countertop_sqft?: number;
  overhead_pct?: number;
  profit_pct?: number;
  notes?: string;
  boxes?: CabinetBoxCreate[];
}

// ── List Response ──

export interface CabinetEstimateListResponse {
  items: CabinetEstimate[];
  total: number;
  page: number;
  page_size: number;
}

// ── History ──

export interface EstimateHistory {
  id: string;
  estimate_id: string;
  version_number: number;
  snapshot_data: Record<string, any>;
  changed_by_id?: string;
  change_description?: string;
  created_at?: string;
}

// ── Purchase Order ──

export interface PurchaseOrderItem {
  code: string;
  description: string;
  cab_type: string;
  width_inches: number;
  height_inches: number;
  qty: number;
}

export interface PurchaseOrderResponse {
  estimate_id: string;
  property_address?: string;
  items: PurchaseOrderItem[];
  total_boxes: number;
}

// ── Pricing Info ──

export interface PricingInfo {
  tiers: string[];
  materials: string[];
  finishes: string[];
  door_styles: string[];
  layout_types: string[];
  cab_types: string[];
  specialty_types: string[];
  scope_items: Record<string, number>;
}
