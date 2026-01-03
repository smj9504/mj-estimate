/**
 * Pack Template API Service
 *
 * API service for template-based pack calculations, density estimation,
 * and bulk text parsing. Handles new input modes for improved UX.
 */

import api from './api';
import {
  TemplateSummary,
  TemplateDetail,
  DensityEstimationRequest,
  DensityEstimationResponse,
  BulkTextParseRequest,
  BulkTextParseResponse,
  RoomType,
  DensityLevel,
} from '../types/pack-calculation';

const API_BASE_URL = '/api/pack-calculation';

// ============================================================================
// Template API
// ============================================================================

/**
 * Get all available room templates
 *
 * Returns a list of template summaries with basic information.
 * Use this to populate template selection dropdowns.
 *
 * @returns Promise<TemplateSummary[]> List of template summaries
 * @throws Error if API request fails
 *
 * @example
 * ```typescript
 * const templates = await getTemplates();
 * console.log(`Found ${templates.length} templates`);
 * ```
 */
export const getTemplates = async (): Promise<TemplateSummary[]> => {
  try {
    const response = await api.get<TemplateSummary[]>(`${API_BASE_URL}/templates`);
    return response.data;
  } catch (error: any) {
    console.error('[PackTemplate] Failed to fetch templates:', error);
    throw new Error(
      error.response?.data?.detail || 'Failed to fetch room templates'
    );
  }
};

/**
 * Get detailed template for a specific room type
 *
 * Returns complete template information including base items,
 * storage multipliers, and density modifiers.
 *
 * @param roomType - Room type enum value (e.g., RoomType.LIVING_ROOM)
 * @returns Promise<TemplateDetail> Detailed template information
 * @throws Error if room type is invalid or not found
 *
 * @example
 * ```typescript
 * const template = await getTemplateDetail(RoomType.LIVING_ROOM);
 * console.log(`Base items: ${template.base_items.length}`);
 * ```
 */
export const getTemplateDetail = async (
  roomType: RoomType | string
): Promise<TemplateDetail> => {
  try {
    const response = await api.get<TemplateDetail>(
      `${API_BASE_URL}/templates/${roomType}`
    );
    return response.data;
  } catch (error: any) {
    console.error('[PackTemplate] Failed to fetch template detail:', error);
    if (error.response?.status === 404) {
      throw new Error(`Template not found for room type: ${roomType}`);
    }
    throw new Error(
      error.response?.data?.detail || 'Failed to fetch template details'
    );
  }
};

// ============================================================================
// Density Estimation API
// ============================================================================

/**
 * Estimate pack items based on room type and density level
 *
 * Uses AI-powered density estimation with template-based calculations
 * to generate a list of estimated items and total box count.
 *
 * @param request - Density estimation request with room type and density level
 * @returns Promise<DensityEstimationResponse> Estimation results with confidence
 * @throws Error if inputs are invalid or estimation fails
 *
 * @example
 * ```typescript
 * const result = await estimateByDensity({
 *   room_type: RoomType.BEDROOM,
 *   density_level: DensityLevel.MODERATE,
 *   custom_adjustments: { has_walk_in_closet: true }
 * });
 * console.log(`Total boxes: ${result.total_boxes} (${result.confidence}% confidence)`);
 * ```
 */
export const estimateByDensity = async (
  request: DensityEstimationRequest
): Promise<DensityEstimationResponse> => {
  try {
    const response = await api.post<DensityEstimationResponse>(
      `${API_BASE_URL}/estimate/density`,
      request
    );
    return response.data;
  } catch (error: any) {
    console.error('[PackTemplate] Density estimation failed:', error);
    if (error.response?.status === 400) {
      throw new Error(
        error.response?.data?.detail || 'Invalid estimation parameters'
      );
    }
    throw new Error(
      error.response?.data?.detail || 'Density estimation failed'
    );
  }
};

// ============================================================================
// Bulk Text Parser API
// ============================================================================

/**
 * Parse bulk text input into structured pack items
 *
 * Supports various text formats with intelligent category inference.
 * Returns parsed items with confidence scores and warnings for unparsed lines.
 *
 * @param request - Bulk text parse request with text and options
 * @returns Promise<BulkTextParseResponse> Parsed items with metadata
 * @throws Error if parsing fails
 *
 * @example
 * ```typescript
 * const result = await parseBulkText({
 *   text: `
 *     3 boxes of books
 *     2 large boxes kitchen items
 *     1 wardrobe box clothes
 *   `,
 *   options: { strict_mode: false }
 * });
 * console.log(`Parsed ${result.items.length} items`);
 * if (result.unparsed_lines.length > 0) {
 *   console.warn(`Could not parse: ${result.unparsed_lines}`);
 * }
 * ```
 */
export const parseBulkText = async (
  request: BulkTextParseRequest
): Promise<BulkTextParseResponse> => {
  try {
    const response = await api.post<BulkTextParseResponse>(
      `${API_BASE_URL}/parse/bulk-text`,
      request
    );
    return response.data;
  } catch (error: any) {
    console.error('[PackTemplate] Bulk text parsing failed:', error);
    throw new Error(
      error.response?.data?.detail || 'Failed to parse bulk text'
    );
  }
};

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Convert RoomType enum to human-readable label
 *
 * @param roomType - Room type enum value
 * @returns Human-readable label
 *
 * @example
 * ```typescript
 * getRoomTypeLabel(RoomType.LIVING_ROOM) // "Living Room"
 * ```
 */
export const getRoomTypeLabel = (roomType: RoomType | string): string => {
  const labels: Record<string, string> = {
    [RoomType.LIVING_ROOM]: 'Living Room',
    [RoomType.BEDROOM]: 'Bedroom',
    [RoomType.KITCHEN]: 'Kitchen',
    [RoomType.DINING_ROOM]: 'Dining Room',
    [RoomType.HOME_OFFICE]: 'Home Office',
    [RoomType.BATHROOM]: 'Bathroom',
    [RoomType.GARAGE]: 'Garage',
    [RoomType.BASEMENT]: 'Basement',
    [RoomType.ATTIC]: 'Attic',
  };
  return labels[roomType] || roomType.toString();
};

/**
 * Convert DensityLevel enum to human-readable label with description
 *
 * @param densityLevel - Density level enum value
 * @returns Object with label and description
 *
 * @example
 * ```typescript
 * const { label, description } = getDensityLevelInfo(DensityLevel.MODERATE);
 * // label: "Moderate"
 * // description: "Average furnishings, typical household"
 * ```
 */
export const getDensityLevelInfo = (
  densityLevel: DensityLevel | string
): { label: string; description: string; multiplier: number } => {
  const info: Record<
    string,
    { label: string; description: string; multiplier: number }
  > = {
    [DensityLevel.MINIMAL]: {
      label: 'Minimal',
      description: 'Sparse furnishings, few belongings',
      multiplier: 0.7,
    },
    [DensityLevel.MODERATE]: {
      label: 'Moderate',
      description: 'Average furnishings, typical household',
      multiplier: 1.0,
    },
    [DensityLevel.FULL]: {
      label: 'Full',
      description: 'Well-furnished, many belongings',
      multiplier: 1.4,
    },
    [DensityLevel.PACKED]: {
      label: 'Packed',
      description: 'Heavily furnished, maximum storage utilization',
      multiplier: 1.8,
    },
  };
  return (
    info[densityLevel] || {
      label: densityLevel.toString(),
      description: '',
      multiplier: 1.0,
    }
  );
};

/**
 * Validate room type string
 *
 * @param value - String to validate
 * @returns true if valid RoomType
 *
 * @example
 * ```typescript
 * isValidRoomType('living_room') // true
 * isValidRoomType('invalid') // false
 * ```
 */
export const isValidRoomType = (value: string): boolean => {
  return Object.values(RoomType).includes(value as RoomType);
};

/**
 * Validate density level string
 *
 * @param value - String to validate
 * @returns true if valid DensityLevel
 *
 * @example
 * ```typescript
 * isValidDensityLevel('moderate') // true
 * isValidDensityLevel('invalid') // false
 * ```
 */
export const isValidDensityLevel = (value: string): boolean => {
  return Object.values(DensityLevel).includes(value as DensityLevel);
};

/**
 * Format estimated items for display
 *
 * Groups items by storage type and calculates totals
 *
 * @param items - Array of estimated items
 * @returns Grouped items with totals
 *
 * @example
 * ```typescript
 * const grouped = formatEstimatedItems(result.estimated_items);
 * // { closet: [items...], shelves: [items...], totals: { boxes: 10 } }
 * ```
 */
export const formatEstimatedItems = (
  items: DensityEstimationResponse['estimated_items']
): {
  byStorageType: Record<string, typeof items>;
  totals: { boxes: number; items: number };
} => {
  const byStorageType: Record<string, typeof items> = {};
  let totalBoxes = 0;
  let totalItems = 0;

  items.forEach((item) => {
    const storageType = item.storage_type || 'general';
    if (!byStorageType[storageType]) {
      byStorageType[storageType] = [];
    }
    byStorageType[storageType].push(item);
    totalBoxes += Math.ceil(item.quantity / item.pack_size);
    totalItems += item.quantity;
  });

  return {
    byStorageType,
    totals: { boxes: totalBoxes, items: totalItems },
  };
};

/**
 * Export all room types as options for select components
 *
 * @returns Array of room type options
 *
 * @example
 * ```typescript
 * const options = getAllRoomTypeOptions();
 * // [{ value: 'living_room', label: 'Living Room' }, ...]
 * ```
 */
export const getAllRoomTypeOptions = (): Array<{
  value: RoomType;
  label: string;
}> => {
  return Object.values(RoomType).map((roomType) => ({
    value: roomType,
    label: getRoomTypeLabel(roomType),
  }));
};

/**
 * Export all density levels as options for select components
 *
 * @returns Array of density level options
 *
 * @example
 * ```typescript
 * const options = getAllDensityLevelOptions();
 * // [{ value: 'minimal', label: 'Minimal', description: '...', multiplier: 0.7 }, ...]
 * ```
 */
export const getAllDensityLevelOptions = (): Array<{
  value: DensityLevel;
  label: string;
  description: string;
  multiplier: number;
}> => {
  return Object.values(DensityLevel).map((densityLevel) => ({
    value: densityLevel,
    ...getDensityLevelInfo(densityLevel),
  }));
};

// ============================================================================
// Export all APIs as a single object (optional convenience)
// ============================================================================

export const packTemplateAPI = {
  getTemplates,
  getTemplateDetail,
  estimateByDensity,
  parseBulkText,
};

export default packTemplateAPI;
