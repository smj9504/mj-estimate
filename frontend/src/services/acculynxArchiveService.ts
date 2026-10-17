/**
 * Read-only archive of jobs brought over from AccuLynx (backend:
 * app/domains/acculynx_archive). Document files are in Google Drive - the
 * API returns each job's folder link, not the files.
 */
import api from './api';

const BASE_URL = '/api/acculynx-archive';

export interface AccuLynxArchivedJob {
  id: string;
  client_id: string;
  acculynx_job_id: string;
  job_number?: string;
  job_name?: string;
  milestone?: string;
  trade_types?: string;
  work_type?: string;
  address?: string;
  city?: string;
  state?: string;
  zipcode?: string;
  job_created_at?: string;
  milestone_date?: string;
  insurance_company?: string;
  claim_number?: string;
  date_of_loss?: string;
  damage_location?: string;
  adjuster_name?: string;
  adjuster_phone?: string;
  adjuster_email?: string;
  approved_job_value?: number;
  total_received?: number;
  balance_due?: number;
  drive_folder_name?: string;
  drive_url?: string;
  document_count: number;
  message_count: number;
}

export interface AccuLynxArchivedDocument {
  id: string;
  folder_name?: string;
  drive_path?: string;
  name: string;
  content_type?: string;
  size?: number;
  uploaded_by?: string;
  uploaded_at?: string;
}

export interface AccuLynxArchivedMessage {
  id: string;
  thread_id: string;
  message_type?: string;
  subject?: string;
  sender_name?: string;
  sender_email?: string;
  recipients: { name?: string; email?: string; type: 'to' | 'cc' | 'bcc' }[];
  sent_at?: string;
  body_text?: string;
  attachments: { name?: string; document_id?: string | null }[];
}

export interface AccuLynxArchivedJobDetail extends AccuLynxArchivedJob {
  payments: { date?: string; amount?: number; from?: string; check_number?: string; notes?: string }[];
  documents: AccuLynxArchivedDocument[];
  messages: AccuLynxArchivedMessage[];
}

export const acculynxArchiveService = {
  async listClientJobs(clientId: string): Promise<AccuLynxArchivedJob[]> {
    const response = await api.get(`${BASE_URL}/clients/${clientId}/jobs`);
    return response.data;
  },

  async getJob(jobId: string): Promise<AccuLynxArchivedJobDetail> {
    const response = await api.get(`${BASE_URL}/jobs/${jobId}`);
    return response.data;
  },
};
