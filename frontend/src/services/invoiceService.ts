import { apiClient } from '../api/config';

export interface InvoiceItem {
  name: string;
  description?: string;
  quantity: number;
  unit: string;
  rate: number;
}

export interface CompanyInfo {
  name: string;
  address?: string;
  city?: string;
  state?: string;
  zipcode?: string;
  phone?: string;
  email?: string;
  logo?: string;
  website?: string;
}

export interface ClientInfo {
  name: string;
  address?: string;
  city?: string;
  state?: string;
  zipcode?: string;
  phone?: string;
  email?: string;
}

export interface InsuranceInfo {
  company?: string;
  policy_number?: string;
  claim_number?: string;
  deductible?: number;
}

export interface InvoiceData {
  invoice_number?: string;
  date?: string;
  due_date?: string;
  status?: string;
  company: CompanyInfo;
  client: ClientInfo;
  insurance?: InsuranceInfo | null;
  items: InvoiceItem[];
  tax_rate?: number;
  discount?: number;
  shipping?: number;
  paid_amount?: number;
  payment_terms?: string;
  notes?: string;
}

export interface InvoiceResponse {
  id: string;
  invoice_number: string;
  date: string;
  due_date: string;
  status: string;
  company_id?: string;
  company_name: string;
  client_name: string;
  total: number;
  paid_amount: number;
  created_at: string;
  updated_at: string;
}

export interface InvoiceDetailResponse extends InvoiceResponse {
  company_address?: string;
  company_city?: string;
  company_state?: string;
  company_zipcode?: string;
  company_phone?: string;
  company_email?: string;
  company_logo?: string;
  
  client_address?: string;
  client_city?: string;
  client_state?: string;
  client_zipcode?: string;
  client_phone?: string;
  client_email?: string;
  
  insurance_company?: string;
  insurance_policy_number?: string;
  insurance_claim_number?: string;
  insurance_deductible?: number;
  
  subtotal: number;
  tax_rate: number;
  tax_amount: number;
  discount: number;
  shipping: number;
  
  payment_terms?: string;
  notes?: string;
  
  items: Array<{
    id: string;
    name: string;
    description?: string;
    quantity: number;
    unit: string;
    rate: number;
    amount: number;
  }>;
}

class InvoiceService {
  async getInvoices(params?: {
    skip?: number;
    limit?: number;
    client_name?: string;
    status?: string;
  }): Promise<InvoiceResponse[]> {
    const response = await apiClient.get('/api/invoices/', { params });
    return response.data.invoices || response.data;
  }

  async getInvoice(id: string): Promise<InvoiceDetailResponse> {
    const response = await apiClient.get(`/api/invoices/${id}`);
    return response.data;
  }

  async createInvoice(data: InvoiceData): Promise<InvoiceDetailResponse> {
    const response = await apiClient.post('/api/invoices/', data);
    return response.data;
  }

  async updateInvoice(id: string, data: Partial<InvoiceData>): Promise<InvoiceDetailResponse> {
    const response = await apiClient.put(`/api/invoices/${id}`, data);
    return response.data;
  }

  async deleteInvoice(id: string): Promise<void> {
    await apiClient.delete(`/api/invoices/${id}`);
  }

  async generatePDF(id: string): Promise<Blob> {
    const response = await apiClient.post(
      `/api/invoices/${id}/pdf`,
      {},
      {
        responseType: 'blob',
      }
    );
    return response.data;
  }

  async previewPDF(data: InvoiceData): Promise<Blob> {
    const response = await apiClient.post(
      '/api/invoices/preview-pdf',
      data,
      {
        responseType: 'blob',
      }
    );
    return response.data;
  }

  async duplicateInvoice(id: string): Promise<InvoiceDetailResponse> {
    const response = await apiClient.post(`/api/invoices/${id}/duplicate`);
    return response.data;
  }

  downloadPDF(blob: Blob, filename: string) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }
}

export const invoiceService = new InvoiceService();