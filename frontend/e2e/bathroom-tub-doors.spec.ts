import { test, expect as baseExpect, Page } from '@playwright/test';

// A tub can have sliding glass doors across it instead of a curtain: picked
// on the Bathtub panel (D&R or R&R, framed by grade or frameless by size),
// they take the curtain rod off and go to the calculator with the tub.
// Runs against the dev server with /api answered here.

const expect = baseExpect.configure({ timeout: 20_000 });

const ID = '55555555-5555-5555-5555-555555555555';

// 40 px to the foot: an 8 ft x 5 ft bath, a 60" x 32" alcove tub along the north wall
const wall = (id: string, x0: number, y0: number, x1: number, y1: number) => ({
  id, start: { x: x0, y: y0 }, end: { x: x1, y: y1 }, thickness: 6, heightInches: 96,
});
const SKETCH = {
  version: '1.0.0',
  walls: [wall('north', 0, 0, 320, 0), wall('east', 320, 0, 320, 200), wall('south', 320, 200, 0, 200), wall('west', 0, 200, 0, 0)],
  rooms: [{
    id: 'r', name: 'Bath', roomType: 'bathroom',
    boundary: [{ x: 0, y: 0 }, { x: 320, y: 0 }, { x: 320, y: 200 }, { x: 0, y: 200 }],
    wallIds: ['north', 'east', 'south', 'west'], heightInches: 96, floorAreaSF: 40, netFloorAreaSF: 40,
    wallAreaSF: 0, perimeterLF: 26,
  }],
  fixtures: [{
    id: 'tub', type: 'bathtub', position: { x: 100, y: 160 / 3 }, dimensions: { width: 60, height: 32 },
    rotation: 0, roomId: 'r',
    properties: { bathtubSubType: 'standard_alcove', hasSurround: true, surroundHeight: 60 },
  }],
  tileZones: [], damageZones: [], drywallRepairZones: [], insulationZones: [],
  settings: { pixelsPerFoot: 40 },
};

const ESTIMATE = {
  id: ID, kind: 'restore', estimate_number: 'BE-1', status: 'draft', property_address: '12 Elm St',
  state: 'MD', zip_code: '20850', length_ft: 8, width_ft: 5, height_ft: 8,
  replace_tub: true,
  bathtub_spec: { type: 'alcove', material: 'acrylic', curtain_rod: true },
  shower_spec: {}, vanity_spec: {}, toilet_spec: {}, floor_spec: {}, walls_spec: {},
  line_items: [], group_members: [], sketch_data: SKETCH,
};

/** Opens the estimate with /api answered; returns the calculate requests */
async function open(page: Page) {
  const calculated: any[] = [];

  await page.addInitScript(() => {
    localStorage.setItem('auth_token', 'test-token');
    localStorage.setItem('auth_user', JSON.stringify({ id: 'u1', username: 'admin', role: 'admin' }));
  });

  await page.route('**/api/**', route => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const json = (body: unknown, status = 200) => route.fulfill({
      status, contentType: 'application/json', body: JSON.stringify(body),
    });

    if (path === `/api/bathroom-estimates/${ID}/calculate`) {
      calculated.push(request.postDataJSON());
      return json(ESTIMATE);
    }
    if (path === `/api/bathroom-estimates/${ID}`) return json(ESTIMATE);
    if (path === '/api/bathroom-estimates/pricing-info') {
      return json({ bathtub_types: ['alcove', 'drop_in', 'freestanding'], bathtub_materials: ['acrylic'] });
    }
    if (path === '/api/auth/me') return json({ id: 'u1', username: 'admin', role: 'admin', is_active: true });
    return json([]);
  });

  await page.goto(`/bathroom-estimates/${ID}`);
  return calculated;
}

const bathtubPanel = (page: Page) => page.locator('.ant-collapse-item')
  .filter({ has: page.locator('.ant-collapse-header', { hasText: /^Bathtub$/ }) });

test('tub sliding doors take the curtain rod off and go to the calculator', async ({ page }) => {
  const calculated = await open(page);
  await page.getByRole('tab', { name: 'Shower & Tub' }).click();

  const tub = bathtubPanel(page);
  const curtainRod = tub.getByRole('checkbox', { name: 'Curtain Rod' });
  await expect(curtainRod).toBeChecked();
  const doorsRow = tub.locator('.ant-row:not(.ant-form-item-row)').filter({ has: page.getByText('Sliding Doors', { exact: true }) });
  await expect(doorsRow.getByText('Frame', { exact: true })).toHaveCount(0);

  // New doors: the curtain rod comes off, a framed set asks its grade
  await doorsRow.getByText('R&R', { exact: true }).click();
  await expect(curtainRod).not.toBeChecked();
  await expect(doorsRow.getByText('Grade', { exact: true })).toBeVisible();
  await expect(doorsRow.locator('.ant-select-selection-item')).toHaveText('Chrome frame, obscure glass');
  await doorsRow.locator('.ant-select').click();
  await page.locator('.ant-select-dropdown').getByText('Bronze or brass frame', { exact: true }).click();
  await page.screenshot({ path: test.info().outputPath('framed.png'), fullPage: false });

  // Frameless: priced by size, no grade
  await doorsRow.getByText('Frameless', { exact: true }).click();
  await expect(doorsRow.getByText('Grade', { exact: true })).toHaveCount(0);
  await doorsRow.getByRole('spinbutton').nth(1).fill('62');
  await page.screenshot({ path: test.info().outputPath('frameless.png'), fullPage: false });

  await page.getByRole('button', { name: /Calculate/ }).first().click();
  await expect.poll(() => calculated.length).toBe(1);
  expect(calculated[0].bathtub_spec).toMatchObject({
    glass_door_action: 'replace', glass_door_frameless: true, glass_door_grade: 'high',
    glass_door_height_in: 62, curtain_rod: false,
  });
});

test('the 3D view hangs the doors across the tub', async ({ page }) => {
  await open(page);
  await page.getByRole('tab', { name: 'Shower & Tub' }).click();
  const doorsRow = bathtubPanel(page).locator('.ant-row:not(.ant-form-item-row)')
    .filter({ has: page.getByText('Sliding Doors', { exact: true }) });
  await doorsRow.getByText('D&R', { exact: true }).click();

  await page.getByRole('tab', { name: /Sketch/ }).click();
  await page.getByText('3D', { exact: true }).click();
  await expect(page.locator('canvas').last()).toBeVisible();
  await page.waitForTimeout(3000);
  await page.screenshot({ path: test.info().outputPath('doors-3d.png'), fullPage: false });
});
