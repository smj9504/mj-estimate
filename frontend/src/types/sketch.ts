/**
 * Interior Sketch System Data Models
 * Comprehensive TypeScript interfaces for 2D floor plan sketching
 */

// =====================
// Core Geometry Types
// =====================

export interface Point {
  x: number;
  y: number;
}

export interface Dimensions {
  width: number;
  height: number;
  /** Height of the room (optional for 3D calculations) */
  depth?: number;
}

export interface Rectangle {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface BoundingBox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

// =====================
// Measurement System
// =====================

export interface Measurement {
  /** Value in feet */
  feet: number;
  /** Additional inches (0-11) */
  inches: number;
  /** Total value in inches for calculations */
  totalInches: number;
  /** Formatted display string (e.g., "12' 6\"") */
  display: string;
}

export interface AreaCalculation {
  /** Floor area in square feet */
  floorArea: number;
  /** Ceiling area in square feet (usually same as floor) */
  ceilingArea: number;
  /** Total wall area in square feet */
  wallArea: number;
  /** Net wall area (excluding openings) in square feet */
  netWallArea: number;
  /** Room volume in cubic feet */
  volume: number;
  /** Perimeter in linear feet */
  perimeter: number;
}

// =====================
// Wall System
// =====================

export interface WallSegment {
  id: string;
  /** Start point of segment */
  start: Point;
  /** End point of segment */
  end: Point;
  /** Length of this segment */
  length: Measurement;
  /** Type of segment */
  type: 'wall' | 'fixture_gap';
  /** Fixture ID if this is a fixture gap */
  fixtureId?: string;
}

export interface Wall {
  id: string;
  /** Original start point of wall (before fixtures) */
  originalStart: Point;
  /** Original end point of wall (before fixtures) */
  originalEnd: Point;
  /** Current start point (may be adjusted by fixtures) */
  start: Point;
  /** Current end point (may be adjusted by fixtures) */
  end: Point;
  /** Wall thickness in inches (default: 4) */
  thickness: number;
  /** Wall height in feet */
  height: Measurement;
  /** Total original length (before fixtures) */
  originalLength: Measurement;
  /** Current total length (including fixtures) */
  length: Measurement;
  /** Wall segments (walls + fixture gaps) */
  segments: WallSegment[];
  /** Wall type for styling/behavior */
  type: 'exterior' | 'interior' | 'load_bearing';
  /** Associated fixtures on this wall */
  fixtures: string[]; // Changed to fixture IDs array
  /** Room ID this wall belongs to */
  roomId: string;
  /** Connected wall IDs for wall joining */
  connectedWalls: string[];
  /** Visual styling properties */
  style: WallStyle;
  /** Creation timestamp */
  createdAt: string;
  /** Last modified timestamp */
  updatedAt: string;
}

export interface WallStyle {
  strokeColor: string;
  strokeWidth: number;
  fillColor?: string;
  dashArray?: number[];
  opacity: number;
}

// =====================
// Fixture System
// =====================

export type WallFixtureCategory = 'door' | 'window';
export type RoomFixtureCategory = 'cabinet' | 'bathroom' | 'electrical' | 'plumbing';
export type FixtureCategory = WallFixtureCategory | RoomFixtureCategory;

export type DoorType =
  | 'single_door'
  | 'double_door'
  | 'sliding_door'
  | 'french_door'
  | 'pocket_door'
  | 'bi_fold_door';

export type WindowType =
  | 'single_window'
  | 'double_window'
  | 'triple_window'
  | 'bay_window'
  | 'casement_window'
  | 'sliding_window';

export type CabinetType = 'cabinet';

export type BathroomType =
  | 'vanity'
  | 'toilet'
  | 'bathtub'
  | 'shower';

export interface FixtureVariant {
  id: string;
  name: string;
  category: FixtureCategory;
  type: DoorType | WindowType | CabinetType | BathroomType | string;
  defaultDimensions: Dimensions;
  icon?: string;
  svgPath?: string; // SVG path for industry standard icons
}

export interface WallFixture {
  id: string;
  category: WallFixtureCategory;
  type: DoorType | WindowType;
  /** Absolute position along the wall in pixels from start point */
  position: number;
  /** Fixture dimensions in feet (absolute size) */
  dimensions: Dimensions;
  /** Rotation angle in degrees (0 = aligned with wall) */
  rotation: number;
  /** Wall ID this fixture belongs to */
  wallId: string;
  /** Fixture-specific properties */
  properties: FixtureProperties;
  /** Visual representation */
  style: FixtureStyle;
  /** Whether fixture creates an opening in the wall */
  isOpening: boolean;
  /** Opening dimensions if different from fixture dimensions */
  openingDimensions?: Dimensions;
  /** Creation timestamp */
  createdAt: string;
  /** Last modified timestamp */
  updatedAt: string;
}

export interface RoomFixture {
  id: string;
  category: RoomFixtureCategory;
  type: CabinetType | BathroomType | string;
  /** Custom label/name for the fixture */
  label?: string;
  /** Position in room coordinates (pixels from room origin) */
  position: Point;
  /** Fixture dimensions in feet (absolute size) */
  dimensions: Dimensions;
  /** Rotation angle in degrees (0 = aligned with room) */
  rotation: number;
  /** Room ID this fixture belongs to */
  roomId: string;
  /** Fixture-specific properties */
  properties: FixtureProperties;
  /** Visual representation */
  style: FixtureStyle;
  /** SVG path for industry standard icons */
  svgPath?: string;
  /** Creation timestamp */
  createdAt: string;
  /** Last modified timestamp */
  updatedAt: string;
}

export interface FixtureProperties {
  /** Door specific */
  swingDirection?: 'in' | 'out';
  swingAngle?: number;
  handleSide?: 'left' | 'right';

  /** Window specific */
  sillHeight?: Measurement;
  headerHeight?: Measurement;

  /** Cabinet specific */
  cabinetType?: 'upper' | 'lower' | 'tall';
  doorCount?: number;

  /** Custom properties for extensibility */
  [key: string]: any;
}

export interface FixtureStyle {
  fillColor: string;
  strokeColor: string;
  strokeWidth: number;
  opacity: number;
  /** SVG path or icon identifier */
  icon?: string;
}

// =====================
// Room System
// =====================

export interface SketchRoom {
  id: string;
  name: string;
  /** Room type for categorization */
  type: RoomType;
  /** Wall IDs that form this room */
  wallIds: string[];
  /** Room boundary points (calculated from walls) */
  boundary: Point[];
  /** Interior holes (walls that create interior spaces) */
  holes?: Point[][];
  /** Room dimensions */
  dimensions: Dimensions;
  /** Room area calculations */
  areas: AreaCalculation;
  /** Room-specific properties */
  properties: RoomProperties;
  /** Visual styling */
  style: RoomStyle;
  /** Creation timestamp */
  createdAt: string;
  /** Last modified timestamp */
  updatedAt: string;
}

export type RoomType =
  | 'living_room'
  | 'bedroom'
  | 'kitchen'
  | 'bathroom'
  | 'dining_room'
  | 'office'
  | 'hallway'
  | 'closet'
  | 'utility'
  | 'garage'
  | 'basement'
  | 'attic'
  | 'other';

export interface RoomProperties {
  /** Floor material */
  floorMaterial?: string;
  /** Ceiling height (if different from walls) */
  ceilingHeight?: Measurement;
  /** Room notes */
  notes?: string;
  /** Custom properties */
  [key: string]: any;
}

export interface RoomStyle {
  fillColor: string;
  strokeColor: string;
  strokeWidth: number;
  opacity: number;
  /** Pattern fill for floor representation */
  pattern?: string;
}

// =====================
// Sketch Document
// =====================

export interface SketchDocument {
  id: string;
  name: string;
  /** Document type for integration with estimates/invoices */
  documentType?: 'estimate' | 'invoice' | 'work_order' | 'standalone';
  /** Associated document ID */
  documentId?: string;
  /** All rooms in this sketch */
  rooms: SketchRoom[];
  /** All walls in this sketch */
  walls: Wall[];
  /** All wall fixtures in this sketch (doors, windows) */
  wallFixtures: WallFixture[];
  /** All room fixtures in this sketch (cabinets, vanities, appliances) */
  roomFixtures: RoomFixture[];
  /** Sketch metadata */
  metadata: SketchMetadata;
  /** Sketch settings */
  settings: SketchSettings;
  /** Creation info */
  createdAt: string;
  updatedAt: string;
  createdBy?: string;
}

export interface SketchMetadata {
  /** Sketch version for compatibility */
  version: string;
  /** Project information */
  project?: {
    name: string;
    address?: string;
    client?: string;
  };
  /** Scale information */
  scale: {
    /** Pixels per foot */
    pixelsPerFoot: number;
    /** Grid size in feet */
    gridSize: number;
  };
  /** Sketch bounds */
  bounds: BoundingBox;
  /** Total calculated areas */
  totalAreas: AreaCalculation;
}

export interface SketchSettings {
  /** Display settings */
  display: {
    showGrid: boolean;
    showDimensions: boolean;
    showAreaLabels: boolean;
    showFixtures: boolean;
    snapToGrid: boolean;
    snapTolerance: number;
  };
  /** Measurement settings */
  measurements: {
    unit: 'imperial' | 'metric';
    precision: number;
    showInches: boolean;
  };
  /** Default styles */
  defaultStyles: {
    wall: WallStyle;
    room: RoomStyle;
    fixtures: Record<FixtureCategory, FixtureStyle>;
  };
}

// =====================
// Interaction System
// =====================

export type SketchTool = 'select' | 'wall' | 'room' | 'fixture' | 'measure' | 'pan' | 'zoom' | 'fixture_door' | 'fixture_window' | 'wall_split';

export type InteractionMode = 'draw' | 'edit' | 'view';

export interface SketchState {
  /** Current active tool */
  activeTool: SketchTool;
  /** Current interaction mode */
  mode: InteractionMode;
  /** Selected elements */
  selection: {
    walls: string[];
    rooms: string[];
    fixtures: string[];
  };
  /** Current fixture being placed */
  activeFixture?: {
    category: FixtureCategory;
    type: DoorType | WindowType | string;
    dimensions: Dimensions;
  };
  /** Viewport state */
  viewport: {
    center: Point;
    zoom: number;
    bounds: Rectangle;
  };
  /** Temporary drawing state */
  drawing: {
    isDrawing: boolean;
    currentWall?: Partial<Wall>;
    previewPoints: Point[];
  };
  /** History for undo/redo */
  history: {
    past: SketchDocument[];
    present: SketchDocument;
    future: SketchDocument[];
    canUndo: boolean;
    canRedo: boolean;
  };
}

// =====================
// Event System
// =====================

export interface SketchEvent {
  type: string;
  timestamp: number;
  data: any;
}

export interface WallEvent extends SketchEvent {
  type: 'wall.created' | 'wall.updated' | 'wall.deleted' | 'wall.selected';
  data: {
    wall: Wall;
    roomId?: string;
  };
}

export interface RoomEvent extends SketchEvent {
  type: 'room.created' | 'room.updated' | 'room.deleted' | 'room.selected';
  data: {
    room: SketchRoom;
    recalculated?: boolean;
  };
}

export interface FixtureEvent extends SketchEvent {
  type: 'fixture.created' | 'fixture.updated' | 'fixture.deleted' | 'fixture.moved';
  data: {
    fixture: WallFixture;
    wallId: string;
  };
}

export interface ViewportEvent extends SketchEvent {
  type: 'viewport.pan' | 'viewport.zoom' | 'viewport.fit';
  data: {
    viewport: SketchState['viewport'];
  };
}

export type SketchEventUnion = WallEvent | RoomEvent | FixtureEvent | ViewportEvent;

// =====================
// Export/Import Types
// =====================

export interface SketchExportOptions {
  format: 'json' | 'svg' | 'png' | 'pdf' | 'dxf';
  includeAreas: boolean;
  includeDimensions: boolean;
  scale?: number;
  quality?: number;
}

export interface SketchExportResult {
  data: string | Blob;
  filename: string;
  mimeType: string;
}

// =====================
// API Integration Types
// =====================

export interface SketchApiRequest {
  sketch: SketchDocument;
  options?: {
    validate?: boolean;
    calculateAreas?: boolean;
  };
}

export interface SketchApiResponse {
  success: boolean;
  sketch?: SketchDocument;
  errors?: string[];
  warnings?: string[];
}

export interface SketchValidationResult {
  isValid: boolean;
  errors: ValidationError[];
  warnings: ValidationError[];
}

export interface ValidationError {
  type: 'wall' | 'room' | 'fixture' | 'general';
  elementId?: string;
  message: string;
  severity: 'error' | 'warning' | 'info';
}

// =====================
// Template System
// =====================

export interface SketchTemplate {
  id: string;
  name: string;
  description: string;
  category: 'residential' | 'commercial' | 'custom';
  thumbnail?: string;
  template: Partial<SketchDocument>;
  isPublic: boolean;
  createdBy: string;
  createdAt: string;
}

// =====================
// Utility Types
// =====================

export interface SketchCalculationOptions {
  includeFixtures: boolean;
  wallThickness: number;
  ceilingHeight: Measurement;
  precision: number;
}

export interface SketchSnapshot {
  id: string;
  name: string;
  sketch: SketchDocument;
  thumbnail?: string;
  createdAt: string;
}