/**
 * Contract, Template, ClaimCompany, and Signing API service
 */

import api, { publicApi } from './api';
import type {
  ContractTemplate,
  ContractInstance,
  ClaimCompany,
  ContractViewData,
  ContractFieldViewData,
  FieldSignCompany,
  FieldMappingItem,
  FieldMappingResponse,
  PrefillPreviewData,
  ClaimContractDashboardData,
  OnsiteAddress,
  OnsiteCompany,
  OnsiteForm,
  OnsiteSignedContract,
  SigningPurpose,
} from '../types/contract';

// ============================================================
// Contract Templates
// ============================================================

/** Signed contracts of a client's waiting for the office to put them on a claim */
export const unassignedContractService = {
  async list(clientId: string) {
    const { data } = await api.get(`/api/contracts/clients/${clientId}/unassigned`);
    return data as { contracts: ContractInstance[]; total: number };
  },

  async assign(contractId: string, claimId: string) {
    const { data } = await api.put(`/api/contracts/contracts/${contractId}/claim`, { claim_id: claimId });
    return data as ContractInstance;
  },
};

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

  // file_url is a storage path, not a browsable URL — go through the backend proxy.
  async getPdfBlob(id: string) {
    const { data } = await api.get(`/api/contracts/templates/${id}/pdf`, {
      responseType: 'blob',
    });
    return new Blob([data], { type: 'application/pdf' });
  },

  async openPdf(id: string) {
    // Open the tab synchronously so the popup blocker doesn't swallow it after the await.
    const win = window.open('', '_blank');
    try {
      const url = URL.createObjectURL(await this.getPdfBlob(id));
      if (win) {
        win.location.href = url;
      } else {
        window.open(url, '_blank');
      }
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (err) {
      win?.close();
      throw err;
    }
  },

  async getFieldMappings(id: string) {
    const { data } = await api.get(`/api/contracts/templates/${id}/field-mappings`);
    return data as FieldMappingResponse;
  },

  async updateFieldMappings(id: string, fieldMappings: FieldMappingItem[]) {
    const { data } = await api.put(`/api/contracts/templates/${id}/field-mappings`, {
      field_mappings: fieldMappings,
    });
    return data;
  },
};

// ============================================================
// Contract Instances
// ============================================================

export const contractInstanceService = {
  async addCompanySignature(contractId: string, payload: {
    signature_fields: Record<string, string>;
    signature_type: 'drawn' | 'typed';
    today: string;
    consent_agreed: boolean;
    consent_text: string;
  }) {
    // The sheet says what went wrong itself
    const { data } = await api.post(`/api/contracts/contracts/${contractId}/company-signature`, payload, {
      suppressErrorNotification: true,
    });
    return data as ContractInstance;
  },

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
    prefill_overrides?: Record<string, Record<string, string | null>>;
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

  async sendEmail(claimId: string, contractId: string, payload: {
    emails: string[];
    cc?: string[];
    bcc?: string[];
    message?: string;
    template_key?: string;
    origin_url?: string;
  }) {
    const { data } = await api.post(
      `/api/contracts/claims/${claimId}/contracts/${contractId}/send-email`,
      payload,
    );
    return data as { message: string; emails: string[]; signing_url: string };
  },

  async void(claimId: string, contractId: string) {
    const { data } = await api.post(
      `/api/contracts/claims/${claimId}/contracts/${contractId}/void`
    );
    return data;
  },

  async delete(claimId: string, contractId: string) {
    const { data } = await api.delete(
      `/api/contracts/claims/${claimId}/contracts/${contractId}`
    );
    return data;
  },

  async getPrefillPreview(
    claimId: string,
    templateId: string,
    clientId: string,
    companyId: string,
  ) {
    const { data } = await api.get(`/api/contracts/claims/${claimId}/prefill-preview`, {
      params: { template_id: templateId, client_id: clientId, company_id: companyId },
    });
    return data as PrefillPreviewData;
  },

  async getDashboard(claimId: string) {
    const { data } = await api.get(`/api/contracts/claims/${claimId}/dashboard`);
    return data as ClaimContractDashboardData;
  },

  async sendReminder(claimId: string, contractId: string, payload: {
    emails: string[];
    message?: string;
    template_key?: string;
    origin_url?: string;
  }) {
    const { data } = await api.post(
      `/api/contracts/claims/${claimId}/contracts/${contractId}/send-reminder`,
      payload,
    );
    return data as { message: string; emails: string[] };
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
    const { data } = await publicApi.get(`/api/sign/${token}`);
    return data as ContractViewData;
  },

  async sign(token: string, payload: {
    signer_name: string;
    signer_role: string;
    signature_image: string;
    signature_type?: 'drawn' | 'typed';
    typed_name?: string;
    signature_fields?: Record<string, string>;
    signer_field_values?: Record<string, string>;
    consent_agreed?: boolean;
    consent_text?: string;
  }) {
    const { data } = await publicApi.post(`/api/sign/${token}`, payload);
    return data;
  },

  async sendSignedCopy(token: string, emails: string[]) {
    const { data } = await publicApi.post(`/api/sign/${token}/send-copy`, { emails });
    return data as { message: string; emails: string[] };
  },
};

// ============================================================
// Field Signing API (signed in - iPad field flow)
// ============================================================

export const fieldSigningService = {
  async getCompanies() {
    const { data } = await api.get('/api/field-sign/companies');
    return data as { companies: FieldSignCompany[] };
  },

  async getCompanyContracts(companyId: string) {
    const { data } = await api.get(`/api/field-sign/companies/${companyId}/contracts`);
    return data as { contracts: ContractInstance[] };
  },

  async getCompanyTemplates(companyId: string) {
    const { data } = await api.get(`/api/field-sign/companies/${companyId}/templates`);
    return data as { templates: ContractTemplate[] };
  },

  async createContract(payload: {
    template_id: string;
    company_id: string;
    title?: string;
    token_expires_days?: number;
  }) {
    const { data } = await api.post('/api/field-sign/create', payload);
    return data as ContractInstance;
  },

  async getContractView(token: string) {
    const { data } = await api.get(`/api/field-sign/${token}/view`);
    return data as ContractFieldViewData;
  },

  async updatePrefill(token: string, prefillData: Record<string, Record<string, string | null>>) {
    const { data } = await api.put(`/api/field-sign/${token}/prefill`, { prefill_data: prefillData });
    return data as { message: string; contract_id: string };
  },

  async sendEmail(token: string, emails: string[]) {
    const { data } = await api.post(`/api/field-sign/${token}/send-email`, { emails });
    return data as { message: string; emails: string[] };
  },
};

// ============================================================
// On-site signing (signed in, from the field)
// ============================================================

interface OnsiteTemplateChoice {
  template_id: string;
  company_id: string;
}

export const onsiteSigningService = {
  async getCompanies(purpose: SigningPurpose) {
    const { data } = await api.get('/api/onsite-signing/companies', { params: { purpose } });
    return data as { companies: OnsiteCompany[] };
  },

  async getForm(payload: OnsiteTemplateChoice & { client_id?: string; address?: OnsiteAddress }) {
    const { data } = await api.post('/api/onsite-signing/form', payload);
    return data as OnsiteForm;
  },

  async preview(payload: OnsiteTemplateChoice & { answers: Record<string, string>; today: string }) {
    const { data } = await api.post('/api/onsite-signing/preview', payload, { responseType: 'blob' });
    return data as Blob;
  },

  async sign(payload: OnsiteTemplateChoice & {
    client_id?: string;
    address?: OnsiteAddress;
    answers: Record<string, string>;
    today: string;
    signer_name: string;
    signature_fields: Record<string, string>;
    consent_agreed: boolean;
    consent_text: string;
  }) {
    const { data } = await api.post('/api/onsite-signing/contracts', payload);
    return data as OnsiteSignedContract;
  },

  async email(contractId: string, emails: string[]) {
    const { data } = await api.post(`/api/onsite-signing/contracts/${contractId}/email`, { emails });
    return data as { message: string; emails: string[] };
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

