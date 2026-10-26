/**
 * Door, drawer and appliance-opening layout on a cabinet's front, by type
 * and specialty. Shared by the Front (elevation) view, which draws it flat,
 * and the 3D view, which stands it on each cabinet's door side.
 *
 * Pure functions only, like cabinetSketchLayout.ts.
 */

import type { CabType, SpecialtyType } from '../../../types/cabinetEstimate';
import { blindLengthIn, cabinetDepthIn, cornerKind } from './cabinetSketchLayout';
import type { CornerKind } from './cabinetSketchLayout';

export const COUNTER_TOP_IN = 36;
export const TOE_KICK_IN = 4;
/** Gap between doors/drawers and the box edge, inches. */
export const REVEAL_IN = 0.75;
/** Width of the door frame around a glass insert, inches. */
export const GLASS_STILE_IN = 2.25;
/** Cabinets whose top is at least this high (uppers, talls, bridges) take crown molding. */
export const CROWN_MIN_TOP_IN = 72;
/**
 * Crown molding as stepped bands over a cabinet's top, each [from, to, out]:
 * inches above the top, and how far it stands out past the cabinet's exposed
 * sides. 3¾" tall, 2¾" out — a common stock crown. The 3D and Front views both draw it.
 */
export const CROWN_BANDS: [number, number, number][] = [
  [0, 0.75, 0.5],
  [0.75, 2.25, 1.5],
  [2.25, 3.25, 2.5],
  [3.25, 3.75, 2.75],
];
export const CROWN_HEIGHT_IN = CROWN_BANDS[CROWN_BANDS.length - 1][1];

export type FaceKind = 'door' | 'drawer' | 'panel' | 'opening';

/** An oven cabinet's opening: where the oven sits, inches above the floor. */
export const ovenOpening = (specialty?: SpecialtyType | null) =>
  specialty === 'double_oven_cabinet' ? { bottom: 22, height: 52 } : { bottom: 30, height: 30 };

/** How tall a refrigerator cabinet's opening is, under its upper doors, for a cabinet `h` tall. */
export const fridgeOpeningHeight = (h: number) => h - Math.min(24, h * 0.3) - REVEAL_IN;

/** A door, drawer or appliance opening, in inches from the cabinet's bottom-left (y up). */
export interface Face {
  x: number;
  y: number;
  w: number;
  h: number;
  kind: FaceKind;
  label?: string;
}

/** n equal doors side by side across [x, x + w]. */
function doorRow(x: number, y: number, w: number, h: number, n: number, kind: FaceKind = 'door'): Face[] {
  const each = (w - REVEAL_IN * (n + 1)) / n;
  return Array.from({ length: n }, (_, i) => ({
    x: x + REVEAL_IN + i * (each + REVEAL_IN),
    y,
    w: each,
    h,
    kind,
  }));
}

const doorCount = (w: number) => (w >= 24 ? 2 : 1);

/**
 * Front of a corner unit. Its corner end shows no front of its own — an L
 * or diagonal's other leg comes toward the viewer, a blind corner's end
 * hides behind the other run — so doors go only on the open part.
 */
function cornerFaces(
  cabType: CabType,
  specialty: SpecialtyType,
  kind: CornerKind,
  side: 'left' | 'right',
  w: number,
  h: number
): Face[] {
  const r = REVEAL_IN;
  const bottom = cabType === 'wall' ? r : TOE_KICK_IN + r;
  // An angle end's cut face spans its whole width: full-height doors across it (two on BEC24).
  if (kind === 'angle_end') return doorRow(0, bottom, w, h - r - bottom, doorCount(w));
  const cornerLen =
    kind === 'blind' ? Math.min(blindLengthIn(cabType), w * 0.75) : cabinetDepthIn(cabType, specialty);
  const openW = w - cornerLen;
  const faces: Face[] =
    kind === 'blind'
      ? [
          { x: r, y: bottom, w: cornerLen - r, h: h - r - bottom, kind: 'panel', label: 'BLIND' },
          // The open part reads like a plain box of its width.
          ...facesFor(cabType, undefined, openW, h).map((f) => ({ ...f, x: f.x + cornerLen })),
        ]
      : // Lazy susan / easy-reach / diagonal: one full-height door on the open leaf.
        doorRow(cornerLen, bottom, openW, h - r - bottom, 1);
  return side === 'right' ? faces.map((f) => ({ ...f, x: w - f.x - f.w })) : faces;
}

/** Front layout of a cabinet by type, following the catalog's specialty. */
export function facesFor(
  cabType: CabType,
  specialty: SpecialtyType | undefined,
  w: number,
  h: number,
  cornerSide: 'left' | 'right' = 'left'
): Face[] {
  const inner = w - REVEAL_IN * 2;
  const r = REVEAL_IN;

  const corner = cornerKind(specialty);
  if (corner && specialty) return cornerFaces(cabType, specialty, corner, cornerSide, w, h);

  if (cabType === 'wall') {
    return doorRow(0, r, w, h - r * 2, doorCount(w));
  }

  if (cabType === 'tall') {
    const bottom = TOE_KICK_IN + r;
    if (specialty === 'refrigerator_cabinet') {
      const upper = Math.min(24, h * 0.3);
      return [
        { x: r, y: 0, w: inner, h: fridgeOpeningHeight(h), kind: 'opening', label: 'FRIDGE' },
        ...doorRow(0, h - upper, w, upper - r, doorCount(w)),
      ];
    }
    if (specialty === 'oven_cabinet' || specialty === 'double_oven_cabinet') {
      const { height: ovenH, bottom: ovenBottom } = ovenOpening(specialty);
      const upperY = ovenBottom + ovenH + r;
      return [
        ...doorRow(0, bottom, w, ovenBottom - bottom - r, 1, 'drawer'),
        { x: r, y: ovenBottom, w: inner, h: ovenH, kind: 'opening', label: specialty === 'double_oven_cabinet' ? 'OVEN ×2' : 'OVEN' },
        ...doorRow(0, upperY, w, h - upperY - r, doorCount(w)),
      ];
    }
    // Pantry: tall lower doors, shorter upper doors.
    const split = Math.max(bottom + 30, h * 0.6);
    return [
      ...doorRow(0, bottom, w, split - bottom - r / 2, doorCount(w)),
      ...doorRow(0, split + r / 2, w, h - split - r * 1.5, doorCount(w)),
    ];
  }

  // Base (and the legacy 'specialty' type).
  const bottom = TOE_KICK_IN + r;
  const top = h - r;
  const drawerH = 6;
  const below = top - drawerH - r - bottom;

  switch (specialty) {
    case 'range_base_slide_in':
    case 'range_base_drop_in':
      return [{ x: r, y: 0, w: inner, h: h + 1.5, kind: 'opening', label: 'RANGE' }];
    case 'drawer_base': {
      const rest = (top - drawerH - r - bottom - r) / 2;
      return [
        { x: r, y: bottom, w: inner, h: rest, kind: 'drawer' },
        { x: r, y: bottom + rest + r, w: inner, h: rest, kind: 'drawer' },
        { x: r, y: top - drawerH, w: inner, h: drawerH, kind: 'drawer' },
      ];
    }
    case 'trash_pullout':
      return [
        { x: r, y: bottom, w: inner, h: below, kind: 'drawer' },
        { x: r, y: top - drawerH, w: inner, h: drawerH, kind: 'drawer' },
      ];
    case 'microwave_drawer_base': {
      const mwH = 15;
      return [
        { x: r, y: bottom, w: inner, h: top - mwH - r - bottom, kind: 'drawer' },
        { x: r, y: top - mwH, w: inner, h: mwH, kind: 'opening', label: 'MW' },
      ];
    }
    case 'farmhouse_sink_base': {
      const apronH = 10;
      return [
        ...doorRow(0, bottom, w, top - apronH - r - bottom, doorCount(w)),
        { x: r, y: top - apronH, w: inner, h: apronH, kind: 'panel', label: 'APRON SINK' },
      ];
    }
    case 'sink_base':
      return [
        ...doorRow(0, bottom, w, below, doorCount(w)),
        { x: r, y: top - drawerH, w: inner, h: drawerH, kind: 'panel', label: 'SINK' },
      ];
    default:
      return [
        ...doorRow(0, bottom, w, below, doorCount(w)),
        ...doorRow(0, top - drawerH, w, drawerH, w >= 30 ? 2 : 1, 'drawer'),
      ];
  }
}
