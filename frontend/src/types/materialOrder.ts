/**
 * Material Order types
 */

export type ScopeType = 'roofing' | 'siding';

export type MaterialCategory = 'main' | 'underlayment' | 'trim' | 'fastener' | 'misc';

export type OutputType = 'supply_order' | 'internal_estimate';

export interface RoofingMeasurements {
  total_area_sf: number;
  squares: number;
  squares_with_waste: number;
  eaves_lf: number;
  rakes_lf: number;
  ridges_lf: number;
  hips_lf: number;
  valleys_lf: number;
  step_flashing_lf: number;
  drip_edge_lf: number;
  penetration_count: number;
  waste_pct: number;
  structure_complexity?: string;
}

export interface SidingMeasurements {
  net_siding_sqft: number;
  masonry_sqft: number;
  wd_perimeter_lf: number;
  wd_area_sqft: number;
  wd_count: number;
  fascia_lf: number;
  bottom_wall_lf: number;
  top_wall_lf: number;
  outside_corner_lf: number;
  inside_corner_lf: number;
  waste_pct: number;
}

export interface MaterialItem {
  category: MaterialCategory;
  item: string;
  qty: number;
  unit: string;
  formula: string;
  note: string;
  unit_price?: number | null;
  ai_qty?: number | null;
}

export interface MaterialOrderRequest {
  scope_type: ScopeType;
  property_address?: string;
  report_number?: string;
  delivery_date?: string;
  brand: string;
  product?: string;
  color?: string;
  waste_pct: number;
  roofing_measurements?: RoofingMeasurements;
  siding_measurements?: SidingMeasurements;
}

export interface MaterialOrderResponse {
  scope_type: ScopeType;
  property_address: string;
  report_number: string;
  delivery_date?: string;
  brand: string;
  product?: string;
  color?: string;
  measurements: Record<string, any>;
  materials: MaterialItem[];
  notes: string[];
}

export interface MaterialOrderExportRequest {
  scope_type: ScopeType;
  output_type: OutputType;
  property_address: string;
  report_number: string;
  delivery_date?: string;
  brand: string;
  product?: string;
  color?: string;
  measurements: Record<string, any>;
  materials: MaterialItem[];
  notes: string[];
}

export interface BrandInfo {
  [brandName: string]: {
    roofing: boolean;
    siding: boolean;
  };
}

export const DEFAULT_ROOFING_MEASUREMENTS: RoofingMeasurements = {
  total_area_sf: 0,
  squares: 0,
  squares_with_waste: 0,
  eaves_lf: 0,
  rakes_lf: 0,
  ridges_lf: 0,
  hips_lf: 0,
  valleys_lf: 0,
  step_flashing_lf: 0,
  drip_edge_lf: 0,
  penetration_count: 0,
  waste_pct: 12,
  structure_complexity: undefined,
};

export const DEFAULT_SIDING_MEASUREMENTS: SidingMeasurements = {
  net_siding_sqft: 0,
  masonry_sqft: 0,
  wd_perimeter_lf: 0,
  wd_area_sqft: 0,
  wd_count: 0,
  fascia_lf: 0,
  bottom_wall_lf: 0,
  top_wall_lf: 0,
  outside_corner_lf: 0,
  inside_corner_lf: 0,
  waste_pct: 10,
};

export interface EagleViewRoofingResult {
  total_area_sf: number;
  squares: number;
  squares_with_waste: number;
  eaves_lf: number;
  rakes_lf: number;
  ridges_lf: number;
  hips_lf: number;
  valleys_lf: number;
  step_flashing_lf: number;
  drip_edge_lf: number;
  penetration_count: number;
  waste_pct: number;
  structure_complexity?: string;
  predominant_pitch?: string;
  structures?: Array<{
    index: number;
    label: string;
    total_sf: number;
    facet_count: number;
    predominant_pitch: string;
    complexity: string;
  }>;
}

export const CATEGORY_LABELS: Record<MaterialCategory, string> = {
  main: 'Main Material',
  underlayment: 'Underlayment',
  trim: 'Trim & Flashing',
  fastener: 'Fasteners',
  misc: 'Miscellaneous',
};
