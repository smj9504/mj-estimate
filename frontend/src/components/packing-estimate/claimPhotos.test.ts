import { describe, expect, it, vi } from 'vitest';
import type { ClaimPackingPhoto, PackingPhotoCategory } from '../../types/packing-estimate';

// The grouping is pure; keep the API client (it reads window) and the
// builder's import dialog out of the node test
vi.mock('../../services/api', () => ({ default: { defaults: {} } }));
vi.mock('../../services/packingEstimateService', () => ({}));
vi.mock('./FolderImportModal', () => ({ defaultPhotoRoom: vi.fn(), resolveNameCollisions: vi.fn() }));

// eslint-disable-next-line import/first
import {
  defaultPackingCategory, groupPackingCategories, groupPackingRooms, packingCategoryLabel, packingRoomKey,
  roomNameOptions,
} from './claimPhotos';

let next = 0;
const photo = (category: PackingPhotoCategory, room_name: string): ClaimPackingPhoto => {
  next += 1;
  return {
    id: `entry-${next}`,
    source: category === 'water_mitigation' ? 'wm' : 'claim',
    photo_id: `photo-${next}`,
    category,
    room_name,
    thumbnail_url: `/thumb/${next}`,
    preview_url: `/preview/${next}`,
  };
};

describe('claim packing photos by category, then room', () => {
  it('keeps a room name of two categories as two rooms', () => {
    const photos = [
      photo('water_mitigation', 'Kitchen'),
      photo('water_mitigation', 'Kitchen'),
      photo('water_mitigation', 'Den'),
      photo('work_completion', 'Kitchen'),
    ];
    const rooms = groupPackingRooms(photos);
    expect(rooms.map(r => [r.category, r.room_name, r.photos.length])).toEqual([
      ['water_mitigation', 'Kitchen', 2],
      ['water_mitigation', 'Den', 1],
      ['work_completion', 'Kitchen', 1],
    ]);
    expect(new Set(rooms.map(packingRoomKey)).size).toBe(3);
  });

  it('lists the categories that have photos, in their order, with counts', () => {
    const photos = [
      photo('work_completion', 'Kitchen'),
      photo('work_completion', 'Den'),
      photo('water_mitigation', 'Bedroom'),
    ];
    expect(groupPackingCategories(photos).map(g => ({
      category: g.category, label: g.label, rooms: g.rooms.map(r => r.room_name), photoCount: g.photoCount,
    }))).toEqual([
      { category: 'water_mitigation', label: 'Water mitigation', rooms: ['Bedroom'], photoCount: 1 },
      { category: 'work_completion', label: 'Work completion', rooms: ['Kitchen', 'Den'], photoCount: 2 },
    ]);
    expect(groupPackingCategories([photo('work_completion', 'Den')]).map(g => g.category))
      .toEqual(['work_completion']);
    expect(groupPackingCategories([])).toEqual([]);
  });

  it('offers each room name once, not the room itself, matching what is typed', () => {
    const names = ['Basement', 'Den', 'Kitchen', 'basement', 'Living Room', 'Kitchen'];
    expect(roomNameOptions(names, '', 'den').map(o => o.value)).toEqual(['Basement', 'Kitchen', 'Living Room']);
    expect(roomNameOptions(names, ' KIT').map(o => o.value)).toEqual(['Kitchen']);
    expect(roomNameOptions(names, 'Storage')).toEqual([]);
  });

  it('starts a photo set under its own category', () => {
    expect(defaultPackingCategory('wm')).toBe('water_mitigation');
    expect(defaultPackingCategory('claim')).toBe('work_completion');
    expect(packingCategoryLabel('work_completion')).toBe('Work completion');
  });
});
