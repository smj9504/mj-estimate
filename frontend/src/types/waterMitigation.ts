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
}

// Request Types
export interface JobCreateRequest {
  client_id?: string;
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
