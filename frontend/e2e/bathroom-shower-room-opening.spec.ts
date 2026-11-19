import { test, expect as baseExpect, Page } from '@playwright/test';

// A shower in its own room, off the bathroom: the walls round it make it a
// room (named Shower), an opening cut in the wall between (no door slab, its
// width, height and place set) is where its glass door hangs, and the
// estimate gets the opening for the shower's door and its front wall's tile.
// Runs against the dev server with /api answered here.

const expect = baseExpect.configure({ timeout: 20_000 });

const ID = '12121212-1212-1212-1212-121212121212';
const FT = 40;

const wall = (id: string, x0: number, y0: number, x1: number, y1: number) => ({
  id, start: { x: x0 * FT, y: y0 * FT }, end: { x: x1 * FT, y: y1 * FT }, thickness: 4, heightInches: 96,
});
// The bathroom 5' x 5', the shower room 3' x 3' below it, off the bathroom's south wall
const BATH_WALLS = [wall('n', 0, 0, 5, 0), wall('e', 5, 0, 5, 5), wall('s', 5, 5, 0, 5), wall('w', 0, 5, 0, 0)];
const SHOWER_WALLS = [wall('sw', 0, 5, 0, 8), wall('sb', 0, 8, 3, 8), wall('se', 3, 8, 3, 5)];
const BATH = {
  id: 'bath', name: 'Bathroom', roomType: 'bathroom', heightInches: 96,
  boundary: BATH_WALLS.map((w) => w.start), wallIds: BATH_WALLS.map((w) => w.id),
  floorAreaSF: 25, netFloorAreaSF: 25, wallAreaSF: 160, perimeterLF: 20,
};
// A 36" tiled shower filling it, its front (turned round) on the bathroom's wall
const SHOWER = {
  id: 'shower', type: 'shower', position: { x: 1.5 * FT, y: 6.5 * FT }, dimensions: { width: 36, height: 36 },
  rotation: 180, properties: { showerLayout: 'alcove', showerWallCount: 3, showerTileHeight: 84, showerDoorType: 'swing', showerFloorType: 'tile' },
};
const SKETCH = {
  version: '1.0.0', walls: [...BATH_WALLS, ...SHOWER_WALLS], rooms: [BATH], fixtures: [SHOWER],
  tileZones: [], damageZones: [], drywallRepairZones: [], insulationZones: [],
  settings: { pixelsPerFoot: FT, snapToGrid: true, gridSizeInches: 3 },
};

async function open(page: Page) {
  const sent: { saved: any[]; calculated: any[] } = { saved: [], calculated: [] };
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
      replace_shower: true, shower_spec: { type: 'custom_tile' }, sketch_data: SKETCH,
    };
    if (path === `/api/bathroom-estimates/${ID}/calculate`) {
      sent.calculated.push(request.postDataJSON());
      return json(estimate);
    }
    if (path === `/api/bathroom-estimates/${ID}` && request.method() === 'PUT') {
      sent.saved.push(request.postDataJSON());
      return json(estimate);
    }
    if (path === `/api/bathroom-estimates/${ID}`) return json(estimate);
    if (path === '/api/auth/me') return json({ id: 'u1', username: 'admin', role: 'admin', is_active: true });
    return json([]);
  });
  await page.goto(`/bathroom-estimates/${ID}`);
  await page.getByRole('tab', { name: /Sketch/ }).click();
  return sent;
}

/** A plan point (feet) on screen */
const onScreen = (page: Page, xFt: number, yFt: number) => page.evaluate(([x, y, ft]) => {
  const Konva = (window as any).Konva;
  const stage = Konva.stages.find((s: any) => s.container().isConnected && s.container().offsetWidth > 0);
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

const panel = (page: Page) => page.locator('.bes-panel');
const back = (page: Page) => panel(page).getByRole('button').first().click();
const setNum = async (page: Page, name: string, value: number) => {
  const box = panel(page).getByRole('spinbutton', { name });
  await box.fill(String(value));
  await box.press('Enter');
};

test('an opening cut in the wall between the bathroom and its shower room hangs the shower door', async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 1300 });
  const sent = await open(page);
  // The walls round the shower are a room: the Shower
  const rooms = panel(page).locator('.bes-section').filter({ has: page.getByRole('heading', { name: 'Rooms' }) }).locator('.bes-row');
  await expect(rooms).toHaveCount(2);
  await expect(rooms.nth(1)).toContainText('Shower');

  // The wall between them, past the shower: + Opening, then its size and place
  await settled(page);
  const w = await onScreen(page, 4.2, 5);
  await page.mouse.click(w.x, w.y);
  await expect(panel(page).getByText('Openings', { exact: true })).toBeVisible();
  await panel(page).getByRole('button', { name: 'Opening' }).click();
  await expect(panel(page).getByText('Opening', { exact: true }).first()).toBeVisible();
  await setNum(page, 'Opening width, inches', 28);
  await setNum(page, 'Opening height, inches', 84);
  await setNum(page, "Distance from the wall's end, inches", 4);
  await expect(panel(page).getByRole('switch', { name: 'Door slab' })).not.toBeChecked();
  await page.screenshot({ path: test.info().outputPath('opening.png') });

  // The shower reads it as its room's opening
  await back(page);
  const s = await onScreen(page, 1.5, 6.5);
  await page.mouse.click(s.x, s.y);
  await expect(panel(page).getByText('28" opening', { exact: true })).toBeVisible();
  await expect(panel(page).getByRole('combobox', { name: 'Fixed glass panel' })).toHaveCount(0);
  await page.screenshot({ path: test.info().outputPath('shower-room.png') });

  await page.keyboard.press('Control+s');
  await expect.poll(() => sent.saved.length).toBe(1);
  const opening = sent.saved[0].sketch_data.fixtures.find((f: any) => f.type === 'door');
  expect(opening).toMatchObject({ wallId: 's', dimensions: { width: 28 }, properties: { noSlab: true, openingHeightIn: 84 } });

  await page.getByRole('button', { name: /Calculate/ }).first().click();
  await expect.poll(() => sent.calculated.length).toBe(1);
  expect(sent.calculated[0].shower_spec).toMatchObject({
    front_opening_in: 28, front_opening_height_in: 84, door_width_in: 28, fixed_panel_config: 'none',
  });

  await page.getByRole('tab', { name: /Sketch/ }).click();
  await back(page);
  await page.screenshot({ path: test.info().outputPath('plan.png') });
  await page.getByText('3D', { exact: true }).click();
  await expect(page.locator('canvas').last()).toBeVisible();
  await page.getByRole('button', { name: /Reset view/ }).click();
  await page.waitForTimeout(3000);
  await page.screenshot({ path: test.info().outputPath('shower-room-3d.png') });
});

test('an opening cuts both rooms\' walls where they lie on each other', async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 1300 });
  // The room off the bathroom drawn with its own wall along the bathroom's (4' of the bathroom's 5')
  const roomWalls = [wall('rt', 4, 5, 0, 5), wall('rw', 0, 5, 0, 7.5), wall('rb', 0, 7.5, 4, 7.5), wall('re', 4, 7.5, 4, 5)];
  const opening = {
    id: 'opening', type: 'door', wallId: 's', position: { x: 2 * FT, y: 5 * FT - 0.25 * FT }, dimensions: { width: 30, height: 6 },
    rotation: 0, properties: { noSlab: true, openingHeightIn: 80 },
  };
  SKETCH.walls = [...BATH_WALLS, ...roomWalls];
  SKETCH.fixtures = [opening] as any;
  await open(page);
  await settled(page);
  await page.screenshot({ path: test.info().outputPath('overlap-plan.png') });

  // Whichever of the two walls is clicked, the opening is in it
  // Past the opening, where both walls run
  const w = await onScreen(page, 3.7, 5);
  await page.mouse.click(w.x, w.y);
  await expect(panel(page).getByText('Openings', { exact: true })).toBeVisible();
  await expect(panel(page).locator('.bes-row').filter({ hasText: 'Opening' })).toHaveCount(1);
  await back(page);

  await page.getByText('3D', { exact: true }).click();
  await expect(page.locator('canvas').last()).toBeVisible();
  await page.getByRole('button', { name: /Eye level/ }).click();
  await page.waitForTimeout(3000);
  await page.screenshot({ path: test.info().outputPath('overlap-3d.png') });
});

test("a shower room's walls tiled floor to ceiling show their tile in 3D", async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 1300 });
  const tiled = { tileRegions: [{ id: 't', startIn: 0, endIn: 999, bottomIn: 0, topIn: 96 }] };
  // The shower room's own walls, its top along the bathroom's, all tiled; the shower filed under the bathroom
  const roomWalls = [wall('rt', 3, 5, 0, 5), wall('rw', 0, 5, 0, 8), wall('rb', 0, 8, 3, 8), wall('re', 3, 8, 3, 5)]
    .map((w) => ({ ...w, ...tiled }));
  SKETCH.walls = [...BATH_WALLS, ...roomWalls];
  SKETCH.fixtures = [
    { ...SHOWER, roomId: 'bath' },
    { id: 'opening', type: 'door', wallId: 's', position: { x: 1.5 * FT, y: 4.75 * FT }, dimensions: { width: 28, height: 6 }, rotation: 0, properties: { noSlab: true, openingHeightIn: 80 } },
  ] as any;
  await open(page);
  await settled(page);
  await page.getByText('3D', { exact: true }).click();
  await expect(page.locator('canvas').last()).toBeVisible();
  await page.waitForTimeout(3000);
  await page.screenshot({ path: test.info().outputPath('tiled-shower-room-3d.png') });
});

test('drywall repair drawn along a wall leaves out its door and opening', async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 1300 });
  // The bathroom's west wall (5') with a 30" door, its south wall (5') with a 30" opening; drywall along both, 8' high
  SKETCH.walls = [...BATH_WALLS];
  SKETCH.fixtures = [
    { id: 'door', type: 'door', wallId: 'w', position: { x: 0 - 30 / 12 * FT / 2, y: 2.5 * FT }, dimensions: { width: 30, height: 30 }, rotation: 90, properties: {} },
    { id: 'opening', type: 'door', wallId: 's', position: { x: 2.5 * FT, y: 4.75 * FT }, dimensions: { width: 30, height: 6 }, rotation: 0, properties: { noSlab: true } },
  ] as any;
  (SKETCH as any).drywallRepairZones = [
    { id: 'dw1', surface: 'wall', boundary: [{ x: 0, y: 0 }, { x: 0, y: 5 * FT }], areaSF: 40, repairHeightInches: 96, includeGluing: true, textureType: 'smooth', paintCoats: 2, drywallMaterialCostPerSF: 0.6, laborCostPerSF: 2 },
    { id: 'dw2', surface: 'wall', boundary: [{ x: 0, y: 5 * FT }, { x: 5 * FT, y: 5 * FT }], areaSF: 40, repairHeightInches: 96, includeGluing: true, textureType: 'smooth', paintCoats: 2, drywallMaterialCostPerSF: 0.6, laborCostPerSF: 2 },
  ];
  await open(page);
  await settled(page);
  // 5' x 8' = 40 SF each, less a 30" x 80" (16.7 SF) door or opening: 23.3 SF
  const labels = await page.evaluate(() => {
    const Konva = (window as any).Konva;
    const stage = Konva.stages.find((s: any) => s.container().isConnected && s.container().offsetWidth > 0);
    return stage.find('Text').map((t: any) => t.text()).filter((t: string) => t.startsWith('Drywall'));
  });
  expect(labels.sort()).toEqual(['Drywall\n23.33 SF', 'Drywall\n23.33 SF']);
  await page.screenshot({ path: test.info().outputPath('drywall.png') });
});

test("the sketch's doors and windows give the estimate their trim, a shower room's opening left uncased", async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 1300 });
  SKETCH.walls = [...BATH_WALLS, ...SHOWER_WALLS];
  SKETCH.fixtures = [
    SHOWER,
    // The shower room's opening: tiled round, no casing
    { id: 'opening', type: 'door', wallId: 's', position: { x: 1.5 * FT, y: 4.75 * FT }, dimensions: { width: 28, height: 6 }, rotation: 0, properties: { noSlab: true } },
    // The bathroom's door (30" x 80") and a window
    { id: 'door', type: 'door', wallId: 'e', position: { x: 5 * FT + 1.25 * FT, y: 2.5 * FT }, dimensions: { width: 30, height: 30 }, rotation: 270, properties: {} },
    { id: 'window', type: 'window', wallId: 'n', position: { x: 2.5 * FT, y: 0 }, dimensions: { width: 36, height: 6 }, rotation: 0, properties: {} },
  ] as any;
  (SKETCH as any).drywallRepairZones = [];
  const sent = await open(page);
  await page.getByRole('button', { name: /Calculate/ }).first().click();
  await expect.poll(() => sent.calculated.length).toBe(1);
  expect(sent.calculated[0].walls_spec).toMatchObject({ door_trim_count: 1, door_trim_lf: 16.6, window_trim_count: 1 });

  await page.getByRole('tab', { name: 'Floor & Walls' }).click();
  await expect(page.getByText('Install & paint', { exact: true })).toBeVisible();
  await page.screenshot({ path: test.info().outputPath('door-trim.png') });
});
