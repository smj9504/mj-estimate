/**
 * A claim's packing photos: the claim photos picked for its packing estimate,
 * filed by room. Grouping for the claim page, and the Photo AI rooms the
 * builder makes from them (each photo fetched as a JPEG sized for the AI).
 */
import api from '../../services/api';
import * as packingService from '../../services/packingEstimateService';
import type { ClaimPackingPhoto, Floor, PhotoRoom } from '../../types/packing-estimate';
import { defaultPhotoRoom, resolveNameCollisions } from './FolderImportModal';

/** react-query key of a claim's packing photos */
export const claimPackingPhotosKey = (claimId: string) => ['claim-packing-photos', claimId];

/** The analysis looks at this many photos of a room, the most different ones */
export const AI_PHOTOS_PER_ROOM = 6;

const PARALLEL_FETCHES = 4;

export interface PackingRoomGroup {
  room_name: string;
  photos: ClaimPackingPhoto[];
}

/** Photos room by room, in the order the server returns them */
export function groupPackingRooms(photos: ClaimPackingPhoto[]): PackingRoomGroup[] {
  const rooms = new Map<string, ClaimPackingPhoto[]>();
  for (const p of photos) {
    rooms.set(p.room_name, [...(rooms.get(p.room_name) ?? []), p]);
  }
  return Array.from(rooms, ([room_name, list]) => ({ room_name, photos: list }));
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
 * Photo AI rooms from the claim's packing photos: all its rooms, or only
 * `roomNames`. A room named like one in `existingNames` (already in the
 * builder) is loaded as "Kitchen (2)". Photos that can't be loaded are left
 * out and counted in `failed`; a room left with no photos is dropped.
 */
export async function loadClaimPhotoRooms(
  claimId: string,
  onProgress?: (done: number, total: number) => void,
  options: { roomNames?: string[]; existingNames?: string[] } = {},
): Promise<{ rooms: PhotoRoom[]; failed: number }> {
  const { roomNames, existingNames = [] } = options;
  const groups = groupPackingRooms(await packingService.listClaimPhotos(claimId))
    .filter(g => !roomNames || roomNames.includes(g.room_name));
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
