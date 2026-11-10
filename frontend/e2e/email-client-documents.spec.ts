import { test, expect as baseExpect, Page } from '@playwright/test';

// Emailing from the client page can attach files stored on the client - the
// Document Hub's files - picked from a list. Runs against the dev server with
// /api answered here.

const expect = baseExpect.configure({ timeout: 20_000 });

const CLIENT_ID = '22222222-2222-2222-2222-222222222222';
const CLAIM_ID = '33333333-3333-3333-3333-333333333333';
const OTHER_CLAIM_ID = '55555555-5555-5555-5555-555555555555';
const CLIENT_PATH = `/clients/${CLIENT_ID}?claim=${CLAIM_ID}`;

const CLIENT = {
  id: CLIENT_ID,
  display_name: 'Ann Brown',
  owners: [],
  address: '12 Oak St',
  city: 'Fairfax',
  state: 'VA',
  zipcode: '22030',
};
const claim = (id: string, number: string) => ({
  id,
  client_id: CLIENT_ID,
  claim_type: 'insurance',
  claim_number: number,
  status: 'open',
  insurance_company: 'State Farm',
  adjuster_name: 'Pat Lee',
  adjuster_email: 'pat@carrier.com',
  additional_adjusters: [],
  current_acv: 0,
  current_rcv: 0,
  wm_jobs: [],
  companies: [],
});

const file = (source: string, id: string, filename: string) => ({
  source, id, filename, mime_type: 'application/pdf',
});
const DOCUMENTS = [
  {
    id: 'file:f1', doc_type: 'file', title: 'COS signed.pdf', description: 'WM job · Certificate of Satisfaction',
    status: null, claim_id: CLAIM_ID, claim_number: 'CLM-1', date: '2026-11-08T12:00:00Z',
    file: file('wm_document', 'f1', 'COS signed.pdf'),
  },
  {
    id: 'neg1', doc_type: 'insurance_estimate', title: 'Insurance Est. Rev.1', description: 'Adjuster',
    status: 'extracted', claim_id: CLAIM_ID, claim_number: 'CLM-1', date: '2026-11-01T12:00:00Z',
    file: file('file', 'f2', 'StateFarm_estimate.pdf'),
  },
  {
    id: 'ct1', doc_type: 'contract', title: 'Work Authorization', description: '',
    status: 'signed', claim_id: null, claim_number: '', date: '2026-10-20T12:00:00Z',
    file: file('contract', 'ct1', 'Work Authorization.pdf'),
  },
  {
    id: 'file:f3', doc_type: 'file', title: 'Roof estimate.pdf', description: 'Supplement estimate',
    status: null, claim_id: OTHER_CLAIM_ID, claim_number: 'CLM-2', date: '2026-10-10T12:00:00Z',
    file: file('file', 'f3', 'Roof estimate.pdf'),
  },
  // A row with no stored file can't be attached
  {
    id: 'e1', doc_type: 'email', title: 'Documents', description: 'To: pat@carrier.com',
    status: 'sent', claim_id: CLAIM_ID, claim_number: 'CLM-1', date: '2026-11-09T12:00:00Z',
  },
];

/** Opens the client page with /api answered; returns what gets sent */
async function open(page: Page) {
  const sent: Record<string, unknown>[] = [];

  await page.addInitScript(() => {
    localStorage.setItem('auth_token', 'test-token');
    localStorage.setItem('auth_user', JSON.stringify({ id: 'u1', username: 'admin', role: 'admin' }));
  });

  await page.route('**/api/**', route => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const json = (body: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

    if (path === '/api/claim-followup/emails/send') {
      sent.push(request.postDataJSON());
      return json({ id: 'sent-1', status: 'sent', to_addresses: [], subject: 'x', attachments: [] });
    }
    if (path === '/api/auth/me') return json({ id: 'u1', username: 'admin', role: 'admin', is_active: true });
    if (path === `/api/clients/${CLIENT_ID}`) return json(CLIENT);
    if (path === `/api/clients/${CLIENT_ID}/claims`) {
      return json({ claims: [claim(CLAIM_ID, 'CLM-1'), claim(OTHER_CLAIM_ID, 'CLM-2')], total: 2 });
    }
    if (path === `/api/clients/${CLIENT_ID}/all-documents`) {
      return json({
        client_id: CLIENT_ID, total: DOCUMENTS.length, documents: DOCUMENTS,
        claims: [{ id: CLAIM_ID, claim_number: 'CLM-1' }, { id: OTHER_CLAIM_ID, claim_number: 'CLM-2' }],
      });
    }
    if (path === '/api/email-ingestion/accounts') {
      return json([{
        id: 'acc1', display_name: 'Office', email_address: 'office@abc.com', is_active: true, can_send: true,
      }]);
    }
    if (path.startsWith('/api/claim-followup/claim-companies/')) return json({});
    return json([]);
  });

  await page.goto(CLIENT_PATH);
  return sent;
}

test('picks client documents to attach and sends them by reference', async ({ page }) => {
  const sent = await open(page);

  const header = page.locator('.cl-claims > .ant-collapse-item > .ant-collapse-header').first();
  await header.waitFor({ timeout: 60_000 });
  await header.getByRole('button', { name: 'Send email' }).click();

  const drawer = page.locator('.ant-drawer-content');
  await drawer.getByRole('button', { name: /Client documents/ }).click();

  const picker = page.getByRole('dialog', { name: 'Attach client documents' });
  // This claim first: its files and the client's own contract, not the other claim's
  await expect(picker.getByText('COS signed.pdf')).toBeVisible();
  await expect(picker.getByText('Insurance Est. Rev.1')).toBeVisible();
  await expect(picker.getByText('Work Authorization')).toBeVisible();
  await expect(picker.getByText('Roof estimate.pdf')).toHaveCount(0);
  // A sent email has no file to attach
  await expect(picker.getByText('Documents', { exact: true })).toHaveCount(0);
  await picker.screenshot({ path: test.info().outputPath('picker-this-claim.png') });

  await picker.getByText('COS signed.pdf').click();
  await picker.getByText('Insurance Est. Rev.1').click();
  await picker.getByText('All claims').click();
  await expect(picker.getByText('Roof estimate.pdf')).toBeVisible();
  await expect(picker.getByText(/Supplement estimate · Claim #CLM-2/)).toBeVisible();
  await picker.getByText('Roof estimate.pdf').click();
  await expect(picker.getByText('3 selected')).toBeVisible();
  await picker.screenshot({ path: test.info().outputPath('picker-all-claims.png') });
  await picker.getByRole('button', { name: 'Attach' }).click();
  await expect(picker).toBeHidden();

  // Listed under Attachments by the name the recipient gets
  const list = drawer.locator('.fu-attach-list');
  await expect(list.locator('.fu-attach')).toHaveCount(3);
  await expect(list).toContainText('StateFarm_estimate.pdf');
  await expect(list).toContainText('Insurance estimate');
  await list.getByRole('button', { name: 'Remove Roof estimate.pdf' }).click();
  await expect(list.locator('.fu-attach')).toHaveCount(2);
  await expect(drawer.getByRole('button', { name: /Send \(2 files\)/ })).toBeVisible();

  // Reopening starts from what is attached
  await drawer.getByRole('button', { name: /Client documents/ }).click();
  await expect(picker.getByText('2 selected')).toBeVisible();
  await picker.getByRole('button', { name: 'Cancel' }).click();

  await drawer.locator('.fu-compose-body [contenteditable="true"]').fill('Please find the documents attached.');
  await drawer.locator('.fu-compose-block', { hasText: 'Attachments' }).screenshot({
    path: test.info().outputPath('composer-attachments.png'),
  });
  await drawer.getByRole('button', { name: /Send \(2 files\)/ }).click();

  await expect.poll(() => sent.length).toBe(1);
  expect(sent[0].client_documents).toEqual([
    { source: 'wm_document', id: 'f1' },
    { source: 'file', id: 'f2' },
  ]);
  expect(sent[0].claim_id).toBe(CLAIM_ID);
});

test('previews a document before picking it', async ({ page }) => {
  await open(page);
  await page.route(`**/api/clients/${CLIENT_ID}/document-files/**`, route => route.fulfill({
    status: 200, contentType: 'application/pdf',
    body: '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj 2 0 obj<</Type/Pages/Kids[]/Count 0>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF',
  }));

  const header = page.locator('.cl-claims > .ant-collapse-item > .ant-collapse-header').first();
  await header.waitFor({ timeout: 60_000 });
  await header.getByRole('button', { name: 'Send email' }).click();
  await page.locator('.ant-drawer-content').getByRole('button', { name: /Client documents/ }).click();

  const picker = page.getByRole('dialog', { name: 'Attach client documents' });
  const fetched = page.waitForRequest(r => r.url().includes('/document-files/wm_document/f1'));
  await picker.getByRole('button', { name: 'Preview COS signed.pdf' }).click();
  await fetched;
  // Previewing doesn't pick it
  await expect(picker.getByText('0 selected')).toBeVisible();
});
