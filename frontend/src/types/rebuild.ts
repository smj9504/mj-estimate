/**
 * Rebuild (construction project) types
 */

export type ProjectStatus = 'pending' | 'assigned' | 'in_progress' | 'completed' | 'invoiced' | 'docs_sent' | 'closed' | 'cancelled';
export type CompletionDocType = 'coc' | 'invoice' | 'completion_photo' | 'warranty' | 'permit' | 'lien_waiver' | 'other';

export interface RebuildContractor {
  id: string;
  company_name: string;
  contact_name?: string;
  phone?: string;
  email?: string;
  address?: string;
  specialty?: string;
  license_number?: string;
  insurance_info?: string;
  doc_config?: Record<string, any>;
  is_active: boolean;
  notes?: string;
  project_count: number;
  created_at?: string;
}

export interface RebuildProject {
  id: string;
  claim_id: string;
  contractor_id?: string;
  title: string;
  description?: string;
  scope_of_work?: string;
  property_address?: string;
  status: ProjectStatus;
  start_date?: string;
  estimated_completion?: string;
  actual_completion?: string;
  insurance_estimate_amount: number;
  contract_amount: number;
  final_invoice_amount: number;
  coc_sent: boolean;
  invoice_sent: boolean;
  photos_sent: boolean;
  docs_sent_to?: string;
  docs_sent_date?: string;
  docs_acknowledged: boolean;
  docs_acknowledged_date?: string;
  /** The customer hires their own contractor; we don't build it */
  customer_managed: boolean;
  /** Which insurance estimate the scope of work was drafted from; empty when typed by hand */
  scope_source?: RebuildScopeSource | null;
  priority: string;
  notes?: string;
  created_at?: string;
  // Enriched
  claim_number?: string;
  insurance_company?: string;
  client_name?: string;
  client_id?: string;
  contractor_name?: string;
  rebuild_company_id?: string;
  rebuild_company_name?: string;
  completion_doc_count: number;
  contractor?: RebuildContractor;
  completion_docs: RebuildCompletionDoc[];
  /** Project page only: the claim's WM jobs, each one of the claim's photo sets */
  wm_jobs?: RebuildWMJob[];
  /** Project page only, read-only: the companies that did the claim's water mitigation */
  wm_companies?: { id: string; name: string }[];
}

/** The estimate revision a project's scope of work was drafted from */
export interface RebuildScopeSource {
  negotiation_id: string;
  label: string;
  document_name?: string | null;
  drafted_at: string;
}

/** A rough scope of work read from an estimate PDF (nothing saved yet) */
export interface RebuildScopeDraft {
  text: string;
  areas: { level?: string | null; name: string; trades: { trade: string; items: string[] }[] }[];
  line_count: number;
  /** Lines left out: water mitigation, contents, protection, cleaning, labor minimums */
  skipped_count: number;
  source: RebuildScopeSource;
}

export interface RebuildWMJob {
  id: string;
  property_address?: string;
  company_name?: string;
  companycam_project_id?: string;
}

/** One page of the project list and how many match in all */
export interface RebuildProjectPage {
  items: RebuildProject[];
  total: number;
  page: number;
  page_size: number;
}

export interface RebuildProjectCreate {
  claim_id: string;
  contractor_id?: string;
  title: string;
  description?: string;
  scope_of_work?: string;
  property_address?: string;
  start_date?: string;
  estimated_completion?: string;
  insurance_estimate_amount?: number;
  contract_amount?: number;
  priority?: string;
}

export interface RebuildCompletionDoc {
  id: string;
  project_id: string;
  doc_type: CompletionDocType;
  title: string;
  description?: string;
  file_id?: string;
  file_name?: string;
  file_url?: string;
  mime_type?: string;
  status: string;
  created_at?: string;
}

export interface RebuildDashboardStats {
  total_projects: number;
  pending: number;
  assigned: number;
  in_progress: number;
  completed: number;
  docs_sent: number;
  total_contract_amount: number;
  total_contractors: number;
  /** Projects the customer builds with their own contractor; the figures above leave them out */
  customer_managed?: number;
}

export const PROJECT_STATUS_COLORS: Record<ProjectStatus, string> = {
  pending: 'default',
  assigned: 'blue',
  in_progress: 'processing',
  completed: 'green',
  invoiced: 'cyan',
  docs_sent: 'geekblue',
  closed: 'default',
  cancelled: 'red',
};

export const DOC_TYPE_LABELS: Record<CompletionDocType, string> = {
  coc: 'Certificate of Completion',
  invoice: 'Invoice',
  completion_photo: 'Completion Photos',
  warranty: 'Warranty',
  permit: 'Permit',
  lien_waiver: 'Lien Waiver',
  other: 'Other',
};
