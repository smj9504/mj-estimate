import { test, expect as baseExpect, Page } from '@playwright/test';

// One job, several bathrooms: each its own estimate with its own scope. The
// estimate page lists the job's bathrooms, opens another on the same tab,
// and adds one with the house's facts; Project Info says what's shared.
// Runs against the dev server with /api answered here.

const expect = baseExpect.configure({ timeout: 20_000 });

const MASTER = '88888888-8888-8888-8888-888888888881';
const HALL = '88888888-8888-8888-8888-888888888882';
const POWDER = '88888888-8888-8888-8888-888888888883';

const estimate = (id: string, designation: string, extra: Record<string, unknown> = {}) => ({
  id, group_id: id, kind: 'restore', status: 'draft', property_address: '12 Elm St', city: 'Rockville',
  state: 'MD', zip_code: '20850', designation, length_ft: 8, width_ft: 5, height_ft: 8,
  bathtub_spec: {}, shower_spec: {}, line_items: [], group_members: [], ...extra,
});
const ESTIMATES: Record<string, any> = {
  [MASTER]: estimate(MASTER, 'master', { replace_tub: true, total: 9200, status: 'calculated' }),
  [HALL]: estimate(HALL, 'hall', { replace_shower: true }),
  [POWDER]: estimate(POWDER, 'powder'),
};

async function open(page: Page, id: string) {
  const added: any[] = [];
  let bathrooms = [
    { group_id: MASTER, name: 'Master Bathroom', estimate_id: MASTER, designation: 'master', total: 9200, calculated: true, alone: false },
    { group_id: HALL, name: 'Hall Bathroom', estimate_id: HALL, designation: 'hall', total: 0, calculated: false, alone: false },
  ];
  await page.addInitScript(() => {
    localStorage.setItem('auth_token', 'test-token');
    localStorage.setItem('auth_user', JSON.stringify({ id: 'u1', username: 'admin', role: 'admin' }));
  });
  await page.route('**/api/**', route => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const json = (body: unknown) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    const job = path.match(/^\/api\/bathroom-estimates\/([\w-]+)\/bathrooms$/);
    if (job && request.method() === 'POST') {
      added.push({ from: job[1], body: request.postDataJSON() });
      bathrooms = [...bathrooms, { group_id: POWDER, name: 'Powder Room', estimate_id: POWDER, designation: 'powder', total: 0, calculated: false, alone: false }];
      return json(ESTIMATES[POWDER]);
    }
    if (job) return json(bathrooms.map((b) => ({ ...b, current: b.estimate_id === job[1] })));
    const one = path.match(/^\/api\/bathroom-estimates\/([\w-]+)$/);
    if (one && ESTIMATES[one[1]]) return json(ESTIMATES[one[1]]);
    if (path === '/api/auth/me') return json({ id: 'u1', username: 'admin', role: 'admin', is_active: true });
    return json([]);
  });
  await page.goto(`/bathroom-estimates/${id}`);
  return added;
}

const bar = (page: Page) => page.locator('.be-bathroom-bar');

test('switches between the job\'s bathrooms on the same tab, and adds one', async ({ page }) => {
  const added = await open(page, MASTER);
  await expect(bar(page).getByText('Master Bathroom')).toBeVisible();
  await expect(bar(page).getByText('$9,200')).toBeVisible();
  await expect(bar(page).getByText('Not calculated')).toBeVisible();

  // Project Info: the house's facts are shared, the bathroom's own are apart
  await expect(page.getByText(/Company, client \/ claim and property are the house/)).toBeVisible();
  await expect(page.getByText('This bathroom', { exact: true })).toBeVisible();
  await page.screenshot({ path: test.info().outputPath('project-info.png') });

  // Another bathroom opens on the tab that was open
  await page.getByRole('tab', { name: 'Shower & Tub' }).click();
  await bar(page).getByText('Hall Bathroom').click();
  await expect(page).toHaveURL(new RegExp(`/bathroom-estimates/${HALL}$`));
  await expect(page.getByRole('tab', { name: 'Shower & Tub' })).toHaveAttribute('aria-selected', 'true');
  await expect(bar(page).locator('.ant-segmented-item-selected')).toContainText('Hall Bathroom');

  // A new bathroom, with the house's facts, opened
  await bar(page).getByRole('button', { name: /Bathroom/ }).click();
  const dialog = page.getByRole('dialog', { name: 'Add a bathroom to this job' });
  await dialog.locator('.ant-select-selector').click();
  await page.locator('.ant-select-dropdown:visible').getByText('Powder', { exact: true }).click();
  await page.screenshot({ path: test.info().outputPath('add.png') });
  await dialog.getByRole('button', { name: 'Add bathroom' }).click();
  await expect.poll(() => added.length).toBe(1);
  expect(added[0]).toEqual({ from: HALL, body: { designation: 'powder' } });
  await expect(page).toHaveURL(new RegExp(`/bathroom-estimates/${POWDER}$`));
  await expect(bar(page).locator('.ant-segmented-item-selected')).toContainText('Powder Room');
  await page.screenshot({ path: test.info().outputPath('powder.png') });
});
