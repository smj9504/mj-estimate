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
  await page.goto(`/flooring-estimates/${ESTIMATE_ID}`);
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
