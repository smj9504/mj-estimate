/**
 * API service for Reconstruction Estimate domain
 */

import api from './api';
import {
  MaterialCategory,
  MaterialCategoryCreate,
  MaterialCategoryUpdate,
  MaterialWeight,
  MaterialWeightCreate,
  MaterialWeightUpdate,
  MaterialWeightListResponse,
  DebrisCalculationInput,
  DebrisCalculationResult,
  DebrisCalculation,
  DebrisCalculationListResponse,
  QuickCalculationRequest,
} from '../types/reconstructionEstimate';

const API_BASE_URL = '/api/reconstruction-estimate';

// Material Category API
export const materialCategoryAPI = {
  getAll: async (): Promise<MaterialCategory[]> => {
    const response = await api.get(`${API_BASE_URL}/categories`);
    return response.data;
  },

  create: async (data: MaterialCategoryCreate): Promise<MaterialCategory> => {
    const response = await api.post(`${API_BASE_URL}/categories`, data);
    return response.data;
  },

  update: async (id: string, data: MaterialCategoryUpdate): Promise<MaterialCategory> => {
    const response = await api.put(`${API_BASE_URL}/categories/${id}`, data);
    return response.data;
  },

  delete: async (id: string): Promise<void> => {
    await api.delete(`${API_BASE_URL}/categories/${id}`);
  },
};

// Material Weight API
export const materialWeightAPI = {
  getAll: async (params?: {
    category_id?: string;
    active_only?: boolean;
    search?: string;
  }): Promise<MaterialWeightListResponse> => {
    const response = await api.get(`${API_BASE_URL}/materials`, { params });
    return response.data;
  },

  getById: async (id: string): Promise<MaterialWeight> => {
    const response = await api.get(`${API_BASE_URL}/materials/${id}`);
    return response.data;
  },

  create: async (data: MaterialWeightCreate): Promise<MaterialWeight> => {
    const response = await api.post(`${API_BASE_URL}/materials`, data);
    return response.data;
  },

  update: async (id: string, data: MaterialWeightUpdate): Promise<MaterialWeight> => {
    const response = await api.put(`${API_BASE_URL}/materials/${id}`, data);
    return response.data;
  },

  delete: async (id: string): Promise<void> => {
    await api.delete(`${API_BASE_URL}/materials/${id}`);
  },
};

// Debris Calculation API
export const debrisCalculationAPI = {
  calculateQuick: async (request: QuickCalculationRequest): Promise<DebrisCalculationResult> => {
    const response = await api.post(`${API_BASE_URL}/debris/calculate`, request);
    return response.data;
  },

  create: async (data: DebrisCalculationInput): Promise<DebrisCalculation> => {
    const response = await api.post(`${API_BASE_URL}/debris/calculations`, data);
    return response.data;
  },

  getAll: async (params?: {
    limit?: number;
    offset?: number;
  }): Promise<DebrisCalculationListResponse> => {
    const response = await api.get(`${API_BASE_URL}/debris/calculations`, { params });
    return response.data;
  },

  getById: async (id: string): Promise<DebrisCalculation> => {
    const response = await api.get(`${API_BASE_URL}/debris/calculations/${id}`);
    return response.data;
  },

  update: async (id: string, data: Partial<DebrisCalculationInput>): Promise<DebrisCalculation> => {
    const response = await api.put(`${API_BASE_URL}/debris/calculations/${id}`, data);
    return response.data;
  },

  delete: async (id: string): Promise<void> => {
    await api.delete(`${API_BASE_URL}/debris/calculations/${id}`);
  },
};
