import { test, expect as baseExpect, Page } from '@playwright/test';

// A door pattern is priced per door, and the page copies each box field by
// field, so the pattern chosen has to survive opening the estimate and saving
// it again. Runs against the dev server with /api answered here.

const expect = baseExpect.configure({ timeout: 20_000 });

const ID = '44444444-4444-4444-4444-444444444444';

const wall = (code: string, width: number, height: number, pattern: string | null, order: number) => ({
  id: `box-${code}`,
  estimate_id: ID,
  code,
  cab_type: 'wall',
  location: 'perimeter',
  width_inches: width,
  height_inches: height,
  is_specialty: false,
  specialty_type: null,
  has_glass_door: false,
  door_pattern: pattern,
  qty: 1,
  display_order: order,
});

const ESTIMATE = {
  id: ID,
  status: 'draft',
  kind: 'restoration',
  property_address: '1 Old Rd, Fairfax, VA 22030',
  tier: 'Standard',
  boxes: [
    wall('W3030', 30, 30, 'lattice', 0),
    wall('W3618', 36, 18, 'lattice_band', 1),
    wall('W4830', 48, 30, null, 2),
    {
      ...wall('DB24', 24, 34.5, null, 3),
      cab_type: 'base',
      is_specialty: true,
      specialty_type: 'drawer_base',
    },
  ],
  line_items: [],
  appliance_list: [],
  group_members: [],
  total: 0,
};

type Saved = { boxes?: { code: string; door_pattern: string | null }[] };

async function start(page: Page) {
  const saves: Saved[] = [];

  await page.addInitScript(() => {
    localStorage.setItem('auth_token', 'test-token');
    localStorage.setItem('auth_user', JSON.stringify({ id: 'u1', username: 'admin', role: 'admin' }));
    // The cabinet table is the Edit tab's (beside the sketch the list is a compact one).
    localStorage.setItem('cabinet-estimate.view', 'tabs');
  });

  await page.route('**/api/**', route => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace(/\/$/, '');
    const json = (body: unknown) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });

    if (path === '/api/auth/me') return json({ id: 'u1', username: 'admin', role: 'admin', is_active: true });
    if (path === `/api/cabinet-estimates/${ID}`) {
      if (request.method() === 'PUT') saves.push(request.postDataJSON());
      return json(ESTIMATE);
    }
    return json([]);
  });

  await page.goto(`/cabinet-estimates/${ID}`);
  return saves;
}

const row = (page: Page, code: string) => page.getByRole('row').filter({ hasText: code });
const doorShown = (page: Page, code: string) => row(page, code).locator('.ant-select-selection-item').last();
// The last list opened: the one before may still be fading out.
const option = (page: Page, label: string) =>
  page.locator('.ant-select-dropdown:visible .ant-select-item-option-content', { hasText: label }).last();
const save = (page: Page) => page.getByRole('button', { name: 'Save', exact: true }).click();
const patternsIn = (saved: Saved) => saved.boxes?.map(b => [b.code, b.door_pattern ?? null]);

test.describe('a cabinet\'s door pattern', () => {
  test.use({ viewport: { width: 1600, height: 1100 } });

  test('the one chosen is shown and saved again as it was', async ({ page }) => {
    const saves = await start(page);

    await expect(doorShown(page, 'W3030')).toHaveText('Lattice', { timeout: 90_000 });
    await expect(doorShown(page, 'W3618')).toHaveText('Oval band');
    await expect(doorShown(page, 'W4830')).toHaveText('Plain');

    await save(page);
    await expect.poll(() => saves.length).toBe(1);

    expect(patternsIn(saves[0])).toEqual([
      ['W3030', 'lattice'],
      ['W3618', 'lattice_band'],
      ['W4830', null],
      ['DB24', null],
    ]);
  });

  test('picking another saves it, and Plain clears it', async ({ page }) => {
    const saves = await start(page);
    await expect(doorShown(page, 'W4830')).toHaveText('Plain', { timeout: 90_000 });

    await doorShown(page, 'W4830').click();
    await option(page, 'Diamond lattice').click();
    await expect(doorShown(page, 'W4830')).toHaveText('Lattice');

    await doorShown(page, 'W3030').click();
    await option(page, 'Plain').click();
    await expect(doorShown(page, 'W3030')).toHaveText('Plain');

    await save(page);
    await expect.poll(() => saves.length).toBe(1);

    expect(patternsIn(saves[0])).toEqual([
      ['W3030', null],
      ['W3618', 'lattice_band'],
      ['W4830', 'lattice'],
      ['DB24', null],
    ]);
  });

  test('a box of drawers offers none', async ({ page }) => {
    await start(page);
    await expect(doorShown(page, 'W3030')).toHaveText('Lattice', { timeout: 90_000 });

    // Its code is the only list in the row: there is no door to put a pattern in.
    await expect(row(page, 'DB24').locator('.ant-select-selection-item')).toHaveCount(1);
  });
});
