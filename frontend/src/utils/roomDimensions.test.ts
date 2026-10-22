import { describe, expect, it } from 'vitest';
import { detectRoomFaces, estimateWallThickness, type Point, type RgbaImage } from './roomDimensions';

// Drawings in the style of an Xactimate room capture: grey walls with a dark
// outline on white, thin dashed neighbours, a blue door swing.

type Rgb = [number, number, number];
const OUTLINE: Rgb = [40, 40, 40];
const FILL: Rgb = [192, 192, 192];

function blank(width: number, height: number): RgbaImage {
  return { width, height, data: new Uint8ClampedArray(width * height * 4).fill(255) };
}

function paint(img: RgbaImage, x: number, y: number, [r, g, b]: Rgb) {
  if (x < 0 || y < 0 || x >= img.width || y >= img.height) return;
  const i = (y * img.width + x) * 4;
  img.data[i] = r;
  img.data[i + 1] = g;
  img.data[i + 2] = b;
}

/** Pixels x0 ≤ x < x1, y0 ≤ y < y1 */
function rect(img: RgbaImage, x0: number, y0: number, x1: number, y1: number, color: Rgb) {
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) paint(img, x, y, color);
}

function wall(img: RgbaImage, x0: number, y0: number, x1: number, y1: number) {
  rect(img, x0, y0, x1, y1, OUTLINE);
  rect(img, x0 + 1, y0 + 1, x1 - 1, y1 - 1, FILL);
}

function line(img: RgbaImage, a: Point, b: Point, color: Rgb, dashed = false) {
  const steps = Math.max(Math.abs(b.x - a.x), Math.abs(b.y - a.y));
  for (let k = 0; k <= steps; k++) {
    if (dashed && k % 8 >= 5) continue;
    paint(img, Math.round(a.x + ((b.x - a.x) * k) / steps), Math.round(a.y + ((b.y - a.y) * k) / steps), color);
  }
}

function inside(p: Point, poly: Point[]): boolean {
  let hit = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) hit = !hit;
  }
  return hit;
}

const lengths = (img: RgbaImage) => detectRoomFaces(img).faces.map(f => Math.round(f.lengthPx));

/** A closed 184 × 134 room inside 8px walls */
function closedRoom(): RgbaImage {
  const img = blank(260, 210);
  wall(img, 20, 20, 220, 28);
  wall(img, 20, 162, 220, 170);
  wall(img, 20, 20, 28, 170);
  wall(img, 212, 20, 220, 170);
  return img;
}

describe('estimateWallThickness', () => {
  it('reads the wall band width, not the thin lines around it', () => {
    const img = closedRoom();
    line(img, { x: 0, y: 190 }, { x: 259, y: 190 }, [150, 150, 150], true);
    const mask = new Uint8Array(img.width * img.height);
    for (let i = 0; i < mask.length; i++) mask[i] = img.data[i * 4] < 220 ? 1 : 0;
    expect(estimateWallThickness(mask, img.width, img.height)).toBe(8);
  });

  it('is not fooled by wide dashed lines or a solid block', () => {
    const img = blank(320, 260);
    wall(img, 20, 20, 280, 34); // 14px walls, as in a capture zoomed in
    wall(img, 20, 196, 280, 210);
    wall(img, 20, 20, 34, 210);
    wall(img, 266, 20, 280, 210);
    for (const y of [222, 230, 238, 246]) rect(img, 0, y, 320, y + 4, [160, 160, 160]); // 4px neighbour lines
    rect(img, 290, 200, 320, 250, [30, 30, 30]); // a logo in the corner
    const mask = new Uint8Array(img.width * img.height);
    for (let i = 0; i < mask.length; i++) mask[i] = img.data[i * 4] < 220 ? 1 : 0;
    expect(estimateWallThickness(mask, img.width, img.height)).toBe(14);
  });
});

describe('detectRoomFaces', () => {
  it('measures a closed room along the inside faces', () => {
    const result = detectRoomFaces(closedRoom());
    expect(result.wallThicknessPx).toBe(8);
    expect(result.faces.map(f => [f.label, Math.round(f.lengthPx)])).toEqual([
      ['A', 184],
      ['B', 134],
      ['C', 184],
      ['D', 134],
    ]);
    expect(result.openings).toEqual([]);
    expect(result.areaPx).toBe(184 * 134);
  });

  it('starts at the top wall and points each face into the room', () => {
    const [top, right] = detectRoomFaces(closedRoom()).faces;
    expect(top.start).toEqual({ x: 28, y: 28 });
    expect(top.end).toEqual({ x: 212, y: 28 });
    expect(top.normal.y).toBeCloseTo(1);
    expect(right.normal.x).toBeCloseTo(-1);
  });

  it('splits a wall at a door and measures the opening, ignoring the swing and dashed neighbours', () => {
    const img = blank(260, 230);
    wall(img, 20, 20, 220, 28);
    wall(img, 20, 20, 28, 170);
    wall(img, 212, 20, 220, 170);
    wall(img, 20, 162, 80, 170);
    wall(img, 120, 162, 220, 170);
    line(img, { x: 80, y: 162 }, { x: 115, y: 130 }, [60, 60, 255]); // door swing
    line(img, { x: 80, y: 172 }, { x: 80, y: 225 }, [170, 170, 170], true); // hallway beyond
    line(img, { x: 120, y: 172 }, { x: 120, y: 225 }, [170, 170, 170], true);

    const result = detectRoomFaces(img);
    expect(result.faces.map(f => Math.round(f.lengthPx))).toEqual([184, 134, 92, 52, 134]);
    expect(result.openings.map(o => Math.round(o.lengthPx))).toEqual([40]);
    expect(result.areaPx).toBe(184 * 134);
  });

  it('closes a missing corner with an L through the corner', () => {
    const img = blank(260, 210);
    wall(img, 20, 20, 150, 28); // top wall stops short of the corner
    wall(img, 20, 20, 28, 170);
    wall(img, 20, 162, 220, 170);
    wall(img, 212, 80, 220, 170); // right wall starts below it

    const result = detectRoomFaces(img);
    expect(result.faces.map(f => Math.round(f.lengthPx))).toEqual([122, 82, 184, 134]);
    expect(result.openings).toHaveLength(1);
    expect(result.openings[0].path).toEqual([
      { x: 150, y: 28 },
      { x: 212, y: 28 },
      { x: 212, y: 80 },
    ]);
    expect(result.openings[0].lengthPx).toBe(62 + 52);
    expect(result.areaPx).toBe(184 * 134);
  });

  it('measures a slanted wall along its face', () => {
    const room: Point[] = [{ x: 30, y: 30 }, { x: 210, y: 30 }, { x: 210, y: 110 }, { x: 150, y: 170 }, { x: 30, y: 170 }];
    const k = 8 * Math.SQRT2;
    const outer: Point[] = [{ x: 22, y: 22 }, { x: 218, y: 22 }, { x: 218, y: 113 + k - 8 }, { x: 153 + k - 8, y: 178 }, { x: 22, y: 178 }];
    const img = blank(250, 210);
    for (let y = 0; y < img.height; y++) {
      for (let x = 0; x < img.width; x++) {
        const p = { x: x + 0.5, y: y + 0.5 };
        if (inside(p, outer) && !inside(p, room)) paint(img, x, y, FILL);
      }
    }

    const [top, right, slant, bottom, left] = lengths(img);
    expect(top).toBe(180);
    expect(right).toBeGreaterThanOrEqual(79);
    expect(right).toBeLessThanOrEqual(81);
    expect(Math.abs(slant - 60 * Math.SQRT2)).toBeLessThanOrEqual(2);
    expect(bottom).toBeGreaterThanOrEqual(119);
    expect(bottom).toBeLessThanOrEqual(121);
    expect(left).toBe(140);
  });

  it('ignores room labels written inside the room', () => {
    const img = closedRoom();
    for (let i = 0; i < 6; i++) rect(img, 80 + i * 9, 90, 86 + i * 9, 92, [30, 30, 30]); // "LIVING ROOM"
    rect(img, 80, 96, 132, 97, [30, 30, 30]);
    expect(lengths(img)).toEqual([184, 134, 184, 134]);
  });

  it('finds nothing on a blank capture', () => {
    const result = detectRoomFaces(blank(200, 150));
    expect(result.faces).toEqual([]);
    expect(result.outline).toBeNull();
  });
});
