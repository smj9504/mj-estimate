/**
 * What a phone's sensors can say about where a shot was taken. A browser can't
 * read the barometer, Wi-Fi or any indoor position, so these are hints that fill
 * in a default someone can change with one tap, never a decision.
 *
 * The thresholds below are starting values that haven't met real houses yet. Every
 * shot stores the raw readings so they can be tuned against real visits.
 */

import type { FloorKey } from '../../types/fieldVisit';

// ── Which way the camera points ─────────────────────

const RADIANS = Math.PI / 180;

const wrap = (degrees: number) => ((degrees % 360) + 360) % 360;

/**
 * The direction out of the back of the phone, from its orientation angles (the
 * W3C spec's worked example): heading clockwise, pitch up from level. Works from
 * the gyro's relative alpha too, which is what a room needs: metal studs throw off
 * a compass, and only the angle between walls matters.
 */
export function cameraDirection(alpha: number, beta: number, gamma: number): { heading: number; pitch: number } {
  const cA = Math.cos(alpha * RADIANS);
  const sA = Math.sin(alpha * RADIANS);
  const cB = Math.cos(beta * RADIANS);
  const sB = Math.sin(beta * RADIANS);
  const cG = Math.cos(gamma * RADIANS);
  const sG = Math.sin(gamma * RADIANS);

  const east = -cA * sG - sA * sB * cG;
  const north = -sA * sG + cA * sB * cG;
  const up = -cB * cG;

  return {
    heading: wrap(Math.atan2(east, north) / RADIANS),
    pitch: Math.asin(Math.max(-1, Math.min(1, up))) / RADIANS,
  };
}

/** Held near enough to level that the wall isn't shot from below or above */
export const LEVEL_DEGREES = 8;

// ── Which wall that is ──────────────────────────────

export const WALLS = [1, 2, 3, 4];

/** Walls run clockwise from the first one shot in the room */
export function wallForHeading(heading: number, anchor: number): number {
  return (Math.round(wrap(heading - anchor) / 90) % 4) + 1;
}

export function nextWall(done: number[]): number | null {
  return WALLS.find(wall => !done.includes(wall)) ?? null;
}

/**
 * The wall a new shot is of. With a direction, the first shot sets where wall 1 is
 * and a later one is whichever wall it faces, so re-shooting a wall doesn't tick
 * off the next. Without one, walls fill in order.
 */
export function pickWall(
  done: number[],
  heading: number | null,
  anchor: number | null,
): { wall: number | null; anchor: number | null } {
  if (heading == null) return { wall: nextWall(done), anchor };
  if (anchor != null) return { wall: wallForHeading(heading, anchor), anchor };
  const wall = nextWall(done) ?? 1;
  return { wall, anchor: wrap(heading - (wall - 1) * 90) };
}

// ── Walking ─────────────────────────────────────────

const STEP_RISE = 1.2; // m/s² above the resting level
const STEP_FALL = 0.3;
const STEP_MIN_MS = 280;
const WALK_GAP_MS = 1500;
const WALK_MIN_STEPS = 3; // Fewer in a row is someone shifting their feet

/** Far enough that the next shot may be another room */
export const MOVED_STEPS = 12;

/**
 * Counts steps from the accelerometer while the camera is open: a smoothed peak
 * above the resting level, and only in a run of them, so that lifting the phone or
 * turning on the spot doesn't count as walking.
 */
export class StepCounter {
  count = 0;

  private resting = 9.81;

  private smooth = 9.81;

  private inPeak = false;

  private lastStepAt = -Infinity;

  private run = 0;

  push(x: number, y: number, z: number, timeMs: number): void {
    const magnitude = Math.hypot(x, y, z);
    this.resting += (magnitude - this.resting) * 0.01;
    this.smooth += (magnitude - this.smooth) * 0.35;
    const above = this.smooth - this.resting;

    if (this.inPeak) {
      if (above < STEP_FALL) this.inPeak = false;
      return;
    }
    if (above <= STEP_RISE || timeMs - this.lastStepAt < STEP_MIN_MS) return;

    this.inPeak = true;
    this.run = timeMs - this.lastStepAt > WALK_GAP_MS ? 1 : this.run + 1;
    this.lastStepAt = timeMs;
    if (this.run === WALK_MIN_STEPS) this.count += WALK_MIN_STEPS;
    else if (this.run > WALK_MIN_STEPS) this.count += 1;
  }

  reset(): void {
    this.count = 0;
  }
}

// ── Which floor ─────────────────────────────────────

export interface AltitudeSample {
  altitude: number;
  accuracy: number | null;
  timeMs: number;
}

/** An altitude taken on a floor we know, to measure the others from */
export interface FloorAnchor {
  altitude: number;
  floor: FloorKey;
}

// GPS altitude is against the WGS84 ellipsoid, not the ground, so only differences mean anything
const FLOOR_HEIGHT_M = 3;
const MAX_ACCURACY_M = 12;
const SAMPLE_AGE_MS = 45000;
const MIN_SAMPLES = 2;
const FLOOR_LEVELS: FloorKey[] = ['B', '1', '2', '3'];

/** The floor a run of altitude readings suggests, or null when they're too poor to say. An attic isn't guessed. */
export function floorFromAltitude(
  samples: AltitudeSample[],
  anchor: FloorAnchor | null,
  nowMs: number,
): FloorKey | null {
  if (!anchor) return null;
  const from = FLOOR_LEVELS.indexOf(anchor.floor);
  if (from < 0) return null;

  const usable = samples
    .filter(s => nowMs - s.timeMs <= SAMPLE_AGE_MS && s.accuracy != null && s.accuracy <= MAX_ACCURACY_M)
    .map(s => s.altitude)
    .sort((a, b) => a - b);
  if (usable.length < MIN_SAMPLES) return null;

  const middle = Math.floor(usable.length / 2);
  const median = usable.length % 2 ? usable[middle] : (usable[middle - 1] + usable[middle]) / 2;
  const level = from + Math.round((median - anchor.altitude) / FLOOR_HEIGHT_M);
  return FLOOR_LEVELS[Math.max(0, Math.min(FLOOR_LEVELS.length - 1, level))];
}
