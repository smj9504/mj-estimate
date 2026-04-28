/**
 * Client, Claim, and ClaimNegotiation API service
 */

import api from './api';
import type {
  Client,
  ClientCreate,
  ClientListItem,
  Claim,
  ClaimCreate,
  ClaimNegotiation,
  ClaimNegotiationCreate,
  PdfExtractionResult,
} from '../types/client';

// ============================================================
// Client API
// ============================================================

export const clientService = {
  async list(params?: { skip?: number; limit?: number; search?: string; is_active?: boolean }) {
    const { data } = await api.get('/api/clients', { params });
    return data as { clients: ClientListItem[]; total: number };
  },

  async search(q: string, limit = 20) {
    const { data } = await api.get('/api/clients/search', { params: { q, limit } });
    return data as { clients: ClientListItem[]; total: number };
  },

  async getById(id: string) {
    const { data } = await api.get(`/api/clients/${id}`);
    return data as Client;
  },

  async create(payload: ClientCreate) {
    const { data } = await api.post('/api/clients', payload);
    return data as Client;
  },

  async update(id: string, payload: Partial<ClientCreate>) {
    const { data } = await api.put(`/api/clients/${id}`, payload);
    return data;
  },

  async delete(id: string) {
    const { data } = await api.delete(`/api/clients/${id}`);
    return data;
  },
};

// ============================================================
// Claim API
// ============================================================

export const claimService = {
  async listByClient(clientId: string) {
    const { data } = await api.get(`/api/clients/${clientId}/claims`);
    return data as { claims: Claim[]; total: number };
  },

  async getById(clientId: string, claimId: string) {
    const { data } = await api.get(`/api/clients/${clientId}/claims/${claimId}`);
    return data as Claim;
  },

  async create(clientId: string, payload: ClaimCreate) {
    const { data } = await api.post(`/api/clients/${clientId}/claims`, payload);
    return data as Claim;
  },

  async update(clientId: string, claimId: string, payload: Partial<ClaimCreate>) {
    const { data } = await api.put(`/api/clients/${clientId}/claims/${claimId}`, payload);
    return data;
  },

  async delete(clientId: string, claimId: string) {
    const { data } = await api.delete(`/api/clients/${clientId}/claims/${claimId}`);
    return data;
  },

  async getDocuments(clientId: string, claimId: string) {
    const { data } = await api.get(`/api/clients/${clientId}/claims/${claimId}/documents`);
    return data;
  },
};

// ============================================================
// ClaimNegotiation API
// ============================================================

export const negotiationService = {
  async listByClaim(clientId: string, claimId: string) {
    const { data } = await api.get(
      `/api/clients/${clientId}/claims/${claimId}/negotiations`
    );
    return data as { negotiations: ClaimNegotiation[]; total: number };
  },

  async create(clientId: string, claimId: string, payload: ClaimNegotiationCreate) {
    const { data } = await api.post(
      `/api/clients/${clientId}/claims/${claimId}/negotiations`,
      payload
    );
    return data as ClaimNegotiation;
  },

  async update(
    clientId: string,
    claimId: string,
    negotiationId: string,
    payload: Partial<ClaimNegotiationCreate>
  ) {
    const { data } = await api.put(
      `/api/clients/${clientId}/claims/${claimId}/negotiations/${negotiationId}`,
      payload
    );
    return data;
  },

  async delete(clientId: string, claimId: string, negotiationId: string) {
    const { data } = await api.delete(
      `/api/clients/${clientId}/claims/${claimId}/negotiations/${negotiationId}`
    );
    return data;
  },

  async extractPdf(clientId: string, claimId: string, file: File) {
    const formData = new FormData();
    formData.append('file', file);
    const { data } = await api.post(
      `/api/clients/${clientId}/claims/${claimId}/negotiations/extract-pdf`,
      formData,
      { headers: { 'Content-Type': 'multipart/form-data' }, timeout: 120000 }
    );
    return data as PdfExtractionResult;
  },
};
