import { test, expect as baseExpect, Page } from '@playwright/test';

// A door made a pair: two leaves meeting in the middle, drawn so on the plan
// and in 3D, and counted on the estimate as a double door (its trim and jamb
// painted at Xactimate's large rate). Runs against the dev server with /api
// answered here.

const expect = baseExpect.configure({ timeout: 20_000 });

const ID = '61616161-6161-6161-6161-616161616161';
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
  // A 30" door in the south wall, its box's bottom edge on the wall
  fixtures: [
    { id: 'door', type: 'door', position: { x: 5 * FT, y: 8 * FT - (15 / 12) * FT }, dimensions: { width: 30, height: 30 }, rotation: 0,
      wallId: 's', roomId: 'bath', properties: {} },
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

test('a door made a double door: two leaves on the plan and in 3D, a double door on the estimate', async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1400, height: 1100 });
  const calculated = await open(page);

  // The door in the south wall, picked: made a pair, 60" wide
  await settled(page);
  const d = await onScreen(page, 5, 7.6);
  await page.mouse.click(d.x, d.y);
  const pair = panel(page).getByRole('switch', { name: 'Double door' });
  await expect(pair).toBeVisible();
  await pair.click();
  await expect(panel(page).getByLabel('Opening width, inches')).toHaveValue('60');
  await expect(panel(page).getByText('A pair meeting in the middle', { exact: false })).toBeVisible();
  await page.waitForTimeout(500);
  await page.screenshot({ path: test.info().outputPath('door-plan.png') });

  // On the estimate: one door, a double one
  await page.getByRole('button', { name: /Calculate/ }).first().click();
  await expect.poll(() => calculated.length).toBe(1);
  expect(calculated[0].walls_spec).toMatchObject({ door_trim_count: 1, door_trim_double_count: 1 });

  // In 3D: a pair of leaves
  await page.getByRole('tab', { name: /Sketch/ }).click();
  await page.getByText('3D', { exact: true }).click();
  await expect(page.locator('canvas').last()).toBeVisible();
  await page.waitForTimeout(3000);
  await page.locator('canvas').last().screenshot({ path: test.info().outputPath('door-3d.png') });

  // The walls tab reads it back
  await page.getByRole('tab', { name: /Floor & Walls/ }).click();
  await expect(page.getByLabel('Double doors')).toHaveValue('1');
});
