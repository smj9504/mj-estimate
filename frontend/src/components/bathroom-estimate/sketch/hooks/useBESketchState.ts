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
} from '../../../../types/bathroomSketch';
import {
  EMPTY_BE_SKETCH,
  BE_FIXTURE_DEFAULTS,
  BATHTUB_SURROUND_DEFAULTS,
  DEFAULT_TILE_SPEC,
  TILE_ZONE_COLORS,
} from '../../../../types/bathroomSketch';
import { generateTileZones } from '../utils/beTileZoneGenerator';

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
        heightInches: data.settings.pixelsPerFoot > 0 ? 96 : 96,
      };
      mutate((d) => ({ ...d, walls: [...d.walls, wall] }));
      return wall.id;
    },
    [mutate, data.settings.pixelsPerFoot],
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
    (boundary: BEPoint[], wallIds: string[], name?: string) => {
      const ppf = data.settings.pixelsPerFoot;
      // Calculate perimeter
      let perimeterPx = 0;
      for (let i = 0; i < boundary.length; i++) {
        const next = boundary[(i + 1) % boundary.length];
        perimeterPx += calcDistance(boundary[i], next);
      }
      // Calculate area (Shoelace formula)
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

      const room: BERoom = {
        id: generateId('room'),
        name: name ?? 'Bathroom',
        boundary,
        wallIds,
        heightInches,
        floorAreaSF: Math.round(floorAreaSF * 100) / 100,
        wallAreaSF: Math.round(wallAreaSF * 100) / 100,
        perimeterLF: Math.round(perimeterLF * 100) / 100,
      };
      mutate((d) => ({ ...d, rooms: [...d.rooms, room] }));
      return room.id;
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

      mutate((d) => ({
        ...d,
        rooms: d.rooms.map((r) =>
          r.id === id
            ? {
                ...r,
                boundary,
                floorAreaSF: Math.round(floorAreaSF * 100) / 100,
                wallAreaSF: Math.round(wallAreaSF * 100) / 100,
                perimeterLF: Math.round(perimeterLF * 100) / 100,
              }
            : r,
        ),
      }));
    },
    [mutate, data.settings.pixelsPerFoot],
  );

  const removeRoom = useCallback(
    (id: string) => {
      mutate((d) => ({
        ...d,
        rooms: d.rooms.filter((r) => r.id !== id),
        fixtures: d.fixtures.filter((f) => f.roomId !== id),
      }));
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
    setData((prev) => {
      // Only update if zones actually changed
      if (JSON.stringify(prev.tileZones.map((z) => z.areaSF)) === JSON.stringify(newZones.map((z) => z.areaSF))
          && prev.tileZones.length === newZones.length) {
        return prev;
      }
      return { ...prev, tileZones: newZones };
    });
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
