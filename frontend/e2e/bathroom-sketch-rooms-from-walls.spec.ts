import { test, expect as baseExpect, Page } from '@playwright/test';

// Every area the walls close becomes a room: walls saved closed with no room
// get one when the sketch opens, and a wall drawn to close a nook off the
// bathroom's wall (ending partway along it) makes the nook a room.
// Runs against the dev server with /api answered here.

const expect = baseExpect.configure({ timeout: 20_000 });

const ID = '99999999-9999-9999-9999-999999999999';
const FT = 40; // px to the foot

let n = 0;
const wall = (x0: number, y0: number, x1: number, y1: number, id = `w${++n}`) => ({
  id, start: { x: x0 * FT, y: y0 * FT }, end: { x: x1 * FT, y: y1 * FT }, thickness: 4, heightInches: 96,
});
const sketch = (walls: any[], rooms: any[] = []) => ({
  version: '1.0.0', walls, rooms, fixtures: [], tileZones: [], damageZones: [], drywallRepairZones: [],
  insulationZones: [], settings: { pixelsPerFoot: FT, snapToGrid: true, gridSizeInches: 3 },
});
// The second drawing: an L of walls, 7' across and 6' down, no room
const L_WALLS = [wall(0, 0, 7, 0), wall(7, 0, 7, 3.5), wall(7, 3.5, 4.75, 3.5), wall(4.75, 3.5, 4.75, 6), wall(4.75, 6, 0, 6), wall(0, 6, 0, 0)];
// The first: the bathroom 4'9" x 6' drawn as a room, and two of a nook's three walls off its right wall
const BATH_WALLS = [wall(0, 0, 4.75, 0, 'top'), wall(4.75, 0, 4.75, 6, 'right'), wall(4.75, 6, 0, 6, 'bottom'), wall(0, 6, 0, 0, 'left')];
const BATH_ROOM = {
  id: 'bath', name: 'Bathroom', roomType: 'bathroom', heightInches: 96,
  boundary: BATH_WALLS.map((w) => w.start), wallIds: BATH_WALLS.map((w) => w.id),
  floorAreaSF: 28.5, netFloorAreaSF: 28.5, wallAreaSF: 165.33, perimeterLF: 21.5,
};
const NOOK_TWO = [wall(4.75, 0, 7, 0), wall(7, 0, 7, 3.5)];

async function open(page: Page, sketchData: any) {
  const saved: any[] = [];
  await page.addInitScript(() => {
    localStorage.setItem('auth_token', 'test-token');
    localStorage.setItem('auth_user', JSON.stringify({ id: 'u1', username: 'admin', role: 'admin' }));
  });
  await page.route('**/api/**', route => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const json = (body: unknown) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    const estimate = { id: ID, kind: 'restore', status: 'draft', property_address: '12 Elm St', line_items: [], group_members: [], sketch_data: sketchData };
    if (path === `/api/bathroom-estimates/${ID}/calculate`) {
      saved.push({ calculated: request.postDataJSON() });
      return json(estimate);
    }
    if (path === `/api/bathroom-estimates/${ID}` && request.method() === 'PUT') {
      saved.push(request.postDataJSON());
      return json(estimate);
    }
    if (path === `/api/bathroom-estimates/${ID}`) return json(estimate);
    if (path === '/api/auth/me') return json({ id: 'u1', username: 'admin', role: 'admin', is_active: true });
    return json([]);
  });
  await page.goto(`/bathroom-estimates/${ID}`);
  await page.getByRole('tab', { name: /Sketch/ }).click();
  return saved;
}

const rooms = (page: Page) => page.locator('.bes-section').filter({ has: page.getByRole('heading', { name: 'Rooms' }) }).locator('.bes-row');

/** A plan point (feet) on screen */
const onScreen = (page: Page, xFt: number, yFt: number) => page.evaluate(([x, y, ft]) => {
  const Konva = (window as any).Konva;
  const stage = Konva.stages.find((s: any) => s.container().isConnected && s.container().offsetWidth > 0);
  const box = stage.container().getBoundingClientRect();
  const scale = stage.scaleX();
  return { x: box.left + stage.x() + x * ft * scale, y: box.top + stage.y() + y * ft * scale };
}, [xFt, yFt, FT] as const);

test('walls saved closed without a room get one when the sketch opens', async ({ page }) => {
  const saved = await open(page, sketch(L_WALLS));
  await expect(rooms(page)).toHaveCount(1);
  await expect(rooms(page).first()).toContainText('Bathroom');
  await expect(rooms(page).first()).toContainText('36.4');
  await page.screenshot({ path: test.info().outputPath('l-room.png') });

  // It's a change to the sketch: saved with it
  await page.keyboard.press('Control+s');
  await expect.poll(() => saved.length).toBe(1);
  const room = saved[0].sketch_data.rooms[0];
  expect(room).toMatchObject({ name: 'Bathroom', roomType: 'bathroom' });
  expect(room.wallIds).toHaveLength(6);

  // Priced by the L's own floor, not the 7' x 6' box around it
  await page.getByRole('button', { name: /Calculate/ }).first().click();
  await expect.poll(() => saved.length).toBe(2);
  expect(saved[1].calculated.floor_sf).toBe(36.4);
});

test('a wall closing a nook off the bathroom wall makes the nook a room', async ({ page }) => {
  await open(page, sketch([...BATH_WALLS, ...NOOK_TWO], [BATH_ROOM]));
  await expect(rooms(page)).toHaveCount(1);

  // The nook's last wall, from its far corner back to the bathroom's right wall, partway down it
  await page.getByRole('button', { name: /Wall/ }).first().click();
  const a = await onScreen(page, 7, 3.5);
  const b = await onScreen(page, 4.75, 3.5);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move((a.x + b.x) / 2, b.y, { steps: 5 });
  await page.mouse.move(b.x, b.y, { steps: 5 });
  await page.mouse.up();

  // The new wall is selected: back to the room list
  await page.locator('.bes-panel').getByRole('button').first().click();
  await expect(rooms(page)).toHaveCount(2);
  await expect(rooms(page).nth(1)).toContainText('Room');
  await expect(rooms(page).nth(1)).toContainText('7.9');
  await page.screenshot({ path: test.info().outputPath('nook-room.png') });
});
