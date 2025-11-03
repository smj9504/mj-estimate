import api from './api';
import type {
  Receipt,
  ReceiptTemplate,
  ReceiptGenerateRequest,
  ReceiptTemplateCreateRequest,
  ReceiptTemplateUpdateRequest,
} from '../types/receipt';

const RECEIPTS_API = `/api/receipts`;

/**
 * Receipt Service
 * Handles all receipt-related API calls
 */
export const receiptService = {
  // Receipt operations

  /**
   * Generate a new receipt from an invoice
   */
  generateReceipt: async (data: ReceiptGenerateRequest): Promise<Receipt> => {
    const response = await api.post(`${RECEIPTS_API}/generate`, data);
    return response.data;
  },

  /**
   * Get all receipts (with optional filtering)
   */
  getReceipts: async (params?: {
    skip?: number;
    limit?: number;
    status?: string;
  }): Promise<Receipt[]> => {
    const response = await api.get(RECEIPTS_API, { params });
    return response.data;
  },

  /**
   * Get a single receipt by ID
   */
  getReceipt: async (receiptId: string): Promise<Receipt> => {
    const response = await api.get(`${RECEIPTS_API}/${receiptId}`);
    return response.data;
  },

  /**
   * Get all receipts for a specific invoice
   */
  getReceiptsByInvoice: async (invoiceId: string): Promise<Receipt[]> => {
    const response = await api.get(`${RECEIPTS_API}/by-invoice/${invoiceId}`);
    return response.data;
  },

  /**
   * Get a specific receipt by invoice ID and receipt number
   * More efficient than getReceiptsByInvoice when you only need one receipt
   */
  getReceiptByNumber: async (invoiceId: string, receiptNumber: string): Promise<Receipt> => {
    const response = await api.get(
      `${RECEIPTS_API}/by-invoice/${invoiceId}/number/${receiptNumber}`
    );
    return response.data;
  },

  /**
   * Update a receipt
   */
  updateReceipt: async (
    receiptId: string,
    data: Partial<ReceiptGenerateRequest>
  ): Promise<Receipt> => {
    const response = await api.put(`${RECEIPTS_API}/${receiptId}`, data);
    return response.data;
  },

  /**
   * Void a receipt
   */
  voidReceipt: async (receiptId: string, reason: string): Promise<Receipt> => {
    const response = await api.post(`${RECEIPTS_API}/${receiptId}/void`, {
      void_reason: reason,
    });
    return response.data;
  },

  /**
   * Delete a receipt
   */
  deleteReceipt: async (receiptId: string): Promise<void> => {
    await api.delete(`${RECEIPTS_API}/${receiptId}`);
  },

  /**
   * Get receipt PDF URL
   */
  getReceiptPdfUrl: (receiptId: string): string => {
    return `${RECEIPTS_API}/${receiptId}/pdf`;
  },

  /**
   * Generate receipt PDF blob
   */
  generateReceiptPDF: async (receiptId: string): Promise<Blob> => {
    const response = await api.get(`${RECEIPTS_API}/${receiptId}/pdf`, {
      responseType: 'blob',
    });
    return response.data;
  },

  /**
   * Preview receipt HTML (without saving)
   */
  previewHTML: async (data: any): Promise<string> => {
    const response = await api.post(`${RECEIPTS_API}/preview-html`, data);
    return response.data;
  },

  /**
   * Preview receipt PDF (without saving) - returns PDF blob
   */
  previewPDF: async (data: any): Promise<Blob> => {
    const response = await api.post(`${RECEIPTS_API}/preview-pdf`, data, {
      responseType: 'blob',
    });
    return response.data;
  },

  // Template operations

  /**
   * Get all templates for a company
   */
  getTemplates: async (companyId: string): Promise<ReceiptTemplate[]> => {
    const response = await api.get(`${RECEIPTS_API}/templates/company/${companyId}`);
    return response.data;
  },

  /**
   * Get a single template by ID
   */
  getTemplate: async (templateId: string): Promise<ReceiptTemplate> => {
    const response = await api.get(`${RECEIPTS_API}/templates/${templateId}`);
    return response.data;
  },

  /**
   * Create a new template
   */
  createTemplate: async (data: ReceiptTemplateCreateRequest): Promise<ReceiptTemplate> => {
    const response = await api.post(`${RECEIPTS_API}/templates`, data);
    return response.data;
  },

  /**
   * Update a template
   */
  updateTemplate: async (
    templateId: string,
    data: ReceiptTemplateUpdateRequest
  ): Promise<ReceiptTemplate> => {
    const response = await api.put(`${RECEIPTS_API}/templates/${templateId}`, data);
    return response.data;
  },

  /**
   * Delete a template
   */
  deleteTemplate: async (templateId: string): Promise<void> => {
    await api.delete(`${RECEIPTS_API}/templates/${templateId}`);
  },

  /**
   * Set a template as default
   */
  setDefaultTemplate: async (
    templateId: string,
    companyId: string,
    templateType: string = 'standard'
  ): Promise<ReceiptTemplate> => {
    const response = await api.put(
      `${RECEIPTS_API}/templates/${templateId}/set-default`,
      null,
      {
        params: { company_id: companyId, template_type: templateType },
      }
    );
    return response.data;
  },
};
