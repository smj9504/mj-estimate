/**
 * Bathroom Remodel Estimate types
 */

// ── Component Spec interfaces ──

export interface ShowerSpec {
  type?: string;          // tub_combo, one_piece, multi_piece_kit, custom_tile, curbless
  size?: { width: number; depth: number; height: number };
  enclosure?: string;     // curtain, sliding, pivot, frameless, half_wall_glass
  niches?: number;
  bench?: boolean;
  showerhead_type?: string;
  valve_replace?: boolean;
  trim_grade?: string;
  tile_spec?: {
    material?: string;
    size?: string;
    pattern?: string;
    sf?: number;
  };
}

export interface BathtubSpec {
  type?: string;          // alcove, drop_in, freestanding, walk_in, none
  material?: string;      // acrylic, porcelain_steel, cast_iron, fiberglass
  size?: { length: number; width: number };
  drain_location?: string;
  jetted?: boolean;
  spout_type?: string;
  surround_tile?: boolean;         // drop_in tub surround tile
  surround_tile_sf?: number;       // surround tile area SF
  surround_tile_material?: string; // porcelain, ceramic, etc.
  surround_tile_pattern?: string;  // straight, diagonal, herringbone
}

export interface VanitySpec {
  width?: number;
  sinks?: number;
  source?: string;        // stock_rta, semi_custom, custom
  top_material?: string;
  mounting?: string;      // freestanding, wall_mount
  faucet_type?: string;
  mirror_type?: string;
}

export interface ToiletSpec {
  type?: string;
  bidet_seat?: boolean;
  wax_ring?: boolean;
  flange_repair?: boolean;
}

export interface FloorSpec {
  material?: string;
  size?: string;
  pattern?: string;
  heated_floor?: boolean;
}

export interface WallsSpec {
  paint_grade?: string;
  baseboard_material?: string;
  colors?: number;
}

export interface AccessoriesSpec {
  towel_bars?: number;
  hand_towel_rings?: number;
  tp_holders?: number;
  robe_hooks?: number;
  grab_bars?: number;
  corner_shelves?: number;
  toilet_brush_holders?: number;
  soap_dispensers?: number;
  finish?: string;
  grade?: string;
}

export interface PlumbingSpec {
  valve_replace_count?: number;
  supply_line_count?: number;
  drain_modification?: boolean;
  pressure_balance_valve?: boolean;
  rough_inspection?: boolean;
}

export interface ElectricalSpec {
  gfci_count?: number;
  vanity_lights?: number;
  ceiling_fixture?: boolean;
  exhaust_fan_cfm?: number;
  exhaust_fan_switch?: string;
  heated_floor?: boolean;
  inspection?: boolean;
}

export interface SubstrateSpec {
  durock_sf?: number;
  greenboard_sf?: number;
  waterproof_type?: string;
  waterproof_sf?: number;
  subfloor_repair?: boolean;
  subfloor_repair_sf?: number;
}

export interface HiddenCostFlags {
  dumpster?: boolean;
  floor_protection?: boolean;
  caulk?: boolean;
  final_clean?: boolean;
  punch_list?: boolean;
  mobilization?: boolean;
  drywall_patch?: boolean;
  drywall_patch_sf?: number;
  trim_paint?: boolean;
  trim_paint_lf?: number;
}

// ── Line Item ──

export interface BathroomEstimateLineItem {
  id: string;
  estimate_id: string;
  phase: number;
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

// ── Main Estimate ──

export interface BathroomEstimate {
  id: string;
  claim_id?: string | null;
  company_id?: string | null;
  created_by_id?: string | null;
  status: string;

  // Project meta
  property_address?: string;
  city?: string;
  state?: string;
  zip_code?: string;
  building_type?: string;
  year_built?: number;

  // Bathroom info
  designation?: string;
  bath_function?: string;
  length_ft?: number;
  width_ft?: number;
  height_ft?: number;
  floor_sf?: number;
  wall_sf?: number;

  // Demo flags
  demo_floor?: boolean;
  demo_floor_sf?: number;
  demo_walls?: boolean;
  demo_wall_sf?: number;
  demo_ceiling?: boolean;
  demo_ceiling_sf?: number;
  replace_shower?: boolean;
  replace_tub?: boolean;
  replace_vanity?: boolean;
  replace_toilet?: boolean;
  replace_floor?: boolean;
  detach_reset_shower?: boolean;
  detach_reset_tub?: boolean;
  detach_reset_vanity?: boolean;
  detach_reset_toilet?: boolean;
  water_damage?: boolean;
  mold_suspected?: boolean;
  existing_tub_material?: string;
  demo_cement_board?: boolean;
  demo_cement_board_sf?: number;
  replace_cement_board?: boolean;
  replace_cement_board_sf?: number;

  // Component specs (JSONB)
  shower_spec?: ShowerSpec;
  bathtub_spec?: BathtubSpec;
  vanity_spec?: VanitySpec;
  toilet_spec?: ToiletSpec;
  floor_spec?: FloorSpec;
  walls_spec?: WallsSpec;
  accessories_spec?: AccessoriesSpec;
  plumbing_spec?: PlumbingSpec;
  electrical_spec?: ElectricalSpec;
  substrate_spec?: SubstrateSpec;
  hidden_costs?: HiddenCostFlags;

  // Sketch data
  sketch_data?: Record<string, any>;

  // Overview & O&P
  overview_text?: string;
  include_overhead_profit?: boolean;
  overhead_pct?: number;
  profit_pct?: number;

  // Totals
  subtotal?: number;
  overhead_amount?: number;
  profit_amount?: number;
  tax_amount?: number;
  total?: number;

  // Documentation
  methodology_notes?: string;
  warning_flags?: string[];
  notes?: string;

  // Relations
  line_items: BathroomEstimateLineItem[];

  // Enriched
  claim_number?: string;
  client_name?: string;

  created_at?: string;
  updated_at?: string;
}

// ── Request types ──

export type BathroomEstimateCreate = Omit<BathroomEstimate,
  'id' | 'status' | 'created_by_id' | 'subtotal' | 'overhead_amount' |
  'profit_amount' | 'tax_amount' | 'total' | 'methodology_notes' |
  'warning_flags' | 'line_items' | 'claim_number' | 'client_name' |
  'created_at' | 'updated_at'
>;

export type BathroomEstimateUpdate = Partial<BathroomEstimateCreate>;

// ── List response ──

export interface BathroomEstimateListResponse {
  items: BathroomEstimate[];
  total: number;
  page: number;
  page_size: number;
}

// ── History ──

export interface BathroomEstimateHistory {
  id: string;
  estimate_id: string;
  version_number: number;
  snapshot_data: Record<string, any>;
  changed_by_id?: string;
  change_description?: string;
  created_at?: string;
}

// ── Pricing Info (for dropdowns) ──

export interface BathroomPricingInfo {
  building_types: string[];
  designations: string[];
  bath_functions: string[];
  shower_types: string[];
  enclosure_types: string[];
  shower_door_types: string[];
  showerhead_types: string[];
  trim_grades: string[];
  bathtub_types: string[];
  bathtub_materials: string[];
  vanity_widths: number[];
  vanity_sources: string[];
  vanity_top_materials: string[];
  vanity_mountings: string[];
  faucet_types: string[];
  mirror_types: string[];
  toilet_types: string[];
  tile_materials: string[];
  tile_patterns: string[];
  tile_sizes: string[];
  waterproof_types: string[];
  accessory_finishes: string[];
  accessory_grades: string[];
  exhaust_fan_cfms: number[];
  exhaust_fan_switch_types: string[];
  paint_grades: string[];
  baseboard_materials: string[];
}

// Phase labels for display
export const PHASE_LABELS: Record<number, string> = {
  1: 'Demo & Disposal',
  2: 'Rough Trades (Plumbing & Electrical)',
  3: 'Substrate & Waterproofing',
  4: 'Tile & Flooring',
  5: 'Fixtures Install',
  6: 'Finish (Paint & Trim)',
  7: 'Punch / Cleanup / Accessories',
};
