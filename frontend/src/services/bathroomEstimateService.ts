/**
 * Bathroom Estimate API service
 */

import api from './api';
import type {
  BathroomEstimate,
  BathroomEstimateCreate,
  BathroomEstimateListResponse,
  BathroomEstimateUpdate,
  BathroomEstimateHistory,
  BathroomPricingInfo,
} from '../types/bathroomEstimate';

const BASE_URL = '/api/bathroom-estimates';

export const bathroomEstimateService = {
  // ── Pricing info ──

  async getPricingInfo() {
    const { data } = await api.get(`${BASE_URL}/pricing-info`);
    return data as BathroomPricingInfo;
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
    return data as BathroomEstimateListResponse;
  },

  async getById(id: string) {
    const { data } = await api.get(`${BASE_URL}/${id}`);
    return data as BathroomEstimate;
  },

  async create(payload: BathroomEstimateCreate) {
    const { data } = await api.post(BASE_URL, payload);
    return data as BathroomEstimate;
  },

  async update(id: string, payload: BathroomEstimateUpdate) {
    const { data } = await api.put(`${BASE_URL}/${id}`, payload);
    return data as BathroomEstimate;
  },

  async delete(id: string) {
    const { data } = await api.delete(`${BASE_URL}/${id}`);
    return data;
  },

  // ── Calculation ──

  async calculate(id: string, payload?: BathroomEstimateUpdate) {
    const { data } = await api.post(`${BASE_URL}/${id}/calculate`, payload || {});
    return data as BathroomEstimate;
  },

  // ── Clone ──

  async clone(id: string) {
    const { data } = await api.post(`${BASE_URL}/${id}/clone`);
    return data as BathroomEstimate;
  },

  // ── History ──

  async getHistory(id: string) {
    const { data } = await api.get(`${BASE_URL}/${id}/history`);
    return data as BathroomEstimateHistory[];
  },

  // ── Overview Note Generation ──

  async generateOverview(id: string) {
    const { data } = await api.post(`${BASE_URL}/${id}/generate-overview`);
    return data as { overview_text: string };
  },

  // ── Export ──

  async exportPdf(id: string, options?: {
    show_signature?: boolean;
    sketch_image?: string;
    show_breakdown_prices?: boolean;
    address?: string;
  }) {
    const sanitized = (options?.address || '')
      .replace(/[^a-zA-Z0-9\s-]/g, '')
      .trim()
      .replace(/\s+/g, '_');
    const filename = sanitized
      ? `bathroom_estimate_${sanitized}.pdf`
      : `bathroom_estimate_${id.substring(0, 8)}.pdf`;

    const downloadBlob = (data: any) => {
      const url = window.URL.createObjectURL(new Blob([data]));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', filename);
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    };

    if (options?.sketch_image) {
      const response = await api.post(`${BASE_URL}/${id}/export/pdf`, {
        sketch_image: options.sketch_image,
        show_signature: options?.show_signature ?? true,
        show_breakdown_prices: options?.show_breakdown_prices ?? true,
      }, {
        responseType: 'blob',
      });
      downloadBlob(response.data);
    } else {
      const params: Record<string, any> = {};
      if (options?.show_signature === false) {
        params.show_signature = false;
      }
      if (options?.show_breakdown_prices === false) {
        params.show_breakdown_prices = false;
      }
      const response = await api.get(`${BASE_URL}/${id}/export/pdf`, {
        responseType: 'blob',
        params,
      });
      downloadBlob(response.data);
    }
  },

  // ── Export Validation ──

  async validateForExport(id: string) {
    const { data } = await api.get(`${BASE_URL}/${id}/export/validate`);
    return data as { valid: boolean; warnings: string[] };
  },
};
