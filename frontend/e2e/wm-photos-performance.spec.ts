import { test, expect, Page } from '@playwright/test';

/**
 * Water Mitigation Photos Tab - Performance Test Suite
 *
 * Run: npx playwright test e2e/wm-photos-performance.spec.ts --reporter=list
 */

const BASE_URL = 'http://localhost:3000';
const TEST_JOB_ID = 'f0bb3961-d142-428a-8f0c-85e5d078a61d';

async function ensureLoggedIn(page: Page) {
  // Login via API and set token directly in localStorage (most reliable)
  const loginResponse = await page.request.post('http://localhost:8000/api/auth/login', {
    data: { username: 'admin', password: 'admin123' },
  });

  if (loginResponse.ok()) {
    const data = await loginResponse.json();
    const token = data.access_token;

    // Navigate to app and set token in localStorage
    await page.goto(BASE_URL, { timeout: 60000 });
    await page.evaluate((t) => {
      localStorage.setItem('auth_token', t);
      localStorage.setItem('auth_user', JSON.stringify({ username: 'admin', role: 'admin' }));
    }, token);

    // Reload to apply auth state
    await page.reload({ timeout: 60000 });
    await page.waitForTimeout(2000);
  } else {
    // Fallback: UI login
    await page.goto(`${BASE_URL}/login`, { timeout: 60000 });
    await page.waitForTimeout(5000);

    const initBtn = page.locator('button', { hasText: 'Initialize Admin' });
    if (await initBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      await initBtn.click();
      await page.waitForTimeout(3000);
    }

    const usernameInput = page.locator('input[placeholder*="Username"]').first();
    await usernameInput.waitFor({ state: 'visible', timeout: 10000 });
    await usernameInput.fill('admin');
    await page.locator('input[placeholder*="Password"]').first().fill('admin123');
    await page.locator('button').filter({ hasText: /sign in/i }).first().click();
    await page.waitForTimeout(5000);
  }
}

async function goToPhotosTab(page: Page) {
  await page.goto(`${BASE_URL}/water-mitigation/${TEST_JOB_ID}`, {
    timeout: 60000,
  });

  // Wait for page content (tabs) - may take long due to remote DB
  await page.waitForSelector('.ant-tabs-tab', { timeout: 60000 });

  // Click Photos tab
  const photosTab = page.locator('.ant-tabs-tab').filter({ hasText: /photo/i }).first();
  if (await photosTab.isVisible({ timeout: 5000 }).catch(() => false)) {
    await photosTab.click();
    await page.waitForTimeout(500);
  }
}

// Use a shared auth state across tests
test.describe.serial('WM Photos Performance', () => {
  test.setTimeout(180000);

  test('0. Setup - Login', async ({ page }) => {
    await ensureLoggedIn(page);

    // Verify login worked by accessing a protected page
    await page.goto(`${BASE_URL}/water-mitigation/${TEST_JOB_ID}`, { timeout: 60000 });
    await page.waitForTimeout(5000);

    // Should not be on login page
    expect(page.url()).not.toContain('/login');
    console.log('\n=== Login successful ===');
  });

  test('1. Measure first photo visible time', async ({ page }) => {
    await ensureLoggedIn(page);

    const startTime = Date.now();
    await goToPhotosTab(page);

    // Wait for grid items
    await page.waitForSelector('.file-grid-item', { timeout: 60000 }).catch(() => null);
    const renderTime = Date.now() - startTime;

    const gridItems = await page.locator('.file-grid-item').count();
    console.log(`\n=== First Photo Visible ===`);
    console.log(`  Time: ${renderTime}ms`);
    console.log(`  Grid items: ${gridItems}`);

    await page.screenshot({ path: 'e2e/screenshots/wm-photos-loaded.png', fullPage: false });
  });

  test('2. Measure cached reload (immediate second visit)', async ({ page }) => {
    await ensureLoggedIn(page);

    // First load
    const t1 = Date.now();
    await goToPhotosTab(page);
    await page.waitForSelector('.file-grid-item', { timeout: 60000 }).catch(() => null);
    await page.waitForTimeout(2000);
    const firstLoad = Date.now() - t1;
    const firstCount = await page.locator('.file-grid-item').count();

    // Navigate away briefly
    await page.goto(`${BASE_URL}/water-mitigation`, { timeout: 60000 });
    await page.waitForTimeout(2000);

    // Second load (React Query cache + backend in-memory cache active)
    const t2 = Date.now();
    await goToPhotosTab(page);
    await page.waitForSelector('.file-grid-item', { timeout: 60000 }).catch(() => null);
    await page.waitForTimeout(2000);
    const secondLoad = Date.now() - t2;
    const secondCount = await page.locator('.file-grid-item').count();

    console.log('\n=== Cached vs Uncached ===');
    console.log(`  First load:  ${firstLoad}ms (${firstCount} items)`);
    console.log(`  Second load: ${secondLoad}ms (${secondCount} items)`);
    if (firstLoad > 0) {
      const pct = ((firstLoad - secondLoad) / firstLoad * 100);
      console.log(`  Improvement: ${pct.toFixed(0)}%`);
    }
  });

  test('3. Performance summary', async ({ page }) => {
    await ensureLoggedIn(page);
    await goToPhotosTab(page);

    await page.waitForSelector('.file-grid-item', { timeout: 60000 }).catch(() => null);
    await page.waitForTimeout(5000);

    const perfMetrics = await page.evaluate(() => {
      const entries = performance.getEntriesByType('resource') as PerformanceResourceTiming[];
      const imageEntries = entries.filter(e =>
        e.name.includes('/preview') || (e.name.includes('/photos/') && e.initiatorType === 'img')
      );

      return {
        totalResources: entries.length,
        imageRequests: imageEntries.length,
        avgImageDuration: imageEntries.length > 0
          ? imageEntries.reduce((sum, e) => sum + e.duration, 0) / imageEntries.length
          : 0,
        maxImageDuration: imageEntries.length > 0
          ? Math.max(...imageEntries.map(e => e.duration))
          : 0,
        totalTransferred: imageEntries.reduce((sum, e) => sum + (e.transferSize || 0), 0),
      };
    });

    const gridCount = await page.locator('.file-grid-item').count();

    console.log('\n========================================');
    console.log('  WM PHOTOS PERFORMANCE SUMMARY');
    console.log('========================================');
    console.log(`  Photos displayed: ${gridCount}`);
    console.log(`  Image requests: ${perfMetrics.imageRequests}`);
    console.log(`  Avg image load: ${perfMetrics.avgImageDuration.toFixed(0)}ms`);
    console.log(`  Max image load: ${perfMetrics.maxImageDuration.toFixed(0)}ms`);
    console.log(`  Total transferred: ${(perfMetrics.totalTransferred / 1024).toFixed(0)}KB`);
    console.log('========================================');

    await page.screenshot({ path: 'e2e/screenshots/wm-photos-final.png', fullPage: false });
  });
});
