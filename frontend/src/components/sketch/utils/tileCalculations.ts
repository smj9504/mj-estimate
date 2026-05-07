/**
 * Tile Calculation Utilities
 * Calculate tile areas for bathroom fixtures (bathtub, shower, etc.)
 * Prices based on 2026 US market rates
 */

import {
  SketchDocument,
  SketchRoom,
  RoomFixture,
  TileZone,
  TileCalculationResult,
  TileSize,
  BathtubSubType,
  ShowerFloorType,
} from '../../../types/sketch';
import {
  BATHTUB_SUBTYPE_DEFAULTS,
  getTileSizeOption,
  DEFAULT_MATERIAL_PRICES,
  DEFAULT_LABOR_RATES,
  SHOWER_PAN_PRICES,
} from '../../../constants/fixtures';

// =====================
// Fixture Area Helpers
// =====================

function getFixtureFootprintSqFt(fixture: RoomFixture): number {
  return fixture.dimensions.width * fixture.dimensions.height;
}

function getBathtubSubType(fixture: RoomFixture): BathtubSubType {
  return fixture.properties?.bathtubSubType || 'standard_alcove';
}

// =====================
// Tile Zone Generators
// =====================

let zoneIdCounter = 0;
function nextZoneId(): string {
  return `tile_zone_${++zoneIdCounter}`;
}

function createTileZone(
  type: TileZone['type'],
  label: string,
  areaSqFt: number,
  tileSize: TileSize,
  wastePercent: number = 10,
  overrides?: Partial<TileZone>
): TileZone {
  return {
    id: nextZoneId(),
    type,
    label,
    areaSqFt,
    tileSize,
    wastePercent,
    unitPrice: DEFAULT_MATERIAL_PRICES[type] || 4.00,
    laborRate: DEFAULT_LABOR_RATES[type] || 7.00,
    isTiled: true,
    ...overrides,
  };
}

/**
 * Calculate floor tile zone for a bathroom
 * Floor area = room floor area - all fixture footprints
 */
function calculateFloorTileZone(
  room: SketchRoom,
  roomFixtures: RoomFixture[]
): TileZone {
  const fixtureFootprintTotal = roomFixtures.reduce((sum, f) => {
    if (f.type === 'bathtub' || f.type === 'shower' || f.type === 'vanity' || f.type === 'toilet') {
      return sum + getFixtureFootprintSqFt(f);
    }
    return sum;
  }, 0);

  const floorTileArea = Math.max(0, room.areas.floorArea - fixtureFootprintTotal);

  return createTileZone('floor', 'Bathroom Floor Tile', floorTileArea, '12x12', 10);
}

/**
 * Calculate bathtub-related tile zones
 */
function calculateBathtubTileZones(fixture: RoomFixture): TileZone[] {
  const zones: TileZone[] = [];
  const subType = getBathtubSubType(fixture);
  const defaults = BATHTUB_SUBTYPE_DEFAULTS[subType];

  const props = fixture.properties || {};
  const deckWidthIn = props.deckWidth ?? defaults.deckWidth;
  const deckHeightIn = props.deckHeight ?? defaults.deckHeight;
  const surroundHeightIn = props.surroundHeight ?? defaults.surroundHeight;
  const surroundWalls = props.surroundWalls ?? defaults.surroundWalls;

  const tubWidthFt = fixture.dimensions.width;
  const tubLengthFt = fixture.dimensions.height;
  const deckWidthFt = deckWidthIn / 12;
  const deckHeightFt = deckHeightIn / 12;
  const surroundHeightFt = surroundHeightIn / 12;

  // --- Deck top tile (corner_garden, drop_in) ---
  if (subType === 'corner_garden' || subType === 'drop_in') {
    let deckArea = 0;

    if (subType === 'corner_garden') {
      const outerWidth = tubWidthFt + deckWidthFt;
      const outerLength = tubLengthFt + deckWidthFt;
      deckArea = (outerWidth * outerLength) - (tubWidthFt * tubLengthFt);
    } else {
      const outerWidth = tubWidthFt + (deckWidthFt * 2);
      const outerLength = tubLengthFt + (deckWidthFt * 2);
      deckArea = (outerWidth * outerLength) - (tubWidthFt * tubLengthFt);
    }

    if (deckArea > 0) {
      zones.push(createTileZone(
        'tub_deck',
        `Tub Deck Top (${subType === 'corner_garden' ? 'Corner' : 'Drop-in'})`,
        deckArea, '12x12', 15
      ));
    }
  }

  // --- Front/side panel tile ---
  if (subType !== 'freestanding' && deckHeightFt > 0) {
    let panelArea = 0;

    if (subType === 'standard_alcove') {
      panelArea = tubLengthFt * deckHeightFt;
    } else if (subType === 'corner_garden') {
      const frontLength = tubLengthFt + deckWidthFt;
      const sideLength = tubWidthFt + deckWidthFt;
      panelArea = (frontLength + sideLength) * deckHeightFt;
    } else if (subType === 'drop_in') {
      panelArea = (tubLengthFt + tubWidthFt) * deckHeightFt;
    }

    if (panelArea > 0) {
      zones.push(createTileZone(
        'tub_front_panel', 'Tub Front/Side Panel',
        panelArea, '12x12', 10
      ));
    }
  }

  // --- Wall surround tile (above tub) ---
  if (surroundWalls > 0 && surroundHeightFt > 0) {
    let surroundLength = 0;

    if (subType === 'standard_alcove') {
      surroundLength = tubLengthFt + (tubWidthFt * 2);
    } else if (subType === 'corner_garden') {
      surroundLength = tubLengthFt + tubWidthFt;
    } else if (subType === 'drop_in') {
      if (surroundWalls >= 3) {
        surroundLength = tubLengthFt + (tubWidthFt * 2);
      } else if (surroundWalls === 2) {
        surroundLength = tubLengthFt + tubWidthFt;
      } else {
        surroundLength = tubLengthFt;
      }
    }

    const surroundArea = surroundLength * surroundHeightFt;
    if (surroundArea > 0) {
      zones.push(createTileZone(
        'tub_surround',
        `Tub Wall Surround (${surroundWalls} walls)`,
        surroundArea, '3x6_subway', 10
      ));
    }
  }

  return zones;
}

/**
 * Calculate shower tile zones
 * Supports tile floor vs shower pan options
 */
function calculateShowerTileZones(
  fixture: RoomFixture,
  showerFloorType: ShowerFloorType = 'tile'
): TileZone[] {
  const zones: TileZone[] = [];

  const showerWidthFt = fixture.dimensions.width;
  const showerLengthFt = fixture.dimensions.height;
  const surroundHeightFt = (fixture.properties?.surroundHeight ?? 84) / 12;
  const surroundWalls = fixture.properties?.surroundWalls ?? 3;

  // --- Shower wall tile ---
  let wallLength = 0;
  if (surroundWalls >= 3) {
    wallLength = showerLengthFt + (showerWidthFt * 2);
  } else if (surroundWalls === 2) {
    wallLength = showerLengthFt + showerWidthFt;
  } else {
    wallLength = showerLengthFt;
  }

  const showerWallArea = wallLength * surroundHeightFt;
  if (showerWallArea > 0) {
    zones.push(createTileZone(
      'shower_wall',
      `Shower Wall Tile (${surroundWalls} walls)`,
      showerWallArea, '12x24', 10
    ));
  }

  // --- Shower floor ---
  const showerFloorArea = showerWidthFt * showerLengthFt;
  if (showerFloorArea > 0) {
    if (showerFloorType === 'tile') {
      zones.push(createTileZone(
        'shower_floor', 'Shower Floor Tile',
        showerFloorArea, '4x4', 10
      ));
    } else {
      // Shower pan (fixed cost, not per-SF)
      const panType = showerFloorType === 'acrylic_pan' ? 'acrylic_pan' : 'fiberglass_pan';
      const panPricing = SHOWER_PAN_PRICES[panType];
      zones.push({
        id: nextZoneId(),
        type: 'shower_floor',
        label: `Shower ${panPricing.label}`,
        areaSqFt: showerFloorArea,
        tileSize: '12x12', // not used for pan
        wastePercent: 0,
        unitPrice: 0,
        laborRate: 0,
        isTiled: false,
        fixedCost: panPricing.totalCost,
      });
    }
  }

  return zones;
}

// =====================
// Main Calculation
// =====================

/**
 * Calculate all tile zones for a bathroom room
 */
export function calculateBathroomTiles(
  room: SketchRoom,
  sketch: SketchDocument,
  showerFloorType: ShowerFloorType = 'tile'
): TileCalculationResult {
  zoneIdCounter = 0;
  const zones: TileZone[] = [];

  const roomFixtures = sketch.roomFixtures.filter(f => f.roomId === room.id);

  // 1. Floor tile (room area minus fixture footprints)
  zones.push(calculateFloorTileZone(room, roomFixtures));

  // 2. Process each bathroom fixture
  for (const fixture of roomFixtures) {
    if (fixture.type === 'bathtub') {
      zones.push(...calculateBathtubTileZones(fixture));
    } else if (fixture.type === 'shower') {
      zones.push(...calculateShowerTileZones(fixture, showerFloorType));
    }
  }

  // Calculate totals
  return recalculateTileTotals({
    roomId: room.id,
    roomName: room.name,
    zones,
    totalAreaSqFt: 0,
    totalTileCount: 0,
    totalBoxes: 0,
    totalMaterialCost: 0,
    totalLaborCost: 0,
    grandTotal: 0,
  });
}

/**
 * Calculate tile count for a zone
 */
export function calculateTileCount(
  areaSqFt: number,
  tileSize: TileSize,
  wastePercent: number,
  customWidth?: number,
  customHeight?: number
): { tileCount: number; boxCount: number; areaWithWaste: number } {
  const tileSizeOption = getTileSizeOption(tileSize);
  const tileW = tileSize === 'custom' && customWidth ? customWidth : tileSizeOption.widthInches;
  const tileH = tileSize === 'custom' && customHeight ? customHeight : tileSizeOption.heightInches;

  const tileAreaSqFt = (tileW * tileH) / 144;
  const areaWithWaste = areaSqFt * (1 + wastePercent / 100);
  const tileCount = Math.ceil(areaWithWaste / tileAreaSqFt);

  const boxCoverage = tileAreaSqFt * Math.floor(10 / tileAreaSqFt || 1);
  const boxCount = Math.ceil(areaWithWaste / Math.max(boxCoverage, tileAreaSqFt));

  return { tileCount, boxCount, areaWithWaste };
}

/**
 * Recalculate totals for a tile calculation result
 * Now uses per-zone labor rates instead of a single global rate
 */
export function recalculateTileTotals(
  result: TileCalculationResult
): TileCalculationResult {
  let totalTileCount = 0;
  let totalBoxes = 0;
  let totalMaterialCost = 0;
  let totalLaborCost = 0;
  let totalAreaSqFt = 0;

  for (const zone of result.zones) {
    if (!zone.isTiled && zone.fixedCost) {
      // Fixed cost item (e.g., shower pan)
      totalMaterialCost += zone.fixedCost;
      totalAreaSqFt += zone.areaSqFt;
      continue;
    }

    const { tileCount, boxCount, areaWithWaste } = calculateTileCount(
      zone.areaSqFt,
      zone.tileSize,
      zone.wastePercent,
      zone.customTileWidth,
      zone.customTileHeight
    );
    totalTileCount += tileCount;
    totalBoxes += boxCount;
    totalMaterialCost += areaWithWaste * zone.unitPrice;
    totalLaborCost += areaWithWaste * zone.laborRate;
    totalAreaSqFt += zone.areaSqFt;
  }

  return {
    ...result,
    totalAreaSqFt,
    totalTileCount,
    totalBoxes,
    totalMaterialCost,
    totalLaborCost,
    grandTotal: totalMaterialCost + totalLaborCost,
  };
}
