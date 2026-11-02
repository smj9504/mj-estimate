/**
 * What the camera draws so nobody has to read instructions: a plan of the room
 * with the walls done and the way the phone is facing, the lines the ceiling and
 * floor should clear, and how level it's being held.
 */

import React from 'react';
import { LEVEL_DEGREES, WALLS } from './sensors';

// Clockwise from the top, as walls are numbered
const WALL_LINES: Record<number, [number, number, number, number]> = {
  1: [12, 10, 52, 10],
  2: [54, 12, 54, 52],
  3: [52, 54, 12, 54],
  4: [10, 52, 10, 12],
};

export const RoomMap: React.FC<{
  done: number[];
  target: number | null;
  /** Degrees clockwise from wall 1, when the phone can tell */
  facing: number | null;
}> = ({ done, target, facing }) => {
  // With no direction to show, point at the wall to shoot
  const angle = facing ?? ((target ?? 1) - 1) * 90;
  return (
    <svg
      className="fv-map"
      viewBox="0 0 64 64"
      role="img"
      aria-label={`${done.length} of 4 walls done`}
    >
      {WALLS.map((wall) => {
        const [x1, y1, x2, y2] = WALL_LINES[wall];
        const state = done.includes(wall) ? 'done' : wall === target ? 'next' : 'open';
        return <line key={wall} className={`fv-map-wall is-${state}`} x1={x1} y1={y1} x2={x2} y2={y2} />;
      })}
      <path
        className="fv-map-cone"
        d="M32 32 L21 14 A21 21 0 0 1 43 14 Z"
        transform={`rotate(${angle} 32 32)`}
      />
      <circle className="fv-map-you" cx="32" cy="32" r="3" />
    </svg>
  );
};

/** The four walls as ticks, for a row in a list */
export const WallTicks: React.FC<{ done: number[] }> = ({ done }) => (
  <span className="fv-ticks" role="img" aria-label={`${done.length} of 4 walls done`}>
    {WALLS.map(wall => (
      <span key={wall} className={`fv-tick${done.includes(wall) ? ' is-done' : ''}`} />
    ))}
  </span>
);

export const FrameGuide: React.FC<{ demo: boolean }> = ({ demo }) => (
  demo ? (
    <div className="fv-close-up" aria-hidden="true">
      <span />
      <span />
      <span />
      <span />
    </div>
  ) : (
    <>
      <div className="fv-band fv-band--ceiling" aria-hidden="true"><span>Ceiling</span></div>
      <div className="fv-band fv-band--floor" aria-hidden="true"><span>Floor</span></div>
    </>
  )
);

const PITCH_SHOWN = 30;

export const LevelBar: React.FC<{ pitch: number | null }> = ({ pitch }) => {
  if (pitch == null) return null;
  const clamped = Math.max(-PITCH_SHOWN, Math.min(PITCH_SHOWN, pitch));
  const level = Math.abs(pitch) <= LEVEL_DEGREES;
  return (
    <div className={`fv-level${level ? ' is-level' : ''}`} aria-hidden="true">
      <span style={{ transform: `translateY(${clamped * 2}px)` }} />
    </div>
  );
};
