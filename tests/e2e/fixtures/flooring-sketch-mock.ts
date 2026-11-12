/**
 * Network fixture for the flooring sketch tests.
 *
 * The sketch editor is front-end behaviour (Konva canvas, typed lengths,
 * autosave), so these tests stub the API instead of needing a backend. The
 * estimate is answered from here; a sketch save is kept, so a reload shows
 * what was saved, and every save is recorded for the test to inspect.
 */

import type { Locator, Page, Route } from '@playwright/test';

export const ESTIMATE_ID = '33333333-3333-3333-3333-333333333333';

const USER = {
  id: '99999999-9999-9999-9999-999999999999',
  username: 'admin',
  email: 'admin@example.com',
  full_name: 'Admin',
  role: 'admin',
  is_active: true,
  is_superuser: true,
};

export interface FtPoint {
  x: number;
  y: number;
}

export interface SavedSketch {
  version: number;
  units: string;
  levels: {
    id: string;
    name: string;
    rooms: { id: string; name: string; height_ft: number; points: FtPoint[]; subroom_of?: string | null }[];
    openings: { id: string; kind: string; rooms: (string | null)[]; a: FtPoint; b: FtPoint }[];
    cabinet_runs: { id: string; room_id: string; a: FtPoint; b: FtPoint }[];
    fixtures: { id: string; type: string; x: number; y: number; w: number; h: number }[];
  }[];
}

function estimate(sketch: SavedSketch | null) {
  return {
    id: ESTIMATE_ID,
    claim_id: null,
    company_id: null,
    status: 'draft',
    group_id: ESTIMATE_ID,
    project_type: 'insurance',
    kind: 'restore',
    option_label: null,
    property_address: '123 Example St',
    city: 'Anytown',
    state: 'VA',
    zip_code: '22000',
    sketch_data: sketch,
    room_scopes: {},
    job_scope: {},
    overview_text: null,
    include_overhead_profit: false,
    overhead_pct: 0.1,
    profit_pct: 0.1,
    subtotal: 0,
    total: 0,
    warning_flags: [],
    line_items: [],
    takeoff: { rooms: [], general_items: [], warnings: [] },
    claim_number: null,
    client_name: null,
    created_at: '2026-11-12T00:00:00Z',
    updated_at: '2026-11-12T00:00:00Z',
  };
}

const json = (route: Route, body: unknown, status = 200) =>
  route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

export interface FlooringApi {
  /** Every sketch the editor saved, oldest first */
  saves: SavedSketch[];
  last(): SavedSketch | undefined;
}

/** Install the auth session and the stubbed API. Call before `page.goto`. */
export async function mockFlooringApi(page: Page, initial: SavedSketch | null = null): Promise<FlooringApi> {
  await page.addInitScript(
    ([user]) => {
      localStorage.setItem('auth_token', 'e2e-test-token');
      localStorage.setItem('auth_user', JSON.stringify(user));
    },
    [USER],
  );

  const api: FlooringApi = {
    saves: [],
    last() {
      return this.saves[this.saves.length - 1];
    },
  };
  let saved = initial;

  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    const method = route.request().method();

    if (path.endsWith('/api/auth/me')) return json(route, USER);
    if (path.endsWith(`/api/flooring-estimates/${ESTIMATE_ID}/sketch`) && method === 'PUT') {
      saved = route.request().postDataJSON().sketch_data as SavedSketch;
      api.saves.push(saved);
      return json(route, estimate(saved));
    }
    if (path.endsWith(`/api/flooring-estimates/${ESTIMATE_ID}`)) return json(route, estimate(saved));
    return json(route, []);
  });
  return api;
}

/** Where a point in feet is on the page, from the canvas's own view */
export async function pagePoint(canvas: Locator, p: FtPoint) {
  const box = await canvas.boundingBox();
  const [scale, x, y] = await Promise.all([
    canvas.getAttribute('data-scale'),
    canvas.getAttribute('data-offset-x'),
    canvas.getAttribute('data-offset-y'),
  ]);
  if (!box || !scale || x === null || y === null) throw new Error('canvas not ready');
  return { x: box.x + Number(x) + p.x * Number(scale), y: box.y + Number(y) + p.y * Number(scale) };
}

export function polygonArea(points: FtPoint[]) {
  let sum = 0;
  points.forEach((p, i) => {
    const q = points[(i + 1) % points.length];
    sum += p.x * q.y - q.x * p.y;
  });
  return Math.abs(sum) / 2;
}
