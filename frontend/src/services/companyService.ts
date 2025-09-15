import { apiClient } from '../api/config';
import { Company, CompanyFormData } from '../types';

export const companyService = {
  // Get all companies with optional filters
  getCompanies: async (search?: string, city?: string, state?: string): Promise<Company[]> => {
    const params = new URLSearchParams();
    if (search) params.append('search', search);
    if (city) params.append('city', city);
    if (state) params.append('state', state);
    
    const url = `/api/companies/?${params.toString()}`;
    console.log('Requesting companies from:', url);
    const response = await apiClient.get(url);
    // Backend returns PaginatedResponse with 'items' field
    return response.data.items || [];
  },

  // Get single company by ID
  getCompany: async (id: string): Promise<Company> => {
    const response = await apiClient.get(`/api/companies/${id}`);
    // Backend returns CompanyResponse directly
    return response.data;
  },

  // Create new company
  createCompany: async (data: CompanyFormData): Promise<Company> => {
    const response = await apiClient.post('/api/companies/', data);
    // Backend returns CompanyResponse directly
    return response.data;
  },

  // Update existing company
  updateCompany: async (id: string, data: Partial<CompanyFormData>): Promise<Company> => {
    const response = await apiClient.put(`/api/companies/${id}`, data);
    // Backend returns CompanyResponse directly
    return response.data;
  },

  // Delete company
  deleteCompany: async (id: string): Promise<void> => {
    console.log('Deleting company with ID:', id);
    const response = await apiClient.delete(`/api/companies/${id}`);
    console.log('Delete response:', response);
    return response.data;
  },

  // Upload company logo
  uploadLogo: async (companyId: string, file: File): Promise<string> => {
    const formData = new FormData();
    formData.append('file', file);
    
    const response = await apiClient.post(`/api/companies/${companyId}/logo`, formData, {
      headers: {
        'Content-Type': 'multipart/form-data',
      },
    });
    return response.data.logo;
  },

  // Search companies with pagination
  searchCompanies: async (
    q: string, 
    city?: string, 
    state?: string, 
    page: number = 1, 
    perPage: number = 10
  ): Promise<{ items: Company[], total: number, page: number, pages: number }> => {
    const params = new URLSearchParams();
    params.append('q', q);
    if (city) params.append('city', city);
    if (state) params.append('state', state);
    params.append('page', page.toString());
    params.append('per_page', perPage.toString());
    
    const response = await apiClient.get(`/api/companies/search?${params.toString()}`);
    return response.data;
  },

  // Get company by email
  getCompanyByEmail: async (email: string): Promise<Company> => {
    const response = await apiClient.get(`/api/companies/by-email/${encodeURIComponent(email)}`);
    return response.data;
  },

  // Get companies with statistics
  getCompaniesWithStats: async (): Promise<any[]> => {
    const response = await apiClient.get('/api/companies/stats');
    return response.data;
  },

  // Get companies summary statistics
  getCompaniesSummaryStats: async (): Promise<{
    total_companies: number;
    active_companies: number;
    inactive_companies: number;
    default_companies: number;
  }> => {
    const response = await apiClient.get('/api/companies/stats/summary');
    return response.data;
  },
};