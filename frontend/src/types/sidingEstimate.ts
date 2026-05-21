/**
 * Siding Estimate types
 */

// ── EagleView Parsed Data ──

export interface EagleViewPenetration {
  designator: string;
  area: number;
  perimeter: number;
  width: number;
  height: number;
  sub_type: string;    // WINDOW, DOOR, MAIN_DOOR, GARAGE_DOOR, NONE
  dimension_raw: string;
}

export interface EagleViewWall {
  id: string;
  designator: string;
  orientation: number;
  direction: string;   // N, S, E, W, NE, NW, SE, SW
  area: number;
  siding_area: number;
  siding_area_net: number;
  masonry_area: number;
  window_count: number;
  door_count: number;
  total_penetration_area: number;
  penetrations: EagleViewPenetration[];
}

export interface EagleViewParseResponse {
  report_id: string;
  claim_id: string;
  address: string;
  city: string;
  state: string;
  zip_code: string;
  latitude: number;
  longitude: number;

  // Summary totals
  total_wall_area: number;
  total_wall_area_less_penetrations: number;
  total_siding_area: number;
  total_siding_area_less_penetrations: number;
  total_masonry_area: number;
  total_masonry_area_less_penetrations: number;
  total_wall_facets: number;
  total_windows_and_doors: number;
  total_windows_and_doors_area: number;
  total_windows_and_doors_perimeter: number;
  fascia_lf: number;

  // Corners
  inside_corners_lf: number;
  outside_corners_lf: number;
  obtuse_inside_corners_lf: number;
  obtuse_outside_corners_lf: number;
  inside_siding_corners_lf: number;
  outside_siding_corners_lf: number;

  // Siding wall lengths
  top_siding_walls_lf: number;
  bottom_siding_walls_lf: number;

  // Materials & SubTypes
  materials: Record<string, string>;
  sub_types: Record<string, string>;

  // Wall details
  walls: EagleViewWall[];

  // Raw data for storage
  raw_data?: Record<string, any>;
}

// ── Siding Specs ──

export interface SidingMaterialSpec {
  type?: string;        // vinyl, fiber_cement, hardie_board, wood, lp_smartside, metal
  profile?: string;     // lap, dutch_lap, board_and_batten, shake, vertical
  brand?: string;
  color?: string;
  thickness?: string;
  insulated?: boolean;
}

export interface TrimSpec {
  window_trim?: boolean;
  door_trim?: boolean;
  corner_posts?: { inside: number; outside: number };
  j_channel_lf?: number;
  starter_strip_lf?: number;
  undersill_trim_lf?: number;
  wrap_material?: string; // aluminum_coil, pvc, hardie_trim
}

export interface SoffitFasciaSpec {
  replace_soffit?: boolean;
  soffit_type?: string;   // vinyl_vented, aluminum, hardie
  soffit_sf?: number;
  replace_fascia?: boolean;
  fascia_type?: string;   // aluminum_wrap, pvc, hardie
  fascia_lf?: number;
  drip_edge?: boolean;
}

export interface WeatherBarrierSpec {
  house_wrap?: boolean;
  house_wrap_brand?: string;  // tyvek, typar, zip_system
  rigid_insulation?: boolean;
  insulation_r_value?: number;
}

export interface DemoSpec {
  existing_siding_type?: string;
  existing_layers?: number;
  remove_siding?: boolean;
  remove_trim?: boolean;
  remove_soffit?: boolean;
  remove_fascia?: boolean;
  dumpster_size?: string;
}

export interface RepairSpec {
  sheathing_repair?: boolean;
  sheathing_repair_sf?: number;
  fascia_board_repair?: boolean;
  fascia_repair_lf?: number;
  structural_repair?: boolean;
  structural_repair_notes?: string;
}

export interface SidingHiddenCosts {
  dumpster?: boolean;
  scaffolding?: boolean;
  permits?: boolean;
  lead_paint_test?: boolean;
  asbestos_test?: boolean;
  final_cleanup?: boolean;
  mobilization?: boolean;
  gutter_detach_reset?: boolean;
  downspout_detach_reset?: boolean;
  electrical_detach_reset?: boolean;
  hose_bib_detach_reset?: boolean;
  shutters_detach_reset?: boolean;
}

// ── Line Item ──

export interface SidingEstimateLineItem {
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

export interface SidingEstimate {
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
  stories?: number;

  // EagleView
  eagleview_report_id?: string;
  eagleview_claim_id?: string;
  eagleview_data?: Record<string, any>;

  // Measurements
  total_wall_area?: number;
  total_wall_area_net?: number;
  total_siding_area?: number;
  total_siding_area_net?: number;
  total_masonry_area?: number;
  total_masonry_area_net?: number;
  total_wall_facets?: number;
  total_windows_doors?: number;
  total_windows_doors_area?: number;
  total_windows_doors_perimeter?: number;
  fascia_lf?: number;
  inside_corners_lf?: number;
  outside_corners_lf?: number;
  obtuse_inside_corners_lf?: number;
  obtuse_outside_corners_lf?: number;
  inside_siding_corners_lf?: number;
  outside_siding_corners_lf?: number;
  top_siding_walls_lf?: number;
  bottom_siding_walls_lf?: number;

  // Specs
  siding_spec?: SidingMaterialSpec;
  trim_spec?: TrimSpec;
  soffit_fascia_spec?: SoffitFasciaSpec;
  weather_barrier_spec?: WeatherBarrierSpec;
  demo_spec?: DemoSpec;
  repair_spec?: RepairSpec;
  hidden_costs?: SidingHiddenCosts;

  // O&P
  overview_text?: string;
  include_overhead_profit?: boolean;
  overhead_pct?: number;
  profit_pct?: number;
  target_total?: number | null;
  adjustment_factor?: number | null;

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
  line_items: SidingEstimateLineItem[];

  // Enriched
  claim_number?: string;
  client_name?: string;

  created_at?: string;
  updated_at?: string;
}

// ── Request types ──

export type SidingEstimateCreate = Omit<SidingEstimate,
  'id' | 'status' | 'created_by_id' | 'subtotal' | 'overhead_amount' |
  'profit_amount' | 'tax_amount' | 'total' | 'methodology_notes' |
  'warning_flags' | 'line_items' | 'claim_number' | 'client_name' |
  'created_at' | 'updated_at'
>;

export type SidingEstimateUpdate = Partial<SidingEstimateCreate>;

// ── List response ──

export interface SidingEstimateListResponse {
  items: SidingEstimate[];
  total: number;
  page: number;
  page_size: number;
}

// Phase labels
export const SIDING_PHASE_LABELS: Record<number, string> = {
  1: 'Demo & Disposal',
  2: 'Sheathing & Structural Repair',
  3: 'Weather Barrier & Insulation',
  4: 'Siding Installation',
  5: 'Trim, Soffit & Fascia',
  6: 'Caulking, Paint & Cleanup',
};

// Siding type options
export const SIDING_TYPES = [
  { value: 'vinyl', label: 'Vinyl' },
  { value: 'fiber_cement', label: 'Fiber Cement (Hardie Board)' },
  { value: 'hardie_board', label: 'Hardie Board' },
  { value: 'wood', label: 'Wood' },
  { value: 'lp_smartside', label: 'LP SmartSide' },
  { value: 'metal', label: 'Metal' },
  { value: 'aluminum', label: 'Aluminum' },
];

export const SIDING_PROFILES = [
  { value: 'lap', label: 'Lap / Clapboard' },
  { value: 'dutch_lap', label: 'Dutch Lap' },
  { value: 'board_and_batten', label: 'Board & Batten' },
  { value: 'shake', label: 'Shake / Shingle' },
  { value: 'vertical', label: 'Vertical Panel' },
];
