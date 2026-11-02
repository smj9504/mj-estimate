import { describe, expect, it } from 'vitest';
import type { WMDemolitionZone, WMFloorSketch, WMRoom } from '../../../../types/wmSketch';
import { EMPTY_OVERLAY_DATA } from '../../../../types/wmSketch';
import { addUpTotals, floorTakeoff, formatDemoQuantity, spreadNumbers } from './demoTakeoff';

const SCALE = 20;
let nextId = 0;

const zone = (overrides: Partial<WMDemolitionZone>): WMDemolitionZone => ({
  id: `z${++nextId}`,
  floor_sketch_id: 'f1',
  material_type: 'carpet',
  surface: 'floor',
  color: '#90EE90',
  x: 0,
  y: 0,
  dimension1_ft: 0,
  dimension2_ft: 0,
  rotation: 0,
  calculated_sqft: 0,
  display_order: 0,
  ...overrides,
});

/** A square room `feet` on a side with its top-left corner at (x, y) in feet */
const room = (name: string, x: number, y: number, feet: number): WMRoom => ({
  id: name,
  floor_sketch_id: 'f1',
  name,
  boundary: [
    { x: x * SCALE, y: y * SCALE },
    { x: (x + feet) * SCALE, y: y * SCALE },
    { x: (x + feet) * SCALE, y: (y + feet) * SCALE },
    { x: x * SCALE, y: (y + feet) * SCALE },
  ],
  color: '',
  height_ft: 8,
  area_sqft: feet * feet,
  wall_ids: [],
});

const floor = (zones: WMDemolitionZone[], rooms: WMRoom[] = []): WMFloorSketch => ({
  id: 'f1',
  job_id: 'j1',
  floor_label: '1st Floor',
  floor_order: 0,
  address_display: '',
  source_type: 'sketch',
  canvas_width: 1200,
  canvas_height: 900,
  scale_pixels_per_foot: SCALE,
  overlay_data: { ...EMPTY_OVERLAY_DATA, demolition_zones: zones, rooms },
  created_at: '',
});

const only = (zones: WMDemolitionZone[], rooms: WMRoom[] = []) => floorTakeoff(floor(zones, rooms)).rows[0];

describe('what a zone is and how big', () => {
  it('reads a floor area as its two sides and square feet', () => {
    const row = only([zone({ material_type: 'carpet', dimension1_ft: 12, dimension2_ft: 10.5, calculated_sqft: 126 })]);
    expect(row.name).toBe('Carpet');
    expect(row.measurement).toBe('12\' × 10\'6"');
    expect(formatDemoQuantity(row.quantity, row.unit)).toBe('126 SF');
  });

  it('reads a wall as its length and height', () => {
    const row = only([zone({
      material_type: 'wall_drywall_2ft', surface: 'wall', dimension1_ft: 12.5, height_ft: 2, calculated_sqft: 25,
    })]);
    expect(row.measurement).toBe('12\'6" long × 2\' high');
    expect(row.unit).toBe('SF');
  });

  it('reads a run of baseboard in linear feet', () => {
    const row = only([zone({
      material_type: 'baseboard', surface: 'wall', dimension1_ft: 14, calculated_sqft: 14,
    })]);
    expect(row.unit).toBe('LF');
    expect(row.quantity).toBe(14);
    expect(row.measurement).toBeUndefined();
  });

  it('names the wood floor kind, and a wall material only when it is not drywall', () => {
    expect(only([zone({ material_type: 'wood_floor', sub_type: 'lvp', calculated_sqft: 1 })]).name).toBe('Wood Floor (LVP)');
    expect(only([zone({ material_type: 'wall_drywall', surface: 'wall', sub_type: 'drywall', calculated_sqft: 1 })]).name)
      .toBe('Wall/Drywall');
    expect(only([zone({ material_type: 'wall_drywall', surface: 'wall', sub_type: 'plaster', calculated_sqft: 1 })]).name)
      .toBe('Wall/Drywall (Plaster)');
  });

  it('keeps an irregular area at the size drawn', () => {
    const row = only([zone({
      material_type: 'ceiling',
      surface: 'ceiling',
      calculated_sqft: 88.5,
      polygon_points: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }],
    })]);
    expect(row.measurement).toBe('Irregular area');
    expect(row.quantity).toBe(88.5);
  });

  it('counts trim in feet from its size and how much came off, as the scope does', () => {
    // A placed trim stores calculated_sqft 1 until someone changes its size
    const placed = only([zone({ material_type: 'window_trim_demo', surface: 'wall', sub_type: 'medium', calculated_sqft: 1 })]);
    expect(placed.unit).toBe('LF');
    expect(placed.quantity).toBe(14);
    expect(placed.name).toBe('Window Trim Demo (Medium)');
    expect(placed.measurement).toBe('36-48"');

    const half = only([zone({ material_type: 'window_trim_demo', surface: 'wall', sub_type: 'medium', trim_removal: 'half' })]);
    expect(half.quantity).toBe(7);
    expect(half.measurement).toBe('36-48", half removed');

    const custom = only([zone({ material_type: 'door_trim_demo', surface: 'wall', trim_removal: 'custom', trim_lf: 11 })]);
    expect(custom.quantity).toBe(11);
    expect(custom.measurement).toBe('custom length');
  });

  it('counts doors and stairs as each', () => {
    const door = only([zone({ material_type: 'door_demo', surface: 'wall', sub_type: 'large', calculated_sqft: 1 })]);
    expect(formatDemoQuantity(door.quantity, door.unit)).toBe('1 EA');
    expect(door.name).toBe('Door Demo (Large)');
    const stairs = only([zone({ material_type: 'stair_demo', dimension1_ft: 13, calculated_sqft: 13 })]);
    expect(formatDemoQuantity(stairs.quantity, stairs.unit)).toBe('13 EA');
  });

  it('lists a material it does not know, by its id', () => {
    const row = only([zone({ material_type: 'vinyl_sheet', calculated_sqft: 9 })]);
    expect(row.name).toBe('Vinyl Sheet');
    expect(row.unit).toBe('SF');
  });

  it('flags a zone with no size and leaves it out of the totals', () => {
    const result = floorTakeoff(floor([
      zone({ material_type: 'carpet' }),
      zone({ material_type: 'carpet', dimension1_ft: 2, dimension2_ft: 2, calculated_sqft: 4 }),
    ]));
    expect(result.unmeasuredCount).toBe(1);
    expect(result.rows.filter((r) => r.unmeasured)).toHaveLength(1);
    expect(result.totals).toEqual([{ name: 'Carpet', quantity: 4, unit: 'SF' }]);
  });

  it('copes with numbers that arrive as strings', () => {
    const row = only([zone({
      material_type: 'carpet',
      dimension1_ft: '3.5000' as unknown as number,
      dimension2_ft: '2' as unknown as number,
      calculated_sqft: '7.00' as unknown as number,
    })]);
    expect(row.quantity).toBe(7);
    expect(row.measurement).toBe('3\'6" × 2\'');
  });
});

describe('a zone as the API sends it, with every empty field null', () => {
  const blanks = {
    sub_type: null,
    height_ft: null,
    baseboard_type: null,
    trim_removal: null,
    trim_lf: null,
    label: null,
    render_mode: null,
    polygon_points: null,
    pixel_width: null,
    pixel_height: null,
  } as unknown as Partial<WMDemolitionZone>;

  it('reads a wall, using the height a wall has when none was set', () => {
    const row = only([zone({
      ...blanks, material_type: 'wall_drywall', surface: 'wall', dimension1_ft: 10, calculated_sqft: 80,
    })]);
    expect(row.name).toBe('Wall/Drywall');
    expect(row.measurement).toBe('10\' long × 8\' high');
    expect(row.geometry.kind).toBe('line');
    expect(row.label).toBeUndefined();
    expect(row.addOns).toEqual([]);
  });

  it('reads a floor area and trim the same way', () => {
    const floorRow = only([zone({ ...blanks, dimension1_ft: 4, dimension2_ft: 5, calculated_sqft: 20 })]);
    expect(floorRow.geometry.kind).toBe('box');
    expect(floorRow.measurement).toBe('4\' × 5\'');

    const trim = only([zone({ ...blanks, material_type: 'door_trim_demo', surface: 'wall', calculated_sqft: 1 })]);
    expect(trim.quantity).toBe(16);
    expect(trim.unit).toBe('LF');
    expect(trim.measurement).toBeUndefined();
  });

  it('draws a zone nobody sized at a stand-in size', () => {
    const row = only([zone({ ...blanks })]);
    expect(row.unmeasured).toBe(true);
    expect(row.geometry).toMatchObject({ kind: 'box', width: 60, height: 40 });
  });
});

describe('what comes out with a zone', () => {
  it('counts carpet pad and glue down over the same area', () => {
    const row = only([zone({
      material_type: 'carpet', calculated_sqft: 100, include_pad: true, glue_down: true,
    })]);
    expect(row.addOns).toEqual([
      { name: 'Carpet Pad', quantity: 100, unit: 'SF' },
      { name: 'Glue Down Carpet Removal', quantity: 100, unit: 'SF' },
    ]);
  });

  it('calls glue down on anything but carpet floor removal', () => {
    const row = only([zone({ material_type: 'tile', calculated_sqft: 10, glue_down: true })]);
    expect(row.addOns).toEqual([{ name: 'Glue Down Floor Removal', quantity: 10, unit: 'SF' }]);
  });

  it('runs baseboard and crown molding along the length of the wall', () => {
    const row = only([zone({
      material_type: 'wall_drywall_2ft',
      surface: 'wall',
      dimension1_ft: 10,
      height_ft: 2,
      calculated_sqft: 20,
      include_insulation: true,
      baseboard_type: 'baseboard_quarter_round',
      include_crown_molding: true,
    })]);
    expect(row.addOns).toEqual([
      { name: 'Insulation', quantity: 20, unit: 'SF' },
      { name: 'Baseboard', quantity: 10, unit: 'LF' },
      { name: 'Quarter Round', quantity: 10, unit: 'LF' },
      { name: 'Crown Molding', quantity: 10, unit: 'LF' },
    ]);
  });

  it('adds them to the totals alongside drawn runs of the same thing', () => {
    const result = floorTakeoff(floor([
      zone({ material_type: 'wall_drywall', surface: 'wall', dimension1_ft: 10, calculated_sqft: 80, baseboard_type: 'baseboard' }),
      zone({ material_type: 'baseboard', surface: 'wall', dimension1_ft: 6, calculated_sqft: 6 }),
    ]));
    expect(result.totals).toEqual(expect.arrayContaining([
      { name: 'Wall/Drywall', quantity: 80, unit: 'SF' },
      { name: 'Baseboard', quantity: 16, unit: 'LF' },
    ]));
  });

  it('adds totals up across floors, by name', () => {
    expect(addUpTotals([
      { name: 'Tile', quantity: 3, unit: 'SF' },
      { name: 'Carpet', quantity: 10.1, unit: 'SF' },
      { name: 'Carpet', quantity: 0.2, unit: 'SF' },
    ])).toEqual([
      { name: 'Carpet', quantity: 10.3, unit: 'SF' },
      { name: 'Tile', quantity: 3, unit: 'SF' },
    ]);
  });
});

describe('where a zone is', () => {
  const kitchen = room('Kitchen', 0, 0, 10);
  const hall = room('Hall', 10, 0, 10);

  const carpetAt = (x: number, y: number, w: number, h: number) => zone({
    x: x * SCALE, y: y * SCALE, dimension1_ft: w, dimension2_ft: h, calculated_sqft: w * h,
  });
  const wallLine = (x: number, y: number, feet: number, rotation = 0) => zone({
    material_type: 'wall_drywall',
    surface: 'wall',
    x: x * SCALE,
    y: y * SCALE,
    dimension1_ft: feet,
    calculated_sqft: feet * 8,
    rotation,
  });

  it('puts a floor area in the room it is drawn in', () => {
    expect(only([carpetAt(2, 2, 6, 6)], [kitchen, hall]).rooms).toEqual(['Kitchen']);
  });

  it('ignores a room the area only clips', () => {
    expect(only([carpetAt(1, 1, 9.5, 8)], [kitchen, hall]).rooms).toEqual(['Kitchen']);
  });

  it('names both rooms, most of it first, when an area spans them', () => {
    expect(only([carpetAt(6, 2, 10, 6)], [kitchen, hall]).rooms).toEqual(['Hall', 'Kitchen']);
  });

  it('turns with the zone: a box rotates about its corner', () => {
    // 90 degrees swings a box that would lie in the hall back over the kitchen
    const swung = zone({
      x: 10 * SCALE, y: 2 * SCALE, dimension1_ft: 6, dimension2_ft: 6, calculated_sqft: 36, rotation: 90,
    });
    expect(only([swung], [kitchen, hall]).rooms).toEqual(['Kitchen']);
  });

  it('names both rooms for a wall between them, and one for a wall of its own', () => {
    expect(only([wallLine(10, 2, 6, 90)], [kitchen, hall]).rooms).toEqual(['Kitchen', 'Hall']);
    expect(only([wallLine(0, 2, 6, 90)], [kitchen, hall]).rooms).toEqual(['Kitchen']);
  });

  it('follows a wall that runs past two rooms', () => {
    expect(only([wallLine(4, 0, 12)], [kitchen, hall]).rooms).toEqual(['Kitchen', 'Hall']);
  });

  it('places a door by its marker', () => {
    const door = zone({ material_type: 'door_demo', surface: 'wall', x: 4 * SCALE, y: 4 * SCALE, calculated_sqft: 1 });
    expect(only([door], [kitchen, hall]).rooms).toEqual(['Kitchen']);
  });

  it('finds a small area by where it sits', () => {
    expect(only([carpetAt(14, 4, 1, 1)], [kitchen, hall]).rooms).toEqual(['Hall']);
  });

  it('puts an irregular area in the room it covers', () => {
    const ceiling = zone({
      material_type: 'ceiling',
      surface: 'ceiling',
      x: 12 * SCALE,
      y: 2 * SCALE,
      calculated_sqft: 16,
      polygon_points: [{ x: 0, y: 0 }, { x: 80, y: 0 }, { x: 80, y: 80 }, { x: 0, y: 80 }],
    });
    const row = only([ceiling], [kitchen, hall]);
    expect(row.rooms).toEqual(['Hall']);
    expect(row.anchor.x).toBeGreaterThan(12 * SCALE);
    expect(row.anchor.y).toBeGreaterThan(2 * SCALE);
  });

  it('keeps the number inside an L-shaped area', () => {
    const ell = zone({
      material_type: 'ceiling',
      surface: 'ceiling',
      calculated_sqft: 100,
      polygon_points: [
        { x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 20 }, { x: 20, y: 20 }, { x: 20, y: 100 }, { x: 0, y: 100 },
      ],
    });
    const { anchor } = only([ell]);
    expect(anchor.x < 20 || anchor.y < 20).toBe(true);
  });

  it('finds no room when the zone is clear of all of them', () => {
    expect(only([carpetAt(40, 40, 6, 6)], [kitchen, hall]).rooms).toEqual([]);
  });

  it('skips a room with no real boundary', () => {
    const broken = { ...kitchen, boundary: [] };
    expect(only([carpetAt(2, 2, 6, 6)], [broken]).rooms).toEqual([]);
  });

  it('calls a blank room what it is', () => {
    expect(only([carpetAt(2, 2, 6, 6)], [{ ...kitchen, name: ' ' }]).rooms).toEqual(['Unnamed room']);
  });
});

describe('the list', () => {
  const kitchen = room('Kitchen', 0, 0, 10);
  const hall = room('Hall', 10, 0, 10);

  it('groups by room in plan order and numbers down the list', () => {
    const result = floorTakeoff(floor([
      zone({ id: 'hall-floor', x: 12 * SCALE, y: 2 * SCALE, dimension1_ft: 6, dimension2_ft: 6, calculated_sqft: 36 }),
      zone({ id: 'kitchen-floor', x: 2 * SCALE, y: 2 * SCALE, dimension1_ft: 6, dimension2_ft: 6, calculated_sqft: 36 }),
      zone({
        id: 'kitchen-ceiling',
        material_type: 'ceiling',
        surface: 'ceiling',
        x: 2 * SCALE,
        y: 2 * SCALE,
        dimension1_ft: 6,
        dimension2_ft: 6,
        calculated_sqft: 36,
      }),
    ], [kitchen, hall]));

    expect(result.groups.map((g) => g.location)).toEqual(['Kitchen', 'Hall']);
    // Top down within a room: ceiling, then walls, then floor
    expect(result.rows.map((r) => [r.number, r.id])).toEqual([
      [1, 'kitchen-ceiling'], [2, 'kitchen-floor'], [3, 'hall-floor'],
    ]);
  });

  it('files a shared wall after the room it starts from, and clear of each room', () => {
    const result = floorTakeoff(floor([
      zone({ id: 'shared', material_type: 'wall_drywall', surface: 'wall', x: 10 * SCALE, y: 2 * SCALE, dimension1_ft: 6, calculated_sqft: 48, rotation: 90 }),
      zone({ id: 'kitchen', x: 2 * SCALE, y: 2 * SCALE, dimension1_ft: 6, dimension2_ft: 6, calculated_sqft: 36 }),
      zone({ id: 'hall', x: 12 * SCALE, y: 2 * SCALE, dimension1_ft: 6, dimension2_ft: 6, calculated_sqft: 36 }),
    ], [kitchen, hall]));
    expect(result.groups.map((g) => g.location)).toEqual(['Kitchen', 'Kitchen / Hall', 'Hall']);
  });

  it('falls back on the zone label when no room is under it', () => {
    const result = floorTakeoff(floor([
      zone({ id: 'plain', calculated_sqft: 1 }),
      zone({ id: 'labelled', label: 'Living Room', calculated_sqft: 1 }),
    ]));
    expect(result.groups.map((g) => g.location)).toEqual(['Living Room', null]);
  });

  it('has nothing to list on an empty floor', () => {
    const result = floorTakeoff(floor([]));
    expect(result.rows).toEqual([]);
    expect(result.groups).toEqual([]);
    expect(result.totals).toEqual([]);
  });

  it('copes with a floor saved before rooms existed', () => {
    const old = floor([zone({ calculated_sqft: 1 })]);
    delete (old.overlay_data as Partial<typeof old.overlay_data>).rooms;
    expect(floorTakeoff(old).rows[0].rooms).toEqual([]);
  });
});

describe('spreadNumbers', () => {
  const at = (id: string, x: number, y: number) => ({ id, anchor: { x, y } });

  it('leaves numbers that are clear of each other where they are', () => {
    const spots = spreadNumbers([at('a', 0, 0), at('b', 100, 0)], 10);
    expect(spots.get('a')).toEqual({ x: 0, y: 0 });
    expect(spots.get('b')).toEqual({ x: 100, y: 0 });
  });

  it('moves a number off one already at the same spot', () => {
    const spots = spreadNumbers([at('a', 0, 0), at('b', 0, 0), at('c', 0, 0)], 10);
    const all = ['a', 'b', 'c'].map((id) => spots.get(id)!);
    expect(new Set(all.map((p) => `${p.x},${p.y}`)).size).toBe(3);
    expect(Math.hypot(all[0].x - all[1].x, all[0].y - all[1].y)).toBeGreaterThanOrEqual(20);
  });

  it('gives up at its anchor rather than losing a number when the area is packed', () => {
    const rows = Array.from({ length: 30 }, (_, i) => at(`n${i}`, 0, 0));
    const spots = spreadNumbers(rows, 10);
    expect(spots.size).toBe(30);
    expect(spots.get('n29')).toEqual({ x: 0, y: 0 });
  });
});

describe('formatDemoQuantity', () => {
  it('groups thousands and drops needless decimals', () => {
    expect(formatDemoQuantity(1024.5, 'SF')).toBe('1,024.5 SF');
    expect(formatDemoQuantity(12, 'LF')).toBe('12 LF');
    expect(formatDemoQuantity(12.345, 'LF')).toBe('12.35 LF');
    expect(formatDemoQuantity(3, 'EA')).toBe('3 EA');
  });
});
