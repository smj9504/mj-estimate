/**
 * Network fixture for the flooring estimate tests.
 *
 * The estimate responses are what the real service returns for a sample
 * house (flooring-estimate-*.json, written from the backend's own service):
 * a living room, an L-shaped kitchen, a hall, two bedrooms with a closet and
 * a bath. Saves are recorded for the test to inspect and echoed back; a
 * calculation answers with the calculated estimate.
 */

import fs from 'fs';
import path from 'path';
import type { Page, Route } from '@playwright/test';

export const ESTIMATE_ID = '33333333-3333-3333-3333-333333333333';

const read = (name: string) => JSON.parse(fs.readFileSync(path.join(__dirname, name), 'utf8'));
const DRAFT = read('flooring-estimate-draft.json');
const CALCULATED = read('flooring-estimate-calculated.json');
const PRICING = read('flooring-pricing-info.json');

const USER = {
  id: '99999999-9999-9999-9999-999999999999',
  username: 'admin',
  email: 'admin@example.com',
  full_name: 'Admin',
  role: 'admin',
  is_active: true,
  is_superuser: true,
};

const json = (route: Route, body: unknown, status = 200) =>
  route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

export interface EstimateApi {
  /** Bodies of every PUT to the estimate, oldest first */
  updates: Record<string, any>[];
  calculations: number;
  created: number;
  pdfs: number;
  lastUpdate(): Record<string, any> | undefined;
}

export async function mockFlooringEstimateApi(page: Page, start: 'draft' | 'calculated' = 'draft'): Promise<EstimateApi> {
  await page.addInitScript(
    ([user]) => {
      localStorage.setItem('auth_token', 'e2e-test-token');
      localStorage.setItem('auth_user', JSON.stringify(user));
    },
    [USER],
  );
  const api: EstimateApi = {
    updates: [],
    calculations: 0,
    created: 0,
    pdfs: 0,
    lastUpdate() {
      return this.updates[this.updates.length - 1];
    },
  };
  let current = structuredClone(start === 'draft' ? DRAFT : CALCULATED);
  const base = `/api/flooring-estimates`;

  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url());
    const p = url.pathname;
    const method = route.request().method();

    if (p.endsWith('/api/auth/me')) return json(route, USER);
    if (p.endsWith(`${base}/pricing-info`)) return json(route, PRICING);
    if (p.endsWith(`${base}/${ESTIMATE_ID}/calculate`)) {
      api.calculations += 1;
      current = { ...structuredClone(CALCULATED), room_scopes: current.room_scopes, job_scope: current.job_scope };
      return json(route, current);
    }
    if (p.endsWith(`${base}/${ESTIMATE_ID}/export/pdf`)) {
      api.pdfs += 1;
      return route.fulfill({
        status: 200,
        contentType: 'application/pdf',
        headers: { 'content-disposition': 'attachment; filename="flooring_estimate_123_Example_St.pdf"' },
        body: '%PDF-1.4\n%%EOF\n',
      });
    }
    if (p.endsWith(`${base}/${ESTIMATE_ID}/sketch`)) {
      current = { ...current, sketch_data: route.request().postDataJSON().sketch_data };
      return json(route, current);
    }
    if (p.endsWith(`${base}/${ESTIMATE_ID}`)) {
      if (method === 'PUT') {
        const body = route.request().postDataJSON();
        api.updates.push(body);
        current = { ...current, ...body };
      }
      return json(route, current);
    }
    if (p.endsWith(base) && method === 'POST') {
      api.created += 1;
      return json(route, current);
    }
    if (p.endsWith(base)) return json(route, { items: [current], total: 1, page: 1, page_size: 20 });
    return json(route, []);
  });
  return api;
}
