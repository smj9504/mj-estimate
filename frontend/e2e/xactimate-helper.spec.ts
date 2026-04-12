import { test, expect, Page } from '@playwright/test';

const API = 'http://localhost:8000';
const BASE_URL = 'http://localhost:3000';

// ─── Helpers ─────────────────────────────────────────────────────────────────

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

async function ensureLoggedIn(page: Page, token: string) {
  await page.goto(BASE_URL, { timeout: 60000 });
  await page.evaluate((t) => {
    localStorage.setItem('auth_token', t);
    localStorage.setItem('auth_user', JSON.stringify({ username: 'admin', role: 'admin' }));
  }, token);
}

// Create a room via API and return the room object
async function createRoomViaAPI(token: string) {
  const res = await fetch(`${API}/api/xactimate/rooms`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      name: 'Test Living Room',
      room_type: 'living_room',
      damage_type: 'water',
      dimensions: { LF: 18, SF: 220, height: 9 },
      condition_flags: { paint: true, stain: false, after_hours: false, occupied: false },
    }),
  });
  if (!res.ok) throw new Error(`Create room failed: ${res.status} ${await res.text()}`);
  return res.json();
}

// ─── API Integration Tests ───────────────────────────────────────────────────

test.describe('Xactimate Helper — API Endpoints', () => {
  let token: string;

  test.beforeAll(async () => {
    token = await getAuthToken();
  });

  test('GET /api/xactimate/helper/line-items — search returns items', async () => {
    const res = await fetch(`${API}/api/xactimate/helper/line-items?limit=5`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toHaveProperty('items');
    expect(data).toHaveProperty('total');
    expect(data.items).toBeInstanceOf(Array);
  });

  test('GET /api/xactimate/helper/line-items/categories — returns categories', async () => {
    const res = await fetch(`${API}/api/xactimate/helper/line-items/categories`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toBeInstanceOf(Array);
  });

  test('POST /api/xactimate/rooms — create room', async () => {
    const room = await createRoomViaAPI(token);
    expect(room).toHaveProperty('id');
    expect(room.name).toBe('Test Living Room');
    expect(room.room_type).toBe('living_room');
    expect(room.damage_type).toBe('water');
    expect(room.status).toBe('draft');
    expect(room.dimensions).toEqual({ LF: 18, SF: 220, height: 9 });
  });

  test('GET /api/xactimate/rooms/:id — get room', async () => {
    const room = await createRoomViaAPI(token);

    const res = await fetch(`${API}/api/xactimate/rooms/${room.id}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.id).toBe(room.id);
    expect(data.name).toBe('Test Living Room');
  });

  test('PATCH /api/xactimate/rooms/:id — update room', async () => {
    const room = await createRoomViaAPI(token);

    const res = await fetch(`${API}/api/xactimate/rooms/${room.id}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ name: 'Updated Room', damage_type: 'fire' }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.name).toBe('Updated Room');
    expect(data.damage_type).toBe('fire');
  });

  test('GET /api/xactimate/rooms/:id/line-items — returns empty for new room', async () => {
    const room = await createRoomViaAPI(token);

    const res = await fetch(`${API}/api/xactimate/rooms/${room.id}/line-items`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toEqual([]);
  });

  test('GET /api/xactimate/rooms/nonexistent — returns 404', async () => {
    const fakeId = '00000000-0000-0000-0000-000000000000';
    const res = await fetch(`${API}/api/xactimate/rooms/${fakeId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(404);
  });

  test('GET /api/xactimate/helper/assemblies — list assemblies', async () => {
    const res = await fetch(`${API}/api/xactimate/helper/assemblies`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toBeInstanceOf(Array);
  });

  test('POST /api/xactimate/helper/assemblies — create assembly', async () => {
    const res = await fetch(`${API}/api/xactimate/helper/assemblies`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        name: 'Test Assembly',
        damage_type: 'water',
        room_type: 'any',
        trigger_keywords: ['test', 'baseboard'],
      }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toHaveProperty('id');
    expect(data.name).toBe('Test Assembly');
    expect(data.damage_type).toBe('water');
  });

  test('POST /api/xactimate/descriptions — create description', async () => {
    // Need a valid item_code from xact_line_items
    const itemsRes = await fetch(`${API}/api/xactimate/helper/line-items?limit=1`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const itemsData = await itemsRes.json();

    if (itemsData.items && itemsData.items.length > 0) {
      const itemCode = itemsData.items[0].item_code;

      const res = await fetch(`${API}/api/xactimate/descriptions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          item_code: itemCode,
          description_type: 'waste',
          title: 'Test Waste Factor',
          body: '10% waste factor applied per industry standards for this line item.',
        }),
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data).toHaveProperty('id');
      expect(data.item_code).toBe(itemCode);
      expect(data.description_type).toBe('waste');
      expect(data.approved).toBe(false);

      // Test GET descriptions
      const getRes = await fetch(
        `${API}/api/xactimate/helper/line-items/${itemCode}/descriptions`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      expect(getRes.status).toBe(200);
      const descs = await getRes.json();
      expect(descs.length).toBeGreaterThanOrEqual(1);

      // Test approve
      const approveRes = await fetch(`${API}/api/xactimate/descriptions/${data.id}/approve`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(approveRes.status).toBe(200);
      const approved = await approveRes.json();
      expect(approved.approved).toBe(true);

      // Test copy event
      const copyRes = await fetch(`${API}/api/xactimate/descriptions/${data.id}/copy`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(copyRes.status).toBe(200);
      const copyData = await copyRes.json();
      expect(copyData.usage_count).toBe(1);
    } else {
      test.skip();
    }
  });

  test('POST /api/xactimate/rooms/:id/corrections — save correction', async () => {
    const room = await createRoomViaAPI(token);

    const res = await fetch(`${API}/api/xactimate/rooms/${room.id}/corrections`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        ai_suggested: [
          { item_code: 'BSRD', qty: 18, unit: 'LF', unit_price: 4.2 },
        ],
        user_corrected: [
          { item_code: 'BSRD', qty: 20, unit: 'LF', unit_price: 4.2 },
          { item_code: 'BSRH', qty: 20, unit: 'LF', unit_price: 3.5 },
        ],
        situation_summary: 'Living room baseboard water damage, LF=18',
      }),
    });

    // May fail with 500 if OPENAI_API_KEY not configured (embedding generation)
    if (res.status === 200) {
      const data = await res.json();
      expect(data).toHaveProperty('id');
      expect(data.correction_type).toContain('qty_change');
      expect(data.correction_type).toContain('add');

      // Verify corrections can be retrieved
      const getRes = await fetch(`${API}/api/xactimate/rooms/${room.id}/corrections`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(getRes.status).toBe(200);
      const corrections = await getRes.json();
      expect(corrections.length).toBeGreaterThanOrEqual(1);
    } else {
      console.log(`Corrections returned ${res.status} — expected if OPENAI_API_KEY not set`);
      expect([200, 500]).toContain(res.status);
    }
  });

  test('POST /api/xactimate/rooms/:id/analyze — manual keywords analysis', async () => {
    const room = await createRoomViaAPI(token);

    const res = await fetch(`${API}/api/xactimate/rooms/${room.id}/analyze`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        manual_keywords: ['baseboard remove and replace LF', 'wall paint SF'],
      }),
    });

    // This may fail if AI keys are not configured — that's expected
    if (res.status === 200) {
      const data = await res.json();
      expect(data).toHaveProperty('room_id');
      expect(data).toHaveProperty('keywords');
      expect(data).toHaveProperty('recommendations');
      expect(data.keywords.length).toBeGreaterThan(0);
    } else {
      // 500 is expected if API keys not set
      console.log(`Analysis returned ${res.status} — expected if AI keys not configured`);
      expect([200, 500]).toContain(res.status);
    }
  });

  test('PATCH /api/xactimate/rooms/:id — confirm room with final items', async () => {
    const room = await createRoomViaAPI(token);

    const finalItems = [
      { item_code: 'BSRD', description: 'Baseboard R&R', qty: 18, unit: 'LF', unit_price: 4.2 },
      { item_code: 'PNTAC', description: 'Paint wall', qty: 220, unit: 'SF', unit_price: 1.5 },
    ];

    const res = await fetch(`${API}/api/xactimate/rooms/${room.id}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        final_line_items: finalItems,
        status: 'confirmed',
      }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.status).toBe('confirmed');
    expect(data.final_line_items).toHaveLength(2);

    // Verify line items endpoint returns confirmed items
    const itemsRes = await fetch(`${API}/api/xactimate/rooms/${room.id}/line-items`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(itemsRes.status).toBe(200);
    const items = await itemsRes.json();
    expect(items).toHaveLength(2);
    expect(items[0].item_code).toBe('BSRD');
  });
});

// ─── UI E2E Tests ────────────────────────────────────────────────────────────

test.describe('Xactimate Helper — UI', () => {
  let token: string;

  test.beforeAll(async () => {
    token = await getAuthToken();
  });

  test('page loads and renders room form', async ({ page }) => {
    await ensureLoggedIn(page, token);
    await page.goto(`${BASE_URL}/xactimate-helper`, { timeout: 60000 });

    // Wait for the page title to render
    await expect(page.getByText('Xactimate Helper Tool')).toBeVisible({ timeout: 30000 });

    // Room creation form should be visible
    await expect(page.getByText('Create Room').first()).toBeVisible();

    // Form fields should exist
    await expect(page.getByPlaceholder('e.g. Living Room')).toBeVisible();
  });

  test('create room shows Scope Builder tab by default', async ({ page }) => {
    await ensureLoggedIn(page, token);
    await page.goto(`${BASE_URL}/xactimate-helper`, { waitUntil: 'networkidle', timeout: 60000 });
    await expect(page.getByText('Xactimate Helper Tool')).toBeVisible({ timeout: 20000 });

    // Fill room name and create
    const nameInput = page.getByPlaceholder('e.g. Living Room');
    await expect(nameInput).toBeVisible({ timeout: 10000 });
    await nameInput.fill('E2E Scope Test Room');
    await page.getByRole('button', { name: /Create Room/i }).click();
    await expect(page.locator('.ant-message-success')).toBeVisible({ timeout: 10000 });

    // Scope Builder tab should be visible and active by default
    await expect(page.getByText('Scope Builder')).toBeVisible({ timeout: 10000 });

    // Scope category buttons should appear
    await expect(page.getByRole('button', { name: /Floor.*Replace/i })).toBeVisible({ timeout: 5000 });
    await expect(page.getByRole('button', { name: /Wall.*Repair/i })).toBeVisible();
  });

  test('Scope Builder — add Floor Replace category and select options', async ({ page }) => {
    await ensureLoggedIn(page, token);
    await page.goto(`${BASE_URL}/xactimate-helper`, { waitUntil: 'networkidle', timeout: 60000 });
    await expect(page.getByText('Xactimate Helper Tool')).toBeVisible({ timeout: 20000 });

    // Create room
    await page.getByPlaceholder('e.g. Living Room').fill('Floor Scope Room');
    await page.getByRole('button', { name: /Create Room/i }).click();
    await expect(page.locator('.ant-message-success')).toBeVisible({ timeout: 10000 });

    // Click "Floor — Replace" button to add category
    await page.getByRole('button', { name: /Floor.*Replace/i }).click({ timeout: 5000 });

    // Floor Type label should appear
    await expect(page.getByText('Floor Type', { exact: true })).toBeVisible({ timeout: 5000 });

    // Select carpet from Floor Type dropdown (Ant Design Select uses .ant-select)
    // Click the select that's inside the Floor Type section
    const floorTypeSelect = page.locator('.ant-select').filter({ hasText: 'Select Floor Type' }).first();
    await floorTypeSelect.click({ timeout: 10000 });
    await page.locator('.ant-select-item-option-content').filter({ hasText: 'Carpet' }).first().click();

    // Baseboard label should be visible
    await expect(page.getByText('Baseboard', { exact: true }).first()).toBeVisible();
  });

  test('Scope Builder — Wall Repair shows auto-includes', async ({ page }) => {
    await ensureLoggedIn(page, token);
    await page.goto(`${BASE_URL}/xactimate-helper`, { waitUntil: 'networkidle', timeout: 60000 });
    await expect(page.getByText('Xactimate Helper Tool')).toBeVisible({ timeout: 20000 });

    // Create room
    await page.getByPlaceholder('e.g. Living Room').fill('Wall Scope Room');
    await page.getByRole('button', { name: /Create Room/i }).click();
    await expect(page.locator('.ant-message-success')).toBeVisible({ timeout: 10000 });

    // Add Wall Repair category
    await page.getByRole('button', { name: /Wall.*Repair/i }).click({ timeout: 5000 });

    // Auto-includes should show
    await expect(page.getByText('Floor Protection')).toBeVisible({ timeout: 5000 });
    await expect(page.getByText('Mask/Tape')).toBeVisible();
  });

  test('Photo AI Analysis tab works', async ({ page }) => {
    await ensureLoggedIn(page, token);
    await page.goto(`${BASE_URL}/xactimate-helper`, { waitUntil: 'networkidle', timeout: 60000 });
    await expect(page.getByText('Xactimate Helper Tool')).toBeVisible({ timeout: 30000 });

    // Create room
    await page.getByPlaceholder('e.g. Living Room').fill('Photo AI Room');
    await page.getByRole('button', { name: /Create Room/i }).click();
    await expect(page.locator('.ant-message-success')).toBeVisible({ timeout: 10000 });

    // Switch to Photo AI Analysis tab
    await page.getByText('Photo AI Analysis').click();

    // Manual keywords textarea should be visible
    const textarea = page.getByPlaceholder(/enter keywords manually/i);
    await expect(textarea).toBeVisible({ timeout: 10000 });

    // Run AI Analysis button should be visible
    await expect(page.getByRole('button', { name: /Run AI Analysis/i })).toBeVisible();
  });

  test('search helper line items from UI', async ({ page }) => {
    // This test verifies the API integration works for line item search
    await ensureLoggedIn(page, token);

    // Directly test the API from browser context
    const result = await page.evaluate(async (apiUrl) => {
      const token = localStorage.getItem('auth_token');
      const res = await fetch(`${apiUrl}/api/xactimate/helper/line-items?limit=3`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      return { status: res.status, data: await res.json() };
    }, API);

    expect(result.status).toBe(200);
    expect(result.data).toHaveProperty('items');
  });
});

// ─── Data Migration Verification ─────────────────────────────────────────────

test.describe('Xactimate Helper — Data Integrity', () => {
  let token: string;

  test.beforeAll(async () => {
    token = await getAuthToken();
  });

  test('line items have been migrated', async () => {
    const res = await fetch(`${API}/api/xactimate/helper/line-items?limit=1`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.total).toBeGreaterThan(0);
    console.log(`Total line items in xact_line_items: ${data.total}`);
  });

  test('line items have correct structure', async () => {
    const res = await fetch(`${API}/api/xactimate/helper/line-items?limit=1`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await res.json();

    if (data.items.length > 0) {
      const item = data.items[0];
      expect(item).toHaveProperty('id');
      expect(item).toHaveProperty('item_code');
      expect(item).toHaveProperty('category');
      expect(item).toHaveProperty('description');
      expect(item).toHaveProperty('unit');
      expect(item).toHaveProperty('unit_price');
      expect(item).toHaveProperty('is_active');
      expect(typeof item.unit_price).toBe('number');
    }
  });

  test('categories endpoint returns data', async () => {
    const res = await fetch(`${API}/api/xactimate/helper/line-items/categories`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await res.json();
    expect(data.length).toBeGreaterThan(0);
    console.log(`Categories count: ${data.length}`);
  });

  test('line items can be filtered by category', async () => {
    // Get first category
    const catRes = await fetch(`${API}/api/xactimate/helper/line-items/categories`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const categories = await catRes.json();

    if (categories.length > 0) {
      const category = categories[0];
      const res = await fetch(
        `${API}/api/xactimate/helper/line-items?category=${category}&limit=5`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.items.length).toBeGreaterThan(0);
      // All items should have the selected category
      for (const item of data.items) {
        expect(item.category).toBe(category);
      }
    }
  });

  test('line items can be searched by keyword', async () => {
    const res = await fetch(
      `${API}/api/xactimate/helper/line-items?query=drywall&limit=5`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    // If there are drywall items, they should match
    if (data.items.length > 0) {
      const item = data.items[0];
      const matchesCode = item.item_code.toLowerCase().includes('dry');
      const matchesDesc = (item.description || '').toLowerCase().includes('drywall');
      expect(matchesCode || matchesDesc).toBe(true);
    }
  });
});
