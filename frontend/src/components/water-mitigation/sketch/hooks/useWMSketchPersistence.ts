/**
 * useWMSketchPersistence
 *
 * Handles manual and optional auto-save for WM floor sketch overlay data.
 * Calls wmSketchService.saveOverlayData() and surfaces saving state,
 * last-saved timestamp, and any error that occurred.
 *
 * Auto-save is opt-in: pass autoSaveInterval (ms) > 0 to enable it.
 * The interval timer only runs when isDirty === true and floorSketchId is set.
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import type { WMOverlayData } from '../../../../types/wmSketch';
import wmSketchService from '../../../../services/wmSketchService';

// ============================================================================
// Types
// ============================================================================

export interface UseWMSketchPersistenceOptions {
  /** ID of the floor sketch to save to. When null, save() is a no-op. */
  floorSketchId: string | null;
  /** Current overlay data to persist */
  overlayData: WMOverlayData;
  /** True when there are unsaved local changes */
  isDirty: boolean;
  /** Called after a successful save so the caller can clear the dirty flag */
  onSaved: () => void;
  /**
   * When > 0, the hook auto-saves every `autoSaveInterval` milliseconds
   * while isDirty is true. Defaults to 0 (disabled).
   */
  autoSaveInterval?: number;
  /**
   * @deprecated Canvas dimensions are now fixed per floor sketch and should
   * not be overwritten with viewport size. This field is ignored.
   */
  canvasSize?: { width: number; height: number } | null;
}

export interface UseWMSketchPersistenceReturn {
  /** Trigger a manual save immediately */
  save: () => Promise<void>;
  /** True while a save request is in-flight */
  isSaving: boolean;
  /** Timestamp of the last successful save, or null */
  lastSavedAt: Date | null;
  /** Error message from the most recent failed save, or null */
  saveError: string | null;
}

// ============================================================================
// Hook
// ============================================================================

export function useWMSketchPersistence({
  floorSketchId,
  overlayData,
  isDirty,
  onSaved,
  autoSaveInterval = 0,
  canvasSize,
}: UseWMSketchPersistenceOptions): UseWMSketchPersistenceReturn {
  const [isSaving, setIsSaving] = useState(false);
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Use a ref to hold the latest overlayData so the auto-save timer always
  // reads the current value without being recreated on every render.
  const overlayDataRef = useRef<WMOverlayData>(overlayData);
  overlayDataRef.current = overlayData;

  const isDirtyRef = useRef<boolean>(isDirty);
  isDirtyRef.current = isDirty;

  // Guard against concurrent save calls.
  const isSavingRef = useRef(false);

  // ------------------------------------------------------------------
  // Core save logic
  // ------------------------------------------------------------------
  const save = useCallback(async (): Promise<void> => {
    if (!floorSketchId) return;
    if (isSavingRef.current) return;

    isSavingRef.current = true;
    setIsSaving(true);
    setSaveError(null);

    try {
      await wmSketchService.saveOverlayData(
        floorSketchId,
        overlayDataRef.current
      );
      // NOTE: canvas_width/canvas_height are fixed per floor sketch (set at
      // creation time) and should NOT be overwritten with the viewport size.
      setLastSavedAt(new Date());
      onSaved();
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : 'Failed to save sketch data.';
      setSaveError(message);
    } finally {
      isSavingRef.current = false;
      setIsSaving(false);
    }
  }, [floorSketchId, onSaved]);

  // ------------------------------------------------------------------
  // Auto-save timer
  // ------------------------------------------------------------------
  useEffect(() => {
    if (autoSaveInterval <= 0 || !floorSketchId) return;

    const timerId = setInterval(() => {
      if (isDirtyRef.current && !isSavingRef.current) {
        save();
      }
    }, autoSaveInterval);

    return () => {
      clearInterval(timerId);
    };
  }, [autoSaveInterval, floorSketchId, save]);

  // ------------------------------------------------------------------
  // Save on tab switch / window blur / unmount to prevent data loss
  // ------------------------------------------------------------------
  const saveRef = useRef(save);
  saveRef.current = save;
  const floorSketchIdRef = useRef(floorSketchId);
  floorSketchIdRef.current = floorSketchId;

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.hidden && isDirtyRef.current && floorSketchIdRef.current) {
        saveRef.current();
      }
    };
    const handleBeforeUnload = () => {
      if (isDirtyRef.current && floorSketchIdRef.current) {
        saveRef.current();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('beforeunload', handleBeforeUnload);
      // Save on unmount (e.g. switching tabs within the app)
      if (isDirtyRef.current && floorSketchIdRef.current) {
        saveRef.current();
      }
    };
  }, []);

  return {
    save,
    isSaving,
    lastSavedAt,
    saveError,
  };
}
