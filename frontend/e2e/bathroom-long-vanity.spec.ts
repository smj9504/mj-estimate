import { test, expect as baseExpect, Page } from '@playwright/test';

// A long cabinet vanity with one sink and a knee space (a makeup area, open
// under the top): set on the sketch, drawn with its sink over the cabinet,
// sent to the estimate with its width and knee space, and typed there too.
// Runs against the dev server with /api answered here.

const expect = baseExpect.configure({ timeout: 20_000 });

const ID = '59595959-5959-5959-5959-595959595959';
const FT = 40;

const wall = (id: string, x0: number, y0: number, x1: number, y1: number) => ({
  id, start: { x: x0 * FT, y: y0 * FT }, end: { x: x1 * FT, y: y1 * FT }, thickness: 4, heightInches: 96,
});
// A 10' x 8' bathroom
const WALLS = [wall('n', 0, 0, 10, 0), wall('e', 10, 0, 10, 8), wall('s', 10, 8, 0, 8), wall('w', 0, 8, 0, 0)];
const SKETCH = {
  version: '1.0.0', walls: WALLS,
  rooms: [{
    id: 'bath', name: 'Bathroom', roomType: 'bathroom', heightInches: 96,
    boundary: WALLS.map((w) => w.start), wallIds: WALLS.map((w) => w.id),
    floorAreaSF: 80, netFloorAreaSF: 80, wallAreaSF: 288, perimeterLF: 36,
  }],
  fixtures: [],
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

test('a 96" vanity with one sink and a 36" knee space: on the plan, in 3D, and on the estimate', async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1400, height: 1100 });
  const calculated = await open(page);

  // Added from the plan's list, picked: 96" wide, one sink, 36" open at its right
  await page.locator('.bes-add-grid').getByRole('button', { name: /Vanity/ }).click();
  const width = panel(page).getByLabel('Width, inches');
  await expect(width).toBeVisible();
  await width.fill('96');
  await width.press('Tab');
  const knee = panel(page).getByLabel('Knee space, inches');
  await knee.fill('36');
  await knee.press('Tab');
  await expect(panel(page).getByText('the cabinet is 60" under the sink', { exact: false })).toBeVisible();
  await panel(page).getByText('Right', { exact: true }).click();
  await page.waitForTimeout(500);
  await page.screenshot({ path: test.info().outputPath('vanity-plan.png') });

  // On the estimate: its width and knee space, one sink
  await page.getByRole('button', { name: /Calculate/ }).first().click();
  await expect.poll(() => calculated.length).toBe(1);
  expect(calculated[0].vanity_spec.items[0]).toMatchObject({ sink_type: 'cabinet', width: 96, sinks: 1, knee_space_in: 36 });

  // In 3D: the cabinet under the sink, the knee space open
  await page.getByRole('tab', { name: /Sketch/ }).click();
  await page.getByText('3D', { exact: true }).click();
  await expect(page.locator('canvas').last()).toBeVisible();
  await page.waitForTimeout(3000);
  await page.locator('canvas').last().screenshot({ path: test.info().outputPath('vanity-3d.png') });

  // The vanity tab reads them back, any width
  await page.getByRole('tab', { name: /Vanity/ }).click();
  await expect(page.getByLabel('Vanity width, inches')).toHaveValue('96');
  await expect(page.getByLabel('Vanity knee space, inches')).toHaveValue('36');
});
