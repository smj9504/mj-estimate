/**
 * Claim Follow-up types
 */

export type TaskType = 'wm_docs_sent' | 'supplement_sent' | 'depreciation_recovery' | 'estimate_request' | 'payment_check' | 'wm_payment_check' | 'docs_sent' | 'general';
export type TaskStatus = 'pending' | 'awaiting_response' | 'responded' | 'resolved' | 'overdue' | 'cancelled';
export type TaskPriority = 'low' | 'normal' | 'high' | 'urgent';
export type AssignedRole = 'adjuster' | 'public_adjuster' | 'contractor';
export type CommunicationType = 'email' | 'phone' | 'text' | 'in_person' | 'other';
export type EmailStatus = 'draft' | 'queued' | 'sending' | 'sent' | 'failed' | 'bounced';

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
export const TASK_TYPE_LABELS: Record<TaskType, string> = {
  wm_docs_sent: 'WM Docs Sent',
  supplement_sent: 'Supplement Sent',
  depreciation_recovery: 'Depreciation Recovery',
  estimate_request: 'Estimate Request',
  payment_check: 'Payment Check',
  wm_payment_check: 'WM Payment Check',
  docs_sent: 'Documents Sent',
  general: 'General',
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
