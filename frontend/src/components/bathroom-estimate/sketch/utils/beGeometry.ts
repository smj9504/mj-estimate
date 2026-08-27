/**
 * beGeometry - Shared pure polygon geometry helpers
 *
 * Used to keep wall-mounted overlays (e.g. a shower bench) inside the
 * actual shape they're mounted in — a neo-angle shower's footprint is a
 * pentagon (one diagonal-cut corner), so a plain rectangle can overshoot
 * past the glass unless it's clipped against the real footprint.
 */

export interface Pt2 {
  x: number;
  y: number;
}

/** true if p is on the inside of the directed edge a→b, for a clockwise-on-screen polygon */
function isInsideEdge(p: Pt2, a: Pt2, b: Pt2): boolean {
  return (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x) >= 0;
}

function edgeIntersection(p1: Pt2, p2: Pt2, a: Pt2, b: Pt2): Pt2 {
  const A1 = p2.y - p1.y, B1 = p1.x - p2.x, C1 = A1 * p1.x + B1 * p1.y;
  const A2 = b.y - a.y, B2 = a.x - b.x, C2 = A2 * a.x + B2 * a.y;
  const det = A1 * B2 - A2 * B1;
  if (Math.abs(det) < 1e-9) return p2; // parallel edges — degenerate, keep p2
  return {
    x: (B2 * C1 - B1 * C2) / det,
    y: (A1 * C2 - A2 * C1) / det,
  };
}

/**
 * Clip a subject polygon against a convex clip polygon (Sutherland-Hodgman).
 * Both polygons must be wound clockwise-on-screen (the convention used
 * throughout this sketch: y grows downward, vertices listed top→right→
 * bottom→left).
 */
export function clipPolygon(subject: Pt2[], clip: Pt2[]): Pt2[] {
  let output = subject;
  for (let i = 0; i < clip.length; i++) {
    const a = clip[i];
    const b = clip[(i + 1) % clip.length];
    const input = output;
    output = [];
    if (input.length === 0) break;
    for (let j = 0; j < input.length; j++) {
      const cur = input[j];
      const prev = input[(j - 1 + input.length) % input.length];
      const curIn = isInsideEdge(cur, a, b);
      const prevIn = isInsideEdge(prev, a, b);
      if (curIn) {
        if (!prevIn) output.push(edgeIntersection(prev, cur, a, b));
        output.push(cur);
      } else if (prevIn) {
        output.push(edgeIntersection(prev, cur, a, b));
      }
    }
  }
  return output;
}

type ShowerLayout = 'alcove' | 'corner' | 'corner_right' | 'neo_angle' | 'neo_angle_right' | undefined;

/**
 * The shower's own footprint polygon, normalized to (0,0)-(1,1) — a unit
 * square for alcove/corner layouts, but a pentagon with one diagonal-cut
 * corner for neo-angle layouts. Mirrors the vertex layout documented in
 * buildNeoAngleShowerShape (beFixtureShapes.ts). Callers map these into
 * whatever coordinate frame they need (local pixel-center-origin, absolute
 * canvas coords, etc).
 */
export function getShowerUnitPolygon(layout: ShowerLayout): Pt2[] {
  if (layout === 'neo_angle') {
    return [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 0.5 }, { x: 0.5, y: 1 }, { x: 0, y: 1 }];
  }
  if (layout === 'neo_angle_right') {
    return [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0.5, y: 1 }, { x: 0, y: 0.5 }];
  }
  return [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }];
}
