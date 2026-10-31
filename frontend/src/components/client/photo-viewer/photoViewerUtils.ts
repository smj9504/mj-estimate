import dayjs from 'dayjs';
import type { FileItem } from '../../common/FileGallery/types';

export const UNCATEGORIZED = 'uncategorized';

export const photoCategory = (file: FileItem): string =>
  (file.category || '').trim().toLowerCase() || UNCATEGORIZED;

// Its location tag, or for a MagicPlan photo the floor and room in its description
export const photoPlace = (file: FileItem): string =>
  [file.locationLevel, file.locationRoom].filter(Boolean).join(' · ') || file.description || '';

export const photoDate = (file: FileItem): string => {
  const date = file.uploadDate ? dayjs(file.uploadDate) : null;
  return date?.isValid() ? date.format('MM/DD/YYYY') : '';
};

export interface CategoryCount {
  key: string;
  count: number;
}

/** The categories these photos are in: the set's own order first, then any
 *  others alphabetically, with Uncategorized last */
export const countCategories = (files: FileItem[], order: string[]): CategoryCount[] => {
  const counts = new Map<string, number>();
  files.forEach((file) => {
    const key = photoCategory(file);
    counts.set(key, (counts.get(key) || 0) + 1);
  });
  const rank = (key: string) => {
    if (key === UNCATEGORIZED) return order.length + 1;
    const index = order.indexOf(key);
    return index === -1 ? order.length : index;
  };
  return Array.from(counts, ([key, count]) => ({ key, count }))
    .sort((a, b) => rank(a.key) - rank(b.key) || a.key.localeCompare(b.key));
};

export interface PhotoView {
  scale: number;
  x: number;
  y: number;
}

export interface Size {
  width: number;
  height: number;
}

export const FIT_VIEW: PhotoView = { scale: 1, x: 0, y: 0 };
export const MAX_ZOOM = 8;

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

// The photo's size at scale 1, fitted inside the stage
const fittedSize = (stage: Size, natural: Size): Size => {
  if (!natural.width || !natural.height) return stage;
  const ratio = Math.min(stage.width / natural.width, stage.height / natural.height);
  return { width: natural.width * ratio, height: natural.height * ratio };
};

/** Keep the photo's edges from coming inside the stage while it's bigger than the stage */
export const clampView = (view: PhotoView, stage: Size, natural: Size): PhotoView => {
  const fitted = fittedSize(stage, natural);
  const maxX = Math.max(0, (fitted.width * view.scale - stage.width) / 2);
  const maxY = Math.max(0, (fitted.height * view.scale - stage.height) / 2);
  return { scale: view.scale, x: clamp(view.x, -maxX, maxX), y: clamp(view.y, -maxY, maxY) };
};

/** Zoom keeping the spot under `point` (measured from the stage's centre) in place */
export const zoomAt = (
  view: PhotoView,
  nextScale: number,
  point: { x: number; y: number },
  stage: Size,
  natural: Size,
): PhotoView => {
  const scale = clamp(nextScale, 1, MAX_ZOOM);
  const ratio = scale / view.scale;
  return clampView({
    scale,
    x: point.x - (point.x - view.x) * ratio,
    y: point.y - (point.y - view.y) * ratio,
  }, stage, natural);
};
