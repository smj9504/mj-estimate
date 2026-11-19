/**
 * A shower in its own room, its front wall (the wall with the opening its
 * door hangs in) one of its tiled walls: the sketch's 4th, sent as
 * shower_spec.front_tiled. Tiled inside either side of the opening and round
 * it (its jambs, and its head when the tile goes above it). The backend's
 * calculator (_shower_room_front_tiled, _shower_room_front_sf) prices the
 * same; an estimate saved before front_tiled counts as tiled, as there.
 */

/** How deep a shower room's opening is, inches: tiled round on its jambs and head */
export const OPENING_RETURN_IN = 4.5;

export interface ShowerRoomSpec {
  width_in?: number | null;
  tile_height_in?: number | null;
  front_opening_in?: number | null;
  front_opening_height_in?: number | null;
  front_tiled?: boolean | null;
  layout?: string | null;
}

export function showerRoomFrontTiled(spec: ShowerRoomSpec | null | undefined): boolean {
  return !!spec && (Number(spec.front_opening_in) || 0) > 0 && spec.front_tiled !== false
    && spec.layout !== 'neo_angle' && spec.layout !== 'neo_angle_right';
}

/** The front's tile beside the opening and round it, SF; 0 unless it's tiled */
export function showerRoomFrontSF(spec: ShowerRoomSpec | null | undefined): number {
  if (!showerRoomFrontTiled(spec)) return 0;
  const width = Number(spec!.width_in) || 0;
  const height = Number(spec!.tile_height_in) || 0;
  if (!width || !height) return 0;
  const opening = Number(spec!.front_opening_in) || 0;
  const openHeight = Math.min(Number(spec!.front_opening_height_in) || 80, height);
  const front = (Math.max(0, width - opening) * height) / 144;
  const returns = ((2 * openHeight + (height > openHeight ? opening : 0)) * OPENING_RETURN_IN) / 144;
  return front + returns;
}

/** Inches of the front a border row runs along, either side of the opening; 0 unless it's tiled */
export function showerRoomFrontRunIn(spec: ShowerRoomSpec | null | undefined): number {
  if (!showerRoomFrontTiled(spec)) return 0;
  return Math.max(0, (Number(spec!.width_in) || 36) - (Number(spec!.front_opening_in) || 0));
}
