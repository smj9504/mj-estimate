/**
 * beFixtureShapes - Industry-standard SVG shapes for bathroom fixtures
 *
 * Each shape is normalized to a 1x1 bounding box.
 * The renderer scales to actual fixture pixel dimensions.
 */

import type { BEFixtureType, BathtubSubType } from '../../../../types/bathroomSketch';

export interface FixtureShape {
  /** SVG path(s) drawn relative to (0,0)→(1,1) bounding box */
  paths: { d: string; fill: string; stroke: string; strokeWidth: number }[];
  /** Label positioned inside the shape */
  label: string;
}

// ── Bathtub shapes ──

const bathtubAlcove: FixtureShape = {
  label: 'Bathtub',
  paths: [
    // Outer shell
    { d: 'M0,0 L1,0 L1,1 L0,1 Z', fill: '#e3f2fd', stroke: '#1565c0', strokeWidth: 2 },
    // Inner basin (inset)
    { d: 'M0.08,0.08 L0.92,0.08 L0.92,0.92 L0.08,0.92 Z', fill: '#bbdefb', stroke: '#1565c0', strokeWidth: 1 },
    // Drain
    { d: 'M0.5,0.85 m-0.04,0 a0.04,0.04 0 1,0 0.08,0 a0.04,0.04 0 1,0 -0.08,0', fill: '#666', stroke: '#333', strokeWidth: 0.5 },
    // Faucet
    { d: 'M0.45,0.05 L0.55,0.05 L0.55,0.12 L0.45,0.12 Z', fill: '#bdbdbd', stroke: '#757575', strokeWidth: 0.5 },
  ],
};

const bathtubDropIn: FixtureShape = {
  label: 'Drop-in Tub',
  paths: [
    // Deck surround
    { d: 'M0,0 L1,0 L1,1 L0,1 Z', fill: '#fff3e0', stroke: '#e65100', strokeWidth: 2 },
    // Inner basin
    { d: 'M0.15,0.12 L0.85,0.12 Q0.88,0.12 0.88,0.15 L0.88,0.85 Q0.88,0.88 0.85,0.88 L0.15,0.88 Q0.12,0.88 0.12,0.85 L0.12,0.15 Q0.12,0.12 0.15,0.12 Z', fill: '#e3f2fd', stroke: '#1565c0', strokeWidth: 1.5 },
    // Drain
    { d: 'M0.5,0.8 m-0.035,0 a0.035,0.035 0 1,0 0.07,0 a0.035,0.035 0 1,0 -0.07,0', fill: '#666', stroke: '#333', strokeWidth: 0.5 },
  ],
};

const bathtubCorner: FixtureShape = {
  label: 'Corner Tub',
  paths: [
    // Outer (corner shape approximation as rounded rect)
    { d: 'M0,0 L1,0 L1,1 L0,1 Z', fill: '#e8f5e9', stroke: '#2e7d32', strokeWidth: 2 },
    // Inner basin (rounded)
    { d: 'M0.1,0.1 Q0.5,0.1 0.9,0.1 Q0.9,0.5 0.9,0.9 Q0.5,0.9 0.1,0.9 Q0.1,0.5 0.1,0.1 Z', fill: '#c8e6c9', stroke: '#2e7d32', strokeWidth: 1 },
    // Drain
    { d: 'M0.5,0.75 m-0.04,0 a0.04,0.04 0 1,0 0.08,0 a0.04,0.04 0 1,0 -0.08,0', fill: '#666', stroke: '#333', strokeWidth: 0.5 },
  ],
};

const bathtubFreestanding: FixtureShape = {
  label: 'Freestanding',
  paths: [
    // Clawfoot / oval shape
    { d: 'M0.1,0.5 Q0.1,0.05 0.5,0.05 Q0.9,0.05 0.9,0.5 Q0.9,0.95 0.5,0.95 Q0.1,0.95 0.1,0.5 Z', fill: '#f3e5f5', stroke: '#7b1fa2', strokeWidth: 2 },
    // Inner
    { d: 'M0.18,0.5 Q0.18,0.12 0.5,0.12 Q0.82,0.12 0.82,0.5 Q0.82,0.88 0.5,0.88 Q0.18,0.88 0.18,0.5 Z', fill: '#e1bee7', stroke: '#7b1fa2', strokeWidth: 1 },
    // Drain
    { d: 'M0.5,0.78 m-0.035,0 a0.035,0.035 0 1,0 0.07,0 a0.035,0.035 0 1,0 -0.07,0', fill: '#666', stroke: '#333', strokeWidth: 0.5 },
  ],
};

// ── Shower ──

const shower: FixtureShape = {
  label: 'Shower',
  paths: [
    // Floor pan
    { d: 'M0,0 L1,0 L1,1 L0,1 Z', fill: '#f3e5f5', stroke: '#7b1fa2', strokeWidth: 2 },
    // Tile pattern lines
    { d: 'M0.33,0 L0.33,1', fill: 'none', stroke: '#ce93d8', strokeWidth: 0.5 },
    { d: 'M0.66,0 L0.66,1', fill: 'none', stroke: '#ce93d8', strokeWidth: 0.5 },
    { d: 'M0,0.33 L1,0.33', fill: 'none', stroke: '#ce93d8', strokeWidth: 0.5 },
    { d: 'M0,0.66 L1,0.66', fill: 'none', stroke: '#ce93d8', strokeWidth: 0.5 },
    // Drain
    { d: 'M0.5,0.5 m-0.06,0 a0.06,0.06 0 1,0 0.12,0 a0.06,0.06 0 1,0 -0.12,0', fill: '#bdbdbd', stroke: '#666', strokeWidth: 1 },
    // Showerhead indicator
    { d: 'M0.42,0.04 L0.58,0.04 L0.58,0.1 L0.42,0.1 Z', fill: '#bdbdbd', stroke: '#757575', strokeWidth: 0.5 },
  ],
};

// ── Vanity ──

const vanitySingle: FixtureShape = {
  label: 'Vanity (1 sink)',
  paths: [
    // Cabinet body
    { d: 'M0,0 L1,0 L1,1 L0,1 Z', fill: '#fff3e0', stroke: '#e65100', strokeWidth: 2 },
    // Counter top
    { d: 'M0,0 L1,0 L1,0.15 L0,0.15 Z', fill: '#ffe0b2', stroke: '#e65100', strokeWidth: 1 },
    // Single sink basin (centered)
    { d: 'M0.3,0.2 Q0.3,0.15 0.5,0.15 Q0.7,0.15 0.7,0.2 L0.7,0.55 Q0.7,0.6 0.5,0.6 Q0.3,0.6 0.3,0.55 Z', fill: '#e3f2fd', stroke: '#1565c0', strokeWidth: 1 },
    // Faucet
    { d: 'M0.46,0.08 L0.54,0.08 L0.54,0.14 L0.46,0.14 Z', fill: '#bdbdbd', stroke: '#757575', strokeWidth: 0.5 },
    // Door handles
    { d: 'M0.35,0.78 L0.42,0.78', fill: 'none', stroke: '#757575', strokeWidth: 1.5 },
    { d: 'M0.58,0.78 L0.65,0.78', fill: 'none', stroke: '#757575', strokeWidth: 1.5 },
  ],
};

const vanityDouble: FixtureShape = {
  label: 'Vanity (2 sinks)',
  paths: [
    // Cabinet body
    { d: 'M0,0 L1,0 L1,1 L0,1 Z', fill: '#fff3e0', stroke: '#e65100', strokeWidth: 2 },
    // Counter top
    { d: 'M0,0 L1,0 L1,0.15 L0,0.15 Z', fill: '#ffe0b2', stroke: '#e65100', strokeWidth: 1 },
    // Left sink basin
    { d: 'M0.1,0.2 Q0.1,0.15 0.25,0.15 Q0.4,0.15 0.4,0.2 L0.4,0.55 Q0.4,0.6 0.25,0.6 Q0.1,0.6 0.1,0.55 Z', fill: '#e3f2fd', stroke: '#1565c0', strokeWidth: 1 },
    // Right sink basin
    { d: 'M0.6,0.2 Q0.6,0.15 0.75,0.15 Q0.9,0.15 0.9,0.2 L0.9,0.55 Q0.9,0.6 0.75,0.6 Q0.6,0.6 0.6,0.55 Z', fill: '#e3f2fd', stroke: '#1565c0', strokeWidth: 1 },
    // Left faucet
    { d: 'M0.21,0.08 L0.29,0.08 L0.29,0.14 L0.21,0.14 Z', fill: '#bdbdbd', stroke: '#757575', strokeWidth: 0.5 },
    // Right faucet
    { d: 'M0.71,0.08 L0.79,0.08 L0.79,0.14 L0.71,0.14 Z', fill: '#bdbdbd', stroke: '#757575', strokeWidth: 0.5 },
    // Center divider
    { d: 'M0.5,0.7 L0.5,0.95', fill: 'none', stroke: '#e65100', strokeWidth: 0.8 },
    // Door handles (4 doors)
    { d: 'M0.15,0.8 L0.22,0.8', fill: 'none', stroke: '#757575', strokeWidth: 1.5 },
    { d: 'M0.35,0.8 L0.42,0.8', fill: 'none', stroke: '#757575', strokeWidth: 1.5 },
    { d: 'M0.58,0.8 L0.65,0.8', fill: 'none', stroke: '#757575', strokeWidth: 1.5 },
    { d: 'M0.78,0.8 L0.85,0.8', fill: 'none', stroke: '#757575', strokeWidth: 1.5 },
  ],
};

// ── Toilet ──

const toilet: FixtureShape = {
  label: 'Toilet',
  paths: [
    // Tank
    { d: 'M0.15,0 L0.85,0 Q0.9,0 0.9,0.05 L0.9,0.25 Q0.9,0.3 0.85,0.3 L0.15,0.3 Q0.1,0.3 0.1,0.25 L0.1,0.05 Q0.1,0 0.15,0 Z', fill: '#e8f5e9', stroke: '#2e7d32', strokeWidth: 1.5 },
    // Bowl (elongated oval)
    { d: 'M0.15,0.3 L0.85,0.3 Q0.95,0.3 0.95,0.5 L0.95,0.75 Q0.95,0.98 0.5,0.98 Q0.05,0.98 0.05,0.75 L0.05,0.5 Q0.05,0.3 0.15,0.3 Z', fill: '#e8f5e9', stroke: '#2e7d32', strokeWidth: 2 },
    // Seat opening
    { d: 'M0.22,0.35 L0.78,0.35 Q0.85,0.35 0.85,0.5 L0.85,0.7 Q0.85,0.9 0.5,0.9 Q0.15,0.9 0.15,0.7 L0.15,0.5 Q0.15,0.35 0.22,0.35 Z', fill: '#c8e6c9', stroke: '#2e7d32', strokeWidth: 1 },
    // Flush handle
    { d: 'M0.8,0.1 L0.95,0.1', fill: 'none', stroke: '#757575', strokeWidth: 1.5 },
  ],
};

// ── Door ──

const door: FixtureShape = {
  label: 'Door',
  paths: [
    // Door panel
    { d: 'M0,0 L0.15,0 L0.15,1 L0,1 Z', fill: '#efebe9', stroke: '#5d4037', strokeWidth: 1.5 },
    // Swing arc
    { d: 'M0.15,1 Q1,1 1,0', fill: 'none', stroke: '#8d6e63', strokeWidth: 1 },
    // Handle
    { d: 'M0.08,0.48 L0.08,0.52', fill: 'none', stroke: '#333', strokeWidth: 2 },
  ],
};

// ── Window (plan view: thick line representing wall opening with glass) ──

const windowShape: FixtureShape = {
  label: 'Window',
  paths: [
    // Outer wall break (thin rectangle = plan view of window in wall)
    { d: 'M0,0 L1,0 L1,1 L0,1 Z', fill: '#e0f7fa', stroke: '#00838f', strokeWidth: 2 },
    // Glass line (top)
    { d: 'M0.05,0.3 L0.95,0.3', fill: 'none', stroke: '#00838f', strokeWidth: 1.5 },
    // Glass line (bottom)
    { d: 'M0.05,0.7 L0.95,0.7', fill: 'none', stroke: '#00838f', strokeWidth: 1.5 },
    // Frame ends (left)
    { d: 'M0.05,0.15 L0.05,0.85', fill: 'none', stroke: '#006064', strokeWidth: 2 },
    // Frame ends (right)
    { d: 'M0.95,0.15 L0.95,0.85', fill: 'none', stroke: '#006064', strokeWidth: 2 },
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
    default:
      return { label: type, paths: [{ d: 'M0,0 L1,0 L1,1 L0,1 Z', fill: '#f5f5f5', stroke: '#999', strokeWidth: 1.5 }] };
  }
}
