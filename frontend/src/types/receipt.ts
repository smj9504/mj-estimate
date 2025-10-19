// Receipt domain types

export interface ReceiptTemplate {
  id: string;
  company_id: string;
  name: string;
  description?: string;
  template_type: 'standard' | 'deposit' | 'final' | 'partial' | 'custom';
  is_default: boolean;
  is_active: boolean;
  top_note?: string;
  bottom_note?: string;
  display_options?: {
    show_payment_method?: boolean;
    show_balance_due?: boolean;
    show_invoice_details?: boolean;
    show_company_logo?: boolean;
    show_payment_breakdown?: boolean;
    footer_text?: string;
  };
  version: number;
  created_by?: string;
  updated_by?: string;
  created_at: string;
  updated_at?: string;
}

export interface Receipt {
  id: string;
  receipt_number: string;
  company_id: string;
  invoice_id: string;
  template_id?: string;
  receipt_date: string;
  payment_amount: number;
  payment_method?: string;
  payment_reference?: string;
  invoice_number: string;
  original_amount: number;
  paid_amount_to_date: number;
  balance_due: number;
  top_note?: string;
  bottom_note?: string;
  status: 'draft' | 'issued' | 'voided';
  version: number;
  superseded_by?: string;
  created_by?: string;
  updated_by?: string;
  voided_at?: string;
  voided_by?: string;
  void_reason?: string;
  created_at: string;
  updated_at?: string;
}

export interface ReceiptGenerateRequest {
  invoice_id: string;
  template_id?: string;
  receipt_date?: string;
  payment_amount: number;
  payment_method?: string;
  payment_reference?: string;
  top_note?: string;
  bottom_note?: string;
}

export interface ReceiptTemplateCreateRequest {
  company_id: string;
  name: string;
  description?: string;
  template_type?: 'standard' | 'deposit' | 'final' | 'partial' | 'custom';
  is_default?: boolean;
  top_note?: string;
  bottom_note?: string;
  display_options?: Record<string, any>;
}

export interface ReceiptTemplateUpdateRequest {
  name?: string;
  description?: string;
  template_type?: string;
  is_default?: boolean;
  is_active?: boolean;
  top_note?: string;
  bottom_note?: string;
  display_options?: Record<string, any>;
}
