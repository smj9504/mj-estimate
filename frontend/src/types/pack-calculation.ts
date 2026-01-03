/**
 * Pack Calculation Types
 *
 * Comprehensive TypeScript type definitions for the Pack Calculation domain.
 * Matches backend Pydantic schemas exactly for type safety across the stack.
 */

// ============================================================================
// Enums
// ============================================================================

/**
 * Pack calculation input mode
 * Determines how items are entered into the system
 */
export enum PackInputMode {
  /** Manual structured entry with individual items */
  STRUCTURED = 'STRUCTURED',
  /** Template-based estimation using room type and density */
  TEMPLATE = 'TEMPLATE',
  /** AI-powered bulk text parsing */
  BULK_TEXT = 'BULK_TEXT',
  /** Legacy free-form text input */
  TEXT = 'TEXT',
  /** AI image recognition (future) */
  IMAGE = 'IMAGE',
}

/**
 * Room types for template-based estimation
 */
export enum RoomType {
  LIVING_ROOM = 'living_room',
  BEDROOM = 'bedroom',
  KITCHEN = 'kitchen',
  DINING_ROOM = 'dining_room',
  HOME_OFFICE = 'home_office',
  BATHROOM = 'bathroom',
  GARAGE = 'garage',
  BASEMENT = 'basement',
  ATTIC = 'attic',
}

/**
 * Density levels for template-based estimation
 */
export enum DensityLevel {
  MINIMAL = 'minimal',
  MODERATE = 'moderate',
  FULL = 'full',
  PACKED = 'packed',
}

/**
 * Room size categories based on square footage
 */
export enum RoomSize {
  SMALL = 'small',
  MEDIUM = 'medium',
  LARGE = 'large',
}

/**
 * Room size information for UI display and calculations
 */
export interface RoomSizeInfo {
  value: RoomSize;
  label: string;
  sqft_range: [number, number];
  example_dimensions: string[];
  description: string;
  multiplier: number;
}

/**
 * Room size configuration mapping
 */
export const ROOM_SIZE_INFO: Record<RoomSize, RoomSizeInfo> = {
  [RoomSize.SMALL]: {
    value: RoomSize.SMALL,
    label: 'Small',
    sqft_range: [100, 200],
    example_dimensions: ['10x12 ft', '8x15 ft', '11x11 ft'],
    description: 'Studio apartment, compact spaces',
    multiplier: 0.6,
  },
  [RoomSize.MEDIUM]: {
    value: RoomSize.MEDIUM,
    label: 'Medium',
    sqft_range: [200, 400],
    example_dimensions: ['12x20 ft', '15x18 ft', '14x22 ft'],
    description: 'Average home, standard rooms',
    multiplier: 1.0,
  },
  [RoomSize.LARGE]: {
    value: RoomSize.LARGE,
    label: 'Large',
    sqft_range: [400, 800],
    example_dimensions: ['20x25 ft', '18x30 ft', '22x28 ft'],
    description: 'Luxury home, open concept',
    multiplier: 1.7,
  },
};

/**
 * Floor level enumeration
 */
export enum FloorLevel {
  BASEMENT = 'BASEMENT',
  MAIN_LEVEL = 'MAIN_LEVEL',
  SECOND_FLOOR = 'SECOND_FLOOR',
  THIRD_FLOOR = 'THIRD_FLOOR',
  FOURTH_FLOOR = 'FOURTH_FLOOR',
  FIFTH_FLOOR_PLUS = 'FIFTH_FLOOR_PLUS',
}

/**
 * Building type enumeration
 */
export enum BuildingType {
  HOUSE = 'HOUSE',
  APARTMENT = 'APARTMENT',
  TOWNHOUSE = 'TOWNHOUSE',
  CONDO = 'CONDO',
  COMMERCIAL = 'COMMERCIAL',
}

// ============================================================================
// Template Types
// ============================================================================

/**
 * Summary of a room template
 */
export interface TemplateSummary {
  id: string;
  room_type: string;
  name: string;
  description: string;
  item_count: number;
  has_storage_multipliers: boolean;
  supported_density_levels: string[];
}

/**
 * Template item detail
 */
export interface TemplateItem {
  category: string;
  subcategory: string | null;
  base_quantity: number;
  variance_range: [number, number];
  pack_size: number;
  is_optional: boolean;
  storage_type: string | null;
}

/**
 * Storage multiplier detail
 */
export interface StorageMultiplier {
  storage_type: string;
  base_count: number;
  items_per_unit: number;
  density_impact: Record<string, number>;
}

/**
 * Density modifier detail
 */
export interface DensityModifier {
  density_level: string;
  quantity_multiplier: number;
  additional_categories: string[];
}

/**
 * Detailed template response
 */
export interface TemplateDetail {
  id: string;
  room_type: string;
  name: string;
  description: string;
  base_items: TemplateItem[];
  storage_multipliers: StorageMultiplier[];
  density_modifiers: DensityModifier[];
}

// ============================================================================
// Density Estimation Types
// ============================================================================

/**
 * Request for density-based estimation
 */
export interface DensityEstimationRequest {
  room_type: string;
  density_level: string;
  room_size?: string;
  custom_adjustments?: Record<string, any> | null;
}

/**
 * Estimated item from density calculation
 */
export interface EstimatedItem {
  category: string;
  subcategory: string;
  quantity: number;
  pack_size: number;
  storage_type: string | null;
}

/**
 * Response from density estimation
 */
export interface DensityEstimationResponse {
  estimated_items: EstimatedItem[];
  total_boxes: number;
  confidence: number;
  breakdown: Record<string, number>;
  assumptions: string[];
}

// ============================================================================
// Bulk Text Parser Types
// ============================================================================

/**
 * Request for bulk text parsing
 */
export interface BulkTextParseRequest {
  text: string;
  options?: Record<string, any> | null;
}

/**
 * Parsed item response
 */
export interface ParsedItem {
  category: string;
  subcategory: string;
  quantity: number;
  pack_size: number;
  original_text: string;
  confidence: number;
}

/**
 * Response from bulk text parsing
 */
export interface BulkTextParseResponse {
  items: ParsedItem[];
  unparsed_lines: string[];
  warnings: string[];
  confidence: number;
  summary: Record<string, number>;
}

// ============================================================================
// Utility Types
// ============================================================================

/**
 * Convert TemplateSummary to select option format
 */
export interface TemplateOption {
  value: string;
  label: string;
  description: string;
  item_count: number;
}

/**
 * Convert DensityLevel enum to select option format
 */
export interface DensityOption {
  value: DensityLevel;
  label: string;
  description: string;
  multiplier: number;
}

/**
 * Helper type for room type display
 */
export interface RoomTypeOption {
  value: RoomType;
  label: string;
  icon?: string;
}
