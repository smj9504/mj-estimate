import { test, expect } from '@playwright/test';

const BASE_URL = 'http://localhost:3000';
const API = 'http://localhost:8000';

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function getAuthToken(): Promise<string> {
  const res = await fetch(`${API}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'admin123' }),
  });
  if (!res.ok) throw new Error(`Login failed: ${res.status}`);
  const data = await res.json();
  return data.access_token || data.token;
}

// UI tests rely on global-setup auth state (storageState in playwright.config.ts)
// No manual login needed — just navigate to the page directly.

// Sample roofing measurements for testing
const ROOFING_MEASUREMENTS = {
  total_area_sf: 3200,
  squares: 32,
  squares_with_waste: 36,
  eaves_lf: 200,
  rakes_lf: 80,
  ridges_lf: 60,
  hips_lf: 40,
  valleys_lf: 30,
  step_flashing_lf: 25,
  drip_edge_lf: 280,
  penetration_count: 4,
  waste_pct: 12,
};

// Sample siding measurements for testing
const SIDING_MEASUREMENTS = {
  net_siding_sqft: 2400,
  masonry_sqft: 200,
  wd_perimeter_lf: 350,
  wd_area_sqft: 280,
  wd_count: 18,
  fascia_lf: 120,
  bottom_wall_lf: 180,
  top_wall_lf: 160,
  outside_corner_lf: 45,
  inside_corner_lf: 10,
  waste_pct: 10,
};

// ─── API Integration Tests ────────────────────────────────────────────────────

test.describe('Material Order — API Endpoints', () => {
  let token: string;

  test.beforeAll(async () => {
    token = await getAuthToken();
  });

  test('GET /api/material-orders/brands — returns brand list', async () => {
    const res = await fetch(`${API}/api/material-orders/brands`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toHaveProperty('CertainTeed');
    expect(data).toHaveProperty('GAF');
    expect(data['CertainTeed']).toEqual({ roofing: true, siding: true });
  });

  test('POST /api/material-orders/calculate — roofing calculation', async () => {
    const res = await fetch(`${API}/api/material-orders/calculate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        scope_type: 'roofing',
        property_address: '123 Test St',
        report_number: 'EV-TEST-001',
        brand: 'CertainTeed',
        product: 'Landmark AR',
        color: 'Weathered Wood',
        waste_pct: 12,
        roofing_measurements: ROOFING_MEASUREMENTS,
      }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();

    expect(data.scope_type).toBe('roofing');
    expect(data.property_address).toBe('123 Test St');
    expect(data.brand).toBe('CertainTeed');
    expect(data.materials).toBeInstanceOf(Array);
    expect(data.materials.length).toBeGreaterThan(0);

    // Check shingles are first item
    const shingles = data.materials[0];
    expect(shingles.item).toContain('Shingles');
    expect(shingles.unit).toBe('BD');
    expect(shingles.qty).toBeGreaterThan(0);
    expect(shingles.formula).toBeTruthy();

    // Check categories exist
    const categories = new Set(data.materials.map((m: any) => m.category));
    expect(categories.has('main')).toBe(true);
    expect(categories.has('fastener')).toBe(true);
  });

  test('POST /api/material-orders/calculate — siding calculation', async () => {
    const res = await fetch(`${API}/api/material-orders/calculate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        scope_type: 'siding',
        property_address: '456 Side Ave',
        brand: 'CertainTeed',
        waste_pct: 10,
        siding_measurements: SIDING_MEASUREMENTS,
      }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();

    expect(data.scope_type).toBe('siding');
    expect(data.materials.length).toBeGreaterThan(0);

    // Check siding panels
    const panels = data.materials[0];
    expect(panels.unit).toBe('CTN');
    expect(panels.qty).toBeGreaterThan(0);

    // Masonry note should exist
    expect(data.notes.length).toBeGreaterThan(0);
    expect(data.notes.some((n: string) => n.toLowerCase().includes('masonry'))).toBe(true);
  });

  test('POST /api/material-orders/calculate — missing measurements returns 400', async () => {
    const res = await fetch(`${API}/api/material-orders/calculate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        scope_type: 'roofing',
        brand: 'CertainTeed',
        waste_pct: 12,
        // No roofing_measurements provided
      }),
    });
    expect(res.status).toBe(400);
  });

  test('POST /api/material-orders/export/pdf — supply order PDF', async () => {
    // First calculate
    const calcRes = await fetch(`${API}/api/material-orders/calculate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        scope_type: 'roofing',
        property_address: '789 Export Rd',
        report_number: 'EV-PDF-001',
        brand: 'CertainTeed',
        product: 'Landmark AR',
        color: 'Weathered Wood',
        waste_pct: 12,
        roofing_measurements: ROOFING_MEASUREMENTS,
      }),
    });
    const calcData = await calcRes.json();

    // Export supply order PDF
    const res = await fetch(`${API}/api/material-orders/export/pdf`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        scope_type: 'roofing',
        output_type: 'supply_order',
        property_address: '789 Export Rd',
        report_number: 'EV-PDF-001',
        brand: 'CertainTeed',
        product: 'Landmark AR',
        color: 'Weathered Wood',
        measurements: calcData.measurements,
        materials: calcData.materials,
        notes: calcData.notes,
      }),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/pdf');

    const blob = await res.arrayBuffer();
    expect(blob.byteLength).toBeGreaterThan(1000);

    // PDF signature check (%PDF-)
    const header = new Uint8Array(blob.slice(0, 5));
    const pdfSignature = String.fromCharCode(...header);
    expect(pdfSignature).toBe('%PDF-');
  });

  test('POST /api/material-orders/export/pdf — internal estimate PDF', async () => {
    const calcRes = await fetch(`${API}/api/material-orders/calculate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        scope_type: 'roofing',
        property_address: '321 Estimate Ln',
        brand: 'GAF',
        waste_pct: 12,
        roofing_measurements: ROOFING_MEASUREMENTS,
      }),
    });
    const calcData = await calcRes.json();

    // Add unit prices for estimate
    const materialsWithPrices = calcData.materials.map((m: any) => ({
      ...m,
      unit_price: 50.00,
    }));

    const res = await fetch(`${API}/api/material-orders/export/pdf`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        scope_type: 'roofing',
        output_type: 'internal_estimate',
        property_address: '321 Estimate Ln',
        brand: 'GAF',
        measurements: calcData.measurements,
        materials: materialsWithPrices,
        notes: calcData.notes,
      }),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/pdf');

    const blob = await res.arrayBuffer();
    expect(blob.byteLength).toBeGreaterThan(1000);
  });

  test('POST /api/material-orders/calculate — different brands produce different results', async () => {
    const brands = ['CertainTeed', 'GAF', 'Owens Corning'];
    const results: any[] = [];

    for (const brand of brands) {
      const res = await fetch(`${API}/api/material-orders/calculate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          scope_type: 'roofing',
          brand,
          waste_pct: 12,
          roofing_measurements: ROOFING_MEASUREMENTS,
        }),
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      results.push(data);
      expect(data.brand).toBe(brand);
      expect(data.materials.length).toBeGreaterThan(0);
    }

    // All brands should have same number of shingles (same formula)
    expect(results[0].materials[0].qty).toBe(results[1].materials[0].qty);

    // But product names should differ
    const starterNames = results.map((r) => r.materials[1].item);
    expect(starterNames[0]).not.toBe(starterNames[1]); // CertainTeed vs GAF
  });
});

// ─── UI Tests ─────────────────────────────────────────────────────────────────

test.describe('Material Order — UI Navigation & Page Load', () => {
  test('Material Order page loads from nav menu', async ({ page }) => {
    await page.goto(`${BASE_URL}/dashboard`);
    await page.waitForLoadState('networkidle');
    // Click nav menu item
    const navItem = page.locator('.ant-menu-item').filter({ hasText: 'Material Order' });
    await navItem.click();
    await page.waitForURL(/\/material-order/, { timeout: 10000 });
    await page.waitForLoadState('networkidle');

    // Page title visible
    const title = page.locator('h3, h4').filter({ hasText: 'Material Order' });
    await expect(title).toBeVisible();

    // Job Information card visible
    const card = page.locator('.ant-card-head-title').filter({ hasText: 'Job Information' });
    await expect(card).toBeVisible();

    await page.screenshot({ path: 'tests/e2e/screenshots/material-order-page.png', fullPage: true });
  });

  test('Material Order page loads via direct URL', async ({ page }) => {
    await page.goto(`${BASE_URL}/material-order`);
    await page.waitForLoadState('networkidle');

    expect(page.url()).toContain('/material-order');

    // No error overlays
    const errors = page.locator('.ant-result-error, .ant-alert-error');
    expect(await errors.count()).toBe(0);
  });
});

test.describe('Material Order — Roofing Flow', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(`${BASE_URL}/material-order`);
    await page.waitForLoadState('networkidle');
  });

  test('Roofing tab is active by default', async ({ page }) => {
    // Roofing tab should be selected
    const roofingTab = page.locator('.ant-tabs-tab-active').filter({ hasText: 'Roofing' });
    await expect(roofingTab).toBeVisible();

    // Roofing measurement fields visible
    await expect(page.locator('label').filter({ hasText: 'Squares' }).first()).toBeVisible();
    await expect(page.locator('label').filter({ hasText: 'Eaves (LF)' })).toBeVisible();
    await expect(page.locator('label').filter({ hasText: 'Ridges (LF)' })).toBeVisible();
  });

  test('Fill roofing measurements and generate material list', async ({ page }) => {
    // Fill job info
    await page.fill('input#property_address', '123 Playwright Test St');
    await page.fill('input#report_number', 'EV-PW-001');

    // Fill measurements
    await page.fill('input#total_area_sf', '3200');
    await page.fill('input#squares', '32');
    await page.fill('input#squares_with_waste', '36');
    await page.fill('input#eaves_lf', '200');
    await page.fill('input#rakes_lf', '80');
    await page.fill('input#ridges_lf', '60');
    await page.fill('input#hips_lf', '40');
    await page.fill('input#valleys_lf', '30');
    await page.fill('input#step_flashing_lf', '25');
    await page.fill('input#penetration_count', '4');

    // Click Generate
    const generateBtn = page.locator('button').filter({ hasText: 'Generate Material List' });
    await generateBtn.click();

    // Wait for results
    await page.waitForSelector('.ant-table', { timeout: 15000 });

    // Material table should appear
    const tableRows = page.locator('.ant-table-row');
    const rowCount = await tableRows.count();
    expect(rowCount).toBeGreaterThan(5); // At least shingles, starter, hip&ridge, I&W, felt, drip edge

    // Shingles should be in the table
    await expect(page.locator('.ant-table').filter({ hasText: 'Shingles' })).toBeVisible();

    // Export buttons should appear
    await expect(page.locator('button').filter({ hasText: 'Supply Order PDF' })).toBeVisible();
    await expect(page.locator('button').filter({ hasText: 'Internal Estimate PDF' })).toBeVisible();

    await page.screenshot({ path: 'tests/e2e/screenshots/material-order-roofing-results.png', fullPage: true });
  });

  test('Edit quantity in material table', async ({ page }) => {
    // Fill minimal measurements and generate
    await page.fill('input#squares', '20');
    await page.fill('input#squares_with_waste', '23');
    await page.fill('input#eaves_lf', '150');
    await page.fill('input#ridges_lf', '40');
    await page.fill('input#hips_lf', '20');

    await page.locator('button').filter({ hasText: 'Generate Material List' }).click();
    await page.waitForSelector('.ant-table', { timeout: 15000 });

    // Find the first qty input in the table and modify it
    const qtyInputs = page.locator('.ant-table .ant-input-number-input');
    const firstQtyInput = qtyInputs.first();
    const originalValue = await firstQtyInput.inputValue();

    // Clear and type new value
    await firstQtyInput.click();
    await firstQtyInput.fill('999');

    // The input should show the new value
    await expect(firstQtyInput).toHaveValue('999');

    // Reset button should appear (since qty differs from AI value)
    const resetBtn = page.locator('.ant-table button .anticon-reload').first();
    await expect(resetBtn).toBeVisible();

    // Click reset
    await resetBtn.click();

    // Value should revert
    const revertedValue = await firstQtyInput.inputValue();
    expect(revertedValue).toBe(originalValue);
  });

  test('View mode toggle between Supply Order and Full Estimate', async ({ page }) => {
    // Generate results first
    await page.fill('input#squares', '20');
    await page.fill('input#squares_with_waste', '23');
    await page.fill('input#eaves_lf', '150');
    await page.fill('input#ridges_lf', '40');
    await page.fill('input#hips_lf', '20');
    await page.locator('button').filter({ hasText: 'Generate Material List' }).click();
    await page.waitForSelector('.ant-table', { timeout: 15000 });

    // Full Estimate view should be default - has Unit $ column
    const headerCells = page.locator('.ant-table-thead th');
    const headers: string[] = [];
    for (let i = 0; i < await headerCells.count(); i++) {
      headers.push((await headerCells.nth(i).textContent()) || '');
    }
    expect(headers.some((h) => h.includes('Unit $'))).toBe(true);
    expect(headers.some((h) => h.includes('Subtotal'))).toBe(true);

    // Switch to Supply Order view
    const supplyTab = page.locator('.ant-tabs-tab').filter({ hasText: 'Supply Order View' });
    await supplyTab.click();

    // Unit $ and Subtotal columns should be hidden
    const newHeaders: string[] = [];
    const newHeaderCells = page.locator('.ant-table-thead th');
    for (let i = 0; i < await newHeaderCells.count(); i++) {
      newHeaders.push((await newHeaderCells.nth(i).textContent()) || '');
    }
    expect(newHeaders.some((h) => h.includes('Unit $'))).toBe(false);
    expect(newHeaders.some((h) => h.includes('Subtotal'))).toBe(false);
  });
});

test.describe('Material Order — Siding Flow', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(`${BASE_URL}/material-order`);
    await page.waitForLoadState('networkidle');
  });

  test('Switch to Siding tab shows siding fields', async ({ page }) => {
    // Click Siding tab
    const sidingTab = page.locator('.ant-tabs-tab').filter({ hasText: 'Siding' });
    await sidingTab.click();

    // Siding-specific fields should appear
    await expect(page.locator('label').filter({ hasText: 'Net Siding Area (SF)' })).toBeVisible();
    await expect(page.locator('label').filter({ hasText: 'Masonry Area (SF)' })).toBeVisible();
    await expect(page.locator('label').filter({ hasText: 'W&D Perimeter (LF)' })).toBeVisible();
    await expect(page.locator('label').filter({ hasText: 'Outside Corner (LF)' })).toBeVisible();

    // Roofing fields should NOT be visible
    await expect(page.locator('label').filter({ hasText: 'Squares' })).not.toBeVisible();
    await expect(page.locator('label').filter({ hasText: 'Ridges (LF)' })).not.toBeVisible();
  });

  test('Fill siding measurements and generate material list', async ({ page }) => {
    // Switch to Siding
    await page.locator('.ant-tabs-tab').filter({ hasText: 'Siding' }).click();

    // Fill job info
    await page.fill('input#property_address', '456 Siding Test Ave');

    // Fill siding measurements
    await page.fill('input#net_siding_sqft', '2400');
    await page.fill('input#masonry_sqft', '200');
    await page.fill('input#wd_perimeter_lf', '350');
    await page.fill('input#wd_area_sqft', '280');
    await page.fill('input#wd_count', '18');
    await page.fill('input#fascia_lf', '120');
    await page.fill('input#bottom_wall_lf', '180');
    await page.fill('input#top_wall_lf', '160');
    await page.fill('input#outside_corner_lf', '45');
    await page.fill('input#inside_corner_lf', '10');

    // Generate
    await page.locator('button').filter({ hasText: 'Generate Material List' }).click();
    await page.waitForSelector('.ant-table', { timeout: 15000 });

    // Table should have siding-specific items
    const tableContent = await page.locator('.ant-table').textContent();
    expect(tableContent).toContain('Siding');
    expect(tableContent).toContain('CTN');
    expect(tableContent).toContain('House Wrap');

    // Notes about masonry should appear
    const notesSection = page.locator('text=Masonry');
    await expect(notesSection.first()).toBeVisible();

    await page.screenshot({ path: 'tests/e2e/screenshots/material-order-siding-results.png', fullPage: true });
  });
});

test.describe('Material Order — PDF Export', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(`${BASE_URL}/material-order`);
    await page.waitForLoadState('networkidle');
  });

  test('Download Supply Order PDF', async ({ page }) => {
    // Fill and generate
    await page.fill('input#squares', '20');
    await page.fill('input#squares_with_waste', '23');
    await page.fill('input#eaves_lf', '150');
    await page.fill('input#ridges_lf', '40');
    await page.fill('input#hips_lf', '20');
    await page.locator('button').filter({ hasText: 'Generate Material List' }).click();
    await page.waitForSelector('.ant-table', { timeout: 15000 });

    // Listen for download
    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 15000 }),
      page.locator('button').filter({ hasText: 'Supply Order PDF' }).click(),
    ]);

    expect(download.suggestedFilename()).toContain('supply_order');
    expect(download.suggestedFilename()).toContain('.pdf');

    // Save and check file size
    const path = await download.path();
    expect(path).toBeTruthy();
  });

  test('Download Internal Estimate PDF', async ({ page }) => {
    // Fill and generate
    await page.fill('input#squares', '20');
    await page.fill('input#squares_with_waste', '23');
    await page.fill('input#eaves_lf', '150');
    await page.fill('input#ridges_lf', '40');
    await page.fill('input#hips_lf', '20');
    await page.locator('button').filter({ hasText: 'Generate Material List' }).click();
    await page.waitForSelector('.ant-table', { timeout: 15000 });

    // Listen for download
    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 15000 }),
      page.locator('button').filter({ hasText: 'Internal Estimate PDF' }).click(),
    ]);

    expect(download.suggestedFilename()).toContain('internal_estimate');
    expect(download.suggestedFilename()).toContain('.pdf');
  });
});

test.describe('Material Order — Brand Selection', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(`${BASE_URL}/material-order`);
    await page.waitForLoadState('networkidle');
  });

  test('Brand selector has all options', async ({ page }) => {
    // Open brand dropdown
    const brandSelect = page.locator('.ant-select').filter({ has: page.locator('[id="brand"]') });
    await brandSelect.click();

    // Check options
    const options = page.locator('.ant-select-item-option-content');
    const optionTexts: string[] = [];
    for (let i = 0; i < await options.count(); i++) {
      optionTexts.push((await options.nth(i).textContent()) || '');
    }
    expect(optionTexts).toContain('CertainTeed');
    expect(optionTexts).toContain('GAF');
    expect(optionTexts).toContain('Owens Corning');
  });

  test('Changing brand affects generated material names', async ({ page }) => {
    // Select GAF
    const brandSelect = page.locator('.ant-select').filter({ has: page.locator('[id="brand"]') });
    await brandSelect.click();
    await page.locator('.ant-select-item-option-content').filter({ hasText: 'GAF' }).click();

    // Fill measurements and generate
    await page.fill('input#squares', '20');
    await page.fill('input#squares_with_waste', '23');
    await page.fill('input#eaves_lf', '150');
    await page.fill('input#ridges_lf', '40');
    await page.fill('input#hips_lf', '20');
    await page.locator('button').filter({ hasText: 'Generate Material List' }).click();
    await page.waitForSelector('.ant-table', { timeout: 15000 });

    // Table should contain GAF product names
    const tableContent = await page.locator('.ant-table').textContent();
    expect(tableContent).toContain('GAF');
    expect(tableContent).toContain('Pro-Start'); // GAF starter product
  });
});

test.describe('Material Order — Calculation Accuracy', () => {
  let token: string;

  test.beforeAll(async () => {
    token = await getAuthToken();
  });

  test('Roofing shingle qty = ROUNDUP(squares_with_waste * 3)', async () => {
    const res = await fetch(`${API}/api/material-orders/calculate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        scope_type: 'roofing',
        brand: 'CertainTeed',
        waste_pct: 12,
        roofing_measurements: {
          ...ROOFING_MEASUREMENTS,
          squares_with_waste: 36.5, // test non-integer
        },
      }),
    });
    const data = await res.json();
    const shingles = data.materials.find((m: any) => m.item.includes('Shingles'));
    // ROUNDUP(36.5 * 3) = ROUNDUP(109.5) = 110
    expect(shingles.qty).toBe(110);
  });

  test('Roofing starter qty = ROUNDUP(eaves_lf / 116) for CertainTeed', async () => {
    const res = await fetch(`${API}/api/material-orders/calculate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        scope_type: 'roofing',
        brand: 'CertainTeed',
        waste_pct: 12,
        roofing_measurements: {
          ...ROOFING_MEASUREMENTS,
          eaves_lf: 250,
        },
      }),
    });
    const data = await res.json();
    const starter = data.materials.find((m: any) => m.item.includes('SwiftStart'));
    // ROUNDUP(250 / 116) = ROUNDUP(2.155) = 3
    expect(starter.qty).toBe(3);
  });

  test('Roofing step flashing qty = ROUNDUP(LF * 1.5 / 100)', async () => {
    const res = await fetch(`${API}/api/material-orders/calculate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        scope_type: 'roofing',
        brand: 'CertainTeed',
        waste_pct: 12,
        roofing_measurements: {
          ...ROOFING_MEASUREMENTS,
          step_flashing_lf: 80,
        },
      }),
    });
    const data = await res.json();
    const stepFlash = data.materials.find((m: any) => m.item.includes('Step Flashing'));
    // ROUNDUP(80 * 1.5 / 100) = ROUNDUP(1.2) = 2
    expect(stepFlash.qty).toBe(2);
  });

  test('Siding panels qty = ROUNDUP(net_sqft * 1.10 / 200)', async () => {
    const res = await fetch(`${API}/api/material-orders/calculate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        scope_type: 'siding',
        brand: 'CertainTeed',
        waste_pct: 10,
        siding_measurements: {
          ...SIDING_MEASUREMENTS,
          net_siding_sqft: 2400,
        },
      }),
    });
    const data = await res.json();
    const panels = data.materials.find((m: any) => m.unit === 'CTN');
    // ROUNDUP(2400 * 1.10 / 200) = ROUNDUP(13.2) = 14
    expect(panels.qty).toBe(14);
  });

  test('Siding sealant qty = MAX(8, ROUNDUP(wd_count / 3))', async () => {
    const res = await fetch(`${API}/api/material-orders/calculate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        scope_type: 'siding',
        brand: 'CertainTeed',
        waste_pct: 10,
        siding_measurements: {
          ...SIDING_MEASUREMENTS,
          wd_count: 18,
        },
      }),
    });
    const data = await res.json();
    const sealant = data.materials.find((m: any) => m.item.includes('Sealant'));
    // MAX(8, ROUNDUP(18 / 3)) = MAX(8, 6) = 8
    expect(sealant.qty).toBe(8);
  });
});
