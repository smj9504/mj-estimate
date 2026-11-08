import { test, expect as baseExpect, Page } from '@playwright/test';

// A claim or WM job can have up to three adjusters: the first in its own
// fields, two more when the carrier hands the claim to a third-party firm.
// Runs against the dev server with /api answered here.

const expect = baseExpect.configure({ timeout: 20_000 });

const JOB_ID = '11111111-1111-1111-1111-111111111111';
const JOB_PATH = `/water-mitigation/${JOB_ID}`;
const CLIENT_ID = '22222222-2222-2222-2222-222222222222';
const CLAIM_ID = '33333333-3333-3333-3333-333333333333';
const CLIENT_PATH = `/clients/${CLIENT_ID}`;

const FIRM = { company: 'Field Desk LLC', name: 'Sam Ortiz', phone: '512-555-0101', email: 'sam@fielddesk.com' };

const JOB = {
  id: JOB_ID,
  property_address: '1 Old Rd, Fairfax, VA 22030',
  property_street: '1 Old Rd',
  status: 'Sent to adjuster',
  active: true,
  adjuster_name: 'Pat Lee',
  adjuster_phone: '703-555-0100',
  adjuster_email: 'pat@carrier.com',
  additional_adjusters: [FIRM],
  created_at: '2026-10-01T00:00:00Z',
  updated_at: '2026-10-01T00:00:00Z',
};
const CLIENT = {
  id: CLIENT_ID,
  display_name: 'Ann Brown',
  owners: [],
  address: '12 Oak St',
  city: 'Fairfax',
  state: 'VA',
  zipcode: '22030',
};
const CLAIM = {
  id: CLAIM_ID,
  client_id: CLIENT_ID,
  claim_type: 'insurance',
  claim_number: 'CLM-12345',
  status: 'open',
  adjuster_name: 'Pat Lee',
  adjuster_email: 'pat@carrier.com',
  additional_adjusters: [FIRM],
  current_acv: 0,
  current_rcv: 0,
  wm_jobs: [],
  // The claim form needs one
  companies: [{ id: '44444444-4444-4444-4444-444444444444', name: 'MJ Restoration' }],
};

/** Opens a page with /api answered; returns the bodies of what gets saved */
async function open(page: Page, url: string) {
  const saved: Record<string, unknown>[] = [];

  await page.addInitScript(() => {
    localStorage.setItem('auth_token', 'test-token');
    localStorage.setItem('auth_user', JSON.stringify({ id: 'u1', username: 'admin', role: 'admin' }));
  });

  await page.route('**/api/**', route => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const json = (body: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

    if (request.method() === 'PUT') {
      saved.push(request.postDataJSON());
      return json({});
    }
    if (path === '/api/auth/me') return json({ id: 'u1', username: 'admin', role: 'admin', is_active: true });
    if (path === `/api/water-mitigation/jobs/${JOB_ID}`) return json(JOB);
    if (path.endsWith('/financial-comparison')) return json({ detail: 'none' }, 404);
    if (path.endsWith('/photos/location-suggestions')) return json({ rooms: [] });
    if (path === `/api/clients/${CLIENT_ID}`) return json(CLIENT);
    if (path === `/api/clients/${CLIENT_ID}/claims`) return json({ claims: [CLAIM], total: 1 });
    return json([]);
  });

  await page.goto(url);
  return saved;
}

const savedAdjusters = (saved: Record<string, unknown>[]) => {
  expect(saved).toHaveLength(1);
  return saved[0].additional_adjusters;
};

test.describe('a water mitigation job', () => {
  test('its page lists every adjuster', async ({ page }) => {
    await open(page, JOB_PATH);

    const card = page.locator('.ui-sheet-card', { hasText: 'Adjuster Contact Info' });
    await expect(card).toContainText('Pat Lee', { timeout: 60_000 });
    await expect(card).toContainText('Adjuster 2');
    await expect(card).toContainText('Sam Ortiz');
    await expect(card).toContainText('Field Desk LLC');
    await expect(card.getByRole('link', { name: FIRM.email })).toHaveAttribute('href', `mailto:${FIRM.email}`);
    await card.screenshot({ path: test.info().outputPath('wm-card.png') });
  });

  test('takes a third adjuster and no more', async ({ page }) => {
    const saved = await open(page, `${JOB_PATH}/edit`);
    const dialog = page.getByRole('dialog', { name: 'Edit Job' });
    await expect(dialog.locator('#additional_adjusters_0_company')).toHaveValue(FIRM.company, { timeout: 60_000 });

    await dialog.getByRole('button', { name: /Add adjuster/ }).click();
    await dialog.locator('#additional_adjusters_1_company').fill('Review Co');
    await dialog.locator('#additional_adjusters_1_email').fill('desk@review.com');

    await expect(dialog.getByText('Adjuster 3')).toBeVisible();
    await expect(dialog.getByRole('button', { name: /Add adjuster/ })).toHaveCount(0);
    await dialog.locator('#additional_adjusters_0_company').scrollIntoViewIfNeeded();
    await dialog.screenshot({ path: test.info().outputPath('wm-form.png') });

    await dialog.getByRole('button', { name: /OK/ }).click();
    await expect.poll(() => saved.length).toBe(1);
    expect(savedAdjusters(saved)).toEqual([
      FIRM,
      { company: 'Review Co', name: '', phone: '', email: 'desk@review.com' },
    ]);
  });

  test('removing the other adjuster saves an empty list', async ({ page }) => {
    const saved = await open(page, `${JOB_PATH}/edit`);
    const dialog = page.getByRole('dialog', { name: 'Edit Job' });
    await expect(dialog.locator('#additional_adjusters_0_company')).toHaveValue(FIRM.company, { timeout: 60_000 });

    await dialog.getByRole('button', { name: /Remove/ }).click();
    await dialog.getByRole('button', { name: /OK/ }).click();

    await expect.poll(() => saved.length).toBe(1);
    expect(savedAdjusters(saved)).toEqual([]);
  });
});

test.describe('a claim', () => {
  const openClaim = async (page: Page) => {
    const saved = await open(page, CLIENT_PATH);
    // A lone claim opens by itself; clicking it then would close it
    const header = page.locator('.cl-claims .ant-collapse-header').first();
    await header.waitFor({ timeout: 60_000 });
    if (await header.getAttribute('aria-expanded') !== 'true') await header.click();
    return saved;
  };

  test('lists every adjuster and emails them all', async ({ page }) => {
    await openClaim(page);

    const facts = page.locator('.cl-contacts');
    await expect(facts).toContainText('Pat Lee');
    await expect(facts).toContainText('Sam Ortiz · Field Desk LLC');
    await expect(page.getByText('Adjusters', { exact: true })).toBeVisible();
    await page.locator('.ui-props-row', { has: facts }).screenshot({ path: test.info().outputPath('claim-facts.png') });

    await facts.getByRole('button', { name: FIRM.email }).click();
    const to = page.locator('.ant-drawer .ant-select-selection-overflow').first();
    await expect(to).toContainText('pat@carrier.com');
    await expect(to).toContainText(FIRM.email);
  });

  test('its form edits the other adjusters', async ({ page }) => {
    const saved = await openClaim(page);
    await page.locator('.cl-claim-aside').getByRole('button', { name: /Edit/ }).first().click();
    const dialog = page.getByRole('dialog', { name: /Edit Claim/ });
    await expect(dialog.locator('#additional_adjusters_0_name')).toHaveValue(FIRM.name);

    await dialog.getByRole('button', { name: /Add adjuster/ }).click();
    await dialog.locator('#additional_adjusters_1_name').fill('Lee Park');
    await dialog.locator('#additional_adjusters_1_phone').fill('512-555-0199');
    await expect(dialog.getByRole('button', { name: /Add adjuster/ })).toHaveCount(0);
    await dialog.locator('#additional_adjusters_0_company').scrollIntoViewIfNeeded();
    await dialog.screenshot({ path: test.info().outputPath('claim-form.png') });

    await dialog.getByRole('button', { name: /Save|Update/ }).click();
    await expect.poll(() => saved.length).toBe(1);
    expect(savedAdjusters(saved)).toEqual([
      FIRM,
      { company: '', name: 'Lee Park', phone: '512-555-0199', email: '' },
    ]);
  });
});
