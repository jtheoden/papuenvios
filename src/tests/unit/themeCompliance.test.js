import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import postcss from 'postcss';
import tailwindcss from 'tailwindcss';
import loadConfig from 'tailwindcss/loadConfig';
import colors from 'tailwindcss/colors';
import { BRAND_PALETTE, BRAND_PRESET, resolveLookId } from '@/lib/brandPalette';
import { LOCAL_CACHE_KEY } from '@/lib/constants';
import { countOldPalette, listSourceFiles } from '../../../scripts/theme-codemod.mjs';

vi.mock('@/lib/supabase', () => ({ supabase: {} }));

const { applyVisualSettingsToDOM, DEFAULT_VISUAL_SETTINGS } = await import('@/lib/businessVisualSettingsService');
const { resolveThemeId } = await import('@/lib/visualThemes');

const ROOT = process.cwd();
const indexCss = fs.readFileSync(path.join(ROOT, 'src/index.css'), 'utf8'); // not `?raw`: vitest serves CSS imports empty
const { ivory, charcoal, gold, goldDeep, goldSoft, beige } = BRAND_PALETTE;

// Token -> hex of the Tailwind tone it replaces in the classic look (read from tailwindcss itself, not retyped).
const CLASSIC = {
  accent: colors.blue[600],
  'accent-hover': colors.blue[700],
  'on-accent': '#ffffff',
  'accent-soft': colors.blue[50],
  'accent-soft-2': colors.blue[100],
  'accent-line': colors.blue[200],
  link: colors.blue[600],
  'link-strong': colors.blue[700],
  focus: colors.blue[500],
  'accent-2': colors.purple[600],
  'accent-2-soft': colors.purple[50],
  'accent-2-soft-2': colors.purple[100],
  'grad-from': colors.blue[500],
  'grad-to': colors.purple[600],
  'page-from': colors.slate[50],
  'page-via': colors.blue[50],
  'page-to': colors.indigo[100],
};

// Token -> brand palette value in the papuenvios look.
const PAPUENVIOS = {
  accent: gold,
  'accent-hover': goldDeep,
  'on-accent': charcoal,
  'accent-soft': goldSoft,
  'accent-soft-2': goldSoft,
  'accent-line': beige,
  link: charcoal,
  'link-strong': charcoal,
  focus: charcoal,
  'accent-2': gold,
  'accent-2-soft': goldSoft,
  'accent-2-soft-2': goldSoft,
  'grad-from': gold,
  'grad-to': gold,
  'page-from': ivory,
  'page-via': ivory,
  'page-to': ivory,
};

const toHex = (channels) => `#${channels.trim().split(/\s+/).map((c) => Number(c).toString(16).padStart(2, '0')).join('')}`;

/** `--t-*: R G B;` declarations of the block whose selector is exactly `selector`. */
const tokensOf = (selector) => {
  const blocks = [...indexCss.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter(([, sel, body]) => sel.trim() === selector && body.includes('--t-'));
  expect(blocks, `exactly one ${selector} block with --t-* tokens`).toHaveLength(1);
  return Object.fromEntries([...blocks[0][2].matchAll(/--t-([a-z0-9-]+):\s*([\d\s]+);/g)].map(([, name, channels]) => [name, toHex(channels)]));
};

const lower = (map) => Object.fromEntries(Object.entries(map).map(([k, v]) => [k, v.toLowerCase()]));

describe('theme tokens (index.css)', () => {
  it('classic tokens equal the Tailwind tones they replace', () => {
    expect(tokensOf(':root[data-theme="classic"]')).toEqual(lower(CLASSIC));
  });

  it('default (papuenvios) tokens equal BRAND_PALETTE', () => {
    expect(tokensOf(':root')).toEqual(lower(PAPUENVIOS));
  });

  it('the body gradient is built from the page tokens and defines --radius globally', () => {
    expect(indexCss).toMatch(/linear-gradient\(\s*to bottom right,\s*rgb\(var\(--t-page-from\)\),\s*rgb\(var\(--t-page-via\)\),\s*rgb\(var\(--t-page-to\)\)\s*\)/);
    expect(indexCss).not.toMatch(/from-slate-50|via-blue-50|to-indigo-100/);
    expect(indexCss).toMatch(/--radius:\s*0\.5rem;/);
  });

  it('every token is exposed as a Tailwind colour that keeps the alpha modifier', async () => {
    const tokens = Object.keys(CLASSIC);
    const config = { ...loadConfig(path.join(ROOT, 'tailwind.config.js')), content: [{ raw: tokens.map((t) => `bg-theme-${t}/30 text-theme-${t}`).join(' ') }] };
    const { css } = await postcss([tailwindcss(config)]).process('@tailwind utilities;', { from: undefined });
    for (const token of tokens) {
      expect(css, token).toContain(`.bg-theme-${token}\\/30`);
      expect(css, token).toContain(`rgb(var(--t-${token}) / 0.3)`);
      expect(css, token).toContain(`.text-theme-${token}`);
    }
  });
});

describe('resolveLookId / data-theme per settings row', () => {
  const classicRow = { ...DEFAULT_VISUAL_SETTINGS, useGradient: true };
  // The current production row: every BRAND_PRESET key saved with the old button, no `activeTheme`.
  const brandRow = { ...DEFAULT_VISUAL_SETTINGS, ...BRAND_PRESET };
  // Classic look where only the global gradient was unchecked: still classic for the selector, so also for data-theme.
  const classicNoGradient = { ...DEFAULT_VISUAL_SETTINGS, useGradient: false };
  const ROWS = {
    classicRow,
    brandRow,
    classicNoGradient,
    brandMarkedClassic: { ...brandRow, activeTheme: 'classic' },
    classicMarkedBrand: { ...classicRow, activeTheme: 'papuenvios' },
    brandInvalidMarker: { ...brandRow, activeTheme: '<img src=x>' },
    brandUpperCase: { ...DEFAULT_VISUAL_SETTINGS, ...Object.fromEntries(Object.entries(BRAND_PRESET).map(([k, v]) => [k, typeof v === 'string' ? v.toUpperCase() : v])) },
    brandMissingOneKey: (({ footerLinkHoverColor, ...rest }) => ({ ...DEFAULT_VISUAL_SETTINGS, ...rest, footerLinkHoverColor: '#123456' }))(brandRow),
    empty: {},
  };

  it('resolves the same look as the Settings > Visual selector (resolveThemeId) for every row', () => {
    for (const [name, row] of Object.entries(ROWS)) expect(resolveLookId(row), name).toBe(resolveThemeId(row));
  });

  it('maps the rows to the look', () => {
    expect(resolveLookId(classicRow)).toBe('classic');
    expect(resolveLookId(classicNoGradient)).toBe('classic');
    expect(resolveLookId(brandRow)).toBe('papuenvios');
    expect(resolveLookId(BRAND_PRESET)).toBe('papuenvios');
    expect(resolveLookId(DEFAULT_VISUAL_SETTINGS)).toBe('classic');
    expect(resolveLookId(ROWS.brandMarkedClassic)).toBe('classic');
    expect(resolveLookId(ROWS.classicMarkedBrand)).toBe('papuenvios');
    expect(resolveLookId(ROWS.brandInvalidMarker)).toBe('papuenvios');
  });

  it('falls back to classic (the selector default) when there is nothing to read', () => {
    expect(resolveLookId()).toBe('classic');
    expect(resolveLookId(null)).toBe('classic');
    expect(resolveLookId({})).toBe('classic');
  });

  describe('applyVisualSettingsToDOM', () => {
    beforeEach(() => document.documentElement.removeAttribute('data-theme'));

    it('writes data-theme for the classic row', () => {
      applyVisualSettingsToDOM(classicRow);
      expect(document.documentElement.dataset.theme).toBe('classic');
    });

    it('writes data-theme for the brand preset and switches back and forth', () => {
      applyVisualSettingsToDOM(brandRow);
      expect(document.documentElement.dataset.theme).toBe('papuenvios');
      applyVisualSettingsToDOM(classicRow);
      expect(document.documentElement.dataset.theme).toBe('classic');
    });

    it('writes data-theme from activeTheme and keeps classic when only useGradient is off', () => {
      applyVisualSettingsToDOM(classicNoGradient);
      expect(document.documentElement.dataset.theme).toBe('classic');
      applyVisualSettingsToDOM(ROWS.classicMarkedBrand);
      expect(document.documentElement.dataset.theme).toBe('papuenvios');
      applyVisualSettingsToDOM(ROWS.brandMarkedClassic);
      expect(document.documentElement.dataset.theme).toBe('classic');
    });
  });

  describe('inline first-paint script (index.html) agrees with resolveLookId', () => {
    const script = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8').match(/<script>([\s\S]*?)<\/script>/)?.[1];
    const runWith = (data) => {
      document.documentElement.removeAttribute('data-theme');
      localStorage.setItem(LOCAL_CACHE_KEY, JSON.stringify({ data, timestamp: 0 }));
      new Function(script)();
      return document.documentElement.getAttribute('data-theme');
    };

    it('picks the same look for every row (activeTheme first, then the full brand preset)', () => {
      for (const [name, row] of Object.entries(ROWS)) expect(runWith(row), name).toBe(resolveLookId(row));
    });

    it('embeds exactly BRAND_PRESET (same keys, same values)', () => {
      expect(JSON.parse(script.match(/var P = (\{[^\n]*\});/)[1])).toEqual(BRAND_PRESET);
    });

    it('only ever writes one of the two constant look ids', () => {
      expect(runWith({ activeTheme: '"><script>' })).toBe('classic');
      expect(runWith({ ...BRAND_PRESET, activeTheme: 'evil' })).toBe('papuenvios');
    });
  });
});

describe('inline first-paint script (index.html)', () => {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
  const run = (cacheValue) => {
    document.documentElement.removeAttribute('data-theme');
    localStorage.clear();
    if (cacheValue !== undefined) localStorage.setItem(LOCAL_CACHE_KEY, cacheValue);
    new Function(script)();
    return document.documentElement.getAttribute('data-theme');
  };

  it('exists and reads the same cache key as the settings service', () => {
    expect(script).toBeTruthy();
    expect(script).toContain(LOCAL_CACHE_KEY);
  });

  it('sets the look from the cached data and ignores how old the cache is', () => {
    expect(run(JSON.stringify({ data: { useGradient: true }, timestamp: 0 }))).toBe('classic');
    expect(run(JSON.stringify({ data: BRAND_PRESET, timestamp: 0 }))).toBe('papuenvios');
    expect(run(JSON.stringify({ data: { activeTheme: 'papuenvios' }, timestamp: Date.now() }))).toBe('papuenvios');
  });

  it('leaves the attribute alone (brand default) without a usable cache and never throws', () => {
    expect(run(undefined)).toBeNull();
    expect(run('{not json')).toBeNull();
    expect(run('null')).toBeNull();
    expect(run(JSON.stringify({ timestamp: 1 }))).toBeNull();
  });
});

// Ratchet: slices migrate screens to the `theme-*` utilities and lower the baseline; it can never go up.
// MIGRATED_FILES grows with every slice: a migrated file must stay free of the old palette.
// Measured with the codemod's own counter (tests and exempt files excluded) on the T0 base.
const BASELINE_OLD_PALETTE_CLASSES = 773;
const MIGRATED_FILES = [];

describe('old palette ratchet', () => {
  const files = listSourceFiles('src', ROOT).filter((file) => !file.startsWith('src/tests/'));
  const countOf = (file) => countOldPalette(fs.readFileSync(path.join(ROOT, file), 'utf8'), file);

  it('the total of blue/indigo/purple/violet/sky/cyan classes in src never goes above the baseline', () => {
    const total = files.reduce((sum, file) => sum + countOf(file), 0);
    expect(total, 'new old-palette classes were added: use the theme-* utilities (scripts/theme-codemod.mjs)').toBeLessThanOrEqual(BASELINE_OLD_PALETTE_CLASSES);
  });

  it.each(MIGRATED_FILES.map((file) => [file]))('%s stays free of the old palette', (file) => {
    expect(countOf(file)).toBe(0);
  });
});
