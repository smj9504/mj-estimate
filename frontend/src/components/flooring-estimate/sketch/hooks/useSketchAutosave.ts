/**
 * Saves the sketch as it is drawn (see useAutosave).
 */

import { useCallback } from 'react';
import type { FlooringEstimate, FlooringSketch } from '../../../../types/flooringEstimate';
import flooringEstimateService from '../../../../services/flooringEstimateService';
import { useAutosave } from '../../hooks/useAutosave';

export type { SaveStatus } from '../../hooks/useAutosave';

export const AUTOSAVE_DELAY_MS = 1200;

export function useSketchAutosave(
  estimateId: string,
  sketch: FlooringSketch,
  onSaved?: (estimate: FlooringEstimate) => void,
  enabled = true,
) {
  const save = useCallback(
    (value: FlooringSketch) => flooringEstimateService.saveSketch(estimateId, value),
    [estimateId],
  );
  return useAutosave(sketch, save, { delay: AUTOSAVE_DELAY_MS, enabled, onSaved });
}
