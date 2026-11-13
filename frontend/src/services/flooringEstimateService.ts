/**
 * Flooring Estimate API service.
 */

import api from './api';
import type {
  FlooringEstimate,
  FlooringPdfLayout,
  FlooringSketch,
  JobScope,
  RoomScope,
} from '../types/flooringEstimate';

const BASE_URL = '/api/flooring-estimates';

/** Save a PDF the API sent, named by its Content-Disposition (or `fallback`) */
function savePdf(response: { data: BlobPart; headers?: Record<string, string> }, fallback: string) {
  const match = response.headers?.['content-disposition']?.match(/filename="?([^";\n]+)"?/);
  const url = window.URL.createObjectURL(new Blob([response.data], { type: 'application/pdf' }));
  const link = document.createElement('a');
  link.href = url;
  link.setAttribute('download', match?.[1] || fallback);
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.URL.revokeObjectURL(url);
}

export interface FlooringEstimateUpdate {
  claim_id?: string | null;
  company_id?: string | null;
  property_address?: string | null;
  city?: string | null;
  state?: string | null;
  zip_code?: string | null;
  room_scopes?: Record<string, RoomScope>;
  job_scope?: JobScope;
  overview_text?: string | null;
  include_overhead_profit?: boolean;
  overhead_pct?: number;
  profit_pct?: number;
  notes?: string | null;
}

export interface FlooringEstimateCreate extends FlooringEstimateUpdate {
  project_type?: 'insurance' | 'remodel';
  sketch_data?: FlooringSketch;
}

export interface FlooringEstimateList {
  items: FlooringEstimate[];
  total: number;
  page: number;
  page_size: number;
}

export const flooringEstimateService = {
  async list(params: { search?: string; status?: string; claim_id?: string; page?: number; page_size?: number } = {}) {
    const { data } = await api.get<FlooringEstimateList>(BASE_URL, { params });
    return data;
  },

  async getById(id: string) {
    const { data } = await api.get<FlooringEstimate>(`${BASE_URL}/${id}`);
    return data;
  },

  async create(body: FlooringEstimateCreate) {
    const { data } = await api.post<FlooringEstimate>(BASE_URL, body);
    return data;
  },

  async update(id: string, body: FlooringEstimateUpdate) {
    const { data } = await api.put<FlooringEstimate>(`${BASE_URL}/${id}`, body);
    return data;
  },

  /** Save the drawing on its own; the editor saves as it is drawn. */
  async saveSketch(id: string, sketch: FlooringSketch) {
    const { data } = await api.put<FlooringEstimate>(`${BASE_URL}/${id}/sketch`, { sketch_data: sketch });
    return data;
  },

  async calculate(id: string, body?: FlooringEstimateUpdate) {
    const { data } = await api.post<FlooringEstimate>(`${BASE_URL}/${id}/calculate`, body);
    return data;
  },

  async useCurrentPrices(id: string) {
    const { data } = await api.post<FlooringEstimate>(`${BASE_URL}/${id}/use-current-prices`);
    return data;
  },

  async clone(id: string) {
    const { data } = await api.post<FlooringEstimate>(`${BASE_URL}/${id}/clone`);
    return data;
  },

  async delete(id: string) {
    await api.delete(`${BASE_URL}/${id}`);
  },

  async history(id: string) {
    const { data } = await api.get(`${BASE_URL}/${id}/history`);
    return data;
  },

  /** Download the estimate's PDF in one of its layouts, then the plan */
  async downloadPdf(id: string, showSignature = true, layout: FlooringPdfLayout = 'rooms') {
    const response = await api.get(`${BASE_URL}/${id}/export/pdf`, {
      params: { show_signature: showSignature, layout },
      responseType: 'blob',
    });
    savePdf(response as { data: BlobPart; headers?: Record<string, string> }, `flooring_estimate_${id.slice(0, 8)}.pdf`);
  },

  async pricingInfo(estimateId?: string) {
    const { data } = await api.get(`${BASE_URL}/pricing-info`, { params: estimateId ? { estimate_id: estimateId } : {} });
    return data;
  },
};

export default flooringEstimateService;
