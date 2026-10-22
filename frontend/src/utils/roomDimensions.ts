/**
 * Room wall lengths from a floor plan screenshot.
 *
 * A captured room drawing (Xactimate, MagicPlan and the like) shows walls as
 * filled bands on a light background. This finds those bands, traces their
 * outlines along pixel edges, keeps the sides that face the room, and returns
 * each straight run of those sides as a wall face. Gaps between wall ends
 * (doors, missing walls) become openings that close the room outline.
 *
 * Everything here is in image pixels. The page turns pixels into feet with
 * one length the user knows, so the screenshot's zoom does not matter.
 */

export interface RgbaImage {
  width: number;
  height: number;
  /** RGBA bytes row by row, like ImageData.data */
  data: Uint8ClampedArray | Uint8Array;
}

export interface Point {
  x: number;
  y: number;
}

export interface WallFace {
  /** A, B, C… clockwise around the room from the top-left */
  label: string;
  start: Point;
  end: Point;
  lengthPx: number;
  /** Unit vector from the wall into the room */
  normal: Point;
}

export interface RoomOpening {
  /** From one wall end to the next; three points when it turns a corner */
  path: Point[];
  lengthPx: number;
}

export interface RoomDetection {
  width: number;
  height: number;
  wallThicknessPx: number;
  faces: WallFace[];
  openings: RoomOpening[];
  /** Inside outline of the room, closed across openings; null when the walls could not be joined */
  outline: Point[] | null;
  /** Floor area inside the outline, in square pixels */
  areaPx: number | null;
}

// ============================================================================
// Tuning
// ============================================================================

/** How much darker than the paper a pixel must be to count as ink */
const INK_CONTRAST = 35;
/** Coloured strokes (door swings, annotations) are not walls */
const MAX_INK_CHROMA = 60;
const MAX_WALL_THICKNESS = 80;
/** Walls run at least this many times longer than they are thick, in total */
const MIN_STROKE_ELONGATION = 6;
/** Rays cast from a face, spread around its normal */
const RAY_ANGLES_DEG = [-75, -60, -45, -30, -15, 0, 15, 30, 45, 60, 75];
const MAX_SAMPLES_PER_SIDE = 60;
/** Above this many open wall runs the outline is joined greedily instead of exhaustively */
const MAX_EXHAUSTIVE_SIDES = 7;

// Directions on the pixel-corner grid, clockwise on screen: E, S, W, N
const DX = [1, 0, -1, 0];
const DY = [0, 1, 0, -1];

// ============================================================================
// Vector helpers
// ============================================================================

const sub = (a: Point, b: Point): Point => ({ x: a.x - b.x, y: a.y - b.y });
const dist = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
const dot = (a: Point, b: Point) => a.x * b.x + a.y * b.y;
const cross = (a: Point, b: Point) => a.x * b.y - a.y * b.x;
const unit = (a: Point, b: Point): Point => {
  const len = dist(a, b) || 1;
  return { x: (b.x - a.x) / len, y: (b.y - a.y) / len };
};
/** Right-hand side of a heading on screen (y down): away from the wall, since walls are traced with ink on the left */
const rightOf = (u: Point): Point => ({ x: -u.y, y: u.x });

export function polylineLength(points: Point[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) total += dist(points[i - 1], points[i]);
  return total;
}

export function polygonArea(points: Point[]): number {
  let sum = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    sum += a.x * b.y - b.x * a.y;
  }
  return sum / 2;
}

// ============================================================================
// Wall mask
// ============================================================================

/** Dark, unsaturated pixels: wall fill and outlines, plus thin lines and text for now */
function inkMask(img: RgbaImage): Uint8Array {
  const { width, height, data } = img;
  const n = width * height;
  const lum = new Uint8Array(n);
  const chroma = new Uint8Array(n);
  const hist = new Uint32Array(256);

  for (let i = 0; i < n; i++) {
    // Transparent pixels read as white paper
    const a = data[i * 4 + 3] / 255;
    const r = data[i * 4] * a + 255 * (1 - a);
    const g = data[i * 4 + 1] * a + 255 * (1 - a);
    const b = data[i * 4 + 2] * a + 255 * (1 - a);
    const l = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
    lum[i] = l;
    chroma[i] = Math.round(Math.max(r, g, b) - Math.min(r, g, b));
    hist[l]++;
  }

  // The paper is the most common light tone
  let paper = 255;
  let best = -1;
  for (let l = 128; l < 256; l++) {
    if (hist[l] > best) {
      best = hist[l];
      paper = l;
    }
  }

  const cut = paper - INK_CONTRAST;
  const mask = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    mask[i] = lum[i] < cut && chroma[i] < MAX_INK_CHROMA ? 1 : 0;
  }
  return mask;
}

/**
 * The stroke width that covers the most ink. For each ink pixel the shorter
 * of its horizontal and vertical runs is the width of the stroke it sits in.
 * Walls are the thick, long strokes of a room capture, so they hold more ink
 * than dashed lines and text; a width only counts when its strokes are long
 * for their width, so a solid block (a legend, a logo) cannot win.
 */
export function estimateWallThickness(mask: Uint8Array, width: number, height: number): number {
  const hRun = new Uint16Array(width * height);
  const vRun = new Uint16Array(width * height);

  for (let y = 0; y < height; y++) {
    let x = 0;
    while (x < width) {
      if (!mask[y * width + x]) { x++; continue; }
      const start = x;
      while (x < width && mask[y * width + x]) x++;
      for (let k = start; k < x; k++) hRun[y * width + k] = x - start;
    }
  }
  for (let x = 0; x < width; x++) {
    let y = 0;
    while (y < height) {
      if (!mask[y * width + x]) { y++; continue; }
      const start = y;
      while (y < height && mask[y * width + x]) y++;
      for (let k = start; k < y; k++) vRun[k * width + x] = y - start;
    }
  }

  const area = new Float64Array(MAX_WALL_THICKNESS + 2);
  for (let i = 0; i < mask.length; i++) {
    if (!mask[i]) continue;
    const m = Math.min(hRun[i], vRun[i]);
    if (m >= 3 && m <= MAX_WALL_THICKNESS) area[m]++;
  }

  let thickness = 0;
  let best = 0;
  for (let m = 3; m <= MAX_WALL_THICKNESS; m++) {
    // Anti-aliasing spreads one wall width over neighbouring values
    const s = area[m] + 0.5 * (area[m - 1] + area[m + 1]);
    if (s < MIN_STROKE_ELONGATION * m * m) continue;
    if (s > best) {
      best = s;
      thickness = m;
    }
  }
  return thickness;
}

/**
 * Square min (erode) or max (dilate) filter along one axis. Outside the
 * image counts as paper.
 */
function boxPass(src: Uint8Array, width: number, height: number, r: number, horizontal: boolean, erode: boolean): Uint8Array {
  const out = new Uint8Array(width * height);
  const len = horizontal ? width : height;
  const lines = horizontal ? height : width;
  const prefix = new Int32Array(len + 1);
  const full = 2 * r + 1;

  for (let line = 0; line < lines; line++) {
    for (let k = 0; k < len; k++) {
      const idx = horizontal ? line * width + k : k * width + line;
      prefix[k + 1] = prefix[k] + src[idx];
    }
    for (let k = 0; k < len; k++) {
      const sum = prefix[Math.min(len - 1, k + r) + 1] - prefix[Math.max(0, k - r)];
      const idx = horizontal ? line * width + k : k * width + line;
      out[idx] = erode ? (sum === full && k - r >= 0 && k + r < len ? 1 : 0) : (sum > 0 ? 1 : 0);
    }
  }
  return out;
}

/** Morphological opening: removes strokes thinner than 2r+1 and keeps the rest exactly */
function openMask(mask: Uint8Array, width: number, height: number, r: number): Uint8Array {
  let m = boxPass(mask, width, height, r, true, true);
  m = boxPass(m, width, height, r, false, true);
  m = boxPass(m, width, height, r, true, false);
  m = boxPass(m, width, height, r, false, false);
  return m;
}

/** 4-connected components; returns a label per pixel (0 = paper) and each label's pixel count */
function labelComponents(mask: Uint8Array, width: number, height: number) {
  const labels = new Int32Array(width * height);
  const sizes: number[] = [0];
  const boxes: { minX: number; minY: number; maxX: number; maxY: number }[] = [{ minX: 0, minY: 0, maxX: 0, maxY: 0 }];
  const stack = new Int32Array(width * height);
  let next = 1;

  for (let start = 0; start < mask.length; start++) {
    if (!mask[start] || labels[start]) continue;
    let top = 0;
    stack[top++] = start;
    labels[start] = next;
    let size = 0;
    const box = { minX: width, minY: height, maxX: 0, maxY: 0 };
    while (top > 0) {
      const i = stack[--top];
      size++;
      const x = i % width;
      const y = (i / width) | 0;
      if (x < box.minX) box.minX = x;
      if (x > box.maxX) box.maxX = x;
      if (y < box.minY) box.minY = y;
      if (y > box.maxY) box.maxY = y;
      if (x > 0 && mask[i - 1] && !labels[i - 1]) { labels[i - 1] = next; stack[top++] = i - 1; }
      if (x < width - 1 && mask[i + 1] && !labels[i + 1]) { labels[i + 1] = next; stack[top++] = i + 1; }
      if (y > 0 && mask[i - width] && !labels[i - width]) { labels[i - width] = next; stack[top++] = i - width; }
      if (y < height - 1 && mask[i + width] && !labels[i + width]) { labels[i + width] = next; stack[top++] = i + width; }
    }
    sizes.push(size);
    boxes.push(box);
    next++;
  }
  return { labels, sizes, boxes };
}

// ============================================================================
// Outlines
// ============================================================================

interface Loop {
  /** Corner points on pixel edges, ink on the left of travel */
  points: Point[];
  component: number;
}

/**
 * Trace every boundary between ink and paper along pixel edges, keeping ink
 * on the left. Faces then sit exactly on pixel edges, so a gap of n paper
 * pixels between two walls measures exactly n.
 */
function traceLoops(mask: Uint8Array, labels: Int32Array, width: number, height: number): Loop[] {
  const vw = width + 1;
  const vertexCount = vw * (height + 1);
  // Up to two outgoing edges per grid vertex (two where ink touches only diagonally)
  const out = new Int8Array(vertexCount * 2).fill(-1);
  const add = (vx: number, vy: number, d: number) => {
    const v = vy * vw + vx;
    if (out[v * 2] < 0) out[v * 2] = d;
    else out[v * 2 + 1] = d;
  };
  const ink = (x: number, y: number) => x >= 0 && y >= 0 && x < width && y < height && mask[y * width + x] === 1;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!mask[y * width + x]) continue;
      if (!ink(x, y - 1)) add(x + 1, y, 2); // top edge, walk west
      if (!ink(x, y + 1)) add(x, y + 1, 0); // bottom edge, walk east
      if (!ink(x - 1, y)) add(x, y, 1); // left edge, walk south
      if (!ink(x + 1, y)) add(x + 1, y + 1, 3); // right edge, walk north
    }
  }

  const used = new Uint8Array(vertexCount * 4);
  const loops: Loop[] = [];

  for (let v = 0; v < vertexCount; v++) {
    for (let slot = 0; slot < 2; slot++) {
      const startDir = out[v * 2 + slot];
      if (startDir < 0 || used[v * 4 + startDir]) continue;

      let vx = v % vw;
      let vy = (v / vw) | 0;
      // The ink pixel on the left of the first edge names the component
      const seedX = startDir === 0 || startDir === 1 ? vx : vx - 1;
      const seedY = startDir === 1 || startDir === 2 ? vy : vy - 1;
      const component = labels[seedY * width + seedX];

      const points: Point[] = [];
      let d = startDir;
      let prev = -1;
      for (;;) {
        used[(vy * vw + vx) * 4 + d] = 1;
        if (d !== prev) points.push({ x: vx, y: vy });
        prev = d;
        vx += DX[d];
        vy += DY[d];
        const nv = vy * vw + vx;
        const a = out[nv * 2];
        const b = out[nv * 2 + 1];
        // Left turn first keeps diagonal-only neighbours apart (4-connectivity)
        const left = (d + 3) & 3;
        const right = (d + 1) & 3;
        if (a === left || b === left) d = left;
        else if (a !== d && b !== d) {
          if (a === right || b === right) d = right;
          else break;
        }
        if (nv === v && d === startDir) break;
      }
      if (prev === startDir) points.shift(); // the start was mid-edge, not a corner
      loops.push({ points, component });
    }
  }
  return loops;
}

function perpendicularDistance(p: Point, a: Point, b: Point): number {
  const len = dist(a, b);
  if (len === 0) return dist(p, a);
  return Math.abs(cross(sub(b, a), sub(p, a))) / len;
}

function douglasPeucker(points: Point[], eps: number): Point[] {
  if (points.length < 3) return points.slice();
  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;
  const stack: [number, number][] = [[0, points.length - 1]];
  while (stack.length) {
    const [i, j] = stack.pop()!;
    let worst = -1;
    let at = -1;
    for (let k = i + 1; k < j; k++) {
      const d = perpendicularDistance(points[k], points[i], points[j]);
      if (d > worst) {
        worst = d;
        at = k;
      }
    }
    if (worst > eps) {
      keep[at] = 1;
      stack.push([i, at], [at, j]);
    }
  }
  return points.filter((_, k) => keep[k]);
}

/**
 * Straighten a traced loop: pixel staircases on slanted walls become one
 * edge, and stray one-pixel jogs disappear.
 */
function simplifyLoop(points: Point[], eps: number): Point[] {
  if (points.length <= 4) return points;
  // Start from an extreme corner, which is always a real corner
  let anchor = 0;
  for (let i = 1; i < points.length; i++) {
    if (points[i].x + points[i].y < points[anchor].x + points[anchor].y) anchor = i;
  }
  const ring = [...points.slice(anchor), ...points.slice(0, anchor)];
  let far = 0;
  for (let i = 1; i < ring.length; i++) {
    if (dist(ring[0], ring[i]) > dist(ring[0], ring[far])) far = i;
  }
  const first = douglasPeucker(ring.slice(0, far + 1), eps);
  const second = douglasPeucker([...ring.slice(far), ring[0]], eps);
  let result = [...first.slice(0, -1), ...second.slice(0, -1)];

  // Drop corners that no longer turn, then corners that sit on top of each other
  let changed = true;
  while (changed && result.length > 3) {
    changed = false;
    for (let i = 0; i < result.length && result.length > 3; i++) {
      const prev = result[(i - 1 + result.length) % result.length];
      const next = result[(i + 1) % result.length];
      if (perpendicularDistance(result[i], prev, next) < eps * 0.75 || dist(result[i], next) < 1) {
        result = result.filter((_, k) => k !== i);
        changed = true;
      }
    }
  }
  return result;
}

// ============================================================================
// Which side of each wall faces the room
// ============================================================================

interface Side {
  points: Point[];
  closed: boolean;
  component: number;
  score: number;
}

/**
 * Cut a wall outline at its end caps. An end cap is a short edge where the
 * outline turns left twice to wrap around the end of a wall (ink is on the
 * left), so what is left are the wall's long sides. A closed ring of walls
 * has no caps: its outer and inner loops are each one side.
 */
function splitAtEndCaps(points: Point[], component: number, thickness: number): Side[] {
  const m = points.length;
  const dirs = points.map((p, i) => unit(p, points[(i + 1) % m]));
  const lens = points.map((p, i) => dist(p, points[(i + 1) % m]));
  const isCap = points.map((_, i) => {
    const before = dirs[(i - 1 + m) % m];
    const after = dirs[(i + 1) % m];
    return (
      lens[i] <= thickness * 1.8 &&
      cross(before, dirs[i]) < 0 &&
      cross(dirs[i], after) < 0 &&
      dot(before, after) < -0.7
    );
  });

  const caps = isCap.map((c, i) => (c ? i : -1)).filter(i => i >= 0);
  if (caps.length === 0) return [{ points, closed: true, component, score: 0 }];

  const sides: Side[] = [];
  for (let c = 0; c < caps.length; c++) {
    const from = (caps[c] + 1) % m; // the side starts where this cap ends
    const to = caps[(c + 1) % caps.length]; // and ends where the next cap starts
    const pts: Point[] = [];
    for (let i = from; ; i = (i + 1) % m) {
      pts.push(points[i]);
      if (i === to) break;
    }
    if (pts.length >= 2) sides.push({ points: pts, closed: false, component, score: 0 });
  }
  return sides;
}

/** Whether a ray from p hits a wall before leaving the image */
function rayHitsWall(mask: Uint8Array, width: number, height: number, p: Point, dir: Point, step: number): boolean {
  let x = p.x;
  let y = p.y;
  for (;;) {
    x += dir.x * step;
    y += dir.y * step;
    if (x < 0 || y < 0 || x >= width || y >= height) return false;
    if (mask[(y | 0) * width + (x | 0)]) return true;
  }
}

/**
 * How enclosed the space in front of a side is: the share of rays, fanned
 * out from points along it, that run into a wall. The room side of a wall
 * looks at more walls than the outside does, even through door and opening
 * gaps.
 */
function enclosureScore(side: Side, mask: Uint8Array, width: number, height: number, thickness: number): number {
  const pts = side.points;
  const segments: [Point, Point][] = [];
  for (let i = 0; i < pts.length - 1; i++) segments.push([pts[i], pts[i + 1]]);
  if (side.closed) segments.push([pts[pts.length - 1], pts[0]]);

  const total = segments.reduce((s, [a, b]) => s + dist(a, b), 0);
  const spacing = Math.max(thickness, total / MAX_SAMPLES_PER_SIDE);
  const march = Math.max(1, Math.floor(thickness / 2));
  const fan = RAY_ANGLES_DEG.map(deg => (deg * Math.PI) / 180);

  let hits = 0;
  let rays = 0;
  for (const [a, b] of segments) {
    const len = dist(a, b);
    if (len < thickness) continue;
    const u = unit(a, b);
    const n = rightOf(u);
    const count = Math.max(1, Math.floor(len / spacing));
    for (let k = 0; k < count; k++) {
      const t = ((k + 0.5) / count) * len;
      const p = { x: a.x + u.x * t + n.x * 2, y: a.y + u.y * t + n.y * 2 };
      for (const angle of fan) {
        const c = Math.cos(angle);
        const s = Math.sin(angle);
        const dir = { x: n.x * c - n.y * s, y: n.x * s + n.y * c };
        rays++;
        if (rayHitsWall(mask, width, height, p, dir, march)) hits++;
      }
    }
  }
  return rays ? hits / rays : 0;
}

/**
 * Each wall piece has an outside and an inside; the inside is the side that
 * looks at more walls. A closed ring's inner loop, or a stub wall poking into
 * the room, can make more than one side face the room.
 */
function pickRoomSides(sides: Side[]): Side[] {
  const byComponent = new Map<number, Side[]>();
  for (const side of sides) {
    const list = byComponent.get(side.component) ?? [];
    list.push(side);
    byComponent.set(side.component, list);
  }

  const room: Side[] = [];
  byComponent.forEach(list => {
    const best = list.reduce((a, b) => (b.score > a.score ? b : a));
    if (best.score < 0.3) return;
    for (const side of list) {
      if (side === best || (side.score >= 0.6 && side.score >= best.score * 0.75)) room.push(side);
    }
  });
  return room;
}

// ============================================================================
// Openings and the room outline
// ============================================================================

interface Gap {
  path: Point[];
  cost: number;
}

/** Whether a straight run between two wall ends passes through ink, ignoring the ends themselves */
function crossesWall(mask: Uint8Array, width: number, height: number, a: Point, b: Point, margin: number): boolean {
  const len = dist(a, b);
  const u = unit(a, b);
  for (let t = margin; t < len - margin; t += 1) {
    const x = Math.floor(a.x + u.x * t);
    const y = Math.floor(a.y + u.y * t);
    if (x >= 0 && y >= 0 && x < width && y < height && mask[y * width + x]) return true;
  }
  return false;
}

/**
 * The opening from the end of one wall run to the start of the next. Walls
 * that meet at a corner without touching (a corner opening) get an L through
 * the corner where their faces would meet; anything else is a straight gap.
 */
function gapBetween(
  from: Point,
  fromDir: Point,
  to: Point,
  toDir: Point,
  mask: Uint8Array,
  width: number,
  height: number,
  thickness: number,
): Gap {
  const d = sub(to, from);
  let path = [from, to];
  const turn = cross(fromDir, toDir);
  if (Math.abs(turn) > 0.5) {
    const t = cross(d, toDir) / turn; // distance from `from` along its wall to the corner
    const s = -cross(fromDir, d) / turn; // corner sits at `to` + s·toDir, behind `to` when s ≤ 0
    if (t > -1 && s < 1) {
      const corner = { x: from.x + fromDir.x * t, y: from.y + fromDir.y * t };
      path = [from, corner, to];
    }
  }

  const length = polylineLength(path);
  let cost = length;
  for (let i = 0; i < path.length - 1; i++) {
    if (crossesWall(mask, width, height, path[i], path[i + 1], thickness)) cost += length * 4 + thickness * 10;
  }
  // An opening that doubles back past the wall end it starts from is not an opening
  if (dot(d, fromDir) < -thickness || dot(d, toDir) < -thickness) cost += length * 2;
  return { path, cost };
}

function permutations(items: number[]): number[][] {
  if (items.length <= 1) return [items.slice()];
  const result: number[][] = [];
  items.forEach((item, i) => {
    const rest = [...items.slice(0, i), ...items.slice(i + 1)];
    for (const p of permutations(rest)) result.push([item, ...p]);
  });
  return result;
}

/**
 * Join the room-facing wall runs into one loop. Every run is traced with the
 * room on its right, so the loop only needs an order: the one whose openings
 * add up shortest without cutting through a wall.
 */
function orderRuns(runs: Side[], gap: (a: Side, b: Side) => Gap): { order: number[]; gaps: Gap[] } {
  const n = runs.length;
  const gapCache = new Map<string, Gap>();
  const gapOf = (i: number, j: number) => {
    const key = `${i}:${j}`;
    if (!gapCache.has(key)) gapCache.set(key, gap(runs[i], runs[j]));
    return gapCache.get(key)!;
  };

  let order: number[];
  if (n <= MAX_EXHAUSTIVE_SIDES) {
    let best = Infinity;
    order = [0];
    const rest = Array.from({ length: n - 1 }, (_, i) => i + 1);
    for (const perm of permutations(rest)) {
      const cand = [0, ...perm];
      let cost = 0;
      for (let k = 0; k < n && cost < best; k++) cost += gapOf(cand[k], cand[(k + 1) % n]).cost;
      if (cost < best) {
        best = cost;
        order = cand;
      }
    }
  } else {
    order = [0];
    const left = new Set(Array.from({ length: n - 1 }, (_, i) => i + 1));
    while (left.size) {
      const last = order[order.length - 1];
      let pick = -1;
      left.forEach(j => {
        if (pick < 0 || gapOf(last, j).cost < gapOf(last, pick).cost) pick = j;
      });
      order.push(pick);
      left.delete(pick);
    }
  }
  return { order, gaps: order.map((i, k) => gapOf(i, order[(k + 1) % n])) };
}

// ============================================================================
// Entry point
// ============================================================================

const faceLabel = (i: number) =>
  i < 26 ? String.fromCharCode(65 + i) : `${String.fromCharCode(65 + Math.floor(i / 26) - 1)}${String.fromCharCode(65 + (i % 26))}`;

const EMPTY = (img: RgbaImage, thickness = 0): RoomDetection => ({
  width: img.width,
  height: img.height,
  wallThicknessPx: thickness,
  faces: [],
  openings: [],
  outline: null,
  areaPx: null,
});

export function detectRoomFaces(img: RgbaImage): RoomDetection {
  const { width, height } = img;
  const raw = inkMask(img);
  const thickness = estimateWallThickness(raw, width, height);
  if (!thickness) return EMPTY(img);

  // Thin strokes (dashed neighbours, frames, text, door swings) go; walls stay exactly as drawn
  const mask = openMask(raw, width, height, Math.max(1, Math.round(thickness * 0.3)));

  // Leftover specks (bold text, symbols) are not walls
  const { labels, sizes, boxes } = labelComponents(mask, width, height);
  const keep = sizes.map(
    (size, c) => c > 0 && size >= thickness * thickness * 3 && Math.max(boxes[c].maxX - boxes[c].minX, boxes[c].maxY - boxes[c].minY) + 1 >= thickness * 4,
  );
  for (let i = 0; i < mask.length; i++) {
    if (mask[i] && !keep[labels[i]]) {
      mask[i] = 0;
      labels[i] = 0;
    }
  }

  const eps = Math.max(1.2, thickness * 0.2);
  const sides: Side[] = [];
  for (const loop of traceLoops(mask, labels, width, height)) {
    const pts = simplifyLoop(loop.points, eps);
    if (pts.length < 3) continue;
    for (const side of splitAtEndCaps(pts, loop.component, thickness)) {
      side.score = enclosureScore(side, mask, width, height, thickness);
      sides.push(side);
    }
  }

  const roomSides = pickRoomSides(sides);
  if (roomSides.length === 0) return EMPTY(img, thickness);

  // Walk the room: open wall runs joined by openings, or a closed ring on its own
  const runs = roomSides.filter(s => !s.closed);
  const rings = roomSides.filter(s => s.closed);
  const segmentsInOrder: { a: Point; b: Point }[] = [];
  const openings: RoomOpening[] = [];
  let outline: Point[] | null = null;

  const pushSegments = (pts: Point[], closed: boolean) => {
    for (let i = 0; i < pts.length - (closed ? 0 : 1); i++) {
      segmentsInOrder.push({ a: pts[i], b: pts[(i + 1) % pts.length] });
    }
  };

  if (runs.length > 0) {
    const firstDir = (s: Side) => unit(s.points[0], s.points[1]);
    const lastDir = (s: Side) => unit(s.points[s.points.length - 2], s.points[s.points.length - 1]);
    const { order, gaps } = orderRuns(runs, (a, b) =>
      gapBetween(a.points[a.points.length - 1], lastDir(a), b.points[0], firstDir(b), mask, width, height, thickness),
    );
    outline = [];
    order.forEach((runIndex, k) => {
      const run = runs[runIndex];
      pushSegments(run.points, false);
      outline!.push(...run.points);
      const g = gaps[k];
      if (g.path.length === 3) outline!.push(g.path[1]);
      const length = polylineLength(g.path);
      if (length >= thickness * 0.5) openings.push({ path: g.path, lengthPx: length });
    });
  }
  for (const ring of rings) {
    pushSegments(ring.points, true);
    if (!outline || Math.abs(polygonArea(ring.points)) > Math.abs(polygonArea(outline))) outline = ring.points;
  }

  const minFace = Math.max(3, thickness * 0.5);
  const faceSegments = segmentsInOrder.filter(({ a, b }) => dist(a, b) >= minFace);

  // Letter the faces clockwise starting from the top wall (leftmost if several)
  const mid = ({ a, b }: { a: Point; b: Point }) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
  let first = 0;
  faceSegments.forEach((seg, i) => {
    const m = mid(seg);
    const best = mid(faceSegments[first]);
    if (m.y < best.y - 1 || (Math.abs(m.y - best.y) <= 1 && m.x < best.x)) first = i;
  });
  const ordered = [...faceSegments.slice(first), ...faceSegments.slice(0, first)];

  const faces: WallFace[] = ordered.map(({ a, b }, i) => ({
    label: faceLabel(i),
    start: a,
    end: b,
    lengthPx: dist(a, b),
    normal: rightOf(unit(a, b)),
  }));

  return {
    width,
    height,
    wallThicknessPx: thickness,
    faces,
    openings,
    outline,
    areaPx: outline ? Math.abs(polygonArea(outline)) : null,
  };
}
