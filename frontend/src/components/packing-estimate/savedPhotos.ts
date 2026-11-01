/**
 * The photos a Photo AI estimate keeps. A room holds its photos as base64 in
 * the browser, so calculating saves each one as a file and the estimate keeps
 * the file ids; recalculating brings them back into the rooms. `saved` maps
 * each image to its file, so a photo goes up only once.
 */
import * as packingService from '../../services/packingEstimateService';
import type { PhotoRoom } from '../../types/packing-estimate';
import { mapLimited } from './claimPhotos';

const PARALLEL_TRANSFERS = 4;

export type SavedPhotos = Map<string, string>;

/**
 * Saves the rooms' photos that aren't saved yet and gives each room's file ids.
 * One that won't go up is left out and counted in `failed`, so the calculation
 * can still go ahead.
 */
export async function saveRoomPhotos(
  rooms: PhotoRoom[],
  saved: SavedPhotos,
  contextId: string,
  onProgress?: (done: number, total: number) => void,
): Promise<{ photoIds: string[][]; failed: number }> {
  const unsaved = Array.from(new Set(rooms.flatMap(r => r.photos))).filter(p => !saved.has(p));
  let done = 0;
  let failed = 0;
  if (unsaved.length > 0) onProgress?.(0, unsaved.length);
  await mapLimited(unsaved, PARALLEL_TRANSFERS, async (image) => {
    try {
      saved.set(image, await packingService.saveRoomPhoto(image, contextId));
    } catch {
      failed += 1;
    }
    done += 1;
    onProgress?.(done, unsaved.length);
  });
  return {
    photoIds: rooms.map(r => r.photos.flatMap((p) => {
      const id = saved.get(p);
      return id ? [id] : [];
    })),
    failed,
  };
}

/** Each room's images, from its list of ids. One that won't load is left out and counted. */
async function fetchRoomImages(
  ids: string[][],
  fetchImage: (id: string) => Promise<string>,
  onProgress?: (done: number, total: number) => void,
): Promise<{ photos: string[][]; failed: number }> {
  const wanted = ids.flatMap((list, room) => list.map(id => ({ id, room })));
  let done = 0;
  let failed = 0;
  onProgress?.(0, wanted.length);
  const images = await mapLimited(wanted, PARALLEL_TRANSFERS, async ({ id }) => {
    let image: string | null = null;
    try {
      image = await fetchImage(id);
    } catch {
      failed += 1;
    }
    done += 1;
    onProgress?.(done, wanted.length);
    return image;
  });
  const photos: string[][] = ids.map(() => []);
  wanted.forEach(({ room }, i) => {
    const image = images[i];
    if (image) photos[room].push(image);
  });
  return { photos, failed };
}

/**
 * Each saved room's photos as base64, for the builder. Estimates from before
 * photos were saved have none; one on a claim finds its rooms' packing photos
 * there, the same ones its report shows.
 */
export async function loadSavedPhotos(
  estimateId: string,
  rooms: { photos?: string[] }[],
  claimId: string | null | undefined,
  saved: SavedPhotos,
  onProgress?: (done: number, total: number) => void,
): Promise<{ photos: string[][]; failed: number }> {
  const ids = rooms.map(r => r.photos ?? []);
  if (ids.flat().length > 0) {
    return fetchRoomImages(ids, async (id) => {
      const image = await packingService.getEstimatePhotoImage(estimateId, id);
      saved.set(image, id);
      return image;
    }, onProgress);
  }
  if (!claimId) return { photos: ids, failed: 0 };
  const onClaim = await packingService.getEstimateClaimRoomPhotos(estimateId).catch(() => ids);
  return fetchRoomImages(onClaim, id => packingService.getClaimPhotoImage(claimId, id), onProgress);
}
