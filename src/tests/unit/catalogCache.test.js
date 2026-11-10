import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  loadCached,
  invalidateCatalog,
  clearCatalogCache,
  withCatalogInvalidation,
  CATALOG_TTL_MS,
  __setNow
} from '@/lib/catalogCache';

let clock = 1000;

describe('catalogCache', () => {
  beforeEach(() => {
    clock = 1000;
    __setNow(() => clock);
    clearCatalogCache();
  });

  it('fetches on a cold key and returns fresh data', async () => {
    const fetcher = vi.fn(async () => ['a']);
    const result = await loadCached('products', fetcher);
    expect(result).toEqual({ data: ['a'], fromCache: false });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('serves fresh entries without refetching inside the TTL', async () => {
    const fetcher = vi.fn(async () => ['a']);
    await loadCached('products', fetcher);
    clock += CATALOG_TTL_MS - 1;
    const result = await loadCached('products', fetcher);
    expect(result).toEqual({ data: ['a'], fromCache: true });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('returns stale data instantly and revalidates in the background', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(['old']).mockResolvedValueOnce(['new']);
    await loadCached('products', fetcher);
    clock += CATALOG_TTL_MS + 1;

    const onUpdate = vi.fn();
    const result = await loadCached('products', fetcher, { onUpdate });
    expect(result).toEqual({ data: ['old'], fromCache: true });

    await vi.waitFor(() => expect(onUpdate).toHaveBeenCalledWith(['new']));
    const next = await loadCached('products', fetcher);
    expect(next.data).toEqual(['new']);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('dedupes concurrent fetches of the same key', async () => {
    let resolve;
    const fetcher = vi.fn(() => new Promise((r) => { resolve = r; }));
    const p1 = loadCached('products', fetcher);
    const p2 = loadCached('products', fetcher);
    resolve(['a']);
    await Promise.all([p1, p2]);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('force bypasses the cache and refreshes it', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(['a']).mockResolvedValueOnce(['b']);
    await loadCached('products', fetcher);
    const forced = await loadCached('products', fetcher, { force: true });
    expect(forced).toEqual({ data: ['b'], fromCache: false });
    const again = await loadCached('products', fetcher);
    expect(again.data).toEqual(['b']);
  });

  it('invalidateCatalog drops entries so the next load refetches', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(['a']).mockResolvedValueOnce(['b']);
    await loadCached('products', fetcher);
    invalidateCatalog();
    const result = await loadCached('products', fetcher);
    expect(result).toEqual({ data: ['b'], fromCache: false });
  });

  it('an invalidation during an in-flight fetch prevents that stale result from being cached', async () => {
    let resolveFirst;
    const fetcher = vi
      .fn()
      .mockImplementationOnce(() => new Promise((r) => { resolveFirst = r; }))
      .mockResolvedValueOnce(['fresh']);
    const first = loadCached('products', fetcher);
    invalidateCatalog();
    resolveFirst(['stale']);
    await first;
    const next = await loadCached('products', fetcher);
    expect(next.data).toEqual(['fresh']);
  });

  it('does not cache failed fetches', async () => {
    const fetcher = vi.fn().mockRejectedValueOnce(new Error('boom')).mockResolvedValueOnce(['ok']);
    await expect(loadCached('products', fetcher)).rejects.toThrow('boom');
    const result = await loadCached('products', fetcher);
    expect(result.data).toEqual(['ok']);
  });

  it('withCatalogInvalidation invalidates after success and after failure', async () => {
    const fetcher = vi.fn().mockResolvedValue(['a']);
    await loadCached('products', fetcher);
    const okWrite = withCatalogInvalidation(async () => 'done');
    await okWrite();
    await loadCached('products', fetcher);
    expect(fetcher).toHaveBeenCalledTimes(2);

    const badWrite = withCatalogInvalidation(async () => { throw new Error('x'); });
    await expect(badWrite()).rejects.toThrow('x');
    await loadCached('products', fetcher);
    expect(fetcher).toHaveBeenCalledTimes(3);
  });
});
