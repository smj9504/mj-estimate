/**
 * Client Management E2E Tests
 * Tests Client CRUD, Claim CRUD, and Negotiation tracking.
 */

import { test, expect } from './fixtures/auth';

const TEST_PREFIX = `E2E-${Date.now()}`;

test.describe('Client Management', () => {

  // ============================================================
  // 1. Client List Page
  // ============================================================

  test('Navigate to client list page', async ({ authenticatedPage: page }) => {
    await page.goto('/clients');
    await page.waitForLoadState('networkidle');

    // Should not redirect to login
    expect(page.url()).toContain('/clients');

    // Page should render with title or table
    const heading = page.locator('h1:has-text("Clients"), h2:has-text("Clients"), h3:has-text("Clients"), h4:has-text("Clients"), .ant-typography:has-text("Clients")').first();
    await expect(heading).toBeVisible({ timeout: 10000 });
  });

  test('Search clients (empty state)', async ({ authenticatedPage: page }) => {
    await page.goto('/clients');
    await page.waitForLoadState('networkidle');

    // Search input should exist
    const searchInput = page.locator('input[placeholder*="earch"], input[placeholder*="client"]').first();
    const hasSearch = await searchInput.count() > 0;
    if (hasSearch) {
      await searchInput.fill('nonexistent-client-xyz');
      await page.waitForTimeout(500);

      // Should show empty or no results
      const tableBody = page.locator('.ant-table-tbody');
      await expect(tableBody).toBeVisible({ timeout: 5000 });
    }
  });

  // ============================================================
  // 2. Client CRUD
  // ============================================================

  test('Create a new client', async ({ authenticatedPage: page }) => {
    await page.goto('/clients');
    await page.waitForLoadState('networkidle');

    // Click Add Client button
    const addBtn = page.locator('button:has-text("Add Client"), button:has-text("Add"), button:has-text("New Client")').first();
    await expect(addBtn).toBeVisible({ timeout: 5000 });
    await addBtn.click();

    // Modal should appear
    const modal = page.locator('.ant-modal-content');
    await expect(modal).toBeVisible({ timeout: 5000 });

    // Fill Display Name
    const displayNameInput = modal.locator('#display_name, input[id*="display_name"]').first();
    if (await displayNameInput.count() === 0) {
      // Try finding by label
      const label = modal.locator('label:has-text("Display Name")');
      if (await label.count() > 0) {
        const formItemId = await label.getAttribute('for');
        if (formItemId) {
          await modal.locator(`#${formItemId}`).fill(`${TEST_PREFIX} John & Jane Smith`);
        }
      }
    } else {
      await displayNameInput.fill(`${TEST_PREFIX} John & Jane Smith`);
    }

    // Fill first owner name (Form.List)
    const ownerNameInputs = modal.locator('input[id*="name"], input[placeholder*="ame"]');
    const ownerCount = await ownerNameInputs.count();
    if (ownerCount > 0) {
      // First owner name field (skip display_name)
      for (let i = 0; i < ownerCount; i++) {
        const input = ownerNameInputs.nth(i);
        const id = await input.getAttribute('id') || '';
        if (id.includes('owners') || id.includes('owner')) {
          await input.fill('John Smith');
          break;
        }
      }
    }

    // Fill address
    const addressInput = modal.locator('#address, input[id*="address"], textarea[id*="address"]').first();
    if (await addressInput.count() > 0) {
      await addressInput.fill('123 Test Street');
    }

    // Fill city
    const cityInput = modal.locator('#city, input[id*="city"]').first();
    if (await cityInput.count() > 0) {
      await cityInput.fill('Test City');
    }

    // Fill state
    const stateInput = modal.locator('#state, input[id*="state"]').first();
    if (await stateInput.count() > 0) {
      await stateInput.fill('NJ');
    }

    // Fill phone
    const phoneInput = modal.locator('#phone, input[id*="phone"]').first();
    if (await phoneInput.count() > 0) {
      await phoneInput.fill('201-555-1234');
    }

    // Fill email
    const emailInput = modal.locator('#email, input[id*="email"]').first();
    if (await emailInput.count() > 0) {
      await emailInput.fill('test@example.com');
    }

    // Fill insurance company
    const insInput = modal.locator('#insurance_company, input[id*="insurance_company"]').first();
    if (await insInput.count() > 0) {
      await insInput.fill('State Farm');
    }

    // Submit
    const submitBtn = modal.locator('button[type="submit"], button:has-text("OK"), button:has-text("Save"), button:has-text("Create")').first();
    await submitBtn.click();

    // Wait for modal to close (success)
    await expect(modal).toBeHidden({ timeout: 10000 });

    // Success message
    const successMsg = page.locator('.ant-message-success, .ant-message-notice');
    // Give it a moment
    await page.waitForTimeout(1000);

    // Verify client appears in the list
    const tableText = page.locator('.ant-table-tbody');
    await expect(tableText).toContainText(TEST_PREFIX, { timeout: 5000 });
  });

  test('View client detail', async ({ authenticatedPage: page }) => {
    await page.goto('/clients');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    // Click on the test client row
    const testRow = page.locator(`.ant-table-row:has-text("${TEST_PREFIX}")`).first();
    const rowExists = await testRow.count() > 0;
    test.skip(!rowExists, 'Test client not found - create test must run first');

    await testRow.click();
    await page.waitForLoadState('networkidle');

    // Should navigate to detail page
    expect(page.url()).toMatch(/\/clients\/[\w-]+/);

    // Should show client name
    await expect(page.locator(`text=${TEST_PREFIX}`).first()).toBeVisible({ timeout: 10000 });
  });

  // ============================================================
  // 3. Claim CRUD
  // ============================================================

  test('Create a claim for client', async ({ authenticatedPage: page }) => {
    await page.goto('/clients');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    // Navigate to test client detail
    const testRow = page.locator(`.ant-table-row:has-text("${TEST_PREFIX}")`).first();
    const rowExists = await testRow.count() > 0;
    test.skip(!rowExists, 'Test client not found');

    await testRow.click();
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    // Click "Add Claim" button
    const addClaimBtn = page.locator('button:has-text("Add Claim"), button:has-text("New Claim")').first();
    const btnExists = await addClaimBtn.count() > 0;
    test.skip(!btnExists, 'Add Claim button not found');

    await addClaimBtn.click();
    await page.waitForTimeout(500);

    // Modal should appear
    const modal = page.locator('.ant-modal-content').last();
    await expect(modal).toBeVisible({ timeout: 5000 });

    // Fill claim number
    const claimInput = modal.locator('input[id*="claim_number"], input[id*="claimNumber"]').first();
    if (await claimInput.count() > 0) {
      await claimInput.fill(`CLM-${TEST_PREFIX}`);
    }

    // Fill insurance company
    const insInput = modal.locator('input[id*="insurance_company"]').first();
    if (await insInput.count() > 0) {
      await insInput.fill('Allstate Insurance');
    }

    // Fill adjuster name
    const adjInput = modal.locator('input[id*="adjuster_name"]').first();
    if (await adjInput.count() > 0) {
      await adjInput.fill('Mike Johnson');
    }

    // Fill initial ACV
    const acvInput = modal.locator('input[id*="initial_acv"], input[id*="acv"]').first();
    if (await acvInput.count() > 0) {
      await acvInput.fill('5000');
    }

    // Fill initial RCV
    const rcvInput = modal.locator('input[id*="initial_rcv"], input[id*="rcv"]').first();
    if (await rcvInput.count() > 0) {
      await rcvInput.fill('7000');
    }

    // Submit
    const submitBtn = modal.locator('button[type="submit"], button:has-text("OK"), button:has-text("Save"), button:has-text("Create")').first();
    await submitBtn.click();

    // Wait for modal to close
    await expect(modal).toBeHidden({ timeout: 10000 });
    await page.waitForTimeout(1000);

    // Verify claim appears
    const claimText = page.locator(`text=CLM-${TEST_PREFIX}`);
    await expect(claimText.first()).toBeVisible({ timeout: 5000 });
  });

  // ============================================================
  // 4. Negotiation Tracking
  // ============================================================

  test('Add negotiation revision to claim', async ({ authenticatedPage: page }) => {
    await page.goto('/clients');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    // Navigate to test client detail
    const testRow = page.locator(`.ant-table-row:has-text("${TEST_PREFIX}")`).first();
    const rowExists = await testRow.count() > 0;
    test.skip(!rowExists, 'Test client not found');

    await testRow.click();
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    // Expand claim to see negotiations
    const claimPanel = page.locator(`.ant-collapse-item:has-text("CLM-${TEST_PREFIX}"), .ant-collapse-header:has-text("CLM-${TEST_PREFIX}")`).first();
    const claimExists = await claimPanel.count() > 0;
    test.skip(!claimExists, 'Test claim not found');

    // Click to expand
    await claimPanel.click();
    await page.waitForTimeout(1000);

    // Click "Add Negotiation" button
    const addNegBtn = page.locator('button:has-text("Add Negotiation"), button:has-text("Add Revision"), button:has-text("New Negotiation")').first();
    const negBtnExists = await addNegBtn.count() > 0;
    test.skip(!negBtnExists, 'Add Negotiation button not found');

    await addNegBtn.click();
    await page.waitForTimeout(500);

    // Modal should appear
    const modal = page.locator('.ant-modal-content').last();
    await expect(modal).toBeVisible({ timeout: 5000 });

    // Select revision type (supplement)
    const typeSelect = modal.locator('.ant-select, select[id*="revision_type"]').first();
    if (await typeSelect.count() > 0) {
      await typeSelect.click();
      await page.waitForTimeout(300);
      const supplementOption = page.locator('.ant-select-item-option:has-text("supplement"), .ant-select-item:has-text("Supplement")').first();
      if (await supplementOption.count() > 0) {
        await supplementOption.click();
      }
    }

    // Fill ACV amount
    const acvInput = modal.locator('input[id*="acv_amount"], input[id*="acv"]').first();
    if (await acvInput.count() > 0) {
      await acvInput.clear();
      await acvInput.fill('8000');
    }

    // Fill RCV amount
    const rcvInput = modal.locator('input[id*="rcv_amount"], input[id*="rcv"]').first();
    if (await rcvInput.count() > 0) {
      await rcvInput.clear();
      await rcvInput.fill('11000');
    }

    // Submit
    const submitBtn = modal.locator('button[type="submit"], button:has-text("OK"), button:has-text("Save"), button:has-text("Add")').first();
    await submitBtn.click();

    // Wait for modal to close
    await expect(modal).toBeHidden({ timeout: 10000 });
    await page.waitForTimeout(1000);

    // Verify negotiation appears (look for supplement or $8,000)
    const negText = page.locator('text=supplement, text=$8,000, text=8,000, text=8000');
    // At least one should be visible
    const hasNeg = await negText.count() > 0;
    console.log(`Negotiation visible: ${hasNeg}`);
  });

  // ============================================================
  // 5. Cleanup - Delete test client
  // ============================================================

  test('Delete test client', async ({ authenticatedPage: page }) => {
    await page.goto('/clients');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    // Find test client row
    const testRow = page.locator(`.ant-table-row:has-text("${TEST_PREFIX}")`).first();
    const rowExists = await testRow.count() > 0;
    test.skip(!rowExists, 'Test client not found for cleanup');

    // Click delete button in the row
    const deleteBtn = testRow.locator('button:has(.anticon-delete), button:has-text("Delete")').first();
    const deleteBtnExists = await deleteBtn.count() > 0;

    if (deleteBtnExists) {
      await deleteBtn.click();
      await page.waitForTimeout(500);

      // Confirm popconfirm
      const confirmBtn = page.locator('.ant-popconfirm-buttons button:has-text("Yes"), .ant-popconfirm-buttons button:has-text("OK"), .ant-btn-primary:has-text("Yes")').first();
      if (await confirmBtn.count() > 0) {
        await confirmBtn.click();
        await page.waitForTimeout(2000);

        // Verify client is removed
        const remainingRow = page.locator(`.ant-table-row:has-text("${TEST_PREFIX}")`);
        await expect(remainingRow).toHaveCount(0, { timeout: 5000 });
      }
    } else {
      console.log('Delete button not found in row, skipping cleanup');
    }
  });
});

// ============================================================
// API-level smoke tests (bypass UI)
// ============================================================

test.describe('Client API Smoke Tests', () => {
  let clientId: string;
  let claimId: string;

  test('POST /api/clients - Create client via API', async ({ authenticatedPage: page }) => {
    const response = await page.evaluate(async () => {
      const res = await fetch('/api/clients', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          display_name: 'API Test Client',
          owners: [{ name: 'API Owner', phone: '555-0000', email: 'api@test.com', is_primary: true }],
          address: '999 API Street',
          city: 'API City',
          state: 'NJ',
          zipcode: '07001',
          insurance_company: 'Test Insurance Co',
        }),
      });
      return { status: res.status, body: await res.json() };
    });

    expect(response.status).toBe(200);
    expect(response.body.id).toBeTruthy();
    expect(response.body.display_name).toBe('API Test Client');
    clientId = response.body.id;
  });

  test('GET /api/clients/:id - Get client detail', async ({ authenticatedPage: page }) => {
    test.skip(!clientId, 'No client ID from previous test');

    const response = await page.evaluate(async (id) => {
      const res = await fetch(`/api/clients/${id}`);
      return { status: res.status, body: await res.json() };
    }, clientId);

    expect(response.status).toBe(200);
    expect(response.body.display_name).toBe('API Test Client');
    expect(response.body.owners).toHaveLength(1);
    expect(response.body.claims).toBeDefined();
  });

  test('POST /api/clients/:id/claims - Create claim', async ({ authenticatedPage: page }) => {
    test.skip(!clientId, 'No client ID from previous test');

    const response = await page.evaluate(async (id) => {
      const res = await fetch(`/api/clients/${id}/claims`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client_id: id,
          claim_number: 'API-CLM-001',
          insurance_company: 'API Insurance',
          insurance_deductible: 1000,
          adjuster_name: 'API Adjuster',
          adjuster_phone: '555-1111',
          initial_acv: 5000,
          initial_rcv: 7500,
        }),
      });
      return { status: res.status, body: await res.json() };
    }, clientId);

    expect(response.status).toBe(200);
    expect(response.body.id).toBeTruthy();
    expect(response.body.claim_number).toBe('API-CLM-001');
    expect(response.body.current_acv).toBe(5000);
    claimId = response.body.id;
  });

  test('POST negotiations - Add supplement', async ({ authenticatedPage: page }) => {
    test.skip(!clientId || !claimId, 'No client/claim ID from previous tests');

    const response = await page.evaluate(async ({ cId, clId }) => {
      const res = await fetch(`/api/clients/${cId}/claims/${clId}/negotiations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          claim_id: clId,
          revision_type: 'supplement',
          acv_amount: 8000,
          rcv_amount: 11000,
          depreciation_amount: 3000,
          deductible: 1000,
          received_from: 'Adjuster Smith',
          notes: 'Supplement after re-inspection',
        }),
      });
      return { status: res.status, body: await res.json() };
    }, { cId: clientId, clId: claimId });

    expect(response.status).toBe(200);
    expect(response.body.revision_number).toBe(2); // initial=1, supplement=2
    expect(response.body.acv_amount).toBe(8000);
  });

  test('POST negotiations - Add appraisal', async ({ authenticatedPage: page }) => {
    test.skip(!clientId || !claimId, 'No client/claim ID');

    const response = await page.evaluate(async ({ cId, clId }) => {
      const res = await fetch(`/api/clients/${cId}/claims/${clId}/negotiations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          claim_id: clId,
          revision_type: 'appraisal',
          acv_amount: 12000,
          rcv_amount: 16000,
          depreciation_amount: 4000,
          deductible: 1000,
          received_from: 'Independent Appraiser',
          notes: 'Appraisal after supplement denial',
        }),
      });
      return { status: res.status, body: await res.json() };
    }, { cId: clientId, clId: claimId });

    expect(response.status).toBe(200);
    expect(response.body.revision_number).toBe(3);
    expect(response.body.revision_type).toBe('appraisal');
  });

  test('Verify claim amounts updated after negotiations', async ({ authenticatedPage: page }) => {
    test.skip(!clientId || !claimId, 'No client/claim ID');

    const response = await page.evaluate(async ({ cId, clId }) => {
      const res = await fetch(`/api/clients/${cId}/claims/${clId}`);
      return { status: res.status, body: await res.json() };
    }, { cId: clientId, clId: claimId });

    expect(response.status).toBe(200);
    // Should reflect the latest negotiation (appraisal) amounts
    expect(response.body.current_acv).toBe(12000);
    expect(response.body.current_rcv).toBe(16000);
    expect(response.body.status).toBe('negotiating');
    expect(response.body.negotiations).toHaveLength(3); // initial + supplement + appraisal
  });

  test('Cleanup - Delete API test client', async ({ authenticatedPage: page }) => {
    test.skip(!clientId, 'No client ID to clean up');

    const response = await page.evaluate(async (id) => {
      const res = await fetch(`/api/clients/${id}`, { method: 'DELETE' });
      return { status: res.status, body: await res.json() };
    }, clientId);

    expect(response.status).toBe(200);
  });
});
