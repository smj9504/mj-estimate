/**
 * The flooring sketch: rooms drawn wall to wall and to the inch, the way the
 * estimate measures them. The API is stubbed (fixtures/flooring-sketch-mock),
 * and what the editor saves is checked in feet.
 */

import { expect, test, type Page } from '@playwright/test';
import {
  ESTIMATE_ID, mockFlooringApi, pagePoint, polygonArea, type FlooringApi, type SavedSketch,
} from './fixtures/flooring-sketch-mock';

const rect = (x: number, y: number, w: number, h: number) => [
  { x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h },
];

function sketchWith(rooms: { id: string; name: string; points: { x: number; y: number }[] }[]): SavedSketch {
  return {
    version: 1,
    units: 'ft',
    levels: [{
      id: 'main', name: 'Main Level',
      rooms: rooms.map((r) => ({ ...r, height_ft: 8 })),
      openings: [], cabinet_runs: [], fixtures: [],
    }],
  };
}

async function open(page: Page, initial: SavedSketch | null = null): Promise<FlooringApi> {
  const api = await mockFlooringApi(page, initial);
  await page.goto(`/flooring-estimates/${ESTIMATE_ID}?tab=sketch`);
  await expect(page.getByTestId('flooring-sketch-canvas')).toBeVisible();
  return api;
}

const savedRooms = (api: FlooringApi) => api.last()?.levels[0].rooms ?? [];

/** Opened, the view fits the one room drawn: zoom out to make room beside it */
async function zoomOut(page: Page, times = 4) {
  for (let i = 0; i < times; i++) await page.getByRole('button', { name: 'Zoom out' }).click();
}

test('a room typed by size shows its area and is saved', async ({ page }) => {
  const api = await open(page);
  await page.getByLabel('New room name').fill('Living Room');
  await page.getByLabel('New room length').fill('15');
  await page.getByLabel('New room length').press('Enter');
  await page.getByLabel('New room width').fill(`14' 2"`);
  await page.getByLabel('New room width').press('Enter');
  await page.getByTestId('add-sized-room').click();

  const inspector = page.getByTestId('flooring-sketch-inspector');
  await expect(inspector.getByText('212.50 SF').first()).toBeVisible();
  await expect.poll(() => savedRooms(api).length).toBe(1);
  expect(savedRooms(api)[0].name).toBe('Living Room');
  expect(polygonArea(savedRooms(api)[0].points)).toBeCloseTo(212.5, 1);
  await expect(page.getByTestId('sketch-save-status')).toHaveText('Saved');
});

test.describe('on the canvas', () => {
  test.skip(({ isMobile }) => isMobile, 'Mouse gestures; the typed flows cover phones');

  test('a wall length typed on the canvas resizes the room', async ({ page }) => {
    const api = await open(page, sketchWith([{ id: 'r1', name: 'Bedroom', points: rect(0, 0, 12, 10) }]));
    const canvas = page.getByTestId('flooring-sketch-canvas');
    // The top wall's length sits just inside it
    const label = await pagePoint(canvas, { x: 6, y: 0 });
    await page.mouse.dblclick(label.x, label.y + 11);
    const input = page.getByTestId('edge-length-input');
    await expect(input).toBeVisible();
    await input.fill('15');
    await input.press('Enter');

    await expect.poll(() => polygonArea(savedRooms(api)[0]?.points ?? [])).toBeCloseTo(150, 3);
    await expect(page.getByTestId('room-inspector').getByText('150.00 SF')).toBeVisible();
  });

  test('a room dragged out with the Room tool lands on the grid', async ({ page }) => {
    const api = await open(page, sketchWith([{ id: 'r1', name: 'Bedroom', points: rect(0, 0, 12, 10) }]));
    const canvas = page.getByTestId('flooring-sketch-canvas');
    await zoomOut(page);
    await page.getByTestId('tool-rect').click();
    const from = await pagePoint(canvas, { x: 14, y: 0 });
    const to = await pagePoint(canvas, { x: 24, y: 8 });
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2, { steps: 4 });
    await page.mouse.move(to.x, to.y, { steps: 4 });
    await page.mouse.up();

    await expect.poll(() => savedRooms(api).length).toBe(2);
    expect(polygonArea(savedRooms(api)[1].points)).toBeCloseTo(80, 3);
    // Back to Select, with the new room selected
    await expect(page.getByTestId('tool-select')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('room-inspector')).toBeVisible();
  });

  test('a door clicked into a shared wall joins the two rooms', async ({ page }) => {
    const api = await open(page, sketchWith([
      { id: 'a', name: 'Living Room', points: rect(0, 0, 12, 10) },
      { id: 'b', name: 'Kitchen', points: rect(12.375, 0, 10, 10) },
    ]));
    const canvas = page.getByTestId('flooring-sketch-canvas');
    await page.getByTestId('tool-opening').click();
    const wall = await pagePoint(canvas, { x: 12.1, y: 5 });
    await page.mouse.click(wall.x, wall.y);

    const inspector = page.getByTestId('opening-inspector');
    await expect(inspector).toBeVisible();
    await expect(inspector.getByText('Living Room ↔ Kitchen')).toBeVisible();
    await expect.poll(() => api.last()?.levels[0].openings.length).toBe(1);
    const door = api.last()!.levels[0].openings[0];
    expect(door.rooms).toEqual(['a', 'b']);
    expect(Math.hypot(door.b.x - door.a.x, door.b.y - door.a.y)).toBeCloseTo(3, 3);
  });

  test('an open wall takes out the whole side between two rooms', async ({ page }) => {
    const api = await open(page, sketchWith([
      { id: 'a', name: 'Kitchen', points: rect(0, 0, 12, 10) },
      { id: 'b', name: 'Family Room', points: rect(12.375, 0, 10, 10) },
    ]));
    const canvas = page.getByTestId('flooring-sketch-canvas');
    await page.getByTestId('tool-openwall').click();
    const wall = await pagePoint(canvas, { x: 12.1, y: 4 });
    await page.mouse.click(wall.x, wall.y);

    const inspector = page.getByTestId('opening-inspector');
    await expect(inspector.getByText('Kitchen ↔ Family Room')).toBeVisible();
    await expect(inspector.getByText('Open wall (no wall)')).toBeVisible();
    await expect(inspector.getByText('Swings into')).toHaveCount(0);
    await expect.poll(() => api.last()?.levels[0].openings.length).toBe(1);
    const openWall = api.last()!.levels[0].openings[0];
    expect(openWall.kind).toBe('open_wall');
    expect(openWall.rooms).toEqual(['a', 'b']);
    expect([openWall.a, openWall.b]).toEqual([{ x: 12, y: 0 }, { x: 12, y: 10 }]);
    await canvas.screenshot({ path: test.info().outputPath('open-wall.png') });
  });

  test('a window clicked into a wall comes off the walls, not the baseboard', async ({ page }) => {
    const api = await open(page, sketchWith([{ id: 'a', name: 'Bedroom', points: rect(0, 0, 12, 10) }]));
    const canvas = page.getByTestId('flooring-sketch-canvas');
    await page.getByTestId('tool-window').click();
    const wall = await pagePoint(canvas, { x: 6, y: 0.1 });
    await page.mouse.click(wall.x, wall.y);

    const inspector = page.getByTestId('opening-inspector');
    await expect(inspector.getByText('Bedroom ↔ Outside')).toBeVisible();
    await expect(inspector.getByText('Swings into')).toHaveCount(0);
    await expect.poll(() => api.last()?.levels[0].openings.length).toBe(1);
    const window = api.last()!.levels[0].openings[0];
    expect(window.kind).toBe('window');
    expect(window.rooms).toEqual(['a', null]);
    expect(Math.hypot(window.b.x - window.a.x, window.b.y - window.a.y)).toBeCloseTo(3, 3);

    await inspector.getByLabel('Window height').fill(`3' 6"`);
    await inspector.getByLabel('Window height').press('Enter');
    await expect.poll(() => api.last()?.levels[0].openings[0].height_ft).toBeCloseTo(3.5, 3);

    // The room: 44 LF of baseboard still, its walls less the 3' by 3' 6" of glass
    const inside = await pagePoint(canvas, { x: 6, y: 6 });
    await page.getByTestId('tool-select').click();
    await page.mouse.click(inside.x, inside.y);
    const room = page.getByTestId('room-inspector');
    await expect(room.getByText('44.00 LF').last()).toBeVisible();
    await expect(room.getByText(`${(44 * 8 - 3 * 3.5).toFixed(2)} SF`)).toBeVisible();
    await canvas.screenshot({ path: test.info().outputPath('window.png') });
  });

  test('a wall dragged out from a wall is built onto it', async ({ page }) => {
    const api = await open(page, sketchWith([{ id: 'r1', name: 'Dining', points: rect(0, 0, 12, 10) }]));
    const canvas = page.getByTestId('flooring-sketch-canvas');
    await page.getByTestId('tool-wall').click();
    const from = await pagePoint(canvas, { x: 6, y: 10.1 });
    const to = await pagePoint(canvas, { x: 6.2, y: 6 });
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(to.x, to.y, { steps: 6 });
    await page.mouse.up();

    const inspector = page.getByTestId('wall-inspector');
    await expect(inspector).toBeVisible();
    await expect.poll(() => api.last()?.levels[0].walls?.length).toBe(1);
    const wall = api.last()!.levels[0].walls![0];
    expect(wall.room_id).toBe('r1');
    expect(wall.a.y).toBeCloseTo(10, 6);                    // on the wall it was drawn from
    expect(wall.b.x).toBeCloseTo(wall.a.x, 6);              // held upright
    expect(wall.thickness).toBe(0.375);

    // Typed to 4': both faces and its end take baseboard, its footprint comes off the floor
    await inspector.getByLabel('Wall length').fill('4');
    await inspector.getByLabel('Wall length').press('Enter');
    await expect(inspector.getByText('8.38 LF')).toBeVisible();
    await expect.poll(() => {
      const w = api.last()?.levels[0].walls?.[0];
      return w ? Math.hypot(w.b.x - w.a.x, w.b.y - w.a.y) : 0;
    }).toBeCloseTo(4, 6);
    await page.getByText('Dining', { exact: true }).last().click();
    await expect(page.getByTestId('room-inspector').getByText('118.50 SF')).toBeVisible();
    await canvas.screenshot({ path: test.info().outputPath('built-out-wall.png') });
  });

  test('a cabinet run shows its front and which sides show, and a side can be set', async ({ page }) => {
    const initial = sketchWith([{ id: 'k', name: 'Kitchen', points: rect(0, 0, 14, 12) }]);
    initial.levels[0].cabinet_runs = [
      { id: 'top', room_id: 'k', a: { x: 4, y: 0 }, b: { x: 14, y: 0 } },
      { id: 'right', room_id: 'k', a: { x: 14, y: 0 }, b: { x: 14, y: 8 } },
    ];
    const api = await open(page, initial);
    const canvas = page.getByTestId('flooring-sketch-canvas');
    const onRun = await pagePoint(canvas, { x: 9, y: 1 });
    await page.mouse.click(onRun.x, onRun.y);

    const inspector = page.getByTestId('cabinet-inspector');
    await expect(inspector.getByText('8.00 LF')).toBeVisible();       // 10' less the 2' corner
    await expect(inspector.getByText('Auto (shows)')).toBeVisible();  // stops 4' short of the left wall
    await expect(inspector.getByText('Auto (hidden)')).toBeVisible(); // the corner end
    await inspector.getByRole('combobox', { name: 'Side at start' }).click({ force: true });
    await page.locator('.ant-select-item-option', { hasText: /^Hidden$/ }).click();
    await expect.poll(() => api.last()?.levels[0].cabinet_runs.find((c) => c.id === 'top')?.side_a).toBe(false);
  });

  test('floor registers, pedestal and utility sinks can be placed', async ({ page }) => {
    const api = await open(page, sketchWith([{ id: 'r1', name: 'Laundry', points: rect(0, 0, 12, 10) }]));
    const canvas = page.getByTestId('flooring-sketch-canvas');
    const spots = { floor_register: { x: 2, y: 2 }, pedestal_sink: { x: 6, y: 5 }, utility_sink: { x: 9, y: 7 } };
    const labels = { floor_register: 'Floor register', pedestal_sink: 'Pedestal sink', utility_sink: 'Utility sink' };
    for (const type of ['floor_register', 'pedestal_sink', 'utility_sink'] as const) {
      await page.getByRole('combobox', { name: 'Fixture to place' }).click({ force: true });
      await page.locator('.ant-select-item-option', { hasText: labels[type] }).click();
      const at = await pagePoint(canvas, spots[type]);
      await page.mouse.click(at.x, at.y);
      await expect.poll(() => api.last()?.levels[0].fixtures.map((f) => f.type)).toContain(type);
    }
    await canvas.screenshot({ path: test.info().outputPath('new-fixtures.png') });
  });

  test('a shape drawn corner by corner with typed lengths', async ({ page }) => {
    const api = await open(page, sketchWith([{ id: 'r1', name: 'Bedroom', points: rect(0, 0, 12, 10) }]));
    const canvas = page.getByTestId('flooring-sketch-canvas');
    await zoomOut(page);
    await page.getByTestId('tool-polygon').click();
    const at = (x: number, y: number) => pagePoint(canvas, { x, y });

    let p = await at(14, 0);
    await page.mouse.click(p.x, p.y);
    const length = page.getByTestId('polygon-length-input');
    for (const [toward, typed] of [[[18, 0], '10'], [[24, 5], '8'], [[18, 8], `10' 0"`]] as const) {
      p = await at(toward[0], toward[1]);
      await page.mouse.move(p.x, p.y, { steps: 3 });
      await length.fill(typed);
      await length.press('Enter');
    }
    // Back on the first corner closes it
    p = await at(14, 0);
    await page.mouse.click(p.x, p.y);

    await expect.poll(() => savedRooms(api).length).toBe(2);
    expect(polygonArea(savedRooms(api)[1].points)).toBeCloseTo(80, 3);
  });
});

test('undo and redo, and a reload shows what was saved', async ({ page }) => {
  const api = await open(page, sketchWith([{ id: 'r1', name: 'Bedroom', points: rect(0, 0, 12, 10) }]));
  await page.getByLabel('New room name').fill('Hallway');
  await page.getByTestId('add-sized-room').click();
  const inspector = page.getByTestId('flooring-sketch-inspector');
  await expect(inspector.getByText('Hallway').first()).toBeVisible();

  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(inspector.getByText('Hallway')).toHaveCount(0);
  await page.getByRole('button', { name: 'Redo' }).click();
  await expect(inspector.getByText('Hallway').first()).toBeVisible();

  await expect.poll(() => savedRooms(api).map((r) => r.name)).toEqual(['Bedroom', 'Hallway']);
  await page.reload();
  await expect(page.getByTestId('flooring-sketch-inspector').getByText('Hallway').first()).toBeVisible();
});

test.describe('corners', () => {
  test.skip(({ isMobile }) => isMobile, 'Mouse gestures');

  test("a wall bends at a corner pulled from its middle, and a corner double-clicked goes", async ({ page }) => {
    const api = await open(page, sketchWith([{ id: 'r1', name: 'Bedroom', points: rect(0, 0, 12, 10) }]));
    const canvas = page.getByTestId('flooring-sketch-canvas');
    await zoomOut(page);
    const inside = await pagePoint(canvas, { x: 6, y: 5 });
    await page.mouse.click(inside.x, inside.y);
    await expect(page.getByTestId('room-inspector')).toBeVisible();

    const mid = await pagePoint(canvas, { x: 6, y: 0 });
    const out = await pagePoint(canvas, { x: 6, y: -2 });
    await page.mouse.move(mid.x, mid.y);
    await page.mouse.down();
    await page.mouse.move(mid.x, (mid.y + out.y) / 2, { steps: 3 });
    await page.mouse.move(out.x, out.y, { steps: 3 });
    await page.mouse.up();
    await expect.poll(() => savedRooms(api)[0]?.points.length).toBe(5);
    expect(polygonArea(savedRooms(api)[0].points)).toBeCloseTo(132, 3);

    const corner = await pagePoint(canvas, { x: 6, y: -2 });
    await page.mouse.dblclick(corner.x, corner.y);
    await expect.poll(() => savedRooms(api)[0]?.points.length).toBe(4);
    expect(polygonArea(savedRooms(api)[0].points)).toBeCloseTo(120, 3);
  });
});

test('two fingers zoom the sketch on a phone', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'Touch');
  await open(page, sketchWith([{ id: 'r1', name: 'Bedroom', points: rect(0, 0, 12, 10) }]));
  const canvas = page.getByTestId('flooring-sketch-canvas');
  const box = (await canvas.boundingBox())!;
  const before = Number(await canvas.getAttribute('data-scale'));
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  const cdp = await page.context().newCDPSession(page);
  const touch = (type: string, spreadPx: number) => cdp.send('Input.dispatchTouchEvent', {
    type,
    touchPoints: type === 'touchEnd' ? [] : [{ x: cx - spreadPx, y: cy, id: 1 }, { x: cx + spreadPx, y: cy, id: 2 }],
  });
  await touch('touchStart', 30);
  for (const s of [45, 60, 75, 90]) await touch('touchMove', s);
  await touch('touchEnd', 0);
  await expect.poll(async () => Number(await canvas.getAttribute('data-scale'))).toBeGreaterThan(before * 2.5);
});
