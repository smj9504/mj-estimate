/**
 * Saves a value as it is changed: a moment after the last change, one save
 * at a time, and once more on the way out if a change is still waiting.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

export type SaveStatus = 'saved' | 'pending' | 'saving' | 'error';

interface Options<R> {
  delay?: number;
  enabled?: boolean;
  onSaved?: (result: R) => void;
}

export function useAutosave<T, R>(value: T, save: (value: T) => Promise<R>, options: Options<R> = {}) {
  const { delay = 1000, enabled = true } = options;
  const [status, setStatus] = useState<SaveStatus>('saved');
  const lastSaved = useRef<T>(value);
  const latest = useRef<T>(value);
  const inFlight = useRef<Promise<void> | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveRef = useRef(save);
  const onSavedRef = useRef(options.onSaved);
  saveRef.current = save;
  onSavedRef.current = options.onSaved;
  latest.current = value;

  const saveNow = useCallback(async (): Promise<void> => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    if (inFlight.current) await inFlight.current;
    const toSave = latest.current;
    if (toSave === lastSaved.current) {
      setStatus('saved');
      return;
    }
    setStatus('saving');
    const run = saveRef.current(toSave)
      .then((result) => {
        lastSaved.current = toSave;
        onSavedRef.current?.(result);
        setStatus(latest.current === toSave ? 'saved' : 'pending');
      })
      .catch(() => setStatus('error'));
    inFlight.current = run;
    await run;
    inFlight.current = null;
    if (latest.current !== lastSaved.current && latest.current !== toSave) await saveNow();
  }, []);

  useEffect(() => {
    if (!enabled || value === lastSaved.current) return;
    setStatus('pending');
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      void saveNow();
    }, delay);
  }, [value, enabled, delay, saveNow]);

  // A change still waiting when this closes is saved; leaving the page with one asks first
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
      if (latest.current !== lastSaved.current) void saveNow();
    };
  }, [saveNow]);

  return { status, saveNow };
}
