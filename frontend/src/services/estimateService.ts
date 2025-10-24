import { apiClient } from '../api/config';

export interface EstimateLineItem {
  id?: string; // Estimate line item ID (for existing items)
  line_item_id?: string; // Reference to master line item ID
  name: string; // Aligned with invoice_items for consistency
  description?: string;
  note?: string;  // Rich text HTML content
  quantity: number;
  unit: string;
  unit_price: number;
  total: number;
  taxable?: boolean; // Whether the item is taxable

  // Flexible grouping
  primary_group?: string;  // 1차 분류 (섹션명)
  secondary_group?: string;  // 2차 분류
  sort_order?: number;  // 그룹 내 정렬 순서

  // Notes management for temporary items
  temp_note_ids?: string[]; // Note IDs for temporary items

  // Deprecated but kept for backward compatibility
  room?: string;
  category?: string;
}

export interface EstimateSection {
  id: string;
  title: string;
  items: EstimateLineItem[];
  showSubtotal: boolean;
  subtotal: number;
  sort_order?: number;
}

export interface EstimateCreate {
  estimate_number?: string;
  estimate_type?: string;  // 'standard' or 'insurance'
  company_id?: string;
  client_name: string;
  client_address?: string;
  client_city?: string;
  client_state?: string;
  client_zipcode?: string;
  client_phone?: string;
  client_email?: string;
  estimate_date?: string;
  valid_until?: string;
  status?: string;
  notes?: string;
  terms?: string;
  claim_number?: string;
  policy_number?: string;
  insurance_company?: string;
  deductible?: number;
  items: EstimateLineItem[];
  sections?: EstimateSection[];  // 섹션 기반 데이터
  op_percent?: number;  // O&P 퍼센트
  tax_method?: 'percentage' | 'specific'; // Tax calculation method
  tax_rate?: number;
  tax_amount?: number;
}

export interface EstimateResponse {
  id?: string;
  estimate_number: string;
  estimate_type?: string;  // 'standard' or 'insurance'
  company_id?: string;
  company_name?: string;
  company_address?: string;
  company_city?: string;
  company_state?: string;
  company_zipcode?: string;
  company_phone?: string;
  company_email?: string;
  company_logo?: string;
  
  // Client Information
  client_name: string;
  client_address?: string;
  client_city?: string;
  client_state?: string;
  client_zipcode?: string;
  client_phone?: string;
  client_email?: string;
  
  // Insurance Information
  claim_number?: string;
  policy_number?: string;
  insurance_company?: string;
  adjuster_name?: string;
  adjuster_phone?: string;
  adjuster_email?: string;
  deductible?: number;
  
  // Dates
  estimate_date?: string;
  valid_until?: string;
  loss_date?: string;
  
  // Line Items
  items: EstimateLineItem[];
  sections?: EstimateSection[];  // 섹션 기반 데이터
  
  // Totals
  subtotal?: number;
  tax_method?: 'percentage' | 'specific'; // Tax calculation method
  tax_rate?: number;
  tax_amount?: number;
  discount_amount?: number;
  total_amount?: number;
  rcv_total?: number;
  op_percent?: number;  // O&P 퍼센트
  op_amount?: number;   // O&P 금액
  
  // Additional
  notes?: string;
  terms?: string;
  status?: string;
  created_at?: string;
  updated_at?: string;
}

class EstimateService {
  // Transform frontend EstimateLineItem to backend format
  private transformItemToBackend(item: EstimateLineItem) {
    // Handle both new data format and ensure proper validation
    const name = item.name?.trim() || null;
    const description = item.description?.trim() || '';

    // If no description provided, this is acceptable for items with just codes
    // But we need at least name or description
    if (!name && !description) {
      throw new Error('Item must have either a name or description');
    }

    // Ensure quantity is valid - must be > 0
    const quantity = Number(item.quantity) || 1.0;
    if (quantity <= 0) {
      throw new Error('Item quantity must be greater than 0');
    }

    // Ensure rate is valid - must be >= 0
    const rate = Number(item.unit_price) || 0.0;
    if (rate < 0) {
      throw new Error('Item rate cannot be negative');
    }

    return {
      name: name,  // Aligned with invoice_items for consistency
      description: description, // Keep empty if no description provided
      quantity: quantity,
      unit: item.unit?.trim() || 'ea',
      rate: rate,
      taxable: item.taxable ?? true, // Include taxable status
      room: item.room?.trim() || null,
      category: item.category?.trim() || null,
      primary_group: item.primary_group?.trim() || null,
      secondary_group: item.secondary_group?.trim() || null,
      sort_order: Number(item.sort_order) || 0,
      note: item.note?.trim() || null,
      depreciation_rate: 0.0,
      depreciation_amount: 0.0,
      acv_amount: Number(item.total) || 0.0,
      rcv_amount: Number(item.total) || 0.0
    };
  }

  // Transform backend item to frontend format
  private transformItemFromBackend(item: any): EstimateLineItem {
    // Handle legacy data compatibility
    // If name is empty/null but description looks like a code (uppercase, short), treat description as code
    let name = item.name || '';
    let description = item.description || '';

    // Legacy data compatibility: if no name but description looks like a code
    if (!name && description && this.isLikelyItemCode(description)) {
      name = description;
      description = ''; // Clear description since it's actually a code
    }

    return {
      id: item.id,
      name: name,  // Use resolved name
      description: description, // Use resolved description
      quantity: item.quantity || 0,
      unit: item.unit || 'ea',
      unit_price: item.rate || 0, // Map 'rate' to 'unit_price'
      total: item.amount || item.acv_amount || 0, // Use amount or acv_amount as total
      taxable: item.taxable ?? true, // Include taxable status
      room: item.room,
      category: item.category,
      primary_group: item.primary_group,
      secondary_group: item.secondary_group,
      sort_order: item.sort_order,
      note: item.note
    };
  }

  // Helper method to detect if a string looks like an item code rather than a description
  private isLikelyItemCode(text: string): boolean {
    if (!text || text.length === 0) return false;

    // Check if text looks like a code:
    // - Short length (typically <= 15 characters)
    // - Contains uppercase letters or numbers
    // - Doesn't contain common description words
    const trimmed = text.trim();

    // Short codes are likely item codes
    if (trimmed.length <= 10 && /^[A-Z0-9]+$/i.test(trimmed)) {
      return true;
    }

    // Common patterns for Xactimate codes
    if (/^[A-Z]{3,6}\d{3}$/i.test(trimmed)) { // e.g., DRY001, PAINT123
      return true;
    }

    // Contains mostly uppercase and is short
    if (trimmed.length <= 15) {
      const uppercaseCount = (trimmed.match(/[A-Z]/g) || []).length;
      const uppercaseRatio = uppercaseCount / trimmed.length;
      if (uppercaseRatio > 0.5) { // More than 50% uppercase
        return true;
      }
    }

    return false;
  }

  // Convert date string to ISO datetime format for backend
  private formatDateForBackend(dateString?: string): string | undefined {
    if (!dateString) return undefined;
    
    // If already in ISO format with time, return as is
    if (dateString.includes('T') || dateString.includes(' ')) {
      return dateString;
    }
    
    // If it's just a date (YYYY-MM-DD), add time part
    if (/^\d{4}-\d{2}-\d{2}$/.test(dateString)) {
      return `${dateString}T00:00:00`;
    }
    
    return dateString;
  }

  // Transform EstimateResponse to backend EstimateCreate format
  private transformEstimateToBackend(estimate: EstimateResponse) {
    // Validate items array
    if (!estimate.items || estimate.items.length === 0) {
      throw new Error('At least one item is required');
    }

    return {
      estimate_number: estimate.estimate_number ? String(estimate.estimate_number).trim() : null,
      estimate_type: estimate.estimate_type || 'standard', // Use provided estimate_type or default to standard
      company_id: estimate.company_id || null,
      client_name: estimate.client_name ? String(estimate.client_name).trim() : '',
      client_address: estimate.client_address ? String(estimate.client_address).trim() : null,
      client_city: estimate.client_city ? String(estimate.client_city).trim() : null,
      client_state: estimate.client_state ? String(estimate.client_state).trim() : null,
      client_zipcode: estimate.client_zipcode ? String(estimate.client_zipcode).trim() : null,
      client_phone: estimate.client_phone ? String(estimate.client_phone).trim() : null,
      client_email: estimate.client_email ? String(estimate.client_email).trim() : null,
      estimate_date: this.formatDateForBackend(estimate.estimate_date),
      loss_date: this.formatDateForBackend(estimate.loss_date),
      valid_until: this.formatDateForBackend(estimate.valid_until),
      status: estimate.status?.trim() || 'draft',
      notes: estimate.notes?.trim() || null,
      terms: estimate.terms?.trim() || null,
      claim_number: estimate.claim_number?.trim() || null,
      policy_number: estimate.policy_number?.trim() || null,
      insurance_company: estimate.insurance_company?.trim() || null,
      deductible: estimate.deductible ? Number(estimate.deductible) : null,
      adjuster_name: estimate.adjuster_name?.trim() || null,
      adjuster_phone: estimate.adjuster_phone?.trim() || null,
      adjuster_email: estimate.adjuster_email?.trim() || null,
      // Financial fields
      subtotal: estimate.subtotal ? Number(estimate.subtotal) : null,
      op_percent: estimate.op_percent ? Number(estimate.op_percent) : null,
      op_amount: estimate.op_amount ? Number(estimate.op_amount) : null,
      tax_method: estimate.tax_method || 'percentage',
      tax_rate: estimate.tax_rate ? Number(estimate.tax_rate) : null,
      tax_amount: estimate.tax_amount ? Number(estimate.tax_amount) : null,
      discount_amount: estimate.discount_amount ? Number(estimate.discount_amount) : null,
      total_amount: estimate.total_amount ? Number(estimate.total_amount) : null,
      items: estimate.items.map(item => this.transformItemToBackend(item))
    };
  }

  // Transform backend response to frontend EstimateResponse format
  private transformEstimateFromBackend(backendData: any): EstimateResponse {
    return {
      id: backendData.id,
      estimate_number: backendData.estimate_number,
      estimate_type: backendData.estimate_type || 'standard',
      company_id: backendData.company_id,
      company_name: backendData.company_name,
      company_address: backendData.company_address,
      company_city: backendData.company_city,
      company_state: backendData.company_state,
      company_zipcode: backendData.company_zipcode,
      company_phone: backendData.company_phone,
      company_email: backendData.company_email,
      client_name: backendData.client_name,
      client_address: backendData.client_address,
      client_city: backendData.client_city,
      client_state: backendData.client_state,
      client_zipcode: backendData.client_zipcode,
      client_phone: backendData.client_phone,
      client_email: backendData.client_email,
      estimate_date: backendData.estimate_date,
      loss_date: backendData.loss_date,
      valid_until: backendData.valid_until,
      status: backendData.status,
      subtotal: backendData.subtotal,
      op_percent: backendData.op_percent, // Add missing O&P percentage
      op_amount: backendData.op_amount, // Add missing O&P amount
      tax_method: backendData.tax_method, // Add missing tax method
      tax_rate: backendData.tax_rate,
      tax_amount: backendData.tax_amount,
      discount_amount: backendData.discount_amount,
      total_amount: backendData.total_amount,
      rcv_total: backendData.rcv_amount, // Add missing RCV total
      claim_number: backendData.claim_number,
      policy_number: backendData.policy_number,
      insurance_company: backendData.insurance_company,
      deductible: backendData.deductible,
      adjuster_name: backendData.adjuster_name,
      adjuster_phone: backendData.adjuster_phone,
      adjuster_email: backendData.adjuster_email,
      notes: backendData.notes,
      terms: backendData.terms,
      created_at: backendData.created_at,
      updated_at: backendData.updated_at,
      items: (backendData.items || []).map((item: any) => this.transformItemFromBackend(item))
    };
  }

  async getEstimates(params?: {
    skip?: number;
    limit?: number;
    client_name?: string;
    status?: string;
    estimate_type?: string;
  }): Promise<EstimateResponse[]> {
    const response = await apiClient.get('/api/estimates/', { params });
    return response.data.map((item: any) => this.transformEstimateFromBackend(item));
  }

  async getEstimate(id: string): Promise<EstimateResponse> {
    const response = await apiClient.get(`/api/estimates/${id}`);
    return this.transformEstimateFromBackend(response.data);
  }

  async createEstimate(estimate: EstimateResponse): Promise<EstimateResponse> {
    console.log('Creating estimate with data:', estimate);
    
    try {
      const backendData = this.transformEstimateToBackend(estimate);
      console.log('Transformed backend data:', JSON.stringify(backendData, null, 2));
      
      const response = await apiClient.post('/api/estimates/', backendData);
      return this.transformEstimateFromBackend(response.data);
    } catch (error: any) {
      console.error('Error creating estimate:', error);
      if (error.response?.status === 422) {
        console.error('Validation errors:', error.response.data);
        throw new Error(`Validation failed: ${JSON.stringify(error.response.data.detail || error.response.data)}`);
      }
      throw error;
    }
  }

  async updateEstimate(id: string, estimate: EstimateResponse): Promise<EstimateResponse> {
    try {
      const backendData = this.transformEstimateToBackend(estimate);
      console.log('Updating estimate with data:', JSON.stringify(backendData, null, 2));
      
      const response = await apiClient.put(`/api/estimates/${id}`, backendData);
      return this.transformEstimateFromBackend(response.data);
    } catch (error: any) {
      console.error('Error updating estimate:', error);
      if (error.response?.status === 422) {
        console.error('Validation errors:', error.response.data);
        throw new Error(`Validation failed: ${JSON.stringify(error.response.data.detail || error.response.data)}`);
      }
      throw error;
    }
  }

  async deleteEstimate(id: string): Promise<void> {
    await apiClient.delete(`/api/estimates/${id}`);
  }

  async duplicateEstimate(id: string): Promise<EstimateResponse> {
    const response = await apiClient.post(`/api/estimates/${id}/duplicate`);
    return this.transformEstimateFromBackend(response.data);
  }

  async generatePDF(id: string): Promise<Blob> {
    const response = await apiClient.post(
      `/api/estimates/${id}/pdf`,
      {},
      {
        responseType: 'blob',
      }
    );
    return response.data;
  }

  async previewPDF(estimate: EstimateResponse, templateType: string = 'estimate'): Promise<Blob> {
    // Transform the estimate data to the format expected by the PDF endpoint
    const pdfData = {
      estimate_number: estimate.estimate_number || this.generateEstimateNumberFallback(),
      estimate_date: estimate.estimate_date || new Date().toISOString().split('T')[0],
      valid_until: estimate.valid_until,
      company: {
        name: estimate.company_name || 'Company Name Not Provided',
        address: estimate.company_address || '',
        city: estimate.company_city || '',
        state: estimate.company_state || '',
        zip: estimate.company_zipcode || '',
        phone: estimate.company_phone || '',
        email: estimate.company_email || '',
        logo: estimate.company_logo || ''
      },
      client: {
        name: estimate.client_name || 'Client Name Not Provided',
        address: estimate.client_address || '',
        city: estimate.client_city || '',
        state: estimate.client_state || '',
        zip: estimate.client_zipcode || '',
        phone: estimate.client_phone || '',
        email: estimate.client_email || ''
      },
      // Include sections data if available (preferred format)
      sections: estimate.sections ? estimate.sections.map(section => ({
        title: section.title,
        showSubtotal: section.showSubtotal,
        subtotal: section.subtotal,
        items: section.items.map(item => ({
          name: item.name || '',
          description: item.description || '',
          note: item.note || '',
          quantity: item.quantity || 0,
          unit: item.unit || 'ea',
          rate: item.unit_price || 0,
          taxable: item.taxable ?? true
        }))
      })) : undefined,
      // Fallback items array for backwards compatibility
      items: estimate.items.map(item => ({
        name: item.name || '',
        room: item.room || '',
        description: item.description || 'No description',
        note: item.note || '',
        quantity: item.quantity || 0,
        unit: item.unit || 'ea',
        rate: item.unit_price || 0,
        taxable: item.taxable ?? true
      })),
      subtotal: estimate.subtotal || 0,
      op_percent: estimate.op_percent || 0, // Include O&P percentage
      op_amount: estimate.op_amount || 0, // Include O&P amount
      tax_method: estimate.tax_method || 'percentage', // Include tax method
      tax_rate: estimate.tax_rate || 0,
      tax_amount: estimate.tax_amount || 0,
      discount_amount: estimate.discount_amount || 0,
      total_amount: estimate.total_amount || 0,
      insurance: {
        company: estimate.insurance_company,
        claim_number: estimate.claim_number,
        policy_number: estimate.policy_number,
        deductible: estimate.deductible
      },
      notes: estimate.notes,
      terms: estimate.terms,
      template_type: templateType // Add template type selection
    };

    console.log('Sending PDF preview data:', pdfData);
    
    try {
      const response = await apiClient.post('/api/estimates/preview-pdf', pdfData, {
        responseType: 'blob',
        timeout: 30000, // 30 second timeout
      });
      
      // Validate that we received a PDF blob
      if (!response.data || response.data.size === 0) {
        throw new Error('Received empty PDF response');
      }
      
      // Check if the blob is actually a PDF
      if (response.data.type && !response.data.type.includes('pdf')) {
        console.warn('Response type is not PDF:', response.data.type);
        // Try to read as text to get error message
        const text = await response.data.text();
        console.error('Non-PDF response content:', text);
        throw new Error('Server returned non-PDF response');
      }
      
      console.log('PDF blob received:', {
        size: response.data.size,
        type: response.data.type
      });
      
      return response.data;
    } catch (error: any) {
      console.error('PDF preview request failed:', error);
      
      // If we received a blob error response, try to read it
      if (error.response?.data instanceof Blob) {
        try {
          const errorText = await error.response.data.text();
          console.error('Error response content:', errorText);
          throw new Error(`PDF generation failed: ${errorText}`);
        } catch (readError) {
          console.error('Could not read error response:', readError);
        }
      }
      
      throw error;
    }
  }

  async previewHTML(estimate: EstimateResponse, templateType: string = 'estimate'): Promise<string> {
    // Check for items without primary_group and show warning
    const itemsWithoutGroup = estimate.items.filter(item => !item.primary_group);
    if (itemsWithoutGroup.length > 0) {
      console.warn(`Warning: ${itemsWithoutGroup.length} items found without primary_group assignment`);
      // Could show a user notification here if needed
    }

    // Transform the estimate data to the format expected by the HTML endpoint
    const htmlData = {
      estimate_number: estimate.estimate_number || this.generateEstimateNumberFallback(),
      estimate_date: estimate.estimate_date || new Date().toISOString().split('T')[0],
      valid_until: estimate.valid_until,
      company: {
        name: estimate.company_name || 'Company Name Not Provided',
        address: estimate.company_address || '',
        city: estimate.company_city || '',
        state: estimate.company_state || '',
        zip: estimate.company_zipcode || '',
        phone: estimate.company_phone || '',
        email: estimate.company_email || '',
        logo: estimate.company_logo || ''
      },
      client: {
        name: estimate.client_name || 'Client Name Not Provided',
        address: estimate.client_address || '',
        city: estimate.client_city || '',
        state: estimate.client_state || '',
        zip: estimate.client_zipcode || '',
        phone: estimate.client_phone || '',
        email: estimate.client_email || ''
      },
      items: estimate.items.map(item => ({
        room: item.room || '',
        description: item.description || 'No description',
        primary_group: item.primary_group || 'Uncategorized',
        quantity: item.quantity || 0,
        unit: item.unit || 'ea',
        rate: item.unit_price || 0,
        taxable: item.taxable ?? true, // Include taxable status for HTML
        note: item.note || ''
      })),
      subtotal: estimate.subtotal || 0,
      op_percent: estimate.op_percent || 0, // Include O&P percentage
      op_amount: estimate.op_amount || 0, // Include O&P amount
      tax_method: estimate.tax_method || 'percentage', // Include tax method
      tax_rate: estimate.tax_rate || 0,
      tax_amount: estimate.tax_amount || 0,
      discount_amount: estimate.discount_amount || 0,
      total_amount: estimate.total_amount || 0,
      insurance: {
        company: estimate.insurance_company,
        claim_number: estimate.claim_number,
        policy_number: estimate.policy_number,
        deductible: estimate.deductible
      },
      notes: estimate.notes,
      terms: estimate.terms,
      template_type: templateType // Add template type selection
    };

    try {
      const response = await apiClient.post('/api/estimates/preview-html', htmlData, {
        timeout: 30000, // 30 second timeout
      });
      
      return response.data;
    } catch (error: any) {
      console.error('Error generating HTML preview:', error);
      if (error.response?.status === 500) {
        throw new Error(`Server error: ${error.response?.data?.detail || 'Unknown error'}`);
      }
      if (error.code === 'ECONNABORTED') {
        throw new Error('Request timed out. Please try again.');
      }
      throw new Error(`Failed to generate HTML preview: ${error.message}`);
    }
  }

  async searchLineItems(searchText: string): Promise<any[]> {
    try {
      const response = await apiClient.get('/api/line-items/search', {
        params: { q: searchText }
      });
      return response.data;
    } catch (error) {
      console.error('Error searching line items:', error);
      return [];
    }
  }

  // Generate estimate number using the new API
  async generateEstimateNumber(companyId?: string, estimateType?: string): Promise<string> {
    try {
      const params = new URLSearchParams();
      if (companyId) params.append('company_id', companyId);
      if (estimateType) params.append('estimate_type', estimateType);
      
      const response = await apiClient.get(`/api/estimates/generate-number?${params.toString()}`);
      return response.data.estimate_number;
    } catch (error) {
      console.error('Failed to generate estimate number from API, using fallback:', error);
      // Fallback to local generation
      return this.generateEstimateNumberFallback();
    }
  }

  // Fallback method for estimate number generation
  private generateEstimateNumberFallback(): string {
    const date = new Date();
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const random = Math.floor(Math.random() * 1000).toString().padStart(3, '0');
    return `EST-${year}${month}${day}-${random}`;
  }

  calculateTotals(items: EstimateLineItem[]) {
    const subtotal = items.reduce((sum, item) => sum + (item.total || 0), 0);
    const rcvTotal = subtotal;
    
    return {
      subtotal,
      rcv_total: rcvTotal,
    };
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

export const estimateService = new EstimateService();