/**
 * Siding Estimate API service
 */

import api from './api';
import type {
  SidingEstimate,
  SidingEstimateCreate,
  SidingEstimateUpdate,
  SidingEstimateListResponse,
  SidingEstimateLineItem,
  EagleViewParseResponse,
} from '../types/sidingEstimate';

const BASE_URL = '/api/siding-estimates';

export const sidingEstimateService = {
  // ── EagleView Upload ──

  async uploadEagleView(file: File): Promise<EagleViewParseResponse> {
    const formData = new FormData();
    formData.append('file', file);
    const { data } = await api.post(`${BASE_URL}/upload-eagleview`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
    return data as EagleViewParseResponse;
  },

  // ── CRUD ──

  async list(params?: {
    claim_id?: string;
    company_id?: string;
    status?: string;
    search?: string;
    page?: number;
    page_size?: number;
  }) {
    const { data } = await api.get(BASE_URL, { params });
    return data as SidingEstimateListResponse;
  },

  async getById(id: string) {
    const { data } = await api.get(`${BASE_URL}/${id}`);
    return data as SidingEstimate;
  },

  async create(payload: SidingEstimateCreate) {
    const { data } = await api.post(BASE_URL, payload);
    return data as SidingEstimate;
  },

  async update(id: string, payload: SidingEstimateUpdate) {
    const { data } = await api.put(`${BASE_URL}/${id}`, payload);
    return data as SidingEstimate;
  },

  async delete(id: string) {
    const { data } = await api.delete(`${BASE_URL}/${id}`);
    return data;
  },

  // ── Line Items ──

  async addLineItem(estimateId: string, item: Partial<SidingEstimateLineItem>) {
    const { data } = await api.post(`${BASE_URL}/${estimateId}/line-items`, item);
    return data as SidingEstimateLineItem;
  },

  async updateLineItem(estimateId: string, itemId: string, item: Partial<SidingEstimateLineItem>) {
    const { data } = await api.put(`${BASE_URL}/${estimateId}/line-items/${itemId}`, item);
    return data as SidingEstimateLineItem;
  },

  async deleteLineItem(estimateId: string, itemId: string) {
    const { data } = await api.delete(`${BASE_URL}/${estimateId}/line-items/${itemId}`);
    return data;
  },

  async deletePhase(estimateId: string, phase: number) {
    const { data } = await api.delete(`${BASE_URL}/${estimateId}/phases/${phase}`);
    return data;
  },

  // ── Generate & Calculate ──

  async generate(id: string) {
    const { data } = await api.post(`${BASE_URL}/${id}/generate`);
    return data as SidingEstimate;
  },

  async recalculate(id: string) {
    const { data } = await api.post(`${BASE_URL}/${id}/recalculate`);
    return data as SidingEstimate;
  },

  // ── Phase Labels ──

  async getPhaseLabels() {
    const { data } = await api.get(`${BASE_URL}/phase-labels`);
    return data as Record<number, string>;
  },
};
