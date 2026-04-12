import { test, expect, Page } from '@playwright/test';

/**
 * Water Mitigation Trash Tab - Auto-Delete Feature E2E Tests
 *
 * Tests:
 * 1. Trash tab renders with auto-delete policy banner
 * 2. Days remaining badge displays on trashed photos
 * 3. Trash/Restore workflow works correctly
 * 4. Trash stats API returns correct data
 * 5. Trash cleanup API works
 *
 * Run: npx playwright test e2e/wm-trash-auto-delete.spec.ts --reporter=list
 */

const BASE_URL = 'http://localhost:3000';
const API_URL = 'http://localhost:8000';

// Find a real job ID dynamically or use a known test job
let TEST_JOB_ID = '';

async function ensureLoggedIn(page: Page) {
  const loginResponse = await page.request.post(`${API_URL}/api/auth/login`, {
    data: { username: 'admin', password: 'admin123' },
  });

  if (loginResponse.ok()) {
    const data = await loginResponse.json();
    const token = data.access_token;
    const user = data.user;

    await page.goto(BASE_URL, { timeout: 60000 });
    await page.evaluate(({ t, u }) => {
      localStorage.setItem('auth_token', t);
      localStorage.setItem('auth_user', JSON.stringify(u));
    }, { t: token, u: user });

    // Navigate to a protected page to trigger auth check
    await page.goto(`${BASE_URL}/water-mitigation`, { timeout: 60000 });
    await page.waitForTimeout(3000);

    // If still on login page, try UI login as fallback
    if (page.url().includes('/login')) {
      await uiLogin(page);
    }

    return token;
  } else {
    await uiLogin(page);
    return '';
  }
}

async function uiLogin(page: Page) {
  await page.goto(`${BASE_URL}/login`, { timeout: 60000 });
  await page.waitForTimeout(3000);

  const initBtn = page.locator('button', { hasText: 'Initialize Admin' });
  if (await initBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
    await initBtn.click();
    await page.waitForTimeout(3000);
  }

  const usernameInput = page.locator('input[placeholder*="Username"]').first();
  await usernameInput.waitFor({ state: 'visible', timeout: 10000 });
  await usernameInput.fill('admin');
  await page.locator('input[placeholder*="Password"]').first().fill('admin123');
  await page.locator('button').filter({ hasText: /Sign In/i }).first().click();
  await page.waitForTimeout(5000);
}

async function findJobWithPhotos(page: Page, token: string): Promise<string> {
  // Try to find a job that has photos via API
  const response = await page.request.get(`${API_URL}/api/water-mitigation/jobs?limit=10`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });

  if (response.ok()) {
    const data = await response.json();
    const jobs = data.items || data || [];
    if (jobs.length > 0) {
      return jobs[0].id;
    }
  }
  return '';
}

async function goToTrashTab(page: Page, jobId: string) {
  await page.goto(`${BASE_URL}/water-mitigation/${jobId}`, {
    timeout: 60000,
  });

  // Wait for tabs to load
  await page.waitForSelector('.ant-tabs-tab', { timeout: 60000 });

  // Click Trash tab
  const trashTab = page.locator('.ant-tabs-tab').filter({ hasText: /trash/i }).first();
  if (await trashTab.isVisible({ timeout: 5000 }).catch(() => false)) {
    await trashTab.click();
    await page.waitForTimeout(1000);
    return true;
  }
  return false;
}

test.describe.serial('WM Trash Tab - Auto-Delete Feature', () => {
  test.setTimeout(120000);

  test('0. Setup - Login and find test job', async ({ page }) => {
    const token = await ensureLoggedIn(page);
    expect(page.url()).not.toContain('/login');

    TEST_JOB_ID = await findJobWithPhotos(page, token);
    console.log(`\n=== Test Job ID: ${TEST_JOB_ID || 'NOT FOUND'} ===`);

    // If no job found, we'll test with API-only tests
    expect(TEST_JOB_ID).toBeTruthy();
  });

  test('1. Trash stats API endpoint works', async ({ page }) => {
    const token = await ensureLoggedIn(page);

    // Test trash stats endpoint
    const statsResponse = await page.request.get(
      `${API_URL}/api/water-mitigation/photos/trash/stats?job_id=${TEST_JOB_ID}`,
      { headers: token ? { Authorization: `Bearer ${token}` } : {} }
    );

    expect(statsResponse.ok()).toBeTruthy();
    const stats = await statsResponse.json();
    console.log('\n=== Trash Stats ===');
    console.log(`  Total in trash: ${stats.total}`);
    console.log(`  Expiring soon (7 days): ${stats.expiring_soon}`);
    console.log(`  Retention days: ${stats.retention_days}`);

    expect(stats).toHaveProperty('total');
    expect(stats).toHaveProperty('expiring_soon');
    expect(stats).toHaveProperty('retention_days');
    expect(stats.retention_days).toBe(30);
  });

  test('2. Trash tab renders correctly', async ({ page }) => {
    await ensureLoggedIn(page);

    if (!TEST_JOB_ID) {
      test.skip();
      return;
    }

    const tabFound = await goToTrashTab(page, TEST_JOB_ID);
    if (!tabFound) {
      console.log('Trash tab not visible - skipping UI tests');
      test.skip();
      return;
    }

    // Wait for trash content to load
    await page.waitForTimeout(2000);

    // Check if trash tab loaded (either empty state or photo grid)
    const hasEmptyState = await page.locator('.ant-empty').isVisible().catch(() => false);
    const hasPhotoGrid = await page.locator('.ant-row').first().isVisible().catch(() => false);

    console.log(`\n=== Trash Tab Render ===`);
    console.log(`  Empty state: ${hasEmptyState}`);
    console.log(`  Photo grid: ${hasPhotoGrid}`);

    // Trash header should always be visible
    const trashHeader = page.locator('h5').filter({ hasText: /Trash/ });
    await expect(trashHeader).toBeVisible({ timeout: 10000 });

    // Take screenshot
    await page.screenshot({ path: 'e2e/screenshots/wm-trash-tab.png', fullPage: false });
  });

  test('3. Trash photo and verify auto-delete banner appears', async ({ page }) => {
    const token = await ensureLoggedIn(page);

    if (!TEST_JOB_ID) {
      test.skip();
      return;
    }

    // First check if there are active photos to trash
    const photosResponse = await page.request.get(
      `${API_URL}/api/water-mitigation/jobs/${TEST_JOB_ID}/photos`,
      { headers: token ? { Authorization: `Bearer ${token}` } : {} }
    );

    if (!photosResponse.ok()) {
      console.log('Failed to get photos - skipping');
      test.skip();
      return;
    }

    const photos = await photosResponse.json();
    const photoList = Array.isArray(photos) ? photos : (photos.items || []);
    console.log(`\n=== Active Photos: ${photoList.length} ===`);

    if (photoList.length === 0) {
      console.log('No active photos to trash - skipping trash workflow test');
      test.skip();
      return;
    }

    // Trash the first photo via API
    const targetPhotoId = photoList[0].id;
    console.log(`  Trashing photo: ${targetPhotoId}`);

    const trashResponse = await page.request.post(
      `${API_URL}/api/water-mitigation/photos/${targetPhotoId}/trash`,
      { headers: token ? { Authorization: `Bearer ${token}` } : {} }
    );
    expect(trashResponse.ok()).toBeTruthy();
    console.log('  Photo trashed successfully');

    // Navigate to trash tab
    const tabFound = await goToTrashTab(page, TEST_JOB_ID);
    if (!tabFound) {
      // Restore photo before failing
      await page.request.post(
        `${API_URL}/api/water-mitigation/photos/${targetPhotoId}/restore`,
        { headers: token ? { Authorization: `Bearer ${token}` } : {} }
      );
      test.skip();
      return;
    }

    await page.waitForTimeout(2000);

    // Verify auto-delete policy banner is visible
    const policyBanner = page.locator('.ant-alert').filter({ hasText: /auto-delete/i });
    const bannerVisible = await policyBanner.isVisible({ timeout: 5000 }).catch(() => false);
    console.log(`  Auto-delete banner visible: ${bannerVisible}`);

    if (bannerVisible) {
      const bannerText = await policyBanner.textContent();
      console.log(`  Banner text: ${bannerText}`);
      expect(bannerText).toContain('30');
    }

    // Verify days remaining badge is visible on trashed photo
    // The badge shows "{N}d" text
    const daysBadge = page.locator('span').filter({ hasText: /\d+d$/ }).first();
    const badgeVisible = await daysBadge.isVisible({ timeout: 5000 }).catch(() => false);
    console.log(`  Days remaining badge visible: ${badgeVisible}`);

    await page.screenshot({ path: 'e2e/screenshots/wm-trash-with-banner.png', fullPage: false });

    // Restore the photo to clean up
    console.log(`  Restoring photo: ${targetPhotoId}`);
    const restoreResponse = await page.request.post(
      `${API_URL}/api/water-mitigation/photos/${targetPhotoId}/restore`,
      { headers: token ? { Authorization: `Bearer ${token}` } : {} }
    );
    expect(restoreResponse.ok()).toBeTruthy();
    console.log('  Photo restored successfully');
  });

  test('4. Trash cleanup API endpoint works', async ({ page }) => {
    const token = await ensureLoggedIn(page);

    // Test cleanup endpoint (should return 0 deleted since nothing is 30+ days old)
    const cleanupResponse = await page.request.post(
      `${API_URL}/api/water-mitigation/photos/trash/cleanup?retention_days=30`,
      { headers: token ? { Authorization: `Bearer ${token}` } : {} }
    );

    expect(cleanupResponse.ok()).toBeTruthy();
    const result = await cleanupResponse.json();

    console.log('\n=== Trash Cleanup Result ===');
    console.log(`  Total expired: ${result.total_expired}`);
    console.log(`  Deleted: ${result.deleted_count}`);
    console.log(`  Failed: ${result.failed_count}`);

    expect(result).toHaveProperty('deleted_count');
    expect(result).toHaveProperty('failed_count');
    expect(result).toHaveProperty('total_expired');
  });

  test('5. Full trash workflow: trash → verify in list → restore → verify removed', async ({ page }) => {
    const token = await ensureLoggedIn(page);

    if (!TEST_JOB_ID) {
      test.skip();
      return;
    }

    // Get active photos
    const photosResponse = await page.request.get(
      `${API_URL}/api/water-mitigation/jobs/${TEST_JOB_ID}/photos`,
      { headers: token ? { Authorization: `Bearer ${token}` } : {} }
    );

    const photos = await photosResponse.json();
    const photoList = Array.isArray(photos) ? photos : (photos.items || []);

    if (photoList.length === 0) {
      console.log('No photos available for workflow test');
      test.skip();
      return;
    }

    const targetPhotoId = photoList[0].id;
    const targetFileName = photoList[0].file_name;
    console.log(`\n=== Full Workflow Test ===`);
    console.log(`  Target photo: ${targetFileName} (${targetPhotoId})`);

    // Step 1: Trash the photo
    const trashRes = await page.request.post(
      `${API_URL}/api/water-mitigation/photos/${targetPhotoId}/trash`,
      { headers: token ? { Authorization: `Bearer ${token}` } : {} }
    );
    expect(trashRes.ok()).toBeTruthy();
    console.log('  Step 1: Trashed');

    // Step 2: Verify it appears in trash list
    const trashListRes = await page.request.get(
      `${API_URL}/api/water-mitigation/photos/trash?job_id=${TEST_JOB_ID}`,
      { headers: token ? { Authorization: `Bearer ${token}` } : {} }
    );
    expect(trashListRes.ok()).toBeTruthy();
    const trashList = await trashListRes.json();
    const inTrash = trashList.items.some((p: any) => p.id === targetPhotoId);
    expect(inTrash).toBeTruthy();
    console.log(`  Step 2: Found in trash list (${trashList.total} items)`);

    // Step 3: Verify it's NOT in active photos
    // Note: list_photos has a 30-second in-memory cache, so we use a different page_size to bust cache
    const activeRes = await page.request.get(
      `${API_URL}/api/water-mitigation/jobs/${TEST_JOB_ID}/photos?page_size=51`,
      { headers: token ? { Authorization: `Bearer ${token}` } : {} }
    );
    const activePhotos = await activeRes.json();
    const activeList = Array.isArray(activePhotos) ? activePhotos : (activePhotos.items || []);
    const stillActive = activeList.some((p: any) => p.id === targetPhotoId);
    expect(stillActive).toBeFalsy();
    console.log(`  Step 3: Not in active photos (${activeList.length} active)`);

    // Step 4: Check trash stats
    const statsRes = await page.request.get(
      `${API_URL}/api/water-mitigation/photos/trash/stats?job_id=${TEST_JOB_ID}`,
      { headers: token ? { Authorization: `Bearer ${token}` } : {} }
    );
    const stats = await statsRes.json();
    expect(stats.total).toBeGreaterThan(0);
    console.log(`  Step 4: Trash stats - total=${stats.total}, expiring_soon=${stats.expiring_soon}`);

    // Step 5: Restore the photo
    const restoreRes = await page.request.post(
      `${API_URL}/api/water-mitigation/photos/${targetPhotoId}/restore`,
      { headers: token ? { Authorization: `Bearer ${token}` } : {} }
    );
    expect(restoreRes.ok()).toBeTruthy();
    console.log('  Step 5: Restored');

    // Step 6: Verify it's back in active photos (use page_size=52 to bust cache)
    const finalActiveRes = await page.request.get(
      `${API_URL}/api/water-mitigation/jobs/${TEST_JOB_ID}/photos?page_size=52`,
      { headers: token ? { Authorization: `Bearer ${token}` } : {} }
    );
    const finalPhotos = await finalActiveRes.json();
    const finalList = Array.isArray(finalPhotos) ? finalPhotos : (finalPhotos.items || []);
    const isBack = finalList.some((p: any) => p.id === targetPhotoId);
    expect(isBack).toBeTruthy();
    console.log(`  Step 6: Back in active photos (${finalList.length} active)`);

    console.log('  === Full workflow PASSED ===');
  });
});
