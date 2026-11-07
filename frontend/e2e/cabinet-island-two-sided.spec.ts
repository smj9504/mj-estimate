import { test, expect as baseExpect, Page } from '@playwright/test';

// "Cabinets on both sides" for a kitchen estimate's island: saved with the
// estimate, it takes the back panel and the seating overhang off the Edit tab,
// and the Sketch lays a straight island out in two back-to-back rows (and back
// to one row when it is turned off). Runs against the dev server with /api
// answered here; `server` stands in for the backend's estimate and sketch.

const expect = baseExpect.configure({ timeout: 20_000 });

const ID = '66666666-6666-6666-6666-666666666666';
const PATH = `/cabinet-estimates/${ID}`;

const box = (code: string, width: number, location: 'perimeter' | 'island', order: number, qty = 1) => ({
  id: `box-${code}-${location}`,
  code,
  cab_type: 'base',
  location,
  width_inches: width,
  height_inches: 34.5,
  is_specialty: false,
  specialty_type: null,
  has_glass_door: false,
  qty,
  display_order: order,
});

const ESTIMATE = {
  id: ID,
  status: 'draft',
  kind: 'restoration',
  property_address: '1 Old Rd, Fairfax, VA 22030',
  tier: 'Stock',
  boxes: [box('B36', 36, 'perimeter', 0), box('B30', 30, 'island', 1, 4)],
  line_items: [],
  appliance_list: [],
  group_members: [],
  total: 0,
  island_type: 'custom',
  include_countertop: true,
  island_seating_overhang_in: 12,
  island_back_panel_sqft: 11.5,
  island_end_panel_sqft: 0,
  island_two_sided: false,
};

interface Spot {
  id: string;
  x: number;
  y: number;
  rotation: number;
  location?: string;
}

interface Server {
  estimate: Record<string, unknown>;
  overlay: { cabinets: Spot[]; island_two_sided?: boolean | null; [key: string]: unknown };
  /** Every PUT of the estimate, as sent. */
  saves: Record<string, unknown>[];
}

async function start(page: Page): Promise<Server> {
  const server: Server = {
    estimate: { ...ESTIMATE },
    overlay: { walls: [], cabinets: [], appliances: [], element_order: [] },
    saves: [],
  };
  const sketch = () => ({
    id: 'sketch-1',
    estimate_id: ID,
    canvas_width: 1200,
    canvas_height: 900,
    scale_pixels_per_foot: 20,
    overlay_data: server.overlay,
  });

  await page.addInitScript(() => {
    localStorage.setItem('auth_token', 'test-token');
    localStorage.setItem('auth_user', JSON.stringify({ id: 'u1', username: 'admin', role: 'admin' }));
    // The query devtools button sits over the bottom right of the page.
    document.addEventListener('DOMContentLoaded', () => {
      const style = document.createElement('style');
      style.textContent = '.tsqd-parent-container { display: none !important; }';
      document.head.appendChild(style);
    });
  });

  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace(/\/$/, '');
    const method = request.method();
    const json = (body: unknown) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });

    if (path === '/api/auth/me') return json({ id: 'u1', username: 'admin', role: 'admin', is_active: true });
    if (path === '/api/cabinet-estimates') return json({ items: [], total: 0 });
    if (path === `/api/cabinet-estimates/${ID}/sketch`) return json(sketch());
    if (path === `/api/cabinet-estimates/${ID}/sketch/overlay`) {
      server.overlay = request.postDataJSON();
      return json(sketch());
    }
    if (path === `/api/cabinet-estimates/${ID}`) {
      if (method === 'PUT') {
        const payload = request.postDataJSON();
        server.saves.push(payload);
        server.estimate = { ...server.estimate, ...payload };
      }
      return json(server.estimate);
    }
    return json([]);
  });

  await page.goto(PATH);
  return server;
}

const openTab = async (page: Page, name: 'Edit' | 'Sketch') => {
  await page.getByRole('tab', { name }).click({ timeout: 90_000 });
  if (name === 'Sketch') await page.locator('.konvajs-content').first().waitFor();
};

/** The island's cabinets as saved: which way each faces, and the back lines they stand on. */
const island = (server: Server) => {
  const cabs = server.overlay.cabinets.filter((c) => c.location === 'island');
  return {
    count: cabs.length,
    rotations: cabs.map((c) => Math.round(c.rotation)).sort((a, b) => a - b),
    rows: new Set(cabs.map((c) => Math.round(c.y))).size,
  };
};

const bothSides = (page: Page) => page.getByRole('checkbox', { name: 'Cabinets on both sides' });

test.describe('an island with cabinets on both sides', () => {
  test.use({ viewport: { width: 1500, height: 1100 } });

  test('lays the island out in two rows on the Sketch and back, and is saved with the estimate', async ({ page }) => {
    const server = await start(page);
    // The Sketch places the island as one row first.
    await openTab(page, 'Sketch');
    await expect.poll(() => island(server)).toEqual({ count: 4, rotations: [0, 0, 0, 0], rows: 1 });

    await openTab(page, 'Edit');
    await expect(page.getByText('Back Panel', { exact: true })).toBeVisible();
    await bothSides(page).check();

    // Back to back: two facing each way, their backs on one line; the sketch notes what it was laid out for.
    await expect.poll(() => island(server)).toEqual({ count: 4, rotations: [0, 0, 180, 180], rows: 1 });
    await expect.poll(() => server.overlay.island_two_sided).toBe(true);

    // The Edit tab follows: no back panel, no seating side, ends twice as deep.
    await expect(page.getByText('None — with cabinets on both sides, the backs face each other.')).toBeVisible();
    await expect(page.getByText('None — with cabinets on both sides, no side is free for seating.')).toBeVisible();
    await expect(page.getByText('2 ends × 48" deep = 8 LF')).toBeVisible();
    // The suggested top: 60" + 3" long, 48" + 3" deep, with no seating overhang.
    await expect(page.getByText('63" × 51" =')).toBeVisible();
    await page.getByText('Island Panels').scrollIntoViewIfNeeded();
    await page.screenshot({ path: test.info().outputPath('edit-tab-two-sided.png'), fullPage: false });

    await page.getByRole('button', { name: /^save Save$/ }).click();
    await expect.poll(() => server.saves.at(-1)?.island_two_sided).toBe(true);

    await openTab(page, 'Sketch');
    await page.screenshot({ path: test.info().outputPath('sketch-two-sided.png'), fullPage: false });

    // Turned off: one row again, facing the way it did.
    await openTab(page, 'Edit');
    await bothSides(page).uncheck();
    await expect.poll(() => island(server)).toEqual({ count: 4, rotations: [0, 0, 0, 0], rows: 1 });
    await expect.poll(() => server.overlay.island_two_sided).toBe(false);
    await expect(page.getByText('2 ends × 24" deep = 4 LF')).toBeVisible();
  });

  test('opening it again keeps both, and leaves the island as it is', async ({ page }) => {
    const server = await start(page);
    await openTab(page, 'Sketch');
    await expect.poll(() => island(server).count).toBe(4);
    await openTab(page, 'Edit');
    await bothSides(page).check();
    await expect.poll(() => island(server).rotations).toEqual([0, 0, 180, 180]);
    await page.getByRole('button', { name: /^save Save$/ }).click();
    await expect.poll(() => server.saves.length).toBe(1);
    const laid = JSON.stringify(server.overlay.cabinets);

    await page.reload();
    await expect(bothSides(page)).toBeChecked({ timeout: 90_000 });
    await openTab(page, 'Sketch');
    await page.waitForTimeout(2500);
    expect(JSON.stringify(server.overlay.cabinets)).toBe(laid);
  });
});
