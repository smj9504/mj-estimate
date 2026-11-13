/**
 * Rebuild estimate: one estimate for a claim's rebuild. The flooring,
 * bathroom and kitchen cabinet estimates come in line by line; the repairs
 * none of them covers are added room by room.
 */

export type SourceKind = 'flooring' | 'bathroom' | 'cabinet';
export type XactActivity = '&' | '+' | '-' | 'R' | 'M' | 'I';
export type AddedSection = 'floor' | 'wall' | 'ceiling' | 'other';
export type Basis = 'floor_sf' | 'ceiling_sf' | 'wall_sf' | 'perimeter_lf';

export interface Measures {
  floor_sf?: number | null;
  ceiling_sf?: number | null;
  wall_sf?: number | null;
  perimeter_lf?: number | null;
  height_ft?: number | null;
}

export interface RebuildRoom {
  id: string;
  name: string;
  level_name?: string | null;
  measures: Measures;
}

export interface ActivityPrice {
  activity: XactActivity;
  label?: string;
  /** The price list's own price, before our markup */
  price: number;
  marked_up?: number;
  material_share: number;
}

/** A repair added on the rebuild estimate */
export interface RebuildLine {
  id: string;
  room_id: string | null;
  section: AddedSection;
  description: string;
  unit: string;
  /** null: the room's measure (basis) */
  quantity: number | null;
  basis: Basis | null;
  /** Typed: used as it is */
  unit_price: number | null;
  code?: string | null;
  activity?: XactActivity | null;
  price_list?: string | null;
  activities: ActivityPrice[];
  notes?: string | null;
}

export interface ImportedSource {
  id: string;
  kind: SourceKind;
  estimate_id: string;
  label: string;
  op_included: boolean;
  total: number;
  line_count: number;
  imported_at: string | null;
  rooms: { key: string; name: string }[];
  room_map: Record<string, string>;
  /** current: as the original is now; changed: it was recalculated since; missing: deleted */
  state: 'current' | 'changed' | 'missing';
  path: string;
}

export interface AssembledLine {
  id: string;
  n: number;
  source: 'imported' | 'added';
  source_id?: string;
  source_label?: string;
  section: string;
  description: string;
  quantity: number;
  unit: string;
  unit_price: number;
  total: number;
  notes?: string | null;
  basis?: Basis | null;
  auto_qty?: number | null;
  qty_typed?: boolean;
  price_typed?: boolean;
  base_price?: number | null;
}

export interface AssembledSection {
  key: string;
  label: string;
  lines: AssembledLine[];
  total: number;
}

export interface AssembledRoom {
  id: string | null;
  name: string;
  level_name?: string | null;
  measures: Measures;
  sections: AssembledSection[];
  total: number;
}

export interface RebuildEstimate {
  id: string;
  claim_id: string | null;
  company_id: string | null;
  status: string;
  property_address: string | null;
  city: string | null;
  state: string | null;
  zip_code: string | null;
  include_overhead_profit: boolean;
  overhead_pct: number;
  profit_pct: number;
  total: number;
  notes: string | null;
  created_at?: string;
  updated_at?: string | null;
  claim_number?: string | null;
  client_name?: string | null;
  client_id?: string | null;
  source_labels?: string[];
  rooms: RebuildRoom[];
  lines: RebuildLine[];
  sources: ImportedSource[];
  assembled: {
    rooms: AssembledRoom[];
    by_source: { id: string; label: string; total: number }[];
    added_total: number;
    total: number;
    tax_rate: number;
    warnings: string[];
  };
}

export interface ImportableEstimate {
  kind: SourceKind;
  kind_label: string;
  estimate_id: string;
  label: string;
  status: string;
  estimate_kind: string;
  option_label: string | null;
  property_address: string | null;
  line_count: number;
  total: number;
  calculated: boolean;
  updated_at: string | null;
  imported: boolean;
  path: string;
}

export interface XactimateMatch {
  code: string;
  category_code: string;
  description: string;
  unit: string;
  price_list: string | null;
  activities: ActivityPrice[];
}
