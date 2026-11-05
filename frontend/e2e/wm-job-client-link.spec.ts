import { test, expect as baseExpect, Page } from '@playwright/test';

// A job's page has a button to the client the job is under. It shows only when
// there is one and the person can open the Clients screen. Runs against the dev
// server with /api answered here.

const expect = baseExpect.configure({ timeout: 20_000 });

const JOB_ID = '11111111-1111-1111-1111-111111111111';
const CLIENT_ID = '22222222-2222-2222-2222-222222222222';
const JOB = {
  id: JOB_ID,
  property_address: '1 Old Rd, Fairfax, VA 22030',
  property_street: '1 Old Rd',
  homeowner_name: 'Pat Owner',
  status: 'Lead',
  active: true,
  created_at: '2026-10-01T00:00:00Z',
  updated_at: '2026-10-01T00:00:00Z',
};
const CLIENT = { id: CLIENT_ID, name: 'Pat Owner' };

async function open(page: Page, { client = CLIENT as typeof CLIENT | null, screens = undefined as string[] | undefined } = {}) {
  const user = { id: 'u1', username: 'admin', role: screens ? 'staff' : 'admin', is_active: true, ...(screens ? { screens } : {}) };
  await page.addInitScript((u) => {
    localStorage.setItem('auth_token', 'test-token');
    localStorage.setItem('auth_user', JSON.stringify(u));
  }, user);

  await page.route('**/api/**', route => {
    const path = new URL(route.request().url()).pathname;
    const json = (body: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

    if (path === '/api/auth/me') return json(user);
    if (path === `/api/water-mitigation/jobs/${JOB_ID}`) return json(JOB);
    if (path === `/api/water-mitigation/jobs/${JOB_ID}/client`) return json(client);
    if (path.endsWith('/financial-comparison')) return json({ detail: 'none' }, 404);
    if (path.endsWith('/photos/location-suggestions')) return json({ rooms: [] });
    if (path.startsWith('/api/clients/')) return json({ detail: 'none' }, 404);
    return json([]);
  });

  await page.goto(`/water-mitigation/${JOB_ID}`);
  await page.getByRole('heading', { name: JOB.property_address }).waitFor({ timeout: 120_000 });
}

test.describe('going from a job to its client', () => {
  test('the Client button opens the client the job is under', async ({ page }) => {
    await open(page);

    const button = page.getByRole('button', { name: /Client$/ });
    await expect(button).toBeVisible();
    await page.screenshot({ path: test.info().outputPath('header.png') });
    await button.click();

    await expect(page).toHaveURL(new RegExp(`/clients/${CLIENT_ID}$`));
  });

  test('no button while the job has no client', async ({ page }) => {
    await open(page, { client: null });

    await expect(page.getByRole('button', { name: /Edit/ }).first()).toBeVisible();
    await expect(page.getByRole('button', { name: /Client$/ })).toHaveCount(0);
  });

  test('no button for someone who cannot open Clients', async ({ page }) => {
    await open(page, { screens: ['water_mitigation'] });

    await expect(page.getByRole('button', { name: /Edit/ }).first()).toBeVisible();
    await expect(page.getByRole('button', { name: /Client$/ })).toHaveCount(0);
  });

  test('on a phone it is in the More menu', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await open(page);

    await page.getByRole('button', { name: 'More actions' }).click();
    await page.getByRole('menuitem', { name: /Open Client/ }).click();

    await expect(page).toHaveURL(new RegExp(`/clients/${CLIENT_ID}$`));
  });
});
