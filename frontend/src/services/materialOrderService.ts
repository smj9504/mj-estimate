/**
 * Material Order API service
 */

import api from './api';
import type {
  MaterialOrderRequest,
  MaterialOrderResponse,
  MaterialOrderExportRequest,
  MaterialOrderSave,
  MaterialOrderListResponse,
  MaterialOrderRecord,
  BrandInfo,
  EagleViewRoofingResult,
} from '../types/materialOrder';

const BASE_URL = '/api/material-orders';

export const materialOrderService = {
  async getBrands() {
    const { data } = await api.get(`${BASE_URL}/brands`);
    return data as BrandInfo;
  },

  async calculate(payload: MaterialOrderRequest) {
    const { data } = await api.post(`${BASE_URL}/calculate`, payload);
    return data as MaterialOrderResponse;
  },

  async parseEagleView(file: File) {
    const formData = new FormData();
    formData.append('file', file);
    const { data } = await api.post(`${BASE_URL}/parse-eagleview`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
    return data as EagleViewRoofingResult;
  },

  // ── CRUD ──

  async save(payload: MaterialOrderSave) {
    const { data } = await api.post(`${BASE_URL}/save`, payload);
    return data as MaterialOrderRecord;
  },

  async list(params?: {
    scope_type?: string;
    status?: string;
    search?: string;
    page?: number;
    page_size?: number;
  }) {
    const { data } = await api.get(`${BASE_URL}/list`, { params });
    return data as MaterialOrderListResponse;
  },

  async getById(id: string) {
    const { data } = await api.get(`${BASE_URL}/${id}`);
    return data as MaterialOrderRecord;
  },

  async update(id: string, payload: MaterialOrderSave) {
    const { data } = await api.put(`${BASE_URL}/${id}`, payload);
    return data as MaterialOrderRecord;
  },

  async delete(id: string) {
    const { data } = await api.delete(`${BASE_URL}/${id}`);
    return data;
  },

  // ── Export ──

  async exportPdf(payload: MaterialOrderExportRequest) {
    const response = await api.post(`${BASE_URL}/export/pdf`, payload, {
      responseType: 'blob',
    });
    const outputLabel =
      payload.output_type === 'supply_order' ? 'supply_order' : 'internal_estimate';
    const addressPart = payload.property_address
      ? '_' + payload.property_address.split(',')[0].trim().replace(/\s+/g, '_')
      : '';
    const filename = `${outputLabel}_${payload.scope_type}${addressPart}.pdf`;

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
