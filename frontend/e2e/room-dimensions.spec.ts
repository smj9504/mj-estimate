import { test, expect as baseExpect, Page } from '@playwright/test';
import { ALL_SCREEN_KEYS } from '../src/constants/screens';

// Pages are lazy chunks; on the dev server the first load of each can be slow
const expect = baseExpect.configure({ timeout: 20_000 });

// Room Dimensions: a room sketch capture goes in, the inside length of every
// wall comes out once one wall's real length sets the scale.
//
// The tool runs in the browser and the API is mocked, so this needs only the
// dev server. The capture is drawn here in the style of an Xactimate room
// (grey walls with a dark outline, dashed neighbours, a blue door swing, a
// room name) at 12px per foot, so every expected length is exact:
//
//   A top 24'   B right 6'   (8' opening)   C right 4'
//   D bottom 13'   (3' door)   E bottom 8'   F left 18'

const ADMIN = {
  id: '11111111-1111-1111-1111-111111111111',
  username: 'boss',
  email: 'boss@example.com',
  first_name: 'Pat',
  last_name: 'Boss',
  full_name: 'Pat Boss',
  role: 'admin',
  is_active: true,
  can_login: true,
  created_at: '2026-01-01T00:00:00',
  screen_access: null,
};

async function signedInPage(page: Page) {
  await page.addInitScript(stored => {
    localStorage.setItem('auth_token', 'e2e-token');
    localStorage.setItem('auth_user', stored);
  }, JSON.stringify(ADMIN));
  await page.route('**/api/**', route => {
    const { pathname } = new URL(route.request().url());
    if (pathname === '/api/auth/me') return route.fulfill({ json: { ...ADMIN, screens: ALL_SCREEN_KEYS } });
    return route.fulfill({ json: [] });
  });
}

/** PNG bytes of the test room, drawn on a canvas in the page */
async function drawRoomCapture(page: Page): Promise<Buffer> {
  const dataUrl = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 420;
    canvas.height = 320;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, 420, 320);

    const wall = (x0: number, y0: number, x1: number, y1: number) => {
      ctx.fillStyle = '#282828';
      ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
      ctx.fillStyle = '#c0c0c0';
      ctx.fillRect(x0 + 1, y0 + 1, x1 - x0 - 2, y1 - y0 - 2);
    };
    wall(52, 40, 356, 48); // top
    wall(52, 40, 60, 272); // left
    wall(348, 40, 356, 120); // right, above the opening
    wall(348, 216, 356, 272); // right, below it
    wall(192, 264, 356, 272); // bottom, right of the door
    wall(52, 264, 156, 272); // bottom, left of the door

    ctx.strokeStyle = '#3c3cff';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(156, 264);
    ctx.lineTo(188, 238);
    ctx.stroke();

    ctx.strokeStyle = '#aaa';
    ctx.lineWidth = 1;
    ctx.setLineDash([5, 3]);
    ctx.strokeRect(156.5, 274.5, 36, 40); // hallway beyond the door
    ctx.strokeRect(358.5, 110.5, 50, 116); // room beyond the opening
    ctx.setLineDash([]);

    ctx.fillStyle = '#333';
    ctx.font = '11px sans-serif';
    ctx.fillText('LIVING ROOM', 170, 150);
    return canvas.toDataURL('image/png');
  });
  return Buffer.from(dataUrl.split(',')[1], 'base64');
}

async function uploadCapture(page: Page) {
  const png = await drawRoomCapture(page);
  await page.locator('.rd-dropzone input[type="file"]').setInputFiles({
    name: 'living-room.png',
    mimeType: 'image/png',
    buffer: png,
  });
}

/** Click the auto-detect drawing at a pixel of the 420×320 test room */
async function clickRoom(page: Page, x: number, y: number) {
  const box = (await page.locator('.rd-drawing').boundingBox())!;
  await page.mouse.click(box.x + (x / 420) * box.width, box.y + (y / 320) * box.height);
}

const wallRow = (page: Page, letter: string) =>
  page.locator('.rd-face-row').filter({ has: page.locator('.rd-face-letter', { hasText: new RegExp(`^${letter}$`) }) });

test.describe('Room Dimensions', () => {
  test.beforeEach(async ({ page }) => {
    await signedInPage(page);
  });

  test('is in the Tools & Data menu', async ({ page }) => {
    // Start from a neighbour in the same group, which opens it; Photo Metadata needs no API
    await page.goto('/tools/photo-metadata');
    await page.getByRole('menuitem', { name: 'Room Dimensions' }).click();
    await expect(page).toHaveURL(/\/tools\/room-dimensions$/);
    await expect(page.getByRole('heading', { name: 'Room Dimensions' })).toBeVisible();
  });

  test('measures every inside face once one wall sets the scale', async ({ page }) => {
    await page.goto('/tools/room-dimensions');
    await uploadCapture(page);

    // Six faces, lettered clockwise from the top wall; no lengths until a scale is set
    await expect(page.locator('.rd-face-letter')).toHaveText(['A', 'B', 'C', 'D', 'E', 'F']);
    await expect(wallRow(page, 'A').locator('.rd-face-length')).toBeEmpty();
    await expect(page.getByRole('button', { name: 'Wall A', exact: true })).toBeVisible();

    // Pick the top wall on the drawing and give its real length
    await page.getByRole('button', { name: 'Wall A', exact: true }).click();
    await expect(page.getByLabel('Feet')).toBeFocused();
    await page.getByLabel('Feet').fill('24');
    await page.getByLabel('Inches').fill('0');
    await page.getByRole('button', { name: 'Set scale' }).click();

    const expected: Record<string, string> = {
      A: `24' 0"`,
      B: `6' 0"`,
      C: `4' 0"`,
      D: `13' 0"`,
      E: `8' 0"`,
      F: `18' 0"`,
    };
    for (const [letter, length] of Object.entries(expected)) {
      await expect(wallRow(page, letter)).toContainText(length);
    }
    await expect(page.locator('.rd-face-row--static')).toHaveText([`Opening8' 0"`, `Opening3' 0"`]);

    // The drawing labels switch from letters to lengths
    await expect(page.getByRole('button', { name: `Wall D, 13' 0"` })).toBeVisible();

    const room = page.locator('.ui-props');
    await expect(room.locator('.ui-props-row', { hasText: 'Wall length' })).toContainText(`73' 0"`);
    await expect(room.locator('.ui-props-row', { hasText: 'Openings' })).toContainText(`11' 0"`);
    await expect(room.locator('.ui-props-row', { hasText: 'Perimeter' })).toContainText(`84' 0"`);
    await expect(room.locator('.ui-props-row', { hasText: 'Floor area' })).toContainText('432.00 SF');
  });

  test('measures the largest of two rooms, and another once it is clicked', async ({ page }) => {
    await page.goto('/tools/room-dimensions');
    // Two rooms side by side at 12px per foot, a 3' door in the wall between:
    // left 11' 4" × 15' 4", right 15' × 15' 4"
    const png = await page.evaluate(() => {
      const canvas = document.createElement('canvas');
      canvas.width = 420;
      canvas.height = 280;
      const ctx = canvas.getContext('2d')!;
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, 420, 280);
      const wall = (x0: number, y0: number, x1: number, y1: number) => {
        ctx.fillStyle = '#282828';
        ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
        ctx.fillStyle = '#c0c0c0';
        ctx.fillRect(x0 + 1, y0 + 1, x1 - x0 - 2, y1 - y0 - 2);
      };
      wall(40, 40, 380, 48);
      wall(40, 232, 380, 240);
      wall(40, 40, 48, 240);
      wall(372, 40, 380, 240);
      wall(184, 40, 192, 100);
      wall(184, 136, 192, 240);
      return canvas.toDataURL('image/png').split(',')[1];
    });
    await page.locator('.rd-dropzone input[type="file"]').setInputFiles({
      name: 'two-rooms.png',
      mimeType: 'image/png',
      buffer: Buffer.from(png, 'base64'),
    });

    // The larger room first: top, right, bottom, then both sides of the door in the shared wall
    await expect(page.getByText('Room 1 of 2, the largest.')).toBeVisible();
    await wallRow(page, 'A').click();
    await page.getByLabel('Feet').fill('15');
    await page.getByLabel('Inches').fill('0');
    await page.getByRole('button', { name: 'Set scale' }).click();
    await expect(wallRow(page, 'B')).toContainText(`15' 4"`);
    await expect(wallRow(page, 'D')).toContainText(`8' 0"`);
    await expect(page.locator('.rd-face-row--static')).toHaveText([`Opening3' 0"`]);

    // Click inside the other room: its walls are lettered afresh, and the scale holds
    await page.getByRole('button', { name: 'Measure room 2' }).click();
    await expect(page.getByText('Room 2 of 2.')).toBeVisible();
    const expected: Record<string, string> = { A: `11' 4"`, B: `4' 4"`, C: `8' 0"`, D: `11' 4"`, E: `15' 4"` };
    for (const [letter, length] of Object.entries(expected)) {
      await expect(wallRow(page, letter)).toContainText(length);
    }
    await expect(page.locator('.rd-scale-current')).toHaveText(`Room 1 wall A = 15' 0"`);

    // And back again
    await page.getByRole('button', { name: 'Measure room 1' }).click();
    await expect(wallRow(page, 'A')).toContainText(`15' 0"`);
    await expect(page.locator('.rd-scale-current')).toHaveText(`Wall A = 15' 0"`);
  });

  test('picking another wall shows its length to correct the scale', async ({ page }) => {
    await page.goto('/tools/room-dimensions');
    await uploadCapture(page);
    await wallRow(page, 'A').click();
    await page.getByLabel('Feet').fill('24');
    await page.getByRole('button', { name: 'Set scale' }).click();

    // The left wall measured 18'; the tape says 18' 6", so the whole room scales up
    await wallRow(page, 'F').click();
    await expect(page.getByLabel('Feet')).toHaveValue('18');
    await expect(page.getByLabel('Inches')).toHaveValue('0');
    await page.getByLabel('Inches').fill('6');
    await page.getByRole('button', { name: 'Update scale' }).click();

    await expect(wallRow(page, 'F')).toContainText(`18' 6"`);
    await expect(wallRow(page, 'A')).toContainText(`24' 8"`);
    await expect(page.locator('.rd-scale-current')).toHaveText(`Wall F = 18' 6"`);
  });

  test('a line between two points sets the scale when no wall length is known', async ({ page }) => {
    await page.goto('/tools/room-dimensions');
    await uploadCapture(page);
    await expect(page.locator('.rd-face-letter')).toHaveCount(6);

    // Only the 8' opening in the right wall is known. Its ends are where B stops and C starts;
    // clicks a little off them snap onto those corners, so the line is exactly the opening
    await page.getByRole('button', { name: 'Draw line' }).click();
    await clickRoom(page, 346, 122);
    await clickRoom(page, 346, 214);
    await expect(page.getByLabel('Feet')).toBeFocused();
    await page.getByLabel('Feet').fill('8');
    await page.getByRole('button', { name: 'Set scale' }).click();

    await expect(page.locator('.rd-scale-current')).toHaveText(`Line = 8' 0"`);
    await expect(page.getByRole('button', { name: `Scale line, 8' 0"` })).toBeVisible();
    const expected: Record<string, string> = {
      A: `24' 0"`,
      B: `6' 0"`,
      C: `4' 0"`,
      D: `13' 0"`,
      E: `8' 0"`,
      F: `18' 0"`,
    };
    for (const [letter, length] of Object.entries(expected)) {
      await expect(wallRow(page, letter)).toContainText(length);
    }

    // A new line reads off the scale the first one set, which stays put
    await page.getByRole('button', { name: 'Redraw line' }).click();
    await clickRoom(page, 62, 50);
    await clickRoom(page, 346, 50);
    await expect(page.getByLabel('Feet')).toHaveValue('24');
    await expect(page.getByLabel('Inches')).toHaveValue('0');
    await expect(page.getByRole('button', { name: `Scale line, 24' 0"` })).toBeVisible();
    await expect(page.locator('.rd-scale-current')).toHaveText(`Earlier line = 8' 0"`);
    await expect(wallRow(page, 'B')).toContainText(`6' 0"`);

    // Taking the line off the drawing keeps the scale it set
    await page.getByRole('button', { name: 'Remove line' }).click();
    await expect(page.getByRole('button', { name: /^Scale line/ })).toHaveCount(0);
    await expect(wallRow(page, 'B')).toContainText(`6' 0"`);
  });

  test('a pasted screenshot is measured too', async ({ page }) => {
    await page.goto('/tools/room-dimensions');
    await expect(page.locator('.rd-dropzone')).toBeVisible();
    const png = await drawRoomCapture(page);
    await page.evaluate(async base64 => {
      const bytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
      const data = new DataTransfer();
      data.items.add(new File([bytes], 'clip.png', { type: 'image/png' }));
      document.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true }));
    }, png.toString('base64'));
    await expect(page.locator('.rd-face-letter')).toHaveCount(6);
  });

  test('downloads the capture with its lengths drawn on', async ({ page }) => {
    await page.goto('/tools/room-dimensions');
    await uploadCapture(page);
    await wallRow(page, 'A').click();
    await page.getByLabel('Feet').fill('24');
    await page.getByRole('button', { name: 'Set scale' }).click();

    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download PNG' }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe('living-room-dimensions.png');
  });

  test('says so when an image has no walls', async ({ page }) => {
    await page.goto('/tools/room-dimensions');
    const blank = await page.evaluate(() => {
      const canvas = document.createElement('canvas');
      canvas.width = 200;
      canvas.height = 150;
      const ctx = canvas.getContext('2d')!;
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, 200, 150);
      ctx.fillStyle = '#333';
      ctx.fillText('No sketch here', 40, 70);
      return canvas.toDataURL('image/png').split(',')[1];
    });
    await page.locator('.rd-dropzone input[type="file"]').setInputFiles({
      name: 'blank.png',
      mimeType: 'image/png',
      buffer: Buffer.from(blank, 'base64'),
    });
    // With nothing to detect it opens in Trace walls; Auto-detect says why
    await expect(page.getByRole('button', { name: 'Close loop' })).toBeVisible();
    await page.getByText('Auto-detect').click();
    await expect(page.getByText('No walls found in this image')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Download PNG' })).toBeDisabled();
  });

  // ── Trace walls mode ──────────────────────────────────────────────
  // A blank capture carries no walls, so the user clicks the corners. Points
  // are placed in image pixels; clicking segment A (320px) at 16' makes the
  // scale 20px/ft, so every other length is exact.

  /** A plain white 400×300 image: nothing to auto-detect, so Trace is the way */
  async function blankCapture(page: Page): Promise<Buffer> {
    const dataUrl = await page.evaluate(() => {
      const canvas = document.createElement('canvas');
      canvas.width = 400;
      canvas.height = 300;
      const ctx = canvas.getContext('2d')!;
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, 400, 300);
      return canvas.toDataURL('image/png');
    });
    return Buffer.from(dataUrl.split(',')[1], 'base64');
  }

  /** Click the stage at an image pixel, mapping through the drawing's box */
  async function clickImage(page: Page, x: number, y: number) {
    const box = (await page.locator('.rd-trace').boundingBox())!;
    await page.mouse.click(box.x + (x / 400) * box.width, box.y + (y / 300) * box.height);
  }

  async function startTrace(page: Page) {
    await page.goto('/tools/room-dimensions');
    await page.locator('.rd-dropzone input[type="file"]').setInputFiles({
      name: 'plan.png',
      mimeType: 'image/png',
      buffer: await blankCapture(page),
    });
    // An empty capture starts in Trace mode on its own; make sure
    await page.getByText('Trace walls').click();
  }

  test('traces a room, measuring each wall and calling every corner square', async ({ page }) => {
    await startTrace(page);

    // A 320×200px rectangle
    await clickImage(page, 40, 40);
    await clickImage(page, 360, 40);
    await clickImage(page, 360, 240);
    await clickImage(page, 40, 240);
    await page.getByRole('button', { name: 'Close loop' }).click();

    await expect(page.locator('.rd-face-letter')).toHaveText(['A', 'B', 'C', 'D']);

    // Top wall is 16'; that sets 20px/ft
    await page.getByRole('button', { name: 'Wall A', exact: true }).click();
    await page.getByLabel('Feet').fill('16');
    await page.getByLabel('Inches').fill('0');
    await page.getByRole('button', { name: 'Set scale' }).click();

    await expect(wallRow(page, 'A')).toContainText(`16' 0"`);
    await expect(wallRow(page, 'B')).toContainText(`10' 0"`);
    await expect(wallRow(page, 'C')).toContainText(`16' 0"`);
    await expect(wallRow(page, 'D')).toContainText(`10' 0"`);

    // Every corner square, none flagged
    await expect(page.locator('.rd-angle-row')).toHaveCount(4);
    await expect(page.locator('.rd-angle-value')).toHaveText(['90°', '90°', '90°', '90°']);
    await expect(page.locator('.rd-angle-row.is-off')).toHaveCount(0);

    const room = page.locator('.ui-props');
    await expect(room.locator('.ui-props-row', { hasText: 'Perimeter' })).toContainText(`52' 0"`);
    await expect(room.locator('.ui-props-row', { hasText: 'Floor area' })).toContainText('160.00 SF');
  });

  test('flags a non-square corner on an angled wall and reports its angle', async ({ page }) => {
    await startTrace(page);

    // A 45° cut at the lower right: B goes down, C goes down-left at 45°
    await clickImage(page, 40, 40);
    await clickImage(page, 360, 40);
    await clickImage(page, 360, 160);
    await clickImage(page, 280, 240);
    await clickImage(page, 40, 240);
    await page.getByRole('button', { name: 'Close loop' }).click();

    const corner = page.locator('.rd-angle-row', { hasText: 'B–C' });
    await expect(corner).toContainText('135°');
    await expect(corner).toHaveClass(/is-off/);
    await expect(page.locator('.rd-angle-row.is-off')).not.toHaveCount(0);
  });

  test('a line sets the scale of a traced room without joining its outline', async ({ page }) => {
    await startTrace(page);
    await clickImage(page, 40, 40);
    await clickImage(page, 360, 40);
    await clickImage(page, 360, 240);
    await clickImage(page, 40, 240);
    await page.getByRole('button', { name: 'Close loop' }).click();

    // Down the left side, each end snapping to a traced corner: 200px
    await page.getByRole('button', { name: 'Draw line' }).click();
    await clickImage(page, 42, 42);
    await clickImage(page, 42, 238);
    await page.getByLabel('Feet').fill('10');
    await page.getByRole('button', { name: 'Set scale' }).click();

    await expect(page.locator('.rd-scale-current')).toHaveText(`Line = 10' 0"`);
    await expect(page.locator('.rd-face-letter')).toHaveText(['A', 'B', 'C', 'D']);
    await expect(wallRow(page, 'A')).toContainText(`16' 0"`);
    await expect(wallRow(page, 'B')).toContainText(`10' 0"`);

    // Reopening the outline shifts the wall letters, not the line's scale
    await page.getByRole('button', { name: 'Reopen' }).click();
    await expect(wallRow(page, 'A')).toContainText(`16' 0"`);
    await expect(page.locator('.rd-scale-current')).toHaveText(`Line = 10' 0"`);
  });

  test('downloads a traced plan with its lengths and angles drawn on', async ({ page }) => {
    await startTrace(page);
    await clickImage(page, 40, 40);
    await clickImage(page, 360, 40);
    await clickImage(page, 360, 240);
    await clickImage(page, 40, 240);
    await page.getByRole('button', { name: 'Close loop' }).click();
    await page.getByRole('button', { name: 'Wall A', exact: true }).click();
    await page.getByLabel('Feet').fill('16');
    await page.getByRole('button', { name: 'Set scale' }).click();

    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download PNG' }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe('plan-dimensions.png');
  });

  test('fits a phone without sideways scrolling', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/tools/room-dimensions');
    await uploadCapture(page);
    await expect(page.locator('.rd-face-letter')).toHaveCount(6);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    // Drawing first, then the scale form under it
    const drawing = await page.locator('.rd-drawing').boundingBox();
    const form = await page.locator('.rd-scale-form').boundingBox();
    expect(form!.y).toBeGreaterThan(drawing!.y + drawing!.height);

    // Zooming in grows the drawing inside its own scroller, labels keep their size, the page stays put
    const labelBefore = await page.getByRole('button', { name: 'Wall A', exact: true }).boundingBox();
    await page.getByRole('button', { name: 'Zoom in' }).click();
    await page.getByRole('button', { name: 'Zoom in' }).click();
    await expect(page.getByRole('button', { name: '200%' })).toBeVisible();
    const zoomed = await page.locator('.rd-drawing').boundingBox();
    expect(zoomed!.width).toBeGreaterThan(drawing!.width * 1.8);
    const labelAfter = await page.getByRole('button', { name: 'Wall A', exact: true }).boundingBox();
    expect(Math.abs(labelAfter!.height - labelBefore!.height)).toBeLessThanOrEqual(1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);

    await page.getByRole('button', { name: '200%' }).click();
    await expect(page.getByRole('button', { name: 'Fit' })).toBeVisible();
  });
});
