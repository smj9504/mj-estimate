/**
 * Cabinet Estimate API service
 */

import api from './api';
import type {
  CabinetEstimate,
  CabinetEstimateCreate,
  CabinetEstimateListResponse,
  CabinetEstimateUpdate,
  EstimateHistory,
  PricingInfo,
  PurchaseOrderResponse,
} from '../types/cabinetEstimate';

const BASE_URL = '/api/cabinet-estimates';

export const cabinetEstimateService = {
  // ── Pricing info ──

  async getPricingInfo() {
    const { data } = await api.get(`${BASE_URL}/pricing-info`);
    return data as PricingInfo;
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
    return data as CabinetEstimateListResponse;
  },

  async getById(id: string) {
    const { data } = await api.get(`${BASE_URL}/${id}`);
    return data as CabinetEstimate;
  },

  async create(payload: CabinetEstimateCreate) {
    const { data } = await api.post(BASE_URL, payload);
    return data as CabinetEstimate;
  },

  async update(id: string, payload: CabinetEstimateUpdate) {
    const { data } = await api.put(`${BASE_URL}/${id}`, payload);
    return data as CabinetEstimate;
  },

  async delete(id: string) {
    const { data } = await api.delete(`${BASE_URL}/${id}`);
    return data;
  },

  // ── Calculation ──

  async calculate(id: string) {
    const { data } = await api.post(`${BASE_URL}/${id}/calculate`);
    return data as CabinetEstimate;
  },

  // ── Clone ──

  async clone(id: string) {
    const { data } = await api.post(`${BASE_URL}/${id}/clone`);
    return data as CabinetEstimate;
  },

  // ── History ──

  async getHistory(id: string) {
    const { data } = await api.get(`${BASE_URL}/${id}/history`);
    return data as EstimateHistory[];
  },

  // ── Purchase Order ──

  async getPurchaseOrder(id: string) {
    const { data } = await api.get(`${BASE_URL}/${id}/purchase-order`);
    return data as PurchaseOrderResponse;
  },

  // ── Export ──

  async exportPdf(id: string) {
    const response = await api.get(`${BASE_URL}/${id}/export/pdf`, {
      responseType: 'blob',
    });
    const url = window.URL.createObjectURL(new Blob([response.data]));
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `cabinet_estimate_${id.substring(0, 8)}.pdf`);
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.URL.revokeObjectURL(url);
  },

  async exportExcel(id: string) {
    const response = await api.get(`${BASE_URL}/${id}/export/excel`, {
      responseType: 'blob',
    });
    const url = window.URL.createObjectURL(new Blob([response.data]));
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `cabinet_purchase_order_${id.substring(0, 8)}.xlsx`);
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.URL.revokeObjectURL(url);
  },
};
