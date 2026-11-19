import { test, expect as baseExpect, Page } from '@playwright/test';

// Several bathrooms on one job: the page says which estimate has the job's
// dumpster, permit, trip and lead RRP, says when calculating moved them on
// another bathroom's estimate, and one can be priced on its own.
// Runs against the dev server with /api answered here.

const expect = baseExpect.configure({ timeout: 20_000 });

const ID = '66666666-6666-6666-6666-666666666666';

const LINES = [
  { id: 'l1', phase: 1, description: 'Demo & removal - complete', quantity: 1, unit: 'LS', unit_price: 1450, total: 1450, category: 'demo', display_order: 0 },
  { id: 'l2', phase: 1, description: 'Dumpster - on the Master Bathroom estimate', quantity: 1, unit: 'LS', unit_price: 0, total: 0, category: 'demo', notes: 'One for the whole job (2 bathrooms), on the Master Bathroom estimate', display_order: 1 },
];

const ESTIMATE = {
  id: ID, kind: 'restore', estimate_number: 'BE-2', status: 'calculated', property_address: '12 Elm St',
  state: 'MD', zip_code: '20850', designation: 'hall', length_ft: 8, width_ft: 5, height_ft: 8,
  replace_tub: true, bathtub_spec: { type: 'alcove', material: 'acrylic' }, hidden_costs: {},
  line_items: LINES, total: 1450, group_members: [],
  job: { bathrooms: ['Master Bathroom', 'Hall Bathroom'], this: 'Hall Bathroom', carrier: 'Master Bathroom', carries: false },
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
    if (path === `/api/bathroom-estimates/${ID}/calculate`) {
      calculated.push(request.postDataJSON());
      return json({ ...ESTIMATE, job_updated: ['Master Bathroom'] });
    }
    if (path === `/api/bathroom-estimates/${ID}`) return json(ESTIMATE);
    if (path === '/api/auth/me') return json({ id: 'u1', username: 'admin', role: 'admin', is_active: true });
    return json([]);
  });
  await page.goto(`/bathroom-estimates/${ID}`);
  return calculated;
}

test('says which bathroom has the job costs, and what calculating moved', async ({ page }) => {
  const calculated = await open(page);
  await page.getByRole('tab', { name: /^Result/ }).click();
  await expect(page.getByText('Hall Bathroom: one of 2 bathrooms on this job (Master Bathroom, Hall Bathroom)')).toBeVisible();
  await expect(page.getByText(/The Master Bathroom estimate has the dumpster, permit, trip and lead RRP/)).toBeVisible();
  await page.screenshot({ path: test.info().outputPath('result.png') });

  // Priced on its own: the flag goes with the calculation
  await page.getByRole('tab', { name: 'Accessories & Costs' }).click();
  await page.locator('.ant-collapse-header', { hasText: 'Optional Costs' }).click();
  await page.getByRole('checkbox', { name: /Price on its own/ }).check();
  await page.getByRole('button', { name: /Calculate/ }).first().click();
  await expect.poll(() => calculated.length).toBe(1);
  expect(calculated[0].hidden_costs).toMatchObject({ price_alone: true });
  await expect(page.getByText('Also updated: Master Bathroom (the job\'s shared costs)')).toBeVisible();
});
