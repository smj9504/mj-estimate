import { apiClient } from '../api/config';
import {
  RepairCondition,
  RepairConditionCreate,
  RepairConditionUpdate,
  RepairTemplateCreate,
  RepairTemplateDetail,
  RepairTemplateListItem,
  RepairTemplateUpdate,
  TemplateApplyResponse,
  TemplateCompareResponse,
} from '../types/repairSpec';

class RepairSpecService {
  // ── Conditions ──

  async listConditions(params?: {
    company_id?: string;
    category?: string;
  }): Promise<RepairCondition[]> {
    const response = await apiClient.get('/api/repair-conditions', { params });
    return response.data;
  }

  async getCondition(id: string): Promise<RepairCondition> {
    const response = await apiClient.get(`/api/repair-conditions/${id}`);
    return response.data;
  }

  async createCondition(data: RepairConditionCreate): Promise<RepairCondition> {
    const response = await apiClient.post('/api/repair-conditions', data);
    return response.data;
  }

  async updateCondition(id: string, data: RepairConditionUpdate): Promise<RepairCondition> {
    const response = await apiClient.put(`/api/repair-conditions/${id}`, data);
    return response.data;
  }

  async deleteCondition(id: string): Promise<void> {
    await apiClient.delete(`/api/repair-conditions/${id}`);
  }

  // ── Templates ──

  async listTemplates(params?: {
    company_id?: string;
    surface?: string;
  }): Promise<RepairTemplateListItem[]> {
    const response = await apiClient.get('/api/repair-templates', { params });
    return response.data;
  }

  async getTemplate(id: string): Promise<RepairTemplateDetail> {
    const response = await apiClient.get(`/api/repair-templates/${id}`);
    return response.data;
  }

  async createTemplate(data: RepairTemplateCreate): Promise<RepairTemplateDetail> {
    const response = await apiClient.post('/api/repair-templates', data);
    return response.data;
  }

  async updateTemplate(id: string, data: RepairTemplateUpdate): Promise<RepairTemplateDetail> {
    const response = await apiClient.put(`/api/repair-templates/${id}`, data);
    return response.data;
  }

  async deleteTemplate(id: string): Promise<void> {
    await apiClient.delete(`/api/repair-templates/${id}`);
  }

  // ── Apply / Compare ──

  async applyTemplate(
    templateId: string,
    conditionIds: string[],
  ): Promise<TemplateApplyResponse> {
    const response = await apiClient.post(`/api/repair-templates/${templateId}/apply`, {
      condition_ids: conditionIds,
    });
    return response.data;
  }

  async compareTemplate(
    templateId: string,
    conditionIds: string[],
    extractionId: string,
    roomName?: string,
  ): Promise<TemplateCompareResponse> {
    const response = await apiClient.post(`/api/repair-templates/${templateId}/compare`, {
      condition_ids: conditionIds,
      extraction_id: extractionId,
      room_name: roomName,
    });
    return response.data;
  }
}

export const repairSpecService = new RepairSpecService();
