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
  status: ClaimStatus;
  notes?: string;
  negotiations: ClaimNegotiation[];
  invoice_count: number;
  estimate_count: number;
  wm_job_count: number;
  work_order_count: number;
  created_at?: string;
  updated_at?: string;
}

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
