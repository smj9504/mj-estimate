/**
 * Email Ingestion API service
 */

import api from './api';
import type {
  EmailAccount,
  EmailAccountCreate,
  EmailAccountUpdate,
  EmailAccountOAuthConnect,
  EmailAccountTestResult,
  IngestionLog,
  BatchPollResult,
  PollResult,
  IngestionStats,
  ManualAssignRequest,
  SkipRequest,
  ReceivedEmail,
  ReceivedEmailDetail,
  ReceivedEmailList,
  InboxCheckResult,
} from '../types/emailIngestion';

const BASE = '/api/email-ingestion';

export const emailIngestionService = {
  // ============================================================
  // Account Management
  // ============================================================

  /** mine: only the caller's own mailboxes (My Profile) */
  async listAccounts(opts?: { mine?: boolean }) {
    const { data } = await api.get(`${BASE}/accounts`, { params: opts?.mine ? { mine: true } : undefined });
    return data as EmailAccount[];
  },

  async getAccount(id: string) {
    const { data } = await api.get(`${BASE}/accounts/${id}`);
    return data as EmailAccount;
  },

  async createAccount(payload: EmailAccountCreate, opts?: { mine?: boolean }) {
    const { data } = await api.post(`${BASE}/accounts`, payload, { params: opts?.mine ? { mine: true } : undefined });
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

  // OAuth
  async getOAuthUrl() {
    const { data } = await api.get(`${BASE}/oauth/authorize`);
    return data as { authorization_url: string; state: string };
  },

  async connectOAuth(payload: EmailAccountOAuthConnect, opts?: { mine?: boolean }) {
    const { data } = await api.post(`${BASE}/oauth/callback`, payload, { params: opts?.mine ? { mine: true } : undefined });
    return data as EmailAccount;
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

  async listLogs(params?: {
    status?: string;
    account_id?: string;
    search?: string;
    limit?: number;
    offset?: number;
  }) {
    const { data } = await api.get(`${BASE}/logs`, { params });
    return data as IngestionLog[];
  },

  async listPendingLogs() {
    const { data } = await api.get(`${BASE}/logs/pending`);
    return data as IngestionLog[];
  },

  /** Received emails whose attachment was stored, for one claim. */
  async listLogsByClaim(claimId: string) {
    const { data } = await api.get(`${BASE}/logs`, {
      params: { claim_id: claimId, has_attachment: true, limit: 200 },
    });
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

  // ============================================================
  // Received emails (all inbound mail)
  // ============================================================

  async listReceived(params?: {
    claim_id?: string;
    account_id?: string;
    unmatched?: boolean;
    search?: string;
    limit?: number;
    offset?: number;
  }) {
    const { data } = await api.get(`${BASE}/received`, { params });
    return data as ReceivedEmailList;
  },

  async getReceived(id: string) {
    const { data } = await api.get(`${BASE}/received/${id}`);
    return data as ReceivedEmailDetail;
  },

  /** Link to a claim, or pass null to unlink. */
  async assignReceived(id: string, claimId: string | null) {
    const { data } = await api.post(`${BASE}/received/${id}/assign`, { claim_id: claimId });
    return data as ReceivedEmail;
  },

  /**
   * Search every connected inbox for the claim's mail now instead of at the
   * next morning poll — IMAP round-trips per account, so it can take a while.
   */
  async checkClaimInbox(claimId: string) {
    const { data } = await api.post(`${BASE}/claims/${claimId}/check-inbox`, null, { timeout: 120000 });
    return data as InboxCheckResult;
  },
};
