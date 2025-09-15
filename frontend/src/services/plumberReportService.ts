import axios from 'axios';

const API_BASE_URL = process.env.REACT_APP_API_URL || 'http://localhost:8000';

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

class PlumberReportService {
  private api = axios.create({
    baseURL: `${API_BASE_URL}/api/plumber-reports`,
    headers: {
      'Content-Type': 'application/json',
    },
  });

  async createReport(report: PlumberReport): Promise<PlumberReport> {
    const response = await this.api.post('/', report);
    return response.data;
  }

  async getReport(id: string): Promise<PlumberReport> {
    const response = await this.api.get(`/${id}`);
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
    const response = await this.api.get('/', { params });
    return response.data;
  }

  async updateReport(id: string, report: Partial<PlumberReport>): Promise<PlumberReport> {
    const response = await this.api.put(`/${id}`, report);
    return response.data;
  }

  async deleteReport(id: string): Promise<void> {
    await this.api.delete(`/${id}`);
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

    const response = await this.api.post(`/${reportId}/upload-photo`, formData, {
      headers: {
        'Content-Type': 'multipart/form-data',
      },
    });
    return response.data;
  }

  async generatePDF(reportId: string): Promise<Blob> {
    const response = await this.api.post(`/${reportId}/generate-pdf`, null, {
      responseType: 'blob',
    });
    return response.data;
  }

  async previewPDF(report: PlumberReport, options?: {
    include_photos?: boolean;
    include_financial?: boolean;
  }): Promise<Blob> {
    const response = await this.api.post('/preview-pdf', {
      report_data: report,
      ...options,
    }, {
      responseType: 'blob',
    });
    return response.data;
  }

  async duplicateReport(reportId: string): Promise<PlumberReport> {
    const response = await this.api.get(`/${reportId}/duplicate`);
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

  generateReportNumber(): string {
    const timestamp = new Date().toISOString().replace(/[-T:.Z]/g, '').slice(0, 14);
    return `PLR-${timestamp}`;
  }
}

export const plumberReportService = new PlumberReportService();