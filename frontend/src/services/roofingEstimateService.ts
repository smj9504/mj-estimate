/**
 * Roofing Estimate API service
 */

import api from './api';
import type {
  RoofingEstimate,
  RoofingEstimateCreate,
  RoofingEstimateListResponse,
  RoofingEstimateUpdate,
  RoofingEstimateHistory,
  RoofingPricingInfo,
  EagleViewParseResult,
} from '../types/roofingEstimate';

const BASE_URL = '/api/roofing-estimates';

export const roofingEstimateService = {
  // ── Pricing info ──

  async getPricingInfo() {
    const { data } = await api.get(`${BASE_URL}/pricing-info`);
    return data as RoofingPricingInfo;
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
    return data as RoofingEstimateListResponse;
  },

  async getById(id: string) {
    const { data } = await api.get(`${BASE_URL}/${id}`);
    return data as RoofingEstimate;
  },

  async create(payload: RoofingEstimateCreate) {
    const { data } = await api.post(BASE_URL, payload);
    return data as RoofingEstimate;
  },

  async update(id: string, payload: RoofingEstimateUpdate) {
    const { data } = await api.put(`${BASE_URL}/${id}`, payload);
    return data as RoofingEstimate;
  },

  async delete(id: string) {
    const { data } = await api.delete(`${BASE_URL}/${id}`);
    return data;
  },

  // ── EagleView Parsing ──

  async parseEagleView(file: File, selectedStructures?: number[]) {
    const formData = new FormData();
    formData.append('file', file);
    const params: Record<string, string> = {};
    if (selectedStructures?.length) {
      params.selected_structures = selectedStructures.join(',');
    }
    const { data } = await api.post(`${BASE_URL}/parse-eagleview`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
      params,
    });
    return data as EagleViewParseResult;
  },

  async applyEagleView(
    id: string,
    file: File,
    selectedFaces?: string[],
    selectedStructures?: number[],
  ) {
    const formData = new FormData();
    formData.append('file', file);
    const params: Record<string, string> = {};
    if (selectedFaces?.length) {
      params.selected_faces = selectedFaces.join(',');
    }
    if (selectedStructures?.length) {
      params.selected_structures = selectedStructures.join(',');
    }
    const { data } = await api.post(
      `${BASE_URL}/${id}/apply-eagleview`,
      formData,
      {
        headers: { 'Content-Type': 'multipart/form-data' },
        params,
      }
    );
    return data as RoofingEstimate;
  },

  // ── Calculation ──

  async calculate(id: string, payload?: RoofingEstimateUpdate) {
    const { data } = await api.post(`${BASE_URL}/${id}/calculate`, payload || {});
    return data as RoofingEstimate;
  },

  // ── Clone ──

  async clone(id: string) {
    const { data } = await api.post(`${BASE_URL}/${id}/clone`);
    return data as RoofingEstimate;
  },

  // ── History ──

  async getHistory(id: string) {
    const { data } = await api.get(`${BASE_URL}/${id}/history`);
    return data as RoofingEstimateHistory[];
  },

  // ── Export ──

  async exportPdf(id: string, options?: { show_signature?: boolean; pricing_mode?: string; gutter_separate?: boolean; address?: string }) {
    const params: Record<string, any> = {};
    if (options?.show_signature === false) {
      params.show_signature = false;
    }
    if (options?.pricing_mode) {
      params.pricing_mode = options.pricing_mode;
    }
    if (options?.gutter_separate) {
      params.gutter_separate = true;
    }
    const response = await api.get(`${BASE_URL}/${id}/export/pdf`, {
      responseType: 'blob',
      params,
    });
    const sanitized = (options?.address || '')
      .replace(/[^a-zA-Z0-9\s-]/g, '')
      .trim()
      .replace(/\s+/g, '_');
    const filename = sanitized
      ? `roofing_estimate_${sanitized}.pdf`
      : `roofing_estimate_${id.substring(0, 8)}.pdf`;
    const url = window.URL.createObjectURL(new Blob([response.data]));
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', filename);
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.URL.revokeObjectURL(url);
  },

  async exportInvoice(id: string, options?: {
    completion_date?: string;
    address?: string;
    pricing_mode?: string;
    invoice_date?: string;
    due_date?: string;
    payment_amount?: number;
    payment_date?: string;
  }) {
    const params: Record<string, any> = {};
    if (options?.completion_date) params.completion_date = options.completion_date;
    if (options?.pricing_mode) params.pricing_mode = options.pricing_mode;
    if (options?.invoice_date) params.invoice_date = options.invoice_date;
    if (options?.due_date) params.due_date = options.due_date;
    if (options?.payment_amount) params.payment_amount = options.payment_amount;
    if (options?.payment_date) params.payment_date = options.payment_date;

    const response = await api.get(`${BASE_URL}/${id}/export/invoice`, {
      responseType: 'blob',
      params,
    });
    const sanitized = (options?.address || '')
      .replace(/[^a-zA-Z0-9\s-]/g, '')
      .trim()
      .replace(/\s+/g, '_');
    const filename = sanitized
      ? `roofing_invoice_${sanitized}.pdf`
      : `roofing_invoice_${id.substring(0, 8)}.pdf`;
    const url = window.URL.createObjectURL(new Blob([response.data]));
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', filename);
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.URL.revokeObjectURL(url);
  },

  async exportWarrantyCert(id: string, options?: { completion_date?: string; address?: string }) {
    const params: Record<string, any> = {};
    if (options?.completion_date) params.completion_date = options.completion_date;

    const response = await api.get(`${BASE_URL}/${id}/export/warranty-cert`, {
      responseType: 'blob',
      params,
    });
    const sanitized = (options?.address || '')
      .replace(/[^a-zA-Z0-9\s-]/g, '')
      .trim()
      .replace(/\s+/g, '_');
    const filename = sanitized
      ? `roofing_warranty_${sanitized}.pdf`
      : `roofing_warranty_${id.substring(0, 8)}.pdf`;
    const url = window.URL.createObjectURL(new Blob([response.data]));
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', filename);
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.URL.revokeObjectURL(url);
  },
};
