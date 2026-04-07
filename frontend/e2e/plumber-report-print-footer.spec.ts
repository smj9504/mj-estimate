/**
 * Playwright test: Plumber Report print header/footer visibility.
 *
 * Verifies that Report # and property address appear in the
 * header/footer of EVERY page when printing from the HTML preview.
 */
import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const API = 'http://localhost:8000';
const OUT = path.resolve(__dirname, 'test-output');

/** Build a long report that spans 3+ printed pages */
function buildLongReport() {
  const items = Array.from({ length: 25 }, (_, i) => ({
    name: `Service Item #${i + 1} - ${['Pipe Repair', 'Drain Cleaning', 'Valve Replace', 'Fixture Install', 'Leak Detection'][i % 5]}`,
    description: `Detailed description for item ${i + 1}`,
    quantity: 1 + (i % 5),
    unit: ['hr', 'ft', 'ea', 'lot'][i % 4],
    unit_cost: 50 + i * 10,
    total_cost: (50 + i * 10) * (1 + (i % 5)),
  }));

  const longText = '<p>' + Array(10).fill(
    'Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris.'
  ).join(' ') + '</p>';

  return {
    report_data: {
      report_number: 'PLM-MULTI-001',
      template_type: 'standard',
      status: 'draft',
      client: { name: 'John Doe', address: '123 Main St', city: 'Denver', state: 'CO', zipcode: '80202' },
      property: { address: '456 Oak Ave', city: 'Boulder', state: 'CO', zipcode: '80301' },
      service_date: new Date().toISOString(),
      technician_name: 'Mike Smith',
      license_number: 'PL-12345',
      cause_of_damage: longText,
      work_performed: longText,
      materials_equipment_text: '<p>Copper pipe, PVC pipe, solder, flux, fittings, valves</p>',
      recommendations: longText,
      invoice_items: items,
      financial: {
        labor_cost: 3000, materials_cost: 2000, equipment_cost: 500,
        subtotal: 5500, tax_amount: 440, discount: 0,
        total_amount: 5940, balance_due: 5940,
      },
      payments: [], show_payment_dates: true, photos: [],
      warranty_info: '<p>90-day warranty on all work.</p>',
      terms_conditions: '<p>Payment due within 30 days.</p>',
      notes: '<p>Large-scale plumbing overhaul.</p>',
    },
    include_photos: false,
    include_financial: true,
  };
}

async function fetchPreviewHTML(payload: object): Promise<string> {
  const res = await fetch(`${API}/api/plumber-reports/preview-html`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`API ${res.status}: ${await res.text()}`);
  return res.text();
}

test.beforeAll(() => fs.mkdirSync(OUT, { recursive: true }));

test('HTML contains print-layout table with header/footer', async () => {
  const html = await fetchPreviewHTML(buildLongReport());
  expect(html).toContain('class="print-layout"');
  expect(html).toContain('class="print-running-header"');
  expect(html).toContain('class="print-running-footer"');
  expect(html).toContain('PLM-MULTI-001');
  expect(html).toContain('456 Oak Ave');
});

test('Screen mode: print footer hidden, report-footer visible', async ({ page }) => {
  const html = await fetchPreviewHTML(buildLongReport());
  await page.setContent(html, { waitUntil: 'networkidle' });

  // .report-footer (original) visible on screen
  await expect(page.locator('.report-footer')).toBeVisible();

  // thead/tfoot hidden on screen → running header/footer not visible
  await expect(page.locator('.print-running-header')).not.toBeVisible();
  await expect(page.locator('.print-running-footer')).not.toBeVisible();
});

test('Print mode: running header/footer visible, report-footer hidden', async ({ page }) => {
  const html = await fetchPreviewHTML(buildLongReport());
  await page.setContent(html, { waitUntil: 'networkidle' });
  await page.emulateMedia({ media: 'print' });

  // Running header visible with correct text
  const header = page.locator('.print-running-header');
  await expect(header).toBeVisible();
  await expect(header).toContainText('PLM-MULTI-001');
  await expect(header).toContainText('456 Oak Ave');

  // Running footer visible with correct text
  const footer = page.locator('.print-running-footer');
  await expect(footer).toBeVisible();
  await expect(footer).toContainText('PLM-MULTI-001');
  await expect(footer).toContainText('456 Oak Ave');

  // Table structure active in print
  const table = page.locator('.print-layout');
  const display = await table.evaluate(el => getComputedStyle(el).display);
  expect(display).toBe('table');

  const theadDisplay = await page.locator('.print-layout > thead').evaluate(
    el => getComputedStyle(el).display
  );
  expect(theadDisplay).toBe('table-header-group');

  const tfootDisplay = await page.locator('.print-layout > tfoot').evaluate(
    el => getComputedStyle(el).display
  );
  expect(tfootDisplay).toBe('table-footer-group');

  // Original footer hidden on print
  const rfDisplay = await page.locator('.report-footer').evaluate(
    el => getComputedStyle(el).display
  );
  expect(rfDisplay).toBe('none');
});

test('Multi-page PDF has header/footer on every page', async ({ browser }) => {
  const html = await fetchPreviewHTML(buildLongReport());
  fs.writeFileSync(path.join(OUT, 'multi-page-preview.html'), html);

  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.setContent(html, { waitUntil: 'networkidle' });

  const pdf = await page.pdf({ format: 'Letter', printBackground: true });
  const pdfPath = path.join(OUT, 'multi-page-final.pdf');
  fs.writeFileSync(pdfPath, pdf);
  console.log(`PDF: ${pdf.length} bytes, ${pdfPath}`);
  expect(pdf.length).toBeGreaterThan(10000);

  await ctx.close();
});
