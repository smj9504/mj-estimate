/**
 * MOVE_WALL: dragging a wall keeps the floor plan connected.
 *
 * Two rules, both asserted here against a faithful copy of the reducer case in
 * useWMSketchState.ts. The reducer is not importable in isolation (it is
 * closed over by the hook), so the logic is mirrored; if the two ever drift,
 * that is the bug these tests exist to catch.
 *
 *   1. Neighbouring walls sharing a corner FOLLOW the dragged wall, so the
 *      outline never splits apart. Only their shared end moves, so they
 *      stretch or shrink and their length_ft is recomputed.
 *   2. The room boundary standing on those corners follows too, and
 *      area_sqft is recomputed from the new outline.
 *
 * History: an earlier version pinned neighbours in place ("완전고정"). That
 * tore the dragged wall away from them at both corners — visible as gaps in
 * the plan — and, because autoDetectRooms deletes any room it cannot match to
 * a closed cycle, a floor with another room on it lost the dragged room
 * entirely. Both failures trace back to letting the corners come apart.
 */

import { describe, it, expect } from 'vitest';

interface Pt { x: number; y: number }
interface Wall {
  id: string;
  start_x: number;
  start_y: number;
  end_x: number;
  end_y: number;
  /** Recomputed for a neighbour that stretches to stay attached. */
  length_ft?: number;
}
interface Room { id: string; boundary: Pt[]; area_sqft: number }

/** Mirrors the MOVE_WALL case in useWMSketchState.ts. */
function moveWall(
  walls: Wall[],
  rooms: Room[],
  id: string,
  dx: number,
  dy: number,
  eps: number,
  scale: number,
): { walls: Wall[]; rooms: Room[] } {
  if (dx === 0 && dy === 0) return { walls, rooms };
  const wall = walls.find((w) => w.id === id);
  if (!wall) return { walls, rooms };

  const ends = [
    { x: wall.start_x, y: wall.start_y },
    { x: wall.end_x, y: wall.end_y },
  ];
  const onThisWall = (px: number, py: number) =>
    ends.some((e) => Math.hypot(px - e.x, py - e.y) <= eps);

  // Each corner lands where the dragged wall's translated line meets the
  // neighbour's own (unchanged) line, so the neighbour keeps its bearing.
  const movedLine = {
    px: wall.start_x + dx,
    py: wall.start_y + dy,
    dirx: wall.end_x - wall.start_x,
    diry: wall.end_y - wall.start_y,
  };
  const intersectWithMoved = (ax: number, ay: number, bx: number, by: number) => {
    const denom = movedLine.dirx * by - movedLine.diry * bx;
    const scaleGuard = Math.hypot(movedLine.dirx, movedLine.diry) * Math.hypot(bx, by);
    if (scaleGuard < 1e-9 || Math.abs(denom) < 1e-6 * scaleGuard) return null;
    const t = ((ax - movedLine.px) * by - (ay - movedLine.py) * bx) / denom;
    return { x: movedLine.px + movedLine.dirx * t, y: movedLine.py + movedLine.diry * t };
  };
  const cornerFor = (cx: number, cy: number): Pt => {
    for (const w of walls) {
      if (w.id === id) continue;
      const startsHere = Math.hypot(w.start_x - cx, w.start_y - cy) <= eps;
      const endsHere = Math.hypot(w.end_x - cx, w.end_y - cy) <= eps;
      if (!startsHere && !endsHere) continue;
      const fx = startsHere ? w.end_x : w.start_x;
      const fy = startsHere ? w.end_y : w.start_y;
      const hit = intersectWithMoved(fx, fy, cx - fx, cy - fy);
      if (hit) return hit;
    }
    return { x: cx + dx, y: cy + dy };
  };
  const newStart = cornerFor(wall.start_x, wall.start_y);
  const newEnd = cornerFor(wall.end_x, wall.end_y);
  const withLength = (w: Wall): Wall => {
    const lengthPx = Math.hypot(w.end_x - w.start_x, w.end_y - w.start_y);
    return { ...w, length_ft: scale > 0 ? lengthPx / scale : w.length_ft };
  };
  const nearestCorner = (px: number, py: number) =>
    Math.hypot(px - wall.start_x, py - wall.start_y) <=
    Math.hypot(px - wall.end_x, py - wall.end_y)
      ? newStart
      : newEnd;

  const nextWalls = walls.map((w) => {
    if (w.id === id) {
      return withLength({
        ...w,
        start_x: newStart.x, start_y: newStart.y,
        end_x: newEnd.x, end_y: newEnd.y,
      });
    }
    // A neighbour keeps its far end and its bearing; only its length changes.
    const startMatch = onThisWall(w.start_x, w.start_y);
    const endMatch = onThisWall(w.end_x, w.end_y);
    if (!startMatch && !endMatch) return w;
    const moved = { ...w };
    if (startMatch) {
      const t = nearestCorner(w.start_x, w.start_y);
      moved.start_x = t.x;
      moved.start_y = t.y;
    }
    if (endMatch) {
      const t = nearestCorner(w.end_x, w.end_y);
      moved.end_x = t.x;
      moved.end_y = t.y;
    }
    return withLength(moved);
  });

  const nextRooms = rooms.map((r) => {
    if (!r.boundary?.length) return r;
    let touched = false;
    const boundary = r.boundary.map((p) => {
      if (!onThisWall(p.x, p.y)) return p;
      touched = true;
      // Follow the corner to where the walls actually met, not to p+delta.
      const t = nearestCorner(p.x, p.y);
      return { x: t.x, y: t.y };
    });
    if (!touched) return r;
    let area2 = 0;
    for (let i = 0, j = boundary.length - 1; i < boundary.length; j = i++) {
      area2 += (boundary[j].x + boundary[i].x) * (boundary[j].y - boundary[i].y);
    }
    const areaSqft = scale > 0 ? Math.abs(area2 / 2) / (scale * scale) : r.area_sqft;
    return { ...r, boundary, area_sqft: areaSqft };
  });

  return { walls: nextWalls, rooms: nextRooms };
}

const EPS = 15;
const SCALE = 20; // canvas px per foot

/** A 400x300 px square room: corners, its four walls, and 300 SF at scale 20. */
function squareFixture() {
  const walls: Wall[] = [
    { id: 'top',    start_x: 200, start_y: 200, end_x: 600, end_y: 200 },
    { id: 'right',  start_x: 600, start_y: 200, end_x: 600, end_y: 500 },
    { id: 'bottom', start_x: 600, start_y: 500, end_x: 200, end_y: 500 },
    { id: 'left',   start_x: 200, start_y: 500, end_x: 200, end_y: 200 },
  ];
  const rooms: Room[] = [
    {
      id: 'room1',
      boundary: [
        { x: 200, y: 200 }, { x: 600, y: 200 },
        { x: 600, y: 500 }, { x: 200, y: 500 },
      ],
      area_sqft: 300,
    },
  ];
  return { walls, rooms };
}

describe('MOVE_WALL — the dragged wall', () => {
  it('translates by exactly the delta', () => {
    const { walls, rooms } = squareFixture();
    const out = moveWall(walls, rooms, 'top', 0, -80, EPS, SCALE);
    const top = out.walls.find((w) => w.id === 'top')!;
    expect(top).toMatchObject({ start_x: 200, start_y: 120, end_x: 600, end_y: 120 });
  });

  it('drags the neighbours sharing its corners along with it', () => {
    const { walls, rooms } = squareFixture();
    const out = moveWall(walls, rooms, 'top', 0, -80, EPS, SCALE);
    // 'right' starts at the top-right corner: that end follows, the far end stays.
    expect(out.walls.find((w) => w.id === 'right')).toMatchObject({
      start_x: 600, start_y: 120, end_x: 600, end_y: 500,
    });
    // 'left' ENDS at the top-left corner: its end follows, its start stays.
    expect(out.walls.find((w) => w.id === 'left')).toMatchObject({
      start_x: 200, start_y: 500, end_x: 200, end_y: 120,
    });
  });

  it('leaves a wall touching neither corner alone', () => {
    const { walls, rooms } = squareFixture();
    const out = moveWall(walls, rooms, 'top', 0, -80, EPS, SCALE);
    // The bottom wall spans the two far corners, so nothing about it moves.
    expect(out.walls.find((w) => w.id === 'bottom')).toEqual(
      walls.find((w) => w.id === 'bottom'),
    );
  });

  it('recomputes length_ft for a neighbour that stretched', () => {
    const { walls, rooms } = squareFixture();
    // The side walls were 300px (15ft at scale 20); raising the top by 80px
    // makes them 380px = 19ft.
    const out = moveWall(walls, rooms, 'top', 0, -80, EPS, SCALE);
    expect(out.walls.find((w) => w.id === 'right')!.length_ft).toBeCloseTo(19, 6);
    expect(out.walls.find((w) => w.id === 'left')!.length_ft).toBeCloseTo(19, 6);
  });

  it('keeps every corner welded — no gaps open in the outline', () => {
    const { walls, rooms } = squareFixture();
    const out = moveWall(walls, rooms, 'top', 30, -40, EPS, SCALE);
    // Walk the loop: each wall's end must coincide with the next wall's start.
    const order = ['top', 'right', 'bottom', 'left'];
    for (let i = 0; i < order.length; i++) {
      const a = out.walls.find((w) => w.id === order[i])!;
      const b = out.walls.find((w) => w.id === order[(i + 1) % order.length])!;
      expect(Math.hypot(a.end_x - b.start_x, a.end_y - b.start_y)).toBeCloseTo(0, 6);
    }
  });

  /*
   * The reason this behaviour exists. On a square the old "slide the shared
   * endpoint by the delta" rule and the new "intersect the lines" rule agree,
   * because the neighbours are axis-aligned and the drag is perpendicular to
   * them. On a SPLAYED wall they disagree: sliding the endpoint re-angles the
   * neighbour, intersecting keeps its bearing and changes only its length.
   */
  it('keeps a slanted neighbour at its original bearing, changing only length', () => {
    // 'side' runs from (200,500) up to (300,200) — a 3:−10 slant. The top wall
    // sits on y=200 and is dragged straight up by 100.
    const walls: Wall[] = [
      { id: 'top', start_x: 300, start_y: 200, end_x: 700, end_y: 200 },
      { id: 'side', start_x: 200, start_y: 500, end_x: 300, end_y: 200 },
    ];
    const bearingBefore = Math.atan2(200 - 500, 300 - 200);

    const out = moveWall(walls, [], 'top', 0, -100, EPS, SCALE);
    const side = out.walls.find((w) => w.id === 'side')!;

    // Far end untouched.
    expect(side).toMatchObject({ start_x: 200, start_y: 500 });
    // Same bearing, to floating-point tolerance.
    const bearingAfter = Math.atan2(side.end_y - side.start_y, side.end_x - side.start_x);
    expect(bearingAfter).toBeCloseTo(bearingBefore, 9);
    // It reached the dragged wall's new line (y = 100). The slant rises 300px
    // over 100px of run, so covering 400px of rise from (200,500) takes
    // 400/3 of run: x = 200 + 400/3 ≈ 333.33.
    expect(side.end_y).toBeCloseTo(100, 6);
    expect(side.end_x).toBeCloseTo(200 + 400 / 3, 6);
    // Longer than before, and length_ft recomputed to match.
    const lenPx = Math.hypot(side.end_x - side.start_x, side.end_y - side.start_y);
    expect(side.length_ft).toBeCloseTo(lenPx / SCALE, 9);
    expect(lenPx).toBeGreaterThan(Math.hypot(300 - 200, 200 - 500));
  });

  it('keeps the dragged wall on its own line — its angle never changes', () => {
    const walls: Wall[] = [
      { id: 'top', start_x: 300, start_y: 200, end_x: 700, end_y: 200 },
      { id: 'side', start_x: 200, start_y: 500, end_x: 300, end_y: 200 },
    ];
    const out = moveWall(walls, [], 'top', 0, -100, EPS, SCALE);
    const top = out.walls.find((w) => w.id === 'top')!;
    // Still horizontal, still on the translated line y = 100.
    expect(top.start_y).toBeCloseTo(100, 6);
    expect(top.end_y).toBeCloseTo(100, 6);
    // Its length gave, which is the trade the user accepted.
    expect(top.length_ft).toBeCloseTo(
      Math.hypot(top.end_x - top.start_x, top.end_y - top.start_y) / SCALE, 9,
    );
  });

  it('falls back to translating a corner whose neighbour runs parallel', () => {
    // 'para' is collinear with the dragged wall, so the two lines never meet.
    const walls: Wall[] = [
      { id: 'top', start_x: 300, start_y: 200, end_x: 700, end_y: 200 },
      { id: 'para', start_x: 300, start_y: 200, end_x: 100, end_y: 200 },
    ];
    const out = moveWall(walls, [], 'top', 0, -100, EPS, SCALE);
    const top = out.walls.find((w) => w.id === 'top')!;
    // No intersection to snap to, so the corner simply travels with the drag.
    expect(top.start_x).toBeCloseTo(300, 6);
    expect(top.start_y).toBeCloseTo(100, 6);
  });

  it('is a no-op for a zero delta', () => {
    const { walls, rooms } = squareFixture();
    const out = moveWall(walls, rooms, 'top', 0, 0, EPS, SCALE);
    expect(out.walls).toBe(walls);
    expect(out.rooms).toBe(rooms);
  });

  it('is a no-op for an unknown wall id', () => {
    const { walls, rooms } = squareFixture();
    const out = moveWall(walls, rooms, 'nope', 10, 10, EPS, SCALE);
    expect(out.walls).toBe(walls);
    expect(out.rooms).toBe(rooms);
  });
});

describe('MOVE_WALL — the room outline follows', () => {
  it('moves only the two boundary points standing on that wall', () => {
    const { walls, rooms } = squareFixture();
    const out = moveWall(walls, rooms, 'top', 0, -80, EPS, SCALE);
    // The top edge rises; the bottom two corners stay exactly put.
    expect(out.rooms[0].boundary).toEqual([
      { x: 200, y: 120 }, { x: 600, y: 120 },
      { x: 600, y: 500 }, { x: 200, y: 500 },
    ]);
  });

  it('recomputes area_sqft from the new outline', () => {
    const { walls, rooms } = squareFixture();
    // Raising the top edge by 80px makes the room 400x380 px => 380 SF at scale 20.
    const out = moveWall(walls, rooms, 'top', 0, -80, EPS, SCALE);
    expect(out.rooms[0].area_sqft).toBeCloseTo(380, 6);
  });

  it('shrinks the area when the wall is dragged inward', () => {
    const { walls, rooms } = squareFixture();
    // Lowering the top edge by 100px leaves 400x200 px => 200 SF.
    const out = moveWall(walls, rooms, 'top', 0, 100, EPS, SCALE);
    expect(out.rooms[0].area_sqft).toBeCloseTo(200, 6);
  });

  it('keeps the outline closed — the room is never dropped', () => {
    const { walls, rooms } = squareFixture();
    const out = moveWall(walls, rooms, 'top', 0, -80, EPS, SCALE);
    expect(out.rooms).toHaveLength(1);
    expect(out.rooms[0].boundary).toHaveLength(4);
  });

  it('slides along the side walls on a diagonal drag, rather than skewing them', () => {
    const { walls, rooms } = squareFixture();
    // Dragged by (30, -40), but the side walls are vertical and keep their
    // bearing, so the corners can only travel UP them: x stays at 200/600 and
    // the sideways component is absorbed. (Under the old "slide the endpoint
    // by the delta" rule these came out at x = 230/630, which tilted both
    // side walls — the thing the user asked to stop happening.)
    const out = moveWall(walls, rooms, 'top', 30, -40, EPS, SCALE);
    expect(out.rooms[0].boundary.slice(0, 2)).toEqual([
      { x: 200, y: 160 }, { x: 600, y: 160 },
    ]);
  });
});

describe('MOVE_WALL — rooms that should not move', () => {
  it('leaves a room that does not touch the wall untouched', () => {
    const { walls, rooms } = squareFixture();
    const faraway: Room = {
      id: 'room2',
      boundary: [
        { x: 900, y: 200 }, { x: 1200, y: 200 },
        { x: 1200, y: 450 }, { x: 900, y: 450 },
      ],
      area_sqft: 187.5,
    };
    const out = moveWall(walls, [...rooms, faraway], 'top', 0, -80, EPS, SCALE);
    // Same object identity: it was not rebuilt, so it cannot have drifted.
    expect(out.rooms[1]).toBe(faraway);
  });

  it('moves the shared corners of BOTH rooms when a wall is shared', () => {
    // Two rooms meeting along x=600. Dragging the shared wall must take the
    // matching corners of both with it, or the rooms tear apart.
    const walls: Wall[] = [
      { id: 'shared', start_x: 600, start_y: 200, end_x: 600, end_y: 500 },
    ];
    const rooms: Room[] = [
      {
        id: 'left',
        boundary: [{ x: 200, y: 200 }, { x: 600, y: 200 }, { x: 600, y: 500 }, { x: 200, y: 500 }],
        area_sqft: 300,
      },
      {
        id: 'right',
        boundary: [{ x: 600, y: 200 }, { x: 900, y: 200 }, { x: 900, y: 500 }, { x: 600, y: 500 }],
        area_sqft: 225,
      },
    ];
    const out = moveWall(walls, rooms, 'shared', 50, 0, EPS, SCALE);
    expect(out.rooms[0].boundary[1]).toEqual({ x: 650, y: 200 });
    expect(out.rooms[0].boundary[2]).toEqual({ x: 650, y: 500 });
    expect(out.rooms[1].boundary[0]).toEqual({ x: 650, y: 200 });
    expect(out.rooms[1].boundary[3]).toEqual({ x: 650, y: 500 });
    // One grows by 50px of width, the other shrinks by the same.
    expect(out.rooms[0].area_sqft).toBeCloseTo(337.5, 6);
    expect(out.rooms[1].area_sqft).toBeCloseTo(187.5, 6);
  });
});

describe('MOVE_WALL — matching tolerance', () => {
  it('snaps a slightly-off boundary point onto the resolved corner', () => {
    // Boundaries are built by snapping endpoints onto a 10px grid, so a
    // boundary point can sit a few px from the wall endpoint it came from.
    // It still matches within EPS and still follows the drag — but it now
    // lands ON the corner the walls actually resolved to, instead of keeping
    // its own 4px offset. That is inherent to following an intersection
    // rather than translating by a delta, and it quietly re-welds boundaries
    // that drifted off their walls.
    const walls: Wall[] = [{ id: 'top', start_x: 200, start_y: 200, end_x: 600, end_y: 200 }];
    const rooms: Room[] = [
      {
        id: 'r',
        boundary: [{ x: 204, y: 197 }, { x: 600, y: 200 }, { x: 600, y: 500 }, { x: 200, y: 500 }],
        area_sqft: 0,
      },
    ];
    const out = moveWall(walls, rooms, 'top', 0, -80, EPS, SCALE);
    // Lone wall, so no neighbour to intersect: the corner translates to
    // (200,120) and the boundary point joins it there.
    expect(out.rooms[0].boundary[0]).toEqual({ x: 200, y: 120 });
  });

  it('does not drag a point that lies beyond the tolerance', () => {
    const walls: Wall[] = [{ id: 'top', start_x: 200, start_y: 200, end_x: 600, end_y: 200 }];
    const rooms: Room[] = [
      {
        id: 'r',
        boundary: [{ x: 230, y: 200 }, { x: 600, y: 200 }, { x: 600, y: 500 }, { x: 200, y: 500 }],
        area_sqft: 0,
      },
    ];
    const out = moveWall(walls, rooms, 'top', 0, -80, EPS, SCALE);
    // 30px from the start endpoint: outside EPS, so it stays.
    expect(out.rooms[0].boundary[0]).toEqual({ x: 230, y: 200 });
  });
});
