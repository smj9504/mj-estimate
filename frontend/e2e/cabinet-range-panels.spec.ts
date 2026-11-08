import { test, expect as baseExpect, Page } from '@playwright/test';

// A slide-in range base's finished end panels are priced per panel, so the
// count chosen has to survive opening the estimate and saving it again. Runs
// against the dev server with /api answered here.

const expect = baseExpect.configure({ timeout: 20_000 });

const ID = '33333333-3333-3333-3333-333333333333';

const rangeBase = (code: string, panels: number | null, order: number) => ({
  id: `box-${code}`,
  estimate_id: ID,
  code,
  cab_type: 'base',
  location: 'perimeter',
  width_inches: Number(code.slice(2, 4)),
  height_inches: 34.5,
  is_specialty: true,
  specialty_type: 'range_base_slide_in',
  has_glass_door: false,
  range_panel_count: panels,
  qty: 1,
  display_order: order,
});

const ESTIMATE = {
  id: ID,
  status: 'draft',
  kind: 'restoration',
  property_address: '1 Old Rd, Fairfax, VA 22030',
  tier: 'Standard',
  boxes: [rangeBase('RB30S', 0, 0), rangeBase('RB36S', 1, 1), rangeBase('RB40S', null, 2)],
  line_items: [],
  appliance_list: [],
  group_members: [],
  total: 0,
};

async function start(page: Page) {
  const saves: { boxes?: { code: string; range_panel_count: number | null }[] }[] = [];

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

const panelsShown = (page: Page, code: string) =>
  page.getByRole('row').filter({ hasText: code }).locator('.ant-select-selection-item').last();

test.describe('a slide-in range base\'s end panels', () => {
  test.use({ viewport: { width: 1600, height: 1100 } });

  test('the count chosen is shown and saved again as it was', async ({ page }) => {
    const saves = await start(page);

    await expect(panelsShown(page, 'RB30S')).toHaveText('0', { timeout: 90_000 });
    await expect(panelsShown(page, 'RB36S')).toHaveText('1');
    // Never chosen: priced and shown as both ends.
    await expect(panelsShown(page, 'RB40S')).toHaveText('2');

    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect.poll(() => saves.length).toBe(1);

    expect(saves[0].boxes?.map(b => [b.code, b.range_panel_count])).toEqual([
      ['RB30S', 0],
      ['RB36S', 1],
      ['RB40S', null],
    ]);
  });
});
