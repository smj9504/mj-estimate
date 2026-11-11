import { test, expect as baseExpect, Page } from '@playwright/test';

// While an email is sending, the app is locked: a WM send dialog can't be
// closed with Escape, Cancel or its X, and nothing behind it can be clicked,
// so the user can't walk away thinking it was cancelled or send it twice. Once
// the send lands, the lock goes and the dialog closes as before. The signing
// pages lock the same way while a signed copy is emailed.
// Runs against the dev server with /api answered here.

const expect = baseExpect.configure({ timeout: 20_000 });

const JOB_ID = '44444444-4444-4444-4444-444444444444';
const JOB = {
  id: JOB_ID,
  property_address: '9 Elm St, Fairfax, VA 22030',
  property_street: '9 Elm St',
  status: 'Ready to send',
  claim_id: '55555555-5555-5555-5555-555555555555',
  active: true,
  created_at: '2026-10-01T00:00:00Z',
  updated_at: '2026-10-01T00:00:00Z',
};

const doc = (id: string, filename: string) => ({
  ready: true,
  document: { id, filename, created_at: '2026-11-01T00:00:00Z' },
});

const EMAIL_INFO = {
  adjuster: { name: 'Ann Adjuster', email: 'ann@carrier.test', phone: '' },
  pa: { name: '', email: '', company: '' },
  job: {
    property_address: JOB.property_address,
    homeowner_name: 'Pat Owner',
    claim_number: 'CLM-9',
    insurance_company: 'Carrier',
    date_of_loss: '2026-10-01',
    documents_sent_date: null,
  },
  email_accounts: [{ id: 'acct-1', email_address: 'office@mj.test', display_name: 'Office' }],
  documents: {
    photo_report: doc('d1', 'photo-report.pdf'),
    invoice: doc('d2', 'invoice.pdf'),
    w9: doc('d3', 'w9.pdf'),
    cos: doc('d4', 'cos.pdf'),
    ewa: doc('d5', 'ewa.pdf'),
    sketch: doc('d6', 'sketch.pdf'),
    all_ready: true,
  },
  preset_emails: [],
};

async function open(page: Page) {
  const state = { sends: 0, finishSend: () => {} };
  await page.addInitScript(() => {
    localStorage.setItem('auth_token', 'test-token');
    localStorage.setItem('auth_user', JSON.stringify({ id: 'u1', username: 'admin', role: 'admin' }));
  });

  await page.route('**/api/**', async route => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const json = (body: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

    if (path === '/api/auth/me') return json({ id: 'u1', username: 'admin', role: 'admin', is_active: true });
    if (path === `/api/water-mitigation/jobs/${JOB_ID}`) return json(JOB);
    if (path.endsWith('/financial-comparison')) return json({ detail: 'none' }, 404);
    if (path.endsWith('/photos/location-suggestions')) return json({ rooms: [] });
    if (path.endsWith('/client')) return json(null);
    if (path.endsWith('/adjuster-email-info')) return json(EMAIL_INFO);
    if (path.endsWith('/generate-adjuster-email')) return json({ subject: 'CLM-9 - 9 Elm St', body_html: '<p>Hello</p>' });
    if (path.endsWith('/document-slot-overrides')) return json({});
    if (path.endsWith('/send-to-adjuster')) {
      state.sends += 1;
      // Held open until the test lets it land, like a slow send building PDFs
      await new Promise<void>(resolve => { state.finishSend = resolve; });
      return json({ status: 'Sent to adjuster', documents_sent_date: '2026-11-11T12:00:00Z', attachments_count: 6 });
    }
    return json([]);
  });

  await page.goto(`/water-mitigation/${JOB_ID}`, { timeout: 180_000 });
  await page.getByRole('heading', { name: JOB.property_address }).waitFor({ timeout: 120_000 });
  return state;
}

const dialog = (page: Page) => page.getByRole('dialog').filter({ hasText: 'Send Documents to Adjuster' });

// A real mouse click where the element sits, landing on whatever is on top there
async function clickWhereItIs(page: Page, locator: ReturnType<Page['locator']>) {
  const box = await locator.boundingBox();
  if (!box) throw new Error('element has no box');
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
}

test('sending a WM email locks the app until the send lands', async ({ page }) => {
  const state = await open(page);

  await page.getByRole('button', { name: 'More actions' }).click();
  await page.getByRole('menuitem', { name: /Send to Adjuster/ }).click();
  await expect(dialog(page)).toBeVisible();
  const send = dialog(page).getByRole('button', { name: /Send Email/ });
  await expect(send).toBeEnabled();

  const cancel = dialog(page).getByRole('button', { name: 'Cancel' });
  const closeX = dialog(page).getByRole('button', { name: 'Close' });
  const cancelBox = await cancel.boundingBox();
  const closeBox = await closeX.boundingBox();

  await send.click();
  await expect(page.locator('.pdf-upload-blocker')).toContainText('Sending email…');
  await expect(page.locator('.pdf-upload-blocker')).toContainText('Keep this page open');
  // The overlay catches clicks at once but fades in after 300ms
  await page.waitForTimeout(600);
  await page.screenshot({ path: test.info().outputPath('sending.png') });

  // None of the ways out work while it sends
  await page.keyboard.press('Escape');
  await page.mouse.click(cancelBox!.x + cancelBox!.width / 2, cancelBox!.y + cancelBox!.height / 2);
  await page.mouse.click(closeBox!.x + closeBox!.width / 2, closeBox!.y + closeBox!.height / 2);
  await page.mouse.click(5, 5); // the mask, outside the dialog
  await clickWhereItIs(page, send);
  await expect(dialog(page)).toBeVisible();
  expect(state.sends).toBe(1);

  state.finishSend();
  await expect(page.locator('.pdf-upload-blocker')).toHaveCount(0);
  await expect(page.getByText('Email sent with 6 attachment(s)')).toBeVisible();
  await expect(dialog(page)).toBeHidden();
  expect(state.sends).toBe(1);
});

test('emailing a signed copy from the signing page locks it until the send lands', async ({ page }) => {
  const state = { sends: 0, finishSend: () => {} };
  await page.route('**/api/**', async route => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const json = (body: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

    if (path === '/api/sign/tok-1' && request.method() === 'GET') {
      return json({
        contract_id: 'c1',
        title: 'Work Authorization',
        company_name: 'MJ Restoration',
        client_name: 'Pat Owner',
        client_email: 'pat@home.test',
        status: 'signed',
        requires_signature: true,
        existing_signatures: [{ signer_name: 'Pat Owner', signer_role: 'client', signed_at: '2026-11-10T12:00:00Z' }],
      });
    }
    if (path === '/api/sign/tok-1/send-copy') {
      state.sends += 1;
      await new Promise<void>(resolve => { state.finishSend = resolve; });
      return json({ message: 'sent', emails: ['pat@home.test'] });
    }
    return json([]);
  });

  await page.goto('/sign/tok-1', { timeout: 180_000 });
  await expect(page.getByText('This document has already been signed.')).toBeVisible({ timeout: 120_000 });

  const send = page.getByRole('button', { name: /Send/ });
  await send.click();
  await expect(page.locator('.pdf-upload-blocker')).toContainText('Sending email…');

  // A second press can't start another send
  await page.keyboard.press('Enter');
  await clickWhereItIs(page, send);
  expect(state.sends).toBe(1);

  state.finishSend();
  await expect(page.locator('.pdf-upload-blocker')).toHaveCount(0);
  await expect(page.getByText('Signed copy sent to pat@home.test').first()).toBeVisible();
  expect(state.sends).toBe(1);
});
