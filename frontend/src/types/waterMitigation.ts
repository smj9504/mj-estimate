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
  company_id?: string; // Optional company assignment
  active: boolean;
  status: JobStatus;

  // Property & Homeowner Information
  property_address: string;
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

  // Inspection Information
  inspection_date?: string;
  inspection_time?: string;
  plumbers_report?: string;

  // Integration fields
  companycam_project_id?: string;
  google_sheet_row_number?: number;
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

  // Integration fields
  companycam_project_id?: string;
  google_sheet_row_number?: number;
}

// Alias for backward compatibility
export type JobCreate = JobCreateRequest;

export interface JobUpdate {
  company_id?: string; // Optional company assignment
  active?: boolean;
  status?: JobStatus;

  // Property & Homeowner Information
  property_address?: string;
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

  // Integration fields
  companycam_project_id?: string;
  google_sheet_row_number?: number;
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
  source: string;  // 'companycam' | 'manual_upload'
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
  total_companycam: number;
  errors: string[];
  message: string;
  cancelled?: boolean;
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

// Moisture levels for debris calculation
export enum MoistureLevel {
  DRY = 'dry',
  DAMP = 'damp',
  WET = 'wet',
  SATURATED = 'saturated'
}

export const MOISTURE_LEVEL_OPTIONS = [
  { value: MoistureLevel.DRY, label: 'Dry', multiplier: 1.0 },
  { value: MoistureLevel.DAMP, label: 'Damp', multiplier: 1.2 },
  { value: MoistureLevel.WET, label: 'Wet', multiplier: 1.5 },
  { value: MoistureLevel.SATURATED, label: 'Saturated', multiplier: 2.0 }
] as const;

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

// Material weight brief (for demolition type reference)
export interface MaterialWeightBrief {
  id: string;
  material_type: string;
  category_name?: string;
  dry_weight_per_unit: number;
  unit: string;
}

// Demolition Type
export interface DemolitionType {
  id: string;
  name: string;
  category?: string;
  description?: string;
  default_unit: UnitType;
  material_weight_id?: string;
  material_weight?: MaterialWeightBrief;
  display_order: number;
  is_active: boolean;
  created_at: string;
  updated_at?: string;
  created_by_id?: string;
  updated_by_id?: string;
}

export interface DemolitionTypeCreate {
  name: string;
  category?: string;
  description?: string;
  default_unit?: UnitType;
  material_weight_id?: string;
  display_order?: number;
  is_active?: boolean;
}

export interface DemolitionTypeUpdate {
  name?: string;
  category?: string;
  description?: string;
  default_unit?: UnitType;
  material_weight_id?: string;
  display_order?: number;
  is_active?: boolean;
}

export interface DemolitionTypeListResponse {
  items: DemolitionType[];
  total: number;
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

// Demolition type brief for scope items
export interface DemolitionTypeBrief {
  id: string;
  name: string;
  category?: string;
  default_unit: string;
  material_weight_id?: string;
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
  demolition_type_id?: string;
  demolition_type?: DemolitionTypeBrief;
  include_in_debris: boolean;
  moisture_level: MoistureLevel;
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
  demolition_type_id?: string;
  include_in_debris?: boolean;
  moisture_level?: MoistureLevel;
  display_order?: number;
}

export interface ScopeItemUpdate {
  item_type?: ScopeItemType;
  name?: string;
  description?: string;
  quantity?: number;
  quantity_formula?: string;
  unit?: UnitType;
  demolition_type_id?: string;
  include_in_debris?: boolean;
  moisture_level?: MoistureLevel;
  display_order?: number;
}

// Debris Calculation
export interface DebrisItemDetail {
  item_id: string;
  item_name: string;
  demolition_type_name?: string;
  material_type?: string;
  quantity: number;
  unit: string;
  moisture_level: string;
  dry_weight_per_unit?: number;
  moisture_multiplier: number;
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
