/**
 * The canvas view: pixels per foot and where the drawing's origin sits.
 */

export interface View {
  scale: number;
  x: number;
  y: number;
}

export interface Px {
  x: number;
  y: number;
}

export const MIN_SCALE = 3;
export const MAX_SCALE = 120;

const clampScale = (s: number) => Math.max(MIN_SCALE, Math.min(MAX_SCALE, s));

/** Zoomed by `factor`, keeping the spot under `at` where it is */
export function zoomAround(view: View, factor: number, at: Px): View {
  const scale = clampScale(view.scale * factor);
  const k = scale / view.scale;
  return { scale, x: at.x - (at.x - view.x) * k, y: at.y - (at.y - view.y) * k };
}

/**
 * Two fingers: the view that keeps the spot that was between them at the
 * start between them now, scaled by how far they have spread.
 */
export function pinchView(start: View, startCenter: Px, startDistance: number, center: Px, distance: number): View {
  const scale = clampScale(start.scale * (startDistance > 0 ? distance / startDistance : 1));
  const feetX = (startCenter.x - start.x) / start.scale;
  const feetY = (startCenter.y - start.y) / start.scale;
  return { scale, x: center.x - feetX * scale, y: center.y - feetY * scale };
}

export const midpoint = (a: Px, b: Px): Px => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
export const spread = (a: Px, b: Px) => Math.hypot(b.x - a.x, b.y - a.y);
