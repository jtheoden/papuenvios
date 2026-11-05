import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { importWithReload, isStaleChunkError, RELOAD_KEY, RELOAD_WINDOW_MS } from '@/lib/lazyWithRetry';

const SIGNATURES = [
  'Failed to fetch dynamically imported module: https://x.app/assets/DashboardPage-abc.js',
  'error loading dynamically imported module: https://x.app/assets/a.js',
  'Importing a module script failed.',
  'Loading chunk 12 failed.',
];

describe('isStaleChunkError', () => {
  it.each(SIGNATURES)('detects "%s"', (message) => {
    expect(isStaleChunkError(new TypeError(message))).toBe(true);
  });

  it('detects ChunkLoadError by name', () => {
    const err = new Error('boom');
    err.name = 'ChunkLoadError';
    expect(isStaleChunkError(err)).toBe(true);
  });

  it('ignores unrelated errors and non-errors', () => {
    expect(isStaleChunkError(new Error('Network down'))).toBe(false);
    expect(isStaleChunkError(null)).toBe(false);
    expect(isStaleChunkError(undefined)).toBe(false);
  });
});

describe('importWithReload', () => {
  let reload;

  beforeEach(() => {
    sessionStorage.clear();
    reload = vi.fn();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('resolves with the module when the import succeeds', async () => {
    const mod = { default: () => null };
    await expect(importWithReload(() => Promise.resolve(mod), reload)).resolves.toBe(mod);
    expect(reload).not.toHaveBeenCalled();
  });

  it.each(SIGNATURES)('reloads once on "%s" and never settles', async (message) => {
    const settled = vi.fn();
    importWithReload(() => Promise.reject(new TypeError(message)), reload).then(settled, settled);
    await vi.advanceTimersByTimeAsync(0);
    expect(reload).toHaveBeenCalledTimes(1);
    expect(settled).not.toHaveBeenCalled();
    expect(sessionStorage.getItem(RELOAD_KEY)).toBe(String(Date.now()));
  });

  it('does not reload a second time inside the window and rethrows', async () => {
    const err = new TypeError(SIGNATURES[0]);
    sessionStorage.setItem(RELOAD_KEY, String(Date.now() - (RELOAD_WINDOW_MS - 1000)));
    await expect(importWithReload(() => Promise.reject(err), reload)).rejects.toBe(err);
    expect(reload).not.toHaveBeenCalled();
  });

  it('reloads again once the window has elapsed', async () => {
    sessionStorage.setItem(RELOAD_KEY, String(Date.now() - RELOAD_WINDOW_MS - 1));
    importWithReload(() => Promise.reject(new TypeError(SIGNATURES[0])), reload).catch(() => {});
    await vi.advanceTimersByTimeAsync(0);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('rethrows other errors without reloading', async () => {
    const err = new Error('Syntax problem');
    await expect(importWithReload(() => Promise.reject(err), reload)).rejects.toBe(err);
    expect(reload).not.toHaveBeenCalled();
  });

  it('does not loop and still rethrows when sessionStorage throws', async () => {
    const err = new TypeError(SIGNATURES[0]);
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('denied');
    });
    await expect(importWithReload(() => Promise.reject(err), reload)).rejects.toBe(err);
    expect(reload).not.toHaveBeenCalled();
  });
});
