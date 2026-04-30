/**
 * Email Ingestion types
 */

export interface EmailAccount {
  id: string;
  display_name: string;
  email_address: string;
  provider_type: 'gmail' | 'outlook' | 'yahoo' | 'custom';
  imap_server: string;
  imap_port: number;
  use_ssl: boolean;
  username: string;
  company_id?: string;
  is_active: boolean;
  auto_schedule?: string;
  last_synced_at?: string;
  created_at?: string;
  updated_at?: string;
}

export interface EmailAccountCreate {
  display_name: string;
  email_address: string;
  provider_type: string;
  imap_server: string;
  imap_port: number;
  use_ssl: boolean;
  username: string;
  password: string;
  company_id?: string;
  is_active?: boolean;
  auto_schedule?: string;
}

export interface EmailAccountUpdate {
  display_name?: string;
  email_address?: string;
  provider_type?: string;
  imap_server?: string;
  imap_port?: number;
  use_ssl?: boolean;
  username?: string;
  password?: string;
  company_id?: string;
  is_active?: boolean;
  auto_schedule?: string;
}

export interface EmailAccountTestResult {
  success: boolean;
  message: string;
  inbox_count?: number;
}

export interface IngestionLog {
  id: string;
  email_account_id: string;
  message_id: string;
  subject?: string;
  sender?: string;
  received_at?: string;
  attachment_name?: string;
  status: IngestionStatus;
  is_insurance_estimate?: boolean;
  classification_reason?: string;
  matched_client_id?: string;
  matched_claim_id?: string;
  match_method?: string;
  match_confidence?: number;
  claim_created: boolean;
  negotiation_id?: string;
  file_id?: string;
  skip_reason?: string;
  error_message?: string;
  reviewed_by?: string;
  reviewed_at?: string;
  created_at?: string;
  // Joined fields
  client_name?: string;
  claim_number?: string;
  account_email?: string;
}

export type IngestionStatus =
  | 'pending'
  | 'processing'
  | 'classified'
  | 'matched'
  | 'uploaded'
  | 'skipped'
  | 'failed'
  | 'duplicate';

export interface ManualAssignRequest {
  client_id: string;
  claim_id?: string;
  create_claim?: boolean;
  claim_number?: string;
  reviewed_by?: string;
}

export interface SkipRequest {
  reason: string;
  reviewed_by?: string;
}

export interface PollResult {
  account_id: string;
  account_email: string;
  emails_found: number;
  processed: number;
  uploaded: number;
  skipped: number;
  duplicates: number;
  errors: number;
}

export interface BatchPollResult {
  accounts_polled: number;
  results: PollResult[];
  total_processed: number;
  total_uploaded: number;
}

export interface IngestionStats {
  total: number;
  uploaded: number;
  pending: number;
  skipped: number;
  failed: number;
  duplicates: number;
}

export const PROVIDER_PRESETS: Record<string, { imap_server: string; imap_port: number; use_ssl: boolean }> = {
  gmail: { imap_server: 'imap.gmail.com', imap_port: 993, use_ssl: true },
  outlook: { imap_server: 'outlook.office365.com', imap_port: 993, use_ssl: true },
  yahoo: { imap_server: 'imap.mail.yahoo.com', imap_port: 993, use_ssl: true },
};
