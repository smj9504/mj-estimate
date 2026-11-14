/**
 * Saves the sketch as it is drawn (see useAutosave): to the flooring
 * estimate, or wherever the page says (the rebuild estimate's own sketch).
 */

import { useCallback } from 'react';
import type { FlooringEstimate, FlooringSketch } from '../../../../types/flooringEstimate';
import flooringEstimateService from '../../../../services/flooringEstimateService';
import { useAutosave } from '../../hooks/useAutosave';

export type { SaveStatus } from '../../hooks/useAutosave';

export const AUTOSAVE_DELAY_MS = 1200;

export type SketchSave<R> = (sketch: FlooringSketch) => Promise<R>;

export function useSketchAutosave<R = FlooringEstimate>(
  estimateId: string,
  sketch: FlooringSketch,
  onSaved?: (result: R) => void,
  enabled = true,
  saveTo?: SketchSave<R>,
) {
  const save = useCallback(
    (value: FlooringSketch) => (saveTo
      ? saveTo(value)
      : (flooringEstimateService.saveSketch(estimateId, value) as Promise<unknown> as Promise<R>)),
    [estimateId, saveTo],
  );
  return useAutosave(sketch, save, { delay: AUTOSAVE_DELAY_MS, enabled, onSaved });
}
