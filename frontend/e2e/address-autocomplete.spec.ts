import { test, expect as baseExpect, Locator, Page } from '@playwright/test';

// Every address box suggests addresses, and picking one fills the address in.
//
// Runs against the dev server with /api answered here, so no backend or database
// is involved. To go through the real backend and Google instead, run the backend
// on :8000 and set E2E_REAL_GOOGLE=1: only the /api/address calls then get through.

const expect = baseExpect.configure({ timeout: 20_000 });

const REAL_GOOGLE = !!process.env.E2E_REAL_GOOGLE;

const TYPED = '6305 Musket Ball';
const STREET = '6305 Musket Ball Dr';
const CITY = 'Centreville';
const STATE = 'VA';
const ZIP = '20121';
const FULL = `${STREET}, ${CITY}, ${STATE} ${ZIP}`;

// Google spells the same street either way from one answer to the next
const THE_STREET = /^6305 Musket Ball Dr(ive)?$/;
const THE_FULL_ADDRESS = /^6305 Musket Ball Dr(ive)?, Centreville, VA 20121$/;

const JOB_ID = '11111111-1111-1111-1111-111111111111';
const PROJECT_ID = '22222222-2222-2222-2222-222222222222';
const SIDING_ID = '33333333-3333-3333-3333-333333333333';
const EXTRACTION_ID = '44444444-4444-4444-4444-444444444444';
const FLOORING_ID = '55555555-5555-5555-5555-555555555555';
const REBUILD_ESTIMATE_ID = '66666666-6666-6666-6666-666666666666';

const ESTIMATE_ADDRESS = { property_address: null, city: null, state: null, zip_code: null };
const FLOORING_ESTIMATE = {
  id: FLOORING_ID, claim_id: null, company_id: null, status: 'draft', group_id: null, project_type: 'insurance',
  kind: 'restore', option_label: null, ...ESTIMATE_ADDRESS, sketch_data: null, room_scopes: {}, job_scope: {},
  overview_text: null, include_overhead_profit: false, overhead_pct: 0.1, profit_pct: 0.1, subtotal: null, total: null,
  warning_flags: [], methodology_notes: null, notes: null, price_book: null, line_items: [], takeoff: null,
  claim_number: null, client_name: null, created_at: null, updated_at: null,
};
const REBUILD_ESTIMATE = {
  id: REBUILD_ESTIMATE_ID, claim_id: null, company_id: null, status: 'draft', ...ESTIMATE_ADDRESS,
  include_overhead_profit: false, overhead_pct: 0.1, profit_pct: 0.1, total: 0, notes: null,
  rooms: [], lines: [], sources: [],
  assembled: { rooms: [], by_source: [], added_total: 0, total: 0, tax_rate: 0, warnings: [] },
};

const SUGGESTIONS = {
  suggestions: [{
    place_id: 'musket-ball',
    full_text: `${STREET}, ${CITY}, ${STATE}, USA`,
    main_text: STREET,
    secondary_text: `${CITY}, ${STATE}, USA`,
  }],
};
const DETAILS = { street_address: STREET, city: CITY, state: STATE, zip: ZIP, county: 'Fairfax County' };

interface Options {
  /** What /api/address answers with, on top of the working defaults */
  address?: (path: string) => { status: number; body?: unknown; delayMs?: number } | undefined;
}

async function open(page: Page, url: string, options: Options = {}) {
  await page.addInitScript(() => {
    localStorage.setItem('auth_token', 'test-token');
    localStorage.setItem('auth_user', JSON.stringify({ id: 'u1', username: 'admin', role: 'admin' }));
  });

  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname;
    const json = (body: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

    if (path.startsWith('/api/address/')) {
      const custom = options.address?.(path);
      if (custom) {
        if (custom.delayMs) await new Promise(resolve => setTimeout(resolve, custom.delayMs));
        return json(custom.body ?? {}, custom.status);
      }
      if (REAL_GOOGLE) return route.continue();
      return json(path.endsWith('/autocomplete') ? SUGGESTIONS : DETAILS);
    }
    if (path === '/api/auth/me') return json({ id: 'u1', username: 'admin', role: 'admin', is_active: true });

    if (path === `/api/water-mitigation/jobs/${JOB_ID}`) {
      return json({
        id: JOB_ID, property_address: '1 Old Rd, Fairfax, VA 22030', status: 'Lead', active: true,
        created_at: '2026-10-01T00:00:00Z', updated_at: '2026-10-01T00:00:00Z',
      });
    }
    if (path.endsWith('/financial-comparison')) return json({ detail: 'none' }, 404);
    if (path.endsWith('/photos/location-suggestions')) return json({ rooms: [] });

    if (path === '/api/rebuild/projects') return json([{ id: PROJECT_ID, title: 'Rebuild', status: 'planning', priority: 'normal', property_address: '1 Old Rd' }]);
    if (path === `/api/rebuild/projects/${PROJECT_ID}`) {
      return json({ id: PROJECT_ID, title: 'Rebuild', status: 'planning', priority: 'normal', property_address: '1 Old Rd', milestones: [], change_orders: [], payments: [], documents: [] });
    }

    if (path === `/api/siding-estimates/${SIDING_ID}`) return json({ id: SIDING_ID, property_address: '1 Old Rd', measurements: {}, line_items: [] });

    // Autosaves answer with what was sent, as the server would
    const saved = (estimate: object) => json({ ...estimate, ...(route.request().postDataJSON() ?? {}) });
    if (path === `/api/flooring-estimates/${FLOORING_ID}`) return route.request().method() === 'PUT' ? saved(FLOORING_ESTIMATE) : json(FLOORING_ESTIMATE);
    if (path === '/api/flooring-estimates/pricing-info') return json({});
    if (path === '/api/clients/claims/search') {
      return json({
        claims: [{
          id: 'claim-1', client_id: 'client-1', claim_number: 'CLM-100', claim_type: 'insurance', client_name: 'Pat Example',
          address: `${STREET}, ${CITY}, ${STATE}`, street: STREET, city: CITY, state: STATE, zip_code: ZIP,
        }],
        total: 1,
      });
    }
    if (path === `/api/rebuild-estimates/${REBUILD_ESTIMATE_ID}`) return route.request().method() === 'PUT' ? saved(REBUILD_ESTIMATE) : json(REBUILD_ESTIMATE);

    if (path === '/api/insurance-extractions') return json([{ id: EXTRACTION_ID, carrier: 'State Farm', item_count: 3, parser_metadata: { header: { insured: 'Smith' } } }]);
    if (path === `/api/insurance-extractions/${EXTRACTION_ID}`) return json({ id: EXTRACTION_ID, carrier: 'State Farm', item_count: 3, parser_metadata: { header: { insured: 'Smith' } }, items: [] });

    return json([]);
  });

  await page.goto(url);
}

const suggestion = (page: Page) => page.locator('.ant-select-dropdown:visible .ant-select-item-option').filter({ hasText: CITY }).first();

async function pick(page: Page, box: Locator) {
  await box.click();
  await box.pressSequentially(TYPED, { delay: 20 });
  await suggestion(page).click();
}

test.describe('address boxes suggest addresses', () => {
  test('client form: the street stays in the box, the rest goes to its own fields', async ({ page }) => {
    await open(page, '/clients');
    await page.getByRole('button', { name: /Add Client/ }).first().click();

    const box = page.getByLabel('Street Address');
    await expect(box).toHaveAttribute('autocomplete', 'address-lookup');
    await pick(page, box);

    await expect(box).toHaveValue(THE_STREET);
    await expect(page.getByLabel('City')).toHaveValue(CITY);
    await expect(page.getByLabel('Zipcode')).toHaveValue(ZIP);
  });

  test('siding estimate', async ({ page }) => {
    await open(page, `/siding-estimates/${SIDING_ID}`);
    await page.getByRole('tab', { name: /Specs & Options/ }).click();

    const box = page.getByLabel('Address', { exact: true });
    await box.clear();
    await pick(page, box);

    await expect(box).toHaveValue(THE_STREET);
    await expect(page.getByLabel('City', { exact: true })).toHaveValue(CITY);
    await expect(page.getByLabel('State', { exact: true })).toHaveValue(STATE);
    await expect(page.getByLabel('Zip', { exact: true })).toHaveValue(ZIP);
  });

  test('water mitigation job details keep the whole address', async ({ page }) => {
    await open(page, `/water-mitigation/${JOB_ID}`);
    await page.locator('.ant-card', { hasText: 'Job Information' }).getByRole('button', { name: /Edit/ }).click();

    const box = page.getByPlaceholder('Enter property address');
    await box.clear();
    await pick(page, box);

    await expect(box).toHaveValue(THE_FULL_ADDRESS);

    const save = page.waitForRequest(request => request.url().includes(`/jobs/${JOB_ID}`) && request.method() !== 'GET');
    await page.locator('.ant-card', { hasText: 'Job Information' }).getByRole('button', { name: /Save/ }).click();
    expect((await save).postDataJSON().property_address).toMatch(THE_FULL_ADDRESS);
  });

  test('water mitigation job form', async ({ page }) => {
    await open(page, `/water-mitigation/${JOB_ID}/edit`);

    const box = page.getByRole('dialog').getByLabel('Property Address');
    await box.clear();
    await pick(page, box);

    await expect(box).toHaveValue(THE_STREET);
    await expect(page.getByRole('dialog').getByLabel('City')).toHaveValue(CITY);
    await expect(page.getByRole('dialog').getByLabel('State')).toHaveValue(STATE);
    await expect(page.getByRole('dialog').getByLabel('Zip Code')).toHaveValue(ZIP);
  });

  // Flooring and Rebuild estimates share one project panel
  for (const [name, url] of [
    ['flooring estimate', `/flooring-estimates/${FLOORING_ID}?tab=project`],
    ['rebuild estimate', `/rebuild-estimates/${REBUILD_ESTIMATE_ID}`],
  ]) {
    test(`${name}: the street stays in the box, the rest goes to its own fields`, async ({ page }) => {
      await open(page, url);
      const panel = page.getByTestId('flooring-project-panel');
      // The captions aren't <label>s: the field is the innermost block holding one
      const field = (caption: string) => panel.locator('div').filter({ has: page.getByText(caption, { exact: true }) }).last();

      const box = field('Property address').locator('input');
      await pick(page, box);

      await expect(box).toHaveValue(THE_STREET);
      await expect(field('City').locator('input')).toHaveValue(CITY);
      await expect(field('State').locator('.ant-select-selection-item')).toHaveText(STATE);
      await expect(field('Zip').locator('input')).toHaveValue(ZIP);
    });

    test(`${name}: picking the claim splits its address the same way`, async ({ page }) => {
      test.skip(REAL_GOOGLE, 'no address lookup here');
      await open(page, url);
      const panel = page.getByTestId('flooring-project-panel');
      const field = (caption: string) => panel.locator('div').filter({ has: page.getByText(caption, { exact: true }) }).last();

      await field('Claim').locator('input').pressSequentially('Pat', { delay: 20 });
      await page.locator('.ant-select-dropdown:visible .ant-select-item-option').filter({ hasText: 'Pat Example' }).click();

      await expect(field('Property address').locator('input')).toHaveValue(STREET);
      await expect(field('City').locator('input')).toHaveValue(CITY);
      await expect(field('State').locator('.ant-select-selection-item')).toHaveText(STATE);
      await expect(field('Zip').locator('input')).toHaveValue(ZIP);
    });
  }

  test('rebuild project keeps the whole address', async ({ page }) => {
    await open(page, `/rebuild-projects?project=${PROJECT_ID}`);
    await page.getByRole('button', { name: /Edit/ }).first().click();

    const box = page.getByLabel('Property Address');
    await box.clear();
    await pick(page, box);

    await expect(box).toHaveValue(THE_FULL_ADDRESS);
  });

  test('repair estimate wizard keeps the whole address', async ({ page }) => {
    await open(page, '/repair-estimate-wizard');
    await page.getByText('Smith').click();

    const box = page.getByPlaceholder('Job address');
    await pick(page, box);

    await expect(box).toHaveValue(THE_FULL_ADDRESS);
  });

  test('material order keeps the whole address', async ({ page }) => {
    await open(page, '/material-order/new');

    const box = page.getByLabel('Property Address');
    await pick(page, box);

    await expect(box).toHaveValue(THE_FULL_ADDRESS);
  });

  test('packing estimate keeps the whole address, with or without claims', async ({ page }) => {
    await open(page, '/reconstruction-estimate/pack-calculator-new');
    await page.getByRole('button', { name: /Next|Details|Continue/ }).first().click({ timeout: 5_000 }).catch(() => undefined);

    const box = page.locator('#pk-address');
    await pick(page, box);

    await expect(box).toHaveValue(THE_FULL_ADDRESS);
  });

  test('on-site signing: starting from an address', async ({ page }) => {
    await open(page, '/onsite-signing');
    await page.getByRole('button', { name: 'Start with an address instead' }).click();

    const box = page.getByPlaceholder('Street address');
    await pick(page, box);

    await expect(box).toHaveValue(THE_STREET);
  });
});

test.describe('picking and typing', () => {
  const openWizardBox = async (page: Page, options: Options = {}) => {
    await open(page, '/repair-estimate-wizard', options);
    await page.getByText('Smith').click();
    return page.getByPlaceholder('Job address');
  };

  test('typing carries on after a pick, first keystroke included', async ({ page }) => {
    const box = await openWizardBox(page);
    await pick(page, box);
    await expect(box).toHaveValue(THE_FULL_ADDRESS);

    await box.press('End');
    await box.pressSequentially(' Apt 5');

    await expect(box).toHaveValue(/^6305 Musket Ball Dr(ive)?, Centreville, VA 20121 Apt 5$/);
  });

  test('what they keep typing wins over a details answer that comes back late', async ({ page }) => {
    test.skip(REAL_GOOGLE, 'mocks the details call');
    const box = await openWizardBox(page, {
      address: path => (path.endsWith('/details') ? { status: 200, body: DETAILS, delayMs: 800 } : undefined),
    });
    await pick(page, box);
    await box.press('End');
    await box.pressSequentially('X');
    await page.waitForTimeout(1200);

    await expect(box).toHaveValue(/X$/);
  });

  test('free text is kept when nothing is picked', async ({ page }) => {
    const box = await openWizardBox(page);
    await box.pressSequentially('Somewhere with no address yet');
    await box.blur();

    await expect(box).toHaveValue('Somewhere with no address yet');
  });

  test('details failing still fills what the suggestion says', async ({ page }) => {
    test.skip(REAL_GOOGLE, 'mocks the details call');
    const box = await openWizardBox(page, {
      address: path => (path.endsWith('/details') ? { status: 502 } : undefined),
    });
    await pick(page, box);

    await expect(box).toHaveValue(`${STREET}, ${CITY}, ${STATE}`);
    await expect(page.locator('.ant-notification-notice')).toHaveCount(0);
  });

  test('Google suggestions show the attribution', async ({ page }) => {
    const box = await openWizardBox(page);
    await box.pressSequentially(TYPED, { delay: 20 });
    await expect(suggestion(page)).toBeVisible();
    await expect(page.getByText('Powered by Google')).toBeVisible();
  });
});

test.describe('when Google is unavailable', () => {
  test('the box falls back to OpenStreetMap, with no error shown', async ({ page }) => {
    test.skip(REAL_GOOGLE, 'mocks the lookup');
    await page.route('https://nominatim.openstreetmap.org/**', route => route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify([{
        display_name: `${STREET}, ${CITY}, Fairfax County, Virginia, ${ZIP}, United States`,
        address: { house_number: '6305', road: 'Musket Ball Dr', town: CITY, state: 'Virginia', postcode: ZIP, county: 'Fairfax County' },
      }]),
    }));

    await open(page, '/repair-estimate-wizard', { address: () => ({ status: 502 }) });
    await page.getByText('Smith').click();
    const box = page.getByPlaceholder('Job address');
    await pick(page, box);

    await expect(box).toHaveValue(THE_FULL_ADDRESS);
    await expect(page.getByText('Powered by Google')).toHaveCount(0);
    await expect(page.locator('.ant-notification-notice')).toHaveCount(0);
  });
});
