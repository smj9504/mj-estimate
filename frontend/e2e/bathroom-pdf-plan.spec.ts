import { test, expect } from '@playwright/test';

// A bathroom estimate's PDF gets its plan as the Sketch tab draws it — its
// fixtures' symbols, turned as placed — even when the Sketch tab was never
// opened: the plan is drawn off screen from the saved sketch. (The server's
// own outline, its fallback, is boxes with the fixtures' names.)
// Runs against the dev server with /api answered here.
const ID = '13131313-1313-1313-1313-131313131313';
const FT = 40;
const wall = (id: string, x0: number, y0: number, x1: number, y1: number) => ({
  id, start: { x: x0 * FT, y: y0 * FT }, end: { x: x1 * FT, y: y1 * FT }, thickness: 4, heightInches: 96,
});
const WALLS = [wall('n', 0, 0, 5, 0), wall('e', 5, 0, 5, 8), wall('s', 5, 8, 0, 8), wall('w', 0, 8, 0, 0)];
const ROOM = {
  id: 'bath', name: 'Bathroom', roomType: 'bathroom', heightInches: 96,
  boundary: WALLS.map((w) => w.start), wallIds: WALLS.map((w) => w.id),
  floorAreaSF: 40, netFloorAreaSF: 40, wallAreaSF: 208, perimeterLF: 26,
};
const fx = (id: string, type: string, x: number, y: number, w: number, h: number, rotation: number, properties: any = {}) => ({
  id, type, roomId: 'bath', position: { x: x * FT, y: y * FT }, dimensions: { width: w, height: h }, rotation, properties,
});
const SKETCH = {
  version: '1.0.0', walls: WALLS, rooms: [ROOM],
  fixtures: [
    fx('tub', 'bathtub', 2.5, 15 / 12, 60, 30, 0, { bathtubSubType: 'standard_alcove', hasSurround: true, surroundWallCount: 3, surroundHeight: 60 }),
    fx('toilet', 'toilet', 5 - 15 / 12, 4, 20, 28, 90),
    fx('vanity', 'vanity', 3.5, 8 - 11 / 12, 30, 21, 180, { vanitySubType: 'cabinet', sinkCount: 1 }),
    fx('mirror', 'mirror', 3.5, 8 - 0.1, 30, 2, 180),
    fx('door', 'door', 1.25, 8 - 15 / 12, 30, 30, 180, {}),
  ],
  tileZones: [], damageZones: [], drywallRepairZones: [], insulationZones: [],
  settings: { pixelsPerFoot: FT, snapToGrid: true, gridSizeInches: 3, showTileZones: true, showAreaLabels: true },
};

const ESTIMATE = {
  id: ID, kind: 'restore', status: 'calculated', property_address: '12 Elm St', designation: 'hall',
  line_items: [], group_members: [], total: 1000, sketch_data: SKETCH,
};

test("a PDF from the estimate list gets the plan as its Sketch tab draws it", async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 1000 });
  const sent: any[] = [];
  await page.addInitScript(() => {
    localStorage.setItem('auth_token', 'test-token');
    localStorage.setItem('auth_user', JSON.stringify({ id: 'u1', username: 'admin', role: 'admin' }));
  });
  await page.route('**/api/**', (route) => {
    const req = route.request();
    const path = new URL(req.url()).pathname;
    const json = (b: unknown) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(b) });
    if (path === `/api/bathroom-estimates/${ID}/export/pdf` && req.method() === 'POST') {
      sent.push(req.postDataJSON());
      return route.fulfill({ status: 200, contentType: 'application/pdf', body: '%PDF-1.4\n%%EOF' });
    }
    if (path === `/api/bathroom-estimates/${ID}`) return json(ESTIMATE);
    if (path === '/api/bathroom-estimates') return json({ items: [ESTIMATE], total: 1, page: 1, page_size: 20 });
    if (path === '/api/auth/me') return json({ id: 'u1', username: 'admin', role: 'admin', is_active: true });
    return json([]);
  });
  await page.goto('/bathroom-estimates', { timeout: 180_000 });
  const row = page.getByRole('row').filter({ hasText: '12 Elm St' });
  await expect(row).toBeVisible({ timeout: 60_000 });
  // No plan on this page: none drawn but the PDF's own
  await expect(page.locator('canvas')).toHaveCount(0);
  await row.getByRole('button', { name: /file-pdf/ }).click();
  await expect.poll(() => sent.length, { timeout: 30_000 }).toBe(1);
  // A real picture of the plan: a PNG of some size
  const png = Buffer.from(sent[0].sketch_image ?? '', 'base64');
  expect(png.subarray(1, 4).toString()).toBe('PNG');
  expect(png.readUInt32BE(16)).toBeGreaterThan(400); // width, px
  // Drawn off screen and taken down again
  await expect(page.locator('canvas')).toHaveCount(0);
  await test.info().attach('pdf-plan.png', { body: png, contentType: 'image/png' });
});
