import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PhotoRoom } from '../../types/packing-estimate';

vi.mock('../../services/api', () => ({ default: { defaults: { baseURL: '' } } }));
vi.mock('../../services/packingEstimateService', () => ({
  saveRoomPhoto: vi.fn(),
  getEstimatePhotoImage: vi.fn(),
  getEstimateClaimRoomPhotos: vi.fn(),
  getClaimPhotoImage: vi.fn(),
}));
vi.mock('./FolderImportModal', () => ({
  defaultPhotoRoom: (room_name: string) => ({ room_name, photos: [] }),
  resolveNameCollisions: (names: string[]) => names,
}));

const { loadSavedPhotos, saveRoomPhotos } = await import('./savedPhotos');
const service = await import('../../services/packingEstimateService');
const saveRoomPhoto = vi.mocked(service.saveRoomPhoto);
const getEstimatePhotoImage = vi.mocked(service.getEstimatePhotoImage);
const getEstimateClaimRoomPhotos = vi.mocked(service.getEstimateClaimRoomPhotos);
const getClaimPhotoImage = vi.mocked(service.getClaimPhotoImage);

const room = (photos: string[]) => ({ photos }) as PhotoRoom;

beforeEach(() => vi.resetAllMocks());

describe('saveRoomPhotos', () => {
  it('saves each photo once and gives every room its file ids', async () => {
    saveRoomPhoto.mockImplementation(async image => `file-${image}`);
    const saved = new Map([['old', 'file-old']]);

    const { photoIds, failed } = await saveRoomPhotos(
      [room(['old', 'new']), room(['new']), room([])], saved, 'claim-1',
    );

    expect(photoIds).toEqual([['file-old', 'file-new'], ['file-new'], []]);
    expect(failed).toBe(0);
    expect(saveRoomPhoto.mock.calls).toEqual([['new', 'claim-1']]);
    // Calculating again sends nothing more
    await saveRoomPhotos([room(['old', 'new'])], saved, 'claim-1');
    expect(saveRoomPhoto).toHaveBeenCalledTimes(1);
  });

  it('leaves out a photo that will not go up, and counts it', async () => {
    saveRoomPhoto.mockImplementation(async (image) => {
      if (image === 'bad') throw new Error('nope');
      return `file-${image}`;
    });
    const { photoIds, failed } = await saveRoomPhotos([room(['good', 'bad'])], new Map(), 'c');
    expect(photoIds).toEqual([['file-good']]);
    expect(failed).toBe(1);
  });
});

describe('loadSavedPhotos', () => {
  it("brings each room's photos back in order and remembers them as saved", async () => {
    getEstimatePhotoImage.mockImplementation(async (_, id) => `image-${id}`);
    const saved = new Map<string, string>();
    const progress: number[] = [];

    const { photos, failed } = await loadSavedPhotos('est-1', [
      { photos: ['a', 'b'] }, { photos: [] }, { photos: ['c'] },
    ], 'claim-1', saved, done => progress.push(done));

    expect(photos).toEqual([['image-a', 'image-b'], [], ['image-c']]);
    expect(failed).toBe(0);
    expect(saved.get('image-b')).toBe('b');
    expect(progress[progress.length - 1]).toBe(3);
    expect(getEstimatePhotoImage).toHaveBeenCalledWith('est-1', 'a');
    // It has saved photos, so a room without any stays without
    expect(getEstimateClaimRoomPhotos).not.toHaveBeenCalled();
  });

  it('leaves out a photo that will not load, and counts it', async () => {
    getEstimatePhotoImage.mockImplementation(async (_, id) => {
      if (id === 'gone') throw new Error('404');
      return `image-${id}`;
    });
    const { photos, failed } = await loadSavedPhotos(
      'est-1', [{ photos: ['a', 'gone', 'b'] }], null, new Map(),
    );
    expect(photos).toEqual([['image-a', 'image-b']]);
    expect(failed).toBe(1);
  });

  it("finds an older estimate's photos on its claim", async () => {
    getEstimateClaimRoomPhotos.mockResolvedValue([['e1', 'e2'], []]);
    getClaimPhotoImage.mockImplementation(async (_, id) => `image-${id}`);
    const saved = new Map<string, string>();

    const { photos } = await loadSavedPhotos('est-1', [{}, { photos: [] }], 'claim-1', saved);

    expect(photos).toEqual([['image-e1', 'image-e2'], []]);
    expect(getClaimPhotoImage).toHaveBeenCalledWith('claim-1', 'e1');
    // Not saved with an estimate yet, so the next calculation saves them
    expect(saved.size).toBe(0);
  });

  it('has nothing to show for an older estimate with no claim, or one it can no longer see', async () => {
    const rooms = [{ photos: [] }];
    expect((await loadSavedPhotos('est-1', rooms, null, new Map())).photos).toEqual([[]]);
    expect(getEstimateClaimRoomPhotos).not.toHaveBeenCalled();

    getEstimateClaimRoomPhotos.mockRejectedValue(new Error('404'));
    expect(await loadSavedPhotos('est-1', rooms, 'claim-1', new Map())).toEqual({ photos: [[]], failed: 0 });
  });
});
