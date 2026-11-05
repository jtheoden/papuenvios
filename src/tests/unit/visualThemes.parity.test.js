import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/supabase', () => ({ supabase: { from: vi.fn() } }));

import { DEFAULT_VISUAL_SETTINGS } from '@/lib/businessVisualSettingsService';
import { BRAND_PRESET } from '@/lib/brandPalette';
import { selectTheme, resolveThemeId } from '@/lib/visualThemes';
import { buildHeaderTheme } from '@/lib/headerTheme';
import { buildFooterTheme } from '@/lib/footerTheme';
import { buildLoadingTheme } from '@/lib/loadingTheme';
import { getPrimaryButtonStyle, getHeadingStyle } from '@/lib/styleUtils';
import { CLASSIC_ROW } from '../fixtures/classicVisualRow';

// What the app really works with: the stored row merged over the code defaults (loadVisualSettings).
const CLASSIC = { ...DEFAULT_VISUAL_SETTINGS, ...CLASSIC_ROW };
const PAPU = { ...CLASSIC, ...BRAND_PRESET };
// The row production holds today: every BRAND_PRESET key, no activeTheme / classicSnapshot.
const REAL_BRAND_ROW = { ...CLASSIC_ROW, ...BRAND_PRESET };

// Home has no theme module: its CTAs and headings read these style helpers (plus useGradient inline).
const resolve = (s) => ({
  header: buildHeaderTheme(s),
  footer: buildFooterTheme(s),
  loading: buildLoadingTheme(s),
  button: getPrimaryButtonStyle(s),
  heading: getHeadingStyle(s),
});

describe('theme resolvers do not depend on the theme name', () => {
  it('the activeTheme / classicSnapshot keys change nothing for the classic row', () => {
    const withKeys = { ...CLASSIC, activeTheme: 'classic', classicSnapshot: null };
    expect(resolve(withKeys)).toEqual(resolve(CLASSIC));
    // The loading screen is the exception: it follows the look (resolveLookId), like the static splash it replaces.
    const { loading, ...rest } = resolve({ ...CLASSIC, activeTheme: 'papuenvios' });
    const { loading: classicLoading, ...classicRest } = resolve(CLASSIC);
    expect(rest).toEqual(classicRest);
    expect(loading).not.toEqual(classicLoading);
    expect(loading['--ld-bg']).not.toMatch(/gradient/);
  });

  it('classic and papuenvios do resolve differently (the checks below are not vacuous)', () => {
    const classic = resolve(CLASSIC);
    const brand = resolve(PAPU);
    for (const key of Object.keys(classic)) expect(brand[key], key).not.toEqual(classic[key]);
  });
});

describe('selectTheme keeps resolver output identical to the stored values', () => {
  it('(a) selecting classic on the classic row changes nothing', () => {
    expect(resolve(selectTheme(CLASSIC, 'classic'))).toEqual(resolve(CLASSIC));
  });

  it('(b) selecting papuenvios resolves exactly like the brand preset applied over the row', () => {
    expect(resolve(selectTheme(CLASSIC, 'papuenvios'))).toEqual(resolve(PAPU));
  });

  it('(c) papuenvios -> classic gives back the classic resolution', () => {
    expect(resolve(selectTheme(selectTheme(CLASSIC, 'papuenvios'), 'classic'))).toEqual(resolve(CLASSIC));
  });

  it('(c) same round trip when the row is the saved papuenvios theme loaded back from the DB', () => {
    const saved = JSON.parse(JSON.stringify(selectTheme(CLASSIC, 'papuenvios')));
    expect(resolve(saved)).toEqual(resolve(PAPU));
    expect(resolve(selectTheme(saved, 'classic'))).toEqual(resolve(CLASSIC));
  });

  it('an empty row (no DB record, code defaults) is unchanged by selecting classic', () => {
    expect(resolve(selectTheme(DEFAULT_VISUAL_SETTINGS, 'classic'))).toEqual(resolve(DEFAULT_VISUAL_SETTINGS));
  });
});

describe('the real production row (brand values, no activeTheme)', () => {
  const real = { ...DEFAULT_VISUAL_SETTINGS, ...REAL_BRAND_ROW }; // as loadVisualSettings merges it

  it('is inferred as papuenvios and resolves exactly like the brand preset', () => {
    expect(resolveThemeId(real)).toBe('papuenvios');
    expect(resolve(real)).toEqual(resolve(PAPU));
  });

  it('selecting papuenvios on it changes nothing', () => {
    expect(resolve(selectTheme(real, 'papuenvios'))).toEqual(resolve(real));
  });

  it('selecting classic on it resolves like the classic look (non-preset keys untouched)', () => {
    expect(resolve(selectTheme(real, 'classic'))).toEqual(resolve(CLASSIC));
  });

  it('going classic and back to papuenvios returns to the brand resolution', () => {
    expect(resolve(selectTheme(selectTheme(real, 'classic'), 'papuenvios'))).toEqual(resolve(PAPU));
  });
});
