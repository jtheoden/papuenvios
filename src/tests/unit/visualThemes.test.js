import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/supabase', () => ({ supabase: { from: vi.fn() } }));

import { DEFAULT_VISUAL_SETTINGS } from '@/lib/businessVisualSettingsService';
import { BRAND_PRESET } from '@/lib/brandPalette';
import {
  THEME_IDS,
  DEFAULT_THEME_ID,
  THEME_PRESETS,
  CONTENT_KEYS,
  resolveThemeId,
  pickThemeKeys,
  selectTheme,
  restoreThemeDefaults,
  getThemeDeviations,
} from '@/lib/visualThemes';
import { CLASSIC_ROW } from '../fixtures/classicVisualRow';

const PRESET_KEYS = Object.keys(BRAND_PRESET);
const classicForm = () => ({ ...DEFAULT_VISUAL_SETTINGS, ...CLASSIC_ROW });
const only = (obj) => Object.fromEntries(PRESET_KEYS.map((k) => [k, obj[k]]));

describe('theme ids and defaults', () => {
  it('offers classic and papuenvios, classic by default', () => {
    expect(THEME_IDS).toEqual(['classic', 'papuenvios']);
    expect(DEFAULT_THEME_ID).toBe('classic');
    // No default for the key on purpose: a stored row without it must be inferred from its values, and a
    // merged default would make every row look explicitly classic.
    expect(DEFAULT_VISUAL_SETTINGS).not.toHaveProperty('activeTheme');
  });

  it('resolves a missing, null or unknown theme from the values: classic rows stay classic', () => {
    for (const s of [undefined, null, {}, CLASSIC_ROW, classicForm(), DEFAULT_VISUAL_SETTINGS, { activeTheme: 'neon' }, { activeTheme: 42 }]) {
      expect(resolveThemeId(s)).toBe('classic');
    }
    expect(resolveThemeId({ activeTheme: 'papuenvios' })).toBe('papuenvios');
  });

  it('infers papuenvios from a row that holds every brand preset value but no activeTheme (real production row)', () => {
    expect(resolveThemeId({ ...classicForm(), ...BRAND_PRESET })).toBe('papuenvios');
    expect(resolveThemeId({ ...BRAND_PRESET })).toBe('papuenvios');
  });

  it('compares the inferred brand values case-insensitively', () => {
    const lower = Object.fromEntries(Object.entries(BRAND_PRESET).map(([k, v]) => [k, typeof v === 'string' ? v.toLowerCase() : v]));
    expect(resolveThemeId({ ...classicForm(), ...lower })).toBe('papuenvios');
  });

  it('one differing or missing preset key is enough to stay classic', () => {
    expect(resolveThemeId({ ...BRAND_PRESET, buttonBgColor: '#123456' })).toBe('classic');
    const { footerBgColor, ...missing } = BRAND_PRESET;
    expect(footerBgColor).toBeDefined();
    expect(resolveThemeId(missing)).toBe('classic');
  });

  it('an explicit valid activeTheme always wins over the values', () => {
    expect(resolveThemeId({ ...BRAND_PRESET, activeTheme: 'classic' })).toBe('classic');
    expect(resolveThemeId({ ...classicForm(), activeTheme: 'papuenvios' })).toBe('papuenvios');
  });

  it('classic preset is exactly the code defaults for the keys the brand preset sets', () => {
    expect(THEME_PRESETS.classic).toEqual(only(DEFAULT_VISUAL_SETTINGS));
    expect(THEME_PRESETS.papuenvios).toBe(BRAND_PRESET);
    expect(THEME_PRESETS.classic.useGradient).toBe(true);
    expect(THEME_PRESETS.papuenvios.useGradient).toBe(false);
  });

  it('classic preset reproduces the production row values for those keys', () => {
    expect(THEME_PRESETS.classic).toEqual(only(classicForm()));
  });
});

describe('pickThemeKeys', () => {
  it('returns the resolved theme and a null snapshot when absent', () => {
    expect(pickThemeKeys(CLASSIC_ROW)).toEqual({ activeTheme: 'classic', classicSnapshot: null });
  });

  it('keeps a stored snapshot object and ignores garbage', () => {
    const snap = { buttonBgColor: '#123456' };
    expect(pickThemeKeys({ activeTheme: 'papuenvios', classicSnapshot: snap })).toEqual({ activeTheme: 'papuenvios', classicSnapshot: snap });
    expect(pickThemeKeys({ classicSnapshot: 'x' }).classicSnapshot).toBeNull();
    expect(pickThemeKeys({ classicSnapshot: [1] }).classicSnapshot).toBeNull();
  });
});

describe('selectTheme', () => {
  it('classic -> classic changes nothing: custom colours are not replaced by defaults', () => {
    const form = { ...classicForm(), buttonBgColor: '#abcdef', pageBgColor: '#eeeeee' };
    expect(selectTheme(form, 'classic')).toBe(form);
  });

  it('ignores an unknown theme id', () => {
    const form = classicForm();
    expect(selectTheme(form, 'neon')).toBe(form);
  });

  it('classic -> papuenvios applies the brand preset, marks the theme and snapshots the previous values', () => {
    const form = { ...classicForm(), buttonBgColor: '#abcdef' };
    const next = selectTheme(form, 'papuenvios');
    expect(next).toMatchObject(BRAND_PRESET);
    expect(next.activeTheme).toBe('papuenvios');
    expect(next.classicSnapshot).toEqual(only(form));
    expect(next.classicSnapshot.buttonBgColor).toBe('#abcdef');
  });

  it('never touches keys outside the preset (primary/secondary colours, logo, texts)', () => {
    const form = { ...classicForm(), logo: 'data:logo', companyName: 'Acme' };
    const next = selectTheme(form, 'papuenvios');
    for (const key of ['primaryColor', 'secondaryColor', 'logo', 'companyName', 'headerGradientColor', 'gradientDirection']) {
      expect(next[key], key).toBe(form[key]);
    }
  });

  it('round trip on the production row gives the production row back (plus the theme marker)', () => {
    const form = classicForm();
    const back = selectTheme(selectTheme(form, 'papuenvios'), 'classic');
    expect(back).toEqual({ ...form, activeTheme: 'classic', classicSnapshot: null });
  });

  it('round trip keeps customised and non-HEX stored values (typed sanitising, not HEX-only)', () => {
    const form = { ...classicForm(), buttonBgColor: '#abcdef', footerBgColor: 'rgba(1,2,3,0.5)' };
    const back = selectTheme(selectTheme(form, 'papuenvios'), 'classic');
    expect(back).toEqual({ ...form, activeTheme: 'classic', classicSnapshot: null });
  });

  it('re-selecting papuenvios does not overwrite the snapshot', () => {
    const once = selectTheme(classicForm(), 'papuenvios');
    expect(selectTheme(once, 'papuenvios')).toBe(once);
  });

  it('without a snapshot, classic falls back to the classic preset and nulls the key', () => {
    const form = { ...classicForm(), ...BRAND_PRESET, activeTheme: 'papuenvios' };
    const back = selectTheme(form, 'classic');
    expect(back).toMatchObject(THEME_PRESETS.classic);
    expect(back.activeTheme).toBe('classic');
    expect(back.classicSnapshot).toBeNull();
  });

  it('does not store a snapshot when the form holds the brand values under an explicit classic marker', () => {
    const form = { ...classicForm(), ...BRAND_PRESET, activeTheme: 'classic' };
    const next = selectTheme(form, 'papuenvios');
    expect(next.classicSnapshot).toBeNull();
    expect(selectTheme(next, 'classic')).toMatchObject(THEME_PRESETS.classic);
  });

  it('sanitises a tampered snapshot: unknown keys and wrong types are ignored', () => {
    const form = {
      ...classicForm(), ...BRAND_PRESET, activeTheme: 'papuenvios',
      classicSnapshot: { buttonBgColor: '#123456', useGradient: 'yes', logo: 'evil', headerBgColor: { x: 1 } },
    };
    const back = selectTheme(form, 'classic');
    expect(back.buttonBgColor).toBe('#123456');
    expect(back.useGradient).toBe(true); // wrong type -> classic preset value
    expect(back.logo).toBe(form.logo);
    expect(back.headerBgColor).toBe(THEME_PRESETS.classic.headerBgColor);
  });
});

describe('selectTheme on the real production row (brand values, no activeTheme)', () => {
  const realRow = () => ({ ...classicForm(), ...BRAND_PRESET, logo: 'x.png', siteTitle: 'Mi sitio' });

  it('picking Clasico changes the form: papuenvios is the inferred theme, classic is a real switch', () => {
    const row = realRow();
    const next = selectTheme(row, 'classic');
    expect(next).not.toBe(row);
    expect(next).toMatchObject(THEME_PRESETS.classic);
    expect(next.activeTheme).toBe('classic');
    expect(next.logo).toBe('x.png');
    expect(next.siteTitle).toBe('Mi sitio');
  });

  it('picking papuenvios on it is a no-op', () => {
    const row = realRow();
    expect(selectTheme(row, 'papuenvios')).toBe(row);
  });
});

describe('restoreThemeDefaults', () => {
  const stored = () => ({
    ...classicForm(),
    ...BRAND_PRESET,
    activeTheme: 'papuenvios',
    classicSnapshot: { buttonBgColor: '#123456' },
    primaryColor: '#abcdef',
    logo: 'data:logo',
    favicon: 'data:fav',
    companyName: 'Acme',
    siteTitle: 'Acme - tienda',
    showCompanyName: false,
    logoMaxHeight: 64,
    carouselEnabled: false,
    carouselAutoplaySpeed: 9000,
    carouselTransitionSpeed: 2000,
    homeFeatures: [{ id: 'custom', titleEs: 'Mio' }],
    customContentKey: 'kept',
  });

  it('resets every colour/style key to the code defaults and marks classic', () => {
    const next = restoreThemeDefaults(stored());
    expect(next).toMatchObject(only(DEFAULT_VISUAL_SETTINGS));
    expect(next.primaryColor).toBe(DEFAULT_VISUAL_SETTINGS.primaryColor);
    expect(next.activeTheme).toBe('classic');
    expect(next.classicSnapshot).toBeNull();
    expect(resolveThemeId(next)).toBe('classic');
  });

  it('keeps content: logo, favicon, texts, home features, carousel settings and unknown keys', () => {
    const before = stored();
    const next = restoreThemeDefaults(before);
    for (const key of CONTENT_KEYS) expect(next[key], key).toEqual(before[key]);
    expect(next.customContentKey).toBe('kept');
  });

  it('does not mutate its input', () => {
    const before = stored();
    const copy = JSON.parse(JSON.stringify(before));
    restoreThemeDefaults(before);
    expect(before).toEqual(copy);
  });
});

describe('getThemeDeviations', () => {
  it('is empty when the form equals the preset of its theme', () => {
    expect(getThemeDeviations({ ...classicForm(), ...THEME_PRESETS.classic, activeTheme: 'classic' })).toEqual([]);
    expect(getThemeDeviations({ ...classicForm(), ...BRAND_PRESET, activeTheme: 'papuenvios' })).toEqual([]);
  });

  it('lists the preset keys edited by hand', () => {
    const form = { ...classicForm(), ...BRAND_PRESET, activeTheme: 'papuenvios', buttonBgColor: '#123456', headerBgColor: '#FFFFFF' };
    expect(getThemeDeviations(form)).toEqual(['buttonBgColor']); // same hex in other case is not a deviation
  });
});
