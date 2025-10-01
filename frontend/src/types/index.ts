// Company Types
export interface Company {
  id: string;
  name: string;
  address: string;
  city: string;
  state: string;
  zipcode?: string;
  phone?: string;
  email?: string;
  logo?: string; // Base64 encoded logo or URL
  company_code?: string; // 4-character unique code
  is_active?: boolean; // ✅ Added missing field
  is_default?: boolean; // ✅ Added missing field
  payment_method?: string; // Legacy field
  payment_frequency?: string; // Legacy field
  payment_method_id?: string; // Reference to payment_methods table
  payment_frequency_id?: string; // Reference to payment_frequencies table
  payment_method_details?: PaymentMethod; // Populated when fetching single company
  payment_frequency_details?: PaymentFrequency; // Populated when fetching single company
  created_at?: string;
  updated_at?: string;
}

export interface CompanyFormData {
  name: string;
  address: string;
  city: string;
  state: string;
  zipcode?: string;
  phone?: string;
  email?: string;
  logo?: string;
  company_code?: string;
  payment_method?: string; // Legacy field
  payment_frequency?: string; // Legacy field
  payment_method_id?: string;
  payment_frequency_id?: string;
}

export interface CompanyFilter {
  search?: string;
  city?: string;
  state?: string;
}

// Document Types
export type DocumentType = 'estimate' | 'invoice' | 'insurance_estimate' | 'plumber_report' | 'work_order';
// Invoice statuses
export type InvoiceStatus = 'pending' | 'paid' | 'overdue' | 'cancelled';

// Estimate statuses
export type EstimateStatus = 'draft' | 'sent' | 'accepted' | 'rejected' | 'expired';

// Combined document status for backward compatibility
export type DocumentStatus = InvoiceStatus | EstimateStatus;

// Estimate Type ENUM
export enum EstimateType {
  STANDARD = 'standard',
  INSURANCE = 'insurance'
}

export const EstimateTypeLabels = {
  [EstimateType.STANDARD]: 'General Estimate',
  [EstimateType.INSURANCE]: 'Insurance Estimate'
} as const;

export interface Document {
  id: string;
  type: DocumentType;
  document_number: string;
  company_id: string;
  client_name: string;
  client_email?: string;
  client_phone?: string;
  client_address?: string;
  client_city?: string;
  status: DocumentStatus;
  total_amount: number;
  created_at: string;
  updated_at: string;
  items?: DocumentItem[];
}

export interface DocumentItem {
  id: string;
  document_id: string;
  description: string;
  quantity: number;
  unit_price: number;
  total: number;
  unit?: string;
  order?: number;
}

// Filter Types
export interface DocumentFilter {
  type?: DocumentType;
  status?: DocumentStatus;
  company_id?: string;
  date_from?: string;
  date_to?: string;
  search?: string;
  estimate_type?: EstimateType;
}

// Room and Floor Plan Types (for insurance estimates)
export interface Room {
  id: string;
  name: string;
  width: number;
  length: number;
  height: number;
  area: number;
  items?: RoomItem[];
}

export interface RoomItem {
  description: string;
  quantity: number;
  unit: string;
  rate: number;
  amount: number;
}

// Work Order Types
export interface WorkOrder {
  id: string;
  work_order_number: string;
  company_id: string;
  document_type: DocumentType;
  document_type_name?: string;  // Added to display the actual name from database
  client_name: string;
  client_phone?: string;
  client_email?: string;
  client_address?: string;
  client_city?: string;
  client_state?: string;
  client_zipcode?: string;
  // Insurance Information
  insurance_claim_number?: string;
  insurance_policy_number?: string;
  insurance_company?: string;
  insurance_deductible?: string;
  insurance_adjuster_name?: string;
  insurance_adjuster_email?: string;
  insurance_adjuster_phone?: string;
  insurance_date_of_loss?: string;
  // Work Order Details
  trades: string[];
  work_description?: string;
  scope_of_work?: string;
  special_instructions?: string;
  consultation_notes?: string;
  base_fee: number;
  credits_applied: number;
  final_cost: number;
  cost_override?: number;
  additional_costs?: any[];
  apply_tax?: boolean;
  tax_amount?: number;
  tax_rate?: number;
  status: 'draft' | 'pending' | 'approved' | 'in_progress' | 'completed' | 'cancelled';
  created_by_staff_id?: string;
  created_by_staff_name?: string;
  assigned_to_staff_id?: string;
  assigned_to_staff_name?: string;
  created_at: string;
  updated_at: string;
  company?: Company;
}

export interface WorkOrderFormData {
  company_id: string;
  document_type: DocumentType;
  client_name: string;
  client_phone?: string;
  client_email?: string;
  client_address?: string;
  client_city?: string;
  client_state?: string;
  client_zipcode?: string;
  // Insurance Information
  insurance_claim_number?: string;
  insurance_policy_number?: string;
  insurance_company?: string;
  insurance_deductible?: string;
  insurance_adjuster_name?: string;
  insurance_adjuster_email?: string;
  insurance_adjuster_phone?: string;
  insurance_date_of_loss?: string;
  // Work Order Details
  trades: string[];
  work_description?: string;
  scope_of_work?: string;
  special_instructions?: string;
  consultation_notes?: string;
  cost_override?: number;
  additional_costs?: any[];
  apply_tax?: boolean;
  tax_rate?: number;
}

export interface Trade {
  id: string;
  name: string;
  base_fee: number;
  description?: string;
}

export interface Credit {
  id: string;
  company_id: string;
  amount: number;
  description: string;
  expiry_date?: string;
  is_active: boolean;
  created_at: string;
}

export interface CostBreakdown {
  baseFee: number;
  creditsApplied: number;
  finalCost: number;
  availableCredits: number;
}

// Additional Cost Types
export interface AdditionalCostTemplate {
  id: string;
  name: string;
  category: string;
  cost_type: 'fixed' | 'variable';
  fixed_amount?: number;
  description?: string;
  is_active: boolean;
  display_order: number;
}

export interface AdditionalCostItem {
  id: string;
  template_id?: string; // null for custom items
  name: string;
  category: string;
  amount: number;
  description?: string;
  is_custom: boolean;
}

// API Response Types
export interface ApiResponse<T> {
  data?: T;
  error?: string;
  message?: string;
}

export interface PaginatedResponse<T> {
  items: T[];  // Changed from 'data' to match backend
  total: number;
  page: number;
  page_size: number;  // Changed from 'pageSize' to match backend
  total_pages: number;  // Added to match backend
}

// Payment Configuration Types
export interface PaymentMethod {
  id: string;
  code: string;
  name: string;
  description?: string;
  requires_account_info: boolean;
  is_active: boolean;
  is_default: boolean;
  created_at?: string;
  updated_at?: string;
}

export interface PaymentFrequency {
  id: string;
  code: string;
  name: string;
  description?: string;
  days_interval?: number;
  is_active: boolean;
  is_default: boolean;
  created_at?: string;
  updated_at?: string;
}

// Calculator Component Types
export interface CalculatorProps {
  /** Initial value or formula */
  initialValue?: string | number;
  /** Placeholder text for the input field */
  placeholder?: string;
  /** Number of decimal places to display in result */
  decimalPlaces?: number;
  /** Unit to display after the result */
  unit?: string;
  /** Callback when the calculated result changes */
  onChange?: (result: number, formula: string) => void;
  /** Callback when the formula string changes */
  onFormulaChange?: (formula: string) => void;
  /** Callback when an error occurs */
  onError?: (error: string | null) => void;
  /** Whether the calculator is disabled */
  disabled?: boolean;
  /** Custom style for the container */
  style?: React.CSSProperties;
  /** Custom class name */
  className?: string;
  /** Size of the input */
  size?: 'small' | 'middle' | 'large';
  /** Show calculator icon */
  showIcon?: boolean;
  /** Allow empty value (doesn't evaluate to 0) */
  allowEmpty?: boolean;
  /** Minimum value allowed */
  min?: number;
  /** Maximum value allowed */
  max?: number;
}

export interface CalculatorResult {
  value: number;
  formula: string;
  isValid: boolean;
  error: string | null;
}

// Work Order File Management Types
export interface WorkOrderFile {
  id: string;
  work_order_id: string;
  original_name: string;
  file_name: string;
  file_size: number;
  file_type: string;
  mime_type: string;
  file_url: string;
  thumbnail_url?: string;
  category_id?: string;
  category_name?: string;
  description?: string;
  uploaded_at: string;
  uploaded_by: string;
  metadata?: Record<string, any>;
}

export interface FileCategory {
  id: string;
  name: string;
  color?: string;
  description?: string;
  work_order_id: string;
  file_count: number;
  created_at: string;
  updated_at: string;
}

export interface FileUploadProgress {
  file: File;
  progress: number;
  status: 'pending' | 'uploading' | 'success' | 'error';
  error?: string;
  uploadedFile?: WorkOrderFile;
}

export interface FileUploadResult {
  success: boolean;
  file?: WorkOrderFile;
  error?: string;
}

export type ViewMode = 'grid' | 'list' | 'card';

export interface FileGridProps {
  files: WorkOrderFile[];
  categories: FileCategory[];
  selectedFiles: string[];
  viewMode: ViewMode;
  onFileSelect: (fileId: string, selected: boolean) => void;
  onFileMove: (fileId: string, categoryId: string | null) => void;
  onFileDelete: (fileId: string) => void;
  onFilePreview: (file: WorkOrderFile) => void;
  onCategoryCreate: (name: string) => void;
  onCategoryUpdate: (categoryId: string, updates: Partial<FileCategory>) => void;
  onCategoryDelete: (categoryId: string) => void;
}

export interface FileUploadZoneProps {
  workOrderId: string;
  categories: FileCategory[];
  onUploadComplete: (files: WorkOrderFile[]) => void;
  onUploadProgress: (progress: FileUploadProgress[]) => void;
  accept?: string;
  maxFileSize?: number;
  maxFiles?: number;
  disabled?: boolean;
}

export interface FileManagerState {
  files: WorkOrderFile[];
  categories: FileCategory[];
  selectedFiles: string[];
  viewMode: ViewMode;
  loading: boolean;
  uploading: boolean;
  uploadProgress: FileUploadProgress[];
  searchQuery: string;
  selectedCategory: string | null;
}