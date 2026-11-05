import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

import { BRAND_PRESET, resolveLookId } from '@/lib/brandPalette';
import { LOCAL_CACHE_KEY } from '@/lib/constants';
import { contrastRatio } from '@/lib/contrast';
import { buildLoadingTheme, readStoredVisualSettings } from '@/lib/loadingTheme';

const CACHE_KEY = LOCAL_CACHE_KEY;

const PROD = { useGradient: true, primaryColor: '#3499dc', secondaryColor: '#9333ea' };
const PRESET = { ...PROD, ...BRAND_PRESET };
const POISON = { primaryColor: '#abcdef', secondaryColor: '#fedcba', accentColor: '#123456' };

describe('buildLoadingTheme (S4)', () => {
  it('without settings (first visit, no cache) paints the brand look, like the static splash and the --t-* defaults', () => {
    for (const missing of [null, undefined]) {
      expect(buildLoadingTheme(missing)).toEqual(buildLoadingTheme(PRESET));
      expect(buildLoadingTheme(missing)['--ld-bg']).toBe('#FAF7F0');
    }
  });

  it('with the production row (gradient on) keeps exactly the shipped look: it never honoured the stored colours', () => {
    const shipped = {
      '--ld-bg': 'linear-gradient(to right, #2563eb, #9333ea)',
      '--ld-card-bg': '#ffffff',
      '--ld-accent': '#2563eb',
      '--ld-text': '#4b5563',
      '--ld-muted': '#6b7280',
    };
    expect(buildLoadingTheme(PROD)).toEqual(shipped);
    expect(buildLoadingTheme({ ...PROD, cardBgColor: '#eeeeee', textPrimaryColor: '#000000' })).toEqual(shipped);
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

  it('follows a customised page and card colour (papuenvios chosen in the selector)', () => {
    const theme = buildLoadingTheme({ ...PRESET, activeTheme: 'papuenvios', pageBgColor: '#112233', cardBgColor: '#f0f0f0' });
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

// The static splash (index.html) and the loading screens must agree: the splash paints the classic gradient exactly
// when the inline script sets data-theme="classic" (resolveLookId), ivory otherwise (also with nothing cached).
describe('buildLoadingTheme agrees with the static splash (data-theme) for every row', () => {
  const GRADIENT = 'linear-gradient(to right, #2563eb, #9333ea)';
  const script = fs.readFileSync(path.join(process.cwd(), 'index.html'), 'utf8').match(/<script>([\s\S]*?)<\/script>/)[1];
  const splashLook = (data) => {
    document.documentElement.removeAttribute('data-theme');
    localStorage.clear();
    if (data) localStorage.setItem(CACHE_KEY, JSON.stringify({ data, timestamp: 0 }));
    new Function(script)();
    return document.documentElement.getAttribute('data-theme') === 'classic' ? 'classic' : 'brand';
  };
  const ROWS = {
    nothingCached: null,
    productionBrandRow: { ...BRAND_PRESET },
    classicGradient: PROD,
    classicNoGradient: { ...PROD, useGradient: false, pageBgColor: '#f8fafc' },
    papuenviosWithGradient: { ...BRAND_PRESET, useGradient: true, activeTheme: 'papuenvios' },
    brandMarkedClassic: { ...BRAND_PRESET, activeTheme: 'classic' },
    classicMarkedPapuenvios: { ...PROD, activeTheme: 'papuenvios' },
    brandMissingOneKey: { ...BRAND_PRESET, footerLinkHoverColor: '#123456' },
    empty: {},
  };

  it.each(Object.entries(ROWS))('%s', (_name, row) => {
    const look = splashLook(row);
    expect(look).toBe(row ? (resolveLookId(row) === 'classic' ? 'classic' : 'brand') : 'brand');
    const bg = buildLoadingTheme(row)['--ld-bg'];
    if (look === 'classic') expect(bg).toBe(GRADIENT);
    else expect(bg).not.toMatch(/gradient/);
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
