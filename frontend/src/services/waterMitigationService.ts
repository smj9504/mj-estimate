/**
 * Water Mitigation API Service
 * Handles all API calls to /api/water-mitigation endpoints
 */

import api from './api';
import type {
  WaterMitigationJob,
  JobCreate,
  JobUpdate,
  JobStatusUpdate,
  JobListResponse,
  JobFilters,
  PhotoCategory,
  CategoryCreate,
  JobStatusHistory,
  ReportConfig,
  ReportConfigCreate,
  ReportConfigUpdate,
  GenerateReportRequest,
  GenerateReportResponse
} from '../types/waterMitigation';

const BASE_URL = '/api/water-mitigation';

// Job Management
export const waterMitigationService = {
  // Create new job
  createJob: async (data: JobCreate): Promise<WaterMitigationJob> => {
    const response = await api.post(`${BASE_URL}/jobs`, data);
    return response.data;
  },

  // Get job list with filters
  getJobs: async (filters?: JobFilters): Promise<JobListResponse> => {
    const params = new URLSearchParams();

    if (filters?.client_id) params.append('client_id', filters.client_id);
    if (filters?.search) params.append('search', filters.search);
    if (filters?.status?.length) {
      filters.status.forEach(s => params.append('status', s));
    }
    if (filters?.active !== undefined) params.append('active', String(filters.active));
    if (filters?.page) params.append('page', String(filters.page));
    if (filters?.page_size) params.append('page_size', String(filters.page_size));

    const response = await api.get(`${BASE_URL}/jobs?${params.toString()}`);
    return response.data;
  },

  // Get single job by ID
  getJob: async (jobId: string): Promise<WaterMitigationJob> => {
    const response = await api.get(`${BASE_URL}/jobs/${jobId}`);
    return response.data;
  },

  // Update job
  updateJob: async (jobId: string, data: JobUpdate): Promise<WaterMitigationJob> => {
    const response = await api.put(`${BASE_URL}/jobs/${jobId}`, data);
    return response.data;
  },

  // Update job status
  updateJobStatus: async (jobId: string, data: JobStatusUpdate): Promise<WaterMitigationJob> => {
    const response = await api.patch(`${BASE_URL}/jobs/${jobId}/status`, data);
    return response.data;
  },

  // Toggle job active status
  toggleJobActive: async (jobId: string, active: boolean): Promise<WaterMitigationJob> => {
    const response = await api.patch(`${BASE_URL}/jobs/${jobId}/active`, { active });
    return response.data;
  },

  // Delete job
  deleteJob: async (jobId: string): Promise<void> => {
    await api.delete(`${BASE_URL}/jobs/${jobId}`);
  },

  // Get job status history
  getJobStatusHistory: async (jobId: string): Promise<JobStatusHistory[]> => {
    const response = await api.get(`${BASE_URL}/jobs/${jobId}/status-history`);
    return response.data;
  },

  // Category Management
  categories: {
    // Create new category
    create: async (data: CategoryCreate, clientId: string): Promise<PhotoCategory> => {
      const response = await api.post(`${BASE_URL}/categories`, data, {
        params: { client_id: clientId }
      });
      return response.data;
    },

    // Get all categories
    getAll: async (clientId: string): Promise<PhotoCategory[]> => {
      const response = await api.get(`${BASE_URL}/categories`, {
        params: { client_id: clientId }
      });
      return response.data;
    },

    // Delete category
    delete: async (categoryId: string): Promise<void> => {
      await api.delete(`${BASE_URL}/categories/${categoryId}`);
    }
  },

  // Photo Management
  photos: {
    // Upload photo to job
    upload: async (jobId: string, file: File, title?: string, description?: string): Promise<any> => {
      const formData = new FormData();
      formData.append('file', file);
      if (title) formData.append('title', title);
      if (description) formData.append('description', description);

      const response = await api.post(`${BASE_URL}/jobs/${jobId}/photos`, formData, {
        headers: {
          'Content-Type': 'multipart/form-data',
        },
      });
      return response.data;
    },

    // Get all photos for a job with optional filtering
    getByJob: async (
      jobId: string,
      categoryFilter?: string | string[],
      uncategorizedOnly?: boolean
    ): Promise<any[]> => {
      const params = new URLSearchParams();

      // Handle multiple categories
      if (categoryFilter) {
        const categories = Array.isArray(categoryFilter)
          ? categoryFilter.join(',')
          : categoryFilter;
        params.append('category_filter', categories);
      }

      if (uncategorizedOnly) params.append('uncategorized_only', 'true');

      const response = await api.get(
        `${BASE_URL}/jobs/${jobId}/photos?${params.toString()}`
      );
      return response.data;
    },

    // Delete photo
    delete: async (photoId: string): Promise<void> => {
      await api.delete(`${BASE_URL}/photos/${photoId}`);
    },

    // Update photo category
    updateCategory: async (photoId: string, category: string): Promise<any> => {
      const formData = new FormData();
      formData.append('category', category);
      const response = await api.patch(`${BASE_URL}/photos/${photoId}/category`, formData);
      return response.data;
    },

    // Bulk update photo categories (can clear by passing empty string or undefined)
    bulkUpdateCategory: async (photoIds: string[], category?: string): Promise<any> => {
      const response = await api.post(`${BASE_URL}/photos/bulk-update-category`, {
        photo_ids: photoIds,
        category: category || ''  // Empty string to clear category
      });
      return response.data;
    },

    // Bulk update photo dates (preserves time, only changes date)
    bulkUpdateDate: async (photoIds: string[], newDate: string): Promise<any> => {
      const response = await api.post(`${BASE_URL}/photos/bulk-update-date`, {
        photo_ids: photoIds,
        new_date: newDate  // Expected format: YYYY-MM-DD
      });
      return response.data;
    }
  },

  // Document Management
  documents: {
    // Generate PDF from selected photos
    generatePdf: async (
      jobId: string,
      photoIds: string[],
      documentType: string,
      jobAddress: string,
      dateOfLoss?: string
    ): Promise<{ id: string; filename: string; file_path: string; document_type: string }> => {
      const response = await api.post(`${BASE_URL}/jobs/${jobId}/documents/generate-pdf`, {
        photo_ids: photoIds,
        document_type: documentType,
        job_address: jobAddress,
        date_of_loss: dateOfLoss
      });
      return response.data;
    },

    // Get all documents for a job
    getByJob: async (jobId: string, documentType?: string): Promise<any[]> => {
      const params = new URLSearchParams();
      if (documentType) params.append('document_type', documentType);

      const response = await api.get(
        `${BASE_URL}/jobs/${jobId}/documents?${params.toString()}`
      );
      return response.data;
    },

    // Delete document
    delete: async (documentId: string): Promise<void> => {
      await api.delete(`${BASE_URL}/documents/${documentId}`);
    },

    // Get document download URL
    getDownloadUrl: (documentId: string): string => {
      return `${BASE_URL}/documents/${documentId}/download`;
    },

    // Get document preview URL (opens in browser)
    getPreviewUrl: (documentId: string): string => {
      return `${BASE_URL}/documents/${documentId}/preview`;
    }
  },

  // Report Config Management
  report: {
    // Get report config for job
    getConfig: async (jobId: string): Promise<ReportConfig> => {
      const response = await api.get(`${BASE_URL}/jobs/${jobId}/report-config`);
      return response.data;
    },

    // Create or update report config
    saveConfig: async (jobId: string, data: ReportConfigCreate): Promise<ReportConfig> => {
      const response = await api.post(`${BASE_URL}/jobs/${jobId}/report-config`, data);
      return response.data;
    },

    // Update report config
    updateConfig: async (jobId: string, data: ReportConfigUpdate): Promise<ReportConfig> => {
      const response = await api.put(`${BASE_URL}/jobs/${jobId}/report-config`, data);
      return response.data;
    },

    // Delete report config
    deleteConfig: async (jobId: string): Promise<void> => {
      await api.delete(`${BASE_URL}/jobs/${jobId}/report-config`);
    },

    // Generate photo report PDF
    generateReport: async (
      jobId: string,
      request: GenerateReportRequest
    ): Promise<Blob> => {
      const response = await api.post(`${BASE_URL}/jobs/${jobId}/generate-report`, request, {
        responseType: 'blob'
      });
      return response.data;
    }
  }
};

export default waterMitigationService;
