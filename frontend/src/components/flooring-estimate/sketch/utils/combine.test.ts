import { describe, expect, it } from 'vitest';
import type { FlooringSketch, FtPoint } from '../../../../types/flooringEstimate';
import { combinedOutline } from './combine';
import { measureRoom, polygonArea } from './geometry';
import { combineRooms, separateRoom } from './sketchOps';

const P = (...pts: [number, number][]): FtPoint[] => pts.map(([x, y]) => ({ x, y }));

// A basement: a bedroom with a notch, open along 13' 10" to a room beside it,
// and a closet behind a door off that room
const bedroom = P([0, 0], [12.3333, 0], [12.3333, 6.6667], [12.3333, 20.5], [2.0833, 20.5], [2.0833, 16.25], [0, 16.25]);
const other = P([12.7083, 6.6667], [20.375, 6.6667], [20.375, 20.5], [12.7083, 20.5]);
const closet = P([14.4583, 0.4584], [20.375, 0.4584], [20.375, 6.2917], [14.4583, 6.2917]);

const sketch = (): FlooringSketch => ({
  version: 1,
  units: 'ft',
  levels: [{
    id: 'b', name: 'Basement',
    rooms: [
      { id: 'bed', name: 'Bedroom', height_ft: 8, points: bedroom },
      { id: 'oth', name: 'Other', height_ft: 8, points: other },
      { id: 'clo', name: 'Closet', height_ft: 8, points: closet },
    ],
    openings: [
      { id: 'open', kind: 'open_wall', rooms: ['bed', 'oth'], a: { x: 12.3333, y: 6.6667 }, b: { x: 12.3333, y: 20.5 } },
      { id: 'bifold', kind: 'bifold', rooms: ['bed', null], a: { x: 6.5833, y: 20.5 }, b: { x: 11.1666, y: 20.5 }, swing: 'bed', hinge: 'a' },
      { id: 'door', kind: 'door', rooms: ['oth', 'clo'], a: { x: 15.375, y: 6.6667 }, b: { x: 17.875, y: 6.6667 }, swing: 'oth', hinge: 'a' },
    ],
    cabinet_runs: [],
    fixtures: [],
    walls: [],
  }],
});

describe('rooms combined into one', () => {
  it('joins their floors across the wall between them', () => {
    const outline = combinedOutline([bedroom, other])!;
    // The two floors and the 4 1/2" strip where the wall stood between them
    expect(polygonArea(outline)).toBeCloseTo(243.98 + 106.06 + 0.375 * 13.8333, 1);
    // An L with the notch: no corners along a straight wall
    expect(outline).toHaveLength(8);
  });

  it("refuses rooms that don't meet", () => {
    const far = P([40, 0], [50, 0], [50, 10], [40, 10]);
    expect(combinedOutline([bedroom, far])).toBeNull();
  });

  it('keeps the first room, takes the others in, and the doorways follow', () => {
    const result = combineRooms(sketch(), 'b', 'bed', ['oth']);
    if ('error' in result) throw new Error(result.error);
    const level = result.sketch.levels[0];
    expect(level.rooms.map((r) => r.name)).toEqual(['Bedroom', 'Closet']);
    const bed = level.rooms[0];
    expect(bed.merged_from).toEqual(['oth']);
    // The open side between them is gone; the bifold stays; the closet's door is the combined room's now
    expect(level.openings.map((o) => o.id)).toEqual(['bifold', 'door']);
    expect(level.openings[1].rooms).toEqual(['bed', 'clo']);
    expect(level.openings[1].swing).toBe('bed');
    const m = measureRoom(level, bed);
    expect(m.floorSf).toBeCloseTo(355.23, 1);
    // The bifold and the closet door off the baseboard, nothing for the side that is gone
    expect(m.baseLf).toBeCloseTo(m.perimeterLf - 4.5833 - 2.5, 2);
  });

  it('three at once, across a doorway too', () => {
    const result = combineRooms(sketch(), 'b', 'oth', ['bed', 'clo']);
    if ('error' in result) throw new Error(result.error);
    const level = result.sketch.levels[0];
    expect(level.rooms.map((r) => r.id)).toEqual(['oth']);
    expect(level.rooms[0].merged_from?.sort()).toEqual(['bed', 'clo']);
    expect(level.openings.map((o) => o.id)).toEqual(['bifold']);
    expect(level.openings[0].rooms).toEqual(['oth', null]);
    expect(polygonArea(level.rooms[0].points)).toBeGreaterThan(243.98 + 106.06 + 34.51);
  });

  it('separated again: the rooms and the doorways between them as they were', () => {
    const start = sketch();
    const combined = combineRooms(start, 'b', 'bed', ['oth']);
    if ('error' in combined) throw new Error(combined.error);
    const back = separateRoom(combined.sketch, 'b', 'bed').levels[0];
    const was = start.levels[0];
    expect(back.rooms.map((r) => [r.id, r.points])).toEqual(was.rooms.map((r) => [r.id, r.points]));
    expect(back.rooms.find((r) => r.id === 'bed')?.combined_from).toBeUndefined();
    // The closet's door is the other room's again; the open side is back
    const byId = new Map(back.openings.map((o) => [o.id, o]));
    expect(byId.get('door')?.rooms).toEqual(['oth', 'clo']);
    expect(byId.get('door')?.swing).toBe('oth');
    expect(byId.get('open')?.rooms).toEqual(['bed', 'oth']);
    expect(byId.get('bifold')?.rooms).toEqual(['bed', null]);
  });
});
