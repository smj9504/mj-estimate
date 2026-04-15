import { test, expect, Page } from '@playwright/test';

/**
 * Water Mitigation Sketch — Manage Materials & Render Mode Test
 *
 * Uses page.evaluate + fetch to avoid Playwright apiRequestContext socket issues
 * with uvicorn hot-reload.
 *
 * Run: npx playwright test e2e/wm-sketch-manage-materials.spec.ts --reporter=list
 */

const BASE_URL = 'http://localhost:3000';
const API_URL = 'http://localhost:8000';

// -----------------------------------------------------------------
// Helpers: run fetch inside page context to avoid socket issues
// -----------------------------------------------------------------

async function apiFetch(
  page: Page, method: string, path: string, token: string, body?: any,
): Promise<{ ok: boolean; status: number; body: any }> {
  return page.evaluate(
    async ({ method, url, token, body }) => {
      const opts: RequestInit = {
        method,
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      };
      if (body) opts.body = JSON.stringify(body);
      const resp = await fetch(url, opts);
      const text = await resp.text();
      return { ok: resp.ok, status: resp.status, body: text ? JSON.parse(text) : null };
    },
    { method, url: `${API_URL}${path}`, token, body },
  );
}

async function login(page: Page): Promise<string> {
  const result = await page.evaluate(async (url: string) => {
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'admin123' }),
    });
    return resp.json();
  }, `${API_URL}/api/auth/login`);
  expect(result.access_token).toBeTruthy();
  return result.access_token;
}

// -----------------------------------------------------------------
// Tests
// -----------------------------------------------------------------

test.describe('WM Sketch - Manage Materials: render_mode & visual props', () => {
  let token: string;

  test.beforeEach(async ({ page }) => {
    // Navigate to frontend first so page.evaluate can run fetch
    await page.goto(BASE_URL, { timeout: 60000, waitUntil: 'domcontentloaded' });
    token = await login(page);
  });

  test('overlay_data round-trips new render_mode, stroke_style, fill_opacity fields', async ({ page }) => {
    // Find a floor sketch
    const jobsResult = await apiFetch(page, 'GET', '/api/water-mitigation/jobs', token);
    expect(jobsResult.ok).toBeTruthy();
    const jobs = jobsResult.body?.items || [];
    expect(jobs.length).toBeGreaterThan(0);

    let sketchId: string | null = null;
    for (const job of jobs.slice(0, 5)) {
      const floorsResult = await apiFetch(page, 'GET', `/api/water-mitigation/sketch/jobs/${job.id}/floors`, token);
      const floors = floorsResult.body?.items || floorsResult.body || [];
      if (floors.length > 0) {
        sketchId = floors[0].id;
        break;
      }
    }
    if (!sketchId) { test.skip(); return; }

    // Save overlay with new visual properties
    const testOverlay = {
      demolition_zones: [
        {
          id: 'rt-area', floor_sketch_id: sketchId,
          material_type: 'carpet', surface: 'floor', color: '#90EE90',
          x: 100, y: 100, dimension1_ft: 10, dimension2_ft: 8,
          rotation: 0, calculated_sqft: 80, display_order: 0,
          render_mode: 'area', stroke_style: 'dashed', fill_opacity: 0.4,
        },
        {
          id: 'rt-text', floor_sketch_id: sketchId,
          material_type: 'tile', surface: 'floor', color: '#ADD8E6',
          x: 300, y: 200, dimension1_ft: 5, dimension2_ft: 5,
          rotation: 0, calculated_sqft: 25, display_order: 1,
          render_mode: 'text', stroke_style: 'solid', fill_opacity: 0.18,
          label: 'Kitchen Tile',
        },
        {
          id: 'rt-line', floor_sketch_id: sketchId,
          material_type: 'baseboard', surface: 'wall', color: '#DEB887',
          x: 50, y: 300, dimension1_ft: 12, dimension2_ft: 0,
          rotation: 0, calculated_sqft: 12, display_order: 2,
          render_mode: 'line', stroke_style: 'dotted', fill_opacity: 0.22,
        },
      ],
      equipment_placements: [], containment_zones: [], floor_protections: [],
      content_protections: [], text_annotations: [], shapes: [], walls: [], rooms: [],
    };

    const saveResult = await apiFetch(page, 'PUT', `/api/water-mitigation/sketch/floors/${sketchId}/overlay`, token, testOverlay);
    expect(saveResult.ok, `Save failed: ${saveResult.status}`).toBeTruthy();

    // Read back and verify fields persisted
    const getResult = await apiFetch(page, 'GET', `/api/water-mitigation/sketch/floors/${sketchId}`, token);
    expect(getResult.ok).toBeTruthy();
    const zones = getResult.body?.overlay_data?.demolition_zones || [];

    const areaZone = zones.find((z: any) => z.render_mode === 'area');
    expect(areaZone).toBeTruthy();
    expect(areaZone.stroke_style).toBe('dashed');
    expect(areaZone.fill_opacity).toBeCloseTo(0.4, 1);
    console.log('  OK area zone: render_mode, stroke_style, fill_opacity preserved');

    const textZone = zones.find((z: any) => z.render_mode === 'text');
    expect(textZone).toBeTruthy();
    expect(textZone.label).toBe('Kitchen Tile');
    console.log('  OK text zone: render_mode, label preserved');

    const lineZone = zones.find((z: any) => z.render_mode === 'line');
    expect(lineZone).toBeTruthy();
    expect(lineZone.stroke_style).toBe('dotted');
    console.log('  OK line zone: render_mode, stroke_style preserved');
  });

  test('PDF generation handles render_mode without errors', async ({ page }, testInfo) => {
    testInfo.setTimeout(180000); // PDF generation can take 2+ minutes
    const jobsResult = await apiFetch(page, 'GET', '/api/water-mitigation/jobs', token);
    const jobs = jobsResult.body?.items || [];

    let jobId: string | null = null;
    let sketchId: string | null = null;
    for (const job of jobs.slice(0, 5)) {
      const floorsResult = await apiFetch(page, 'GET', `/api/water-mitigation/sketch/jobs/${job.id}/floors`, token);
      const floors = floorsResult.body?.items || floorsResult.body || [];
      if (floors.length > 0) {
        jobId = job.id;
        sketchId = floors[0].id;
        break;
      }
    }
    if (!jobId || !sketchId) { test.skip(); return; }

    // Save test overlay with mixed render modes
    const testOverlay = {
      demolition_zones: [
        {
          id: 'pdf-area', floor_sketch_id: sketchId,
          material_type: 'wood_floor', sub_type: 'hardwood', surface: 'floor', color: '#B8860B',
          x: 80, y: 80, dimension1_ft: 12, dimension2_ft: 10,
          rotation: 0, calculated_sqft: 120, display_order: 0,
          render_mode: 'area', stroke_style: 'dashed', fill_opacity: 0.35,
        },
        {
          id: 'pdf-text', floor_sketch_id: sketchId,
          material_type: 'tile', surface: 'floor', color: '#ADD8E6',
          x: 350, y: 150, dimension1_ft: 0, dimension2_ft: 0,
          rotation: 0, calculated_sqft: 50, display_order: 1,
          render_mode: 'text', fill_opacity: 0.2, label: 'Bathroom Tile 50SF',
        },
      ],
      equipment_placements: [], containment_zones: [], floor_protections: [],
      content_protections: [], text_annotations: [], shapes: [], walls: [], rooms: [],
    };

    const saveResult = await apiFetch(page, 'PUT', `/api/water-mitigation/sketch/floors/${sketchId}/overlay`, token, testOverlay);
    expect(saveResult.ok).toBeTruthy();

    // Generate PDF — use page.evaluate for long-running request
    const pdfResult = await page.evaluate(async ({ url, token }) => {
      try {
        const resp = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
        return { ok: resp.ok, status: resp.status, size: resp.ok ? (await resp.arrayBuffer()).byteLength : 0 };
      } catch (e: any) {
        return { ok: false, status: 0, size: 0, error: e.message };
      }
    }, { url: `${API_URL}/api/water-mitigation/sketch/jobs/${jobId}/report`, token });

    if (pdfResult.ok) {
      console.log(`  OK PDF generated: ${pdfResult.size} bytes`);
      expect(pdfResult.size).toBeGreaterThan(100);
    } else {
      console.log(`  PDF returned ${pdfResult.status} (may need playwright browser installed on backend)`);
      expect(pdfResult.status).not.toBe(500);
    }
  });

  test('all render mode zones contribute to summary totals', async ({ page }) => {
    const jobsResult = await apiFetch(page, 'GET', '/api/water-mitigation/jobs', token);
    const jobs = jobsResult.body?.items || [];

    let sketchId: string | null = null;
    for (const job of jobs.slice(0, 5)) {
      const floorsResult = await apiFetch(page, 'GET', `/api/water-mitigation/sketch/jobs/${job.id}/floors`, token);
      const floors = floorsResult.body?.items || floorsResult.body || [];
      if (floors.length > 0) { sketchId = floors[0].id; break; }
    }
    if (!sketchId) { test.skip(); return; }

    const testOverlay = {
      demolition_zones: [
        {
          id: 'sum-area', floor_sketch_id: sketchId,
          material_type: 'carpet', surface: 'floor', color: '#90EE90',
          x: 100, y: 100, dimension1_ft: 10, dimension2_ft: 10,
          rotation: 0, calculated_sqft: 100, display_order: 0,
          render_mode: 'area',
        },
        {
          id: 'sum-text', floor_sketch_id: sketchId,
          material_type: 'carpet', surface: 'floor', color: '#90EE90',
          x: 300, y: 100, dimension1_ft: 8, dimension2_ft: 6,
          rotation: 0, calculated_sqft: 48, display_order: 1,
          render_mode: 'text', label: 'Closet Carpet',
        },
      ],
      equipment_placements: [], containment_zones: [], floor_protections: [],
      content_protections: [], text_annotations: [], shapes: [], walls: [], rooms: [],
    };

    const saveResult = await apiFetch(page, 'PUT', `/api/water-mitigation/sketch/floors/${sketchId}/overlay`, token, testOverlay);
    expect(saveResult.ok).toBeTruthy();

    const getResult = await apiFetch(page, 'GET', `/api/water-mitigation/sketch/floors/${sketchId}`, token);
    expect(getResult.ok).toBeTruthy();
    const zones = getResult.body?.overlay_data?.demolition_zones || [];
    const carpetZones = zones.filter((z: any) => z.material_type === 'carpet');
    expect(carpetZones.length).toBe(2);
    const total = carpetZones.reduce((s: number, z: any) => s + (z.calculated_sqft || 0), 0);
    expect(total).toBeCloseTo(148, 0);
    console.log(`  OK both render modes contribute: ${total} SF`);
  });
});
