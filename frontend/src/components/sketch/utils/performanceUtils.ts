/**
 * Performance Utilities for Sketch Components
 * Provides throttling and optimization helpers
 */

import { useRef, useCallback } from 'react';

/**
 * Throttle hook for drag events
 * Limits callback execution to ~60 FPS (16ms intervals)
 */
export const useThrottle = <T extends (...args: any[]) => void>(
  callback: T,
  delay: number = 16
): T => {
  const lastTimeRef = useRef(0);

  return useCallback((...args: Parameters<T>) => {
    const now = Date.now();
    if (now - lastTimeRef.current >= delay) {
      lastTimeRef.current = now;
      callback(...args);
    }
  }, [callback, delay]) as T;
};