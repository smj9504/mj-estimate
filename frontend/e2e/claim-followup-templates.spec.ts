import { test, expect as baseExpect, Page, Browser, BrowserContext } from '@playwright/test';

// Pages are lazy chunks; on the dev server the first load of each can be slow
const expect = baseExpect.configure({ timeout: 20_000 });

// Claim follow-up page: the email composer and email template management.
//
// The tests create a client, a claim with one follow-up task and email
// templates; afterAll deletes them. Nothing is sent. Point them at a
// throwaway database where you can:
//   E2E_API_URL  backend for both the test's own calls and the page's /api
//                requests (which then skip the dev server proxy). Without it,
//                the page uses the dev server proxy and the test calls
//                http://localhost:8000, so both must reach the same backend.
//   E2E_BASE_URL frontend, when it is not on http://localhost:3000

const API = process.env.E2E_API_URL || 'http://localhost:8000';
const ADMIN_USER = process.env.E2E_ADMIN_USER || 'admin';
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD || 'admin123';

test.use({ baseURL: process.env.E2E_BASE_URL || 'http://localhost:3000' });

interface Session {
  token: string;
  user: Record<string, unknown>;
}

async function api(token: string | null, method: string, path: string, body?: unknown) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status}: ${text}`);
  return text ? JSON.parse(text) : null;
}

const openContexts: BrowserContext[] = [];

async function pageAs(browser: Browser, session: Session, viewport = { width: 1440, height: 1000 }): Promise<Page> {
  const context = await browser.newContext({ serviceWorkers: 'block', viewport });
  openContexts.push(context);
  if (process.env.E2E_API_URL) {
    await context.route(
      url => url.pathname.startsWith('/api/') || url.pathname.startsWith('/uploads/'),
      async route => {
        const { pathname, search } = new URL(route.request().url());
        const response = await route.fetch({ url: `${API}${pathname}${search}` });
        await route.fulfill({ response });
      },
    );
  }
  await context.addInitScript(([token, user]) => {
    localStorage.setItem('auth_token', token);
    localStorage.setItem('auth_user', user);
  }, [session.token, JSON.stringify(session.user)]);
  return context.newPage();
}

test.afterEach(async () => {
  await Promise.all(openContexts.splice(0).map(async context => {
    await context.unrouteAll({ behavior: 'ignoreErrors' });
    await context.close();
  }));
});

/** Widest point of the page; anything over the viewport scrolls sideways */
const pageWidth = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth);

test.describe.configure({ mode: 'serial' });

test.describe('Claim follow-up email templates', () => {
  const stamp = Date.now();
  const claimNumber = `E2E-${stamp}`;
  const adjusterName = 'Dana Whitfield';
  const templateName = `E2E estimate request ${stamp}`;

  let admin: Session;
  let clientId: string;
  let claimId: string;
  const templateIds: string[] = [];

  const openClaim = async (page: Page) => {
    await page.goto(`/claim-followup/claim/${claimId}`);
    await expect(page.getByRole('heading', { level: 3, name: 'Request the rebuild estimate' })).toBeVisible();
  };

  /** The task's Email button opens the composer about that task */
  const openComposer = async (page: Page) => {
    await page.locator('.fu-task').first().getByRole('button', { name: 'Email' }).click();
    await expect(page.getByRole('heading', { name: 'New email' })).toBeVisible();
  };

  const openManager = async (page: Page) => {
    await page.locator('.fu-compose-tools').getByRole('button', { name: /Template/ }).click();
    await page.getByRole('menuitem', { name: /Manage templates/ }).click();
    const drawer = page.locator('.fu-tpl-drawer');
    await expect(drawer.getByText('Email templates')).toBeVisible();
    return drawer;
  };

  test.beforeAll(async () => {
    await fetch(`${API}/api/auth/init-admin`, { method: 'POST' });
    const login = await api(null, 'POST', '/api/auth/login', { username: ADMIN_USER, password: ADMIN_PASSWORD });
    admin = { token: login.access_token, user: login.user };

    const client = await api(admin.token, 'POST', '/api/clients/', {
      display_name: `E2E Homeowner ${stamp}`,
      owners: [{ name: `E2E Homeowner ${stamp}` }],
      address: '1428 Maple Ridge Dr',
      city: 'Plano',
      state: 'TX',
    });
    clientId = client.id;
    const claim = await api(admin.token, 'POST', `/api/clients/${clientId}/claims`, {
      client_id: clientId,
      claim_number: claimNumber,
      insurance_company: 'State Farm',
      adjuster_name: adjusterName,
      adjuster_email: 'dana.whitfield@example.com',
    });
    claimId = claim.id;
    await api(admin.token, 'POST', '/api/claim-followup/tasks', {
      claim_id: claimId,
      task_type: 'estimate_request',
      title: 'Request the rebuild estimate',
      assigned_to_name: adjusterName,
      assigned_to_email: 'dana.whitfield@example.com',
      assigned_to_role: 'adjuster',
    });
  });

  test.afterAll(async () => {
    for (const id of templateIds) {
      await api(admin.token, 'DELETE', `/api/claim-followup/templates/${id}`).catch(() => undefined);
    }
    if (clientId) await api(admin.token, 'DELETE', `/api/clients/${clientId}`).catch(() => undefined);
  });

  test('a new template fills in the claim and flags the fields it has no value for', async ({ browser }) => {
    const page = await pageAs(browser, admin);
    await openClaim(page);
    await openComposer(page);
    const drawer = await openManager(page);

    await drawer.getByRole('button', { name: 'New' }).click();
    await drawer.getByLabel('Name').fill(templateName);
    await drawer.locator('.ant-form-item', { hasText: 'Used for' }).locator('.ant-select-selector').click();
    await page.locator('.ant-select-item-option', { hasText: 'Estimate request' }).click();

    // Fields go in where the caret is, in the subject and in the body
    const subject = drawer.getByLabel('Subject');
    await subject.fill('Estimate for claim ');
    await drawer.getByRole('button', { name: 'Claim #', exact: true }).click();
    await expect(subject).toHaveValue('Estimate for claim {{claim_number}}');

    const body = drawer.locator('.fu-tpl-body .editor-content');
    await body.click();
    await page.keyboard.type('Hi ');
    await drawer.getByRole('button', { name: 'Adjuster', exact: true }).click();
    await page.keyboard.type(', the invoice is ');
    await drawer.getByRole('button', { name: 'Invoice amount', exact: true }).click();
    await expect(body).toContainText('Hi {{adjuster_name}}, the invoice is {{invoice_amount}}');

    // Preview uses this claim; a field it has no value for stays marked
    await drawer.locator('.ant-segmented-item', { hasText: 'Preview' }).click();
    const preview = drawer.locator('.fu-tpl-preview');
    await expect(preview).toContainText(`Estimate for claim ${claimNumber}`);
    await expect(preview).toContainText(`Hi ${adjusterName}`);
    await expect(preview.locator('mark.fu-tpl-missing')).toHaveText('{{invoice_amount}}');
    await expect(drawer.locator('.fu-tpl-hint')).toContainText('Invoice amount');

    await drawer.getByRole('button', { name: 'Save and use in email' }).click();
    await expect(drawer).toBeHidden();

    const saved = (await api(admin.token, 'GET', '/api/claim-followup/templates'))
      .find((t: { name: string }) => t.name === templateName);
    expect(saved).toBeTruthy();
    templateIds.push(saved.id);
    expect(saved.template_type).toBe('estimate_request');
    expect(saved.subject_template).toBe('Estimate for claim {{claim_number}}');
    expect([...saved.available_variables].sort()).toEqual(['adjuster_name', 'claim_number', 'invoice_amount']);

    // The composer got the filled version
    await expect(page.locator('#fu-compose-subject')).toHaveValue(`Estimate for claim ${claimNumber}`);
    await expect(page.locator('.fu-compose .editor-content')).toContainText(`Hi ${adjusterName}, the invoice is {{invoice_amount}}`);
    await expect(page.locator('.fu-compose-blank')).toContainText('{{invoice_amount}}');

    // Sending with a blank field asks first; going back sends nothing
    await page.locator('.fu-compose-foot').getByRole('button', { name: /Send/ }).click();
    const confirm = page.getByRole('dialog').filter({ hasText: 'Send with 1 blank field?' });
    await expect(confirm).toBeVisible();
    await confirm.getByRole('button', { name: 'Go back' }).click();
    await expect(confirm).toBeHidden();
    const sent = await api(admin.token, 'GET', `/api/claim-followup/communications/by-claim/${claimId}`);
    expect(sent).toHaveLength(0);
  });

  test('the template menu suggests templates for the task and replaces a draft only after asking', async ({ browser }) => {
    const page = await pageAs(browser, admin);
    await openClaim(page);
    await openComposer(page);

    await page.locator('#fu-compose-subject').fill('My own subject');
    await page.locator('.fu-compose-tools').getByRole('button', { name: /Template/ }).click();
    const menu = page.locator('.fu-template-menu');
    await expect(menu.locator('.ant-dropdown-menu-item-group-title').first()).toHaveText('Suggested for this task');
    await menu.getByRole('menuitem', { name: new RegExp(templateName) }).click();

    const confirm = page.getByRole('dialog').filter({ hasText: 'Replace your draft?' });
    await confirm.getByRole('button', { name: 'Keep my draft' }).click();
    await expect(page.locator('#fu-compose-subject')).toHaveValue('My own subject');

    await page.locator('.fu-compose-tools').getByRole('button', { name: /Template/ }).click();
    await menu.getByRole('menuitem', { name: new RegExp(templateName) }).click();
    await confirm.getByRole('button', { name: 'Replace' }).click();
    await expect(page.locator('#fu-compose-subject')).toHaveValue(`Estimate for claim ${claimNumber}`);
  });

  test('a template can be renamed, duplicated and deleted', async ({ browser }) => {
    const page = await pageAs(browser, admin);
    await openClaim(page);
    await openComposer(page);
    const drawer = await openManager(page);

    await drawer.locator('.fu-tpl-item', { hasText: templateName }).click();
    const renamed = `${templateName} (edited)`;
    await drawer.getByLabel('Name').fill(renamed);
    await drawer.getByRole('button', { name: 'Save changes' }).click();
    await expect(drawer.locator('.fu-tpl-item', { hasText: renamed })).toBeVisible();

    // Duplicate opens a copy as a new template
    await drawer.getByRole('button', { name: 'Duplicate template' }).click();
    await expect(drawer.getByLabel('Name')).toHaveValue(`Copy of ${renamed}`);
    await expect(drawer.getByLabel('Subject')).toHaveValue('Estimate for claim {{claim_number}}');
    await drawer.getByRole('button', { name: 'Create template' }).click();
    await expect(drawer.locator('.fu-tpl-item', { hasText: `Copy of ${renamed}` })).toBeVisible();
    const copy = (await api(admin.token, 'GET', '/api/claim-followup/templates'))
      .find((t: { name: string }) => t.name === `Copy of ${renamed}`);
    templateIds.push(copy.id);

    // Deleting asks, then the template leaves the list and the menu
    await drawer.getByRole('button', { name: 'Delete template' }).click();
    const confirm = page.getByRole('dialog').filter({ hasText: `Delete “Copy of ${renamed}”?` });
    await confirm.getByRole('button', { name: 'Delete' }).click();
    await expect(drawer.locator('.fu-tpl-item', { hasText: `Copy of ${renamed}` })).toHaveCount(0);
    const remaining = await api(admin.token, 'GET', '/api/claim-followup/templates');
    expect(remaining.some((t: { id: string }) => t.id === copy.id)).toBe(false);
  });

  test('unsaved template edits are not lost without asking', async ({ browser }) => {
    const page = await pageAs(browser, admin);
    await openClaim(page);
    await openComposer(page);
    const drawer = await openManager(page);

    await drawer.locator('.fu-tpl-item', { hasText: templateName }).click();
    await drawer.getByLabel('Name').fill('Half-finished rename');
    await drawer.getByRole('button', { name: 'New' }).click();
    const confirm = page.getByRole('dialog').filter({ hasText: 'Discard your changes?' });
    await confirm.getByRole('button', { name: 'Keep editing' }).click();
    await expect(drawer.getByLabel('Name')).toHaveValue('Half-finished rename');
  });

  test('on a phone the page and the composer fit the screen, and templates open one pane at a time', async ({ browser }) => {
    const page = await pageAs(browser, admin, { width: 390, height: 844 });
    await openClaim(page);
    expect(await pageWidth(page)).toBeLessThanOrEqual(390);

    await openComposer(page);
    expect(await pageWidth(page)).toBeLessThanOrEqual(390);

    const drawer = await openManager(page);
    const item = drawer.locator('.fu-tpl-item', { hasText: templateName });
    await expect(item).toBeVisible();
    await item.click();
    await expect(drawer.getByLabel('Name')).toBeVisible();
    await expect(drawer.locator('.fu-tpl-item')).toHaveCount(0);
    await drawer.getByRole('button', { name: 'Back to templates' }).click();
    await expect(item).toBeVisible();
  });
});
