/**
 * Feet and inches, as typed on site and as shown on the sketch.
 */

const FRACTION = /^(\d+)\/(\d+)$/;

function inchesOf(whole: string | undefined, fraction: string | undefined): number {
  let inches = whole ? parseFloat(whole) : 0;
  if (fraction) {
    const m = fraction.match(FRACTION);
    if (!m || Number(m[2]) === 0) return NaN;
    inches += Number(m[1]) / Number(m[2]);
  }
  return inches;
}

/**
 * A length typed by hand, in feet; null when it can't be read.
 *
 *   12' 6"   12'6"   12'6   12 6   12-6   → 12.5
 *   12' 6 1/2"   12 6 1/2               → 12.5417
 *   12.5   12.5'   12'                   → feet
 *   150"   6 1/2"                        → inches
 */
export function parseFeet(input: string): number | null {
  if (input == null) return null;
  const s = String(input)
    .trim()
    .replace(/[′’`]/g, "'")
    .replace(/[″”]|''/g, '"')
    .replace(/\s+/g, ' ');
  if (!s) return null;

  // Inches only: 150"  6 1/2"  1/2"
  let m = s.match(/^(?:(\d+(?:\.\d+)?)\s?)?(\d+\/\d+)?\s?"$/);
  if (m && (m[1] || m[2])) {
    const inches = inchesOf(m[1], m[2]);
    return Number.isFinite(inches) ? inches / 12 : null;
  }

  // Feet and inches: 12' 6"  12'6  12 6  12-6  12' 6 1/2"  12' 1/2"
  m = s.match(/^(\d+(?:\.\d+)?)\s?(?:'\s?-?|-|\s)\s?(\d+(?:\.\d+)?)?(?:\s?(\d+\/\d+))?\s?"?$/);
  if (m && (m[2] || m[3])) {
    const inches = inchesOf(m[2], m[3]);
    return Number.isFinite(inches) ? parseFloat(m[1]) + inches / 12 : null;
  }

  // Feet only: 12  12.5  12'
  m = s.match(/^(\d+(?:\.\d+)?)\s?'?$/);
  if (m) return parseFloat(m[1]);
  return null;
}

const QUARTERS = ['', ' 1/4', ' 1/2', ' 3/4'];

/** 12.5417 → 12' 6 1/2" (to the nearest quarter inch) */
export function formatFeet(feet: number): string {
  if (!Number.isFinite(feet) || feet < 0) return `0' 0"`;
  const quarters = Math.round(feet * 48);
  const ft = Math.floor(quarters / 48);
  const rest = quarters - ft * 48;
  const inches = Math.floor(rest / 4);
  return `${ft}' ${inches}${QUARTERS[rest % 4]}"`;
}

/** Area to two places, the way the estimate prints it */
export function formatSf(sf: number): string {
  return `${sf.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} SF`;
}
