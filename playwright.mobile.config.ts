/**
 * Playwright config for the mobile-layout suites.
 *
 * These specs stub every /api call (see the fixtures alongside them), so
 * unlike the main suite they need only the frontend dev server — no backend,
 * no database, and no shared login step. They therefore skip the
 * global-setup/storageState pair that the main config relies on.
 */

import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: /(wm-sketch|estimate-invoice)-mobile\.spec\.ts/,
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
    // The iOS/iPadOS descriptors default to WebKit; these specs assert layout
    // and touch behaviour rather than engine quirks, so they run on Chromium's
    // mobile emulation (viewport + hasTouch + UA all still apply), which is
    // what CI has installed.
    { name: 'mobile-iphone', use: { ...devices['iPhone 14'], browserName: 'chromium' } },
    { name: 'mobile-android', use: { ...devices['Pixel 7'] } },
    { name: 'tablet-ipad', use: { ...devices['iPad (gen 7)'], browserName: 'chromium' } },
    { name: 'desktop-chrome', use: { ...devices['Desktop Chrome'] } },
  ],
});
