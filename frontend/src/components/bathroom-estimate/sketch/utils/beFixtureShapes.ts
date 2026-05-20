/**
 * beFixtureShapes - Plan-view fixture shapes (blueprint style)
 *
 * Minimal monochrome line drawings. Each shape normalized to (0,0)→(1,1).
 * Stroke color: #444 (dark gray), Fill: #f8f8f8 (near-white) or none.
 */

import type { BEFixtureType, BathtubSubType } from '../../../../types/bathroomSketch';

export interface FixtureShape {
  paths: { d: string; fill: string; stroke: string; strokeWidth: number }[];
  label: string;
}

const S = '#444';     // stroke
const SL = '#999';    // stroke light
const F = 'none';     // fill — transparent (blueprint style)
const FL = 'none';    // fill light — transparent
const N = 'none';     // no fill

// ── Bathtub ──

const bathtubAlcove: FixtureShape = {
  label: 'Bathtub',
  paths: [
    { d: 'M0,0 L1,0 L1,1 L0,1 Z', fill: F, stroke: S, strokeWidth: 2 },
    { d: 'M0.06,0.06 L0.94,0.06 L0.94,0.94 L0.06,0.94 Z', fill: FL, stroke: S, strokeWidth: 1 },
    { d: 'M0.5,0.85 m-0.04,0 a0.04,0.04 0 1,0 0.08,0 a0.04,0.04 0 1,0 -0.08,0', fill: S, stroke: S, strokeWidth: 0.5 },
    { d: 'M0.46,0.03 L0.54,0.03 L0.54,0.1 L0.46,0.1 Z', fill: SL, stroke: S, strokeWidth: 0.5 },
  ],
};

const bathtubDropIn: FixtureShape = {
  label: 'Drop-in',
  paths: [
    { d: 'M0,0 L1,0 L1,1 L0,1 Z', fill: F, stroke: S, strokeWidth: 2 },
    { d: 'M0.15,0.12 Q0.15,0.08 0.2,0.08 L0.8,0.08 Q0.85,0.08 0.85,0.12 L0.85,0.88 Q0.85,0.92 0.8,0.92 L0.2,0.92 Q0.15,0.92 0.15,0.88 Z', fill: FL, stroke: S, strokeWidth: 1.5 },
    { d: 'M0.5,0.82 m-0.035,0 a0.035,0.035 0 1,0 0.07,0 a0.035,0.035 0 1,0 -0.07,0', fill: S, stroke: S, strokeWidth: 0.5 },
  ],
};

const bathtubCorner: FixtureShape = {
  label: 'Corner Tub',
  paths: [
    { d: 'M0,0 L1,0 L1,1 L0,1 Z', fill: F, stroke: S, strokeWidth: 2 },
    { d: 'M0.1,0.1 Q0.5,0.08 0.9,0.1 Q0.92,0.5 0.9,0.9 Q0.5,0.92 0.1,0.9 Q0.08,0.5 0.1,0.1 Z', fill: FL, stroke: S, strokeWidth: 1 },
    { d: 'M0.5,0.75 m-0.04,0 a0.04,0.04 0 1,0 0.08,0 a0.04,0.04 0 1,0 -0.08,0', fill: S, stroke: S, strokeWidth: 0.5 },
  ],
};

const bathtubFreestanding: FixtureShape = {
  label: 'Freestanding',
  paths: [
    { d: 'M0.1,0.5 Q0.1,0.05 0.5,0.05 Q0.9,0.05 0.9,0.5 Q0.9,0.95 0.5,0.95 Q0.1,0.95 0.1,0.5 Z', fill: F, stroke: S, strokeWidth: 2 },
    { d: 'M0.18,0.5 Q0.18,0.12 0.5,0.12 Q0.82,0.12 0.82,0.5 Q0.82,0.88 0.5,0.88 Q0.18,0.88 0.18,0.5 Z', fill: FL, stroke: S, strokeWidth: 1 },
    { d: 'M0.5,0.78 m-0.035,0 a0.035,0.035 0 1,0 0.07,0 a0.035,0.035 0 1,0 -0.07,0', fill: S, stroke: S, strokeWidth: 0.5 },
  ],
};

// ── Shower ──

const shower: FixtureShape = {
  label: 'Shower',
  paths: [
    { d: 'M0,0 L1,0 L1,1 L0,1 Z', fill: F, stroke: S, strokeWidth: 2 },
    // Tile grid (subtle)
    { d: 'M0.33,0 L0.33,1', fill: N, stroke: SL, strokeWidth: 0.3 },
    { d: 'M0.66,0 L0.66,1', fill: N, stroke: SL, strokeWidth: 0.3 },
    { d: 'M0,0.33 L1,0.33', fill: N, stroke: SL, strokeWidth: 0.3 },
    { d: 'M0,0.66 L1,0.66', fill: N, stroke: SL, strokeWidth: 0.3 },
    // Drain
    { d: 'M0.5,0.5 m-0.06,0 a0.06,0.06 0 1,0 0.12,0 a0.06,0.06 0 1,0 -0.12,0', fill: SL, stroke: S, strokeWidth: 0.8 },
    // Showerhead
    { d: 'M0.44,0.03 L0.56,0.03 L0.56,0.08 L0.44,0.08 Z', fill: SL, stroke: S, strokeWidth: 0.5 },
  ],
};

// ── Vanity ──

const vanitySingle: FixtureShape = {
  label: 'Vanity',
  paths: [
    { d: 'M0,0 L1,0 L1,1 L0,1 Z', fill: F, stroke: S, strokeWidth: 2 },
    // Countertop edge
    { d: 'M0,0.12 L1,0.12', fill: N, stroke: S, strokeWidth: 0.8 },
    // Sink basin (oval)
    { d: 'M0.3,0.18 Q0.3,0.14 0.5,0.14 Q0.7,0.14 0.7,0.18 L0.7,0.52 Q0.7,0.58 0.5,0.58 Q0.3,0.58 0.3,0.52 Z', fill: FL, stroke: S, strokeWidth: 1 },
    // Faucet
    { d: 'M0.47,0.04 L0.53,0.04 L0.53,0.1 L0.47,0.1 Z', fill: SL, stroke: S, strokeWidth: 0.5 },
    // Cabinet handles
    { d: 'M0.36,0.78 L0.44,0.78', fill: N, stroke: S, strokeWidth: 1.2 },
    { d: 'M0.56,0.78 L0.64,0.78', fill: N, stroke: S, strokeWidth: 1.2 },
  ],
};

const vanityDouble: FixtureShape = {
  label: 'Dbl Vanity',
  paths: [
    { d: 'M0,0 L1,0 L1,1 L0,1 Z', fill: F, stroke: S, strokeWidth: 2 },
    // Countertop edge
    { d: 'M0,0.12 L1,0.12', fill: N, stroke: S, strokeWidth: 0.8 },
    // Left sink
    { d: 'M0.08,0.18 Q0.08,0.14 0.25,0.14 Q0.42,0.14 0.42,0.18 L0.42,0.52 Q0.42,0.58 0.25,0.58 Q0.08,0.58 0.08,0.52 Z', fill: FL, stroke: S, strokeWidth: 1 },
    // Right sink
    { d: 'M0.58,0.18 Q0.58,0.14 0.75,0.14 Q0.92,0.14 0.92,0.18 L0.92,0.52 Q0.92,0.58 0.75,0.58 Q0.58,0.58 0.58,0.52 Z', fill: FL, stroke: S, strokeWidth: 1 },
    // Left faucet
    { d: 'M0.22,0.04 L0.28,0.04 L0.28,0.1 L0.22,0.1 Z', fill: SL, stroke: S, strokeWidth: 0.5 },
    // Right faucet
    { d: 'M0.72,0.04 L0.78,0.04 L0.78,0.1 L0.72,0.1 Z', fill: SL, stroke: S, strokeWidth: 0.5 },
    // Center divider
    { d: 'M0.5,0.65 L0.5,0.95', fill: N, stroke: SL, strokeWidth: 0.8 },
    // Cabinet handles
    { d: 'M0.18,0.78 L0.26,0.78', fill: N, stroke: S, strokeWidth: 1.2 },
    { d: 'M0.36,0.78 L0.44,0.78', fill: N, stroke: S, strokeWidth: 1.2 },
    { d: 'M0.56,0.78 L0.64,0.78', fill: N, stroke: S, strokeWidth: 1.2 },
    { d: 'M0.74,0.78 L0.82,0.78', fill: N, stroke: S, strokeWidth: 1.2 },
  ],
};

// ── Toilet (plan view: rectangular tank + elongated oval bowl) ──
// Standard: 15"W x 29"D elongated. Tank at back (top), bowl tapers to front (bottom).
// Reference: ANSI/AIA architectural symbol standard

const toilet: FixtureShape = {
  label: 'Toilet',
  paths: [
    // Tank (rectangular, flat back against wall) — top 28% of fixture
    { d: 'M0.1,0.02 L0.9,0.02 Q0.95,0.02 0.95,0.06 L0.95,0.26 Q0.95,0.3 0.9,0.3 L0.1,0.3 Q0.05,0.3 0.05,0.26 L0.05,0.06 Q0.05,0.02 0.1,0.02 Z', fill: F, stroke: S, strokeWidth: 1.5 },
    // Bowl outer (elongated oval, wider at tank connection, tapers to front)
    { d: 'M0.08,0.3 L0.92,0.3 Q0.98,0.3 0.98,0.42 L0.98,0.68 Q0.98,0.98 0.5,0.98 Q0.02,0.98 0.02,0.68 L0.02,0.42 Q0.02,0.3 0.08,0.3 Z', fill: F, stroke: S, strokeWidth: 2 },
    // Seat opening (inner oval, slightly inset from bowl)
    { d: 'M0.18,0.34 L0.82,0.34 Q0.88,0.34 0.88,0.44 L0.88,0.64 Q0.88,0.92 0.5,0.92 Q0.12,0.92 0.12,0.64 L0.12,0.44 Q0.12,0.34 0.18,0.34 Z', fill: F, stroke: SL, strokeWidth: 0.8 },
    // Tank-bowl connection line
    { d: 'M0.1,0.3 L0.9,0.3', fill: N, stroke: S, strokeWidth: 0.5 },
    // Flush handle (small line on right side of tank)
    { d: 'M0.88,0.14 L1.0,0.14', fill: N, stroke: S, strokeWidth: 1 },
  ],
};

// ── Door (plan view: horizontal panel line + 90° swing arc) ──
// Standard architectural floor-plan symbol: horizontal line from hinge to door edge,
// plus a quarter-circle arc showing the swing direction.
// Oriented: hinge at bottom-left (0,1), panel along bottom edge to (1,1),
// arc sweeps clockwise from door edge (1,1) up to open position (0,0).

const door: FixtureShape = {
  label: 'Door',
  paths: [
    // Door panel (horizontal line from hinge to door edge)
    // Hinge at (0,1), panel extends right to (1,1)
    { d: 'M0,1 L1,1', fill: N, stroke: S, strokeWidth: 2.5 },
    // 90° swing arc from door-edge (1,1) to open position (0,0)
    // Quarter circle: center at hinge (0,1), radius = 1 (normalized)
    { d: 'M1,1 A1,1 0 0,0 0,0', fill: N, stroke: SL, strokeWidth: 0.8 },
    // Hinge dot
    { d: 'M0,1 m-0.04,0 a0.04,0.04 0 1,0 0.08,0 a0.04,0.04 0 1,0 -0.08,0', fill: S, stroke: S, strokeWidth: 0.5 },
  ],
};

// ── Window (plan view: wall opening) ──

const windowShape: FixtureShape = {
  label: 'Window',
  paths: [
    { d: 'M0,0 L1,0 L1,1 L0,1 Z', fill: '#f0f8ff', stroke: S, strokeWidth: 1.5 },
    // Double glass lines
    { d: 'M0.05,0.35 L0.95,0.35', fill: N, stroke: S, strokeWidth: 1 },
    { d: 'M0.05,0.65 L0.95,0.65', fill: N, stroke: S, strokeWidth: 1 },
    // Frame ends
    { d: 'M0.04,0.2 L0.04,0.8', fill: N, stroke: S, strokeWidth: 1.5 },
    { d: 'M0.96,0.2 L0.96,0.8', fill: N, stroke: S, strokeWidth: 1.5 },
  ],
};

// ── Mirror (plan view: thin strip on wall, reflective surface) ──

const mirror: FixtureShape = {
  label: 'Mirror',
  paths: [
    // Frame
    { d: 'M0,0 L1,0 L1,1 L0,1 Z', fill: N, stroke: S, strokeWidth: 1.5 },
    // Reflective surface (diagonal hatching)
    { d: 'M0.15,0 L0,0.6', fill: N, stroke: SL, strokeWidth: 0.4 },
    { d: 'M0.4,0 L0.05,1', fill: N, stroke: SL, strokeWidth: 0.4 },
    { d: 'M0.65,0 L0.3,1', fill: N, stroke: SL, strokeWidth: 0.4 },
    { d: 'M0.9,0 L0.55,1', fill: N, stroke: SL, strokeWidth: 0.4 },
    { d: 'M1,0.2 L0.8,1', fill: N, stroke: SL, strokeWidth: 0.4 },
  ],
};

// ── Light fixture (plan view: circle with rays) ──

const light: FixtureShape = {
  label: 'Light',
  paths: [
    // Outer circle
    { d: 'M0.5,0.1 A0.4,0.4 0 1,1 0.5,0.9 A0.4,0.4 0 1,1 0.5,0.1 Z', fill: N, stroke: S, strokeWidth: 1.5 },
    // Inner circle (bulb)
    { d: 'M0.5,0.25 A0.25,0.25 0 1,1 0.5,0.75 A0.25,0.25 0 1,1 0.5,0.25 Z', fill: N, stroke: SL, strokeWidth: 0.8 },
    // Cross lines (filament)
    { d: 'M0.35,0.5 L0.65,0.5', fill: N, stroke: SL, strokeWidth: 0.6 },
    { d: 'M0.5,0.35 L0.5,0.65', fill: N, stroke: SL, strokeWidth: 0.6 },
  ],
};

// ── Lookup ──

const BATHTUB_SHAPES: Record<BathtubSubType, FixtureShape> = {
  standard_alcove: bathtubAlcove,
  corner_garden: bathtubCorner,
  drop_in: bathtubDropIn,
  freestanding: bathtubFreestanding,
};

export function getFixtureShape(
  type: BEFixtureType,
  subType?: BathtubSubType,
  sinkCount?: number,
): FixtureShape {
  switch (type) {
    case 'bathtub':
      return BATHTUB_SHAPES[subType ?? 'standard_alcove'];
    case 'shower':
      return shower;
    case 'vanity':
      return (sinkCount ?? 1) >= 2 ? vanityDouble : vanitySingle;
    case 'toilet':
      return toilet;
    case 'door':
      return door;
    case 'window':
      return windowShape;
    case 'mirror':
      return mirror;
    case 'light':
      return light;
    default:
      return { label: type, paths: [{ d: 'M0,0 L1,0 L1,1 L0,1 Z', fill: F, stroke: S, strokeWidth: 1.5 }] };
  }
}
