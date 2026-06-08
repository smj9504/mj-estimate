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
  | 'damage_zone'
  | 'drywall_repair'
  | 'insulation';

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

export type ShowerDoorType = 'none' | 'sliding' | 'swing' | 'frameless_swing' | 'bi_fold' | 'curtain' | 'neo_angle_pivot';

export type ShowerWallMaterial = 'tile' | 'prefab_acrylic' | 'prefab_fiberglass' | 'solid_surface';

export type BathtubSubType =
  | 'standard_alcove'
  | 'corner_garden'
  | 'corner_drop_in'
  | 'drop_in'
  | 'freestanding';

export type VanitySubType =
  | 'cabinet'
  | 'pedestal_sink'
  | 'wall_mount_sink';

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

export type WallFinish = 'paint' | 'tile';

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
  /** Wall surface finish: paint or tile (default paint) */
  finish?: WallFinish;
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
  /** Number of exposed sides with deck tile (1-3, default 2 for corner, 3 for drop-in) */
  deckTileSides?: number;
  /** Enable tile on the vertical front panel of deck/platform */
  hasFrontPanel?: boolean;
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
  /** Number of walls with tile (1-3, the 4th side is the opening/door) */
  showerWallCount?: number;
  /** Shower wall tile height in inches */
  showerTileHeight?: number;
  /** Shower door/opening type */
  showerDoorType?: ShowerDoorType;
  /** Shower door opening width in inches (auto-calculated if not set) */
  showerDoorWidth?: number;
  /** Fixed glass panel position: none, left of door, right, or both sides */
  fixedPanelConfig?: 'none' | 'left' | 'right' | 'both';
  /**
   * Shower enclosure layout:
   * - 'alcove': 3 walls, 1 open front (default for wallCount=3)
   * - 'corner': 2 walls (back+left), right side = fixed glass, front = door (wallCount=2)
   * - 'corner_right': 2 walls (back+right), left side = fixed glass, front = door
   * - 'neo_angle': 2 walls (back+left), diagonal front with door + 2 glass panels (pentagonal)
   * - 'neo_angle_right': 2 walls (back+right), diagonal front with door + 2 glass panels
   */
  showerLayout?: 'alcove' | 'corner' | 'corner_right' | 'neo_angle' | 'neo_angle_right';
  /**
   * Shower wall material (relevant for neo-angle / corner showers):
   * - 'tile': custom tile walls (default for custom_tile / curbless)
   * - 'prefab_acrylic': prefab acrylic wall surround
   * - 'prefab_fiberglass': prefab fiberglass wall surround
   * - 'solid_surface': solid surface panels (e.g., Corian, Onyx)
   */
  showerWallMaterial?: ShowerWallMaterial;

  // --- Vanity / Sink ---
  vanitySubType?: VanitySubType;
  vanityWidth?: number;
  sinkCount?: number;
  /** Has backsplash tile */
  hasBacksplash?: boolean;
  backsplashHeight?: number;

  // --- Light ---
  /** Ceiling light type: standard, recessed, recessed_multi */
  lightType?: 'standard' | 'recessed' | 'recessed_multi';
  /** Number of recessed cans (for recessed_multi) */
  lightCount?: number;

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
  | 'shower_curb'
  | 'shower_glass_panel'
  | 'shower_door'
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
// Drywall Repair Zones
// =====================

export type DrywallTextureType =
  | 'skip_trowel'
  | 'orange_peel'
  | 'knockdown'
  | 'flat'
  | 'smooth';

export interface BEDrywallRepairZone {
  id: string;
  /** Associated room ID */
  roomId?: string;
  /**
   * wall  → boundary has 2 points [start, end]; area = lineLengthFt × repairHeightInches/12
   * ceiling → boundary has 4 points (rectangle); area from polygon
   */
  surface: 'wall' | 'ceiling';
  /** Boundary points: 2 pts for wall line, 4 pts for ceiling rectangle */
  boundary: BEPoint[];
  /** Area in SF */
  areaSF: number;
  /** Wall repair height in inches (used only for surface=wall; default 96 = 8 ft) */
  repairHeightInches: number;
  /** Optional label */
  label?: string;
  /** Include gluing (cement board or drywall adhesive) */
  includeGluing: boolean;
  /** Texture type to apply after installation */
  textureType: DrywallTextureType;
  /** Number of paint coats (default 2) */
  paintCoats: number;
  /** Drywall board material cost per SF */
  drywallMaterialCostPerSF: number;
  /** Drywall install + gluing labor cost per SF */
  drywallLaborCostPerSF: number;
  /** Texture application cost per SF */
  textureCostPerSF: number;
  /** Prime + paint cost per SF (all coats combined) */
  paintCostPerSF: number;
}

// =====================
// Insulation Zone
// =====================

export type InsulationType = 'fiberglass_batt' | 'blown_in' | 'spray_foam' | 'rigid_board';

export interface BEInsulationZone {
  id: string;
  roomId?: string;
  /**
   * wall  → boundary has 2 points [start, end]; area = lineLengthFt × heightInches/12
   * ceiling → boundary has 4 points (rectangle); area from polygon
   */
  surface: 'wall' | 'ceiling';
  boundary: BEPoint[];
  areaSF: number;
  heightInches: number;
  label?: string;
  /** Whether existing insulation needs demolition before install */
  needsDemo: boolean;
  insulationType: InsulationType;
  /** R-value of the insulation */
  rValue: number;
  /** Material cost per SF */
  materialCostPerSF: number;
  /** Labor cost per SF (install) */
  laborCostPerSF: number;
  /** Demo cost per SF (if needsDemo) */
  demoCostPerSF: number;
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
  /** Drywall repair zones */
  drywallRepairZones: BEDrywallRepairZone[];
  /** Insulation zones */
  insulationZones: BEInsulationZone[];
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
  /** Show drywall repair zones */
  showDrywallRepairZones: boolean;
  /** Show insulation zones */
  showInsulationZones: boolean;
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
  pixelsPerFoot: 40,
  gridSizeFt: 0.125,
  showGrid: true,
  showDimensions: true,
  showAreaLabels: true,
  showTileZones: true,
  showDamageZones: true,
  showDrywallRepairZones: true,
  showInsulationZones: true,
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
  drywallRepairZones: [],
  insulationZones: [],
  settings: { ...DEFAULT_BE_SKETCH_SETTINGS },
};

/** Default cost rates for drywall repair */
export const DEFAULT_DRYWALL_COSTS = {
  drywallMaterialCostPerSF: 1.50,
  drywallLaborCostPerSF: 3.50,
  textureCostPerSF: 1.50,
  paintCostPerSF: 2.20,
};

/** Default cost rates for insulation */
export const DEFAULT_INSULATION_COSTS = {
  materialCostPerSF: 1.20,
  laborCostPerSF: 2.00,
  demoCostPerSF: 1.00,
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
  shower_curb: 'rgba(161, 136, 127, 0.35)',
  shower_glass_panel: 'rgba(33, 150, 243, 0.20)',
  shower_door: 'rgba(33, 150, 243, 0.30)',
  vanity_backsplash: 'rgba(96, 125, 139, 0.30)',
};

// Fixture default dimensions (in inches, PLAN VIEW — looking down from above)
export const BE_FIXTURE_DEFAULTS: Record<BEFixtureType, BEDimensions> = {
  bathtub: { width: 60, height: 32 },   // 5' x 2'8" standard alcove (corner_drop_in uses 60x42)
  shower: { width: 36, height: 36 },    // 3' x 3' standard stall
  vanity: { width: 36, height: 21 },    // 3' wide x 21" deep
  toilet: { width: 15, height: 29 },    // 15" wide x 29" deep (elongated)
  door: { width: 32, height: 32 },      // plan-view swing arc (square)
  window: { width: 36, height: 6 },     // plan-view wall opening (thin strip)
  mirror: { width: 30, height: 4 },     // plan-view wall-mounted (thin strip)
  light: { width: 8, height: 8 },       // plan-view ceiling/wall light (small square)
};

// Vanity/sink defaults by subtype
export const VANITY_SUBTYPE_DEFAULTS: Record<VanitySubType, {
  width: number;
  height: number;
  sinkCount: number;
  hasBacksplash: boolean;
}> = {
  cabinet:         { width: 36, height: 21, sinkCount: 1, hasBacksplash: false },
  pedestal_sink:   { width: 20, height: 17, sinkCount: 1, hasBacksplash: false },
  wall_mount_sink: { width: 20, height: 17, sinkCount: 1, hasBacksplash: false },
};

// Bathtub surround defaults by subtype
export const BATHTUB_SURROUND_DEFAULTS: Record<BathtubSubType, {
  surroundWallCount: number;
  surroundHeight: number;
  deckWidth: number;
  deckHeight: number;
  deckTileSides: number;
  hasFrontPanel: boolean;
}> = {
  standard_alcove: { surroundWallCount: 3, surroundHeight: 60, deckWidth: 0, deckHeight: 0, deckTileSides: 0, hasFrontPanel: false },
  corner_garden: { surroundWallCount: 2, surroundHeight: 48, deckWidth: 12, deckHeight: 18, deckTileSides: 2, hasFrontPanel: true },
  corner_drop_in: { surroundWallCount: 2, surroundHeight: 60, deckWidth: 12, deckHeight: 18, deckTileSides: 2, hasFrontPanel: true },
  drop_in: { surroundWallCount: 3, surroundHeight: 60, deckWidth: 10, deckHeight: 20, deckTileSides: 1, hasFrontPanel: true },
  freestanding: { surroundWallCount: 0, surroundHeight: 0, deckWidth: 0, deckHeight: 0, deckTileSides: 0, hasFrontPanel: false },
};
