/**
 * Decorative tile on a tiled surface: border / listello strips and accent
 * inserts, priced on top of the field tile (backend calculator
 * _add_decorative_tile). A tub surround or shower walls take border rows,
 * each all the way around them; walls and floor take the border's LF.
 *
 * The lengths around are the backend's: a tub surround along the back and
 * each end it tiles, a shower along its back and the side walls its layout
 * has, and a shower room's front either side of its opening when tiled.
 */

import type { BathtubSpec, ShowerSpec } from '../../types/bathroomEstimate';
import { showerRoomFrontRunIn } from './showerRoom';

const CORNER_LAYOUTS = new Set(['corner', 'corner_right', 'neo_angle', 'neo_angle_right']);

/** Inches around a tub surround: the back wall, then one end or both */
export function tubSurroundRunIn(tub: (BathtubSpec & Record<string, any>) | null | undefined): number {
  const a = Number(tub?.tub_length_in) || 60;
  const b = Number(tub?.tub_depth_in) || 32;
  const length = Math.max(a, b);
  const depth = Math.min(a, b);
  const walls = Number(tub?.surround_wall_count) || 3;
  return length + (walls >= 3 ? 2 * depth : walls === 2 ? depth : 0);
}

/** Inches around a shower's tiled walls: the back, then both sides (one for a
 *  corner layout), then a shower room's tiled front either side of its opening */
export function showerWallRunIn(shower: (ShowerSpec & Record<string, any>) | null | undefined): number {
  const width = Number(shower?.width_in) || 36;
  const depth = Number(shower?.depth_in) || 36;
  return width + (CORNER_LAYOUTS.has(shower?.layout ?? 'alcove') ? depth : 2 * depth)
    + showerRoomFrontRunIn(shower);
}

/** LF of border for `rows` rows around `runIn` inches, to a tenth */
export function borderLf(rows: number | null | undefined, runIn: number): number {
  const n = Math.max(0, Number(rows) || 0);
  return Math.round(((n * runIn) / 12) * 10) / 10;
}
