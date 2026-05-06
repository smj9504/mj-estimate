/**
 * Client, Claim, and ClaimNegotiation types
 */

export interface OwnerInfo {
  name: string;
  phone?: string;
  email?: string;
  is_primary: boolean;
}

// ============================================================
// Negotiation Section (from PDF extraction)
// ============================================================

export interface NegotiationSection {
  section_name: string;
  line_item_total?: number;
  material_sales_tax?: number;
  subtotal?: number;
  overhead_amount?: number;
  profit_amount?: number;
  rcv?: number;
  depreciation?: number;
  deductible?: number;
  net_acv?: number;
  recoverable_depreciation?: number;
  non_recoverable_depreciation?: number;
  total_if_incurred?: number;
}

export interface PdfExtractionResult {
  sections: NegotiationSection[];
  totals: {
    acv_amount: number;
    rcv_amount: number;
    depreciation_amount: number;
    deductible: number;
  };
  validation: {
    is_valid: boolean;
    warnings: string[];
  };
  file_id: string;
  file_name: string;
}

// ============================================================
// ClaimNegotiation
// ============================================================

export interface ClaimNegotiation {
  id: string;
  claim_id: string;
  revision_number: number;
  revision_type: 'initial' | 'supplement' | 're_inspection' | 'appraisal' | 'final';
  acv_amount: number;
  rcv_amount: number;
  depreciation_amount: number;
  deductible: number;
  date_received?: string;
  received_from?: string;
  notes?: string;
  document_url?: string;
  document_name?: string;
  sections_data?: NegotiationSection[];
  extraction_status?: string;
  created_at?: string;
  updated_at?: string;
}

export interface ClaimNegotiationCreate {
  claim_id: string;
  revision_type: ClaimNegotiation['revision_type'];
  acv_amount?: number;
  rcv_amount?: number;
  depreciation_amount?: number;
  deductible?: number;
  date_received?: string;
  received_from?: string;
  notes?: string;
  document_url?: string;
  document_name?: string;
  sections_data?: NegotiationSection[];
  file_id?: string;
}

// ============================================================
// Claim
// ============================================================

export type ClaimStatus = 'open' | 'negotiating' | 'settled' | 'closed' | 'denied';

export interface Claim {
  id: string;
  client_id: string;
  company_id?: string;
  claim_number: string;
  insurance_company?: string;
  insurance_policy_number?: string;
  insurance_deductible?: number;
  adjuster_name?: string;
  adjuster_phone?: string;
  adjuster_email?: string;
  date_of_loss?: string;
  loss_description?: string;
  current_acv: number;
  current_rcv: number;
  current_depreciation: number;
  our_estimate_amount: number;
  final_invoice_amount: number;
  total_insurance_paid: number;
  payment_status: string;
  insurance_estimate_received: boolean;
  insurance_estimate_received_date?: string;
  insurance_estimate_file_id?: string;
  insurance_estimate_file_name?: string;
  has_public_adjuster: boolean;
  pa_fee_percentage: number;
  pa_name?: string;
  pa_company?: string;
  pa_email?: string;
  pa_phone?: string;
  needs_supplement: boolean;
  supplement_status?: string;
  supplement_notes?: string;
  status: ClaimStatus;
  notes?: string;
  negotiations: ClaimNegotiation[];
  payments: ClaimPayment[];
  expenses: ClaimExpense[];
  invoice_count: number;
  estimate_count: number;
  wm_job_count: number;
  work_order_count: number;
  cabinet_estimate_count: number;
  plumber_report_id?: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface ClaimPayment {
  id: string;
  claim_id: string;
  payment_type: string;
  amount: number;
  check_number?: string;
  check_date?: string;
  received_date?: string;
  paid_by?: string;
  description?: string;
  status: string;
  notes?: string;
  created_at?: string;
}

export interface ClaimPaymentCreate {
  claim_id: string;
  payment_type: string;
  amount: number;
  check_number?: string;
  check_date?: string;
  received_date?: string;
  paid_by?: string;
  description?: string;
  notes?: string;
}

export interface PaymentSummary {
  total_invoice_amount: number;
  total_insurance_paid: number;
  payment_difference: number;
  deductible: number;
  net_expected: number;
  payment_status: string;
  insurance_estimate_received: boolean;
  needs_supplement: boolean;
  payments: ClaimPayment[];
}

export interface ClaimExpense {
  id: string;
  claim_id: string;
  category: string;
  description: string;
  amount: number;
  quantity?: number;
  unit_cost?: number;
  vendor_name?: string;
  receipt_file_id?: string;
  receipt_file_name?: string;
  expense_date?: string;
  notes?: string;
  created_at?: string;
}

export interface ClaimExpenseCreate {
  claim_id: string;
  category: string;
  description: string;
  amount: number;
  quantity?: number;
  unit_cost?: number;
  vendor_name?: string;
  expense_date?: string;
  notes?: string;
}

export interface ProfitabilitySummary {
  total_insurance_paid: number;
  pa_fee_percentage: number;
  pa_fee_amount: number;
  total_material: number;
  total_labor: number;
  total_subcontractor: number;
  total_equipment: number;
  total_other_expenses: number;
  total_expenses: number;
  gross_profit: number;
  gross_margin_pct: number;
  net_profit: number;
  net_margin_pct: number;
  expenses: ClaimExpense[];
}

export const EXPENSE_CATEGORY_LABELS: Record<string, string> = {
  material: 'Material',
  labor: 'Labor',
  subcontractor: 'Subcontractor',
  equipment: 'Equipment',
  permit: 'Permit',
  overhead: 'Overhead',
  other: 'Other',
};

export interface ClaimCreate {
  client_id: string;
  claim_number: string;
  company_id?: string;
  insurance_company?: string;
  insurance_policy_number?: string;
  insurance_deductible?: number;
  adjuster_name?: string;
  adjuster_phone?: string;
  adjuster_email?: string;
  date_of_loss?: string;
  loss_description?: string;
  status?: ClaimStatus;
  notes?: string;
  initial_acv?: number;
  initial_rcv?: number;
}

// ============================================================
// Client
// ============================================================

export interface CabinetEstimateSummary {
  id: string;
  claim_id?: string | null;
  status: string;
  property_address?: string;
  tier?: string;
  total?: number;
  created_at?: string;
}

export interface PlumberReportSummary {
  id: string;
  report_number?: string;
  status?: string;
  service_date?: string;
  technician_name?: string;
  total_amount?: number;
  created_at?: string;
}

export interface Client {
  id: string;
  display_name: string;
  owners: OwnerInfo[];
  address?: string;
  city?: string;
  state?: string;
  zipcode?: string;
  phone?: string;
  email?: string;
  insurance_company?: string;
  insurance_policy_number?: string;
  company_id?: string;
  notes?: string;
  is_active: boolean;
  claims: Claim[];
  claim_count: number;
  standalone_invoice_count: number;
  standalone_estimate_count: number;
  standalone_wm_job_count: number;
  standalone_work_order_count: number;
  cabinet_estimates: CabinetEstimateSummary[];
  plumber_reports: PlumberReportSummary[];
  created_at?: string;
  updated_at?: string;
}

export interface ClientCreate {
  display_name: string;
  owners: OwnerInfo[];
  address?: string;
  city?: string;
  state?: string;
  zipcode?: string;
  phone?: string;
  email?: string;
  insurance_company?: string;
  insurance_policy_number?: string;
  company_id?: string;
  notes?: string;
}

export interface ClientListItem {
  id: string;
  display_name: string;
  owners: OwnerInfo[];
  address?: string;
  city?: string;
  state?: string;
  zipcode?: string;
  phone?: string;
  email?: string;
  insurance_company?: string;
  is_active: boolean;
  claim_count: number;
  created_at?: string;
}
