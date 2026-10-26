/**
 * Door symbols for the WM sketch.
 *
 * A door shape's box is laid out in local coordinates (0,0)–(w,h) with the
 * wall running horizontally through it and the room above. Each style is a
 * list of drawing primitives, so the canvas and the menu icons draw the same
 * thing. The PDF export (backend sketch_pdf_service.py `_door_primitives`)
 * mirrors this file — change both together.
 */

import type { DoorType, WMShapeAnnotation } from '../../../../types/wmSketch';

export interface DoorTypeConfig {
  id: DoorType;
  name: string;
  /** Clear opening in feet for a newly placed door */
  opening_ft: number;
  /**
   * Pocket and barn doors park the panel beside the opening, so their box is
   * twice the opening: the parking side, then the opening itself.
   */
  parks_beside: boolean;
  /** Box depth: a share of the opening for doors that swing or fold, fixed feet for doors that slide */
  depth: { ratio: number } | { ft: number };
  /** Mirror-symmetric styles have nothing to flip */
  flippable: boolean;
}

export const DOOR_TYPES: Record<DoorType, DoorTypeConfig> = {
  swing:   { id: 'swing',   name: 'Swing',   opening_ft: 3,   parks_beside: false, depth: { ratio: 1 },    flippable: true },
  double:  { id: 'double',  name: 'Double',  opening_ft: 5,   parks_beside: false, depth: { ratio: 0.5 },  flippable: false },
  sliding: { id: 'sliding', name: 'Sliding', opening_ft: 6,   parks_beside: false, depth: { ft: 0.5 },     flippable: true },
  pocket:  { id: 'pocket',  name: 'Pocket',  opening_ft: 2.5, parks_beside: true,  depth: { ft: 0.5 },     flippable: true },
  bifold:  { id: 'bifold',  name: 'Bi-fold', opening_ft: 4,   parks_beside: false, depth: { ratio: 0.25 }, flippable: false },
  barn:    { id: 'barn',    name: 'Barn',    opening_ft: 3,   parks_beside: true,  depth: { ft: 0.75 },    flippable: true },
};

/** Menu order */
export const DOOR_TYPE_ORDER: DoorType[] = ['swing', 'double', 'sliding', 'pocket', 'bifold', 'barn'];

/** Fallback when the floor has no scale calibration (matches SHAPE_PRESETS defaults) */
const DEFAULT_PX_PER_FT = 20;
/** The shape Transformer refuses boxes smaller than this */
const MIN_BOX_PX = 10;

/** A door's style; legacy doors saved before styles existed are swing doors */
export function doorTypeOf(shape: Pick<WMShapeAnnotation, 'door_type'>): DoorType {
  const t = shape.door_type;
  return t && t in DOOR_TYPES ? t : 'swing';
}

// ============================================================================
// Box layout
// ============================================================================

/** Where the wall runs: through the middle for doors that slide inside it, else the bottom edge */
function wallY(type: DoorType, h: number): number {
  return type === 'sliding' || type === 'pocket' ? h / 2 : h;
}

/** Local x of the opening's left jamb */
function openingStart(type: DoorType, w: number, flipped: boolean): number {
  return DOOR_TYPES[type].parks_beside && !flipped ? w / 2 : 0;
}

function openingWidth(type: DoorType, w: number): number {
  return DOOR_TYPES[type].parks_beside ? w / 2 : w;
}

/** Box size for a door of `type` around a clear opening of `openingPx` */
function doorBoxSize(type: DoorType, openingPx: number, pxPerFt: number): { width: number; height: number } {
  const cfg = DOOR_TYPES[type];
  const scale = pxPerFt > 0 ? pxPerFt : DEFAULT_PX_PER_FT;
  const depth = 'ratio' in cfg.depth ? openingPx * cfg.depth.ratio : cfg.depth.ft * scale;
  return {
    width: Math.max(MIN_BOX_PX, cfg.parks_beside ? openingPx * 2 : openingPx),
    height: Math.max(MIN_BOX_PX, depth),
  };
}

/** Box size for a newly placed door */
export function newDoorBox(type: DoorType, pxPerFt: number): { width: number; height: number } {
  const scale = pxPerFt > 0 ? pxPerFt : DEFAULT_PX_PER_FT;
  const box = doorBoxSize(type, DOOR_TYPES[type].opening_ft * scale, scale);
  return { width: Math.round(box.width), height: Math.round(box.height) };
}

/** Local box point → parent canvas point (Konva Group: rotate about the top-left origin) */
function toParent(
  frame: Pick<WMShapeAnnotation, 'x' | 'y' | 'rotation'>,
  lx: number,
  ly: number,
): { x: number; y: number } {
  const rad = ((frame.rotation || 0) * Math.PI) / 180;
  return {
    x: frame.x + lx * Math.cos(rad) - ly * Math.sin(rad),
    y: frame.y + lx * Math.sin(rad) + ly * Math.cos(rad),
  };
}

/**
 * Patch that redraws a door as another style. The opening keeps its width and
 * its left jamb stays on the same spot of the wall; the box regrows around it.
 */
export function retypeDoor(
  shape: WMShapeAnnotation,
  next: DoorType,
  pxPerFt: number,
): Pick<WMShapeAnnotation, 'door_type' | 'x' | 'y' | 'width' | 'height'> {
  const prev = doorTypeOf(shape);
  const flipped = !!shape.flip_x;
  const jamb = toParent(shape, openingStart(prev, shape.width, flipped), wallY(prev, shape.height));
  const { width, height } = doorBoxSize(next, openingWidth(prev, shape.width), pxPerFt);
  const offset = toParent({ x: 0, y: 0, rotation: shape.rotation }, openingStart(next, width, flipped), wallY(next, height));
  return { door_type: next, x: jamb.x - offset.x, y: jamb.y - offset.y, width, height };
}

/**
 * Patch that mirrors a door. Pocket and barn doors move their parking side to
 * the other side of the opening, so the box shifts to keep the opening put.
 */
export function flipDoor(shape: WMShapeAnnotation): Pick<WMShapeAnnotation, 'flip_x' | 'x' | 'y'> {
  const type = doorTypeOf(shape);
  const flipped = !!shape.flip_x;
  const shift = openingStart(type, shape.width, flipped) - openingStart(type, shape.width, !flipped);
  const d = toParent({ x: 0, y: 0, rotation: shape.rotation }, shift, 0);
  return { flip_x: !flipped, x: shape.x + d.x, y: shape.y + d.y };
}

// ============================================================================
// Symbols
// ============================================================================

export type DoorPrimitive =
  /** Polyline: 'panel' weight for door leaves, 'thin' for jambs and tracks */
  | { kind: 'line'; points: number[]; weight: 'panel' | 'thin'; dashed?: boolean }
  /** Sliding panel seen edge-on; dashed while hidden inside the wall */
  | { kind: 'rect'; x: number; y: number; width: number; height: number; dashed?: boolean }
  /** 90° swing sector pivoting at (x, y), starting `rotation` degrees clockwise from +x */
  | { kind: 'swing'; x: number; y: number; radius: number; rotation: number }
  | { kind: 'hinge'; x: number; y: number };

/** Drawing primitives for a door box of w × h, in box-local coordinates */
export function doorSymbol(type: DoorType, w: number, h: number, flipped: boolean): DoorPrimitive[] {
  const parts = unflippedSymbol(type, w, h);
  return flipped ? parts.map((p) => mirror(p, w)) : parts;
}

const jambs = (x1: number, x2: number, y1: number, y2: number): DoorPrimitive[] => [
  { kind: 'line', points: [x1, y1, x1, y2], weight: 'thin' },
  { kind: 'line', points: [x2, y1, x2, y2], weight: 'thin' },
];

function unflippedSymbol(type: DoorType, w: number, h: number): DoorPrimitive[] {
  switch (type) {
    case 'double': {
      // Two leaves meeting in the middle, one hinged at each jamb
      const r = Math.min(w / 2, h);
      return [
        { kind: 'line', points: [0, h, w, h], weight: 'panel' },
        { kind: 'swing', x: 0, y: h, radius: r, rotation: -90 },
        { kind: 'swing', x: w, y: h, radius: r, rotation: 180 },
        { kind: 'hinge', x: 0, y: h },
        { kind: 'hinge', x: w, y: h },
      ];
    }
    case 'sliding':
      // Bypass panels on two tracks, overlapping in the middle
      return [
        ...jambs(0, w, 0, h),
        { kind: 'rect', x: 0, y: h * 0.5, width: w * 0.55, height: h * 0.4 },
        { kind: 'rect', x: w * 0.45, y: h * 0.1, width: w * 0.55, height: h * 0.4 },
      ];
    case 'pocket':
      // Pocket on the left half, opening on the right; the panel is pulled a little out of the wall
      return [
        ...jambs(w / 2, w, 0, h),
        { kind: 'rect', x: w * 0.1, y: h * 0.3, width: w * 0.4, height: h * 0.4, dashed: true },
        { kind: 'rect', x: w * 0.5, y: h * 0.3, width: w * 0.1, height: h * 0.4 },
      ];
    case 'bifold':
      // Two leaf pairs folding toward their jambs: /\/\
      return [
        { kind: 'line', points: [0, h, w * 0.25, 0, w * 0.5, h], weight: 'panel' },
        { kind: 'line', points: [w, h, w * 0.75, 0, w * 0.5, h], weight: 'panel' },
        { kind: 'hinge', x: 0, y: h },
        { kind: 'hinge', x: w, y: h },
      ];
    case 'barn':
      // Panel hung on the room side over the opening (right half); the track runs on over the parking side
      return [
        ...jambs(w / 2, w, h * 0.65, h),
        { kind: 'line', points: [0, h * 0.12, w, h * 0.12], weight: 'thin', dashed: true },
        { kind: 'rect', x: w * 0.45, y: h * 0.25, width: w * 0.55, height: h * 0.35 },
      ];
    case 'swing':
    default: {
      // Leaf drawn closed along the wall, swing sector up into the room
      const r = Math.min(w, h);
      return [
        { kind: 'line', points: [0, h, w, h], weight: 'panel' },
        { kind: 'swing', x: 0, y: h, radius: r, rotation: -90 },
        { kind: 'hinge', x: 0, y: h },
      ];
    }
  }
}

function mirror(p: DoorPrimitive, w: number): DoorPrimitive {
  switch (p.kind) {
    case 'line':
      return { ...p, points: p.points.map((v, i) => (i % 2 === 0 ? w - v : v)) };
    case 'rect':
      return { ...p, x: w - p.x - p.width };
    case 'swing':
      // Angles reflect about the vertical: [a, a+90] → [90-a, 180-a]
      return { ...p, x: w - p.x, rotation: 90 - p.rotation };
    case 'hinge':
      return { ...p, x: w - p.x };
  }
}

/** SVG path for a swing sector: pivot → arc start → 90° clockwise arc → back to the pivot */
export function swingSectorPath(p: Extract<DoorPrimitive, { kind: 'swing' }>): string {
  const a0 = (p.rotation * Math.PI) / 180;
  const a1 = ((p.rotation + 90) * Math.PI) / 180;
  const f = (v: number) => +v.toFixed(2);
  return (
    `M ${f(p.x)} ${f(p.y)} ` +
    `L ${f(p.x + p.radius * Math.cos(a0))} ${f(p.y + p.radius * Math.sin(a0))} ` +
    `A ${f(p.radius)} ${f(p.radius)} 0 0 1 ${f(p.x + p.radius * Math.cos(a1))} ${f(p.y + p.radius * Math.sin(a1))} Z`
  );
}
