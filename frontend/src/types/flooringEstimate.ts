/**
 * Flooring estimate: the sketch (in feet, interior wall to wall), the scope
 * the estimator picks per room, and what the API sends back.
 * Mirrors backend/app/domains/flooring_estimate/schemas.py.
 */

// ── Sketch ──

export interface FtPoint {
  x: number;
  y: number;
}

export interface SketchRoom {
  id: string;
  name: string;
  height_ft: number;
  /** The finished floor's outline: interior faces of the walls, in feet */
  points: FtPoint[];
  /** A closet or alcove listed under its room */
  subroom_of?: string | null;
}

/** open_wall: a side with no wall at all, measured like a doorway as wide as that side */
export type OpeningKind = 'opening' | 'open_wall' | 'door' | 'bifold' | 'pocket' | 'slider' | 'exterior_door';

export interface SketchOpening {
  id: string;
  kind: OpeningKind;
  /** The room it opens from, then the room it opens into (null: outside) */
  rooms: [string, string | null] | [string];
  /** Its two jambs, on the first room's wall */
  a: FtPoint;
  b: FtPoint;
  /** The room the door leaf swings into */
  swing?: string | null;
  /** The jamb it hangs on */
  hinge?: 'a' | 'b' | null;
}

export interface SketchCabinetRun {
  id: string;
  room_id: string;
  a: FtPoint;
  b: FtPoint;
  /** Whether the cabinet's side shows at each end (it takes shoe molding); null or absent: worked out from the sketch */
  side_a?: boolean | null;
  side_b?: boolean | null;
}

export type FixtureType =
  | 'toilet' | 'vanity' | 'pedestal_sink' | 'utility_sink' | 'island' | 'refrigerator' | 'range'
  | 'dishwasher' | 'washer' | 'dryer' | 'floor_register' | 'other';

export interface SketchFixture {
  id: string;
  type: FixtureType;
  /** Center, in feet */
  x: number;
  y: number;
  w: number;
  h: number;
  rotation: number;
  /** An island the new floor runs under (its area is floored) */
  floor_under?: boolean;
  /** A range or dryer on gas: more to its detach & reset */
  gas?: boolean;
  /** Set on top of the new floor, or the floor cut to fit it (a hole for its pipe or duct); absent: its type's
   * (FIXTURE_FLOOR_FIT). An island goes by floor_under. */
  floor_fit?: FloorFit | null;
}

/** How a fixture meets the new floor: set back on top of it, or the floor cut to fit it (a hole: more labor) */
export type FloorFit = 'on_top' | 'cut_to_fit';

/** A wall built out from one of a room's walls (a wall end, a partition): from a, on the room's wall, to b */
export interface SketchWall {
  id: string;
  room_id: string;
  a: FtPoint;
  b: FtPoint;
  /** Feet */
  thickness: number;
}

export interface SketchLevel {
  id: string;
  name: string;
  rooms: SketchRoom[];
  openings: SketchOpening[];
  cabinet_runs: SketchCabinetRun[];
  fixtures: SketchFixture[];
  walls: SketchWall[];
}

export interface FlooringSketch {
  version: 1;
  units: 'ft';
  levels: SketchLevel[];
}

// ── Scope ──

export type FloorMaterial =
  | 'lvp' | 'laminate' | 'engineered_hardwood' | 'solid_hardwood'
  | 'ceramic_tile' | 'porcelain_tile' | 'sheet_vinyl' | 'carpet';

export type LayPattern = 'straight' | 'diagonal' | 'herringbone';

export interface ItemChoice {
  on?: boolean | null;
  qty?: number | null;
  unit_price?: number | null;
  note?: string | null;
}

export interface CustomItem {
  id?: string | null;
  description: string;
  quantity: number;
  unit: string;
  unit_price?: number | null;
  price_key?: string | null;
  notes?: string | null;
}

/** What happens to a room's floor: torn out and a new one laid, or the hardwood there sanded and refinished */
export type FloorWork = 'replace' | 'refinish';
export type RefinishFinish = 'natural' | 'stain' | 'water_natural' | 'water_stain' | 'seal';

export interface RoomScope {
  included?: boolean;
  /** Null: the job's (replace when the job doesn't say) */
  work?: FloorWork | null;
  finish?: RefinishFinish | null;
  new_material?: FloorMaterial | null;
  pattern?: LayPattern | null;
  waste_pct?: number | null;
  existing_material?: FloorMaterial | null;
  items?: Record<string, ItemChoice>;
  custom_items?: CustomItem[];
  notes?: string | null;
}

export interface JobScope {
  defaults?: {
    work?: FloorWork | null;
    finish?: RefinishFinish | null;
    new_material?: FloorMaterial | null;
    existing_material?: FloorMaterial | null;
    pattern?: LayPattern | null;
  };
  room_items?: Record<string, ItemChoice>;
  items?: Record<string, ItemChoice>;
  custom_items?: CustomItem[];
}

// ── What the API sends back ──

export interface TakeoffItem {
  key: string;
  label: string;
  group: string;
  category: string;
  unit: string;
  basis: string;
  on: boolean;
  default_on: boolean;
  on_source: 'room' | 'job' | 'default';
  auto_qty: number;
  qty: number;
  qty_typed: boolean;
  unit_price: number;
  price_typed: boolean;
  price_key: string | null;
  notes: string | null;
  source: 'auto' | 'item' | 'custom';
  estimated_total: number;
}

export interface TakeoffRoom {
  room_id: string;
  name: string;
  level_id: string;
  level_name: string;
  height_ft: number;
  subroom_of: string | null;
  floor_sf: number;
  ceiling_sf: number;
  floor_sy: number;
  perimeter_lf: number;
  openings_lf: number;
  cabinet_run_lf: number;
  cabinet_front_lf: number;
  cabinet_side_lf: number;
  base_lf: number;
  toe_kick_lf: number;
  shoe_lf: number;
  island_count: number;
  island_floored_count: number;
  island_lf: number;
  island_perimeter_lf: number;
  island_panel_sf: number;
  wall_sf: number;
  door_count: number;
  exterior_door_count: number;
  toilet_count: number;
  vanity_count: number;
  pedestal_sink_count: number;
  utility_sink_count: number;
  appliance_count: number;
  refrigerator_count: number;
  range_count: number;
  range_gas_count: number;
  dishwasher_count: number;
  washer_count: number;
  dryer_count: number;
  dryer_gas_count: number;
  register_count: number;
  included: boolean;
  work: FloorWork;
  finish: RefinishFinish;
  new_material: FloorMaterial | null;
  pattern: LayPattern;
  waste_pct: number;
  existing_material: FloorMaterial | null;
  transitions: string[];
  items: TakeoffItem[];
}

export interface FlooringLineItem {
  id: string;
  estimate_id: string;
  room_id: string | null;
  room_name: string;
  level_name: string | null;
  category: string;
  item_key: string | null;
  source: string;
  description: string;
  quantity: number;
  unit: string;
  unit_price: number;
  total: number;
  notes: string | null;
  display_order: number;
}

/** What /pricing-info says about the catalog, at the estimate's prices */
export interface CatalogItem {
  key: string;
  label: string;
  group: string;
  unit: string;
  basis: string;
  basis_label: string;
  factor: number;
  manual_qty: number;
  rule: string;
  rule_label: string;
  price_key: string;
  hint: string;
  unit_price: number;
}

export interface MaterialInfo {
  key: FloorMaterial;
  label: string;
  short: string;
  unit: string;
  material_price: number;
  install_labor: number;
  patterned: boolean;
  waste_pct: Partial<Record<LayPattern, number>>;
  box_coverage_sf: number | null;
  removal_label: string;
  removal_price: number;
}

export interface PriceListItem {
  key: string;
  label: string;
  group: string;
  unit: string;
  unit_price: number;
}

/** How the PDF is laid out: each room a card, the house by kind of work, or a proposal in words */
export type FlooringPdfLayout = 'rooms' | 'trades' | 'proposal';

export interface FinishInfo {
  key: RefinishFinish;
  label: string;
  includes: string;
  price: number;
}

export interface FlooringPricingInfo {
  materials: MaterialInfo[];
  finishes?: FinishInfo[];
  price_list: PriceListItem[];
  patterns: { key: LayPattern; label: string; labor_multiplier: number }[];
  pad_price: number;
  room_items: CatalogItem[];
  general_items: CatalogItem[];
}

export interface PriceBookSummary {
  id: string;
  priced_at: string | null;
  is_current: boolean;
}

export interface FlooringEstimate {
  id: string;
  claim_id: string | null;
  company_id: string | null;
  status: string;
  group_id: string | null;
  project_type: 'insurance' | 'remodel';
  kind: string;
  option_label: string | null;
  property_address: string | null;
  city: string | null;
  state: string | null;
  zip_code: string | null;
  sketch_data: FlooringSketch | null;
  room_scopes: Record<string, RoomScope> | null;
  job_scope: JobScope | null;
  overview_text: string | null;
  include_overhead_profit: boolean | null;
  overhead_pct: number | null;
  profit_pct: number | null;
  subtotal: number | null;
  total: number | null;
  warning_flags: string[] | null;
  methodology_notes: string | null;
  notes: string | null;
  price_book: PriceBookSummary | null;
  line_items: FlooringLineItem[];
  takeoff: {
    rooms: TakeoffRoom[];
    general_items: TakeoffItem[];
    warnings: string[];
  } | null;
  claim_number: string | null;
  client_name: string | null;
  created_at: string | null;
  updated_at: string | null;
}
