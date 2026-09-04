/**
 * Water Mitigation System Type Definitions
 * Matches backend schemas from app/domains/water_mitigation/schemas.py
 */

// Job Status Enum
export enum JobStatus {
  LEAD = "Lead",
  DOC_PREPPING = "Doc prepping",
  SENT_TO_ADJUSTER = "Sent to adjuster",
  FOLLOW_UP = "Follow up",
  PAPERWORK_RECEIVED = "Paperwork received",
  CHECK_RECEIVED = "Check received",
  COMPLETE = "Complete"
}

export const JOB_STATUS_OPTIONS = [
  { value: JobStatus.LEAD, label: "Lead" },
  { value: JobStatus.DOC_PREPPING, label: "Doc prepping" },
  { value: JobStatus.SENT_TO_ADJUSTER, label: "Sent to adjuster" },
  { value: JobStatus.FOLLOW_UP, label: "Follow up" },
  { value: JobStatus.PAPERWORK_RECEIVED, label: "Paperwork received" },
  { value: JobStatus.CHECK_RECEIVED, label: "Check received" },
  { value: JobStatus.COMPLETE, label: "Complete" }
];

// Category Types
export interface PhotoCategory {
  id: string;
  category_name: string;
  category_type: string;  // 'predefined' | 'custom'
  color_code: string;
  display_order: number;
  is_active: boolean;
  created_at?: string;
}

export interface CategoryCreate {
  category_name: string;
  category_type?: string;
  color_code?: string;
}

// Water Mitigation Job
export interface WaterMitigationJob {
  id: string;
  client_id?: string;
  claim_id?: string; // Linked claim ID
  company_id?: string; // Optional company assignment
  active: boolean;
  status: JobStatus;

  // Property & Homeowner Information
  property_address: string;
  property_street?: string;
  property_city?: string;
  property_state?: string;
  property_zipcode?: string;
  homeowner_name?: string;
  homeowner_phone?: string;
  homeowner_email?: string;

  // Insurance Information
  insurance_company?: string;
  insurance_policy_number?: string;
  claim_number?: string;
  date_of_loss?: string;

  // Mitigation Information
  mitigation_period?: string;
  mitigation_start_date?: string;
  mitigation_end_date?: string;
  mitigation_flag?: boolean;

  // Adjuster Information
  adjuster_name?: string;
  adjuster_phone?: string;
  adjuster_email?: string;
  adjuster_emails?: { name: string; email: string; role: string }[];

  // Inspection Information
  inspection_date?: string;
  inspection_time?: string;
  plumbers_report?: string;

  // Integration fields
  companycam_project_id?: string;
  google_sheet_row_number?: number;
  google_sheet_name?: string;
  companycam_last_sync?: string;
  sheets_last_sync?: string;

  // Financial/Documents Information
  // Documents sent to adjuster (Invoice + COS + EWA + Photo Report)
  documents_sent_date?: string;
  invoice_number?: string;
  invoice_amount?: number;
  check_number?: string;
  check_date?: string;
  check_amount?: number;
  payment_status?: string;
  payment_note?: string;
  notes?: string;

  // Metadata
  photo_count?: number;
  created_at?: string;
  updated_at?: string;
  created_by_id?: string;
  updated_by_id?: string;

  // Populated company data
  company?: {
    id: string;
    name: string;
    company_code?: string;
  };
}

// Request Types
export interface JobCreateRequest {
  client_id?: string;
  company_id?: string; // Optional company assignment
  active?: boolean;
  status?: JobStatus;

  // Property & Homeowner Information
  property_address: string;
  property_street?: string;
  property_city?: string;
  property_state?: string;
  property_zipcode?: string;
  homeowner_name?: string;
  homeowner_phone?: string;
  homeowner_email?: string;

  // Insurance Information
  insurance_company?: string;
  insurance_policy_number?: string;
  claim_number?: string;
  date_of_loss?: string | null;

  // Mitigation Information
  mitigation_period?: string;
  mitigation_start_date?: string | null;
  mitigation_end_date?: string | null;
  mitigation_flag?: boolean;

  // Adjuster Information
  adjuster_name?: string;
  adjuster_phone?: string;
  adjuster_email?: string;

  // Inspection Information
  inspection_date?: string | null;
  inspection_time?: string;
  plumbers_report?: string;

  // Financial/Documents Information
  documents_sent_date?: string | null;
  invoice_number?: string;
  invoice_amount?: number;
  check_number?: string;
  check_date?: string | null;
  check_amount?: number;
  payment_status?: string;
  payment_note?: string;

  // Integration fields
  companycam_project_id?: string;
  google_sheet_row_number?: number;
  google_sheet_name?: string;
}

// Alias for backward compatibility
export type JobCreate = JobCreateRequest;

export interface JobUpdate {
  company_id?: string; // Optional company assignment
  active?: boolean;
  status?: JobStatus;

  // Property & Homeowner Information
  property_address?: string;
  property_street?: string;
  property_city?: string;
  property_state?: string;
  property_zipcode?: string;
  homeowner_name?: string;
  homeowner_phone?: string;
  homeowner_email?: string;

  // Insurance Information
  insurance_company?: string;
  insurance_policy_number?: string;
  claim_number?: string;
  date_of_loss?: string | null;

  // Mitigation Information
  mitigation_period?: string;
  mitigation_start_date?: string | null;
  mitigation_end_date?: string | null;
  mitigation_flag?: boolean;

  // Adjuster Information
  adjuster_name?: string;
  adjuster_phone?: string;
  adjuster_email?: string;

  // Inspection Information
  inspection_date?: string | null;
  inspection_time?: string;
  plumbers_report?: string;

  // Financial/Documents Information
  documents_sent_date?: string | null;
  invoice_number?: string;
  invoice_amount?: number;
  check_number?: string;
  check_date?: string | null;
  check_amount?: number;
  payment_status?: string;
  payment_note?: string;

  // Integration fields
  companycam_project_id?: string;
  google_sheet_row_number?: number;
  google_sheet_name?: string;
}

export interface JobStatusUpdate {
  status: JobStatus;
  notes?: string;
}

// Response Types
export interface JobListResponse {
  items: WaterMitigationJob[];
  total: number;
  page: number;
  page_size: number;
  total_pages: number;
}

// Filter Types
export interface JobFilters {
  client_id?: string;
  search?: string;
  status?: JobStatus[];
  active?: boolean;
  page?: number;
  page_size?: number;
}

// Photo
export interface WMPhoto {
  id: string;
  job_id: string;
  source: string;  // 'companycam' | 'manual_upload' | 'magicplan'
  external_id?: string;

  // File information
  file_name: string;
  file_path: string;
  file_size?: number;
  mime_type?: string;
  file_type?: string;  // 'photo' | 'video'

  // Metadata
  title?: string;
  description?: string;
  captured_date?: string;
  category?: string;  // Empty string means uncategorized

  upload_status: string;
  uploaded_by_id?: string;

  created_at: string;
  updated_at: string;

  // Categories (if using many-to-many relationship)
  categories?: PhotoCategory[];

  // MagicPlan metadata (floor, room info)
  magicplan_metadata?: {
    floor_name?: string;
    floor_id?: string;
    floor_order?: number;
    room_name?: string;
    room_id?: string;
    plan_title?: string;
    notes?: string;
  };
}

// Status History
export interface JobStatusHistory {
  id: string;
  job_id: string;
  previous_status: string;
  new_status: string;
  changed_by_id?: string;
  notes?: string;
  changed_at: string;
}

// Report types
export interface PhotoMetadata {
  photo_id: string;
  caption?: string;
  show_date: boolean;
  show_description: boolean;
  location_override?: string;  // Report-only override of the photo's own location tag. Undefined = use the photo's own tag.
  show_location: boolean;      // Default true — per-photo toggle mirroring show_date
}

export interface ReportSection {
  id: string;
  title: string;
  summary?: string;
  photos: PhotoMetadata[];
  layout: 'single' | 'two' | 'three' | 'four' | 'six';
  display_order: number;
}

export interface ReportConfig {
  id?: string;
  job_id: string;
  cover_title: string;
  cover_description?: string;
  sections: ReportSection[];
  created_at?: string;
  updated_at?: string;
  created_by_id?: string;
}

export interface ReportConfigCreate {
  job_id: string;
  cover_title?: string;
  cover_description?: string;
  sections: ReportSection[];
}

export interface ReportConfigUpdate {
  cover_title?: string;
  cover_description?: string;
  sections?: ReportSection[];
}

export interface GenerateReportRequest {
  config_id?: string;
  save_config?: boolean;
  config?: ReportConfigCreate;
  compress?: boolean;  // Compress PDF (reduce image quality for smaller file size)
  report_date?: string;  // Custom report date (ISO format: YYYY-MM-DD)
  template_variant?: string;  // Template variant: 'a' (default), 'b' (formal), 'c' (modern)
  show_photo_dates?: boolean;  // Show the captured-date overlay on each photo
  show_photo_locations?: boolean;  // Show the level/room location tag in each photo's caption
  persist?: boolean;  // Upload PDF to storage + save as a Document. Default true; set false for preview-only calls.
}

export interface GenerateReportResponse {
  file_id: string;
  file_path: string;
  filename: string;
  download_url: string;
  config_id?: string;
}

export const LAYOUT_OPTIONS = [
  { value: 'single', label: '1 photo per page' },
  { value: 'two', label: '2 photos per page' },
  { value: 'three', label: '3 photos per page' },
  { value: 'four', label: '4 photos per page (2x2)' },
  { value: 'six', label: '6 photos per page (3x2)' }
] as const;

// CompanyCam Sync Result
export interface CompanyCamSyncResult {
  success: boolean;
  synced_count: number;
  skipped_existing: number;
  skipped_trashed: number;
  skipped_date_filtered?: number;
  total_companycam: number;
  errors: string[];
  message: string;
  cancelled?: boolean;
}

// MagicPlan Types
export interface MagicPlanProjectMatch {
  project_id: string;
  project_name: string;
  address?: string;
  match_score: number;
  match_type: string;
  photo_count?: number;
  plan_count?: number;
  created_at?: string;
}

export interface MagicPlanProjectSearchResponse {
  auto_match?: MagicPlanProjectMatch;
  candidates: MagicPlanProjectMatch[];
  total_projects: number;
}

export interface MagicPlanSyncResult {
  success: boolean;
  photos_synced: number;
  photos_skipped: number;
  floor_plans_synced: number;
  errors: string[];
  magicplan_project_id: string;
  magicplan_project_name: string;
}

export interface MagicPlanFloorPlanInfo {
  plan_id: string;
  plan_title?: string;
  floors: Array<{
    index: number;
    id: string;
    name: string;
    room_count: number;
    has_image: boolean;
    image_url?: string;
  }>;
  file_urls: Record<string, string>;
}

export interface MagicPlanFloorPlanImportResult {
  success: boolean;
  wm_floor_id?: string;
  floor_label?: string;
  image_url?: string;
  error_message?: string;
}

// Template Types
export enum TemplateType {
  STANDARD = 'standard',
  CUSTOM = 'custom'
}

export const TEMPLATE_TYPE_OPTIONS = [
  { value: TemplateType.STANDARD, label: 'Standard' },
  { value: TemplateType.CUSTOM, label: 'Custom' }
] as const;

export interface TemplateSection {
  id?: string;
  title: string;
  summary?: string;
  layout: 'single' | 'two' | 'three' | 'four' | 'six';
  photos_per_page?: number;
  display_order: number;
}

export interface ReportTemplate {
  id: string;
  name: string;
  description?: string;
  template_type: TemplateType;
  is_default: boolean;
  sections: TemplateSection[];
  created_at: string;
  updated_at: string;
  created_by_id?: string;
}

export interface TemplateCreate {
  name: string;
  description?: string;
  template_type?: TemplateType;
  is_default?: boolean;
  sections: TemplateSection[];
}

export interface TemplateUpdate {
  name?: string;
  description?: string;
  template_type?: TemplateType;
  is_default?: boolean;
  sections?: TemplateSection[];
}

export interface TemplateListResponse {
  items: ReportTemplate[];
  total: number;
}

// ============================================================================
// Scope of Work Types
// ============================================================================

// Scope item types
export enum ScopeItemType {
  STANDARD = 'standard',
  DEMOLITION = 'demolition',
  CUSTOM = 'custom'
}

export const SCOPE_ITEM_TYPE_OPTIONS = [
  { value: ScopeItemType.STANDARD, label: 'Standard' },
  { value: ScopeItemType.DEMOLITION, label: 'Demolition' },
  { value: ScopeItemType.CUSTOM, label: 'Custom' }
] as const;

// Unit types
export enum UnitType {
  SF = 'SF',
  LF = 'LF',
  EA = 'EA'
}

export const UNIT_TYPE_OPTIONS = [
  { value: UnitType.SF, label: 'SF (Square Feet)' },
  { value: UnitType.LF, label: 'LF (Linear Feet)' },
  { value: UnitType.EA, label: 'EA (Each)' }
] as const;

// Standard scope items
export const STANDARD_SCOPE_ITEMS = [
  { name: 'Floor Protection', unit: UnitType.SF, item_type: ScopeItemType.STANDARD },
  { name: 'Content Protection', unit: UnitType.SF, item_type: ScopeItemType.STANDARD },
  { name: 'Containment', unit: UnitType.SF, item_type: ScopeItemType.STANDARD },
  { name: 'Air Mover', unit: UnitType.EA, item_type: ScopeItemType.STANDARD },
  { name: 'Air Scrubber', unit: UnitType.EA, item_type: ScopeItemType.STANDARD },
  { name: 'Dehumidifier', unit: UnitType.EA, item_type: ScopeItemType.STANDARD }
] as const;

// Material weight brief (for scope item reference)
export interface MaterialWeightBrief {
  id: string;
  material_type: string;  // Maps to MaterialWeight.material_type
  dry_weight_per_unit: number;  // Maps to MaterialWeight.dry_weight_per_unit
  unit: string;
}

// Line item brief (for scope item reference)
export interface LineItemBrief {
  id: string;
  description: string;
  unit?: string;
  untaxed_unit_price?: number;
}

// Scope Location
export interface ScopeLocation {
  id: string;
  job_id: string;
  name: string;
  floor?: string;
  room_type?: string;
  description?: string;
  display_order: number;
  created_at: string;
  updated_at?: string;
  scope_items: ScopeItem[];
}

export interface ScopeLocationCreate {
  job_id: string;
  name: string;
  floor?: string;
  room_type?: string;
  description?: string;
  display_order?: number;
  /** Auto-add standard scope items when creating location (default: true) */
  auto_add_standard_items?: boolean;
}

export interface ScopeLocationUpdate {
  name?: string;
  floor?: string;
  room_type?: string;
  description?: string;
  display_order?: number;
}

export interface ScopeLocationListResponse {
  items: ScopeLocation[];
  total: number;
}

// Scope Item
export interface ScopeItem {
  id: string;
  location_id: string;
  item_type: ScopeItemType;
  name: string;
  description?: string;
  quantity?: number;
  quantity_formula?: string;
  unit: UnitType;
  material_weight_id?: string;
  material_weight?: MaterialWeightBrief;
  line_item_id?: string;
  line_item?: LineItemBrief;
  include_in_debris: boolean;
  invoiced?: boolean;
  invoiced_at?: string;
  display_order: number;
  created_at: string;
  updated_at?: string;
}

export interface ScopeItemCreate {
  location_id: string;
  item_type?: ScopeItemType;
  name: string;
  description?: string;
  quantity?: number;
  quantity_formula?: string;
  unit?: UnitType;
  material_weight_id?: string;
  line_item_id?: string;
  include_in_debris?: boolean;
  display_order?: number;
}

export interface ScopeItemUpdate {
  item_type?: ScopeItemType;
  name?: string;
  description?: string;
  quantity?: number;
  quantity_formula?: string;
  unit?: UnitType;
  material_weight_id?: string;
  line_item_id?: string;
  include_in_debris?: boolean;
  display_order?: number;
}

// Debris Calculation
export interface DebrisItemDetail {
  item_id: string;
  item_name: string;
  material_name?: string;
  quantity: number;
  unit: string;
  weight_per_unit: number;
  weight_lb: number;
  weight_ton: number;
}

export interface CategoryBreakdown {
  category_name: string;
  weight_lb: number;
  weight_ton: number;
  item_count: number;
}

export interface DumpsterRecommendation {
  size: string;
  capacity_tons: number;
  count: number;
  total_capacity_tons: number;
}

export interface WMDebrisCalculation {
  id: string;
  job_id: string;
  total_weight_lb: number;
  total_weight_ton: number;
  bag_count?: number; // Number of 42-gallon contractor bags needed
  category_breakdown: CategoryBreakdown[];
  dumpster_recommendation?: DumpsterRecommendation;
  item_details: DebrisItemDetail[];
  calculated_at: string;
  calculated_by_id?: string;
}

export interface CalculateDebrisRequest {
  save_result?: boolean;
}

export interface CalculateDebrisResponse {
  success: boolean;
  calculation?: WMDebrisCalculation;
  message: string;
  warnings: string[];
}

// Formula calculation
export interface CalculateFormulaRequest {
  formula: string;
}

export interface CalculateFormulaResponse {
  success: boolean;
  formula: string;
  result?: number;
  error?: string;
}

// ============================================================================
// Scope Item Categories (DB-managed categories for Standard Scope Items)
// ============================================================================

export interface ScopeItemCategory {
  id: string;
  company_id?: string | null;
  name: string;
  description?: string | null;
  color: string;
  icon?: string | null;
  display_order: number;
  is_active: boolean;
  created_at: string;
  updated_at?: string | null;
}

export interface ScopeItemCategoryBrief {
  id: string;
  name: string;
  color: string;
  display_order: number;
}

export interface ScopeItemCategoryCreate {
  name: string;
  description?: string;
  color?: string;
  icon?: string;
  display_order?: number;
  company_id?: string;
}

export interface ScopeItemCategoryUpdate {
  name?: string;
  description?: string;
  color?: string;
  icon?: string;
  display_order?: number;
  is_active?: boolean;
}

export interface ScopeItemCategoryListResponse {
  items: ScopeItemCategory[];
  total: number;
  page: number;
  page_size: number;
}

export interface ScopeItemCategoryFilters {
  company_id?: string;
  is_active?: boolean;
  search?: string;
  include_system?: boolean;
  page?: number;
  page_size?: number;
}

// ============================================================================
// Standard Scope Items (Template Items for Scope of Work)
// ============================================================================

export interface StandardScopeItem {
  id: string;
  company_id?: string | null;
  item_type: 'standard' | 'demolition' | 'custom';
  category_id?: string | null;
  category?: ScopeItemCategoryBrief | null;  // Nested category info
  name: string;
  description?: string | null;
  unit: string;
  default_quantity?: number | null;
  material_weight_id?: string | null;
  default_include_in_debris: boolean;
  display_order: number;
  is_active: boolean;
  created_by_id?: string | null;
  updated_by_id?: string | null;
  created_at: string;
  updated_at?: string | null;
  material_weight?: {
    id: string;
    material_type: string;
    dry_weight_per_unit: number;
    unit: string;
  } | null;
  // Line item mapping fields
  line_item_id?: string | null;
  line_item?: LineItemBrief | null;
  custom_line_item_name?: string | null;
  custom_line_item_rate?: number | null;
  quantity_calc_type?: 'manual' | 'area' | 'perimeter' | 'count' | null;
  max_days?: number | null;
  default_invoice_note?: string | null;
}

export interface StandardScopeItemCreate {
  name: string;
  description?: string;
  item_type?: 'standard' | 'demolition' | 'custom';
  category_id?: string;
  unit?: string;
  default_quantity?: number;
  material_weight_id?: string;
  default_include_in_debris?: boolean;
  display_order?: number;
  company_id?: string;
  // Line item mapping fields
  line_item_id?: string;
  custom_line_item_name?: string;
  custom_line_item_rate?: number;
  quantity_calc_type?: 'manual' | 'area' | 'perimeter' | 'count';
  max_days?: number;
  default_invoice_note?: string;
}

export interface StandardScopeItemUpdate {
  name?: string;
  description?: string;
  item_type?: 'standard' | 'demolition' | 'custom';
  category_id?: string;
  unit?: string;
  default_quantity?: number;
  material_weight_id?: string;
  default_include_in_debris?: boolean;
  display_order?: number;
  is_active?: boolean;
  // Line item mapping fields
  line_item_id?: string | null;
  custom_line_item_name?: string | null;
  custom_line_item_rate?: number | null;
  quantity_calc_type?: 'manual' | 'area' | 'perimeter' | 'count' | null;
  max_days?: number | null;
  default_invoice_note?: string | null;
}

export interface StandardScopeItemListResponse {
  items: StandardScopeItem[];
  total: number;
  page: number;
  page_size: number;
}

export interface StandardScopeItemFilters {
  company_id?: string;
  item_type?: string;
  category_id?: string;
  is_active?: boolean;
  search?: string;
  include_system?: boolean;
  page?: number;
  page_size?: number;
}

// Material Weight types (from reconstruction_estimate module)
export interface MaterialCategory {
  id: string;
  category_name: string;
  description?: string | null;
  display_order: number;
  active: boolean;
}

export interface MaterialWeight {
  id: string;
  material_type: string;
  category_id: string;
  category_name?: string | null;
  description?: string | null;
  dry_weight_per_unit: number;
  unit: string;  // SF, LF, EA
  damp_multiplier: number;
  wet_multiplier: number;
  saturated_multiplier: number;
  active: boolean;
}

export interface MaterialWeightListResponse {
  materials: MaterialWeight[];
  total: number;
}

// ============================================================================
// Scope Invoice Types
// ============================================================================

export interface GenerateInvoiceRequest {
  job_id: string;
  template_id: string;
  billing_company_id?: string;
  invoice_date?: string;
  scope_item_ids?: string[];
  notes?: string;
  holiday_premium?: boolean;
}

export interface GenerateInvoiceResponse {
  success: boolean;
  message: string;
  invoice_id?: string;
  invoice_number?: string;
  scope_invoice_id?: string;
  items_invoiced: number;
  total_amount?: number;
  warnings: string[];
}

export interface ScopeItemInvoiceLinkResponse {
  id: string;
  scope_item_id: string;
  invoice_item_id: string;
  scope_item_name?: string;
  invoice_item_description?: string;
}

export interface WMScopeInvoiceResponse {
  id: string;
  job_id: string;
  invoice_id: string;
  invoice_number?: string;
  invoice_total?: number;
  generated_at: string;
  generated_by_id?: string;
  notes?: string;
  item_links: ScopeItemInvoiceLinkResponse[];
  created_at?: string;
}

export interface JobInvoiceHistoryResponse {
  invoices: WMScopeInvoiceResponse[];
  total_invoiced: number;
  invoice_count: number;
}

export interface ScopeItemInvoiceStatusResponse {
  scope_item_id: string;
  scope_item_name: string;
  invoiced: boolean;
  invoiced_at?: string;
  invoice_item_id?: string;
  invoice_id?: string;
  invoice_number?: string;
}

// ============================================================================
// Invoice Item Configuration Types
// ============================================================================

// Quantity calculation types for invoice items
export enum QuantityCalcType {
  FIXED = 'fixed',         // Use scope item quantity as-is
  PER_DAY = 'per_day',     // Multiply by mitigation period days
  PER_DAY_CAPPED = 'per_day_capped'  // Per day with max days limit
}

export const QUANTITY_CALC_TYPE_OPTIONS = [
  {
    value: QuantityCalcType.FIXED,
    label: 'Fixed',
    description: 'Use scope item quantity as-is'
  },
  {
    value: QuantityCalcType.PER_DAY,
    label: 'Per Day',
    description: 'Multiply quantity by mitigation days'
  },
  {
    value: QuantityCalcType.PER_DAY_CAPPED,
    label: 'Per Day (Capped)',
    description: 'Per day with maximum days limit'
  }
] as const;

// Invoice Item Configuration
export interface InvoiceItemConfig {
  id: string;
  job_id: string;
  scope_item_id?: string;
  standard_scope_item_id?: string;
  line_item_id?: string;

  // Custom line item fields (when not using existing line item)
  custom_name?: string;
  custom_description?: string;
  custom_rate?: number;
  custom_unit?: string;

  // Quantity calculation
  quantity_calc_type: QuantityCalcType | string;
  max_days?: number;  // For per_day_capped

  // Default note for this line item
  default_note?: string;

  // Status
  is_enabled: boolean;
  display_order: number;

  // Populated data from relationships
  scope_item_name?: string;
  scope_item_quantity?: number;
  scope_item_unit?: string;
  location_name?: string;
  line_item_description?: string;
  line_item_rate?: number;

  // Calculated values (when include_calculated=true)
  calculated_quantity?: number;
  calculation_note?: string;  // e.g., "3 x 5 days = 15"
  effective_rate?: number;
  calculated_amount?: number;

  created_at?: string;
  updated_at?: string;
}

export interface InvoiceItemConfigCreate {
  job_id: string;
  scope_item_id?: string;
  line_item_id?: string;
  custom_name?: string;
  custom_description?: string;
  custom_rate?: number;
  custom_unit?: string;
  quantity_calc_type?: string;
  max_days?: number;
  default_note?: string;
  is_enabled?: boolean;
  display_order?: number;
}

export interface InvoiceItemConfigUpdate {
  scope_item_id?: string;
  line_item_id?: string | null;  // null to explicitly clear FK reference
  custom_name?: string | null;
  custom_description?: string | null;
  custom_rate?: number | null;
  custom_unit?: string | null;
  quantity_calc_type?: string;
  max_days?: number;
  default_note?: string;
  is_enabled?: boolean;
  display_order?: number;
}

export interface InvoiceItemConfigListResponse {
  items: InvoiceItemConfig[];
  total: number;
}

// Invoice Preview Types
export interface InvoicePreviewItem {
  scope_item_name: string;
  location_name: string;
  line_item_description: string;
  base_quantity: number;
  calculated_quantity: number;
  calculation_note: string;
  unit: string;
  rate: number;
  amount: number;
  default_note?: string;
}

export interface InvoicePreviewResponse {
  items: InvoicePreviewItem[];
  subtotal: number;
  total: number;
  mitigation_days: number;
  mitigation_start?: string;
  mitigation_end?: string;
  unmapped_items: string[];
}

// Auto-generate config result
export interface AutoGenerateConfigResult {
  success: boolean;
  created_count: number;
  matched_count: number;
  unmatched_items: string[];
  general_conditions_created?: number;
  general_conditions_calculated?: number;
}

// ============================================================================
// Standard Scope Item Mapping Types (New Invoice Configuration Approach)
// ============================================================================

/**
 * Standard scope item with its invoice line item mapping.
 * This is used for the new invoice configuration approach where
 * mappings are configured once at the standard item level.
 */
export interface StandardItemMapping {
  id: string;
  name: string;
  item_type: string;
  unit: string;
  category_id?: string | null;
  category_name?: string | null;
  company_id?: string | null;

  // Invoice mapping fields
  line_item_id?: string | null;
  line_item_description?: string | null;
  line_item_rate?: number | null;
  custom_line_item_name?: string | null;
  custom_line_item_rate?: number | null;
  quantity_calc_type: string;
  max_days?: number | null;
  default_invoice_note?: string | null;

  // Computed field
  has_mapping: boolean;
}

export interface StandardItemMappingListResponse {
  items: StandardItemMapping[];
  total: number;
  mapped_count: number;
  unmapped_count: number;
}

export interface StandardItemMappingUpdate {
  line_item_id?: string | null;
  custom_line_item_name?: string | null;
  custom_line_item_rate?: number | null;
  quantity_calc_type?: string;
  max_days?: number | null;
  default_invoice_note?: string | null;
}

export interface StandardItemMappingUpdateResult {
  id: string;
  name: string;
  line_item_id?: string | null;
  custom_line_item_name?: string | null;
  custom_line_item_rate?: number | null;
  quantity_calc_type: string;
  max_days?: number | null;
  default_invoice_note?: string | null;
  updated: boolean;
}

/**
 * Invoice preview item using standard scope item mappings.
 * Aggregates quantities per item type across all locations.
 */
export interface StandardMappingPreviewItem {
  scope_item_name: string;
  location_names: string[];
  line_item_description: string;
  base_quantity: number;
  calculated_quantity: number;
  calculation_note: string;
  unit: string;
  rate: number;
  amount: number;
  default_note?: string | null;
  has_mapping: boolean;
  standard_item_id?: string | null;
}

export interface StandardItemMappingPreviewResponse {
  items: StandardMappingPreviewItem[];
  subtotal: number;
  total: number;
  mitigation_days: number;
  mitigation_start?: string | null;
  mitigation_end?: string | null;
  unmapped_items: string[];
  mapped_count: number;
  total_count: number;
}
