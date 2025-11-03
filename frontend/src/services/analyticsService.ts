import api from './api';

export interface ApiUsageBucketServiceBreakdown {
  requests: number;
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  cost_usd: number;
}

export interface ApiUsageBucket {
  period: string;
  requests: number;
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  cost_usd: number;
  by_service: Record<string, ApiUsageBucketServiceBreakdown>;
}

export interface ApiUsageResponse {
  period: 'daily' | 'weekly' | 'monthly';
  start: string;
  end: string;
  buckets: ApiUsageBucket[];
}

export const analyticsService = {
  async getApiUsage(period: 'daily' | 'weekly' | 'monthly', params?: { start?: string; end?: string; provider?: string; }): Promise<ApiUsageResponse> {
    const response = await api.get('/api/analytics/api-usage', { params: { period, ...params } });
    return response.data;
  }
};


