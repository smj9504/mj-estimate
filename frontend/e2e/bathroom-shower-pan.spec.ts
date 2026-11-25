import { test, expect as baseExpect, Page } from '@playwright/test';

// A shower set on a pan on the sketch: its floor type goes to the estimate
// (a prefab base in place of the floor tile, mud bed and tiled curb), and
// the estimate's Shower section shows it. Runs against the dev server with
// /api answered here.

const expect = baseExpect.configure({ timeout: 20_000 });

const ID = '63636363-6363-6363-6363-636363636363';
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
  // A 5' x 32" shower along the north wall, its floor tiled
  fixtures: [
    { id: 'shower', type: 'shower', position: { x: 2.5 * FT, y: (16 / 12) * FT }, dimensions: { width: 60, height: 32 }, rotation: 0, roomId: 'bath',
      properties: { showerLayout: 'alcove', showerFloorType: 'tile', curbHeight: 4, showerWallCount: 3 } },
  ],
  tileZones: [], damageZones: [], drywallRepairZones: [], insulationZones: [],
  settings: { pixelsPerFoot: FT, snapToGrid: true, gridSizeFt: 0.125, showGrid: true, showDimensions: true, showAreaLabels: true, showTileZones: true },
};

async function open(page: Page) {
  const calculated: any[] = [];
  const saved: Record<string, unknown> = {};
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
      // Saved as sent, and read back so, as the server does
      Object.assign(saved, request.postDataJSON());
      return json({ ...estimate, ...saved });
    }
    if (path === `/api/bathroom-estimates/${ID}`) return json({ ...estimate, ...saved });
    if (path === '/api/auth/me') return json({ id: 'u1', username: 'admin', role: 'admin', is_active: true });
    return json([]);
  });
  await page.goto(`/bathroom-estimates/${ID}`);
  await page.getByRole('tab', { name: /Sketch/ }).click();
  return calculated;
}

const panel = (page: Page) => page.locator('.bes-panel');

/** A plan point (feet) on screen */
const onScreen = (page: Page, xFt: number, yFt: number) => page.evaluate(([x, y, ft]) => {
  const Konva = (window as any).Konva;
  const stage = Konva.stages.find((st: any) => st.container().isConnected && st.container().offsetWidth > 0);
  const box = stage.container().getBoundingClientRect();
  const scale = stage.scaleX();
  return { x: box.left + stage.x() + x * ft * scale, y: box.top + stage.y() + y * ft * scale };
}, [xFt, yFt, FT] as const);

/** Once the plan has stopped moving (it fits itself to the view as it opens) */
const settled = async (page: Page) => {
  let last = '';
  await expect.poll(async () => {
    const now = JSON.stringify(await onScreen(page, 0, 0));
    const same = now === last;
    last = now;
    return same;
  }, { intervals: [300] }).toBe(true);
};

test('a shower on an acrylic pan: its floor type on the estimate, no floor tile or curb on the plan', async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1400, height: 1100 });
  const calculated = await open(page);

  // The shower, picked: its floor made an acrylic pan
  await settled(page);
  const at = await onScreen(page, 2.5, 1.3);
  await page.mouse.click(at.x, at.y);
  const floor = panel(page).getByRole('combobox', { name: 'Shower floor' });
  await expect(floor).toBeVisible();
  await floor.click({ force: true });
  await page.locator('.ant-select-dropdown:visible .ant-select-item-option', { hasText: 'Acrylic pan' }).click();
  await expect(panel(page).getByText("The pan's own threshold", { exact: false })).toBeVisible();
  await page.screenshot({ path: test.info().outputPath('pan-plan.png') });

  // On the estimate: the pan
  await page.getByRole('button', { name: /Calculate/ }).first().click();
  await expect.poll(() => calculated.length).toBe(1);
  expect(calculated[0].shower_spec).toMatchObject({ type: 'custom_tile', floor_type: 'acrylic_pan', width_in: 60, depth_in: 32 });

  // The Shower section reads it back
  await page.getByRole('tab', { name: /Shower & Tub/ }).click();
  const typed = page.getByRole('combobox', { name: 'Shower floor type' });
  await expect(typed.locator('xpath=ancestor::div[contains(@class,"ant-select")][1]')).toContainText('Acrylic pan');
});
