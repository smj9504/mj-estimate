/**
 * Cabinet Estimate Sketch API service.
 */

import api from './api';
import type {
  CabinetSketch,
  CabinetSketchOverlayData,
  CabinetSketchUpdate,
} from '../types/cabinetSketch';
import { EMPTY_CABINET_OVERLAY_DATA } from '../types/cabinetSketch';

const BASE_URL = '/api/cabinet-estimates';

/** Ensure overlay_data array fields are defined (backend JSONB may omit empty arrays) */
function normalize(sketch: CabinetSketch): CabinetSketch {
  const od = sketch.overlay_data;
  if (!od || typeof od !== 'object') {
    return { ...sketch, overlay_data: { ...EMPTY_CABINET_OVERLAY_DATA } };
  }
  return { ...sketch, overlay_data: { ...EMPTY_CABINET_OVERLAY_DATA, ...od } };
}

export const cabinetSketchService = {
  /** Get (or lazily create) the layout sketch for an estimate */
  getSketch: async (estimateId: string): Promise<CabinetSketch> => {
    const response = await api.get(`${BASE_URL}/${estimateId}/sketch`);
    return normalize(response.data);
  },

  /** Update sketch canvas metadata (size/scale) only */
  updateSketchMeta: async (
    estimateId: string,
    data: CabinetSketchUpdate
  ): Promise<CabinetSketch> => {
    const response = await api.put(`${BASE_URL}/${estimateId}/sketch`, data);
    return normalize(response.data);
  },

  /**
   * Replace the sketch's overlay data (walls + cabinets) wholesale.
   * Full replace, not a diff — pass the complete overlay state.
   */
  saveOverlay: async (
    estimateId: string,
    overlayData: CabinetSketchOverlayData
  ): Promise<CabinetSketch> => {
    const response = await api.put(
      `${BASE_URL}/${estimateId}/sketch/overlay`,
      overlayData
    );
    return normalize(response.data);
  },
};

export default cabinetSketchService;
