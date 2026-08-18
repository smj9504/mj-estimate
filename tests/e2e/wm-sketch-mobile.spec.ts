/**
 * Water Mitigation — Sketch tab on mobile.
 *
 * Covers the interactions that were mouse/keyboard-only before touch support
 * landed: tap-to-place, drag-to-draw, pinch-zoom, two-finger pan, long-press
 * for the element menu, and the on-canvas controls that stand in for the
 * scroll wheel, Escape, and Delete.
 *
 * Playwright's touchscreen API only exposes single taps, so multi-touch and
 * drag gestures are dispatched as real TouchEvents inside the page.
 */

import { test, expect, Page } from '@playwright/test';
import { mockSketchApi, gotoSketchTab } from './fixtures/wm-sketch-mock';

const CANVAS = '[data-testid="wm-sketch-canvas-container"]';
const TOOLBAR = '.wm-toolbar-root';

/** Tool buttons are icon-only on mobile, so they are found by aria-label.
 *  Scoped to the toolbar — the page header has its own "more" menu. */
const tool = (page: Page, name: RegExp) =>
  page.locator(TOOLBAR).getByRole('button', { name });

// ---------------------------------------------------------------------------
// Touch gesture helpers — dispatch genuine TouchEvents so Konva's touch
// handlers run exactly as they do on a real device.
// ---------------------------------------------------------------------------

type Pt = { x: number; y: number };

async function canvasBox(page: Page) {
  const box = await page.locator(CANVAS).boundingBox();
  if (!box) throw new Error('sketch canvas not visible');
  return box;
}

/** Point at a fraction of the canvas, in viewport coordinates. */
async function at(page: Page, fx: number, fy: number): Promise<Pt> {
  const b = await canvasBox(page);
  return { x: b.x + b.width * fx, y: b.y + b.height * fy };
}

async function dispatchTouch(
  page: Page,
  type: 'touchstart' | 'touchmove' | 'touchend',
  points: Pt[],
  changed?: Pt[]
) {
  await page.evaluate(
    ({ type, points, changed, sel }) => {
      const el = document.querySelector(`${sel} canvas`) as HTMLElement | null;
      if (!el) throw new Error('canvas element missing');
      const mk = (p: { x: number; y: number }, i: number) =>
        new Touch({
          identifier: i,
          target: el,
          clientX: p.x,
          clientY: p.y,
          pageX: p.x,
          pageY: p.y,
        });
      const touches = points.map(mk);
      const changedTouches = (changed ?? points).map(mk);
      el.dispatchEvent(
        new TouchEvent(type, {
          bubbles: true,
          cancelable: true,
          composed: true,
          touches,
          targetTouches: touches,
          changedTouches,
        })
      );
    },
    { type, points, changed, sel: CANVAS }
  );
}

/** Single-finger tap. */
async function touchTap(page: Page, p: Pt) {
  await dispatchTouch(page, 'touchstart', [p]);
  await dispatchTouch(page, 'touchend', [], [p]);
}

/** Single-finger drag, interpolated so Konva sees intermediate moves. */
async function touchDrag(page: Page, from: Pt, to: Pt, steps = 8) {
  await dispatchTouch(page, 'touchstart', [from]);
  for (let i = 1; i <= steps; i++) {
    await dispatchTouch(page, 'touchmove', [
      {
        x: from.x + ((to.x - from.x) * i) / steps,
        y: from.y + ((to.y - from.y) * i) / steps,
      },
    ]);
  }
  await dispatchTouch(page, 'touchend', [], [to]);
}

/** Hold a finger still long enough to trigger the long-press menu. */
async function touchLongPress(page: Page, p: Pt) {
  await dispatchTouch(page, 'touchstart', [p]);
  await page.waitForTimeout(700);
  await dispatchTouch(page, 'touchend', [], [p]);
}

/** Two-finger pinch about a centre point, from `fromGap` to `toGap` px apart. */
async function pinch(page: Page, center: Pt, fromGap: number, toGap: number, steps = 6) {
  const pair = (gap: number): Pt[] => [
    { x: center.x - gap / 2, y: center.y },
    { x: center.x + gap / 2, y: center.y },
  ];
  await dispatchTouch(page, 'touchstart', pair(fromGap));
  for (let i = 1; i <= steps; i++) {
    await dispatchTouch(page, 'touchmove', pair(fromGap + ((toGap - fromGap) * i) / steps));
  }
  await dispatchTouch(page, 'touchend', [], pair(toGap));
}

/**
 * Current Konva stage scale. The stage transform lives inside the canvas
 * context, so the editor mirrors it onto the container as `data-stage-scale`.
 */
async function stageScale(page: Page): Promise<number> {
  const raw = await page.locator(CANVAS).getAttribute('data-stage-scale');
  return Number(raw);
}

// ---------------------------------------------------------------------------

/** True for the phone/tablet projects; false for desktop-chrome. */
const isTouchProject = () => test.info().project.use.hasTouch === true;

test.describe('WM Sketch tab — mobile', () => {
  test.beforeEach(async ({ page }) => {
    test.skip(!isTouchProject(), 'touch project only');
    await mockSketchApi(page);
    await gotoSketchTab(page);
  });

  test('renders the canvas and touch controls on a phone viewport', async ({ page }) => {
    await expect(page.locator(`${CANVAS} canvas`).first()).toBeVisible();

    // Zoom controls stand in for the scroll wheel
    await expect(page.getByTestId('wm-sketch-zoom-in')).toBeVisible();
    await expect(page.getByTestId('wm-sketch-zoom-out')).toBeVisible();
    await expect(page.getByTestId('wm-sketch-zoom-fit')).toBeVisible();

    // The canvas must not be clipped horizontally by the viewport
    const box = await canvasBox(page);
    const viewport = page.viewportSize()!;
    expect(box.width).toBeGreaterThan(0);
    expect(box.x + box.width).toBeLessThanOrEqual(viewport.width + 1);
  });

  test('the page does not scroll horizontally', async ({ page }) => {
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth
    );
    expect(overflow).toBeLessThanOrEqual(1);
  });

  test('canvas container opts out of browser touch handling', async ({ page }) => {
    const touchAction = await page
      .locator(CANVAS)
      .evaluate((el) => getComputedStyle(el).touchAction);
    expect(touchAction).toBe('none');
  });

  test('tap places an equipment marker', async ({ page }) => {
    await expect(page.getByTestId('wm-sketch-status-bar')).toContainText('No items on canvas');

    await tool(page, /equipment tool/i).click();
    await touchTap(page, await at(page, 0.5, 0.5));

    await expect(page.getByTestId('wm-sketch-status-bar')).toContainText('Equipment: 1');
  });

  test('drag draws a floor protection zone', async ({ page }) => {
    await tool(page, /floor protection tool/i).click();

    await touchDrag(page, await at(page, 0.3, 0.35), await at(page, 0.7, 0.7));

    await expect(page.getByTestId('wm-sketch-status-bar')).toContainText('Floor Prot');
  });

  test('pinch zooms the stage in and out', async ({ page }) => {
    const center = await at(page, 0.5, 0.5);
    const before = await stageScale(page);
    expect(Number.isNaN(before)).toBe(false);

    await pinch(page, center, 80, 220);
    const zoomedIn = await stageScale(page);
    expect(zoomedIn).toBeGreaterThan(before * 1.2);

    await pinch(page, center, 220, 80);
    const zoomedOut = await stageScale(page);
    expect(zoomedOut).toBeLessThan(zoomedIn);
  });

  test('zoom buttons change the stage scale, and fit really fits', async ({ page }) => {
    const before = await stageScale(page);

    await page.getByTestId('wm-sketch-zoom-in').click();
    const zoomedIn = await stageScale(page);
    expect(zoomedIn).toBeGreaterThan(before);

    await page.getByTestId('wm-sketch-zoom-out').click();
    expect(await stageScale(page)).toBeLessThan(zoomedIn);

    await page.getByTestId('wm-sketch-zoom-in').click();
    await page.getByTestId('wm-sketch-zoom-in').click();
    await page.getByTestId('wm-sketch-zoom-fit').click();

    // Fit must scale the 1200×900 logical canvas to the viewport, not merely
    // reset to whatever scale the editor happened to start at.
    const box = await canvasBox(page);
    const expectedFit = Math.min(box.width / 1200, box.height / 900);
    const fitted = await stageScale(page);
    expect(fitted).toBeGreaterThan(expectedFit * 0.9);
    expect(fitted).toBeLessThan(expectedFit * 1.1);
  });

  test('two-finger drag pans without drawing', async ({ page }) => {
    await tool(page, /floor protection tool/i).click();

    const c = await at(page, 0.5, 0.5);
    const pair = (dx: number) => [
      { x: c.x - 40 + dx, y: c.y },
      { x: c.x + 40 + dx, y: c.y },
    ];
    await dispatchTouch(page, 'touchstart', pair(0));
    for (let i = 1; i <= 6; i++) await dispatchTouch(page, 'touchmove', pair(i * 8));
    await dispatchTouch(page, 'touchend', [], pair(48));

    // A pinch/pan gesture must never commit a shape
    await expect(page.getByTestId('wm-sketch-status-bar')).toContainText('No items on canvas');
  });

  test('long press opens the element context menu', async ({ page }) => {
    // Place something and leave it selected (placement switches to the select tool)
    await tool(page, /equipment tool/i).click();
    await touchTap(page, await at(page, 0.5, 0.5));
    await expect(page.getByTestId('wm-sketch-status-bar')).toContainText('Equipment: 1');

    await touchLongPress(page, await at(page, 0.5, 0.5));
    await expect(page.getByTestId('wm-sketch-context-menu')).toBeVisible();
  });

  test('selected element can be deleted without a keyboard', async ({ page }) => {
    await tool(page, /equipment tool/i).click();
    await touchTap(page, await at(page, 0.45, 0.45));
    await expect(page.getByTestId('wm-sketch-status-bar')).toContainText('Equipment: 1');

    const deleteBtn = page.getByTestId('wm-sketch-delete-selected');
    await expect(deleteBtn).toBeVisible();
    await deleteBtn.click();

    await expect(page.getByTestId('wm-sketch-status-bar')).toContainText('No items on canvas');
  });

  test('a wall chain can be finished from the canvas', async ({ page }) => {
    await tool(page, /more tools/i).click();

    // The overflow menu is taller than a phone screen; it must scroll rather
    // than flip off the top of the viewport where its items are unreachable.
    const wallItem = page.getByRole('menuitem', { name: /wall \(w\)/i });
    await wallItem.waitFor();
    const itemBox = (await wallItem.boundingBox())!;
    expect(itemBox.y).toBeGreaterThanOrEqual(0);
    expect(itemBox.y + itemBox.height).toBeLessThanOrEqual(page.viewportSize()!.height);

    await wallItem.click();

    await touchTap(page, await at(page, 0.25, 0.4));
    await touchTap(page, await at(page, 0.7, 0.4));

    // The chain stays open on desktop until Escape; on touch, a Finish button
    // ends it instead.
    const finish = page.getByTestId('wm-sketch-finish-drawing');
    await expect(finish).toBeVisible();
    await finish.click();
    await expect(finish).toBeHidden();
  });

  test('properties sidebar opens as a drawer', async ({ page }) => {
    // Tablets keep the inline sidebar — only phone widths swap to a drawer
    test.skip(
      (page.viewportSize()?.width ?? 0) >= 768,
      'drawer layout is phone-width only'
    );

    // The inline sidebar is replaced by a drawer at this width
    await expect(page.getByTestId('wm-sketch-sidebar')).toBeHidden();

    await page.getByTestId('wm-sketch-open-panels').click();
    await expect(page.getByTestId('wm-sketch-sidebar')).toBeVisible();

    // And it must fit the viewport rather than overflow it
    const box = await page.getByTestId('wm-sketch-sidebar').boundingBox();
    const viewport = page.viewportSize()!;
    expect(box!.width).toBeLessThanOrEqual(viewport.width + 1);
  });

  test('every toolbar tool stays reachable by scrolling the strip', async ({ page }) => {
    const toolbar = page.locator('.wm-toolbar-root');
    await expect(toolbar).toBeVisible();

    const { scrollWidth, clientWidth } = await toolbar.evaluate((el) => ({
      scrollWidth: el.scrollWidth,
      clientWidth: el.clientWidth,
    }));

    if (scrollWidth > clientWidth) {
      await toolbar.evaluate((el) => el.scrollTo({ left: el.scrollWidth }));
      const scrolled = await toolbar.evaluate((el) => el.scrollLeft);
      expect(scrolled).toBeGreaterThan(0);
    }

    // The Save button sits at the far end of the strip and must be tappable
    const save = page.locator('.wm-toolbar-root button').last();
    await expect(save).toBeVisible();
  });

});

test.describe('WM Sketch tab — desktop is unaffected', () => {
  test.beforeEach(async ({ page }) => {
    test.skip(isTouchProject(), 'desktop project only');
    await mockSketchApi(page);
    await gotoSketchTab(page);
  });

  test('keeps the inline sidebar and hides the touch controls', async ({ page }) => {
    await expect(page.getByTestId('wm-sketch-sidebar')).toBeVisible();
    await expect(page.getByTestId('wm-sketch-zoom-in')).toBeHidden();
    await expect(page.getByTestId('wm-sketch-open-panels')).toBeHidden();
  });

  test('mouse drawing still works', async ({ page }) => {
    await tool(page, /floor protection tool/i).click();

    const box = (await page.locator(CANVAS).boundingBox())!;
    await page.mouse.move(box.x + box.width * 0.3, box.y + box.height * 0.35);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.6, box.y + box.height * 0.65, { steps: 8 });
    await page.mouse.up();

    await expect(page.getByTestId('wm-sketch-status-bar')).toContainText('Floor Prot');
  });

  test('wheel still zooms the stage', async ({ page }) => {
    const box = (await page.locator(CANVAS).boundingBox())!;
    const before = Number(await page.locator(CANVAS).getAttribute('data-stage-scale'));

    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.wheel(0, -300);
    await page.waitForTimeout(150);

    const after = Number(await page.locator(CANVAS).getAttribute('data-stage-scale'));
    expect(after).toBeGreaterThan(before);
  });
});
