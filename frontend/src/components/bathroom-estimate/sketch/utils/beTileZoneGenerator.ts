/**
 * beTileZoneGenerator - Auto-generate tile zones from fixtures
 *
 * Analyzes placed fixtures (bathtub, shower, vanity) and rooms
 * to automatically create appropriate tile zones with correct areas.
 */

import type {
  BEFixture,
  BERoom,
  BETileZone,
  BETileSpec,
  TileZoneType,
  BEPoint,
} from '../../../../types/bathroomSketch';
import { DEFAULT_TILE_SPEC, TILE_ZONE_COLORS } from '../../../../types/bathroomSketch';

let _zoneCounter = 0;
function zoneId(): string {
  _zoneCounter += 1;
  return `tz_${Date.now()}_${_zoneCounter}`;
}

/** Rotate a point around a center by the given angle in degrees */
function rotatePoint(p: BEPoint, center: BEPoint, angleDeg: number): BEPoint {
  if (angleDeg === 0) return p;
  const rad = (angleDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const dx = p.x - center.x;
  const dy = p.y - center.y;
  return {
    x: center.x + dx * cos - dy * sin,
    y: center.y + dx * sin + dy * cos,
  };
}

/** Rotate all boundary points around the fixture center */
function rotateBoundary(boundary: BEPoint[], center: BEPoint, angleDeg: number): BEPoint[] {
  if (angleDeg === 0) return boundary;
  return boundary.map((p) => rotatePoint(p, center, angleDeg));
}

/**
 * Generate all tile zones from current fixtures and rooms.
 * Called whenever fixtures or rooms change.
 */
export function generateTileZones(
  fixtures: BEFixture[],
  rooms: BERoom[],
  pixelsPerFoot: number,
): BETileZone[] {
  const zones: BETileZone[] = [];

  // ── Floor tile zone (from rooms) ──
  for (const room of rooms) {
    zones.push({
      id: zoneId(),
      type: 'floor',
      label: 'Floor Tile',
      boundary: room.boundary,
      areaSF: room.floorAreaSF,
      tileSpec: { ...DEFAULT_TILE_SPEC, size: '12x12', pattern: 'straight' },
      color: TILE_ZONE_COLORS.floor,
    });
  }

  // ── Fixture-based zones ──
  for (const fix of fixtures) {
    const ppf = pixelsPerFoot;
    const wPx = (fix.dimensions.width / 12) * ppf;
    const hPx = (fix.dimensions.height / 12) * ppf;

    if (fix.type === 'bathtub') {
      // Surround tile
      if (fix.properties.hasSurround) {
        const surroundZone = generateBathtubSurroundZone(fix, ppf);
        if (surroundZone) zones.push(surroundZone);
      }

      // Deck tile (for drop_in and corner_garden)
      if (fix.properties.deckWidth && fix.properties.deckWidth > 0) {
        const deckZone = generateBathtubDeckZone(fix, ppf);
        if (deckZone) zones.push(deckZone);
      }
    }

    if (fix.type === 'shower') {
      // Shower wall tile
      const showerWallZone = generateShowerWallZone(fix, ppf);
      if (showerWallZone) zones.push(showerWallZone);

      // Shower floor tile
      if (fix.properties.showerFloorType === 'tile') {
        const showerFloorZone = generateShowerFloorZone(fix, ppf);
        if (showerFloorZone) zones.push(showerFloorZone);
      }

      // Niche tile
      if ((fix.properties.nicheCount ?? 0) > 0) {
        const nicheZone = generateShowerNicheZone(fix, ppf);
        if (nicheZone) zones.push(nicheZone);
      }

      // Bench tile
      if (fix.properties.hasBench) {
        const benchZone = generateShowerBenchZone(fix, ppf);
        if (benchZone) zones.push(benchZone);
      }
    }

    if (fix.type === 'vanity' && fix.properties.hasBacksplash) {
      const backsplashZone = generateVanityBacksplashZone(fix, ppf);
      if (backsplashZone) zones.push(backsplashZone);
    }
  }

  return zones;
}

// ── Zone Generators ──

function generateBathtubSurroundZone(fix: BEFixture, ppf: number): BETileZone | null {
  const wallCount = fix.properties.surroundWallCount ?? 3;
  const surroundHeight = fix.properties.surroundHeight ?? 60; // inches
  const tubWidth = fix.dimensions.width; // inches
  const tubDepth = fix.dimensions.height; // inches

  // Surround SF = perimeter of tiled walls * surround height / 144
  let perimeterInches = 0;
  if (wallCount >= 1) perimeterInches += tubWidth; // back wall
  if (wallCount >= 2) perimeterInches += tubDepth; // left side
  if (wallCount >= 3) perimeterInches += tubDepth; // right side (for alcove: both sides)

  const areaSF = (perimeterInches * surroundHeight) / 144;

  // Visual boundary (slightly larger than fixture), then rotate to match fixture
  const wPx = (tubWidth / 12) * ppf;
  const hPx = (tubDepth / 12) * ppf;
  const expand = 8;
  const rawBoundary: BEPoint[] = [
    { x: fix.position.x - wPx / 2 - expand, y: fix.position.y - hPx / 2 - expand },
    { x: fix.position.x + wPx / 2 + expand, y: fix.position.y - hPx / 2 - expand },
    { x: fix.position.x + wPx / 2 + expand, y: fix.position.y + hPx / 2 + expand },
    { x: fix.position.x - wPx / 2 - expand, y: fix.position.y + hPx / 2 + expand },
  ];
  const boundary = rotateBoundary(rawBoundary, fix.position, fix.rotation);

  return {
    id: zoneId(),
    type: 'tub_surround',
    label: 'Tub Surround',
    boundary,
    areaSF: Math.round(areaSF * 100) / 100,
    fixtureId: fix.id,
    tileSpec: { ...DEFAULT_TILE_SPEC, size: '12x24', pattern: 'subway', materialCostPerSF: 5.50, laborCostPerSF: 10.00 },
    color: TILE_ZONE_COLORS.tub_surround,
  };
}

function generateBathtubDeckZone(fix: BEFixture, ppf: number): BETileZone | null {
  const deckWidth = fix.properties.deckWidth ?? 10; // inches
  const tubWidth = fix.dimensions.width;
  const tubDepth = fix.dimensions.height;

  // Deck area = perimeter of tub * deck width / 144
  // Simplified: (2 * tubWidth + 2 * tubDepth) * deckWidth / 144
  // But typically only the top/sides that have deck
  const deckPerimeter = 2 * tubWidth + 2 * tubDepth;
  const areaSF = (deckPerimeter * deckWidth) / 144;

  const wPx = (tubWidth / 12) * ppf;
  const hPx = (tubDepth / 12) * ppf;
  const deckPx = (deckWidth / 12) * ppf;
  const rawBoundary: BEPoint[] = [
    { x: fix.position.x - wPx / 2 - deckPx, y: fix.position.y - hPx / 2 - deckPx },
    { x: fix.position.x + wPx / 2 + deckPx, y: fix.position.y - hPx / 2 - deckPx },
    { x: fix.position.x + wPx / 2 + deckPx, y: fix.position.y + hPx / 2 + deckPx },
    { x: fix.position.x - wPx / 2 - deckPx, y: fix.position.y + hPx / 2 + deckPx },
  ];
  const boundary = rotateBoundary(rawBoundary, fix.position, fix.rotation);

  return {
    id: zoneId(),
    type: 'tub_deck',
    label: 'Tub Deck',
    boundary,
    areaSF: Math.round(areaSF * 100) / 100,
    fixtureId: fix.id,
    tileSpec: { ...DEFAULT_TILE_SPEC, size: '12x12', pattern: 'straight', materialCostPerSF: 6.00, laborCostPerSF: 12.00 },
    color: TILE_ZONE_COLORS.tub_deck,
  };
}

function generateShowerWallZone(fix: BEFixture, ppf: number): BETileZone | null {
  const wallCount = fix.properties.showerWallCount ?? 3;
  const tileHeight = fix.properties.showerTileHeight ?? 96; // inches
  const showerWidth = fix.dimensions.width; // inches
  const showerDepth = fix.dimensions.height; // inches

  let perimeterInches = 0;
  if (wallCount >= 1) perimeterInches += showerWidth; // back wall
  if (wallCount >= 2) perimeterInches += showerDepth; // side
  if (wallCount >= 3) perimeterInches += showerDepth; // other side

  const areaSF = (perimeterInches * tileHeight) / 144;

  const wPx = (showerWidth / 12) * ppf;
  const hPx = (showerDepth / 12) * ppf;
  const expand = 5;
  const rawBoundary: BEPoint[] = [
    { x: fix.position.x - wPx / 2 - expand, y: fix.position.y - hPx / 2 - expand },
    { x: fix.position.x + wPx / 2 + expand, y: fix.position.y - hPx / 2 - expand },
    { x: fix.position.x + wPx / 2 + expand, y: fix.position.y + hPx / 2 + expand },
    { x: fix.position.x - wPx / 2 - expand, y: fix.position.y + hPx / 2 + expand },
  ];
  const boundary = rotateBoundary(rawBoundary, fix.position, fix.rotation);

  return {
    id: zoneId(),
    type: 'shower_walls',
    label: 'Shower Walls',
    boundary,
    areaSF: Math.round(areaSF * 100) / 100,
    fixtureId: fix.id,
    tileSpec: { ...DEFAULT_TILE_SPEC, size: '12x24', pattern: 'straight', materialCostPerSF: 5.50, laborCostPerSF: 10.00 },
    color: TILE_ZONE_COLORS.shower_walls,
  };
}

function generateShowerFloorZone(fix: BEFixture, ppf: number): BETileZone | null {
  const showerWidth = fix.dimensions.width;
  const showerDepth = fix.dimensions.height;
  const areaSF = (showerWidth * showerDepth) / 144;

  const wPx = (showerWidth / 12) * ppf;
  const hPx = (showerDepth / 12) * ppf;
  const rawBoundary: BEPoint[] = [
    { x: fix.position.x - wPx / 2, y: fix.position.y - hPx / 2 },
    { x: fix.position.x + wPx / 2, y: fix.position.y - hPx / 2 },
    { x: fix.position.x + wPx / 2, y: fix.position.y + hPx / 2 },
    { x: fix.position.x - wPx / 2, y: fix.position.y + hPx / 2 },
  ];
  const boundary = rotateBoundary(rawBoundary, fix.position, fix.rotation);

  return {
    id: zoneId(),
    type: 'shower_floor',
    label: 'Shower Floor',
    boundary,
    areaSF: Math.round(areaSF * 100) / 100,
    fixtureId: fix.id,
    tileSpec: { ...DEFAULT_TILE_SPEC, size: '4x4', pattern: 'straight', materialCostPerSF: 6.00, laborCostPerSF: 12.00, wastePct: 15 },
    color: TILE_ZONE_COLORS.shower_floor,
  };
}

function generateShowerNicheZone(fix: BEFixture, ppf: number): BETileZone | null {
  const nicheCount = fix.properties.nicheCount ?? 1;
  // Standard niche: 12"W x 24"H x 4"D → tile all 5 interior faces
  // Simplified: each niche ~3.5 SF of tile
  const areaSF = nicheCount * 3.5;

  // Small indicator near fixture top
  const wPx = (fix.dimensions.width / 12) * ppf;
  const hPx = (fix.dimensions.height / 12) * ppf;
  const nicheW = 20;
  const nicheH = 15;
  const rawBoundary: BEPoint[] = [
    { x: fix.position.x - nicheW / 2, y: fix.position.y - hPx / 2 - 15 },
    { x: fix.position.x + nicheW / 2, y: fix.position.y - hPx / 2 - 15 },
    { x: fix.position.x + nicheW / 2, y: fix.position.y - hPx / 2 - 15 + nicheH },
    { x: fix.position.x - nicheW / 2, y: fix.position.y - hPx / 2 - 15 + nicheH },
  ];
  const boundary = rotateBoundary(rawBoundary, fix.position, fix.rotation);

  return {
    id: zoneId(),
    type: 'shower_niche',
    label: `Niche (${nicheCount})`,
    boundary,
    areaSF: Math.round(areaSF * 100) / 100,
    fixtureId: fix.id,
    tileSpec: { ...DEFAULT_TILE_SPEC, size: '4x4', pattern: 'straight', materialCostPerSF: 8.00, laborCostPerSF: 15.00, wastePct: 20 },
    color: TILE_ZONE_COLORS.shower_niche,
  };
}

function generateShowerBenchZone(fix: BEFixture, ppf: number): BETileZone | null {
  const benchWidth = fix.properties.benchWidth ?? 16; // inches
  const benchDepth = fix.properties.benchDepth ?? 14; // inches
  // Bench tile: top + front + sides ≈ (W*D + W*18 + 2*D*18) / 144
  const benchHeight = 18; // standard bench height in inches
  const areaSF = (benchWidth * benchDepth + benchWidth * benchHeight + 2 * benchDepth * benchHeight) / 144;

  const wPx = (fix.dimensions.width / 12) * ppf;
  const hPx = (fix.dimensions.height / 12) * ppf;
  const bW = (benchWidth / 12) * ppf;
  const bD = (benchDepth / 12) * ppf;
  const rawBoundary: BEPoint[] = [
    { x: fix.position.x - wPx / 2 + 3, y: fix.position.y + hPx / 2 - bD },
    { x: fix.position.x - wPx / 2 + 3 + bW, y: fix.position.y + hPx / 2 - bD },
    { x: fix.position.x - wPx / 2 + 3 + bW, y: fix.position.y + hPx / 2 },
    { x: fix.position.x - wPx / 2 + 3, y: fix.position.y + hPx / 2 },
  ];
  const boundary = rotateBoundary(rawBoundary, fix.position, fix.rotation);

  return {
    id: zoneId(),
    type: 'shower_bench',
    label: 'Bench',
    boundary,
    areaSF: Math.round(areaSF * 100) / 100,
    fixtureId: fix.id,
    tileSpec: { ...DEFAULT_TILE_SPEC, size: '12x12', pattern: 'straight', materialCostPerSF: 6.00, laborCostPerSF: 12.00, wastePct: 15 },
    color: TILE_ZONE_COLORS.shower_bench,
  };
}

function generateVanityBacksplashZone(fix: BEFixture, ppf: number): BETileZone | null {
  const vanityWidth = fix.dimensions.width; // inches
  const backsplashHeight = fix.properties.backsplashHeight ?? 4; // inches
  const areaSF = (vanityWidth * backsplashHeight) / 144;

  const wPx = (vanityWidth / 12) * ppf;
  const hPx = (fix.dimensions.height / 12) * ppf;
  const bH = (backsplashHeight / 12) * ppf;
  const rawBoundary: BEPoint[] = [
    { x: fix.position.x - wPx / 2, y: fix.position.y - hPx / 2 - bH },
    { x: fix.position.x + wPx / 2, y: fix.position.y - hPx / 2 - bH },
    { x: fix.position.x + wPx / 2, y: fix.position.y - hPx / 2 },
    { x: fix.position.x - wPx / 2, y: fix.position.y - hPx / 2 },
  ];
  const boundary = rotateBoundary(rawBoundary, fix.position, fix.rotation);

  return {
    id: zoneId(),
    type: 'vanity_backsplash',
    label: 'Backsplash',
    boundary,
    areaSF: Math.round(areaSF * 100) / 100,
    fixtureId: fix.id,
    tileSpec: { ...DEFAULT_TILE_SPEC, size: '3x6_subway', pattern: 'subway', materialCostPerSF: 5.00, laborCostPerSF: 10.00, wastePct: 12 },
    color: TILE_ZONE_COLORS.vanity_backsplash,
  };
}
