/**
 * Roofing Estimate types
 */

// ── Component Spec interfaces ──

export interface ShingleSpec {
  type?: string;        // three_tab, architectural_std, architectural_premium, designer, impact_resistant
  brand?: string;       // gaf, certainteed, owens_corning, iko, malarkey
  product?: string;     // e.g. "Timberline HDZ"
  color?: string;
  warranty_years?: number;
  rate_per_square?: number;
}

export interface DeckingSpec {
  material?: string;           // osb_716, osb_12, cdx_12, cdx_58
  free_sheets_included?: number;
  rate_per_sheet?: number;
  estimated_sheets_needed?: number;
  re_nail_existing?: boolean;
  re_nail_sf?: number;
}

export interface UnderlaymentSpec {
  type?: string;        // felt_15, felt_30, synthetic
  product?: string;
  rate_per_sf?: number;
}

export interface IceWaterSpec {
  product?: string;
  eaves_coverage_lf?: number;
  eaves_width_ft?: number;
  valley_coverage_lf?: number;
  around_penetrations?: boolean;
  rate_per_sf?: number;
}

export interface DripEdgeSpec {
  material?: string;
  profile?: string;
  color?: string;
  rate_per_lf?: number;
}

export interface VentilationSpec {
  ridge_vent?: boolean;
  ridge_vent_lf?: number;
  static_vents?: number;
  exhaust_vents?: number;
}

export interface FlashingSpec {
  step_flashing_lf?: number;
  apron_flashing?: boolean;
  chimney_flashing?: number;
  chimney_cricket?: boolean[];
  pipe_boots?: number;
  pipe_boot_type?: string;   // rubber, lead, lifetime
  skylight_flashing_kits?: number;
}

export interface RidgeCapSpec {
  product?: string;
  rate_per_lf?: number;
}

export interface GutterStructureConfig {
  structure_index: number;
  included: boolean;
  total_lf?: number;
  downspout_count?: number;
  downspout_lf?: number;
  splash_blocks?: number;
  remove_existing?: boolean;
}

export interface GutterSpec {
  included?: boolean;
  scope?: string;           // full_replace, partial, new_install, remove_only
  material?: string;        // aluminum, copper, steel, vinyl
  style?: string;           // k_style, half_round
  size?: number;            // 5, 6
  type?: string;            // seamless, sectional
  color?: string;
  total_lf?: number;
  downspout_count?: number;
  downspout_lf?: number;
  downspout_size?: string;  // 2x3, 3x4
  splash_blocks?: number;
  gutter_guards?: boolean;
  guard_type?: string;      // mesh, micro_mesh, foam, reverse_curve
  guard_lf?: number;
  remove_existing?: boolean;
  remove_existing_lf?: number;
  per_structure?: GutterStructureConfig[];
}

export interface HiddenCosts {
  dumpster?: boolean;
  driveway_protection?: boolean;
  landscape_protection?: boolean;
  permit?: boolean;                    // legacy
  permit_option?: string;              // none | state | MD | VA | DC | custom
  permit_custom_fee?: number | null;
  magnetic_sweep?: boolean;
  re_nail_decking?: boolean;
  pipe_boots_replace?: boolean;
  vent_cap_replace?: boolean;
  lead_rrp?: boolean;
  hoa_review?: boolean;
  satellite_removal?: boolean;
}

export interface WarrantyInfo {
  labor_warranty_years?: number;
  material_warranty_source?: string;   // "manufacturer"
  material_warranty_text?: string;
  labor_warranty_text?: string;
  warranty_exclusions?: string;
}

export interface InsuranceInfo {
  carrier?: string;
  claim_number?: string;
  adjuster_name?: string;
  policy_type?: string;     // ACV, RCV
  o_and_p_approved?: boolean;
  code_upgrade_rider?: boolean;
  deductible?: number;
  xactimate_provided?: boolean;
}

// ── Line Item ──

export interface StructureResult {
  structure_index: number;
  label: string;
  included: boolean;
  total_sf?: number;
  squares?: number;
  predominant_pitch?: string;
  subtotal: number;
  total: number;
}

export interface RoofingEstimateLineItem {
  id: string;
  estimate_id: string;
  structure_index: number;
  phase: number;
  description: string;
  quantity: number;
  unit: string;
  unit_price: number;
  total: number;
  category?: string;
  xactimate_code?: string;
  notes?: string;
  display_order: number;
  created_at?: string;
}

// ── Main Estimate ──

export interface RoofingEstimate {
  id: string;
  claim_id?: string;
  company_id?: string;
  created_by_id?: string;
  status: string;

  // Project meta
  property_address?: string;
  city?: string;
  state?: string;
  zip_code?: string;
  building_type?: string;
  year_built?: number;
  stories: number;
  hoa: boolean;
  roof_access?: string;

  // Measurement
  measurement_source?: string;
  total_sf: number;
  squares: number;
  predominant_pitch?: string;
  pitch_multiplier: number;
  ridge_lf: number;
  hip_lf: number;
  valley_lf: number;
  eave_lf: number;
  rake_lf: number;
  step_flashing_lf: number;
  penetration_count: number;
  skylight_count: number;
  chimney_count: number;
  waste_factor: number;
  roof_complexity?: string;

  // EagleView
  eagleview_data?: any;
  selected_faces?: string[];

  // Scope
  full_tearoff: boolean;
  layer_count: number;
  overlay: boolean;
  existing_material?: string;
  insurance_job: boolean;

  // Component specs
  shingle_spec?: ShingleSpec;
  decking_spec?: DeckingSpec;
  underlayment_spec?: UnderlaymentSpec;
  ice_water_spec?: IceWaterSpec;
  drip_edge_spec?: DripEdgeSpec;
  ventilation_spec?: VentilationSpec;
  flashing_spec?: FlashingSpec;
  ridge_cap_spec?: RidgeCapSpec;
  gutter_spec?: GutterSpec;
  hidden_costs?: HiddenCosts;
  insurance_info?: InsuranceInfo;
  warranty_info?: WarrantyInfo;

  // Target total
  target_total?: number | null;
  adjustment_factor?: number | null;

  // Pricing
  pricing_method: string;
  material_markup_pct: number;
  labor_markup_pct: number;
  include_overhead_profit: boolean;
  overhead_pct: number;
  profit_pct: number;
  contingency_pct: number;

  // Totals
  subtotal: number;
  markup_amount: number;
  overhead_amount: number;
  profit_amount: number;
  tax_amount: number;
  permit_fee: number;
  total: number;

  // Per-structure results
  structure_results?: StructureResult[];

  // Documentation
  overview_text?: string;
  methodology_notes?: string;
  warning_flags?: string[];
  notes?: string;

  // Relations
  line_items: RoofingEstimateLineItem[];

  // Enriched
  claim_number?: string;
  client_name?: string;

  created_at?: string;
  updated_at?: string;
}

export type RoofingEstimateCreate = Partial<Omit<RoofingEstimate,
  'id' | 'status' | 'subtotal' | 'markup_amount' | 'overhead_amount' |
  'profit_amount' | 'tax_amount' | 'permit_fee' | 'total' | 'line_items' |
  'claim_number' | 'client_name' | 'created_at' | 'updated_at' |
  'methodology_notes' | 'warning_flags'
>>;

export type RoofingEstimateUpdate = RoofingEstimateCreate;

export interface RoofingEstimateListResponse {
  items: RoofingEstimate[];
  total: number;
  page: number;
  page_size: number;
}

export interface RoofingEstimateHistory {
  id: string;
  estimate_id: string;
  version_number: number;
  snapshot_data: any;
  changed_by_id?: string;
  change_description?: string;
  created_at?: string;
}

// ── EagleView Parse Result ──

export interface Point2D {
  x: number;
  y: number;
}

export interface EagleViewFace {
  id: string;
  designator: string;
  area: number;
  pitch: string;
  is_accessory: boolean;
  structure_index: number;
  vertices?: Point2D[];
  centroid?: Point2D;
}

export interface EagleViewLine {
  id: string;
  type: string;
  length: number;
  structure_index: number;
  points?: Point2D[];
}

export interface EagleViewStructure {
  index: number;
  label: string;
  total_sf: number;
  facet_count: number;
  predominant_pitch: string;
  pitch_min?: string;
  pitch_max?: string;
  complexity: string;
}

export interface EagleViewParseResult {
  faces: EagleViewFace[];
  all_faces: EagleViewFace[];
  lines: EagleViewLine[];
  structures: EagleViewStructure[];
  total_sf: number;
  squares: number;
  predominant_pitch?: string;
  ridge_lf: number;
  hip_lf: number;
  valley_lf: number;
  eave_lf: number;
  rake_lf: number;
  step_flashing_lf: number;
  penetration_count: number;
}

// ── Pricing Info ──

export interface RoofingPricingInfo {
  building_types: string[];
  roof_complexities: string[];
  existing_materials: string[];
  shingle_types: string[];
  shingle_brands: string[];
  decking_materials: string[];
  underlayment_types: string[];
  pipe_boot_types: string[];
  gutter_materials: string[];
  gutter_styles: string[];
  gutter_sizes: number[];
  gutter_types: string[];
  gutter_scopes: string[];
  downspout_sizes: string[];
  gutter_guard_types: string[];
  shingle_rates: Record<string, number>;
  decking_rates: Record<string, number>;
  pitch_multipliers: Record<string, number>;
  waste_factors: Record<string, number>;
}

// ── Phase Labels ──

export const PHASE_LABELS: Record<number, string> = {
  1: 'Setup & Tear-off',
  2: 'Decking',
  3: 'Underlayment & Ice Barrier',
  4: 'Drip Edge & Flashing',
  5: 'Shingle Install',
  6: 'Ventilation & Penetrations',
  7: 'Gutter',
  8: 'Cleanup & Misc',
};

export const STATUS_COLORS: Record<string, string> = {
  draft: 'default',
  calculated: 'processing',
  approved: 'success',
  exported: 'purple',
};
