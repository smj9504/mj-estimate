/**
 * Xactimate data transformation utilities
 * Converts between Xactimate items and EstimateLineItem format
 */

import { XactimateItem, XactimateComponent } from '../types/xactimate';
import { EstimateLineItem } from '../services/EstimateService';

export interface XactimateLineItemData extends EstimateLineItem {
  // Additional Xactimate-specific data
  xactimate_item_id: number;
  xactimate_item_code: string;
  category_code: string;
  price_year: number;
  price_month: number;
  labor_cost?: number;
  material_cost?: number;
  equipment_cost?: number;
  labor_burden?: number;
  market_conditions?: number;
  components?: XactimateComponent[];
  includes_description?: string;
  excludes_description?: string;
  note_description?: string;
  quality_description?: string;
  reference_description?: string;
}

/**
 * Convert XactimateItem to EstimateLineItem format
 */
export const convertXactimateToLineItem = (
  xactimateItem: XactimateItem,
  quantity: number = 1,
  unit: string = 'EA'
): XactimateLineItemData => {
  // Ensure unit price is a number
  const unitPrice = typeof xactimateItem.untaxed_unit_price === 'number'
    ? xactimateItem.untaxed_unit_price
    : parseFloat(String(xactimateItem.untaxed_unit_price)) || 0;
  const total = unitPrice * quantity;

  return {
    // EstimateLineItem base properties
    id: `xact_${xactimateItem.id}_${Date.now()}`, // Unique ID for this line item
    item: xactimateItem.item_code,
    description: xactimateItem.description,
    note: formatXactimateNote(xactimateItem), // Convert to rich text HTML
    quantity,
    unit,
    unit_price: unitPrice,
    total,
    
    // Grouping - use category name as primary group, fallback to category code
    // Ensure we get the category name properly
    primary_group: xactimateItem.category?.category_name ||
                   xactimateItem.category_code ||
                   'Xactimate Items',
    secondary_group: undefined, // Can be set by user later
    
    // Xactimate-specific data
    xactimate_item_id: xactimateItem.id,
    xactimate_item_code: xactimateItem.item_code,
    category_code: xactimateItem.category_code,
    price_year: xactimateItem.price_year,
    price_month: xactimateItem.price_month,
    labor_cost: xactimateItem.labor_cost,
    material_cost: xactimateItem.material_cost,
    equipment_cost: xactimateItem.equipment_cost,
    labor_burden: xactimateItem.labor_burden,
    market_conditions: xactimateItem.market_conditions,
    components: xactimateItem.components,
    includes_description: xactimateItem.includes_description,
    excludes_description: xactimateItem.excludes_description,
    note_description: xactimateItem.note_description,
    quality_description: xactimateItem.quality_description,
    reference_description: xactimateItem.reference_description,
  };
};

/**
 * Format Xactimate item information as HTML note
 */
const formatXactimateNote = (item: XactimateItem): string => {
  const parts: string[] = [];
  
  // Safe number conversion helper
  const safeToFixed = (value: any, decimals: number = 2): string => {
    const num = Number(value);
    return isNaN(num) ? '0.00' : num.toFixed(decimals);
  };
  
  // Basic info
  parts.push(`<strong>Xactimate Code:</strong> ${item.item_code}`);
  parts.push(`<strong>Category:</strong> ${item.category_code}`);
  parts.push(`<strong>Price Date:</strong> ${item.price_month}/${item.price_year}`);
  
  // Cost breakdown
  if (item.labor_cost || item.material_cost || item.equipment_cost) {
    const costParts: string[] = [];
    if (item.labor_cost) costParts.push(`Labor: $${safeToFixed(item.labor_cost)}`);
    if (item.material_cost) costParts.push(`Material: $${safeToFixed(item.material_cost)}`);
    if (item.equipment_cost) costParts.push(`Equipment: $${safeToFixed(item.equipment_cost)}`);
    if (item.labor_burden) costParts.push(`Labor Burden: $${safeToFixed(item.labor_burden)}`);
    if (item.market_conditions) costParts.push(`Market Conditions: $${safeToFixed(item.market_conditions)}`);
    
    parts.push(`<strong>Cost Breakdown:</strong> ${costParts.join(', ')}`);
  }
  
  // Additional descriptions
  if (item.includes_description) {
    parts.push(`<strong>Includes:</strong> ${item.includes_description}`);
  }
  if (item.excludes_description) {
    parts.push(`<strong>Excludes:</strong> ${item.excludes_description}`);
  }
  if (item.note_description) {
    parts.push(`<strong>Notes:</strong> ${item.note_description}`);
  }
  if (item.quality_description) {
    parts.push(`<strong>Quality:</strong> ${item.quality_description}`);
  }
  
  return parts.join('<br/>');
};

/**
 * Check if a line item is from Xactimate
 */
export const isXactimateLineItem = (item: EstimateLineItem): item is XactimateLineItemData => {
  return 'xactimate_item_id' in item;
};

/**
 * Get cost breakdown for display
 */
export const getXactimateCostBreakdown = (item: XactimateLineItemData) => {
  return {
    labor: item.labor_cost || 0,
    material: item.material_cost || 0,
    equipment: item.equipment_cost || 0,
    labor_burden: item.labor_burden || 0,
    market_conditions: item.market_conditions || 0,
    total: item.unit_price,
  };
};

/**
 * Format Xactimate item for table display
 */
export const formatXactimateForTable = (item: XactimateItem) => {
  // Safe number conversion
  const safeToFixed = (value: any, decimals: number = 2): string => {
    const num = Number(value);
    return isNaN(num) ? '0.00' : num.toFixed(decimals);
  };

  return {
    key: item.id.toString(),
    item_code: item.item_code,
    category: item.category_code,
    description: item.description,
    unit_price: `$${safeToFixed(item.untaxed_unit_price)}`,
    labor: item.labor_cost ? `$${safeToFixed(item.labor_cost)}` : '-',
    material: item.material_cost ? `$${safeToFixed(item.material_cost)}` : '-',
    equipment: item.equipment_cost ? `$${safeToFixed(item.equipment_cost)}` : '-',
    price_date: `${item.price_month}/${item.price_year}`,
    rawItem: item, // Keep original data for selection
  };
};

/**
 * Recalculate totals when quantity changes
 */
export const recalculateXactimateLineItem = (
  item: XactimateLineItemData,
  newQuantity: number
): XactimateLineItemData => {
  return {
    ...item,
    quantity: newQuantity,
    total: item.unit_price * newQuantity,
  };
};