/**
 * Contract, ContractTemplate, ClaimCompany types
 */

// ============================================================
// ContractTemplate
// ============================================================

export type DocumentType =
  | 'authorization'
  | 'certificate_of_satisfaction'
  | 'certificate_of_completion'
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
  file_available?: boolean;
  requires_signature: boolean;
  signature_roles?: string; // JSON string
  field_mappings?: string; // JSON string
  is_active: boolean;
  version: number;
  created_at?: string;
  updated_at?: string;
}

// ============================================================
// Field Mapping
// ============================================================

export type FieldType = 'text' | 'signature' | 'initial' | 'date_signed';

export interface FieldMappingItem {
  id: string;
  pageIndex: number;
  x: number;      // ratio 0-1
  y: number;      // ratio 0-1
  width: number;  // ratio 0-1
  height: number; // ratio 0-1
  fieldKey: string;
  label: string;
  fontSize: number;
  fontColor: string;
  fieldType?: FieldType;       // default 'text'
  signerRole?: string;         // for signature/initial: 'homeowner' | 'company_rep' | 'witness'
}

export interface AvailableField {
  key: string;
  label: string;
  category: string;
}

export interface FieldMappingResponse {
  field_mappings: FieldMappingItem[];
  available_fields: AvailableField[];
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
  signature_type?: 'drawn' | 'typed';
  typed_name?: string;
}

export interface ContractAuditEntry {
  action: string; // created | emailed | viewed | signer_name_entered | signed | agreement_completed | reminder_sent | voided | sent_copy
  timestamp: string;
  ip?: string | null;
  user_agent?: string | null;
  detail?: Record<string, any> | null;
  actor_email?: string | null;
  actor_name?: string | null;
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
  filled_pdf_url?: string;
  signed_pdf_url?: string;
  template_name?: string;
  company_name?: string;
  client_name?: string;
  client_email?: string;
  file_url?: string;
  document_type?: string;
  requires_signature?: boolean;
  signature_count: number;
  signatures?: ContractSignature[];
  audit_log?: string | ContractAuditEntry[];
  sent_to_emails?: string;
  prefill_data?: string | Record<string, Record<string, string | null>>;
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

export interface SignatureFieldPlacement {
  id: string;
  pageIndex: number;
  x: number;
  y: number;
  width: number;
  height: number;
  fieldType: 'signature' | 'initial' | 'date_signed';
  signerRole: string;
  label: string;
}

export interface ContractViewData {
  contract_id: string;
  title?: string;
  company_name?: string;
  client_name?: string;
  client_email?: string;
  template_name?: string;
  document_type?: string;
  file_url?: string;
  filled_pdf_url?: string;
  status: string;
  requires_signature: boolean;
  signature_roles?: string;
  signature_fields?: SignatureFieldPlacement[];
  existing_signatures: { signer_name: string; signer_role: string; signed_at: string }[];
}

// ============================================================
// Field Signing (iPad field flow)
// ============================================================

export interface FieldSignCompany {
  id: string;
  name: string;
  template_count: number;
}

export interface ContractFieldViewData extends ContractViewData {
  prefill_data: Record<string, Record<string, string | null>>;
  field_mappings: FieldMappingItem[];
}

// ============================================================
// Prefill Preview
// ============================================================

export interface PrefillPreviewData {
  client: Record<string, string | null>;
  claim: Record<string, string | null>;
  company: Record<string, string | null>;
  meta: Record<string, string | null>;
  field_mappings: FieldMappingItem[];
}

// ============================================================
// Dashboard
// ============================================================

export interface CompanyContractSummary {
  company_id: string;
  company_name: string;
  role?: string;
  is_primary: boolean;
  contracts: ContractInstance[];
  summary: {
    total: number;
    draft: number;
    sent: number;
    viewed: number;
    signed: number;
    voided: number;
  };
}

export interface ClaimContractDashboardData {
  claim_id: string;
  companies: CompanyContractSummary[];
  total_contracts: number;
}
