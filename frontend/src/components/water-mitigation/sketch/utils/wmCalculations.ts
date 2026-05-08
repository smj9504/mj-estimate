/**
 * Water Mitigation Sketch Calculation Utilities
 *
 * Pure functions for dimension parsing, area calculations, and floor summary
 * aggregation. No side effects — safe for use in useMemo / unit tests.
 */

import type {
  WMOverlayData,
  WMFloorSummary,
  MaterialTypeSummary,
  EquipmentType,
} from '../../../../types/wmSketch';
import {
  DEFAULT_DEMO_MATERIAL_TYPES,
  EQUIPMENT_CONFIG,
  WOOD_FLOOR_SUB_TYPES,
  WALL_MATERIAL_SUB_TYPES,
  WALL_MATERIAL_IDS,
} from '../../../../types/wmSketch';

// ============================================================================
// Dimension Parsing
// ============================================================================

/**
 * Parse a dimension string into decimal feet.
 *
 * Supported input formats:
 *   "3' 4\""   or  "3'4\""    → 3 + 4/12 ≈ 3.333 ft  (feet + inches)
 *   "3.7'"     or  "3.7"      → 3.7 ft               (decimal feet)
 *   "44\""                    → 44/12 ≈ 3.667 ft      (inches only)
 *   "3"                       → 3 ft                  (plain number → feet)
 *   "3' 4"     (no closing ") → 3.333 ft              (lenient inches parsing)
 *
 * Returns 0 for empty or unparseable input.
 */
export function parseDimension(input: string): number {
  if (!input) return 0;

  const trimmed = input.trim();
  if (trimmed === '') return 0;

  // ------------------------------------------------------------------
  // Pattern 1: feet + inches  →  3'4"  or  3' 4"  or  3'4  (no closing ")
  // The feet part is required (single quote); inches part is optional closer.
  // ------------------------------------------------------------------
  const feetInchesPattern = /^(\d+(?:\.\d+)?)\s*['′]\s*(\d+(?:\.\d+)?)[""″]?$/;
  let match = trimmed.match(feetInchesPattern);
  if (match) {
    const feet = parseFloat(match[1]);
    const inches = parseFloat(match[2]);
    return feet + inches / 12;
  }

  // ------------------------------------------------------------------
  // Pattern 2: inches only  →  44"  or  44″
  // Must have a double-quote marker and no feet marker.
  // ------------------------------------------------------------------
  const inchesOnlyPattern = /^(\d+(?:\.\d+)?)\s*[""″]$/;
  match = trimmed.match(inchesOnlyPattern);
  if (match) {
    const inches = parseFloat(match[1]);
    return inches / 12;
  }

  // ------------------------------------------------------------------
  // Pattern 3: decimal or plain feet  →  3.7'  or  3.7  or  3'
  // Single-quote is optional; anything without a double-quote is treated
  // as feet.
  // ------------------------------------------------------------------
  const decimalFeetPattern = /^(\d+(?:\.\d+)?)\s*['′]?$/;
  match = trimmed.match(decimalFeetPattern);
  if (match) {
    return parseFloat(match[1]);
  }

  // Unparseable
  return 0;
}

// ============================================================================
// Dimension Formatting
// ============================================================================

/**
 * Format decimal feet to a human-readable display string.
 *
 * Examples:
 *   6.25  → "6' 3\""
 *   3.0   → "3' 0\""
 *   0.5   → "0' 6\""
 */
export function formatDimension(feet: number): string {
  if (!isFinite(feet) || feet < 0) return '0\' 0"';

  const wholeFeet = Math.floor(feet);
  const remainingInches = Math.round((feet - wholeFeet) * 12);

  // Handle rounding overflow (e.g. 11.999... rounds to 12 inches)
  if (remainingInches >= 12) {
    return `${wholeFeet + 1}' 0"`;
  }

  return `${wholeFeet}' ${remainingInches}"`;
}

/**
 * Format decimal feet to a compact display string (no spaces).
 *
 * Examples:
 *   6.25  → "6'3\""
 *   3.0   → "3'"
 *   0.5   → "6\""
 */
export function formatDimensionCompact(feet: number): string {
  if (!isFinite(feet) || feet < 0) return '0\'';

  const wholeFeet = Math.floor(feet);
  const remainingInches = Math.round((feet - wholeFeet) * 12);

  if (remainingInches >= 12) {
    return `${wholeFeet + 1}'`;
  }

  if (wholeFeet === 0) {
    return `${remainingInches}"`;
  }

  if (remainingInches === 0) {
    return `${wholeFeet}'`;
  }

  return `${wholeFeet}'${remainingInches}"`;
}

// ============================================================================
// Area Calculations
// ============================================================================

/**
 * Calculate square footage for a demolition zone: dim1 × dim2.
 * Rounds to 2 decimal places.
 */
export function calcDemoZoneSqft(dim1Ft: number, dim2Ft: number): number {
  return Math.round(dim1Ft * dim2Ft * 100) / 100;
}

/**
 * Calculate area of a polygon using the Shoelace formula.
 * Points are in canvas pixels; result is converted to square feet using scale.
 * Returns absolute area (always positive).
 */
export function calcPolygonAreaSqft(
  points: { x: number; y: number }[],
  scalePixelsPerFoot: number,
): number {
  if (points.length < 3 || scalePixelsPerFoot <= 0) return 0;
  let area = 0;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    area += (points[j].x + points[i].x) * (points[j].y - points[i].y);
  }
  const areaPixels = Math.abs(area / 2);
  const sqft = areaPixels / (scalePixelsPerFoot * scalePixelsPerFoot);
  return Math.round(sqft * 100) / 100;
}

/**
 * Calculate square footage for a floor protection strip: paperWidthFt × lengthFt.
 * Rounds to 2 decimal places.
 */
export function calcFloorProtectionSqft(
  paperWidthFt: number,
  lengthFt: number
): number {
  return Math.round(paperWidthFt * lengthFt * 100) / 100;
}

/**
 * Calculate square footage for a containment barrier: lengthFt × heightFt.
 * lengthFt = span on floor plan, heightFt = poly height (ceiling height).
 * Rounds to 2 decimal places.
 */
export function calcContainmentSqft(lengthFt: number, heightFt: number): number {
  return Math.round(lengthFt * heightFt * 100) / 100;
}

/**
 * Calculate square footage for a content protection area: widthFt × lengthFt.
 * Rounds to 2 decimal places.
 */
export function calcContentProtectionSqft(widthFt: number, lengthFt: number): number {
  return Math.round(widthFt * lengthFt * 100) / 100;
}

// ============================================================================
// Scale Conversions
// ============================================================================

/**
 * Convert canvas pixels to real-world feet using the canvas scale.
 *
 * @param px                 Pixel distance on the canvas
 * @param scalePixelsPerFoot Canvas pixels that represent one foot
 */
export function pixelsToFeet(px: number, scalePixelsPerFoot: number): number {
  if (scalePixelsPerFoot <= 0) return 0;
  return px / scalePixelsPerFoot;
}

/**
 * Convert real-world feet to canvas pixels using the canvas scale.
 *
 * @param ft                 Distance in feet
 * @param scalePixelsPerFoot Canvas pixels that represent one foot
 */
export function feetToPixels(ft: number, scalePixelsPerFoot: number): number {
  return ft * scalePixelsPerFoot;
}

// ============================================================================
// Floor Summary Aggregation
// ============================================================================

/**
 * Calculate per-floor totals from overlay data.
 *
 * - Demolition zones are grouped by material_type and sorted by display_order.
 * - Equipment counts are tallied per EquipmentType.
 * - Containment and floor protection are summed into count + total_sqft.
 */
export function calcFloorTotals(overlayData: WMOverlayData): WMFloorSummary {
  // ------------------------------------------------------------------
  // Demolition — group by (material_type, sub_type)
  // ------------------------------------------------------------------
  const demoByTypeMap = new Map<string, MaterialTypeSummary>();

  for (const zone of overlayData.demolition_zones) {
    // Key includes sub_type so wood floor variants are separate groups
    const groupKey = `${zone.material_type}|${zone.sub_type || ''}`;
    const existing = demoByTypeMap.get(groupKey);

    if (existing) {
      existing.count += 1;
      existing.total_sqft = Math.round((existing.total_sqft + zone.calculated_sqft) * 100) / 100;
    } else {
      const materialDef = DEFAULT_DEMO_MATERIAL_TYPES.find(
        (m) => m.id === zone.material_type
      );
      let displayName = materialDef?.name ?? zone.material_type;
      let displayColor = zone.color;

      // Append sub-type name for wood floor
      if (zone.material_type === 'wood_floor' && zone.sub_type) {
        const stCfg = WOOD_FLOOR_SUB_TYPES.find((s) => s.id === zone.sub_type);
        displayName = `${displayName} (${stCfg?.name ?? zone.sub_type})`;
        displayColor = stCfg?.color ?? zone.color;
      }

      // Append sub-type name for wall materials
      if (WALL_MATERIAL_IDS.has(zone.material_type) && zone.sub_type) {
        const stCfg = WALL_MATERIAL_SUB_TYPES.find((s) => s.id === zone.sub_type);
        displayName = `${displayName} (${stCfg?.name ?? zone.sub_type})`;
        displayColor = stCfg?.color ?? zone.color;
      }

      demoByTypeMap.set(groupKey, {
        material_type: zone.material_type,
        material_name: displayName,
        surface: zone.surface,
        color: displayColor,
        count: 1,
        total_sqft: zone.calculated_sqft,
        unit: materialDef?.unit ?? 'SF',
      });
    }
  }

  const demolition_by_type: MaterialTypeSummary[] = Array.from(
    demoByTypeMap.values()
  );

  // ------------------------------------------------------------------
  // Equipment counts
  // ------------------------------------------------------------------
  const equipment_counts = Object.keys(EQUIPMENT_CONFIG).reduce(
    (acc, key) => {
      acc[key as EquipmentType] = 0;
      return acc;
    },
    {} as Record<EquipmentType, number>
  );

  for (const placement of overlayData.equipment_placements) {
    if (placement.equipment_type in equipment_counts) {
      equipment_counts[placement.equipment_type] += 1;
    }
  }

  // ------------------------------------------------------------------
  // Containment totals
  // ------------------------------------------------------------------
  const containmentTotalSqft = overlayData.containment_zones.reduce(
    (sum, zone) => Math.round((sum + zone.calculated_sqft) * 100) / 100,
    0
  );

  // ------------------------------------------------------------------
  // Floor protection totals
  // ------------------------------------------------------------------
  const floorProtectionTotalSqft = overlayData.floor_protections.reduce(
    (sum, fp) => Math.round((sum + fp.calculated_sqft) * 100) / 100,
    0
  );

  // ------------------------------------------------------------------
  // Content protection totals
  // ------------------------------------------------------------------
  const contentProtections = overlayData.content_protections ?? [];
  const contentProtectionTotalSqft = contentProtections.reduce(
    (sum, cp) => Math.round((sum + cp.calculated_sqft) * 100) / 100,
    0
  );

  return {
    demolition_by_type,
    containment: {
      count: overlayData.containment_zones.length,
      total_sqft: containmentTotalSqft,
    },
    floor_protection: {
      count: overlayData.floor_protections.length,
      total_sqft: floorProtectionTotalSqft,
    },
    content_protection: {
      count: contentProtections.length,
      total_sqft: contentProtectionTotalSqft,
    },
    equipment_counts,
  };
}

// ============================================================================
// ID Generation
// ============================================================================

/**
 * Generate a unique ID for overlay elements.
 * Uses crypto.randomUUID when available, otherwise falls back to a
 * timestamp + random string combination.
 */
export function generateOverlayId(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
}
