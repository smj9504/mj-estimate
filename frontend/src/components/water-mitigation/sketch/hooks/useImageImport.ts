/**
 * useImageImport
 *
 * Provides two image-import paths:
 *   1. File picker — triggered programmatically via a hidden <input> ref.
 *   2. Clipboard paste — listens for paste events on the document.
 *
 * Both paths call the `onImageImported` callback with the raw File and a
 * temporary object URL that is safe to set as an <img> src or canvas source.
 * The object URL is automatically revoked on unmount to avoid memory leaks.
 */

import { useRef, useState, useEffect, useCallback } from 'react';

// ============================================================================
// Types
// ============================================================================

export interface UseImageImportOptions {
  /** Called whenever the user selects or pastes a new image */
  onImageImported: (file: File, objectUrl: string) => void;
  /**
   * When false the paste listener is not attached even if
   * startPasteListening() is called. Useful for disabling the feature when
   * the canvas is not focused / visible. Defaults to true.
   */
  enabled?: boolean;
}

export interface UseImageImportReturn {
  /** Attach to a hidden <input type="file" accept="image/*" ref={fileInputRef}> */
  fileInputRef: React.RefObject<HTMLInputElement>;
  /** Programmatically open the OS file picker */
  openFilePicker: () => void;
  /** Register the document-level paste listener */
  startPasteListening: () => void;
  /** Unregister the document-level paste listener */
  stopPasteListening: () => void;
  /** Temporary object URL of the most recently imported image, or null */
  importedImageUrl: string | null;
  /** True while the caller is uploading the file to the server */
  isUploading: boolean;
  /** Error message, or null when there is none */
  error: string | null;
  /** Handler to pass to <input onChange={handleFileSelected}> */
  handleFileSelected: (e: React.ChangeEvent<HTMLInputElement>) => void;
  /** Revoke the current object URL and reset importedImageUrl to null */
  clearImage: () => void;
}

// ============================================================================
// Hook
// ============================================================================

export function useImageImport({
  onImageImported,
  enabled = true,
}: UseImageImportOptions): UseImageImportReturn {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [importedImageUrl, setImportedImageUrl] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Track whether the paste listener is currently active so we can toggle it.
  const isPasteListeningRef = useRef(false);

  // Keep a ref to the current object URL so we can revoke it before creating
  // a new one, and again on unmount.
  const currentObjectUrlRef = useRef<string | null>(null);

  // ------------------------------------------------------------------
  // Internal: process a File into an object URL and notify the caller
  // ------------------------------------------------------------------
  const processFile = useCallback(
    (file: File) => {
      if (!file.type.startsWith('image/')) {
        setError('Selected file is not an image.');
        return;
      }

      // Revoke any previously created URL before creating a new one.
      if (currentObjectUrlRef.current) {
        URL.revokeObjectURL(currentObjectUrlRef.current);
      }

      const objectUrl = URL.createObjectURL(file);
      currentObjectUrlRef.current = objectUrl;

      setImportedImageUrl(objectUrl);
      setError(null);

      // Signal the caller — they are responsible for uploading and
      // calling setIsUploading / clearing if needed.
      onImageImported(file, objectUrl);
    },
    [onImageImported]
  );

  // ------------------------------------------------------------------
  // File picker
  // ------------------------------------------------------------------
  const openFilePicker = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleFileSelected = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;

      processFile(file);

      // Reset the input value so the same file can be re-selected later.
      e.target.value = '';
    },
    [processFile]
  );

  // ------------------------------------------------------------------
  // Clipboard paste
  // ------------------------------------------------------------------
  const handlePaste = useCallback(
    (e: ClipboardEvent) => {
      if (!enabled) return;

      const items = e.clipboardData?.items;
      if (!items) return;

      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (item.type.startsWith('image/')) {
          const file = item.getAsFile();
          if (file) {
            processFile(file);
            // Consume the first image only.
            break;
          }
        }
      }
    },
    [enabled, processFile]
  );

  const startPasteListening = useCallback(() => {
    if (!enabled || isPasteListeningRef.current) return;
    document.addEventListener('paste', handlePaste);
    isPasteListeningRef.current = true;
  }, [enabled, handlePaste]);

  const stopPasteListening = useCallback(() => {
    if (!isPasteListeningRef.current) return;
    document.removeEventListener('paste', handlePaste);
    isPasteListeningRef.current = false;
  }, [handlePaste]);

  // ------------------------------------------------------------------
  // Cleanup paste listener when handlePaste changes
  // ------------------------------------------------------------------
  const prevHandlePasteRef = useRef<((e: ClipboardEvent) => void) | null>(null);
  useEffect(() => {
    // If the paste handler identity changed and we were listening, swap it.
    if (
      isPasteListeningRef.current &&
      prevHandlePasteRef.current &&
      prevHandlePasteRef.current !== handlePaste
    ) {
      document.removeEventListener('paste', prevHandlePasteRef.current);
      document.addEventListener('paste', handlePaste);
    }
    prevHandlePasteRef.current = handlePaste;
  }, [handlePaste]);

  // ------------------------------------------------------------------
  // Cleanup on unmount only (blob URL + paste listener)
  // ------------------------------------------------------------------
  useEffect(() => {
    return () => {
      // Remove paste listener if it's still attached.
      if (isPasteListeningRef.current) {
        // Use the latest ref since the callback identity may have changed
        if (prevHandlePasteRef.current) {
          document.removeEventListener('paste', prevHandlePasteRef.current);
        }
      }
      // Revoke the object URL to free browser memory.
      if (currentObjectUrlRef.current) {
        URL.revokeObjectURL(currentObjectUrlRef.current);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ------------------------------------------------------------------
  // Clear
  // ------------------------------------------------------------------
  const clearImage = useCallback(() => {
    if (currentObjectUrlRef.current) {
      URL.revokeObjectURL(currentObjectUrlRef.current);
      currentObjectUrlRef.current = null;
    }
    setImportedImageUrl(null);
    setError(null);
  }, []);

  return {
    fileInputRef,
    openFilePicker,
    startPasteListening,
    stopPasteListening,
    importedImageUrl,
    isUploading,
    error,
    handleFileSelected,
    clearImage,
  };
}
