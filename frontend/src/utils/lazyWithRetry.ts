import { lazy, ComponentType } from 'react';

/**
 * Wrapper around React.lazy that retries chunk loading on failure.
 * When a new deployment happens (e.g., on Vercel), old chunk files are replaced.
 * Users with cached HTML still reference old chunk filenames, causing ChunkLoadError.
 * This utility retries the import and, if it still fails, reloads the page once.
 */
export function lazyWithRetry<T extends ComponentType<any>>(
  importFn: () => Promise<{ default: T }>
) {
  return lazy(() =>
    importFn().then((module) => {
      // Chunk loaded successfully — clear any previous reload flag
      sessionStorage.removeItem('chunk_reload');
      return module;
    }).catch((error: Error) => {
      // Check if we already tried reloading to avoid infinite reload loops
      const hasReloaded = sessionStorage.getItem('chunk_reload');

      if (!hasReloaded) {
        sessionStorage.setItem('chunk_reload', '1');
        window.location.reload();
        // Return a never-resolving promise to prevent rendering during reload
        return new Promise<{ default: T }>(() => {});
      }

      // Already reloaded once — clear flag and throw so ErrorBoundary catches it
      sessionStorage.removeItem('chunk_reload');
      throw error;
    })
  );
}
