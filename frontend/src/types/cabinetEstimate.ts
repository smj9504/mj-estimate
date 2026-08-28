/**
 * Cabinet Estimate types
 */

// ── Enums ──

export type CabinetTier = 'Stock' | 'Semi-Custom' | 'Custom';
export type BoxMaterial = 'Plywood' | 'MDF' | 'Particle';
export type FinishType = 'Stained' | 'Painted' | 'Glazed' | 'Laminate';
export type CabType = 'base' | 'wall' | 'tall' | 'specialty';
export type CabinetLocation = 'perimeter' | 'island';
export type EstimateStatus = 'draft' | 'calculated' | 'approved' | 'exported';
export type SpecialtyType = 'sink_base' | 'lazy_susan' | 'blind_corner' | 'drawer_base' | 'diagonal_corner_wall' | 'oven_cabinet' | 'refrigerator_cabinet';
export type BacksplashType = 'ceramic_tile' | 'subway_tile' | 'glass_tile' | 'stone_marble';

// ── Box ──

export interface CabinetBox {
  id: string;
  estimate_id: string;
  code: string;
  cab_type: CabType;
  location: CabinetLocation;
  width_inches: number;
  height_inches: number;
  is_specialty: boolean;
  specialty_type?: SpecialtyType | null;
  has_glass_door: boolean;
  qty: number;
  display_order: number;
  created_at?: string;
}

export interface CabinetBoxCreate {
  code: string;
  cab_type: CabType;
  location: CabinetLocation;
  width_inches: number;
  height_inches: number;
  is_specialty: boolean;
  specialty_type?: SpecialtyType | null;
  has_glass_door: boolean;
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
  location?: string;
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
  sink_type?: 'single' | 'double';
  include_countertop_reset: boolean;
  include_hardware: boolean;
  include_crown_molding: boolean;
  include_backsplash: boolean;
  backsplash_type?: BacksplashType | null;
  backsplash_sqft?: number;
  include_toe_kick: boolean;
  include_countertop: boolean;
  include_drywall_repair: boolean;
  drywall_repair_type?: 'patch' | 'rr';
  drywall_repair_sqft?: number;
  include_painting: boolean;
  painting_sqft?: number;
  include_appliance_rr: boolean;
  appliance_list?: { type: string; qty: number }[];
  include_dumpster: boolean;
  include_electrical: boolean;
  include_permit: boolean;
  outlet_relocation_count: number;
  delivery_floor?: number;
  island_type: string;
  island_prefab_size?: string;
  island_prefab_price?: number;
  island_end_panel_sqft: number;
  island_back_panel_sqft: number;
  countertop_material?: string;
  countertop_sqft?: number;
  include_countertop_backsplash?: boolean;
  countertop_backsplash_lf?: number;
  island_countertop_material?: string;
  island_countertop_sqft?: number;
  overview_text?: string;
  target_total?: number | null;
  subtotal: number;
  overhead_pct: number;
  overhead_amount: number;
  profit_pct: number;
  profit_amount: number;
  adjustment_factor?: number | null;
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
  sink_type?: 'single' | 'double';
  include_countertop_reset?: boolean;
  include_hardware?: boolean;
  include_crown_molding?: boolean;
  include_backsplash?: boolean;
  backsplash_type?: BacksplashType | null;
  backsplash_sqft?: number;
  include_toe_kick?: boolean;
  include_countertop?: boolean;
  include_drywall_repair?: boolean;
  drywall_repair_type?: 'patch' | 'rr';
  drywall_repair_sqft?: number;
  include_painting?: boolean;
  painting_sqft?: number;
  include_appliance_rr?: boolean;
  appliance_list?: { type: string; qty: number }[];
  include_dumpster?: boolean;
  include_electrical?: boolean;
  include_permit?: boolean;
  outlet_relocation_count?: number;
  delivery_floor?: number;
  island_type?: string;
  island_prefab_size?: string;
  island_prefab_price?: number;
  island_end_panel_sqft?: number;
  island_back_panel_sqft?: number;
  countertop_material?: string;
  countertop_sqft?: number;
  include_countertop_backsplash?: boolean;
  countertop_backsplash_lf?: number;
  island_countertop_material?: string;
  island_countertop_sqft?: number;
  overview_text?: string;
  target_total?: number | null;
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
  sink_type?: 'single' | 'double';
  include_countertop_reset?: boolean;
  include_hardware?: boolean;
  include_crown_molding?: boolean;
  include_backsplash?: boolean;
  backsplash_type?: BacksplashType | null;
  backsplash_sqft?: number;
  include_toe_kick?: boolean;
  include_countertop?: boolean;
  include_drywall_repair?: boolean;
  drywall_repair_type?: 'patch' | 'rr';
  drywall_repair_sqft?: number;
  include_painting?: boolean;
  painting_sqft?: number;
  include_appliance_rr?: boolean;
  appliance_list?: { type: string; qty: number }[];
  include_dumpster?: boolean;
  include_electrical?: boolean;
  include_permit?: boolean;
  outlet_relocation_count?: number;
  delivery_floor?: number;
  island_type?: string;
  island_prefab_size?: string;
  island_prefab_price?: number;
  island_end_panel_sqft?: number;
  island_back_panel_sqft?: number;
  countertop_material?: string;
  countertop_sqft?: number;
  include_countertop_backsplash?: boolean;
  countertop_backsplash_lf?: number;
  island_countertop_material?: string;
  island_countertop_sqft?: number;
  overview_text?: string;
  target_total?: number | null;
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

export interface BacksplashTypeInfo {
  key: string;
  label: string;
  material_per_sf: number;
  install_per_sf: number;
}

export interface PricingInfo {
  tiers: string[];
  materials: string[];
  finishes: string[];
  door_styles: string[];
  layout_types: string[];
  cab_types: string[];
  specialty_types: string[];
  // Install labor keys are tier-keyed ({ Stock, 'Semi-Custom', Custom });
  // every other entry is a flat rate.
  scope_items: Record<string, number | Record<string, number>>;
  backsplash_types: BacksplashTypeInfo[];
  glass_door_premiums: Record<string, number>;
  crown_molding_pricing: Record<string, number>;
  island_panel_pricing: Record<string, any>;
  prefab_island_pricing: Record<string, any>;
  prefab_island_install: Record<string, number>;
  tall_cabinet_types: Record<string, Record<string, number>>;
  appliance_rr_pricing: Record<string, { label: string; cost: number }>;
  countertop_materials: Record<string, { label: string; rate: number }>;
  countertop_backsplash_per_lf: Record<string, number>;
}
