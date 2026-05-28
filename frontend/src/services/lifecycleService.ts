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
  job_id: string;
  claim_number: string;
  insurance_company?: string;
  adjuster_name?: string;
  adjuster_email?: string;
  property_address?: string;
  homeowner_name?: string;
  date_of_loss?: string;
  documents_sent_date?: string;
  status: string;
}

export interface WMDocPrep {
  job_id: string;
  claim_number?: string;
  insurance_company?: string;
  property_address?: string;
  homeowner_name?: string;
  date_of_loss?: string;
  status: string;
  created_at?: string;
}

export interface SupplementWork {
  supplement_id: string;
  claim_id: string;
  claim_number?: string;
  title: string;
  status: string;
  priority: string;
  original_amount: number;
  supplement_amount: number;
  difference: number;
  insurance_company?: string;
  property_address?: string;
  required_estimates: Record<string, boolean>;
  created_at?: string;
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

  async getWMDocPrep(): Promise<WMDocPrep[]> {
    const { data } = await api.get(`${BASE}/wm-doc-prep`);
    return data;
  },

  async getSupplementWork(): Promise<SupplementWork[]> {
    const { data } = await api.get(`${BASE}/supplement-work`);
    return data;
  },
};
