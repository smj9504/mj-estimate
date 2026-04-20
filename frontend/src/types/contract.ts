/**
 * Contract, ContractTemplate, ClaimCompany types
 */

// ============================================================
// ContractTemplate
// ============================================================

export type DocumentType =
  | 'authorization'
  | 'certificate_of_satisfaction'
  | 'scope_of_work'
  | 'lien_waiver'
  | 'change_order'
  | 'other';

export interface ContractTemplate {
  id: string;
  company_id: string;
  company_name?: string;
  name: string;
  document_type: DocumentType;
  description?: string;
  file_url?: string;
  file_name?: string;
  file_size?: number;
  requires_signature: boolean;
  signature_roles?: string; // JSON string
  is_active: boolean;
  version: number;
  created_at?: string;
  updated_at?: string;
}

// ============================================================
// ContractInstance
// ============================================================

export type ContractStatus = 'draft' | 'sent' | 'viewed' | 'signed' | 'voided';

export interface ContractSignature {
  id: string;
  signer_name: string;
  signer_role: string;
  signed_at: string;
  signature_image?: string;
}

export interface ContractInstance {
  id: string;
  template_id: string;
  claim_id: string;
  client_id: string;
  company_id: string;
  contract_number?: string;
  title?: string;
  notes?: string;
  status: ContractStatus;
  signing_token?: string;
  token_expires_at?: string;
  sent_at?: string;
  viewed_at?: string;
  signed_at?: string;
  voided_at?: string;
  signed_pdf_url?: string;
  template_name?: string;
  company_name?: string;
  client_name?: string;
  file_url?: string;
  document_type?: string;
  requires_signature?: boolean;
  signature_count: number;
  signatures?: ContractSignature[];
  created_at?: string;
  updated_at?: string;
}

// ============================================================
// ClaimCompany
// ============================================================

export type CompanyRole = 'plumber' | 'water_mitigation' | 'reconstruction' | 'moving' | 'other';

export interface ClaimCompany {
  id: string;
  claim_id: string;
  company_id: string;
  company_name?: string;
  role: CompanyRole;
  is_primary: boolean;
  notes?: string;
  assigned_at?: string;
  created_at?: string;
}

// ============================================================
// Signing (public page)
// ============================================================

export interface ContractViewData {
  contract_id: string;
  title?: string;
  company_name?: string;
  client_name?: string;
  template_name?: string;
  document_type?: string;
  file_url?: string;
  status: string;
  requires_signature: boolean;
  signature_roles?: string;
  existing_signatures: { signer_name: string; signer_role: string; signed_at: string }[];
}
