import { test, expect as baseExpect, Page } from '@playwright/test';

// Lights in different places: the can in the shower, the cans over the
// vanity and the pendant over the tub are rows (and lines) of their own on
// the estimate, each place found from the plan or typed on the light. Runs
// against the dev server with /api answered here.

const expect = baseExpect.configure({ timeout: 20_000 });

const ID = '62626262-6262-6262-6262-626262626262';
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
  // A 3' shower in the north-west corner, a 5' tub along the south wall, a 4' vanity on the north wall;
  // a can in the shower, two over the vanity, a pendant over the tub
  fixtures: [
    { id: 'shower', type: 'shower', position: { x: 1.5 * FT, y: 1.5 * FT }, dimensions: { width: 36, height: 36 }, rotation: 0, roomId: 'bath', properties: { showerLayout: 'alcove' } },
    { id: 'tub', type: 'bathtub', position: { x: 2.5 * FT, y: 8 * FT - (16 / 12) * FT }, dimensions: { width: 60, height: 32 }, rotation: 180, roomId: 'bath', properties: { bathtubSubType: 'standard_alcove' } },
    { id: 'vanity', type: 'vanity', position: { x: 6.5 * FT, y: (10.5 / 12) * FT }, dimensions: { width: 48, height: 21 }, rotation: 0, roomId: 'bath', properties: { vanitySubType: 'cabinet', sinkCount: 1 } },
    { id: 'can1', type: 'light', position: { x: 1.5 * FT, y: 1.5 * FT }, dimensions: { width: 6, height: 6 }, rotation: 0, roomId: 'bath', properties: { lightType: 'recessed' } },
    { id: 'can2', type: 'light', position: { x: 6 * FT, y: 1 * FT }, dimensions: { width: 6, height: 6 }, rotation: 0, roomId: 'bath', properties: { lightType: 'recessed' } },
    { id: 'can3', type: 'light', position: { x: 7 * FT, y: 1 * FT }, dimensions: { width: 6, height: 6 }, rotation: 0, roomId: 'bath', properties: { lightType: 'recessed' } },
    { id: 'pendant', type: 'light', position: { x: 2.5 * FT, y: 7 * FT }, dimensions: { width: 12, height: 12 }, rotation: 0, roomId: 'bath', properties: { lightType: 'pendant' } },
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

test('lights in different places are rows of their own, found from the plan or typed on the light', async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1400, height: 1100 });
  const calculated = await open(page);

  // The pendant over the tub, picked: found there, then named by hand
  await settled(page);
  const at = await onScreen(page, 2.5, 7);
  await page.mouse.click(at.x, at.y);
  await expect(panel(page).getByText('Over the tub, from the plan', { exact: false })).toBeVisible();
  const where = panel(page).getByRole('combobox', { name: 'Light location' });
  await where.click();
  await where.pressSequentially('Over the soaking tub');
  await expect(where).toHaveValue('Over the soaking tub');
  await page.keyboard.press('Tab');
  await expect(panel(page).getByText('Its own line on the estimate', { exact: false })).toBeVisible();
  await page.screenshot({ path: test.info().outputPath('lights-plan.png') });

  // On the estimate: a row a place
  await page.getByRole('button', { name: /Calculate/ }).first().click();
  await expect.poll(() => calculated.length).toBe(1);
  expect(calculated[0].electrical_spec.lights).toEqual([
    { type: 'pendant', count: 1, location: 'Over the soaking tub', from_sketch: true, action: 'replace' },
    { type: 'recessed', count: 1, location: 'In the shower', from_sketch: true, action: 'replace' },
    { type: 'recessed', count: 2, location: 'Over the vanity', from_sketch: true, action: 'replace' },
  ]);

  // The Demo Scope rows show each place, the sketch's
  await page.getByRole('tab', { name: 'Demo Scope' }).click();
  const places = page.getByRole('combobox', { name: 'light location' });
  await expect(places).toHaveCount(3);
  await expect(places.nth(2)).toHaveValue('Over the vanity');
  await expect(places.nth(2)).toBeDisabled();
  await places.nth(2).locator('xpath=ancestor::div[contains(@style,"flex-direction: column")][1]').screenshot({ path: test.info().outputPath('lights-rows.png') });
});
