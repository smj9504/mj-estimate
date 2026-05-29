/**
 * Claim Follow-up API service
 */

import api from './api';
import type {
  FollowUpTask,
  FollowUpTaskCreate,
  FollowUpTaskUpdate,
  EmailTemplate,
  EmailTemplateCreate,
  CommunicationLog,
  CommunicationLogCreate,
  SentEmail,
  SendEmailRequest,
  SendFromTemplateRequest,
  GenerateAIEmailRequest,
  GenerateAIEmailResponse,
  FollowUpDashboardStats,
} from '../types/claimFollowUp';

const BASE_URL = '/api/claim-followup';

export const claimFollowUpService = {
  // ============================================================
  // Follow-Up Tasks
  // ============================================================

  async getTasks(params?: {
    status?: string;
    task_type?: string;
    priority?: string;
    claim_id?: string;
    overdue_only?: boolean;
    page?: number;
    page_size?: number;
    sort_by?: string;
    sort_order?: string;
  }): Promise<FollowUpTask[]> {
    const { data } = await api.get(`${BASE_URL}/tasks`, { params });
    return data;
  },

  async getTasksByClaimId(claimId: string): Promise<FollowUpTask[]> {
    const { data } = await api.get(`${BASE_URL}/tasks/by-claim/${claimId}`);
    return data;
  },

  async getTask(taskId: string): Promise<FollowUpTask> {
    const { data } = await api.get(`${BASE_URL}/tasks/${taskId}`);
    return data;
  },

  async createTask(payload: FollowUpTaskCreate): Promise<FollowUpTask> {
    const { data } = await api.post(`${BASE_URL}/tasks`, payload);
    return data;
  },

  async updateTask(taskId: string, payload: FollowUpTaskUpdate): Promise<FollowUpTask> {
    const { data } = await api.patch(`${BASE_URL}/tasks/${taskId}`, payload);
    return data;
  },

  async resolveTask(
    taskId: string,
    body?: {
      resolution_notes?: string;
      outcome?: string;
      denied_action?: string;
      acv_amount?: number;
      rcv_amount?: number;
      depreciation_amount?: number;
      deductible?: number;
      wm_cost_status?: string;
      wm_estimate_amount?: number;
      sections_data?: any;
      file?: File;
      wm_estimate_file?: File;
    }
  ): Promise<FollowUpTask> {
    const formData = new FormData();
    if (body?.outcome) formData.append('outcome', body.outcome);
    if (body?.denied_action) formData.append('denied_action', body.denied_action);
    if (body?.resolution_notes) formData.append('resolution_notes', body.resolution_notes);
    if (body?.acv_amount != null) formData.append('acv_amount', String(body.acv_amount));
    if (body?.rcv_amount != null) formData.append('rcv_amount', String(body.rcv_amount));
    if (body?.depreciation_amount != null) formData.append('depreciation_amount', String(body.depreciation_amount));
    if (body?.deductible != null) formData.append('deductible', String(body.deductible));
    if (body?.wm_cost_status) formData.append('wm_cost_status', body.wm_cost_status);
    if (body?.wm_estimate_amount != null) formData.append('wm_estimate_amount', String(body.wm_estimate_amount));
    if (body?.sections_data) formData.append('sections_data', JSON.stringify(body.sections_data));
    if (body?.file) formData.append('file', body.file);
    if (body?.wm_estimate_file) formData.append('wm_estimate_file', body.wm_estimate_file);

    const { data } = await api.post(`${BASE_URL}/tasks/${taskId}/resolve`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
    return data;
  },

  async parseEstimatePdf(file: File): Promise<{
    sections: Array<{
      section_name: string;
      rcv?: number;
      depreciation?: number;
      net_acv?: number;
      deductible?: number;
      [key: string]: any;
    }>;
    totals: { acv_amount?: number; rcv_amount?: number; depreciation_amount?: number; deductible?: number };
    validation?: any;
  }> {
    const formData = new FormData();
    formData.append('file', file);
    const { data } = await api.post(`${BASE_URL}/tasks/parse-estimate`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
      timeout: 120000,
    });
    return data;
  },

  async reopenTask(taskId: string): Promise<FollowUpTask> {
    const { data } = await api.post(`${BASE_URL}/tasks/${taskId}/reopen`);
    return data;
  },

  async deleteTask(taskId: string): Promise<void> {
    await api.delete(`${BASE_URL}/tasks/${taskId}`);
  },

  async getDashboardStats(): Promise<FollowUpDashboardStats> {
    const { data } = await api.get(`${BASE_URL}/tasks/stats`);
    return data;
  },

  // ============================================================
  // Email Templates
  // ============================================================

  async getTemplates(params?: {
    template_type?: string;
    company_id?: string;
  }): Promise<EmailTemplate[]> {
    const { data } = await api.get(`${BASE_URL}/templates`, { params });
    return data;
  },

  async getTemplate(templateId: string): Promise<EmailTemplate> {
    const { data } = await api.get(`${BASE_URL}/templates/${templateId}`);
    return data;
  },

  async createTemplate(payload: EmailTemplateCreate): Promise<EmailTemplate> {
    const { data } = await api.post(`${BASE_URL}/templates`, payload);
    return data;
  },

  async updateTemplate(templateId: string, payload: Partial<EmailTemplate>): Promise<EmailTemplate> {
    const { data } = await api.patch(`${BASE_URL}/templates/${templateId}`, payload);
    return data;
  },

  async deleteTemplate(templateId: string): Promise<void> {
    await api.delete(`${BASE_URL}/templates/${templateId}`);
  },

  async renderTemplate(templateId: string, variables: Record<string, string>): Promise<{ subject: string; body_html: string }> {
    const { data } = await api.post(`${BASE_URL}/templates/${templateId}/render`, variables);
    return data;
  },

  // ============================================================
  // Communication Logs
  // ============================================================

  async getCommunicationsByClaimId(claimId: string): Promise<CommunicationLog[]> {
    const { data } = await api.get(`${BASE_URL}/communications/by-claim/${claimId}`);
    return data;
  },

  async getCommunicationsByTaskId(taskId: string): Promise<CommunicationLog[]> {
    const { data } = await api.get(`${BASE_URL}/communications/by-task/${taskId}`);
    return data;
  },

  async logCommunication(payload: CommunicationLogCreate): Promise<CommunicationLog> {
    const { data } = await api.post(`${BASE_URL}/communications`, payload);
    return data;
  },

  async updateCommunication(logId: string, payload: Partial<CommunicationLog>): Promise<CommunicationLog> {
    const { data } = await api.patch(`${BASE_URL}/communications/${logId}`, payload);
    return data;
  },

  // ============================================================
  // Email Sending
  // ============================================================

  async getSentEmailsByClaimId(claimId: string): Promise<SentEmail[]> {
    const { data } = await api.get(`${BASE_URL}/emails/by-claim/${claimId}`);
    return data;
  },

  async getSentEmailsByTaskId(taskId: string): Promise<SentEmail[]> {
    const { data } = await api.get(`${BASE_URL}/emails/by-task/${taskId}`);
    return data;
  },

  async sendEmail(payload: SendEmailRequest): Promise<SentEmail> {
    const { data } = await api.post(`${BASE_URL}/emails/send`, payload);
    return data;
  },

  async sendFromTemplate(payload: SendFromTemplateRequest): Promise<SentEmail> {
    const { data } = await api.post(`${BASE_URL}/emails/send-from-template`, payload);
    return data;
  },

  async generateAIEmail(payload: GenerateAIEmailRequest): Promise<GenerateAIEmailResponse> {
    const { data } = await api.post(`${BASE_URL}/emails/generate-ai`, payload);
    return data;
  },

  async getClaimCompanies(claimId: string): Promise<{
    rebuild_company_id?: string;
    rebuild_company_name?: string;
    wm_company_id?: string;
    wm_company_name?: string;
  }> {
    const { data } = await api.get(`${BASE_URL}/claim-companies/${claimId}`);
    return data;
  },

  async markReply(emailId: string, replySummary?: string): Promise<SentEmail> {
    const { data } = await api.post(`${BASE_URL}/emails/${emailId}/mark-reply`, {
      reply_summary: replySummary,
    });
    return data;
  },

  async testSmtpConnection(accountId?: string): Promise<{ success: boolean; message: string }> {
    const { data } = await api.post(`${BASE_URL}/emails/test-smtp`, null, {
      params: { account_id: accountId },
    });
    return data;
  },

  async checkReplies(accountId?: string): Promise<{
    accounts_checked: number;
    replies_found: number;
    errors: Array<{ account: string; error: string }>;
  }> {
    const { data } = await api.post(`${BASE_URL}/emails/check-replies`, null, {
      params: { account_id: accountId },
    });
    return data;
  },
};
