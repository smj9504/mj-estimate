/**
 * A photo of a signature on paper, made into a signature image to keep on file:
 * the paper goes transparent, so the signature sits on a document's line with
 * no white box around it, and the picture is cropped to the ink.
 *
 * The paper's shade is read from the photo's edge, which is paper in any
 * picture of a signature; anything much darker than that is ink.
 */

export interface Pixels {
  /** RGBA, four bytes a pixel, as ImageData holds them */
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

export interface Bounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

// Ink is anything darker than this share of the paper's brightness
const INK_SHARE = 0.72;
// Pixels this close under the cut fade in, so a stroke's edge stays smooth
const EDGE_SHARE = 0.35;
// Too faint to count towards where the ink is
const VISIBLE_ALPHA = 40;
const PADDING = 4;

// The size it's kept at: plenty for a signature line on a printed page
const MAX_WIDTH = 600;
const MAX_HEIGHT = 200;
// Photos are read at this size at most; a phone's 12 megapixels would be slow for nothing
const MAX_READ = 1600;

const brightness = (data: Uint8ClampedArray, i: number) =>
  0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];

/** The paper's brightness: the median along the picture's edge */
export const paperLevel = ({ data, width, height }: Pixels): number => {
  const ring = Math.max(1, Math.round(Math.min(width, height) * 0.02));
  const levels: number[] = [];
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (x < ring || y < ring || x >= width - ring || y >= height - ring) {
        levels.push(brightness(data, (y * width + x) * 4));
      }
    }
  }
  levels.sort((a, b) => a - b);
  return levels[Math.floor(levels.length / 2)] ?? 255;
};

/**
 * Makes the paper transparent in place and returns where the ink is, or null
 * when there is none to find
 */
export const liftInk = (pixels: Pixels): Bounds | null => {
  const { data, width, height } = pixels;
  const cut = paperLevel(pixels) * INK_SHARE;
  const edge = Math.max(1, cut * EDGE_SHARE);
  let left = width;
  let top = height;
  let right = -1;
  let bottom = -1;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * 4;
      const level = brightness(data, i);
      const alpha = level >= cut ? 0 : Math.min(255, Math.round(((cut - level) / edge) * 255));
      data[i + 3] = Math.min(data[i + 3], alpha);
      if (data[i + 3] > VISIBLE_ALPHA) {
        left = Math.min(left, x);
        right = Math.max(right, x);
        top = Math.min(top, y);
        bottom = Math.max(bottom, y);
      }
    }
  }
  if (right < 0) return null;
  const x = Math.max(0, left - PADDING);
  const y = Math.max(0, top - PADDING);
  return {
    x,
    y,
    width: Math.min(width, right + PADDING + 1) - x,
    height: Math.min(height, bottom + PADDING + 1) - y,
  };
};

/** The size that fits within the bounds without stretching */
export const fitWithin = (width: number, height: number, maxWidth: number, maxHeight: number) => {
  const scale = Math.min(1, maxWidth / width, maxHeight / height);
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
};

const loadImage = (file: File) => new Promise<HTMLImageElement>((resolve, reject) => {
  const url = URL.createObjectURL(file);
  const image = new Image();
  image.onload = () => {
    URL.revokeObjectURL(url);
    resolve(image);
  };
  image.onerror = () => {
    URL.revokeObjectURL(url);
    reject(new Error("That picture couldn't be opened"));
  };
  image.src = url;
});

/** A picked photo as a transparent PNG data URL of just the signature */
export const signatureFromPhoto = async (file: File): Promise<string> => {
  if (!file.type.startsWith('image/')) throw new Error('Pick a picture of the signature');
  const image = await loadImage(file);
  const read = fitWithin(image.naturalWidth, image.naturalHeight, MAX_READ, MAX_READ);

  const canvas = document.createElement('canvas');
  canvas.width = read.width;
  canvas.height = read.height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error("This browser can't read pictures");
  context.drawImage(image, 0, 0, read.width, read.height);
  const pixels = context.getImageData(0, 0, read.width, read.height);
  const ink = liftInk(pixels);
  if (!ink) throw new Error("Couldn't find a signature in that picture");
  context.putImageData(pixels, 0, 0);

  const size = fitWithin(ink.width, ink.height, MAX_WIDTH, MAX_HEIGHT);
  const out = document.createElement('canvas');
  out.width = size.width;
  out.height = size.height;
  const outContext = out.getContext('2d');
  if (!outContext) throw new Error("This browser can't read pictures");
  outContext.drawImage(canvas, ink.x, ink.y, ink.width, ink.height, 0, 0, size.width, size.height);
  return out.toDataURL('image/png');
};
