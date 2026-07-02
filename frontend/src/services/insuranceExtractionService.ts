import { apiClient } from '../api/config';
import {
  ExtractionAnalysisResponse,
  InsuranceExtraction,
  InsuranceExtractionSummary,
  InsuranceExtractionUpdatePayload,
} from '../types/insuranceExtraction';

class InsuranceExtractionService {
  async extractFromFile(fileId: string): Promise<InsuranceExtraction> {
    const response = await apiClient.post(`/api/insurance-extractions/from-file/${fileId}`);
    return response.data;
  }

  async getExtraction(extractionId: string): Promise<InsuranceExtraction> {
    const response = await apiClient.get(`/api/insurance-extractions/${extractionId}`);
    return response.data;
  }

  async listExtractions(limit = 50): Promise<InsuranceExtractionSummary[]> {
    const response = await apiClient.get('/api/insurance-extractions', { params: { limit } });
    return response.data;
  }

  async updateExtraction(extractionId: string, payload: InsuranceExtractionUpdatePayload): Promise<InsuranceExtraction> {
    const response = await apiClient.put(`/api/insurance-extractions/${extractionId}`, payload);
    return response.data;
  }

  async deleteExtraction(extractionId: string): Promise<void> {
    await apiClient.delete(`/api/insurance-extractions/${extractionId}`);
  }

  async getAnalysis(extractionId: string): Promise<ExtractionAnalysisResponse> {
    const response = await apiClient.get(`/api/insurance-extractions/${extractionId}/analysis`);
    return response.data;
  }

  async bulkDeleteExtractions(ids: string[]): Promise<void> {
    await apiClient.post('/api/insurance-extractions/bulk-delete', { ids });
  }
}

export const insuranceExtractionService = new InsuranceExtractionService();
