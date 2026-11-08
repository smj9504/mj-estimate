import { test, expect as baseExpect, Page, Request } from '@playwright/test';

// Picking a claim's photos for its packing estimate asks only for their room, and
// the claim page and the builder's From Claim work room by room. Runs against the
// dev server with /api answered here.

const expect = baseExpect.configure({ timeout: 20_000 });

const CLIENT_ID = '22222222-2222-2222-2222-222222222222';
const CLAIM_ID = '33333333-3333-3333-3333-333333333333';
const CLIENT_PATH = `/clients/${CLIENT_ID}`;
const BUILDER_PATH = '/reconstruction-estimate/pack-calculator-new';
const PHOTOS_API = `/api/packing-estimate/claims/${CLAIM_ID}/photos`;
const NO_CATEGORY = /category|water mitigation|work completion/i;

const CLIENT = {
  id: CLIENT_ID,
  display_name: 'Pat Client',
  owners: [],
  address: '12 Oak St',
  city: 'Fairfax',
  state: 'VA',
  zipcode: '22030',
};
const CLAIM = {
  id: CLAIM_ID,
  client_id: CLIENT_ID,
  claim_number: 'C-1',
  status: 'open',
  wm_jobs: [],
  companies: [],
};

const FILE_IDS = ['file-1', 'file-2', 'file-3'];
const galleryFile = (id: string) => ({
  id,
  filename: `${id}.jpg`,
  originalName: `${id}.jpg`,
  contentType: 'image/jpeg',
  size: 1000,
  url: `/api/files/preview/${id}`,
  thumbnailUrl: `/api/files/preview/${id}`,
  context: 'claim',
  contextId: CLAIM_ID,
  category: 'general',
  uploadDate: '2026-10-01T00:00:00Z',
});

const PHOTO = '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300"><rect width="400" height="300" fill="#b9a27c"/></svg>';
// A 1x1 JPEG, for the photos the builder fetches for the AI
const JPEG_BASE64 = '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAMCAgICAgMCAgIDAwMDBAYEBAQEBAgGBgUGCQgKCgkICQkKDA8MCgsOCwkJDRENDg8QEBEQCgwSExIQEw8QEBD/yQALCAABAAEBAREA/8wABgAQEAX/2gAIAQEAAD8A0s8g/9k=';

interface PackingEntry {
  id: string;
  source: 'claim';
  photo_id: string;
  room_name: string;
  file_name: string;
  thumbnail_url: string;
  preview_url: string;
}

const filed = (photoId: string, room: string): PackingEntry => ({
  id: `entry-${photoId}`,
  source: 'claim',
  photo_id: photoId,
  room_name: room,
  file_name: `${photoId}.jpg`,
  thumbnail_url: `/api/files/preview/${photoId}`,
  preview_url: `/api/files/download/${photoId}`,
});

/** Opens a page on a claim whose packing photos are `start`; returns them as they change */
async function open(page: Page, url: string, start: PackingEntry[]) {
  const photos = [...start];

  await page.addInitScript(() => {
    localStorage.setItem('auth_token', 'test-token');
    localStorage.setItem('auth_user', JSON.stringify({ id: 'u1', username: 'admin', role: 'admin' }));
  });

  await page.route('**/api/**', route => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const method = request.method();
    const json = (body: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

    if (path === '/api/auth/me') return json({ id: 'u1', username: 'admin', role: 'admin', is_active: true });
    if (path === `/api/clients/${CLIENT_ID}`) return json(CLIENT);
    if (path === `/api/clients/${CLIENT_ID}/claims`) return json({ claims: [CLAIM], total: 1 });
    if (path === `/api/files/claim/${CLAIM_ID}`) return json({ data: FILE_IDS.map(galleryFile), total: FILE_IDS.length });
    if (path.startsWith('/api/files/preview/')) return route.fulfill({ contentType: 'image/svg+xml', body: PHOTO });

    if (path === '/api/packing-estimate/claims/with-photos') {
      const rooms = new Map<string, number>();
      photos.forEach(p => rooms.set(p.room_name, (rooms.get(p.room_name) ?? 0) + 1));
      return json({
        claims: [{
          claim_id: CLAIM_ID,
          claim_number: CLAIM.claim_number,
          client_id: CLIENT_ID,
          client_name: CLIENT.display_name,
          project_address: '12 Oak St, Fairfax, VA, 22030',
          photo_count: photos.length,
          rooms: Array.from(rooms, ([room_name, photo_count]) => ({ room_name, photo_count })),
        }],
      });
    }
    if (path === PHOTOS_API && method === 'POST') {
      const body = request.postDataJSON();
      body.photos.forEach((ref: { photo_id: string; room_name?: string }) => {
        photos.push(filed(ref.photo_id, ref.room_name || body.room_name));
      });
      return json({ photos });
    }
    if (path === PHOTOS_API && method === 'PATCH') {
      const body = request.postDataJSON();
      photos.filter(p => body.ids.includes(p.id)).forEach(p => { p.room_name = body.room_name; });
      return json({ photos });
    }
    if (path === PHOTOS_API) return json({ photos });
    if (path.startsWith(`${PHOTOS_API}/`) && path.endsWith('/image')) return json({ image: JPEG_BASE64 });
    if (path === '/api/packing-estimate/analyze-batch') return route.fulfill({ contentType: 'text/event-stream', body: '' });
    return json([]);
  });

  await page.goto(url, { timeout: 120_000 });
  return photos;
}

// A lone claim opens by itself; clicking it then would close it
const openClaim = async (page: Page) => {
  const header = page.locator('.cl-claims .ant-collapse-header').first();
  await header.waitFor({ timeout: 120_000 });
  if (await header.getAttribute('aria-expanded') !== 'true') await header.click();
};

const sent = (page: Page, method: string) => page.waitForRequest((request: Request) =>
  new URL(request.url()).pathname === PHOTOS_API && request.method() === method);

const roomNames = (page: Page) => page.locator('.cl-packing-room-name');

test.describe('using a claim\'s photos for packing', () => {
  test('picking photos asks only for their room', async ({ page }) => {
    await open(page, CLIENT_PATH, []);
    await openClaim(page);
    await page.getByRole('button', { name: /Show photos/ }).click();
    await page.locator('.ant-card .ant-checkbox-input').first().check({ timeout: 60_000 });
    await page.getByRole('button', { name: 'Use for packing' }).click();

    const dialog = page.getByRole('dialog', { name: 'Use 1 photo for packing' });
    await expect(dialog).toBeVisible();
    await expect(dialog).not.toContainText(NO_CATEGORY);
    const add = dialog.getByRole('button', { name: 'Add to room' });
    await expect(add).toBeDisabled();

    await dialog.getByRole('combobox').fill('Kitchen');
    await expect(add).toBeEnabled();
    // The suggestion opens over the footer; picking it closes the list
    await page.locator('.ant-select-item-option').filter({ hasText: 'Kitchen' }).click();
    const request = sent(page, 'POST');
    await add.click();

    expect((await request).postDataJSON()).toEqual({
      room_name: 'Kitchen',
      photos: [{ source: 'claim', photo_id: 'file-1' }],
    });
    await expect(dialog).toBeHidden();
    await expect(roomNames(page)).toHaveText(['Kitchen']);
  });

  test('the claim lists its rooms, and photos move between them', async ({ page }) => {
    await open(page, CLIENT_PATH, [filed('file-1', 'Kitchen'), filed('file-2', 'Kitchen'), filed('file-3', 'Den')]);
    await openClaim(page);

    await expect(roomNames(page)).toHaveText(['Kitchen', 'Den']);
    const packing = page.locator('.cl-packing-set');
    await expect(packing).toContainText('2 rooms · 3 photos');
    await expect(packing).not.toContainText(NO_CATEGORY);
    await expect(packing.getByRole('button', { name: /Pack-out\/in estimate/ })).toHaveCount(1);
    await expect(page.getByRole('button', { name: /^Move Kitchen to/ })).toHaveCount(0);

    await page.getByRole('button', { name: 'Move photos of Kitchen to another room' }).click();
    const mover = page.getByRole('group', { name: 'Move photos of Kitchen' });
    await expect(mover).not.toContainText(NO_CATEGORY);
    await mover.getByRole('button', { name: 'file-2.jpg' }).click();
    await mover.getByRole('combobox').fill('Office');
    await expect(mover).toContainText('Office will be a new room');
    const request = sent(page, 'PATCH');
    await mover.getByRole('button', { name: 'Move 1' }).click();

    expect((await request).postDataJSON()).toEqual({ ids: ['entry-file-2'], room_name: 'Office' });
    await expect(roomNames(page)).toHaveText(['Kitchen', 'Office', 'Den']);
  });

  test('Pack-out/in estimate loads every room into the builder', async ({ page }) => {
    await open(page, CLIENT_PATH, [filed('file-1', 'Kitchen'), filed('file-3', 'Den')]);
    await openClaim(page);

    const fetched: string[] = [];
    page.on('request', request => {
      const path = new URL(request.url()).pathname;
      if (path.endsWith('/image')) fetched.push(path);
    });
    await page.locator('.cl-packing-set').getByRole('button', { name: /Pack-out\/in estimate/ }).click();

    await expect(page).toHaveURL(new RegExp(`${BUILDER_PATH}$`));
    const rooms = page.locator('.pk-room-list');
    await expect(rooms).toContainText('Kitchen', { timeout: 60_000 });
    await expect(rooms).toContainText('Den');
    expect(fetched.sort()).toEqual([
      `${PHOTOS_API}/entry-file-1/image`,
      `${PHOTOS_API}/entry-file-3/image`,
    ]);
  });

  test('From Claim starts with the claim\'s rooms ticked and loads the ones left ticked', async ({ page }) => {
    await open(page, BUILDER_PATH, [filed('file-1', 'Kitchen'), filed('file-3', 'Den')]);

    await page.getByRole('button', { name: /From Claim/ }).click({ timeout: 120_000 });
    const dialog = page.getByRole('dialog', { name: 'Load Photos from a Claim' });
    await dialog.getByRole('button', { name: /Pat Client/ }).click();

    const kitchen = dialog.getByRole('checkbox', { name: 'Kitchen' });
    const den = dialog.getByRole('checkbox', { name: 'Den' });
    await expect(kitchen).toBeChecked();
    await expect(den).toBeChecked();
    await expect(dialog).not.toContainText(NO_CATEGORY);

    await den.uncheck();
    await dialog.getByRole('checkbox', { name: 'Analyze with AI after loading' }).uncheck();
    await dialog.getByRole('button', { name: /Load 1 room/ }).click();

    const rooms = page.locator('.pk-room-list');
    await expect(rooms).toContainText('Kitchen');
    await expect(rooms).not.toContainText(/Den(?!sity)/);
  });
});
