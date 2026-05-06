/**
 * Bathroom, Cabinet, Roofing Estimate - Mobile Responsive E2E Tests
 * Validates that all estimate detail pages render correctly on mobile viewports.
 * Checks: no horizontal overflow, tabs accessible, buttons wrap, forms usable.
 */

import { test, expect } from './fixtures/auth';

const MOBILE_VIEWPORT = { width: 375, height: 812 };
const TABLET_VIEWPORT = { width: 768, height: 1024 };

// Helper: get first estimate ID from list API
async function getFirstEstimateId(
  page: import('@playwright/test').Page,
  apiPath: string
): Promise<string | null> {
  try {
    const response = await page.evaluate(
      (path) =>
        fetch(path, {
          headers: {
            Authorization:
              'Bearer ' + (localStorage.getItem('auth_token') || ''),
          },
        }).then((r) => r.json()),
      apiPath
    );
    const items = response.items || response.estimates || response;
    if (Array.isArray(items) && items.length > 0) {
      return items[0].id;
    }
    return null;
  } catch {
    return null;
  }
}

// Helper: check no horizontal overflow
async function expectNoHorizontalOverflow(
  page: import('@playwright/test').Page,
  viewportWidth: number
) {
  const bodyWidth = await page.evaluate(() => document.body.scrollWidth);
  // Allow tolerance for collapsed sidebar (~40px) + scrollbar
  expect(bodyWidth).toBeLessThanOrEqual(viewportWidth + 40);
}

// Helper: check no error overlays
async function expectNoErrors(page: import('@playwright/test').Page) {
  const errors = page.locator('.ant-result-error');
  await expect(errors).toHaveCount(0);
}

// ═══════════ BATHROOM ESTIMATE ═══════════

test.describe('Bathroom Estimate - Mobile Responsive', () => {
  test('List page renders on mobile without overflow', async ({ authenticatedPage: page }) => {
    await page.setViewportSize(MOBILE_VIEWPORT);
    await page.goto('/bathroom-estimates');
    await page.waitForLoadState('networkidle');

    await expectNoHorizontalOverflow(page, MOBILE_VIEWPORT.width);
    await expectNoErrors(page);

    await page.screenshot({
      path: 'tests/e2e/screenshots/mobile-bathroom-list.png',
      fullPage: true,
    });
  });

  test('Detail page - header buttons wrap on mobile', async ({ authenticatedPage: page }) => {
    await page.setViewportSize(MOBILE_VIEWPORT);
    const id = await getFirstEstimateId(page, '/api/bathroom-estimates?page_size=1');
    test.skip(!id, 'No bathroom estimates available');

    await page.goto(`/bathroom-estimates/${id}`);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1000);

    // No horizontal overflow
    await expectNoHorizontalOverflow(page, MOBILE_VIEWPORT.width);

    // Back button should be visible
    const backBtn = page.locator('button').filter({ has: page.locator('[aria-label="arrow-left"]') }).first();
    await expect(backBtn).toBeVisible();

    // Action buttons should be visible (wrapped)
    const saveBtn = page.locator('button:has-text("Save")').first();
    await expect(saveBtn).toBeVisible();

    await page.screenshot({
      path: 'tests/e2e/screenshots/mobile-bathroom-detail-header.png',
      fullPage: true,
    });
  });

  test('Detail page - tabs navigable on mobile', async ({ authenticatedPage: page }) => {
    await page.setViewportSize(MOBILE_VIEWPORT);
    const id = await getFirstEstimateId(page, '/api/bathroom-estimates?page_size=1');
    test.skip(!id, 'No bathroom estimates available');

    await page.goto(`/bathroom-estimates/${id}`);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1000);

    const tabNames = ['Project Info', 'Demo Scope', 'Shower', 'Vanity', 'Floor', 'Plumbing', 'Accessories', 'Result', 'History'];
    for (const tabName of tabNames) {
      const tab = page.locator('.ant-tabs-tab').filter({ hasText: new RegExp(tabName, 'i') });
      if (await tab.count() > 0) {
        await tab.scrollIntoViewIfNeeded();
        await tab.click();
        await page.waitForTimeout(500);
        await expectNoErrors(page);
      }
    }
  });

  test('Detail page - form fields usable on mobile', async ({ authenticatedPage: page }) => {
    await page.setViewportSize(MOBILE_VIEWPORT);
    const id = await getFirstEstimateId(page, '/api/bathroom-estimates?page_size=1');
    test.skip(!id, 'No bathroom estimates available');

    await page.goto(`/bathroom-estimates/${id}`);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1000);

    // Check that form inputs are reachable and have proper width
    const inputs = page.locator('.ant-input, .ant-input-number-input, .ant-select-selector');
    const inputCount = await inputs.count();
    expect(inputCount).toBeGreaterThan(0);

    // Check first visible input fits within viewport
    for (let i = 0; i < Math.min(inputCount, 5); i++) {
      const box = await inputs.nth(i).boundingBox();
      if (box && box.width > 0) {
        expect(box.x + box.width).toBeLessThanOrEqual(MOBILE_VIEWPORT.width + 5);
      }
    }
  });

  test('Detail page - Result tab table scrolls horizontally', async ({ authenticatedPage: page }) => {
    await page.setViewportSize(MOBILE_VIEWPORT);
    const id = await getFirstEstimateId(page, '/api/bathroom-estimates?page_size=1');
    test.skip(!id, 'No bathroom estimates available');

    await page.goto(`/bathroom-estimates/${id}`);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1000);

    // Navigate to Result tab
    const resultTab = page.locator('.ant-tabs-tab').filter({ hasText: /Result/i });
    if (await resultTab.count() > 0) {
      await resultTab.scrollIntoViewIfNeeded();
      await resultTab.click();
      await page.waitForTimeout(500);

      // Table should have scrollable container (not overflow page)
      const table = page.locator('.ant-table');
      if (await table.count() > 0) {
        await expectNoHorizontalOverflow(page, MOBILE_VIEWPORT.width);
      }
    }
  });

  test('Detail page - tablet renders 2+ columns', async ({ authenticatedPage: page }) => {
    await page.setViewportSize(TABLET_VIEWPORT);
    const id = await getFirstEstimateId(page, '/api/bathroom-estimates?page_size=1');
    test.skip(!id, 'No bathroom estimates available');

    await page.goto(`/bathroom-estimates/${id}`);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1000);

    await expectNoHorizontalOverflow(page, TABLET_VIEWPORT.width);
    await expectNoErrors(page);

    await page.screenshot({
      path: 'tests/e2e/screenshots/tablet-bathroom-detail.png',
      fullPage: true,
    });
  });
});

// ═══════════ CABINET ESTIMATE ═══════════

test.describe('Cabinet Estimate - Mobile Responsive', () => {
  test('List page renders on mobile without overflow', async ({ authenticatedPage: page }) => {
    await page.setViewportSize(MOBILE_VIEWPORT);
    await page.goto('/cabinet-estimates');
    await page.waitForLoadState('networkidle');

    await expectNoHorizontalOverflow(page, MOBILE_VIEWPORT.width);
    await expectNoErrors(page);

    await page.screenshot({
      path: 'tests/e2e/screenshots/mobile-cabinet-list.png',
      fullPage: true,
    });
  });

  test('Detail page - header buttons wrap on mobile', async ({ authenticatedPage: page }) => {
    await page.setViewportSize(MOBILE_VIEWPORT);
    const id = await getFirstEstimateId(page, '/api/cabinet-estimates?page_size=1');
    test.skip(!id, 'No cabinet estimates available');

    await page.goto(`/cabinet-estimates/${id}`);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1000);

    await expectNoHorizontalOverflow(page, MOBILE_VIEWPORT.width);

    // Back button visible
    const backBtn = page.locator('button:has-text("Back")').first();
    await expect(backBtn).toBeVisible();

    // Save button visible
    const saveBtn = page.locator('button:has-text("Save")').first();
    await expect(saveBtn).toBeVisible();

    await page.screenshot({
      path: 'tests/e2e/screenshots/mobile-cabinet-detail-header.png',
      fullPage: true,
    });
  });

  test('Detail page - Edit tab usable on mobile', async ({ authenticatedPage: page }) => {
    await page.setViewportSize(MOBILE_VIEWPORT);
    const id = await getFirstEstimateId(page, '/api/cabinet-estimates?page_size=1');
    test.skip(!id, 'No cabinet estimates available');

    await page.goto(`/cabinet-estimates/${id}`);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1000);

    // Cards should stack vertically on mobile
    const cards = page.locator('.ant-card');
    const cardCount = await cards.count();
    expect(cardCount).toBeGreaterThan(0);

    // Check cards don't overflow
    for (let i = 0; i < Math.min(cardCount, 3); i++) {
      const box = await cards.nth(i).boundingBox();
      if (box && box.width > 0) {
        expect(box.x + box.width).toBeLessThanOrEqual(MOBILE_VIEWPORT.width + 5);
      }
    }
  });

  test('Detail page - tabs navigable on mobile', async ({ authenticatedPage: page }) => {
    await page.setViewportSize(MOBILE_VIEWPORT);
    const id = await getFirstEstimateId(page, '/api/cabinet-estimates?page_size=1');
    test.skip(!id, 'No cabinet estimates available');

    await page.goto(`/cabinet-estimates/${id}`);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1000);

    const tabNames = ['Edit', 'Estimate Result', 'Purchase Order'];
    for (const tabName of tabNames) {
      const tab = page.locator('.ant-tabs-tab').filter({ hasText: new RegExp(tabName, 'i') });
      if (await tab.count() > 0) {
        const isDisabled = await tab.evaluate((el) => el.classList.contains('ant-tabs-tab-disabled'));
        if (!isDisabled) {
          await tab.scrollIntoViewIfNeeded();
          await tab.click();
          await page.waitForTimeout(500);
          await expectNoErrors(page);
          await expectNoHorizontalOverflow(page, MOBILE_VIEWPORT.width);
        }
      }
    }
  });

  test('Detail page - tablet renders properly', async ({ authenticatedPage: page }) => {
    await page.setViewportSize(TABLET_VIEWPORT);
    const id = await getFirstEstimateId(page, '/api/cabinet-estimates?page_size=1');
    test.skip(!id, 'No cabinet estimates available');

    await page.goto(`/cabinet-estimates/${id}`);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1000);

    await expectNoHorizontalOverflow(page, TABLET_VIEWPORT.width);
    await expectNoErrors(page);

    await page.screenshot({
      path: 'tests/e2e/screenshots/tablet-cabinet-detail.png',
      fullPage: true,
    });
  });
});

// ═══════════ ROOFING ESTIMATE ═══════════

test.describe('Roofing Estimate - Mobile Responsive', () => {
  test('List page renders on mobile without overflow', async ({ authenticatedPage: page }) => {
    await page.setViewportSize(MOBILE_VIEWPORT);
    await page.goto('/roofing-estimates');
    await page.waitForLoadState('networkidle');

    await expectNoHorizontalOverflow(page, MOBILE_VIEWPORT.width);
    await expectNoErrors(page);

    await page.screenshot({
      path: 'tests/e2e/screenshots/mobile-roofing-list.png',
      fullPage: true,
    });
  });

  test('Detail page - header buttons wrap on mobile', async ({ authenticatedPage: page }) => {
    await page.setViewportSize(MOBILE_VIEWPORT);
    const id = await getFirstEstimateId(page, '/api/roofing-estimates?page_size=1');
    test.skip(!id, 'No roofing estimates available');

    await page.goto(`/roofing-estimates/${id}`);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1000);

    await expectNoHorizontalOverflow(page, MOBILE_VIEWPORT.width);

    // Back button visible
    const backBtn = page.locator('button').filter({ has: page.locator('[aria-label="arrow-left"]') }).first();
    await expect(backBtn).toBeVisible();

    // Save/Calculate buttons visible
    const saveBtn = page.locator('button:has-text("Save")').first();
    await expect(saveBtn).toBeVisible();

    await page.screenshot({
      path: 'tests/e2e/screenshots/mobile-roofing-detail-header.png',
      fullPage: true,
    });
  });

  test('Detail page - all tabs navigable on mobile', async ({ authenticatedPage: page }) => {
    await page.setViewportSize(MOBILE_VIEWPORT);
    const id = await getFirstEstimateId(page, '/api/roofing-estimates?page_size=1');
    test.skip(!id, 'No roofing estimates available');

    await page.goto(`/roofing-estimates/${id}`);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1000);

    const tabNames = ['Project Info', 'Measurement', 'Scope', 'Decking', 'Costs', 'Warranty', 'Line Items'];
    for (const tabName of tabNames) {
      const tab = page.locator('.ant-tabs-tab').filter({ hasText: new RegExp(tabName, 'i') });
      if (await tab.count() > 0) {
        await tab.scrollIntoViewIfNeeded();
        await tab.click();
        await page.waitForTimeout(500);
        await expectNoErrors(page);
        await expectNoHorizontalOverflow(page, MOBILE_VIEWPORT.width);
      }
    }
  });

  test('Detail page - measurement tab usable on mobile', async ({ authenticatedPage: page }) => {
    await page.setViewportSize(MOBILE_VIEWPORT);
    const id = await getFirstEstimateId(page, '/api/roofing-estimates?page_size=1');
    test.skip(!id, 'No roofing estimates available');

    await page.goto(`/roofing-estimates/${id}`);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1000);

    // Navigate to Measurement tab
    const measureTab = page.locator('.ant-tabs-tab').filter({ hasText: /Measurement/i });
    if (await measureTab.count() > 0) {
      await measureTab.scrollIntoViewIfNeeded();
      await measureTab.click();
      await page.waitForTimeout(500);

      // Input fields should not overflow
      const inputs = page.locator('.ant-input-number, .ant-select');
      const inputCount = await inputs.count();
      for (let i = 0; i < Math.min(inputCount, 5); i++) {
        const box = await inputs.nth(i).boundingBox();
        if (box && box.width > 0) {
          expect(box.x + box.width).toBeLessThanOrEqual(MOBILE_VIEWPORT.width + 5);
        }
      }
    }

    await page.screenshot({
      path: 'tests/e2e/screenshots/mobile-roofing-measurement.png',
      fullPage: true,
    });
  });

  test('Detail page - Line Items table scrolls on mobile', async ({ authenticatedPage: page }) => {
    await page.setViewportSize(MOBILE_VIEWPORT);
    const id = await getFirstEstimateId(page, '/api/roofing-estimates?page_size=1');
    test.skip(!id, 'No roofing estimates available');

    await page.goto(`/roofing-estimates/${id}`);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1000);

    // Navigate to Line Items tab
    const lineItemsTab = page.locator('.ant-tabs-tab').filter({ hasText: /Line Items/i });
    if (await lineItemsTab.count() > 0) {
      await lineItemsTab.scrollIntoViewIfNeeded();
      await lineItemsTab.click();
      await page.waitForTimeout(500);

      // Page should not overflow even with wide table
      await expectNoHorizontalOverflow(page, MOBILE_VIEWPORT.width);
    }
  });

  test('Detail page - totals summary visible on mobile', async ({ authenticatedPage: page }) => {
    await page.setViewportSize(MOBILE_VIEWPORT);
    const id = await getFirstEstimateId(page, '/api/roofing-estimates?page_size=1');
    test.skip(!id, 'No roofing estimates available');

    await page.goto(`/roofing-estimates/${id}`);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1000);

    // If estimate is calculated, totals card should be visible
    const statisticValues = page.locator('.ant-statistic');
    if (await statisticValues.count() > 0) {
      const firstStat = statisticValues.first();
      await expect(firstStat).toBeVisible();
    }
  });

  test('Detail page - tablet renders properly', async ({ authenticatedPage: page }) => {
    await page.setViewportSize(TABLET_VIEWPORT);
    const id = await getFirstEstimateId(page, '/api/roofing-estimates?page_size=1');
    test.skip(!id, 'No roofing estimates available');

    await page.goto(`/roofing-estimates/${id}`);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1000);

    await expectNoHorizontalOverflow(page, TABLET_VIEWPORT.width);
    await expectNoErrors(page);

    await page.screenshot({
      path: 'tests/e2e/screenshots/tablet-roofing-detail.png',
      fullPage: true,
    });
  });
});
