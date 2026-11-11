import { test, expect as baseExpect, Page } from '@playwright/test';

// A claim's received mail shows the files that came with it: they open in the
// page, and a PDF waiting for review can become the claim's estimate revision
// (amounts read in Add revision) or be filed as another document. Runs against
// the dev server with /api answered here.

const expect = baseExpect.configure({ timeout: 20_000 });

const CLIENT_ID = '22222222-2222-2222-2222-222222222222';
const CLAIM_ID = '33333333-3333-3333-3333-333333333333';
const EMAIL_ID = '44444444-4444-4444-4444-444444444444';
const CLIENT_PATH = `/clients/${CLIENT_ID}?claim=${CLAIM_ID}`;

const CLIENT = {
  id: CLIENT_ID, display_name: 'Ann Brown', owners: [], address: '12 Oak St',
  city: 'Fairfax', state: 'VA', zipcode: '22030',
};
const CLAIM = {
  id: CLAIM_ID, client_id: CLIENT_ID, claim_type: 'insurance', claim_number: 'CLM-1',
  status: 'open', insurance_company: 'State Farm', adjuster_name: 'Pat Lee',
  adjuster_email: 'pat@carrier.example', additional_adjusters: [], current_acv: 0,
  current_rcv: 0, wm_jobs: [], companies: [], inbox_checked_at: '2026-11-11T13:00:00Z',
};
const EMAIL = {
  id: EMAIL_ID, email_account_id: 'acc1', message_id: '<r1@carrier.example>',
  subject: 'Re: CLM-1 estimate', sender: 'Pat Lee <pat@carrier.example>',
  received_at: '2026-11-10T15:04:00Z', snippet: 'Attached is the estimate.',
  attachment_names: ['12 Oak St.pdf', 'Denial letter.pdf', 'kitchen.jpg', 'drone video.zip'],
  matched_client_id: CLIENT_ID, matched_claim_id: CLAIM_ID, match_method: 'claim_number',
  match_confidence: 95,
};
const ATTACHMENTS = [
  {
    kind: 'pdf', name: '12 Oak St.pdf', log_id: 'log1', file_id: 'file1', size: 412_000,
    content_type: 'application/pdf', status: 'pending', document_type: null,
    is_insurance_estimate: true, note: null, can_file: true,
  },
  {
    kind: 'pdf', name: 'Denial letter.pdf', log_id: 'log2', file_id: 'file2', size: 52_000,
    content_type: 'application/pdf', status: 'pending', document_type: null,
    is_insurance_estimate: false, note: null, can_file: true,
  },
  {
    kind: 'file', name: 'kitchen.jpg', log_id: null, file_id: 'file3', size: 230_000,
    content_type: 'image/jpeg', status: null, document_type: null,
    is_insurance_estimate: null, note: null, can_file: false,
  },
  {
    kind: 'missing', name: 'drone video.zip', log_id: null, file_id: null, size: null,
    content_type: null, status: null, document_type: null, is_insurance_estimate: null,
    note: 'Not stored in the app', can_file: false,
  },
];
const EXTRACTION = {
  sections: [{
    section_name: 'Dwelling', rcv: 48250, depreciation: 9150, net_acv: 39100,
    deductible: 1000, net_claim: 38100,
  }],
  totals: { acv_amount: 39100, rcv_amount: 48250, depreciation_amount: 9150, deductible: 1000 },
  validation: { is_valid: true, warnings: [] },
  file_id: 'file1',
  file_name: '12 Oak St.pdf',
};
const PDF = '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj 2 0 obj<</Type/Pages/Kids[]/Count 0>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF';

/** Opens the client page with /api answered; returns the requests that change things */
async function open(page: Page) {
  const posted: { path: string; body: any }[] = [];

  await page.addInitScript(() => {
    localStorage.setItem('auth_token', 'test-token');
    localStorage.setItem('auth_user', JSON.stringify({ id: 'u1', username: 'admin', role: 'admin' }));
  });

  await page.route('**/api/**', route => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const json = (body: unknown, status = 200) => route.fulfill({
      status, contentType: 'application/json', body: JSON.stringify(body),
    });

    if (request.method() === 'POST' && path === `/api/clients/${CLIENT_ID}/claims/${CLAIM_ID}/negotiations`) {
      posted.push({ path, body: request.postDataJSON() });
      return json({ id: 'neg1', claim_id: CLAIM_ID, revision_number: 1 });
    }
    if (path === '/api/email-ingestion/logs/log2/assign') {
      posted.push({ path, body: request.postDataJSON() });
      return json({ id: 'log2', status: 'uploaded', document_type: 'carrier-letter' });
    }
    if (path === '/api/email-ingestion/logs/log1/extract-estimate') return json(EXTRACTION);
    if (path === `/api/email-ingestion/received/${EMAIL_ID}/attachments`) return json(ATTACHMENTS);
    if (path.startsWith(`/api/email-ingestion/received/${EMAIL_ID}/files/`)) {
      return route.fulfill({ status: 200, contentType: 'application/pdf', body: PDF });
    }
    if (path === `/api/email-ingestion/received/${EMAIL_ID}`) {
      return json({ ...EMAIL, body_text: 'Hi, attached is the estimate for 12 Oak St.\n\nPat', body_html: '' });
    }
    if (path === '/api/email-ingestion/received') return json({ items: [EMAIL], total: 1 });
    if (path === '/api/auth/me') return json({ id: 'u1', username: 'admin', role: 'admin', is_active: true });
    if (path === `/api/clients/${CLIENT_ID}`) return json(CLIENT);
    if (path === `/api/clients/${CLIENT_ID}/claims`) return json({ claims: [CLAIM], total: 1 });
    if (path === `/api/clients/${CLIENT_ID}/claims/${CLAIM_ID}/negotiations`) {
      return json({ negotiations: [], total: 0 });
    }
    if (path === `/api/clients/${CLIENT_ID}/all-documents`) {
      return json({ client_id: CLIENT_ID, total: 0, documents: [], claims: [] });
    }
    if (path.startsWith('/api/claim-followup/claim-companies/')) return json({});
    return json([]);
  });

  await page.goto(CLIENT_PATH);
  return posted;
}

const emailSection = (page: Page) => page.locator('section.ui-section')
  .filter({ has: page.locator('h3.ui-section-title', { hasText: /^Email$/ }) });

async function openReceivedEmail(page: Page) {
  const email = emailSection(page);
  await email.getByRole('tab', { name: /Received/ }).waitFor({ timeout: 60_000 });
  await email.getByRole('tab', { name: /Received/ }).click();
  await email.getByText('Re: CLM-1 estimate').click();
  const files = page.locator('.cl-mail-files');
  await expect(files).toBeVisible();
  return files;
}

test('lists an email\'s files and opens one with the login', async ({ page }) => {
  await open(page);
  const files = await openReceivedEmail(page);

  await expect(files.locator('.cl-mail-file')).toHaveCount(4);
  // The emailed estimate stands out; the letter doesn't
  const estimate = files.locator('.cl-mail-file', { hasText: '12 Oak St.pdf' });
  await expect(estimate.getByText('Looks like an estimate')).toBeVisible();
  await expect(estimate.getByRole('button', { name: /Add as estimate/ })).toBeVisible();
  const letter = files.locator('.cl-mail-file', { hasText: 'Denial letter.pdf' });
  await expect(letter.getByText('Looks like an estimate')).toHaveCount(0);
  // Not stored: no link to open
  const missing = files.locator('.cl-mail-file', { hasText: 'drone video.zip' });
  await expect(missing.getByRole('button')).toHaveCount(0);
  await emailSection(page).screenshot({
    path: test.info().outputPath('received-attachments.png'),
  });

  const fetched = page.waitForRequest(r => r.url().includes(`/received/${EMAIL_ID}/files/file3`));
  await files.getByRole('button', { name: 'kitchen.jpg' }).click();
  const request = await fetched;
  expect(request.headers().authorization).toBe('Bearer test-token');
  await expect(page.getByRole('dialog', { name: 'kitchen.jpg' })).toBeVisible();
});

test('adds the emailed PDF as an estimate revision with its amounts', async ({ page }) => {
  const posted = await open(page);
  const files = await openReceivedEmail(page);

  await files.locator('.cl-mail-file', { hasText: '12 Oak St.pdf' })
    .getByRole('button', { name: /Add as estimate/ }).click();

  const dialog = page.getByRole('dialog', { name: /Add Negotiation Revision/ });
  await expect(dialog.getByText('From email')).toBeVisible();
  await expect(dialog.getByText('12 Oak St.pdf')).toBeVisible();
  await expect(dialog.getByText('All amounts verified')).toBeVisible();
  // Filled from the email
  await expect(dialog.getByLabel('Received From')).toHaveValue('Pat Lee');
  await expect(dialog.getByLabel('Date Received')).toHaveValue('11/10/2026');
  await dialog.screenshot({ path: test.info().outputPath('add-revision-from-email.png') });

  await dialog.getByLabel('Revision Type').click();
  await page.locator('.ant-select-item-option', { hasText: 'Initial' }).click();
  await dialog.getByRole('button', { name: 'Add Revision' }).click();

  await expect.poll(() => posted.length).toBe(1);
  const { body } = posted[0];
  expect(body.email_log_id).toBe('log1');
  expect(body.file_id).toBe('file1');
  expect(body.rcv_amount).toBe(48250);
  expect(body.sections_data).toHaveLength(1);
  expect(body.received_from).toBe('Pat Lee');
  await expect(dialog).toBeHidden();
});

test('files another PDF as a carrier letter', async ({ page }) => {
  const posted = await open(page);
  const files = await openReceivedEmail(page);

  await files.locator('.cl-mail-file', { hasText: 'Denial letter.pdf' })
    .getByRole('button', { name: /File as/ }).click();
  await page.getByRole('menuitem', { name: /Carrier letter/ }).click();

  await expect.poll(() => posted.length).toBe(1);
  expect(posted[0]).toEqual({
    path: '/api/email-ingestion/logs/log2/assign',
    body: { client_id: CLIENT_ID, claim_id: CLAIM_ID, document_type: 'carrier-letter' },
  });
});
