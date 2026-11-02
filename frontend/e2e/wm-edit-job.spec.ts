import { test, expect as baseExpect, Page } from '@playwright/test';

// The Edit button on a job's page opens the job form, and leaving the form goes
// back to the job. Runs against the dev server with /api answered here.

const expect = baseExpect.configure({ timeout: 20_000 });

const JOB_ID = '11111111-1111-1111-1111-111111111111';
const JOB_PATH = `/water-mitigation/${JOB_ID}`;
const JOB = {
  id: JOB_ID,
  property_address: '1 Old Rd, Fairfax, VA 22030',
  property_street: '1 Old Rd',
  status: 'Lead',
  active: true,
  created_at: '2026-10-01T00:00:00Z',
  updated_at: '2026-10-01T00:00:00Z',
};

async function open(page: Page, url: string) {
  await page.addInitScript(() => {
    localStorage.setItem('auth_token', 'test-token');
    localStorage.setItem('auth_user', JSON.stringify({ id: 'u1', username: 'admin', role: 'admin' }));
  });

  await page.route('**/api/**', route => {
    const path = new URL(route.request().url()).pathname;
    const json = (body: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

    if (path === '/api/auth/me') return json({ id: 'u1', username: 'admin', role: 'admin', is_active: true });
    if (path === `/api/water-mitigation/jobs/${JOB_ID}`) return json(JOB);
    if (path.endsWith('/financial-comparison')) return json({ detail: 'none' }, 404);
    if (path.endsWith('/photos/location-suggestions')) return json({ rooms: [] });
    return json([]);
  });

  await page.goto(url);
}

const openFormFromHeader = async (page: Page) => {
  await open(page, JOB_PATH);
  await page.getByRole('heading', { name: JOB.property_address }).waitFor({ timeout: 60_000 });
  await page.getByRole('button', { name: /Edit/ }).first().click();
  await expect(page.getByRole('dialog', { name: 'Edit Job' })).toBeVisible();
};

test.describe('editing a job from its page', () => {
  test('the Edit button opens the job form, filled in', async ({ page }) => {
    await openFormFromHeader(page);

    await expect(page).toHaveURL(new RegExp(`${JOB_PATH}/edit$`));
    await expect(page.getByRole('dialog').getByLabel('Property Address')).toHaveValue(JOB.property_street);
  });

  test('Cancel closes the form and goes back to the job', async ({ page }) => {
    await openFormFromHeader(page);

    await page.getByRole('dialog').getByRole('button', { name: 'Cancel' }).click();

    await expect(page.getByRole('dialog')).toBeHidden();
    await expect(page).toHaveURL(new RegExp(`${JOB_PATH}$`));
  });

  test('saving closes the form, goes back to the job and reloads it', async ({ page }) => {
    await openFormFromHeader(page);

    const reloaded = page.waitForRequest(request =>
      new URL(request.url()).pathname === `/api/water-mitigation/jobs/${JOB_ID}` && request.method() === 'GET');
    await page.getByRole('dialog').getByRole('button', { name: /Update|Save|OK/ }).click();
    await reloaded;

    await expect(page.getByRole('dialog')).toBeHidden();
    await expect(page).toHaveURL(new RegExp(`${JOB_PATH}$`));
  });

  test('the browser back button closes the form', async ({ page }) => {
    await openFormFromHeader(page);

    await page.goBack();

    await expect(page.getByRole('dialog')).toBeHidden();
    await expect(page).toHaveURL(new RegExp(`${JOB_PATH}$`));
  });

  test('the form can be opened again after closing it', async ({ page }) => {
    await openFormFromHeader(page);
    await page.getByRole('dialog').getByRole('button', { name: 'Cancel' }).click();
    await expect(page.getByRole('dialog')).toBeHidden();

    await page.getByRole('button', { name: /Edit/ }).first().click();

    await expect(page.getByRole('dialog', { name: 'Edit Job' })).toBeVisible();
  });

  test('a link straight to /edit still opens the form', async ({ page }) => {
    await open(page, `${JOB_PATH}/edit`);

    await expect(page.getByRole('dialog', { name: 'Edit Job' })).toBeVisible();
    await expect(page.getByRole('dialog').getByLabel('Property Address')).toHaveValue(JOB.property_street);
  });
});
