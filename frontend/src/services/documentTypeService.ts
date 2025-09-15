import api from './api';
import type { 
  DocumentType, 
  Trade, 
  MeasurementReportType, 
  PriceCalculationParams, 
  PriceCalculationResponse 
} from '../types/documentTypes';

const documentTypeService = {
  // Document Types
  async getDocumentTypes(activeOnly: boolean = true, category?: string): Promise<DocumentType[]> {
    const response = await api.get('/api/document-types/', {
      params: { active_only: activeOnly, category }
    });
    return response.data;
  },

  async getDocumentType(id: string): Promise<DocumentType> {
    const response = await api.get(`/api/document-types/${id}`);
    return response.data;
  },

  async createDocumentType(data: Partial<DocumentType>): Promise<DocumentType> {
    const response = await api.post('/api/document-types/', data);
    return response.data;
  },

  async updateDocumentType(id: string, data: Partial<DocumentType>): Promise<DocumentType> {
    const response = await api.put(`/api/document-types/${id}`, data);
    return response.data;
  },

  async deleteDocumentType(id: string): Promise<void> {
    await api.delete(`/api/document-types/${id}`);
  },

  async calculateDocumentPrice(
    id: string, 
    params: PriceCalculationParams
  ): Promise<PriceCalculationResponse> {
    const response = await api.post(`/api/document-types/${id}/calculate-price`, params);
    return response.data;
  },

  // Trades
  async getTrades(activeOnly: boolean = true, category?: string): Promise<Trade[]> {
    const response = await api.get('/api/trades/', {
      params: { active_only: activeOnly, category }
    });
    return response.data;
  },

  async getTrade(id: string): Promise<Trade> {
    const response = await api.get(`/api/trades/${id}`);
    return response.data;
  },

  async createTrade(data: Partial<Trade>): Promise<Trade> {
    const response = await api.post('/api/trades/', data);
    return response.data;
  },

  async updateTrade(id: string, data: Partial<Trade>): Promise<Trade> {
    const response = await api.put(`/api/trades/${id}`, data);
    return response.data;
  },

  async deleteTrade(id: string): Promise<void> {
    await api.delete(`/api/trades/${id}`);
  },

  // Measurement Report Types
  async getMeasurementReportTypes(
    activeOnly: boolean = true, 
    provider?: string
  ): Promise<MeasurementReportType[]> {
    const response = await api.get('/api/measurement-report-types/', {
      params: { active_only: activeOnly, provider }
    });
    return response.data;
  },

  async getMeasurementReportType(id: string): Promise<MeasurementReportType> {
    const response = await api.get(`/api/measurement-report-types/${id}`);
    return response.data;
  },

  async createMeasurementReportType(data: Partial<MeasurementReportType>): Promise<MeasurementReportType> {
    const response = await api.post('/api/measurement-report-types/', data);
    return response.data;
  },

  async updateMeasurementReportType(
    id: string, 
    data: Partial<MeasurementReportType>
  ): Promise<MeasurementReportType> {
    const response = await api.put(`/api/measurement-report-types/${id}`, data);
    return response.data;
  },

  async deleteMeasurementReportType(id: string): Promise<void> {
    await api.delete(`/api/measurement-report-types/${id}`);
  },

  async calculateReportPrice(id: string, rush: boolean = false): Promise<{ price: number; rush: boolean }> {
    const response = await api.post(`/api/measurement-report-types/${id}/calculate-price`, { rush });
    return response.data;
  },
};

export default documentTypeService;