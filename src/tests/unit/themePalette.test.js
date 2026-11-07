import { describe, it, expect, vi } from 'vitest';
vi.mock('@/lib/supabase', () => ({ supabase: {} }));
import { BRAND_PRESET, resolveLookId } from '@/lib/brandPalette';
import { DEFAULT_VISUAL_SETTINGS } from '@/lib/businessVisualSettingsService';
import * as themes from '@/lib/visualThemes';

const IDENTITY = {
  primaryColor: '#171717', secondaryColor: '#605B52', headerGradientColor: '#605B52',
  accentColor: '#FFA500', pageBgColor: '#FAF7F0',
};
const legacyBrand = () => ({
  ...DEFAULT_VISUAL_SETTINGS, ...BRAND_PRESET,
  primaryColor: '#3499dc', secondaryColor: '#9333ea', headerGradientColor: '#9333ea',
});

describe('theme palette form defaults (no persistence)', () => {
  it('still infers the brand look from pre-step-7 saved rows without an activeTheme', () => {
    expect(resolveLookId(legacyBrand())).toBe('papuenvios');
    const { primaryColor, secondaryColor, headerGradientColor, ...oldPreset } = BRAND_PRESET;
    expect([primaryColor, secondaryColor, headerGradientColor]).toHaveLength(3);
    expect(resolveLookId(oldPreset)).toBe('papuenvios');
  });

  it.each(['#3499dc', '#2563EB'])('suggests the palette for legacy blue %s without mutating the row', (primaryColor) => {
    const stored = { ...legacyBrand(), primaryColor, secondaryColor: '#9333EA' };
    const before = structuredClone(stored);
    expect(themes.getThemeFormDefaults(stored)).toEqual({
      primaryColor: IDENTITY.primaryColor, secondaryColor: IDENTITY.secondaryColor,
      headerGradientColor: IDENTITY.headerGradientColor,
    });
    expect(stored).toEqual(before);
  });

  it('fills missing brand identity fields from the preset', () => {
    expect(themes.getThemeFormDefaults({ activeTheme: 'papuenvios' })).toEqual(IDENTITY);
  });

  it('keeps custom values and never changes a classic row', () => {
    const custom = { ...legacyBrand(), primaryColor: '#123456', secondaryColor: '#abcdef', headerGradientColor: '#334455' };
    expect(themes.getThemeFormDefaults(custom)).toEqual({});
    expect(themes.getThemeFormDefaults({ ...legacyBrand(), activeTheme: 'classic' })).toEqual({});
    expect(themes.getThemeFormDefaults(DEFAULT_VISUAL_SETTINGS)).toEqual({});
  });

  it('applies the selected palette even when already selected, preserving content and the Classic snapshot', () => {
    const before = { ...legacyBrand(), logo: 'logo.svg', companyName: 'Acme', classicSnapshot: { primaryColor: '#123456' } };
    const next = themes.applyThemePalette(before);
    expect(next).toMatchObject({ ...BRAND_PRESET, ...IDENTITY, logo: 'logo.svg', companyName: 'Acme', classicSnapshot: before.classicSnapshot });
    expect(before.primaryColor).toBe('#3499dc');
    expect(themes.selectTheme(next, 'classic').primaryColor).toBe('#123456');
  });

  it('upgrades pre-step-7 snapshots from stored identity before suggestions replace legacy colours', () => {
    const stored = { ...legacyBrand(), classicSnapshot: { buttonBgColor: '#123456' } };
    const form = { ...stored, ...themes.pickThemeKeys(stored), ...themes.getThemeFormDefaults(stored) };
    const back = themes.selectTheme(form, 'classic');
    expect(back).toMatchObject({
      primaryColor: '#3499dc', secondaryColor: '#9333ea', headerGradientColor: '#9333ea', buttonBgColor: '#123456',
    });
    expect(stored.classicSnapshot).toEqual({ buttonBgColor: '#123456' });
  });

  it('backfills only missing snapshot identity and preserves custom snapshot fields without mutation', () => {
    const stored = {
      ...legacyBrand(), secondaryColor: '#112233', headerGradientColor: 'rgba(10, 20, 30, 0.5)',
      classicSnapshot: { primaryColor: '#abcdef80', secondaryColor: '#fedcba', buttonBgColor: '#123456' },
    };
    const before = structuredClone(stored);
    const form = { ...stored, ...themes.pickThemeKeys(stored), ...themes.getThemeFormDefaults(stored) };
    expect(themes.selectTheme(themes.applyThemePalette(form), 'classic')).toMatchObject({
      primaryColor: '#abcdef80', secondaryColor: '#fedcba', headerGradientColor: 'rgba(10, 20, 30, 0.5)',
      buttonBgColor: '#123456',
    });
    expect(form.classicSnapshot).not.toBe(stored.classicSnapshot);
    expect(stored).toEqual(before);
  });

  it('keeps code-default Classic identity when a legacy brand row has no snapshot', () => {
    const stored = legacyBrand();
    const form = { ...stored, ...themes.pickThemeKeys(stored), ...themes.getThemeFormDefaults(stored) };
    expect(form.classicSnapshot).toBeNull();
    expect(themes.selectTheme(form, 'classic')).toMatchObject(themes.THEME_PRESETS.classic);
  });

});
