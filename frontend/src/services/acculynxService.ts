/**
 * AccuLynx integration service (Simple Work -> AccuLynx, outbound only).
 *
 * Self-contained: to remove the AccuLynx feature, delete this file and
 * frontend/src/components/common/AccuLynxSyncButton.tsx, then remove the
 * single import + JSX line that renders <AccuLynxSyncButton /> in each
 * page (search for "AccuLynx:").
 */
import api from './api';

const BASE_URL = '/api/integrations/acculynx';

export interface AccuLynxJobSearchItem {
  id: string;
  job_number?: string;
  job_name?: string;
  address?: string;
  current_milestone?: string;
}

export interface AccuLynxJobSearchResponse {
  items: AccuLynxJobSearchItem[];
  count: number;
}

export interface AccuLynxLink {
  claim_id: string;
  acculynx_job_id: string;
  acculynx_job_number?: string;
  linked_at: string;
}

export interface AccuLynxSyncFileResult {
  source_table: string;
  source_id: string;
  filename?: string;
  status: 'success' | 'failed' | 'skipped';
  error_message?: string;
}

export interface AccuLynxSyncResult {
  claim_id: string;
  acculynx_job_id: string;
  total_candidates: number;
  already_synced: number;
  succeeded: number;
  failed: number;
  results: AccuLynxSyncFileResult[];
}

export interface AccuLynxContactSearchItem {
  id: string;
  first_name?: string;
  last_name?: string;
  company_name?: string;
  email?: string;
  phone?: string;
  address?: string;
}

export interface AccuLynxContactSearchResponse {
  items: AccuLynxContactSearchItem[];
  count: number;
}

export interface AccuLynxUserItem {
  id: string;
  display_name: string;
  role?: string;
}

export interface AccuLynxAddressInput {
  street1: string;
  street2?: string;
  city: string;
  state: string;
  zip_code: string;
  country?: string;
}

export interface AccuLynxNewContactInput {
  first_name?: string;
  last_name?: string;
  email?: string;
  phone?: string;
  address?: AccuLynxAddressInput;
}

export interface AccuLynxCreateLeadRequest {
  contact_id?: string;
  new_contact?: AccuLynxNewContactInput;
  address?: AccuLynxAddressInput;
  notes?: string;
  representative_user_id?: string;
}

export interface AccuLynxContactLink {
  client_id: string;
  acculynx_contact_id: string;
  first_name?: string;
  last_name?: string;
  company_name?: string;
}

export const acculynxService = {
  searchJobs: async (query: string): Promise<AccuLynxJobSearchResponse> => {
    const response = await api.get(`${BASE_URL}/jobs/search`, { params: { q: query } });
    return response.data;
  },

  getLink: async (claimId: string): Promise<AccuLynxLink | null> => {
    try {
      const response = await api.get(`${BASE_URL}/claims/${claimId}/link`);
      return response.data;
    } catch (error: any) {
      if (error.response?.status === 404) {
        return null;
      }
      throw error;
    }
  },

  linkClaim: async (claimId: string, acculynxJobId: string, acculynxJobNumber?: string): Promise<AccuLynxLink> => {
    const response = await api.post(`${BASE_URL}/claims/${claimId}/link`, {
      acculynx_job_id: acculynxJobId,
      acculynx_job_number: acculynxJobNumber,
    });
    return response.data;
  },

  unlinkClaim: async (claimId: string): Promise<void> => {
    await api.delete(`${BASE_URL}/claims/${claimId}/link`);
  },

  sync: async (claimId: string): Promise<AccuLynxSyncResult> => {
    const response = await api.post(`${BASE_URL}/claims/${claimId}/sync`, {}, { timeout: 120000 });
    return response.data;
  },

  getSyncStatus: async (claimId: string) => {
    const response = await api.get(`${BASE_URL}/claims/${claimId}/sync-status`);
    return response.data;
  },

  searchContacts: async (query: string): Promise<AccuLynxContactSearchResponse> => {
    const response = await api.get(`${BASE_URL}/contacts/search`, { params: { q: query } });
    return response.data;
  },

  getUsers: async (): Promise<AccuLynxUserItem[]> => {
    const response = await api.get(`${BASE_URL}/users`);
    return response.data;
  },

  createLead: async (claimId: string, payload: AccuLynxCreateLeadRequest): Promise<AccuLynxLink> => {
    const response = await api.post(`${BASE_URL}/claims/${claimId}/create-lead`, payload, { timeout: 30000 });
    return response.data;
  },

  getClientContactLink: async (clientId: string): Promise<AccuLynxContactLink | null> => {
    try {
      const response = await api.get(`${BASE_URL}/clients/${clientId}/contact-link`);
      return response.data;
    } catch (error: any) {
      if (error.response?.status === 404) {
        return null;
      }
      throw error;
    }
  },
};

export default acculynxService;
