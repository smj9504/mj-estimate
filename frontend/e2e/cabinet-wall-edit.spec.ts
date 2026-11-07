import { test, expect as baseExpect, Page } from '@playwright/test';

// Fixing a wall drawn wrong on the cabinet sketch: dragging one of its end
// handles changes only that end, dragging the wall moves it, and one undo
// takes either back. The handles sit inside the wall's draggable group, so
// a handle's drop used to bubble up and move the whole wall by the handle's
// coordinates too. Runs against the dev server with /api answered here.

const expect = baseExpect.configure({ timeout: 20_000 });

const ID = '66666666-6666-6666-6666-666666666666';
const SCALE = 20; // px per foot

const wall = (id: string, sx: number, sy: number, ex: number, ey: number) => ({
  id,
  start_x: sx,
  start_y: sy,
  end_x: ex,
  end_y: ey,
  thickness: 4,
  length_ft: Math.hypot(ex - sx, ey - sy) / SCALE,
});

// W1 and W2 meet in a corner at (100, 100); W3 stands alone; W4's top end is under a base cabinet.
const OVERLAY = {
  walls: [wall('W1', 100, 100, 340, 100), wall('W2', 100, 100, 100, 340), wall('W3', 500, 100, 500, 340), wall('W4', 700, 100, 700, 340)],
  cabinets: [
    {
      id: 'C1',
      x: 650,
      y: 80,
      width: 60,
      height: 40,
      rotation: 0,
      cab_type: 'base',
      preset_code: 'B30',
      label: 'B30',
      location: 'perimeter',
      width_in: 30,
      depth_in: 24,
      height_in: 34.5,
    },
  ],
  appliances: [],
  element_order: ['W1', 'W2', 'W3', 'W4', 'C1'],
};

const ESTIMATE = {
  id: ID,
  status: 'draft',
  kind: 'restoration',
  property_address: '1 Old Rd, Fairfax, VA 22030',
  tier: 'Standard',
  boxes: [
    {
      id: 'box-B30',
      estimate_id: ID,
      code: 'B30',
      cab_type: 'base',
      location: 'perimeter',
      width_inches: 30,
      height_inches: 34.5,
      is_specialty: false,
      specialty_type: null,
      has_glass_door: false,
      qty: 1,
      display_order: 0,
    },
  ],
  line_items: [],
  appliance_list: [],
  group_members: [],
  total: 0,
};

async function openSketch(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem('auth_token', 'test-token');
    localStorage.setItem('auth_user', JSON.stringify({ id: 'u1', username: 'admin', role: 'admin' }));
    // Edit and Sketch on tabs of their own, as these tests open the Sketch tab (wide screens default to side by side).
    localStorage.setItem('cabinet-estimate.view', 'tabs');
  });
  const sketch = { id: 'sketch-1', estimate_id: ID, canvas_width: 1200, canvas_height: 900, scale_pixels_per_foot: SCALE, overlay_data: OVERLAY };
  await page.route('**/api/**', (route) => {
    const path = new URL(route.request().url()).pathname.replace(/\/$/, '');
    const json = (body: unknown) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    if (path === '/api/auth/me') return json({ id: 'u1', username: 'admin', role: 'admin', is_active: true });
    if (path === '/api/cabinet-estimates') return json({ items: [], total: 0 });
    if (path.startsWith(`/api/cabinet-estimates/${ID}/sketch`)) return json(sketch);
    if (path === `/api/cabinet-estimates/${ID}`) return json(ESTIMATE);
    return json([]);
  });
  await page.goto(`/cabinet-estimates/${ID}`);
  await page.getByRole('tab', { name: 'Sketch' }).click({ timeout: 90_000 });
  await page.locator('.konvajs-content').first().waitFor();
}

/** A plan point (canvas px) on the page. */
const onScreen = (page: Page, x: number, y: number) =>
  page.evaluate(([x, y]) => {
    const stage = (window as any).Konva.stages.find((s: any) => s.container().isConnected);
    const box = stage.container().getBoundingClientRect();
    const p = stage.getLayers()[0].getAbsoluteTransform().point({ x, y });
    return { x: box.left + p.x, y: box.top + p.y };
  }, [x, y] as const);

/** Each wall as drawn: its two ends in plan px, rounded. */
const drawnWalls = (page: Page) =>
  page.evaluate(() => {
    const stage = (window as any).Konva.stages.find((s: any) => s.container().isConnected);
    const out: Record<string, number[]> = {};
    for (const id of ['W1', 'W2', 'W3', 'W4']) {
      const group = stage.findOne(`#${id}`);
      const [sx, sy, ex, ey] = group.findOne('Line').points();
      out[id] = [sx + group.x(), sy + group.y(), ex + group.x(), ey + group.y()].map((n: number) => Math.round(n));
    }
    return out;
  });

type Walls = Record<string, number[]>;

/** How far, in plan px, the walls as drawn are from `want` (the pointer lands to a pixel, not exactly). */
const offBy = async (page: Page, want: Walls) => {
  const got = await drawnWalls(page);
  return Math.max(...Object.keys(want).flatMap((id) => got[id].map((v, i) => Math.abs(v - want[id][i]))));
};

const START: Walls = { W1: [100, 100, 340, 100], W2: [100, 100, 100, 340], W3: [500, 100, 500, 340], W4: [700, 100, 700, 340] };

async function click(page: Page, x: number, y: number) {
  const p = await onScreen(page, x, y);
  await page.mouse.click(p.x, p.y);
}

async function drag(page: Page, from: [number, number], to: [number, number]) {
  const a = await onScreen(page, ...from);
  const b = await onScreen(page, ...to);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 10 });
  await page.mouse.up();
}

const undo = (page: Page) => page.keyboard.press('Control+z');

test.describe('fixing a wall on the cabinet sketch', () => {
  test.use({ viewport: { width: 1500, height: 1000 } });

  test('an end handle changes only that end, and one undo takes it back', async ({ page }) => {
    await openSketch(page);
    await expect.poll(() => offBy(page, START), { timeout: 90_000 }).toBeLessThan(2);

    await click(page, 500, 220); // select W3
    await drag(page, [500, 340], [500, 400]); // its bottom end 3 ft down
    await expect.poll(() => offBy(page, { ...START, W3: [500, 100, 500, 400] })).toBeLessThan(2);
    await undo(page);
    await expect.poll(() => offBy(page, START)).toBeLessThan(2);

    // A wall in a corner: its free end moves, the corner and the other wall stay.
    await click(page, 220, 100);
    await drag(page, [340, 100], [400, 100]);
    await expect.poll(() => offBy(page, { ...START, W1: [100, 100, 400, 100] })).toBeLessThan(2);
    await undo(page);
    await expect.poll(() => offBy(page, START)).toBeLessThan(2);
  });

  test('the corner handle of a selected wall can be grabbed, and moves both walls', async ({ page }) => {
    await openSketch(page);
    await expect.poll(() => offBy(page, START), { timeout: 90_000 }).toBeLessThan(2);

    await click(page, 220, 100); // select W1; W2 is drawn over its corner end
    await drag(page, [100, 100], [120, 120]);
    await expect.poll(() => offBy(page, { ...START, W1: [120, 120, 340, 100], W2: [120, 120, 100, 340] })).toBeLessThan(2);
  });

  test('an end handle under a cabinet can be grabbed', async ({ page }) => {
    await openSketch(page);
    await expect.poll(() => offBy(page, START), { timeout: 90_000 }).toBeLessThan(2);

    await click(page, 700, 220); // select W4
    await drag(page, [700, 100], [700, 80]);
    await expect.poll(() => offBy(page, { ...START, W4: [700, 80, 700, 340] })).toBeLessThan(2);
  });

  test('dragging a wall moves it, the wall joined to it following', async ({ page }) => {
    await openSketch(page);
    await expect.poll(() => offBy(page, START), { timeout: 90_000 }).toBeLessThan(2);

    await click(page, 500, 220);
    await drag(page, [500, 220], [540, 220]);
    await expect.poll(() => offBy(page, { ...START, W3: [540, 100, 540, 340] })).toBeLessThan(2);
    await undo(page);
    await expect.poll(() => offBy(page, START)).toBeLessThan(2);

    await click(page, 220, 100);
    await drag(page, [220, 100], [220, 140]); // W1 down 2 ft: W2's corner end comes along, W2 keeps its angle
    await expect.poll(() => offBy(page, { ...START, W1: [100, 140, 340, 140], W2: [100, 140, 100, 340] })).toBeLessThan(2);
  });
});
