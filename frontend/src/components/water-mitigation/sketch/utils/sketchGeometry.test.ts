import { describe, it, expect } from 'vitest';
import {
  resolveDraggedWallCorners,
  snapCornerToAngle,
  vertexMoveSelfIntersects,
  VERTEX_EPS,
  BOUNDARY_EPS,
  samePoint,
  findLiveMove,
  applyLiveMove,
  mergeVertices,
  angleSnapDirections,
  snapToGuides,
  shoelaceDoubled,
  polygonAreaSqft,
  boundsOf,
  boxesIntersect,
  pointInBox,
} from './sketchGeometry';

/**
 * These are the functions the drag paths depend on. Most of this session's
 * regressions came from the same question being answered differently in
 * different files — "is this the same corner?", "where is this point right
 * now?" — so the behaviours are pinned here before the call sites are
 * migrated onto them.
 */

describe('tolerances', () => {
  it('keeps the vertex and boundary epsilons in the intended order', () => {
    // Room boundaries are grid-quantised, so they need the looser test. If
    // these ever invert, a room drag matches no walls at all.
    expect(BOUNDARY_EPS).toBeGreaterThan(VERTEX_EPS);
  });
});

describe('vertexMoveSelfIntersects', () => {
  /*
   * The shape that actually reproduces the bug, taken from the measured
   * repro: a room with a tight notch whose concave vertex (index 4) can be
   * dragged out past the top wall, leaving a bow tie.
   */
  const notched = [
    { x: 150, y: 119 },   // 0 top-left
    { x: 600, y: 149 },   // 1 top-right
    { x: 700, y: 599 },   // 2 bottom-right
    { x: 330, y: 469 },   // 3 notch outer
    { x: 395, y: 454 },   // 4 notch inner — the concave vertex
  ];

  it('accepts a small move that keeps the outline simple', () => {
    expect(vertexMoveSelfIntersects(notched, 4, { x: 420, y: 430 })).toBe(false);
  });

  it('rejects dragging the concave vertex past the far wall', () => {
    // The exact position that produced a crossing in the app.
    expect(vertexMoveSelfIntersects(notched, 4, { x: 519, y: 101 })).toBe(true);
  });

  it('accepts a move that stops short of the far wall', () => {
    // Measured: still simple at this position.
    expect(vertexMoveSelfIntersects(notched, 4, { x: 564, y: 199 })).toBe(false);
  });

  it('ignores edges that merely share a corner', () => {
    // A plain square: nudging one corner can never cross, and the adjacent
    // edges touching it must not be mistaken for intersections.
    const square = [
      { x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 },
    ];
    expect(vertexMoveSelfIntersects(square, 0, { x: 20, y: 20 })).toBe(false);
  });

  it('catches a square folded into a bow tie', () => {
    const square = [
      { x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 },
    ];
    // Drag the top-left corner past the far side.
    expect(vertexMoveSelfIntersects(square, 0, { x: 150, y: 50 })).toBe(true);
  });

  it('never reports a crossing for a triangle', () => {
    const tri = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 50, y: 80 }];
    expect(vertexMoveSelfIntersects(tri, 0, { x: 400, y: 400 })).toBe(false);
  });

  it('is safe with an out-of-range index', () => {
    expect(vertexMoveSelfIntersects(notched, 99, { x: 0, y: 0 })).toBe(false);
    expect(vertexMoveSelfIntersects(notched, -1, { x: 0, y: 0 })).toBe(false);
  });
});

describe('snapCornerToAngle', () => {
  /*
   * A corner near (300,200) with ONE anchor straight below it at (300,500),
   * and a second anchor deliberately placed so its own bearing is nowhere near
   * a 15° multiple.
   *
   * An earlier fixture put the second anchor at (700,200), which made every
   * test cursor sit within ~1.4° of horizontal from it — rounder than the
   * vertical error being tested, so the helper (correctly) snapped to the
   * horizontal and the expectations all failed. The lesson: when a test asserts
   * "it picks THIS wall", the other wall has to be plainly worse.
   */
  const vertAnchor = { x: 300, y: 500 };
  // From a cursor near (300,200) this bears about 96°, i.e. 6° off the nearest
  // multiple — outside the ±3° default, so it can never win.
  const farAnchor = { x: 700, y: 158 };
  const anchors = [vertAnchor, farAnchor];

  it('pulls a nearly-square corner onto an exact 90°', () => {
    // ~2.4° off vertical from the lower anchor.
    //
    // This used to assert the corner landed on the vertical RAY from
    // (300,500), preserving its distance — the single-anchor rule. With two
    // anchors that is the wrong target: the corner has to land on the 90° ARC
    // through both, which is a different point. What matters, and what is
    // asserted now, is the angle the walls actually make.
    const off = { x: 287, y: 190 };
    const { point, guide } = snapCornerToAngle(off, anchors);
    expect(guide).not.toBeNull();

    const bearing = (a: { x: number; y: number }) =>
      (Math.atan2(point.y - a.y, point.x - a.x) * 180) / Math.PI;
    let between = Math.abs(bearing(vertAnchor) - bearing(farAnchor));
    while (between > 180) between = 360 - between;
    expect(between).toBeCloseTo(90, 6);
  });

  it('leaves a corner alone when it is beyond the tolerance', () => {
    // ~9.5° off vertical, and the far anchor is 6°+ off too: nothing qualifies.
    const off = { x: 248, y: 190 };
    const { point, guide } = snapCornerToAngle(off, anchors);
    expect(guide).toBeNull();
    expect(point).toEqual(off);
  });

  it('respects a caller-supplied tolerance', () => {
    const off = { x: 248, y: 190 };
    expect(snapCornerToAngle(off, anchors, 15, 3).guide).toBeNull();
    expect(snapCornerToAngle(off, anchors, 15, 12).guide).not.toBeNull();
  });

  it('preserves the distance from the anchor, so only the angle is corrected', () => {
    const off = { x: 292, y: 180 };
    const dist = Math.hypot(off.x - 300, off.y - 500);
    const { point } = snapCornerToAngle(off, [vertAnchor]);
    expect(Math.hypot(point.x - 300, point.y - 500)).toBeCloseTo(dist, 6);
  });

  it('snaps to whichever wall is closest to a round bearing', () => {
    // Dead-on vertical from the lower anchor (0° error); the far anchor is
    // well off, so the vertical must win.
    const off = { x: 300, y: 180 };
    const { point } = snapCornerToAngle(off, anchors);
    expect(point.x).toBeCloseTo(300, 6);
  });

  /*
   * The behaviour the whole feature exists for, and the one an earlier version
   * got wrong: it scored candidates by each WALL's own bearing error, so on a
   * real plan it snapped the horizontal wall from 0.26° to 0° and left the
   * corner at 90.76°. Rounding one wall does nothing unless the other is round
   * too, so candidates are now scored by the CORNER angle they produce.
   */
  /*
   * The behaviour the whole feature exists for. Two earlier versions scored
   * candidates by each WALL's bearing and landed corners at 90.374° / 90.62° —
   * close, which is precisely what "snapped" must not mean. The corner
   * positions seeing a fixed segment at a constant angle form a circular arc
   * through both anchors (inscribed-angle theorem), so the snap projects onto
   * that arc and the result is exact.
   */
  const cornerAngleOf = (
    p: { x: number; y: number },
    a: { x: number; y: number },
    b: { x: number; y: number },
  ) => {
    const bearing = (q: { x: number; y: number }) =>
      (Math.atan2(p.y - q.y, p.x - q.x) * 180) / Math.PI;
    let between = Math.abs(bearing(a) - bearing(b));
    while (between > 180) between = 360 - between;
    return between;
  };

  it('squares a nearly-right corner to EXACTLY 90°', () => {
    // The real numbers logged from the app: horizontal wall 0.26° off,
    // vertical 1.73° off, corner sitting at ~90.8°.
    const a = { x: 250, y: 219.4 };
    const b = { x: 700, y: 519.4 };
    const cursor = { x: 691, y: 221.4 };

    const { point, guide } = snapCornerToAngle(cursor, [a, b]);
    expect(guide).not.toBeNull();
    expect(cornerAngleOf(point, a, b)).toBeCloseTo(90, 6);
  });

  it('squares it regardless of which wall is the straighter one', () => {
    // Errors swapped, so the result cannot be an accident of anchor ordering.
    const a = { x: 250, y: 216 };
    const b = { x: 700, y: 519.4 };
    const cursor = { x: 691, y: 221 };

    const { point } = snapCornerToAngle(cursor, [a, b]);
    expect(cornerAngleOf(point, a, b)).toBeCloseTo(90, 6);
  });

  it('keeps the snapped corner on the cursor own side of the anchors', () => {
    const a = { x: 250, y: 219.4 };
    const b = { x: 700, y: 519.4 };
    const cursor = { x: 691, y: 221.4 };
    const sideOf = (p: { x: number; y: number }) =>
      Math.sign((p.x - a.x) * (b.y - a.y) - (p.y - a.y) * (b.x - a.x));

    const { point } = snapCornerToAngle(cursor, [a, b]);
    expect(sideOf(point)).toBe(sideOf(cursor));
  });

  it('snaps an obtuse corner to an exact 15° multiple as well', () => {
    // Place the cursor so the corner is a shade off 120°.
    const a = { x: 300, y: 400 };
    const b = { x: 700, y: 400 };
    // Point on the 120° arc, nudged by ~1°.
    const theta = (119 * Math.PI) / 180;
    const abLen = 400;
    const radius = abLen / (2 * Math.sin(theta));
    const offset = abLen / (2 * Math.tan(theta));
    const centre = { x: 500, y: 400 - offset };
    const cursor = {
      x: centre.x + Math.sin(0.2) * radius,
      y: centre.y - Math.cos(0.2) * radius,
    };

    const { point, guide } = snapCornerToAngle(cursor, [a, b]);
    expect(guide).not.toBeNull();
    const got = cornerAngleOf(point, a, b);
    expect(Math.abs(got - Math.round(got / 15) * 15)).toBeLessThan(1e-6);
  });

  it('declines when the corner is more than the tolerance from any multiple', () => {
    // ~97° — seven degrees from 90, well outside ±3°.
    const a = { x: 250, y: 400 };
    const b = { x: 700, y: 400 };
    const theta = (97 * Math.PI) / 180;
    const abLen = 450;
    const radius = abLen / (2 * Math.sin(theta));
    const offset = abLen / (2 * Math.tan(theta));
    const centre = { x: 475, y: 400 - offset };
    const cursor = { x: centre.x, y: centre.y - radius };

    const { point, guide } = snapCornerToAngle(cursor, [a, b]);
    expect(guide).toBeNull();
    expect(point).toEqual(cursor);
  });

  it('reports the guide it snapped to, anchored at the fixed end', () => {
    const { guide } = snapCornerToAngle({ x: 287, y: 190 }, anchors);
    expect(guide!.origin).toEqual({ x: 300, y: 500 });
    // Undirected bearing, 0-180, matching the other guides.
    expect(guide!.angleDeg).toBeGreaterThanOrEqual(0);
    expect(guide!.angleDeg).toBeLessThan(180);
  });

  it('never flips the corner through its anchor', () => {
    // Just past vertical on the far side: the snapped point must stay above
    // the anchor, not jump 180° to below it.
    const off = { x: 303, y: 210 };
    const { point } = snapCornerToAngle(off, anchors);
    expect(point.y).toBeLessThan(500);
  });

  it('ignores an anchor the cursor is sitting on', () => {
    const { point, guide } = snapCornerToAngle({ x: 300, y: 500 }, [{ x: 300, y: 500 }]);
    expect(guide).toBeNull();
    expect(point).toEqual({ x: 300, y: 500 });
  });

  it('does nothing without anchors', () => {
    const p = { x: 123, y: 456 };
    expect(snapCornerToAngle(p, [])).toEqual({ point: p, guide: null });
  });

  it('snaps to non-square multiples too', () => {
    // 44° from the horizontal anchor should land on 45°.
    const rad = (180 - 44) * Math.PI / 180;
    const off = { x: 700 + Math.cos(rad) * 200, y: 200 + Math.sin(rad) * 200 };
    const { point, guide } = snapCornerToAngle(off, [{ x: 700, y: 200 }]);
    expect(guide).not.toBeNull();
    const deg = Math.atan2(point.y - 200, point.x - 700) * 180 / Math.PI;
    expect(Math.abs(deg % 15)).toBeLessThan(1e-6);
  });
});

describe('resolveDraggedWallCorners', () => {
  /** A trapezoid: horizontal top, two slanted sides, horizontal bottom. */
  const trapezoid = () => [
    { id: 'top', start_x: 300, start_y: 200, end_x: 700, end_y: 200 },
    { id: 'right', start_x: 700, start_y: 200, end_x: 800, end_y: 520 },
    { id: 'bottom', start_x: 800, start_y: 520, end_x: 200, end_y: 520 },
    { id: 'left', start_x: 200, start_y: 520, end_x: 300, end_y: 200 },
  ];

  it('lands each corner on its neighbour own line', () => {
    const out = resolveDraggedWallCorners(trapezoid(), 'top', 0, -100, VERTEX_EPS)!;
    // Left side runs (200,520) -> (300,200): 100 across for 320 up. Reaching
    // y=100 means 420 up from the fixed end, so x = 200 + 100*(420/320).
    expect(out.start.y).toBeCloseTo(100, 6);
    expect(out.start.x).toBeCloseTo(200 + 100 * (420 / 320), 6);
    // Right side is the mirror: (800,520) -> (700,200).
    expect(out.end.y).toBeCloseTo(100, 6);
    expect(out.end.x).toBeCloseTo(800 - 100 * (420 / 320), 6);
  });

  it('narrows the dragged wall when the sides splay inward', () => {
    const before = 700 - 300;
    const out = resolveDraggedWallCorners(trapezoid(), 'top', 0, -100, VERTEX_EPS)!;
    // The sides lean in as they rise, so raising the top shortens it. This is
    // the trade the user accepted: neighbours keep their bearing, the dragged
    // wall gives length.
    expect(out.end.x - out.start.x).toBeLessThan(before);
  });

  it('keeps the dragged wall the same length on a rectangle', () => {
    const rect = [
      { id: 'top', start_x: 200, start_y: 200, end_x: 600, end_y: 200 },
      { id: 'right', start_x: 600, start_y: 200, end_x: 600, end_y: 500 },
      { id: 'bottom', start_x: 600, start_y: 500, end_x: 200, end_y: 500 },
      { id: 'left', start_x: 200, start_y: 500, end_x: 200, end_y: 200 },
    ];
    const out = resolveDraggedWallCorners(rect, 'top', 0, -80, VERTEX_EPS)!;
    // Vertical sides, so the corners ride straight up: nothing but y changes.
    expect(out.start).toEqual({ x: 200, y: 120 });
    expect(out.end).toEqual({ x: 600, y: 120 });
  });

  it('absorbs the sideways component of a diagonal drag on a rectangle', () => {
    const rect = [
      { id: 'top', start_x: 200, start_y: 200, end_x: 600, end_y: 200 },
      { id: 'left', start_x: 200, start_y: 500, end_x: 200, end_y: 200 },
    ];
    const out = resolveDraggedWallCorners(rect, 'top', 30, -40, VERTEX_EPS)!;
    // The left wall is vertical and keeps that bearing, so the corner can only
    // travel up it — x stays at 200 and the 30 is absorbed.
    expect(out.start.x).toBeCloseTo(200, 6);
    expect(out.start.y).toBeCloseTo(160, 6);
  });

  it('falls back to a plain translation where no neighbour holds the corner', () => {
    const lone = [{ id: 'top', start_x: 200, start_y: 200, end_x: 600, end_y: 200 }];
    const out = resolveDraggedWallCorners(lone, 'top', 10, -25, VERTEX_EPS)!;
    expect(out.start).toEqual({ x: 210, y: 175 });
    expect(out.end).toEqual({ x: 610, y: 175 });
  });

  it('falls back when the neighbour runs parallel to the drag', () => {
    const collinear = [
      { id: 'top', start_x: 300, start_y: 200, end_x: 700, end_y: 200 },
      { id: 'para', start_x: 300, start_y: 200, end_x: 100, end_y: 200 },
    ];
    const out = resolveDraggedWallCorners(collinear, 'top', 0, -100, VERTEX_EPS)!;
    // The lines never meet, so the corner simply travels with the drag.
    expect(out.start).toEqual({ x: 300, y: 100 });
  });

  it('returns null for an unknown wall id', () => {
    expect(resolveDraggedWallCorners(trapezoid(), 'nope', 5, 5, VERTEX_EPS)).toBeNull();
  });

  it('is symmetric: dragging back returns the corners to where they began', () => {
    const walls = trapezoid();
    const out = resolveDraggedWallCorners(walls, 'top', 0, -100, VERTEX_EPS)!;
    // Feed the moved wall back in and drag the other way by the same amount.
    const moved = walls.map((w) =>
      w.id === 'top'
        ? { ...w, start_x: out.start.x, start_y: out.start.y, end_x: out.end.x, end_y: out.end.y }
        : w.id === 'left'
          ? { ...w, end_x: out.start.x, end_y: out.start.y }
          : w.id === 'right'
            ? { ...w, start_x: out.end.x, start_y: out.end.y }
            : w,
    );
    const back = resolveDraggedWallCorners(moved, 'top', 0, 100, VERTEX_EPS)!;
    expect(back.start.x).toBeCloseTo(300, 6);
    expect(back.start.y).toBeCloseTo(200, 6);
    expect(back.end.x).toBeCloseTo(700, 6);
    expect(back.end.y).toBeCloseTo(200, 6);
  });
});

describe('samePoint', () => {
  it('matches points within the radius', () => {
    expect(samePoint({ x: 0, y: 0 }, { x: 0, y: 0 })).toBe(true);
    expect(samePoint({ x: 0, y: 0 }, { x: 10, y: 0 })).toBe(true);
  });

  it('rejects points beyond the radius', () => {
    expect(samePoint({ x: 0, y: 0 }, { x: 20, y: 0 })).toBe(false);
  });

  it('is Euclidean, not axis-aligned', () => {
    // 12,12 is 12px on each axis but ~16.97px away. A box test would call
    // this the same corner; a radius test correctly does not. That
    // inconsistency is why corners matched differently depending on angle.
    const diagonal = { x: 12, y: 12 };
    expect(Math.hypot(12, 12)).toBeGreaterThan(VERTEX_EPS);
    expect(samePoint({ x: 0, y: 0 }, diagonal)).toBe(false);
  });

  it('honours an explicit epsilon', () => {
    expect(samePoint({ x: 0, y: 0 }, { x: 18, y: 0 }, BOUNDARY_EPS)).toBe(true);
    expect(samePoint({ x: 0, y: 0 }, { x: 18, y: 0 }, VERTEX_EPS)).toBe(false);
  });
});

describe('findLiveMove / applyLiveMove', () => {
  const moves = [
    { from: { x: 100, y: 100 }, to: { x: 150, y: 120 } },
    { from: { x: 0, y: 0 }, to: { x: 5, y: 5 } },
  ];

  it('finds where a dragged point has moved to', () => {
    expect(findLiveMove({ x: 100, y: 100 }, moves)).toEqual({ x: 150, y: 120 });
  });

  it('matches within tolerance, not just exactly', () => {
    expect(findLiveMove({ x: 104, y: 103 }, moves)).toEqual({ x: 150, y: 120 });
  });

  it('returns null for a point that is not being dragged', () => {
    expect(findLiveMove({ x: 500, y: 500 }, moves)).toBeNull();
  });

  it('treats a null move list as nothing in flight', () => {
    expect(findLiveMove({ x: 100, y: 100 }, null)).toBeNull();
    expect(findLiveMove({ x: 100, y: 100 }, undefined)).toBeNull();
  });

  it('applyLiveMove leaves unaffected points untouched', () => {
    const p = { x: 500, y: 500 };
    expect(applyLiveMove(p, moves)).toBe(p);
    expect(applyLiveMove({ x: 100, y: 100 }, moves)).toEqual({ x: 150, y: 120 });
  });
});

describe('mergeVertices', () => {
  it('collapses near-identical endpoints into one corner', () => {
    // An L: two walls meeting at (100,0), stored with slightly different
    // coordinates as happens after a grid-quantised room detection.
    const walls = [
      { start_x: 0, start_y: 0, end_x: 100, end_y: 0 },
      { start_x: 102, start_y: 1, end_x: 100, end_y: 100 },
    ];
    const vertices = mergeVertices(walls);
    // (0,0), the shared corner, and (100,100)
    expect(vertices).toHaveLength(3);

    const corner = vertices.find((v) => samePoint(v, { x: 100, y: 0 }));
    expect(corner).toBeDefined();
    // Both walls contribute a direction to the shared corner.
    expect(corner!.directions).toHaveLength(2);
  });

  it('gives every direction as a unit vector', () => {
    const walls = [{ start_x: 0, start_y: 0, end_x: 300, end_y: 400 }];
    for (const v of mergeVertices(walls)) {
      for (const d of v.directions) {
        expect(Math.hypot(d.x, d.y)).toBeCloseTo(1, 10);
      }
    }
  });

  it('ignores zero-length walls, which have no direction', () => {
    const walls = [{ start_x: 50, start_y: 50, end_x: 50, end_y: 50 }];
    const vertices = mergeVertices(walls);
    expect(vertices).toHaveLength(1);
    expect(vertices[0].directions).toHaveLength(0);
  });

  it('returns nothing for no walls', () => {
    expect(mergeVertices([])).toEqual([]);
  });
});

describe('angleSnapDirections', () => {
  it('covers 0-180 at the given step', () => {
    expect(angleSnapDirections(15)).toHaveLength(12);
    expect(angleSnapDirections(90)).toHaveLength(2);
  });

  it('starts horizontal and includes vertical', () => {
    const dirs = angleSnapDirections(90);
    expect(dirs[0].x).toBeCloseTo(1, 10);
    expect(dirs[0].y).toBeCloseTo(0, 10);
    expect(dirs[1].x).toBeCloseTo(0, 10);
    expect(dirs[1].y).toBeCloseTo(1, 10);
  });
});

describe('snapToGuides', () => {
  const anchor = { x: 0, y: 0 };

  it('snaps a nearly-horizontal drag onto the horizontal guide', () => {
    const { point, guide } = snapToGuides({ x: 100, y: 3 }, anchor);
    expect(point.y).toBeCloseTo(0, 10);
    expect(point.x).toBeCloseTo(100, 10);
    expect(guide?.angleDeg).toBeCloseTo(0, 6);
  });

  it('snaps a nearly-vertical drag onto the vertical guide', () => {
    const { point, guide } = snapToGuides({ x: 3, y: 100 }, anchor);
    expect(point.x).toBeCloseTo(0, 10);
    expect(guide?.angleDeg).toBeCloseTo(90, 6);
  });

  it('follows the cursor and reports no guide when out of tolerance', () => {
    // Halfway between 0 and 15 degrees at this distance is far off any guide.
    const pos = { x: 100, y: 13 };
    const { point, guide } = snapToGuides(pos, anchor, { tolerance: 2 });
    expect(point).toBe(pos);
    expect(guide).toBeNull();
  });

  it('accepts extra guide directions, such as an existing wall angle', () => {
    // A wall at an angle no 15-degree increment covers.
    const odd = { x: Math.cos(0.2), y: Math.sin(0.2) };
    const target = { x: odd.x * 100, y: odd.y * 100 };
    const { guide } = snapToGuides(target, anchor, { extraDirections: [odd] });
    expect(guide).not.toBeNull();
    expect(guide!.angleDeg).toBeCloseTo((0.2 * 180) / Math.PI, 4);
  });

  it('keepSideOf stops the result crossing the anchor', () => {
    // A wall lying along +x, dragged to behind its anchor.
    const wallAxis = { x: 1, y: 0 };
    const behind = { x: -100, y: 0 };

    // Unconstrained, the point may sit on the far side.
    const free = snapToGuides(behind, anchor, { tolerance: 1000 });
    expect(free.point.x).toBeLessThan(0);

    // Constrained to the wall's own side, no guide is admissible at all, so
    // the cursor is followed and nothing is drawn. The point is NOT dragged
    // to the anchor: refusing to snap is the honest outcome when every guide
    // would put the wall on the wrong side.
    const kept = snapToGuides(behind, anchor, {
      tolerance: 1000,
      keepSideOf: wallAxis,
    });
    expect(kept.point).toBe(behind);
    expect(kept.guide).toBeNull();
  });

  it('keepSideOf still allows normal forward snapping', () => {
    const wallAxis = { x: 1, y: 0 };
    const { point, guide } = snapToGuides({ x: 100, y: 3 }, anchor, {
      keepSideOf: wallAxis,
    });
    expect(point.x).toBeCloseTo(100, 10);
    expect(point.y).toBeCloseTo(0, 10);
    expect(guide).not.toBeNull();
  });

  it('reports angles in the 0-180 range', () => {
    for (const pos of [
      { x: 100, y: 100 },
      { x: -100, y: 100 },
      { x: -100, y: -100 },
      { x: 100, y: -100 },
    ]) {
      const { guide } = snapToGuides(pos, anchor, { tolerance: 1000 });
      expect(guide).not.toBeNull();
      expect(guide!.angleDeg).toBeGreaterThanOrEqual(0);
      expect(guide!.angleDeg).toBeLessThan(180);
    }
  });
});

describe('polygon helpers', () => {
  const square = [
    { x: 0, y: 0 },
    { x: 40, y: 0 },
    { x: 40, y: 40 },
    { x: 0, y: 40 },
  ];

  it('shoelace sign encodes winding direction', () => {
    const cw = shoelaceDoubled(square);
    const ccw = shoelaceDoubled([...square].reverse());
    expect(Math.sign(cw)).toBe(-Math.sign(ccw));
    expect(Math.abs(cw)).toBeCloseTo(Math.abs(ccw), 10);
  });

  it('converts pixel area to square feet', () => {
    // 40px at 20px/ft is 2ft a side.
    expect(polygonAreaSqft(square, 20)).toBeCloseTo(4, 10);
  });

  it('is winding-independent for area', () => {
    expect(polygonAreaSqft([...square].reverse(), 20)).toBeCloseTo(4, 10);
  });

  it('returns 0 rather than NaN for degenerate input', () => {
    expect(polygonAreaSqft([], 20)).toBe(0);
    expect(polygonAreaSqft(square.slice(0, 2), 20)).toBe(0);
    expect(polygonAreaSqft(square, 0)).toBe(0);
  });

  it('computes bounds, or null when there are no points', () => {
    expect(boundsOf(square)).toEqual({ x1: 0, y1: 0, x2: 40, y2: 40 });
    expect(boundsOf([])).toBeNull();
  });
});

describe('box helpers', () => {
  const box = { x1: 0, y1: 0, x2: 10, y2: 10 };

  it('detects overlap, including touching edges', () => {
    expect(boxesIntersect(box, { x1: 5, y1: 5, x2: 20, y2: 20 })).toBe(true);
    expect(boxesIntersect(box, { x1: 10, y1: 10, x2: 20, y2: 20 })).toBe(true);
    expect(boxesIntersect(box, { x1: 11, y1: 11, x2: 20, y2: 20 })).toBe(false);
  });

  it('detects containment of a point, including on the edge', () => {
    expect(pointInBox({ x: 5, y: 5 }, box)).toBe(true);
    expect(pointInBox({ x: 0, y: 10 }, box)).toBe(true);
    expect(pointInBox({ x: -1, y: 5 }, box)).toBe(false);
  });
});
