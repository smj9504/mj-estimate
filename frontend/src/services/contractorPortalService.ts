/**
 * Contractor Portal API service (public, no auth required)
 */

import api from './api';

const BASE_URL = '/api/contractor-portal';

export interface ClaimListItem {
  claim_id: string;
  claim_number?: string;
  insurance_company?: string;
  client_name?: string;
  address?: string;
  city?: string;
  company_name?: string;
  role?: string;
  date_of_loss?: string;
  expected_amount?: number;
  received_total?: number;
  remaining?: number;
}

export interface ContractorPayment {
  id: string;
  payment_type?: string;
  payment_category?: string;
  amount?: number;
  check_number?: string;
  check_date?: string;
  received_date?: string;
  pa_fee_deducted?: boolean;
  pa_fee_amount?: number;
  gross_amount?: number;
  check_photo_file_id?: string;
  source?: string;
  notes?: string;
  created_at?: string;
}

export interface PaymentSummary {
  payments: ContractorPayment[];
  total_by_category: Record<string, number>;
  grand_total: number;
  expected: {
    rcv?: number;
    acv?: number;
    depreciation?: number;
    deductible?: number;
    pa_fee_percentage?: number;
  };
}

export interface ContractorPaymentCreate {
  payment_type: string;
  payment_category: string;
  amount: number;
  check_number?: string;
  check_date?: string;
  received_date?: string;
  pa_fee_deducted?: boolean;
  pa_fee_amount?: number;
  gross_amount?: number;
  memo?: string;
  check_photo_file_id?: string;
  company_id?: string;
}

export const contractorPortalService = {
  async validateToken(token: string): Promise<{ valid: boolean; contact_name?: string; contact_id?: string }> {
    const { data } = await api.get(`${BASE_URL}/${token}/validate`);
    return data;
  },

  async getClaims(token: string): Promise<ClaimListItem[]> {
    const { data } = await api.get(`${BASE_URL}/${token}/claims`);
    return data;
  },

  async getPayments(token: string, claimId: string): Promise<PaymentSummary> {
    const { data } = await api.get(`${BASE_URL}/${token}/claims/${claimId}/payments`);
    return data;
  },

  async createPayment(token: string, claimId: string, payload: ContractorPaymentCreate): Promise<ContractorPayment> {
    const { data } = await api.post(`${BASE_URL}/${token}/claims/${claimId}/payments`, payload);
    return data;
  },

  async uploadCheckPhoto(token: string, file: File): Promise<{ file_id: string; filename: string }> {
    const formData = new FormData();
    formData.append('file', file);
    const { data } = await api.post(`${BASE_URL}/${token}/upload-check-photo`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
      timeout: 60000,
    });
    return data;
  },

  // Auth-based endpoints (for logged-in contractors)
  async getClaimsByCompany(companyId: string): Promise<ClaimListItem[]> {
    const { data } = await api.get(`${BASE_URL}/auth/claims`, { params: { company_id: companyId } });
    return data;
  },

  async getPaymentsByCompany(claimId: string, companyId: string): Promise<PaymentSummary> {
    const { data } = await api.get(`${BASE_URL}/auth/claims/${claimId}/payments`, { params: { company_id: companyId } });
    return data;
  },

  async createPaymentByCompany(claimId: string, payload: ContractorPaymentCreate): Promise<ContractorPayment> {
    const { data } = await api.post(`${BASE_URL}/auth/claims/${claimId}/payments`, payload);
    return data;
  },

  async uploadCheckPhotoAuth(file: File): Promise<{ file_id: string; filename: string }> {
    const formData = new FormData();
    formData.append('file', file);
    const { data } = await api.post(`${BASE_URL}/auth/upload-check-photo`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
      timeout: 60000,
    });
    return data;
  },

  // Admin endpoints
  async createToken(companyContactId: string): Promise<{ id: string; token: string; contact_name?: string; portal_url?: string }> {
    const { data } = await api.post(`${BASE_URL}/admin/tokens`, { company_contact_id: companyContactId });
    return data;
  },

  async listTokens(companyId?: string): Promise<any[]> {
    const { data } = await api.get(`${BASE_URL}/admin/tokens`, { params: { company_id: companyId } });
    return data;
  },

  async deactivateToken(tokenId: string): Promise<void> {
    await api.delete(`${BASE_URL}/admin/tokens/${tokenId}`);
  },
};
