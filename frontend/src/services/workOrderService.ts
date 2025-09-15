import api from './api';
import { WorkOrder, WorkOrderFormData, Trade, Credit, CostBreakdown, PaginatedResponse } from '../types';

export const workOrderService = {
  // Work Order operations
  async getWorkOrders(page = 1, pageSize = 10): Promise<PaginatedResponse<WorkOrder>> {
    const response = await api.get('/api/work-orders/', {
      params: { page, page_size: pageSize }
    });
    // Backend returns WorkOrdersResponse with 'data' and 'total' fields
    // Transform to match PaginatedResponse interface
    return {
      items: response.data.data || [],
      total: response.data.total || 0,
      page: page,
      page_size: pageSize,
      total_pages: Math.ceil((response.data.total || 0) / pageSize)
    };
  },

  async getWorkOrder(id: string): Promise<WorkOrder> {
    const response = await api.get(`/api/work-orders/${id}`);
    // Backend returns WorkOrderResponse with 'data' field
    return response.data.data;
  },

  async createWorkOrder(workOrderData: WorkOrderFormData): Promise<WorkOrder> {
    const response = await api.post('/api/work-orders/', workOrderData);
    // Backend returns WorkOrderResponse with 'data' field
    return response.data.data;
  },

  async updateWorkOrder(id: string, workOrderData: Partial<WorkOrderFormData>): Promise<WorkOrder> {
    const response = await api.put(`/api/work-orders/${id}`, workOrderData);
    // Backend returns WorkOrderResponse with 'data' field
    return response.data.data;
  },

  async deleteWorkOrder(id: string): Promise<void> {
    await api.delete(`/api/work-orders/${id}`);
  },

  // Generate new work order number
  async generateWorkOrderNumber(): Promise<{ work_order_number: string }> {
    const response = await api.get('/api/work-orders/generate-number');
    return response.data;
  },

  // Trade operations
  async getTrades(): Promise<Trade[]> {
    const response = await api.get('/api/trades/');
    // Backend returns {data: trades}
    return response.data.data || response.data || [];
  },

  // Credit operations
  async getCustomerCredits(companyId: string): Promise<Credit[]> {
    const response = await api.get(`/api/credits/customer/${companyId}`);
    return response.data;
  },

  async getAvailableCredits(companyId: string): Promise<Credit[]> {
    const response = await api.get(`/api/credits/customer/${companyId}`, {
      params: { active_only: true }
    });
    return response.data;
  },

  // Cost calculation
  async calculateCost(data: {
    document_type: string;
    trades: string[];
    company_id: string;
  }): Promise<CostBreakdown> {
    const response = await api.post('/api/work-orders/calculate-cost', data);
    return response.data;
  },

  // Document type operations
  async getDocumentTypes(): Promise<{ id: string; name: string; base_cost: number }[]> {
    const response = await api.get('/api/document-types/');
    return response.data;
  },

  // PDF Generation (if needed)
  async previewPDF(workOrderData: any): Promise<Blob> {
    const response = await api.post('/api/work-orders/preview-pdf', workOrderData, {
      responseType: 'blob',
      headers: {
        'Accept': 'application/pdf',
      },
    });
    return response.data;
  },

  // Search and filter
  async searchWorkOrders(params: {
    search?: string;
    company_id?: string;
    document_type?: string;
    status?: string;
    date_from?: string;
    date_to?: string;
    page?: number;
    page_size?: number;
  }): Promise<PaginatedResponse<WorkOrder>> {
    const response = await api.get('/api/work-orders/', { params });
    // Transform backend response to match PaginatedResponse interface
    return {
      items: response.data.data || [],
      total: response.data.total || 0,
      page: params.page || 1,
      page_size: params.page_size || 10,
      total_pages: Math.ceil((response.data.total || 0) / (params.page_size || 10))
    };
  },

  // Status updates
  async updateWorkOrderStatus(id: string, status: WorkOrder['status'], comment?: string): Promise<WorkOrder> {
    // Build URL with optional notes query parameter
    let url = `/api/work-orders/${id}/status`;
    if (comment) {
      url += `?notes=${encodeURIComponent(comment)}`;
    }
    
    // Send status in request body (as plain string, not object)
    const response = await api.patch(url, `"${status}"`, {
      headers: {
        'Content-Type': 'application/json',
      },
    });
    return response.data.data;
  },

  // Activity and comments
  async getWorkOrderActivities(workOrderId: string): Promise<any[]> {
    const response = await api.get(`/api/work-orders/${workOrderId}/activities`);
    // Backend returns { activities: [], total: 0 }, extract the activities array
    return response.data.activities || [];
  },

  async addComment(workOrderId: string, comment: string): Promise<any> {
    const response = await api.post(`/api/work-orders/${workOrderId}/comments`, {
      comment,
    });
    return response.data;
  },

  // Payment management
  async getWorkOrderPayments(workOrderId: string): Promise<any[]> {
    const response = await api.get(`/api/work-orders/${workOrderId}/payments`);
    return response.data;
  },

  async addPayment(workOrderId: string, paymentData: {
    amount: number;
    payment_method: string;
    payment_date: string;
    reference_number?: string;
    notes?: string;
    status: string;
  }): Promise<any> {
    const response = await api.post(`/api/work-orders/${workOrderId}/payments`, paymentData);
    return response.data;
  },

  async updatePayment(paymentId: string, paymentData: Partial<{
    amount: number;
    payment_method: string;
    payment_date: string;
    reference_number?: string;
    notes?: string;
    status: string;
  }>): Promise<any> {
    const response = await api.patch(`/api/payments/${paymentId}`, paymentData);
    return response.data;
  },

  async deletePayment(paymentId: string): Promise<void> {
    await api.delete(`/api/payments/${paymentId}`);
  },

  // Notifications
  async sendNotification(workOrderId: string, notificationType: 'email' | 'sms', recipientType: 'client' | 'staff', message?: string): Promise<any> {
    const response = await api.post(`/api/work-orders/${workOrderId}/notifications`, {
      type: notificationType,
      recipient_type: recipientType,
      message,
    });
    return response.data;
  },

};

export default workOrderService;