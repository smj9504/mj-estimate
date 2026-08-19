/**
 * Estimate / Invoice line-item tables on mobile.
 *
 * The Description column used to be a fixed-left 200px ellipsis column inside
 * a horizontally scrolling table, so on a phone only a few characters of each
 * item description were readable. These specs pin the fix: the description
 * renders in full, the page does not overflow sideways, and the desktop
 * column layout is left alone.
 */

import { test, expect, Page } from '@playwright/test';
import {
  mockEstimateInvoiceApi,
  ESTIMATE_ID,
  INVOICE_ID,
  LONG_DESCRIPTION,
  SECOND_DESCRIPTION,
} from './fixtures/estimate-invoice-mock';

const ESTIMATE_TABLE = '.estimate-items-table';
const INVOICE_TABLE = '.invoice-items-table';

const isPhoneProject = () => (test.info().project.use.viewport?.width ?? 0) < 768;

/** Horizontal overflow of the document, in px. */
async function pageOverflow(page: Page) {
  return page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth
  );
}

/**
 * The description cell for a given item, asserted to hold the complete text
 * and to render it without clipping.
 */
async function expectDescriptionFullyVisible(page: Page, table: string, text: string) {
  const cell = page.locator(`${table} tbody tr.ant-table-row td`).filter({ hasText: text.slice(0, 24) }).first();
  await expect(cell).toBeVisible();

  // The whole description must be present, not an ellipsised prefix
  await expect(cell).toContainText(text);

  // ...and it must actually fit the cell rather than being cut off
  const clipped = await cell.evaluate((el) => {
    const target = el as HTMLElement;
    return target.scrollWidth > target.clientWidth + 1;
  });
  expect(clipped).toBe(false);
}

test.describe('Estimate items table — mobile', () => {
  test.beforeEach(async ({ page }) => {
    test.skip(!isPhoneProject(), 'phone-width project only');
    await mockEstimateInvoiceApi(page);
    await page.goto(`/edit/estimate/${ESTIMATE_ID}`);
    await page.locator(`${ESTIMATE_TABLE} tbody tr.ant-table-row`).first().waitFor({ timeout: 30_000 });
  });

  test('shows each item description in full', async ({ page }) => {
    await expectDescriptionFullyVisible(page, ESTIMATE_TABLE, LONG_DESCRIPTION);
    await expectDescriptionFullyVisible(page, ESTIMATE_TABLE, SECOND_DESCRIPTION);
  });

  test('keeps qty, rate and amount readable alongside the description', async ({ page }) => {
    const row = page.locator(`${ESTIMATE_TABLE} tbody tr.ant-table-row`).first();
    await expect(row).toContainText('120 SF');
    await expect(row).toContainText('$8.50');
    await expect(row).toContainText('$1,020.00');
  });

  test('the page does not scroll horizontally', async ({ page }) => {
    expect(await pageOverflow(page)).toBeLessThanOrEqual(1);
  });

  test('the item table itself does not scroll horizontally', async ({ page }) => {
    const overflow = await page.locator(`${ESTIMATE_TABLE} .ant-table-content`).evaluate(
      (el) => el.scrollWidth - el.clientWidth
    );
    expect(overflow).toBeLessThanOrEqual(1);
  });

  test('edit and delete stay reachable on every row', async ({ page }) => {
    const viewport = page.viewportSize()!;
    const buttons = page.locator(`${ESTIMATE_TABLE} tbody tr button`);
    const count = await buttons.count();
    expect(count).toBeGreaterThan(0);

    for (let i = 0; i < count; i++) {
      const box = await buttons.nth(i).boundingBox();
      expect(box, `button ${i} has no box`).not.toBeNull();
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width + 1);
    }
  });
});

test.describe('Invoice items table — mobile', () => {
  test.beforeEach(async ({ page }) => {
    test.skip(!isPhoneProject(), 'phone-width project only');
    await mockEstimateInvoiceApi(page);
    await page.goto(`/invoices/${INVOICE_ID}/edit`);
    await page.locator(`${INVOICE_TABLE} tbody tr.ant-table-row`).first().waitFor({ timeout: 30_000 });
  });

  test('shows each item description in full', async ({ page }) => {
    await expectDescriptionFullyVisible(page, INVOICE_TABLE, LONG_DESCRIPTION);
    await expectDescriptionFullyVisible(page, INVOICE_TABLE, SECOND_DESCRIPTION);
  });

  test('the page does not scroll horizontally', async ({ page }) => {
    expect(await pageOverflow(page)).toBeLessThanOrEqual(1);
  });

  test('section header actions stay within the viewport', async ({ page }) => {
    const viewport = page.viewportSize()!;
    const buttons = page.locator('.section-panel-header button');
    const count = await buttons.count();
    expect(count).toBeGreaterThan(0);

    for (let i = 0; i < count; i++) {
      const box = await buttons.nth(i).boundingBox();
      if (!box) continue; // collapsed/hidden controls are not a failure
      expect(box.x + box.width).toBeLessThanOrEqual(viewport.width + 1);
    }
  });
});

test.describe('Estimate items table — desktop is unaffected', () => {
  test.beforeEach(async ({ page }) => {
    test.skip(isPhoneProject(), 'desktop/tablet project only');
    await mockEstimateInvoiceApi(page);
    await page.goto(`/edit/estimate/${ESTIMATE_ID}`);
    await page.locator(`${ESTIMATE_TABLE} tbody tr.ant-table-row`).first().waitFor({ timeout: 30_000 });
  });

  test('keeps the separate numeric columns', async ({ page }) => {
    const head = page.locator(`${ESTIMATE_TABLE} thead`);
    await expect(head).toContainText('Qty');
    await expect(head).toContainText('Unit');
    await expect(head).toContainText('Rate');
    await expect(head).toContainText('Total');
  });

  test('keeps bulk selection checkboxes', async ({ page }) => {
    await expect(
      page.locator(`${ESTIMATE_TABLE} tbody tr.ant-table-row input[type="checkbox"]`).first()
    ).toBeVisible();
  });
});
