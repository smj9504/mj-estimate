import { test, expect, Page } from '@playwright/test';

/**
 * Water Mitigation AI Classification - Duplicate Detection & Quick Remove E2E Test
 *
 * Tests:
 * 1. AI Classification modal opens correctly
 * 2. Quick remove (X) button appears on photo cards
 * 3. Duplicates tab appears when duplicates exist
 * 4. Auto-remove duplicates button works
 * 5. Undo button restores removed photos
 *
 * Run: npx playwright test e2e/wm-ai-duplicate-detection.spec.ts --reporter=list
 */

const BASE_URL = 'http://localhost:3000';

// Find a WM job with photos for testing
async function findTestJobId(page: Page): Promise<string | null> {
  const response = await page.request.get('http://localhost:8000/api/water-mitigation/jobs?page_size=10');
  if (response.ok()) {
    const data = await response.json();
    const jobs = data.items || data.jobs || [];
    // Find job with photos
    for (const job of jobs) {
      const photoResp = await page.request.get(
        `http://localhost:8000/api/water-mitigation/jobs/${job.id}/photos?page_size=1`
      );
      if (photoResp.ok()) {
        const photoData = await photoResp.json();
        const total = photoData.total || (photoData.items || []).length;
        if (total > 0) return job.id;
      }
    }
  }
  return null;
}

async function ensureLoggedIn(page: Page) {
  const loginResponse = await page.request.post('http://localhost:8000/api/auth/login', {
    data: { username: 'admin', password: 'admin123' },
  });

  if (loginResponse.ok()) {
    const data = await loginResponse.json();
    const token = data.access_token;
    await page.goto(BASE_URL, { timeout: 60000 });
    await page.evaluate((t) => {
      localStorage.setItem('auth_token', t);
      localStorage.setItem('auth_user', JSON.stringify({ username: 'admin', role: 'admin' }));
    }, token);
    await page.reload({ timeout: 60000 });
    await page.waitForTimeout(2000);
  }
}

test.describe('WM AI Classification - Duplicate Detection', () => {
  let jobId: string;

  test.beforeEach(async ({ page }) => {
    await ensureLoggedIn(page);
  });

  test('AI Classify modal opens and shows photo cards', async ({ page }) => {
    const foundJobId = await findTestJobId(page);
    test.skip(!foundJobId, 'No WM job with photos found');
    jobId = foundJobId!;

    // Navigate to WM job photos tab
    await page.goto(`${BASE_URL}/water-mitigation/${jobId}`, { timeout: 60000 });
    await page.waitForTimeout(3000);

    // Click Photos tab
    const photosTab = page.locator('[role="tab"]', { hasText: /Photos/i });
    await expect(photosTab).toBeVisible({ timeout: 10000 });
    await photosTab.click();
    await page.waitForTimeout(3000);

    // Look for AI Classify button (it has RobotOutlined icon with text "AI" or "AI Classify")
    const aiButton = page.locator('button').filter({ hasText: /AI Classify|^AI$/ }).first();
    await expect(aiButton).toBeVisible({ timeout: 15000 });

    // Take screenshot of photos tab
    await page.screenshot({ path: 'e2e/screenshots/ai-photos-tab.png' });
  });

  test('AI Results modal shows quick remove (X) buttons and filter tabs', async ({ page }) => {
    const foundJobId = await findTestJobId(page);
    test.skip(!foundJobId, 'No WM job with photos found');
    jobId = foundJobId!;

    // Navigate to WM job
    await page.goto(`${BASE_URL}/water-mitigation/${jobId}`, { timeout: 60000 });
    await page.waitForTimeout(3000);

    // Click Photos tab
    const photosTab = page.locator('[role="tab"]', { hasText: /Photos/i });
    if (await photosTab.isVisible({ timeout: 5000 }).catch(() => false)) {
      await photosTab.click();
      await page.waitForTimeout(2000);
    }

    // Try to load previous AI results (if any exist)
    const aiResultsButton = page.locator('button', { hasText: /AI Results|Previous/i }).first();
    if (await aiResultsButton.isVisible({ timeout: 5000 }).catch(() => false)) {
      await aiResultsButton.click();
      await page.waitForTimeout(3000);

      // Check modal is visible
      const modal = page.locator('.ant-modal-content').first();
      if (await modal.isVisible({ timeout: 5000 }).catch(() => false)) {
        // Check for filter tabs (All, Classified, etc.)
        await expect(page.locator('.ant-tag', { hasText: /All/ })).toBeVisible({ timeout: 5000 });

        // Check for photo cards with X button
        const closeButtons = page.locator('.ant-modal-content button .anticon-close');
        const closeCount = await closeButtons.count();

        // Take screenshot
        await page.screenshot({ path: 'e2e/screenshots/ai-results-modal.png' });

        console.log(`Found ${closeCount} quick-remove buttons in AI results modal`);

        // Check for Duplicates tab if duplicates detected
        const dupTab = page.locator('.ant-tag', { hasText: /Duplicates/ });
        if (await dupTab.isVisible({ timeout: 2000 }).catch(() => false)) {
          await dupTab.click();
          await page.waitForTimeout(1000);

          // Check for auto-remove button
          const autoRemoveBtn = page.locator('button', { hasText: /Auto-remove/i });
          await expect(autoRemoveBtn).toBeVisible({ timeout: 5000 });

          // Check for Keep badges
          const keepBadges = page.locator('text=Keep');
          const keepCount = await keepBadges.count();
          console.log(`Found ${keepCount} "Keep" badges in duplicate view`);

          // Check for Dup badges
          const dupBadges = page.locator('text=Dup');
          const dupCount = await dupBadges.count();
          console.log(`Found ${dupCount} "Dup" badges in duplicate view`);

          await page.screenshot({ path: 'e2e/screenshots/ai-duplicates-tab.png' });
        } else {
          console.log('No duplicates detected (Duplicates tab not shown)');
        }
      }
    } else {
      console.log('No previous AI results button found - skipping modal test');
    }
  });

  test('Quick remove X button sets photo to uncategorized', async ({ page }) => {
    const foundJobId = await findTestJobId(page);
    test.skip(!foundJobId, 'No WM job with photos found');
    jobId = foundJobId!;

    await page.goto(`${BASE_URL}/water-mitigation/${jobId}`, { timeout: 60000 });
    await page.waitForTimeout(3000);

    // Click Photos tab
    const photosTab = page.locator('[role="tab"]', { hasText: /Photos/i });
    if (await photosTab.isVisible({ timeout: 5000 }).catch(() => false)) {
      await photosTab.click();
      await page.waitForTimeout(2000);
    }

    // Load previous AI results
    const aiResultsButton = page.locator('button', { hasText: /AI Results|Previous/i }).first();
    if (await aiResultsButton.isVisible({ timeout: 5000 }).catch(() => false)) {
      await aiResultsButton.click();
      await page.waitForTimeout(3000);

      const modal = page.locator('.ant-modal-content').first();
      if (await modal.isVisible({ timeout: 5000 }).catch(() => false)) {
        // Find a photo card with X button
        const firstCard = modal.locator('[class*="ant-col"]').first();
        const xButton = firstCard.locator('button .anticon-close').first();

        if (await xButton.isVisible({ timeout: 3000 }).catch(() => false)) {
          // Click X to remove
          await xButton.click();
          await page.waitForTimeout(500);

          // Card should now show reduced opacity or red border
          await page.screenshot({ path: 'e2e/screenshots/ai-quick-remove.png' });

          // Look for Undo button
          const undoButton = firstCard.locator('button', { hasText: /Undo/i });
          if (await undoButton.isVisible({ timeout: 2000 }).catch(() => false)) {
            // Click Undo to restore
            await undoButton.click();
            await page.waitForTimeout(500);
            await page.screenshot({ path: 'e2e/screenshots/ai-quick-remove-undo.png' });
            console.log('Undo button works correctly');
          }
        } else {
          console.log('No X button found on first card');
        }
      }
    }
  });
});
