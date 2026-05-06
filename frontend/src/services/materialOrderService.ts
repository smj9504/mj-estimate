/**
 * Material Order API service
 */

import api from './api';
import type {
  MaterialOrderRequest,
  MaterialOrderResponse,
  MaterialOrderExportRequest,
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

  async exportPdf(payload: MaterialOrderExportRequest) {
    const response = await api.post(`${BASE_URL}/export/pdf`, payload, {
      responseType: 'blob',
    });
    const outputLabel =
      payload.output_type === 'supply_order' ? 'supply_order' : 'internal_estimate';
    const filename = `${outputLabel}_${payload.scope_type}.pdf`;

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
