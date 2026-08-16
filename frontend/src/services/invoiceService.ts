import { apiClient } from '../api/config';

export interface LineItemImage {
  id: string;
  title: string;
  url: string;  // base64 data URL or external URL
  order_index: number;
}

export interface InvoiceItem {
  id?: string; // Invoice line item ID (for existing items)
  name: string;
  description?: string;
  quantity: number;
  unit: string;
  rate: number;
  amount?: number;
  taxable?: boolean;

  // Line item library integration
  line_item_id?: string;  // Reference to line_items library
  is_custom_override?: boolean;
  override_values?: string;  // JSON string for override values

  // Flexible grouping
  primary_group?: string;  // Section name
  secondary_group?: string;  // Sub-category
  sort_order?: number;  // Sort order within group

  // Rich text note field
  note?: string;  // HTML content for rich text notes (displayed as Item Name in PDF)

  // Images attached to this line item
  images?: LineItemImage[];
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

export interface InvoiceSection {
  id: string;
  title: string;
  items: InvoiceItem[];
  showSubtotal: boolean;
  subtotal: number;
  sort_order?: number;
  // Lump sum mode: when enabled, `lumpSumAmount` (not the sum of `items`)
  // is used as this section's contribution to the document total. Items
  // remain visible/editable for reference but don't drive the total.
  isLumpSum?: boolean;
  lumpSumAmount?: number;
  taxable?: boolean;
}

export interface Adjustment {
  name: string;
  percentage: number;
  fixed_amount?: number | null;
  type: 'add' | 'subtract';
  order: number;
  amount?: number; // Calculated
  note?: string;
}

export interface InvoiceData {
  invoice_number?: string;
  date?: string;
  due_date?: string;
  status?: string;
  company_id?: string;
  company?: CompanyInfo;
  client: ClientInfo;
  client_id?: string;
  client_company_id?: string;
  show_insurance?: boolean;
  insurance?: InsuranceInfo | null;
  items: InvoiceItem[];
  sections?: InvoiceSection[];  // Section-based data
  // Document-level lump sum: when enabled, item qty/unit/rate/amount and
  // section subtotals are hidden and lump_sum_document_amount is shown
  // as the single grand total instead of the calculated total.
  is_lump_sum_document?: boolean;
  lump_sum_document_amount?: number;
  subtotal?: number;
  tax_method?: 'percentage' | 'specific'; // Tax calculation method
  tax_rate?: number;
  tax_amount?: number;
  adjustments?: Adjustment[];  // New flexible adjustments system
  discount?: number;           // Legacy: kept for backward compatibility
  discount_amount?: number;    // Legacy: kept for backward compatibility
  shipping?: number;
  total?: number;
  paid_amount?: number;
  payments?: PaymentRecord[];  // Payment records
  show_payment_dates?: boolean;
  balance_due?: number;
  payment_terms?: string;
  notes?: string;
  op_percent?: number;  // O&P percentage (legacy, use adjustments instead)
}

export interface PaymentRecord {
  amount: number;
  date?: string | null;
  method?: string;
  reference?: string;
  top_note?: string;
  bottom_note?: string;
  receipt_number?: string;
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
  client_address?: string;
  client_city?: string;
  total: number;
  paid_amount: number;
  balance_due?: number;

  // Receipt tracking
  has_receipt?: boolean;
  receipt_number?: string;
  receipt_generated_at?: string;

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
  op_percent?: number;
  tax_method?: 'percentage' | 'specific';
  tax_rate: number;
  tax_amount: number;
  discount: number;
  shipping: number;

  payment_terms?: string;
  notes?: string;

  // Payment tracking
  payments?: PaymentRecord[];
  show_payment_dates?: boolean;

  items: InvoiceItem[];
  sections?: InvoiceSection[];  // Section-based data
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

  async generatePDF(id: string, templateVariant: string = 'a'): Promise<Blob> {
    const response = await apiClient.post(
      `/api/invoices/${id}/pdf`,
      {},
      {
        responseType: 'blob',
        params: { template_variant: templateVariant },
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

  async previewHTML(data: InvoiceData): Promise<string> {
    const response = await apiClient.post(
      '/api/invoices/preview-html',
      data,
      {
        responseType: 'text',
      }
    );
    return response.data;
  }

  async duplicateInvoice(id: string): Promise<InvoiceDetailResponse> {
    const response = await apiClient.post(`/api/invoices/${id}/duplicate`);
    return response.data;
  }

  // Generate invoice number using the new API
  async generateInvoiceNumber(companyId?: string): Promise<string> {
    try {
      const params = new URLSearchParams();
      if (companyId) params.append('company_id', companyId);

      const response = await apiClient.get(`/api/invoices/generate-number?${params.toString()}`);
      return response.data.invoice_number;
    } catch (error) {
      console.error('Failed to generate invoice number from API, using fallback:', error);
      // Fallback to local generation
      return this.generateInvoiceNumberFallback();
    }
  }

  // Fallback method for invoice number generation
  private generateInvoiceNumberFallback(): string {
    const date = new Date();
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const random = Math.floor(Math.random() * 1000).toString().padStart(3, '0');
    return `INV-${year}${month}${day}-${random}`;
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

  // Receipt generation methods
  async generateReceiptHTML(id: string): Promise<string> {
    const response = await apiClient.get(
      `/api/invoices/${id}/receipt-html`,
      {
        responseType: 'text',
      }
    );
    return response.data;
  }

  async generateReceiptPDF(id: string): Promise<Blob> {
    const response = await apiClient.get(
      `/api/invoices/${id}/receipt-pdf`,
      {
        responseType: 'blob',
      }
    );
    return response.data;
  }
}

export const invoiceService = new InvoiceService();