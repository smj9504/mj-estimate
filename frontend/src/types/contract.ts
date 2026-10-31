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

export type SigningPurpose = 'water_mitigation' | 'work_completion';

// Keep in sync with SIGNING_PURPOSES and SIGNED_TOGETHER in backend/app/domains/contract/onsite_signing.py
export const SIGNING_PURPOSES: {
  value: SigningPurpose;
  label: string;
  description: string;
  /** Every one of the company's documents for it is signed in the same visit */
  signedTogether?: boolean;
}[] = [
  {
    value: 'water_mitigation',
    label: 'Water Mitigation',
    description: 'The authorization and the sign-off, signed together',
    signedTogether: true,
  },
  {
    value: 'work_completion',
    label: 'Work Completion',
    description: 'The customer confirms the finished work',
  },
];

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
  /** The card it shows under on the On-site Signing screen; none keeps it off that screen */
  signing_purpose?: SigningPurpose | null;
  is_active: boolean;
  version: number;
  created_at?: string;
  updated_at?: string;
}

// ============================================================
// Field Mapping
// ============================================================

export type FieldType = 'text' | 'signature' | 'initial' | 'date_signed';

/** Who fills in this field's value */
export type InputMode = 'prefilled' | 'creator' | 'signer';

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
  inputMode?: InputMode;       // who fills this field: prefilled (auto), creator (at generation), signer (at signing)
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
  // The company's lines this signed contract is still waiting on
  open_company_lines?: SignatureFieldPlacement[];
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

export interface SignerEditableField {
  id: string;
  fieldKey: string;
  label: string;
  pageIndex: number;
  x: number;
  y: number;
  width: number;
  height: number;
  fontSize: number;
  fontColor: string;
  currentValue?: string | null;
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
  signer_editable_fields?: SignerEditableField[];
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

// ============================================================
// On-site signing
// ============================================================

export interface OnsiteCompany {
  id: string;
  name: string;
  templates: { id: string; name: string; document_type: DocumentType }[];
}

export type OnsiteQuestionKind = 'text' | 'date' | 'address' | 'phone' | 'email';

export interface OnsiteQuestion {
  key: string;
  label: string;
  kind: OnsiteQuestionKind;
  value: string;
}

export interface OnsiteAddress {
  street: string;
  city?: string;
  state?: string;
  zipcode?: string;
}

export interface OnsiteDocument {
  template_id: string;
  template_name: string;
  signature_fields: SignatureFieldPlacement[];
}

/** What a visit asks, once for all its documents, and each document's lines */
export interface OnsiteForm {
  documents: OnsiteDocument[];
  questions: OnsiteQuestion[];
}

export interface OnsiteSignedDocument {
  contract_id: string;
  contract_number?: string;
  title?: string;
  pdf_ready: boolean;
  pdf_url: string;
  /** Labels of the mapped fields left blank; a copy can only be emailed when there are none */
  missing_fields: string[];
}

export interface OnsiteSignedContract {
  client_id: string;
  client_name: string;
  client_created: boolean;
  client_email: string;
  office_notified: boolean;
  /** One per document, in the order they were signed */
  contracts: OnsiteSignedDocument[];
}
