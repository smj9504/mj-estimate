/**
 * Claims Lifecycle Dashboard API service
 */

import api from './api';

export interface LifecycleStats {
  followup: {
    total_tasks: number;
    pending: number;
    awaiting_response: number;
    overdue: number;
    resolved_this_week: number;
    by_type: Record<string, number>;
    by_priority: Record<string, number>;
  };
  supplement: {
    total: number;
    identified: number;
    in_progress: number;
    submitted: number;
    under_review: number;
    approved: number;
    denied: number;
    total_supplement_amount: number;
    total_difference: number;
  };
  rebuild: {
    total_projects: number;
    pending: number;
    assigned: number;
    in_progress: number;
    completed: number;
    docs_sent: number;
    total_contract_amount: number;
    total_contractors: number;
  };
}

export interface PaymentGap {
  claim_id: string;
  claim_number: string;
  insurance_company?: string;
  property_address?: string;
  invoice_amount: number;
  insurance_paid: number;
  difference: number;
  payment_status: string;
  needs_supplement: boolean;
}

export interface PendingEstimate {
  claim_id: string;
  claim_number: string;
  insurance_company?: string;
  adjuster_name?: string;
  adjuster_email?: string;
  property_address?: string;
  date_of_loss?: string;
  status: string;
}

const BASE = '/api/claims/lifecycle';

export const lifecycleService = {
  async getStats(): Promise<LifecycleStats> {
    const { data } = await api.get(`${BASE}/stats`);
    return data;
  },

  async getOverdueItems(): Promise<any[]> {
    const { data } = await api.get(`${BASE}/overdue`);
    return data;
  },

  async getPaymentGaps(minDifference = 500): Promise<PaymentGap[]> {
    const { data } = await api.get(`${BASE}/payment-gaps`, {
      params: { min_difference: minDifference },
    });
    return data;
  },

  async getPendingEstimates(): Promise<PendingEstimate[]> {
    const { data } = await api.get(`${BASE}/pending-estimates`);
    return data;
  },

  async getActiveRebuilds(): Promise<any[]> {
    const { data } = await api.get(`${BASE}/active-rebuilds`);
    return data;
  },
};
