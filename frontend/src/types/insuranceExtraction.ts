export interface InsuranceExtractionItem {
  id: string;
  room?: string;
  line_item: string;
  notes?: string | null;
  unit_price?: number;
  quantity?: number;
  measurement?: string;
  unit?: string;
  source_page?: number;
  confidence?: number;
  raw_line?: string;
  validation_flags: string[];
}

export interface ExtractionTotals {
  tax?: number;
  op?: number;
  rcv?: number;
  depreciation?: number;
  acv?: number;
}

export interface ExtractionRoomHierarchy {
  name: string;
  item_indices: number[];
  dimensions?: Record<string, number>;
  height_ft?: number | null;
  totals?: ExtractionTotals;
}

export interface ExtractionLevelHierarchy {
  name: string;
  rooms: ExtractionRoomHierarchy[];
  level_totals?: ExtractionTotals;
}

export interface ExtractionSectionHierarchy {
  name: string;
  item_indices: number[];
  kind?: string;
  totals?: Record<string, number>;
}

export interface ExtractionHierarchy {
  levels: ExtractionLevelHierarchy[];
  sections: ExtractionSectionHierarchy[];
  unassigned_item_indices: number[];
}

/** Full extraction with items — used on detail page */
export interface InsuranceExtraction {
  id: string;
  file_id: string;
  carrier?: string;
  status: string;
  pages: number;
  raw_text_excerpt?: string;
  parser_metadata: Record<string, unknown> & {
    hierarchy?: ExtractionHierarchy;
    header?: Record<string, unknown>;
    summary?: Record<string, number>;
  };
  items: InsuranceExtractionItem[];
  created_at?: string;
}

/** Lightweight extraction for list — no items, just count */
export interface InsuranceExtractionSummary {
  id: string;
  file_id: string;
  carrier?: string;
  status: string;
  pages: number;
  item_count: number;
  parser_metadata: Record<string, unknown> & {
    header?: Record<string, unknown>;
    summary?: Record<string, number>;
  };
  created_at?: string;
}

// ── Analysis types ──

export type SurfaceCategoryType = 'wall' | 'floor' | 'ceiling' | 'general';

export interface CategorizedItem {
  item_id: string;
  line_item: string;
  surface_category: SurfaceCategoryType;
  quantity?: number | null;
  unit?: string | null;
  unit_price?: number | null;
}

export interface RoomAnalysis {
  room_name: string;
  level_name: string;
  dimensions: Record<string, number>;
  height_ft?: number | null;
  items_by_surface: Record<SurfaceCategoryType, CategorizedItem[]>;
  item_count: number;
}

export interface SectionAnalysis {
  section_name: string;
  kind: string;
  items_by_surface: Record<SurfaceCategoryType, CategorizedItem[]>;
  item_count: number;
}

export interface ExtractionAnalysisResponse {
  extraction_id: string;
  rooms: RoomAnalysis[];
  sections: SectionAnalysis[];
  unassigned_items: Record<SurfaceCategoryType, CategorizedItem[]>;
  summary: {
    total_items: number;
    by_category: Record<SurfaceCategoryType, number>;
  };
}

export interface InsuranceExtractionUpdatePayload {
  carrier?: string;
  status?: string;
  raw_text_excerpt?: string;
  parser_metadata?: Record<string, unknown>;
  items: Array<{
    id?: string;
    room?: string;
    line_item: string;
    notes?: string | null;
    unit_price?: number;
    quantity?: number;
    measurement?: string;
    unit?: string;
    source_page?: number;
    confidence?: number;
    raw_line?: string;
    validation_flags?: string[];
    sort_order?: number;
  }>;
}
