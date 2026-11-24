import { test, expect as baseExpect, Page } from '@playwright/test';

// A niche added on the bathroom sketch: it goes in the wall behind the tub,
// its kind and opening set in its panel, and it's a row of its own on the
// estimate (Wall niches), priced each. The 3D view shows it set in the wall.
// Runs against the dev server with /api answered here.

const expect = baseExpect.configure({ timeout: 20_000 });

const ID = '57575757-5757-5757-5757-575757575757';
const FT = 40;

const wall = (id: string, x0: number, y0: number, x1: number, y1: number) => ({
  id, start: { x: x0 * FT, y: y0 * FT }, end: { x: x1 * FT, y: y1 * FT }, thickness: 4, heightInches: 96,
});
// An 8' x 5' bathroom, a 5' tub along its north wall in the corner, a door in the south wall
const WALLS = [wall('n', 0, 0, 8, 0), wall('e', 8, 0, 8, 5), wall('s', 8, 5, 0, 5), wall('w', 0, 5, 0, 0)];
const SKETCH = {
  version: '1.0.0', walls: WALLS,
  rooms: [{
    id: 'bath', name: 'Bathroom', roomType: 'bathroom', heightInches: 96,
    boundary: WALLS.map((w) => w.start), wallIds: WALLS.map((w) => w.id),
    floorAreaSF: 40, netFloorAreaSF: 40, wallAreaSF: 208, perimeterLF: 26,
  }],
  fixtures: [
    { id: 'tub', type: 'bathtub', position: { x: 2.5 * FT, y: (16 / 12) * FT }, dimensions: { width: 60, height: 32 }, rotation: 0,
      roomId: 'bath', properties: { bathtubSubType: 'standard_alcove', hasSurround: true, surroundHeight: 60, surroundWallCount: 3 } },
    { id: 'door', type: 'door', position: { x: 6 * FT, y: 5 * FT - (15 / 12) * FT }, dimensions: { width: 30, height: 30 }, rotation: 0,
      wallId: 's', properties: {} },
  ],
  tileZones: [], damageZones: [], drywallRepairZones: [], insulationZones: [],
  settings: { pixelsPerFoot: FT, snapToGrid: true, gridSizeFt: 0.125, showGrid: true, showDimensions: true, showAreaLabels: true, showTileZones: true },
};

async function open(page: Page) {
  const calculated: any[] = [];
  await page.addInitScript(() => {
    localStorage.setItem('auth_token', 'test-token');
    localStorage.setItem('auth_user', JSON.stringify({ id: 'u1', username: 'admin', role: 'admin' }));
  });
  await page.route('**/api/**', route => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const json = (body: unknown) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    const estimate = {
      id: ID, kind: 'restore', status: 'draft', property_address: '12 Elm St', line_items: [], group_members: [],
      walls_spec: { wall_finish: 'paint' }, floor_spec: { material: 'porcelain' }, sketch_data: SKETCH,
    };
    if (path === `/api/bathroom-estimates/${ID}/calculate`) {
      calculated.push(request.postDataJSON());
      return json(estimate);
    }
    if (path === `/api/bathroom-estimates/${ID}`) return json(estimate);
    if (path === '/api/auth/me') return json({ id: 'u1', username: 'admin', role: 'admin', is_active: true });
    return json([]);
  });
  await page.goto(`/bathroom-estimates/${ID}`);
  await page.getByRole('tab', { name: /Sketch/ }).click();
  return calculated;
}

const panel = (page: Page) => page.locator('.bes-panel');

test('a niche added behind the tub: its kind and opening set, a row of its own on the estimate, set in the wall in 3D', async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1400, height: 1100 });
  const calculated = await open(page);

  // Added from the plan's list: in the wall behind the tub, picked
  await page.locator('.bes-add-grid').getByRole('button', { name: /Niche/ }).click();
  const type = panel(page).getByRole('combobox', { name: 'Niche type' });
  await expect(type).toBeVisible();
  await expect(panel(page).getByText('its top is 5′ 6″ up', { exact: false })).toBeVisible();

  // A foam insert, 30" high
  await type.click({ force: true });
  await page.locator('.ant-select-dropdown:visible .ant-select-item-option', { hasText: 'Tiled niche, foam insert' }).click();
  const height = panel(page).getByLabel('Niche height, inches');
  await height.fill('30');
  await height.press('Tab');
  await expect(panel(page).getByText(/its top is 6′/)).toBeVisible();
  await page.screenshot({ path: test.info().outputPath('niche-plan.png') });

  // On the estimate: one foam-insert niche, from the sketch
  await page.getByRole('button', { name: /Calculate/ }).first().click();
  await expect.poll(() => calculated.length).toBe(1);
  expect(calculated[0].accessories_spec.niches).toEqual([
    { type: 'tile_foam', count: 1, from_sketch: true, action: 'replace' },
  ]);

  // In 3D: set in the wall behind the tub
  await page.getByRole('tab', { name: /Sketch/ }).click();
  await page.getByText('3D', { exact: true }).click();
  await expect(page.locator('canvas').last()).toBeVisible();
  await page.waitForTimeout(3000);
  await page.screenshot({ path: test.info().outputPath('niche-3d.png') });

  // The estimate's Wall niches row says it's the sketch's
  await page.getByRole('tab', { name: 'Demo Scope' }).click();
  const kind = page.getByRole('combobox', { name: 'niche type' });
  await expect(kind).toBeDisabled();
  const row = page.locator('.ant-select').filter({ has: kind }).locator('..');
  await expect(row).toContainText('Tiled niche, foam insert');
  await expect(row.getByText('Sketch', { exact: true })).toBeVisible();
  // Built, never detached and reset: no New / D&R
  await expect(row.getByText('D&R')).toHaveCount(0);
});
