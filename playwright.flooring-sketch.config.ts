/**
 * Playwright config for the flooring sketch tests.
 *
 * These specs stub every /api call (see tests/e2e/fixtures/flooring-sketch-mock.ts),
 * so unlike the main suite they need only the frontend dev server — no
 * backend, no database, and no shared login step. They therefore skip the
 * global-setup/storageState pair that the main config relies on.
 */

import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: /flooring-sketch-.*\.spec\.ts/,
  outputDir: './tests/e2e/test-results',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  timeout: 60000,
  reporter: [['list']],
  use: {
    baseURL: process.env.E2E_BASE_URL || 'http://localhost:3000',
    // Allow pointing at a pre-installed Chromium (e.g. PLAYWRIGHT_BROWSERS_PATH
    // sandboxes that pin a different build than this @playwright/test version).
    ...(process.env.E2E_CHROMIUM_PATH
      ? { launchOptions: { executablePath: process.env.E2E_CHROMIUM_PATH } }
      : {}),
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    // Drawing is done at a desk; on a phone the typed flows (room by size,
    // wall lengths in the side panel) have to work. The iPhone descriptor
    // defaults to WebKit; Chromium's mobile emulation is what CI has.
    { name: 'desktop-chrome', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } },
    { name: 'mobile-iphone', use: { ...devices['iPhone 14'], browserName: 'chromium' } },
  ],
});
