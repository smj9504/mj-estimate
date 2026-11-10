import { describe, it, expect } from 'vitest';
import { DEFAULT_DEMO_MATERIAL_TYPES } from '../../../../types/wmSketch';
import type { WMDemolitionZone } from '../../../../types/wmSketch';
import { materialSwapPatch } from './WMDemolitionBulkForm';

const mat = (id: string) => DEFAULT_DEMO_MATERIAL_TYPES.find((m) => m.id === id)!;

function zone(over: Partial<WMDemolitionZone>): WMDemolitionZone {
  return {
    id: 'z1',
    floor_sketch_id: 'f1',
    material_type: 'wall_drywall',
    surface: 'wall',
    color: '#FFB6C1',
    x: 0,
    y: 0,
    dimension1_ft: 10,
    dimension2_ft: 0,
    rotation: 0,
    calculated_sqft: 80,
    height_ft: 8,
    display_order: 0,
    ...over,
  };
}

describe('materialSwapPatch', () => {
  it('drywall to 2ft drywall sets the 2 ft height and its area', () => {
    const p = materialSwapPatch(zone({}), mat('wall_drywall_2ft'));
    expect(p.material_type).toBe('wall_drywall_2ft');
    expect(p.height_ft).toBe(2);
    expect(p.calculated_sqft).toBe(20);
  });

  it('keeps the wall material and its shade between drywall types', () => {
    const p = materialSwapPatch(
      zone({ sub_type: 'plaster', color: '#C4A8D0' }),
      mat('wall_drywall_4ft'),
    );
    expect(p.sub_type).toBe('plaster');
    expect(p.color).toBe('#C4A8D0');
    expect(p.height_ft).toBe(4);
    expect(p.calculated_sqft).toBe(40);
  });

  it('drops the wall material when moving to insulation, which has none', () => {
    const p = materialSwapPatch(zone({ sub_type: 'plaster', color: '#C4A8D0' }), mat('insulation'));
    expect(p.sub_type).toBeUndefined();
    expect(p.color).toBe(mat('insulation').color);
    expect(p.calculated_sqft).toBe(80); // 10 ft x 8 ft, height kept
  });

  it('wood floor to carpet drops the floor type and keeps the area', () => {
    const p = materialSwapPatch(
      zone({ material_type: 'wood_floor', surface: 'floor', sub_type: 'lvp', color: '#8B7355', dimension2_ft: 12, calculated_sqft: 120, height_ft: undefined }),
      mat('carpet'),
    );
    expect(p.sub_type).toBeUndefined();
    expect(p.color).toBe(mat('carpet').color);
    expect(p.calculated_sqft).toBeUndefined(); // area untouched
    expect(p.height_ft).toBeUndefined();
  });

  it('window trim to door trim keeps the size and recounts the LF and box size', () => {
    const p = materialSwapPatch(
      zone({ material_type: 'window_trim_demo', sub_type: 'large', calculated_sqft: 20, trim_removal: 'half' }),
      mat('door_trim_demo'),
    );
    expect(p.sub_type).toBe('large');
    expect(p.calculated_sqft).toBe(9); // half of 18 LF
    expect(p.pixel_width).toBe(44);
  });

  it('trim to door demo counts one door', () => {
    const p = materialSwapPatch(
      zone({ material_type: 'door_trim_demo', sub_type: 'small', calculated_sqft: 16 }),
      mat('door_demo'),
    );
    expect(p.sub_type).toBe('small');
    expect(p.calculated_sqft).toBe(1);
  });

  it('leaves a polygon area alone', () => {
    const p = materialSwapPatch(
      zone({
        material_type: 'ceiling', surface: 'ceiling', calculated_sqft: 133.5,
        polygon_points: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 0, y: 100 }],
      }),
      mat('ceiling'),
    );
    expect(p.calculated_sqft).toBeUndefined();
  });
});
