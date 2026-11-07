import { test, expect as baseExpect, Page } from '@playwright/test';

// On a wide screen a cabinet estimate shows the Edit form and the Sketch side
// by side: the sketch on the left at the window's height, the form scrolling
// on the right. Picking a cabinet on one side marks it on the other, shortcuts
// only reach the sketch while the pointer is on it, and the page's Save saves
// the sketch too. Runs against the dev server with /api answered here.

const expect = baseExpect.configure({ timeout: 20_000 });

const ID = '33333333-3333-3333-3333-333333333333';
const PATH = `/cabinet-estimates/${ID}`;

const box = (code: string, cabType: 'base' | 'wall', width: number, height: number, order: number) => ({
  id: `box-${code}`,
  code,
  cab_type: cabType,
  location: 'perimeter',
  width_inches: width,
  height_inches: height,
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
  boxes: [box('B30', 'base', 30, 34.5, 0), box('B33', 'base', 33, 34.5, 1), box('W3036', 'wall', 30, 36, 2)],
  line_items: [],
  appliance_list: [],
  group_members: [],
  total: 0,
};

interface Server {
  overlay: { cabinets: unknown[]; [key: string]: unknown };
  boxes: { code: string }[];
  overlaySaves: number;
}

async function start(page: Page): Promise<Server> {
  const server: Server = {
    overlay: { walls: [], cabinets: [], appliances: [], element_order: [] },
    boxes: ESTIMATE.boxes,
    overlaySaves: 0,
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
  });

  await page.route('**/api/**', async route => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace(/\/$/, '');
    const method = request.method();
    const json = (body: unknown) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });

    if (path === '/api/auth/me') return json({ id: 'u1', username: 'admin', role: 'admin', is_active: true });
    if (path === `/api/cabinet-estimates/${ID}/sketch`) return json(sketch());
    if (path === `/api/cabinet-estimates/${ID}/sketch/overlay`) {
      server.overlay = request.postDataJSON();
      server.overlaySaves += 1;
      return json(sketch());
    }
    if (path === `/api/cabinet-estimates/${ID}`) {
      if (method === 'PUT') {
        const { boxes } = request.postDataJSON();
        if (boxes) server.boxes = boxes;
      }
      return json({ ...ESTIMATE, boxes: server.boxes });
    }
    return json([]);
  });

  await page.goto(PATH);
  await page.locator('.konvajs-content').first().waitFor({ timeout: 90_000 });
  // Every box gets a shape on first opening, and that is saved.
  await expect.poll(() => server.overlay.cabinets.length).toBe(3);
  return server;
}

/** The cabinets on the canvas by their label, with where each is on screen. */
const drawn = (page: Page) =>
  page.evaluate(() => {
    const stage = (window as any).Konva.stages.find((s: any) => s.container().isConnected);
    const { left, top } = stage.container().getBoundingClientRect();
    return stage
      .find('Group')
      .filter((g: any) => g.draggable())
      .map((g: any) => {
        const r = g.getClientRect();
        return {
          label: g.findOne('Text')?.text() as string | undefined,
          screenX: left + r.x + r.width / 2,
          // The front half: an upper over a base takes clicks on the back half.
          screenY: top + r.y + r.height * 0.8,
        };
      });
  });

/** The one cabinet selected on the sketch, as its toolbar names it ("Pick another Base to replace B30"). */
const selectedOnSketch = (code: string) => (page: Page) =>
  page.getByText(new RegExp(`^Pick another \\w+ to replace ${code}$`));

const row = (page: Page, code: string) => page.locator(`tr[data-link-key*="|${code}|"]`);
const markedRows = (page: Page) =>
  page.locator('tr.ant-table-row-selected[data-link-key]').evaluateAll(rows =>
    rows.map(r => (r.getAttribute('data-link-key') ?? '').split('|')[1]).sort()
  );

test.describe('cabinet estimate side by side', () => {
  test.use({ viewport: { width: 1600, height: 900 } });

  test('the sketch sits beside the form at the window height, with no Sketch tab', async ({ page }) => {
    await start(page);
    await expect(page.getByRole('tab', { name: 'Sketch' })).toHaveCount(0);
    const canvas = (await page.locator('.konvajs-content').first().boundingBox())!;
    const form = (await page.locator('#cabinet-section-perimeter').boundingBox())!;
    expect(canvas.x + canvas.width).toBeLessThan(form.x);
    // Only the form scrolls: the page fits the window.
    const pageScroll = await page.evaluate(() => document.documentElement.scrollHeight - window.innerHeight);
    expect(pageScroll).toBeLessThanOrEqual(2);
    // The seldom-changed sections start folded, and their jump link opens them.
    await expect(page.locator('#cabinet-section-client .ant-card-body')).toBeHidden();
    await page.getByRole('button', { name: 'Client', exact: true }).click();
    await expect(page.locator('#cabinet-section-client .ant-card-body')).toBeVisible();
  });

  test('a cabinet picked on the sketch marks its row, and a row picks its cabinet', async ({ page }) => {
    await start(page);
    const b33 = (await drawn(page)).find(c => c.label === 'B33')!;
    await page.mouse.click(b33.screenX, b33.screenY);
    await expect.poll(() => markedRows(page)).toEqual(['B33']);

    // A cell with no control in it picks the row's cabinet on the sketch.
    await row(page, 'B30').locator('td').nth(3).click();
    await expect(selectedOnSketch('B30')(page)).toBeVisible();
    await expect.poll(() => markedRows(page)).toEqual(['B30']);
  });

  test('Delete reaches the sketch only while the pointer is on it', async ({ page }) => {
    const server = await start(page);
    await row(page, 'B30').locator('td').nth(3).click();
    await expect(selectedOnSketch('B30')(page)).toBeVisible();

    // Over the form: the key is the form's, the cabinet stays.
    await page.locator('#cabinet-section-specs').hover();
    await page.keyboard.press('Delete');
    await page.waitForTimeout(500);
    await expect(row(page, 'B30')).toHaveCount(1);

    // Over the sketch: it goes, from the sketch and the list.
    const canvas = (await page.locator('.konvajs-content').first().boundingBox())!;
    await page.mouse.move(canvas.x + 10, canvas.y + canvas.height - 10);
    await page.keyboard.press('Delete');
    await expect(row(page, 'B30')).toHaveCount(0);
    await expect.poll(() => server.boxes.map(b => b.code).sort()).toEqual(['B33', 'W3036']);
  });

  test("the page's Save saves the sketch at once", async ({ page }) => {
    const server = await start(page);
    await page.waitForTimeout(2500);
    const saves = server.overlaySaves;
    const b33 = (await drawn(page)).find(c => c.label === 'B33')!;
    await page.mouse.move(b33.screenX, b33.screenY);
    await page.mouse.down();
    await page.mouse.move(b33.screenX + 30, b33.screenY + 120, { steps: 6 });
    await page.mouse.up();
    // Before the sketch's own save a moment later.
    await page.getByRole('button', { name: /^save Save$/ }).click();
    await page.waitForTimeout(600);
    expect(server.overlaySaves).toBe(saves + 1);
  });

  test('Tabs puts Edit and Sketch back on tabs of their own, and is remembered', async ({ page }) => {
    await start(page);
    await page.getByText('Tabs', { exact: true }).click();
    await expect(page.getByRole('tab', { name: 'Sketch' })).toBeVisible();
    await expect(page.locator('.konvajs-content')).toBeHidden();
    await page.reload();
    await expect(page.getByRole('tab', { name: 'Sketch' })).toBeVisible({ timeout: 90_000 });
    await page.getByRole('tab', { name: 'Sketch' }).click();
    await expect(page.locator('.konvajs-content').first()).toBeVisible();
    await page.getByText('Side by side', { exact: true }).click();
    await expect(page.getByRole('tab', { name: 'Sketch' })).toHaveCount(0);
    await expect(page.locator('#cabinet-section-perimeter')).toBeVisible();
  });
});
