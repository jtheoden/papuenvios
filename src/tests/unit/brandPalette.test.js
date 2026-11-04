import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/supabase', () => ({ supabase: { from: vi.fn() } }));

import {
  BRAND_PALETTE,
  BRAND_PRESET,
  NEW_KEY_DEFAULTS,
  BRAND_CSS_VARS,
  getContrastIssues,
  isHexColor,
} from '@/lib/brandPalette';
import { DEFAULT_VISUAL_SETTINGS } from '@/lib/businessVisualSettingsService';

describe('BRAND_PALETTE', () => {
  it('holds the eight official HEX values, exactly', () => {
    expect(BRAND_PALETTE).toEqual({
      ivory: '#FAF7F0',
      white: '#FFFFFF',
      charcoal: '#171717',
      warmGray: '#605B52',
      gold: '#FFA500',
      goldDeep: '#E59400',
      goldSoft: '#FFF1CC',
      beige: '#E8E0D2',
    });
  });
});

describe('BRAND_PRESET', () => {
  it('only uses keys that exist in DEFAULT_VISUAL_SETTINGS', () => {
    for (const key of Object.keys(BRAND_PRESET)) {
      expect(DEFAULT_VISUAL_SETTINGS, key).toHaveProperty(key);
    }
  });

  it('maps the in-scope elements to the brand palette', () => {
    expect(BRAND_PRESET).toMatchObject({
      pageBgColor: '#FAF7F0',
      headerBgColor: '#FFFFFF',
      headerTextColor: '#171717',
      headerMenuActiveBgColor: '#FFF1CC',
      headerMenuActiveColor: '#171717',
      navBarActiveBgColor: '#FFF1CC',
      navBarActiveTextColor: '#171717',
      tabActiveBgColor: '#FFF1CC',
      tabActiveColor: '#171717',
      buttonBgColor: '#FFA500',
      buttonHoverBgColor: '#E59400',
      buttonTextColor: '#171717',
      useButtonGradient: false,
      headingColor: '#171717',
      useHeadingGradient: false,
      cardBgColor: '#FFFFFF',
      cartBadgeBgColor: '#FFA500',
      cartBadgeTextColor: '#171717',
      carouselDotActiveColor: '#FFA500',
      borderColor: '#E8E0D2',
      mutedTextColor: '#605B52',
      softAccentColor: '#FFF1CC',
      focusRingColor: '#171717',
    });
  });

  it('turns the global gradients off, otherwise header/home buttons ignore the solid colours', () => {
    expect(BRAND_PRESET.useGradient).toBe(false);
    expect(BRAND_PRESET.useHeaderGradient).toBe(false);
  });

  it('keeps every colour value a valid HEX and leaves primary/secondary untouched', () => {
    for (const [key, value] of Object.entries(BRAND_PRESET)) {
      if (typeof value === 'string') expect(isHexColor(value), key).toBe(true);
    }
    expect(BRAND_PRESET).not.toHaveProperty('primaryColor');
    expect(BRAND_PRESET).not.toHaveProperty('secondaryColor');
  });

  it('passes the AA contrast check on every pair it defines', () => {
    expect(getContrastIssues({ ...DEFAULT_VISUAL_SETTINGS, ...BRAND_PRESET })).toEqual([]);
  });
});

describe('NEW_KEY_DEFAULTS', () => {
  it('uses brand defaults, except borderColor which is already read elsewhere with a grey fallback', () => {
    expect(NEW_KEY_DEFAULTS).toEqual({
      cartBadgeBgColor: '#FFA500',
      cartBadgeTextColor: '#171717',
      carouselDotActiveColor: '#FFA500',
      borderColor: '#e5e7eb',
      mutedTextColor: '#605B52',
      softAccentColor: '#FFF1CC',
      focusRingColor: '#171717',
    });
  });

  it('is merged into DEFAULT_VISUAL_SETTINGS', () => {
    expect(DEFAULT_VISUAL_SETTINGS).toMatchObject(NEW_KEY_DEFAULTS);
  });
});

describe('getContrastIssues', () => {
  const base = { ...DEFAULT_VISUAL_SETTINGS };

  it('reports no issue for the legacy production colours (no false positives)', () => {
    expect(getContrastIssues(base)).toEqual([]);
  });

  it('flags white text on the brand gold button (1.97:1)', () => {
    const issues = getContrastIssues({ ...base, buttonBgColor: '#FFA500', buttonTextColor: '#FFFFFF' });
    expect(issues).toHaveLength(1);
    expect(issues[0].id).toBe('button');
    expect(issues[0].ratio).toBeCloseTo(1.97, 2);
  });

  it('accepts charcoal text on the brand gold button (9.08:1)', () => {
    const issues = getContrastIssues({ ...base, buttonBgColor: '#FFA500', buttonTextColor: '#171717' });
    expect(issues).toEqual([]);
    // ratio documented in the plan
  });

  it('checks header, active nav, admin menu, tab and cart badge pairs', () => {
    const issues = getContrastIssues({
      ...base,
      headerBgColor: '#ffffff', headerTextColor: '#eeeeee',
      navBarActiveBgColor: '#ffffff', navBarActiveTextColor: '#eeeeee',
      headerMenuActiveBgColor: '#ffffff', headerMenuActiveColor: '#eeeeee',
      tabActiveBgColor: '#ffffff', tabActiveColor: '#eeeeee',
      cartBadgeBgColor: '#ffffff', cartBadgeTextColor: '#eeeeee',
    });
    expect(issues.map((i) => i.id).sort()).toEqual(['cartBadge', 'header', 'menuActive', 'navActive', 'tab']);
  });

  it('ignores values that are not valid HEX instead of throwing', () => {
    expect(() => getContrastIssues({ ...base, buttonBgColor: 'not-a-colour' })).not.toThrow();
    expect(getContrastIssues({ ...base, buttonBgColor: 'not-a-colour' })).toEqual([]);
  });
});

describe('BRAND_CSS_VARS', () => {
  it('maps only settings keys that exist', () => {
    for (const key of Object.keys(BRAND_CSS_VARS)) {
      expect(DEFAULT_VISUAL_SETTINGS, key).toHaveProperty(key);
    }
  });
});
