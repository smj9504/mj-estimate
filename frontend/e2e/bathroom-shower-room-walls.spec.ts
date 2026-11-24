import { test, expect as baseExpect, Page } from '@playwright/test';

// A shower room off an L-shaped bathroom, its east and south walls the
// bathroom's. The shower's glass door and panel stand on the south wall's
// line: that stretch is no wall (open in 3D, off the paint and the wall SF).
// The shower's tile and its niche are on the shower room's side of the east
// wall, not the bathroom's. Runs against the dev server with /api answered here.

const expect = baseExpect.configure({ timeout: 20_000 });

const ID = '58585858-5858-5858-5858-585858585858';
const FT = 40;

const wall = (id: string, x0: number, y0: number, x1: number, y1: number) => ({
  id, start: { x: x0 * FT, y: y0 * FT }, end: { x: x1 * FT, y: y1 * FT }, thickness: 4, heightInches: 96,
});
const at = (pts: [number, number][]) => pts.map(([x, y]) => ({ x: x * FT, y: y * FT }));
// The shower room 5' x 4' in the north-west corner; the bathroom the L round it
const WALLS = [
  wall('sn', 0, 0, 5, 0), wall('sw', 0, 4, 0, 0),
  wall('east', 5, 0, 5, 4), wall('south', 0, 4, 5, 4),
  wall('bn', 5, 0, 10, 0), wall('be', 10, 0, 10, 8), wall('bs', 10, 8, 0, 8), wall('bw', 0, 8, 0, 4),
];
const room = (id: string, name: string, roomType: string, boundary: [number, number][], wallIds: string[], extra = {}) => ({
  id, name, roomType, heightInches: 96, boundary: at(boundary), wallIds,
  floorAreaSF: 0, netFloorAreaSF: 0, wallAreaSF: 0, perimeterLF: 0, ...extra,
});
const SKETCH = {
  version: '1.0.0',
  walls: WALLS,
  rooms: [
    room('bath', 'Bathroom', 'bathroom', [[5, 0], [10, 0], [10, 8], [0, 8], [0, 4], [5, 4]],
      ['bn', 'be', 'bs', 'bw', 'south', 'east'], { floorAreaSF: 60, netFloorAreaSF: 60, perimeterLF: 36 }),
    room('shower-room', 'Shower', 'shower', [[0, 0], [5, 0], [5, 4], [0, 4]], ['sn', 'sw'],
      { parentRoomId: 'bath', floorAreaSF: 20, netFloorAreaSF: 20, perimeterLF: 18 }),
  ],
  fixtures: [
    // A 60" x 48" shower filling the room, its glass door and panel along the south wall
    { id: 'shower', type: 'shower', position: { x: 2.5 * FT, y: 2 * FT }, dimensions: { width: 60, height: 48 }, rotation: 0,
      roomId: 'shower-room', properties: { showerLayout: 'alcove', showerDoorType: 'frameless_swing', fixedPanelConfig: 'left', showerWallCount: 3 } },
    // A niche in the east wall, on the shower's side
    { id: 'niche', type: 'niche', position: { x: 5 * FT - (2 / 12) * FT, y: 2 * FT }, dimensions: { width: 12, height: 4 }, rotation: 90,
      roomId: 'shower-room', properties: { nicheType: 'tile', nicheHeight: 24, nicheBottom: 42 } },
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

test("a shower room's glass front is no wall, and its tile is on its own side of the bathroom's walls", async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1400, height: 1100 });
  const calculated = await open(page);
  await expect(page.locator('canvas').first()).toBeVisible();
  await page.waitForTimeout(1500);
  await page.screenshot({ path: test.info().outputPath('plan.png') });

  // The estimate: the south wall's 5' x 8' along the glass is neither wall nor paint
  await page.getByRole('button', { name: /Calculate/ }).first().click();
  await expect.poll(() => calculated.length).toBe(1);
  const sent = calculated[0];
  // The L's 36' round at 8' high, less the 5' of glass front
  expect(sent.wall_sf).toBeCloseTo(36 * 8 - 5 * 8, 1);
  // Painted: the bathroom's north 5', east 8', south 10' and west 4' (its east wall is behind the shower)
  expect(sent.walls_spec.paint_wall_sf ?? sent.paint_wall_sf).toBeCloseTo((5 + 8 + 10 + 4) * 8, 1);

  // In 3D: from the bathroom, the shower room open along its glass, painted outside
  await page.getByRole('tab', { name: /Sketch/ }).click();
  await page.getByText('3D', { exact: true }).click();
  await expect(page.locator('canvas').last()).toBeVisible();
  await page.waitForTimeout(3000);
  await page.screenshot({ path: test.info().outputPath('room-3d.png') });
});
