// ── Condition types ──

export type ConditionScope = 'damaged' | 'affected';

export interface RepairCondition {
  id: string;
  company_id?: string | null;
  name: string;
  category?: string | null;
  scope: ConditionScope;
  description?: string | null;
  is_active: boolean;
  sort_order: number;
  created_at?: string;
  updated_at?: string;
}

export interface RepairConditionCreate {
  name: string;
  category?: string;
  scope?: ConditionScope;
  description?: string;
  company_id?: string;
  is_active?: boolean;
  sort_order?: number;
}

export interface RepairConditionUpdate {
  name?: string;
  category?: string;
  scope?: ConditionScope;
  description?: string;
  is_active?: boolean;
  sort_order?: number;
}

// ── Template Item types ──

export interface RepairTemplateItem {
  id: string;
  template_id: string;
  condition_id: string;
  xactimate_item_code: string;
  description_override?: string | null;
  default_unit?: string | null;
  is_required: boolean;
  sort_order: number;
  condition?: RepairCondition;
  created_at?: string;
}

export interface RepairTemplateItemCreate {
  condition_id: string;
  xactimate_item_code: string;
  description_override?: string;
  default_unit?: string;
  is_required?: boolean;
  sort_order?: number;
}

// ── Suggestion types ──

export interface ConditionSuggestion {
  id: string;
  template_id: string;
  from_condition_id: string;
  to_condition_id: string;
  from_condition?: RepairCondition;
  to_condition?: RepairCondition;
}

export interface ConditionSuggestionCreate {
  from_condition_id: string;
  to_condition_id: string;
}

// ── Template types ──

export interface TemplateConditionLink {
  condition_id: string;
  sort_order?: number;
}

export interface RepairTemplateListItem {
  id: string;
  company_id?: string | null;
  name: string;
  surface?: string | null;
  description?: string | null;
  tags: string[];
  is_active: boolean;
  usage_count: number;
  condition_count: number;
  item_count: number;
  created_at?: string;
}

export interface RepairTemplateDetail {
  id: string;
  company_id?: string | null;
  name: string;
  surface?: string | null;
  description?: string | null;
  tags: string[];
  is_active: boolean;
  usage_count: number;
  created_by?: string | null;
  conditions: RepairCondition[];
  items: RepairTemplateItem[];
  suggestions: ConditionSuggestion[];
  created_at?: string;
  updated_at?: string;
}

export interface RepairTemplateCreate {
  name: string;
  surface?: string;
  description?: string;
  tags?: string[];
  company_id?: string;
  conditions?: TemplateConditionLink[];
  items?: RepairTemplateItemCreate[];
  suggestions?: ConditionSuggestionCreate[];
}

export interface RepairTemplateUpdate {
  name?: string;
  surface?: string;
  description?: string;
  tags?: string[];
  is_active?: boolean;
  conditions?: TemplateConditionLink[];
  items?: RepairTemplateItemCreate[];
  suggestions?: ConditionSuggestionCreate[];
}

// ── Apply / Compare types ──

export interface AppliedLineItem {
  xactimate_item_code: string;
  description: string;
  unit?: string | null;
  unit_price?: number | null;
  condition_name: string;
  condition_scope: ConditionScope;
  is_required: boolean;
}

export interface TemplateApplyResponse {
  template_id: string;
  template_name: string;
  items: AppliedLineItem[];
}

export interface MatchedItem {
  template_item: AppliedLineItem;
  extraction_item: Record<string, unknown>;
  status: 'ok' | 'qty_diff' | 'price_diff';
}

export interface TemplateCompareResponse {
  matched: MatchedItem[];
  missing: AppliedLineItem[];
  extra: Record<string, unknown>[];
}
