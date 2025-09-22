import axios from 'axios';

const API_BASE_URL = process.env.REACT_APP_API_URL || 'http://localhost:8000';

export interface PlumberReportTemplate {
  id: string;
  name: string;
  type: 'warranty' | 'terms' | 'notes';
  description?: string;
  usage_count: number;
  updated_at: string;
}

export interface PlumberReportTemplateDetail {
  id: string;
  company_id: string;
  name: string;
  type: 'warranty' | 'terms' | 'notes';
  content: string;
  description?: string;
  is_active: boolean;
  usage_count: number;
  created_at: string;
  updated_at: string;
}

export interface PlumberReportTemplateContent {
  content: string;
  template_id: string;
  template_name: string;
}

export interface PlumberReportTemplateCreate {
  name: string;
  type: 'warranty' | 'terms' | 'notes';
  content: string;
  description?: string;
}

export interface PlumberReportTemplateSearchFilters {
  type?: 'warranty' | 'terms' | 'notes';
  search?: string;
  is_active?: boolean;
  sort_by?: string;
  sort_order?: 'asc' | 'desc';
}

class PlumberReportTemplateService {
  private apiUrl = `${API_BASE_URL}/api/plumber-report-templates`;

  async getTemplates(
    companyId: string,
    filters?: PlumberReportTemplateSearchFilters
  ): Promise<PlumberReportTemplate[]> {
    const params = new URLSearchParams({ company_id: companyId });

    if (filters?.type) params.append('template_type', filters.type);
    if (filters?.search) params.append('search', filters.search);
    if (filters?.is_active !== undefined) params.append('is_active', filters.is_active.toString());
    if (filters?.sort_by) params.append('sort_by', filters.sort_by);
    if (filters?.sort_order) params.append('sort_order', filters.sort_order);

    const response = await axios.get(`${this.apiUrl}?${params}`);
    return response.data;
  }

  async getTemplatesByType(
    companyId: string,
    type: 'warranty' | 'terms' | 'notes'
  ): Promise<PlumberReportTemplate[]> {
    const response = await axios.get(
      `${this.apiUrl}/by-type/${type}?company_id=${companyId}`
    );
    return response.data;
  }

  async getQuickTemplates(
    companyId: string,
    type: 'warranty' | 'terms' | 'notes'
  ): Promise<PlumberReportTemplate[]> {
    const response = await axios.get(
      `${this.apiUrl}/quick/${type}?company_id=${companyId}`
    );
    return response.data;
  }

  async getTemplate(templateId: string): Promise<PlumberReportTemplateDetail> {
    const response = await axios.get(`${this.apiUrl}/${templateId}`);
    return response.data;
  }

  async createTemplate(
    companyId: string,
    userId: string,
    templateData: PlumberReportTemplateCreate
  ): Promise<PlumberReportTemplateDetail> {
    const response = await axios.post(
      `${this.apiUrl}?company_id=${companyId}&user_id=${userId}`,
      templateData
    );
    return response.data;
  }

  async updateTemplate(
    templateId: string,
    companyId: string,
    templateData: Partial<PlumberReportTemplateCreate>
  ): Promise<PlumberReportTemplateDetail> {
    const response = await axios.put(
      `${this.apiUrl}/${templateId}?company_id=${companyId}`,
      templateData
    );
    return response.data;
  }

  async deleteTemplate(templateId: string, companyId: string): Promise<void> {
    await axios.delete(`${this.apiUrl}/${templateId}?company_id=${companyId}`);
  }

  async useTemplate(
    templateId: string,
    companyId: string,
    userId: string,
    reportId?: string
  ): Promise<PlumberReportTemplateContent> {
    const params = new URLSearchParams({
      company_id: companyId,
      user_id: userId,
    });

    if (reportId) {
      params.append('report_id', reportId);
    }

    const response = await axios.post(`${this.apiUrl}/${templateId}/use?${params}`);
    return response.data;
  }
}

export const plumberReportTemplateService = new PlumberReportTemplateService();