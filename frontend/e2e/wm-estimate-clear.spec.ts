import { test, expect as baseExpect, Page } from '@playwright/test';

// A WM insurance estimate entered by mistake on the job's comparison card can be
// cleared: Clear asks first, then removes it and the card shows no estimate.
// Runs against the dev server with /api answered here.

const expect = baseExpect.configure({ timeout: 20_000 });

const JOB_ID = '22222222-2222-2222-2222-222222222222';
const JOB = {
  id: JOB_ID,
  property_address: '7 Pine St, Fairfax, VA 22030',
  property_street: '7 Pine St',
  status: 'Sent to adjuster',
  claim_id: '33333333-3333-3333-3333-333333333333',
  active: true,
  created_at: '2026-10-01T00:00:00Z',
  updated_at: '2026-10-01T00:00:00Z',
};

const comparison = (entered: boolean, revisions = 1) => ({
  our_invoice: { invoice_id: null, invoice_number: 'WM-7', total_amount: 7200, subtotal: 7200, tax_amount: 0, generated_at: null },
  insurance_estimate: {
    wm_revision_count: entered ? revisions : 0,
    can_clear: entered,
    wm_cost_status: entered ? 'separate_estimate' : 'not_received',
    wm_estimate_amount: entered ? 6611.88 : null,
    approved_amount: null,
    wm_section: entered ? {
      section_name: 'Water Mitigation', rcv: 6611.88, depreciation: 0, net_acv: 6611.88,
      line_item_total: 6611.88, overhead_amount: 0, profit_amount: 0, deductible: 0,
    } : null,
    estimate_category: entered ? 'water_mitigation' : null,
    document_file_id: null,
    document_name: null,
    claim_rcv: 0, claim_acv: 0, claim_depreciation: 0,
    negotiation_revision: entered ? revisions : null,
    negotiation_type: entered ? 'initial' : null,
    negotiation_date: entered ? '2026-11-05T10:00:00Z' : null,
  },
  comparison: entered
    ? { our_total: 7200, insurance_total: 6611.88, difference: 588.12, difference_pct: 8.9 }
    : { our_total: 7200, insurance_total: 0, difference: null, difference_pct: null },
});

async function open(page: Page, revisions = 1) {
  const state = { entered: true, cleared: 0 };
  await page.addInitScript(() => {
    localStorage.setItem('auth_token', 'test-token');
    localStorage.setItem('auth_user', JSON.stringify({ id: 'u1', username: 'admin', role: 'admin' }));
  });

  await page.route('**/api/**', route => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const json = (body: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

    if (path === '/api/auth/me') return json({ id: 'u1', username: 'admin', role: 'admin', is_active: true });
    if (path === `/api/water-mitigation/jobs/${JOB_ID}`) return json(JOB);
    if (path.endsWith('/financial-comparison')) return json(comparison(state.entered, revisions));
    if (path.endsWith('/insurance-estimate') && request.method() === 'DELETE') {
      state.cleared += 1;
      state.entered = false;
      return json({ success: true, removed: revisions, wm_cost_status: 'not_received' });
    }
    if (path.endsWith('/photos/location-suggestions')) return json({ rooms: [] });
    if (path.endsWith('/client')) return json(null);
    return json([]);
  });

  await page.goto(`/water-mitigation/${JOB_ID}`, { timeout: 180_000 });
  await page.getByRole('heading', { name: JOB.property_address }).waitFor({ timeout: 120_000 });
  return state;
}

const card = (page: Page) => page.locator('.ant-card').filter({ hasText: 'Invoice vs Insurance Estimate' });

test.describe('clearing a WM estimate entered by mistake', () => {
  test('Clear asks first, then the card shows no estimate', async ({ page }) => {
    const state = await open(page);
    await expect(card(page)).toContainText('$6,611.88');

    await card(page).getByRole('button', { name: 'Clear' }).click();
    const confirm = page.locator('.ant-popconfirm');
    await expect(confirm).toContainText('Clear the WM insurance estimate?');
    await expect(confirm).toContainText('It comes off the claim');
    await page.screenshot({ path: test.info().outputPath('confirm.png') });

    // Cancel leaves it alone
    await confirm.getByRole('button', { name: 'Cancel' }).click();
    expect(state.cleared).toBe(0);

    await card(page).getByRole('button', { name: 'Clear' }).click();
    await page.locator('.ant-popconfirm').getByRole('button', { name: 'Clear' }).click();

    await expect(card(page)).toContainText('Not yet received from insurance');
    await expect(card(page)).not.toContainText('$6,611.88');
    await expect(card(page).getByRole('button', { name: 'Clear' })).toHaveCount(0);
    expect(state.cleared).toBe(1);
    await page.screenshot({ path: test.info().outputPath('cleared.png') });
  });

  test('with several revisions the confirm says they all go', async ({ page }) => {
    await open(page, 3);
    await card(page).getByRole('button', { name: 'Clear' }).click();
    await expect(page.locator('.ant-popconfirm')).toContainText('All 3 WM revisions come off the claim');
  });
});
