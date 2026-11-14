/**
 * The rebuild estimate: the flooring and kitchen estimates brought in room
 * by room, and a repair added on a room's walls from the Xactimate price
 * list. The API is stubbed with what the real service returns for the
 * sample house (fixtures/rebuild-estimate-*.json, written from the backend's
 * own service): a flooring estimate brought in and recalculated since, and a
 * kitchen cabinet estimate at the same address.
 */

import fs from 'fs';
import path from 'path';
import { expect, test, type Page, type Route } from '@playwright/test';

const ID = '44444444-4444-4444-4444-444444444444';
const read = (name: string) => JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', name), 'utf8'));
const BEFORE = read('rebuild-estimate-before.json');
const AFTER_IMPORT = read('rebuild-estimate-after-import.json');
const REFRESHED = read('rebuild-estimate-refreshed.json');
const IMPORTABLE = read('rebuild-estimate-importable.json');
const USER = {
  id: '99999999-9999-9999-9999-999999999999', username: 'admin', email: 'admin@example.com', full_name: 'Admin',
  role: 'admin', is_active: true, is_superuser: true,
};
const PAINT = {
  code: 'PNTSP', category_code: 'PNT', description: 'Seal/prime (1 coat) then paint (1 coat) {V}', unit: 'SF',
  price_list: 'VAAR8X_NOV26',
  activities: [{ activity: '+', label: 'Replace', price: 1.38, marked_up: 1.52, material_share: 0.1812 }],
};

const DRYWALL = {
  code: 'DRY1/2', category_code: 'DRY', description: '1/2" drywall - hung, taped, floated, ready for paint', unit: 'SF',
  price_list: 'VAAR8X_NOV26', ours: true,
  activities: [
    { activity: '&', label: 'R&R', price: 3.8, marked_up: 4.18, material_share: 0.2, wording: 'Drywall 1/2" - tear out, hang new, tape & finish' },
    { activity: '-', label: 'Remove', price: 0.54, marked_up: 0.59, material_share: 0, wording: 'Drywall 1/2" - tear out' },
  ],
};
const PAINT_OURS = {
  ...PAINT, ours: true,
  activities: [{ ...PAINT.activities[0], wording: '{S} - seal/prime & paint, 1 coat each' }],
};
const ONE_COAT = {
  code: 'PNTP', category_code: 'PNT', description: 'Paint {V} - one coat', unit: 'SF', price_list: 'VAAR8X_NOV26', ours: true,
  activities: [{ activity: '+', label: 'Replace', price: 0.96, marked_up: 1.06, material_share: 0.18, wording: '{S} - paint, 1 coat' }],
};
const ASSEMBLIES = [{
  key: 'walls_drywall', label: 'Walls - new drywall, primed & painted', hint: '', asks_cut: true,
  items: [
    { code: 'DRY1/2', activity: '&', section: 'wall', basis: 'wall_sf', cut_part: 'below', only_with_cut: false, match: DRYWALL },
    { code: 'PNTSP', activity: '+', section: 'wall', basis: 'wall_sf', cut_part: 'below', only_with_cut: false, match: PAINT_OURS },
    { code: 'PNTP', activity: '+', section: 'wall', basis: 'wall_sf', cut_part: 'above', only_with_cut: true, match: ONE_COAT },
  ],
}];

// The flooring estimate's sketch, as copied: two of its rooms drawn
const SKETCH = {
  version: 1, units: 'ft',
  levels: [{
    id: 'main', name: 'Main Level',
    rooms: BEFORE.rooms.slice(0, 2).map((r: { id: string; name: string }, i: number) => ({
      id: r.id, name: r.name, height_ft: 8, subroom_of: null,
      points: [{ x: i * 12.375, y: 0 }, { x: i * 12.375 + 12, y: 0 }, { x: i * 12.375 + 12, y: 10 }, { x: i * 12.375, y: 10 }],
    })),
    openings: [], cabinet_runs: [], fixtures: [], walls: [],
  }],
};

const json = (route: Route, body: unknown) =>
  route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });

async function mockApi(page: Page) {
  await page.addInitScript(([user]) => {
    localStorage.setItem('auth_token', 'e2e-test-token');
    localStorage.setItem('auth_user', JSON.stringify(user));
  }, [USER]);
  const api = {
    updates: [] as any[], imports: [] as any[], refreshes: [] as string[], wordings: [] as any[],
    sketches: [] as any[], copies: [] as any[],
  };
  let current = structuredClone(BEFORE);
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url());
    const p = url.pathname;
    const method = route.request().method();
    const base = '/api/rebuild-estimates';
    if (p.endsWith('/api/auth/me')) return json(route, USER);
    if (p.endsWith(`${base}/xactimate-search`)) return json(route, url.searchParams.get('q')?.includes('paint') ? [PAINT] : []);
    if (p.endsWith(`${base}/${ID}/importable`)) {
      // (the flooring estimate has its seven rooms drawn)
      return json(route, IMPORTABLE.map((o: { kind: string }) => ({ ...o, sketch_rooms: o.kind === 'flooring' ? 7 : 0 })));
    }
    if (p.endsWith(`${base}/${ID}/sketch`) && method === 'PUT') {
      // As the server does: each room drawn is a room, measured from the drawing
      const sketch = route.request().postDataJSON().sketch_data;
      api.sketches.push(sketch);
      const drawn = sketch.levels.flatMap((l: any) => l.rooms.map((r: any) => ({ ...r, level: l.name })));
      const kept = current.rooms.filter((r: any) => !r.sketch_room_id);
      current = {
        ...current,
        sketch_data: sketch,
        rooms: [...kept, ...drawn.map((r: any) => ({
          id: `sk-${r.id}`, name: r.name, level_name: r.level, sketch_room_id: r.id,
          measures: { floor_sf: 120, ceiling_sf: 120, wall_sf: 340.67, exterior_wall_sf: 0, perimeter_lf: 44, height_ft: 8 },
        }))],
      };
      return json(route, current);
    }
    if (p.endsWith(`${base}/${ID}/sketch/copy`)) {
      api.copies.push(route.request().postDataJSON());
      current = { ...current, sketch_data: SKETCH, rooms: current.rooms.map((r: any) => ({ ...r, sketch_room_id: r.id })) };
      return json(route, current);
    }
    if (p.endsWith(`${base}/${ID}/assemblies`)) return json(route, ASSEMBLIES);
    if (p.endsWith(`${base}/${ID}/wordings`)) {
      api.wordings.push(route.request().postDataJSON());
      return json(route, route.request().postDataJSON());
    }
    if (p.endsWith(`${base}/${ID}/sources`) && method === 'POST') {
      api.imports.push(route.request().postDataJSON());
      current = structuredClone(AFTER_IMPORT);
      return json(route, current);
    }
    const refresh = p.match(/\/sources\/([^/]+)\/refresh$/);
    if (refresh) {
      api.refreshes.push(refresh[1]);
      current = structuredClone(REFRESHED);
      return json(route, current);
    }
    if (p.endsWith(`${base}/${ID}`)) {
      if (method === 'PUT') {
        const body = route.request().postDataJSON();
        api.updates.push(body);
        current = { ...current, ...body };
      }
      return json(route, current);
    }
    if (p.endsWith(base)) return json(route, { items: [current], total: 1 });
    return json(route, []);
  });
  return api;
}

const roomId = (name: string) => BEFORE.rooms.find((r: { name: string }) => r.name === name).id;

test('each room shows the lines brought in under their sections, and a recalculated original is refreshed', async ({ page }) => {
  const api = await mockApi(page);
  await page.goto(`/rebuild-estimates/${ID}`);
  const flooring = page.getByTestId('source-flooring');
  await expect(flooring.getByText('Flooring estimate')).toBeVisible();
  await expect(flooring.getByText('Changed since it was brought in')).toBeVisible();

  // The first room open: its floor, from the flooring estimate, line by line
  const living = page.getByTestId(`rebuild-room-${roomId('Living Room')}`);
  await expect(living.getByText('from Flooring estimate')).toBeVisible();
  const imported = BEFORE.assembled.rooms[0].sections[0].lines;
  await expect(living.getByTestId('imported-line')).toHaveCount(imported.length);
  await expect(living.getByText(imported[0].description, { exact: true })).toBeVisible();

  await flooring.getByRole('button', { name: 'Refresh' }).click();
  await expect(flooring.getByText('Up to date')).toBeVisible();
  expect(api.refreshes).toEqual([BEFORE.sources[0].id]);
  await expect(page.getByTestId('rebuild-total')).toHaveText(
    `$${REFRESHED.assembled.total.toLocaleString('en-US', { minimumFractionDigits: 2 })}`);
});

test('the kitchen estimate is imported into the kitchen, under its floor', async ({ page }) => {
  const api = await mockApi(page);
  await page.goto(`/rebuild-estimates/${ID}`);
  await page.getByTestId('import-estimate').click();
  const kitchen = page.getByTestId('importable-cabinet');
  await expect(kitchen.getByText('Kitchen cabinet estimate')).toBeVisible();
  await expect(page.getByTestId('importable-flooring').getByText('Already in')).toBeVisible();
  await kitchen.getByRole('button', { name: 'Import' }).click();
  expect(api.imports).toEqual([{ kind: 'cabinet', estimate_id: IMPORTABLE.find((o: { kind: string }) => o.kind === 'cabinet').estimate_id }]);

  await expect(page.getByTestId('source-cabinet')).toBeVisible();
  await page.locator('.ant-collapse-header', { hasText: 'Kitchen' }).first().click();
  const room = page.getByTestId(`rebuild-room-${roomId('Kitchen')}`);
  await expect(room.getByText('from Kitchen cabinet estimate')).toBeVisible();
  await expect(room.getByText('Base cabinets - supply')).toBeVisible();
});

test("a repair from Xactimate goes on the room's walls, its quantity following the room", async ({ page }) => {
  const api = await mockApi(page);
  await page.goto(`/rebuild-estimates/${ID}`);
  await page.locator('.ant-collapse-header', { hasText: 'Kitchen' }).first().click();
  const room = page.getByTestId(`rebuild-room-${roomId('Kitchen')}`);
  await room.getByRole('combobox', { name: 'Add from Xactimate' }).click();
  await page.keyboard.type('paint');
  await page.locator('.ant-select-item-option', { hasText: 'PNTSP' }).click();

  await expect(room.getByLabel('Repair description')).toHaveValue('Seal/prime (1 coat) then paint (1 coat) the walls');
  await expect.poll(() => api.updates[api.updates.length - 1]?.lines?.[0]).toMatchObject({
    room_id: roomId('Kitchen'), section: 'wall', code: 'PNTSP', activity: '+', unit: 'SF',
    quantity: null, basis: 'wall_sf', unit_price: null,
    activities: [{ activity: '+', price: 1.38, material_share: 0.1812 }],
  });
});

test("a set goes on the lower 2' of the walls, the rest painted to match, all in our words", async ({ page }) => {
  const api = await mockApi(page);
  await page.goto(`/rebuild-estimates/${ID}`);
  await page.locator('.ant-collapse-header', { hasText: 'Kitchen' }).first().click();
  const room = page.getByTestId(`rebuild-room-${roomId('Kitchen')}`);
  await room.locator('.ant-select', { has: page.getByRole('combobox', { name: 'Set height' }) }).click();
  await page.locator('.ant-select-item-option', { hasText: "Lower 2'" }).click();
  await room.getByRole('combobox', { name: 'Add a set' }).click();
  await page.locator('.ant-select-item-option', { hasText: 'Walls - new drywall, primed & painted' }).click();

  await expect(room.getByLabel('Repair description')).toHaveCount(3);
  await expect.poll(() => (api.updates[api.updates.length - 1]?.lines || []).map((l: any) => (
    [l.description, l.basis, l.cut_height_ft, l.cut_part, l.xact_words]
  ))).toEqual([
    ['Drywall 1/2" - tear out, hang new, tape & finish', 'wall_sf', 2, 'below', false],
    ['Walls - seal/prime & paint, 1 coat each', 'wall_sf', 2, 'below', false],
    ['Walls - paint, 1 coat', 'wall_sf', 2, 'above', false],
  ]);
});

test("a line left in Xactimate's words is marked, and words written for it are kept", async ({ page }) => {
  const api = await mockApi(page);
  await page.goto(`/rebuild-estimates/${ID}`);
  await page.locator('.ant-collapse-header', { hasText: 'Kitchen' }).first().click();
  const room = page.getByTestId(`rebuild-room-${roomId('Kitchen')}`);
  await room.getByRole('combobox', { name: 'Add from Xactimate' }).click();
  await page.keyboard.type('paint');
  await page.locator('.ant-select-item-option', { hasText: "Xactimate's words" }).click();
  await expect(room.getByText("Xactimate's words")).toBeVisible();

  await room.getByLabel('Repair description').fill('Walls - prime and paint, one coat each');
  await expect(room.getByText("Xactimate's words")).toHaveCount(0);
  await room.getByRole('button', { name: 'Keep wording' }).click();
  await expect.poll(() => api.wordings).toEqual([
    { code: 'PNTSP', activity: '+', text: '{S} - prime and paint, one coat each' },
  ]);
});

test('a room drawn on the sketch is a room of the estimate, measured from the drawing', async ({ page }) => {
  const api = await mockApi(page);
  await page.goto(`/rebuild-estimates/${ID}?tab=sketch`);
  const sketch = page.getByTestId('rebuild-sketch');
  await sketch.getByLabel('New room name').fill('Laundry');
  await sketch.getByLabel('New room length').fill('12');
  await sketch.getByLabel('New room length').press('Enter');
  await sketch.getByLabel('New room width').fill('10');
  await sketch.getByLabel('New room width').press('Enter');
  await sketch.getByTestId('add-sized-room').click();

  await expect.poll(() => api.sketches.length).toBeGreaterThan(0);
  expect(api.sketches[api.sketches.length - 1].levels[0].rooms[0].name).toBe('Laundry');
  await expect(page.getByRole('tab', { name: 'Sketch (1)' })).toBeVisible();

  // On the estimate: its measures from the sketch, its name and measures changed there
  await page.getByRole('tab', { name: /Rooms & repairs/ }).click();
  const header = page.locator('.ant-collapse-header', { hasText: 'Laundry' });
  await expect(header.getByText('120 SF floor', { exact: false })).toBeVisible();
  await header.click();
  const roomId = api.sketches[api.sketches.length - 1].levels[0].rooms[0].id;
  const room = page.getByTestId(`rebuild-room-sk-${roomId}`);
  await expect(room.getByLabel('Room name')).toBeDisabled();
  await expect(room.getByLabel('Walls SF', { exact: true })).toBeDisabled();
  await expect(room.getByRole('button', { name: 'Remove room' })).toHaveCount(0);
  // The page's next save carries the room as the server has it
  await room.getByTestId('room-on-sketch').click();
  await expect(page.getByTestId('rebuild-sketch')).toBeVisible();
  await expect.poll(() => (api.updates[api.updates.length - 1]?.rooms || [])
    .some((r: any) => r.sketch_room_id === roomId)).toBe(true);
});

test("an empty sketch starts from the flooring estimate's, its rooms the rooms drawn", async ({ page }) => {
  const api = await mockApi(page);
  await page.goto(`/rebuild-estimates/${ID}?tab=sketch`);
  const offer = page.getByText("Start from the flooring estimate's sketch");
  await expect(offer).toBeVisible();
  await page.getByRole('button', { name: 'Copy its sketch' }).click();
  expect(api.copies).toEqual([{ flooring_estimate_id: IMPORTABLE.find((o: { kind: string }) => o.kind === 'flooring').estimate_id }]);

  await expect(offer).toHaveCount(0);
  await expect(page.getByRole('tab', { name: 'Sketch (2)' })).toBeVisible();
  // The editor starts again from the copy: its rooms are on the canvas's list
  await expect(page.getByTestId('rebuild-sketch').getByText(BEFORE.rooms[0].name).first()).toBeVisible();
  await page.getByRole('tab', { name: /Rooms & repairs/ }).click();
  await expect(page.getByTestId(`rebuild-room-${roomId('Living Room')}`).getByLabel('Room name')).toBeDisabled();
});
