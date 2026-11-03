/**
 * A visit's rooms and shots as this phone knows them, and sending them.
 *
 * A shot is written to IndexedDB the moment it's taken and sent from there in the
 * background, so no signal in the basement, a closed tab or a dead battery loses
 * nothing: it goes when it can. Rooms and shots get their ids here, which makes
 * every send safe to repeat. Rooms reach the server once they have a shot, and
 * before it, so a room someone opened and left never shows up in the office.
 */

import { openDB, type IDBPDatabase } from 'idb';
import { apiUrl, fieldVisitService } from '../../services/fieldVisitService';
import type {
  FieldVisitClaim,
  FieldVisitClient,
  FieldVisitContract,
  FieldVisitDetail,
  FloorKey,
  FloorSource,
  NameSource,
  ServerRoom,
  ServerShot,
  ShotKind,
  ShotReadings,
} from '../../types/fieldVisit';

export interface LocalRoom {
  id: string;
  visitId: string;
  name: string;
  nameSource: NameSource;
  floor: FloorKey;
  floorSource: FloorSource;
  roomType: string | null;
  position: number;
  /** Has changes the server hasn't got */
  dirty: boolean;
}

export type ShotStatus = 'queued' | 'sending' | 'sent' | 'failed';

export interface LocalShot {
  id: string;
  visitId: string;
  roomId: string;
  kind: ShotKind;
  wall: number | null;
  capturedAt: string;
  isVideo: boolean;
  contentType: string;
  name: string;
  readings: ShotReadings;
  moved: boolean;
  /** The room's first photo, which the server reads the room from */
  firstPhoto?: boolean;
  status: ShotStatus;
  error?: string;
  /** Held until it's sent */
  blob?: Blob;
  thumb?: Blob;
  progress?: number;
  /** Sent, with changes the server hasn't got */
  dirty?: boolean;
  /** Sent, and the delete is waiting to go */
  deleted?: boolean;
  sentAt?: number;
  fileId?: string;
  thumbnailUrl?: string;
  url?: string;
  aiRoomType?: string | null;
}

export interface VisitHeader {
  id: string;
  claimId: string | null;
  groundAltitude: number | null;
  client: FieldVisitClient;
  contracts: FieldVisitContract[];
  claims: FieldVisitClaim[];
}

export interface VisitSnapshot {
  loaded: boolean;
  header: VisitHeader | null;
  rooms: LocalRoom[];
  shots: LocalShot[];
}

const EMPTY: VisitSnapshot = { loaded: false, header: null, rooms: [], shots: [] };

const DB_NAME = 'field-visits';
const DB_VERSION = 1;
const MAX_ACTIVE = 2;
const SENT_KEPT_MS = 14 * 24 * 60 * 60 * 1000;
const MAX_HOLD_MS = 60000;

export const makeId = (): string => {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  // Not on plain http, which a phone gets testing against a laptop
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
};

// ── Storage ─────────────────────────────────────────

let dbPromise: Promise<IDBPDatabase | null> | null = null;

const getDb = (): Promise<IDBPDatabase | null> => {
  dbPromise ??= openDB(DB_NAME, DB_VERSION, {
    upgrade(db) {
      db.createObjectStore('visits', { keyPath: 'id' });
      db.createObjectStore('rooms', { keyPath: 'id' }).createIndex('visitId', 'visitId');
      db.createObjectStore('shots', { keyPath: 'id' }).createIndex('visitId', 'visitId');
    },
  }).catch(() => null); // Storage off: shots still send, but only while the page stays open
  return dbPromise;
};

const stored = async (store: 'visits' | 'rooms' | 'shots', write: (db: IDBPDatabase) => Promise<unknown>) => {
  try {
    const db = await getDb();
    if (db) await write(db);
  } catch (err) {
    console.warn(`[field-visit] Could not save to ${store}:`, err);
  }
};

const saveRoomLocally = (room: LocalRoom) => stored('rooms', db => db.put('rooms', room));

interface SavedBytes {
  bytes: ArrayBuffer;
  type: string;
}

const toBytes = async (blob?: Blob): Promise<SavedBytes | undefined> => (
  blob ? { bytes: await blob.arrayBuffer(), type: blob.type } : undefined
);
const fromBytes = (saved?: SavedBytes) => (saved ? new Blob([saved.bytes], { type: saved.type }) : undefined);

// One at a time and in order, so a slow write can't bring back a shot that's since been sent or deleted
let shotWrites: Promise<unknown> = Promise.resolve();
const inOrder = (write: () => Promise<unknown>) => {
  shotWrites = shotWrites.then(write, write);
  return shotWrites;
};

const saveShotLocally = (shot: LocalShot) => inOrder(async () => {
  // Progress only means anything to this page
  const { progress: _progress, ...kept } = shot;
  const db = await getDb();
  if (!db) return;
  try {
    await db.put('shots', kept);
  } catch {
    // Safari's Private Browsing refuses a Blob here but takes the same bytes as an ArrayBuffer.
    // This is what keeps a photo taken with no signal when the page is closed.
    await stored('shots', async (on) => {
      const blobBytes = await toBytes(kept.blob);
      const thumbBytes = await toBytes(kept.thumb);
      await on.put('shots', { ...kept, blob: undefined, thumb: undefined, blobBytes, thumbBytes });
    });
  }
});

const forgetShotLocally = (id: string) => inOrder(() => stored('shots', db => db.delete('shots', id)));

const readSavedShot = ({ blobBytes, thumbBytes, ...shot }: LocalShot & { blobBytes?: SavedBytes; thumbBytes?: SavedBytes }): LocalShot => ({
  ...shot,
  blob: shot.blob ?? fromBytes(blobBytes),
  thumb: shot.thumb ?? fromBytes(thumbBytes),
});

// ── State ───────────────────────────────────────────

const states = new Map<string, VisitSnapshot>();
const listeners = new Map<string, Set<() => void>>();
const loading = new Map<string, Promise<void>>();

const stateOf = (visitId: string) => states.get(visitId) ?? EMPTY;

const update = (visitId: string, change: Partial<VisitSnapshot>) => {
  states.set(visitId, { ...stateOf(visitId), ...change });
  listeners.get(visitId)?.forEach(listener => listener());
};

const patchShot = (visitId: string, shotId: string, change: Partial<LocalShot>): LocalShot | undefined => {
  const state = stateOf(visitId);
  const shot = state.shots.find(s => s.id === shotId);
  if (!shot) return undefined;
  const next = { ...shot, ...change };
  update(visitId, { shots: state.shots.map(s => (s.id === shotId ? next : s)) });
  return next;
};

const patchRoom = (visitId: string, roomId: string, change: Partial<LocalRoom>): LocalRoom | undefined => {
  const state = stateOf(visitId);
  const room = state.rooms.find(r => r.id === roomId);
  if (!room) return undefined;
  const next = { ...room, ...change };
  update(visitId, { rooms: state.rooms.map(r => (r.id === roomId ? next : r)) });
  return next;
};

export const subscribeVisit = (visitId: string, listener: () => void) => {
  if (!listeners.has(visitId)) listeners.set(visitId, new Set());
  listeners.get(visitId)!.add(listener);
  return () => {
    listeners.get(visitId)?.delete(listener);
  };
};

export const getVisitSnapshot = (visitId: string): VisitSnapshot => stateOf(visitId);

export const loadVisit = (visitId: string): Promise<void> => {
  if (stateOf(visitId).loaded) return Promise.resolve();
  const running = loading.get(visitId);
  if (running) return running;
  const load = (async () => {
    let rooms: LocalRoom[] = [];
    let shots: LocalShot[] = [];
    let header: VisitHeader | null = null;
    try {
      const db = await getDb();
      if (db) {
        rooms = await db.getAllFromIndex('rooms', 'visitId', visitId);
        shots = (await db.getAllFromIndex('shots', 'visitId', visitId)).map(readSavedShot);
        header = (await db.get('visits', visitId)) ?? null;
      }
    } catch (err) {
      console.warn('[field-visit] Could not read saved visit:', err);
    }
    // One that was going out when the page died goes again
    shots = shots.map(shot => (shot.status === 'sending' ? { ...shot, status: 'queued' } : shot));
    shots.sort(inOrderTaken);
    rooms.sort((a, b) => a.position - b.position);
    update(visitId, { loaded: true, rooms, shots, header });
    loading.delete(visitId);
    kick();
  })();
  loading.set(visitId, load);
  return load;
};

// ── What the server says ────────────────────────────

const roomFromServer = (visitId: string, room: ServerRoom): LocalRoom => ({
  id: room.id,
  visitId,
  name: room.name,
  nameSource: room.name_source,
  floor: room.floor,
  floorSource: room.floor_source,
  roomType: room.room_type,
  position: room.position,
  dirty: false,
});

const shotFromServer = (visitId: string, shot: ServerShot, kept?: LocalShot): LocalShot => ({
  id: shot.id,
  visitId,
  roomId: kept?.dirty ? kept.roomId : shot.room_id,
  kind: kept?.dirty ? kept.kind : shot.kind,
  wall: kept?.dirty ? kept.wall : shot.wall,
  capturedAt: kept?.capturedAt ?? shot.captured_at ?? new Date().toISOString(),
  isVideo: shot.is_video,
  contentType: kept?.contentType ?? (shot.is_video ? 'video/mp4' : 'image/jpeg'),
  name: kept?.name ?? shot.id,
  readings: kept?.readings ?? {},
  moved: shot.moved,
  status: 'sent',
  thumb: kept?.thumb,
  dirty: kept?.dirty,
  sentAt: kept?.sentAt,
  fileId: shot.file_id,
  thumbnailUrl: shot.thumbnail_url,
  url: shot.url,
  aiRoomType: shot.ai_room_type,
});

const timeOf = (shot: LocalShot) => Date.parse(shot.capturedAt) || 0;

const inOrderTaken = (a: LocalShot, b: LocalShot) => timeOf(a) - timeOf(b);

const roomChanged = (a: LocalRoom, b: LocalRoom) => (
  a.name !== b.name || a.nameSource !== b.nameSource || a.floor !== b.floor || a.floorSource !== b.floorSource
  || a.roomType !== b.roomType || a.position !== b.position || a.dirty !== b.dirty
);

const shotChanged = (a: LocalShot, b: LocalShot) => (
  a.roomId !== b.roomId || a.kind !== b.kind || a.wall !== b.wall || a.aiRoomType !== b.aiRoomType
  || a.status !== b.status || a.fileId !== b.fileId || a.url !== b.url || a.thumbnailUrl !== b.thumbnailUrl
);

/**
 * Bring in what the server has. What this phone hasn't sent yet wins, and a sent
 * shot missing from the answer was deleted elsewhere, unless it was sent after the
 * answer was made. Rows that haven't changed stay the same objects: this runs every
 * few seconds, and each one rewritten would be a thumbnail written to disk again.
 */
export const mergeServerVisit = (visitId: string, detail: FieldVisitDetail, askedAt: number) => {
  const state = stateOf(visitId);
  const header: VisitHeader = {
    id: detail.id,
    claimId: detail.claim_id,
    groundAltitude: detail.ground_altitude,
    client: detail.client,
    contracts: detail.contracts,
    claims: detail.claims,
  };

  const localRooms = new Map(state.rooms.map(room => [room.id, room]));
  const serverRoomIds = new Set(detail.rooms.map(room => room.id));
  const rooms = [
    ...detail.rooms.map((room) => {
      const local = localRooms.get(room.id);
      if (local?.dirty) return local;
      const next = roomFromServer(visitId, room);
      return local && !roomChanged(local, next) ? local : next;
    }),
    ...state.rooms.filter(room => !serverRoomIds.has(room.id)),
  ].sort((a, b) => a.position - b.position);

  const localShots = new Map(state.shots.map(shot => [shot.id, shot]));
  const serverShotIds = new Set(detail.shots.map(shot => shot.id));
  const shots: LocalShot[] = [];
  detail.shots.forEach((shot) => {
    const local = localShots.get(shot.id);
    if (local && (local.deleted || local.status !== 'sent')) {
      shots.push(local);
      return;
    }
    const next = shotFromServer(visitId, shot, local);
    shots.push(local && !shotChanged(local, next) ? local : next);
  });
  const forgotten: string[] = [];
  state.shots.forEach((shot) => {
    if (serverShotIds.has(shot.id)) return;
    if (shot.status === 'sent' && !shot.deleted && (shot.sentAt ?? 0) < askedAt) forgotten.push(shot.id);
    else shots.push(shot);
  });
  shots.sort(inOrderTaken);

  update(visitId, { loaded: true, header, rooms, shots });
  stored('visits', db => db.put('visits', header));
  rooms.forEach((room) => {
    if (localRooms.get(room.id) !== room) saveRoomLocally(room);
  });
  shots.forEach((shot) => {
    if (localShots.get(shot.id) !== shot) saveShotLocally(shot);
  });
  forgotten.forEach(id => forgetShotLocally(id));
  kick();
};

// ── Changes made here ───────────────────────────────

export const addRoom = (
  visitId: string,
  fields: { name: string; floor: FloorKey; floorSource: FloorSource; nameSource?: NameSource; roomType?: string | null },
): LocalRoom => {
  const state = stateOf(visitId);
  const room: LocalRoom = {
    id: makeId(),
    visitId,
    name: fields.name,
    nameSource: fields.nameSource ?? 'default',
    floor: fields.floor,
    floorSource: fields.floorSource,
    roomType: fields.roomType ?? null,
    position: state.rooms.reduce((top, r) => Math.max(top, r.position + 1), 0),
    dirty: true,
  };
  update(visitId, { rooms: [...state.rooms, room] });
  saveRoomLocally(room);
  return room;
};

export const updateRoom = (visitId: string, roomId: string, change: Partial<LocalRoom>) => {
  const room = patchRoom(visitId, roomId, { ...change, dirty: true });
  if (room) saveRoomLocally(room);
  kick();
};

export const addShot = (
  visitId: string,
  fields: Pick<LocalShot, 'roomId' | 'kind' | 'wall' | 'isVideo' | 'contentType' | 'name' | 'readings' | 'moved' | 'firstPhoto' | 'blob' | 'thumb'>
    & { capturedAt?: string },
): LocalShot => {
  const shot: LocalShot = {
    ...fields,
    id: makeId(),
    visitId,
    capturedAt: fields.capturedAt ?? new Date().toISOString(),
    status: 'queued',
  };
  update(visitId, { shots: [...stateOf(visitId).shots, shot].sort(inOrderTaken) });
  saveShotLocally(shot).then(kick);
  kick();
  return shot;
};

export const updateShot = (
  visitId: string,
  shotId: string,
  change: Partial<Pick<LocalShot, 'roomId' | 'kind' | 'wall'>>,
) => {
  const current = stateOf(visitId).shots.find(s => s.id === shotId);
  if (!current) return;
  const shot = patchShot(visitId, shotId, { ...change, dirty: current.status === 'sent' });
  if (shot) saveShotLocally(shot);
  kick();
};

/** Move a shot and everything taken after it in that room to another room */
export const moveShotsFrom = (visitId: string, fromRoomId: string, fromShot: LocalShot, toRoomId: string) => {
  stateOf(visitId).shots
    .filter(shot => shot.roomId === fromRoomId && timeOf(shot) >= timeOf(fromShot))
    .forEach(shot => updateShot(visitId, shot.id, { roomId: toRoomId }));
};

export const deleteShot = (visitId: string, shotId: string) => {
  const state = stateOf(visitId);
  const shot = state.shots.find(s => s.id === shotId);
  if (!shot) return;
  if (shot.status === 'sent' || shot.status === 'sending') {
    const next = patchShot(visitId, shotId, { deleted: true });
    if (next) saveShotLocally(next);
    kick();
    return;
  }
  update(visitId, { shots: state.shots.filter(s => s.id !== shotId) });
  forgetShotLocally(shotId);
};

export const retryShot = (visitId: string, shotId: string) => {
  const shot = patchShot(visitId, shotId, { status: 'queued', error: undefined });
  if (shot) saveShotLocally(shot);
  holdUntil = 0;
  kick();
};

// ── Sending ─────────────────────────────────────────

let active = 0;
let holdUntil = 0;
let holdMs = 0;
let holdTimer: ReturnType<typeof setTimeout> | undefined;
let watching = false;
const inFlight = new Set<string>();

const hold = (ms?: number) => {
  holdMs = ms ?? Math.min(MAX_HOLD_MS, holdMs ? holdMs * 2 : 3000);
  holdUntil = Date.now() + holdMs;
  if (holdTimer) clearTimeout(holdTimer);
  holdTimer = setTimeout(kick, holdMs);
};

const settled = () => {
  holdMs = 0;
};

const failure = (err: any): 'wait' | 'auth' | 'room' | 'refused' => {
  const status = err?.response?.status;
  if (!status || status === 408 || status === 429 || status >= 500) return 'wait';
  if (status === 401) return 'auth';
  if (status === 409) return 'room';
  return 'refused';
};

const errorText = (err: any) => err?.response?.data?.detail || 'Could not send';

const sendRoom = async (room: LocalRoom) => {
  const sentVersion = room;
  try {
    await fieldVisitService.saveRoom(room.visitId, room.id, {
      name: room.name,
      name_source: room.nameSource,
      floor: room.floor,
      floor_source: room.floorSource,
      room_type: room.roomType,
      position: room.position,
    });
    settled();
    // Changed while it was going out: it goes again
    const now = stateOf(room.visitId).rooms.find(r => r.id === room.id);
    if (now === sentVersion) {
      const saved = patchRoom(room.visitId, room.id, { dirty: false });
      if (saved) saveRoomLocally(saved);
    }
  } catch (err) {
    const kind = failure(err);
    if (kind === 'refused' || kind === 'room') {
      // Holding the queue up for it would help nothing: its shots report what's wrong
      const saved = patchRoom(room.visitId, room.id, { dirty: false });
      if (saved) saveRoomLocally(saved);
    } else {
      hold(kind === 'auth' ? MAX_HOLD_MS : undefined);
    }
  }
};

const sendShot = async (shot: LocalShot) => {
  if (!shot.blob) {
    patchShot(shot.visitId, shot.id, { status: 'failed', error: 'The file is gone from this phone' });
    return;
  }
  patchShot(shot.visitId, shot.id, { status: 'sending', progress: 0 });

  const form = new FormData();
  form.append('file', shot.blob, shot.name);
  form.append('shot_id', shot.id);
  form.append('room_id', shot.roomId);
  form.append('kind', shot.kind);
  if (shot.wall != null) form.append('wall', String(shot.wall));
  form.append('captured_at', shot.capturedAt);
  if (shot.moved) form.append('moved', 'true');
  if (shot.firstPhoto) form.append('first_photo', 'true');
  Object.entries(shot.readings).forEach(([key, value]) => {
    if (value != null) form.append(key, String(value));
  });

  try {
    let shown = 0;
    const sent = await fieldVisitService.uploadShot(shot.visitId, form, {
      video: shot.isVideo,
      onProgress: (percent) => {
        if (percent - shown < 5) return;
        shown = percent;
        patchShot(shot.visitId, shot.id, { progress: percent });
      },
    });
    settled();
    const latest = stateOf(shot.visitId).shots.find(s => s.id === shot.id);
    const done = patchShot(shot.visitId, shot.id, {
      status: 'sent',
      blob: undefined,
      progress: undefined,
      sentAt: Date.now(),
      fileId: sent.file_id,
      thumbnailUrl: sent.thumbnail_url,
      url: sent.url,
      isVideo: sent.is_video,
      // Moved to another room while it was on its way: that still has to go
      dirty: !!latest && latest.roomId !== shot.roomId,
    });
    if (done) saveShotLocally(done);
  } catch (err) {
    const kind = failure(err);
    if (kind === 'room') {
      // The server doesn't know its room yet: send that, then this again
      patchShot(shot.visitId, shot.id, { status: 'queued', progress: undefined });
      const room = patchRoom(shot.visitId, shot.roomId, { dirty: true });
      if (room) saveRoomLocally(room);
      hold();
    } else if (kind === 'refused') {
      const failed = patchShot(shot.visitId, shot.id, { status: 'failed', progress: undefined, error: errorText(err) });
      if (failed) saveShotLocally(failed);
    } else {
      patchShot(shot.visitId, shot.id, { status: 'queued', progress: undefined });
      hold(kind === 'auth' ? MAX_HOLD_MS : undefined);
    }
  }
};

const sendShotChange = async (shot: LocalShot) => {
  try {
    await fieldVisitService.updateShot(shot.visitId, shot.id, {
      room_id: shot.roomId,
      kind: shot.kind,
      wall: shot.wall,
    });
    settled();
    const now = stateOf(shot.visitId).shots.find(s => s.id === shot.id);
    if (now && now.roomId === shot.roomId && now.kind === shot.kind && now.wall === shot.wall) {
      const saved = patchShot(shot.visitId, shot.id, { dirty: false });
      if (saved) saveShotLocally(saved);
    }
  } catch (err) {
    const kind = failure(err);
    if (kind === 'room') {
      const room = patchRoom(shot.visitId, shot.roomId, { dirty: true });
      if (room) saveRoomLocally(room);
      hold();
    } else if (kind === 'refused') {
      const saved = patchShot(shot.visitId, shot.id, { dirty: false });
      if (saved) saveShotLocally(saved);
    } else {
      hold(kind === 'auth' ? MAX_HOLD_MS : undefined);
    }
  }
};

const sendShotDelete = async (shot: LocalShot) => {
  try {
    await fieldVisitService.deleteShot(shot.visitId, shot.id);
    settled();
    update(shot.visitId, { shots: stateOf(shot.visitId).shots.filter(s => s.id !== shot.id) });
    forgetShotLocally(shot.id);
  } catch (err) {
    const kind = failure(err);
    if (kind === 'refused') {
      update(shot.visitId, { shots: stateOf(shot.visitId).shots.filter(s => s.id !== shot.id) });
      forgetShotLocally(shot.id);
    } else {
      hold(kind === 'auth' ? MAX_HOLD_MS : undefined);
    }
  }
};

/** The next thing to send: rooms before the shots in them, then changes, then new shots in the order taken */
const nextJob = (): { key: string; run: () => Promise<void> } | null => {
  for (const state of states.values()) {
    const roomsWithShots = new Set(state.shots.filter(shot => !shot.deleted).map(shot => shot.roomId));
    for (const room of state.rooms) {
      const key = `room:${room.id}`;
      if (room.dirty && roomsWithShots.has(room.id) && !inFlight.has(key)) {
        return { key, run: () => sendRoom(room) };
      }
    }
    const unsavedRooms = new Set(state.rooms.filter(room => room.dirty).map(room => room.id));
    for (const shot of state.shots) {
      const key = `shot:${shot.id}`;
      if (inFlight.has(key)) continue;
      if (shot.deleted && shot.status === 'sent') return { key, run: () => sendShotDelete(shot) };
      if (shot.dirty && shot.status === 'sent' && !unsavedRooms.has(shot.roomId)) {
        return { key, run: () => sendShotChange(shot) };
      }
      if (shot.status === 'queued' && !shot.isVideo && !unsavedRooms.has(shot.roomId)) {
        return { key, run: () => sendShot(shot) };
      }
    }
  }
  // Clips after photos and one at a time: a long upload shouldn't hold up what was just shot
  const sendingClip = [...states.values()].some(state => state.shots.some(s => s.isVideo && s.status === 'sending'));
  if (sendingClip) return null;
  for (const state of states.values()) {
    const unsavedRooms = new Set(state.rooms.filter(room => room.dirty).map(room => room.id));
    const clip = state.shots.find(shot => (
      shot.status === 'queued' && shot.isVideo && !unsavedRooms.has(shot.roomId) && !inFlight.has(`shot:${shot.id}`)
    ));
    if (clip) return { key: `shot:${clip.id}`, run: () => sendShot(clip) };
  }
  return null;
};

const jobDone = (key: string) => {
  active -= 1;
  inFlight.delete(key);
  kick();
};

function kick() {
  watch();
  if (Date.now() < holdUntil) return;
  while (active < MAX_ACTIVE) {
    const job = nextJob();
    if (!job) return;
    active += 1;
    inFlight.add(job.key);
    job.run().finally(() => jobDone(job.key));
  }
}

function watch() {
  if (watching) return;
  watching = true;
  const wake = () => {
    holdUntil = 0;
    holdMs = 0;
    kick();
  };
  window.addEventListener('online', wake);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') wake();
  });
}

/** Carry on sending what an earlier page left behind, and clear out what's long sent */
export const resumeFieldUploads = async () => {
  try {
    const db = await getDb();
    if (!db) return;
    const shots: LocalShot[] = await db.getAll('shots');
    const cutoff = Date.now() - SENT_KEPT_MS;
    const waiting = new Set<string>();
    shots.forEach((shot) => {
      if (shot.status !== 'sent' || shot.dirty || shot.deleted) waiting.add(shot.visitId);
      else if ((shot.sentAt ?? 0) < cutoff && Date.parse(shot.capturedAt) < cutoff) db.delete('shots', shot.id);
    });
    await Promise.all([...waiting].map(loadVisit));
  } catch (err) {
    console.warn('[field-visit] Could not resume uploads:', err);
  }
};

// ── Reading it ──────────────────────────────────────

const blobUrls = new Map<string, string>();

const blobUrl = (key: string, blob: Blob) => {
  if (!blobUrls.has(key)) blobUrls.set(key, URL.createObjectURL(blob));
  return blobUrls.get(key) as string;
};

export const shotThumbUrl = (shot: LocalShot): string | undefined => {
  if (shot.thumb) return blobUrl(`thumb:${shot.id}`, shot.thumb);
  if (shot.thumbnailUrl) return apiUrl(shot.thumbnailUrl);
  return shot.blob && !shot.isVideo ? blobUrl(`full:${shot.id}`, shot.blob) : undefined;
};

export const shotFullUrl = (shot: LocalShot): string | undefined => {
  if (shot.blob) return blobUrl(`full:${shot.id}`, shot.blob);
  return shot.url ? apiUrl(shot.url) : shotThumbUrl(shot);
};

export const liveShots = (snapshot: VisitSnapshot) => snapshot.shots.filter(shot => !shot.deleted);

/** "All sent" has to mean it: a move or a delete still on its way counts as waiting too */
export const uploadCounts = (snapshot: VisitSnapshot) => ({
  waiting: snapshot.shots.filter(shot => (
    shot.status === 'queued' || shot.status === 'sending' || shot.dirty || shot.deleted
  )).length,
  failed: snapshot.shots.filter(shot => shot.status === 'failed' && !shot.deleted).length,
});

export const wallsDone = (shots: LocalShot[], roomId: string): number[] => [
  ...new Set(
    shots
      .filter(shot => shot.roomId === roomId && shot.kind === 'wall' && shot.wall != null)
      .map(shot => shot.wall as number),
  ),
];
