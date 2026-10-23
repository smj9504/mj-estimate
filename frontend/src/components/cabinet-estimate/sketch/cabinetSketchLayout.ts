/**
 * Layout model behind the cabinet sketch: keeps the placed shapes in step
 * with the Edit tab's box list, and derives the front elevations from the
 * floor plan.
 *
 * The Edit tab is the source of truth for *which* cabinets exist; the
 * sketch only owns *where* they sit. Boxes carry no stable id, so a sketch
 * shape is matched to a box by identity key (location + code + size) and
 * counted — 2 × B30 in the list means two B30 shapes on the canvas.
 *
 * Geometry convention (see CabinetSketchCabinet): (x, y) is the back-left
 * corner, the back edge is local y = 0, doors face local +y. With rotation
 * r, the run axis is ux = (cos r, sin r) and the back points along
 * back = (sin r, -cos r). Standing in front of a cabinet and facing it you
 * look along `back`, with +ux to your right — which is what the elevation
 * view draws left to right.
 *
 * Pure functions only, so the presets catalog is passed in rather than
 * imported (it lives in a .tsx component).
 */

import type { CabinetLocation, CabType, SpecialtyType } from '../../../types/cabinetEstimate';
import type { CabinetSketchCabinet, CabinetSketchWall } from '../../../types/cabinetSketch';
import { generateOverlayId } from './cabinetSketchUtils';

export interface PresetDims {
  width: number;
  height: number;
  specialty?: SpecialtyType;
}
export type PresetCatalog = Record<string, PresetDims>;

/** The fields of an Edit-tab box the sketch cares about. */
export interface SketchBoxSource {
  code: string;
  cab_type: CabType;
  location: CabinetLocation;
  width_inches: number;
  height_inches: number;
  specialty_type?: SpecialtyType | null;
  qty: number;
}

interface Pt {
  x: number;
  y: number;
}

/** Standard bottom of a 30"+ upper: 36" counter + 18" backsplash gap. */
export const UPPER_BOTTOM_IN = 54;
/** Where a new island run's back line sits, measured off the perimeter run: 24" base + 42" aisle. */
export const ISLAND_OFFSET_IN = 66;
/** How close (feet) a dragged cabinet's back edge must come to a wall to snap onto it. */
const WALL_SNAP_FT = 1.5;
/** How far apart (inches) two cabinets' facing sides may be and still butt together. */
const NEIGHBOR_SNAP_GAP_IN = 6;
/** How far out of line (inches) two backs may be for a cabinet to be levelled with its neighbour. */
const NEIGHBOR_SNAP_BACK_IN = 12;
/** A cabinet turned less than this off its neighbour is squared up to it. */
const NEIGHBOR_SNAP_ANGLE_DEG = 10;
/** Two cabinets share an elevation if their back lines are within this (inches). */
const RUN_BACK_TOLERANCE_IN = 6;
const ANGLE_TOLERANCE_DEG = 3;

// ---------------------------------------------------------------------------
// Units and vectors
// ---------------------------------------------------------------------------

export const pxToIn = (px: number, scalePixelsPerFoot: number) =>
  scalePixelsPerFoot > 0 ? (px * 12) / scalePixelsPerFoot : 0;
export const inToPx = (inches: number, scalePixelsPerFoot: number) => (inches / 12) * scalePixelsPerFoot;

const dot = (a: Pt, b: Pt) => a.x * b.x + a.y * b.y;
const add = (a: Pt, b: Pt): Pt => ({ x: a.x + b.x, y: a.y + b.y });
const scale = (a: Pt, k: number): Pt => ({ x: a.x * k, y: a.y * k });
const sub = (a: Pt, b: Pt): Pt => ({ x: a.x - b.x, y: a.y - b.y });

function axes(rotationDeg: number): { ux: Pt; back: Pt } {
  const r = (rotationDeg * Math.PI) / 180;
  return { ux: { x: Math.cos(r), y: Math.sin(r) }, back: { x: Math.sin(r), y: -Math.cos(r) } };
}

/** Rotation (degrees) that points a cabinet's back along `back`. */
function rotationForBack(back: Pt): number {
  const ux = { x: -back.y, y: back.x };
  return (Math.atan2(ux.y, ux.x) * 180) / Math.PI;
}

function angleDiffDeg(a: number, b: number): number {
  const d = (((a - b) % 360) + 540) % 360 - 180;
  return Math.abs(d);
}

// ---------------------------------------------------------------------------
// Real-world cabinet size
// ---------------------------------------------------------------------------

/** Box depth: uppers are 12" except the 24"-deep one over a refrigerator. */
export function cabinetDepthIn(cabType: CabType, specialty?: SpecialtyType | null): number {
  if (cabType === 'wall') return specialty === 'refrigerator_wall_deep' ? 24 : 12;
  return 24;
}

/** Inches of a sketch shape, falling back to the catalog for sketches saved before the sync. */
export function cabinetSizeIn(
  cabinet: CabinetSketchCabinet,
  presets: PresetCatalog,
  scalePixelsPerFoot: number
): { width: number; depth: number; height: number } {
  const preset = presets[cabinet.preset_code];
  const width = cabinet.width_in ?? preset?.width ?? pxToIn(cabinet.width, scalePixelsPerFoot);
  const height =
    cabinet.height_in ?? preset?.height ?? (cabinet.cab_type === 'wall' ? 30 : cabinet.cab_type === 'tall' ? 84 : 34.5);
  const depth = cabinet.depth_in ?? cabinetDepthIn(cabinet.cab_type, preset?.specialty);
  return { width, depth, height };
}

/**
 * Height of each cabinet's bottom above the floor, in inches.
 *
 * Bases and talls stand on the floor. Uppers 30" and taller hang at the
 * standard 54"; shorter ones (over a fridge, range or OTR microwave) are
 * hung so their tops line up with the tallest regular upper in the same
 * location. Kept here, not in the elevation view, so a 3D view can reuse it.
 */
export function mountHeightsIn(
  cabinets: CabinetSketchCabinet[],
  presets: PresetCatalog,
  scalePixelsPerFoot: number
): Map<string, number> {
  const topLine = new Map<string, number>();
  for (const c of cabinets) {
    if (c.cab_type !== 'wall') continue;
    const h = cabinetSizeIn(c, presets, scalePixelsPerFoot).height;
    if (h < 30) continue;
    const loc = c.location ?? 'perimeter';
    topLine.set(loc, Math.max(topLine.get(loc) ?? 0, UPPER_BOTTOM_IN + h));
  }

  const out = new Map<string, number>();
  for (const c of cabinets) {
    if (c.cab_type !== 'wall') {
      out.set(c.id, 0);
      continue;
    }
    const h = cabinetSizeIn(c, presets, scalePixelsPerFoot).height;
    const top = topLine.get(c.location ?? 'perimeter') ?? UPPER_BOTTOM_IN + 30;
    out.set(c.id, h >= 30 ? UPPER_BOTTOM_IN : top - h);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Sync with the Edit tab
// ---------------------------------------------------------------------------

const fmt = (n: number) => String(Math.round(n * 100) / 100);

export function boxKey(box: Pick<SketchBoxSource, 'location' | 'code' | 'cab_type' | 'width_inches' | 'height_inches'>) {
  return `${box.location}|${box.code}|${box.cab_type}|${fmt(box.width_inches)}x${fmt(box.height_inches)}`;
}

export function cabinetKey(cabinet: CabinetSketchCabinet, presets: PresetCatalog, scalePixelsPerFoot: number) {
  const { width, height } = cabinetSizeIn(cabinet, presets, scalePixelsPerFoot);
  return boxKey({
    location: cabinet.location ?? 'perimeter',
    code: cabinet.preset_code,
    cab_type: cabinet.cab_type,
    width_inches: width,
    height_inches: height,
  });
}

/** A run's back line: where its first cabinet's back-left corner goes, and which way it faces. */
interface RunAnchor {
  origin: Pt;
  ux: Pt;
  back: Pt;
}

/**
 * Where an auto-placed run starts. With walls drawn, cabinets go along the
 * inside face of the longest wall ("inside" = away from the centroid of
 * all the wall endpoints). With no walls, a north-backed run near the top
 * left of the canvas.
 */
export function perimeterAnchor(walls: CabinetSketchWall[], scalePixelsPerFoot: number): RunAnchor {
  const longest = walls.reduce<CabinetSketchWall | null>((best, w) => {
    const len = Math.hypot(w.end_x - w.start_x, w.end_y - w.start_y);
    const bestLen = best ? Math.hypot(best.end_x - best.start_x, best.end_y - best.start_y) : 0;
    return len > bestLen ? w : best;
  }, null);

  if (!longest || Math.hypot(longest.end_x - longest.start_x, longest.end_y - longest.start_y) < 1) {
    return {
      origin: { x: 2 * scalePixelsPerFoot, y: 2 * scalePixelsPerFoot },
      ux: { x: 1, y: 0 },
      back: { x: 0, y: -1 },
    };
  }

  const start = { x: longest.start_x, y: longest.start_y };
  const end = { x: longest.end_x, y: longest.end_y };
  const len = Math.hypot(end.x - start.x, end.y - start.y);
  const dir = scale(sub(end, start), 1 / len);
  const normal = { x: -dir.y, y: dir.x };

  const pts = walls.flatMap((w) => [
    { x: w.start_x, y: w.start_y },
    { x: w.end_x, y: w.end_y },
  ]);
  const centroid = scale(pts.reduce(add, { x: 0, y: 0 }), 1 / pts.length);
  const mid = scale(add(start, end), 0.5);
  // The back points at the wall, i.e. away from the room's middle.
  const back = dot(sub(centroid, mid), normal) > 0 ? scale(normal, -1) : normal;
  const ux = { x: -back.y, y: back.x };

  const runStart = dot(start, ux) <= dot(end, ux) ? start : end;
  const inset = (longest.thickness || 0) / 2;
  return { origin: sub(runStart, scale(back, inset)), ux, back };
}

function islandAnchor(perimeter: RunAnchor, scalePixelsPerFoot: number): RunAnchor {
  return {
    ...perimeter,
    origin: sub(perimeter.origin, scale(perimeter.back, inToPx(ISLAND_OFFSET_IN, scalePixelsPerFoot))),
  };
}

const rowOf = (location: CabinetLocation, cabType: CabType) =>
  `${location}|${cabType === 'wall' ? 'upper' : 'lower'}`;

/**
 * Bring the sketch's shapes in line with the Edit tab's boxes.
 *
 * - Shapes that still match a box keep their position (and get their
 *   inch fields / footprint refreshed — older sketches drew depth from the
 *   cabinet's height).
 * - Shapes with no box left are dropped.
 * - Boxes with no shape yet get one, appended to the end of their row
 *   (bases then talls along the floor, uppers along the same back line,
 *   island as a parallel run).
 *
 * Returns `null` when nothing needs to change, so callers can skip a
 * dispatch and avoid a render loop.
 */
export function reconcileCabinets(
  cabinets: CabinetSketchCabinet[],
  boxes: SketchBoxSource[],
  walls: CabinetSketchWall[],
  presets: PresetCatalog,
  scalePixelsPerFoot: number
): CabinetSketchCabinet[] | null {
  // How many shapes each key needs, and the box to build missing ones from.
  const needed = new Map<string, { count: number; box: SketchBoxSource }>();
  for (const box of boxes) {
    const qty = Math.max(0, Math.floor(box.qty || 0));
    if (qty === 0) continue;
    const key = boxKey(box);
    const entry = needed.get(key);
    if (entry) entry.count += qty;
    else needed.set(key, { count: qty, box });
  }

  let changed = false;
  const used = new Map<string, number>();
  const kept: CabinetSketchCabinet[] = [];

  for (const c of cabinets) {
    const key = cabinetKey(c, presets, scalePixelsPerFoot);
    const entry = needed.get(key);
    const n = used.get(key) ?? 0;
    if (!entry || n >= entry.count) {
      changed = true;
      continue;
    }
    used.set(key, n + 1);

    const box = entry.box;
    const depth = cabinetDepthIn(box.cab_type, box.specialty_type);
    const refreshed: CabinetSketchCabinet = {
      ...c,
      location: box.location,
      width_in: box.width_inches,
      depth_in: depth,
      height_in: box.height_inches,
      width: inToPx(box.width_inches, scalePixelsPerFoot),
      height: inToPx(depth, scalePixelsPerFoot),
    };
    if (
      refreshed.location !== c.location ||
      refreshed.width_in !== c.width_in ||
      refreshed.depth_in !== c.depth_in ||
      refreshed.height_in !== c.height_in ||
      Math.abs(refreshed.width - c.width) > 0.01 ||
      Math.abs(refreshed.height - c.height) > 0.01
    ) {
      changed = true;
    }
    kept.push(refreshed);
  }

  // Missing shapes, in placement order: lower row bases first, then talls.
  const missing: SketchBoxSource[] = [];
  const typeOrder: CabType[] = ['base', 'specialty', 'tall', 'wall'];
  for (const cabType of typeOrder) {
    for (const [key, entry] of Array.from(needed.entries())) {
      if (entry.box.cab_type !== cabType) continue;
      const short = entry.count - (used.get(key) ?? 0);
      for (let i = 0; i < short; i++) missing.push(entry.box);
    }
  }
  if (missing.length === 0) return changed ? kept : null;

  const perim = perimeterAnchor(walls, scalePixelsPerFoot);
  const anchors: Record<CabinetLocation, RunAnchor> = {
    perimeter: perim,
    island: islandAnchor(perim, scalePixelsPerFoot),
  };
  const anchorRotation = rotationForBack(perim.back);
  const tolPx = inToPx(3, scalePixelsPerFoot);

  // Far end (along the run axis) of each row's cabinets that sit on its anchor line.
  const rowEnd = new Map<string, number>();
  for (const c of kept) {
    const loc = c.location ?? 'perimeter';
    const anchor = anchors[loc];
    if (angleDiffDeg(c.rotation, anchorRotation) > ANGLE_TOLERANCE_DEG) continue;
    if (Math.abs(dot({ x: c.x, y: c.y }, anchor.back) - dot(anchor.origin, anchor.back)) > tolPx) continue;
    const row = rowOf(loc, c.cab_type);
    const end = dot({ x: c.x, y: c.y }, anchor.ux) + c.width;
    rowEnd.set(row, Math.max(rowEnd.get(row) ?? -Infinity, end));
  }

  const next = [...kept];
  for (const box of missing) {
    const anchor = anchors[box.location];
    const row = rowOf(box.location, box.cab_type);
    const t0 = dot(anchor.origin, anchor.ux);
    const t = rowEnd.get(row) ?? t0;
    const pos = add(anchor.origin, scale(anchor.ux, t - t0));
    const depth = cabinetDepthIn(box.cab_type, box.specialty_type);
    const width = inToPx(box.width_inches, scalePixelsPerFoot);

    next.push({
      id: generateOverlayId(),
      preset_code: box.code,
      cab_type: box.cab_type,
      x: pos.x,
      y: pos.y,
      width,
      height: inToPx(depth, scalePixelsPerFoot),
      rotation: anchorRotation,
      label: box.code === 'CUSTOM' ? `${fmt(box.width_inches)}"` : box.code,
      location: box.location,
      width_in: box.width_inches,
      depth_in: depth,
      height_in: box.height_inches,
    });
    rowEnd.set(row, t + width);
  }
  return next;
}

// ---------------------------------------------------------------------------
// Snap a dragged cabinet onto a wall
// ---------------------------------------------------------------------------

/**
 * If the cabinet was dropped near a wall, return the position and rotation
 * that put its back flush against that wall's face (on the side the
 * cabinet is on), centred where it was dropped. `null` when no wall is
 * close enough.
 *
 * Closeness is measured from the nearest corner of the footprint, not the
 * back edge, so an unrotated cabinet pushed sideways up to a vertical wall
 * still snaps (and turns to face the room).
 */
export function snapCabinetToWall(
  cabinet: Pick<CabinetSketchCabinet, 'x' | 'y' | 'width' | 'height' | 'rotation'>,
  walls: CabinetSketchWall[],
  scalePixelsPerFoot: number
): { x: number; y: number; rotation: number } | null {
  const { ux, back } = axes(cabinet.rotation);
  const backLeft = { x: cabinet.x, y: cabinet.y };
  const front = scale(back, -cabinet.height);
  const across = scale(ux, cabinet.width);
  const corners = [backLeft, add(backLeft, across), add(backLeft, front), add(add(backLeft, across), front)];
  const body = add(backLeft, scale(add(across, front), 0.5));

  let best: { wall: CabinetSketchWall; q: Pt; dir: Pt; d: number } | null = null;
  for (const wall of walls) {
    const a = { x: wall.start_x, y: wall.start_y };
    const b = { x: wall.end_x, y: wall.end_y };
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (len < 1) continue;
    const dir = scale(sub(b, a), 1 / len);
    const closest = (p: Pt) => add(a, scale(dir, Math.max(0, Math.min(len, dot(sub(p, a), dir)))));
    const d =
      Math.min(...corners.map((p) => Math.hypot(p.x - closest(p).x, p.y - closest(p).y))) -
      (wall.thickness || 0) / 2;
    if (d <= WALL_SNAP_FT * scalePixelsPerFoot && (!best || d < best.d)) {
      best = { wall, q: closest(body), dir, d };
    }
  }
  if (!best) return null;

  const normal = { x: -best.dir.y, y: best.dir.x };
  const side = dot(sub(body, best.q), normal) >= 0 ? 1 : -1;
  const newBack = scale(normal, -side);
  const newUx = { x: -newBack.y, y: newBack.x };
  const face = sub(best.q, scale(newBack, (best.wall.thickness || 0) / 2));
  const corner = sub(face, scale(newUx, cabinet.width / 2));
  return { x: corner.x, y: corner.y, rotation: rotationForBack(newBack) };
}

// ---------------------------------------------------------------------------
// Snap a dragged cabinet against its neighbour
// ---------------------------------------------------------------------------

export interface CabinetPose {
  x: number;
  y: number;
  rotation: number;
}

type DroppedCabinet = Pick<CabinetSketchCabinet, 'id' | 'cab_type' | 'x' | 'y' | 'width' | 'height' | 'rotation'>;

const isUpper = (c: Pick<CabinetSketchCabinet, 'cab_type'>) => c.cab_type === 'wall';

/**
 * If the cabinet was dropped beside another one in its row (uppers with
 * uppers, everything else on the floor), return the pose that lines its
 * back up with that neighbour's and butts its side against the
 * neighbour's, turned to match. `null` when no cabinet is close enough.
 *
 * Only side by side counts: the backs must be within a foot of each other
 * and the facing sides within a few inches, so a cabinet set in front of
 * another, or left a dishwasher gap away, stays where it was dropped.
 */
export function snapCabinetToNeighbors(
  cabinet: DroppedCabinet,
  cabinets: CabinetSketchCabinet[],
  scalePixelsPerFoot: number
): CabinetPose | null {
  const gapTol = inToPx(NEIGHBOR_SNAP_GAP_IN, scalePixelsPerFoot);
  const backTol = inToPx(NEIGHBOR_SNAP_BACK_IN, scalePixelsPerFoot);
  const own = axes(cabinet.rotation);
  // Squared up to a neighbour, the cabinet turns about its middle.
  const center = add(
    { x: cabinet.x, y: cabinet.y },
    sub(scale(own.ux, cabinet.width / 2), scale(own.back, cabinet.height / 2))
  );

  let best: (CabinetPose & { d: number }) | null = null;
  for (const n of cabinets) {
    if (n.id === cabinet.id || isUpper(n) !== isUpper(cabinet)) continue;
    if (angleDiffDeg(n.rotation, cabinet.rotation) > NEIGHBOR_SNAP_ANGLE_DEG) continue;

    // Both cabinets in the neighbour's run coordinates: t along the run, s toward the back.
    const { ux, back } = axes(n.rotation);
    const corner = add(sub(center, scale(ux, cabinet.width / 2)), scale(back, cabinet.height / 2));
    const t = dot(corner, ux);
    const s = dot(corner, back);
    const tn = dot({ x: n.x, y: n.y }, ux);
    const sn = dot({ x: n.x, y: n.y }, back);
    if (Math.abs(sn - s) > backTol) continue;

    const gapRight = t - (tn + n.width); // dropped to the neighbour's right…
    const gapLeft = tn - (t + cabinet.width); // …or to its left
    const gap = Math.max(gapRight, gapLeft);
    if (Math.abs(gap) > gapTol) continue;

    const d = Math.hypot(gap, sn - s);
    if (best && d >= best.d) continue;
    const newT = gapRight >= gapLeft ? tn + n.width : tn - cabinet.width;
    const p = add(scale(ux, newT), scale(back, sn));
    best = { x: p.x, y: p.y, rotation: n.rotation, d };
  }
  return best && { x: best.x, y: best.y, rotation: best.rotation };
}

/**
 * Where a dropped cabinet lands. Beside another cabinet, it butts against
 * it (checked first, so a cabinet slid to the end of a run near a corner
 * joins the run instead of turning onto the side wall). Otherwise, near a
 * wall, it backs onto the wall — and then butts against any cabinet
 * already on that wall. Unchanged when nothing is close.
 */
export function snapDroppedCabinet(
  cabinet: DroppedCabinet,
  cabinets: CabinetSketchCabinet[],
  walls: CabinetSketchWall[],
  scalePixelsPerFoot: number
): CabinetPose {
  const beside = snapCabinetToNeighbors(cabinet, cabinets, scalePixelsPerFoot);
  if (beside) return beside;
  const onWall = snapCabinetToWall(cabinet, walls, scalePixelsPerFoot);
  if (!onWall) return { x: cabinet.x, y: cabinet.y, rotation: cabinet.rotation };
  return snapCabinetToNeighbors({ ...cabinet, ...onWall }, cabinets, scalePixelsPerFoot) ?? onWall;
}

// ---------------------------------------------------------------------------
// Front elevations
// ---------------------------------------------------------------------------

export interface ElevationItem {
  cabinet: CabinetSketchCabinet;
  /** Distance from the run's left edge to the cabinet's left side, inches. */
  left_in: number;
  width_in: number;
  height_in: number;
  bottom_in: number;
}

export interface ElevationRun {
  key: string;
  label: string;
  items: ElevationItem[];
  /** Total drawn width (cabinets plus any wall behind them), inches. */
  length_in: number;
  /** The drawn wall behind this run, if one lines up, in run coordinates. */
  wall?: { left_in: number; right_in: number };
  /** Free-standing: no wall behind it, so the elevation draws none. */
  island: boolean;
}

function compassLabel(back: Pt): string {
  const deg = (Math.atan2(back.y, back.x) * 180) / Math.PI;
  const cardinals: [number, string][] = [
    [-90, 'North wall'],
    [0, 'East wall'],
    [90, 'South wall'],
    [180, 'West wall'],
    [-180, 'West wall'],
  ];
  for (const [angle, label] of cardinals) {
    if (Math.abs(deg - angle) <= 10) return label;
  }
  return 'Angled wall';
}

/**
 * Group the plan's cabinets into front elevations: one per back line
 * (same facing, backs within a few inches), so the bases and uppers on a
 * wall share a drawing and an island gets its own.
 *
 * Only one run per facing is named for a wall. A run standing in front of
 * another that faces the same way — an island or peninsula, whatever the
 * Edit tab calls its cabinets — would hide part of that run from the
 * front, so it gets its own drawing, but as an island rather than a
 * second wall. A run backed onto a drawn wall is always a wall run.
 */
export function buildElevations(
  cabinets: CabinetSketchCabinet[],
  walls: CabinetSketchWall[],
  presets: PresetCatalog,
  scalePixelsPerFoot: number
): ElevationRun[] {
  const tolPx = inToPx(RUN_BACK_TOLERANCE_IN, scalePixelsPerFoot);
  const groups: { rotation: number; ux: Pt; back: Pt; s: number; cabinets: CabinetSketchCabinet[] }[] = [];

  for (const c of cabinets) {
    const { ux, back } = axes(c.rotation);
    const s = dot({ x: c.x, y: c.y }, back);
    const group = groups.find(
      (g) => angleDiffDeg(g.rotation, c.rotation) <= ANGLE_TOLERANCE_DEG && Math.abs(g.s - s) <= tolPx
    );
    if (group) group.cabinets.push(c);
    else groups.push({ rotation: c.rotation, ux, back, s, cabinets: [c] });
  }

  const mounts = mountHeightsIn(cabinets, presets, scalePixelsPerFoot);
  const parallelSin = Math.sin((ANGLE_TOLERANCE_DEG * Math.PI) / 180);

  const runs = groups.map((g) => {
    const raw = g.cabinets.map((c) => {
      const size = cabinetSizeIn(c, presets, scalePixelsPerFoot);
      return {
        cabinet: c,
        left: pxToIn(dot({ x: c.x, y: c.y }, g.ux), scalePixelsPerFoot),
        width_in: size.width,
        height_in: size.height,
        bottom_in: mounts.get(c.id) ?? 0,
      };
    });

    let min = Math.min(...raw.map((r) => r.left));
    let max = Math.max(...raw.map((r) => r.left + r.width_in));

    // A drawn wall whose face this run backs onto.
    let wallRange: { left: number; right: number } | undefined;
    for (const w of walls) {
      const len = Math.hypot(w.end_x - w.start_x, w.end_y - w.start_y);
      if (len < 1) continue;
      const dir = { x: (w.end_x - w.start_x) / len, y: (w.end_y - w.start_y) / len };
      if (Math.abs(dir.x * g.ux.y - dir.y * g.ux.x) > parallelSin) continue;
      const mid = { x: (w.start_x + w.end_x) / 2, y: (w.start_y + w.end_y) / 2 };
      const offset = Math.abs(dot(mid, g.back) - g.s);
      if (offset > (w.thickness || 0) / 2 + tolPx) continue;
      const a = pxToIn(dot({ x: w.start_x, y: w.start_y }, g.ux), scalePixelsPerFoot);
      const b = pxToIn(dot({ x: w.end_x, y: w.end_y }, g.ux), scalePixelsPerFoot);
      const left = Math.min(a, b);
      const right = Math.max(a, b);
      if (right < min || left > max) continue;
      wallRange = { left, right };
      break;
    }

    const standsInFront = groups.some(
      (o) => o !== g && angleDiffDeg(o.rotation, g.rotation) <= ANGLE_TOLERANCE_DEG && o.s - g.s > tolPx
    );
    const island = g.cabinets.every((c) => c.location === 'island') || (!wallRange && standsInFront);
    if (island) wallRange = undefined;
    if (wallRange) {
      min = Math.min(min, wallRange.left);
      max = Math.max(max, wallRange.right);
    }

    const items: ElevationItem[] = raw
      .map((r) => ({
        cabinet: r.cabinet,
        left_in: r.left - min,
        width_in: r.width_in,
        height_in: r.height_in,
        bottom_in: r.bottom_in,
      }))
      .sort((a, b) => a.left_in - b.left_in || a.bottom_in - b.bottom_in);

    return {
      label: island ? 'Island' : compassLabel(g.back),
      island,
      items,
      length_in: max - min,
      wall: wallRange ? { left_in: wallRange.left - min, right_in: wallRange.right - min } : undefined,
    };
  });

  runs.sort((a, b) => Number(a.island) - Number(b.island) || b.items.length - a.items.length);

  const seen = new Map<string, number>();
  return runs.map((r) => {
    const n = (seen.get(r.label) ?? 0) + 1;
    seen.set(r.label, n);
    const label = n > 1 ? `${r.label} ${n}` : r.label;
    return {
      key: label,
      label,
      items: r.items,
      length_in: r.length_in,
      wall: r.wall,
      island: r.island,
    };
  });
}
