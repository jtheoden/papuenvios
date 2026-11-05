import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { LOCAL_CACHE_KEY } from '@/lib/constants';
import { BRAND_PRESET } from '@/lib/brandPalette';

// A settings request that FAILS must never flip the look: production stores the brand row (useGradient off), while the
// code defaults are classic (useGradient on). Without this, an outage turned the whole site classic.
const singleMock = vi.fn();
vi.mock('@/lib/supabase', () => ({
  supabase: { from: () => ({ select: () => ({ limit: () => ({ single: singleMock }) }) }) },
}));

const BRAND_ROW = { ...BRAND_PRESET };
const html = () => document.documentElement;
const seedCache = (data, timestamp = 0) => localStorage.setItem(LOCAL_CACHE_KEY, JSON.stringify({ data, timestamp }));

// The service keeps the last good settings in module state: a fresh module per test.
const loadService = async () => {
  vi.resetModules();
  return import('@/lib/businessVisualSettingsService');
};

describe('visual settings load failures keep the look', () => {
  beforeEach(() => {
    localStorage.clear();
    singleMock.mockReset();
    html().removeAttribute('data-theme');
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  it.each([
    ['a PostgREST error', () => singleMock.mockResolvedValue({ data: null, error: { code: '500', message: 'boom' } })],
    ['a thrown request', () => singleMock.mockRejectedValue(new Error('network down'))],
  ])('%s: the expired cache (the TTL is ignored) is used, so the brand row stays the brand look', async (_label, fail) => {
    seedCache(BRAND_ROW, 0); // far outside the 1 minute TTL, like the inline script in index.html ignores it
    fail();
    const { loadVisualSettings, applyVisualSettingsToDOM } = await loadService();
    const settings = await loadVisualSettings();
    expect(settings.useGradient).toBe(false);
    expect(settings.pageBgColor).toBe(BRAND_PRESET.pageBgColor);
    applyVisualSettingsToDOM(settings);
    expect(html().dataset.theme).toBe('papuenvios');
  });

  it('keeps the last good settings of this session when a later load fails', async () => {
    singleMock.mockResolvedValueOnce({ data: { settings: BRAND_ROW }, error: null });
    const { loadVisualSettings, clearVisualSettingsCache } = await loadService();
    expect((await loadVisualSettings()).useGradient).toBe(false);
    clearVisualSettingsCache(); // e.g. refreshVisualSettings()
    singleMock.mockResolvedValueOnce({ data: null, error: { code: '503', message: 'down' } });
    expect((await loadVisualSettings()).useGradient).toBe(false);
  });

  it('with nothing to fall back on it returns the code defaults but leaves data-theme as the first paint set it', async () => {
    html().dataset.theme = 'papuenvios'; // set by the inline script / brand CSS default
    singleMock.mockResolvedValue({ data: null, error: { code: '500', message: 'boom' } });
    const { loadVisualSettings, applyVisualSettingsToDOM, DEFAULT_VISUAL_SETTINGS } = await loadService();
    const settings = await loadVisualSettings();
    expect(settings).toEqual(DEFAULT_VISUAL_SETTINGS);
    applyVisualSettingsToDOM(settings);
    expect(html().dataset.theme).toBe('papuenvios');
  });

  it('a real change after the failure still switches the look (settings saved by an admin)', async () => {
    singleMock.mockResolvedValue({ data: null, error: { code: '500', message: 'boom' } });
    const { loadVisualSettings, applyVisualSettingsToDOM } = await loadService();
    html().dataset.theme = 'papuenvios';
    applyVisualSettingsToDOM(await loadVisualSettings());
    applyVisualSettingsToDOM({ ...BRAND_ROW, useGradient: true });
    expect(html().dataset.theme).toBe('classic');
  });

  it('classic is untouched: a classic cache that fails to refresh stays classic', async () => {
    seedCache({ useGradient: true }, 0);
    singleMock.mockResolvedValue({ data: null, error: { code: '500', message: 'boom' } });
    const { loadVisualSettings, applyVisualSettingsToDOM } = await loadService();
    applyVisualSettingsToDOM(await loadVisualSettings());
    expect(html().dataset.theme).toBe('classic');
  });

  it('a missing row or table still means the code defaults, i.e. the classic look (unchanged)', async () => {
    for (const code of ['PGRST116', '42P01']) {
      singleMock.mockResolvedValue({ data: null, error: { code, message: 'no rows' } });
      const { loadVisualSettings, applyVisualSettingsToDOM } = await loadService();
      html().dataset.theme = 'papuenvios';
      applyVisualSettingsToDOM(await loadVisualSettings());
      expect(html().dataset.theme, code).toBe('classic');
    }
  });
});
