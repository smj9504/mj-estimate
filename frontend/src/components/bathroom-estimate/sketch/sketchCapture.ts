/**
 * The plan as a picture for a PDF: everything drawn, cropped round it, with
 * the grid and the dimension tags left out. Taken from a mounted plan
 * canvas's Konva stage: the Sketch tab's, or one drawn off screen for a
 * bathroom that isn't open (bathroomPlanSnapshot).
 */

import type { BESketchData } from '../../../types/bathroomSketch';

/** PNG base64 (no data: prefix), or undefined with nothing drawn */
export function captureSketchImage(stage: any, d: BESketchData): string | undefined {
  if (!stage) return undefined;
  if (!d.rooms.length && !d.fixtures.length && !d.walls.length) return undefined;
  try {
    // Compute content bounding box from data
    const allX: number[] = [];
    const allY: number[] = [];
    const ppf = d.settings.pixelsPerFoot;
    d.rooms.forEach(r => r.boundary.forEach(p => { allX.push(p.x); allY.push(p.y); }));
    d.walls.forEach(w => { allX.push(w.start.x, w.end.x); allY.push(w.start.y, w.end.y); });
    d.fixtures.forEach(f => {
      const hw = (f.dimensions.width / 12) * ppf / 2;
      const hh = (f.dimensions.height / 12) * ppf / 2;
      allX.push(f.position.x - hw, f.position.x + hw);
      allY.push(f.position.y - hh, f.position.y + hh);
    });
    // Include tile zones and damage zones in bounding box
    (d.tileZones ?? []).forEach((z: any) => (z.boundary ?? []).forEach((p: any) => { allX.push(p.x); allY.push(p.y); }));
    (d.damageZones ?? []).forEach((z: any) => (z.boundary ?? []).forEach((p: any) => { allX.push(p.x); allY.push(p.y); }));
    if (!allX.length) return undefined;
    const pad = 40;
    // Not clamped at 0: the plan can be drawn left of or above the
    // canvas origin, and the capture redraws each layer, so it's there too
    const minX = Math.min(...allX) - pad;
    const minY = Math.min(...allY) - pad;
    const maxX = Math.max(...allX) + pad;
    const maxY = Math.max(...allY) + pad;
    const cropW = maxX - minX;
    const cropH = maxY - minY;

    // Save current state
    const oldScale = { x: stage.scaleX(), y: stage.scaleY() };
    const oldPos = { x: stage.x(), y: stage.y() };
    const oldW = stage.width();
    const oldH = stage.height();

    // Expand stage to cover all content
    const needW = Math.max(oldW, maxX + pad);
    const needH = Math.max(oldH, maxY + pad);
    stage.scale({ x: 1, y: 1 });
    stage.position({ x: 0, y: 0 });
    stage.width(needW);
    stage.height(needH);

    // Hide the grid, the dimension tags and the editing aids (a split wall's
    // breaks, a wall's handle). By name: with the grid off, the first layer is
    // the rooms, which the picture needs.
    const hiddenLayers: any[] = [];
    stage.getLayers().forEach((layer: any) => {
      if (['grid', 'dimensions', 'editing'].includes(layer.name()) && layer.visible()) {
        layer.visible(false);
        hiddenLayers.push(layer);
      }
    });
    const overlays = document.querySelectorAll<HTMLElement>('[data-sketch-overlay]');
    overlays.forEach(el => { el.style.display = 'none'; });

    // Synchronous full redraw at new size
    stage.draw();

    // Capture content region
    const dataUrl = stage.toDataURL({
      pixelRatio: 2,
      x: minX,
      y: minY,
      width: cropW,
      height: cropH,
    });

    // Restore everything
    stage.width(oldW);
    stage.height(oldH);
    stage.scale(oldScale);
    stage.position(oldPos);
    hiddenLayers.forEach(l => l.visible(true));
    overlays.forEach(el => { el.style.display = ''; });
    stage.draw();
    return dataUrl.replace(/^data:image\/png;base64,/, '');
  } catch (e) {
    return undefined;
  }
}
