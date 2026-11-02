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

const photoTime = (file: FileItem): number => {
  const time = file.uploadDate ? dayjs(file.uploadDate).valueOf() : NaN;
  return Number.isNaN(time) ? 0 : time;
};

// A claim's own photos keep their CompanyCam id in the name the import gives them
// (backend: client/claim_companycam.py), a water mitigation job's in externalId
const IMPORTED_NAME = /^companycam_(\d+)\.jpg$|^(companycam_video_\d+)\.\w+$/;

/** Which photo this is, whichever set's copy: its CompanyCam id, or else its record */
export const photoKey = (file: FileItem): string => {
  if (file.externalId) return file.externalId;
  const imported = IMPORTED_NAME.exec(file.originalName);
  return imported ? imported[1] || imported[2] : file.id;
};

/** Several sets as one list, newest first; a single set keeps its own order. Each
 *  set stores its own copy, so a photo imported into two shows once, as the first
 *  set's copy: the job's, which has the category and location someone gave it. */
export const mergePhotoSets = (sets: FileItem[][]): FileItem[] => {
  if (sets.length === 1) return sets[0];
  const seen = new Set<string>();
  return sets.flat()
    .filter((file) => {
      const key = photoKey(file);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => photoTime(b) - photoTime(a));
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
