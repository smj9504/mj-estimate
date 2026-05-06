/**
 * API service for Packing Estimate
 */

import api from './api';
import type {
  QuickEstimateRequest,
  ContentEstimateRequest,
  EstimateResponse,
  RoomAnalysisResponse,
  PackEstimateListResponse,
  PackingPrice,
  RoomPreset,
} from '../types/packing-estimate';

const BASE = '/api/packing-estimate';

// ── Estimate Calculation ──────────────────────

export async function quickEstimate(
  request: QuickEstimateRequest
): Promise<EstimateResponse> {
  const { data } = await api.post(`${BASE}/quick-estimate`, request);
  return data;
}

export async function contentEstimate(
  request: ContentEstimateRequest
): Promise<EstimateResponse> {
  const { data } = await api.post(`${BASE}/content-estimate`, request);
  return data;
}

// ── Room Photo Analysis ───────────────────────

export async function analyzeRoom(
  roomName: string,
  images: string[],
  existingItems?: { name: string; quantity: number }[]
): Promise<RoomAnalysisResponse> {
  const { data } = await api.post(`${BASE}/analyze-room`, {
    room_name: roomName,
    images,
    existing_items: existingItems,
  });
  return data;
}

export function analyzeRoomBatch(
  rooms: { room_name: string; images: string[] }[],
  batchId?: string,
  onRoomResult?: (event: any) => void,
  onComplete?: (event: any) => void,
  onError?: (error: any) => void,
): () => void {
  const controller = new AbortController();

  (async () => {
    try {
      const response = await fetch(`${BASE}/analyze-batch`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('auth_token')}`,
        },
        body: JSON.stringify({ rooms, batch_id: batchId }),
        signal: controller.signal,
      });

      const reader = response.body?.getReader();
      if (!reader) return;

      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const json = JSON.parse(line.slice(6));
          if (json.event === 'room_result') {
            onRoomResult?.(json);
          } else if (json.event === 'batch_complete') {
            onComplete?.(json);
          }
        }
      }
    } catch (err: any) {
      if (err.name !== 'AbortError') {
        onError?.(err);
      }
    }
  })();

  return () => controller.abort();
}

// ── Presets ───────────────────────────────────

export async function getPresets(): Promise<Record<string, (RoomPreset & { key: string })[]>> {
  const { data } = await api.get(`${BASE}/presets`);
  return data;
}

// ── Prices ───────────────────────────────────

export async function getPrices(
  companyId?: string
): Promise<PackingPrice[]> {
  const params = companyId ? { company_id: companyId } : {};
  const { data } = await api.get(`${BASE}/prices`, { params });
  return data;
}

export async function updatePrice(
  priceId: string,
  update: { unit_price?: number; name?: string }
): Promise<void> {
  await api.patch(`${BASE}/prices/${priceId}`, update);
}

export async function seedPrices(
  companyId?: string
): Promise<{ created: number }> {
  const { data } = await api.post(`${BASE}/prices/seed`, null, {
    params: companyId ? { company_id: companyId } : {},
  });
  return data;
}

// ── CRUD ──────────────────────────────────────

export async function listEstimates(params?: {
  client_id?: string;
  company_id?: string;
  status?: string;
  skip?: number;
  limit?: number;
}): Promise<PackEstimateListResponse> {
  const { data } = await api.get(`${BASE}/list`, { params });
  return data;
}

export async function getEstimate(id: string): Promise<any> {
  const { data } = await api.get(`${BASE}/${id}`);
  return data;
}

export async function updateEstimate(
  id: string,
  update: Record<string, any>
): Promise<void> {
  await api.put(`${BASE}/${id}`, update);
}

export async function deleteEstimate(id: string): Promise<void> {
  await api.delete(`${BASE}/${id}`);
}

// ── Export ──────────────────────────────────

export async function exportPdf(id: string): Promise<void> {
  const response = await api.get(`${BASE}/${id}/export/pdf`, {
    responseType: 'blob',
  });
  const url = window.URL.createObjectURL(new Blob([response.data]));
  const link = document.createElement('a');
  link.href = url;
  link.setAttribute('download', `packing_estimate_${id.substring(0, 8)}.pdf`);
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.URL.revokeObjectURL(url);
}
