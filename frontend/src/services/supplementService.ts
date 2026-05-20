/**
 * Supplement API service
 */

import api from './api';
import type {
  SupplementRequest,
  SupplementRequestCreate,
  BidItemEstimate,
  BidItemEstimateCreate,
  SupplementFollowUp,
  SupplementDashboardStats,
} from '../types/supplement';
import type { ClaimNegotiation } from '../types/client';

const BASE_URL = '/api/supplements';

export const supplementService = {
  // Supplement Requests
  async list(params?: {
    status?: string;
    claim_id?: string;
    priority?: string;
    page?: number;
    page_size?: number;
  }): Promise<SupplementRequest[]> {
    const { data } = await api.get(BASE_URL, { params });
    return data;
  },

  async getPendingReview(): Promise<SupplementRequest[]> {
    const { data } = await api.get(`${BASE_URL}/pending-review`);
    return data;
  },

  async getByClaim(claimId: string): Promise<SupplementRequest[]> {
    const { data } = await api.get(`${BASE_URL}/by-claim/${claimId}`);
    return data;
  },

  async get(id: string): Promise<SupplementRequest> {
    const { data } = await api.get(`${BASE_URL}/${id}`);
    return data;
  },

  async create(payload: SupplementRequestCreate): Promise<SupplementRequest> {
    const { data } = await api.post(BASE_URL, payload);
    return data;
  },

  async update(id: string, payload: Partial<SupplementRequest>): Promise<SupplementRequest> {
    const { data } = await api.patch(`${BASE_URL}/${id}`, payload);
    return data;
  },

  async delete(id: string): Promise<void> {
    await api.delete(`${BASE_URL}/${id}`);
  },

  async getStats(): Promise<SupplementDashboardStats> {
    const { data } = await api.get(`${BASE_URL}/stats`);
    return data;
  },

  // Bid Item Estimates
  async listBidItems(supplementId: string): Promise<BidItemEstimate[]> {
    const { data } = await api.get(`${BASE_URL}/${supplementId}/bid-items`);
    return data;
  },

  async createBidItem(supplementId: string, payload: BidItemEstimateCreate): Promise<BidItemEstimate> {
    const { data } = await api.post(`${BASE_URL}/${supplementId}/bid-items`, payload);
    return data;
  },

  async updateBidItem(supplementId: string, itemId: string, payload: Partial<BidItemEstimate>): Promise<BidItemEstimate> {
    const { data } = await api.patch(`${BASE_URL}/${supplementId}/bid-items/${itemId}`, payload);
    return data;
  },

  async deleteBidItem(supplementId: string, itemId: string): Promise<void> {
    await api.delete(`${BASE_URL}/${supplementId}/bid-items/${itemId}`);
  },

  // Insurance Estimate (latest negotiation for claim)
  async getInsuranceEstimate(claimId: string): Promise<ClaimNegotiation | null> {
    const { data } = await api.get(`${BASE_URL}/insurance-estimate/${claimId}`);
    return data;
  },

  // Follow-ups
  async listFollowups(supplementId: string): Promise<SupplementFollowUp[]> {
    const { data } = await api.get(`${BASE_URL}/${supplementId}/followups`);
    return data;
  },

  async createFollowup(supplementId: string, payload: Partial<SupplementFollowUp>): Promise<SupplementFollowUp> {
    const { data } = await api.post(`${BASE_URL}/${supplementId}/followups`, payload);
    return data;
  },

  async updateFollowup(supplementId: string, followupId: string, payload: Partial<SupplementFollowUp>): Promise<SupplementFollowUp> {
    const { data } = await api.patch(`${BASE_URL}/${supplementId}/followups/${followupId}`, payload);
    return data;
  },

  // Send to PA
  async getPaInfo(supplementId: string): Promise<{
    pa_name: string;
    pa_email: string;
    pa_phone: string;
    pa_company: string;
    has_public_adjuster: boolean;
    claim_number: string;
    insurance_company: string;
    property_address: string;
    homeowner_name: string;
    cc_emails: Array<{ name: string; email: string }>;
  }> {
    const { data } = await api.get(`${BASE_URL}/${supplementId}/pa-info`);
    return data;
  },

  async generatePaEmail(supplementId: string, customNotes?: string): Promise<{
    subject: string;
    body_html: string;
  }> {
    const { data } = await api.post(
      `${BASE_URL}/${supplementId}/generate-pa-email`,
      null,
      { params: { custom_notes: customNotes || '' } },
    );
    return data;
  },

  async sendToPa(supplementId: string, payload: {
    to_addresses: string[];
    cc_addresses?: string[];
    subject: string;
    body_html: string;
    pa_name?: string;
    email_account_id?: string;
  }): Promise<{ success: boolean; email_id: string; attachments_count: number; status: string }> {
    const { data } = await api.post(`${BASE_URL}/${supplementId}/send-to-pa`, payload);
    return data;
  },
};
