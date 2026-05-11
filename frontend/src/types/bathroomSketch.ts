/**
 * Bathroom Estimate Sketch - Type Definitions
 *
 * Dedicated types for the bathroom remodel sketch system.
 * Designed to integrate with BathroomEstimate data model
 * (shower_spec, bathtub_spec, vanity_spec, floor_spec, etc.)
 */

// =====================
// Bathroom Sketch Tools
// =====================

export type BESketchTool =
  | 'select'
  | 'wall'
  | 'room'
  | 'fixture'
  | 'measure'
  | 'tile_zone'
  | 'damage_zone';

// =====================
// Fixture Types
// =====================

export type BEFixtureType =
  | 'bathtub'
  | 'shower'
  | 'vanity'
  | 'toilet'
  | 'door'
  | 'window'
  | 'mirror'
  | 'light';

export type BathtubSubType =
  | 'standard_alcove'
  | 'corner_garden'
  | 'drop_in'
  | 'freestanding';

export type ShowerFloorType = 'tile' | 'fiberglass_pan' | 'acrylic_pan';

export type TileMaterial = 'porcelain' | 'ceramic' | 'glass' | 'natural_stone' | 'mosaic';
export type TilePattern = 'straight' | 'diagonal' | 'herringbone' | 'subway' | 'chevron' | 'basketweave';
export type TileSize = '4x4' | '6x6' | '12x12' | '12x24' | '18x18' | '24x24' | '3x6_subway' | '4x12_subway' | 'custom';

// =====================
// Geometry
// =====================

export interface BEPoint {
  x: number;
  y: number;
}

export interface BEDimensions {
  /** Width in inches */
  width: number;
  /** Height/depth in inches */
  height: number;
}

// =====================
// Wall
// =====================

export interface BEWall {
  id: string;
  start: BEPoint;
  end: BEPoint;
  /** Wall thickness in pixels */
  thickness: number;
  /** Wall height in inches (default 96 = 8ft) */
  heightInches: number;
  /** Label (e.g. "A", "B", "North") */
  label?: string;
}

// =====================
// Room
// =====================

export type BERoomType = 'bathroom' | 'closet' | 'toilet_room' | 'linen_closet' | 'other';

export interface BERoom {
  id: string;
  name: string;
  /** Room sub-type */
  roomType: BERoomType;
  /** Boundary points forming the room polygon */
  boundary: BEPoint[];
  /** Wall IDs forming this room */
  wallIds: string[];
  /** Parent room ID (if this is a sub-room inside another room) */
  parentRoomId?: string;
  /** Room height in inches */
  heightInches: number;
  /** Calculated gross floor area in SF (before sub-room deduction) */
  floorAreaSF: number;
  /** Net floor area after sub-rooms deducted */
  netFloorAreaSF: number;
  /** Calculated wall area in SF */
  wallAreaSF: number;
  /** Calculated perimeter in LF */
  perimeterLF: number;
}

// =====================
// Fixtures
// =====================

export interface BEFixture {
  id: string;
  type: BEFixtureType;
  /** Position on canvas (pixels) */
  position: BEPoint;
  /** Dimensions in inches */
  dimensions: BEDimensions;
  /** Rotation in degrees */
  rotation: number;
  /** Room this fixture belongs to */
  roomId?: string;
  /** Wall this fixture is attached to (doors/windows) */
  wallId?: string;
  /** Label */
  label?: string;
  /** Type-specific properties */
  properties: BEFixtureProperties;
}

export interface BEFixtureProperties {
  // --- Bathtub ---
  bathtubSubType?: BathtubSubType;
  /** Deck width in inches (for drop_in, corner_garden) */
  deckWidth?: number;
  /** Deck height from floor in inches */
  deckHeight?: number;
  /** Enable tile surround */
  hasSurround?: boolean;
  /** Surround height in inches above tub rim (default 60) */
  surroundHeight?: number;
  /** Number of walls with surround tile (1-3, default 3 for alcove) */
  surroundWallCount?: number;

  // --- Shower ---
  showerFloorType?: ShowerFloorType;
  /** Number of niches */
  nicheCount?: number;
  /** Has bench */
  hasBench?: boolean;
  /** Bench dimensions in inches */
  benchWidth?: number;
  benchDepth?: number;
  /** Curb height in inches (0 = curbless) */
  curbHeight?: number;
  /** Number of walls with tile (1-3) */
  showerWallCount?: number;
  /** Shower wall tile height in inches */
  showerTileHeight?: number;

  // --- Vanity ---
  vanityWidth?: number;
  sinkCount?: number;
  /** Has backsplash tile */
  hasBacksplash?: boolean;
  backsplashHeight?: number;

  // --- Door/Window ---
  swingDirection?: 'in' | 'out';
  handleSide?: 'left' | 'right';

  /** Extensible */
  [key: string]: any;
}

// =====================
// Tile Zones
// =====================

export type TileZoneType =
  | 'floor'
  | 'wall_full'
  | 'tub_surround'
  | 'tub_deck'
  | 'tub_front_panel'
  | 'shower_walls'
  | 'shower_floor'
  | 'shower_niche'
  | 'shower_bench'
  | 'vanity_backsplash';

export interface BETileZone {
  id: string;
  type: TileZoneType;
  /** Zone label */
  label: string;
  /** Zone boundary points (for rendering overlay) */
  boundary: BEPoint[];
  /** Area in SF */
  areaSF: number;
  /** Which fixture generated this zone */
  fixtureId?: string;
  /** Tile specification for this zone */
  tileSpec: BETileSpec;
  /** Zone color for overlay rendering */
  color: string;
}

export interface BETileSpec {
  material: TileMaterial;
  size: TileSize;
  pattern: TilePattern;
  /** Custom tile dimensions if size='custom' */
  customWidth?: number;
  customHeight?: number;
  /** Waste percentage (default 10) */
  wastePct: number;
  /** Material cost per SF */
  materialCostPerSF: number;
  /** Labor cost per SF */
  laborCostPerSF: number;
}

// =====================
// Damage Zones
// =====================

export interface BEDamageZone {
  id: string;
  /** Zone boundary */
  boundary: BEPoint[];
  /** Area in SF */
  areaSF: number;
  /** Damage type */
  damageType: 'water_damage' | 'mold' | 'cement_board';
  /** Label */
  label?: string;
  /** Needs demo */
  needsDemo: boolean;
  /** Needs replacement */
  needsReplace: boolean;
}

// =====================
// Sketch Document
// =====================

export interface BESketchData {
  /** Schema version */
  version: string;
  /** All walls */
  walls: BEWall[];
  /** All rooms */
  rooms: BERoom[];
  /** All fixtures */
  fixtures: BEFixture[];
  /** Auto-generated tile zones */
  tileZones: BETileZone[];
  /** Damage zones */
  damageZones: BEDamageZone[];
  /** Canvas settings */
  settings: BESketchSettings;
}

export interface BESketchSettings {
  /** Pixels per foot for coordinate conversion */
  pixelsPerFoot: number;
  /** Grid size in feet */
  gridSizeFt: number;
  /** Show grid */
  showGrid: boolean;
  /** Show dimensions on walls */
  showDimensions: boolean;
  /** Show area labels */
  showAreaLabels: boolean;
  /** Show tile zone overlays */
  showTileZones: boolean;
  /** Show damage zones */
  showDamageZones: boolean;
  /** Snap to grid */
  snapToGrid: boolean;
  /** Snap tolerance in pixels */
  snapTolerance: number;
  /** Canvas background color */
  backgroundColor: string;
}

// =====================
// Default Values
// =====================

export const DEFAULT_BE_SKETCH_SETTINGS: BESketchSettings = {
  pixelsPerFoot: 30,
  gridSizeFt: 1,
  showGrid: true,
  showDimensions: true,
  showAreaLabels: true,
  showTileZones: true,
  showDamageZones: true,
  snapToGrid: true,
  snapTolerance: 8,
  backgroundColor: '#ffffff',
};

export const EMPTY_BE_SKETCH: BESketchData = {
  version: '1.0.0',
  walls: [],
  rooms: [],
  fixtures: [],
  tileZones: [],
  damageZones: [],
  settings: { ...DEFAULT_BE_SKETCH_SETTINGS },
};

export const DEFAULT_TILE_SPEC: BETileSpec = {
  material: 'porcelain',
  size: '12x12',
  pattern: 'straight',
  wastePct: 10,
  materialCostPerSF: 4.50,
  laborCostPerSF: 8.00,
};

// Tile zone colors for overlay rendering
export const TILE_ZONE_COLORS: Record<TileZoneType, string> = {
  floor: 'rgba(66, 133, 244, 0.25)',
  wall_full: 'rgba(52, 168, 83, 0.25)',
  tub_surround: 'rgba(251, 188, 4, 0.30)',
  tub_deck: 'rgba(234, 67, 53, 0.30)',
  tub_front_panel: 'rgba(255, 112, 67, 0.30)',
  shower_walls: 'rgba(156, 39, 176, 0.30)',
  shower_floor: 'rgba(0, 188, 212, 0.30)',
  shower_niche: 'rgba(255, 193, 7, 0.35)',
  shower_bench: 'rgba(121, 85, 72, 0.30)',
  vanity_backsplash: 'rgba(96, 125, 139, 0.30)',
};

// Fixture default dimensions (in inches, PLAN VIEW — looking down from above)
export const BE_FIXTURE_DEFAULTS: Record<BEFixtureType, BEDimensions> = {
  bathtub: { width: 60, height: 32 },   // 5' x 2'8" standard alcove
  shower: { width: 36, height: 36 },    // 3' x 3' standard stall
  vanity: { width: 36, height: 21 },    // 3' wide x 21" deep
  toilet: { width: 15, height: 29 },    // 15" wide x 29" deep (elongated)
  door: { width: 32, height: 32 },      // plan-view swing arc (square)
  window: { width: 36, height: 6 },     // plan-view wall opening (thin strip)
  mirror: { width: 30, height: 4 },     // plan-view wall-mounted (thin strip)
  light: { width: 8, height: 8 },       // plan-view ceiling/wall light (small square)
};

// Bathtub surround defaults by subtype
export const BATHTUB_SURROUND_DEFAULTS: Record<BathtubSubType, {
  surroundWallCount: number;
  surroundHeight: number;
  deckWidth: number;
  deckHeight: number;
}> = {
  standard_alcove: { surroundWallCount: 3, surroundHeight: 60, deckWidth: 0, deckHeight: 0 },
  corner_garden: { surroundWallCount: 2, surroundHeight: 48, deckWidth: 12, deckHeight: 18 },
  drop_in: { surroundWallCount: 3, surroundHeight: 60, deckWidth: 10, deckHeight: 20 },
  freestanding: { surroundWallCount: 0, surroundHeight: 0, deckWidth: 0, deckHeight: 0 },
};
