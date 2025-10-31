/**
 * Material Detection Service
 *
 * API service for AI-powered construction material detection from images.
 */

import api from './api';

export interface MaterialDetectionJobCreate {
  job_name?: string;
  provider: 'roboflow' | 'google_vision' | 'custom_vit' | 'ensemble';
  confidence_threshold?: number;
  image_ids: string[];
  reconstruction_estimate_id?: string;
}

export interface DetectedMaterial {
  id: string;
  job_id: string;
  image_id: string;
  material_category: string;
  material_type?: string;
  material_grade?: string;
  material_finish?: string;
  confidence_score: number;
  provider_used: string;
  bounding_box?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  detection_time_ms: number;
  reviewed: boolean;
  reviewed_by_id?: string;
  reviewed_at?: string;
  created_at: string;
}

export interface MaterialDetectionJob {
  id: string;
  job_name?: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  provider: string;
  confidence_threshold: number;
  total_images: number;
  processed_images: number;
  total_materials_detected: number;
  avg_confidence?: number;
  processing_time_ms?: number;
  error_message?: string;
  created_by_id: string;
  reconstruction_estimate_id?: string;
  created_at: string;
  updated_at: string;
  completed_at?: string;
  detected_materials?: DetectedMaterial[];
}

export interface MaterialDetectionJobList {
  jobs: MaterialDetectionJob[];
  total: number;
  page: number;
  page_size: number;
  has_next: boolean;
  has_prev: boolean;
}

export interface ProviderHealthStatus {
  provider_name: string;
  available: boolean;
  response_time_ms?: number;
  error?: string;
}

export interface MaterialDetectionHealth {
  status: 'healthy' | 'degraded' | 'error';
  providers: ProviderHealthStatus[];
  timestamp: string;
}

export interface MaterialDetectionStats {
  total_jobs: number;
  total_materials_detected: number;
  avg_confidence: number;
  materials_by_category?: {
    category: string;
    count: number;
    avg_confidence: number;
  }[];
}

class MaterialDetectionService {
  /**
   * Check service health and provider availability
   */
  async getHealth(): Promise<MaterialDetectionHealth> {
    const response = await api.get(`/api/material-detection/health`);
    return response.data;
  }

  /**
   * Create a new material detection job
   */
  async createJob(jobData: MaterialDetectionJobCreate): Promise<{ job_id: string; message: string }> {
    const response = await api.post(`/api/material-detection/jobs`, jobData);
    return response.data;
  }

  /**
   * Get job details by ID
   */
  async getJob(jobId: string): Promise<MaterialDetectionJob> {
    const response = await api.get(`/api/material-detection/jobs/${jobId}`);
    return response.data;
  }

  /**
   * List jobs with pagination and filtering
   */
  async listJobs(params?: {
    skip?: number;
    limit?: number;
    status?: string;
    reconstruction_estimate_id?: string;
  }): Promise<MaterialDetectionJobList> {
    const response = await api.get(`/api/material-detection/jobs`, { params });
    return response.data;
  }

  /**
   * Delete a job and all its detected materials
   */
  async deleteJob(jobId: string): Promise<void> {
    await api.delete(`/api/material-detection/jobs/${jobId}`);
  }

  /**
   * Get job statistics
   */
  async getJobStatistics(jobId: string): Promise<MaterialDetectionStats> {
    const response = await api.get(`/api/material-detection/jobs/${jobId}/statistics`);
    return response.data;
  }

  /**
   * Get overall statistics
   */
  async getOverallStatistics(): Promise<MaterialDetectionStats> {
    const response = await api.get(`/api/material-detection/statistics`);
    return response.data;
  }

  /**
   * Update detected material (manual review/correction)
   */
  async updateDetectedMaterial(materialId: string, updates: {
    material_category?: string;
    material_type?: string;
    material_grade?: string;
    material_finish?: string;
    reviewed?: boolean;
  }): Promise<DetectedMaterial> {
    const response = await api.put(
      `/api/material-detection/materials/${materialId}`,
      updates
    );
    return response.data;
  }

  /**
   * Export job materials to CSV
   */
  async exportJobCSV(jobId: string): Promise<Blob> {
    const response = await api.get(
      `/api/material-detection/jobs/${jobId}/export/csv`,
      { responseType: 'blob' }
    );
    return response.data;
  }

  /**
   * Export job materials to Excel
   */
  async exportJobExcel(jobId: string): Promise<Blob> {
    const response = await api.get(
      `/api/material-detection/jobs/${jobId}/export/excel`,
      { responseType: 'blob' }
    );
    return response.data;
  }
}

export default new MaterialDetectionService();
