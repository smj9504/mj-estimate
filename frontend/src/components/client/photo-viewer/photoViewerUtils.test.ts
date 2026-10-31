import { describe, expect, it } from 'vitest';
import type { FileItem } from '../../common/FileGallery/types';
import {
  FIT_VIEW, MAX_ZOOM, clampView, countCategories, photoCategory, photoDate, photoPlace, zoomAt,
} from './photoViewerUtils';

const photo = (fields: Partial<FileItem>): FileItem => ({
  id: 'photo',
  filename: 'a.jpg',
  originalName: 'a.jpg',
  url: '/a.jpg',
  size: 1,
  uploadDate: '2026-10-12T12:00:00',
  createdAt: '2026-10-12T12:00:00',
  ...fields,
});

const STAGE = { width: 1000, height: 500 };
// Fits the stage's height exactly: 500 x 500 at scale 1
const SQUARE = { width: 2000, height: 2000 };

describe('countCategories', () => {
  it('follows the set order, then other categories, with Uncategorized last', () => {
    const files = [
      photo({ category: 'moisture' }),
      photo({ category: '' }),
      photo({ category: 'demolition' }),
      photo({ category: 'wet-area' }),
      photo({ category: 'wet-area' }),
      photo({ category: 'equipment' }),
    ];
    expect(countCategories(files, ['uncategorized', 'wet-area', 'demolition'])).toEqual([
      { key: 'wet-area', count: 2 },
      { key: 'demolition', count: 1 },
      { key: 'equipment', count: 1 },
      { key: 'moisture', count: 1 },
      { key: 'uncategorized', count: 1 },
    ]);
  });

  it('leaves out categories with no photos', () => {
    expect(countCategories([photo({ category: 'day-1' })], ['wet-area', 'day-1'])).toEqual([
      { key: 'day-1', count: 1 },
    ]);
  });
});

describe('photoCategory', () => {
  it('treats a missing or blank category as Uncategorized and ignores case', () => {
    expect(photoCategory(photo({ category: undefined }))).toBe('uncategorized');
    expect(photoCategory(photo({ category: '  ' }))).toBe('uncategorized');
    expect(photoCategory(photo({ category: 'Wet-Area' }))).toBe('wet-area');
  });
});

describe('photoPlace', () => {
  it('prefers the location tag, then the description, and is blank without either', () => {
    expect(photoPlace(photo({ locationLevel: '1st Floor', locationRoom: 'Kitchen', description: 'x' })))
      .toBe('1st Floor · Kitchen');
    expect(photoPlace(photo({ description: 'Floor: 1 · Room: Bath' }))).toBe('Floor: 1 · Room: Bath');
    expect(photoPlace(photo({}))).toBe('');
  });
});

describe('photoDate', () => {
  it('reads as the app writes dates, and is blank without one', () => {
    expect(photoDate(photo({}))).toBe('10/12/2026');
    expect(photoDate(photo({ uploadDate: '' }))).toBe('');
  });
});

describe('zoomAt', () => {
  it('keeps the spot under the pointer in place', () => {
    const point = { x: 100, y: 50 };
    // 4x: 2000 x 2000, so it has room to move both ways
    const view = zoomAt(FIT_VIEW, 4, point, STAGE, SQUARE);
    // A spot at the pointer maps back to the pointer: scale * spot + pan
    expect(view.scale * point.x + view.x).toBe(point.x);
    expect(view.scale * point.y + view.y).toBe(point.y);
  });

  it('stays between fitted and the most it can zoom', () => {
    expect(zoomAt(FIT_VIEW, 0.2, { x: 0, y: 0 }, STAGE, SQUARE).scale).toBe(1);
    expect(zoomAt(FIT_VIEW, 99, { x: 0, y: 0 }, STAGE, SQUARE).scale).toBe(MAX_ZOOM);
  });

  it('recentres the photo on zooming back out to fitted', () => {
    const zoomed = { scale: 3, x: 120, y: -200 };
    const view = zoomAt(zoomed, 1, { x: 300, y: 40 }, STAGE, SQUARE);
    expect(view.scale).toBe(1);
    // Math.abs: the clamp can land on -0, which draws the same
    expect(Math.abs(view.x)).toBe(0);
    expect(Math.abs(view.y)).toBe(0);
  });
});

describe('clampView', () => {
  it('holds a side still until it is bigger than the stage', () => {
    // 2x: 1000 x 1000 on a 1000 x 500 stage, so it only pans up and down
    const view = clampView({ scale: 2, x: 80, y: 900 }, STAGE, SQUARE);
    expect(view).toEqual({ scale: 2, x: 0, y: 250 });
  });

  it('falls back to the stage size before the photo has loaded', () => {
    expect(clampView({ scale: 2, x: 9000, y: 9000 }, STAGE, { width: 0, height: 0 }))
      .toEqual({ scale: 2, x: 500, y: 250 });
  });
});
