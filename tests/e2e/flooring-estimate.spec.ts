/**
 * The flooring estimate: rooms and the work around the floor picked room by
 * room, then calculated. The API is stubbed with real service responses for
 * a sample house (fixtures/flooring-estimate-mock).
 */

import { expect, test } from '@playwright/test';
import { ESTIMATE_ID, mockFlooringEstimateApi } from './fixtures/flooring-estimate-mock';

test('a new estimate opens on its sketch', async ({ page }) => {
  const api = await mockFlooringEstimateApi(page);
  await page.goto('/flooring-estimates');
  await expect(page.getByText('123 Example St, Anytown, VA').first()).toBeVisible();
  await page.getByTestId('new-flooring-estimate').click();
  await expect(page).toHaveURL(new RegExp(`/flooring-estimates/${ESTIMATE_ID}\\?tab=sketch`));
  await expect(page.getByTestId('flooring-sketch-canvas')).toBeVisible();
  expect(api.created).toBe(1);
});

test('each room offers the work around the floor, measured, and only what is plain starts on', async ({ page }) => {
  await mockFlooringEstimateApi(page);
  await page.goto(`/flooring-estimates/${ESTIMATE_ID}?tab=rooms`);
  const living = page.getByTestId('room-scope-living');
  await expect(living).toBeVisible();
  // LVP from the job default; the base comes off and goes back
  await expect(living.getByTestId('item-install').getByRole('checkbox')).toBeChecked();
  await expect(living.getByTestId('item-baseboard_detach_reset').getByRole('checkbox')).toBeChecked();
  // Shoe molding is offered with the baseboard length, but starts off
  const shoe = living.getByTestId('item-shoe_molding');
  await expect(shoe.getByRole('checkbox')).not.toBeChecked();
  await expect(shoe.getByLabel('Shoe molding - install & paint quantity')).toHaveAttribute('placeholder', '49.33');
  // The kitchen's fridge and range are drawn: their detach & reset starts on
  await page.getByText('Kitchen', { exact: true }).click();
  const kitchen = page.getByTestId('room-scope-kitchen');
  await expect(kitchen.getByTestId('item-appliance_detach_reset').getByRole('checkbox')).toBeChecked();
  // Work that is off and not base trim waits behind "more"
  await expect(kitchen.getByTestId('item-toe_kick_detach_reset')).toHaveCount(0);
  await kitchen.getByTestId('more-items-kitchen').click();
  await expect(kitchen.getByTestId('item-toe_kick_detach_reset').getByLabel('Cabinet toe kick - detach & reset quantity'))
    .toHaveAttribute('placeholder', '14');
});

test('switching an item on, and typing its quantity and price, is saved on the room', async ({ page }) => {
  const api = await mockFlooringEstimateApi(page);
  await page.goto(`/flooring-estimates/${ESTIMATE_ID}?tab=rooms`);
  const shoe = page.getByTestId('room-scope-living').getByTestId('item-shoe_molding');
  await shoe.getByRole('checkbox').check();
  await shoe.getByLabel('Shoe molding - install & paint quantity').fill('40');
  await shoe.getByLabel('Shoe molding - install & paint unit price').fill('3.10');
  await expect(shoe.getByText('$124.00')).toBeVisible();
  await expect(shoe.getByText('set here')).toBeVisible();

  await expect.poll(() => api.lastUpdate()?.room_scopes?.living?.items?.shoe_molding)
    .toEqual({ on: true, qty: 40, unit_price: 3.1 });
  // What the room didn't change isn't sent as a choice
  expect(api.lastUpdate()?.room_scopes?.living?.items?.baseboard_detach_reset).toBeUndefined();

  // Back to the measured quantity, the catalog price and the default
  await shoe.getByRole('button', { name: 'Reset Shoe molding - install & paint' }).click();
  await expect.poll(() => api.lastUpdate()?.room_scopes?.living?.items?.shoe_molding).toBeUndefined();
});

test('an item switched on for every room, and a line the catalog lacks', async ({ page }) => {
  const api = await mockFlooringEstimateApi(page);
  await page.goto(`/flooring-estimates/${ESTIMATE_ID}?tab=rooms`);
  await page.getByText('Switch an item on or off in every room').click();
  await page.getByTestId('every-room-door_undercut').getByText('On', { exact: true }).click();
  await expect.poll(() => api.lastUpdate()?.job_scope?.room_items?.door_undercut).toEqual({ on: true });
  const living = page.getByTestId('room-scope-living');
  await expect(living.getByTestId('item-door_undercut').getByRole('checkbox')).toBeChecked();
  await expect(living.getByTestId('item-door_undercut').getByText('every room')).toBeVisible();

  await living.getByRole('button', { name: 'Add a line' }).click();
  await living.getByLabel('Custom line description').fill('Detach & reset piano');
  await living.getByLabel('Custom line unit price').fill('250');
  await expect.poll(() => api.lastUpdate()?.room_scopes?.living?.custom_items?.[0])
    .toMatchObject({ description: 'Detach & reset piano', quantity: 1, unit: 'EA', unit_price: 250 });
});

test('calculating shows the priced estimate room by room', async ({ page }) => {
  const api = await mockFlooringEstimateApi(page);
  await page.goto(`/flooring-estimates/${ESTIMATE_ID}?tab=rooms`);
  await page.getByTestId('calculate-header').click();
  await expect(page).toHaveURL(/tab=result/);
  const result = page.getByTestId('flooring-result');
  await expect(result).toBeVisible();
  expect(api.calculations).toBe(1);
  await expect(result.getByTestId('result-living')).toContainText('Living Room');
  await expect(result.getByTestId('result-living')).toContainText('Luxury vinyl plank (LVP) - floating, straight lay');
  await expect(result.getByTestId('result-hall')).toContainText('Transition strip / reducer');
  await expect(result.getByTestId('result-__general__')).toContainText('Final cleaning - floors');
  await expect(result.getByTestId('grand-total')).toHaveText('$6,040.13');
});
