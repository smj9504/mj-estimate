/**
 * A drop-in tub's platform with a deck of its own width on each side: a
 * narrow lip at the front, wide ledges at the ends and back (a big tiled
 * platform with the tub dropped in off centre). The fixture's size is the
 * platform's; the tub is what the decks leave inside it.
 *
 * Sides as you face the tub from the room: back (its own north, the wall
 * side), front, left (its own -x) and right. Inches.
 */

import type { BEFixture } from '../../../../types/bathroomSketch';

export interface DeckSideWidths {
  back: number;
  front: number;
  left: number;
  right: number;
}

/** The least tub the decks leave inside, inches */
const MIN_TUB_LENGTH_IN = 24;
const MIN_TUB_DEPTH_IN = 18;

export interface TubDeckBySide {
  /** Each side's deck, as it fits */
  sides: DeckSideWidths;
  /** The tub inside: inches from the platform's back-left corner (x across, y from the back) */
  tub: { x0: number; x1: number; y0: number; y1: number };
  tubLengthIn: number;
  tubDepthIn: number;
  /** The deck's top: the platform less the tub */
  deckSF: number;
}

/** A drop-in tub whose decks are set side by side (bathtubSubType drop_in, deckSideWidths) */
export const hasDeckBySide = (fix: BEFixture): boolean =>
  fix.type === 'bathtub' && (fix.properties.bathtubSubType ?? 'standard_alcove') === 'drop_in' && !!fix.properties.deckSideWidths;

/** Two decks across a span, cut down (the second first) so the tub keeps its least size */
function fit(a: number, b: number, span: number, least: number): [number, number] {
  const room = Math.max(0, span - least);
  const first = Math.max(0, Math.min(a || 0, room));
  const second = Math.max(0, Math.min(b || 0, room - first));
  return [first, second];
}

export function tubDeckBySide(fix: BEFixture): TubDeckBySide | null {
  if (!hasDeckBySide(fix)) return null;
  const set = fix.properties.deckSideWidths!;
  const W = fix.dimensions.width;
  const D = fix.dimensions.height;
  const [left, right] = fit(set.left, set.right, W, MIN_TUB_LENGTH_IN);
  const [back, front] = fit(set.back, set.front, D, MIN_TUB_DEPTH_IN);
  const tub = { x0: left, x1: W - right, y0: back, y1: D - front };
  const tubLengthIn = tub.x1 - tub.x0;
  const tubDepthIn = tub.y1 - tub.y0;
  return {
    sides: { back, front, left, right },
    tub,
    tubLengthIn,
    tubDepthIn,
    deckSF: Math.round(((W * D - tubLengthIn * tubDepthIn) / 144) * 100) / 100,
  };
}
