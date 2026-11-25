import { test, expect as baseExpect, Locator, Page } from '@playwright/test';

// The Rebuild project page shows what the claim's supplement asked for (its bid
// items, their scope notes and PDFs) above the scope of work, and a bid item's
// PDF opens in the viewer beside it. Runs against the dev server with /api
// answered here.

const expect = baseExpect.configure({ timeout: 20_000 });

const PROJECT_ID = '11111111-1111-1111-1111-111111111111';
const CLAIM_ID = '22222222-2222-2222-2222-222222222222';
const SUPPLEMENT_ID = '33333333-3333-3333-3333-333333333333';
const BATHROOM_ESTIMATE_ID = '44444444-4444-4444-4444-444444444444';

const PROJECT = {
  id: PROJECT_ID,
  claim_id: CLAIM_ID,
  title: 'Rebuild - 12 Elm St',
  property_address: '12 Elm St, Fairfax, VA',
  status: 'assigned',
  scope_of_work: 'Replace hall bath tile\nPaint living room',
  insurance_estimate_amount: 42000,
  contract_amount: 0,
  final_invoice_amount: 0,
  coc_sent: false,
  invoice_sent: false,
  photos_sent: false,
  docs_acknowledged: false,
  customer_managed: false,
  priority: 'normal',
  completion_doc_count: 0,
  completion_docs: [],
  client_name: 'Jin Park',
  claim_number: 'TEST-001',
};

const ESTIMATE = {
  id: 'neg-1',
  claim_id: CLAIM_ID,
  revision_number: 2,
  revision_type: 'supplement',
  rcv_amount: 42000,
  date_received: '2026-11-10',
  file_download_id: 'file-carrier',
  document_name: 'Carrier estimate.pdf',
};

const bid = (over: Record<string, unknown>) => ({
  supplement_id: SUPPLEMENT_ID,
  included_in_xactimate: false,
  status: 'sent',
  ...over,
});

const SUPPLEMENT = {
  id: SUPPLEMENT_ID,
  claim_id: CLAIM_ID,
  request_type: 'supplement',
  title: 'Review Insurance Estimate',
  status: 'submitted',
  priority: 'high',
  original_amount: 30000,
  supplement_amount: 27650,
  our_estimate_amount: 0,
  difference: -2350,
  submitted_date: '2026-11-03T15:00:00Z',
  submitted_to: 'Dana Adjuster',
  bid_item_count: 3,
  followup_count: 1,
  bid_items: [
    bid({
      id: 'bid-xact', estimate_type: 'xactimate', title: 'Xactimate', custom_amount: 18250,
      description: 'Baseboard added on the 1st floor\nCarpet waste added',
      custom_document_file_id: 'file-xact', custom_document_file_name: 'Supplement.pdf',
    }),
    bid({
      id: 'bid-bath', estimate_type: 'bathroom', title: 'Hall bath', custom_amount: 9400,
      included_in_xactimate: true, bathroom_estimate_id: BATHROOM_ESTIMATE_ID,
    }),
    bid({ id: 'bid-pack', estimate_type: 'packing', title: 'Packing', custom_amount: 0 }),
  ],
};

/** A bid item's line by its name ("In Xactimate" on another line must not match "Xactimate") */
const bidLine = (scope: Page | Locator, name: string) => {
  // The inner locator of `has` is matched inside each line, so it starts from the page
  const page = 'goto' in scope ? scope : scope.page();
  return scope.locator('.rb-bid').filter({ has: page.locator('.rb-doc-name', { hasText: new RegExp(`^${name}$`) }) });
};

const PDF = Buffer.from(
  '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n'
  + '2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n'
  + '3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]>>endobj\n'
  + 'trailer<</Root 1 0 R>>\n%%EOF\n',
);

/** Opens the project page with /api answered; returns the paths of the PDFs asked for */
async function open(page: Page, opts: { screens?: string[]; supplements?: unknown[] } = {}) {
  const pdfs: string[] = [];
  const user = { id: 'u1', username: 'admin', role: 'admin', is_active: true, ...(opts.screens ? { screens: opts.screens } : {}) };

  await page.addInitScript(u => {
    localStorage.setItem('auth_token', 'test-token');
    localStorage.setItem('auth_user', JSON.stringify(u));
  }, user);

  await page.route('**/api/**', route => {
    const path = new URL(route.request().url()).pathname;
    const json = (body: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

    if (path === '/api/auth/me') return json(user);
    if (path === `/api/rebuild/projects/${PROJECT_ID}`) return json(PROJECT);
    if (path === `/api/supplements/insurance-estimates/${CLAIM_ID}`) return json([ESTIMATE]);
    if (path === `/api/supplements/by-claim/${CLAIM_ID}`) return json(opts.supplements ?? [SUPPLEMENT]);
    if (path.startsWith('/api/files/download/') || path.endsWith('/export/pdf')) {
      pdfs.push(path);
      return route.fulfill({ status: 200, contentType: 'application/pdf', body: PDF });
    }
    return json([]);
  });

  await page.setViewportSize({ width: 1400, height: 1000 });
  await page.goto(`/rebuild-projects/${PROJECT_ID}`);
  return { pdfs };
}

test('the supplement and its bid items show above the scope of work', async ({ page }) => {
  await open(page);

  const main = page.locator('.rb-page-main');
  const supplement = main.locator('section', { has: page.getByRole('heading', { name: 'Supplement' }) });
  await expect(supplement).toContainText('Submitted', { timeout: 60_000 });
  await expect(supplement).toContainText('$27,650.00');
  await expect(supplement).toContainText('Sent Nov 3, 2026 to Dana Adjuster');

  // Each bid item: name, amount, scope notes in full
  const xact = bidLine(supplement, 'Xactimate');
  await expect(xact).toContainText('$18,250.00');
  await expect(xact.locator('.rb-bid-notes')).toHaveText('Baseboard added on the 1st floor\nCarpet waste added');
  await expect(bidLine(supplement, 'Bathroom · Hall bath')).toContainText('$9,400.00 · In Xactimate');
  // No PDF and no estimate behind it: a plain line, nothing to open
  const packing = bidLine(supplement, 'Packing');
  await expect(packing).toContainText('No PDF');
  await expect(packing.getByRole('button')).toHaveCount(0);

  await expect(supplement.getByRole('link', { name: /Open/ })).toHaveAttribute('href', `/supplements/${SUPPLEMENT_ID}`);

  // Supplement first, then the scope of work, then the completion documents
  const headings = await main.locator('h2.ui-section-title').allInnerTexts();
  const order = ['Supplement', 'Scope of work', 'Completion documents'].map(h => headings.findIndex(t => t.startsWith(h)));
  expect(order.every(i => i >= 0)).toBe(true);
  expect(order).toEqual([...order].sort((a, b) => a - b));
  await expect(main.locator('section', { has: page.getByRole('heading', { name: 'Scope of work' }) }).locator('.rb-scope-text'))
    .toHaveText('Replace hall bath tile\nPaint living room');
  // The scope of work is no longer a row of the facts list
  await expect(main.locator('.ui-props')).not.toContainText('Scope of work');

  await main.screenshot({ path: test.info().outputPath('left-column.png') });
});

test('a bid item opens in the viewer and the arrow goes back to the estimate', async ({ page }) => {
  const { pdfs } = await open(page);
  const viewer = page.locator('.rb-viewer');
  await expect(viewer.locator('iframe')).toHaveAttribute('src', /file-carrier/, { timeout: 60_000 });

  // An uploaded PDF opens from its file
  await bidLine(page, 'Xactimate').getByRole('button').click();
  await expect(viewer.locator('iframe')).toHaveAttribute('src', /file-xact/);
  await expect(viewer.locator('.rb-viewer-title')).toHaveText('Xactimate');
  await expect(viewer.locator('.rb-viewer-meta')).toHaveText('Supplement · $18,250.00 · Sent Nov 3, 2026');
  await expect(bidLine(page, 'Xactimate')).toHaveClass(/is-active/);

  // One of our estimates prints with the login, so it shows as a blob
  await bidLine(page, 'Bathroom · Hall bath').getByRole('button').click();
  await expect(viewer.locator('iframe')).toHaveAttribute('src', /^blob:/);
  expect(pdfs).toContain(`/api/bathroom-estimates/${BATHROOM_ESTIMATE_ID}/export/pdf`);
  await expect(viewer.locator('.rb-viewer-title')).toHaveText('Bathroom · Hall bath');
  await page.screenshot({ path: test.info().outputPath('viewer.png') });

  await viewer.getByRole('button', { name: 'Back to the estimate' }).click();
  await expect(viewer.locator('iframe')).toHaveAttribute('src', /file-carrier/);
  await expect(viewer.locator('.rb-viewer-title')).toContainText('Insurance estimate');
});

test('without the Supplements screen there is no link to it; no supplement says so', async ({ page }) => {
  await open(page, { screens: ['rebuild_projects'], supplements: [] });
  const supplement = page.locator('.rb-page-main section', { has: page.getByRole('heading', { name: 'Supplement' }) });
  await expect(supplement).toContainText('No supplement on this claim.', { timeout: 60_000 });
  await expect(supplement.getByRole('link')).toHaveCount(0);
});

test('without the Supplements screen the supplement shows but does not link', async ({ page }) => {
  await open(page, { screens: ['rebuild_projects'] });
  const supplement = page.locator('.rb-page-main section', { has: page.getByRole('heading', { name: 'Supplement' }) });
  await expect(supplement).toContainText('Bathroom · Hall bath', { timeout: 60_000 });
  await expect(supplement.getByRole('link')).toHaveCount(0);
});
