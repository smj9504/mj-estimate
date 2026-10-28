/**
 * What goes on top of a room capture: the measured room, a line along each
 * inside face with its length, the openings, and the line the user may draw
 * between two points to set the scale. Shared by the on-screen
 * drawing (SVG) and the downloaded PNG so both read the same.
 *
 * Sizes are in screen pixels; `unit` is image pixels per screen pixel, so
 * labels keep one size however far the capture is zoomed.
 */

import { colors, fontFamily } from '../../styles/tokens';
import { formatDimension } from '../water-mitigation/sketch/utils/wmCalculations';
import { polylineLength, type Point, type RoomDetection, type RoomOpening, type WallFace } from '../../utils/roomDimensions';
import { angleText, type TraceMetrics, type TraceSegment } from '../../utils/roomTrace';

export const DRAWING_COLORS = {
  face: colors.primary,
  faceActive: colors.primaryDeep,
  ink: colors.neutral900,
  opening: '#9b9a97',
  hairline: colors.neutral400,
  room: 'rgba(31, 116, 201, 0.07)',
  pill: '#ffffff',
  /** Traced outline, its corner dots, and the angle at a corner */
  trace: colors.primary,
  traceVertex: colors.primaryDeep,
  angle: colors.neutral600,
  /** Corners that are not square — the ones the user is looking for */
  angleWarn: colors.warning,
  /** The line the user draws between two points to set the scale */
  line: colors.purple,
};

/** What the drawn line is called, on the drawing and beside the wall letters as a scale reference */
export const LINE_LABEL = 'Line';

export const LABEL_FONT = fontFamily.system;
const FONT_SIZE = 12;
const PILL_HEIGHT = 18;
const PILL_PAD = 5;
/** Space between a face and its label */
const LABEL_GAP = 5;

export interface LabelBox {
  cx: number;
  cy: number;
  /** Degrees, kept between -90 and 90 so text never reads upside down */
  angle: number;
  width: number;
  height: number;
  fontSize: number;
  text: string;
}

export const lengthText = (lengthPx: number, pxPerFt: number | null) =>
  pxPerFt ? formatDimension(lengthPx / pxPerFt) : null;

/** Before a scale is set a face shows its letter; after, its length */
export const faceText = (face: WallFace, pxPerFt: number | null) => lengthText(face.lengthPx, pxPerFt) ?? face.label;

function box(center: Point, a: Point, b: Point, text: string, unit: number): LabelBox {
  let angle = (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
  if (angle >= 90) angle -= 180;
  if (angle < -90) angle += 180;
  // A lone letter reads best upright; lengths run along their wall
  if (text.length <= 2) angle = 0;
  return {
    cx: center.x,
    cy: center.y,
    angle,
    width: (text.length * 0.62 * FONT_SIZE + PILL_PAD * 2) * unit,
    height: PILL_HEIGHT * unit,
    fontSize: FONT_SIZE * unit,
    text,
  };
}

/** Label inside the room, just off the middle of the face */
export function faceLabel(face: WallFace, text: string, unit: number): LabelBox {
  const offset = (LABEL_GAP + PILL_HEIGHT / 2) * unit;
  const center = {
    x: (face.start.x + face.end.x) / 2 + face.normal.x * offset,
    y: (face.start.y + face.end.y) / 2 + face.normal.y * offset,
  };
  return box(center, face.start, face.end, text, unit);
}

/** Label sitting on the opening's dashed line, halfway along it */
export function openingLabel(opening: RoomOpening, text: string, unit: number): LabelBox {
  const half = polylineLength(opening.path) / 2;
  let walked = 0;
  for (let i = 0; i < opening.path.length - 1; i++) {
    const a = opening.path[i];
    const b = opening.path[i + 1];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (walked + len >= half || i === opening.path.length - 2) {
      const t = len ? (half - walked) / len : 0;
      return box({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }, a, b, text, unit);
    }
    walked += len;
  }
  return box(opening.path[0], opening.path[0], opening.path[0], text, unit);
}

// ============================================================================
// Hand-traced outline (Trace walls mode)
// ============================================================================

/** The middle of a traced outline, so labels can be nudged toward the inside */
export function centroid(points: Point[]): Point {
  if (points.length === 0) return { x: 0, y: 0 };
  const sum = points.reduce((acc, p) => ({ x: acc.x + p.x, y: acc.y + p.y }), { x: 0, y: 0 });
  return { x: sum.x / points.length, y: sum.y / points.length };
}

/** A pill that always reads upright, centred on a point */
function uprightBox(center: Point, text: string, unit: number): LabelBox {
  return {
    cx: center.x,
    cy: center.y,
    angle: 0,
    width: (text.length * 0.62 * FONT_SIZE + PILL_PAD * 2) * unit,
    height: PILL_HEIGHT * unit,
    fontSize: FONT_SIZE * unit,
    text,
  };
}

/** Length label running along a traced segment, nudged toward the room inside */
export function traceLengthLabel(seg: TraceSegment, inside: Point, text: string, unit: number): LabelBox {
  const mid = { x: (seg.start.x + seg.end.x) / 2, y: (seg.start.y + seg.end.y) / 2 };
  const len = Math.hypot(seg.end.x - seg.start.x, seg.end.y - seg.start.y) || 1;
  // Unit normal pointing toward the inside point
  let nx = -(seg.end.y - seg.start.y) / len;
  let ny = (seg.end.x - seg.start.x) / len;
  if ((inside.x - mid.x) * nx + (inside.y - mid.y) * ny < 0) {
    nx = -nx;
    ny = -ny;
  }
  const offset = (LABEL_GAP + PILL_HEIGHT / 2) * unit;
  return box({ x: mid.x + nx * offset, y: mid.y + ny * offset }, seg.start, seg.end, text, unit);
}

/** Angle pill sitting just inside a traced corner */
export function traceAngleLabel(corner: Point, inside: Point, text: string, unit: number): LabelBox {
  const dx = inside.x - corner.x;
  const dy = inside.y - corner.y;
  const d = Math.hypot(dx, dy) || 1;
  const offset = (PILL_HEIGHT + LABEL_GAP) * unit;
  return uprightBox({ x: corner.x + (dx / d) * offset, y: corner.y + (dy / d) * offset }, text, unit);
}

/** Short marks across both ends of a face, like a dimension line */
export function faceTicks(face: WallFace, unit: number): [Point, Point][] {
  const half = 4 * unit;
  return [face.start, face.end].map(p => [
    { x: p.x - face.normal.x * half, y: p.y - face.normal.y * half },
    { x: p.x + face.normal.x * half, y: p.y + face.normal.y * half },
  ]);
}

// ============================================================================
// Scale line
// ============================================================================

/** Label sitting on the drawn line, halfway along it, like a dimension string */
export function scaleLineLabel(a: Point, b: Point, text: string, unit: number): LabelBox {
  return box({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, a, b, text, unit);
}

/** Short marks across both ends of the drawn line */
export function scaleLineTicks(a: Point, b: Point, unit: number): [Point, Point][] {
  const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  const n = { x: -(b.y - a.y) / len, y: (b.x - a.x) / len };
  const half = 5 * unit;
  return [a, b].map(p => [
    { x: p.x - n.x * half, y: p.y - n.y * half },
    { x: p.x + n.x * half, y: p.y + n.y * half },
  ]);
}

// ============================================================================
// PNG export
// ============================================================================

function roundedRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function drawLabel(ctx: CanvasRenderingContext2D, label: LabelBox, unit: number, textColor: string, border: string) {
  ctx.save();
  ctx.translate(label.cx, label.cy);
  ctx.rotate((label.angle * Math.PI) / 180);
  ctx.font = `500 ${label.fontSize}px ${LABEL_FONT}`;
  const width = Math.max(label.width, ctx.measureText(label.text).width + PILL_PAD * 2 * unit);
  roundedRect(ctx, -width / 2, -label.height / 2, width, label.height, 4 * unit);
  ctx.fillStyle = DRAWING_COLORS.pill;
  ctx.fill();
  ctx.lineWidth = unit;
  ctx.strokeStyle = border;
  ctx.stroke();
  ctx.fillStyle = textColor;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label.text, 0, unit);
  ctx.restore();
}

/** The drawn line with its length (or its name before a scale is set), over everything else */
function drawScaleLine(ctx: CanvasRenderingContext2D, line: Point[], pxPerFt: number | null, unit: number) {
  if (line.length < 2) return;
  const [a, b] = line;
  ctx.strokeStyle = DRAWING_COLORS.line;
  ctx.lineWidth = 2 * unit;
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.stroke();
  ctx.lineWidth = 1.5 * unit;
  for (const [p, q] of scaleLineTicks(a, b, unit)) {
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    ctx.lineTo(q.x, q.y);
    ctx.stroke();
  }
  const text = lengthText(Math.hypot(b.x - a.x, b.y - a.y), pxPerFt) ?? LINE_LABEL;
  drawLabel(ctx, scaleLineLabel(a, b, text, unit), unit, DRAWING_COLORS.line, DRAWING_COLORS.line);
}

/**
 * The capture with every length drawn on it, as a PNG. Small captures are
 * scaled up so the labels stay sharp when the image is shared.
 */
export function renderDrawingPng(
  image: CanvasImageSource,
  detection: RoomDetection,
  pxPerFt: number | null,
  /** The drawn line in the detection's pixels, when there is one */
  line: Point[] = [],
): Promise<Blob> {
  const { width, height } = detection;
  const factor = Math.min(3, Math.max(1, 1600 / Math.max(width, height)));
  // A shared image is usually seen smaller than it is, so its labels run a little larger
  const unit = 1.25 / factor;
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(width * factor);
  canvas.height = Math.round(height * factor);
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
  ctx.scale(factor, factor);
  ctx.lineCap = 'round';

  if (detection.outline) {
    ctx.beginPath();
    detection.outline.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
    ctx.closePath();
    ctx.fillStyle = DRAWING_COLORS.room;
    ctx.fill();
  }

  ctx.setLineDash([4 * unit, 3 * unit]);
  ctx.lineWidth = 1.5 * unit;
  ctx.strokeStyle = DRAWING_COLORS.opening;
  for (const opening of detection.openings) {
    ctx.beginPath();
    opening.path.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
    ctx.stroke();
  }
  ctx.setLineDash([]);

  ctx.strokeStyle = DRAWING_COLORS.face;
  for (const face of detection.faces) {
    ctx.lineWidth = 2 * unit;
    ctx.beginPath();
    ctx.moveTo(face.start.x, face.start.y);
    ctx.lineTo(face.end.x, face.end.y);
    ctx.stroke();
    ctx.lineWidth = 1.5 * unit;
    for (const [a, b] of faceTicks(face, unit)) {
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }
  }

  for (const opening of detection.openings) {
    const text = lengthText(opening.lengthPx, pxPerFt);
    if (text) drawLabel(ctx, openingLabel(opening, text, unit), unit, colors.neutral600, DRAWING_COLORS.hairline);
  }
  for (const face of detection.faces) {
    drawLabel(ctx, faceLabel(face, faceText(face, pxPerFt), unit), unit, DRAWING_COLORS.ink, DRAWING_COLORS.face);
  }
  drawScaleLine(ctx, line, pxPerFt, unit);

  return new Promise((resolve, reject) =>
    canvas.toBlob(blob => (blob ? resolve(blob) : reject(new Error('Could not create the image'))), 'image/png'),
  );
}

/**
 * The capture with a hand-traced outline on it: each wall run's length and
 * each corner's angle, square corners quietly and the rest in warning colour.
 */
export function renderTracePng(
  image: CanvasImageSource,
  imageWidth: number,
  imageHeight: number,
  metrics: TraceMetrics,
  points: Point[],
  pxPerFt: number | null,
  line: Point[] = [],
): Promise<Blob> {
  const factor = Math.min(3, Math.max(1, 1600 / Math.max(imageWidth, imageHeight)));
  const unit = 1.25 / factor;
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(imageWidth * factor);
  canvas.height = Math.round(imageHeight * factor);
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
  ctx.scale(factor, factor);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  if (metrics.closed && points.length >= 3) {
    ctx.beginPath();
    points.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
    ctx.closePath();
    ctx.fillStyle = DRAWING_COLORS.room;
    ctx.fill();
  }

  ctx.strokeStyle = DRAWING_COLORS.trace;
  ctx.lineWidth = 2 * unit;
  for (const seg of metrics.segments) {
    ctx.beginPath();
    ctx.moveTo(seg.start.x, seg.start.y);
    ctx.lineTo(seg.end.x, seg.end.y);
    ctx.stroke();
  }

  ctx.fillStyle = DRAWING_COLORS.traceVertex;
  for (const p of points) {
    ctx.beginPath();
    ctx.arc(p.x, p.y, 2.5 * unit, 0, Math.PI * 2);
    ctx.fill();
  }

  const inside = centroid(points);
  for (const seg of metrics.segments) {
    const text = lengthText(seg.lengthPx, pxPerFt) ?? seg.label;
    drawLabel(ctx, traceLengthLabel(seg, inside, text, unit), unit, DRAWING_COLORS.ink, DRAWING_COLORS.trace);
  }
  for (const v of metrics.vertices) {
    const text = angleText(v.angleDeg);
    if (!text) continue;
    const color = v.isRightAngle ? DRAWING_COLORS.angle : DRAWING_COLORS.angleWarn;
    drawLabel(ctx, traceAngleLabel(v.point, inside, text, unit), unit, color, color);
  }
  drawScaleLine(ctx, line, pxPerFt, unit);

  return new Promise((resolve, reject) =>
    canvas.toBlob(blob => (blob ? resolve(blob) : reject(new Error('Could not create the image'))), 'image/png'),
  );
}
