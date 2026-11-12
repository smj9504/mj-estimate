/**
 * Saves the sketch as it is drawn: a moment after the last change, one save
 * at a time, and once more on the way out if a change is still waiting.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { FlooringEstimate, FlooringSketch } from '../../../../types/flooringEstimate';
import flooringEstimateService from '../../../../services/flooringEstimateService';

export type SaveStatus = 'saved' | 'pending' | 'saving' | 'error';

export const AUTOSAVE_DELAY_MS = 1200;

export function useSketchAutosave(
  estimateId: string,
  sketch: FlooringSketch,
  onSaved?: (estimate: FlooringEstimate) => void,
  enabled = true,
) {
  const [status, setStatus] = useState<SaveStatus>('saved');
  const lastSaved = useRef<FlooringSketch>(sketch);
  const latest = useRef<FlooringSketch>(sketch);
  const inFlight = useRef<Promise<void> | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onSavedRef = useRef(onSaved);
  onSavedRef.current = onSaved;
  latest.current = sketch;

  const save = useCallback(async (): Promise<void> => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    if (inFlight.current) {
      await inFlight.current;
    }
    const toSave = latest.current;
    if (toSave === lastSaved.current) {
      setStatus('saved');
      return;
    }
    setStatus('saving');
    const run = flooringEstimateService
      .saveSketch(estimateId, toSave)
      .then((estimate) => {
        lastSaved.current = toSave;
        onSavedRef.current?.(estimate);
        setStatus(latest.current === toSave ? 'saved' : 'pending');
      })
      .catch(() => setStatus('error'));
    inFlight.current = run;
    await run;
    inFlight.current = null;
    if (latest.current !== lastSaved.current && latest.current !== toSave) {
      await save();
    }
  }, [estimateId]);

  useEffect(() => {
    if (!enabled || sketch === lastSaved.current) return;
    setStatus('pending');
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      void save();
    }, AUTOSAVE_DELAY_MS);
  }, [sketch, enabled, save]);

  // A change still waiting when the editor closes is saved, and leaving the
  // page with one asks first
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (latest.current !== lastSaved.current) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', warn);
    return () => {
      window.removeEventListener('beforeunload', warn);
      if (latest.current !== lastSaved.current) void save();
    };
  }, [save]);

  /** A sketch that came from the server is already saved */
  const markSaved = useCallback((saved: FlooringSketch) => {
    lastSaved.current = saved;
    latest.current = saved;
    setStatus('saved');
  }, []);

  return { status, saveNow: save, markSaved };
}
