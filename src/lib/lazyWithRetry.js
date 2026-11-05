import { lazy } from 'react';

export const RELOAD_KEY = 'chunk-reload-at';
export const RELOAD_WINDOW_MS = 10000;

const STALE_CHUNK_PATTERN =
  /dynamically imported module|Importing a module script failed|Loading chunk .* failed|ChunkLoadError/i;

/** True when the error means the browser asked for a chunk that no longer exists (new deploy). */
export const isStaleChunkError = (error) =>
  Boolean(error) && (error.name === 'ChunkLoadError' || STALE_CHUNK_PATTERN.test(String(error.message ?? '')));

/**
 * Records the reload attempt and tells whether a reload is allowed.
 * Returns false when we already reloaded inside the window, or when sessionStorage is
 * unavailable (without the guard a reload could loop forever).
 */
const claimReload = () => {
  try {
    const now = Date.now();
    const last = Number(sessionStorage.getItem(RELOAD_KEY));
    if (last && now - last < RELOAD_WINDOW_MS) return false;
    sessionStorage.setItem(RELOAD_KEY, String(now));
    return true;
  } catch {
    return false;
  }
};

/**
 * Runs a dynamic import; on a stale-chunk failure reloads the page once (guarded) and
 * returns a promise that never settles, so Suspense keeps its fallback until the reload.
 * Any other failure, or a second stale failure inside the window, is rethrown to the ErrorBoundary.
 */
export const importWithReload = (factory, reload = () => window.location.reload()) =>
  factory().catch((error) => {
    if (isStaleChunkError(error) && claimReload()) {
      reload();
      return new Promise(() => {});
    }
    throw error;
  });

export const lazyWithRetry = (factory) => lazy(() => importWithReload(factory));
