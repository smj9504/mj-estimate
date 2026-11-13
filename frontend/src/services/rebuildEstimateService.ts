/**
 * Rebuild Estimate API service.
 */

import api from './api';
import type {
  ImportableEstimate, RebuildEstimate, RebuildLine, RebuildRoom, SourceKind, XactimateMatch,
} from '../types/rebuildEstimate';

const BASE_URL = '/api/rebuild-estimates';

export interface RebuildEstimateUpdate {
  claim_id?: string | null;
  company_id?: string | null;
  property_address?: string | null;
  city?: string | null;
  state?: string | null;
  zip_code?: string | null;
  include_overhead_profit?: boolean;
  overhead_pct?: number;
  profit_pct?: number;
  notes?: string | null;
  rooms?: RebuildRoom[];
  lines?: RebuildLine[];
}

export const rebuildEstimateService = {
  async list(params: { search?: string; claim_id?: string; page?: number; page_size?: number } = {}) {
    const { data } = await api.get<{ items: RebuildEstimate[]; total: number }>(BASE_URL, { params });
    return data;
  },
  async getById(id: string) {
    const { data } = await api.get<RebuildEstimate>(`${BASE_URL}/${id}`);
    return data;
  },
  async create(body: RebuildEstimateUpdate = {}) {
    const { data } = await api.post<RebuildEstimate>(BASE_URL, body);
    return data;
  },
  async update(id: string, body: RebuildEstimateUpdate) {
    const { data } = await api.put<RebuildEstimate>(`${BASE_URL}/${id}`, body);
    return data;
  },
  async delete(id: string) {
    await api.delete(`${BASE_URL}/${id}`);
  },
  async importable(id: string) {
    const { data } = await api.get<ImportableEstimate[]>(`${BASE_URL}/${id}/importable`);
    return data;
  },
  async importEstimate(id: string, kind: SourceKind, estimateId: string) {
    const { data } = await api.post<RebuildEstimate>(`${BASE_URL}/${id}/sources`, { kind, estimate_id: estimateId });
    return data;
  },
  async refresh(id: string, sourceId: string) {
    const { data } = await api.post<RebuildEstimate>(`${BASE_URL}/${id}/sources/${sourceId}/refresh`);
    return data;
  },
  async moveSource(id: string, sourceId: string, target: { room_id?: string; new_room_name?: string }) {
    const { data } = await api.put<RebuildEstimate>(`${BASE_URL}/${id}/sources/${sourceId}/room`, target);
    return data;
  },
  async removeSource(id: string, sourceId: string) {
    const { data } = await api.delete<RebuildEstimate>(`${BASE_URL}/${id}/sources/${sourceId}`);
    return data;
  },
  async searchXactimate(q: string) {
    const { data } = await api.get<XactimateMatch[]>(`${BASE_URL}/xactimate-search`, { params: { q } });
    return data;
  },
  async downloadPdf(id: string) {
    const response = await api.get(`${BASE_URL}/${id}/export/pdf`, { responseType: 'blob' });
    const match = (response.headers?.['content-disposition'] as string | undefined)?.match(/filename="?([^";\n]+)"?/);
    const url = window.URL.createObjectURL(new Blob([response.data], { type: 'application/pdf' }));
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', match?.[1] || 'rebuild_estimate.pdf');
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.URL.revokeObjectURL(url);
  },
};

export default rebuildEstimateService;
