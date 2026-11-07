import { test, expect as baseExpect, Page } from '@playwright/test';

// Leaving a cabinet estimate and coming back shows the sketch as it was left,
// and doesn't save anything over it. Runs against the dev server with /api
// answered here; `server` stands in for the backend's saved estimate and sketch.

const expect = baseExpect.configure({ timeout: 20_000 });

const ID = '22222222-2222-2222-2222-222222222222';
const PATH = `/cabinet-estimates/${ID}`;

const box = (code: string, width: number, order: number) => ({
  id: `box-${code}`,
  code,
  cab_type: 'base',
  location: 'perimeter',
  width_inches: width,
  height_inches: 34.5,
  is_specialty: false,
  specialty_type: null,
  has_glass_door: false,
  qty: 1,
  display_order: order,
});

const ESTIMATE = {
  id: ID,
  status: 'draft',
  kind: 'restoration',
  property_address: '1 Old Rd, Fairfax, VA 22030',
  tier: 'Standard',
  boxes: [box('B30', 30, 0), box('B33', 33, 1), box('B36', 36, 2)],
  line_items: [],
  appliance_list: [],
  group_members: [],
  total: 0,
};

interface Spot { id: string; x: number; y: number }

interface Server {
  overlay: { cabinets: Spot[]; [key: string]: unknown };
  boxes: { code: string }[];
  /** How long a save takes to reach the database, ms. */
  saveDelay: number;
}

async function start(page: Page): Promise<Server> {
  const server: Server = {
    overlay: { walls: [], cabinets: [], appliances: [], element_order: [] },
    boxes: ESTIMATE.boxes,
    saveDelay: 0,
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
    // Edit and Sketch on tabs of their own, as these tests open the Sketch tab (wide screens default to side by side).
    localStorage.setItem('cabinet-estimate.view', 'tabs');
  });

  await page.route('**/api/**', async route => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace(/\/$/, '');
    const method = request.method();
    const json = (body: unknown) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });

    if (path === '/api/auth/me') return json({ id: 'u1', username: 'admin', role: 'admin', is_active: true });
    if (path === '/api/cabinet-estimates') return json({ items: [], total: 0 });
    if (path === `/api/cabinet-estimates/${ID}/sketch`) return json(sketch());
    if (path === `/api/cabinet-estimates/${ID}/sketch/overlay`) {
      const saved = request.postDataJSON();
      await new Promise(resolve => setTimeout(resolve, server.saveDelay));
      server.overlay = saved;
      return json(sketch());
    }
    if (path === `/api/cabinet-estimates/${ID}`) {
      if (method === 'PUT') {
        const { boxes } = request.postDataJSON();
        if (boxes) {
          await new Promise(resolve => setTimeout(resolve, server.saveDelay));
          server.boxes = boxes;
        }
      }
      return json({ ...ESTIMATE, boxes: server.boxes });
    }
    if (path.endsWith('/history')) return json([]);
    return json([]);
  });

  await page.goto(PATH);
  return server;
}

const openSketch = async (page: Page) => {
  await page.getByRole('tab', { name: 'Sketch' }).click({ timeout: 90_000 });
  await page.locator('.konvajs-content').first().waitFor();
};

/** The cabinets on the canvas: their saved place, and where they are on screen. */
const drawn = (page: Page) =>
  page.evaluate(() => {
    const stage = (window as any).Konva.stages.find((s: any) => s.container().isConnected);
    const { left, top } = stage.container().getBoundingClientRect();
    return stage
      .find('Group')
      .filter((g: any) => g.draggable())
      .map((g: any) => {
        const r = g.getClientRect();
        return { x: g.x(), y: g.y(), screenX: left + r.x + r.width / 2, screenY: top + r.y + r.height / 2 };
      });
  });

const places = (cabinets: { x: number; y: number }[]) =>
  cabinets.map(c => `${Math.round(c.x)},${Math.round(c.y)}`).sort();

const dragFirstCabinetDown = async (page: Page) => {
  const [first] = await drawn(page);
  await page.mouse.move(first.screenX, first.screenY);
  await page.mouse.down();
  await page.mouse.move(first.screenX + 40, first.screenY + 200, { steps: 8 });
  await page.mouse.up();
};

/** Leave for the list and come back with the browser's Back: the page never reloads. */
const leaveAndComeBack = async (page: Page) => {
  await page.getByRole('button', { name: /Back/ }).first().click();
  await expect(page).toHaveURL(/\/cabinet-estimates$/);
  // Going back before the list has drawn would find the old editor still alive, sketch and all.
  await page.getByRole('button', { name: /New Estimate/ }).waitFor();
  await expect(page.locator('.konvajs-content')).toHaveCount(0);
  await page.goBack();
  await expect(page).toHaveURL(new RegExp(`${PATH}$`));
  await openSketch(page);
};

const AUTOSAVE_SETTLED_MS = 2500;

test.describe('coming back to a cabinet sketch', () => {
  test.use({ viewport: { width: 1500, height: 1100 } });

  test('cabinets stay where they were moved, on screen and saved', async ({ page }) => {
    const server = await start(page);
    await openSketch(page);
    // First opening: every box gets a shape along the top, and that is saved.
    await expect.poll(() => server.overlay.cabinets.length).toBe(3);
    const row = places(server.overlay.cabinets);

    await dragFirstCabinetDown(page);
    await expect.poll(() => places(server.overlay.cabinets)).not.toEqual(row);
    const moved = places(server.overlay.cabinets);

    await leaveAndComeBack(page);
    await expect.poll(async () => places(await drawn(page))).toEqual(moved);

    await page.waitForTimeout(AUTOSAVE_SETTLED_MS);
    expect(places(server.overlay.cabinets)).toEqual(moved);
  });

  test('a move still saving when leaving is there on coming back', async ({ page }) => {
    const server = await start(page);
    await openSketch(page);
    await expect.poll(() => server.overlay.cabinets.length).toBe(3);
    const row = places(server.overlay.cabinets);

    server.saveDelay = 3000;
    await dragFirstCabinetDown(page);
    const moved = places(await drawn(page));
    expect(moved).not.toEqual(row);

    await leaveAndComeBack(page);
    await expect.poll(async () => places(await drawn(page))).toEqual(moved);

    // Long enough for the slow save to land and for any save it set off.
    await page.waitForTimeout(server.saveDelay + AUTOSAVE_SETTLED_MS);
    expect(places(await drawn(page))).toEqual(moved);
    expect(places(server.overlay.cabinets)).toEqual(moved);
  });

  test('a cabinet deleted just before leaving stays deleted', async ({ page }) => {
    const server = await start(page);
    await openSketch(page);
    await expect.poll(() => server.overlay.cabinets.length).toBe(3);

    server.saveDelay = 3000;
    const [first, ...others] = await drawn(page);
    await page.mouse.click(first.screenX, first.screenY);
    await page.keyboard.press('Delete');
    await expect.poll(async () => (await drawn(page)).length).toBe(2);

    await leaveAndComeBack(page);
    await expect.poll(async () => places(await drawn(page))).toEqual(places(others));

    await page.waitForTimeout(server.saveDelay + AUTOSAVE_SETTLED_MS);
    expect(places(await drawn(page))).toEqual(places(others));
    expect(places(server.overlay.cabinets)).toEqual(places(others));
    expect(server.boxes.length).toBe(2);
  });
});
