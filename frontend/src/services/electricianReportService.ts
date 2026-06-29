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
  category: 'before' | 'during' | 'after' | 'damage' | 'panel' | 'wiring' | 'other';
  caption?: string;
  timestamp?: string;
}

export type RiskCode = 'OK' | 'DEFICIENT' | 'N/A';

export interface ChecklistItem {
  label: string;
  status: RiskCode;
  note?: string;
}

export interface ChecklistSection {
  title: string;
  items: ChecklistItem[];
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

// Circuit-level test result (per EICR Schedule of Test Results)
export interface CircuitTestResult {
  circuit_id: string;        // e.g. "1", "2", "3"
  circuit_description: string; // e.g. "Kitchen outlets", "Master BR lighting"
  protective_device: string; // e.g. "15A", "20A AFCI"
  conductor_size: string;    // e.g. "14/2 NM-B", "12/2 NM-B"
  insulation_resistance?: string; // MΩ reading or "PASS"/"FAIL"
  continuity?: string;       // Ω reading or "PASS"/"FAIL"
  rcd_trip_time?: string;    // ms or "N/A"
  gfci_test?: string;        // "PASS"/"FAIL"/"N/A"
  status: RiskCode;
  notes?: string;
}

export interface ElectricianReport {
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
  // Electrical-specific
  panel_type?: string;
  panel_location?: string;
  panel_amperage?: string;
  system_voltage?: string;
  meter_number?: string;
  building_type?: string;
  earthing_type?: string;       // TN-S, TN-C-S, TT, etc.
  // Report scope (EICR Section B)
  purpose_of_report?: string;
  extent_and_limitations?: string;
  // Content
  cause_of_damage?: string;
  electrical_findings?: string;
  work_performed?: string;
  materials_equipment_text?: string;
  safety_concerns?: string;
  code_violations?: string;
  recommendations?: string;
  // Overall Assessment (EICR Section E)
  overall_assessment?: 'satisfactory' | 'unsatisfactory' | 'pending';
  next_inspection_date?: string;
  // Checklists & Tests
  inspection_checklist?: ChecklistSection[];
  circuit_test_results?: CircuitTestResult[];
  // Invoice
  invoice_items?: InvoiceItem[];
  financial?: FinancialSummary;
  payments?: PaymentRecord[];
  show_payment_dates?: boolean;
  photos?: PhotoRecord[];
  // Inspector declaration
  inspector_name?: string;
  inspector_license?: string;
  inspector_signature_date?: string;
  // Additional
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

// Photo categories for water damage electrical inspection
export const PHOTO_CATEGORIES = [
  { value: 'damage', label: 'Water Damage' },
  { value: 'panel', label: 'Electrical Panel' },
  { value: 'fixture', label: 'Light Fixture / Recessed Light' },
  { value: 'wiring', label: 'Wiring / Junction Box' },
  { value: 'outlet', label: 'Outlet / Switch' },
  { value: 'moisture', label: 'Moisture / Staining' },
  { value: 'before', label: 'Before' },
  { value: 'after', label: 'After Repair' },
  { value: 'other', label: 'Other' },
];

// Default inspection checklist for water damage electrical inspection
// Tailored for single-family homes & townhouses
export const RISK_CODE_LABELS: Record<RiskCode, string> = {
  'OK': 'OK',
  'DEFICIENT': 'Deficient',
  'N/A': 'N/A',
};

export const DEFAULT_INSPECTION_CHECKLIST: ChecklistSection[] = [
  {
    title: 'Affected Lighting — Recessed Lights & Fixtures',
    items: [
      { label: 'Recessed lights (cans) — operational test', status: 'N/A' },
      { label: 'Recessed light housings — moisture / corrosion', status: 'N/A' },
      { label: 'Recessed light wiring & connectors', status: 'N/A' },
      { label: 'Recessed light trim & lens condition', status: 'N/A' },
      { label: 'Surface-mount ceiling fixtures — operational', status: 'N/A' },
      { label: 'Pendant / chandelier fixtures', status: 'N/A' },
      { label: 'Ceiling fan / light combo units', status: 'N/A' },
      { label: 'Under-cabinet / vanity lighting', status: 'N/A' },
    ],
  },
  {
    title: 'Water Damage Assessment — Electrical',
    items: [
      { label: 'Ceiling junction boxes — moisture intrusion', status: 'N/A' },
      { label: 'Wall outlet boxes — water staining / corrosion', status: 'N/A' },
      { label: 'Switch boxes — moisture / corrosion', status: 'N/A' },
      { label: 'Wire insulation — discoloration / degradation', status: 'N/A' },
      { label: 'Wire connectors (wire nuts) — corrosion', status: 'N/A' },
      { label: 'Romex / NM cable in affected area — condition', status: 'N/A' },
      { label: 'Conduit / raceway — water accumulation', status: 'N/A' },
    ],
  },
  {
    title: 'Circuits & Breakers — Affected Area',
    items: [
      { label: 'Breaker(s) serving affected area — tripped / functional', status: 'N/A' },
      { label: 'Circuit continuity test — affected circuits', status: 'N/A' },
      { label: 'Insulation resistance (megger) test', status: 'N/A' },
      { label: 'Ground fault on affected circuits', status: 'N/A' },
      { label: 'AFCI breaker function (if applicable)', status: 'N/A' },
      { label: 'GFCI outlets in wet areas — trip test', status: 'N/A' },
    ],
  },
  {
    title: 'Panel & Service (General Condition)',
    items: [
      { label: 'Main panel — signs of moisture / corrosion', status: 'OK' },
      { label: 'Bus bars & breaker connections', status: 'OK' },
      { label: 'Grounding / bonding system', status: 'OK' },
      { label: 'Panel labeling / circuit directory', status: 'OK' },
    ],
  },
  {
    title: 'Safety & Smoke / CO Detection',
    items: [
      { label: 'Smoke detectors in affected area — functional', status: 'N/A' },
      { label: 'CO detectors — functional', status: 'N/A' },
      { label: 'Exhaust fans (bath / kitchen) — operational', status: 'N/A' },
      { label: 'Arc / burn marks at any device or junction', status: 'N/A' },
    ],
  },
];

class ElectricianReportService {
  private baseUrl = `/api/electrician-reports`;

  async createReport(report: ElectricianReport): Promise<ElectricianReport> {
    const response = await api.post(`${this.baseUrl}/`, report);
    return response.data;
  }

  async getReport(id: string): Promise<ElectricianReport> {
    const response = await api.get(`${this.baseUrl}/${id}`);
    return response.data;
  }

  async getReports(params?: {
    skip?: number;
    limit?: number;
    status?: string;
    search?: string;
  }): Promise<{
    reports: ElectricianReport[];
    total: number;
    page: number;
    limit: number;
  }> {
    const response = await api.get(`${this.baseUrl}/`, { params });
    return response.data;
  }

  async updateReport(id: string, report: Partial<ElectricianReport>): Promise<ElectricianReport> {
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
    if (caption) formData.append('caption', caption);

    const response = await api.post(`${this.baseUrl}/${reportId}/upload-photo`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
    return response.data;
  }

  async generatePDF(reportId: string): Promise<Blob> {
    const response = await api.post(`${this.baseUrl}/${reportId}/generate-pdf`, null, {
      responseType: 'blob',
    });
    return response.data;
  }

  async previewPDF(report: ElectricianReport, options?: {
    include_photos?: boolean;
    include_financial?: boolean;
  }): Promise<Blob> {
    const response = await api.post(`${this.baseUrl}/preview-pdf`, {
      report_data: report,
      ...options,
    }, { responseType: 'blob', timeout: 120000 });
    return response.data;
  }

  async previewHTML(report: ElectricianReport, options?: {
    include_photos?: boolean;
    include_financial?: boolean;
  }): Promise<string> {
    const response = await api.post(`${this.baseUrl}/preview-html`, {
      report_data: report,
      ...options,
    });
    return response.data;
  }

  async duplicateReport(reportId: string): Promise<ElectricianReport> {
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

  calculateFinancialSummary(
    invoice_items: InvoiceItem[],
    labor_cost: number,
    tax_amount: number,
    discount: number,
    payments: PaymentRecord[]
  ): FinancialSummary {
    const materials_cost = invoice_items.reduce((sum, item) => sum + item.total_cost, 0);
    const equipment_cost = 0;
    const subtotal = labor_cost + materials_cost + equipment_cost;
    const total_amount = subtotal + tax_amount - discount;
    const total_paid = payments.reduce((sum, payment) => sum + payment.amount, 0);
    const balance_due = total_amount - total_paid;

    return {
      labor_cost, materials_cost, equipment_cost,
      subtotal, tax_amount, discount, total_amount, balance_due,
    };
  }

  async generateReportNumber(companyId?: string): Promise<string> {
    try {
      const params = new URLSearchParams();
      if (companyId) params.append('company_id', companyId);
      const response = await api.get(`${this.baseUrl}/generate-number?${params.toString()}`);
      return response.data.report_number;
    } catch (error) {
      console.error('Failed to generate report number from API, using fallback:', error);
      return this.generateReportNumberFallback();
    }
  }

  private generateReportNumberFallback(): string {
    const date = new Date();
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const random = Math.floor(Math.random() * 1000).toString().padStart(3, '0');
    return `ELC-${year}${month}${day}-${random}`;
  }
}

export const electricianReportService = new ElectricianReportService();
