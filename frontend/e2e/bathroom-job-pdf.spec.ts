import { test, expect as baseExpect, Page } from '@playwright/test';

// A job with several bathrooms: the PDF shows them all (each on its own
// pages, the job costs on the bathroom that carries them) or one bathroom
// priced on its own, as if it were the only one. Each bathroom is shown by
// its restoration or one of its options. Runs against the dev server with
// /api answered here.

const expect = baseExpect.configure({ timeout: 20_000 });

const MASTER = '99999999-9999-9999-9999-999999999991';
const MASTER_B = '99999999-9999-9999-9999-999999999992';
const HALL = '99999999-9999-9999-9999-999999999993';
const POWDER = '99999999-9999-9999-9999-999999999994';

// As saved: the master carries the dumpster for both
const SAVED: Record<string, number> = { [MASTER]: 9200, [MASTER_B]: 12400, [HALL]: 6100 };
// On its own: the hall pays its own dumpster; the master's is smaller
const ALONE: Record<string, number> = { [MASTER]: 9000, [MASTER_B]: 12200, [HALL]: 6750 };

const estimate = (id: string, designation: string, extra: Record<string, unknown> = {}) => ({
  id, group_id: id, kind: 'restore', status: 'calculated', property_address: '12 Elm St', city: 'Rockville',
  state: 'MD', zip_code: '20850', designation, length_ft: 8, width_ft: 5, height_ft: 8,
  bathtub_spec: {}, shower_spec: {}, line_items: [], group_members: [], total: SAVED[id] ?? 0, ...extra,
});
const ESTIMATES: Record<string, any> = {
  [MASTER]: estimate(MASTER, 'master'),
  [MASTER_B]: estimate(MASTER_B, 'master', { group_id: MASTER, kind: 'option', option_label: 'Option B' }),
  [HALL]: estimate(HALL, 'hall'),
  [POWDER]: estimate(POWDER, 'powder', { status: 'draft' }),
};

const BATHROOMS = [
  {
    group_id: MASTER, name: 'Master Bathroom', estimate_id: MASTER, designation: 'master', total: 9200,
    calculated: true, alone: false,
    estimates: [
      { id: MASTER, kind: 'restore', option_label: null, total: 9200, calculated: true },
      { id: MASTER_B, kind: 'option', option_label: 'Option B', total: 12400, calculated: true },
    ],
  },
  {
    group_id: HALL, name: 'Hall Bathroom', estimate_id: HALL, designation: 'hall', total: 6100,
    calculated: true, alone: false,
    estimates: [{ id: HALL, kind: 'restore', option_label: null, total: 6100, calculated: true }],
  },
  {
    group_id: POWDER, name: 'Powder Room', estimate_id: POWDER, designation: 'powder', total: 0,
    calculated: false, alone: false,
    estimates: [{ id: POWDER, kind: 'restore', option_label: null, total: 0, calculated: false }],
  },
];

const NAMES: Record<string, string> = {
  [MASTER]: 'Master Bathroom', [MASTER_B]: 'Master Bathroom', [HALL]: 'Hall Bathroom',
};

async function open(page: Page, id: string) {
  const exported: any[] = [];
  const validated: string[] = [];
  await page.addInitScript(() => {
    localStorage.setItem('auth_token', 'test-token');
    localStorage.setItem('auth_user', JSON.stringify({ id: 'u1', username: 'admin', role: 'admin' }));
  });
  await page.route('**/api/**', route => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const json = (body: unknown) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    const job = path.match(/^\/api\/bathroom-estimates\/([\w-]+)\/bathrooms$/);
    if (job) return json(BATHROOMS.map((b) => ({ ...b, current: b.estimates.some((e) => e.id === job[1]) })));
    if (/\/bathrooms\/pdf-preview$/.test(path)) {
      const ids: string[] = request.postDataJSON().estimate_ids;
      const totals = ids.length > 1 ? SAVED : ALONE;
      const rows = ids.map((eid) => ({
        estimate_id: eid, name: NAMES[eid], option_label: ESTIMATES[eid].option_label ?? null,
        total: totals[eid], saved_total: SAVED[eid],
      }));
      return json({ bathrooms: rows, total: rows.reduce((s, r) => s + r.total, 0), carrier: ids.length > 1 ? 'Master Bathroom' : null });
    }
    const validate = path.match(/^\/api\/bathroom-estimates\/([\w-]+)\/export\/validate$/);
    if (validate) {
      validated.push(validate[1]);
      return json({ valid: validate[1] !== HALL, warnings: validate[1] === HALL ? ['Toilet: no brand/model specified.'] : [] });
    }
    if (/\/export\/bathrooms-pdf$/.test(path)) {
      exported.push({ from: path.split('/')[3], body: request.postDataJSON() });
      return route.fulfill({ status: 200, contentType: 'application/pdf', body: '%PDF-1.4\n%%EOF' });
    }
    const one = path.match(/^\/api\/bathroom-estimates\/([\w-]+)$/);
    if (one && ESTIMATES[one[1]]) return json(ESTIMATES[one[1]]);
    if (path === '/api/auth/me') return json({ id: 'u1', username: 'admin', role: 'admin', is_active: true });
    return json([]);
  });
  await page.goto(`/bathroom-estimates/${id}`, { timeout: 180_000 });
  return { exported, validated };
}

// Pick in an antd select: it opens by its box (its chosen value covers the
// input). Retried: a dropdown opened while the dialog is still animating in
// closes when the dialog takes focus.
async function choose(page: Page, scope: ReturnType<Page['getByRole']>, name: string, option: string | RegExp) {
  const box = scope.locator('.ant-select').filter({ has: page.getByRole('combobox', { name, exact: true }) });
  await expect(async () => {
    if (!(await page.locator('.ant-select-dropdown:visible').count())) await box.click();
    await page.locator('.ant-select-dropdown:visible .ant-select-item-option')
      .filter({ hasText: option }).click({ timeout: 2_000 });
  }).toPass();
}

async function pdfMenu(page: Page, item: string) {
  await page.getByRole('button', { name: /PDF/ }).first().hover();
  await page.getByRole('menuitem', { name: item }).click();
}

test('a PDF of every bathroom, each by the estimate picked', async ({ page }) => {
  const { exported, validated } = await open(page, HALL);
  await expect(page.locator('.be-bathroom-bar').getByText('Master Bathroom')).toBeVisible();

  await pdfMenu(page, 'PDF - Clean (no signature)');
  const dialog = page.getByRole('dialog', { name: 'PDF — Clean, no signature' });
  await expect(dialog.getByText('All bathrooms (2)')).toBeVisible();
  // The powder room isn't calculated: left out, and said so
  await expect(dialog.getByText('Not in it: Powder Room (not calculated)')).toBeVisible();
  const list = dialog.getByRole('list', { name: 'Bathrooms in the PDF' });
  await expect(list.getByText('$9,200.00')).toBeVisible();
  await expect(dialog.getByText('$15,300.00')).toBeVisible();
  await expect(dialog.getByText('Dumpster, permit, trip and lead RRP on the Master Bathroom.')).toBeVisible();

  // The master shown by its Option B
  await choose(page, dialog, 'Estimate for the Master Bathroom', /^Option B$/);
  await expect(list.getByText('$12,400.00')).toBeVisible();
  await expect(dialog.getByText('$18,500.00')).toBeVisible();
  await page.screenshot({ path: test.info().outputPath('all.png') });

  await dialog.getByRole('button', { name: 'Make PDF' }).click();
  // The hall's allowance warning, named by its bathroom
  const warn = page.getByRole('dialog', { name: 'Material Allowance Warnings' });
  await expect(warn.getByText('Hall Bathroom: Toilet: no brand/model specified.')).toBeVisible();
  expect(validated.sort()).toEqual([MASTER_B, HALL].sort());
  await warn.getByRole('button', { name: 'Export Anyway' }).click();

  await expect.poll(() => exported.length).toBe(1);
  expect(exported[0].from).toBe(HALL);
  expect(exported[0].body.estimate_ids).toEqual([MASTER_B, HALL]);
  expect(exported[0].body.show_signature).toBe(false);
  expect(exported[0].body.show_breakdown_prices).toBe(false);
});

test('one bathroom priced on its own, against its share of the job', async ({ page }) => {
  const { exported } = await open(page, HALL);
  await expect(page.locator('.be-bathroom-bar').getByText('Master Bathroom')).toBeVisible();

  await pdfMenu(page, 'PDF - Detailed (with signature)');
  const dialog = page.getByRole('dialog', { name: 'PDF — Detailed, with signature' });
  await dialog.getByText('One bathroom on its own').click();
  // The open bathroom first
  await expect(dialog.getByRole('combobox', { name: 'Bathroom', exact: true })).toBeVisible();
  await expect(dialog.locator('.ant-select-selection-item')).toHaveText('Hall Bathroom');
  await expect(dialog.getByText('$6,750.00')).toBeVisible();
  await expect(dialog.getByText('$6,100.00')).toBeVisible();
  await expect(dialog.getByText(/\$650\.00 more on its own/)).toBeVisible();
  await page.screenshot({ path: test.info().outputPath('one.png') });

  // The master on its own: its dumpster sized for it alone
  await choose(page, dialog, 'Bathroom', /^Master Bathroom$/);
  await expect(dialog.getByText('$9,000.00')).toBeVisible();
  await expect(dialog.getByText(/\$200\.00 less on its own/)).toBeVisible();

  await dialog.getByRole('button', { name: 'Make PDF' }).click();
  await expect.poll(() => exported.length).toBe(1);
  expect(exported[0].body.estimate_ids).toEqual([MASTER]);
  expect(exported[0].body.show_signature).toBe(true);
});
