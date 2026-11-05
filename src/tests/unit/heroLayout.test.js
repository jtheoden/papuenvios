import { describe, it, expect, vi, beforeEach } from 'vitest';

const singleMock = vi.fn();
vi.mock('@/lib/supabase', () => ({
  supabase: { from: () => ({ select: () => ({ limit: () => ({ single: singleMock }) }) }) },
  withTimeout: (promise) => promise,
}));

import { resolveHeroLayout, HERO_LAYOUTS, DEFAULT_HERO_LAYOUT } from '@/lib/heroLayout';
import { DEFAULT_VISUAL_SETTINGS, loadVisualSettings } from '@/lib/businessVisualSettingsService';
import { BRAND_PRESET } from '@/lib/brandPalette';
import { LOCAL_CACHE_KEY } from '@/lib/constants';
import { restoreThemeDefaults, selectTheme } from '@/lib/visualThemes';

// Spec (hero layout S1): a closed enumeration. Anything that is not exactly 'cover' or 'spaced' resolves to
// 'spaced' (what production shows today), and the stored value is never echoed back.
describe('resolveHeroLayout', () => {
  it('is a closed enumeration whose default is spaced', () => {
    expect(HERO_LAYOUTS).toEqual(['cover', 'spaced']);
    expect(DEFAULT_HERO_LAYOUT).toBe('spaced');
  });

  it.each(['cover', 'spaced'])('accepts %s', (layout) => {
    expect(resolveHeroLayout({ heroLayout: layout })).toBe(layout);
  });

  it.each([
    ['missing key', {}],
    ['undefined', { heroLayout: undefined }],
    ['null', { heroLayout: null }],
    ['number', { heroLayout: 1 }],
    ['boolean', { heroLayout: true }],
    ['object with toString', { heroLayout: { toString: () => 'cover' } }],
    ['array', { heroLayout: ['cover'] }],
    ['empty string', { heroLayout: '' }],
    ['the old name of cover (renamed to avoid confusion with activeTheme classic)', { heroLayout: 'classic' }],
    ['uppercase', { heroLayout: 'SPACED' }],
    ['padded', { heroLayout: ' cover ' }],
    ['markup', { heroLayout: '<script>alert(1)</script>' }],
    ['prototype key', { heroLayout: '__proto__' }],
  ])('falls back to spaced for %s', (_label, settings) => {
    expect(resolveHeroLayout(settings)).toBe('spaced');
  });

  it('survives a missing or non-object settings value', () => {
    expect(resolveHeroLayout()).toBe('spaced');
    expect(resolveHeroLayout(null)).toBe('spaced');
    expect(resolveHeroLayout('cover')).toBe('spaced');
  });
});

// heroLayout is an opt-in choice of the super admin. It must NOT be a default: every setVisualSettings / save /
// "restablecer" spreads DEFAULT_VISUAL_SETTINGS, so a default would be written to the row (and overwrite a stored
// 'cover'). The absence of the key already resolves to 'spaced'.
describe('heroLayout in the visual settings', () => {
  beforeEach(() => {
    localStorage.clear();
    singleMock.mockReset();
  });

  it('is not a default of the settings, so nothing that spreads the defaults can persist it', () => {
    expect(DEFAULT_VISUAL_SETTINGS).not.toHaveProperty('heroLayout');
    expect({ ...DEFAULT_VISUAL_SETTINGS }).not.toHaveProperty('heroLayout');
  });

  it('is not part of the brand preset: applying the palette must not touch it', () => {
    expect(BRAND_PRESET).not.toHaveProperty('heroLayout');
  });

  it('a production row without the key loads without it and resolves to spaced', async () => {
    singleMock.mockResolvedValue({ data: { settings: { primaryColor: '#3499dc', useGradient: true } }, error: null });
    const settings = await loadVisualSettings();
    expect(settings).not.toHaveProperty('heroLayout');
    expect(resolveHeroLayout(settings)).toBe('spaced');
    // what the app caches (and later saves back) does not carry it either
    const cached = localStorage.getItem(LOCAL_CACHE_KEY);
    expect(cached).toContain('primaryColor'); // the cache really was written
    expect(cached).not.toContain('heroLayout');
  });

  it('a stored choice survives the merge with the defaults', async () => {
    singleMock.mockResolvedValue({ data: { settings: { heroLayout: 'cover' } }, error: null });
    expect(resolveHeroLayout(await loadVisualSettings())).toBe('cover');
  });

  it('with no row at all the defaults resolve to spaced', async () => {
    singleMock.mockResolvedValue({ data: null, error: { code: 'PGRST116' } });
    expect(resolveHeroLayout(await loadVisualSettings())).toBe('spaced');
  });

  it('"Restore theme" keeps the stored choice: it only resets keys that are defaults', () => {
    expect(restoreThemeDefaults({ heroLayout: 'cover' }).heroLayout).toBe('cover');
    expect(restoreThemeDefaults({ heroLayout: 'cover' })).toMatchObject({ activeTheme: 'classic' });
    expect(restoreThemeDefaults({})).not.toHaveProperty('heroLayout');
  });

  it('switching theme keeps the stored choice too', () => {
    expect(selectTheme({ ...DEFAULT_VISUAL_SETTINGS, heroLayout: 'cover' }, 'papuenvios').heroLayout).toBe('cover');
  });
});
