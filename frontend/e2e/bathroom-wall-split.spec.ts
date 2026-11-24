import { test, expect as baseExpect, Page } from '@playwright/test';

// Splitting a wall on the bathroom sketch, as Xactimate's Break does: the
// Split tool (a click splits, a drag along the wall splits out a piece), the
// piece pushed out by its handle with a short wall at each step, one undo for
// the drag, the inspector's join, move and split in half. A tub standing
// across the split keeps its surround. Runs against the dev server with /api
// answered here.

const expect = baseExpect.configure({ timeout: 20_000 });

const ID = '56565656-5656-5656-5656-565656565656';
const FT = 40;

const wall = (id: string, x0: number, y0: number, x1: number, y1: number) => ({
  id, start: { x: x0 * FT, y: y0 * FT }, end: { x: x1 * FT, y: y1 * FT }, thickness: 4, heightInches: 96,
});
// An 8' x 5' bathroom, a 5' tub along its north wall in the corner, a door in the south wall
const WALLS = [wall('n', 0, 0, 8, 0), wall('e', 8, 0, 8, 5), wall('s', 8, 5, 0, 5), wall('w', 0, 5, 0, 0)];
const ROOM = {
  id: 'bath', name: 'Bathroom', roomType: 'bathroom', heightInches: 96,
  boundary: WALLS.map((w) => w.start), wallIds: WALLS.map((w) => w.id),
  floorAreaSF: 40, netFloorAreaSF: 40, wallAreaSF: 208, perimeterLF: 26,
};
const SKETCH = {
  version: '1.0.0', walls: WALLS, rooms: [ROOM],
  fixtures: [
    { id: 'tub', type: 'bathtub', position: { x: 2.5 * FT, y: (16 / 12) * FT }, dimensions: { width: 60, height: 32 }, rotation: 0,
      properties: { bathtubSubType: 'standard_alcove', hasSurround: true, surroundHeight: 60, surroundWallCount: 3 } },
    { id: 'door', type: 'door', position: { x: 6 * FT, y: 5 * FT - (15 / 12) * FT }, dimensions: { width: 30, height: 30 }, rotation: 0,
      wallId: 's', properties: {} },
  ],
  tileZones: [], damageZones: [], drywallRepairZones: [], insulationZones: [],
  settings: { pixelsPerFoot: FT, snapToGrid: true, gridSizeFt: 0.125, showGrid: true, showDimensions: true, showAreaLabels: true, showTileZones: true },
};

async function open(page: Page, sketch: unknown = SKETCH) {
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
      walls_spec: { wall_finish: 'paint' }, floor_spec: { material: 'porcelain' }, sketch_data: sketch,
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
  await settled(page);
  // Down a little, so a wall pushed out stays on the canvas
  const mid = await onScreen(page, 4, 2.5);
  await page.mouse.move(mid.x, mid.y);
  await page.mouse.wheel(0, -120);
  await settled(page);
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

async function settled(page: Page) {
  let last = '';
  await expect.poll(async () => {
    const now = JSON.stringify(await onScreen(page, 0, 0));
    const same = now === last;
    last = now;
    return same;
  }, { intervals: [300] }).toBe(true);
}

const panel = (page: Page) => page.locator('.bes-panel');
const tool = (page: Page, name: string) => page.getByRole('toolbar').getByRole('button', { name, exact: true });
const length = (page: Page) => panel(page).getByLabel('Length, inches');

async function calculate(page: Page, calculated: any[]) {
  const n = calculated.length;
  await page.getByRole('button', { name: /Calculate/ }).first().click();
  await expect.poll(() => calculated.length).toBe(n + 1);
  await page.getByRole('tab', { name: /Sketch/ }).click();
  await settled(page);
  return calculated[n];
}

/** Pick the wall at a plan point (feet); a wall a fixture stands against is picked just outside it */
async function pickWall(page: Page, xFt: number, yFt: number) {
  await tool(page, 'Select').click();
  const p = await onScreen(page, xFt, yFt);
  await page.mouse.click(p.x, p.y);
  await expect(length(page)).toBeVisible();
}

async function drag(page: Page, from: [number, number], to: [number, number]) {
  const a = await onScreen(page, ...from);
  const b = await onScreen(page, ...to);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move((a.x + b.x) / 2, (a.y + b.y) / 2, { steps: 6 });
  await page.mouse.move(b.x, b.y, { steps: 6 });
  await page.mouse.up();
}

test('a wall split, a piece pushed out, undone, joined back', async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1400, height: 1300 });
  const calculated = await open(page);
  const before = await calculate(page, calculated);

  // The Split tool: a click on the north wall splits it there, across the tub
  await tool(page, 'Split').click();
  const at = await onScreen(page, 3, 0);
  await page.mouse.move(at.x, at.y + 2);
  await page.mouse.click(at.x, at.y + 2);
  await pickWall(page, 1.5, -0.07);
  await expect(length(page)).toHaveValue('36');
  await pickWall(page, 6, -0.07);
  await expect(length(page)).toHaveValue('60');
  await page.screenshot({ path: test.info().outputPath('split.png') });

  // The tub across the split keeps its surround: nothing priced changes
  const split = await calculate(page, calculated);
  expect(split.paint_wall_sf).toBe(before.paint_wall_sf);
  expect(split.floor_sf).toBe(before.floor_sf);
  expect(split.wall_sf).toBe(before.wall_sf);

  // Dragged along the 5' piece from 4' to 6': that 2' piece split out and picked
  await tool(page, 'Split').click();
  await drag(page, [4, 0], [6, 0]);
  await expect(length(page)).toHaveValue('24');
  await expect(tool(page, 'Select')).toHaveAttribute('aria-pressed', 'true');

  // Its handle dragged 2' out: a bump-out, a 2' wall at each step
  await drag(page, [5, 0], [5, -2]);
  await page.screenshot({ path: test.info().outputPath('bumped-out.png') });
  expect((await calculate(page, calculated)).floor_sf).toBe(44);
  await pickWall(page, 4, -1);
  await expect(length(page)).toHaveValue('24');

  // One undo takes the whole drag back, one redo puts it back
  await page.keyboard.press('Control+z');
  expect((await calculate(page, calculated)).floor_sf).toBe(40);
  await page.keyboard.press('Control+y');
  expect((await calculate(page, calculated)).floor_sf).toBe(44);

  // The 3' piece joined with the 1' piece in line on its right: 4'
  await pickWall(page, 1.5, -0.07);
  await panel(page).getByRole('button', { name: 'With right' }).click();
  await expect(length(page)).toHaveValue('48');
  // Pushed in 6" from the inspector: the room loses 4' x 6"
  await panel(page).getByLabel('Move the wall by, inches').fill('6');
  await panel(page).getByRole('button', { name: 'In', exact: true }).click();
  expect((await calculate(page, calculated)).floor_sf).toBe(42);

  // Split in half from the inspector: the 2' piece at the east end, 1' each
  await pickWall(page, 7, -0.07);
  await panel(page).getByRole('button', { name: 'In half' }).click();
  await expect(length(page)).toHaveValue('12');
});

test('a room picked: a side dragged out by its handle grows the room, the walls at its corners stretching', async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1400, height: 1300 });
  const calculated = await open(page);

  // The room picked (clear of the tub and the door's swing), the east wall's handle dragged 1' out
  await tool(page, 'Select').click();
  const inside = await onScreen(page, 6.5, 1.5);
  await page.mouse.click(inside.x, inside.y);
  await expect(panel(page).getByRole('combobox', { name: 'Room type' })).toBeVisible();
  await drag(page, [8, 2.5], [9, 2.5]);
  await page.screenshot({ path: test.info().outputPath('room-side-out.png') });
  expect((await calculate(page, calculated)).floor_sf).toBe(45);
  // No step: the north wall at its corner is 9' now
  await pickWall(page, 6, -0.07);
  await expect(length(page)).toHaveValue('108');
});

test("a room's wall area is its perimeter by its height: an extra room's walls in wall_sf, a drywall repair repaints the plan's paint area", async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1400, height: 1300 });
  // A 4' x 5' hall off the bathroom's east wall, saved before the fix with
  // its wall area 12 times too small (18' x 96" / 144), and 4' of drywall
  // repair low on the bathroom's west wall
  const hallWalls = [wall('hn', 8, 0, 12, 0), wall('he', 12, 0, 12, 5), wall('hs', 12, 5, 8, 5)];
  const hall = {
    id: 'hall', name: 'Hall', roomType: 'other', heightInches: 96,
    boundary: [hallWalls[0].start, hallWalls[1].start, hallWalls[2].start, hallWalls[2].end], wallIds: ['hn', 'he', 'hs', 'e'],
    floorAreaSF: 20, netFloorAreaSF: 20, wallAreaSF: 12, perimeterLF: 18,
  };
  const repair = {
    id: 'dw', roomId: 'bath', surface: 'wall', boundary: [{ x: 0, y: 4.5 * FT }, { x: 0, y: 0.5 * FT }],
    areaSF: 16, repairHeightInches: 48, includeGluing: false, textureType: 'smooth', paintCoats: 2,
  };
  const calculated = await open(page, {
    ...SKETCH, walls: [...WALLS, ...hallWalls], rooms: [ROOM, hall], drywallRepairZones: [repair],
  });
  const sync = await calculate(page, calculated);

  // The bathroom's 26' of 8' walls less its 30" x 80" door, and the hall's 18' of 8' walls
  expect(sync.wall_sf).toBeCloseTo(26 * 8 - 2.5 * (80 / 12) + 18 * 8, 1);
  // The whole paintable wall repainted: the same area the plan paints, not nothing
  expect(sync.walls_spec.full_paint_wall_sf).toBeGreaterThan(100);
  expect(sync.walls_spec.full_paint_wall_sf).toBe(sync.paint_wall_sf);

  // The hall's panel: 144 SF of walls
  await tool(page, 'Select').click();
  const inside = await onScreen(page, 10, 2.5);
  await page.mouse.click(inside.x, inside.y);
  await expect(panel(page).getByText('144 SF', { exact: true })).toBeVisible();
});
