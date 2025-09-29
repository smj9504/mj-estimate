/**
 * Measurement Utilities
 * Handles imperial (ft/in) and metric conversions for interior sketching
 */

import { Measurement, Point } from '../../../types/sketch';

// =====================
// Constants
// =====================

export const MEASUREMENT_CONSTANTS = {
  INCHES_PER_FOOT: 12,
  FEET_PER_YARD: 3,
  INCHES_PER_YARD: 36,
  CM_PER_INCH: 2.54,
  MM_PER_INCH: 25.4,
  PRECISION: {
    SIXTEENTH: 16,
    EIGHTH: 8,
    QUARTER: 4,
    HALF: 2,
    WHOLE: 1,
  }
} as const;

// =====================
// Measurement Creation
// =====================

/**
 * Create a measurement from total inches
 */
export function createMeasurement(totalInches: number, precision: number = 16): Measurement {
  const feet = Math.floor(totalInches / MEASUREMENT_CONSTANTS.INCHES_PER_FOOT);
  const remainingInches = totalInches % MEASUREMENT_CONSTANTS.INCHES_PER_FOOT;

  // Round to nearest precision (16th, 8th, quarter, etc.)
  const roundedInches = Math.round(remainingInches * precision) / precision;
  const inches = Math.floor(roundedInches);
  const fraction = roundedInches - inches;

  return {
    feet,
    inches: inches + fraction,
    totalInches,
    display: formatMeasurement({ feet, inches: inches + fraction, totalInches, display: '' })
  };
}

/**
 * Create measurement from feet and inches
 */
export function createMeasurementFromFeetInches(feet: number, inches: number): Measurement {
  const totalInches = feet * MEASUREMENT_CONSTANTS.INCHES_PER_FOOT + inches;
  return createMeasurement(totalInches);
}

/**
 * Create measurement from string input (e.g., "12'6\"", "12.5'", "150\"")
 */
export function parseMeasurementString(input: string): Measurement | null {
  const cleaned = input.trim().replace(/\s+/g, '');

  // Pattern matching for various formats
  const patterns = [
    // 12'6" or 12' 6"
    /^(\d+)['′]\s*(\d+(?:\.\d+)?)[""″]?$/,
    // 12.5' or 12.5 ft
    /^(\d+(?:\.\d+)?)['′]?(?:\s*(?:ft|feet))?$/,
    // 150" or 150 in
    /^(\d+(?:\.\d+)?)[""″]?(?:\s*(?:in|inch|inches))?$/,
    // Mixed fractions: 12'6-1/2"
    /^(\d+)['′]\s*(\d+)-(\d+)\/(\d+)[""″]?$/,
    // Just fractions: 6-1/2"
    /^(\d+)-(\d+)\/(\d+)[""″]?$/,
  ];

  // Try feet and inches pattern
  let match = cleaned.match(patterns[0]);
  if (match) {
    const feet = parseInt(match[1]);
    const inches = parseFloat(match[2]);
    return createMeasurementFromFeetInches(feet, inches);
  }

  // Try decimal feet pattern
  match = cleaned.match(patterns[1]);
  if (match) {
    const feet = parseFloat(match[1]);
    return createMeasurementFromFeetInches(feet, 0);
  }

  // Try inches only pattern
  match = cleaned.match(/^(\d+(?:\.\d+)?)[""″]?(?:\s*(?:in|inch|inches))?$/);
  if (match) {
    const totalInches = parseFloat(match[1]);
    return createMeasurement(totalInches);
  }

  // Try mixed fraction with feet
  match = cleaned.match(patterns[3]);
  if (match) {
    const feet = parseInt(match[1]);
    const wholeInches = parseInt(match[2]);
    const numerator = parseInt(match[3]);
    const denominator = parseInt(match[4]);
    const inches = wholeInches + numerator / denominator;
    return createMeasurementFromFeetInches(feet, inches);
  }

  // Try fraction inches only
  match = cleaned.match(patterns[4]);
  if (match) {
    const wholeInches = parseInt(match[1]);
    const numerator = parseInt(match[2]);
    const denominator = parseInt(match[3]);
    const totalInches = wholeInches + numerator / denominator;
    return createMeasurement(totalInches);
  }

  return null;
}

/**
 * Format measurement for display
 */
export function formatMeasurement(measurement: Measurement, showZeroInches: boolean = false): string {
  const { feet, inches } = measurement;

  if (feet === 0 && inches === 0) {
    return '0"';
  }

  if (feet === 0) {
    return formatInches(inches);
  }

  if (inches === 0) {
    return showZeroInches ? `${feet}' 0"` : `${feet}'`;
  }

  return `${feet}' ${formatInches(inches)}`;
}

/**
 * Format inches with fractions
 */
export function formatInches(inches: number): string {
  const wholeInches = Math.floor(inches);
  const fraction = inches - wholeInches;

  if (fraction === 0) {
    return `${wholeInches}"`;
  }

  // Convert decimal to fraction
  const fractionString = decimalToFraction(fraction);

  if (wholeInches === 0) {
    return `${fractionString}"`;
  }

  return `${wholeInches}-${fractionString}"`;
}

/**
 * Convert decimal to common fraction
 */
export function decimalToFraction(decimal: number, precision: number = 16): string {
  if (decimal === 0) return '0';

  // Find closest fraction
  let closestNumerator = 1;
  let closestDenominator = precision;
  let minDiff = Math.abs(decimal - 1/precision);

  for (let denominator = 2; denominator <= precision; denominator++) {
    for (let numerator = 1; numerator < denominator; numerator++) {
      const fractionValue = numerator / denominator;
      const diff = Math.abs(decimal - fractionValue);

      if (diff < minDiff) {
        minDiff = diff;
        closestNumerator = numerator;
        closestDenominator = denominator;
      }
    }
  }

  // Simplify fraction
  const gcd = greatestCommonDivisor(closestNumerator, closestDenominator);
  const simplifiedNumerator = closestNumerator / gcd;
  const simplifiedDenominator = closestDenominator / gcd;

  return `${simplifiedNumerator}/${simplifiedDenominator}`;
}

/**
 * Greatest common divisor helper
 */
function greatestCommonDivisor(a: number, b: number): number {
  return b === 0 ? a : greatestCommonDivisor(b, a % b);
}

// =====================
// Distance Calculations
// =====================

/**
 * Calculate distance between two points in pixels
 */
export function calculatePixelDistance(point1: Point, point2: Point): number {
  const dx = point2.x - point1.x;
  const dy = point2.y - point1.y;
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Convert pixels to feet based on scale
 */
export function pixelsToFeet(pixels: number, pixelsPerFoot: number): number {
  return pixels / pixelsPerFoot;
}

/**
 * Convert feet to pixels based on scale
 */
export function feetToPixels(feet: number, pixelsPerFoot: number): number {
  return feet * pixelsPerFoot;
}

/**
 * Calculate measurement between two points
 */
export function measureDistance(
  point1: Point,
  point2: Point,
  pixelsPerFoot: number,
  precision: number = 16
): Measurement {
  const pixelDistance = calculatePixelDistance(point1, point2);
  const feetDistance = pixelsToFeet(pixelDistance, pixelsPerFoot);
  const inchDistance = feetDistance * MEASUREMENT_CONSTANTS.INCHES_PER_FOOT;
  return createMeasurement(inchDistance, precision);
}

// =====================
// Area Calculations
// =====================

/**
 * Calculate area of a polygon from points
 */
export function calculatePolygonArea(points: Point[]): number {
  if (points.length < 3) return 0;

  let area = 0;
  for (let i = 0; i < points.length; i++) {
    const j = (i + 1) % points.length;
    area += points[i].x * points[j].y;
    area -= points[j].x * points[i].y;
  }
  return Math.abs(area) / 2;
}

/**
 * Calculate perimeter of a polygon
 */
export function calculatePolygonPerimeter(points: Point[]): number {
  if (points.length < 2) return 0;

  let perimeter = 0;
  for (let i = 0; i < points.length; i++) {
    const j = (i + 1) % points.length;
    perimeter += calculatePixelDistance(points[i], points[j]);
  }
  return perimeter;
}

/**
 * Convert pixel area to square feet
 */
export function pixelAreaToSquareFeet(pixelArea: number, pixelsPerFoot: number): number {
  const pixelsPerSquareFoot = pixelsPerFoot * pixelsPerFoot;
  return pixelArea / pixelsPerSquareFoot;
}

/**
 * Calculate cubic feet from area and height
 */
export function calculateCubicFeet(areaSquareFeet: number, heightMeasurement: Measurement): number {
  const heightFeet = heightMeasurement.totalInches / MEASUREMENT_CONSTANTS.INCHES_PER_FOOT;
  return areaSquareFeet * heightFeet;
}

// =====================
// Validation
// =====================

/**
 * Validate measurement input
 */
export function isValidMeasurement(measurement: Measurement): boolean {
  return (
    measurement.totalInches >= 0 &&
    measurement.feet >= 0 &&
    measurement.inches >= 0 &&
    measurement.inches < MEASUREMENT_CONSTANTS.INCHES_PER_FOOT &&
    typeof measurement.display === 'string'
  );
}

/**
 * Validate measurement string format
 */
export function isValidMeasurementString(input: string): boolean {
  return parseMeasurementString(input) !== null;
}

// =====================
// Conversion Utilities
// =====================

/**
 * Convert measurement to different units
 */
export function convertMeasurement(
  measurement: Measurement,
  targetUnit: 'inches' | 'feet' | 'yards' | 'cm' | 'mm'
): number {
  const { totalInches } = measurement;

  switch (targetUnit) {
    case 'inches':
      return totalInches;
    case 'feet':
      return totalInches / MEASUREMENT_CONSTANTS.INCHES_PER_FOOT;
    case 'yards':
      return totalInches / MEASUREMENT_CONSTANTS.INCHES_PER_YARD;
    case 'cm':
      return totalInches * MEASUREMENT_CONSTANTS.CM_PER_INCH;
    case 'mm':
      return totalInches * MEASUREMENT_CONSTANTS.MM_PER_INCH;
    default:
      return totalInches;
  }
}

/**
 * Round measurement to specific precision
 */
export function roundMeasurement(measurement: Measurement, precision: number = 16): Measurement {
  const roundedInches = Math.round(measurement.totalInches * precision) / precision;
  return createMeasurement(roundedInches, precision);
}

// =====================
// Comparison Utilities
// =====================

/**
 * Compare two measurements
 */
export function compareMeasurements(a: Measurement, b: Measurement): number {
  return a.totalInches - b.totalInches;
}

/**
 * Check if two measurements are equal within tolerance
 */
export function measurementsEqual(a: Measurement, b: Measurement, tolerance: number = 0.0625): boolean {
  return Math.abs(a.totalInches - b.totalInches) <= tolerance;
}

/**
 * Find minimum measurement from array
 */
export function minMeasurement(measurements: Measurement[]): Measurement | null {
  if (measurements.length === 0) return null;
  return measurements.reduce((min, current) =>
    compareMeasurements(current, min) < 0 ? current : min
  );
}

/**
 * Find maximum measurement from array
 */
export function maxMeasurement(measurements: Measurement[]): Measurement | null {
  if (measurements.length === 0) return null;
  return measurements.reduce((max, current) =>
    compareMeasurements(current, max) > 0 ? current : max
  );
}

// =====================
// Display Utilities
// =====================

/**
 * Format area measurement
 */
export function formatArea(squareFeet: number, unit: 'sqft' | 'sqin' | 'sqyd' = 'sqft'): string {
  let value = squareFeet;
  let unitLabel = 'sq ft';

  switch (unit) {
    case 'sqin':
      value = squareFeet * 144; // 12 * 12
      unitLabel = 'sq in';
      break;
    case 'sqyd':
      value = squareFeet / 9; // 3 * 3
      unitLabel = 'sq yd';
      break;
  }

  return `${value.toFixed(2)} ${unitLabel}`;
}

/**
 * Format volume measurement
 */
export function formatVolume(cubicFeet: number, unit: 'cuft' | 'cuin' | 'cuyd' = 'cuft'): string {
  let value = cubicFeet;
  let unitLabel = 'cu ft';

  switch (unit) {
    case 'cuin':
      value = cubicFeet * 1728; // 12 * 12 * 12
      unitLabel = 'cu in';
      break;
    case 'cuyd':
      value = cubicFeet / 27; // 3 * 3 * 3
      unitLabel = 'cu yd';
      break;
  }

  return `${value.toFixed(2)} ${unitLabel}`;
}