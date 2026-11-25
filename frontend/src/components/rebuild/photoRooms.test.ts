import { describe, expect, it } from 'vitest';
import { matchRoom, orderByRoom, pdfPageCount, roomOptions, roomsFromScope } from './photoRooms';

const SCOPE = `[Main Level]
Kitchen
- Drywall: Replace 1/2" drywall
- Paint: walls, ceiling

Bathroom
- Plumbing: Detach & reset toilet

[Basement]
Family Room
- Flooring: Replace carpet`;

describe('roomsFromScope', () => {
  it('takes the area names, not the trade lines or level headings', () => {
    expect(roomsFromScope(SCOPE)).toEqual(['Kitchen', 'Bathroom', 'Family Room']);
  });
  it('is empty without a scope', () => {
    expect(roomsFromScope(null)).toEqual([]);
    expect(roomsFromScope('')).toEqual([]);
  });
});

describe('matchRoom', () => {
  it('spells a room as the list does', () => {
    expect(matchRoom(['Kitchen'], '  kitchen ')).toBe('Kitchen');
    expect(matchRoom(['Kitchen'], 'Master  Bedroom')).toBe('Master Bedroom');
    expect(matchRoom(['Kitchen'], null)).toBe('');
  });
});

describe('roomOptions', () => {
  it('keeps the scope first and adds the others once', () => {
    expect(roomOptions(['Kitchen', 'Bathroom'], ['bathroom', 'Hall', '', 'Hall'])).toEqual(['Kitchen', 'Bathroom', 'Hall']);
  });
});

describe('orderByRoom', () => {
  it('groups by room in the rooms order, photos with no room last', () => {
    const photos = [
      { id: 1, room: '' }, { id: 2, room: 'Bathroom' }, { id: 3, room: 'Kitchen' },
      { id: 4, room: 'Hall' }, { id: 5, room: 'Kitchen' },
    ];
    expect(orderByRoom(photos, ['Kitchen', 'Bathroom']).map(p => p.id)).toEqual([3, 5, 2, 4, 1]);
  });
});

describe('pdfPageCount', () => {
  it('fills pages in order when no photo has a room', () => {
    expect(pdfPageCount(['', '', ''], 2)).toBe(2);
  });
  it('starts each room on a page of its own, as the server does', () => {
    expect(pdfPageCount(['Kitchen', 'Kitchen', 'Kitchen', 'Bathroom', 'Hall'], 2)).toBe(4);
    expect(pdfPageCount(['Kitchen', ''], 2)).toBe(2);
  });
});
