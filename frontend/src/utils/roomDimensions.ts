/**
 * Room wall lengths from a floor plan screenshot.
 *
 * A captured room drawing (Xactimate, MagicPlan and the like) shows walls as
 * filled bands on a light background. This finds those bands, traces their
 * outlines along pixel edges, keeps the sides that face a room, and returns
 * each straight run of those sides as a wall face. Gaps between wall ends
 * (doors, missing walls) become openings that close each room's outline.
 *
 * A dimensioned plan (an Xactimate sketch printout) is read the same way
 * once its walls are bands: walls drawn as two lines are filled between, and
 * dimension lines, door leaves and text, all thinner than a wall, are cleared
 * away. Such a plan often shows several rooms; each is returned, largest
 * first.
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

export interface DetectedRoom {
  faces: WallFace[];
  openings: RoomOpening[];
  /** Inside outline of the room, closed across openings; null when the walls could not be joined */
  outline: Point[] | null;
  /** Floor area inside the outline, in square pixels */
  areaPx: number | null;
}

/** The largest room's faces, openings and outline, and every room found */
export interface RoomDetection extends DetectedRoom {
  width: number;
  height: number;
  wallThicknessPx: number;
  /** Largest first, so the first is the detection's own */
  rooms: DetectedRoom[];
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
/** Walls are the thickest strokes holding at least this share of the most ink any one width holds */
const WALL_PEAK_SHARE = 0.5;
/** A thinner family of strokes (dimension lines, door leaves) holds at least this share … */
const ANNOTATION_PEAK_SHARE = 0.25;
/** … and is at most this fraction of the wall thickness */
const MAX_ANNOTATION_WIDTH = 0.8;
/** The thinnest stroke kept as a wall, as a fraction of the wall thickness … */
const MIN_WALL_STROKE = 0.6;
/** … raised to clear a thinner family by this many pixels, but never past this fraction */
const ANNOTATION_MARGIN = 3;
const MAX_WALL_STROKE = 0.85;
/** Rays cast from a face, spread around its normal */
const RAY_ANGLES_DEG = [-75, -60, -45, -30, -15, 0, 15, 30, 45, 60, 75];
const MAX_SAMPLES_PER_SIDE = 60;
/** A hollow wall's gap is at most this many times as wide as its lines */
const MAX_HOLLOW_GAP = 4;
/** The gap is the narrowest width of paper running at least this share of the longest */
const HOLLOW_GAP_SHARE = 0.5;
/** Paper shut in by a wall's lines is at most this many wall thicknesses across its shorter side; a door's wedge is more */
const MAX_POCKET_SIDE = 0.75;
/** The strokes either side of a hollow wall's gap are this many times its line width (more when slanted) */
const FLANK_MIN = 0.5;
const FLANK_MAX = 1.6;
/** … and alike: the two lines of one wall differ by at most this share of the wider */
const FLANK_MISMATCH = 0.35;
/** Share of a strip that must keep one width, as the paper between two parallel lines does */
const MIN_STEADY_SHARE = 0.75;
/** Filled hollow walls must come out at least this many line widths thick to be read as walls */
const HOLLOW_BAND_MIN = 1.8;
/** Hollow wall lines are at most this far from the main ink tone towards the paper */
const LINE_TONE_SPREAD = 0.4;
/** A bump left on a face by a thin stroke touching it: at most this deep and this long, in wall thicknesses, with this many corners */
const MAX_BUMP_DEPTH = 0.75;
const MAX_BUMP_WIDTH = 3;
const MAX_BUMP_CORNERS = 3;
/** A thin wall brought back runs at most this many wall thicknesses, and is inked along this share of it */
const MAX_THIN_WALL = 30;
const MIN_THIN_WALL_INK = 0.95;
/** A direction this close to square to the page (cos 10°) is taken as square */
const SQUARE_SNAP = 0.985;
/** … keeping within this many wall thicknesses of one offset from the line between the ends */
const MAX_THIN_WALL_WANDER = 0.4;
/** A room is at least this many wall thicknesses across; smaller loops are stray bits of wall */
const MIN_ROOM_SPAN = 4;

// Directions on the pixel-corner grid, clockwise on screen: E, S, W, N
const DX = [1, 0, -1, 0];
const DY = [0, 1, 0, -1];

// ============================================================================
// Vector helpers
// ============================================================================

const sub = (a: Point, b: Point): Point => ({ x: a.x - b.x, y: a.y - b.y });
const midpoint = (a: Point, b: Point): Point => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
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

interface Tones {
  lum: Uint8Array;
  chroma: Uint8Array;
  /** The paper's luminance */
  paper: number;
}

function readTones(img: RgbaImage): Tones {
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
  return { lum, chroma, paper };
}

/**
 * Unsaturated pixels darker than `cut`: wall fill and outlines, plus thin
 * lines and text for now. With `coloured`, saturated strokes count too.
 */
function inkMask({ lum, chroma, paper }: Tones, cut: number, coloured = false): Uint8Array {
  const mask = new Uint8Array(lum.length);
  for (let i = 0; i < lum.length; i++) {
    const ink = chroma[i] < MAX_INK_CHROMA ? lum[i] < cut : coloured && lum[i] < paper - INK_CONTRAST;
    mask[i] = ink ? 1 : 0;
  }
  return mask;
}

/**
 * The cut that keeps only lines drawn in the plan's main ink, its most
 * common ink tone. A plan with hollow walls draws them in black and its
 * stairs and hatching in grey; on a room capture the main ink is the grey
 * wall fill itself, so nothing is lost. A fixture drawn in colour against a
 * wall (a vanity, a cabinet) covers the wall's line, so colour counts.
 */
function lineCut({ lum, paper }: Tones, ink: Uint8Array): number {
  const hist = new Uint32Array(256);
  for (let i = 0; i < ink.length; i++) if (ink[i]) hist[lum[i]]++;
  let tone = 0;
  for (let l = 1; l < 256; l++) if (hist[l] > hist[tone]) tone = l;
  return tone + (paper - tone) * LINE_TONE_SPREAD;
}

/**
 * The shorter of each ink pixel's two diagonal runs, as a distance. At the
 * elbow of an L-shaped line both straight runs follow an arm and are long;
 * a diagonal one cuts across the elbow at about the line's width.
 */
function diagonalWidth(mask: Uint8Array, width: number, height: number): Float64Array {
  const out = new Float64Array(width * height).fill(Infinity);
  for (const dx of [1, -1]) {
    const starts: number[] = [];
    for (let x = 0; x < width; x++) starts.push(x);
    for (let y = 1; y < height; y++) starts.push(y * width + (dx > 0 ? 0 : width - 1));
    for (const start of starts) {
      // Walk one diagonal, measuring each run of ink along it
      let x = start % width;
      let y = (start / width) | 0;
      const run: number[] = [];
      for (;;) {
        const inside = x >= 0 && x < width && y < height;
        if (inside && mask[y * width + x]) {
          run.push(y * width + x);
        } else if (run.length) {
          const len = run.length * Math.SQRT2;
          for (const i of run) out[i] = Math.min(out[i], len);
          run.length = 0;
        }
        if (!inside) break;
        x += dx;
        y += 1;
      }
    }
  }
  return out;
}

/** The width of the stroke each ink pixel sits in: the shorter of its horizontal and vertical runs. Paper gets 0. */
function inkWidth(mask: Uint8Array, width: number, height: number): Uint16Array {
  const hRun = new Uint16Array(width * height);
  const out = new Uint16Array(width * height);

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
      for (let k = start; k < y; k++) out[k * width + x] = Math.min(y - start, hRun[k * width + x]);
    }
  }
  return out;
}

/**
 * The wall thickness: the thickest stroke width that holds a good share of
 * the ink. For each ink pixel the shorter of its horizontal and vertical runs
 * is the width of the stroke it sits in. Walls are the thick, long strokes
 * of a plan; text and dashed lines are thinner, and on a dimensioned plan
 * the dimension lines can hold as much ink as the walls but are thinner too.
 * A width only counts when its strokes are long for their width, so a solid
 * block (a legend, a logo) cannot win.
 */
export function estimateWallThickness(mask: Uint8Array, width: number, height: number): number {
  return strokeWidths(mask, width, height).wall;
}

/**
 * The wall thickness, and the width of the next thinner family of strokes
 * when one stands apart from the walls: the dimension lines and their ticks
 * on a dimensioned plan, the door leaves on a plan with hollow walls. 0 when
 * there is none.
 */
function strokeWidths(mask: Uint8Array, width: number, height: number): { wall: number; annotation: number } {
  const strokes = inkWidth(mask, width, height);
  const area = new Float64Array(MAX_WALL_THICKNESS + 2);
  for (let i = 0; i < mask.length; i++) {
    const m = strokes[i];
    if (m >= 3 && m <= MAX_WALL_THICKNESS) area[m]++;
  }

  // Anti-aliasing spreads one width over neighbouring values
  const share = new Float64Array(MAX_WALL_THICKNESS + 2);
  let best = 0;
  for (let m = 3; m <= MAX_WALL_THICKNESS; m++) {
    const s = area[m] + 0.5 * (area[m - 1] + area[m + 1]);
    if (s >= MIN_STROKE_ELONGATION * m * m) share[m] = s;
    best = Math.max(best, share[m]);
  }
  if (!best) return { wall: 0, annotation: 0 };

  const peaks: number[] = [];
  for (let m = 3; m <= MAX_WALL_THICKNESS; m++) {
    if (share[m] && share[m] >= share[m - 1] && share[m] > share[m + 1]) peaks.push(m);
  }
  const wall = Math.max(...peaks.filter(m => share[m] >= best * WALL_PEAK_SHARE));

  // A thinner family counts when the widths between it and the walls hold little ink
  let annotation = 0;
  for (const m of peaks) {
    if (m >= wall * MAX_ANNOTATION_WIDTH || share[m] < best * ANNOTATION_PEAK_SHARE) continue;
    let valley = Infinity;
    for (let k = m + 1; k < wall; k++) valley = Math.min(valley, share[k]);
    if (valley < Math.min(share[m], share[wall]) * 0.5) annotation = m;
  }
  return { wall, annotation };
}

/** A paper run that reaches the image edge, so nothing bounds it */
const OPEN_RUN = 0xffff;

/**
 * Visit every run of paper along each row (or column), with the ink pixels
 * either side of it (-1 at the image edge); a run that reaches the image
 * edge is OPEN_RUN long.
 */
function scanPaperRuns(
  mask: Uint8Array,
  width: number,
  height: number,
  horizontal: boolean,
  visit: (i: number, run: number, before: number, after: number) => void,
) {
  const len = horizontal ? width : height;
  const lines = horizontal ? height : width;
  const at = (line: number, k: number) => (horizontal ? line * width + k : k * width + line);
  for (let line = 0; line < lines; line++) {
    let k = 0;
    while (k < len) {
      if (mask[at(line, k)]) { k++; continue; }
      const start = k;
      while (k < len && !mask[at(line, k)]) k++;
      const before = start > 0 ? at(line, start - 1) : -1;
      const after = k < len ? at(line, k) : -1;
      const run = before < 0 || after < 0 ? OPEN_RUN : k - start;
      for (let j = start; j < k; j++) visit(at(line, j), run, before, after);
    }
  }
}

/**
 * How wide the paper is at each paper pixel: the shorter of its horizontal
 * and vertical runs between ink. With `line`, that run only counts between
 * two strokes alike and about `line` wide, as between the two lines of a
 * hollow wall (not between a wall and a thinner dimension line beside it),
 * and is OPEN_RUN otherwise. Ink pixels get 0.
 */
function paperWidth(mask: Uint8Array, width: number, height: number, line = 0): Uint16Array {
  const n = width * height;
  const hRun = new Uint16Array(n);
  const hFlanked = new Uint8Array(n);
  const out = new Uint16Array(n);
  const straight = line ? inkWidth(mask, width, height) : null;
  const diagonal = line ? diagonalWidth(mask, width, height) : null;
  const strokeAt = (i: number) => (i < 0 ? 0 : Math.min(straight![i], diagonal![i]));
  const flankedBy = (before: number, after: number) => {
    const a = strokeAt(before);
    const b = strokeAt(after);
    const lineLike = (w: number) => w >= line * FLANK_MIN && w <= line * FLANK_MAX;
    return lineLike(a) && lineLike(b) && Math.abs(a - b) <= Math.max(a, b) * FLANK_MISMATCH;
  };

  scanPaperRuns(mask, width, height, true, (i, run, before, after) => {
    hRun[i] = run;
    if (line) hFlanked[i] = flankedBy(before, after) ? 1 : 0;
  });
  scanPaperRuns(mask, width, height, false, (i, run, before, after) => {
    const h = hRun[i];
    if (!line) {
      out[i] = Math.min(h, run);
      return;
    }
    // A run at the image edge has no ink on that side, so it is never flanked
    const vFlanked = flankedBy(before, after);
    const flanked = h < run ? hFlanked[i] : run < h ? vFlanked : hFlanked[i] || vFlanked;
    out[i] = flanked ? Math.min(h, run) : OPEN_RUN;
  });
  return out;
}

/**
 * Lighter ink drawn across a line (a grey stair edge over a wall) breaks
 * it. Where `lines` continues on both sides of a short run of `ink`, the
 * run is line too.
 */
function bridgeLines(lines: Uint8Array, ink: Uint8Array, width: number, height: number, maxGap: number): Uint8Array {
  const out = lines.slice();
  for (const horizontal of [true, false]) {
    const len = horizontal ? width : height;
    const count = horizontal ? height : width;
    const at = (line: number, k: number) => (horizontal ? line * width + k : k * width + line);
    for (let line = 0; line < count; line++) {
      let k = 0;
      while (k < len) {
        if (!ink[at(line, k)] || lines[at(line, k)]) { k++; continue; }
        const start = k;
        while (k < len && ink[at(line, k)] && !lines[at(line, k)]) k++;
        const bounded = start > 0 && k < len && lines[at(line, start - 1)] && lines[at(line, k)];
        if (bounded && k - start <= maxGap) for (let j = start; j < k; j++) out[at(line, j)] = 1;
      }
    }
  }
  return out;
}

/**
 * Hollow walls. A dimensioned plan (an Xactimate sketch printout and the
 * like) draws each wall as its two faces: two lines with a strip of paper
 * between. Read as they are, each line is a wall of its own and the strip
 * between them a narrow room.
 *
 * This fills those strips so every wall becomes one solid band, as on a
 * room capture. A strip is paper between two strokes of the wall lines'
 * width, at the narrowest gap that runs far on the plan, that keeps one width
 * all along, as paper between parallel lines does; the wedge between a door
 * leaf and its wall widens steadily instead, and text is drawn thinner. The
 * corners and junctions the strips leave shut in are filled with them.
 *
 * Returns null when the plan has no hollow walls.
 */
function fillHollowWalls(mask: Uint8Array, width: number, height: number, line: number): Uint8Array | null {
  const n = width * height;
  const widths = paperWidth(mask, width, height, line);
  const maxGap = Math.round(line * MAX_HOLLOW_GAP);

  const hist = new Float64Array(maxGap + 2);
  for (let i = 0; i < n; i++) {
    if (!mask[i] && widths[i] >= 2 && widths[i] <= maxGap) hist[widths[i]]++;
  }
  // How far the paper of each width runs. Paper alone would favour the wider strip between a wall
  // and the dimension line along it, which holds more of it over the same run.
  const runs = new Float64Array(maxGap + 2);
  for (let g = 2; g <= maxGap; g++) runs[g] = (hist[g] + 0.5 * (hist[g - 1] + hist[g + 1])) / g;
  const longest = Math.max(...runs);
  // A dimension line sits further from a wall than the wall's two lines are apart: the walls are the narrowest
  let gap = 0;
  for (let g = 2; g <= maxGap && !gap; g++) {
    if (runs[g] >= longest * HOLLOW_GAP_SHARE && runs[g] >= runs[g - 1] && runs[g] > runs[g + 1]) gap = g;
  }
  const band = 2 * line + gap;
  // Enough of it to run several wall thicknesses, as walls do
  if (!gap || runs[gap] < MIN_STROKE_ELONGATION * band) return null;

  const lo = gap * 0.7 - 1;
  const hi = gap * 1.5 + 1;
  const filled = mask.slice();

  // Open strips: paper about the gap's width that keeps one width all along
  const strip = new Uint8Array(n);
  for (let i = 0; i < n; i++) strip[i] = !mask[i] && widths[i] >= lo && widths[i] <= hi ? 1 : 0;
  const strips = labelComponents(strip, width, height);
  const top = Math.floor(hi) + 1;
  const counts = new Uint32Array(strips.sizes.length * top);
  for (let i = 0; i < n; i++) if (strip[i]) counts[strips.labels[i] * top + widths[i]]++;
  const steady = strips.sizes.map((size, c) => {
    if (c === 0 || size < gap * gap) return false;
    const row = counts.subarray(c * top, (c + 1) * top);
    let median = 0;
    for (let seen = 0; seen * 2 < size; median++) seen += row[median];
    median--;
    const tol = Math.max(1, Math.round(median * 0.12));
    let near = 0;
    for (let w = Math.max(0, median - tol); w <= Math.min(top - 1, median + tol); w++) near += row[w];
    return near >= size * MIN_STEADY_SHARE;
  });
  const fresh = new Uint8Array(n);
  for (let i = 0; i < n; i++) if (strip[i] && steady[strips.labels[i]]) fresh[i] = filled[i] = 1;

  // What the strips leave shut in by ink: a wall's corners, junctions and ends. They are nowhere wider than
  // the gap, or, where a strip turns a corner or a line has a notch, hold less than a stretch of the wall does.
  const paper = new Uint8Array(n);
  for (let i = 0; i < n; i++) paper[i] = filled[i] ? 0 : 1;
  const holes = labelComponents(paper, width, height);
  const after = paperWidth(filled, width, height);
  const widest = new Uint16Array(holes.sizes.length);
  const touches = new Uint8Array(holes.sizes.length);
  for (let i = 0; i < n; i++) {
    if (!paper[i]) continue;
    const c = holes.labels[i];
    widest[c] = Math.max(widest[c], after[i]);
    const x = i % width;
    if ((x > 0 && fresh[i - 1]) || (x < width - 1 && fresh[i + 1]) || fresh[i - width] || fresh[i + width]) touches[c] = 1;
  }
  const shut = holes.boxes.map(
    (b, c) =>
      c > 0 &&
      touches[c] === 1 &&
      b.minX > 0 &&
      b.minY > 0 &&
      b.maxX < width - 1 &&
      b.maxY < height - 1 &&
      (widest[c] <= hi ||
        (holes.sizes[c] < band * band && Math.min(b.maxX - b.minX, b.maxY - b.minY) < band * MAX_POCKET_SIDE)),
  );
  for (let i = 0; i < n; i++) if (paper[i] && shut[holes.labels[i]]) filled[i] = 1;

  return filled;
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

/** Squared distance transform of one line (Felzenszwalb & Huttenlocher): d[q] = min over p of (q − p)² + f[p] */
function distance1d(f: Float64Array, n: number, d: Float64Array, v: Int32Array, z: Float64Array) {
  let k = 0;
  v[0] = 0;
  z[0] = -Infinity;
  z[1] = Infinity;
  for (let q = 1; q < n; q++) {
    let s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * (q - v[k]));
    while (s <= z[k]) {
      k--;
      s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * (q - v[k]));
    }
    k++;
    v[k] = q;
    z[k] = s;
    z[k + 1] = Infinity;
  }
  k = 0;
  for (let q = 0; q < n; q++) {
    while (z[k + 1] < q) k++;
    d[q] = (q - v[k]) * (q - v[k]) + f[v[k]];
  }
}

/** Squared distance from each ink pixel to the nearest paper pixel; outside the image counts as paper */
function paperDistance2(mask: Uint8Array, width: number, height: number): Float64Array {
  const far = (width + height + 2) ** 2;
  const out = new Float64Array(width * height);
  const n = Math.max(width, height) + 2;
  const f = new Float64Array(n);
  const d = new Float64Array(n);
  const v = new Int32Array(n);
  const z = new Float64Array(n + 1);

  for (let x = 0; x < width; x++) {
    f[0] = 0;
    for (let y = 0; y < height; y++) f[y + 1] = mask[y * width + x] ? far : 0;
    f[height + 1] = 0;
    distance1d(f, height + 2, d, v, z);
    for (let y = 0; y < height; y++) out[y * width + x] = d[y + 1];
  }
  for (let y = 0; y < height; y++) {
    f[0] = 0;
    for (let x = 0; x < width; x++) f[x + 1] = out[y * width + x];
    f[width + 1] = 0;
    distance1d(f, width + 2, d, v, z);
    for (let x = 0; x < width; x++) out[y * width + x] = d[x + 1];
  }
  return out;
}

/**
 * Keep the strokes that reach `depth` pixels into the ink, at any angle: a
 * stroke w pixels wide reaches (w + 1) / 2. What is kept is grown back to
 * the stroke's own edges, so walls stay exactly as drawn, square corners
 * included, and a thinner stroke running into a wall is cut off at its face.
 */
function keepThickStrokes(mask: Uint8Array, width: number, height: number, depth: number): Uint8Array {
  const dist2 = paperDistance2(mask, width, height);
  const core = new Uint8Array(width * height);
  for (let i = 0; i < core.length; i++) core[i] = dist2[i] >= depth * depth ? 1 : 0;
  let grown = boxPass(core, width, height, depth - 1, true, false);
  grown = boxPass(grown, width, height, depth - 1, false, false);
  for (let i = 0; i < grown.length; i++) grown[i] &= mask[i];
  return grown;
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

/**
 * Flatten the small bumps on a straight face. Where a thin stroke touches a
 * wall (a dimension tick, a door's hinge end) the wall keeps a stub of it:
 * the outline steps off the face, no deeper than the wall is thick, and
 * comes back onto the same line further along. Left in, the stub would read
 * as the end of a wall. A real wall end turns back along the wall's other
 * face instead, so it is left alone.
 */
function flattenBumps(points: Point[], maxDepth: number, maxWidth: number, eps: number): Point[] {
  let pts = points;
  for (let changed = true; changed && pts.length > 4; ) {
    changed = false;
    const m = pts.length;
    search: for (let i = 0; i < m; i++) {
      const before = pts[(i - 1 + m) % m];
      const leave = pts[i];
      const along = unit(before, leave);
      for (let k = 1; k <= MAX_BUMP_CORNERS && k + 3 <= m; k++) {
        const back = pts[(i + k + 1) % m];
        const after = pts[(i + k + 2) % m];
        if (perpendicularDistance(back, before, leave) > eps) continue;
        if (dot(sub(back, leave), along) <= 0 || dist(leave, back) > maxWidth) continue;
        if (dot(unit(back, after), along) < 0.95) continue;
        let shallow = true;
        for (let s = 1; s <= k; s++) if (perpendicularDistance(pts[(i + s) % m], before, leave) > maxDepth) shallow = false;
        if (!shallow) continue;
        const drop = new Set(Array.from({ length: k + 2 }, (_, s) => (i + s) % m));
        pts = pts.filter((_, idx) => !drop.has(idx));
        changed = true;
        break search;
      }
    }
  }
  return pts;
}

/** The end of a wall: its cap edge along the outline (ink on the left), and the way the wall runs on past it */
interface WallEnd {
  a: Point;
  b: Point;
  out: Point;
}

/** A direction within a few degrees of square to the page, made square: plans are drawn that way, short edges wobble */
function squared(u: Point): Point {
  if (Math.abs(u.x) >= SQUARE_SNAP) return { x: Math.sign(u.x), y: 0 };
  if (Math.abs(u.y) >= SQUARE_SNAP) return { x: 0, y: Math.sign(u.y) };
  return u;
}

/** The end of a wall at cap `i` of an outline. It runs on the way the face leading into the cap runs, square to the cap when that face is short. */
function wallEnd(points: Point[], i: number, thickness: number): WallEnd {
  const m = points.length;
  const a = points[i];
  const b = points[(i + 1) % m];
  const face = points[(i - 1 + m) % m];
  return { a, b, out: squared(dist(face, a) >= thickness ? unit(face, a) : rightOf(unit(a, b))) };
}

/**
 * Bring back thin walls. On a plan drawn in single lines an inside wall can
 * be no thicker than the dimension lines, and is cleared away with them.
 * From each wall end, straight on or sideways from either corner, an
 * unbroken line of ink that runs straight on until it meets another wall is
 * a wall too, and its ink goes back. A dashed line (a missing wall) is
 * broken, so it stays an opening; a folding door's zigzag wanders; door
 * leaves and dimension lines do not run from a wall's end to another wall.
 *
 * Returns whether any came back.
 */
function restoreThinWalls(
  mask: Uint8Array,
  ink: Uint8Array,
  width: number,
  height: number,
  thickness: number,
  ends: WallEnd[],
  /** The walls' outside corners, ends included */
  corners: Point[],
): boolean {
  const reach = Math.ceil(thickness * 0.75);
  const at = (p: Point) => {
    const x = Math.floor(p.x);
    const y = Math.floor(p.y);
    return x >= 0 && y >= 0 && x < width && y < height ? y * width + x : -1;
  };

  /** Where a straight line of ink from `start` meets a wall, or null */
  const follow = (start: Point, dir: Point): Point | null => {
    const side = rightOf(dir);
    const offsets: number[] = [];
    let missing = 0;
    let away = false;
    for (let t = 1; t <= thickness * MAX_THIN_WALL; t++) {
      const centre = { x: start.x + dir.x * t, y: start.y + dir.y * t };
      if (at(centre) < 0) return null;
      // The ink nearest the line here: 0, 1, -1, 2, -2… pixels off it
      let found = -1;
      let offset = 0;
      for (let k = 0; k <= 2 * reach && found < 0; k++) {
        offset = k % 2 ? (k + 1) / 2 : -k / 2;
        const i = at({ x: centre.x + side.x * offset, y: centre.y + side.y * offset });
        if (i >= 0 && ink[i]) found = i;
      }
      if (found >= 0 && mask[found]) {
        // Still beside the wall it starts from, or arrived at another
        if (!away) {
          if (t > reach) return null;
          continue;
        }
        if (t < thickness * 2 || offsets.length < (offsets.length + missing) * MIN_THIN_WALL_INK) return null;
        offsets.sort((p, q) => p - q);
        const spread = offsets[Math.floor(offsets.length * 0.9)] - offsets[Math.floor(offsets.length * 0.1)];
        if (spread > thickness * MAX_THIN_WALL_WANDER) return null;
        // A wall meets the other at its end or a corner; a dimension line can stop anywhere along it
        return corners.some(c => dist(c, centre) <= reach * 1.5) ? centre : null;
      }
      if (found >= 0) {
        away = true;
        offsets.push(offset);
      } else {
        if (!away) return null;
        missing++;
        if (missing > Math.max(2, (offsets.length + missing) * (1 - MIN_THIN_WALL_INK))) return null;
      }
    }
    return null;
  };

  const found: [Point, Point][] = [];
  for (const { a, b, out } of ends) {
    // Sideways is square to the way the wall runs, from a towards b
    const square = rightOf(out);
    const side = dot(sub(b, a), square) >= 0 ? square : { x: -square.x, y: -square.y };
    const probes: [Point, Point][] = [
      [midpoint(a, b), out],
      [b, side],
      [a, { x: -side.x, y: -side.y }],
    ];
    for (const [start, dir] of probes) {
      const end = follow(start, dir);
      if (end) found.push([start, end]);
    }
  }

  // Its ink, in a corridor along the line
  for (const [p, q] of found) {
    const u = unit(p, q);
    const n = rightOf(u);
    const len = dist(p, q);
    const x0 = Math.max(0, Math.floor(Math.min(p.x, q.x) - reach));
    const x1 = Math.min(width - 1, Math.ceil(Math.max(p.x, q.x) + reach));
    const y0 = Math.max(0, Math.floor(Math.min(p.y, q.y) - reach));
    const y1 = Math.min(height - 1, Math.ceil(Math.max(p.y, q.y) + reach));
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const d = { x: x + 0.5 - p.x, y: y + 0.5 - p.y };
        const along = dot(d, u);
        if (along >= 0 && along <= len && Math.abs(dot(d, n)) <= reach && ink[y * width + x]) mask[y * width + x] = 1;
      }
    }
  }
  return found.length > 0;
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
 * The end caps of a wall outline: short edges where the outline turns left
 * twice to wrap around the end of a wall (ink is on the left). Each is the
 * index of the edge's first point.
 */
function endCaps(points: Point[], thickness: number): number[] {
  const m = points.length;
  const dirs = points.map((p, i) => unit(p, points[(i + 1) % m]));
  const caps: number[] = [];
  points.forEach((p, i) => {
    const before = dirs[(i - 1 + m) % m];
    const after = dirs[(i + 1) % m];
    if (
      dist(p, points[(i + 1) % m]) <= thickness * 1.8 &&
      cross(before, dirs[i]) < 0 &&
      cross(dirs[i], after) < 0 &&
      dot(before, after) < -0.7
    ) {
      caps.push(i);
    }
  });
  return caps;
}

/**
 * Cut a wall outline at its end caps, so what is left are the wall's long
 * sides. A closed ring of walls has no caps: its outer and inner loops are
 * each one side.
 */
function splitAtEndCaps(points: Point[], component: number, thickness: number): Side[] {
  const m = points.length;
  const caps = endCaps(points, thickness);
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
  /** The opening leaves the run before it this far back from the run's end, at a corner */
  trimEnd: number;
  /** … and joins the run after it this far in from that run's start */
  trimStart: number;
}

/** Whether a straight run between two wall ends passes through a wall, ignoring the ends and grazing its face */
function crossesWall(mask: Uint8Array, width: number, height: number, a: Point, b: Point, margin: number): boolean {
  const len = dist(a, b);
  const u = unit(a, b);
  const inside = (x: number, y: number) => x >= 0 && y >= 0 && x < width && y < height && mask[y * width + x] === 1;
  for (let t = margin; t < len - margin; t += 1) {
    const x = Math.floor(a.x + u.x * t);
    const y = Math.floor(a.y + u.y * t);
    if (inside(x, y) && inside(x - 1, y) && inside(x + 1, y) && inside(x, y - 1) && inside(x, y + 1)) return true;
  }
  return false;
}

/**
 * The opening from the end of one wall run to the start of the next. Walls
 * that meet at a corner without touching (a corner opening) get an L through
 * the corner where their faces would meet; anything else is a straight gap.
 * A run whose last (or first) stretch runs on past that corner, as a wall
 * does that carries on along the next room, is cut back to it.
 */
function gapBetween(
  from: Point,
  fromDir: Point,
  fromReach: number,
  to: Point,
  toDir: Point,
  toReach: number,
  mask: Uint8Array,
  width: number,
  height: number,
  thickness: number,
): Gap {
  let path = [from, to];
  let trimEnd = 0;
  let trimStart = 0;
  const turn = cross(fromDir, toDir);
  if (Math.abs(turn) > 0.5) {
    const d = sub(to, from);
    const t = cross(d, toDir) / turn; // distance from `from` along its wall to the corner
    const s = -cross(fromDir, d) / turn; // corner sits at `to` + s·toDir, behind `to` when s ≤ 0
    const corner = { x: from.x + fromDir.x * t, y: from.y + fromDir.y * t };
    if (t > -1 && s < 1) {
      path = [from, corner, to];
    } else if (t <= -1 && -t < fromReach && s < 1) {
      path = [corner, to];
      trimEnd = -t;
    } else if (s >= 1 && s < toReach && t > -1) {
      path = [from, corner];
      trimStart = s;
    }
  }

  const d = sub(path[path.length - 1], path[0]);
  const length = polylineLength(path);
  // Wall cut off a run is wall this room does not get
  let cost = length + trimEnd + trimStart;
  const blocked = length * 4 + thickness * 10;
  for (let i = 0; i < path.length - 1; i++) {
    if (crossesWall(mask, width, height, path[i], path[i + 1], thickness)) cost += blocked;
  }
  // An opening that doubles back past the wall end it starts from is not an opening
  if (dot(d, fromDir) < -thickness || dot(d, toDir) < -thickness) cost += blocked;
  // Nor is one that wraps round the end of a wall, from its room-facing side to its back: that is the next room
  const side = thickness * 0.5;
  if (dot(d, rightOf(fromDir)) < -side || dot(d, rightOf(toDir)) > side) cost += blocked;
  return { path, cost, trimEnd, trimStart };
}

/** Min-cost assignment (the Hungarian method): column given to each row of a square cost matrix */
function assign(cost: number[][]): number[] {
  const n = cost.length;
  const u = new Array<number>(n + 1).fill(0);
  const v = new Array<number>(n + 1).fill(0);
  const p = new Array<number>(n + 1).fill(0);
  const way = new Array<number>(n + 1).fill(0);
  for (let i = 1; i <= n; i++) {
    p[0] = i;
    let j0 = 0;
    const minv = new Array<number>(n + 1).fill(Infinity);
    const used = new Array<boolean>(n + 1).fill(false);
    do {
      used[j0] = true;
      const i0 = p[j0];
      let delta = Infinity;
      let j1 = 0;
      for (let j = 1; j <= n; j++) {
        if (used[j]) continue;
        const cur = cost[i0 - 1][j - 1] - u[i0] - v[j];
        if (cur < minv[j]) {
          minv[j] = cur;
          way[j] = j0;
        }
        if (minv[j] < delta) {
          delta = minv[j];
          j1 = j;
        }
      }
      for (let j = 0; j <= n; j++) {
        if (used[j]) {
          u[p[j]] += delta;
          v[j] -= delta;
        } else {
          minv[j] -= delta;
        }
      }
      j0 = j1;
    } while (p[j0] !== 0);
    do {
      const j1 = way[j0];
      p[j0] = p[j1];
      j0 = j1;
    } while (j0);
  }
  const match = new Array<number>(n);
  for (let j = 1; j <= n; j++) match[p[j] - 1] = j - 1;
  return match;
}

/**
 * Group the room-facing wall runs into rooms. Every run is traced with its
 * room on the right, so a room is a loop of runs, each joined end to start
 * to the next by an opening (to itself, when one run goes all the way
 * round). Matching every run's end to a run's start so that the openings add
 * up shortest without cutting through a wall gives the loops: one room each.
 */
function groupRuns(runs: Side[], gap: (a: Side, b: Side) => Gap): { order: number[]; gaps: Gap[] }[] {
  const gaps = runs.map(a => runs.map(b => gap(a, b)));
  const next = assign(gaps.map(row => row.map(g => g.cost)));
  const seen = new Set<number>();
  const loops: { order: number[]; gaps: Gap[] }[] = [];
  runs.forEach((_, start) => {
    if (seen.has(start)) return;
    const order: number[] = [];
    for (let i = start; !seen.has(i); i = next[i]) {
      seen.add(i);
      order.push(i);
    }
    loops.push({ order, gaps: order.map(i => gaps[i][next[i]]) });
  });
  return loops;
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
  rooms: [],
});

export function detectRoomFaces(img: RgbaImage): RoomDetection {
  const { width, height } = img;
  const tones = readTones(img);
  const raw = inkMask(tones, tones.paper - INK_CONTRAST);
  if (!estimateWallThickness(raw, width, height)) return EMPTY(img);

  // Strokes in the plan's main ink, and fixtures drawn over its walls in colour
  let ink = inkMask(tones, lineCut(tones, raw), true);
  let { wall: thickness, annotation } = strokeWidths(ink, width, height);
  if (!thickness) return EMPTY(img);
  ink = bridgeLines(ink, raw, width, height, thickness);
  // A stub on a wall is as small as the lines drawing it, however thick the wall those lines make
  const stubEps = Math.max(1.2, thickness * 0.2);

  // Walls drawn as two lines: fill between each pair, so a wall is one band whatever its lines' width
  const hollow = fillHollowWalls(ink, width, height, thickness);
  let hollowWalls = false;
  if (hollow) {
    const band = strokeWidths(hollow, width, height);
    if (band.wall >= thickness * HOLLOW_BAND_MIN) {
      ink = hollow;
      ({ wall: thickness, annotation } = band);
      hollowWalls = true;
    }
  }

  // Strokes thinner than the walls go: text, dashed neighbours, door swings, and on a dimensioned
  // plan its dimension lines and door leaves too. Walls stay exactly as drawn.
  let depth = Math.max(1, Math.round((thickness * MIN_WALL_STROKE) / 2)) + 1;
  if (annotation) {
    const clear = Math.ceil((annotation + ANNOTATION_MARGIN) / 2);
    depth = Math.max(depth, Math.min(clear, Math.floor((thickness * MAX_WALL_STROKE + 1) / 2)));
  }
  const mask = keepThickStrokes(ink, width, height, depth);

  // Leftover specks (bold text, symbols) are not walls
  const { sizes, boxes, labels: speckLabels } = labelComponents(mask, width, height);
  let labels = speckLabels;
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
  const clean = (points: Point[], tolerance: number) =>
    flattenBumps(simplifyLoop(points, tolerance), thickness * MAX_BUMP_DEPTH, thickness * MAX_BUMP_WIDTH, tolerance);
  const outlines = () =>
    traceLoops(mask, labels, width, height).map(loop => ({
      component: loop.component,
      points: clean(clean(loop.points, stubEps), eps),
    }));

  // A wall drawn thinner than the rest (an inside wall) went with the dimension lines; bring back
  // those running from a wall's end to another wall. Where walls are drawn as two lines, a single
  // line is never a wall.
  let loops = outlines();
  const ends: WallEnd[] = hollowWalls
    ? []
    : loops.flatMap(({ points }) =>
        points.length < 3 ? [] : endCaps(points, thickness).map(i => wallEnd(points, i, thickness)),
      );
  // Where an outline turns left it wraps round ink: an outside corner of a wall
  const corners = loops.flatMap(({ points }) =>
    points.filter((p, i) => {
      const m = points.length;
      return m >= 3 && cross(sub(p, points[(i - 1 + m) % m]), sub(points[(i + 1) % m], p)) < 0;
    }),
  );
  if (restoreThinWalls(mask, ink, width, height, thickness, ends, corners)) {
    labels = labelComponents(mask, width, height).labels;
    loops = outlines();
  }

  const sides: Side[] = [];
  for (const { component, points: pts } of loops) {
    if (pts.length < 3) continue;
    for (const side of splitAtEndCaps(pts, component, thickness)) {
      side.score = enclosureScore(side, mask, width, height, thickness);
      sides.push(side);
    }
  }

  const roomSides = pickRoomSides(sides);
  if (roomSides.length === 0) return EMPTY(img, thickness);

  const minFace = Math.max(3, thickness * 0.5);
  const rooms: DetectedRoom[] = [];

  // Open wall runs, joined by openings into one loop per room
  const runs = roomSides.filter(s => !s.closed);
  if (runs.length > 0) {
    const loops = groupRuns(runs, (a, b) => {
      const end = a.points.length - 1;
      return gapBetween(
        a.points[end],
        unit(a.points[end - 1], a.points[end]),
        dist(a.points[end - 1], a.points[end]),
        b.points[0],
        unit(b.points[0], b.points[1]),
        dist(b.points[0], b.points[1]),
        mask,
        width,
        height,
        thickness,
      );
    });
    for (const { order, gaps } of loops) {
      const segments: Segment[] = [];
      const openings: RoomOpening[] = [];
      const outline: Point[] = [];
      order.forEach((runIndex, k) => {
        // Each run as far as the openings either side of it reach
        const pts = runs[runIndex].points.slice();
        const before = gaps[(k - 1 + order.length) % order.length];
        if (before.trimStart) pts[0] = before.path[before.path.length - 1];
        if (gaps[k].trimEnd) pts[pts.length - 1] = gaps[k].path[0];
        for (let i = 0; i < pts.length - 1; i++) segments.push({ a: pts[i], b: pts[i + 1] });
        outline.push(...pts);
        const g = gaps[k];
        if (g.path.length === 3) outline.push(g.path[1]);
        const length = polylineLength(g.path);
        if (length >= thickness * 0.5) openings.push({ path: g.path, lengthPx: length });
      });
      rooms.push(roomFrom(segments, openings, outline, minFace));
    }
  }
  // A closed ring of walls is a room on its own
  for (const ring of roomSides.filter(s => s.closed)) {
    const segments = ring.points.map((a, i) => ({ a, b: ring.points[(i + 1) % ring.points.length] }));
    rooms.push(roomFrom(segments, [], ring.points, minFace));
  }

  const span = thickness * MIN_ROOM_SPAN;
  const withFaces = rooms.filter(r => r.faces.length > 0);
  const real = withFaces.filter(r => (r.areaPx ?? 0) >= span * span);
  const found = (real.length ? real : withFaces).sort((a, b) => (b.areaPx ?? 0) - (a.areaPx ?? 0));
  if (found.length === 0) return EMPTY(img, thickness);
  return { width, height, wallThicknessPx: thickness, ...found[0], rooms: found };
}

interface Segment {
  a: Point;
  b: Point;
}

/** A room from its wall segments in order round it, its openings and its outline */
function roomFrom(segments: Segment[], openings: RoomOpening[], outline: Point[], minFace: number): DetectedRoom {
  const faceSegments = segments.filter(({ a, b }) => dist(a, b) >= minFace);

  // Letter the faces clockwise starting from the top wall (leftmost if several)
  const mid = ({ a, b }: Segment) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
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
  return { faces, openings, outline, areaPx: Math.abs(polygonArea(outline)) };
}
