/**
 * Measurements for a hand-traced room outline.
 *
 * The Room Dimensions tool can measure clean room captures on its own, but a
 * fully dimensioned architectural plan — thin double-line walls, extension
 * lines, arrowheads and printed dimensions all over — is too noisy to trace
 * from pixels. Instead the user clicks the wall corners and this turns those
 * points into the two things the drawing leaves out: the length of each wall
 * run and the angle at each corner.
 *
 * Everything here is in image pixels. One traced segment's known real length
 * sets the scale, so the screenshot's zoom does not matter.
 */

import type { Point } from './roomDimensions';

export interface TraceSegment {
  /** A, B, C… in trace order */
  label: string;
  start: Point;
  end: Point;
  lengthPx: number;
  /** Heading in degrees, 0 = pointing right (east) on screen, down is positive */
  headingDeg: number;
}

export interface TraceVertex {
  /** Index into the traced points */
  index: number;
  point: Point;
  /** Corner angle in degrees (0–180), or null at the open end of a polyline */
  angleDeg: number | null;
  /** The two segments meeting here, by label (one side is null at an open end) */
  fromLabel: string | null;
  toLabel: string | null;
  isRightAngle: boolean;
}

export interface TraceMetrics {
  segments: TraceSegment[];
  vertices: TraceVertex[];
  closed: boolean;
  perimeterPx: number;
  /** Floor area inside the outline in square pixels, only when closed */
  areaPx: number | null;
}

/** A corner is "square" when it sits within this many degrees of 90° */
export const RIGHT_ANGLE_TOLERANCE_DEG = 2;

const dist = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);

export const segmentLabel = (i: number): string =>
  i < 26
    ? String.fromCharCode(65 + i)
    : `${String.fromCharCode(65 + Math.floor(i / 26) - 1)}${String.fromCharCode(65 + (i % 26))}`;

/**
 * The corner angle at `v` between its neighbours, as a protractor reads it:
 * 90° for a square corner, 180° for a straight run, 45° for a sharp turn.
 */
export function cornerAngle(prev: Point, v: Point, next: Point): number {
  const a = { x: prev.x - v.x, y: prev.y - v.y };
  const b = { x: next.x - v.x, y: next.y - v.y };
  const la = Math.hypot(a.x, a.y);
  const lb = Math.hypot(b.x, b.y);
  if (la === 0 || lb === 0) return 0;
  const cos = Math.min(1, Math.max(-1, (a.x * b.x + a.y * b.y) / (la * lb)));
  return (Math.acos(cos) * 180) / Math.PI;
}

/** Shoelace area; sign depends on winding, so callers take the absolute value */
function polygonArea(points: Point[]): number {
  let sum = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    sum += a.x * b.y - b.x * a.y;
  }
  return sum / 2;
}

/**
 * Lengths, headings and corner angles for a traced outline. `closed` adds the
 * segment back to the first point and gives both end points a corner angle.
 */
export function traceMetrics(
  points: Point[],
  closed: boolean,
  rightAngleToleranceDeg = RIGHT_ANGLE_TOLERANCE_DEG,
): TraceMetrics {
  const n = points.length;
  const canClose = closed && n >= 3;

  const segments: TraceSegment[] = [];
  const segCount = canClose ? n : Math.max(0, n - 1);
  for (let i = 0; i < segCount; i++) {
    const start = points[i];
    const end = points[(i + 1) % n];
    segments.push({
      label: segmentLabel(i),
      start,
      end,
      lengthPx: dist(start, end),
      headingDeg: (Math.atan2(end.y - start.y, end.x - start.x) * 180) / Math.PI,
    });
  }

  const vertices: TraceVertex[] = [];
  for (let i = 0; i < n; i++) {
    const hasPrev = canClose || i > 0;
    const hasNext = canClose || i < n - 1;
    let angleDeg: number | null = null;
    if (hasPrev && hasNext && n >= 3) {
      angleDeg = cornerAngle(points[(i - 1 + n) % n], points[i], points[(i + 1) % n]);
    }
    vertices.push({
      index: i,
      point: points[i],
      angleDeg,
      fromLabel: hasPrev ? segmentLabel((i - 1 + n) % n) : null,
      toLabel: hasNext ? segmentLabel(i) : null,
      isRightAngle: angleDeg != null && Math.abs(angleDeg - 90) <= rightAngleToleranceDeg,
    });
  }

  return {
    segments,
    vertices,
    closed: canClose,
    perimeterPx: segments.reduce((sum, s) => sum + s.lengthPx, 0),
    areaPx: canClose ? Math.abs(polygonArea(points)) : null,
  };
}

/**
 * The corners of an outline worth tracing by hand: points closer than
 * `minGap` to the corner before them merge into it, and points where the
 * outline runs straight on are dropped. Used to hand a detected room to
 * Trace walls with only the corners a person would have clicked.
 */
export function outlineCorners(points: Point[], minGap: number, straightDeg = 3): Point[] {
  let kept: Point[] = [];
  for (const p of points) {
    if (!kept.length || dist(p, kept[kept.length - 1]) >= minGap) kept.push(p);
  }
  if (kept.length > 1 && dist(kept[0], kept[kept.length - 1]) < minGap) kept.pop();

  for (let changed = true; changed && kept.length > 3; ) {
    changed = false;
    for (let i = 0; i < kept.length && kept.length > 3; i++) {
      const n = kept.length;
      if (cornerAngle(kept[(i - 1 + n) % n], kept[i], kept[(i + 1) % n]) > 180 - straightDeg) {
        kept = kept.filter((_, k) => k !== i);
        changed = true;
      }
    }
  }
  return kept;
}

/** Degrees as the drawing shows them: whole numbers, with 90° exact for square corners */
export function angleText(angleDeg: number | null): string | null {
  if (angleDeg == null) return null;
  const rounded = Math.round(angleDeg);
  return `${rounded}°`;
}
