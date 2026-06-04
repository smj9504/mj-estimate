/**
 * Rebuild API service
 */

import api from './api';
import type {
  RebuildContractor,
  RebuildProject,
  RebuildProjectCreate,
  RebuildCompletionDoc,
  RebuildDashboardStats,
} from '../types/rebuild';

const BASE = '/api/rebuild';

export const rebuildService = {
  // Contractors
  async listContractors(): Promise<RebuildContractor[]> {
    const { data } = await api.get(`${BASE}/contractors`);
    return data;
  },
  async getContractor(id: string): Promise<RebuildContractor> {
    const { data } = await api.get(`${BASE}/contractors/${id}`);
    return data;
  },
  async createContractor(payload: Partial<RebuildContractor>): Promise<RebuildContractor> {
    const { data } = await api.post(`${BASE}/contractors`, payload);
    return data;
  },
  async updateContractor(id: string, payload: Partial<RebuildContractor>): Promise<RebuildContractor> {
    const { data } = await api.patch(`${BASE}/contractors/${id}`, payload);
    return data;
  },
  async deleteContractor(id: string): Promise<void> {
    await api.delete(`${BASE}/contractors/${id}`);
  },

  // Projects
  async listProjects(params?: {
    status?: string; contractor_id?: string; claim_id?: string;
    page?: number; page_size?: number;
  }): Promise<RebuildProject[]> {
    const { data } = await api.get(`${BASE}/projects`, { params });
    return data;
  },
  async getProjectsByClaim(claimId: string): Promise<RebuildProject[]> {
    const { data } = await api.get(`${BASE}/projects/by-claim/${claimId}`);
    return data;
  },
  async getProject(id: string): Promise<RebuildProject> {
    const { data } = await api.get(`${BASE}/projects/${id}`);
    return data;
  },
  async createProject(payload: RebuildProjectCreate): Promise<RebuildProject> {
    const { data } = await api.post(`${BASE}/projects`, payload);
    return data;
  },
  async updateProject(id: string, payload: Partial<RebuildProject>): Promise<RebuildProject> {
    const { data } = await api.patch(`${BASE}/projects/${id}`, payload);
    return data;
  },
  async deleteProject(id: string): Promise<void> {
    await api.delete(`${BASE}/projects/${id}`);
  },
  async getStats(): Promise<RebuildDashboardStats> {
    const { data } = await api.get(`${BASE}/projects/stats`);
    return data;
  },

  // Completion Docs
  async listDocs(projectId: string): Promise<RebuildCompletionDoc[]> {
    const { data } = await api.get(`${BASE}/projects/${projectId}/docs`);
    return data;
  },
  async createDoc(projectId: string, payload: Partial<RebuildCompletionDoc>): Promise<RebuildCompletionDoc> {
    const { data } = await api.post(`${BASE}/projects/${projectId}/docs`, payload);
    return data;
  },
  async updateDoc(projectId: string, docId: string, payload: Partial<RebuildCompletionDoc>): Promise<RebuildCompletionDoc> {
    const { data } = await api.patch(`${BASE}/projects/${projectId}/docs/${docId}`, payload);
    return data;
  },
  async deleteDoc(projectId: string, docId: string): Promise<void> {
    await api.delete(`${BASE}/projects/${projectId}/docs/${docId}`);
  },

  // Document Generation
  async getAvailableTemplates(projectId: string): Promise<any[]> {
    const { data } = await api.get(`${BASE}/projects/${projectId}/available-templates`);
    return data;
  },
  async getPrefillData(projectId: string): Promise<Record<string, any>> {
    const { data } = await api.get(`${BASE}/projects/${projectId}/prefill-data`);
    return data;
  },
  async generateDocument(projectId: string, payload: {
    template_id: string;
    doc_type: string;
    title: string;
    overrides?: Record<string, string>;
    additional_text?: string;
    signature_image?: string;
    signature_name?: string;
  }): Promise<RebuildCompletionDoc> {
    const { data } = await api.post(`${BASE}/projects/${projectId}/generate-doc`, payload);
    return data;
  },
  async photosToPdf(projectId: string, formData: FormData): Promise<RebuildCompletionDoc> {
    const { data } = await api.post(`${BASE}/projects/${projectId}/photos-to-pdf`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
    return data;
  },
};
