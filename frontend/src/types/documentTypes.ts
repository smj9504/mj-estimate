export interface DocumentType {
  id: string;
  name: string;
  code: string;
  description?: string;
  category?: string;
  base_price: string;
  pricing_rules?: {
    location_rules?: {
      base_locations: number;
      additional_location_price: number;
      additional_location_grouping: number;
    };
    addons?: Array<{
      name: string;
      price: number;
    }>;
    volume_discounts?: Array<{
      min_quantity: number;
      discount_percent: number;
    }>;
  };
  requires_measurement_report: boolean;
  measurement_report_providers?: string[];
  template_name?: string;
  required_fields?: string[];
  optional_fields?: string[];
  requires_approval: boolean;
  approval_levels: number;
  estimated_hours?: string;
  is_active: boolean;
  is_available_online: boolean;
  display_order: number;
  icon?: string;
  color?: string;
  created_at: string;
  updated_at: string;
}

export interface Trade {
  id: string;
  name: string;
  code: string;
  description?: string;
  category?: string;
  requires_license: boolean;
  license_type?: string;
  requires_insurance: boolean;
  insurance_minimum?: string;
  default_markup?: string;
  default_hourly_rate?: string;
  required_skills?: string[];
  required_tools?: string[];
  is_active: boolean;
  display_order: number;
  icon?: string;
  color?: string;
  created_at: string;
  updated_at: string;
}

export interface MeasurementReportType {
  id: string;
  name: string;
  provider: 'eagleview' | 'roofr' | 'hover' | 'custom';
  description?: string;
  base_cost: string;
  markup_percent: string;
  fixed_markup: string;
  standard_turnaround_hours: number;
  rush_turnaround_hours: number;
  rush_fee: string;
  required_info?: string[];
  api_endpoint?: string;
  is_active: boolean;
  is_automated: boolean;
  created_at: string;
  updated_at: string;
}

export interface PricingRule {
  id: string;
  document_type_id: string;
  rule_name: string;
  rule_type: 'flat' | 'tiered' | 'location_based' | 'addon';
  priority: number;
  parameters: any;
  conditions?: any;
  valid_from?: string;
  valid_to?: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface PriceCalculationParams {
  locations?: number;
  selected_addons?: string[];
  quantity?: number;
  rush?: boolean;
}

export interface PriceCalculationResponse {
  base_price: number;
  adjustments: Array<{
    type: string;
    description: string;
    amount: number;
  }>;
  final_price: number;
  parameters: PriceCalculationParams;
}