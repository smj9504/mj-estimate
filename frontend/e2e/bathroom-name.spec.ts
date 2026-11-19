import { test, expect as baseExpect, Page } from '@playwright/test';

// A bathroom's type: picked from the list, or a name typed in and kept as
// typed (Project Info and the "+ Bathroom" dialog).
// Runs against the dev server with /api answered here.

const expect = baseExpect.configure({ timeout: 20_000 });

const ID = '56565656-5656-5656-5656-565656565656';
const ESTIMATE = {
  id: ID, group_id: ID, kind: 'restore', status: 'draft', property_address: '12 Elm St', city: 'Rockville',
  state: 'MD', zip_code: '20850', designation: 'master', length_ft: 8, width_ft: 5, height_ft: 8,
  line_items: [], group_members: [],
};

async function open(page: Page) {
  const sent: { saved: any[]; added: any[] } = { saved: [], added: [] };
  await page.addInitScript(() => {
    localStorage.setItem('auth_token', 'test-token');
    localStorage.setItem('auth_user', JSON.stringify({ id: 'u1', username: 'admin', role: 'admin' }));
  });
  await page.route('**/api/**', route => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const json = (body: unknown) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    if (path === `/api/bathroom-estimates/${ID}/bathrooms` && request.method() === 'POST') {
      sent.added.push(request.postDataJSON());
      return json({ ...ESTIMATE, id: 'new', designation: request.postDataJSON().designation });
    }
    if (path === `/api/bathroom-estimates/${ID}/bathrooms`) {
      return json([{ group_id: ID, name: 'Master Bathroom', estimate_id: ID, designation: 'master', total: 0, calculated: false, alone: false, current: true, estimates: [] }]);
    }
    if (path === `/api/bathroom-estimates/${ID}` && request.method() === 'PUT') {
      sent.saved.push(request.postDataJSON());
      return json(ESTIMATE);
    }
    if (path === `/api/bathroom-estimates/${ID}`) return json(ESTIMATE);
    if (path === '/api/auth/me') return json({ id: 'u1', username: 'admin', role: 'admin', is_active: true });
    return json([]);
  });
  await page.goto(`/bathroom-estimates/${ID}`);
  return sent;
}

test('a bathroom takes a listed type or a name typed in, kept as typed', async ({ page }) => {
  const sent = await open(page);
  // Project Info: the listed type shows by its label; a name typed in replaces it
  const field = page.getByRole('combobox', { name: 'Bathroom type or name' });
  await expect(page.locator('.ant-form-item').filter({ has: field }).locator('.ant-select-selection-item')).toHaveText('Master');
  await page.locator('.ant-form-item').filter({ has: field }).locator('.ant-select').click();
  await page.keyboard.type('Basement bath');
  await page.locator('.ant-select-dropdown:visible').getByText('Use “Basement bath”', { exact: true }).click();
  await expect(page.locator('.ant-form-item').filter({ has: field }).locator('.ant-select-selection-item')).toHaveText('Basement bath');
  await page.screenshot({ path: test.info().outputPath('typed.png') });
  await page.getByRole('button', { name: 'save Save', exact: true }).first().click();
  await expect.poll(() => sent.saved.length).toBe(1);
  expect(sent.saved[0].designation).toBe('Basement bath');

  // The "+ Bathroom" dialog takes one typed in too
  await page.locator('.be-bathroom-bar').getByRole('button', { name: /Bathroom/ }).click();
  const dialog = page.getByRole('dialog', { name: 'Add a bathroom to this job' });
  await expect(dialog.getByRole('combobox', { name: 'Bathroom type' })).toBeAttached();
  await dialog.locator('.ant-select-selector').click();
  await page.keyboard.type('  Kids   bath ');
  await page.locator('.ant-select-dropdown:visible').getByText('Use “Kids bath”', { exact: true }).click();
  await dialog.getByRole('button', { name: 'Add bathroom' }).click();
  await expect.poll(() => sent.added.length).toBe(1);
  expect(sent.added[0]).toEqual({ designation: 'Kids bath' });
});
