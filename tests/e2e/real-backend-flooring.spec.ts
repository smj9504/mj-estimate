/**
 * A flooring estimate made from start to finish against the real backend
 * and database (the main config: global-setup logs in as the seeded admin).
 *
 * Draws two rooms and a doorway, picks the floors and an item, calculates,
 * downloads the PDF, and checks what was saved survives a reload.
 *
 *   npx playwright test -c playwright.config.ts tests/e2e/real-backend-flooring.spec.ts --project=desktop-chrome
 *
 * Needs the backend on :8000 with a PostgreSQL database that has pgvector
 * (without it create_all makes no tables) and the frontend on :3000.
 */

import { expect, test, type Page } from '@playwright/test';
import { pagePoint } from './fixtures/flooring-sketch-mock';

test.skip(({ isMobile }) => isMobile, 'Desktop: draws on the canvas with the mouse');

// Under the main config global-setup has logged in already; run on its own, log in here
test.beforeEach(async ({ page }) => {
  await page.goto('/flooring-estimates');
  const username = page.locator('input#login_username');
  // Whichever comes up: the sign-in form, or the list (already signed in)
  await expect(username.or(page.getByTestId('new-flooring-estimate'))).toBeVisible({ timeout: 20000 });
  if (await username.isVisible()) {
    await username.fill(process.env.E2E_USERNAME || 'admin');
    await page.fill('input#login_password', process.env.E2E_PASSWORD || 'admin123');
    await page.keyboard.press('Enter');
    await page.waitForURL((url) => !url.pathname.startsWith('/login'));
  }
});

async function typeFeet(page: Page, label: string, value: string) {
  const input = page.getByLabel(label);
  await input.fill(value);
  await input.press('Enter');
}

async function addRoom(page: Page, name: string, length: string, width: string) {
  await page.getByLabel('New room name').fill(name);
  await typeFeet(page, 'New room length', length);
  await typeFeet(page, 'New room width', width);
  await page.getByTestId('add-sized-room').click();
  await expect(page.getByTestId('flooring-sketch-inspector').getByText(name).first()).toBeVisible();
}

async function pick(page: Page, combobox: string, option: string, within = page.locator('body')) {
  await within.getByRole('combobox', { name: combobox }).click();
  // In the list just opened (an earlier one stays in the page, hidden)
  await page.getByTitle(option, { exact: true }).filter({ visible: true }).click();
  await expect(page.locator('.ant-select-dropdown:not(.ant-select-dropdown-hidden)')).toHaveCount(0);
}

test('a flooring estimate from sketch to PDF, saved as it goes', async ({ page }) => {
  // A new estimate opens on its sketch
  await page.goto('/flooring-estimates');
  await page.getByTestId('new-flooring-estimate').click();
  await expect(page).toHaveURL(/\/flooring-estimates\/[0-9a-f-]{36}\?tab=sketch/);
  const estimateUrl = page.url().split('?')[0];

  // Two rooms side by side, a wall apart, and a doorway between them
  await addRoom(page, 'Living Room', '15', `14' 2"`);
  await addRoom(page, 'Kitchen', '12', `11' 6"`);
  const canvas = page.getByTestId('flooring-sketch-canvas');
  await page.getByTestId('tool-opening').click();
  const wall = await pagePoint(canvas, { x: 15.1, y: 5 });
  await page.mouse.click(wall.x, wall.y);
  await expect(page.getByTestId('opening-inspector').getByText('Living Room ↔ Kitchen')).toBeVisible();
  await expect(page.getByTestId('sketch-save-status')).toHaveText('Saved', { timeout: 15000 });

  // LVP over carpet everywhere; shoe molding in the living room
  await page.getByRole('tab', { name: /Rooms & Materials/ }).click();
  const living = page.getByTestId('room-scope-' + (await roomIdByName(page, 'Living Room')));
  await expect(living).toBeVisible();
  await pick(page, 'Default new floor', 'Luxury vinyl plank (LVP)');
  await pick(page, 'Default existing floor', 'Carpet & pad');
  await expect(living.getByTestId('item-install').getByRole('checkbox')).toBeChecked({ timeout: 15000 });
  await expect(living.getByTestId('item-install').getByLabel(/quantity/)).toHaveAttribute('placeholder', '233.75');
  await living.getByTestId('item-shoe_molding').getByRole('checkbox').check();
  await expect(page.getByTestId('scope-save-status')).toHaveText('Saved', { timeout: 15000 });

  // Calculate: the lines come back room by room
  await page.getByTestId('calculate-header').click();
  const result = page.getByTestId('flooring-result');
  await expect(result).toBeVisible({ timeout: 20000 });
  await expect(result).toContainText('Living Room');
  await expect(result).toContainText('Kitchen');
  await expect(result).toContainText('Luxury vinyl plank (LVP) - floating, straight lay');
  await expect(result).toContainText('Shoe molding - install & paint');
  await expect(result).toContainText('Remove carpet & pad');
  const total = await page.getByTestId('grand-total').innerText();
  expect(Number(total.replace(/[$,]/g, ''))).toBeGreaterThan(1000);

  // The PDF
  const download = page.waitForEvent('download');
  await page.getByTestId('download-pdf').click();
  const pdf = await download;
  expect(pdf.suggestedFilename()).toMatch(/^flooring_estimate_.*\.pdf$/);
  const fs = await import('fs');
  const bytes = fs.readFileSync((await pdf.path())!);
  expect(bytes.subarray(0, 5).toString()).toBe('%PDF-');
  expect(bytes.length).toBeGreaterThan(8000);

  // Everything chosen is still there after a reload
  await page.goto(`${estimateUrl}?tab=rooms`);
  const livingAgain = page.getByTestId('room-scope-' + (await roomIdByName(page, 'Living Room')));
  await expect(livingAgain.getByTestId('item-shoe_molding').getByRole('checkbox')).toBeChecked();
  await page.getByRole('tab', { name: 'Result' }).click();
  await expect(page.getByTestId('grand-total')).toHaveText(total);

  // And the list shows it priced
  await page.goto('/flooring-estimates');
  await expect(page.getByText(total).first()).toBeVisible();
});

/** A room's id, read from the rooms panel by its name */
async function roomIdByName(page: Page, name: string): Promise<string> {
  const header = page.locator('.ant-collapse-item', { hasText: name }).first();
  await expect(header).toBeVisible({ timeout: 15000 });
  const testId = await header.locator('[data-testid^="room-scope-"]').getAttribute('data-testid').catch(() => null);
  if (testId) return testId.replace('room-scope-', '');
  // Collapsed: open it to read its id
  await header.locator('.ant-collapse-header').click();
  const opened = await header.locator('[data-testid^="room-scope-"]').getAttribute('data-testid');
  return opened!.replace('room-scope-', '');
}
