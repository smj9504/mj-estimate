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
