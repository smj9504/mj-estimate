/**
 * 3D model of the cabinet sketch: each placed cabinet as a solid with its
 * doors and drawers on its door side, plus the drawn walls, in inches —
 * what the 3D view turns into meshes (see cabinet3dScene.ts).
 *
 * Built from the same data as the Front view: position and turn from the
 * floor plan, size from the Edit tab box, upper heights from
 * mountHeightsIn, fronts from facesFor. Pure, so it is tested without WebGL.
 *
 * Coordinates: x and z are the plan's x and y in inches (z grows down the
 * screen), y is height above the floor. A cabinet's local frame is the
 * plan's: x along its run, z from its back (0) toward its doors.
 */

import type { CabinetSketchCabinet, CabinetSketchWall } from '../../../types/cabinetSketch';
import { cabinetDepthIn, cabinetSizeIn, cornerKind, mountHeightsIn, pxToIn } from './cabinetSketchLayout';
import type { PresetCatalog } from './cabinetSketchLayout';
import { COUNTER_TOP_IN, TOE_KICK_IN, facesFor } from './cabinetFronts';
import type { Face } from './cabinetFronts';

export type Pt2 = [number, number];

/** How far the toe kick is set back from the doors, inches. */
const TOE_SETBACK_IN = 3;
/** Countertop overhang past the doors, inches. */
const COUNTER_OVERHANG_IN = 1;

/**
 * A flat stretch of a cabinet's door side, local inches. It runs from `a`
 * to `b` left to right as seen standing in front of it, so its outward
 * normal is (-dz, dx); faces are measured along it from `a`.
 */
export interface FrontRun {
  a: Pt2;
  b: Pt2;
  faces: Face[];
}

export interface CabinetSolid {
  cabinet: CabinetSketchCabinet;
  /** Back-left corner on the floor plan, inches, and the plan rotation (degrees) about it. */
  x: number;
  z: number;
  rotation: number;
  /** Height of the cabinet's bottom above the floor. */
  bottom: number;
  /** Height of the box, from its bottom. */
  height: number;
  /** Plan outline, local inches. */
  outline: Pt2[];
  /** Recessed toe kick under a floor cabinet: its height (0 for none) and outline. */
  toeKick: number;
  toeOutline: Pt2[];
  fronts: FrontRun[];
  /** Countertop over a base, local inches, from the box top up to COUNTER_TOP_IN; null for none. */
  counter: Pt2[] | null;
  /** A range: an appliance standing in the run, not a cabinet box. */
  appliance: boolean;
  glass: boolean;
}

export interface WallSolid {
  id: string;
  a: Pt2;
  b: Pt2;
  thickness: number;
}

/** Faces laid out across [from, from + span] of the cabinet's width, stretched onto a run `len` long. */
function fitFaces(faces: Face[], from: number, span: number, len: number): Face[] {
  const k = span > 0 ? len / span : 1;
  return faces.map((f) => ({ ...f, x: (f.x - from) * k, w: f.w * k }));
}

const runLength = ({ a, b }: Pick<FrontRun, 'a' | 'b'>) => Math.hypot(b[0] - a[0], b[1] - a[1]);

function cabinetSolid(
  cabinet: CabinetSketchCabinet,
  presets: PresetCatalog,
  scalePixelsPerFoot: number,
  bottom: number
): CabinetSolid {
  const specialty = presets[cabinet.preset_code]?.specialty;
  const { width: w, depth: d, height } = cabinetSizeIn(cabinet, presets, scalePixelsPerFoot);
  const kind = cornerKind(specialty);
  const right = cabinet.corner_side === 'right';
  const leg = Math.min(cabinetDepthIn(cabinet.cab_type, specialty), w, d);
  const faces = facesFor(cabinet.cab_type, specialty, w, height, cabinet.corner_side);
  const appliance = specialty === 'range_base_slide_in' || specialty === 'range_base_drop_in';
  const mirror = (pts: Pt2[]): Pt2[] => (right ? pts.map(([x, z]) => [w - x, z] as Pt2) : pts);

  let outline: Pt2[];
  let fronts: FrontRun[];
  if (kind === 'l') {
    // The open leaf's doors face the room along the back leg; the other leg
    // gets a matching door on its inside face.
    outline = mirror([[0, 0], [w, 0], [w, leg], [leg, leg], [leg, d], [0, d]]);
    const side: Pick<FrontRun, 'a' | 'b'> = right
      ? { a: [w - leg, leg], b: [w - leg, d] }
      : { a: [leg, d], b: [leg, leg] };
    fronts = [
      { a: [0, leg], b: [w, leg], faces },
      { ...side, faces: fitFaces(faces, right ? 0 : leg, w - leg, runLength(side)) },
    ];
  } else if (kind === 'diagonal') {
    outline = mirror([[0, 0], [w, 0], [w, leg], [leg, d], [0, d]]);
    const cut: Pick<FrontRun, 'a' | 'b'> = right ? { a: [0, leg], b: [w - leg, d] } : { a: [leg, d], b: [w, leg] };
    fronts = [{ ...cut, faces: fitFaces(faces, right ? 0 : leg, w - leg, runLength(cut)) }];
  } else if (kind === 'angle_end') {
    const outer = Math.max(d - w, 0);
    // A triangle once it is as wide as it is deep.
    outline = mirror(outer > 0 ? [[0, 0], [w, 0], [w, outer], [0, d]] : [[0, 0], [w, 0], [0, d]]);
    const cut: Pick<FrontRun, 'a' | 'b'> = right ? { a: [0, outer], b: [w, d] } : { a: [0, d], b: [w, outer] };
    fronts = [{ ...cut, faces: fitFaces(faces, 0, w, runLength(cut)) }];
  } else {
    // A plain box; a blind corner too, its covered end drawn as a panel.
    outline = [[0, 0], [w, 0], [w, d], [0, d]];
    fronts = [{ a: [0, d], b: [w, d], faces }];
  }

  const straight = !kind || kind === 'blind';
  const onFloor = cabinet.cab_type !== 'wall' && !appliance;
  const hasCounter = onFloor && cabinet.cab_type !== 'tall' && height < COUNTER_TOP_IN;
  return {
    cabinet,
    x: pxToIn(cabinet.x, scalePixelsPerFoot),
    z: pxToIn(cabinet.y, scalePixelsPerFoot),
    rotation: cabinet.rotation,
    bottom,
    // A range's top sits flush with the counters around it.
    height: appliance ? Math.max(height, COUNTER_TOP_IN) : height,
    outline,
    toeKick: onFloor ? TOE_KICK_IN : 0,
    toeOutline: straight ? [[0, 0], [w, 0], [w, d - TOE_SETBACK_IN], [0, d - TOE_SETBACK_IN]] : outline,
    fronts,
    counter: !hasCounter
      ? null
      : straight
        ? [[0, 0], [w, 0], [w, d + COUNTER_OVERHANG_IN], [0, d + COUNTER_OVERHANG_IN]]
        : outline,
    appliance,
    glass: !!cabinet.has_glass_door,
  };
}

export function cabinetSolids(
  cabinets: CabinetSketchCabinet[],
  presets: PresetCatalog,
  scalePixelsPerFoot: number
): CabinetSolid[] {
  const mounts = mountHeightsIn(cabinets, presets, scalePixelsPerFoot);
  return cabinets.map((c) => cabinetSolid(c, presets, scalePixelsPerFoot, mounts.get(c.id) ?? 0));
}

export function wallSolids(walls: CabinetSketchWall[], scalePixelsPerFoot: number): WallSolid[] {
  const inches = (px: number) => pxToIn(px, scalePixelsPerFoot);
  return walls
    .filter((wall) => Math.hypot(wall.end_x - wall.start_x, wall.end_y - wall.start_y) >= 1)
    .map((wall) => ({
      id: wall.id,
      a: [inches(wall.start_x), inches(wall.start_y)],
      b: [inches(wall.end_x), inches(wall.end_y)],
      thickness: Math.max(inches(wall.thickness || 0), 1),
    }));
}

/** A point of a cabinet's local frame on the floor plan, inches. */
export function toPlan(solid: Pick<CabinetSolid, 'x' | 'z' | 'rotation'>, [x, z]: Pt2): Pt2 {
  const r = (solid.rotation * Math.PI) / 180;
  return [solid.x + x * Math.cos(r) - z * Math.sin(r), solid.z + x * Math.sin(r) + z * Math.cos(r)];
}

/** Plan extent of the cabinets and walls, inches; null when there is nothing. */
export function modelBounds(
  solids: CabinetSolid[],
  walls: WallSolid[]
): { minX: number; maxX: number; minZ: number; maxZ: number } | null {
  const pts: Pt2[] = [...solids.flatMap((s) => s.outline.map((p) => toPlan(s, p))), ...walls.flatMap((w) => [w.a, w.b])];
  if (pts.length === 0) return null;
  const xs = pts.map((p) => p[0]);
  const zs = pts.map((p) => p[1]);
  return { minX: Math.min(...xs), maxX: Math.max(...xs), minZ: Math.min(...zs), maxZ: Math.max(...zs) };
}

/**
 * The way most of the doors face, on the plan (unit vector), weighted by
 * cabinet width — where the camera stands to look at the kitchen from the
 * front. Straight down the screen when there is no clear answer.
 */
export function mainFacing(solids: CabinetSolid[]): Pt2 {
  let fx = 0;
  let fz = 0;
  for (const s of solids) {
    const r = (s.rotation * Math.PI) / 180;
    const w = s.outline.reduce((m, [x]) => Math.max(m, x), 0);
    fx += -Math.sin(r) * w;
    fz += Math.cos(r) * w;
  }
  const len = Math.hypot(fx, fz);
  return len < 1e-6 ? [0, 1] : [fx / len, fz / len];
}
