import api from './api';
import { PaymentMethod, PaymentFrequency } from '../types';

class PaymentConfigService {
  // Payment Methods
  async getPaymentMethods(activeOnly: boolean = true): Promise<PaymentMethod[]> {
    const response = await api.get(`/api/payment-config/payment-methods?active_only=${activeOnly}`);
    return response.data;
  }

  async getPaymentMethod(id: string): Promise<PaymentMethod> {
    const response = await api.get(`/api/payment-config/payment-methods/${id}`);
    return response.data;
  }

  async createPaymentMethod(data: Omit<PaymentMethod, 'id' | 'created_at' | 'updated_at'>): Promise<PaymentMethod> {
    const response = await api.post('/api/payment-config/payment-methods', data);
    return response.data;
  }

  async updatePaymentMethod(id: string, data: Partial<PaymentMethod>): Promise<PaymentMethod> {
    const response = await api.put(`/api/payment-config/payment-methods/${id}`, data);
    return response.data;
  }

  async deletePaymentMethod(id: string): Promise<void> {
    await api.delete(`/api/payment-config/payment-methods/${id}`);
  }

  // Payment Frequencies
  async getPaymentFrequencies(activeOnly: boolean = true): Promise<PaymentFrequency[]> {
    const response = await api.get(`/api/payment-config/payment-frequencies?active_only=${activeOnly}`);
    return response.data;
  }

  async getPaymentFrequency(id: string): Promise<PaymentFrequency> {
    const response = await api.get(`/api/payment-config/payment-frequencies/${id}`);
    return response.data;
  }

  async createPaymentFrequency(data: Omit<PaymentFrequency, 'id' | 'created_at' | 'updated_at'>): Promise<PaymentFrequency> {
    const response = await api.post('/api/payment-config/payment-frequencies', data);
    return response.data;
  }

  async updatePaymentFrequency(id: string, data: Partial<PaymentFrequency>): Promise<PaymentFrequency> {
    const response = await api.put(`/api/payment-config/payment-frequencies/${id}`, data);
    return response.data;
  }

  async deletePaymentFrequency(id: string): Promise<void> {
    await api.delete(`/api/payment-config/payment-frequencies/${id}`);
  }

  // Initialize default configurations
  async initializeDefaults(): Promise<void> {
    await api.post('/api/payment-config/payment-config/initialize');
  }
}

export default new PaymentConfigService();