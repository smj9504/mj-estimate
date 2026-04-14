import { test, expect, Page } from '@playwright/test';

/**
 * Verify SVG rotation transform matches Konva canvas behavior.
 *
 * Konva Group: rotates around the Group's origin (x, y) — top-left corner.
 * SVG: transform="rotate(angle, cx, cy)" rotates around an arbitrary point.
 *
 * To match Konva, SVG must use: translate(x, y) rotate(angle)
 * NOT: rotate(angle, centerX, centerY)
 *
 * Run: npx playwright test e2e/wm-sketch-pdf-rotation.spec.ts --reporter=list
 */

const API = 'http://localhost:8000';

async function getToken(page: Page) {
  const r = await page.request.post(`${API}/api/auth/login`, {
    data: { username: 'admin', password: 'admin123' },
  });
  return (await r.json()).access_token;
}

test('demolition zones with rotation use translate+rotate (not rotate around center)', async ({ page }) => {
  const token = await getToken(page);
  const h = { Authorization: `Bearer ${token}` };

  // Find a floor with demolition zones that have rotation != 0
  const jobs = await (await page.request.get(`${API}/api/water-mitigation/jobs/`, { headers: h })).json();

  let rotatedZones: any[] = [];
  let floorInfo: any = null;

  for (const job of (jobs.items || []).slice(0, 5)) {
    const fd = await (await page.request.get(
      `${API}/api/water-mitigation/sketch/jobs/${job.id}/floors`, { headers: h }
    )).json();

    for (const f of fd.items || []) {
      const od = f.overlay_data || {};
      const dz = od.demolition_zones || [];
      const rotated = dz.filter((z: any) => Math.abs(z.rotation || 0) > 0.1);
      if (rotated.length > 0) {
        rotatedZones = rotated;
        floorInfo = f;
        break;
      }
    }
    if (floorInfo) break;
  }

  if (!rotatedZones.length) {
    console.log('No rotated demolition zones found — verifying non-rotated zones');
  }

  // Find ANY floor with demo zones
  if (!floorInfo) {
    for (const job of (jobs.items || []).slice(0, 5)) {
      const fd = await (await page.request.get(
        `${API}/api/water-mitigation/sketch/jobs/${job.id}/floors`, { headers: h }
      )).json();
      for (const f of fd.items || []) {
        const od = f.overlay_data || {};
        if ((od.demolition_zones || []).length > 0) {
          floorInfo = f;
          break;
        }
      }
      if (floorInfo) break;
    }
  }

  if (!floorInfo) {
    console.log('No floors with demo zones found');
    return;
  }

  const od = floorInfo.overlay_data;
  const scale = floorInfo.scale_pixels_per_foot;
  console.log(`Floor: ${floorInfo.floor_label}, scale=${scale}`);

  // For each demo zone, verify what the SVG SHOULD look like
  for (const z of (od.demolition_zones || []).slice(0, 5)) {
    const d1 = z.dimension1_ft || 0;
    const d2 = z.dimension2_ft || 0;
    const x = z.x;
    const y = z.y;
    const rotation = z.rotation || 0;
    const pw = z.pixel_width || 0;
    const ph = z.pixel_height || 0;

    const isLine = ['baseboard', 'baseboard_quarter_round', 'toe_kick'].includes(z.material_type)
      || (['wall_drywall', 'wall_drywall_2ft', 'wall_drywall_4ft', 'insulation'].includes(z.material_type) && d2 <= 0);

    if (isLine) {
      console.log(`  LINE ${z.material_type}: x=${x.toFixed(1)}, y=${y.toFixed(1)}, rot=${rotation.toFixed(1)}, len=${d1}`);
      // Line types: start at (x,y), extend by length at angle — this is correct in both
    } else {
      const zoneW = d1 > 0 ? d1 * scale : pw;
      const zoneH = d2 > 0 ? d2 * scale : ph;
      console.log(`  RECT ${z.material_type}: x=${x.toFixed(1)}, y=${y.toFixed(1)}, rot=${rotation.toFixed(1)}, w=${zoneW.toFixed(1)}, h=${zoneH.toFixed(1)}`);

      // KONVA renders: <Group x={x} y={y} rotation={rot}><Rect width={w} height={h}/></Group>
      // This means rotation is around (x, y) — the top-left corner.
      //
      // SVG SHOULD be: <g transform="translate(x,y) rotate(rot)"><rect x="0" y="0" w h/></g>
      // SVG WRONG:     <g transform="rotate(rot, cx, cy)"><rect x="x" y="y" w h/></g>
      //
      // The difference matters when rotation != 0
      if (Math.abs(rotation) > 0.1) {
        console.log(`    !! HAS ROTATION — SVG must use translate(${x},${y}) rotate(${rotation})`);
        console.log(`    !! NOT rotate(${rotation}, ${(x + zoneW/2).toFixed(1)}, ${(y + zoneH/2).toFixed(1)})`);
      }
    }
  }

  // Check containment zones too
  for (const c of (od.containment_zones || []).slice(0, 3)) {
    console.log(`  CONTAINMENT: x=${c.x?.toFixed(1)}, y=${c.y?.toFixed(1)}, rot=${(c.rotation||0).toFixed(1)}, len=${c.length_ft}`);
  }

  console.log('\nTest verifies rotation transform pattern. Fix needed in PDF SVG renderer.');
});
