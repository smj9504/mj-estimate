import { test, expect as baseExpect, Page } from '@playwright/test';

// Decorative tile marked on the sketch: border rows across a wall's tile and
// accent inserts in it, a border round the floor a set way in from the walls
// and its inserts. The estimate's decorative tile fields follow the sketch.
// Runs against the dev server with /api answered here.

const expect = baseExpect.configure({ timeout: 20_000 });

const ID = '34343434-3434-3434-3434-343434343434';
const FT = 40;

const wall = (id: string, x0: number, y0: number, x1: number, y1: number, extra: Record<string, unknown> = {}) => ({
  id, start: { x: x0 * FT, y: y0 * FT }, end: { x: x1 * FT, y: y1 * FT }, thickness: 4, heightInches: 96, ...extra,
});
// An 8' x 5' bathroom; its north wall tiled floor to ceiling with a border row at 4' and 4 inserts
const WALLS = [
  wall('n', 0, 0, 8, 0, { tileRegions: [{ id: 't', startIn: 0, endIn: 96, bottomIn: 0, topIn: 96, decoBordersAtIn: [48], decoInserts: 4 }] }),
  wall('e', 8, 0, 8, 5), wall('s', 8, 5, 0, 5), wall('w', 0, 5, 0, 0),
];
const ROOM = {
  id: 'bath', name: 'Bathroom', roomType: 'bathroom', heightInches: 96,
  boundary: WALLS.map((w) => w.start), wallIds: WALLS.map((w) => w.id),
  floorAreaSF: 40, netFloorAreaSF: 40, wallAreaSF: 208, perimeterLF: 26,
  // A floor border 6" in from the walls, 3 inserts
  floorBorderInsetIn: 6, floorDecoInserts: 3,
};
const SKETCH = {
  version: '1.0.0', walls: WALLS, rooms: [ROOM],
  // A ceiling light: nothing on the floor in the border's way
  fixtures: [{ id: 'light', type: 'light', position: { x: 4 * FT, y: 2.5 * FT }, dimensions: { width: 12, height: 12 }, rotation: 0, properties: { lightType: 'standard' } }],
  tileZones: [], damageZones: [], drywallRepairZones: [], insulationZones: [],
  settings: { pixelsPerFoot: FT, snapToGrid: true, gridSizeInches: 3 },
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
      walls_spec: { wall_finish: 'paint_and_tile' }, floor_spec: { material: 'porcelain' }, sketch_data: SKETCH,
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

/** A plan point (feet) on screen */
const onScreen = (page: Page, xFt: number, yFt: number) => page.evaluate(([x, y, ft]) => {
  const Konva = (window as any).Konva;
  const stage = Konva.stages.find((s: any) => s.container().isConnected && s.container().offsetWidth > 0);
  const box = stage.container().getBoundingClientRect();
  const scale = stage.scaleX();
  return { x: box.left + stage.x() + x * ft * scale, y: box.top + stage.y() + y * ft * scale };
}, [xFt, yFt, FT] as const);

const settled = async (page: Page) => {
  let last = '';
  await expect.poll(async () => {
    const now = JSON.stringify(await onScreen(page, 0, 0));
    const same = now === last;
    last = now;
    return same;
  }, { intervals: [300] }).toBe(true);
};

const panel = (page: Page) => page.locator('.bes-panel');

test('decorative tile marked on the sketch goes to the estimate, wall and floor', async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 1300 });
  const calculated = await open(page);
  await settled(page);
  await page.screenshot({ path: test.info().outputPath('plan.png') });

  await page.getByRole('button', { name: /Calculate/ }).first().click();
  await expect.poll(() => calculated.length).toBe(1);
  // The north wall's row: 8 LF; round the floor 6" in: 7' x 4' = 22 LF
  expect(calculated[0].walls_spec).toMatchObject({ deco_border_lf: 8, deco_inserts: 4 });
  expect(calculated[0].floor_spec).toMatchObject({ deco_border_lf: 22, deco_inserts: 3 });

  // A second row on the north wall, from its panel
  await page.getByRole('tab', { name: /Sketch/ }).click();
  await settled(page);
  const n = await onScreen(page, 6, 0);
  await page.mouse.click(n.x, n.y);
  await panel(page).getByText('To install', { exact: true }).click();
  await expect(panel(page).getByText(/Decorative: border/)).toContainText('8 LF');
  await panel(page).getByRole('button', { name: 'plus Row', exact: true }).click();
  await expect(panel(page).getByText(/Decorative: border/)).toContainText('16 LF');
  await expect(panel(page).getByText(/Decorative: border/)).toContainText('inserts 4');
  await page.screenshot({ path: test.info().outputPath('wall.png') });

  // The room's floor border, from its panel
  await panel(page).getByRole('button').first().click();
  const c = await onScreen(page, 6.5, 3.5);
  await page.mouse.click(c.x, c.y);
  await expect(panel(page).getByText('Floor decorative tile', { exact: true })).toBeVisible();
  await expect(panel(page).getByText(/22 LF round the floor/)).toBeVisible();
  await page.screenshot({ path: test.info().outputPath('room.png') });

  await panel(page).getByRole('button').first().click();
  await page.getByText('3D', { exact: true }).click();
  await expect(page.locator('canvas').last()).toBeVisible();
  await page.waitForTimeout(3000);
  await page.screenshot({ path: test.info().outputPath('deco-3d.png') });
});
