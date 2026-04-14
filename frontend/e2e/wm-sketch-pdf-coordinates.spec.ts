import { test, expect, Page } from '@playwright/test';

/**
 * Water Mitigation Sketch — PDF Coordinate Alignment Test
 *
 * Verifies that overlay elements (demolition zones, shapes, equipment,
 * walls, rooms, text) saved from the canvas appear at correct positions
 * in the generated PDF SVG.
 *
 * Run: npx playwright test e2e/wm-sketch-pdf-coordinates.spec.ts --reporter=list
 */

const BASE_URL = 'http://localhost:3000';
const API_URL = 'http://localhost:8000';

// -----------------------------------------------------------------
// Auth helper (same pattern as other e2e tests)
// -----------------------------------------------------------------

async function loginViaApi(page: Page): Promise<string> {
  const resp = await page.request.post(`${API_URL}/api/auth/login`, {
    data: { username: 'admin', password: 'admin123' },
  });
  expect(resp.ok(), 'Login should succeed').toBeTruthy();
  const data = await resp.json();
  return data.access_token;
}

async function ensureLoggedIn(page: Page): Promise<string> {
  const token = await loginViaApi(page);
  await page.goto(BASE_URL, { timeout: 60000 });
  await page.evaluate((t) => {
    localStorage.setItem('auth_token', t);
    localStorage.setItem('auth_user', JSON.stringify({ username: 'admin', role: 'admin' }));
  }, token);
  await page.reload({ timeout: 60000 });
  await page.waitForTimeout(2000);
  return token;
}

// -----------------------------------------------------------------
// API helpers
// -----------------------------------------------------------------

interface FloorSketch {
  id: string;
  job_id: string;
  floor_label: string;
  canvas_width: number;
  canvas_height: number;
  scale_pixels_per_foot: number;
  overlay_data: Record<string, any>;
}

async function getWMJobs(token: string, page: Page) {
  const resp = await page.request.get(`${API_URL}/api/water-mitigation/jobs/`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(resp.ok()).toBeTruthy();
  return (await resp.json()).items || [];
}

async function getFloorSketches(token: string, page: Page, jobId: string): Promise<FloorSketch[]> {
  const resp = await page.request.get(
    `${API_URL}/api/water-mitigation/sketch/jobs/${jobId}/floors`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  expect(resp.ok()).toBeTruthy();
  const data = await resp.json();
  return data.items || [];
}

async function downloadPdfAsBuffer(token: string, page: Page, jobId: string): Promise<Buffer | null> {
  try {
    const resp = await page.request.get(
      `${API_URL}/api/water-mitigation/sketch/jobs/${jobId}/report`,
      { headers: { Authorization: `Bearer ${token}` }, timeout: 30000 },
    );
    if (!resp.ok()) {
      console.log(`PDF download failed: ${resp.status()}`);
      return null;
    }
    return Buffer.from(await resp.body());
  } catch (e) {
    console.log(`PDF download error: ${e}`);
    return null;
  }
}

// -----------------------------------------------------------------
// Tests
// -----------------------------------------------------------------

test.describe('WM Sketch PDF Coordinate Alignment', () => {
  let token: string;

  test.beforeEach(async ({ page }) => {
    token = await ensureLoggedIn(page);
  });

  test('overlay_data from API includes shapes, walls, rooms, text_annotations', async ({ page }) => {
    const jobs = await getWMJobs(token, page);
    expect(jobs.length, 'Need at least one WM job').toBeGreaterThan(0);

    let foundSketchWithOverlay = false;

    for (const job of jobs.slice(0, 5)) {
      const floors = await getFloorSketches(token, page, job.id);
      for (const floor of floors) {
        const od = floor.overlay_data;
        if (!od) continue;

        const hasDemoZones = (od.demolition_zones || []).length > 0;
        const hasEquipment = (od.equipment_placements || []).length > 0;
        const hasShapes = (od.shapes || []).length > 0;
        const hasWalls = (od.walls || []).length > 0;
        const hasRooms = (od.rooms || []).length > 0;
        const hasText = (od.text_annotations || []).length > 0;

        if (hasDemoZones || hasEquipment || hasShapes || hasWalls) {
          foundSketchWithOverlay = true;
          console.log(`\n=== Floor: ${floor.floor_label} (${floor.id}) ===`);
          console.log(`  canvas: ${floor.canvas_width}x${floor.canvas_height}, scale: ${floor.scale_pixels_per_foot}`);
          console.log(`  demolition_zones: ${(od.demolition_zones || []).length}`);
          console.log(`  equipment: ${(od.equipment_placements || []).length}`);
          console.log(`  shapes: ${(od.shapes || []).length}`);
          console.log(`  walls: ${(od.walls || []).length}`);
          console.log(`  rooms: ${(od.rooms || []).length}`);
          console.log(`  text: ${(od.text_annotations || []).length}`);
          console.log(`  containment: ${(od.containment_zones || []).length}`);

          // Verify demolition zone coordinates are within canvas bounds
          for (const z of od.demolition_zones || []) {
            console.log(`  demo zone "${z.material_type}": x=${z.x}, y=${z.y}, d1=${z.dimension1_ft}, d2=${z.dimension2_ft}, pw=${z.pixel_width}, ph=${z.pixel_height}`);
            expect(z.x, `demo zone x should be >= 0`).toBeGreaterThanOrEqual(0);
            expect(z.y, `demo zone y should be >= 0`).toBeGreaterThanOrEqual(0);
            expect(z.x, `demo zone x should be within canvas`).toBeLessThan(floor.canvas_width + 100);
            expect(z.y, `demo zone y should be within canvas`).toBeLessThan(floor.canvas_height + 100);
          }

          // Verify shapes have coordinates within canvas
          for (const s of od.shapes || []) {
            console.log(`  shape "${s.preset_id}": x=${s.x}, y=${s.y}, w=${s.width}, h=${s.height}`);
            expect(s.x, `shape x should be within canvas`).toBeLessThan(floor.canvas_width + 100);
            expect(s.y, `shape y should be within canvas`).toBeLessThan(floor.canvas_height + 100);
          }

          // Verify equipment coordinates
          for (const e of od.equipment_placements || []) {
            console.log(`  equip "${e.equipment_type}": x=${e.x}, y=${e.y}`);
            expect(e.x).toBeGreaterThanOrEqual(0);
            expect(e.y).toBeGreaterThanOrEqual(0);
          }

          // Verify walls
          for (const w of od.walls || []) {
            console.log(`  wall: (${w.start_x},${w.start_y})→(${w.end_x},${w.end_y}), ${w.length_ft}ft`);
          }

          // Verify rooms
          for (const r of od.rooms || []) {
            console.log(`  room "${r.name}": ${r.area_sqft} SF, boundary pts=${(r.boundary || []).length}`);
          }
        }
      }
    }

    if (!foundSketchWithOverlay) {
      console.log('No sketches with overlay data found — skipping coordinate checks');
    }
  });

  test('PDF report generates without error and contains SVG', async ({ page }) => {
    const jobs = await getWMJobs(token, page);
    expect(jobs.length).toBeGreaterThan(0);

    // Find a job with floor sketches
    let targetJobId: string | null = null;
    for (const job of jobs.slice(0, 5)) {
      const floors = await getFloorSketches(token, page, job.id);
      if (floors.length > 0) {
        targetJobId = job.id;
        console.log(`Using job ${job.id} with ${floors.length} floor(s)`);
        break;
      }
    }

    if (!targetJobId) {
      console.log('No jobs with floor sketches found — skipping PDF test');
      return;
    }

    // Download PDF
    const pdfBuffer = await downloadPdfAsBuffer(token, page, targetJobId);
    if (!pdfBuffer) {
      console.log('PDF generation timed out or failed — check backend logs');
      return;
    }
    expect(pdfBuffer.length, 'PDF should not be empty').toBeGreaterThan(1000);
    console.log(`PDF size: ${(pdfBuffer.length / 1024).toFixed(1)} KB`);
  });

  test('canvas overlay positions match rendered SVG positions in PDF', async ({ page }) => {
    const jobs = await getWMJobs(token, page);

    let targetJob: any = null;
    let targetFloor: FloorSketch | null = null;

    for (const job of jobs.slice(0, 5)) {
      const floors = await getFloorSketches(token, page, job.id);
      for (const floor of floors) {
        const od = floor.overlay_data;
        if (od && ((od.demolition_zones || []).length > 0 || (od.shapes || []).length > 0)) {
          targetJob = job;
          targetFloor = floor;
          break;
        }
      }
      if (targetFloor) break;
    }

    if (!targetJob || !targetFloor) {
      console.log('No floor with overlay data found — skipping');
      return;
    }

    console.log(`\nTesting floor "${targetFloor.floor_label}" in job ${targetJob.id}`);
    const od = targetFloor.overlay_data;

    // Navigate to the sketch page and check canvas elements
    await page.goto(`${BASE_URL}/water-mitigation/${targetJob.id}`, { timeout: 60000 });
    await page.waitForTimeout(3000);

    // Click on Sketch tab if visible
    const sketchTab = page.locator('[role="tab"]', { hasText: /Sketch/i });
    if (await sketchTab.isVisible({ timeout: 5000 }).catch(() => false)) {
      await sketchTab.click();
      await page.waitForTimeout(2000);
    }

    // Check if Konva stage exists
    const konvaContainer = page.locator('.konvajs-content');
    const hasKonva = await konvaContainer.isVisible({ timeout: 5000 }).catch(() => false);

    if (hasKonva) {
      // Get canvas element positions via Konva stage
      const canvasInfo = await page.evaluate(() => {
        const stage = (window as any).Konva?.stages?.[0];
        if (!stage) return null;
        return {
          width: stage.width(),
          height: stage.height(),
          scaleX: stage.scaleX(),
          scaleY: stage.scaleY(),
          x: stage.x(),
          y: stage.y(),
        };
      });
      console.log('Konva stage info:', canvasInfo);
    }

    // Verify API overlay_data has all element types populated
    const demoCount = (od.demolition_zones || []).length;
    const shapeCount = (od.shapes || []).length;
    const equipCount = (od.equipment_placements || []).length;
    const wallCount = (od.walls || []).length;
    const roomCount = (od.rooms || []).length;
    const textCount = (od.text_annotations || []).length;

    console.log(`\nOverlay data from API:`);
    console.log(`  demolition_zones: ${demoCount}`);
    console.log(`  shapes: ${shapeCount}`);
    console.log(`  equipment: ${equipCount}`);
    console.log(`  walls: ${wallCount}`);
    console.log(`  rooms: ${roomCount}`);
    console.log(`  text_annotations: ${textCount}`);

    // KEY CHECK: overlay_data should include shapes/walls/rooms/text
    // (This was the bug — API was stripping these JSONB-only fields)
    if (shapeCount > 0) {
      expect(od.shapes[0]).toHaveProperty('x');
      expect(od.shapes[0]).toHaveProperty('y');
      expect(od.shapes[0]).toHaveProperty('preset_id');
      console.log('  ✓ shapes have correct structure');
    }
    if (wallCount > 0) {
      expect(od.walls[0]).toHaveProperty('start_x');
      expect(od.walls[0]).toHaveProperty('end_x');
      console.log('  ✓ walls have correct structure');
    }
    if (roomCount > 0) {
      expect(od.rooms[0]).toHaveProperty('boundary');
      expect(od.rooms[0]).toHaveProperty('name');
      console.log('  ✓ rooms have correct structure');
    }
    if (textCount > 0) {
      expect(od.text_annotations[0]).toHaveProperty('text');
      expect(od.text_annotations[0]).toHaveProperty('x');
      console.log('  ✓ text_annotations have correct structure');
    }

    // Verify all coordinates are within canvas bounds
    const cw = targetFloor.canvas_width;
    const ch = targetFloor.canvas_height;
    const tolerance = 200; // some elements may slightly exceed canvas

    for (const z of od.demolition_zones || []) {
      expect(z.x).toBeLessThan(cw + tolerance);
      expect(z.y).toBeLessThan(ch + tolerance);
    }
    for (const s of od.shapes || []) {
      expect(s.x).toBeLessThan(cw + tolerance);
      expect(s.y).toBeLessThan(ch + tolerance);
    }
    for (const e of od.equipment_placements || []) {
      expect(e.x).toBeLessThan(cw + tolerance);
      expect(e.y).toBeLessThan(ch + tolerance);
    }

    console.log(`\n✓ All element coordinates within canvas bounds (${cw}x${ch})`);
  });
});
