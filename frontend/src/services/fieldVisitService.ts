/**
 * Field visit API. The screens and the upload queue handle their own failures
 * (a basement has no signal, and that isn't an error worth an alert), so none of
 * these raise the global "try again" notification.
 */

import api from './api';
import type {
  FieldAddress,
  FieldVisitDetail,
  FieldVisitSummary,
  FoundAddress,
  NameSource,
  FloorSource,
  ServerRoom,
  ServerShot,
  ShotKind,
  VisitStarted,
} from '../types/fieldVisit';

const BASE = '/api/field-visits';
const quiet = { suppressErrorNotification: true };

export interface VisitStartPayload {
  client_id?: string;
  address?: FieldAddress;
  company_id?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  gps_accuracy?: number | null;
  altitude?: number | null;
  altitude_accuracy?: number | null;
}

export interface RoomPayload {
  name: string;
  name_source: NameSource;
  floor: string;
  floor_source: FloorSource;
  room_type: string | null;
  position: number;
}

/** A path from the API as something an <img> can load, which the proxy only does in development */
export const apiUrl = (path: string) => `${api.defaults.baseURL || ''}${path}`;

export const fieldVisitService = {
  async addressHere(lat: number, lng: number) {
    const { data } = await api.get(`${BASE}/reverse-geocode`, { params: { lat, lng }, ...quiet });
    return data as FoundAddress;
  },

  async companies() {
    const { data } = await api.get(`${BASE}/companies`, quiet);
    return data as { companies: { id: string; name: string }[]; default_id: string | null };
  },

  async list(params?: { client_id?: string; limit?: number }) {
    const { data } = await api.get(`${BASE}/`, { params, ...quiet });
    return (data as { visits: FieldVisitSummary[] }).visits;
  },

  async start(payload: VisitStartPayload) {
    const { data } = await api.post(`${BASE}/`, payload, quiet);
    return data as VisitStarted;
  },

  async get(visitId: string) {
    const { data } = await api.get(`${BASE}/${visitId}`, quiet);
    return data as FieldVisitDetail;
  },

  async saveRoom(visitId: string, roomId: string, payload: RoomPayload) {
    const { data } = await api.put(`${BASE}/${visitId}/rooms/${roomId}`, payload, quiet);
    return data as ServerRoom;
  },

  async uploadShot(
    visitId: string,
    form: FormData,
    options: { video: boolean; onProgress?: (percent: number) => void },
  ) {
    const { data } = await api.post(`${BASE}/${visitId}/shots`, form, {
      headers: { 'Content-Type': 'multipart/form-data' },
      // A slow signal shouldn't fail a long video, but a dead one has to free the queue
      timeout: options.video ? 30 * 60 * 1000 : 2 * 60 * 1000,
      onUploadProgress: (event) => {
        if (event.total) options.onProgress?.(Math.round((event.loaded / event.total) * 100));
      },
      ...quiet,
    });
    return data as ServerShot;
  },

  async updateShot(visitId: string, shotId: string, payload: { room_id?: string; kind?: ShotKind; wall?: number | null }) {
    const { data } = await api.patch(`${BASE}/${visitId}/shots/${shotId}`, payload, quiet);
    return data as ServerShot;
  },

  async deleteShot(visitId: string, shotId: string) {
    await api.delete(`${BASE}/${visitId}/shots/${shotId}`, quiet);
  },

  async linkClaim(visitId: string, claimId: string | null) {
    const { data } = await api.put(`${BASE}/${visitId}/claim`, { claim_id: claimId });
    return data as { claim_id: string | null };
  },
};
