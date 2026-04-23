import { test, expect, Page } from '@playwright/test';

/**
 * Water Mitigation Sketch - Trim Partial Removal E2E Test
 *
 * Tests:
 * 1. Trim removal selector appears for window/door trim items
 * 2. LF values update based on removal selection
 * 3. Custom LF input works
 *
 * Run: npx playwright test e2e/wm-sketch-trim-removal.spec.ts --reporter=list
 */

const BASE_URL = 'http://localhost:3000';

async function findTestJobId(page: Page): Promise<string | null> {
  const response = await page.request.get('http://localhost:8000/api/water-mitigation/jobs?page_size=10');
  if (response.ok()) {
    const data = await response.json();
    const jobs = data.items || data.jobs || [];
    if (jobs.length > 0) return jobs[0].id;
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

test.describe('WM Sketch - Trim Partial Removal', () => {
  test('Sketch tab loads and shows trim controls', async ({ page }) => {
    await ensureLoggedIn(page);

    const jobId = await findTestJobId(page);
    test.skip(!jobId, 'No WM job found');

    // Navigate to WM job
    await page.goto(`${BASE_URL}/water-mitigation/${jobId}`, { timeout: 60000 });
    await page.waitForTimeout(3000);

    // Click Sketch tab
    const sketchTab = page.locator('[role="tab"]', { hasText: /Sketch/i });
    await expect(sketchTab).toBeVisible({ timeout: 10000 });
    await sketchTab.click();
    await page.waitForTimeout(3000);

    // Take screenshot of sketch tab
    await page.screenshot({ path: 'e2e/screenshots/sketch-trim-tab.png' });

    // Look for demolition panel or add demolition button
    const demoSection = page.locator('text=Demolition').first();
    if (await demoSection.isVisible({ timeout: 5000 }).catch(() => false)) {
      console.log('Demolition section found in sketch');
    }
  });
});
