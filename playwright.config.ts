import { defineConfig, devices } from '@playwright/test';
import * as path from 'path';

const AUTH_FILE = path.join(__dirname, 'tests', 'e2e', '.auth-state.json');

export default defineConfig({
  testDir: './tests/e2e',
  outputDir: './tests/e2e/test-results',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  timeout: 60000,
  globalSetup: './tests/e2e/global-setup.ts',
  reporter: [
    ['html', { outputFolder: './tests/e2e/playwright-report' }],
    ['list']
  ],
  use: {
    baseURL: 'http://localhost:3000',
    storageState: AUTH_FILE,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    {
      name: 'desktop-chrome',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'mobile-iphone',
      use: { ...devices['iPhone 14'] },
    },
    {
      name: 'mobile-android',
      use: { ...devices['Pixel 7'] },
    },
    {
      name: 'tablet-ipad',
      use: { ...devices['iPad (gen 7)'] },
    },
  ],
});
