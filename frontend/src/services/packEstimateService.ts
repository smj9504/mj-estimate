/**
 * Pack Estimate Service
 *
 * Frontend service for AI-powered pack-out estimate generation.
 * Integrates with backend Pack Estimate API.
 */

import axios from 'axios';

const API_BASE = '/api/photo-analysis/pack-estimate';

// ============================================================
// Type Definitions
// ============================================================

export interface PackInventoryItem {
  item_id?: string;  // e.g., LR-001
  category: string;
  description: string;
  quantity: number;
  size_type?: string;  // Small, Medium, Large
  condition: 'good' | 'fair' | 'poor';
  packing_method?: string;
  box_type?: string;  // SMALL_BOX, PICTURE_BOX, N/A, etc.
  special_handling: string[];
  packing_materials_needed?: string[];
  estimated_pack_time_minutes?: number;
  notes?: string;
  // Legacy fields for backward compatibility
  size_category?: 'SM' | 'MD' | 'LG' | 'OV';
  estimated_boxes?: number;
}

export interface PackRoomCharacteristics {
  approximate_size: 'small' | 'medium' | 'large';
  density_level: 'MINIMAL' | 'MODERATE' | 'FULL' | 'PACKED';
  access_notes?: string;
}

export interface PackingRecommendations {
  estimated_total_boxes: number;
  special_supplies_needed: string[];
  estimated_pack_time_hours: number;
}

export interface BoxRequirements {
  SMALL_BOX: number;
  MEDIUM_BOX: number;
  LARGE_BOX: number;
  EXTRA_LARGE_BOX: number;
  WARDROBE_BOX: number;
  DISH_PACK_BOX: number;
  PICTURE_BOX: number;
  LONG_BOX: number;
  LAMP_BOX: number;
  TV_BOX: number;
  TUBE_BOX: number;
  OTHER: number;
}

export interface PackingSupplyItem {
  code: string;
  name: string;
  quantity: number;
}

export interface PackingSummary {
  box_requirements: BoxRequirements;
  supplies_needed: PackingSupplyItem[];
  fragile_item_count: number;
  heavy_item_count: number;
  estimated_total_pack_time_hours: number;
  crew_size_recommended: number;
  special_equipment_needed: string[];
  // Legacy fields
  estimated_total_boxes?: number;
  special_supplies_needed?: string[];
}

export interface Phase1Result {
  room_name: string;
  items: PackInventoryItem[];
  room_characteristics: PackRoomCharacteristics;
  packing_summary?: PackingSummary;
  // Legacy field for backward compatibility
  packing_recommendations?: PackingRecommendations;
}

export interface PackEstimateLineItem {
  id: string;
  name: string;
  description?: string;
  quantity: number;
  unit: 'HR' | 'EA' | 'BX' | 'SF' | 'LF' | 'LD';
  unit_price: number;
  total: number;
  category: 'LABOR' | 'MATERIALS' | 'EQUIPMENT' | 'SPECIAL';
  primary_group: string;
  secondary_group?: string;
  notes?: string;
  taxable: boolean;
  sort_order: number;
}

export interface PackEstimateSummary {
  subtotal: number;
  tax_rate: number;
  tax_amount: number;
  total: number;
  estimated_duration_hours: number;
}

export interface Phase2Result {
  line_items: PackEstimateLineItem[];
  summary: PackEstimateSummary;
}

export interface PackEstimateResult {
  phase1_inventory?: Phase1Result;
  line_items: PackEstimateLineItem[];
  summary: PackEstimateSummary;
  processing_info: {
    photo_count: number;
    room_name: string;
    phase1_method: string;
    phase2_method: string;
    items_detected?: number;
    boxes_estimated?: number;
    line_items_generated?: number;
    estimated_total?: number;
  };
}

// Estimate Editor compatible format
export interface EstimateLineItem {
  id: string;
  line_item_id?: string;
  name: string;
  description?: string;
  note?: string;
  quantity: number;
  unit: string;
  unit_price: number;
  total: number;
  taxable: boolean;
  primary_group: string;
  secondary_group?: string;
  sort_order: number;
}

export interface ExportToEstimateResponse {
  line_items: EstimateLineItem[];
  summary: PackEstimateSummary;
}

// ============================================================
// Database Storage Types
// ============================================================

export type PackEstimateStatus = 'draft' | 'pending_review' | 'approved' | 'rejected' | 'converted';

export interface SavePackEstimateRequest {
  pack_result: PackEstimateResult;
  job_id?: string;
  job_name?: string;
  customer_name?: string;
  address?: string;
  notes?: string;
}

export interface PackEstimateRecord {
  id: number;
  job_id?: string;
  job_name?: string;
  customer_name?: string;
  address?: string;
  room_name: string;
  status: PackEstimateStatus;
  photo_urls: string[];
  items_detected_count: number;
  total_boxes: number;
  box_requirements: BoxRequirements;
  fragile_item_count: number;
  heavy_item_count: number;
  estimated_pack_time_hours: number;
  crew_size_recommended: number;
  special_equipment_needed?: string[];
  line_items_count: number;
  subtotal: number;
  tax_rate: number;
  tax_amount: number;
  total: number;
  notes?: string;
  created_at: string;
  updated_at?: string;
}

export interface PackEstimateDetailRecord extends PackEstimateRecord {
  phase1_inventory?: Phase1Result;
  packing_summary?: PackingSummary;
  line_items?: PackEstimateLineItem[];
  processing_info?: Record<string, unknown>;
}

export interface PackEstimateListResponse {
  items: PackEstimateRecord[];
  total: number;
  page: number;
  page_size: number;
  total_pages: number;
}

export interface UpdatePackEstimateRequest {
  job_id?: string;
  job_name?: string;
  customer_name?: string;
  address?: string;
  status?: PackEstimateStatus;
  notes?: string;
}

// ============================================================
// API Functions
// ============================================================

/**
 * Generate complete pack estimate from photos
 */
export async function generatePackEstimate(
  photoUrls: string[],
  roomName: string = 'Pack-Out Estimate',
  customPricingJson?: string,
  skipPhase2Ai: boolean = false
): Promise<PackEstimateResult> {
  const response = await axios.post<PackEstimateResult>(`${API_BASE}/generate`, {
    photo_urls: photoUrls,
    room_name: roomName,
    custom_pricing_json: customPricingJson,
    skip_phase2_ai: skipPhase2Ai,
  });
  return response.data;
}

/**
 * Phase 1 only: Analyze photos to create inventory
 */
export async function analyzePhotosPhase1(
  photoUrls: string[],
  roomName: string = 'Unknown Room'
): Promise<Phase1Result> {
  const response = await axios.post<Phase1Result>(`${API_BASE}/analyze-photos`, {
    photo_urls: photoUrls,
    room_name: roomName,
  });
  return response.data;
}

/**
 * Phase 2 only: Generate estimate from existing inventory
 */
export async function generateFromInventory(
  inventory: Phase1Result,
  customPricingJson?: string
): Promise<Phase2Result> {
  const response = await axios.post<Phase2Result>(`${API_BASE}/generate-from-inventory`, {
    inventory,
    custom_pricing_json: customPricingJson,
  });
  return response.data;
}

/**
 * Export pack estimate to Estimate Editor format
 */
export async function exportToEstimate(
  packResult: PackEstimateResult
): Promise<ExportToEstimateResponse> {
  const response = await axios.post<ExportToEstimateResponse>(
    `${API_BASE}/export-to-estimate`,
    { pack_result: packResult }
  );
  return response.data;
}

/**
 * Set custom pricing data
 */
export async function setPricingData(pricingJson: string): Promise<void> {
  await axios.post(`${API_BASE}/set-pricing`, {
    pricing_json: pricingJson,
  });
}

/**
 * Get default pricing data
 */
export async function getDefaultPricing(): Promise<{ pricing_data: string }> {
  const response = await axios.get<{ pricing_data: string }>(
    `${API_BASE}/default-pricing`
  );
  return response.data;
}

/**
 * Get service info
 */
export async function getServiceInfo(): Promise<Record<string, unknown>> {
  const response = await axios.get(`${API_BASE}/service-info`);
  return response.data;
}

// ============================================================
// Database CRUD Functions
// ============================================================

/**
 * Save pack estimate to database
 */
export async function savePackEstimate(
  packResult: PackEstimateResult,
  options?: {
    jobId?: string;
    jobName?: string;
    customerName?: string;
    address?: string;
    notes?: string;
  }
): Promise<PackEstimateRecord> {
  const response = await axios.post<PackEstimateRecord>(`${API_BASE}/save`, {
    pack_result: packResult,
    job_id: options?.jobId,
    job_name: options?.jobName,
    customer_name: options?.customerName,
    address: options?.address,
    notes: options?.notes,
  });
  return response.data;
}

/**
 * List saved pack estimates with pagination
 */
export async function listPackEstimates(options?: {
  page?: number;
  pageSize?: number;
  status?: PackEstimateStatus;
  jobId?: string;
}): Promise<PackEstimateListResponse> {
  const params = new URLSearchParams();
  if (options?.page) params.append('page', options.page.toString());
  if (options?.pageSize) params.append('page_size', options.pageSize.toString());
  if (options?.status) params.append('status', options.status);
  if (options?.jobId) params.append('job_id', options.jobId);

  const response = await axios.get<PackEstimateListResponse>(
    `${API_BASE}/list?${params.toString()}`
  );
  return response.data;
}

/**
 * Get pack estimate by ID with full details
 */
export async function getPackEstimate(estimateId: number): Promise<PackEstimateDetailRecord> {
  const response = await axios.get<PackEstimateDetailRecord>(`${API_BASE}/${estimateId}`);
  return response.data;
}

/**
 * Update pack estimate metadata
 */
export async function updatePackEstimate(
  estimateId: number,
  updates: UpdatePackEstimateRequest
): Promise<PackEstimateRecord> {
  const response = await axios.put<PackEstimateRecord>(`${API_BASE}/${estimateId}`, updates);
  return response.data;
}

/**
 * Delete pack estimate
 */
export async function deletePackEstimate(
  estimateId: number
): Promise<{ status: string; message: string }> {
  const response = await axios.delete<{ status: string; message: string }>(
    `${API_BASE}/${estimateId}`
  );
  return response.data;
}

// ============================================================
// Helper Functions
// ============================================================

/**
 * Convert PackEstimateLineItem to EstimateLineItem (client-side conversion)
 */
export function convertToEstimateItems(
  packItems: PackEstimateLineItem[]
): EstimateLineItem[] {
  return packItems.map((item, index) => ({
    id: item.id,
    line_item_id: undefined,
    name: item.name,
    description: item.description,
    note: item.notes,
    quantity: item.quantity,
    unit: item.unit,
    unit_price: item.unit_price,
    total: item.total,
    taxable: item.taxable,
    primary_group: item.primary_group,
    secondary_group: item.secondary_group,
    sort_order: index,
  }));
}

/**
 * Calculate totals for line items
 */
export function calculateTotals(items: EstimateLineItem[]): PackEstimateSummary {
  const subtotal = items.reduce((sum, item) => sum + item.total, 0);
  const taxableAmount = items
    .filter((item) => item.taxable)
    .reduce((sum, item) => sum + item.total, 0);
  const taxRate = 0; // Will be set from estimate settings
  const taxAmount = (taxableAmount * taxRate) / 100;
  const total = subtotal + taxAmount;

  const laborItems = items.filter(
    (item) => item.unit === 'HR' || item.secondary_group === 'LABOR'
  );
  const estimatedHours = laborItems.reduce((sum, item) => sum + item.quantity, 0);

  return {
    subtotal,
    tax_rate: taxRate,
    tax_amount: taxAmount,
    total,
    estimated_duration_hours: estimatedHours,
  };
}

/**
 * Format currency
 */
export function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(amount);
}

/**
 * Format unit display
 */
export function formatUnit(unit: string): string {
  const unitLabels: Record<string, string> = {
    HR: 'Hour',
    EA: 'Each',
    BX: 'Box',
    SF: 'Sq Ft',
    LF: 'Lin Ft',
    LD: 'Load',
  };
  return unitLabels[unit] || unit;
}

// ============================================================
// Default Export
// ============================================================

const packEstimateService = {
  // Generation APIs
  generatePackEstimate,
  analyzePhotosPhase1,
  generateFromInventory,
  exportToEstimate,
  setPricingData,
  getDefaultPricing,
  getServiceInfo,
  // Database CRUD APIs
  savePackEstimate,
  listPackEstimates,
  getPackEstimate,
  updatePackEstimate,
  deletePackEstimate,
  // Helper functions
  convertToEstimateItems,
  calculateTotals,
  formatCurrency,
  formatUnit,
};

export default packEstimateService;
