import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const state = vi.hoisted(() => ({ row: null, update: null }));
vi.mock('@/lib/supabase', () => ({
  withTimeout: (promise) => promise,
  supabase: {
    from: () => ({
      select: () => ({ limit: () => ({ single: async () => ({ data: state.row, error: null }) }) }),
      update: (payload) => {
        state.update = payload;
        return { eq: async () => ({ error: null }) };
      },
    }),
  },
}));

import {
  showNameWithLogo,
  normalizeBrandingSettings,
  getLoaderConfig,
  readableTextOn,
  safeLogoSrc,
} from '@/lib/brandingDisplay';
import { loadVisualSettings, saveVisualSettings } from '@/lib/businessVisualSettingsService';

const PNG = 'data:image/png;base64,iVBORw0KGgo=';
const WEBP = 'data:image/webp;base64,UklGRg==';

describe('showNameWithLogo', () => {
  it.each([
    [undefined, true],
    [{}, true],
    [{ showCompanyNameWithLogo: true }, true],
    [{ showCompanyNameWithLogo: undefined }, true],
    [{ showCompanyNameWithLogo: 'false' }, true],
    [{ showCompanyNameWithLogo: null }, true],
    [{ showCompanyNameWithLogo: false }, false],
  ])('%j -> %s (only a real false hides it: absent data keeps today\'s behaviour)', (settings, expected) => {
    expect(showNameWithLogo(settings)).toBe(expected);
  });
});

describe('normalizeBrandingSettings', () => {
  it('leaves settings without any of the new keys exactly as they are', () => {
    const row = { companyName: 'Acme', logo: PNG };
    expect(normalizeBrandingSettings(row)).toEqual(row);
    expect(Object.keys(normalizeBrandingSettings(row))).toEqual(['companyName', 'logo']);
  });

  it('coerces showCompanyNameWithLogo to a boolean: only false stays false', () => {
    expect(normalizeBrandingSettings({ showCompanyNameWithLogo: false }).showCompanyNameWithLogo).toBe(false);
    expect(normalizeBrandingSettings({ showCompanyNameWithLogo: 'no' }).showCompanyNameWithLogo).toBe(true);
    expect(normalizeBrandingSettings({ showCompanyNameWithLogo: 0 }).showCompanyNameWithLogo).toBe(true);
  });

  it.each([
    ['#1a2B3c', '#1a2B3c'],
    ['#fff', '#fff'],
    ['red', ''],
    ['#12345', ''],
    ['#12345g', ''],
    ['url(javascript:x)', ''],
    ['#fff; background:url(x)', ''],
    [42, ''],
    [null, ''],
  ])('loaderBgColor %j -> %j', (input, expected) => {
    expect(normalizeBrandingSettings({ loaderBgColor: input }).loaderBgColor).toBe(expected);
  });

  it.each([
    [PNG, PNG],
    ['javascript:alert(1)', ''],
    ['data:text/html;base64,PHNjcmlwdD4=', ''],
    ['http://insecure.example.com/x.png', ''],
    [{}, ''],
  ])('loaderImage %j -> %j', (input, expected) => {
    expect(normalizeBrandingSettings({ loaderImage: input }).loaderImage).toBe(expected);
  });

  it('does not mutate its input and tolerates non-objects', () => {
    const row = Object.freeze({ loaderBgColor: 'nope' });
    expect(() => normalizeBrandingSettings(row)).not.toThrow();
    expect(normalizeBrandingSettings(null)).toEqual({});
    expect(normalizeBrandingSettings(undefined)).toEqual({});
  });
});

describe('getLoaderConfig', () => {
  it('prefers the loader image, then the site logo, then nothing (wordmark)', () => {
    expect(getLoaderConfig({ loaderImage: WEBP, logo: PNG }).image).toBe(WEBP);
    expect(getLoaderConfig({ logo: PNG }).image).toBe(PNG);
    expect(getLoaderConfig({ loaderImage: 'javascript:x', logo: PNG }).image).toBe(PNG);
    expect(getLoaderConfig({}).image).toBe('');
    expect(getLoaderConfig(null).image).toBe('');
  });

  it('only returns a background that is a strict hex colour; unset means "use the theme tokens"', () => {
    expect(getLoaderConfig({ loaderBgColor: '#123456' }).bgColor).toBe('#123456');
    expect(getLoaderConfig({ loaderBgColor: 'blue' }).bgColor).toBe('');
    expect(getLoaderConfig({}).bgColor).toBe('');
  });
});

describe('readableTextOn', () => {
  it('picks white on dark backgrounds and charcoal on light ones', () => {
    expect(readableTextOn('#000000')).toBe('#ffffff');
    expect(readableTextOn('#25306b')).toBe('#ffffff');
    expect(readableTextOn('#ffffff')).toBe('#171717');
    expect(readableTextOn('#FFA500')).toBe('#171717');
    expect(readableTextOn('#fff')).toBe('#171717');
  });
});

describe('safeLogoSrc is shared with BrandLogo', () => {
  it('accepts image data URLs and https only', () => {
    expect(safeLogoSrc(PNG)).toBe(PNG);
    expect(safeLogoSrc('javascript:alert(1)')).toBe('');
  });
});

describe('visual settings service normalizes the new keys', () => {
  beforeEach(() => {
    localStorage.clear();
    state.update = null;
  });

  it('on load: an old row without the keys is unchanged, a dirty row is cleaned', async () => {
    state.row = { settings: { companyName: 'Acme' } };
    const clean = await loadVisualSettings();
    expect(clean.companyName).toBe('Acme');
    expect('showCompanyNameWithLogo' in clean).toBe(false);
    expect('loaderBgColor' in clean).toBe(false);

    localStorage.clear();
    state.row = { settings: { loaderBgColor: 'red', loaderImage: 'javascript:x', showCompanyNameWithLogo: false } };
    const dirty = await loadVisualSettings();
    expect(dirty.loaderBgColor).toBe('');
    expect(dirty.loaderImage).toBe('');
    expect(dirty.showCompanyNameWithLogo).toBe(false);
  });

  it('on save: invalid values never reach the database or the cache', async () => {
    state.row = { id: 1 };
    const result = await saveVisualSettings({ companyName: 'Acme', loaderBgColor: 'red;x', loaderImage: 'javascript:x', showCompanyNameWithLogo: 'maybe' });
    expect(result.success).toBe(true);
    expect(state.update.settings).toMatchObject({ companyName: 'Acme', loaderBgColor: '', loaderImage: '', showCompanyNameWithLogo: true });
    const cached = JSON.parse(localStorage.getItem('business_visual_settings_cache')).data;
    expect(cached.loaderBgColor).toBe('');
  });
});

describe('cache write under storage quota (fail-open)', () => {
  const realSetItem = Storage.prototype.setItem;
  const BIG = `data:image/png;base64,${'A'.repeat(4096)}`;
  let setItem;

  beforeEach(() => {
    localStorage.clear();
    state.row = { settings: { companyName: 'Acme', logo: BIG, loaderImage: BIG, loaderBgColor: '#123456' } };
    setItem = vi.spyOn(Storage.prototype, 'setItem');
  });
  afterEach(() => setItem.mockRestore());

  it('retries once without the base64 fields when the first write throws, so the cache never stays stale', async () => {
    setItem.mockImplementation(function (key, value) {
      if (value.includes('data:image')) throw new DOMException('quota', 'QuotaExceededError');
      return realSetItem.call(this, key, value);
    });
    const loaded = await loadVisualSettings();
    expect(loaded.logo).toBe(BIG); // the app still gets the full settings
    const cached = JSON.parse(localStorage.getItem('business_visual_settings_cache')).data;
    expect(cached).toMatchObject({ companyName: 'Acme', loaderBgColor: '#123456' });
    expect('logo' in cached).toBe(false);
    expect('loaderImage' in cached).toBe(false);
    expect(setItem).toHaveBeenCalledTimes(2);
  });

  it('never throws and drops a stale entry when even the retry fails', async () => {
    localStorage.setItem('business_visual_settings_cache', JSON.stringify({ data: { companyName: 'OLD' }, timestamp: 0 }));
    setItem.mockImplementation(() => { throw new DOMException('quota', 'QuotaExceededError'); });
    await expect(loadVisualSettings()).resolves.toMatchObject({ companyName: 'Acme' });
    expect(localStorage.getItem('business_visual_settings_cache')).toBeNull();
  });

  it('a loader image above the 2 MB upload limit (as base64) is dropped by the normalizer', () => {
    const huge = `data:image/png;base64,${'A'.repeat(2_900_000)}`;
    expect(normalizeBrandingSettings({ loaderImage: huge }).loaderImage).toBe('');
    expect(normalizeBrandingSettings({ loaderImage: BIG }).loaderImage).toBe(BIG);
  });
});
