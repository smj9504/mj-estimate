/**
 * The bathroom sketch in 3D, as plain data in inches: the walls cut around
 * their doors and windows with the tile and the tub / shower surrounds on
 * their room side, the floors, each fixture where the plan puts it, and the
 * looks (tile, paint, metal, tops) the estimate's specs give them, or an
 * option's picked products (their colour, finish, tile size and surface
 * picture). No three.js here — bathroom3dScene.ts turns this into meshes.
 *
 * Plan to 3D: a plan point (x, y) in px is (x, y) / pixelsPerFoot × 12
 * inches. Plan x is three's x, plan y (down the screen) is three's z, and
 * three's y is up from the floor. A wall stands on its plan line and is as
 * thick as a framed wall toward the outside, so the room keeps the size it
 * was drawn at and fixtures stand against the wall's face.
 */

import type { BathroomSelection } from '../../../types/bathroomEstimate';
import type { BEFixture, BEPoint, BERoom, BESketchData, BEWall } from '../../../types/bathroomSketch';
import { NICHE_DEPTH_IN } from '../../../types/bathroomSketch';
import { nicheKind } from '../fixtureRows';
import { findFixtureWallSides } from './utils/beTileZoneGenerator';
import {
  regionRect,
  showerNicheCount,
  subtractRects,
  surroundsAfterWork,
  wallFixtureCovers,
  wallLengthIn,
  wallNichesOf,
  wallOpeningsOf,
  showerFrontOpening,
  showerFrontTiled,
  showerFrontTiles,
  fixtureSidesAgainstWalls,
  isShowerGlassFront,
  wallRoomNormal,
  wallTileRegions,
  type FaceRect,
} from './utils/wallFinish';
import { BORDER_BAND_IN, floorBorderRuns, wallBorderRuns } from './utils/decoTile';

/** A plan point in inches: [x, z]. */
export type Pt = [number, number];

/** Which finish the walls show: after the work (the tile to install) or as they are today. */
export type FinishView = 'after' | 'today';

export interface TileLook {
  /** Same look, same key: the scene makes one texture per key. */
  key: string;
  material: string;
  /** One tile, inches: along the surface, and across it. */
  widthIn: number;
  heightIn: number;
  pattern: string;
  color: string;
  grout: string;
  roughness: number;
  /** A picked tile's surface picture (a file id), laid on each tile in place of the flat colour. */
  swatchFileId?: string;
}

export interface BathroomLooks {
  paint: string;
  /** Null when the floor isn't tile (a plain floor in floorPlain). */
  floor: TileLook | null;
  floorPlain: string;
  wallTile: TileLook;
  showerTile: TileLook;
  surroundTile: TileLook;
  /** Acrylic / fiberglass surrounds, pans and tubs. */
  prefab: string;
  vanityBox: string;
  vanityTop: string;
  /** A wall-hung vanity, clear of the floor. */
  vanityFloating: boolean;
  /** Toilets and sinks. */
  china: string;
  metal: string;
  /** A tub with a shower over it (the job has no separate shower): head and curtain rod. */
  tubShower: boolean;
  /** A fixed glass panel on the tub's open side (bathtub_spec glass_panel_*), inches. */
  tubGlassPanel: { widthIn: number; heightIn: number } | null;
  /** Sliding glass doors across the tub's front (bathtub_spec glass_door_*): in place of the curtain rod. */
  tubGlassDoors: { heightIn: number; frameless: boolean } | null;
}

export interface WallOpeningSolid {
  rect: FaceRect;
  /** 'open': a shower's glass front along the wall, no wall there floor to ceiling (no jambs, no casing) */
  kind: 'door' | 'window' | 'open';
  fixtureId: string;
  /** A door: which end of the opening its hinge is at, and whether it swings into the room. */
  hingeAtStart: boolean;
  swingsIn: boolean;
  /** An opening with no door in it */
  noSlab?: boolean;
  /** A pair of doors, hinged at either side, meeting in the middle */
  double?: boolean;
  /** A shower room's entry, its front tiled inside: tiled round its jambs and head, not cased */
  tiledRound?: boolean;
}

/** A niche: a recess in one of the wall's faces, lined with tile (the look of what's round it) or painted */
export interface WallNicheSolid {
  rect: FaceRect;
  fixtureId: string;
  /** How far it goes into the wall, inches */
  depthIn: number;
  lining: 'shower' | 'tub' | 'wall' | 'paint';
  /** The face it's set in: the room's (+z), or the other one (a shower room off the bathroom, the wall the bathroom's) */
  face: 'room' | 'back';
}

/** Behind a tub or shower: its tile, or its prefab surround */
export interface WallSurroundSolid {
  rect: FaceRect;
  finish: 'tile' | 'prefab';
  fixtureId: string;
}

export interface WallSolid {
  id: string;
  a: Pt;
  b: Pt;
  lengthIn: number;
  heightIn: number;
  thicknessIn: number;
  /** Unit normal from the wall into its room; null for a wall in no room. */
  inward: Pt | null;
  /** The wall itself, as rectangles on its face (along from a, up from the floor), openings left out. */
  pieces: FaceRect[];
  /** Tile on its room side, less openings and surrounds — save those the tile runs over whole. */
  tile: FaceRect[];
  /** The part behind a tub or shower on its room face: tiled with the fixture, or its prefab surround. */
  surrounds: WallSurroundSolid[];
  /**
   * The same on its other face: a tub or shower on the far side of the wall
   * from its room (a shower room off the bathroom, the wall the bathroom's),
   * a shower room's front tiled inside there too
   */
  backSurrounds: WallSurroundSolid[];
  openings: WallOpeningSolid[];
  /** Niches in either face, cut out of its pieces and that face's tile and surrounds */
  niches: WallNicheSolid[];
  /** Decorative border rows across its tile after the work, as bands on its face (utils/decoTile) */
  borders: FaceRect[];
}

export interface FixtureSolid {
  fixture: BEFixture;
  center: Pt;
  rotationDeg: number;
  widthIn: number;
  depthIn: number;
  /** Which of its sides stand against a wall, in its own frame (north = the back). */
  against: { north: boolean; south: boolean; east: boolean; west: boolean } | null;
  /** The room's ceiling height, for lights. */
  ceilingIn: number;
  /** A shower in its own room: the stretch of its front its door hangs in (the wall is the rest) */
  showerOpening?: [number, number] | null;
  /** A shower's own niches, drawn on its back wall (none when niches are drawn in its walls: those are in the walls) */
  nicheCount?: number;
}

export interface BathroomModel {
  walls: WallSolid[];
  floors: Pt[][];
  /** Decorative border round the floors, as runs (utils/decoTile) */
  floorBorders: [Pt, Pt][];
  fixtures: FixtureSolid[];
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number } | null;
  ceilingIn: number;
  looks: BathroomLooks;
}

/** A framed wall with drywall both sides, at least. */
export const WALL_THICKNESS_IN = 4.5;

// ── Looks ──

const TILE_COLORS: Record<string, string> = {
  porcelain: '#d6d1c7',
  ceramic: '#eeebe5',
  natural_stone: '#cbbfad',
  glass_mosaic: '#9fc2cb',
  glass: '#a7c7cf',
  mosaic: '#e6e2db',
  lvt_spc: '#b6987a',
};
const TILE_ROUGHNESS: Record<string, number> = {
  porcelain: 0.45,
  ceramic: 0.3,
  natural_stone: 0.6,
  glass_mosaic: 0.12,
  glass: 0.12,
  mosaic: 0.35,
  lvt_spc: 0.65,
};
const TOP_COLORS: Record<string, string> = {
  cultured_marble: '#f3f1ec',
  quartz: '#efeeea',
  granite: '#77736b',
  marble: '#ebe9e3',
  laminate: '#d7d0c3',
};
const METAL_COLORS: Record<string, string> = {
  chrome: '#c8cdd2',
  brushed_nickel: '#b8b3a8',
  matte_black: '#2a2a2a',
  brass: '#c4a14e',
  mixed: '#c8cdd2',
};

interface TileSpecLike {
  material?: string;
  size?: string;
  pattern?: string;
  customWidth?: number;
  customHeight?: number;
}

/** A tile size as the estimate writes it ("12x24", "3x6_subway", "1x1_mosaic"): long side first. */
export function parseTileSize(size: string | undefined, customWidth?: number, customHeight?: number) {
  if (size === 'custom' && customWidth && customHeight) {
    return { widthIn: Math.max(customWidth, customHeight), heightIn: Math.min(customWidth, customHeight), subway: false };
  }
  const m = /^(\d+(?:\.\d+)?)x(\d+(?:\.\d+)?)/.exec(size || '');
  if (!m) return null;
  const a = Number(m[1]);
  const b = Number(m[2]);
  return { widthIn: Math.max(a, b), heightIn: Math.min(a, b), subway: /subway/.test(size || '') };
}

/** How a tile spec looks, filling what it doesn't say from `fallback`. */
export function tileLook(spec: TileSpecLike | undefined | null, fallback: TileLook): TileLook {
  if (!spec) return fallback;
  const material = spec.material || fallback.material;
  const size = parseTileSize(spec.size, spec.customWidth, spec.customHeight);
  const widthIn = size?.widthIn ?? fallback.widthIn;
  const heightIn = size?.heightIn ?? fallback.heightIn;
  let pattern = spec.pattern || (size ? 'straight' : fallback.pattern);
  // Subway tile goes up in a running bond unless the spec says otherwise
  if (size?.subway && pattern === 'straight') pattern = 'subway';
  const color = material === fallback.material && !spec.material ? fallback.color : (TILE_COLORS[material] ?? fallback.color);
  const grout = material === 'natural_stone' || material === 'porcelain' ? '#a9a398' : '#d3cec5';
  const roughness = TILE_ROUGHNESS[material] ?? fallback.roughness;
  return {
    key: `${material}|${widthIn}x${heightIn}|${pattern}|${color}|${grout}`,
    material, widthIn, heightIn, pattern, color, grout, roughness,
  };
}

const look = (material: string, widthIn: number, heightIn: number, pattern: string, color: string, grout: string): TileLook => ({
  key: `${material}|${widthIn}x${heightIn}|${pattern}|${color}|${grout}`,
  material, widthIn, heightIn, pattern, color, grout, roughness: TILE_ROUGHNESS[material] ?? 0.4,
});

/**
 * The tub's fixed glass panel on the estimate (bathtub_spec glass_panel_*),
 * inches: detached and reset or new, it stands there after the job (the size
 * the backend prices when blank). Null without one.
 */
export function tubGlassPanelOf(estimate?: Record<string, any> | null): { widthIn: number; heightIn: number } | null {
  const tub = estimate?.bathtub_spec || {};
  return tub.glass_panel_action === 'detach_reset' || tub.glass_panel_action === 'replace'
    ? { widthIn: Number(tub.glass_panel_width_in) || 30, heightIn: Number(tub.glass_panel_height_in) || 58 }
    : null;
}

export const DEFAULT_LOOKS: BathroomLooks = {
  paint: '#efebe3',
  floor: look('porcelain', 24, 12, 'straight', '#cfcac0', '#a9a398'),
  floorPlain: '#c9c1b4',
  wallTile: look('ceramic', 6, 3, 'subway', '#f3f1ec', '#d3cec5'),
  showerTile: look('porcelain', 24, 12, 'straight', '#dad5cc', '#a9a398'),
  surroundTile: look('ceramic', 6, 3, 'subway', '#f3f1ec', '#d3cec5'),
  prefab: '#f5f4f0',
  vanityBox: '#f1eee8',
  vanityTop: TOP_COLORS.quartz,
  vanityFloating: false,
  china: '#f7f7f5',
  metal: METAL_COLORS.chrome,
  tubShower: false,
  tubGlassPanel: null,
  tubGlassDoors: null,
};

// A product's look.material (product library) as the tile looks name it
const PRODUCT_TILE_MATERIALS: Record<string, string> = {
  porcelain: 'porcelain', ceramic: 'ceramic', glass: 'glass_mosaic', vinyl: 'lvt_spc', wood: 'lvt_spc',
  natural_stone: 'natural_stone', marble: 'natural_stone', granite: 'natural_stone', quartzite: 'natural_stone',
};
const LAID_PATTERNS = new Set(['subway', 'herringbone', 'chevron', 'diagonal', 'basketweave']);

const hexColor = (v: unknown): string | undefined =>
  (typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v) ? v : undefined);

/**
 * A picked tile: its real size and colour, and its surface picture when it
 * has one, laid in the estimate's pattern (or the product's own subway or
 * herringbone when the estimate just says straight).
 */
export function productTileLook(p: BathroomSelection | undefined, specPattern: string | undefined, fallback: TileLook): TileLook | null {
  if (!p) return null;
  const material = PRODUCT_TILE_MATERIALS[String(p.look?.material ?? '')] ?? fallback.material;
  const size = p.tile_width_in && p.tile_length_in ? `${p.tile_width_in}x${p.tile_length_in}` : undefined;
  const own = String(p.look?.pattern ?? '');
  const pattern = (!specPattern || specPattern === 'straight') && LAID_PATTERNS.has(own) ? own : specPattern;
  const base = tileLook({ material, size, pattern }, fallback);
  const color = hexColor(p.look?.color) ?? base.color;
  const swatchFileId = p.swatch_file_id || undefined;
  return {
    ...base,
    color,
    swatchFileId,
    key: `${base.material}|${base.widthIn}x${base.heightIn}|${base.pattern}|${color}|${base.grout}|${swatchFileId ?? ''}`,
  };
}

/** A faucet's metal from its finish as sold ("Matte Black", "Brushed Nickel"…), else its colour. */
function productMetal(p: BathroomSelection | undefined): string | undefined {
  if (!p) return undefined;
  const finish = `${p.finish ?? ''} ${p.title}`.toLowerCase();
  if (/black/.test(finish)) return METAL_COLORS.matte_black;
  if (/nickel|stainless/.test(finish)) return METAL_COLORS.brushed_nickel;
  if (/gold|brass|bronze/.test(finish)) return METAL_COLORS.brass;
  if (/chrome/.test(finish)) return METAL_COLORS.chrome;
  return hexColor(p.look?.color);
}

const FLOOR_TILE_MATERIALS = new Set(['ceramic', 'porcelain', 'natural_stone', 'glass_mosaic', 'mosaic', 'glass']);

/** The looks the estimate's specs and the sketch's tile zones give the bathroom. */
export function bathroomLooks(sketch: BESketchData, estimate?: Record<string, any> | null): BathroomLooks {
  const zoneSpec = (type: string) => sketch.tileZones?.find((z) => z.type === type)?.tileSpec;
  const floorSpec = estimate?.floor_spec || {};
  const walls = estimate?.walls_spec || {};
  const shower = estimate?.shower_spec || {};
  const tub = estimate?.bathtub_spec || {};
  const vanity = estimate?.vanity_spec || {};
  const firstVanity = (Array.isArray(vanity.items) && vanity.items[0]) || vanity;
  // An option's picked products (a restoration has none)
  const picked: Record<string, BathroomSelection> = estimate?.selections || {};
  const showerWallTile = productTileLook(picked.shower_wall_tile, shower.tile_spec?.pattern, DEFAULT_LOOKS.showerTile);

  let floor: TileLook | null;
  if (floorSpec.material === 'lvt_spc') {
    // Plank flooring, staggered
    floor = tileLook({ material: 'lvt_spc', size: floorSpec.size || '7x48', pattern: 'subway' }, DEFAULT_LOOKS.floor!);
  } else if (floorSpec.material && !FLOOR_TILE_MATERIALS.has(floorSpec.material)) {
    floor = null;
  } else {
    floor = tileLook(floorSpec.material ? floorSpec : zoneSpec('floor'), DEFAULT_LOOKS.floor!);
  }
  floor = productTileLook(picked.floor_tile, floorSpec.pattern, floor ?? DEFAULT_LOOKS.floor!) ?? floor;

  return {
    ...DEFAULT_LOOKS,
    floor,
    wallTile: productTileLook(picked.wall_tile, walls.tile_pattern, DEFAULT_LOOKS.wallTile) ?? tileLook(
      walls.tile_material || walls.tile_size || walls.tile_pattern
        ? { material: walls.tile_material, size: walls.tile_size, pattern: walls.tile_pattern }
        : null,
      DEFAULT_LOOKS.wallTile,
    ),
    showerTile: showerWallTile ?? tileLook(shower.tile_spec || zoneSpec('shower_walls'), DEFAULT_LOOKS.showerTile),
    surroundTile: showerWallTile ?? tileLook(zoneSpec('tub_surround'), DEFAULT_LOOKS.surroundTile),
    prefab: hexColor(picked.bathtub?.look?.color) ?? DEFAULT_LOOKS.prefab,
    vanityBox: hexColor(picked.vanity?.look?.color) ?? DEFAULT_LOOKS.vanityBox,
    vanityTop: hexColor(picked.vanity_top?.look?.color)
      ?? TOP_COLORS[String(picked.vanity_top?.look?.material ?? '')]
      ?? TOP_COLORS[firstVanity?.top_material] ?? DEFAULT_LOOKS.vanityTop,
    vanityFloating: (firstVanity?.mounting ?? vanity.mounting) === 'wall_mount',
    china: hexColor(picked.toilet?.look?.color) ?? DEFAULT_LOOKS.china,
    metal: productMetal(picked.bath_faucet) ?? METAL_COLORS[estimate?.accessories_spec?.finish] ?? DEFAULT_LOOKS.metal,
    tubShower: shower.type === 'tub_combo'
      || (!sketch.fixtures.some((f) => f.type === 'shower')
        && sketch.fixtures.some((f) => f.type === 'bathtub' && f.properties.bathtubSubType !== 'freestanding'
          && f.properties.hasSurround !== false && (f.properties.surroundHeight ?? 60) >= 60)),
    tubGlassPanel: tubGlassPanelOf(estimate),
    tubGlassDoors: tub.glass_door_action === 'detach_reset' || tub.glass_door_action === 'replace'
      ? {
        heightIn: (tub.glass_door_frameless && Number(tub.glass_door_height_in)) || 58,
        frameless: !!tub.glass_door_frameless,
      }
      : null,
  };
}

// ── Geometry ──

const toIn = (p: BEPoint, ppf: number): Pt => [(p.x / ppf) * 12, (p.y / ppf) * 12];

/**
 * The unit normal from a wall into its room, or null if it's in none: the
 * side the room's outline is on (utils/wallFinish wallRoomNormal).
 */
export function wallInward(wall: BEWall, rooms: BERoom[]): Pt | null {
  const n = wallRoomNormal(wall, rooms);
  return n ? [n.x, n.y] : null;
}

const PREFAB_SHOWER_TYPES = new Set(['one_piece', 'multi_piece_kit', 'neo_angle_kit']);

function surroundFinish(fix: BEFixture, estimate?: Record<string, any> | null): 'tile' | 'prefab' {
  if (fix.type === 'shower') {
    const wallMaterial = fix.properties.showerWallMaterial;
    if (wallMaterial && wallMaterial !== 'tile') return 'prefab';
    return PREFAB_SHOWER_TYPES.has(estimate?.shower_spec?.type) ? 'prefab' : 'tile';
  }
  return fix.properties.hasSurround === false ? 'prefab' : 'tile';
}

function wallSolid(
  wall: BEWall,
  sketch: BESketchData,
  view: FinishView,
  estimate?: Record<string, any> | null,
): WallSolid {
  const ppf = sketch.settings.pixelsPerFoot;
  const lengthIn = wallLengthIn(wall, ppf);
  const heightIn = wall.heightInches;
  const clip = (r: FaceRect): FaceRect => ({
    x0: Math.max(0, r.x0), x1: Math.min(lengthIn, r.x1), y0: Math.max(0, r.y0), y1: Math.min(heightIn, r.y1),
  });
  const inward = wallInward(wall, sketch.rooms);
  const a = toIn(wall.start, ppf);
  const b = toIn(wall.end, ppf);
  const along = (p: Pt) => ((p[0] - a[0]) * (b[0] - a[0]) + (p[1] - a[1]) * (b[1] - a[1])) / (lengthIn || 1);
  // The entries of shower rooms tiled inside, front and all
  const tiledEntries = new Set(sketch.fixtures
    .filter((f) => f.type === 'shower' && showerFrontTiled(f, sketch.walls, sketch.fixtures, ppf))
    .map((f) => showerFrontOpening(f, sketch.walls, sketch.fixtures, ppf)?.openingId)
    .filter(Boolean));

  const openings: WallOpeningSolid[] = wallOpeningsOf(wall, sketch.fixtures, ppf).map((o) => {
    const { rect, fixture } = o;
    const r = clip(rect);
    if (isShowerGlassFront(o)) {
      return { rect: r, kind: 'open' as const, fixtureId: fixture.id, hingeAtStart: true, swingsIn: true };
    }
    // The plan's door hinges at the left end of its closed panel and swings to the side its symbol is on
    const rad = ((fixture.rotation || 0) * Math.PI) / 180;
    const hwIn = fixture.dimensions.width / 2;
    const hhIn = fixture.dimensions.height / 2;
    const c = toIn(fixture.position, ppf);
    const hinge: Pt = [c[0] + -hwIn * Math.cos(rad) - hhIn * Math.sin(rad), c[1] + -hwIn * Math.sin(rad) + hhIn * Math.cos(rad)];
    const hingeAlong = along(hinge);
    const side = inward ? (c[0] - a[0]) * inward[0] + (c[1] - a[1]) * inward[1] : 1;
    return {
      rect: r,
      kind: fixture.type as 'door' | 'window',
      fixtureId: fixture.id,
      hingeAtStart: Math.abs(hingeAlong - r.x0) <= Math.abs(hingeAlong - r.x1),
      swingsIn: side >= 0,
      ...(fixture.properties?.noSlab ? { noSlab: true } : {}),
      ...(fixture.properties?.doubleDoor && !fixture.properties?.noSlab ? { double: true } : {}),
      ...(tiledEntries.has(fixture.id) ? { tiledRound: true } : {}),
    };
  });
  // Each face: the room's (+z in the scene: the inward side, or the left
  // normal of a wall in no room), or the other. A tub or shower, or a niche,
  // is on the face it stands on: a shower room cut off the bathroom stands on
  // the far face of the bathroom's walls, its tile inside, not on the bathroom side.
  const normal: Pt = inward ?? [-(b[1] - a[1]) / (lengthIn || 1), (b[0] - a[0]) / (lengthIn || 1)];
  const onRoomFace = (fix: BEFixture) => {
    const c = toIn(fix.position, ppf);
    return (c[0] - a[0]) * normal[0] + (c[1] - a[1]) * normal[1] >= 0;
  };

  // A prefab surround stays itself, whatever tile is around it
  const covers = wallFixtureCovers(wall, sketch.fixtures, ppf)
    .map((c) => (surroundFinish(c.fixture, estimate) === 'prefab' ? { ...c, tiled: null } : c));
  const roomCovers = covers.filter((c) => onRoomFace(c.fixture));
  const backCovers = covers.filter((c) => !onRoomFace(c.fixture));

  // Niches: a tiled one lined with the tile of the tub or shower it's behind
  // (on its face), else the wall's; a drywall one painted
  const thicknessIn = Math.max(WALL_THICKNESS_IN, (wall.thickness / ppf) * 12);
  const niches: WallNicheSolid[] = wallNichesOf(wall, sketch.fixtures, ppf).map(({ rect, fixture }) => {
    const r = clip(rect);
    const mx = (r.x0 + r.x1) / 2;
    const my = (r.y0 + r.y1) / 2;
    const face: WallNicheSolid['face'] = onRoomFace(fixture) ? 'room' : 'back';
    const behind = (face === 'room' ? roomCovers : backCovers)
      .find((c) => mx > c.rect.x0 && mx < c.rect.x1 && my > c.rect.y0 && my < c.rect.y1);
    const lining: WallNicheSolid['lining'] = !nicheKind(fixture.properties.nicheType).tiled ? 'paint'
      : behind ? (behind.fixture.type === 'shower' ? 'shower' : 'tub') : 'wall';
    return { rect: r, fixtureId: fixture.id, depthIn: Math.min(NICHE_DEPTH_IN, thicknessIn - 0.75), lining, face };
  });
  const openingHoles = openings.map((o) => o.rect);
  // Each face's holes: the openings through the wall, and the niches in that face
  const roomHoles = openingHoles.concat(niches.filter((n) => n.face === 'room').map((n) => n.rect));
  const backHoles = openingHoles.concat(niches.filter((n) => n.face === 'back').map((n) => n.rect));
  const regions = wallTileRegions(wall, view === 'today' ? 'existing' : 'new', ppf).map(regionRect);
  // After the work, tile over a whole surround makes the wall one tile there,
  // down behind the tub too (out of sight, and not counted as tile): the
  // wall's tile is on its room face, so only there
  let kept = roomCovers;
  if (view === 'after') {
    const after = surroundsAfterWork(roomCovers, regions);
    kept = after.kept.filter((c) => !after.inTile.some((t) => t.fixture.id === c.fixture.id));
  }
  const surroundsOf = (list: typeof covers, faceHoles: FaceRect[]): WallSurroundSolid[] => list.flatMap(({ rect, fixture }) =>
    subtractRects([clip(rect)], faceHoles).map((piece) => ({ rect: piece, finish: surroundFinish(fixture, estimate), fixtureId: fixture.id })));
  const surrounds = surroundsOf(kept, roomHoles);
  const backSurrounds = surroundsOf(backCovers, backHoles);

  // A shower room's front tiled inside, on the face the shower is on
  for (const { rect, fixture } of showerFrontTiles(wall, sketch.fixtures, ppf, sketch.walls)) {
    const roomFace = onRoomFace(fixture);
    const pieces = subtractRects([clip(rect)], roomFace ? roomHoles : backHoles);
    (roomFace ? surrounds : backSurrounds).push(...pieces.map((piece) => ({ rect: piece, finish: 'tile' as const, fixtureId: fixture.id })));
  }

  return {
    id: wall.id,
    a,
    b,
    lengthIn,
    heightIn,
    thicknessIn,
    inward,
    pieces: subtractRects([{ x0: 0, x1: lengthIn, y0: 0, y1: heightIn }], openingHoles.concat(niches.map((n) => n.rect))),
    tile: subtractRects(regions, roomHoles.concat(kept.map((c) => clip(c.rect)))),
    surrounds,
    backSurrounds,
    openings,
    niches,
    borders: view === 'after'
      ? wallBorderRuns(wall, sketch.fixtures, ppf).map((r) => clip({
        x0: r.x0, x1: r.x1, y0: r.y - BORDER_BAND_IN / 2, y1: r.y + BORDER_BAND_IN / 2,
      }))
      : [],
  };
}

// The most a shower room's front is moved to meet its wall, inches: further
// off than this, it isn't that wall's shower
const FRONT_TO_WALL_MAX_IN = 12;

/**
 * A shower in its own room, its front met to the wall it stands against:
 * that wall's face on the shower's side (its line when the shower is in the
 * wall's room, the far face of its framing otherwise, as wallSolid builds
 * it). The plan places the shower by eye, a few inches short of the wall's
 * line or over it; drawn as placed, its floor, curb and door stopped short
 * of the tiled wall, a gap between. Its back stays where it is. Null when
 * it isn't a shower room, or is too far off to be.
 */
function showerFrontToWall(fix: BEFixture, sketch: BESketchData): { center: Pt; depthIn: number } | null {
  const ppf = sketch.settings.pixelsPerFoot;
  const opening = showerFrontOpening(fix, sketch.walls, sketch.fixtures, ppf);
  const wall = opening && sketch.walls.find((w) => w.id === opening.wallId);
  if (!wall) return null;
  const a = toIn(wall.start, ppf);
  const b = toIn(wall.end, ppf);
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
  const inward = wallInward(wall, sketch.rooms);
  const normal: Pt = inward ?? [-(b[1] - a[1]) / len, (b[0] - a[0]) / len];
  const thick = Math.max(WALL_THICKNESS_IN, (wall.thickness / ppf) * 12);
  const c = toIn(fix.position, ppf);
  const side = (c[0] - a[0]) * normal[0] + (c[1] - a[1]) * normal[1];
  // The face toward the shower, from the line: the framing goes away from its room
  const faceOff = !inward ? thick / 2 : side >= 0 ? 0 : thick;
  const delta = Math.abs(side) - faceOff - fix.dimensions.height / 2;
  if (Math.abs(delta) < 0.05 || Math.abs(delta) > FRONT_TO_WALL_MAX_IN) return null;
  // Its front, the way it faces (its own +y, turned)
  const rad = ((fix.rotation || 0) * Math.PI) / 180;
  const front: Pt = [-Math.sin(rad), Math.cos(rad)];
  return {
    center: [c[0] + (front[0] * delta) / 2, c[1] + (front[1] * delta) / 2],
    depthIn: fix.dimensions.height + delta,
  };
}

function fixtureSolid(fix: BEFixture, sketch: BESketchData): FixtureSolid {
  const ppf = sketch.settings.pixelsPerFoot;
  const room = sketch.rooms.find((r) => r.id === fix.roomId) ?? sketch.rooms.find((r) => !r.parentRoomId) ?? sketch.rooms[0];
  const wPx = (fix.dimensions.width / 12) * ppf;
  const hPx = (fix.dimensions.height / 12) * ppf;
  // Against its room's outline, or any wall along it: a shower in its own room
  // filed under the bathroom stands against the shower room's walls all the same
  const byRoom = findFixtureWallSides(fix, room, wPx, hPx);
  const byWalls = fixtureSidesAgainstWalls(fix, sketch.walls, ppf);
  const against = byRoom
    ? { north: byRoom.north || byWalls.north, south: byRoom.south || byWalls.south, east: byRoom.east || byWalls.east, west: byRoom.west || byWalls.west }
    : byWalls;
  // A shower room's floor, curb and door run to its wall's face
  const met = fix.type === 'shower' ? showerFrontToWall(fix, sketch) : null;
  return {
    fixture: fix,
    center: met?.center ?? toIn(fix.position, ppf),
    rotationDeg: fix.rotation || 0,
    widthIn: fix.dimensions.width,
    depthIn: met?.depthIn ?? fix.dimensions.height,
    against,
    ceilingIn: room?.heightInches || 96,
    showerOpening: fix.type === 'shower' ? showerFrontOpening(fix, sketch.walls, sketch.fixtures, ppf)?.span ?? null : null,
    ...(fix.type === 'shower' ? { nicheCount: showerNicheCount(fix, sketch.fixtures, ppf) } : {}),
  };
}

export function bathroomModel(
  sketch: BESketchData,
  estimate?: Record<string, any> | null,
  view: FinishView = 'after',
): BathroomModel {
  const ppf = sketch.settings.pixelsPerFoot;
  const walls = sketch.walls.map((w) => wallSolid(w, sketch, view, estimate));
  const floors = sketch.rooms
    .filter((r) => !r.parentRoomId && r.boundary.length >= 3)
    .map((r) => r.boundary.map((p) => toIn(p, ppf)));
  // Doors and windows are drawn in their walls' openings, niches in their walls
  const fixtures = sketch.fixtures
    .filter((f) => f.type !== 'door' && f.type !== 'window' && f.type !== 'niche')
    .map((f) => fixtureSolid(f, sketch));

  const xs: number[] = [];
  const zs: number[] = [];
  walls.forEach((w) => { xs.push(w.a[0], w.b[0]); zs.push(w.a[1], w.b[1]); });
  floors.forEach((f) => f.forEach(([x, z]) => { xs.push(x); zs.push(z); }));
  fixtures.forEach((f) => {
    const rad = (f.rotationDeg * Math.PI) / 180;
    for (const [lx, lz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      const x = (lx * f.widthIn) / 2;
      const z = (lz * f.depthIn) / 2;
      xs.push(f.center[0] + x * Math.cos(rad) - z * Math.sin(rad));
      zs.push(f.center[1] + x * Math.sin(rad) + z * Math.cos(rad));
    }
  });
  const bounds = xs.length
    ? { minX: Math.min(...xs), maxX: Math.max(...xs), minZ: Math.min(...zs), maxZ: Math.max(...zs) }
    : null;
  const ceilingIn = Math.max(96, ...sketch.walls.map((w) => w.heightInches));

  const floorBorders = view === 'after'
    ? sketch.rooms.flatMap((r) => floorBorderRuns(r, sketch.fixtures, ppf)
      .map(([a, b]): [Pt, Pt] => [toIn(a, ppf), toIn(b, ppf)]))
    : [];
  return { walls, floors, floorBorders, fixtures, bounds, ceilingIn, looks: bathroomLooks(sketch, estimate) };
}
