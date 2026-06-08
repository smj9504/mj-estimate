/**
 * Supplement (re-estimation) types
 */

export type SupplementStatus = 'identified' | 'in_progress' | 'submitted' | 'under_review' | 'approved' | 'denied' | 'withdrawn';
export type BidItemStatus = 'draft' | 'sent' | 'approved' | 'revision_needed' | 'denied';
export type BidItemType = 'xactimate' | 'bathroom' | 'cabinet' | 'packing' | 'roofing' | 'kitchen' | 'flooring' | 'other';

export type RequestType = 'supplement' | 'estimate_request';

export interface SupplementRequest {
  id: string;
  claim_id: string;
  negotiation_id?: string;
  request_type: RequestType;
  title: string;
  reason?: string;
  description?: string;
  original_amount: number;
  supplement_amount: number;
  our_estimate_amount: number;
  difference: number;
  status: SupplementStatus;
  priority: string;
  submitted_to?: string;
  submitted_to_email?: string;
  submitted_date?: string;
  response_date?: string;
  response_notes?: string;
  required_estimates?: Record<string, boolean>;
  document_file_id?: string;
  document_file_name?: string;
  created_at?: string;
  updated_at?: string;
  // Enriched
  claim_number?: string;
  insurance_company?: string;
  property_address?: string;
  wm_company_id?: string;
  wm_company_name?: string;
  rebuild_company_id?: string;
  rebuild_company_name?: string;
  bid_item_count: number;
  followup_count: number;
  bid_items: BidItemEstimate[];
}

export interface SupplementRequestCreate {
  claim_id: string;
  negotiation_id?: string;
  request_type?: RequestType;
  title: string;
  reason?: string;
  description?: string;
  original_amount?: number;
  supplement_amount?: number;
  our_estimate_amount?: number;
  priority?: string;
  submitted_to?: string;
  submitted_to_email?: string;
  required_estimates?: Record<string, boolean>;
}

export interface BidItemEstimate {
  id: string;
  supplement_id: string;
  estimate_type: BidItemType;
  title: string;
  description?: string;
  bathroom_estimate_id?: string;
  cabinet_estimate_id?: string;
  pack_calculation_id?: string;
  roofing_estimate_id?: string;
  custom_amount?: number;
  custom_document_file_id?: string;
  custom_document_file_name?: string;
  included_in_xactimate: boolean;
  status: BidItemStatus;
  sent_to_pa_date?: string;
  pa_response_date?: string;
  pa_response_notes?: string;
  created_at?: string;
}

export interface BidItemEstimateCreate {
  supplement_id: string;
  estimate_type: BidItemType;
  title?: string;
  description?: string;
  bathroom_estimate_id?: string;
  cabinet_estimate_id?: string;
  pack_calculation_id?: string;
  roofing_estimate_id?: string;
  custom_amount?: number;
  custom_document_file_id?: string;
  custom_document_file_name?: string;
  included_in_xactimate?: boolean;
}

export interface SupplementFollowUp {
  id: string;
  supplement_id: string;
  followup_type?: string;
  contact_method: string;
  contact_name?: string;
  contact_email?: string;
  summary?: string;
  items_needed?: Array<{ description: string; resolved: boolean }>;
  request_to_type?: string;
  info_status?: string;
  response_received: boolean;
  response_date?: string;
  response_summary?: string;
  reply_body_html?: string;
  reply_attachment_ids?: string[];
  conversation?: Array<{
    type: 'sent' | 'received';
    date: string;
    sender: string;
    body_html: string;
    summary?: string;
  }>;
  sent_email_id?: string;
  follow_up_count?: number;
  last_follow_up_date?: string;
  created_at?: string;
}

export interface SupplementDashboardStats {
  total: number;
  identified: number;
  in_progress: number;
  submitted: number;
  under_review: number;
  approved: number;
  denied: number;
  total_supplement_amount: number;
  total_difference: number;
}

export const SUPPLEMENT_STATUS_COLORS: Record<SupplementStatus, string> = {
  identified: 'blue',
  in_progress: 'processing',
  submitted: 'orange',
  under_review: 'geekblue',
  approved: 'green',
  denied: 'red',
  withdrawn: 'default',
};

export const BID_ITEM_TYPE_LABELS: Record<BidItemType, string> = {
  xactimate: 'Xactimate',
  bathroom: 'Bathroom',
  cabinet: 'Cabinet',
  packing: 'Packing',
  roofing: 'Roofing',
  kitchen: 'Kitchen',
  flooring: 'Flooring',
  other: 'Other',
};

export const BID_ITEM_STATUS_COLORS: Record<BidItemStatus, string> = {
  draft: 'default',
  sent: 'blue',
  approved: 'green',
  revision_needed: 'orange',
  denied: 'red',
};
