/**
 * A claim's packing photos: the claim photos picked for its packing estimate,
 * filed under a category (the stage of the job: water mitigation, work
 * completion), then a room. Grouping for the claim page, and the Photo AI
 * rooms the builder makes from them (each photo fetched as a JPEG sized for
 * the AI).
 */
import api from '../../services/api';
import * as packingService from '../../services/packingEstimateService';
import type {
  ClaimPackingPhoto, Floor, PackingPhotoCategory, PackingPhotoSource, PhotoRoom,
} from '../../types/packing-estimate';
import { defaultPhotoRoom, resolveNameCollisions } from './FolderImportModal';

/** react-query key of a claim's packing photos */
export const claimPackingPhotosKey = (claimId: string) => ['claim-packing-photos', claimId];

/** Room names offered after a category's own rooms when filing or moving photos */
export const COMMON_ROOMS = [
  'Kitchen', 'Living Room', 'Family Room', 'Dining Room', 'Master Bedroom', 'Bedroom',
  'Bathroom', 'Office', 'Laundry Room', 'Basement', 'Garage', 'Closet',
];

/**
 * Room names to offer, without repeats (any case) or `exclude`, matching
 * what has been typed
 */
export function roomNameOptions(names: string[], typed: string, exclude?: string): { value: string }[] {
  const seen = new Set<string>(exclude ? [exclude.trim().toLowerCase()] : []);
  const text = typed.trim().toLowerCase();
  return names.filter(name => {
    const key = name.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return !text || key.includes(text);
  }).map(name => ({ value: name }));
}

/** The analysis looks at this many photos of a room, the most different ones */
export const AI_PHOTOS_PER_ROOM = 6;

const PARALLEL_FETCHES = 4;

/** The categories a packing photo is filed under before its room, in the order they are listed */
export const PACKING_CATEGORIES: { value: PackingPhotoCategory; label: string }[] = [
  { value: 'water_mitigation', label: 'Water mitigation' },
  { value: 'work_completion', label: 'Work completion' },
];

export const packingCategoryLabel = (category: PackingPhotoCategory): string =>
  PACKING_CATEGORIES.find(c => c.value === category)?.label ?? category;

/**
 * The category a photo set's photos most likely go under: a water
 * mitigation job's photos under water mitigation, the claim's Completion
 * photos under work completion
 */
export const defaultPackingCategory = (source: PackingPhotoSource): PackingPhotoCategory =>
  (source === 'wm' ? 'water_mitigation' : 'work_completion');

export interface PackingRoomGroup {
  category: PackingPhotoCategory;
  room_name: string;
  photos: ClaimPackingPhoto[];
}

export interface PackingCategoryGroup {
  category: PackingPhotoCategory;
  label: string;
  rooms: PackingRoomGroup[];
  photoCount: number;
}

/** A room's key: the same room name can be in more than one category */
export const packingRoomKey = (room: { category: PackingPhotoCategory; room_name: string }): string =>
  `${room.category}/${room.room_name}`;

/** Photos room by room, in the order the server returns them (category by category) */
export function groupPackingRooms(photos: ClaimPackingPhoto[]): PackingRoomGroup[] {
  const rooms = new Map<string, PackingRoomGroup>();
  for (const p of photos) {
    const key = packingRoomKey(p);
    const room = rooms.get(key);
    if (room) room.photos.push(p);
    else rooms.set(key, { category: p.category, room_name: p.room_name, photos: [p] });
  }
  return Array.from(rooms.values());
}

/** Rooms category by category, the categories that have photos */
export function groupPackingCategories(photos: ClaimPackingPhoto[]): PackingCategoryGroup[] {
  const rooms = groupPackingRooms(photos);
  return PACKING_CATEGORIES.flatMap(({ value, label }) => {
    const inCategory = rooms.filter(r => r.category === value);
    if (inCategory.length === 0) return [];
    const photoCount = inCategory.reduce((n, r) => n + r.photos.length, 0);
    return [{ category: value, label, rooms: inCategory, photoCount }];
  });
}

/** An API path as a URL an <img> can load */
export function apiUrl(path: string): string {
  if (path.startsWith('http')) return path;
  const base = (api.defaults.baseURL || '').replace(/\/$/, '');
  return `${base}${path}`;
}

/** A WM location level ("Basement", "2nd Floor", "Main level") as the floor setting */
export function floorFromLevel(level?: string | null): Floor | undefined {
  const text = (level || '').toLowerCase();
  if (!text) return undefined;
  if (/basement|lower|cellar/.test(text)) return 'basement';
  if (/\b(1st|first|main|ground)\b|^1\b/.test(text)) return '1st';
  if (/\b(2nd|second)\b|^2\b/.test(text)) return '2nd';
  if (/\b(3rd|third)\b|^3\b/.test(text)) return '3rd';
  if (/\b([4-9]th|fourth|fifth|attic)\b|^[4-9]\b/.test(text)) return '4th+';
  return undefined;
}

/** The floor most of a room's tagged photos were taken on */
function roomFloor(photos: ClaimPackingPhoto[]): Floor {
  const counts = new Map<Floor, number>();
  for (const p of photos) {
    const floor = floorFromLevel(p.location_level);
    if (floor) counts.set(floor, (counts.get(floor) ?? 0) + 1);
  }
  let best: Floor = '1st';
  let most = 0;
  counts.forEach((n, floor) => {
    if (n > most) { best = floor; most = n; }
  });
  return best;
}

/** Run fn over items, a few at a time */
async function mapLimited<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

/**
 * Photo AI rooms from the claim's packing photos: all its rooms, the rooms
 * of one `category`, or only the rooms in `roomKeys` (packingRoomKey). A room
 * named like one in `existingNames` (already in the builder) is loaded as
 * "Kitchen (2)". Photos that can't be loaded are left out and counted in
 * `failed`; a room left with no photos is dropped.
 */
export async function loadClaimPhotoRooms(
  claimId: string,
  onProgress?: (done: number, total: number) => void,
  options: { category?: PackingPhotoCategory; roomKeys?: string[]; existingNames?: string[] } = {},
): Promise<{ rooms: PhotoRoom[]; failed: number }> {
  const { category, roomKeys, existingNames = [] } = options;
  const groups = groupPackingRooms(await packingService.listClaimPhotos(claimId))
    .filter(g => !category || g.category === category)
    .filter(g => !roomKeys || roomKeys.includes(packingRoomKey(g)));
  const all = groups.flatMap(g => g.photos);
  let done = 0;
  onProgress?.(0, all.length);

  const images = await mapLimited(all, PARALLEL_FETCHES, async (photo) => {
    let image: string | null = null;
    try {
      image = await packingService.getClaimPhotoImage(claimId, photo.id);
    } catch {
      image = null;
    }
    done += 1;
    onProgress?.(done, all.length);
    return image;
  });
  const imageById = new Map(all.map((p, i) => [p.id, images[i]]));

  const loaded = groups.flatMap(group => {
    const photos = group.photos
      .map(p => imageById.get(p.id))
      .filter((img): img is string => !!img);
    return photos.length > 0 ? [{ group, photos }] : [];
  });
  const names = resolveNameCollisions(loaded.map(l => l.group.room_name), existingNames);
  const rooms = loaded.map(({ group, photos }, i) => ({
    ...defaultPhotoRoom(names[i]),
    floor: roomFloor(group.photos),
    photos,
  }));
  return { rooms, failed: images.filter(img => !img).length };
}
