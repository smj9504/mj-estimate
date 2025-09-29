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

export interface Wall {
  id: string;
  /** Start point of wall */
  start: Point;
  /** End point of wall */
  end: Point;
  /** Wall thickness in inches (default: 4) */
  thickness: number;
  /** Wall height in feet */
  height: Measurement;
  /** Length calculated from start/end points */
  length: Measurement;
  /** Wall type for styling/behavior */
  type: 'exterior' | 'interior' | 'load_bearing';
  /** Associated fixtures on this wall */
  fixtures: WallFixture[];
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

export type FixtureType = 'door' | 'window' | 'cabinet' | 'vanity' | 'appliance' | 'electrical' | 'plumbing';

export interface WallFixture {
  id: string;
  type: FixtureType;
  /** Position along the wall (0-1, where 0 is start, 1 is end) */
  position: number;
  /** Fixture dimensions */
  dimensions: Dimensions;
  /** Fixture-specific properties */
  properties: FixtureProperties;
  /** Visual representation */
  style: FixtureStyle;
  /** Whether fixture creates an opening in the wall */
  isOpening: boolean;
  /** Opening dimensions if different from fixture dimensions */
  openingDimensions?: Dimensions;
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
    fixtures: Record<FixtureType, FixtureStyle>;
  };
}

// =====================
// Interaction System
// =====================

export type SketchTool = 'select' | 'wall' | 'room' | 'fixture' | 'measure' | 'pan' | 'zoom';

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