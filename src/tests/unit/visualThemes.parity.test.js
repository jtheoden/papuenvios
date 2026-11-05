import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/supabase', () => ({ supabase: { from: vi.fn() } }));

import { DEFAULT_VISUAL_SETTINGS } from '@/lib/businessVisualSettingsService';
import { BRAND_PRESET } from '@/lib/brandPalette';
import { selectTheme } from '@/lib/visualThemes';
import { buildHeaderTheme } from '@/lib/headerTheme';
import { buildFooterTheme } from '@/lib/footerTheme';
import { buildLoadingTheme } from '@/lib/loadingTheme';
import { getPrimaryButtonStyle, getHeadingStyle } from '@/lib/styleUtils';
import { PROD_ROW } from '../fixtures/prodVisualRow';

// What the app really works with: the stored row merged over the code defaults (loadVisualSettings).
const PROD = { ...DEFAULT_VISUAL_SETTINGS, ...PROD_ROW };
const PAPU = { ...PROD, ...BRAND_PRESET };

// Home has no theme module: its CTAs and headings read these style helpers (plus useGradient inline).
const resolve = (s) => ({
  header: buildHeaderTheme(s),
  footer: buildFooterTheme(s),
  loading: buildLoadingTheme(s),
  button: getPrimaryButtonStyle(s),
  heading: getHeadingStyle(s),
});

describe('theme resolvers do not depend on the theme name', () => {
  it('the activeTheme / classicSnapshot keys change nothing for the production row', () => {
    const withKeys = { ...PROD, activeTheme: 'classic', classicSnapshot: null };
    expect(resolve(withKeys)).toEqual(resolve(PROD));
    expect(resolve({ ...PROD, activeTheme: 'papuenvios' })).toEqual(resolve(PROD));
  });

  it('classic and papuenvios do resolve differently (the checks below are not vacuous)', () => {
    const classic = resolve(PROD);
    const brand = resolve(PAPU);
    for (const key of Object.keys(classic)) expect(brand[key], key).not.toEqual(classic[key]);
  });
});

describe('selectTheme keeps resolver output identical to the stored values', () => {
  it('(a) selecting classic on the production row changes nothing', () => {
    expect(resolve(selectTheme(PROD, 'classic'))).toEqual(resolve(PROD));
  });

  it('(b) selecting papuenvios resolves exactly like the brand preset applied over the row', () => {
    expect(resolve(selectTheme(PROD, 'papuenvios'))).toEqual(resolve(PAPU));
  });

  it('(c) papuenvios -> classic gives back the production resolution', () => {
    expect(resolve(selectTheme(selectTheme(PROD, 'papuenvios'), 'classic'))).toEqual(resolve(PROD));
  });

  it('(c) same round trip when the row is the saved papuenvios theme loaded back from the DB', () => {
    const saved = JSON.parse(JSON.stringify(selectTheme(PROD, 'papuenvios')));
    expect(resolve(saved)).toEqual(resolve(PAPU));
    expect(resolve(selectTheme(saved, 'classic'))).toEqual(resolve(PROD));
  });

  it('an empty row (no DB record, code defaults) is unchanged by selecting classic', () => {
    expect(resolve(selectTheme(DEFAULT_VISUAL_SETTINGS, 'classic'))).toEqual(resolve(DEFAULT_VISUAL_SETTINGS));  });
});
