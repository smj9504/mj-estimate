import { useCallback, useRef } from 'react';

/**
 * Screen Wake Lock wrapper for long-running foreground work (e.g. multi-photo
 * upload loops). Without this, mobile browsers throttle or suspend JS timers
 * and in-flight requests once the screen turns off, making an upload loop
 * appear to "hang" even though the server is still up.
 *
 * Silently no-ops where the API is unsupported (desktop browsers, older
 * mobile browsers) - callers don't need to feature-detect themselves.
 */
export function useWakeLock() {
  const wakeLockRef = useRef<any>(null);

  const requestWakeLock = useCallback(async () => {
    try {
      if ('wakeLock' in navigator) {
        wakeLockRef.current = await (navigator as any).wakeLock.request('screen');
      }
    } catch {
      // Wake Lock not supported or request failed (e.g. tab not visible) - ignore
    }
  }, []);

  const releaseWakeLock = useCallback(() => {
    if (wakeLockRef.current) {
      wakeLockRef.current.release();
      wakeLockRef.current = null;
    }
  }, []);

  return { requestWakeLock, releaseWakeLock };
}
