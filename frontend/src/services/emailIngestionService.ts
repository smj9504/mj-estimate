/**
 * Email Ingestion API service
 */

import api from './api';
import type {
  EmailAccount,
  EmailAccountCreate,
  EmailAccountUpdate,
  EmailAccountTestResult,
  IngestionLog,
  BatchPollResult,
  PollResult,
  IngestionStats,
  ManualAssignRequest,
  SkipRequest,
} from '../types/emailIngestion';

const BASE = '/api/email-ingestion';

export const emailIngestionService = {
  // ============================================================
  // Account Management
  // ============================================================

  async listAccounts() {
    const { data } = await api.get(`${BASE}/accounts`);
    return data as EmailAccount[];
  },

  async getAccount(id: string) {
    const { data } = await api.get(`${BASE}/accounts/${id}`);
    return data as EmailAccount;
  },

  async createAccount(payload: EmailAccountCreate) {
    const { data } = await api.post(`${BASE}/accounts`, payload);
    return data as EmailAccount;
  },

  async updateAccount(id: string, payload: EmailAccountUpdate) {
    const { data } = await api.put(`${BASE}/accounts/${id}`, payload);
    return data as EmailAccount;
  },

  async deleteAccount(id: string) {
    await api.delete(`${BASE}/accounts/${id}`);
  },

  async testAccount(id: string) {
    const { data } = await api.post(`${BASE}/accounts/${id}/test`);
    return data as EmailAccountTestResult;
  },

  // ============================================================
  // Polling
  // ============================================================

  async pollAll() {
    const { data } = await api.post(`${BASE}/poll`);
    return data as BatchPollResult;
  },

  async pollAccount(accountId: string) {
    const { data } = await api.post(`${BASE}/poll/${accountId}`);
    return data as PollResult;
  },

  // ============================================================
  // Logs
  // ============================================================

  async listLogs(params?: { status?: string; account_id?: string; limit?: number; offset?: number }) {
    const { data } = await api.get(`${BASE}/logs`, { params });
    return data as IngestionLog[];
  },

  async listPendingLogs() {
    const { data } = await api.get(`${BASE}/logs/pending`);
    return data as IngestionLog[];
  },

  async getStats() {
    const { data } = await api.get(`${BASE}/stats`);
    return data as IngestionStats;
  },

  async assignLog(logId: string, payload: ManualAssignRequest) {
    const { data } = await api.post(`${BASE}/logs/${logId}/assign`, payload);
    return data as IngestionLog;
  },

  async skipLog(logId: string, payload: SkipRequest) {
    const { data } = await api.post(`${BASE}/logs/${logId}/skip`, payload);
    return data as IngestionLog;
  },
};
