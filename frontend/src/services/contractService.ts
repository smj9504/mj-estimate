/**
 * Contract, Template, ClaimCompany, and Signing API service
 */

import api from './api';
import type {
  ContractTemplate,
  ContractInstance,
  ClaimCompany,
  ContractViewData,
} from '../types/contract';

// ============================================================
// Contract Templates
// ============================================================

export const contractTemplateService = {
  async list(companyId?: string) {
    const params = companyId ? { company_id: companyId } : {};
    const { data } = await api.get('/api/contracts/templates', { params });
    return data as { templates: ContractTemplate[]; total: number };
  },

  async getById(id: string) {
    const { data } = await api.get(`/api/contracts/templates/${id}`);
    return data as ContractTemplate;
  },

  async create(formData: FormData) {
    const { data } = await api.post('/api/contracts/templates', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
    return data;
  },

  async update(id: string, payload: Partial<ContractTemplate>) {
    const { data } = await api.put(`/api/contracts/templates/${id}`, payload);
    return data;
  },

  async uploadPdf(id: string, file: File) {
    const formData = new FormData();
    formData.append('file', file);
    const { data } = await api.post(`/api/contracts/templates/${id}/upload`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
    return data;
  },

  async delete(id: string) {
    const { data } = await api.delete(`/api/contracts/templates/${id}`);
    return data;
  },
};

// ============================================================
// Contract Instances
// ============================================================

export const contractInstanceService = {
  async listByClaim(claimId: string) {
    const { data } = await api.get(`/api/contracts/claims/${claimId}/contracts`);
    return data as { contracts: ContractInstance[]; total: number };
  },

  async create(claimId: string, payload: {
    template_id: string;
    claim_id: string;
    client_id: string;
    company_id: string;
    title?: string;
    notes?: string;
    token_expires_days?: number;
  }) {
    const { data } = await api.post(`/api/contracts/claims/${claimId}/contracts`, payload);
    return data;
  },

  async send(claimId: string, contractId: string) {
    const { data } = await api.post(
      `/api/contracts/claims/${claimId}/contracts/${contractId}/send`
    );
    return data as { contract: ContractInstance; signing_url: string; signing_token: string };
  },

  async void(claimId: string, contractId: string) {
    const { data } = await api.post(
      `/api/contracts/claims/${claimId}/contracts/${contractId}/void`
    );
    return data;
  },
};

// ============================================================
// Claim Companies
// ============================================================

export const claimCompanyService = {
  async listByClaim(claimId: string) {
    const { data } = await api.get(`/api/contracts/claims/${claimId}/companies`);
    return data as { companies: ClaimCompany[]; total: number };
  },

  async assign(claimId: string, payload: {
    company_id: string;
    role: string;
    is_primary?: boolean;
    notes?: string;
  }) {
    const { data } = await api.post(`/api/contracts/claims/${claimId}/companies`, payload);
    return data;
  },

  async remove(claimId: string, assignmentId: string) {
    const { data } = await api.delete(`/api/contracts/claims/${claimId}/companies/${assignmentId}`);
    return data;
  },
};

// ============================================================
// Public Signing API (no auth)
// ============================================================

export const signingService = {
  async getContract(token: string) {
    const { data } = await api.get(`/api/sign/${token}`);
    return data as ContractViewData;
  },

  async sign(token: string, payload: {
    signer_name: string;
    signer_role: string;
    signature_image: string;
  }) {
    const { data } = await api.post(`/api/sign/${token}`, payload);
    return data;
  },
};

// ============================================================
// Claim - Plumber Report Link
// ============================================================

export const claimPlumberReportService = {
  async link(claimId: string, plumberReportId: string | null) {
    const { data } = await api.put(
      `/api/contracts/claims/${claimId}/plumber-report`,
      null,
      { params: { plumber_report_id: plumberReportId } }
    );
    return data;
  },
};
