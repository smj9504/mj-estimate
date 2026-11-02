import { describe, expect, it, vi } from 'vitest';
import type { ClaimPackingPhoto } from '../../types/packing-estimate';

// The grouping is pure; keep the API client (it reads window) and the
// builder's import dialog out of the node test
vi.mock('../../services/api', () => ({ default: { defaults: {} } }));
vi.mock('../../services/packingEstimateService', () => ({}));
vi.mock('./FolderImportModal', () => ({ defaultPhotoRoom: vi.fn(), resolveNameCollisions: vi.fn() }));

// eslint-disable-next-line import/first
import { groupPackingRooms, roomNameOptions } from './claimPhotos';

let next = 0;
const photo = (room_name: string): ClaimPackingPhoto => {
  next += 1;
  return {
    id: `entry-${next}`,
    source: 'wm',
    photo_id: `photo-${next}`,
    room_name,
    thumbnail_url: `/thumb/${next}`,
    preview_url: `/preview/${next}`,
  };
};

describe('claim packing photos by room', () => {
  it('groups the photos of a room, in the order the rooms come', () => {
    const rooms = groupPackingRooms([photo('Kitchen'), photo('Den'), photo('Kitchen')]);
    expect(rooms.map(r => [r.room_name, r.photos.length])).toEqual([['Kitchen', 2], ['Den', 1]]);
    expect(groupPackingRooms([])).toEqual([]);
  });

  it('offers each room name once, not the room itself, matching what is typed', () => {
    const names = ['Basement', 'Den', 'Kitchen', 'basement', 'Living Room', 'Kitchen'];
    expect(roomNameOptions(names, '', 'den').map(o => o.value)).toEqual(['Basement', 'Kitchen', 'Living Room']);
    expect(roomNameOptions(names, ' KIT').map(o => o.value)).toEqual(['Kitchen']);
    expect(roomNameOptions(names, 'Storage')).toEqual([]);
  });
});
