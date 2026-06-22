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

/** Ray-casting point-in-polygon test */
function pointInPolygon(pt: BEPoint, poly: BEPoint[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x, yi = poly[i].y;
    const xj = poly[j].x, yj = poly[j].y;
    if ((yi > pt.y) !== (yj > pt.y) && pt.x < (xj - xi) * (pt.y - yi) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
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

  // ── Floor tile zone (from rooms, minus fixture footprints) ──
  for (const room of rooms) {
    // Calculate fixture footprint area within this room
    let fixtureFootprintSF = 0;
    for (const fix of fixtures) {
      // Only deduct bathtub, shower, cabinet vanity (toilet/pedestal/wall-mount sit ON the floor tile)
      if (fix.type !== 'bathtub' && fix.type !== 'shower' && fix.type !== 'vanity') continue;
      // Pedestal & wall-mount sinks: floor tile goes around/under them, don't deduct
      if (fix.type === 'vanity' && fix.properties.vanitySubType && fix.properties.vanitySubType !== 'cabinet') continue;
      // Check if fixture is in this room (by roomId or position inside boundary)
      const inRoom = fix.roomId === room.id || pointInPolygon(fix.position, room.boundary);
      if (!inRoom) continue;
      const fW = fix.dimensions.width / 12; // feet
      const fD = fix.dimensions.height / 12;
      fixtureFootprintSF += fW * fD;
    }
    const netFloorSF = Math.max(0, Math.round((room.floorAreaSF - fixtureFootprintSF) * 100) / 100);

    zones.push({
      id: zoneId(),
      type: 'floor',
      label: `Floor Tile${fixtureFootprintSF > 0 ? ' (net)' : ''}`,
      boundary: room.boundary,
      areaSF: netFloorSF,
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

      // Front panel tile (vertical face of deck/platform)
      if (fix.properties.hasFrontPanel && fix.properties.deckHeight && fix.properties.deckHeight > 0) {
        const frontPanelZone = generateBathtubFrontPanelZone(fix, ppf);
        if (frontPanelZone) zones.push(frontPanelZone);
      }
    }

    if (fix.type === 'shower') {
      // Shower wall tile (adjusted by layout)
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

      // Curb tile
      if ((fix.properties.curbHeight ?? 4) > 0) {
        const curbZone = generateShowerCurbZone(fix, ppf);
        if (curbZone) zones.push(curbZone);
      }

      // Glass panel (fixed)
      const _layout = fix.properties.showerLayout ?? 'alcove';
      if (fix.properties.fixedPanelConfig && fix.properties.fixedPanelConfig !== 'none' || _layout === 'corner' || _layout === 'corner_right' || isNeoAngle(_layout)) {
        const glassZone = generateShowerGlassPanelZone(fix, ppf);
        if (glassZone) zones.push(glassZone);
      }

      // Shower door
      if (fix.properties.showerDoorType && fix.properties.showerDoorType !== 'none' && fix.properties.showerDoorType !== 'curtain') {
        const doorZone = generateShowerDoorZone(fix, ppf);
        if (doorZone) zones.push(doorZone);
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
  const cx = fix.position.x;
  const cy = fix.position.y;
  const chamfered = isChamferedTub(fix);

  let rawBoundary: BEPoint[];
  if (chamfered) {
    const cutW = wPx * CHAMFER_RATIO;
    const cutH = hPx * CHAMFER_RATIO;
    // Perpendicular outward offset for chamfer line direction (-cutW, cutH)
    const diagLen = Math.sqrt(cutW * cutW + cutH * cutH);
    const perpX = expand * cutH / diagLen;  // perpendicular x component
    const perpY = expand * cutW / diagLen;  // perpendicular y component
    rawBoundary = [
      { x: cx - wPx / 2 - expand, y: cy - hPx / 2 - expand },                     // top-left
      { x: cx + wPx / 2 + expand, y: cy - hPx / 2 - expand },                     // top-right
      { x: cx + wPx / 2 + expand, y: cy + hPx / 2 - cutH + perpY },               // right → chamfer start
      { x: cx + wPx / 2 - cutW + perpX, y: cy + hPx / 2 + expand },               // chamfer end → bottom
      { x: cx - wPx / 2 - expand, y: cy + hPx / 2 + expand },                     // bottom-left
    ];
  } else {
    rawBoundary = [
      { x: cx - wPx / 2 - expand, y: cy - hPx / 2 - expand },
      { x: cx + wPx / 2 + expand, y: cy - hPx / 2 - expand },
      { x: cx + wPx / 2 + expand, y: cy + hPx / 2 + expand },
      { x: cx - wPx / 2 - expand, y: cy + hPx / 2 + expand },
    ];
  }
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

/** Is this a chamfered corner tub? (45° cut on exposed corner) */
function isChamferedTub(fix: BEFixture): boolean {
  const sub = fix.properties.bathtubSubType;
  return sub === 'corner_drop_in' || sub === 'corner_garden';
}

/**
 * Chamfer ratio: the sketch cuts from (1, 0.6) to (0.6, 1),
 * meaning 40% of each dimension is removed at the exposed corner.
 */
const CHAMFER_RATIO = 0.4;

function generateBathtubDeckZone(fix: BEFixture, ppf: number): BETileZone | null {
  const deckWidth = fix.properties.deckWidth ?? 10; // inches
  const tubWidth = fix.dimensions.width;
  const tubDepth = fix.dimensions.height;
  const deckTileSides = fix.properties.deckTileSides ?? 2;
  const chamfered = isChamferedTub(fix);

  // ── Area calculation ──
  let areaSF: number;
  if (chamfered && deckTileSides <= 2) {
    // Chamfered corner: exposed edges are front(shorter) + diagonal + right(shorter)
    const frontLen = tubWidth * (1 - CHAMFER_RATIO);   // 60% of width
    const rightLen = tubDepth * (1 - CHAMFER_RATIO);   // 60% of depth
    const diagLen = Math.sqrt((tubWidth * CHAMFER_RATIO) ** 2 + (tubDepth * CHAMFER_RATIO) ** 2);
    const totalExposed = frontLen + diagLen + rightLen;
    // Deck area = exposed perimeter × deckWidth + corner triangle adjustments
    areaSF = (totalExposed * deckWidth) / 144;
  } else {
    // Rectangular tubs: standard calculation
    let deckLengthInches = 0;
    if (deckTileSides >= 1) deckLengthInches += tubWidth;
    if (deckTileSides >= 2) deckLengthInches += tubDepth;
    if (deckTileSides >= 3) deckLengthInches += tubDepth;
    if (deckTileSides >= 4) deckLengthInches += tubWidth;
    const cornerCount = Math.max(0, deckTileSides - 1);
    areaSF = (deckLengthInches * deckWidth + cornerCount * deckWidth * deckWidth) / 144;
  }

  // ── Visual boundary ──
  const wPx = (tubWidth / 12) * ppf;
  const hPx = (tubDepth / 12) * ppf;
  const deckPx = (deckWidth / 12) * ppf;
  const cx = fix.position.x;
  const cy = fix.position.y;

  let rawBoundary: BEPoint[];
  if (chamfered && deckTileSides <= 2) {
    // Chamfered L-shape: follows the pentagonal tub outline + deck offset
    const cutW = wPx * CHAMFER_RATIO;
    const cutH = hPx * CHAMFER_RATIO;
    // Perpendicular outward offset for chamfer line
    const diagLen = Math.sqrt(cutW * cutW + cutH * cutH);
    const perpX = deckPx * cutH / diagLen;
    const perpY = deckPx * cutW / diagLen;
    rawBoundary = [
      { x: cx - wPx / 2, y: cy - hPx / 2 },                                        // top-left (wall)
      { x: cx + wPx / 2 + deckPx, y: cy - hPx / 2 },                               // top-right (deck right)
      { x: cx + wPx / 2 + deckPx, y: cy + hPx / 2 - cutH + perpY },                // right → chamfer start
      { x: cx + wPx / 2 - cutW + perpX, y: cy + hPx / 2 + deckPx },                // chamfer end → bottom
      { x: cx - wPx / 2, y: cy + hPx / 2 + deckPx },                               // bottom-left (deck bottom)
    ];
  } else if (deckTileSides <= 1) {
    rawBoundary = [
      { x: cx - wPx / 2, y: cy + hPx / 2 },
      { x: cx + wPx / 2, y: cy + hPx / 2 },
      { x: cx + wPx / 2, y: cy + hPx / 2 + deckPx },
      { x: cx - wPx / 2, y: cy + hPx / 2 + deckPx },
    ];
  } else if (deckTileSides === 2) {
    rawBoundary = [
      { x: cx + wPx / 2, y: cy - hPx / 2 },
      { x: cx + wPx / 2 + deckPx, y: cy - hPx / 2 },
      { x: cx + wPx / 2 + deckPx, y: cy + hPx / 2 + deckPx },
      { x: cx - wPx / 2, y: cy + hPx / 2 + deckPx },
      { x: cx - wPx / 2, y: cy + hPx / 2 },
      { x: cx + wPx / 2, y: cy + hPx / 2 },
    ];
  } else if (deckTileSides === 3) {
    rawBoundary = [
      { x: cx - wPx / 2 - deckPx, y: cy - hPx / 2 },
      { x: cx + wPx / 2 + deckPx, y: cy - hPx / 2 },
      { x: cx + wPx / 2 + deckPx, y: cy + hPx / 2 + deckPx },
      { x: cx - wPx / 2 - deckPx, y: cy + hPx / 2 + deckPx },
    ];
  } else {
    rawBoundary = [
      { x: cx - wPx / 2 - deckPx, y: cy - hPx / 2 - deckPx },
      { x: cx + wPx / 2 + deckPx, y: cy - hPx / 2 - deckPx },
      { x: cx + wPx / 2 + deckPx, y: cy + hPx / 2 + deckPx },
      { x: cx - wPx / 2 - deckPx, y: cy + hPx / 2 + deckPx },
    ];
  }
  const boundary = rotateBoundary(rawBoundary, fix.position, fix.rotation);

  return {
    id: zoneId(),
    type: 'tub_deck',
    label: `Tub Deck${chamfered ? ' (chamfer)' : ` (${deckTileSides} sides)`}`,
    boundary,
    areaSF: Math.round(areaSF * 100) / 100,
    fixtureId: fix.id,
    tileSpec: { ...DEFAULT_TILE_SPEC, size: '12x12', pattern: 'straight', materialCostPerSF: 6.00, laborCostPerSF: 12.00 },
    color: TILE_ZONE_COLORS.tub_deck,
  };
}

function generateBathtubFrontPanelZone(fix: BEFixture, ppf: number): BETileZone | null {
  const deckHeight = fix.properties.deckHeight ?? 18; // inches (vertical face height)
  const tubWidth = fix.dimensions.width;
  const tubDepth = fix.dimensions.height;
  const deckTileSides = fix.properties.deckTileSides ?? 2;
  const chamfered = isChamferedTub(fix);

  // ── Area calculation ──
  let panelLengthInches: number;
  if (chamfered && deckTileSides <= 2) {
    // Chamfered: front(shorter) + diagonal + right(shorter)
    const frontLen = tubWidth * (1 - CHAMFER_RATIO);
    const rightLen = tubDepth * (1 - CHAMFER_RATIO);
    const diagLen = Math.sqrt((tubWidth * CHAMFER_RATIO) ** 2 + (tubDepth * CHAMFER_RATIO) ** 2);
    panelLengthInches = frontLen + diagLen + rightLen;
  } else {
    panelLengthInches = 0;
    if (deckTileSides >= 1) panelLengthInches += tubWidth;
    if (deckTileSides >= 2) panelLengthInches += tubDepth;
    if (deckTileSides >= 3) panelLengthInches += tubDepth;
    if (deckTileSides >= 4) panelLengthInches += tubWidth;
  }
  const areaSF = (panelLengthInches * deckHeight) / 144;

  // ── Visual boundary: follows exposed edge outline ──
  const wPx = (tubWidth / 12) * ppf;
  const hPx = (tubDepth / 12) * ppf;
  const cx = fix.position.x;
  const cy = fix.position.y;
  const ind = 6; // visual indicator thickness

  let rawBoundary: BEPoint[];
  if (chamfered && deckTileSides <= 2) {
    const cutW = wPx * CHAMFER_RATIO;
    const cutH = hPx * CHAMFER_RATIO;
    // Perpendicular outward offset for chamfer line
    const diagLen = Math.sqrt(cutW * cutW + cutH * cutH);
    const perpX = ind * cutH / diagLen;
    const perpY = ind * cutW / diagLen;
    // Outer edge (shifted outward by ind)
    rawBoundary = [
      { x: cx + wPx / 2, y: cy - hPx / 2 },                                   // inner right-top
      { x: cx + wPx / 2 + ind, y: cy - hPx / 2 },                              // outer right-top
      { x: cx + wPx / 2 + ind, y: cy + hPx / 2 - cutH + perpY },               // outer right → chamfer
      { x: cx + wPx / 2 - cutW + perpX, y: cy + hPx / 2 + ind },               // outer chamfer → bottom
      { x: cx - wPx / 2, y: cy + hPx / 2 + ind },                              // outer bottom-left
      { x: cx - wPx / 2, y: cy + hPx / 2 },                                    // inner bottom-left
      { x: cx + wPx / 2 - cutW, y: cy + hPx / 2 },                             // inner chamfer end
      { x: cx + wPx / 2, y: cy + hPx / 2 - cutH },                             // inner chamfer start
    ];
  } else {
    // Simple strip below tub for non-chamfered
    rawBoundary = [
      { x: cx - wPx / 2, y: cy + hPx / 2 + 2 },
      { x: cx + wPx / 2, y: cy + hPx / 2 + 2 },
      { x: cx + wPx / 2, y: cy + hPx / 2 + 2 + ind },
      { x: cx - wPx / 2, y: cy + hPx / 2 + 2 + ind },
    ];
  }
  const boundary = rotateBoundary(rawBoundary, fix.position, fix.rotation);

  return {
    id: zoneId(),
    type: 'tub_front_panel',
    label: `Front Panel${chamfered ? ' (chamfer)' : ` (${deckTileSides} sides)`}`,
    boundary,
    areaSF: Math.round(areaSF * 100) / 100,
    fixtureId: fix.id,
    tileSpec: { ...DEFAULT_TILE_SPEC, size: '4x4', pattern: 'straight', materialCostPerSF: 6.00, laborCostPerSF: 14.00, wastePct: 15 },
    color: TILE_ZONE_COLORS.tub_front_panel,
  };
}

function isNeoAngle(layout: string): boolean {
  return layout === 'neo_angle' || layout === 'neo_angle_right';
}

function generateShowerWallZone(fix: BEFixture, ppf: number): BETileZone | null {
  const layout = fix.properties.showerLayout ?? 'alcove';
  const wallMaterial = fix.properties.showerWallMaterial ?? 'tile';

  // Prefab wall surround: no tile zone needed for walls
  if (wallMaterial !== 'tile') return null;

  // Wall count derived from layout: alcove=3, corner/neo_angle=2
  const wallCount = (layout === 'corner' || layout === 'corner_right' || isNeoAngle(layout))
    ? 2 : (fix.properties.showerWallCount ?? 3);
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
  const cx = fix.position.x;
  const cy = fix.position.y;

  let rawBoundary: BEPoint[];
  if (isNeoAngle(layout)) {
    const isRight = layout === 'neo_angle_right';
    if (!isRight) {
      // neo_angle: walls top + left, diagonal cut at bottom-right
      rawBoundary = [
        { x: cx - wPx / 2 - expand, y: cy - hPx / 2 - expand },
        { x: cx + wPx / 2 + expand, y: cy - hPx / 2 - expand },
        { x: cx + wPx / 2 + expand, y: cy },
        { x: cx, y: cy + hPx / 2 + expand },
        { x: cx - wPx / 2 - expand, y: cy + hPx / 2 + expand },
      ];
    } else {
      // neo_angle_right: walls top + right, diagonal cut at bottom-left
      rawBoundary = [
        { x: cx - wPx / 2 - expand, y: cy - hPx / 2 - expand },
        { x: cx + wPx / 2 + expand, y: cy - hPx / 2 - expand },
        { x: cx + wPx / 2 + expand, y: cy + hPx / 2 + expand },
        { x: cx, y: cy + hPx / 2 + expand },
        { x: cx - wPx / 2 - expand, y: cy },
      ];
    }
  } else {
    rawBoundary = [
      { x: cx - wPx / 2 - expand, y: cy - hPx / 2 - expand },
      { x: cx + wPx / 2 + expand, y: cy - hPx / 2 - expand },
      { x: cx + wPx / 2 + expand, y: cy + hPx / 2 + expand },
      { x: cx - wPx / 2 - expand, y: cy + hPx / 2 + expand },
    ];
  }
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
  const layout = fix.properties.showerLayout ?? 'alcove';
  const showerWidth = fix.dimensions.width;
  const showerDepth = fix.dimensions.height;

  let areaSF: number;
  if (isNeoAngle(layout)) {
    // Neo-angle: pentagonal base = full rectangle minus the cut corner triangle
    // The cut is half of each dimension (e.g., 48×48 → cut 24×24 triangle)
    const cutW = showerWidth * 0.5;
    const cutD = showerDepth * 0.5;
    areaSF = (showerWidth * showerDepth - 0.5 * cutW * cutD) / 144;
  } else {
    areaSF = (showerWidth * showerDepth) / 144;
  }

  const wPx = (showerWidth / 12) * ppf;
  const hPx = (showerDepth / 12) * ppf;
  const cx = fix.position.x;
  const cy = fix.position.y;

  let rawBoundary: BEPoint[];
  if (isNeoAngle(layout)) {
    const isRight = layout === 'neo_angle_right';
    if (!isRight) {
      // neo_angle: pentagon — cut bottom-right corner
      rawBoundary = [
        { x: cx - wPx / 2, y: cy - hPx / 2 },
        { x: cx + wPx / 2, y: cy - hPx / 2 },
        { x: cx + wPx / 2, y: cy },
        { x: cx, y: cy + hPx / 2 },
        { x: cx - wPx / 2, y: cy + hPx / 2 },
      ];
    } else {
      // neo_angle_right: pentagon — cut bottom-left corner
      rawBoundary = [
        { x: cx - wPx / 2, y: cy - hPx / 2 },
        { x: cx + wPx / 2, y: cy - hPx / 2 },
        { x: cx + wPx / 2, y: cy + hPx / 2 },
        { x: cx, y: cy + hPx / 2 },
        { x: cx - wPx / 2, y: cy },
      ];
    }
  } else {
    rawBoundary = [
      { x: cx - wPx / 2, y: cy - hPx / 2 },
      { x: cx + wPx / 2, y: cy - hPx / 2 },
      { x: cx + wPx / 2, y: cy + hPx / 2 },
      { x: cx - wPx / 2, y: cy + hPx / 2 },
    ];
  }
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
  const benchPos = fix.properties.benchPosition ?? 'left';
  const benchLength = fix.properties.benchLength ?? 36; // along the wall, inches
  const benchWidthFixed = 16; // fixed standard seat depth, inches
  const benchHeight = 18; // standard bench height in inches

  // Tile area: top + front + sides
  const areaSF = (benchLength * benchWidthFixed + benchLength * benchHeight + 2 * benchWidthFixed * benchHeight) / 144;

  const wPx = (fix.dimensions.width / 12) * ppf;
  const hPx = (fix.dimensions.height / 12) * ppf;
  const cx = fix.position.x;
  const cy = fix.position.y;

  let rawBoundary: BEPoint[];
  if (benchPos === 'back') {
    // back wall = top edge
    const bLenPx = Math.min((benchLength / 12) * ppf, wPx - 6);
    const bWPx = (benchWidthFixed / 12) * ppf;
    rawBoundary = [
      { x: cx - wPx / 2 + 3, y: cy - hPx / 2 + 3 },
      { x: cx - wPx / 2 + 3 + bLenPx, y: cy - hPx / 2 + 3 },
      { x: cx - wPx / 2 + 3 + bLenPx, y: cy - hPx / 2 + 3 + bWPx },
      { x: cx - wPx / 2 + 3, y: cy - hPx / 2 + 3 + bWPx },
    ];
  } else if (benchPos === 'right') {
    // right wall
    const bLenPx = Math.min((benchLength / 12) * ppf, hPx - 6);
    const bWPx = (benchWidthFixed / 12) * ppf;
    rawBoundary = [
      { x: cx + wPx / 2 - 3 - bWPx, y: cy - hPx / 2 + 3 },
      { x: cx + wPx / 2 - 3, y: cy - hPx / 2 + 3 },
      { x: cx + wPx / 2 - 3, y: cy - hPx / 2 + 3 + bLenPx },
      { x: cx + wPx / 2 - 3 - bWPx, y: cy - hPx / 2 + 3 + bLenPx },
    ];
  } else {
    // left wall (default)
    const bLenPx = Math.min((benchLength / 12) * ppf, hPx - 6);
    const bWPx = (benchWidthFixed / 12) * ppf;
    rawBoundary = [
      { x: cx - wPx / 2 + 3, y: cy - hPx / 2 + 3 },
      { x: cx - wPx / 2 + 3 + bWPx, y: cy - hPx / 2 + 3 },
      { x: cx - wPx / 2 + 3 + bWPx, y: cy - hPx / 2 + 3 + bLenPx },
      { x: cx - wPx / 2 + 3, y: cy - hPx / 2 + 3 + bLenPx },
    ];
  }
  const boundary = rotateBoundary(rawBoundary, fix.position, fix.rotation);

  return {
    id: zoneId(),
    type: 'shower_bench',
    label: `Bench (${benchPos})`,
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

// ── Shower Curb Tile ──

function generateShowerCurbZone(fix: BEFixture, ppf: number): BETileZone | null {
  const curbHeight = fix.properties.curbHeight ?? 4; // inches
  if (curbHeight <= 0) return null;
  const layout = fix.properties.showerLayout ?? 'alcove';
  const showerWidth = fix.dimensions.width;
  const showerDepth = fix.dimensions.height;
  const curbDepth = 4; // standard curb depth in inches

  let curbLength: number;
  if (isNeoAngle(layout)) {
    // Neo-angle: curb follows diagonal front (hypotenuse of half-width × half-depth triangle)
    const cutW = showerWidth * 0.5;
    const cutD = showerDepth * 0.5;
    curbLength = Math.sqrt(cutW * cutW + cutD * cutD);
  } else {
    curbLength = showerWidth; // alcove/corner: straight front
  }

  // Curb tile: top surface + front face + back face
  const areaSF = (curbLength * curbDepth + 2 * curbLength * curbHeight) / 144;

  const wPx = (showerWidth / 12) * ppf;
  const hPx = (fix.dimensions.height / 12) * ppf;
  const curbPx = 4;
  const cx = fix.position.x;
  const cy = fix.position.y;

  let rawBoundary: BEPoint[];
  if (isNeoAngle(layout)) {
    // Curb follows the diagonal front edge
    const isRight = layout === 'neo_angle_right';
    // Diagonal length vector
    const dx = isRight ? (cx - wPx / 2) - cx : cx - (cx + wPx / 2);  // toward wall side
    const dy = (cy + hPx / 2) - cy;  // downward
    const diagLen = Math.sqrt(dx * dx + dy * dy);
    // Perpendicular inward offset (normalized)
    const perpX = -dy / diagLen * curbPx;
    const perpY = dx / diagLen * curbPx;
    if (!isRight) {
      // neo_angle: diagonal from (right-mid) to (bottom-mid)
      const x1 = cx + wPx / 2, y1 = cy;
      const x2 = cx, y2 = cy + hPx / 2;
      rawBoundary = [
        { x: x1 + perpX, y: y1 + perpY },
        { x: x1, y: y1 },
        { x: x2, y: y2 },
        { x: x2 + perpX, y: y2 + perpY },
      ];
    } else {
      // neo_angle_right: diagonal from (left-mid) to (bottom-mid)
      const x1 = cx - wPx / 2, y1 = cy;
      const x2 = cx, y2 = cy + hPx / 2;
      rawBoundary = [
        { x: x1, y: y1 },
        { x: x1 - perpX, y: y1 - perpY },
        { x: x2 - perpX, y: y2 - perpY },
        { x: x2, y: y2 },
      ];
    }
  } else {
    rawBoundary = [
      { x: cx - wPx / 2, y: cy + hPx / 2 - curbPx },
      { x: cx + wPx / 2, y: cy + hPx / 2 - curbPx },
      { x: cx + wPx / 2, y: cy + hPx / 2 },
      { x: cx - wPx / 2, y: cy + hPx / 2 },
    ];
  }
  const boundary = rotateBoundary(rawBoundary, fix.position, fix.rotation);

  return {
    id: zoneId(),
    type: 'shower_curb',
    label: `Curb (${curbHeight}")`,
    boundary,
    areaSF: Math.round(areaSF * 100) / 100,
    fixtureId: fix.id,
    tileSpec: { ...DEFAULT_TILE_SPEC, size: '4x4', pattern: 'straight', materialCostPerSF: 6.00, laborCostPerSF: 12.00, wastePct: 15 },
    color: TILE_ZONE_COLORS.shower_curb,
  };
}

// ── Shower Glass Panel (fixed) ──

function generateShowerGlassPanelZone(fix: BEFixture, ppf: number): BETileZone | null {
  const showerWidth = fix.dimensions.width;
  const showerDepth = fix.dimensions.height;
  const tileHeight = fix.properties.showerTileHeight ?? 96;
  const layout = fix.properties.showerLayout ?? 'alcove';
  const panelCfg = fix.properties.fixedPanelConfig ?? 'none';
  const hasLeft = panelCfg === 'left' || panelCfg === 'both';
  const hasRight = panelCfg === 'right' || panelCfg === 'both';

  let panelCount = 0;
  let totalPanelWidthInches = 0;

  if (isNeoAngle(layout)) {
    // Neo-angle: 2 fixed glass panels (half of each exposed side)
    // Panel 1: half of width side (right or left depending on orientation)
    totalPanelWidthInches += showerWidth * 0.5;
    panelCount++;
    // Panel 2: half of depth side (bottom)
    totalPanelWidthInches += showerDepth * 0.5;
    panelCount++;
  } else if (layout === 'corner' || layout === 'corner_right') {
    // Corner layout: one full side is glass
    totalPanelWidthInches += showerDepth;
    panelCount++;
  }

  // Front fixed panels (alcove/corner only, not neo-angle)
  if (!isNeoAngle(layout)) {
    if (hasLeft) {
      totalPanelWidthInches += showerWidth * 0.25;
      panelCount++;
    }
    if (hasRight) {
      totalPanelWidthInches += showerWidth * 0.25;
      panelCount++;
    }
  }

  if (totalPanelWidthInches <= 0) return null;

  // Glass panel height (same as tile height, typically 72-96")
  const panelHeightInches = Math.min(tileHeight, 80); // glass panels typically max 80"
  // Glass panel area (for cost estimation, not tile - but use SF for consistency)
  const areaSF = Math.round((totalPanelWidthInches * panelHeightInches) / 144 * 100) / 100;

  const wPx = (showerWidth / 12) * ppf;
  const hPx = (showerDepth / 12) * ppf;
  const cx = fix.position.x;
  const cy = fix.position.y;

  // Visual indicator: thin strip on the glass side
  const ind = 4;
  let rawBoundary: BEPoint[];
  if (isNeoAngle(layout)) {
    // Neo-angle: visual indicator along the diagonal front edge
    const isRight = layout === 'neo_angle_right';
    if (!isRight) {
      // neo_angle: diagonal from bottom-right corner area
      rawBoundary = [
        { x: cx + wPx / 2, y: cy },
        { x: cx + wPx / 2 + ind, y: cy },
        { x: cx + ind, y: cy + hPx / 2 + ind },
        { x: cx, y: cy + hPx / 2 },
      ];
    } else {
      // neo_angle_right: diagonal from bottom-left corner area
      rawBoundary = [
        { x: cx - wPx / 2, y: cy },
        { x: cx, y: cy + hPx / 2 },
        { x: cx - ind, y: cy + hPx / 2 + ind },
        { x: cx - wPx / 2 - ind, y: cy },
      ];
    }
  } else if (layout === 'corner') {
    // Glass on right side
    rawBoundary = [
      { x: cx + wPx / 2, y: cy - hPx / 2 },
      { x: cx + wPx / 2 + ind, y: cy - hPx / 2 },
      { x: cx + wPx / 2 + ind, y: cy + hPx / 2 },
      { x: cx + wPx / 2, y: cy + hPx / 2 },
    ];
  } else if (layout === 'corner_right') {
    // Glass on left side
    rawBoundary = [
      { x: cx - wPx / 2 - ind, y: cy - hPx / 2 },
      { x: cx - wPx / 2, y: cy - hPx / 2 },
      { x: cx - wPx / 2, y: cy + hPx / 2 },
      { x: cx - wPx / 2 - ind, y: cy + hPx / 2 },
    ];
  } else {
    // Fixed panel on front-left portion
    const panelW = wPx * 0.4;
    rawBoundary = [
      { x: cx - wPx / 2, y: cy + hPx / 2 },
      { x: cx - wPx / 2 + panelW, y: cy + hPx / 2 },
      { x: cx - wPx / 2 + panelW, y: cy + hPx / 2 + ind },
      { x: cx - wPx / 2, y: cy + hPx / 2 + ind },
    ];
  }
  const boundary = rotateBoundary(rawBoundary, fix.position, fix.rotation);

  return {
    id: zoneId(),
    type: 'shower_glass_panel',
    label: `Glass Panel (${panelCount})`,
    boundary,
    areaSF,
    fixtureId: fix.id,
    // Glass panels use different cost structure (not tile - glass + labor)
    tileSpec: { ...DEFAULT_TILE_SPEC, material: 'glass', size: 'custom', pattern: 'straight', materialCostPerSF: 25.00, laborCostPerSF: 15.00, wastePct: 0 },
    color: TILE_ZONE_COLORS.shower_glass_panel,
  };
}

// ── Shower Door ──

function generateShowerDoorZone(fix: BEFixture, ppf: number): BETileZone | null {
  const layout = fix.properties.showerLayout ?? 'alcove';
  const showerWidth = fix.dimensions.width;
  const showerDepth = fix.dimensions.height;
  const doorType = fix.properties.showerDoorType ?? 'none';
  const panelCfg = fix.properties.fixedPanelConfig ?? 'none';
  const hasLeft = panelCfg === 'left' || panelCfg === 'both';
  const hasRight = panelCfg === 'right' || panelCfg === 'both';
  const hasAny = hasLeft || hasRight;

  if (doorType === 'none' || doorType === 'curtain') return null;

  // Door opening width: user-specified or auto-calculated
  let doorWidthInches: number;
  if (fix.properties.showerDoorWidth) {
    doorWidthInches = fix.properties.showerDoorWidth;
  } else if (isNeoAngle(layout)) {
    // Neo-angle door spans the diagonal; typical neo-angle door ~24"
    doorWidthInches = 24;
  } else {
    doorWidthInches = showerWidth * 0.5;
  }
  const doorHeightInches = 72;

  const costMap: Record<string, { material: number; labor: number }> = {
    sliding: { material: 18.00, labor: 12.00 },
    swing: { material: 22.00, labor: 14.00 },
    frameless_swing: { material: 30.00, labor: 18.00 },
    bi_fold: { material: 20.00, labor: 14.00 },
    neo_angle_pivot: { material: 28.00, labor: 16.00 },
  };
  const costs = costMap[doorType] ?? { material: 20.00, labor: 14.00 };

  const effectiveWidth = doorType === 'sliding' ? doorWidthInches : doorWidthInches;
  const areaSF = Math.round((effectiveWidth * doorHeightInches) / 144 * 100) / 100;

  const wPx = (showerWidth / 12) * ppf;
  const hPx = (fix.dimensions.height / 12) * ppf;
  const cx = fix.position.x;
  const cy = fix.position.y;
  const ind = 4;

  let rawBoundary: BEPoint[];
  if (isNeoAngle(layout)) {
    // Door along the diagonal front edge
    const isRight = layout === 'neo_angle_right';
    if (!isRight) {
      // neo_angle: diagonal from (right-mid) to (bottom-mid)
      const x1 = cx + wPx / 2, y1 = cy;
      const x2 = cx, y2 = cy + hPx / 2;
      const dx = x2 - x1, dy = y2 - y1;
      const diagLen = Math.sqrt(dx * dx + dy * dy);
      const perpX = -dy / diagLen * ind;
      const perpY = dx / diagLen * ind;
      rawBoundary = [
        { x: x1 + 2 * dx / diagLen, y: y1 + 2 * dy / diagLen },
        { x: x2 - 2 * dx / diagLen, y: y2 - 2 * dy / diagLen },
        { x: x2 - 2 * dx / diagLen - perpX, y: y2 - 2 * dy / diagLen - perpY },
        { x: x1 + 2 * dx / diagLen - perpX, y: y1 + 2 * dy / diagLen - perpY },
      ];
    } else {
      // neo_angle_right: diagonal from (left-mid) to (bottom-mid)
      const x1 = cx - wPx / 2, y1 = cy;
      const x2 = cx, y2 = cy + hPx / 2;
      const dx = x2 - x1, dy = y2 - y1;
      const diagLen = Math.sqrt(dx * dx + dy * dy);
      const perpX = dy / diagLen * ind;
      const perpY = -dx / diagLen * ind;
      rawBoundary = [
        { x: x1 + 2 * dx / diagLen, y: y1 + 2 * dy / diagLen },
        { x: x2 - 2 * dx / diagLen, y: y2 - 2 * dy / diagLen },
        { x: x2 - 2 * dx / diagLen + perpX, y: y2 - 2 * dy / diagLen + perpY },
        { x: x1 + 2 * dx / diagLen + perpX, y: y1 + 2 * dy / diagLen + perpY },
      ];
    }
  } else {
    const leftPx = hasLeft ? wPx * 0.25 : 0;
    const rightPx = hasRight ? wPx * 0.25 : 0;
    const startX = cx - wPx / 2 + leftPx + (hasLeft ? 2 : 0);
    const endX = cx + wPx / 2 - rightPx - (hasRight ? 2 : 0);
    rawBoundary = [
      { x: startX, y: cy + hPx / 2 + 2 },
      { x: endX, y: cy + hPx / 2 + 2 },
      { x: endX, y: cy + hPx / 2 + 2 + ind },
      { x: startX, y: cy + hPx / 2 + 2 + ind },
    ];
  }
  const boundary = rotateBoundary(rawBoundary, fix.position, fix.rotation);

  const doorLabels: Record<string, string> = {
    sliding: 'Sliding Door', swing: 'Swing Door',
    frameless_swing: 'Frameless Door', bi_fold: 'Bi-fold Door',
    neo_angle_pivot: 'Neo-Angle Door',
  };

  return {
    id: zoneId(),
    type: 'shower_door',
    label: doorLabels[doorType] ?? 'Door',
    boundary,
    areaSF,
    fixtureId: fix.id,
    tileSpec: { ...DEFAULT_TILE_SPEC, material: 'glass', size: 'custom', pattern: 'straight', materialCostPerSF: costs.material, laborCostPerSF: costs.labor, wastePct: 0 },
    color: TILE_ZONE_COLORS.shower_door,
  };
}
