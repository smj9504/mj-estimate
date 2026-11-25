/**
 * A cabinet vanity along its width: the cabinet, an open knee space beside it
 * if it has one (a makeup area under a long top: no cabinet below), and its
 * sinks over the cabinet. One sink or two whatever the width. Inches from its
 * left end as you face it (its own -x), the top running the whole width.
 *
 * The estimate prices the cabinet by its own width and the top by the whole
 * (backend vanities.py), with the same rule for how much knee space a width
 * can take.
 */

/** The least cabinet a knee space leaves under the sink (vanities.MIN_CABINET_IN) */
export const MIN_VANITY_CABINET_IN = 12;

export type KneeSpaceSide = 'left' | 'right';

export interface VanityLayout {
  widthIn: number;
  /** The cabinet's stretch */
  cabinet: [number, number];
  /** The open knee space's, null when it has none */
  knee: [number, number] | null;
  /** Each sink's middle */
  sinks: number[];
}

/** The knee space a vanity of this width can have: never all of it */
export const kneeSpaceIn = (widthIn: number, kneeIn?: number | null): number =>
  Math.max(0, Math.min(kneeIn ?? 0, widthIn - MIN_VANITY_CABINET_IN));

export function vanityLayout(widthIn: number, sinkCount = 1, kneeIn?: number | null, side: KneeSpaceSide = 'left'): VanityLayout {
  const knee = kneeSpaceIn(widthIn, kneeIn);
  const cabinet: [number, number] = side === 'left' ? [knee, widthIn] : [0, widthIn - knee];
  const cw = cabinet[1] - cabinet[0];
  const sinks = Math.max(1, Math.min(2, sinkCount || 1)) === 2
    ? [cabinet[0] + cw / 4, cabinet[0] + (3 * cw) / 4]
    : [cabinet[0] + cw / 2];
  return {
    widthIn,
    cabinet,
    knee: knee > 0 ? (side === 'left' ? [0, knee] : [widthIn - knee, widthIn]) : null,
    sinks,
  };
}
