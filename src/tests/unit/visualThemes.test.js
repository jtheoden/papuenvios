import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/supabase', () => ({ supabase: { from: vi.fn() } }));

import { DEFAULT_VISUAL_SETTINGS } from '@/lib/businessVisualSettingsService';
import { BRAND_PRESET } from '@/lib/brandPalette';
import {
  THEME_IDS,
  DEFAULT_THEME_ID,
  THEME_PRESETS,
  resolveThemeId,
  pickThemeKeys,
  selectTheme,
} from '@/lib/visualThemes';
import { PROD_ROW } from '../fixtures/prodVisualRow';

const PRESET_KEYS = Object.keys(BRAND_PRESET);
const prodForm = () => ({ ...DEFAULT_VISUAL_SETTINGS, ...PROD_ROW });
const only = (obj) => Object.fromEntries(PRESET_KEYS.map((k) => [k, obj[k]]));

describe('theme ids and defaults', () => {
  it('offers classic and papuenvios, classic by default', () => {
    expect(THEME_IDS).toEqual(['classic', 'papuenvios']);
    expect(DEFAULT_THEME_ID).toBe('classic');
    expect(DEFAULT_VISUAL_SETTINGS.activeTheme).toBe('classic');
  });

  it('resolves a missing, null or unknown theme to classic (production row has no key)', () => {
    for (const s of [undefined, null, {}, PROD_ROW, { activeTheme: 'neon' }, { activeTheme: 42 }]) {
      expect(resolveThemeId(s)).toBe('classic');
    }
    expect(resolveThemeId({ activeTheme: 'papuenvios' })).toBe('papuenvios');
  });

  it('classic preset is exactly the code defaults for the keys the brand preset sets', () => {
    expect(THEME_PRESETS.classic).toEqual(only(DEFAULT_VISUAL_SETTINGS));
    expect(THEME_PRESETS.papuenvios).toBe(BRAND_PRESET);
    expect(THEME_PRESETS.classic.useGradient).toBe(true);
    expect(THEME_PRESETS.papuenvios.useGradient).toBe(false);
  });

  it('classic preset reproduces the production row values for those keys', () => {
    expect(THEME_PRESETS.classic).toEqual(only(prodForm()));
  });
});

describe('pickThemeKeys', () => {
  it('returns the resolved theme and a null snapshot when absent', () => {
    expect(pickThemeKeys(PROD_ROW)).toEqual({ activeTheme: 'classic', classicSnapshot: null });
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
    const form = { ...prodForm(), buttonBgColor: '#abcdef', pageBgColor: '#eeeeee' };
    expect(selectTheme(form, 'classic')).toBe(form);
  });

  it('ignores an unknown theme id', () => {
    const form = prodForm();
    expect(selectTheme(form, 'neon')).toBe(form);
  });

  it('classic -> papuenvios applies the brand preset, marks the theme and snapshots the previous values', () => {
    const form = { ...prodForm(), buttonBgColor: '#abcdef' };
    const next = selectTheme(form, 'papuenvios');
    expect(next).toMatchObject(BRAND_PRESET);
    expect(next.activeTheme).toBe('papuenvios');
    expect(next.classicSnapshot).toEqual(only(form));
    expect(next.classicSnapshot.buttonBgColor).toBe('#abcdef');
  });

  it('never touches keys outside the preset (primary/secondary colours, logo, texts)', () => {
    const form = { ...prodForm(), logo: 'data:logo', companyName: 'Acme' };
    const next = selectTheme(form, 'papuenvios');
    for (const key of ['primaryColor', 'secondaryColor', 'logo', 'companyName', 'headerGradientColor', 'gradientDirection']) {
      expect(next[key], key).toBe(form[key]);
    }
  });

  it('round trip on the production row gives the production row back (plus the theme marker)', () => {
    const form = prodForm();
    const back = selectTheme(selectTheme(form, 'papuenvios'), 'classic');
    expect(back).toEqual({ ...form, activeTheme: 'classic', classicSnapshot: null });
  });

  it('round trip keeps customised and non-HEX stored values (typed sanitising, not HEX-only)', () => {
    const form = { ...prodForm(), buttonBgColor: '#abcdef', footerBgColor: 'rgba(1,2,3,0.5)' };
    const back = selectTheme(selectTheme(form, 'papuenvios'), 'classic');
    expect(back).toEqual({ ...form, activeTheme: 'classic', classicSnapshot: null });
  });

  it('re-selecting papuenvios does not overwrite the snapshot', () => {
    const once = selectTheme(prodForm(), 'papuenvios');
    expect(selectTheme(once, 'papuenvios')).toBe(once);
  });

  it('without a snapshot, classic falls back to the classic preset and nulls the key', () => {
    const form = { ...prodForm(), ...BRAND_PRESET, activeTheme: 'papuenvios' };
    const back = selectTheme(form, 'classic');
    expect(back).toMatchObject(THEME_PRESETS.classic);
    expect(back.activeTheme).toBe('classic');
    expect(back.classicSnapshot).toBeNull();
  });

  it('does not store a snapshot when the form already holds the brand values (old preset button)', () => {
    const form = { ...prodForm(), ...BRAND_PRESET }; // no activeTheme: resolves to classic
    const next = selectTheme(form, 'papuenvios');
    expect(next.classicSnapshot).toBeNull();
    expect(selectTheme(next, 'classic')).toMatchObject(THEME_PRESETS.classic);
  });

  it('sanitises a tampered snapshot: unknown keys and wrong types are ignored', () => {
    const form = {
      ...prodForm(), ...BRAND_PRESET, activeTheme: 'papuenvios',
      classicSnapshot: { buttonBgColor: '#123456', useGradient: 'yes', logo: 'evil', headerBgColor: { x: 1 } },
    };
    const back = selectTheme(form, 'classic');
    expect(back.buttonBgColor).toBe('#123456');
    expect(back.useGradient).toBe(true); // wrong type -> classic preset value
    expect(back.logo).toBe(form.logo);
    expect(back.headerBgColor).toBe(THEME_PRESETS.classic.headerBgColor);
  });
});
