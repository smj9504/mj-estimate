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
  ridge_vent_type?: string;  // shingle_over | aluminum
  ridge_vent_lf?: number;
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

// ── Roof Penetration ──

export interface RoofPenetration {
  type: string;
  quantity: number;
  structure_index?: number;  // which structure this belongs to (multi-structure)
  notes?: string;
}

export const PENETRATION_TYPE_OPTIONS = [
  { label: 'Pipe Boot — Rubber', value: 'pipe_boot_rubber' },
  { label: 'Pipe Boot — Lead', value: 'pipe_boot_lead' },
  { label: 'Pipe Boot — Lifetime', value: 'pipe_boot_lifetime' },
  { label: 'Pipe Jack', value: 'pipe_jack' },
  { label: 'Turtle Vent (Static)', value: 'turtle_vent' },
  { label: 'Turbine Vent', value: 'turbine_vent' },
  { label: 'Kitchen Exhaust', value: 'kitchen_exhaust' },
  { label: 'Bath Exhaust', value: 'bath_exhaust' },
  { label: 'Dryer Vent', value: 'dryer_vent' },
  { label: 'Radon Pipe', value: 'radon_pipe' },
  { label: 'Satellite Mount', value: 'satellite_mount' },
  { label: 'Other', value: 'other' },
];

// ── Skylight Replacement (add-on) ──

export interface SkylightReplacement {
  type: string;       // small_fixed, medium_fixed, large_fixed, small_venting, medium_venting, large_venting, tube_10, tube_14
  quantity: number;
  location?: string;  // e.g. "master bedroom", "kitchen"
}

export interface AddOnQuote {
  description: string;
  quantity: number;
  unit: string;
  unit_price: number;
  total: number;
  category: string;
}

// ── Manual Structure ──

export interface ManualStructure {
  index: number;
  label: string;
  total_sf: number;
  predominant_pitch?: string;
  roof_complexity?: string;
  waste_factor?: number;
  ridge_lf?: number;
  hip_lf?: number;
  valley_lf?: number;
  eave_lf?: number;
  rake_lf?: number;
  step_flashing_lf?: number;
  penetration_count?: number;
  skylight_count?: number;
  chimney_count?: number;
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
  /** Material/labor split of `total`, driving markup and sales tax. */
  material_portion?: number;
  material_cost?: number;
  labor_cost?: number;
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
  manual_structures?: ManualStructure[];

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
  roof_penetrations?: RoofPenetration[];
  skylight_replacements?: SkylightReplacement[];
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
  /**
   * Share of each line item's installed price treated as material, for
   * markup and sales tax. Undefined/null uses the per-category ratios;
   * a value overrides every category for this estimate.
   */
  material_portion_pct?: number | null;
  /** Crew labor + disposal, for the internal profit panel. */
  job_cost_inputs?: RoofingJobCostInputs | null;

  // Totals
  roofing_subtotal: number;
  gutter_subtotal: number;
  subtotal: number;
  material_cost_total: number;
  labor_cost_total: number;
  markup_amount: number;
  overhead_amount: number;
  profit_amount: number;
  contingency_amount: number;
  tax_amount: number;
  permit_fee: number;
  total: number;

  // Add-on quotes
  add_ons?: AddOnQuote[];

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
  'id' | 'status' | 'roofing_subtotal' | 'gutter_subtotal' |
  'subtotal' | 'markup_amount' | 'overhead_amount' |
  'profit_amount' | 'contingency_amount' | 'tax_amount' |
  'material_cost_total' | 'labor_cost_total' |
  'permit_fee' | 'total' |
  'add_ons' | 'line_items' |
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
  permit_fees: Record<string, number>;
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

// ── Internal material cost (never shown to the customer) ──

export interface MaterialCostItem {
  key: string;
  price_key?: string;
  category: string;
  category_label: string;
  description: string;
  /** Whole purchase units — bundles, rolls, pieces. */
  quantity: number;
  /** BD / RL / PC / BX / EA — how the supplier sells it. */
  unit: string;
  /** The roof measurement this was converted from, before rounding up. */
  measured_quantity?: number | null;
  measured_unit?: string | null;
  /** How the conversion was made, e.g. "3 BD/SQ". */
  packaging_note?: string;
  unit_cost: number;
  default_unit_cost: number;
  is_overridden: boolean;
  taxable: boolean;
  subtotal: number;
  note: string;
}

export interface MaterialCostCategory {
  category: string;
  label: string;
  items: MaterialCostItem[];
  subtotal: number;
  tax_amount: number;
  total_with_tax: number;
  pct_of_material: number;
}

export interface MaterialCostBreakdown {
  items: MaterialCostItem[];
  categories: MaterialCostCategory[];
  tax_rate: number;
  subtotal_before_tax: number;
  taxable_subtotal: number;
  tax_amount: number;
  total_with_tax: number;
  estimate_total: number | null;
  /**
   * Both null: material cost alone is not profit — it ignores the crew
   * and the dumpster. Use `job_cost` for the real figure.
   */
  gross_profit: number | null;
  margin_pct: number | null;
  material_pct_of_sale?: number | null;
  job_cost?: RoofingJobCost | null;
  price_book: MaterialPriceEntry[];
  snapshot_taken: boolean;
}

/** Crew labor rates and disposal, entered per estimate. */
export interface RoofingJobCostInputs {
  crew_name?: string | null;
  crew_note?: string | null;
  /** Install labor, $ per square (waste included). */
  labor_per_sq?: number | null;
  /** Tear-off labor, $ per square. Crews quote this separately. */
  tearoff_per_sq?: number | null;
  /** Mobilization / minimum call-out, independent of area. */
  labor_fixed?: number | null;
  disposal_method?: 'dumpster' | 'truck';
  /** Truck disposal: landfill tipping fee per ton. */
  tipping_fee_per_ton?: number | null;
  haul_trips?: number | null;
  haul_cost_per_trip?: number | null;
}

export interface RoofingJobCost {
  material_cost: number;
  labor: {
    install_cost: number;
    tearoff_cost: number;
    fixed_cost: number;
    total: number;
    install_per_sq: number;
    tearoff_per_sq: number;
    squares: number;
    crew_name: string | null;
    /** False -> no rate entered; the margin must not be shown. */
    entered: boolean;
  };
  disposal: {
    method: 'dumpster' | 'truck';
    total: number;
    entered: boolean;
    debris_lb?: number;
    debris_tons?: number;
    container?: string | null;
    tipping_fee?: number;
    haul_labor?: number;
    trips?: number;
    tipping_fee_per_ton?: number;
    haul_cost_per_trip?: number;
  };
  total_cost: number;
  estimate_total: number | null;
  profit: number | null;
  margin_pct: number | null;
  /** False -> labor unknown; show what is missing, not a margin. */
  complete: boolean;
  missing: string[];
  cost_breakdown_pct: {
    material: number;
    labor: number;
    disposal: number;
  };
}

export interface MaterialPriceEntry {
  id?: string;
  material_key: string;
  label: string;
  category: string;
  /** Purchase unit: BD / RL / PC / BX / EA / SQ. */
  unit: string;
  unit_cost: number;
  is_taxable: boolean;
  /** Retired materials stay for old estimates but leave the pick lists. */
  is_active: boolean;
  notes: string;
  company_id: string | null;

  // What the material actually is. Null on rows that only name a grade.
  manufacturer?: string | null;
  product_name?: string | null;
  color?: string | null;
  size_spec?: string | null;
  supplier?: string | null;
  sku?: string | null;
  /**
   * Quantity formula: take `qty_basis`, divide by `coverage_per_unit`,
   * round up, never below `qty_minimum`. Null basis keeps the built-in
   * packaging rule.
   */
  /** Spreadsheet expression; wins over basis/coverage. */
  qty_formula?: string | null;
  qty_basis?: string | null;
  /** Measured units covered by one purchase unit (10 SQ per RL -> 10). */
  coverage_per_unit?: number | null;
  coverage_unit?: string | null;
  qty_minimum?: number | null;
  /** True when a user added it rather than the seed catalog. */
  is_custom: boolean;
}

/** A measurement a quantity formula can be written against. */
export interface FormulaValidation {
  ok: boolean;
  value: number | null;
  error: string | null;
  used: string[];
  sample?: Record<string, number>;
}

export interface FormulaVariableDoc {
  name: string;
  label: string;
  unit: string;
  aliases: string[];
}

export interface MaterialBasis {
  value: string;
  label: string;
  unit: string;
}

export interface MaterialPricePatch {
  unit_cost?: number;
  is_taxable?: boolean;
  is_active?: boolean;
  notes?: string;
  label?: string;
  category?: string;
  unit?: string;
  manufacturer?: string | null;
  product_name?: string | null;
  color?: string | null;
  size_spec?: string | null;
  supplier?: string | null;
  sku?: string | null;
  coverage_per_unit?: number | null;
  coverage_unit?: string | null;
}

export interface MaterialPriceCreate {
  label: string;
  category: string;
  unit: string;
  unit_cost: number;
  is_taxable?: boolean;
  notes?: string;
  manufacturer?: string;
  product_name?: string;
  color?: string;
  size_spec?: string;
  supplier?: string;
  sku?: string;
  qty_formula?: string;
  qty_basis?: string;
  coverage_per_unit?: number;
  coverage_unit?: string;
  qty_minimum?: number;
}

export interface MaterialCostOverride {
  unit_cost?: number;
  taxable?: boolean;
  note?: string;
}

export interface MaterialCostUpdate {
  overrides?: Record<string, MaterialCostOverride>;
  tax_rate?: number;
}

// ── Pricing settings (calculation rates, NOT material costs) ──
//
// Material costs live in the price book (MaterialPriceEntry) and are
// deliberately absent here, so this screen can never be the place a
// supplier cost gets changed.

export type PricingSettingKind = 'money' | 'rate' | 'pct';

export interface PricingSettingEntry {
  setting_group: string;
  setting_key: string;
  group_label: string;
  label: string;
  kind: PricingSettingKind;
  unit?: string | null;
  help?: string | null;
  value: number;
  default_value?: number | null;
  is_overridden: boolean;
  notes?: string | null;
  id?: string | null;
  company_id?: string | null;

  /**
   * Supplier cost of the main material behind this rate, restated in the
   * rate's own unit. Null when the rate has no single dominant material
   * (tear-off, permits, misc). Read-only — edited on Material Prices.
   */
  material_cost?: number | null;
  material_label?: string | null;
  material_unit_cost?: number | null;
  material_purchase_unit?: string | null;
  material_key?: string | null;
  material_per_rate_unit?: number | null;
  material_rate_unit?: string | null;
}

export interface PricingSettingGroup {
  group: string;
  label: string;
  kind: PricingSettingKind;
  unit?: string | null;
  help?: string | null;
}

/** value null resets that setting back to its code default. */
export interface PricingSettingPatch {
  setting_group: string;
  setting_key: string;
  value: number | null;
  notes?: string | null;
}

export interface PricingSettingsResponse {
  settings: PricingSettingEntry[];
  groups: PricingSettingGroup[];
  overridden_count: number;
}
