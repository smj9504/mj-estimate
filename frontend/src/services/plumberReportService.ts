import api from './api';

export interface ClientInfo {
  name: string;
  address?: string;
  city?: string;
  state?: string;
  zipcode?: string;
  phone?: string;
  email?: string;
}

export interface PropertyInfo {
  address?: string;
  city?: string;
  state?: string;
  zipcode?: string;
}

export interface InvoiceItem {
  id: string;
  name: string;
  description?: string;
  quantity: number;
  unit?: string;
  unit_cost: number;
  total_cost: number;
}

export interface PaymentRecord {
  amount: number;
  date?: string;
  method?: string;
  reference?: string;
  notes?: string;
}

export interface PhotoRecord {
  id: string;
  url: string;
  category: 'before' | 'during' | 'after' | 'damage' | 'equipment' | 'other';
  caption?: string;
  timestamp?: string;
}

export interface FinancialSummary {
  labor_cost: number;
  materials_cost: number;
  equipment_cost: number;
  subtotal: number;
  tax_amount: number;
  discount: number;
  total_amount: number;
  balance_due: number;
}

export interface PlumberReport {
  id?: string;
  report_number?: string;
  template_type?: string;
  status?: string;
  company_id?: string;
  company_data?: any;
  claim_id?: string;
  client: ClientInfo;
  property: PropertyInfo;
  service_date: string;
  technician_name?: string;
  license_number?: string;
  cause_of_damage?: string;
  work_performed?: string;
  materials_equipment_text?: string;
  recommendations?: string;
  invoice_items?: InvoiceItem[];
  financial?: FinancialSummary;
  payments?: PaymentRecord[];
  show_payment_dates?: boolean;
  photos?: PhotoRecord[];
  warranty_info?: string;
  terms_conditions?: string;
  notes?: string;
  created_at?: string;
  updated_at?: string;
}

export interface PAEmailContact {
  name: string;
  email: string;
  title?: string;
}

export interface PAEmailInfo {
  to: PAEmailContact[];
  cc: PAEmailContact[];
  pa_company?: string;
  job?: {
    id: string;
    property_address: string;
    homeowner_name: string;
    claim_number: string;
    insurance_company: string;
  } | null;
  claim_id?: string;
  email_accounts: Array<{
    id: string;
    email_address: string;
    display_name: string;
    company_id?: string;
  }>;
  report?: {
    id: string;
    report_number: string;
    property_address: string;
    client_name: string;
  };
  message?: string;
}

class PlumberReportService {
  private baseUrl = `/api/plumber-reports`;

  async createReport(report: PlumberReport): Promise<PlumberReport> {
    const response = await api.post(`${this.baseUrl}/`, report);
    return response.data;
  }

  async getReport(id: string): Promise<PlumberReport> {
    const response = await api.get(`${this.baseUrl}/${id}`);
    return response.data;
  }

  async getReports(params?: {
    skip?: number;
    limit?: number;
    status?: string;
    search?: string;
  }): Promise<{
    reports: PlumberReport[];
    total: number;
    page: number;
    limit: number;
  }> {
    const response = await api.get(`${this.baseUrl}/`, { params });
    return response.data;
  }

  async updateReport(id: string, report: Partial<PlumberReport>): Promise<PlumberReport> {
    const response = await api.put(`${this.baseUrl}/${id}`, report);
    return response.data;
  }

  async deleteReport(id: string): Promise<void> {
    await api.delete(`${this.baseUrl}/${id}`);
  }

  async uploadPhoto(
    reportId: string,
    file: File,
    category: string,
    caption?: string
  ): Promise<PhotoRecord> {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('category', category);
    if (caption) {
      formData.append('caption', caption);
    }

    const response = await api.post(`${this.baseUrl}/${reportId}/upload-photo`, formData, {
      headers: {
        'Content-Type': 'multipart/form-data',
      },
    });
    return response.data;
  }

  async generatePDF(reportId: string): Promise<Blob> {
    const response = await api.post(`${this.baseUrl}/${reportId}/generate-pdf`, null, {
      responseType: 'blob',
    });
    return response.data;
  }

  async previewPDF(report: PlumberReport, options?: {
    include_photos?: boolean;
    include_financial?: boolean;
  }): Promise<Blob> {
    const response = await api.post(`${this.baseUrl}/preview-pdf`, {
      report_data: report,
      ...options,
    }, {
      responseType: 'blob',
    });
    return response.data;
  }

  async previewHTML(report: PlumberReport, options?: {
    include_photos?: boolean;
    include_financial?: boolean;
  }): Promise<string> {
    const response = await api.post(`${this.baseUrl}/preview-html`, {
      report_data: report,
      ...options,
    });
    return response.data;
  }

  async duplicateReport(reportId: string): Promise<PlumberReport> {
    const response = await api.get(`${this.baseUrl}/${reportId}/duplicate`);
    return response.data;
  }

  async getPAEmailInfo(reportId: string): Promise<PAEmailInfo> {
    const response = await api.get(`${this.baseUrl}/${reportId}/pa-email-info`);
    return response.data;
  }

  async sendToPA(reportId: string, data: {
    to_addresses: string[];
    cc_addresses?: string[];
    subject: string;
    body_html: string;
    email_account_id?: string;
    from_address?: string;
  }): Promise<{ success: boolean; email_id: string }> {
    const response = await api.post(`${this.baseUrl}/${reportId}/send-to-pa`, data);
    return response.data;
  }

  // Helper methods
  calculateFinancialSummary(
    invoice_items: InvoiceItem[],
    labor_cost: number,
    tax_amount: number,
    discount: number,
    payments: PaymentRecord[]
  ): FinancialSummary {
    const materials_cost = invoice_items
      .reduce((sum, item) => sum + item.total_cost, 0);
    
    const equipment_cost = 0; // Not using equipment cost for invoice items
    
    const subtotal = labor_cost + materials_cost + equipment_cost;
    const total_amount = subtotal + tax_amount - discount;
    const total_paid = payments.reduce((sum, payment) => sum + payment.amount, 0);
    const balance_due = total_amount - total_paid;

    return {
      labor_cost,
      materials_cost,
      equipment_cost,
      subtotal,
      tax_amount,
      discount,
      total_amount,
      balance_due,
    };
  }

  // Generate PLM report number using the new API
  async generateReportNumber(companyId?: string): Promise<string> {
    try {
      const params = new URLSearchParams();
      if (companyId) params.append('company_id', companyId);

      const response = await api.get(`${this.baseUrl}/generate-number?${params.toString()}`);
      return response.data.report_number;
    } catch (error) {
      console.error('Failed to generate report number from API, using fallback:', error);
      // Fallback to local generation
      return this.generateReportNumberFallback();
    }
  }

  // Generate plumber report content using AI
  async generateAI(params: {
    incident_type: string;
    location: string;
    wall_access_type: string;
    pipe_material: string;
    state: string;
    detached_fixture?: string;
    fixture_reinstalled?: boolean;
  }): Promise<{
    site_findings: string;
    work_performed: string;
    invoice_items: Array<{
      name: string;
      description: string;
      quantity: number;
      unit: string;
      unit_cost: number;
    }>;
    subtotal: number;
    tax_amount: number;
    total: number;
    warranty_info: string;
    notes: string;
  }> {
    // 2-step AI pipeline routinely takes 15-25s+; default 30s client timeout
    // cuts it too close and would silently drop a response the backend did
    // finish computing. Give it real headroom.
    const response = await api.post(`${this.baseUrl}/generate-ai`, params, { timeout: 90000 });
    return response.data;
  }

  // Fallback method for report number generation
  private generateReportNumberFallback(): string {
    const date = new Date();
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const random = Math.floor(Math.random() * 1000).toString().padStart(3, '0');
    return `PLM-${year}${month}${day}-${random}`;
  }
}

export const plumberReportService = new PlumberReportService();