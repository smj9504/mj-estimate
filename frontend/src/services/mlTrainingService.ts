/**
 * ML Training Service
 * API service for model training and dataset management
 */

import api from './api';

const API_BASE = '/api/material-detection/training';

export interface TrainingDataset {
  id: string;
  name: string;
  description?: string;
  status: 'draft' | 'labeling' | 'ready' | 'training';
  total_images: number;
  labeled_images: number;
  verified_images: number;
  train_split: number;
  val_split: number;
  test_split: number;
  created_at: string;
}

export interface DetectedMaterial {
  id: string;
  training_image_id: string;
  material_order: number;
  coverage_percentage?: number;
  location_in_image?: string;

  // Classification
  category?: string;
  subcategory?: string;
  material_type?: string;
  species?: string;

  // Specifications
  grade?: string;
  width?: string;
  thickness?: string;
  finish?: string;
  color?: string;

  // Critical pricing factors
  density?: string;
  pattern?: string;
  condition?: string;
  additional_specs?: string;

  // Confidence scores
  category_confidence?: number;
  subcategory_confidence?: number;
  grade_confidence?: number;
  density_confidence?: number;
  pattern_confidence?: number;

  // Pricing metadata
  pricing_notes?: string;

  created_at: string;
}

export interface TrainingImage {
  id: string;
  dataset_id: string;
  file_id: string;
  image_url: string;
  labeling_status: 'pending' | 'auto_labeled' | 'manual_review' | 'verified';
  split_type?: 'train' | 'val' | 'test';
  auto_labeled: boolean;

  // Multi-material support
  detected_materials: DetectedMaterial[];

  // Legacy fields (deprecated - kept for backward compatibility)
  material_category?: string;
  material_type?: string;
  material_grade?: string;
  material_finish?: string;
  category_confidence?: number;
}

export interface TrainingJob {
  job_id: string;
  dataset_id: string;
  job_name: string;
  status: 'pending' | 'training' | 'completed' | 'failed';
  current_epoch: number;
  total_epochs: number;
  model_architecture: string;
  base_model: string;
  hyperparameters: {
    epochs: number;
    batch_size: number;
    learning_rate: number;
  };
  training_metrics?: {
    train_loss: number;
    val_loss: number;
    accuracy: {
      category: number;
      type: number;
      grade: number;
      finish: number;
    };
  };
  validation_metrics?: {
    loss: number;
    accuracy: {
      category: number;
      type: number;
      grade: number;
      finish: number;
    };
  };
  best_val_accuracy?: number;
  best_val_loss?: number;
  model_path?: string;
  error_message?: string;
  started_at?: string;
  completed_at?: string;
  created_at: string;
}

export interface CostEstimate {
  total_cost: number;
  cost_per_image: number;
  num_images: number;
  detail: string;
  estimated_time_minutes: number;
}

// ===== Dataset Management =====

export const createDataset = async (data: {
  name: string;
  description?: string;
  train_split?: number;
  val_split?: number;
  test_split?: number;
}): Promise<TrainingDataset> => {
  const response = await api.post(`${API_BASE}/datasets`, data);
  return response.data;
};

export const getDataset = async (datasetId: string): Promise<TrainingDataset> => {
  const response = await api.get(`${API_BASE}/datasets/${datasetId}`);
  return response.data;
};

export const listDatasets = async (
  status?: string,
  skip: number = 0,
  limit: number = 20
): Promise<TrainingDataset[]> => {
  const response = await api.get(`${API_BASE}/datasets`, {
    params: { status, skip, limit }
  });
  return response.data;
};

export const deleteDataset = async (datasetId: string): Promise<void> => {
  await api.delete(`${API_BASE}/datasets/${datasetId}`);
};

// ===== Image Management =====

export const addImagesToDataset = async (
  datasetId: string,
  fileIds: string[]
): Promise<TrainingImage[]> => {
  const response = await api.post(`${API_BASE}/datasets/${datasetId}/images`, fileIds);
  return response.data;
};

export const getDatasetImages = async (
  datasetId: string,
  labelingStatus?: string,
  splitType?: string
): Promise<TrainingImage[]> => {
  const response = await api.get(`${API_BASE}/datasets/${datasetId}/images`, {
    params: { labeling_status: labelingStatus, split_type: splitType }
  });
  return response.data;
};

export const updateImageLabel = async (
  imageId: string,
  labels: Partial<TrainingImage>
): Promise<TrainingImage> => {
  const response = await api.put(`${API_BASE}/images/${imageId}`, labels);
  return response.data;
};

// ===== Auto-Labeling =====

export const estimateLabelingCost = async (
  numImages: number,
  detail: 'low' | 'high' = 'high'
): Promise<CostEstimate> => {
  const response = await api.post(`${API_BASE}/cost-estimate`, {
    num_images: numImages,
    detail
  });
  return response.data;
};

export const autoLabelImages = async (
  datasetId: string,
  imageIds: string[],
  temperature: number = 0.0,
  detail: 'low' | 'high' = 'high'
): Promise<{
  message: string;
  dataset_id: string;
  total_images: number;
  estimated_cost: number;
  estimated_time_minutes: number;
}> => {
  const response = await api.post(`${API_BASE}/datasets/${datasetId}/auto-label`, {
    image_ids: imageIds,
    temperature,
    detail
  });
  return response.data;
};

// ===== Dataset Splits =====

export const assignSplits = async (
  datasetId: string
): Promise<{
  dataset_id: string;
  splits: { train: number; val: number; test: number };
  message: string;
}> => {
  const response = await api.post(`${API_BASE}/datasets/${datasetId}/assign-splits`);
  return response.data;
};

// ===== Training Jobs =====

export const startTraining = async (
  datasetId: string,
  options?: {
    job_name?: string;
    epochs?: number;
    batch_size?: number;
    learning_rate?: number;
    model_name?: string;
  }
): Promise<{
  job_id: string;
  dataset_id: string;
  status: string;
  message: string;
  estimated_time_minutes: number;
}> => {
  const response = await api.post(`${API_BASE}/jobs`, null, {
    params: {
      dataset_id: datasetId,
      ...options
    }
  });
  return response.data;
};

export const getTrainingJob = async (jobId: string): Promise<TrainingJob> => {
  const response = await api.get(`${API_BASE}/jobs/${jobId}`);
  return response.data;
};

export const listTrainingJobs = async (
  datasetId?: string,
  status?: string,
  skip: number = 0,
  limit: number = 20
): Promise<TrainingJob[]> => {
  const response = await api.get(`${API_BASE}/jobs`, {
    params: { dataset_id: datasetId, status, skip, limit }
  });
  return response.data;
};
