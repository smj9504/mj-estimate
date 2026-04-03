import { apiClient } from '../api/config';
import { InsuranceExtraction, InsuranceExtractionUpdatePayload } from '../types/insuranceExtraction';

class InsuranceExtractionService {
  async extractFromFile(fileId: string): Promise<InsuranceExtraction> {
    const response = await apiClient.post(`/api/insurance-extractions/from-file/${fileId}`);
    return response.data;
  }

  async getExtraction(extractionId: string): Promise<InsuranceExtraction> {
    const response = await apiClient.get(`/api/insurance-extractions/${extractionId}`);
    return response.data;
  }

  async listExtractions(limit = 50): Promise<InsuranceExtraction[]> {
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
}

export const insuranceExtractionService = new InsuranceExtractionService();
