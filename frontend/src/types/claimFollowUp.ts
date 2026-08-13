/**
 * Claim Follow-up types
 */

export type TaskType = 'wm_docs_sent' | 'supplement_sent' | 'depreciation_recovery' | 'estimate_request' | 'payment_check' | 'wm_payment_check' | 'docs_sent' | 'general' | 'dispute' | 'appraisal' | 'attorney_referral' | (string & {});

export const KNOWN_TASK_TYPES = [
  'wm_docs_sent', 'supplement_sent', 'depreciation_recovery', 'estimate_request',
  'payment_check', 'wm_payment_check', 'docs_sent', 'general',
  'dispute', 'appraisal', 'attorney_referral',
] as const;
export type TaskStatus = 'pending' | 'awaiting_response' | 'responded' | 'resolved' | 'overdue' | 'cancelled';
export type TaskPriority = 'low' | 'normal' | 'high' | 'urgent';
export type AssignedRole = 'adjuster' | 'public_adjuster' | 'contractor';
export type CommunicationType = 'email' | 'phone' | 'text' | 'in_person' | 'other';
export type EmailStatus = 'draft' | 'queued' | 'sending' | 'sent' | 'failed' | 'bounced';

export type DepreciationPhase =
  | 'in_construction'
  | 'construction_done'
  | 'preparing_docs'
  | 'docs_sent_pa'
  | 'docs_sent_insurance'
  | 'following_up'
  | 'payment_received';

export const DEPRECIATION_PHASE_ORDER: DepreciationPhase[] = [
  'in_construction', 'construction_done', 'preparing_docs',
  'docs_sent_pa', 'docs_sent_insurance', 'following_up', 'payment_received',
];

export const DEPRECIATION_PHASE_LABELS: Record<DepreciationPhase, string> = {
  in_construction: 'In Construction',
  construction_done: 'Construction Complete',
  preparing_docs: 'Preparing Docs',
  docs_sent_pa: 'Sent to PA',
  docs_sent_insurance: 'Sent to Insurance',
  following_up: 'Following Up',
  payment_received: 'Payment Received',
};

export const DEPRECIATION_PHASE_COLORS: Record<DepreciationPhase, string> = {
  in_construction: 'processing',
  construction_done: 'purple',
  preparing_docs: 'orange',
  docs_sent_pa: 'blue',
  docs_sent_insurance: 'blue',
  following_up: 'volcano',
  payment_received: 'green',
};

export interface FollowUpTask {
  id: string;
  claim_id: string;
  wm_job_id?: string;
  task_type: TaskType;
  title: string;
  description?: string;
  status: TaskStatus;
  due_date?: string;
  priority: TaskPriority;
  last_contacted_at?: string;
  next_followup_date?: string;
  contact_count: number;
  auto_followup_enabled: boolean;
  followup_interval_days: number;
  max_followup_count: number;
  assigned_to_name?: string;
  assigned_to_email?: string;
  assigned_to_phone?: string;
  assigned_to_role: AssignedRole;
  resolved_at?: string;
  resolution_notes?: string;
  payment_status?: string;
  payment_note?: string;
  depreciation_phase?: DepreciationPhase;
  created_at?: string;
  updated_at?: string;
  // Enriched fields
  communications_count?: number;
  sent_emails_count?: number;
  claim_number?: string;
  property_address?: string;
  insurance_company?: string;
  supplement_statuses?: Record<string, number>;
  pending_info_requests?: number;
  has_public_adjuster?: boolean;
  pa_name?: string;
  pa_company?: string;
  pa_email?: string;
  pa_phone?: string;
  wm_cost_status?: string;
  has_insurance_estimate?: boolean;
  bid_estimate_summary?: Record<string, number>;
  // Depreciation recovery enrichment
  depreciation_amount?: number;
  has_pending_supplements?: boolean;
  has_appraisal_task?: boolean;
}

export interface FollowUpTaskCreate {
  claim_id: string;
  wm_job_id?: string;
  task_type: TaskType;
  title: string;
  description?: string;
  due_date?: string;
  next_followup_date?: string;
  priority?: TaskPriority;
  assigned_to_name?: string;
  assigned_to_email?: string;
  assigned_to_phone?: string;
  assigned_to_role?: AssignedRole;
  auto_followup_enabled?: boolean;
  followup_interval_days?: number;
  max_followup_count?: number;
}

export interface FollowUpTaskUpdate {
  title?: string;
  description?: string;
  status?: TaskStatus;
  due_date?: string;
  priority?: TaskPriority;
  assigned_to_name?: string;
  assigned_to_email?: string;
  assigned_to_phone?: string;
  assigned_to_role?: AssignedRole;
  auto_followup_enabled?: boolean;
  followup_interval_days?: number;
  max_followup_count?: number;
  resolution_notes?: string;
}

export interface EmailTemplate {
  id: string;
  name: string;
  description?: string;
  template_type: string;
  subject_template: string;
  body_template: string;
  available_variables: string[];
  language: string;
  is_active: boolean;
  is_system: boolean;
  usage_count: number;
  company_id?: string;
  created_at?: string;
}

export interface EmailTemplateCreate {
  name: string;
  description?: string;
  template_type: string;
  subject_template: string;
  body_template: string;
  available_variables?: string[];
  language?: string;
  company_id?: string;
}

export interface CommunicationLog {
  id: string;
  claim_id: string;
  followup_task_id?: string;
  communication_type: CommunicationType;
  direction: 'outbound' | 'inbound';
  contact_name?: string;
  contact_email?: string;
  contact_phone?: string;
  subject?: string;
  summary?: string;
  response_received: boolean;
  response_date?: string;
  response_summary?: string;
  sent_email_id?: string;
  created_at?: string;
}

export interface CommunicationLogCreate {
  claim_id: string;
  followup_task_id?: string;
  communication_type: CommunicationType;
  direction: 'outbound' | 'inbound';
  contact_name?: string;
  contact_email?: string;
  contact_phone?: string;
  subject?: string;
  summary?: string;
}

export interface EmailAttachment {
  filename: string;
  file_id: string;
  mime_type?: string;
  size?: number;
}

export interface SendEmailRequest {
  claim_id: string;
  followup_task_id?: string;
  email_account_id?: string;
  to_addresses: string[];
  cc_addresses?: string[];
  subject: string;
  body_html: string;
  attachments?: EmailAttachment[];
  template_id?: string;
  template_variables?: Record<string, string>;
  scheduled_at?: string;
  // Water mitigation document re-attachment for follow-up emails
  wm_job_id?: string;
  wm_documents?: string[];
}

export interface SendFromTemplateRequest {
  claim_id: string;
  followup_task_id?: string;
  email_account_id?: string;
  template_id: string;
  to_addresses: string[];
  cc_addresses?: string[];
  variables: Record<string, string>;
  attachments?: EmailAttachment[];
  scheduled_at?: string;
}

export interface GenerateAIEmailRequest {
  claim_id: string;
  followup_task_id?: string;
  context_type: string;
  tone?: 'professional' | 'friendly' | 'urgent' | 'formal';
  language?: string;
  additional_context?: string;
}

export interface GenerateAIEmailResponse {
  subject: string;
  body_html: string;
  body_text: string;
  variables_used: Record<string, string>;
}

export type PolishEmailAction = 'shorten' | 'lengthen' | 'friendly' | 'formal' | 'proofread';

export interface PolishEmailRequest {
  body_html: string;
  action: PolishEmailAction;
  subject?: string;
}

export interface PolishEmailResponse {
  subject: string;
  body_html: string;
}

export interface SentEmail {
  id: string;
  claim_id: string;
  followup_task_id?: string;
  from_address: string;
  to_addresses: string[];
  cc_addresses: string[];
  subject: string;
  body_html: string;
  attachments: EmailAttachment[];
  template_id?: string;
  is_ai_generated: boolean;
  status: EmailStatus;
  sent_at?: string;
  error_message?: string;
  scheduled_at?: string;
  reply_received: boolean;
  reply_received_at?: string;
  reply_summary?: string;
  created_at?: string;
}

export interface FollowUpDashboardStats {
  total_tasks: number;
  pending: number;
  awaiting_response: number;
  overdue: number;
  resolved_this_week: number;
  by_type: Record<string, number>;
  by_priority: Record<string, number>;
}

// UI helper types
export const TASK_TYPE_LABELS: Record<string, string> = {
  wm_docs_sent: 'WM Docs Sent',
  supplement_sent: 'Supplement Sent',
  depreciation_recovery: 'Depreciation Recovery',
  estimate_request: 'Estimate Request',
  payment_check: 'Payment Check',
  wm_payment_check: 'WM Payment Check',
  docs_sent: 'Documents Sent',
  general: 'General',
  dispute: 'Dispute',
  appraisal: 'Appraisal',
  attorney_referral: 'Attorney Referral',
};

export const TASK_STATUS_COLORS: Record<TaskStatus, string> = {
  pending: 'blue',
  awaiting_response: 'orange',
  responded: 'cyan',
  resolved: 'green',
  overdue: 'red',
  cancelled: 'default',
};

export const PRIORITY_COLORS: Record<TaskPriority, string> = {
  low: 'default',
  normal: 'blue',
  high: 'orange',
  urgent: 'red',
};
