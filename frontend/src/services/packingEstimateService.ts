/**
 * API service for Packing Estimate
 */

import api from './api';
import type {
  QuickEstimateRequest,
  ContentEstimateRequest,
  DetectedContentItem,
  EstimateResponse,
  RoomAnalysisResponse,
  PackEstimateListResponse,
  PackingPrice,
  RoomPreset,
  ClaimPackingPhoto,
  PackingPhotoRef,
  PackingPhotoClaim,
  PackingReportOptions,
  PackingReportRequest,
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

// ── Item Plan ─────────────────────────────────

/** An item's packing method, materials and labor, from its attributes as they are now */
export async function planItem(item: DetectedContentItem): Promise<DetectedContentItem> {
  const { data } = await api.post(`${BASE}/item-plan`, item, {
    // Only updates the hours on screen; Calculate works them out again
    suppressErrorNotification: true,
  });
  return data;
}

// ── Room Photo Analysis ───────────────────────

/** Re-encode a photo the browser can't show (e.g. iPhone HEIC) as bare base64 JPEG */
export async function convertPhoto(file: File): Promise<string> {
  const formData = new FormData();
  formData.append('file', file);
  const { data } = await api.post(`${BASE}/convert-photo`, formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
  return data.image;
}

export async function analyzeRoom(
  roomName: string,
  images: string[],
  existingItems?: { name: string; quantity: number }[],
  /** The photos have all been sent; from here it's the server's work */
  onUploaded?: () => void,
): Promise<RoomAnalysisResponse> {
  const { data } = await api.post(`${BASE}/analyze-room`, {
    room_name: roomName,
    images,
    existing_items: existingItems,
  }, {
    // Claude lists a whole room from its photos; a packed room can take minutes
    timeout: 240000,
    // The room shows its own failure; a retry from the alert wouldn't reach the room
    suppressErrorNotification: true,
    onUploadProgress: (e) => {
      if (!e.total || e.loaded >= e.total) onUploaded?.();
    },
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

// ── Claim Packing Photos ──────────────────────

/** Claims with packing photos, most recently picked first */
export async function listClaimsWithPhotos(search?: string): Promise<PackingPhotoClaim[]> {
  const { data } = await api.get(`${BASE}/claims/with-photos`, {
    params: search ? { search } : undefined,
  });
  return data.claims;
}

export async function listClaimPhotos(claimId: string): Promise<ClaimPackingPhoto[]> {
  const { data } = await api.get(`${BASE}/claims/${claimId}/photos`);
  return data.photos;
}

/** File claim photos by room; a photo already filed moves there */
export async function addClaimPhotos(
  claimId: string,
  photos: PackingPhotoRef[],
  roomName?: string,
): Promise<ClaimPackingPhoto[]> {
  const { data } = await api.post(`${BASE}/claims/${claimId}/photos`, {
    room_name: roomName,
    photos,
  });
  return data.photos;
}

/** Move packing photos to a room; moving all of a room's photos renames it */
export async function moveClaimPhotos(
  claimId: string,
  ids: string[],
  roomName: string,
): Promise<ClaimPackingPhoto[]> {
  const { data } = await api.patch(`${BASE}/claims/${claimId}/photos`, {
    ids,
    room_name: roomName,
  });
  return data.photos;
}

/** Take photos out of the packing set; the photos themselves stay */
export async function removeClaimPhotos(claimId: string, ids: string[]): Promise<ClaimPackingPhoto[]> {
  const { data } = await api.post(`${BASE}/claims/${claimId}/photos/remove`, { ids });
  return data.photos;
}

/** One packing photo as bare base64 JPEG, sized for the AI analysis */
export async function getClaimPhotoImage(claimId: string, entryId: string): Promise<string> {
  const { data } = await api.get(`${BASE}/claims/${claimId}/photos/${entryId}/image`);
  return data.image;
}

// ── Photos Saved with an Estimate ─────────────

/** Save a room's photo (bare base64) as a file for the estimate to keep; gives its id */
export async function saveRoomPhoto(image: string, contextId: string): Promise<string> {
  const bytes = Uint8Array.from(atob(image), c => c.charCodeAt(0));
  const formData = new FormData();
  formData.append('files', new File([bytes], 'room-photo.jpg', { type: 'image/jpeg' }));
  formData.append('context', 'packing-estimate');
  formData.append('context_id', contextId);
  const { data } = await api.post('/api/files/upload', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
    // The builder says how many couldn't be saved
    suppressErrorNotification: true,
  });
  return data.data[0].id;
}

/** One photo saved with an estimate as bare base64 JPEG */
export async function getEstimatePhotoImage(estimateId: string, fileId: string): Promise<string> {
  const { data } = await api.get(`${BASE}/${estimateId}/photos/${fileId}/image`, {
    suppressErrorNotification: true,
  });
  return data.image;
}

/** An estimate that kept no photos: each room's packing photos on its claim, as ids */
export async function getEstimateClaimRoomPhotos(estimateId: string): Promise<string[][]> {
  const { data } = await api.get(`${BASE}/${estimateId}/claim-room-photos`, {
    suppressErrorNotification: true,
  });
  return data.rooms;
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
  claim_id?: string;
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

function saveFile(data: BlobPart, filename: string): void {
  const url = window.URL.createObjectURL(new Blob([data], { type: 'application/pdf' }));
  const link = document.createElement('a');
  link.href = url;
  link.setAttribute('download', filename);
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.URL.revokeObjectURL(url);
}

/**
 * The reason the server gave for a failed download: a blob request gets its
 * JSON error back as a Blob too
 */
export async function downloadErrorDetail(err: any): Promise<string | undefined> {
  const data = err?.response?.data;
  try {
    const body = data instanceof Blob ? JSON.parse(await data.text()) : data;
    return typeof body?.detail === 'string' ? body.detail : undefined;
  } catch {
    return undefined;
  }
}

export async function exportPdf(id: string): Promise<void> {
  const response = await api.get(`${BASE}/${id}/export/pdf`, {
    responseType: 'blob',
    timeout: 60000,
  });
  saveFile(response.data, `packing_estimate_${id.substring(0, 8)}.pdf`);
}

/** What the estimate's report can show: each room's items and photos */
export async function getReportOptions(id: string): Promise<PackingReportOptions> {
  const { data } = await api.get(`${BASE}/${id}/report`);
  return data;
}

/** The estimate's report: its contents list, its room photos, or both */
export async function exportReport(id: string, request: PackingReportRequest): Promise<void> {
  const response = await api.post(`${BASE}/${id}/export/report`, request, {
    responseType: 'blob',
    // Every room photo is fetched and sized on the server first
    timeout: request.photos ? 240000 : 60000,
  });
  const kind = request.contents_list && request.photos
    ? 'contents_report'
    : request.contents_list ? 'contents_list' : 'photo_report';
  saveFile(response.data, `packing_${kind}_${id.substring(0, 8)}.pdf`);
}
