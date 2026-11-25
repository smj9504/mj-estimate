/**
 * Completion photos by room: the rooms a project's photos can go under, the
 * page order they print in, and how many pages that makes. The server lays
 * the PDF out the same way (RebuildService.photo_pdf_layout): once any photo
 * has a room, each room starts a page of its own.
 */

/**
 * The rooms of a scope of work as drafted from the estimate
 * (rebuild/scope_summary.py): blocks apart by a blank line, each the room's
 * name (after a [Level] heading, if any) and then its work - one line, or
 * trade lines starting with "-" in scopes drafted before.
 */
export const roomsFromScope = (scope?: string | null): string[] => {
  const rooms: string[] = [];
  for (const block of (scope || '').split(/\n\s*\n/)) {
    const name = block.split('\n').map(l => l.trim()).find(l => l && !/^[-•*[]/.test(l));
    if (!name || name.length > 60) continue;
    // "Family Room, Hallway/Living Room": rooms that share a scope are one block
    for (const room of name.split(/\s*,\s*/)) {
      if (room && !rooms.some(r => sameRoom(r, room))) rooms.push(room);
    }
  }
  return rooms;
};

export const sameRoom = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/** A room as the list already spells it ("kitchen" -> "Kitchen"), else as given, tidied */
export const matchRoom = (rooms: string[], room?: string | null): string => {
  const name = (room || '').replace(/\s+/g, ' ').trim();
  if (!name) return '';
  return rooms.find(r => sameRoom(r, name)) ?? name;
};

/** Every room a photo can go under: the scope's first, then any other in the order it came */
export const roomOptions = (scopeRooms: string[], others: string[]): string[] => {
  const out = [...scopeRooms];
  for (const r of others) {
    if (r && !out.some(o => sameRoom(o, r))) out.push(r);
  }
  return out;
};

/**
 * Photos in the order they print: room by room in the order of `rooms`, each
 * room's photos in the order they were added; photos with no room last.
 */
export const orderByRoom = <T extends { room: string }>(photos: T[], rooms: string[]): T[] => {
  const rank = (room: string) => {
    if (!room) return rooms.length + 1;
    const i = rooms.findIndex(r => sameRoom(r, room));
    return i < 0 ? rooms.length : i;
  };
  return photos
    .map((p, i) => ({ p, i }))
    .sort((a, b) => rank(a.p.room) - rank(b.p.room) || a.i - b.i)
    .map(({ p }) => p);
};

/** Pages the PDF will have: room by room once any photo has a room, else just in order */
export const pdfPageCount = (rooms: string[], perPage: number): number => {
  if (!rooms.some(Boolean)) return Math.ceil(rooms.length / perPage);
  let pages = 0;
  let current: string | null = null;
  let onPage = 0;
  for (const room of rooms) {
    if (room !== current || onPage === perPage) {
      pages++;
      onPage = 0;
      current = room;
    }
    onPage++;
  }
  return pages;
};
