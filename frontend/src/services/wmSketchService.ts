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

const BASE_URL = '/api/water-mitigation/sketch';

const wmSketchService = {
  // ============================================================================
  // Floor Sketch CRUD
  // ============================================================================

  /** Retrieve all floor sketches for a given WM job, ordered by floor_order */
  getFloorSketches: async (jobId: string): Promise<WMFloorSketch[]> => {
    const response = await api.get(`${BASE_URL}/jobs/${jobId}/floors`);
    return response.data.items;
  },

  /** Create a new floor sketch under a WM job */
  createFloorSketch: async (
    jobId: string,
    data: WMFloorSketchCreate
  ): Promise<WMFloorSketch> => {
    const response = await api.post(`${BASE_URL}/jobs/${jobId}/floors`, data);
    return response.data;
  },

  /** Retrieve a single floor sketch by its ID */
  getFloorSketch: async (floorSketchId: string): Promise<WMFloorSketch> => {
    const response = await api.get(`${BASE_URL}/floors/${floorSketchId}`);
    return response.data;
  },

  /** Update floor sketch metadata (label, order, canvas size, etc.) */
  updateFloorSketch: async (
    floorSketchId: string,
    data: WMFloorSketchUpdate
  ): Promise<WMFloorSketch> => {
    const response = await api.put(`${BASE_URL}/floors/${floorSketchId}`, data);
    return response.data;
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
    formData.append('file', file);
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
   */
  downloadSketchReport: async (jobId: string, filename?: string): Promise<void> => {
    const response = await api.get(`${BASE_URL}/jobs/${jobId}/report`, {
      responseType: 'blob',
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
};

export default wmSketchService;
