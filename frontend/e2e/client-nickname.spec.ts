import { test, expect as baseExpect, Page } from '@playwright/test';

// A client can carry a nickname, what staff call it among themselves
// ("아이스크림집"). It shows beside the name on the list and the client page,
// and saves from the edit form. Runs against the dev server with /api
// answered here.

const expect = baseExpect.configure({ timeout: 20_000 });

const CLIENT_ID = '22222222-2222-2222-2222-222222222222';
const OTHER_ID = '55555555-5555-5555-5555-555555555555';

const CLIENT = {
  id: CLIENT_ID,
  display_name: 'Jin Park',
  nickname: '아이스크림집',
  owners: [{ name: 'Jin Park', phone: '703-555-0100', is_primary: true }],
  address: '12 Elm St',
  city: 'Fairfax',
  state: 'VA',
  zipcode: '22030',
  is_active: true,
  claims: [],
  claim_count: 0,
  created_at: '2026-10-01T00:00:00Z',
  updated_at: '2026-10-01T00:00:00Z',
};
const OTHER = {
  ...CLIENT,
  id: OTHER_ID,
  display_name: 'Sam Lee',
  nickname: null,
  owners: [{ name: 'Sam Lee', is_primary: true }],
  address: '9 Oak Ave',
};

/** Opens a page with /api answered; returns the bodies of what gets saved */
async function open(page: Page, url: string) {
  const saved: Record<string, unknown>[] = [];
  const searches: string[] = [];

  await page.addInitScript(() => {
    localStorage.setItem('auth_token', 'test-token');
    localStorage.setItem('auth_user', JSON.stringify({ id: 'u1', username: 'admin', role: 'admin' }));
  });

  await page.route('**/api/**', route => {
    const request = route.request();
    const requestUrl = new URL(request.url());
    const path = requestUrl.pathname;
    const json = (body: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

    if (request.method() === 'PUT') {
      saved.push(request.postDataJSON());
      return json({ ...CLIENT, ...request.postDataJSON() });
    }
    if (path === '/api/auth/me') return json({ id: 'u1', username: 'admin', role: 'admin', is_active: true });
    if (path === '/api/clients/' || path === '/api/clients') {
      const search = requestUrl.searchParams.get('search');
      if (search) searches.push(search);
      const clients = search ? [CLIENT] : [CLIENT, OTHER];
      return json({ clients, total: clients.length, counts: { manual: 2, acculynx: 0 } });
    }
    if (path === `/api/clients/${CLIENT_ID}`) return json(CLIENT);
    if (path === `/api/clients/${CLIENT_ID}/claims`) return json({ claims: [], total: 0 });
    return json([]);
  });

  await page.goto(url);
  return { saved, searches };
}

test('the client list shows the nickname beside the name and searches by it', async ({ page }) => {
  const { searches } = await open(page, '/clients');

  const row = page.locator('tr', { hasText: 'Jin Park' });
  await expect(row).toContainText('“아이스크림집”', { timeout: 60_000 });
  // No nickname, no quotes
  await expect(page.locator('tr', { hasText: 'Sam Lee' }).locator('.client-nickname')).toHaveCount(0);
  await page.locator('.ant-table').screenshot({ path: test.info().outputPath('list.png') });

  await page.getByRole('textbox', { name: 'Search clients' }).fill('아이스크림');
  await expect.poll(() => searches).toContain('아이스크림');
});

test('the client page shows the nickname beside the title', async ({ page }) => {
  await open(page, `/clients/${CLIENT_ID}`);
  const header = page.locator('.clr-title-row');
  await expect(header).toContainText('Jin Park', { timeout: 60_000 });
  await expect(header.locator('.client-nickname')).toHaveText('“아이스크림집”');
  await page.locator('.clr').screenshot({ path: test.info().outputPath('header.png') });
});

test('the edit form changes and clears the nickname', async ({ page }) => {
  const { saved } = await open(page, `/clients/${CLIENT_ID}`);
  await expect(page.locator('.clr-title-row')).toContainText('Jin Park', { timeout: 60_000 });

  const editClient = async () => {
    await page.locator('.clr-actions').getByRole('button', { name: /Edit/ }).click();
    const dialog = page.getByRole('dialog', { name: /Edit Client/ });
    await expect(dialog.getByLabel('Nickname')).toHaveValue('아이스크림집');
    return dialog;
  };

  let dialog = await editClient();
  await dialog.screenshot({ path: test.info().outputPath('edit.png') });
  await dialog.getByLabel('Nickname').fill('목사님');
  await dialog.getByRole('button', { name: /Save|Update/ }).click();
  await expect.poll(() => saved.length).toBe(1);
  expect(saved[0].nickname).toBe('목사님');

  dialog = await editClient();
  await dialog.getByLabel('Nickname').fill('');
  await dialog.getByRole('button', { name: /Save|Update/ }).click();
  await expect.poll(() => saved.length).toBe(2);
  expect(saved[1].nickname).toBe('');
});
