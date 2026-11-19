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
