/**
 * useWMCalculations
 *
 * Auto-recalculating hook that derives WMFloorSummary from overlay data.
 * Memoised so it only recomputes when overlayData reference changes.
 */

import { useMemo } from 'react';
import type { WMOverlayData, WMFloorSummary } from '../../../../types/wmSketch';
import { calcFloorTotals } from '../utils/wmCalculations';

/**
 * Derive a per-floor summary (demolition by type, equipment counts,
 * containment totals, floor protection totals) from the current overlay data.
 *
 * @param overlayData - The live overlay state from useWMSketchState
 * @returns WMFloorSummary - recalculated only when overlayData changes
 */
export function useWMCalculations(overlayData: WMOverlayData): WMFloorSummary {
  return useMemo(() => calcFloorTotals(overlayData), [overlayData]);
}
