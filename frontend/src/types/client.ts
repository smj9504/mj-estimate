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
  estimate_category?: EstimateCategory | null;
  acv_amount: number;
  rcv_amount: number;
  depreciation_amount: number;
  deductible: number;
  date_received?: string;
  received_from?: string;
  notes?: string;
  document_url?: string;
  document_name?: string;
  file_download_id?: string;
  sections_data?: NegotiationSection[];
  extraction_status?: string;
  created_at?: string;
  updated_at?: string;
}

/**
 * Which part of the loss an insurance estimate covers. Revision numbering is
 * scoped per category, so a WM revision and a reconstruction revision are
 * numbered independently.
 */
export type EstimateCategory =
  | 'reconstruction'
  | 'water_mitigation'
  | 'combined';

export const ESTIMATE_CATEGORY_CONFIG: Record<
  EstimateCategory,
  { color: string; label: string }
> = {
  combined: { color: 'blue', label: 'Combined' },
  reconstruction: { color: 'purple', label: 'Reconstruction' },
  water_mitigation: { color: 'cyan', label: 'Water Mitigation' },
};

export interface ClaimNegotiationCreate {
  claim_id: string;
  revision_type: ClaimNegotiation['revision_type'];
  estimate_category?: EstimateCategory | null;
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

/**
 * 'appraisal': the claim left negotiation for appraisal (possibly after
 * supplements). It is settled outside the supplement process, so no
 * supplement estimate goes out.
 */
export type ClaimStatus = 'open' | 'negotiating' | 'appraisal' | 'settled' | 'closed' | 'denied';

/**
 * Who produced the initial estimate. Most carriers write their own, but some
 * decline and ask the contractor to submit one for approval instead, which
 * inverts the usual negotiation flow.
 */
export type EstimateOrigin = 'carrier_provided' | 'contractor_prepared';

export const ESTIMATE_ORIGIN_CONFIG: Record<
  EstimateOrigin,
  { color: string; label: string; description: string }
> = {
  carrier_provided: {
    color: 'blue',
    label: 'Carrier Estimate',
    description: 'Insurance company provided the initial estimate',
  },
  contractor_prepared: {
    color: 'purple',
    label: 'Contractor-Prepared',
    description: 'Carrier asked us for the estimate; a company other than the WM one writes it for approval',
  },
};

/**
 * How the claim's water mitigation gets paid. We send our WM invoice first;
 * the carrier either pays it as billed (no WM estimate of its own) or answers
 * with a WM estimate, separate or inside the rebuild estimate.
 */
export type WMCostStatus =
  | 'paid_per_invoice'
  | 'included_in_rebuild'
  | 'separate_estimate'
  | 'not_received'
  | 'not_applicable';

export const WM_COST_STATUS_OPTIONS: { value: WMCostStatus; label: string }[] = [
  { value: 'paid_per_invoice', label: 'Paid per Our Invoice (No WM Estimate)' },
  { value: 'included_in_rebuild', label: 'Included in Rebuild Estimate' },
  { value: 'separate_estimate', label: 'Received as Separate WM Estimate' },
  { value: 'not_received', label: 'Not Received - Need Follow-up' },
  { value: 'not_applicable', label: 'N/A (No WM on this claim)' },
];

export const WM_COST_STATUS_LABELS: Record<string, string> = {
  paid_per_invoice: 'Paid per our invoice (no WM estimate)',
  included_in_rebuild: 'Included in rebuild estimate',
  separate_estimate: 'Separate WM estimate',
  not_received: 'Not received — needs follow-up',
  not_applicable: 'N/A (no WM on this claim)',
};

/** Progress of the contractor-prepared path. Unused on the carrier path. */
export type ContractorEstimateStage =
  | 'requested'
  | 'estimate_sent'
  | 'awaiting_approval'
  | 'approved_initial_received';

export const CONTRACTOR_ESTIMATE_STAGE_ORDER: ContractorEstimateStage[] = [
  'requested', 'estimate_sent', 'awaiting_approval', 'approved_initial_received',
];

export const CONTRACTOR_ESTIMATE_STAGE_LABELS: Record<ContractorEstimateStage, string> = {
  requested: 'Estimate Requested',
  estimate_sent: 'Estimate Sent',
  awaiting_approval: 'Awaiting Approval',
  approved_initial_received: 'Approved Initial Received',
};

export const CONTRACTOR_ESTIMATE_STAGE_COLORS: Record<ContractorEstimateStage, string> = {
  requested: 'default',
  estimate_sent: 'processing',
  awaiting_approval: 'orange',
  approved_initial_received: 'green',
};

/** insurance = a claim; cash = a cash job, the same without insurance details */
export type ClaimType = 'insurance' | 'cash';

/** A company working a claim or cash job; its people see it */
export interface ClaimCompanyRef {
  id: string;
  name: string;
  role?: string;
}

export interface Claim {
  id: string;
  client_id: string;
  company_id?: string;
  claim_type?: ClaimType;
  companies?: ClaimCompanyRef[];
  claim_number: string;
  insurance_company?: string;
  insurance_policy_number?: string;
  insurance_deductible?: number;
  /** Part of the deductible the company waived for the homeowner */
  deductible_discount?: number;
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
  pa_contact_id?: string | null;
  needs_supplement: boolean;
  supplement_status?: string;
  supplement_notes?: string;
  status: ClaimStatus;
  /** When the claim moved to appraisal; kept after it settles */
  appraisal_date?: string | null;
  estimate_origin?: EstimateOrigin | null;
  contractor_estimate_stage?: ContractorEstimateStage | null;
  /** Who writes the rebuild estimate on the contractor-prepared path */
  rebuild_estimate_company_id?: string | null;
  rebuild_estimate_company_name?: string | null;
  /** Companies that did this claim's WM; they may not write the rebuild estimate */
  wm_company_ids?: string[];
  wm_cost_status?: WMCostStatus | null;
  notes?: string;
  negotiations: ClaimNegotiation[];
  payments: ClaimPayment[];
  expenses: ClaimExpense[];
  invoice_count: number;
  estimate_count: number;
  wm_job_count: number;
  wm_jobs: { id: string; property_address?: string; status?: string; claim_number?: string; company_id?: string; company_name?: string }[];
  work_order_count: number;
  rebuild_jobs: { id: string; work_order_number?: string; property_address?: string; status?: string; company_id?: string; company_name?: string }[];
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
  current_rcv: number;
  deductible: number;
  deductible_discount: number;
  homeowner_deductible_due: number;
  pa_fee_percentage: number;
  pa_fee_base: number;
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

// ============================================================
// ClaimNote
// ============================================================

export interface ClaimNote {
  id: string;
  claim_id: string;
  content: string;
  created_by_name?: string;
  pinned: boolean;
  created_at?: string;
  updated_at?: string;
}

export interface ClaimNoteCreate {
  content: string;
  created_by_name?: string;
  pinned?: boolean;
}

// ============================================================
// ClaimTodo
// ============================================================

export type TodoPriority = 'low' | 'normal' | 'high' | 'urgent';

/** Todo board column; is_completed mirrors done */
export type TodoStatus = 'todo' | 'in_progress' | 'done';

export interface ClaimTodo {
  id: string;
  /** null for a todo tied to a client only, or to nothing */
  claim_id: string | null;
  client_id?: string | null;
  /** Whose board it is on; todos from before the board have none */
  owner_id?: string | null;
  title: string;
  description?: string;
  priority: TodoPriority;
  due_date?: string;
  status: TodoStatus;
  /** Order within the column; lower comes first */
  sort_order: number;
  is_completed: boolean;
  completed_at?: string;
  created_at?: string;
  updated_at?: string;
}

/** A todo as the board and the client page list it, with what it is tied to and whose it is */
export interface Todo extends ClaimTodo {
  client_name?: string | null;
  claim_number?: string | null;
  owner_name?: string | null;
}

export interface TodoCreate extends ClaimTodoCreate {
  client_id?: string | null;
  claim_id?: string | null;
  status?: TodoStatus;
}

export type TodoUpdate = Partial<TodoCreate & { is_completed: boolean }>;

export interface ClaimTodoCreate {
  title: string;
  description?: string;
  priority?: TodoPriority;
  due_date?: string;
}

export interface ClaimTodoDashboard extends ClaimTodo {
  client_id?: string;
  client_name?: string;
  claim_number?: string;
}

export const TODO_PRIORITY_COLORS: Record<TodoPriority, string> = {
  low: 'default',
  normal: 'blue',
  high: 'orange',
  urgent: 'red',
};

export interface ClaimCreate {
  client_id: string;
  claim_number: string;
  claim_type?: ClaimType;
  /** Replaces the companies working it */
  company_ids?: string[];
  company_id?: string;
  insurance_company?: string;
  insurance_policy_number?: string;
  insurance_deductible?: number;
  /** Part of the deductible the company waived for the homeowner */
  deductible_discount?: number;
  adjuster_name?: string;
  adjuster_phone?: string;
  adjuster_email?: string;
  /** CompanyContact id of the public adjuster; null/'' clears the link. */
  pa_contact_id?: string | null;
  date_of_loss?: string;
  loss_description?: string;
  status?: ClaimStatus;
  appraisal_date?: string | null;
  estimate_origin?: EstimateOrigin | null;
  contractor_estimate_stage?: ContractorEstimateStage | null;
  /** '' clears it */
  rebuild_estimate_company_id?: string | null;
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
  /** null/undefined = entered in this app, 'acculynx' = AccuLynx archive import */
  source?: 'acculynx' | null;
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

// ─── All-Documents aggregation ───

export type ClientDocType =
  | 'email' | 'invoice' | 'estimate' | 'contract'
  | 'insurance_estimate' | 'work_order' | 'wm_job'
  | 'cabinet_estimate' | 'plumber_report' | 'packing_estimate';

export interface ClientDocument {
  id: string;
  doc_type: ClientDocType;
  title: string;
  description?: string;
  status: string;
  claim_id?: string;
  claim_number?: string;
  date?: string;
  amount?: number | null;
  file_id?: string;
  link?: string | null;
  reply_received?: boolean;
}

export interface ClientAllDocumentsResponse {
  client_id: string;
  total: number;
  documents: ClientDocument[];
  claims: { id: string; claim_number: string }[];
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
  /** null/undefined = entered in this app, 'acculynx' = AccuLynx archive import */
  source?: 'acculynx' | null;
  claim_count: number;
  created_at?: string;
}

/** Which clients the list shows: entered in this app, or imported from AccuLynx */
export type ClientSourceFilter = 'manual' | 'acculynx';
