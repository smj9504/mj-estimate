/**
 * What a floor sketch says was torn out, for reading rather than editing: a row
 * per demolition zone with where it is, what it is and how big, and totals that
 * add up the way the job's generated scope does
 * (generate_scope_from_sketch in backend sketch_service.py).
 *
 * Zones hold no link to a room. Where one is comes from where it is drawn over
 * the rooms on the plan; a floor with no rooms drawn has only the zone's own
 * label and its position on the plan.
 *
 * Pure functions over plain data, safe for useMemo and unit tests.
 */

import type { DemoSurface, WMDemolitionZone, WMFloorSketch, WMRoom } from '../../../../types/wmSketch';
import {
  DEFAULT_DEMO_MATERIAL_TYPES,
  EA_ITEM_PIXEL_SIZES,
  EA_MATERIAL_IDS,
  TRIM_REMOVAL_MATERIAL_IDS,
  TRIM_SIZE_MATERIAL_IDS,
  TRIM_SIZE_SUB_TYPES,
  WALL_MATERIAL_IDS,
  WALL_MATERIAL_SUB_TYPES,
  WOOD_FLOOR_SUB_TYPES,
  calcTrimLF,
  getEffectiveRenderMode,
} from '../../../../types/wmSketch';
import { formatDimensionCompact } from './wmCalculations';
import { pointInPolygon, type Point } from './sketchGeometry';

export type DemoUnit = 'SF' | 'LF' | 'EA';

/** Where a zone sits on the canvas, in canvas pixels */
export type DemoGeometry =
  | { kind: 'polygon'; points: Point[] }
  | { kind: 'line'; from: Point; to: Point }
  /** A box rotates about its top-left corner, as the canvas draws it */
  | { kind: 'box'; x: number; y: number; width: number; height: number; rotation: number };

/** Something torn out along with a zone: carpet pad under carpet, baseboard along a wall */
export interface DemoAddOn {
  name: string;
  quantity: number;
  unit: DemoUnit;
}

export interface DemoRow {
  id: string;
  /** Shown on the list and the plan; runs down the list, per floor */
  number: number;
  /** Rooms the zone is drawn over, most of it first */
  rooms: string[];
  /** The zone's own label from the sketch */
  label?: string;
  name: string;
  surface: DemoSurface;
  color: string;
  quantity: number;
  unit: DemoUnit;
  /** Its size in words, e.g. 12' × 10'6" */
  measurement?: string;
  addOns: DemoAddOn[];
  /** Drawn but never given a size, so it is not in the totals */
  unmeasured: boolean;
  geometry: DemoGeometry;
  /** Where its number sits on the plan */
  anchor: Point;
}

export interface DemoRowGroup {
  /** The room, or the zone's label on a floor with no room under it; null when neither */
  location: string | null;
  rows: DemoRow[];
}

export interface DemoTotal {
  name: string;
  quantity: number;
  unit: DemoUnit;
}

export interface DemoFloorTakeoff {
  floor: WMFloorSketch;
  rows: DemoRow[];
  groups: DemoRowGroup[];
  totals: DemoTotal[];
  unmeasuredCount: number;
}

/** How far a zone on a wall can sit from a room's edge and still count as on that wall */
const WALL_REACH_FT = 1;
/** Under this share of its area in a room, a zone is only clipping that room */
const MIN_ROOM_SHARE = 0.15;
/** Samples per side when measuring how much of a zone is in each room */
const AREA_SAMPLES = 9;
/** A wall's height when the sketch never set one, as the demolition panel assumes */
const DEFAULT_WALL_HEIGHT_FT = 8;
const DEFAULT_WALL_SUB_TYPE = 'drywall';
const DEFAULT_SCALE = 20;

const SURFACE_ORDER: Record<string, number> = { ceiling: 0, wall: 1, floor: 2 };

const BASEBOARD_ADD_ONS: Record<string, string[]> = {
  baseboard: ['Baseboard'],
  quarter_round: ['Quarter Round'],
  baseboard_quarter_round: ['Baseboard', 'Quarter Round'],
};

const num = (value: unknown): number => {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};

const round2 = (n: number) => Math.round(n * 100) / 100;

const materialOf = (zone: WMDemolitionZone) =>
  DEFAULT_DEMO_MATERIAL_TYPES.find((m) => m.id === zone.material_type);

const humanizeId = (id: string) =>
  id.split('_').filter(Boolean).map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ') || 'Demolition';

/** The zone's type as the job's scope names it, e.g. Wood Floor (Hardwood) */
function typeName(zone: WMDemolitionZone): string {
  const base = materialOf(zone)?.name ?? humanizeId(zone.material_type || '');
  const sub = zone.sub_type;
  if (!sub) return base;
  if (zone.material_type === 'wood_floor') {
    return `${base} (${WOOD_FLOOR_SUB_TYPES.find((s) => s.id === sub)?.name ?? humanizeId(sub)})`;
  }
  if (WALL_MATERIAL_IDS.has(zone.material_type)) {
    // Every drywall type is drywall unless it says otherwise
    if (sub === DEFAULT_WALL_SUB_TYPE) return base;
    return `${base} (${WALL_MATERIAL_SUB_TYPES.find((s) => s.id === sub)?.name ?? humanizeId(sub)})`;
  }
  if (TRIM_SIZE_MATERIAL_IDS.has(zone.material_type)) {
    return `${base} (${TRIM_SIZE_SUB_TYPES.find((s) => s.id === sub)?.name ?? humanizeId(sub)})`;
  }
  return base;
}

function drawnAs(zone: WMDemolitionZone): 'polygon' | 'line' | 'box' {
  if ((zone.polygon_points?.length ?? 0) >= 3) return 'polygon';
  const mat = materialOf(zone);
  const mode = zone.render_mode ?? (mat ? getEffectiveRenderMode(mat) : 'area');
  return mode === 'line' ? 'line' : 'box';
}

export function demoGeometry(zone: WMDemolitionZone, scale: number): DemoGeometry {
  const x = num(zone.x);
  const y = num(zone.y);
  const rotation = num(zone.rotation);
  const d1 = num(zone.dimension1_ft);
  const d2 = num(zone.dimension2_ft);

  const shape = drawnAs(zone);
  if (shape === 'polygon') {
    // Stored relative to the zone's origin
    return {
      kind: 'polygon',
      points: zone.polygon_points!.map((p) => ({ x: x + num(p.x), y: y + num(p.y) })),
    };
  }
  if (shape === 'line') {
    const length = d1 * scale;
    const rad = (rotation * Math.PI) / 180;
    return {
      kind: 'line',
      from: { x, y },
      to: { x: x + length * Math.cos(rad), y: y + length * Math.sin(rad) },
    };
  }

  // Same order as the canvas: fixed-size markers, then real measurements, then
  // the size it was dragged at before anyone measured it
  if (EA_MATERIAL_IDS.has(zone.material_type)) {
    const sizes = EA_ITEM_PIXEL_SIZES[zone.material_type] ?? {};
    const size = sizes[zone.sub_type || ''] ?? sizes[''] ?? { w: 36, h: 36 };
    return { kind: 'box', x, y, width: size.w, height: size.h, rotation };
  }
  if (d1 > 0 && d2 > 0) return { kind: 'box', x, y, width: d1 * scale, height: d2 * scale, rotation };
  return {
    kind: 'box',
    x,
    y,
    width: num(zone.pixel_width) || 60,
    height: num(zone.pixel_height) || 40,
    rotation,
  };
}

function boxPoint(box: Extract<DemoGeometry, { kind: 'box' }>, along: number, down: number): Point {
  const rad = (box.rotation * Math.PI) / 180;
  const dx = box.width * along;
  const dy = box.height * down;
  return {
    x: box.x + dx * Math.cos(rad) - dy * Math.sin(rad),
    y: box.y + dx * Math.sin(rad) + dy * Math.cos(rad),
  };
}

/** The corners and ends of a zone, for fitting the plan around it */
export function geometryPoints(geometry: DemoGeometry): Point[] {
  if (geometry.kind === 'polygon') return geometry.points;
  if (geometry.kind === 'line') return [geometry.from, geometry.to];
  return [boxPoint(geometry, 0, 0), boxPoint(geometry, 1, 0), boxPoint(geometry, 1, 1), boxPoint(geometry, 0, 1)];
}

/** Evenly spread points inside a floor or ceiling zone */
function areaSamples(geometry: DemoGeometry): Point[] {
  const samples: Point[] = [];
  if (geometry.kind === 'box') {
    for (let i = 0; i < AREA_SAMPLES; i++) {
      for (let j = 0; j < AREA_SAMPLES; j++) {
        samples.push(boxPoint(geometry, (i + 0.5) / AREA_SAMPLES, (j + 0.5) / AREA_SAMPLES));
      }
    }
  } else if (geometry.kind === 'polygon') {
    const xs = geometry.points.map((p) => p.x);
    const ys = geometry.points.map((p) => p.y);
    const minX = Math.min(...xs);
    const minY = Math.min(...ys);
    const width = Math.max(...xs) - minX;
    const height = Math.max(...ys) - minY;
    for (let i = 0; i < AREA_SAMPLES; i++) {
      for (let j = 0; j < AREA_SAMPLES; j++) {
        const p = {
          x: minX + (width * (i + 0.5)) / AREA_SAMPLES,
          y: minY + (height * (j + 0.5)) / AREA_SAMPLES,
        };
        if (pointInPolygon(p, geometry.points)) samples.push(p);
      }
    }
  }
  return samples;
}

function distanceToSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

function distanceToBoundary(p: Point, boundary: Point[]): number {
  let nearest = Infinity;
  for (let i = 0, j = boundary.length - 1; i < boundary.length; j = i++) {
    nearest = Math.min(nearest, distanceToSegment(p, boundary[j], boundary[i]));
  }
  return nearest;
}

/**
 * Rooms at a point on a wall or a marker. Near an edge that means every room on
 * that wall, so a wall between two rooms names both.
 */
function roomsAtPoint(p: Point, rooms: WMRoom[], wallReach: number): WMRoom[] {
  const onWall = rooms.filter((r) => distanceToBoundary(p, r.boundary) <= wallReach);
  if (onWall.length > 0) return onWall;
  return rooms.filter((r) => pointInPolygon(p, r.boundary));
}

/** Rooms a zone is drawn over, most of it first */
export function roomsOfZone(geometry: DemoGeometry, rooms: WMRoom[], scale: number): string[] {
  const usable = rooms.filter((r) => (r.boundary?.length ?? 0) >= 3);
  if (usable.length === 0) return [];
  const name = (r: WMRoom) => r.name?.trim() || 'Unnamed room';
  const wallReach = WALL_REACH_FT * scale;

  const samples = areaSamples(geometry);
  // A floor or ceiling area big enough to sample is shared out by how much of it
  // lies in each room. Lines and small markers go by what they touch.
  if (geometry.kind === 'polygon' || (geometry.kind === 'box' && Math.min(geometry.width, geometry.height) > 2 * wallReach)) {
    const shares = usable
      .map((room) => ({
        room,
        share: samples.length ? samples.filter((p) => pointInPolygon(p, room.boundary)).length / samples.length : 0,
      }))
      .filter((s) => s.share >= MIN_ROOM_SHARE)
      .sort((a, b) => b.share - a.share);
    if (shares.length > 0) return shares.map((s) => name(s.room));
  }

  const along = geometry.kind === 'line'
    ? [0.25, 0.5, 0.75].map((t) => ({
      x: geometry.from.x + (geometry.to.x - geometry.from.x) * t,
      y: geometry.from.y + (geometry.to.y - geometry.from.y) * t,
    }))
    : [anchorOf(geometry)];
  const found = new Set<WMRoom>();
  along.forEach((p) => roomsAtPoint(p, usable, wallReach).forEach((r) => found.add(r)));
  return usable.filter((r) => found.has(r)).map(name);
}

function anchorOf(geometry: DemoGeometry): Point {
  if (geometry.kind === 'line') {
    return { x: (geometry.from.x + geometry.to.x) / 2, y: (geometry.from.y + geometry.to.y) / 2 };
  }
  if (geometry.kind === 'box') return boxPoint(geometry, 0.5, 0.5);
  const samples = areaSamples(geometry);
  const points = samples.length > 0 ? samples : geometry.points;
  const mean = {
    x: points.reduce((s, p) => s + p.x, 0) / points.length,
    y: points.reduce((s, p) => s + p.y, 0) / points.length,
  };
  // The middle of an L-shaped area can be outside it, so take the nearest point in it
  return points.reduce(
    (best, p) => (Math.hypot(p.x - mean.x, p.y - mean.y) < Math.hypot(best.x - mean.x, best.y - mean.y) ? p : best),
    points[0],
  );
}

function sizeInWords(zone: WMDemolitionZone, shape: ReturnType<typeof drawnAs>): string | undefined {
  const d1 = num(zone.dimension1_ft);
  const d2 = num(zone.dimension2_ft);
  const mat = materialOf(zone);

  if (TRIM_SIZE_MATERIAL_IDS.has(zone.material_type)) {
    const parts: string[] = [];
    const size = TRIM_SIZE_SUB_TYPES.find((s) => s.id === zone.sub_type);
    if (size) parts.push(size.description);
    if (TRIM_REMOVAL_MATERIAL_IDS.has(zone.material_type) && zone.trim_removal && zone.trim_removal !== 'full') {
      parts.push(zone.trim_removal === 'custom' ? 'custom length' : `${zone.trim_removal} removed`);
    }
    return parts.join(', ') || undefined;
  }
  if (EA_MATERIAL_IDS.has(zone.material_type)) return undefined;
  if (shape === 'polygon') return 'Irregular area';
  // Its quantity already is its length
  if (mat?.unit === 'LF') return undefined;
  if (mat?.surface === 'wall') {
    if (d1 <= 0) return undefined;
    const height = num(zone.height_ft) || d2 || DEFAULT_WALL_HEIGHT_FT;
    return `${formatDimensionCompact(d1)} long × ${formatDimensionCompact(height)} high`;
  }
  return d1 > 0 && d2 > 0 ? `${formatDimensionCompact(d1)} × ${formatDimensionCompact(d2)}` : undefined;
}

function addOnsOf(zone: WMDemolitionZone, quantity: number): DemoAddOn[] {
  const addOns: DemoAddOn[] = [];
  const wallLength = num(zone.dimension1_ft);
  if (quantity > 0) {
    if (zone.material_type === 'carpet' && zone.include_pad) {
      addOns.push({ name: 'Carpet Pad', quantity, unit: 'SF' });
    }
    if (zone.include_insulation) addOns.push({ name: 'Insulation', quantity, unit: 'SF' });
    if (zone.glue_down) {
      addOns.push({
        name: zone.material_type === 'carpet' ? 'Glue Down Carpet Removal' : 'Glue Down Floor Removal',
        quantity,
        unit: 'SF',
      });
    }
  }
  if (wallLength > 0) {
    (BASEBOARD_ADD_ONS[zone.baseboard_type ?? ''] ?? []).forEach((name) => {
      addOns.push({ name, quantity: wallLength, unit: 'LF' });
    });
    if (zone.include_crown_molding) addOns.push({ name: 'Crown Molding', quantity: wallLength, unit: 'LF' });
  }
  return addOns;
}

function rowOf(zone: WMDemolitionZone, floor: WMFloorSketch, scale: number): DemoRow {
  const isTrim = TRIM_REMOVAL_MATERIAL_IDS.has(zone.material_type);
  // Trim is sold by the foot however it was placed, which is how the scope counts it
  const quantity = isTrim
    ? calcTrimLF(zone.material_type, zone.sub_type, zone.trim_removal, num(zone.trim_lf))
    : num(zone.calculated_sqft);
  const unit: DemoUnit = isTrim ? 'LF' : (materialOf(zone)?.unit ?? 'SF');
  const geometry = demoGeometry(zone, scale);
  return {
    id: zone.id,
    number: 0,
    rooms: roomsOfZone(geometry, floor.overlay_data.rooms ?? [], scale),
    label: zone.label?.trim() || undefined,
    name: typeName(zone),
    surface: zone.surface,
    color: zone.color || materialOf(zone)?.color || '#888888',
    quantity: round2(quantity),
    unit,
    measurement: sizeInWords(zone, drawnAs(zone)),
    addOns: addOnsOf(zone, quantity).map((a) => ({ ...a, quantity: round2(a.quantity) })),
    unmeasured: quantity <= 0,
    geometry,
    anchor: anchorOf(geometry),
  };
}

const materialRank = (zone: WMDemolitionZone) => {
  const index = DEFAULT_DEMO_MATERIAL_TYPES.findIndex((m) => m.id === zone.material_type);
  return index === -1 ? DEFAULT_DEMO_MATERIAL_TYPES.length : index;
};

/** Add quantities up by type, by name so a type is easy to find and pad sits with carpet */
export function addUpTotals(items: DemoTotal[]): DemoTotal[] {
  const totals = new Map<string, DemoTotal>();
  items.forEach((item) => {
    const key = `${item.name}|${item.unit}`;
    const seen = totals.get(key);
    if (seen) seen.quantity = round2(seen.quantity + item.quantity);
    else totals.set(key, { ...item, quantity: round2(item.quantity) });
  });
  return Array.from(totals.values()).sort((a, b) => a.name.localeCompare(b.name));
}

export function floorTakeoff(floor: WMFloorSketch): DemoFloorTakeoff {
  const scale = num(floor.scale_pixels_per_foot) || DEFAULT_SCALE;
  const zones = [...(floor.overlay_data.demolition_zones ?? [])].sort((a, b) => (
    (SURFACE_ORDER[a.surface] ?? 3) - (SURFACE_ORDER[b.surface] ?? 3)
    || materialRank(a) - materialRank(b)
    || num(a.display_order) - num(b.display_order)
  ));
  const unordered = zones.map((zone) => rowOf(zone, floor, scale));

  // Rooms in plan order, then shared ones after the room they mostly belong to,
  // then anything with no room under it
  const roomOrder = (floor.overlay_data.rooms ?? []).map((r) => r.name?.trim() || 'Unnamed room');
  const locationOf = (row: DemoRow) => row.rooms.join(' / ') || row.label || null;
  const rank = (row: DemoRow) => {
    if (row.rooms.length === 0) return row.label ? roomOrder.length : roomOrder.length + 1;
    const index = roomOrder.indexOf(row.rooms[0]);
    return (index === -1 ? roomOrder.length : index) + (row.rooms.length > 1 ? 0.5 : 0);
  };
  const byLocation = new Map<string | null, DemoRow[]>();
  [...unordered]
    .map((row, i) => ({ row, i }))
    .sort((a, b) => rank(a.row) - rank(b.row) || a.i - b.i)
    .forEach(({ row }) => {
      const location = locationOf(row);
      byLocation.set(location, [...(byLocation.get(location) ?? []), row]);
    });

  let number = 0;
  const groups: DemoRowGroup[] = Array.from(byLocation.entries()).map(([location, groupRows]) => ({
    location,
    rows: groupRows.map((row) => {
      number += 1;
      return { ...row, number };
    }),
  }));
  const rows = groups.flatMap((g) => g.rows);

  return {
    floor,
    rows,
    groups,
    totals: addUpTotals(rows.flatMap((row) => [
      ...(row.unmeasured ? [] : [{ name: row.name, quantity: row.quantity, unit: row.unit }]),
      ...row.addOns,
    ])),
    unmeasuredCount: rows.filter((row) => row.unmeasured).length,
  };
}

/**
 * Where to draw each number on the plan. A baseboard and the wall above it share
 * a midpoint, so a number that would land on an earlier one steps aside.
 */
export function spreadNumbers(rows: Pick<DemoRow, 'id' | 'anchor'>[], radius: number): Map<string, Point> {
  const gap = radius * 2.1;
  const steps = [
    [0, 0], [1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1], [2, 0], [-2, 0], [0, 2], [0, -2],
  ];
  const placed: Point[] = [];
  const spots = new Map<string, Point>();
  rows.forEach(({ id, anchor }) => {
    const spot = steps
      .map(([dx, dy]) => ({ x: anchor.x + dx * gap, y: anchor.y + dy * gap }))
      .find((p) => placed.every((q) => Math.hypot(p.x - q.x, p.y - q.y) >= gap)) ?? anchor;
    placed.push(spot);
    spots.set(id, spot);
  });
  return spots;
}

/** A quantity with its unit: 1,024.5 SF, 3 EA */
export function formatDemoQuantity(quantity: number, unit: DemoUnit): string {
  const digits = unit === 'EA' ? 0 : 2;
  return `${quantity.toLocaleString('en-US', { maximumFractionDigits: digits })} ${unit}`;
}
