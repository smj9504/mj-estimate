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

  async resolveTask(taskId: string, resolutionNotes?: string): Promise<FollowUpTask> {
    const { data } = await api.post(`${BASE_URL}/tasks/${taskId}/resolve`, null, {
      params: { resolution_notes: resolutionNotes },
    });
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
};
