/**
 * Global setup: performs login once and saves auth state for all tests.
 */
import { chromium, FullConfig } from '@playwright/test';
import * as path from 'path';

const AUTH_FILE = path.join(__dirname, '.auth-state.json');

async function globalSetup(config: FullConfig) {
  const baseURL = config.projects[0]?.use?.baseURL || 'http://localhost:3000';
  const browser = await chromium.launch();
  const context = await browser.newContext();
  const page = await context.newPage();

  // Try to init-admin first (in case DB is fresh)
  try {
    await page.goto(`${baseURL}/login`);
    await page.evaluate(() =>
      fetch('/api/auth/init-admin', { method: 'POST' }).then(r => r.json())
    );
  } catch {
    // Already initialized
  }

  // Wait for rate limit to clear
  await page.waitForTimeout(2000);

  // Perform login
  await page.goto(`${baseURL}/login`);

  // Dismiss webpack dev server error overlay if present
  try {
    const overlay = page.locator('iframe#webpack-dev-server-client-overlay');
    if (await overlay.count() > 0) {
      await page.evaluate(() => {
        const iframe = document.getElementById('webpack-dev-server-client-overlay');
        if (iframe) iframe.remove();
      });
      console.log('[global-setup] Dismissed webpack error overlay');
    }
  } catch { /* no overlay */ }

  await page.waitForSelector('input#login_username', { timeout: 10000 });

  // Check for rate limit
  const rateLimitMsg = page.locator('text=Rate limit exceeded');
  if (await rateLimitMsg.count() > 0) {
    console.log('[global-setup] Rate limit, waiting 10s...');
    await page.waitForTimeout(10000);
    await page.reload();
    await page.waitForSelector('input#login_username', { timeout: 10000 });
  }

  // Remove overlay before interacting
  await page.evaluate(() => {
    document.getElementById('webpack-dev-server-client-overlay')?.remove();
  });

  await page.fill('input#login_username', 'admin');
  await page.fill('input#login_password', 'admin123');
  await page.click('button[type="submit"]');

  try {
    await page.waitForURL(/\/(dashboard|water-mitigation|estimate|invoice|bathroom|cabinet|roofing|packing|material-order|claim-followup)/, { timeout: 15000 });
  } catch {
    // Retry once more
    await page.waitForTimeout(5000);
    await page.goto(`${baseURL}/login`);
    await page.evaluate(() => {
      document.getElementById('webpack-dev-server-client-overlay')?.remove();
    });
    await page.waitForSelector('input#login_username', { timeout: 10000 });
    await page.fill('input#login_username', 'admin');
    await page.fill('input#login_password', 'admin123');
    await page.click('button[type="submit"]');
    await page.waitForURL(/\/(dashboard|water-mitigation|estimate|invoice|bathroom|cabinet|roofing|packing|material-order|claim-followup)/, { timeout: 15000 });
  }

  // Save storage state
  await context.storageState({ path: AUTH_FILE });
  console.log('[global-setup] Auth state saved to', AUTH_FILE);

  await browser.close();
}

export default globalSetup;
