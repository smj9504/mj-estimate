import { test, expect as baseExpect, Page } from '@playwright/test';

// A drop-in tub in a big tiled platform: a lip at the front, wide ledges at
// the ends and the back, each side set on its own. The tub is drawn where
// the decks leave it, on the plan and in 3D, and the estimate gets the
// deck's SF (the platform less the tub) and each side's width.
// Runs against the dev server with /api answered here.

const expect = baseExpect.configure({ timeout: 20_000 });

const ID = '60606060-6060-6060-6060-606060606060';
const FT = 40;

const wall = (id: string, x0: number, y0: number, x1: number, y1: number) => ({
  id, start: { x: x0 * FT, y: y0 * FT }, end: { x: x1 * FT, y: y1 * FT }, thickness: 4, heightInches: 96,
});
// A 12' x 9' bathroom
const WALLS = [wall('n', 0, 0, 12, 0), wall('e', 12, 0, 12, 9), wall('s', 12, 9, 0, 9), wall('w', 0, 9, 0, 0)];
const SKETCH = {
  version: '1.0.0', walls: WALLS,
  rooms: [{
    id: 'bath', name: 'Bathroom', roomType: 'bathroom', heightInches: 96,
    boundary: WALLS.map((w) => w.start), wallIds: WALLS.map((w) => w.id),
    floorAreaSF: 108, netFloorAreaSF: 108, wallAreaSF: 336, perimeterLF: 42,
  }],
  fixtures: [],
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

const panel = (page: Page) => page.locator('.bes-panel');

async function setNum(page: Page, label: string, value: string) {
  const input = panel(page).getByLabel(label, { exact: true });
  await input.fill(value);
  await input.press('Tab');
}

test("a drop-in tub's deck set side by side: wide ledges at the ends, a lip at the front", async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1400, height: 1300 });
  const calculated = await open(page);

  // A tub added from the plan's list, made a drop-in in a 9' x 4' platform
  await page.locator('.bes-add-grid').getByRole('button', { name: /Bathtub/ }).click();
  const type = panel(page).getByRole('combobox', { name: 'Bathtub type' });
  await type.click({ force: true });
  await page.locator('.ant-select-dropdown:visible .ant-select-item-option', { hasText: 'Drop-in with deck' }).click();
  await setNum(page, 'Width, inches', '108');
  await setNum(page, 'Depth, inches', '48');

  // Its deck side by side: 1' at the back, a 4" lip at the front, 2' at each end
  await panel(page).getByRole('switch', { name: 'Deck width by side' }).click();
  await setNum(page, 'Back deck, inches', '12');
  await setNum(page, 'Front deck, inches', '4');
  await setNum(page, 'Left deck, inches', '24');
  await setNum(page, 'Right deck, inches', '24');
  await expect(panel(page).getByText('The tub inside: 60" × 32".')).toBeVisible();
  await page.waitForTimeout(500);
  await page.screenshot({ path: test.info().outputPath('deck-plan.png') });

  // On the estimate: the platform less the tub, each side's width
  await page.getByRole('button', { name: /Calculate/ }).first().click();
  await expect.poll(() => calculated.length).toBe(1);
  const tub = calculated[0].bathtub_spec;
  expect(tub.deck_tile).toBe(true);
  expect(tub.deck_tile_sf).toBeCloseTo((108 * 48 - 60 * 32) / 144, 1);
  expect(tub.deck_side_widths_in).toEqual({ back: 12, front: 4, left: 24, right: 24 });
  expect(tub.deck_tub_in).toEqual([60, 32]);

  // In 3D: the tub dropped in where the decks leave it
  await page.getByRole('tab', { name: /Sketch/ }).click();
  await page.getByText('3D', { exact: true }).click();
  await expect(page.locator('canvas').last()).toBeVisible();
  await page.waitForTimeout(3000);
  await page.locator('canvas').last().screenshot({ path: test.info().outputPath('deck-3d.png') });
});
