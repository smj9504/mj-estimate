/**
 * Claim Follow-up types
 */

export type TaskType = 'wm_docs_sent' | 'supplement_estimate_prep' | 'supplement_sent' | 'depreciation_recovery' | 'estimate_request' | 'payment_check' | 'wm_payment_check' | 'docs_sent' | 'general' | 'dispute' | 'appraisal' | 'attorney_referral' | (string & {});

export const KNOWN_TASK_TYPES = [
  'wm_docs_sent', 'supplement_estimate_prep', 'supplement_sent', 'depreciation_recovery', 'estimate_request',
  'payment_check', 'wm_payment_check', 'docs_sent', 'general',
  'dispute', 'appraisal', 'attorney_referral',
] as const;
// 'awaiting_confirmation': 우리가 직접 확인할 수 없고 다른 사람의 컨펌을 기다리는 상태.
// overdue 계산과 '내 할 일'에서 제외되며, 다음 단계 진행을 막지 않는다.
export type TaskStatus = 'pending' | 'awaiting_response' | 'awaiting_confirmation' | 'responded' | 'resolved' | 'overdue' | 'cancelled';

// 우리가 액션을 해야 하는 상태 (overdue 판정 대상)
export const ACTIONABLE_STATUSES: TaskStatus[] = ['pending', 'awaiting_response'];
export type TaskPriority = 'low' | 'normal' | 'high' | 'urgent';
export type AssignedRole = 'adjuster' | 'public_adjuster' | 'contractor';

export const ASSIGNED_ROLE_OPTIONS: { value: AssignedRole; label: string }[] = [
  { value: 'adjuster', label: 'Adjuster' },
  { value: 'public_adjuster', label: 'Public Adjuster' },
  { value: 'contractor', label: 'Contractor' },
];

export const ASSIGNED_ROLE_LABELS: Record<string, string> = {
  adjuster: 'Adjuster',
  public_adjuster: 'Public Adjuster',
  contractor: 'Contractor',
};

/** Supplement work is negotiated with the PA, so these types default to it. */
export const SUPPLEMENT_TASK_TYPES = ['supplement_estimate_prep', 'supplement_sent'];

export const isSupplementTaskType = (t?: string): boolean =>
  !!t && SUPPLEMENT_TASK_TYPES.includes(t);

/**
 * The contact a role points at, taken from the claim enrichment already on
 * the task. Returns nulls for roles with no claim-level source of truth
 * (e.g. contractor) so callers can leave the fields untouched.
 */
export const contactForRole = (
  role: AssignedRole | string | undefined,
  task?: Partial<FollowUpTask> | null,
): { name: string; email: string; phone: string } | null => {
  if (!task) return null;
  if (role === 'public_adjuster') {
    if (!task.pa_name && !task.pa_email) return null;
    return {
      name: task.pa_name || '',
      email: task.pa_email || '',
      phone: task.pa_phone || '',
    };
  }
  if (role === 'adjuster') {
    if (!task.adjuster_name && !task.adjuster_email) return null;
    return {
      name: task.adjuster_name || '',
      email: task.adjuster_email || '',
      phone: task.adjuster_phone || '',
    };
  }
  return null;
};
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
  adjuster_name?: string;
  adjuster_email?: string;
  adjuster_phone?: string;
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
  opened_at?: string;
  open_count: number;
  last_opened_at?: string;
  // null/undefined = unknown (sent before this was recorded); false = the
  // tracking pixel was not attached, so "Unread" means nothing on that row.
  tracking_pixel_sent?: boolean | null;
  created_at?: string;
}

export interface FollowUpDashboardStats {
  total_tasks: number;
  pending: number;
  awaiting_response: number;
  awaiting_confirmation: number;
  overdue: number;
  resolved_this_week: number;
  by_type: Record<string, number>;
  by_priority: Record<string, number>;
}

// UI helper types
export const TASK_TYPE_LABELS: Record<string, string> = {
  wm_docs_sent: 'WM Docs Sent',
  supplement_estimate_prep: 'Prepare Supplement Estimate',
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
  awaiting_confirmation: 'purple',
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

// ============================================================
// Payment receipts
//
// 보험금은 분할로 들어오고, supplement가 승인되면 이후에도 추가로
// 들어올 수 있다. 따라서 '받았다/안 받았다' 플래그가 아니라 수령
// 내역의 목록으로 관리한다. 기록을 남겨도 단계가 닫히지 않는다.
// ============================================================

export type PaymentReceiptType =
  | 'insurance'
  | 'depreciation_recovery'
  | 'supplement'
  | 'deductible'
  | 'other';

export const PAYMENT_RECEIPT_TYPE_LABELS: Record<PaymentReceiptType, string> = {
  insurance: 'Insurance',
  depreciation_recovery: 'Depreciation',
  supplement: 'Supplement',
  deductible: 'Deductible',
  other: 'Other',
};

export interface PaymentReceipt {
  id: string;
  claim_id: string;
  amount: number;
  payment_type?: PaymentReceiptType | string;
  received_date?: string;
  check_number?: string;
  paid_by?: string;
  payment_category?: string;
  notes?: string;
  status?: string;
  created_at?: string;
}

export interface PaymentReceiptCreate {
  amount: number;
  payment_type?: PaymentReceiptType | string;
  received_date?: string;
  check_number?: string;
  paid_by?: string;
  payment_category?: string;
  notes?: string;
  /** 이 입금을 확인해 준 사람 (우리가 직접 확인할 수 없는 정보) */
  confirmed_by?: string;
}

export interface ClaimPaymentSummary {
  total_expected: number;
  total_received: number;
  deductible: number;
  /** 참고용 잔액 — supplement로 expected가 올라갈 수 있어 완료 기준이 아니다 */
  remaining: number;
  payment_status: string;
  payments: PaymentReceipt[];
}
