import { apiClient } from '../api/config';

export type PriorityLevel = 'urgent' | 'high' | 'medium' | 'low';

export interface Priority {
  URGENT: 'urgent';
  HIGH: 'high';
  MEDIUM: 'medium';
  LOW: 'low';
}

// Additional types for other dashboard components
export interface RevenueData {
  date: string;
  revenue: number;
  work_orders: number;
}

export interface RecentActivity {
  id: string;
  type: string;
  title: string;
  description: string;
  timestamp: string;
  user?: string;
  work_order_number?: string;
  staff_name?: string;
  amount?: number;
}

export interface StatusDistribution {
  status: string;
  count: number;
  percentage: number;
}


export interface DashboardFilters {
  company_id?: string;
  date_from: string;
  date_to: string;
  refresh?: boolean;
}

export interface TimePeriod {
  WEEK: 'week';
  MONTH: 'month';
  QUARTER: 'quarter';
  YEAR: 'year';
}

export interface WorkOrderSummary {
  id: string;
  work_order_number: string;
  client_name: string;
  document_type: string;
  status: string;
  priority: PriorityLevel;
  created_at: string;
  scheduled_start_date?: string;
  scheduled_end_date?: string;
  assigned_staff: Array<{
    id: string;
    name: string;
    role: string;
  }>;
  days_old: number;
  is_overdue: boolean;
  revision_requested: boolean;
  revision_count: number;
}

export interface DocumentCompletionStats {
  document_type: string;
  completed_count: number;
  paid_count: number;
  total_amount: number;
  average_completion_time_hours?: number;
}

export interface RevisionRequiredDocument {
  id: string;
  document_type: string;
  document_number: string;
  client_name: string;
  revision_requested_date: string;
  revision_notes?: string;
  assigned_to?: string;
  days_pending: number;
}

export interface AdminStats {
  total_work_orders: number;
  revenue_this_month: number;
  revenue_trend: number;
  pending_approvals: number;
  active_work_orders: number;
  completion_rate: number;
  average_processing_time: number;
}

export interface Alert {
  id: string;
  title: string;
  description: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  timestamp: string;
  type: string;
}

export interface CreditUsage {
  utilization_rate: number;
  total_credits: number;
  used_credits: number;
  remaining_credits: number;
}

export interface DocumentTypeDistribution {
  document_type: string;
  count: number;
  revenue: number;
  percentage: number;
}

export interface TradePopularity {
  trade_name: string;
  count: number;
  revenue: number;
  trend: 'up' | 'down' | 'stable';
  percentage: number;
}

export interface StaffPerformance {
  staff_id: string;
  staff_name: string;
  completed_orders: number;
  revenue_generated: number;
  rating: number;
  efficiency_score: number;
}

export interface UserDashboardData {
  urgent_work_orders: WorkOrderSummary[];
  high_priority_work_orders: WorkOrderSummary[];
  medium_priority_work_orders: WorkOrderSummary[];
  low_priority_work_orders: WorkOrderSummary[];
  overdue_work_orders: WorkOrderSummary[];
  total_assigned: number;
  completed_today: number;
  completed_this_week: number;
  pending_revisions: number;
  document_completions: DocumentCompletionStats[];
  documents_requiring_revision: RevisionRequiredDocument[];
  time_period: keyof TimePeriod;
}

export interface TeamMemberStats {
  staff_id: string;
  staff_name: string;
  email: string;
  role: string;
  assigned_work_orders: number;
  completed_today: number;
  completed_this_week: number;
  pending_revisions: number;
  average_completion_time_hours?: number;
}

export interface ManagerDashboardData extends UserDashboardData {
  team_members: TeamMemberStats[];
  team_total_assigned: number;
  team_completed_today: number;
  team_completed_this_week: number;
  team_pending_revisions: number;
  work_distribution: Record<string, number>;
}

export interface AdminDashboardData extends ManagerDashboardData {
  all_work_orders: WorkOrderSummary[];
  system_total_work_orders: number;
  system_completed_today: number;
  system_completed_this_week: number;
  system_pending_revisions: number;
  companies_count: number;
  total_revenue_this_period: number;
  stats?: AdminStats;
  alerts?: Alert[];
  credit_usage?: CreditUsage;
  revenue_chart?: RevenueData[];
  status_distribution?: StatusDistribution[];
  document_type_distribution?: DocumentTypeDistribution[];
  trade_popularity?: TradePopularity[];
  recent_activities?: RecentActivity[];
  staff_performance?: StaffPerformance[];
}

// Type guards for dashboard data
export function isManagerDashboardData(
  data: UserDashboardData | ManagerDashboardData | AdminDashboardData
): data is ManagerDashboardData {
  return 'team_members' in data && 'team_total_assigned' in data;
}

export function isAdminDashboardData(
  data: UserDashboardData | ManagerDashboardData | AdminDashboardData
): data is AdminDashboardData {
  return 'system_total_work_orders' in data && 'companies_count' in data;
}

export type DashboardData = UserDashboardData | ManagerDashboardData | AdminDashboardData;

export const dashboardService = {
  async getUserDashboard(timePeriod: string = 'week'): Promise<UserDashboardData> {
    const response = await apiClient.get('/api/dashboard/user', {
      params: { time_period: timePeriod }
    });
    return response.data;
  },

  async getManagerDashboard(timePeriod: string = 'week'): Promise<ManagerDashboardData> {
    const response = await apiClient.get('/api/dashboard/manager', {
      params: { time_period: timePeriod }
    });
    return response.data;
  },

  async getAdminDashboard(timePeriod: string = 'week'): Promise<AdminDashboardData> {
    const response = await apiClient.get('/api/dashboard/admin', {
      params: { time_period: timePeriod }
    });
    return response.data;
  },

  async getMyWorkOrders(filters?: {
    status?: string;
    priority?: string;
    include_overdue?: boolean;
    page?: number;
    page_size?: number;
  }) {
    const response = await apiClient.get('/api/dashboard/my-work-orders', {
      params: filters
    });
    return response.data;
  },

  async getDocumentCompletions(timePeriod: string = 'week') {
    const response = await apiClient.get('/api/dashboard/document-completions', {
      params: { time_period: timePeriod }
    });
    return response.data;
  },

  async getRevisionRequiredDocuments() {
    const response = await apiClient.get('/api/dashboard/revision-required');
    return response.data;
  },

  async updateRevisionStatus(workOrderId: string, revisionRequested: boolean, revisionNotes?: string) {
    const response = await apiClient.patch(`/api/dashboard/work-order/${workOrderId}/revision`, {
      revision_requested: revisionRequested,
      revision_notes: revisionNotes
    });
    return response.data;
  },

  // Legacy methods for AdminDashboard compatibility
  async getDashboardData(filters: DashboardFilters): Promise<DashboardData> {
    const response = await apiClient.get('/api/dashboard/overview', {
      params: filters
    });
    return response.data;
  },

  async exportReport(type: 'excel' | 'pdf', filters: DashboardFilters): Promise<Blob> {
    const response = await apiClient.post('/api/dashboard/export', 
      { ...filters, format: type },
      { responseType: 'blob' }
    );
    return response.data;
  },

  async approveMultipleOrders(orderIds: string[]): Promise<void> {
    await apiClient.post('/api/dashboard/bulk-approve', { order_ids: orderIds });
  }
};