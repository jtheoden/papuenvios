/**
 * In-memory stale-while-revalidate cache for the public catalog rows
 * (products, categories, combos, carousel).
 *
 * - Module level, never persisted (no localStorage).
 * - Stock is NOT cached as truth: callers fetch inventory separately.
 * - Writers must call invalidateCatalog() (or wrap with withCatalogInvalidation).
 */

export const CATALOG_TTL_MS = 60 * 1000;

let now = () => Date.now();
let generation = 0;
const entries = new Map(); // key -> { data, storedAt }
const inflight = new Map(); // key -> Promise

// Test hook: inject a clock.
export const __setNow = (fn) => {
  now = fn;
};

const runFetch = (key, fetcher) => {
  const existing = inflight.get(key);
  if (existing) return existing;

  const startedAt = generation;
  const promise = (async () => {
    try {
      const data = await fetcher();
      // An invalidation that happened while fetching makes this result stale.
      if (startedAt === generation) {
        entries.set(key, { data, storedAt: now() });
      }
      return data;
    } finally {
      if (inflight.get(key) === promise) inflight.delete(key);
    }
  })();
  inflight.set(key, promise);
  return promise;
};

/**
 * Load `key` through the cache.
 * - fresh entry: returned as-is.
 * - stale entry: returned immediately, revalidated in background (onUpdate gets the new data).
 * - no entry or `force`: awaits the fetcher.
 * @returns {Promise<{data: *, fromCache: boolean}>}
 */
export const loadCached = async (key, fetcher, { force = false, onUpdate } = {}) => {
  const entry = entries.get(key);

  if (!force && entry) {
    const age = now() - entry.storedAt;
    if (age >= CATALOG_TTL_MS) {
      runFetch(key, fetcher)
        .then((data) => {
          if (onUpdate) onUpdate(data);
        })
        .catch(() => {
          // Background revalidation failures keep serving the stale entry.
        });
    }
    return { data: entry.data, fromCache: true };
  }

  const data = await runFetch(key, fetcher);
  return { data, fromCache: false };
};

export const invalidateCatalog = () => {
  generation += 1;
  entries.clear();
  inflight.clear();
};

export const clearCatalogCache = invalidateCatalog;

/** Wrap a mutation so the cache is dropped once it settles (success or failure). */
export const withCatalogInvalidation = (fn) => async (...args) => {
  try {
    return await fn(...args);
  } finally {
    invalidateCatalog();
  }
};
