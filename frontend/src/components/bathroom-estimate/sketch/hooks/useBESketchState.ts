/**
 * useBESketchState - Bathroom Estimate Sketch state management hook
 *
 * Manages walls, rooms, fixtures, tile zones, damage zones,
 * tool selection, undo/redo, and canvas settings.
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import type {
  BESketchData,
  BESketchTool,
  BEWall,
  BERoom,
  BEFixture,
  BETileZone,
  BEDamageZone,
  BEPoint,
  BEFixtureType,
  BEFixtureProperties,
  BESketchSettings,
  BERoomType,
} from '../../../../types/bathroomSketch';
import {
  EMPTY_BE_SKETCH,
  BE_FIXTURE_DEFAULTS,
  BATHTUB_SURROUND_DEFAULTS,
  DEFAULT_TILE_SPEC,
  TILE_ZONE_COLORS,
} from '../../../../types/bathroomSketch';
import { generateTileZones } from '../utils/beTileZoneGenerator';
import { findClosedWallLoop } from '../utils/beWallLoop';

let _idCounter = 0;
function generateId(prefix: string): string {
  _idCounter += 1;
  return `${prefix}_${Date.now()}_${_idCounter}`;
}

// ── Pixels ↔ Inches conversion ──

function pxToInches(px: number, pixelsPerFoot: number): number {
  return (px / pixelsPerFoot) * 12;
}

function inchesToPx(inches: number, pixelsPerFoot: number): number {
  return (inches / 12) * pixelsPerFoot;
}

function calcDistance(a: BEPoint, b: BEPoint): number {
  return Math.sqrt((b.x - a.x) ** 2 + (b.y - a.y) ** 2);
}

/** Ray-casting point-in-polygon test */
function pointInPolygon(pt: BEPoint, poly: BEPoint[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x, yi = poly[i].y;
    const xj = poly[j].x, yj = poly[j].y;
    if ((yi > pt.y) !== (yj > pt.y) && pt.x < (xj - xi) * (pt.y - yi) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

/** Find parent room: the existing room whose boundary contains the centroid of the new room */
function findParentRoom(rooms: BERoom[], newBoundary: BEPoint[], excludeId?: string): string | undefined {
  const cx = newBoundary.reduce((s, p) => s + p.x, 0) / newBoundary.length;
  const cy = newBoundary.reduce((s, p) => s + p.y, 0) / newBoundary.length;
  const centroid = { x: cx, y: cy };
  for (const room of rooms) {
    if (room.id === excludeId) continue;
    if (pointInPolygon(centroid, room.boundary)) {
      return room.id;
    }
  }
  return undefined;
}

/** Recalculate netFloorAreaSF for all rooms (gross - sub-rooms) */
function recalcNetAreas(rooms: BERoom[]): BERoom[] {
  return rooms.map((room) => {
    const childArea = rooms
      .filter((r) => r.parentRoomId === room.id)
      .reduce((sum, r) => sum + r.floorAreaSF, 0);
    return { ...room, netFloorAreaSF: Math.round((room.floorAreaSF - childArea) * 100) / 100 };
  });
}

// ── Undo/Redo history ──

const MAX_HISTORY = 30;

interface HistoryState {
  past: BESketchData[];
  future: BESketchData[];
}

// ── Hook ──

export function useBESketchState(initialData?: BESketchData) {
  const [data, setData] = useState<BESketchData>(initialData ?? { ...EMPTY_BE_SKETCH });
  const [activeTool, setActiveTool] = useState<BESketchTool>('select');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [isDirty, setIsDirty] = useState(false);

  const historyRef = useRef<HistoryState>({ past: [], future: [] });

  // ── History helpers ──

  const pushHistory = useCallback((prev: BESketchData) => {
    const h = historyRef.current;
    h.past = [...h.past.slice(-(MAX_HISTORY - 1)), prev];
    h.future = [];
  }, []);

  const undo = useCallback(() => {
    const h = historyRef.current;
    if (h.past.length === 0) return;
    const prev = h.past[h.past.length - 1];
    setData((cur) => {
      h.future = [cur, ...h.future];
      h.past = h.past.slice(0, -1);
      return prev;
    });
  }, []);

  const redo = useCallback(() => {
    const h = historyRef.current;
    if (h.future.length === 0) return;
    const next = h.future[0];
    setData((cur) => {
      h.past = [...h.past, cur];
      h.future = h.future.slice(1);
      return next;
    });
  }, []);

  const canUndo = historyRef.current.past.length > 0;
  const canRedo = historyRef.current.future.length > 0;

  // ── Mutate helper (records undo) ──

  const mutate = useCallback(
    (updater: (draft: BESketchData) => BESketchData) => {
      setData((prev) => {
        pushHistory(prev);
        setIsDirty(true);
        return updater(prev);
      });
    },
    [pushHistory],
  );

  // ── Wall CRUD ──

  const addWall = useCallback(
    (start: BEPoint, end: BEPoint) => {
      const wall: BEWall = {
        id: generateId('wall'),
        start,
        end,
        thickness: 4,
        heightInches: 96,
      };
      mutate((d) => {
        const newWalls = [...d.walls, wall];
        // Auto-detect closed loop → create Room
        const loop = findClosedWallLoop(newWalls);
        if (loop && loop.boundary.length >= 3) {
          // Check if a room with these walls already exists
          const existingWallIds = new Set(d.rooms.flatMap((r) => r.wallIds));
          const alreadyUsed = loop.wallIds.some((id) => existingWallIds.has(id));
          if (!alreadyUsed) {
            const ppf = d.settings.pixelsPerFoot;
            let perimeterPx = 0;
            for (let i = 0; i < loop.boundary.length; i++) {
              const next = loop.boundary[(i + 1) % loop.boundary.length];
              perimeterPx += calcDistance(loop.boundary[i], next);
            }
            let areaPx2 = 0;
            for (let i = 0; i < loop.boundary.length; i++) {
              const j = (i + 1) % loop.boundary.length;
              areaPx2 += loop.boundary[i].x * loop.boundary[j].y;
              areaPx2 -= loop.boundary[j].x * loop.boundary[i].y;
            }
            areaPx2 = Math.abs(areaPx2) / 2;
            const floorAreaSF = areaPx2 / (ppf * ppf);
            const perimeterLF = pxToInches(perimeterPx, ppf) / 12;
            const wallAreaSF = (perimeterLF * 96) / 144;

            const parentRoomId = findParentRoom(d.rooms, loop.boundary);
            const room: BERoom = {
              id: generateId('room'),
              name: parentRoomId ? 'Closet' : 'Bathroom',
              roomType: parentRoomId ? 'closet' : 'bathroom',
              boundary: loop.boundary,
              wallIds: loop.wallIds,
              parentRoomId,
              heightInches: 96,
              floorAreaSF: Math.round(floorAreaSF * 100) / 100,
              netFloorAreaSF: Math.round(floorAreaSF * 100) / 100,
              wallAreaSF: Math.round(wallAreaSF * 100) / 100,
              perimeterLF: Math.round(perimeterLF * 100) / 100,
            };
            const newRooms = recalcNetAreas([...d.rooms, room]);
            return { ...d, walls: newWalls, rooms: newRooms };
          }
        }
        return { ...d, walls: newWalls };
      });
      return wall.id;
    },
    [mutate],
  );

  const updateWall = useCallback(
    (id: string, updates: Partial<BEWall>) => {
      mutate((d) => ({
        ...d,
        walls: d.walls.map((w) => (w.id === id ? { ...w, ...updates } : w)),
      }));
    },
    [mutate],
  );

  const removeWall = useCallback(
    (id: string) => {
      mutate((d) => ({ ...d, walls: d.walls.filter((w) => w.id !== id) }));
      if (selectedId === id) setSelectedId(null);
    },
    [mutate, selectedId],
  );

  // ── Room CRUD ──

  const addRoom = useCallback(
    (boundary: BEPoint[], wallIds: string[], name?: string, roomType?: BERoomType) => {
      const ppf = data.settings.pixelsPerFoot;
      let perimeterPx = 0;
      for (let i = 0; i < boundary.length; i++) {
        const next = boundary[(i + 1) % boundary.length];
        perimeterPx += calcDistance(boundary[i], next);
      }
      let areaPx2 = 0;
      for (let i = 0; i < boundary.length; i++) {
        const j = (i + 1) % boundary.length;
        areaPx2 += boundary[i].x * boundary[j].y;
        areaPx2 -= boundary[j].x * boundary[i].y;
      }
      areaPx2 = Math.abs(areaPx2) / 2;

      const floorAreaSF = areaPx2 / (ppf * ppf);
      const perimeterLF = pxToInches(perimeterPx, ppf) / 12;
      const heightInches = 96;
      const wallAreaSF = (perimeterLF * heightInches) / 144;

      mutate((d) => {
        // Auto-detect parent room
        const parentRoomId = findParentRoom(d.rooms, boundary);
        const isSubRoom = !!parentRoomId;
        const defaultType: BERoomType = isSubRoom ? 'closet' : 'bathroom';
        const defaultName = isSubRoom
          ? (roomType === 'toilet_room' ? 'Toilet Room' : roomType === 'linen_closet' ? 'Linen Closet' : 'Closet')
          : 'Bathroom';

        const room: BERoom = {
          id: generateId('room'),
          name: name ?? defaultName,
          roomType: roomType ?? defaultType,
          boundary,
          wallIds,
          parentRoomId,
          heightInches,
          floorAreaSF: Math.round(floorAreaSF * 100) / 100,
          netFloorAreaSF: Math.round(floorAreaSF * 100) / 100,
          wallAreaSF: Math.round(wallAreaSF * 100) / 100,
          perimeterLF: Math.round(perimeterLF * 100) / 100,
        };
        const newRooms = recalcNetAreas([...d.rooms, room]);
        return { ...d, rooms: newRooms };
      });
      return generateId('room'); // Note: actual ID created inside mutate
    },
    [mutate, data.settings.pixelsPerFoot],
  );

  const updateRoom = useCallback(
    (id: string, boundary: BEPoint[]) => {
      const ppf = data.settings.pixelsPerFoot;
      let perimeterPx = 0;
      for (let i = 0; i < boundary.length; i++) {
        const next = boundary[(i + 1) % boundary.length];
        perimeterPx += calcDistance(boundary[i], next);
      }
      let areaPx2 = 0;
      for (let i = 0; i < boundary.length; i++) {
        const j = (i + 1) % boundary.length;
        areaPx2 += boundary[i].x * boundary[j].y;
        areaPx2 -= boundary[j].x * boundary[i].y;
      }
      areaPx2 = Math.abs(areaPx2) / 2;

      const floorAreaSF = areaPx2 / (ppf * ppf);
      const perimeterLF = pxToInches(perimeterPx, ppf) / 12;
      const heightInches = 96;
      const wallAreaSF = (perimeterLF * heightInches) / 144;

      mutate((d) => {
        const updated = d.rooms.map((r) =>
          r.id === id
            ? {
                ...r,
                boundary,
                floorAreaSF: Math.round(floorAreaSF * 100) / 100,
                netFloorAreaSF: Math.round(floorAreaSF * 100) / 100,
                wallAreaSF: Math.round(wallAreaSF * 100) / 100,
                perimeterLF: Math.round(perimeterLF * 100) / 100,
              }
            : r,
        );
        return { ...d, rooms: recalcNetAreas(updated) };
      });
    },
    [mutate, data.settings.pixelsPerFoot],
  );

  const updateRoomMeta = useCallback(
    (id: string, updates: Partial<Pick<BERoom, 'name' | 'roomType' | 'heightInches'>>) => {
      mutate((d) => ({
        ...d,
        rooms: d.rooms.map((r) => (r.id === id ? { ...r, ...updates } : r)),
      }));
    },
    [mutate],
  );

  const removeRoom = useCallback(
    (id: string) => {
      mutate((d) => {
        const filtered = d.rooms.filter((r) => r.id !== id);
        // Re-parent children: clear parentRoomId for any child rooms
        const updated = filtered.map((r) => r.parentRoomId === id ? { ...r, parentRoomId: undefined } : r);
        return { ...d, rooms: recalcNetAreas(updated), fixtures: d.fixtures.filter((f) => f.roomId !== id) };
      });
      if (selectedId === id) setSelectedId(null);
    },
    [mutate, selectedId],
  );

  // ── Fixture CRUD ──

  const addFixture = useCallback(
    (
      type: BEFixtureType,
      position: BEPoint,
      roomId?: string,
      wallId?: string,
      properties?: Partial<BEFixtureProperties>,
    ) => {
      const defaults = BE_FIXTURE_DEFAULTS[type];
      const fixture: BEFixture = {
        id: generateId('fix'),
        type,
        position,
        dimensions: { ...defaults },
        rotation: 0,
        roomId,
        wallId,
        properties: properties ?? {},
      };

      // Apply bathtub subtype defaults (surround OFF unless explicitly enabled)
      if (type === 'bathtub' && properties?.bathtubSubType) {
        const sd = BATHTUB_SURROUND_DEFAULTS[properties.bathtubSubType];
        fixture.properties = {
          ...fixture.properties,
          // Only set hasSurround if explicitly passed; default to false
          hasSurround: properties.hasSurround ?? false,
          surroundWallCount: sd.surroundWallCount,
          surroundHeight: sd.surroundHeight,
          deckWidth: sd.deckWidth,
          deckHeight: sd.deckHeight,
        };
      }

      mutate((d) => ({ ...d, fixtures: [...d.fixtures, fixture] }));
      return fixture.id;
    },
    [mutate],
  );

  const updateFixture = useCallback(
    (id: string, updates: Partial<BEFixture>) => {
      mutate((d) => ({
        ...d,
        fixtures: d.fixtures.map((f) => (f.id === id ? { ...f, ...updates } : f)),
      }));
    },
    [mutate],
  );

  const updateFixtureProperties = useCallback(
    (id: string, propUpdates: Partial<BEFixtureProperties>) => {
      mutate((d) => ({
        ...d,
        fixtures: d.fixtures.map((f) =>
          f.id === id ? { ...f, properties: { ...f.properties, ...propUpdates } } : f,
        ),
      }));
    },
    [mutate],
  );

  const removeFixture = useCallback(
    (id: string) => {
      mutate((d) => ({
        ...d,
        fixtures: d.fixtures.filter((f) => f.id !== id),
        tileZones: d.tileZones.filter((z) => z.fixtureId !== id),
      }));
      if (selectedId === id) setSelectedId(null);
    },
    [mutate, selectedId],
  );

  // ── Tile Zone management ──

  const updateTileZone = useCallback(
    (id: string, updates: Partial<BETileZone>) => {
      mutate((d) => ({
        ...d,
        tileZones: d.tileZones.map((z) => (z.id === id ? { ...z, ...updates } : z)),
      }));
    },
    [mutate],
  );

  // ── Damage Zone CRUD ──

  const addDamageZone = useCallback(
    (boundary: BEPoint[], damageType: BEDamageZone['damageType']) => {
      const ppf = data.settings.pixelsPerFoot;
      let areaPx2 = 0;
      for (let i = 0; i < boundary.length; i++) {
        const j = (i + 1) % boundary.length;
        areaPx2 += boundary[i].x * boundary[j].y;
        areaPx2 -= boundary[j].x * boundary[i].y;
      }
      areaPx2 = Math.abs(areaPx2) / 2;

      const zone: BEDamageZone = {
        id: generateId('dmg'),
        boundary,
        areaSF: Math.round((areaPx2 / (ppf * ppf)) * 100) / 100,
        damageType,
        needsDemo: true,
        needsReplace: true,
      };
      mutate((d) => ({ ...d, damageZones: [...d.damageZones, zone] }));
      return zone.id;
    },
    [mutate, data.settings.pixelsPerFoot],
  );

  const removeDamageZone = useCallback(
    (id: string) => {
      mutate((d) => ({ ...d, damageZones: d.damageZones.filter((z) => z.id !== id) }));
      if (selectedId === id) setSelectedId(null);
    },
    [mutate, selectedId],
  );

  // ── Settings ──

  const updateSettings = useCallback(
    (updates: Partial<BESketchSettings>) => {
      mutate((d) => ({ ...d, settings: { ...d.settings, ...updates } }));
    },
    [mutate],
  );

  // ── Reset ──

  const resetSketch = useCallback(() => {
    pushHistory(data);
    setData({ ...EMPTY_BE_SKETCH });
    setSelectedId(null);
    setIsDirty(true);
  }, [data, pushHistory]);

  // ── Load external data ──

  const loadSketch = useCallback((newData: BESketchData) => {
    historyRef.current = { past: [], future: [] };
    setData(newData);
    setSelectedId(null);
    setIsDirty(false);
  }, []);

  // ── Auto-regenerate tile zones when fixtures or rooms change ──
  const fixtureSignature = JSON.stringify(data.fixtures.map((f) => ({
    id: f.id, type: f.type, pos: f.position, dim: f.dimensions, props: f.properties,
  })));
  const roomSignature = JSON.stringify(data.rooms.map((r) => ({ id: r.id, boundary: r.boundary, area: r.floorAreaSF })));

  useEffect(() => {
    const newZones = generateTileZones(data.fixtures, data.rooms, data.settings.pixelsPerFoot);
    setData((prev) => ({ ...prev, tileZones: newZones }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fixtureSignature, roomSignature, data.settings.pixelsPerFoot]);

  return {
    // Data
    data,
    isDirty,
    setIsDirty,

    // Tool state
    activeTool,
    setActiveTool,
    selectedId,
    setSelectedId,

    // Wall ops
    addWall,
    updateWall,
    removeWall,

    // Room ops
    addRoom,
    updateRoom,
    updateRoomMeta,
    removeRoom,

    // Fixture ops
    addFixture,
    updateFixture,
    updateFixtureProperties,
    removeFixture,

    // Tile zone ops
    updateTileZone,

    // Damage zone ops
    addDamageZone,
    removeDamageZone,

    // Settings
    updateSettings,

    // History
    undo,
    redo,
    canUndo,
    canRedo,

    // Lifecycle
    resetSketch,
    loadSketch,

    // Utility
    pxToInches: (px: number) => pxToInches(px, data.settings.pixelsPerFoot),
    inchesToPx: (inches: number) => inchesToPx(inches, data.settings.pixelsPerFoot),
  };
}

export type BESketchStateAPI = ReturnType<typeof useBESketchState>;
