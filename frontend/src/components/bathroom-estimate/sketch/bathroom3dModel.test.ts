import { describe, it, expect } from 'vitest';
import type { BEFixture, BESketchData, BEWall } from '../../../types/bathroomSketch';
import { DEFAULT_BE_SKETCH_SETTINGS } from '../../../types/bathroomSketch';
import { bathroomLooks, bathroomModel, DEFAULT_LOOKS, parseTileSize, tileLook } from './bathroom3dModel';

// 40 px to the foot: an 8 ft × 5 ft bath drawn from (0,0) to (320,200)
const wall = (id: string, x0: number, y0: number, x1: number, y1: number, extra: Partial<BEWall> = {}): BEWall => ({
  id, start: { x: x0, y: y0 }, end: { x: x1, y: y1 }, thickness: 6, heightInches: 96, ...extra,
});
const fixture = (id: string, type: BEFixture['type'], x: number, y: number, w: number, h: number, properties: BEFixture['properties'] = {}): BEFixture => ({
  id, type, position: { x, y }, dimensions: { width: w, height: h }, rotation: 0, roomId: 'r', properties,
});
const sketch = (walls: BEWall[], fixtures: BEFixture[] = []): BESketchData => ({
  version: '1.0.0',
  walls,
  rooms: [{
    id: 'r', name: 'Bath', roomType: 'bathroom',
    boundary: [{ x: 0, y: 0 }, { x: 320, y: 0 }, { x: 320, y: 200 }, { x: 0, y: 200 }],
    wallIds: walls.map((w) => w.id), heightInches: 96, floorAreaSF: 40, netFloorAreaSF: 40, wallAreaSF: 0, perimeterLF: 26,
  }],
  fixtures,
  tileZones: [],
  damageZones: [],
  drywallRepairZones: [],
  insulationZones: [],
  settings: { ...DEFAULT_BE_SKETCH_SETTINGS, pixelsPerFoot: 40 },
});
const north = (extra: Partial<BEWall> = {}) => wall('north', 0, 0, 320, 0, extra);
const south = wall('south', 0, 200, 320, 200);
const west = wall('west', 0, 200, 0, 0);
// A 60" × 32" tub in the north-west corner
const tub = fixture('tub', 'bathtub', 100, 160 / 3, 60, 32, { bathtubSubType: 'standard_alcove', hasSurround: true, surroundHeight: 60 });
// A door as the plan places it: its symbol in the room, its closed panel on the south wall
const door = fixture('door', 'door', 160, 200 - 160 / 3, 32, 32);

describe('a shower room in 3D', () => {
  it('cuts an opening with no door in its wall, and hangs the shower door in it', () => {
    // A 36" shower in the north-west corner, its front on a wall 36" out with a 24" opening (no slab) in it
    const front = wall('front', 0, 120, 120, 120);
    const shower = fixture('shower', 'shower', 60, 60, 36, 36, { showerLayout: 'alcove', showerDoorType: 'swing' });
    const opening = fixture('opening', 'door', 60, 80, 24, 24, { noSlab: true });
    const model = bathroomModel(sketch([north(), front], [shower, opening]));
    const cut = model.walls.find((w) => w.id === 'front')!.openings;
    expect(cut).toMatchObject([{ kind: 'door', noSlab: true, rect: { x0: 6, x1: 30 } }]);
    const solid = model.fixtures.find((f) => f.fixture.id === 'shower')!;
    expect(solid.showerOpening![0]).toBeCloseTo(6 / 36);
    expect(solid.showerOpening![1]).toBeCloseTo(30 / 36);
    // With no wall at its front, it's an open-front shower
    expect(bathroomModel(sketch([north()], [shower])).fixtures[0].showerOpening).toBeNull();
  });

  it("stands against the shower room's walls whichever room it's filed under, and tiles none in front of it", () => {
    // The shower room's own walls round a 36" shower filed under the bathroom (its roomId), tiled floor to ceiling
    const tiled = { tileRegions: [{ id: 't', startIn: 0, endIn: 999, bottomIn: 0, topIn: 96 }] };
    const walls = [north(tiled), wall('w2', 0, 0, 0, 120, tiled), wall('e2', 120, 0, 120, 120, tiled), wall('front', 0, 120, 120, 120)];
    const shower = { ...fixture('shower', 'shower', 60, 60, 36, 36, { showerLayout: 'alcove', showerTileHeight: 84 }), roomId: 'r' };
    const model = bathroomModel(sketch(walls, [shower]));
    // It needs no walls of its own in front of the room's (they'd hide the room's tile)
    expect(model.fixtures[0].against).toMatchObject({ north: true, east: true, west: true });
    // The tiled walls show their tile; the wall at its open front gets none of the shower's
    expect(model.walls.find((w) => w.id === 'w2')!.tile).toEqual([{ x0: 0, x1: 36, y0: 0, y1: 96 }]);
    expect(model.walls.find((w) => w.id === 'front')!.surrounds).toEqual([]);
  });

  describe('its front met to the wall it stands against', () => {
    // A 36" shower against the top; its front wall's line 36" + gap down, a 24" opening in it
    const room = (frontY: number, extra: Partial<BEFixture['properties']> = {}, rotation = 0) => {
      const front = wall('front', 0, frontY, 120, frontY);
      const shower = { ...fixture('shower', 'shower', 60, 60, 36, 36, { showerLayout: 'alcove', showerDoorType: 'swing', ...extra }), rotation };
      // A door's opening is its symbol's edge on the wall (40 px from its middle)
      const opening = fixture('opening', 'door', 60, frontY - 40, 24, 24, { noSlab: true });
      return { front, shower, opening };
    };
    const solid = (s: BESketchData) => bathroomModel(s).fixtures.find((f) => f.fixture.id === 'shower')!;

    it('runs a shower drawn short of the wall up to it, its back where it was', () => {
      // 3" short of the wall's line (10 px); the room's on the shower's side, so its face is the line
      const { front, shower, opening } = room(130);
      const f = solid(sketch([north(), front], [shower, opening]));
      expect(f.depthIn).toBeCloseTo(39);
      expect(f.center[1]).toBeCloseTo(18 + 1.5);
      expect(f.center[1] - f.depthIn / 2).toBeCloseTo(0);
    });

    it("stops one at the wall's framing when the wall's room is the bathroom beyond", () => {
      const { front, shower, opening } = room(120);
      const s = sketch([north(), front], [shower, opening]);
      s.rooms = [{ ...s.rooms[0], boundary: [{ x: 0, y: 120 }, { x: 320, y: 120 }, { x: 320, y: 300 }, { x: 0, y: 300 }] }];
      const f = solid(s);
      // The framing (4.5") stands on the shower's side of the line
      expect(f.depthIn).toBeCloseTo(36 - 4.5);
      expect(f.center[1] - f.depthIn / 2).toBeCloseTo(0);
    });

    it('meets it whichever way the shower is turned', () => {
      // Turned round: its front faces the top wall, 2" off it; its back on a wall 36" down
      const shower = { ...fixture('shower', 'shower', 60, 60 + 20 / 3, 36, 36, { showerLayout: 'alcove', showerDoorType: 'swing' }), rotation: 180 };
      const opening = { ...fixture('opening', 'door', 60, 40, 24, 24, { noSlab: true }), rotation: 180 };
      const s = sketch([north(), wall('back', 0, 120 + 20 / 3, 120, 120 + 20 / 3)], [shower, opening]);
      const f = solid(s);
      expect(f.showerOpening).not.toBeNull();
      expect(f.depthIn).toBeCloseTo(38);
      expect(f.center[1] + f.depthIn / 2).toBeCloseTo(18 + 2 + 18);
    });

    it('leaves an open-front shower, or one far off the wall, as placed', () => {
      const { shower } = room(130);
      expect(solid(sketch([north()], [shower])).depthIn).toBe(36);
      const far = room(200);
      expect(solid(sketch([north(), far.front], [far.shower, far.opening])).depthIn).toBe(36);
    });
  });

  describe('with its front tiled too (4 tiled walls)', () => {
    const front = wall('front', 0, 120, 120, 120);
    const shower = fixture('shower', 'shower', 60, 60, 36, 36, { showerLayout: 'alcove', showerDoorType: 'swing', showerWallCount: 4, showerTileHeight: 84 });
    const opening = fixture('opening', 'door', 60, 80, 24, 24, { noSlab: true });
    // Beside the 24" opening (6" to 30"), and over it up to the tile
    const besideAndOver = [
      { x0: 0, x1: 6, y0: 0, y1: 84 },
      { x0: 6, x1: 30, y0: 80, y1: 84 },
      { x0: 30, x1: 36, y0: 0, y1: 84 },
    ];

    it("tiles the wall's face the shower is on, and round the opening, not cased", () => {
      // The room's middle is on the shower's side of the front wall: that's its room face
      const model = bathroomModel(sketch([north(), front], [shower, opening]));
      const f = model.walls.find((w) => w.id === 'front')!;
      expect(f.surrounds).toEqual(besideAndOver.map((rect) => ({ rect, finish: 'tile', fixtureId: 'shower' })));
      expect(f.backSurrounds).toEqual([]);
      expect(f.openings[0].tiledRound).toBe(true);
    });

    it("tiles the wall's other face when its room is the bathroom beyond", () => {
      const s = sketch([north(), front], [shower, opening]);
      s.rooms = [{ ...s.rooms[0], boundary: [{ x: 0, y: 120 }, { x: 320, y: 120 }, { x: 320, y: 300 }, { x: 0, y: 300 }] }];
      const f = bathroomModel(s).walls.find((w) => w.id === 'front')!;
      expect(f.surrounds).toEqual([]);
      expect(f.backSurrounds).toEqual(besideAndOver.map((rect) => ({ rect, finish: 'tile', fixtureId: 'shower' })));
    });

    it('leaves the front and its opening alone with 3', () => {
      const three = { ...shower, properties: { ...shower.properties, showerWallCount: 3 } };
      const f = bathroomModel(sketch([north(), front], [three, opening])).walls.find((w) => w.id === 'front')!;
      expect(f.surrounds).toEqual([]);
      expect(f.backSurrounds).toEqual([]);
      expect(f.openings[0].tiledRound).toBeUndefined();
    });
  });
});

describe('bathroomModel walls', () => {
  it('stands each wall on its plan line in inches, its room on the inward side', () => {
    const model = bathroomModel(sketch([north(), south]));
    const n = model.walls.find((w) => w.id === 'north')!;
    expect(n.a).toEqual([0, 0]);
    expect(n.b).toEqual([96, 0]);
    expect(n.inward).toEqual([-0, 1]);
    expect(n.thicknessIn).toBe(4.5);
    expect(n.pieces).toEqual([{ x0: 0, x1: 96, y0: 0, y1: 96 }]);
    expect(model.walls.find((w) => w.id === 'south')!.inward).toEqual([0, -1]);
  });

  it('cuts a door opening out of its wall, hinged and swinging as the plan draws it', () => {
    const s = bathroomModel(sketch([south], [door])).walls[0];
    expect(s.openings).toEqual([{ rect: { x0: 32, x1: 64, y0: 0, y1: 80 }, kind: 'door', fixtureId: 'door', hingeAtStart: true, swingsIn: true }]);
    expect(s.pieces).toEqual([
      { x0: 0, x1: 32, y0: 0, y1: 96 },
      { x0: 32, x1: 64, y0: 80, y1: 96 },
      { x0: 64, x1: 96, y0: 0, y1: 96 },
    ]);
  });

  it('puts the tile to install on the wall, leaving the tub surround to the tub', () => {
    const tiled = north({
      tileRegions: [{ id: 'w', startIn: 0, endIn: 96, bottomIn: 0, topIn: 48 }],
      existingTileRegions: [{ id: 'e', startIn: 0, endIn: 96, bottomIn: 0, topIn: 96 }],
    });
    const n = bathroomModel(sketch([tiled, west], [tub])).walls.find((w) => w.id === 'north')!;
    expect(n.surrounds).toEqual([{ rect: { x0: 0, x1: 60, y0: 0, y1: 75 }, finish: 'tile', fixtureId: 'tub' }]);
    expect(n.tile).toEqual([{ x0: 60, x1: 96, y0: 0, y1: 48 }]);

    // As it is today: the existing tile, full height
    const today = bathroomModel(sketch([tiled, west], [tub]), null, 'today').walls.find((w) => w.id === 'north')!;
    expect(today.tile).toEqual([{ x0: 0, x1: 60, y0: 75, y1: 96 }, { x0: 60, x1: 96, y0: 0, y1: 96 }]);
  });

  it('tiles a wall floor to ceiling as one, over the tub surround, after the work only', () => {
    const tiled = north({
      tileRegions: [{ id: 'w', startIn: 0, endIn: 96, bottomIn: 0, topIn: 96 }],
      existingTileRegions: [{ id: 'e', startIn: 0, endIn: 96, bottomIn: 0, topIn: 96 }],
    });
    const n = bathroomModel(sketch([tiled, west], [tub])).walls.find((w) => w.id === 'north')!;
    expect(n.surrounds).toEqual([]);
    expect(n.tile).toEqual([{ x0: 0, x1: 96, y0: 0, y1: 96 }]);
    // The west wall isn't tiled: the tub keeps its own surround there
    expect(bathroomModel(sketch([tiled, west], [tub])).walls.find((w) => w.id === 'west')!.surrounds)
      .toMatchObject([{ finish: 'tile', fixtureId: 'tub' }]);

    const today = bathroomModel(sketch([tiled, west], [tub]), null, 'today').walls.find((w) => w.id === 'north')!;
    expect(today.surrounds).toEqual([{ rect: { x0: 0, x1: 60, y0: 0, y1: 75 }, finish: 'tile', fixtureId: 'tub' }]);
  });

  it('gives a prefab shower its own surround, not tile', () => {
    const shower = fixture('sh', 'shower', 40, 40, 24, 24, { showerWallMaterial: 'prefab_acrylic' });
    const n = bathroomModel(sketch([north()], [shower])).walls[0];
    expect(n.surrounds).toMatchObject([{ finish: 'prefab', fixtureId: 'sh' }]);
  });
});

describe('bathroomModel fixtures', () => {
  it('places fixtures in inches with the walls they stand against, and leaves doors to their walls', () => {
    const model = bathroomModel(sketch([north(), west, south], [tub, door]));
    expect(model.fixtures).toHaveLength(1);
    const t = model.fixtures[0];
    expect(t.center[0]).toBe(30);
    expect(t.center[1]).toBeCloseTo(16);
    expect([t.widthIn, t.depthIn]).toEqual([60, 32]);
    expect(t.against).toMatchObject({ north: true, west: true, east: false, south: false });
    expect(model.bounds).toMatchObject({ minX: 0, maxX: 96, minZ: 0, maxZ: 60 });
    expect(model.floors).toEqual([[[0, 0], [96, 0], [96, 60], [0, 60]]]);
  });
});

describe('looks', () => {
  it('reads tile sizes long side first, subway as a running bond', () => {
    expect(parseTileSize('12x24')).toEqual({ widthIn: 24, heightIn: 12, subway: false });
    expect(parseTileSize('3x6_subway')).toEqual({ widthIn: 6, heightIn: 3, subway: true });
    expect(parseTileSize('custom', 8, 32)).toEqual({ widthIn: 32, heightIn: 8, subway: false });
    expect(parseTileSize(undefined)).toBeNull();
    expect(tileLook({ material: 'ceramic', size: '4x12_subway', pattern: 'straight' }, DEFAULT_LOOKS.wallTile))
      .toMatchObject({ widthIn: 12, heightIn: 4, pattern: 'subway', material: 'ceramic' });
    expect(tileLook({ size: '12x12', pattern: 'herringbone' }, DEFAULT_LOOKS.floor!))
      .toMatchObject({ widthIn: 12, heightIn: 12, pattern: 'herringbone', material: 'porcelain' });
  });

  it('takes the floor, wall tile, top and metal from the estimate', () => {
    const s = sketch([north()]);
    const looks = bathroomLooks(s, {
      floor_spec: { material: 'natural_stone', size: '18x18', pattern: 'diagonal' },
      walls_spec: { tile_material: 'porcelain', tile_size: '12x24' },
      vanity_spec: { items: [{ top_material: 'granite' }] },
      accessories_spec: { finish: 'matte_black' },
    });
    expect(looks.floor).toMatchObject({ material: 'natural_stone', widthIn: 18, pattern: 'diagonal' });
    expect(looks.wallTile).toMatchObject({ material: 'porcelain', widthIn: 24, heightIn: 12 });
    expect(looks.vanityTop).toBe('#77736b');
    expect(looks.metal).toBe('#2a2a2a');
    // Plank flooring is laid staggered; a floor that isn't tile is drawn plain
    expect(bathroomLooks(s, { floor_spec: { material: 'lvt_spc' } }).floor).toMatchObject({ pattern: 'subway', widthIn: 48 });
    expect(bathroomLooks(s, { floor_spec: { material: 'carpet' } }).floor).toBeNull();
  });

  it('stands a tub glass panel kept or new, at the size the estimate prices', () => {
    const s = sketch([north()]);
    expect(bathroomLooks(s, {}).tubGlassPanel).toBeNull();
    expect(bathroomLooks(s, { bathtub_spec: { glass_panel_action: 'none', glass_panel_width_in: 30 } }).tubGlassPanel).toBeNull();
    expect(bathroomLooks(s, { bathtub_spec: { glass_panel_action: 'detach_reset' } }).tubGlassPanel)
      .toEqual({ widthIn: 30, heightIn: 58 });
    expect(bathroomLooks(s, { bathtub_spec: { glass_panel_action: 'replace', glass_panel_width_in: 34, glass_panel_height_in: 56 } }).tubGlassPanel)
      .toEqual({ widthIn: 34, heightIn: 56 });
  });

  it('hangs tub sliding doors kept or new; a framed set is drawn at the usual height', () => {
    const s = sketch([north()]);
    expect(bathroomLooks(s, {}).tubGlassDoors).toBeNull();
    expect(bathroomLooks(s, { bathtub_spec: { glass_door_action: 'none' } }).tubGlassDoors).toBeNull();
    expect(bathroomLooks(s, { bathtub_spec: { glass_door_action: 'detach_reset', glass_door_height_in: 70 } }).tubGlassDoors)
      .toEqual({ heightIn: 58, frameless: false });
    expect(bathroomLooks(s, {
      bathtub_spec: { glass_door_action: 'replace', glass_door_frameless: true, glass_door_height_in: 62 },
    }).tubGlassDoors).toEqual({ heightIn: 62, frameless: true });
  });
});

describe('bathroomLooks with picked products', () => {
  const picked = (fields: Record<string, any>) => ({
    product_id: 'p', category: 'floor_tile', title: 'Tile', retailer: 'home_depot', price_unit: 'sf',
    image_file_ids: [], look: {}, taken_at: 'now', ...fields,
  });

  it('lays a picked tile at its own size and colour, with its surface picture', () => {
    const looks = bathroomLooks(sketch([]), {
      floor_spec: { material: 'porcelain', size: '12x12', pattern: 'straight' },
      selections: {
        floor_tile: picked({ tile_width_in: 12, tile_length_in: 24, look: { color: '#3a3f44', material: 'marble' }, swatch_file_id: 'f1' }),
        shower_wall_tile: picked({ category: 'wall_tile', tile_width_in: 3, tile_length_in: 12, look: { pattern: 'subway' } }),
      },
    });
    expect(looks.floor).toMatchObject({ widthIn: 24, heightIn: 12, color: '#3a3f44', material: 'natural_stone', swatchFileId: 'f1', pattern: 'straight' });
    // The product's own subway lay, on the shower and the tub surround alike
    expect(looks.showerTile).toMatchObject({ widthIn: 12, heightIn: 3, pattern: 'subway' });
    expect(looks.surroundTile).toBe(looks.showerTile);
    expect(looks.floor!.key).not.toBe(bathroomLooks(sketch([]), { floor_spec: { material: 'porcelain' } }).floor!.key);
  });

  it('takes the vanity, top, toilet and tub colours and the faucet finish from their products', () => {
    const looks = bathroomLooks(sketch([]), {
      selections: {
        vanity: picked({ category: 'vanity', look: { color: '#1f3b57' } }),
        vanity_top: picked({ category: 'vanity_top', look: { material: 'granite' } }),
        bath_faucet: picked({ category: 'bath_faucet', title: 'Delta Trinsic Faucet', finish: 'Matte Black' }),
        toilet: picked({ category: 'toilet', look: { color: '#efe6d2' } }),
      },
    });
    expect(looks.vanityBox).toBe('#1f3b57');
    expect(looks.vanityTop).toBe('#77736b');
    expect(looks.metal).toBe('#2a2a2a');
    expect(looks.china).toBe('#efe6d2');
    expect(looks.prefab).toBe(DEFAULT_LOOKS.prefab);
  });
});
