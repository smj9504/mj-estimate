/**
 * Where a tub's or shower's faucet and drain are.
 *
 * Each is a point in the fixture's own box, x and y from 0 to 1 across its
 * width and depth, (0, 0) its back-left corner looking in from the front
 * (north-west in its own frame). A faucet on a wall (an alcove tub's, every
 * shower's valve) sits on one of the walls it can have; a deck or a
 * freestanding tub's faucet can be anywhere on it. A tub's drain is under its
 * faucet until it's moved on its own; a shower's is in the middle.
 *
 * Unset, both come out where the plan and the 3D view always drew them, so
 * old sketches look the same. backend plumbing_points.py has the same rules
 * (layout_changes prices a drain or a faucet moved on an option).
 *
 * A drop-in tub's are its tub's, never out on its deck: the faucet on the
 * tub's rim (the edge of the tub nearest where it's put), the drain inside
 * the tub. The tub is where its decks side by side leave it in the platform
 * (utils/tubDeck), else where the plan and 3D draw it.
 */

import type { BEFixture } from '../../../../types/bathroomSketch';
import { tubDeckBySide } from './tubDeck';

export interface Pt01 {
  x: number;
  y: number;
}

export type Edge = 'north' | 'south' | 'east' | 'west';

/** How far a wall faucet stays from a corner, and a drain from the edge (fraction of the side) */
const FAUCET_MARGIN = 0.1;
const DRAIN_MARGIN = 0.08;
/** A tub's drain sits this far in from its faucet, inches */
const DRAIN_IN_FROM_FAUCET = 6;
/** A drop-in's faucet on its tub's rim: this far in from the tub's edge, and from its corners (inches) */
const RIM_IN = 0.75;
const RIM_CORNER_IN = 3;
/** A drop-in's drain stays this far inside its tub, inches */
const DRAIN_IN_TUB_IN = 3;

export const hasPlumbing = (f: BEFixture) => f.type === 'bathtub' || f.type === 'shower';

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export interface Rect01 {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

/**
 * A drop-in tub's tub inside its platform, 0-1 of its box: where its decks
 * side by side leave it, else where the plan and 3D draw it. Null for any
 * other fixture.
 */
export function tubInDeck01(f: BEFixture): Rect01 | null {
  if (f.type !== 'bathtub' || (f.properties.bathtubSubType ?? 'standard_alcove') !== 'drop_in') return null;
  const deck = tubDeckBySide(f);
  if (!deck) return { x0: 0.15, x1: 0.85, y0: 0.1, y1: 0.9 };
  const W = f.dimensions.width || 1;
  const D = f.dimensions.height || 1;
  return { x0: deck.tub.x0 / W, x1: deck.tub.x1 / W, y0: deck.tub.y0 / D, y1: deck.tub.y1 / D };
}

/** `pt` put on the tub's rim: the edge of the tub nearest it, a little in, clear of the corners */
function onTubRim(f: BEFixture, tub: Rect01, pt: Pt01): Pt01 {
  const W = f.dimensions.width || 1;
  const D = f.dimensions.height || 1;
  const [bx0, bx1, by0, by1] = [tub.x0 * W, tub.x1 * W, tub.y0 * D, tub.y1 * D];
  const X = clamp(pt.x * W, bx0, bx1);
  const Y = clamp(pt.y * D, by0, by1);
  const off: [Edge, number][] = [['north', Y - by0], ['south', by1 - Y], ['west', X - bx0], ['east', bx1 - X]];
  const edge = off.reduce((a, b) => (b[1] < a[1] ? b : a))[0];
  const cx = Math.min(RIM_CORNER_IN, (bx1 - bx0) / 2);
  const cy = Math.min(RIM_CORNER_IN, (by1 - by0) / 2);
  const ax = clamp(X, bx0 + cx, bx1 - cx);
  const ay = clamp(Y, by0 + cy, by1 - cy);
  const [x, y] = edge === 'north' ? [ax, by0 + RIM_IN]
    : edge === 'south' ? [ax, by1 - RIM_IN]
      : edge === 'west' ? [bx0 + RIM_IN, ay] : [bx1 - RIM_IN, ay];
  return { x: x / W, y: y / D };
}

/** The walls a faucet can be on, or null when it can be anywhere (on a deck, on the floor) */
export function faucetEdges(f: BEFixture): Edge[] | null {
  const p = f.properties;
  if (f.type === 'bathtub') {
    return (p.bathtubSubType ?? 'standard_alcove') === 'standard_alcove' ? ['north', 'west', 'east'] : null;
  }
  switch (p.showerLayout ?? 'alcove') {
    case 'corner':
    case 'neo_angle': return ['north', 'west'];
    case 'corner_right':
    case 'neo_angle_right': return ['north', 'east'];
    default: return ['north', 'west', 'east'];
  }
}

export function defaultFaucet(f: BEFixture): Pt01 {
  const p = f.properties;
  if (f.type === 'bathtub') {
    switch (p.bathtubSubType ?? 'standard_alcove') {
      case 'drop_in': return snapFaucet(f, { x: 0.5, y: 0.05 });
      case 'corner_garden':
      case 'corner_drop_in': return { x: 0.72, y: 0.52 };
      case 'freestanding': return { x: 0.5, y: 1 };
      default: return { x: 0.5, y: 0 };
    }
  }
  const layout = p.showerLayout ?? 'alcove';
  return { x: layout === 'neo_angle' ? 0.45 : layout === 'neo_angle_right' ? 0.55 : 0.5, y: 0 };
}

/** `pt` put where a faucet can be: onto the nearest wall it can have, or inside the box */
export function snapFaucet(f: BEFixture, pt: Pt01): Pt01 {
  const tub = tubInDeck01(f);
  if (tub) return onTubRim(f, tub, pt);
  const edges = faucetEdges(f);
  if (!edges) return { x: clamp(pt.x, 0, 1), y: clamp(pt.y, 0, 1) };
  const off: Record<Edge, number> = { north: Math.abs(pt.y), south: Math.abs(1 - pt.y), west: Math.abs(pt.x), east: Math.abs(1 - pt.x) };
  const edge = edges.reduce((a, b) => (off[b] < off[a] ? b : a));
  const along = (v: number) => clamp(v, FAUCET_MARGIN, 1 - FAUCET_MARGIN);
  switch (edge) {
    case 'north': return { x: along(pt.x), y: 0 };
    case 'south': return { x: along(pt.x), y: 1 };
    case 'west': return { x: 0, y: along(pt.y) };
    default: return { x: 1, y: along(pt.y) };
  }
}

export function faucetOf(f: BEFixture): Pt01 {
  const set = f.properties.faucetPos;
  return set ? snapFaucet(f, set) : defaultFaucet(f);
}

/** The wall a faucet point is on, if it's on one */
export function faucetEdge(f: BEFixture, pt: Pt01 = faucetOf(f)): Edge | null {
  if (!faucetEdges(f)) return null;
  if (pt.y <= 0.001) return 'north';
  if (pt.y >= 0.999) return 'south';
  if (pt.x <= 0.001) return 'west';
  if (pt.x >= 0.999) return 'east';
  return null;
}

/** A tub with an open side a fixed glass panel can stand on */
export function takesTubGlassPanel(f: BEFixture): boolean {
  const sub = f.properties.bathtubSubType ?? 'standard_alcove';
  return f.type === 'bathtub' && (sub === 'standard_alcove' || sub === 'drop_in');
}

/**
 * The end of a tub's open side its glass panel stands at, looking in from
 * the room: as set on the plan, else its faucet's end (where the 3D view
 * always stood it).
 */
export function tubGlassPanelSide(f: BEFixture): 'left' | 'right' {
  const set = f.properties.glassPanelSide;
  if (set === 'left' || set === 'right') return set;
  const fp = faucetOf(f);
  const edge = faucetEdge(f, fp);
  return edge === 'west' || (edge !== 'east' && fp.x <= 0.5) ? 'left' : 'right';
}

/** `pt` kept where a drain can be: in from the box's edges, or inside a drop-in's tub */
export function clampDrain(pt: Pt01, f?: BEFixture): Pt01 {
  const tub = f ? tubInDeck01(f) : null;
  if (tub && f) {
    const W = f.dimensions.width || 1;
    const D = f.dimensions.height || 1;
    const inside = (v: number, lo: number, hi: number, size: number) => {
      const m = Math.min(DRAIN_IN_TUB_IN, ((hi - lo) * size) / 2) / size;
      return clamp(v, lo + m, hi - m);
    };
    return { x: inside(pt.x, tub.x0, tub.x1, W), y: inside(pt.y, tub.y0, tub.y1, D) };
  }
  return { x: clamp(pt.x, DRAIN_MARGIN, 1 - DRAIN_MARGIN), y: clamp(pt.y, DRAIN_MARGIN, 1 - DRAIN_MARGIN) };
}

export function defaultDrain(f: BEFixture): Pt01 {
  if (f.type === 'shower') {
    const layout = f.properties.showerLayout ?? 'alcove';
    if (layout === 'neo_angle') return { x: 0.4, y: 0.4 };
    if (layout === 'neo_angle_right') return { x: 0.6, y: 0.4 };
    return { x: 0.5, y: 0.5 };
  }
  // A tub's: in from its faucet, toward the middle (of a drop-in's tub)
  const fp = faucetOf(f);
  const tub = tubInDeck01(f);
  const mx = tub ? (tub.x0 + tub.x1) / 2 : 0.5;
  const my = tub ? (tub.y0 + tub.y1) / 2 : 0.5;
  const W = f.dimensions.width;
  const D = f.dimensions.height;
  const dx = (mx - fp.x) * W;
  const dy = (my - fp.y) * D;
  const len = Math.hypot(dx, dy);
  if (len < 0.5) return { x: mx, y: my };
  const step = Math.min(DRAIN_IN_FROM_FAUCET, len);
  return clampDrain({ x: fp.x + ((dx / len) * step) / W, y: fp.y + ((dy / len) * step) / D }, f);
}

export function drainOf(f: BEFixture): Pt01 {
  const set = f.properties.drainPos;
  return set ? clampDrain(set, f) : defaultDrain(f);
}

/** A point of the fixture's box on the plan (px), turned as the fixture is */
export function onPlan(f: BEFixture, pt: Pt01, ppf: number): { x: number; y: number } {
  const lx = ((pt.x - 0.5) * f.dimensions.width * ppf) / 12;
  const ly = ((pt.y - 0.5) * f.dimensions.height * ppf) / 12;
  const r = ((f.rotation || 0) * Math.PI) / 180;
  return { x: f.position.x + lx * Math.cos(r) - ly * Math.sin(r), y: f.position.y + lx * Math.sin(r) + ly * Math.cos(r) };
}

// ── Quick choices in the inspector ──

export interface PlacePreset {
  value: string;
  label: string;
  pt: Pt01 | null;
}

/** Where a faucet can go in a click: each wall it can have, or the deck's ends */
export function faucetPresets(f: BEFixture): PlacePreset[] {
  const edges = faucetEdges(f);
  const isTub = f.type === 'bathtub';
  if (edges) {
    const names: Record<Edge, string> = isTub
      ? { north: 'Back wall', west: 'Left end', east: 'Right end', south: 'Front' }
      : { north: 'Back wall', west: 'Left wall', east: 'Right wall', south: 'Front' };
    const at: Record<Edge, Pt01> = { north: { x: 0.5, y: 0 }, west: { x: 0, y: 0.5 }, east: { x: 1, y: 0.5 }, south: { x: 0.5, y: 1 } };
    return edges.map((e) => ({ value: e, label: names[e], pt: at[e] }));
  }
  const sub = f.properties.bathtubSubType ?? 'standard_alcove';
  const list: PlacePreset[] = [
    { value: 'west', label: 'Left end', pt: sub === 'freestanding' ? { x: 0, y: 0.5 } : { x: 0.05, y: 0.5 } },
    { value: 'north', label: 'Back', pt: sub === 'freestanding' ? { x: 0.5, y: 0 } : { x: 0.5, y: 0.05 } },
    { value: 'east', label: 'Right end', pt: sub === 'freestanding' ? { x: 1, y: 0.5 } : { x: 0.95, y: 0.5 } },
    { value: 'south', label: 'Front', pt: sub === 'freestanding' ? { x: 0.5, y: 1 } : { x: 0.5, y: 0.95 } },
  ];
  if (sub === 'corner_garden' || sub === 'corner_drop_in') list.push({ value: 'corner', label: 'Corner deck', pt: { x: 0.72, y: 0.52 } });
  // A drop-in's: on its tub's rim, in the middle of that end or side
  const tub = tubInDeck01(f);
  if (!tub) return list;
  const mx = (tub.x0 + tub.x1) / 2;
  const my = (tub.y0 + tub.y1) / 2;
  const at: Record<string, Pt01> = { west: { x: tub.x0, y: my }, north: { x: mx, y: tub.y0 }, east: { x: tub.x1, y: my }, south: { x: mx, y: tub.y1 } };
  return list.map((p) => ({ ...p, pt: snapFaucet(f, at[p.value] ?? p.pt ?? { x: mx, y: my }) }));
}

export function drainPresets(f: BEFixture): PlacePreset[] {
  if (f.type === 'bathtub') {
    // A drop-in's at its tub's ends and middle
    const tub = tubInDeck01(f);
    const mx = tub ? (tub.x0 + tub.x1) / 2 : 0.5;
    const my = tub ? (tub.y0 + tub.y1) / 2 : 0.5;
    const pt = (x: number, y: number) => (tub ? clampDrain({ x, y }, f) : { x, y });
    return [
      { value: 'faucet', label: 'Under the faucet', pt: null },
      { value: 'west', label: 'Left end', pt: pt(tub ? tub.x0 : 0.1, my) },
      { value: 'middle', label: 'Middle', pt: pt(mx, my) },
      { value: 'east', label: 'Right end', pt: pt(tub ? tub.x1 : 0.9, my) },
    ];
  }
  return [
    { value: 'middle', label: 'Middle', pt: null },
    { value: 'north', label: 'Back', pt: { x: 0.5, y: 0.12 } },
    { value: 'south', label: 'Front', pt: { x: 0.5, y: 0.88 } },
    { value: 'west', label: 'Left', pt: { x: 0.12, y: 0.5 } },
    { value: 'east', label: 'Right', pt: { x: 0.88, y: 0.5 } },
  ];
}

const near = (a: Pt01, b: Pt01) => Math.abs(a.x - b.x) < 0.02 && Math.abs(a.y - b.y) < 0.02;

/** Which quick choice a point is, or 'custom' when it was moved on the plan */
export function presetOf(presets: PlacePreset[], pt: Pt01, isDefault: boolean): string {
  if (isDefault) {
    const followDefault = presets.find((p) => !p.pt);
    if (followDefault) return followDefault.value;
  }
  return presets.find((p) => p.pt && near(p.pt, pt))?.value ?? 'custom';
}
