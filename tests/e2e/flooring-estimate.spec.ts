/**
 * The flooring estimate: rooms and the work around the floor picked room by
 * room, then calculated. The API is stubbed with real service responses for
 * a sample house (fixtures/flooring-estimate-mock).
 */

import fs from 'fs';
import path from 'path';
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

test('a line priced from the price list', async ({ page }) => {
  const api = await mockFlooringEstimateApi(page);
  await page.goto(`/flooring-estimates/${ESTIMATE_ID}?tab=rooms`);
  const living = page.getByTestId('room-scope-living');
  await living.getByRole('combobox', { name: 'Add from the price list' }).click();
  await page.keyboard.type('Quarter round');
  // The visible option (antd also keeps a hidden one for screen readers)
  await page.getByTitle('Quarter round - install & paint (LF)').click();
  await expect(living.getByLabel('Custom line description')).toHaveValue('Quarter round - install & paint');
  await expect(living.getByLabel('Custom line unit price')).toHaveAttribute('placeholder', '3.55');
  await expect(living.getByText('price list', { exact: true })).toBeVisible();
  await expect.poll(() => api.lastUpdate()?.room_scopes?.living?.custom_items?.[0])
    .toMatchObject({ price_key: 'TRIM_RATES.quarter_round_per_lf', unit: 'LF', quantity: 1 });
});

test('the PDF downloads from the result', async ({ page }) => {
  const api = await mockFlooringEstimateApi(page, 'calculated');
  await page.goto(`/flooring-estimates/${ESTIMATE_ID}?tab=result`);
  const download = page.waitForEvent('download');
  await page.getByTestId('download-pdf').click();
  expect((await download).suggestedFilename()).toBe('flooring_estimate_123_Example_St.pdf');
  expect(api.pdfs).toBe(1);
  // Opened calculated and unchanged: printed as it is, not recalculated
  expect(api.calculations).toBe(0);
});

test('the PDF comes in the layout picked: room cards, by trade or a proposal', async ({ page }) => {
  await mockFlooringEstimateApi(page, 'calculated');
  await page.goto(`/flooring-estimates/${ESTIMATE_ID}?tab=result`);
  const layoutOf = async () => {
    const request = page.waitForRequest((r) => r.url().includes('/export/pdf'));
    const download = page.waitForEvent('download');
    await page.getByTestId('download-pdf').click();
    await download;
    return new URL((await request).url()).searchParams.get('layout');
  };
  expect(await layoutOf()).toBe('rooms');
  // The select's box (its input has no size while a value shows)
  const picker = page.locator('.ant-select', { has: page.getByRole('combobox', { name: 'PDF layout' }) });
  await picker.click();
  await page.getByTitle('Proposal', { exact: true }).filter({ visible: true }).click();
  await expect(page.getByText("Each room's work in words")).toBeVisible();
  expect(await layoutOf()).toBe('proposal');
  // Kept on this browser for the next estimate
  await page.reload();
  await expect(picker).toContainText('Proposal');
});

test('a room can be sanded and refinished in place of a new floor, and so can every room', async ({ page }) => {
  const api = await mockFlooringEstimateApi(page);
  // The finishes the server offers (the saved pricing fixture predates them)
  const pricing = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'flooring-pricing-info.json'), 'utf8'));
  await page.route((url) => url.pathname.endsWith('/api/flooring-estimates/pricing-info'), (route) => route.fulfill({
    json: { ...pricing, finishes: [
      { key: 'natural', label: 'Sand & finish wood floor (natural finish)', includes: '2 coats of finish', price: 4.6 },
      { key: 'stain', label: 'Sand, stain, and finish wood floor', includes: '1 coat of stain, 2 coats of finish', price: 5.53 },
    ] },
  }));
  await page.goto(`/flooring-estimates/${ESTIMATE_ID}?tab=rooms`);
  const living = page.getByTestId('room-scope-living');
  await expect(living.getByRole('combobox', { name: 'New floor' })).toBeVisible();

  await living.getByLabel('Work').getByText('Sand & refinish').click();
  // No new floor to pick: the finish instead, and the floor to sand
  await expect(living.getByRole('combobox', { name: 'New floor' })).toHaveCount(0);
  await expect(living.getByText('Floor to sand')).toBeVisible();
  await living.getByRole('combobox', { name: 'Finish' }).click();
  await page.getByTitle('1 coat of stain, 2 coats of finish', { exact: true }).filter({ visible: true }).click();
  await expect.poll(() => {
    const room = api.lastUpdate()?.room_scopes?.living;
    return room && { work: room.work, finish: room.finish };
  }).toEqual({ work: 'refinish', finish: 'stain' });
  await expect(page.getByText('Sand & refinish', { exact: true }).first()).toBeVisible();

  // For every room at once
  await page.getByLabel('Default work').getByText('Sand & refinish').click();
  await expect.poll(() => api.lastUpdate()?.job_scope?.defaults?.work).toBe('refinish');
  await expect(page.getByRole('combobox', { name: 'Default finish' })).toBeVisible();
  // Back to a new floor on the room alone
  await living.getByLabel('Work').getByText('New floor').click();
  await expect.poll(() => api.lastUpdate()?.room_scopes?.living?.work).toBe('replace');
  await expect(living.getByRole('combobox', { name: 'New floor' })).toBeVisible();
});

test('labor hours on a room, by the quarter hour at a trade’s rate', async ({ page }) => {
  const api = await mockFlooringEstimateApi(page);
  // Each trade's hourly line and whose a room's hours start on (the saved fixture predates them)
  const pricing = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'flooring-pricing-info.json'), 'utf8'));
  const trade = (key: string, label: string, price: number) => ({
    key: `LABOR_RATES.${key}`, label: `${label} - per hour`, group: 'Labor', unit: 'HR', unit_price: price,
  });
  await page.route((url) => url.pathname.endsWith('/api/flooring-estimates/pricing-info'), (route) => route.fulfill({
    json: {
      ...pricing,
      price_list: [...pricing.price_list, trade('tile_installer', 'Tile installer', 141.47),
        trade('vinyl_installer', 'Vinyl / LVP installer', 100.85), trade('general_laborer', 'General laborer', 63.1)],
      labor: {
        step_hr: 0.25, by_floor: { lvp: 'LABOR_RATES.vinyl_installer', ceramic_tile: 'LABOR_RATES.tile_installer' },
        refinish: 'LABOR_RATES.wood_installer', general: 'LABOR_RATES.general_laborer',
      },
    },
  }));
  await page.goto(`/flooring-estimates/${ESTIMATE_ID}?tab=rooms`);
  const living = page.getByTestId('room-scope-living');
  await living.getByRole('button', { name: 'Add labor hours' }).click();
  // The room's LVP: the vinyl installer's half hour to start
  const line = living.getByTestId('labor-line');
  await expect(line.locator('.ant-select', { has: page.getByRole('combobox', { name: 'Labor trade' }) }))
    .toContainText('Vinyl / LVP installer · $100.85/hr');
  await expect(line.getByText('$50.43')).toBeVisible();

  await line.getByLabel('Custom line description').fill('Cut tile around the column base');
  await line.locator('.ant-select', { has: page.getByRole('combobox', { name: 'Labor trade' }) }).click();
  await page.getByTitle('Tile installer · $141.47/hr', { exact: true }).filter({ visible: true }).click();
  await line.locator('.ant-select', { has: page.getByRole('combobox', { name: 'Labor hours' }) }).click();
  // Quarter hours only
  for (const h of ['0.25 hr', '0.5 hr', '0.75 hr', '1 hr']) {
    await expect(page.locator(`.ant-select-item-option[title="${h}"]`)).toBeVisible();
  }
  await page.locator('.ant-select-item-option[title="0.75 hr"]').click();
  await expect(line.getByText('$106.10')).toBeVisible();
  await expect.poll(() => api.lastUpdate()?.room_scopes?.living?.custom_items?.[0]).toMatchObject({
    description: 'Cut tile around the column base', quantity: 0.75, unit: 'HR', unit_price: null,
    price_key: 'LABOR_RATES.tile_installer',
  });

  // On the job, a general laborer's
  await page.getByText('Other work on the job').locator('..').getByRole('button', { name: 'Add labor hours' }).click();
  await expect.poll(() => api.lastUpdate()?.job_scope?.custom_items?.[0])
    .toMatchObject({ price_key: 'LABOR_RATES.general_laborer', quantity: 0.5, unit: 'HR' });
});
