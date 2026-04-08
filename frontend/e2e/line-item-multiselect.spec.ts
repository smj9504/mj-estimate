import { test, expect, Page } from '@playwright/test';

const API = 'http://localhost:8000';
const BASE_URL = 'http://localhost:3000';

// Helper: login and get token
async function getAuthToken(): Promise<string> {
  const res = await fetch(`${API}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'admin123' }),
  });
  if (!res.ok) throw new Error(`Login failed: ${res.status}`);
  const data = await res.json();
  return data.access_token || data.token;
}

// Helper: set auth token in browser localStorage
async function ensureLoggedIn(page: Page, token: string) {
  await page.goto(BASE_URL, { timeout: 60000 });
  await page.evaluate((t) => {
    localStorage.setItem('auth_token', t);
    localStorage.setItem('auth_user', JSON.stringify({ username: 'admin', role: 'admin' }));
  }, token);
}

// Helper: get the first company ID
async function getFirstCompanyId(token: string): Promise<string> {
  const res = await fetch(`${API}/api/companies/`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`Failed to fetch companies: ${res.status}`);
  const data = await res.json();
  const companies = Array.isArray(data) ? data : (data.items || []);
  if (!companies.length) throw new Error('No companies found');
  return companies[0].id;
}

// Helper: create an invoice with sections via API, return invoice ID
async function createInvoiceWithSections(token: string, companyId: string): Promise<string> {
  const items = [
    { name: 'Remove drywall', description: 'Remove drywall', quantity: 100, unit: 'SF', rate: 2.50, taxable: true, primary_group: 'Demolition', sort_order: 0 },
    { name: 'Remove flooring', description: 'Remove flooring', quantity: 50, unit: 'SF', rate: 3.00, taxable: true, primary_group: 'Demolition', sort_order: 1 },
    { name: 'Remove baseboards', description: 'Remove baseboards', quantity: 80, unit: 'LF', rate: 1.50, taxable: true, primary_group: 'Demolition', sort_order: 2 },
    { name: 'Install drywall', description: 'Install drywall', quantity: 100, unit: 'SF', rate: 4.00, taxable: true, primary_group: 'Rebuild', sort_order: 1000 },
    { name: 'Paint walls', description: 'Paint walls', quantity: 100, unit: 'SF', rate: 2.00, taxable: true, primary_group: 'Rebuild', sort_order: 1001 },
    { name: 'Final cleanup', description: 'Final cleanup', quantity: 1, unit: 'EA', rate: 500, taxable: false, primary_group: 'Cleanup', sort_order: 2000 },
  ];

  const invoiceData = {
    invoice_number: `TEST-MSEL-${Date.now()}`,
    date: '04-08-2026',
    due_date: '05-08-2026',
    company_id: companyId,
    client: {
      name: 'Test Client - MultiSelect',
      address: '123 Test St',
      city: 'TestCity',
      state: 'TX',
      zipcode: '78701',
    },
    status: 'draft',
    items,
    tax_method: 'percentage',
    tax_rate: 0,
    subtotal: 0,
    total: 0,
    payments: [],
    balance_due: 0,
  };

  const res = await fetch(`${API}/api/invoices/`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(invoiceData),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Create invoice failed: ${res.status} - ${body}`);
  }
  const data = await res.json();
  return data.id;
}

// Helper: delete test data
async function deleteInvoice(token: string, id: string) {
  await fetch(`${API}/api/invoices/${id}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  });
}

// Helper: expand invoice sections by clicking on the collapsible header
async function expandInvoiceSections(page: Page, sectionNames: string[]) {
  for (const name of sectionNames) {
    // Use getByText to find the section title, then click it
    const header = page.locator(`.section-panel-header`).filter({ hasText: name }).first();
    if (await header.count() > 0) {
      // Click in the left area of the header where the title is (avoid buttons on the right)
      const box = await header.boundingBox();
      if (box) {
        await page.mouse.click(box.x + 80, box.y + box.height / 2);
        await page.waitForTimeout(800);
      }
    }
  }
}

test.describe('Line Item Multi-Select: Invoice', () => {
  let token: string;
  let companyId: string;
  let invoiceId: string;

  test.beforeAll(async () => {
    token = await getAuthToken();
    companyId = await getFirstCompanyId(token);
  });

  test.beforeEach(async () => {
    invoiceId = await createInvoiceWithSections(token, companyId);
  });

  test.afterEach(async () => {
    if (invoiceId) await deleteInvoice(token, invoiceId);
  });

  test('should show checkboxes and action bar when items are selected', async ({ page }) => {
    await ensureLoggedIn(page, token);
    await page.goto(`/invoices/${invoiceId}/edit`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(2000);

    // Wait for section headers
    await page.waitForSelector('.section-panel-header', { timeout: 20000 });

    // Expand sections
    await expandInvoiceSections(page, ['Demolition', 'Rebuild', 'Cleanup']);

    // Wait for table to appear
    const table = page.locator('.invoice-items-table');
    await expect(table.first()).toBeVisible({ timeout: 10000 });

    // Verify checkboxes exist - target ROW checkboxes only (not header "Select All")
    const rowCheckboxes = page.locator('.invoice-items-table .ant-table-row .ant-checkbox-input');
    await expect(rowCheckboxes.first()).toBeVisible({ timeout: 5000 });

    // Select two items
    await rowCheckboxes.nth(0).check({ force: true });
    await page.waitForTimeout(300);
    await rowCheckboxes.nth(1).check({ force: true });
    await page.waitForTimeout(300);

    // Action bar should appear with "2 items selected"
    await expect(page.locator('text=2 items selected')).toBeVisible({ timeout: 5000 });

    // Should have Move and Copy buttons
    await expect(page.locator('button:has-text("Move to")')).toBeVisible();
    await expect(page.locator('button:has-text("Copy to")')).toBeVisible();
  });

  test('should move selected items to another section', async ({ page }) => {
    // Capture console logs for debugging
    const consoleLogs: string[] = [];
    page.on('console', msg => consoleLogs.push(`[${msg.type()}] ${msg.text()}`));

    await ensureLoggedIn(page, token);
    await page.goto(`/invoices/${invoiceId}/edit`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(2000);
    await page.waitForSelector('.section-panel-header', { timeout: 20000 });
    await expandInvoiceSections(page, ['Demolition', 'Rebuild', 'Cleanup']);

    const table = page.locator('.invoice-items-table');
    await expect(table.first()).toBeVisible({ timeout: 10000 });

    // Select first item in first section
    const checkboxes = page.locator('.invoice-items-table').first().locator('.ant-table-row .ant-checkbox-input');
    await checkboxes.nth(0).check({ force: true });
    await page.waitForTimeout(300);

    // Verify action bar
    await expect(page.locator('text=1 item selected')).toBeVisible({ timeout: 5000 });

    // Click "Move to" button to open section picker modal
    const moveBtn = page.locator('.multi-select-action-bar button:has-text("Move")');
    await moveBtn.scrollIntoViewIfNeeded();
    await moveBtn.click();
    await page.waitForTimeout(1000);

    // Take screenshot to see what happened
    await page.screenshot({ path: 'test-results/debug-move-click.png' });

    // Modal should appear with section list
    const modal = page.locator('.ant-modal-content').filter({ hasText: 'Move to Section' });
    await expect(modal).toBeVisible({ timeout: 5000 });

    // Click "Rebuild" in the modal section picker
    await page.locator('.ant-modal-body .section-picker-item').filter({ hasText: 'Rebuild' }).click();
    await page.waitForTimeout(1000);

    // Print captured console logs
    const multiSelectLogs = consoleLogs.filter(l => l.includes('[MultiSelect]'));
    console.log('MultiSelect logs:', multiSelectLogs);
    console.log('All console errors:', consoleLogs.filter(l => l.includes('error') || l.includes('Error')));

    // Action bar should be hidden (items moved, selection cleared)
    await expect(page.locator('.multi-select-action-bar')).not.toBeVisible({ timeout: 5000 });
  });

  test('should copy selected items to another section', async ({ page }) => {
    await ensureLoggedIn(page, token);
    await page.goto(`/invoices/${invoiceId}/edit`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(2000);
    await page.waitForSelector('.section-panel-header', { timeout: 20000 });
    await expandInvoiceSections(page, ['Demolition', 'Rebuild', 'Cleanup']);

    const table = page.locator('.invoice-items-table');
    await expect(table.first()).toBeVisible({ timeout: 10000 });

    // Select first item
    const checkboxes = page.locator('.invoice-items-table').first().locator('.ant-table-row .ant-checkbox-input');
    await checkboxes.nth(0).check({ force: true });
    await page.waitForTimeout(300);

    // Click "Copy to" button
    await page.locator('.multi-select-action-bar button:has-text("Copy")').click();
    await page.waitForTimeout(500);

    // Modal should appear
    const modal = page.locator('.ant-modal-content').filter({ hasText: 'Copy to Section' });
    await expect(modal).toBeVisible({ timeout: 5000 });

    // Click "Cleanup" in the modal section picker
    await page.locator('.ant-modal-body .section-picker-item').filter({ hasText: 'Cleanup' }).click();
    await page.waitForTimeout(1000);

    // Action bar should be hidden (selection cleared)
    await expect(page.locator('.multi-select-action-bar')).not.toBeVisible({ timeout: 5000 });
  });

  test('should clear selection with close button', async ({ page }) => {
    await ensureLoggedIn(page, token);
    await page.goto(`/invoices/${invoiceId}/edit`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(2000);
    await page.waitForSelector('.section-panel-header', { timeout: 20000 });
    await expandInvoiceSections(page, ['Demolition', 'Rebuild', 'Cleanup']);

    const table = page.locator('.invoice-items-table');
    await expect(table.first()).toBeVisible({ timeout: 10000 });

    // Select an item
    const checkboxes = page.locator('.invoice-items-table .ant-table-row .ant-checkbox-input');
    await checkboxes.nth(0).check({ force: true });
    await page.waitForTimeout(300);

    // Action bar appears
    await expect(page.locator('text=1 item selected')).toBeVisible({ timeout: 5000 });

    // Click close button in the action bar
    await page.locator('button .anticon-close').click();
    await page.waitForTimeout(300);

    // Action bar should disappear
    await expect(page.locator('text=item selected')).not.toBeVisible({ timeout: 3000 });
  });
});
