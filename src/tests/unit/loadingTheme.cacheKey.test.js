import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BRAND_PRESET } from '@/lib/brandPalette';

// The loading screen reads what loadVisualSettings writes: lock the two ends together.
const row = { settings: { ...BRAND_PRESET } };
vi.mock('@/lib/supabase', () => ({
  withTimeout: (promise) => promise,
  supabase: { from: () => ({ select: () => ({ limit: () => ({ single: async () => ({ data: row, error: null }) }) }) }) },
}));

import { loadVisualSettings } from '@/lib/businessVisualSettingsService';
import { readStoredVisualSettings, buildLoadingTheme } from '@/lib/loadingTheme';
import { LOCAL_CACHE_KEY } from '@/lib/constants';

describe('loading screen and loadVisualSettings share the cache', () => {
  beforeEach(() => localStorage.clear());

  it('uses the key declared in constants and finds what the service cached', async () => {
    expect(localStorage.getItem(LOCAL_CACHE_KEY)).toBeNull();
    await loadVisualSettings();
    expect(localStorage.getItem(LOCAL_CACHE_KEY)).not.toBeNull();
    expect(readStoredVisualSettings()).toMatchObject(row.settings);
    expect(buildLoadingTheme(readStoredVisualSettings())['--ld-bg']).toBe(BRAND_PRESET.pageBgColor);
  });
});
