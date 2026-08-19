/**
 * Network fixture for the Estimate / Invoice line-item table tests.
 *
 * These screens are pure front-end layout, so the tests stub the API rather
 * than requiring a live backend and a seeded database. The estimate and the
 * invoice both carry deliberately long item descriptions — the whole point of
 * the assertions is that a long description stays readable on a phone.
 */

import type { Page, Route } from '@playwright/test';

export const ESTIMATE_ID = '33333333-3333-3333-3333-333333333333';
export const INVOICE_ID = '44444444-4444-4444-4444-444444444444';

/** Long enough that the old fixed 200px column clipped it after a few words. */
export const LONG_DESCRIPTION =
  'Floor Tile, porcelain 12x24 set in thinset over cement backer board, including grout, sealer and edge trim';
export const SECOND_DESCRIPTION =
  'Ceiling & Wall paint, two coats over primer with cut-in at trim and full masking of fixtures';

const USER = {
  id: '99999999-9999-9999-9999-999999999999',
  username: 'admin',
  email: 'admin@example.com',
  full_name: 'Admin',
  role: 'admin',
  is_active: true,
  is_superuser: true,
};

const COMPANY = {
  id: '55555555-5555-5555-5555-555555555555',
  name: 'MJ Restoration',
  address: '123 Main St',
  city: 'Dallas',
  state: 'TX',
  zipcode: '75201',
  phone: '555-0100',
  email: 'info@example.com',
};

/**
 * Backend item shape. Both APIs return a flat `items` array plus section
 * metadata; the client regroups them by `primary_group`.
 */
function backendItem(overrides: Record<string, unknown> = {}) {
  return {
    id: 'item-1',
    name: 'Floor Tile',
    description: LONG_DESCRIPTION,
    quantity: 120,
    unit: 'SF',
    rate: 8.5,
    amount: 1020,
    taxable: true,
    primary_group: SECTION_TITLE,
    sort_order: 0,
    ...overrides,
  };
}

export const SECTION_TITLE = 'Tile & Flooring & Paint';

const ITEMS = [
  backendItem(),
  backendItem({
    id: 'item-2',
    name: 'Ceiling & Wall',
    description: SECOND_DESCRIPTION,
    quantity: 800,
    unit: 'SF',
    rate: 1.25,
    amount: 1000,
    sort_order: 1,
  }),
];

const ESTIMATE = {
  id: ESTIMATE_ID,
  estimate_number: 'EST-0001',
  estimate_type: 'standard',
  status: 'draft',
  company_id: COMPANY.id,
  company_name: COMPANY.name,
  client_name: 'Jane Doe',
  client_address: '456 Oak Ave',
  estimate_date: '2026-01-05',
  tax_rate: 8.25,
  tax_method: 'percentage',
  op_percent: 0,
  subtotal: 2020,
  total_amount: 2186.65,
  items: ITEMS,
  // Section metadata; items are grouped back in by primary_group
  sections_data: [
    { id: 'section-1', title: SECTION_TITLE, order: 0, showSubtotal: true, taxable: true },
  ],
  created_at: '2026-01-05T00:00:00Z',
};

const INVOICE = {
  id: INVOICE_ID,
  invoice_number: 'INV-0001',
  status: 'draft',
  company_id: COMPANY.id,
  client_name: 'Jane Doe',
  invoice_date: '2026-01-05',
  tax_rate: 8.25,
  tax_method: 'percentage',
  subtotal: 2020,
  total_amount: 2186.65,
  items: ITEMS,
  sections: [
    { id: 'section-1', title: SECTION_TITLE, order: 0, showSubtotal: true, taxable: true },
  ],
  created_at: '2026-01-05T00:00:00Z',
};

const json = (route: Route, body: unknown, status = 200) =>
  route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

/** Install the auth session and the stubbed API. Call before `page.goto`. */
export async function mockEstimateInvoiceApi(page: Page) {
  await page.addInitScript(
    ([user]) => {
      localStorage.setItem('auth_token', 'e2e-test-token');
      localStorage.setItem('auth_user', JSON.stringify(user));
    },
    [USER]
  );

  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;

    if (path.endsWith('/api/auth/me')) return json(route, USER);
    // Companies come back paginated: the client reads `.items`
    if (path.includes('/api/companies')) return json(route, { items: [COMPANY], total: 1 });
    if (path.includes('/api/estimates/generate-number')) {
      return json(route, { estimate_number: 'EST-0002' });
    }
    if (path.includes(`/api/estimates/${ESTIMATE_ID}`)) return json(route, ESTIMATE);
    if (path.includes(`/api/invoices/${INVOICE_ID}`)) return json(route, INVOICE);

    // Anything else the page polls: an empty list keeps an unmocked call from
    // failing a test for the wrong reason.
    return json(route, []);
  });
}
