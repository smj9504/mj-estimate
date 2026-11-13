import { test, expect as baseExpect, Page } from '@playwright/test';

// Mail that comes back from outside (a PA's or adjuster's reply) is stored as
// HTML and shown in the page. Anything in it that would run as the signed-in
// user (an onerror handler, a script, a javascript: link) must be stripped,
// while the text and formatting stay. Runs against the dev server with /api
// answered here.

const expect = baseExpect.configure({ timeout: 20_000 });

const SUPPLEMENT_ID = '66666666-6666-6666-6666-666666666666';
const CLAIM_ID = '33333333-3333-3333-3333-333333333333';

const HOSTILE_REPLY =
  '<p>Photos of the <b>vanity</b> are attached.</p>' +
  '<img src="x-missing.png" onerror="window.__xss = (window.__xss || 0) + 1">' +
  '<script>window.__xss = (window.__xss || 0) + 1</script>' +
  '<a id="bad-link" href="javascript:window.__xss=1">open</a>' +
  '<svg><animate onbegin="window.__xss = 1" attributeName="x" dur="1s"/></svg>';

const SUPPLEMENT = {
  id: SUPPLEMENT_ID, claim_id: CLAIM_ID, request_type: 'supplement', title: 'Kitchen supplement',
  original_amount: 0, supplement_amount: 0, our_estimate_amount: 0, difference: 0,
  status: 'in_progress', priority: 'normal', required_estimates: {}, claim_number: 'CLM-7',
  homeowner_name: 'Ann Brown', property_address: '12 Oak St', bid_item_count: 0,
  followup_count: 1, bid_items: [], wm_jobs: [],
};
const FOLLOWUP = {
  id: 'fu1', supplement_id: SUPPLEMENT_ID, followup_type: 'info_request', info_status: 'pending',
  items_needed: [{ description: 'Vanity photos', resolved: false }],
  conversation: [
    { type: 'sent', date: '2026-11-10T14:00:00Z', sender: 'office@builder.example', body_html: '<p>Please send vanity photos.</p>' },
    { type: 'received', date: '2026-11-11T09:30:00Z', sender: 'pat@pa.example', body_html: HOSTILE_REPLY },
  ],
};

async function open(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem('auth_token', 'test-token');
    localStorage.setItem('auth_user', JSON.stringify({ id: 'u1', username: 'admin', role: 'admin' }));
  });
  await page.route('**/api/**', route => {
    const path = new URL(route.request().url()).pathname;
    const json = (body: unknown) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    if (path === '/api/auth/me') return json({ id: 'u1', username: 'admin', role: 'admin', is_active: true });
    if (path === `/api/supplements/${SUPPLEMENT_ID}`) return json(SUPPLEMENT);
    if (path === `/api/supplements/${SUPPLEMENT_ID}/followups`) return json([FOLLOWUP]);
    if (path === `/api/supplements/${SUPPLEMENT_ID}/pa-info`) return json({});
    return json([]);
  });
  await page.goto(`/supplements/${SUPPLEMENT_ID}`);
}

test('a reply with scripts in it shows its text and runs nothing', async ({ page }) => {
  await open(page);

  const reply = page.locator('.sup-msg.is-received .sup-msg-body');
  await expect(reply).toContainText('Photos of the vanity are attached.', { timeout: 60_000 });
  await expect(reply.locator('b')).toHaveText('vanity');

  // Give a broken image's onerror and the SVG animation time to fire, had they survived.
  await page.waitForTimeout(1500);
  expect(await page.evaluate(() => (window as any).__xss)).toBeUndefined();

  const bodyHtml = await reply.innerHTML();
  expect(bodyHtml).not.toMatch(/onerror|onbegin|<script|javascript:/i);
  await expect(reply.locator('#bad-link')).not.toHaveAttribute('href', /javascript:/);

  await page.locator('.sup-messages').screenshot({ path: test.info().outputPath('thread.png') });
});
