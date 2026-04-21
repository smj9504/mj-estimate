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
  CompanyCamSyncResult,
  ReportTemplate,
  TemplateCreate,
  TemplateUpdate,
  TemplateListResponse,
  ScopeLocation,
  ScopeLocationCreate,
  ScopeLocationUpdate,
  ScopeLocationListResponse,
  ScopeItem,
  ScopeItemCreate,
  ScopeItemUpdate,
  WMDebrisCalculation,
  CalculateDebrisResponse,
  CalculateFormulaResponse,
  StandardScopeItem,
  StandardScopeItemCreate,
  StandardScopeItemUpdate,
  StandardScopeItemListResponse,
  StandardScopeItemFilters,
  ScopeItemCategory,
  ScopeItemCategoryCreate,
  ScopeItemCategoryUpdate,
  ScopeItemCategoryListResponse,
  ScopeItemCategoryFilters,
  MaterialWeight,
  MaterialWeightListResponse,
  MaterialCategory,
  // Invoice types
  GenerateInvoiceRequest,
  GenerateInvoiceResponse,
  JobInvoiceHistoryResponse,
  ScopeItemInvoiceStatusResponse,
  // Invoice config types
  InvoiceItemConfig,
  InvoiceItemConfigCreate,
  InvoiceItemConfigUpdate,
  InvoiceItemConfigListResponse,
  InvoicePreviewResponse,
  AutoGenerateConfigResult,
  // Standard Item Mapping types (New Approach)
  StandardItemMappingListResponse,
  StandardItemMappingUpdate,
  StandardItemMappingUpdateResult,
  StandardItemMappingPreviewResponse,
} from '../types/waterMitigation';

const BASE_URL = '/api/water-mitigation';

// ─── AI Classification Types ───

export interface AIClassifyMetadata {
  meter_visible: boolean;
  meter_color: 'red' | 'yellow' | 'green' | null;
  is_demolished: boolean;
  equipment_count: number;
  equipment_status: 'operating' | 'stacked' | null;
  mold_visible: boolean;
}

export interface AIClassifyResult {
  photo_id: string;
  category: string;
  confidence: number;
  metadata: AIClassifyMetadata;
  analyzed_at?: string;
  cached?: boolean;
  original_category?: string;
  rule_applied?: string;
  error?: string;
}

export interface AIClassifyResponse {
  success: boolean;
  classified: number;
  failed: number;
  results: AIClassifyResult[];
}

// AI photo category labels for display
export const AI_CATEGORY_LABELS: Record<string, string> = {
  'property-overview': 'Property Overview',
  'wet-area': 'Wet Area',
  'personal-properties': 'Personal Properties',
  'pre-mitigation-moving': 'Pre-Mitigation Moving',
  'demolition': 'Demolition',
  'containment': 'Containment',
  'protection': 'Protection',
  'drying-process': 'Drying Process',
  'day-1': 'Day 1',
  'day-2': 'Day 2',
  'day-3': 'Day 3',
  'documentation': 'Documentation',
  'uncategorized': 'Uncategorized',
};

export const AI_CATEGORY_COLORS: Record<string, string> = {
  'property-overview': '#597ef7',
  'wet-area': '#f5222d',
  'personal-properties': '#eb2f96',
  'pre-mitigation-moving': '#fa8c16',
  'demolition': '#faad14',
  'containment': '#a0d911',
  'protection': '#13c2c2',
  'drying-process': '#1890ff',
  'day-1': '#ff4d4f',
  'day-2': '#ffc53d',
  'day-3': '#52c41a',
  'documentation': '#722ed1',
  'uncategorized': '#bfbfbf',
};

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

    // Upload multiple photos to job
    uploadMultiple: async (jobId: string, files: File[], category?: string): Promise<{
      results: any[];
      failed: { name: string; error: string }[];
    }> => {
      const results: any[] = [];
      const failed: { name: string; error: string }[] = [];

      // Upload files one by one to use the existing backend endpoint
      for (const file of files) {
        try {
          const formData = new FormData();
          formData.append('file', file);
          if (category) formData.append('category', category);

          const response = await api.post(`${BASE_URL}/jobs/${jobId}/photos`, formData, {
            headers: {
              'Content-Type': 'multipart/form-data',
            },
          });
          results.push(response.data);
        } catch (error: any) {
          const errMsg = error?.response?.data?.detail || error.message || 'Unknown error';
          console.error(`Failed to upload ${file.name}:`, errMsg);
          failed.push({ name: file.name, error: errMsg });
        }
      }

      return { results, failed };
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

    // Delete photo (hard delete - permanent)
    delete: async (photoId: string): Promise<void> => {
      await api.delete(`${BASE_URL}/photos/${photoId}`);
    },

    // Move photo to trash (soft delete - recoverable)
    trash: async (photoId: string): Promise<void> => {
      await api.post(`${BASE_URL}/photos/${photoId}/trash`);
    },

    // Restore photo from trash
    restore: async (photoId: string): Promise<void> => {
      await api.post(`${BASE_URL}/photos/${photoId}/restore`);
    },

    // Get trashed photos (optionally filtered by job)
    getTrashed: async (jobId?: string): Promise<{ items: any[]; total: number }> => {
      const params = new URLSearchParams();
      if (jobId) params.append('job_id', jobId);
      const response = await api.get(`${BASE_URL}/photos/trash?${params.toString()}`);
      return response.data;
    },

    // Bulk trash photos
    bulkTrash: async (photoIds: string[]): Promise<void> => {
      await Promise.all(photoIds.map(id => api.post(`${BASE_URL}/photos/${id}/trash`)));
    },

    // Bulk restore photos from trash
    bulkRestore: async (photoIds: string[]): Promise<void> => {
      await Promise.all(photoIds.map(id => api.post(`${BASE_URL}/photos/${id}/restore`)));
    },

    // Bulk delete photos permanently
    bulkDelete: async (photoIds: string[]): Promise<void> => {
      await Promise.all(photoIds.map(id => api.delete(`${BASE_URL}/photos/${id}`)));
    },

    // Update photo category
    updateCategory: async (photoId: string, category: string): Promise<any> => {
      const response = await api.patch(
        `${BASE_URL}/photos/${photoId}/category?category=${encodeURIComponent(category || 'uncategorized')}`
      );
      return response.data;
    },

    // Bulk set individual categories for multiple photos (single request)
    bulkSetCategories: async (updates: { photo_id: string; category: string }[]): Promise<{ applied: number; failed: number }> => {
      const response = await api.post(`${BASE_URL}/photos/bulk-set-categories`, { updates });
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
    },

    // Sync photos from CompanyCam project
    syncFromCompanyCam: async (jobId: string): Promise<CompanyCamSyncResult> => {
      const response = await api.post(`${BASE_URL}/jobs/${jobId}/sync-companycam-photos`);
      return response.data;
    },

    // Bulk update photo dates based on category
    // Day 2 -> start_date + 1, Day 3 -> end_date, Others -> start_date
    bulkUpdateDatesByCategory: async (
      jobId: string,
      mitigationStartDate: string,  // YYYY-MM-DD format
      mitigationEndDate: string     // YYYY-MM-DD format
    ): Promise<{
      success: boolean;
      total_updated: number;
      day2_count: number;
      day3_count: number;
      other_count: number;
      message: string;
    }> => {
      const response = await api.put(
        `${BASE_URL}/jobs/${jobId}/photos/bulk-update-dates-by-category`,
        {
          mitigation_start_date: mitigationStartDate,
          mitigation_end_date: mitigationEndDate
        }
      );
      return response.data;
    },

    // Export photos to Google Drive
    exportToGoogleDrive: async (jobId: string): Promise<{ success: boolean; message: string }> => {
      const response = await api.post(`${BASE_URL}/jobs/${jobId}/export-to-gdrive`);
      return response.data;
    },

    // Get export status
    getExportStatus: async (jobId: string): Promise<{
      status: 'idle' | 'running' | 'completed' | 'cancelled' | 'failed';
      message?: string;
      total_photos?: number;
      uploaded_count?: number;
      skipped_count?: number;
      error_count?: number;
      current_photo?: number;
      current_filename?: string;
      drive_folder_url?: string;
      errors?: string[];
    }> => {
      const response = await api.get(`${BASE_URL}/jobs/${jobId}/export-to-gdrive/status`);
      return response.data;
    },

    // Cancel export
    cancelExport: async (jobId: string): Promise<{ success: boolean; message: string }> => {
      const response = await api.post(`${BASE_URL}/jobs/${jobId}/export-to-gdrive/cancel`);
      return response.data;
    },

    // ─── AI Photo Classification ───

    // Classify multiple photos using AI
    aiClassify: async (photoIds: string[], forceRefresh: boolean = false, signal?: AbortSignal): Promise<AIClassifyResponse> => {
      const response = await api.post(`${BASE_URL}/photos/ai-classify`, {
        photo_ids: photoIds,
        force_refresh: forceRefresh,
      }, { signal });
      return response.data;
    },

    // Classify a single photo using AI
    aiClassifySingle: async (photoId: string, forceRefresh: boolean = false): Promise<AIClassifyResult> => {
      const response = await api.post(
        `${BASE_URL}/photos/${photoId}/ai-classify?force_refresh=${forceRefresh}`
      );
      return response.data;
    },

    // Get cached AI classification results for a job
    aiResults: async (jobId: string): Promise<{ total: number; results: AIClassifyResult[] }> => {
      const response = await api.get(`${BASE_URL}/jobs/${jobId}/ai-results`);
      return response.data;
    },

    // Detect visually duplicate photos using perceptual hashing
    detectDuplicates: async (jobId: string, threshold: number = 10): Promise<{
      groups: Array<{
        best_photo_id: string;
        photos: Array<{
          photo_id: string;
          hash: string;
          file_name: string;
          file_size: number;
          category: string;
          captured_date: string | null;
        }>;
        count: number;
      }>;
      total_duplicates: number;
      total_photos_analyzed: number;
    }> => {
      const response = await api.post(`${BASE_URL}/jobs/${jobId}/photos/detect-duplicates?threshold=${threshold}`);
      return response.data;
    },

    // Apply AI classification to photo (updates the photo's category)
    aiApply: async (photoId: string): Promise<any> => {
      const response = await api.post(`${BASE_URL}/photos/${photoId}/ai-apply`);
      return response.data;
    },

    // Apply AI classification to multiple photos (batch)
    aiApplyBulk: async (photoIds: string[]): Promise<{ applied: number; failed: number }> => {
      let applied = 0;
      let failed = 0;
      for (const id of photoIds) {
        try {
          await api.post(`${BASE_URL}/photos/${id}/ai-apply`);
          applied++;
        } catch {
          failed++;
        }
      }
      return { applied, failed };
    },
  },

  // Document Management
  documents: {
    // Generate PDF from selected photos
    generatePdf: async (
      jobId: string,
      photoIds: string[],
      documentType: string,
      jobAddress: string,
      dateOfLoss?: string,
      mitigationStartDate?: string,  // Used for EWA document
      rotations?: Record<string, number>,  // {photoId: degrees (0, 90, 180, 270)}
      customFilename?: string,  // Custom filename for Custom document type
      compress?: boolean  // Compress PDF to reduce file size
    ): Promise<{ id: string; filename: string; file_path: string; document_type: string }> => {
      const response = await api.post(`${BASE_URL}/jobs/${jobId}/documents/generate-pdf`, {
        photo_ids: photoIds,
        document_type: documentType,
        job_address: jobAddress,
        date_of_loss: dateOfLoss,
        mitigation_start_date: mitigationStartDate,
        rotations: rotations,
        custom_filename: customFilename,
        compress: compress || false
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
    },

    // Upload annotated PDF with annotation data for re-editing
    uploadAnnotatedPdf: async (
      jobId: string,
      pdfBlob: Blob,
      filename: string,
      annotationData?: string,
      documentId?: string
    ): Promise<any> => {
      const formData = new FormData();
      formData.append('pdf_file', pdfBlob, filename);
      formData.append('filename', filename);
      if (annotationData) formData.append('annotation_data', annotationData);
      if (documentId) formData.append('document_id', documentId);

      const response = await api.post(
        `${BASE_URL}/jobs/${jobId}/documents/upload-annotated-pdf`,
        formData,
        { headers: { 'Content-Type': 'multipart/form-data' } }
      );
      return response.data;
    },

    // Upload source PDF for annotation
    uploadSourcePdf: async (jobId: string, file: File): Promise<{ filename: string; url: string }> => {
      const formData = new FormData();
      formData.append('pdf_file', file);

      const response = await api.post(
        `${BASE_URL}/jobs/${jobId}/documents/upload-source-pdf`,
        formData,
        { headers: { 'Content-Type': 'multipart/form-data' } }
      );
      return response.data;
    },
  },

  // Report Config Management
  report: {
    // Get report config for job
    getConfig: async (jobId: string): Promise<ReportConfig | null> => {
      try {
        const response = await api.get(`${BASE_URL}/jobs/${jobId}/report-config`);
        return response.data;
      } catch (error: any) {
        if (error.response?.status === 404) {
          return null;
        }
        throw error;
      }
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
  },

  // Template Management
  templates: {
    // List all templates
    list: async (): Promise<TemplateListResponse> => {
      const response = await api.get(`${BASE_URL}/templates`);
      return response.data;
    },

    // Get template by ID
    get: async (templateId: string): Promise<ReportTemplate> => {
      const response = await api.get(`${BASE_URL}/templates/${templateId}`);
      return response.data;
    },

    // Create new template
    create: async (data: TemplateCreate): Promise<ReportTemplate> => {
      const response = await api.post(`${BASE_URL}/templates`, data);
      return response.data;
    },

    // Update template
    update: async (templateId: string, data: TemplateUpdate): Promise<ReportTemplate> => {
      const response = await api.put(`${BASE_URL}/templates/${templateId}`, data);
      return response.data;
    },

    // Delete template
    delete: async (templateId: string): Promise<void> => {
      await api.delete(`${BASE_URL}/templates/${templateId}`);
    },

    // Clone template
    clone: async (templateId: string, newName: string): Promise<ReportTemplate> => {
      const response = await api.post(`${BASE_URL}/templates/${templateId}/clone`, { name: newName });
      return response.data;
    },

    // Get default template
    getDefault: async (): Promise<ReportTemplate> => {
      const response = await api.get(`${BASE_URL}/templates/default`);
      return response.data;
    },

    // Create report config from template
    createConfigFromTemplate: async (templateId: string, jobId: string): Promise<ReportConfig> => {
      const response = await api.post(`${BASE_URL}/templates/${templateId}/create-config`, { job_id: jobId });
      return response.data;
    }
  },

  // Scope of Work Management
  scope: {
    // Location Management
    locations: {
      // List locations for a job
      listByJob: async (jobId: string, includeItems: boolean = true): Promise<ScopeLocationListResponse> => {
        const response = await api.get(`${BASE_URL}/scope/jobs/${jobId}/locations`, {
          params: { include_items: includeItems }
        });
        return response.data;
      },

      // Create location
      create: async (data: ScopeLocationCreate): Promise<ScopeLocation> => {
        const response = await api.post(`${BASE_URL}/scope/locations`, data);
        return response.data;
      },

      // Update location
      update: async (locationId: string, data: ScopeLocationUpdate): Promise<ScopeLocation> => {
        const response = await api.put(`${BASE_URL}/scope/locations/${locationId}`, data);
        return response.data;
      },

      // Delete location
      delete: async (locationId: string): Promise<void> => {
        await api.delete(`${BASE_URL}/scope/locations/${locationId}`);
      },

      // Add standard items to location
      addStandardItems: async (locationId: string): Promise<ScopeItem[]> => {
        const response = await api.post(`${BASE_URL}/scope/locations/${locationId}/add-standard-items`);
        return response.data;
      }
    },

    // Item Management
    items: {
      // Create item
      create: async (data: ScopeItemCreate): Promise<ScopeItem> => {
        const response = await api.post(`${BASE_URL}/scope/items`, data);
        return response.data;
      },

      // Update item
      update: async (itemId: string, data: ScopeItemUpdate): Promise<ScopeItem> => {
        const response = await api.put(`${BASE_URL}/scope/items/${itemId}`, data);
        return response.data;
      },

      // Delete item
      delete: async (itemId: string): Promise<void> => {
        await api.delete(`${BASE_URL}/scope/items/${itemId}`);
      }
    },

    // Debris Calculation
    debris: {
      // Get debris calculation for a job
      get: async (jobId: string): Promise<WMDebrisCalculation | null> => {
        try {
          const response = await api.get(`${BASE_URL}/scope/jobs/${jobId}/debris-calculation`);
          return response.data;
        } catch (error: any) {
          if (error?.response?.status === 404) {
            return null;
          }
          throw error;
        }
      },

      // Calculate debris for a job
      calculate: async (jobId: string, saveResult: boolean = true): Promise<CalculateDebrisResponse> => {
        const response = await api.post(`${BASE_URL}/scope/jobs/${jobId}/calculate-debris`, {
          save_result: saveResult
        });
        return response.data;
      }
    },

    // Formula Calculation
    calculateFormula: async (formula: string): Promise<CalculateFormulaResponse> => {
      const response = await api.post(`${BASE_URL}/scope/calculate-formula`, { formula });
      return response.data;
    }
  },

  // Standard Scope Items Management (Template Items)
  standardScopeItems: {
    // List standard scope items with filters
    list: async (filters?: StandardScopeItemFilters): Promise<StandardScopeItemListResponse> => {
      const params = new URLSearchParams();

      if (filters?.company_id) params.append('company_id', filters.company_id);
      if (filters?.item_type) params.append('item_type', filters.item_type);
      if (filters?.category_id) params.append('category_id', filters.category_id);
      if (filters?.is_active !== undefined) params.append('is_active', String(filters.is_active));
      if (filters?.search) params.append('search', filters.search);
      if (filters?.include_system !== undefined) params.append('include_system', String(filters.include_system));
      if (filters?.page) params.append('page', String(filters.page));
      if (filters?.page_size) params.append('page_size', String(filters.page_size));

      const response = await api.get(`${BASE_URL}/standard-scope-items?${params.toString()}`);
      return response.data;
    },

    // Get single item by ID
    get: async (itemId: string): Promise<StandardScopeItem> => {
      const response = await api.get(`${BASE_URL}/standard-scope-items/${itemId}`);
      return response.data;
    },

    // Create new item
    create: async (data: StandardScopeItemCreate): Promise<StandardScopeItem> => {
      const response = await api.post(`${BASE_URL}/standard-scope-items`, data);
      return response.data;
    },

    // Update item
    update: async (itemId: string, data: StandardScopeItemUpdate): Promise<StandardScopeItem> => {
      const response = await api.put(`${BASE_URL}/standard-scope-items/${itemId}`, data);
      return response.data;
    },

    // Delete item (soft delete by default)
    delete: async (itemId: string, hardDelete: boolean = false): Promise<void> => {
      await api.delete(`${BASE_URL}/standard-scope-items/${itemId}`, {
        params: { hard_delete: hardDelete }
      });
    },

    // Restore soft-deleted item
    restore: async (itemId: string): Promise<StandardScopeItem> => {
      const response = await api.post(`${BASE_URL}/standard-scope-items/${itemId}/restore`);
      return response.data;
    },

    // Duplicate item
    duplicate: async (itemId: string, newName?: string, targetCompanyId?: string): Promise<StandardScopeItem> => {
      const params = new URLSearchParams();
      if (newName) params.append('new_name', newName);
      if (targetCompanyId) params.append('target_company_id', targetCompanyId);

      const response = await api.post(`${BASE_URL}/standard-scope-items/${itemId}/duplicate?${params.toString()}`);
      return response.data;
    },

    // Reorder items
    reorder: async (itemOrders: Array<{ id: string; display_order: number }>): Promise<StandardScopeItem[]> => {
      const response = await api.post(`${BASE_URL}/standard-scope-items/reorder`, itemOrders);
      return response.data;
    },

    // Seed default items (migrate hardcoded items to database)
    seedDefaults: async (companyId?: string): Promise<StandardScopeItem[]> => {
      const params = new URLSearchParams();
      if (companyId) params.append('company_id', companyId);

      const response = await api.post(`${BASE_URL}/standard-scope-items/seed-defaults?${params.toString()}`);
      return response.data;
    }
  },

  // Scope Item Categories Management
  scopeItemCategories: {
    // List categories with filters
    list: async (filters?: ScopeItemCategoryFilters): Promise<ScopeItemCategoryListResponse> => {
      const params = new URLSearchParams();

      if (filters?.company_id) params.append('company_id', filters.company_id);
      if (filters?.is_active !== undefined) params.append('is_active', String(filters.is_active));
      if (filters?.search) params.append('search', filters.search);
      if (filters?.include_system !== undefined) params.append('include_system', String(filters.include_system));
      if (filters?.page) params.append('page', String(filters.page));
      if (filters?.page_size) params.append('page_size', String(filters.page_size));

      const response = await api.get(`${BASE_URL}/scope-item-categories?${params.toString()}`);
      return response.data;
    },

    // Get single category by ID
    get: async (categoryId: string): Promise<ScopeItemCategory> => {
      const response = await api.get(`${BASE_URL}/scope-item-categories/${categoryId}`);
      return response.data;
    },

    // Create new category
    create: async (data: ScopeItemCategoryCreate): Promise<ScopeItemCategory> => {
      const response = await api.post(`${BASE_URL}/scope-item-categories`, data);
      return response.data;
    },

    // Update category
    update: async (categoryId: string, data: ScopeItemCategoryUpdate): Promise<ScopeItemCategory> => {
      const response = await api.put(`${BASE_URL}/scope-item-categories/${categoryId}`, data);
      return response.data;
    },

    // Delete category (soft delete by default)
    delete: async (categoryId: string, hardDelete: boolean = false): Promise<void> => {
      await api.delete(`${BASE_URL}/scope-item-categories/${categoryId}`, {
        params: { hard_delete: hardDelete }
      });
    },

    // Restore soft-deleted category
    restore: async (categoryId: string): Promise<ScopeItemCategory> => {
      const response = await api.post(`${BASE_URL}/scope-item-categories/${categoryId}/restore`);
      return response.data;
    },

    // Duplicate category
    duplicate: async (categoryId: string, newName?: string, targetCompanyId?: string): Promise<ScopeItemCategory> => {
      const params = new URLSearchParams();
      if (newName) params.append('new_name', newName);
      if (targetCompanyId) params.append('target_company_id', targetCompanyId);

      const response = await api.post(`${BASE_URL}/scope-item-categories/${categoryId}/duplicate?${params.toString()}`);
      return response.data;
    },

    // Reorder categories
    reorder: async (categoryOrders: Array<{ id: string; display_order: number }>): Promise<ScopeItemCategory[]> => {
      const response = await api.post(`${BASE_URL}/scope-item-categories/reorder`, categoryOrders);
      return response.data;
    },

    // Seed default categories
    seedDefaults: async (companyId?: string): Promise<ScopeItemCategory[]> => {
      const params = new URLSearchParams();
      if (companyId) params.append('company_id', companyId);

      const response = await api.post(`${BASE_URL}/scope-item-categories/seed-defaults?${params.toString()}`);
      return response.data;
    }
  },

  // Material Weights (for debris calculation)
  materialWeights: {
    // List all material weights with optional filters
    list: async (filters?: {
      category_id?: string;
      active_only?: boolean;
      search?: string;
    }): Promise<MaterialWeightListResponse> => {
      const params = new URLSearchParams();
      if (filters?.category_id) params.append('category_id', filters.category_id);
      if (filters?.active_only !== undefined) params.append('active_only', String(filters.active_only));
      if (filters?.search) params.append('search', filters.search);

      const response = await api.get(`/api/reconstruction-estimate/materials?${params.toString()}`);
      return response.data;
    },

    // List material categories
    listCategories: async (): Promise<MaterialCategory[]> => {
      const response = await api.get('/api/reconstruction-estimate/categories');
      return response.data;
    }
  },

  // ============================================================================
  // Scope Invoice API
  // ============================================================================
  scopeInvoice: {
    // Generate invoice from scope items
    generateInvoice: async (
      jobId: string,
      request: GenerateInvoiceRequest
    ): Promise<GenerateInvoiceResponse> => {
      const response = await api.post(
        `${BASE_URL}/scope/jobs/${jobId}/generate-invoice`,
        request
      );
      return response.data;
    },

    // Get invoice history for a job
    getInvoiceHistory: async (jobId: string): Promise<JobInvoiceHistoryResponse> => {
      const response = await api.get(`${BASE_URL}/scope/jobs/${jobId}/invoice-history`);
      return response.data;
    },

    // Get invoice status for all scope items in a job
    getScopeItemsInvoiceStatus: async (
      jobId: string
    ): Promise<ScopeItemInvoiceStatusResponse[]> => {
      const response = await api.get(
        `${BASE_URL}/scope/jobs/${jobId}/scope-items/invoice-status`
      );
      return response.data;
    },

    // Get count of uninvoiced scope items
    getUninvoicedCount: async (jobId: string): Promise<{ uninvoiced_count: number }> => {
      const response = await api.get(`${BASE_URL}/scope/jobs/${jobId}/uninvoiced-count`);
      return response.data;
    },

    // Reset scope items' invoiced status for a job
    resetInvoiceStatus: async (jobId: string): Promise<{
      success: boolean;
      items_reset: number;
      message: string;
    }> => {
      const response = await api.post(
        `${BASE_URL}/scope/jobs/${jobId}/reset-invoice-status`
      );
      return response.data;
    },

    // Delete a WM invoice and reset scope items
    deleteInvoice: async (invoiceId: string): Promise<{
      success: boolean;
      message: string;
      job_id?: string;
      items_reset?: boolean;
    }> => {
      const response = await api.delete(
        `${BASE_URL}/scope/invoices/${invoiceId}`
      );
      return response.data;
    }
  },

  // ============================================================================
  // Invoice Item Configuration API
  // ============================================================================
  invoiceConfig: {
    // Get all invoice item configurations for a job
    list: async (
      jobId: string,
      includeCalculated: boolean = true
    ): Promise<InvoiceItemConfigListResponse> => {
      const response = await api.get(
        `${BASE_URL}/scope/jobs/${jobId}/invoice-configs`,
        { params: { include_calculated: includeCalculated } }
      );
      return response.data;
    },

    // Create a new invoice item configuration
    create: async (
      jobId: string,
      data: Omit<InvoiceItemConfigCreate, 'job_id'>
    ): Promise<InvoiceItemConfig> => {
      const response = await api.post(
        `${BASE_URL}/scope/jobs/${jobId}/invoice-configs`,
        data
      );
      return response.data;
    },

    // Bulk create invoice item configurations
    bulkCreate: async (
      jobId: string,
      configs: Array<Omit<InvoiceItemConfigCreate, 'job_id'>>
    ): Promise<{ created: number; items: InvoiceItemConfig[] }> => {
      const response = await api.post(
        `${BASE_URL}/scope/jobs/${jobId}/invoice-configs/bulk`,
        configs
      );
      return response.data;
    },

    // Update an invoice item configuration
    update: async (
      configId: string,
      data: InvoiceItemConfigUpdate
    ): Promise<InvoiceItemConfig> => {
      const response = await api.put(
        `${BASE_URL}/scope/invoice-configs/${configId}`,
        data
      );
      return response.data;
    },

    // Delete an invoice item configuration
    delete: async (configId: string): Promise<void> => {
      await api.delete(`${BASE_URL}/scope/invoice-configs/${configId}`);
    },

    // Auto-generate invoice item configurations from scope items
    autoGenerate: async (
      jobId: string,
      templateId: string,
      overwrite: boolean = false
    ): Promise<AutoGenerateConfigResult> => {
      const response = await api.post(
        `${BASE_URL}/scope/jobs/${jobId}/invoice-configs/auto-generate`,
        null,
        { params: { template_id: templateId, overwrite } }
      );
      return response.data;
    },

    // Preview invoice generation
    previewInvoice: async (
      jobId: string,
      templateId: string
    ): Promise<InvoicePreviewResponse> => {
      const response = await api.post(
        `${BASE_URL}/scope/jobs/${jobId}/preview-invoice`,
        null,
        { params: { template_id: templateId } }
      );
      return response.data;
    }
  },

  // ============================================================================
  // Standard Scope Item Mapping API (New Approach)
  // ============================================================================
  standardItemMappings: {
    /**
     * Get all standard scope items with their invoice line item mappings.
     * This is the recommended approach for invoice configuration:
     * - Configure mappings once at the standard item level
     * - All jobs using these items will inherit the mappings
     */
    list: async (companyId?: string): Promise<StandardItemMappingListResponse> => {
      const params = new URLSearchParams();
      if (companyId) params.append('company_id', companyId);

      const response = await api.get(
        `${BASE_URL}/scope/standard-item-mappings?${params.toString()}`
      );
      return response.data;
    },

    /**
     * Update invoice mapping for a Standard Scope Item.
     * This configures how this scope item type maps to invoice line items.
     */
    update: async (
      standardItemId: string,
      data: StandardItemMappingUpdate
    ): Promise<StandardItemMappingUpdateResult> => {
      const response = await api.put(
        `${BASE_URL}/scope/standard-item-mappings/${standardItemId}`,
        data
      );
      return response.data;
    },

    /**
     * Preview invoice using standard scope item mappings.
     * Aggregates quantities per item type across all locations.
     */
    previewInvoice: async (
      jobId: string,
      companyId?: string
    ): Promise<StandardItemMappingPreviewResponse> => {
      const params = new URLSearchParams();
      if (companyId) params.append('company_id', companyId);

      const response = await api.post(
        `${BASE_URL}/scope/jobs/${jobId}/preview-invoice-from-mappings?${params.toString()}`
      );
      return response.data;
    }
  },

  // ============================================================================
  // General Conditions Template Management API
  // ============================================================================
  generalConditions: {
    /**
     * Get the status of the General Conditions template.
     * Returns whether the template exists and its line items.
     */
    getStatus: async (): Promise<{
      exists: boolean;
      template_id: string;
      template_name?: string;
      item_count: number;
      items: Array<{
        id: string;
        line_item_id: string | null;
        description: string;
        rate: number;
        unit: string;
        is_embedded?: boolean;
      }>;
    }> => {
      const response = await api.get(`${BASE_URL}/scope/general-conditions/status`);
      return response.data;
    },

    /**
     * Seed the General Conditions template with necessary line items.
     * Call this if GC items are not appearing in invoices.
     */
    seed: async (): Promise<{
      success: boolean;
      template_id: string;
      added_count: number;
      skipped_count: number;
      not_found: string[];
      message: string;
    }> => {
      const response = await api.post(`${BASE_URL}/scope/general-conditions/seed`);
      return response.data;
    }
  }
};

export default waterMitigationService;
