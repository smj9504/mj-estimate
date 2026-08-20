/**
 * Network fixture for the Water Mitigation sketch tests.
 *
 * The sketch editor is pure front-end behaviour (Konva canvas, gestures,
 * responsive layout), so these tests stub the API rather than requiring a
 * live backend and a seeded database. Everything under /api is answered from
 * the fixtures below; writes are accepted and echoed back so the editor's
 * optimistic updates settle exactly as they would against the real service.
 */

import type { Locator, Page, Route } from '@playwright/test';

export const JOB_ID = '11111111-1111-1111-1111-111111111111';
export const FLOOR_ID = '22222222-2222-2222-2222-222222222222';
export const JOB_ADDRESS = '6305 Musket Ball Dr';

const EMPTY_OVERLAY = {
  demolition_zones: [],
  equipment_placements: [],
  containment_zones: [],
  floor_protections: [],
  content_protections: [],
  content_manipulations: [],
  text_annotations: [],
  shapes: [],
  walls: [],
  rooms: [],
};

const USER = {
  id: '99999999-9999-9999-9999-999999999999',
  username: 'admin',
  email: 'admin@example.com',
  full_name: 'Admin',
  role: 'admin',
  is_active: true,
  is_superuser: true,
};

const JOB = {
  id: JOB_ID,
  job_number: 'WM-0001',
  property_address: JOB_ADDRESS,
  client_id: null,
  company_id: null,
  claim_id: null,
  status: 'in_progress',
  date_of_loss: '2026-01-05',
  mitigation_start_date: '2026-01-06',
  mitigation_end_date: null,
  created_at: '2026-01-05T00:00:00Z',
  updated_at: '2026-01-06T00:00:00Z',
};

function floorSketch(overrides: Record<string, unknown> = {}) {
  return {
    id: FLOOR_ID,
    job_id: JOB_ID,
    floor_label: '1st Floor',
    floor_order: 0,
    address_display: JOB_ADDRESS,
    source_type: 'sketch',
    canvas_width: 1200,
    canvas_height: 900,
    scale_pixels_per_foot: 20,
    overlay_data: EMPTY_OVERLAY,
    created_at: '2026-01-05T00:00:00Z',
    updated_at: '2026-01-06T00:00:00Z',
    ...overrides,
  };
}

const json = (route: Route, body: unknown, status = 200) =>
  route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

export interface SketchApiMock {
  /**
   * The overlay most recently persisted by the editor, or null if nothing has
   * been saved yet. Lets a test assert on what the app actually stores rather
   * than on pixels.
   */
  getSavedOverlay: () => any;
}

/**
 * Install the auth session and the stubbed API.
 * Call before `page.goto`.
 */
export async function mockSketchApi(page: Page): Promise<SketchApiMock> {
  // Seed a logged-in session so ProtectedRoute lets the page render.
  await page.addInitScript(
    ([user]) => {
      localStorage.setItem('auth_token', 'e2e-test-token');
      localStorage.setItem('auth_user', JSON.stringify(user));
    },
    [USER]
  );

  // Saved overlay data, so a save followed by a reload round-trips.
  let savedOverlay: any = EMPTY_OVERLAY;
  let hasSaved = false;

  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    const method = route.request().method();

    if (path.endsWith('/api/auth/me')) return json(route, USER);
    if (path.includes('/api/companies')) return json(route, []);

    // ---- sketch endpoints ----
    if (path.includes('/api/water-mitigation/sketch/jobs/') && path.endsWith('/floors')) {
      if (method === 'GET') {
        // The list endpoint is paginated: the client reads `.items`
        return json(route, { items: [floorSketch({ overlay_data: savedOverlay })], total: 1 });
      }
      if (method === 'POST') {
        const body = route.request().postDataJSON?.() ?? {};
        return json(route, floorSketch({ id: `new-${Date.now()}`, ...body }), 201);
      }
    }
    if (path.includes('/api/water-mitigation/sketch/floors/') && path.endsWith('/overlay')) {
      // Full replace, mirroring the backend contract
      savedOverlay = route.request().postDataJSON?.() ?? savedOverlay;
      hasSaved = true;
      return json(route, savedOverlay);
    }
    if (path.includes('/api/water-mitigation/sketch/floors/')) {
      if (method === 'DELETE') return route.fulfill({ status: 204, body: '' });
      const body = route.request().postDataJSON?.() ?? {};
      return json(route, floorSketch({ overlay_data: savedOverlay, ...body }));
    }

    // ---- job endpoints ----
    if (path.includes('/api/water-mitigation/jobs/') && path.includes('/status-history')) {
      return json(route, []);
    }
    if (path.includes('/api/water-mitigation/jobs/') && path.includes('/photos')) {
      return json(route, []);
    }
    if (path.includes('/api/water-mitigation/jobs/')) return json(route, JOB);

    // Anything else the detail page happens to poll: an empty list is a safe
    // default and keeps an unmocked call from failing the test for the wrong
    // reason.
    return json(route, []);
  });

  return { getSavedOverlay: () => (hasSaved ? savedOverlay : null) };
}

/**
 * Bring an overflowing antd tab into view.
 *
 * The tab strip is translated rather than natively scrolled, so
 * `scrollIntoViewIfNeeded` cannot reach a clipped tab. antd pans the strip in
 * response to wheel deltas, which is what this uses. (Navigating to the tab is
 * page chrome, not the sketch behaviour under test.)
 */
async function revealTab(page: Page, nav: Locator, tab: Locator) {
  for (let attempt = 0; attempt < 10; attempt++) {
    const [navBox, tabBox] = await Promise.all([nav.boundingBox(), tab.boundingBox()]);
    if (!navBox || !tabBox) return;
    if (tabBox.x >= navBox.x && tabBox.x + tabBox.width <= navBox.x + navBox.width) return;

    await page.mouse.move(navBox.x + navBox.width / 2, navBox.y + navBox.height / 2);
    await page.mouse.wheel(150, 0);
    await page.waitForTimeout(120);
  }
}

/** Open the Sketch tab of the mocked job and wait for the canvas to mount. */
export async function gotoSketchTab(page: Page) {
  await page.goto(`/water-mitigation/${JOB_ID}`);
  const sketchTab = page.getByRole('tab', { name: 'Sketch' });
  await sketchTab.waitFor({ state: 'attached', timeout: 30_000 });

  await revealTab(page, page.locator('.ant-tabs-nav-wrap').first(), sketchTab);

  await sketchTab.click();
  await page.locator('[data-testid="wm-sketch-canvas-container"] canvas').first()
    .waitFor({ state: 'visible', timeout: 30_000 });
  // The editor fits the stage to the viewport on mount; wait for that to land
  // so gesture coordinates map to a settled canvas.
  await page.waitForTimeout(300);
}
