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
  | 'equipment'
  | 'containment'
  | 'floor_protection'
  | 'content_protection'
  | 'text'
  | 'shape'
  | 'pan'
  | 'wall'
  | 'room'
  | 'wall_split';

/** Shape types available for annotation shapes */
export type SketchShapeType = 'rectangle' | 'circle';

// ============================================================================
// Material Type Configuration
// ============================================================================

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
  /** Unit of measure: SF for area-based, LF for linear (e.g. baseboard) */
  unit: 'SF' | 'LF';
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
  { id: 'toe_kick',               name: 'Toe Kick',                  surface: 'wall',    color: '#A0522D', unit: 'LF' },
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
  label?: string;
  /** Controls stacking / display order in the summary list */
  display_order: number;
  /** Optional link to an existing scope item for quantity sync */
  scope_item_id?: string;
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
  /** Default width in canvas pixels */
  default_width: number;
  /** Default height in canvas pixels */
  default_height: number;
  /** Default fill color */
  fill_color: string;
  /** Default stroke color */
  stroke_color: string;
  /** Short label displayed inside the shape */
  abbreviation: string;
}

/** Built-in shape presets for common floor plan elements */
export const SHAPE_PRESETS: ShapePreset[] = [
  { id: 'door',       name: 'Door',       shape_type: 'rectangle', default_width: 36, default_height: 8,  fill_color: '#A0522D', stroke_color: '#6B3410', abbreviation: 'DR' },
  { id: 'cabinet',    name: 'Cabinet',    shape_type: 'rectangle', default_width: 60, default_height: 30, fill_color: '#D2B48C', stroke_color: '#8B7355', abbreviation: 'CAB' },
  { id: 'vanity',     name: 'Vanity',     shape_type: 'rectangle', default_width: 48, default_height: 24, fill_color: '#C4A882', stroke_color: '#8B7355', abbreviation: 'VAN' },
  { id: 'tub',        name: 'Tub/Shower', shape_type: 'rectangle', default_width: 60, default_height: 36, fill_color: '#87CEEB', stroke_color: '#4682B4', abbreviation: 'TUB' },
  { id: 'toilet',     name: 'Toilet',     shape_type: 'circle',    default_width: 24, default_height: 24, fill_color: '#F0F0F0', stroke_color: '#999999', abbreviation: 'WC' },
  { id: 'sink',       name: 'Sink',       shape_type: 'circle',    default_width: 20, default_height: 20, fill_color: '#E0E8F0', stroke_color: '#7799BB', abbreviation: 'SK' },
  { id: 'appliance',  name: 'Appliance',  shape_type: 'rectangle', default_width: 36, default_height: 30, fill_color: '#C0C0C0', stroke_color: '#808080', abbreviation: 'APL' },
  { id: 'stairs',     name: 'Stairs',     shape_type: 'rectangle', default_width: 40, default_height: 80, fill_color: '#DDD5C0', stroke_color: '#A09070', abbreviation: 'STR' },
  { id: 'window',     name: 'Window',     shape_type: 'rectangle', default_width: 36, default_height: 6,  fill_color: '#B0D4F1', stroke_color: '#4A90D9', abbreviation: 'WIN' },
  { id: 'custom_rect',name: 'Rectangle',  shape_type: 'rectangle', default_width: 50, default_height: 50, fill_color: '#E8E8E8', stroke_color: '#666666', abbreviation: '' },
  { id: 'custom_circle',name: 'Circle',   shape_type: 'circle',    default_width: 40, default_height: 40, fill_color: '#E8E8E8', stroke_color: '#666666', abbreviation: '' },
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
  text_annotations: WMTextAnnotation[];
  /** Shape annotations — doors, cabinets, fixtures, etc. (optional — absent in legacy data) */
  shapes?: WMShapeAnnotation[];
  /** Floor plan walls (optional — absent in legacy data) */
  walls?: WMWall[];
  /** Floor plan rooms detected from walls (optional — absent in legacy data) */
  rooms?: WMRoom[];
}

/** Convenience constant for initialising a new, empty overlay */
export const EMPTY_OVERLAY_DATA: WMOverlayData = {
  demolition_zones: [],
  equipment_placements: [],
  containment_zones: [],
  floor_protections: [],
  content_protections: [],
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
  /** Total computed area/length across all zones of this type */
  total_sqft: number;
  unit: 'SF' | 'LF';
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
  element_type: 'demolition' | 'equipment' | 'containment' | 'floor_protection' | 'content_protection' | 'text' | 'shape' | 'wall' | 'room';
}
