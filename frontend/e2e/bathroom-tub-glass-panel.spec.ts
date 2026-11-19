import { test, expect as baseExpect, Page } from '@playwright/test';

// A tub's fixed glass panel (sized and priced on the Bathtub panel) is placed
// on the sketch: drawn on the tub's open side at the end it's fixed to,
// moved to the other end from the tub's inspector or by clicking the glass,
// and saved with the sketch; the 3D view stands it there.
// Runs against the dev server with /api answered here.

const expect = baseExpect.configure({ timeout: 20_000 });

const ID = '77777777-7777-7777-7777-777777777777';

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
  id: ID, kind: 'restore', estimate_number: 'BE-3', status: 'draft', property_address: '12 Elm St',
  state: 'MD', zip_code: '20850', length_ft: 8, width_ft: 5, height_ft: 8, replace_tub: true,
  bathtub_spec: { type: 'alcove', material: 'acrylic', glass_panel_action: 'replace', glass_panel_width_in: 30 },
  line_items: [], group_members: [], sketch_data: SKETCH,
};

async function open(page: Page) {
  const saved: any[] = [];
  await page.addInitScript(() => {
    localStorage.setItem('auth_token', 'test-token');
    localStorage.setItem('auth_user', JSON.stringify({ id: 'u1', username: 'admin', role: 'admin' }));
  });
  await page.route('**/api/**', route => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const json = (body: unknown) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    if (path === `/api/bathroom-estimates/${ID}` && request.method() === 'PUT') {
      saved.push(request.postDataJSON());
      return json(ESTIMATE);
    }
    if (path === `/api/bathroom-estimates/${ID}`) return json(ESTIMATE);
    if (path === '/api/auth/me') return json({ id: 'u1', username: 'admin', role: 'admin', is_active: true });
    return json([]);
  });
  await page.goto(`/bathroom-estimates/${ID}`);
  await page.getByRole('tab', { name: /Sketch/ }).click();
  return saved;
}

/** The glass on the plan, on screen */
const glassOnScreen = (page: Page) => page.evaluate(() => {
  const Konva = (window as any).Konva;
  const stage = Konva.stages.find((s: any) => s.findOne('.tub-glass-panel'));
  const node = stage.findOne('.tub-glass-panel');
  const r = node.getClientRect();
  const box = stage.container().getBoundingClientRect();
  return { x: box.left + r.x + r.width / 2, y: box.top + r.y + r.height / 2, width: r.width };
});

test('the glass panel is placed on the plan, saved with the sketch, and stood there in 3D', async ({ page }) => {
  const saved = await open(page);
  await expect.poll(async () => (await glassOnScreen(page).catch(() => null))?.width ?? 0).toBeGreaterThan(0);

  // Unset: at the faucet's end (the faucet is in the middle of the back wall: left)
  const before = await glassOnScreen(page);
  await page.mouse.click(before.x, before.y);
  const side = page.locator('.bes-panel').getByText('Glass panel', { exact: true });
  await expect(side).toBeVisible();
  await expect(page.locator('.bes-panel .ant-segmented-item-selected')).toHaveText('Left end');
  await page.screenshot({ path: test.info().outputPath('plan-left.png') });

  // Selected, a click on the glass moves it to the other end
  await page.mouse.click(before.x, before.y);
  await expect(page.locator('.bes-panel .ant-segmented-item-selected')).toHaveText('Right end');
  const after = await glassOnScreen(page);
  expect(after.x).toBeGreaterThan(before.x + 20);
  await page.screenshot({ path: test.info().outputPath('plan-right.png') });

  // And back from the inspector, then over again
  await page.locator('.bes-panel').getByText('Left end', { exact: true }).click();
  expect((await glassOnScreen(page)).x).toBeCloseTo(before.x, 0);
  await page.locator('.bes-panel').getByText('Right end', { exact: true }).click();

  await page.keyboard.press('Control+s');
  await expect.poll(() => saved.length).toBe(1);
  expect(saved[0].sketch_data.fixtures[0].properties.glassPanelSide).toBe('right');

  await page.keyboard.press('Escape');
  await page.getByText('3D', { exact: true }).click();
  await expect(page.locator('canvas').last()).toBeVisible();
  await page.waitForTimeout(3000);
  await page.screenshot({ path: test.info().outputPath('glass-right-3d.png') });
});
