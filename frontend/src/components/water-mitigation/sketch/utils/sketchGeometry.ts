/**
 * Pure geometry for the sketch editor.
 *
 * Everything here is a plain function over plain coordinates: no React, no
 * Konva, no component state. That is the point — this logic currently lives
 * inlined across WMFloorSketchEditor, WMOverlayLayer and WMFloorPlanRenderer,
 * where it cannot be tested and where three separately-declared constants all
 * meant "is this the same corner?" and all happened to equal 15.
 *
 * Call sites migrate to these functions incrementally. While that is in
 * progress the old inline copies still exist; the constants below are the ones
 * to trust.
 */

import { WALL_SNAP_THRESHOLD } from '../../../../types/wmSketch';

export interface Point {
  x: number;
  y: number;
}

/** A point that is currently being dragged: it was at `from`, it is now at `to`. */
export interface LiveMove {
  from: Point;
  to: Point;
}

/** A corner of the floor plan, with the directions of every wall meeting it. */
export interface Vertex {
  x: number;
  y: number;
  /** Unit vectors pointing away from this corner along each attached wall */
  directions: Point[];
}

/** The guide a drag snapped to, for drawing a dashed reference line. */
export interface SnapGuide {
  origin: Point;
  dir: Point;
  /** 0-180; the undirected angle of the guide */
  angleDeg: number;
}

// ============================================================================
// Tolerances
// ============================================================================

/**
 * Radius (canvas px) within which two points are treated as the same vertex.
 *
 * Deliberately aliased to WALL_SNAP_THRESHOLD rather than redeclared: anything
 * near enough for an endpoint to snap to must also be near enough to be
 * recognised as the same corner afterwards. When those two numbers disagree, a
 * wall follows a drag that the room ignores.
 */
export const VERTEX_EPS = WALL_SNAP_THRESHOLD;

/**
 * Looser radius for matching a wall endpoint against a stored room boundary.
 *
 * Room boundaries are built by quantising endpoints onto a 10px grid, so a
 * boundary point can sit up to ~14px (diagonally) from the endpoint it came
 * from — right at the edge of VERTEX_EPS. Matching at the tighter tolerance
 * silently finds no walls and leaves them behind when the room is dragged.
 */
export const BOUNDARY_EPS = VERTEX_EPS + 10;

/** Angle increments a drag snaps to, in degrees. */
export const ANGLE_SNAP_STEP_DEG = 15;

/** How near a guide the cursor must be to snap, in SCREEN pixels. */
export const SNAP_TOLERANCE_PX = 8;

// ============================================================================
// Point matching
// ============================================================================

/**
 * True when two points should be treated as the same corner.
 *
 * Euclidean, not axis-aligned: a box test reaches ~1.4x further diagonally,
 * so corners matched inconsistently depending on their angle.
 */
export function samePoint(a: Point, b: Point, eps: number = VERTEX_EPS): boolean {
  return Math.hypot(a.x - b.x, a.y - b.y) <= eps;
}

/**
 * Where a point has moved to, given the drags in flight — or null if this
 * point is not part of any of them.
 */
export function findLiveMove(
  p: Point,
  moves: LiveMove[] | null | undefined,
  eps: number = VERTEX_EPS,
): Point | null {
  if (!moves) return null;
  for (const m of moves) {
    if (samePoint(p, m.from, eps)) return m.to;
  }
  return null;
}

/** Apply the drags in flight to a point, leaving it alone if unaffected. */
export function applyLiveMove(
  p: Point,
  moves: LiveMove[] | null | undefined,
  eps: number = VERTEX_EPS,
): Point {
  return findLiveMove(p, moves, eps) ?? p;
}

// ============================================================================
// Vertex merging
// ============================================================================

interface WallLike {
  start_x: number;
  start_y: number;
  end_x: number;
  end_y: number;
}

/**
 * Collapse wall endpoints into distinct corners.
 *
 * Walls store their endpoints independently, so a corner where three walls
 * meet appears as three near-identical points. Each resulting vertex carries
 * the unit direction of every wall touching it, which the snap guides use.
 */
export function mergeVertices(
  walls: readonly WallLike[],
  eps: number = VERTEX_EPS,
): Vertex[] {
  const out: Vertex[] = [];

  const addDir = (v: Vertex, dx: number, dy: number) => {
    const len = Math.hypot(dx, dy);
    // A zero-length wall has no direction to contribute.
    if (len < 0.001) return;
    v.directions.push({ x: dx / len, y: dy / len });
  };

  for (const w of walls) {
    const ends: [number, number, number, number][] = [
      [w.start_x, w.start_y, w.end_x, w.end_y],
      [w.end_x, w.end_y, w.start_x, w.start_y],
    ];
    for (const [px, py, ox, oy] of ends) {
      const hit = out.find((v) => samePoint(v, { x: px, y: py }, eps));
      if (hit) {
        // Measure from the vertex that is already there, not from this
        // endpoint, so every direction shares one origin.
        addDir(hit, ox - hit.x, oy - hit.y);
      } else {
        const v: Vertex = { x: px, y: py, directions: [] };
        addDir(v, ox - px, oy - py);
        out.push(v);
      }
    }
  }

  return out;
}

// ============================================================================
// Snapping
// ============================================================================

/** Unit direction vectors at every ANGLE_SNAP_STEP_DEG increment, 0-180. */
export function angleSnapDirections(stepDeg: number = ANGLE_SNAP_STEP_DEG): Point[] {
  const dirs: Point[] = [];
  for (let a = 0; a < 180; a += stepDeg) {
    const rad = (a * Math.PI) / 180;
    dirs.push({ x: Math.cos(rad), y: Math.sin(rad) });
  }
  return dirs;
}

export interface SnapOptions {
  /** Extra guide directions beyond the angle increments (e.g. existing walls) */
  extraDirections?: Point[];
  /** Snap radius in canvas units; the caller divides screen px by stage scale */
  tolerance?: number;
  /**
   * Keep the result on the same side of the anchor as `keepSideOf`.
   *
   * Only meaningful with a reference direction, which is why it is expressed
   * as a vector rather than a boolean. "Forward" has no meaning against the
   * guide set on its own: those directions span 0-180, so for any drag there
   * is always some guide with a positive projection — a drag straight back
   * along 0 degrees still projects forward onto the 150 degree guide, and
   * that candidate wins on distance. Constraining per-candidate therefore
   * does nothing.
   *
   * Pass the wall's own axis here to stop an endpoint drag from flipping the
   * wall through its anchor; leave it undefined for a free corner, which may
   * legitimately cross to the other side.
   */
  keepSideOf?: Point;
}

export interface SnapResult {
  point: Point;
  guide: SnapGuide | null;
}

/**
 * Project `pos` onto the nearest guide line through `anchor`.
 *
 * Returns the original point and a null guide when nothing is within
 * tolerance, so the caller can follow the cursor exactly and draw nothing.
 */
export function snapToGuides(
  pos: Point,
  anchor: Point,
  options: SnapOptions = {},
): SnapResult {
  const {
    extraDirections = [],
    tolerance = SNAP_TOLERANCE_PX,
    keepSideOf,
  } = options;

  const dirs = [...angleSnapDirections(), ...extraDirections];

  let best: Point | null = null;
  let bestDir: Point | null = null;
  let bestDist = Infinity;

  for (const d of dirs) {
    const proj = (pos.x - anchor.x) * d.x + (pos.y - anchor.y) * d.y;
    const cand = { x: anchor.x + d.x * proj, y: anchor.y + d.y * proj };
    // Reject candidates that land on the far side of the anchor from the
    // reference direction — see the note on SnapOptions.keepSideOf.
    if (keepSideOf) {
      const side =
        (cand.x - anchor.x) * keepSideOf.x + (cand.y - anchor.y) * keepSideOf.y;
      if (side < 0) continue;
    }
    const dist = Math.hypot(cand.x - pos.x, cand.y - pos.y);
    if (dist < bestDist) {
      bestDist = dist;
      best = cand;
      bestDir = d;
    }
  }

  if (!best || !bestDir || bestDist > tolerance) {
    return { point: pos, guide: null };
  }

  let angleDeg = (Math.atan2(bestDir.y, bestDir.x) * 180) / Math.PI;
  if (angleDeg < 0) angleDeg += 180;

  return { point: best, guide: { origin: anchor, dir: bestDir, angleDeg } };
}

// ============================================================================
// Polygon helpers
// ============================================================================

/** Signed area doubled, via the shoelace formula. Sign encodes winding. */
export function shoelaceDoubled(points: readonly Point[]): number {
  let area = 0;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    area += (points[j].x + points[i].x) * (points[j].y - points[i].y);
  }
  return area;
}

/** Absolute polygon area in square feet. Returns 0 for degenerate input. */
export function polygonAreaSqft(points: readonly Point[], scalePixelsPerFoot: number): number {
  if (points.length < 3 || scalePixelsPerFoot <= 0) return 0;
  const areaPx = Math.abs(shoelaceDoubled(points) / 2);
  return areaPx / (scalePixelsPerFoot * scalePixelsPerFoot);
}

/** Axis-aligned bounds of a set of points, or null when there are none. */
export function boundsOf(
  points: readonly Point[],
): { x1: number; y1: number; x2: number; y2: number } | null {
  if (points.length === 0) return null;
  let x1 = Infinity;
  let y1 = Infinity;
  let x2 = -Infinity;
  let y2 = -Infinity;
  for (const p of points) {
    if (p.x < x1) x1 = p.x;
    if (p.y < y1) y1 = p.y;
    if (p.x > x2) x2 = p.x;
    if (p.y > y2) y2 = p.y;
  }
  return { x1, y1, x2, y2 };
}

/** True when two axis-aligned boxes overlap (touching counts). */
export function boxesIntersect(
  a: { x1: number; y1: number; x2: number; y2: number },
  b: { x1: number; y1: number; x2: number; y2: number },
): boolean {
  return a.x1 <= b.x2 && a.x2 >= b.x1 && a.y1 <= b.y2 && a.y2 >= b.y1;
}

/** True when a point lies inside an axis-aligned box (edges count). */
export function pointInBox(
  p: Point,
  b: { x1: number; y1: number; x2: number; y2: number },
): boolean {
  return p.x >= b.x1 && p.x <= b.x2 && p.y >= b.y1 && p.y <= b.y2;
}

// ============================================================================
// Overlap detection
// ============================================================================

/**
 * True when `p` is strictly inside the polygon.
 *
 * Ray casting. Points exactly on an edge are deliberately NOT counted: two
 * rooms that share a wall have every shared vertex and edge point in common,
 * and treating those as "inside" would report every adjacent pair as
 * overlapping.
 */
export function pointInPolygon(
  p: Point,
  poly: readonly Point[],
  epsilon = 1e-9,
): boolean {
  if (poly.length < 3) return false;

  // Reject boundary points up front rather than relying on the ray cast to
  // land the right way. A ray grazing a vertex or running along an edge
  // toggles unpredictably, and "on the boundary" is the single case that
  // must never read as inside: adjacent rooms share entire edges.
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    if (pointOnSegment(p, poly[j], poly[i], epsilon)) return false;
  }

  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    const straddles = (a.y > p.y) !== (b.y > p.y);
    if (!straddles) continue;
    const xCross = ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x;
    if (p.x < xCross) inside = !inside;
  }
  return inside;
}

/** True when `p` lies on segment ab, within `epsilon`. */
export function pointOnSegment(
  p: Point,
  a: Point,
  b: Point,
  epsilon = 1e-9,
): boolean {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const apx = p.x - a.x;
  const apy = p.y - a.y;
  const lenSq = abx * abx + aby * aby;
  // Degenerate segment: the "segment" is a point.
  if (lenSq < epsilon) return Math.hypot(apx, apy) <= epsilon;
  // Distance from the infinite line, scaled by the segment length.
  const cross = Math.abs(apx * aby - apy * abx);
  if (cross / Math.sqrt(lenSq) > epsilon) return false;
  // On the line — now check it falls between the endpoints.
  const dot = apx * abx + apy * aby;
  return dot >= -epsilon && dot <= lenSq + epsilon;
}

// ============================================================================
// Wall dragging
// ============================================================================

interface WallSegment {
  id: string;
  start_x: number;
  start_y: number;
  end_x: number;
  end_y: number;
}

/**
 * Where the two ends of a dragged wall come to rest, given that its neighbours
 * must keep their exact bearing and change only their length.
 *
 * The dragged wall slides along its own translated line. Each corner lands
 * where that line crosses the neighbour's line — the neighbour's far end never
 * moves, so its angle is preserved by construction and only its length gives.
 *
 * Shared by the committed move (the MOVE_WALL reducer) and the in-flight
 * preview, so what the user sees while dragging is what they get on release.
 * Computing these separately is exactly how the preview came to show tilted
 * neighbours that snapped straight the moment the mouse came up.
 *
 * Falls back to translating a corner by the delta when no neighbour holds it,
 * or when the neighbour runs parallel to the drag and the lines never meet.
 */
export function resolveDraggedWallCorners(
  walls: readonly WallSegment[],
  draggedId: string,
  dx: number,
  dy: number,
  eps: number = VERTEX_EPS,
): { start: Point; end: Point } | null {
  const wall = walls.find((w) => w.id === draggedId);
  if (!wall) return null;

  const px = wall.start_x + dx;
  const py = wall.start_y + dy;
  const dirx = wall.end_x - wall.start_x;
  const diry = wall.end_y - wall.start_y;

  const intersect = (ax: number, ay: number, bx: number, by: number): Point | null => {
    const denom = dirx * by - diry * bx;
    // |denom| is |d1||d2|sin(theta); this rejects near-parallel lines, where
    // the intersection shoots off to infinity and means nothing.
    const guard = Math.hypot(dirx, diry) * Math.hypot(bx, by);
    if (guard < 1e-9 || Math.abs(denom) < 1e-6 * guard) return null;
    const t = ((ax - px) * by - (ay - py) * bx) / denom;
    return { x: px + dirx * t, y: py + diry * t };
  };

  const cornerFor = (cx: number, cy: number): Point => {
    for (const w of walls) {
      if (w.id === draggedId) continue;
      const startsHere = Math.hypot(w.start_x - cx, w.start_y - cy) <= eps;
      const endsHere = Math.hypot(w.end_x - cx, w.end_y - cy) <= eps;
      if (!startsHere && !endsHere) continue;
      // The neighbour's fixed end, and the direction it points from there.
      const fx = startsHere ? w.end_x : w.start_x;
      const fy = startsHere ? w.end_y : w.start_y;
      const hit = intersect(fx, fy, cx - fx, cy - fy);
      if (hit) return hit;
    }
    return { x: cx + dx, y: cy + dy };
  };

  return {
    start: cornerFor(wall.start_x, wall.start_y),
    end: cornerFor(wall.end_x, wall.end_y),
  };
}

/**
 * How near a wall's bearing must be to a 15° multiple before the corner snaps
 * onto it, in DEGREES.
 *
 * Expressed as an angle rather than a pixel radius on purpose: the user's ask
 * was "drop it roughly and have it land on 90°", and a fixed pixel tolerance
 * does not mean that. The same 8px of slack is a wide angular target on a
 * short wall and a hair-thin one on a long wall, so square corners got harder
 * to hit exactly as the room got bigger.
 */
export const ANGLE_SNAP_TOLERANCE_DEG = 3;

/**
 * Snap a dragged corner so the walls meeting there sit on round bearings.
 *
 * `anchors` are the FIXED far ends of those walls — the corner is the only
 * point moving, so each wall's bearing is decided entirely by where the corner
 * lands relative to its anchor. Projecting the cursor onto a ray that leaves
 * an anchor at a 15° multiple therefore puts that wall on a round bearing, and
 * when both walls of a corner are round the angle between them is round too.
 * That is what makes an exact 90° reachable, which snapping each wall's
 * absolute bearing independently never managed on a plan drawn slightly off.
 *
 * Returns the unchanged position when nothing is within tolerance, so free
 * placement still works.
 */
export function snapCornerToAngle(
  pos: Point,
  anchors: readonly Point[],
  stepDeg: number = ANGLE_SNAP_STEP_DEG,
  toleranceDeg: number = ANGLE_SNAP_TOLERANCE_DEG,
): { point: Point; guide: SnapGuide | null } {
  /*
   * ONE anchor: there is no corner to speak of, only a single wall, so the
   * best that can be done is to round that wall's own bearing.
   */
  if (anchors.length === 1) {
    const a = anchors[0];
    const dx = pos.x - a.x;
    const dy = pos.y - a.y;
    const dist = Math.hypot(dx, dy);
    if (dist < 1e-6) return { point: pos, guide: null };

    const currentDeg = (Math.atan2(dy, dx) * 180) / Math.PI;
    const snappedDeg = Math.round(currentDeg / stepDeg) * stepDeg;
    let errDeg = Math.abs(currentDeg - snappedDeg);
    if (errDeg > 180) errDeg = 360 - errDeg;
    if (errDeg > toleranceDeg) return { point: pos, guide: null };

    const rad = (snappedDeg * Math.PI) / 180;
    const dir = { x: Math.cos(rad), y: Math.sin(rad) };
    let angleDeg = snappedDeg % 180;
    if (angleDeg < 0) angleDeg += 180;
    return {
      point: { x: a.x + dir.x * dist, y: a.y + dir.y * dist },
      guide: { origin: a, dir, angleDeg },
    };
  }

  if (anchors.length < 2) return { point: pos, guide: null };

  /*
   * TWO anchors — the real case, and the one two earlier versions got wrong.
   *
   * Both far ends are fixed, so the corner's position alone decides the angle
   * between the walls. The set of points that see the segment AB at a constant
   * angle θ is a CIRCULAR ARC through A and B (the inscribed-angle theorem),
   * not a ray. For θ = 90° it is the circle with AB as diameter — Thales.
   *
   * Earlier attempts rotated the cursor about one anchor and hoped the corner
   * came out round. It cannot, in general: rotating about A also changes the
   * bearing to B. Measured, that left corners at 90.374° and 90.62° instead of
   * 90° — close, which is exactly what "snapped" must not mean.
   *
   * So: for each candidate angle, build its arc and project the cursor onto
   * it. The projection is exact, so the committed corner is exactly round.
   */
  const [A, B] = anchors;
  const abx = B.x - A.x;
  const aby = B.y - A.y;
  const abLen = Math.hypot(abx, aby);
  // Degenerate: the two anchors coincide, so there is no segment to subtend.
  if (abLen < 1e-9) return { point: pos, guide: null };

  const mid = { x: (A.x + B.x) / 2, y: (A.y + B.y) / 2 };
  // Unit normal to AB, used to step off the arc centre from the midpoint.
  const nx = -aby / abLen;
  const ny = abx / abLen;

  // Which side of AB the cursor is on: the arc must be chosen to match, or
  // the corner would jump across the room.
  const sideOfCursor = Math.sign((pos.x - A.x) * aby - (pos.y - A.y) * abx) || 1;

  // The cursor's current corner angle, so a candidate can be rejected when it
  // would move the corner by more than the tolerance.
  const bearingA = Math.atan2(pos.y - A.y, pos.x - A.x);
  const bearingB = Math.atan2(pos.y - B.y, pos.x - B.x);
  let currentCornerDeg = Math.abs((bearingA - bearingB) * 180 / Math.PI);
  while (currentCornerDeg > 180) currentCornerDeg = 360 - currentCornerDeg;

  let best: { point: Point; errDeg: number } | null = null;

  for (let theta = stepDeg; theta < 180; theta += stepDeg) {
    const errDeg = Math.abs(currentCornerDeg - theta);
    if (errDeg > toleranceDeg) continue;

    const thetaRad = (theta * Math.PI) / 180;
    const sinT = Math.sin(thetaRad);
    if (Math.abs(sinT) < 1e-9) continue;

    // Inscribed angle: radius = |AB| / (2 sin θ); the centre sits on the
    // perpendicular bisector, offset by |AB| / (2 tan θ). For θ > 90° that
    // offset flips sign, which puts the centre on the far side — exactly what
    // the obtuse arc needs.
    const radius = abLen / (2 * sinT);
    const offset = abLen / (2 * Math.tan(thetaRad));
    // The arc carrying the cursor's side is the one offset AWAY from it.
    const centre = {
      x: mid.x - nx * offset * sideOfCursor,
      y: mid.y - ny * offset * sideOfCursor,
    };

    // Project the cursor radially onto that circle.
    const cx = pos.x - centre.x;
    const cy = pos.y - centre.y;
    const cLen = Math.hypot(cx, cy);
    if (cLen < 1e-9) continue;
    const point = {
      x: centre.x + (cx / cLen) * radius,
      y: centre.y + (cy / cLen) * radius,
    };

    if (!best || errDeg < best.errDeg) best = { point, errDeg };
  }

  if (!best) return { point: pos, guide: null };

  /*
   * The guide to draw: the wall from A through the snapped corner. Its bearing
   * is what the angle readout shows, and anchoring it at A matches how the
   * other guides in this file report themselves.
   */
  const gx = best.point.x - A.x;
  const gy = best.point.y - A.y;
  const gLen = Math.hypot(gx, gy) || 1;
  const dir = { x: gx / gLen, y: gy / gLen };
  let angleDeg = (Math.atan2(dir.y, dir.x) * 180) / Math.PI;
  if (angleDeg < 0) angleDeg += 180;
  if (angleDeg >= 180) angleDeg -= 180;

  return { point: best.point, guide: { origin: A, dir, angleDeg } };
}

/** Cross product of (b-a) x (c-a); sign gives the turn direction. */
function cross3(a: Point, b: Point, c: Point): number {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

/**
 * True when segments a1a2 and b1b2 cross at an interior point of both.
 *
 * Touching endpoints and collinear overlap return false. Adjacent room walls
 * meet end to end constantly; only a genuine X crossing means the outlines
 * actually cut through one another.
 */
export function segmentsProperlyIntersect(
  a1: Point,
  a2: Point,
  b1: Point,
  b2: Point,
): boolean {
  const d1 = cross3(b1, b2, a1);
  const d2 = cross3(b1, b2, a2);
  const d3 = cross3(a1, a2, b1);
  const d4 = cross3(a1, a2, b2);
  // Strict signs on both sides: no endpoint touching, no collinearity.
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0))
    && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

/**
 * Would moving one vertex of a closed outline make it cross itself?
 *
 * Only the two edges touching the moved vertex can newly cross anything, so
 * each is tested against every edge that does not share an endpoint with it.
 * Edges that merely meet end to end are fine — that is how a corner is built —
 * which is why this uses `segmentsProperlyIntersect` rather than a plain
 * segment test.
 *
 * Dragging a CONCAVE corner into the room is what makes this happen in
 * practice: push it far enough and it sails past a wall on the far side,
 * leaving a bow-tie outline and a nonsense area. Convex corners cannot do it,
 * which is why several earlier reproduction attempts on rectangles and
 * trapezoids came back clean.
 */
export function vertexMoveSelfIntersects(
  boundary: readonly Point[],
  vertexIndex: number,
  to: Point,
): boolean {
  const n = boundary.length;
  // Fewer than four points cannot cross: a triangle's edges all share corners.
  if (n < 4) return false;
  if (vertexIndex < 0 || vertexIndex >= n) return false;

  const moved = boundary.map((p, i) => (i === vertexIndex ? to : p));

  const prev = (vertexIndex - 1 + n) % n;
  const next = (vertexIndex + 1) % n;
  // The two edges that move with the vertex, as index pairs.
  const movedEdges: [number, number][] = [
    [prev, vertexIndex],
    [vertexIndex, next],
  ];

  for (const [a1, a2] of movedEdges) {
    for (let i = 0; i < n; i++) {
      const b1 = i;
      const b2 = (i + 1) % n;
      // Skip the edge itself and any edge sharing an endpoint with it.
      if (b1 === a1 || b1 === a2 || b2 === a1 || b2 === a2) continue;
      if (
        segmentsProperlyIntersect(moved[a1], moved[a2], moved[b1], moved[b2])
      ) {
        return true;
      }
    }
  }
  return false;
}

/** Ensure counter-clockwise winding, which the clipper below assumes. */
function toCounterClockwise(poly: readonly Point[]): Point[] {
  // shoelaceDoubled is positive for clockwise in screen coordinates (y down).
  return shoelaceDoubled(poly) > 0 ? [...poly].reverse() : [...poly];
}

/**
 * Sutherland-Hodgman: clip `subject` to the convex `clip` polygon.
 *
 * Only exact for a convex clip region. Rooms are usually convex or nearly so,
 * and the caller treats a non-empty result as evidence of shared area rather
 * than measuring it, so a concave clip erring toward "some area" is acceptable
 * here — it errs on the side of blocking an overlapping drag.
 */
function clipPolygon(subject: readonly Point[], clip: readonly Point[]): Point[] {
  let output: Point[] = [...subject];

  for (let i = 0; i < clip.length; i++) {
    if (output.length === 0) break;
    const c1 = clip[i];
    const c2 = clip[(i + 1) % clip.length];
    // Positive when p is on the inside (left) of the directed edge c1->c2.
    const side = (p: Point) => (c2.x - c1.x) * (p.y - c1.y) - (c2.y - c1.y) * (p.x - c1.x);

    const input = output;
    output = [];
    for (let j = 0; j < input.length; j++) {
      const cur = input[j];
      const prev = input[(j + input.length - 1) % input.length];
      const curIn = side(cur) >= 0;
      const prevIn = side(prev) >= 0;

      if (curIn) {
        if (!prevIn) {
          const t = side(prev) / (side(prev) - side(cur));
          output.push({
            x: prev.x + t * (cur.x - prev.x),
            y: prev.y + t * (cur.y - prev.y),
          });
        }
        output.push(cur);
      } else if (prevIn) {
        const t = side(prev) / (side(prev) - side(cur));
        output.push({
          x: prev.x + t * (cur.x - prev.x),
          y: prev.y + t * (cur.y - prev.y),
        });
      }
    }
  }

  return output;
}

/**
 * True when two room outlines genuinely share floor area.
 *
 * Sharing a wall is NOT overlapping — that is how adjacent rooms are built,
 * and it is the case this function exists to let through.
 *
 * Vertex sampling cannot decide this on its own. Two squares offset by less
 * than their width share a strip of area while every vertex sits either
 * outside the other or exactly on its boundary, and two identical rooms have
 * no vertex strictly inside either. So the real test is to intersect the two
 * outlines and ask whether anything with area survives; adjacency clips down
 * to a zero-area sliver, genuine overlap does not.
 *
 * The bounding-box test first is a cheap reject for rooms nowhere near each
 * other, which is the overwhelmingly common case.
 */
export function polygonsOverlap(
  a: readonly Point[],
  b: readonly Point[],
  /** Shared area (px²) below which the rooms count as merely touching. */
  minArea = 1e-6,
): boolean {
  if (a.length < 3 || b.length < 3) return false;

  const ba = boundsOf(a);
  const bb = boundsOf(b);
  if (!ba || !bb || !boxesIntersect(ba, bb)) return false;

  const clipped = clipPolygon(toCounterClockwise(a), toCounterClockwise(b));
  if (clipped.length < 3) return false;

  return Math.abs(shoelaceDoubled(clipped) / 2) > minArea;
}
