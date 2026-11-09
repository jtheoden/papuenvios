import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import postcss from 'postcss';
import tailwindcss from 'tailwindcss';
import loadConfig from 'tailwindcss/loadConfig';
import colors from 'tailwindcss/colors';
import { BRAND_PALETTE, BRAND_PRESET, resolveLookId } from '@/lib/brandPalette';
import { LOCAL_CACHE_KEY } from '@/lib/constants';
import { countOldPalette, isExempt, listSourceFiles } from '../../../scripts/theme-codemod.mjs';

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

describe('controls follow the look (index.css)', () => {
  const css = indexCss.replace(/\/\*[\s\S]*?\*\//g, '');
  const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(([, selector, body]) => ({ selector: selector.trim(), body }));
  // Body of the rule whose selector is exactly `selector` and that declares --primary.
  const blockOf = (selector) => rules.find((rule) => rule.selector === selector && rule.body.includes('--primary:'))?.body ?? '';

  it('native checkbox, radio and range take their accent colour from --t-focus (charcoal in the brand look)', () => {
    const rule = rules.find((r) => /accent-color:\s*rgb\(var\(--t-focus\)\)/.test(r.body))?.selector ?? '';
    for (const type of ['checkbox', 'radio', 'range']) expect(rule, type).toContain(`input[type="${type}"]`);
  });

  it('--primary, --primary-foreground and --ring come from the theme tokens in the brand look', () => {
    const brand = blockOf(':root');
    expect(brand).toMatch(/--primary:\s*var\(--t-accent\);/);
    expect(brand).toMatch(/--primary-foreground:\s*var\(--t-on-accent\);/);
    expect(brand).toMatch(/--ring:\s*var\(--t-focus\);/);
  });

  it('classic keeps the exact blue the shadcn tokens had (hsl 220 90% 56% = 42 109 244) and a white foreground', () => {
    const classic = blockOf(':root[data-theme="classic"]');
    expect(classic).toMatch(/--primary:\s*42 109 244;/);
    expect(classic).toMatch(/--primary-foreground:\s*255 255 255;/);
    expect(classic).toMatch(/--ring:\s*42 109 244;/);
  });

  it('the default Button hover goes to the darker gold step (charcoal text stays readable), without touching classic', () => {
    const rule = rules.find((r) => r.selector === ':root:not([data-theme="classic"]) .hover\\:bg-primary\\/90:hover');
    expect(rule?.body).toMatch(/background-color:\s*rgb\(var\(--t-accent-hover\)\)/);
    expect(rules.some((r) => r.selector.includes('[data-theme="classic"]') && !r.selector.includes(':not(') && r.selector.includes('bg-primary'))).toBe(false);
  });

  it('remittance pages scope their blue-400 accents to classic via theme classes (brand overrides in index.css)', () => {
    const read = (file) => fs.readFileSync(path.join(ROOT, `src/components/${file}.jsx`), 'utf8');
    // Classic keeps the original blue-400 utilities; the marker classes let the brand look override them.
    expect(read('MyRemittancesPage')).toMatch(/theme-accent-disabled disabled:bg-blue-400/);
    expect(read('RemittancesPage')).toMatch(/ring-blue-400\/50 theme-cta-ring/);
    const ring = rules.find((r) => r.selector === ':root:not([data-theme="classic"]) .theme-cta-ring');
    expect(ring?.body).toMatch(/--tw-ring-color:\s*rgb\(var\(--t-accent\) \/ 0\.5\)/);
    const disabled = rules.find((r) => r.selector === ':root:not([data-theme="classic"]) .theme-accent-disabled:disabled');
    expect(disabled?.body).toMatch(/background-color:\s*rgb\(var\(--t-accent\) \/ 0\.6\)/);
  });

  it('the Visual settings sliders no longer hardcode a blue accent', () => {
    expect(fs.readFileSync(path.join(ROOT, 'src/components/settings/SettingsPageVisual.jsx'), 'utf8')).not.toMatch(/accent-blue-/);
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
    // Before step 7 these identity fields were not part of the preset; stored rows must keep their look.
    legacyBrandIdentity: { ...brandRow, primaryColor: '#3499dc', secondaryColor: '#9333ea', headerGradientColor: '#9333ea' },
    legacyBrandWithoutIdentity: Object.fromEntries(Object.entries(BRAND_PRESET).filter(([key]) => !['primaryColor', 'secondaryColor', 'headerGradientColor'].includes(key))),
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
const BASELINE_OLD_PALETTE_CLASSES = 729;
const MIGRATED_FILES = ['src/components/ui/Checkbox.jsx'];

describe('old palette ratchet', () => {
  it('Visual Settings chrome and child previews use theme tokens, not fixed blue/purple utilities', () => {
    for (const file of ['SettingsPageVisual', 'HeaderPreview', 'FooterPreview', 'LoaderPreview']) {
      const source = fs.readFileSync(path.join(ROOT, `src/components/settings/${file}.jsx`), 'utf8');
      // Colour pickers may display stored HEX values; that does not exempt the surrounding UI chrome.
      expect(source, file).not.toMatch(/\b(?:bg|text|border|ring|from|via|to)-(?:blue|purple|indigo|violet|sky|cyan)-\d{2,3}\b/);
    }
  });

  const files = listSourceFiles('src', ROOT).filter((file) => !file.startsWith('src/tests/'));
  const countOf = (file) => countOldPalette(fs.readFileSync(path.join(ROOT, file), 'utf8'), file);

  it('the total of blue/indigo/purple/violet/sky/cyan classes in src never goes above the baseline', () => {
    const total = files.reduce((sum, file) => sum + countOf(file), 0);
    expect(total, 'new old-palette classes were added: use the theme-* utilities (scripts/theme-codemod.mjs)').toBeLessThanOrEqual(BASELINE_OLD_PALETTE_CLASSES);
  });

  it.each(MIGRATED_FILES.map((file) => [file]))('%s stays free of the old palette', (file) => {
    expect(countOf(file)).toBe(0);
  });

  // Links: a link-like element is an <a> / <LegalLink> / <Link> tag, or a class string that is underlined or has a
  // text hover. Its text colour must be text-theme-link(-strong), never the old blue palette (charcoal in the brand look).
  const OLD_TEXT = /(?<![\w-])(?:[a-z-]+:)*text-(?:blue|indigo|sky|cyan)-\d{2,3}(?![\w-])/;
  const LINK_TAG = /<(?:a|LegalLink|Link)\b(?:[^<>{}]|\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\})*>/g;
  const CLASS_STRING = /(['"`])((?:(?!\1)[^\n])*?)\1/g;
  const isLinkLike = (classes) => OLD_TEXT.test(classes) && /(?<![\w-])(?:underline|hover:underline|hover:text-)/.test(classes);
  // The focus ring of a link-like element is theme-focus too; and a hover that no longer changes the colour keeps a cue.
  const OLD_RING = /(?<![\w-])(?:[a-z-]+:)*ring-(?:blue|indigo|sky|cyan)-\d{2,3}(?![\w-])/;
  const LINK_STRING = /(?<![\w-])(?:underline|hover:underline)(?![\w-])/;
  const noHoverCue = (classes) => /(?<![\w:-])text-theme-link-strong(?![\w-])/.test(classes) && /(?<![\w-])hover:text-theme-link-strong(?![\w-])/.test(classes);
  const linkOffenders = (file, source) => {
    const found = [];
    for (const [tag] of source.matchAll(LINK_TAG)) if (OLD_TEXT.test(tag) || OLD_RING.test(tag)) found.push(tag.replace(/\s+/g, ' ').slice(0, 90));
    for (const [, , body] of source.matchAll(CLASS_STRING)) {
      if (isLinkLike(body) || (LINK_STRING.test(body) && OLD_RING.test(body)) || noHoverCue(body)) found.push(body.slice(0, 90));
    }
    return found.map((snippet) => `${file}: ${snippet}`);
  };

  it('no link-like element uses the old palette for its text colour', () => {
    const offenders = files
      .filter((file) => !isExempt(file))
      .flatMap((file) => linkOffenders(file, fs.readFileSync(path.join(ROOT, file), 'utf8')));
    expect(offenders, 'use text-theme-link / text-theme-link-strong on links').toEqual([]);
  });

  it('the link rule flags what it should and spares what it should not', () => {
    expect(linkOffenders('x', '<a href="/x" className="text-blue-600 underline">y</a>').length).toBeGreaterThan(0);
    expect(linkOffenders('x', '<LegalLink\n page="terms"\n className="font-medium text-blue-700"\n>')).toHaveLength(1);
    expect(linkOffenders('x', "const c = 'underline text-blue-700 hover:text-blue-900';")).toHaveLength(1);
    expect(linkOffenders('x', '<button className="text-blue-600 hover:text-blue-700">y</button>')).toHaveLength(1);
    expect(linkOffenders('x', '<a href="/x" className="text-theme-link underline">y</a>')).toHaveLength(0);
    expect(linkOffenders('x', '<a href="/x" className="text-theme-link underline focus-visible:ring-blue-700">y</a>').length).toBeGreaterThan(0);
    expect(linkOffenders('x', "const c = 'underline text-theme-link focus-visible:ring-blue-600';").length).toBeGreaterThan(0);
    expect(linkOffenders('x', "const c = 'underline text-theme-link-strong hover:text-theme-link-strong';").length).toBeGreaterThan(0);
    expect(linkOffenders('x', "const c = 'underline text-theme-link-strong hover:decoration-2 focus-visible:ring-theme-focus';")).toHaveLength(0);
    expect(linkOffenders('x', '<input className="rounded focus-visible:ring-blue-600" />')).toHaveLength(0);
    expect(linkOffenders('x', '<span className="text-blue-600 font-bold">42</span>')).toHaveLength(0);
    expect(linkOffenders('x', '<Icon className="text-gray-600 group-hover:text-blue-600" />')).toHaveLength(0);
  });
});
