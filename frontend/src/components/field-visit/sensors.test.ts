import { describe, expect, it } from 'vitest';
import {
  StepCounter,
  cameraDirection,
  floorFromAltitude,
  nextWall,
  pickWall,
  wallForHeading,
} from './sensors';
import type { AltitudeSample } from './sensors';

describe('cameraDirection', () => {
  // Held upright facing the wall: beta 90, nothing else
  it('faces the way it was started when held upright', () => {
    const { heading, pitch } = cameraDirection(0, 90, 0);
    expect(heading).toBeCloseTo(0);
    expect(pitch).toBeCloseTo(0);
  });

  it('turns clockwise as alpha goes down', () => {
    expect(cameraDirection(270, 90, 0).heading).toBeCloseTo(90);
    expect(cameraDirection(180, 90, 0).heading).toBeCloseTo(180);
    expect(cameraDirection(90, 90, 0).heading).toBeCloseTo(270);
  });

  it('reads tilting down at the floor and up at the ceiling', () => {
    expect(cameraDirection(0, 60, 0).pitch).toBeCloseTo(-30);
    expect(cameraDirection(0, 120, 0).pitch).toBeCloseTo(30);
    expect(cameraDirection(0, 0, 0).pitch).toBeCloseTo(-90);
  });

  it('stays level held sideways', () => {
    expect(cameraDirection(30, 0, 90).pitch).toBeCloseTo(0);
    expect(cameraDirection(30, 0, -90).pitch).toBeCloseTo(0);
  });
});

describe('walls', () => {
  it('numbers walls clockwise from the first', () => {
    expect(wallForHeading(40, 40)).toBe(1);
    expect(wallForHeading(130, 40)).toBe(2);
    expect(wallForHeading(220, 40)).toBe(3);
    expect(wallForHeading(310, 40)).toBe(4);
  });

  it('rounds to the nearest wall and wraps past north', () => {
    expect(wallForHeading(80, 40)).toBe(1);
    expect(wallForHeading(90, 40)).toBe(2);
    expect(wallForHeading(10, 300)).toBe(2);
    expect(wallForHeading(355, 40)).toBe(1);
  });

  it('finds the next wall to shoot', () => {
    expect(nextWall([])).toBe(1);
    expect(nextWall([1, 3])).toBe(2);
    expect(nextWall([1, 2, 3, 4])).toBeNull();
  });

  it('sets where wall 1 is from the first shot', () => {
    expect(pickWall([], 200, null)).toEqual({ wall: 1, anchor: 200 });
  });

  it('counts a re-shot wall as the same wall', () => {
    expect(pickWall([1], 205, 200)).toEqual({ wall: 1, anchor: 200 });
    expect(pickWall([1], 290, 200)).toEqual({ wall: 2, anchor: 200 });
  });

  it('works out wall 1 when carrying on a room partway round', () => {
    expect(pickWall([1, 2], 100, null)).toEqual({ wall: 3, anchor: 280 });
  });

  it('fills walls in order with no direction', () => {
    expect(pickWall([1], null, null)).toEqual({ wall: 2, anchor: null });
    expect(pickWall([1, 2, 3, 4], null, null)).toEqual({ wall: null, anchor: null });
  });
});

describe('StepCounter', () => {
  const run = (signal: (t: number) => number, seconds: number, counter = new StepCounter()) => {
    for (let ms = 0; ms < seconds * 1000; ms += 20) counter.push(0, 0, signal(ms / 1000), ms);
    return counter;
  };

  it('counts walking at two steps a second', () => {
    const steps = run(t => 9.81 + 3 * Math.sin(2 * Math.PI * 2 * t), 10).count;
    expect(steps).toBeGreaterThanOrEqual(17);
    expect(steps).toBeLessThanOrEqual(21);
  });

  it('ignores a hand holding the phone still', () => {
    expect(run(t => 9.81 + 0.25 * Math.sin(2 * Math.PI * 7 * t), 20).count).toBe(0);
  });

  it('ignores lifting the phone once', () => {
    expect(run(t => 9.81 + (t > 1 && t < 1.25 ? 5 : 0), 5).count).toBe(0);
  });

  it('ignores shuffling a step or two at a time', () => {
    const shuffle = (t: number) => 9.81 + (t % 4 < 0.5 ? 3 * Math.sin(2 * Math.PI * 4 * t) : 0);
    expect(run(shuffle, 20).count).toBe(0);
  });

  it('starts over after a shot', () => {
    const counter = run(t => 9.81 + 3 * Math.sin(2 * Math.PI * 2 * t), 5);
    expect(counter.count).toBeGreaterThan(0);
    counter.reset();
    expect(counter.count).toBe(0);
  });
});

describe('floorFromAltitude', () => {
  const NOW = 100000;
  const samples = (altitude: number, accuracy: number | null = 5, count = 3): AltitudeSample[] =>
    Array.from({ length: count }, (_, i) => ({ altitude: altitude + i * 0.1, accuracy, timeMs: NOW - i * 1000 }));
  const ground = { altitude: 100, floor: '1' as const };

  it('stays on the floor it was anchored on', () => {
    expect(floorFromAltitude(samples(100.5), ground, NOW)).toBe('1');
  });

  it('reads a floor up and a floor down', () => {
    expect(floorFromAltitude(samples(103), ground, NOW)).toBe('2');
    expect(floorFromAltitude(samples(106.2), ground, NOW)).toBe('3');
    expect(floorFromAltitude(samples(97), ground, NOW)).toBe('B');
  });

  it('measures from whichever floor was last confirmed', () => {
    expect(floorFromAltitude(samples(103), { altitude: 100, floor: '2' }, NOW)).toBe('3');
    expect(floorFromAltitude(samples(100), { altitude: 103, floor: '2' }, NOW)).toBe('1');
  });

  it('says nothing from poor or missing accuracy', () => {
    expect(floorFromAltitude(samples(103, 30), ground, NOW)).toBeNull();
    expect(floorFromAltitude(samples(103, null), ground, NOW)).toBeNull();
  });

  it('says nothing from one reading or old ones', () => {
    expect(floorFromAltitude(samples(103, 5, 1), ground, NOW)).toBeNull();
    expect(floorFromAltitude(samples(103), ground, NOW + 60000)).toBeNull();
  });

  it('says nothing with nothing to measure from, or from an attic', () => {
    expect(floorFromAltitude(samples(103), null, NOW)).toBeNull();
    expect(floorFromAltitude(samples(103), { altitude: 100, floor: 'A' }, NOW)).toBeNull();
  });

  it('shrugs off a stray reading', () => {
    const noisy = [...samples(100), { altitude: 140, accuracy: 5, timeMs: NOW }];
    expect(floorFromAltitude(noisy, ground, NOW)).toBe('1');
  });

  it('keeps wild readings within the floors it knows', () => {
    expect(floorFromAltitude(samples(160), ground, NOW)).toBe('3');
    expect(floorFromAltitude(samples(40), ground, NOW)).toBe('B');
  });
});
