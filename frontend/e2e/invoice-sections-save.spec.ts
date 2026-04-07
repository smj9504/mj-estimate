import { test, expect } from '@playwright/test';

const API = 'http://localhost:8000';

// Helper: login and get token
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

// Helper: get the first company ID
async function getFirstCompanyId(token: string): Promise<string> {
  const res = await fetch(`${API}/api/companies/`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`Failed to fetch companies: ${res.status}`);
  const data = await res.json();
  // API returns { items: [...] } (paginated) or plain array
  const companies = Array.isArray(data) ? data : (data.items || []);
  if (!companies.length) throw new Error('No companies found');
  return companies[0].id;
}

test.describe('Invoice Sections Persist After Save (API)', () => {

  test('create invoice with multiple sections - sections should be preserved on reload', async () => {
    const token = await getAuthToken();
    const companyId = await getFirstCompanyId(token);

    // Build invoice payload with 3 sections, each section's items have primary_group + sort_order
    const items = [
      // Section 1: Water Extraction (sort_order 0xxx)
      { name: 'Extract standing water', description: 'Extract standing water', quantity: 500, unit: 'SF', rate: 1.25, taxable: true, primary_group: 'Water Extraction', sort_order: 0 },
      { name: 'Pump rental', description: 'Pump rental', quantity: 2, unit: 'EA', rate: 150.0, taxable: false, primary_group: 'Water Extraction', sort_order: 1 },
      // Section 2: Structural Drying (sort_order 1xxx)
      { name: 'Air mover placement', description: 'Air mover placement', quantity: 6, unit: 'EA', rate: 75.0, taxable: true, primary_group: 'Structural Drying', sort_order: 1000 },
      { name: 'Dehumidifier rental', description: 'Dehumidifier rental', quantity: 3, unit: 'EA', rate: 200.0, taxable: true, primary_group: 'Structural Drying', sort_order: 1001 },
      // Section 3: Demolition (sort_order 2xxx)
      { name: 'Remove wet drywall', description: 'Remove wet drywall', quantity: 200, unit: 'SF', rate: 2.50, taxable: true, primary_group: 'Demolition', sort_order: 2000 },
    ];

    const invoiceData = {
      invoice_number: `TEST-SECT-${Date.now()}`,
      date: '04-07-2026',
      due_date: '05-07-2026',
      status: 'pending',
      company_id: companyId,
      client: {
        name: 'Section Test Client',
        address: '123 Test St',
        city: 'Austin',
        state: 'TX',
        zipcode: '78701',
      },
      items,
      subtotal: 2275.0,
      tax_rate: 8.25,
      tax_method: 'percentage',
      total: 2462.69,
      payments: [],
      balance_due: 2462.69,
      payment_terms: 'Net 30',
      notes: 'Multi-section test invoice',
    };

    // CREATE the invoice
    const createRes = await fetch(`${API}/api/invoices`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(invoiceData),
    });

    expect(createRes.status).toBeLessThan(400);
    const created = await createRes.json();
    const invoiceId = created.id;
    expect(invoiceId).toBeTruthy();

    // FETCH the invoice back
    const getRes = await fetch(`${API}/api/invoices/${invoiceId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(getRes.status).toBe(200);
    const fetched = await getRes.json();

    // VERIFY: items still have their primary_group values
    const fetchedItems = fetched.items || [];
    expect(fetchedItems.length).toBe(5);

    // Group items by primary_group
    const groups: Record<string, any[]> = {};
    for (const item of fetchedItems) {
      const group = item.primary_group || 'Default Section';
      if (!groups[group]) groups[group] = [];
      groups[group].push(item);
    }

    // There should be exactly 3 groups (not 1 "Default Section")
    const groupNames = Object.keys(groups);
    expect(groupNames).toContain('Water Extraction');
    expect(groupNames).toContain('Structural Drying');
    expect(groupNames).toContain('Demolition');
    expect(groupNames).not.toContain('Default Section');

    // Verify item count per section
    expect(groups['Water Extraction'].length).toBe(2);
    expect(groups['Structural Drying'].length).toBe(2);
    expect(groups['Demolition'].length).toBe(1);

    // Verify sort_order is preserved
    const waterItems = groups['Water Extraction'].sort((a: any, b: any) => a.sort_order - b.sort_order);
    expect(waterItems[0].name).toBe('Extract standing water');
    expect(waterItems[0].sort_order).toBe(0);
    expect(waterItems[1].name).toBe('Pump rental');
    expect(waterItems[1].sort_order).toBe(1);

    const dryingItems = groups['Structural Drying'].sort((a: any, b: any) => a.sort_order - b.sort_order);
    expect(dryingItems[0].name).toBe('Air mover placement');
    expect(dryingItems[0].sort_order).toBe(1000);

    const demoItems = groups['Demolition'];
    expect(demoItems[0].name).toBe('Remove wet drywall');
    expect(demoItems[0].sort_order).toBe(2000);

    // Cleanup: delete the test invoice
    await fetch(`${API}/api/invoices/${invoiceId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });
  });

  test('update invoice with sections - sections should persist after update', async () => {
    const token = await getAuthToken();
    const companyId = await getFirstCompanyId(token);

    const items = [
      { name: 'Item A', description: 'Item A', quantity: 1, unit: 'EA', rate: 100, taxable: true, primary_group: 'Section Alpha', sort_order: 0 },
      { name: 'Item B', description: 'Item B', quantity: 2, unit: 'EA', rate: 200, taxable: true, primary_group: 'Section Beta', sort_order: 1000 },
    ];

    const invoiceData = {
      invoice_number: `TEST-UPD-${Date.now()}`,
      date: '04-07-2026',
      due_date: '05-07-2026',
      status: 'pending',
      company_id: companyId,
      client: { name: 'Update Test Client' },
      items,
      subtotal: 500,
      tax_rate: 0,
      tax_method: 'percentage',
      total: 500,
      payments: [],
      balance_due: 500,
      payment_terms: 'Net 30',
    };

    // CREATE
    const createRes = await fetch(`${API}/api/invoices`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(invoiceData),
    });
    expect(createRes.status).toBeLessThan(400);
    const created = await createRes.json();
    const invoiceId = created.id;

    // FETCH after create
    const getRes1 = await fetch(`${API}/api/invoices/${invoiceId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const fetched1 = await getRes1.json();

    // Verify sections preserved after create
    const groups1: Record<string, any[]> = {};
    for (const item of fetched1.items || []) {
      const group = item.primary_group || 'Default Section';
      if (!groups1[group]) groups1[group] = [];
      groups1[group].push(item);
    }
    expect(Object.keys(groups1)).toContain('Section Alpha');
    expect(Object.keys(groups1)).toContain('Section Beta');
    expect(Object.keys(groups1)).not.toContain('Default Section');

    // UPDATE - add a third section
    const updatedItems = [
      ...items,
      { name: 'Item C', description: 'Item C', quantity: 3, unit: 'EA', rate: 300, taxable: true, primary_group: 'Section Gamma', sort_order: 2000 },
    ];

    const updateRes = await fetch(`${API}/api/invoices/${invoiceId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ ...invoiceData, items: updatedItems, subtotal: 1400, total: 1400, balance_due: 1400 }),
    });
    expect(updateRes.status).toBeLessThan(400);

    // FETCH after update
    const getRes2 = await fetch(`${API}/api/invoices/${invoiceId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const fetched2 = await getRes2.json();

    // Verify all 3 sections preserved after update
    const groups2: Record<string, any[]> = {};
    for (const item of fetched2.items || []) {
      const group = item.primary_group || 'Default Section';
      if (!groups2[group]) groups2[group] = [];
      groups2[group].push(item);
    }
    expect(Object.keys(groups2)).toContain('Section Alpha');
    expect(Object.keys(groups2)).toContain('Section Beta');
    expect(Object.keys(groups2)).toContain('Section Gamma');
    expect(Object.keys(groups2)).not.toContain('Default Section');
    expect(groups2['Section Gamma'][0].name).toBe('Item C');

    // Cleanup
    await fetch(`${API}/api/invoices/${invoiceId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });
  });
});
