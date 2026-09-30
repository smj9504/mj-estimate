/**
 * Small domain-agnostic helpers for the cabinet sketch canvas.
 * Mirrors water-mitigation/sketch/utils/wmCalculations.ts's
 * pixelsToFeet/generateOverlayId — kept as a local copy rather than a
 * cross-domain import, consistent with this codebase's convention of each
 * sketch feature owning its own small utilities.
 */

export function pixelsToFeet(px: number, scalePixelsPerFoot: number): number {
  if (scalePixelsPerFoot <= 0) return 0;
  return px / scalePixelsPerFoot;
}

export function feetToPixels(ft: number, scalePixelsPerFoot: number): number {
  return ft * scalePixelsPerFoot;
}

export function generateOverlayId(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
}

/** Find the nearest existing wall endpoint within snap threshold. */
export function snapToWallEndpoint(
  pos: { x: number; y: number },
  walls: { start_x: number; start_y: number; end_x: number; end_y: number }[],
  threshold: number
): { point: { x: number; y: number }; snapped: boolean } {
  let closestDist = threshold;
  let closestPt: { x: number; y: number } | null = null;

  for (const w of walls) {
    for (const ep of [
      { x: w.start_x, y: w.start_y },
      { x: w.end_x, y: w.end_y },
    ]) {
      const d = Math.hypot(ep.x - pos.x, ep.y - pos.y);
      if (d < closestDist) {
        closestDist = d;
        closestPt = ep;
      }
    }
  }

  if (closestPt) return { point: closestPt, snapped: true };
  return { point: pos, snapped: false };
}

/** Constrain a point to horizontal or vertical relative to start (Shift-drag). */
export function constrainToAxis(
  start: { x: number; y: number },
  end: { x: number; y: number }
): { x: number; y: number } {
  const dx = Math.abs(end.x - start.x);
  const dy = Math.abs(end.y - start.y);
  if (dx > dy) return { x: end.x, y: start.y };
  return { x: start.x, y: end.y };
}
