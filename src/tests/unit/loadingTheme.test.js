import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/supabase', () => ({ supabase: {} }));

import { BRAND_PRESET } from '@/lib/brandPalette';
import { DEFAULT_VISUAL_SETTINGS } from '@/lib/businessVisualSettingsService';
import { contrastRatio } from '@/lib/contrast';
import { buildLoadingTheme, readStoredVisualSettings } from '@/lib/loadingTheme';

const CACHE_KEY = 'business_visual_settings_cache';

const PROD = { ...DEFAULT_VISUAL_SETTINGS, useGradient: true, primaryColor: '#3499dc', secondaryColor: '#9333ea' };
const PRESET = { ...PROD, ...BRAND_PRESET };
const POISON = { primaryColor: '#abcdef', secondaryColor: '#fedcba', accentColor: '#123456' };

describe('buildLoadingTheme (S4)', () => {
  it('without settings keeps the shipped look: blue to violet gradient', () => {
    const theme = buildLoadingTheme(null);
    expect(theme['--ld-bg']).toBe('linear-gradient(to right, #2563eb, #9333ea)');
    expect(theme['--ld-accent']).toBe('#2563eb');
    expect(theme['--ld-card-bg']).toBe('#ffffff');
    expect(theme['--ld-text']).toBe('#4b5563');
  });

  it('with the production row (gradient on) keeps exactly the shipped look: it never honoured the stored colours', () => {
    expect(buildLoadingTheme({ ...PROD, cardBgColor: '#eeeeee', textPrimaryColor: '#000000' })).toEqual(buildLoadingTheme(null));
  });

  it('with the brand preset paints a flat ivory page, white card and charcoal accent', () => {
    const theme = buildLoadingTheme(PRESET);
    expect(theme['--ld-bg']).toBe('#FAF7F0');
    expect(theme['--ld-card-bg']).toBe('#FFFFFF');
    expect(theme['--ld-accent']).toBe('#171717');
    expect(theme['--ld-text']).toBe('#171717');
    expect(theme['--ld-muted']).toBe('#605B52');
  });

  it('keeps text AA and the spinner/progress bar at 3:1 on the card, in both looks (read from the output)', () => {
    for (const settings of [null, PROD, PRESET]) {
      const theme = buildLoadingTheme(settings);
      const card = theme['--ld-card-bg'];
      expect(contrastRatio(theme['--ld-text'], card)).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(theme['--ld-muted'], card)).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(theme['--ld-accent'], card)).toBeGreaterThanOrEqual(3);
    }
  });

  it('ignores primary/secondary/accent colours once the gradient is off (poisoned settings)', () => {
    const dump = JSON.stringify(buildLoadingTheme({ ...PRESET, ...POISON })).toLowerCase();
    Object.values(POISON).forEach((hex) => expect(dump).not.toContain(hex));
  });

  it('follows a customised page and card colour', () => {
    const theme = buildLoadingTheme({ ...PRESET, pageBgColor: '#112233', cardBgColor: '#f0f0f0' });
    expect(theme['--ld-bg']).toBe('#112233');
    expect(theme['--ld-card-bg']).toBe('#f0f0f0');
  });

  it('never lets a non-HEX value reach a style attribute', () => {
    const evil = 'red; background:url(//evil.test/x)';
    const theme = buildLoadingTheme({ ...PRESET, pageBgColor: evil, cardBgColor: evil, headingColor: evil, mutedTextColor: 'url(x)' });
    for (const value of Object.values(theme)) {
      expect(String(value)).not.toMatch(/evil|url|;/i);
    }
  });
});

describe('readStoredVisualSettings (S4)', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('returns null when nothing is stored', () => {
    expect(readStoredVisualSettings()).toBeNull();
  });

  it('reads the settings the app caches (the real cache key written by loadVisualSettings)', () => {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ data: PRESET, timestamp: Date.now() }));
    expect(readStoredVisualSettings()).toEqual(PRESET);
  });

  it('still reads an entry past the 1 minute cache TTL: a stale splash look beats a wrong one', () => {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ data: PRESET, timestamp: Date.now() - 24 * 60 * 60 * 1000 }));
    expect(readStoredVisualSettings()).toEqual(PRESET);
  });

  it('returns null for corrupt or malformed entries instead of throwing', () => {
    localStorage.setItem(CACHE_KEY, '{not json');
    expect(readStoredVisualSettings()).toBeNull();
    localStorage.setItem(CACHE_KEY, JSON.stringify({ timestamp: 1 }));
    expect(readStoredVisualSettings()).toBeNull();
    localStorage.setItem(CACHE_KEY, JSON.stringify({ data: 'nope', timestamp: 1 }));
    expect(readStoredVisualSettings()).toBeNull();
  });

  it('returns null when storage is unavailable', () => {
    const spy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(readStoredVisualSettings()).toBeNull();
    spy.mockRestore();
  });
});
