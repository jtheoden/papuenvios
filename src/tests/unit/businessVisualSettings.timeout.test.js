import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { LOCAL_CACHE_KEY } from '@/lib/constants';

// A hung settings query must not block startup: loadVisualSettings gives up after VISUAL_SETTINGS_TIMEOUT_MS
// and returns the last cached settings (even if stale) or the defaults. The real withTimeout is used.

vi.hoisted(() => {
  vi.stubEnv('VITE_SUPABASE_URL', 'http://127.0.0.1:1');
  vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'unit-test-anon');
});

const singleMock = vi.fn();
vi.mock('@/lib/supabase', async (importOriginal) => ({
  ...(await importOriginal()),
  supabase: { from: () => ({ select: () => ({ limit: () => ({ single: singleMock }) }) }) },
}));

import {
  DEFAULT_VISUAL_SETTINGS,
  VISUAL_SETTINGS_TIMEOUT_MS,
  loadVisualSettings,
  applyVisualSettingsToDOM,
} from '@/lib/businessVisualSettingsService';
import { BRAND_PRESET } from '@/lib/brandPalette';

const settle = async (promise) => {
  let value;
  let done = false;
  promise.then((v) => { value = v; done = true; });
  return { get value() { return value; }, get done() { return done; } };
};

describe('loadVisualSettings timeout', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    localStorage.clear();
    singleMock.mockReset();
    singleMock.mockReturnValue(new Promise(() => {})); // never resolves
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('caps the wait at a few seconds', () => {
    expect(VISUAL_SETTINGS_TIMEOUT_MS).toBeGreaterThanOrEqual(3000);
    expect(VISUAL_SETTINGS_TIMEOUT_MS).toBeLessThanOrEqual(4000);
  });

  it('returns the defaults when the query never resolves and nothing is cached', async () => {
    const result = await settle(loadVisualSettings());
    await vi.advanceTimersByTimeAsync(VISUAL_SETTINGS_TIMEOUT_MS - 1);
    expect(result.done).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(result.done).toBe(true);
    expect(result.value).toEqual(DEFAULT_VISUAL_SETTINGS);
  });

  it('returns the last cached settings (even past their TTL) when the query never resolves', async () => {
    localStorage.setItem(LOCAL_CACHE_KEY, JSON.stringify({ data: { primaryColor: '#123456' }, timestamp: Date.now() - 3600_000 }));
    const result = await settle(loadVisualSettings());
    await vi.advanceTimersByTimeAsync(VISUAL_SETTINGS_TIMEOUT_MS);
    expect(result.value).toEqual({ ...DEFAULT_VISUAL_SETTINGS, primaryColor: '#123456' });
  });

  // T0: a timed-out load is a failed load, so the unverified defaults must not pick the look.
  it('a timeout with nothing cached leaves data-theme as the first paint set it', async () => {
    document.documentElement.dataset.theme = 'papuenvios';
    const result = await settle(loadVisualSettings());
    await vi.advanceTimersByTimeAsync(VISUAL_SETTINGS_TIMEOUT_MS);
    applyVisualSettingsToDOM(result.value);
    expect(document.documentElement.dataset.theme).toBe('papuenvios');
  });

  it('a timeout with a stale brand cache keeps the brand look', async () => {
    document.documentElement.dataset.theme = 'classic';
    localStorage.setItem(LOCAL_CACHE_KEY, JSON.stringify({ data: { ...BRAND_PRESET }, timestamp: 0 }));
    const result = await settle(loadVisualSettings());
    await vi.advanceTimersByTimeAsync(VISUAL_SETTINGS_TIMEOUT_MS);
    applyVisualSettingsToDOM(result.value);
    expect(document.documentElement.dataset.theme).toBe('papuenvios');
  });
});
