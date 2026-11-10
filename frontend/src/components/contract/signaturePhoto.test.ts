import { describe, expect, it } from 'vitest';

import { fitWithin, liftInk, paperLevel, type Pixels } from './signaturePhoto';

/** A sheet of paper at this shade, with ink of this shade in the given box */
const sheet = (
  width: number, height: number, paper: number,
  ink?: { x: number; y: number; width: number; height: number; shade: number },
): Pixels => {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const inside = ink && x >= ink.x && x < ink.x + ink.width && y >= ink.y && y < ink.y + ink.height;
      const shade = inside ? ink.shade : paper;
      data.set([shade, shade, shade, 255], (y * width + x) * 4);
    }
  }
  return { data, width, height };
};

const alphaAt = (pixels: Pixels, x: number, y: number) => pixels.data[(y * pixels.width + x) * 4 + 3];

describe('paperLevel', () => {
  it('reads the paper from the edge, whatever ink is in the middle', () => {
    expect(paperLevel(sheet(50, 50, 230, { x: 10, y: 10, width: 30, height: 30, shade: 20 }))).toBeCloseTo(230);
  });
});

describe('liftInk', () => {
  it('makes the paper clear, keeps the ink, and finds it', () => {
    const pixels = sheet(60, 40, 240, { x: 20, y: 10, width: 15, height: 5, shade: 30 });
    const bounds = liftInk(pixels);

    expect(alphaAt(pixels, 2, 2)).toBe(0);
    expect(alphaAt(pixels, 25, 12)).toBe(255);
    expect(bounds).toEqual({ x: 16, y: 6, width: 23, height: 13 });
  });

  it('takes grey paper in a dim photo as paper too', () => {
    const pixels = sheet(40, 40, 150, { x: 15, y: 15, width: 10, height: 10, shade: 40 });
    liftInk(pixels);

    expect(alphaAt(pixels, 1, 1)).toBe(0);
    expect(alphaAt(pixels, 20, 20)).toBe(255);
  });

  it('finds nothing on blank paper', () => {
    expect(liftInk(sheet(30, 30, 235))).toBeNull();
  });
});

describe('fitWithin', () => {
  it('shrinks without stretching, and never grows', () => {
    expect(fitWithin(1200, 200, 600, 200)).toEqual({ width: 600, height: 100 });
    expect(fitWithin(300, 400, 600, 200)).toEqual({ width: 150, height: 200 });
    expect(fitWithin(100, 50, 600, 200)).toEqual({ width: 100, height: 50 });
  });
});
