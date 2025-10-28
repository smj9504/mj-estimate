/**
 * Material Detection TypeScript Types
 */

export interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
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
  bounding_box?: BoundingBox;
  detection_time_ms: number;
  reviewed: boolean;
  reviewed_by_id?: string;
  reviewed_at?: string;
  created_at: string;
}

export type JobStatus = 'pending' | 'processing' | 'completed' | 'failed';
export type ProviderType = 'roboflow' | 'google_vision';

export interface MaterialDetectionJob {
  id: string;
  job_name?: string;
  status: JobStatus;
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

export interface MaterialCategoryStats {
  category: string;
  count: number;
  avg_confidence: number;
}

export interface MaterialDetectionStats {
  total_jobs: number;
  total_materials_detected: number;
  avg_confidence: number;
  materials_by_category?: MaterialCategoryStats[];
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
