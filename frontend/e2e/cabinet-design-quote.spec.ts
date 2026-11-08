import { test, expect as baseExpect, Page } from '@playwright/test';
import * as fs from 'fs';

// The design quote's export: the drawings are made in the browser, from what is
// saved, and sent with the request, so this looks at what is sent. Runs against
// the dev server with /api answered here; the PDF itself is tested in the backend.

const expect = baseExpect.configure({ timeout: 30_000 });

const ID = '55555555-5555-5555-5555-555555555555';
const SCALE = 20;
const px = (inches: number) => (inches / 12) * SCALE;

interface Placed {
  code: string;
  cab_type: 'base' | 'wall' | 'tall';
  width: number;
  height: number;
  depth: number;
  x: number;
  y: number;
  rotation?: number;
  location?: 'perimeter' | 'island';
}

// An L along the north and east walls with an island, in the plan's px.
const KITCHEN: Placed[] = [
  { code: 'OC3084', cab_type: 'tall', width: 30, height: 84, depth: 24, x: 0, y: 0 },
  { code: 'B24', cab_type: 'base', width: 24, height: 34.5, depth: 24, x: 50, y: 0 },
  { code: 'SB36', cab_type: 'base', width: 36, height: 34.5, depth: 24, x: 90, y: 0 },
  { code: 'DB24', cab_type: 'base', width: 24, height: 34.5, depth: 24, x: 150, y: 0 },
  { code: 'RB30S', cab_type: 'base', width: 30, height: 34.5, depth: 24, x: 190, y: 0 },
  { code: 'B36', cab_type: 'base', width: 36, height: 34.5, depth: 24, x: 240, y: 0 },
  { code: 'W3030', cab_type: 'wall', width: 30, height: 30, depth: 12, x: 50, y: 0 },
  { code: 'W3630', cab_type: 'wall', width: 36, height: 30, depth: 12, x: 100, y: 0 },
  { code: 'W3630', cab_type: 'wall', width: 36, height: 30, depth: 12, x: 240, y: 0 },
  { code: 'B30', cab_type: 'base', width: 30, height: 34.5, depth: 24, x: 320, y: 40, rotation: 90 },
  { code: 'B36', cab_type: 'base', width: 36, height: 34.5, depth: 24, x: 320, y: 90, rotation: 90 },
  { code: 'W3030', cab_type: 'wall', width: 30, height: 30, depth: 12, x: 320, y: 40, rotation: 90 },
  { code: 'B36', cab_type: 'base', width: 36, height: 34.5, depth: 24, x: 100, y: 150, location: 'island' },
  { code: 'B30', cab_type: 'base', width: 30, height: 34.5, depth: 24, x: 160, y: 150, location: 'island' },
];

const WALLS = [
  { id: 'w1', start_x: 0, start_y: 0, end_x: 320, end_y: 0, thickness: 4, color: '#333333', length_ft: 16 },
  { id: 'w2', start_x: 320, start_y: 0, end_x: 320, end_y: 220, thickness: 4, color: '#333333', length_ft: 11 },
];

const SKETCH = {
  id: 'sketch-1',
  estimate_id: ID,
  canvas_width: 1200,
  canvas_height: 800,
  scale_pixels_per_foot: SCALE,
  overlay_data: {
    walls: WALLS,
    appliances: [],
    element_order: [],
    cabinets: KITCHEN.map((c, i) => ({
      id: `c${i}`,
      preset_code: c.code,
      cab_type: c.cab_type,
      x: c.x,
      y: c.y,
      width: px(c.width),
      height: px(c.depth),
      rotation: c.rotation ?? 0,
      label: c.code,
      location: c.location ?? 'perimeter',
      width_in: c.width,
      depth_in: c.depth,
      height_in: c.height,
    })),
  },
};

const ESTIMATE = {
  id: ID,
  status: 'calculated',
  kind: 'restore',
  property_address: '1 Old Rd, Fairfax, VA 22030',
  tier: 'Stock',
  door_style: 'Shaker',
  sink_type: 'double',
  include_crown_molding: true,
  include_appliance_rr: true,
  appliance_list: [{ type: 'range_gas_slide', qty: 1 }],
  boxes: KITCHEN.map((c, i) => ({
    id: `box-${i}`,
    estimate_id: ID,
    code: c.code,
    cab_type: c.cab_type,
    location: c.location ?? 'perimeter',
    width_inches: c.width,
    height_inches: c.height,
    is_specialty: false,
    specialty_type: null,
    has_glass_door: false,
    door_pattern: null,
    qty: 1,
    display_order: i,
  })),
  line_items: [],
  group_members: [],
  total: 12345,
};

interface Drawings {
  plan?: string;
  elevations?: { label: string; image: string }[];
  views?: { label: string; image: string }[];
}
type Sent = { show_signature: boolean; drawings?: Drawings };

const isPng = (base64?: string) => !!base64 && Buffer.from(base64, 'base64').subarray(0, 4).toString('hex') === '89504e47';
const isJpeg = (base64?: string) => !!base64 && Buffer.from(base64, 'base64').subarray(0, 3).toString('hex') === 'ffd8ff';
/** An empty canvas this size packs down to far less than a drawing. */
const DRAWN_PNG_SIZE = 30_000;

async function start(page: Page, { sketch = SKETCH as unknown, estimate = ESTIMATE as unknown, path = `/cabinet-estimates/${ID}` } = {}) {
  const sent: Sent[] = [];
  await page.addInitScript(() => {
    localStorage.setItem('auth_token', 'test-token');
    localStorage.setItem('auth_user', JSON.stringify({ id: 'u1', username: 'admin', role: 'admin' }));
    // Edit and Sketch on tabs of their own, as these tests open the Sketch tab (wide screens default to side by side).
    localStorage.setItem('cabinet-estimate.view', 'tabs');
  });
  await page.route('**/api/**', (route) => {
    const request = route.request();
    const url = new URL(request.url()).pathname.replace(/\/$/, '');
    const json = (body: unknown) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });

    if (url === '/api/auth/me') return json({ id: 'u1', username: 'admin', role: 'admin', is_active: true });
    if (url === `/api/cabinet-estimates/${ID}/export/design-quote-pdf`) {
      sent.push(request.postDataJSON());
      return route.fulfill({
        status: 200,
        contentType: 'application/pdf',
        headers: { 'Content-Disposition': 'attachment; filename="kitchen_cabinet_quote_1_Old_Rd.pdf"' },
        body: '%PDF-1.4 test',
      });
    }
    if (url === `/api/cabinet-estimates/${ID}/sketch`) return json(sketch);
    if (url === `/api/cabinet-estimates/${ID}`) return json(estimate);
    if (url === '/api/cabinet-estimates') {
      return json({ items: [estimate], total: 1, page: 1, page_size: 20, estimates: [estimate] });
    }
    return json([]);
  });
  await page.goto(path, { timeout: 180_000 });
  return sent;
}

async function openModal(page: Page) {
  await page.getByRole('button', { name: /^Export/ }).hover({ timeout: 120_000 });
  await page.getByRole('menuitem', { name: /Design quote/ }).click();
  await expect(page.getByRole('dialog', { name: 'Design quote' })).toBeVisible();
}

const dialog = (page: Page) => page.getByRole('dialog', { name: 'Design quote' });

async function exportIt(page: Page, sent: Sent[]) {
  const download = page.waitForEvent('download', { timeout: 150_000 });
  await dialog(page).getByRole('button', { name: 'Export PDF' }).click();
  expect((await download).suggestedFilename()).toBe('kitchen_cabinet_quote_1_Old_Rd.pdf');
  await expect(dialog(page)).toBeHidden();
  await expect.poll(() => sent.length).toBeGreaterThan(0);
  return sent[sent.length - 1];
}

test.describe('the design quote', () => {
  test.use({ viewport: { width: 1600, height: 1000 } });
  test.setTimeout(420_000);

  test('sends the floor plan, an elevation per run and the 3D views', async ({ page }, testInfo) => {
    const sent = await start(page);
    await openModal(page);
    await dialog(page).getByRole('checkbox', { name: /Front elevations/ }).check();
    await dialog(page).screenshot({ path: testInfo.outputPath('modal.png') });
    const body = await exportIt(page, sent);

    expect(body.show_signature).toBe(true);
    const { plan, elevations, views } = body.drawings!;
    expect(isPng(plan)).toBe(true);
    expect(Buffer.from(plan!, 'base64').length).toBeGreaterThan(DRAWN_PNG_SIZE);
    expect(elevations!.map((e) => e.label)).toEqual(['North wall', 'East wall', 'Island']);
    for (const e of elevations!) {
      expect(isPng(e.image)).toBe(true);
      expect(Buffer.from(e.image, 'base64').length).toBeGreaterThan(DRAWN_PNG_SIZE);
    }
    expect(views!.map((v) => v.label)).toEqual(['At eye level', 'Overview']);
    expect(isJpeg(views![0].image)).toBe(true);
    expect(isJpeg(views![1].image)).toBe(true);
    fs.writeFileSync(testInfo.outputPath('drawings.json'), JSON.stringify(body.drawings));
  });

  test('takes out what is unticked, and leaves the elevations out unless ticked', async ({ page }) => {
    const sent = await start(page);
    await openModal(page);
    await expect(dialog(page).getByRole('checkbox', { name: /Front elevations/ })).not.toBeChecked();
    await dialog(page).getByRole('checkbox', { name: /3D views/ }).uncheck();
    await dialog(page).getByRole('checkbox', { name: /Signature block/ }).uncheck();
    const onlyPlan = await exportIt(page, sent);
    expect(onlyPlan.show_signature).toBe(false);
    expect(isPng(onlyPlan.drawings!.plan)).toBe(true);
    expect(onlyPlan.drawings!.elevations).toBeUndefined();
    expect(onlyPlan.drawings!.views).toBeUndefined();

    await openModal(page);
    await dialog(page).getByRole('checkbox', { name: /Floor plan/ }).uncheck();
    await dialog(page).getByRole('checkbox', { name: /3D views/ }).uncheck();
    const none = await exportIt(page, sent);
    expect(none.show_signature).toBe(true);
    expect(none.drawings).toBeUndefined();
  });

  test('offers the outlined look for the 3D views', async ({ page }) => {
    const sent = await start(page);
    await openModal(page);
    await dialog(page).getByRole('checkbox', { name: /Floor plan/ }).uncheck();
    await dialog(page).getByRole('radio', { name: /Outlined drawing/ }).check();
    const body = await exportIt(page, sent);
    expect(body.drawings!.plan).toBeUndefined();
    expect(body.drawings!.views).toHaveLength(2);
  });

  test('says so when nothing is drawn yet, and still exports', async ({ page }) => {
    const empty = { ...SKETCH, overlay_data: { walls: [], cabinets: [], appliances: [], element_order: [] } };
    const sent = await start(page, { sketch: empty });
    await openModal(page);
    await expect(dialog(page).getByText(/Nothing is drawn for this estimate yet/)).toBeVisible();
    await expect(dialog(page).getByRole('checkbox', { name: /Floor plan/ })).toBeDisabled();
    await expect(dialog(page).getByRole('checkbox', { name: /Floor plan/ })).not.toBeChecked();
    await expect(dialog(page).getByRole('checkbox', { name: /Front elevations/ })).toBeDisabled();
    await expect(dialog(page).getByRole('checkbox', { name: /3D views/ })).toBeDisabled();
    const body = await exportIt(page, sent);
    expect(body.drawings).toBeUndefined();
  });

  test('says which drawings a browser without WebGL could not make', async ({ page }) => {
    await page.addInitScript(() => {
      const real = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function getContext(this: HTMLCanvasElement, kind: string, ...rest: unknown[]) {
        return kind.startsWith('webgl') ? null : (real as any).call(this, kind, ...rest);
      } as typeof real;
    });
    const sent = await start(page);
    await openModal(page);
    const body = await exportIt(page, sent);
    expect(isPng(body.drawings!.plan)).toBe(true);
    expect(body.drawings!.views).toEqual([]);
    await expect(page.getByText(/The 3D views could not be drawn/)).toBeVisible();
  });

  test('draws an option with its products', async ({ page }) => {
    const option = {
      ...ESTIMATE,
      kind: 'option',
      option_label: 'Quartz',
      selections: {
        cabinets: { title: 'Slab Euro Base', look: { door_style: 'slab', color: '#2f4858' } },
        countertop: { title: 'Calacatta Quartz', look: { material: 'marble', color: '#efefe9' } },
      },
    };
    const sent = await start(page, { estimate: option });
    await openModal(page);
    const body = await exportIt(page, sent);
    expect(body.drawings!.views).toHaveLength(2);
  });

  test('leaves the Sketch tab drawing its 3D view as before', async ({ page }, testInfo) => {
    // The live view shares its lights, looks and camera spots with the pictures.
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await start(page);
    await page.getByRole('tab', { name: 'Sketch' }).click({ timeout: 120_000 });
    await page.getByText('3D', { exact: true }).click();
    const eyeLevel = page.getByRole('button', { name: /Eye level/ });
    await eyeLevel.click({ timeout: 60_000 });
    await page.getByText('Realistic', { exact: true }).click();
    const raster = page.locator('canvas').first();
    await expect(raster).toBeVisible();
    await page.waitForTimeout(1500);
    await page.screenshot({ path: testInfo.outputPath('sketch-3d.png') });
    await page.getByRole('button', { name: /Reset view/ }).click();
    await page.waitForTimeout(1000);
    await page.screenshot({ path: testInfo.outputPath('sketch-3d-reset.png') });
    expect(errors).toEqual([]);
  });

  test('is on the list too, while a click on the PDF button stays the itemized quote', async ({ page }) => {
    const sent = await start(page, { path: '/cabinet-estimates' });
    await page.locator('button[title="Export PDF"]').first().hover({ timeout: 120_000 });
    await page.getByRole('menuitem', { name: /Design quote/ }).click();
    await expect(dialog(page)).toBeVisible();
    await dialog(page).getByRole('checkbox', { name: /Floor plan/ }).uncheck();
    await dialog(page).getByRole('checkbox', { name: /3D views/ }).uncheck();
    const body = await exportIt(page, sent);
    expect(body.drawings).toBeUndefined();

    const itemized = page.waitForRequest((r) => r.url().endsWith(`/api/cabinet-estimates/${ID}/export/pdf`));
    await page.locator('button[title="Export PDF"]').first().click();
    await itemized;
  });
});
