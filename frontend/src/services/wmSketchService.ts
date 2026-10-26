/**
 * Water Mitigation Sketch API Service
 * Handles all API calls to /api/water-mitigation/sketch endpoints
 */

import api from './api';
import type {
  WMFloorSketch,
  WMFloorSketchCreate,
  WMFloorSketchUpdate,
  WMOverlayData,
} from '../types/wmSketch';
import { EMPTY_OVERLAY_DATA } from '../types/wmSketch';

const BASE_URL = '/api/water-mitigation/sketch';

/**
 * Longest side of an uploaded background, matching MAX_BACKGROUND_SIDE in
 * backend sketch_service.py. The sketch report decodes the stored image at
 * full size; larger ones (e.g. 3x crops of SVG plans) exceed the server's
 * memory budget and the report fails.
 */
const MAX_BACKGROUND_SIDE = 2000;

/** Downscale a raster image so its longest side fits MAX_BACKGROUND_SIDE. */
async function shrinkBackgroundImage(file: File): Promise<File> {
  if (!/^image\/(png|jpeg|webp|gif|bmp)$/.test(file.type)) return file;
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    return file;
  }
  try {
    const scale = MAX_BACKGROUND_SIDE / Math.max(bitmap.width, bitmap.height);
    if (scale >= 1) return file;
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const ctx = canvas.getContext('2d')!;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    // JPEG stays JPEG; everything else becomes PNG to keep transparency.
    const type = file.type === 'image/jpeg' ? 'image/jpeg' : 'image/png';
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, type, type === 'image/jpeg' ? 0.92 : undefined)
    );
    if (!blob) return file;
    const name = type === 'image/png' ? file.name.replace(/\.[^.]+$/, '') + '.png' : file.name;
    return new File([blob], name, { type });
  } finally {
    bitmap.close();
  }
}

/** Ensure all overlay_data array fields are defined (backend JSONB may omit empty arrays) */
function normalizeOverlay(sketch: WMFloorSketch): WMFloorSketch {
  const od = sketch.overlay_data;
  if (!od || typeof od !== 'object') {
    return { ...sketch, overlay_data: { ...EMPTY_OVERLAY_DATA } };
  }
  return {
    ...sketch,
    overlay_data: {
      ...EMPTY_OVERLAY_DATA,
      ...od,
    },
  };
}

const wmSketchService = {
  // ============================================================================
  // Floor Sketch CRUD
  // ============================================================================

  /** Retrieve all floor sketches for a given WM job, ordered by floor_order */
  getFloorSketches: async (jobId: string): Promise<WMFloorSketch[]> => {
    const response = await api.get(`${BASE_URL}/jobs/${jobId}/floors`);
    return (response.data.items as WMFloorSketch[]).map(normalizeOverlay);
  },

  /** Create a new floor sketch under a WM job */
  createFloorSketch: async (
    jobId: string,
    data: WMFloorSketchCreate
  ): Promise<WMFloorSketch> => {
    const response = await api.post(`${BASE_URL}/jobs/${jobId}/floors`, data);
    return normalizeOverlay(response.data);
  },

  /** Retrieve a single floor sketch by its ID */
  getFloorSketch: async (floorSketchId: string): Promise<WMFloorSketch> => {
    const response = await api.get(`${BASE_URL}/floors/${floorSketchId}`);
    return normalizeOverlay(response.data);
  },

  /** Update floor sketch metadata (label, order, canvas size, etc.) */
  updateFloorSketch: async (
    floorSketchId: string,
    data: WMFloorSketchUpdate
  ): Promise<WMFloorSketch> => {
    const response = await api.put(`${BASE_URL}/floors/${floorSketchId}`, data);
    return normalizeOverlay(response.data);
  },

  /** Permanently delete a floor sketch and all its overlay data */
  deleteFloorSketch: async (floorSketchId: string): Promise<void> => {
    await api.delete(`${BASE_URL}/floors/${floorSketchId}`);
  },

  // ============================================================================
  // Overlay Data (bulk save)
  // ============================================================================

  /**
   * Replace all overlay data for a floor sketch in one request.
   * The backend performs a full replace — pass the complete overlay state,
   * not a partial diff.
   */
  saveOverlayData: async (
    floorSketchId: string,
    overlayData: WMOverlayData
  ): Promise<WMOverlayData> => {
    const response = await api.put(
      `${BASE_URL}/floors/${floorSketchId}/overlay`,
      overlayData
    );
    return response.data;
  },

  // ============================================================================
  // Background Image
  // ============================================================================

  /**
   * Upload a background image for a floor sketch.
   * The backend stores the file and returns the public URL to display on canvas.
   */
  uploadBackgroundImage: async (
    floorSketchId: string,
    file: File
  ): Promise<{ background_image_url: string }> => {
    const formData = new FormData();
    formData.append('file', await shrinkBackgroundImage(file));
    const response = await api.post(
      `${BASE_URL}/floors/${floorSketchId}/background-image`,
      formData,
      { headers: { 'Content-Type': 'multipart/form-data' } }
    );
    return response.data;
  },

  /** Remove the background image from a floor sketch */
  removeBackgroundImage: async (floorSketchId: string): Promise<void> => {
    await api.delete(`${BASE_URL}/floors/${floorSketchId}/background-image`);
  },

  // ============================================================================
  // PDF Report
  // ============================================================================

  /**
   * Generate and download a PDF sketch report for a WM job.
   * Triggers a browser download with the PDF file.
   * @param templateVariant - Template variant: 'a' (default), 'b' (formal), 'c' (modern)
   * @param showInsurance - Print the insurance company, policy # and claim #
   */
  downloadSketchReport: async (
    jobId: string,
    filename?: string,
    templateVariant: string = 'a',
    showInsurance: boolean = true,
  ): Promise<void> => {
    const response = await api.get(`${BASE_URL}/jobs/${jobId}/report`, {
      responseType: 'blob',
      params: { template_variant: templateVariant, show_insurance: showInsurance },
    });
    const blob = new Blob([response.data], { type: 'application/pdf' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename || `sketch_report.pdf`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  },
  // ============================================================================
  // Generate Scope of Work from Sketch
  // ============================================================================

  /**
   * Generate Scope of Work locations & items from sketch overlay data.
   * Creates scope items for demolition, equipment, containment, floor/content protection.
   */
  generateScopeFromSketch: async (
    jobId: string,
    options: { clear_existing?: boolean } = {}
  ): Promise<{
    success: boolean;
    message: string;
    locations_created: number;
    items_created: number;
    items: Array<{
      name: string;
      item_type: string;
      quantity: number;
      unit: string;
      floor_label: string;
    }>;
    warnings: string[];
  }> => {
    const response = await api.post(
      `${BASE_URL}/jobs/${jobId}/generate-scope`,
      options
    );
    return response.data;
  },

  /** Analyze floor plan image with AI to extract walls and rooms */
  analyzeFloorPlanImage: async (
    floorSketchId: string
  ): Promise<{
    success: boolean;
    message: string;
    walls: Array<{
      id: string;
      floor_sketch_id: string;
      start_x: number;
      start_y: number;
      end_x: number;
      end_y: number;
      thickness: number;
      color: string;
      length_ft: number;
    }>;
    rooms: Array<{
      id: string;
      floor_sketch_id: string;
      name: string;
      boundary: Array<{ x: number; y: number }>;
      color: string;
      height_ft: number;
      area_sqft: number;
      wall_ids: string[];
    }>;
  }> => {
    const response = await api.post(
      `${BASE_URL}/floors/${floorSketchId}/analyze-image`
    );
    return response.data;
  },
};

export default wmSketchService;
