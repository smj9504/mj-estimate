import { test, expect as baseExpect, Page } from '@playwright/test';

// Deleting a room takes its walls with it: a bathroom with a nook built off
// its right wall, the bathroom deleted, leaves the nook with its three walls
// and the stretch of the bathroom's wall it stands on - and the bathroom
// doesn't come back as a room when the sketch opens again.
// Runs against the dev server with /api answered here.

const expect = baseExpect.configure({ timeout: 20_000 });

const ID = '99999999-9999-9999-9999-999999999998';
const FT = 40; // px to the foot

const wall = (id: string, x0: number, y0: number, x1: number, y1: number) => ({
  id, start: { x: x0 * FT, y: y0 * FT }, end: { x: x1 * FT, y: y1 * FT }, thickness: 4, heightInches: 96,
});
const sketch = (walls: any[], rooms: any[] = []) => ({
  version: '1.0.0', walls, rooms, fixtures: [], tileZones: [], damageZones: [], drywallRepairZones: [],
  insulationZones: [], settings: { pixelsPerFoot: FT, snapToGrid: true, gridSizeInches: 3 },
});
// The bathroom 8' x 5' drawn as a room, and a 3' x 3' nook's walls off its right wall, 1' to 4' down it
const BATH_WALLS = [wall('top', 0, 0, 8, 0), wall('right', 8, 0, 8, 5), wall('bottom', 8, 5, 0, 5), wall('left', 0, 5, 0, 0)];
const BATH_ROOM = {
  id: 'bath', name: 'Bathroom', roomType: 'bathroom', heightInches: 96,
  boundary: BATH_WALLS.map((w) => w.start), wallIds: BATH_WALLS.map((w) => w.id),
  floorAreaSF: 40, netFloorAreaSF: 40, wallAreaSF: 208, perimeterLF: 26,
};
const NOOK_WALLS = [wall('n1', 8, 1, 11, 1), wall('n2', 11, 1, 11, 4), wall('n3', 11, 4, 8, 4)];

async function open(page: Page, initial: any) {
  const state = { sketch: initial, saved: [] as any[] };
  await page.addInitScript(() => {
    localStorage.setItem('auth_token', 'test-token');
    localStorage.setItem('auth_user', JSON.stringify({ id: 'u1', username: 'admin', role: 'admin' }));
  });
  await page.route('**/api/**', route => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const json = (body: unknown) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    const estimate = () => ({
      id: ID, kind: 'restore', status: 'draft', property_address: '12 Elm St', line_items: [], group_members: [],
      sketch_data: state.sketch,
    });
    if (path === `/api/bathroom-estimates/${ID}` && request.method() === 'PUT') {
      const body = request.postDataJSON();
      state.saved.push(body);
      if (body.sketch_data) state.sketch = body.sketch_data;
      return json(estimate());
    }
    if (path === `/api/bathroom-estimates/${ID}`) return json(estimate());
    if (path === '/api/auth/me') return json({ id: 'u1', username: 'admin', role: 'admin', is_active: true });
    return json([]);
  });
  await page.goto(`/bathroom-estimates/${ID}`);
  await page.getByRole('tab', { name: /Sketch/ }).click();
  return state;
}

const rooms = (page: Page) => page.locator('.bes-section').filter({ has: page.getByRole('heading', { name: 'Rooms' }) }).locator('.bes-row');

test("a room deleted takes its walls, but for the stretch a nook still stands on", async ({ page }) => {
  const state = await open(page, sketch([...BATH_WALLS, ...NOOK_WALLS], [BATH_ROOM]));
  // The nook's walls close it off the bathroom's wall: two rooms
  await expect(rooms(page)).toHaveCount(2);
  await page.screenshot({ path: test.info().outputPath('before.png') });

  await rooms(page).filter({ hasText: 'Bathroom' }).click();
  await page.locator('.bes-inspector-head').getByRole('button', { name: /^Delete/ }).click();
  await expect(rooms(page)).toHaveCount(1);
  await expect(rooms(page).first()).not.toContainText('Bathroom');
  await page.screenshot({ path: test.info().outputPath('after.png') });

  await page.keyboard.press('Control+s');
  await expect.poll(() => state.saved.length).toBe(1);
  const saved = state.saved[0].sketch_data;
  // The nook's three walls, and the bathroom's right wall cut to where the nook meets it
  expect(saved.walls).toHaveLength(4);
  const kept = saved.walls.find((w: any) => !['n1', 'n2', 'n3'].includes(w.id));
  expect(kept.start).toEqual({ x: 8 * FT, y: 1 * FT });
  expect(kept.end).toEqual({ x: 8 * FT, y: 4 * FT });
  expect(saved.rooms).toHaveLength(1);
  expect(saved.rooms[0].wallIds).toHaveLength(4);
  expect(saved.rooms[0].wallIds).toContain(kept.id);

  // Opened again, the bathroom stays gone
  await page.reload();
  await page.getByRole('tab', { name: /Sketch/ }).click();
  await expect(rooms(page)).toHaveCount(1);
  await expect(rooms(page).first()).not.toContainText('Bathroom');
});

test('a room on its own deleted leaves no walls behind', async ({ page }) => {
  const state = await open(page, sketch(BATH_WALLS, [BATH_ROOM]));
  await expect(rooms(page)).toHaveCount(1);
  await rooms(page).first().click();
  await page.locator('.bes-inspector-head').getByRole('button', { name: /^Delete/ }).click();
  await expect(rooms(page)).toHaveCount(0);
  await page.keyboard.press('Control+s');
  await expect.poll(() => state.saved.length).toBe(1);
  expect(state.saved[0].sketch_data.walls).toEqual([]);
  expect(state.saved[0].sketch_data.rooms).toEqual([]);
});
