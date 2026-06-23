/**
 * Water Mitigation Sketch System Type Definitions
 * Types for floor plan sketching, demolition zones, equipment placement,
 * containment, and floor protection overlays within WM jobs.
 *
 * All field names use snake_case to match the Python API response format.
 */

// ============================================================================
// Literal Union Types (no enums - matches project convention)
// ============================================================================

/** Source of the floor plan background */
export type FloorPlanSourceType = 'sketch' | 'image';

/** Which building surface a demolition zone applies to */
export type DemoSurface = 'floor' | 'wall' | 'ceiling';

/** Water mitigation equipment types */
export type EquipmentType = 'air_mover' | 'air_scrubber' | 'dehumidifier';

/** Icon shape used to render equipment on the canvas */
export type EquipmentIconShape = 'circle' | 'triangle' | 'cylinder';

/** Active tool in the WM sketch canvas toolbar */
export type WMSketchTool =
  | 'select'
  | 'demolition'
  | 'demolition_line'
  | 'demolition_polygon'
  | 'equipment'
  | 'containment'
  | 'floor_protection'
  | 'content_protection'
  | 'content_manipulation'
  | 'text'
  | 'shape'
  | 'pan'
  | 'wall'
  | 'room'
  | 'wall_split';

/** Shape types available for annotation shapes */
export type SketchShapeType = 'rectangle' | 'circle';

// ============================================================================
// Wood Floor Sub-type Configuration
// ============================================================================

/** Sub-type identifier for wood floor materials */
export type WoodFloorSubType =
  | 'hardwood'
  | 'engineered'
  | 'laminate'
  | 'lvp';

/** Configuration for a wood floor sub-type */
export interface WoodFloorSubTypeConfig {
  id: WoodFloorSubType;
  name: string;
  /** Distinguishing color shade (slightly varies from base #B8860B) */
  color: string;
}

/**
 * Available sub-types for wood_floor material.
 * Used in sketch UI, scope generation, and PDF reporting.
 */
export const WOOD_FLOOR_SUB_TYPES: WoodFloorSubTypeConfig[] = [
  { id: 'hardwood',   name: 'Hardwood',        color: '#B8860B' },
  { id: 'engineered', name: 'Engineered Wood',  color: '#CD950C' },
  { id: 'laminate',   name: 'Laminate',         color: '#A0760A' },
  { id: 'lvp',        name: 'LVP',              color: '#8B7355' },
];

// ============================================================================
// Wall Material Sub-type Configuration
// ============================================================================

/** Sub-type identifier for wall materials (drywall, wall panel, etc.) */
export type WallMaterialSubType =
  | 'drywall'
  | 'wall_panel'
  | 'plaster'
  | 'wood_panel';

/** Configuration for a wall material sub-type */
export interface WallMaterialSubTypeConfig {
  id: WallMaterialSubType;
  name: string;
  /** Distinguishing color shade */
  color: string;
}

/**
 * Available sub-types for wall demolition materials.
 * Used in sketch UI, scope generation, and PDF reporting.
 */
export const WALL_MATERIAL_SUB_TYPES: WallMaterialSubTypeConfig[] = [
  { id: 'drywall',     name: 'Drywall',      color: '#FFB6C1' },
  { id: 'wall_panel',  name: 'Wall Panel',   color: '#E8A090' },
  { id: 'plaster',     name: 'Plaster',      color: '#C4A8D0' },
  { id: 'wood_panel',  name: 'Wood Panel',   color: '#C8A870' },
];

/** Wall demolition material IDs that support wall material sub-types */
export const WALL_MATERIAL_IDS = new Set([
  'wall_drywall',
  'wall_drywall_2ft',
  'wall_drywall_4ft',
]);

// ============================================================================
// Trim / Door / Stair Size Sub-type Configuration
// ============================================================================

/** Size sub-type for trim demo, door demo items */
export type TrimSizeSubType =
  | 'small'
  | 'medium'
  | 'large'
  | 'x_large';

/** Configuration for a trim/door size sub-type */
export interface TrimSizeSubTypeConfig {
  id: TrimSizeSubType;
  name: string;
  /** Description hint shown in the selector */
  description: string;
}

/**
 * Available size sub-types for window trim, door trim, and door demo.
 * Used in sketch UI, scope generation, and PDF reporting.
 */
export const TRIM_SIZE_SUB_TYPES: TrimSizeSubTypeConfig[] = [
  { id: 'small',   name: 'Small',   description: '24-30"' },
  { id: 'medium',  name: 'Medium',  description: '36-48"' },
  { id: 'large',   name: 'Large',   description: '60-72"' },
  { id: 'x_large', name: 'X-Large', description: '96"+' },
];

/** Trim removal extent */
export type TrimRemovalExtent = 'full' | 'half' | 'quarter' | 'custom';

/**
 * Standard trim perimeter in LF by size sub-type.
 * Window trim: 4 sides (2*W + 2*H). Door trim: 3 sides (2*H + W), no bottom.
 * Based on standard US residential sizes.
 */
export const TRIM_LF_BY_SIZE: Record<string, Record<string, number>> = {
  window_trim_demo: {
    '':       9,    // default ~24"x30" window
    small:    9,    // 24"x30" → 2*(24+30)/12 = 9 LF
    medium:   14,   // 36"x48" → 2*(36+48)/12 = 14 LF
    large:    20,   // 60"x60" → 2*(60+60)/12 = 20 LF
    x_large:  26,   // 96"x60" → 2*(96+60)/12 = 26 LF
  },
  door_trim_demo: {
    '':       16,   // default ~32"x80" door
    small:    16,   // 28"x80" → (2*80+28)/12 ≈ 16 LF
    medium:   16,   // 36"x80" → (2*80+36)/12 ≈ 16 LF
    large:    18,   // 60"x80" → (2*80+60)/12 ≈ 18 LF
    x_large:  22,   // 96"x84" → (2*84+96)/12 ≈ 22 LF
  },
};

/** Calculate trim LF based on size, removal extent, and optional custom value */
export function calcTrimLF(
  materialType: string,
  subType: string | undefined,
  removalExtent: TrimRemovalExtent | string = 'full',
  customLF?: number,
): number {
  if (removalExtent === 'custom' && customLF != null && customLF > 0) {
    return customLF;
  }
  const sizeLookup = TRIM_LF_BY_SIZE[materialType];
  if (!sizeLookup) return 0;
  const fullLF = sizeLookup[subType || ''] ?? sizeLookup[''] ?? 0;
  if (removalExtent === 'half') return Math.round(fullLF / 2 * 10) / 10;
  if (removalExtent === 'quarter') return Math.round(fullLF / 4 * 10) / 10;
  return fullLF;
}

/** Material IDs that support trim size sub-types */
export const TRIM_SIZE_MATERIAL_IDS = new Set([
  'window_trim_demo',
  'door_trim_demo',
  'door_demo',
]);

/** Material IDs that support trim removal extent (partial removal) */
export const TRIM_REMOVAL_MATERIAL_IDS = new Set([
  'window_trim_demo',
  'door_trim_demo',
]);

/** All EA-unit demolition material IDs (click-to-place, not drag-to-draw) */
export const EA_MATERIAL_IDS = new Set([
  'window_trim_demo',
  'door_trim_demo',
  'door_demo',
  'stair_demo',
]);

/**
 * Canvas pixel dimensions for EA demolition items by size sub-type.
 * Used for click-to-place rendering — size changes with sub-type selection.
 */
export const EA_ITEM_PIXEL_SIZES: Record<string, Record<string, { w: number; h: number }>> = {
  window_trim_demo: {
    '':       { w: 30, h: 30 },
    small:    { w: 28, h: 28 },
    medium:   { w: 36, h: 36 },
    large:    { w: 44, h: 44 },
    x_large:  { w: 54, h: 54 },
  },
  door_trim_demo: {
    '':       { w: 30, h: 30 },
    small:    { w: 28, h: 28 },
    medium:   { w: 36, h: 36 },
    large:    { w: 44, h: 44 },
    x_large:  { w: 54, h: 54 },
  },
  door_demo: {
    '':       { w: 36, h: 36 },
    small:    { w: 32, h: 32 },
    medium:   { w: 40, h: 40 },
    large:    { w: 48, h: 48 },
    x_large:  { w: 58, h: 58 },
  },
  stair_demo: {
    '':       { w: 40, h: 40 },
  },
};

// ============================================================================
// Material Type Configuration
// ============================================================================

/** How a demolition element is visually rendered on the canvas */
export type DemoRenderMode = 'area' | 'line' | 'shape' | 'text';

/** Border / stroke style for demolition zone rendering */
export type DemoStrokeStyle = 'solid' | 'dashed' | 'dotted';

/**
 * Defines a demolition material type that can be drawn on the sketch canvas.
 * Users can add custom types; a set of defaults is provided below.
 */
export interface DemoMaterialType {
  id: string;
  /** Human-readable name, e.g. "Wood Floor", "Carpet", "Tile" */
  name: string;
  /** Which building surface this material belongs to */
  surface: DemoSurface;
  /** Hex color string used when rendering zones of this type */
  color: string;
  /** Unit of measure: SF for area-based, LF for linear (e.g. baseboard), EA for each (e.g. door, trim) */
  unit: 'SF' | 'LF' | 'EA';
  /** How this material is rendered on the canvas (area=rectangle, line=stroke, shape=icon, text=label) */
  render_mode?: DemoRenderMode;
  /** Stroke / border style when rendering on canvas and PDF */
  stroke_style?: DemoStrokeStyle;
  /** Fill opacity 0–1 for area rendering (default 0.22) */
  fill_opacity?: number;
  /** Default line item ID to auto-link when generating scope from sketch */
  default_line_item_id?: string;
  /** Human-readable description of the linked line item (cached for display) */
  default_line_item_description?: string;
}

/**
 * Derive the effective render mode for a material type.
 * If render_mode is explicitly set, use it; otherwise infer from unit/surface.
 */
export function getEffectiveRenderMode(mat: DemoMaterialType): DemoRenderMode {
  if (mat.render_mode) return mat.render_mode;
  if (mat.unit === 'EA') return 'shape';
  if (mat.unit === 'LF') return 'line';
  if (mat.surface === 'wall' && mat.unit === 'SF') return 'line';
  return 'area';
}

/**
 * Default set of demolition material types shipped with the application.
 * Components should import this constant and merge with any user-defined types.
 */
export const DEFAULT_DEMO_MATERIAL_TYPES: DemoMaterialType[] = [
  { id: 'wood_floor',             name: 'Wood Floor',                surface: 'floor',   color: '#B8860B', unit: 'SF' },
  { id: 'carpet',                 name: 'Carpet',                    surface: 'floor',   color: '#90EE90', unit: 'SF' },
  { id: 'tile',                   name: 'Tile',                      surface: 'floor',   color: '#ADD8E6', unit: 'SF' },
  { id: 'ceiling',                name: 'Ceiling',                   surface: 'ceiling', color: '#228B22', unit: 'SF' },
  { id: 'wall_drywall',           name: 'Wall/Drywall',              surface: 'wall',    color: '#FFB6C1', unit: 'SF' },
  { id: 'wall_drywall_2ft',       name: 'Wall - Drywall 2ft',        surface: 'wall',    color: '#DB7093', unit: 'SF' },
  { id: 'wall_drywall_4ft',       name: 'Wall - Drywall 4ft',        surface: 'wall',    color: '#C71585', unit: 'SF' },
  { id: 'insulation',             name: 'Insulation',                surface: 'wall',    color: '#E91E63', unit: 'SF' },
  { id: 'baseboard',              name: 'Baseboard',                 surface: 'wall',    color: '#DEB887', unit: 'LF' },
  { id: 'baseboard_quarter_round',name: 'Baseboard+Quarter Round',   surface: 'wall',    color: '#D2B48C', unit: 'LF' },
  { id: 'quarter_round',          name: 'Quarter Round',             surface: 'wall',    color: '#C4A882', unit: 'LF' },
  { id: 'toe_kick',               name: 'Toe Kick',                  surface: 'wall',    color: '#A0522D', unit: 'LF' },
  { id: 'window_trim_demo',       name: 'Window Trim Demo',          surface: 'wall',    color: '#5B9BD5', unit: 'EA' },
  { id: 'door_trim_demo',         name: 'Door Trim Demo',            surface: 'wall',    color: '#E07C4F', unit: 'EA' },
  { id: 'door_demo',              name: 'Door Demo',                 surface: 'wall',    color: '#8B4513', unit: 'EA' },
  { id: 'stair_demo',             name: 'Stair Tread Demo',          surface: 'floor',   color: '#9B7653', unit: 'EA' },
];

// ============================================================================
// Equipment Configuration
// ============================================================================

/** Per-equipment-type static configuration (name, icon, color, abbreviation) */
export interface EquipmentConfig {
  name: string;
  shape: EquipmentIconShape;
  /** Hex color used for the icon fill */
  color: string;
  /** Short label rendered inside the icon (e.g. "AM", "AS", "DH") */
  abbreviation: string;
}

/**
 * Lookup table for equipment rendering configuration, keyed by EquipmentType.
 * Import this constant wherever equipment icons need to be rendered.
 */
export const EQUIPMENT_CONFIG: Record<EquipmentType, EquipmentConfig> = {
  air_mover:    { name: 'Air Mover',    shape: 'circle',   color: '#4169E1', abbreviation: 'AM' },
  air_scrubber: { name: 'Air Scrubber', shape: 'triangle', color: '#191970', abbreviation: 'AS' },
  dehumidifier: { name: 'Dehumidifier', shape: 'cylinder', color: '#228B22', abbreviation: 'DH' },
};

// ============================================================================
// Overlay Element Interfaces
// ============================================================================

/**
 * A rectangular demolition zone drawn on the canvas.
 * Both dimensions are stored in decimal feet so calculations are straightforward
 * (e.g. 3'4" is stored as 3.333..., or a direct 3.7 input stays 3.7).
 *
 * For floor/ceiling zones created via canvas drag, dimension1_ft and
 * dimension2_ft start at 0 (user must enter real measurements in the sidebar).
 * pixel_width / pixel_height hold the drag size for visual rendering until
 * real dimensions are provided.
 *
 * Wall/baseboard zones (surface === 'wall' or unit === 'LF') are list-only —
 * they are not drawn on the 2D canvas.
 */
export interface WMDemolitionZone {
  id: string;
  /** The floor sketch this zone belongs to */
  floor_sketch_id: string;
  /** References DemoMaterialType.id */
  material_type: string;
  /** Sub-type within a material (e.g. 'hardwood' | 'engineered' | 'laminate' | 'lvp' for wood_floor) */
  sub_type?: string;
  surface: DemoSurface;
  /** Hex color (copied from material type at creation, can be overridden) */
  color: string;
  /** Canvas X position in pixels */
  x: number;
  /** Canvas Y position in pixels */
  y: number;
  /** First dimension in decimal feet — 0 means "not yet entered by user" */
  dimension1_ft: number;
  /** Second dimension in decimal feet — 0 means "not yet entered by user" */
  dimension2_ft: number;
  /** Rotation angle in degrees */
  rotation: number;
  /** Computed area (dimension1_ft * dimension2_ft for SF, or length for LF) */
  calculated_sqft: number;
  /** Wall height in feet — used for wall SF calculation (length * height) */
  height_ft?: number;
  /** When true, carpet pad is included with this carpet demolition zone */
  include_pad?: boolean;
  /** When true, insulation demo is included with this wall/ceiling zone */
  include_insulation?: boolean;
  /** Baseboard/trim type included along this wall drywall zone (undefined = none) */
  baseboard_type?: 'baseboard' | 'quarter_round' | 'baseboard_quarter_round';
  /** When true, floor is glued down to substrate — adds extra removal cost */
  glue_down?: boolean;
  /** Trim removal extent: full (all sides), half, quarter, or custom LF */
  trim_removal?: TrimRemovalExtent;
  /** Custom trim length in LF (used when trim_removal === 'custom') */
  trim_lf?: number;
  label?: string;
  /** Controls stacking / display order in the summary list */
  display_order: number;
  /** Optional link to an existing scope item for quantity sync */
  scope_item_id?: string;
  /** How this zone is rendered — copied from material type at creation, can be overridden */
  render_mode?: DemoRenderMode;
  /** Stroke / border style — copied from material type at creation */
  stroke_style?: DemoStrokeStyle;
  /** Fill opacity 0–1 — copied from material type at creation */
  fill_opacity?: number;
  /**
   * Raw canvas pixel width from initial drag — used for visual rendering
   * when dimension1_ft is still 0. Not persisted to the database.
   */
  pixel_width?: number;
  /**
   * Raw canvas pixel height from initial drag — used for visual rendering
   * when dimension2_ft is still 0. Not persisted to the database.
   */
  pixel_height?: number;
  /**
   * Polygon vertices in canvas pixel coordinates (relative to zone x,y origin).
   * When present, the zone is rendered as a closed polygon instead of a rectangle.
   * Used for irregular ceiling/floor demolition areas that follow wall contours.
   */
  polygon_points?: { x: number; y: number }[];
  /**
   * Snapshot of original zones before combining (area/polygon combine only).
   * Present only on a combined (grouped) zone. Used to restore individual zones on Ungroup.
   */
  combined_from?: WMDemolitionZone[];
  /**
   * Group ID for logically linked zones (LF/line combine).
   * Zones sharing the same group_id are displayed as a group in the sidebar
   * but remain as individual elements on the canvas.
   */
  group_id?: string;
}

/** A piece of drying equipment placed at a specific canvas position */
export interface WMEquipmentPlacement {
  id: string;
  floor_sketch_id: string;
  equipment_type: EquipmentType;
  /** Canvas X position in pixels */
  x: number;
  /** Canvas Y position in pixels */
  y: number;
  icon_shape: EquipmentIconShape;
  /** Hex color (inherited from EQUIPMENT_CONFIG, can be overridden) */
  color: string;
  /** Optional custom label shown beneath the icon */
  label?: string;
}

/**
 * A containment barrier (poly sheeting) drawn on the canvas as a line.
 * Represents a wall-like barrier on the floor plan.
 * length_ft is the span on the floor plan, height_ft is the poly height
 * (typically ceiling height ~8ft). sqft = length_ft * height_ft.
 */
export interface WMContainmentZone {
  id: string;
  floor_sketch_id: string;
  /** E.g. "No zipper", "With zipper" */
  containment_type: string;
  x: number;
  y: number;
  /** Length of the containment barrier on the floor plan in feet */
  length_ft: number;
  /** Height of the poly sheeting in feet (default 8, ceiling height) */
  height_ft: number;
  /** Rotation angle in degrees */
  rotation: number;
  /** Computed square footage: length_ft * height_ft */
  calculated_sqft: number;
  color: string;
  label?: string;
  /** Number of zippers attached to this containment barrier (EA) */
  zipper_count: number;
  /** @deprecated Legacy field — use length_ft instead */
  width_ft?: number;
}

/**
 * A strip of floor protection material drawn along a path on the canvas.
 * Square footage is paper_width_ft * length_ft.
 */
export interface WMFloorProtection {
  id: string;
  floor_sketch_id: string;
  /** E.g. "Heavy duty paper & tape" */
  protection_type: string;
  /** Width of the protection material roll in feet (default 3.0) */
  paper_width_ft: number;
  x: number;
  y: number;
  /** Length of the protection strip in feet */
  length_ft: number;
  /** Rotation angle in degrees */
  rotation: number;
  /** Computed: paper_width_ft * length_ft */
  calculated_sqft: number;
  color: string;
}

/**
 * A content protection area drawn on the canvas as a rectangle.
 * Used when contents are covered with vinyl/plastic sheeting for protection.
 * Square footage is width_ft * length_ft.
 */
export interface WMContentProtection {
  id: string;
  floor_sketch_id: string;
  /** E.g. "Plastic sheeting", "Moving blanket" */
  protection_type: string;
  x: number;
  y: number;
  /** Width of the covered area in feet */
  width_ft: number;
  /** Length of the covered area in feet */
  length_ft: number;
  /** Rotation angle in degrees */
  rotation: number;
  /** Computed: width_ft * length_ft */
  calculated_sqft: number;
  color: string;
}

/** Content manipulation type — describes how contents were moved */
export type ContentManipulationType =
  | 'move_out'
  | 'move_within'
  | 'move_back';

/**
 * A content manipulation area drawn on the canvas as a rectangle.
 * Used when room contents (furniture, belongings) need to be moved
 * before demolition or equipment setup can proceed.
 * Measured in HR (hours) — "Move back" is excluded from scope billing.
 */
export interface WMContentManipulation {
  id: string;
  floor_sketch_id: string;
  /** "Move out" | "Move within room" | "Move back" */
  manipulation_type: string;
  x: number;
  y: number;
  /** Width of the affected area in feet (canvas visual only) */
  width_ft: number;
  /** Length of the affected area in feet (canvas visual only) */
  length_ft: number;
  /** Rotation angle in degrees */
  rotation: number;
  /** Labor hours for this manipulation (billed; "Move back" excluded from scope) */
  hours: number;
  color: string;
}

/**
 * A free-form text annotation placed on the canvas.
 * Used for notes, labels, room names, or any descriptive text.
 */
export interface WMTextAnnotation {
  id: string;
  floor_sketch_id: string;
  /** Canvas X position in pixels */
  x: number;
  /** Canvas Y position in pixels */
  y: number;
  /** The text content */
  text: string;
  /** Font size in pixels (default 16) */
  font_size: number;
  /** Hex color string (default #333333) */
  color: string;
  /** Bold text */
  bold: boolean;
}

// ============================================================================
// Shape Annotations (rectangle / circle for doors, cabinets, fixtures, etc.)
// ============================================================================

/**
 * Preset configuration for a commonly-used shape (door, cabinet, toilet, etc.)
 */
export interface ShapePreset {
  id: string;
  /** Display name, e.g. "Door", "Cabinet" */
  name: string;
  shape_type: SketchShapeType;
  /** Default width in canvas pixels (fallback when no scale calibration) */
  default_width: number;
  /** Default height in canvas pixels (fallback when no scale calibration) */
  default_height: number;
  /** Real-world width in feet (used with scale_pixels_per_foot for accurate sizing) */
  real_width_ft: number;
  /** Real-world height/depth in feet */
  real_height_ft: number;
  /** Default fill color */
  fill_color: string;
  /** Default stroke color */
  stroke_color: string;
  /** Short label displayed inside the shape */
  abbreviation: string;
}

/** Built-in shape presets for common floor plan elements.
 *  real_width_ft / real_height_ft are standard fixture dimensions in feet.
 *  On placement, pixel size = real_ft × scale_pixels_per_foot.
 *  default_width / default_height are fallbacks when scale is not calibrated (20 px/ft default).
 */
export const SHAPE_PRESETS: ShapePreset[] = [
  { id: 'door',       name: 'Door',       shape_type: 'rectangle', default_width: 60, default_height: 60, real_width_ft: 3,    real_height_ft: 3,    fill_color: 'transparent', stroke_color: '#6B3410', abbreviation: '' },
  { id: 'cabinet',    name: 'Cabinet',    shape_type: 'rectangle', default_width: 60, default_height: 30, real_width_ft: 5,    real_height_ft: 2,    fill_color: '#D2B48C', stroke_color: '#8B7355', abbreviation: 'CAB' },
  { id: 'vanity',     name: 'Vanity',     shape_type: 'rectangle', default_width: 48, default_height: 24, real_width_ft: 4,    real_height_ft: 1.75, fill_color: '#C4A882', stroke_color: '#8B7355', abbreviation: 'VAN' },
  { id: 'tub',        name: 'Tub/Shower', shape_type: 'rectangle', default_width: 60, default_height: 36, real_width_ft: 5,    real_height_ft: 2.5,  fill_color: '#87CEEB', stroke_color: '#4682B4', abbreviation: 'TUB' },
  { id: 'toilet',     name: 'Toilet',     shape_type: 'circle',    default_width: 24, default_height: 24, real_width_ft: 1.5,  real_height_ft: 2.25, fill_color: '#F0F0F0', stroke_color: '#999999', abbreviation: 'WC' },
  { id: 'sink',       name: 'Sink',       shape_type: 'circle',    default_width: 20, default_height: 20, real_width_ft: 1.33, real_height_ft: 1.33, fill_color: '#E0E8F0', stroke_color: '#7799BB', abbreviation: 'SK' },
  { id: 'appliance',  name: 'Appliance',  shape_type: 'rectangle', default_width: 36, default_height: 30, real_width_ft: 2.5,  real_height_ft: 2.5,  fill_color: '#C0C0C0', stroke_color: '#808080', abbreviation: 'APL' },
  { id: 'stairs',     name: 'Stairs',     shape_type: 'rectangle', default_width: 40, default_height: 80, real_width_ft: 3,    real_height_ft: 7,    fill_color: '#DDD5C0', stroke_color: '#A09070', abbreviation: 'STR' },
  { id: 'window',     name: 'Window',     shape_type: 'rectangle', default_width: 36, default_height: 6,  real_width_ft: 3,    real_height_ft: 0.4,  fill_color: '#B0D4F1', stroke_color: '#4A90D9', abbreviation: 'WIN' },
  { id: 'custom_rect',name: 'Rectangle',  shape_type: 'rectangle', default_width: 50, default_height: 50, real_width_ft: 3,    real_height_ft: 3,    fill_color: '#E8E8E8', stroke_color: '#666666', abbreviation: '' },
  { id: 'custom_circle',name: 'Circle',   shape_type: 'circle',    default_width: 40, default_height: 40, real_width_ft: 2,    real_height_ft: 2,    fill_color: '#E8E8E8', stroke_color: '#666666', abbreviation: '' },
];

/**
 * A shape annotation (rectangle or circle) placed on the canvas.
 * Used for doors, cabinets, fixtures, and other symbolic floor plan elements.
 */
export interface WMShapeAnnotation {
  id: string;
  floor_sketch_id: string;
  /** Which preset was used (references ShapePreset.id, or 'custom_rect'/'custom_circle') */
  preset_id: string;
  shape_type: SketchShapeType;
  /** Canvas X position in pixels (top-left for rect, center for circle) */
  x: number;
  /** Canvas Y position in pixels */
  y: number;
  /** Width in canvas pixels */
  width: number;
  /** Height in canvas pixels */
  height: number;
  /** Rotation angle in degrees */
  rotation: number;
  /** Fill color */
  fill_color: string;
  /** Stroke/border color */
  stroke_color: string;
  /** Stroke width in pixels (default 2) */
  stroke_width: number;
  /** Fill opacity 0-1 (default 0.7) */
  opacity: number;
  /** Short label inside the shape (e.g. "DR", "CAB") */
  label: string;
  /** Horizontal flip (mirrors the shape, e.g. door hinge side) */
  flip_x?: boolean;
}

// ============================================================================
// Floor Plan Elements (walls & rooms)
// ============================================================================

/** A wall segment drawn on the canvas as a line between two endpoints */
export interface WMWall {
  id: string;
  floor_sketch_id: string;
  /** Start point X in canvas pixels */
  start_x: number;
  /** Start point Y in canvas pixels */
  start_y: number;
  /** End point X in canvas pixels */
  end_x: number;
  /** End point Y in canvas pixels */
  end_y: number;
  /** Visual stroke width in pixels */
  thickness: number;
  color: string;
  /** Calculated length in decimal feet */
  length_ft: number;
}

/** A room polygon detected or drawn on the floor plan */
export interface WMRoom {
  id: string;
  floor_sketch_id: string;
  /** Display name (e.g. "Living Room", "Room 1") */
  name: string;
  /** Boundary polygon vertices in canvas pixel coordinates */
  boundary: { x: number; y: number }[];
  /** Fill color with transparency */
  color: string;
  /** Room height in feet (default 8) — used for wall area calculation */
  height_ft: number;
  /** Calculated floor area in square feet */
  area_sqft: number;
  /** IDs of walls that form this room's boundary */
  wall_ids: string[];
}

/** Snap threshold in canvas pixels for wall endpoint snapping */
export const WALL_SNAP_THRESHOLD = 15;
/** Default wall visual thickness */
export const DEFAULT_WALL_THICKNESS = 4;
/** Default wall color */
export const DEFAULT_WALL_COLOR = '#333333';
/** Default room fill color */
export const DEFAULT_ROOM_COLOR = 'rgba(173, 216, 230, 0.3)';

// ============================================================================
// Overlay Data (aggregates all element types for one floor)
// ============================================================================

/**
 * All canvas overlay elements for a single floor sketch.
 * This is the payload used for bulk save / load operations.
 */
export interface WMOverlayData {
  demolition_zones: WMDemolitionZone[];
  equipment_placements: WMEquipmentPlacement[];
  containment_zones: WMContainmentZone[];
  floor_protections: WMFloorProtection[];
  content_protections: WMContentProtection[];
  content_manipulations: WMContentManipulation[];
  text_annotations: WMTextAnnotation[];
  /** Shape annotations — doors, cabinets, fixtures, etc. (optional — absent in legacy data) */
  shapes?: WMShapeAnnotation[];
  /** Floor plan walls (optional — absent in legacy data) */
  walls?: WMWall[];
  /** Floor plan rooms detected from walls (optional — absent in legacy data) */
  rooms?: WMRoom[];
  /**
   * Z-order of overlay elements (element IDs, bottom → top).
   * Elements not listed here are rendered in default type-based order.
   * Absent in legacy data — built lazily on first z-order change.
   */
  element_order?: string[];
}

/** Convenience constant for initialising a new, empty overlay */
export const EMPTY_OVERLAY_DATA: WMOverlayData = {
  demolition_zones: [],
  equipment_placements: [],
  containment_zones: [],
  floor_protections: [],
  content_protections: [],
  content_manipulations: [],
  text_annotations: [],
  shapes: [],
  walls: [],
  rooms: [],
};

// ============================================================================
// Floor Sketch
// ============================================================================

/**
 * A single-floor canvas within a WM job.
 * May use either a linked sketch document (source_type: 'sketch') or a raw
 * background image (source_type: 'image') as the floor plan base.
 */
export interface WMFloorSketch {
  id: string;
  job_id: string;
  /** E.g. "1st Floor", "Basement", "2nd Floor" */
  floor_label: string;
  /** Controls tab / list ordering (0-based) */
  floor_order: number;
  /** Display string for the property address on exported views */
  address_display: string;
  source_type: FloorPlanSourceType;
  /** Present when source_type === 'sketch' */
  sketch_id?: string;
  /** Present when source_type === 'image' */
  background_image_url?: string;
  /** Canvas width in pixels */
  canvas_width: number;
  /** Canvas height in pixels */
  canvas_height: number;
  /** Rendering scale: how many canvas pixels equal one real-world foot */
  scale_pixels_per_foot: number;
  notes?: string;
  overlay_data: WMOverlayData;
  created_at: string;
  updated_at?: string;
}

// ============================================================================
// Create / Update DTOs
// ============================================================================

/** Payload for creating a new floor sketch under a job */
export interface WMFloorSketchCreate {
  floor_label: string;
  floor_order: number;
  address_display: string;
  source_type: FloorPlanSourceType;
  /** Defaults to 1200 when omitted */
  canvas_width?: number;
  /** Defaults to 900 when omitted */
  canvas_height?: number;
  /** Defaults to a project-standard value when omitted */
  scale_pixels_per_foot?: number;
  notes?: string;
}

/** Partial update payload — all fields are optional */
export interface WMFloorSketchUpdate {
  floor_label?: string;
  floor_order?: number;
  address_display?: string;
  source_type?: FloorPlanSourceType;
  canvas_width?: number;
  canvas_height?: number;
  scale_pixels_per_foot?: number;
  notes?: string;
}

// ============================================================================
// Summary / Aggregation Types
// ============================================================================

/** Aggregated demolition totals for a single material type on one floor */
export interface MaterialTypeSummary {
  material_type: string;
  material_name: string;
  surface: DemoSurface;
  color: string;
  /** Count of demolition zones of this material type */
  count: number;
  /** Total computed area/length/count across all zones of this type */
  total_sqft: number;
  unit: 'SF' | 'LF' | 'EA';
}

/** Complete per-floor summary consumed by reporting and scope-sync features */
export interface WMFloorSummary {
  demolition_by_type: MaterialTypeSummary[];
  containment: {
    count: number;
    total_sqft: number;
  };
  floor_protection: {
    count: number;
    total_sqft: number;
  };
  content_protection: {
    count: number;
    total_sqft: number;
  };
  content_manipulation: {
    count: number;
    total_hours: number;
  };
  /** Count of each equipment type placed on this floor */
  equipment_counts: Record<EquipmentType, number>;
}

// ============================================================================
// Canvas State Types
// ============================================================================

/**
 * Represents a single selected overlay element on the canvas.
 * Used by the selection / properties panel to know which element to edit.
 */
export interface WMSketchSelection {
  element_id: string;
  element_type: 'demolition' | 'equipment' | 'containment' | 'floor_protection' | 'content_protection' | 'content_manipulation' | 'text' | 'shape' | 'wall' | 'room';
}
